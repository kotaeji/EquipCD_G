// TURN-069. Which header actions stay on the bar, and when the help dock overlays.
import { useEffect, useState } from 'react';

/** At this width and above, every header action stays on the bar with its label. */
export const HEADER_WIDE = 1440;
/** Below this width the less-used actions always move into 「더 보기」. */
export const HEADER_MEDIUM = 1280;
/** Help sits beside the workspace at this width. Below it, the dock overlays. */
export const HELP_BESIDE_MIN = 1440;

export type HeaderTier = 'wide' | 'medium' | 'compact';
export type HelpLayout = 'beside' | 'overlay';

export function headerTier(width: number): HeaderTier {
  if (width >= HEADER_WIDE) return 'wide';
  if (width >= HEADER_MEDIUM) return 'medium';
  return 'compact';
}

export function helpLayout(width: number): HelpLayout {
  return width >= HELP_BESIDE_MIN ? 'beside' : 'overlay';
}

export function useViewportWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? HEADER_MEDIUM : window.innerWidth || HEADER_MEDIUM));
  useEffect(() => {
    const read = () => setWidth(window.innerWidth || HEADER_MEDIUM);
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);
  return width;
}

/**
 * Hide the tail first. `ids` is DOM order (export, view settings, help, then anything added later).
 * The tail is the least-used action, so it enters 「더 보기」 before the ones in front.
 * `overflowPx` is the spill while every extra is visible and the more button is hidden.
 */
export function collapseOverflow(ids: readonly string[], overflowPx: number, widths: readonly number[], moreWidth: number): string[] {
  if (overflowPx <= 1) return [];
  let over = overflowPx + Math.max(0, moreWidth);
  const hide: string[] = [];
  for (let i = ids.length - 1; i >= 0 && over > 1; i--) {
    hide.unshift(ids[i]);
    over -= widths[i] ?? 0;
  }
  return hide;
}

export function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** Read which `[data-overflow]` actions do not fit. Restores the bar before returning. */
export function measureHeaderOverflow(header: HTMLElement, tier: HeaderTier): string[] {
  const buttons = [...header.querySelectorAll<HTMLButtonElement>('[data-overflow]')];
  const ids = buttons.map((b) => b.dataset.overflow ?? '');
  if (tier === 'wide') return [];
  if (tier === 'compact') return ids;
  const prev = buttons.map((b) => b.classList.contains('header-overflow'));
  const more = header.querySelector<HTMLElement>('[data-header-more]');
  const morePrev = more?.classList.contains('header-overflow') ?? true;
  const mark = (el: HTMLElement, hide: boolean) => el.classList.toggle('header-overflow', hide);
  buttons.forEach((b) => mark(b, false));
  if (more) mark(more, true);
  const widths = buttons.map((b) => b.getBoundingClientRect().width);
  let moreWidth = 0;
  if (more) {
    mark(more, false);
    moreWidth = more.getBoundingClientRect().width;
    mark(more, true);
  }
  const overflow = header.scrollWidth - header.clientWidth;
  const hide = header.clientWidth > 0 && widths.some((w) => w > 0)
    ? collapseOverflow(ids, overflow, widths, moreWidth)
    : [];
  buttons.forEach((b, i) => mark(b, prev[i]));
  if (more) mark(more, morePrev);
  return hide;
}
