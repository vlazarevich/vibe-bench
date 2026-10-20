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

### Run a production build

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

`pnpm build` writes web assets to `dist/web` and the bundled dashboard process to `dist/server`. `pnpm start` runs `dist/server/serve.mjs` and loads `.env` if present. The bundle resolves its assets and migrations relative to itself, so the working directory does not matter. It still needs the installed `node_modules` for embedded PostgreSQL and preview Chromium.

Set `DATABASE_URL` to use an external PostgreSQL 18 database; `POSTGRES_URL` is accepted as a fallback name. External mode starts no embedded database, creates no `VIBE_LOCAL_ROOT` state, and takes no state-directory lock, so several dashboard processes may share one database. Interactive HTML preview sessions stay with the process that created them, so a load balancer must keep a browser on one process. Startup migrations hold a PostgreSQL advisory lock. Run `pnpm migrate` to apply migrations before starting traffic. Without `DATABASE_URL`, the dashboard owns embedded PostgreSQL under `VIBE_LOCAL_ROOT` as described above.

The dashboard listens on `VIBE_HOST` (default `127.0.0.1`) and `VIBE_PORT` (default: a free port). A non-loopback `VIBE_HOST` requires `VIBE_APP_PASSWORD`; the dashboard refuses to start without it. The Host check blocks DNS rebinding in browsers but not scripted clients, so the password is the access control. Remote browsers also need `VIBE_PUBLIC_URL`. `GET /api/health` returns 200 after the database connection and listener are ready.

Copy `.env.example` to `.env` for dashboard configuration. Set `VIBE_APP_PASSWORD` to require a shared password, or leave it empty for intentional passwordless operation. Dashboard users can manage every runtime and schedule work. Runtime credentials remain required in either mode.

Remote dashboards require `VIBE_PUBLIC_URL=https://your-host.example`. A trusted reverse proxy must preserve the public Host and terminate HTTPS. `VIBE_TRUSTED_PROXY` lists trusted proxy addresses or CIDRs. Unsafe browser requests require the canonical Origin. Login sessions expire after 12 hours; password changes and mode changes invalidate earlier sessions. Login is limited to ten attempts per source and 100 installation-wide per 15 minutes.

Set `VIBE_WORKER_HOST` and `VIBE_WORKER_PORT` for an optional worker-only listener. Route `/api/worker/` at the public origin to either listener. The separate listener exposes no dashboard routes and rejects browser requests.

## Pair and run

Install the standalone executable using the [release guide](docs/releases.md). In **Runtimes**, select **Connect runtime**, copy the pairing command, and execute it on the runner machine. Install and authenticate the harnesses separately. Pairing discovers Codex, Claude Code, OpenCode, and supporting tools on `PATH`, connects to the dashboard, and succeeds after its capability report is acknowledged.

```sh
vibe-runner pair TOKEN
vibe-runner pair status
vibe-runner pair probe
vibe-runner run
vibe-runner run-once
vibe-runner pair revoke
```

For a source checkout, replace `vibe-runner` with `pnpm runner`. The same commands support global `--state-dir PATH`, `--help`, and `--version`. The runner uses a standard private state directory and loads no `.env` file. Preserve standard harness login directories, provider credentials, proxies, certificates, `PATH`, and SSH-agent settings.

Enrollment tokens are single-use and expire after 15 minutes. Exact retries reuse a private durable exchange after a lost response. Failed pairing retains only that pending exchange for retry; a different token replaces it. Successful pairing removes the pending secret. Use a fresh replacement token to rotate credentials for an existing runtime. Dashboard history is preserved. An expired token requires a new token.

`pair status` displays the last acknowledged capabilities and timestamp without rescanning. It distinguishes unpaired state, rejected or revoked credentials, and an unreachable dashboard. `pair probe` rescans and uploads; failed delivery preserves the last acknowledged observation. Status and probe remain available during execution. Pairing and revocation require stopping execution first.

`run` recovers saved delivery, refreshes capabilities, waits for assignments, and processes runs sequentially. `run-once` waits for the first assigned run, including when the queue starts empty, and exits after every required report and artifact is acknowledged. Probing proves installed availability and authentication readiness, not model entitlement or successful execution.

Revocation attempts the remote operation, then removes local state regardless of delivery. Its output distinguishes confirmed remote revocation from failure or an unconfirmed result. Dashboard revocation and credential replacement abandon unfinished assigned runs. Accepted results and completed history survive. Connectivity loss alone does not abandon work.

## Author suites and configure runs

Open **Suites** to author any of the ten supported task kinds, criteria, rating controls, and repository materials. Incomplete drafts can be saved. Minor saves replace the current revision; a new revision preserves the previous revision in History. Existing runs retain their immutable inputs. Concurrent edits retain local changes after a conflict until the author reloads.

**Runs** is the default dashboard page. Select a suite revision, a paired runtime, and entrants. The revision picker uses the latest save in each revision. Each entrant selects its harness, a runtime-discovered model, and supported effort setting. New runs use all tasks, live execution, and a two-minute per-entrant timeout. Task subsets, fixture execution, custom timeouts, and matrix preview remain available through the API. Run again uses the latest saved content within the selected revision and preserves execution options; fixture repeats display a read-only notice. Later suite edits cannot change execution inputs.

**Live** invokes actual harnesses. **Fixture** uses deterministic configured-harness subprocesses and remains labeled fixture evidence. Missing tools or known unsupported capabilities produce skips. Execution errors and missing required outputs produce failures with diagnostics. Other attempts continue.

Repository runs resolve one exact commit and give each attempt an independent checkout. Declare task inputs, required outputs, and browser context in the repository's `vibe-bench.json`. See the [configured-run contract](docs/contracts/configured-runs.md).

Expand **View result** to inspect text, raster images, HTML bundles, changed files and patches, or browser recordings. Downloads retain original bytes. Browser scenarios use a fresh Chromium context and WebM recording. Provision Chromium on runner machines with `pnpm exec playwright install chromium`, or follow the standalone provisioning instructions in the release guide.

## Grade results

In **Runs**, select **Start grading** on a finished run or a stopped run with accepted results. Create a named grading or share its neutral invitation link. Navigate categories and tasks, with one result at a time or two distinct results side by side. Inspect each anonymous result and grade it against pinned criteria. Stars, the 0–100 slider, and thumbs preserve the original selection and convert it to a 0–100 grade. Equal grades are allowed. Skip and clear differ from a zero grade. Failed and execution-skipped attempts remain visible without grading controls.

Selections autosave. Saved judgments and shuffled card order survive reloads and restarts. Submit a complete or partial grading to freeze it and reveal the entrants. Multiple gradings per run remain independent; others can view submitted gradings read-only. A grading cookie authorizes a session; its URL alone grants no access. A shared invitation permits a new blind grading without dashboard management access. Conflicting changes require reloading. Submitted content can identify its author. The [blind-grading contract](docs/contracts/blind-grading.md) defines anonymous transport and persistence.

## Results and model metadata

**Results** aggregates submitted grades with UTC date presets, family, class, license, harness, effort, suite, task-type, filters. Pivot by model, suite, or task. Scores normalize to 0–100, average within each category, then weight categories equally. Skips and missing judgments contribute no score; zero grades do. Cells with fewer than 20 grades show low confidence. The dashboard shows live results only; the API keeps fixture and live evidence separate.

Set `ARTIFICIAL_ANALYSIS_API_KEY` on the dashboard for the daily cached Artificial Analysis catalog. Pro metadata provides license, size, context, and modalities when disclosed. The Free endpoint supplies names and creators but omits much of that metadata; unknown values stay unknown. See the [Results contract](docs/contracts/results.md) for matching and size-class derivation. The key never enters runner subprocesses.

## Recovery and preview prerequisites

The runner saves immutable assignments, preparation, attempt starts, terminal reports, and artifacts before upload. Saved delivery retries retain original IDs. Identical replay has one effect; changed accepted content conflicts. A started attempt without a saved terminal result is uncertain and never executes again under its old ID. Recovery reports interruption truthfully.

The server needs Bubblewrap at `/usr/bin/bwrap`, unprivileged user and network namespaces, Playwright Chromium, and browser system libraries and fonts for isolated HTML and media previews. Missing prerequisites show unavailable previews while original downloads remain available. HTML previews start at 960 by 640 and support desktop (1280×800), tablet (768×900), and mobile (390×844) viewports, clicks, keyboard input, and text. Two concurrent sessions are allowed. They expire after 30 seconds idle or two minutes total.

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
- [Results and model catalog](docs/contracts/results.md)
- [Runner protocol](docs/contracts/runner-protocol.md)
- [Result viewing](docs/contracts/artifacts-evaluation.md)
- [Development workflow](docs/agent-workflow.md)
- [Release and installation](docs/releases.md)
