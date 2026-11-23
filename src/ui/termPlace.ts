// Glossary tip geometry. Pure so a repeated measure cannot schedule another render.

export interface TermTipBox {
  left: number;
  bottom: number;
}

export interface TermTipColors {
  bg: string;
  fg: string;
  border: string;
}

export interface TermTipPos extends TermTipColors {
  top: number;
  left: number;
}

export const TERM_TIP_WIDTH = 280;

/** Place the tip under the anchor and keep it inside the viewport. */
export function placeTermTip(
  anchor: TermTipBox | null,
  viewportWidth: number,
  colors: TermTipColors,
  width = TERM_TIP_WIDTH,
): TermTipPos | null {
  if (!anchor) return null;
  const left = Math.max(8, Math.min(anchor.left, viewportWidth - width - 8));
  const top = anchor.bottom + 4;
  return { top, left, bg: colors.bg, fg: colors.fg, border: colors.border };
}

export function sameTermTipPos(a: TermTipPos, b: TermTipPos): boolean {
  return a.top === b.top && a.left === b.left && a.bg === b.bg && a.fg === b.fg && a.border === b.border;
}

/** Keep the previous object when the next place matches, so the same input does not update state. */
export function nextTermTipPos(prev: TermTipPos, next: TermTipPos | null): TermTipPos {
  if (!next || sameTermTipPos(prev, next)) return prev;
  return next;
}
