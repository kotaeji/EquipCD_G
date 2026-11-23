// @vitest-environment jsdom
// TURN-074: bulk Action edit on step 3.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { History } from '../src/model/history';
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

function pos(scope: ParentNode, id: string) {
  const node = scope.querySelector(`.react-flow__node[data-id="${id}"]`) as HTMLElement | null;
  const match = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(node?.style.transform ?? '');
  return { x: match ? Number(match[1]) : NaN, y: match ? Number(match[2]) : NaN };
}

async function mount() {
  localStorage.clear();
  const el = document.createElement('div');
  document.body.appendChild(el);
  const seen: { h: History | null } = { h: null };
  root = createRoot(el);
  await act(async () => { root!.render(<App onHistory={(h) => { seen.h = h; }} />); });
  const click = async (node: Element | null | undefined) => {
    if (!node) throw new Error('missing control');
    await act(async () => { (node as HTMLElement).click(); });
  };
  const point = async (node: Element, type: string, x: number, y: number, init: PointerEventInit = {}) => {
    await act(async () => { node.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, ...init })); });
  };
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((item) => (item.textContent ?? '').trim() === label) as HTMLButtonElement | undefined;
  return { el, click, point, btn, history: () => seen.h! };
}

async function typeInput(input: HTMLInputElement, value: string) {
  const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  await act(async () => {
    proto?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function pick(select: HTMLSelectElement, value: string) {
  await act(async () => {
    const option = [...select.options].find((item) => item.value === value || (item.textContent ?? '').includes(value));
    if (!option) throw new Error(`missing option ${value}`);
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function revOf(el: ParentNode): number {
  return Number(/rev (\d+)/.exec(el.querySelector('.statusbar')!.textContent ?? '')![1]);
}
function undoOf(el: ParentNode): number {
  return Number(/Undo (\d+)/.exec(el.querySelector('.statusbar')!.textContent ?? '')![1]);
}

async function openAttributes(u: Awaited<ReturnType<typeof mount>>) {
  await u.click(u.btn('시작하기'));
  await u.click(u.el.querySelector('.stepper [data-stepid="attributes"]'));
}

describe('TURN-074 bulk edit screen', () => {
  it('AC1 lists every Action and filters by unit, kind, and status', async () => {
    const u = await mount();
    await openAttributes(u);
    const all = u.history().present.actions.length;
    expect(u.el.querySelectorAll('[data-bulk-row]')).toHaveLength(all);
    expect(u.el.querySelector('[data-bulk-table]')!.getAttribute('data-bulk-visible')).toBe(String(all));
    expect(u.el.textContent).toContain('일괄 편집');

    await pick(u.el.querySelector('[aria-label="Unit 걸러 보기"]') as HTMLSelectElement, 'S1');
    const s1 = [...u.el.querySelectorAll('[data-bulk-row]')];
    expect(s1.length).toBeGreaterThan(0);
    expect(s1.length).toBeLessThan(all);
    for (const row of s1) expect(row.textContent).toContain('S1');

    await pick(u.el.querySelector('[aria-label="Unit 걸러 보기"]') as HTMLSelectElement, '전체');
    await pick(u.el.querySelector('[aria-label="종류 걸러 보기"]') as HTMLSelectElement, '실린더');
    const cylinders = [...u.el.querySelectorAll('[data-bulk-row]')];
    expect(cylinders.length).toBeGreaterThan(0);
    expect(cylinders.length).toBeLessThan(all);
    for (const row of cylinders) expect(row.textContent).toMatch(/CYL-/);

    await pick(u.el.querySelector('[aria-label="종류 걸러 보기"]') as HTMLSelectElement, '전체');
    await pick(u.el.querySelector('[aria-label="상태 걸러 보기"]') as HTMLSelectElement, '확인');
    expect(u.el.querySelectorAll('[data-bulk-row]')).toHaveLength(0);
    expect(u.el.textContent).toContain('조건에 맞는 Action이 없습니다');
    await pick(u.el.querySelector('[aria-label="상태 걸러 보기"]') as HTMLSelectElement, '가정');
    expect(u.el.querySelectorAll('[data-bulk-row]')).toHaveLength(all);
    await pick(u.el.querySelector('[aria-label="상태 걸러 보기"]') as HTMLSelectElement, '미정');
    expect(u.el.querySelectorAll('[data-bulk-row]')).toHaveLength(0);
  });

  it('AC4 shows before and after, warns, and does not apply a bad value', async () => {
    const u = await mount();
    await openAttributes(u);
    const rev = revOf(u.el);
    await u.click(u.el.querySelector('[aria-label="S3 가공 실린더 전진(가상 작업) 체크"]'));
    await pick(u.el.querySelector('[aria-label="동작 시간 방식"]') as HTMLSelectElement, 'set');
    await typeInput(u.el.querySelector('[aria-label="동작 시간 값"]') as HTMLInputElement, 'abc');
    expect(u.el.querySelector('.bulk-error')!.textContent).toBe('숫자가 아닙니다');
    expect((u.el.querySelector('[data-bulk-apply]') as HTMLButtonElement).disabled).toBe(true);

    await typeInput(u.el.querySelector('[aria-label="동작 시간 값"]') as HTMLInputElement, '-2');
    expect(u.el.querySelector('.bulk-error')!.textContent).toBe('음수는 허용되지 않습니다');

    await typeInput(u.el.querySelector('[aria-label="동작 시간 값"]') as HTMLInputElement, '0');
    const preview = u.el.querySelector('[data-bulk-preview-row]')!;
    expect(preview.textContent).toContain('2 s → 0 s');
    expect(preview.querySelector('[data-bulk-warn]')!.textContent).toContain('동작 시간 0');
    expect(preview.textContent).toContain('적용 안 함');
    expect((u.el.querySelector('[data-bulk-apply]') as HTMLButtonElement).disabled).toBe(true);
    await u.click(u.el.querySelector('[data-bulk-apply]'));
    expect(revOf(u.el)).toBe(rev);

    await pick(u.el.querySelector('[aria-label="동작 시간 방식"]') as HTMLSelectElement, 'none');
    await pick(u.el.querySelector('[aria-label="타임아웃 방식"]') as HTMLSelectElement, 'set');
    await typeInput(u.el.querySelector('[aria-label="타임아웃 값"]') as HTMLInputElement, '0.2');
    const short = u.el.querySelector('[data-bulk-preview-row]')!;
    expect(short.textContent).toContain('4 s → 0.2 s');
    expect(short.querySelector('[data-bulk-warn]')!.textContent).toContain('타임아웃이 동작 시간보다 짧습니다');
    expect(u.history().present.actions.find((item) => item.name.startsWith('S3 가공'))!.timeout.value).toBe(4);
  });

  it('AC5 applies once and one undo restores it, and a run blocks apply', async () => {
    const u = await mount();
    await openAttributes(u);
    const rev = revOf(u.el);
    const undo = undoOf(u.el);
    await u.click(u.el.querySelector('[aria-label="보이는 Action 모두 체크"]'));
    await pick(u.el.querySelector('[aria-label="동작 시간 방식"]') as HTMLSelectElement, 'scale');
    await typeInput(u.el.querySelector('[aria-label="동작 시간 값"]') as HTMLInputElement, '0.5');
    expect(u.el.querySelector('[data-bulk-preview]')!.textContent).toContain('→');
    await u.click(u.el.querySelector('[data-bulk-apply]'));
    expect(revOf(u.el)).toBe(rev + 1);
    expect(undoOf(u.el)).toBe(undo + 1);
    const machined = u.history().present.actions.find((item) => item.name.startsWith('S3 가공'))!;
    expect(machined.duration.value).toBe(1);
    expect(machined.duration.source?.note).toBe('일괄 편집');
    expect(u.el.querySelector(`[data-bulk-row="${machined.id}"]`)!.textContent).toContain('일괄 편집');
    await u.click(u.el.querySelector('[aria-label="실행 취소"]'));
    expect(revOf(u.el)).toBe(rev);
    expect(u.history().present.actions.find((item) => item.id === machined.id)!.duration.value).toBe(2);

    const clock = holdRuntimeClock();
    try {
      await u.click(u.el.querySelector('.stepper [data-stepid="run"]'));
      await u.click(u.btn('▶ 실행'));
      await u.click(u.el.querySelector('.stepper [data-stepid="attributes"]'));
      const apply = u.el.querySelector('[data-bulk-apply]') as HTMLButtonElement;
      expect(apply.disabled).toBe(true);
      expect(u.el.textContent).toContain('실행 중에는 적용이 막혀 있습니다');
      const held = revOf(u.el);
      await u.click(apply);
      expect(revOf(u.el)).toBe(held);
    } finally {
      clock.restore();
    }
  });

  it('AC6 AC7 checks the devices chosen on the diagram, and status changes together', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]'));
    await u.click(u.el.querySelector('#layout-tab-diagram'));
    const selectDevice = async (id: string, shift: boolean) => {
      const at = pos(u.el, id);
      const node = u.el.querySelector(`[data-id="${id}"] .rf-device`)!;
      await u.point(node, 'pointerdown', at.x + 4, at.y + 4, shift ? { shiftKey: true } : {});
      await u.point(node, 'pointerup', at.x + 4, at.y + 4, shift ? { shiftKey: true } : {});
    };
    await selectDevice('PSH-01', false);
    await selectDevice('CYL-03', true);
    await u.click(u.el.querySelector('.stepper [data-stepid="attributes"]'));

    const wanted = new Set(u.history().present.actions.filter((item) => item.deviceId === 'PSH-01' || item.deviceId === 'CYL-03').map((item) => item.id));
    expect(wanted.size).toBeGreaterThan(1);
    const rows = [...u.el.querySelectorAll('[data-bulk-row]')];
    expect(rows.length).toBe(u.history().present.actions.length);
    for (const row of rows) {
      const id = row.getAttribute('data-bulk-row')!;
      expect((row.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(wanted.has(id));
    }

    await pick(u.el.querySelector('[aria-label="상태 변경"]') as HTMLSelectElement, 'confirm');
    const before = revOf(u.el);
    await u.click(u.el.querySelector('[data-bulk-apply]'));
    expect(revOf(u.el)).toBe(before + 1);
    for (const id of wanted) {
      const action = u.history().present.actions.find((item) => item.id === id)!;
      expect(action.duration.assumption).toBe(false);
      expect(action.timeout.assumption).toBe(false);
    }
    const other = u.history().present.actions.find((item) => !wanted.has(item.id))!;
    expect(other.duration.assumption).toBe(true);

    await pick(u.el.querySelector('[aria-label="상태 변경"]') as HTMLSelectElement, 'unset');
    await u.click(u.el.querySelector('[data-bulk-apply]'));
    for (const id of wanted) {
      const action = u.history().present.actions.find((item) => item.id === id)!;
      expect(action.duration.value).toBeNull();
      expect(action.timeout.value).toBeNull();
    }
    await pick(u.el.querySelector('[aria-label="상태 걸러 보기"]') as HTMLSelectElement, '미정');
    const unsetRows = [...u.el.querySelectorAll('[data-bulk-row]')];
    expect(unsetRows.map((row) => row.getAttribute('data-bulk-row')).sort()).toEqual([...wanted].sort());
  });
});
