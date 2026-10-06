# Ludex Migration and Connected Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring existing libraries into Ludex and update permitted Steam/Netflix/RetroAchievements progress without duplicates, false completions or unwanted public posts.

**Architecture:** Importers and connectors emit typed observations into the foundation's shared reconciliation pipeline. User-partition checkpoints/correction assertions and deterministic receipts protect retries; explicit source/event settings control separate social projection, while the browser extension stores durable minimal observations locally.

**Tech Stack:** Foundation TypeScript/Functions/Cosmos contracts, CSV and bounded ZIP parsing, Steam Web API/OpenID, Trakt OAuth/Sync API, Chrome Manifest V3 on Chrome/Edge, Expo native clients, RetroAchievements Web API, Vitest/Playwright and real provider-account tests.

**Spec:** [Beta specification](../../product/ludex-beta-spec.md), [imports/emulation research](../../research/imports-and-emulation.md), [integration research](../../research/integration-depth-2026-10-06.md), [foundation interfaces](2026-10-06-ludex-foundation.md).

## Global Constraints

- Android only for beta, with a companion website; global English-speaking testers.
- Free non-commercial invited beta: 100 accounts, roughly 10–20 simultaneous users.
- US$10/month service target; existing Azure credits/deployments may subsidize it. Underlying spend and cash paid are reported separately.
- One backend region, immediate local feedback and measured foreground refresh.
- Atmospheric cinema lounge; exceptional cinematic showcase/feed is the first acceptance priority.
- Directed public follows plus accepted friends/circles; reviews, collections and discovery are core.
- Curated themes and configurable shelves; optional ten-point ratings, likes and text.
- Explicit per-source/event sharing, then selected automatic posts. Presence is separate opt-in and may be public.
- Letterboxd + Trakt historical importers and generic mapped CSV.
- Steam + desktop Chrome/Edge Netflix extension first; quick capture, optional validated detection, transparent confirmed-log fallback.
- Emulated titles: manual catalog/session support plus optional RetroAchievements. Original release/platform, device/emulator and achievement source stay distinct.
- A central contextual conversational companion; short metered conversations, clear fallback, minimal relevant permitted context and inspectable memory.
- Confirm every assistant write in beta, including memory changes and sharing/publication.
- Shared shortlists, RSVP/time and scoped discussions. Direct interactions interrupt first; activity digest is optional.
- Persistent cinematic Android feed/showcase first; integrations and AI follow.
- Build/operate through Codex; no deadline supplied. No recurring agent automation is implied.

## Boundaries and prerequisites

A1–A9 contracts must pass before this stage. Reuse `ProviderObservation`, `ingestObservation`, `applyProgress`, correction assertions and source-publication outbox. Never create a parallel importer that writes social documents directly. Trakt is a historical importer in this stage, not a promise of continuous sync. Steam and extension capture are the first automatic/capture integrations; RetroAchievements is optional and key/access-gated. Provider docs establish possible capabilities, while runtime evidence is recorded separately.

### B1: Import preview, provenance, mapped CSV and reversible batches

**Files:** Create `packages/contracts/src/imports.ts`, `packages/domain/src/imports.ts`, `packages/domain/test/imports.test.ts`, `apps/api/src/imports/preview.ts`, `apps/api/src/imports/commit.ts`, `apps/api/src/imports/reverse.ts`, `apps/api/src/imports/csv.ts`, `apps/api/src/imports/matching.ts`, `apps/api/src/functions/imports.ts`, `apps/api/test/imports.test.ts`, `web/imports/ImportWizard.tsx`, `app/import/page.tsx`, `apps/mobile/src/features/imports/ImportStatus.tsx`, `docs/imports/ludex-template.csv`, `docs/imports/format.md`.

**Interfaces:**

```ts
export type ImportInput = {
  source: 'csv' | 'letterboxd' | 'trakt'; uploadId?: Id;
  mapping?: Record<string, string>; selectedCategories: ('history' | 'ratings' | 'lists' | 'watchlist' | 'notes')[];
};
export type ImportRow = {
  rowId: string; sourceRecordId?: string; title: string; media: MediaType;
  year?: number; providerIds: Record<string, string>; date: DateValue;
  sourceRating?: { value: number; maximum: number };
  sourceText?: string; listNames: string[]; change?: ProgressChange;
};
export type ImportPreview = {
  batchId: Id; exact: number; review: number; duplicate: number;
  rows: { rowId: string; matchedTitleId?: Id; candidateIds: Id[]; issue?: string }[];
  nextCursor?: string;
};
export type ImportResult = { batchId: Id; accepted: number; skipped: number; needsReview: number; status: 'running' | 'complete' | 'reversed' };
```

Define these in `packages/contracts/src/imports.ts` with runtime schemas. `previewImport(principal: Principal, input: ImportInput): Promise<ImportPreview>`, `commitImport(principal: Principal, batchId: Id): Promise<ImportResult>`, `reverseImport(principal: Principal, batchId: Id): Promise<ImportResult>` and `resolveImportRow(principal, input: { batchId: Id; rowId: string; titleId: Id }): Promise<void>` validate batch ownership/version. `convertSourceRating(value: number, maximum: number): { display: number; original: {value: number; maximum: number} }` is owned by this task; display retains decimals from exact transformation in a separate source-rating field, while manually entered beta scores stay integers. Do not pass a transformed fractional score through manual `normalizeRating`; an imported display value remains source-attributed until explicitly replaced by an integer Ludex score.

- [ ] Write failing tests: CSV multiline/Unicode, missing score, 4.5/5→9/10 retaining original, day-only date without timezone shift, same title in two lists, two legitimate rewatches, repeated upload, ambiguous remake, preview/commit ownership, partial job resume and reversal preserving later manual rating/note. Run `pnpm test:domain imports` and `pnpm test:api imports`.

```ts
test('reversing a batch keeps a later manual rating', async () => {
  const batch = await importFixture(alice, { sourceScore: 4.5, sourceScale: 5 });
  await setManualRating(alice, batch.titleId, 7);
  await service.reverseImport(alice, batch.batchId);
  expect((await readLibrary(alice, batch.titleId)).rating).toBe(7);
});
```

Define fixture helpers in `imports.test.ts` against the A2 repository/A3 commands; `setManualRating` calls `editLibrary(principal, { commandId, titleId, baseVersion, patch: { rating } })` established by A3, not a test-only direct overwrite.

- [ ] Implement streaming bounded CSV validation and column mapper. Enforce spec size/row caps, literal text/no formula execution, allowed media/status/date/score ranges and source identity. Exact provider IDs resolve first, then exact title/year/type; ambiguous candidates never commit automatically. Dedup fingerprints include source, record fields/date and multiplicity to retain legitimate repeat rows; when indistinguishable, show a duplicate-review choice rather than silently delete a rewatch.

```csv
media_type,title,year,provider,provider_id,date,date_precision,rating,rating_scale,status,list,notes
movie,Example Film,2024,tmdb_movie,example-id,2025-04-06,day,4.5,5,watched,Favorites,User-provided note
```

The example provider ID is intentionally illustrative; real imports must validate actual namespace/ID. Template documents namespaced movie/show/episode/game IDs and explicit episode/run requirements. A show count without episode identity cannot manufacture a watched set; use an unresolved progress field until reviewed.

- [ ] Preview categories, counts, date/score transformation and uncertain matches. Default notes/reviews to private import; imported public text requires a separate publish action. Commit bounded chunks with deterministic row receipts and a batch watermark; retry continues at last accepted row. Library progress and provenance commit together. No historical outbox post, notification or presence.
- [ ] Reversal retracts batch-owned assertions/list memberships only; preserve later edits, comments and shelf references, explaining records retained by later user activity. Uploads expire after completion/24 hours. Web performs local parse when feasible; backend revalidates because clients are untrusted. Android tracks jobs/review queue; file-heavy management can open companion.
- [ ] Run tests and `pnpm build`; add a Playwright import flow with exact/ambiguous rows, cancel, reupload and reversal. Commit scoped changes with a documented working generic CSV importer.

### B2: Letterboxd archive adapter and Trakt authorized historical migration

**Files:** Create `apps/api/src/imports/letterboxd.ts`, `apps/api/src/imports/trakt.ts`, `apps/api/src/connectors/trakt/auth.ts`, `apps/api/src/connectors/credentials.ts`, `apps/api/src/functions/trakt.ts`, `apps/api/test/letterboxd.test.ts`, `apps/api/test/trakt-import.test.ts`, `apps/api/test/archive-security.test.ts`, `docs/validation/import-source-coverage.md`; update `web/imports/ImportWizard.tsx`, `docs/imports/format.md`.

**Interfaces:** `parseLetterboxd(archive: Uint8Array): Promise<ImportRow[]>`; `readTraktImport(principal: Principal, selection: ImportInput['selectedCategories']): Promise<ImportRow[]>`; `CredentialStore.put(userId: Id, source: string, encryptedValue: string): Promise<void>` and `delete(userId: Id, source: string): Promise<void>` store per-user encrypted credentials separately from social/provider payloads. Refresh-token rotation is conditional and scoped to that connection.

- [ ] Obtain current permitted test-export schemas and register Trakt app access during execution. Record exact supported archive filenames/headers/API fields and license/retention conditions; sample fixture anonymization preserves structure without personal reviews. No undocumented scraping or other people's histories. If an export column is absent, coverage explicitly excludes it.
- [ ] Write failing parser/security tests: malformed/oversized ZIP, expansion bomb, path traversal, duplicate filenames, encoding, actual observed CSV headers, multiple diary entries, source list order and rating date. Trakt tests cover PKCE/state mismatch, refresh expiry, pagination, 429 Retry-After, 401, changed consent, duplicate history IDs, episode-ID crosswalk and abort/disconnect. Run `pnpm test:api letterboxd trakt-import archive-security`.

```ts
test('archive path traversal is rejected before extraction', async () => {
  await expect(parseLetterboxd(zipWithEntry('../outside.csv', 'Title,Year')))
    .rejects.toThrow('unsafe-archive-path');
});
```

`zipWithEntry` is a test fixture builder, defined in `archive-security.test.ts`; extraction never writes arbitrary uploaded paths to disk.

- [ ] Implement observed Letterboxd field adapters without inferring undocumented schema from its separate importer guide. Map diary/watchlist/rating/list/review fields only when present and tested; preserve source URLs/row identity/authored dates. Use B1 preview/commit; provide generic CSV fallback for unsupported file variants.
- [ ] Implement user-bound Trakt OAuth/PKCE and read only selected own history/ratings/watchlist/lists. Import is asynchronous/paged/rate-limited and quiet; namespaced exact IDs precede mapping review. Retain API tokens only for this authorized import unless the user chooses a separately supported ongoing connection. Revoke/delete tokens after a one-time import where feasible; document provider behavior.
- [ ] Compare real consenting source totals and sampled rows with Ludex preview/import, repeat migration, correct a score then retry/reverse, and disconnect mid-job. Record source/date/precision coverage and unmatched counts in `import-source-coverage.md`. Run the tests and imported-library web/device flow before advertising these sources; commit scoped task.

### B3: Steam identity, snapshots, source sharing and presence

**Files:** Create `packages/contracts/src/connections.ts`, `apps/api/src/connectors/steam/auth.ts`, `apps/api/src/connectors/steam/client.ts`, `apps/api/src/connectors/steam/sync.ts`, `apps/api/src/connectors/settings.ts`, `apps/api/src/connectors/presence.ts`, `apps/api/src/functions/steam.ts`, `apps/api/src/workers/connectors.ts`, `apps/api/test/steam.test.ts`, `apps/api/test/source-sharing.test.ts`, `apps/mobile/src/features/connections/ConnectionsScreen.tsx`, `web/connections/ConnectionsScreen.tsx`, `docs/validation/steam-coverage.md`.

**Interfaces:** `ConnectionSettings = { source: Source; enabled: boolean; audience: Audience; sharedEvents: ProgressChange['kind'][]; presenceAudience?: Audience; hiddenTitleIds: Id[]; version: number }`; `saveConnectionSettings(principal, settings: ConnectionSettings): Promise<void>`. `syncSteam(userId: Id, now: string): Promise<{ observations: number; state: ConnectionState }>`; define `ConnectionState = 'connected' | 'syncing' | 'stale' | 'rate-limited' | 'permission-limited' | 'failed' | 'disconnected'`. `readPresence(viewer: Viewer, userId: Id, now: string): Promise<{ titleId: Id; observedAt: string; expiresAt: string } | null>` rechecks audience/title hide/expiry.

- [ ] Verify permitted Steam API usage/key, validated OpenID claimed ID/return URL/nonce binding and privacy-dependent actual payloads. Record unlock-date availability, ownership/free-to-play semantics and edition mappings. Steam OpenID proves identity but does not unlock private game data. Secrets are server-held; connection binds to the authenticated Ludex account.
- [ ] Write failing tests: initial snapshot quiet, repeated snapshot no event, newly unlocked achievement one event, private visibility not treated as deleting library, correction/tombstone beats replay, hidden title absent from presence, source setting defaults private, disconnect cancels jobs, stale expires. Run `pnpm test:api steam source-sharing`.

```ts
test('presence expires even when no stop event arrives', async () => {
  await seedSteamPresence('alice', 'game1', '2026-10-06T10:00:00Z');
  expect(await service.readPresence(bobViewer, 'alice', '2026-10-06T10:06:00Z')).toBeNull();
});
```

- [ ] Implement snapshot/diff checkpoints and provider-identity receipts; store source timestamps only when supplied, otherwise unknown/observed precision. Ownership/playtime increment does not become story completion. Achievement label/provider mapping is used as evidence; arbitrary boss names are not generated. Avoid scanning every owned game's achievements every tick; daily library, eligible changed/recent game polling and batched profile checks follow spec/operator cap. Record request counts/quota failures.
- [ ] Apply per-source/event sharing opt-in independent of credentials and presence. Public presence requires an explicit choice, with per-title hide and five-minute expiry. Show last successful check/permission-limited/rate-limited status and direct repair. Connect/disconnect retains manual notes and can separately remove source history.
- [ ] Test consenting public/private-game accounts, an actually supported achievement game, source settings, repeated polls, correction and reconnect. Compare provider payload to app display and follower feed, recording measured freshness rather than live claims. Run tests/device flows; commit scoped task.

### B4: Chrome/Edge quick capture and optional Netflix detection

**Files:** Create `apps/extension/package.json`, `apps/extension/tsconfig.json`, `apps/extension/manifest.json`, `apps/extension/src/popup.tsx`, `apps/extension/src/auth.ts`, `apps/extension/src/worker.ts`, `apps/extension/src/storage.ts`, `apps/extension/src/netflix/capture.ts`, `apps/extension/src/netflix/observe.ts`, `apps/extension/src/netflix/coverage.ts`, `apps/extension/test/coverage.test.ts`, `apps/extension/test/worker.test.ts`, `apps/extension/e2e/capture.spec.ts`, `apps/api/src/functions/extension.ts`, `apps/api/test/extension-auth.test.ts`, `docs/validation/netflix-extension.md`, `docs/operations/extension-privacy.md`.

**Interfaces:** `CaptureCandidate = { provider: 'netflix'; pageUrl: string; title: string; episodeLabel?: string; profileLabel?: string }`; `PlaybackSample = { sessionId: string; position: number; duration: number; wallTime: number; playing: boolean; seeking: boolean; identityVerified: boolean }`; `classifyCoverage(samples: PlaybackSample[]): 'unconfirmed' | 'completion-candidate'`. `uploadObservation(principal: Principal, observation: ProviderObservation): Promise<CommandResult>` routes through shared ingestion; `bindExtension(principal, input: { deviceCode: string }): Promise<{ deviceId: Id }>` creates a revocable per-device connection.

- [ ] Build quick capture first with user click + `activeTab`/scripting/storage, backend-origin-only permission and narrow optional Netflix host permission for detection. Implement a PKCE or short-lived device-pairing flow without copying Netflix cookies/passwords; extension token grants only its user's capture/upload actions and is revocable. Link popup title candidates to B1/A2 matching and A3 confirmed commands. Account/profile mapping must be user-visible.
- [ ] Write failing coverage/worker tests: page-open, seeking near end, skipped span, trailer, pause/stop, buffer, profile change, autoplay episode change, worker shutdown, duplicate upload, offline recovery, multiple tabs and invalid token owner. Run `pnpm --filter @ludex/extension test` and `pnpm test:api extension-auth`.

```ts
test('seeking to the final minute does not prove completion', () => {
  expect(classifyCoverage([
    { sessionId: 's', position: 10, duration: 2400, wallTime: 0, playing: true, seeking: false, identityVerified: true },
    { sessionId: 's', position: 2350, duration: 2400, wallTime: 1, playing: true, seeking: true, identityVerified: true }
  ])).toBe('unconfirmed');
});
```

- [ ] Implement visible title/profile capture, candidate confirmation and quick save/log. Detection samples only permissioned DOM/player observations; no protected video extraction/private API/credentials. Record continuous plausible watched intervals using wall-time deltas and seeking/buffering flags; interval coverage and confirmed identity are necessary but insufficient without real site validation. Conservative initial completion-candidate threshold is 90% continuous observed unique runtime; output remains a confirmed-log proposal until actual site semantics/false-positive tests justify automation. Never infer completed from ended alone. Persist session ID/coverage and upload queue through MV3 sleep; dedup across tabs/provider record identities conservatively.
- [ ] Add adapter capability flag default off for automatic completion. Real compatibility test may enable it only for the tested site/version/profile behavior after explicit user sharing/detection consent. Low-confidence/changed-markup state disables detection and retains capture. User can turn off site permission and see what data is stored/uploaded. Popup status explains Desktop Netflix coverage, not Android streaming-app telemetry.
- [ ] Compare actual consenting Netflix playback with emitted observations for complete episode, partial, seek, stop, autoplay, household profile switch and browser suspend/offline. Test Chrome and Edge packaged extension, token revoke and service-worker termination. Record exact tested versions/selector observations/coverage and misses; abstract HTML-video tests do not establish Netflix compatibility. Commit working capture even if automation remains gated.

### B5: Optional RetroAchievements and emulated-title reconciliation

**Files:** Create `apps/api/src/connectors/retroachievements/client.ts`, `apps/api/src/connectors/retroachievements/sync.ts`, `apps/api/src/functions/retroachievements.ts`, `apps/api/test/retroachievements.test.ts`, `docs/validation/retroachievements-coverage.md`; update connection screens, `packages/contracts/src/connections.ts` and credential store source allowlist.

**Interfaces:** `syncRetroAchievements(userId: Id, now: string): Promise<{ observations: number; state: ConnectionState }>` emits provider observations with game/set/account identity and casual/hardcore mode. `mapEmulatedRelease(principal, input: { providerGameId: string; titleId: Id; originalPlatform: string; edition?: string; playedOn?: string; emulator?: string }): Promise<void>` validates explicit binding and does not merge it with another Steam/remaster release.

- [ ] Validate current Web API terms, production key access, encryption/log-redaction and stable user ULID/payloads. Key is submitted through a protected connection flow, never in social documents/client logs. If source credentials/access cannot be safely supported, leave RetroAchievements capability unavailable with manual sessions; no universal emulator claim.
- [ ] Write failing tests for hardcore/casual independent unlocks, renamed user stable ID, overlapping earned-date windows, repeat receipt, game-set mismatch, unknown dates, revoked key/429, disconnect and no boss/story inference from playtime. Run `pnpm test:api retroachievements`.

```ts
test('hardcore and casual achievements do not collapse into one mode', async () => {
  await ingestRaFixture('casual');
  await ingestRaFixture('hardcore');
  expect(await achievementModes('alice', 'ra-game')).toEqual(['casual', 'hardcore']);
});
```

Fixture helpers use shared ingestion and documented provider IDs; mode is part of the receipt/assertion identity where the provider treats modes separately.

- [ ] Implement bounded recent-game pull/watermark with overlap/backfill and explicit last-check status, respecting actual rate guidance. RA earned dates and account-lifetime sets stay separate from manual playthroughs and original-platform/device/emulator metadata. No ROM upload/hash scanning requirement; optional provided set identity is metadata only. Initial history quiet, future selected unlocks shared through B3 settings/A3 outbox.
- [ ] Exercise one supported real game/account/mode, repeated poll, correction, reconnect and wrong-edition mapping. Record field coverage/source freshness and operational limits; run tests/device checks and commit the gated optional adapter.

### B6: Connector health, grouping and failure release gate

**Files:** Create `apps/api/src/connectors/health.ts`, `apps/api/src/social/group-session.ts`, `apps/api/test/connector-failures.test.ts`, `apps/api/test/group-session.test.ts`, `apps/mobile/test/connections.test.tsx`, `docs/operations/connectors.md`, `docs/validation/connections-release.md`; update `docs/validation/execution-record.md` and connection screens.

**Interfaces:** `readConnectionHealth(principal: Principal): Promise<{ source: Source; state: ConnectionState; lastCheckedAt?: string; lastEventAt?: string; imported: number; nextAction?: string }[]>`; `groupSession(events: ProviderObservation[]): { groupId: string; eventIds: string[] }[]` uses source/account/run/session identity plus a 30-minute inactivity boundary, never grouping unrelated hidden/public scopes.

- [ ] Write failing tests for transient 429/5xx, exponential bounded retry, disconnect while queued, rotated credentials, missing permission, dead-letter retry, correction between capture/upload/publication, delayed historical event and grouped-event edits. Run `pnpm test:api connector-failures group-session` and extension/mobile tests.
- [ ] Implement capped scheduler concurrency/request ledger, persistent checkpoint and retry state, permission repair/reconnect/manual retry. Reads stop immediately on disconnect. Presence hidden immediately, imported history removal separate. Group raw updates into existing session spread, retaining exact underlying IDs/times; edits/retractions update existing activity without renotifying. Historical backfill never creates live sessions.
- [ ] Run real-source controlled tests and all shared regressions. Record each source as verified fields + constraints, unavailable gate or capture-only; never replace this with a green connected badge. Meter request volume, database RU/outbox lag and backing storage in 20-active workload.
- [ ] Stage B gate: tested Letterboxd/Trakt/CSV migration paths, preview/reversal/idempotency; permitted Steam data; working packaged Chrome/Edge capture; Netflix confirmed fallback; optional RA status; per-source publication/presence controls; correction and disconnection. Publish honest coverage in `connections-release.md`, then commit the reviewed stage.
