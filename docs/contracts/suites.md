# Suite authoring contract

The executable definitions are in [suites.ts](../../packages/contracts/src/suites.ts). Suite content contains categories, tasks, prompts, reusable criteria, task criterion assignments, optional written ranking rules, and materials configuration. Task kinds and rating controls come from those schemas.

Persisted text must contain valid Unicode and cannot contain U+0000. Invalid text is rejected before database writes. Valid text is stored without rewriting.

## Drafts and validation

Empty strings and collections represent incomplete drafts. `assessDefinition` returns field paths and actionable messages for missing titles, prompts, criteria, assignments, guidance, or repository settings. Empty ranking rules mean no rules are configured. An existing rule needs a title and written guidance before the suite is ready.

Invalid IDs, duplicate IDs, missing criterion references, repeated assignments, unknown variants, oversized fields, and invalid repository URLs are malformed requests. Definitions have a 500,000-byte JSON limit in UTF-8. Repository URLs support HTTP, HTTPS, and SSH. Embedded passwords and usernames are rejected, except the `git` SSH username. Materials configuration stores the requested ref without contacting or checking out the repository.

## Content and revisions

Creation establishes revision 1 and content ordinal 1. Every edit supplies an exact `expectedContentId` and an explicit `minor` or `revision` choice. A minor save replaces the current revision in the editor, revision picker, and History. A revision save increments the revision label. Internal immutable snapshots still append the complete definition with a new content ID and ordinal for exact-base concurrency and pinned execution inputs; these internal content numbers are not shown in the dashboard. Even unchanged content can be saved with the chosen revision behavior.

A suite row points to its current content. A transaction locks that row, rejects stale content IDs with HTTP 409, inserts the immutable content, and moves the pointer. Concurrent edits from one base produce one success and one conflict. The editor retains local changes after a conflict until the author explicitly reloads.

Content stores a schema version and SHA-256 digest of canonical JSON containing the schema version and definition. Canonicalization sorts object keys and preserves array order. PostgreSQL rejects updates and deletes on suite content and configured execution records. A composite foreign key prevents a suite from pointing at another suite's content. Ordered migrations use a transaction lock and migration ledger. Existing databases safely apply the idempotent initial schema before the suite migration.

## Rating controls and ranking guidance

The `rating-control-v1` conversion maps integer stars 1 through 5 to 20, 40, 60, 80, and 100. Integer slider values 0 through 100 map directly to that grade. Legacy slider-10 values map to ten times the selection. Thumbs down maps to 0 and thumbs up to 100. The absence of a selection is ungraded.

The editor previews each conversion. Ranking rules remain API-only written guidance; the editor does not expose them. There is no aggregation formula or persisted rubric judgment in this feature.

## HTTP operations

| Operation | Response |
| --- | --- |
| `GET /api/suites` | Current title, suite ID, revision, ordinal, category/task counts and latest run |
| `POST /api/suites` | New content and readiness from `{ definition }` |
| `GET /api/suites/:id` | Current content and readiness |
| `POST /api/suites/:id` | Appended content and readiness from `{ expectedContentId, change, definition }` |
| `GET /api/suites/:id/history` | Latest saved definition per revision, newest revision first |
| `GET /api/suites/:id/contents/:contentId` | Exact saved content belonging to that suite |

Malformed requests return 400 with field issues. Unknown suites or versions return 404. Every authoring mutation requires the local Host and matching Origin. This is the existing local application boundary, without hosted user accounts.

## Pinned execution

Configured Runs select an exact saved content version and one or more tasks. The server stores the complete suite definition, evaluation configuration, selected task IDs, entrants, and a canonical digest before issuing assignments. Later suite edits cannot alter that snapshot. The runner executes dashboard assignments without task export files or runner-specific environment configuration. See [configured runs](configured-runs.md).

## Designed authoring interface

Suites use a master-detail table with revision, category/task counts and latest run. Info, Criteria and Tasks tabs share minor/new-revision saves and conflict recovery. Criteria support five stars, a 0–100 slider and thumbs; legacy 0–10 sliders remain readable. Category/task trees and criterion chips preserve immutable IDs. Optional task paths must be contained relative directories and require a Sources repository. Deletions and discarded drafts require confirmation; History exposes one latest entry per revision. Opening Tasks selects the first task; Last run links to the matching Runs entry.
