import { useState } from 'react';
import type {
  GradingCriterion,
  Judgment,
  JudgmentValue,
  SaveJudgment,
} from '../../../packages/contracts/src/blind-grading.ts';
import { CriterionScore, Button, Slider, type ScoreValue } from './design-system';
export function GradingControls({
  criterion,
  judgment,
  save,
  reload,
  readOnly = false,
  onPending,
}: {
  criterion: GradingCriterion;
  judgment: Judgment;
  save: (command: SaveJudgment) => Promise<void>;
  reload: () => Promise<void>;
  readOnly?: boolean;
  onPending?: (key: string, pending: boolean) => void;
}) {
  const [pending, setPending] = useState<SaveJudgment | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const selection = judgment.value.kind === 'graded' ? judgment.value.selection : null;
  const value: ScoreValue = selection
    ? selection.control === 'thumbs'
      ? selection.value
        ? 'up'
        : 'down'
      : selection.value
    : null;
  const key = judgment.card + judgment.criterion;
  async function submit(command: SaveJudgment) {
    if (busy) return;
    setBusy(true);
    setPending(command);
    setError('');
    onPending?.(key, true);
    try {
      await save(command);
      setPending(null);
      onPending?.(key, false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save grade');
    } finally {
      setBusy(false);
    }
  }
  function write(value: JudgmentValue) {
    void submit({ card: judgment.card, criterion: judgment.criterion, expectedVersion: judgment.version, value });
  }
  function change(value: ScoreValue) {
    if (value === null) return;
    const control = criterion.control;
    write({
      kind: 'graded',
      selection: control === 'thumbs' ? { control, value: value === 'up' } : { control, value: Number(value) },
    });
  }
  return (
    <fieldset className="grading-control" disabled={busy || readOnly} aria-label={criterion.title}>
      {criterion.control === 'slider-10' ? (
        <Slider
          label={criterion.title}
          min={0}
          max={10}
          step={1}
          value={typeof value === 'number' ? value : 0}
          unset={value === null}
          onValueChange={change}
          readOnly={readOnly || busy || pending !== null}
          format={(v) => `${v} / 10`}
        />
      ) : (
        <CriterionScore
          name={criterion.title}
          guidance={criterion.instructions}
          control={criterion.control === 'stars-5' ? 'stars' : criterion.control === 'thumbs' ? 'thumbs' : 'slider'}
          value={value}
          onChange={change}
          readOnly={readOnly || busy || pending !== null}
        />
      )}
      <div className="grade-meta">
        <span role="status">
          {busy
            ? 'Saving…'
            : judgment.value.kind === 'graded'
              ? `Saved grade ${judgment.value.grade}/100`
              : judgment.value.kind === 'skipped'
                ? 'Skipped'
                : 'Ungraded'}
        </span>
        {!readOnly && (
          <span className="actions">
            <Button
              size="sm"
              variant="quiet"
              disabled={busy || pending !== null}
              onClick={() => write({ kind: 'skipped' })}
            >
              Skip
            </Button>
            <Button
              size="sm"
              variant="quiet"
              disabled={busy || pending !== null}
              onClick={() => write({ kind: 'ungraded' })}
            >
              Clear
            </Button>
          </span>
        )}
      </div>
      {error && (
        <div role="alert" className="grade-error">
          <p>{error}</p>
          <Button disabled={busy} onClick={() => pending && void submit(pending)}>
            Retry exact save
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void reload()
                .then(() => {
                  setError('');
                  setPending(null);
                  onPending?.(key, false);
                })
                .catch((e) => setError(String(e)))
            }
          >
            Reload saved judgment
          </Button>
        </div>
      )}
    </fieldset>
  );
}
