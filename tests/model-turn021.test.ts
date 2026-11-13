import { describe, expect, it } from 'vitest';
import * as C from '../src/model/commands';
import { emptyProject } from '../src/model/factory';
import { applyEdit, initHistory, undo } from '../src/model/history';
import { buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import type { Layout, Project } from '../src/model/types';
import { validateProject } from '../src/model/validate';
import { rectsOverlap, UNIT_HEADER, UNIT_PAD } from '../src/model/unitLayout';

const okp = (r: C.CmdResult) => { if (!r.ok) throw new Error(r.reason); return r.project; };
const ids = (list: { id: string }[]) => list.map((x) => x.id).sort();
const overlap = (a: Layout, b: Layout) => rectsOverlap(a, b);
const inside = (p: Project, unitId: string, d: Layout) => {
  const u = p.units.find((x) => x.id === unitId)!;
  return d.x >= u.layout.x + UNIT_PAD
    && d.y >= u.layout.y + UNIT_HEADER + UNIT_PAD
    && d.x + d.w <= u.layout.x + u.layout.w - UNIT_PAD
    && d.y + d.h <= u.layout.y + u.layout.h - UNIT_PAD;
};

describe('TURN-021 deleteNodes', () => {
  it('AC3 two units plus a device that belongs to one of them are one revision, and one undo restores devices, signals, actions, connections, and steps', () => {
    const p = buildSampleProject();
    const before = structuredClone(p);
    const targets = ['U-S1', 'U-S3', 'CYL-01'];
    const imp = C.impactOfNodes(p, targets);
    expect(imp.units).toBe(2);
    expect(imp.devices).toBe(4);
    const removedDevices = new Set(before.devices.filter((d) => d.unitId === 'U-S1' || d.unitId === 'U-S3').map((d) => d.id));
    expect(removedDevices.has('CYL-01')).toBe(true);
    const removedActions = new Set(before.actions.filter((a) => removedDevices.has(a.deviceId) || a.unitId === 'U-S1' || a.unitId === 'U-S3').map((a) => a.id));
    const after = okp(C.deleteNodes(p, targets));
    expect(after.revision).toBe(p.revision + 1);
    expect(after.units.map((u) => u.id)).toEqual(['U-S2', 'U-S4', 'U-S5']);
    expect(after.devices.some((d) => removedDevices.has(d.id))).toBe(false);
    expect(after.signals.some((s) => removedDevices.has(s.deviceId))).toBe(false);
    expect(after.actions.some((a) => removedActions.has(a.id))).toBe(false);
    expect(after.sequence.steps.some((s) => removedActions.has(s.actionId))).toBe(false);
    expect(after.sequence.steps.length).toBe(before.sequence.steps.filter((s) => !removedActions.has(s.actionId)).length);
    const removedNodes = new Set<string>(['U-S1', 'U-S3', ...removedDevices]);
    expect(after.connections.some((c) => removedNodes.has(c.from.nodeId) || removedNodes.has(c.to.nodeId))).toBe(false);
    expect(after.connections.length).toBeLessThan(before.connections.length);
    expect(after.devices.some((d) => d.id === 'BCR-02')).toBe(true);
    expect(validateProject(after).filter((d) => d.severity === 'error')).toEqual([]);

    const h = applyEdit(initHistory(p), C.deleteNodes(p, targets), '여러 개 삭제', false).history;
    expect(h.past).toHaveLength(1);
    expect(h.present.revision).toBe(p.revision + 1);
    const back = undo(h, false).history.present;
    expect(back.revision).toBe(p.revision);
    expect(ids(back.devices)).toEqual(ids(before.devices));
    expect(ids(back.signals)).toEqual(ids(before.signals));
    expect(ids(back.actions)).toEqual(ids(before.actions));
    expect(back.connections).toEqual(before.connections);
    expect(back.sequence.steps).toEqual(before.sequence.steps);
    expect(ids(back.units)).toEqual(ids(before.units));
  });

  it('a single id matches deleteNode, and deleting both substations removes their sequences in one undo', () => {
    const p = buildSampleProject();
    expect(okp(C.deleteNodes(p, ['STP-02']))).toEqual(okp(C.deleteNode(p, 'STP-02')));
    expect(okp(C.deleteNodes(p, ['U-S4']))).toEqual(okp(C.deleteNode(p, 'U-S4')));
    expect(C.deleteNodes(p, ['missing']).ok).toBe(false);

    const par = buildParallelSampleProject();
    const gone = okp(C.deleteNodes(par, ['U-PS1', 'U-PS2', 'CYL-B1']));
    expect(gone.revision).toBe(par.revision + 1);
    expect(gone.units).toEqual([]);
    expect(gone.devices).toEqual([]);
    expect(gone.substationSequences).toEqual([]);
    expect(gone.connections).toEqual([]);
    const h = applyEdit(initHistory(par), C.deleteNodes(par, ['U-PS1', 'U-PS2', 'CYL-B1']), '여러 개 삭제', false).history;
    const back = undo(h, false).history.present;
    expect(ids(back.devices)).toEqual(ids(par.devices));
    expect(back.substationSequences).toEqual(par.substationSequences);
    expect(back.connections).toEqual(par.connections);
  });
});

describe('TURN-021 duplicateDevices', () => {
  it('AC5 AC6 a copy keeps kind, size, and properties, rewrites only its own signal and position refs, and is one undo', () => {
    let p = buildSampleProject();
    const ownIn = p.signals.find((s) => s.deviceId === 'CYL-01' && s.direction === 'in')!;
    const ownOut = p.signals.find((s) => s.deviceId === 'CYL-01' && s.direction === 'out')!;
    const other = p.signals.find((s) => s.deviceId === 'PSH-01' && s.direction === 'out')!;
    const act = p.actions.find((a) => a.deviceId === 'CYL-01')!;
    p = okp(C.addPosition(p, 'CYL-01', () => 'pos-own'));
    p = okp(C.updateAction(p, act.id, {
      commandSignalId: ownIn.id,
      completeSignalId: ownOut.id,
      targetPositionId: 'pos-own',
      pre: [
        { kind: 'signal', signalId: ownIn.id, equals: true },
        { kind: 'signal', signalId: other.id, equals: true },
        { kind: 'materialHeldBy', deviceId: 'CYL-01' },
      ],
      post: [{ kind: 'signal', signalId: ownOut.id, equals: true }],
    }));
    const src = p.devices.find((d) => d.id === 'CYL-01')!;
    const steps = structuredClone(p.sequence.steps);
    const connections = structuredClone(p.connections);
    const rev = p.revision;
    const dup = okp(C.duplicateDevices(p, ['CYL-01', 'U-S1', 'CYL-01']));
    expect(dup.revision).toBe(rev + 1);
    expect(dup.devices).toHaveLength(p.devices.length + 1);
    const copy = dup.devices.find((d) => d.lineage?.duplicatedFrom === 'CYL-01')!;
    expect(copy.id).not.toBe('CYL-01');
    expect(copy.name).toBe(`${src.name} 사본`);
    expect(copy.kind).toBe(src.kind);
    expect(copy.definitionRef).toEqual(src.definitionRef);
    expect(copy.unitId).toBe(src.unitId);
    expect(copy.layout.w).toBe(src.layout.w);
    expect(copy.layout.h).toBe(src.layout.h);
    expect(copy.properties).toEqual(src.properties);
    expect(copy.properties).not.toBe(dup.devices.find((d) => d.id === 'CYL-01')!.properties);
    expect(copy.templateChild).toBeUndefined();
    expect(overlap(copy.layout, dup.devices.find((d) => d.id === 'CYL-01')!.layout)).toBe(false);
    expect(inside(dup, copy.unitId, copy.layout)).toBe(true);
    expect(dup.units.find((u) => u.id === copy.unitId)!.deviceIds).toContain(copy.id);

    const copySigs = dup.signals.filter((s) => s.deviceId === copy.id);
    expect(copySigs).toHaveLength(p.signals.filter((s) => s.deviceId === 'CYL-01').length);
    expect(copySigs.every((s) => s.id !== ownIn.id && s.id !== ownOut.id)).toBe(true);
    const copyPos = dup.positions.find((s) => s.deviceId === copy.id)!;
    expect(copyPos.id).not.toBe('pos-own');
    const copyAct = dup.actions.find((a) => a.deviceId === copy.id && a.pre.some((c) => c.kind === 'materialHeldBy'))!;
    expect(copyAct.id).not.toBe(act.id);
    expect(copyAct.unitId).toBe(src.unitId);
    expect(copyAct.commandSignalId).not.toBe(ownIn.id);
    expect(dup.signals.find((s) => s.id === copyAct.commandSignalId)!.deviceId).toBe(copy.id);
    expect(dup.signals.find((s) => s.id === copyAct.completeSignalId)!.deviceId).toBe(copy.id);
    expect(copyAct.targetPositionId).toBe(copyPos.id);
    const preOwn = copyAct.pre.find((c) => c.kind === 'signal' && c.signalId !== other.id);
    const preOther = copyAct.pre.find((c) => c.kind === 'signal' && c.signalId === other.id);
    expect(preOwn).toEqual({ kind: 'signal', signalId: copyAct.commandSignalId, equals: true });
    expect(preOther).toEqual({ kind: 'signal', signalId: other.id, equals: true });
    expect(copyAct.pre).toContainEqual({ kind: 'materialHeldBy', deviceId: 'CYL-01' });
    expect(copyAct.post).toEqual([{ kind: 'signal', signalId: copyAct.completeSignalId, equals: true }]);
    expect(dup.actions.find((a) => a.id === act.id)!.commandSignalId).toBe(ownIn.id);
    expect(dup.actions.find((a) => a.id === act.id)!.targetPositionId).toBe('pos-own');

    expect(dup.connections).toEqual(connections);
    expect(dup.sequence.steps).toEqual(steps);
    expect(dup.connections.some((c) => c.from.nodeId === copy.id || c.to.nodeId === copy.id)).toBe(false);
    expect(dup.sequence.steps.some((s) => s.actionId === copyAct.id)).toBe(false);
    expect(validateProject(dup).filter((d) => d.severity === 'error')).toEqual([]);

    const propKey = Object.keys(src.properties)[0];
    const edited = okp(C.setDeviceProperty(dup, 'CYL-01', propKey, 987, false));
    expect(edited.devices.find((d) => d.id === copy.id)!.properties[propKey].value).toBe(copy.properties[propKey].value);
    expect(edited.devices.find((d) => d.id === 'CYL-01')!.properties[propKey].value).toBe(987);
    expect(edited.devices.find((d) => d.id === 'CYL-01')!.properties).not.toBe(edited.devices.find((d) => d.id === copy.id)!.properties);

    const h = applyEdit(initHistory(p), C.duplicateDevices(p, ['CYL-01']), 'Device 복제', false).history;
    expect(h.past).toHaveLength(1);
    const back = undo(h, false).history.present;
    expect(back.devices.map((d) => d.id)).toEqual(p.devices.map((d) => d.id));
    expect(back.revision).toBe(p.revision);

    const again = okp(C.duplicateDevices(dup, ['CYL-01']));
    expect(again.devices.find((d) => d.lineage?.duplicatedFrom === 'CYL-01' && d.id !== copy.id)!.name).toBe(`${src.name} 사본 2`);
    const fromCopy = okp(C.duplicateDevices(dup, [copy.id]));
    expect(fromCopy.devices.find((d) => d.lineage?.duplicatedFrom === copy.id)!.name).toBe(`${src.name} 사본 사본`);
  });

  it('several devices are one revision, a template child drops templateChild, and a full unit grows', () => {
    const p = buildSampleProject();
    const both = okp(C.duplicateDevices(p, ['GNT-04', 'BCR-02', 'U-S5']));
    expect(both.revision).toBe(p.revision + 1);
    expect(both.devices).toHaveLength(p.devices.length + 2);
    const g = both.devices.find((d) => d.lineage?.duplicatedFrom === 'GNT-04')!;
    const b = both.devices.find((d) => d.lineage?.duplicatedFrom === 'BCR-02')!;
    expect(g.unitId).toBe('U-S4');
    expect(b.unitId).toBe('U-S2');
    expect(both.positions.filter((s) => s.deviceId === g.id).length).toBe(p.positions.filter((s) => s.deviceId === 'GNT-04').length);
    const gAct = both.actions.find((a) => a.deviceId === g.id)!;
    expect(gAct.targetPositionId).not.toBe('GNT-04.pos-place');
    expect(both.positions.find((s) => s.id === gAct.targetPositionId)!.deviceId).toBe(g.id);
    expect(both.connections).toEqual(p.connections);
    expect(both.sequence.steps).toEqual(p.sequence.steps);
    expect(both.substationSequences).toEqual(p.substationSequences);

    const templ = okp(C.addUnitFromTemplate(emptyProject('t'), 'unitTransfer', { x: 40, y: 40 }));
    const child = templ.devices.find((d) => d.templateChild)!;
    const copied = okp(C.duplicateDevices(templ, [child.id]));
    const twin = copied.devices.find((d) => d.lineage?.duplicatedFrom === child.id)!;
    expect(twin.templateChild).toBeUndefined();
    expect(twin.unitId).toBe(child.unitId);
    expect(copied.connections.length).toBe(templ.connections.length);

    let grown = okp(C.addUnit(emptyProject('grow'), 'U', { x: 100, y: 100 }));
    grown = okp(C.addDevice(grown, 'cylinder', { x: 120, y: 160 }));
    const h0 = grown.units[0].layout.h;
    const origin = grown.devices[0].id;
    for (let n = 0; n < 12; n++) grown = okp(C.duplicateDevices(grown, [origin]));
    expect(grown.units[0].layout.h).toBeGreaterThan(h0);
    const boxes = grown.devices.map((d) => d.layout);
    for (let i = 0; i < boxes.length; i++) {
      expect(inside(grown, grown.units[0].id, boxes[i])).toBe(true);
      for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j])).toBe(false);
    }
    expect(C.duplicateDevices(p, ['U-S1']).ok).toBe(false);
    const refused = C.duplicateDevices(p, []);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toBe(C.DUPLICATE_NEED_DEVICE);
  });
});
