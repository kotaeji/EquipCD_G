// @vitest-environment jsdom
// TURN-096: unit duplicate and arrange. jsdom clicks, not the Chrome check.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { PALETTE_LABEL } from '../src/ui/CommandPalette';
import { App } from '../src/ui/App';
import type { History } from '../src/model/history';
import { rectsOverlap } from '../src/model/unitLayout';

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
  const click = async (node: Element | undefined | null) => {
    if (!node) throw new Error('missing control');
    await act(async () => { (node as HTMLElement).click(); });
  };
  const key = async (node: EventTarget, init: KeyboardEventInit) => {
    await act(async () => { node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })); });
  };
  const point = async (node: Element, type: string, x: number, y: number, init: PointerEventInit = {}) => {
    await act(async () => { node.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, ...init })); });
  };
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label) as HTMLButtonElement;
  const modal = () => el.querySelector('.modal') as HTMLElement | null;
  await click(btn('시작하기'));
  await click(el.querySelector('.stepper [data-stepid="canvas"]')!);
  await click(el.querySelector('#layout-tab-diagram')!);
  const tools = () => el.querySelector('.diagram-tools')!;
  const openArrange = async () => { if (!el.querySelector('#arrange-menu')) await click(btn('배치 ▾', tools())); };
  return { el, click, key, point, btn, modal, tools, openArrange, history: () => seen.h! };
}

describe('TURN-096 unit duplicate and arrange UI', () => {
  it('duplicates a unit from the button and Ctrl+D, one undo, without a sequence dialog', async () => {
    const u = await mount();
    const before = u.history().present.units.map((unit) => unit.id);
    await u.click(u.el.querySelector('[data-tree-id="U-S1"]'));
    await u.click(u.btn('복제', u.tools()));
    expect(u.modal()).toBeNull();
    expect(u.history().past).toHaveLength(1);
    expect(u.history().labels[u.history().labels.length - 1]).toBe('Unit 복제');
    const added = u.history().present.units.filter((unit) => !before.includes(unit.id));
    expect(added).toHaveLength(1);
    expect(added[0].name).toBe('S1 투입 사본');
    expect(added[0].positionLocked).toBeUndefined();
    for (const unit of u.history().present.units) {
      if (unit.id === added[0].id) continue;
      expect(rectsOverlap(unit.layout, added[0].layout)).toBe(false);
    }
    await u.click(u.el.querySelector('[aria-label="실행 취소"]')!);
    expect(u.history().present.units.map((unit) => unit.id)).toEqual(before);

    await u.click(u.el.querySelector('[data-tree-id="U-S5"]'));
    await u.key(window, { key: 'd', ctrlKey: true });
    const copy = u.history().present.units.find((unit) => unit.lineage?.duplicatedFrom === 'U-S5')!;
    expect(copy.code).toBe('S6');
    expect(u.history().past).toHaveLength(1);
    expect(u.el.querySelector(`[data-id="${copy.id}"]`)).not.toBeNull();
  });

  it('asks before copying substation sequences and keeps station steps', async () => {
    const u = await mount();
    await u.key(window, { key: 'k', ctrlKey: true });
    const input = u.el.querySelector(`[role="dialog"][aria-label="${PALETTE_LABEL}"] input`) as HTMLInputElement;
    await act(async () => {
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '병렬 예제');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await u.key(window, { key: 'Enter' });
    await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]')!);
    await u.click(u.el.querySelector('#layout-tab-diagram')!);
    const station = structuredClone(u.history().present.sequence);
    const seqBefore = u.history().present.substationSequences!.map((q) => q.id);
    await u.click(u.el.querySelector('[data-tree-id="U-PS1"]'));
    await u.click(u.btn('복제', u.tools()));
    expect(u.modal()?.getAttribute('aria-label') ?? u.modal()?.textContent).toContain('Unit 복제');
    const box = u.modal()!.querySelector('[data-copy-sequences]') as HTMLInputElement;
    await act(async () => { box.click(); });
    expect(box.checked).toBe(true);
    await u.click(u.btn('복제', u.modal()!));
    expect(u.modal()).toBeNull();
    const host = u.history().present.units.find((unit) => unit.lineage?.duplicatedFrom === 'U-PS1')!;
    const copied = u.history().present.substationSequences!.filter((q) => q.unitId === host.id);
    expect(copied.length).toBeGreaterThan(0);
    expect(u.history().present.substationSequences!.filter((q) => q.unitId === 'U-PS1').map((q) => q.id)).toEqual(seqBefore.filter((id) => id.startsWith('SSEQ-S1')));
    expect(u.history().present.sequence).toEqual(station);
    expect(u.history().past).toHaveLength(1);
  });

  it('matches selected devices and arranges only the selected units', async () => {
    const u = await mount();
    const pick = async (id: string, shift = false) => {
      const at = pos(u.el, id);
      const node = u.el.querySelector(`[data-id="${id}"] .rf-device, [data-id="${id}"] .rf-unit`)!;
      await u.point(node, 'pointerdown', at.x + 8, at.y + 8, shift ? { shiftKey: true } : {});
      await u.point(node, 'pointerup', at.x + 8, at.y + 8, shift ? { shiftKey: true } : {});
    };
    await pick('PSH-01');
    await pick('CYL-01', true);
    const unitBefore = u.history().present.units.find((unit) => unit.id === 'U-S1')!.layout.w;
    await u.openArrange();
    expect(u.btn('너비 같게', u.el.querySelector('#arrange-menu')!).disabled).toBe(false);
    await u.click(u.btn('너비 같게', u.el.querySelector('#arrange-menu')!));
    const widths = ['PSH-01', 'CYL-01'].map((id) => u.history().present.devices.find((d) => d.id === id)!.layout.w);
    expect(widths).toEqual([80, 80]);
    expect(u.history().present.units.find((unit) => unit.id === 'U-S1')!.layout.w).toBeGreaterThanOrEqual(unitBefore);
    expect(u.history().past).toHaveLength(1);
    await u.click(u.el.querySelector('[aria-label="실행 취소"]')!);

    const parked = { ...u.history().present.units.find((unit) => unit.id === 'U-S2')!.layout };
    await pick('U-S1');
    await pick('U-S3', true);
    await u.openArrange();
    await u.click(u.btn('고른 것만 자동 정렬', u.el.querySelector('#arrange-menu')!));
    expect(u.history().present.units.find((unit) => unit.id === 'U-S2')!.layout).toEqual(parked);
    const s1 = u.history().present.units.find((unit) => unit.id === 'U-S1')!.layout;
    const s3 = u.history().present.units.find((unit) => unit.id === 'U-S3')!.layout;
    expect(s3.x).toBeGreaterThan(s1.x);
    expect(u.history().past).toHaveLength(1);
  });

  it('blocks duplicate and arrange while a run is in progress', async () => {
    const u = await mount();
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
    try {
      await u.click(u.btn('▶ 실행'));
      await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]')!);
      await u.click(u.el.querySelector('#layout-tab-diagram')!);
      const rev = u.history().present.revision;
      await u.click(u.el.querySelector('[data-tree-id="U-S1"]'));
      expect(u.btn('복제', u.tools()).disabled).toBe(true);
      await u.key(window, { key: 'd', ctrlKey: true });
      expect(u.el.querySelector('.toast')?.textContent).toMatch(/차단/);
      const pick = async (id: string, shift = false) => {
        const at = pos(u.el, id);
        const node = u.el.querySelector(`[data-id="${id}"] .rf-unit`)!;
        await u.point(node, 'pointerdown', at.x + 8, at.y + 8, shift ? { shiftKey: true } : {});
        await u.point(node, 'pointerup', at.x + 8, at.y + 8, shift ? { shiftKey: true } : {});
      };
      await pick('U-S1');
      await pick('U-S2', true);
      await u.openArrange();
      const item = u.btn('고른 것만 자동 정렬', u.el.querySelector('#arrange-menu')!);
      expect(item.disabled).toBe(false);
      await u.click(item);
      expect(u.el.querySelector('.toast')?.textContent).toMatch(/차단/);
      expect(u.history().present.revision).toBe(rev);
    } finally {
      globalThis.requestAnimationFrame = raf;
    }
  });
});
