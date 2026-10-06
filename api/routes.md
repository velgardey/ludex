# Go beta runtime route inventory

All routes use `/api`; `/api/v1` is a compatibility alias. Private routes accept app-owned bearer sessions (Android/extension) or HttpOnly cookies (web). Cookie mutations require an allowed Origin. Error bodies include `code` and `message`; progress commands return accepted/conflict/rejected receipts. This inventory and `openapi.yaml` are documentation, not generated SDK proof.

| Area | Routes |
| --- | --- |
| Readiness/catalog | GET `/health`, `/auth/config`, `/catalog/search?text=&media=&region=`, `/catalog/title?id=` |
| Identity | POST `/auth/google/start` form, GET `/auth/google/callback`, POST `/auth/google/native/start`, `/auth/google/native/exchange`, GET `/auth/me`, POST `/auth/logout`; development-only signup/login |
| Journal | GET `/library`, POST `/library/edit`, `/progress`, `/progress/correct` |
| Social | GET `/feed`, `/activity`, `/social/users`, `/social/status`; POST `/social/follow`, `/social/friendship`, `/social/block`, `/social/react`, `/social/report` |
| Reviews/discussion | review draft/publish/edit routes; `/social/reply`, `/social/replies`, `/social/reply/edit` |
| Curation | GET/POST `/showcase`, `/collection`; GET `/collections` |
| Preferences/data | GET/POST `/account/settings`, POST `/account/export`, GET `/account/download?id=`, POST `/account/delete` |
| Companion | GET `/assistant/state`, POST `/assistant/messages` `{text,requestId}`, POST `/assistant/actions/{id}/confirm` or `/reject`, POST `/assistant/reset` |
| Imports | POST `/imports/preview` `{source,csv}`, GET `/imports`, POST `/imports/{id}/rows/{rowId}/match`, POST `/imports/{id}/commit`; returned `pollUrl` identifies owner-scoped job status |
| Capture/Steam pilot | GET `/connections`, GET `/connections/observations`, POST `/connections/capture`, `/connections/observations/{id}/confirm`, `/connections/steam/preview` |
| Plans | GET/POST `/plans`; GET `/plans/{id}`; POST `/{id}/shortlist`, `/{id}/rsvp`; GET/POST `/{id}/discussion` |
| Inbox | GET `/notifications` returns private persisted invitations |

Progress writes require stable command IDs, base version, title/change, audience, spoiler and observed date/time. Import and capture writes are private and confirmed. An imported show without episode identity must not invent per-episode history. Background import commit is durable and executed with `ludex work`; scale-to-zero API does not act as a scheduler.

Cloud AI requires operator configuration and per-user context consent. Conversation reset deletes messages/proposals/embedding cache but preserves spending ledgers. Source citations are restricted to retrieved permitted records. Do not infer actual Azure runtime verification from fixtures.
