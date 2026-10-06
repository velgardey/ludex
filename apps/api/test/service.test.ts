import test from "node:test";
import assert from "node:assert/strict";
import { SqliteRepository } from "../src/store/sqlite.ts";
import { LudexService } from "../src/service.ts";
import { AuthService } from "../src/auth/principal.ts";
import { catalog } from "../src/catalog/seed.ts";
async function fixture() {
  const repo = new SqliteRepository(":memory:");
  const service = new LudexService(repo);
  await service.initialize();
  const auth = new AuthService(repo, { mode: "local", inviteCode: "invite" });
  const a = await auth.signup({
    inviteCode: "invite",
    email: "a@example.test",
    password: "a-long-secret-password",
    displayName: "Alice",
  });
  const b = await auth.signup({
    inviteCode: "invite",
    email: "b@example.test",
    password: "b-long-secret-password",
    displayName: "Bob",
  });
  return {
    repo,
    service,
    auth,
    a: { userId: a.user.id, roles: a.user.roles },
    b: { userId: b.user.id, roles: b.user.roles },
  };
}
const command = (titleId = catalog[0].id) => ({
  commandId: crypto.randomUUID(),
  titleId,
  baseVersion: 0,
  change: {
    kind: "movie-viewed" as const,
    titleId,
    runId: crypto.randomUUID(),
  },
  occurredAt: { precision: "day" as const, day: "2026-10-06" },
  audience: { kind: "public" as const },
  spoiler: { kind: "none" as const },
  note: "Good evening",
});
test("progress retries exactly once, changed receipt payload rejects and stale edit conflicts", async () => {
  const { service, a, repo } = await fixture();
  const cmd = command();
  const first = await service.applyProgress(a, cmd);
  assert.deepEqual(await service.applyProgress(a, cmd), first);
  assert.equal((await service.readLibrary(a))[0].version, 1);
  assert.equal((await repo.list(`user:${a.userId}`, "event:")).length, 1);
  assert.equal(
    (await service.applyProgress(a, { ...cmd, note: "changed" })).status,
    "rejected",
  );
  assert.equal(
    (
      await service.editLibrary(a, {
        commandId: crypto.randomUUID(),
        titleId: cmd.titleId,
        baseVersion: 0,
        patch: { rating: 9 },
      })
    ).status,
    "conflict",
  );
  repo.close();
});
test("private logs have no social projection and correction immediately retracts public activity", async () => {
  const { service, a, b, repo } = await fixture();
  await service.follow(b, a.userId, true);
  const cmd = command();
  const result = await service.applyProgress(a, cmd);
  assert.equal(
    (
      await service.readFeed(
        { userId: b.userId, policyRevision: 0 },
        { filter: "following", limit: 20 },
      )
    ).items.length,
    1,
  );
  assert.equal(result.status, "accepted");
  if (result.status === "accepted")
    await service.correctProgress(a, {
      commandId: crypto.randomUUID(),
      eventId: result.eventId,
      baseVersion: 1,
      retract: true,
    });
  assert.equal(
    (
      await service.readFeed(
        { userId: b.userId, policyRevision: 0 },
        { filter: "following", limit: 20 },
      )
    ).items.length,
    0,
  );
  await service.applyProgress(a, {
    ...command(catalog[3].id),
    audience: { kind: "private" },
  });
  assert.equal((await repo.list("social", "activity:")).length, 1);
  repo.close();
});
test("follows grant public only, friendship accept grants friends, block overrides both directions", async () => {
  const { service, a, b, repo } = await fixture();
  await service.follow(b, a.userId, true);
  await service.applyProgress(a, {
    ...command(),
    audience: { kind: "friends" },
  });
  const query = { filter: "following" as const, limit: 20 };
  assert.equal(
    (await service.readFeed({ userId: b.userId, policyRevision: 0 }, query))
      .items.length,
    0,
  );
  await service.setFriendship(a, b.userId, "request");
  await service.setFriendship(b, a.userId, "accept");
  assert.equal(
    (await service.readFeed({ userId: b.userId, policyRevision: 0 }, query))
      .items.length,
    1,
  );
  await service.blockUser(a, b.userId);
  assert.equal(
    (await service.readFeed({ userId: b.userId, policyRevision: 0 }, query))
      .items.length,
    0,
  );
  assert.deepEqual(await service.discoverUsers(b, ""), []);
  repo.close();
});
test("spoiler text omitted from JSON until all episode requirements watched", async () => {
  const { service, a, b, repo } = await fixture();
  const title = catalog[1];
  await service.follow(b, a.userId, true);
  await service.applyProgress(a, {
    ...command(title.id),
    change: {
      kind: "episode-watched",
      titleId: title.id,
      runId: crypto.randomUUID(),
      episodeId: title.episodes![0].id,
    },
    note: "secret-boss-name",
    spoiler: {
      kind: "episodes",
      showId: title.id,
      requiredEpisodeIds: [title.episodes![0].id, title.episodes![1].id],
    },
  });
  const feed = await service.readFeed(
    { userId: b.userId, policyRevision: 0 },
    { filter: "following", limit: 20 },
  );
  assert.ok(!JSON.stringify(feed).includes("secret-boss-name"));
  assert.equal(feed.items[0].detailHidden, true);
  repo.close();
});
test("showcase private shelves omitted; owner version checked; deletion cuts sessions and visibility immediately", async () => {
  const { service, a, b, repo } = await fixture();
  await service.saveShowcase(a, {
    commandId: crypto.randomUUID(),
    baseVersion: 0,
    showcase: {
      userId: a.userId,
      version: 0,
      theme: "lounge",
      shelves: [
        {
          id: "private",
          title: "secret shelf",
          layout: "covers",
          itemIds: [catalog[0].id],
          audience: { kind: "private" },
        },
        {
          id: "public",
          title: "Films",
          layout: "covers",
          itemIds: [catalog[3].id],
          audience: { kind: "public" },
        },
      ],
    },
  });
  assert.deepEqual(
    (
      await service.readShowcase(
        { userId: b.userId, policyRevision: 0 },
        a.userId,
      )
    ).shelves.map((s) => s.id),
    ["public"],
  );
  await service.follow(b, a.userId, true);
  await service.applyProgress(a, command());
  const { jobId } = await service.requestDeletion(a);
  await assert.rejects(
    service.readShowcase({ userId: b.userId, policyRevision: 0 }, a.userId),
  );
  await service.processDeletion(jobId);
  await service.processDeletion(jobId);
  assert.equal(
    (
      await service.readFeed(
        { userId: b.userId, policyRevision: 0 },
        { filter: "following", limit: 20 },
      )
    ).items.length,
    0,
  );
  assert.equal(
    (await repo.list(`user:${a.userId}`)).filter((r) => r.id !== "write-guard")
      .length,
    0,
  );
  repo.close();
});
test("social showcase and collection retries preserve exact receipt in their transaction", async () => {
  const { service, a, repo } = await fixture();
  const input = {
    commandId: crypto.randomUUID(),
    baseVersion: 0,
    showcase: {
      userId: a.userId,
      version: 0,
      theme: "lounge" as const,
      shelves: [],
    },
  };
  const first = await service.saveShowcase(a, input);
  assert.deepEqual(await service.saveShowcase(a, input), first);
  const collection = {
    commandId: crypto.randomUUID(),
    id: crypto.randomUUID(),
    version: 0,
    title: "Weekend",
    titleIds: [catalog[0].id],
    audience: { kind: "public" as const },
  };
  const saved = await service.saveCollection(a, collection);
  assert.deepEqual(await service.saveCollection(a, collection), saved);
  assert.equal(
    (
      await service.saveShowcase(a, {
        ...input,
        showcase: { ...input.showcase, theme: "midnight" },
      })
    ).status,
    "rejected",
  );
  repo.close();
});
test("hidden title/art and blocked reply bodies absent from JSON", async () => {
  const { service, a, b, repo } = await fixture();
  await service.follow(b, a.userId, true);
  const cmd = {
    ...command(),
    spoiler: { kind: "hidden" as const, titleId: catalog[0].id },
    note: "hidden-secret",
  };
  const res = await service.applyProgress(a, cmd);
  assert.equal(res.status, "accepted");
  if (res.status !== "accepted") return;
  const feed = await service.readFeed(
    { userId: b.userId, policyRevision: 0 },
    { filter: "following", limit: 20 },
  );
  assert.ok(!JSON.stringify(feed).includes(catalog[0].artwork!));
  assert.ok(!JSON.stringify(feed).includes(catalog[0].id));
  await service.addReply(a, {
    commandId: crypto.randomUUID(),
    activityId: res.eventId,
    text: "reply-secret",
    spoiler: { kind: "hidden", titleId: catalog[0].id },
  });
  assert.ok(
    !JSON.stringify(
      await service.readReplies(
        { userId: b.userId, policyRevision: 0 },
        res.eventId,
      ),
    ).includes("reply-secret"),
  );
  repo.close();
});
test("circles require owner membership and review edits retract immediately", async () => {
  const { service, a, b, repo } = await fixture();
  await service.setFriendship(a, b.userId, "request");
  await service.setFriendship(b, a.userId, "accept");
  const circle = await service.saveCircle(a, {
    id: crypto.randomUUID(),
    name: "Film night",
    memberIds: [b.userId],
  });
  const cmd = {
    ...command(),
    audience: { kind: "circle" as const, circleId: circle.id },
  };
  await service.applyProgress(a, cmd);
  assert.equal(
    (
      await service.readFeed(
        { userId: b.userId, policyRevision: 0 },
        { filter: "circle", circleId: circle.id, limit: 20 },
      )
    ).items.length,
    1,
  );
  await service.saveCircle(a, {
    id: circle.id,
    name: "Film night",
    memberIds: [],
  });
  assert.equal(
    (
      await service.readFeed(
        { userId: b.userId, policyRevision: 0 },
        { filter: "circle", circleId: circle.id, limit: 20 },
      )
    ).items.length,
    0,
  );
  const published = await service.publishReview(a, {
    commandId: crypto.randomUUID(),
    titleId: catalog[0].id,
    baseVersion: 0,
    text: "first review",
    audience: { kind: "public" },
    spoiler: { kind: "none" },
  });
  await service.editReview(a, {
    activityId: published.activityId,
    baseVersion: 1,
    text: "edited review",
    retract: false,
  });
  assert.equal(
    (
      await service.readActivity(
        { userId: b.userId, policyRevision: 0 },
        published.activityId,
      )
    ).note,
    "edited review",
  );
  await service.editReview(a, {
    activityId: published.activityId,
    baseVersion: 2,
    retract: true,
  });
  await assert.rejects(
    service.readActivity(
      { userId: b.userId, policyRevision: 0 },
      published.activityId,
    ),
  );
  repo.close();
});
test("historical observations remain quiet and current audience prevents publication retry", async () => {
  const { service, a, b, repo } = await fixture();
  await service.follow(b, a.userId, true);
  const cmd = command();
  const observation = {
    observationId: "o1",
    source: "csv" as const,
    accountId: a.userId,
    titleId: cmd.titleId,
    change: cmd.change,
    occurredAt: cmd.occurredAt,
    observedAt: new Date().toISOString(),
    historical: true,
    confidence: "exact" as const,
    payloadHash: "abc",
  };
  const result = await service.ingestObservation(a, observation);
  assert.deepEqual(await service.ingestObservation(a, observation), result);
  assert.equal(
    (
      await service.readFeed(
        { userId: b.userId, policyRevision: 0 },
        { filter: "following", limit: 20 },
      )
    ).items.length,
    0,
  );
  repo.close();
});
test("publication drain skips completed receipts rather than starving after first page", async () => {
  const { service, a, b, repo } = await fixture();
  await service.follow(b, a.userId, true);
  for (let i = 0; i < 25; i++) {
    await service.applyProgress(a, {
      ...command(),
      commandId: `fixed-${String(i).padStart(3, "0")}`,
      baseVersion: i,
    });
  }
  assert.equal(
    (
      await service.readFeed(
        { userId: b.userId, policyRevision: 0 },
        { filter: "following", limit: 50 },
      )
    ).items.length,
    25,
  );
  repo.close();
});
test("expired owner export is unavailable and excludes third-party private records", async () => {
  const { service, a, b, repo } = await fixture();
  await service.applyProgress(b, {
    ...command(),
    audience: { kind: "private" },
    note: "bob-private-secret",
  });
  await service.applyProgress(a, {
    ...command(),
    audience: { kind: "private" },
    note: "alice-private-note",
  });
  const exported = await service.exportAccount(a);
  const data = await service.downloadExport(a, exported.downloadId);
  assert.ok(JSON.stringify(data).includes("alice-private-note"));
  assert.ok(!JSON.stringify(data).includes("bob-private-secret"));
  const record = (await repo.read(
    `user:${a.userId}`,
    `export:${exported.downloadId}`,
  ))!;
  await repo.transact(record.scope, [
    {
      kind: "replace",
      value: {
        ...record,
        body: { ...(record.body as object), expiresAt: "2000-01-01T00:00:00Z" },
      },
      expectedEtag: record.etag,
    },
  ]);
  await assert.rejects(
    service.downloadExport(a, exported.downloadId),
    /export-expired/,
  );
  repo.close();
});
test("policy changes invalidate cursor and pages have no duplicate boundary", async () => {
  const { service, a, b, repo } = await fixture();
  await service.follow(b, a.userId, true);
  for (let i = 0; i < 4; i++)
    await service.applyProgress(a, { ...command(), baseVersion: i });
  const query = { filter: "following" as const, limit: 2 };
  const page = await service.readFeed(
    { userId: b.userId, policyRevision: 0 },
    query,
  );
  assert.ok(page.nextCursor);
  const next = await service.readFeed(
    { userId: b.userId, policyRevision: 0 },
    { ...query, cursor: page.nextCursor },
  );
  assert.equal(
    new Set([...page.items, ...next.items].map((i) => i.id)).size,
    4,
  );
  await service.setFriendship(a, b.userId, "request");
  await assert.rejects(
    service.readFeed(
      { userId: b.userId, policyRevision: 0 },
      { ...query, cursor: page.nextCursor },
    ),
    /Your feed changed/,
  );
  repo.close();
});
test("spoiler scopes reject empty requirements and mismatched title bindings", async () => {
  const { service, a, repo } = await fixture();
  const show = catalog[1];
  await assert.rejects(
    service.applyProgress(a, {
      ...command(show.id),
      change: {
        kind: "episode-watched",
        titleId: show.id,
        runId: "run",
        episodeId: show.episodes![0].id,
      },
      spoiler: { kind: "episodes", showId: show.id, requiredEpisodeIds: [] },
    }),
  );
  await assert.rejects(
    service.applyProgress(a, {
      ...command(),
      spoiler: { kind: "hidden", titleId: catalog[3].id },
    }),
    /spoiler-title-mismatch/,
  );
  await assert.rejects(
    service.publishReview(a, {
      commandId: crypto.randomUUID(),
      baseVersion: 0,
      titleId: catalog[0].id,
      text: "secret",
      audience: { kind: "public" },
      spoiler: {
        kind: "episodes",
        showId: show.id,
        requiredEpisodeIds: [show.episodes![0].id],
      },
    }),
    /spoiler-title-mismatch/,
  );
  repo.close();
});
test("account deletion denies a previously authenticated principal writing any new data", async () => {
  const { service, a, repo } = await fixture();
  const { jobId } = await service.requestDeletion(a);
  await assert.rejects(service.applyProgress(a, command()), /account-disabled/);
  await assert.rejects(
    service.saveSettings(a, { region: "US" }),
    /account-disabled/,
  );
  await service.processDeletion(jobId);
  await assert.rejects(service.applyProgress(a, command()), /account-disabled/);
  assert.equal(
    (await repo.list(`user:${a.userId}`)).filter((r) => r.id !== "write-guard")
      .length,
    0,
  );
  repo.close();
});
test("conflicted deletion remains queued until confirmed cleanup retry", async () => {
  const { service, a, repo } = await fixture();
  await service.applyProgress(a, {
    ...command(),
    audience: { kind: "private" },
  });
  const { jobId } = await service.requestDeletion(a);
  const original = repo.transact.bind(repo);
  let failOnce = true;
  repo.transact = async (s, ops) => {
    if (
      s === `user:${a.userId}` &&
      ops.some((o) => o.kind === "delete") &&
      failOnce
    ) {
      failOnce = false;
      return "conflict";
    }
    return original(s, ops);
  };
  await assert.rejects(service.processDeletion(jobId), /deletion-conflict/);
  assert.equal(
    (
      (await repo.read("social", `deletion:${jobId}`))!.body as {
        status: string;
      }
    ).status,
    "queued",
  );
  await service.processDeletion(jobId);
  assert.equal(
    (
      (await repo.read("social", `deletion:${jobId}`))!.body as {
        status: string;
      }
    ).status,
    "done",
  );
  repo.close();
});
test("concurrent identical corrections return identical accepted receipts", async () => {
  const { service, a, repo } = await fixture();
  const first = await service.applyProgress(a, command());
  if (first.status !== "accepted") throw Error("fixture");
  const correction = {
    commandId: crypto.randomUUID(),
    eventId: first.eventId,
    baseVersion: first.version,
    retract: true,
  };
  const results = await Promise.all([
    service.correctProgress(a, correction),
    service.correctProgress(a, correction),
  ]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(results[0].status, "accepted");
  repo.close();
});
test("expired exports are removed and re-export keeps one active snapshot", async () => {
  const { service, a, repo } = await fixture();
  const first = await service.exportAccount(a);
  const record = (await repo.read(
    `user:${a.userId}`,
    `export:${first.downloadId}`,
  ))!;
  await repo.transact(record.scope, [
    {
      kind: "replace",
      value: {
        ...record,
        body: { ...(record.body as object), expiresAt: "2000-01-01T00:00:00Z" },
      },
      expectedEtag: record.etag,
    },
  ]);
  await assert.rejects(service.downloadExport(a, first.downloadId));
  assert.equal(await repo.read(record.scope, record.id), null);
  await service.exportAccount(a);
  await service.exportAccount(a);
  assert.equal((await repo.list(record.scope, "export:")).length, 1);
  repo.close();
});
test("deletion tombstone defeats an already in-flight progress transaction", async () => {
  const { service, a, repo } = await fixture();
  const original = repo.transact.bind(repo);
  let release!: () => void;
  let arrived!: () => void;
  const waiting = new Promise<void>((r) => {
    arrived = r;
  });
  const pause = new Promise<void>((r) => {
    release = r;
  });
  repo.transact = async (s, ops) => {
    if (
      s === `user:${a.userId}` &&
      ops.some((o) => o.kind === "create" && o.value.id.startsWith("event:"))
    ) {
      arrived();
      await pause;
    }
    return original(s, ops);
  };
  const pending = service.applyProgress(a, command());
  await waiting;
  const { jobId } = await service.requestDeletion(a);
  await service.processDeletion(jobId);
  release();
  assert.equal((await pending).status, "conflict");
  assert.equal(
    (await repo.list(`user:${a.userId}`)).filter((r) => r.id !== "write-guard")
      .length,
    0,
  );
  repo.close();
});

test('deletion guard conflict leaves recoverable queued job and worker closes it before cleanup',async()=>{const{service,a,repo}=await fixture();const original=repo.transact.bind(repo);let fail=true;repo.transact=async(s,ops)=>{if(fail&&s===`user:${a.userId}`&&ops.some(o=>o.kind!=='delete'&&o.value.id==='write-guard'&&(o.value.body as{closed?:boolean}).closed)){fail=false;return'conflict';}return original(s,ops);};await assert.rejects(service.requestDeletion(a),/deletion-conflict/);const jobs=await repo.list('social','deletion:');assert.equal(jobs.length,1);await service.processDeletion((jobs[0].body as{jobId:string}).jobId);assert.equal(((await repo.read('social',jobs[0].id))!.body as{status:string}).status,'done');assert.equal(((await repo.read(`user:${a.userId}`,'write-guard'))!.body as{closed:boolean}).closed,true);repo.close();});
