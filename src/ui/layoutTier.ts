// TURN-085. Width tiers, the layout each tier remembers, and putting the screen back.
import { useEffect, useState } from 'react';
import {
  clampPanel, DEFAULT_PANELS, PANEL_LIMITS,
  type LayoutSlice, type PanelKey, type PanelWidths, type UserView, type WidthTier,
} from './viewSettings';

export const TIER_NARROW_MIN = 1024;
export const TIER_NORMAL_MIN = 1280;
export const TIER_WIDE_MIN = 1600;
export const RAIL = 40;
export const RUN_STEPS = 232;
export const RUN_COND = 248;
export const WIDE_STEPS = 280;
export const WIDE_COND = 320;

export function widthTier(width: number): WidthTier {
  if (width >= TIER_WIDE_MIN) return 'wide';
  if (width >= TIER_NORMAL_MIN) return 'normal';
  return 'narrow';
}

export function viewportTooNarrow(width: number): boolean {
  return width < TIER_NARROW_MIN;
}

/**
 * jsdom reports a width and a clientWidth of 0. Treat that as the normal tier so existing
 * mounts keep the 1280 layout. A real window has a positive clientWidth, including 1024.
 */
export function settledLayoutWidth(innerWidth: number, clientWidth: number): number {
  if (!(clientWidth > 0)) return TIER_NORMAL_MIN;
  if (!(innerWidth > 0)) return TIER_NORMAL_MIN;
  return innerWidth;
}

export function useLayoutWidth(): number {
  const read = () => settledLayoutWidth(
    typeof window === 'undefined' ? 0 : window.innerWidth || 0,
    typeof document === 'undefined' ? 0 : document.documentElement?.clientWidth || 0,
  );
  const [width, setWidth] = useState(read);
  useEffect(() => {
    const apply = () => {
      const next = read();
      setWidth((cur) => (cur === next ? cur : next));
    };
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);
  return width;
}

export function defaultLayout(tier: WidthTier): LayoutSlice {
  const narrow = tier === 'narrow';
  return {
    panels: { ...DEFAULT_PANELS },
    explorerOpen: !narrow,
    propsFolded: narrow,
    condFolded: narrow,
    stepsFolded: false,
    runStripFolded: false,
    runDetailsOpen: false,
  };
}

export function defaultLayouts(): Record<WidthTier, LayoutSlice> {
  return { narrow: defaultLayout('narrow'), normal: defaultLayout('normal'), wide: defaultLayout('wide') };
}

function flag(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function cleanSlice(tier: WidthTier, raw: unknown, base: LayoutSlice): LayoutSlice {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;
  const panels = { ...base.panels };
  const src = o.panels;
  if (src && typeof src === 'object' && !Array.isArray(src)) {
    const p = src as Record<string, unknown>;
    (Object.keys(PANEL_LIMITS) as PanelKey[]).forEach((k) => {
      const n = p[k];
      if (typeof n === 'number' && Number.isFinite(n)) panels[k] = clampPanel(k, n, null, tier);
    });
  }
  return {
    panels,
    explorerOpen: flag(o.explorerOpen, base.explorerOpen),
    propsFolded: flag(o.propsFolded, base.propsFolded),
    condFolded: flag(o.condFolded, base.condFolded),
    stepsFolded: flag(o.stepsFolded, base.stepsFolded),
    runStripFolded: flag(o.runStripFolded, base.runStripFolded),
    runDetailsOpen: flag(o.runDetailsOpen, base.runDetailsOpen),
  };
}

/** Old saves have one set of widths and folds. Those become the normal tier. */
export function cleanLayoutTiers(raw: unknown, legacy: {
  panels: PanelWidths;
  explorerOpen: boolean;
  runStripFolded: boolean;
  runDetailsOpen: boolean;
}): Record<WidthTier, LayoutSlice> {
  const saved = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const normalBase = defaultLayout('normal');
  normalBase.panels = { ...legacy.panels };
  normalBase.explorerOpen = legacy.explorerOpen;
  normalBase.runStripFolded = legacy.runStripFolded;
  normalBase.runDetailsOpen = legacy.runDetailsOpen;
  return {
    narrow: cleanSlice('narrow', saved.narrow, defaultLayout('narrow')),
    normal: cleanSlice('normal', saved.normal, normalBase),
    wide: cleanSlice('wide', saved.wide, defaultLayout('wide')),
  };
}

function copySlice(s: LayoutSlice): LayoutSlice {
  return { ...s, panels: { ...s.panels } };
}

function sameSlice(a: LayoutSlice, b: LayoutSlice): boolean {
  return a.explorerOpen === b.explorerOpen
    && a.propsFolded === b.propsFolded
    && a.condFolded === b.condFolded
    && a.stepsFolded === b.stepsFolded
    && a.runStripFolded === b.runStripFolded
    && a.runDetailsOpen === b.runDetailsOpen
    && a.panels.explorer === b.panels.explorer
    && a.panels.library === b.panels.library
    && a.panels.canvas === b.panels.canvas
    && a.panels.run === b.panels.run;
}

export function patchLayout(view: UserView, tier: WidthTier, patch: Partial<Omit<LayoutSlice, 'panels'>> & { panels?: PanelWidths }): UserView {
  const cur = view.layoutByTier?.[tier] ?? defaultLayout(tier);
  const next: LayoutSlice = { ...cur, ...patch, panels: patch.panels ? { ...patch.panels } : cur.panels };
  if (sameSlice(cur, next)) return view;
  const layoutByTier = { ...view.layoutByTier, [tier]: next };
  if (tier !== 'normal') return { ...view, layoutByTier };
  return {
    ...view,
    layoutByTier,
    panels: { ...next.panels },
    explorerOpen: next.explorerOpen,
    runStripFolded: next.runStripFolded,
    runDetailsOpen: next.runDetailsOpen,
  };
}

export interface LayoutSnapshot {
  layoutByTier: Record<WidthTier, LayoutSlice>;
  panels: PanelWidths;
  explorerOpen: boolean;
  runStripFolded: boolean;
  runDetailsOpen: boolean;
  paletteOpen: boolean;
  minimap: { layout: boolean; run: boolean };
  helpSide: 'left' | 'right';
  helpFolded: boolean;
}

export function captureLayout(view: UserView): LayoutSnapshot {
  const tiers = view.layoutByTier ?? defaultLayouts();
  return {
    layoutByTier: { narrow: copySlice(tiers.narrow), normal: copySlice(tiers.normal), wide: copySlice(tiers.wide) },
    panels: { ...view.panels },
    explorerOpen: view.explorerOpen,
    runStripFolded: view.runStripFolded,
    runDetailsOpen: view.runDetailsOpen,
    paletteOpen: view.paletteOpen,
    minimap: { ...view.minimap },
    helpSide: view.helpSide,
    helpFolded: view.helpFolded,
  };
}

/** Widths, folds, minimap, palette, and help position. Theme and the other settings stay. */
export function resetLayout(view: UserView): UserView {
  const layoutByTier = defaultLayouts();
  const normal = layoutByTier.normal;
  return {
    ...view,
    layoutByTier,
    panels: { ...normal.panels },
    explorerOpen: normal.explorerOpen,
    runStripFolded: normal.runStripFolded,
    runDetailsOpen: normal.runDetailsOpen,
    paletteOpen: true,
    minimap: { layout: true, run: false },
    helpSide: 'right',
    helpFolded: false,
  };
}

export function restoreLayout(view: UserView, snap: LayoutSnapshot): UserView {
  return {
    ...view,
    layoutByTier: {
      narrow: copySlice(snap.layoutByTier.narrow),
      normal: copySlice(snap.layoutByTier.normal),
      wide: copySlice(snap.layoutByTier.wide),
    },
    panels: { ...snap.panels },
    explorerOpen: snap.explorerOpen,
    runStripFolded: snap.runStripFolded,
    runDetailsOpen: snap.runDetailsOpen,
    paletteOpen: snap.paletteOpen,
    minimap: { ...snap.minimap },
    helpSide: snap.helpSide,
    helpFolded: snap.helpFolded,
  };
}

export function columnWidths(tier: WidthTier, slice: LayoutSlice) {
  const explorer = tier === 'narrow' ? RAIL : (slice.explorerOpen ? slice.panels.explorer : RAIL);
  const props = slice.propsFolded ? RAIL : slice.panels.canvas;
  const steps = slice.stepsFolded ? RAIL : (tier === 'wide' ? WIDE_STEPS : RUN_STEPS);
  const cond = slice.condFolded ? RAIL : (tier === 'wide' ? WIDE_COND : RUN_COND);
  return { explorer, props, steps, cond };
}

/** Center column after the side columns. Narrow keeps the explorer as a 40px rail (the open panel overlays). */
export function workColumnWidth(viewport: number, tier: WidthTier, slice: LayoutSlice, surface: 'canvas' | 'run'): number {
  const c = columnWidths(tier, slice);
  const used = surface === 'canvas' ? c.explorer + c.props : c.explorer + c.steps + c.cond;
  return Math.max(0, viewport - used);
}
