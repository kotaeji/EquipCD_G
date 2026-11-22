// @vitest-environment jsdom
// TURN-029 3D run view. jsdom has no WebGL, so the canvas shows the fallback.
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

async function mount(keepStorage = false) {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  if (!keepStorage) localStorage.clear();
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

async function open3d(kind?: 'flow' | 'parallel') {
  const u = await mount();
  if (kind === 'flow') await u.click(u.btn('흐름 예제'));
  else if (kind === 'parallel') await u.click(u.btn('병렬 예제'));
  else await u.click(u.btn('시작하기'));
  await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
  await u.click(u.btn('3D'));
  return u;
}

async function runToEnd(u: Awaited<ReturnType<typeof open3d>>) {
  const clock = holdRuntimeClock();
  try {
    await u.click(u.btn('▶ 실행'));
    await u.click(u.btn('끝까지'));
  } finally {
    clock.restore();
  }
}

async function setNumber(input: HTMLInputElement, value: string) {
  const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  await act(async () => {
    proto?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const live = (input.isConnected ? input : document.querySelector(`[aria-label="${input.getAttribute('aria-label')}"]`)) as HTMLInputElement;
  await act(async () => { live.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
}

describe('TURN-029 3D run view', () => {
  it('AC1 the run step switches to info, 3D, and conditions, and remembers the choice', async () => {
    const u = await open3d();
    expect(u.el.querySelector('[data-run-view]')!.getAttribute('data-run-view')).toBe('3d');
    expect(u.el.querySelector('.run-steps')!.getAttribute('aria-label')).toBe('단계');
    expect(u.el.querySelector('.run-strip')!.getAttribute('aria-label')).toBe('실행 요약');
    expect(u.el.querySelector('.run-stage')!.getAttribute('aria-label')).toBe('3D 시뮬레이션');
    expect(u.el.querySelector('.run-conditions')!.getAttribute('aria-label')).toBe('가동 조건');
    expect(u.el.querySelector('.run-details')).not.toBeNull();
    const actionName = [...u.el.querySelectorAll('.run3d-dur-name')].find((node) => node.textContent === 'S1 푸셔 투입') as HTMLElement;
    expect(actionName).toBeTruthy();
    expect(actionName.title).toBe('S1 푸셔 투입');
    expect(actionName.compareDocumentPosition(u.el.querySelector('[aria-label="S1 푸셔 투입 동작 시간"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const durCss = readFileSync('src/ui/run3d.css', 'utf8');
    expect(durCss).toMatch(/\.run3d-dur\s*\{[^}]*flex-direction:\s*column/);
    expect(durCss).toMatch(/\.run3d-dur-name\s*\{[^}]*width:\s*100%/);
    expect(JSON.parse(localStorage.getItem('ecd.v1.userView')!).runView).toBe('3d');
    await act(async () => { root!.unmount(); });
    root = null;
    const again = await mount(true);
    expect(again.el.querySelector('[data-run-view]')!.getAttribute('data-run-view')).toBe('3d');
    expect(again.el.querySelector('.run-steps')).not.toBeNull();
    expect(again.el.querySelector('.run-strip')).not.toBeNull();
  });

  it('AC10 without WebGL the view explains itself and returns to the diagram', async () => {
    const u = await open3d();
    expect(u.el.querySelector('.scene3d-fallback')!.textContent).toContain('이 브라우저에서는 3D 를 그릴 수 없습니다');
    await u.click(u.btn('도면으로 보기'));
    expect(u.el.querySelector('[data-run-view]')!.getAttribute('data-run-view')).toBe('diagram');
    expect(u.el.querySelector('.diagram-canvas')).not.toBeNull();
    expect(u.el.querySelector('.scene3d-fallback')).toBeNull();
  });

  it('AC4 diagram and 3D share one run, and the sample totals stay the same', async () => {
    const sample = await open3d();
    await runToEnd(sample);
    expect(sample.el.querySelector('[data-run-time]')!.textContent).toBe('00:11.100');
    await sample.click(sample.btn('도면'));
    expect(sample.el.textContent).toContain('00:11.100');
    expect(sample.el.querySelector('[data-run-view]')!.getAttribute('data-run-view')).toBe('diagram');
    await sample.click(sample.btn('3D'));
    expect(sample.el.querySelector('[data-run-time]')!.textContent).toBe('00:11.100');
    expect(sample.el.querySelector('[data-run-status]')!.getAttribute('data-run-status')).toBe('completed');
    expect(sample.el.querySelector('[data-run-status]')!.textContent).toBe('완료');

    const flow = await open3d('flow');
    await runToEnd(flow);
    expect(flow.el.querySelector('[data-run-time]')!.textContent).toBe('00:13.100');

    const parallel = await open3d('parallel');
    await runToEnd(parallel);
    expect(parallel.el.querySelector('[data-run-time]')!.textContent).toBe('00:02.500');
  });

  it('AC5 the info column shows the same step times as the run summary', async () => {
    const u = await open3d('flow');
    expect(u.el.querySelector('[data-longest]')!.textContent).toContain('가장 긴 단계');
    expect(u.el.querySelector('.run-steps')!.textContent).toContain('가정');
    await runToEnd(u);
    const steps = u.el.querySelector('.run-steps')!;
    const strip = u.el.querySelector('.run-strip')!;
    expect(strip.querySelector('[data-run-status]')!.textContent).toBe('완료');
    expect(strip.querySelector('[data-run-time]')!.textContent).toBe('00:13.100');
    expect(steps.querySelector('[data-longest]')!.textContent).toContain('가장 긴 단계');
    expect(steps.querySelector('[data-longest]')!.textContent).toContain('00:02.000');
    expect(steps.textContent).toContain('건너뜀');
    expect(strip.querySelector('[data-material]')!.textContent).toContain('배출');
    expect(steps.querySelectorAll('[data-unit-total]').length).toBeGreaterThan(0);
    expect(steps.textContent).toContain('실제 택트가 아닙니다');
    const times = [...steps.querySelectorAll('[data-elapsed]')].map((node) => node.getAttribute('data-elapsed'));
    expect(times).toContain('00:02.000');
    expect(times).toContain('-');
  });

  it('AC6 a duration edit changes the model, one undo restores it, and the rerun total moves', async () => {
    const u = await open3d();
    expect(u.el.querySelector('.work-rev')!.textContent).toContain('rev 1');
    const input = u.el.querySelector('[aria-label="S1 푸셔 투입 동작 시간 숫자"]') as HTMLInputElement;
    expect(input.value).toBe('0.8');
    await setNumber(input, '1.8');
    expect(u.el.querySelector('.work-rev')!.textContent).toContain('rev 2');
    expect((u.el.querySelector('[aria-label="S1 푸셔 투입 동작 시간 숫자"]') as HTMLInputElement).value).toBe('1.8');
    await u.click(u.el.querySelector('[data-tree-id="PSH-01"]')!);
    await u.click(u.el.querySelector('.stepper [data-stepid="attributes"]')!);
    await u.click([...u.el.querySelectorAll('button')].find((b) => (b.textContent ?? '').startsWith('Action '))!);
    const name = [...u.el.querySelectorAll('input')].find((node) => (node as HTMLInputElement).value === 'S1 푸셔 투입')!;
    const duration = name.closest('.section')!.querySelector('input.num') as HTMLInputElement;
    expect(duration.value).toBe('1.8');
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    await u.click(u.el.querySelector('[aria-label="실행 취소"]')!);
    expect(u.el.querySelector('.work-rev')!.textContent).toContain('rev 1');
    expect((u.el.querySelector('[aria-label="S1 푸셔 투입 동작 시간 숫자"]') as HTMLInputElement).value).toBe('0.8');
    await setNumber(u.el.querySelector('[aria-label="S1 푸셔 투입 동작 시간 숫자"]') as HTMLInputElement, '1.8');
    await runToEnd(u);
    expect(u.el.querySelector('[data-run-time]')!.textContent).toBe('00:12.100');
  });

  it('AC7 duration inputs lock while running or paused, and speed and labels stay editable', async () => {
    const u = await open3d();
    const clock = holdRuntimeClock();
    try {
      await u.click(u.btn('▶ 실행'));
      const duration = u.el.querySelector('[aria-label="S1 푸셔 투입 동작 시간 숫자"]') as HTMLInputElement;
      expect(duration.disabled).toBe(true);
      expect(u.el.querySelector('[data-duration-locked]')!.textContent).toContain('동작 시간');
      const speed = u.el.querySelector('.run-conditions select[aria-label="배속"]') as HTMLSelectElement;
      await act(async () => {
        speed.value = '2';
        speed.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect((u.el.querySelector('.toolbar select[aria-label="배속"]') as HTMLSelectElement).value).toBe('2');
      const names = u.el.querySelector('[aria-label="이름 표시"]') as HTMLInputElement;
      expect(names.disabled).toBe(false);
      await u.click(names);
      expect((u.el.querySelector('[aria-label="이름 표시"]') as HTMLInputElement).checked).toBe(false);
      await u.click(u.btn('❚❚ 일시정지'));
      expect((u.el.querySelector('[aria-label="S1 푸셔 투입 동작 시간 숫자"]') as HTMLInputElement).disabled).toBe(true);
      expect(u.el.querySelector('[data-duration-locked]')).not.toBeNull();
      expect((u.el.querySelector('[aria-label="동작 강조"]') as HTMLInputElement).disabled).toBe(false);
    } finally {
      clock.restore();
    }
  });

  it('AC8 revert puts back only the durations changed on this screen', async () => {
    const u = await open3d();
    const fault = [...u.el.querySelectorAll('.run-conditions label')].find((label) => (label.textContent ?? '').includes('결과 실패'))!.querySelector('input')!;
    await u.click(fault);
    await setNumber(u.el.querySelector('[aria-label="S1 푸셔 투입 동작 시간 숫자"]') as HTMLInputElement, '1.5');
    await setNumber(u.el.querySelector('[aria-label="S5 컨베이어 배출 동작 시간 숫자"]') as HTMLInputElement, '4');
    expect(u.el.querySelector('.work-rev')!.textContent).toContain('rev 4');
    await u.click(u.btn('이 화면에 들어온 뒤 바꾼 값 되돌리기'));
    expect((u.el.querySelector('[aria-label="S1 푸셔 투입 동작 시간 숫자"]') as HTMLInputElement).value).toBe('0.8');
    expect((u.el.querySelector('[aria-label="S5 컨베이어 배출 동작 시간 숫자"]') as HTMLInputElement).value).toBe('2');
    const still = [...u.el.querySelectorAll('.run-conditions label')].find((label) => (label.textContent ?? '').includes('결과 실패'))!.querySelector('input') as HTMLInputElement;
    expect(still.checked).toBe(true);
    expect(u.el.querySelector('[data-project-name]')!.textContent).toContain('5공정');
  });

  it('AC9 camera keys and the fit control are labeled', async () => {
    const u = await open3d();
    const stage = u.el.querySelector('.run-stage') as HTMLElement;
    const before = stage.getAttribute('data-camera-yaw');
    await act(async () => { stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
    expect(stage.getAttribute('data-camera-yaw')).not.toBe(before);
    await act(async () => { stage.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true })); });
    const zoomed = stage.getAttribute('data-camera-distance');
    await act(async () => { stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })); });
    expect(stage.getAttribute('data-camera-yaw')).toBe('0.700');
    expect(stage.getAttribute('data-camera-distance')).not.toBe(zoomed);
    const fit = u.el.querySelector('[aria-label="전체 보기"]') as HTMLButtonElement;
    expect(fit).not.toBeNull();
    await u.click(fit);
    expect(u.el.querySelector('.run-stage')!.getAttribute('data-camera-yaw')).toBe('0.700');
    expect(u.el.querySelector('[aria-label="배속"]')).not.toBeNull();
    expect(u.el.querySelector('[aria-label="이름 표시"]')).not.toBeNull();
    expect(u.el.querySelector('[aria-label="동작 강조"]')).not.toBeNull();
    expect(u.el.querySelector('[aria-label="S1 푸셔 투입 동작 시간"]')).not.toBeNull();
    expect(u.el.querySelector('.scene3d-bar')!.getAttribute('title')).toContain('화살표 회전');
  });
});
