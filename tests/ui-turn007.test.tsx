// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { History } from '../src/model/history';
import { serializeProject } from '../src/storage/fileFormat';
import { App } from '../src/ui/App';
import { clampPanel, loadView, PANEL_LIMITS, PANEL_MAIN_MIN, THEMES } from '../src/ui/viewSettings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const css = readFileSync('src/ui/styles.css', 'utf8');
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  document.head.querySelectorAll('style').forEach((s) => s.remove());
  localStorage.clear();
});

async function mount(opts?: { css?: boolean; fresh?: boolean }) {
  if (opts?.css) {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }
  if (opts?.fresh !== false) localStorage.clear();
  const el = document.createElement('div');
  document.body.appendChild(el);
  const seen: { h: History | null } = { h: null };
  root = createRoot(el);
  await act(async () => { root!.render(<App onHistory={(h) => { seen.h = h; }} />); });
  const app = () => el.querySelector('.app') as HTMLElement;
  const click = async (node: Element) => { await act(async () => { (node as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(label)) as HTMLButtonElement;
  return { el, app, click, btn, history: () => seen.h! };
}

function setBox(el: Element, px: number) {
  Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => px });
}

async function pointerDrag(handle: HTMLElement, from: number, to: number) {
  await act(async () => {
    handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: from, pointerId: 1, button: 0 }));
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: to, pointerId: 1 }));
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: to, pointerId: 1 }));
  });
}

function split(el: ParentNode, kind: string) {
  return el.querySelector(`[data-split="${kind}"]`) as HTMLElement;
}

function expectAllOpen(el: ParentNode, where: string) {
  const shut = [...el.querySelectorAll('details')].filter((d) => !(d as HTMLDetailsElement).open || !d.hasAttribute('open'));
  expect(shut.map((d) => `${d.className} open=${(d as HTMLDetailsElement).open}`), where).toEqual([]);
}

describe('TURN-007 clamp', () => {
  it('keeps each panel inside its min and max, and keeps the main column at 480px', () => {
    expect(clampPanel('explorer', 224, null)).toBe(224);
    expect(clampPanel('explorer', 10, null)).toBe(PANEL_LIMITS.explorer.min);
    expect(clampPanel('explorer', 900, null)).toBe(PANEL_LIMITS.explorer.max);
    expect(clampPanel('library', Number.NaN, null)).toBe(PANEL_LIMITS.library.def);
    expect(clampPanel('run', 100, null)).toBe(240);
    expect(clampPanel('run', 900, null)).toBe(560);
    // 680px row: main floor leaves 200px, which is inside the explorer range and below the 420 max.
    expect(clampPanel('explorer', 400, 680)).toBe(680 - PANEL_MAIN_MIN);
    // A row that cannot fit the panel minimum still keeps 480px for the main column.
    expect(clampPanel('canvas', 400, 600)).toBe(600 - PANEL_MAIN_MIN);
    expect(clampPanel('explorer', 50, 0)).toBe(180);
  });

  it('drops broken saved widths and fills widths missing from older views', () => {
    const kv = localStorage;
    kv.setItem('ecd.v1.userView', JSON.stringify({ theme: 'B', panels: { explorer: 9999, library: 'wide', canvas: 100, run: 300 } }));
    const v = loadView(kv);
    expect(v.theme).toBe('B');
    expect(v.panels).toEqual({ explorer: 420, library: 256, canvas: 240, run: 300 });
    kv.setItem('ecd.v1.userView', JSON.stringify({ theme: 'A', home: false }));
    expect(loadView(kv).panels).toEqual({ explorer: 224, library: 256, canvas: 256, run: 380 });
  });
});

describe('TURN-007 icons and name dialog', () => {
  it('AC1: rename and close icons are at least 24×24 with a 16px glyph, text color on the panel', async () => {
    const icon = css.slice(css.indexOf('.exitem .x {'), css.indexOf('.exitem .x:hover'));
    expect(icon).toMatch(/width:\s*24px/);
    expect(icon).toMatch(/height:\s*24px/);
    expect(icon).toMatch(/min-width:\s*24px/);
    expect(icon).toMatch(/min-height:\s*24px/);
    expect(icon).toMatch(/font-size:\s*16px/);
    expect(icon).toMatch(/color:\s*var\(--text\)/);
    expect(icon).not.toMatch(/var\(--muted\)/);
    const tab = css.slice(css.indexOf('.ptab .x {'), css.indexOf('.section'));
    expect(tab).toMatch(/width:\s*24px/);
    expect(tab).toMatch(/font-size:\s*16px/);
    expect(tab).toMatch(/color:\s*var\(--text\)/);
    expect(css).toMatch(/\.exitem \.x:hover, \.ptab \.x:hover \{ background: var\(--selected\)/);
    for (const id of ['A', 'B'] as const) {
      expect(ratio(THEMES[id].vars.text, THEMES[id].vars.panel), id).toBeGreaterThanOrEqual(3);
    }
    const u = await mount({ css: true });
    const buttons = [...u.el.querySelectorAll('.exitem .x')] as HTMLElement[];
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    expect(buttons.map((b) => b.textContent)).toEqual(expect.arrayContaining(['✎', '×']));
    for (const b of buttons) {
      const s = getComputedStyle(b);
      expect(parseFloat(s.width)).toBeGreaterThanOrEqual(24);
      expect(parseFloat(s.height)).toBeGreaterThanOrEqual(24);
      expect(parseFloat(s.fontSize)).toBeGreaterThanOrEqual(16);
    }
  });

  it('AC2: the name note sits 8px under the field for the unchanged line and for an error', async () => {
    expect(css).toMatch(/\.name-note \{ margin-top: 8px/);
    const u = await mount({ css: true });
    await u.click(u.el.querySelector('.exitem .x')!);
    const note = u.el.querySelector('#name-err') as HTMLElement;
    expect(note.className).toContain('name-note');
    expect(note.textContent).toContain('이름이 바뀌지 않았습니다');
    expect(getComputedStyle(note).marginTop).toBe('8px');
    const input = u.el.querySelector('.namefield input') as HTMLInputElement;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(note.className).toContain('err-text');
    expect(note.textContent).not.toContain('이름이 바뀌지 않았습니다');
    expect(getComputedStyle(note).marginTop).toBe('8px');
  });
});

describe('TURN-007 panel resize', () => {
  it('AC3 AC4: pointer, arrows, and double-click move the four splitters and stop at the limits', async () => {
    const u = await mount({ css: true });
    const explorer = split(u.el, 'explorer');
    expect(explorer.getAttribute('role')).toBe('separator');
    expect(explorer.getAttribute('aria-orientation')).toBe('vertical');
    expect(explorer.getAttribute('aria-valuenow')).toBe('224');
    expect(explorer.getAttribute('aria-valuemin')).toBe('180');
    expect(explorer.getAttribute('aria-valuemax')).toBe('420');
    expect(parseFloat(getComputedStyle(explorer).width)).toBeGreaterThanOrEqual(6);
    expect(getComputedStyle(explorer).cursor).toBe('col-resize');
    expect(css).toMatch(/\.vsplit \{[^}]*width:\s*6px/);
    expect(css).toMatch(/cursor:\s*col-resize/);
    expect(css).toMatch(/\.vsplit:hover::after[^{]*\{[^}]*background:\s*var\(--accent\)/);

    await pointerDrag(explorer, 300, 340);
    expect(explorer.getAttribute('aria-valuenow')).toBe('264');
    expect(u.app().style.getPropertyValue('--exw')).toBe('264px');
    await act(async () => { explorer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
    expect(explorer.getAttribute('aria-valuenow')).toBe('280');
    await act(async () => { explorer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); });
    expect(explorer.getAttribute('aria-valuenow')).toBe('264');
    await act(async () => { explorer.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    expect(explorer.getAttribute('aria-valuenow')).toBe('224');

    await pointerDrag(explorer, 0, 1000);
    expect(explorer.getAttribute('aria-valuenow')).toBe('420');
    await pointerDrag(explorer, 1000, 0);
    expect(explorer.getAttribute('aria-valuenow')).toBe('180');
    setBox(u.app(), 680);
    await pointerDrag(explorer, 0, 50);
    expect(Number(explorer.getAttribute('aria-valuenow'))).toBe(680 - PANEL_MAIN_MIN);

    await u.click(u.btn('시작하기'));
    const library = split(u.el, 'library');
    expect(library.getAttribute('aria-valuenow')).toBe('256');
    await pointerDrag(library, 400, 360);
    expect(library.getAttribute('aria-valuenow')).toBe('296');
    expect(u.app().style.getPropertyValue('--libw')).toBe('296px');
    setBox(u.el.querySelector('.libws')!, 700);
    await pointerDrag(library, 0, 400);
    expect(Number(library.getAttribute('aria-valuenow'))).toBe(700 - PANEL_MAIN_MIN);
    await act(async () => { library.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    expect(Number(library.getAttribute('aria-valuenow'))).toBe(Math.min(256, 700 - PANEL_MAIN_MIN));

    await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]')!);
    const canvas = split(u.el, 'canvas');
    expect(canvas.getAttribute('aria-valuenow')).toBe('256');
    await pointerDrag(canvas, 200, 80);
    expect(canvas.getAttribute('aria-valuenow')).toBe('376');
    expect(u.app().style.getPropertyValue('--propw')).toBe('376px');
    await pointerDrag(canvas, 2000, 0);
    expect(canvas.getAttribute('aria-valuenow')).toBe('560');
    await act(async () => { canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
    expect(canvas.getAttribute('aria-valuenow')).toBe('544');

    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    const run = split(u.el, 'run');
    expect(u.el.querySelector('.ws-run')).not.toBeNull();
    expect(run.getAttribute('aria-valuenow')).toBe('380');
    await pointerDrag(run, 100, 140);
    expect(run.getAttribute('aria-valuenow')).toBe('340');
    expect(u.app().style.getPropertyValue('--runw')).toBe('340px');
    await pointerDrag(run, 0, -500);
    expect(run.getAttribute('aria-valuenow')).toBe('560');
    await pointerDrag(run, 0, 900);
    expect(run.getAttribute('aria-valuenow')).toBe('240');
  });

  it('AC5: widths survive a remount in UserView and stay out of the project JSON', async () => {
    const u = await mount();
    const before = serializeProject(u.history().present);
    await pointerDrag(split(u.el, 'explorer'), 10, 50);
    expect(split(u.el, 'explorer').getAttribute('aria-valuenow')).toBe('264');
    expect(serializeProject(u.history().present)).toBe(before);
    const saved = JSON.parse(localStorage.getItem('ecd.v1.userView')!);
    expect(saved.panels.explorer).toBe(264);
    await u.click(u.btn('저장'));
    const projectKey = Object.keys(localStorage).find((k) => k.startsWith('ecd.v1.project.'))!;
    expect(localStorage.getItem(projectKey)).not.toContain('"panels"');
    expect(localStorage.getItem(projectKey)).toBe(before);
    await act(async () => { root!.unmount(); });
    root = null;
    const again = await mount({ fresh: false });
    expect(again.app().style.getPropertyValue('--exw')).toBe('264px');
    expect(split(again.el, 'explorer').getAttribute('aria-valuenow')).toBe('264');
  });
});

describe('TURN-007 folds', () => {
  it('AC7: the Project tab keeps the equipment tree fully rendered', async () => {
    const block = css.slice(css.lastIndexOf('Project-tab tree'));
    expect(block).toMatch(/\.app > \.explorer \{ overflow-x: hidden; overflow-y: auto; \}/);
    expect(block).toMatch(/\.canvas-rail \{ flex: 0 0 auto; height: auto; min-height: auto; overflow: visible; \}/);
    expect(block).toMatch(/\.canvas-rail \.tree \{ flex: none; min-height: auto; overflow: visible; \}/);
    const u = await mount();
    await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]')!);
    expect(u.el.querySelector('.explorer .ex-extra')).toBeNull();
    const units = [...u.el.querySelectorAll('.canvas-rail [aria-level="2"]')].map((n) => (n.querySelector('.tnode')?.textContent ?? ''));
    for (const code of ['S1', 'S2', 'S3', 'S4', 'S5']) expect(units.some((t) => t.includes(code))).toBe(true);
    expect(u.el.querySelector('.canvas-rail')!.textContent).toContain('접기는 모델을 바꾸지 않습니다');
  });

  it('AC6 AC7: every details starts open, the user can close one, signal mode opens the diagram, explorer collapse still works', async () => {
    const u = await mount();
    expectAllOpen(u.el, 'home');
    const rev0 = u.history().present.revision;
    await u.click(u.btn('시작하기'));
    expectAllOpen(u.el, 'library');
    await u.click(u.el.querySelector('.card')!);
    expectAllOpen(u.el, 'card detail');
    expect(u.el.querySelector('.lib-more[open]')).not.toBeNull();
    expect(u.el.querySelector('.history[open]')).not.toBeNull();
    expect(u.history().present.revision).toBe(rev0);
    await u.click(u.btn('AML 입출력', u.el.querySelector('.subtabs')!));
    expectAllOpen(u.el, 'aml');
    expect(u.el.querySelector('.fold-open')!.textContent).toBe('검사 상세');
    await u.click(u.btn('자료 입력', u.el.querySelector('.subtabs')!));
    expectAllOpen(u.el, 'extract');

    await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]')!);
    expectAllOpen(u.el, 'canvas');
    expect(u.el.querySelector('.palette-fold[open] .fold-open')!.textContent).toBe(`팔레트 (${u.el.querySelectorAll('.palette .pi').length - 1}종 + 빈 유닛)`);
    expect(u.el.querySelector('.diagram-fold')).toBeNull();
    expect(u.el.querySelector('#layout-tab-board')!.getAttribute('aria-selected')).toBe('true');
    const palette = u.el.querySelector('.palette-fold') as HTMLDetailsElement;
    await act(async () => {
      palette.open = false;
      palette.dispatchEvent(new Event('toggle'));
    });
    expect(palette.open).toBe(false);
    await u.click(u.btn('다크'));
    expect(palette.open).toBe(false);
    expect(u.history().present.revision).toBe(rev0);

    await u.click(u.btn('신호 연결'));
    expect(u.el.querySelector('#layout-tab-diagram')!.getAttribute('aria-selected')).toBe('true');
    expect(u.el.querySelector('#layout-panel-board')!.hasAttribute('hidden')).toBe(true);
    await u.click(u.btn('레이어'));
    const layer = [...u.el.querySelectorAll('.layerpop input')].find((i) => (i.parentElement?.textContent ?? '').includes('배경')) as HTMLInputElement;
    await u.click(layer);
    expect(layer.checked).toBe(false);
    expect(u.history().present.revision).toBe(rev0);

    await u.click(u.el.querySelector('[aria-label="탐색기 접기"]')!);
    expect(u.app().className).toContain('ex-collapsed');
    expect(u.el.querySelector('.exsec')).toBeNull();
    await u.click(u.el.querySelector('[aria-label="탐색기 펼치기"]')!);
    expect(u.app().className).not.toContain('ex-collapsed');
    expect(u.el.querySelector('.exsec')).not.toBeNull();

    await u.click(u.el.querySelector('.stepper [data-stepid="attributes"]')!);
    expectAllOpen(u.el, 'attributes');
    await u.click(u.el.querySelector('.stepper [data-stepid="sequence"]')!);
    expectAllOpen(u.el, 'sequence');
    await u.click(u.btn('자재·Flow', u.el.querySelector('.subtabs')!));
    expectAllOpen(u.el, 'material');
    await u.click(u.btn('누락 편집 확장', u.el.querySelector('.subtabs')!));
    expectAllOpen(u.el, 'extend');
    await u.click(u.el.querySelector('.stepper [data-stepid="check"]')!);
    expectAllOpen(u.el, 'gap');
    for (const label of ['진단·저장', 'Export 미리보기', 'Evolution Lab']) {
      await u.click(u.btn(label, u.el.querySelector('.subtabs')!));
      expectAllOpen(u.el, label);
    }
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    expectAllOpen(u.el, 'run');
    expect(u.history().present.revision).toBe(rev0);
  });
});
