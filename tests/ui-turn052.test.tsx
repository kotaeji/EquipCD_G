// @vitest-environment jsdom
// TURN-052: one condition line on the screens, and the diagnosis jump.
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
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(label));
  const setSelect = async (sel: HTMLSelectElement, value: string) => {
    await act(async () => {
      sel.value = value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  return { el, click, btn, setSelect };
}

describe('TURN-052 condition text on the screens', () => {
  it('AC2 AC9 the action summary, the flow table, the Interlock line, and a step row share the formula', async () => {
    const u = await mount();
    await u.click(u.btn('흐름 예제'));
    await u.click(u.el.querySelector('.stepper [data-stepid="attributes"]'));
    await u.click(u.btn('Action 편집'));
    const summary = u.el.querySelector('[data-cond-formula]')!;
    expect(summary.textContent).toContain('자재 위치 = S1 투입');
    const interlock = u.el.querySelector('[data-interlock="IL-01"] [data-interlock-summary]')!;
    expect(interlock.textContent).toContain('STP-03.upDone = ON');
    expect(interlock.textContent).not.toContain('==');
    await u.click(u.el.querySelector('.stepper [data-stepid="sequence"]'));
    const branch = u.el.querySelector('tr[data-flow-kind="branch"] [data-cond-formula]')!;
    expect(branch.textContent).toContain('= ON');
    const retry = u.el.querySelector('tr[data-flow-kind="retry"] [data-cond-formula]')!;
    expect(retry.textContent).toContain('= ON');
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]'));
    const steps = u.el.querySelector('.run-steps')!;
    expect(steps.textContent).toContain('자재 위치 = S1 투입');
    expect(steps.textContent).toContain('STP-02.upDone = ON 그리고 자재 위치 = S2 식별');
  });

  it('AC8 AC9 AC10 a contradiction is listed, 이동 highlights the condition, and the badge counts it', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    const before = Number(u.el.querySelector('[data-step-badge="check"] .st-count')!.textContent);
    await u.click(u.el.querySelector('.stepper [data-stepid="attributes"]'));
    await u.click(u.el.querySelector('[data-tree-id="PSH-01"]'));
    await u.click(u.btn('Action 편집'));
    const editor = [...u.el.querySelectorAll('[data-jump^="pre:"]')].find((node) => node.querySelector('select')) as HTMLElement;
    const signal = () => editor.querySelectorAll('select')[1] as HTMLSelectElement;
    const equals = () => editor.querySelectorAll('select')[2] as HTMLSelectElement;
    const add = () => [...editor.querySelectorAll('button')].find((b) => b.textContent === '+ 조건')!;
    const first = [...signal().options].find((o) => o.value)!;
    await u.setSelect(signal(), first.value);
    await u.setSelect(equals(), 'true');
    await u.click(add());
    await u.setSelect(signal(), first.value);
    await u.setSelect(equals(), 'true');
    await u.click(add());
    await u.setSelect(signal(), first.value);
    await u.setSelect(equals(), 'false');
    await u.click(add());
    await u.setSelect(editor.querySelector('select') as HTMLSelectElement, 'undefined');
    const note = editor.querySelector('input') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(note, '메모');
      note.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await u.click(add());
    expect(u.el.querySelector('[data-cond-level="error"]')).toBeTruthy();
    const after = Number(u.el.querySelector('[data-step-badge="check"] .st-count')!.textContent);
    // 항상 거짓 · 미정 are counted. 겹침 is a notice. The undefined pre also becomes a run blocker.
    expect(after).toBe(before + 3);
    await u.click(u.el.querySelector('.stepper [data-stepid="check"]'));
    await u.click(u.btn('진단·저장·AML'));
    const table = u.el.querySelector('[aria-label="조건"]')!;
    expect(table.textContent).toContain('항상 거짓');
    expect(table.querySelector('[data-cond-level="info"]')).toBeTruthy();
    expect(table.querySelector('[data-cond-level="undetermined"]')).toBeTruthy();
    expect(table.textContent).toContain('겹침');
    expect(table.textContent).toContain('미정(메모)');
    expect(table.textContent).toContain('어디');
    const row = table.querySelector('[data-cond-finding="alwaysFalse"]')!;
    expect(row.querySelector('[data-cond-formula]')!.textContent).toContain('= ON');
    expect(row.querySelector('[data-cond-formula]')!.textContent).toContain('= OFF');
    await u.click(u.btn('이동', row));
    const flash = u.el.querySelector('.jump-flash') as HTMLElement;
    expect(flash.getAttribute('data-jump')).toMatch(/^pre:/);
    expect(u.el.querySelector('.app')!.getAttribute('data-step')).toBe('attributes');
  });
});
