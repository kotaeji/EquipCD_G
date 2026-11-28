import { describe, expect, it } from 'vitest';
import * as C from '../src/model/commands';
import { walk } from '../src/model/flow';
import { emptyProject } from '../src/model/factory';
import { applyEdit, initHistory, undo } from '../src/model/history';
import { buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import type { AssetKind, FlowNode, Project } from '../src/model/types';
import { q } from '../src/model/types';
import { rectsOverlap, UNIT_PAD } from '../src/model/unitLayout';
import { validateProject } from '../src/model/validate';
import { blankCommandState, visibleCommands } from '../src/ui/commandModel';

const okp = (r: C.CmdResult) => { if (!r.ok) throw new Error(r.reason); return r.project; };
const errors = (p: Project) => validateProject(p).filter((d) => d.severity === 'error');
const layout = (p: Project, id: string) => {
  const box = p.units.find((u) => u.id === id)?.layout ?? p.devices.find((d) => d.id === id)?.layout;
  if (!box) throw new Error(id);
  return { ...box };
};

function everyId(p: Project): string[] {
  const out: string[] = [];
  const add = (list: { id: string }[]) => { for (const x of list) out.push(x.id); };
  add(p.units); add(p.devices); add(p.signals); add(p.positions); add(p.actions); add(p.connections);
  add(p.sequence.steps);
  for (const seq of p.substationSequences ?? []) {
    out.push(seq.id);
    add(seq.steps);
    if (seq.flow) walk(seq.flow, (n) => { if (n.kind !== 'step') out.push(n.id); });
  }
  if (p.sequence.flow) walk(p.sequence.flow, (n) => { if (n.kind !== 'step') out.push(n.id); });
  return out;
}

describe('TURN-096 duplicateUnits', () => {
  it('AC1 copies devices, signals, positions, actions, and inner links under new ids', () => {
    const before = buildSampleProject();
    const prior = new Set(everyId(before));
    const dup = okp(C.duplicateUnits(before, ['U-S2']));
    const copy = dup.units.find((u) => u.lineage?.duplicatedFrom === 'U-S2')!;
    const fresh = everyId(dup).filter((id) => !prior.has(id));
    expect(new Set(fresh).size).toBe(fresh.length);
    expect(fresh.every((id) => !prior.has(id))).toBe(true);
    expect(prior.has(copy.id)).toBe(false);

    const srcDevices = before.devices.filter((d) => d.unitId === 'U-S2').map((d) => d.id).sort();
    const copied = dup.devices.filter((d) => d.unitId === copy.id);
    expect(copied.map((d) => d.lineage?.duplicatedFrom).sort()).toEqual(srcDevices);
    expect(copied.every((d) => !prior.has(d.id) && !d.templateChild)).toBe(true);
    for (const srcId of srcDevices) {
      const src = before.devices.find((d) => d.id === srcId)!;
      const child = copied.find((d) => d.lineage?.duplicatedFrom === srcId)!;
      expect(dup.signals.filter((s) => s.deviceId === child.id)).toHaveLength(before.signals.filter((s) => s.deviceId === src.id).length);
      expect(dup.positions.filter((s) => s.deviceId === child.id)).toHaveLength(before.positions.filter((s) => s.deviceId === src.id).length);
      expect(dup.actions.filter((a) => a.deviceId === child.id)).toHaveLength(before.actions.filter((a) => a.deviceId === src.id).length);
    }
    const bcr = copied.find((d) => d.lineage?.duplicatedFrom === 'BCR-02')!;
    const pre = dup.actions.find((a) => a.deviceId === bcr.id && a.pre.some((c) => c.kind === 'signal'))!.pre.find((c) => c.kind === 'signal')!;
    if (pre.kind !== 'signal') throw new Error('signal');
    const owner = dup.signals.find((s) => s.id === pre.signalId)!;
    expect(dup.devices.find((d) => d.id === owner.deviceId)!.lineage?.duplicatedFrom).toBe('STP-02');
    expect(owner.deviceId).not.toBe('STP-02');

    const inner = dup.connections.filter((c) => c.kind === 'signal' && copied.some((d) => d.id === c.from.nodeId));
    expect(inner).toHaveLength(1);
    expect(inner[0].id).not.toBe('SIGC-1');
    expect(dup.connections.some((c) => c.id === 'SIGC-1')).toBe(true);
    expect(errors(dup)).toEqual([]);
  });

  it('AC2 is one revision and one undo, and the name and code do not collide', () => {
    const before = buildSampleProject();
    const dup = C.duplicateUnits(before, ['U-S1', 'U-S1', 'U-S4']);
    expect(dup.ok).toBe(true);
    if (!dup.ok) return;
    expect(dup.project.revision).toBe(before.revision + 1);
    const ids = dup.note!.split(',');
    expect(ids).toHaveLength(2);
    const copies = ids.map((id) => dup.project.units.find((u) => u.id === id)!);
    expect(copies.map((u) => u.name)).toEqual(['S1 투입 사본', 'S4 이송 사본']);
    expect(new Set(dup.project.units.map((u) => u.code)).size).toBe(dup.project.units.length);
    expect(copies.map((u) => u.code).sort()).toEqual(['S6', 'S7']);
    expect(new Set(dup.project.devices.map((d) => d.name)).size).toBe(dup.project.devices.length);
    const againR = C.duplicateUnits(dup.project, ['U-S1']);
    if (!againR.ok) throw new Error(againR.reason);
    const newestId = (againR.note ?? '').split(',')[0];
    const newest = againR.project.units.find((u) => u.id === newestId)!;
    expect(newest.name).toBe('S1 투입 사본 2');
    expect(newest.code).toBe('S8');

    const h = applyEdit(initHistory(before), C.duplicateUnits(before, ['U-S1', 'U-S4']), 'Unit 복제', false).history;
    expect(h.past).toHaveLength(1);
    const back = undo(h, false).history.present;
    expect(back.revision).toBe(before.revision);
    expect(back.units.map((u) => u.id)).toEqual(before.units.map((u) => u.id));
    expect(back.devices.map((d) => d.id)).toEqual(before.devices.map((d) => d.id));
    expect(back.connections).toEqual(before.connections);
  });

  it('AC3 leaves flow, outer signals, and station steps, and copies a substation sequence only when asked', () => {
    const base = buildSampleProject();
    const outSig = base.signals.find((s) => s.deviceId === 'CYL-01' && s.direction === 'out')!;
    const inSig = base.signals.find((s) => s.deviceId === 'BCR-02' && s.direction === 'in')!;
    const linked = okp(C.addConnection(base, 'signal', outSig.id, inSig.id));
    const flows = linked.connections.filter((c) => c.kind === 'flow');
    const dup = okp(C.duplicateUnits(linked, ['U-S1']));
    const copy = dup.units.find((u) => u.lineage?.duplicatedFrom === 'U-S1')!;
    const copyDev = dup.devices.find((d) => d.unitId === copy.id)!;
    expect(dup.connections.filter((c) => c.kind === 'flow')).toEqual(flows);
    expect(dup.connections.some((c) => c.from.nodeId === copyDev.id || c.to.nodeId === copyDev.id)).toBe(false);
    expect(dup.connections.some((c) => c.from.signalId === outSig.id && c.to.signalId === inSig.id)).toBe(true);
    expect(dup.sequence).toEqual(linked.sequence);
    expect(dup.materials).toEqual(linked.materials);
    expect(dup.substationSequences).toEqual(linked.substationSequences);

    const par = buildParallelSampleProject();
    const seq = par.substationSequences!.find((q) => q.id === 'SSEQ-S1-A')!;
    const sig = par.signals.find((s) => s.deviceId === 'STP-A1' && s.direction === 'out')!;
    const flow: FlowNode[] = [
      { kind: 'step', stepId: seq.steps[0].id },
      { kind: 'loop', id: 'FLW-A-LOOP', name: '두 번', count: 2, body: [{ kind: 'step', stepId: seq.steps[1].id }] },
      { kind: 'wait', id: 'FLW-A-WAIT', name: '상승 기다림', cond: { kind: 'signal', signalId: sig.id, equals: true }, timeout: q(2, 's', true) },
    ];
    seq.flow = flow;
    const plain = okp(C.duplicateUnits(par, ['U-PS1']));
    expect(plain.substationSequences!.map((q) => q.id)).toEqual(par.substationSequences!.map((q) => q.id));
    expect(plain.sequence.flow).toEqual(par.sequence.flow);
    expect(plain.units.find((u) => u.lineage?.duplicatedFrom === 'U-PS1')).toBeTruthy();

    const copied = okp(C.duplicateUnits(par, ['U-PS1'], { copySequences: true }));
    const host = copied.units.find((u) => u.lineage?.duplicatedFrom === 'U-PS1')!;
    const seqs = copied.substationSequences!.filter((q) => q.unitId === host.id);
    expect(seqs).toHaveLength(2);
    expect(copied.substationSequences!.filter((q) => q.unitId === 'U-PS1').map((q) => q.id)).toEqual(['SSEQ-S1-A', 'SSEQ-S1-B']);
    expect(copied.sequence).toEqual(par.sequence);
    expect(copied.connections.filter((c) => c.kind === 'flow')).toEqual(par.connections.filter((c) => c.kind === 'flow'));
    const withFlow = seqs.find((q) => q.flow)!;
    const blockIds: string[] = [];
    walk(withFlow.flow!, (n) => { if (n.kind !== 'step') blockIds.push(n.id); });
    expect(blockIds).not.toContain('FLW-A-LOOP');
    expect(blockIds).not.toContain('FLW-A-WAIT');
    expect(withFlow.steps.map((s) => s.actionId).every((id) => copied.actions.some((a) => a.id === id && a.unitId === host.id))).toBe(true);
    const wait = withFlow.flow!.find((n) => n.kind === 'wait');
    if (!wait || wait.kind !== 'wait' || wait.cond.kind !== 'signal') throw new Error('wait');
    const waited = wait.cond.signalId;
    expect(waited).not.toBe(sig.id);
    expect(copied.signals.find((s) => s.id === waited)!.deviceId).not.toBe('STP-A1');
    const loop = withFlow.flow!.find((n) => n.kind === 'loop');
    if (!loop || loop.kind !== 'loop') throw new Error('loop');
    expect(loop.count).toBe(2);
    expect(errors(copied)).toEqual([]);
    expect(errors(plain)).toEqual([]);
  });

  it('AC4 lands the copy clear of every other unit, to the right of the original', () => {
    const before = buildSampleProject();
    const dup = okp(C.duplicateUnits(before, ['U-S1']));
    const copy = dup.units.find((u) => u.lineage?.duplicatedFrom === 'U-S1')!;
    const src = dup.units.find((u) => u.id === 'U-S1')!;
    expect(copy.layout.x).toBeGreaterThanOrEqual(src.layout.x + src.layout.w + C.UNIT_SPREAD_GAP);
    expect(copy.layout.y).toBe(src.layout.y);
    for (const u of dup.units) {
      if (u.id === copy.id) continue;
      expect(rectsOverlap(u.layout, copy.layout)).toBe(false);
    }
    const child = dup.devices.find((d) => d.unitId === copy.id)!;
    expect(child.layout.x - copy.layout.x).toBe(before.devices.find((d) => d.id === child.lineage?.duplicatedFrom)!.layout.x - src.layout.x);
  });

  it('AC7 a locked unit copies unlocked, and a running edit is refused while the copy still validates', () => {
    let before = buildSampleProject();
    before = okp(C.setUnitPositionLock(before, ['U-S5'], true));
    const dup = okp(C.duplicateUnits(before, ['U-S5']));
    const copy = dup.units.find((u) => u.lineage?.duplicatedFrom === 'U-S5')!;
    expect(copy.positionLocked).toBeUndefined();
    expect(dup.units.find((u) => u.id === 'U-S5')!.positionLocked).toBe(true);
    expect(copy.layout.x).toBeGreaterThanOrEqual(before.units.find((u) => u.id === 'U-S5')!.layout.x + before.units.find((u) => u.id === 'U-S5')!.layout.w + C.UNIT_SPREAD_GAP);
    expect(errors(dup)).toEqual([]);
    const blocked = applyEdit(initHistory(before), C.duplicateUnits(before, ['U-S5']), 'Unit 복제', true);
    expect(blocked.error).toMatch(/차단/);
    expect(blocked.history.present.revision).toBe(before.revision);
    expect(C.duplicateUnits(before, ['CYL-01']).ok).toBe(false);
  });
});

describe('TURN-096 arrange selected units', () => {
  it('AC5 moves only the unlocked selection and keeps logistics order', () => {
    let p = emptyProject('row');
    const place = (x: number, y: number) => {
      p = okp(C.addUnit(p, 'U', { x, y }));
      return p.units[p.units.length - 1].id;
    };
    const a = place(400, 40);
    const b = place(200, 90);
    const parked = place(0, 900);
    const locked = place(0, 10);
    p = okp(C.addConnection(p, 'flow', a, b));
    p = okp(C.addConnection(p, 'flow', b, locked));
    p = okp(C.setUnitPositionLock(p, [locked], true));
    const parkedBox = layout(p, parked);
    const lockedBox = layout(p, locked);
    const moved = C.arrangeSelectedUnits(p, [a, b, locked]);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.note).toBe(C.lockedExcludedNote(1));
    expect(moved.project.revision).toBe(p.revision + 1);
    expect(layout(moved.project, parked)).toEqual(parkedBox);
    expect(layout(moved.project, locked)).toEqual(lockedBox);
    const aa = layout(moved.project, a);
    const bb = layout(moved.project, b);
    expect(aa.y).toBe(bb.y);
    expect(bb.x).toBeGreaterThanOrEqual(aa.x + aa.w + C.UNIT_SPREAD_GAP);
    expect(rectsOverlap(aa, lockedBox)).toBe(false);
    expect(rectsOverlap(bb, lockedBox)).toBe(false);
    expect(rectsOverlap(aa, parkedBox)).toBe(false);

    const sample = buildSampleProject();
    const s3 = layout(sample, 'U-S3');
    const same = C.arrangeSelectedUnits(sample, ['U-S1', 'U-S2']);
    expect(same.ok).toBe(false);
    if (same.ok) return;
    expect(same.reason).toBe(C.ARRANGE_UNCHANGED);
    expect(layout(sample, 'U-S3')).toEqual(s3);
    const refused = applyEdit(initHistory(sample), C.arrangeSelectedUnits(sample, ['U-S1', 'U-S2', 'U-S3']), '고른 것만 자동 정렬', true);
    expect(refused.error).toMatch(/차단/);
    expect(refused.history.present.units.map((u) => u.layout)).toEqual(sample.units.map((u) => u.layout));
  });
});

describe('TURN-096 device arrange', () => {
  function box(kind: AssetKind, name: string, x: number, y: number) {
    return { kind, name, x, y };
  }

  function devices(specs: { kind: AssetKind; name: string; x: number; y: number }[], unit: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: 500, h: 400 }) {
    let p = emptyProject('dev');
    p = okp(C.addUnit(p, '박스', { x: unit.x, y: unit.y }));
    const uid = p.units[0].id;
    if (p.units[0].layout.w !== unit.w || p.units[0].layout.h !== unit.h) p = okp(C.resizeUnit(p, uid, unit.w, unit.h));
    const ids: string[] = [];
    for (const spec of specs) {
      p = okp(C.addDevice(p, spec.kind, { x: spec.x, y: spec.y }, spec.name, undefined, uid));
      const id = p.devices[p.devices.length - 1].id;
      ids.push(id);
      const cur = p.devices.find((d) => d.id === id)!;
      if (cur.layout.x !== spec.x || cur.layout.y !== spec.y) p = okp(C.moveNodes(p, [id], spec.x - cur.layout.x, spec.y - cur.layout.y));
    }
    return { p, uid, ids };
  }

  it('AC6 aligns, spaces, and matches selected devices in one undo, and grows the unit', () => {
    const made = devices([
      box('sensor', 'A', 40, 80),
      box('sensor', 'B', 90, 140),
      box('cylinder', 'C', 280, 80),
    ]);
    const aligned = okp(C.alignNodes(made.p, made.ids, 'left'));
    expect(aligned.devices.filter((d) => made.ids.includes(d.id)).map((d) => d.layout.x)).toEqual([40, 40, 40]);
    const hAlign = applyEdit(initHistory(made.p), C.alignNodes(made.p, made.ids, 'top'), '위 정렬', false).history;
    expect(hAlign.past).toHaveLength(1);
    expect(undo(hAlign, false).history.present.devices.map((d) => d.layout.y)).toEqual(made.p.devices.map((d) => d.layout.y));

    const spaced = okp(C.distributeDevices(made.p, made.ids, 'x'));
    const [a, b, c] = made.ids.map((id) => layout(spaced, id));
    const gap1 = b.x - (a.x + a.w);
    const gap2 = c.x - (b.x + b.w);
    expect(gap1).toBe(gap2);
    expect(layout(spaced, made.ids[0]).x).toBe(40);
    expect(layout(spaced, made.ids[2]).x).toBe(280);
    const h = applyEdit(initHistory(made.p), C.distributeDevices(made.p, made.ids, 'x'), '가로 간격 같게', false).history;
    expect(h.past).toHaveLength(1);
    expect(undo(h, false).history.present.devices.map((d) => d.layout)).toEqual(made.p.devices.map((d) => d.layout));

    const wide = devices([
      box('sensor', '작음', 160, 80),
      box('pusher', '큼', 40, 160),
    ], { x: 0, y: 0, w: 216, h: 300 });
    const beforeW = wide.p.units[0].layout.w;
    const matched = okp(C.matchDeviceSize(wide.p, wide.ids, 'w'));
    expect(matched.devices.map((d) => d.layout.w)).toEqual([80, 80]);
    expect(matched.units[0].layout.w).toBeGreaterThan(beforeW);
    expect(matched.devices.every((d) => d.layout.x + d.layout.w <= matched.units[0].layout.x + matched.units[0].layout.w - UNIT_PAD)).toBe(true);
    const hSize = applyEdit(initHistory(wide.p), C.matchDeviceSize(wide.p, wide.ids, 'w'), '너비 같게', false).history;
    expect(hSize.past).toHaveLength(1);
    expect(undo(hSize, false).history.present.units[0].layout.w).toBe(beforeW);

    const other = okp(C.addUnit(made.p, '옆', { x: 800, y: 0 }));
    const foreign = other.units[other.units.length - 1].id;
    const moved = okp(C.addDevice(other, 'sensor', { x: 820, y: 80 }, 'D', undefined, foreign));
    const mixed = [made.ids[0], moved.devices[moved.devices.length - 1].id];
    expect(C.distributeDevices(moved, mixed, 'x').ok).toBe(false);
    expect(C.matchDeviceSize(moved, mixed, 'h').ok).toBe(false);
    const blocked = applyEdit(initHistory(made.p), C.matchDeviceSize(made.p, made.ids, 'h'), '높이 같게', true);
    expect(blocked.error).toMatch(/차단/);
  });

  it('lists the new command and lets a unit or a device be duplicated', () => {
    const project = buildSampleProject();
    const bare = visibleCommands(blankCommandState(project, { step: 'canvas' }), '고른 것만');
    expect(bare.find((row) => row.id === 'arrange-selected')!.ok).toBe(false);
    const units = visibleCommands(blankCommandState(project, { step: 'canvas', selection: ['U-S1', 'U-S2'] }), '고른 것만');
    expect(units.find((row) => row.id === 'arrange-selected')!.ok).toBe(true);
    const locked = visibleCommands(blankCommandState(project, { step: 'canvas', selection: ['U-S1'], locked: true }), '복제');
    expect(locked.find((row) => row.id === 'duplicate')!.ok).toBe(false);
    expect(locked.find((row) => row.id === 'duplicate')!.reason).toMatch(/차단/);
    const unit = visibleCommands(blankCommandState(project, { step: 'canvas', selection: ['U-S1'] }), '복제');
    expect(unit.find((row) => row.id === 'duplicate')!.ok).toBe(true);
    const devs = visibleCommands(blankCommandState(project, { step: 'canvas', selection: ['PSH-01', 'CYL-01'] }), '너비');
    expect(devs.find((row) => row.id === 'match-w')!.ok).toBe(true);
  });
});
