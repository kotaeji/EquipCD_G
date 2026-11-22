// @vitest-environment jsdom
// TURN-027. Ctrl/Cmd+A and Ctrl/Cmd+click. jsdom, not a browser.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, afterEach } from 'vitest';
import { buildSampleProject } from '../src/model/sample';
import type { History } from '../src/model/history';
import { App } from '../src/ui/App';
import { cardSelection, NO_DEVICE_IN_UNIT, pointerSelection, selectAll, SELECT_HINT } from '../src/ui/selectAll';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  localStorage.clear();
});

const UNITS = ['U-S1', 'U-S2', 'U-S3', 'U-S4', 'U-S5'];

describe('TURN-027 selectAll', () => {
  const p = buildSampleProject();

  it('empty, one unit, one unit of devices, several units, and an empty unit', () => {
    expect(selectAll(p, [])).toEqual({ ids: UNITS });
    expect(selectAll(p, ['not-a-node'])).toEqual({ ids: UNITS });
    expect(selectAll(p, ['U-S1'])).toEqual({ ids: ['PSH-01', 'CYL-01'] });
    expect(selectAll(p, ['U-S1', 'CYL-01'])).toEqual({ ids: ['PSH-01', 'CYL-01'] });
    expect(selectAll(p, ['CYL-01'])).toEqual({ ids: ['PSH-01', 'CYL-01'] });
    expect(selectAll(p, ['PSH-01', 'CYL-01'])).toEqual({ ids: ['PSH-01', 'CYL-01'] });
    expect(selectAll(p, ['U-S1', 'U-S2'])).toEqual({ ids: UNITS });
    expect(selectAll(p, ['CYL-01', 'BCR-02'])).toEqual({ ids: UNITS });
    expect(selectAll(p, ['U-S1', 'BCR-02'])).toEqual({ ids: UNITS });
    const bare = { ...p, units: p.units.map((u) => (u.id === 'U-S5' ? { ...u, deviceIds: [] } : u)) };
    expect(selectAll(bare, ['U-S5'])).toEqual({ keep: true, message: NO_DEVICE_IN_UNIT });
    expect(selectAll(bare, ['U-S5', 'U-S1'])).toEqual({ ids: [...UNITS] });
  });

  it('Ctrl toggles and does not drag a removal, Shift still only adds', () => {
    expect(pointerSelection(['U-S1'], 'U-S2', { shiftKey: false, ctrlKey: true, metaKey: false })).toEqual({ ids: ['U-S1', 'U-S2'], drag: true });
    expect(pointerSelection(['U-S1', 'U-S2'], 'U-S1', { shiftKey: false, ctrlKey: false, metaKey: true })).toEqual({ ids: ['U-S2'], drag: false });
    expect(pointerSelection(['U-S1', 'U-S2'], 'U-S2', { shiftKey: true, ctrlKey: true, metaKey: false })).toEqual({ ids: ['U-S1', 'U-S2'], drag: true });
    expect(pointerSelection(['U-S1'], 'U-S2', { shiftKey: true, ctrlKey: false, metaKey: false })).toEqual({ ids: ['U-S1', 'U-S2'], drag: true });
    expect(pointerSelection(['CYL-01'], 'CYL-01', { shiftKey: false, ctrlKey: false, metaKey: false })).toEqual({ ids: ['CYL-01'], drag: true });
    expect(cardSelection(['U-S1'], 'U-S1', { shiftKey: false, ctrlKey: true, metaKey: false })).toEqual([]);
    expect(cardSelection(['U-S1'], 'U-S2', { shiftKey: true, ctrlKey: false, metaKey: false })).toEqual(['U-S2']);
  });
});

function selected(scope: ParentNode) {
  return [...scope.querySelectorAll('.diagram-canvas .is-sel')].map((n) => n.closest('.react-flow__node')?.getAttribute('data-id') ?? '').filter(Boolean).sort();
}

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
  const mouse = async (node: Element, init: MouseEventInit = {}) => {
    await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init })); });
  };
  const point = async (node: Element, type: string, x: number, y: number, init: PointerEventInit = {}) => {
    await act(async () => {
      node.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, buttons: type === 'pointerup' ? 0 : 1, ...init }));
    });
  };
  const key = async (node: EventTarget, init: KeyboardEventInit) => {
    let ev!: KeyboardEvent;
    await act(async () => {
      ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      node.dispatchEvent(ev);
    });
    return ev;
  };
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label) as HTMLButtonElement;
  await click(btn('시작하기'));
  await click(el.querySelector('.stepper [data-stepid="canvas"]')!);
  await click(el.querySelector('#layout-tab-diagram')!);
  const unit = (id: string) => el.querySelector(`[data-id="${id}"] .rf-unit`) as HTMLElement;
  const device = (id: string) => el.querySelector(`[data-id="${id}"] .rf-device`) as HTMLElement;
  const clear = async () => { await click(el.querySelector('.react-flow__pane')!); };
  const tap = async (node: Element, id: string, init: PointerEventInit = {}) => {
    const at = pos(el, id);
    await point(node, 'pointerdown', at.x + 8, at.y + 8, init);
    await point(node, 'pointerup', at.x + 8, at.y + 8, init);
  };
  return { el, click, mouse, point, key, btn, unit, device, tap, clear, history: () => seen.h! };
}

describe('TURN-027 canvas selection', () => {
  it('AC1 AC6 Ctrl+A and Cmd+A select every unit, and an input, a dialog, or another step does not', async () => {
    const u = await mount();
    expect(u.el.querySelector('.diagram-hint')?.textContent).toContain(SELECT_HINT);
    expect(u.el.querySelector('.rf-legend')?.getAttribute('title')).toContain(SELECT_HINT);
    const rev = u.history().present.revision;
    const ctrl = await u.key(window, { key: 'a', ctrlKey: true });
    expect(ctrl.defaultPrevented).toBe(true);
    expect(selected(u.el)).toEqual([...UNITS].sort());
    expect(u.history().present.revision).toBe(rev);
    expect(u.history().past).toHaveLength(0);

    await u.clear();
    expect(selected(u.el)).toEqual([]);
    await u.tap(u.unit('U-S1'), 'U-S1');
    expect(selected(u.el)).toEqual(['U-S1']);
    const meta = await u.key(window, { key: 'A', metaKey: true });
    expect(meta.defaultPrevented).toBe(true);
    expect(selected(u.el)).toEqual(['CYL-01', 'PSH-01']);

    await u.tap(u.unit('U-S1'), 'U-S1');
    const name = [...u.el.querySelectorAll('.prop-col input')].find((n) => (n as HTMLInputElement).value === 'S1 투입') as HTMLInputElement;
    expect(name).toBeTruthy();
    name.focus();
    const typed = await u.key(name, { key: 'a', ctrlKey: true });
    expect(typed.defaultPrevented).toBe(false);
    expect(selected(u.el)).toEqual(['U-S1']);

    name.blur();
    await u.click(u.btn('보기 설정'));
    expect(u.el.querySelector('.modal-bg')).not.toBeNull();
    const dlg = await u.key(window, { key: 'a', ctrlKey: true });
    expect(dlg.defaultPrevented).toBe(false);
    expect(selected(u.el)).toEqual(['U-S1']);
    expect(u.el.querySelector('.modal-bg')).not.toBeNull();
    await u.click(u.btn('닫기', u.el.querySelector('.modal')!));

    await u.click(u.el.querySelector('.stepper [data-stepid="attributes"]')!);
    const elsewhere = await u.key(window, { key: 'a', ctrlKey: true });
    expect(elsewhere.defaultPrevented).toBe(false);
    expect(u.history().present.revision).toBe(rev);
  });

  it('AC2 AC3 one unit selects its devices, a spread selection selects every unit, and an empty unit stays', async () => {
    const u = await mount();
    await u.tap(u.unit('U-S2'), 'U-S2');
    await u.key(window, { key: 'a', ctrlKey: true });
    expect(selected(u.el)).toEqual(['BCR-02', 'STP-02']);

    await u.tap(u.device('CYL-03'), 'CYL-03');
    await u.key(window, { key: 'a', ctrlKey: true });
    expect(selected(u.el)).toEqual(['CYL-03', 'STP-03']);

    await u.tap(u.unit('U-S1'), 'U-S1');
    await u.tap(u.unit('U-S4'), 'U-S4', { shiftKey: true });
    await u.key(window, { key: 'a', ctrlKey: true });
    expect(selected(u.el)).toEqual([...UNITS].sort());

    await u.tap(u.device('CYL-01'), 'CYL-01');
    await u.tap(u.device('GNT-04'), 'GNT-04', { shiftKey: true });
    await u.key(window, { key: 'a', ctrlKey: true });
    expect(selected(u.el)).toEqual([...UNITS].sort());

    await u.click(u.el.querySelector('#layout-tab-board')!);
    const before = new Set(u.history().present.units.map((unit) => unit.id));
    const rev = u.history().present.revision;
    const palette = [...u.el.querySelectorAll('.pi')].find((n) => (n.textContent ?? '').includes('빈 유닛'))!;
    const row = u.el.querySelector('.board-row')!;
    const dt = { store: {} as Record<string, string>, setData(t: string, v: string) { this.store[t] = v; }, getData(t: string) { return this.store[t] ?? ''; } };
    const fire = async (node: Element, type: string) => {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'dataTransfer', { value: dt });
      await act(async () => { node.dispatchEvent(ev); });
    };
    await fire(palette, 'dragstart');
    await fire(row, 'drop');
    const added = u.history().present.units.find((unit) => !before.has(unit.id))!;
    expect(added.deviceIds).toEqual([]);
    expect(u.history().present.revision).toBe(rev + 1);
    await u.click(u.el.querySelector('#layout-tab-diagram')!);
    expect(selected(u.el)).toEqual([added.id]);
    await u.key(window, { key: 'a', ctrlKey: true });
    expect(selected(u.el)).toEqual([added.id]);
    expect(u.el.querySelector('.toast.err')?.textContent).toBe(NO_DEVICE_IN_UNIT);
    expect(u.history().present.revision).toBe(rev + 1);
    expect(u.history().past).toHaveLength(1);
  });

  it('AC4 Ctrl and Cmd click toggle units and devices, a removal does not drag, and an addition still drags together', async () => {
    const u = await mount();
    const layout = (id: string) => {
      const unit = u.history().present.units.find((x) => x.id === id);
      return { ...(unit ? unit.layout : u.history().present.devices.find((d) => d.id === id)!.layout) };
    };
    await u.tap(u.unit('U-S1'), 'U-S1');
    await u.tap(u.unit('U-S2'), 'U-S2', { ctrlKey: true });
    expect(selected(u.el)).toEqual(['U-S1', 'U-S2']);
    const rev = u.history().present.revision;
    const held = layout('U-S1');
    const dropped = layout('U-S2');
    const at = pos(u.el, 'U-S2');
    await u.point(u.unit('U-S2'), 'pointerdown', at.x + 8, at.y + 8, { ctrlKey: true });
    await u.point(u.unit('U-S2'), 'pointermove', at.x + 48, at.y + 20, { ctrlKey: true });
    await u.point(u.unit('U-S2'), 'pointerup', at.x + 48, at.y + 20, { ctrlKey: true });
    expect(selected(u.el)).toEqual(['U-S1']);
    expect(layout('U-S1')).toEqual(held);
    expect(layout('U-S2')).toEqual(dropped);
    expect(u.history().present.revision).toBe(rev);
    expect(u.history().past).toHaveLength(0);

    await u.tap(u.device('CYL-01'), 'CYL-01');
    await u.tap(u.device('PSH-01'), 'PSH-01', { metaKey: true });
    expect(selected(u.el)).toEqual(['CYL-01', 'PSH-01']);
    const devRev = u.history().present.revision;
    const cyl = layout('CYL-01');
    const psh = layout('PSH-01');
    const devAt = pos(u.el, 'PSH-01');
    await u.point(u.device('PSH-01'), 'pointerdown', devAt.x + 4, devAt.y + 4, { metaKey: true });
    await u.point(u.device('PSH-01'), 'pointermove', devAt.x + 40, devAt.y + 16, { metaKey: true });
    await u.point(u.device('PSH-01'), 'pointerup', devAt.x + 40, devAt.y + 16, { metaKey: true });
    expect(selected(u.el)).toEqual(['CYL-01']);
    expect(layout('CYL-01')).toEqual(cyl);
    expect(layout('PSH-01')).toEqual(psh);
    expect(u.history().present.revision).toBe(devRev);

    const x1 = layout('U-S1').x;
    const x2 = layout('U-S2').x;
    await u.tap(u.unit('U-S1'), 'U-S1');
    const from = pos(u.el, 'U-S2');
    await u.point(u.unit('U-S2'), 'pointerdown', from.x + 8, from.y + 8, { ctrlKey: true });
    await u.point(u.unit('U-S2'), 'pointermove', from.x + 28, from.y + 8, { ctrlKey: true });
    await u.point(u.unit('U-S2'), 'pointerup', from.x + 28, from.y + 8, { ctrlKey: true });
    expect(selected(u.el)).toEqual(['U-S1', 'U-S2']);
    const dx1 = layout('U-S1').x - x1;
    const dx2 = layout('U-S2').x - x2;
    expect(dx1).toBe(dx2);
    expect(dx1).not.toBe(0);
    expect(u.history().present.revision).toBe(devRev + 1);
    expect(u.history().past).toHaveLength(1);

    await u.tap(u.unit('U-S1'), 'U-S1');
    await u.tap(u.unit('U-S2'), 'U-S2', { shiftKey: true, ctrlKey: true });
    expect(selected(u.el)).toEqual(['U-S1', 'U-S2']);

    await u.click(u.el.querySelector('#layout-tab-board')!);
    const card = (code: string) => [...u.el.querySelectorAll('.station-card')].find((c) => (c.querySelector('h3')?.textContent ?? '').startsWith(code))!;
    const chip = (name: string) => [...u.el.querySelectorAll('.chip')].find((c) => (c.textContent ?? '').startsWith(name))!;
    const boardRev = u.history().present.revision;
    await u.mouse(card('S1'));
    await u.mouse(card('S3'), { ctrlKey: true });
    expect(card('S1').classList.contains('on')).toBe(true);
    expect(card('S3').classList.contains('on')).toBe(true);
    await u.mouse(card('S1'), { metaKey: true });
    expect(card('S1').classList.contains('on')).toBe(false);
    expect(card('S3').classList.contains('on')).toBe(true);
    await u.mouse(chip('PSH-01'), { ctrlKey: true });
    await u.mouse(chip('CYL-01'), { ctrlKey: true });
    expect(chip('PSH-01').classList.contains('on')).toBe(true);
    expect(chip('CYL-01').classList.contains('on')).toBe(true);
    await u.mouse(chip('PSH-01'), { ctrlKey: true });
    expect(chip('PSH-01').classList.contains('on')).toBe(false);
    expect(chip('CYL-01').classList.contains('on')).toBe(true);
    await u.mouse(card('S4'), { shiftKey: true });
    expect(card('S4').classList.contains('on')).toBe(true);
    expect(chip('CYL-01').classList.contains('on')).toBe(false);
    expect(u.history().present.revision).toBe(boardRev);
  });

  it('AC5 Ctrl+A enables arrange commands and horizontal distribute runs on the five-unit sample', async () => {
    const u = await mount();
    const layout = (id: string) => u.history().present.units.find((x) => x.id === id)!.layout;
    await u.tap(u.unit('U-S3'), 'U-S3');
    const from = pos(u.el, 'U-S3');
    await u.point(u.unit('U-S3'), 'pointerdown', from.x + 12, from.y + 12);
    await u.point(u.unit('U-S3'), 'pointermove', from.x + 52, from.y + 12);
    await u.point(u.unit('U-S3'), 'pointerup', from.x + 52, from.y + 12);
    const shifted = layout('U-S3').x;
    expect(shifted).not.toBe(from.x);
    const at = pos(u.el, 'U-S3');
    await u.point(u.unit('U-S3'), 'pointerdown', at.x + 8, at.y + 8, { ctrlKey: true });
    await u.point(u.unit('U-S3'), 'pointerup', at.x + 8, at.y + 8, { ctrlKey: true });
    expect(selected(u.el)).toEqual([]);
    expect(layout('U-S3').x).toBe(shifted);
    const rev = u.history().present.revision;
    await u.key(window, { key: 'a', ctrlKey: true });
    expect(selected(u.el)).toEqual([...UNITS].sort());
    await u.click(u.btn('배치 ▾'));
    const menu = u.el.querySelector('#arrange-menu')!;
    for (const label of ['가로 간격 같게', '세로 간격 같게', '너비 같게', '높이 같게', '겹침 풀기']) {
      expect((u.btn(label, menu) as HTMLButtonElement).disabled).toBe(false);
    }
    await u.click(u.btn('가로 간격 같게', menu));
    expect(layout('U-S3').x).not.toBe(shifted);
    expect(u.history().present.revision).toBe(rev + 1);
    expect(u.history().past.length).toBeGreaterThan(0);
  });

  it('a running project still selects every unit with Ctrl+A and does not edit', async () => {
    const u = await mount();
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
    try {
      await u.click(u.btn('▶ 실행'));
      await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]')!);
      await u.click(u.el.querySelector('#layout-tab-diagram')!);
      const rev = u.history().present.revision;
      const ev = await u.key(window, { key: 'a', ctrlKey: true });
      expect(ev.defaultPrevented).toBe(true);
      expect(selected(u.el)).toEqual([...UNITS].sort());
      expect(u.history().present.revision).toBe(rev);
      expect(u.history().past).toHaveLength(0);
    } finally {
      globalThis.requestAnimationFrame = raf;
    }
  });
});
