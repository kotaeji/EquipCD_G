// TURN-061. One meaning table: each command id has one Lucide icon.
// The same id is used in the header, toolbars, menus, and the command palette.
// Stroke and color live on the icon component (one stroke, currentColor).

export const ICON_STROKE = 2;
export const ICON_PX = { sm: 16, md: 24 } as const;
export type IconSize = keyof typeof ICON_PX;

/** Command or chrome id → Lucide export name. Values are unique. */
export const COMMAND_ICONS = {
  'step-library': 'Library',
  'step-canvas': 'LayoutDashboard',
  'step-attributes': 'SlidersHorizontal',
  'step-sequence': 'ListTree',
  'step-check': 'ClipboardCheck',
  'step-run': 'Gauge',

  'tab-cards': 'GalleryHorizontalEnd',
  'tab-input': 'Table2',
  'tab-aml': 'FileCode',
  'tab-extract': 'FileInput',
  'tab-board': 'LayoutGrid',
  'tab-diagram': 'DraftingCompass',
  'tab-station': 'ListOrdered',
  'tab-subseq': 'Network',
  'tab-material': 'Package',
  'tab-sfc': 'GitFork',
  'tab-extend': 'Puzzle',
  'tab-gap': 'TriangleAlert',
  'tab-diag': 'Stethoscope',
  'tab-export': 'FileOutput',
  'tab-lab': 'FlaskConical',

  save: 'Save',
  'export-json': 'Download',
  'print-view': 'Printer',
  'import-json': 'Upload',
  'new-project': 'FilePlus',
  sample: 'BookOpen',
  'sample-parallel': 'Columns2',
  'sample-flow': 'Workflow',

  undo: 'Undo2',
  redo: 'Redo2',
  'undo-history': 'History',
  copy: 'Copy',
  paste: 'ClipboardPaste',
  duplicate: 'CopyPlus',
  delete: 'X',
  'select-all': 'BoxSelect',
  'align-left': 'AlignLeft',
  'align-top': 'AlignStartVertical',
  'gap-x': 'AlignHorizontalSpaceBetween',
  'gap-y': 'AlignVerticalSpaceBetween',
  'match-w': 'UnfoldHorizontal',
  'match-h': 'UnfoldVertical',
  spread: 'MoveHorizontal',
  arrange: 'LayoutTemplate',
  'fit-unit': 'Scaling',

  'mode-flow': 'ArrowRight',
  'mode-signal': 'Cable',

  'wrap-branch': 'Split',
  'wrap-parallel': 'Rows3',
  'wrap-loop': 'Repeat',
  'wrap-retry': 'RotateCcw',
  unwrap: 'Ungroup',
  'add-wait': 'Hourglass',
  'add-substation': 'SquareStack',

  run: 'Play',
  pause: 'Pause',
  resume: 'CirclePlay',
  'step-time': 'ClockPlus',
  reset: 'RotateCw',
  'to-end': 'SkipForward',
  'view-diagram': 'PenTool',
  'view-3d': 'Box',
  'fit-view': 'Expand',

  'theme-light': 'Sun',
  'theme-dark': 'Moon',
  names: 'Tag',
  minimap: 'Map',
  explorer: 'PanelLeft',
  'view-settings': 'Settings',
  tour: 'Compass',
  shortcuts: 'Keyboard',
  palette: 'Search',

  props: 'PanelRightOpen',
  'props-view': 'Eye',
  rename: 'Pencil',
  lock: 'Lock',
  unlock: 'LockOpen',
  'save-template': 'BookmarkPlus',
  help: 'CircleHelp',
  close: 'SquareX',
  fold: 'ChevronDown',
  unfold: 'ChevronRight',
  'zoom-in': 'ZoomIn',
  'zoom-out': 'ZoomOut',
  select: 'MousePointer2',
  layers: 'Layers',
  'arrange-menu': 'BetweenHorizontalStart',
  background: 'ImagePlus',
  'lock-all': 'LockKeyhole',
  'unlock-all': 'LockKeyholeOpen',
  schematic: 'Shapes',
  photo: 'Image',
  empty: 'CircleDashed',
  'empty-done': 'CircleCheck',
  'empty-flow': 'MoveRight',
  'empty-search': 'SearchX',
  workspace: 'Folders',
  project: 'Folder',
  'add-step': 'ListPlus',
  confirm: 'BadgeCheck',
  jump: 'ArrowUpRight',
  'to-actions': 'Bolt',
  'to-signals': 'Radio',
  'to-props': 'SlidersVertical',
  'to-check-def': 'ListChecks',
  reanalyze: 'ScanSearch',
  'filter-block': 'OctagonAlert',
  'filter-human': 'UserRound',
  'filter-hidden': 'EyeOff',
  'run-summary': 'ScrollText',
  'run-timing': 'ChartGantt',
  'run-piece': 'Users',
  'run-log': 'Scroll',
  'run-signals': 'Activity',
  'action-add': 'Plus',
  'object-unit': 'Boxes',
  'object-device': 'Cpu',
  'object-signal': 'RadioReceiver',
  'object-position': 'MapPin',
  'object-action': 'Zap',
  'object-step': 'List',
  'object-block': 'Square',
  'object-interlock': 'Shield',
  'object-material': 'Package2',
  'object-gap': 'CircleAlert',
  'object-more': 'Ellipsis',
  'report-export': 'FileText',
  'report-html': 'FileCode2',
  'report-steps': 'Table',
  'report-log': 'FileSpreadsheet',
} as const;

export type IconId = keyof typeof COMMAND_ICONS;
export type IconName = (typeof COMMAND_ICONS)[IconId];

/** One icon per named-object kind in the command finder. */
export const OBJECT_ICON = {
  unit: 'object-unit',
  device: 'object-device',
  signal: 'object-signal',
  position: 'object-position',
  action: 'object-action',
  step: 'object-step',
  block: 'object-block',
  interlock: 'object-interlock',
  material: 'object-material',
  gap: 'object-gap',
} as const satisfies Record<string, IconId>;

/** Report export menu. The button and each file kind stay distinct. */
export const REPORT_ICON = {
  menu: 'report-export',
  html: 'report-html',
  steps: 'report-steps',
  log: 'report-log',
} as const satisfies Record<string, IconId>;

export function commandIcon(id: string): IconName | undefined {
  return (COMMAND_ICONS as Record<string, IconName>)[id];
}

/** Ids that draw the same Lucide icon. Empty when the table is one-to-one. */
export function iconCollisions(): string[] {
  const seen = new Map<string, string>();
  const bad: string[] = [];
  for (const [id, name] of Object.entries(COMMAND_ICONS)) {
    const prev = seen.get(name);
    if (prev) bad.push(`${prev} = ${id} (${name})`);
    else seen.set(name, id);
  }
  return bad;
}

/** Context-menu action → icon id. Aliases share the toolbar command. */
export const MENU_ICON = {
  props: 'props',
  propsView: 'props-view',
  rename: 'rename',
  copy: 'copy',
  paste: 'paste',
  duplicate: 'duplicate',
  arrange: 'arrange',
  fit: 'fit-unit',
  delete: 'delete',
  selectAll: 'select-all',
  fitView: 'fit-view',
  alignLeft: 'align-left',
  alignTop: 'align-top',
  gapX: 'gap-x',
  gapY: 'gap-y',
  matchW: 'match-w',
  matchH: 'match-h',
  lockPosition: 'lock',
  unlockPosition: 'unlock',
  saveTemplate: 'save-template',
} as const satisfies Record<string, IconId>;

export function menuIconId(action: string, label = ''): IconId | undefined {
  if (action === 'lockPosition' && label.includes('해제')) return 'unlock';
  return (MENU_ICON as Record<string, IconId>)[action];
}

/** Tab id → icon id. The visible label stays the tab name. */
export const TAB_ICON: Record<string, IconId> = {
  cards: 'tab-cards',
  input: 'tab-input',
  aml: 'tab-aml',
  extract: 'tab-extract',
  sequence: 'tab-station',
  subseq: 'tab-subseq',
  material: 'tab-material',
  sfc: 'tab-sfc',
  extend: 'tab-extend',
  gap: 'tab-gap',
  diag: 'tab-diag',
  export: 'tab-export',
  lab: 'tab-lab',
  board: 'tab-board',
  diagram: 'tab-diagram',
  workspace: 'workspace',
  project: 'project',
  summary: 'run-summary',
  timing: 'run-timing',
  log: 'run-log',
  signals: 'run-signals',
};

/** Empty-screen mark. Status chips keep their own glyphs. */
export function emptyIconId(symbol: string): IconId {
  if (symbol === '✓') return 'empty-done';
  if (symbol === '→') return 'empty-flow';
  if (symbol === '?') return 'empty-search';
  return 'empty';
}
