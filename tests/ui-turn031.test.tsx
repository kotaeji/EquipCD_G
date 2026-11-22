// @vitest-environment jsdom
// TURN-031 floor names and the photo style switch. jsdom has no WebGL, so the canvas shows the fallback.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/ui/App';
import { PHOTO_NOTE } from '../src/ui/Scene3D';
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

describe('TURN-031 3D names and photo style', () => {
  it('AC4 the name switch clears floor names and brings them back', async () => {
    const u = await open3d();
    const stage = () => u.el.querySelector('.run-stage')!;
    expect(stage().getAttribute('data-show-names')).toBe('on');
    expect(Number(stage().getAttribute('data-floor-names'))).toBeGreaterThan(0);
    const names = u.el.querySelector('[aria-label="이름 표시"]') as HTMLInputElement;
    await u.click(names);
    expect(u.el.querySelector('.run-stage')!.getAttribute('data-show-names')).toBe('off');
    expect(u.el.querySelector('.run-stage')!.getAttribute('data-floor-names')).toBe('0');
    await u.click(u.el.querySelector('[aria-label="이름 표시"]')!);
    expect(u.el.querySelector('.run-stage')!.getAttribute('data-show-names')).toBe('on');
    expect(Number(u.el.querySelector('.run-stage')!.getAttribute('data-floor-names'))).toBeGreaterThan(0);
  });

  it('AC5 and AC8 photo style does not reset the run, and the note shows only then', async () => {
    const u = await open3d();
    const clock = holdRuntimeClock();
    try {
      await u.click(u.btn('▶ 실행'));
      await u.click(u.btn('❚❚ 일시정지'));
      const stage = () => u.el.querySelector('.run-stage')!;
      expect(stage().getAttribute('data-visual-style')).toBe('schematic');
      expect(u.el.querySelector('.scene3d-photo-note')).toBeNull();
      const time = u.el.querySelector('[data-run-time]')!.textContent;
      const status = u.el.querySelector('[data-run-status]')!.getAttribute('data-run-status');
      await u.click(u.btn('실사풍(AI)'));
      expect(u.el.querySelector('.run-stage')!.getAttribute('data-visual-style')).toBe('photo');
      expect(u.el.querySelector('.scene3d-photo-note')!.textContent).toBe(PHOTO_NOTE);
      expect(u.el.querySelector('[data-run-time]')!.textContent).toBe(time);
      expect(u.el.querySelector('[data-run-status]')!.getAttribute('data-run-status')).toBe(status);
      await u.click(u.btn('도식'));
      expect(u.el.querySelector('.run-stage')!.getAttribute('data-visual-style')).toBe('schematic');
      expect(u.el.querySelector('.scene3d-photo-note')).toBeNull();
      expect(u.el.querySelector('[data-run-time]')!.textContent).toBe(time);
      expect(u.el.querySelector('[data-run-status]')!.getAttribute('data-run-status')).toBe(status);
    } finally {
      clock.restore();
    }
  });
});
