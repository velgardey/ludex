import test from "node:test";
import assert from "node:assert/strict";
import { LudexClient } from "../src/index.ts";
test("default browser fetch keeps its required global receiver", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = function (this: unknown) {
    assert.equal(this, globalThis, "browser fetch receiver");
    return Promise.resolve(
      new Response(JSON.stringify({ id: "user" }), { status: 200 }),
    );
  } as typeof fetch;
  try {
    const client = new LudexClient();
    assert.equal((await client.me()).id, "user");
  } finally {
    globalThis.fetch = original;
  }
});
test("command conflicts return the typed receipt so durable outbox stops retrying", async () => {
  const client = new LudexClient({
    fetch: async () =>
      new Response(
        JSON.stringify({
          status: "conflict",
          commandId: "one",
          currentVersion: 3,
        }),
        { status: 409 },
      ),
  });
  const result = await client.editLibrary({
    commandId: "one",
    titleId: "title",
    baseVersion: 0,
    patch: { note: "my retained draft" },
  });
  assert.deepEqual(result, {
    status: "conflict",
    commandId: "one",
    currentVersion: 3,
  });
});
