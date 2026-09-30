# Verify implemented behavior

## Current state

No application code, tests, package scripts, or CI workflow exist yet. The engineering documents describe the intended design; their presence does not verify that design.

As code is introduced, document actual setup, run, migration, and test commands in the README and relevant module. Do not list placeholder commands as working tools.

## Match evidence to the change

Use deterministic fixture executables for repeatable runner checks. They may replace an external model, but not the runner process, HTTP transport, database, or browser behavior being tested.

| Boundary | Behavior to verify |
| --- | --- |
| Snapshots | Suite edits cannot change saved execution inputs; start uses the previewed content |
| Materials | Attempts use the accepted commit and independent writable workspaces |
| Reports | Duplicate delivery has one effect; changed content under an existing ID conflicts |
| Ownership | Stale workers cannot renew or publish after authority changes |
| Capacity | Concurrent claims cannot reserve the same slot or exceed capacity |
| Cancellation | Descendant processes terminate on Windows and Linux |
| Collection | Paths cannot escape the workspace; required outputs are verified |
| Viewing | Active artifacts cannot access application credentials or parent state |
| Blind responses | Identities do not leak through JSON, errors, headers, filenames, or asset URLs |
| Judgments | Selections remain attached to the correct result/configuration across reload and edits |
| Telemetry | Missing and estimated values remain distinguishable from reported measurements |

Use real PostgreSQL transactions for persistence and concurrency tests. Use real processes for cancellation and real browser requests for viewer isolation. Test migrations from an empty database and the previous supported schema. Reopen persisted records after restart.

## Fixtures and live integrations

Version parser fixtures and record their origin. Fixture success does not prove that the installed harness can access a requested model.

When a change requires live integration evidence, use a bounded run and record executable version, model, relevant settings, and outcome. Missing credentials or inaccessible models leave that obligation unverified. Do not substitute another model silently or treat a skipped live check as success.

Product quality judgments remain separate from software tests and execution success.

## Local and CI execution

Keep development state, database names, ports, and artifact directories isolated per worktree. Commands must run noninteractively, report readiness for the actual instance, and exit nonzero on failure.

Exercise the Linux server and both Windows/Linux runner implementations in CI. Keep routine CI independent of model credentials. Check imports, schemas, and generated-contract drift where relevant.

Record exact commands, platform, reviewed commit, and useful evidence in the PR. Clearly label anything not verified. A required job that is missing, cancelled, or unexpectedly skipped is not a passing gate.

Store logs, traces, screenshots, and test reports under ignored `.artifacts/` and publish relevant evidence as CI artifacts. Never commit credentials, resume secrets, or private task materials. Update this guide alongside the executable checks it describes.
