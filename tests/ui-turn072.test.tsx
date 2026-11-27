// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
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
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(label) || b.getAttribute('aria-label') === label);
  const card = () => el.querySelector('section.seqcard') as HTMLElement;
  const table = () => card().querySelector('table[data-flow-home="substation"]') as HTMLTableElement;
  return { el, click, btn, card, table, history: () => seen.h! };
}

async function openSubseq(u: Awaited<ReturnType<typeof mount>>) {
  await u.click(u.el.querySelector('[data-sample-open="parallel"]'));
  await u.click(u.el.querySelector('.stepper [data-stepid="sequence"]'));
  await u.click([...u.el.querySelectorAll('.subtabs button')].find((b) => (b.textContent ?? '').includes('Substation 시퀀스')));
}

describe('TURN-072 substation flow UI', () => {
  it('AC1 wraps and unwraps branch, loop, retry, and wait, and one undo removes the edit', async () => {
    const u = await mount();
    await openSubseq(u);
    expect(u.table().getAttribute('aria-label')).toContain('Substation 흐름');
    expect(u.el.querySelector('[data-subflow-note]')!.textContent).toContain('Station 흐름과 따로');
    const boxes = () => [...u.table().querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    const rev = () => u.history().present.revision;

    await u.click(boxes()[0]);
    await u.click(boxes()[1]);
    const at = rev();
    await u.click(u.btn('분기로 묶기', u.card()));
    expect(u.table().querySelector('tr[data-flow-kind="branch"]')).toBeTruthy();
    expect(rev()).toBe(at + 1);
    await u.click(u.btn('실행 취소'));
    expect(u.table().querySelector('tr[data-flow-kind="branch"]')).toBeNull();
    expect(rev()).toBe(at);

    await u.click(boxes()[0]);
    await u.click(u.btn('반복으로 묶기', u.card()));
    expect(u.table().querySelector('tr[data-flow-kind="loop"]')).toBeTruthy();
    expect(rev()).toBe(at + 1);
    await u.click(u.btn('블록 풀기', u.card()));
    expect(u.table().querySelector('tr[data-flow-kind="loop"]')).toBeNull();
    expect(rev()).toBe(at + 2);
    await u.click(u.btn('실행 취소'));
    expect(rev()).toBe(at + 1);
    await u.click(u.btn('실행 취소'));
    expect(rev()).toBe(at);

    await u.click(boxes()[0]);
    await u.click(u.btn('재시도로 묶기', u.card()));
    expect(u.table().querySelector('tr[data-flow-kind="retry"]')).toBeTruthy();
    await u.click(u.btn('실행 취소'));

    await u.click(u.btn('신호 기다림 추가', u.card()));
    expect(u.table().querySelector('tr[data-flow-kind="wait"]')).toBeTruthy();
    expect(rev()).toBe(at + 1);
    await u.click(u.btn('실행 취소'));
    expect(u.table().querySelector('tr[data-flow-kind="wait"]')).toBeNull();
    expect(rev()).toBe(at);
  });

  it('AC2 parallel and a Substation step are refused and the model stays', async () => {
    const u = await mount();
    await openSubseq(u);
    const box = u.table().querySelector('input[type="checkbox"]') as HTMLInputElement;
    await u.click(box);
    const rev = u.history().present.revision;
    const raw = JSON.stringify(u.history().present.substationSequences);
    const parallel = u.btn('병렬로 묶기', u.card()) as HTMLButtonElement;
    const subStep = u.btn('Substation 시퀀스 넣기', u.card()) as HTMLButtonElement;
    expect(parallel.disabled).toBe(true);
    expect(parallel.title).toContain('병렬을 넣지 않습니다');
    expect(subStep.disabled).toBe(true);
    expect(subStep.title).toContain('Substation 단계를 넣지 않습니다');
    await u.click(parallel);
    await u.click(subStep);
    expect(u.el.querySelector('.toast.err')).toBeNull();
    expect(u.history().present.revision).toBe(rev);
    expect(JSON.stringify(u.history().present.substationSequences)).toBe(raw);
    expect(u.table().querySelector('tr[data-flow-kind="parallel"]')).toBeNull();
    expect(u.table().querySelector('tr[data-flow-kind="substation"]')).toBeNull();
  });

  it('AC6 AC7 the jump lands on the Substation row and SFC expands the inner flow', async () => {
    const u = await mount();
    await openSubseq(u);
    const boxes = [...u.table().querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    await u.click(boxes[0]);
    await u.click(boxes[1]);
    await u.click(u.btn('분기로 묶기', u.card()));
    const select = u.table().querySelector('select[aria-label="조건"]') as HTMLSelectElement;
    await act(async () => {
      select.value = 'undef';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]'));
    const unset = u.el.querySelector('[data-blocker-code="CONDITION_UNDEFINED"]') as HTMLElement;
    expect(unset).toBeTruthy();
    await u.click(unset);
    const flash = u.el.querySelector('.jump-flash') as HTMLElement;
    expect(flash.getAttribute('data-jump')).toMatch(/^flow:/);
    expect(flash.closest('table')!.getAttribute('data-flow-home')).toBe('substation');

    await u.click(u.el.querySelector('.stepper [data-stepid="check"]'));
    await u.click(u.btn('진단·저장·AML'));
    const empty = u.el.querySelector('[data-cond-finding="emptyArm"]')!;
    expect(empty.textContent).toContain('빈 갈래');
    await u.click(u.btn('이동', empty));
    expect(u.el.querySelector('.app')!.getAttribute('data-step')).toBe('sequence');
    const arm = u.el.querySelector('.jump-flash') as HTMLElement;
    expect(arm.getAttribute('data-jump')).toMatch(/^flow:.*:arm:1$/);
    expect(arm.closest('table')!.getAttribute('data-flow-home')).toBe('substation');

    await u.click([...u.el.querySelectorAll('.subtabs button')].find((b) => (b.textContent ?? '').includes('SFC')));
    const chart = u.el.querySelector('svg[aria-label="SFC 미리보기"]')!;
    const toggle = chart.querySelector('[data-sfc-expand]') as SVGElement;
    expect(chart.querySelector('[data-sfc-open="0"]')).toBeTruthy();
    expect(chart.textContent).not.toContain('A 클램프 상승');
    await act(async () => { toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(chart.querySelector('[data-sfc-open="1"]')).toBeTruthy();
    expect(chart.textContent).toContain('A 클램프');
    expect(chart.textContent).toContain('분기');
  });
});
