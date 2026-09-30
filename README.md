# Vibe bench

Run one text task through two Codex models on your machine, compare the answers without model labels, and reveal their identities after saving a choice.

## Run the local demo

Install Node.js 24 and pnpm 11.22.0. On Linux x64, run:

```sh
pnpm install --frozen-lockfile
pnpm demo
```

Open the URL printed after `Vibe bench ready`. Select **Compare answers**, read both answers, and choose one. Reload to verify that the presentation order and choice remain saved.

The demo uses deterministic fixture text. It does not call a model. The server binds to `127.0.0.1`. A pinned PostgreSQL 18 binary starts automatically, so Docker and a separate database installation are unnecessary. The first install downloads the database binaries.

The application, PostgreSQL, and execution runtime support Linux only.

`pnpm local` starts the same app without adding a fixture run. Leave that terminal running and use a second terminal for runner commands. Stop the server with Ctrl+C. Database contents and runner diagnostics remain under `.local/`. Each worktree has its own directory and automatically allocated ports. `VIBE_LOCAL_ROOT` overrides that directory for both the server and runner. `VIBE_PORT` optionally fixes the HTTP port.

## Run the actual models

Install Codex CLI 0.159.2 and authenticate it outside this repository. Copy `.env.example` to `.env`. Set both model variables and the absolute path to the native executable:

```dotenv
VIBE_MODEL_A=gpt-6-luna
VIBE_MODEL_B=gpt-6-sol
VIBE_CODEX_BIN=/path/to/codex
```

Use the native `codex` binary path. A wrapper or shell script is not supported. An npm installation keeps the native executable in the platform package beneath `@openai/codex/node_modules/@openai/codex-<platform>/vendor/<target>/bin/`. Both models must be distinct and must be one of the two IDs above. The runner never substitutes another model.

With `pnpm local` or `pnpm demo` running, execute:

```sh
pnpm run:live
```

Refresh **Available runs** in the browser. A live run uses the same prompt for both models and records the exact requested model and executable version. The default task asks for a short explanation of database indexes. Set `VIBE_TASK_FILE` to a UTF-8 text file to use another prompt. Its text is snapshotted before either attempt starts. `VIBE_TIMEOUT_MS` sets each attempt's deadline, from 100 to 600000 milliseconds, with a default of 180000.

Codex runs with `--ignore-user-config`, `--ignore-rules`, `--skip-git-repo-check`, `--ephemeral`, `--sandbox read-only`, and the exact configured model. The adapter reads the final-message file and requires a `turn.completed` JSON event. Login credentials stay in your existing external Codex home. The server bearer token is never placed in an attempt workspace or its child environment. This is a local text comparison tool, not a security boundary for arbitrary untrusted execution.

## Author and run a suite task

Open **Suites** in the local app. Create a suite, add categories and tasks, then create criteria and assign them to tasks. Choose a rating control to preview its 0–100 conversion. Add optional ranking guidance and repository configuration as needed. The app saves incomplete drafts and lists fields that need attention.

For each edit, choose **Save minor change** or **Save new revision**. Both preserve previous content. Use **History** to inspect earlier definitions. If another editor saves first, your local edits remain available and the app offers an explicit reload.

For a ready text-generation task with materials set to **None**, save the suite and select **Export** beside the task. Save the JSON file locally. Set its absolute path in `.env`:

```dotenv
VIBE_SUITE_FILE=/path/to/suite-task.json
```

Remove `VIBE_TASK_FILE` if it is set. With the same local server running, run `pnpm run:fixture` or `pnpm run:live`. Refresh **Comparisons** to review the result. The run uses the exported content even if the suite has since changed. Remove `VIBE_SUITE_FILE` to return to the default task or `VIBE_TASK_FILE`.

All ten task kinds can be authored. The current runner executes only text generation without repository materials. Repository checkout, rubric judgment collection, and aggregate ranking are outside this feature. Ranking rules are saved written guidance.

## Inspect failures and retry delivery

`pnpm run:fixture` creates another deterministic run through the real runner and HTTP API. Fixture runs are labeled in the UI and persisted separately from live evidence.

Each `.local/runner/<run-id>/` contains the immutable input snapshot and progress, per-attempt diagnostics, a completed `report.json`, and an accepted `receipt.json`. Failed attempts retain logs and partial output. A run with any failed attempt cannot be evaluated. A live runner command exits nonzero when an attempt fails.

If execution completed but delivery failed, run:

```sh
pnpm report:retry
```

Retry sends saved reports with their original IDs. Identical delivery has one effect. Changed content under an accepted ID conflicts. A directory without a completed report is reported as uncertain and is never automatically executed again. Start a new run to retry execution and retain the earlier diagnostics.

Choices are final for a browser session. Repeating the same choice succeeds, while changing a saved choice conflicts. The browser's HTTP-only cookie authorizes session reads and writes. A session URL alone grants no access. Clearing the cookie loses access to that session. Submitted text can identify its author through its own content.

## Verify locally

```sh
pnpm exec playwright install chromium
pnpm check
```

`pnpm check` checks TypeScript and import boundaries, runs real PostgreSQL, HTTP, and subprocess tests, builds the app, and drives it in Chromium. Tests use isolated databases and ports under `.artifacts/`. Linux machines may need `pnpm exec playwright install --with-deps chromium` for browser system libraries. CI runs the same checks on the self-hosted Linux x64 runner without model credentials. Browser system libraries must already be installed. The required merge check is `verify (self-hosted Linux)`.

Fixture checks do not prove live model access. Run `pnpm run:live` separately with the required account and exact model configuration.

## Engineering reference

- [Architecture and implemented module ownership](docs/architecture.md)
- [Verification and evidence requirements](docs/verification.md)
- [Implemented text protocol](docs/contracts/text-comparison.md)
- [Suite authoring and pinned execution](docs/contracts/suites.md)
- [Broader domain design](docs/contracts/domain.md)
- [Runner lifecycle guidance](docs/contracts/runner-protocol.md)
- [Evaluation boundary guidance](docs/contracts/artifacts-evaluation.md)
- [Development workflow](docs/agent-workflow.md)
- [Architecture decision](docs/decisions/0001-architecture.md)

## Runtime onboarding

A Linux runtime registers its machine capabilities through an outbound request. Run `VIBE_API_URL=http://127.0.0.1:<app-port> pnpm runtime:onboard` against the local app. A remote origin must use HTTPS. Configure `VIBE_RUNTIME_SLOTS` from 1 to 256 to declare capacity and `VIBE_RUNTIME_STATE` to choose the durable identity directory. The command does not need a local app, database, or `instance.json` on the worker machine.

The command probes Codex, Claude Code, OpenCode Go, Git, GitHub CLI, Node, .NET, Python, npm, pnpm, make, CMake, GCC, and Docker. Installation and authentication readiness are separate. Authentication probes use each harness's status command. OpenCode Go requires its own provider credential. A credential for another OpenCode provider does not establish Go readiness. Readiness is not proof of model entitlement or successful execution. Model selection remains provider-discovered at execution, with no onboarding model allowlist.

Each state directory owns one stable runtime UUID and monotonic observation sequence. One command owns it at a time. Failed delivery leaves a saved observation. Re-running retries that exact observation before discovering new facts. Accepted observations have stable receipts. Older deliveries cannot replace the latest sequence. The local browser API exposes the latest observations at `GET /api/runtimes`.

For remote workers, configure `VIBE_WORKER_HOST` and `VIBE_WORKER_PORT` before `pnpm local`. This opt-in listener shares the app's database and exposes only `POST /api/worker/registrations`. Put it behind a trusted HTTPS reverse proxy for remote use. Requests carrying browser Origin or Fetch Metadata headers are rejected. The browser listener retains its loopback Host restriction. Registration authentication belongs to KV-49 and is not implemented here. Restrict listener network access accordingly. Onboarding does not claim jobs, schedule execution, or acquire corpus materials.

Only numeric versions and explicit readiness states enter registrations. Probe output is bounded, held in private temporary directories, and removed after each probe. Raw authentication output is never persisted in onboarding state or HTTP payloads. Fixture tests prove discovery mechanics. They do not prove account entitlement or model execution.
