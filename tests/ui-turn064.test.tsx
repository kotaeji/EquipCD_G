// @vitest-environment jsdom
// TURN-064: timing chart tab. Bars, grouping, focus, and the summary highlight.
import { readFileSync } from 'node:fs';
import { useState, type ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import { advance, createRuntime, runToEnd, start, type RuntimeState } from '../src/runtime/engine';
import { summarizeRun } from '../src/runtime/runSummary';
import { chartPlotWidth } from '../src/runtime/timingChart';
import { App } from '../src/ui/App';
import { RunDetails } from '../src/ui/RunDetails';
import { STATUS } from '../src/ui/status';
import type { RunDetailsTab } from '../src/ui/viewSettings';
import { holdRuntimeClock } from './holdRuntimeClock';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  localStorage.clear();
});

async function mount(sample?: 'parallel') {
  localStorage.clear();
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(<App />); });
  const click = async (node: Element) => { await act(async () => { (node as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
  const btn = (label: string) => [...el.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label || b.getAttribute('aria-label') === label) as HTMLButtonElement;
  if (sample === 'parallel') await click(btn('병렬 예제'));
  else await click(btn('시작하기'));
  const step = el.querySelector('.stepper [data-stepid="run"]')!;
  if (el.querySelector('.app')!.getAttribute('data-step') !== 'run') await click(step);
  return { el, click, btn };
}

function Host({ p, rt, onRun }: { p: ReturnType<typeof buildSampleProject>; rt: RuntimeState | null; onRun?: () => void }) {
  const [tab, setTab] = useState<RunDetailsTab>('timing');
  return <RunDetails p={p} rt={rt} open tab={tab} onToggle={() => {}} onTab={setTab} onRun={onRun} />;
}

async function paint(node: ReactNode) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(node); });
  const click = async (nodeEl: Element) => { await act(async () => { (nodeEl as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
  return { el, click };
}

describe('TURN-064 timing chart', () => {
  it('AC6 shows the empty state before a run and leaves the sample times alone', async () => {
    const u = await mount();
    await u.click(u.btn('자세히 펼치기'));
    await u.click(u.el.querySelector('#run-detail-tab-timing')!);
    const empty = u.el.querySelector('[data-timing-empty]')!;
    expect(empty.textContent).toContain('실행 기록이 없습니다');
    expect([...empty.querySelectorAll('button')].some((b) => (b.textContent ?? '').trim() === '실행')).toBe(true);
    const clock = holdRuntimeClock();
    try {
      await u.click(u.btn('▶ 실행'));
      await u.click(u.btn('끝까지'));
    } finally { clock.restore(); }
    expect(u.el.querySelector('[data-run-time]')!.textContent).toBe('00:11.100');
    const parallel = await mount('parallel');
    const pclock = holdRuntimeClock();
    try {
      await parallel.click(parallel.btn('▶ 실행'));
      await parallel.click(parallel.btn('끝까지'));
    } finally { pclock.restore(); }
    expect(parallel.el.querySelector('[data-run-time]')!.textContent).toBe('00:02.500');
  });

  it('AC1 AC2 AC4 AC5 AC7 places bars, switches rows, reads focus, and highlights the summary', async () => {
    const p = buildSampleProject();
    const done = runToEnd(createRuntime(p));
    const sum = summarizeRun(p, done.state);
    const view = await paint(<Host p={p} rt={done.state} />);
    const rows = [...view.el.querySelectorAll('[data-timing-row]')].map((node) => node.getAttribute('data-timing-row'));
    expect(rows).toEqual(p.units.map((unit) => unit.id));
    const bars = [...view.el.querySelectorAll('[data-timing-bar]')].filter((node) => !node.getAttribute('data-hatch'));
    expect(bars).toHaveLength(12);
    for (const bar of bars) {
      const step = sum.steps[Number(bar.getAttribute('data-summary-index'))];
      expect(bar.getAttribute('data-start-ms')).toBe(String(step.startMs));
      expect(bar.getAttribute('data-end-ms')).toBe(String(step.endMs));
    }
    expect(view.el.querySelector('[data-timing-lane="piece"]')).toBeNull();
    await view.click(view.el.querySelector('[data-timing-lane="device"]')!);
    expect(view.el.querySelector('.timing-chart')!.getAttribute('data-timing-lane')).toBe('device');
    const deviceRows = new Set([...view.el.querySelectorAll('[data-timing-row]')].map((node) => node.getAttribute('data-timing-row')));
    expect(deviceRows.size).toBeGreaterThan(5);

    const first = view.el.querySelector('[data-timing-bar]') as SVGGElement;
    await act(async () => { first.focus(); });
    const tip = view.el.querySelector('[data-timing-tip]')!;
    const step = sum.steps[Number(first.getAttribute('data-summary-index'))];
    expect(tip.textContent).toContain(step.name);
    expect(tip.textContent).toContain('시작');
    expect(tip.textContent).toContain('끝');
    expect(tip.textContent).toContain('걸린 시간');
    await view.click(first);
    expect(view.el.querySelector('#run-detail-tab-summary')!.getAttribute('aria-selected')).toBe('true');
    const picked = view.el.querySelector('.run-summary-table tr.is-chart-pick')!;
    expect(picked.getAttribute('data-step-id')).toBe(step.stepId);
    expect(picked.textContent).toContain('차트');

    const width = Number(view.el.querySelector('[data-plot-w]')!.getAttribute('data-plot-w'));
    expect(width).toBe(chartPlotWidth(sum.totalMs!, 1));
    expect(width).toBe(400);
    await view.click(view.el.querySelector('[aria-label="확대"]')!);
    const zoomed = Number(view.el.querySelector('[data-plot-w]')!.getAttribute('data-plot-w'));
    expect(zoomed).toBe(chartPlotWidth(sum.totalMs!, 2));
    expect(zoomed).toBe(800);
    expect(readFileSync('src/ui/timing-chart.css', 'utf8')).toContain('overflow: auto');

    const parallel = buildParallelSampleProject();
    const both = runToEnd(createRuntime(parallel));
    await act(async () => { root!.render(<Host p={parallel} rt={both.state} />); });
    const ranges = [...view.el.querySelectorAll('[data-timing-bar]')]
      .filter((node) => !node.getAttribute('data-hatch'))
      .map((node) => [Number(node.getAttribute('data-start-ms')), Number(node.getAttribute('data-end-ms'))]);
    expect(ranges.some((a, i) => ranges.slice(i + 1).some((b) => a[0] < b[1] && b[0] < a[1]))).toBe(true);
  });

  it('AC3 shows a hatch for waits and a status mark for error and stop', async () => {
    const waiting = buildParallelSampleProject();
    waiting.sequence.steps = [];
    waiting.sequence.flow = [{
      kind: 'wait', id: 'FLW-WAIT', name: '도착 기다림',
      cond: { kind: 'signal', signalId: waiting.signals[0].id, equals: true },
      timeout: { value: 2, unit: 's', assumption: true },
    }];
    const held = advance(start(createRuntime(waiting)), 40);
    const view = await paint(<Host p={waiting} rt={held.state} />);
    const hatch = view.el.querySelector('[data-hatch="signal"]')!;
    expect(hatch.querySelector('[data-mark]')!.textContent).toBe(STATUS.pending.mark);
    expect(view.el.querySelector('[data-timing-now]')).not.toBeNull();

    const parallel = buildParallelSampleProject();
    const rising = parallel.actions.find((action) => action.name === 'A 클램프 상승')!;
    rising.timeout = { ...rising.timeout, value: 0.2 };
    parallel.simSettings.faults.neverTrueSignalIds = [rising.completeSignalId!];
    const failed = runToEnd(createRuntime(parallel));
    await act(async () => { root!.render(<Host p={parallel} rt={failed.state} />); });
    expect(view.el.querySelector('[data-status="error"] [data-mark]')!.textContent).toBe(STATUS.error.mark);
    expect(view.el.querySelector('[data-status="stopped"] [data-mark]')!.textContent).toBe(STATUS.assumption.mark);

    const many = buildSampleProject();
    many.materials[0].feedCount = 2;
    many.materials[0].feedInterval = { ...many.materials[0].feedInterval, value: 0 };
    const multi = runToEnd(createRuntime(many));
    await act(async () => { root!.render(<Host p={many} rt={multi.state} />); });
    expect(view.el.querySelector('[data-hatch="standby"]')).not.toBeNull();
    expect(view.el.querySelector('[data-timing-lane="piece"]')).not.toBeNull();
    await view.click(view.el.querySelector('[data-timing-lane="piece"]')!);
    expect(view.el.querySelector('.timing-chart')!.getAttribute('data-timing-lane')).toBe('piece');
    const numbers = [...view.el.querySelectorAll('[data-piece-num]')].map((node) => node.getAttribute('data-piece-num'));
    expect(numbers).toContain('1');
    expect(numbers).toContain('2');
  });
});
