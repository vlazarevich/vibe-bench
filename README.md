# Vibe bench

Run one text task through two Codex models on your machine, compare the answers without model labels, and reveal their identities after saving a choice.

## Run the local demo

Install Node.js 24 and pnpm 11.22.0. On Windows x64 or Linux x64, run:

```sh
pnpm install --frozen-lockfile
pnpm demo
```

Open the URL printed after `Vibe bench ready`. Select **Compare answers**, read both answers, and choose one. Reload to verify that the presentation order and choice remain saved.

The demo uses deterministic fixture text. It does not call a model. The server binds to `127.0.0.1`. A pinned PostgreSQL 18 binary starts automatically, so Docker and a separate database installation are unnecessary. The first install downloads the database binaries.

`pnpm local` starts the same app without adding a fixture run. Leave that terminal running and use a second terminal for runner commands. Stop the server with Ctrl+C. Database contents and runner diagnostics remain under `.local/`. Each worktree has its own directory and automatically allocated ports. `VIBE_LOCAL_ROOT` overrides that directory for both the server and runner. `VIBE_PORT` optionally fixes the HTTP port.

## Run the actual models

Install Codex CLI 0.159.2 and authenticate it outside this repository. Copy `.env.example` to `.env`. Set both model variables and the absolute path to the native executable:

```dotenv
VIBE_MODEL_A=gpt-6-luna
VIBE_MODEL_B=gpt-6-sol
VIBE_CODEX_BIN=C:/path/to/codex.exe
```

On Linux, use the native `codex` binary path. A `codex.cmd` wrapper or shell script is not supported. An npm installation keeps the native executable in the platform package beneath `@openai/codex/node_modules/@openai/codex-<platform>/vendor/<target>/bin/`. Both models must be distinct and must be one of the two IDs above. The runner never substitutes another model.

With `pnpm local` or `pnpm demo` running, execute:

```sh
pnpm run:live
```

Refresh **Available runs** in the browser. A live run uses the same prompt for both models and records the exact requested model and executable version. The default task asks for a short explanation of database indexes. Set `VIBE_TASK_FILE` to a UTF-8 text file to use another prompt. Its text is snapshotted before either attempt starts. `VIBE_TIMEOUT_MS` sets each attempt's deadline, from 100 to 600000 milliseconds, with a default of 180000.

Codex runs with `--ignore-user-config`, `--ignore-rules`, `--skip-git-repo-check`, `--ephemeral`, `--sandbox read-only`, and the exact configured model. The adapter reads the final-message file and requires a `turn.completed` JSON event. Login credentials stay in your existing external Codex home. The server bearer token is never placed in an attempt workspace or its child environment. This is a local text comparison tool, not a security boundary for arbitrary untrusted execution.

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

`pnpm check` checks TypeScript and import boundaries, runs real PostgreSQL, HTTP, and subprocess tests, builds the app, and drives it in Chromium. Tests use isolated databases and ports under `.artifacts/`. Linux machines may need `pnpm exec playwright install --with-deps chromium` for browser system libraries. CI runs the same checks on Windows and Ubuntu without model credentials.

Fixture checks do not prove live model access. Run `pnpm run:live` separately with the required account and exact model configuration.

## Engineering reference

- [Architecture and implemented module ownership](docs/architecture.md)
- [Verification and evidence requirements](docs/verification.md)
- [Implemented text protocol](docs/contracts/text-comparison.md)
- [Broader domain design](docs/contracts/domain.md)
- [Runner lifecycle guidance](docs/contracts/runner-protocol.md)
- [Evaluation boundary guidance](docs/contracts/artifacts-evaluation.md)
- [Development workflow](docs/agent-workflow.md)
- [Architecture decision](docs/decisions/0001-architecture.md)
