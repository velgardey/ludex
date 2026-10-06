package companion

import (
	"context"
	"github.com/google/uuid"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestCloudRequiresUserConsentAndResetKeepsAllowance(t *testing.T) {
	testdb := setupCompanionDB(t)
	pool := testdb.pool
	user := uuid.NewString()
	addTestUsers(t, pool, user)
	var calls atomic.Int32
	provider := responseServer(t, `{"text":"Cloud answer","citations":[],"actions":[]}`)
	defer provider.Close()
	cfg := testCloudConfig(user, provider.URL, func(context.Context, string) ([]LibraryRecord, error) { return nil, nil })
	cfg.CloudConsent = nil
	cfg.HTTPClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) { calls.Add(1); return http.DefaultTransport.RoundTrip(r) })}
	h := newTestRouter(pool, cfg)
	w := doJSON(t, h, "POST", "/api/assistant/messages", user, map[string]string{"requestId": "private-first", "text": "Hello"})
	if w.Code != 200 || calls.Load() != 0 {
		t.Fatalf("cloud called without consent: %d calls%d %s", w.Code, calls.Load(), w.Body.String())
	}
	_, e := pool.Exec(context.Background(), "INSERT INTO assistant_budget_windows(scope_key,window_start,spent_micros,reserved_micros) VALUES($1,current_date,123,456)", "user:"+user)
	if e != nil {
		t.Fatal(e)
	}

	w = doJSON(t, h, "POST", "/api/assistant/reset", user, map[string]any{})
	if w.Code != 200 {
		t.Fatalf("reset failed: %d %s", w.Code, w.Body.String())
	}
	var count int
	pool.QueryRow(context.Background(), "SELECT count(*) FROM assistant_conversations WHERE user_id=$1", user).Scan(&count)
	if count != 0 {
		t.Fatal("conversation retained")
	}
	var spent, reserved int64
	if e := pool.QueryRow(context.Background(), "SELECT spent_micros,reserved_micros FROM assistant_budget_windows WHERE scope_key=$1", "user:"+user).Scan(&spent, &reserved); e != nil || spent != 123 || reserved != 456 {
		t.Fatalf("reset changed allowance: %d %d %v", spent, reserved, e)
	}

}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestFallbackListsCompletedLibraryForWatchedQuestion(t *testing.T) {
	doc := libraryDocument(LibraryRecord{TitleID: "dune", Title: "Dune", Media: "movie", State: "completed"})
	text, citations := fallbackReply("What have I watched?", []retrievalDocument{doc})
	if !strings.Contains(text, "Dune") || len(citations) != 1 {
		t.Fatalf("fallback missed own watched record: %s", text)
	}
}

func TestAzureRedirectNeverForwardsAppKey(t *testing.T) {
	testdb := setupCompanionDB(t)
	user := uuid.NewString()
	addTestUsers(t, testdb.pool, user)
	var forwarded atomic.Int32
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("api-key") != "" {
			forwarded.Add(1)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"output_text":"{\"text\":\"Redirected answer\",\"citations\":[],\"actions\":[]}","usage":{"input_tokens":1,"output_tokens":1}}`))
	}))
	defer destination.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, destination.URL, http.StatusTemporaryRedirect)
	}))
	defer source.Close()
	cfg := testCloudConfig(user, source.URL, func(context.Context, string) ([]LibraryRecord, error) { return nil, nil })
	h := newTestRouter(testdb.pool, cfg)
	w := doJSON(t, h, "POST", "/api/assistant/messages", user, map[string]string{"requestId": "redirect-check", "text": "Hello"})
	if w.Code != 502 {
		t.Fatalf("redirect must be rejected: %d", w.Code)
	}
	if forwarded.Load() != 0 {
		t.Fatal("Azure app key followed provider redirect")
	}
}
