---
name: Ludex
description: After Hours — a cinematic social archive, with one consistent type family.
---

# Ludex: After Hours

The user's latest direction asks for consistent fonts, correct alignment, a distinctive interface and custom cinematic motion. The existing Sunburst cinema architecture and coral/chartreuse signature remain; repetitive rounded cards, pill filters and generic slogans give way to an editorial journal with a framed cinema screen, open activity rows, collectible covers and shelf rails.

## Typography

**Sora is the sole family** for brand, display, body, controls, navigation, forms, dialogs and metadata on both clients. The web uses a local variable WOFF2 with an explicit 100–800 weight range. Android registers five static instances (400, 500, 600, 700, 800) under explicit aliases and uses `fontWeight: normal` with the selected face. This prevents the prior variable-face/synthetic-weight mismatch. Paper text roles, input text and native navigation receive the same family. OFL licenses ship beside both sets of font assets. Body text remains left aligned for reading; phone showcase identity, avatar and edit controls form a centered composition.

Web roles: display 36–56px / 750; headline 31px / 650; section title 23–28px / 600–650; body 14px; control 12–13px / 650; metadata 10–12px. Tracking floor -0.04em. Native uses Material text roles plus explicit Sora face styles; text scaling stays enabled.

## Palette and surfaces

Ink #160D20, web surface #24182F, native surface #29182F, raised #30213F, pearl #F3E9FA, orchid #F3DFFF, coral #FF735F, chartreuse #D8FF76, web muted #C0B0CB, native muted #C7B5D0, line #57405F. Hover coral #FFA394/#FFAD9F/#FFA594; borders #A380B3/#886396/#8B6A99/#8E6BA0; translucent pearl corners #FFF0ED8C; supporting artwork text #DCC9E3/#E7DBE9/#E5D4EC. Deep image/frame fields #22152C/#382140/#382740 and low-opacity ink gradients derive from the cinema scene. Shadows have soft offset depth; card containers use a border or shadow, not both. Showcase themes retain coral, lime and lavender local accents.

## Composition and alignment

A split cinema frame crops the original auditorium inside an arched screen. The headline, short product-specific copy and logging/search action have a common left edge. Fanned, clickable catalog covers sit within the frame. Finite screen-opening motion emphasizes the art without obstructing controls. Feed rows show authors, visible progress, title art, optional human notes and social actions without a card around every entry. No fabricated note is supplied when the user has not written one.

The reading column is centered within the companion shell; sidebar and rail yield to mobile navigation on narrow screens. Buttons center labels and icons optically and mathematically. Profile shelves use open headings, actual counts, offset cover shadows and a subtle shelf rail. Phone profiles center identity and controls; landscape shelves stack to accommodate long titles. Search, forms, receipts and settings share compact 6–12px corners and the same typography.

## Motion and preferences

Anime.js WAAPI authors a finite 900ms cinema aperture (`clip-path` + opacity), 650ms copy entrance and short poster stagger. Motion springs provide poster hover/press on a separate inner surface. Visible activity entries retain bounded observer reveals. CSS cover lifting uses 240ms easing and is restricted to fine pointers. Native Reanimated handles UI-thread entrance and press feedback. No perpetual decoration, scroll hijacking, delayed input or artificial loading.

Saved/system reduced motion cancels current effects and leaves every control visible. Low-data and unresolved account preferences withhold the premiere image request; existing remote catalog covers retain the older CSS hiding behavior. Clip-path frame cost and physical-device FPS remain measurement work, not performance claims.

## Verification

The new web typography test first reproduced the mixed-family bug, then verified the loaded Sora family across four destinations and title dialogs, 320px reflow and 200% zoom. Native role regression verifies static aliases and disables synthetic weights. Current verification, installed emulator captures and limitations are in `docs/validation/after-hours-refinement.md`. The older Premiere report is historical. Provider/Supabase/Google OAuth integration remains queued separately from this visual correction.
