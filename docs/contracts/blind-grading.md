# Configured-run blind grading

Status: implemented. `packages/contracts/src/blind-grading.ts` defines the browser contract. `apps/server/src/features/blind-grading.ts` owns session mappings, judgments, and anonymous artifact access. The pairwise comparison demo has separate storage, cookies, and final-choice behavior.

## Eligibility and presentation

Grading starts after every configured attempt has a terminal outcome. A session includes only the tasks selected in the immutable execution snapshot. Categories and tasks retain their suite order. Every selected task presents every attempt, including execution failures and skips. Completed attempts have independently editable criterion judgments. Failed and execution-skipped attempts show a neutral unavailable state, without diagnostics or invented grades.

Each task shuffles its cards once when the session opens. Random card handles and presentation order persist across reloads and database restarts. A card handle does not identify the same entrant across tasks. The session never adds new attempts. Task navigation lives in the URL. Saved judgment counts supply progress without calculating an aggregate score.

The grading page requests only the neutral run list, session navigation, and one selected task. It never fetches runtime records, configured-run management DTOs, or the pairwise demo list. The public run list contains a random review ID, suite title, fixture or live label, and readiness. It contains no execution identifiers or timing.

## Pinned criteria and selections

Every judgment belongs to one completed card and one criterion assigned to that task in the execution snapshot. The session stores the full criterion definition and `rating-control-v1` conversion with its immutable mapping. Its run foreign key preserves the original execution snapshot and accepted configuration request. Later suite edits do not change task instructions, criteria, controls, or saved associations.

A judgment is one of three states.

| State | Stored selection | Grade |
| --- | --- | --- |
| `ungraded` | Absent | Absent |
| `skipped` | Absent | Absent |
| `graded` | Original control and value | Derived by the server |

Stars accept integers 1 through 5 and produce 20, 40, 60, 80, or 100. The slider accepts integers 0 through 10 and produces multiples of ten. Thumbs accept a boolean and produce 100 for true or 0 for false. A numeric zero is a grade. Skip and Clear are explicit actions, each with a version increment. Equal grades are valid. A client cannot submit a derived grade or use another criterion's control.

The UI requires a selection before saving a grade. An untouched slider does not create a zero grade. Each editor disables additional writes while saving. A failed request offers an exact retry or a reload of saved judgments. A conflicting tab must reload before editing again. If a progress refresh fails after saving, the grade stays saved and a page-level alert lets the reviewer retry the progress read without another judgment write.

## Persistence and concurrency

Migration `005-blind-grading.sql` adds neutral review IDs, immutable `blind_grading_sessions`, and mutable `blind_grading_judgments`. The session mapping is JSON. Judgments are separate rows keyed by session, card, and criterion. An immutable SQL trigger protects each row's association, and the feature checks same-task membership before saving.

Session creation holds an advisory transaction lock for the run and capability hash. The unique run-and-authority constraint makes repeated creation return the existing session. Mapping and initial ungraded cells commit together.

A save includes `expectedVersion`. The transaction locks only the target judgment row. A matching version changes the value and increments the version once. An identical immediate replay using the preceding version returns the saved value. Any other stale request returns 409. Different judgments can save independently. A clear followed by an old graded retry cannot restore the old grade.

## Authority and anonymous output

A 256-bit capability in the `vibe_grading_authority` HttpOnly, SameSite=Strict cookie authorizes sessions. The database stores its SHA-256 hash. Creation refreshes the cookie's 30-day lifetime. Clearing or losing the cookie loses resume access. URLs never convey authority. Missing or foreign authority returns the same 404 for session, task, judgment, and artifact operations. The existing loopback Host and same-origin mutation rules apply. Responses use `Cache-Control: no-store`.

Explicit schemas construct public fields. Responses exclude model and harness identity, runtime and management IDs, settings, diagnostic reasons, observations, original filenames, hashes, and storage paths. Artifact media types come from an allowlist, with `application/octet-stream` for other declarations. Only artifact IDs referenced by the completed result descriptor enter the session's existing anonymous asset mapping. The rich viewer separately projects primary results and declared outputs after authorizing the mapped card. Stable file ordinals within each immutable outcome replace artifact IDs in its URLs. Diagnostics and unpublished files do not become viewer downloads. A diagnostic reference inside an accepted HTML asset list is omitted while the result remains gradeable.

The shared `ResultViewer` shows complete saved text, decoded images and WebM, changed code files and patches, and declared outputs. Code paths and source text remain submitted content, even when they identify the author. Metadata filenames stay neutral. HTML runs only in the isolated server browser described by the [artifact contract](artifacts-evaluation.md), and the dashboard receives PNG frames. Every preview action and close reauthorizes the session and card. Management and grading share the two-preview capacity. Unsupported files retain downloads with the neutral `result.bin` filename. HTML and SVG never execute inside the grading dashboard. Artifact responses have a restrictive sandbox CSP and `nosniff`. The submitted bytes remain unchanged and can identify their author through their own content.

## HTTP reference

| Method and path | Result |
| --- | --- |
| `GET /api/blind-grading/runs` | Neutral configured-run list |
| `POST /api/blind-grading` | Open or resume by `reviewId`, issue cookie, return navigation |
| `GET /api/blind-grading/:id` | Authorized session navigation and per-task progress |
| `GET /api/blind-grading/:id/tasks/:task` | One authorized anonymous task and its judgments |
| `POST /api/blind-grading/:id/judgments` | Save `{card, criterion, expectedVersion, value}` |
| `GET /api/blind-grading/:id/assets/:asset` | Existing authorized neutral result bytes |
| `GET /api/blind-grading/:id/cards/:card/result` | Strict shared result presentation |
| `GET /api/blind-grading/:id/cards/:card/files/:file/:purpose` | Published file by ordinal, with `download`, `text`, or `media` purpose |
| `POST /api/blind-grading/:id/cards/:card/preview` | Open isolated HTML with an empty object body |
| `POST /api/blind-grading/:id/cards/:card/preview/:previewId/input` | Authorized bounded preview action |
| `DELETE /api/blind-grading/:id/cards/:card/preview/:previewId` | Authorized preview close |

Session, category, task, card, criterion, and asset handles are distinct branded UUID types. Wrong handles and cross-task associations return 404. Invalid payloads return 400. Stale versions and incompatible controls return 409. There is no reveal, winner, forced ordering, rank, or aggregation endpoint in this feature.

## Verification

`tests/blind-grading.test.ts` uses real HTTP and PostgreSQL for eligibility, immutable snapshots, anonymity, every rating value, replay, stale races, independent cells, authority, artifact bytes, and database restart. `tests/browser/blind-grading.spec.ts` drives Chromium through all controls, navigation, progress, reload, exact retries, conflicts, raster rendering, WebM playback, and inert downloads. Fixture results demonstrate application behavior and do not establish live model access.
