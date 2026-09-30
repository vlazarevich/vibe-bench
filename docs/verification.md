# Verify implemented behavior

Run `pnpm install --frozen-lockfile`, then `pnpm exec playwright install chromium`, then `pnpm check`. The checks require Node 24 and pnpm 11.22.0. PostgreSQL 18 starts from the pinned embedded binary package. No model credentials or Docker daemon are required.

## Checks

The pinned `embedded-postgres` patch uses `pg_ctl` on Windows to start PostgreSQL with restricted privileges and stop it with `-m fast -w`. The upstream helper starts the server directly and returns after killing only the parent, which can leave shared memory in use during restart. The persistence test reopens the same database three times to exercise shutdown completion.

The database worker runs inside a Windows Job Object before initialization begins. `tests/database-lifecycle.test.ts` forcibly terminates the owning Node process and also exercises `taskkill /T /F`. It records the real postmaster and worker PIDs, verifies that every process exits and the TCP port closes, then reopens the same database and checks saved data. The app startup test interrupts a fixture run while `/api/health` still returns 503. Linux uses a forced owner exit after readiness and a handled app termination during startup. Test cleanup uses the pinned `pg_ctl` against only its own temporary database if an assertion fails.

The repeated-restart test allows three Windows helper compilations. Lifecycle tests allow initial startup and crash recovery on slow CI hosts. These budgets do not extend the database worker's 90-second startup deadline or 40-second shutdown deadline.

After an abrupt stop, `pg_ctl` can briefly mistake the stale PID file for a ready server during immediate restart. The worker verifies a real SQL connection on its newly allocated port before announcing readiness. The crash-recovery assertions cover this race without deleting the PID file or stored data.

| Command | Evidence |
| --- | --- |
| `pnpm typecheck` | Strict schemas and application types compile |
| `pnpm boundaries` | Application imports respect web, server, runner and contract ownership |
| `pnpm test` | Real PostgreSQL, real HTTP, fixture CLI subprocesses and process-tree behavior |
| `pnpm build` | Production Vite assets |
| `pnpm test:browser` | Real Chromium comparison, blind responses, reload, cookie authority, final choice and reveal |

`tests/loop.test.ts` starts PostgreSQL from an empty directory, migrates it, invokes fixture subprocesses, and uploads through HTTP. It verifies concurrent duplicate ingestion, conflicting replay, immutable accepted input, spool redelivery, anonymous browser responses, session access, stable mapping, concurrent opposing votes, final-choice replay, failure exclusion, and state after database restart.

`tests/processes.test.ts` launches a process with a real descendant. It checks that the descendant is no longer alive after a timeout, normal parent completion, and owner interruption. Windows uses a Job Object. Linux uses a process group. A Linux zombie is dead even if its PID remains visible pending reaping. The tests inspect process state instead of inferring termination from stopped output.

`tests/spool.test.ts` races sixteen immutable receipt writes on the real filesystem, rejects conflicting content, and verifies that temporary files are removed. Receipts are linked into place once after fsync; duplicate deliveries compare the existing receipt instead of replacing it.

`tests/browser/comparison.spec.ts` drives the built app with a fixture run. It inspects API response bodies before voting, checks that another browser cannot resume a session by URL, reloads before and after voting, and confirms both identities appear only after a committed choice.

CI requires both `verify (ubuntu-latest)` and `verify (windows-latest)` from `.github/workflows/checks.yml`. Missing, skipped, or cancelled jobs are not passing evidence. Browser traces from failed jobs are uploaded. Test state, logs, screenshots, and traces stay under ignored `.artifacts/`.

`tests/suites.test.ts` checks every required task kind, rating bounds and conversions, draft readiness, malformed references, explicit edit choice, canonical digests and snapshot validation. `tests/suites-integration.test.ts` exercises nested edits over HTTP and PostgreSQL, concurrent saves, historical reads, SQL immutability, local authority, request sizes, protocol-1 upgrade and replay, and restart persistence. The pinned execution test changes the latest prompt to a failing fixture after export and proves the earlier prompt still executes. Its fixture records progress as observed before the first subprocess runs.

`tests/browser/suites.spec.ts` drives all task kinds, criteria, rating controls, ranking rules, materials, explicit save choices, incomplete drafts, validation errors, downloads, reloads, deletion, historical content and two-editor conflicts. Screenshots remain under `.artifacts/`. The original blind comparison test runs alongside it.

## Live evidence

Run `pnpm local`, configure `.env` using the README, and execute `pnpm run:live`. Both exact models, `gpt-6-luna` and `gpt-6-sol`, must complete through Codex CLI 0.159.2. Inspect the saved report, then compare the live answers in the browser and reload after choosing. Record the OS, CLI version, requested model IDs, outcomes, and reviewed commit in the PR.

Fixture success proves runner mechanics, not account access, live model behavior, or answer quality. Missing credentials or inaccessible models leave live verification incomplete. A failed attempt is saved as a failure and makes the run unavailable for evaluation.

## Limits

Tests cover empty-database migration, upgrading a persisted protocol-1 database, concurrent migration startup, and reopening suite and report state. The local app does not implement hosted authorization, artifact isolation, scheduler leases, cancellation APIs, or arbitrary untrusted code execution. Those broader contracts need their own tests as code arrives.
