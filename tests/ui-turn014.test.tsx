// @vitest-environment jsdom
// TURN-014: diagram arrange menu. jsdom, not a browser.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import * as C from '../src/model/commands';
import type { History } from '../src/model/history';
import { App } from '../src/ui/App';

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
  return { x: m ? Number(m[1]) : NaN, y: m ? Number(m[2]) : NaN };
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
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label) as HTMLButtonElement;
  await click(btn('시작하기'));
  await click(el.querySelector('.stepper [data-stepid="canvas"]')!);
  await click(el.querySelector('#layout-tab-diagram')!);
  const unit = (id: string) => el.querySelector(`[data-id="${id}"] .rf-unit`) as HTMLElement;
  const select = async (ids: string[]) => {
    for (let i = 0; i < ids.length; i++) {
      const at = pos(el, ids[i]);
      await point(unit(ids[i]), 'pointerdown', at.x + 8, at.y + 8, i === 0 ? {} : { shiftKey: true });
      await point(unit(ids[i]), 'pointerup', at.x + 8, at.y + 8, i === 0 ? {} : { shiftKey: true });
    }
  };
  const openArrange = async () => {
    if (!el.querySelector('#arrange-menu')) await click(btn('배치 ▾'));
  };
  const arrange = async (label: string) => {
    await openArrange();
    await click(btn(label));
  };
  return { el, click, point, btn, select, openArrange, arrange, history: () => seen.h!, unit };
}

describe('TURN-014 unit arrange UI', () => {
  it('AC5 the menu disables commands until enough units are selected, and a device does not count', async () => {
    const u = await mount();
    expect(u.el.querySelector('.diagram-tools .arrange-menu')).not.toBeNull();
    await u.openArrange();
    const item = (label: string) => u.btn(label, u.el.querySelector('#arrange-menu')!);
    for (const label of ['가로 간격 같게', '세로 간격 같게']) {
      expect(item(label).disabled).toBe(true);
      expect(item(label).title).toBe(C.ARRANGE_NEED_3);
    }
    for (const label of ['너비 같게', '높이 같게', '겹침 풀기']) {
      expect(item(label).disabled).toBe(true);
      expect(item(label).title).toBe(C.ARRANGE_NEED_2);
    }

    await u.select(['U-S1']);
    await u.openArrange();
    expect(item('너비 같게').disabled).toBe(true);
    expect(item('가로 간격 같게').title).toBe(C.ARRANGE_NEED_3);

    const dev = u.el.querySelector('[data-id="PSH-01"] .rf-device')!;
    const at = pos(u.el, 'PSH-01');
    await u.point(dev, 'pointerdown', at.x + 4, at.y + 4);
    await u.point(dev, 'pointerup', at.x + 4, at.y + 4);
    await u.openArrange();
    expect(item('겹침 풀기').disabled).toBe(true);
    expect(item('겹침 풀기').title).toBe(C.ARRANGE_NEED_2);

    await u.select(['U-S1', 'U-S2']);
    const devAt = pos(u.el, 'CYL-03');
    await u.point(u.el.querySelector('[data-id="CYL-03"] .rf-device')!, 'pointerdown', devAt.x + 4, devAt.y + 4, { shiftKey: true });
    await u.point(u.el.querySelector('[data-id="CYL-03"] .rf-device')!, 'pointerup', devAt.x + 4, devAt.y + 4, { shiftKey: true });
    await u.openArrange();
    expect(item('가로 간격 같게').disabled).toBe(true);
    expect(item('가로 간격 같게').title).toBe(C.ARRANGE_NEED_3);
    expect(item('너비 같게').disabled).toBe(false);
    expect(item('높이 같게').disabled).toBe(false);
    expect(item('겹침 풀기').disabled).toBe(false);

    const before = u.history().present.devices.find((d) => d.id === 'CYL-03')!.layout;
    const rev = u.history().present.revision;
    await u.arrange('너비 같게');
    expect(u.el.querySelector('.toast')?.textContent).toBe(C.ARRANGE_UNCHANGED);
    expect(u.history().present.revision).toBe(rev);
    expect(u.history().past).toHaveLength(0);
    expect(u.history().present.devices.find((d) => d.id === 'CYL-03')!.layout).toEqual(before);
  });

  it('AC4 spread clears the overlap mark and leaves an unselected unit', async () => {
    const u = await mount();
    const from = pos(u.el, 'U-S2');
    const s2 = u.unit('U-S2');
    await u.point(s2, 'pointerdown', from.x + 12, from.y + 12);
    await u.point(s2, 'pointermove', from.x - 68, from.y + 12);
    await u.point(s2, 'pointerup', from.x - 68, from.y + 12);
    expect(u.el.querySelector('[data-id="U-S1"] .rf-unit')!.className).toContain('is-overlap');
    expect(u.el.querySelector('[data-id="U-S2"] .rf-unit')!.className).toContain('is-overlap');
    const parked = u.history().present.units.find((x) => x.id === 'U-S3')!.layout;
    const left = u.history().present.units.find((x) => x.id === 'U-S1')!.layout;
    const dragged = u.history().present.units.find((x) => x.id === 'U-S2')!.layout;
    const dev = u.history().present.devices.find((d) => d.unitId === 'U-S2')!.layout;
    await u.select(['U-S1', 'U-S2']);
    await u.arrange('겹침 풀기');
    const units = u.history().present.units;
    const s1 = units.find((x) => x.id === 'U-S1')!.layout;
    const s2b = units.find((x) => x.id === 'U-S2')!.layout;
    expect(s1).toEqual(left);
    expect(s2b.x).toBeGreaterThanOrEqual(s1.x + s1.w + C.UNIT_SPREAD_GAP);
    expect(s2b.y).toBe(dragged.y);
    expect(units.find((x) => x.id === 'U-S3')!.layout).toEqual(parked);
    const moved = u.history().present.devices.find((d) => d.unitId === 'U-S2')!;
    expect(moved.layout.x - dev.x).toBe(s2b.x - dragged.x);
    expect(moved.layout.y).toBe(dev.y);
    expect(u.el.querySelector('.is-overlap')).toBeNull();
    expect(u.history().past).toHaveLength(2);
    await u.click(u.el.querySelector('[aria-label="실행 취소"]')!);
    expect(u.history().present.units.find((x) => x.id === 'U-S2')!.layout.x).toBeLessThan(s2b.x);
  });

  it('AC6 an even row reports no change, and a running project blocks every arrange command', async () => {
    const u = await mount();
    await u.select(['U-S1', 'U-S2', 'U-S3']);
    const rev = u.history().present.revision;
    await u.arrange('가로 간격 같게');
    expect(u.el.querySelector('.toast')?.textContent).toBe(C.ARRANGE_UNCHANGED);
    expect(u.history().present.revision).toBe(rev);
    expect(u.history().past).toHaveLength(0);

    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
    try {
      await u.click(u.btn('▶ 실행'));
      await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]')!);
      await u.select(['U-S1', 'U-S2', 'U-S3']);
      for (const label of ['가로 간격 같게', '세로 간격 같게', '너비 같게', '높이 같게', '겹침 풀기']) {
        await u.arrange(label);
        expect(u.el.querySelector('.toast')?.textContent).toMatch(/차단/);
      }
      expect(u.history().past).toHaveLength(0);
      expect(u.history().present.revision).toBe(rev);
    } finally {
      globalThis.requestAnimationFrame = raf;
    }
  });
});
