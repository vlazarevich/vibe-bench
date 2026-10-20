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

Run active HTML in the viewer's browser, never on the server. Opening a preview requires the caller's dashboard or grading authority and issues a capability: a random 256-bit token whose SHA-256 hash is stored with the attempt and a 30-minute expiry. `/preview/:token/<path>` serves only the entry page and declared assets of that HTML result, matched after URL normalization; diagnostics, other attempts, and unlisted paths return 404. The token is the only authority because sandboxed frames send no cookies. An issued link remains valid until it expires, including after logout, and exposes only that bundle.

Every preview response carries `Content-Security-Policy: sandbox allow-scripts allow-forms`, so the document has an opaque origin even when opened directly. Scripts can run but cannot read dashboard cookies, storage, or the parent page. The same policy allows scripts, styles, images, media, and fonts only from the grant's own path (plus inline code and `data:`/`blob:` media), and sets `connect-src`, `frame-src`, `worker-src`, and `form-action` to `'none'`. `frame-ancestors` admits only the dashboard origin. The dashboard frames previews with `sandbox="allow-scripts allow-forms"`; without `allow-popups` or `allow-top-navigation` the page cannot open windows or navigate the dashboard, and the dashboard's `frame-src` limits the frame itself to `/preview/` URLs. Responses allow any origin to read them so module scripts load from the opaque origin; the token already grants that access. Residual channels outside CSP, such as WebRTC, are not blocked; a preview can only reveal that someone viewed it.

Viewports are desktop (1280×800), tablet (768×900), and mobile (390×844), scaled to fit the dashboard. Interaction is native to the frame.

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

Text uses the complete UTF-8 `answer.txt` when present and supplies its original-byte download through the same authorized URL adapter. Older outcomes without an answer artifact use the summary and a null download. Invalid UTF-8 and binary files show an unsupported message and retain their downloads. Code displays a changed-file tree, saved final bytes, and the unified patch. Unchanged repository files and original input images are not captured. Images require a PNG, JPEG, or WebP header with nonzero dimensions totaling at most 40,000,000 pixels; WebM recordings require an EBML header naming the `webm` DocType. The server reads headers only and never decodes media. Typed media routes serve inline with `nosniff` and a `sandbox` policy. The viewer's browser decodes; a decoding failure shows the unsupported message and keeps the download. HTML source and other declared HTML outputs render as escaped text.

## Designed viewers and runtime metadata

The shared viewer renders original inputs where captured, text and source diffs, raster outputs, changed files with observed verification-command counts, browser action replay with screenshots plus full video/trace, and sandboxed HTML. Replay thumbnails are optional and bounded.
