package jobs

import (
	"context"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"ludex/backend/db"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

func TestConcurrentWorkersClaimOnce(t *testing.T) {
	u := os.Getenv("LUDEX_TEST_DATABASE_URL")
	if u == "" {
		t.Skip("PG required")
	}
	ctx := context.Background()
	admin, e := pgxpool.New(ctx, u)
	if e != nil {
		t.Fatal(e)
	}
	defer admin.Close()
	schema := "jobs_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	admin.Exec(ctx, "CREATE SCHEMA "+schema)
	defer admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	cfg, _ := pgxpool.ParseConfig(u)
	cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeExec
	cfg.ConnConfig.StatementCacheCapacity = 0
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	p, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer p.Close()
	if e = db.Migrate(ctx, p); e != nil {
		t.Fatal(e)
	}
	if _, e = Enqueue(ctx, p, "alice", "test", map[string]string{"title": "Dune"}); e != nil {
		t.Fatal(e)
	}
	var calls atomic.Int32
	handlers := map[string]Handler{"test": func(context.Context, Job) error { calls.Add(1); return nil }}
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, e := Run(ctx, p, handlers, 2); e != nil {
				t.Error(e)
			}
		}()
	}
	wg.Wait()
	if calls.Load() != 1 {
		t.Fatalf("claimed %d times", calls.Load())
	}
}
