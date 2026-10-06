# Ludex Companion, Shared Plans and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the conversational companion useful across Ludex, add shared watch/play planning, and verify the complete invited beta against cost, privacy, performance and recovery gates.

**Architecture:** Retrieve bounded currently permitted records, then make at most one metered model call for a short answer/proposal. An atomic monthly ledger precedes every paid call; immutable confirmed proposals execute through existing domain commands. Plans/discussions live in the bounded social partition, while notifications use an idempotent outbox and best-effort FCM.

**Tech Stack:** Foundation TypeScript/Expo/Next/Functions/Cosmos stack, existing eligible Azure text/embedding deployments after quote/runtime validation, structured/lexical retrieval, small semantic retrieval experiment, FCM, Vitest/Playwright and signed Android device tests.

**Spec:** [Beta specification](../../product/ludex-beta-spec.md), [delivery overview](2026-10-06-ludex-delivery.md), [Azure feasibility](../../research/azure-100-user-budget.md), [foundation plan](2026-10-06-ludex-foundation.md), [connections plan](2026-10-06-ludex-connections.md).

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

## Scope and dependencies

Consume verified A/B contracts and real permitted records. A central assistant entry already exists in A5 and now gains working conversation/search/proposals; no decorative fake message history. Deterministic search/logging/planning work without cloud inference. AI may draft labeled collections/memory or answers; public reviews remain the user's own writing. Recaps require scoped source coverage and may remain unavailable in beta. Shared private preferences require explicit participant consent; private assistant histories never become shared plan input.

### C1: Grounded retrieval, model budget and contextual conversation

**Files:** Create `packages/contracts/src/companion.ts`, `apps/api/src/companion/retrieve.ts`, `apps/api/src/companion/search.ts`, `apps/api/src/companion/model.ts`, `apps/api/src/companion/budget.ts`, `apps/api/src/companion/ask.ts`, `apps/api/src/functions/companion.ts`, `apps/api/test/retrieval.test.ts`, `apps/api/test/ai-budget.test.ts`, `apps/api/test/companion.test.ts`, `apps/mobile/src/features/companion/ConversationSheet.tsx`, `web/companion/ConversationSheet.tsx`, `docs/validation/ai-model-budget.md`, `docs/validation/search-retrieval.md`.

**Interfaces:**

```ts
export type CompanionRequest = {
  requestId: Id; text: string; context?: { titleId?: Id; collectionId?: Id; planId?: Id };
  usePersonalContext: boolean; conversationId: Id;
};
export type RetrievedRecord = { id: Id; source: string; text: string; titleId?: Id; checkedAt?: string; policyRevision: number };
export type CompanionReply = {
  requestId: Id; text: string; sources: { id: Id; label: string }[];
  mode: 'model' | 'structured-fallback'; proposalIds: Id[]; remainingReplies: number;
};
export type ModelQuote = {
  deployment: string; inputMicroUsdPerMillion: number;
  outputMicroUsdPerMillion: number; embeddingMicroUsdPerMillion?: number;
  maxBilledOutputTokens: number; measuredAt: string;
};
export type Reservation = { id: Id; maximumMicroUsd: number; status: 'reserved' | 'settled' | 'uncertain' };
```

Define these with runtime schemas. `retrieve(principal: Principal, request: CompanionRequest): Promise<RetrievedRecord[]>`, `askCompanion(principal: Principal, request: CompanionRequest): Promise<CompanionReply>`, `reserveAi(userId: Id, requestId: Id, maximumMicroUsd: number): Promise<Reservation | null>` and `settleAi(reservationId: Id, billedMicroUsd: number | null): Promise<void>`. All ledger updates for a month occur within `budget:<YYYY-MM>`; request IDs cannot charge twice or dispatch a duplicate model call while uncertain.

- [ ] Inspect existing Azure deployment names/capability/billing in an authenticated environment without printing keys. Record quote for the actual region/model/version/deployment type, cached-input/output/reasoning billing and credits separately. Send a bounded test request to prove runtime access before enabling the UI. Set non-AI reserve from measured infrastructure and shared AI dollars from remaining target; example 2,000 replies/month formula is `2.4 × Pi + 0.5 × Po`, not a price quote. No model name/rate inferred from portal access.
- [ ] Write failing tests: another user's private note never retrieved, follow removed invalidates cached answer/context, hidden episode/game detail absent from model input, source text cannot change system/tools, two simultaneous budget reservations cannot exceed cap, uncertain model timeout retains reservation, same request retry does not call model twice, fallback returns usable search. Run `pnpm test:api retrieval ai-budget companion`.

```ts
test('concurrent reservations cannot exceed the shared ceiling', async () => {
  await seedBudget({ availableMicroUsd: 100 });
  const reservations = await Promise.all([
    budget.reserveAi('alice', 'r1', 70),
    budget.reserveAi('bob', 'r2', 70)
  ]);
  expect(reservations.filter(Boolean)).toHaveLength(1);
});
test('an uncertain provider outcome holds the reservation', async () => {
  const reservation = await budget.reserveAi('alice', 'r3', 70);
  await budget.settleAi(reservation!.id, null);
  expect(await reservedMicroUsd()).toBe(70);
});
```

Local helpers seed/read the monthly ledger. Repeat the race on actual Cosmos ETag/transaction implementation with 20 parallel callers before enabling paid inference.

- [ ] Implement deterministic runtime/media/region/library filters, exact aliases/IDs, bounded lexical retrieval and personal SQLite FTS for own offline lookup. Use permitted public catalog cache independently of private personalization. Model input includes at most 12 current permitted/spoiler-safe records and 6,000 tokens; truncate lower-ranked records, never silently drop a hard constraint. Public metadata must be provider-permitted for model use. Unsupported recap sources return a clear unavailable answer.
- [ ] Implement integer micro-USD worst-case reservation, user reply limit, global spend limit, one active request per conversation, input/output provider-specific ceilings and timeout reconciliation. Count embeddings/retries/tool-associated model calls in the same ledger. One model call produces a short answer and validated proposal descriptors; no autonomous loop. Output parsing rejects unsupported actions. Recheck policy revision before response delivery; if changed, discard personal output and return structured fallback. Log usage IDs/tokens/cost without conversation payload.

```ts
const maximumMicroUsd = Math.ceil(
  (inputTokenCeiling * quote.inputMicroUsdPerMillion +
    quote.maxBilledOutputTokens * quote.outputMicroUsdPerMillion) / 1_000_000
);
```

When provider usage is unknown, retain worst-case reservation; known billed usage settles the difference. Cached discounts are applied only when confirmed. Model response errors do not automatically refund an unverified bill.

- [ ] Add a small permitted catalog-only embedding experiment: store model/version/dimensions/refresh date, retrieve only prefiltered candidate IDs and score a bounded candidate set, never publicize private note vectors. Compare 40 exact/fuzzy/concept queries against lexical/structured baseline for constraint correctness, recall@5, bytes/RU, latency and cost. Enable semantic ranking only if rights/quote and measured result justify it; otherwise ship structured RAG/search and document the semantic gate. No dedicated vector service or per-import-row embedding.
- [ ] Wire title/library/collection/plan contextual entries into one conversation sheet, compact history, source links, visible context controls, remaining allowance and readable exhaustion fallback. Search results render before optional explanation; token streaming is optional if Functions transport tests pass, not necessary for ordinary actions. Reopening retains the user's chosen conversation without resending a billable call. `pnpm test:api retrieval ai-budget companion`, native/web tests and real Azure evaluation must pass; commit scoped task.

### C2: Confirmed writes, inspectable memory and AI evaluation

**Files:** Create `apps/api/src/companion/proposals.ts`, `apps/api/src/companion/memory.ts`, `apps/api/src/companion/evaluation.ts`, `apps/api/test/proposals.test.ts`, `apps/api/test/memory.test.ts`, `apps/api/test/companion-evaluation.test.ts`, `apps/mobile/src/features/companion/ProposalCard.tsx`, `apps/mobile/src/features/companion/MemoryScreen.tsx`, `web/companion/ProposalCard.tsx`, `docs/validation/companion-evaluation.md`; update contracts/functions and settings.

**Interfaces:** Define these contracts in `packages/contracts/src/companion.ts`; import `ProgressCommand`, `LibraryEditCommand`, `Showcase`, `Audience` and `ConnectionSettings` from their owning foundation/connections modules.

```ts
export type Memory = { id: Id; text: string; sourceIds: Id[]; version: number; enabled: boolean };
export type ProposalPayload =
  | { kind: 'progress'; command: ProgressCommand }
  | { kind: 'library-edit'; command: LibraryEditCommand }
  | { kind: 'showcase'; commandId: Id; baseVersion: number; showcase: Showcase }
  | { kind: 'collection'; commandId: Id; id: Id; version: number; title: string; titleIds: Id[]; audience: Audience }
  | { kind: 'source-settings'; commandId: Id; settings: ConnectionSettings }
  | { kind: 'memory'; commandId: Id; operation: 'save' | 'delete'; memory: Memory };
export type Proposal = {
  id: Id; userId: Id; payload: ProposalPayload; payloadHash: string;
  expiresAt: string; state: 'proposed' | 'confirmed' | 'expired' | 'rejected';
};
```

`createProposal(principal: Principal, payload: ProposalPayload): Promise<Proposal>`, `confirmProposal(principal: Principal, proposalId: Id, confirmationId: Id): Promise<CommandResult>`, `readMemory(principal: Principal): Promise<Memory[]>` and `mutateMemory(principal: Principal, input: { commandId: Id; operation: 'save'|'delete'; memory: Memory }): Promise<CommandResult>`. Source-settings confirmations create a private user audit receipt and call the version-conditioned settings contract; duplicate execution reconciles to the stored result. C3 adds its separately defined plan-patch proposal only after the plan service exists.

- [ ] Write failing tests for no write before confirmation, approval tied to same hash/owner, expired/stale proposal rejected, duplicate approval one write, malicious retrieved instructions cannot dispatch tool, ambiguous season title produces choices, bulk episode proposal previews all IDs, visibility/publication requires reviewed payload and context revocation blocks execution. Run `pnpm test:api proposals memory companion-evaluation`.

```ts
test('asking to log only proposes until the displayed action is confirmed', async () => {
  const reply = await companion.askCompanion(alice, requestToLog);
  expect(await countProgressEvents('alice')).toBe(0);
  await companion.confirmProposal(alice, reply.proposalIds[0], 'approval-1');
  await companion.confirmProposal(alice, reply.proposalIds[0], 'approval-1');
  expect(await countProgressEvents('alice')).toBe(1);
});
```

Local evaluation uses a deterministic model stub to exercise orchestration; separate real-model runs evaluate its actual interpretation. Neither stub success nor fluent text establishes retrieval quality.

- [ ] Implement immutable ten-minute proposal expiry/hash, explicit owner/permission/base-version revalidation and one confirmation receipt. Track execution pending/result separately from the proposal display state; crash/retry resumes the same downstream command ID, never marks a failed dispatch successful. Cross-partition actions (source settings/plan social edits) use deterministic command receipts and reconcile after retries rather than pretending to share a distributed transaction. Execution uses A3 progress/library-edit and A6 showcase/collection contracts; public publication is never implied by natural-language logging. A text approval counts only when clearly bound to the presented proposal; unrelated “yes” is not reused. Changed facts require a new preview/confirmation.
- [ ] Implement user-visible memory/preferences with individual enable/edit/delete and source pointers, optional conversation persistence and deletion. Do not mine every chat into memory. Add private-context opt-out, model-data explanation and session/context clear. Permissions changes purge derived personal caches; history sourced from now-inaccessible friend content is omitted/redacted on reread. Shared outputs are user-published labeled drafts; personal review voice is preserved.
- [ ] Build evaluation fixtures for at least 40 prompts: wrong edition/title, skipped episode gaps, unknown game scope, inaccessible friend activity, source injection, false boss/completion inference, no-result constraints, expired quote/cap, malicious tool arguments, action retry and unsupported recap. Gate release on zero unauthorized writes/private or scoped spoiler leaks in this fixed suite and human inspection of real-model transcripts. Record finite test boundary and residual free-text spoiler limits.
- [ ] Run tests and real opt-in model conversations with short token ceilings. Measure usefulness against direct search/filter/shortlist flow, saves, constraint adherence, failure wording, latency and billed cost. Commit scoped task with grounded evidence.

### C3: Shared shortlist, RSVP/time and scoped discussions

**Files:** Create `packages/contracts/src/plans.ts`, `apps/api/src/plans/service.ts`, `apps/api/src/plans/choices.ts`, `apps/api/src/functions/plans.ts`, `apps/api/test/plans.test.ts`, `apps/api/test/plan-choices.test.ts`, `apps/mobile/app/plan.tsx`, `apps/mobile/src/features/plans/PlanScreen.tsx`, `apps/mobile/src/features/plans/CreatePlanSheet.tsx`, `apps/mobile/test/plans.test.tsx`, `web/plans/PlanScreen.tsx`; replace `app/plan/page.tsx` availability state with functional view.

**Interfaces:**

```ts
export type Plan = {
  id: Id; version: number; hostId: Id; participantIds: Id[];
  audience: Audience; titleIds: Id[];
  startsAt?: string; timeZone: string;
  rsvp: Record<Id, 'yes' | 'maybe' | 'no'>;
  votes: Record<Id, Id[]>; spoiler: SpoilerScope;
};
export type PlanChoice = { titleId: Id; reasons: string[]; constraintsMet: boolean; availabilityCheckedAt?: string };
```

`createPlan(principal: Principal, input: Omit<Plan,'id'|'version'|'hostId'|'rsvp'|'votes'>): Promise<Plan>`, `updatePlan(principal, input: { commandId: Id; planId: Id; baseVersion: number; patch: Partial<Pick<Plan,'titleIds'|'startsAt'|'timeZone'|'spoiler'>> }): Promise<CommandResult>`, `rsvpPlan(principal, input: { commandId: Id; planId: Id; choice: 'yes'|'maybe'|'no' }): Promise<void>`, `votePlan(principal, input: { commandId: Id; planId: Id; titleIds: Id[] }): Promise<void>`, `readPlan(viewer: Viewer, planId: Id): Promise<Plan | null>`, and `choosePlan(principal, input: { planId: Id; minutes?: number; region: string; useSharedPreferences: boolean }): Promise<PlanChoice[]>`.

- [ ] Write failing tests: invitation grants only limited preview before acceptance, nonparticipant/private reader denied, public plan doesn't reveal private preferences/RSVP, membership/block changes revoke access, duplicate RSVP idempotent, host cannot mark guests watched, time zones/DST, empty constraint match explained, 8 participants/12 candidates enforced. Run `pnpm test:api plans plan-choices` and native/web tests.

```ts
test('RSVP and host changes do not alter participants progress', async () => {
  const before = await readLibrarySnapshot('bob');
  await service.rsvpPlan(bob, { commandId: 'rsvp1', planId: plan.id, choice: 'yes' });
  expect(await readLibrarySnapshot('bob')).toEqual(before);
});
```

- [ ] Implement create/invite/accept, title shortlist, small votes, RSVP/optional time, user-triggered calendar export and scoped discussion through A4 reply/privacy rules. Limited invitation token carries no auth session and expires; signed-out route resumes after sign-in. Public plan returns a viewer-safe projection with attendee visibility choices. Cancel/change reschedules one direct notification; editing a comment does not renotify.
- [ ] Deterministically filter runtime/media/explicit region/service preferences before AI explanations. For TV select eligible next episode, for games label session duration an estimate. “No option fits” identifies the blocking constraint. Shared private preference opt-in is per plan and participant, with owner-visible summary; hidden history is excluded, not exposed as a reason. Extend `ProposalPayload` with `{ kind: 'plan-patch'; commandId: Id; planId: Id; baseVersion: number; patch: Partial<Pick<Plan,'titleIds'|'startsAt'|'timeZone'|'spoiler'>> }` and dispatch through `updatePlan`. Companion can add a candidate only through C2 confirmation/version checks; add an unconfirmed→no mutation and duplicate-confirm→one mutation regression test.
- [ ] Test real friend group of three: create, invite, vote/RSVP, change time zone, open link on web/Android, discuss an episode with a progress gap, cancel and individually log after session. Record flows in release evidence; commit scoped task.

### C4: Direct notifications, quiet hours, digest and release awareness

**Files:** Create `apps/api/src/notifications/preferences.ts`, `apps/api/src/notifications/dispatch.ts`, `apps/api/src/notifications/digest.ts`, `apps/api/src/releases/service.ts`, `apps/api/src/functions/notifications.ts`, `apps/api/test/notifications.test.ts`, `apps/api/test/releases.test.ts`, `apps/mobile/src/notifications/register.ts`, `apps/mobile/src/notifications/open.ts`, `apps/mobile/src/features/notifications/InboxScreen.tsx`, `apps/mobile/src/features/releases/ReleaseScreen.tsx`, `docs/validation/notifications.md`.

**Interfaces:** `NotificationPreferences = { replies: boolean; mentions: boolean; planInvites: boolean; digest: 'off'|'weekly'; quietHours?: { start: string; end: string; timeZone: string }; releaseTitleIds: Id[] }`; `setNotificationPreferences(principal, preferences): Promise<void>`; `dispatchNotification(outboxId: Id): Promise<void>` rechecks visibility; `readNotifications(principal, cursor?: string): Promise<{ items: { id: Id; text: string; targetUrl: string; read: boolean }[]; nextCursor?: string }>`; `ReleaseItem = { titleId: Id; episodeId?: Id; date: DateValue; region: string; certainty: 'announced'|'estimated'; checkedAt: string }`, `readReleases(principal, region: string): Promise<ReleaseItem[]>`.

- [ ] Write failing tests: opted-out digest no send, quiet hours defer, changed membership/block cancels send, spoiler-hidden notification neutral text, edited/imported historical event no new alert, token revoked/permission denied, duplicate outbox one delivery attempt identity, release estimate not presented as confirmed. Run `pnpm test:api notifications releases`.

```ts
test('push payload omits spoiler details and private source text', async () => {
  await dispatchFixtureForHiddenMilestone();
  expect(JSON.stringify(fakeFcm.sent)).not.toContain('secret-boss-name');
  expect(fakeFcm.sent[0].data.targetUrl).toContain('/activity/');
});
```

- [ ] Implement persistent in-app inbox plus FCM best-effort direct replies/mentions/invitations, asking Android permission in context after a meaningful interaction. Push contains neutral text + pointer; tap fetches current visibility. Invalid token removes registration; duplicate provider outcome stays auditable. Ordinary progress stays in feed; optional weekly digest uses deterministic summaries, no model spend. Quiet hours/time zone and per-title/author settings are explicit.
- [ ] Add simple opted-in title release view/alerts using licensed catalog dates/freshness; track unreleased episode arrival to recompute next/caught-up state without rewriting history. No stale/estimated date is a guaranteed release. No price/subscription alerts without a licensed offer source.
- [ ] Test signed Android build with permission denied/revoked, background/Doze, notification taps after logout/visibility change, expired FCM token, quiet hours and digest opt-in. Delivery is best effort; in-app persistence is canonical. Record actual timing/device constraints in `notifications.md`; commit scoped task.

### C5: Full beta verification, spending measurement and recovery

**Files:** Create `scripts/load-beta.ts`, `scripts/evaluate-companion.ts`, `scripts/verify-provider-coverage.ts`, `apps/mobile/maestro/beta.yaml`, `e2e/beta-companion-plans.spec.ts`, `docs/validation/beta-release.md`, `docs/operations/cost-control.md`, `docs/operations/backup-restore.md`; update root scripts, CI, infra and execution record.

**Interfaces:** Root scripts `pnpm load:beta --users 100 --active 20`, `pnpm evaluate:companion --mode stub` and `pnpm evaluate:companion --mode azure` use TS runners with environment credentials, redacted output and explicit test-only targets. `pnpm verify:providers` reads the recorded source coverage/capability manifest and verifies disabled sources are not advertised as functional. No synthetic production feed or automatic model spam.

- [ ] Assemble beta acceptance tests: real account onboarding/import preview, cinematic showcase, follow/feed/react, offline manual log, Steam observation/correction, Chrome/Edge capture fallback, optional RA, contextual assistant sources + confirmation, three-person plan, scoped reply, direct notification and export/delete. Stub suite runs CI; real source/device/model observations are recorded independently.
- [ ] Run full commands, capture actual outputs and inspect signed Android flows:

```bash
pnpm verify
pnpm --filter @ludex/extension test
pnpm exec playwright test e2e/beta-companion-plans.spec.ts
pnpm evaluate:companion --mode stub
pnpm evaluate:companion --mode azure
pnpm verify:providers
pnpm load:beta --users 100 --active 20
```

Do not rerun paid evaluation blindly; reserve a fixed operator-approved test allowance through C1 and stop at it. Record input/output/reasoning tokens, per-request cost and failed/uncertain calls.

- [ ] Load-test disposable seeded environment with realistic foreground polling, imports, writes and outbox jobs, plus bounded 20-way AI reservation contention using stubs before a few actual model calls. Report p50/p95, errors/cold starts/429s, RU/s and partition hot spots, storage/egress, connector call budgets and notification lag. The `social` single partition is a deliberate 100-account tradeoff; widen only after measured need, never by adding unpriced services.
- [ ] Rehearse key rotation, model cap exhaustion, provider failure/Netflix markup change, stopped worker, revoked identity, rollback and backup restore. Backup/restore follows seven-day retention and reapplies deletion tombstones before traffic. Restored outboxes preserve stable receipts and never republish historical data. Write exact runbook commands/resource names only after deployment; no invented cloud identifiers or secrets.
- [ ] Measure underlying Azure service bill, credit-adjusted cash, model tokens, logs/storage/egress and annual/one-time costs separately. A planning allocation can reserve approximately $3 infrastructure, $5 AI and $2 headroom, but replace it with actual quote/meter evidence before enabling all accounts. Reduce allowances/refresh/upload limits when measurements exceed target. Azure alerts at thresholds provide visibility; application gates prevent new paid model calls, not every possible Azure bill. Credit expiry is surfaced in operator report.
- [ ] Expand invitations from the small pilot to 25, then up to 100 only after stable source correction/access metrics, cinematic device review, useful grounded replies and no critical privacy/spoiler/write defect in the acceptance suite. Check weekly repeat loggers, reviewer/follow discovery, shelf creation, useful conversations, recommendation saves→starts, sync correction rate, freshness and per-action AI cost. No artificial watch/play-hour success target.
- [ ] Final beta release record states shipped source fields/device versions, remaining gates, measured performance/cost, operational owner/runbook and rollback path. Mark stage C complete only when required outcomes pass or a capability's already-approved manual fallback is explicitly shipped. Commit reviewed scoped files; deployment/distribution follow the user's authorized execution scope.
