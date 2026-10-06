# Vibe bench

Vibe bench authors versioned suites, executes configured task and entrant matrices, and grades results anonymously. A Linux dashboard stores immutable inputs and outcomes in PostgreSQL 18. The standalone `vibe-runner` pairs with that dashboard and initiates all execution traffic.

## Start the dashboard

Use Linux, Node 24.21.0, and pnpm 11.22.0.

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm local
```

Open the printed URL. The dashboard starts without seeded runs. Database files live under `.local/`, or the dashboard's `VIBE_LOCAL_ROOT`. A state-directory lock prevents simultaneous dashboard owners. Stop with Ctrl+C before starting another owner.

Copy `.env.example` to `.env` for dashboard configuration. Set `VIBE_APP_PASSWORD` to require a shared password, or leave it empty for intentional passwordless operation. Dashboard users can manage every runtime and schedule work. Runtime credentials remain required in either mode.

Remote dashboards require `VIBE_PUBLIC_URL=https://your-host.example`. A trusted reverse proxy must preserve the public Host and terminate HTTPS. `VIBE_TRUSTED_PROXY` lists trusted proxy addresses or CIDRs. Unsafe browser requests require the canonical Origin. Login sessions expire after 12 hours; password changes and mode changes invalidate earlier sessions. Login is limited to ten attempts per source and 100 installation-wide per 15 minutes.

Set `VIBE_WORKER_HOST` and `VIBE_WORKER_PORT` for an optional worker-only listener. Route `/api/worker/` at the public origin to either listener. The separate listener exposes no dashboard routes and rejects browser requests.

## Pair and run

Install the standalone executable using the [release guide](docs/releases.md). In **Runtimes**, select **Add new**, copy the pairing command, and execute it on the runner machine. Install and authenticate the harnesses separately. Pairing discovers Codex, Claude Code, OpenCode, and supporting tools on `PATH`, connects to the dashboard, and succeeds after its capability report is acknowledged.

```sh
vibe-runner pair TOKEN
vibe-runner pair status
vibe-runner pair probe
vibe-runner run
vibe-runner run-once
vibe-runner pair revoke
```

For a source checkout, replace `vibe-runner` with `pnpm runner`. The same commands support global `--state-dir PATH`, `--help`, and `--version`. The runner uses a standard private state directory and loads no `.env` file. Preserve standard harness login directories, provider credentials, proxies, certificates, `PATH`, and SSH-agent settings.

Enrollment tokens remain reusable until their ten-minute expiry. Reusing a token preserves its runtime identity and replaces its previous credential. Failed pairing clears all local state in the selected directory. Dashboard history is preserved. An expired token requires a new token.

`pair status` displays the last acknowledged capabilities and timestamp without rescanning. It distinguishes unpaired state, rejected or revoked credentials, and an unreachable dashboard. `pair probe` rescans and uploads; failed delivery preserves the last acknowledged observation. Status and probe remain available during execution. Pairing and revocation require stopping execution first.

`run` recovers saved delivery, refreshes capabilities, waits for assignments, and processes runs sequentially. `run-once` waits for the first assigned run, including when the queue starts empty, and exits after every required report and artifact is acknowledged. Probing proves installed availability and authentication readiness, not model entitlement or successful execution.

Revocation attempts the remote operation, then removes local state regardless of delivery. Its output distinguishes confirmed remote revocation from failure or an unconfirmed result. Dashboard revocation and credential replacement abandon unfinished assigned runs. Accepted results and completed history survive. Connectivity loss alone does not abandon work.

## Author suites and configure runs

Open **Suites** to author any of the ten supported task kinds, criteria, rating controls, ranking guidance, and repository materials. Incomplete drafts can be saved. Every later save requires an explicit minor change or new revision and preserves earlier content. Concurrent edits retain local changes after a conflict until the author reloads.

**Runs** is the default dashboard page. Select an exact suite content version, a paired runtime, tasks, and entrants. Each entrant names its harness, exact model, timeout, and supported settings. Preview the full or partial matrix before creating it. Later suite edits cannot change execution inputs.

**Live** invokes actual harnesses. **Fixture** uses deterministic configured-harness subprocesses and remains labeled fixture evidence. Missing tools or known unsupported capabilities produce skips. Execution errors and missing required outputs produce failures with diagnostics. Other attempts continue.

Repository runs resolve one exact commit and give each attempt an independent checkout. Declare task inputs, required outputs, and browser context in the repository's `vibe-bench.json`. See the [configured-run contract](docs/contracts/configured-runs.md).

Expand **View result** to inspect text, raster images, HTML bundles, changed files and patches, or browser recordings. Downloads retain original bytes. Browser scenarios use a fresh Chromium context and WebM recording. Provision Chromium on runner machines with `pnpm exec playwright install chromium`, or follow the standalone provisioning instructions in the release guide.

## Grade results

Open **Grading**, select a finished run, and navigate its categories and tasks. Inspect each anonymous result and grade it against pinned criteria. Stars, the 0–10 slider, and thumbs preserve the original selection and convert it to a 0–100 grade. Equal grades are allowed. Skip and clear differ from a zero grade. Failed and execution-skipped attempts remain visible without grading controls.

Saved judgments and card order survive reloads and restarts. A grading cookie authorizes that session; its URL alone grants no access. Conflicting changes require reloading. Submitted content can identify its author. The [blind-grading contract](docs/contracts/blind-grading.md) defines anonymous transport and persistence.

## Recovery and preview prerequisites

The runner saves immutable assignments, preparation, attempt starts, terminal reports, and artifacts before upload. Saved delivery retries retain original IDs. Identical replay has one effect; changed accepted content conflicts. A started attempt without a saved terminal result is uncertain and never executes again under its old ID. Recovery reports interruption truthfully.

The server needs Bubblewrap at `/usr/bin/bwrap`, unprivileged user and network namespaces, Playwright Chromium, and browser system libraries and fonts for isolated HTML and media previews. Missing prerequisites show unavailable previews while original downloads remain available. HTML previews render 960 by 640 frames, accept clicks, keyboard input, and text, and allow two concurrent sessions. They expire after 30 seconds idle or two minutes total.

Authentication does not establish deployment readiness. Backups, artifact storage, HTTPS, upload limits, and Chromium isolation need infrastructure verification.

## Verify locally

```sh
pnpm check
pnpm build:runtime
pnpm test:binary
```

Checks exercise schemas, import boundaries, PostgreSQL, HTTP, subprocesses, Chromium, installers, and the compiled executable. State and evidence stay under ignored `.artifacts/`. CI requires `verify (self-hosted Linux)`. Missing or skipped checks are not passing evidence. Fixture checks do not establish live provider access.

## Engineering reference

- [Architecture and module ownership](docs/architecture.md)
- [Verification guidance](docs/verification.md)
- [Suite authoring](docs/contracts/suites.md)
- [Dashboard and runner access](docs/contracts/access.md)
- [Configured execution](docs/contracts/configured-runs.md)
- [Blind grading](docs/contracts/blind-grading.md)
- [Runner protocol](docs/contracts/runner-protocol.md)
- [Result viewing](docs/contracts/artifacts-evaluation.md)
- [Development workflow](docs/agent-workflow.md)
- [Release and installation](docs/releases.md)
