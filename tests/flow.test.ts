import { describe, expect, it } from 'vitest';
import { applyEdit, initHistory, undo } from '../src/model/history';
import { buildFlowSampleProject, buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import * as C from '../src/model/commands';
import { checkRunReadiness, validateProject } from '../src/model/validate';
import { advance, createRuntime, pause, resume, runToEnd, start } from '../src/runtime/engine';
import { orderRunRecords, summarizeRun } from '../src/runtime/runSummary';
import { findById } from '../src/model/flow';
import { destLabel, resolveBlocker } from '../src/ui/blockerTarget';
import { flowBlockTitle, signalChoiceLabel } from '../src/ui/labels';
import { parseProjectFile, serializeProject } from '../src/storage/fileFormat';
import { DEFAULT_MAX_RETRIES, FILE_FORMAT_VERSION, RUNTIME_RULES_VERSION, type FlowNode, type Project } from '../src/model/types';

const readId = (p: Project) => p.actions.find((a) => a.kind === 'read')!.id;
const resultName = (p: Project) => p.signals.find((s) => s.deviceId === 'BCR-02' && s.role === 'result')!.name;

describe('flow commands (AC2)', () => {
  it('wraps consecutive steps, bumps rev once, and undo restores the project', () => {
    const p0 = buildSampleProject();
    const h0 = initHistory(p0);
    const ids = p0.sequence.steps.slice(2, 5).map((s) => s.id);
    const wrapped = applyEdit(h0, C.wrapFlow(p0, ids, 'loop', (x) => `${x}-1`), '반복으로 묶기', false);
    expect(wrapped.error).toBeUndefined();
    expect(wrapped.history.present.revision).toBe(p0.revision + 1);
    expect(wrapped.history.present.sequence.flow?.some((n) => n.kind === 'loop')).toBe(true);
    const back = undo(wrapped.history, false);
    expect(back.history.present).toEqual(p0);
    expect(back.history.present.sequence.flow).toBeUndefined();
  });

  it('removes a deleted step from the flow', () => {
    let p = buildSampleProject();
    const ids = p.sequence.steps.slice(0, 3).map((s) => s.id);
    p = (C.wrapFlow(p, ids, 'branch') as { project: Project }).project;
    const gone = ids[1];
    p = (C.removeStep(p, gone) as { project: Project }).project;
    const text = JSON.stringify(p.sequence.flow);
    expect(text).not.toContain(gone);
    expect(p.sequence.steps.some((s) => s.id === gone)).toBe(false);
  });
});

describe('flow runtime', () => {
  it('AC3 loop records two passes and LOOP_ITER 1/2 · 2/2', () => {
    const p = buildFlowSampleProject();
    const step = p.sequence.steps.find((s) => s.name.includes('가공'))!;
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.status).toBe('completed');
    const passes = rt.state.steps.filter((s) => s.stepId === step.id && s.status === 'done');
    expect(passes.map((s) => s.pass)).toEqual([1, 2]);
    const iters = rt.state.log.filter((l) => l.code === 'LOOP_ITER').map((l) => l.message);
    expect(iters.some((m) => m.includes('1/2'))).toBe(true);
    expect(iters.some((m) => m.includes('2/2'))).toBe(true);
  });

  it('AC4 branch takes one arm and names the signal', () => {
    const base = buildFlowSampleProject();
    const ok = runToEnd(createRuntime(base));
    const taken = ok.state.log.find((l) => l.code === 'BRANCH_TAKEN')!;
    expect(taken.message).toContain('참');
    expect(taken.message).toContain(resultName(base));
    expect(taken.message).not.toMatch(/sig-[0-9a-f-]{8,}/);
    expect(ok.state.steps.find((s) => s.stepId === 'STEP-NG')?.status).toBe('skipped');
    expect(ok.state.steps.find((s) => s.stepId === 'STEP-04')?.status).toBe('done');

    const ng = structuredClone(base);
    ng.simSettings.faults.readFailActionIds = [readId(ng)];
    const bad = runToEnd(createRuntime(ng));
    const branch = bad.state.log.find((l) => l.code === 'BRANCH_TAKEN')!;
    expect(branch.message).toContain('거짓');
    expect(branch.message).toContain(resultName(ng));
    expect(bad.state.steps.find((s) => s.stepId === 'STEP-NG')?.status).toBe('done');
    expect(bad.state.steps.find((s) => s.stepId === 'STEP-04')?.status).toBe('skipped');
  });

  it('AC5 retry once then pass, or exhaust and continue', () => {
    expect(DEFAULT_MAX_RETRIES).toBe(2);
    const once = buildFlowSampleProject();
    once.simSettings.faults.readFailActionIds = [readId(once)];
    once.simSettings.faults.readFailFirstN = { [readId(once)]: 1 };
    const passed = runToEnd(createRuntime(once));
    expect(passed.state.status).toBe('completed');
    expect(passed.state.log.filter((l) => l.code === 'RETRY').map((l) => l.message).join(' ')).toContain('1/2');
    expect(passed.state.log.some((l) => l.code === 'RETRY_EXHAUSTED')).toBe(false);
    expect(passed.state.material?.state).not.toBe('식별실패');

    const always = buildFlowSampleProject();
    always.simSettings.faults.readFailActionIds = [readId(always)];
    const failed = runToEnd(createRuntime(always));
    expect(failed.state.status).toBe('completed');
    expect(failed.state.log.filter((l) => l.code === 'RETRY')).toHaveLength(2);
    expect(failed.state.log.some((l) => l.code === 'RETRY_EXHAUSTED')).toBe(true);
    expect(failed.state.steps.filter((s) => s.stepId === 'STEP-03' && s.status === 'done')).toHaveLength(3);
  });

  it('AC6 read failure stops only when no branch or retry uses the result signal', () => {
    const linear = buildSampleProject();
    linear.simSettings.faults.readFailActionIds = [readId(linear)];
    const stopped = runToEnd(createRuntime(linear));
    expect(stopped.state.status).toBe('error');
    expect(stopped.state.error?.code).toBe('READ_FAILED');

    const flow = buildFlowSampleProject();
    flow.simSettings.faults.readFailActionIds = [readId(flow)];
    const cont = runToEnd(createRuntime(flow));
    expect(cont.state.status).toBe('completed');
    expect(cont.state.log.some((l) => l.code === 'READ_FAILED')).toBe(false);
  });

  it('AC7 parallel lanes overlap and PAR_JOIN is the longer lane', () => {
    const p = buildFlowSampleProject();
    const rt = runToEnd(createRuntime(p));
    const lane1 = rt.state.log.find((l) => l.code === 'STEP_START' && l.message.includes('갈래 1'));
    const lane2 = rt.state.log.find((l) => l.code === 'STEP_START' && l.message.includes('갈래 2'));
    expect(lane1?.t).toBe(lane2?.t);
    const join = rt.state.log.find((l) => l.code === 'PAR_JOIN' && l.message.includes('이송'));
    const laneDone = rt.state.log.filter((l) => l.code === 'STEP_DONE' && l.message.includes('갈래'));
    const latest = Math.max(...laneDone.map((l) => l.t));
    expect(join?.t).toBe(latest);
    expect(latest).toBeGreaterThan(Math.min(...laneDone.map((l) => l.t)));
  });
});

describe('examples (AC8 AC10 AC11 AC12)', () => {
  it('AC8 parallel example runs from the station button and S1 ends at 1.200s and 1.600s', () => {
    const p = buildParallelSampleProject();
    expect(checkRunReadiness(p).ok).toBe(true);
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.status).toBe('completed');
    expect(rt.state.log.some((l) => l.code === 'RUN_COMPLETE')).toBe(true);
    const s1 = rt.state.log.filter((l) => l.code === 'SEQ_COMPLETE');
    expect(s1.map((l) => l.t).slice(0, 2)).toEqual([1200, 1600]);
  });

  it('AC10 chunking and pause do not change the outcome', () => {
    const projects = [buildFlowSampleProject(), buildParallelSampleProject()];
    for (const p of projects) {
      const whole = runToEnd(createRuntime(p));
      const strip = (log: typeof whole.state.log) => log.filter((l) => l.code !== 'PAUSE' && l.code !== 'RESUME');
      for (const dt of [1, 100, 60_000]) {
        let r = start(createRuntime(p));
        while (r.state.status === 'running') r = advance(r, dt);
        expect(r.state.status).toBe(whole.state.status);
        expect(r.state.material).toEqual(whole.state.material);
        expect(strip(r.state.log)).toEqual(strip(whole.state.log));
      }
      let paused = start(createRuntime(p));
      paused = advance(paused, 400);
      paused = pause(paused);
      paused = advance(paused, 5000);
      paused = resume(paused);
      paused = runToEnd(paused);
      expect(paused.state.status).toBe(whole.state.status);
      expect(paused.state.timeMs).toBe(whole.state.timeMs);
      expect(paused.state.material).toEqual(whole.state.material);
      expect(strip(paused.state.log)).toEqual(strip(whole.state.log));
    }
  });

  it('AC11 the flow example completes for off, first-fail, and always-fail', () => {
    const off = runToEnd(createRuntime(buildFlowSampleProject()));
    expect(off.state.status).toBe('completed');
    expect(off.state.material?.state).toBe('배출 완료');

    const onceP = buildFlowSampleProject();
    onceP.simSettings.faults.readFailActionIds = [readId(onceP)];
    onceP.simSettings.faults.readFailFirstN = { [readId(onceP)]: 1 };
    const once = runToEnd(createRuntime(onceP));
    expect(once.state.status).toBe('completed');
    expect(once.state.log.some((l) => l.code === 'RETRY' && l.message.includes('1/2'))).toBe(true);
    expect(once.state.material?.state).toBe('배출 완료');

    const alwaysP = buildFlowSampleProject();
    alwaysP.simSettings.faults.readFailActionIds = [readId(alwaysP)];
    const always = runToEnd(createRuntime(alwaysP));
    expect(always.state.status).toBe('completed');
    expect(always.state.log.some((l) => l.code === 'RETRY_EXHAUSTED')).toBe(true);
    expect(always.state.material).toMatchObject({ location: 'EXIT', state: '식별실패' });
  });

  it('AC12 saves flow at 0.3.0 and still opens 0.2 and 0.1 files', () => {
    expect(FILE_FORMAT_VERSION).toBe('0.3.0');
    const flow = buildFlowSampleProject();
    const text = serializeProject(flow);
    expect(text).toContain('"formatVersion": "0.3.0"');
    const back = parseProjectFile(text);
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.project.sequence.flow).toEqual(flow.sequence.flow);

    const old = JSON.parse(serializeProject(buildSampleProject())) as { formatVersion: string; project: Project };
    old.formatVersion = '0.2.0';
    delete old.project.sequence.flow;
    const v2 = parseProjectFile(JSON.stringify(old));
    expect(v2.ok).toBe(true);
    if (v2.ok) {
      expect(v2.project.sequence.flow).toBeUndefined();
      expect(runToEnd(createRuntime(v2.project)).state.timeMs).toBe(11100);
    }
    old.formatVersion = '0.1.0';
    delete (old.project as { substationSequences?: unknown }).substationSequences;
    const v1 = parseProjectFile(JSON.stringify(old));
    expect(v1.ok).toBe(true);
    if (v1.ok) expect(v1.warnings.map((w) => w.code)).toContain('MIGRATED_FORMAT');
  });

  it('parallel device conflict blocks the station run', () => {
    const p = buildParallelSampleProject();
    const a = p.substationSequences!.find((q) => q.id === 'SSEQ-S1-A')!;
    a.steps.push({ id: 'SSTEP-X', name: 'conflict', actionId: p.actions.find((x) => x.deviceId === 'CYL-B1')!.id, timeoutOverride: null, entry: [], origin: 'dnd' });
    const ready = checkRunReadiness(p);
    expect(ready.ok).toBe(false);
    expect(ready.blockers.map((b) => b.code)).toContain('DEVICE_CONFLICT');
    const started = start(createRuntime(p));
    expect(started.state.status).toBe('idle');
    expect(started.state.blockers.map((b) => b.code)).toContain('DEVICE_CONFLICT');
  });
});

describe('review fixes — order, parallel guidance, condition names', () => {
  it('puts the second loop pass before later steps and keeps the skipped step in flow order', () => {
    const p = buildFlowSampleProject();
    const rt = runToEnd(createRuntime(p));
    const sum = summarizeRun(p, rt.state);
    const at = (pred: (s: (typeof sum.steps)[number]) => boolean) => sum.steps.findIndex(pred);
    const cyl2 = at((s) => s.name.includes('가공') && s.pass === 2);
    const conv = at((s) => s.name.includes('컨베이어'));
    const ng = at((s) => s.name.includes('NG'));
    expect(cyl2).toBeGreaterThan(at((s) => s.name.includes('가공') && s.pass === 1));
    expect(cyl2).toBeLessThan(conv);
    expect(ng).toBeGreaterThan(conv);
    expect(sum.steps[ng].status).toBe('skipped');
    expect(orderRunRecords(p, rt.state.steps).map((s) => `${s.stepId}:${s.pass ?? ''}:${s.status}`)).toEqual(
      sum.steps.map((s) => `${s.stepId}:${s.pass ?? ''}:${s.status}`),
    );
  });

  it('sends a Station parallel material conflict to the Station sequence and says 갈래', () => {
    const base = buildSampleProject();
    const ids = base.sequence.steps.slice(1, 3).map((s) => s.id);
    const wrapped = C.wrapFlow(base, ids, 'parallel');
    expect(wrapped.ok).toBe(true);
    if (!wrapped.ok) return;
    const moved = C.moveFlowInto(wrapped.project, ids[1], wrapped.note!, 1);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    const ready = checkRunReadiness(moved.project);
    const hit = ready.blockers.find((b) => b.code === 'SHARED_MATERIAL_CONFLICT');
    expect(hit?.message).toContain('갈래가');
    expect(hit?.message).not.toContain('시퀀스');
    const guide = resolveBlocker(moved.project, hit!, ready.blockers);
    expect(destLabel(guide.dest!)).toBe('4 자재·시퀀스 › Station 시퀀스');
  });

  it('prefixes a signal choice with the Device name', () => {
    const p = buildSampleProject();
    const sig = p.signals.find((s) => s.deviceId === 'STP-02' && s.portKey === 'upDone')!;
    expect(signalChoiceLabel(p, sig.id, true)).toBe('STP-02 · 상승 완료 = 참');
  });
});

const asNode = (p: Project, id: string): FlowNode => {
  const hit = findById(p.sequence.flow ?? [], id);
  if (!hit) throw new Error(`missing ${id}`);
  return hit.node;
};

describe('TURN-023 flow edit polish', () => {
  it('AC2 titles repeat the kind word only when the name is different', () => {
    expect(flowBlockTitle('branch', '분기')).toBe('분기');
    expect(flowBlockTitle('branch', '  분기  ')).toBe('분기');
    expect(flowBlockTitle('branch', '검사 결과')).toBe('분기 검사 결과');
    expect(flowBlockTitle('parallel', '병렬')).toBe('병렬');
    expect(flowBlockTitle('parallel', '이송과 정지')).toBe('병렬 이송과 정지');
    expect(flowBlockTitle('loop', '반복')).toBe('반복');
    expect(flowBlockTitle('loop', '가공 반복')).toBe('반복 가공 반복');
    expect(flowBlockTitle('retry', '재시도')).toBe('재시도');
    expect(flowBlockTitle('retry', '읽기 재시도')).toBe('재시도 읽기 재시도');
  });

  it('AC1 rename rejects an empty name, keeps the old name, and undo restores it', () => {
    const p0 = buildFlowSampleProject();
    const before = structuredClone(asNode(p0, 'FLW-BRANCH'));
    expect(C.renameFlowBlock(p0, 'FLW-BRANCH', '   ').ok).toBe(false);
    expect(asNode(p0, 'FLW-BRANCH')).toEqual(before);
    const h0 = initHistory(p0);
    const renamed = applyEdit(h0, C.renameFlowBlock(p0, 'FLW-BRANCH', ' 검사 결과 '), '블록 이름', false);
    expect(renamed.error).toBeUndefined();
    expect((asNode(renamed.history.present, 'FLW-BRANCH') as { name: string }).name).toBe('검사 결과');
    const back = undo(renamed.history, false);
    expect((asNode(back.history.present, 'FLW-BRANCH') as { name: string }).name).toBe('읽기 결과');
    const locked = applyEdit(h0, C.renameFlowBlock(p0, 'FLW-BRANCH', '다른 이름'), '블록 이름', true);
    expect(locked.error).toContain('실행 중');
    expect(locked.history.present).toEqual(p0);
  });

  it('AC3 moves a block and a substation step without dropping what is inside', () => {
    const p0 = buildFlowSampleProject();
    const retry = structuredClone(asNode(p0, 'FLW-RETRY'));
    const down = C.moveFlowNode(p0, 'FLW-RETRY', 1);
    expect(down.ok).toBe(true);
    if (!down.ok) return;
    expect(asNode(down.project, 'FLW-RETRY')).toEqual(retry);
    expect(down.project.sequence.flow!.map((n) => n.kind === 'step' ? n.stepId : n.id)[3]).toBe('FLW-RETRY');
    const stuck = C.moveFlowNode(p0, p0.sequence.flow![0].kind === 'step' ? p0.sequence.flow![0].stepId : '', -1);
    expect(stuck.ok).toBe(false);
    if (stuck.ok) return;
    expect(stuck.reason).toBe('이동 불가');
    const out = C.moveFlowOut(p0, 'FLW-LOOP');
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.project.sequence.flow!.some((n) => n.kind !== 'step' && n.id === 'FLW-LOOP')).toBe(true);
    expect(asNode(out.project, 'FLW-LOOP')).toEqual(asNode(p0, 'FLW-LOOP'));
    const outside = C.moveFlowOut(p0, 'FLW-RETRY');
    expect(outside.ok).toBe(false);
    if (outside.ok) return;
    expect(outside.reason).toBe('이미 맨 바깥입니다');

    const added = C.addSubstationNode(p0, p0.units[0].id, () => 'FLW-SUB');
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const last = added.project.sequence.flow!.length - 1;
    expect(added.project.sequence.flow![last]).toMatchObject({ kind: 'substation', id: 'FLW-SUB' });
    const up = C.moveFlowNode(added.project, 'FLW-SUB', -1);
    expect(up.ok).toBe(true);
    if (!up.ok) return;
    expect(findById(up.project.sequence.flow!, 'FLW-SUB')!.index).toBe(last - 1);
    expect(asNode(up.project, 'FLW-SUB')).toMatchObject({ kind: 'substation', unitId: p0.units[0].id });
  });

  it('AC4 inserts a block or substation into an arm and rejects nesting into itself or a parallel lane', () => {
    const p0 = buildFlowSampleProject();
    const into = C.moveFlowInto(p0, 'FLW-RETRY', 'FLW-BRANCH', 'else');
    expect(into.ok).toBe(true);
    if (!into.ok) return;
    const branch = asNode(into.project, 'FLW-BRANCH');
    expect(branch.kind).toBe('branch');
    if (branch.kind !== 'branch') return;
    expect(branch.else.map((n) => n.kind === 'step' ? n.stepId : n.id)).toContain('FLW-RETRY');
    expect(asNode(into.project, 'FLW-RETRY')).toEqual(asNode(p0, 'FLW-RETRY'));

    const self = C.moveFlowInto(p0, 'FLW-BRANCH', 'FLW-BRANCH', 'then');
    expect(self.ok).toBe(false);
    if (self.ok) return;
    expect(self.reason).toBe('블록을 자기 자신 안에 넣을 수 없습니다');

    const added = C.addSubstationNode(p0, p0.units[0].id, () => 'FLW-SUB');
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const nested = C.moveFlowInto(added.project, 'FLW-SUB', 'FLW-PAR', 0);
    expect(nested.ok).toBe(false);
    if (nested.ok) return;
    expect(nested.reason).toBe('병렬 갈래 안에는 병렬과 Substation 단계를 넣지 않습니다');
    const parked = C.moveFlowInto(added.project, 'FLW-SUB', 'FLW-LOOP', 'body');
    expect(parked.ok).toBe(true);

    const base = buildSampleProject();
    const ids = base.sequence.steps.slice(0, 4).map((s) => s.id);
    const first = C.wrapFlow(base, ids.slice(0, 2), 'parallel', () => 'P1');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = C.wrapFlow(first.project, ids.slice(2, 4), 'parallel', () => 'P2');
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const clash = C.moveFlowInto(second.project, 'P2', 'P1', 0);
    expect(clash.ok).toBe(false);
    if (clash.ok) return;
    expect(clash.reason).toBe('병렬 갈래 안에는 병렬과 Substation 단계를 넣지 않습니다');
  });

  it('AC5 wraps a mixed consecutive run and keeps the parallel-lane rule', () => {
    const p0 = buildFlowSampleProject();
    const step = p0.sequence.flow![1];
    const stepId = step.kind === 'step' ? step.stepId : '';
    const retry = structuredClone(asNode(p0, 'FLW-RETRY'));
    for (const kind of ['branch', 'loop', 'retry'] as const) {
      const wrapped = C.wrapFlow(p0, [stepId, 'FLW-RETRY'], kind, () => `W-${kind}`);
      expect(wrapped.ok, kind).toBe(true);
      if (!wrapped.ok) return;
      const block = asNode(wrapped.project, `W-${kind}`);
      const body = block.kind === 'branch' ? block.then : block.kind === 'loop' || block.kind === 'retry' ? block.body : [];
      expect(body.map((n) => n.kind === 'step' ? n.stepId : n.id)).toEqual([stepId, 'FLW-RETRY']);
      expect(body[1]).toEqual(retry);
    }
    const parallel = C.wrapFlow(p0, ['FLW-RETRY', 'FLW-BRANCH'], 'parallel');
    expect(parallel.ok).toBe(false);
    if (parallel.ok) return;
    expect(parallel.reason).toBe('병렬 갈래 안에는 병렬과 Substation 단계를 넣지 않습니다');
    const gap = C.wrapFlow(p0, [p0.sequence.flow![0].kind === 'step' ? p0.sequence.flow![0].stepId : '', 'FLW-RETRY'], 'loop');
    expect(gap.ok).toBe(false);
    if (gap.ok) return;
    expect(gap.reason).toBe('같은 갈래에서 연속된 단계만 묶을 수 있습니다');

    const base = buildSampleProject();
    const ids = base.sequence.steps.slice(0, 2).map((s) => s.id);
    const lane = C.wrapFlow(base, ids, 'parallel', () => 'P1');
    expect(lane.ok).toBe(true);
    if (!lane.ok) return;
    const nested = C.wrapFlow(lane.project, ids, 'parallel');
    expect(nested.ok).toBe(false);
    if (nested.ok) return;
    expect(nested.reason).toBe('병렬 갈래 안에는 병렬과 Substation 단계를 넣지 않습니다');
    expect(C.wrapFlow(lane.project, ids, 'loop').ok).toBe(true);

    const sample = buildSampleProject();
    const sub = C.addSubstationNode(sample, sample.units[0].id, () => 'FLW-SUB');
    expect(sub.ok).toBe(true);
    if (!sub.ok) return;
    const prev = sub.project.sequence.flow![sub.project.sequence.flow!.length - 2];
    const prevId = prev.kind === 'step' ? prev.stepId : prev.id;
    const withSub = C.wrapFlow(sub.project, [prevId, 'FLW-SUB'], 'parallel');
    expect(withSub.ok).toBe(false);
    if (withSub.ok) return;
    expect(withSub.reason).toBe('병렬 갈래 안에는 병렬과 Substation 단계를 넣지 않습니다');
    const around = C.wrapFlow(sub.project, [prevId, 'FLW-SUB'], 'loop', () => 'WITH-SUB');
    expect(around.ok).toBe(true);
    if (!around.ok) return;
    const loop = asNode(around.project, 'WITH-SUB');
    expect(loop.kind).toBe('loop');
    if (loop.kind === 'loop') expect(loop.body.some((n) => n.kind === 'substation' && n.id === 'FLW-SUB')).toBe(true);
  });

  it('AC7 samples keep their times and the file and runtime versions stay put', () => {
    expect(FILE_FORMAT_VERSION).toBe('0.3.0');
    expect(RUNTIME_RULES_VERSION).toBe('seq-runtime/0.3.0');
    expect(runToEnd(createRuntime(buildFlowSampleProject())).state.timeMs).toBe(13100);
    expect(runToEnd(createRuntime(buildParallelSampleProject())).state.timeMs).toBe(2500);
    expect(runToEnd(createRuntime(buildSampleProject())).state.timeMs).toBe(11100);
  });
});

describe('flow file stays valid', () => {
  it('examples have no reference errors', () => {
    for (const p of [buildSampleProject(), buildParallelSampleProject(), buildFlowSampleProject()]) {
      expect(validateProject(p).filter((d) => d.severity === 'error')).toEqual([]);
    }
  });
});
