# Suite authoring contract

The executable definitions are in [suites.ts](../../packages/contracts/src/suites.ts). Suite content contains categories, tasks, prompts, reusable criteria, task criterion assignments, optional written ranking rules, and materials configuration. Task kinds and rating controls come from those schemas.

## Drafts and validation

Empty strings and collections represent incomplete drafts. `assessDefinition` returns field paths and actionable messages for missing titles, prompts, criteria, assignments, guidance, or repository settings. Empty ranking rules mean no rules are configured. An existing rule needs a title and written guidance before the suite is ready.

Invalid IDs, duplicate IDs, missing criterion references, repeated assignments, unknown variants, oversized fields, and invalid repository URLs are malformed requests. Definitions have a 500,000-byte JSON limit in UTF-8. Repository URLs support HTTP, HTTPS, and SSH. Embedded passwords and usernames are rejected, except the `git` SSH username. Materials configuration stores the requested ref without contacting or checking out the repository.

## Content and revisions

Creation establishes revision 1 and content ordinal 1. Every edit supplies an exact `expectedContentId` and an explicit `minor` or `revision` choice. A minor save preserves the revision label. A revision save increments it. Both append the complete definition with a new content ID and ordinal. Even unchanged content can be saved with the chosen revision behavior.

A suite row points to its current content. A transaction locks that row, rejects stale content IDs with HTTP 409, inserts the immutable content, and moves the pointer. Concurrent edits from one base produce one success and one conflict. The editor retains local changes after a conflict until the author explicitly reloads.

Content stores a schema version and SHA-256 digest of canonical JSON containing the schema version and definition. Canonicalization sorts object keys and preserves array order. PostgreSQL rejects updates and deletes on content and accepted run rows. A composite foreign key prevents a suite from pointing at another suite's content. Ordered migrations use a transaction lock and migration ledger. Existing databases safely apply the idempotent initial schema before the suite migration.

## Rating controls and ranking guidance

The `rating-control-v1` conversion maps integer stars 1 through 5 to 20, 40, 60, 80, and 100. Integer slider values 0 through 10 map to ten times the selected value. Thumbs down maps to 0 and thumbs up to 100. The absence of a selection is ungraded.

The editor previews each conversion. Ranking rules are written guidance only. There is no aggregation formula or persisted rubric judgment in this feature. The existing comparison still asks which answer is better and saves one final choice.

## HTTP operations

| Operation | Response |
| --- | --- |
| `GET /api/suites` | Current title, suite ID, revision and ordinal for each suite |
| `POST /api/suites` | New content and readiness from `{ definition }` |
| `GET /api/suites/:id` | Current content and readiness |
| `POST /api/suites/:id` | Appended content and readiness from `{ expectedContentId, change, definition }` |
| `GET /api/suites/:id/history` | Immutable contents, newest first |
| `GET /api/suites/:id/contents/:contentId` | Exact saved content belonging to that suite |

Malformed requests return 400 with field issues. Unknown suites or versions return 404. Every authoring mutation requires the local Host and matching Origin. This is the existing local application boundary, without hosted user accounts.

## Pinned execution

The editor exports a selected saved task as `{ content, taskId }`. Exports are disabled while local edits differ from the saved content. The runner reads that file through `VIBE_SUITE_FILE`. It accepts only a ready suite's text-generation task without repository materials. Unsupported input fails before any execution directory or subprocess is created.

New protocol-2 progress and reports include an execution snapshot. A suite snapshot copies the full saved definition, evaluation configuration, suite identity, exact content identity, selected task, model pair, timeout, sandbox, and adapter version. Ad-hoc runs snapshot their task and existing pairwise evaluation criterion. The runner saves the snapshot before its first subprocess and constructs execution from that saved input. Reports must match the snapshotted task and models.

Ingestion verifies digests, task membership and exact saved suite provenance. It compares the embedded content to the identified historical record, never the current pointer. Later edits cannot change a prior run. Protocol-1 reports and spool files remain readable and replayable. Blind evaluation responses remain explicit projections and omit snapshot and model metadata.
