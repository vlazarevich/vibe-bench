# Domain design

Status: design guidance, not an executable schema. When implementing a feature, make its schemas and tests authoritative and keep this document focused on invariants and rationale.

## Immutable execution inputs

Separate the user-visible suite revision from stored content versions. An edit can append a content version without changing the revision label. Run creation copies the selected content, evaluation configuration, entrants, and settings into an immutable snapshot.

Bind run creation to the exact previewed content version. Do not recompute from a newer mutable definition during submission. Use optimistic concurrency for suite edits.

Store a schema version and canonical content digest with the snapshot. Enforce immutability in persistence as well as types. A TypeScript `readonly` field alone does not protect historical records.

Keep requested repository refs in the snapshot and accepted exact commits in a separate write-once materials binding. The runtime resolves the commit before repository-backed execution. A competing resolution must use the already accepted binding or fail. Tasks without repository materials do not require a dummy checkout.

## Attempts and ownership

Group attempts by a stable run/task/entrant slot. Every actual re-execution has a new attempt ID and ancestry to its predecessor. An assignment records execution authority separately from immutable task configuration.

Represent lifecycle states as discriminated unions. Queued, running, collecting, and terminal variants carry only the fields valid for that state. An assignment reserved before launch is not evidence that a subprocess is running.

Accepted terminal outcomes are immutable. Retry must not move an old terminal attempt back to queued. Operational progress counts and outcome states do not imply a quality score.

## Transaction boundaries

Run creation atomically writes the snapshot, selected slots, initial attempts, and command receipt. Outcome acceptance atomically writes the terminal result, published manifest references, and receipt.

Enforce uniqueness for:

- Run/task/entrant slots and attempt ordinals within a slot.
- Accepted terminal outcomes and active assignments per attempt.
- Command receipts within their scope, including the submitted payload digest.
- Materials bindings per run.
- Session/attempt presentation mappings and current card/criterion judgments.

Foreign keys and transaction checks must establish run/task membership, not merely valid identifier shapes. Define a consistent lock order for operations sharing runtime, run, attempt, and assignment rows.

Use distinct identifier types, UTC instants, and monotonic local durations. Avoid elapsed-time calculations across unsynchronized machine clocks.

## Result and judgment representation

Task inputs and expected output declarations are separate from artifact kinds. An image-understanding task can produce text; a coding task can produce a patch and an explanation. Validate required outputs against the saved declaration.

Store requested entrant settings separately from observed executable/model metadata. Never silently substitute a model or ignore an unsupported setting.

Keep the original human selection and immutable criterion configuration beside any derived grade. Model ungraded, skipped, and graded judgments separately. Do not encode absence as zero.

Keep individual judgments separate from aggregate policy. Version any implemented conversion or aggregation rules and test them against the current task's examples. Do not introduce a default ranking, retry-selection, or reveal policy merely to complete an execution feature.

Telemetry carries units, provenance, and source evidence. Distinguish reported, estimated, and unavailable values. Currency amounts use decimal strings and explicit currencies; estimates identify their method and inputs.

## Feature operations

Feature operations own business rules and transactions. HTTP handlers own transport parsing, status codes, and response schemas. Keep Fastify objects and Drizzle rows out of cross-feature interfaces.

Prefer operations such as save suite, create run, claim work, accept outcome, publish artifacts, and save judgment. Each operation should hide the persistence coordination required to complete it.
