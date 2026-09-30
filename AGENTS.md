# Working on Vibe bench

## Start with the current task

The current task prompt supplies product requirements, scope, and acceptance criteria. Use repository code, tests, and engineering documentation to understand the system. Do not reconstruct a backlog from old documents or copy task specifications into the repo.

If the task conflicts with an existing contract, identify the conflict. Update the contract and its tests when the task authorizes a behavior change. Ask only when intent remains ambiguous.

Read [architecture.md](docs/architecture.md) to locate the owner, then read the relevant code, contract, and [verification guidance](docs/verification.md). Do not load every document for every task.

The repository implements a local text comparison loop. Follow the working commands in the README and the executable schemas in `packages/contracts/src`. Broader design contracts remain guidance for features not implemented yet.

## Workflow

The initial architecture setup is the sole exception allowing work on main. Every later change requires both a separate `codex/<description>` branch and a separate worktree, followed by a PR. The user authorizes automatic merging after required checks and independent review pass. Follow [agent-workflow.md](docs/agent-workflow.md). A current instruction to hold commits or merges takes precedence.

Give parallel writers separate worktrees, databases, ports, and local state directories. One agent owns a PR. Coordinate shared contract and migration changes before dependent work.

## Engineering rules

- Keep operations, queries, and tests with the feature that owns their invariants. Avoid generic controller/service/repository layers.
- Validate external data with schemas and infer TypeScript types. Use distinct ID types, discriminated unions, and exhaustive handling.
- Keep framework objects and database rows inside their owning module. Enforce application import boundaries with tooling as code is introduced.
- Preserve immutable execution inputs and prior attempt outcomes. Resolve retries, duplicate reports, and concurrent writes explicitly.
- Keep runner credentials outside attempt workspaces. Construct blind evaluation responses from an explicit schema.
- Test observable behavior using real persistence, HTTP, subprocesses, or browsers where those boundaries matter.
- Distinguish deterministic fixture evidence from actual model access and live harness behavior. Missing access is not a passing test.
- Update affected contracts, navigation, and working commands in the same PR. Generate schema reference from code where possible.
- Keep temporary task notes and generated evidence under ignored `.local/` or `.artifacts/`. Store useful change summaries in PRs, not a second project plan.
