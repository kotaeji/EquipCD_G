// @vitest-environment jsdom
// TURN-063: the flow table, the SFC, and the condition notice for a multi-way branch.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
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
  root = createRoot(el);
  await act(async () => { root!.render(<App />); });
  const click = async (node: Element | undefined | null) => {
    if (!node) throw new Error('missing control');
    await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  };
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label || b.getAttribute('aria-label') === label);
  const flow = () => el.querySelector('table[aria-label="Station 흐름"]') as HTMLTableElement;
  const branch = () => flow().querySelector('tr[data-flow-kind="branch"]') as HTMLTableRowElement;
  const arms = () => [...flow().querySelectorAll('tr[data-flow-kind="arm"][data-flow-id="FLW-BRANCH"]')];
  const rev = () => Number((el.querySelector('.work-rev')!.textContent ?? '').match(/(\d+)/)?.[1]);
  return { el, click, btn, flow, branch, arms, rev };
}

describe('TURN-063 flow table and SFC', () => {
  it('AC1 AC5 a branch grows to four arms, the fifth is blocked, and the SFC shows 그 밖', async () => {
    const u = await mount();
    await u.click(u.btn('흐름 예제'));
    await u.click(u.el.querySelector('.stepper [data-stepid="sequence"]'));
    expect(u.arms().map((row) => row.querySelector('b')!.textContent)).toEqual(['참', '거짓']);
    const start = u.rev();
    await u.click(u.btn('갈래 추가', u.branch()));
    expect(u.rev()).toBe(start + 1);
    expect(u.arms().map((row) => row.querySelector('b')!.textContent)).toEqual(['갈래 1', '갈래 2', '그 밖']);
    await u.click(u.btn('실행 취소'));
    expect(u.rev()).toBe(start);
    expect(u.arms().map((row) => row.querySelector('b')!.textContent)).toEqual(['참', '거짓']);

    await u.click(u.btn('갈래 추가', u.branch()));
    await u.click(u.btn('갈래 추가', u.branch()));
    expect(u.arms()).toHaveLength(4);
    expect((u.btn('갈래 추가', u.branch()) as HTMLButtonElement).disabled).toBe(true);
    await u.click(u.btn('이 갈래 삭제', u.arms()[1]));
    expect(u.arms()).toHaveLength(3);
    await u.click(u.btn('실행 취소'));
    expect(u.arms()).toHaveLength(4);

    const before = u.flow().textContent ?? '';
    expect(before.indexOf('S2 NG')).toBeGreaterThan(before.indexOf('그 밖'));
    await u.click(u.btn('위로', u.arms()[u.arms().length - 1]));
    const after = u.flow().textContent ?? '';
    expect(after.indexOf('S2 NG')).toBeLessThan(after.indexOf('그 밖'));
    await u.click(u.el.querySelector('[aria-label="실행 취소"]'));

    await u.click(u.btn('SFC 미리보기', u.el.querySelector('.subtabs')!));
    const chart = u.el.querySelector('[data-sfc-kind="branch"]')!;
    expect(chart.getAttribute('data-sfc-arms')).toBe('4');
    expect(chart.textContent).toContain('그 밖');
    expect(chart.textContent).toContain('= ON');
  });

  it('AC6 AC7 AC8 the condition table, the blocker jump, and the rule version', async () => {
    const u = await mount();
    await u.click(u.btn('흐름 예제'));
    expect(u.el.textContent).toContain('seq-runtime/0.7.0');
    await u.click(u.el.querySelector('.stepper [data-stepid="sequence"]'));
    await u.click(u.btn('갈래 추가', u.branch()));
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]'));
    expect(u.el.querySelector('[data-blocker-code="EMPTY_LANE"]')).toBeNull();
    const unset = u.el.querySelector('[data-blocker-code="CONDITION_UNDEFINED"]') as HTMLButtonElement;
    expect(unset).toBeTruthy();
    await u.click(unset);
    expect(u.el.querySelector('.jump-flash')!.getAttribute('data-flow-arm')).toBe('1');

    const first = u.arms()[0].querySelector('select') as HTMLSelectElement;
    const second = u.arms()[1].querySelector('select') as HTMLSelectElement;
    expect(first.getAttribute('aria-label')).toBe('갈래 1 조건');
    await act(async () => {
      second.value = first.value;
      second.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await u.click(u.el.querySelector('.stepper [data-stepid="check"]'));
    await u.click(u.btn('진단·저장·AML'));
    const table = u.el.querySelector('[aria-label="조건"]')!;
    expect(table.textContent).toContain('도달하지 않음');
    const empty = table.querySelector('[data-cond-finding="emptyArm"]')!;
    expect(empty.getAttribute('data-cond-level')).toBe('info');
    expect(empty.textContent).toContain('빈 갈래');
    const row = table.querySelector('[data-cond-finding="unreachable"]')!;
    await u.click(u.btn('이동', row));
    expect(u.el.querySelector('.app')!.getAttribute('data-step')).toBe('sequence');
    expect(u.el.querySelector('.jump-flash')!.getAttribute('data-jump')).toBe('flow:FLW-BRANCH:arm:1');
  });
});
