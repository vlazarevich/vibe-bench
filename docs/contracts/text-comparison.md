# Text comparison protocol

The executable schemas are [runner.ts](../../packages/contracts/src/runner.ts) and [evaluation.ts](../../packages/contracts/src/evaluation.ts). This document describes their current behavior. Broader runner and artifact contracts remain design guidance for operations not implemented here.

Persisted text must contain valid Unicode and cannot contain U+0000. Invalid text is rejected before database writes. Valid text is stored without rewriting.

## Runner report

Legacy protocol version 1 contains an immutable task title and prompt, creation time, source `fixture` or `live`, stable report and run UUIDs, and exactly two entrants. Each entrant has a distinct attempt UUID and exact model ID, an executable version, and either completed text or a failure reason. The two allowed models are `gpt-6-luna` and `gpt-6-sol`, and they must differ.

New runs use protocol version 2 with an immutable snapshot of the task, evaluation configuration, requested models and execution settings. Suite runs also copy the full exact saved suite content. [Suite authoring](suites.md) describes the snapshot and provenance checks. Protocol-1 reports remain readable and replayable.

`POST /api/runner/reports` requires the runner bearer token. The server validates the schema before calculating a digest of the schema-parsed payload. The report row and its unique identity form one atomic receipt. An identical replay returns the original accepted identity; changed content or reuse of a run ID conflicts. Failed entrants remain saved and cannot produce an evaluation session.

The runner flushes progress before execution and saves its aggregate report before upload. Receipt loss can cause redelivery, not another model invocation. `report:retry` skips accepted entries, delivers complete reports, and counts incomplete directories as uncertain. It never resumes or relaunches uncertain attempts. A new execution always creates new run and attempt IDs.

## Evaluation

`GET /api/runs` returns only a public review UUID, title, timestamp, source and readiness. `POST /api/evaluations` accepts that review UUID and creates a random card mapping. The server stores a hash of browser cookie authority, not the authority itself. Reopening a run with that cookie returns its existing session.

`GET /api/evaluations/:id` requires the cookie. A blind response contains only the session UUID, task, source, and two session-scoped handles with submitted text. It contains no model ID, attempt ID, execution run ID, report ID, executable version, diagnostics, or storage paths. Run summaries, error responses and headers follow the same boundary. Submitted text itself can identify its author and is preserved without rewriting.

`POST /api/evaluations/:id/choice` accepts one handle from the authorized session. A row lock serializes concurrent choices. The server stores the original criterion, selected handle and selection time. Only the committed selection allows a revealed response with model IDs and executable versions. Repeating that selection succeeds. A different selection conflicts. There are no vote edits, ties, skips, or aggregate scores in this loop.

The browser renders plain text. React escaping and a restrictive content security policy block active markup. The server binds to loopback, checks the Host header and Origin for unsafe browser methods, and uses an HTTP-only SameSite=Strict cookie. This authority is local and is not a hosted identity system.
