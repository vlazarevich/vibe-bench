# Verify implemented behavior

Run `pnpm install --frozen-lockfile`, then `pnpm exec playwright install chromium`, then `pnpm check`. The checks require Node 24 and pnpm 11.22.0. PostgreSQL 18 starts from the pinned embedded binary package. No model credentials or Docker daemon are required.

The application, database, and execution runtime require Linux verification.

## Checks

The persistence test reopens the same database three times to exercise shutdown completion. `tests/database-lifecycle.test.ts` forcibly terminates the owning Node process, verifies that the real postmaster and workers exit and the TCP port closes, then reopens the database and checks saved data. The app startup test interrupts a fixture run while `/api/health` still returns 503. Test cleanup uses the pinned `pg_ctl` against only its own temporary database if an assertion fails.

Lifecycle tests allow initial startup and crash recovery on slow CI hosts. These budgets do not extend the database worker's 90-second startup deadline or 40-second shutdown deadline.

The worker verifies a real SQL connection on its newly allocated port before announcing readiness. Restart tests check saved data without deleting the PID file or stored data.

| Command | Evidence |
| --- | --- |
| `pnpm typecheck` | Strict schemas and application types compile |
| `pnpm boundaries` | Application imports respect web, server, runner and contract ownership |
| `pnpm test` | Real PostgreSQL, real HTTP, fixture CLI subprocesses and process-tree behavior |
| `pnpm build` | Production Vite assets |
| `pnpm test:browser` | Real Chromium comparison, blind responses, reload, cookie authority, final choice and reveal |

`tests/loop.test.ts` starts PostgreSQL from an empty directory, migrates it, invokes fixture subprocesses, and uploads through HTTP. It verifies concurrent duplicate ingestion, conflicting replay, immutable accepted input, spool redelivery, anonymous browser responses, session access, stable mapping, concurrent opposing votes, final-choice replay, failure exclusion, and state after database restart.

`tests/processes.test.ts` launches a process with a real descendant. It checks that the descendant is no longer alive after a timeout, normal parent completion, and owner interruption. Linux uses a process group. A Linux zombie is dead even if its PID remains visible pending reaping. The tests inspect process state instead of inferring termination from stopped output.

`tests/spool.test.ts` races sixteen immutable receipt writes on the real filesystem, rejects conflicting content, and verifies that temporary files are removed. Receipts are linked into place once after fsync; duplicate deliveries compare the existing receipt instead of replacing it.

`tests/browser/comparison.spec.ts` drives the built app with a fixture run. It inspects API response bodies before voting, checks that another browser cannot resume a session by URL, reloads before and after voting, and confirms both identities appear only after a committed choice.

CI requires `verify (self-hosted Linux)` from `.github/workflows/checks.yml`. This self-hosted Linux job is the only required platform check. A missing, skipped, or cancelled job is not passing evidence. Browser traces from failed jobs are uploaded. Test state, logs, screenshots, and traces stay under ignored `.artifacts/`.

`tests/configured-runs.test.ts` verifies immutable configuration, subset matrices, concurrent claims, replay conflicts, artifact publication, and restart persistence through HTTP and PostgreSQL. `tests/configured-runtime.test.ts` verifies the three adapter formats, exact model and settings arguments, malformed and failed harness output, pinned Git materials, separate workspaces, output collection, interrupted work, and real Chromium recordings.

`tests/configured-loop.test.ts` runs all ten task kinds across all three fixture harnesses through the worker API and PostgreSQL. It checks 30 completed attempts, intentional failures and skips, downloaded artifact hashes, pinned suite inputs, and state after database restart. `tests/browser/configured-runs.spec.ts` drives selection, preview, durable creation, lost-response retry, historical inputs, outcomes, and inert downloads.

For live configured execution, create a run in **Runs**, register the runtime, and run `pnpm runtime:work --once`. Record requested models, executable versions, outcomes, and downloaded artifacts. Verify a browser scenario with a real recording and an observable action. Fixture success does not establish model or subscription access. Unavailable combinations must have explicit skipped or failed outcomes, not fabricated results.

`tests/suites.test.ts` checks every required task kind, rating bounds and conversions, draft readiness, malformed references, explicit edit choice, canonical digests and snapshot validation. `tests/suites-integration.test.ts` exercises nested edits over HTTP and PostgreSQL, concurrent saves, historical reads, SQL immutability, local authority, request sizes, protocol-1 upgrade and replay, and restart persistence. The pinned execution test changes the latest prompt to a failing fixture after export and proves the earlier prompt still executes. Its fixture records progress as observed before the first subprocess runs.

`tests/browser/suites.spec.ts` drives all task kinds, criteria, rating controls, ranking rules, materials, explicit save choices, incomplete drafts, validation errors, downloads, reloads, deletion, historical content and two-editor conflicts. Screenshots remain under `.artifacts/`. The original blind comparison test runs alongside it.

## Live evidence

Run `pnpm local`, configure `.env` using the README, and execute `pnpm run:live`. Both exact models, `gpt-6-luna` and `gpt-6-sol`, must complete through Codex CLI 0.159.2. Inspect the saved report, then compare the live answers in the browser and reload after choosing. Record the OS, CLI version, requested model IDs, outcomes, and reviewed commit in the PR.

Fixture success proves runner mechanics, not account access, live model behavior, or answer quality. Missing credentials or inaccessible models leave live verification incomplete. A failed attempt is saved as a failure and makes the run unavailable for evaluation.

## Limits

Tests cover empty-database migration, upgrading a persisted protocol-1 database, concurrent migration startup, and reopening suite and report state. The local app does not implement hosted authorization, scheduler leases, cancellation APIs, or arbitrary untrusted code execution. Those broader contracts need their own tests as code arrives.

`tests/onboarding.test.ts` executes fixture tools as real subprocesses and verifies missing installations, malformed auth output, another provider's OpenCode credential, timeouts, output limits, nonzero exits, and exclusion of credential strings. Real HTTP and PostgreSQL checks cover concurrent duplicate receipts, conflicts, out-of-order observations, stable receipts after restart, remote Host worker registration, browser rejection, and preserved local browser policies. A real CLI subprocess registers without `instance.json`, preserves its identity and sequence, retries saved observations, and rejects concurrent state ownership. These fixtures prove onboarding mechanics, not live model access.

## Result viewer checks

Result checks require Bubblewrap at `/usr/bin/bwrap`, enabled unprivileged user/network namespaces, system runtime libraries/fonts, and the installed Playwright Chromium. `tests/artifact-viewer.test.ts` publishes all five result formats through real worker HTTP and PostgreSQL, checks full answers, declared outputs, malformed UTF-8/media, unsupported binary files, scope rejection, exact download bytes, neutral labels, and database restart persistence.

`tests/html-preview.test.ts` launches real Chromium with production namespace mounts. It verifies loopback denial without interception, inaccessible host home/workspace files, local CSS/JS/images, typed interaction, two-session capacity, hostile self-navigation and network attempts, busy-script deadlines, shutdown during launch, and idle expiry. `tests/browser/artifact-viewer.spec.ts` drives the built UI, decodes image/video bytes, selects changed files and patches, interacts with HTML, downloads outputs, reloads results, and closes a preview during a delayed input response. These tests prove fixture viewing and isolation behavior, not model quality or live account access.
