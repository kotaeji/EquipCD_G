// @vitest-environment jsdom
// TURN-046: edit an Interlock rule, and jump from a blocked run to that row.
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
  localStorage.clear();
});

async function mount() {
  localStorage.clear();
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(<App />); });
  const click = async (node: Element | null | undefined) => {
    if (!node) throw new Error('missing control');
    await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  };
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(label));
  return { el, click, btn };
}

function panel(el: HTMLElement) {
  const node = el.querySelector('[data-interlock-panel]');
  if (!node) throw new Error('interlock panel missing');
  return node;
}

describe('TURN-046 interlock editor and blocked run', () => {
  it('AC8 adds a rule, shows the summary, bumps rev, undoes, and locks while running', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    await u.click(u.el.querySelector('.stepper [data-stepid="attributes"]'));
    const box = panel(u.el);
    expect(box.querySelector('[data-interlock="IL-01"] [data-interlock-summary]')!.textContent).toContain('허용 조건');
    expect(box.querySelector('[data-interlock="IL-02"] [data-interlock-summary]')!.textContent).toContain('동시 금지');
    const rev = () => u.el.querySelector('.statusbar')!.textContent ?? '';
    const before = rev();
    await u.click(u.btn('Interlock 추가', box));
    expect(rev()).not.toBe(before);
    expect(box.querySelectorAll('[data-interlock]').length).toBe(3);
    await u.click(u.el.querySelector('[aria-label="실행 취소"]'));
    expect(rev()).toBe(before);
    expect(box.querySelectorAll('[data-interlock]').length).toBe(2);

    const clock = holdRuntimeClock();
    try {
      await u.click(u.el.querySelector('.stepper [data-stepid="run"]'));
      await u.click(u.btn('▶ 실행'));
      await u.click(u.el.querySelector('.stepper [data-stepid="attributes"]'));
      const add = u.btn('Interlock 추가', panel(u.el)) as HTMLButtonElement;
      expect(add.disabled).toBe(true);
    } finally {
      clock.restore();
    }
  });

  it('AC7 AC12 a blocked run names Interlock and 이동 opens that row', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    await u.click(u.el.querySelector('.stepper [data-stepid="attributes"]'));
    const row = panel(u.el).querySelector('[data-interlock="IL-01"]')!;
    const action = row.querySelector('select[aria-label="IL-01 막을 Action"]') as HTMLSelectElement;
    const pusher = [...action.options].find((o) => o.textContent?.includes('푸셔 투입'))!;
    await act(async () => {
      action.value = pusher.value;
      action.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await u.click(u.btn('확인', row));
    const ask = u.el.querySelector('[data-confirmer-input]') as HTMLInputElement | null;
    if (ask) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(ask, '김검토');
        ask.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await u.click(u.btn('이 이름으로 확인'));
    }
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]'));
    await u.click(u.btn('▶ 실행'));
    await u.click(u.btn('끝까지'));
    expect(u.el.querySelector('[data-run-status]')!.getAttribute('data-run-status')).toBe('error');
    expect(u.el.querySelector('[data-run-interlock]')!.textContent).toContain('Interlock');
    expect(u.el.querySelector('.run-steps')!.textContent).toContain('오류 · Interlock');
    expect(u.el.querySelector('[data-interlock-guide]')!.textContent).toContain('IL-01');
    expect(u.el.textContent).not.toContain('PRE_UNMET');
    await u.click(u.btn('자세히'));
    await u.click(u.btn('실행 로그'));
    expect(u.el.querySelector('[aria-label="실행 로그"]')!.textContent).toContain('INTERLOCK_BLOCK');
    expect(u.el.querySelector('[aria-label="실행 로그"]')!.textContent).not.toContain('PRE_UNMET');
    const history = u.el.querySelector('[aria-label="Interlock 차단 이력"]')!;
    expect(history.textContent).toContain('IL-01');
    expect(history.textContent).toContain('거짓');
    await u.click(u.btn('이동', u.el.querySelector('[data-interlock-guide]')!));
    expect(u.el.querySelector('.app')!.getAttribute('data-step')).toBe('attributes');
    const flash = u.el.querySelector('.jump-flash') as HTMLElement;
    expect(flash.getAttribute('data-jump')).toBe('interlock:IL-01');
  });
});
