# Ludex Android

Native Expo SDK 57 / React Native 0.86 client. The API and static companion remain separate apps.

```sh
pnpm --filter @ludex/api dev
pnpm --filter @ludex/mobile start
pnpm --filter @ludex/mobile android
```

The Android emulator uses `http://10.0.2.2:4000/api`. Set `EXPO_PUBLIC_API_URL` to a reachable LAN or HTTPS API for a physical phone. Local development invitation: `LUDEX-LOCAL-BETA`. Production invitations and system-browser OIDC are separate deployment gates.

```sh
pnpm --filter @ludex/mobile typecheck
pnpm --filter @ludex/mobile test --runInBand
pnpm --filter @ludex/mobile lint
pnpm --filter @ludex/mobile export
cd apps/mobile && pnpm exec expo install --check && pnpm dlx expo-doctor
```

SecureStore holds the local API session token/expiry. Each authenticated owner has a separate SQLite WAL database with local drafts, owner catalog/library cache, and immutable idempotent progress/library outbox commands. Restricted feed payloads are never stored to disk. Signing out warns before clearing pending actions/drafts/cache. Conflicts retain drafts and require review rather than changing a command's version automatically.

Two verified internal APK artifacts are available. Both use the Android debug certificate and min SDK 24 / target 36. Their SHA256 and build commands are recorded in `docs/validation/android-report.md`.

- `artifacts/ludex-stage-a-x86_64-internal.apk` (approximately 47 MB): x86_64 emulator, API `http://10.0.2.2:4000/api`. This artifact was installed and smoke-tested on the API 36 emulator.
- `artifacts/ludex-stage-a-arm64-internal.apk` (approximately 45 MB): ARM64 phone over USB, API `http://127.0.0.1:4000/api`. The build/signature/ABI/API address are verified; physical installation is pending.

For the ARM64 USB artifact, run the local API, connect an Android phone with USB debugging, and replace `PHONE_SERIAL` with its `adb devices` serial:

```sh
adb -s PHONE_SERIAL reverse tcp:4000 tcp:4000
adb -s PHONE_SERIAL install -r apps/mobile/artifacts/ludex-stage-a-arm64-internal.apk
```

The reverse connection is required each time it is lost. This is a local cleartext test setup. A distributed beta needs a new build configured with its real HTTPS API.

`dist/` is an Android Hermes bundle export. `android/` is generated and ignored. EAS profiles are defined; production release credentials, HTTPS deployment, domain association and physical-device gates remain open. See `docs/validation/android-report.md` for evidence.

Fraunces and Source Sans 3 are licensed under the bundled OFL text files in `assets/fonts/`; Material Symbols and Material Community Icons are supplied through their packages. The Android icon uses the project's original Ludex L/dot geometric mark, rasterized from the included SVG for Expo's PNG icon requirement.
