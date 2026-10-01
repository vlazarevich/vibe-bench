import { useState } from 'react';
import type { GradingCriterion, Judgment, JudgmentValue, SaveJudgment } from '../../../packages/contracts/src/blind-grading.ts';
import { RatingSelection } from '../../../packages/contracts/src/suites.ts';
import { z } from 'zod';

type Selection = z.infer<typeof RatingSelection>;
export function GradingControls({ criterion, judgment, save, reload }: { criterion: GradingCriterion; judgment: Judgment; save: (command: SaveJudgment) => Promise<void>; reload: () => Promise<void> }) {
  const [selection, setSelection] = useState<Selection | null>(judgment.value.kind === 'graded' ? judgment.value.selection : null);
  const [pending, setPending] = useState<SaveJudgment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(command: SaveJudgment) {
    setBusy(true); setPending(command); setError('');
    try { await save(command); setPending(null); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not save judgment'); }
    finally { setBusy(false); }
  }
  function write(value: JudgmentValue) { return submit({ card: judgment.card, criterion: judgment.criterion, expectedVersion: judgment.version, value }); }
  return <fieldset className="grading-control" disabled={busy}>
    <legend>{criterion.title}</legend><p>{criterion.instructions}</p>
    <p role="status">{judgment.value.kind === 'graded' ? `Saved grade ${judgment.value.grade}/100` : judgment.value.kind === 'skipped' ? 'Skipped' : 'Ungraded'}</p>
    {criterion.control === 'stars-5' ? <div aria-label="Stars">{[1, 2, 3, 4, 5].map((value) => <label key={value}><input type="radio" name={judgment.card + judgment.criterion} checked={selection?.control === 'stars-5' && selection.value === value} onChange={() => setSelection({ control: 'stars-5', value })}/>{value} {value === 1 ? 'star' : 'stars'}</label>)}</div>
      : criterion.control === 'slider-10' ? <label>Score (0–10)<input type="range" min="0" max="10" step="1" value={selection?.control === 'slider-10' ? selection.value : 0} onChange={(event) => setSelection({ control: 'slider-10', value: Number(event.target.value) })}/><select aria-label="Exact score" value={selection?.control === 'slider-10' ? String(selection.value) : ''} onChange={(event) => setSelection(event.target.value === '' ? null : { control: 'slider-10', value: Number(event.target.value) })}><option value="">Choose score</option>{Array.from({ length: 11 }, (_, value) => <option key={value} value={value}>{value}</option>)}</select></label>
        : <div>{[true, false].map((value) => <label key={String(value)}><input type="radio" name={judgment.card + judgment.criterion} checked={selection?.control === 'thumbs' && selection.value === value} onChange={() => setSelection({ control: 'thumbs', value })}/>{value ? 'Thumbs up' : 'Thumbs down'}</label>)}</div>}
    <div className="grading-actions"><button disabled={!selection || pending !== null} onClick={() => selection && void write({ kind: 'graded', selection })}>Save grade</button><button disabled={pending !== null} onClick={() => void write({ kind: 'skipped' })}>Skip</button><button disabled={pending !== null} onClick={() => void write({ kind: 'ungraded' })}>Clear</button></div>
    {busy && <p>Saving judgment…</p>}
    {error && <div role="alert"><p>{error}</p>{pending && <button onClick={() => void submit(pending)}>Retry exact save</button>}<button onClick={() => void reload().catch((error: unknown) => setError(error instanceof Error ? error.message : 'Could not reload'))}>Reload saved judgment</button></div>}
  </fieldset>;
}
