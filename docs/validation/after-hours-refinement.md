# After Hours refinement — 2026-10-07

Request: one consistent font everywhere, aligned/centered controls, distinctive cinematic UI and custom motion. Baseline `d84f0c1`, branch `codex/ludex-stage-a`, existing isolated checkout. This is a refinement of Stage A, not implementation of the queued provider/database/Google login work.

## Changes

One Sora family: web local variable WOFF2 explicitly declares 100–800; Android registers static regular/medium/semibold/bold/extrabold aliases with `normal` weight. Paper roles/default, native route headers/tabs/inputs and explicit headings now use the same family. The old two-family assets are removed. FontTools inspection verifies five non-variable Android fonts with actual OS/2 weights 400/500/600/700/800; web WOFF2 is 49,332 bytes.

A split arched cinema frame reuses the original Sunburst art. Feed rows and shelves gain open editorial spacing, consistent role sizes, aligned action labels/icons and readable human content. Phone showcase identity is centered, with landscape shelves stacked. Rounded pill/card repetitions and ungrounded fallback note/slogans are reduced. Anime.js WAAPI authors a finite cinema aperture reveal, Motion handles poster spring, CSS sends one short projector reflection across hovered covers, and Reanimated handles native entrance/press. System/saved motion and low-data guards persist.

## Automated evidence

- Font browser regression was red before implementation: four headings/paragraphs used a different family. After implementation it checks the loaded family on Feed, Discover, Library, Profile and title dialog controls; 320px and 200% zoom reflow pass.
- Native font regression was red before implementation and now checks every Paper role including default selects a registered static Sora face with normal weight. A second rendered-screen regression was red for the preview onboarding action remaining after preview load; the guard now omits it in active preview.
- `pnpm verify`: exit 0; lint, workspace types, 63 tests (3 domain, 25 API, 2 client, 4 web, 29 native), optimized static export of 14 pages.
- `PLAYWRIGHT_BASE_URL=http://localhost:3001 pnpm exec playwright test`: 16/16 passed against the exported site. Covers account boundaries, actual persistence, friends/privacy, authenticated export, save preservation, low-data/motion and new typography/reflow checks.
- `git diff --check`: clean.
- Impeccable detector: one run, 26 palette advisories, no blocking mechanical findings. Derived hover, border, translucent artwork and shadow colors are intentional and documented in DESIGN.md.

## Visual evidence

Batched desktop/phone feed, discovery, showcase and library screenshots: `artifacts/after-hours/`. First batch found cramped phone identity; one correction batch centered it and stacked long landscape titles. All seven layouts report no horizontal overflow. Missing remote catalog artwork keeps a title fallback rather than hiding content; network image success is not guaranteed. A video records actual exported-site entrance, cover interaction and title dialog: `artifacts/after-hours/ludex-after-hours.webm`.

Read-only review found no blocking source issue. It confirmed the registered static weight files, typography mapping, narrow reflow and motion/low-data guards. A remaining timing caveat: saved motion preferences load asynchronously, so a brief entrance can start before the preference is applied; subsequent cancellation is verified. Android system-motion detection also initializes asynchronously. Strict first-frame suppression is not claimed.

Both final Android APKs assembled with Expo57/Gradle9.3.1 and passed signature verification (internal Android Debug certificate):

| ABI | Bytes | SHA-256 |
|---|---:|---|
| x86_64 | 48,850,941 | `4816802bc2a62f40d2fd45d8e5619853002d7c14662bc448abe31a6a6cf46f66` |
| arm64-v8a | 47,406,445 | `f6960540f42f67823fa8ffe5762fb33f2b231ef9dc522643a0f124a454ebbe52` |

x86 embeds emulator `10.0.2.2:4000/api`; ARM64 embeds `127.0.0.1:4000/api` for USB forwarding. Artifact manifest is updated. Only x86 is installed on the Pixel7/API36 emulator; no physical-device verification is claimed. Physical-device frame time, TalkBack and store signing remain unverified. Do not infer those from screenshots or mocked native unit tests. This pass does not claim global realtime latency or reliable external sync.


Final installed x86 captures from API36: `native-after-hours-feed-android.png`, `native-after-hours-discover-android.png`, `native-after-hours-profile-android.png` and `native-after-hours-large-type-android.png` under `.impeccable/review/`. Root inspected them directly: the populated feed omits the preview CTA, all displayed text uses Sora, profile has centered header/shelf labels and reachable horizontal covers. The large-type capture uses Android font scale1.3 on Discover; text wraps and search remains readable; the horizontal media-filter row exposes the Games label at its right scroll edge, so expanded text needs horizontal scrolling. This is not a full large-text accessibility acceptance. The system setting was restored to1.0 after capture. A bounded1500-line logcat scan found no FATAL EXCEPTION or captured ReactNativeJS Error/TypeError/ReferenceError. This is a bounded emulator flow, not broad accessibility or hardware performance acceptance.
