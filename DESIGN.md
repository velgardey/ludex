---
name: Ludex
description: Midnight premiere — a cinematic social journal for films, series and games.
---

# Ludex: The Midnight Premiere

The user requested a bold, animated replacement for the muted lounge design. Ludex now uses original Sunburst cinema architecture, oversized editorial typography, electric coral actions and chartreuse progress accents. The feed and showcase remain the first priority. Real catalog covers, human notes and personal curation supply the content; generated artwork supplies the brand world.

## Color and typography

| Role | Value | Use |
|---|---|---|
| Ink | #160D20 | Main dark room |
| Surface | #21142E | Native and web content surfaces |
| Raised | #30213F | Grouped controls and contrast |
| Electric coral | #FF735F | Primary actions and active navigation |
| Chartreuse | #D8FF76 | Logging, progress, ratings and media markers |
| Pale orchid | #F3DFFF | Contrasting filters and search |
| Pearl | #F3E9FA | Main reading text |
| Silver lilac | #BFAFCB | Supporting copy |
| Cinema edge | #493352 | Structural borders |

Fraunces is the existing editorial display voice, used at a deliberately larger scale for brand and story identity. Source Sans 3 remains the interface voice. Both fonts are self-hosted. Showcase themes vary local accent color: coral lounge, chartreuse matinee, lavender midnight. Source code retains legacy `violet`/`copper` variable names for compatible components; they now resolve to coral/chartreuse.

## Composition

The web premiere header pairs original cinema architecture with a large title, clear action and three interactive catalog covers. The hero mounts only after account preferences permit it, then loads eagerly; other media covers remain lazy. Poster silhouettes overlap intentionally without covering primary controls. Search uses a pale contrasting field. Feed filters use pills, and activity frames use layered aubergine, readable borders and restrained shadows. The lead story has panoramic artwork, a saturated media badge, title, note and rating.

The showcase opens with user-selected artwork and identity, followed by configurable portrait and landscape shelves. Its curation remains data driven. Missing or failed artwork retains title fallback. Low-data mode withholds the new premiere image request and preserves content and controls. Existing external covers use CSS hiding and are not claimed to avoid all web transfers.

Desktop retains sidebar and companion rail. Below 1190px the reading column leads without a rail; below 760px it uses mobile navigation. Android uses Expo Router tabs, native route sheets and Paper controls with the same palette, cinematic header and story frames. Its captured display text renders as bold sans despite the registered Fraunces family; exact native font mapping remains a minor polish item, not verified typography parity. It retains durable offline and account behavior.

## Motion

Anime.js WAAPI provides finite premiere choreography: copy fades and lifts over 650ms, artwork settles over 1100ms, and posters enter with a short stagger. Motion provides a spring on a separate poster inner surface for hover and press, avoiding competing transform ownership. Visible feed stories reveal once through IntersectionObserver with a 450ms opacity/transform transition. No continuously running decoration, scroll listener or per-frame React state is used.

Buttons and inputs work during every animation. System and saved reduced-motion preferences cancel ongoing entrances, disable spring interactions and remove CSS motion. Android uses Reanimated on the UI thread for entrance and pressed feedback and combines system and saved preferences. Static screenshots establish composition; they do not establish physical-device frame rate or accessibility acceptance.

## Components and quality

Primary actions use coral with dark text; the main Log action uses chartreuse. Secondary actions use raised surfaces and readable borders. Search, dialogs, receipts and empty states share rounded cinema geometry. Profile themes change local accents while keeping the base world recognizable.

Keep samples explicitly labeled, public/private audience settings separate, spoiler fields omitted, and all writes grounded in real account state. Preserve keyboard focus, semantic labels and platform touch controls. External catalog/AI/provider connectors remain separate delivery stages.

Source: `app/premiere.css`, `web/components/PremiereStage.tsx`, `web/hooks/useReveal.ts`, and `apps/mobile/src/`. Verification and current capture paths are recorded in `docs/validation/premiere-redesign.md`.
