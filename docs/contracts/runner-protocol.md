# Runner protocol and process ownership

The implemented CLI is `vibe-runner`. Executable schemas live in `runtime.ts`, `access.ts`, `configured-runs.ts`, and `work.ts`. Scheduling leases and ownership generations remain design guidance. Work protocol 2 implements whole-run claims, immutable reports, chunked artifact delivery and heartbeat cancellation. Claims, preparation and attempt reports, and artifact chunks carry `protocol: 2`; any other declared version receives HTTP 426 with an instruction to update `vibe-runner`, so an outdated runner never claims work it cannot report. Runtime registrations keep their own protocol 1 schema.

## Connection and authority

The runner initiates every request. It opens no inbound listener. Poll and heartbeat responses carry work or control instructions; the browser never connects to a runner.

Version the wire protocol. A work envelope identifies its immutable input snapshot, attempt, assignment, ownership generation, deadline, and materials binding. Reject incompatible versions explicitly.

Runtime and assignment IDs identify records; credentials authorize operations. Harness login stays on the execution machine. Never send server secrets to task workspaces.

## Duplicate delivery and publication

Use at-least-once transport and at-most-once acceptance of terminal outcomes. Do not promise exactly-once external model execution.

Write reports and stable report IDs to the runner's durable spool before transmission. Flush temporary files and atomically rename them. Remove an entry only after a durable receipt.

The server stores a command receipt and payload digest in the same transaction as its effect. Repeating the ID and digest returns the existing receipt; changed content under the same ID conflicts. An authenticated replay may retrieve its accepted receipt without reapplying a stale mutation.

Every worker request body stays under 4,100,000 bytes (`WORK_BODY_LIMIT`) so a serverless deployment can accept it. Artifact bytes therefore travel separately from the terminal report as `ArtifactChunk` requests. Each chunk names its runtime, assignment, run, attempt, and artifact; offsets are multiples of `ARTIFACT_CHUNK_BYTES` (3,000,000), and only the final chunk of an artifact may be shorter. Empty artifacts send no chunks. The server stages chunks in `artifact_chunks` under the runtime lock. An identical chunk replay returns the same receipt, both while staged and after the terminal report moved the bytes into immutable storage; different bytes at the same artifact offset conflict. Staging per attempt is bounded by the 8,000,000-byte and 32-artifact limits.

The terminal report lists artifact metadata in its outcome and carries no bytes. Acceptance assembles each listed artifact from contiguous chunks, verifies size and SHA-256, applies the existing result checks, stores the artifacts and outcome atomically, and discards the attempt's staging rows. Slices for artifacts the outcome does not list are ignored and discarded. Abandonment and cancellation discard staged chunks for unfinished attempts. The runner spool keeps artifact bytes inside its saved terminal entry; recovery resends every chunk, then the report. A saved claim request from an older protocol cannot be replayed, so the runner replaces it with a fresh protocol-2 request. Saved reports from an older protocol are not converted.

Sequence reports per assignment. Publish a terminal outcome only when referenced objects are verified and declared required outputs exist. A lost response after commit must not produce another result.

## Claims and recovery

Reserve an assignment before launch. Repeating a claim request retrieves its assignment. Execution exclusively owns its state directory and reconciles outstanding assignments after restart. Capability status and probing use separate state ownership and remain available. Attempts execute sequentially.

Do not relaunch uncertain work under its old attempt ID. If automatic recovery is absent, expose the uncertainty rather than implying that recovery succeeded.

Claims reserve one whole run transactionally. Dashboard disconnection preserves the assignment and local journal. Revoking or replacing a credential abandons unfinished assigned runs and prevents further reports.

Re-execution creates a new attempt and preserves prior diagnostics. There is no lease-expiry behavior that stops assigned work when the API is unavailable.

Cancellation atomically records intent, abandons unfinished server work, retires the claim and preserves previously accepted outcomes. The dashboard’s Cancelled state means server acceptance has stopped; it does not certify termination on a disconnected machine. Authenticated heartbeats every two seconds convey the stop request. The runner aborts its current process group or browser context, persists an idempotent cancellation marker and retires the local assignment. A disconnected runner receives the stop request when connectivity returns; API unavailability alone does not abort it.

## Execution boundary

Adapters translate prepared inputs into executable arguments and parse output. They do not upload results or write database records. The process module owns subprocess lifetime, deadlines, and cancellation.

Invoke executables with argument arrays and a controlled environment. Never interpolate prompts, repository refs, or model settings into shell strings.

Linux process groups need real descendant-process tests. A parent-only kill or an AbortSignal is not sufficient evidence. Keep any required native helper within the process module and document its build and verification.

Stop and reap the process tree before terminal reporting. Preserve diagnostics when execution, cancellation, or collection fails. Keep final model output separate from diagnostic logs.

## Workspace and resource ownership

Each attempt owns its checkout, output directory, temporary directory, and browser profile. Writable workspaces and harness credentials are never shared. A Git object cache may be shared with safe fetch coordination.

Resolve paths beneath assigned roots. Reject traversal, absolute collection paths, and symlinks that escape the root. Collect declared untracked files while excluding credentials and Git internals.

Configure finite wall-time, output, log, and disk limits. Cleanup may remove only owned directories whose retention and publication state permit deletion.

## Adapter compatibility

Record executable version, requested settings, observed model metadata where available, and sanitized raw output. Parser fixtures cover completion, malformed output, unavailable access, timeouts, cancellation, and missing results.

Check installed CLI behavior and official documentation when changing an adapter. Fixture evidence proves behavior for captured shapes. Actual harness/model access requires a separate live check.

## Implemented pairing and capabilities

The CLI exposes `pair TOKEN`, `pair status`, `pair probe`, `pair revoke`, `run`, and `run-once`. Global `--state-dir` and command help work for source checkouts and the standalone executable. Source checkouts report `development`; standalone builds embed their release version. Pairing succeeds after an acknowledged capability report. Single-use 15-minute enrollment tokens retain one server-issued identity. A private durable exchange enables exact lost-response retries. Failed pairing keeps only that exchange until retry or replacement. Revocation attempts the remote operation, then clears local state and reports whether dashboard abandonment was confirmed.

Protocol-1 observations contain hostname, OS, machine facts, installed tool versions and explicit harness authentication readiness. Known account types are reported without account identifiers. Codex app-server model/list supplies model IDs and input modalities; OpenCode Go supplies model IDs through its models command. Unsupported discovery stays unknown. They contain no slots or capacity field. Readiness does not prove model entitlement. Discovery and execution select the same executable from `PATH`. A run retains its acknowledged executable paths for every attempt and recovery. A concurrent probe changes the selection for subsequent runs. A tool installed after discovery remains unavailable until a new observation is acknowledged.

A stable runtime UUID and monotonic observation sequence identify each immutable registration. Identical replay returns its saved receipt; conflicting content under the same sequence returns 409. Late observations cannot replace newer observations. Pairing recovers the dashboard sequence floor after local state erasure. Cached status never rescans. Failed probe delivery never replaces the last acknowledged snapshot.

The optional worker listener accepts only worker requests and rejects browser requests. Individual runtime credentials authorize both listeners. [Configured runs](configured-runs.md) defines sequential claiming, interruption recovery, preparation, and result delivery. `run-once` waits for one assignment and all its acknowledgements, including when the queue starts empty.
