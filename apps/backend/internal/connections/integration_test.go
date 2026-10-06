package connections

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"ludex/backend/db"
	"ludex/backend/internal/jobs"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
)

func TestCaptureAndImportArePrivateReviewBeforeWrites(t *testing.T) {
	url := os.Getenv("LUDEX_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("PG required")
	}
	ctx := context.Background()
	a, e := pgxpool.New(ctx, url)
	if e != nil {
		t.Fatal(e)
	}
	defer a.Close()
	s := "conn_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	a.Exec(ctx, "CREATE SCHEMA "+s)
	defer a.Exec(ctx, "DROP SCHEMA "+s+" CASCADE")
	cfg, _ := pgxpool.ParseConfig(url)
	cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeExec
	cfg.ConnConfig.StatementCacheCapacity = 0
	cfg.ConnConfig.RuntimeParams["search_path"] = s
	p, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer p.Close()
	if e = db.Migrate(ctx, p); e != nil {
		t.Fatal(e)
	}
	writes := 0
	h := New(p, Config{ResolveUser: func(r *http.Request) (string, error) { return r.Header.Get("X-User"), nil }, Search: func(context.Context, string, string, string) ([]Match, error) {
		return []Match{{ID: "tmdb:movie:438631", Title: "Dune", Year: 2021, Media: "movie"}}, nil
	}, ApplyProgress: func(context.Context, string, json.RawMessage) (json.RawMessage, error) {
		writes++
		return json.RawMessage(`{"status":"accepted"}`), nil
	}})
	r := httptest.NewRequest("POST", "/api/imports/preview", strings.NewReader(`{"source":"letterboxd","csv":"Name,Year,Rating\nDune,2021,4.5\n"}`))
	r.Header.Set("X-User", "alice")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 201 || writes != 0 {
		t.Fatalf("preview changed progress %d %s", w.Code, w.Body.String())
	}
	r = httptest.NewRequest("GET", "/api/imports", nil)
	r.Header.Set("X-User", "eve")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Body.String() != "[]\n" {
		t.Fatal("import leaked to other user")
	}
}

func TestImportCommitQueuesRowsAndPersistsIdempotentOutcomes(t *testing.T) {
	p := testConnectionsDB(t)
	ctx := context.Background()
	var calls []map[string]any
	var edits []map[string]any
	versions := map[string]int64{"tmdb:movie:1": 2, "tmdb:show:2": 3, "igdb:game:3": 4}
	h := New(p, Config{
		ResolveUser: func(r *http.Request) (string, error) { return r.Header.Get("X-User"), nil },
		Search: func(_ context.Context, title, media, _ string) ([]Match, error) {
			ids := map[string]string{"movie": "tmdb:movie:1", "show": "tmdb:show:2", "game": "igdb:game:3"}
			return []Match{{ID: ids[media], Title: title, Media: media}}, nil
		},
		LoadVersion: func(_ context.Context, _ string, titleID string) (int64, error) { return versions[titleID], nil },
		ApplyProgress: func(_ context.Context, _ string, raw json.RawMessage) (json.RawMessage, error) {
			var command map[string]any
			if err := json.Unmarshal(raw, &command); err != nil {
				t.Fatal(err)
			}
			calls = append(calls, command)
			return json.RawMessage(`{"status":"accepted"}`), nil
		},
		ApplyLibrary: func(_ context.Context, _ string, raw json.RawMessage) (json.RawMessage, error) {
			var command map[string]any
			if err := json.Unmarshal(raw, &command); err != nil {
				t.Fatal(err)
			}
			edits = append(edits, command)
			return json.RawMessage(`{"status":"accepted"}`), nil
		},
	})
	preview := callConnections(t, h, "alice", http.MethodPost, "/api/imports/preview", map[string]any{
		"source": "csv",
		"csv":    "title,media,episode_id,played_on,emulator\nDune,movie,,2024-01-02,\nBluey,show,bluey:s1:e1,,\nHades,game,,,Steam Deck\n",
	})
	if preview.Code != http.StatusCreated {
		t.Fatalf("preview failed: %d %s", preview.Code, preview.Body.String())
	}
	var previewBody struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(preview.Body.Bytes(), &previewBody); err != nil {
		t.Fatal(err)
	}
	queued := callConnections(t, h, "alice", http.MethodPost, "/api/imports/"+previewBody.ID+"/commit", map[string]any{})
	if queued.Code != http.StatusAccepted {
		t.Fatalf("commit did not queue: %d %s", queued.Code, queued.Body.String())
	}
	var queuedBody struct {
		JobID   string `json:"jobId"`
		Status  string `json:"status"`
		PollURL string `json:"pollUrl"`
	}
	if err := json.Unmarshal(queued.Body.Bytes(), &queuedBody); err != nil {
		t.Fatal(err)
	}
	if queuedBody.JobID == "" || queuedBody.Status != "queued" || queuedBody.PollURL != "/api/imports/jobs/"+queuedBody.JobID {
		t.Fatalf("unexpected queued response: %s", queued.Body.String())
	}
	if done, err := jobs.Run(ctx, p, h.WorkHandlers(), 10); err != nil || done != 1 {
		t.Fatalf("worker pass = %d, %v; want one completed job", done, err)
	}
	if len(calls) != 2 || len(edits) != 1 {
		t.Fatalf("progress calls = %d, library edits = %d; want dated movie, show episode, and undated game state", len(calls), len(edits))
	}
	want := map[string]string{"tmdb:movie:1": "movie-viewed", "tmdb:show:2": "episode-watched"}
	for _, call := range calls {
		titleID := call["titleId"].(string)
		change := call["change"].(map[string]any)
		if change["kind"] != want[titleID] || call["baseVersion"] != float64(versions[titleID]) {
			t.Errorf("wrong progress command for %s: %#v", titleID, call)
		}
	}
	for _, call := range calls {
		if call["titleId"] == "tmdb:show:2" && call["change"].(map[string]any)["episodeId"] != "bluey:s1:e1" {
			t.Errorf("show episode id missing: %#v", call)
		}
	}
	if len(edits) != 1 || edits[0]["titleId"] != "igdb:game:3" || edits[0]["patch"].(map[string]any)["state"] != "planned" || edits[0]["patch"].(map[string]any)["emulator"] != "Steam Deck" {
		t.Fatalf("undated game was not preserved as a planned library edit: %#v", edits)
	}
	status := callConnections(t, h, "alice", http.MethodGet, queuedBody.PollURL, nil)
	if status.Code != http.StatusOK {
		t.Fatalf("job status failed: %d %s", status.Code, status.Body.String())
	}
	privateStatus := callConnections(t, h, "bob", http.MethodGet, queuedBody.PollURL, nil)
	if privateStatus.Code != http.StatusNotFound {
		t.Fatalf("job status was not owner-scoped: %d %s", privateStatus.Code, privateStatus.Body.String())
	}
	var result struct {
		Status    string      `json:"status"`
		Accepted  int         `json:"accepted"`
		Remaining int         `json:"remaining"`
		Rows      []ImportRow `json:"rows"`
	}
	if err := json.Unmarshal(status.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Status != "completed" || result.Accepted != 3 || result.Remaining != 0 || len(result.Rows) != 3 {
		t.Fatalf("wrong job status result: %s", status.Body.String())
	}
	if err := h.WorkHandlers()["import-commit"](ctx, jobs.Job{UserID: "alice", Payload: json.RawMessage(`{"batchId":"` + previewBody.ID + `"}`)}); err != nil {
		t.Fatal(err)
	}
	if len(calls) != 2 || len(edits) != 1 {
		t.Fatalf("retry recorded duplicate progress: %d calls", len(calls))
	}
}

func TestObservationRequiresOwnerConfirmationAndIsIdempotent(t *testing.T) {
	p := testConnectionsDB(t)
	var calls int
	h := New(p, Config{
		ResolveUser: func(r *http.Request) (string, error) { return r.Header.Get("X-User"), nil },
		LoadVersion: func(context.Context, string, string) (int64, error) { return 7, nil },
		ApplyProgress: func(_ context.Context, _ string, raw json.RawMessage) (json.RawMessage, error) {
			calls++
			var command map[string]any
			if err := json.Unmarshal(raw, &command); err != nil {
				t.Fatal(err)
			}
			if command["baseVersion"] != float64(7) {
				t.Errorf("confirmation used wrong library version: %#v", command)
			}
			return json.RawMessage(`{"status":"accepted"}`), nil
		},
	})
	captured := callConnections(t, h, "alice", http.MethodPost, "/api/connections/capture", map[string]any{"title": "Dune", "url": "https://netflix.example/title/1", "observationId": "capture-1"})
	if captured.Code != http.StatusAccepted || calls != 0 {
		t.Fatalf("capture applied progress: %d calls, response %s", calls, captured.Body.String())
	}
	var captureBody struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(captured.Body.Bytes(), &captureBody); err != nil {
		t.Fatal(err)
	}
	recaptured := callConnections(t, h, "alice", http.MethodPost, "/api/connections/capture", map[string]any{"title": "Dune", "url": "https://netflix.example/title/1", "observationId": "capture-1"})
	var recapturedBody struct {
		ID string `json:"id"`
	}
	if recaptured.Code != http.StatusAccepted || json.Unmarshal(recaptured.Body.Bytes(), &recapturedBody) != nil || recapturedBody.ID != captureBody.ID {
		t.Fatalf("duplicate capture did not return the original observation: %d %s", recaptured.Code, recaptured.Body.String())
	}
	wrongOwner := callConnections(t, h, "bob", http.MethodPost, "/api/connections/observations/"+captureBody.ID+"/confirm", map[string]any{"titleId": "tmdb:movie:1", "media": "movie"})
	if wrongOwner.Code != http.StatusNotFound || calls != 0 {
		t.Fatalf("observation was not owner-scoped: %d %s", wrongOwner.Code, wrongOwner.Body.String())
	}
	confirmed := callConnections(t, h, "alice", http.MethodPost, "/api/connections/observations/"+captureBody.ID+"/confirm", map[string]any{"titleId": "tmdb:movie:1", "media": "movie"})
	if confirmed.Code != http.StatusOK || calls != 1 {
		t.Fatalf("explicit confirmation failed: %d calls, %s", calls, confirmed.Body.String())
	}
	confirmed = callConnections(t, h, "alice", http.MethodPost, "/api/connections/observations/"+captureBody.ID+"/confirm", map[string]any{"titleId": "tmdb:movie:1", "media": "movie"})
	if confirmed.Code != http.StatusOK || calls != 1 {
		t.Fatalf("confirmation retry duplicated progress: %d calls, %s", calls, confirmed.Body.String())
	}
}

func TestShowImportUsesLibraryEditAndRequiresEpisodeIdentityForEpisodeClaims(t *testing.T) {
	p := testConnectionsDB(t)
	ctx := context.Background()
	var edits []map[string]any
	h := New(p, Config{
		ResolveUser: func(r *http.Request) (string, error) { return r.Header.Get("X-User"), nil },
		Search: func(_ context.Context, title, media, _ string) ([]Match, error) {
			return []Match{{ID: "tmdb:show:" + strings.ReplaceAll(strings.ToLower(title), " ", "-"), Title: title, Media: media}}, nil
		},
		LoadVersion: func(context.Context, string, string) (int64, error) { return 4, nil },
		ApplyLibrary: func(_ context.Context, _ string, raw json.RawMessage) (json.RawMessage, error) {
			var command map[string]any
			if err := json.Unmarshal(raw, &command); err != nil {
				t.Fatal(err)
			}
			edits = append(edits, command)
			return json.RawMessage(`{"status":"accepted"}`), nil
		},
	})
	preview := callConnections(t, h, "alice", http.MethodPost, "/api/imports/preview", map[string]any{
		"source": "csv",
		"csv":    "title,media,rating,note,episode\nPlanets,show,8,Great series,\nThe Ocean,show,9,Episode note,Blue Planet\n",
	})
	var body struct {
		ID string `json:"id"`
	}
	if preview.Code != http.StatusCreated || json.Unmarshal(preview.Body.Bytes(), &body) != nil {
		t.Fatalf("show preview failed: %d %s", preview.Code, preview.Body.String())
	}
	queued := callConnections(t, h, "alice", http.MethodPost, "/api/imports/"+body.ID+"/commit", map[string]any{})
	var queuedBody struct {
		JobID   string `json:"jobId"`
		PollURL string `json:"pollUrl"`
	}
	if queued.Code != http.StatusAccepted || json.Unmarshal(queued.Body.Bytes(), &queuedBody) != nil {
		t.Fatalf("show import did not queue: %d %s", queued.Code, queued.Body.String())
	}
	if done, err := jobs.Run(ctx, p, h.WorkHandlers(), 10); err != nil || done != 1 {
		t.Fatalf("worker pass = %d, %v", done, err)
	}
	if len(edits) != 1 {
		t.Fatalf("library edits = %d, want one title-level show update", len(edits))
	}
	patch := edits[0]["patch"].(map[string]any)
	if edits[0]["baseVersion"] != float64(4) || patch["state"] != "active" || patch["rating"] != float64(8) || patch["note"] != "Great series" {
		t.Fatalf("show library patch was not faithful: %#v", edits[0])
	}
	status := callConnections(t, h, "alice", http.MethodGet, queuedBody.PollURL, nil)
	var result struct {
		Status    string      `json:"status"`
		Accepted  int         `json:"accepted"`
		Remaining int         `json:"remaining"`
		Rows      []ImportRow `json:"rows"`
	}
	if json.Unmarshal(status.Body.Bytes(), &result) != nil {
		t.Fatal(status.Body.String())
	}
	if result.Status != "partial" || result.Accepted != 1 || result.Remaining != 1 || result.Rows[1].Status != "needs-episode" {
		t.Fatalf("show episode claim did not require an episode ID: %s", status.Body.String())
	}
}

func TestImportCanResolveUnmatchedRowsAfterTheAutomaticMatchWindow(t *testing.T) {
	p := testConnectionsDB(t)
	var progressCalls int
	h := New(p, Config{
		ResolveUser: func(r *http.Request) (string, error) { return r.Header.Get("X-User"), nil },
		Search: func(_ context.Context, title, media, _ string) ([]Match, error) {
			return []Match{{ID: "tmdb:movie:" + strings.ReplaceAll(strings.ToLower(title), " ", "-"), Title: title, Media: media}}, nil
		},
		LoadVersion: func(context.Context, string, string) (int64, error) { return 0, nil },
		ApplyProgress: func(context.Context, string, json.RawMessage) (json.RawMessage, error) {
			progressCalls++
			return json.RawMessage(`{"status":"accepted"}`), nil
		},
	})
	var csv strings.Builder
	csv.WriteString("title,media,date\n")
	for i := 0; i < 51; i++ {
		csv.WriteString("Film ")
		csv.WriteString(strconv.Itoa(i))
		csv.WriteString(",movie,2024-01-01\n")
	}
	preview := callConnections(t, h, "alice", http.MethodPost, "/api/imports/preview", map[string]any{"source": "csv", "csv": csv.String()})
	var previewBody struct {
		ID   string      `json:"id"`
		Rows []ImportRow `json:"rows"`
	}
	if preview.Code != http.StatusCreated || json.Unmarshal(preview.Body.Bytes(), &previewBody) != nil || len(previewBody.Rows) != 51 {
		t.Fatalf("large preview failed: %d %s", preview.Code, preview.Body.String())
	}
	row := previewBody.Rows[50]
	if row.Status != "needs-match" {
		t.Fatalf("row beyond automatic match window = %q, want needs-match", row.Status)
	}
	matched := callConnections(t, h, "alice", http.MethodPost,
		"/api/imports/"+previewBody.ID+"/rows/"+row.ID+"/match", map[string]any{"titleId": "tmdb:movie:51"})
	var matchedBody struct {
		ID             string `json:"id"`
		Status         string `json:"status"`
		MatchedTitleID string `json:"matchedTitleId"`
	}
	if matched.Code != http.StatusOK || json.Unmarshal(matched.Body.Bytes(), &matchedBody) != nil || matchedBody.ID != row.ID || matchedBody.Status != "matched" || matchedBody.MatchedTitleID != "tmdb:movie:51" {
		t.Fatalf("manual match failed: %d %s", matched.Code, matched.Body.String())
	}
	otherOwner := callConnections(t, h, "bob", http.MethodPost,
		"/api/imports/"+previewBody.ID+"/rows/"+row.ID+"/match", map[string]any{"titleId": "tmdb:movie:owned-by-bob"})
	if otherOwner.Code != http.StatusNotFound {
		t.Fatalf("manual match was not owner-scoped: %d %s", otherOwner.Code, otherOwner.Body.String())
	}
	queued := callConnections(t, h, "alice", http.MethodPost, "/api/imports/"+previewBody.ID+"/commit", map[string]any{})
	var queuedBody struct {
		JobID string `json:"jobId"`
	}
	if queued.Code != http.StatusAccepted || json.Unmarshal(queued.Body.Bytes(), &queuedBody) != nil {
		t.Fatalf("resolved batch did not queue: %d %s", queued.Code, queued.Body.String())
	}
	if done, err := jobs.Run(context.Background(), p, h.WorkHandlers(), 10); err != nil || done != 1 {
		t.Fatalf("worker pass = %d, %v", done, err)
	}
	if progressCalls != 51 {
		t.Fatalf("progress calls = %d, want all 51 reviewed rows", progressCalls)
	}
}

func TestImportMatchCanResolveAShowEpisodeAfterCatalogValidation(t *testing.T) {
	p := testConnectionsDB(t)
	var progress []map[string]any
	h := New(p, Config{
		ResolveUser: func(r *http.Request) (string, error) { return r.Header.Get("X-User"), nil },
		Search: func(_ context.Context, title, media, _ string) ([]Match, error) {
			return []Match{{ID: "tmdb:show:101", Title: title, Media: media}}, nil
		},
		LoadVersion: func(context.Context, string, string) (int64, error) { return 0, nil },
		EpisodeExists: func(_ context.Context, titleID, episodeID string) (bool, error) {
			return titleID == "tmdb:show:101" && episodeID == "tmdb:episode:91", nil
		},
		ApplyProgress: func(_ context.Context, _ string, raw json.RawMessage) (json.RawMessage, error) {
			var command map[string]any
			if err := json.Unmarshal(raw, &command); err != nil {
				t.Fatal(err)
			}
			progress = append(progress, command)
			return json.RawMessage(`{"status":"accepted"}`), nil
		},
	})
	preview := callConnections(t, h, "alice", http.MethodPost, "/api/imports/preview", map[string]any{
		"source": "csv",
		"csv":    "title,media,state,episode\n" + "The Series,show,completed,Episode One\n",
	})
	var previewBody struct {
		ID string `json:"id"`
	}
	if preview.Code != http.StatusCreated || json.Unmarshal(preview.Body.Bytes(), &previewBody) != nil {
		t.Fatalf("preview failed: %d %s", preview.Code, preview.Body.String())
	}
	queueAndRun := func() {
		t.Helper()
		queued := callConnections(t, h, "alice", http.MethodPost, "/api/imports/"+previewBody.ID+"/commit", map[string]any{})
		if queued.Code != http.StatusAccepted {
			t.Fatalf("commit did not queue: %d %s", queued.Code, queued.Body.String())
		}
		if done, err := jobs.Run(context.Background(), p, h.WorkHandlers(), 10); err != nil || done != 1 {
			t.Fatalf("worker pass = %d, %v", done, err)
		}
	}
	queueAndRun()
	// Re-read the batch through the owner-scoped job poll URL to obtain its row ID.
	var jobID string
	if err := p.QueryRow(context.Background(), `SELECT id FROM work_jobs WHERE user_id='alice' AND kind='import-commit' ORDER BY created_at DESC LIMIT 1`).Scan(&jobID); err != nil {
		t.Fatal(err)
	}
	status := callConnections(t, h, "alice", http.MethodGet, "/api/imports/jobs/"+jobID, nil)
	var statusBody struct {
		Rows []ImportRow `json:"rows"`
	}
	if status.Code != http.StatusOK || json.Unmarshal(status.Body.Bytes(), &statusBody) != nil || len(statusBody.Rows) != 1 || statusBody.Rows[0].Status != "needs-episode" {
		t.Fatalf("missing episode did not wait for review: %d %s", status.Code, status.Body.String())
	}
	row := statusBody.Rows[0]
	invalid := callConnections(t, h, "alice", http.MethodPost,
		"/api/imports/"+previewBody.ID+"/rows/"+row.ID+"/match", map[string]any{"episodeId": "tmdb:episode:404"})
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("unknown episode was accepted: %d %s", invalid.Code, invalid.Body.String())
	}
	matched := callConnections(t, h, "alice", http.MethodPost,
		"/api/imports/"+previewBody.ID+"/rows/"+row.ID+"/match", map[string]any{"episodeId": "tmdb:episode:91"})
	if matched.Code != http.StatusOK {
		t.Fatalf("known episode could not be selected: %d %s", matched.Code, matched.Body.String())
	}
	queueAndRun()
	if len(progress) != 1 {
		t.Fatalf("progress calls = %d, want one explicit episode event", len(progress))
	}
	change := progress[0]["change"].(map[string]any)
	if change["kind"] != "episode-watched" || change["episodeId"] != "tmdb:episode:91" {
		t.Fatalf("episode ID was not carried into explicit progress: %#v", progress[0])
	}
}

func TestMovieAndGameImportUsesLibraryStateForStatusAndProgressOnlyForDatedRows(t *testing.T) {
	p := testConnectionsDB(t)
	var edits []map[string]any
	var progress []map[string]any
	h := New(p, Config{
		ResolveUser: func(r *http.Request) (string, error) { return r.Header.Get("X-User"), nil },
		Search: func(_ context.Context, title, media, _ string) ([]Match, error) {
			return []Match{{ID: "fixture:" + media + ":" + strings.ReplaceAll(strings.ToLower(title), " ", "-"), Title: title, Media: media}}, nil
		},
		LoadVersion: func(context.Context, string, string) (int64, error) { return 0, nil },
		ApplyLibrary: func(_ context.Context, _ string, raw json.RawMessage) (json.RawMessage, error) {
			var command map[string]any
			if err := json.Unmarshal(raw, &command); err != nil {
				t.Fatal(err)
			}
			edits = append(edits, command)
			return json.RawMessage(`{"status":"accepted"}`), nil
		},
		ApplyProgress: func(_ context.Context, _ string, raw json.RawMessage) (json.RawMessage, error) {
			var command map[string]any
			if err := json.Unmarshal(raw, &command); err != nil {
				t.Fatal(err)
			}
			progress = append(progress, command)
			return json.RawMessage(`{"status":"accepted"}`), nil
		},
	})
	preview := callConnections(t, h, "alice", http.MethodPost, "/api/imports/preview", map[string]any{
		"source": "csv",
		"csv": "title,media,state,date,played_on,rating,note,emulator\n" +
			"Dropped Film,movie,dropped,, ,,,\n" +
			"Paused Game,game,paused,2023-02-03,2023-02-03,7,Keep this,Steam Deck\n" +
			"Dated Film,movie,,2024-04-05,,,,\n" +
			"Dated Game,game,,,2024-05-06,,,Steam Deck\n" +
			"Unspecified Film,movie,,,,,,\n",
	})
	var previewBody struct {
		ID string `json:"id"`
	}
	if preview.Code != http.StatusCreated || json.Unmarshal(preview.Body.Bytes(), &previewBody) != nil {
		t.Fatalf("preview failed: %d %s", preview.Code, preview.Body.String())
	}
	queued := callConnections(t, h, "alice", http.MethodPost, "/api/imports/"+previewBody.ID+"/commit", map[string]any{})
	var queuedBody struct {
		JobID string `json:"jobId"`
	}
	if queued.Code != http.StatusAccepted || json.Unmarshal(queued.Body.Bytes(), &queuedBody) != nil {
		t.Fatalf("commit did not queue: %d %s", queued.Code, queued.Body.String())
	}
	if done, err := jobs.Run(context.Background(), p, h.WorkHandlers(), 10); err != nil || done != 1 {
		t.Fatalf("worker pass = %d, %v", done, err)
	}
	if len(edits) != 3 {
		t.Fatalf("library edits = %d, want explicit movie/game states and one undated title", len(edits))
	}
	patches := map[string]map[string]any{}
	for _, edit := range edits {
		patches[edit["titleId"].(string)] = edit["patch"].(map[string]any)
	}
	if patches["fixture:movie:dropped-film"]["state"] != "dropped" || patches["fixture:game:paused-game"]["state"] != "paused" {
		t.Fatalf("explicit states were not preserved through library edits: %#v", patches)
	}
	if patches["fixture:movie:unspecified-film"]["state"] != "planned" {
		t.Fatalf("undated unclassified title was not kept planned: %#v", patches)
	}
	if patches["fixture:game:paused-game"]["rating"] != float64(7) || patches["fixture:game:paused-game"]["note"] != "Keep this" || patches["fixture:game:paused-game"]["playedOn"] != "2023-02-03" || patches["fixture:game:paused-game"]["emulator"] != "Steam Deck" {
		t.Fatalf("game metadata was not retained by the state edit: %#v", patches)
	}
	if len(progress) != 2 {
		t.Fatalf("progress events = %d, want only the two dated rows without explicit state", len(progress))
	}
	kinds := map[string]string{}
	for _, command := range progress {
		change := command["change"].(map[string]any)
		kinds[command["titleId"].(string)] = change["kind"].(string)
	}
	if kinds["fixture:movie:dated-film"] != "movie-viewed" || kinds["fixture:game:dated-game"] != "game-session" {
		t.Fatalf("dated progress kinds were incorrect: %#v", kinds)
	}
}

func TestFailedImportRowCanBeRetriedFromPartialBatchWithSameCommandID(t *testing.T) {
	p := testConnectionsDB(t)
	var calls []map[string]any
	h := New(p, Config{
		ResolveUser: func(r *http.Request) (string, error) { return r.Header.Get("X-User"), nil },
		Search: func(_ context.Context, title, media, _ string) ([]Match, error) {
			return []Match{{ID: "tmdb:movie:1984", Title: title, Media: media, Year: 1984}}, nil
		},
		LoadVersion: func(context.Context, string, string) (int64, error) { return 0, nil },
		ApplyProgress: func(_ context.Context, _ string, raw json.RawMessage) (json.RawMessage, error) {
			var command map[string]any
			if err := json.Unmarshal(raw, &command); err != nil {
				t.Fatal(err)
			}
			calls = append(calls, command)
			if len(calls) == 1 {
				return nil, errors.New("catalog provider unavailable")
			}
			return json.RawMessage(`{"status":"accepted"}`), nil
		},
	})
	preview := callConnections(t, h, "alice", http.MethodPost, "/api/imports/preview", map[string]any{
		"source": "letterboxd",
		"csv":    "Name,Year,Watched Date\nDune,1984,2026-10-05\n",
	})
	var previewBody struct {
		ID string `json:"id"`
	}
	if preview.Code != http.StatusCreated || json.Unmarshal(preview.Body.Bytes(), &previewBody) != nil {
		t.Fatalf("preview failed: %d %s", preview.Code, preview.Body.String())
	}
	runCommit := func() string {
		t.Helper()
		queued := callConnections(t, h, "alice", http.MethodPost, "/api/imports/"+previewBody.ID+"/commit", map[string]any{})
		var body struct {
			JobID   string `json:"jobId"`
			PollURL string `json:"pollUrl"`
		}
		if queued.Code != http.StatusAccepted || json.Unmarshal(queued.Body.Bytes(), &body) != nil {
			t.Fatalf("commit did not queue: %d %s", queued.Code, queued.Body.String())
		}
		if done, err := jobs.Run(context.Background(), p, h.WorkHandlers(), 10); err != nil || done != 1 {
			t.Fatalf("worker pass = %d, %v", done, err)
		}
		return body.PollURL
	}
	firstPoll := runCommit()
	firstStatus := callConnections(t, h, "alice", http.MethodGet, firstPoll, nil)
	var firstBody struct {
		Status string      `json:"status"`
		Rows   []ImportRow `json:"rows"`
	}
	if firstStatus.Code != http.StatusOK || json.Unmarshal(firstStatus.Body.Bytes(), &firstBody) != nil || firstBody.Status != "partial" || len(firstBody.Rows) != 1 || firstBody.Rows[0].Status != "failed" {
		t.Fatalf("transient failure was not exposed as a retryable partial row: %d %s", firstStatus.Code, firstStatus.Body.String())
	}
	secondPoll := runCommit()
	secondStatus := callConnections(t, h, "alice", http.MethodGet, secondPoll, nil)
	var secondBody struct {
		Status   string      `json:"status"`
		Accepted int         `json:"accepted"`
		Rows     []ImportRow `json:"rows"`
	}
	if secondStatus.Code != http.StatusOK || json.Unmarshal(secondStatus.Body.Bytes(), &secondBody) != nil || secondBody.Status != "completed" || secondBody.Accepted != 1 || len(secondBody.Rows) != 1 || secondBody.Rows[0].Status != "accepted" {
		t.Fatalf("partial batch retry did not accept the row: %d %s", secondStatus.Code, secondStatus.Body.String())
	}
	if len(calls) != 2 || calls[0]["commandId"] != calls[1]["commandId"] {
		t.Fatalf("retry did not reuse the stable command identity: %#v", calls)
	}
}

func TestSteamCapabilitySeparatesConfiguredFromSupported(t *testing.T) {
	p := testConnectionsDB(t)
	h := New(p, Config{ResolveUser: func(r *http.Request) (string, error) { return r.Header.Get("X-User"), nil }, SteamKey: "configured-secret"})
	res := callConnections(t, h, "alice", http.MethodGet, "/api/connections", nil)
	var body struct {
		Capabilities struct {
			Steam struct {
				Configured    bool `json:"configured"`
				Supported     bool `json:"supported"`
				AccountLinked bool `json:"accountLinked"`
			} `json:"steam"`
		} `json:"capabilities"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !body.Capabilities.Steam.Configured || !body.Capabilities.Steam.Supported || body.Capabilities.Steam.AccountLinked {
		t.Fatalf("Steam capability overclaimed support or linking: %s", res.Body.String())
	}
}

func TestManualSteamImportCreatesReviewAndConfirmsOwnership(t *testing.T) {
	p := testConnectionsDB(t)
	steam := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"response":{"game_count":1,"games":[{"appid":570,"name":"Dota 2","playtime_forever":120}]}}`))
	}))
	defer steam.Close()
	var edits, searches int
	h := New(p, Config{
		ResolveUser: func(r *http.Request) (string, error) { return r.Header.Get("X-User"), nil },
		SteamKey:    "configured", SteamBaseURL: steam.URL, SteamHTTP: steam.Client(),
		Search: func(context.Context, string, string, string) ([]Match, error) {
			searches++
			return []Match{{ID: "igdb:game:570", Title: "Dota 2", Media: "game"}}, nil
		},
		LoadVersion: func(context.Context, string, string) (int64, error) { return 2, nil },
		ApplyLibrary: func(_ context.Context, _ string, raw json.RawMessage) (json.RawMessage, error) {
			var command map[string]any
			if err := json.Unmarshal(raw, &command); err != nil {
				t.Fatal(err)
			}
			patch := command["patch"].(map[string]any)
			if patch["owned"] != true {
				t.Errorf("Steam confirmation did not set owned: %#v", command)
			}
			edits++
			return json.RawMessage(`{"status":"accepted"}`), nil
		},
	})
	preview := callConnections(t, h, "alice", http.MethodPost, "/api/connections/steam/preview", map[string]any{"steamId64": "76561198000000000"})
	var previewBody struct {
		AccountLinked bool `json:"accountLinked"`
		Truncated     bool `json:"truncated"`
		Observations  []struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		} `json:"observations"`
	}
	if preview.Code != http.StatusOK || json.Unmarshal(preview.Body.Bytes(), &previewBody) != nil || previewBody.AccountLinked || len(previewBody.Observations) != 1 || previewBody.Observations[0].Status != "needs-review" || searches != 0 {
		t.Fatalf("manual Steam preview invalid: %d %s", preview.Code, preview.Body.String())
	}
	if edits != 0 {
		t.Fatal("Steam preview wrote library state before confirmation")
	}
	confirmed := callConnections(t, h, "alice", http.MethodPost, "/api/connections/observations/"+previewBody.Observations[0].ID+"/confirm", map[string]any{"titleId": "igdb:game:570", "media": "game"})
	if confirmed.Code != http.StatusOK || edits != 1 {
		t.Fatalf("manual Steam confirmation failed: %d edits, %s", edits, confirmed.Body.String())
	}
	confirmed = callConnections(t, h, "alice", http.MethodPost, "/api/connections/observations/"+previewBody.Observations[0].ID+"/confirm", map[string]any{"titleId": "igdb:game:570", "media": "game"})
	if confirmed.Code != http.StatusOK || edits != 1 {
		t.Fatalf("manual Steam confirmation retry duplicated update: %d edits, %s", edits, confirmed.Body.String())
	}
}

func testConnectionsDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("LUDEX_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("PG required")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { admin.Close() })
	schema := "conn_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE") })
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeExec
	cfg.ConnConfig.StatementCacheCapacity = 0
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	p, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(p.Close)
	if err := db.Migrate(ctx, p); err != nil {
		t.Fatal(err)
	}
	return p
}

func callConnections(t *testing.T, h *Handler, user, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var raw strings.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		raw = *strings.NewReader(string(encoded))
	}
	req := httptest.NewRequest(method, path, &raw)
	req.Header.Set("X-User", user)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}
