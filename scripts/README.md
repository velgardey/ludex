# Validation scripts

`load-foundation.ts` runs with Node26 (native TypeScript stripping), creates a temporary SQLite database, seeds up to100 accounts, exercises up to20 concurrent clients, verifies persistence after server restart and deletes its temporary database. It never loads the current journal. Example: `pnpm load:foundation --users 100 --active 20 --rounds 3 --output docs/validation/local-load.json`. The root package does not declare ESM; Node's harmless module-type warning is recorded. `tsx` CJS execution is unsuitable because the imported API entrypoint uses top-level await.

`capture-web.cjs` captures the sample web feed1440/390 and profile1440 after font/art loading. Requires the local API4000 and website3000. It writes `.impeccable/review/`, reports page errors/overflow/image availability, and makes no claim for native Android appearance. It is a reproducible capture utility, not a repeated polishing loop.

Browser tests create disposable local accounts and clean them up. Running against exported files uses `PLAYWRIGHT_BASE_URL=http://localhost:3001 pnpm test:e2e`; include3001 in `LUDEX_CORS_ORIGINS` on the local API. Static output can be served with `python -m http.server 3001 --directory out`. Production CORS must name actual permitted origins explicitly.

Repeated test runs consume invitation slots even after account deletion, by design. For a clean disposable suite use a separate `LUDEX_DB_PATH`, such as `.local/e2e-final.sqlite`; stop the API before changing paths. Preserve existing databases rather than resetting a user's journal to recover quota. Tests remove their own active accounts, and private screenshots/traces from failed tests stay ignored in `test-results/`.
