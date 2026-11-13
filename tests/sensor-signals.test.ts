import { describe, expect, it } from 'vitest';
import * as C from '../src/model/commands';
import type { CmdResult } from '../src/model/commands';
import { emptyProject } from '../src/model/factory';
import { buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import { FILE_FORMAT_VERSION, GROUP_RULES_VERSION, RUNTIME_RULES_VERSION, type ActionKind, type AssetKind, type Project } from '../src/model/types';
import { parseProjectFile, serializeProject } from '../src/storage/fileFormat';
import { advance, createRuntime, pause, reset, resume, runToEnd, start, SENSOR_HINT } from '../src/runtime/engine';
import { advanceGroup, createGroupRuntime, resetGroup, runGroupToEnd, startGroup } from '../src/runtime/group';

const okp = (r: CmdResult): Project => {
  if (!r.ok) throw new Error(r.reason);
  return r.project;
};
const take = (r: CmdResult): { project: Project; note: string } => {
  if (!r.ok) throw new Error(r.reason);
  return { project: r.project, note: r.note ?? '' };
};

let n = 0;
const idOf = (p: string) => `${p}-t17-${++n}`;

function actionOf(p: Project, deviceKind: AssetKind, kind: ActionKind) {
  const ids = new Set(p.devices.filter((d) => d.kind === deviceKind).map((d) => d.id));
  const a = p.actions.find((x) => ids.has(x.deviceId) && x.kind === kind);
  if (!a) throw new Error(`no ${deviceKind} ${kind}`);
  return a;
}

function withMaterial(p: Project, unitId: string): Project {
  p = okp(C.addMaterial(p, idOf));
  return okp(C.updateMaterial(p, p.materials[0].id, { initialLocation: unitId }));
}

/** Empty project + one unit template + one material. */
function templateProject(kind: 'unitInput' | 'unitIdentify' | 'unitTransfer', where: 'here' | 'other'): Project {
  let p = emptyProject('센서', idOf);
  const placed = C.addUnitFromTemplate(p, kind, { x: 40, y: 40 }, idOf);
  p = okp(placed);
  const here = p.units[0].id;
  if (where === 'other') p = okp(C.addUnit(p, '다른 유닛', { x: 400, y: 40 }, idOf));
  const loc = where === 'here' ? here : p.units[1].id;
  return withMaterial(p, loc);
}

function addSteps(p: Project, actionIds: string[]): Project {
  for (const id of actionIds) p = okp(C.addStep(p, id, undefined, 'dnd', undefined, idOf));
  return p;
}

const sensorOn = (p: Project, rtSignals: Record<string, boolean>, unitId: string) =>
  p.signals.filter((s) => s.role === 'sensor' && p.devices.find((d) => d.id === s.deviceId)?.unitId === unitId).every((s) => rtSignals[s.id] === true);

describe('sensor signals — unit templates (AC1–AC3)', () => {
  it('AC1 투입: 푸시 → 실린더 전진 completes when the material starts in that Unit', () => {
    let p = templateProject('unitInput', 'here');
    const unitId = p.units[0].id;
    p = addSteps(p, [actionOf(p, 'pusher', 'extend').id, actionOf(p, 'cylinder', 'extend').id]);
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.status).toBe('completed');
    expect(rt.state.material?.location).toBe(unitId);
    expect(sensorOn(p, rt.state.signals, unitId)).toBe(true);
    const on = rt.state.log.filter((l) => l.code === 'SENSOR_ON');
    expect(on.length).toBeGreaterThan(0);
    expect(on[0].message).toContain('광 검출(자재 있음)');
  });

  it('AC2 식별: 스토퍼 상승 → 읽기 completes; 이송: 갠트리 이동 → 잡기 completes', () => {
    let idn = templateProject('unitIdentify', 'here');
    idn = addSteps(idn, [actionOf(idn, 'stopper', 'raise').id, actionOf(idn, 'barcodeReader', 'read').id]);
    const idRun = runToEnd(createRuntime(idn));
    expect(idRun.state.status).toBe('completed');
    expect(sensorOn(idn, idRun.state.signals, idn.units[0].id)).toBe(true);

    let tr = templateProject('unitTransfer', 'here');
    const limit = tr.signals.find((s) => s.name.includes('끝단 접점'))!;
    expect(createRuntime(tr).state.signals[limit.id]).toBe(true);
    tr = addSteps(tr, [actionOf(tr, 'gantry', 'move').id, actionOf(tr, 'picker', 'pick').id]);
    const trRun = runToEnd(createRuntime(tr));
    expect(trRun.state.status).toBe('completed');
    expect(trRun.state.signals[limit.id]).toBe(true);
  });

  it('AC3 material in another Unit stops with the signal name and the sensor hint, not the id alone', () => {
    let p = templateProject('unitInput', 'other');
    const push = actionOf(p, 'pusher', 'extend');
    p = addSteps(p, [push.id, actionOf(p, 'cylinder', 'extend').id]);
    const photo = p.signals.find((s) => s.role === 'sensor')!;
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.status).toBe('error');
    expect(rt.state.error?.code).toBe('PRE_UNMET');
    const msg = rt.state.error?.message ?? '';
    expect(msg).toContain('광 검출(자재 있음)');
    expect(msg).toContain(p.devices.find((d) => d.id === photo.deviceId)!.name);
    expect(msg).toContain(SENSOR_HINT);
    expect(msg).not.toContain(photo.id);
    expect(msg).not.toMatch(/sig-t17-/);
  });
});

describe('sensor signals — move, time, and names (AC4 AC5)', () => {
  function twoUnits() {
    let p = emptyProject('이동', idOf);
    p = okp(C.addUnit(p, '출발', { x: 40, y: 40 }, idOf));
    const from = p.units[0].id;
    p = okp(C.addUnit(p, '도착', { x: 400, y: 40 }, idOf));
    const to = p.units[1].id;
    const sensA = take(C.addDevice(p, 'photoelectricSensor', { x: 50, y: 80 }, '감지A', idOf, from));
    p = sensA.project;
    const sensB = take(C.addDevice(p, 'sensor', { x: 420, y: 80 }, '감지B', idOf, to));
    p = sensB.project;
    const pusher = take(C.addDevice(p, 'pusher', { x: 60, y: 140 }, '푸셔A', idOf, from));
    p = pusher.project;
    const made = take(C.addSignal(p, pusher.note, 'out', 'sensor', idOf));
    p = made.project;
    p = withMaterial(p, from);
    return { p, from, to, pusherId: pusher.note, madeId: made.note };
  }

  function sig(p: Project, deviceId: string) {
    const s = p.signals.find((x) => x.deviceId === deviceId && x.role === 'sensor');
    if (!s) throw new Error('sensor missing');
    return s;
  }

  it('AC4 moving the material turns the left Unit off and the arrived Unit on; EXIT turns them all off', () => {
    const built = twoUnits();
    let p = built.p;
    const push = p.actions.find((a) => a.deviceId === built.pusherId && a.kind === 'extend')!;
    p = okp(C.updateAction(p, push.id, { effect: { moveTo: built.to } }));
    p = addSteps(p, [push.id]);
    const a = sig(p, p.devices.find((d) => d.name === '감지A')!.id);
    const b = sig(p, p.devices.find((d) => d.name === '감지B')!.id);
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.status).toBe('completed');
    expect(rt.state.material?.location).toBe(built.to);
    expect(rt.state.signals[a.id]).toBe(false);
    expect(rt.state.signals[built.madeId]).toBe(false);
    expect(rt.state.signals[b.id]).toBe(true);
    const codes = rt.state.log.filter((l) => l.code === 'SENSOR_ON' || l.code === 'SENSOR_OFF').map((l) => `${l.code}:${l.message}`);
    expect(codes.some((c) => c.startsWith('SENSOR_OFF') && c.includes('감지A'))).toBe(true);
    expect(codes.some((c) => c.startsWith('SENSOR_OFF') && c.includes('푸셔A'))).toBe(true);
    expect(codes.some((c) => c.startsWith('SENSOR_ON') && c.includes('감지B'))).toBe(true);

    let exitP = built.p;
    const push2 = exitP.actions.find((a0) => a0.deviceId === built.pusherId && a0.kind === 'extend')!;
    exitP = okp(C.updateAction(exitP, push2.id, { effect: { moveTo: 'EXIT' } }));
    exitP = addSteps(exitP, [push2.id]);
    const gone = runToEnd(createRuntime(exitP));
    expect(gone.state.material?.location).toBe('EXIT');
    expect(exitP.signals.filter((s) => s.role === 'sensor').every((s) => gone.state.signals[s.id] === false)).toBe(true);
    expect(gone.state.log.some((l) => l.code === 'SENSOR_OFF')).toBe(true);
  });

  it('AC5 chunking, pause, and reset keep the same sensor rule', () => {
    let p = templateProject('unitInput', 'here');
    p = addSteps(p, [actionOf(p, 'pusher', 'extend').id, actionOf(p, 'cylinder', 'extend').id]);
    const whole = runToEnd(createRuntime(p));
    let stepped = start(createRuntime(p));
    while (stepped.state.status === 'running') stepped = advance(stepped, 100);
    const interesting = (r: typeof whole) => r.state.log.filter((l) => l.code.startsWith('STEP') || l.code.startsWith('SENSOR') || l.code === 'RUN_COMPLETE').map((l) => [l.t, l.code, l.refId]);
    expect(stepped.state.status).toBe('completed');
    expect(interesting(stepped)).toEqual(interesting(whole));
    expect(stepped.state.signals).toEqual(whole.state.signals);
    expect(stepped.state.material).toEqual(whole.state.material);

    let paused = advance(start(createRuntime(p)), 100);
    expect(paused.state.steps.some((s) => s.status === 'active')).toBe(true);
    const mid = { ...paused.state.signals };
    paused = advance(pause(paused), 99999);
    expect(paused.state.timeMs).toBe(100);
    expect(paused.state.signals).toEqual(mid);
    paused = runToEnd(resume(paused));
    expect(paused.state.status).toBe('completed');
    expect(paused.state.signals).toEqual(whole.state.signals);

    const fresh = createRuntime(p);
    const back = reset(whole);
    expect(back.state.status).toBe('idle');
    expect(back.state.signals).toEqual(fresh.state.signals);
    expect(back.state.material).toEqual(fresh.state.material);
    expect(back.state.log).toEqual(fresh.state.log);
  });

  it('POST_UNMET and TIMEOUT name the signal and do not print its id', () => {
    let p = templateProject('unitInput', 'here');
    const push = actionOf(p, 'pusher', 'extend');
    const photo = p.signals.find((s) => s.role === 'sensor')!;
    p = okp(C.updateAction(p, push.id, { post: [{ kind: 'signal', signalId: photo.id, equals: false }] }));
    p = addSteps(p, [push.id]);
    const post = runToEnd(createRuntime(p));
    expect(post.state.error?.code).toBe('POST_UNMET');
    expect(post.state.error?.message).toContain('광 검출(자재 있음)');
    expect(post.state.error?.message).toContain(SENSOR_HINT);
    expect(post.state.error?.message).not.toContain(photo.id);
    expect(post.state.material?.location).toBe(p.units[0].id);

    let q = templateProject('unitInput', 'here');
    const push2 = actionOf(q, 'pusher', 'extend');
    q = addSteps(q, [push2.id]);
    q.simSettings.faults.neverTrueSignalIds = [push2.completeSignalId!];
    const timed = runToEnd(createRuntime(q));
    expect(timed.state.error?.code).toBe('TIMEOUT');
    expect(timed.state.error?.message).toContain('푸시 완료');
    expect(timed.state.error?.message).toContain(q.devices.find((d) => d.id === push2.deviceId)!.name);
    expect(timed.state.error?.message).not.toContain(push2.completeSignalId);
  });
});

describe('sensor signals — group runtime (AC6)', () => {
  it('a template Action in a Substation group runs, and a move updates sensors the same way', () => {
    let p = templateProject('unitInput', 'here');
    const unitId = p.units[0].id;
    const seq = take(C.addSubSequence(p, unitId, '투입', idOf));
    p = seq.project;
    p = okp(C.addSubStep(p, seq.note, actionOf(p, 'pusher', 'extend').id, idOf));
    p = okp(C.addSubStep(p, seq.note, actionOf(p, 'cylinder', 'extend').id, idOf));
    const g = runGroupToEnd(createGroupRuntime(p, unitId));
    expect(g.state.status).toBe('completed');
    expect(g.state.rulesVersion).toBe('group-runtime/0.2.0');
    expect(sensorOn(p, g.state.signals, unitId)).toBe(true);
    expect(g.state.log.some((l) => l.code === 'SENSOR_ON' && l.message.includes('광 검출(자재 있음)'))).toBe(true);

    let bad = templateProject('unitInput', 'other');
    const unitBad = bad.units[0].id;
    const seqBad = take(C.addSubSequence(bad, unitBad, '투입', idOf));
    bad = seqBad.project;
    bad = okp(C.addSubStep(bad, seqBad.note, actionOf(bad, 'pusher', 'extend').id, idOf));
    const photo = bad.signals.find((s) => s.role === 'sensor' && bad.devices.find((d) => d.id === s.deviceId)?.unitId === unitBad)!;
    const stopped = runGroupToEnd(createGroupRuntime(bad, unitBad));
    expect(stopped.state.error?.code).toBe('PRE_UNMET');
    expect(stopped.state.error?.message).toContain('광 검출(자재 있음)');
    expect(stopped.state.error?.message).toContain(SENSOR_HINT);
    expect(stopped.state.error?.message).not.toContain(photo.id);

    let moved = templateProject('unitInput', 'here');
    const from = moved.units[0].id;
    moved = okp(C.addUnit(moved, '도착', { x: 400, y: 40 }, idOf));
    const to = moved.units[1].id;
    const extra = take(C.addDevice(moved, 'proximitySensor', { x: 420, y: 80 }, '도착감지', idOf, to));
    moved = extra.project;
    const push = actionOf(moved, 'pusher', 'extend');
    moved = okp(C.updateAction(moved, push.id, { effect: { moveTo: to } }));
    const seqM = take(C.addSubSequence(moved, from, '이동', idOf));
    moved = seqM.project;
    moved = okp(C.addSubStep(moved, seqM.note, push.id, idOf));
    const ran = runGroupToEnd(createGroupRuntime(moved, from));
    expect(ran.state.status).toBe('completed');
    expect(ran.state.material?.location).toBe(to);
    const left = moved.signals.find((s) => s.role === 'sensor' && moved.devices.find((d) => d.id === s.deviceId)?.unitId === from)!;
    const arrived = moved.signals.find((s) => s.deviceId === extra.note)!;
    expect(ran.state.signals[left.id]).toBe(false);
    expect(ran.state.signals[arrived.id]).toBe(true);
    expect(ran.state.log.some((l) => l.code === 'SENSOR_OFF')).toBe(true);
    expect(ran.state.log.some((l) => l.code === 'SENSOR_ON' && l.message.includes('도착감지'))).toBe(true);
    const again = resetGroup(ran);
    expect(again.state.signals[left.id]).toBe(true);
    expect(again.state.signals[arrived.id]).toBe(false);
  });

  it('group chunking does not change sensor results', () => {
    let p = templateProject('unitInput', 'here');
    const unitId = p.units[0].id;
    const seq = take(C.addSubSequence(p, unitId, '투입', idOf));
    p = seq.project;
    p = okp(C.addSubStep(p, seq.note, actionOf(p, 'pusher', 'extend').id, idOf));
    const whole = runGroupToEnd(createGroupRuntime(p, unitId));
    let part = startGroup(createGroupRuntime(p, unitId));
    while (part.state.status === 'running') part = advanceGroup(part, 100);
    expect(part.state.status).toBe('completed');
    expect(part.state.signals).toEqual(whole.state.signals);
    expect(part.state.log).toEqual(whole.state.log);
  });
});

describe('sensor signals — examples and file format (AC7 AC8)', () => {
  it('AC7 the 5-step sample and the parallel sample keep their results', () => {
    const station = runToEnd(createRuntime(buildSampleProject()));
    expect(station.state.status).toBe('completed');
    expect(station.state.timeMs).toBe(11100);
    expect(station.state.material).toMatchObject({ location: 'EXIT', state: '배출 완료' });
    expect(station.state.log.filter((l) => l.code.startsWith('SENSOR'))).toEqual([]);
    const group = runGroupToEnd(createGroupRuntime(buildParallelSampleProject(), 'U-PS1'));
    expect(group.state.status).toBe('completed');
    expect(group.state.timeMs).toBe(1600);
    expect(group.state.lanes.map((l) => l.endMs)).toEqual([1200, 1600]);
    expect(group.state.log.filter((l) => l.code.startsWith('SENSOR'))).toEqual([]);
  });

  it('AC8 rules are 0.2.0 and the project file format stays 0.2.0', () => {
    expect(RUNTIME_RULES_VERSION).toBe('seq-runtime/0.2.0');
    expect(GROUP_RULES_VERSION).toBe('group-runtime/0.2.0');
    expect(FILE_FORMAT_VERSION).toBe('0.2.0');
    const sample = buildSampleProject();
    const text = serializeProject(sample);
    expect(text).toContain('"formatVersion": "0.2.0"');
    expect(text).not.toContain('seq-runtime');
    expect(text).not.toContain('group-runtime');
    const parsed = parseProjectFile(text);
    expect(parsed.ok).toBe(true);
    expect(runToEnd(createRuntime(sample)).state.rulesVersion).toBe('seq-runtime/0.2.0');
  });
});
