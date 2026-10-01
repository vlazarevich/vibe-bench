import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { BlindGradingRuns, BlindGradingSession, BlindGradingTask, BlindResult, Judgment, SaveJudgment } from '../../../packages/contracts/src/blind-grading.ts';
import { GradingControls } from './grading-controls.tsx';
import './blind-grading.css';

async function request<T>(path: string, schema: z.ZodType<T>, body?: unknown) {
  const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(await response.json());
    throw new Error(error.success ? error.data.error : 'The request failed');
  }
  return schema.parse(await response.json());
}
function GradingResult({ session, result }: { session: string; result: BlindResult }) {
  if (result.kind === 'text') return <pre>{result.text}</pre>;
  return <div className="grading-result">{result.assets.map((asset, index) => {
    const url = `/api/blind-grading/${session}/assets/${asset.handle}`;
    const image = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(asset.mediaType);
    return <figure key={asset.handle}>{image ? <img src={url} alt={`Result image ${index + 1}`}/> : asset.mediaType === 'video/webm' ? <video controls preload="metadata" src={url}/> : <p>Preview unavailable. Download this result to inspect it.</p>}<figcaption><a href={url} download="result.bin">Download result {index + 1}</a></figcaption></figure>;
  })}</div>;
}
export function BlindGrading() {
  const [runs, setRuns] = useState<z.infer<typeof BlindGradingRuns>>([]);
  const [session, setSession] = useState<BlindGradingSession | null>(null);
  const [task, setTask] = useState<BlindGradingTask | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [progressError, setProgressError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [params] = useState(() => new URLSearchParams(location.search));
  const progressRequest = useRef(0);
  const id = params.get('grading');
  const taskHandle = params.get('task');
  useEffect(() => {
    void (async () => {
      if (!id) { setRuns(await request('/api/blind-grading/runs', BlindGradingRuns)); return; }
      const loaded = await request(`/api/blind-grading/${encodeURIComponent(id)}`, BlindGradingSession);
      setSession(loaded);
      const selected = taskHandle ?? loaded.categories[0]?.tasks[0]?.handle;
      if (selected) {
        setTask(await request(`/api/blind-grading/${loaded.id}/tasks/${encodeURIComponent(selected)}`, BlindGradingTask));
        history.replaceState(null, '', `?view=grading&grading=${loaded.id}&task=${encodeURIComponent(selected)}`);
      }
    })().catch((error: unknown) => setError(error instanceof Error ? error.message : 'Could not load grading')).finally(() => setBusy(false));
  }, [id, taskHandle]);
  async function open(reviewId: string) {
    setBusy(true); setError('');
    try { const value = await request('/api/blind-grading', BlindGradingSession, { reviewId }); location.assign(`?view=grading&grading=${value.id}`); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not open grading'); setBusy(false); }
  }
  async function refreshProgress() {
    if (!session) return;
    const generation = ++progressRequest.current;
    try {
      const loaded = await request(`/api/blind-grading/${session.id}`, BlindGradingSession);
      if (generation === progressRequest.current) { setSession(loaded); setProgressError(false); }
    } catch {
      if (generation === progressRequest.current) setProgressError(true);
    }
  }
  async function reload() {
    if (!session || !task) return;
    const [loaded] = await Promise.all([request(`/api/blind-grading/${session.id}/tasks/${task.handle}`, BlindGradingTask), refreshProgress()]);
    setTask(loaded); setReloadKey((key) => key + 1);
  }
  async function save(command: SaveJudgment) {
    if (!session || !task) return;
    const saved = await request(`/api/blind-grading/${session.id}/judgments`, Judgment, command);
    setTask((current) => current && ({ ...current, cards: current.cards.map((card) => card.kind === 'completed' && card.handle === saved.card ? { ...card, judgments: card.judgments.map((judgment) => judgment.criterion === saved.criterion ? saved : judgment) } : card) }));
    await refreshProgress();
  }
  return <section aria-label="Configured-run grading">
    <h1>{session ? session.title : 'Grade configured runs'}</h1>
    <p>Grade each anonymous result independently. Equal grades are allowed. Skip and Clear do not mean zero.</p>
    {busy && <p role="status">Loading grading…</p>}{error && <p role="alert">{error}</p>}
    {progressError && <div role="alert"><p>Saved progress could not be refreshed.</p><button onClick={() => void refreshProgress()}>Refresh progress</button></div>}
    {!id && <div className="runs">{runs.map((run) => <article className="run" key={run.reviewId}><div><h2>{run.title}</h2><p>{run.source === 'fixture' ? 'Deterministic fixture. No model calls.' : 'Live results'}</p></div><button disabled={busy || !run.ready} onClick={() => void open(run.reviewId)}>{run.ready ? 'Grade results' : 'Awaiting attempts'}</button></article>)}{!busy && runs.length === 0 && <p>No configured runs yet.</p>}</div>}
    {session && <><p>{session.source === 'fixture' ? 'Deterministic fixture. No model calls.' : 'Live results'}</p><nav aria-label="Grading tasks">{session.categories.map((category) => <section key={category.handle}><h2>{category.title}</h2>{category.tasks.map((item) => <a key={item.handle} aria-current={item.handle === task?.handle ? 'page' : undefined} href={`?view=grading&grading=${session.id}&task=${item.handle}`}>{item.title} · {item.progress.graded} graded · {item.progress.skipped} skipped · {item.progress.ungraded} ungraded · {item.progress.unavailable} unavailable</a>)}</section>)}</nav></>}
    {session && task && <section aria-label="Task grading"><h2>{task.title}</h2><p className="grading-prompt">{task.prompt}</p><div className="grading-cards">{task.cards.map((card, index) => <article className="card" key={card.handle} aria-label={`Result ${index + 1}`}><h3>Result {index + 1}</h3>{card.kind === 'completed' ? <><GradingResult session={session.id} result={card.result}/>{card.judgments.map((judgment) => {
      const criterion = task.criteria.find((criterion) => criterion.handle === judgment.criterion);
      return criterion && <GradingControls key={`${judgment.criterion}-${judgment.version}-${reloadKey}`} criterion={criterion} judgment={judgment} save={save} reload={reload}/>;
    })}</> : <p>Result unavailable. Execution {card.kind === 'failed' ? 'failed' : 'was skipped'}. No grade can be saved.</p>}</article>)}</div></section>}
  </section>;
}
