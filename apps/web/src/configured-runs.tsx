import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { ConfigureRun, ConfiguredRunList, ConfiguredRunView, CreateConfiguredRun, RunPreview } from '../../../packages/contracts/src/configured-runs.ts';
import { RegisteredRuntimes } from '../../../packages/contracts/src/runtime.ts';
import { SuiteContent } from '../../../packages/contracts/src/suites.ts';
import { RunSuite } from './run-suite.tsx';
import { EntrantDraft, newEntrant, RunEntrants } from './run-entrants.tsx';
import { RunDetails, RunMatrix } from './run-details.tsx';
import { runRequest } from './run-request.ts';

type Review = { preview: RunPreview; request: CreateConfiguredRun };
const message = (error: unknown) => error instanceof z.ZodError ? error.issues.map((issue) => `${issue.path.join(' › ')}: ${issue.message}`).join('\n') : error instanceof Error ? error.message : 'The request failed. Please try again.';

export function ConfiguredRuns() {
  const [runs, setRuns] = useState<z.infer<typeof ConfiguredRunList>>([]);
  const [runtimes, setRuntimes] = useState<z.infer<typeof RegisteredRuntimes>>([]);
  const [runtimeId, setRuntimeId] = useState('');
  const [content, setContent] = useState<SuiteContent | null>(null);
  const [selection, setSelection] = useState<ConfigureRun['selection']>({ kind: 'all' });
  const [entrants, setEntrants] = useState<EntrantDraft[]>(() => [newEntrant()]);
  const [source, setSource] = useState<ConfigureRun['source']>('live');
  const [review, setReview] = useState<Review | null>(null);
  const [run, setRun] = useState<ConfiguredRunView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const changeContent = useCallback((value: SuiteContent | null) => {
    generation.current++; setContent(value); setSelection({ kind: 'all' }); setReview(null); setError('');
  }, []);
  function changed() { generation.current++; setReview(null); setError(''); }

  useEffect(() => {
    let active = true;
    const id = new URLSearchParams(location.search).get('run');
    void Promise.all([runRequest('/api/configured-runs', ConfiguredRunList), runRequest('/api/runtimes', RegisteredRuntimes), id ? runRequest(`/api/configured-runs/${encodeURIComponent(id)}`, ConfiguredRunView) : null]).then(([list, registered, saved]) => {
      if (!active) return;
      setRuns(list); setRuntimes(registered); setRuntimeId(registered[0]?.registration.runtimeId ?? ''); setRun(saved);
    }).catch((error: unknown) => { if (active) setError(message(error)); }).finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, []);

  async function act(operation: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try { await operation(); } catch (error) { setError(message(error)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function show(value: ConfiguredRunView) { setRun(value); history.replaceState(null, '', `?view=runs&run=${value.runId}`); }
  async function preview() {
    const current = generation.current;
    await act(async () => {
      if (!content) throw new Error('Choose a saved suite version.');
      if (!runtimeId) throw new Error('Register a runtime before starting a run.');
      if (entrants.length === 0 || entrants.some((entrant) => !entrant.model.trim())) throw new Error('Add at least one model and enter a name for each model.');
      if (entrants.some((entrant) => !entrant.timeout || !Number.isFinite(Number(entrant.timeout)) || Number(entrant.timeout) < 0.1 || Number(entrant.timeout) > 3600)) throw new Error('Each model needs a time limit between 0.1 and 3600 seconds.');
      if (selection.kind === 'subset' && selection.categoryIds.length + selection.taskIds.length === 0) throw new Error('Choose at least one category or task.');
      const config = ConfigureRun.parse({ contentId: content.contentId, runtimeId, selection, source, entrants: entrants.map((entrant) => ({ id: entrant.id, harness: entrant.harness, model: entrant.model, settings: { timeoutMs: Number(entrant.timeout) * 1000, ...(entrant.effort ? { [entrant.harness === 'codex' ? 'reasoningEffort' : entrant.harness === 'claude' ? 'effort' : 'variant']: entrant.effort } : {}) } })) });
      const value = await runRequest('/api/configured-runs/preview', RunPreview, config);
      if (current === generation.current) setReview({ preview: value, request: { ...config, requestId: crypto.randomUUID() } });
    });
  }
  const selectedRuntime = runtimes.find((runtime) => runtime.registration.runtimeId === runtimeId);
  return <section aria-label="Run management">
    {run ? <>
      <div className="editor-actions"><button className="back" disabled={busy} onClick={() => { setRun(null); setReview(null); history.replaceState(null, '', '?view=runs'); void act(async () => setRuns(await runRequest('/api/configured-runs', ConfiguredRunList))); }}>All configured runs</button>
        <button className="secondary" disabled={busy} onClick={() => void act(async () => show(await runRequest(`/api/configured-runs/${run.runId}`, ConfiguredRunView)))}>Refresh results</button></div>
      <RunDetails run={run}/>
    </> : <>
      <div className="eyebrow">RUN YOUR SUITE</div><h1>Choose the work.<br/>Choose the models.</h1>
      <p className="intro">Select a saved suite, preview every task and model pairing, then send the run to a registered runtime.</p>
      <form onSubmit={(event) => { event.preventDefault(); void preview(); }}>
        <RunSuite disabled={busy || !loaded} content={content} onChange={changeContent}/>
        <fieldset disabled={busy || !loaded} className="run-inputs"><legend>2. Choose a runtime</legend>
          <label>Runtime<select value={runtimeId} onChange={(event) => { changed(); setRuntimeId(event.target.value); }}><option value="">Choose a runtime</option>{runtimes.map(({ registration }) => <option key={registration.runtimeId} value={registration.runtimeId}>{registration.machine.platform} {registration.machine.architecture} · {registration.runtimeId.slice(0, 8)}</option>)}</select></label>
          {selectedRuntime && <p className="field-help">Last seen {new Date(selectedRuntime.receivedAt).toLocaleString()}. Codex {selectedRuntime.registration.harnesses.codex.kind}, Claude Code {selectedRuntime.registration.harnesses.claude.kind}, OpenCode {selectedRuntime.registration.harnesses.opencodeGo.kind}.</p>}
          {loaded && runtimes.length === 0 && <p>No runtimes are registered. Register a runtime to make it available here.</p>}
        </fieldset>
        <fieldset disabled={busy || !loaded} className="run-inputs"><legend>3. Choose tasks</legend>
          <label className="inline"><input type="radio" name="selection" checked={selection.kind === 'all'} onChange={() => { changed(); setSelection({ kind: 'all' }); }}/>All tasks</label>
          <label className="inline"><input type="radio" name="selection" checked={selection.kind === 'subset'} onChange={() => { changed(); setSelection({ kind: 'subset', categoryIds: [], taskIds: [] }); }}/>Choose categories or tasks</label>
          {selection.kind === 'subset' && content?.definition.categories.map((category) => <fieldset key={category.id}><legend>{category.title}</legend>
            <label className="inline"><input type="checkbox" checked={selection.categoryIds.includes(category.id)} onChange={(event) => { changed(); setSelection({ ...selection, categoryIds: event.target.checked ? [...selection.categoryIds, category.id] : selection.categoryIds.filter((id) => id !== category.id) }); }}/>All tasks in {category.title}</label>
            {category.tasks.map((task) => <label key={task.id}><input type="checkbox" disabled={selection.categoryIds.includes(category.id)} checked={selection.categoryIds.includes(category.id) || selection.taskIds.includes(task.id)} onChange={(event) => { changed(); setSelection({ ...selection, taskIds: event.target.checked ? [...selection.taskIds, task.id] : selection.taskIds.filter((id) => id !== task.id) }); }}/>{task.title}</label>)}
          </fieldset>)}
        </fieldset>
        <RunEntrants disabled={busy || !loaded} entrants={entrants} onChange={(value) => { changed(); setEntrants(value); }}/>
        <fieldset disabled={busy || !loaded} className="run-inputs"><legend>5. Execution mode</legend><label>Mode<select value={source} onChange={(event) => { changed(); setSource(event.target.value === 'fixture' ? 'fixture' : 'live'); }}><option value="live">Live models</option><option value="fixture">Fixture demo, no model calls</option></select></label>
          <p className="field-help">{source === 'live' ? 'Uses the selected runtime and its model access.' : 'Deterministic test results. This mode does not verify model access or answer quality.'}</p>
        </fieldset>
        <button type="submit" disabled={busy || !loaded}>Preview run</button>
      </form>
      {review && <><RunMatrix preview={review.preview}/><button disabled={busy} onClick={() => void act(async () => { show(await runRequest('/api/configured-runs', ConfiguredRunView, review.request)); setReview(null); })}>Start run</button></>}
      <section aria-label="Recent configured runs"><div className="run-heading"><h2>Recent runs</h2><button className="back" disabled={busy} onClick={() => void act(async () => setRuns(await runRequest('/api/configured-runs', ConfiguredRunList)))}>Refresh list</button></div>
        {loaded && runs.length === 0 && <p>No configured runs yet.</p>}{runs.map((item) => <article className="run" key={item.runId}><div><h3>{item.title}</h3><p>{item.source === 'fixture' ? 'Fixture demo' : 'Live models'} · {item.status} · {item.terminal} / {item.attempts} attempts finished</p><p>{new Date(item.createdAt).toLocaleString()}</p></div><button disabled={busy} onClick={() => void act(async () => show(await runRequest(`/api/configured-runs/${item.runId}`, ConfiguredRunView)))}>Open run</button></article>)}
      </section>
    </>}
    {(busy || !loaded) && <p role="status">Loading…</p>}{error && <p role="alert" className="error">{error}</p>}
  </section>;
}
