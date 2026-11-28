// TURN-092 conditional loops. Counted loops stay the previous rule.
import { describe, expect, it } from 'vitest';
import { addMaterial, setFeedCount, setFeedPattern, setLoopLimit, setLoopMode } from '../src/model/commands';
import { checkConditions } from '../src/model/conditionCheck';
import { conditionFormula } from '../src/model/conditionFormula';
import { findById, walk } from '../src/model/flow';
import { analyzeRunGaps } from '../src/model/runGaps';
import { buildFlowSampleProject, buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import {
  FILE_FORMAT_VERSION, LOOP_LIMIT_DEFAULT, RUNTIME_RULES_VERSION,
  type Action, type FlowNode, type Project, type SequenceStep,
} from '../src/model/types';
import { checkRunReadiness } from '../src/model/validate';
import { createRuntime, runToEnd } from '../src/runtime/engine';
import { runErrorProblem } from '../src/ui/problemCopy';
import { resolveBlocker } from '../src/ui/blockerTarget';
import { parseProjectFile, serializeProject } from '../src/storage/fileFormat';

const stepOf = (id: string, name: string, actionId: string): SequenceStep =>
  ({ id, name, actionId, timeoutOverride: null, entry: [], origin: 'sample' });

function clearMotion(a: Action, dur = 0.2, timeout = 2) {
  a.pre = [];
  a.post = [];
  a.effect = {};
  a.duration = { ...a.duration, value: dur, assumption: true };
  a.timeout = { ...a.timeout, value: timeout, assumption: true };
}

function readLoop(mode: 'until' | 'while', equals: boolean, limit: number | null, failFirstN?: number): Project {
  const p = buildSampleProject();
  const read = p.actions.find((a) => a.kind === 'read')!;
  clearMotion(read);
  const result = p.signals.find((s) => s.deviceId === read.deviceId && s.role === 'result')!;
  const step = stepOf('STEP-READ', '읽기', read.id);
  p.sequence.steps = [step];
  p.sequence.flow = [{
    kind: 'loop', id: 'FLW-L', name: '조건 반복', count: 2, mode,
    cond: { kind: 'signal', signalId: result.id, equals },
    limit,
    body: [{ kind: 'step', stepId: step.id }],
  }];
  if (failFirstN !== undefined) {
    p.simSettings.faults.readFailActionIds = [read.id];
    if (failFirstN >= 0) p.simSettings.faults.readFailFirstN = { [read.id]: failFirstN };
  }
  return p;
}

function stateLoop(mode: 'until' | 'while', state: string, limit: number): Project {
  const p = buildSampleProject();
  const action = p.actions.find((a) => a.deviceId === 'CYL-01')!;
  clearMotion(action, 0.1, 2);
  const step = stepOf('STEP-1', '한 번', action.id);
  p.sequence.steps = [step];
  p.sequence.flow = [{
    kind: 'loop', id: 'FLW-L', name: '조건 반복', count: 2, mode,
    cond: { kind: 'materialState', state },
    limit,
    body: [{ kind: 'step', stepId: step.id }],
  }];
  return p;
}

describe('TURN-092 conditional loop', () => {
  it('AC2 until runs the body once when the condition is already true; while does not run when it starts false', () => {
    const until = runToEnd(createRuntime(stateLoop('until', '대기', 4)));
    expect(until.state.status).toBe('completed');
    expect(until.state.steps.filter((s) => s.stepId === 'STEP-1' && s.status === 'done')).toHaveLength(1);
    expect(until.state.log.filter((l) => l.code === 'LOOP_ITER')).toHaveLength(1);
    expect(until.state.log.find((l) => l.code === 'LOOP_EXIT')?.message).toContain('1회');

    const held = runToEnd(createRuntime(stateLoop('while', '가공됨', 4)));
    expect(held.state.status).toBe('completed');
    expect(held.state.steps.find((s) => s.stepId === 'STEP-1')?.status).toBe('skipped');
    expect(held.state.log.some((l) => l.code === 'LOOP_ITER')).toBe(false);
    expect(held.state.log.find((l) => l.code === 'LOOP_EXIT')?.message).toContain('0회');
  });

  it('AC3 a condition that becomes true on the third pass runs exactly three times and logs LOOP_EXIT', () => {
    const rt = runToEnd(createRuntime(readLoop('until', true, 10, 2)));
    expect(rt.state.status).toBe('completed');
    const iters = rt.state.log.filter((l) => l.code === 'LOOP_ITER');
    expect(iters.map((l) => l.message)).toEqual([
      '조건 반복 1/10',
      '조건 반복 2/10',
      '조건 반복 3/10',
    ]);
    const exit = rt.state.log.find((l) => l.code === 'LOOP_EXIT');
    expect(exit?.message).toContain('3회');
    expect(exit?.message).toContain('= ON');
    expect(rt.state.steps.filter((s) => s.stepId === 'STEP-READ' && s.status === 'done').map((s) => s.pass)).toEqual([1, 2, 3]);
    expect(rt.state.log.some((l) => l.code === 'LOOP_LIMIT')).toBe(false);
  });

  it('AC4 the cap stops the run with LOOP_LIMIT and three guidance lines', () => {
    const rt = runToEnd(createRuntime(readLoop('until', true, 2, 99)));
    expect(rt.state.status).toBe('error');
    expect(rt.state.error?.code).toBe('LOOP_LIMIT');
    expect(rt.state.log.filter((l) => l.code === 'LOOP_ITER')).toHaveLength(2);
    expect(rt.state.log.some((l) => l.code === 'LOOP_EXIT')).toBe(false);
    expect(rt.state.log.some((l) => l.code === 'LOOP_LIMIT')).toBe(true);
    const phrase = conditionFormula(rt.snapshot, { kind: 'signal', signalId: rt.snapshot.signals.find((s) => s.role === 'result')!.id, equals: true });
    const copy = runErrorProblem('LOOP_LIMIT', rt.state.error!.message, null, phrase);
    expect(copy?.what).toContain('반복 상한');
    expect(copy?.why).toContain(phrase);
    expect(copy?.why).toContain('2회');
    expect(copy?.how).toContain('상한');
    expect(copy?.jump).toBe('이동');
    const gap = analyzeRunGaps(rt.snapshot, rt.state).find((g) => g.id.startsWith('run:error:LOOP_LIMIT'));
    expect(gap?.fix).toEqual({ to: 'flow', blockId: 'FLW-L' });
  });

  it('AC5 an unset condition or cap blocks the run and the jump names that row; a body that cannot change the condition warns', () => {
    let p = buildFlowSampleProject();
    let found: Extract<FlowNode, { kind: 'loop' }> | undefined;
    walk(p.sequence.flow!, (n) => { if (n.kind === 'loop') found = n; });
    if (!found) throw new Error('loop');
    const loopId = found.id;
    const mode = setLoopMode(p, loopId, 'until');
    expect(mode.ok).toBe(true);
    if (!mode.ok) return;
    const cleared = setLoopLimit(mode.project, loopId, null);
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    p = cleared.project;
    const node = findById(p.sequence.flow!, loopId)?.node;
    if (node?.kind !== 'loop') throw new Error('loop');
    node.cond = { kind: 'undefined', note: '조건 없음' };
    const ready = checkRunReadiness(p);
    expect(ready.ok).toBe(false);
    const cond = ready.blockers.find((b) => b.code === 'CONDITION_UNDEFINED' && b.objectId === loopId);
    const cap = ready.blockers.find((b) => b.code === 'LOOP_LIMIT_UNDEFINED' && b.objectId === loopId);
    expect(cond).toBeTruthy();
    expect(cap).toBeTruthy();
    expect(resolveBlocker(p, cond!, ready.blockers).field).toBe(`flow:${loopId}`);
    expect(resolveBlocker(p, cap!, ready.blockers).field).toBe(`flow:${loopId}`);

    const watched = buildSampleProject();
    const action = watched.actions[0];
    clearMotion(action);
    const step = stepOf('STEP-1', '한 번', action.id);
    watched.sequence.steps = [step];
    watched.sequence.flow = [{
      kind: 'loop', id: 'FLW-KIND', name: '종류 반복', count: 2, mode: 'while',
      cond: { kind: 'materialType', materialId: watched.materials[0].id },
      limit: 3,
      body: [{ kind: 'step', stepId: step.id }],
    }];
    expect(checkRunReadiness(watched).ok).toBe(true);
    const warn = checkConditions(watched).find((f) => f.kind === 'unchanged');
    expect(warn?.reason).toBe('이 조건은 몸통의 어떤 Action 으로도 바뀌지 않는다');
    expect(warn?.level).toBe('info');
    const reading = readLoop('until', true, 4, 1);
    expect(checkConditions(reading).some((f) => f.kind === 'unchanged' && f.site === 'flow:FLW-L')).toBe(false);
  });

  it('AC6 each piece and a Substation sequence use the same rule', () => {
    const base = stateLoop('until', '대기', 2);
    const added = addMaterial(base, () => 'MAT-B');
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const counted = setFeedCount(added.project, added.project.materials[0].id, 2);
    expect(counted.ok).toBe(true);
    if (!counted.ok) return;
    const ordered = setFeedPattern(counted.project, [counted.project.materials[0].id, 'MAT-B']);
    expect(ordered.ok).toBe(true);
    if (!ordered.ok) return;
    const mixed = ordered.project;
    for (const unit of mixed.units) unit.capacity.maxMaterials = { ...unit.capacity.maxMaterials, value: 4 };
    const loop = mixed.sequence.flow![0];
    if (loop.kind !== 'loop') throw new Error('loop');
    loop.cond = { kind: 'materialType', materialId: mixed.materials[0].id };
    loop.mode = 'until';
    loop.limit = 2;
    const rt = runToEnd(createRuntime(mixed));
    const exits = rt.state.log.filter((l) => l.code === 'LOOP_EXIT').map((l) => l.message);
    const limits = rt.state.log.filter((l) => l.code === 'LOOP_LIMIT').map((l) => l.message);
    expect(exits.some((m) => m.includes('개체 1'))).toBe(true);
    expect(limits.some((m) => m.includes('개체 2'))).toBe(true);
    expect(rt.state.steps.filter((s) => s.instanceId === 'MAT-001#1' && s.status === 'done')).toHaveLength(1);
    expect(rt.state.steps.filter((s) => s.instanceId === 'MAT-B#2' && s.status === 'done')).toHaveLength(2);

    const sub = buildParallelSampleProject();
    const seq = sub.substationSequences!.find((q) => q.id === 'SSEQ-S2-A')!;
    const push = sub.actions.find((a) => a.id === seq.steps[0].actionId)!;
    seq.flow = [{
      kind: 'loop', id: 'SUB-WHILE', name: '밀기 전', count: 2, mode: 'while',
      cond: { kind: 'signal', signalId: push.completeSignalId!, equals: true },
      limit: 3,
      body: [{ kind: 'step', stepId: 'SSTEP-C1' }],
    }];
    const ran = runToEnd(createRuntime(sub));
    expect(ran.state.status).toBe('completed');
    const exit = ran.state.log.find((l) => l.code === 'LOOP_EXIT');
    expect(exit?.message.startsWith(seq.name)).toBe(true);
    expect(exit?.message).toContain('0회');
    expect(ran.state.steps.find((s) => s.stepId === 'SSTEP-C1')?.status).toBe('skipped');
  });

  it('AC7 older loops and the three examples keep their bytes, times, and logs', () => {
    const samples = [buildSampleProject(), buildParallelSampleProject(), buildFlowSampleProject()];
    for (const sample of samples) {
      const raw = serializeProject(sample);
      expect(raw).not.toContain('"mode"');
      expect(raw).not.toContain('"limit"');
      const opened = parseProjectFile(raw);
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      expect(serializeProject(opened.project)).toBe(raw);
      const flows = [sample.sequence.flow, ...(sample.substationSequences ?? []).map((q) => q.flow)].filter((f): f is FlowNode[] => !!f);
      for (const flow of flows) {
        walk(flow, (n) => {
          if (n.kind !== 'loop') return;
          expect(n.mode).toBeUndefined();
          expect(n.cond).toBeUndefined();
          expect(n.limit).toBeUndefined();
        });
      }
    }
    expect(runToEnd(createRuntime(buildSampleProject())).state.timeMs).toBe(11100);
    expect(runToEnd(createRuntime(buildParallelSampleProject())).state.timeMs).toBe(2500);
    const flow = runToEnd(createRuntime(buildFlowSampleProject()));
    expect(flow.state.timeMs).toBe(13100);
    const iters = flow.state.log.filter((l) => l.code === 'LOOP_ITER').map((l) => l.message);
    expect(iters).toEqual(expect.arrayContaining([expect.stringContaining('1/2'), expect.stringContaining('2/2')]));
    expect(flow.state.log.some((l) => l.code === 'LOOP_EXIT' || l.code === 'LOOP_LIMIT')).toBe(false);
    const again = runToEnd(createRuntime(buildFlowSampleProject()));
    expect(again.state.log).toEqual(flow.state.log);
    expect(FILE_FORMAT_VERSION).toBe('0.3.0');
  });

  it('AC8 the runtime rule is seq-runtime/0.11.0', () => {
    expect(RUNTIME_RULES_VERSION).toBe('seq-runtime/0.11.0');
    expect(LOOP_LIMIT_DEFAULT).toBe(10);
    const rt = runToEnd(createRuntime(buildSampleProject()));
    expect(rt.state.rulesVersion).toBe('seq-runtime/0.11.0');
    expect(rt.state.log.find((l) => l.code === 'RUN_START')?.message).toContain('seq-runtime/0.11.0');
  });
});
