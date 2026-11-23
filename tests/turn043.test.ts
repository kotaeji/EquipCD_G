import { describe, expect, it } from 'vitest';
import { setFeedCount, setQuantity } from '../src/model/commands';
import { analyzeGaps } from '../src/model/gaps';
import { analyzeRunGaps, RUN_STEP_SHARE, steadyCycleMs } from '../src/model/runGaps';
import { buildSampleProject } from '../src/model/sample';
import type { Project } from '../src/model/types';
import { createRuntime, runToEnd } from '../src/runtime/engine';
import { describeRunInfo } from '../src/scene/runInfo';
import { serializeProject } from '../src/storage/fileFormat';
import { runGapJump } from '../src/ui/itemJump';

function fed(p: Project, count: number, interval: number): Project {
  const id = p.materials[0].id;
  const counted = setFeedCount(p, id, count);
  if (!counted.ok) throw new Error(counted.reason);
  const timed = setQuantity(counted.project, { kind: 'material', id, field: 'feedInterval' }, interval, true);
  if (!timed.ok) throw new Error(timed.reason);
  return timed.project;
}

const BASIS = /가상 시각 \d{2}:\d{2}\.\d{3} · 로그 [A-Z_]+ · 단계 \S/;

describe('TURN-043 run-result gaps', () => {
  it('AC1 five pieces at interval 0 name S2 and the wait sum', () => {
    const p = fed(buildSampleProject(), 5, 0);
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.status).toBe('completed');
    const gap = analyzeRunGaps(p, rt.state).find((g) => g.title === '병목 Unit S2 식별');
    expect(gap).toBeTruthy();
    expect(gap!.kind).toBe('timing');
    expect(gap!.fromRun).toBe(true);
    expect(gap!.evidence).toContain('기다린 시간 합 13.100 s');
    expect(gap!.evidence).toMatch(/까닭 .*Unit 가득/);
    expect(gap!.evidence).toMatch(BASIS);
    expect(gap!.fix).toEqual({ to: 'unit', unitId: 'U-S2' });
  });

  it('AC2 cycle exceeds the feed interval only when the steady cycle is longer', () => {
    const tight = fed(buildSampleProject(), 5, 2);
    const tightRun = runToEnd(createRuntime(tight));
    const cycle = steadyCycleMs(tightRun.state.pieces ?? []);
    expect(cycle).not.toBeNull();
    expect(cycle!).toBeGreaterThan(2000);
    const gap = analyzeRunGaps(tight, tightRun.state).find((g) => g.title === '사이클 > 투입 간격');
    expect(gap).toBeTruthy();
    expect(gap!.evidence).toContain(`${(cycle! / 1000).toFixed(3)} s`);
    expect(gap!.evidence).toContain('투입 간격 2.000 s');
    expect(gap!.evidence).toContain('배출 시각');
    expect(gap!.evidence).toMatch(BASIS);
    expect(gap!.fix).toEqual({ to: 'interval', materialId: 'MAT-001' });

    const loose = fed(buildSampleProject(), 5, 20);
    const looseRun = runToEnd(createRuntime(loose));
    expect(analyzeRunGaps(loose, looseRun.state).some((g) => g.title === '사이클 > 투입 간격')).toBe(false);
  });

  it('AC3 a step at or above the share threshold cites both times', () => {
    const plain = buildSampleProject();
    const plainRun = runToEnd(createRuntime(plain));
    expect(analyzeRunGaps(plain, plainRun.state).some((g) => g.id.startsWith('run:share:'))).toBe(false);

    const p = buildSampleProject();
    const cyl = p.actions.find((a) => a.name.includes('가공'))!;
    cyl.duration = { ...cyl.duration, value: 10 };
    cyl.timeout = { ...cyl.timeout, value: 30 };
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.status).toBe('completed');
    const gap = analyzeRunGaps(p, rt.state).find((g) => g.id.startsWith('run:share:'));
    expect(gap).toBeTruthy();
    expect(gap!.title).toContain('통과 시간의 큰 몫');
    expect(gap!.evidence).toContain('단계 시간 10.000 s');
    expect(gap!.evidence).toContain(`통과 시간 ${(rt.state.timeMs / 1000).toFixed(3)} s`);
    expect(gap!.evidence).toMatch(BASIS);
    expect(gap!.assumptions.join(' ')).toContain(`${Math.round(RUN_STEP_SHARE * 100)}%`);
    expect(gap!.fix?.to).toBe('duration');
    const stepMs = 10_000;
    expect(stepMs / rt.state.timeMs).toBeGreaterThanOrEqual(RUN_STEP_SHARE);
  });

  it('AC4 a timeout error names that step and jumps to its timeout field', () => {
    const p = buildSampleProject();
    const action = p.actions.find((a) => a.name === 'S1 푸셔 투입')!;
    p.simSettings.faults.neverTrueSignalIds = [action.completeSignalId!];
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.status).toBe('error');
    expect(rt.state.error?.code).toBe('TIMEOUT');
    const gap = analyzeRunGaps(p, rt.state).find((g) => g.id.startsWith('run:error:'));
    expect(gap).toBeTruthy();
    expect(gap!.title).toContain('S1 푸셔 투입');
    expect(gap!.title).toContain('타임아웃');
    expect(gap!.evidence).toContain('TIMEOUT');
    expect(gap!.evidence).toMatch(BASIS);
    expect(gap!.fix).toEqual({ to: 'timeout', actionId: action.id, deviceId: action.deviceId });
    expect(runGapJump(gap!.fix!)).toMatchObject({
      step: 'attributes', rightTab: 'actions', actionId: action.id, field: `timeout:${action.id}`, selectId: 'PSH-01',
    });
  });

  it('AC5 one piece with no wait does not invent a bottleneck unit', () => {
    const p = buildSampleProject();
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.pieces).toBeUndefined();
    expect(rt.state.steps.some((s) => (s.waitMs ?? 0) > 0)).toBe(false);
    expect(analyzeRunGaps(p, rt.state).some((g) => g.title.startsWith('병목 Unit'))).toBe(false);
    expect(analyzeRunGaps(p, null)).toEqual([]);
    const running = createRuntime(p);
    running.state.status = 'running';
    expect(analyzeRunGaps(p, running.state)).toEqual([]);
  });

  it('AC8 run gaps stay out of the project file and static gaps keep their wording', () => {
    const p = fed(buildSampleProject(), 5, 0);
    const before = analyzeGaps(p).map((g) => ({ id: g.id, title: g.title, evidence: g.evidence }));
    const rt = runToEnd(createRuntime(p));
    const runGaps = analyzeRunGaps(p, rt.state);
    expect(runGaps.length).toBeGreaterThan(0);
    const after = analyzeGaps(p).map((g) => ({ id: g.id, title: g.title, evidence: g.evidence }));
    expect(after).toEqual(before);
    expect(before.some((g) => g.id === 'timing:cycle:MAT-001')).toBe(true);
    expect(before.find((g) => g.id === 'timing:cycle:MAT-001')!.evidence).toMatch(/정밀 물리 아님/);
    const file = serializeProject(p);
    expect(file).not.toContain('run:bottleneck');
    expect(file).not.toContain('run:cycle');
    expect(file).not.toContain('run:share');
    expect(file).not.toContain('run:error');
    expect(file).not.toContain('fromRun');
    const info = describeRunInfo(p, rt.state);
    expect(info.gapTotal).toBe(before.length + runGaps.length);
  });
});
