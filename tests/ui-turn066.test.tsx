// @vitest-environment jsdom
// TURN-066. The command palette finds an object and itemJump carries the selection.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeGaps } from '../src/model/gaps';
import type { History } from '../src/model/history';
import { buildSampleProject } from '../src/model/sample';
import { PALETTE_LABEL } from '../src/ui/CommandPalette';
import { indexObjects } from '../src/ui/objectFind';
import { App } from '../src/ui/App';
import { holdRuntimeClock } from './holdRuntimeClock';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  const seen: { h: History | null } = { h: null };
  root = createRoot(el);
  await act(async () => { root!.render(<App onHistory={(h) => { seen.h = h; }} />); });
  const click = async (node: Element | undefined | null) => {
    if (!node) throw new Error('missing control');
    await act(async () => { (node as HTMLElement).click(); });
  };
  const key = async (node: EventTarget, init: KeyboardEventInit) => {
    await act(async () => {
      node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
    });
  };
  const btn = (label: string) => [...el.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label || b.getAttribute('aria-label') === label);
  const palette = () => el.querySelector(`[role="dialog"][aria-label="${PALETTE_LABEL}"]`);
  const typeQuery = async (value: string) => {
    const input = palette()?.querySelector('input') as HTMLInputElement;
    await act(async () => {
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const enterObject = async (id: string, shift = false) => {
    const row = palette()?.querySelector(`[data-object="${id}"]`) as HTMLElement | null;
    if (!row) throw new Error(`missing object ${id}`);
    await act(async () => { row.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })); });
    await key(window, { key: 'Enter', shiftKey: shift });
    // The outline is painted again while the field settles. One beat is enough to see it.
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
  };
  return {
    el, click, key, btn, palette, typeQuery, enterObject,
    rev: () => seen.h!.present.revision,
    undoN: () => seen.h!.past.length,
    step: () => el.querySelector('.app')!.getAttribute('data-step'),
  };
}

const sampleEntries = indexObjects(buildSampleProject());
const byName = (kind: string, part: string) => sampleEntries.find((e) => e.kind === kind && (e.name.includes(part) || e.screenName.includes(part) || e.code.includes(part)))!;

describe('TURN-066 find objects', () => {
  it('AC1 an empty query stays commands, and text adds object kinds', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    expect(u.btn(PALETTE_LABEL)!.textContent).toContain(PALETTE_LABEL);
    await u.key(window, { key: 'k', ctrlKey: true });
    expect(u.palette()!.querySelector('[data-object]')).toBeNull();
    expect(u.palette()!.querySelector('[data-find-section]')).toBeNull();
    expect(u.palette()!.querySelector('[data-command="save"]')).toBeTruthy();
    expect(u.palette()!.querySelector('[data-find-hint]')!.textContent).toContain('@ 대상만');
    await u.typeQuery('cyl');
    expect(u.palette()!.querySelector('[data-find-section="commands"]')).toBeNull();
    expect(u.palette()!.querySelector('[data-find-section="objects"]')).toBeTruthy();
    const kinds = [...u.palette()!.querySelectorAll('[data-find-kind]')].map((n) => n.getAttribute('data-find-kind'));
    expect(kinds).toContain('device');
    expect(kinds).toContain('signal');
    expect(kinds.indexOf('device')).toBeLessThan(kinds.indexOf('signal'));
    expect(u.palette()!.querySelector('[data-object="CYL-01"]')!.textContent).toContain('S1 투입 › CYL-01');
    await u.typeQuery('');
    expect(u.palette()!.querySelector('[data-object]')).toBeNull();
    expect(u.palette()!.querySelector('[data-command="save"]')).toBeTruthy();
  });

  it('AC2 > keeps commands and @ keeps objects', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    await u.key(window, { key: 'k', ctrlKey: true });
    await u.typeQuery('>실행');
    expect(u.palette()!.querySelector('[data-object]')).toBeNull();
    expect(u.palette()!.querySelector('[data-command="run"]')).toBeTruthy();
    await u.typeQuery('@cyl-01');
    expect(u.palette()!.querySelector('[data-command]')).toBeNull();
    expect(u.palette()!.querySelector('[data-object="CYL-01"]')).toBeTruthy();
    expect(u.palette()!.querySelector('[data-find-section="objects"]')).toBeTruthy();
  });

  it('shows five rows of a kind and the rest after N개 더', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    await u.key(window, { key: 'k', ctrlKey: true });
    await u.typeQuery('@');
    const more = u.palette()!.querySelector('[data-find-more="signal"]') as HTMLButtonElement;
    expect(more.textContent).toMatch(/\d+개 더/);
    const before = u.palette()!.querySelectorAll('[data-object-kind="signal"]').length;
    expect(before).toBe(5);
    await u.click(more);
    expect(u.palette()!.querySelectorAll('[data-object-kind="signal"]').length).toBeGreaterThan(5);
    expect(u.palette()).toBeTruthy();
  });

  it('AC4 Enter selects, moves, and flashes one of each kind', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    const rev = u.rev();
    const undo = u.undoN();
    const open = async (text: string, id: string) => {
      await u.key(window, { key: 'k', ctrlKey: true });
      await u.typeQuery(text);
      await u.enterObject(id);
    };
    const flashed = (field: string) => document.querySelector(`[data-jump="${field}"].jump-flash`);

    await open('s5배출', 'U-S5');
    expect(u.step()).toBe('canvas');
    expect(u.el.querySelector('#layout-tab-diagram')!.getAttribute('aria-selected')).toBe('true');
    expect(u.el.querySelector('[data-tree-id="U-S5"]')!.getAttribute('aria-selected')).toBe('true');
    expect(flashed('unit:U-S5')).toBeTruthy();

    await open('cyl-01', 'CYL-01');
    expect(u.step()).toBe('canvas');
    expect(u.el.querySelector('[data-tree-id="CYL-01"]')!.getAttribute('aria-selected')).toBe('true');
    expect(flashed('device:CYL-01')).toBeTruthy();

    const signal = byName('signal', 'CYL-01.전진 완료');
    await open('전진완료', signal.id);
    expect(u.step()).toBe('attributes');
    expect(u.el.querySelector('[data-tree-id="CYL-01"]')!.getAttribute('aria-selected')).toBe('true');
    expect(flashed(signal.jump.field!)).toBeTruthy();

    await open('잡기위치', 'GNT-04.pos-pick');
    expect(u.step()).toBe('attributes');
    expect(u.el.querySelector('[data-tree-id="GNT-04"]')!.getAttribute('aria-selected')).toBe('true');
    expect(flashed('position:GNT-04.pos-pick')).toBeTruthy();

    const action = byName('action', '푸셔 보조');
    await open('푸셔보조', action.id);
    expect(u.step()).toBe('attributes');
    expect(flashed(action.jump.field!)).toBeTruthy();
    expect(u.el.querySelector('[data-tree-id="CYL-01"]')!.getAttribute('aria-selected')).toBe('true');

    await open('step-01', 'STEP-01');
    expect(u.step()).toBe('sequence');
    expect(flashed('step:STEP-01')).toBeTruthy();
    expect((u.el.querySelector('[data-jump="step:STEP-01"] input') as HTMLInputElement).checked).toBe(true);
    expect(u.rev()).toBe(rev);
    expect(u.undoN()).toBe(undo);

    await u.key(window, { key: 'k', ctrlKey: true });
    await u.typeQuery('흐름 예제');
    await u.key(window, { key: 'Enter' });
    const flowRev = u.rev();
    const flowUndo = u.undoN();
    await open('읽기결과', 'FLW-BRANCH');
    expect(u.step()).toBe('sequence');
    expect(flashed('flow:FLW-BRANCH')).toBeTruthy();
    expect((u.el.querySelector('[data-jump="flow:FLW-BRANCH"] input') as HTMLInputElement).checked).toBe(true);
    expect(u.rev()).toBe(flowRev);
    expect(u.undoN()).toBe(flowUndo);

    await u.key(window, { key: 'k', ctrlKey: true });
    await u.typeQuery('예제 열기');
    await u.key(window, { key: 'Enter' });
    const back = u.rev();
    const backUndo = u.undoN();
    await open('il-01', 'IL-01');
    expect(u.step()).toBe('attributes');
    expect(flashed('interlock:IL-01')).toBeTruthy();
    expect(u.rev()).toBe(back);

    await open('공작물', 'MAT-001');
    expect(u.step()).toBe('sequence');
    expect(flashed('material:MAT-001')).toBeTruthy();

    const gap = analyzeGaps(buildSampleProject())[0];
    await open(gap.id, gap.id);
    expect(u.step()).toBe('check');
    expect(flashed(`gap:${gap.id}`)).toBeTruthy();
    expect(u.rev()).toBe(back);
    expect(u.undoN()).toBe(backUndo);
  });

  it('AC5 Shift+Enter selects without moving, and a jump during a run leaves rev alone', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    expect(u.step()).toBe('library');
    const rev = u.rev();
    const undo = u.undoN();
    await u.key(window, { key: 'k', ctrlKey: true });
    await u.typeQuery('cyl-01');
    await u.enterObject('CYL-01', true);
    expect(u.palette()).toBeNull();
    expect(u.step()).toBe('library');
    expect(u.el.querySelector('[data-tree-id="CYL-01"]')!.getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('.jump-flash')).toBeNull();
    expect(u.rev()).toBe(rev);
    expect(u.undoN()).toBe(undo);

    const clock = holdRuntimeClock();
    try {
      await u.click(u.el.querySelector('.stepper [data-stepid="run"]'));
      await u.click(u.btn('▶ 실행'));
      expect(u.btn('❚❚ 일시정지')!.hasAttribute('disabled')).toBe(false);
      const runRev = u.rev();
      const runUndo = u.undoN();
      await u.key(window, { key: 'k', ctrlKey: true });
      await u.typeQuery('s5배출');
      await u.enterObject('U-S5');
      expect(u.step()).toBe('canvas');
      expect(u.el.querySelector('[data-tree-id="U-S5"]')!.getAttribute('aria-selected')).toBe('true');
      expect(u.rev()).toBe(runRev);
      expect(u.undoN()).toBe(runUndo);
      await u.click(u.el.querySelector('.stepper [data-stepid="run"]'));
      expect(u.btn('❚❚ 일시정지')!.hasAttribute('disabled')).toBe(false);
    } finally { clock.restore(); }
  });
});
