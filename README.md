# Ludex

An Android-first journal for films, television and games, with a cinematic social feed and configurable showcases. Stage A is a runnable local foundation. Azure deployment and signed-device release acceptance remain separate gates; see `docs/validation/foundation-release.md`.

## Run locally

Use Node 26 and pnpm (the lockfile records exact versions).

```sh
pnpm install
pnpm dev:api
```

In a second terminal:

```sh
pnpm dev
```

Open http://localhost:3000. The signed-out sample journal is explicitly labeled. New accounts start empty. Local invitation: `LUDEX-LOCAL-BETA`; signup password minimum 12 characters. Local SQLite lives under `.local/` and is ignored by Git. Local password authentication is disabled in cloud mode.

For the Android client:

```sh
pnpm --filter @ludex/mobile start
```

Set `EXPO_PUBLIC_API_URL` to a reachable API origin (emulator `http://10.0.2.2:4000/api`; a phone needs a reachable host or HTTPS cloud endpoint). Follow `apps/mobile/README.md` for platform validation and native build notes. Stage A has no active cloud AI or automatic source connectors.

## Verify

```sh
pnpm verify
pnpm --filter @ludex/mobile lint
pnpm test:e2e
pnpm load:foundation --users 100 --active 20 --rounds 3
pnpm --filter @ludex/api build:functions
```

Browser tests expect the API and website running. Static-output verification instructions are in `scripts/README.md`. They create two local disposable accounts and delete them after the flow. The load tool creates and removes its own temporary SQLite database and never writes the current journal.

Production website output is static (`out/`). `pnpm start` serves that output; a separately deployed API must be configured through `NEXT_PUBLIC_API_URL` at build time. No private data is embedded in the static build. See `docs/operations/runbook.md`, `PRODUCT.md`, and `DESIGN.md` for the scope and operating requirements.

Internal Android preview APKs are available under `apps/mobile/artifacts/`: the x86_64 build is installed/tested in the emulator, and the ARM64 build supports a USB-connected phone through `adb reverse`. Both use a development certificate. See `apps/mobile/README.md` for the exact setup.
