package plans

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"ludex/backend/db"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestPlanPersistsAndRejectsNonMembers(t *testing.T) {
	u := os.Getenv("LUDEX_TEST_DATABASE_URL")
	if u == "" {
		t.Skip("disposable PG required")
	}
	ctx, stop := context.WithTimeout(context.Background(), 8*time.Second)
	defer stop()
	admin, e := pgxpool.New(ctx, u)
	if e != nil {
		t.Fatal(e)
	}
	defer admin.Close()
	schema := "plans_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	admin.Exec(ctx, "CREATE SCHEMA "+schema)
	defer admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	cfg, e := pgxpool.ParseConfig(u)
	if e != nil {
		t.Fatal(e)
	}
	cfg.MaxConns = 1
	cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeExec
	cfg.ConnConfig.StatementCacheCapacity = 0
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer pool.Close()
	if e = db.Migrate(ctx, pool); e != nil {
		t.Fatal(e)
	}
	alice, bob, eve := uuid.NewString(), uuid.NewString(), uuid.NewString()
	for _, id := range []string{alice, bob, eve} {
		if _, e := pool.Exec(ctx, "INSERT INTO users(id,display_name) VALUES($1,'Tester')", id); e != nil {
			t.Fatal(e)
		}
	}
	h := New(pool, Config{ResolveUser: func(r *http.Request) (string, error) { return r.Header.Get("X-Test-User"), nil }})
	req := httptest.NewRequest("POST", "/api/plans", strings.NewReader(`{"title":"Friday night","memberIds":["`+bob+`"]}`))
	req.Header.Set("X-Test-User", alice)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 201 {
		t.Fatalf("create failed %d %s", w.Code, w.Body.String())
	}
	var out map[string]any
	json.Unmarshal(w.Body.Bytes(), &out)
	id := out["id"].(string)
	req = httptest.NewRequest("GET", "/api/plans/"+id, nil)
	req.Header.Set("X-Test-User", eve)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 404 {
		t.Fatal("non-member accessed private plan")
	}
	req = httptest.NewRequest("GET", "/api/plans/"+id, nil)
	req.Header.Set("X-Test-User", bob)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "Friday night") {
		t.Fatalf("member cannot read persisted plan: %d %s", w.Code, w.Body.String())
	}
	// A scoped message must never return its body until the reader has matching progress.
	message := `{"text":"the hidden ending","scope":{"kind":"episodes","showId":"show:test","requiredEpisodeIds":["episode:1"]}}`
	req = httptest.NewRequest("POST", "/api/plans/"+id+"/discussion", strings.NewReader(message))
	req.Header.Set("X-Test-User", alice)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 201 {
		t.Fatalf("message failed: %d %s", w.Code, w.Body.String())
	}
	readCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	req = httptest.NewRequest("GET", "/api/plans/"+id+"/discussion", nil).WithContext(readCtx)
	req.Header.Set("X-Test-User", bob)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 200 || strings.Contains(w.Body.String(), "hidden ending") || !strings.Contains(w.Body.String(), `"detailHidden":true`) {
		t.Fatalf("scoped body leaked %d %s", w.Code, w.Body.String())
	}

	if _, e := pool.Exec(ctx, "INSERT INTO titles(id,media,title) VALUES('show:test','show','Test show')"); e != nil {
		t.Fatal(e)
	}
	if _, e := pool.Exec(ctx, "INSERT INTO library_entries(user_id,title_id) VALUES($1,'show:test')", bob); e != nil {
		t.Fatal(e)
	}
	if _, e := pool.Exec(ctx, "INSERT INTO library_runs(user_id,title_id,run_id) VALUES($1,'show:test','run')", bob); e != nil {
		t.Fatal(e)
	}
	if _, e := pool.Exec(ctx, "INSERT INTO run_episode_progress(user_id,title_id,run_id,episode_id,status) VALUES($1,'show:test','run','episode:1','watched')", bob); e != nil {
		t.Fatal(e)
	}
	req = httptest.NewRequest("GET", "/api/plans/"+id+"/discussion", nil).WithContext(ctx)
	req.Header.Set("X-Test-User", bob)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "the hidden ending") {
		t.Fatalf("progress did not unlock discussion: %s", w.Body.String())
	}

	req = httptest.NewRequest("POST", "/api/plans", strings.NewReader(`{"title":"Unknown member","memberIds":["`+uuid.NewString()+`"]}`))
	req.Header.Set("X-Test-User", alice)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 400 {
		t.Fatalf("unknown account accepted: %d", w.Code)
	}
	if _, e := pool.Exec(ctx, "INSERT INTO blocks(blocker_id,blocked_id) VALUES($1,$2)", bob, alice); e != nil {
		t.Fatal(e)
	}
	req = httptest.NewRequest("POST", "/api/plans", strings.NewReader(`{"title":"Blocked invite","memberIds":["`+bob+`"]}`))
	req.Header.Set("X-Test-User", alice)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 400 {
		t.Fatalf("blocked account invited: %d", w.Code)
	}
	for _, actor := range []string{alice, bob} {
		req = httptest.NewRequest("GET", "/api/plans", nil)
		req.Header.Set("X-Test-User", actor)
		w = httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != 200 || strings.Contains(w.Body.String(), id) {
			t.Fatalf("blocked plan remained listed: %d %s", w.Code, w.Body.String())
		}
		for _, route := range []struct{ method, path, body string }{{"GET", "", ""}, {"GET", "/discussion", ""}, {"POST", "/rsvp", `{"rsvp":"yes"}`}, {"POST", "/shortlist", `{"titleId":"movie:test"}`}, {"POST", "/discussion", `{"text":"blocked","scope":{"kind":"none"}}`}} {
			req = httptest.NewRequest(route.method, "/api/plans/"+id+route.path, strings.NewReader(route.body))
			req.Header.Set("X-Test-User", actor)
			w = httptest.NewRecorder()
			h.ServeHTTP(w, req)
			if w.Code != 404 {
				t.Fatalf("blocked member access: %s %s returned %d", route.method, route.path, w.Code)
			}
		}
	}

}
