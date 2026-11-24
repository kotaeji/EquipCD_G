import { describe, expect, it } from 'vitest';
import * as C from '../src/model/commands';
import { checkConditions } from '../src/model/conditionCheck';
import { buildFlowSampleProject, buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import { FILE_FORMAT_VERSION, RUNTIME_RULES_VERSION, type FlowNode, type Project } from '../src/model/types';
import { advance, createRuntime, pauseSubstation, resumeSubstation, runToEnd, start } from '../src/runtime/engine';
import { checkRunReadiness } from '../src/model/validate';
import { parseProjectFile, serializeProject } from '../src/storage/fileFormat';
import { resolveBlocker } from '../src/ui/blockerTarget';

function seq(p: Project, id: string) {
  const q = (p.substationSequences ?? []).find((item) => item.id === id);
  if (!q) throw new Error(id);
  return q;
}

function parallelBoth(p0: Project = buildParallelSampleProject()) {
  const flow = p0.sequence.flow!;
  const ids = flow.map((n) => (n.kind === 'step' ? n.stepId : n.id));
  const wrapped = C.wrapFlow(p0, ids, 'parallel', () => 'FLW-BOTH');
  if (!wrapped.ok) throw new Error(wrapped.reason);
  return wrapped.project;
}

describe('TURN-072 substation sequence flow', () => {
  it('AC2 rejects parallel and a Substation step inside a Substation sequence', () => {
    const p = buildParallelSampleProject();
    const before = serializeProject(p);
    const parallel = C.wrapFlow(p, ['SSTEP-A1', 'SSTEP-A2'], 'parallel', () => 'NO', 'SSEQ-S1-A');
    expect(parallel.ok).toBe(false);
    if (!parallel.ok) expect(parallel.reason).toContain('병렬');
    const nested = C.addSubstationNode(p, p.units[0].id, () => 'NO-SUB', 'SSEQ-S1-A');
    expect(nested.ok).toBe(false);
    if (!nested.ok) expect(nested.reason).toContain('Substation 단계');
    expect(serializeProject(p)).toBe(before);
    expect(seq(p, 'SSEQ-S1-A').flow).toBeUndefined();
  });

  it('AC1 commands wrap branch, loop, retry, and wait, then unwrap, one revision each', () => {
    const p = buildParallelSampleProject();
    const branch = C.wrapFlow(p, ['SSTEP-A1', 'SSTEP-A2'], 'branch', () => 'SUB-B', 'SSEQ-S1-A');
    expect(branch.ok).toBe(true);
    if (!branch.ok) return;
    expect(branch.project.revision).toBe(p.revision + 1);
    expect(seq(branch.project, 'SSEQ-S1-A').flow?.[0]).toMatchObject({ kind: 'branch', id: 'SUB-B' });
    const opened = C.unwrapFlow(branch.project, 'SUB-B', 'SSEQ-S1-A');
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(seq(opened.project, 'SSEQ-S1-A').flow?.every((n) => n.kind === 'step')).toBe(true);

    const loop = C.wrapFlow(p, ['SSTEP-C1'], 'loop', () => 'SUB-L', 'SSEQ-S2-A');
    expect(loop.ok).toBe(true);
    if (!loop.ok) return;
    expect(seq(loop.project, 'SSEQ-S2-A').flow?.[0]).toMatchObject({ kind: 'loop', count: 2 });

    const retry = C.wrapFlow(p, ['SSTEP-C1'], 'retry', () => 'SUB-R', 'SSEQ-S2-A');
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(seq(retry.project, 'SSEQ-S2-A').flow?.[0].kind).toBe('retry');

    const wait = C.addWaitNode(p, () => 'SUB-W', 'SSEQ-S2-A');
    expect(wait.ok).toBe(true);
    if (!wait.ok) return;
    expect(seq(wait.project, 'SSEQ-S2-A').flow?.some((n) => n.kind === 'wait')).toBe(true);
    expect(p.sequence.flow).toEqual(buildParallelSampleProject().sequence.flow);
  });

  it('AC3 AC4 a Substation step follows each sequence flow and names it in the log', () => {
    const branched = buildParallelSampleProject();
    const a = seq(branched, 'SSEQ-S1-A');
    a.flow = [{
      kind: 'branch', id: 'SUB-B', name: '클램프 분기',
      cond: { kind: 'materialState', state: '대기' },
      then: [{ kind: 'step', stepId: 'SSTEP-A1' }],
      else: [{ kind: 'step', stepId: 'SSTEP-A2' }],
    }];
    const branchRun = runToEnd(createRuntime(branched));
    expect(branchRun.state.status).toBe('completed');
    expect(branchRun.state.timeMs).toBe(2500);
    const taken = branchRun.state.log.find((l) => l.code === 'BRANCH_TAKEN');
    expect(taken?.message).toContain(a.name);
    expect(taken?.message).toContain('갈래 1');
    expect(taken?.message).toContain('참');
    const skipped = branchRun.state.steps.find((s) => s.stepId === 'SSTEP-A2');
    expect(skipped?.status).toBe('skipped');
    expect(skipped?.lane).toBe(a.name);
    const again = runToEnd(createRuntime(structuredClone(branched)));
    expect(again.state.log).toEqual(branchRun.state.log);

    const looped = buildParallelSampleProject();
    const push = seq(looped, 'SSEQ-S2-A');
    push.flow = [{ kind: 'loop', id: 'SUB-L', name: '푸시 반복', count: 2, body: [{ kind: 'step', stepId: 'SSTEP-C1' }] }];
    const loopRun = runToEnd(createRuntime(looped));
    expect(loopRun.state.status).toBe('completed');
    expect(loopRun.state.timeMs).toBe(3400);
    const iters = loopRun.state.log.filter((l) => l.code === 'LOOP_ITER');
    expect(iters.map((l) => l.message)).toEqual([
      `${push.name} 푸시 반복 1/2`,
      `${push.name} 푸시 반복 2/2`,
    ]);
    const passes = loopRun.state.steps.filter((s) => s.stepId === 'SSTEP-C1');
    expect(passes.map((s) => s.pass)).toEqual([1, 2]);
    expect(passes.every((s) => s.lane === push.name)).toBe(true);

    const retried = buildParallelSampleProject();
    const q = seq(retried, 'SSEQ-S2-A');
    const action = retried.actions.find((item) => item.id === q.steps[0].actionId)!;
    const other = retried.signals.find((s) => s.id !== action.completeSignalId && s.id !== action.commandSignalId)!;
    q.flow = [{
      kind: 'retry', id: 'SUB-R', name: '다시 밀기',
      until: { kind: 'signal', signalId: other.id, equals: true },
      maxRetries: 1,
      body: [{ kind: 'step', stepId: 'SSTEP-C1' }],
    }];
    const retryRun = runToEnd(createRuntime(retried));
    expect(retryRun.state.status).toBe('completed');
    const retry = retryRun.state.log.find((l) => l.code === 'RETRY');
    expect(retry?.message).toContain(q.name);
    expect(retry?.message).toContain('1/1');
    expect(retryRun.state.log.some((l) => l.code === 'RETRY_EXHAUSTED' && l.message.includes(q.name))).toBe(true);
    expect(retryRun.state.steps.filter((s) => s.stepId === 'SSTEP-C1').map((s) => s.pass)).toEqual([1, 2]);

    const waiting = buildParallelSampleProject();
    const wq = seq(waiting, 'SSEQ-S2-A');
    const flow: FlowNode[] = [
      { kind: 'wait', id: 'SUB-W', name: '도착', cond: { kind: 'materialState', state: '대기' }, timeout: { value: 2, unit: 's', assumption: true } },
      { kind: 'step', stepId: 'SSTEP-C1' },
    ];
    wq.flow = flow;
    const waitRun = runToEnd(createRuntime(waiting));
    expect(waitRun.state.status).toBe('completed');
    expect(waitRun.state.timeMs).toBe(2500);
    expect(waitRun.state.log.find((l) => l.code === 'WAIT_START')?.message).toContain(wq.name);
    expect(waitRun.state.log.find((l) => l.code === 'WAIT_END')?.message).toContain(wq.name);
    const waitRow = waitRun.state.steps.find((s) => s.waitBlockId === 'SUB-W');
    expect(waitRow?.lane).toBe(wq.name);
    expect(waitRow?.waitMs).toBe(0);
  });

  it('AC5 samples without a Substation flow keep their time, log shape, and file bytes', () => {
    expect(FILE_FORMAT_VERSION).toBe('0.3.0');
    expect(RUNTIME_RULES_VERSION).toBe('seq-runtime/0.10.0');
    const times = [buildSampleProject(), buildParallelSampleProject(), buildFlowSampleProject()].map((p) => runToEnd(createRuntime(p)).state.timeMs);
    expect(times).toEqual([11100, 2500, 13100]);
    for (const build of [buildSampleProject, buildParallelSampleProject, buildFlowSampleProject]) {
      const file = JSON.parse(serializeProject(build())) as { formatVersion: string; project: Project };
      expect(file.formatVersion).toBe('0.3.0');
      for (const q of file.project.substationSequences ?? []) expect(q.flow).toBeUndefined();
      const parsed = parseProjectFile(serializeProject(build()));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(serializeProject(parsed.project)).toBe(serializeProject(build()));
    }
    const plain = runToEnd(createRuntime(buildParallelSampleProject()));
    expect(plain.state.log.some((l) => l.code === 'BRANCH_TAKEN' || l.code === 'LOOP_ITER' || l.code === 'RETRY')).toBe(false);
    expect(plain.state.log.find((l) => l.code === 'RUN_START')?.message).toContain('seq-runtime/0.10.0');
    const twice = runToEnd(createRuntime(buildParallelSampleProject()));
    expect(twice.state.log).toEqual(plain.state.log);
  });

  it('AC6 readiness and condition check point at the Substation flow row', () => {
    const p = buildParallelSampleProject();
    const q = seq(p, 'SSEQ-S1-A');
    q.flow = [{
      kind: 'branch', id: 'SUB-B', name: '검사',
      cond: { kind: 'undefined', note: '조건 없음' },
      then: [{ kind: 'step', stepId: 'SSTEP-A1' }],
      else: [],
    }];
    const ready = checkRunReadiness(p);
    expect(ready.ok).toBe(false);
    const unset = ready.blockers.find((b) => b.code === 'CONDITION_UNDEFINED' && b.objectId === 'SUB-B');
    expect(unset?.message).toContain(q.name);
    const guide = resolveBlocker(p, unset!, ready.blockers);
    expect(guide.dest?.sub).toBe('subseq');
    expect(guide.field).toBe('flow:SUB-B');
    expect(guide.focus?.id).toBe(q.unitId);
    const empty = checkConditions(p).find((f) => f.kind === 'emptyArm');
    expect(empty?.reason).toContain('빈 갈래');
    expect(empty?.jump).toMatchObject({ step: 'sequence', sub: 'subseq', selectId: q.unitId, field: 'flow:SUB-B:arm:1' });

    const waiting = buildParallelSampleProject();
    seq(waiting, 'SSEQ-S2-A').flow = [{
      kind: 'wait', id: 'SUB-W', name: '도착',
      cond: { kind: 'materialState', state: '대기' },
      timeout: { value: null, unit: 's', assumption: true },
    }];
    const blocked = checkRunReadiness(waiting);
    const timeout = blocked.blockers.find((b) => b.code === 'WAIT_TIMEOUT_UNDEFINED');
    expect(timeout?.message).toContain('타임아웃 미정');
    const where = resolveBlocker(waiting, timeout!, blocked.blockers);
    expect(where.dest?.sub).toBe('subseq');
    expect(where.field).toBe('flow:SUB-W');
  });

  it('AC8 pause still freezes a Substation whose sequence has a loop', () => {
    const p = parallelBoth();
    const q = seq(p, 'SSEQ-S1-A');
    q.flow = [{
      kind: 'loop', id: 'SUB-L', name: '클램프 반복', count: 3,
      body: q.steps.map((s) => ({ kind: 'step', stepId: s.id })),
    }];
    expect(checkRunReadiness(p).ok).toBe(true);
    let rt = start(createRuntime(p));
    rt = advance(rt, 100);
    expect(rt.state.log.some((l) => l.code === 'LOOP_ITER' && l.message.includes(q.name))).toBe(true);
    rt = pauseSubstation(rt, 'FLW-SUB-S1');
    const frozen = rt.state.steps.filter((s) => s.lane === q.name).map((s) => ({ id: s.stepId, status: s.status, start: s.startMs, end: s.endMs }));
    expect(frozen.length).toBeGreaterThan(0);
    rt = advance(rt, 2000);
    expect(rt.state.status).toBe('running');
    expect(rt.state.steps.filter((s) => s.lane === q.name).map((s) => ({ id: s.stepId, status: s.status, start: s.startMs, end: s.endMs }))).toEqual(frozen);
    expect(rt.state.steps.some((s) => s.lane?.startsWith('S2') && s.status === 'done')).toBe(true);
    rt = resumeSubstation(rt, 'FLW-SUB-S1');
    rt = runToEnd(rt);
    expect(rt.state.status).toBe('completed');
    expect(rt.state.steps.filter((s) => s.stepId === 'SSTEP-A1').length).toBe(3);
  });

  it('the first of two pieces follows the Substation loop; the second waits on S1 capacity', () => {
    const p = buildParallelSampleProject();
    const q = seq(p, 'SSEQ-S1-A');
    q.flow = [{ kind: 'loop', id: 'SUB-L', name: '클램프 반복', count: 2, body: [{ kind: 'step', stepId: 'SSTEP-A1' }] }];
    p.materials[0].feedCount = 2;
    p.materials[0].feedInterval = { ...p.materials[0].feedInterval, value: 0 };
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.error?.code).toBe('DEADLOCK');
    expect(rt.state.error?.message).toContain('개체 2');
    expect(rt.state.error?.message).toContain('S1');
    const iters = rt.state.log.filter((l) => l.code === 'LOOP_ITER');
    expect(iters.length).toBeGreaterThan(0);
    expect(iters.every((l) => l.message.startsWith(`개체 1 · ${q.name} `))).toBe(true);
    const rows = rt.state.steps.filter((s) => s.stepId === 'SSTEP-A1');
    expect(rows.length).toBe(2);
    expect(rows.every((s) => s.lane === `개체 1 · ${q.name}`)).toBe(true);
    const second = runToEnd(createRuntime(structuredClone(p)));
    expect(second.state.log).toEqual(rt.state.log);
  });
});
