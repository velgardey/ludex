package companion

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"ludex/backend/internal/catalog"
)

type testAPIMessage struct {
	ID        string         `json:"id"`
	Role      string         `json:"role"`
	Text      string         `json:"text"`
	CreatedAt string         `json:"createdAt"`
	Citations []testCitation `json:"citations"`
	Actions   []testAction   `json:"actions"`
	Fallback  bool           `json:"fallback"`
}

type testCitation struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Excerpt string `json:"excerpt"`
}

type testAction struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Summary string `json:"summary"`
	Status  string `json:"status"`
}

type testAllowance struct {
	Remaining float64 `json:"remaining"`
	Limit     float64 `json:"limit"`
	ResetsAt  string  `json:"resetsAt"`
}

type testState struct {
	Status    string           `json:"status"`
	Allowance *testAllowance   `json:"allowance"`
	Messages  []testAPIMessage `json:"messages"`
}

type testMessageResult struct {
	Status           string         `json:"status"`
	Message          testAPIMessage `json:"message"`
	AssistantMessage testAPIMessage `json:"assistantMessage"`
	Allowance        *testAllowance `json:"allowance"`
}

func TestMessageWithoutAzureUsesOnlyCallerLibraryAndPersistsFallback(t *testing.T) {
	db := setupCompanionDB(t)
	userID, otherUserID := uuid.NewString(), uuid.NewString()
	addTestUsers(t, db.pool, userID, otherUserID)
	var loadCalls atomic.Int32
	handler := newTestRouter(db.pool, Config{
		ResolveUser: testResolveUser,
		LoadLibrary: func(_ context.Context, actor string) ([]LibraryRecord, error) {
			loadCalls.Add(1)
			if actor != userID {
				t.Fatalf("library loader actor = %q, want current user %q", actor, userID)
			}
			return []LibraryRecord{{TitleID: "dune", Title: "Dune", Media: "movie", State: "completed", Version: 4, Rating: intPtr(9), Note: "Loved the desert scenes."}}, nil
		},
	})

	first := doJSON(t, handler, http.MethodPost, "/api/assistant/messages", userID, map[string]any{
		"text": "What did I rate Dune?", "requestId": "request-1",
	})
	if first.Code != http.StatusOK {
		t.Fatalf("POST /messages status = %d, body=%s", first.Code, first.Body.String())
	}
	var result testMessageResult
	if err := json.Unmarshal(first.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode POST /messages: %v", err)
	}
	if result.Status != "fallback" || !result.AssistantMessage.Fallback {
		t.Fatalf("fallback status/message = %q/%t, want fallback/true", result.Status, result.AssistantMessage.Fallback)
	}
	if !strings.Contains(result.AssistantMessage.Text, "Dune") || !strings.Contains(result.AssistantMessage.Text, "9/10") {
		t.Fatalf("fallback text = %q, want caller-owned Dune rating", result.AssistantMessage.Text)
	}
	if strings.Contains(first.Body.String(), "other user's secret") {
		t.Fatalf("response leaked another user's private library: %s", first.Body.String())
	}
	if len(result.AssistantMessage.Citations) != 1 || result.AssistantMessage.Citations[0].ID != "library:dune" {
		t.Fatalf("fallback citations = %#v, want only library:dune", result.AssistantMessage.Citations)
	}

	replay := doJSON(t, handler, http.MethodPost, "/api/assistant/messages", userID, map[string]any{
		"text": "What did I rate Dune?", "requestId": "request-1",
	})
	if replay.Code != http.StatusOK {
		t.Fatalf("replayed POST status = %d, body=%s", replay.Code, replay.Body.String())
	}
	var replayed testMessageResult
	if err := json.Unmarshal(replay.Body.Bytes(), &replayed); err != nil {
		t.Fatalf("decode replay: %v", err)
	}
	if replayed.AssistantMessage.ID != result.AssistantMessage.ID || loadCalls.Load() != 1 {
		t.Fatalf("replay assistant=%q loads=%d; want persisted message and one retrieval", replayed.AssistantMessage.ID, loadCalls.Load())
	}

	state := doJSON(t, handler, http.MethodGet, "/api/assistant/state", userID, nil)
	if state.Code != http.StatusOK {
		t.Fatalf("GET /state status = %d, body=%s", state.Code, state.Body.String())
	}
	var gotState testState
	if err := json.Unmarshal(state.Body.Bytes(), &gotState); err != nil {
		t.Fatalf("decode state: %v", err)
	}
	if gotState.Status != "unconfigured" || len(gotState.Messages) != 2 {
		t.Fatalf("state = status %q with %d messages, want unconfigured with two persisted messages", gotState.Status, len(gotState.Messages))
	}
}

func TestEmptyLibraryFallbackPersistsEmptyCitationsWhenCatalogIsUnavailable(t *testing.T) {
	db := setupCompanionDB(t)
	userID := uuid.NewString()
	addTestUsers(t, db.pool, userID)
	handler := newTestRouter(db.pool, Config{
		ResolveUser: testResolveUser,
		LoadLibrary: func(_ context.Context, actor string) ([]LibraryRecord, error) {
			if actor != userID {
				return nil, errors.New("wrong actor")
			}
			return []LibraryRecord{}, nil
		},
		Catalog: unavailableCatalog{},
	})
	response := doJSON(t, handler, http.MethodPost, "/api/assistant/messages", userID, map[string]any{
		"text": "Find movie Dune", "requestId": "empty-library-request",
	})
	if response.Code != http.StatusOK {
		t.Fatalf("POST /messages status = %d, body=%s", response.Code, response.Body.String())
	}
	var result testMessageResult
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !result.AssistantMessage.Fallback || len(result.AssistantMessage.Citations) != 0 {
		t.Fatalf("empty-library response = fallback %t citations %#v", result.AssistantMessage.Fallback, result.AssistantMessage.Citations)
	}
	var citationType string
	if err := db.pool.QueryRow(context.Background(), `SELECT jsonb_typeof(citations) FROM assistant_messages WHERE id = $1`, result.AssistantMessage.ID).Scan(&citationType); err != nil {
		t.Fatalf("read persisted citations: %v", err)
	}
	if citationType != "array" {
		t.Fatalf("persisted citation JSON type = %q, want array", citationType)
	}
	var count int
	if err := db.pool.QueryRow(context.Background(), `SELECT jsonb_array_length(citations) FROM assistant_messages WHERE id = $1`, result.AssistantMessage.ID).Scan(&count); err != nil || count != 0 {
		t.Fatalf("persisted empty citation count = %d, error = %v, want zero", count, err)
	}
}

func TestCompleteRequestPersistsNilCitationsAsEmptyArray(t *testing.T) {
	db := setupCompanionDB(t)
	userID := uuid.NewString()
	addTestUsers(t, db.pool, userID)
	store := serviceStore{db: db.pool}
	begin, err := store.beginRequest(context.Background(), userID, "nil-citations-request", "Hello", testLimits(), 12)
	if err != nil {
		t.Fatalf("begin assistant request: %v", err)
	}

	message, err := store.completeRequest(context.Background(), begin.conversationID, begin.requestID, Message{
		Role: "assistant", Text: "Hello back.", Citations: nil,
	}, nil)
	if err != nil {
		t.Fatalf("complete assistant request: %v", err)
	}
	if message.Citations == nil {
		t.Fatal("returned citations are nil, want an empty slice")
	}
	var citationType string
	if err := db.pool.QueryRow(context.Background(), `SELECT jsonb_typeof(citations) FROM assistant_messages WHERE id = $1`, message.ID).Scan(&citationType); err != nil {
		t.Fatalf("read persisted citations: %v", err)
	}
	if citationType != "array" {
		t.Fatalf("persisted citation JSON type = %q, want array", citationType)
	}
}

func TestSaveEmbeddingsPersistsVectorsWithExecQueryMode(t *testing.T) {
	db := setupCompanionDB(t)
	userID := uuid.NewString()
	addTestUsers(t, db.pool, userID)
	service := &Service{db: db.pool}
	want := storedEmbedding{ID: "library:dune", Hash: "content-hash", Values: []float64{0.25, 0.5, 0.75}}
	if err := service.saveEmbeddings(context.Background(), userID, "embedding-model", []storedEmbedding{want}); err != nil {
		t.Fatalf("save embeddings: %v", err)
	}

	got, err := service.loadEmbeddings(context.Background(), userID, "embedding-model", []string{want.ID})
	if err != nil {
		t.Fatalf("load embeddings: %v", err)
	}
	if cached, ok := got[want.ID]; !ok || cached.hash != want.Hash || len(cached.values) != len(want.Values) {
		t.Fatalf("loaded embedding = %#v, want hash %q and vector %v", cached, want.Hash, want.Values)
	} else {
		for i, value := range want.Values {
			if cached.values[i] != value {
				t.Fatalf("loaded vector = %v, want %v", cached.values, want.Values)
			}
		}
	}
}

func TestCatalogFailureDoesNotBlockCallerLibraryFallback(t *testing.T) {
	db := setupCompanionDB(t)
	userID := uuid.NewString()
	addTestUsers(t, db.pool, userID)
	handler := newTestRouter(db.pool, Config{
		ResolveUser: testResolveUser,
		LoadLibrary: func(_ context.Context, actor string) ([]LibraryRecord, error) {
			if actor != userID {
				return nil, errors.New("wrong actor")
			}
			return []LibraryRecord{{TitleID: "dune", Title: "Dune", Media: "movie", State: "completed", Version: 1}}, nil
		},
		Catalog: unavailableCatalog{},
	})
	response := doJSON(t, handler, http.MethodPost, "/api/assistant/messages", userID, map[string]any{
		"text": "Find movie Dune", "requestId": "catalog-down-request",
	})
	if response.Code != http.StatusOK {
		t.Fatalf("POST /messages status = %d, body=%s", response.Code, response.Body.String())
	}
	var result testMessageResult
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !strings.Contains(result.AssistantMessage.Text, "Dune") || len(result.AssistantMessage.Citations) != 1 || result.AssistantMessage.Citations[0].ID != "library:dune" {
		t.Fatalf("fallback lost caller library when catalog failed: %#v", result.AssistantMessage)
	}
}

func TestAzureResponsesCallIsBoundedAndCitationsAreFiltered(t *testing.T) {
	db := setupCompanionDB(t)
	userID, otherUserID := uuid.NewString(), uuid.NewString()
	addTestUsers(t, db.pool, userID, otherUserID)
	var calls atomic.Int32
	azure := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path != "/openai/v1/responses" {
			t.Errorf("Azure path = %q, want /openai/v1/responses", r.URL.Path)
		}
		if r.Header.Get("api-key") != "server-only-key" {
			t.Errorf("Azure auth header missing server credential")
		}
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode Azure request: %v", err)
		}
		if request["model"] != "gpt-6-luna" {
			t.Errorf("model = %v, want gpt-6-luna", request["model"])
		}
		maxOutput, _ := request["max_output_tokens"].(float64)
		if maxOutput == 0 || maxOutput > 160 {
			t.Errorf("max_output_tokens = %v, want positive and <= 160", maxOutput)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"resp_1","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"{\"text\":\"Dune is rated 9/10 in your library.\",\"citations\":[\"library:dune\",\"private:other-user\"],\"actions\":[]}"}]}],"usage":{"input_tokens":31,"output_tokens":13}}`))
	}))
	defer azure.Close()

	handler := newTestRouter(db.pool, testCloudConfig(userID, azure.URL, func(_ context.Context, actor string) ([]LibraryRecord, error) {
		if actor != userID {
			return nil, errors.New("wrong actor")
		}
		return []LibraryRecord{{TitleID: "dune", Title: "Dune", Media: "movie", State: "completed", Version: 4, Rating: intPtr(9)}}, nil
	}))
	response := doJSON(t, handler, http.MethodPost, "/api/assistant/messages", userID, map[string]any{
		"text": "What did I rate Dune?", "requestId": "cloud-request-1",
	})
	if response.Code != http.StatusOK {
		t.Fatalf("POST /messages status = %d, body=%s", response.Code, response.Body.String())
	}
	var result testMessageResult
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if result.Status != "ready" || result.AssistantMessage.Fallback {
		t.Fatalf("cloud response status/fallback = %q/%t", result.Status, result.AssistantMessage.Fallback)
	}
	if len(result.AssistantMessage.Citations) != 1 || result.AssistantMessage.Citations[0].ID != "library:dune" {
		t.Fatalf("filtered citations = %#v, want only library:dune", result.AssistantMessage.Citations)
	}
	if calls.Load() != 1 {
		t.Fatalf("Azure calls = %d, want one metered responses call", calls.Load())
	}
}

func TestProgressProposalRequiresConfirmationAndReplayCallsCoreOnce(t *testing.T) {
	db := setupCompanionDB(t)
	userID, otherUserID := uuid.NewString(), uuid.NewString()
	addTestUsers(t, db.pool, userID, otherUserID)
	commandID, runID := uuid.NewString(), uuid.NewString()
	var applyCalls atomic.Int32
	var appliedCommand json.RawMessage
	commandJSON := `{"commandId":"` + commandID + `","titleId":"dune","baseVersion":4,"change":{"kind":"movie-viewed","titleId":"dune","runId":"` + runID + `"},"occurredAt":{"precision":"unknown"},"audience":{"kind":"private"},"spoiler":{"kind":"none"}}`
	commandValue, err := json.Marshal(commandJSON)
	if err != nil {
		t.Fatal(err)
	}
	azure := responseServer(t, `{"text":"I can mark Dune as viewed.","citations":["library:dune"],"actions":[{"label":"Mark Dune viewed","summary":"Record Dune as viewed in your library.","command":`+string(commandValue)+`}]}`)
	defer azure.Close()
	cfg := testCloudConfig(userID, azure.URL, func(_ context.Context, actor string) ([]LibraryRecord, error) {
		if actor != userID {
			return nil, errors.New("wrong actor")
		}
		return []LibraryRecord{{TitleID: "dune", Title: "Dune", Media: "movie", State: "planned", Version: 4}}, nil
	})
	cfg.ApplyProgress = func(_ context.Context, actor string, raw json.RawMessage) (json.RawMessage, error) {
		if actor != userID {
			return nil, errors.New("wrong progress actor")
		}
		applyCalls.Add(1)
		appliedCommand = append(json.RawMessage(nil), raw...)
		return json.RawMessage(`{"status":"accepted","version":5}`), nil
	}
	handler := newTestRouter(db.pool, cfg)
	messageResponse := doJSON(t, handler, http.MethodPost, "/api/assistant/messages", userID, map[string]any{
		"text": "Mark Dune watched", "requestId": "proposal-request-1",
	})
	if messageResponse.Code != http.StatusOK {
		t.Fatalf("POST /messages status = %d, body=%s", messageResponse.Code, messageResponse.Body.String())
	}
	var result testMessageResult
	if err := json.Unmarshal(messageResponse.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if applyCalls.Load() != 0 || len(result.AssistantMessage.Actions) != 1 || result.AssistantMessage.Actions[0].Status != "pending" {
		t.Fatalf("proposal auto-applied or missing: calls=%d actions=%#v", applyCalls.Load(), result.AssistantMessage.Actions)
	}
	actionID := result.AssistantMessage.Actions[0].ID
	foreign := doJSON(t, handler, http.MethodPost, "/api/assistant/actions/"+actionID+"/confirm", otherUserID, nil)
	if foreign.Code != http.StatusNotFound || applyCalls.Load() != 0 {
		t.Fatalf("foreign confirmation status=%d calls=%d, want 404 and no apply", foreign.Code, applyCalls.Load())
	}

	confirmed := doJSON(t, handler, http.MethodPost, "/api/assistant/actions/"+actionID+"/confirm", userID, nil)
	if confirmed.Code != http.StatusOK {
		t.Fatalf("confirmation status = %d, body=%s", confirmed.Code, confirmed.Body.String())
	}
	var confirmation map[string]any
	if err := json.Unmarshal(confirmed.Body.Bytes(), &confirmation); err != nil {
		t.Fatalf("decode confirmation: %v", err)
	}
	if confirmation["status"] != "confirmed" {
		t.Fatalf("confirmation status = %v, want confirmed", confirmation["status"])
	}
	replayed := doJSON(t, handler, http.MethodPost, "/api/assistant/actions/"+actionID+"/confirm", userID, nil)
	if replayed.Code != http.StatusOK || applyCalls.Load() != 1 {
		t.Fatalf("replay status=%d apply calls=%d, want 200 and one core write", replayed.Code, applyCalls.Load())
	}
	var command map[string]any
	if err := json.Unmarshal(appliedCommand, &command); err != nil {
		t.Fatalf("decode applied command: %v", err)
	}
	if command["commandId"] != commandID || command["baseVersion"] != float64(4) {
		t.Fatalf("applied command differs from confirmed stored payload: %s", appliedCommand)
	}
}

func TestSharedBudgetReservationIsAtomicAcrossConcurrentCallers(t *testing.T) {
	db := setupCompanionDB(t)
	userA, userB := uuid.NewString(), uuid.NewString()
	addTestUsers(t, db.pool, userA, userB)
	limits := testLimits()
	limits.SharedDailyMicros = 2688 // 2048 input tokens plus 160 output tokens at configured rates.
	limits.MonthlyBudgetMicros = 2688
	limits.UserDailyMicros = 100000
	store := newBudgetStore(db.pool, limits)
	start := make(chan struct{})
	results := make(chan error, 2)
	for _, userID := range []string{userA, userB} {
		go func(actor string) {
			<-start
			_, err := store.reserve(context.Background(), actor, uuid.NewString(), "responses", limits.MaxContextTokens, limits.MaxOutputTokens, limits.ResponsesInputMicrosPerMillion, limits.ResponsesOutputMicrosPerMillion)
			results <- err
		}(userID)
	}
	close(start)
	first, second := <-results, <-results
	accepted, exhausted := 0, 0
	for _, err := range []error{first, second} {
		if err == nil {
			accepted++
		} else if errors.Is(err, ErrAllowanceExhausted) {
			exhausted++
		} else {
			t.Fatalf("reservation error = %v, want exhausted or accepted", err)
		}
	}
	if accepted != 1 || exhausted != 1 {
		t.Fatalf("accepted reservations=%d exhausted=%d, want 1 each", accepted, exhausted)
	}
}

type testDatabase struct {
	pool   *pgxpool.Pool
	admin  *pgx.Conn
	schema string
}

func setupCompanionDB(t *testing.T) *testDatabase {
	t.Helper()
	dsn := os.Getenv("LUDEX_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("LUDEX_TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	admin, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("connect test PostgreSQL: %v", err)
	}
	schema := "companion_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		_ = admin.Close(ctx)
		t.Fatalf("create isolated schema: %v", err)
	}
	poolConfig, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("parse test database URL: %v", err)
	}
	poolConfig.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeExec
	poolConfig.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		t.Fatalf("create schema-scoped pool: %v", err)
	}
	if _, err := pool.Exec(ctx, `CREATE TABLE users(id uuid PRIMARY KEY)`); err != nil {
		t.Fatalf("create core user fixture: %v", err)
	}
	migration, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "002_companion.sql"))
	if err != nil {
		t.Fatalf("read companion migration: %v", err)
	}
	if _, err := pool.Exec(ctx, string(migration)); err != nil {
		t.Fatalf("apply companion migration: %v", err)
	}
	t.Cleanup(func() {
		pool.Close()
		_, _ = admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
		_ = admin.Close(context.Background())
	})
	return &testDatabase{pool: pool, admin: admin, schema: schema}
}

func addTestUsers(t *testing.T, pool *pgxpool.Pool, ids ...string) {
	t.Helper()
	for _, id := range ids {
		if _, err := pool.Exec(context.Background(), `INSERT INTO users(id) VALUES($1)`, id); err != nil {
			t.Fatalf("insert test user: %v", err)
		}
		if _, err := pool.Exec(context.Background(), `INSERT INTO assistant_conversations(id, user_id) VALUES($1, $2)`, uuid.NewString(), id); err != nil {
			t.Fatalf("insert test conversation: %v", err)
		}
	}
}

func newTestRouter(pool *pgxpool.Pool, cfg Config) http.Handler {
	router := chi.NewRouter()
	router.Mount("/api/assistant", New(pool, cfg))
	return router
}

func testResolveUser(r *http.Request) (string, error) {
	actor := r.Header.Get("X-Test-User")
	if actor == "" {
		return "", errors.New("unauthenticated")
	}
	return actor, nil
}

func testCloudConfig(userID, endpoint string, loader func(context.Context, string) ([]LibraryRecord, error)) Config {
	return Config{
		AzureEndpoint:      endpoint + "/openai/v1",
		AzureDeployment:    "gpt-6-luna",
		AzureAPIKey:        "server-only-key",
		AzureEnabled:       true,
		CloudConsent:       func(context.Context, string) (bool, error) { return true, nil },
		LoadLibrary:        loader,
		ResolveUser:        testResolveUser,
		HTTPClient:         &http.Client{Timeout: 2 * time.Second},
		Limits:             testLimits(),
		MaxProposalAge:     time.Hour,
		MaxHistoryMessages: 12,
		MaxInputCharacters: 4000,
	}
}

func testLimits() Limits {
	return Limits{
		UserDailyMicros:                 100000,
		SharedDailyMicros:               1000000,
		ResponsesInputMicrosPerMillion:  1000000,
		ResponsesOutputMicrosPerMillion: 4000000,
		EmbeddingMicrosPerMillion:       0,
		MonthlyResponsesPerUser:         20,
		MonthlyBudgetMicros:             5000000,
		MaxContextTokens:                2048,
		MaxOutputTokens:                 160,
		MaxConcurrentRequests:           2,
		RequestsPerMinute:               12,
		MaxLibraryRecords:               30,
	}
}

func doJSON(t *testing.T, handler http.Handler, method, path, actor string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var encoded bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&encoded).Encode(body); err != nil {
			t.Fatalf("encode request: %v", err)
		}
	}
	request := httptest.NewRequest(method, path, &encoded)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Test-User", actor)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func responseServer(t *testing.T, output string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		response := map[string]any{
			"id": "resp_fixture",
			"output": []any{map[string]any{
				"type": "message", "role": "assistant",
				"content": []any{map[string]any{"type": "output_text", "text": output}},
			}},
			"usage": map[string]int{"input_tokens": 28, "output_tokens": 18},
		}
		if err := json.NewEncoder(w).Encode(response); err != nil {
			t.Errorf("encode response fixture: %v", err)
		}
	}))
}

func intPtr(value int) *int { return &value }

type unavailableCatalog struct{}

func (unavailableCatalog) Search(context.Context, string, string, string) ([]catalog.Hit, error) {
	return nil, errors.New("catalog unavailable")
}

func (unavailableCatalog) Title(context.Context, string) (catalog.Hit, error) {
	return catalog.Hit{}, errors.New("catalog unavailable")
}
