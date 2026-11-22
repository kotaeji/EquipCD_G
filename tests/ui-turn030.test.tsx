// @vitest-environment jsdom
// TURN-030's run tabs are retired by TURN-035. Status words stay Korean, and runTab is not stored.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/ui/App';
import { loadView } from '../src/ui/viewSettings';
import { holdRuntimeClock } from './holdRuntimeClock';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  localStorage.clear();
});

async function mount(fresh = true) {
  if (fresh) localStorage.clear();
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(<App />); });
  const click = async (node: Element) => { await act(async () => { (node as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
  const btn = (label: string) => [...el.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label || b.getAttribute('aria-label') === label) as HTMLButtonElement;
  if (btn('시작하기')) await click(btn('시작하기'));
  const step = el.querySelector('.stepper [data-stepid="run"]');
  if (step && el.querySelector('.app')!.getAttribute('data-step') !== 'run') await click(step);
  return { el, click, btn };
}

const STATUS_EN = /\b(idle|running|paused|completed|error)\b/;

describe('TURN-030 run tabs retired', () => {
  it('the diagram and 3D views have no run tabs, and a stored runTab is dropped', async () => {
    localStorage.setItem('ecd.v1.userView', JSON.stringify({ runTab: 'diagram', home: false, step: 'run' }));
    const loaded = loadView(localStorage);
    expect('runTab' in loaded).toBe(false);
    const u = await mount(false);
    expect(u.el.querySelector('.run-tabs')).toBeNull();
    expect(u.el.querySelector('#run-tab-status')).toBeNull();
    expect(u.el.querySelector('#run-tab-diagram')).toBeNull();
    expect(u.el.querySelector('#run-tab-inspect')).toBeNull();
    expect(JSON.stringify(loadView(localStorage))).not.toContain('runTab');
    await u.click(u.el.querySelector('.header button.btn-main.primary')!);
    const projectKey = Object.keys(localStorage).find((k) => k.startsWith('ecd.v1.project.'))!;
    expect(localStorage.getItem(projectKey)).not.toContain('runTab');
    expect(u.el.querySelector('.run-steps')).not.toBeNull();
    expect(u.el.querySelector('.diagram-canvas')).not.toBeNull();
    await u.click(u.btn('3D'));
    expect(u.el.querySelector('.run-tabs')).toBeNull();
    expect(u.el.querySelector('.run-stage')).not.toBeNull();
    expect(u.el.querySelector('.run-steps')).not.toBeNull();
  });

  it('status words stay Korean on the run step', async () => {
    const u = await mount();
    const screenText = () => `${u.el.querySelector('.ws-run')?.textContent ?? ''}\n${u.el.querySelector('.statusbar')?.textContent ?? ''}`;
    expect(screenText()).toContain('시뮬 대기');
    expect(screenText()).toContain('실행 대기');
    expect(screenText()).not.toMatch(STATUS_EN);
    const clock = holdRuntimeClock();
    try {
      await u.click(u.btn('▶ 실행'));
      expect(screenText()).not.toMatch(STATUS_EN);
      await u.click(u.btn('❚❚ 일시정지'));
      expect(screenText()).toContain('일시정지');
      expect(screenText()).not.toMatch(STATUS_EN);
      await u.click([...u.el.querySelectorAll('.statusbar button')].find((b) => (b.textContent ?? '').startsWith('남은 항목'))!);
      expect(u.el.querySelector('.itemspop')!.textContent).toContain('시뮬 상태 일시정지');
      expect(u.el.querySelector('.itemspop')!.textContent).not.toMatch(STATUS_EN);
    } finally {
      clock.restore();
    }
  });
});
