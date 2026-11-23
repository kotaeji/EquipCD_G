// @vitest-environment jsdom
// TURN-078: motion tokens on the shell, and run-diagram marks from virtual time.
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/ui/App';
import { STATUS } from '../src/ui/status';
import { holdRuntimeClock } from './holdRuntimeClock';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const originalMatch = window.matchMedia;
const originalError = console.error;
afterEach(async () => {
  console.error = originalError;
  window.matchMedia = originalMatch;
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  document.head.querySelectorAll('style').forEach((s) => s.remove());
  localStorage.clear();
});

function mockMatchMedia(reduced: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduced && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return false; },
  })) as typeof window.matchMedia;
}

async function mount() {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  localStorage.clear();
  const css = document.createElement('style');
  css.textContent = [
    readFileSync('src/ui/styles.css', 'utf8'),
    readFileSync('src/ui/motion.css', 'utf8'),
    readFileSync('src/ui/run-diagram.css', 'utf8'),
    readFileSync('src/ui/run3d.css', 'utf8'),
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
  const btn = (label: string) => [...el.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label || b.getAttribute('aria-label') === label);
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

async function stepTenths(u: Awaited<ReturnType<typeof openRun>>, n: number) {
  await u.click(u.btn('▶ 실행'));
  await u.click(u.btn('❚❚ 일시정지'));
  for (let i = 0; i < n; i += 1) await u.click(u.btn('+0.1s'));
}

describe('TURN-078 run diagram UI', () => {
  it('AC2 turning emphasis off keeps the status mark and drops the progress bar', async () => {
    const u = await openRun();
    const clock = holdRuntimeClock();
    try {
      await stepTenths(u, 4);
    } finally { clock.restore(); }
    const live = u.el.querySelector('.rf-device.is-active')!;
    expect(live.querySelector('[data-status="active"]')!.textContent).toContain(STATUS.active.word);
    expect(live.querySelector('[role="progressbar"]')).not.toBeNull();
    expect(u.el.querySelector('.app')!.getAttribute('data-motion')).toBe('on');

    await u.click(u.btn('3D'));
    const emphasis = u.el.querySelector('[aria-label="동작 강조"]') as HTMLInputElement;
    expect(emphasis.checked).toBe(true);
    await u.click(emphasis);
    await u.click(u.btn('도면'));
    expect(u.el.querySelector('.app')!.getAttribute('data-motion')).toBe('off');
    expect(u.el.querySelector('[data-frame="run"]')!.getAttribute('data-run-motion')).toBe('off');
    const still = u.el.querySelector('.rf-device.is-active')!;
    expect(still.querySelector('[data-status="active"]')).not.toBeNull();
    expect(still.querySelector('[role="progressbar"]')).toBeNull();
    expect(still.querySelector('.rf-progress-pct')!.textContent).toBe('50%');
  });

  it('AC2 reduced motion leaves the status mark and removes diagram travel', async () => {
    mockMatchMedia(true);
    const u = await openRun();
    const clock = holdRuntimeClock();
    try {
      await stepTenths(u, 4);
    } finally { clock.restore(); }
    expect(u.el.querySelector('.app')!.getAttribute('data-motion')).toBe('off');
    const device = u.el.querySelector('.rf-device.is-active')!;
    expect(device.querySelector('[data-status="active"]')!.textContent).toContain('진행 중');
    expect(device.querySelector('[role="progressbar"]')).toBeNull();
    expect(u.el.querySelector('.rf-mat')!.getAttribute('data-travel')).toBe('');
  });

  it('AC5 wait, just-done, and done marks keep their symbols', async () => {
    const u = await openRun();
    await setNumber(u.el.querySelector('[aria-label="투입 개수"]') as HTMLInputElement, '2');
    await setNumber(u.el.querySelector('[aria-label="투입 간격"]') as HTMLInputElement, '0');
    const clock = holdRuntimeClock();
    try {
      await stepTenths(u, 4);
      const waiting = u.el.querySelector('[data-wait="true"] .status-mark')!;
      expect(waiting.getAttribute('data-status')).toBe('pending');
      expect(waiting.textContent).toContain(STATUS.pending.mark);
      expect(waiting.textContent).toContain(STATUS.pending.word);
      expect(u.el.querySelector('.rf-unit.is-wait, .rf-device.is-wait')).not.toBeNull();
    } finally { clock.restore(); }
    const one = await openRun();
    const clock2 = holdRuntimeClock();
    try {
      await stepTenths(one, 8);
    } finally { clock2.restore(); }
    const fresh = one.el.querySelector('[data-just-done="true"]')!;
    expect(fresh.querySelector('[data-status="done"]')!.textContent).toContain(STATUS.done.mark);
    expect(fresh.querySelector('[data-status="done"]')!.textContent).toContain(STATUS.done.word);
    expect(fresh.className).toContain('is-just-done');
  });

  it('AC7 a 16x run does not log a console error', async () => {
    const errors: unknown[][] = [];
    console.error = (...args: unknown[]) => { errors.push(args); };
    const u = await openRun();
    const speed = u.el.querySelector('select[aria-label="배속"]') as HTMLSelectElement;
    await act(async () => {
      const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
      proto?.set?.call(speed, '16');
      speed.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(speed.value).toBe('16');
    const clock = holdRuntimeClock();
    try {
      await u.click(u.btn('▶ 실행'));
      await clock.elapse(4000);
      await u.click(u.btn('❚❚ 일시정지'));
    } finally { clock.restore(); }
    expect(errors).toEqual([]);
    expect(u.el.querySelector('.app')).not.toBeNull();
  });
});
