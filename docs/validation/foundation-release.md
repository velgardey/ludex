# Stage A foundation validation

Date: 2026-10-06. Baseline: `76b8174`. Workspace: `/home/velgardey/.codex/worktrees/ludex-stage-a/ludex`.

## Current disposition

The local foundation is implemented and runnable. Stage A external release acceptance remains open. This is not a deployed Azure beta or a signed physical-device acceptance report.

## Implemented local foundation

- Separate Android Expo SDK57 client, static Next16.3 companion and shared runtime contracts/client/domain.
- Real invited local accounts start empty; the sample journal is labeled and sample accounts cannot authenticate. Production mode refuses local password auth; server-side OIDC verification/invitation binding is tested with generated JWKS.
- Persistent film logs, explicit episode sets/gaps, game sessions/story completion, ten-point optional ratings/likes/notes; idempotent receipts, base versions, corrections and undo.
- Public follows distinct from accepted friendships/circles; following/friends feeds, reactions, scoped replies, review drafts and explicit publication. Server checks access and omits spoiler text/art/title bindings at serialization.
- Configurable showcase themes, featured artwork, ordered shelves and mixed-media collections with independent audience.
- Native owner-separated SQLite cache/drafts/outbox, SecureStore credentials, durable pending actions, conflict review, scroll restoration, reduced motion/low-data/haptics and estimated manual timer.
- Block/report, moderator role checks/action audit, bounded expiring owner export and queued recoverable deletion with write guards.
- Companion title/profile/activity/collection routes, privacy page, account settings and static output. Native custom-scheme link validation exists; real domain association/share extensions remain unverified.

## Evidence

`pnpm verify`: web lint, all workspace typechecks, domain/API/client/web/native tests and static build. Full output in `verify.log`; exit 0, 60 tests passed (25 API, 3 domain, 2 client, 4 web unit, 26 native) and static output14 pages including404.

`node_modules/.bin/playwright test`: two real browser contexts exercise collection persistence, private draft/public review, following, replies and persisted showcase; separate tests cover preserving completed state on save, private film undo, mobile390px reduced-motion navigation, authenticated export download and friends access/block boundary. API fixtures are disposable local users removed after checks. Nine tests pass on both development and exported website (browser-tests.log and static-browser-tests.log). Added regression tests first reproduced stale pending feed across filters/sign-out, late account refresh and duplicate reply submission; fixed with immediate scope invalidation, guarded responses and an in-flight reply lock. Rating-only draft changes clear the saved marker. Exported tests used a fresh ignored fixture database after prior repeated runs exhausted the 100-invitation quota; prior database preserved.

`node scripts/load-foundation.ts --users 100 --active 20 --rounds 3 --output docs/validation/local-load.json`:363requests,0errors,local p50 22.34ms/p95 64.76ms,627653 response bytes, original session/library survive server restart. It uses its own temporary database, then removes it. Same-host HTTP/SQLite excludes internet, device interaction, cloud cold starts/RU and30-second polling. Follow p95145.39ms; per-endpoint results in JSON. Prior worker runs under concurrent toolchain work varied materially; do not infer universal latency.

Backend fresh controller Node test run covers reviewer fixes: nonempty/catalog-bound spoiler rules, atomic owner write guard, disabled account guard for social writes, queued deletion recovery and checked cleanup conflicts, duplicate correction receipt reread, expired snapshots cleanup/single active export. Reviewer initial findings are retained in backend-report; independent followup unavailable due harness thread limit and controller assessed fixes/tests. No live Cosmos equivalence is claimed.

Original lounge raster provenance in `asset-provenance.md`. Self-hosted Fraunces and Source Sans3 include OFL licenses. Provider poster/header/hero URLs are development fixture artwork; provider commercial rights/attribution/access remain release prerequisites.

## Design evidence

`.impeccable/review/desktop.png`1440px, `mobile.png`390px and `profile.png`1440px are captured from the working browser with sample label visible, fonts/art loaded, no horizontal overflow or runtime errors. Impeccable detector ran once with[] findings. Fresh visual review requested caption contrast and small footer contrast; fixed; independent verdict scored both original findings resolved (ship at that scope). Actual installed API36 phone-emulator captures are also available (phone-android.png, feed-android.png, profile-android.png). Native independent verdict **ship** covers the targeted 48dp action fix and capture/documentation fixes. Native offline private log survives force-stop/reopen, syncs once after reconnect; account B UI/API shows no A item or pending queue. Static captures do not establish TalkBack or physical performance. The original full prebuild direction contract/QUALITY BAR selection evidence was not retained; its historical audit remains unverified.

## Required before external acceptance

1. Actual Azure identity tenant, app/PKCE/redirect configuration, protected secrets and invitation flow. Client cloud/system-browser auth flow remains to be implemented and exercised against that tenant.
2. Catalog-provider adapters/credentials/license/attribution validated; current searchable catalog is eight seeded titles, not global discovery.
3. Cosmos transaction/race/ETag/deletion tests in disposable cloud environment; bounded queries/RU, distributed rates, monitoring and rollback.
4. Internal x86_64 and ARM64 APKs compiled with development certificate; signed production Android ARM APK, real-device accessibility/offline/process-death/share/AppLinks checks and measured midrange-phone responsiveness. Internal x86_64APK47MB compiled and v2signature verified, SHA2566b67d67fb8f65852c1e11c7f30074dd032b8f679773b29d514ce99e0b2357d2a. It is signed with the Android Debug certificate, not a production release key. Local/emulator outcome is separately recorded in android-report. The separate ARM64 USB artifact uses127.0.0.1:4000/api through adb reverse, SHA25696a7d290eed7b8be93700ef0cc68304dba6255b0754a3889167349b18502f0d0, and has not been installed on physical hardware.
5. Actual billing/free-tier eligibility/credit expiry and underlying versus credit-adjusted cost; $10monthly remains a target. No billable Ludex resources created here.
6. Upload caps/metadata stripping/storage lifecycle if enabled; backup restore/deletion replay/operational retention and beta support contact. Current UI exposes no working uploads.
7. Remaining A7/A8 breadth: companion bulk editing/import and full moderation lifecycle/mute/comment controls; StageB integrations/importers and StageC AI/plans remain separate work.

AI assistant/plan screens clearly show later availability. No source accounts or cloud AI calls are operational in Stage A.

## Coverage of the approved Stage A plan

| Identifier | Local implementation evidence                                                                   | Acceptance still open                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| A1         | Workspace, contracts, precise media reducers/tests                                              | No material local gap recorded                                                         |
| A2         | Invited local auth, persistent SQLite, OIDC server verification, Cosmos/Functions scaffold      | Real tenant/client PKCE, provider catalog adapters/rights, cloud storage parity        |
| A3         | Idempotent progress, corrections, owner transactions/publication queue                          | Distributed cloud race/failure observations                                            |
| A4         | Following/friends/circles service, protected feed, review drafts/publication, replies/reactions | Mute/title-hide/full edit-management breadth and broader discovery                     |
| A5         | Native shell, SQLite/SecureStore, durable logging/outbox, actual offline restart smoke          | Physical accessibility/performance, cloud authentication                               |
| A6         | Cinematic feed/profile, themes/shelves/collections, actual emulator images                      | Long-list performance, physical sizes/font scaling, expanded editing                   |
| A7         | Static companion, real shared routes, nine browser flows, safe scheme parser                    | ACTION_SEND, verified HTTPS App Links, bulk management                                 |
| A8         | Block/report/moderation roles, bearer export, recoverable deletion                              | Full lifecycle/mute/comment management, backup restore, upload safeguards if enabled   |
| A9         | CI, 60 tests, static/native builds, emulator smoke, local 100/20 load                           | Production signing, Azure deployment/cost/rollback, physical signed-release acceptance |

This ledger does not check off external gates using local test evidence. Stage A is a reviewable local foundation; the full release gate remains open.
