// @vitest-environment jsdom
// TURN-058: Evolution Lab what-if screen.
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/ui/App';
import { SCREEN } from '../src/ui/problemCopy';
import { holdRuntimeClock } from './holdRuntimeClock';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  document.head.querySelectorAll('style').forEach((node) => node.remove());
  localStorage.clear();
});

async function mount() {
  document.body.innerHTML = '';
  localStorage.clear();
  const css = document.createElement('style');
  css.textContent = readFileSync('src/ui/styles.css', 'utf8');
  document.head.appendChild(css);
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(<App />); });
  const click = async (node: Element | null | undefined) => {
    if (!node) throw new Error('missing control');
    await act(async () => { (node as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  };
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((item) => (item.textContent ?? '').trim() === label) as HTMLButtonElement | undefined;
  return { el, click, btn };
}

async function setNumber(input: HTMLInputElement, value: string) {
  const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  await act(async () => {
    proto?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const live = (input.isConnected ? input : document.querySelector(`[aria-label="${input.getAttribute('aria-label')}"]`)) as HTMLInputElement;
  await act(async () => { live.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
}

async function pick(select: HTMLSelectElement, value: string) {
  await act(async () => {
    const option = [...select.options].find((item) => item.value === value || (item.textContent ?? '').includes(value));
    if (!option) throw new Error(`missing option ${value}`);
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function typeText(input: HTMLInputElement, value: string) {
  const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  await act(async () => {
    proto?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function revOf(el: ParentNode): string {
  return /rev (\d+)/.exec(el.querySelector('.statusbar')!.textContent ?? '')![1];
}
function undoOf(el: ParentNode): string {
  return /Undo (\d+)/.exec(el.querySelector('.statusbar')!.textContent ?? '')![1];
}

async function openLab(u: Awaited<ReturnType<typeof mount>>) {
  await u.click(u.btn('시작하기'));
  await u.click(u.el.querySelector('.stepper [data-stepid="check"]'));
  await u.click(u.btn('Evolution Lab (F7)'));
}

async function runStation(u: Awaited<ReturnType<typeof mount>>) {
  const clock = holdRuntimeClock();
  try {
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]'));
    await u.click(u.btn('▶ 실행'));
    await u.click(u.btn('끝까지'));
  } finally {
    clock.restore();
  }
}

describe('TURN-058 Evolution Lab screen', () => {
  it('AC10 AC1 the empty screen has the limit line, and a fifth plan cannot be added', async () => {
    const u = await mount();
    await openLab(u);
    expect(u.el.textContent).not.toContain('준비 중');
    expect(u.el.querySelector('[data-lab-limit]')!.textContent).toBe(SCREEN.lab.limit);
    expect(u.el.querySelector('[data-empty] .empty-line')!.textContent).toBe('변형 안이 없습니다');
    expect(u.btn('안 추가', u.el.querySelector('[data-empty]')!)).toBeTruthy();
    const rev = revOf(u.el);
    const undo = undoOf(u.el);

    await u.click(u.el.querySelector('[data-lab-add]'));
    await u.click(u.el.querySelector('[data-lab-add]'));
    await u.click(u.el.querySelector('[data-lab-add]'));
    expect(u.el.querySelectorAll('[data-lab-variant]')).toHaveLength(3);
    const add = u.el.querySelector('[data-lab-add]') as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    await u.click(add);
    expect(u.el.querySelectorAll('[data-lab-variant]')).toHaveLength(3);

    await typeText(u.el.querySelector('[aria-label="lab-1 이름"]') as HTMLInputElement, '빠른 가공');
    await pick(u.el.querySelector('[aria-label="lab-1 동작 시간 방식"]') as HTMLSelectElement, 'action');
    await pick(u.el.querySelector('[aria-label="lab-1 동작 시간 Action"]') as HTMLSelectElement, 'S3 가공');
    await setNumber(u.el.querySelector('[aria-label="lab-1 동작 시간"]') as HTMLInputElement, '1');
    await pick(u.el.querySelector('[aria-label="lab-1 타임아웃 방식"]') as HTMLSelectElement, 'action');
    await pick(u.el.querySelector('[aria-label="lab-1 타임아웃 Action"]') as HTMLSelectElement, 'S3 가공');
    await setNumber(u.el.querySelector('[aria-label="lab-1 타임아웃"]') as HTMLInputElement, '3');
    await setNumber(u.el.querySelector('[aria-label="lab-1 투입 개수"]') as HTMLInputElement, '5');
    await pick(u.el.querySelector('[aria-label="lab-1 투입 간격 방식"]') as HTMLSelectElement, 'value');
    await setNumber(u.el.querySelector('[aria-label="lab-1 투입 간격"]') as HTMLInputElement, '0');

    await pick(u.el.querySelector('[aria-label="lab-2 동작 시간 방식"]') as HTMLSelectElement, 'scale');
    await setNumber(u.el.querySelector('[aria-label="lab-2 배율"]') as HTMLInputElement, '0.5');
    await typeText(u.el.querySelector('[aria-label="lab-3 이름"]') as HTMLInputElement, '이름만');

    expect((u.el.querySelector('[aria-label="lab-1 이름"]') as HTMLInputElement).value).toBe('빠른 가공');
    expect((u.el.querySelector('[aria-label="lab-1 동작 시간"]') as HTMLInputElement).value).toBe('1');
    expect((u.el.querySelector('[aria-label="lab-1 타임아웃"]') as HTMLInputElement).value).toBe('3');
    expect((u.el.querySelector('[aria-label="lab-1 투입 개수"]') as HTMLInputElement).value).toBe('5');
    expect((u.el.querySelector('[aria-label="lab-1 투입 간격"]') as HTMLInputElement).value).toBe('0');
    expect((u.el.querySelector('[aria-label="lab-2 배율"]') as HTMLInputElement).value).toBe('0.5');
    expect(revOf(u.el)).toBe(rev);
    expect(undoOf(u.el)).toBe(undo);

    await u.click(u.el.querySelector('.stepper [data-stepid="run"]'));
    await u.click(u.el.querySelector('.stepper [data-stepid="check"]'));
    await u.click(u.btn('Evolution Lab (F7)'));
    expect((u.el.querySelector('[aria-label="lab-1 이름"]') as HTMLInputElement).value).toBe('빠른 가공');
    expect(revOf(u.el)).toBe(rev);
  });

  it('AC2 AC4 AC9 running the plans leaves the station run alone and marks an old revision', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    await runStation(u);
    const time = u.el.querySelector('[data-run-time]')!.textContent;
    const status = u.el.querySelector('[data-run-status]')!.getAttribute('data-run-status');
    const rev = revOf(u.el);
    const undo = undoOf(u.el);
    await u.click(u.el.querySelector('.stepper [data-stepid="check"]'));
    await u.click(u.btn('Evolution Lab (F7)'));
    await u.click(u.el.querySelector('[data-lab-add]'));
    await pick(u.el.querySelector('[aria-label="lab-1 동작 시간 방식"]') as HTMLSelectElement, 'action');
    await pick(u.el.querySelector('[aria-label="lab-1 동작 시간 Action"]') as HTMLSelectElement, 'S3 가공');
    await setNumber(u.el.querySelector('[aria-label="lab-1 동작 시간"]') as HTMLInputElement, '1');
    await u.click(u.el.querySelector('[data-lab-run]'));
    const table = u.el.querySelector('[data-lab-table]')!;
    expect(table.textContent).toContain('끝남');
    expect(table.textContent).toContain('총 가상 시간');
    expect(table.textContent).toContain('사이클');
    expect(table.textContent).toContain('시간당 생산량');
    expect(table.textContent).toContain('병목');
    expect(table.textContent).toContain('가장 긴 단계');
    expect(table.textContent).toContain('기준 대비');
    expect(table.textContent).not.toContain('추천');
    const base = table.querySelector('[data-metric="total"] [data-lab-col="baseline"]')!.textContent!;
    expect(base).toContain(time!);
    expect(table.querySelector('[data-metric="total"] [data-lab-col="lab-1"]')!.getAttribute('data-best')).toBe('1');
    expect(table.querySelector('[data-metric="total"] [data-lab-col="baseline"]')!.getAttribute('data-best')).toBeNull();
    const delta = table.querySelector('[data-metric="delta"] [data-lab-col="lab-1"]')!.textContent!;
    expect(delta).toContain('−');
    expect(delta).toContain('%');
    expect(u.el.querySelector('[data-lab-rev]')!.textContent).toContain(`rev ${rev}`);
    expect(u.el.querySelector('[data-lab-stale]')).toBeNull();
    expect(revOf(u.el)).toBe(rev);
    expect(undoOf(u.el)).toBe(undo);

    await u.click(u.el.querySelector('.stepper [data-stepid="run"]'));
    expect(u.el.querySelector('[data-run-status]')!.getAttribute('data-run-status')).toBe(status);
    expect(u.el.querySelector('[data-run-time]')!.textContent).toBe(time);
    await setNumber(u.el.querySelector('[aria-label="투입 간격"]') as HTMLInputElement, '9');
    await u.click(u.el.querySelector('.stepper [data-stepid="check"]'));
    await u.click(u.btn('Evolution Lab (F7)'));
    expect(u.el.querySelector('[data-lab-stale]')!.textContent).toBe('이전 rev 의 결과');
    expect(u.el.querySelector('[data-lab-rev]')!.textContent).toContain(`rev ${rev}`);
    expect(table.isConnected).toBe(false);
    expect(u.el.querySelector('[data-metric="total"] [data-lab-col="baseline"]')!.textContent).toContain(time!);
  });

  it('AC7 AC8 apply lists the changes, is one undo, and is blocked while a run is paused', async () => {
    const u = await mount();
    await openLab(u);
    const rev = revOf(u.el);
    const undo = undoOf(u.el);
    await u.click(u.el.querySelector('[data-lab-add]'));
    await typeText(u.el.querySelector('[aria-label="lab-1 이름"]') as HTMLInputElement, '짧게');
    await pick(u.el.querySelector('[aria-label="lab-1 동작 시간 방식"]') as HTMLSelectElement, 'action');
    await pick(u.el.querySelector('[aria-label="lab-1 동작 시간 Action"]') as HTMLSelectElement, 'S3 가공');
    await setNumber(u.el.querySelector('[aria-label="lab-1 동작 시간"]') as HTMLInputElement, '1');
    await u.click(u.el.querySelector('[data-lab-apply="lab-1"]'));
    const dialog = u.el.querySelector('[data-lab-confirm]')!;
    expect(dialog.textContent).toContain('S3 가공 실린더 전진(가상 작업) 동작 시간 2 s → 1 s');
    expect(dialog.textContent).toContain('Evolution Lab 안 〈짧게〉에서');
    expect(dialog.textContent).toContain('가정');
    await u.click(u.btn('취소', dialog));
    expect(u.el.querySelector('[data-lab-confirm]')).toBeNull();
    expect(revOf(u.el)).toBe(rev);
    expect(undoOf(u.el)).toBe(undo);

    await u.click(u.el.querySelector('[data-lab-apply="lab-1"]'));
    await u.click(u.btn('반영', u.el.querySelector('[data-lab-confirm]')!));
    expect(revOf(u.el)).toBe(String(Number(rev) + 1));
    expect(undoOf(u.el)).toBe(String(Number(undo) + 1));
    await u.click(u.btn('저장'));
    const saved = localStorage.getItem('ecd.v1.project.prj-sample-5step') ?? '';
    expect(saved).toContain('Evolution Lab 안 〈짧게〉에서');
    expect(saved).not.toContain('"id":"lab-1"');

    await u.click(u.el.querySelector('[aria-label="실행 취소"]'));
    expect(revOf(u.el)).toBe(rev);
    expect(undoOf(u.el)).toBe(undo);

    const clock = holdRuntimeClock();
    try {
      await u.click(u.el.querySelector('.stepper [data-stepid="run"]'));
      await u.click(u.btn('▶ 실행'));
      await u.click(u.btn('❚❚ 일시정지'));
    } finally {
      clock.restore();
    }
    await u.click(u.el.querySelector('.stepper [data-stepid="check"]'));
    await u.click(u.btn('Evolution Lab (F7)'));
    const apply = u.el.querySelector('[data-lab-apply="lab-1"]') as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    expect(apply.title).toContain('실행 중');
    await u.click(apply);
    expect(u.el.querySelector('[data-lab-confirm]')).toBeNull();
    expect(revOf(u.el)).toBe(rev);
  });
});
