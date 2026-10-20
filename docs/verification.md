# Verify implemented behavior

Run `pnpm install --frozen-lockfile`, then `pnpm exec playwright install chromium`, then `pnpm check`, `pnpm build:runtime`, and `pnpm test:binary`. The complete checks require Node 24.21.0 and pnpm 11.22.0. PostgreSQL 18 starts from the pinned embedded binary package. No model credentials or Docker daemon are required.

The application, database, and execution runtime require Linux verification.

## Checks

`tests/vercel.test.ts` runs the packaged Vercel handler outside the repository using real HTTP and PostgreSQL: concurrent cold starts, shared sessions and persistence across instances, a 6 MiB response, Host/Origin protection, startup failure recovery and idle database client draining/reconnection through a simulated Vercel lifecycle context. `pnpm build:vercel` emits the deployment tree without provider credentials. This verifies the package locally, not a live Vercel/Neon installation. See the [hosted verification checklist](vercel.md#build-and-verification).

`tests/production-server.test.ts` builds the dashboard bundle into a temporary directory and runs it from outside the repository. Two bundled processes start concurrently against one external PostgreSQL database, serve health and web assets, apply migrations once, create no local state, and exit cleanly without stopping that database. The bundled migration command is idempotent and refuses to run without `DATABASE_URL`. Embedded mode creates its state, rejects a second owner, and stops PostgreSQL on shutdown. Terminating the dashboard's idle database connections, as a restart or a hosted provider's idle timeout does, leaves the process running and healthy.

The persistence test reopens the same database three times to exercise shutdown completion. `tests/database-lifecycle.test.ts` forcibly terminates the owning Node process, verifies that the real postmaster and workers exit and the TCP port closes, then reopens the database and checks saved data. The app startup test interrupts the dashboard after observing a real PostgreSQL process. Test cleanup uses the pinned `pg_ctl` against only its own temporary database if an assertion fails.

Lifecycle tests allow initial startup and crash recovery on slow CI hosts. These budgets do not extend the database worker's 90-second startup deadline or 40-second shutdown deadline.

The worker verifies a real SQL connection on its newly allocated port before announcing readiness. Restart tests check saved data without deleting the PID file or stored data.

| Command | Evidence |
| --- | --- |
| `pnpm typecheck` | Strict schemas and application types compile |
| `pnpm boundaries` | Application imports respect web, server, runner and contract ownership |
| `pnpm test` | Real PostgreSQL, real HTTP, fixture CLI subprocesses and process-tree behavior |
| `pnpm build` | Production Vite assets and the bundled dashboard process |
| `pnpm test:browser` | Real Chromium configured Runs, grading, suite authoring, access, result viewing, and reload |
| `pnpm build:runtime` | Standalone Linux x64 executable and checksummed release archive |
| `pnpm build:vercel` | Streaming Node function with bundled migrations and web assets for Vercel |
| `pnpm build:dashboard` | Self-hosted dashboard archive, installer, and checksums |
| `sh scripts/smoke-compose.sh` | Container image and compose deployment; needs a Docker daemon |
| `pnpm test:binary` | Installed CLI, installer failures, and the configured-run matrix through the compiled executable |

`tests/processes.test.ts` launches a process with a real descendant. It checks that the descendant is no longer alive after a timeout, normal parent completion, and owner interruption. Linux uses a process group. A Linux zombie is dead even if its PID remains visible pending reaping. The tests inspect process state instead of inferring termination from stopped output.

`tests/spool.test.ts` races sixteen immutable receipt writes on the real filesystem, rejects conflicting content, and verifies that temporary files are removed. Receipts are linked into place once after fsync; duplicate deliveries compare the existing receipt instead of replacing it.

`tests/dashboard-release.test.ts` packages the dashboard with a fixture web root and checks that the archive holds the bundled server, migrations, systemd unit, and lockfile-pinned production dependencies without development packages, with symlinks only inside the archive. Its installer runs against a fake `curl` for a fork repository. A first install writes `.env` with port 8080 and a state directory outside the installation (mode 600). The installer rejects a state directory inside the installation (including symlinked and `..` spellings), a relative path or one unsafe to quote in `.env`, a corrupted archive, a bad tag, a malformed repository, an occupied foreign directory, a built source checkout (no `VERSION`, or `.git`), and Node other than 24, leaving the installation intact. The installed dashboard starts with no `VIBE_LOCAL_ROOT` in its environment, keeps its embedded database in that state directory, serves the web root, and accepts only the trimmed password. A reinstall keeps `.env` and the database. A `PG_VERSION` file anywhere inside an installation blocks the upgrade instead of deleting the database. A rerun after an interrupted directory swap recovers the previous settings before upgrading. The systemd unit reads the same installed `.env`, with an optional `/etc/vibe-bench/env` override.

`.github/workflows/container.yml` runs `scripts/smoke-compose.sh` on GitHub-hosted Ubuntu for pull requests and `main`. It builds the image and starts PostgreSQL 18 and the dashboard with compose, with optional settings left blank as compose passes them. It then checks container health, password mode, wrong and trimmed-password logins, all migrations, and login after a dashboard restart. On a published release the same script tests the exact image before it is pushed to GHCR. The job is informational; it is not yet a required check.

CI requires `verify (self-hosted Linux)` from `.github/workflows/checks.yml`. This self-hosted Linux job is the only required platform check. A missing, skipped, or cancelled job is not passing evidence. Browser traces from failed jobs are uploaded. Test state, logs, screenshots, and traces stay under ignored `.artifacts/`.

`tests/configured-runs.test.ts` verifies immutable configuration, subset matrices, concurrent claims, replay conflicts, artifact publication, and restart persistence through HTTP and PostgreSQL. Chunk tests split a three-chunk artifact with the runner's own splitter, reject unaligned offsets, foreign attempts and runtimes, and protocol 1 with HTTP 426, require every chunk before acceptance, replay identical chunks before and after acceptance, reject changed bytes, enforce the body limit on both listeners, and discard staged chunks on cancellation. `tests/runtime-durability.test.ts` checks that recovery sends each attempt's chunks after its start and before its terminal report. `tests/configured-runtime.test.ts` verifies the three adapter formats, exact model and settings arguments, malformed and failed harness output, pinned Git materials, separate workspaces, output collection, interrupted work, and real Chromium recordings.

`tests/configured-loop.test.ts` runs all ten task kinds across all three fixture harnesses through the worker API and PostgreSQL. Each password mode runs against both the main and dedicated worker listeners. Each case checks 30 completed attempts, intentional failures and skips, downloaded artifact hashes, pinned suite inputs, and state after database restart. `pnpm test:binary` repeats these cases through the compiled CLI. `tests/browser/configured-runs.spec.ts` drives revision and discovered-model selection, full-matrix creation, lost-response retry, historical inputs, outcomes, and inert downloads.

For live configured execution, create a run in **Runs**, pair the runner, and run `pnpm runner run-once`. Record requested models, executable versions, outcomes, and downloaded artifacts. Verify a browser scenario with a real recording and an observable action. Fixture success does not establish model or subscription access. Unavailable combinations must have explicit skipped or failed outcomes, not fabricated results.

`tests/suites.test.ts` checks every required task kind, rating bounds and conversions, draft readiness, malformed references, explicit edit choice, canonical digests and snapshot validation. `tests/suites-integration.test.ts` exercises nested edits over HTTP and PostgreSQL, concurrent saves, historical reads, SQL immutability, local authority, request sizes, restart persistence, and preserved shared immutability after legacy-table cleanup. Configured-run tests verify execution snapshots after later suite edits.

`tests/browser/suites.spec.ts` drives all task kinds, criteria, rating controls, materials, explicit save choices, incomplete drafts, validation errors, reloads, deletion, revision history replacement, first-task selection and two-editor conflicts. Screenshots remain under `.artifacts/`.

`tests/blind-grading.test.ts` verifies selected tasks, every terminal attempt, suite changes before session creation, every rating value, saved criterion and attempt associations, zero versus absent grades, equal grades, exact save replay, stale competing writes, independent cells, and stable mapping after database restart. SQL tests reject mapping edits and judgment reassignment. Neutral JSON, errors, headers, and artifact transport exclude metadata canaries and management identifiers. Only declared result files are accessible.

`tests/browser/blind-grading.spec.ts` drives stars, the range slider, exact numeric selection, and thumbs in Chromium. It checks explicit skip and clear, URL navigation, visible task instructions and legacy criterion guidance, task-based progress, sidebar expansion, reload, separate-browser denial, lost-response replay, and two-tab conflicts. Raster images decode and a one-second fixture WebM plays. HTML downloads without executing. Network assertions prove grading requests only blind endpoints. A screenshot is saved at `.artifacts/blind-grading-cards.png`. The tiny blue recording is generated fixture content, not evidence of live browser-agent execution.

## Live evidence

For live execution, start the dashboard with `pnpm local`, pair using its runtime enrollment command, create a **Live** configured run, then execute `pnpm runner run-once`. Record OS, executable versions, exact requested models, outcomes, downloaded artifacts, and reviewed commit. A browser task needs a real recording with an observable action.

Fixtures prove runner mechanics, not provider account access, model entitlement, or answer quality. Missing credentials and inaccessible models remain explicit failures or skips and leave live verification incomplete.

## Limits

Tests cover empty-database migration, upgrading an existing database, concurrent migration startup, and reopening suite and configured-run state. The app does not implement scheduler leases or general-purpose sandboxing of arbitrary runner code. Shared-password access is distinct from infrastructure deployment verification. Those broader contracts need their own tests as code arrives.

`tests/harness-discovery.test.ts` covers Claude control initialization, canonical model IDs, bounded malformed/failed probes, and OpenCode v2 Console-to-Go connection mapping, credential methods, and model filtering without publishing private metadata. These use fixture subprocesses and do not prove live model entitlement.

`tests/onboarding.test.ts` and pairing tests use real subprocesses, HTTP, and PostgreSQL for missing tools, bounded authentication probes, cached status, single-use tokens and durable exact enrollment retries, credential replacement, sequence recovery, failed-pair cleanup, concurrent probe, state ownership, remote-revoke failure, and abandonment. `run-once` waits through an initially empty queue and the configured matrix is repeated through `vibe-runner`. These fixtures establish mechanics, not live model access.

## Result viewer checks

`tests/artifact-viewer.test.ts` publishes all five result formats through real worker HTTP and PostgreSQL, checks full answers, declared outputs, malformed UTF-8/media, unsupported binary files, scope rejection, exact download bytes, neutral labels, and database restart persistence. Preview grant tests check sandbox policy headers on every bundle file, query strings and unicode paths, 404 for diagnostics, unlisted, case-changed and encoded-traversal paths and unknown tokens, distinct tokens per opening, hash-only storage, the dashboard's `frame-src`, and expiry. Media tests cover PNG, JPEG, WebP (VP8L and oversized VP8X), WebM DocType, truncated headers, and SVG rejection.

`tests/browser/artifact-viewer.spec.ts` drives the built UI, decodes image/video bytes in the browser, selects changed files and patches, and interacts with HTML inside the sandboxed frame: clicks, typing, stylesheet, image, module script and unicode asset loading, viewport resizing, and reload. A hostile probe script in the fixture bundle must record cookie, storage, parent, popup, fetch, external image, and top-navigation attempts as blocked, and the dashboard URL and page count must stay unchanged. A second test opens a preview link directly and confirms its opaque origin, and shows that a foreign origin cannot frame it. These tests prove fixture viewing and isolation behavior, not model quality or live account access.

`tests/grading-viewer.test.ts` verifies rich result projection and every published file with real HTTP/PostgreSQL, neutral transport, foreign-cookie rejection, unchanged grade persistence, and preview grant authority without management identifiers. `tests/browser/grading-viewer.spec.ts` views and grades all five result formats in Chromium, checks complete text, decoded image/video, code paths/diffs, interactive HTML, declared downloads, reload, and another browser's denial. Grading sends only session-scoped API requests. Shared-input integration and browser tests cover identical, differing, and missing input artifacts, neutral file transport, and foreign-session denial.

## Access and recovery

`tests/access.test.ts` uses PostgreSQL and both real HTTP listeners to verify dashboard gating, session expiry, rotation, passwordless transitions, CSRF, bounded guessing, secure cookies, enrollment concurrency and expiry, runtime identity isolation, and immediate revocation. `tests/browser/access.spec.ts` drives protected login, numbered runtime onboarding, enrollment, capability summary, command copying, cancellation and revocation, grading navigation, logout, and passwordless enrollment in Chromium. Existing rich-viewer fixtures now enroll authenticated runtimes.

## Designed dashboard coverage

`dashboard-design.test.ts` covers named grading replay, partial submission and immutable freeze, read grants, canceled partial results, runtime heartbeat/deletion, Artificial Analysis Pro/Free pagination/cache/failure behavior and category-equal normalization using PostgreSQL and HTTP. Runtime collection tests cover contained task directories, original inputs, real verification commands, replay budget, long navigation targets, process cancellation and crash-window recovery. Pairing tests lose a committed exchange response and retry the durable identity.

Browser suites cover all authoring controls and task kinds, exact run retries and settings, connection/revocation, blind autosave/conflicts, distinct single/compare transitions, all result formats, partial submit/reveal/read-only viewing, Results filters, pivots, dates, confidence/details, and theme/sidebar persistence. Tests use deterministic fixtures unless explicitly recorded as live provider evidence.
