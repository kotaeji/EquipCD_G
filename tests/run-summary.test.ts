import { describe, expect, it } from 'vitest';
import { buildSampleProject } from '../src/model/sample';
import { advance, createRuntime, pause, runToEnd, start } from '../src/runtime/engine';
import { summarizeRun } from '../src/runtime/runSummary';

const sample = () => buildSampleProject();

describe('summarizeRun — 5공정 완료 (AC1)', () => {
  it('step bounds match the engine, total is last end − first start, and the earliest longest step wins a tie', () => {
    const p = sample();
    const rt = runToEnd(createRuntime(p));
    const sum = summarizeRun(p, rt.state);
    expect(rt.state.status).toBe('completed');
    expect(sum.steps.map((s) => [s.stepId, s.startMs, s.endMs])).toEqual(
      rt.state.steps.map((s) => [s.stepId, s.startMs ?? null, s.endMs ?? null]),
    );
    const first = rt.state.steps[0].startMs!;
    const last = rt.state.steps[rt.state.steps.length - 1].endMs!;
    expect(sum.totalMs).toBe(last - first);
    expect(sum.totalMs).toBe(11100);
    expect(sum.finishedCount).toBe(12);
    expect(sum.totalCount).toBe(12);
    expect(sum.aborted).toBe(false);
    const elapsed = rt.state.steps.map((s) => s.endMs! - s.startMs!);
    const max = Math.max(...elapsed);
    const idx = elapsed.indexOf(max);
    expect(sum.longest).toEqual({
      stepId: rt.state.steps[idx].stepId,
      name: p.sequence.steps[idx].name,
      elapsedMs: max,
    });
    expect(sum.longest?.name).toBe('S3 가공 실린더 전진(가상 작업)');
    expect(sum.longest?.elapsedMs).toBe(2000);
    expect(sum.steps.every((s) => s.status === 'done' && s.elapsedMs === s.endMs! - s.startMs!)).toBe(true);
  });
});

describe('summarizeRun — 타임아웃 (AC2)', () => {
  it('marks the timed-out step as error, later steps as pending, and flags the run aborted', () => {
    const p = sample();
    const bcr = p.actions.find((a) => a.deviceId === 'BCR-02')!;
    p.simSettings.faults.neverTrueSignalIds = [bcr.completeSignalId!];
    const rt = runToEnd(createRuntime(p));
    const sum = summarizeRun(p, rt.state);
    expect(rt.state.status).toBe('error');
    expect(rt.state.error?.code).toBe('TIMEOUT');
    const err = sum.steps.find((s) => s.stepId === 'STEP-03')!;
    expect(err.status).toBe('error');
    expect(err.startMs).toBe(1100);
    expect(err.endMs).toBe(3100);
    expect(err.elapsedMs).toBe(2000);
    expect(sum.steps.slice(0, 2).every((s) => s.status === 'done')).toBe(true);
    expect(sum.steps.slice(3).every((s) => s.status === 'pending' && s.startMs === null && s.endMs === null && s.elapsedMs === null)).toBe(true);
    expect(sum.aborted).toBe(true);
    expect(sum.totalMs).toBe(3100);
    expect(sum.finishedCount).toBe(3);
    expect(sum.totalCount).toBe(12);
    expect(sum.longest?.stepId).toBe('STEP-03');
  });
});

describe('summarizeRun — 진행 중 · 일시정지 (AC3)', () => {
  it('fills finished steps and leaves the active step end and elapsed empty, paused or not', () => {
    let rt = start(createRuntime(sample()));
    rt = advance(rt, 6500);
    expect(rt.state.steps.find((s) => s.status === 'active')?.stepId).toBe('STEP-08');
    const running = summarizeRun(rt.snapshot, rt.state);
    rt = pause(rt);
    const paused = summarizeRun(rt.snapshot, rt.state);
    for (const sum of [running, paused]) {
      expect(sum.aborted).toBe(false);
      expect(sum.finishedCount).toBe(7);
      expect(sum.totalCount).toBe(12);
      expect(sum.totalMs).toBe(6100);
      const active = sum.steps.find((s) => s.stepId === 'STEP-08')!;
      expect(active.status).toBe('active');
      expect(active.startMs).toBe(6100);
      expect(active.endMs).toBeNull();
      expect(active.elapsedMs).toBeNull();
      expect(sum.steps.slice(0, 7).every((s) => s.status === 'done' && s.endMs !== null && s.elapsedMs !== null)).toBe(true);
      expect(sum.steps.slice(8).every((s) => s.status === 'pending' && s.startMs === null && s.endMs === null && s.elapsedMs === null)).toBe(true);
      expect(sum.longest?.stepId).toBe('STEP-06');
      expect(sum.longest?.elapsedMs).toBe(2000);
    }
  });
});

describe('summarizeRun — 실행 전', () => {
  it('returns an empty table of pending steps when there is no runtime', () => {
    const p = sample();
    const sum = summarizeRun(p, null);
    expect(sum.aborted).toBe(false);
    expect(sum.totalMs).toBeNull();
    expect(sum.finishedCount).toBe(0);
    expect(sum.totalCount).toBe(p.sequence.steps.length);
    expect(sum.longest).toBeNull();
    expect(sum.steps.every((s) => s.status === 'pending' && s.startMs === null && s.endMs === null)).toBe(true);
  });
});
