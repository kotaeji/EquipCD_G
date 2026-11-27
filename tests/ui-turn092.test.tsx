// @vitest-environment jsdom
// TURN-092 loop mode editor, SFC caption, and the readiness jump.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { History } from '../src/model/history';
import { loopModeOf } from '../src/model/types';
import { findById } from '../src/model/flow';
import { App } from '../src/ui/App';

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
  const click = async (node: Element | undefined) => {
    if (!node) throw new Error('missing control');
    await act(async () => { (node as HTMLElement).click(); });
  };
  const flowTable = () => el.querySelector('table[aria-label="Station 흐름"]') as HTMLTableElement;
  const row = () => flowTable().querySelector('tr[data-flow-kind="loop"]') as HTMLTableRowElement;
  const choose = async (select: HTMLSelectElement, value: string) => {
    await act(async () => {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  return { el, click, flowTable, row, choose, history: () => seen.h! };
}

describe('TURN-092 loop editor', () => {
  it('AC1 AC5 AC9 changes the mode in one revision, undoes it, and a missing cap jumps to the row', async () => {
    const u = await mount();
    await u.click(u.el.querySelector('[data-sample-open="flow"]')!);
    await u.click(u.el.querySelector('.stepper [data-stepid="sequence"]')!);
    const rev = u.history().present.revision;
    const mode = u.row().querySelector('select[aria-label="반복 방식"]') as HTMLSelectElement;
    expect(mode.value).toBe('count');
    expect([...mode.options].map((o) => o.textContent)).toEqual(['횟수', '참이 될 때까지', '참인 동안']);
    await u.choose(mode, 'until');
    expect(u.history().present.revision).toBe(rev + 1);
    const id = u.row().getAttribute('data-flow-id')!;
    const until = findById(u.history().present.sequence.flow!, id)!.node;
    expect(until.kind).toBe('loop');
    if (until.kind !== 'loop') return;
    expect(loopModeOf(until)).toBe('until');
    expect(until.limit).toBe(10);
    expect(u.row().textContent).toContain('참이 될 때까지');
    await u.click(u.el.querySelector('[aria-label="실행 취소"]')!);
    expect(u.history().present.revision).toBe(rev);
    const back = findById(u.history().present.sequence.flow!, id)!.node;
    expect(back.kind === 'loop' && loopModeOf(back)).toBe('count');
    expect(u.row().querySelector('input[aria-label="반복 횟수"]')).toBeTruthy();

    await u.choose(u.row().querySelector('select[aria-label="반복 방식"]') as HTMLSelectElement, 'while');
    await u.choose(u.row().querySelector('select[aria-label="반복 방식"]') as HTMLSelectElement, 'until');
    const cond = u.row().querySelector('select[aria-label="반복 조건"]') as HTMLSelectElement;
    await u.choose(cond, 'undef');
    const cap = u.row().querySelector('input[aria-label="반복 상한"]') as HTMLInputElement;
    await act(async () => {
      cap.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(cap, '');
      cap.dispatchEvent(new Event('input', { bubbles: true }));
      cap.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await u.click(u.el.querySelector('[aria-label="SFC 미리보기"]') ?? [...u.el.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('SFC 미리보기'))!);
    const chart = u.el.querySelector('svg[aria-label="SFC 미리보기"]')!;
    expect(chart.querySelector(`[data-sfc-loop="${id}"]`)!.getAttribute('data-sfc-loop-tag')).toContain('최대 미정');
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    const move = u.el.querySelector('button[data-blocker-code="LOOP_LIMIT_UNDEFINED"]') as HTMLButtonElement;
    expect(move).toBeTruthy();
    expect(u.el.querySelector('button[data-blocker-code="CONDITION_UNDEFINED"]')).toBeTruthy();
    await u.click(move);
    expect(u.el.querySelector(`tr[data-jump="flow:${id}"].jump-flash, tr[data-jump="flow:${id}"] .jump-flash, .jump-flash`)).toBeTruthy();
  });
});
