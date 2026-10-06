import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteRepository } from "../src/store/sqlite.ts";
test("SQLite durable transactions roll back, enforce scope and compare ETags", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ludex-store-"));
  const file = join(dir, "db.sqlite");
  let repo = new SqliteRepository(file);
  const value = {
    id: "one",
    scope: "user:alice",
    version: 1,
    body: { note: "private" },
    etag: "",
  };
  await assert.rejects(
    repo.transact("user:alice", [
      { kind: "create", value: { ...value, scope: "user:bob" } },
    ]),
    /scope-mismatch/,
  );
  assert.equal(
    await repo.transact(value.scope, [{ kind: "create", value }]),
    "committed",
  );
  const stored = await repo.read(value.scope, value.id);
  assert.ok(stored);
  assert.equal(
    await repo.transact(value.scope, [
      {
        kind: "replace",
        value: { ...value, version: 2 },
        expectedEtag: "stale",
      },
      { kind: "create", value: { ...value, id: "two" } },
    ]),
    "conflict",
  );
  assert.equal(await repo.read(value.scope, "two"), null);
  repo.close();
  repo = new SqliteRepository(file);
  assert.deepEqual((await repo.read(value.scope, value.id))?.body, {
    note: "private",
  });
  assert.equal(
    await repo.transact(value.scope, [
      {
        kind: "replace",
        value: { ...value, version: 2 },
        expectedEtag: stored.etag,
      },
    ]),
    "committed",
  );
  repo.close();
  rmSync(dir, { recursive: true, force: true });
});
