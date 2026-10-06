# Ludex imports and emulated-game activity

**Research date:** 6 October 2026
**Status:** Primary-source review and product proposal. No provider account, CSV sample, OAuth flow, emulator, or API integration was tested at runtime.

## Recommendation

Treat imports as a way to make Ludex useful on day one, not as a way to backfill a public social feed. Prioritize a user-initiated Letterboxd ZIP/CSV import, a generic header-mapped CSV route, and an explicitly authorized Trakt account migration. Add MyAnimeList/AniList only if the beta cohort has meaningful anime usage. Keep Backloggd CSV export and Serializd export out of the launch promise until the current official capability and format are verified.

For emulated games, make the game, platform, and edition visible in the library; support manual sessions and milestones for every title; and offer an opt-in RetroAchievements connector for supported games. Its documented Web API is a pull interface, not a real-time feed. A future desktop companion can receive richer events only when a supported emulator's RetroAchievements integration exposes them. Neither route establishes universal emulator/game telemetry.

Keep the first import short: let a user choose an archive or authorize a source, show counts and a compact match summary, then commit high-confidence matches. Put ambiguous titles, remakes, anime editions, and episode mappings in a review queue that can be finished later. Preserve the source rating and date rather than pretending ratings share a common scale. Historical records remain private unless a user separately opts selected *future* event types into public sharing. A source import must never manufacture backdated feed posts or notifications.

## Source capability review

| Source | First-party evidence | Ludex use and boundary |
|---|---|---|
| **Letterboxd** | A member can generate an account export ZIP of CSV data from the official [data export page](https://letterboxd.com/user/exportdata/). Letterboxd's official [CSV import instructions](https://letterboxd.com/importing-data/) document importing watched films, diary entries, ratings, reviews, tags, lists, and watchlist data. The documented importer accepts a CSV with title/year and optional rating, watched date, rewatch, tags, and review fields; Letterboxd also documents CSV import from IMDb. | Best first archive import for a film-focused cohort. Treat the export as a historical snapshot, not live sync. The public export page does not enumerate every ZIP filename/schema; exact parser behavior and list/watchlist coverage must be validated against a user-generated sample export before Ludex advertises field-level guarantees. Letterboxd's API is a separate approval path, not required for this import. |
| **Trakt** | Trakt's official [API-use policy](https://developer.trakt.tv/docs/api-use-policy) permits a user-authorized application to manage that user's own history, ratings, and lists and to migrate that user's data. The [Sync API reference](https://trakt.docs.apiary.io/reference/sync) documents history, ratings, watchlist, and list operations; [OAuth](https://developer.trakt.tv/docs/authentication-oauth) is the authorization path. Its [rate-limit documentation](https://developer.trakt.tv/docs/rate-limiting) currently documents 500 authenticated GETs per five minutes per user and one write per second per user, subject to change. | Strongest candidate for TV/movie account-to-account migration after app registration, policy and consent review. Read only the connected user's records, request only needed capabilities, cache within policy, and stop on disconnect. The API's scrobble methods are player-to-Trakt writes; they are not a Trakt-to-Ludex event push feed. Do not import other people's Trakt activity or community lists to seed Ludex discovery/social data. |
| **IMDb** | Letterboxd's official [IMDb migration guide](https://letterboxd.com/about/migrating-from-imdb/) describes exporting IMDb ratings, check-ins, watchlist, and lists and importing supported CSVs. It notes that IMDb review text is not included in the available export. | Support the documented IMDb CSV as a user-selected one-time import path where the supplied file matches the officially described format. Preview categories and match results; do not imply that this supplies full episode viewing history or review text. |
| **Backloggd** | Backloggd's [official roadmap](https://backloggd.com/roadmap/) has listed CSV export as a planned feature. | Do not advertise Backloggd export/import as supported until the current product ships it and an official format is documented or validated. Offer Ludex's generic CSV template as a fallback. |
| **Serializd** | Serializd has official [Trakt migration](https://www.serializd.com/trakt) and [TV Time migration](https://serializd.com/tvtime) pages. I found no first-party documentation in this review establishing a Serializd data-export feature. | Do not claim a Serializd export format or direct importer. The presence of Serializd's own import paths does not prove it can export records to Ludex. Recheck first-party docs before adding support. |
| **MyAnimeList** | The official [MyAnimeList API v2 reference](https://myanimelist.net/apiconfig/references/api/v2) documents an authenticated `/users/@me/animelist` query, list status fields, and user authentication. | An opt-in account import can retrieve the consenting user's anime list and ratings/progress fields allowed by the API. Confirm registration, field selection, and current API access before committing. Anime title/season/special mapping still needs a canonical-ID review path. |
| **AniList** | The official [AniList API reference](https://docs.anilist.co/reference/query) documents GraphQL access to media and media lists. Its [Media](https://docs.anilist.co/reference/object/media) record includes AniList ID, MyAnimeList `idMal`, title variants, format, and episode metadata; [MediaList](https://docs.anilist.co/reference/object/medialist) includes status, score, progress, repeat, dates and privacy. | Useful as a user-authorized anime list import and as a partial MAL-to-AniList crosswalk. It does not establish universal AniList/MAL-to-TMDB/TVDB mappings or one-to-one equivalence for split seasons, specials, recap films, or adaptations. Keep raw provider IDs and send uncertain matches to review. |
| **Netflix history** | Netflix's official [viewing activity instructions](https://help.netflix.com/en/node/101917) allow a profile owner to download the watched-title list as CSV. | Use as an optional one-time viewing-history import only. It provides neither a documented public playback API nor evidence of live episode-completion timing or ratings. Netflix browser capture is covered in the companion integration research; it should stay a user-invoked quick-capture aid. |

“I found no export documentation” means only that the first-party sources reviewed did not establish one; it is not proof that a private or newly shipped capability cannot exist. For all formats whose export schema is not published, require validation with a user-generated sample before claiming column completeness. Do not ask users to send private archives just to begin product planning.

## Import pipeline and quality-of-life contract

The import feature should feel like a continuation of the user's existing taste, not a migration project:

1. **Choose a source.** Explain exactly what it can import (e.g. “films, diary dates, ratings and lists”) and when it last syncs. Manual logging remains available without connecting accounts.
2. **Select data and visibility.** Separate library import from future public sharing. Historical imports are private by default and quiet. Sharing is per source and event type, not bundled into account authorization.
3. **Preview.** Show record counts, likely duplicates, unmatched rows, uncertain remakes/editions/episodes, source rating scale, and date precision. Do not show one unexplained success percentage.
4. **Commit quickly.** Import deterministic exact-ID/high-confidence rows in one action; retain ambiguous rows in a review inbox. Keep normal use under the three-minute onboarding target even if resolving the long tail takes longer.
5. **Correct and disconnect.** Preserve manually edited notes, ratings, collections and progress when an imported record is retried. Users can disconnect credentials separately from deleting imported history, and can remove a particular import batch without erasing later edits.

For each imported fact, retain a provenance envelope: provider namespace and external ID, original raw value/scale, source record/event ID where available, original date and its precision/timezone if supplied, import batch, match confidence, and whether the user later corrected it. Do not synthesize an exact timestamp from a date-only value. Deduplicate provider records without collapsing legitimate rewatches, alternate cuts, game editions, or separate playthroughs.

Store scores as `source + value + scale` first. Any cross-provider display score is a separate, clearly defined Ludex transformation; preserve the original score so the user can audit it. Convert source lists into named collections while retaining source title and ordering where present. These are proposed Ludex transformations, not claims about a provider's export schema.

The generic CSV path should be a Ludex-owned, documented template, not a claim that every site exports the same columns. Offer a header mapper for title, year, media type, date, rating, status, external ID, tags, and list/collection. Resolve exact provider IDs first, then exact title/year/type; use fuzzy/AI suggestions only to rank candidates for a human. Never let an LLM commit a match or infer a watched episode, score, play session, or achievement. For cost and privacy, use deterministic matching first and invoke generative AI only for user-approved ambiguous batches; do not embed an entire private archive by default.

## Emulated games and RetroAchievements

### What the official Web API supports

RetroAchievements' official [Web API documentation](https://api-docs.retroachievements.org/) requires a member-generated Web API key, passed as the `y` parameter; the [getting-started guidance](https://api-docs.retroachievements.org/getting-started.html) says to protect it like a password. The reviewed docs describe key-based access rather than OAuth scopes or a standard user-consent flow. Treat this as a feasibility and credential-security gate before production; never ask users for their RetroAchievements password or expose the key in a public feed.

The documented pull endpoints provide useful, source-attributed data:

- [`GetGameInfoAndUserProgress`](https://api-docs.retroachievements.org/v1/get-game-info-and-user-progress.html) returns one game's achievement progress, earned dates, completion counts/percentage, and playtime-related fields for the requested account.
- [`GetAchievementsEarnedBetween`](https://api-docs.retroachievements.org/v1/get-achievements-earned-between.html) supports timestamped unlock history over an epoch time range; [`GetUserRecentAchievements`](https://api-docs.retroachievements.org/v1/get-user-recent-achievements.html) returns recent unlocks.
- [`GetUserCompletionProgress`](https://api-docs.retroachievements.org/v1/get-user-completion-progress.html) supports progress across the account's game catalog; [`GetUserSummary`](https://api-docs.retroachievements.org/v1/get-user-summary.html) exposes summary/recent-game fields.

I found no webhook, subscription, or WebSocket push feed in the published Web API reference. Treat these as polling snapshots: use a stored watermark with a small overlap window, deduplicate by provider achievement/game/account identity, backfill gaps, and show “RetroAchievements checked … ago.” Respect the site's rate guidance: [the official getting-started docs](https://api-docs.retroachievements.org/getting-started.html) request reasonable use/caching and do not state a stable numeric limit in the reviewed text. Do not market this path as real-time presence.

### Emulator-local events are a separate, optional path

RetroAchievements documents integration across [RetroArch and other supported emulators](https://docs.retroachievements.org/general/emulator-support-and-issues.html), but support varies by emulator, core, game hash, and version. The official [RetroArch integration source](https://github.com/libretro/RetroArch/blob/master/cheevos/cheevos.c) and [rcheevos library](https://github.com/RetroAchievements/rcheevos) expose callbacks for events such as achievement triggered and game completed when that integration is active. This provides a possible later desktop companion path with lower-latency local events. It is not a universal app-side hook and cannot be assumed to work with every Android or desktop emulator.

Even within an integrated emulator, events mean only what the set explicitly represents. Achievement logic is tied to supported game memory and game-specific conditions, as described in the official [achievement development overview](https://docs.retroachievements.org/developer-docs/getting-started-as-an-achievement-developer.html). Do not infer a generic ROM launch, session start/end, boss defeat, story completion, or “100%” from a title appearing in a library or from playtime alone. A manual session/milestone action remains the universal fallback.

Model an emulated release with distinct Ludex work, platform/system, edition or ROM-hash identity, and source achievement set. RetroAchievements `GameID`/console/hash identity is not interchangeable with a Steam/Xbox achievement set or a commercial remaster. Keep provider achievements and user-declared story completion separate. Ludex needs only title/platform/edition metadata for its library; it does not need users to upload ROM files.

The RA standalone [Connect integration guide](https://api-docs.retroachievements.org/connect/standalone.html) describes a distinct emulator integration and its token handling. Treat this separately from the ordinary Web API read connector; integration authentication and permitted production use need their own validation before Ludex adopts it. An internal library callback likewise does not establish an externally accessible emulator subscription.

## Beta scope under the current constraints

For a free Android-first beta of roughly 100 invited accounts and 10–20 simultaneous users, with an approximately US$10/month Azure target, use local CSV parsing, a small backend import job, structured/provider-ID matching, and a manual review queue. Avoid per-row AI requests, dedicated vector search for imported files, always-on emulator polling, and storage of full provider payloads that are not needed for correction. Meter any AI-assisted ambiguous-match suggestions and offer search/manual resolution when the quota is reached. The import layer can run asynchronously while a cinematic progress/feed showcase remains responsive.

Suggested order:

1. Ludex-owned CSV template and Letterboxd archive/CSV import with preview, provenance, reversible batch, quiet historical backfill, and uncertain-match queue.
2. Trakt account migration only after app access, OAuth, policy retention, rate limits and deletion behavior are verified.
3. Netflix CSV and IMDb CSV as optional one-time paths where their documented files can be matched safely; never label either as live sync.
4. MyAnimeList/AniList imports if pilot research confirms anime demand and identity mapping coverage.
5. RetroAchievements history polling after key handling, API terms, and tested endpoint responses are reviewed. Add an emulator companion only after a narrowly scoped supported-emulator pilot proves local event delivery and reconnect behavior.

In all cases, show provider provenance and freshness, keep imported history private, and ask separately before publishing future activity. These safeguards make the social feed trustworthy even when catalog imports are incomplete or emulator telemetry is unavailable.

## Source and validation boundaries

All provider capabilities above are limited to the cited first-party product pages, official API references, provider-maintained documentation/source, or provider-maintained policy/forum pages. The report did not exercise OAuth, inspect a real export ZIP, authenticate to provider APIs, test any emulator callback, measure rate limits, or confirm commercial/production permission. Exact export columns for Letterboxd/IMDb and any unlisted service require a current sample-based parser test before release. RetroAchievements production access and the viability of its credential model are unresolved for Ludex.
