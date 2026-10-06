# Ludex Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a cinematic Android social entertainment journal for 100 invited users, with trustworthy migration/progress integrations and a capped contextual AI companion.

**Architecture:** Keep the existing root Next.js app as a static companion. Add an Expo Android app and TypeScript Azure Functions sharing domain/contracts; use a single eligible Cosmos account, local durable commands and transactional outboxes, with measured polling and quote-backed AI quotas.

**Tech Stack:** Next.js 16.3.8, React 19.2.8 on web; Expo SDK 57 candidate with its supported native dependencies; TypeScript, pnpm 11.24.0, Azure Functions, Cosmos DB NoSQL, External ID, SQLite, Blob Storage, FCM, metered Azure model, Chrome Manifest V3.

**Spec:** [Ludex beta specification](../../product/ludex-beta-spec.md), [experience depth](../../product/ludex-experience-depth.md), [product brief](../../product/ludex-product-brief.md).

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

## Starting evidence and file ownership

Repository baseline `76b8174` is the original Next starter. At planning time, application source is unchanged and product/research documents are untracked. Installed Next static-export guide was read; it disallows arbitrary runtime dynamic routes, Server Actions and request-dependent Route Handlers. `pnpm view expo version` returned `57.0.27` on 2026-10-06; install a stable template and run Expo's dependency checks at execution time.

| Boundary | Files / owner | Responsibility |
| --- | --- | --- |
| Existing companion | `app/`, `public/`, `next.config.ts`, root `tsconfig.json` | Static screens and client API access; no backend secret or private build-time rendering |
| Android | `apps/mobile/` | Native navigation, cinematic screens, own offline cache/outbox, share intake, device auth/push |
| API | `apps/api/` | Auth, permissions, domain commands, data access, workers, provider secrets, model calls |
| Extension | `apps/extension/` | User-invoked capture, optional Netflix detection, durable observation uploads |
| Domain | `packages/domain/` | Media identity/progress, audience/spoiler rules, correction semantics |
| Contracts | `packages/contracts/` | Runtime-validated request/response and event schemas |
| Client | `packages/client/` | Typed HTTP client, cursor/ETag handling, response errors; no React dependency |
| Design | `packages/design/` | Shared tokens and artwork/layout rules; native/web renderers remain separate |
| Cloud | `infra/`, `scripts/` | Quote/eligibility manifest, Bicep, reproducible checks and operations |
| Evidence | `docs/validation/`, `docs/operations/` | Actual accounts/devices/payloads tested, performance/cost and recovery results |

Keep root web TypeScript includes scoped to web/shared packages; each native/API package owns its config. Preserve existing `allowBuilds` unless a reviewed package needs a build script. Do not force root React onto native dependencies.

## Stage order and release gates

| Stage | Plan | Working deliverable | Required evidence |
| --- | --- | --- | --- |
| A | [Cinematic social foundation](2026-10-06-ludex-foundation.md) | Signed Android app with real accounts, manual logs, follows, feed, reviews/replies, shelves and static companion | Two real accounts, persistence across restart, visibility/spoiler tests, populated midrange-device visual/performance review |
| B | [Migration and connected progress](2026-10-06-ludex-connections.md) | Letterboxd/Trakt/CSV import, Steam, Chrome/Edge capture, optional Netflix detection and RetroAchievements | Real permitted source samples/accounts, duplicate/replay/correction tests, capture fallback, observed-player comparison |
| C | [Companion, shared plans and release](2026-10-06-ludex-companion-release.md) | Grounded AI with confirmed writes, plans/RSVP/discussions, notifications and 100-account beta controls | Permission/spoiler evaluation, atomic budget contention, real-device plan/push tests, restore/deletion/load/cost evidence |

No calendar promise: prioritize these dependency gates. Stage A is a product foundation, not a complete claim for every beta feature. Stages B/C deliver the remaining accepted beta scope. Optional Netflix automation and RetroAchievements remain capability-gated; their manual fallback is a supported product path.

## Task 1: Establish the execution record

**Files:** Create `docs/validation/execution-record.md`; read all linked stage plans and specifications. No application edits in this task.

**Interfaces:** Consumes settled specification and baseline; produces stage/task evidence with command, date, commit, environment and remaining limitations.

- [ ] Record the actual baseline and branch before coding. Reuse an attached suitable worktree; if isolation is needed, use the worktree skill and a `codex/` branch. Preserve user changes.

```bash
git status --short
git rev-parse HEAD
```

- [ ] Read the installed Next guides before web changes. Read task-owning process/domain skills only as needed; use TDD where a meaningful seam exists, and native/browser verification for screens.

```bash
cat node_modules/next/dist/docs/01-app/02-guides/static-exports.md
cat node_modules/next/dist/docs/01-app/01-getting-started/02-project-structure.md
```

- [ ] Copy this evidence form into the execution record and fill it from actual runs, never predicted outcomes:

```markdown
## Execution evidence
- Stage/task:
- Commit and environment:
- Command/device/provider account class:
- Observed result:
- Known limit and next gate:
```

## Task 2: Execute the staged plans and review their boundaries

**Files:** All files are scoped in the three linked stage plans. Update `docs/validation/execution-record.md` at each stage.

**Interfaces:** Each stage consumes the prior stage's accepted contracts; no later stage bypasses `applyProgress`, `readFeed` or permission checks.

- [ ] Execute stage A task-by-task, including local red/green tests and real cloud/device gate. Review the session-spread/profile interaction before broadening the beta.
- [ ] Execute stage B after A's common progress/correction contracts pass. Register/provider-test only the selected permitted adapters; preserve manual behavior when a gate fails.
- [ ] Execute stage C after reliable records exist for retrieval. Enable paid model calls only after signed-in quote and budget ledger checks.
- [ ] Run the combined verification commands defined by A, then B/C regression checks; retain actual output in the record. Do not mark a stage complete on a mocked provider test alone.

## Coverage and intentional expansion

| Requirement | Implementing task |
| --- | --- |
| Cinematic feed/profile/themes, art fallback, motion/accessibility | A5–A6, A9 |
| Real accounts/follows/friends/circles/privacy | A2, A4 |
| All media logs, rewatches, editions/emulation, ratings, offline/correction | A1, A3, A5 |
| Reviews/collections/discovery/recommendation provenance | A4, A6–A7 |
| Spoiler-safe replies/notifications and public moderation | A4, A8, C4 |
| Static web/shared links/library management/App Links | A7 |
| Imports and reversible historical provenance | B1–B2 |
| Steam/extension/Netflix fallback/RetroAchievements | B3–B5 |
| Per-source opt-in, grouped activity, presence expiry/health | B1, B3–B6 |
| Central AI/RAG/search/memory/confirmed writes/budget | C1–C2 |
| Plans/shortlist/RSVP/time/scoped discussion | C3 |
| Direct notifications, digest, quiet hours and release awareness | C4 |
| Export/deletion/retention/recovery/cost/load | A8–A9, B6, C5 |

The experience-depth document labels many brainstormed extras as Distinctive or Later. Basic save provenance and shared plans are in beta. Advanced smart shelves, Android widgets, buddy checkpoint graphs, recap/share-card generation, licensed price alerts, lending, iOS and emulator desktop companions are expansion tasks, not hidden dependencies. Constrained manual mixed-media collections already express cross-media Journeys without automatic progress percentages.

## Verification of this plan package

Documentation verification checks local links, balanced fences, concrete task wording and whitespace. It does not run application tests because application implementation is a subsequent request. Execution evidence must distinguish local contract tests, signed-device behavior, authenticated provider payloads and actual cloud billing.
