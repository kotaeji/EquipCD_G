// TURN-048: 1280×800 stage-2 diagram room.
// The open palette scrolls inside PALETTE_OPEN_MAX so the schematic stays at least DIAGRAM_MIN.
// Heights below are the stage rows measured at 1280×800 (Noto Sans KR, device pixel ratio 1).

/** Floor for `.diagram-canvas` when the stage-2 palette is open at 1280×800. */
export const DIAGRAM_MIN = 320;

/** One palette row. The other kinds scroll inside `.layout-stage .palette-fold .palette`. */
export const PALETTE_OPEN_MAX = 40;

/**
 * Vertical budget, px. Shell: header 64, work bar 44, stepper 72, status 48 → workspace 572.
 * Stage pads 2+2 and gaps 4 between head, hint, palette, and the tab block.
 * `tools` is the diagram tool row (two-line hint plus the 28px buttons).
 * `panelGap` is the gap between that row and the schematic.
 */
export const STAGE2_BUDGET = {
  viewportH: 800,
  header: 64,
  workbar: 44,
  stepper: 72,
  statusbar: 48,
  stagePadY: 2,
  stageGap: 4,
  rows: 4,
  head: 44,
  hint: 16.2,
  summary: 19.6,
  paletteMax: PALETTE_OPEN_MAX,
  tab: 37,
  tools: 68.4,
  panelGap: 8,
} as const;

/** Legend is 28px at the top. Zoom controls are three 28px buttons at the bottom. */
export const LEGEND_H = 28;
export const ZOOM_CONTROLS_H = 84;

export function stage2DiagramHeight(b = STAGE2_BUDGET): number {
  const workspace = b.viewportH - b.header - b.workbar - b.stepper - b.statusbar;
  const gaps = b.stageGap * (b.rows - 1);
  const inner = workspace - b.stagePadY * 2 - gaps;
  const above = b.head + b.hint + b.summary + b.paletteMax + b.tab + b.tools + b.panelGap;
  return inner - above;
}

/** Legend and zoom controls sit on opposite edges of the diagram and do not meet. */
export function stage2OverlayClears(diagramH: number): boolean {
  return diagramH >= LEGEND_H + ZOOM_CONTROLS_H + 8;
}
