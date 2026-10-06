import test from "node:test";
import assert from "node:assert/strict";
import { createAssistantClient } from "../src/assistant.ts";

test("assistant state loads persisted messages and allowance from the server", async () => {
  const calls: unknown[][] = [];
  const state = {
    status: "unconfigured",
    allowance: { remaining: 2, limit: 5 },
    messages: [
      {
        id: "reply-1",
        role: "assistant",
        text: "A quiet mystery might fit tonight.",
        createdAt: "2026-10-07T10:00:00Z",
        fallback: true,
        citations: [{ id: "title-1", label: "The Quiet House" }],
      },
    ],
  };
  const client = createAssistantClient({
    request: async (...args: unknown[]) => {
      calls.push(args);
      return state;
    },
  });

  assert.deepEqual(await client.readState(), state);
  assert.deepEqual(calls, [["/assistant/state"]]);
});

test("assistant messages require text and send a caller supplied request ID", async () => {
  const calls: unknown[][] = [];
  const result = { status: "accepted" };
  const client = createAssistantClient({
    request: async (...args: unknown[]) => {
      calls.push(args);
      return result;
    },
  });

  await assert.rejects(client.sendMessage("  ", "req-1"), /message is required/i);
  assert.deepEqual(calls, []);
  assert.deepEqual(await client.sendMessage("Suggest a short game", "req-2"), result);
  assert.deepEqual(calls, [
    ["/assistant/messages", { text: "Suggest a short game", requestId: "req-2" }],
  ]);
});

test("action confirmation and rejection use explicit POST routes with encoded IDs", async () => {
  const calls: unknown[][] = [];
  const client = createAssistantClient({
    request: async (...args: unknown[]) => {
      calls.push(args);
      return { status: "confirmed" };
    },
  });

  await client.confirmAction("save/collection");
  await client.rejectAction("save/collection");
  assert.deepEqual(calls, [
    ["/assistant/actions/save%2Fcollection/confirm", undefined, "POST"],
    ["/assistant/actions/save%2Fcollection/reject", undefined, "POST"],
  ]);
});

test("assistant request failures propagate without manufacturing replies", async () => {
  const unavailable = new Error("AI allowance exhausted");
  const client = createAssistantClient({
    request: async () => {
      throw unavailable;
    },
  });

  await assert.rejects(client.readState(), (error) => error === unavailable);
  await assert.rejects(client.sendMessage("Recommend a film", "req-3"), (error) => error === unavailable);
});
