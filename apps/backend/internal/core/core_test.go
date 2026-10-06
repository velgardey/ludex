package core

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestUnknownRouteIsNotReportedAsSuccessful(t *testing.T) {
	app := New(nil, Config{Env: "development"})
	response := httptest.NewRecorder()
	app.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/not-a-route", nil))
	if response.Code != http.StatusNotFound {
		t.Fatalf("unknown route status = %d, want 404; body=%s", response.Code, response.Body.String())
	}
}

func TestLocalSignupIsDisabledOutsideDevelopment(t *testing.T) {
	app := New(nil, Config{Env: "production", InviteCode: "invite"})
	body := bytes.NewBufferString(`{"inviteCode":"invite","email":"a@example.test","password":"correct horse battery staple","displayName":"Alice"}`)
	response := httptest.NewRecorder()
	app.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/auth/signup", body))
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("production signup status = %d, want 503; body=%s", response.Code, response.Body.String())
	}
	var problem map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &problem); err != nil {
		t.Fatalf("response is not JSON: %v", err)
	}
	if problem["code"] != "local-auth-disabled" {
		t.Fatalf("problem code = %v, want local-auth-disabled", problem["code"])
	}
}

func TestGoogleStartKeepsInviteInServerState(t *testing.T) {
	pool := testDatabase(t)
	const invite = "shared-invite-secret"
	app := New(pool, Config{
		Env: "development", InviteCode: invite, GoogleWebClientID: "google-client",
		GoogleWebClientSecret: "google-secret", RedirectURI: "http://localhost:8080/api/auth/google/callback",
	})

	form := url.Values{"inviteCode": {invite}}.Encode()
	request := httptest.NewRequest(http.MethodPost, "/api/auth/google/start", strings.NewReader(form))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response := httptest.NewRecorder()
	app.ServeHTTP(response, request)
	if response.Code != http.StatusSeeOther {
		t.Fatalf("POST google start status = %d; body=%s", response.Code, response.Body.String())
	}
	location := response.Header().Get("Location")
	parsed, err := url.Parse(location)
	if err != nil || !strings.HasPrefix(location, "https://accounts.google.com/") || strings.Contains(location, invite) {
		t.Fatalf("Google redirect leaked invite or was invalid: %q (%v)", location, err)
	}
	state := parsed.Query().Get("state")
	var storedHash []byte
	if err := pool.QueryRow(t.Context(), `SELECT invite_code_hash FROM oauth_states WHERE state_hash=$1`, tokenHash(state)).Scan(&storedHash); err != nil {
		t.Fatalf("read stored OAuth invitation hash: %v", err)
	}
	if !bytes.Equal(storedHash, tokenHash(invite)) {
		t.Fatal("OAuth state did not store the invitation hash")
	}

	request = httptest.NewRequest(http.MethodGet, "/api/auth/google/start?inviteCode="+url.QueryEscape(invite), nil)
	response = httptest.NewRecorder()
	app.ServeHTTP(response, request)
	if response.Code != http.StatusSeeOther || strings.Contains(response.Header().Get("Location"), invite) {
		t.Fatalf("GET google start redirect = %d %q", response.Code, response.Header().Get("Location"))
	}
	parsed, err = url.Parse(response.Header().Get("Location"))
	if err != nil {
		t.Fatalf("parse GET Google redirect: %v", err)
	}
	var hasNoInvite bool
	if err := pool.QueryRow(t.Context(), `SELECT invite_code_hash IS NULL FROM oauth_states WHERE state_hash=$1`, tokenHash(parsed.Query().Get("state"))).Scan(&hasNoInvite); err != nil || !hasNoInvite {
		t.Fatalf("GET google start stored an invitation: null=%v error=%v", hasNoInvite, err)
	}

	claims := googleClaims{Issuer: googleIssuer, Subject: "new-google-user", Name: "New Google User"}
	if _, err := app.googleSession(t.Context(), claims, ""); err == nil {
		t.Fatal("new Google identity was created without a posted invitation")
	} else if status, code, _ := statusFor(err); status != http.StatusForbidden || code != "invitation-required" {
		t.Fatalf("missing-invite error = %d %s", status, code)
	}
	if _, err := app.googleSession(t.Context(), claims, invite); err != nil {
		t.Fatalf("create Google identity with invitation: %v", err)
	}
	if _, err := app.googleSession(t.Context(), claims, ""); err != nil {
		t.Fatalf("existing Google identity could not sign in without invitation: %v", err)
	}
}

func TestLocalSessionLifecyclePersistsAndRevokes(t *testing.T) {
	pool := testDatabase(t)
	app := New(pool, Config{Env: "development", InviteCode: "invite"})
	registered := signup(t, app, "session@example.test", "Session User")
	registeredID := userID(t, app, registered.Token)

	login := callJSON(t, app, http.MethodPost, "/api/auth/login", map[string]any{
		"email": "session@example.test", "password": "correct horse battery staple",
	}, "")
	if login.Code != http.StatusOK {
		t.Fatalf("login status = %d; body=%s", login.Code, login.Body.String())
	}
	var authenticated testSession
	if err := json.Unmarshal(login.Body.Bytes(), &authenticated); err != nil || authenticated.Token == "" {
		t.Fatalf("login session = %s (%v)", login.Body.String(), err)
	}
	if got := userID(t, app, authenticated.Token); got != registeredID {
		t.Fatalf("login resolved user %q; want %q", got, registeredID)
	}

	logout := callJSON(t, app, http.MethodPost, "/api/auth/logout", nil, authenticated.Token)
	if logout.Code != http.StatusOK {
		t.Fatalf("logout status = %d; body=%s", logout.Code, logout.Body.String())
	}
	revoked := callJSON(t, app, http.MethodGet, "/api/auth/me", nil, authenticated.Token)
	if revoked.Code != http.StatusUnauthorized {
		t.Fatalf("revoked session status = %d; body=%s", revoked.Code, revoked.Body.String())
	}
}

func TestCatalogSearchIsPublicAndCachesJSONBInExecMode(t *testing.T) {
	pool := testDatabase(t)
	want := CatalogHit{
		ID:          "catalog-cache-show",
		Media:       "show",
		Title:       "Cached Show",
		ProviderIDs: map[string]string{"tmdb": "42"},
		Episodes:    []Episode{{ID: "s1e1", Order: 1}},
	}
	movie := CatalogHit{ID: "catalog-cache-movie", Media: "movie", Title: "Cached Movie"}
	app := New(pool, Config{Env: "development", CatalogSearch: func(context.Context, string, string, string) ([]CatalogHit, error) {
		return []CatalogHit{want, movie}, nil
	}})
	response := callJSON(t, app, http.MethodGet, "/api/catalog/search?text=Cached", nil, "")
	if response.Code != http.StatusOK {
		t.Fatalf("anonymous catalog search status = %d; body=%s", response.Code, response.Body.String())
	}
	var results []CatalogHit
	if err := json.Unmarshal(response.Body.Bytes(), &results); err != nil || len(results) != 2 || results[0].ID != want.ID || results[1].ID != movie.ID {
		t.Fatalf("catalog search results = %s (%v)", response.Body.String(), err)
	}
	got, err := app.GetTitle(t.Context(), want.ID)
	if err != nil {
		t.Fatalf("load cached catalog title: %v", err)
	}
	if got.ID != want.ID || got.Media != want.Media || got.Title != want.Title || got.ProviderIDs["tmdb"] != "42" || len(got.Episodes) != 1 || got.Episodes[0].ID != "s1e1" {
		t.Fatalf("cached catalog title = %#v; want %#v", got, want)
	}
	got, err = app.GetTitle(t.Context(), movie.ID)
	if err != nil || got.ProviderIDs == nil || got.Episodes == nil {
		t.Fatalf("cached movie defaults = %#v, error = %v", got, err)
	}
}

func TestDiscoverUsersSearchWorksInPostgres(t *testing.T) {
	pool := testDatabase(t)
	app := New(pool, Config{Env: "development", InviteCode: "invite"})
	alice := signup(t, app, "alice-search@example.test", "Alice")
	_ = signup(t, app, "bob-search@example.test", "Bob")
	response := callJSON(t, app, http.MethodGet, "/api/social/users?text=Bob", nil, alice.Token)
	if response.Code != http.StatusOK {
		t.Fatalf("discover users status = %d; body=%s", response.Code, response.Body.String())
	}
	var users []map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &users); err != nil || len(users) != 1 || users[0]["displayName"] != "Bob" {
		t.Fatalf("discovered users = %s (%v)", response.Body.String(), err)
	}
}

func TestProgressReplayAndVisibilityPersistInPostgres(t *testing.T) {
	pool := testDatabase(t)
	app := New(pool, Config{Env: "development", InviteCode: "invite"})

	alice := signup(t, app, "alice@example.test", "Alice")
	bob := signup(t, app, "bob@example.test", "Bob")
	aliceID := userID(t, app, alice.Token)
	bobID := userID(t, app, bob.Token)
	seedTitle(t, pool, "show-1", "show")
	progress := map[string]any{
		"commandId": "progress-1", "titleId": "show-1", "baseVersion": 0,
		"change":     map[string]any{"kind": "episode-watched", "titleId": "show-1", "episodeId": "s1e1", "runId": "run-1"},
		"occurredAt": map[string]any{"precision": "day", "day": "2026-10-07"},
		"audience":   map[string]any{"kind": "public"},
		"spoiler":    map[string]any{"kind": "episodes", "showId": "show-1", "requiredEpisodeIds": []string{"s1e2"}},
	}
	first := callJSON(t, app, http.MethodPost, "/api/progress", progress, alice.Token)
	if first.Code != http.StatusOK {
		t.Fatalf("first progress status = %d; body=%s", first.Code, first.Body.String())
	}
	firstBody := decodeMap(t, first)
	if firstBody["status"] != "accepted" || firstBody["version"] != float64(1) {
		t.Fatalf("first progress result = %#v", firstBody)
	}
	replay := callJSON(t, app, http.MethodPost, "/api/v1/progress", progress, alice.Token)
	if replay.Code != http.StatusOK || decodeMap(t, replay)["eventId"] != firstBody["eventId"] {
		t.Fatalf("identical retry did not replay receipt: %d %s", replay.Code, replay.Body.String())
	}
	changed := cloneMap(progress)
	changed["note"] = "different payload"
	mismatch := callJSON(t, app, http.MethodPost, "/api/progress", changed, alice.Token)
	if mismatch.Code != http.StatusConflict {
		t.Fatalf("same command id with changed body status = %d; body=%s", mismatch.Code, mismatch.Body.String())
	}
	follow := callJSON(t, app, http.MethodPost, "/api/social/follow", map[string]any{"targetId": aliceID, "following": true}, bob.Token)
	if follow.Code != http.StatusOK {
		t.Fatalf("follow status = %d; body=%s", follow.Code, follow.Body.String())
	}
	status := callJSON(t, app, http.MethodGet, "/api/social/status?userId="+aliceID, nil, bob.Token)
	if got := decodeMap(t, status); status.Code != http.StatusOK || got["following"] != true || got["followers"] != float64(1) {
		t.Fatalf("social profile status = %d %#v", status.Code, got)
	}

	feed := callJSON(t, app, http.MethodGet, "/api/feed?filter=following", nil, bob.Token)
	items := decodeMap(t, feed)["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("public progress was not visible to another account: %#v", items)
	}
	activity := items[0].(map[string]any)
	if activity["detailHidden"] != true || activity["note"] != nil {
		t.Fatalf("unearned episode spoiler leaked: %#v", activity)
	}

	stale := cloneMap(progress)
	stale["commandId"] = "progress-stale"
	conflict := callJSON(t, app, http.MethodPost, "/api/progress", stale, alice.Token)
	if got := decodeMap(t, conflict); got["status"] != "conflict" || got["currentVersion"] != float64(1) {
		t.Fatalf("stale library version result = %#v", got)
	}
	correction := callJSON(t, app, http.MethodPost, "/api/progress/correct", map[string]any{
		"commandId": "correction-1", "eventId": firstBody["eventId"], "baseVersion": 1, "retract": true,
	}, alice.Token)
	if correction.Code != http.StatusOK {
		t.Fatalf("correction status = %d; body=%s", correction.Code, correction.Body.String())
	}
	if got := decodeMap(t, correction); got["status"] != "accepted" || got["version"] != float64(2) {
		t.Fatalf("correction result = %#v", got)
	}
	library := callJSON(t, app, http.MethodGet, "/api/library", nil, alice.Token)
	if library.Code != http.StatusOK {
		t.Fatalf("library status = %d; body=%s", library.Code, library.Body.String())
	}
	libraryItems := libraryValue(t, library)
	if len(libraryItems) != 1 || libraryItems[0]["state"] != "planned" || len(libraryItems[0]["runs"].([]any)) != 0 {
		t.Fatalf("retracted progress was not replayed out of library: %#v", libraryItems)
	}
	feed = callJSON(t, app, http.MethodGet, "/api/feed?filter=following", nil, bob.Token)
	if got := decodeMap(t, feed)["items"].([]any); len(got) != 0 {
		t.Fatalf("retracted progress remained in feed: %#v", got)
	}
	edit := callJSON(t, app, http.MethodPost, "/api/library/edit", map[string]any{
		"commandId": "edit-1", "titleId": "show-1", "baseVersion": 2,
		"patch": map[string]any{"rating": 9, "liked": true, "note": "A favorite"},
	}, alice.Token)
	if edit.Code != http.StatusOK {
		t.Fatalf("library edit status = %d; body=%s", edit.Code, edit.Body.String())
	}
	if got := decodeMap(t, edit); got["status"] != "accepted" || got["version"] != float64(3) {
		t.Fatalf("library edit result = %#v", got)
	}
	library = callJSON(t, app, http.MethodGet, "/api/library", nil, alice.Token)
	libraryItems = libraryValue(t, library)
	if len(libraryItems) != 1 || libraryItems[0]["rating"] != float64(9) || libraryItems[0]["liked"] != true || libraryItems[0]["note"] != "A favorite" {
		t.Fatalf("library edit did not persist fields: %#v", libraryItems)
	}
	showcase := callJSON(t, app, http.MethodPost, "/api/showcase", map[string]any{
		"commandId": "showcase-1", "baseVersion": 0,
		"showcase": map[string]any{"userId": aliceID, "version": 0, "theme": "midnight", "shelves": []any{
			map[string]any{"id": "shelf-1", "title": "Favorites", "layout": "covers", "itemIds": []string{"show-1"}, "audience": map[string]any{"kind": "public"}},
			map[string]any{"id": "shelf-2", "title": "Private notes", "layout": "spread", "itemIds": []string{"show-1"}, "audience": map[string]any{"kind": "private"}},
		}},
	}, alice.Token)
	if showcase.Code != http.StatusOK || decodeMap(t, showcase)["status"] != "accepted" {
		t.Fatalf("showcase save failed: %d %s", showcase.Code, showcase.Body.String())
	}
	showcaseRead := callJSON(t, app, http.MethodGet, "/api/v1/showcase?userId="+aliceID, nil, bob.Token)
	if got := decodeMap(t, showcaseRead); got["theme"] != "midnight" || len(got["shelves"].([]any)) != 1 {
		t.Fatalf("showcase did not persist for follower: %#v", got)
	}
	anonymousShowcase := callJSON(t, app, http.MethodGet, "/api/showcase?userId="+aliceID, nil, "")
	if got := decodeMap(t, anonymousShowcase); anonymousShowcase.Code != http.StatusOK || len(got["shelves"].([]any)) != 1 {
		t.Fatalf("anonymous showcase leaked private shelf: %d %#v", anonymousShowcase.Code, got)
	}
	ownerShowcase := callJSON(t, app, http.MethodGet, "/api/showcase?userId="+aliceID, nil, alice.Token)
	if got := decodeMap(t, ownerShowcase); len(got["shelves"].([]any)) != 2 {
		t.Fatalf("showcase owner did not retain private shelf: %#v", got)
	}
	collection := callJSON(t, app, http.MethodPost, "/api/collection", map[string]any{
		"commandId": "collection-1", "id": "00000000-0000-4000-8000-000000000001", "version": 0,
		"title": "Shared favorites", "titleIds": []string{"show-1"}, "audience": map[string]any{"kind": "public"},
	}, alice.Token)
	if collection.Code != http.StatusOK || decodeMap(t, collection)["status"] != "accepted" {
		t.Fatalf("collection save failed: %d %s", collection.Code, collection.Body.String())
	}
	collectionRead := callJSON(t, app, http.MethodGet, "/api/collection?id=00000000-0000-4000-8000-000000000001", nil, bob.Token)
	if got := decodeMap(t, collectionRead); got["title"] != "Shared favorites" || len(got["titleIds"].([]any)) != 1 {
		t.Fatalf("collection did not persist: %#v", got)
	}
	draft := callJSON(t, app, http.MethodPost, "/api/social/review/draft", map[string]any{
		"id": "draft-1", "titleId": "show-1", "text": "A thoughtful show", "version": 0, "rating": 9,
	}, alice.Token)
	if draft.Code != http.StatusOK || decodeMap(t, draft)["version"] != float64(1) {
		t.Fatalf("review draft save failed: %d %s", draft.Code, draft.Body.String())
	}
	published := callJSON(t, app, http.MethodPost, "/api/social/review/publish", map[string]any{
		"commandId": "review-1", "draftId": "draft-1", "baseVersion": 1,
		"audience": map[string]any{"kind": "public"}, "spoiler": map[string]any{"kind": "none"},
	}, alice.Token)
	if published.Code != http.StatusOK {
		t.Fatalf("review publish failed: %d %s", published.Code, published.Body.String())
	}
	reviewID := decodeMap(t, published)["activityId"].(string)
	review := callJSON(t, app, http.MethodGet, "/api/activity?id="+reviewID, nil, bob.Token)
	if got := decodeMap(t, review); got["note"] != "A thoughtful show" || got["rating"] != float64(9) {
		t.Fatalf("published review did not preserve draft: %#v", got)
	}
	reply := callJSON(t, app, http.MethodPost, "/api/social/reply", map[string]any{
		"commandId": "reply-1", "activityId": reviewID, "text": "I agree", "spoiler": map[string]any{"kind": "none"},
	}, bob.Token)
	if reply.Code != http.StatusOK {
		t.Fatalf("reply create failed: %d %s", reply.Code, reply.Body.String())
	}
	if decodeMap(t, reply)["replyId"] == nil {
		t.Fatalf("reply id missing: %s", reply.Body.String())
	}
	replies := callJSON(t, app, http.MethodGet, "/api/social/replies?activityId="+reviewID, nil, alice.Token)
	var replyItems []map[string]any
	if err := json.Unmarshal(replies.Body.Bytes(), &replyItems); err != nil || len(replyItems) != 1 || replyItems[0]["text"] != "I agree" || replyItems[0]["author"].(map[string]any)["id"] != bobID {
		t.Fatalf("reply did not persist: %s (%v)", replies.Body.String(), err)
	}
	reaction := callJSON(t, app, http.MethodPost, "/api/social/react", map[string]any{"activityId": reviewID, "liked": true}, bob.Token)
	if reaction.Code != http.StatusOK {
		t.Fatalf("reaction failed: %d %s", reaction.Code, reaction.Body.String())
	}
	review = callJSON(t, app, http.MethodGet, "/api/activity?id="+reviewID, nil, bob.Token)
	if got := decodeMap(t, review); got["reactionCount"] != float64(1) || got["likedByViewer"] != true {
		t.Fatalf("reaction was not reflected: %#v", got)
	}
	settings := callJSON(t, app, http.MethodPost, "/api/account/settings", map[string]any{
		"region": "GB", "timeZone": "Asia/Kolkata", "defaultAudience": "friends", "lowData": true,
		"notificationPreferences": map[string]bool{"directReplies": true},
	}, alice.Token)
	if settings.Code != http.StatusOK || decodeMap(t, settings)["region"] != "GB" {
		t.Fatalf("settings save failed: %d %s", settings.Code, settings.Body.String())
	}
	settingsRead := callJSON(t, app, http.MethodGet, "/api/account/settings", nil, alice.Token)
	if got := decodeMap(t, settingsRead); got["timeZone"] != "Asia/Kolkata" || got["lowData"] != true {
		t.Fatalf("settings did not persist: %#v", got)
	}
	block := callJSON(t, app, http.MethodPost, "/api/social/block", map[string]any{"targetId": aliceID}, bob.Token)
	if block.Code != http.StatusOK {
		t.Fatalf("block failed: %d %s", block.Code, block.Body.String())
	}
	blockedReview := callJSON(t, app, http.MethodGet, "/api/activity?id="+reviewID, nil, bob.Token)
	if blockedReview.Code != http.StatusNotFound {
		t.Fatalf("blocked activity status = %d; body=%s", blockedReview.Code, blockedReview.Body.String())
	}
}

type testSession struct {
	Token string `json:"token"`
}

func signup(t *testing.T, app http.Handler, email, displayName string) testSession {
	t.Helper()
	body := map[string]any{"inviteCode": "invite", "email": email, "password": "correct horse battery staple", "displayName": displayName}
	response := callJSON(t, app, http.MethodPost, "/api/auth/signup", body, "")
	if response.Code != http.StatusOK {
		t.Fatalf("signup %s status = %d; body=%s", email, response.Code, response.Body.String())
	}
	var session testSession
	if err := json.Unmarshal(response.Body.Bytes(), &session); err != nil {
		t.Fatalf("decode signup session: %v", err)
	}
	if session.Token == "" {
		t.Fatal("signup returned empty session token")
	}
	return session
}

func userID(t *testing.T, app http.Handler, token string) string {
	t.Helper()
	response := callJSON(t, app, http.MethodGet, "/api/auth/me", nil, token)
	if response.Code != http.StatusOK {
		t.Fatalf("auth/me status = %d; body=%s", response.Code, response.Body.String())
	}
	return decodeMap(t, response)["id"].(string)
}

func callJSON(t *testing.T, app http.Handler, method, target string, body any, token string) *httptest.ResponseRecorder {
	t.Helper()
	var payload *bytes.Buffer
	if body == nil {
		payload = bytes.NewBuffer(nil)
	} else {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal request: %v", err)
		}
		payload = bytes.NewBuffer(encoded)
	}
	request := httptest.NewRequest(method, target, payload)
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response := httptest.NewRecorder()
	app.ServeHTTP(response, request)
	return response
}

func decodeMap(t *testing.T, response *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var result map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode response %q: %v", response.Body.String(), err)
	}
	return result
}

func libraryValue(t *testing.T, response *httptest.ResponseRecorder) []map[string]any {
	t.Helper()
	var value []map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &value); err != nil {
		t.Fatalf("decode library %q: %v", response.Body.String(), err)
	}
	return value
}

func cloneMap(input map[string]any) map[string]any {
	copy := make(map[string]any, len(input))
	for key, value := range input {
		copy[key] = value
	}
	return copy
}

func testDatabase(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("LUDEX_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("LUDEX_TEST_DATABASE_URL is not set")
	}
	admin, err := pgxpool.New(t.Context(), url)
	if err != nil {
		t.Fatalf("connect integration database: %v", err)
	}
	schema := fmt.Sprintf("ludex_core_test_%d", time.Now().UnixNano())
	if _, err := admin.Exec(t.Context(), `CREATE SCHEMA "`+schema+`"`); err != nil {
		admin.Close()
		t.Fatalf("create isolated test schema: %v", err)
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		_, _ = admin.Exec(t.Context(), `DROP SCHEMA "`+schema+`" CASCADE`)
		admin.Close()
		t.Fatalf("parse LUDEX_TEST_DATABASE_URL: %v", err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeExec
	pool, err := pgxpool.NewWithConfig(t.Context(), cfg)
	if err != nil {
		_, _ = admin.Exec(t.Context(), `DROP SCHEMA "`+schema+`" CASCADE`)
		admin.Close()
		t.Fatalf("connect integration database: %v", err)
	}
	path := filepath.Join("..", "..", "db", "migrations", "001_core.sql")
	migration, err := os.ReadFile(path)
	if err != nil {
		pool.Close()
		_, _ = admin.Exec(t.Context(), `DROP SCHEMA "`+schema+`" CASCADE`)
		admin.Close()
		t.Fatalf("read migration %s: %v", path, err)
	}
	if _, err := pool.Exec(t.Context(), string(migration)); err != nil {
		pool.Close()
		_, _ = admin.Exec(t.Context(), `DROP SCHEMA "`+schema+`" CASCADE`)
		admin.Close()
		t.Fatalf("apply core migration: %v", err)
	}
	t.Cleanup(func() {
		pool.Close()
		if _, err := admin.Exec(context.Background(), `DROP SCHEMA "`+schema+`" CASCADE`); err != nil {
			t.Errorf("drop test schema: %v", err)
		}
		admin.Close()
	})
	return pool
}

func seedTitle(t *testing.T, pool *pgxpool.Pool, id, media string) {
	t.Helper()
	_, err := pool.Exec(t.Context(), `INSERT INTO titles (id, media, title, provider_ids, episodes) VALUES ($1, $2, $3, '{}'::jsonb, '[{"id":"s1e1","order":1},{"id":"s1e2","order":2}]'::jsonb) ON CONFLICT (id) DO NOTHING`, id, media, "Example")
	if err != nil {
		t.Fatalf("seed title: %v", err)
	}
}
