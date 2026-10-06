package core

import (
	"context"
	"testing"
	"time"
)

func TestLoadLibraryWithSingleConnectionReadsRunsWithNullableMetadata(t *testing.T) {
	pool := testDatabaseWithMaxConnections(t, 1)
	seedTitle(t, pool, "show:single-connection", "show")
	const user = "10000000-0000-4000-8000-000000000011"
	for _, seed := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO users(id,display_name) VALUES($1,'Reader')`, []any{user}},
		{`INSERT INTO library_entries(user_id,title_id,state) VALUES($1,'show:single-connection','active')`, []any{user}},
		{`INSERT INTO library_runs(user_id,title_id,run_id) VALUES($1,'show:single-connection','run-1')`, []any{user}},
		{`INSERT INTO run_episode_progress(user_id,title_id,run_id,episode_id,status) VALUES($1,'show:single-connection','run-1','s1e1','watched')`, []any{user}},
	} {
		if _, err := pool.Exec(t.Context(), seed.query, seed.args...); err != nil {
			t.Fatalf("seed library run: %v", err)
		}
	}

	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Second)
	defer cancel()
	items, err := New(pool, Config{}).LoadLibrary(ctx, user)
	if err != nil {
		t.Fatalf("load library with one database connection: %v", err)
	}
	if len(items) != 1 || len(items[0].Runs) != 1 || items[0].Runs[0].ID != "run-1" || items[0].Runs[0].Emulator != "" {
		t.Fatalf("library run metadata was not normalized: %#v", items)
	}
	if len(items[0].Runs[0].WatchedEpisodeIDs) != 1 || items[0].Runs[0].WatchedEpisodeIDs[0] != "s1e1" {
		t.Fatalf("run episode progress was not loaded: %#v", items[0].Runs[0])
	}
}
