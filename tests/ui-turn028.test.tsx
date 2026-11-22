// @vitest-environment jsdom
// TURN-028: 「자동 정렬」 sits beside 「크기 맞춤」. jsdom, not a browser.
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
  const tools = () => el.querySelector('.diagram-tools')!;
  const auto = () => btn('자동 정렬', tools());
  const unit = (id: string) => el.querySelector(`[data-id="${id}"] .rf-unit`) as HTMLElement;
  const selectUnit = async (ids: string[]) => {
    for (let i = 0; i < ids.length; i++) {
      const at = pos(el, ids[i]);
      await point(unit(ids[i]), 'pointerdown', at.x + 8, at.y + 8, i === 0 ? {} : { shiftKey: true });
      await point(unit(ids[i]), 'pointerup', at.x + 8, at.y + 8, i === 0 ? {} : { shiftKey: true });
    }
  };
  const selectDevice = async (id: string, shift: boolean) => {
    const node = el.querySelector(`[data-id="${id}"] .rf-device`)!;
    const at = pos(el, id);
    await point(node, 'pointerdown', at.x + 4, at.y + 4, shift ? { shiftKey: true } : {});
    await point(node, 'pointerup', at.x + 4, at.y + 4, shift ? { shiftKey: true } : {});
  };
  return { el, click, btn, tools, auto, selectUnit, selectDevice, history: () => seen.h! };
}

describe('TURN-028 auto arrange button', () => {
  it('AC1 the button is next to fit-to-content and enables for one unit or one unit of devices', async () => {
    const u = await mount();
    const labels = [...u.tools().querySelectorAll('button')].map((b) => (b.textContent ?? '').trim());
    const fitAt = labels.indexOf('크기 맞춤');
    expect(fitAt).toBeGreaterThanOrEqual(0);
    expect(labels[fitAt + 1]).toBe('자동 정렬');

    expect(u.auto().disabled).toBe(true);
    expect(u.auto().title).toBe(C.ARRANGE_DEVICES_NEED_ONE);

    await u.selectUnit(['U-S2']);
    expect(u.auto().disabled).toBe(false);
    expect(u.auto().title).toBe(C.ARRANGE_DEVICES_HINT);

    await u.selectUnit(['U-S1', 'U-S2']);
    expect(u.auto().disabled).toBe(true);
    expect(u.auto().title).toBe(C.ARRANGE_DEVICES_NEED_ONE);

    await u.selectDevice('PSH-01', false);
    await u.selectDevice('CYL-01', true);
    expect(u.auto().disabled).toBe(false);

    await u.selectDevice('STP-02', true);
    expect(u.auto().disabled).toBe(true);
    expect(u.auto().title).toBe(C.ARRANGE_DEVICES_NEED_ONE);

    await u.selectUnit(['U-S2']);
    const rev = u.history().present.revision;
    const before = u.history().present.devices.find((d) => d.id === 'STP-02')!.layout;
    await u.click(u.auto());
    expect(u.history().present.revision).toBe(rev + 1);
    expect(u.history().past).toHaveLength(1);
    const stp = u.history().present.devices.find((d) => d.id === 'STP-02')!.layout;
    const bcr = u.history().present.devices.find((d) => d.id === 'BCR-02')!.layout;
    expect(stp.x).toBeLessThan(bcr.x);
    expect(stp).not.toEqual(before);
    await u.click(u.auto());
    expect(u.el.querySelector('.toast')?.textContent).toBe(C.ARRANGE_UNCHANGED);
    expect(u.history().present.revision).toBe(rev + 1);
  });

  it('AC1 running and paused both disable the button', async () => {
    const u = await mount();
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
    try {
      await u.click(u.btn('▶ 실행'));
      await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]')!);
      await u.selectUnit(['U-S1']);
      expect(u.auto().disabled).toBe(true);
      expect(u.auto().title).toBe(C.ARRANGE_DEVICES_LOCKED);
      const rev = u.history().present.revision;
      await u.click(u.auto());
      expect(u.history().present.revision).toBe(rev);

      await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
      await u.click(u.btn('❚❚ 일시정지'));
      await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]')!);
      await u.selectUnit(['U-S1']);
      expect(u.auto().disabled).toBe(true);
      expect(u.auto().title).toBe(C.ARRANGE_DEVICES_LOCKED);
    } finally {
      globalThis.requestAnimationFrame = raf;
    }
  });
});
