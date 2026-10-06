package main

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"log/slog"
	"ludex/backend/db"
	"ludex/backend/internal/catalog"
	"ludex/backend/internal/companion"
	"ludex/backend/internal/connections"
	"ludex/backend/internal/core"
	"ludex/backend/internal/jobs"
	"ludex/backend/internal/plans"
	"ludex/backend/internal/platform"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func main() {
	if err := run(); err != nil {
		slog.Error("Ludex stopped", "reason", err.Error())
		os.Exit(1)
	}
}
func run() error {
	envPath := flag.String("env", "", "explicit server env file")
	flag.Parse()
	if *envPath != "" {
		if err := platform.LoadEnv(*envPath); err != nil {
			return fmt.Errorf("server env file could not be loaded")
		}
	}
	command := "serve"
	if flag.NArg() > 0 {
		command = flag.Arg(0)
	}
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	url := os.Getenv("DATABASE_URL")
	if command == "migrate" {
		url = platform.Env("DIRECT_URL", url)
	}
	if url == "" {
		return fmt.Errorf("DATABASE_URL is required")
	}
	cfg, err := platform.PoolConfig(url, int32(platform.Number("LUDEX_DATABASE_MAX_CONNECTIONS", 4)))
	if err != nil {
		return err
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return fmt.Errorf("database connection unavailable")
	}
	defer pool.Close()
	ping, c := context.WithTimeout(ctx, 8*time.Second)
	err = pool.Ping(ping)
	c()
	if err != nil {
		return fmt.Errorf("database unavailable; verify server settings")
	}
	if command == "migrate" {
		if platform.Env("LUDEX_ENV", "development") != "development" && os.Getenv("LUDEX_ALLOW_MIGRATIONS") != "true" {
			return fmt.Errorf("non-development migrations require LUDEX_ALLOW_MIGRATIONS=true after review")
		}
		return db.Migrate(ctx, pool)
	}
	cat := catalog.New(catalog.Config{TMDBKey: os.Getenv("TMDB_API_KEY"), TMDBToken: os.Getenv("TMDB_READ_ACCESS_TOKEN"), TwitchClientID: os.Getenv("TWITCH_CLIENT_ID"), TwitchSecret: os.Getenv("TWITCH_CLIENT_SECRET")})
	app := core.New(pool, core.Config{Env: platform.Env("LUDEX_ENV", "development"), InviteCode: os.Getenv("LUDEX_LOCAL_INVITE"), MaxAccounts: 100, GoogleWebClientID: os.Getenv("GOOGLE_WEB_CLIENT_ID"), GoogleWebClientSecret: os.Getenv("GOOGLE_WEB_CLIENT_SECRET"), GoogleAndroidClientID: os.Getenv("GOOGLE_ANDROID_CLIENT_ID"), RedirectURI: platform.Env("GOOGLE_REDIRECT_URI", "http://localhost:4000/api/auth/google/callback"), WebOrigin: platform.Env("LUDEX_WEB_ORIGIN", "http://localhost:3001"), AllowedOrigins: strings.Split(platform.Env("LUDEX_CORS_ORIGINS", "http://localhost:3000,http://localhost:3001"), ","), ModeratorEmails: strings.Split(os.Getenv("LUDEX_MODERATOR_EMAILS"), ","), CatalogSearch: func(ctx context.Context, text, media, region string) ([]core.CatalogHit, error) {
		hits, e := cat.Search(ctx, text, media, region)
		if e != nil {
			return nil, e
		}
		out := []core.CatalogHit{}
		for _, h := range hits {
			b, _ := json.Marshal(h)
			var v core.CatalogHit
			json.Unmarshal(b, &v)
			out = append(out, v)
		}
		return out, nil
	}, CatalogGet: func(ctx context.Context, id string) (core.CatalogHit, error) {
		h, e := cat.Title(ctx, id)
		var v core.CatalogHit
		b, _ := json.Marshal(h)
		json.Unmarshal(b, &v)
		return v, e
	}})
	aiKey := ""
	if os.Getenv("LUDEX_AI_ENABLED") == "true" {
		aiKey = os.Getenv("AZURE_OPENAI_API_KEY")
	}
	ai := companion.New(pool, companion.Config{AzureEndpoint: platform.Env("AZURE_OPENAI_ENDPOINT", "https://thehub.services.ai.azure.com/openai/v1"), AzureDeployment: platform.Env("AZURE_OPENAI_CHAT_DEPLOYMENT", "gpt-6-luna"), EmbeddingDeployment: platform.Env("AZURE_OPENAI_EMBEDDING_DEPLOYMENT", "text-embedding-3-large"), AzureAPIKey: aiKey, AzureEnabled: aiKey != "", CloudConsent: func(ctx context.Context, user string) (bool, error) {
		var allowed bool
		e := pool.QueryRow(ctx, "SELECT COALESCE((notification_preferences->>'aiCloudConsent')::boolean,false) FROM account_settings WHERE user_id=$1", user).Scan(&allowed)
		return allowed, e
	}, ResolveUser: app.ResolveUser, ApplyProgress: app.ApplyProgress, Catalog: cat, LoadLibrary: func(ctx context.Context, user string) ([]companion.LibraryRecord, error) {
		items, e := app.LoadLibrary(ctx, user)
		if e != nil {
			return nil, e
		}
		out := []companion.LibraryRecord{}
		for _, item := range items {
			var title, media string
			pool.QueryRow(ctx, "SELECT title,media FROM titles WHERE id=$1", item.TitleID).Scan(&title, &media)
			runs, _ := json.Marshal(item.Runs)
			note := ""
			if item.Note != nil {
				note = *item.Note
			}
			out = append(out, companion.LibraryRecord{TitleID: item.TitleID, Title: title, Media: media, State: item.State, Version: int(item.Version), Rating: item.Rating, Liked: item.Liked, Note: note, Runs: runs})
		}
		return out, nil
	}, Limits: companion.Limits{UserDailyMicros: 5000, MonthlyResponsesPerUser: 20, MonthlyBudgetMicros: 5000000, SharedDailyMicros: 150000, ResponsesInputMicrosPerMillion: micros("LUDEX_AI_INPUT_USD_PER_MILLION_TOKENS"), ResponsesOutputMicrosPerMillion: micros("LUDEX_AI_OUTPUT_USD_PER_MILLION_TOKENS"), EmbeddingMicrosPerMillion: micros("LUDEX_AI_EMBEDDING_USD_PER_MILLION_TOKENS"), MaxContextTokens: platform.Number("LUDEX_AI_MAX_INPUT_TOKENS", 4000), MaxOutputTokens: platform.Number("LUDEX_AI_MAX_OUTPUT_TOKENS", 600), MaxConcurrentRequests: 2, RequestsPerMinute: 6, MaxLibraryRecords: 12}})
	key, _ := hex.DecodeString(os.Getenv("LUDEX_TOKEN_ENCRYPTION_KEY"))
	conn := connections.New(pool, connections.Config{ResolveUser: app.ResolveUser, ApplyProgress: app.ApplyProgress, ApplyLibrary: app.ApplyLibrary, EpisodeExists: func(ctx context.Context, title, episode string) (bool, error) {
		hit, e := app.GetTitle(ctx, title)
		if e != nil {
			return false, e
		}
		for _, entry := range hit.Episodes {
			if entry.ID == episode {
				return true, nil
			}
		}
		return false, nil
	}, LoadVersion: func(ctx context.Context, user, title string) (int64, error) {
		var version int64
		e := pool.QueryRow(ctx, "SELECT COALESCE((SELECT version FROM library_entries WHERE user_id=$1 AND title_id=$2),0)", user, title).Scan(&version)
		return version, e
	}, SteamKey: os.Getenv("STEAM_WEB_API_KEY"), EncryptionKey: key, Search: func(ctx context.Context, t, m, r string) ([]connections.Match, error) {
		hits, e := cat.Search(ctx, t, m, r)
		out := []connections.Match{}
		for _, h := range hits {
			out = append(out, connections.Match{ID: h.ID, Title: h.Title, Media: h.Media, Year: h.Year})
		}
		return out, e
	}})
	plan := plans.New(pool, plans.Config{ResolveUser: app.ResolveUser})
	if command == "work" {
		n, e := jobs.Run(ctx, pool, conn.WorkHandlers(), 20)
		slog.Info("Worker pass", "completed", n)
		return e
	}
	if command != "serve" {
		return fmt.Errorf("command must be serve, migrate or work")
	}
	router := productRouter(app, ai, conn, plan)
	server := &http.Server{Addr: platform.Env("LUDEX_HOST", "127.0.0.1") + ":" + platform.Env("PORT", "4000"), Handler: platform.Protect(router, strings.Split(platform.Env("LUDEX_CORS_ORIGINS", "http://localhost:3000,http://localhost:3001"), ",")), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 20 * time.Second, WriteTimeout: 90 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 16384}
	go func() {
		<-ctx.Done()
		shutdown, c := context.WithTimeout(context.Background(), 8*time.Second)
		defer c()
		server.Shutdown(shutdown)
	}()
	slog.Info("Ludex Go API ready", "address", server.Addr, "cloudAI", aiKey != "")
	err = server.ListenAndServe()
	if err == http.ErrServerClosed {
		return nil
	}
	return err
}
func micros(key string) int64 {
	v, e := strconv.ParseFloat(os.Getenv(key), 64)
	if e != nil || v <= 0 {
		return 0
	}
	return int64(v * 1000000)
}

func productRouter(app, ai, conn, plan http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(strings.TrimPrefix(r.URL.Path, "/api/v1"), "/api")
		switch {
		case strings.HasPrefix(path, "/assistant/"):
			http.StripPrefix(strings.TrimSuffix(r.URL.Path, path)+"/assistant", ai).ServeHTTP(w, r)
		case strings.HasPrefix(path, "/connections") || strings.HasPrefix(path, "/imports") || strings.HasPrefix(path, "/import/") || path == "/notifications":
			conn.ServeHTTP(w, r)
		case path == "/plans" || strings.HasPrefix(path, "/plans/"):
			plan.ServeHTTP(w, r)
		default:
			app.ServeHTTP(w, r)
		}
	})
}
