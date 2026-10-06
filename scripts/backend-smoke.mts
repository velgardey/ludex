import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startServer } from "../apps/api/src/server.ts";
import { LudexClient } from "../packages/client/src/index.ts";
const directory = mkdtempSync(join(tmpdir(), "ludex-http-"));
const dbPath = join(directory, "ludex.sqlite");
let app = await startServer({ port: 0, dbPath });
let baseUrl = `http://localhost:${app.port}/api`;
const alice = new LudexClient({ baseUrl });
const bob = new LudexClient({ baseUrl });
const a = await alice.signup({
  inviteCode: "LUDEX-LOCAL-BETA",
  email: "alice@example.test",
  password: "alice-long-secret-password",
  displayName: "Alice",
});
const b = await bob.signup({
  inviteCode: "LUDEX-LOCAL-BETA",
  email: "bob@example.test",
  password: "bob-long-secret-password",
  displayName: "Bob",
});
assert.deepEqual(await alice.readLibrary(), []);
assert.deepEqual((await bob.readFeed()).items, []);
const catalog = await alice.searchCatalog();
assert.equal(catalog.length, 8);
const movie = catalog.find((t) => t.media === "movie")!;
await bob.follow(a.user.id);
const cmd = {
  commandId: randomUUID(),
  baseVersion: 0,
  titleId: movie.id,
  change: {
    kind: "movie-viewed" as const,
    titleId: movie.id,
    runId: randomUUID(),
  },
  occurredAt: { precision: "day" as const, day: "2026-10-06" },
  audience: { kind: "public" as const },
  spoiler: { kind: "none" as const },
  note: "A good film night.",
  rating: 9,
};
const first = await alice.applyProgress(cmd);
assert.deepEqual(await alice.applyProgress(cmd), first);
assert.equal((await bob.readFeed()).items.length, 1);
await app.close();
app = await startServer({ port: 0, dbPath });
baseUrl = `http://localhost:${app.port}/api`;
const restoredAlice = new LudexClient({ baseUrl, token: a.token });
const restoredBob = new LudexClient({ baseUrl, token: b.token });
assert.equal((await restoredAlice.readLibrary())[0].rating, 9);
assert.equal(
  (await restoredBob.readFeed()).items[0].note,
  "A good film night.",
);
const exported = await restoredAlice.exportAccount();
const response = await fetch(exported.downloadUrl, {
  headers: { Authorization: `Bearer ${a.token}` },
});
assert.equal(response.status, 200);
const data = await response.json();
assert.equal(data.schemaVersion, 1);
assert.ok(!JSON.stringify(data).includes("alice-long-secret-password"));
await restoredAlice.blockUser(b.user.id);
assert.equal((await restoredBob.readFeed()).items.length, 0);
await restoredAlice.requestDeletion();
await assert.rejects(restoredAlice.me());
await app.close();
rmSync(directory, { recursive: true, force: true });
console.log(
  JSON.stringify({
    status: "passed",
    realAccounts: 2,
    catalogTitles: catalog.length,
    restartPersistence: true,
    idempotency: true,
    feedPrivacy: true,
    export: true,
    deletion: true,
  }),
);
