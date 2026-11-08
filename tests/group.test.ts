import { describe, expect, it } from 'vitest';
import { buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import { advanceGroup, checkGroupReadiness, createGroupRuntime, pauseGroup, resetGroup, resumeGroup, runGroupToEnd, startGroup } from '../src/runtime/group';
import * as C from '../src/model/commands';
import type { CmdResult } from '../src/model/commands';
import { validateProject } from '../src/model/validate';
import { parseProjectFile, serializeProject } from '../src/storage/fileFormat';
import { createRuntime, runToEnd } from '../src/runtime/engine';
import type { Project } from '../src/model/types';
type R = { ok: boolean; project: Project; note: string; reason: string };
const W = <A extends unknown[]>(f: (...a: A) => CmdResult) => (...a: A): R => f(...a) as unknown as R;
const addSubSequence = W(C.addSubSequence), addSubStep = W(C.addSubStep), deleteNode = W(C.deleteNode), deleteSubSequence = W(C.deleteSubSequence);
const moveSubStep = W(C.moveSubStep), removeSubStep = W(C.removeSubStep), renameSubSequence = W(C.renameSubSequence);
const last = <T,>(a: T[]): T | undefined => a[a.length - 1];

const S1 = 'U-PS1';
let k = 0; const idOf = (p: string) => `${p}-t${++k}`;

describe('Substation group runtime (v0.3)', () => {
  it('parallel sample: two independent sequences in S1 run to completion on one clock', () => {
    const p = buildParallelSampleProject();
    expect(validateProject(p).filter((d) => d.severity === 'error')).toEqual([]);
    const r0 = checkGroupReadiness(p, S1);
    expect(r0.ok).toBe(true);
    const r = runGroupToEnd(createGroupRuntime(p, S1));
    expect(r.state.status).toBe('completed');
    expect(r.state.lanes.map((l) => [l.status, l.endMs])).toEqual([['done', 1200], ['done', 1600]]);
    expect(r.state.timeMs).toBe(1600);
    // both lanes start at t=0 (truly concurrent)
    expect(r.state.log.filter((e) => e.code === 'STEP_START' && e.t === 0)).toHaveLength(2);
    expect(last(r.state.log)?.code).toBe('GROUP_COMPLETE');
  });

  it('S2 single-sequence group also completes; original 5-step Station sample unchanged', () => {
    const p = buildParallelSampleProject();
    expect(runGroupToEnd(createGroupRuntime(p, 'U-PS2')).state.status).toBe('completed');
    const r = runToEnd(createRuntime(buildSampleProject()));
    expect(r.state.status).toBe('completed');
  });

  it('result is independent of dt chunking', () => {
    const p = buildParallelSampleProject();
    const a = runGroupToEnd(createGroupRuntime(p, S1)).state;
    let r = startGroup(createGroupRuntime(p, S1));
    for (let i = 0; i < 400 && r.state.status === 'running'; i++) r = advanceGroup(r, 7);
    expect(r.state.status).toBe('completed');
    expect(r.state.log).toEqual(a.log);
    expect(r.state.lanes).toEqual(a.lanes);
  });

  it('group pause freezes all lanes; resume keeps remaining time; reset restores initial', () => {
    const p = buildParallelSampleProject();
    let r = advanceGroup(startGroup(createGroupRuntime(p, S1)), 300);
    r = pauseGroup(r);
    expect(r.state.status).toBe('paused');
    const frozen = structuredClone(r.state);
    r = advanceGroup(r, 5000); // ignored while paused
    expect(r.state.timeMs).toBe(300);
    expect(r.state.lanes).toEqual(frozen.lanes);
    expect(r.state.lanes.every((l) => l.status === 'active')).toBe(true);
    r = resumeGroup(r);
    expect(last(r.state.log)?.message).toContain('0.200s'); // lane A: 0.5 - 0.3
    r = advanceGroup(r, 199);
    expect(r.state.lanes[0].steps[0].status).toBe('active');
    r = advanceGroup(r, 1);
    expect(r.state.lanes[0].steps[0]).toMatchObject({ status: 'done', endMs: 500 });
    r = runGroupToEnd(r);
    expect(r.state.lanes.map((l) => l.endMs)).toEqual([1200, 1600]); // same as unpaused
    const z = resetGroup(r);
    expect(z.state.status).toBe('idle');
    expect(z.state.timeMs).toBe(0);
    expect(z.state.log).toEqual([]);
    expect(z.state.lanes.every((l) => l.status === 'pending' && l.stepIndex === 0)).toBe(true);
  });

  it('DEVICE_CONFLICT: same device in two sequences is blocked before run', () => {
    const p = buildParallelSampleProject();
    const q = p.substationSequences!.find((x) => x.id === 'SSEQ-S1-A')!;
    q.steps.push({ id: 'SSTEP-X', name: 'conflict', actionId: p.actions.find((a) => a.deviceId === 'CYL-B1')!.id, timeoutOverride: null, entry: [], origin: 'dnd' });
    const r = checkGroupReadiness(p, S1);
    expect(r.ok).toBe(false);
    expect(r.blockers.map((b) => b.code)).toContain('DEVICE_CONFLICT');
    const run = startGroup(createGroupRuntime(p, S1));
    expect(run.state.status).toBe('idle');
    expect(run.state.log[0].code).toBe('NOT_READY');
  });

  it('SHARED_MATERIAL_CONFLICT: two sequences touching the material are blocked', () => {
    const p = buildSampleProject(); // has a material; build 2 sub sequences in the stopper unit
    const unit = p.units[0];
    const devs = p.devices.filter((d) => d.unitId === unit.id);
    const matActs = p.actions.filter((a) => devs.some((d) => d.id === a.deviceId) && (a.effect.moveTo || a.effect.holder !== undefined || a.effect.setState));
    expect(devs.length).toBeGreaterThan(0);
    // fabricate material effects on two different devices of the same unit if the sample has fewer
    let r = addSubSequence(p, unit.id, 'A', idOf); let pp = (r as { project: Project }).project; const qa = (r as { note: string }).note;
    r = addSubSequence(pp, unit.id, 'B', idOf); pp = r.project; const qb = (r as { note: string }).note;
    const a1 = pp.actions.find((a) => a.deviceId === devs[0].id)!;
    const extraDev = pp.devices.find((d) => d.unitId === unit.id && d.id !== devs[0].id);
    let a2;
    if (extraDev) a2 = pp.actions.find((a) => a.deviceId === extraDev.id)!;
    else { // add a second stopper to the unit
      pp = structuredClone(pp); a2 = structuredClone(a1); a2.id = 'ACT-X2'; const d2 = structuredClone(devs[0]); d2.id = 'DEV-X2'; a2.deviceId = d2.id; a2.completeSignalId = a1.completeSignalId && 'SIG-X2';
      pp.devices.push(d2); unit.deviceIds.push(d2.id); pp.units[0].deviceIds.push(d2.id); pp.actions.push(a2);
      pp.signals.push({ ...structuredClone(pp.signals.find((s) => s.id === a1.completeSignalId)!), id: 'SIG-X2', deviceId: d2.id, address: '' });
    }
    pp = addSubStep(pp, qa, a1.id, idOf).project; pp = addSubStep(pp, qb, a2!.id, idOf).project;
    pp = structuredClone(pp);
    pp.actions.find((a) => a.id === a1.id)!.effect = { setState: 'X' };
    pp.actions.find((a) => a.id === a2!.id)!.effect = { holder: null };
    void matActs;
    const rr = checkGroupReadiness(pp, unit.id);
    expect(rr.blockers.map((b) => b.code)).toContain('SHARED_MATERIAL_CONFLICT');
    expect(rr.blockers.map((b) => b.code)).not.toContain('DEVICE_CONFLICT');
  });

  it('conservative group stop: a timeout in one lane stops the other lane', () => {
    const p = buildParallelSampleProject();
    const a = p.actions.find((x) => x.deviceId === 'STP-A1')!;
    p.simSettings.faults.neverTrueSignalIds = [a.completeSignalId!];
    const r = runGroupToEnd(createGroupRuntime(p, S1));
    expect(r.state.status).toBe('error');
    expect(r.state.error?.code).toBe('TIMEOUT');
    expect(r.state.error?.seqId).toBe('SSEQ-S1-A');
    expect(r.state.lanes[1].status).toBe('stopped');
    expect(last(r.state.log)?.code).toBe('GROUP_STOPPED');
  });

  it('empty substation / sequence without steps / device outside substation are blocked', () => {
    const p = buildParallelSampleProject();
    expect(checkGroupReadiness({ ...p, substationSequences: [] }, S1).blockers.map((b) => b.code)).toContain('NO_SUB_SEQUENCES');
    const r = addSubSequence(p, S1, '', idOf);
    expect(checkGroupReadiness(r.project, S1).blockers.map((b) => b.code)).toContain('NO_STEPS');
    const out = addSubStep(r.project, (r as { note: string }).note, p.actions.find((a) => a.deviceId === 'PSH-21')!.id, idOf);
    expect(out.ok).toBe(false);
    expect((out as { reason: string }).reason).toContain('다른 Substation');
  });
});

describe('Substation sequence commands, validation and v0.1 migration', () => {
  it('add / rename / step add / move / remove / delete', () => {
    const p = buildParallelSampleProject();
    let r = addSubSequence(p, S1, '새 시퀀스', idOf); expect(r.ok).toBe(true);
    const id = (r as { note: string }).note; let pp = r.project;
    pp = renameSubSequence(pp, id, '이름변경').project;
    const acts = pp.actions.filter((a) => a.deviceId === 'STP-A1');
    pp = addSubStep(pp, id, acts[0].id, idOf).project; pp = addSubStep(pp, id, acts[1].id, idOf).project;
    let q = pp.substationSequences!.find((x) => x.id === id)!;
    expect(q.name).toBe('이름변경'); expect(q.steps.map((s) => s.actionId)).toEqual([acts[0].id, acts[1].id]);
    pp = moveSubStep(pp, id, 0, 1).project;
    q = pp.substationSequences!.find((x) => x.id === id)!;
    expect(q.steps.map((s) => s.actionId)).toEqual([acts[1].id, acts[0].id]);
    pp = removeSubStep(pp, id, q.steps[0].id).project;
    expect(pp.substationSequences!.find((x) => x.id === id)!.steps).toHaveLength(1);
    expect(validateProject(pp).filter((d) => d.severity === 'error')).toEqual([]);
    pp = deleteSubSequence(pp, id).project;
    expect(pp.substationSequences!.some((x) => x.id === id)).toBe(false);
    expect(p.substationSequences).toHaveLength(3); // original untouched (immutable commands)
  });

  it('deleting a device removes its sub steps; deleting a unit removes its sequences', () => {
    const p = buildParallelSampleProject();
    const d = deleteNode(p, 'CYL-B1').project;
    expect(d.substationSequences!.find((x) => x.id === 'SSEQ-S1-B')!.steps.map((s) => s.id)).toEqual(['SSTEP-B1', 'SSTEP-B3']);
    const u = deleteNode(p, 'U-PS2').project;
    expect(u.substationSequences!.map((x) => x.id)).toEqual(['SSEQ-S1-A', 'SSEQ-S1-B']);
    expect(validateProject(u).filter((x) => x.severity === 'error')).toEqual([]);
  });

  it('validation catches dangling sub-sequence refs', () => {
    const p = buildParallelSampleProject();
    const bad: Project = structuredClone(p);
    bad.substationSequences![0].unitId = 'U-NOPE';
    bad.substationSequences![1].steps[0].actionId = 'ACT-NOPE';
    const codes = validateProject(bad).filter((d) => d.severity === 'error').map((d) => d.code);
    expect(codes.length).toBeGreaterThanOrEqual(2);
  });

  it('v0.2 file round-trips sub sequences; v0.1.x file is migrated with a warning', () => {
    const p = buildParallelSampleProject();
    const back = parseProjectFile(serializeProject(p)) as unknown as { ok: boolean; project: Project; warnings: { code: string }[] };
    expect(back.ok).toBe(true);
    expect(back.project.substationSequences).toEqual(p.substationSequences);
    const old = JSON.parse(serializeProject(buildSampleProject()));
    old.formatVersion = '0.1.0'; delete old.project.substationSequences;
    const m = parseProjectFile(JSON.stringify(old)) as unknown as { ok: boolean; project: Project; warnings: { code: string }[] };
    expect(m.ok).toBe(true);
    expect(m.project.substationSequences).toEqual([]);
    expect(m.warnings.map((w: { code: string }) => w.code)).toContain('MIGRATED_FORMAT');
    expect(runToEnd(createRuntime(m.project)).state.status).toBe('completed');
  });
});
