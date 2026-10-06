> Historical report for the preceding Premiere commit. The Sora font correction and current design evidence are in [after-hours-refinement.md](after-hours-refinement.md).

# Midnight Premiere redesign — 2026-10-06

The user authorized a bold, highly animated replacement of the muted lounge visual world and explicitly requested Sunburst images. The redesign is implemented in the isolated `codex/ludex-stage-a` worktree. It preserves Stage A's local account, manual progress, social, privacy, shelf and offline contracts. No cloud deployment or automatic provider connection is established by this work.

## Web implementation

Original optimized Sunburst architecture is the feed/discovery signature, paired with oversized Fraunces headlines and three clickable real catalog covers. Coral actions, chartreuse progress/logging markers, contrasting search, pill filters, framed activity cards, profile themes and rounded configurable shelves form the new system. The shared design token package and design documentation were updated.

Anime.js 4.5.0 was added. It supplies finite compositor-friendly WAAPI entrances; Motion already present supplies poster springs. IntersectionObserver reveals visible feed stories once. Animation cleanup runs on unmount and preference changes. Controls work throughout animation. Saved or system reduced motion removes animation; low-data hides imagery and retains text. CSS base visibility prevents a hydration failure from hiding the interface.

## Fresh verification

- `pnpm verify`: ESLint, all workspace types, 61 tests (3 domain / 25 API / 2 client / 4 web / 27 native), optimized Next build and 14 static pages passed.
- `pnpm exec playwright test`: all 14 browser flows passed on the development site.
- `PLAYWRIGHT_BASE_URL=http://localhost:3001 pnpm exec playwright test`: all 14 passed on the static export.
- Five new browser tests cover reduced-motion operability, finite motion with immediate title navigation, live preference cancellation/input focus, observer settling, and no premiere image request for low-data accounts while settings resolve. The initial two tests were observed failing for the absent premiere surface before implementation.
- Account boundaries, friends visibility, private log/undo, collections/reviews/showcase persistence, export and completed-item save remain covered.
- An initial full-run feed-banner timing failure passed isolated rerun and the complete development/static reruns; no account implementation was changed. Back-to-back development/static fixture creation later hit the existing 20-auth-requests-per-minute local limit; the last two fixtures failed before valid accounts. Those flows passed after the rate window reset, and the standalone exported suite was rerun. Phone showcase overflow was traced to legacy negative margins and corrected; its original narrow-layout regression passed after correction.

Batched static captures: `.impeccable/review/desktop.png`, `mobile.png`, `profile.png`, `profile-mobile.png`, `discover.png`, `discover-mobile.png`, `small.png`. Widths 1440, 390 and 320px had no horizontal overflow and no page errors. Captures establish rendered composition at those dimensions. External covers can fail or remain lazy; a title fallback remains visible. A fresh reviewer identified priority art preloading for low-data accounts. The hero now waits for hydrated account identity and its own guarded settings response before mounting the image. A network regression was observed failing before the fix. Existing external cover low-data behavior remains CSS hiding and is not claimed as transfer prevention.

A local motion/navigation recording is `artifacts/premiere/ludex-premiere-preview.webm`.

## Android

Native tests/types/lint passed (27 tests, including mid-press reduced-motion cancellation); final APK build and captures are recorded below when complete. Physical-device frame performance, TalkBack, large font sizes and store/production signing remain separate acceptance gates. The local beta has no universal global sub-second latency claim.

## Review disposition

A fresh read-only code/visual review found one important issue: the new priority hero still requested its image under low-data. The image and its rail-background consumer were gated on hydrated identity and the active account's guarded settings response. A network test now verifies zero premiere image requests while preferences are unresolved and after low-data resolves, with input focus still working. The scoped re-review marked the finding resolved. No account or provider behavior was changed. The controller also found a native pressed-scale animation remaining active after reduced-motion changed. A failing native regression then passed with cancel/reset and immediate release handling.

The final showcase persistence browser test was strengthened to wait until the Save showcase dialog closes (server save completed) before reloading. The previous immediate reload could interrupt the pending HTTP write. A followup trace also showed 429 responses because repeated runs left fixture accounts behind: refresh issued 104 social-status calls for one test principal. The final run uses a fresh ignored fixture database `.local/premiere-final.sqlite`, preserving `.local/ludex.sqlite` intact. The product implementation was unchanged. This fanout remains a limitation for larger populated cohorts.

Final native artifacts rebuilt after the reduced-motion fix:

| Artifact | Build | SHA-256 |
|---|---|---|
| `apps/mobile/artifacts/ludex-stage-a-x86_64-internal.apk` | x86_64 release assembly, 50s | `751e0535d7a302610ed00579570cbf1a70bfd447262302ea07b3718311e38876` |
| `apps/mobile/artifacts/ludex-stage-a-arm64-internal.apk` | ARM64 release assembly, 69s | `01e5ff72426951cbf2ae76e3f72c526146d21c651e3f6279b3af95f43e0cef75` |

Both retain the Android Debug signing certificate. The x86 build embeds `http://10.0.2.2:4000/api`; ARM64 embeds `http://127.0.0.1:4000/api` for `adb reverse`. They are internal development artifacts. The final x86 APK was reinstalled on the existing Pixel 7 API36 emulator after reconnect. Build timings report local tool execution, not runtime performance.

Fresh final installed-APK captures: `.impeccable/review/phone-android.png` (sample hero), `feed-android.png` (full session card), `discover-android.png` and `profile-android.png`, all 1080 × 2400 from API36. These replace the old lounge captures. Sample activity remains labeled; catalog images loaded; the card includes rating, audience, note and social actions. Android declares the bundled Fraunces family but the captured Paper display text renders as a bold sans face. The current native rendering therefore differs from the web editorial serif; exact native font mapping remains a minor polish item and is not claimed as matched typography. Native discovery and showcases use their own platform compositions.

Native navigation reached the sample feed, discovery and profile in the final installed x86 APK. `logcat` showed React Native main running and no FATAL EXCEPTION or captured JavaScript error in the bounded flow. The virtual device disconnected once; the existing AVD was restarted and final APK reinstalled. No physical phone was used.

The final bounded native visual review found no material clipping or layout defects in the refreshed feed, discovery, profile and premiere captures. It accepted the documented bold sans display as a coherent platform variation rather than a blocker. This verdict applies to those emulator captures and the inspected fix scope only.
