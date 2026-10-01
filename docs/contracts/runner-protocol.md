# Runner protocol and process ownership

Status: design guidance. Implement only the operations required by the current task and document supported protocol behavior beside its executable schemas.

## Connection and authority

The runner initiates every request. It opens no inbound listener. Poll and heartbeat responses carry work or control instructions; the browser never connects to a runner.

Version the wire protocol. A work envelope identifies its immutable input snapshot, attempt, assignment, ownership generation, deadline, and materials binding. Reject incompatible versions explicitly.

Runtime and assignment IDs identify records; credentials authorize operations. Harness login stays on the execution machine. Never send server secrets to task workspaces.

## Duplicate delivery and publication

Use at-least-once transport and at-most-once acceptance of terminal outcomes. Do not promise exactly-once external model execution.

Write reports and stable report IDs to the runner's durable spool before transmission. Flush temporary files and atomically rename them. Remove an entry only after a durable receipt.

The server stores a command receipt and payload digest in the same transaction as its effect. Repeating the ID and digest returns the existing receipt; changed content under the same ID conflicts. An authenticated replay may retrieve its accepted receipt without reapplying a stale mutation.

Sequence reports per assignment. Publish a terminal outcome only when referenced objects are verified and declared required outputs exist. A lost response after commit must not produce another result.

## Claims and recovery

Reserve an assignment before launch. Repeating a claim request retrieves its assignment. A runner exclusively owns its state directory and reconciles outstanding assignments after restart. Count reservations as well as active processes against capacity.

Do not relaunch uncertain work under its old attempt ID. If automatic recovery is absent, expose the uncertainty rather than implying that recovery succeeded.

When implementing lease-based recovery, the server owns expiry decisions. Claims reserve capacity transactionally. Heartbeats, report acceptance, upload staging, and publication all check the active generation and lease. Expired owners cannot publish results.

Re-execution creates a new attempt and preserves prior diagnostics. A worker that cannot renew stops its process tree before its local lease safety deadline. Use monotonic time and renewal margins for that local deadline.

Cancellation records intent and prevents new claims before signalling workers. Confirm a terminal cancellation only after process-tree termination is known. A disconnected worker remains cancellation-pending or receives a lost-worker outcome; do not claim a confirmed kill. Preserve completion already accepted before cancellation.

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

## Implemented onboarding

Protocol-1 `RuntimeRegistration` in `packages/contracts/src/runtime.ts` is supported independently of job scheduling. `POST /api/worker/registrations` accepts machine facts, declared slots, tool availability, and explicit harness readiness. `GET /api/runtimes` is local inspection only. Authentication readiness does not establish model entitlement. Models remain provider-discovered at execution.

A stable runtime UUID and durable monotonic observation sequence identify each immutable registration. Replaying identical content returns the original server receipt; conflicting content under the same identity and sequence returns 409. Late observations retain their receipts without replacing a newer sequence in the inspection view. The runtime retains an undelivered observation and retries it before creating another. Its state directory has one kernel-enforced owner.

The optional worker listener admits registration and configured-run work requests and rejects browser requests. Its remote HTTPS termination and network restriction are deployment responsibilities. Worker authentication, a capability corpus, leases, and heartbeats remain deferred. [Configured runs](configured-runs.md) define implemented claiming, preparation, execution, and result delivery. The existing bearer-authenticated text report endpoint and text runner behavior are unchanged.
