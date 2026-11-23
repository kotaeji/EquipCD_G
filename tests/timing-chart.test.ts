import { describe, expect, it } from 'vitest';
import { buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import { advance, createRuntime, runToEnd, start } from '../src/runtime/engine';
import { summarizeRun } from '../src/runtime/runSummary';
import { tickStepMs, timingChart, type TimingBar } from '../src/runtime/timingChart';

function overlaps(a: TimingBar, b: TimingBar): boolean {
  return a !== b && a.startMs < b.drawEndMs && b.startMs < a.drawEndMs;
}

describe('timingChart — 5공정 (AC1)', () => {
  it('puts one bar per finished step on five unit rows, at the summary times', () => {
    const p = buildSampleProject();
    const rt = runToEnd(createRuntime(p));
    const before = JSON.stringify(rt.state);
    const chart = timingChart(p, rt.state, 'unit');
    const sum = summarizeRun(p, rt.state);
    expect(JSON.stringify(rt.state)).toBe(before);
    expect(rt.state.timeMs).toBe(11100);
    expect(chart.empty).toBe(false);
    expect(chart.rows.map((row) => row.label)).toEqual(p.units.map((unit) => unit.name));
    const drawn = chart.bars.filter((bar) => bar.hatch == null);
    expect(drawn).toHaveLength(sum.steps.filter((step) => step.status === 'done').length);
    for (const bar of drawn) {
      const step = sum.steps[bar.summaryIndex];
      expect(bar.stepId).toBe(step.stepId);
      expect(bar.startMs).toBe(step.startMs);
      expect(bar.endMs).toBe(step.endMs);
      expect(bar.status).toBe('done');
    }
    expect(chart.tickStepMs).toBe(2000);
    expect(chart.ticks.map((tick) => tick.label)).toContain('0s');
    expect(chart.nowMs).toBeNull();
    expect(chart.lanes).toEqual(['unit', 'device']);
  });
});

describe('timingChart — 병렬 (AC2)', () => {
  it('overlaps bars that ran at the same time', () => {
    const p = buildParallelSampleProject();
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.timeMs).toBe(2500);
    const chart = timingChart(p, rt.state, 'unit');
    const steps = chart.bars.filter((bar) => bar.hatch == null);
    expect(steps.some((bar, i) => steps.slice(i + 1).some((other) => overlaps(bar, other)))).toBe(true);
    expect(chart.tickStepMs).toBe(500);
    expect(chart.rows.length).toBe(2);
  });
});

describe('timingChart — 눈금', () => {
  it('picks 0.5s, 1s, and 5s from the span', () => {
    expect(tickStepMs(2500)).toBe(500);
    expect(tickStepMs(8000)).toBe(1000);
    expect(tickStepMs(30000)).toBe(5000);
    expect(tickStepMs(11100)).toBe(2000);
  });
});

describe('timingChart — 건너뜀 · 실행 전 (AC6)', () => {
  it('draws nothing before a run and drops skipped rows', () => {
    const p = buildSampleProject();
    expect(timingChart(p, null).empty).toBe(true);
    expect(timingChart(p, createRuntime(p).state).empty).toBe(true);
    const flow = buildSampleProject();
    flow.sequence.flow = flow.sequence.steps.map((step) => ({ kind: 'step', stepId: step.id }));
    const skipped = runToEnd(createRuntime(flow));
    skipped.state.steps.push({ stepId: 'STEP-NO', status: 'skipped' });
    const chart = timingChart(flow, skipped.state, 'unit');
    expect(chart.bars.some((bar) => bar.stepId === 'STEP-NO')).toBe(false);
  });
});

describe('timingChart — 기다림 · 오류 · 정지 · 개체', () => {
  it('hatches a signal wait and a piece standby, and keeps error and stopped', () => {
    const waiting = buildParallelSampleProject();
    const signal = waiting.signals[0];
    waiting.sequence.steps = [];
    waiting.sequence.flow = [{
      kind: 'wait', id: 'FLW-WAIT', name: '도착 기다림',
      cond: { kind: 'signal', signalId: signal.id, equals: true },
      timeout: { value: 2, unit: 's', assumption: true },
    }];
    const held = advance(start(createRuntime(waiting)), 50);
    const waitChart = timingChart(waiting, held.state, 'unit');
    const signalBar = waitChart.bars.find((bar) => bar.hatch === 'signal');
    expect(signalBar?.name).toBe('신호 기다림');
    expect(signalBar?.status).toBe('active');
    expect(signalBar?.startMs).toBe(0);
    expect(waitChart.nowMs).toBe(50);

    const parallel = buildParallelSampleProject();
    const rising = parallel.actions.find((action) => action.name === 'A 클램프 상승')!;
    rising.timeout = { ...rising.timeout, value: 0.2 };
    parallel.simSettings.faults.neverTrueSignalIds = [rising.completeSignalId!];
    const failed = runToEnd(createRuntime(parallel));
    const failedChart = timingChart(parallel, failed.state, 'device');
    expect(failedChart.bars.some((bar) => bar.status === 'error' && bar.hatch == null)).toBe(true);
    expect(failedChart.bars.some((bar) => bar.status === 'stopped' && bar.hatch == null)).toBe(true);

    const many = buildSampleProject();
    many.materials[0].feedCount = 2;
    many.materials[0].feedInterval = { ...many.materials[0].feedInterval, value: 0 };
    const multi = runToEnd(createRuntime(many));
    const pieces = timingChart(many, multi.state, 'piece');
    expect(pieces.lanes).toContain('piece');
    expect(pieces.lane).toBe('piece');
    expect(pieces.rows.map((row) => row.label)).toEqual(['개체 1', '개체 2']);
    const standby = pieces.bars.filter((bar) => bar.hatch === 'standby');
    expect(standby.length).toBeGreaterThan(0);
    expect(standby.every((bar) => bar.piece === 1 || bar.piece === 2)).toBe(true);
    const unit = timingChart(many, multi.state, 'unit');
    expect(unit.bars.filter((bar) => bar.hatch == null).every((bar) => bar.piece === 1 || bar.piece === 2)).toBe(true);
    expect(unit.rows).toHaveLength(5);
  });
});
