import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import { Evaluation, Runs } from '../../../packages/contracts/src/evaluation.ts';
import './style.css';
import { Suites } from './suites.tsx';

async function request<T>(path: string, schema: z.ZodType<T>, body?: unknown) {
  const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(await response.json());
    throw new Error(error.success ? error.data.error : 'The request failed');
  }
  return schema.parse(await response.json());
}

function App() {
  const [runs, setRuns] = useState<z.infer<typeof Runs>>([]);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  async function refresh() { setRuns(await request('/api/runs', Runs)); }
  useEffect(() => {
    const session = new URLSearchParams(location.search).get('session');
    void (async () => { await refresh(); if (session) setEvaluation(await request(`/api/evaluations/${encodeURIComponent(session)}`, Evaluation)); })().catch((error: unknown) => setError(error instanceof Error ? error.message : 'Could not load runs')).finally(() => setBusy(false));
  }, []);
  async function openRun(runId: string) {
    setBusy(true); setError('');
    try {
      const result = await request('/api/evaluations', Evaluation, { reviewId: runId });
      setEvaluation(result); history.replaceState(null, '', `?session=${result.sessionId}`);
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not open comparison'); }
    finally { setBusy(false); }
  }
  async function choose(handle: string) {
    if (!evaluation) return;
    setBusy(true); setError('');
    try { setEvaluation(await request(`/api/evaluations/${evaluation.sessionId}/choice`, Evaluation, { handle })); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not save choice. Retry to recover a saved choice.'); }
    finally { setBusy(false); }
  }
  return <main>
    <header><div className="wordmark">vibe<span>bench</span></div><span className="local">LOCAL COMPARISON</span></header>
    <nav aria-label="Main navigation"><a href="/">Comparisons</a><a href="/?view=suites">Suites</a></nav>
    {new URLSearchParams(location.search).get('view') === 'suites' ? <Suites/> : evaluation ? <>
      <button className="back" onClick={() => { setEvaluation(null); history.replaceState(null, '', '/'); void refresh(); }}>← All runs</button>
      <div className="eyebrow">{evaluation.source === 'fixture' ? 'DETERMINISTIC DEMO · NO MODEL CALLS' : 'LIVE CODEX RESULTS'}</div>
      <h1>{evaluation.kind === 'blind' ? 'Which answer is better?' : 'Your choice is saved.'}</h1>
      <p className="intro">{evaluation.kind === 'blind' ? 'Read both answers, then choose one. Model identities stay hidden until your choice is saved.' : 'The model identities are now revealed. Your choice and this presentation order survive reloads.'}</p>
      <details open><summary>{evaluation.task.title}</summary><p>{evaluation.task.prompt}</p></details>
      <section className="cards" aria-label="Answers">
        {evaluation.cards.map((card, index) => <article key={card.handle} className={evaluation.kind === 'revealed' && evaluation.selected === card.handle ? 'card selected' : 'card'}>
          <div className="card-head"><h2>Answer {index === 0 ? 'A' : 'B'}</h2>{evaluation.kind === 'revealed' && evaluation.selected === card.handle && <span className="chosen">YOUR CHOICE</span>}</div>
          <pre>{card.text}</pre>
          {evaluation.kind === 'blind' ? <button disabled={busy} onClick={() => void choose(card.handle)}>Choose answer {index === 0 ? 'A' : 'B'}</button> : <div className="identity">{evaluation.identities.find((identity) => identity.handle === card.handle)?.model}<small>{evaluation.identities.find((identity) => identity.handle === card.handle)?.cliVersion}</small></div>}
        </article>)}
      </section>
    </> : <>
      <div className="eyebrow">A SMALLER BENCHMARK</div><h1>Judge the answer.<br/>Then meet the model.</h1>
      <p className="intro">One task. Two answers. Your judgment comes first.</p>
      <div className="run-heading"><h2>Available runs</h2><button className="back" disabled={busy} onClick={() => void refresh().catch((error: unknown) => setError(String(error)))}>Refresh</button></div>
      {runs.length === 0 && !busy && <div className="empty">No results yet. Run <code>pnpm run:fixture</code> for a local demo or <code>pnpm run:live</code> for the configured models.</div>}
      <div className="runs">{runs.map((run) => <article className="run" key={run.id}><div><h3>{run.title}</h3><p>{run.source === 'fixture' ? 'Fixture demo' : 'Live Codex'} · {new Date(run.createdAt).toLocaleString()}</p>{run.status === 'failed' && <p className="failure">Execution failed. Inspect runner logs, then start a new run.</p>}</div><button disabled={busy || run.status !== 'ready'} onClick={() => void openRun(run.id)}>{run.status === 'ready' ? 'Compare answers' : 'Unavailable'}</button></article>)}</div>
    </>}
    {busy && <p role="status">Loading…</p>}{error && <p role="alert" className="error">{error}</p>}
    <footer>Text is displayed as submitted. An answer may identify its author through its content.</footer>
  </main>;
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(<App/>);
