// TURN-090. When the flow table folds its row buttons, and when sequence cards stack.

/** Row-end buttons stay on the row at this table width and above. Narrower tables use 「⋯」. */
export const FLOW_TABLE_WIDE = 720;

/**
 * Unmeasured width (jsdom reports 0) keeps the buttons, so existing tests still find 「위로」.
 * A positive width below {@link FLOW_TABLE_WIDE} folds them.
 */
export function flowRowActionsCompact(tableWidth: number): boolean {
  return tableWidth > 0 && tableWidth < FLOW_TABLE_WIDE;
}

/**
 * One Substation sequence card's minimum.
 * `substation-panels.css` sets `--seq-card-min` to 16 × `--sp-6` (32px), which is this number.
 */
export const SEQ_CARD_MIN = 512;

/**
 * How many cards share a row.
 * Mirrors `repeat(auto-fill, minmax(min(100%, var(--seq-card-min)), 1fr))` with `--sp-3` (12px) gap.
 */
export function seqColumnCount(containerWidth: number, min = SEQ_CARD_MIN, gap = 12): number {
  if (!(containerWidth > 0)) return 1;
  const track = Math.min(containerWidth, min);
  return Math.max(1, Math.floor((containerWidth + gap) / (track + gap)));
}
