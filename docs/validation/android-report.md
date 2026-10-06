# Android Stage A implementation and validation

Validated on 2026-10-06. Ludex is a native Expo SDK 57 / React Native 0.86 Android client with native Router tabs and sheets. The local API integration and an assembled internal APK are verified. Production identity, signing, cloud deployment and physical Android acceptance remain separate gates.

## Reviewable APK

Artifact: `apps/mobile/artifacts/ludex-stage-a-x86_64-internal.apk` (approximately 47 MB; generated artifact, excluded from source control).

- Package: `com.ludex.app`, version `0.1.0` / code `1`.
- This artifact ABI is **x86_64 only**, intended for the local emulator. The separate ARM64 USB artifact is recorded below.
- Minimum Android SDK 24; target/compile SDK 36.
- SHA256: `6b67d67fb8f65852c1e11c7f30074dd032b8f679773b29d514ce99e0b2357d2a`.
- `apksigner verify --verbose --print-certs` returned **Verifies**, APK Signature Scheme v2 true, one signer.
- Signer is the generated **Android Debug** certificate, SHA256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. This is an internal test artifact, not a production certificate or store submission.
- API compiled into the default build: `http://10.0.2.2:4000/api`. The config plugin permits cleartext only when the configured API starts with HTTP; introspection returned false for HTTPS. A deployed build needs its real HTTPS API address.

### ARM64 internal USB artifact

`apps/mobile/artifacts/ludex-stage-a-arm64-internal.apk` is approximately 45 MB with `arm64-v8a` as its only ABI. Package/version/min24/target36 match the emulator artifact. Its APK Signature Scheme v2 verifies with the same Android Debug certificate.

- Final SHA256: `96a7d290eed7b8be93700ef0cc68304dba6255b0754a3889167349b18502f0d0`.
- Initial ARM64 native build: **BUILD SUCCESSFUL in 2m13s**, 495 tasks, 59 executed / 436 up-to-date.
- Final USB-address build: **BUILD SUCCESSFUL in 1m43s**, 495 tasks, 30 executed / 465 up-to-date. The generated bundle was invalidated to ensure Metro rebuilt with the environment change. Embedded APK asset inspection confirmed `http://127.0.0.1:4000/api` present and the emulator alias absent.
- Build invocation uses `EXPO_PUBLIC_API_URL=http://127.0.0.1:4000/api` and `-PreactNativeArchitectures=arm64-v8a` with the same stable native tree/toolchain above.
- **Physical phone installation/runtime has not been verified.** A connected phone needs the local API plus `adb -s PHONE_SERIAL reverse tcp:4000 tcp:4000`, followed by `adb -s PHONE_SERIAL install -r apps/mobile/artifacts/ludex-stage-a-arm64-internal.apk`. This local cleartext USB route is not a deployed HTTPS beta. Recreate the reverse mapping after disconnect/reboot as needed.

## Implemented native scope

- Native Material Feed / Library / Discover / Profile navigation, system Back, stack routes and log/companion form sheets.
- Cinematic lounge header, full-width profile vignette and session spreads, portrait covers and true landscape shelf items; bundled OFL Fraunces / Source Sans 3, original Ludex geometric icon and lounge art, Material controls, stable failed-art fallback and low-data image preference.
- Font hydration before route rendering. Reduced motion combines the Android accessibility setting with the saved preference; Paper animation scale becomes zero and native Stack animation is disabled. Tab/scroll animation and image transitions are absent. Optional queue-save haptics respect the preference.
- Invited local API signup/login and SecureStore session token/expiry; separate account-specific SQLite WAL databases. Sample preview is explicit and does not impersonate an authenticated account.
- Movie viewings, actual released TV watched/skipped episode selection with next-gap default, rewatches/new runs, explicit start/end, game minutes/device/emulator/milestone/story completion, optional whole 1–10 rating / liked / note / day / spoiler controls, private audience by default. A user-started game timer supplies a reviewed whole-minute estimate.
- Durable editable log drafts, separately preserved original submitted drafts, immutable idempotent outbox commands and local pending projection. Network retries retain payload/ID; conflicts/rejections remain reviewable without changing versions. The latest accepted log supports conditional compensating retraction.
- Searchable list/grid library, backlog/owned/archive filters, title state/ownership edits, durable layout and scroll offsets.
- Feed refresh retains the order of known visible rows while immediately removing revoked rows and applying the latest redacted projection. Additive arrivals remain behind the refresh banner. Foreground polling uses 30/60/120-second failure backoff plus Retry-After; restricted feed payloads stay memory-only.
- Follows, friend requests/accept/remove, reactions/replies, block/report; local/server review drafts and explicit public publication. Role-gated moderation reports/remove surface.
- Featured work, three theme accents, bounded mixed shelves with button reorder/cancel/draft undo and versioned explicit save; public-viewer shelf filtering and collection creation/list/read.
- Region/time zone/motion/haptic/low-data settings, pending discard/sync, logout purge warning, authenticated JSON export via temporary native file and Android sharing, and account deletion confirmation.
- Companion clearly unavailable until Stage C, with search/manual-log fallback. Native scheme/query-link validation exists; verified HTTPS App Links and ACTION_SEND intake are not yet implemented.

## Verification evidence

| Command | Observed result |
| --- | --- |
| `pnpm --dir apps/mobile test --runInBand` | **7 suites / 26 tests passed**, zero failures. |
| `pnpm --dir apps/mobile typecheck` | `tsc --noEmit`, exit 0. |
| `pnpm --dir apps/mobile lint` | Scoped ESLint, exit 0. |
| `pnpm --dir apps/mobile exec expo install --check` | Dependencies up to date. |
| `cd apps/mobile && pnpm dlx expo-doctor` | **21/21** checks passed. |
| `pnpm --dir apps/mobile exec expo export --platform android` | Hermes Android export succeeded, 1,955 modules, approximately 4.7 MB bundle. |
| `pnpm --dir apps/mobile exec expo prebuild --platform android --no-install` | Generated native tree successfully; ignored `android/` is configured from app config/plugins. |
| Final native `:app:assembleRelease -PreactNativeArchitectures=x86_64 --no-daemon` | **BUILD SUCCESSFUL in 42s**, 495 actionable tasks, 24 executed / 471 up-to-date. Embedded Metro bundle included the final privacy fix, 1,955 modules and 33 assets. |
| `apksigner verify --verbose --print-certs` | Verifies; v2 debug certificate as documented above. |
| `aapt2 dump badging` and `sha256sum` | Confirmed package, SDK, x86_64 ABI and artifact digest. |
| Live local API smoke | Disposable invited account; private movie accepted; identical retry receipt; one library item; zero public feed entries; account deleted. |

The meaningful test seams use real disk SQLite close/reopen, immutable command/draft and owner isolation, purge, retry/conflict behavior, RNTL log save behavior, invalid ratings, TV release/gap guards, original platform/device distinction, public shelf visibility, reorder boundaries, link trust and polling. The feed privacy test was first observed failing with a revoked note retained, then passed after reconciliation and state wiring. These tests do not replace Android OS lifecycle inspection.

### Reproducing the local native build

The machine initially had no Java/SDK. Task build paths:

- JDK: `/tmp/ludex-android-tools/jdk-17.0.20.1+1`.
- SDK: `/home/velgardey/.cache/ludex-stage-a-tools/sdk`.
- Gradle: `/home/velgardey/.cache/ludex-stage-a-gradle/gradle-9.3.1`.
- Build log: `/tmp/ludex-android-tools/gradle-final.log`.

```sh
pnpm --dir apps/mobile exec expo prebuild --platform android --no-install
env NODE_ENV=production \
  JAVA_HOME=/tmp/ludex-android-tools/jdk-17.0.20.1+1 \
  ANDROID_HOME=/home/velgardey/.cache/ludex-stage-a-tools/sdk \
  GRADLE_USER_HOME=/home/velgardey/.cache/ludex-stage-a-gradle \
  /home/velgardey/.cache/ludex-stage-a-gradle/gradle-9.3.1/bin/gradle \
  -p apps/mobile/android :app:assembleRelease \
  -PreactNativeArchitectures=x86_64 --no-daemon
```

Keep prebuild and Gradle sequential. The verified direct Gradle distribution SHA256 was `b266d5ff6b90eada6dc3b20cb090e3731302e553a27c5d3e4df1f0d76beaff06`. Earlier failures were wrapper network timeout, concurrent prebuild/autolinking regeneration, pnpm Babel preset resolution and a missing background-only splash drawable. Babel now resolves the preset from Expo's installed package, and the explicit splash image generates its native drawables. The final stable-tree builds passed (first full success: 3m47s / 495 tasks; privacy JS rebuild: 56s; final touch-target rebuild: 42s).

An initial emulator extraction exhausted temporary quota. The SDK was relocated to home storage and only the duplicate task temporary copy was removed. The home-storage retry installed the emulator and API36 Google APIs image successfully. The auto-profile creator attempted a different PlayStore image; it was interrupted, and exact-package avdmanager used the already installed Google APIs image. The AVD is under `/home/velgardey/.config/.android/avd` because avdmanager honors XDG config; emulator launch uses explicit `ANDROID_AVD_HOME`. Native evidence is below. No desktop/window-manager settings were changed.

## Remaining release and physical acceptance gates

- Production system-browser OIDC/PKCE, token refresh/revocation, invitation service; current opaque seven-day local API session is the implemented identity mode.
- Production certificate custody, signed internal release / AAB and real HTTPS deployment. An ARM64 internal artifact is built but remains untested on physical hardware.
- Broader native conflict/correction/retraction, draft editing after submission, logout with pending data, expiry, account export/delete through Android UI and repeat lifecycle testing on physical hardware. The bounded emulator offline/restart/account-switch flow passed as documented below.
- Physical small/midrange Android screenshots and inspection at 1.3–2.0 font scale, TalkBack, touch/insets/keyboard, predictive Back, Remove animations, haptics off, slow/failed art and measured latency/frame timing. An emulator screenshot does not establish physical performance.
- Named circle management, richer moderator queue and native review editing need fuller management surfaces. Editor undo restores the local draft; server save remains explicit.
- Feed/library pagination and 200-row virtualization/performance acceptance; this first client uses bounded API pages/catalog.
- Verified HTTPS App Links domain association and browser/game-store ACTION_SEND intake.
- Cosmos/Entra/FCM, provider catalog terms, cost/deletion/restore/load evidence and cloud release acceptance.

## Native emulator evidence

Environment: API36 Google APIs x86_64, Pixel7 AVD (1080x2400,420dpi), KVM acceleration, headless SwiftShader. This is emulator evidence, not physical-device performance or production-signing acceptance.

- `adb install` returned **Success** for the verified APK; `sys.boot_completed` returned 1 and `com.ludex.app/.MainActivity` was resumed. The final updated APK also installed with `-r` successfully.
- Android logcat showed `ReactNativeJS: Running "main"`; the inspected log contains no `FATAL EXCEPTION` or ReactNativeJS error.
- Native screenshot capture waited for remote artwork to render. `phone-android.png` and `feed-android.png` are explicitly **sample lounge preview**; `profile-android.png` shows **The sample lounge**. These were captured with `adb exec-out screencap -p`, not browser rendering.
- Native independent visual review identified reaction touch size. Likes/replies now explicitly use 48dp minimum content height. Final UIAutomator clickable bounds measured 126px at 420dpi (126/2.625=48dp). The final feed capture is from the rebuilt APK.
- Real disposable account A signed in through the UI. A private, unrated Dune movie log was saved while airplane mode/Wi-Fi/data were disabled. Native Library showed **1 pending journal action**.
- `am force-stop` followed by `am start` while offline retained the authenticated owner and the one pending action.
- Airplane mode was disabled and Wi-Fi/data reenabled. Foreground retry drained the action; native Library displayed Dune with pending cleared. API inspection confirmed one Library item, version 1, one run with `movieViewed:true`, no rating, and the entered note.
- Sign-out confirmation cleared device drafts/cache. AccountB signed in through the UI and showed the empty Library; neither A's title nor its pending action appeared. API B library count was 0. Both disposable accounts were deleted afterwards with authenticated HTTP 200, and test app data was cleared.
- This was one bounded smoke, not exhaustive lifecycle, social-policy, accessibility or performance certification.

Evidence files under `.impeccable/review/`:

| File | State |
| --- | --- |
| `phone-android.png` | Native sample feed top with lounge artwork |
| `feed-android.png` | Final native sample session spread, art, note, 48dp reactions |
| `profile-android.png` | Native sample profile vignette and portrait covers |
| `log-picker-android.png` | Real authenticated catalog picker |
| `log-android.png` | Real private-by-default movie log form |
| `offline-queue-android.png` | Real account A one pending action offline |
| `offline-restart-android.png` | Same pending action after offline force-stop/reopen |
| `synced-library-android.png` | Real account A movie after reconnect/drain |
| `account-b-library-android.png` | Real account B empty, isolated Library |
