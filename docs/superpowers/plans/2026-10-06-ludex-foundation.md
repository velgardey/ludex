# Ludex Cinematic Social Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a persistent cinematic Android feed/showcase backed by real invited accounts, manual entertainment logs and permitted social interactions.

**Architecture:** Expo Android and the existing static Next companion call one Functions API. Framework-independent domain rules feed a private transactional command store and an eventual public/social projection; SQLite preserves owner drafts and pending commands on Android.

**Tech Stack:** TypeScript, pnpm 11.24.0, Next 16.3.8/React 19.2.8, Expo SDK 57 candidate, Expo Router/SQLite/SecureStore, Azure Functions v4, Cosmos NoSQL, Entra External ID, Blob Storage, Vitest, React Native Testing Library, Playwright and Android device automation.

**Spec:** [Beta specification](../../product/ludex-beta-spec.md), [delivery overview](2026-10-06-ludex-delivery.md). Task names A1–A9 are stable coverage identifiers.

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

## File boundaries and test convention

Create `apps/mobile`, `apps/api`, `packages/domain`, `packages/contracts`, `packages/client`, `packages/design`. Keep root `app/` for web. Every package has a scoped `tsconfig.json`, `typecheck` and appropriate `test` script; root web has `test:web`. Runtime validation uses Zod; domain Vitest fixtures contain invented users/content, not private archives. Native tests use SDK-compatible Jest/React Native Testing Library; actual device tests use release-like binaries. Establish `pnpm test:domain`, `pnpm test:api`, `pnpm test:web`, `pnpm test:mobile`, `pnpm typecheck`, `pnpm verify` root scripts in A1/A2. Each task's command is a planned executable acceptance command, not a claim it currently exists.

### A1: Workspace and precise media rules

**Files:** Modify `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `eslint.config.mjs`; create `packages/domain/package.json`, `packages/domain/tsconfig.json`, `packages/domain/src/types.ts`, `packages/domain/src/progress.ts`, `packages/domain/src/spoilers.ts`, `packages/domain/test/progress.test.ts`, `packages/domain/test/spoilers.test.ts`, `packages/contracts/src/progress.ts`, `packages/contracts/src/http.ts`, `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `vitest.config.ts`.

**Interfaces:** Copy `Id`, `Audience`, `DateValue`, `ProgressChange`, `ProgressCommand`, `CommandResult`, `ProviderObservation`, `LibraryPatch`, `LibraryEditCommand`, `Principal`, `Viewer`, `FeedQuery`, `VisibleActivity`, `FeedPage` and `SpoilerScope` verbatim from the specification into `types.ts`. Export `canReveal(viewedIds: Set<Id>, requiredIds: Id[]): boolean`, `nextEpisode(episodes: Episode[], watched: Set<Id>, skipped: Set<Id>, now: string): Episode | null`, `normalizeRating(value: number | undefined): number | undefined`. Define `Episode = { id: Id; order: number; releasedAt: string | null }` here.

- [ ] Add pnpm workspace globs `apps/*` and `packages/*` while preserving `allowBuilds`. Root web includes only `app/**/*.ts`, `app/**/*.tsx`, `web/**/*.ts`, `web/**/*.tsx`, shared package source, Next generated types and root config; native/API code type-check separately. Add Vitest and Zod with lockfile-pinned versions. Test scripts below run scoped projects.

```json
{
  "test:domain": "vitest run --project domain",
  "test:api": "vitest run --project api",
  "test:web": "vitest run --project web",
  "test:mobile": "pnpm --filter @ludex/mobile test --runInBand",
  "typecheck": "tsc --noEmit && pnpm --filter './packages/*' --filter './apps/*' --if-present typecheck",
  "verify": "pnpm lint && pnpm typecheck && pnpm test:domain && pnpm test:api && pnpm test:web && pnpm test:mobile && pnpm build"
}
```

- [ ] Write these failing domain tests; run `pnpm test:domain` and observe missing exports before implementation.

```ts
import { expect, test } from 'vitest';
import { nextEpisode, normalizeRating } from '../src/progress';
import { canReveal } from '../src/spoilers';
test('a gap is not watched even when a later episode is watched', () => {
  expect(canReveal(new Set(['e1', 'e3']), ['e1', 'e2'])).toBe(false);
  expect(nextEpisode([
    { id: 'e1', order: 1, releasedAt: '2026-01-01' },
    { id: 'e2', order: 2, releasedAt: '2026-01-02' },
    { id: 'e3', order: 3, releasedAt: '2026-01-03' }
  ], new Set(['e1', 'e3']), new Set(), '2026-10-06')?.id).toBe('e2');
});
test('logging does not require a score and accepts integer ten-point scores', () => {
  expect(normalizeRating(undefined)).toBeUndefined();
  expect(normalizeRating(9)).toBe(9);
  expect(() => normalizeRating(11)).toThrow();
  expect(() => normalizeRating(4.5)).toThrow();
});
```

- [ ] Implement small pure functions; define parsed dates without converting day/month values into fabricated instants. Add tests for future episodes, specials chosen by explicit order, rewatches, game story completion versus achievements and original platform versus emulator/device.

```ts
export const canReveal = (viewedIds: Set<string>, requiredIds: string[]) =>
  requiredIds.every(id => viewedIds.has(id));
export function normalizeRating(value: number | undefined) {
  if (value === undefined) return value;
  if (!Number.isInteger(value) || value < 1 || value > 10) throw new Error('rating-range');
  return value;
}
```

- [ ] Run `pnpm test:domain` and shared typechecks; commit only workspace/domain changes with `git commit -m "feat: define shared media and progress contracts"` after staging the listed files.

### A2: Real invited identity, catalog and Azure storage boundary

**Files:** Create `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/host.json`, `apps/api/src/auth/principal.ts`, `apps/api/src/auth/invitations.ts`, `apps/api/src/store/repository.ts`, `apps/api/src/store/sqlite.ts`, `apps/api/src/store/cosmos.ts`, `apps/api/src/catalog/service.ts`, `apps/api/src/catalog/tmdb.ts`, `apps/api/src/catalog/igdb.ts`, `apps/api/src/functions/account.ts`, `apps/api/src/functions/catalog.ts`, `apps/api/test/auth.test.ts`, `apps/api/test/repository.contract.test.ts`, `apps/api/test/catalog.test.ts`, `infra/main.bicep`, `infra/parameters.example.json`, `docs/validation/azure-prerequisites.md`, `.env.example`.

**Interfaces:** `verifyBearer(token: string): Promise<Principal>` validates issuer/audience/signature/expiry and invited-account binding. `searchCatalog(principal: Principal, query: { text: string; media?: MediaType; region: string }): Promise<CatalogHit[]>`, with `CatalogHit = { id: Id; media: MediaType; title: string; year?: number; providerIds: Record<string,string>; artwork?: string }`. `Repository` supplies `read(scope: string, id: string): Promise<Stored | null>` and `transact(scope: string, operations: Operation[]): Promise<'committed' | 'conflict'>`; define `Stored = { id: string; scope: string; version: number; body: unknown; etag: string }` and `Operation = { kind: 'create'; value: Stored } | { kind: 'replace'; value: Stored; expectedEtag: string } | { kind: 'delete'; id: Id; expectedEtag: string }`. Operations remain within one scope; SDK errors map to conflict.

- [ ] Record subscription eligibility, one-region choice, credit expiry/balance, model marginal billing, External ID native/browser redirect support and catalog terms. Quote on-demand Functions, backing storage, Cosmos offer, uploads/egress and telemetry. No deployment is authorized by writing this plan; when execution includes deployment, prepare Bicep/what-if and a reviewed quote before resource creation. No credential appears in docs or `.env.example`.
- [ ] Write failing tests using repository contracts and generated local JWTs. Cases: wrong issuer/audience, expired/unsigned token, authenticated but uninvited account, client-supplied user ID mismatch, mixed-scope transaction rejection and conditional write conflict. Run `pnpm test:api auth repository`.

```ts
test('one partition transaction rejects mixed scopes', async () => {
  const result = repo.transact('user:alice', [
    { kind: 'create', value: { id: 'x', scope: 'user:bob', version: 1, body: {}, etag: '' } }
  ]);
  await expect(result).rejects.toThrow('scope-mismatch');
});
```

- [ ] Implement local SQLite adapter and Cosmos adapter with identical transaction contract. Only managed backend credentials access Cosmos. Configure OIDC issuer/audience and JWKS; require stable subject binding and atomically reserve one invitation slot up to 100. Moderator role is server-configured, never client-writable. Tokens/secrets are encrypted/protected by deployment mechanisms; native PKCE occurs in the system browser. Add readiness endpoint without revealing configuration secrets.
- [ ] Implement catalog caching/ID mapping with server-held TMDB/IGDB credentials and attribution. Exact source IDs win; ambiguous title/year/edition returns candidates. Search rate limiting, provider timeout and Retry-After return a readable temporary state; manual already-cached logging remains possible. Region availability shows source/freshness, not guaranteed entitlement. Add a seeded small catalog fixture for local tests only.
- [ ] Run local contracts then disposable-cloud repository tests, including multi-operation rollback and ETag races. Record actual account/region/runtime and quote in `azure-prerequisites.md`. `pnpm test:api auth repository catalog` must pass before real invitations. Commit the scoped task.

### A3: Idempotent progress commands, corrections and publication outbox

**Files:** Create `apps/api/src/progress/apply.ts`, `apps/api/src/progress/correct.ts`, `apps/api/src/progress/edit-library.ts`, `apps/api/src/progress/observations.ts`, `apps/api/src/workers/publication.ts`, `apps/api/src/functions/progress.ts`, `apps/api/test/progress.test.ts`, `apps/api/test/publication.test.ts`, `packages/contracts/src/correction.ts`.

**Interfaces:** `editLibrary(principal: Principal, command: LibraryEditCommand): Promise<CommandResult>` plus `applyProgress(principal: Principal, command: ProgressCommand): Promise<CommandResult>` and `ingestObservation(principal: Principal, observation: ProviderObservation): Promise<CommandResult>`; `correctProgress(principal: Principal, input: { commandId: Id; eventId: Id; baseVersion: number; retract: boolean; replacement?: ProgressChange }): Promise<CommandResult>`; `publishPending(userId: Id, limit: number): Promise<number>`.

- [ ] Write failing tests: same command retry gives identical event/version; event+projection+outbox roll back together; private/historical log has no publication; correction beats replay; stale rating/note edit conflicts; distinct episode memberships can merge only without intervening correction. Run `pnpm test:api progress publication`.

```ts
test('retry acknowledges one event without advancing version twice', async () => {
  const first = await service.applyProgress(alice, command);
  const second = await service.applyProgress(alice, command);
  expect(second).toEqual(first);
  expect(await countProgressEvents('alice')).toBe(1);
});
test('quiet history never schedules a social post', async () => {
  await service.ingestObservation(alice, { ...observation, historical: true });
  expect(await pendingPublications('alice')).toHaveLength(0);
});
```

Here `service`, `command`, `alice`, `observation`, `countProgressEvents` and `pendingPublications` are local fixtures defined in `progress.test.ts` against the A2 SQLite repository; count by partition and kind, never global user queries.

- [ ] Implement receipt-first read, version check, domain reduction and one user-partition transaction. Reused command ID with a different payload is rejected. Concurrent duplicate creates return the already-stored receipt. Limit to one title command; bulk work later calls this contract with an import batch receipt.

```ts
// Required transaction contents for a new accepted command:
const ids = {
  receipt: `command:${command.commandId}`,
  event: `event:${command.commandId}`,
  projection: `library:${command.titleId}`,
  outbox: `publish:${command.commandId}`
};
// Create receipt + event, conditionally replace/create projection,
// and create eligible outbox in one user:<id> transaction.
// Conflict returns currentVersion; no partial accepted result is emitted.
```

- [ ] Append correction assertions/tombstones rather than deleting evidence. Undo creates a compensating command conditioned on the affected version. Worker publishes with deterministic activity ID, rechecks current visibility/correction and writes social activity+notification outbox atomically. Retractions/visibility changes deny serialization immediately; failed cleanup is retryable. Do not claim cross-partition atomic publication.
- [ ] Run failure-injection tests after user transaction, after social write and before receipt acknowledgment. One item remains on retry and outbox drain eventually converges. Library patch tests cover rating removal (`null`), liked-only entry, owned/planned/paused/dropped/archive, title/run state correctness and forbidden episode-completion inference. Commit the scoped task after `pnpm test:api progress publication`.

### A4: Follows, safe feed, reviews, replies and discovery

**Files:** Create `apps/api/src/social/relationships.ts`, `apps/api/src/social/visibility.ts`, `apps/api/src/social/feed.ts`, `apps/api/src/social/reviews.ts`, `apps/api/src/social/replies.ts`, `apps/api/src/functions/social.ts`, `apps/api/test/social.test.ts`, `apps/api/test/spoiler-serialization.test.ts`, `packages/contracts/src/social.ts`, `packages/client/package.json`, `packages/client/tsconfig.json`, `packages/client/src/index.ts`, `packages/client/src/http.ts`.

**Interfaces:** `readFeed(viewer: Viewer, query: FeedQuery): Promise<FeedPage>`; `follow(principal: Principal, targetId: Id): Promise<void>`; `setFriendship(principal: Principal, targetId: Id, action: 'request' | 'accept' | 'remove'): Promise<void>`; `publishReview(principal: Principal, input: { commandId: Id; draftId: Id; baseVersion: number; audience: Audience; spoiler: SpoilerScope }): Promise<{ activityId: Id }>`; `addReply(principal: Principal, input: { commandId: Id; activityId: Id; text: string; spoiler: SpoilerScope }): Promise<{ replyId: Id }>`; client exports `LudexClient` with matching HTTP wrappers plus `applyProgress`, `editLibrary` and `readFeed`. Network routes are specified in the beta specification; author identity is always derived from verified tokens.

- [ ] Write failing tests proving followers cannot read friends/circle-only activity; block wins both ways; removing membership invalidates cursors; author hidden fields are absent from API JSON. Review draft save never publishes. Reply edit sends no new notification. Run `pnpm test:api social spoiler-serialization`.

```ts
test('spoiler note and achievement label are omitted, not just visually blurred', async () => {
  const page = await service.readFeed(bobViewer, followingQuery);
  expect(JSON.stringify(page)).not.toContain('secret-boss-name');
  expect(page.items[0].detailHidden).toBe(true);
});
```

Define `bobViewer`, `followingQuery` and seeded scoped activity in this task's test fixture. Include TV gap and unknown game progress variants.

- [ ] Implement bounded `social` partition queries over visible followed authors, chronological publication time/ID, signed policy-bound cursors/ETags, and server-side spoiler projection. Current block and friendship policy governs every reply/reaction/search result. Public recommendation provenance retains only an authorized pointer; removing access leaves the saved catalog title without leaked text.
- [ ] Add follow/unfollow, accepted requests, named circles, mute/title hide, plain-text reviews with persisted drafts, separate publish/edit/retract, like/reaction commands and scoped replies. Rate-limit comments/mentions, reject oversized text and sanitize render output. Basic Discover searches catalog, users, public reviews and public collections; chronological Following remains independent of ranking/AI.
- [ ] Verify empty feeds, 20-item pagination, no duplicate boundary item, policy change between pages, retries and notification idempotency. `pnpm test:api social spoiler-serialization` and client typecheck pass; commit the scoped task.

### A5: Android cinematic shell and durable quick logging

**Files:** Create `apps/mobile/package.json`, `apps/mobile/app.config.ts`, `apps/mobile/tsconfig.json`, `apps/mobile/jest.config.cjs`, `apps/mobile/app/_layout.tsx`, `apps/mobile/app/(tabs)/_layout.tsx`, `apps/mobile/app/(tabs)/index.tsx`, `apps/mobile/app/(tabs)/library.tsx`, `apps/mobile/app/(tabs)/discover.tsx`, `apps/mobile/app/(tabs)/profile.tsx`, `apps/mobile/app/title.tsx`, `apps/mobile/app/log.tsx`, `apps/mobile/src/auth/session.ts`, `apps/mobile/src/storage/database.ts`, `apps/mobile/src/storage/outbox.ts`, `apps/mobile/src/sync/drain.ts`, `apps/mobile/src/features/library/LibraryScreen.tsx`, `apps/mobile/src/features/log/LogSheet.tsx`, `apps/mobile/src/features/companion/CompanionEntry.tsx`, `apps/mobile/test/outbox.test.ts`, `apps/mobile/test/log.test.tsx`, `packages/design/package.json`, `packages/design/tsconfig.json`, `packages/design/src/tokens.ts`.

**Interfaces:** `enqueueProgress(db: SQLiteDatabase, command: ProgressCommand): Promise<void>` atomically stores command plus local pending projection; `drainProgress(client: LudexClient, db: SQLiteDatabase): Promise<{ accepted: number; failed: number }>`; one owner-specific DB/cache is opened per authenticated subject. `LogSheet` consumes catalog title/current run and emits `ProgressCommand`; it does not call provider/model APIs.

- [ ] Generate a stable Expo SDK 57 Router template in `apps/mobile`, inspect generated changes, then install compatible SQLite/SecureStore/linking/font/image/haptic/test packages through Expo. Do not upgrade root Next/React. Add design tokens, licensed font assets/attribution and system fallback; native route names match App Links query routes.

```bash
pnpm dlx create-expo-app@latest apps/mobile --template default@sdk-57
pnpm --dir apps/mobile exec expo install expo-sqlite expo-secure-store expo-linking expo-font expo-image expo-haptics
pnpm --dir apps/mobile exec expo install --check
pnpm --dir apps/mobile dlx expo-doctor
```

If the stable template tag is unavailable at execution, inspect the template's documented SDK selection and choose a verified stable SDK; record the change before installing dependencies, rather than mixing canary packages.

- [ ] Write failing outbox/UI tests: rating optional, next episode preselected correctly, duplicate tap one command, draft survives navigation, account switch hides prior data, conflict never overwrites notes. Run `pnpm test:mobile` and observe intended failures.

```ts
it('reopening the database retains an offline command ID', async () => {
  await enqueueProgress(db, command);
  await closeAndReopenDatabase();
  expect((await pendingCommands())[0].commandId).toBe(command.commandId);
});
```

Test fixture helpers are defined in `outbox.test.ts`; final restart persistence is also a device test, not merely an in-memory database assertion.

- [ ] Implement SQLite WAL/schema migrations, prepared statements and exclusive local transactions. Store refresh credentials in SecureStore, access token in session memory; logout purges user cache/drafts/tokens according to explicit pending-action warning. Network/foreground drains reuse stable IDs. Offline owner data is visible with pending/failed state; restricted friends' feed bodies are memory-only. App restart preserves owner outbox. Never queue an assistant proposal execution without its confirmed immutable payload/version.
- [ ] Build four tabs plus reachable Log/assistant entry, compact title detail, recent titles, movie viewings, episode-set logging, explicit watching/playing session start/end with user-started timer estimate, game session/milestone/story completion, planned/paused/dropped/archive and ownership edits, original edition/device/emulator fields, ten-point optional score, liked/note/date/audience. Select private by default for manual progress; review publication remains separate. Fast undo produces a compensating command. Grid/list density, owned/wishlist filters, archive and saved sorts persist.
- [ ] Validate PKCE system-browser login, slow-network pending UI, offline airplane mode + force-stop + reopen + reconnect, and account isolation on a real Android device. Commands: `pnpm test:mobile`, `pnpm --dir apps/mobile exec expo run:android`. Record device model/build; commit only after local tests and device observations.

### A6: Session-spread feed, showcase editor and collections

**Files:** Create `apps/mobile/src/features/feed/FeedScreen.tsx`, `apps/mobile/src/features/feed/SessionSpread.tsx`, `apps/mobile/src/features/profile/ProfileScreen.tsx`, `apps/mobile/src/features/profile/ShelfEditor.tsx`, `apps/mobile/src/features/collections/CollectionScreen.tsx`, `apps/mobile/test/feed.test.tsx`, `apps/mobile/test/shelves.test.tsx`, `apps/api/src/social/showcase.ts`, `apps/api/src/functions/showcase.ts`, `apps/api/test/showcase.test.ts`, `packages/contracts/src/showcase.ts`, `docs/validation/cinematic-review.md`.

**Interfaces:** Define `Shelf = { id: Id; title: string; layout: 'covers' | 'spread' | 'milestones'; itemIds: Id[]; audience: Audience }`, `Showcase = { userId: Id; version: number; theme: 'lounge' | 'matinee' | 'midnight'; featuredTitleId?: Id; shelves: Shelf[] }`; `saveShowcase(principal: Principal, input: { commandId: Id; baseVersion: number; showcase: Showcase }): Promise<CommandResult>`, and `readShowcase(viewer: Viewer, userId: Id): Promise<Showcase>`. A accepted showcase result uses `eventId` for the audit event. `saveCollection(principal, input: { commandId: Id; id: Id; version: number; title: string; titleIds: Id[]; audience: Audience }): Promise<CommandResult>` uses the same command receipt/version conventions.

- [ ] Write failing tests: shelf reorder survives fetch/restart, hidden/private item not serialized, wrong owner denied, more than 8 shelves/24 items rejected, missing art preserves layout, refresh offers a banner without changing scroll offset. Run `pnpm test:api showcase` and `pnpm test:mobile`.

```ts
test('viewer profile omits inaccessible shelves', async () => {
  await seedPrivateAndPublicShelves('alice');
  const visible = await service.readShowcase(bobViewer, 'alice');
  expect(visible.shelves.map(shelf => shelf.id)).toEqual(['public-favorites']);
});
```

- [ ] Implement theme tokens, aspect-ratio-aware posters/game boxes, focal-point setting, stable no-art fallback, compact rows and session-spread card variants. Scroll is virtualized; artwork resolution follows actual display dimensions and low-data settings. Feed updates arrive through a new-items banner with position restored across details/composition. Failed pending posts remain distinguishable.
- [ ] Implement profile featured work, configurable shelves, selected achievements/manual milestones, mixed-media collections, drag/buttons, draft preview/cancel and versioned save/undo. Catalog items added to a public shelf are explicitly disclosed as public; private notes never accompany them. Changing profile theme does not override reader accessibility/text settings. Basic cross-media Journey is an ordered collection, not a synthetic percentage.
- [ ] Capture populated feed/profile/editor/title/library states on a small and midrange Android device. Check dynamic text, TalkBack, 48 dp targets, contrast pairs, slow art, reduced motion/haptic off, interrupts at 150–250 ms, canceled drag, and 200 feed rows. Record observations/screenshots in `cinematic-review.md`. Use these screens as the style gate before further features; commit the scoped task after tests and review.

### A7: Static companion, share intake and verified links

**Files:** Modify `next.config.ts`, `app/page.tsx`, `app/layout.tsx`, `app/globals.css`; create `app/profile/page.tsx`, `app/activity/page.tsx`, `app/title/page.tsx`, `app/collection/page.tsx`, `app/plan/page.tsx`, `app/library/page.tsx`, `app/settings/page.tsx`, `web/session.ts`, `web/api.ts`, `web/EntityPage.tsx`, `public/staticwebapp.config.json`, `public/.well-known/assetlinks.json`, `apps/mobile/src/links/resolve.ts`, `apps/mobile/src/share/receive.ts`, `apps/mobile/test/links.test.ts`, `web/test/routes.test.tsx`, `e2e/web-shared-pages.spec.ts`, `docs/validation/links-and-sharing.md`.

**Interfaces:** Canonical URL builders use the actual static path plus query ID, e.g. `/profile/?u=<id>` and `/title/?id=<id>`. `resolveIncomingUrl(url: string): { kind: 'title' | 'profile' | 'activity' | 'collection' | 'plan'; id: Id } | null` validates allowed Ludex origin/path/ID. `resolveSharedText(text: string): Promise<CatalogHit[]>` returns choices, never a completion.

- [ ] Write failing route/link tests: cold/warm app, installed/uninstalled, signed-out return destination, revoked private activity, malicious origin/query, unsupported share type and canceled capture. Run `pnpm test:web` and `pnpm test:mobile`.
- [ ] Configure static export and client fetch. `useSearchParams` consumers have required Suspense boundaries per installed Next docs. Read client session only after hydration; no private data in build output. Avoid dynamic `[id]` routes and Server Actions. Functions API is a separate origin with explicit CORS, verified tokens and no wildcard credential origin.

```ts
import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true }
};
export default nextConfig;
```

Art uses correctly sized permitted provider URLs. Static privacy-sensitive API responses are never cached by a public CDN.

- [ ] Implement public showcase/activity/review/collection previews, account/library management, multi-select bulk preview using per-title commands, and settings. A7 plan page can explain stage C availability until plans work. Static generic OpenGraph is explicit; do not claim per-user SEO. Shared links retain destination through OIDC login; query IDs are not authorization.
- [ ] Implement Android text/URL `ACTION_SEND` intake with a supported Expo/native config plugin after real-device validation; system paste/search is the fallback. Image intake is a separately validated enhancement. Add domain `assetlinks.json` with release certificate fingerprint produced during signing, and correct package ID in app config; no invented fingerprint. Verify domain association installed/signed.
- [ ] Run `pnpm build`, serve `out/` with `pnpm dlx serve out -l 3000`, then `pnpm exec playwright test e2e/web-shared-pages.spec.ts`. Test physical Android share from browser/game-store and the URL matrix; record evidence in `links-and-sharing.md`. Commit scoped files after successful build and flow checks.

### A8: Public safety, data ownership and operational controls

**Files:** Create `apps/api/src/social/moderation.ts`, `apps/api/src/account/export.ts`, `apps/api/src/account/delete.ts`, `apps/api/src/functions/moderation.ts`, `apps/api/src/functions/data.ts`, `apps/api/src/workers/deletion.ts`, `apps/api/test/moderation.test.ts`, `apps/api/test/deletion.test.ts`, `app/moderation/page.tsx`, `apps/mobile/app/settings.tsx`, `docs/operations/privacy-retention.md`, `docs/operations/runbook.md`.

**Interfaces:** `blockUser(principal: Principal, targetId: Id): Promise<void>`; `reportContent(principal: Principal, input: { targetId: Id; reason: 'spam' | 'harassment' | 'spoiler' | 'other'; note?: string }): Promise<{ reportId: Id }>`; `exportAccount(principal: Principal): Promise<{ downloadId: Id; expiresAt: string }>`; `requestDeletion(principal: Principal): Promise<{ jobId: Id }>` immediately disables access/public visibility, then `processDeletion(jobId: Id): Promise<void>` clears data/credentials/derived projections idempotently.

- [ ] Write failing tests: block removes discover/feed/replies both ways; non-moderator cannot list reports; deletion cuts API/AI/connector access before asynchronous cleanup; rerun deletion is safe; export contains own source dates/ratings and excludes hidden third-party records. Run `pnpm test:api moderation deletion`.
- [ ] Implement moderator queue with audit trail, remove/restrict/suspend, rate limits, comment controls, report/block and mute. Hide author secrets/private content from report list unless required authorized investigation. Never auto-publish a draft or elevate a role from user input. Add a friendly support/report route and app privacy disclosure.
- [ ] Implement export schema/version and expiring download links. Account deletion revokes sessions/connectors, removes public projections, private records and assistant/search artifacts, and queues blobs. Live deletion target 24 hours; encrypted disaster backups retain at most 7 days in the initial policy and restored deletions are reapplied before serving. Exact provider retention can shorten storage; record it. Raw uploads expire after 24 hours/job completion; transient signed download links expire after 15 minutes. Deletion failures alert operator/status and remain inaccessible.
- [ ] Add capped uploads with type/dimension checks, metadata stripping, random object names, access validation and quota errors. Logs record IDs/errors/timings, excluding notes/chat/tokens/provider credentials. Settings expose region/time zone, audience, notification preferences, low-data/motion/haptics, pending sync, export/deletion and source/AI future controls.
- [ ] Verify `pnpm test:api moderation deletion`, signed-out and moderator web/device flows, expired export URL, and restored-data deletion replay. Commit scoped changes and record policy limits.

### A9: Signed foundation release and measured gate

**Files:** Create `apps/mobile/eas.json`, `apps/mobile/maestro/foundation.yaml`, `.github/workflows/ci.yml`, `scripts/load-foundation.ts`, `docs/validation/foundation-release.md`; update `docs/operations/runbook.md`, `infra/main.bicep` and `docs/validation/execution-record.md`.

**Interfaces:** Root `pnpm verify` runs all implemented package tests/typechecks/static build. `pnpm load:foundation --users 100 --active 20` runs a scripted read/write workload on a disposable seeded environment with timed feed refresh; never creates unsolicited production activity. Declare the script in root package and use tsx to run `scripts/load-foundation.ts`.

- [ ] Add Maestro real-account flow using environment-injected test credentials: login Alice, log one episode private, publish selected progress, reorder shelf, restart; login Bob, follow, see only public item and react; block and verify access loss. Offline force-stop persistence uses actual device storage. CI runs contracts/build without private secrets; authenticated/device jobs are separate controlled evidence.

```yaml
appId: com.ludex.app
---
- launchApp
- tapOn: "Library"
- tapOn: "Log"
- assertVisible: "Log episode"
- tapOn: "Save"
- assertVisible: "Waiting to sync"
```

This fragment is used inside the task's complete scripted fixture with a known selected episode and disabled network; never assert pending in an online arbitrary state.

- [ ] Execute `pnpm verify`, Expo doctor/install check, static Playwright tests and signed-device Maestro suite. Produce a signed internal APK with the actual Android build toolchain; store signing material outside Git, document backup, verify release certificate/App Links. Distribution uses a small invited pilot and requires a working privacy/account-delete page.
- [ ] Load 100 seeded accounts/20 active sessions with 30-second foreground refresh, reads, logs and social writes. Report p50/p95, cold starts, RU/429s, outbox lag, bytes, errors and local interaction timings on a midrange phone. Measure local <100 ms/warm <500 ms targets; publish misses rather than assuming them. Single-region distant clients have a separate column.
- [ ] Rehearse deployment rollback, expired auth, lost network, exhausted source/storage quota and backup restore. Price estimate plus actual meter samples must fit the selected service target or record a concrete reduction (lower refresh/cap/uploads) before inviting more users. No deadline or unconditional uptime/cost promise.
- [ ] Stage A gate: two real accounts, persistent all-media manual loop, public/restricted feed and showcase, correction/undo, spoiler-safe serialization, export/delete/moderation, static companion, signed Android accessibility/performance review. Mark A accepted only with commands/device/cloud results in `foundation-release.md`, then commit the reviewed foundation.
