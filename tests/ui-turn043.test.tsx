// @vitest-environment jsdom
// TURN-043: run-result gaps on step 5, the step badge, and the run strip.
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeGaps } from '../src/model/gaps';
import { buildSampleProject } from '../src/model/sample';
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
    if (!node) throw new Error('missing control');
    await act(async () => { (node as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  };
  const btn = (label: string) => [...el.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label);
  return { el, click, btn };
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

async function openRun() {
  const u = await mount();
  await u.click(u.btn('시작하기'));
  await u.click(u.el.querySelector('.stepper [data-stepid="run"]'));
  return u;
}

async function runToEnd(u: Awaited<ReturnType<typeof openRun>>) {
  const clock = holdRuntimeClock();
  try {
    await u.click(u.btn('▶ 실행'));
    await u.click(u.btn('끝까지'));
  } finally {
    clock.restore();
  }
}

function badgeCount(el: HTMLElement, step: string): number {
  return Number(el.querySelector(`[data-step-badge="${step}"] .st-count`)!.textContent);
}

describe('TURN-043 run-result gap screen', () => {
  it('AC7 before a run the list is empty and shows the hint', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    await u.click(u.el.querySelector('.stepper [data-stepid="check"]'));
    expect(u.el.querySelector('[data-run-gaps]')!.getAttribute('data-run-gaps')).toBe('0');
    expect(u.el.querySelector('[data-run-gap-empty]')!.textContent).toBe('실행하면 여기에 실행 결과 Gap 이 나옵니다');
    expect(u.el.querySelector('[data-run-gap]')).toBeNull();
    expect(u.el.querySelector('[data-run-gap-stale]')).toBeNull();
  });

  it('AC4 AC6 AC9 a finished run fills the list, survives an edit, and counts in the strip and badge', async () => {
    const u = await openRun();
    await setNumber(u.el.querySelector('[aria-label="투입 개수"]') as HTMLInputElement, '5');
    await setNumber(u.el.querySelector('[aria-label="투입 간격"]') as HTMLInputElement, '0');
    const staticTotal = u.el.querySelector('[data-gap-total]')!.getAttribute('data-gap-total');
    const badgeBefore = badgeCount(u.el, 'check');
    await runToEnd(u);
    expect(u.el.querySelector('[data-run-status]')!.getAttribute('data-run-status')).toBe('completed');
    const total = Number(u.el.querySelector('[data-gap-total]')!.getAttribute('data-gap-total'));
    expect(total).toBeGreaterThan(Number(staticTotal));
    const badgeAfter = badgeCount(u.el, 'check');
    expect(badgeAfter - badgeBefore).toBe(total - Number(staticTotal));

    await u.click(u.el.querySelector('[data-step-badge="check"]'));
    expect(u.el.querySelector('.itemspop')!.textContent).toContain('병목 Unit S2 식별');
    await u.click(u.el.querySelector('.stepper [data-stepid="check"]'));
    const block = u.el.querySelector('.run-gap-block')!;
    expect(block.textContent).toContain('병목 Unit S2 식별');
    expect(block.textContent).toContain('기다린 시간 합 13.100 s');
    expect(block.textContent).toContain('사이클 > 투입 간격');
    expect(block.textContent).toContain('실행 결과');
    expect(u.el.querySelector('[data-run-gap-stale]')).toBeNull();
    const tab = [...u.el.querySelectorAll('.subtabs button')].find((b) => (b.textContent ?? '').startsWith('Gap (F6)'))!;
    expect(tab.textContent).toContain(String(total));

    const timing = analyzeGaps(buildSampleProject()).find((g) => g.id === 'timing:cycle:MAT-001')!;
    expect(u.el.textContent).toContain(timing.title);
    expect(u.el.textContent).toContain('정밀 물리 아님');

    await u.click(u.el.querySelector('.stepper [data-stepid="run"]'));
    await setNumber(u.el.querySelector('[aria-label="투입 간격"]') as HTMLInputElement, '1');
    await u.click(u.el.querySelector('.stepper [data-stepid="check"]'));
    expect(u.el.querySelector('[data-run-gap-stale]')!.textContent).toBe('이전 rev 의 실행 결과');
    expect(u.el.querySelector('[data-run-gap="run:bottleneck:U-S2"]')).not.toBeNull();

    await u.click(u.el.querySelector('.stepper [data-stepid="run"]'));
    await runToEnd(u);
    await u.click(u.el.querySelector('.stepper [data-stepid="check"]'));
    expect(u.el.querySelector('[data-run-gap-stale]')).toBeNull();
    expect(u.el.querySelector('[data-run-gap="run:bottleneck:U-S2"]')).not.toBeNull();

    await u.click(u.btn('저장'));
    const saved = localStorage.getItem('ecd.v1.project.prj-sample-5step') ?? '';
    expect(saved.length).toBeGreaterThan(0);
    expect(saved).not.toContain('run:bottleneck');
    expect(saved).not.toContain('fromRun');
    expect(saved).toContain('timing:cycle:MAT-001');
  });

  it('AC4 이동 from a timeout gap opens that action timeout field', async () => {
    const u = await openRun();
    const select = [...u.el.querySelectorAll('select')].find((node) => (node.textContent ?? '').includes('완료 신호 미발생')) as HTMLSelectElement;
    const option = [...select.options].find((o) => (o.textContent ?? '').includes('S1 푸셔 투입'))!;
    await act(async () => {
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await runToEnd(u);
    expect(u.el.querySelector('[data-run-status]')!.getAttribute('data-run-status')).toBe('error');
    await u.click(u.el.querySelector('.stepper [data-stepid="check"]'));
    const row = u.el.querySelector('[data-run-gap^="run:error:"]')!;
    expect(row.textContent).toContain('S1 푸셔 투입');
    expect(row.textContent).toContain('타임아웃');
    const bar = () => u.el.querySelector('.statusbar')!.textContent ?? '';
    const rev = () => /rev (\d+)/.exec(bar())![1];
    const undo = () => /Undo (\d+)/.exec(bar())![1];
    const before = { rev: rev(), undo: undo() };
    await u.click(row.querySelector('button'));
    expect(u.el.querySelector('.app')!.getAttribute('data-step')).toBe('attributes');
    expect(u.el.querySelector('h1')!.textContent).toContain('Action 정의');
    expect(u.el.querySelector('[data-tree-id="PSH-01"]')!.getAttribute('aria-selected')).toBe('true');
    const flash = u.el.querySelector('.jump-flash') as HTMLElement;
    expect(flash.getAttribute('data-jump')).toMatch(/^timeout:/);
    expect(flash.textContent).toContain('타임아웃');
    expect(document.activeElement).toBe(flash.querySelector('input.num'));
    expect({ rev: rev(), undo: undo() }).toEqual(before);
  });

  it('reset clears the run gaps and brings the hint back', async () => {
    const u = await openRun();
    await setNumber(u.el.querySelector('[aria-label="투입 개수"]') as HTMLInputElement, '5');
    await setNumber(u.el.querySelector('[aria-label="투입 간격"]') as HTMLInputElement, '0');
    await runToEnd(u);
    await u.click(u.btn('⟲ 초기화'));
    await u.click(u.el.querySelector('.stepper [data-stepid="check"]'));
    expect(u.el.querySelector('[data-run-gaps]')!.getAttribute('data-run-gaps')).toBe('0');
    expect(u.el.querySelector('[data-run-gap-empty]')!.textContent).toBe('실행하면 여기에 실행 결과 Gap 이 나옵니다');
  });
});
