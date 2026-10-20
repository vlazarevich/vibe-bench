import * as React from 'react';
import { cx, Icon, IconName, IconButton } from './core';
import { Rating, Slider, Thumbs, ThumbsValue } from './forms';
import { Tooltip } from './overlays';
import { EntrantTag, Entrant } from './composites';

/* ---------------- Task types ---------------- */

export type TaskType =
  | 'text-generation'
  | 'text-editing'
  | 'image-generation'
  | 'image-editing'
  | 'image-understanding'
  | 'html-static'
  | 'html-interactive'
  | 'coding-bugfix'
  | 'coding-feature'
  | 'browser-use';
/** How results of one task are shown: one at a time, or two side by side to compare. */
export type CompareLayout = 'single' | 'compare';
const TYPES: Record<TaskType, { label: string; icon: IconName; layout: CompareLayout }> = {
  'text-generation': { label: 'Text generation', icon: 'type-text-generation', layout: 'compare' },
  'text-editing': { label: 'Text editing', icon: 'type-text-editing', layout: 'compare' },
  'image-generation': { label: 'Image generation', icon: 'type-image-generation', layout: 'compare' },
  'image-editing': { label: 'Image editing', icon: 'type-image-editing', layout: 'compare' },
  'image-understanding': { label: 'Image understanding', icon: 'type-image-understanding', layout: 'compare' },
  'html-static': { label: 'Static HTML page design', icon: 'type-html-static', layout: 'single' },
  'html-interactive': { label: 'Interactive HTML page design', icon: 'type-html-interactive', layout: 'single' },
  'coding-bugfix': { label: 'Coding bugfix', icon: 'type-coding-bugfix', layout: 'single' },
  'coding-feature': { label: 'Coding new feature', icon: 'type-coding-feature', layout: 'single' },
  'browser-use': { label: 'Browser use scenario', icon: 'type-browser-use', layout: 'single' },
};
/** The task types in display order. */
export const taskTypes = Object.keys(TYPES) as TaskType[];
/** Label, icon and default compare layout of a task type. */
export const taskTypeInfo = (t: TaskType) => TYPES[t] || TYPES['text-generation'];

export interface TaskTypeTagProps {
  type: TaskType;
  className?: string | undefined;
}
/** A task type as icon + label, for task headers and lists. */
export function TaskTypeTag({ type, className }: TaskTypeTagProps) {
  const t = taskTypeInfo(type);
  return (
    <span className={cx('vb-ttype', className)}>
      <Icon name={t.icon} size={14} />
      {t.label}
    </span>
  );
}

/* ---------------- Segmented ---------------- */

export interface SegmentedOption {
  value: string;
  label: string;
  icon?: IconName | undefined;
}
export interface SegmentedProps {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  /** Accessible name of the group. */
  label: string;
  /** Icons only; each label moves to a Tooltip. */
  iconOnly?: boolean | undefined;
  className?: string | undefined;
}
/** A small switch between 2–4 views (layout, viewport). A radio group: arrow keys move. */
export function Segmented({ options, value, onChange, label, iconOnly, className }: SegmentedProps) {
  const refs = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: React.KeyboardEvent) => {
    const i = options.findIndex((o) => o.value === value);
    const d =
      e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = options[(i + d + options.length) % options.length];
    if (n) {
      onChange(n.value);
      refs.current[n.value]?.focus();
    }
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx('vb-seg', iconOnly && 'is-icons', className)}
      onKeyDown={onKey}
    >
      {options.map((o) => {
        const on = o.value === value;
        const b = (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[o.value] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={iconOnly ? o.label : undefined}
            tabIndex={on ? 0 : -1}
            className={cx('vb-seg-opt', on && 'is-on')}
            onClick={() => onChange(o.value)}
          >
            {o.icon && <Icon name={o.icon} />}
            {!iconOnly && o.label}
          </button>
        );
        return iconOnly ? (
          <Tooltip key={o.value} content={o.label}>
            {b}
          </Tooltip>
        ) : (
          b
        );
      })}
    </div>
  );
}

/* ---------------- CriterionScore ---------------- */

export type ScoreControl = 'stars' | 'slider' | 'thumbs';
export type ScoreValue = number | ThumbsValue | null;
export interface CriterionScoreProps {
  name: string;
  control: ScoreControl;
  /** What the grader looks for; shown in a Tooltip on the info mark. */
  guidance?: string | undefined;
  /** stars: 1–5 (0 or null = not rated); slider: 0–100 (null = not rated); thumbs: 'up' | 'down' | null. */
  value: ScoreValue;
  onChange?: ((v: ScoreValue) => void) | undefined;
  readOnly?: boolean | undefined;
  className?: string | undefined;
}
/** One criterion of a task, scored with the control the suite chose for it. */
export function CriterionScore({ name, control, guidance, value, onChange, readOnly, className }: CriterionScoreProps) {
  const label = (
    <span className="vb-crit-name">
      {name}
      {guidance && <Icon name="info" size={14} tooltip={guidance} tooltipSide="top" className="vb-crit-info" />}
    </span>
  );
  let el: React.ReactNode;
  if (control === 'stars')
    el = <Rating label={label} value={typeof value === 'number' ? value : 0} onChange={onChange} readOnly={readOnly} />;
  else if (control === 'slider')
    el = (
      <Slider
        label={label}
        value={typeof value === 'number' ? value : 0}
        unset={value == null}
        onValueChange={onChange}
        readOnly={readOnly}
        format={(v) => v + ' / 100'}
      />
    );
  else
    el = (
      <Thumbs
        label={label}
        value={value === 'up' || value === 'down' ? value : null}
        onChange={onChange}
        readOnly={readOnly}
      />
    );
  return <div className={cx('vb-crit', className)}>{el}</div>;
}

/* ---------------- ResultPicker ---------------- */

export interface ResultChoice {
  /** The blind letter: "A". */
  letter: string;
  /** All criteria scored: shows a tick after the letter. */
  done?: boolean | undefined;
  /** Can't be picked here (it's open in the other compare panel). */
  disabled?: boolean | undefined;
}
export interface ResultPickerProps {
  results: ResultChoice[];
  value: string;
  onChange: (letter: string) => void;
  /** Accessible name of the group. Default "Result". */
  label?: string | undefined;
  className?: string | undefined;
}
/** Picks one result of a task by its letter; scored ones carry a tick. A radio group: arrow keys move, skipping disabled letters. */
export function ResultPicker({ results, value, onChange, label = 'Result', className }: ResultPickerProps) {
  const refs = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: React.KeyboardEvent) => {
    const d =
      e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = results.length;
    let i = results.findIndex((r) => r.letter === value);
    for (let k = 0; k < n; k++) {
      i = (i + d + n) % n;
      if (!results[i]!.disabled) break;
    }
    const r = results[i];
    if (!r || r.disabled) return;
    onChange(r.letter);
    refs.current[r.letter]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={cx('vb-rpick', className)} onKeyDown={onKey}>
      {results.map((r) => {
        const on = r.letter === value;
        return (
          <button
            key={r.letter}
            ref={(el) => {
              refs.current[r.letter] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={`Result ${r.letter}${r.done ? ', scored' : ''}${r.disabled ? ', open in the other panel' : ''}`}
            disabled={r.disabled}
            tabIndex={on ? 0 : -1}
            className={cx('vb-rpick-opt', on && 'is-on', r.done && 'is-done')}
            onClick={() => onChange(r.letter)}
          >
            {r.letter}
            {r.done && <Icon name="check" size={12} className="vb-rpick-tick" />}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- ResultPanel ---------------- */

export interface ResultPanelProps {
  /** The blind letter: "A". */
  letter: string;
  /** Shown once results are revealed (a submitted grading): the entrant that made it. Hidden while grading. */
  revealed?: Entrant | undefined;
  /** All criteria of this result have a score. */
  done?: boolean | undefined;
  /** Puts a ResultPicker in the header in place of the title, so this panel can switch results. */
  results?: ResultChoice[] | undefined;
  onSelect?: ((letter: string) => void) | undefined;
  /** Right side of the header: an open-in-tab button. */
  toolbar?: React.ReactNode | undefined;
  /** The result, in the viewer for the task type. */
  children?: React.ReactNode | undefined;
  /** Criterion scores under the result. */
  scores?: React.ReactNode | undefined;
  /** Or the criteria as data: each becomes a CriterionScore in the footer. */
  criteria?: CriterionScoreProps[] | undefined;
  className?: string | undefined;
}
/** One result of a task while grading: its blind letter (or a picker to switch results), the result itself, and its scores. */
export function ResultPanel({
  letter,
  revealed,
  done,
  results,
  onSelect,
  toolbar,
  children,
  scores,
  criteria,
  className,
}: ResultPanelProps) {
  const foot =
    scores || (criteria && criteria.length ? criteria.map((c, i) => <CriterionScore key={c.name + i} {...c} />) : null);
  return (
    <section className={cx('vb-ep', className)} aria-label={`Result ${letter}`}>
      <header className="vb-ep-head">
        {results && onSelect ? (
          <ResultPicker results={results} value={letter} onChange={onSelect} />
        ) : (
          <>
            <span className="vb-ep-letter" aria-hidden="true">
              {letter}
            </span>
            <h3 className="vb-ep-title">Result {letter}</h3>
            {done && <Icon name="check" size={14} tooltip="All criteria scored" className="vb-ep-done" />}
          </>
        )}
        {revealed && <EntrantTag entrant={revealed} />}
        <span className="vb-ep-tools">{toolbar}</span>
      </header>
      <div className="vb-ep-body">{children}</div>
      {foot && <div className="vb-ep-scores">{foot}</div>}
    </section>
  );
}

/* ---------------- TextOutput ---------------- */

type Seg = { t: 'same' | 'ins' | 'del'; s: string };
function diffWords(a: string, b: string): Seg[] {
  const A = a.split(/(\s+)/),
    B = b.split(/(\s+)/);
  const n = A.length,
    m = B.length;
  if (n * m > 1_000_000)
    return [
      { t: 'del', s: a },
      { t: 'ins', s: b },
    ];
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      L[i]![j]! = A[i] === B[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  const out: Seg[] = [];
  const push = (t: Seg['t'], s: string) => {
    const l = out[out.length - 1];
    if (l && l.t === t) l.s += s;
    else out.push({ t, s });
  };
  let i = 0,
    j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      push('same', A[i]!);
      i++;
      j++;
    } else if (L[i + 1]![j]! >= L[i]![j + 1]!) push('del', A[i++]!);
    else push('ins', B[j++]!);
  }
  while (i < n) push('del', A[i++]!);
  while (j < m) push('ins', B[j++]!);
  return out;
}
export interface TextOutputProps {
  text: string;
  /** The text the entrant was asked to edit; enables showChanges. */
  source?: string | undefined;
  /** Marks words added and removed against source. */
  showChanges?: boolean | undefined;
  /** Scroll inside past this height (px). */
  maxHeight?: number | undefined;
  className?: string | undefined;
}
/** A text answer: paragraphs in reading width, or a word diff against the source text. */
export function TextOutput({ text, source, showChanges, maxHeight, className }: TextOutputProps) {
  const body =
    showChanges && source != null ? (
      <p className="vb-txt-diff">
        {diffWords(source, text).map((s, i) =>
          s.t === 'same' ? (
            <React.Fragment key={i}>{s.s}</React.Fragment>
          ) : s.t === 'ins' ? (
            <ins key={i}>{s.s}</ins>
          ) : (
            <del key={i}>{s.s}</del>
          ),
        )}
      </p>
    ) : (
      text.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)
    );
  return (
    <div
      className={cx('vb-txt', className)}
      style={maxHeight ? { maxHeight, overflow: 'auto' } : undefined}
      tabIndex={maxHeight ? 0 : undefined}
    >
      {body}
    </div>
  );
}

/* ---------------- ImageOutput ---------------- */

export interface ImageOutputProps {
  src: string;
  alt: string;
  caption?: React.ReactNode | undefined;
  /** CSS aspect ratio of the frame. Default "4 / 3". */ ratio?: string | undefined;
  className?: string | undefined;
  /** Called when the browser cannot decode the image. */ onError?: (() => void) | undefined;
}
/** An image result on a neutral checkerboard, fitted without cropping. */
export function ImageOutput({ src, alt, caption, ratio = '4 / 3', className, onError }: ImageOutputProps) {
  return (
    <figure className={cx('vb-img', className)}>
      <div className="vb-img-frame" style={{ aspectRatio: ratio }}>
        <img src={src} alt={alt} onError={onError} />
      </div>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

/* ---------------- HtmlPreview ---------------- */

export type Viewport = 'desktop' | 'tablet' | 'mobile';
const VP: Record<Viewport, { w: number; label: string; icon: IconName }> = {
  desktop: { w: 1440, label: 'Desktop, 1440 px', icon: 'desktop' },
  tablet: { w: 768, label: 'Tablet, 768 px', icon: 'tablet' },
  mobile: { w: 390, label: 'Mobile, 390 px', icon: 'mobile' },
};
export interface HtmlPreviewProps {
  /** The entrant's page. */
  html: string;
  /** Lets scripts run and the page take input. Static pages render without scripts. */
  interactive?: boolean | undefined;
  viewport?: Viewport | undefined;
  defaultViewport?: Viewport | undefined;
  onViewportChange?: ((v: Viewport) => void) | undefined;
  /** Frame height in px. Default 480. */
  height?: number | undefined;
  /** Names the frame for screen readers. */
  title: string;
  className?: string | undefined;
}
/** A rendered HTML result at a chosen viewport width, scaled down to fit. */
export function HtmlPreview({
  html,
  interactive,
  viewport,
  defaultViewport = 'desktop',
  onViewportChange,
  height = 480,
  title,
  className,
}: HtmlPreviewProps) {
  const [own, setOwn] = React.useState<Viewport>(defaultViewport);
  const vp = viewport || own;
  const set = (v: string) => {
    setOwn(v as Viewport);
    onViewportChange?.(v as Viewport);
  };
  const box = React.useRef<HTMLDivElement>(null);
  const [w, setW] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const target = VP[vp].w;
  const scale = w ? Math.min(1, w / target) : 1;
  const open = () => {
    const u = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    window.open(u, '_blank', 'noopener');
  };
  return (
    <div className={cx('vb-html', className)}>
      <div className="vb-html-bar">
        <Segmented
          label="Viewport"
          iconOnly
          value={vp}
          onChange={set}
          options={(Object.keys(VP) as Viewport[]).map((k) => ({ value: k, label: VP[k].label, icon: VP[k].icon }))}
        />
        <span className="vb-html-w vb-mono">
          {target} px{scale < 1 ? ` · ${Math.round(scale * 100)}%` : ''}
        </span>
        <span className="vb-html-mode">{interactive ? 'Interactive' : 'Static'}</span>
        <IconButton icon="external" label="Open in a new tab" size="sm" tooltip onClick={open} />
      </div>
      <div ref={box} className="vb-html-stage" style={{ height }}>
        <div className="vb-html-page" style={{ width: target * scale, height }}>
          <iframe
            title={title}
            srcDoc={html}
            sandbox={interactive ? 'allow-scripts allow-forms' : ''}
            style={{ width: target, height: height / scale, transform: `scale(${scale})` }}
          />
        </div>
      </div>
    </div>
  );
}

/* ---------------- CodeDiff ---------------- */

export interface DiffFile {
  path: string;
  status?: ('modified' | 'added' | 'deleted') | undefined;
  /** Unified diff body: "@@ -12,6 +12,9 @@" hunk headers, then lines starting with " ", "+" or "-". */
  patch: string;
}
export interface CodeDiffProps {
  files: DiffFile[];
  /** Hidden tests run on the result. */
  tests?: { passed: number; total: number } | undefined;
  /** Paths collapsed on first render. */
  defaultCollapsed?: string[] | undefined;
  className?: string | undefined;
}
type DLine = { k: 'hunk' | 'add' | 'del' | 'ctx'; a?: number | undefined; b?: number | undefined; s: string };
function parsePatch(p: string): { lines: DLine[]; add: number; del: number } {
  const lines: DLine[] = [];
  let a = 0,
    b = 0,
    add = 0,
    del = 0;
  p.replace(/\n$/, '')
    .split('\n')
    .forEach((l) => {
      const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(l);
      if (h) {
        a = +h[1]!;
        b = +h[2]!;
        lines.push({ k: 'hunk', s: l });
        return;
      }
      const c = l[0],
        s = l.slice(1);
      if (c === '+') {
        lines.push({ k: 'add', b: b++, s });
        add++;
      } else if (c === '-') {
        lines.push({ k: 'del', a: a++, s });
        del++;
      } else lines.push({ k: 'ctx', a: a++, b: b++, s });
    });
  return { lines, add, del };
}
/** A code change as a unified diff per file, with line numbers and +/− counts, and the hidden test result. */
export function CodeDiff({ files, tests, defaultCollapsed = [], className }: CodeDiffProps) {
  const parsed = React.useMemo(() => files.map((f) => ({ f, ...parsePatch(f.patch) })), [files]);
  const [closed, setClosed] = React.useState<string[]>(defaultCollapsed);
  const add = parsed.reduce((n, x) => n + x.add, 0),
    del = parsed.reduce((n, x) => n + x.del, 0);
  const allPass = tests && tests.passed === tests.total;
  return (
    <div className={cx('vb-diff', className)}>
      <div className="vb-diff-sum">
        <span>
          {files.length} {files.length === 1 ? 'file' : 'files'}
        </span>
        <span className="vb-mono">
          <span className="vb-diff-add">+{add}</span> <span className="vb-diff-del">−{del}</span>
        </span>
        {tests && (
          <span className={cx('vb-diff-tests', allPass ? 'vb-tone-success' : 'vb-tone-danger')}>
            <Icon name={allPass ? 'passed' : 'failed'} size={14} />
            Tests {tests.passed} of {tests.total} passed
          </span>
        )}
      </div>
      {parsed.map(({ f, lines, add: fa, del: fd }) => {
        const open = closed.indexOf(f.path) < 0;
        return (
          <div key={f.path} className="vb-diff-file">
            <button
              type="button"
              className="vb-diff-fh"
              aria-expanded={open}
              onClick={() => setClosed((c) => (open ? c.concat(f.path) : c.filter((x) => x !== f.path)))}
            >
              <Icon name="chevron-right" size={14} className="vb-diff-chev" />
              <span className="vb-mono vb-diff-path">{f.path}</span>
              {f.status && f.status !== 'modified' && (
                <span className="vb-diff-st">{f.status === 'added' ? 'New' : 'Deleted'}</span>
              )}
              <span className="vb-mono vb-diff-n">
                <span className="vb-diff-add">+{fa}</span> <span className="vb-diff-del">−{fd}</span>
              </span>
            </button>
            {open && (
              <div className="vb-diff-body" tabIndex={0}>
                <table>
                  <tbody>
                    {lines.map((l, i) =>
                      l.k === 'hunk' ? (
                        <tr key={i} className="vb-dl-hunk">
                          <td colSpan={3}>{l.s}</td>
                        </tr>
                      ) : (
                        <tr key={i} className={'vb-dl-' + l.k}>
                          <td className="vb-dl-n">{l.a ?? ''}</td>
                          <td className="vb-dl-n">{l.b ?? ''}</td>
                          <td className="vb-dl-code">
                            <span
                              className="vb-dl-sign"
                              aria-label={l.k === 'add' ? 'added' : l.k === 'del' ? 'removed' : undefined}
                            >
                              {l.k === 'add' ? '+' : l.k === 'del' ? '−' : ' '}
                            </span>
                            {l.s}
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- BrowserReplay ---------------- */

export interface ReplayStep {
  /** "Click", "Type", "Open", "Scroll", "Check". */
  action: string;
  /** What it acted on: "Search field", "“Add to cart”". */
  target: string;
  /** Page address at this step. */
  url: string;
  /** Screenshot after the step. */
  shot: string;
  /** false marks a step that went wrong (element not found, wrong page). */
  ok?: boolean | undefined;
  /** Extra detail: typed text, an error. */
  note?: string | undefined;
}
export interface BrowserReplayProps {
  steps: ReplayStep[];
  /** How the scenario ended. */
  outcome?: { ok: boolean; text: string } | undefined;
  step?: number | undefined;
  defaultStep?: number | undefined;
  onStepChange?: ((i: number) => void) | undefined;
  /** Screenshot area height in px. Default 360. */
  height?: number | undefined;
  className?: string | undefined;
}
/** Replays an entrant's browser session: screenshot per step with play, step and a clickable step list. */
export function BrowserReplay({
  steps,
  outcome,
  step,
  defaultStep = 0,
  onStepChange,
  height = 360,
  className,
}: BrowserReplayProps) {
  const [own, setOwn] = React.useState(defaultStep);
  const i = Math.max(0, Math.min(steps.length - 1, step ?? own));
  const go = (n: number) => {
    const v = Math.max(0, Math.min(steps.length - 1, n));
    setOwn(v);
    onStepChange?.(v);
  };
  const [playing, setPlaying] = React.useState(false);
  React.useEffect(() => {
    if (!playing) return;
    if (i >= steps.length - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => go(i + 1), 1200);
    return () => clearTimeout(t);
  }, [playing, i]);
  const s = steps[i];
  if (!s) return <p>No recorded steps.</p>;
  return (
    <div className={cx('vb-replay', className)}>
      <div className="vb-replay-view">
        <div className="vb-replay-url">
          <span className="vb-replay-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="vb-mono">{s.url}</span>
        </div>
        <div className="vb-replay-shot" style={{ height }}>
          <img src={s.shot} alt={`Step ${i + 1}: ${s.action} ${s.target}`} />
        </div>
        <div className="vb-replay-ctrl">
          <IconButton
            icon="prev"
            label="Previous step"
            size="sm"
            tooltip
            tooltipSide="top"
            disabled={i === 0}
            onClick={() => go(i - 1)}
          />
          <IconButton
            icon={playing ? 'pause' : 'play'}
            label={playing ? 'Pause' : 'Play from here'}
            size="sm"
            tooltip
            tooltipSide="top"
            onClick={() => {
              if (!playing && i >= steps.length - 1) go(0);
              setPlaying(!playing);
            }}
          />
          <IconButton
            icon="next"
            label="Next step"
            size="sm"
            tooltip
            tooltipSide="top"
            disabled={i === steps.length - 1}
            onClick={() => go(i + 1)}
          />
          <span className="vb-replay-pos">
            Step <b className="vb-num">{i + 1}</b> of <b className="vb-num">{steps.length}</b>
          </span>
          <span className="vb-replay-pips" aria-hidden="true">
            {steps.map((x, n) => (
              <i key={n} className={cx(n <= i && 'is-on', x.ok === false && 'is-bad')} />
            ))}
          </span>
        </div>
      </div>
      <div className="vb-replay-side">
        <ol className="vb-replay-steps">
          {steps.map((x, n) => (
            <li key={n}>
              <button
                type="button"
                className={cx('vb-replay-step', n === i && 'is-on', x.ok === false && 'is-bad')}
                aria-current={n === i ? 'step' : undefined}
                onClick={() => {
                  setPlaying(false);
                  go(n);
                }}
              >
                <span className="vb-replay-n vb-num">{n + 1}</span>
                <span className="vb-replay-txt">
                  <b>{x.action}</b> {x.target}
                  {x.note && <span className="vb-replay-note">{x.note}</span>}
                </span>
                {x.ok === false && <Icon name="failed" size={14} className="vb-tone-danger" />}
              </button>
            </li>
          ))}
        </ol>
        {outcome && (
          <div className={cx('vb-replay-out', outcome.ok ? 'is-ok' : 'is-bad')}>
            <Icon name={outcome.ok ? 'passed' : 'failed'} size={16} />
            {outcome.text}
          </div>
        )}
      </div>
    </div>
  );
}
