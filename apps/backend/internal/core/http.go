package core

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func New(db *pgxpool.Pool, cfg Config) *App {
	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 8 * time.Second}
	}
	if cfg.SessionCookieName == "" {
		cfg.SessionCookieName = "ludex_session"
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		// Cursor signatures become process-local but stay unpredictable when the
		// operating-system random source is available again.
		key = []byte(fmt.Sprintf("%p:%d", db, time.Now().UnixNano()))
	}
	return &App{db: db, cfg: cfg, httpClient: client, cursorKey: key}
}

func (a *App) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Vary", "Origin")
	if origin := r.Header.Get("Origin"); origin != "" {
		if !a.originAllowed(origin) {
			writeProblem(w, problem(http.StatusForbidden, "origin-not-allowed"))
			return
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Credentials", "true")
	}
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	path := apiPath(r.URL.Path)
	if !knownRoute(path, r.Method) {
		writeProblem(w, notFound("route-not-found"))
		return
	}
	if path == "/auth/google/start" {
		if err := a.googleStart(w, r); err != nil {
			writeProblem(w, err)
		}
		return
	}
	if path == "/auth/google/callback" {
		if err := a.googleCallback(w, r); err != nil {
			writeProblem(w, err)
		}
		return
	}
	if r.Method == http.MethodGet && (path == "/health" || path == "/preview" || path == "/auth/config" || path == "/catalog/search" || path == "/catalog/title") {
		a.handlePublicRead(w, r, path)
		return
	}
	var body json.RawMessage
	if r.Method == http.MethodPost {
		var err error
		body, err = readBody(r)
		if err != nil {
			writeProblem(w, err)
			return
		}
	}
	if path == "/auth/signup" {
		var input struct {
			InviteCode  string `json:"inviteCode"`
			Email       string `json:"email"`
			Password    string `json:"password"`
			DisplayName string `json:"displayName"`
		}
		if err := decodeBody(body, &input); err != nil {
			writeProblem(w, err)
			return
		}
		result, err := a.localSignup(r.Context(), input)
		respond(w, result, err)
		return
	}
	if path == "/auth/login" {
		var input struct {
			Email    string `json:"email"`
			Password string `json:"password"`
		}
		if err := decodeBody(body, &input); err != nil {
			writeProblem(w, err)
			return
		}
		result, err := a.localLogin(r.Context(), input)
		respond(w, result, err)
		return
	}
	if path == "/auth/google/native/challenge" {
		result, err := a.googleChallenge(r.Context())
		respond(w, result, err)
		return
	}
	if path == "/auth/google/native/start" {
		var input nativeGoogleStartInput
		if err := decodeBody(body, &input); err != nil {
			writeProblem(w, err)
			return
		}
		result, err := a.startNativeBrowserGoogle(r.Context(), r, input)
		respond(w, result, err)
		return
	}
	if path == "/auth/google/native/exchange" {
		var input struct {
			Code         string `json:"code"`
			CodeVerifier string `json:"codeVerifier"`
		}
		if err := decodeBody(body, &input); err != nil {
			writeProblem(w, err)
			return
		}
		if err := a.applyNativeRateLimit(r.Context(), r, "exchange"); err != nil {
			respond(w, nil, err)
			return
		}
		result, err := a.exchangeNativeBrowserHandoff(r.Context(), input.Code, input.CodeVerifier)
		respond(w, result, err)
		return
	}
	if path == "/auth/google/native" {
		var input struct {
			IDToken     string `json:"idToken"`
			ChallengeID string `json:"challengeId"`
			InviteCode  string `json:"inviteCode"`
		}
		if err := decodeBody(body, &input); err != nil {
			writeProblem(w, err)
			return
		}
		result, err := a.googleNative(r.Context(), input)
		respond(w, result, err)
		return
	}
	if path == "/preview" {
		writeProblem(w, problem(http.StatusServiceUnavailable, "preview-unavailable"))
		return
	}
	userID := ""
	var err error
	anonymousRead := r.Method == http.MethodGet && (path == "/activity" || path == "/showcase" || path == "/collection" || path == "/collections" || path == "/social/replies")
	if bearerOrCookie(r, a.cfg.SessionCookieName) != "" || !anonymousRead {
		userID, err = a.ResolveUser(r)
		if err != nil {
			writeProblem(w, err)
			return
		}
	}
	if r.Method == http.MethodPost && r.Header.Get("Authorization") == "" {
		if cookie, cookieErr := r.Cookie(a.cfg.SessionCookieName); cookieErr == nil && cookie.Value != "" && !a.sameOrigin(r) {
			writeProblem(w, forbidden("csrf-origin-required"))
			return
		}
	}
	if path == "/auth/me" {
		result, err := a.me(r.Context(), userID)
		respond(w, result, err)
		return
	}
	if path == "/auth/logout" {
		if err := a.logout(r.Context(), bearerOrCookie(r, a.cfg.SessionCookieName)); err != nil {
			respond(w, nil, err)
			return
		}
		http.SetCookie(w, &http.Cookie{Name: a.cfg.SessionCookieName, Value: "", Path: "/api", HttpOnly: true, Secure: !a.isDevelopment(), SameSite: http.SameSiteLaxMode, MaxAge: -1})
		respond(w, map[string]any{}, nil)
		return
	}
	principal := Principal{UserID: userID}
	if userID != "" {
		principal, err = a.principal(r.Context(), userID)
		if err != nil {
			writeProblem(w, err)
			return
		}
	} else if !anonymousRead {
		writeProblem(w, unauthorized("authentication-required"))
		return
	}
	if path == "/account/download" {
		w.Header().Set("Content-Disposition", `attachment; filename="ludex-export.json"`)
	}
	result, err := a.handleCoreRoute(r.Context(), r, path, principal, body)
	respond(w, result, err)
}

func apiPath(path string) string {
	for _, prefix := range []string{"/api/v1", "/api"} {
		if path == prefix {
			return "/"
		}
		if strings.HasPrefix(path, prefix+"/") {
			return strings.TrimPrefix(path, prefix)
		}
	}
	return path
}

func knownRoute(path, method string) bool {
	key := method + " " + path
	switch key {
	case "GET /health", "GET /preview", "GET /auth/config", "GET /catalog/search", "GET /catalog/title",
		"POST /auth/signup", "POST /auth/login", "POST /auth/logout", "GET /auth/me",
		"GET /auth/google/start", "POST /auth/google/start", "GET /auth/google/callback", "GET /auth/google/native/challenge", "POST /auth/google/native", "POST /auth/google/native/start", "POST /auth/google/native/exchange",
		"GET /library", "POST /progress", "POST /library/edit", "POST /progress/correct",
		"GET /feed", "GET /activity", "GET /social/users", "GET /social/status", "POST /social/follow", "POST /social/friendship",
		"GET /showcase", "POST /showcase", "GET /collection", "POST /collection", "GET /collections",
		"GET /social/review/drafts", "POST /social/review/draft", "POST /social/review/publish", "POST /social/review/edit",
		"GET /social/replies", "POST /social/reply", "POST /social/reply/edit", "POST /social/react", "POST /social/block",
		"POST /social/report", "GET /moderation", "POST /moderation", "GET /social/circles", "POST /social/circles",
		"GET /account/settings", "POST /account/settings", "POST /account/export", "GET /account/download", "POST /account/delete":
		return true
	default:
		return false
	}
}

func (a *App) sameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return false
	}
	if a.originAllowed(origin) {
		return true
	}
	parsed, err := url.Parse(origin)
	return err == nil && parsed.Host == r.Host && (parsed.Scheme == "http" || parsed.Scheme == "https")
}

func (a *App) originAllowed(origin string) bool {
	if a.cfg.WebOrigin != "" && origin == strings.TrimRight(a.cfg.WebOrigin, "/") {
		return true
	}
	for _, allowed := range a.cfg.AllowedOrigins {
		if origin == strings.TrimRight(allowed, "/") {
			return true
		}
	}
	return false
}

func bearerOrCookie(r *http.Request, cookieName string) string {
	if value := r.Header.Get("Authorization"); strings.HasPrefix(value, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(value, "Bearer "))
	}
	if cookie, err := r.Cookie(cookieName); err == nil {
		return cookie.Value
	}
	return ""
}

func readBody(r *http.Request) (json.RawMessage, error) {
	reader := http.MaxBytesReader(nil, r.Body, 64<<10)
	data, err := io.ReadAll(reader)
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return nil, problem(http.StatusRequestEntityTooLarge, "request-too-large")
		}
		return nil, badRequest("invalid-body")
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return json.RawMessage(`{}`), nil
	}
	if !json.Valid(data) {
		return nil, badRequest("invalid-json")
	}
	return json.RawMessage(data), nil
}

func decodeBody(raw json.RawMessage, target any) error {
	if err := json.Unmarshal(raw, target); err != nil {
		return badRequest("invalid-request")
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.WriteHeader(status)
	if value == nil {
		_, _ = w.Write([]byte("{}"))
		return
	}
	_ = json.NewEncoder(w).Encode(value)
}

func writeProblem(w http.ResponseWriter, err error) {
	status, code, message := statusFor(err)
	writeJSON(w, status, map[string]any{"code": code, "message": message})
}

func respond(w http.ResponseWriter, value any, err error) {
	if err != nil {
		writeProblem(w, err)
		return
	}
	if result, ok := value.(CommandResult); ok {
		if result.Status == "conflict" {
			writeJSON(w, http.StatusConflict, result)
			return
		}
		if result.Status == "rejected" {
			writeJSON(w, http.StatusBadRequest, result)
			return
		}
	}
	writeJSON(w, http.StatusOK, value)
}

func (a *App) handlePublicRead(w http.ResponseWriter, r *http.Request, path string) {
	switch path {
	case "/health":
		writeJSON(w, http.StatusOK, map[string]any{"status": "ready", "authMode": "google", "cloudVerified": false})
	case "/auth/config":
		writeJSON(w, http.StatusOK, map[string]any{"googleEnabled": a.cfg.GoogleWebClientID != "" || a.cfg.GoogleAndroidClientID != "", "localEnabled": a.isDevelopment(), "googleStartUrl": "/api/auth/google/start"})
	case "/preview":
		writeProblem(w, problem(http.StatusServiceUnavailable, "preview-unavailable"))
	case "/catalog/search":
		value, err := a.searchCatalog(r.Context(), r.URL.Query())
		respond(w, value, err)
	case "/catalog/title":
		value, err := a.getTitle(r.Context(), r.URL.Query().Get("id"))
		respond(w, value, err)
	}
}

func (a *App) handleCoreRoute(ctx context.Context, r *http.Request, path string, principal Principal, body json.RawMessage) (any, error) {
	switch path {
	case "/library":
		if r.Method == http.MethodGet {
			return a.readLibrary(ctx, principal.UserID)
		}
	case "/progress":
		var command ProgressCommand
		if err := decodeBody(body, &command); err != nil {
			return nil, err
		}
		return a.applyProgress(ctx, principal, command)
	case "/library/edit":
		var command LibraryEditCommand
		if err := decodeBody(body, &command); err != nil {
			return nil, err
		}
		return a.editLibrary(ctx, principal, command)
	case "/progress/correct":
		var command CorrectionCommand
		if err := decodeBody(body, &command); err != nil {
			return nil, err
		}
		return a.correctProgress(ctx, principal, command)
	case "/social/follow":
		var input struct {
			TargetID  string `json:"targetId"`
			Following *bool  `json:"following"`
		}
		if err := decodeBody(body, &input); err != nil {
			return nil, err
		}
		if input.Following == nil {
			input.Following = new(bool)
			*input.Following = true
		}
		if err := a.follow(ctx, principal, input.TargetID, *input.Following); err != nil {
			return nil, err
		}
		return map[string]any{}, nil
	case "/social/status":
		if r.Method == http.MethodGet {
			return a.socialStatus(ctx, principal, r.URL.Query().Get("userId"))
		}
	case "/social/users":
		if r.Method == http.MethodGet {
			return a.discoverUsers(ctx, principal, r.URL.Query().Get("text"))
		}
	case "/social/friendship":
		var input struct {
			TargetID string `json:"targetId"`
			Action   string `json:"action"`
		}
		if err := decodeBody(body, &input); err != nil {
			return nil, err
		}
		if err := a.setFriendship(ctx, principal, input.TargetID, input.Action); err != nil {
			return nil, err
		}
		return map[string]any{}, nil
	case "/feed":
		if r.Method == http.MethodGet {
			return a.readFeed(ctx, principal, r.URL.Query())
		}
	case "/activity":
		if r.Method == http.MethodGet {
			return a.readActivity(ctx, viewerFromPrincipal(principal), r.URL.Query().Get("id"))
		}
	case "/showcase":
		if r.Method == http.MethodGet {
			return a.readShowcase(ctx, viewerFromPrincipal(principal), r.URL.Query().Get("userId"))
		}
		var input saveShowcaseInput
		if err := decodeBody(body, &input); err != nil {
			return nil, err
		}
		return a.saveShowcase(ctx, principal, input)
	case "/collection":
		if r.Method == http.MethodGet {
			return a.readCollection(ctx, viewerFromPrincipal(principal), r.URL.Query().Get("id"))
		}
		var input saveCollectionInput
		if err := decodeBody(body, &input); err != nil {
			return nil, err
		}
		return a.saveCollection(ctx, principal, input)
	case "/collections":
		if r.Method == http.MethodGet {
			return a.readCollections(ctx, viewerFromPrincipal(principal), r.URL.Query().Get("userId"))
		}
	case "/social/review/drafts":
		if r.Method == http.MethodGet {
			return a.readReviewDrafts(ctx, principal)
		}
	case "/social/review/draft":
		var input reviewDraftInput
		if err := decodeBody(body, &input); err != nil {
			return nil, err
		}
		return a.saveReviewDraft(ctx, principal, input)
	case "/social/review/publish":
		var input publishReviewInput
		if err := decodeBody(body, &input); err != nil {
			return nil, err
		}
		return a.publishReview(ctx, principal, input)
	case "/social/review/edit":
		var input reviewEditInput
		if err := decodeBody(body, &input); err != nil {
			return nil, err
		}
		return a.editReview(ctx, principal, input)
	case "/social/reply":
		var input addReplyInput
		if err := decodeBody(body, &input); err != nil {
			return nil, err
		}
		return a.addReply(ctx, principal, input)
	case "/social/replies":
		if r.Method == http.MethodGet {
			return a.readReplies(ctx, viewerFromPrincipal(principal), r.URL.Query().Get("activityId"))
		}
	case "/social/reply/edit":
		var input replyEditInput
		if err := decodeBody(body, &input); err != nil {
			return nil, err
		}
		return a.editReply(ctx, principal, input)
	case "/social/react":
		var input struct {
			ActivityID string `json:"activityId"`
			Liked      bool   `json:"liked"`
		}
		if err := decodeBody(body, &input); err != nil {
			return nil, err
		}
		if err := a.react(ctx, principal, input.ActivityID, input.Liked); err != nil {
			return nil, err
		}
		return map[string]any{}, nil
	case "/social/block":
		var input struct {
			TargetID string `json:"targetId"`
		}
		if err := decodeBody(body, &input); err != nil {
			return nil, err
		}
		if err := a.blockUser(ctx, principal, input.TargetID); err != nil {
			return nil, err
		}
		return map[string]any{}, nil
	case "/social/report":
		var input struct {
			TargetID string `json:"targetId"`
			Reason   string `json:"reason"`
			Note     string `json:"note,omitempty"`
		}
		if err := decodeBody(body, &input); err != nil {
			return nil, err
		}
		return a.reportContent(ctx, principal, input)
	case "/moderation":
		if r.Method == http.MethodGet {
			return a.moderation(ctx, principal)
		}
		var input struct {
			TargetID string `json:"targetId"`
			Action   string `json:"action"`
			Reason   string `json:"reason"`
		}
		if err := decodeBody(body, &input); err != nil {
			return nil, err
		}
		if err := a.moderate(ctx, principal, input); err != nil {
			return nil, err
		}
		return map[string]any{}, nil
	case "/social/circles":
		if r.Method == http.MethodGet {
			return a.readCircles(ctx, principal)
		}
		var input struct {
			ID        string   `json:"id"`
			Name      string   `json:"name"`
			MemberIDs []string `json:"memberIds"`
		}
		if err := decodeBody(body, &input); err != nil {
			return nil, err
		}
		return a.saveCircle(ctx, principal, input)
	case "/account/settings":
		if r.Method == http.MethodGet {
			return a.getSettings(ctx, principal)
		}
		var input map[string]json.RawMessage
		if err := decodeBody(body, &input); err != nil {
			return nil, err
		}
		return a.saveSettings(ctx, principal, input)
	case "/account/export":
		if r.Method == http.MethodPost {
			return a.createAccountExport(ctx, principal, r)
		}
	case "/account/download":
		if r.Method == http.MethodGet {
			return a.downloadAccountExport(ctx, principal, r.URL.Query().Get("id"))
		}
	case "/account/delete":
		if r.Method == http.MethodPost {
			return a.deleteAccount(ctx, principal)
		}
	case "/auth/logout", "/auth/me":
		return nil, notFound("route-not-found")
	}
	return nil, problem(http.StatusNotImplemented, "route-not-implemented")
}

func viewerFromPrincipal(p Principal) *string {
	if p.UserID == "" {
		return nil
	}
	return &p.UserID
}

func requestBody[T any](body json.RawMessage) (T, error) {
	var value T
	err := decodeBody(body, &value)
	return value, err
}

func contextHasDatabase(ctx context.Context, db *pgxpool.Pool) error {
	if db == nil {
		return problem(http.StatusServiceUnavailable, "database-unavailable")
	}
	if err := db.Ping(ctx); err != nil {
		return fmt.Errorf("database unavailable: %w", err)
	}
	return nil
}

func isNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }
