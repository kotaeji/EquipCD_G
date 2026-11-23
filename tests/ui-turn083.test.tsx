// @vitest-environment jsdom
// TURN-083: scrub a finished run from the time bar.
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
  css.textContent = readFileSync('src/ui/styles.css', 'utf8') + readFileSync('src/ui/run-scrubber.css', 'utf8');
  document.head.appendChild(css);
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(<App />); });
  const click = async (node: Element | null | undefined) => {
    if (!node) throw new Error('missing control');
    await act(async () => { (node as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  };
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((item) => (item.textContent ?? '').replace(/\s+/g, ' ').trim() === label) as HTMLButtonElement | undefined;
  return { el, click, btn };
}

function revOf(el: ParentNode): string {
  return /rev (\d+)/.exec(el.querySelector('.statusbar')!.textContent ?? '')![1];
}
function undoOf(el: ParentNode): string {
  return /Undo (\d+)/.exec(el.querySelector('.statusbar')!.textContent ?? '')![1];
}

async function runToEnd(u: Awaited<ReturnType<typeof mount>>) {
  const clock = holdRuntimeClock();
  try {
    await u.click(u.btn('시작하기'));
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]'));
    await u.click(u.btn('▶ 실행'));
    await u.click(u.btn('끝까지'));
  } finally {
    clock.restore();
  }
}

async function setRange(input: HTMLInputElement, value: string) {
  const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  await act(async () => {
    proto?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function key(input: HTMLInputElement, keyName: string, shift = false) {
  await act(async () => {
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, shiftKey: shift, bubbles: true }));
  });
}

describe('TURN-083 run scrubber', () => {
  it('AC1 AC3 AC4 the bar moves by pointer and keys, and the end matches the finish', async () => {
    const u = await mount();
    await runToEnd(u);
    const bar = u.el.querySelector('[data-run-scrub]') as HTMLElement;
    expect(bar).toBeTruthy();
    expect(bar.dataset.scrubbing).toBe('off');
    expect(u.el.querySelector('[data-scrub-banner]')).toBeNull();
    expect(u.el.querySelectorAll('[data-scrub-tick]').length).toBeGreaterThan(0);
    expect(u.el.querySelector('[data-run-time]')!.textContent).toBe('00:11.100');
    const endMaterial = u.el.querySelector('[data-material]')!.textContent ?? '';
    const endStep = u.el.querySelector('[data-step-id="STEP-12"]')!.textContent ?? '';
    expect(endMaterial).toContain('배출 완료');
    expect(endStep).toContain('완료');

    const slider = u.el.querySelector('[aria-label="실행 시각"]') as HTMLInputElement;
    await setRange(slider, '2300');
    expect(u.el.querySelector('[data-scrub-banner]')!.textContent).toBe('되감아 보는 중 — 00:02.300');
    expect(u.el.querySelector('[data-run-time]')!.textContent).toBe('00:02.300');
    expect(u.el.querySelector('[data-step-id="STEP-04"]')!.textContent).toContain('진행 중');
    expect(u.el.querySelector('[data-step-id="STEP-01"]')!.textContent).toContain('완료');
    expect(u.el.querySelector('[data-step-id="STEP-12"]')!.textContent).toContain('대기');
    expect(u.el.querySelector('[data-material]')!.textContent).toContain('식별됨');
    expect(u.el.querySelector('.rf-mat-label')!.textContent).toContain('식별됨');
    expect(u.btn('되감기 끝')).toBeTruthy();
    expect(u.btn('여기서부터 다시 실행')).toBeTruthy();

    await u.click(u.el.querySelector('[aria-label="실행 보기"] [aria-checked="false"]'));
    const scene = u.el.querySelector('[data-scene-materials]') as HTMLElement;
    expect(scene.dataset.sceneMaterials).toContain('식별됨');
    expect(scene.dataset.sceneMaterials).not.toContain('exit');
    await u.click(u.btn('도면'));

    await u.click(u.btn('자세히'));
    await u.click(u.btn('실행 로그'));
    const weights = [...u.el.querySelectorAll('[data-log-weight]')].map((row) => (row as HTMLElement).dataset.logWeight);
    expect(weights).toContain('bold');
    expect(weights).toContain('dim');
    const later = [...u.el.querySelectorAll('[data-log-t]')].filter((row) => Number((row as HTMLElement).dataset.logT) > 2300);
    expect(later.length).toBeGreaterThan(0);
    expect(later.every((row) => (row as HTMLElement).dataset.logWeight === 'dim')).toBe(true);
    await u.click(u.btn('타이밍 차트'));
    expect(u.el.querySelector('[data-timing-now]')!.getAttribute('data-now-ms')).toBe('2300');
    await u.click(u.btn('신호'));
    const midSignals = u.el.querySelector('[aria-label="신호 상태"]')!.textContent;

    await key(u.el.querySelector('[aria-label="실행 시각"]') as HTMLInputElement, 'ArrowLeft');
    expect(u.el.querySelector('[data-scrub-banner]')!.textContent).toBe('되감아 보는 중 — 00:02.200');
    await key(u.el.querySelector('[aria-label="실행 시각"]') as HTMLInputElement, 'ArrowRight', true);
    expect(u.el.querySelector('[data-scrub-banner]')!.textContent).toBe('되감아 보는 중 — 00:03.200');
    await key(u.el.querySelector('[aria-label="실행 시각"]') as HTMLInputElement, 'Home');
    expect(u.el.querySelector('[data-scrub-banner]')!.textContent).toBe('되감아 보는 중 — 00:00.000');
    await key(u.el.querySelector('[aria-label="실행 시각"]') as HTMLInputElement, 'End');
    expect(u.el.querySelector('[data-scrub-banner]')).toBeNull();
    expect(u.el.querySelector('[data-run-time]')!.textContent).toBe('00:11.100');
    expect(u.el.querySelector('[data-material]')!.textContent).toBe(endMaterial);
    expect(u.el.querySelector('[data-step-id="STEP-12"]')!.textContent).toBe(endStep);
    expect(u.el.querySelector('[data-timing-now]')).toBeNull();
    expect(u.el.querySelector('[aria-label="신호 상태"]')!.textContent).not.toBe(midSignals);
    expect(u.btn('▶ 실행')).toBeTruthy();
    expect(u.btn('되감기 끝')).toBeUndefined();
  });

  it('AC5 scrubbing leaves rev and undo, and an edit hides the bar until undo', async () => {
    const u = await mount();
    await runToEnd(u);
    const rev = revOf(u.el);
    const undo = undoOf(u.el);
    await setRange(u.el.querySelector('[aria-label="실행 시각"]') as HTMLInputElement, '2300');
    await u.click(u.btn('되감기 끝'));
    expect(revOf(u.el)).toBe(rev);
    expect(undoOf(u.el)).toBe(undo);
    expect(u.el.querySelector('[data-run-scrub]')).toBeTruthy();

    const feed = u.el.querySelector('[aria-label="투입 개수"]') as HTMLInputElement;
    const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    await act(async () => {
      proto?.set?.call(feed, '2');
      feed.dispatchEvent(new Event('input', { bubbles: true }));
      feed.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(u.el.querySelector('[data-run-scrub]')).toBeNull();
    expect(revOf(u.el)).toBe(String(Number(rev) + 1));
    expect(undoOf(u.el)).toBe(String(Number(undo) + 1));

    await u.click(u.el.querySelector('[aria-label="실행 취소"]'));
    expect(revOf(u.el)).toBe(rev);
    expect(u.el.querySelector('[data-run-scrub]')).toBeTruthy();
    expect(u.el.querySelector('[data-scrub-banner]')).toBeNull();
  });

  it('AC3 continuing from the mark runs on without changing rev', async () => {
    const u = await mount();
    await runToEnd(u);
    const rev = revOf(u.el);
    const undo = undoOf(u.el);
    await setRange(u.el.querySelector('[aria-label="실행 시각"]') as HTMLInputElement, '2300');
    const clock = holdRuntimeClock();
    try {
      await u.click(u.btn('여기서부터 다시 실행'));
      expect(u.el.querySelector('[data-run-scrub]')).toBeNull();
      expect(u.el.querySelector('[data-run-time]')!.textContent).toBe('00:02.300');
      expect(u.el.textContent).toContain('실행 중');
      expect(revOf(u.el)).toBe(rev);
      expect(undoOf(u.el)).toBe(undo);
      await u.click(u.btn('끝까지'));
    } finally {
      clock.restore();
    }
    expect(u.el.querySelector('[data-run-scrub]')).toBeTruthy();
    expect(u.el.querySelector('[data-run-time]')!.textContent).toBe('00:11.100');
    expect(revOf(u.el)).toBe(rev);
    expect(undoOf(u.el)).toBe(undo);
  });
});
