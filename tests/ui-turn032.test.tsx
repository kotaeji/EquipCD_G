// @vitest-environment jsdom
// TURN-032 equipment-motion switch. jsdom has no WebGL, so the canvas shows the fallback.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/ui/App';
import { holdRuntimeClock } from './holdRuntimeClock';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const originalMatch = window.matchMedia;
afterEach(async () => {
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
  css.textContent = `${readFileSync('src/ui/styles.css', 'utf8')}\n${readFileSync('src/ui/run3d.css', 'utf8')}`;
  document.head.appendChild(css);
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(<App />); });
  const click = async (node: Element) => { await act(async () => { (node as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
  const btn = (label: string) => [...el.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label) as HTMLButtonElement;
  return { el, click, btn };
}

async function open3d() {
  const u = await mount();
  await u.click(u.btn('시작하기'));
  await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
  await u.click(u.btn('3D'));
  return u;
}

describe('TURN-032 equipment motion switch', () => {
  it('AC5 the switch is on by default, separate from emphasis, and off when motion is reduced', async () => {
    const u = await open3d();
    const stage = () => u.el.querySelector('.run-stage')!;
    const motion = () => u.el.querySelector('[aria-label="설비 동작"]') as HTMLInputElement;
    const emphasis = () => u.el.querySelector('[aria-label="동작 강조"]') as HTMLInputElement;
    expect(motion().checked).toBe(true);
    expect(emphasis().checked).toBe(true);
    expect(stage().getAttribute('data-equipment-motion')).toBe('on');
    expect(stage().getAttribute('data-redraw')).toBe('still');
    await u.click(motion());
    expect(u.el.querySelector('.run-stage')!.getAttribute('data-equipment-motion')).toBe('off');
    expect((u.el.querySelector('[aria-label="동작 강조"]') as HTMLInputElement).checked).toBe(true);
    await u.click(u.el.querySelector('[aria-label="설비 동작"]')!);
    expect(u.el.querySelector('.run-stage')!.getAttribute('data-equipment-motion')).toBe('on');

    mockMatchMedia(true);
    const reduced = await open3d();
    expect((reduced.el.querySelector('[aria-label="설비 동작"]') as HTMLInputElement).checked).toBe(false);
    expect(reduced.el.querySelector('.run-stage')!.getAttribute('data-equipment-motion')).toBe('off');
  });

  it('AC8 a running view asks to redraw and a paused view does not', async () => {
    const u = await open3d();
    const clock = holdRuntimeClock();
    try {
      expect(u.el.querySelector('.run-stage')!.getAttribute('data-redraw')).toBe('still');
      await u.click(u.btn('▶ 실행'));
      expect(u.el.querySelector('.run-stage')!.getAttribute('data-redraw')).toBe('live');
      await u.click(u.btn('❚❚ 일시정지'));
      expect(u.el.querySelector('.run-stage')!.getAttribute('data-redraw')).toBe('still');
      expect(u.el.querySelector('[data-run-status]')!.getAttribute('data-run-status')).toBe('paused');
    } finally {
      clock.restore();
    }
  });
});
