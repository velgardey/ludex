import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OwnerStore, type SqlDriver } from "../src/storage/outbox";
import { drain } from "../src/sync/drain";
import type { ProgressCommand } from "@ludex/domain";
const command: ProgressCommand = {
  commandId: "stable-command",
  titleId: "movie",
  baseVersion: 0,
  change: { kind: "movie-viewed", titleId: "movie", runId: "run" },
  occurredAt: { precision: "day", day: "2026-10-06" },
  audience: { kind: "private" },
  spoiler: { kind: "none" },
};
let directory: string;
let db: DatabaseSync;
function open(owner = "alice") {
  db = new DatabaseSync(join(directory, owner + ".sqlite"));
  const driver: SqlDriver = {
    exec: async (sql) => {
      db.exec(sql);
    },
    run: async (sql, params = []) => {
      db.prepare(sql).run(...params);
    },
    all: async (sql, params = []) => db.prepare(sql).all(...params) as never,
    transaction: async (fn) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        await fn(driver);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return new OwnerStore(driver, owner);
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "ludex-mobile-"));
});
afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});
it("reopening a disk database retains the offline command ID and owner draft", async () => {
  let store = open();
  await store.init();
  await store.enqueue("progress", command);
  await store.saveDraft("log", { note: "still here" });
  db.close();
  store = open();
  await store.init();
  expect((await store.pending())[0].commandId).toBe(command.commandId);
  expect(await store.draft("log")).toEqual({ note: "still here" });
});
it("duplicate save stores one immutable command and rejects a changed payload", async () => {
  const store = open();
  await store.init();
  await store.enqueue("progress", command);
  await store.enqueue("progress", command);
  expect(await store.pending()).toHaveLength(1);
  await expect(
    store.enqueue("progress", { ...command, note: "different" }),
  ).rejects.toThrow("command-payload-changed");
});
it("a conflict preserves the draft and never silently overwrites its version", async () => {
  const store = open();
  await store.init();
  await store.saveDraft("log", { note: "my text" });
  await store.enqueue("progress", command);
  await drain(store, async () => ({
    status: "conflict",
    commandId: command.commandId,
    currentVersion: 3,
  }));
  expect((await store.pending())[0].status).toBe("conflict");
  expect(await store.draft("log")).toEqual({ note: "my text" });
  expect((await store.pending())[0].payload).toMatchObject({ baseVersion: 0 });
});
it("network failure retains the same command and accepted retry removes it", async () => {
  const store = open();
  await store.init();
  await store.enqueue("progress", command);
  await drain(store, async () => {
    throw new Error("offline");
  });
  expect((await store.pending())[0].commandId).toBe(command.commandId);
  await drain(store, async (entry) => ({
    status: "accepted",
    commandId: entry.commandId,
    version: 1,
    eventId: "event",
  }));
  expect(await store.pending()).toHaveLength(0);
});
it("another account cannot read the earlier account cache, drafts or pending work", async () => {
  let store = open();
  await store.init();
  await store.enqueue("progress", command);
  await store.cache("library", [{ titleId: "private" }]);
  db.close();
  store = open("bob");
  await store.init();
  expect(await store.pending()).toHaveLength(0);
  expect(await store.cached("library")).toBeNull();
  expect(await store.draft("log")).toBeNull();
});
it("purging owner storage removes pending actions, drafts and cache", async () => {
  const store = open();
  await store.init();
  await store.enqueue("progress", command);
  await store.saveDraft("log", { note: "private" });
  await store.cache("library", []);
  await store.purge();
  expect(await store.pending()).toHaveLength(0);
  expect(await store.draft("log")).toBeNull();
  expect(await store.cached("library")).toBeNull();
});
it("an immutable submitted draft remains available when editable form text changes", async () => {
  const store = open();
  await store.init();
  await store.enqueue("progress", { ...command, note: "submitted words" });
  await store.saveDraft("log:movie", { note: "new unfinished words" });
  expect(await store.draft("submitted:" + command.commandId)).toMatchObject({
    note: "submitted words",
    baseVersion: 0,
  });
});
it("an HTTP 409 stops automatic retries and preserves the original command", async () => {
  const store = open();
  await store.init();
  await store.enqueue("progress", command);
  await drain(store, async () => {
    throw Object.assign(new Error("Version changed"), {
      status: 409,
      code: "conflict",
    });
  });
  expect((await store.pending())[0].status).toBe("conflict");
  expect((await store.pending())[0].payload).toEqual(command);
});
