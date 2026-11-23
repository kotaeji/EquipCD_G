// @vitest-environment jsdom
// TURN-082: save run scenarios and run them all from the conditions column.
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/ui/App';
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
  css.textContent = [
    readFileSync('src/ui/styles.css', 'utf8'),
    readFileSync('src/ui/run-scenarios.css', 'utf8'),
    readFileSync('src/ui/icons.css', 'utf8'),
  ].join('\n');
  document.head.appendChild(css);
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(<App />); });
  const click = async (node: Element | null | undefined) => {
    if (!node) throw new Error('missing control');
    await act(async () => { (node as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  };
  const buttonNamed = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((item) => (item.textContent ?? '').replace(/\s+/g, ' ').trim() === label) as HTMLButtonElement | undefined;
  return { el, click, buttonNamed };
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
    const option = [...select.options].find((item) => item.value === value)
      ?? [...select.options].find((item) => (item.textContent ?? '').trim() === value);
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

function readFailBox(el: ParentNode): HTMLInputElement {
  const label = [...el.querySelectorAll('label')].find((item) => (item.textContent ?? '').includes('S2 바코드 읽기: 결과 실패'));
  const input = label?.querySelector('input');
  if (!input) throw new Error('read fail checkbox missing');
  return input as HTMLInputElement;
}

async function openRun(u: Awaited<ReturnType<typeof mount>>) {
  await u.click(u.buttonNamed('시작하기'));
  await u.click(u.el.querySelector('.stepper [data-stepid="run"]'));
}

async function saveScenario(u: Awaited<ReturnType<typeof mount>>, name: string) {
  await u.click(u.buttonNamed('저장…'));
  await typeText(u.el.querySelector('[aria-label="시나리오 이름"]') as HTMLInputElement, name);
  const dialog = u.el.querySelector('[aria-label="시나리오 저장"]')!;
  await u.click(u.buttonNamed('저장', dialog));
}

describe('TURN-082 scenario controls', () => {
  it('AC1 AC3 saves the current conditions, restores them, and undoes save, rename, and delete once', async () => {
    const u = await mount();
    await openRun(u);
    const speed = u.el.querySelector('.run-conditions [aria-label="배속"]') as HTMLSelectElement;
    await setNumber(u.el.querySelector('[aria-label="투입 개수"]') as HTMLInputElement, '3');
    await pick(speed, '2');
    await act(async () => { readFailBox(u.el).click(); });
    const rev = revOf(u.el);
    const undo = undoOf(u.el);

    await saveScenario(u, '재검사 길 확인');
    expect([...u.el.querySelectorAll('[data-scenario-list] li')].map((li) => li.textContent)).toEqual(['재검사 길 확인']);
    expect((u.el.querySelector('[data-scenario-select]') as HTMLSelectElement).selectedOptions[0].textContent).toBe('재검사 길 확인');
    expect(Number(revOf(u.el))).toBe(Number(rev) + 1);
    expect(Number(undoOf(u.el))).toBe(Number(undo) + 1);

    await u.click(u.el.querySelector('[aria-label="실행 취소"]'));
    expect(u.el.querySelectorAll('[data-scenario-list] li')).toHaveLength(0);
    expect(revOf(u.el)).toBe(rev);
    expect((u.el.querySelector('[aria-label="투입 개수"]') as HTMLInputElement).value).toBe('3');

    await saveScenario(u, '재검사 길 확인');
    await setNumber(u.el.querySelector('[aria-label="투입 개수"]') as HTMLInputElement, '1');
    await pick(speed, '1');
    await act(async () => { readFailBox(u.el).click(); });
    expect(readFailBox(u.el).checked).toBe(false);
    const beforePick = revOf(u.el);
    const beforeUndo = undoOf(u.el);

    await pick(u.el.querySelector('[data-scenario-select]') as HTMLSelectElement, '재검사 길 확인');
    expect((u.el.querySelector('[aria-label="투입 개수"]') as HTMLInputElement).value).toBe('3');
    expect((u.el.querySelector('.run-conditions [aria-label="배속"]') as HTMLSelectElement).value).toBe('2');
    expect(readFailBox(u.el).checked).toBe(true);
    expect(Number(revOf(u.el))).toBe(Number(beforePick) + 1);
    expect(Number(undoOf(u.el))).toBe(Number(beforeUndo) + 1);

    await u.click(u.buttonNamed('이름 바꾸기'));
    await typeText(u.el.querySelector('[aria-label="시나리오 이름"]') as HTMLInputElement, 'NG 길 확인');
    await u.click(u.buttonNamed('이름 바꾸기', u.el.querySelector('[aria-label="시나리오 이름 바꾸기"]')!));
    expect(u.el.querySelector('[data-scenario-list] li')!.textContent).toBe('NG 길 확인');
    expect(Number(revOf(u.el))).toBe(Number(beforePick) + 2);
    await u.click(u.el.querySelector('[aria-label="실행 취소"]'));
    expect(u.el.querySelector('[data-scenario-list] li')!.textContent).toBe('재검사 길 확인');

    const beforeDelete = revOf(u.el);
    await u.click(u.buttonNamed('삭제', u.el.querySelector('[aria-label="실행 시나리오"]')!));
    expect(u.el.querySelectorAll('[data-scenario-list] li')).toHaveLength(0);
    expect(Number(revOf(u.el))).toBe(Number(beforeDelete) + 1);
    await u.click(u.el.querySelector('[aria-label="실행 취소"]'));
    expect(u.el.querySelector('[data-scenario-list] li')!.textContent).toBe('재검사 길 확인');
  });

  it('AC3 choosing a scenario is blocked while running and while paused', async () => {
    const u = await mount();
    await openRun(u);
    await saveScenario(u, '정상');
    const rev = revOf(u.el);
    const clock = holdRuntimeClock();
    try {
      await u.click(u.buttonNamed('▶ 실행'));
      const select = u.el.querySelector('[data-scenario-select]') as HTMLSelectElement;
      expect(select.disabled).toBe(true);
      expect(u.buttonNamed('저장…')!.disabled).toBe(true);
      expect(u.el.querySelector('[data-scenario-locked]')!.textContent).toContain('시나리오를 고를 수 없습니다');
      await pick(select, '정상');
      expect(revOf(u.el)).toBe(rev);
      await u.click(u.buttonNamed('❚❚ 일시정지'));
      expect((u.el.querySelector('[data-scenario-select]') as HTMLSelectElement).disabled).toBe(true);
      expect(u.buttonNamed('저장…')!.disabled).toBe(true);
      expect(revOf(u.el)).toBe(rev);
    } finally {
      clock.restore();
    }
  });

  it('AC7 the all-scenarios table leaves the open run and revision alone', async () => {
    const u = await mount();
    await openRun(u);
    await saveScenario(u, '정상');
    await act(async () => { readFailBox(u.el).click(); });
    await saveScenario(u, '읽기 실패');
    await act(async () => { readFailBox(u.el).click(); });
    expect(readFailBox(u.el).checked).toBe(false);

    const clock = holdRuntimeClock();
    try {
      await u.click(u.buttonNamed('▶ 실행'));
      await u.click(u.buttonNamed('끝까지'));
    } finally {
      clock.restore();
    }
    const time = u.el.querySelector('[data-run-time]')!.textContent;
    const status = u.el.querySelector('[data-run-status]')!.getAttribute('data-run-status');
    const rev = revOf(u.el);
    const undo = undoOf(u.el);

    await u.click(u.el.querySelector('[data-scenario-run-all]'));
    const table = u.el.querySelector('[data-scenario-report]')!;
    expect(table.textContent).toContain('시나리오');
    expect(table.textContent).toContain('끝남 / 오류 코드');
    expect(table.textContent).toContain('총 시간');
    expect(table.textContent).toContain('간 갈래 요약');
    const rows = [...table.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('정상');
    expect(rows[0].textContent).toContain('끝남');
    expect(rows[0].textContent).toContain(time!);
    expect(rows[1].textContent).toContain('읽기 실패');
    expect(rows[1].textContent).toContain('READ_FAILED');
    expect(revOf(u.el)).toBe(rev);
    expect(undoOf(u.el)).toBe(undo);
    expect(u.el.querySelector('[data-run-time]')!.textContent).toBe(time);
    expect(u.el.querySelector('[data-run-status]')!.getAttribute('data-run-status')).toBe(status);
    expect(readFailBox(u.el).checked).toBe(false);
  });
});
