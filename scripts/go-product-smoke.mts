import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { LudexClient } from "../packages/client/src/index.ts";
const baseUrl = process.env.LUDEX_SMOKE_API ?? "http://localhost:4000/api";
const invite = process.env.LUDEX_SMOKE_INVITE;
if (!invite)
  throw new Error(
    "Set local LUDEX_SMOKE_INVITE; this script creates disposable local accounts.",
  );
const suffix = randomUUID().slice(0, 8);
const alice = new LudexClient({ baseUrl }),
  bob = new LudexClient({ baseUrl });
const a = await alice.signup({
  email: `alice-${suffix}@example.test`,
  displayName: "Mira · beta test",
  password: randomUUID(),
  inviteCode: invite,
});
const b = await bob.signup({
  email: `bob-${suffix}@example.test`,
  displayName: "Noah · beta test",
  password: randomUUID(),
  inviteCode: invite,
});
const movies = await alice.searchCatalog({ text: "Dune", media: "movie" });
assert.ok(movies.length);
const games = await alice.searchCatalog({ text: "Hades", media: "game" });
assert.ok(games.length);
const movie = movies.find((t) => t.title === "Dune") ?? movies[0];
await alice.getTitle(movie.id);
await bob.follow(a.user.id);
const command = {
  commandId: randomUUID(),
  baseVersion: 0,
  titleId: movie.id,
  change: {
    kind: "movie-viewed" as const,
    titleId: movie.id,
    runId: randomUUID(),
  },
  occurredAt: { precision: "day" as const, day: "2026-10-07" },
  audience: { kind: "public" as const },
  spoiler: { kind: "none" as const },
  note: "A vast world. A small moment worth keeping.",
  rating: 9,
};
const receipt = await alice.applyProgress(command);
assert.equal(receipt.status, "accepted");
assert.deepEqual(await alice.applyProgress(command), receipt);
assert.ok(
  (await bob.readFeed()).items.some((item) => item.title.id === movie.id),
);
const shelf = await alice.readShowcase(a.user.id);
await alice.saveShowcase({
  commandId: randomUUID(),
  baseVersion: shelf.version,
  showcase: {
    ...shelf,
    shelves: [
      {
        id: randomUUID(),
        title: "Worlds I return to",
        layout: "covers",
        itemIds: [movie.id],
        audience: { kind: "public" },
      },
    ],
  },
});
const plan = await alice.request<{ id: string }>("/plans", {
  title: "After hours · Friday",
  memberIds: [b.user.id],
  startsAt: "2026-10-09T20:00:00Z",
});
await bob.request(`/plans/${plan.id}/rsvp`, { rsvp: "yes" });
await alice.request(`/plans/${plan.id}/shortlist`, { titleId: movie.id });
await bob.request(`/plans/${plan.id}/discussion`, {
  text: "Same time, different worlds.",
  scope: { kind: "none" },
});
assert.ok(
  (await alice.request<unknown[]>(`/plans/${plan.id}/discussion`)).length,
);
const ai = await alice.request<{ assistantMessage: { fallback: boolean } }>(
  "/assistant/messages",
  { text: "What have I watched?", requestId: randomUUID() },
);
assert.equal(ai.assistantMessage.fallback, true);
const imported = await alice.request<{ id: string; rows: { id: string }[] }>(
  "/imports/preview",
  {
    source: "letterboxd",
    csv: "Name,Year,Watched Date,Rating\nDune,1984,2026-10-05,4.5",
  },
);
assert.ok(imported.rows.length);
const job = await alice.request<{ jobId: string; pollUrl: string }>(
  `/imports/${imported.id}/commit`,
  {},
);
assert.ok(job.jobId);
const capture = await alice.request<{ id: string }>("/connections/capture", {
  title: movie.title,
  url: "https://www.netflix.com/watch/123",
  observationId: randomUUID(),
  video: { paused: true, currentTime: 50, duration: 100 },
});
assert.ok(capture.id);
await alice.request(`/connections/observations/${capture.id}/confirm`, {
  titleId: movie.id,
  media: "movie",
  date: "2026-10-07",
});
const exported = await alice.exportAccount();
const data = await alice.request(
  "/account/download?id=" + encodeURIComponent(exported.downloadId),
);
assert.ok(data);
writeFileSync(
  ".local/go-smoke-session.json",
  JSON.stringify({
    session: a,
    bob: b,
    movie,
    game: games[0],
    planId: plan.id,
    importJob: job,
  }),
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    status: "passed",
    realAccounts: 2,
    liveCatalog: { movies: movies.length, games: games.length },
    progressReplay: true,
    feed: true,
    showcase: true,
    plans: true,
    assistantFallback: true,
    importQueued: true,
    captureConfirmed: true,
    export: true,
  }),
);
