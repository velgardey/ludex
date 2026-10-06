---
name: Ludex
description: A cinematic journal for films, series, and games
colors:
  violet: "#B6A3CF"
  primary-on-web: "#21192B"
  copper: "#C89571"
  ink: "#15121C"
  surface: "#211D28"
  raised: "#272334"
  text: "#E8E4DF"
  muted: "#A99FB4"
  native-muted: "#AAA3B3"
  line: "#322C3B"
  native-outline: "#514A5D"
  native-error: "#FFB4AB"
  matinee-accent: "#CFB290"
  midnight-accent-web: "#A9B5D1"
  midnight-accent-native: "#B1B7DC"
typography:
  display:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "39px"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "-1.1px"
  headline:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "36px"
    fontWeight: 400
    lineHeight: 1.17
    letterSpacing: "-1px"
  title:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "22px"
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: "-0.4px"
  body:
    fontFamily: "Source Sans 3, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Source Sans 3, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.3px"
rounded:
  compact: "6px"
  control: "7px"
  artwork: "8px"
  feature: "12px"
  web-overlay: "15px"
  native-sheet: "24px"
spacing:
  compact: "8px"
  control: "12px"
  row: "16px"
  section: "24px"
  content-web-desktop: "37px"
  content-web-mobile: "22px"
  content-native: "20px"
components:
  button-primary:
    backgroundColor: "{colors.violet}"
    textColor: "{colors.primary-on-web}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "11px 17px"
    height: "41px"
  button-secondary:
    backgroundColor: "{colors.raised}"
    textColor: "#D3C4E1"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "11px 17px"
  icon-button:
    textColor: "#B0A4BB"
    rounded: "{rounded.control}"
    width: "34px"
    height: "34px"
---

# Design System: Ludex

## Overview

**Creative North Star: "The Atmospheric Cinema Lounge"**

Ludex gives a personal journal the quiet anticipation of a room before the feature begins. The shared visual world is plum-black, pearl, muted violet, and copper; locally loaded artwork and expressive serif titles provide the spectacle while the journal stays calm enough to scan and use.

Feed, library, and logging are Operate surfaces: action labels stay plain, metadata stays subordinate, and social entries are separated by fine dividers instead of a stack of generic cards. The profile showcase is an Experience surface: featured artwork, mixed-media shelves, and their sequence lead the visit. The website and Android app share the same palette and type voices, but use different platform controls and responsive composition.

Web screenshots are available at .impeccable/review/desktop.png, .impeccable/review/mobile.png, and .impeccable/review/profile.png. They show the companion website at desktop and web-mobile sizes. Android emulator captures are available at .impeccable/review/phone-android.png, feed-android.png, and profile-android.png. They show the installed internal x86_64 APK on API36, including native tabs, screen insets, Paper controls and loaded artwork. Physical-device, TalkBack and motion/frame performance acceptance remain open.

**Key Characteristics:**
- **Story-led, task-clear:** artwork opens the experience; operational controls remain direct.
- **Quiet dark room:** deep plum surfaces, readable pearl text, and restrained accent light.
- **Two platform expressions:** one design world, web layout and Android system controls.

## Colors

The palette uses violet for action and selection, copper for editorial cues, and plum neutrals for the room around the story.

### Primary
- **Lounge Violet:** the main active and primary-action color. It marks selected navigation, the log action, and interactive focus.
- **Matinee Accent:** an optional profile-theme accent that warms a member's showcase.
- **Midnight Accent:** an optional profile-theme accent. Its web and native values differ slightly in the current implementation.

### Secondary
- **Story Copper:** ratings, media labels, metadata, the Ludex mark, and occasional ornamental details.

### Neutral
- **Plum Ink:** the page and web-shell background.
- **Lounge Surface:** quiet web surface treatment; native Paper maps its main surface roles separately.
- **Raised Plum:** active navigation and raised or grouped controls.
- **Pearl Text:** primary reading color.
- **Primary Action Ink:** web text color on the filled violet action; native Paper maps its primary foreground to Plum Ink.
- **Muted Lavender:** secondary labels, timestamps, and supporting copy.
- **Plum Divider:** separates social entries and content groups without boxing each one in.
- **Native Muted:** native Paper supporting text, kept distinct from the web muted value.
- **Native Outline:** native Paper outline and divider color.
- **Native Error:** native Paper error state.

**The Velvet-Light Rule.** Keep violet tied to a choice or action, and copper tied to story metadata and brand details. Theme accents may change a showcase's accent; they do not replace the shared base palette.

## Typography

**Display Font:** Fraunces (self-hosted, with Georgia and serif fallbacks)
**Body Font:** Source Sans 3 (self-hosted, with Arial and sans-serif fallbacks)

**Character:** Fraunces gives story titles and showcase headings a literary, film-credit quality. Source Sans 3 carries the interface, forms, metadata, and longer journal notes with a clear, compact rhythm. Android waits for these local fonts before rendering its routes, showing an ink-colored screen with a violet activity indicator while they load; a font error lets the app continue.

### Hierarchy
- **Display:** feed and page headings; the same face also anchors the Ludex wordmark at a heavier weight.
- **Headline:** prominent story names on artwork-led spreads.
- **Title:** compact work titles, modal headings, and shelf titles.
- **Body:** interface copy and longer reading; notes may open up in size and line spacing when they are the point of the entry.
- **Label:** buttons and action labels. Dense metadata is smaller in the current web UI, so keep small type to nonessential detail.

**The Two-Voice Rule.** Use Fraunces for story identity and section emphasis; use Source Sans 3 for actions, navigation, form labels, and supporting information.

## Layout

The website uses a fixed left journal rail, a compact top bar, a central content column, and a quieter right rail on wide screens. Its shell caps at 1800px; the content region caps at 1160px, with a 288px right rail at the wide desktop size. At 1200px the left rail narrows; at 1000px the right rail disappears and the content becomes a centered single column. At 760px the left rail becomes a top-bar wordmark and a fixed bottom navigation with a central Log action. The bottom navigation reserves extra space below the page footer, and its background includes the device's safe-area inset.

The web library changes between cover grid and list. Showcase shelves use a cover grid for portrait work and a landscape spread for larger moments. Preserve cover artwork at 2:3 and use wide artwork for story spreads rather than cropping every work to one shape. At very narrow widths, the cover grid remains two columns and the spread becomes more compact.

The Android app uses a native tab bar and native route presentations, with screen content inset from the device edge. It is not a screenshot-identical version of the custom website shell. Feed, library, and logging prioritize reachable controls and readable list rows; showcase uses a broad cinematic header followed by horizontal cover or landscape shelves.

**The Story-First Rule.** Give artwork the large canvas on a lead session or showcase. Keep the reading order, action labels, and progress context visible around it.

**Visual evidence limit.** desktop.png, mobile.png and profile.png are website captures; mobile.png is the responsive website, not an Android capture. The separately named Android captures show the API36 phone emulator and its installed APK. They establish native rendering at that emulator size, not physical-device accessibility or performance.

## Elevation & Depth

The feed and library are mostly flat: divider lines organize rows, while tonal backgrounds distinguish active navigation, grouped controls, and error notices. Artwork carries most of the visible shadow. The current web implementation also uses shallow depth for the main log action and stronger separation for dialogs and toasts; those are functional overlays, not a general card-shadow vocabulary. Native Paper controls and system sheets inherit platform treatment.

The web uses a blurred dark scrim behind centered dialogs and a restrained fade/scale entry. Regular reading and scroll position do not receive decorative motion. Buttons provide brief color feedback and a small pressed nudge. Web reduced-motion media preference disables transitions and animation; the saved web preference also adds a reduction class. The Android app combines the saved Reduce motion setting with the operating-system accessibility preference. When either is enabled, Expo Router stack transitions are set to none and React Native Paper animation scale is set to zero.

**The Quiet-Rail Rule.** Keep feed and library content on the page plane, with dividers doing the structural work. Reserve deeper shadow and blur for artwork or a temporary layer that needs separation.

## Shapes

Shapes are gently curved and component-specific: compact controls and fields use small corners, artwork uses soft clipping, feature images and avatars have their own silhouettes. The web modal uses a broad, responsive curve; the Android logging sheet has its native presentation curve; feed rows stay open and divider-led. The approved direction called for a consistent 16px content-panel radius, but current spread, dialog, and native-container shapes vary, and no shared panel-radius token is implemented.

Web feed filters are underlined tabs, and web library filters are softly squared segmented controls. Android media filters use React Native Paper chips. The settled pill-filter direction is not represented by one shared cross-platform shape in the current build.
## Components

**Buttons.** The primary action is a filled violet control with dark text; the secondary action sits on a raised plum surface with a fine border. Small icon buttons keep a compact square target. Hover and focus states clarify interactivity; disabled web buttons reduce opacity, with spoiler-hidden title actions deliberately retaining full text visibility.

**Navigation.** The desktop web rail highlights the current destination with a tonal field and violet text. On web mobile, the fixed bottom bar centers the Log action between Feed, Library, Discover, and Showcase. Android uses Expo Router native tabs, with a native selected indicator and labels.

**Filters.** The web feed uses a simple underline for the selected Following/Friends view. The library uses a compact segmented control. Android uses Paper chips for media and library filters, and Paper segmented buttons for list/grid density.

**Artwork and story spreads.** A lead feed item uses landscape art with a dark lower vignette, story title, media/year context, and a separate note and rating below. Later entries use compact portrait covers beside the title and reading context. Missing or failed artwork falls back to a title treatment; low-data mode suppresses art imagery.

**Showcase shelves.** Featured art leads into either portrait cover shelves or broad, ordered landscape spreads. Captions, shelf title, and audience remain adjacent to the work. The selected profile theme changes the local accent, not the base lounge identity.

**Inputs and overlays.** Search and form fields sit on a dark field with an outlined edge; keyboard focus changes the border and adds a subtle ring. Web dialog, toast, form error, and empty-state treatments use concise copy and distinct presentation. Native route sheets and Paper fields keep their own platform geometry.

**Current limits.** Web artwork, caption, and footer are represented in the fresh review screenshots. Native colors and component mappings are implemented, but Android tab rendering, touch-state appearance, safe-area spacing, and the reduced-motion result still need device-level visual verification. Small web metadata currently reaches 8px; reserve that scale for secondary labels and never transfer it to key actions or reading copy.

## Do's and Don'ts

### Do:
- **Do** keep violet on active or primary actions and copper on ratings, metadata, and brand accents.
- **Do** use Fraunces for story-led headings and Source Sans 3 for operational text.
- **Do** preserve cover and landscape-art proportions, and keep titles legible over artwork with a dark vignette.
- **Do** separate ordinary feed and library entries with dividers; use depth where artwork or an overlay needs it.
- **Do** provide a visible keyboard focus treatment and descriptive labels for icon-only actions.
- **Do** keep sample, empty, error, and spoiler-hidden states visually distinct and readable.
- **Do** treat web screenshots as web evidence; compare native controls against a future Android capture before claiming parity.

### Don't:
- **Don't** add decorative scroll animation, stagger every feed entry, or insert a startup animation.
- **Don't** turn routine feed rows into elevated generic cards.
- **Don't** carry the website's fixed desktop rails or custom bottom bar into Android when native navigation is already implemented.
- **Don't** shrink action labels or journal notes to the current smallest metadata size.
- **Don't** describe native rendering as visually verified until a device capture shows the Paper and Stack reduced-motion result.
