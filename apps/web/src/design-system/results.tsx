import * as React from 'react';
import { cx, Icon, IconName, Button, IconButton, AppIcon, HarnessApp } from './core';
import { Input } from './forms';
import { Segmented, SegmentedOption } from './grading';
import { Popover } from './overlays';

/* ---------------- Token (the highlighted word in a filter sentence) ---------------- */

type TokenProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { open?: boolean | undefined };
const Token = React.forwardRef<HTMLButtonElement, TokenProps>(function Token(
  { open, className, children, ...rest },
  ref,
) {
  return (
    <button ref={ref} type="button" {...rest} className={cx('vb-token', open && 'is-open', className)}>
      {children}
      <Icon name="chevron" size={14} className="vb-token-chev" />
    </button>
  );
});

/* ---------------- DateRangePicker ---------------- */

export interface DateRange {
  /** Inclusive, as "2026-09-01". */
  from: string;
  to: string;
  /** The preset it came from, if any ("30d"). */
  preset?: (string | null) | undefined;
}
export interface DatePreset {
  id: string;
  label: string;
  /** In the sentence: "the last 30 days". */ phrase: string;
  from: string;
  to: string;
}
export interface DateRangePickerProps {
  value: DateRange;
  onChange: (v: DateRange) => void;
  presets: DatePreset[];
  /** The last selectable day, as "2026-10-11". */
  today: string;
  label: string;
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  defaultOpen?: boolean | undefined;
  align?: ('start' | 'end') | undefined;
  /** token: a highlighted word inside a sentence. button: a ghost Button with a calendar icon (toolbars, headers). Default token. */
  variant?: ('token' | 'button') | undefined;
  className?: string | undefined;
}
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const toD = (s: string) => {
  const [y = 1970, m = 1, d = 1] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const toS = (d: Date) => d.toISOString().slice(0, 10);
const fmt = (s: string, year?: boolean) => {
  const d = toD(s);
  return MONTHS[d.getUTCMonth()]!.slice(0, 3) + ' ' + d.getUTCDate() + (year ? ', ' + d.getUTCFullYear() : '');
};
/** "Sep 1 – Sep 30, 2026"; the year shows once when both ends share it. */
export function formatRange(from: string, to: string) {
  if (from === to) return fmt(from, true);
  const same = from.slice(0, 4) === to.slice(0, 4);
  return fmt(from, !same) + ' – ' + fmt(to, true);
}
/** The words for a range in a sentence: the preset's phrase, or the dates. */
export function rangeSummary(v: DateRange, presets: DatePreset[]) {
  const p = v.preset ? presets.find((x) => x.id === v.preset) : null;
  return p ? p.phrase : formatRange(v.from, v.to);
}
function Month({
  year,
  month,
  from,
  to,
  hover,
  pending,
  today,
  onPick,
  onHover,
}: {
  year: number;
  month: number;
  from: string;
  to: string;
  hover: string | null;
  pending: string | null;
  today: string;
  onPick: (d: string) => void;
  onHover: (d: string | null) => void;
}) {
  const first = new Date(Date.UTC(year, month, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const start = new Date(Date.UTC(year, month, 1 - lead));
  const a = pending ? (hover && hover < pending ? hover : pending) : from;
  const b = pending ? (hover && hover > pending ? hover : pending) : to;
  const days: string[] = [];
  for (let i = 0; i < 42; i++) days.push(toS(new Date(start.getTime() + i * 86400000)));
  return (
    <div className="vb-cal">
      <div className="vb-cal-title">
        {MONTHS[month]} {year}
      </div>
      <div className="vb-cal-grid" role="grid" aria-label={`${MONTHS[month]} ${year}`}>
        {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((w) => (
          <span key={w} className="vb-cal-wd" aria-hidden="true">
            {w}
          </span>
        ))}
        {days.map((d) => {
          const inMonth = toD(d).getUTCMonth() === month;
          const future = d > today;
          if (!inMonth) return <span key={d} className="vb-cal-blank" aria-hidden="true" />;
          const isA = d === a,
            isB = d === b,
            inside = d > a && d < b;
          return (
            <button
              key={d}
              type="button"
              disabled={future}
              tabIndex={future ? -1 : 0}
              className={cx(
                'vb-cal-day',
                inside && 'is-in',
                (isA || isB) && 'is-end',
                isA && 'is-a',
                isB && 'is-b',
                d === today && 'is-today',
              )}
              aria-label={fmt(d, true)}
              aria-pressed={isA || isB}
              onClick={() => onPick(d)}
              onMouseEnter={() => onHover(d)}
              onFocus={() => onHover(d)}
            >
              {toD(d).getUTCDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
/** A period picker: presets beside two month calendars for a custom range. Its trigger is a word in a sentence or a Button. */
export function DateRangePicker({
  value,
  onChange,
  presets,
  today,
  label,
  open,
  onOpenChange,
  defaultOpen,
  align = 'start',
  variant = 'token',
  className,
}: DateRangePickerProps) {
  const [own, setOwn] = React.useState(!!defaultOpen);
  const isOpen = open ?? own;
  const setOpen = (o: boolean) => {
    setOwn(o);
    onOpenChange?.(o);
  };
  const end = toD(value.to);
  const [view, setView] = React.useState({ y: end.getUTCFullYear(), m: end.getUTCMonth() });
  React.useEffect(() => {
    if (isOpen) {
      const e = toD(value.to);
      setView({ y: e.getUTCFullYear(), m: e.getUTCMonth() });
    }
  }, [isOpen]);
  const [pending, setPending] = React.useState<string | null>(null);
  const [hover, setHover] = React.useState<string | null>(null);
  const left = view.m === 0 ? { y: view.y - 1, m: 11 } : { y: view.y, m: view.m - 1 };
  const shift = (n: number) =>
    setView((v) => {
      const t = v.y * 12 + v.m + n;
      return { y: Math.floor(t / 12), m: t % 12 };
    });
  const pick = (d: string) => {
    if (!pending) {
      setPending(d);
      onChange({ from: d, to: d, preset: null });
      return;
    }
    const a = d < pending ? d : pending,
      b = d < pending ? pending : d;
    setPending(null);
    onChange({ from: a, to: b, preset: null });
  };
  const days = Math.round((toD(value.to).getTime() - toD(value.from).getTime()) / 86400000) + 1;
  const summary = rangeSummary(value, presets);
  return (
    <Popover
      label={label}
      open={isOpen}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setPending(null);
          setHover(null);
        }
      }}
      align={align}
      padding="none"
      className={cx('vb-drp', className)}
      trigger={
        variant === 'button' ? (
          <Button icon="calendar" iconRight="chevron" aria-label={`${label}: ${summary}`}>
            {summary.charAt(0).toUpperCase() + summary.slice(1)}
          </Button>
        ) : (
          <Token open={isOpen} aria-label={`${label}: ${summary}`}>
            {summary}
          </Token>
        )
      }
    >
      <div className="vb-drp-panes">
        <div className="vb-drp-presets" role="listbox" aria-label="Presets">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={value.preset === p.id}
              className={cx('vb-facet-level', value.preset === p.id && 'is-on')}
              onClick={() => {
                setPending(null);
                onChange({ from: p.from, to: p.to, preset: p.id });
                const e = toD(p.to);
                setView({ y: e.getUTCFullYear(), m: e.getUTCMonth() });
              }}
            >
              {p.label}
              {value.preset === p.id && <Icon name="check" size={14} />}
            </button>
          ))}
        </div>
        <div className="vb-drp-cals" onMouseLeave={() => setHover(null)}>
          <IconButton
            icon="prev"
            label="Previous month"
            size="sm"
            className="vb-drp-nav vb-drp-prev"
            onClick={() => shift(-1)}
          />
          <IconButton
            icon="next"
            label="Next month"
            size="sm"
            className="vb-drp-nav vb-drp-next"
            disabled={view.y * 12 + view.m >= toD(today).getUTCFullYear() * 12 + toD(today).getUTCMonth()}
            onClick={() => shift(1)}
          />
          <Month
            year={left.y}
            month={left.m}
            from={value.from}
            to={value.to}
            hover={hover}
            pending={pending}
            today={today}
            onPick={pick}
            onHover={setHover}
          />
          <Month
            year={view.y}
            month={view.m}
            from={value.from}
            to={value.to}
            hover={hover}
            pending={pending}
            today={today}
            onPick={pick}
            onHover={setHover}
          />
        </div>
      </div>
      <div className="vb-facet-foot">
        <span>
          {pending
            ? 'Pick the other end of the range'
            : `${formatRange(value.from, value.to)} · ${days} ${days === 1 ? 'day' : 'days'}`}
        </span>
        <Button size="sm" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
    </Popover>
  );
}

/* ---------------- Sparkline ---------------- */

export interface SparklineProps {
  values: Array<number | null>;
  width?: number | undefined;
  height?: number | undefined;
  /** Value range; default 0–100. */ min?: number | undefined;
  max?: number | undefined;
  /** Fills the area under the line. */ area?: boolean | undefined;
  /** Dot on the latest point; default on without area. */ dot?: boolean | undefined;
  label?: string | undefined;
  className?: string | undefined;
}
/** A tiny trend line; gaps where a period has no data; the last point is marked. */
export function Sparkline({
  values,
  width = 96,
  height = 24,
  min = 0,
  max = 100,
  area,
  dot,
  label,
  className,
}: SparklineProps) {
  const n = values.length;
  const x = (i: number) => (n <= 1 ? width / 2 : 2 + (i * (width - 4)) / (n - 1));
  const y = (v: number) => height - 3 - ((Math.max(min, Math.min(max, v)) - min) / (max - min || 1)) * (height - 6);
  const segs: Array<Array<[number, number]>> = [];
  let cur: Array<[number, number]> = [];
  values.forEach((v, i) => {
    if (v == null) {
      if (cur.length) segs.push(cur);
      cur = [];
    } else cur.push([x(i), y(v)]);
  });
  if (cur.length) segs.push(cur);
  let li = n - 1;
  while (li >= 0 && values[li] == null) li--;
  const line = (s: Array<[number, number]>) =>
    s.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  return (
    <svg
      className={cx('vb-spark', className)}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {area &&
        segs.map((s, i) => (
          <path
            key={'a' + i}
            className="vb-spark-area"
            d={line(s) + ` L${s[s.length - 1]![0].toFixed(1)} ${height} L${s[0]![0].toFixed(1)} ${height} Z`}
          />
        ))}
      {segs.map((s, i) => (
        <path key={i} className="vb-spark-line" d={line(s)} />
      ))}
      {li >= 0 && (dot ?? !area) && <circle cx={x(li)} cy={y(values[li] as number)} r={2.5} />}
    </svg>
  );
}

/* ---------------- ScoreCell ---------------- */

export interface ScoreDetail {
  label: string;
  value: React.ReactNode;
}
export interface ScoreCellProps {
  /** Average score 0–100; null when nothing was graded. */
  score: number | null;
  /** Score per period, oldest first; null for periods without grades. */
  trend?: Array<number | null> | undefined;
  /** Grades behind the score; under `minCount` the score is muted. */
  count?: number | undefined;
  minCount?: number | undefined;
  /** Best in its column: bold, in the accent colour. */
  best?: boolean | undefined;
  /** Accessible name and plain card title: "Claude Opus 5.5 on Coding". */
  label?: string | undefined;
  /** Richer card title (icons, bold names); ScoreTable builds it from the row and column. */
  title?: React.ReactNode | undefined;
  /** Card subtitle: the period. */
  period?: string | undefined;
  /** Extra rows on the card: rank, tasks, entrants. */
  details?: ScoreDetail[] | undefined;
  /** Adds a button to the card ("View graded results"). */
  onOpen?: (() => void) | undefined;
  openLabel?: string | undefined;
  className?: string | undefined;
}
/** A table cell of the results grid: just the score over a faint sparkline. Clicking it opens a card with the details. */
export function ScoreCell({
  score,
  trend = [],
  count = 0,
  minCount = 20,
  best,
  label,
  title,
  period,
  details = [],
  onOpen,
  openLabel = 'View graded results',
  className,
}: ScoreCellProps) {
  if (score == null)
    return (
      <div className={cx('vb-scell', 'is-empty', className)} title={label ? label + ': not graded' : 'Not graded'}>
        –
      </div>
    );
  const pts = trend.filter((v) => v != null) as number[];
  const lo = pts.length ? Math.min(...pts) : 0,
    hi = pts.length ? Math.max(...pts) : 100;
  const delta = pts.length > 1 ? Math.round(pts[pts.length - 1]! - pts[0]!) : 0;
  const low = count < minCount;
  const sgn = delta > 0 ? '+' : delta < 0 ? '−' : '±';
  // Sparkline geometry (width 100, height 36, see Sparkline) so the end dot sits on the stretched line without distortion.
  const smin = lo - (hi - lo) * 0.6 - 2,
    smax = hi + 2;
  let li = trend.length - 1;
  while (li >= 0 && trend[li] == null) li--;
  const dot =
    trend.length > 1 && li >= 0
      ? {
          x: 2 + (li * 96) / (trend.length - 1),
          y:
            ((36 - 3 - ((Math.max(smin, Math.min(smax, trend[li] as number)) - smin) / (smax - smin || 1)) * 30) / 36) *
            100,
        }
      : null;
  return (
    <div className="vb-scell-wrap">
      <Popover
        label={label || 'Score details'}
        title={title ?? label}
        description={period}
        align="start"
        width={320}
        className="vb-scard"
        trigger={
          <button
            type="button"
            className={cx('vb-scell', low && 'is-low', best && 'is-best', className)}
            aria-label={`${label ? label + ': ' : ''}${Math.round(score)}${low ? ', few grades' : ''}. Show details`}
          >
            {trend.length > 1 && (
              <span className="vb-scell-trend" aria-hidden="true">
                <Sparkline
                  values={trend}
                  width={100}
                  height={36}
                  min={smin}
                  max={smax}
                  dot={false}
                  className="vb-scell-spark"
                />
                {dot && <i className="vb-scell-dot" style={{ left: dot.x + '%', top: dot.y + '%' }} />}
              </span>
            )}
            <span className="vb-scell-score">{Math.round(score)}</span>
          </button>
        }
      >
        <div className="vb-scard-body">
          <div className="vb-scard-top">
            <span className="vb-scard-score">{Math.round(score)}</span>
            {pts.length > 1 && (
              <span className={cx('vb-scard-delta', delta > 0 ? 'is-up' : delta < 0 ? 'is-down' : undefined)}>
                {sgn}
                {Math.abs(delta)} over the period
              </span>
            )}
          </div>
          {trend.length > 1 && (
            <div className="vb-scard-chart">
              <Sparkline
                values={trend}
                width={288}
                height={64}
                min={lo - (hi - lo) * 0.3 - 2}
                max={hi + 2}
                area
                dot
                label={`Trend from ${Math.round(pts[0]!)} to ${Math.round(pts[pts.length - 1]!)}`}
              />
              <div className="vb-scard-axis">
                <span>{Math.round(hi)}</span>
                <span>{Math.round(lo)}</span>
              </div>
            </div>
          )}
          <dl className="vb-scard-rows">
            <div>
              <dt>Grades</dt>
              <dd>
                {count.toLocaleString('en')}
                {low ? ' · few' : ''}
              </dd>
            </div>
            {details.map((d, i) => (
              <div key={i}>
                <dt>{d.label}</dt>
                <dd>{d.value}</dd>
              </div>
            ))}
          </dl>
          {onOpen && (
            <Button size="sm" variant="secondary" icon="eye" onClick={onOpen}>
              {openLabel}
            </Button>
          )}
        </div>
      </Popover>
    </div>
  );
}

/* ---------------- StatTile ---------------- */

export interface StatTileProps {
  value: number | string;
  label: string;
  icon?: IconName | undefined;
  className?: string | undefined;
}
/** A count in the filter summary row: the number large on top, icon and label below. Tiles share the row's width. */
export function StatTile({ value, label, icon, className }: StatTileProps) {
  return (
    <div className={cx('vb-stat', className)}>
      <span className="vb-stat-val">{typeof value === 'number' ? value.toLocaleString('en') : value}</span>
      <span className="vb-stat-label">
        {icon && <Icon name={icon} size={16} />}
        {label}
      </span>
    </div>
  );
}

/* ---------------- Checklist ---------------- */

export interface ChecklistItem {
  id: string;
  label: string;
  /** Header the item sits under in long lists ("Anthropic"). */
  group?: string | undefined;
  /** Trailing count or note ("3"). */
  meta?: React.ReactNode | undefined;
  icon?: IconName | undefined;
  /** Harness mark instead of an icon. */
  app?: HarnessApp | undefined;
}
export interface ChecklistProps {
  items: ChecklistItem[];
  /** Checked ids. */
  value: string[];
  onChange: (ids: string[]) => void;
  /** Names the list for screen readers. */
  label: string;
  /** Search field above the list. Default: on when there are more than 7 items. */
  search?: boolean | undefined;
  /** Show this many, then "Show N more". */
  limit?: number | undefined;
  /** A tri-state "all" row on top, with this label ("All models"). */
  selectAll?: string | undefined;
  /** Group headers are tri-state checkboxes that check or clear their whole group. */
  groupSelect?: boolean | undefined;
  /** Icon per group header (with groupSelect). */
  groupIcons?: Record<string, IconName> | undefined;
  className?: string | undefined;
}
function Box() {
  return (
    <span className="vb-check-box" aria-hidden="true">
      <Icon name="check" size={12} className="vb-check-tick" />
      <i className="vb-check-dash" />
    </span>
  );
}
/** A checkbox list for filters and column pickers: optional search, an optional "all" row, groups (optionally checkable), counts, and "Show N more". */
export function Checklist({
  items,
  value,
  onChange,
  label,
  search,
  limit,
  selectAll,
  groupSelect,
  groupIcons,
  className,
}: ChecklistProps) {
  const [q, setQ] = React.useState('');
  const [more, setMore] = React.useState(false);
  const ql = q.trim().toLowerCase();
  const hasSearch = search ?? items.length > 7;
  const matched = ql ? items.filter((i) => (i.label + ' ' + (i.group || '')).toLowerCase().indexOf(ql) >= 0) : items;
  const cut = !ql && limit && !more && matched.length > limit + 1;
  const shown = cut ? matched.slice(0, limit) : matched;
  const blocks: Array<{ name?: string | undefined; items: ChecklistItem[] }> = [];
  shown.forEach((i) => {
    const b = blocks[blocks.length - 1];
    if (b && b.name === i.group) b.items.push(i);
    else blocks.push({ name: i.group, items: [i] });
  });
  const on = (id: string) => value.indexOf(id) >= 0;
  const order = (ids: string[]) => items.map((i) => i.id).filter((x) => ids.indexOf(x) >= 0);
  const toggle = (id: string) => onChange(on(id) ? value.filter((x) => x !== id) : order(value.concat(id)));
  const allState = value.length >= items.length ? 'all' : value.length === 0 ? 'none' : 'some';
  return (
    <div className={cx('vb-clist', className)}>
      {hasSearch && (
        <div className="vb-clist-search">
          <Input
            icon="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            aria-label={'Search ' + label.toLowerCase()}
          />
        </div>
      )}
      {selectAll && !ql && (
        <label className="vb-clist-item vb-clist-all">
          <input
            type="checkbox"
            checked={allState === 'all'}
            ref={(el) => {
              if (el) el.indeterminate = allState === 'some';
            }}
            onChange={() => onChange(allState === 'all' ? [] : items.map((i) => i.id))}
          />
          <Box />
          <span className="vb-clist-label">{selectAll}</span>
          <span className="vb-clist-meta">
            {value.length} of {items.length}
          </span>
        </label>
      )}
      <div role="group" aria-label={label}>
        {blocks.map((b, bi) => {
          const ids = items.filter((i) => i.group === b.name).map((i) => i.id);
          const n = ids.filter(on).length;
          return (
            <div
              key={bi}
              role={b.name ? 'group' : undefined}
              aria-label={b.name}
              className={cx(groupSelect && b.name && 'vb-clist-gblock')}
            >
              {b.name &&
                (groupSelect ? (
                  <label className="vb-clist-item vb-clist-ghead">
                    <input
                      type="checkbox"
                      checked={n === ids.length}
                      ref={(el) => {
                        if (el) el.indeterminate = n > 0 && n < ids.length;
                      }}
                      onChange={() =>
                        onChange(
                          n === ids.length
                            ? value.filter((x) => ids.indexOf(x) < 0)
                            : order(value.concat(ids.filter((x) => !on(x)))),
                        )
                      }
                    />
                    <Box />
                    {groupIcons && groupIcons[b.name] && (
                      <Icon name={groupIcons[b.name]!} size={16} className="vb-clist-icon" />
                    )}
                    <span className="vb-clist-label">{b.name}</span>
                  </label>
                ) : (
                  <div className="vb-clist-group">{b.name}</div>
                ))}
              {b.items.map((i) => (
                <label key={i.id} className="vb-clist-item">
                  <input type="checkbox" checked={on(i.id)} onChange={() => toggle(i.id)} />
                  <Box />
                  {i.app ? (
                    <AppIcon app={i.app} size={16} />
                  ) : i.icon ? (
                    <Icon name={i.icon} size={16} className="vb-clist-icon" />
                  ) : null}
                  <span className="vb-clist-label">{i.label}</span>
                  {i.meta != null && <span className="vb-clist-meta">{i.meta}</span>}
                </label>
              ))}
            </div>
          );
        })}
      </div>
      {matched.length === 0 && <div className="vb-clist-empty">Nothing matches “{q}”</div>}
      {cut && (
        <button type="button" className="vb-clist-more" onClick={() => setMore(true)}>
          Show {matched.length - (limit as number)} more
        </button>
      )}
      {!ql && limit && more && matched.length > limit + 1 && (
        <button type="button" className="vb-clist-more" onClick={() => setMore(false)}>
          Show less
        </button>
      )}
    </div>
  );
}

/* ---------------- FilterPanel ---------------- */

export type FilterSection =
  | {
      id: string;
      label: string;
      kind: 'checklist';
      items: ChecklistItem[];
      limit?: number | undefined;
      search?: boolean | undefined;
      groupSelect?: boolean | undefined;
      groupIcons?: Record<string, IconName> | undefined;
      /** Caption above this section ("Models"). */ group?: string | undefined;
    }
  | {
      id: string;
      label: string;
      kind: 'segmented';
      options: SegmentedOption[];
      /** Small uppercase caption above the control. */ caption?: string | undefined;
      group?: string | undefined;
    };
export type FilterValue = Record<string, string[] | string | null | undefined>;
export interface FilterPanelProps {
  sections: FilterSection[];
  /** Per section: checked ids (empty = no filter) or the segmented choice (the first option = no filter). */
  value: FilterValue;
  onChange: (v: FilterValue) => void;
  title?: string | undefined;
  /** Expanded section ids; controlled. */
  open?: string[] | undefined;
  onOpenChange?: ((ids: string[]) => void) | undefined;
  defaultOpen?: string[] | undefined;
  className?: string | undefined;
}
/** A side panel of collapsible filter sections (checklists and segmented choices), with expand, collapse and reset as icon buttons in its header. */
export function FilterPanel({
  sections,
  value,
  onChange,
  title = 'Filters',
  open,
  onOpenChange,
  defaultOpen,
  className,
}: FilterPanelProps) {
  const [own, setOwn] = React.useState<string[]>(defaultOpen || sections.slice(0, 1).map((s) => s.id));
  const opened = open ?? own;
  const setOpened = (ids: string[]) => {
    setOwn(ids);
    onOpenChange?.(ids);
  };
  const active = (s: FilterSection) => {
    const v = value[s.id];
    if (s.kind === 'checklist') return Array.isArray(v) ? v.length : 0;
    return v != null && v !== s.options[0]?.value ? 1 : 0;
  };
  const any = sections.some((s) => active(s) > 0);
  const allIds = sections.map((s) => s.id);
  let lastGroup: string | undefined;
  return (
    <section className={cx('vb-fpanel', className)} aria-label={title}>
      <div className="vb-fpanel-head">
        <h2 className="vb-fpanel-title">{title}</h2>
        <span className="vb-fpanel-actions">
          <IconButton
            icon="expand-all"
            label="Expand all"
            size="sm"
            tooltip
            disabled={opened.length >= allIds.length}
            onClick={() => setOpened(allIds)}
          />
          <IconButton
            icon="collapse-all"
            label="Collapse all"
            size="sm"
            tooltip
            disabled={opened.length === 0}
            onClick={() => setOpened([])}
          />
          <IconButton
            icon="reset"
            label="Reset filters"
            size="sm"
            tooltip
            disabled={!any}
            onClick={() => onChange({})}
          />
        </span>
      </div>
      {sections.map((s) => {
        const isOpen = opened.indexOf(s.id) >= 0;
        const n = active(s);
        const cap = s.group && s.group !== lastGroup ? s.group : null;
        lastGroup = s.group;
        const bodyId = 'vb-fsec-' + s.id;
        return (
          <React.Fragment key={s.id}>
            {cap && <div className="vb-fpanel-group">{cap}</div>}
            <div className={cx('vb-fsec', isOpen && 'is-open')}>
              <button
                type="button"
                className="vb-fsec-head"
                aria-expanded={isOpen}
                aria-controls={bodyId}
                onClick={() => setOpened(isOpen ? opened.filter((x) => x !== s.id) : opened.concat(s.id))}
              >
                <span className="vb-fsec-label">{s.label}</span>
                {n > 0 && (
                  <span className="vb-fsec-badge" aria-label={n + ' selected'}>
                    {n}
                  </span>
                )}
                <Icon name="chevron" size={16} className="vb-fsec-chev" />
              </button>
              {isOpen && (
                <div className="vb-fsec-body" id={bodyId}>
                  {s.kind === 'checklist' ? (
                    <Checklist
                      items={s.items}
                      label={s.label}
                      limit={s.limit ?? (s.groupSelect ? undefined : 5)}
                      search={s.search}
                      groupSelect={s.groupSelect}
                      groupIcons={s.groupIcons}
                      value={(value[s.id] as string[]) || []}
                      onChange={(ids) => onChange(Object.assign({}, value, { [s.id]: ids.length ? ids : null }))}
                    />
                  ) : (
                    <>
                      {s.caption && <div className="vb-fsec-caption">{s.caption}</div>}
                      <Segmented
                        label={s.label}
                        options={s.options}
                        value={(value[s.id] as string) || s.options[0]?.value || ''}
                        onChange={(v) =>
                          onChange(Object.assign({}, value, { [s.id]: v === s.options[0]?.value ? null : v }))
                        }
                        className="vb-fsec-seg"
                      />
                    </>
                  )}
                </div>
              )}
            </div>
          </React.Fragment>
        );
      })}
    </section>
  );
}

/* ---------------- ScoreTable ---------------- */

export interface ScoreColumn {
  id: string;
  label: string;
  icon?: IconName | undefined;
  app?: HarnessApp | undefined;
  /** Tooltip; defaults to the label. */ title?: string | undefined;
}
export interface ScoreRow {
  id: string;
  label: string;
  /** Muted text at the right of the first column, on the label's baseline ("3 models"). */
  meta?: string | undefined;
  icon?: IconName | undefined;
  app?: HarnessApp | undefined;
  /** A small icon right after the label, with a tooltip (an entrant's effort). */
  badge?: { icon: IconName; label: string } | undefined;
  /** One per column, in column order. */
  cells: ScoreCellProps[];
  /** Makes this a collapsible group row; its cells are the group's own scores. */
  children?: ScoreRow[] | undefined;
}
export interface ScoreTableProps {
  columns: ScoreColumn[];
  rows: ScoreRow[];
  /** Names the table for screen readers. */
  label: string;
  /** Header of the first column ("Models"). */
  corner?: string | undefined;
  /** Expanded group ids; controlled. */
  expanded?: string[] | undefined;
  onExpandedChange?: ((ids: string[]) => void) | undefined;
  defaultExpanded?: string[] | undefined;
  /** First column width; default 280. */
  firstWidth?: number | undefined;
  /** Every other column; default 112. */
  colWidth?: number | undefined;
  /** Start scrolled down by this many px (canvas states). */
  initialScrollTop?: number | undefined;
  className?: string | undefined;
}
const ROW_H = 40,
  HEAD_H = 36;
function Mark({
  icon,
  app,
  size = 16,
}: {
  icon?: IconName | undefined;
  app?: HarnessApp | undefined;
  size?: number | undefined;
}) {
  return app ? (
    <AppIcon app={app} size={size} />
  ) : icon ? (
    <Icon name={icon} size={size} className="vb-st-icon" />
  ) : null;
}
/**
 * The Results table: a tree of rows (groups collapse from their chevron), fixed-width score columns that scroll sideways
 * under a fixed first column, and group rows that stick under the header while their children scroll by. Clicking a
 * column header sorts siblings by it.
 */
export function ScoreTable({
  columns,
  rows,
  label,
  corner,
  expanded,
  onExpandedChange,
  defaultExpanded,
  firstWidth = 280,
  colWidth = 112,
  initialScrollTop,
  className,
}: ScoreTableProps) {
  const [own, setOwn] = React.useState<string[]>(defaultExpanded || []);
  const open = expanded ?? own;
  const setOpen = (ids: string[]) => {
    setOwn(ids);
    onExpandedChange?.(ids);
  };
  const [sort, setSort] = React.useState<string | null>(null);
  const scroller = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    if (initialScrollTop && scroller.current) scroller.current.scrollTop = initialScrollTop;
  }, [initialScrollTop]);
  const si = sort ? columns.findIndex((c) => c.id === sort) : -1;
  const order = (list: ScoreRow[]) =>
    si < 0 ? list : list.slice().sort((a, b) => (b.cells[si]?.score ?? -1) - (a.cells[si]?.score ?? -1));
  const tpl = `${firstWidth}px repeat(${columns.length}, ${colWidth}px) minmax(0, 1fr)`;
  const row = (r: ScoreRow, level: number, group: boolean) => {
    const isOpen = group && open.indexOf(r.id) >= 0;
    // Sticky group rows: deeper levels sit lower in the stack, so a group row leaving the top slides under its parent's row.
    const st = group ? { top: HEAD_H + ROW_H * level, zIndex: 10 - level * 2 } : undefined;
    const sth = group ? { top: HEAD_H + ROW_H * level, zIndex: 11 - level * 2 } : undefined;
    return (
      <div
        role="row"
        aria-level={level + 1}
        aria-expanded={group ? isOpen : undefined}
        className={cx('vb-st-row', group && 'is-group', 'is-l' + level)}
      >
        <div role="rowheader" className="vb-st-rh" style={Object.assign({ paddingLeft: 8 + level * 20 }, sth)}>
          {group ? (
            <button
              type="button"
              className="vb-st-toggle"
              aria-expanded={isOpen}
              aria-label={(isOpen ? 'Collapse ' : 'Expand ') + r.label}
              onClick={() => setOpen(isOpen ? open.filter((x) => x !== r.id) : open.concat(r.id))}
            >
              <Icon name="chevron" size={14} className="vb-st-chev" />
            </button>
          ) : (
            <span className="vb-st-spacer" aria-hidden="true" />
          )}
          <Mark icon={r.icon} app={r.app} />
          <span className="vb-st-text">
            <span className="vb-st-label" title={r.label}>
              {r.label}
            </span>
            {r.badge && (
              <Icon name={r.badge.icon} size={16} tooltip={r.badge.label} tooltipSide="right" className="vb-st-badge" />
            )}
            {r.meta && <span className="vb-st-meta">{r.meta}</span>}
          </span>
        </div>
        {columns.map((c, ci) => {
          const cell = r.cells[ci] || { score: null };
          const title = (
            <span className="vb-st-ctitle">
              <span className="vb-st-cpart">
                <Mark icon={r.icon} app={r.app} />
                <b>{r.label}</b>
              </span>
              <span className="vb-st-on">on</span>
              <span className="vb-st-cpart">
                <Mark icon={c.icon} app={c.app} />
                <b>{c.label}</b>
              </span>
            </span>
          );
          return (
            <div key={c.id} role="gridcell" className="vb-st-td" style={st}>
              <ScoreCell title={title} {...cell} />
            </div>
          );
        })}
        <div className="vb-st-fill" style={st} aria-hidden="true" />
      </div>
    );
  };
  const node = (r: ScoreRow, level: number): React.ReactNode => {
    const group = !!(r.children && r.children.length);
    if (!group || open.indexOf(r.id) < 0) return <React.Fragment key={r.id}>{row(r, level, group)}</React.Fragment>;
    return (
      <div key={r.id} role="rowgroup" className="vb-st-group">
        {row(r, level, true)}
        {order(r.children as ScoreRow[]).map((c) => node(c, level + 1))}
      </div>
    );
  };
  return (
    <div ref={scroller} className={cx('vb-st', className)}>
      <div role="treegrid" aria-label={label} className="vb-st-grid" style={{ gridTemplateColumns: tpl }}>
        <div role="row" className="vb-st-row vb-st-headrow">
          <div role="columnheader" className="vb-st-corner">
            {corner}
          </div>
          {columns.map((c) => {
            const on = sort === c.id;
            return (
              <div key={c.id} role="columnheader" aria-sort={on ? 'descending' : 'none'} className="vb-st-th">
                <button
                  type="button"
                  className={cx('vb-st-sort', on && 'is-on')}
                  title={c.title || c.label}
                  onClick={() => setSort(on ? null : c.id)}
                >
                  <span className="vb-st-sortlabel">
                    <Mark icon={c.icon} app={c.app} size={14} />
                    <span>{c.label}</span>
                  </span>
                  <Icon name="chevron" size={12} className="vb-st-sorticon" />
                </button>
              </div>
            );
          })}
          <div className="vb-st-thfill" aria-hidden="true" />
        </div>
        {order(rows).map((r) => node(r, 0))}
      </div>
    </div>
  );
}
