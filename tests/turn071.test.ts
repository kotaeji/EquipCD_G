import { describe, expect, it } from 'vitest';
import { setFeedCount, setQuantity } from '../src/model/commands';
import { emptyProject, instantiateDevice, makeUnit } from '../src/model/factory';
import { analyzeRunGaps } from '../src/model/runGaps';
import { buildFlowSampleProject, buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import { q, RUNTIME_RULES_VERSION, type Action, type FlowNode, type Project, type SequenceStep } from '../src/model/types';
import { checkRunReadiness } from '../src/model/validate';
import { advance, createRuntime, pause, reset, resume, runToEnd, start } from '../src/runtime/engine';
import { describeRunInfo, steadyCycleMs } from '../src/scene/runInfo';
import { runErrorProblem } from '../src/ui/problemCopy';

function fed(p: Project, count: number, interval: number): Project {
  const id = p.materials[0].id;
  const counted = setFeedCount(p, id, count);
  if (!counted.ok) throw new Error(counted.reason);
  const timed = setQuantity(counted.project, { kind: 'material', id, field: 'feedInterval' }, interval, true);
  if (!timed.ok) throw new Error(timed.reason);
  return timed.project;
}

function readAction(p: Project) {
  return p.actions.find((a) => a.kind === 'read')!;
}

function clearMotion(a: Action, dur: number, timeout: number) {
  a.pre = [];
  a.post = [];
  a.effect = {};
  a.duration = { ...a.duration, value: dur, assumption: true };
  a.timeout = { ...a.timeout, value: timeout, assumption: true };
}

const stepOf = (id: string, name: string, actionId: string): SequenceStep =>
  ({ id, name, actionId, timeoutOverride: null, entry: [], origin: 'sample' });

describe('TURN-071 multi-piece flow', () => {
  it('AC1 a flow example with three pieces passes the gate and finishes', () => {
    const p = fed(buildFlowSampleProject(), 3, 0);
    const ready = checkRunReadiness(p);
    expect(ready.blockers.some((b) => b.code === 'MULTI_FLOW')).toBe(false);
    expect(ready.ok).toBe(true);
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.status).toBe('completed');
    expect(rt.state.error).toBeNull();
    expect(rt.state.pieces).toHaveLength(3);
    expect(rt.state.pieces?.every((pc) => pc.phase === 'done' && pc.material.location === 'EXIT')).toBe(true);
    expect(rt.state.log.some((l) => l.code === 'RUN_COMPLETE' && l.message.includes('개체 3개'))).toBe(true);
  });

  it('AC2 the first failed read sends only that piece down the other branch', () => {
    const p = fed(buildFlowSampleProject(), 3, 0);
    const flow = p.sequence.flow ?? [];
    const retryAt = flow.findIndex((n) => n.kind === 'retry');
    const retry = flow[retryAt];
    if (retry?.kind !== 'retry') throw new Error('retry');
    flow[retryAt] = retry.body[0];
    const read = readAction(p);
    p.simSettings.faults.readFailActionIds = [read.id];
    p.simSettings.faults.readFailFirstN = { [read.id]: 1 };
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.status).toBe('completed');
    const branches = rt.state.log.filter((l) => l.code === 'BRANCH_TAKEN').map((l) => l.message);
    expect(branches).toHaveLength(3);
    expect(branches[0]).toContain('개체 1');
    expect(branches[0]).toContain('거짓');
    expect(branches[1]).toContain('개체 2');
    expect(branches[1]).toContain('참');
    expect(branches[2]).toContain('개체 3');
    expect(branches[2]).toContain('참');
    const ng = (id: string) => rt.state.steps.find((s) => s.stepId === 'STEP-NG' && s.instanceId === id);
    expect(ng('MAT-001#1')?.status).toBe('done');
    expect(ng('MAT-001#2')?.status).toBe('skipped');
    expect(ng('MAT-001#3')?.status).toBe('skipped');
    expect(rt.state.pieces?.[0].material.state).toBe('식별실패');
    expect(rt.state.pieces?.[1].material.state).toBe('배출 완료');
    expect(rt.state.pieces?.[2].material.state).toBe('배출 완료');
  });

  it('AC3 a piece joins its lanes before the next piece enters the unit', () => {
    const p = fed(buildFlowSampleProject(), 3, 0);
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.status).toBe('completed');
    const log = rt.state.log;
    for (const index of [1, 2, 3]) {
      const laneDone = log.filter((l) => l.code === 'STEP_DONE' && l.message.includes(`개체 ${index} · 갈래`));
      const join = log.find((l) => l.code === 'PAR_JOIN' && l.message.startsWith(`개체 ${index} `) && l.message.includes('이송'));
      expect(laneDone.length).toBeGreaterThan(0);
      expect(join?.t).toBe(Math.max(...laneDone.map((l) => l.t)));
      const after = log.find((l) => l.code === 'STEP_START' && l.message.includes(`개체 ${index} S5 스토퍼 하강`));
      expect(after && join && after.t >= join.t).toBe(true);
    }
    const waited = log.find((l) => l.code === 'WAIT' && l.message.includes('개체 2') && l.message.includes('Unit 가득'));
    const fed2 = log.find((l) => l.code === 'FEED' && l.message.includes('개체 2'));
    expect(waited).toBeTruthy();
    expect(fed2 && waited && fed2.t > waited.t).toBe(true);
    expect(rt.state.pieces?.[1].waitMs).toBeGreaterThan(0);
  });

  it('AC4 loop, retry, and signal wait are judged per piece', () => {
    const looped = runToEnd(createRuntime(fed(buildFlowSampleProject(), 3, 0)));
    const process = buildFlowSampleProject().sequence.steps.find((s) => s.name.includes('가공'))!;
    const passes = looped.state.steps.filter((s) => s.stepId === process.id && s.status === 'done');
    expect(passes).toHaveLength(6);
    for (const id of ['MAT-001#1', 'MAT-001#2', 'MAT-001#3']) {
      expect(passes.filter((s) => s.instanceId === id).map((s) => s.pass)).toEqual([1, 2]);
    }

    const retryP = fed(buildFlowSampleProject(), 3, 0);
    const read = readAction(retryP);
    retryP.simSettings.faults.readFailActionIds = [read.id];
    retryP.simSettings.faults.readFailFirstN = { [read.id]: 1 };
    const retried = runToEnd(createRuntime(retryP));
    expect(retried.state.status).toBe('completed');
    const retries = retried.state.log.filter((l) => l.code === 'RETRY').map((l) => l.message);
    expect(retries).toEqual([expect.stringContaining('개체 1 읽기 재시도 1/2')]);
    expect(retried.state.log.some((l) => l.code === 'RETRY_EXHAUSTED')).toBe(false);

    const base = buildSampleProject();
    const used = new Set(base.sequence.steps.map((s) => s.actionId));
    const slowA = base.actions.find((a) => a.deviceId === 'CYL-01')!;
    const otherA = base.actions.find((a) => a.deviceId === 'STP-05' && !used.has(a.id))!;
    clearMotion(slowA, 2, 4);
    clearMotion(otherA, 0.2, 2);
    const slow = stepOf('STEP-SLOW', '느린 단계', slowA.id);
    const after = stepOf('STEP-AFTER', '다음 단계', otherA.id);
    base.sequence.steps = [slow, after];
    const wait: FlowNode = {
      kind: 'wait', id: 'FLW-WAIT', name: '신호 기다림',
      cond: { kind: 'signal', signalId: slowA.completeSignalId!, equals: true },
      timeout: { value: 8, unit: 's', assumption: true },
    };
    base.sequence.flow = [{
      kind: 'parallel', id: 'FLW-P', name: '나란히',
      lanes: [[{ kind: 'step', stepId: slow.id }], [wait, { kind: 'step', stepId: after.id }]],
    }];
    const startId = base.materials[0].initialLocation!;
    const unit = base.units.find((u) => u.id === startId)!;
    unit.capacity.maxMaterials = q(2, 'ea', true);
    const waited = fed(base, 2, 0);
    expect(checkRunReadiness(waited).ok).toBe(true);
    const rt = runToEnd(createRuntime(waited));
    expect(rt.state.status).toBe('completed');
    const ends = rt.state.steps.filter((s) => s.waitBlockId === 'FLW-WAIT').map((s) => ({ id: s.instanceId, end: s.endMs }));
    expect(ends).toEqual([
      { id: 'MAT-001#1', end: 2000 },
      { id: 'MAT-001#2', end: 4000 },
    ]);
    const afterRows = rt.state.steps.filter((s) => s.stepId === after.id);
    expect(afterRows.map((s) => s.startMs)).toEqual([2000, 4000]);
  });

  it('AC5 the summary names each piece and publishes cycle, throughput, bottleneck, and run gaps', () => {
    const p = fed(buildFlowSampleProject(), 3, 0);
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.pieces?.map((pc) => pc.exitedAtMs)).toEqual([13100, 19600, 26100]);
    expect(steadyCycleMs(rt.state.pieces ?? [])).toBe(6500);
    const info = describeRunInfo(p, rt.state);
    expect(info.cycleText).toBe('00:06.500');
    expect(info.throughputText).toBe('553.8');
    expect(info.metricBasis).toBe('정상 상태(가정)');
    expect(info.bottleneck?.name).toContain('S2');
    expect(info.bottleneck?.timeText).toBe('00:07.700');
    expect(info.pieceRows?.map((row) => row.index)).toEqual([1, 2, 3]);
    expect(rt.state.steps.some((s) => s.lane?.includes('개체 1') && s.instanceId === 'MAT-001#1')).toBe(true);
    const gaps = analyzeRunGaps(p, rt.state);
    expect(gaps.map((g) => g.title)).toEqual([
      '병목 Unit S2 식별',
      '사이클 > 투입 간격',
      expect.stringContaining('통과 시간의 큰 몫'),
    ]);
  });

  it('AC6 one piece and a flat multi-piece run keep their previous results', () => {
    expect(runToEnd(createRuntime(buildSampleProject())).state.timeMs).toBe(11100);
    expect(runToEnd(createRuntime(buildParallelSampleProject())).state.timeMs).toBe(2500);
    expect(runToEnd(createRuntime(buildFlowSampleProject())).state.timeMs).toBe(13100);
    expect(runToEnd(createRuntime(buildFlowSampleProject())).state.pieces).toBeUndefined();
    const linear = runToEnd(createRuntime(fed(buildSampleProject(), 5, 0)));
    expect(linear.state.pieces?.map((pc) => pc.exitedAtMs)).toEqual([11100, 15600, 20100, 24600, 29100]);
    expect(linear.state.pieces?.every((pc) => pc.flow == null)).toBe(true);
  });

  it('AC7 the same model yields the same log and the rule version is 0.7.0', () => {
    expect(RUNTIME_RULES_VERSION).toBe('seq-runtime/0.8.0');
    const p = fed(buildFlowSampleProject(), 3, 0);
    const once = runToEnd(createRuntime(p, 'same'));
    const twice = runToEnd(createRuntime(p, 'same'));
    expect(twice.state.log).toEqual(once.state.log);
    expect(once.state.rulesVersion).toBe('seq-runtime/0.8.0');
    expect(once.state.log.find((l) => l.code === 'RUN_START')?.message).toContain('seq-runtime/0.8.0');
    const strip = (log: typeof once.state.log) => log.filter((l) => l.code !== 'PAUSE' && l.code !== 'RESUME');
    let stepped = start(createRuntime(p, 'same'));
    while (stepped.state.status === 'running') stepped = advance(stepped, 100);
    expect(strip(stepped.state.log)).toEqual(strip(once.state.log));
    let paused = advance(start(createRuntime(p, 'same')), 500);
    paused = pause(paused);
    paused = advance(paused, 5000);
    paused = resume(paused);
    paused = runToEnd(paused);
    expect(strip(paused.state.log)).toEqual(strip(once.state.log));
  });

  it('AC8 deadlock and one piece error stop the run with three lines', () => {
    let n = 0;
    const id = (prefix: string) => `${prefix}-${++n}`;
    const swapped = emptyProject('맞물림', id);
    const a = makeUnit('A 투입', 'A', { x: 0, y: 0, w: 200, h: 200 }, id);
    const b = makeUnit('B 되돌림', 'B', { x: 240, y: 0, w: 200, h: 200 }, id);
    swapped.units = [a, b];
    swapped.equipment.unitIds = [a.id, b.id];
    const put = (unitId: string, name: string) => {
      const bundle = instantiateDevice('pusher', unitId, { x: 10, y: 10 }, name, id);
      const host = swapped.units.find((u) => u.id === unitId)!;
      host.deviceIds.push(bundle.device.id);
      swapped.devices.push(bundle.device);
      swapped.signals.push(...bundle.signals);
      swapped.actions.push(...bundle.actions);
      return bundle.actions[0];
    };
    const toB = put(a.id, 'DA');
    const toA = put(b.id, 'DB');
    toB.duration = q(0.5, 's', true);
    toB.timeout = q(2, 's', true);
    toB.effect = { moveTo: b.id };
    toA.duration = q(0.5, 's', true);
    toA.timeout = q(2, 's', true);
    toA.effect = { moveTo: a.id };
    const go = { id: id('step'), name: 'A에서 B로', actionId: toB.id, timeoutOverride: null, entry: [], origin: 'sample' as const };
    const back = { id: id('step'), name: 'B에서 A로', actionId: toA.id, timeoutOverride: null, entry: [], origin: 'sample' as const };
    swapped.sequence.steps = [go, back];
    swapped.sequence.flow = [{ kind: 'loop', id: 'FLW-L', name: '한 바퀴', count: 1, body: [{ kind: 'step', stepId: go.id }, { kind: 'step', stepId: back.id }] }];
    swapped.materials = [{
      id: 'MAT-D', name: '맞물림', kind: 'individual', carrierOf: null,
      size: { w: q(10, 'mm'), l: q(10, 'mm'), h: q(10, 'mm') }, weight: q(0.1, 'kg'), handling: '',
      states: ['대기'], initialState: '대기', initialLocation: a.id, route: [a.id, b.id],
      feedInterval: q(0, 's', true), feedCount: 2,
    }];
    const dead = runToEnd(createRuntime(swapped));
    expect(dead.state.status).toBe('error');
    expect(dead.state.error?.code).toBe('DEADLOCK');
    expect(dead.state.error?.message).toContain('개체 1');
    expect(dead.state.error?.message).toContain('개체 2');
    const deadLines = runErrorProblem('DEADLOCK', dead.state.error?.message ?? '', null);
    expect(deadLines?.what).toBe('교착');
    expect(deadLines?.why).toContain('서로 기다려');
    expect(deadLines?.how).toContain('Unit');

    const line = buildSampleProject();
    const first = line.actions.find((action) => action.deviceId === 'PSH-01')!;
    const second = line.actions.find((action) => action.deviceId === 'CYL-03')!;
    clearMotion(first, 1, 3);
    clearMotion(second, 5, 1);
    const stepA = stepOf('STEP-A', '밀기', first.id);
    const stepB = stepOf('STEP-B', '가공', second.id);
    line.sequence.steps = [stepA, stepB];
    line.sequence.flow = [{ kind: 'loop', id: 'FLW-ONCE', name: '한 번', count: 1, body: [{ kind: 'step', stepId: stepA.id }, { kind: 'step', stepId: stepB.id }] }];
    const home = line.materials[0].initialLocation!;
    line.units.find((u) => u.id === home)!.capacity.maxMaterials = q(2, 'ea', true);
    const stopped = runToEnd(createRuntime(fed(line, 2, 0)));
    expect(stopped.state.status).toBe('error');
    expect(stopped.state.error?.code).toBe('TIMEOUT');
    expect(stopped.state.log.some((l) => l.code === 'RUN_COMPLETE')).toBe(false);
    const other = stopped.state.steps.find((s) => s.instanceId === 'MAT-001#2' && s.stepId === stepA.id);
    expect(other?.status).toBe('stopped');
    const lines = runErrorProblem('TIMEOUT', stopped.state.error?.message ?? '', '가공');
    expect(lines?.what).toContain('타임아웃');
    expect(lines?.why.length).toBeGreaterThan(0);
    expect(lines?.how?.length).toBeGreaterThan(0);
  });

  it('a substation step runs per piece and the later piece waits for the device', () => {
    const p = fed(buildParallelSampleProject(), 2, 0);
    const startId = p.materials[0].initialLocation!;
    p.units.find((u) => u.id === startId)!.capacity.maxMaterials = q(2, 'ea', true);
    expect(checkRunReadiness(p).ok).toBe(true);
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.status).toBe('completed');
    expect(rt.state.pieces).toHaveLength(2);
    expect(rt.state.log.filter((l) => l.code === 'PAR_JOIN' && l.message.includes('S1'))).toHaveLength(2);
    expect(rt.state.log.some((l) => l.code === 'WAIT' && l.message.includes('개체 2') && l.message.includes('Device 사용 중'))).toBe(true);
  });

  it('reset returns to one seated piece', () => {
    const p = fed(buildFlowSampleProject(), 3, 0);
    const rt = reset(advance(start(createRuntime(p)), 500));
    expect(rt.state.status).toBe('idle');
    expect(rt.state.timeMs).toBe(0);
    expect(rt.state.pieces?.filter((pc) => pc.fedAtMs != null)).toHaveLength(1);
  });
});
