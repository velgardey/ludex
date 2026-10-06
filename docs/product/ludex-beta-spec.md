# Ludex beta specification

Date: 2026-10-06. Status: product choices settled through Q1–Q32; technical defaults below are recommendations for execution. Nothing here establishes implemented functionality, provider access or a verified Azure bill.

Read [the product brief](ludex-product-brief.md), [experience depth](ludex-experience-depth.md) and [delivery plan](../superpowers/plans/2026-10-06-ludex-delivery.md). The research reports preserve their original evidence dates and runtime limitations.

## Product and release contract

Ludex is a cinematic entertainment journal connecting **capture → choose together → watch/play → log → discuss → remember**, across films, TV and games. Its first loyal audience is TV/PC-gaming friend groups, alongside public reviewers and followers.

User decisions, copied into all implementation plans:

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

## Technical defaults and limits

Keep the existing Next.js app at the repository root. Add `apps/mobile`, `apps/api`, `apps/extension` and framework-independent `packages/domain`, `packages/contracts`, `packages/client`, `packages/design`. Share data rules and tokens, rather than forcing web and native components into one rendering system.

**Android:** Expo SDK 57 candidate, React Native and React versions installed through that SDK, Expo Router, SQLite cache/durable outbox, SecureStore for refresh credentials, native development/release builds. Registry lookup on 2026-10-06 returned Expo stable `57.0.27`; the template and runtime compatibility must be checked again during execution. Keep Next's React `19.2.8` separate if the mobile SDK requires another patch. No root React override without compatibility evidence. Android minimum SDK/target SDK follow the installed Expo version and current distribution requirements; record them in the release report.

**Web:** Next `16.3.8`/React `19.2.8`, `output: 'export'`, static routes `/profile/?u=…`, `/activity/?id=…`, `/collection/?id=…`, `/plan/?id=…`, `/title/?id=…`, `/library/`, `/settings/` and `/moderation/`. Runtime entities load from the API in client components. No build-time private data. Static export cannot supply arbitrary dynamic routes, Server Actions or request-dependent Route Handlers. Share links use these real static routes; verified Android App Links point to the same paths. Beta link previews have generic metadata; per-user SEO and rich social-unfurl cards are a later priced dynamic feature.

**Backend:** TypeScript Azure Functions v4 programming model, one region, on-demand compute without always-ready capacity. A provisioned Cosmos DB NoSQL free-tier account is the preferred database only if eligible. Use Entra External ID core email/OIDC login without paid SMS/add-ons. Blob Storage holds capped avatars/attachments and backing storage; catalog artwork uses permitted provider URLs. FCM can deliver best-effort Android direct notifications after credentials/device testing. No Redis, dedicated AI Search, APIM, paid realtime or multi-region service in this beta.

If Cosmos free tier is already consumed/ineligible, quote a small replacement before provisioning; do not silently substitute an unpriced database. Local development uses the same repository interface with a SQLite adapter and contract tests, while a disposable Cosmos integration run verifies partition transactions/ETags before invitations. Local success alone does not establish cloud behavior.

All numerical limits below are initial operator-configurable defaults, with tests. They are not provider limits:

| Area | Beta default |
| --- | --- |
| Feed/API page | 20 items, maximum 50; server-side filtering before snippets |
| Following query | At most 100 author IDs within the invited cohort |
| Profile | 3 curated themes, 8 shelves, 24 items/shelf; featured work optional |
| Plans | 8 participants, 12 shortlisted works, optional time, explicit RSVP |
| Plain-text note/review/reply | 4,000 / 10,000 / 2,000 characters |
| Avatar / user attachment | 1 MiB / 3 MiB; image types allowlisted, dimensions capped, metadata stripped |
| CSV / ZIP | 5 MiB CSV, 25 MiB compressed ZIP, 100 MiB expanded, 10,000 rows/job, 50 archive entries; reject path traversal and oversized expansion |
| Foreground feed refresh | Start at 30 seconds; pause when backgrounded, back off to 60/120 seconds on errors, honor Retry-After |
| Presence | Five-minute expiry after latest valid observation; show observation time; hide immediately on disconnect |
| Steam scheduling | Library daily; changed/recent game achievements at most every 15 minutes while an opted-in source is active; batch profile checks at most every five minutes if presence enabled; lower cadence when quotas/cost require |
| RetroAchievements | At most every 15 minutes for opted-in recent games; overlap earned-event watermark by five minutes; honor actual provider guidance |
| AI allowance | Initial scenario 20 short responses/user/month, only if quoted token rates fit the shared allowance |
| AI context/output | Maximum 12 retrieved records and 6,000 input tokens; default 300 generated tokens, provider-specific total billed-output ceiling configured before enablement |
| AI retries | No automatic second paid call after an uncertain outcome; ledger reconciliation required |

## Screen and experience contract

Navigation: Feed, Library, Discover, Profile, a persistent Log entry and reachable assistant entry. The assistant sheet carries selected title/plan/collection context and shows its allowance; cloud replies become functional in stage C. Prior to that, the entry explains availability and offers direct search/logging rather than fabricating conversations.

Feed opens chronological Following, with friends/circle and media filters. Compact rows keep reading fast; meaningful completions or notes use the signature **session spread**: appropriately framed artwork, a human note and precise progress. A new-items banner never moves the item under a finger. Preserve position through detail, compose, refresh and app restart. Group same-source achievements/episodes from a session into an expandable activity without losing underlying evidence; groups close after 30 minutes of inactivity, and later edits update the existing card.

Profile offers a featured work, mixed-media shelves, pinned collections, currently watching/playing, selected milestones and a private journal. Three initial themes vary restrained accents/composition within one readable system. Shelf reorder has a button alternative, live preview, cancel and undo. A viewer-mode preview computes current visibility rather than showing all owner data.

Palette: ink plum `#15121C`, smoked indigo `#272334`, pearl `#E8E4DF`, violet `#B6A3CF`, copper `#C89571`. Use licensed Fraunces for major display moments and Source Sans 3 for body if Android font/rendering checks pass; system fonts are the tested fallback. Text contrast must be measured for each token pairing. Preserve film/game cover aspect ratios and art focal points. Art failure yields typography and a stable colored frame, never a collapsed layout.

Short interruptible motion targets 150–250 ms, with reduced-motion alternatives. No continuous grain/blur, default sound/autoplay or startup delay. Dynamic type, TalkBack, 48 dp touch targets, non-color status, haptic control, low-data image mode and a small-phone layout are release checks. Do not judge the app from a landing-page hero alone.

Library distinguishes wishlist/backlog from owned/access state; offers grid/list density, sorting, saved filters, searchable archive, drafts and review queue. Quick log needs no rating/text. Region and time zone are configurable; show alias/year/edition when a match could be ambiguous. Share-to-save preserves an authorized recommendation pointer, with a fallback when its original post is no longer accessible.

## Domain and interfaces

Use string UUIDs for Ludex identifiers and namespaced provider IDs. Never interchange Steam app IDs, TMDB movie/show/episode IDs, IGDB editions or RetroAchievements game/set IDs.

```ts
export type Id = string;
export type MediaType = 'movie' | 'show' | 'game';
export type Source = 'manual' | 'letterboxd' | 'trakt' | 'csv' | 'steam' | 'netflix-extension' | 'retroachievements';
export type Audience = { kind: 'private' } | { kind: 'public' } | { kind: 'friends' } | { kind: 'circle'; circleId: Id };
export type DateValue =
  | { precision: 'instant'; iso: string }
  | { precision: 'day'; day: string }
  | { precision: 'month'; month: string }
  | { precision: 'unknown' };
export type SpoilerScope =
  | { kind: 'none' }
  | { kind: 'episodes'; showId: Id; requiredEpisodeIds: Id[] }
  | { kind: 'milestone'; gameId: Id; requiredMilestoneIds: Id[] }
  | { kind: 'hidden'; titleId: Id };
export type ProgressChange =
  | { kind: 'session-started' | 'session-ended'; titleId: Id; runId: Id; sessionId: Id; medium: MediaType }
  | { kind: 'movie-viewed'; titleId: Id; runId: Id }
  | { kind: 'episode-watched' | 'episode-skipped'; titleId: Id; episodeId: Id; runId: Id }
  | { kind: 'game-session'; titleId: Id; runId: Id; minutes?: number; playedOn?: string; emulator?: string }
  | { kind: 'milestone'; titleId: Id; runId: Id; milestoneId: Id; label: string }
  | { kind: 'story-completed'; titleId: Id; runId: Id }
  | { kind: 'achievement'; titleId: Id; providerGameId: string; achievementId: string; mode?: 'casual' | 'hardcore' };
export type ProgressCommand = {
  commandId: Id; titleId: Id; baseVersion: number; change: ProgressChange;
  occurredAt: DateValue; rating?: number; liked?: boolean; note?: string;
  audience: Audience; spoiler: SpoilerScope;
};
export type CommandResult =
  | { status: 'accepted'; commandId: Id; version: number; eventId: Id }
  | { status: 'conflict'; commandId: Id; currentVersion: number }
  | { status: 'rejected'; commandId: Id; code: string };
export type Viewer = { userId: Id | null; policyRevision: number };
export type FeedQuery = { cursor?: string; limit: number; filter: 'following' | 'friends' | 'circle'; circleId?: Id; media?: MediaType };
export type VisibleActivity = { id: Id; authorId: Id; titleId: Id; caption: string; note?: string; detailHidden: boolean; occurredAt: DateValue };
export type FeedPage = { items: VisibleActivity[]; nextCursor?: string; etag: string };
export type ProviderObservation = {
  observationId: string; source: Exclude<Source, 'manual'>; accountId: Id;
  providerRecordId?: string; titleId: Id; change: ProgressChange;
  occurredAt: DateValue; observedAt: string; historical: boolean;
  confidence: 'exact' | 'needs-review'; payloadHash: string;
};
export type Principal = { userId: Id; roles: ('user' | 'moderator')[] };
export type LibraryPatch = {
  rating?: number | null; liked?: boolean; note?: string;
  owned?: boolean; archived?: boolean;
  state?: 'planned' | 'active' | 'paused' | 'dropped' | 'completed';
  playedOn?: string; emulator?: string;
};
export type LibraryEditCommand = {
  commandId: Id; titleId: Id; baseVersion: number; patch: LibraryPatch;
};
```

Public API functions, used consistently in the plans (imports/companion types are defined by their stage tasks):

- `applyProgress(principal: Principal, command: ProgressCommand): Promise<CommandResult>`
- `editLibrary(principal: Principal, command: LibraryEditCommand): Promise<CommandResult>`
- `readFeed(viewer: Viewer, query: FeedQuery): Promise<FeedPage>`
- `ingestObservation(principal: Principal, observation: ProviderObservation): Promise<CommandResult>`
- `canReveal(viewedIds: Set<Id>, requiredIds: Id[]): boolean` requires all IDs.
- `previewImport(principal: Principal, input: ImportInput): Promise<ImportPreview>`
- `commitImport(principal: Principal, batchId: Id): Promise<ImportResult>`
- `askCompanion(principal: Principal, request: CompanionRequest): Promise<CompanionReply>`
- `confirmProposal(principal: Principal, proposalId: Id, confirmationId: Id): Promise<CommandResult>`

Network surface (Functions paths include `/api`; static web pages remain separate):

| Route | Contract / permission |
| --- | --- |
| `GET /api/catalog/search?text=&media=&region=` | `searchCatalog`; invited principal, bounded results |
| `POST /api/progress`, `POST /api/library/edit`, `POST /api/progress/correct` | `applyProgress`, `editLibrary`, `correctProgress`; own user partition |
| `GET /api/feed`, `GET /api/showcase?userId=` | `readFeed`, `readShowcase`; viewer/policy revision constructed on server |
| `POST /api/social/follow`, `/friendship`, `/reply`, `/review/publish`, `/block`, `/report` | Corresponding social task commands; current ACL and idempotency |
| `POST /api/showcase`, `POST /api/collection` | Versioned owner edits |
| `POST /api/import/preview`, `/commit`, `/reverse`, `/resolve` | Owned upload/batch/row; commit always quiet |
| `GET /api/connections`, `POST /api/connections/settings`, `/disconnect` | Own source state/consent; versioned settings |
| `POST /api/extension/observe` | Narrow user-bound device token; canonical mapping plus observation validation |
| `POST /api/companion/ask`, `/confirm`, `GET /api/companion/memory` | Own consent/quotas/proposals; every assistant write confirmed |
| `POST /api/plans`, `/plans/update`, `/plans/rsvp`, `/plans/vote`, `GET /api/plans?id=` | Participant/host and viewer-specific projection |
| `GET /api/notifications`, `POST /api/notifications/preferences` | Own inbox/preferences, neutral spoiler-safe text |
| `POST /api/account/export`, `/delete`, `GET /api/moderation` | Own account; moderation role checked on server |

Every request obtains a verified principal or an explicitly anonymous public viewer. Clients cannot choose another user ID or policy revision to expand access. Error envelopes use `{ code, message, retryAfterSeconds? }` with HTTP 401/403/409/413/429/503 for auth/permission/conflict/size/quota/unavailable; uncertain paid model outcomes return a resumable request identifier without dispatching a second request.

Additional types are defined by their owning task before downstream use. Validate network input with runtime schemas; TypeScript types alone do not authenticate or validate JSON.

Explicit session start/end actions can describe watching/playing now, with optional user-started timer estimates and separate presence consent; neither action proves completion. Owner state edits record plan/pause/drop/archive/ownership without fabricating consumption. Movie viewings and TV viewing runs preserve rewatches. Watched and skipped episode sets are separate; next episode is the first released eligible unwatched/unskipped episode in the selected catalog order. Caught-up is derived from released episodes; finished requires the chosen completed run of an ended series. Specials and alternate orders are explicit catalog choices; uncertain mappings stay unresolved. A show completed-state edit cannot manufacture watched episodes; ended-series completion requires the actual selected run. Game story completion, session time, provider lifetime achievements and per-run milestones are independent. No cross-media universal completion percentage.

## Persistence, atomicity and access

One Cosmos container with partition key `/scope`:

| Scope | Documents and transaction boundary |
| --- | --- |
| `user:<id>` | Private library, runs, progress assertions/corrections, drafts, connector checkpoints, import batches, assistant preferences/history, command receipts and outbox. Event + projection + receipt + outbox commit together with ETag preconditions. |
| `social` | Visible profiles/collections, follows/friendships/circles/blocks, published activities, plans, replies/reactions, moderation and global policy revision. This small cohort deliberately shares one bounded partition; writes affecting visibility commit together. |
| `catalog` | Canonical works/episodes/editions, provider bindings and permitted search documents; no private user content. |
| `budget:<YYYY-MM>` | Global AI budget, per-user usage, reservation receipts and reconciliation state. One partition makes the shared cap atomic. |

Private outbox → social publication is **eventual across partitions**. Stable event-derived document IDs make retries harmless; a worker verifies current sharing, correction and deletion state before publication. Never claim a distributed transaction. Social publication plus its notification outbox commits atomically within `social`; notification delivery to user partitions/FCM is independently idempotent. Delete/retract commands remove visibility immediately through policy/state checks even if cleanup is waiting.

Private partitions are accessible only through authenticated Functions; public clients never query Cosmos directly. Follows grant only public content. Accepted friendships/circle membership are required for restricted content. Block overrides all social access in both directions. Private notes and assistant history never join public projections. A private library item can remain private while an explicitly published review exposes its title; the UI explains this choice.

Feed queries read only `social`, bounded to invited-followed authors, sorted by server publication time plus stable ID. Imported occurrence time remains distinct. Use opaque signed continuation tokens bound to viewer, filter and policy revision. A policy change invalidates cursors and personalized ETags; visibility/spoilers are rechecked before returning any snippet. Do not cache personalized API responses at public CDNs. Restricted feed bodies are not persistently cached offline in beta; public/owner caches have expiry and are purged on logout or detected revocation. This limits stale access but cannot retract a screenshot or text already read.

TV spoiler gates compare full required episode sets, including gaps; game scopes use explicit milestones, never hours/achievement percentage. Unknown or unmapped game secrets remain concealed. API serialization omits hidden names, notes, thumbnails and descriptions. Push uses neutral text and an event pointer. Spoiler reveal is a per-item explicit user action with logged preference; public generic activity is still readable.

Corrections append an explicit assertion/tombstone and increment version; replaying the same external fact cannot undo it. New conflicting provider evidence enters reconciliation. Stale offline edits return `conflict`; an additive safe merge is allowed only for distinct watched-set membership with no later correction. Never apply blind last-write-wins to ratings, notes, shelves or visibility. Undo submits a scoped compensating command and preserves subsequent edits.

## Imports, connectors and AI boundaries

Historical imports are quiet and library-only. Source scales, original dates/precision, authored review date and imported/publication dates remain distinct. A 4.5/5 rating displays as 9/10 while retaining 4.5/5. Reimport keys use actual source record IDs, or a documented conservative fingerprint that distinguishes legitimate rewatches. Ambiguous matches require a user; AI cannot commit them. Reversal retracts only import-owned assertions and preserves later manual changes.

Steam identity is proved by OpenID/account binding; privacy still limits reads. No boss-specific caption without a source achievement/curated semantic mapping. Netflix optional host permission and visible title/profile selection do not expose Android-app playback. Continuous observed watched coverage, identity and validated player semantics are required for automatic completion; seek/page-open/pause/stop alone never suffice. Uncertain detection proposes a log. Extension worker sleep/restart and offline uploads must preserve identifiers. RetroAchievements key-based access is separately validated and secured; hardcore/casual and provider-lifetime unlocks remain explicit.

Assistant retrieval applies permissions and spoiler scope **before** selecting context. Start with catalog search, SQLite FTS for own cached library and bounded server lexical/structured retrieval. Stage C includes a measured semantic-search prototype over a permitted catalog subset; embeddings/provider retention need their own permission and budget gate. Search results work while optional explanations stream. Do not automatically index every chat or private import. RAG may use structured records without a vector database.

Assistant proposals have an immutable payload, owner, base version, expiry and hash. Approval is bound to the displayed payload and executes once through normal commands. Bulk/visibility/publication changes receive a readable preview and explicit confirmation. Public reviews remain user-authored; collection/recap drafts can be AI-labeled and user-published. No autonomous public posts or inferred gameplay facts. Unsupported spoiler-safe recaps decline rather than inventing source coverage.

Budget enforcement reserves worst-case billed input/output cost atomically before each paid model or embedding call. Unknown/timeout usage retains its reservation until reconciled; failed replies are not automatically refunded. Stop at the shared limit; deterministic search/planning/logging remain available. Provider quotes and total billed tokens, including reasoning when applicable, determine ceilings. Azure budget alerts are additional visibility, not a hard cap.

## Release checks and expansion boundary

Target measurements: local acknowledgment p95 <100 ms; warm cached useful screen p95 <500 ms; ordinary launch-region writes/search p95 <500 ms where measurements support it. Report cold starts and distant-region results separately. Feed freshness starts with 30-second foreground refresh; connector freshness is independent. AI first-token target about two seconds is an experiment, never a promise for every model/location.

Stage A invites a small cohort only after real auth/persistence/access tests and signed Android build checks. Stage B validates permitted accounts and Netflix observations against actual playback. Stage C exercises AI isolation/budget/write confirmation and group coordination, then rehearses restore/deletion/rollback and measures representative 100-account/20-active load before opening all invitations.

Later options: iOS, emulator desktop companion, Plex/Jellyfin continuous sync, Trakt continuous sync, MAL/AniList/other verified formats, Android widgets, licensed price alerts, advanced recaps and rich dynamic web previews. Full messaging, synchronized playback and console partnerships remain separately scoped work. No beta claim depends on these extras.
