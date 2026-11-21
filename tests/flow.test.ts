import { describe, expect, it } from 'vitest';
import { applyEdit, initHistory, undo } from '../src/model/history';
import { buildFlowSampleProject, buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import * as C from '../src/model/commands';
import { DEFAULT_MAX_RETRIES, FILE_FORMAT_VERSION } from '../src/model/types';
import { checkRunReadiness, validateProject } from '../src/model/validate';
import { advance, createRuntime, pause, resume, runToEnd, start } from '../src/runtime/engine';
import { parseProjectFile, serializeProject } from '../src/storage/fileFormat';
import type { Project } from '../src/model/types';

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

describe('flow file stays valid', () => {
  it('examples have no reference errors', () => {
    for (const p of [buildSampleProject(), buildParallelSampleProject(), buildFlowSampleProject()]) {
      expect(validateProject(p).filter((d) => d.severity === 'error')).toEqual([]);
    }
  });
});
