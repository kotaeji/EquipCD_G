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
  css.textContent = `${readFileSync('src/ui/styles.css', 'utf8')}\n${readFileSync('src/ui/run3d.css', 'utf8')}`;
  document.head.appendChild(css);
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(<App />); });
  const click = async (node: Element | null | undefined) => {
    if (!node) throw new Error('missing button');
    await act(async () => { (node as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  };
  const btn = (label: string) => [...el.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label);
  return { el, click, btn };
}

async function openRun() {
  const u = await mount();
  await u.click(u.btn('시작하기'));
  await u.click(u.el.querySelector('.stepper [data-stepid="run"]'));
  return u;
}

async function setNumber(input: HTMLInputElement, value: string) {
  const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  await act(async () => {
    proto?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
}

describe('TURN-040 run screen', () => {
  it('AC7 shows 한 개 기준 for one piece and 정상 상태(가정) for three', async () => {
    const one = await openRun();
    const clock = holdRuntimeClock();
    try {
      await one.click(one.btn('▶ 실행'));
      await one.click(one.btn('끝까지'));
    } finally { clock.restore(); }
    expect(one.el.querySelector('[data-cycle-time]')!.textContent).toBe('00:11.100');
    expect(one.el.querySelector('[data-metric-basis]')!.textContent).toBe('한 개 기준');

    const many = await openRun();
    await setNumber(many.el.querySelector('[aria-label="투입 개수"]') as HTMLInputElement, '3');
    await setNumber(many.el.querySelector('[aria-label="투입 간격"]') as HTMLInputElement, '2');
    const clock2 = holdRuntimeClock();
    try {
      await many.click(many.btn('▶ 실행'));
      await many.click(many.btn('끝까지'));
    } finally { clock2.restore(); }
    expect(many.el.querySelector('[data-metric-basis]')!.textContent).toBe('정상 상태(가정)');
    expect(many.el.querySelector('[data-material]')!.textContent).toContain('투입 3/3');
    expect(many.el.querySelector('[data-material]')!.textContent).toContain('배출 3');
  });

  it('AC9 a missing interval can be opened from the blocker', async () => {
    const u = await openRun();
    await setNumber(u.el.querySelector('[aria-label="투입 개수"]') as HTMLInputElement, '2');
    await setNumber(u.el.querySelector('[aria-label="투입 간격"]') as HTMLInputElement, '');
    const move = u.el.querySelector('[data-blocker-code="FEED_INTERVAL"]') as HTMLButtonElement;
    expect(move).not.toBeNull();
    await u.click(move);
    expect(u.el.querySelector('.stage-title')!.textContent).toContain('자재');
  });

  it('AC11 feed count and interval bump rev once, undo, and lock while running', async () => {
    const u = await openRun();
    const rev = () => u.el.textContent ?? '';
    expect(rev()).toContain('rev 1');
    await setNumber(u.el.querySelector('[aria-label="투입 개수"]') as HTMLInputElement, '4');
    expect(rev()).toContain('rev 2');
    expect((u.el.querySelector('[aria-label="투입 개수"]') as HTMLInputElement).value).toBe('4');
    await u.click(u.el.querySelector('[aria-label="실행 취소"]'));
    expect(rev()).toContain('rev 1');
    expect((u.el.querySelector('[aria-label="투입 개수"]') as HTMLInputElement).value).toBe('1');
    await setNumber(u.el.querySelector('[aria-label="투입 간격"]') as HTMLInputElement, '12');
    expect(rev()).toContain('rev 2');
    await u.click(u.el.querySelector('[aria-label="실행 취소"]'));
    expect((u.el.querySelector('[aria-label="투입 간격"]') as HTMLInputElement).value).toBe('10');

    await setNumber(u.el.querySelector('[aria-label="투입 개수"]') as HTMLInputElement, '3');
    const clock = holdRuntimeClock();
    try {
      await u.click(u.btn('▶ 실행'));
      expect((u.el.querySelector('[aria-label="투입 개수"]') as HTMLInputElement).disabled).toBe(true);
      expect((u.el.querySelector('[aria-label="투입 간격"]') as HTMLInputElement).disabled).toBe(true);
      expect(u.el.querySelector('[data-feed-locked="true"]')).not.toBeNull();
      const lockedRev = (u.el.textContent ?? '').match(/rev (\d+)/)?.[1];
      await setNumber(u.el.querySelector('[aria-label="투입 개수"]') as HTMLInputElement, '9');
      expect((u.el.textContent ?? '').match(/rev (\d+)/)?.[1]).toBe(lockedRev);
    } finally { clock.restore(); }
  });

  it('AC12 the strip, steps, diagram, and details show pieces and a wait', async () => {
    const u = await openRun();
    await setNumber(u.el.querySelector('[aria-label="투입 개수"]') as HTMLInputElement, '3');
    await setNumber(u.el.querySelector('[aria-label="투입 간격"]') as HTMLInputElement, '0');
    const clock = holdRuntimeClock();
    try {
      await u.click(u.btn('▶ 실행'));
      await u.click(u.btn('❚❚ 일시정지'));
      for (let i = 0; i < 44; i++) await u.click(u.btn('+0.1s'));
    } finally { clock.restore(); }
    expect(u.el.querySelector('[data-material]')!.textContent).toContain('투입');
    expect(u.el.querySelectorAll('[data-piece]').length).toBeGreaterThanOrEqual(3);
    expect(u.el.querySelector('[data-piece-status]')!.textContent === '대기' || u.el.textContent?.includes('대기')).toBe(true);
    const markers = u.el.querySelectorAll('.rf-mat');
    expect(markers.length).toBe(3);
    expect(u.el.querySelectorAll('.rf-mat.is-waiting').length).toBeGreaterThanOrEqual(1);
    await u.click(u.btn('자세히'));
    const table = u.el.querySelector('[aria-label="개체별 시간"]');
    expect(table).not.toBeNull();
    expect(table!.querySelectorAll('[data-piece-row]')).toHaveLength(3);
    expect(table!.textContent).toContain('기다린 시간');
  });
});
