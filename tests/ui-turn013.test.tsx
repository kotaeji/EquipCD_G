// @vitest-environment jsdom
// TURN-013: unit handle is present in select mode, fit and grow share the model. jsdom, not a browser.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { History } from '../src/model/history';
import type { Layout } from '../src/model/types';
import { App } from '../src/ui/App';
import { UNIT_HEADER, UNIT_PAD } from '../src/model/unitLayout';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  localStorage.clear();
});

function pos(scope: ParentNode, id: string) {
  const n = scope.querySelector(`.react-flow__node[data-id="${id}"]`) as HTMLElement | null;
  const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(n?.style.transform ?? '');
  return { x: m ? Number(m[1]) : NaN, y: m ? Number(m[2]) : NaN, w: n ? Number.parseFloat(n.style.width) : NaN, h: n ? Number.parseFloat(n.style.height) : NaN };
}

async function mount() {
  localStorage.clear();
  const el = document.createElement('div');
  document.body.appendChild(el);
  const seen: { h: History | null } = { h: null };
  root = createRoot(el);
  await act(async () => { root!.render(<App onHistory={(h) => { seen.h = h; }} />); });
  const click = async (node: Element) => { await act(async () => { (node as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
  const point = async (node: Element, type: string, x: number, y: number, init: PointerEventInit = {}) => {
    await act(async () => { node.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, ...init })); });
  };
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label || b.getAttribute('aria-label') === label) as HTMLButtonElement;
  await click(btn('시작하기'));
  await click(el.querySelector('.stepper [data-stepid="canvas"]')!);
  await click(el.querySelector('#layout-tab-diagram')!);
  return { el, click, point, btn, history: () => seen.h! };
}

const overlaps = (a: Layout, b: Layout) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

describe('TURN-013 unit resize UI', () => {
  it('AC3 the selected unit shows one bottom-right handle, and fit shrinks a grown unit in one undo', async () => {
    const u = await mount();
    expect(u.el.querySelector('.rf-unit-resize')).toBeNull();
    const unit = u.el.querySelector('[data-id="U-S1"] .rf-unit')!;
    const at = pos(u.el, 'U-S1');
    await u.point(unit, 'pointerdown', at.x + 8, at.y + 8);
    await u.point(unit, 'pointerup', at.x + 8, at.y + 8);
    const handles = u.el.querySelectorAll('.rf-unit-resize');
    expect(handles).toHaveLength(1);
    expect(handles[0].className).toContain('bottom');
    expect(handles[0].className).toContain('right');
    expect(u.el.querySelector('[data-id="U-S1"] .rf-unit-resize')).not.toBeNull();
    expect(u.el.querySelector('[data-id="U-S2"] .rf-unit-resize')).toBeNull();
    await u.click(u.btn('물류 연결'));
    expect(u.el.querySelector('.rf-unit-resize')).toBeNull();
    await u.click(u.btn('선택/이동'));

    const dev = u.el.querySelector('[data-id="CYL-01"] .rf-device')!;
    const from = pos(u.el, 'CYL-01');
    const before = u.history().present.units.find((x) => x.id === 'U-S1')!.layout;
    // Stay inside S1's x range so the drop is a move, not a reparent prompt. Downward still leaves the pad.
    await u.point(dev, 'pointerdown', from.x + 4, from.y + 4);
    await u.point(dev, 'pointermove', from.x + 4, from.y + 200);
    await u.point(dev, 'pointerup', from.x + 4, from.y + 200);
    const grown = u.history().present.units.find((x) => x.id === 'U-S1')!.layout;
    expect(grown.h).toBeGreaterThan(before.h);
    expect(u.history().past).toHaveLength(1);
    expect(u.history().present.revision).toBe(u.history().past[0].revision + 1);

    const fit = [...u.el.querySelectorAll('.diagram-tools button, .prop-sheet button')].find((b) => (b.textContent ?? '').trim() === '크기 맞춤') as HTMLButtonElement;
    expect(fit.disabled).toBe(true);
    await u.point(unit, 'pointerdown', at.x + 8, at.y + 8);
    await u.point(unit, 'pointerup', at.x + 8, at.y + 8);
    expect(fit.disabled).toBe(false);
    await u.click(fit);
    const fitted = u.history().present.units.find((x) => x.id === 'U-S1')!.layout;
    const devBox = u.history().present.devices.find((d) => d.id === 'CYL-01')!.layout;
    expect(fitted.h).toBeLessThan(grown.h);
    expect(devBox.x).toBeGreaterThanOrEqual(fitted.x + UNIT_PAD);
    expect(devBox.y).toBeGreaterThanOrEqual(fitted.y + UNIT_HEADER + UNIT_PAD);
    expect(devBox.x + devBox.w).toBeLessThanOrEqual(fitted.x + fitted.w - UNIT_PAD);
    expect(u.history().past).toHaveLength(2);
    await u.click(u.el.querySelector('[aria-label="실행 취소"]')!);
    expect(u.history().present.units.find((x) => x.id === 'U-S1')!.layout).toEqual(grown);
  });

  it('AC5 dropping three devices on one card does not stack them', async () => {
    const u = await mount();
    await u.click(u.el.querySelector('#layout-tab-board')!);
    const card = [...u.el.querySelectorAll('.station-card')].find((c) => (c.querySelector('h3')?.textContent ?? '').startsWith('S1'))!;
    const palette = [...u.el.querySelectorAll('.pi')].find((n) => (n.textContent ?? '').trim() === '실린더')!;
    const before = u.history().present.devices.length;
    for (let i = 0; i < 3; i++) {
      const dt = { store: {} as Record<string, string>, setData(t: string, v: string) { this.store[t] = v; }, getData(t: string) { return this.store[t] ?? ''; }, effectAllowed: 'copy' };
      const fire = async (node: Element, type: string) => {
        const ev = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(ev, 'dataTransfer', { value: dt });
        await act(async () => { node.dispatchEvent(ev); });
      };
      await fire(palette, 'dragstart');
      await fire(card, 'drop');
    }
    const added = u.history().present.devices.slice(before);
    expect(added).toHaveLength(3);
    expect(new Set(added.map((d) => d.unitId))).toEqual(new Set(['U-S1']));
    const boxes = u.history().present.devices.filter((d) => d.unitId === 'U-S1').map((d) => d.layout);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i], boxes[j])).toBe(false);
  });

  it('AC6 a running project hides the handle and the fit button reports the lock', async () => {
    const u = await mount();
    const unit = u.el.querySelector('[data-id="U-S1"] .rf-unit')!;
    const at = pos(u.el, 'U-S1');
    await u.point(unit, 'pointerdown', at.x + 8, at.y + 8);
    await u.point(unit, 'pointerup', at.x + 8, at.y + 8);
    expect(u.el.querySelector('.rf-unit-resize')).not.toBeNull();
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
    try {
      await u.click(u.btn('▶ 실행'));
      expect(u.el.querySelector('.rf-unit-resize')).toBeNull();
      await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]')!);
      expect(u.el.querySelector('.rf-unit-resize')).toBeNull();
      const fit = [...u.el.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '크기 맞춤' && !b.disabled)!;
      await u.click(fit);
      expect(u.el.querySelector('.toast')?.textContent).toMatch(/차단/);
      expect(u.history().past).toHaveLength(0);
    } finally {
      globalThis.requestAnimationFrame = raf;
    }
  });
});
