import * as React from 'react';
import {
  cx,
  Icon,
  IconName,
  IconButton,
  AppIcon,
  HarnessApp,
  CapabilityState,
  Button,
  Badge,
  Chip,
  ProgressBar,
  RunStatus,
  statusInfo,
} from './core';
import { Popover, Tooltip } from './overlays';

/* ---------------- Table ---------------- */

export interface TableColumn<T> {
  key: string;
  label: React.ReactNode;
  /** CSS width ("120px", "20%"). Columns without one share the rest. */
  width?: string | undefined;
  align?: ('left' | 'right' | 'center') | undefined;
  /** Monospace muted cell (IDs, durations). */
  mono?: boolean | undefined;
  /** Cell renderer; default shows row[key]. */
  render?: ((row: T) => React.ReactNode) | undefined;
  /** Renders the cell's value as a link (text-accent); clicking it doesn't select the row. Return undefined for no link. */
  href?: ((row: T) => string | undefined) | undefined;
  /** Plain text after the value (or link), separated by a space: a date after "Run 0142". */
  suffix?: ((row: T) => React.ReactNode) | undefined;
  /** Renders the cell as icon-labelled counts, number then icon: 3 [folder] 12 [task]. The label names each for screen readers and hover. */
  counts?: ((row: T) => Array<{ value: number | string; icon: IconName; label: string }>) | undefined;
}
export interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Accessible caption (visually hidden). */
  caption: string;
  selectedKey?: string | undefined;
  onRowClick?: ((row: T) => void) | undefined;
  /** Hide the header row (compact lists). */
  headless?: boolean | undefined;
  className?: string | undefined;
}
/** Data table on bg-surface: label-md header on bg-sunken, row hover, one selected row with the pink leading bar. */
export function Table<T>({
  columns,
  rows,
  rowKey,
  caption,
  selectedKey,
  onRowClick,
  headless,
  className,
}: TableProps<T>) {
  return (
    <table className={cx('vb-table', onRowClick && 'is-clickable', className)}>
      <caption className="vb-sr">{caption}</caption>
      <colgroup>
        {columns.map((c) => (
          <col key={c.key} style={c.width ? { width: c.width } : undefined} />
        ))}
      </colgroup>
      {!headless && (
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" style={{ textAlign: c.align }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {rows.map((r) => {
          const k = rowKey(r);
          return (
            <tr
              key={k}
              aria-selected={selectedKey !== undefined ? k === selectedKey : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onRowClick(r);
                      }
                    }
                  : undefined
              }
            >
              {columns.map((c) => (
                <td key={c.key} className={cx(c.mono && 'is-mono')} style={{ textAlign: c.align }}>
                  {(() => {
                    const v = c.counts ? (
                      <span className="vb-counts">
                        {c.counts(r).map((x, i) => (
                          <span key={i} className="vb-count" title={x.value + ' ' + x.label}>
                            <span aria-hidden="true">{x.value}</span>
                            <Icon name={x.icon} size={14} />
                            <span className="vb-sr">{x.value + ' ' + x.label}</span>
                          </span>
                        ))}
                      </span>
                    ) : c.render ? (
                      c.render(r)
                    ) : (
                      String((r as Record<string, unknown>)[c.key] ?? '')
                    );
                    const h = c.href?.(r);
                    const sx = c.suffix?.(r);
                    const main = h ? (
                      <a className="vb-link" href={h} onClick={(e) => e.stopPropagation()}>
                        {v}
                      </a>
                    ) : (
                      v
                    );
                    return sx != null && sx !== '' ? (
                      <>
                        {main}
                        <span className="vb-cell-suffix">{sx}</span>
                      </>
                    ) : (
                      main
                    );
                  })()}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ---------------- CompactTable ---------------- */

export interface CompactColumn<T> {
  key: string;
  /** Content width in px. Fixed: longer values truncate with an ellipsis and show in full on hover. */
  width: number;
  /** Monospace muted cell (IDs, versions). */
  mono?: boolean | undefined;
  /** Muted text. */
  muted?: boolean | undefined;
  align?: ('left' | 'right' | 'center') | undefined;
  /** Cell renderer; default shows row[key]. */
  render?: ((row: T) => React.ReactNode) | undefined;
  /** Hover text for the cell; defaults to the plain value when there's no renderer. */
  title?: ((row: T) => string | undefined) | undefined;
}
export interface CompactTableProps<T> {
  columns: CompactColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Visible label-md caption above the table, outside the scroll area. Also names the table. */
  label?: string | undefined;
  /** Accessible name when there's no visible label. */
  ariaLabel?: string | undefined;
  /** Cap the height at this many rows (30px each); more rows scroll. Omit for no cap. */
  maxRows?: number | undefined;
  className?: string | undefined;
}
/** Read-only list table for popovers and side panels: no header row, no selection or hover, fixed column widths, 13px rows, optional scroll cap. */
export function CompactTable<T>({ columns, rows, rowKey, label, ariaLabel, maxRows, className }: CompactTableProps<T>) {
  const GAP = 16;
  const widths = columns.map((c, i) => c.width + (i < columns.length - 1 ? GAP : 0));
  const total = widths.reduce((a, b) => a + b, 0);
  const name = label || ariaLabel;
  const scrolls = maxRows !== undefined && rows.length > maxRows;
  return (
    <div className={cx('vb-ctable', className)}>
      {label && (
        <div className="vb-ctable-lab" aria-hidden="true">
          {label}
        </div>
      )}
      <div
        className={cx('vb-ctable-scroll', scrolls && 'is-scrolling')}
        style={maxRows !== undefined ? { maxHeight: maxRows * 30 } : undefined}
        tabIndex={scrolls ? 0 : undefined}
        role={scrolls ? 'region' : undefined}
        aria-label={scrolls ? name : undefined}
      >
        <table style={{ width: total }} aria-label={name}>
          <colgroup>
            {columns.map((c, i) => (
              <col key={c.key} style={{ width: widths[i] }} />
            ))}
          </colgroup>
          <tbody>
            {rows.map((r) => (
              <tr key={rowKey(r)}>
                {columns.map((c) => {
                  const raw = (r as Record<string, unknown>)[c.key];
                  const title = c.title ? c.title(r) : c.render ? undefined : String(raw ?? '');
                  return (
                    <td
                      key={c.key}
                      title={title}
                      className={cx(c.mono && 'is-mono', (c.mono || c.muted) && 'is-muted')}
                      style={c.align ? { textAlign: c.align } : undefined}
                    >
                      {c.render ? c.render(r) : String(raw ?? '')}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- MasterDetail ---------------- */

export interface MasterDetailProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Accessible caption of the table. */
  caption: string;
  /** Columns kept when a row is open. Default: the first column. */
  keyColumns?: string[] | undefined;
  /** Controlled open row; null or undefined shows the full table. */
  selectedKey?: (string | null) | undefined;
  onSelectedChange?: ((key: string | null) => void) | undefined;
  /** Uncontrolled initial open row. */
  defaultSelectedKey?: (string | null) | undefined;
  /** Details pane content for the open row. Or pass it as children (markup canvases). */
  renderDetail?: ((row: T) => React.ReactNode) | undefined;
  /** Details pane content when renderDetail isn't given. */
  children?: React.ReactNode | undefined;
  /** Details pane title; default is the first key column's value. */
  detailTitle?: (React.ReactNode | ((row: T) => React.ReactNode)) | undefined;
  /** Right side of the details header, before the close button (actions, a status). */
  detailActions?: (React.ReactNode | ((row: T) => React.ReactNode)) | undefined;
  /** Body padding: md (space-card, default) or none for content that lays out its own bars and panes. */
  detailPadding?: ('md' | 'none') | undefined;
  /** Small mono text after the title: a revision ("Rev 7"), an ID. */
  detailMeta?: React.ReactNode | undefined;
  /** Change it to flash the meta (after a save). */
  detailMetaFlashKey?: (string | number) | undefined;
  /** Width of the collapsed list: px or any CSS width. Default clamp(200px, 25%, 280px) of the view. */
  listWidth?: (number | string) | undefined;
  /** Fixed height of the whole view; by default it fills its parent. */
  height?: (number | string) | undefined;
  className?: string | undefined;
}
/**
 * Table that turns into master/detail: picking a row collapses the table to its key column on the left
 * (still a list: click or arrow keys switch rows) and opens a details pane on the right. Close or Escape returns to the full table.
 */
export function MasterDetail<T>({
  columns,
  rows,
  rowKey,
  caption,
  keyColumns,
  selectedKey: selProp,
  onSelectedChange,
  defaultSelectedKey = null,
  renderDetail,
  children,
  detailTitle,
  detailActions,
  detailPadding = 'md',
  detailMeta,
  detailMetaFlashKey,
  listWidth,
  height,
  className,
}: MasterDetailProps<T>) {
  const [inner, setInner] = React.useState<string | null>(defaultSelectedKey);
  const sel = selProp === undefined ? inner : selProp;
  const set = (k: string | null) => {
    if (selProp === undefined) setInner(k);
    onSelectedChange?.(k);
  };
  const root = React.useRef<HTMLDivElement>(null);
  const row = sel != null ? rows.find((r) => rowKey(r) === sel) : undefined;
  const open = !!row;
  const keep = keyColumns && keyColumns.length ? keyColumns : columns.slice(0, 1).map((c) => c.key);
  const shown = open ? columns.filter((c) => keep.includes(c.key)).map((c) => ({ ...c, width: undefined })) : columns;
  const focusRow = (k: string) =>
    requestAnimationFrame(() => {
      const i = rows.findIndex((r) => rowKey(r) === k);
      root.current?.querySelectorAll<HTMLElement>('.vb-md-list tbody tr')[i]?.focus();
    });
  const onKey = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      const k = sel!;
      set(null);
      focusRow(k);
      return;
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && (e.target as HTMLElement).closest('.vb-md-list')) {
      e.preventDefault();
      const i = rows.findIndex((r) => rowKey(r) === sel);
      const n = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (n) {
        set(rowKey(n));
        focusRow(rowKey(n));
      }
    }
  };
  const first = keep[0] ?? '';
  const firstCol = columns.find((c) => c.key === first);
  const title =
    row &&
    (typeof detailTitle === 'function'
      ? (detailTitle as (r: T) => React.ReactNode)(row)
      : detailTitle != null
        ? detailTitle
        : firstCol?.render
          ? firstCol.render(row)
          : String((row as Record<string, unknown>)[first] ?? ''));
  return (
    <div
      ref={root}
      className={cx('vb-md', open && 'is-open', className)}
      style={
        {
          height,
          ['--vb-md-list' as string]:
            listWidth == null ? undefined : typeof listWidth === 'number' ? listWidth + 'px' : listWidth,
        } as React.CSSProperties
      }
      onKeyDown={onKey}
    >
      <div className="vb-md-list">
        <Table
          columns={shown}
          rows={rows}
          rowKey={rowKey}
          caption={caption}
          selectedKey={sel ?? undefined}
          onRowClick={(r) => set(rowKey(r))}
        />
      </div>
      {open && (
        <section className="vb-md-detail" aria-label={typeof title === 'string' ? title : 'Details'}>
          <header className="vb-md-head">
            <div className="vb-md-titlewrap">
              <h2 className="vb-md-title">{title}</h2>
              {detailMeta != null && (
                <span
                  key={String(detailMetaFlashKey ?? '')}
                  className={cx('vb-md-meta', detailMetaFlashKey != null && detailMetaFlashKey !== '' && 'is-flash')}
                >
                  {detailMeta}
                </span>
              )}
            </div>
            {detailActions && (
              <div className="vb-md-actions">
                {typeof detailActions === 'function'
                  ? (detailActions as (r: T) => React.ReactNode)(row!)
                  : detailActions}
              </div>
            )}
            <IconButton
              icon="close"
              label="Close details"
              size="sm"
              onClick={() => {
                const k = sel!;
                set(null);
                focusRow(k);
              }}
            />
          </header>
          <div className={cx('vb-md-body', detailPadding === 'none' && 'is-flush')}>
            {renderDetail ? renderDetail(row!) : children}
          </div>
        </section>
      )}
    </div>
  );
}

/* ---------------- Card ---------------- */

export interface CardProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  eyebrow?: React.ReactNode | undefined;
  title?: React.ReactNode | undefined;
  /** Meta row under the body (label-md, muted). */
  meta?: React.ReactNode | undefined;
  /** The one active or leading item in a view: gradient edge + brand shadow. */
  glow?: boolean | undefined;
}
/** Container for a suite, task, run or result summary. */
export function Card({ eyebrow, title, meta, glow, className, children, ...rest }: CardProps) {
  const inner = (
    <article {...rest} className={cx('vb-card', !glow && className)}>
      {eyebrow && <div className="vb-card-eyebrow">{eyebrow}</div>}
      {title && <h3 className="vb-card-title">{title}</h3>}
      {children && <div className="vb-card-body">{children}</div>}
      {meta && <div className="vb-card-meta">{meta}</div>}
    </article>
  );
  return glow ? <div className={cx('vb-glow', className)}>{inner}</div> : inner;
}

/* ---------------- Accordion ---------------- */

export interface AccordionItem {
  id: string;
  title: React.ReactNode;
  content: React.ReactNode;
}
export interface AccordionProps {
  items: AccordionItem[];
  /** Ids open on first render. */ defaultOpen?: string[] | undefined;
  className?: string | undefined;
}
/** Disclosure list on native details/summary. */
export function Accordion({ items, defaultOpen = [], className }: AccordionProps) {
  return (
    <div className={cx('vb-accordion', className)}>
      {items.map((it) => (
        <details key={it.id} open={defaultOpen.includes(it.id)}>
          <summary>
            {it.title}
            <Icon name="plus" size={16} className="vb-acc-mark" />
          </summary>
          <div className="vb-acc-body">{it.content}</div>
        </details>
      ))}
    </div>
  );
}

/* ---------------- Sidebar ---------------- */

export interface SidebarItem {
  id: string;
  label: string;
  icon: IconName;
  /** Small count (attempts to grade, runs in progress). */ count?: number | undefined;
  href?: string | undefined;
}
export interface SidebarProps {
  /** Main sections, top group. */
  items: SidebarItem[];
  /** Secondary sections pinned to the bottom (Settings). */
  footerItems?: SidebarItem[] | undefined;
  /** Footer actions follow the same icon and label layout as navigation. */
  footerActions?: { id: string; label: string; icon: IconName; onClick: () => void }[] | undefined;
  currentId?: string | undefined;
  onNavigate?: ((id: string) => void) | undefined;
  /** Controlled collapsed state; omit for uncontrolled. */
  collapsed?: boolean | undefined;
  onCollapsedChange?: ((collapsed: boolean) => void) | undefined;
  defaultCollapsed?: boolean | undefined;
  /** Product name; "VibeBench" by default, "VB" when collapsed (no logo yet). */
  brand?: React.ReactNode | undefined;
  brandShort?: React.ReactNode | undefined;
  /** Shows a light/dark toggle in the footer when given. */
  theme?: ('light' | 'dark') | undefined;
  onThemeChange?: ((theme: 'light' | 'dark') => void) | undefined;
  className?: string | undefined;
}
/** Vertical app navigation: 240px expanded with labels, 64px collapsed to icons with tooltips. */
export function Sidebar({
  items,
  footerItems = [],
  footerActions = [],
  currentId,
  onNavigate,
  collapsed: cProp,
  onCollapsedChange,
  defaultCollapsed = false,
  brand = (
    <>
      Vibe<b>Bench</b>
    </>
  ),
  brandShort = (
    <>
      V<b>B</b>
    </>
  ),
  theme,
  onThemeChange,
  className,
}: SidebarProps) {
  const [inner, setInner] = React.useState(defaultCollapsed);
  const collapsed = cProp ?? inner;
  const setCollapsed = (v: boolean) => {
    if (cProp === undefined) setInner(v);
    onCollapsedChange?.(v);
  };
  const link = (it: SidebarItem) => {
    const a = (
      <a
        href={it.href || '#'}
        aria-current={it.id === currentId ? 'page' : undefined}
        className="vb-side-link"
        aria-label={collapsed ? it.label + (it.count ? `, ${it.count}` : '') : undefined}
        onClick={(e) => {
          if (onNavigate) {
            e.preventDefault();
            onNavigate(it.id);
          }
        }}
      >
        <span className="vb-side-ico">
          <Icon name={it.icon} size={20} />
          {collapsed && !!it.count && <i className="vb-side-dot" aria-hidden="true" />}
        </span>
        {!collapsed && <span className="vb-side-label">{it.label}</span>}
        {!collapsed && it.count !== undefined && <span className="vb-side-count">{it.count}</span>}
      </a>
    );
    return (
      <li key={it.id}>
        {collapsed ? (
          <Tooltip content={it.label + (it.count ? ` · ${it.count}` : '')} side="right">
            {a}
          </Tooltip>
        ) : (
          a
        )}
      </li>
    );
  };
  const toggleLabel = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  const themeBtn =
    theme &&
    onThemeChange &&
    (() => {
      const next = theme === 'dark' ? 'light' : 'dark';
      const label = next === 'dark' ? 'Dark mode' : 'Light mode';
      const btn = (
        <button
          type="button"
          className="vb-side-link vb-side-btn"
          aria-label={collapsed ? label : undefined}
          onClick={() => onThemeChange(next)}
        >
          <span className="vb-side-ico">
            <Icon name={next === 'dark' ? 'moon' : 'sun'} size={20} />
          </span>
          {!collapsed && <span className="vb-side-label">{label}</span>}
        </button>
      );
      return (
        <li>
          {collapsed ? (
            <Tooltip content={label} side="right">
              {btn}
            </Tooltip>
          ) : (
            btn
          )}
        </li>
      );
    })();
  const toggle = (
    <button
      type="button"
      className="vb-side-link vb-side-btn vb-side-toggle"
      aria-expanded={!collapsed}
      aria-controls="vb-side-nav"
      aria-label={collapsed ? toggleLabel : undefined}
      onClick={() => setCollapsed(!collapsed)}
    >
      <span className="vb-side-ico">
        <Icon name="sidebar" size={20} />
      </span>
      {!collapsed && <span className="vb-side-label">Collapse</span>}
    </button>
  );
  return (
    <aside className={cx('vb-side', collapsed && 'is-collapsed', className)}>
      <div className="vb-side-brand">{collapsed ? brandShort : brand}</div>
      <nav id="vb-side-nav" aria-label="Main" className="vb-side-nav">
        <ul>{items.map(link)}</ul>
        <ul className="vb-side-foot">
          {footerItems.map(link)}
          {footerActions.map((action) => {
            const button = (
              <button
                type="button"
                className="vb-side-link vb-side-btn"
                aria-label={collapsed ? action.label : undefined}
                onClick={action.onClick}
              >
                <span className="vb-side-ico">
                  <Icon name={action.icon} size={20} />
                </span>
                {!collapsed && <span className="vb-side-label">{action.label}</span>}
              </button>
            );
            return (
              <li key={action.id}>
                {collapsed ? (
                  <Tooltip content={action.label} side="right">{button}</Tooltip>
                ) : (
                  button
                )}
              </li>
            );
          })}
          {themeBtn}
          <li>
            {collapsed ? (
              <Tooltip content={toggleLabel} side="right">
                {toggle}
              </Tooltip>
            ) : (
              toggle
            )}
          </li>
        </ul>
      </nav>
    </aside>
  );
}

/* ---------------- TreeList ---------------- */

export interface TreeNode {
  id: string;
  label: string;
  /** Trailing meta: "REV 7", a count. */
  meta?: React.ReactNode | undefined;
  status?: RunStatus | undefined;
  /** Leading icon (folder for a category, task for a task). */
  icon?: IconName | undefined;
  /** Trailing icon in place of text meta (a criterion's rating control), named by metaIconLabel. */
  metaIcon?: IconName | undefined;
  metaIconLabel?: string | undefined;
  /** A group: an array (even empty) makes the node a group that can take onAdd and onRename. */
  children?: TreeNode[] | undefined;
}
export interface TreeListProps {
  nodes: TreeNode[];
  selectedId?: string | undefined;
  onSelect?: ((node: TreeNode) => void) | undefined;
  /** Ids expanded on first render. Ancestors of the selected node always open. */
  defaultExpanded?: string[] | undefined;
  /** Accessible name of the tree. */
  label: string;
  /** Status as icon only (narrow panes) or icon + word. Default icon. */
  statusStyle?: ('icon' | 'word') | undefined;
  /** Shows a + button on group rows; the group opens so the new child shows. */
  onAdd?: ((node: TreeNode) => void) | undefined;
  /** Accessible name of the + button. Default "Add to <label>". */
  addLabel?: ((node: TreeNode) => string) | undefined;
  /** Lets group rows be renamed inline: pencil button, double-click or F2; Enter or blur saves, Escape cancels. */
  onRename?: ((node: TreeNode, label: string) => void) | undefined;
  /** Starts inline rename on this node (e.g. a just-added category). */
  editingId?: string | undefined;
  className?: string | undefined;
}
/** Suites → tasks (or runs → attempts) tree: guides, selection bar, inline status, add and rename on groups, full keyboard support. */
export function TreeList({
  nodes,
  selectedId,
  onSelect,
  defaultExpanded = [],
  label,
  statusStyle = 'icon',
  onAdd,
  addLabel,
  onRename,
  editingId,
  className,
}: TreeListProps) {
  const [open, setOpen] = React.useState<Set<string>>(() => new Set(defaultExpanded));
  const [focus, setFocus] = React.useState<string | undefined>(selectedId ?? nodes[0]?.id);
  const [editing, setEditing] = React.useState<string | undefined>(editingId);
  const refs = React.useRef<Record<string, HTMLDivElement | null>>({});
  const editRef = React.useRef<HTMLInputElement>(null);
  const cancelled = React.useRef(false);
  React.useEffect(() => {
    if (editingId) setEditing(editingId);
  }, [editingId]);
  // Keep the selected node visible: open its ancestors.
  React.useEffect(() => {
    if (!selectedId) return;
    const path: string[] = [];
    const find = (ns: TreeNode[], trail: string[]): boolean =>
      ns.some((n) =>
        n.id === selectedId ? (path.push(...trail), true) : !!n.children && find(n.children, [...trail, n.id]),
      );
    find(nodes, []);
    if (path.some((id) => !open.has(id))) setOpen((s) => new Set([...s, ...path]));
  }, [selectedId, nodes]);
  const flat: Array<{ n: TreeNode; parent?: string | undefined }> = [];
  const walk = (ns: TreeNode[], parent?: string) =>
    ns.forEach((n) => {
      flat.push({ n, parent });
      if (n.children && open.has(n.id)) walk(n.children, n.id);
    });
  walk(nodes);
  const toggle = (id: string, v?: boolean) =>
    setOpen((s) => {
      const x = new Set(s);
      (v ?? !x.has(id)) ? x.add(id) : x.delete(id);
      return x;
    });
  const move = (id?: string) => {
    if (!id) return;
    setFocus(id);
    refs.current[id]?.focus();
  };
  const isGroup = (n: TreeNode) => Array.isArray(n.children);
  const onKey = (e: React.KeyboardEvent, n: TreeNode, parent?: string) => {
    if (e.target !== e.currentTarget) return;
    const i = flat.findIndex((f) => f.n.id === n.id);
    const kids = !!n.children?.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(flat[i + 1]?.n.id);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(flat[i - 1]?.n.id);
    } else if (e.key === 'ArrowRight' && kids) {
      e.preventDefault();
      open.has(n.id) ? move(n.children?.[0]?.id) : toggle(n.id, true);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      kids && open.has(n.id) ? toggle(n.id, false) : move(parent);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect?.(n);
    } else if (e.key === 'F2' && onRename && isGroup(n)) {
      e.preventDefault();
      setEditing(n.id);
    }
  };
  const commit = (n: TreeNode, v: string) => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    setEditing(undefined);
    const t = v.trim();
    if (t && t !== n.label) onRename?.(n, t);
    requestAnimationFrame(() => refs.current[n.id]?.focus());
  };
  const row = (n: TreeNode, parent?: string): React.ReactNode => {
    const kids = !!n.children?.length;
    const group = isGroup(n);
    const s = n.status ? statusInfo(n.status) : null;
    const isEditing = editing === n.id;
    return (
      <li key={n.id} role="none">
        <div
          ref={(el) => {
            refs.current[n.id] = el;
          }}
          role="treeitem"
          tabIndex={focus === n.id ? 0 : -1}
          aria-expanded={kids ? open.has(n.id) : undefined}
          aria-selected={n.id === selectedId}
          className={cx('vb-tree-row', isEditing && 'is-editing')}
          onKeyDown={(e) => onKey(e, n, parent)}
          onClick={() => {
            if (isEditing) return;
            setFocus(n.id);
            if (kids) toggle(n.id);
            onSelect?.(n);
          }}
          onDoubleClick={() => {
            if (onRename && group) setEditing(n.id);
          }}
        >
          <span className="vb-tree-chev">{kids && <Icon name="chevron-right" size={12} />}</span>
          {n.icon && <Icon name={n.icon} className="vb-tree-icon" />}
          {isEditing ? (
            <input
              ref={editRef}
              className="vb-tree-input"
              defaultValue={n.label}
              aria-label={'Rename ' + n.label}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') commit(n, e.currentTarget.value);
                if (e.key === 'Escape') {
                  cancelled.current = true;
                  setEditing(undefined);
                  refs.current[n.id]?.focus();
                }
              }}
              onBlur={(e) => commit(n, e.currentTarget.value)}
            />
          ) : (
            <span className="vb-tree-name" title={n.label}>
              {n.label}
            </span>
          )}
          {isEditing && (
            <span className="vb-tree-acts is-on">
              <button
                type="button"
                className="vb-tree-act is-ok"
                aria-label="Save name"
                title="Save"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();
                  commit(n, editRef.current?.value ?? n.label);
                }}
              >
                <Icon name="check" size={14} />
              </button>
              <button
                type="button"
                className="vb-tree-act"
                aria-label="Cancel rename"
                title="Cancel"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();
                  cancelled.current = true;
                  setEditing(undefined);
                  refs.current[n.id]?.focus();
                }}
              >
                <Icon name="close" size={14} />
              </button>
            </span>
          )}
          {!isEditing && n.meta && <span className="vb-tree-meta">{n.meta}</span>}
          {!isEditing && n.metaIcon && (
            <span className="vb-tree-micon" title={n.metaIconLabel}>
              <Icon name={n.metaIcon} label={n.metaIconLabel} />
            </span>
          )}
          {!isEditing &&
            s &&
            (statusStyle === 'icon' ? (
              <span className={'vb-tree-st vb-tone-' + s.tone} title={s.word}>
                <Icon name={s.icon} label={s.word} />
              </span>
            ) : (
              <span className={'vb-tree-st vb-tone-' + s.tone}>
                <Icon name={s.icon} size={14} />
                {s.word}
              </span>
            ))}
          {!isEditing && group && (onRename || onAdd) && (
            <span className="vb-tree-acts">
              {onRename && (
                <button
                  type="button"
                  tabIndex={-1}
                  className="vb-tree-act"
                  aria-label={'Rename ' + n.label}
                  title="Rename"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(n.id);
                  }}
                >
                  <Icon name="pen" size={14} />
                </button>
              )}
              {onAdd && (
                <button
                  type="button"
                  tabIndex={-1}
                  className="vb-tree-act"
                  aria-label={addLabel ? addLabel(n) : 'Add to ' + n.label}
                  title={addLabel ? addLabel(n) : 'Add to ' + n.label}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(n.id, true);
                    onAdd(n);
                  }}
                >
                  <Icon name="plus" size={14} />
                </button>
              )}
            </span>
          )}
        </div>
        {kids && open.has(n.id) && <ul role="group">{n.children!.map((c) => row(c, n.id))}</ul>}
      </li>
    );
  };
  return (
    <ul role="tree" aria-label={label} className={cx('vb-tree', className)}>
      {nodes.map((n) => row(n))}
    </ul>
  );
}

/* ---------------- CapabilityChip ---------------- */

export type Modality = 'text' | 'image' | 'video' | 'speech' | 'transcription';
export const MODALITIES: Modality[] = ['text', 'image', 'video', 'speech', 'transcription'];
const MOD_LABEL: Record<Modality, string> = {
  text: 'Text',
  image: 'Image',
  video: 'Video',
  speech: 'Speech',
  transcription: 'Transcription',
};
export interface ModelInfo {
  name: string;
  id: string;
  modalities: Modality[];
}
export interface Capability {
  app: HarnessApp;
  state: CapabilityState;
  version?: string | undefined;
  /** null when not signed in. detail: "Anthropic · sk-ant-…4f2a" (API key) or "Claude Max" (subscription). */
  auth?: ({ type: 'API key' | 'Subscription'; detail: string } | null) | undefined;
  models?: ModelInfo[] | undefined;
}
/* Name and ID fit "DeepSeek v4 Flash Vision"; five 16px modality slots, 6px apart, in a fixed order. */
const MODEL_COLUMNS: CompactColumn<ModelInfo>[] = [
  { key: 'name', width: 152 },
  { key: 'id', width: 174, mono: true },
  {
    key: 'mods',
    width: 104,
    title: () => undefined,
    render: (m) => (
      <span className="vb-mods">
        {MODALITIES.map((k) =>
          m.modalities.includes(k) ? (
            <span key={k} className="vb-mod" title={MOD_LABEL[k]}>
              <Icon name={('mod-' + k) as IconName} label={MOD_LABEL[k]} />
            </span>
          ) : (
            <span key={k} className="vb-mod" aria-hidden="true" />
          ),
        )}
      </span>
    ),
  },
];
const APP_NAME: Record<HarnessApp, string> = { codex: 'Codex', claude: 'Claude', opencode: 'OpenCode' };
const CAP_WORD: Record<CapabilityState, string> = { ready: 'Ready', installed: 'Installed', missing: 'Missing' };

export interface CapabilityChipProps {
  capability: Capability;
  /** Runtime name, for the popover's accessible label. */ runtimeName: string;
  defaultOpen?: boolean | undefined;
}
/** A harness on a runtime: chip with app mark + state, opening a popover with version, auth and models. */
export function CapabilityChip({ capability: c, runtimeName, defaultOpen }: CapabilityChipProps) {
  const name = APP_NAME[c.app];
  const authLine =
    c.state === 'missing' ? (
      <div className="vb-cap-sub">Not installed on this runtime</div>
    ) : c.auth ? (
      <div className="vb-cap-sub" title="Authenticated">
        <Icon name="key" size={14} />
        <span>
          {c.auth.type === 'Subscription' ? (
            <>{c.auth.detail} Subscription</>
          ) : (
            (() => {
              const [p, k] = c.auth!.detail.split(' · ');
              return (
                <>
                  {p} API key <span className="vb-mono">{k}</span>
                </>
              );
            })()
          )}
        </span>
      </div>
    ) : c.state === 'ready' ? (
      <div className="vb-cap-sub">
        <Icon name="key" size={14} />
        <span>Signed in · account details unavailable</span>
      </div>
    ) : (
      <div className="vb-cap-sub is-warn">
        <Icon name="lock" size={14} />
        <span>Sign-in not confirmed</span>
      </div>
    );
  return (
    <Popover
      label={`${name} on ${runtimeName}`}
      defaultOpen={defaultOpen}
      className="vb-cap-pop"
      trigger={
        <Chip
          className={'vb-cap vb-cap-' + c.state}
          leading={<AppIcon app={c.app} state={c.state} />}
          trailing={<Icon name="chevron" size={12} className="vb-cap-chev" />}
        >
          {name}
          <span className="vb-cap-word">{CAP_WORD[c.state]}</span>
        </Chip>
      }
    >
      <div className="vb-cap-head">
        <AppIcon app={c.app} state={c.state} size={32} className="vb-cap-mark" />
        <div className="vb-cap-id">
          <div className="vb-cap-title">
            <b>{name}</b>
            {c.version && <span className="vb-mono vb-muted">v{c.version}</span>}
          </div>
          {authLine}
        </div>
      </div>
      {c.state !== 'missing' && !!c.models?.length && (
        <CompactTable
          label="Models"
          maxRows={5}
          className="vb-cap-models"
          rows={c.models}
          rowKey={(m) => m.id}
          columns={MODEL_COLUMNS}
        />
      )}
    </Popover>
  );
}

/* ---------------- RuntimeCard ---------------- */

export type RuntimeState = 'working' | 'ready' | 'offline';
const RT: Record<RuntimeState, { icon: IconName; word: string; tone: 'accent' | 'success' | 'neutral' }> = {
  working: { icon: 'running', word: 'Working', tone: 'accent' },
  ready: { icon: 'passed', word: 'Ready', tone: 'success' },
  offline: { icon: 'offline', word: 'Offline', tone: 'neutral' },
};
export interface RuntimeCardProps {
  name: string;
  state: RuntimeState;
  connected: boolean;
  /** Name and version only: "macOS 15.1". */
  os: string;
  capabilities: Capability[];
  /** When working. */
  progress?: { done: number; total: number; runLabel: string; runHref?: string } | undefined;
  /** When offline: ISO timestamp, plus a pre-formatted relative string ("2 hours ago") and clock time ("10:12"). */
  lastSeen?: { iso: string; relative: string; time?: string } | undefined;
  onStartRun?: (() => void) | undefined;
  onRevoke?: (() => void) | undefined;
  onConnect?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
  /** Id of a capability whose popover starts open (previews). */
  openCapability?: HarnessApp | undefined;
  className?: string | undefined;
}
/** Wide list card for a runtime: state, OS, capabilities with detail popovers, progress or last seen, and actions. */
export function RuntimeCard({
  name,
  state,
  connected,
  os,
  capabilities,
  progress,
  lastSeen,
  onRevoke,
  onConnect,
  onDelete,
  openCapability,
  className,
}: RuntimeCardProps) {
  const s = RT[state];
  return (
    <article
      className={cx('vb-rt', 'vb-rt-' + state, className)}
      aria-label={`Runtime ${name}, ${s.word.toLowerCase()}${connected ? '' : ', not connected'}`}
    >
      <header className="vb-rt-head">
        <div className="vb-rt-main">
          <span className="vb-rt-glyph">
            <Icon name={state === 'offline' ? 'offline' : 'runtime'} size={22} />
          </span>
          <div className="vb-rt-title">
            <div className="vb-rt-name">
              <h3>{name}</h3>
              <Badge tone={s.tone} icon={s.icon} size="sm">
                {s.word}
              </Badge>
            </div>
            <div className="vb-rt-os">{os}</div>
          </div>
        </div>
        <span className="vb-rt-vsep" aria-hidden="true" />
        <div className="vb-rt-actions">
          {connected ? (
            <Button size="sm" icon="revoke" onClick={onRevoke}>
              Revoke
            </Button>
          ) : (
            <Button size="sm" icon="connect" onClick={onConnect}>
              Connect
            </Button>
          )}
          <Button size="sm" variant="danger" icon="delete" onClick={onDelete}>
            Delete
          </Button>
        </div>
      </header>
      <dl className="vb-rt-body">
        <div className="vb-rt-field">
          <dt>Capabilities</dt>
          <dd className="vb-rt-caps">
            {capabilities.map((c) => (
              <CapabilityChip key={c.app} capability={c} runtimeName={name} defaultOpen={openCapability === c.app} />
            ))}
          </dd>
        </div>
        <span className="vb-rt-vsep" aria-hidden="true" />
        <div className="vb-rt-field">
          {state === 'working' && progress ? (
            <>
              <dt>Progress</dt>
              <dd className="vb-rt-progress">
                <div className="vb-rt-progress-top">
                  <span>
                    <b className="vb-num">{progress.done}</b> of <b className="vb-num">{progress.total}</b> tasks
                  </span>
                  <a href={progress.runHref || '#'}>{progress.runLabel}</a>
                </div>
                <ProgressBar
                  value={progress.done}
                  max={progress.total}
                  label={`${progress.done} of ${progress.total} tasks`}
                />
              </dd>
            </>
          ) : state === 'offline' ? (
            <>
              <dt>Last seen</dt>
              <dd>
                <span className="vb-rt-line">
                  {lastSeen ? <time dateTime={lastSeen.iso}>{lastSeen.relative}</time> : 'Not yet observed'}
                  {lastSeen?.time && <span className="vb-muted"> · {lastSeen.time}</span>}
                </span>
              </dd>
            </>
          ) : (
            <>
              <dt>Activity</dt>
              <dd>
                <span className="vb-rt-line">
                  Idle <span className="vb-muted">· online now</span>
                </span>
              </dd>
            </>
          )}
        </div>
      </dl>
    </article>
  );
}

/* ---------------- EntrantTag ---------------- */

export type Effort = 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const EFFORT: Record<Effort, { word: string; tone: 'success' | 'warning' | 'danger' }> = {
  auto: { word: 'Auto', tone: 'success' },
  low: { word: 'Low', tone: 'warning' },
  medium: { word: 'Medium', tone: 'warning' },
  high: { word: 'High', tone: 'warning' },
  xhigh: { word: 'Extra high', tone: 'warning' },
  max: { word: 'Max', tone: 'danger' },
};
export interface Entrant {
  app: HarnessApp;
  /** Model name as shown: "GPT-5 Codex". */ model: string;
  /** Reasoning effort / thinking level. */ effort?: Effort | undefined;
}
export interface EntrantTagProps {
  entrant: Entrant;
  className?: string | undefined;
}
/** One entrant of a run, read-only: app mark, model, effort icon (with a tooltip). */
export function EntrantTag({ entrant: e, className }: EntrantTagProps) {
  const ef = e.effort ? EFFORT[e.effort] : null;
  return (
    <span className={cx('vb-entrant', className)}>
      <AppIcon app={e.app} />
      <span className="vb-entrant-model">{e.model}</span>
      {ef && (
        <Icon
          name={('effort-' + e.effort) as IconName}
          tooltip={ef.word + ' effort'}
          className={'vb-entrant-effort vb-tone-' + ef.tone}
        />
      )}
    </span>
  );
}

/* ---------------- RunCard ---------------- */

export type RunState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
const RUN: Record<RunState, { icon: IconName; word: string; tone: 'accent' | 'success' | 'neutral' | 'danger' }> = {
  queued: { icon: 'queued', word: 'Queued', tone: 'neutral' },
  running: { icon: 'running', word: 'Running', tone: 'accent' },
  done: { icon: 'passed', word: 'Finished', tone: 'success' },
  failed: { icon: 'failed', word: 'Failed', tone: 'danger' },
  cancelled: { icon: 'unavailable', word: 'Cancelled', tone: 'neutral' },
};
export interface RunCardProps {
  /** "Run 0142". */
  runId: string;
  runHref?: string | undefined;
  canGrade?: boolean | undefined;
  evidence?: 'live' | 'fixture' | undefined;
  state: RunState;
  suite: string;
  revision: number;
  runtime: string;
  /** Tasks in the run, how many have run, how many passed. */
  tasks: { total: number; ran: number; passed: number };
  /** Start time as ISO plus how it reads: "Oct 10, 07:20". Omit while queued. */
  started?: { iso: string; label: string } | undefined;
  /** "1h 48m"; while running, the time so far ("41m so far"). */
  duration?: string | undefined;
  entrants: Entrant[];
  /** Finished runs: how many gradings exist. 0 shows "Start grading"; more shows "View grading" with the count. */
  gradings?: number | undefined;
  /** Link for the grading button (the run's grading page). */
  gradeHref?: string | undefined;
  suiteHref?: string | undefined;
  runtimeHref?: string | undefined;
  onGrade?: (() => void) | undefined;
  onRunAgain?: (() => void) | undefined;
  onCancel?: (() => void) | undefined;
  className?: string | undefined;
}
/** Wide list card for a run: state, suite and revision, runtime, entrants, task progress or result, start and duration, actions. */
export function RunCard({
  runId,
  runHref,
  evidence,
  canGrade,
  state,
  suite,
  revision,
  runtime,
  tasks,
  started,
  duration,
  entrants,
  gradings = 0,
  gradeHref,
  suiteHref,
  runtimeHref,
  onGrade,
  onRunAgain,
  onCancel,
  className,
}: RunCardProps) {
  const s = RUN[state];
  const live = state === 'running' || state === 'queued';
  const glyph = state === 'running' ? 'nav-runs' : s.icon;
  return (
    <article
      className={cx('vb-rt', 'vb-run', 'vb-run-' + state, className)}
      aria-label={`${runId}, ${s.word.toLowerCase()}`}
    >
      <header className="vb-rt-head">
        <div className="vb-rt-main">
          <span className="vb-rt-glyph">
            <Icon name={glyph as IconName} size={22} />
          </span>
          <div className="vb-rt-title">
            <div className="vb-rt-name">
              <h3>
                {runHref ? (
                  <a className="run-link" href={runHref}>
                    {runId}
                  </a>
                ) : (
                  runId
                )}
              </h3>
              <Badge tone={s.tone} icon={s.icon} size="sm">
                {s.word}
              </Badge>
              {evidence === 'fixture' && <Badge size="sm">Fixture</Badge>}
            </div>
            <div className="vb-run-sub">
              <span className="vb-run-where">
                <Icon name="nav-suites" size={14} />
                {suiteHref ? <a href={suiteHref}>{suite}</a> : suite}
                <span className="vb-mono vb-muted">Rev {revision}</span>
              </span>
              <span className="vb-run-where">
                <Icon name="runtime" size={14} />
                {runtimeHref ? <a href={runtimeHref}>{runtime}</a> : runtime}
              </span>
            </div>
          </div>
        </div>
        <span className="vb-rt-vsep" aria-hidden="true" />
        <div className="vb-rt-actions">
          {(canGrade ?? state === 'done') &&
            (gradings > 0 ? (
              <Button
                variant="secondary"
                size="sm"
                icon="nav-grade"
                href={gradeHref}
                onClick={onGrade}
                aria-label={`View grading, ${gradings} so far`}
              >
                View grading
                <span className="vb-count-pill" aria-hidden="true">
                  {gradings}
                </span>
              </Button>
            ) : (
              <Button variant="primary" size="sm" icon="nav-grade" href={gradeHref} onClick={onGrade}>
                Start grading
              </Button>
            ))}
          {!live && (
            <Button size="sm" icon="start" onClick={onRunAgain}>
              Run again
            </Button>
          )}
          {live && (
            <Button size="sm" variant="danger" icon="close" onClick={onCancel}>
              Cancel run
            </Button>
          )}
        </div>
      </header>
      <dl className="vb-rt-body">
        <div className="vb-run-main">
          <div className="vb-rt-field">
            <dt>Entrants</dt>
            <dd className="vb-rt-caps">
              {entrants.map((e, i) => (
                <EntrantTag key={i} entrant={e} />
              ))}
            </dd>
          </div>
          <div className="vb-rt-field">
            <dt>Tasks</dt>
            <dd className="vb-rt-progress">
              <div className="vb-rt-progress-top">
                <span>
                  {live || tasks.ran < tasks.total ? (
                    <>
                      <b className="vb-num">{tasks.ran}</b> of <b className="vb-num">{tasks.total}</b> ran
                    </>
                  ) : (
                    <>
                      <b className="vb-num">{tasks.total}</b> ran
                    </>
                  )}
                </span>
                <span className="vb-run-passed">
                  <b className="vb-num">{tasks.passed}</b> passed
                </span>
              </div>
              {live ? (
                <ProgressBar value={tasks.ran} max={tasks.total} label={`${tasks.ran} of ${tasks.total} tasks ran`} />
              ) : (
                <ProgressBar
                  tone="success"
                  value={tasks.passed}
                  max={tasks.total}
                  label={`${tasks.passed} of ${tasks.total} tasks passed`}
                />
              )}
            </dd>
          </div>
        </div>
        <span className="vb-rt-vsep" aria-hidden="true" />
        <div className="vb-run-side">
          <div className="vb-rt-field">
            <dt>Started</dt>
            <dd>
              <span className="vb-rt-line">
                {started ? (
                  <time dateTime={started.iso}>{started.label}</time>
                ) : (
                  <span className="vb-muted">Waiting…</span>
                )}
              </span>
            </dd>
          </div>
          <div className="vb-rt-field">
            <dt>Duration</dt>
            <dd>
              <span className="vb-rt-line vb-num">{duration || '—'}</span>
            </dd>
          </div>
        </div>
      </dl>
    </article>
  );
}
