import { ConfiguredRunView, RunPreview } from '../../../packages/contracts/src/configured-runs.ts';

export function RunMatrix({ preview }: { preview: RunPreview }) {
  return <section aria-label="Execution plan"><h2>Execution plan</h2><p>{preview.snapshot.selectedTaskIds.length} tasks · {preview.snapshot.entrants.length} models · {preview.matrix.length} attempts</p>
    <div className="table-scroll"><table><thead><tr><th>Task</th><th>Type</th><th>Model</th><th>Runner</th></tr></thead><tbody>{preview.matrix.map((slot) => {
      const entrant = preview.snapshot.entrants.find((entrant) => entrant.id === slot.entrantId);
      return <tr key={`${slot.taskId}-${slot.entrantId}`}><td>{slot.taskTitle}</td><td>{slot.kind.replaceAll('-', ' ')}</td><td>{entrant?.model}</td><td>{entrant?.harness}</td></tr>;
    })}</tbody></table></div>
  </section>;
}

export function RunDetails({ run }: { run: ConfiguredRunView }) {
  const { snapshot } = run;
  const tasks = snapshot.content.definition.categories.flatMap((category) => category.tasks);
  return <section aria-label="Saved run">
    <div className="eyebrow">{snapshot.source === 'fixture' ? 'FIXTURE DEMO · NO MODEL CALLS' : 'LIVE MODEL EXECUTION'}</div>
    <h1>{snapshot.content.definition.title}</h1>
    <p>Revision {snapshot.content.revision} · Content {snapshot.content.ordinal} · {run.status}</p>
    <p className="field-help">These saved inputs stay unchanged when the suite is edited. Results identify the model and are for run management.</p>
    {run.status === 'queued' && <p role="status">Waiting for the selected runtime to collect this run. Start its worker to continue.</p>}
    {run.preparation?.kind === 'failed' && <p role="alert" className="error">Materials could not be prepared. {run.preparation.reason}</p>}
    <section aria-label="Attempt results"><h2>Task results</h2>{run.attempts.map((attempt) => {
      const task = tasks.find((task) => task.id === attempt.taskId);
      const entrant = snapshot.entrants.find((entrant) => entrant.id === attempt.entrantId);
      const outcome = attempt.state.kind === 'terminal' ? attempt.state.outcome : null;
      return <article className="attempt" key={attempt.attemptId}>
        <h3>{task?.title} <span className="attempt-status">{outcome?.kind ?? attempt.state.kind}</span></h3>
        <p>{entrant?.model} · {entrant?.harness}</p>
        {outcome && <p className={outcome.kind === 'completed' ? '' : 'failure'}>{outcome.kind === 'completed' ? outcome.summary : outcome.reason}</p>}
        {outcome && <section aria-label={`Downloads for ${task?.title} with ${entrant?.model}`}>
          <h4>Downloads</h4>{outcome.artifacts.length === 0 ? <p>No files were produced.</p> : <ul>{outcome.artifacts.map((artifact) => <li key={artifact.id}><a download href={`/api/configured-runs/${run.runId}/artifacts/${artifact.id}`}>{artifact.name}</a> <span className="field-help">{artifact.kind} · {artifact.mediaType} · {artifact.bytes.toLocaleString()} bytes</span></li>)}</ul>}
        </section>}
      </article>;
    })}</section>
    <details><summary>Saved tasks and evaluation criteria</summary>{tasks.filter((task) => snapshot.selectedTaskIds.includes(task.id)).map((task) => <section key={task.id}><h3>{task.title}</h3><p>{task.prompt}</p>{task.criterionIds.map((id) => {
      const criterion = snapshot.content.definition.evaluation.criteria.find((criterion) => criterion.id === id);
      return criterion && <p key={id}><strong>{criterion.title}</strong> · {criterion.control}<br/>{criterion.instructions}</p>;
    })}</section>)}</details>
    <details><summary>Saved model settings</summary>{snapshot.entrants.map((entrant) => <section key={entrant.id}><h3>{entrant.model} · {entrant.harness}</h3><p>Time limit {entrant.settings.timeoutMs / 1000} seconds</p>
      <p>{entrant.harness === 'codex' ? `Reasoning effort ${entrant.settings.reasoningEffort ?? 'Provider default'}` : entrant.harness === 'claude' ? `Reasoning effort ${entrant.settings.effort ?? 'Provider default'}` : `Model variant ${entrant.settings.variant ?? 'Provider default'}`}</p>
    </section>)}</details>
  </section>;
}
