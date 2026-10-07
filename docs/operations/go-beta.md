# Go beta operation

The user approved Go/PostgreSQL implementation on 7 October 2026. Local development uses a disposable PostgreSQL 18.6 cluster at port 55432, extracted into ignored `.local/tools/postgres` rather than installed system-wide. Existing Stage A SQLite files have integrity-checked snapshots and a checksum manifest in `.local/stage-a-snapshot`.

## After workspace cleanup

The October7 local cluster is stopped. Its cold data directory, Stage A snapshots, ignored env files and development signing material are preserved in a protected local backup; the extracted database tools, Android SDK/AVDs, Java17, Gradle caches and workspace dependencies were removed at the user's request. Reinstall prerequisites and follow [cleanup and recovery](cleanup-and-recovery.md) before using the local commands below. Historical verification below describes the pre-cleanup build.

## Run locally

From `apps/backend`:

```sh
go run ./cmd/ludex --env .env.local migrate
go run ./cmd/ludex --env .env.local serve
```

The explicit migration command uses `DIRECT_URL`; server startup only verifies the connection. `DATABASE_URL` in the Go local env points to `ludex_dev` on the disposable cluster. The older supplied Supabase strings remain preserved in the ignored TypeScript server env. Never point migration commands at that database without checking existing schemas and reviewed role/schema isolation.

Tests use another local database:

```sh
LUDEX_TEST_DATABASE_URL=postgresql://velgardey@127.0.0.1:55432/ludex_test?sslmode=disable go test -race ./...
go vet ./...
```

Suites create independent schemas and drop only those test schemas. Production should use TLS-verified Postgres, a restricted runtime role, separate migrations, private secrets and a real invitation value.

## AI configuration

Fill the ignored Go env `AZURE_OPENAI_API_KEY`, the three deployment-specific rates and `LUDEX_AI_ENABLED=true` before a live call. The Go entrypoint enforces this explicit opt-in in addition to pricing/cap checks. Deployments remain `gpt-6-luna` and `text-embedding-3-large` at the user-selected endpoint. Until configured, own-library/catalog retrieval remains clearly marked as a structured fallback; it is not a model answer.

Cloud credentials are not copied from Codex keyring. Every model action is a stored proposal requiring confirmation and revalidation through the ordinary progress command path. Rates must cover billed output/reasoning tokens. Unknown provider failures retain reservations for reconciliation rather than assuming a free failed call. Local fixtures verify parsing and boundaries; fixture success is not a live Azure validation.

## Hosting

Build the backend image from `apps/backend/Dockerfile`. Deploy as a Consumption Container App only after reviewing region-specific cost and permissions. Set min replicas zero and a small maximum; run `work` from the same image as a separate scheduled Consumption Job. Do not use an API-process timer to promise polling while scaled to zero. Existing Cosmos Bicep is historical and must not be used for this Go/Postgres release.

No resources are provisioned by this document. Quote Container Apps API and job time, image registry, PostgreSQL plan, Blob/egress, logging and AI. Grants are per subscription and credits affect cash paid, not actual usage.

## Provider setup and release gates

- Google web callback: exact registered localhost/HTTPS redirect and user test audience. Native system-browser Google uses the Web OAuth client server-side and a PKCE-bound one-time Ludex handoff; real device/provider redirect validation remains required. The separate Android client is retained for a future native credential-manager path.
- TMDB and Twitch/IGDB supplied credentials are server-only. Record actual bounded API checks before claiming catalog provider verification.
- Steam key, Trakt app and FCM sender are not supplied. Their absence must appear in capability/health UI; do not fabricate completed sync or push.
- Chrome/Edge extension is a quick-capture pilot. Observation review is required; automatic Netflix completion and browser-store publication are not validated.
- SQL migration replay, two-account visibility, corrections, assistant confirmation/quota concurrency, restored snapshots and device/browser tests are release gates.

Keep logs free of bearer/provider tokens, database URLs, query-string keys and private retrieved content. Cap telemetry. Redact outbound transport errors before returning them to clients.

## Current local evidence

7 October implementation: Go/Postgres persistence, direct Google web/native handoff (fixture validated), permission-aware social/progress/showcase, account export/deletion, imports with durable worker/per-row recovery, browser-capture confirmation, shared plans/scoped discussion/inbox, and saved companion fallback. Live TMDB movie and IGDB game search were checked; Game of Thrones details returned 73 ordered episodes. Occasional provider transport resets are possible; core panels refresh independently of catalog failures.

Azure Responses/embedding integration is tested with bounded provider fixtures, citations, action replay, budget contention and user consent. No live Azure model call has occurred because the app key and model rates remain unset. Context consent defaults false. Resetting a conversation clears messages/proposals/embedding cache while keeping daily/monthly allowance ledgers.

The unpacked browser extension has capture code and a review endpoint. Production pairing/account-source verification, continuous Steam achievements/Trakt/RetroAchievements sync, presence expiry, Android FCM push and store distribution remain integration work. The current Steam pilot is manual SteamID library preview (100 entries/page), with explicit review, no verified linked account and no achievements.

An Android release-mode APK can be built locally with Gradle; it uses a development signing key and emulator API address. It is not a store-signed or globally reachable release. Local build dependencies include user-managed Java17 and an existing Android SDK; PostgreSQL/numactl binaries are extracted under ignored workspace tools. System Docker remains inaccessible and no paid resources have been deployed.

## Local artifact and current validation limits

`artifacts/ludex-go-beta-android.apk` is an arm64/x86_64 APK built successfully with Gradle `assembleRelease`. It includes a bundled JavaScript/Hermes application and uses the local development signing key. Emulator startup was attempted but the installed API36 system image requires more userdata space than available; no new device-runtime validation is claimed. The independent Android export, native tests and typechecks pass. The final incremental build includes the latest native import-review changes (547 Gradle tasks; 44 seconds).

Browser Go integration checks use a disposable account/session fixture in ignored `.local`; typography tests isolate provider transport with a catalog fixture. Separate live smoke checks validate catalog calls and product persistence. Do not confuse those fixture typography tests with provider availability.

## Final verification, 7 October 2026

- `go test -race ./...`, `go vet ./...`, and the standalone Go binary build passed with the disposable PostgreSQL test database.
- `pnpm verify` passed lint, all workspace typechecks, domain/legacy API/client/web/native tests, and the static Next build. Native tests: 12 suites /34 tests.
- Android lint and `expo export --platform android` passed. `assembleRelease` passed; the refreshed APK manifest records its SHA256. Physical/emulated device operation remains unverified because the installed image cannot boot within available userdata storage.
- Live product smoke created two disposable users and checked20 movie/20 game catalog hits, replayed progress, feed/showcase persistence, plan discussion, companion fallback, capture confirmation and owner export. Separate worker runs accepted the original Letterboxd row and completed the fresh smoke import.
- A live TV detail/logging check returned73 Game of Thrones episodes, persisted private episode progress, withheld it from the other account, persisted AI consent and hid an existing shared plan after blocking.
- Three browser checks passed: connected Go plans/connections/saved chat, Sora consistency and narrow/zoomed layout. Screenshot review found no page errors or horizontal overflow.
- Review repairs cover blocked-plan access, one-connection discussion reads and refusal to forward Azure API keys on redirects. Cloud model fixtures remain distinct from live Azure evidence.

AI retrieval scans at most2,000 permitted own-library candidates before choosing a small ranked context. Library versions, bounded run progress and one explicitly matched show's verified episode identities ground confirmation proposals. Unknown episodes are rejected and the core revalidates confirmed writes. This is fixture-verified until the app's Azure key and actual model prices permit a live call.
