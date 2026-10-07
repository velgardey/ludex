# Cleanup and recovery, 7 October 2026

The user requested removal of development installations, all `~/.cache` contents, unnecessary Playwright downloads and publication of important project work to GitHub. This operation changes local development availability; it does not deploy the app.

## Preserved work

- Public repository: https://github.com/velgardey/ludex. `main` and `codex/ludex-stage-a` contain the complete product source, plans, architecture, tests, dependency lockfiles, environment templates and design evidence.
- Prerelease: https://github.com/velgardey/ludex/releases/tag/local-beta-2026-10-07. It retains the latest development APK, Linux Go API binary, static companion output, selected visual/validation assets and SHA256 checksums.
- Protected local backup: `/home/velgardey/Documents/Ludex-backup-2026-10-07`. `private/configuration.tar.gz` holds ignored environment files and development signing material. `private/local-data.tar.gz` holds the stopped PostgreSQL18 cluster, SQLite snapshots and local test evidence. `private/original-checkout-docs.tar.gz` preserves the starter checkout's untracked planning documents. These private archives must not be committed or uploaded.
- `ludex-source.bundle` is an offline Git backup. The backup manifests record preserved hashes and removed paths. Persistent application configuration, Codex history/memory, system Chromium and pre-existing Node/Go/Python remain.

The PostgreSQL archive is a cold cluster copy, not a portable SQL dump. Restore it with a compatible PostgreSQL18 installation and the appropriate database user/permissions. The four Stage A SQLite snapshots passed integrity and recorded-hash checks before cleanup.

## Removed installations and generated files

Android SDK/NDK, downloaded emulator images and AVDs; project-added Java17; Gradle caches and wrappers; extracted PostgreSQL/numactl tools; generated Expo native folders and builds; installed workspace dependencies; Next/Expo/TypeScript build caches; Playwright browser downloads and disposable MCP logs; global Playwright CLI; package/module caches and all contents of `~/.cache`. Applications can create fresh small caches while running. Test dependencies remain declared in source for reproducibility.

The active product worktree remains `/home/velgardey/.codex/worktrees/ludex-stage-a/ludex`. Its common Git repository remains in `/home/velgardey/code/web/ludex`; retain both directories unless using Git worktree management to move/archive them.

## Resume development

1. Clone the public repository, or use the retained product worktree. Install compatible Node and pnpm; run `pnpm install --frozen-lockfile` in the root. Versions are recorded in `package.json` and `pnpm-lock.yaml`.
2. For the Go API, use the version in `apps/backend/go.mod` and run `go mod download` there. Install a disposable compatible PostgreSQL database, or restore the protected cold backup. Prepare ignored env files from `.env.example`; restore private configuration only into a trusted local checkout.
3. Read `go-beta.md` before running explicit migrations. Server startup does not migrate data. Production database changes and paid cloud hosting are separate steps.
4. For Android builds, reinstall Java17 and the Android SDK appropriate to the Expo project. Run Expo prebuild to regenerate native folders, then build via the mobile package scripts. Native generation/build folders were disposable; application source and assets remain tracked. Use a dedicated release signing key for distribution.
5. Playwright is optional for browser verification: install the declared test dependency through pnpm, then download a browser only when needed with `pnpm exec playwright install chromium`.

The saved APK is development-signed and points at the Android emulator localhost bridge. It is an archival build, not a phone-ready internet beta. Cloud deployment, reachable HTTPS API settings, provider/device login verification and proper release signing remain required before sharing a usable installation with friends. Azure live AI remains dependent on the app key, model prices and explicit enablement.
