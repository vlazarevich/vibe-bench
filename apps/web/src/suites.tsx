import { useEffect, useState } from 'react';
import { z } from 'zod';
import { assessDefinition, Category, CategoryId, Criterion, CriterionId, Definition, RankingRuleId, RatingControl, RatingSelection, SuiteContent, SuiteHistory, SuiteList, SuiteView, TaskDefinition, TaskId, TaskKind, toGrade } from '../../../packages/contracts/src/suites.ts';

async function request<T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
  const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const value: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ error: z.string(), issues: z.array(z.object({ path: z.array(z.union([z.string(), z.number()])), message: z.string() })).optional() }).parse(value);
    throw new Error(error.issues ? error.issues.map((issue) => `${issue.path.join('.') || 'Suite'}: ${issue.message}`).join('\n') : error.error);
  }
  return schema.parse(value);
}
const blankDefinition = (): Definition => ({ title: '', description: '', categories: [], evaluation: { conversion: 'rating-control-v1', criteria: [], rankingRules: [] }, materials: { kind: 'none' } });
const newTask = (): z.infer<typeof TaskDefinition> => ({ id: TaskId.parse(crypto.randomUUID()), title: '', kind: 'text-generation', prompt: '', criterionIds: [] });
const labels: Record<z.infer<typeof TaskKind>, string> = { 'text-generation': 'Text generation', 'text-editing': 'Text editing', 'image-generation': 'Image generation', 'image-editing': 'Image editing', 'image-understanding': 'Image understanding', 'html-static': 'Static HTML page design', 'html-interactive': 'Interactive HTML page design', 'coding-bugfix': 'Coding bugfix', 'coding-feature': 'Coding new feature', 'browser-scenario': 'Browser use scenario' };
const controlLabels: Record<z.infer<typeof RatingControl>, string> = { 'stars-5': '5 stars', 'slider-10': '0–10 slider', thumbs: 'Thumbs up / down' };
function fieldName(path: PropertyKey[]): string {
  const names: Record<string, string> = { categories: 'Category', tasks: 'Task', criteria: 'Criterion', rankingRules: 'Ranking rule', criterionIds: 'Assigned criteria', requestedRef: 'Requested ref', url: 'Repository URL' };
  return path.filter((part) => part !== 'evaluation').map((part) => typeof part === 'number' ? String(part + 1) : names[String(part)] ?? String(part)).join(' › ') || 'Suite';
}
function ContentDetails({ content }: { content: SuiteContent }) {
  const definition = content.definition;
  return <details open><summary>Saved content {content.ordinal}, revision {content.revision}</summary>
    <h3>{definition.title || 'Untitled draft'}</h3><p>{definition.description}</p>
    {definition.categories.map((category) => <section key={category.id}><h3>{category.title || 'Untitled category'}</h3>{category.tasks.map((task) => <article key={task.id}><h4>{task.title || 'Untitled task'} · {labels[task.kind]}</h4><p>{task.prompt || 'No prompt yet'}</p><p>Criteria: {task.criterionIds.map((id) => definition.evaluation.criteria.find((criterion) => criterion.id === id)?.title || 'Untitled criterion').join(', ') || 'None assigned'}</p></article>)}</section>)}
    <h3>Evaluation criteria</h3>{definition.evaluation.criteria.map((criterion) => <article key={criterion.id}><h4>{criterion.title || 'Untitled criterion'} · {controlLabels[criterion.control]}</h4><p>{criterion.instructions}</p></article>)}
    <h3>Ranking guidance</h3>{definition.evaluation.rankingRules.length ? definition.evaluation.rankingRules.map((rule) => <article key={rule.id}><h4>{rule.title || 'Untitled rule'}</h4><p>{rule.instructions}</p></article>) : <p>No ranking rules</p>}
    <h3>Materials</h3><p>{definition.materials.kind === 'repository' ? `${definition.materials.url} · ${definition.materials.requestedRef}` : 'None'}</p>
    <p>Saved {new Date(content.createdAt).toLocaleString()}</p>
  </details>;
}

function RatingPreview({ criterion }: { criterion: z.infer<typeof Criterion> }) {
  const [selection, setSelection] = useState<z.infer<typeof RatingSelection> | null>(null);
  const active = selection?.control === criterion.control ? selection : null;
  return <fieldset className="rating-preview"><legend>Rating preview</legend>
    {criterion.control === 'stars-5' && [1, 2, 3, 4, 5].map((value) => <label className="inline" key={value}><input type="radio" name={`preview-${criterion.id}`} checked={active?.value === value} onChange={() => setSelection({ control: 'stars-5', value })}/>{value} {value === 1 ? 'star' : 'stars'}</label>)}
    {criterion.control === 'slider-10' && <label>Slider value<input type="range" min="0" max="10" step="1" value={active && typeof active.value === 'number' ? active.value : 0} onChange={(event) => setSelection({ control: 'slider-10', value: Number(event.target.value) })}/></label>}
    {criterion.control === 'slider-10' && !active && <button type="button" className="secondary" onClick={() => setSelection({ control: 'slider-10', value: 0 })}>Use zero rating</button>}
    {criterion.control === 'thumbs' && [false, true].map((value) => <label className="inline" key={String(value)}><input type="radio" name={`preview-${criterion.id}`} checked={active?.value === value} onChange={() => setSelection({ control: 'thumbs', value })}/>{value ? 'Thumbs up' : 'Thumbs down'}</label>)}
    <output aria-live="polite">{active ? `Grade: ${toGrade(active)} / 100` : 'Ungraded'}</output>
    {active && <button type="button" className="back" onClick={() => setSelection(null)}>Clear preview</button>}
  </fieldset>;
}

export function Suites() {
  const [list, setList] = useState<z.infer<typeof SuiteList>>([]);
  const [saved, setSaved] = useState<SuiteView | null>(null);
  const [draft, setDraft] = useState<Definition | null>(null);
  const [history, setHistory] = useState<z.infer<typeof SuiteHistory>>([]);
  const [historical, setHistorical] = useState<SuiteContent | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  async function refresh() { setList(await request('/api/suites', SuiteList)); }
  async function open(id: string) {
    setBusy(true);
    try {
      const [value, versions] = await Promise.all([request(`/api/suites/${id}`, SuiteView), request(`/api/suites/${id}/history`, SuiteHistory)]);
      setSaved(value); setDraft(value.content.definition); setHistorical(null); setError(''); setStatus(''); setHistory(versions);
      window.history.replaceState(null, '', `?view=suites&suite=${id}`);
    } finally { setBusy(false); }
  }
  useEffect(() => {
    setBusy(true);
    const id = new URLSearchParams(location.search).get('suite');
    void (async () => { await refresh(); if (id) await open(id); })().catch((error: unknown) => setError(String(error))).finally(() => setBusy(false));
  }, []);
  async function save(change?: 'minor' | 'revision') {
    if (!draft || (saved && !change)) return;
    setBusy(true); setError(''); setStatus('');
    try {
      const definition = Definition.parse(draft);
      const value = saved ? await request(`/api/suites/${saved.content.suiteId}`, SuiteView, { expectedContentId: saved.content.contentId, change, definition }) : await request('/api/suites', SuiteView, { definition });
      setSaved(value); setDraft(value.content.definition); setHistorical(null);
      setStatus(value.assessment.kind === 'ready' ? 'Suite saved. Ready for supported execution.' : 'Draft saved. Complete the listed fields before execution.');
      window.history.replaceState(null, '', `?view=suites&suite=${value.content.suiteId}`);
      setHistory(await request(`/api/suites/${value.content.suiteId}/history`, SuiteHistory)); await refresh();
    } catch (error) { setError(error instanceof z.ZodError ? error.issues.map((issue) => `${issue.path.join('.') || 'Suite'}: ${issue.message}`).join('\n') : error instanceof Error ? error.message : 'Could not save suite'); }
    finally { setBusy(false); }
  }
  function updateCategory(index: number, category: z.infer<typeof Category>) {
    if (draft) setDraft({ ...draft, categories: draft.categories.map((value, i) => i === index ? category : value) });
  }
  function updateCriterion(index: number, criterion: z.infer<typeof Criterion>) {
    if (draft) setDraft({ ...draft, evaluation: { ...draft.evaluation, criteria: draft.evaluation.criteria.map((value, i) => i === index ? criterion : value) } });
  }
  function exportTask(taskId: z.infer<typeof TaskId>) {
    if (!saved) return;
    const blob = new Blob([JSON.stringify({ content: saved.content, taskId }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = `suite-${saved.content.ordinal}-${taskId}.json`; anchor.click(); URL.revokeObjectURL(url);
  }
  const parsed = draft ? Definition.safeParse(draft) : null;
  const assessment = parsed?.success ? assessDefinition(parsed.data) : null;
  const unsaved = saved && JSON.stringify(draft) !== JSON.stringify(saved.content.definition);
  return <section aria-label="Suite authoring">
    <h1>Suites</h1><p className="intro">Author tasks and evaluation guidance. Every save preserves earlier content and run inputs.</p>
    {!draft ? <>
      <button disabled={busy} onClick={() => { setDraft(blankDefinition()); setSaved(null); setHistory([]); setError(''); setStatus(''); }}>New suite</button>
      <div className="runs">{list.map((item) => <article className="run" key={item.suiteId}><div><h2>{item.title || 'Untitled draft'}</h2><p>Revision {item.revision} · Content {item.ordinal}</p></div><button disabled={busy} onClick={() => void open(item.suiteId).catch((error: unknown) => setError(String(error)))}>Edit suite</button></article>)}</div>
    </> : <>
      <div className="editor-actions"><button disabled={busy} className="back" onClick={() => { setDraft(null); setSaved(null); setHistorical(null); setStatus(''); setError(''); window.history.replaceState(null, '', '?view=suites'); }}>All suites</button>
        {saved && <button className="secondary" disabled={busy} onClick={() => void open(saved.content.suiteId).catch((error: unknown) => setError(String(error)))}>Reload latest and discard local edits</button>}</div>
      <p>{saved ? `Revision ${saved.content.revision} · Content ${saved.content.ordinal}` : 'New draft'}</p>
      <fieldset disabled={busy} className="suite-editor"><legend>Suite definition</legend>
        <label>Suite title<input maxLength={120} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })}/></label>
        <label>Description<textarea maxLength={20_000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })}/></label>
        <h2>Evaluation criteria</h2><p>Assign reusable criteria to tasks. Previews convert a single rating to a 0–100 grade. Judgments and aggregate ranking are not collected here.</p>
        {draft.evaluation.criteria.map((criterion, i) => <fieldset key={criterion.id}><legend>Criterion {i + 1}</legend>
          <label>Criterion title<input maxLength={120} value={criterion.title} onChange={(event) => updateCriterion(i, { ...criterion, title: event.target.value })}/></label>
          <label>Criterion guidance<textarea maxLength={20_000} value={criterion.instructions} onChange={(event) => updateCriterion(i, { ...criterion, instructions: event.target.value })}/></label>
          <label>Rating control<select value={criterion.control} onChange={(event) => updateCriterion(i, { ...criterion, control: RatingControl.parse(event.target.value) })}>{RatingControl.options.map((control) => <option key={control} value={control}>{controlLabels[control]}</option>)}</select></label>
          <RatingPreview criterion={criterion}/>
          <button className="secondary" onClick={() => setDraft({ ...draft, evaluation: { ...draft.evaluation, criteria: draft.evaluation.criteria.filter((value) => value.id !== criterion.id) }, categories: draft.categories.map((category) => ({ ...category, tasks: category.tasks.map((task) => ({ ...task, criterionIds: task.criterionIds.filter((id) => id !== criterion.id) })) })) })}>Remove criterion and assignments</button>
        </fieldset>)}
        <button onClick={() => setDraft({ ...draft, evaluation: { ...draft.evaluation, criteria: [...draft.evaluation.criteria, { id: CriterionId.parse(crypto.randomUUID()), title: '', instructions: '', control: 'stars-5' }] } })}>Add criterion</button>
        <h2>Categories and tasks</h2>
        {draft.categories.map((category, i) => <fieldset key={category.id}><legend>Category {i + 1}</legend>
          <label>Category title<input maxLength={120} value={category.title} onChange={(event) => updateCategory(i, { ...category, title: event.target.value })}/></label>
          {category.tasks.map((task, j) => {
            const updateTask = (next: z.infer<typeof TaskDefinition>) => updateCategory(i, { ...category, tasks: category.tasks.map((value, k) => k === j ? next : value) });
            return <fieldset key={task.id}><legend>Task {j + 1}</legend>
              <label>Task title<input maxLength={120} value={task.title} onChange={(event) => updateTask({ ...task, title: event.target.value })}/></label>
              <label>Task type<select value={task.kind} onChange={(event) => updateTask({ ...task, kind: TaskKind.parse(event.target.value) })}>{TaskKind.options.map((kind) => <option key={kind} value={kind}>{labels[kind]}</option>)}</select></label>
              <label>Prompt<textarea maxLength={20_000} value={task.prompt} onChange={(event) => updateTask({ ...task, prompt: event.target.value })}/></label>
              <fieldset><legend>Assigned criteria</legend>{draft.evaluation.criteria.map((criterion) => <label className="inline" key={criterion.id}><input type="checkbox" checked={task.criterionIds.includes(criterion.id)} onChange={(event) => updateTask({ ...task, criterionIds: event.target.checked ? [...task.criterionIds, criterion.id] : task.criterionIds.filter((id) => id !== criterion.id) })}/>{criterion.title || 'Untitled criterion'}</label>)}</fieldset>
              <button className="secondary" onClick={() => updateCategory(i, { ...category, tasks: category.tasks.filter((value) => value.id !== task.id) })}>Remove task</button>
            </fieldset>;
          })}
          <div className="editor-actions"><button onClick={() => updateCategory(i, { ...category, tasks: [...category.tasks, newTask()] })}>Add task</button><button className="secondary" onClick={() => setDraft({ ...draft, categories: draft.categories.filter((value) => value.id !== category.id) })}>Remove category and tasks</button></div>
        </fieldset>)}
        <button onClick={() => setDraft({ ...draft, categories: [...draft.categories, { id: CategoryId.parse(crypto.randomUUID()), title: '', tasks: [] }] })}>Add category</button>
        <h2>Ranking guidance</h2><p>Optional written rules. These instructions are saved with the suite and run snapshot. No aggregation formula is executed.</p>
        {draft.evaluation.rankingRules.map((rule, i) => <fieldset key={rule.id}><legend>Ranking rule {i + 1}</legend>
          <label>Rule title<input maxLength={120} value={rule.title} onChange={(event) => setDraft({ ...draft, evaluation: { ...draft.evaluation, rankingRules: draft.evaluation.rankingRules.map((value, j) => j === i ? { ...value, title: event.target.value } : value) } })}/></label>
          <label>Rule guidance<textarea maxLength={20_000} value={rule.instructions} onChange={(event) => setDraft({ ...draft, evaluation: { ...draft.evaluation, rankingRules: draft.evaluation.rankingRules.map((value, j) => j === i ? { ...value, instructions: event.target.value } : value) } })}/></label>
          <button className="secondary" onClick={() => setDraft({ ...draft, evaluation: { ...draft.evaluation, rankingRules: draft.evaluation.rankingRules.filter((value) => value.id !== rule.id) } })}>Remove rule</button>
        </fieldset>)}
        <button onClick={() => setDraft({ ...draft, evaluation: { ...draft.evaluation, rankingRules: [...draft.evaluation.rankingRules, { id: RankingRuleId.parse(crypto.randomUUID()), title: '', instructions: '' }] } })}>Add ranking rule</button>
        <h2>Materials</h2><p>Repository configuration only. Checkout and preparation are not performed.</p>
        <label>Materials source<select value={draft.materials.kind} onChange={(event) => setDraft({ ...draft, materials: event.target.value === 'repository' ? { kind: 'repository', url: '', requestedRef: '' } : { kind: 'none' } })}><option value="none">None</option><option value="repository">Repository</option></select></label>
        {draft.materials.kind === 'repository' && <>
          <label>Repository URL<input value={draft.materials.url} onChange={(event) => { if (draft.materials.kind === 'repository') setDraft({ ...draft, materials: { ...draft.materials, url: event.target.value } }); }}/></label>
          <label>Requested ref<input value={draft.materials.requestedRef} onChange={(event) => { if (draft.materials.kind === 'repository') setDraft({ ...draft, materials: { ...draft.materials, requestedRef: event.target.value } }); }}/></label>
        </>}
      </fieldset>
      <section aria-label="Readiness" className="readiness"><h2>{assessment?.kind === 'ready' ? 'Definition ready' : 'Incomplete definition'}</h2>
        {assessment?.kind === 'incomplete' && <><p>You can save this draft. Complete these fields before execution.</p><ul>{assessment.issues.map((issue) => <li key={issue.path.join('.')}>{fieldName(issue.path)}: {issue.message}</li>)}</ul></>}
        {parsed && !parsed.success && <><p>Correct these values before saving.</p><ul>{parsed.error.issues.map((issue, i) => <li key={i}>{fieldName(issue.path)}: {issue.message}</li>)}</ul></>}
      </section>
      <div className="editor-actions">{saved ? <><button disabled={busy} onClick={() => void save('minor')}>Save minor change</button><button disabled={busy} onClick={() => void save('revision')}>Save new revision</button></> : <button disabled={busy} onClick={() => void save()}>Create suite</button>}</div>
      {saved && <section aria-label="Saved execution inputs"><h2>Export saved task</h2><p>Downloads content {saved.content.ordinal}, revision {saved.content.revision}, including its evaluation guidance. Use the file with VIBE_SUITE_FILE in the local runner. Only text generation without repository materials can execute.</p>
        {unsaved && <p>Save your edits before exporting.</p>}
        {saved.assessment.kind === 'ready' && saved.content.definition.materials.kind === 'none' && saved.content.definition.categories.flatMap((category) => category.tasks).filter((task) => task.kind === 'text-generation').map((task) => <button disabled={Boolean(unsaved) || busy} className="secondary" key={task.id} onClick={() => exportTask(task.id)}>Export {task.title}</button>)}
      </section>}
      {history.length > 0 && <section aria-label="Suite history"><h2>History</h2><div className="editor-actions">{history.map((item) => <button className="secondary" key={item.contentId} onClick={() => setHistorical(item)}>Revision {item.revision} · Content {item.ordinal}</button>)}</div>
        {historical && <ContentDetails content={historical}/>}
      </section>}
    </>}
    {busy && <p role="status">Saving…</p>}{status && <p role="status">{status}</p>}{error && <p role="alert" className="error">{error}</p>}
  </section>;
}
