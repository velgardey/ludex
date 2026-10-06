import test from "node:test";
import assert from "node:assert/strict";
import { createConnectionsClient, type DiscussionScope } from "../src/connections.ts";

test("connection overview, review observations, and import history use protected routes", async () => {
  const calls: unknown[][] = [];
  const values = [
    { connections: [], capabilities: { steam: false, csv: true } },
    [{ id: "observation-1", source: "netflix-extension", status: "needs-review" }],
    [{ id: "import-1", source: "letterboxd", status: "preview" }],
  ];
  const client = createConnectionsClient({
    request: async (...args: unknown[]) => {
      calls.push(args);
      return values.shift();
    },
  });

  assert.deepEqual(await client.readConnections(), {
    connections: [],
    capabilities: { steam: false, csv: true },
  });
  assert.deepEqual(await client.readObservations(), [
    { id: "observation-1", source: "netflix-extension", status: "needs-review" },
  ]);
  assert.deepEqual(await client.readImports(), [
    { id: "import-1", source: "letterboxd", status: "preview" },
  ]);
  assert.deepEqual(calls, [
    ["/connections"],
    ["/connections/observations"],
    ["/imports"],
  ]);
});

test("preview sends pasted or uploaded CSV to the server and commit requires the explicit batch ID", async () => {
  const calls: unknown[][] = [];
  const preview = { id: "batch/one", status: "preview", rows: [] };
  const result = { status: "queued", jobId: "job-1" };
  const job = { jobId: "job-1", status: "completed", accepted: 1, remaining: 0, rows: [] };
  const client = createConnectionsClient({
    request: async (...args: unknown[]) => {
      calls.push(args);
      return [preview, result, job][calls.length - 1];
    },
  });
  const csv = "Date,Name,Year\n2024-05-01,Dune,2021";

  assert.deepEqual(await client.previewImport("letterboxd", csv), preview);
  assert.deepEqual(await client.commitImport("batch/one"), result);
  assert.deepEqual(await client.readImportJob("/api/imports/jobs/job-1"), job);
  assert.deepEqual(calls, [
    ["/imports/preview", { source: "letterboxd", csv }],
    ["/imports/batch%2Fone/commit", undefined, "POST"],
    ["/imports/jobs/job-1"],
  ]);

  await assert.rejects(client.readImportJob("https://example.com/steal"), /poll URL/i);
});

test("import review searches the real catalog and maps a selected title and episode to one row", async () => {
  const calls: unknown[][] = [];
  const matches = [{ id: "tmdb:show:42", title: "Example Show", media: "show" }];
  const mapped = {
    id: "row-1",
    status: "matched",
    matchedTitleId: "tmdb:show:42",
    episodeId: "tmdb:episode:42:1",
  };
  const client = createConnectionsClient({
    request: async (...args: unknown[]) => {
      calls.push(args);
      return calls.length === 1 ? matches : mapped;
    },
  });

  assert.deepEqual(await client.searchCatalog("Example Show", "show"), matches);
  assert.deepEqual(await client.matchImportRow("batch/one", "row/one", {
    titleId: "tmdb:show:42",
    episodeId: "tmdb:episode:42:1",
  }), mapped);
  assert.deepEqual(calls, [
    ["/catalog/search?text=Example+Show&media=show"],
    ["/imports/batch%2Fone/rows/row%2Fone/match", { titleId: "tmdb:show:42", episodeId: "tmdb:episode:42:1" }],
  ]);
});

test("import row mapping rejects empty identifiers before making a request", async () => {
  let requests = 0;
  const client = createConnectionsClient({ request: async () => { requests++; return {}; } });

  await assert.rejects(client.matchImportRow("batch-1", "row-1", { titleId: " " }), /title/i);
  await assert.rejects(client.matchImportRow("batch-1", "row-1", { titleId: "tmdb:show:1", episodeId: " " }), /episode/i);
  assert.equal(requests, 0);
});

test("Steam preview and observation confirmation require explicit user choices", async () => {
  const calls: unknown[][] = [];
  const preview = { observations: [{ id: "steam-1", title: "A game", appId: "42", status: "matched" }] };
  const confirmed = { status: "confirmed" };
  const client = createConnectionsClient({
    request: async (...args: unknown[]) => {
      calls.push(args);
      return calls.length < 3 ? preview : confirmed;
    },
  });

  assert.deepEqual(await client.previewSteam("76561198012345678"), preview);
  assert.deepEqual(await client.previewSteam("76561198012345678", 100), preview);
  assert.deepEqual(await client.confirmObservation("steam-1", {
    titleId: "game-42",
    media: "game",
  }), confirmed);
  await assert.rejects(client.previewSteam("not-a-steam-id"), /17-digit/i);
  assert.deepEqual(calls, [
    ["/connections/steam/preview", { steamId64: "76561198012345678" }],
    ["/connections/steam/preview", { steamId64: "76561198012345678", offset: 100 }],
    ["/connections/observations/steam-1/confirm", { titleId: "game-42", media: "game" }],
  ]);
});

test("plan methods preserve the request contract and encode plan IDs", async () => {
  const calls: unknown[][] = [];
  const values = [
    [{ id: "plan-1", title: "Friday film" }],
    { id: "plan/one", version: 1 },
    { id: "plan/one", candidates: [] },
    { titleId: "film-1" },
    { rsvp: "maybe" },
    [{ id: "message-1", detailHidden: true }],
    { id: "message-2" },
  ];
  const client = createConnectionsClient({
    request: async (...args: unknown[]) => {
      calls.push(args);
      return values.shift();
    },
  });
  const create = {
    title: "Friday film",
    memberIds: ["person-1"],
    startsAt: "2026-10-09T18:30:00Z",
  };
  const scope: DiscussionScope = { kind: "episodes", showId: "show-1", requiredEpisodeIds: ["ep-1"] };

  assert.deepEqual(await client.readPlans(), [{ id: "plan-1", title: "Friday film" }]);
  assert.deepEqual(await client.createPlan(create), { id: "plan/one", version: 1 });
  assert.deepEqual(await client.readPlan("plan/one"), { id: "plan/one", candidates: [] });
  assert.deepEqual(await client.addShortlist("plan/one", "film-1"), { titleId: "film-1" });
  assert.deepEqual(await client.setRsvp("plan/one", "maybe"), { rsvp: "maybe" });
  assert.deepEqual(await client.readDiscussion("plan/one"), [{ id: "message-1", detailHidden: true }]);
  assert.deepEqual(await client.addDiscussion("plan/one", "Spoiler thought", scope), { id: "message-2" });
  assert.deepEqual(calls, [
    ["/plans"],
    ["/plans", create],
    ["/plans/plan%2Fone"],
    ["/plans/plan%2Fone/shortlist", { titleId: "film-1" }],
    ["/plans/plan%2Fone/rsvp", { rsvp: "maybe" }],
    ["/plans/plan%2Fone/discussion"],
    ["/plans/plan%2Fone/discussion", { text: "Spoiler thought", scope }],
  ]);
});

test("invalid import source and empty discussion text are rejected before requests", async () => {
  let requests = 0;
  const client = createConnectionsClient({
    request: async () => {
      requests++;
      return {};
    },
  });

  await assert.rejects(client.previewImport("steam" as never, "title\nDune"), /source/i);
  await assert.rejects(client.addDiscussion("plan-1", "  ", { kind: "none" }), /message/i);
  assert.equal(requests, 0);
});

test("server request failures propagate without fallback data", async () => {
  const failure = new Error("plan not found");
  const client = createConnectionsClient({
    request: async () => {
      throw failure;
    },
  });

  await assert.rejects(client.readConnections(), (error) => error === failure);
  await assert.rejects(client.readPlan("missing"), (error) => error === failure);
  await assert.rejects(client.readDiscussion("missing"), (error) => error === failure);
});
