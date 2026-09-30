# Deliver an engineering change

## Use the supplied requirements

The current task prompt owns the requested behavior and acceptance criteria. Read it alongside the relevant code and contract. Keep temporary working notes under ignored `.local/`; do not create a repository backlog or periodically copy external requirements.

If an authorized change alters an engineering contract, update that contract and its tests in the same PR. If the request is ambiguous, identify the specific decision needed rather than inventing product policy.

## Isolate the work

The initial architecture setup is the only exception allowing edits on main. Later changes use both a separate `codex/<description>` branch and a separate worktree.

After the initial commit exists on origin/main, create a worktree from the latest main. Inspect existing worktrees before creating or reusing one. Never overwrite another agent's work.

Give each writer its own database, ports, local state, and artifact directory. Coordinate changes to shared contracts and migrations before dependent work.

## Implement and open a PR

Keep the PR focused on a verifiable behavior change. Run relevant checks from the current repository instructions. Distinguish deterministic tests from any live evidence the change requires.

Create a PR after completing the unit. Use the [PR template](../.github/pull_request_template.md) to describe the behavior and evidence. Summarize the supplied acceptance criteria as needed for review without copying the backlog into the repo.

Use a body file for multiline CLI descriptions. Attach the PR to the current chat when supported.

## Review and automatic merge

Automatic merging is authorized after required checks and independent review pass. An explicit instruction to hold commits or merges takes precedence.

Review the current head, resolve blocking findings, and rerun affected checks after substantive changes. Before merging, verify that all expected checks exist and pass on that head, required live evidence is present, and the branch satisfies the repository's current merge policy. An empty required-check list is not success.

Until branch protection is configured, compare actual checks against the project's documented CI requirements. Do not bypass failures with administrator privileges.

Guard the merge against a changed head:

```sh
gh pr merge <number> --squash --match-head-commit <reviewed-head-sha> --delete-branch
```

Verify that the PR merged and record the merge commit. Refresh main before dependent work. A pending auto-merge request is not a completed merge.

Inspect worktree status and merged ancestry before cleanup. Preserve uncommitted work and use the managing tool for managed worktrees.

## Handle blocks honestly

Record missing access, ambiguous requirements, or unavailable external services with sanitized evidence and the next needed action. Continue independent authorized work when possible.

Source PR authorization does not authorize purchasing services, changing account permissions, deploying services, or messaging people.
