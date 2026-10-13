import { createPortal } from 'react-dom';
import * as React from 'react';
import { cx, useUid, Icon, IconName, AppIcon, HarnessApp } from './core';

/* ---------------- Field wrapper ---------------- */

interface FieldBits {
  label?: React.ReactNode | undefined;
  hint?: React.ReactNode | undefined;
  error?: React.ReactNode | undefined;
}
function Field({
  id,
  label,
  hint,
  error,
  children,
  className,
}: FieldBits & { id: string; children: React.ReactNode; className?: string | undefined }) {
  return (
    <div className={cx('vb-field', !!error && 'has-error', className)}>
      {label && (
        <label className="vb-field-label" id={id + '-label'} htmlFor={id}>
          {label}
        </label>
      )}
      {children}
      {error ? (
        <div className="vb-field-msg vb-field-error" id={id + '-msg'}>
          <Icon name="review" size={14} />
          {error}
        </div>
      ) : hint ? (
        <div className="vb-field-msg" id={id + '-msg'}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- Input ---------------- */

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: React.ReactNode | undefined;
  hint?: React.ReactNode | undefined;
  /** Error message; turns the field into its error state. */
  error?: React.ReactNode | undefined;
  /** Leading icon, e.g. search. */
  icon?: IconName | undefined;
  /** Render a textarea instead (rows via `rows`). */
  multiline?: boolean | undefined;
  rows?: number | undefined;
  /** Monospace value: IDs, keys, commands. */
  mono?: boolean | undefined;
  /** Show a clear button inside the field while it has text (Escape clears too). Default on for search fields: icon="search" or type="search". */
  clearable?: boolean | undefined;
}
/** Text field with label, hint and error. 36px; textarea when multiline. Search fields get a clear button. */
export const Input = React.forwardRef<HTMLInputElement & HTMLTextAreaElement, InputProps>(function Input(
  { label, hint, error, icon, multiline, rows = 4, mono, clearable, id, className, ...rest },
  ref,
) {
  const auto = useUid('vb-in');
  const fid = id || auto;
  const describedBy = error || hint ? fid + '-msg' : undefined;
  const canClear = !multiline && (clearable ?? (icon === 'search' || rest.type === 'search'));
  const own = React.useRef<HTMLInputElement | null>(null);
  const [typed, setTyped] = React.useState(!!(rest.defaultValue ?? ''));
  const hasText = rest.value !== undefined ? String(rest.value ?? '').length > 0 : typed;
  const setRef = (el: HTMLInputElement | null) => {
    own.current = el;
    if (typeof ref === 'function') ref(el as HTMLInputElement & HTMLTextAreaElement);
    else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = el;
  };
  // Clear through the native setter and an input event, so controlled and uncontrolled fields both see onChange('').
  const clear = () => {
    const el = own.current;
    if (!el) return;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    set?.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    setTyped(false);
    el.focus();
  };
  const common = {
    id: fid,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
    className: cx('vb-input', mono && 'is-mono', icon && 'has-icon', canClear && 'has-clear'),
  } as const;
  return (
    <Field id={fid} label={label} hint={hint} error={error} className={className}>
      <div className="vb-input-wrap">
        {icon && <Icon name={icon} className="vb-input-icon" />}
        {multiline ? (
          <textarea
            ref={ref}
            rows={rows}
            {...(rest as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
            {...common}
          />
        ) : (
          <input
            ref={setRef}
            {...rest}
            {...common}
            onChange={(e) => {
              setTyped(e.currentTarget.value.length > 0);
              rest.onChange?.(e);
            }}
            onKeyDown={(e) => {
              if (canClear && e.key === 'Escape' && e.currentTarget.value) {
                e.preventDefault();
                clear();
              }
              rest.onKeyDown?.(e);
            }}
          />
        )}
        {canClear && hasText && (
          <button
            type="button"
            className="vb-input-clear"
            aria-label="Clear"
            title="Clear"
            onMouseDown={(e) => e.preventDefault()}
            onClick={clear}
          >
            <Icon name="close" size={14} />
          </button>
        )}
      </div>
    </Field>
  );
});

/* ---------------- Select ---------------- */

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean | undefined;
  /** Leading system icon, shown in the list and in the closed field. */
  icon?: IconName | undefined;
  /** Leading app mark instead of an icon (harnesses, models). */
  app?: HarnessApp | undefined;
  /** Icon colour: neutral (text-muted, default), accent, success, warning, danger, or subtle (text-subtle). */
  tone?: ('neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'subtle') | undefined;
}
function OptionMark({ o }: { o: SelectOption }) {
  if (o.app) return <AppIcon app={o.app} state={o.disabled ? 'missing' : 'ready'} className="vb-select-mark" />;
  if (o.icon) return <Icon name={o.icon} className={cx('vb-select-mark', 'vb-tone-' + (o.tone || 'neutral'))} />;
  return null;
}
export interface SelectProps {
  label?: React.ReactNode | undefined;
  hint?: React.ReactNode | undefined;
  error?: React.ReactNode | undefined;
  options: SelectOption[];
  /** Controlled value. */
  value?: string | undefined;
  /** Uncontrolled initial value. */
  defaultValue?: string | undefined;
  /** Called with the chosen option's value. */
  onChange?: ((value: string) => void) | undefined;
  /** Shown in text-subtle when nothing is chosen. */
  placeholder?: string | undefined;
  /** Form field name: a hidden input carries the value. */
  name?: string | undefined;
  disabled?: boolean | undefined;
  id?: string | undefined;
  className?: string | undefined;
  /** Start open (previews, canvases). */
  defaultOpen?: boolean | undefined;
}

const ROW = 32,
  PAD = 5,
  EDGE = 8,
  MAX_ROWS = 10;
/**
 * Where the list goes so the chosen option sits exactly over the trigger: top, height and scroll.
 * The list grows up and down from the chosen row as far as the viewport allows (like a native macOS
 * pop-up), so it may be shorter than its content and scroll. If that would leave it under 4 rows,
 * alignment gives way to a normal clamped list.
 */
function placeList(trigger: DOMRect, index: number, count: number) {
  const vh = window.innerHeight;
  const content = count * ROW + PAD * 2;
  const maxH = Math.min(content, MAX_ROWS * ROW + PAD * 2, vh - EDGE * 2);
  const target = trigger.top + (trigger.height - ROW) / 2; // screen y of the chosen row
  const y = PAD + index * ROW; // its y inside the list
  const below = Math.min(content - y, vh - EDGE - target); // chosen row and what follows
  const above = Math.min(y, target - EDGE, maxH - below); // what precedes it
  if (below >= ROW && above >= 0 && above + below >= Math.min(content, 4 * ROW + PAD * 2)) {
    return { top: target - above, height: above + below, scroll: y - above };
  }
  const top = Math.max(EDGE, Math.min(target - y, vh - EDGE - maxH));
  return { top, height: maxH, scroll: Math.max(0, Math.min(content - maxH, y - (target - top))) };
}

/**
 * Select field: an Input-styled trigger opening a listbox placed so the chosen option lands exactly
 * where the trigger shows it, text over text. Arrow keys, Home/End and type-ahead move; Enter or Space picks; Escape closes.
 */
export function Select({
  label,
  hint,
  error,
  options,
  value: valueProp,
  defaultValue,
  onChange,
  placeholder,
  name,
  disabled,
  id,
  className,
  defaultOpen = false,
}: SelectProps) {
  const auto = useUid('vb-sel');
  const fid = id || auto;
  const [inner, setInner] = React.useState(defaultValue ?? '');
  const value = valueProp ?? inner;
  const [open, setOpen] = React.useState(defaultOpen);
  const sel = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const [active, setActive] = React.useState(sel);
  const [pos, setPos] = React.useState<{
    top: number;
    left: number;
    width: number;
    height: number;
    scroll: number;
  } | null>(null);
  const btn = React.useRef<HTMLButtonElement>(null);
  const list = React.useRef<HTMLDivElement>(null);
  const typed = React.useRef({ s: '', t: 0 });
  const current = options.find((o) => o.value === value);

  const place = () => {
    if (!btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const p = placeList(r, sel, options.length);
    const left = Math.max(EDGE, Math.min(r.left, window.innerWidth - EDGE - r.width));
    setPos({ ...p, left, width: r.width });
  };
  React.useLayoutEffect(() => {
    if (open) {
      setActive(sel);
      place();
    } else setPos(null);
  }, [open]);
  React.useLayoutEffect(() => {
    if (open && pos && list.current) {
      list.current.scrollTop = pos.scroll;
      if (!defaultOpen || document.activeElement === btn.current) list.current.focus({ preventScroll: true });
    }
  }, [pos]);
  React.useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    const away = (e: Event) => {
      if (!list.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', down);
    window.addEventListener('resize', away);
    window.addEventListener('scroll', away, true);
    return () => {
      document.removeEventListener('mousedown', down);
      window.removeEventListener('resize', away);
      window.removeEventListener('scroll', away, true);
    };
  }, [open]);
  React.useEffect(() => {
    if (!open || !list.current) return;
    const el = list.current.querySelector<HTMLElement>(`[data-i="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const close = (focus = true) => {
    setOpen(false);
    if (focus) btn.current?.focus();
  };
  const pick = (i: number) => {
    const o = options[i];
    if (!o || o.disabled) return;
    if (valueProp === undefined) setInner(o.value);
    if (o.value !== value) onChange?.(o.value);
    close();
  };
  const step = (from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i < options.length; i += dir) if (!options[i]!.disabled) return i;
    return from;
  };
  const typeahead = (k: string) => {
    const now = Date.now();
    const t = typed.current;
    t.s = (now - t.t > 600 ? '' : t.s) + k.toLowerCase();
    t.t = now;
    const start = t.s.length === 1 ? active + 1 : active;
    for (let n = 0; n < options.length; n++) {
      const i = (start + n) % options.length;
      if (!options[i]!.disabled && options[i]!.label.toLowerCase().startsWith(t.s)) return i;
    }
    return -1;
  };
  const onTriggerKey = (e: React.KeyboardEvent) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      setOpen(true);
    }
  };
  const onListKey = (e: React.KeyboardEvent) => {
    const k = e.key;
    if (k === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => step(a, 1));
    } else if (k === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => step(a, -1));
    } else if (k === 'Home') {
      e.preventDefault();
      setActive(step(-1, 1));
    } else if (k === 'End') {
      e.preventDefault();
      setActive(step(options.length, -1));
    } else if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      pick(active);
    } else if (k === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (k === 'Tab') close(false);
    else if (k.length === 1 && !e.metaKey && !e.ctrlKey) {
      const i = typeahead(k);
      if (i >= 0) setActive(i);
    }
  };

  const listbox = open && pos && (
    <div
      ref={list}
      role="listbox"
      id={fid + '-list'}
      tabIndex={-1}
      aria-labelledby={label ? fid + '-label' : undefined}
      aria-activedescendant={fid + '-opt-' + active}
      onKeyDown={onListKey}
      className="vb-select-list"
      style={{ top: pos.top, left: pos.left, minWidth: pos.width, maxHeight: pos.height }}
    >
      {options.map((o, i) => (
        <div
          key={o.value}
          id={fid + '-opt-' + i}
          data-i={i}
          role="option"
          aria-selected={o.value === value}
          aria-disabled={o.disabled || undefined}
          className={cx('vb-select-opt', i === active && 'is-active', o.value === value && 'is-chosen')}
          onMouseMove={() => {
            if (!o.disabled && i !== active) setActive(i);
          }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => pick(i)}
        >
          <OptionMark o={o} />
          <span className="vb-select-opt-label">{o.label}</span>
          {o.value === value && <Icon name="check" size={16} className="vb-select-check" />}
        </div>
      ))}
    </div>
  );

  return (
    <Field id={fid} label={label} hint={hint} error={error} className={className}>
      <div className="vb-select-wrap">
        <button
          ref={btn}
          type="button"
          id={fid}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? fid + '-list' : undefined}
          aria-labelledby={label ? `${fid}-label ${fid}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? fid + '-msg' : undefined}
          className={cx('vb-input', 'vb-select', open && 'is-open')}
          onClick={() => setOpen(!open)}
          onKeyDown={onTriggerKey}
        >
          {current && <OptionMark o={current} />}
          <span className={cx('vb-select-value', !current && 'is-placeholder')}>
            {current ? current.label : placeholder || ' '}
          </span>
          <Icon name="chevron" size={14} className="vb-select-chev" />
        </button>
        {name && <input type="hidden" name={name} value={value} />}
      </div>
      {listbox && createPortal(listbox, document.body)}
    </Field>
  );
}

/* ---------------- Checkbox ---------------- */

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: React.ReactNode;
  hint?: React.ReactNode | undefined;
  /** Mixed state for "select all" over a partial selection. */
  indeterminate?: boolean | undefined;
}
/** Native checkbox with a 16px box drawn in tokens; the whole row is the hit area. */
export function Checkbox({ label, hint, indeterminate, id, className, ...rest }: CheckboxProps) {
  const auto = useUid('vb-cb');
  const fid = id || auto;
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return (
    <div className={cx('vb-check', className)}>
      <input ref={ref} type="checkbox" id={fid} {...rest} aria-describedby={hint ? fid + '-msg' : undefined} />
      <span className="vb-check-box" aria-hidden="true">
        <Icon name="check" size={12} className="vb-check-tick" />
        <i className="vb-check-dash" />
      </span>
      <label htmlFor={fid}>
        {label}
        {hint && (
          <span className="vb-check-hint" id={fid + '-msg'}>
            {hint}
          </span>
        )}
      </label>
    </div>
  );
}

/* ---------------- Switch ---------------- */

export interface SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean;
  onCheckedChange?: ((checked: boolean) => void) | undefined;
  label: React.ReactNode;
}
/** On/off for a setting that applies immediately (role="switch"). Use Checkbox inside forms that submit. */
export function Switch({ checked, onCheckedChange, label, id, className, disabled, ...rest }: SwitchProps) {
  const auto = useUid('vb-sw');
  const fid = id || auto;
  return (
    <div className={cx('vb-switch', disabled && 'is-disabled', className)}>
      <button
        type="button"
        role="switch"
        id={fid}
        aria-checked={checked}
        disabled={disabled}
        {...rest}
        className="vb-switch-track"
        onClick={() => onCheckedChange?.(!checked)}
      >
        <i className="vb-switch-thumb" />
      </button>
      <label htmlFor={fid}>{label}</label>
    </div>
  );
}

/* ---------------- Tabs ---------------- */

export interface TabItem {
  id: string;
  label: React.ReactNode;
  count?: number | undefined;
  disabled?: boolean | undefined;
}
export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  /** Accessible name of the tab list. */ label: string;
  className?: string | undefined;
}
/** Underlined tab bar (role="tablist") with arrow-key navigation. The consumer renders the active panel. */
export function Tabs({ items, value, onChange, label, className }: TabsProps) {
  const refs = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const enabled = items.filter((i) => !i.disabled);
  const onKey = (e: React.KeyboardEvent) => {
    const idx = enabled.findIndex((i) => i.id === value);
    let next = -1;
    if (e.key === 'ArrowRight') next = (idx + 1) % enabled.length;
    if (e.key === 'ArrowLeft') next = (idx - 1 + enabled.length) % enabled.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = enabled.length - 1;
    if (next >= 0 && enabled[next]) {
      e.preventDefault();
      onChange(enabled[next]!.id);
      refs.current[enabled[next]!.id]?.focus();
    }
  };
  return (
    <div role="tablist" aria-label={label} className={cx('vb-tabs', className)} onKeyDown={onKey}>
      {items.map((t) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[t.id] = el;
          }}
          type="button"
          role="tab"
          id={'tab-' + t.id}
          aria-selected={t.id === value}
          tabIndex={t.id === value ? 0 : -1}
          disabled={t.disabled}
          className={cx('vb-tab', t.id === value && 'is-active')}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.count !== undefined && <span className="vb-tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Score controls: Rating, Slider, Thumbs ----------------
 * One row each: the label (and anything after it, like an info mark) on the left, a segmented control on the right.
 * All three controls share the Segmented track and are the same width (218px), so stacked criteria line up. */

const SEG = 32,
  GAP = 2,
  CELLS = 5;
const TRACK_W = CELLS * SEG + (CELLS - 1) * GAP; // 168: five 32px cells

function ScoreRow({
  labelId,
  label,
  className,
  children,
}: {
  labelId: string;
  label: React.ReactNode;
  className?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className={cx('vb-score', className)}>
      <span id={labelId} className="vb-score-label">
        {label}
      </span>
      {children}
    </div>
  );
}

/* ---------------- Slider ---------------- */

export interface SliderProps {
  label: React.ReactNode;
  value: number;
  onValueChange?: ((v: number) => void) | undefined;
  min?: number | undefined;
  max?: number | undefined;
  step?: number | undefined;
  /** Formats the value for screen readers ("76 / 100"). The value cell shows the plain number. */
  format?: ((v: number) => string) | undefined;
  /** Not scored yet: no fill, the thumb waits at the start in grey and the value cell shows "–" until the first change. */
  unset?: boolean | undefined;
  /** Shows the value without letting it change (a submitted grading). */
  readOnly?: boolean | undefined;
  id?: string | undefined;
  className?: string | undefined;
}
/** A score on a continuous scale, in the segmented track: drag the round thumb anywhere; the fill runs from the start to the thumb. */
export function Slider({
  label,
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  format,
  unset,
  readOnly,
  id,
  className,
}: SliderProps) {
  const lid = useUid('vb-sl');
  const track = React.useRef<HTMLDivElement>(null);
  const [dragged, setDragged] = React.useState<number | null>(null);
  const draft = React.useRef<number | null>(null);
  const empty = unset && dragged === null;
  const v = dragged ?? (unset ? min : Math.max(min, Math.min(max, value)));
  const T = 22,
    R = T / 2,
    IN = 3; // thumb, and its inset from the fill's edge on every side (28px cell − 22px thumb) / 2
  const left = IN + ((v - min) / (max - min)) * (TRACK_W - T - 2 * IN); // thumb's left edge
  const set = (n: number) => {
    if (readOnly) return;
    const q = Math.round((Math.max(min, Math.min(max, n)) - min) / step) * step + min;
    onValueChange?.(q);
  };
  const fromX = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return min + ((clientX - r.left - IN - R) / (r.width - T - 2 * IN)) * (max - min);
  };
  const onDown = (e: React.PointerEvent) => {
    if (readOnly) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const next = Math.round(Math.max(min, Math.min(max, fromX(e.clientX))) / step) * step;
    draft.current = next;
    setDragged(next);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!readOnly && (e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) {
      const next = Math.round(Math.max(min, Math.min(max, fromX(e.clientX))) / step) * step;
      draft.current = next;
      setDragged(next);
    }
  };
  const onUp = (e: React.PointerEvent) => {
    if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      if (draft.current !== null) set(draft.current);
      draft.current = null;
      setDragged(null);
    }
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (readOnly) return;
    const big = (max - min) / 10;
    const d = (
      { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: big, PageDown: -big } as Record<
        string,
        number
      >
    )[e.key];
    if (d !== undefined) {
      e.preventDefault();
      set((unset ? min : v) + (e.shiftKey ? d * 10 : d));
    }
    if (e.key === 'Home') {
      e.preventDefault();
      set(min);
    }
    if (e.key === 'End') {
      e.preventDefault();
      set(max);
    }
  };
  return (
    <ScoreRow
      labelId={lid}
      label={label}
      className={cx('vb-score-slider', empty && 'is-unset', readOnly && 'is-readonly', className)}
    >
      <span className="vb-scoreseg">
        <span
          ref={track}
          id={id}
          role="slider"
          tabIndex={0}
          aria-labelledby={lid}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={empty ? undefined : v}
          aria-valuetext={empty ? 'Not rated' : format ? format(v) : undefined}
          aria-readonly={readOnly || undefined}
          className="vb-scoreseg-track"
          style={{ width: TRACK_W }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => {
            draft.current = null;
            setDragged(null);
          }}
          onKeyDown={onKey}
        >
          {!empty && <i className="vb-scoreseg-fill" style={{ width: left + T + IN }} />}
          <i className="vb-scoreseg-thumb" style={{ left }} />
        </span>
        <span className="vb-scoreseg-val" aria-hidden="true">
          {empty ? '–' : v}
        </span>
      </span>
    </ScoreRow>
  );
}

/* ---------------- Rating ---------------- */

export interface RatingProps {
  label: React.ReactNode;
  /** 0 = not rated yet. */ value: number;
  onChange?: ((v: number) => void) | undefined;
  max?: number | undefined;
  /** Shows the stars without letting them change (a submitted grading). */ readOnly?: boolean | undefined;
  className?: string | undefined;
}
/** A 1–5 score as five star segments; the fill runs from the first star to the chosen one, and a sixth cell shows "3/5". A radio group: arrow keys move, click sets. */
export function Rating({ label, value, onChange, max = 5, readOnly, className }: RatingProps) {
  const lid = useUid('vb-rt');
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const [hover, setHover] = React.useState(0);
  const shown = (!readOnly && hover) || value;
  const cell = TRACK_W / max - (GAP * (max - 1)) / max; // keeps the track 168px for any max
  const fillW = shown ? shown * cell + (shown - 1) * GAP : 0;
  const pick = (n: number) => {
    if (!readOnly) onChange?.(n);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (readOnly) return;
    const d =
      e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = Math.max(1, Math.min(max, (value || 0) + d));
    pick(n);
    refs.current[n - 1]?.focus();
  };
  return (
    <ScoreRow labelId={lid} label={label} className={cx('vb-score-rating', readOnly && 'is-readonly', className)}>
      <span className="vb-scoreseg">
        <span
          role="radiogroup"
          aria-labelledby={lid}
          className="vb-scoreseg-track"
          style={{ width: TRACK_W }}
          onKeyDown={onKey}
          onMouseLeave={() => setHover(0)}
        >
          {shown > 0 && (
            <i
              className={cx('vb-scoreseg-fill', !!hover && hover !== value && 'is-preview')}
              style={{ width: fillW }}
            />
          )}
          {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              ref={(el) => {
                refs.current[n - 1] = el;
              }}
              type="button"
              role="radio"
              aria-checked={value === n}
              aria-label={`${n} of ${max}`}
              aria-readonly={readOnly || undefined}
              tabIndex={(value ? value === n : n === 1) ? 0 : -1}
              className={cx('vb-scoreseg-star', n <= shown && 'is-on')}
              style={{ width: cell }}
              onMouseEnter={() => {
                if (!readOnly) setHover(n);
              }}
              onClick={() => pick(n)}
            >
              <Icon name={n <= shown ? 'star' : 'star-outline'} size={16} />
            </button>
          ))}
        </span>
        <span className="vb-scoreseg-val" aria-hidden="true">
          {value ? `${value}/${max}` : '–'}
        </span>
      </span>
    </ScoreRow>
  );
}

/* ---------------- Thumbs ---------------- */

export type ThumbsValue = 'up' | 'down' | null;
export interface ThumbsProps {
  label: React.ReactNode;
  value: ThumbsValue;
  onChange?: ((v: ThumbsValue) => void) | undefined;
  /** Words for the two answers. Default Pass / Fail. */ upLabel?: string | undefined;
  downLabel?: string | undefined;
  /** Shows the answer without letting it change (a submitted grading). */ readOnly?: boolean | undefined;
  className?: string | undefined;
}
/** Pass/fail as a two-segment control (a radio group): the chosen one lifts, up in status-success, down in status-danger. Clicking the chosen one clears it. */
export function Thumbs({
  label,
  value,
  onChange,
  upLabel = 'Pass',
  downLabel = 'Fail',
  readOnly,
  className,
}: ThumbsProps) {
  const lid = useUid('vb-th');
  const btn = (v: 'up' | 'down', word: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={value === v}
      aria-label={word}
      aria-readonly={readOnly || undefined}
      tabIndex={value ? (value === v ? 0 : -1) : v === 'up' ? 0 : -1}
      className={cx('vb-scoreseg-thumb-opt', 'vb-thumb-' + v, value === v && 'is-on')}
      onClick={() => {
        if (!readOnly) onChange?.(value === v ? null : v);
      }}
      onKeyDown={(e) => {
        if (!readOnly && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
          e.preventDefault();
          onChange?.(v === 'up' ? 'down' : 'up');
        }
      }}
    >
      <Icon name={v === 'up' ? 'like' : 'dislike'} size={16} />
      {word}
    </button>
  );
  return (
    <ScoreRow labelId={lid} label={label} className={cx('vb-score-thumbs', readOnly && 'is-readonly', className)}>
      <span className="vb-scoreseg">
        <span role="radiogroup" aria-labelledby={lid} className="vb-scoreseg-pair">
          {btn('down', downLabel)}
          {btn('up', upLabel)}
        </span>
      </span>
    </ScoreRow>
  );
}
