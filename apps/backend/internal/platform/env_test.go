package platform

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadEnvPreservesProcessOverride(t *testing.T) {
	t.Setenv("LUDEX_TEST_SETTING", "process-value")
	p := filepath.Join(t.TempDir(), ".env")
	if err := os.WriteFile(p, []byte("LUDEX_TEST_SETTING=file-value\nLUDEX_TEST_EXTRA=\"quoted value\"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	defer os.Unsetenv("LUDEX_TEST_EXTRA")
	if err := LoadEnv(p); err != nil {
		t.Fatal(err)
	}
	if os.Getenv("LUDEX_TEST_SETTING") != "process-value" || os.Getenv("LUDEX_TEST_EXTRA") != "quoted value" {
		t.Fatal("env file was not loaded with process precedence")
	}
}
func TestMissingExplicitEnvFails(t *testing.T) {
	if LoadEnv(filepath.Join(t.TempDir(), "missing")) == nil {
		t.Fatal("explicit nonexistent env must fail")
	}
}
func TestPoolConfigurationForSupavisor(t *testing.T) {
	c, err := PoolConfig("postgresql://user:pass@localhost:6543/db?pgbouncer=true&sslmode=require", 4)
	if err != nil {
		t.Fatal(err)
	}
	if c.MaxConns != 4 {
		t.Fatal("pool cap ignored")
	}
	if _, exists := c.ConnConfig.RuntimeParams["pgbouncer"]; exists {
		t.Fatal("Prisma-specific flag passed to PostgreSQL")
	}
	if c.ConnConfig.StatementCacheCapacity != 0 {
		t.Fatal("transaction pool must avoid prepared statement cache")
	}
}
