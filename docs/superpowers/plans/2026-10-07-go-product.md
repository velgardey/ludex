# Ludex Go product implementation plan

**Goal:** Persistent Go/PostgreSQL product with direct Google identity, live catalog, reliable progress/social/showcase, grounded AI with confirmed actions, Android/web integration and durable background work.
**Spec:** docs/architecture/go-backend-proposal.md and accepted beta decisions.
**Execution:** Subagent-driven development, bounded write scopes, test-first behavior and review. User approved autonomous implementation on 7 October 2026.

## Constraints

Preserve Stage A checkout/data, use fresh Go beta; credentials server-only; no Supabase Auth; no destructive database changes or paid deployment. Exact Azure deployments retained; missing app key means honest deterministic fallback. Every AI write confirmed; enforce viewer/spoiler permissions and atomic quota controls. Maintain static web and Android visual quality.

## Task 1 — Persistent Go identity/social/library core

Files: apps/backend/internal/core, db/migrations/001_core.sql, tests. Interface: core.New(db *pgxpool.Pool, Config) *App; App implements http.Handler and ResolveUser(*http.Request)(string,error). Preserve existing /api/ route contracts; /api/v1 alias. Test replay/conflict, audience/spoilers, session ownership, showcase persistence. Implement typed SQL core tables, Google verified identity/Ludex sessions, library/progress/correction, feed/follows/reviews/collections/settings. Development auth must reject production. Validate disposable Postgres with test/race/vet; scoped commit.

## Task 2 — Catalog and grounded AI

Files: internal/catalog, internal/companion, db/migrations/002_companion.sql, tests. Catalog provides typed hits/search/title; companion uses injected identity/progress callbacks. Test provider fixtures, permission-filtered retrieval, cloud parsing/errors, budget contention/proposal replay. Implement TMDB/IGDB, permitted retrieval/citations, deterministic fallback, Azure bounded conversation/embeddings when configured, persisted messages/actions, atomic quota reservations and confirmations. Scoped commit.

## Task 3 — Client product experience

Files: web/components/Companion.tsx, web/LudexApp.tsx integration, feature styles, mobile companion/auth, packages/client assistant methods/tests. Read relevant framework/design docs. Test contract/error shapes before implementation. Build conversation/source/action/allowance and confirmation UI with accessible native/web pending/errors. Wire Google login and retain explicit local dev behavior. Preserve cinematic design. Scoped commit.

## Task 4 — Connections/imports/plans/worker

Files: internal/connections, internal/plans, internal/jobs, db/migrations/003_connections.sql, extension and deployment artifacts. Test import matches/duplicates, Steam privacy, observations, job leases/retries, plan permissions. Build encrypted connections, CSV/Letterboxd preview/commit, Steam and optional RA adapters, Chrome capture/fallback, shared shortlist/RSVP/discussion, notification inbox. Independent scheduled worker; honest absent credentials and no paid provisioning.

## Task 5 — Integrate and validate

Wire cmd/ludex, explicit safe env loading, local database/migrations, Dockerfile. Snapshot Stage A. Run two-account persistence, command replay/correction, profile/audience/spoilers, assistant confirmation/budget, import/plans; Go test/race/vet plus pnpm verify, browser/native checks. Independent review/repairs. Record actual completed/local/provider/deployment boundaries.

## Rulings / progress

- Ruling: disposable local PostgreSQL rather than mutate supplied DB; preserves live-data safety and costs local setup.
- Ruling: temporary /api compatibility aliases for existing clients, alongside /api/v1; costs a small routing layer.
- Ruling: missing Azure app key leaves cloud responses unavailable while structured retrieval works; no fabricated AI replies.

## Completed local implementation and remaining gates

Tasks1–5 are integrated as a local Go/PostgreSQL beta with Android and companion web clients. Provider-backed movie/game catalog, TV episode logging, import-worker recovery, two-account social/privacy, showcase, shared plans, saved assistant and account lifecycle are exercised. Detailed current evidence and release limits are in `docs/operations/go-beta.md`.

Additional automatic sources remain capability-disabled: verified Steam linking/achievements, Trakt OAuth continuous sync, RetroAchievements adapter and FCM. Azure app key/rates, real Google device redirect validation, hosted HTTPS/domain, production database roles/migration, independent scheduler and reviewed spending quote are required before an invited hosted beta. No paid deployment or live Supabase migration occurred.
