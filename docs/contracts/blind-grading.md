# Configured-run blind grading

Status: implemented, including independent named sessions, partial submission, read-only shared viewing and post-submit reveal. `packages/contracts/src/blind-grading.ts` defines the browser contract. `apps/server/src/features/blind-grading.ts` owns session mappings, judgments, and anonymous artifact access.

## Eligibility and presentation

Grading starts after every configured attempt has a terminal outcome, or after cancellation/abandonment with at least one accepted completed result. Stopped-run mappings omit attempts without accepted outcomes and tasks without completed results. A session includes only the tasks selected in the immutable execution snapshot. Categories and tasks retain their suite order. Every selected task presents every attempt, including execution failures and skips. Completed attempts have independently editable criterion judgments. Failed and execution-skipped attempts show a neutral unavailable state, without diagnostics or invented grades.

Each task shuffles its cards once when the session opens. Random card handles and presentation order persist across reloads and database restarts. A card handle does not identify the same entrant across tasks. The session never adds new attempts. Task navigation lives in the URL. Progress counts fully graded tasks: a task needs at least one graded cell and no ungraded or skipped cells. The overview also retains cell totals in the API. Task instructions are visible, management entry paths include Back to gradings, and the active workspace starts with a collapsed sidebar that can be expanded. Skip, Clear, and result downloads remain available.

The active blind grading workspace requests scoped navigation and one selected task, without runtime records or configured-run management DTOs. The management overview reads run context and its grading list before opening a session. The public run list contains a random review ID, suite title, fixture or live label, and readiness. It contains no execution identifiers or timing.

## Pinned criteria and selections

Every judgment belongs to one completed card and one criterion assigned to that task in the execution snapshot. The session stores the full criterion definition and `rating-control-v1` conversion with its immutable mapping. Its run foreign key preserves the original execution snapshot and accepted configuration request. Later suite edits do not change task instructions, criteria, controls, or saved associations.

A judgment is one of three states.

| State | Stored selection | Grade |
| --- | --- | --- |
| `ungraded` | Absent | Absent |
| `skipped` | Absent | Absent |
| `graded` | Original control and value | Derived by the server |

Stars accept integers 1 through 5 and produce 20, 40, 60, 80, or 100. New slider criteria accept integers 0 through 100 directly. Existing slider-10 criteria retain their 0–10 conversion to multiples of ten. Thumbs accept a boolean and produce 100 for true or 0 for false. A numeric zero is a grade. Skip and Clear are explicit actions, each with a version increment. Equal grades are valid. A client cannot submit a derived grade or use another criterion's control.

The UI autosaves deliberate selections; sliders commit a pointer drag on release and keyboard changes immediately. An untouched slider does not create a zero grade. Each editor disables additional writes while saving. A failed request offers an exact retry or a reload of saved judgments. A conflicting tab must reload before editing again. If a progress refresh fails after saving, the grade stays saved and a page-level alert lets the reviewer retry the progress read without another judgment write.

## Persistence and concurrency

Migration `005-blind-grading.sql` adds neutral review IDs, immutable `blind_grading_sessions`, and mutable `blind_grading_judgments`. The session mapping is JSON. Judgments are separate rows keyed by session, card, and criterion. An immutable SQL trigger protects each row's association, and the feature checks same-task membership before saving.

Session creation holds an advisory transaction lock for the run and capability hash. Migration 009 removes the old one-session-per-authority constraint. Each creation request ID opens one named grading; exact replay returns it, changed replay conflicts. One grader can create multiple independent sessions. The run row is locked before reading outcomes and abandonment, so the immutable mapping includes every result accepted before a concurrent stop. Mapping and initial ungraded cells commit together.

A save includes `expectedVersion`. The transaction takes a shared session lock and locks the target judgment row. Submission takes the exclusive session lock, freezes all current cells, and writes an immutable timestamp. A SQL trigger rejects later judgment changes. A matching version changes the value and increments the version once. An identical immediate replay using the preceding version returns the saved value. Any other stale request returns 409. Different judgments can save independently. A clear followed by an old graded retry cannot restore the old grade.

## Authority and anonymous output

A 256-bit capability in the `vibe_grading_authority` HttpOnly, SameSite=Strict cookie authorizes sessions. The database stores its SHA-256 hash. Creation refreshes the cookie's 30-day lifetime. Clearing or losing the cookie loses resume access. A session URL never conveys authority. A random review invitation grants permission to create a fresh session. The management overview lists submitted gradings; reading another submitted session requires a scoped read grant. Drafts remain private to their owner. Missing or foreign authority returns the same 404 for session, task, judgment, and artifact operations. Shared invitations and scoped sessions work without the app password; management overview and the run list remain gated. Canonical Host and same-origin mutation rules apply. HTTPS configuration uses Secure cookies. Responses use `Cache-Control: no-store`.

Explicit schemas construct public fields. Responses exclude model and harness identity, runtime and management IDs, settings, diagnostic reasons, observations, original filenames, hashes, and storage paths. Artifact media types come from an allowlist, with `application/octet-stream` for other declarations. Only artifact IDs referenced by the completed result descriptor enter the session's existing anonymous asset mapping. The rich viewer separately projects primary results and declared outputs after authorizing the mapped card. Stable file ordinals within each immutable outcome replace artifact IDs in its URLs. Diagnostics and unpublished files do not become viewer downloads. A diagnostic reference inside an accepted HTML asset list is omitted while the result remains gradeable.

The shared `ResultViewer` shows complete saved text, decoded images and WebM, changed code files and patches, and declared outputs. Code paths and source text remain submitted content, even when they identify the author. Metadata filenames stay neutral. HTML runs only in the isolated server browser described by the [artifact contract](artifacts-evaluation.md), and the dashboard receives PNG frames. Every preview action and close reauthorizes the session and card. Management and grading share the two-preview capacity. A task-scoped inputs read compares original input bytes, kinds, and media types across all completed cards. Identical inputs appear once above results; differing or missing inputs remain inside each result. Responses expose only neutral existing card-scoped file URLs, never content hashes or management IDs. If the shared read fails, per-result inputs remain available. Unsupported files retain downloads with the neutral `result.bin` filename. HTML and SVG never execute inside the grading dashboard. Artifact responses have a restrictive sandbox CSP and `nosniff`. The submitted bytes remain unchanged and can identify their author through their own content.

## HTTP reference

| Method and path | Result |
| --- | --- |
| `GET /api/blind-grading/runs` | Neutral configured-run list |
| `POST /api/blind-grading` | Create by `reviewId`, request ID and optional grader name; issue cookie |
| `GET /api/grading-invitations/:reviewId` | Neutral invitation and readiness |
| `GET /api/blind-grading/:id/lifecycle` | Name and draft/submitted state |
| `POST /api/blind-grading/:id/submit` | Idempotent partial or complete freeze |
| `GET /api/blind-grading/:id/reveal` | Submitted-only entrant identities |
| `GET /api/blind-grading/:id/tasks/:task/inputs` | Shared original inputs when every completed card matches |
| `GET /api/blind-grading/:id` | Authorized session navigation and per-task progress |
| `GET /api/blind-grading/:id/tasks/:task` | One authorized anonymous task and its judgments |
| `POST /api/blind-grading/:id/judgments` | Save `{card, criterion, expectedVersion, value}` |
| `GET /api/blind-grading/:id/assets/:asset` | Existing authorized neutral result bytes |
| `GET /api/blind-grading/:id/cards/:card/result` | Strict shared result presentation |
| `GET /api/blind-grading/:id/cards/:card/files/:file/:purpose` | Published file by ordinal, with `download`, `text`, or `media` purpose |
| `POST /api/blind-grading/:id/cards/:card/preview` | Open isolated HTML with an empty object body |
| `POST /api/blind-grading/:id/cards/:card/preview/:previewId/input` | Authorized bounded preview action |
| `DELETE /api/blind-grading/:id/cards/:card/preview/:previewId` | Authorized preview close |

Session, category, task, card, criterion, and asset handles are distinct branded UUID types. Wrong handles and cross-task associations return 404. Invalid payloads return 400. Stale versions and incompatible controls return 409. Reveal is available only after submission. Submitted gradings contribute to the separate Results feature; there is no forced winner or pairwise ordering.

## Verification

`tests/blind-grading.test.ts` uses real HTTP and PostgreSQL for eligibility, immutable snapshots, anonymity, every rating value, replay, stale races, independent cells, authority, artifact bytes, and database restart. `tests/browser/blind-grading.spec.ts` drives Chromium through all controls, navigation, progress, reload, exact retries, conflicts, raster rendering, WebM playback, and inert downloads. Fixture results demonstrate application behavior and do not establish live model access.
