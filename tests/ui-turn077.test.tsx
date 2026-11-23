// @vitest-environment jsdom
// TURN-077: one focus ring, 24px press targets, and the shell tab order.
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/ui/App';
import { DIM_EDGE_OPACITY } from '../src/ui/edgeFocus';
import { THEMES } from '../src/ui/viewSettings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const lum = (hex: string) => {
  const h = hex.replace('#', '');
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  localStorage.clear();
});

async function mount() {
  localStorage.clear();
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(<App />); });
  const click = async (node: Element | null | undefined) => {
    if (!node) throw new Error('missing control');
    await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  };
  return { el, click };
}

function skipped(el: HTMLElement): boolean {
  if (el.tabIndex < 0) return true;
  if ((el as HTMLButtonElement).disabled) return true;
  if (el.getAttribute('aria-hidden') === 'true') return true;
  if (el instanceof HTMLInputElement && el.type === 'hidden') return true;
  const closed = el.closest('details');
  if (closed && !closed.open && !el.closest('summary')) return true;
  let n: HTMLElement | null = el;
  while (n) {
    if (n.hasAttribute('hidden')) return true;
    if (/display\s*:\s*none/.test(n.getAttribute('style') ?? '')) return true;
    n = n.parentElement;
  }
  return false;
}

function focusables(rootEl: ParentNode): HTMLElement[] {
  const sel = 'a[href], button, input, select, textarea, [tabindex]';
  return [...rootEl.querySelectorAll<HTMLElement>(sel)].filter((el) => !skipped(el));
}

function region(el: Element): string | null {
  if (el.closest('.modal-bg, .toast, .itemspop, .help-panel, .tour-pop, .cmd-panel')) return null;
  if (el.closest('.header')) return 'header';
  if (el.closest('.workbar')) return 'workbar';
  if (el.closest('.stepper')) return 'stepper';
  if (el.closest('.explorer')) return 'explorer';
  if (el.closest('.statusbar')) return 'status';
  if (el.closest('.right, .libdetail, .run-conditions')) return 'props';
  if (el.closest('.workspace')) return 'center';
  return 'other';
}

const RING = 'outline: 2px solid var(--focus)';
const OFFSET = 'outline-offset: 2px';

describe('TURN-077 focus ring and press size', () => {
  const styles = readFileSync('src/ui/styles.css', 'utf8');
  const hit = readFileSync('src/ui/focus-target.css', 'utf8');
  const nodes = readFileSync('src/ui/canvas-focus.css', 'utf8');

  it('AC3 AC4 the listed controls share a 2px --focus ring, and the ring clears 3:1', () => {
    expect(styles).toMatch(/:where\(button, a, select, input, textarea, \[tabindex\]\):focus-visible \{ outline: 2px solid var\(--focus\); outline-offset: 2px/);
    expect(styles).toMatch(/\.card:focus-visible \{ outline: 2px solid var\(--focus\); outline-offset: 2px/);
    expect(styles).toMatch(/\.tree \[role=treeitem\]:focus-visible \{ outline: 2px solid var\(--focus\); outline-offset: 2px/);
    expect(styles).toMatch(/\.tree \.titem:focus-visible > \.tnode \{ outline: 2px solid var\(--focus\); outline-offset: 2px/);
    expect(styles).toMatch(/\.ctx-menu button:focus-visible \{[^}]*outline: 2px solid var\(--focus\); outline-offset: 2px/);
    expect(styles).toMatch(/\.header :focus-visible \{[^}]*outline: 2px solid var\(--focus\)/);
    expect(styles).toMatch(/\.app > \.header \{[^}]*--focus:\s*#FFFFFF/);
    expect(hit).toContain(RING);
    expect(hit).toContain(OFFSET);
    expect(hit).toMatch(/tr\[tabindex\]:focus-visible/);
    expect(nodes).toContain(RING);
    expect(nodes).toContain(OFFSET);
    expect(nodes).toMatch(/\.react-flow__node:focus-visible/);
    expect(nodes).toMatch(/\.react-flow__node:focus \{[^}]*outline: none/);
    expect(styles).not.toMatch(/:focus-visible \{ outline: 2px solid var\(--accent\)/);
    for (const bg of [THEMES.A.vars.bg, THEMES.A.vars.panel, THEMES.A.vars.canvas, THEMES.A.vars.selected]) {
      expect(ratio(THEMES.A.vars.focus, bg)).toBeGreaterThanOrEqual(3);
    }
    for (const bg of [THEMES.B.vars.bg, THEMES.B.vars.panel, THEMES.B.vars.canvas, THEMES.B.vars.selected]) {
      expect(ratio(THEMES.B.vars.focus, bg)).toBeGreaterThanOrEqual(3);
    }
    expect(ratio('#FFFFFF', THEMES.A.vars['header-bg'])).toBeGreaterThanOrEqual(3);
    expect(ratio('#FFFFFF', THEMES.B.vars['header-bg'])).toBeGreaterThanOrEqual(3);
    expect(DIM_EDGE_OPACITY).toBe(0.42);
  });

  it('AC5 icon buttons, close marks, tree twists, and checks expose a 24px press box', () => {
    expect(hit).toMatch(/button\.small\.icon \{[^}]*width: 24px;[^}]*height: 24px;[^}]*min-width: 24px;[^}]*min-height: 24px/);
    expect(hit).toMatch(/button\.x \{[^}]*min-width: 24px;[^}]*min-height: 24px/);
    expect(hit).toMatch(/\.tree \.twisty::before \{[^}]*width: 24px;[^}]*height: 24px/);
    expect(hit).toMatch(/input\[type="checkbox"\] \{[^}]*width: 24px;[^}]*height: 24px;[^}]*min-width: 24px;[^}]*min-height: 24px/);
    expect(hit).toMatch(/label\.check-hit::before \{[^}]*width: 24px;[^}]*height: 24px/);
    expect(hit).toMatch(/label\.check-hit \{[^}]*width: 16px;[^}]*height: 16px/);
    expect(styles).toMatch(/\.ptab \.x \{[^}]*width: 24px;[^}]*height: 24px/);
    expect(styles).toMatch(/\.exitem \.x \{[^}]*width: 24px;[^}]*height: 24px/);
  });
});

describe('TURN-077 tab order', () => {
  it('AC6 walks header, step bar, explorer, center, properties, then the status bar, and skips closed panes', async () => {
    const u = await mount();
    await u.click([...u.el.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('시작하기')));
    await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]'));
    const order = ['header', 'workbar', 'stepper', 'explorer', 'center', 'props', 'status'];
    const seen: string[] = [];
    for (const el of focusables(u.el)) {
      const name = region(el);
      if (!name) continue;
      expect(name, el.getAttribute('aria-label') ?? el.textContent ?? el.className).not.toBe('other');
      if (seen[seen.length - 1] !== name) seen.push(name);
    }
    expect(seen).toEqual(order);
    const list = focusables(u.el);
    const stage = list.find((el) => el.closest('.stage'));
    const split = list.find((el) => el.getAttribute('data-split') === 'canvas');
    const prop = list.find((el) => el.closest('.right'));
    expect(list.indexOf(stage!)).toBeGreaterThan(-1);
    expect(list.indexOf(stage!)).toBeLessThan(list.indexOf(split!));
    expect(list.indexOf(split!)).toBeLessThan(list.indexOf(prop!));

    const diagram = u.el.querySelector('#layout-panel-diagram') as HTMLElement;
    expect(diagram.hasAttribute('hidden')).toBe(true);
    expect(focusables(u.el).some((el) => diagram.contains(el))).toBe(false);

    await u.click(u.el.querySelector('[aria-label="탐색기 접기"]'));
    expect(focusables(u.el).some((el) => el.closest('.tree'))).toBe(false);
    expect(focusables(u.el).some((el) => el.getAttribute('aria-label') === '탐색기 펼치기')).toBe(true);
    await u.click(u.el.querySelector('[aria-label="탐색기 펼치기"]'));

    await u.click(u.el.querySelector('[data-tree-id="PSH-01"]'));
    const summary = [...u.el.querySelectorAll('summary')].find((s) => (s.textContent ?? '').includes('속성 자세히'))!;
    await u.click(summary);
    const fold = summary.closest('details')!;
    expect(fold.open).toBe(false);
    expect(focusables(u.el).some((el) => fold.contains(el) && !el.closest('summary'))).toBe(false);

    await u.click([...u.el.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('모두 접기')));
    expect(u.el.querySelector('[data-tree-id="PSH-01"]')).toBeNull();
    expect(u.el.querySelector('.tree .twisty')).toBeTruthy();

    await u.click(u.el.querySelector('.stepper [data-stepid="sequence"]'));
    expect(u.el.querySelector('label.check-hit input[type="checkbox"]')).toBeTruthy();
    expect(u.el.querySelector('table.grid tr[tabindex="0"]')).toBeTruthy();
    await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]'));
    await u.click(u.el.querySelector('#layout-tab-diagram'));
    expect(u.el.querySelector('.react-flow__node')).toBeTruthy();
    expect(readFileSync('src/ui/Canvas.tsx', 'utf8')).toContain('focusable: L.units');
    expect(readFileSync('src/ui/Canvas.tsx', 'utf8')).toContain('focusable: !axisOff');
  });
});
