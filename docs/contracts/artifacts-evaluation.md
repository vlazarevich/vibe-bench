# Artifacts and evaluation boundaries

Status: configured result viewing is implemented by `artifact-viewer.ts` and its HTTP and browser tests. The [blind-grading contract](blind-grading.md) defines implemented configured-run judgments and anonymous result access.

## Collection and publication

An artifact entry identifies its kind, result or diagnostic role, media type, byte count, digest, and safe relative path. A manifest groups verified objects for one attempt. Storage keys remain private.

Expected output declarations belong to the immutable task snapshot. Validate collected files against those declarations. Preserve partial output as diagnostics when required results are missing.

Stage uploads before publishing them. Verify actual bytes, size, and digest; do not treat a client declaration or storage ETag as proof. Publish manifest references and the terminal outcome in one transaction. Replayed completion returns its receipt.

Local files and hosted object storage obey the same publication contract. Garbage collection removes only expired objects that no accepted manifest references.

## Viewer boundaries

Escape text and code, and sanitize rendered Markdown. Validate download media types and filenames. Unknown formats require an explicit unsupported-viewer state.

An HTML bundle declares its entry page and local assets. A bundle is not authorization to start an application server.

Run active HTML in server-owned Chromium inside Bubblewrap user, PID, mount, and network namespaces. Mount only browser/runtime libraries and fonts read-only, with private temporary storage, `/proc`, and minimal devices. Pass a fixed environment without application secrets. Never mount the workspace or user home. Missing isolation fails closed.

The dashboard receives PNG frames and sends validated click, text, key, scroll, or refresh actions. It receives no executable submitted HTML. The browser uses a synthetic origin and can load only exact manifest assets through intercepted requests. CSP and request/WebSocket interception reinforce the network namespace. Host loopback, dashboard cookies, parent state, and host files are inaccessible. Each action has a deadline and backpressure. Preview capacity is reserved before launch, limited to two sessions, and released on failure, idle expiry, explicit close, or shutdown. A two-minute browser lifetime bounds a busy script.

Treat SVG and other active media according to the same isolation boundary. Never infer safe rendering solely from a file extension.

## Blind response construction

Construct evaluator responses from an explicit schema. Exclude model/harness identity, management IDs, settings, diagnostics, telemetry, original filenames, and storage paths where those reveal identity.

Use opaque session-scoped result handles and neutral download names. Apply the same boundary to nested assets, error responses, headers, and URLs. Do not send management records to the browser and rely on UI hiding.

Artifact content itself can identify its author. Preserve the submitted result; do not rewrite it to manufacture anonymity.

Source-tree paths in code results are submitted content, also present in the preserved patch. The code viewer retains those paths. Neutral download labels hide artifact metadata names, not names written into source code or patches.

## Sessions and judgments

Persist each session's presentation mapping and order. Resolve card-to-attempt identity on the server. Reloading a session must not reshuffle its cards or silently add newly produced results.

Validate session authority on every read and write. A card or session ID alone is not authority. Store resume capabilities as hashes and keep secrets out of URLs, logs, referrers, and artifact requests.

Save the original selection and criterion snapshot with each judgment. Use optimistic concurrency for edits. Keep skipped and ungraded judgments distinct from numeric zero.

Attempt inclusion, reveal timing, allowed edits, and aggregate formulas are product policy supplied by the current task. Keep those decisions out of storage adapters and execution code. Explicitly separate any demonstration-only evaluation behavior from persisted production judgments.

## Configured result presentation

`ResultPresentation` is a strict discriminated schema. The reusable viewer consumes supplied same-origin URLs and constructs no management identifiers. The server selects primary result references and declared outputs. It omits diagnostics and uses neutral download labels when requested by the caller. Session authorization and session-scoped URLs remain the caller's responsibility.

Text uses the complete UTF-8 `answer.txt` when present and supplies its original-byte download through the same authorized URL adapter. Older outcomes without an answer artifact use the summary and a null download. Invalid UTF-8 and binary files show an unsupported message and retain their downloads. Code displays a changed-file tree, saved final bytes, and the unified patch. Unchanged repository files and original input images are not captured. Images and WebM recordings require supported byte signatures and successful isolated browser decoding before a typed media route serves them. Media validation runs serially. HTML source and other declared HTML outputs render as escaped text.
