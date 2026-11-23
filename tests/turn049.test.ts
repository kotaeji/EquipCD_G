// TURN-049 signal-wait block and pausing one Substation.
import { describe, expect, it } from 'vitest';
import * as C from '../src/model/commands';
import { analyzeRunGaps } from '../src/model/runGaps';
import { buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import { FILE_FORMAT_VERSION, RUNTIME_RULES_VERSION, type Action, type FlowNode, type Project, type SequenceStep } from '../src/model/types';
import { checkRunReadiness } from '../src/model/validate';
import { advance, createRuntime, pause, pauseSubstation, reset, resume, resumeSubstation, runToEnd, start } from '../src/runtime/engine';
import { summarizeRun } from '../src/runtime/runSummary';
import { parseProjectFile, serializeProject } from '../src/storage/fileFormat';

const stepOf = (id: string, name: string, actionId: string): SequenceStep =>
  ({ id, name, actionId, timeoutOverride: null, entry: [], origin: 'dnd' });

function clearMotion(a: Action, dur: number, timeout: number) {
  a.pre = [];
  a.post = [];
  a.effect = {};
  a.duration = { ...a.duration, value: dur };
  a.timeout = { ...a.timeout, value: timeout };
}

/** Two parallel lanes on two devices. Lane 1 runs `slow`. Lane 2 is `nodes`. */
function twoLanes(slowSec: number, lane2: (p: Project, slow: Action, other: Action) => FlowNode[]) {
  const p = buildSampleProject();
  const used = new Set(p.sequence.steps.map((s) => s.actionId));
  const slowA = p.actions.find((a) => a.deviceId === 'CYL-01')!;
  const otherA = p.actions.find((a) => a.deviceId === 'STP-05' && !used.has(a.id))!;
  clearMotion(slowA, slowSec, slowSec + 2);
  clearMotion(otherA, 0.2, 2);
  const slow = stepOf('STEP-SLOW', '느린 단계', slowA.id);
  const after = stepOf('STEP-AFTER', '다음 단계', otherA.id);
  p.sequence.steps = [slow, after];
  p.sequence.flow = [{
    kind: 'parallel', id: 'FLW-P', name: '나란히',
    lanes: [[{ kind: 'step', stepId: slow.id }], lane2(p, slowA, otherA)],
  }];
  return { p, slow, after, slowA, otherA };
}

function waitNode(id: string, signalId: string, timeout: number | null, name = '신호 기다림'): FlowNode {
  return { kind: 'wait', id, name, cond: { kind: 'signal', signalId, equals: true }, timeout: { value: timeout, unit: 's', assumption: true } };
}

describe('TURN-049 signal wait', () => {
  it('AC2 a lane waits 2s for the other lane to raise a signal, then starts', () => {
    const { p, slow, after } = twoLanes(2, (_p, slowAction) => [
      waitNode('FLW-WAIT', slowAction.completeSignalId!, 5),
      { kind: 'step', stepId: 'STEP-AFTER' },
    ]);
    const ready = checkRunReadiness(p);
    expect(ready.ok).toBe(true);
    expect(ready.warnings.some((w) => w.code === 'WAIT_UNREACHABLE')).toBe(false);
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.status).toBe('completed');
    const waited = rt.state.steps.find((s) => s.waitBlockId === 'FLW-WAIT')!;
    expect(waited.startMs).toBe(0);
    expect(waited.endMs).toBe(2000);
    expect(waited.status).toBe('done');
    expect(waited.waitMs).toBe(2000);
    const next = rt.state.steps.find((s) => s.stepId === after.id)!;
    expect(next.startMs).toBe(2000);
    expect(rt.state.steps.find((s) => s.stepId === slow.id)?.endMs).toBe(2000);
    const sum = summarizeRun(p, rt.state);
    expect(sum.steps.find((s) => s.wait)?.elapsedMs).toBe(2000);
    expect(sum.totalMs).toBe(2200);
    expect(rt.state.log.some((l) => l.code === 'WAIT_START' && l.t === 0)).toBe(true);
    expect(rt.state.log.some((l) => l.code === 'WAIT_END' && l.message.includes('2.000s'))).toBe(true);
  });

  it('AC3 an already-true condition passes in 0s', () => {
    const p = buildSampleProject();
    const a = p.actions.find((x) => x.deviceId === 'CYL-01')!;
    clearMotion(a, 0.4, 2);
    const step = stepOf('STEP-1', '바로', a.id);
    p.sequence.steps = [step];
    const unitId = p.materials[0].initialLocation!;
    p.sequence.flow = [
      { kind: 'wait', id: 'FLW-WAIT', name: '이미 참', cond: { kind: 'materialAt', unitId }, timeout: { value: 3, unit: 's', assumption: true } },
      { kind: 'step', stepId: step.id },
    ];
    expect(checkRunReadiness(p).ok).toBe(true);
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.status).toBe('completed');
    const waited = rt.state.steps.find((s) => s.waitBlockId === 'FLW-WAIT')!;
    expect(waited.startMs).toBe(0);
    expect(waited.endMs).toBe(0);
    expect(waited.waitMs).toBe(0);
    expect(rt.state.steps.find((s) => s.stepId === step.id)?.startMs).toBe(0);
  });

  it('AC4 timeout stops the run and closes the other lane', () => {
    const { p, slow } = twoLanes(2, (proj) => [
      waitNode('FLW-WAIT', proj.signals.find((s) => s.role === 'result')!.id, 0.5, '늦은 기다림'),
    ]);
    expect(checkRunReadiness(p).ok).toBe(true);
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.status).toBe('error');
    expect(rt.state.error?.code).toBe('WAIT_TIMEOUT');
    expect(rt.state.error?.message).toContain('갈래 2');
    expect(rt.state.error?.message).toContain('늦은 기다림');
    expect(rt.state.error?.message).toContain('0.500s');
    expect(rt.state.error?.message).toContain('==');
    expect(rt.state.timeMs).toBe(500);
    const waited = rt.state.steps.find((s) => s.stepId === 'FLW-WAIT')!;
    expect(waited.status).toBe('error');
    expect(rt.state.steps.find((s) => s.stepId === slow.id)?.status).toBe('stopped');
    expect(rt.state.steps.find((s) => s.stepId === slow.id)?.endMs).toBe(500);
    const gap = analyzeRunGaps(p, rt.state).find((g) => g.id.startsWith('run:error:WAIT_TIMEOUT'));
    expect(gap?.fix).toEqual({ to: 'flow', blockId: 'FLW-WAIT' });
    expect(gap?.title).toContain('시간 초과');
  });

  it('AC5 AC6 undetermined timeout blocks, and a late or missing setter is only a notice', () => {
    const p = buildSampleProject();
    const a = p.actions.find((x) => x.deviceId === 'CYL-01')!;
    clearMotion(a, 0.2, 1);
    const step = stepOf('STEP-1', '뒤 단계', a.id);
    p.sequence.steps = [step];
    const sig = a.completeSignalId!;
    p.sequence.flow = [
      waitNode('FLW-WAIT', sig, null),
      { kind: 'step', stepId: step.id },
    ];
    const blocked = checkRunReadiness(p);
    expect(blocked.ok).toBe(false);
    expect(blocked.blockers.some((b) => b.code === 'WAIT_TIMEOUT_UNDEFINED' && b.objectId === 'FLW-WAIT')).toBe(true);

    const late = structuredClone(p);
    const node = late.sequence.flow![0];
    if (node.kind === 'wait') node.timeout = { value: 1, unit: 's', assumption: true };
    const lateReady = checkRunReadiness(late);
    expect(lateReady.ok).toBe(true);
    expect(lateReady.warnings.some((w) => w.code === 'WAIT_UNREACHABLE' && w.message.includes('뒤에만'))).toBe(true);

    const none = structuredClone(late);
    const missing = none.signals.find((s) => s.role === 'result')!;
    const w = none.sequence.flow![0];
    if (w.kind === 'wait') w.cond = { kind: 'signal', signalId: missing.id, equals: true };
    const noneReady = checkRunReadiness(none);
    expect(noneReady.ok).toBe(true);
    expect(noneReady.warnings.some((w) => w.code === 'WAIT_UNREACHABLE' && w.message.includes('없습니다'))).toBe(true);

    const before = structuredClone(late);
    before.sequence.flow = [
      { kind: 'step', stepId: step.id },
      waitNode('FLW-WAIT', sig, 1),
    ];
    expect(checkRunReadiness(before).warnings.some((w) => w.code === 'WAIT_UNREACHABLE')).toBe(false);
  });

  it('AC12 the same operations log the same lines, and a saved wait reads back', () => {
    const { p } = twoLanes(2, (_p, slowAction) => [waitNode('FLW-WAIT', slowAction.completeSignalId!, 5), { kind: 'step', stepId: 'STEP-AFTER' }]);
    const once = runToEnd(createRuntime(p, 'run-1')).state.log;
    const twice = runToEnd(createRuntime(p, 'run-1')).state.log;
    expect(twice).toEqual(once);
    expect(once[0].message).toContain(RUNTIME_RULES_VERSION);
    const file = parseProjectFile(serializeProject(p));
    expect(file.ok).toBe(true);
    if (!file.ok) return;
    const block = p.sequence.flow![0];
    const saved = block.kind === 'parallel' ? block.lanes[1][0] : undefined;
    const loaded = file.project.sequence.flow?.[0];
    const back = loaded?.kind === 'parallel' ? loaded.lanes[1][0] : undefined;
    expect(back).toEqual(saved);
    expect(FILE_FORMAT_VERSION).toBe('0.3.0');
  });
});

describe('TURN-049 one Substation pause', () => {
  function sideBySide() {
    const p = buildParallelSampleProject();
    const flow = p.sequence.flow!;
    const ids = flow.map((n) => n.kind === 'step' ? n.stepId : n.id);
    const wrapped = C.wrapFlow(p, ids, 'parallel', () => 'FLW-BOTH');
    if (!wrapped.ok) throw new Error(wrapped.reason);
    return wrapped.project;
  }

  it('AC8 pausing one Substation lets the other and the clock continue', () => {
    const p = sideBySide();
    expect(checkRunReadiness(p).ok).toBe(true);
    let rt = start(createRuntime(p));
    rt = advance(rt, 100);
    const s1 = rt.state.steps.filter((s) => s.lane?.startsWith('S1'));
    expect(s1.some((s) => s.status === 'active')).toBe(true);
    rt = pauseSubstation(rt, 'FLW-SUB-S1');
    expect(rt.state.pausedSubstations?.map((row) => row.nodeId)).toEqual(['FLW-SUB-S1']);
    const frozenAt = rt.state.steps.filter((s) => s.lane?.startsWith('S1')).map((s) => ({ id: s.stepId, status: s.status, start: s.startMs, end: s.endMs }));
    rt = advance(rt, 2000);
    expect(rt.state.timeMs).toBe(900);
    expect(rt.state.status).toBe('running');
    const s1After = rt.state.steps.filter((s) => s.lane?.startsWith('S1')).map((s) => ({ id: s.stepId, status: s.status, start: s.startMs, end: s.endMs }));
    expect(s1After).toEqual(frozenAt);
    expect(rt.state.steps.some((s) => s.lane?.startsWith('S2') && s.status === 'done')).toBe(true);
    rt = resumeSubstation(rt, 'FLW-SUB-S1');
    rt = runToEnd(rt);
    expect(rt.state.status).toBe('completed');
    expect(rt.state.log.some((l) => l.code === 'SUB_PAUSE')).toBe(true);
    expect(rt.state.log.some((l) => l.code === 'SUB_RESUME')).toBe(true);
    expect(rt.state.pausedSubstations).toBeUndefined();
  });

  it('AC9 a paused Action does not time out while it is held', () => {
    const p = sideBySide();
    const push = p.actions.find((a) => a.name === 'S2 푸시')!;
    push.duration = { ...push.duration, value: 5 };
    push.timeout = { ...push.timeout, value: 1 };
    p.simSettings.faults.neverTrueSignalIds = [push.completeSignalId!];
    let rt = start(createRuntime(p));
    rt = advance(rt, 200);
    rt = pauseSubstation(rt, 'FLW-SUB-S2');
    rt = advance(rt, 2000);
    expect(rt.state.status).toBe('running');
    expect(rt.state.error).toBeNull();
    rt = resumeSubstation(rt, 'FLW-SUB-S2');
    rt = advance(rt, 700);
    expect(rt.state.error).toBeNull();
    rt = advance(rt, 200);
    expect(rt.state.error?.code).toBe('TIMEOUT');
  });

  it('AC10 AC11 a full hold stands still, run-to-end says so, and reset clears it', () => {
    const p = sideBySide();
    let rt = start(createRuntime(p));
    rt = advance(rt, 100);
    rt = pauseSubstation(rt, 'FLW-SUB-S1');
    rt = pauseSubstation(rt, 'FLW-SUB-S2');
    const at = rt.state.timeMs;
    rt = advance(rt, 5000);
    expect(rt.state.status).toBe('running');
    expect(rt.state.timeMs).toBe(at);
    expect(rt.state.error).toBeNull();
    expect(rt.state.pausedSubstations).toHaveLength(2);
    const ended = runToEnd(rt);
    expect(ended.state.status).toBe('running');
    expect(ended.state.timeMs).toBe(at);
    expect(ended.state.log.some((l) => l.code === 'SUB_PAUSE_HOLD' && l.message.includes('Substation 2개'))).toBe(true);
    rt = resumeSubstation(ended, 'FLW-SUB-S1');
    rt = resumeSubstation(rt, 'FLW-SUB-S2');
    const global = pause(rt);
    expect(advance(global, 100).state.timeMs).toBe(global.state.timeMs);
    const stepped = pause(advance(resume(global), 100));
    expect(stepped.state.timeMs).toBe(at + 100);
    expect(reset(stepped).state.status).toBe('idle');
    expect(reset(stepped).state.pausedSubstations).toBeUndefined();
    expect(reset(stepped).state.timeMs).toBe(0);
    expect(runToEnd(reset(stepped)).state.status).toBe('completed');
  });

});
