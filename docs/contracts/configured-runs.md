# Configured runs

The executable schemas are `packages/contracts/src/configured-runs.ts`, `task-io.ts`, and `work.ts`. Configured runs have a management API separate from the original two-answer comparison protocol. Their outcomes do not create grades or blind evaluation sessions.

## Configuration and immutable inputs

The dashboard selects an exact saved suite content version, one registered runtime, and one or more entrants. Each entrant records its harness, requested model, and supported settings. Full runs select every task. Partial runs select the union of categories and individual tasks, deduplicated in suite order. A run contains at most 1,000 task and entrant combinations.

Preview and creation use the same matrix calculation. Creation stores the entire suite content, selected task IDs, entrants, source label, and a canonical digest. Later suite edits cannot change that snapshot. Suite revision boundaries still require the author's explicit minor-change or new-revision choice.

Creation accepts a stable request ID. An identical replay returns the original creation result. Changed content under the same request ID conflicts.

## Outbound worker protocol

The runtime initiates every request. The worker API exposes registration, claims, preparation reports, and attempt reports. The separate worker listener rejects browser requests. Runtime and assignment IDs establish record membership, not authentication. Runner authentication remains separate work.

A runtime claims one whole run and executes its attempts in order. One unfinished assignment prevents that runtime from claiming another run. Claims have durable request IDs. Replaying a claim returns the same assignment or idle receipt, even if new work arrived afterward.

Preparation is recorded once before attempts start. Repository preparation records the exact commit and parsed `vibe-bench.json` declarations with their canonical digest. Every attempt starts from that commit in a separate workspace. A failed preparation remains a recorded failure.

Attempt states distinguish queued, assigned, started, and terminal work. Terminal outcomes distinguish completed, skipped before execution, and failed. Reports are saved locally before transmission. The server accepts the report and its receipt in one transaction. Identical delivery returns the original receipt. Conflicting reuse of a report ID or replacement of an accepted outcome fails.

An interrupted attempt may already have called a model. The worker retains its identity and diagnostics and never launches it again under that ID. This protocol has no leases, reassignment, or automatic re-execution.

## Repository task declarations

Suite materials specify only a repository URL and ref. The repository is maintained outside Vibe bench. Its optional `vibe-bench.json` maps task IDs to input paths, required output declarations, and browser starting context. The `RepositoryManifest` schema defines the format.

The suite editor displays each repository task key when repository materials are selected. Use that key in the manifest's `tasks` object. Each entry has `inputs`, `outputs`, and `browser` fields. For example, replace this task key with the one shown in the editor:

```json
{
  "version": 1,
  "tasks": {
    "de973c67-4f66-46e7-bd0f-e1d542452169": {
      "inputs": ["source.txt"],
      "outputs": [],
      "browser": null
    }
  }
}
```

Without a manifest entry, text tasks produce `answer.txt`, image generation requests `result.png`, and HTML tasks request `index.html`. Image editing and understanding require declared input images. Coding tasks require repository materials. Browser tasks require a declared starting context. An explicit manifest entry replaces the defaults.

Browser context is either a pinned local entry file or a remote HTTP or HTTPS URL. The harness produces a bounded `BrowserPlan` with navigation, click, fill, text-check, and screenshot actions. The runtime executes the plan in a fresh Chromium context and records WebM video. Requests remain on the starting origin. This is a supported subset of browser scenarios, not unrestricted browser automation.

## Results and artifacts

The result descriptor records the task's output shape.

| Tasks | Result |
| --- | --- |
| Text generation, text editing, image understanding | Final text |
| Image generation and editing | Image artifact references |
| Static and interactive HTML | Entry-page artifact and local asset references |
| Coding bugfix and feature | Patch artifact and added, modified, or deleted file inventory |
| Browser scenario | WebM recording and screenshot references |

Final answers are separate from diagnostic artifacts. Available raw harness metadata remains diagnostic evidence, without invented usage or cost values. An unavailable capability known before execution produces a skip with a reason. A denial, process error, or missing required output discovered during execution produces a failure. Other attempts continue.

Each artifact records its name, kind, media type, byte count, and SHA-256 digest. Terminal reports carry bounded bytes. The server verifies size, digest, and result associations before storing bytes and accepting the outcome atomically. Total artifact bytes per attempt are limited to 8,000,000. Downloads are inert attachments. HTML bundles do not start application servers or execute in the dashboard.

## Evidence

Fixture runs exercise the same persistence and worker protocol through deterministic subprocesses. Their source label is preserved in the snapshot and dashboard. They do not prove model access. Live runs invoke the selected harness and requested model without substituting another model. Verification records these two evidence categories separately.
