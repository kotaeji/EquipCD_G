// @vitest-environment jsdom
// TURN-021 diagram edit. jsdom, not a browser. Pan motion is checked again in Chrome.
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

function selected(scope: ParentNode) {
  return [...scope.querySelectorAll('.is-sel')].map((n) => n.closest('.react-flow__node')?.getAttribute('data-id') ?? '').filter(Boolean).sort();
}

async function mount() {
  localStorage.clear();
  const el = document.createElement('div');
  document.body.appendChild(el);
  const seen: { h: History | null } = { h: null };
  root = createRoot(el);
  await act(async () => { root!.render(<App onHistory={(h) => { seen.h = h; }} />); });
  const click = async (node: Element | undefined) => {
    if (!node) throw new Error('missing button');
    await act(async () => { (node as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  };
  const point = async (node: Element, type: string, x: number, y: number, init: PointerEventInit = {}) => {
    await act(async () => {
      node.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, buttons: type === 'pointerup' ? 0 : 1, ...init }));
    });
  };
  const key = async (node: EventTarget, type: 'keydown' | 'keyup', init: KeyboardEventInit) => {
    await act(async () => { node.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init })); });
  };
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label) as HTMLButtonElement;
  await click(btn('시작하기'));
  await click(el.querySelector('.stepper [data-stepid="canvas"]')!);
  await click(el.querySelector('#layout-tab-diagram')!);
  const pane = () => el.querySelector('.react-flow__pane') as HTMLElement;
  const unit = (id: string) => el.querySelector(`[data-id="${id}"] .rf-unit`) as HTMLElement;
  const shift = async (down: boolean) => { await key(window, down ? 'keydown' : 'keyup', { key: 'Shift' }); };
  const band = async (x0: number, y0: number, x1: number, y1: number, withShift: boolean) => {
    if (withShift) await shift(true);
    await point(pane(), 'pointerdown', x0, y0, withShift ? { shiftKey: true } : {});
    await point(pane(), 'pointermove', x1, y1, withShift ? { shiftKey: true } : {});
    await point(pane(), 'pointerup', x1, y1, withShift ? { shiftKey: true } : {});
    if (withShift) await shift(false);
  };
  return { el, click, point, key, btn, pane, unit, shift, band, history: () => seen.h! };
}

describe('TURN-021 canvas edit UI', () => {
  it('AC1 AC2 shift-drag adds units and devices, a plain drag keeps the selection, and a running project can still select', async () => {
    const u = await mount();
    expect(u.pane().classList.contains('draggable')).toBe(true);
    await u.point(u.unit('U-S5'), 'pointerdown', 980, 90);
    await u.point(u.unit('U-S5'), 'pointerup', 980, 90);
    expect(selected(u.el)).toEqual(['U-S5']);
    const rev = u.history().present.revision;
    await u.band(10, 50, 250, 390, false);
    expect(u.el.querySelector('.rf-marquee')).toBeNull();
    expect(selected(u.el)).toEqual(['U-S5']);
    expect(u.history().present.revision).toBe(rev);
    expect(u.pane().classList.contains('draggable')).toBe(true);

    await u.shift(true);
    expect(u.pane().classList.contains('draggable')).toBe(false);
    await u.point(u.pane(), 'pointerdown', 10, 50, { shiftKey: true });
    await u.point(u.pane(), 'pointermove', 250, 390, { shiftKey: true });
    const box = u.el.querySelector('.rf-marquee') as HTMLElement | null;
    expect(box).not.toBeNull();
    expect(Number.parseFloat(box!.style.width)).toBeGreaterThan(20);
    expect(u.history().present.revision).toBe(rev);
    await u.point(u.pane(), 'pointerup', 250, 390, { shiftKey: true });
    await u.shift(false);
    expect(u.el.querySelector('.rf-marquee')).toBeNull();
    expect(selected(u.el)).toEqual(['CYL-01', 'PSH-01', 'U-S1', 'U-S5']);
    expect(u.history().present.revision).toBe(rev);
    expect(u.history().past).toHaveLength(0);
    expect(u.pane().classList.contains('draggable')).toBe(true);

    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
    try {
      await u.click(u.btn('▶ 실행'));
      await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]')!);
      await u.click(u.el.querySelector('#layout-tab-diagram')!);
      await u.band(260, 50, 500, 390, true);
      expect(selected(u.el)).toEqual(['BCR-02', 'CYL-01', 'PSH-01', 'STP-02', 'U-S1', 'U-S2', 'U-S5']);
      expect(u.history().present.revision).toBe(rev);
      expect(u.history().past).toHaveLength(0);
    } finally {
      globalThis.requestAnimationFrame = raf;
    }
  });

  it('AC4 several nodes open one combined confirm, cancel changes nothing, and one node keeps the old confirm', async () => {
    const u = await mount();
    await u.point(u.unit('U-S1'), 'pointerdown', 40, 80);
    await u.point(u.unit('U-S1'), 'pointerup', 40, 80);
    await u.point(u.unit('U-S2'), 'pointerdown', 280, 80, { shiftKey: true });
    await u.point(u.unit('U-S2'), 'pointerup', 280, 80, { shiftKey: true });
    const rev = u.history().present.revision;
    const imp = C.impactOfNodes(u.history().present, ['U-S1', 'U-S2']);
    await u.click(u.btn('삭제', u.el.querySelector('.diagram-tools')!));
    const modal = () => u.el.querySelector('.modal');
    expect(modal()?.textContent).toContain(`삭제될 Unit ${imp.units}개, Device ${imp.devices}개.`);
    expect(modal()?.textContent).toContain(`Action ${imp.actions}개, 시퀀스 단계 ${imp.steps}개, 연결 ${imp.connections}개, Substation 시퀀스 ${imp.subSequences}개.`);
    await u.click(u.btn('취소', modal()!));
    expect(u.el.querySelector('.modal')).toBeNull();
    expect(u.history().present.revision).toBe(rev);
    expect(u.history().past).toHaveLength(0);
    expect(u.history().present.units.map((unit) => unit.id)).toContain('U-S1');

    await u.key(window, 'keydown', { key: 'Delete' });
    expect(modal()?.textContent).toContain('삭제될 Unit 2개');
    await u.click(u.btn('참조 해제 후 삭제', modal()!));
    expect(u.history().present.revision).toBe(rev + 1);
    expect(u.history().past).toHaveLength(1);
    expect(u.history().present.units.map((unit) => unit.id)).not.toContain('U-S1');
    expect(u.history().present.units.map((unit) => unit.id)).not.toContain('U-S2');
    await u.click(u.el.querySelector('[aria-label="실행 취소"]')!);
    expect(u.history().present.units.map((unit) => unit.id)).toContain('U-S1');
    expect(u.history().present.revision).toBe(rev);

    await u.point(u.el.querySelector('[data-id="CYL-01"] .rf-device')!, 'pointerdown', 180, 140);
    await u.point(u.el.querySelector('[data-id="CYL-01"] .rf-device')!, 'pointerup', 180, 140);
    await u.click(u.btn('삭제', u.el.querySelector('.diagram-tools')!));
    expect(modal()?.getAttribute('aria-label')).toContain('CYL-01 삭제 — 참조 영향 확인');
    expect(modal()?.textContent).not.toContain('삭제될 Unit');
    expect(modal()?.textContent).toContain('시퀀스 단계');
    await u.click(u.btn('취소', modal()!));
    expect(u.history().present.devices.some((d) => d.id === 'CYL-01')).toBe(true);
  });

  it('AC7 duplicate button and Ctrl+D copy the selected devices, and stay idle without a device, while running, focused, or in a dialog', async () => {
    const u = await mount();
    const tools = () => u.el.querySelector('.diagram-tools')!;
    const dup = () => u.btn('복제', tools());
    expect(dup().disabled).toBe(true);
    expect(dup().title).toBe(C.DUPLICATE_NEED_DEVICE);
    await u.point(u.unit('U-S1'), 'pointerdown', 40, 80);
    await u.point(u.unit('U-S1'), 'pointerup', 40, 80);
    expect(dup().disabled).toBe(true);
    const rev0 = u.history().present.revision;
    await u.key(window, 'keydown', { key: 'd', ctrlKey: true });
    expect(u.el.querySelector('.toast')?.textContent).toBe(C.DUPLICATE_NEED_DEVICE);
    expect(u.history().present.revision).toBe(rev0);

    await u.point(u.el.querySelector('[data-id="CYL-01"] .rf-device')!, 'pointerdown', 180, 140);
    await u.point(u.el.querySelector('[data-id="CYL-01"] .rf-device')!, 'pointerup', 180, 140);
    expect(dup().disabled).toBe(false);
    await u.click(dup());
    expect(u.history().present.revision).toBe(rev0 + 1);
    expect(u.history().past).toHaveLength(1);
    const copy = u.history().present.devices.find((d) => d.lineage?.duplicatedFrom === 'CYL-01')!;
    expect(copy.name).toBe('CYL-01 사본');
    expect(selected(u.el)).toEqual([copy.id]);
    expect(u.el.querySelector(`[data-id="${copy.id}"] .is-sel`)).not.toBeNull();
    await u.key(window, 'keydown', { key: 'd', metaKey: true });
    expect(u.history().present.revision).toBe(rev0 + 2);
    expect(u.history().present.devices.filter((d) => d.name.startsWith('CYL-01 사본'))).toHaveLength(2);
    expect(u.history().past).toHaveLength(2);

    const rev = u.history().present.revision;
    await u.click(u.btn('레이어'));
    const box = u.el.querySelector('.layerpop input') as HTMLInputElement;
    box.focus();
    await u.key(box, 'keydown', { key: 'd', ctrlKey: true });
    expect(u.history().present.revision).toBe(rev);

    await u.click(u.btn('삭제', tools()));
    expect(u.el.querySelector('.modal')).not.toBeNull();
    await u.key(window, 'keydown', { key: 'd', ctrlKey: true });
    expect(u.el.querySelector('.modal')).not.toBeNull();
    expect(u.history().present.revision).toBe(rev);
    await u.click(u.btn('취소', u.el.querySelector('.modal')!));

    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
    try {
      await u.click(u.btn('▶ 실행'));
      await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]')!);
      await u.click(u.el.querySelector('#layout-tab-diagram')!);
      expect(u.btn('복제', tools()).disabled).toBe(true);
      expect(u.btn('삭제', tools()).disabled).toBe(true);
      await u.key(window, 'keydown', { key: 'd', ctrlKey: true });
      expect(u.el.querySelector('.toast')?.textContent).toMatch(/차단/);
      await u.key(window, 'keydown', { key: 'Delete' });
      expect(u.el.querySelector('.toast')?.textContent).toMatch(/차단/);
      expect(u.history().present.revision).toBe(rev);
    } finally {
      globalThis.requestAnimationFrame = raf;
    }
  });
});
