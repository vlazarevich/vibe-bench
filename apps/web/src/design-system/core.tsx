import * as React from 'react';
import { ICONS, APPS } from './icon-data';
import { Tooltip } from './overlays';

export const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

let uid = 0;
/** Stable unique id for aria wiring (React 18 has useId; this keeps the bundle self-contained). */
export function useUid(prefix = 'vb') {
  const ref = React.useRef<string | undefined>(undefined);
  if (!ref.current) ref.current = `${prefix}-${++uid}`;
  return ref.current;
}

/* ---------------- Icon ---------------- */

export type IconName =
  | 'passed'
  | 'running'
  | 'review'
  | 'failed'
  | 'queued'
  | 'runtime'
  | 'offline'
  | 'unavailable'
  | 'start'
  | 'credentials'
  | 'revoke'
  | 'delete'
  | 'copy'
  | 'connect'
  | 'chevron'
  | 'chevron-right'
  | 'key'
  | 'lock'
  | 'mod-text'
  | 'mod-image'
  | 'mod-video'
  | 'mod-speech'
  | 'mod-transcription'
  | 'more'
  | 'search'
  | 'star'
  | 'star-outline'
  | 'info'
  | 'add'
  | 'close'
  | 'plus'
  | 'check'
  | 'nav-suites'
  | 'nav-runs'
  | 'nav-grade'
  | 'nav-reports'
  | 'settings'
  | 'sidebar'
  | 'sun'
  | 'moon'
  | 'like'
  | 'dislike'
  | 'pen'
  | 'folder'
  | 'task'
  | 'link'
  | 'save'
  | 'save-revision'
  | 'slider'
  | 'effort-auto'
  | 'effort-low'
  | 'effort-medium'
  | 'effort-high'
  | 'effort-xhigh'
  | 'effort-max'
  | 'type-text-generation'
  | 'type-text-editing'
  | 'type-image-generation'
  | 'type-image-editing'
  | 'type-image-understanding'
  | 'type-html-static'
  | 'type-html-interactive'
  | 'type-coding-bugfix'
  | 'type-coding-feature'
  | 'type-browser-use'
  | 'layout-side'
  | 'layout-single'
  | 'play'
  | 'pause'
  | 'prev'
  | 'next'
  | 'desktop'
  | 'tablet'
  | 'mobile'
  | 'eye'
  | 'external'
  | 'grader'
  | 'share'
  | 'calendar'
  | 'filter'
  | 'columns'
  | 'reset'
  | 'expand-all'
  | 'collapse-all'
  | 'model'
  | 'size-xs'
  | 'size-s'
  | 'size-m'
  | 'size-l'
  | 'size-xl'
  | 'size-xxl';

export interface IconProps extends Omit<React.SVGAttributes<SVGSVGElement>, 'name'> {
  /** System icon name (Solar line, stroke 1.5). */
  name: IconName;
  /** Pixel size; 16 beside body-sm, 14 in badges. Default 16. */
  size?: number | undefined;
  /** Accessible label. Omit when the icon sits next to text that says the same thing. */
  label?: string | undefined;
  /** Shows this text in a Tooltip on hover and focus; the icon becomes a focusable status mark (use for state shown only as an icon). */
  tooltip?: string | undefined;
  tooltipSide?: ('top' | 'bottom' | 'right') | undefined;
}
/** A system icon in currentColor. Decorative unless given a label. */
export function Icon({ name, size = 16, label, tooltip, tooltipSide = 'bottom', className, ...rest }: IconProps) {
  if (tooltip) {
    return (
      <Tooltip content={tooltip} side={tooltipSide}>
        <span className={cx('vb-ico-tip', className)} tabIndex={0} role="img" aria-label={label || tooltip}>
          <Icon name={name} size={size} />
        </span>
      </Tooltip>
    );
  }
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const };
  return (
    <svg
      {...rest}
      {...a11y}
      className={cx('vb-ico', className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      dangerouslySetInnerHTML={{ __html: ICONS[name] || ICONS.queued || '' }}
    />
  );
}

/* ---------------- AppIcon ---------------- */

export type HarnessApp = 'codex' | 'claude' | 'opencode';
export type CapabilityState = 'ready' | 'installed' | 'missing';
export interface AppIconProps {
  app: HarnessApp;
  /** Missing renders the mark greyed out. Default ready. */
  state?: CapabilityState | undefined;
  size?: number | undefined;
  className?: string | undefined;
}
/** The official app mark for a harness, inlined so the Codex mark takes the text colour. */
export function AppIcon({ app, state = 'ready', size = 16, className }: AppIconProps) {
  const a = APPS[app];
  if (!a) return null;
  return (
    <span className={cx('vb-app', 'vb-app-' + state, className)} data-app={app} aria-hidden="true">
      <svg
        width={size}
        height={size}
        viewBox={a.vb}
        preserveAspectRatio="xMidYMid meet"
        dangerouslySetInnerHTML={{ __html: a.body }}
      />
    </span>
  );
}

/* ---------------- Button ---------------- */

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary: the one main action of a view. secondary: an important action that isn't the main one (accent-tinted). ghost: regular. danger: destructive. quiet: low-emphasis, borderless. Default ghost. */
  variant?: ('primary' | 'secondary' | 'ghost' | 'danger' | 'quiet') | undefined;
  /** md 36px (default), sm 32px. */
  size?: ('sm' | 'md') | undefined;
  /** Leading icon. */
  icon?: IconName | undefined;
  /** Trailing icon, e.g. chevron for a menu trigger. */
  iconRight?: IconName | undefined;
  /** Renders a link styled as this button (navigation, not an action). */
  href?: string | undefined;
}
/** Pill-shaped action button. Sentence-case verb labels: "Start run". */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'ghost', size = 'md', icon, iconRight, className, children, type = 'button', href, ...rest },
  ref,
) {
  if (href) {
    const { disabled, form, formAction, name, value, ...aRest } = rest as any;
    return (
      <a {...aRest} href={href} className={cx('vb-btn', 'vb-btn-' + variant, 'vb-btn-' + size, className)}>
        {icon && <Icon name={icon} />}
        {children}
        {iconRight && <Icon name={iconRight} size={14} />}
      </a>
    );
  }
  return (
    <button ref={ref} type={type} {...rest} className={cx('vb-btn', 'vb-btn-' + variant, 'vb-btn-' + size, className)}>
      {icon && <Icon name={icon} />}
      {children}
      {iconRight && <Icon name={iconRight} size={14} />}
    </button>
  );
});

/* ---------------- IconButton ---------------- */

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  /** Required: names the action for screen readers and the tooltip. */
  label: string;
  /** primary: the view's main action as an icon (fill-action). Default quiet. */
  variant?: ('primary' | 'ghost' | 'quiet' | 'danger') | undefined;
  size?: ('sm' | 'md') | undefined;
  /** Show the label in a Tooltip (instead of the native title). It still shows while the button is disabled. */
  tooltip?: boolean | undefined;
  tooltipSide?: ('top' | 'bottom' | 'right') | undefined;
}
/** Square-round button with only an icon. Always labelled. */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon,
    label,
    variant = 'quiet',
    size = 'md',
    tooltip,
    tooltipSide = 'bottom',
    disabled,
    onClick,
    className,
    type = 'button',
    ...rest
  },
  ref,
) {
  // With a tooltip, "disabled" is aria-disabled so hover and focus still reach the button and show why.
  const btn = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={tooltip ? undefined : label}
      {...rest}
      disabled={tooltip ? undefined : disabled}
      aria-disabled={tooltip && disabled ? true : undefined}
      onClick={(e) => {
        if (disabled) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      className={cx(
        'vb-ibtn',
        'vb-ibtn-' + variant,
        'vb-ibtn-' + size,
        tooltip && disabled && 'is-disabled',
        className,
      )}
    >
      <Icon name={icon} />
    </button>
  );
  return tooltip ? (
    <Tooltip content={label} side={tooltipSide}>
      {btn}
    </Tooltip>
  ) : (
    btn
  );
});

/* ---------------- Badge / StatusBadge ---------------- */

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone | undefined;
  icon?: IconName | undefined;
  /** md 24px (default), sm 22px. */
  size?: ('sm' | 'md') | undefined;
}
/** Small uppercase pill: a state or a count. Never colour-only: pair tone with a word or icon. */
export function Badge({ tone = 'neutral', icon, size = 'md', className, children, ...rest }: BadgeProps) {
  return (
    <span {...rest} className={cx('vb-badge', 'vb-badge-' + tone, 'vb-badge-' + size, className)}>
      {icon && <Icon name={icon} size={size === 'sm' ? 12 : 14} />}
      <span className="vb-badge-text">{children}</span>
    </span>
  );
}

export type RunStatus = 'passed' | 'running' | 'review' | 'failed' | 'queued';
const STATUS: Record<RunStatus, { icon: IconName; word: string; tone: Tone }> = {
  passed: { icon: 'passed', word: 'Passed', tone: 'success' },
  running: { icon: 'running', word: 'Running', tone: 'accent' },
  review: { icon: 'review', word: 'Needs review', tone: 'warning' },
  failed: { icon: 'failed', word: 'Failed', tone: 'danger' },
  queued: { icon: 'queued', word: 'Queued', tone: 'neutral' },
};
export interface StatusBadgeProps {
  status: RunStatus;
  /** Overrides the word. */ label?: string | undefined;
  size?: ('sm' | 'md') | undefined;
  className?: string | undefined;
}
/** The state of a run, attempt or grade: icon + word + colour. */
export function StatusBadge({ status, label, size, className }: StatusBadgeProps) {
  const s = STATUS[status] || STATUS.queued;
  return (
    <Badge tone={s.tone} icon={s.icon} size={size} className={className}>
      {label ?? s.word}
    </Badge>
  );
}
export const statusInfo = (s: RunStatus) => STATUS[s] || STATUS.queued;

/* ---------------- Chip ---------------- */

export interface ChipProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  /** Selected state (aria-pressed). Omit for a non-toggle chip. */
  selected?: boolean | undefined;
  onSelectedChange?: ((selected: boolean) => void) | undefined;
  icon?: IconName | undefined;
  /** Leading node instead of an icon, e.g. an AppIcon. */
  leading?: React.ReactNode | undefined;
  /** Trailing node: a count, a state word, a chevron. */
  trailing?: React.ReactNode | undefined;
  /** Trailing icon in text-muted (a criterion's rating control), named by trailingIconLabel. */
  trailingIcon?: IconName | undefined;
  trailingIconLabel?: string | undefined;
}
/** Compact 28px pill button: toggles (entrants, filters) or opens detail (capabilities). */
export const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  {
    selected,
    onSelectedChange,
    icon,
    leading,
    trailing,
    trailingIcon,
    trailingIconLabel,
    className,
    children,
    onClick,
    type = 'button',
    ...rest
  },
  ref,
) {
  const toggle = selected !== undefined;
  return (
    <button
      ref={ref}
      type={type}
      {...rest}
      aria-pressed={toggle ? selected : undefined}
      className={cx('vb-chip', toggle && selected && 'is-selected', className)}
      onClick={(e) => {
        onClick?.(e);
        if (toggle) onSelectedChange?.(!selected);
      }}
    >
      {toggle && selected && !icon && !leading && <Icon name="check" size={14} className="vb-chip-check" />}
      {toggle && !selected && !icon && !leading && <Icon name="plus" size={14} className="vb-chip-plus" />}
      {leading}
      {icon && <Icon name={icon} size={14} />}
      <span className="vb-chip-label">{children}</span>
      {trailingIcon && (
        <span className="vb-chip-ticon" title={trailingIconLabel}>
          <Icon name={trailingIcon} size={14} label={trailingIconLabel} />
        </span>
      )}
      {trailing}
    </button>
  );
});

/* ---------------- ProgressBar ---------------- */

export interface ProgressBarProps {
  value: number;
  max?: number | undefined;
  /** Accessible label, e.g. "3 of 12 tasks". */ label: string;
  /** accent (progress, default) or success (a pass rate). */ tone?: ('accent' | 'success') | undefined;
  className?: string | undefined;
}
/** Thin 6px determinate bar in fill-accent. */
export function ProgressBar({ value, max = 100, label, tone = 'accent', className }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      className={cx('vb-progress', tone === 'success' && 'is-success', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
    >
      <i style={{ width: pct + '%' }} />
    </div>
  );
}
