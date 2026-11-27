// @vitest-environment jsdom
// TURN-089. jsdom has no layout, so the 3D cell height arrives through ResizeObserver.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/ui/App';
import { VIEWPOINT_KEY_HINT } from '../src/scene/viewQuality';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let restoreObserver: (() => void) | null = null;

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  restoreObserver?.();
  restoreObserver = null;
  document.body.innerHTML = '';
  document.head.querySelectorAll('style').forEach((node) => node.remove());
  localStorage.clear();
});

function installCell(height: number) {
  const previous = globalThis.ResizeObserver;
  const box = (h: number) => ({
    x: 0, y: 0, top: 0, left: 0, right: 400, bottom: h, width: 400, height: h, toJSON() { return {}; },
  });
  class RO {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) { this.cb = cb; }
    observe(target: Element) {
      const h = target.classList.contains('run-stage') ? height : 0;
      this.cb([{
        target,
        contentRect: box(h) as DOMRectReadOnly,
        borderBoxSize: [],
        contentBoxSize: [],
        devicePixelContentBoxSize: [],
      } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = RO as unknown as typeof ResizeObserver;
  restoreObserver = () => { globalThis.ResizeObserver = previous; };
}

async function mount() {
  const css = [
    'src/ui/styles.css', 'src/ui/run3d.css', 'src/ui/scene3d-quality.css',
    'src/ui/overflow-row.css', 'src/ui/layout-tier.css',
  ].map((file) => readFileSync(file, 'utf8')).join('\n');
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(<App />); });
  const click = async (node: Element) => {
    await act(async () => { (node as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  };
  const btn = (label: string) => [...el.querySelectorAll('button')].find((item) => (item.textContent ?? '').replace(/\s+/g, ' ').trim() === label || item.getAttribute('aria-label') === label) as HTMLButtonElement;
  return { el, click, btn };
}

async function openRun() {
  const ui = await mount();
  await ui.click(ui.btn('시작하기'));
  await ui.click(ui.el.querySelector('.stepper [data-stepid="run"] .st-go')!);
  return ui;
}

describe('TURN-089 screen', () => {
  it('AC3 a cell under 320px marks the compass compact, and a taller cell does not', async () => {
    installCell(270);
    const low = await openRun();
    await low.click(low.btn('3D'));
    expect(low.el.querySelector('.run-stage')!.getAttribute('data-compass-size')).toBe('compact');
    expect(low.el.querySelector('.scene3d-compass')).not.toBeNull();
    await act(async () => { root!.unmount(); });
    root = null;
    restoreObserver?.();
    document.body.innerHTML = '';
    localStorage.clear();
    installCell(400);
    const high = await openRun();
    await high.click(high.btn('3D'));
    expect(high.el.querySelector('.run-stage')!.getAttribute('data-compass-size')).toBe('full');
  });

  it('AC4 the run tools are separate items and the speed sits a gap away from the clock', async () => {
    const ui = await openRun();
    const bar = ui.el.querySelector('.ws-run > .toolbar') as HTMLElement;
    expect(bar.className).toContain('overflow-row');
    expect(bar.className).toContain('tool-pills');
    const clock = bar.querySelector('.run-clock') as HTMLElement;
    expect(clock.querySelector('select[aria-label="배속"]')).not.toBeNull();
    expect(clock.querySelector('.mono')!.textContent).toContain('00:00');
    const run = bar.querySelector('button[data-overflow-item]') as HTMLButtonElement;
    expect((run.textContent ?? '').replace(/\s+/g, '')).toContain('실행');
    expect(run.parentElement).toBe(bar);
    const css = readFileSync('src/ui/overflow-row.css', 'utf8');
    expect(css).toMatch(/\.overflow-row\.tool-pills\s*\{\s*flex-wrap:\s*nowrap;/);
    expect(css).toMatch(/\.run-clock\s*\{[^}]*gap:\s*var\(--sp-2\)/);
  });

  it('AC6 viewpoint titles and the shortcut sheet name the focus condition', async () => {
    const ui = await openRun();
    await ui.click(ui.btn('3D'));
    const titles = [...ui.el.querySelectorAll('.scene3d-views button')].map((button) => button.getAttribute('title'));
    expect(titles).toEqual([VIEWPOINT_KEY_HINT, VIEWPOINT_KEY_HINT, VIEWPOINT_KEY_HINT, VIEWPOINT_KEY_HINT]);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true }));
    });
    const sheet = document.querySelector('[aria-label="단축키 목록"]');
    expect(sheet).not.toBeNull();
    const row = sheet!.querySelector('[data-shortcut="extra-cam-view"]');
    expect(row!.textContent).toContain('장면을 누른 뒤 1~4 키');
    expect(row!.textContent).toContain('1 2 3 4');
  });
});
