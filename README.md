# Ludex · After Hours

An Android-first journal for films, series and games, with a companion website, cinematic showcases, public followers/reviews, shared plans and a grounded conversational companion.

The current product API is Go + PostgreSQL in `apps/backend`. It uses direct Google OAuth and app-owned sessions, pgx typed SQL, durable progress commands and a separate import worker. Stage A's TypeScript/SQLite API remains available as a recovery/reference implementation; its tests are separate from Go integration tests.

## Workspace after cleanup

Development toolchains and generated caches were removed at the user's request on 7 October 2026. Source, lockfiles, environment templates and design evidence remain; install dependencies before using the commands below. The public GitHub repository and prerelease retain the source and latest build artifacts. See [cleanup and recovery](docs/operations/cleanup-and-recovery.md) for backup and restoration details.

## Run the product locally

1. Prepare `apps/backend/.env.local` from the example and point it at a disposable development PostgreSQL database.
2. From `apps/backend`: `go run ./cmd/ludex --env .env.local migrate`, then `go run ./cmd/ludex --env .env.local serve`.
3. From the root: `pnpm build`; serve `out/` on port3001, or run `pnpm dev` on port3000.
4. Start mobile with `pnpm --filter @ludex/mobile start`. Emulator API address is `http://10.0.2.2:4000/api`; physical phones need reachable HTTPS/LAN settings.
5. Execute queued imports separately: from `apps/backend`, `go run ./cmd/ludex --env .env.local work`. A scale-to-zero API is not a background scheduler.

The ignored Go env currently points to local PostgreSQL. Supplied Supabase strings are retained in the historical server env; no live database migration or paid deployment has occurred.

## Implemented product paths

Persistent library/progress/replay/corrections, privacy/spoiler-aware feed, follows/friendships, review drafts and publication, configurable shelves, collections, settings/moderation; grounded saved companion chat with permission-limited retrieval and confirmed actions; import preview/manual mapping/worker outcomes; browser capture review; shared shortlist/RSVP/scoped discussions and private plan-invitation inbox. Google web/native flows are implemented but require actual provider/device setup validation.

Cloud AI and embeddings require the app-specific Azure key, exact model rates and user context opt-in. Without these, replies are labeled structured fallback. Steam is a bounded manual library-preview pilot when a key is configured; account verification, achievements and continuous polling are not claimed. RetroAchievements, Trakt continuous OAuth sync and FCM push are not enabled. Emulated titles retain catalog/manual logging.

## Verify

`pnpm verify` checks lint, workspace types, domain/legacy API/client/web/mobile tests and the static website build. Go tests must also run separately against disposable PostgreSQL:

```sh
cd apps/backend
LUDEX_TEST_DATABASE_URL=postgresql://localhost:55432/ludex_test?sslmode=disable go test -race ./...
go vet ./...
```

Android bundle: `pnpm --filter @ludex/mobile export`. Bundle success does not prove Google device sign-in or a store-ready release.

See [operations](docs/operations/go-beta.md), [credential setup](docs/setup/credentials.md), [runtime routes](api/routes.md), [product](PRODUCT.md), and [design](DESIGN.md). Provider keys belong only in ignored server env files. No secrets are bundled into static output.
