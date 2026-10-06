package connections

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
	"strings"
	"time"
)

type Config struct {
	ResolveUser   func(*http.Request) (string, error)
	Search        func(context.Context, string, string, string) ([]Match, error)
	LoadVersion   func(context.Context, string, string) (int64, error)
	ApplyProgress func(context.Context, string, json.RawMessage) (json.RawMessage, error)
	ApplyLibrary  func(context.Context, string, json.RawMessage) (json.RawMessage, error)
	SteamKey      string
	SteamBaseURL  string
	SteamHTTP     *http.Client
	EncryptionKey []byte
}
type Match struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Media string `json:"media"`
	Year  int    `json:"year,omitempty"`
}
type Handler struct {
	db  *pgxpool.Pool
	cfg Config
}

func New(db *pgxpool.Pool, cfg Config) *Handler { return &Handler{db, cfg} }
func output(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
func problem(w http.ResponseWriter, status int, code string) {
	output(w, status, map[string]string{"code": code, "message": strings.ReplaceAll(code, "-", " ")})
}
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	user, e := h.cfg.ResolveUser(r)
	if e != nil {
		problem(w, 401, "authentication-required")
		return
	}
	ctx := r.Context()
	path := strings.TrimPrefix(strings.TrimPrefix(r.URL.Path, "/api/v1"), "/api")
	if path == "/connections" && r.Method == "GET" {
		items := []map[string]any{}
		rows, err := h.db.Query(ctx, "SELECT source,provider_user,share_completions,last_success,last_error FROM connector_accounts WHERE user_id=$1", user)
		if err != nil {
			problem(w, 500, "read-failed")
			return
		}
		defer rows.Close()
		for rows.Next() {
			var source, name string
			var share bool
			var success *time.Time
			var last *string
			if rows.Scan(&source, &name, &share, &success, &last) == nil {
				items = append(items, map[string]any{"source": source, "providerUser": name, "shareCompletions": share, "lastSuccess": success, "lastError": last})
			}
		}
		output(w, 200, map[string]any{"connections": items, "capabilities": map[string]any{
			"steam": map[string]any{
				"configured": h.cfg.SteamKey != "", "supported": h.cfg.SteamKey != "", "accountLinked": false,
				"mode": "manual-steamid-review", "features": map[string]bool{"ownedGames": h.cfg.SteamKey != "", "achievements": false},
			},
			"netflixCapture": true, "csv": true, "letterboxd": true, "retroachievements": false, "trakt": false,
		}})
		return
	}
	if path == "/connections/steam/preview" && r.Method == "POST" {
		h.previewSteam(w, r, user)
		return
	}
	if path == "/connections/capture" && r.Method == "POST" {
		var in struct {
			Title         string          `json:"title"`
			URL           string          `json:"url"`
			Video         json.RawMessage `json:"video"`
			ObservationID string          `json:"observationId"`
		}
		d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192))
		d.DisallowUnknownFields()
		if d.Decode(&in) != nil || len(in.Title) < 1 || len(in.Title) > 500 || len(in.URL) > 2000 || len(in.ObservationID) > 160 || in.ObservationID == "" {
			problem(w, 400, "invalid-capture")
			return
		}
		payload, _ := json.Marshal(in)
		id := uuid.NewString()
		err := h.db.QueryRow(ctx, `INSERT INTO connector_observations(id,user_id,source,provider_record,payload)
			VALUES($1,$2,'netflix-extension',$3,$4::jsonb)
			ON CONFLICT(user_id,source,provider_record) DO UPDATE SET provider_record=EXCLUDED.provider_record
			RETURNING id`, id, user, in.ObservationID, string(payload)).Scan(&id)
		if err != nil {
			problem(w, 500, "write-failed")
			return
		}
		output(w, 202, map[string]string{"status": "needs-review", "id": id})
		return
	}
	if path == "/connections/observations" && r.Method == "GET" {
		rows, err := h.db.Query(ctx, "SELECT id,source,payload,status,observed_at FROM connector_observations WHERE user_id=$1 AND status IN ('needs-review','confirming') ORDER BY observed_at DESC LIMIT 100", user)
		if err != nil {
			problem(w, 500, "read-failed")
			return
		}
		defer rows.Close()
		items := []map[string]any{}
		for rows.Next() {
			var id, source, status string
			var body json.RawMessage
			var at time.Time
			rows.Scan(&id, &source, &body, &status, &at)
			items = append(items, map[string]any{"id": id, "source": source, "payload": body, "status": status, "observedAt": at})
		}
		output(w, 200, items)
		return
	}
	if len(strings.Split(strings.Trim(path, "/"), "/")) == 4 && strings.HasPrefix(path, "/connections/observations/") && strings.HasSuffix(path, "/confirm") && r.Method == "POST" {
		parts := strings.Split(strings.Trim(path, "/"), "/")
		h.confirmObservation(w, r, user, parts[2])
		return
	}
	if (path == "/import/preview" || path == "/imports/preview") && r.Method == "POST" {
		var in struct {
			Source string `json:"source"`
			CSV    string `json:"csv"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 6*1024*1024)).Decode(&in) != nil || (in.Source != "csv" && in.Source != "letterboxd") {
			problem(w, 400, "invalid-import")
			return
		}
		rows, err := ParseCSV(strings.NewReader(in.CSV), in.Source)
		if err != nil {
			problem(w, 400, "invalid-csv")
			return
		}
		for i := range rows {
			if h.cfg.Search == nil {
				break
			}
			matches, err := h.cfg.Search(ctx, rows[i].Title, rows[i].Media, "US")
			if err != nil {
				continue
			}
			for _, m := range matches {
				if strings.EqualFold(m.Title, rows[i].Title) && (rows[i].Year == 0 || rows[i].Year == m.Year) {
					rows[i].MatchedTitleID = m.ID
					rows[i].Status = "matched"
					break
				}
			}
			if i >= 49 {
				break
			}
		}
		id := uuid.NewString()
		body, _ := json.Marshal(rows)
		if _, err = h.db.Exec(ctx, "INSERT INTO import_batches(id,user_id,source,rows) VALUES($1,$2,$3,$4)", id, user, in.Source, json.RawMessage(body)); err != nil {
			problem(w, 500, "write-failed")
			return
		}
		output(w, 201, map[string]any{"id": id, "source": in.Source, "rows": rows, "status": "preview", "quietImport": true})
		return
	}
	if path == "/imports" && r.Method == "GET" {
		rows, err := h.db.Query(ctx, "SELECT id,source,status,created_at FROM import_batches WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30", user)
		if err != nil {
			problem(w, 500, "read-failed")
			return
		}
		defer rows.Close()
		items := []map[string]any{}
		for rows.Next() {
			var id, s, status string
			var at time.Time
			rows.Scan(&id, &s, &status, &at)
			items = append(items, map[string]any{"id": id, "source": s, "status": status, "createdAt": at})
		}
		output(w, 200, items)
		return
	}
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) == 3 && parts[0] == "imports" && parts[1] == "jobs" && r.Method == "GET" {
		h.importJobStatus(w, r, user, parts[2])
		return
	}
	if len(parts) == 3 && parts[0] == "imports" && parts[2] == "commit" && r.Method == "POST" {
		h.queueImport(w, r, user, parts[1])
		return
	}
	if path == "/notifications" && r.Method == "GET" {
		rows, err := h.db.Query(ctx, "SELECT id,kind,body,read_at,created_at FROM notification_inbox WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50", user)
		if err != nil {
			problem(w, 500, "read-failed")
			return
		}
		defer rows.Close()
		items := []map[string]any{}
		for rows.Next() {
			var id, k string
			var body json.RawMessage
			var read *time.Time
			var at time.Time
			rows.Scan(&id, &k, &body, &read, &at)
			items = append(items, map[string]any{"id": id, "kind": k, "body": body, "readAt": read, "createdAt": at})
		}
		output(w, 200, items)
		return
	}
	problem(w, 404, "route-not-found")
}
