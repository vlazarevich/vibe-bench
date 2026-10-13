import { createPortal } from 'react-dom';
import * as React from 'react';
import { cx, useUid, Icon, IconName, IconButton, Button, ButtonProps } from './core';

type TriggerEl = React.ReactElement<React.HTMLAttributes<HTMLElement> & { ref?: React.Ref<HTMLElement> | undefined }>;

function useOutside(open: boolean, refs: Array<React.RefObject<HTMLElement | null>>, close: () => void) {
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!refs.some((r) => r.current && r.current.contains(e.target as Node))) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
}

/* ---------------- Popover ---------------- */

export interface PopoverProps {
  /** The element that opens it (a Button, Chip…). It receives aria-expanded and the click handler. Or use triggerLabel for a plain Button. */
  trigger?: TriggerEl | undefined;
  /** Shorthand trigger: a Button with this text (and triggerIcon, triggerVariant, triggerSize). */
  triggerLabel?: React.ReactNode | undefined;
  triggerIcon?: IconName | undefined;
  triggerVariant?: ButtonProps['variant'] | undefined;
  triggerSize?: ButtonProps['size'] | undefined;
  /** Header: 15px semibold in the display face, the same in every popover. */
  title?: React.ReactNode | undefined;
  /** On the title line after the title, in code-sm text-muted: a version, a revision. */
  titleMeta?: React.ReactNode | undefined;
  /** Under the title in 13px text-muted. */
  description?: React.ReactNode | undefined;
  children?: React.ReactNode | undefined;
  /** Controlled open state; omit for uncontrolled. */
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  defaultOpen?: boolean | undefined;
  /** Horizontal alignment to the trigger. Default start. */
  align?: ('start' | 'end') | undefined;
  /** Accessible name (role="dialog"). Defaults to the title when that's text. */
  label?: string | undefined;
  /** Fixed width in px; otherwise it fits its content (220px minimum). */
  width?: number | undefined;
  /** Inner padding preset. Default md (12/14px); none for menus and custom layouts. */
  padding?: ('md' | 'none') | undefined;
  className?: string | undefined;
  /** Overrides the role (Menu uses "menu"). */
  role?: string | undefined;
}
/**
 * Floating panel on bg-raised next to its trigger. It renders into document.body with fixed position, so dialogs,
 * scroll areas and overflow never clip it; it sits below the trigger, flips above when there's no room, and follows on scroll.
 * Click toggles; Escape or a click outside closes and returns focus.
 */
export function Popover({
  trigger: triggerProp,
  triggerLabel,
  triggerIcon,
  triggerVariant,
  triggerSize,
  title,
  titleMeta,
  description,
  children,
  open: openProp,
  onOpenChange,
  defaultOpen = false,
  align = 'start',
  label,
  width,
  padding = 'md',
  className,
  role = 'dialog',
}: PopoverProps) {
  const trigger = (triggerProp || (
    <Button variant={triggerVariant} size={triggerSize} icon={triggerIcon}>
      {triggerLabel}
    </Button>
  )) as TriggerEl;
  const titleId = useUid('vb-pop-t');
  const [inner, setInner] = React.useState(defaultOpen);
  const open = openProp ?? inner;
  const set = (v: boolean) => {
    if (openProp === undefined) setInner(v);
    onOpenChange?.(v);
  };
  const wrap = React.useRef<HTMLSpanElement>(null);
  const pop = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);
  const id = useUid('vb-pop');
  const close = () => {
    set(false);
    (wrap.current?.querySelector('[aria-controls="' + id + '"]') as HTMLElement | null)?.focus();
  };
  useOutside(open, [wrap, pop], close);
  const place = () => {
    if (!wrap.current || !pop.current) return;
    const r = wrap.current.getBoundingClientRect();
    const w = pop.current.offsetWidth,
      h = pop.current.offsetHeight;
    const vw = window.innerWidth,
      vh = window.innerHeight,
      M = 8,
      GAP = 8;
    let left = align === 'end' ? r.right - w : r.left;
    left = Math.max(M, Math.min(left, vw - M - w));
    let top = r.bottom + GAP;
    if (top + h > vh - M && r.top - GAP - h >= M) top = r.top - GAP - h;
    top = Math.round(top);
    left = Math.round(left);
    setPos((p) => (p && Math.abs(p.top - top) < 1 && Math.abs(p.left - left) < 1 ? p : { top, left }));
  };
  // Re-place after every render while open (content can change size); never set state while closed.
  React.useLayoutEffect(() => {
    if (open) place();
  });
  React.useLayoutEffect(() => {
    if (!open) setPos((p) => (p === null ? p : null));
  }, [open]);
  React.useEffect(() => {
    if (!open) return;
    const h = () => place();
    window.addEventListener('resize', h);
    window.addEventListener('scroll', h, true);
    return () => {
      window.removeEventListener('resize', h);
      window.removeEventListener('scroll', h, true);
    };
  }, [open]);
  const t = React.cloneElement(trigger, {
    'aria-expanded': open,
    'aria-controls': id,
    'aria-haspopup': role === 'menu' ? 'menu' : 'dialog',
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      trigger.props.onClick?.(e);
      set(!open);
    },
  } as React.HTMLAttributes<HTMLElement>);
  const panel = open && (
    <div
      ref={pop}
      id={id}
      role={role}
      aria-label={label || (title == null ? undefined : typeof title === 'string' ? title : undefined)}
      aria-labelledby={!label && title != null && typeof title !== 'string' ? titleId : undefined}
      className={cx('vb-pop', 'vb-pop-' + align, padding === 'none' && 'vb-pop-flush', className)}
      style={Object.assign(
        pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: 'hidden' as const },
        width ? { width, minWidth: 0 } : {},
      )}
    >
      {(title != null || description != null) && (
        <div className="vb-pop-head">
          {title != null && (
            <h2 id={titleId} className="vb-pop-title">
              {title}
              {titleMeta != null && <span className="vb-pop-meta">{titleMeta}</span>}
            </h2>
          )}
          {description != null && <p className="vb-pop-desc">{description}</p>}
        </div>
      )}
      {children != null && children !== false && (
        <div className={cx(title != null || description != null ? 'vb-pop-body' : undefined)}>{children}</div>
      )}
    </div>
  );
  return (
    <span className="vb-pop-wrap" ref={wrap}>
      {t}
      {panel && createPortal(panel, document.body)}
    </span>
  );
}

/* ---------------- Menu ---------------- */

export type MenuItem =
  | {
      id: string;
      label: React.ReactNode;
      icon?: IconName | undefined;
      danger?: boolean | undefined;
      disabled?: boolean | undefined;
      onSelect?: (() => void) | undefined;
    }
  | { divider: true };
export interface MenuProps {
  trigger: TriggerEl;
  items: MenuItem[];
  label: string;
  align?: ('start' | 'end') | undefined;
  /** Start open (previews, canvases). */ defaultOpen?: boolean | undefined;
}
/** Action menu (role="menu") in a Popover. Arrow keys move, Enter runs, Escape closes. Destructive items last, after a divider. */
export function Menu({ trigger, items, label, align = 'end', defaultOpen = false }: MenuProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  const first = React.useRef(true);
  const list = React.useRef<HTMLDivElement>(null);
  const hasIcons = items.some((it) => !('divider' in it) && !!it.icon);
  React.useEffect(() => {
    if (first.current) {
      first.current = false;
      if (defaultOpen) return;
    }
    if (open) (list.current?.querySelector('[role="menuitem"]:not([disabled])') as HTMLElement | null)?.focus();
  }, [open]);
  const onKey = (e: React.KeyboardEvent) => {
    const els = Array.from(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') || []);
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      els[(i + 1) % els.length]?.focus();
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      els[(i - 1 + els.length) % els.length]?.focus();
    }
    if (e.key === 'Tab') setOpen(false);
  };
  return (
    <Popover
      trigger={trigger}
      open={open}
      onOpenChange={setOpen}
      align={align}
      label={label}
      padding="none"
      role="menu"
      className="vb-menu"
    >
      <div ref={list} onKeyDown={onKey} className="vb-menu-list">
        {items.map((it, i) =>
          'divider' in it ? (
            <hr key={'d' + i} className="vb-menu-div" />
          ) : (
            <button
              key={it.id}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              className={cx('vb-menu-item', it.danger && 'is-danger')}
              onClick={() => {
                setOpen(false);
                it.onSelect?.();
              }}
            >
              {it.icon ? <Icon name={it.icon} /> : hasIcons && <span className="vb-menu-slot" aria-hidden="true" />}
              {it.label}
            </button>
          ),
        )}
      </div>
    </Popover>
  );
}

/* ---------------- Tooltip ---------------- */

export interface TooltipProps {
  content: React.ReactNode;
  children: TriggerEl;
  /** Default top; right for collapsed sidebars and rails. */ side?: ('top' | 'bottom' | 'right') | undefined;
  /** Start shown (previews, canvases). */ defaultOpen?: boolean | undefined;
}
/**
 * Short hint on hover and focus (400ms delay), linked by aria-describedby. Not for essential information.
 * Renders into document.body with fixed position, so panels and overflow never clip it; flips to the other side and stays 8px inside the viewport.
 */
export function Tooltip({ content, children, side = 'top', defaultOpen = false }: TooltipProps) {
  const [show, setShow] = React.useState(defaultOpen);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);
  const timer = React.useRef<number | undefined>(undefined);
  const wrap = React.useRef<HTMLSpanElement>(null);
  const tip = React.useRef<HTMLSpanElement>(null);
  const id = useUid('vb-tip');
  const on = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShow(true), 400);
  };
  const off = () => {
    window.clearTimeout(timer.current);
    setShow(false);
  };
  React.useEffect(() => () => window.clearTimeout(timer.current), []);
  React.useLayoutEffect(() => {
    if (!show) {
      setPos(null);
      return;
    }
    const el = (wrap.current?.firstElementChild as HTMLElement | null) || wrap.current;
    if (!el || !tip.current) return;
    const r = el.getBoundingClientRect(),
      w = tip.current.offsetWidth,
      h = tip.current.offsetHeight;
    const vw = window.innerWidth,
      vh = window.innerHeight,
      M = 8,
      G = 6;
    let top: number, left: number;
    if (side === 'right') {
      left = r.right + 8;
      top = r.top + r.height / 2 - h / 2;
      if (left + w > vw - M) left = r.left - 8 - w;
    } else {
      left = r.left + r.width / 2 - w / 2;
      top = side === 'bottom' ? r.bottom + G : r.top - G - h;
      if (side === 'bottom' && top + h > vh - M) top = r.top - G - h;
      if (side === 'top' && top < M) top = r.bottom + G;
    }
    left = Math.max(M, Math.min(left, vw - M - w));
    top = Math.max(M, Math.min(top, vh - M - h));
    setPos({ top, left });
  }, [show, content]);
  const t = React.cloneElement(children, {
    'aria-describedby': id,
    onMouseEnter: on,
    onMouseLeave: off,
    onFocus: on,
    onBlur: off,
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key === 'Escape') off();
      children.props.onKeyDown?.(e);
    },
  } as React.HTMLAttributes<HTMLElement>);
  const bubble = show && (
    <span
      ref={tip}
      aria-hidden="true"
      className={cx('vb-tip', 'vb-tip-' + side, pos && 'is-shown')}
      style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0 }}
    >
      {content}
    </span>
  );
  return (
    <span className="vb-tip-wrap" ref={wrap}>
      {t}
      <span id={id} role="tooltip" className="vb-sr">
        {content}
      </span>
      {bubble && createPortal(bubble, document.body)}
    </span>
  );
}

/* ---------------- Dialog ---------------- */

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  /** Secondary text on the title line, in text-muted body text: an auto-assigned ID ("Run 0144"). */
  titleMeta?: React.ReactNode | undefined;
  description?: React.ReactNode | undefined;
  children?: React.ReactNode | undefined;
  /** Buttons, right-aligned; put the primary (or danger) action last. */
  actions?: React.ReactNode | undefined;
  /** sm 400px, md 520px (default), lg 720px. */
  size?: ('sm' | 'md' | 'lg') | undefined;
  /** Render in place instead of a full-screen overlay (for previews and canvases). */
  inline?: boolean | undefined;
  /** Keep the modal (backdrop, focus trap) inside the nearest positioned ancestor instead of the whole window: a frame on a states board, an embedded prototype. */
  contained?: boolean | undefined;
}
/** Modal dialog (aria-modal) over a dimmed backdrop. Focus moves in and is trapped; Escape and the close button call onClose. */
export function Dialog({
  open,
  onClose,
  title,
  titleMeta,
  description,
  children,
  actions,
  size = 'md',
  inline,
  contained,
}: DialogProps) {
  const box = React.useRef<HTMLDivElement>(null);
  const tid = useUid('vb-dlg');
  React.useEffect(() => {
    if (!open || inline) return;
    const prev = document.activeElement as HTMLElement | null;
    const f =
      box.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.vb-dialog-x)') ||
      box.current?.querySelector<HTMLElement>('button');
    f?.focus();
    return () => prev?.focus();
  }, [open, inline]);
  if (!open) return null;
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
    if (e.key === 'Tab' && box.current) {
      const els = Array.from(
        box.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!els.length) return;
      const first = els[0],
        last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  };
  const panel = (
    <div
      ref={box}
      role="dialog"
      aria-modal={inline ? undefined : true}
      aria-labelledby={tid}
      onKeyDown={onKey}
      className={cx('vb-dialog', 'vb-dialog-' + size)}
    >
      <div className="vb-dialog-head">
        <h2 id={tid}>
          {title}
          {titleMeta != null && <span className="vb-dialog-meta">{titleMeta}</span>}
        </h2>
        <IconButton icon="close" label="Close" size="sm" className="vb-dialog-x" onClick={onClose} />
      </div>
      {description && <p className="vb-dialog-desc">{description}</p>}
      {children && <div className="vb-dialog-body">{children}</div>}
      {actions && <div className="vb-dialog-actions">{actions}</div>}
    </div>
  );
  if (inline) return <div className="vb-dialog-inline">{panel}</div>;
  const overlay = (
    <div
      className={cx('vb-dialog-backdrop', contained && 'is-contained')}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {panel}
    </div>
  );
  return !contained ? createPortal(overlay, document.body) : overlay;
}
