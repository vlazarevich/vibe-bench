# Verify implemented behavior

Run `pnpm install --frozen-lockfile`, then `pnpm exec playwright install chromium`, then `pnpm check`, `pnpm build:runtime`, and `pnpm test:binary`. The complete checks require Node 24.21.0 and pnpm 11.22.0. PostgreSQL 18 starts from the pinned embedded binary package. No model credentials or Docker daemon are required.

The application, database, and execution runtime require Linux verification.

## Checks

The persistence test reopens the same database three times to exercise shutdown completion. `tests/database-lifecycle.test.ts` forcibly terminates the owning Node process, verifies that the real postmaster and workers exit and the TCP port closes, then reopens the database and checks saved data. The app startup test interrupts the dashboard after observing a real PostgreSQL process. Test cleanup uses the pinned `pg_ctl` against only its own temporary database if an assertion fails.

Lifecycle tests allow initial startup and crash recovery on slow CI hosts. These budgets do not extend the database worker's 90-second startup deadline or 40-second shutdown deadline.

The worker verifies a real SQL connection on its newly allocated port before announcing readiness. Restart tests check saved data without deleting the PID file or stored data.

| Command | Evidence |
| --- | --- |
| `pnpm typecheck` | Strict schemas and application types compile |
| `pnpm boundaries` | Application imports respect web, server, runner and contract ownership |
| `pnpm test` | Real PostgreSQL, real HTTP, fixture CLI subprocesses and process-tree behavior |
| `pnpm build` | Production Vite assets |
| `pnpm test:browser` | Real Chromium configured Runs, grading, suite authoring, access, result viewing, and reload |
| `pnpm build:runtime` | Standalone Linux x64 executable and checksummed release archive |
| `pnpm test:binary` | Installed CLI, installer failures, and the configured-run matrix through the compiled executable |

`tests/processes.test.ts` launches a process with a real descendant. It checks that the descendant is no longer alive after a timeout, normal parent completion, and owner interruption. Linux uses a process group. A Linux zombie is dead even if its PID remains visible pending reaping. The tests inspect process state instead of inferring termination from stopped output.

`tests/spool.test.ts` races sixteen immutable receipt writes on the real filesystem, rejects conflicting content, and verifies that temporary files are removed. Receipts are linked into place once after fsync; duplicate deliveries compare the existing receipt instead of replacing it.

CI requires `verify (self-hosted Linux)` from `.github/workflows/checks.yml`. This self-hosted Linux job is the only required platform check. A missing, skipped, or cancelled job is not passing evidence. Browser traces from failed jobs are uploaded. Test state, logs, screenshots, and traces stay under ignored `.artifacts/`.

`tests/configured-runs.test.ts` verifies immutable configuration, subset matrices, concurrent claims, replay conflicts, artifact publication, and restart persistence through HTTP and PostgreSQL. `tests/configured-runtime.test.ts` verifies the three adapter formats, exact model and settings arguments, malformed and failed harness output, pinned Git materials, separate workspaces, output collection, interrupted work, and real Chromium recordings.

`tests/configured-loop.test.ts` runs all ten task kinds across all three fixture harnesses through the worker API and PostgreSQL. Each password mode runs against both the main and dedicated worker listeners. Each case checks 30 completed attempts, intentional failures and skips, downloaded artifact hashes, pinned suite inputs, and state after database restart. `pnpm test:binary` repeats these cases through the compiled CLI. `tests/browser/configured-runs.spec.ts` drives selection, preview, durable creation, lost-response retry, historical inputs, outcomes, and inert downloads.

For live configured execution, create a run in **Runs**, pair the runner, and run `pnpm runner run-once`. Record requested models, executable versions, outcomes, and downloaded artifacts. Verify a browser scenario with a real recording and an observable action. Fixture success does not establish model or subscription access. Unavailable combinations must have explicit skipped or failed outcomes, not fabricated results.

`tests/suites.test.ts` checks every required task kind, rating bounds and conversions, draft readiness, malformed references, explicit edit choice, canonical digests and snapshot validation. `tests/suites-integration.test.ts` exercises nested edits over HTTP and PostgreSQL, concurrent saves, historical reads, SQL immutability, local authority, request sizes, restart persistence, and preserved shared immutability after legacy-table cleanup. Configured-run tests verify execution snapshots after later suite edits.

`tests/browser/suites.spec.ts` drives all task kinds, criteria, rating controls, ranking rules, materials, explicit save choices, incomplete drafts, validation errors, reloads, deletion, historical content and two-editor conflicts. Screenshots remain under `.artifacts/`.

`tests/blind-grading.test.ts` verifies selected tasks, every terminal attempt, suite changes before session creation, every rating value, saved criterion and attempt associations, zero versus absent grades, equal grades, exact save replay, stale competing writes, independent cells, and stable mapping after database restart. SQL tests reject mapping edits and judgment reassignment. Neutral JSON, errors, headers, and artifact transport exclude metadata canaries and management identifiers. Only declared result files are accessible.

`tests/browser/blind-grading.spec.ts` drives stars, the range slider, exact numeric selection, and thumbs in Chromium. It checks explicit skip and clear, URL navigation, saved progress, reload, separate-browser denial, lost-response replay, and two-tab conflicts. Raster images decode and a one-second fixture WebM plays. HTML downloads without executing. Network assertions prove grading requests only blind endpoints. A screenshot is saved at `.artifacts/blind-grading-cards.png`. The tiny blue recording is generated fixture content, not evidence of live browser-agent execution.

## Live evidence

For live execution, start the dashboard with `pnpm local`, pair using its runtime enrollment command, create a **Live** configured run, then execute `pnpm runner run-once`. Record OS, executable versions, exact requested models, outcomes, downloaded artifacts, and reviewed commit. A browser task needs a real recording with an observable action.

Fixtures prove runner mechanics, not provider account access, model entitlement, or answer quality. Missing credentials and inaccessible models remain explicit failures or skips and leave live verification incomplete.

## Limits

Tests cover empty-database migration, upgrading an existing database, concurrent migration startup, and reopening suite and configured-run state. The app does not implement scheduler leases, cancellation APIs, or arbitrary untrusted code execution. Shared-password access is distinct from infrastructure deployment verification. Those broader contracts need their own tests as code arrives.

`tests/onboarding.test.ts` and pairing tests use real subprocesses, HTTP, and PostgreSQL for missing tools, bounded authentication probes, cached status, reusable token retries, credential replacement, sequence recovery, failed-pair cleanup, concurrent probe, state ownership, remote-revoke failure, and abandonment. `run-once` waits through an initially empty queue and the configured matrix is repeated through `vibe-runner`. These fixtures establish mechanics, not live model access.

## Result viewer checks

Result checks require Bubblewrap at `/usr/bin/bwrap`, enabled unprivileged user/network namespaces, system runtime libraries/fonts, and the installed Playwright Chromium. `tests/artifact-viewer.test.ts` publishes all five result formats through real worker HTTP and PostgreSQL, checks full answers, declared outputs, malformed UTF-8/media, unsupported binary files, scope rejection, exact download bytes, neutral labels, and database restart persistence.

`tests/html-preview.test.ts` launches real Chromium with production namespace mounts. It verifies loopback denial without interception, inaccessible host home/workspace files, local CSS/JS/images, typed interaction, two-session capacity, hostile self-navigation and network attempts, busy-script deadlines, shutdown during launch, and idle expiry. `tests/browser/artifact-viewer.spec.ts` drives the built UI, decodes image/video bytes, selects changed files and patches, interacts with HTML, downloads outputs, reloads results, and closes a preview during a delayed input response. These tests prove fixture viewing and isolation behavior, not model quality or live account access.

`tests/grading-viewer.test.ts` verifies rich result projection and every published file with real HTTP/PostgreSQL, neutral transport, foreign-cookie rejection, unchanged grade persistence, and HTML input/close authority. `tests/browser/grading-viewer.spec.ts` views and grades all five result formats in Chromium, checks complete text, decoded image/video, code paths/diffs, interactive HTML, declared downloads, reload, and another browser's denial. Grading sends only session-scoped API requests.

## Access and recovery

`tests/access.test.ts` uses PostgreSQL and both real HTTP listeners to verify dashboard gating, session expiry, rotation, passwordless transitions, CSRF, bounded guessing, secure cookies, enrollment concurrency and expiry, runtime identity isolation, and immediate revocation. `tests/browser/access.spec.ts` drives protected login, runtime enrollment and revocation, grading navigation, logout, and passwordless enrollment in Chromium. Existing rich-viewer fixtures now enroll authenticated runtimes.
