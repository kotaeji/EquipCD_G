// TURN-048: stage-2 diagram room.
// The palette keeps every wrapped row while the schematic stays at least DIAGRAM_MIN.
// It shrinks and scrolls only when showing every row would push the schematic under that floor.
// Row heights below are the open palette's content height at that width (Noto Sans KR, dpr 1).

/** Floor for `.diagram-canvas` on the layout step. */
export const DIAGRAM_MIN = 320;

/**
 * Natural height of the open palette (every wrapped row, no cap).
 * 1280-wide stage fits the 15 kinds in three rows (116px). 1600-wide fits them in two (76px).
 */
export const PALETTE_NATURAL = { w1280: 116, w1600: 76 } as const;

/**
 * Vertical budget, px, aside from the palette body. Shell: header 64, work bar 44, stepper 72, status 48.
 * Stage pads 2+2 and gaps 4 between head, hint, palette, and the tab block.
 * `tools` is the diagram tool row. `panelGap` is the gap between that row and the schematic.
 */
export const STAGE2_BUDGET = {
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
  tab: 37,
  tools: 68.4,
  panelGap: 8,
} as const;

/** Legend is 28px at the top. Zoom controls are three 28px buttons at the bottom. */
export const LEGEND_H = 28;
export const ZOOM_CONTROLS_H = 84;

/** Height left for the palette body and the schematic together. */
export function roomForPaletteAndDiagram(viewportH: number, b = STAGE2_BUDGET): number {
  const workspace = viewportH - b.header - b.workbar - b.stepper - b.statusbar;
  const gaps = b.stageGap * (b.rows - 1);
  const inner = workspace - b.stagePadY * 2 - gaps;
  const beside = b.head + b.hint + b.summary + b.tab + b.tools + b.panelGap;
  return inner - beside;
}

/**
 * Show the whole palette when the schematic still clears `diagramMin`.
 * Otherwise shorten the palette and keep the schematic on that floor.
 */
export function fitPalette(room: number, naturalPalette: number, diagramMin = DIAGRAM_MIN) {
  const roomLeft = Math.max(0, room);
  const natural = Math.max(0, naturalPalette);
  const palette = Math.min(natural, Math.max(0, roomLeft - diagramMin));
  return { palette, diagram: roomLeft - palette, clipped: natural - palette > 0.5 };
}

export function stage2DiagramHeight(viewportH = 800, naturalPalette = PALETTE_NATURAL.w1280): number {
  return fitPalette(roomForPaletteAndDiagram(viewportH), naturalPalette).diagram;
}

/** Legend and zoom controls sit on opposite edges of the diagram and do not meet. */
export function stage2OverlayClears(diagramH: number): boolean {
  return diagramH >= LEGEND_H + ZOOM_CONTROLS_H + 8;
}
