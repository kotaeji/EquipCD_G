// UserView (user-local, NOT design data). Stored under a separate key; never serialized into project files.
import { normalizeConfirmerName } from '../model/confirmationLog';
import { VIEW_KEY, type KV } from '../storage/localStore';
import { STEPS, type StepId } from './wizard';

export type ThemeId = 'A' | 'B' | 'C';
/** Product appearance. Stored A and archived C both paint the light palette; stored B paints dark. */
export type Appearance = 'light' | 'dark';
export const THEMES: Record<ThemeId, { label: string; vars: Record<string, string> }> = {
  // Light = achromatic black / gray (TURN-026). Header red and semantic success / warning / danger stay.
  A: { label: '라이트', vars: { bg: '#f3f3f3', panel: '#ffffff', canvas: '#f6f6f6', border: '#8c8c8c', text: '#1c1c1c', muted: '#5c5c5c', accent: '#1a1a1a', selected: '#e6e6e6', success: '#176642', warning: '#8b4800', danger: '#b42336', grid: '#8c8c8c', rowh: '32px', pad: '12px', scheme: 'light', 'on-accent': '#ffffff', 'theme-light-bg': '#1a1a1a', 'theme-light-fg': '#ffffff', 'theme-dark-bg': '#ffffff', 'theme-dark-fg': '#1c1c1c', 'header-bg': '#A20034', 'header-fg': '#FFFFFF', 'header-muted': '#F5D6DE', 'header-border': '#FFFFFF' } },
  // Dark = Figma collection 화면색 mode 1:2 (aliases resolved to 기초 B/*, not the light fallbacks in generated reference code).
  B: { label: '다크', vars: { bg: '#101b2a', panel: '#19283a', canvas: '#101b2a', border: '#5c8496', text: '#eff5fd', muted: '#b3c4d9', accent: '#42d6cc', selected: '#203d4c', success: '#88dfb1', warning: '#ffd18a', danger: '#ff9fab', grid: '#5c8496', rowh: '32px', pad: '12px', scheme: 'dark', 'on-accent': '#102c2d', 'theme-light-bg': '#19283a', 'theme-light-fg': '#eff5fd', 'theme-dark-bg': '#42d6cc', 'theme-dark-fg': '#102c2d', 'header-bg': '#A20034', 'header-fg': '#FFFFFF', 'header-muted': '#F5D6DE', 'header-border': '#FFFFFF' } },
  // Archived palette. Not offered in the UI and not painted. A stored C is left untouched until the user picks 라이트 or 다크.
  C: { label: 'C 보관', vars: { bg: '#F1F0EB', panel: '#FCFBF7', canvas: '#F7F6F1', border: '#D9DDD5', text: '#283D3B', muted: '#73807B', accent: '#3E807A', selected: '#DFECE6', success: '#487D5E', warning: '#9E7B43', danger: '#A4473A', grid: '#E7E9E1', rowh: '36px', pad: '14px', scheme: 'light', 'on-accent': '#FFFFFF', 'header-bg': '#A20034', 'header-fg': '#FFFFFF', 'header-muted': '#F5D6DE', 'header-border': '#FFFFFF' } },
};
export const THEME_ORDER: ThemeId[] = ['A', 'B', 'C'];
export function appearanceOf(t: ThemeId): Appearance { return t === 'B' ? 'dark' : 'light'; }
/** Palette actually painted. C maps to the light palette without rewriting storage. */
export function paletteTheme(t: ThemeId): 'A' | 'B' { return t === 'B' ? 'B' : 'A'; }
/** Active cycle is light ↔ dark. From archived C the next explicit step is dark (B); choosing light writes A. */
export function nextTheme(t: ThemeId): ThemeId { return appearanceOf(t) === 'dark' ? 'A' : 'B'; }

export type LayerId = 'background' | 'units' | 'axis' | 'io' | 'positions' | 'flow';
export interface UserView {
  theme: ThemeId;
  visualMode: 'schematic' | 'photo';
  layers: Record<LayerId, boolean>;
  zoom: number;
  /** C10: current wizard step = current central workspace (menu and center view always derived from this one value) */
  step: StepId;
  /** per project id: step → confirmed fingerprint (UserView only; never in project files) */
  confirmed: Record<string, Partial<Record<StepId, string>>>;
  libraryFilter: { q: string; category: string };
  /** TURN-002: per project id → ids of collapsed tree rows (Station = equipment id, Substation = unit id). UserView only. */
  treeCollapsed: Record<string, string[]>;
  /** S00 start hub. View only — does not change the open project, revision, or run. */
  home: boolean;
  /** TURN-007: panel widths in px. This browser only — never written into a project file. */
  panels: PanelWidths;
  /** TURN-008: which explorer tab is showing. This browser only — never written into a project file. */
  explorerTab: ExplorerTab;
  /** TURN-009: card board or diagram under the layout palette. This browser only — never written into a project file. */
  layoutTab: LayoutTab;
  /** TURN-029: diagram or 3D on the run step. This browser only — never written into a project file. */
  runView: 'diagram' | '3d';
  /** TURN-035: explorer rail. This browser only — never written into a project file. */
  explorerOpen: boolean;
  /** TURN-035: the run summary strip is one line. This browser only. */
  runStripFolded: boolean;
  /** TURN-035: the run 「자세히」 panel. This browser only. */
  runDetailsOpen: boolean;
  runDetailsTab: RunDetailsTab;
  /** TURN-042: this browser finished or skipped the first-run tour. View only — never in a project file. */
  tourSeen: boolean;
  /** TURN-047: write a browser-local draft after edits. Default on. Never written into a project file. */
  autoDraft: boolean;
  /** TURN-048: stage-2 palette. This browser only — never written into a project file. */
  paletteOpen: boolean;
  /** TURN-048: minimap per drawing. Layout starts open, the run drawing starts closed. */
  minimap: { layout: boolean; run: boolean };
  /** TURN-056: help dock open. This browser only — never written into a project file. */
  helpOpen: boolean;
  /** TURN-056: dotted glossary on titles, tabs, the step bar, and table headers. Default on. */
  termHints: boolean;
  /**
   * TURN-070: name written into a confirmation row. This browser only — the project file
   * stores the name on each row, not this setting.
   */
  confirmerName: string;
}

/** TURN-007 resize targets. The main column stays at least PANEL_MAIN_MIN px while a panel is dragged. */
export type PanelKey = 'explorer' | 'library' | 'canvas' | 'run';
/** TURN-008 explorer tabs. Workspace contains projects, so it is listed first. Default is Project. */
export type ExplorerTab = 'workspace' | 'project';
/** TURN-009 layout tabs. The card board is the default; signal mode switches to the diagram. */
export type LayoutTab = 'board' | 'diagram';
/** TURN-035 tabs under the run canvas. The summary table is the default, and the panel starts closed. */
export type RunDetailsTab = 'summary' | 'log' | 'signals';
export interface PanelWidths { explorer: number; library: number; canvas: number; run: number }
export const PANEL_LIMITS: Record<PanelKey, { min: number; max: number; def: number }> = {
  explorer: { min: 180, max: 420, def: 224 },
  library: { min: 240, max: 560, def: 256 },
  canvas: { min: 240, max: 560, def: 256 },
  run: { min: 240, max: 560, def: 380 },
};
export const PANEL_MAIN_MIN = 480;
export const DEFAULT_PANELS: PanelWidths = {
  explorer: PANEL_LIMITS.explorer.def, library: PANEL_LIMITS.library.def, canvas: PANEL_LIMITS.canvas.def, run: PANEL_LIMITS.run.def,
};

/**
 * Clamp a panel width. `container` is the width of the row that holds the panel and the main column
 * (app for the explorer, the workspace for a right panel). Null or 0 skips the main-column floor
 * (jsdom has no layout) and keeps only the panel min/max. When the window cannot satisfy both,
 * the 480px main floor wins and the panel may sit below its minimum.
 */
export function clampPanel(kind: PanelKey, value: number, container: number | null): number {
  const lim = PANEL_LIMITS[kind];
  const n = Number.isFinite(value) ? Math.round(value) : lim.def;
  let hi = lim.max;
  if (container !== null && container > 0) {
    const room = container - PANEL_MAIN_MIN;
    if (room > 0) hi = Math.min(lim.max, room);
  }
  const lo = Math.min(lim.min, hi);
  return Math.min(hi, Math.max(lo, n));
}

function cleanPanels(v: unknown): PanelWidths {
  const out: PanelWidths = { ...DEFAULT_PANELS };
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  const o = v as Record<string, unknown>;
  (Object.keys(PANEL_LIMITS) as PanelKey[]).forEach((k) => {
    const n = o[k];
    if (typeof n === 'number' && Number.isFinite(n)) out[k] = clampPanel(k, n, null);
  });
  return out;
}

export const DEFAULT_VIEW: UserView = { theme: 'A', visualMode: 'schematic', layers: { background: true, units: true, axis: true, io: true, positions: true, flow: true }, zoom: 1,
  step: 'library', confirmed: {}, libraryFilter: { q: '', category: '' }, treeCollapsed: {}, home: true, panels: { ...DEFAULT_PANELS }, explorerTab: 'project', layoutTab: 'board', runView: 'diagram',
  explorerOpen: true, runStripFolded: false, runDetailsOpen: false, runDetailsTab: 'summary', tourSeen: false, autoDraft: true,
  paletteOpen: true, minimap: { layout: true, run: false }, helpOpen: false, termHints: true, confirmerName: '' };

function cleanMinimap(v: unknown): { layout: boolean; run: boolean } {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
  return { layout: o.layout === false ? false : true, run: o.run === true };
}

function cleanCollapsed(v: unknown): Record<string, string[]> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, string[]> = {};
  for (const [k, ids] of Object.entries(v as Record<string, unknown>)) if (Array.isArray(ids)) out[k] = ids.filter((x): x is string => typeof x === 'string');
  return out;
}

export function loadView(kv: KV | null): UserView {
  if (!kv) return DEFAULT_VIEW;
  try {
    const v = kv.getItem(VIEW_KEY); if (!v) return DEFAULT_VIEW;
    const o = JSON.parse(v);
    // TURN-030 `runTab` is retired. Drop it so a saved view does not keep the old key.
    delete o.runTab;
    const rest = o;
    return { ...DEFAULT_VIEW, ...rest, layers: { ...DEFAULT_VIEW.layers, ...(o.layers ?? {}) }, theme: THEME_ORDER.includes(o.theme) ? o.theme : 'A',
      // broken/unknown UserView step → first valid step (model is never reset because of view data)
      step: STEPS.some((s) => s.id === o.step) ? o.step : 'library',
      visualMode: o.visualMode === 'photo' ? 'photo' : 'schematic',
      confirmed: o.confirmed && typeof o.confirmed === 'object' ? o.confirmed : {},
      libraryFilter: { ...DEFAULT_VIEW.libraryFilter, ...(o.libraryFilter ?? {}) },
      treeCollapsed: cleanCollapsed(o.treeCollapsed),
      panels: cleanPanels(o.panels),
      explorerTab: o.explorerTab === 'workspace' ? 'workspace' : 'project',
      layoutTab: o.layoutTab === 'diagram' ? 'diagram' : 'board',
      runView: o.runView === '3d' ? '3d' : 'diagram',
      explorerOpen: o.explorerOpen === false ? false : true,
      runStripFolded: o.runStripFolded === true,
      runDetailsOpen: o.runDetailsOpen === true,
      runDetailsTab: o.runDetailsTab === 'log' || o.runDetailsTab === 'signals' ? o.runDetailsTab : 'summary',
      // missing home (views saved before the start hub) opens S00 once; an explicit false is kept. Theme C is not rewritten here.
      home: o.home === false ? false : true,
      // missing tourSeen (views saved before TURN-042) means this browser has not finished the tour.
      tourSeen: o.tourSeen === true,
      // missing autoDraft (views saved before TURN-047) stays on. Only an explicit false turns drafts off.
      autoDraft: o.autoDraft === false ? false : true,
      // TURN-048: a missing palette stays open. A missing minimap is open on the layout and closed on the run drawing.
      paletteOpen: o.paletteOpen === false ? false : true,
      minimap: cleanMinimap(o.minimap),
      // missing helpOpen stays closed. missing termHints stays on.
      helpOpen: o.helpOpen === true,
      termHints: o.termHints === false ? false : true,
      confirmerName: normalizeConfirmerName(typeof o.confirmerName === 'string' ? o.confirmerName : '') };
  } catch { return DEFAULT_VIEW; }
}
export function saveView(kv: KV | null, v: UserView) { if (!kv) return; try { kv.setItem(VIEW_KEY, JSON.stringify(v)); } catch { /* ignore */ } }
