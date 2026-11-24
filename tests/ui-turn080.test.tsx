// @vitest-environment jsdom
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
  document.head.querySelectorAll('style').forEach((s) => s.remove());
  localStorage.clear();
});

async function mount() {
  document.body.innerHTML = '';
  localStorage.clear();
  const css = document.createElement('style');
  css.textContent = [readFileSync('src/ui/styles.css', 'utf8'), readFileSync('src/ui/MaterialMix.css', 'utf8'), readFileSync('src/ui/run3d.css', 'utf8'), readFileSync('src/ui/run-summary.css', 'utf8')].join('\n');
  document.head.appendChild(css);
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(<App />); });
  const click = async (node: Element | null | undefined) => {
    if (!node) throw new Error('missing control');
    await act(async () => { (node as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  };
  const btn = (label: string) => [...el.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(label) || (b.getAttribute('aria-label') ?? '').includes(label));
  return { el, click, btn };
}

async function blurInput(input: HTMLInputElement, value: string) {
  const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  await act(async () => {
    proto?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
}

async function choose(select: HTMLSelectElement, value: string) {
  const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  await act(async () => {
    proto?.set?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('TURN-080 material screen', () => {
  it('AC1 adds four definitions, blocks a fifth, and confirms a delete that is in use', async () => {
    const u = await mount();
    await u.click(u.el.querySelector('[data-sample-open="sample"]'));
    await u.click(u.el.querySelector('.stepper [data-stepid="sequence"]'));
    await u.click(u.btn('자재·Flow'));
    const add = () => u.el.querySelector('[aria-label="자재 정의 추가"]') as HTMLButtonElement;
    expect(u.el.querySelectorAll('[data-material-def]')).toHaveLength(1);
    await u.click(add());
    await u.click(add());
    await u.click(add());
    expect(u.el.querySelectorAll('[data-material-def]')).toHaveLength(4);
    expect(add().disabled).toBe(true);
    expect(u.el.querySelector('[data-material-cap]')!.textContent).toContain('4개까지');
    await u.click(add());
    expect(u.el.querySelectorAll('[data-material-def]')).toHaveLength(4);
    const marks = [...u.el.querySelectorAll('[data-material-mark]')].map((n) => n.getAttribute('data-material-mark'));
    expect(marks).toEqual(['A', 'B', 'C', 'D']);
    await u.click(u.el.querySelector('[aria-label="B 정의 삭제"]'));
    expect(u.el.querySelector('[data-delete-detail]')!.textContent).toContain('투입 순서');
    await u.click(u.btn('취소'));
    expect(u.el.querySelectorAll('[data-material-def]')).toHaveLength(4);
    await u.click(u.el.querySelector('[aria-label="B 정의 삭제"]'));
    await u.click(u.el.querySelector('.modal-actions button.danger'));
    expect(u.el.querySelectorAll('[data-material-def]')).toHaveLength(3);
    expect(u.el.querySelector('[data-feed-preview]')!.textContent).toContain('A');
  });

  it('AC3 the flow condition editor writes 자재 종류', async () => {
    const u = await mount();
    await u.click(u.el.querySelector('[data-sample-open="flow"]'));
    await u.click(u.el.querySelector('.stepper [data-stepid="sequence"]'));
    const select = u.el.querySelector('select[aria-label="조건"]') as HTMLSelectElement;
    const option = [...select.options].find((o) => o.textContent?.startsWith('자재 종류 ='));
    expect(option).toBeTruthy();
    await choose(select, option!.value);
    expect(u.el.querySelector('[data-cond-formula]')!.textContent).toContain('자재 종류 =');
  });

  it('AC5 and AC7 show kind counts and the kind letter on the diagram', async () => {
    const u = await mount();
    await u.click(u.el.querySelector('[data-sample-open="sample"]'));
    await u.click(u.el.querySelector('.stepper [data-stepid="sequence"]'));
    await u.click(u.btn('자재·Flow'));
    await u.click(u.el.querySelector('[aria-label="자재 정의 추가"]'));
    await blurInput(u.el.querySelector('[aria-label="자재 화면 투입 개수"]') as HTMLInputElement, '2');
    const order = u.el.querySelector('[aria-label="투입 순서"]') as HTMLInputElement;
    await blurInput(order, 'A, B');
    expect(u.el.querySelector('[data-feed-preview]')!.textContent).toContain('A B');
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]'));
    const count = u.el.querySelector('[aria-label="투입 개수"]') as HTMLInputElement;
    const interval = u.el.querySelector('[aria-label="투입 간격"]') as HTMLInputElement;
    await blurInput(count, '2');
    await blurInput(interval, '0');
    const clock = holdRuntimeClock();
    try {
      await u.click(u.btn('▶ 실행'));
      const live = [...u.el.querySelectorAll('[data-mark]')].map((n) => n.getAttribute('data-mark')).filter(Boolean);
      expect(live).toContain('A');
      await u.click(u.btn('끝까지'));
    } finally { clock.restore(); }
    const summary = u.el.querySelector('[data-kind-summary]')!.textContent ?? '';
    expect(summary).toContain('종류 A');
    expect(summary).toContain('종류 B');
    expect(summary).toContain('생산');
    expect(summary).toContain('평균');
  });
});
