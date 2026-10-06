# Ludex: deeper experience and integration design

Date: 2026-10-06

Status: proposals under discussion. Confirmed: Android-only global English-speaking free non-commercial beta, initially TV/PC gaming friend groups; public followers/reviews/discovery and opt-in public presence; atmospheric cinema lounge with showcase/feed quality first; about 100 invited accounts/10–20 simultaneous; US$10/month target potentially subsidized by Azure credits/deployments; capped conversational AI with confirmation before writes; Steam and desktop Chrome/Edge Netflix capture with optional detection. Migration and emulated-game provisions are required. Q1–Q32 are resolved; the user requested the implementation plan. No application or connector implementation is claimed.

Read with [the original product brief](ludex-product-brief.md), [provider feasibility](../research/progress-sync-feasibility.md), [deeper provider research](../research/integration-depth-2026-10-06.md), and [mobile quality-of-life feasibility](../research/mobile-qol-feasibility.md).

## Differentiation hypothesis

The category already contains mature pieces of this idea. Letterboxd documents a film journal, discovery, friend activity and customization; Backloggd documents game collections, multiple playthroughs, friend activity and alternate covers; Serializd describes social episode tracking. Sequel and Sofa market multiple-media organization and convenient capture or progress features. These are first-party feature claims, not a comparative runtime audit. Sources: [Letterboxd FAQ](https://letterboxd.com/about/faq/), [Backloggd about](https://backloggd.com/about/), [Serializd](https://www.serializd.com/), [Sequel developer listing](https://apps.apple.com/us/app/sequel-media-tracker/id1630746993), [Sofa](https://www.sofahq.com/).

Therefore unified media, custom posters, AI lookup, and a feed should be treated as requirements rather than a sufficient novelty claim. The hypothesis to test is that Ludex makes the entire shared experience coherent: **capture → choose together → watch/play → record a moment → discuss safely → retain a personal memory**.

The differentiation is proposed, not proven. Interview friend groups, then measure whether this connected flow produces repeated use and replaces actual coordination work. Compare a strong simple shortlist/logging experience against the AI version before assigning value to AI.

## Second-round decisions: constraints that change the build

The user selected **Android only for now**, **global English-speaking beta**, **explicit per-source sharing followed by selected automatic posts**, **a central conversational AI companion**, **shared plans and scoped discussions**, and **curated themes/configurable shelves**. Scope is **about 100 users** with **ongoing monthly service cost within US$10**, using Azure access.

The user accepts existing Azure credits/deployments as potential subsidies. The cost target is not a claim that portal access supplies free resources. Track actual metered cost and credit-adjusted cash paid separately; credit balance/expiry, subscription eligibility, existing deployment billing, token rates and storage/egress remain unverified. Build/operation will be through Codex; no deadline was provided. Design for 100 invited accounts and roughly 10–20 simultaneous users, as selected by the user.

The first beta does not need an iOS application. Android share intents, verified App Links and in-app quick log deserve early device validation; native widgets and companion delivery are separate milestones. The companion website supports useful public/shared pages and limited management; a globally hosted low-latency backend and always-on realtime cannot be promised inside the cost ceiling without evidence.

### Conversational companion as a central surface

Keep one reachable assistant conversation with contextual entry points from a title, collection, plan, review and library. An entry such as “Help us choose” carries the selected shortlist rather than making the user restate it. The main navigation still gives direct access to deterministic actions.

The companion can retrieve permitted personal memories, explain recommendations, resolve references in follow-up questions, propose logs and edits, help arrange a shelf, and answer a bounded game/episode question at the user's spoiler boundary when source coverage allows. It is private by default; a shared plan receives only user-approved outputs, not all participants' private assistant histories.

Use compact conversation state, a user-visible memory list and explicit tool proposals. Persist selected useful preferences rather than automatically embedding every conversation forever. Prior messages and retrieved records are data, not authorization to publish or alter access. The user approved minimal relevant authorized personal context with explicit controls, and requires confirmation for every assistant write in beta. A central companion can be text-first and usage-capped; centrality does not imply unlimited cloud inference, voice streaming or continuous background agents.

The proposed cheap path runs ordinary search/filtering and simple reference resolution without repeated LLM calls, retrieves a small authorized context, invokes a small metered model only when needed, and reuses public catalog summaries where permitted. RAG still applies without an expensive managed search service. The final storage/index choice depends on current free-tier limits and the beta's accepted scale/latency tradeoff.

## Public-first social scope: user decision and resulting proposal

The user selected public followers, reviews and discovery in Q3. This supersedes the original brief's recommendation to begin with mutual friendships only. Q2 also authorizes planning optional extension/companion routes; their exact platforms and telemetry remain feasibility decisions.

Use directed follows for public content plus a separate accepted friendship/circle relationship for restricted sharing. Public accounts can expose permitted reviews, collections and curated showcases. A follower is not automatically entitled to live presence, private notes or private library context. The user selected explicit per-source sharing followed by selected automatic posts; historical imports remain quiet and live-presence settings remain separate.

Proposed mobile navigation becomes **Feed, Library, Discover, Profile + Log**. Feed opens Following and can include a friends/circle filter. Discover includes catalog, people, public reviews and public collections, with explicit search categories. This replaces the narrower Friends destination recommendation. Public web pages can provide searchable shared reviews and showcases, with visibility and spoiler rules enforced server-side.

Essential public-social behaviors: persistent review drafts, editing with publication timestamps, a distinction between logging and publishing, follow/unfollow, notification/mention controls, blocking, reporting, spam/rate limits, comment controls, and a manageable moderation queue. If comments support rich text, sanitize it and preserve explicit spoiler spans. Do not publish private drafts or inferred activity simply because an account is public.

Discovery should show its basis: followed people, selected interests, saved collections, or broader public activity. Let users switch back to chronological Following and hide a title/author/topic. AI-generated collection drafts remain attributable to their user and do not masquerade as personal reviews from real play/watch experiences.

Pilot evaluations now need two loops: existing friend groups using shared progress and new followers finding a reviewer/collection worth returning to. Public ratings should show sample context and avoid a precise taste-compatibility percentage from a tiny overlap. A similarity explanation can say which mutually visible titles agree or differ.

## Product mechanics with depth

### 1. A recommendation retains its context

Saving a title from a friend's post retains an authorized pointer to who recommended it, the original note, and a shared-plan context if any. Later, the library can answer “why did I save this?” and offer “tell them what you thought.” If the original activity becomes inaccessible, the pointer stops exposing it while the saved title remains in the user's library.

Save from a title, feed item, list, supported incoming link, or a user-provided screenshot. Exact links can resolve deterministically; image or ambiguous text matching produces candidate titles with year/media/edition distinctions. No background clipboard reading or camera requirement. A share entry point should preserve the sending app context and allow a quick save without forcing the full Ludex app open, subject to platform validation.

### 2. Tonight is a bounded choice

An optional shared shortlist has participants, a date/window, media type, allowed duration, region and access preferences. People add options or vote. Show three plausible options with concise reasons, allow manual choice, then preserve the plan as a shared memory.

For games, a 45-minute window means a plausible session, not finishing the game. For films, runtime is useful. For television, identify the specific next episode. Filter constraints deterministically before any AI explanation. When constraints have no match, say which constraint needs loosening rather than silently violating it.

Adding a plan to a calendar or sharing a link is user-triggered. RSVP does not mean someone watched. A host cannot silently mark every participant completed; each person's own log or authorized telemetry controls their progress.

### 3. An activity carries a conversation

Treat major progress as a conversation object with optional personal note, reactions, scoped replies, and an action to recommend or save. Raw player telemetry remains in the private session timeline until eligible for publication. One grouped session can represent multiple episode completions or achievement unlocks while preserving the underlying timestamps.

Allow an immediate log to the library and a later note, so users do not have to write before continuing their activity. Keep drafts across interruptions. Editing or removing a session must update the associated feed summary without re-notifying all recipients.

If one group member advances faster, discussion threads keep explicit episode/milestone scopes. A generic group chat cannot provide this guarantee by itself. Free-text spoilers still require author scopes and moderation; automatic detection assists rather than guarantees perfect classification.

### 4. Profile as a personal program

Curate favorites and mixed-media shelves with a small number of deliberate layouts: a featured work, a balanced cover shelf, a collection spread, and a milestone shelf. Use real cover aspect ratios rather than cropping every game box and poster into identical squares. Offer art focal-point adjustment and a readable fallback when backdrop art is absent or unsuitable.

Keep a private journal separate from the public or friend-facing program. Private notes and screenshots stay private unless explicitly included in a published item. Users can curate a “right now” shelf, a retrospective, or a mixed-media Journey without changing the underlying activity history.

Changing a theme previews the actual profile, supports undo, and does not make other users' feed typography or accessibility preferences unpredictable. Attractive export/share cards are user-triggered and redact inaccessible or spoiler-gated content. The user chose curated themes/configurable shelves, with public expression and separately restricted content.

## Quality-of-life requirements

Priority labels below are proposed: **Essential** protects daily use, **Distinctive** tests the product hypothesis after the core works, **Later** is a separately budgeted expansion. Inclusion is not a commitment to implement every idea in release one.

| Feature | Concrete behavior | Priority |
| --- | --- | --- |
| Fast progress | One visible “watched next episode” action; a compact movie log; a game session or milestone shortcut. Details remain editable. | Essential |
| Undo and correction | Undo supported actions and inspect edit history. Repeated taps, retries and reconnects produce one log. Corrections survive repeated source snapshots. | Essential |
| Flexible ratings | User selected optional ten-point ratings, likes and text. A like/favorite can exist without a score. Never require a review or numerical judgment to mark progress. Default to integer 1–10; fractional precision can be considered later without changing the log flow. | Essential |
| Date precision | Support known timestamps, date-only entries, approximate older history, and unknown dates. Do not invent midnight timestamps that change across time zones. | Essential |
| Series edge cases | Specials, alternate episode orders, split seasons, unreleased episodes, skipped episodes, and rewatches preserve explicit episode identities. Require review of uncertain mappings. | Essential |
| Continuing shows | Caught-up status follows released watched episodes; a new season restores a next-episode opportunity without rewriting past completion history. | Essential |
| Games and editions | DLC, remasters, bundles, platforms and separate playthroughs remain distinguishable. Provider achievements belong to their supported edition/platform and may be account-lifetime rather than per-playthrough. | Essential |
| Offline use | Cached library and drafts work offline. Stable queued commands expose pending/failed status and recover without losing notes. | Essential |
| Returning from a service | Opening a watch/play destination preserves Ludex's place. Returning offers the original title and a clear log action; returning is not evidence of completion. | Essential |
| Import preview | Preview counts, conflicts and uncertain matches before committing. Apply a batch ID and offer a scoped reversal of imported data that preserves later user changes. | Essential |
| Personal shelves | Saved filters, list/grid view, sort, bulk edits, owned versus wishlist distinction, and a searchable archive. | Essential |
| Quiet notification design | User selected direct interactions first and optional activity digest. Add per-title/event controls, quiet hours, mentions and snooze. No repeated notification from an edited or reimported event. | Essential |
| Feed continuity | Restore scroll position and read/unread state; offer new items without moving content under the user's finger. | Essential |
| Language and region | Alternate titles, localized catalog fields, release region, time zone and provider region. Display the searched alias alongside canonical identity when useful. | Essential |
| Source transparency | Human-readable status such as “last checked 10 minutes ago.” Resolve permission or credential failures with a direct next action. | Essential |
| Data ownership | Export useful structured records; disconnect a source without losing manual notes; provide account deletion and revoke derived personal search access. | Essential |
| Friend invite path | A shareable profile/plan link can open a limited permitted preview before sign-up and continue after authentication. | Essential |
| Public expression | Review drafts, separate publish action, follows, public collection/people search and audience-aware profile preview. | Essential under Q3 |
| Public interaction quality | Comment and mention limits, configurable replies, report/block, basic moderation tooling and duplicate/spam handling. | Essential under Q3 |
| Accessibility and comfort | Dynamic type, screen-reader actions, adequate tap targets, contrast, reduced motion, low-data mode, haptic toggle. | Essential |
| Share-to-save | Resolve supported links; ambiguous titles or screenshots show a compact choice. Platform entry points require separate verification. | Distinctive; likely early |
| Remembered recommendations | Show why a title was saved and offer to reply to the recommender after completion, subject to current permissions. | Distinctive |
| Shared next queue | Identify mutual backlog options and the next shared episode without exposing excluded/private library items. | Distinctive |
| Buddy checkpoints | Agree to a target episode or milestone and discuss up to it. No pressure to exceed personal time budgets. | Distinctive |
| Smart shelves | User-readable saved rules such as owned unplayed games or unwatched films available on selected services. | Distinctive |
| Home-screen shortcuts | A widget for next episode, current game and shortlist; actions follow ordinary auth/offline rules. iOS/Android feasibility is a later platform check. | Distinctive |
| Release calendar | Region-aware releases and opted-in reminders, with separate announced/estimated dates and source freshness. | Distinctive |
| Optional memories | Session notes, personal retrospectives and user-selected screenshots, with source-linked AI drafts. | Distinctive |
| Physical collection lending | Optional loan record and return reminder for owned discs/games, disclosed only to selected people. | Later |
| Price and availability alerts | Only when a licensed source provides sufficiently fresh region/edition/offer data. An availability change is not proof of personal entitlement. | Later |
| Full chat or synchronized player | Separate products requiring delivery, moderation or player capabilities; scoped discussions and planning come first. | Later |

## Integration design: five separate jobs

Avoid a single vague “connected” badge. Integrations can support different capabilities:

1. **Identity:** confirm who owns an external account. Account linking alone does not grant access to all its data.
2. **Catalog:** identify a work, episode, game edition and its metadata.
3. **Access:** discover where an item is available in a selected region, with a checked date and offer type.
4. **Progress:** observe playback, sessions or achievements where a source exposes them.
5. **Action:** open a destination or export an explicitly requested update where supported.

For example, a provider link can help launch a title without supplying progress afterward. A storefront ownership import does not mean the game was played. Identity and deep linking cannot fill gaps in telemetry.

### A user-facing connection flow

1. Choose the source and see its exact capabilities in plain language.
2. Authorize the required account or configure a supported self-hosted source.
3. Map the provider account/profile to the correct Ludex user. Shared household media activity must not publish under the wrong person.
4. Preview historical records and uncertain matches, then choose what to import.
5. Select library-only versus chosen social publication, event types and any live-presence preference.
6. Show last successful import, how fresh current observations are, and a direct path to disconnect or repair.

The product page should say “Sync watched episodes” or “Import Steam achievements.” Advanced webhook/API configuration belongs in a focused setup flow for the relevant power users, not normal logging screens.

### Evidence and event rules

| Incoming evidence | Allowed inference | Not established |
| --- | --- | --- |
| Owned title | Ownership/access record within the source's semantics | Started, played, watched or completed |
| Current game presence | “Reported playing” while the observation is recent | Boss defeat, exact session start, completion |
| Increase in total playtime | Additional source-reported time between checks | Exact session boundaries or narrative progress |
| Newly unlocked achievement with timestamp | Provider-reported unlock at its available time precision | Gameplay legitimacy; which replay earned it without extra data |
| Player watched/scrobble event | Watched according to that player's completion rule | Attention, full viewing, or another participant's completion |
| Stop/pause event | Playback stopped/paused | Watched completion |
| User log | User-reported state at selected precision | Independently verified activity |
| AI description or screenshot interpretation | Proposed title/milestone match to confirm | Automatic achievement verification |

Provider-reported events may be modified by users/tools on the source. Avoid a universal “verified” badge that suggests anti-cheat or proof of watching. Keep the feed presentation concise while making provenance available in details.

### Duplicate and correction handling

Use canonical mappings plus per-source event identities; retain origin records. Two sources reporting the same episode in a short window can become one social viewing event only when identity/time evidence supports it. Ambiguous duplicate detection should not erase legitimate rewatches.

Library state, session grouping and publication have separate lifetimes. A later source correction recomputes the affected summary. A user can remove an imported event from their diary or unpublish it without granting the connector permission to recreate that same post on its next poll.

Track occurrence time, ingestion time, available precision, and provider checkpoint. A newly received old event appears in historical context; it does not look like the friend just completed it. Expire presence when observations go stale, and use last-seen copy rather than displaying “playing now” indefinitely.

### Polling cost and latency

Push events can enter an internal queue promptly, but sources with snapshots require scheduled reads. Per-user, per-game achievement polling can grow quickly: polling 10,000 linked users every minute is already 10,000 identity checks per minute before achievement calls.

Proposed strategy: limit reads to connected users who opt into current progress, cache stable schemas, prioritize currently/recently active titles where observable, apply adaptive intervals within provider limits, use jitter and backoff, and maintain freshness budgets separately for library history and optional live presence. If quota cannot support a promised freshness tier, lower the promise rather than conceal stale observations. Concrete intervals require source quotas, user scale and budget decisions.

Cross-client consistency does not depend on mobile background execution staying alive: the backend owns supported external ingestion; the mobile client owns its local commands and cache. A future browser extension can buffer its own authorized observations and send them later without changing their occurrence time.

### Findings that change the integration priorities

Steam's official profile summary endpoint supports batches of up to 100 account IDs, and its published API terms include a daily call limit. This favors batched presence checks plus slower per-game achievement/history refreshes, not continuously polling every linked game. Optional current-game fields and achievement timestamps still require actual response validation; do not assume native SDK fields are identical to public Web API payloads. [Steam profile API](https://partner.steamgames.com/doc/webapi/ISteamUser), [Steam API terms](https://steamcommunity.com/dev/apiterms)

Trakt's history, playback and last-activity concepts provide a useful bridge for compatible player scrobbling, including the Kodi addon. A player writes progress into Trakt; Ludex checks authorized changes. This is broader than a one-time import but cannot observe arbitrary streaming applications. [Trakt sync](https://trakt.docs.apiary.io/reference/sync), [Kodi addon](https://github.com/razzeee/script.trakt)

Plex's built-in webhook documents play, pause, resume, stop and watched/scrobble events; a generic periodic progress event is not established by that list. Jellyfin's provider-maintained webhook plugin can be an alternative power-user route. Both need account/user filtering, receipt validation appropriate to their actual authentication mechanism, deduplication and observable connector health. [Plex webhooks](https://support.plex.tv/articles/115002267687-webhooks/), [Jellyfin webhook plugin](https://github.com/jellyfin/jellyfin-plugin-webhook)

Microsoft documents Xbox title-website authentication and achievement endpoints; independent consumer-app access is still a gated validation question. This refines the original console feasibility assessment. Epic/GOG title SDKs and generic game rich presence likewise must not be presented as universal consumer-account sync. [Xbox website authentication](https://learn.microsoft.com/en-us/gaming/gdk/docs/services/fundamentals/s2s-auth-calls/service-authentication/live-website-authentication?view=gdk-2604)

TMDB's JustWatch-backed provider data identifies availability by country but explicitly lacks full title deep links. A commercial provider such as Watchmode offers a different link/coverage surface and requires separate procurement. Within the US$10/month ceiling, do not include a paid availability contract without a compatible quote. “Available on,” “open this title” and “automatically track this title” remain three separate capabilities. [TMDB providers](https://developer.themoviedb.org/reference/tv-series-watch-providers), [Watchmode documentation](https://api.watchmode.com/docs)

The optional browser extension can start as a user-clicked active-page save/log shortcut with explicit site access. Automated observations require separately supported site adapters, bounded permissions, browser lifecycle testing and provider terms review. A desktop companion can help relay a user's own supported player sessions; installing it alone does not expose arbitrary bosses. [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [Chrome background lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)

### First extension: explicit adapter acceptance

The user selected Steam plus a browser extension as the first automatic/capture route: desktop Chrome/Edge, Netflix first, quick capture plus optional detection. The extension is a separate desktop browser component; its events can appear on Android after backend acceptance, but it does not observe playback inside Android streaming apps. Q31 selects transparent quick capture and confirmed logging when detection is uncertain.

Proposed adapter responsibilities: resolve a title and episode to canonical candidates, map the explicitly chosen account/profile, observe supported visible player state, retain a stable local session ID, record bounded playback observations with occurrence times, and display enabled/paused/needs-review status. Where identifiers or completion cannot be resolved reliably, prompt the user to select/log rather than silently guessing.

Manual capture uses a user-clicked active tab. Optional automatic mode requires site-specific consent and user-visible controls. Define a watched event from sufficiently covered playback under the selected site's validated semantics, not merely opening a page, seeing a video end, seeking near the end, or returning to Ludex. Account for replay, autoplay-next, multiple tabs/devices, buffering, background tabs, advertisements, trailers, browser suspension, offline upload and site updates. If accurate coverage cannot be established, generate a confirmation proposal rather than an automatic watched state.

Do not extract service passwords/session cookies, bypass media access controls or depend on undocumented private APIs to fill evidence gaps. A limited supported adapter is a user-controlled capture tool, not a claim of provider partnership. Validate applicable provider/browser rules before distribution. Site compatibility failure should disable that adapter and leave manual capture/logging available.

Acceptance requires side-by-side controlled viewing observations and Ludex events: correct title/episode/profile, exact source precision, no duplicates, no watched event from a seek/stop, explicit handling of paused and ended sessions, safe offline retry, preserved user corrections, no public post without source-sharing opt-in, and spoiler-safe activity text. A local scripted test of an abstract video element alone does not prove compatibility with a real streaming site.

## Migration and emulated games

The user requires importing existing catalog/library, viewing and rating data from Letterboxd and other popular cataloging websites, plus provisions for emulated games. [Import/emulation feasibility](../research/imports-and-emulation.md) records documented source paths and unknowns. Q29/Q30 select catalog/manual sessions plus optional RetroAchievements, and Letterboxd + Trakt dedicated importers alongside generic mapped CSV.

### Import as a product experience

Provide a visible “Bring your library” entry point, source-specific format adapters where documented, and a generic column-mapped CSV route. Import may include source catalog IDs/URLs, title/year/type, watched episode sets, dates at their actual precision, ratings, watchlist/backlog, notes/reviews and list membership only when the source supplies them and the user opts in. A website name in a supported-source list must correspond to an actually tested adapter, not a speculative capability.

Stages: parse locally where feasible; preview detected fields and row counts; resolve IDs before fuzzy names; review uncertain matches/remakes/episode orders; explain merge/skip rules; choose private notes versus optional later public text; commit one auditable batch; show a summary and remaining review queue. A repeated upload is idempotent for the same source records. Preserve original imported values and transformation provenance.

When mapping a five-star rating to Ludex's selected ten-point scale, display the rule (e.g. 4.5/5 becomes 9/10) and retain the source value. Missing ratings remain missing. Duplicate titles across lists retain memberships. An old review's authored date differs from the date the user imported or published it in Ludex. Imports remain quiet in the current feed; publishing imported reviews is a separate explicit choice.

Batch reversal removes or retracts import-owned assertions without discarding later manual edits, discussions or shelves. Large files use bounded validation, resumable background work and readable per-row issues. Never execute formulas or interpret imported text as tool instructions. Catalog/review content may have provider-specific reuse conditions; importing one's own data does not grant access to other users' datasets.

### Emulated game identity and progress

A library entry needs the game's original release platform/edition plus an independent played-on device/method field. An emulated PS2 release, its native PC port and a remaster can be related but should not silently share achievements, progress or ratings. Manual sessions and milestones work even when no external achievement provider supports the title.

Store optional emulator name and edition metadata; ROM upload is not a requirement. A desktop companion may later observe an explicitly selected launch/session, but launch or process runtime is not evidence of a boss defeat or completion. A timer can record an acknowledged session estimate and label it accordingly.

RetroAchievements is a candidate source for supported games/emulators and is separate from Steam achievements. Its documented APIs include game progress and earned dates, with distinct hardcore/casual values; use the source's stable user ULID when available because usernames can change. Keep game hash/set identity where supplied, achievement set/version, supported mode and provider unlock chronology separate from a chosen playthrough. Web API access is key-based polling rather than ordinary scoped OAuth; production key handling and payloads need validation. Internal emulator callbacks are a separate engineering path, not an externally accessible universal hook. [RetroAchievements game progress](https://api-docs.retroachievements.org/v1/get-game-info-and-user-progress.html), [API setup](https://api-docs.retroachievements.org/getting-started.html)

## Showcase-first milestone

The user selected an exceptional cinematic showcase and feed as the acceptance priority, superseding the previous preference for broad daily-loop reliability first. Confirmed first milestone, with technical scope recommended by this plan: a distinctive Android profile/session-spread feed backed by real accounts, working follows, private/public scopes, manual logs, public review drafts, configurable shelves and actual persistence. Visual quality is evaluated through real populated screens, interactions, typography, artwork fallback and representative Android performance.

Subsequent milestones deliver source-specific imports, Steam snapshots, Netflix extension capture/detection, optional RetroAchievements and connector health, followed by the capped conversational assistant, confirmed writes and shared planning. Q32 confirms persistent cinematic feed/showcase first, then integrations/AI; no beta deadline was provided. Q31 permits transparent capture/confirmed-log fallback when Netflix detection is uncertain. The first milestone can be cinematic without claiming integrations that it does not yet execute.

Minimum visual review set: populated Following feed with compact and session-spread variants; an achievement with spoiler-hidden detail; public profile and its shelf editor; title detail with follow-through to Log; library at low and high density; contextual companion sheet; and a source/import preview with uncertainty. Review small-phone layout, dynamic text, art focal points, slow image loads, empty/error states and a returning user's scroll continuity. Do not approve style solely from an oversized landing-page hero.

Following is readable by default; a session spread is the visual high point. Profile includes a featured work and curated configurable shelves, with a small theme set and a reachable edit preview. Public live presence is allowed only by explicit opt-in with stale expiry and per-title hide controls; it must not appear automatically just because the account's reviews are public.

## Budget constraint and product tradeoffs

The user set a US$10/month target for about 100 invited accounts with 10–20 simultaneous users and accepts existing Azure credits/deployments as potential subsidies. [Azure budget feasibility](../research/azure-100-user-budget.md) has been reviewed against official source limits. The user selected single-region delivery with measured refresh and capped short AI conversations with fallback. Until region, subscription eligibility, actual model rate, credit conditions and measured usage are known, the monthly total cannot be confirmed.

Proposed lean beta path: one production region, static companion pages where feasible, an on-demand backend, a verified free database allowance if eligible, small metered object storage and minimal telemetry, deterministic catalog/search filters plus a compact retrieval index, and capped text-model requests. Do not provision dedicated AI Search, API Management, Redis, paid realtime, multi-region replicas or managed always-on agents solely because they are common architecture components.

Application-side cost controls include maximum input/output tokens, explicit conversation retrieval budgets, atomic reservations for simultaneous model requests, per-user allowances and one global allowance, retries charged to the same accounting flow, capped upload sizes, bounded image/storage retention, and logs without verbose personal payloads. A response count alone is insufficient because context/output/reasoning may vary in cost. Model usage accounting must use the selected deployment's billing units. No autonomous daily AI digests for every account in the initial budget scenario.

Azure budget alerts should be used for visibility; they are not a guaranteed hard stop. A free database's pause-at-limit setting may prevent that database's overage but can disrupt the entire product. If a hard cost ceiling takes precedence over uptime, disclose the actual limit state and allow local manual capture to wait for recovery. Do not call a free-tier pause transparent reliability.

Frequent feed refresh and connector timers can keep a SQL serverless database awake. The documented 100,000 monthly vCore-second grant is a compute allowance, not permission to run unrestricted queries continuously; at an illustrative average of 0.5 billed vCore it covers about 55.6 active hours. This arithmetic is not a measured billing quote. An eligible Cosmos free-tier account may fit sustained small-beta activity differently, but requires bounded partitioned feed/relationship queries and tested access-control projections. Choose one after verifying eligibility and load; do not introduce both solely to chase free allowances. [SQL free-offer compute guidance](https://learn.microsoft.com/en-us/azure/azure-sql/database/free-offer), [Cosmos lifetime free tier](https://learn.microsoft.com/en-us/azure/cosmos-db/free-tier)

The low-cost acceptance check includes actual execution/compute meters, database read/write costs, blob transactions/storage, model tokens, polling frequency, errors/retries and credit-adjusted versus underlying cost over representative usage. Per-account quotas must handle simultaneous calls atomically. Existing paid deployments may still charge marginal tokens; provisioning nothing new does not make usage free.

Low latency has distinct dimensions: local interaction, backend response time, provider observation freshness, and cross-user fan-out. A local save can be immediate while a distant friend sees it only at the next refresh. The user accepted a single-region beta for global English-speaking testers with measured refresh, not a multi-region low-latency deployment. Proposed 15–30-second active foreground refresh is a starting experiment, not a measured guarantee; use cursors, conditional requests and backoff.

Codex-based build/operation should use a small deployable backend, typed adapters, migrations, reproducible local checks, structured health logs, backup/restore steps and concise recovery instructions. Critical service behavior must run in the application or configured infrastructure; Codex is not an unattended operator merely because it wrote the code. Recurring agent monitoring requires an explicitly requested automation. No monitoring automation or cloud resource has been created by this design.

### AI at integration boundaries

Use deterministic matching for external IDs and title links. Use AI only to help with ambiguous user-provided text or image matching and provide a review list. Keep a candidate's title/year/media/edition visible. A model can suggest that an achievement relates to a boss, but the source schema or curated mapping must establish the event's actual meaning before publishing that specific wording.

Retrieval rules restrict what provider-derived content may be embedded, retained or sent to a model under its applicable terms. Personal notes and catalog text need separate indexes/scopes. User or source text is untrusted data and cannot expand tool permissions or change a log operation.

## Cinematic direction: atmospheric cinema lounge selected in Q4

The user selected an atmospheric cinema lounge. This supersedes the original lime-on-black recommendation. The first row below is the selected conceptual direction; the remaining rows record considered alternatives. Exact tokens and typography remain proposals until actual screens are reviewed.

| Direction | Palette proposal | Type and composition | Signature candidate |
| --- | --- | --- | --- |
| Atmospheric cinema lounge — selected | Ink plum `#15121C`, smoked indigo `#272334`, pearl `#E8E4DF`, muted violet `#B6A3CF`, warm copper `#C89571` | Expressive serif display paired with clear sans body; quiet surfaces; framed artwork and generous negative space. | A session spread connecting a work's artwork, the user's short note, and a precise progress marker. |
| Experimental film magazine | Carbon `#171719`, paper `#E9E5DC`, vermilion `#DF553E`, steel `#929CA4`, pale yellow `#E4D38E` | Condensed display with emphatic scale shifts; editorial asymmetry; denser grid with deliberately varied cover sizes. | A personal cover issue composed from the user's current collection. |
| Futuristic achievement space | Midnight `#111A22`, slate `#263441`, frost `#DEE7EC`, cobalt `#7198ED`, amber `#E2B366` | Technical display and highly readable sans; aligned progress data; clear achievement detail. | A controlled milestone map tied to a supported game, with spoiler-safe nodes. |

Proposed type roles for the lounge: a restrained Fraunces-style display face for profile titles and major moments, a Source Sans 3-style body face for social reading, and platform tabular numerals for progress. Exact fonts, licensing, multilingual coverage and rendering performance need validation before adopting them. No claim that these particular families are final.

### Screen-level direction

- **Feed:** a compact Following stream with artwork anchored to the activity; a friends/circle filter and larger session spreads for meaningful completions or notes. A small shared-plan entry point sits above the feed without replacing it with a promotional hero.
- **Library:** user-controlled density, recognizable cover silhouettes, clear next-action affordances and progress captions. Shelf transitions preserve spatial position.
- **Discover:** search first, a bounded set of recommended options second. Explanations are short and expandable; decorative AI chat bubbles do not dominate the screen.
- **Title detail:** artwork establishes atmosphere, then a sticky reachable action area and the user's social context. Never place text over busy art without a readable treatment.
- **Profile:** one expressive composition selected by the user; the rest uses disciplined configurable shelves within curated themes. Support public showcases with separately controlled private notes and progress.
- **Log:** a quick sheet optimized for the current title. The cinematic identity lives in type, spacing and restrained feedback, not a sequence that delays recording.

### Motion and sound rules

Use continuity between a cover and its detail screen, brief direct-manipulation feedback, and an optional restrained reveal for a major completed experience. These are timing proposals, not measured rendering behavior. Aim for short interactions around 150–250 ms, interrupted immediately by a new user action. Low-power/reduced-motion modes simplify effects; feed scrolling gets no continuous decorative motion.

No default autoplay trailers, animated grain over scrolling content, full-screen fog/blur, startup logo delay, or mandatory celebratory sequence. Sound is off by default. A static subtle texture can belong to a profile composition if it remains readable and inexpensive. Every gesture has a discoverable button alternative.

Copy remains plain: “Log episode,” “Save for later,” “Playing with friends,” “Last checked.” The visual voice supplies atmosphere without turning functional labels into obscure cinema metaphors.

## Design tree and grilling state

Confirmed root: mobile first, companion website; initial audience of TV/PC gaming friend groups; account connections plus optional extension/companion; public followers, reviews and discovery; atmospheric cinema lounge direction; film/TV/game scope; social experience, strong style and low latency; AI and integration investigation requested.

Q1 settled by the user: **friend groups into TV and PC gaming**. Prioritize shared episode progress, PC sessions/achievements, and shared choices across those activities. Movies remain fully represented in the library and discovery.

Q2 settled by the user: **account connections plus optional extension/companion**. These routes are optional; ordinary mobile logging remains complete. Research source-specific feasibility before promising coverage.

Q3 settled by the user: **primarily public followers, reviews and discovery**. Directed follows become a core relationship; accepted friends/circles handle separately scoped progress. Feed replaces the initially proposed Friends-only destination.

Q4 settled by the user: **atmospheric cinema lounge**. Develop the first visual concept around a session-spread composition; palette/type/motion details still require screen validation.

Q5 settled by the user: **polished private beta for real users**. Durable data and working permitted social interactions are prerequisites; this is not a visual-only prototype.

Second frontier completed:

Q6–Q12 are settled as recorded in the second-round decisions above. Later the user clarified Codex-based build/operation and accepted subsidizing existing Azure credits/deployments; deadline remains unspecified. Budget source research is complete, with eligibility and actual rates unverified.

Third frontier completed:

- **Q13 AI data:** minimal permitted personal context with controls, public catalog only, or defer policy decision.
- **Q14 AI writes:** confirmation for every write, unambiguous direct writes with undo, or suggestions only.
- **Q15 Ratings:** optional five-star, ten-point, or non-numerical opinion.
- **Q16 Notifications:** direct interactions, selected friends' completions, or broader followed activity.
- **Q17 Shared plans:** shortlist/vote/RSVP/time plus scoped discussion, shared queue only, or synchronized playback.

Q13–Q17 settled by the user: permitted minimal personal context with explicit controls; confirm every assistant write in beta; optional ten-point ratings/likes/text; direct interactions first with optional activity digest; shared plans contain shortlist, RSVP/time and scoped discussion. The assistant cannot confirm on the user's behalf. A typed or tapped approval of a presented action is distinct from merely asking a question about an item.

Fourth frontier completed:

- **Q18 Cost scope:** hosting/AI for non-commercial beta, every ongoing service, or subsidized credits/deployments.
- **Q19 AI allowance:** capped short responses, richer access for fewer users, or unlimited requirement.
- **Q20 Global delivery:** one region with local feedback and measured refresh, essential sub-second friend updates, or narrower geographic pilot.
- **Q21 Concurrency:** 100 invited accounts with 10–20 simultaneous, sustained daily-active audience, or 100 simultaneous users.
- **Q22 Connector ordering:** Steam/Trakt, Steam/extension, or Steam/self-hosted TV sources.
- **Q23 Operator/deadline:** team and timing; unknown remains explicit if not provided.

Q18–Q23 settled by the user: existing Azure credits/deployments can subsidize; cap short conversations with fallback; single region/measured refresh; 100 invited with 10–20 simultaneous users; Steam plus browser extension first; build and operate through Codex. Deadline was not provided. Credit eligibility, catalog terms and actual rate quotes remain factual validation work, not assumptions.

Fifth frontier completed:

- **Q24 Extension scope:** quick capture plus optional one-site detection, capture only, or automatic tracking required.
- **Q25 First browser/site:** desktop Chrome/Edge and a named supported website, with explicit Android-app coverage boundary.
- **Q26 Presence audience:** friends/circles opt-in, optional public presence, or completion-only beta.
- **Q27 Commercial intent:** non-commercial free beta, later monetization, or paid/ad-supported launch.
- **Q28 Acceptance priority:** dependable complete loop, showcase-first, or automation-first.

Q24–Q28 settled by the user: quick capture plus optional detection; desktop Chrome/Edge Netflix first; opt-in presence may be public; free non-commercial beta; exceptional cinematic showcase/feed first. Migration from popular catalog sites and emulated games are additional requirements.

Sixth frontier completed:

- **Q29:** catalog/manual sessions for emulated games plus optional RetroAchievements; original platform, device/emulator and provider achievement identity remain distinct.
- **Q30:** Letterboxd + Trakt dedicated importers, plus generic mapped CSV. Other dedicated formats require independent verification.
- **Q31:** transparent Netflix capture + confirmed-log fallback when detection cannot establish the title/profile/completion.
- **Q32:** persistent cinematic Android feed/showcase first, then integrations and AI.

The product interview is closed for planning. Remaining provider permissions, rates, samples and package compatibility are execution-time factual checks. Routine technical recommendations are recorded explicitly in [the beta specification](ludex-beta-spec.md) and [the delivery plan](../superpowers/plans/2026-10-06-ludex-delivery.md). The user requested the plan after these questions; this authorizes documentation, while application implementation is a subsequent task. No application features or connectors have been implemented.
