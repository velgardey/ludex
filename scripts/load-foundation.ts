import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { SqliteRepository } from "../apps/api/src/store/sqlite.ts";
import { AuthService } from "../apps/api/src/auth/principal.ts";
import { startServer } from "../apps/api/src/server.ts";
import { LudexClient } from "../packages/client/src/index.ts";
import type { Session } from "../packages/domain/src/types.ts";

async function main() {
  const args = process.argv.slice(2);
  function option(name: string, fallback: string) {
    const index = args.indexOf(name);
    return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
  }
  const users = Number(option("--users", "100"));
  const active = Number(option("--active", "20"));
  const rounds = Number(option("--rounds", "3"));
  const output = option("--output", "");
  if (
    !Number.isInteger(users) ||
    users < 2 ||
    users > 100 ||
    !Number.isInteger(active) ||
    active < 1 ||
    active > 20 ||
    active > users ||
    !Number.isInteger(rounds) ||
    rounds < 1 ||
    rounds > 10
  )
    throw Error(
      "Use 2–100 users, 1–20 active (no more than users), and 1–10 rounds.",
    );
  const directory = mkdtempSync(join(tmpdir(), "ludex-load-"));
  const dbPath = join(directory, "load.sqlite");
  const repo = new SqliteRepository(dbPath);
  const auth = new AuthService(repo, {
    mode: "local",
    inviteCode: "load-only",
    maxAccounts: 100,
  });
  const sessions: Session[] = [];
  const seedStarted = performance.now();
  for (let i = 0; i < users; i++)
    sessions.push(
      await auth.signup({
        inviteCode: "load-only",
        email: `load-${i}@example.test`,
        password: "disposable-load-password",
        displayName: `Load user ${String(i).padStart(3, "0")}`,
      }),
    );
  repo.close();
  const seedMs = performance.now() - seedStarted;
  let app = await startServer({ port: 0, dbPath });
  let api = `http://localhost:${app.port}/api`;
  type Sample = { path: string; ms: number; status: number; bytes: number };
  const samples: Sample[] = [];
  const transport: typeof fetch = async (input, init) => {
    const started = performance.now();
    const response = await fetch(input, init);
    const body = await response.clone().text();
    samples.push({
      path: new URL(String(input)).pathname,
      ms: performance.now() - started,
      status: response.status,
      bytes: Buffer.byteLength(body),
    });
    return response;
  };
  const clients = sessions
    .slice(0, active)
    .map(
      (s) =>
        new LudexClient({ baseUrl: api, token: s.token, fetch: transport }),
    );
  const catalog = await clients[0].searchCatalog();
  const movie = catalog.find((t) => t.media === "movie")!;
  const workloadStarted = performance.now();
  await Promise.all(
    clients.map(async (client, index) => {
      for (let k = 1; k <= Math.min(3, users - 1); k++)
        await client.follow(sessions[(index + k) % users].user.id);
      for (let round = 0; round < rounds; round++) {
        await client.readLibrary();
        await client.searchCatalog({ text: round % 2 ? "Dune" : "" });
        await client.applyProgress({
          commandId: randomUUID(),
          titleId: movie.id,
          baseVersion: round,
          change: {
            kind: "movie-viewed",
            titleId: movie.id,
            runId: randomUUID(),
          },
          occurredAt: { precision: "day", day: "2026-10-06" },
          audience: { kind: "public" },
          spoiler: { kind: "none" },
          note: `Disposable load round ${round}`,
        });
        await client.readFeed({ limit: 20, filter: "following" });
        await client.readShowcase(sessions[index].user.id);
      }
    }),
  );
  const workloadMs = performance.now() - workloadStarted;
  await app.close();
  app = await startServer({ port: 0, dbPath });
  api = `http://localhost:${app.port}/api`;
  const restored = new LudexClient({
    baseUrl: api,
    token: sessions[0].token,
    fetch: transport,
  });
  const library = await restored.readLibrary();
  assert.equal(library[0].version, rounds);
  assert.equal(library[0].runs.length, rounds);
  assert.equal((await restored.me()).id, sessions[0].user.id);
  await app.close();
  rmSync(directory, { recursive: true, force: true });
  const percentile = (values: number[], p: number) => {
    const sorted = [...values].sort((a, b) => a - b);
    return Number(
      (sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0).toFixed(2),
    );
  };
  const endpoints = Object.fromEntries(
    [...new Set(samples.map((s) => s.path))].map((path) => {
      const group = samples.filter((s) => s.path === path);
      return [
        path,
        {
          requests: group.length,
          p50Ms: percentile(
            group.map((s) => s.ms),
            0.5,
          ),
          p95Ms: percentile(
            group.map((s) => s.ms),
            0.95,
          ),
          errors: group.filter((s) => s.status >= 400).length,
          responseBytes: group.reduce((n, s) => n + s.bytes, 0),
        },
      ];
    }),
  );
  const report = {
    date: new Date().toISOString(),
    environment: "disposable local Node HTTP + SQLite, same host; not Azure",
    users,
    active,
    rounds,
    foregroundRefresh:
      "scripted rounds; 30-second real-device polling not measured",
    seedMs: Number(seedMs.toFixed(2)),
    workloadMs: Number(workloadMs.toFixed(2)),
    requests: samples.length,
    p50Ms: percentile(
      samples.map((s) => s.ms),
      0.5,
    ),
    p95Ms: percentile(
      samples.map((s) => s.ms),
      0.95,
    ),
    errors: samples.filter((s) => s.status >= 400).length,
    responseBytes: samples.reduce((n, s) => n + s.bytes, 0),
    restartPersistence: true,
    endpoints,
    cloudRU: "unmeasured",
    cloudColdStarts: "unmeasured",
    crossRegion: "unmeasured",
    outboxLag: "immediate local drain, not a cloud lag measurement",
    cost: "unmeasured",
    deviceInteraction: "unmeasured",
  };
  if (output) writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  if (report.errors) process.exitCode = 1;
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
