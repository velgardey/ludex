# Ludex credentials and setup

The Go beta is implemented in `apps/backend`. It uses PostgreSQL with pgx, direct Google OAuth and app-owned sessions. Prisma and Supabase Auth are not in the Go runtime. Historical Stage A server settings remain in `apps/api/.env.local` for recovery only.

Start the Go API from `apps/backend` with `go run ./cmd/ludex --env .env.local serve`. Migrations are explicit: `go run ./cmd/ludex --env .env.local migrate`. The current Go local env points to a disposable local database; supplied Supabase URLs are preserved separately and have not been migrated.

| File | Purpose |
| --- | --- |
| `apps/backend/.env.local` | Private PostgreSQL/provider/Google/Azure credentials. Loaded only by explicit `--env`. |
| `.env.local` | Public website API URL; Next reads automatically. |
| `apps/mobile/.env.local` | Public mobile API URL; rebuild after changes. |
| `apps/extension/.env.local` | Future public build settings. Current unpacked pilot uses its popup configuration. |
| `infra/.env.local` | Azure deployment worksheet; no resources provisioned. |

All local env files are ignored and owner-readable only. Examples contain blank secrets. Do not copy private values to public client variables.

| Integration | Present | Still needed |
| --- | --- | --- |
| Google | Web and Android client identifiers, web secret stored server-side | Exact localhost callback registration/test-user audience; native system-browser callback device validation. Server uses the Web client to exchange codes and returns a one-time PKCE-bound native handoff. |
| PostgreSQL | Local test/dev databases; supplied Supabase connection strings retained | Review fresh production schema/roles and migration before switch. |
| TMDB / IGDB | Supplied server credentials, live catalog adapters | Provider license/attribution and bounded live verification. |
| Azure conversation | `https://thehub.services.ai.azure.com/openai/v1`, `gpt-6-luna` | App-specific `AZURE_OPENAI_API_KEY`, actual input/output token prices, `LUDEX_AI_ENABLED=true`. |
| Azure embeddings | `text-embedding-3-large`, permission-filtered retrieval/cache | Same app key plus actual embedding price. |
| Steam | Manual library preview adapter and privacy-safe review | `STEAM_WEB_API_KEY`; verified account linking, achievement polling and source-sharing remain additional integration work. |
| Trakt / Letterboxd | Export/CSV preview/import path | Trakt OAuth app for continuous account sync; documented export availability is source-dependent. |
| RetroAchievements | Emulated catalog/manual logging supported | RA account verification/API adapter not enabled; no achievement sync claimed. |
| Android push | Inbox available in product | Firebase project/FCM sender setup; no push send claimed. |
| Hosting | Dockerfile and scale-to-zero design | Domain, Azure subscription/resource group, reviewed compute/storage/logging quote and deployment. |

Google Cloud Web application callback for local development: `http://localhost:4000/api/auth/google/callback`. Add the exact URI to the OAuth client and configure beta test users. For a physical Android phone use a reachable HTTPS API; emulator-only `10.0.2.2` is not a production URL.

AI cloud context defaults off per account. Users explicitly enable relevant journal/conversation sharing in the companion, confirm every proposed write, and can clear saved conversation/search memory. Allowance remains intact after clearing. Missing keys/prices produce labeled structured fallback, not a model answer. Codex credentials are never extracted for the app.

See [Go beta operations](../operations/go-beta.md) and [credential research](../research/credential-requirements-2026-10-07.md) for release gates and provider references. This worksheet describes the current runtime; historical Stage A examples are retained for recovery.
