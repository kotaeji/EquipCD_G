// @vitest-environment jsdom
// TURN-033 cycle, throughput, bottleneck, Gap, and timeout on the 3D view.
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { GAP_KIND_LABEL } from '../src/model/gaps';
import { App } from '../src/ui/App';
import { TIMEOUT_EQUAL, TIMEOUT_WARN } from '../src/ui/RunConditions';
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

async function open3d(kind?: 'flow') {
  const u = await mount();
  if (kind === 'flow') await u.click(u.btn('흐름 예제'));
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

describe('TURN-033 3D info and timeout', () => {
  it('AC1 AC2 AC3 the info column shows cycle, throughput, and the bottleneck after a run', async () => {
    const sample = await open3d();
    const strip = () => sample.el.querySelector('.run-strip')!;
    const steps = () => sample.el.querySelector('.run-steps')!;
    expect(strip().querySelector('[data-cycle-time]')!.textContent).toBe('실행 뒤 표시');
    expect(strip().querySelector('[data-throughput]')!.textContent).toBe('—');
    expect(strip().querySelector('[data-throughput-note]')!.textContent).toBe('자재를 한 개씩 이어서 넣는다고 본 값 — 실제 택트 아님');
    expect(strip().querySelector('[data-bottleneck]')).not.toBeNull();
    expect(steps().querySelector('.run3d-bars.units .run3d-bar-fill')).not.toBeNull();
    await runToEnd(sample);
    expect(strip().querySelector('[data-cycle-time]')!.textContent).toBe('00:11.100');
    expect(strip().querySelector('[data-throughput]')!.textContent).toBe('324.3');
    const bottleneck = strip().querySelector('[data-bottleneck]')!;
    expect(bottleneck.textContent).toContain('병목');
    const marked = steps().querySelector('.run3d-bars.units li.is-bottleneck')!;
    expect(marked.textContent).toContain('병목');
    expect(marked.getAttribute('data-unit-total')).toBe(bottleneck.getAttribute('data-bottleneck'));

    const flow = await open3d('flow');
    await runToEnd(flow);
    expect(flow.el.querySelector('[data-cycle-time]')!.textContent).toBe('00:13.100');
    expect(flow.el.querySelector('[data-throughput]')!.textContent).toBe('274.8');
  });

  it('AC4 gap counts match step 5 and the button opens that screen during a run', async () => {
    const u = await open3d();
    const info = u.el.querySelector('.run-strip')!;
    const total = info.querySelector('[data-gap-total]')!.getAttribute('data-gap-total');
    const kinds = [...info.querySelectorAll('[data-gap-kind]')].map((node) => [node.getAttribute('data-gap-kind'), node.getAttribute('data-gap-count'), node.textContent]);
    const clock = holdRuntimeClock();
    try {
      await u.click(u.btn('▶ 실행'));
      expect(u.el.querySelector('[data-run-status]')!.getAttribute('data-run-status')).toBe('running');
      expect(u.el.querySelector('[data-gap-total]')!.getAttribute('data-gap-total')).toBe(total);
      await u.click(u.btn('5단계에서 보기'));
    } finally {
      clock.restore();
    }
    expect(u.el.querySelector('.app')!.getAttribute('data-step')).toBe('check');
    expect(u.el.querySelector('.app')!.getAttribute('data-screen')).toBe('S50');
    expect(u.el.querySelector('h1')!.textContent).toContain('Gap');
    const tab = [...u.el.querySelectorAll('.subtabs button')].find((b) => (b.textContent ?? '').startsWith('Gap (F6)'))!;
    expect(tab.textContent).toContain(total);
    for (const [kind, count, text] of kinds) {
      expect(text).toBe(`${GAP_KIND_LABEL[kind as keyof typeof GAP_KIND_LABEL]} ${count}`);
      const badge = [...u.el.querySelectorAll('.badge')].find((node) => node.textContent === text);
      expect(badge).toBeTruthy();
    }
    expect(Number(total)).toBeGreaterThan(0);
  });

  it('AC5 a timeout edit changes the model, one undo restores it, and step 3 shows the same value', async () => {
    const u = await open3d();
    expect(u.el.querySelector('.work-rev')!.textContent).toContain('rev 1');
    const input = () => u.el.querySelector('[aria-label="S1 푸셔 투입 타임아웃 숫자"]') as HTMLInputElement;
    expect(input().value).toBe('3');
    const row = input().closest('[data-field="timeout"]')!;
    expect(row.textContent).toContain('가정');
    await setNumber(input(), '2');
    await setNumber(u.el.querySelector('[aria-label="S1 푸셔 투입 타임아웃 숫자"]') as HTMLInputElement, '1.2');
    expect(u.el.querySelector('.work-rev')!.textContent).toContain('rev 2');
    expect(input().value).toBe('1.2');
    await u.click(u.el.querySelector('[data-tree-id="PSH-01"]')!);
    await u.click(u.el.querySelector('.stepper [data-stepid="attributes"]')!);
    await u.click([...u.el.querySelectorAll('button')].find((b) => (b.textContent ?? '').startsWith('Action '))!);
    const name = [...u.el.querySelectorAll('input')].find((node) => (node as HTMLInputElement).value === 'S1 푸셔 투입')!;
    const timeout = [...name.closest('.section')!.querySelectorAll('input.num')][1] as HTMLInputElement;
    expect(timeout.value).toBe('1.2');
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    await u.click(u.el.querySelector('[aria-label="실행 취소"]')!);
    expect(u.el.querySelector('.work-rev')!.textContent).toContain('rev 1');
    expect((u.el.querySelector('[aria-label="S1 푸셔 투입 타임아웃 숫자"]') as HTMLInputElement).value).toBe('3');
  });

  it('AC6 a shorter timeout warns and stops on TIMEOUT, and an equal timeout warns without stopping', async () => {
    const u = await open3d();
    const input = () => u.el.querySelector('[aria-label="S1 푸셔 투입 타임아웃 숫자"]') as HTMLInputElement;
    await setNumber(input(), '0.8');
    const equalWarn = [...u.el.querySelectorAll('[data-timeout-warn]')].find((node) => node.textContent === TIMEOUT_EQUAL);
    expect(equalWarn).toBeTruthy();
    expect([...u.el.querySelectorAll('[data-timeout-warn]')].some((node) => node.textContent === TIMEOUT_WARN)).toBe(false);
    await runToEnd(u);
    expect(u.el.querySelector('[data-run-status]')!.getAttribute('data-run-status')).toBe('completed');
    expect(u.el.querySelector('[data-run-time]')!.textContent).toBe('00:11.100');
    await u.click(u.btn('도면'));
    await u.click(u.btn('자세히'));
    await u.click(u.el.querySelector('#run-detail-tab-log')!);
    expect(u.el.querySelector('.log-list')!.textContent).not.toContain('TIMEOUT');
    await u.click(u.btn('3D'));
    await u.click(u.btn('⟲ 초기화'));
    await setNumber(u.el.querySelector('[aria-label="S1 푸셔 투입 타임아웃 숫자"]') as HTMLInputElement, '0.5');
    expect([...u.el.querySelectorAll('[data-timeout-warn]')].some((node) => node.textContent === TIMEOUT_WARN)).toBe(true);
    expect([...u.el.querySelectorAll('[data-timeout-warn]')].some((node) => node.textContent === TIMEOUT_EQUAL)).toBe(false);
    await runToEnd(u);
    expect(u.el.querySelector('[data-run-status]')!.getAttribute('data-run-status')).toBe('error');
    expect(u.el.querySelector('[data-throughput]')!.textContent).toBe('—');
    const failed = [...u.el.querySelectorAll('.run3d-bars [data-step-id]')].find((node) => node.textContent?.includes('오류'));
    expect(failed).toBeTruthy();
    expect(failed!.textContent).toContain('S1 푸셔 투입');
    await u.click(u.btn('도면'));
    expect(u.el.textContent).toContain('TIMEOUT');
  });

  it('AC7 timeout locks while running, and revert restores duration and timeout only', async () => {
    const u = await open3d();
    const clock = holdRuntimeClock();
    try {
      await u.click(u.btn('▶ 실행'));
      const timeout = u.el.querySelector('[aria-label="S1 푸셔 투입 타임아웃 숫자"]') as HTMLInputElement;
      const range = u.el.querySelector('[aria-label="S1 푸셔 투입 타임아웃"]') as HTMLInputElement;
      expect(timeout.disabled).toBe(true);
      expect(range.disabled).toBe(true);
      expect(u.el.querySelector('[data-timeout-locked]')!.textContent).toContain('타임아웃');
      expect(u.el.querySelector('[data-duration-locked]')!.textContent).toContain('동작 시간');
      await u.click(u.btn('❚❚ 일시정지'));
      expect((u.el.querySelector('[aria-label="S1 푸셔 투입 타임아웃 숫자"]') as HTMLInputElement).disabled).toBe(true);
    } finally {
      clock.restore();
    }
    await u.click(u.btn('⟲ 초기화'));
    const fault = [...u.el.querySelectorAll('.run-conditions label')].find((label) => (label.textContent ?? '').includes('결과 실패'))!.querySelector('input')!;
    await u.click(fault);
    await setNumber(u.el.querySelector('[aria-label="S1 푸셔 투입 동작 시간 숫자"]') as HTMLInputElement, '1.5');
    await setNumber(u.el.querySelector('[aria-label="S1 푸셔 투입 타임아웃 숫자"]') as HTMLInputElement, '0.4');
    await setNumber(u.el.querySelector('[aria-label="S5 컨베이어 배출 타임아웃 숫자"]') as HTMLInputElement, '1');
    await u.click(u.btn('이 화면에 들어온 뒤 바꾼 값 되돌리기'));
    expect((u.el.querySelector('[aria-label="S1 푸셔 투입 동작 시간 숫자"]') as HTMLInputElement).value).toBe('0.8');
    expect((u.el.querySelector('[aria-label="S1 푸셔 투입 타임아웃 숫자"]') as HTMLInputElement).value).toBe('3');
    expect((u.el.querySelector('[aria-label="S5 컨베이어 배출 타임아웃 숫자"]') as HTMLInputElement).value).toBe('5');
    const still = [...u.el.querySelectorAll('.run-conditions label')].find((label) => (label.textContent ?? '').includes('결과 실패'))!.querySelector('input') as HTMLInputElement;
    expect(still.checked).toBe(true);
  });

  it('AC8 new numbers and buttons have labels, and the narrow column wraps instead of clipping', async () => {
    const u = await open3d();
    const info = u.el.querySelector('.run-strip')!;
    expect(info.querySelector('[data-cycle-time]')!.getAttribute('aria-label')).toBe('사이클 시간');
    expect(info.querySelector('[data-throughput]')!.getAttribute('aria-label')).toBe('시간당 생산량');
    expect(info.querySelector('[aria-label="병목 Unit"]')).not.toBeNull();
    expect(info.querySelector('[aria-label="Gap 건수"]')).not.toBeNull();
    expect(info.querySelector('[aria-label="5단계에서 보기"]')!.textContent).toBe('5단계에서 보기');
    expect(u.el.querySelector('[aria-label="S1 푸셔 투입 타임아웃"]')).not.toBeNull();
    expect(u.el.querySelector('[aria-label="S1 푸셔 투입 타임아웃 숫자"]')).not.toBeNull();
    const css = readFileSync('src/ui/run3d.css', 'utf8');
    expect(css).toMatch(/\.run3d-metric\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/\.run3d-gap-kinds li\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/\.run3d-timeout-warn\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/\.run3d-gap-open\s*\{[^}]*white-space:\s*nowrap/);
    expect(css).toContain('grid-template-columns: 232px minmax(0, 1fr) 248px');
    const name = u.el.querySelector('.run-steps .run3d-bars.units .run3d-bar-name') as HTMLElement;
    expect(getComputedStyle(name).overflowWrap).toBe('anywhere');
  });
});
