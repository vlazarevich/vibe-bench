import { ICONS, APPS } from './icon-data';

export { Icon, AppIcon, Button, IconButton, Badge, StatusBadge, Chip, ProgressBar, statusInfo } from './core';
export type {
  IconName,
  IconProps,
  AppIconProps,
  HarnessApp,
  CapabilityState,
  ButtonProps,
  IconButtonProps,
  Tone,
  BadgeProps,
  RunStatus,
  StatusBadgeProps,
  ChipProps,
  ProgressBarProps,
} from './core';
export { Input, Select, Checkbox, Switch, Tabs, Slider, Rating, Thumbs } from './forms';
export type {
  InputProps,
  SelectProps,
  SelectOption,
  CheckboxProps,
  SwitchProps,
  TabsProps,
  TabItem,
  SliderProps,
  RatingProps,
  ThumbsProps,
  ThumbsValue,
} from './forms';
export { Popover, Menu, Tooltip, Dialog } from './overlays';
export type { PopoverProps, MenuProps, MenuItem, TooltipProps, DialogProps } from './overlays';
export {
  Table,
  CompactTable,
  MasterDetail,
  Card,
  Accordion,
  Sidebar,
  TreeList,
  CapabilityChip,
  RuntimeCard,
  MODALITIES,
  EntrantTag,
  RunCard,
} from './composites';
export type {
  TableProps,
  TableColumn,
  CompactTableProps,
  CompactColumn,
  MasterDetailProps,
  CardProps,
  AccordionProps,
  AccordionItem,
  SidebarProps,
  SidebarItem,
  TreeListProps,
  TreeNode,
  CapabilityChipProps,
  Capability,
  ModelInfo,
  Modality,
  RuntimeCardProps,
  RuntimeState,
  Entrant,
  EntrantTagProps,
  RunCardProps,
  RunState,
} from './composites';

/* ---- Non-React helpers (string output), kept for pages that don't run React ---- */

/** Switch the token theme on the root element. */
export function setTheme(theme: 'light' | 'dark') {
  document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
}
export function getTheme(): 'light' | 'dark' {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}
/** A system icon as an inline SVG string in currentColor. */
export function icon(name: string, size = 16, label?: string) {
  const a = label ? ` role="img" aria-label="${String(label).replace(/"/g, '&quot;')}"` : ' aria-hidden="true"';
  return `<svg class="vb-ico" width="${size}" height="${size}" viewBox="0 0 24 24"${a}>${ICONS[name] || ICONS.queued}</svg>`;
}
export const statusIcon = icon;
/** An official app mark as an inline SVG string. */
export function appIcon(app: string, state = 'ready', size = 16) {
  const a = APPS[app];
  if (!a) return '';
  return `<span class="vb-app vb-app-${state}" data-app="${app}" aria-hidden="true"><svg width="${size}" height="${size}" viewBox="${a.vb}" preserveAspectRatio="xMidYMid meet">${a.body}</svg></span>`;
}
export const icons = Object.keys(ICONS);
export const apps = ['codex', 'claude', 'opencode'];
export const modalities = ['text', 'image', 'video', 'speech', 'transcription'];
export {
  taskTypes,
  taskTypeInfo,
  TaskTypeTag,
  Segmented,
  CriterionScore,
  ResultPicker,
  ResultPanel,
  TextOutput,
  ImageOutput,
  HtmlPreview,
  CodeDiff,
  BrowserReplay,
} from './grading';
export type {
  TaskType,
  CompareLayout,
  TaskTypeTagProps,
  SegmentedProps,
  SegmentedOption,
  ScoreControl,
  ScoreValue,
  CriterionScoreProps,
  ResultChoice,
  ResultPickerProps,
  ResultPanelProps,
  TextOutputProps,
  ImageOutputProps,
  Viewport,
  HtmlPreviewProps,
  DiffFile,
  CodeDiffProps,
  ReplayStep,
  BrowserReplayProps,
} from './grading';

export {
  DateRangePicker,
  formatRange,
  rangeSummary,
  Sparkline,
  ScoreCell,
  StatTile,
  Checklist,
  FilterPanel,
  ScoreTable,
} from './results';
export type {
  DateRange,
  DatePreset,
  DateRangePickerProps,
  SparklineProps,
  ScoreDetail,
  ScoreCellProps,
  StatTileProps,
  ChecklistItem,
  ChecklistProps,
  FilterSection,
  FilterValue,
  FilterPanelProps,
  ScoreColumn,
  ScoreRow,
  ScoreTableProps,
} from './results';
