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
  css.textContent = `${readFileSync('src/ui/styles.css', 'utf8')}\n${readFileSync('src/ui/run3d.css', 'utf8')}\n${readFileSync('src/ui/run-summary.css', 'utf8')}`;
  document.head.appendChild(css);
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(<App />); });
  const click = async (node: Element | null | undefined) => {
    if (!node) throw new Error('missing button');
    await act(async () => { (node as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  };
  const btn = (label: string) => [...el.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(label) || (b.getAttribute('aria-label') ?? '').includes(label));
  return { el, click, btn };
}

async function setNumber(input: HTMLInputElement, value: string) {
  const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  await act(async () => {
    proto?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
}

describe('TURN-071 run screen', () => {
  it('AC5 shows piece numbers, cycle, throughput, bottleneck, and run gaps', async () => {
    const u = await mount();
    await u.click(u.el.querySelector('[data-sample-open="flow"]'));
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]'));
    await setNumber(u.el.querySelector('[aria-label="투입 개수"]') as HTMLInputElement, '3');
    await setNumber(u.el.querySelector('[aria-label="투입 간격"]') as HTMLInputElement, '0');
    const clock = holdRuntimeClock();
    try {
      await u.click(u.btn('▶ 실행'));
      await u.click(u.btn('끝까지'));
    } finally { clock.restore(); }
    expect(u.el.querySelector('[data-cycle-time]')!.textContent).toBe('00:06.500');
    expect(u.el.querySelector('[data-throughput]')!.textContent).toBe('553.8');
    expect(u.el.querySelector('[data-metric-basis]')!.textContent).toBe('정상 상태(가정)');
    expect(u.el.querySelector('[data-bottleneck]')!.textContent).toContain('S2');
    expect(u.el.querySelector('[data-material]')!.textContent).toContain('투입 3/3');
    expect(u.el.querySelector('[data-material]')!.textContent).toContain('배출 3');
    const pieces = [...u.el.querySelectorAll('[data-piece]')].map((row) => row.textContent ?? '');
    expect(pieces.some((text) => text.includes('개체 1'))).toBe(true);
    expect(pieces.some((text) => text.includes('개체 3'))).toBe(true);
    await u.click(u.el.querySelector('[aria-label="자세히 펼치기"]'));
    const summary = u.el.querySelector('.run-summary-table')!.textContent ?? '';
    expect(summary).toContain('개체 1');
    expect(summary).toContain('개체 2');
    expect(Number(u.el.querySelector('[data-gap-total]')!.getAttribute('data-gap-total'))).toBeGreaterThan(0);
    await u.click(u.el.querySelector('.stepper [data-stepid="check"]'));
    const gaps = u.el.textContent ?? '';
    expect(gaps).toContain('병목 Unit');
    expect(gaps).toContain('사이클 > 투입 간격');
  });
});
