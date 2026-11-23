import { describe, expect, it } from 'vitest';
import * as C from '../src/model/commands';
import { captureCopy, pasteClipboard, splitPasteNote } from '../src/model/copyPaste';
import { emptyProject } from '../src/model/factory';
import { applyEdit, initHistory, redo, undo } from '../src/model/history';
import { buildSampleProject } from '../src/model/sample';
import type { Project } from '../src/model/types';
import { rectsOverlap } from '../src/model/unitLayout';
import { validateProject } from '../src/model/validate';

const okp = (r: C.CmdResult) => { if (!r.ok) throw new Error(r.reason); return r.project; };
const clipOf = (p: Project, ids: string[]) => {
  const r = captureCopy(p, ids);
  if (!r.ok) throw new Error(r.reason);
  return r.clip;
};
const errors = (p: Project) => validateProject(p).filter((d) => d.severity === 'error');
const fresh = (before: Project, after: Project) => after.connections.filter((c) => !before.connections.some((o) => o.id === c.id));
let n = 0;
const idOf = (prefix: string) => `${prefix}-t${++n}`;

describe('TURN-044 copy and paste', () => {
  it('AC1 AC2 two devices paste into another unit with new ids, names, and only the link between them', () => {
    let p = buildSampleProject();
    const srcA = p.devices.find((d) => d.id === 'STP-02')!;
    const srcB = p.devices.find((d) => d.id === 'BCR-02')!;
    p = okp(C.addPosition(p, 'BCR-02', idOf));
    const out = p.signals.find((s) => s.deviceId === 'STP-02' && s.direction === 'out')!;
    const inn = p.signals.find((s) => s.deviceId === 'CYL-01' && s.direction === 'in')!;
    p = okp(C.addConnection(p, 'signal', out.id, inn.id, idOf));
    const steps = structuredClone(p.sequence.steps);
    const materials = structuredClone(p.materials);
    const before = structuredClone(p);
    const same = p.units;
    const clip = clipOf(p, ['STP-02', 'BCR-02', 'STP-02']);
    expect(clip.kind).toBe('devices');
    expect(clip.devices.map((d) => d.id)).toEqual(['STP-02', 'BCR-02']);
    const rev = p.revision;
    const first = pasteClipboard(p, clip, ['U-S5'], idOf);
    const pasted = okp(first);
    const note = splitPasteNote(first.ok ? first.note : '');
    expect(p.units).toBe(same);
    expect(p).toEqual(before);
    expect(pasted.revision).toBe(rev + 1);
    const copies = ['STP-02', 'BCR-02'].map((id) => pasted.devices.find((d) => d.lineage?.duplicatedFrom === id)!);
    expect(copies.every(Boolean)).toBe(true);
    expect(new Set(copies.map((d) => d.id)).size).toBe(2);
    expect(copies.every((d) => d.unitId === 'U-S5')).toBe(true);
    expect(copies.map((d) => d.name).sort()).toEqual(['BCR-02 사본', 'STP-02 사본']);
    expect(pasted.devices.filter((d) => d.name === 'STP-02' || d.name === 'BCR-02')).toHaveLength(2);
    for (const src of [srcA, srcB]) {
      const copy = copies.find((d) => d.lineage?.duplicatedFrom === src.id)!;
      expect(copy.id).not.toBe(src.id);
      expect(copy.kind).toBe(src.kind);
      expect(copy.properties).toEqual(p.devices.find((d) => d.id === src.id)!.properties);
      expect(copy.templateChild).toBeUndefined();
      expect(pasted.signals.filter((s) => s.deviceId === copy.id)).toHaveLength(p.signals.filter((s) => s.deviceId === src.id).length);
      expect(pasted.positions.filter((s) => s.deviceId === copy.id)).toHaveLength(p.positions.filter((s) => s.deviceId === src.id).length);
      expect(pasted.actions.filter((a) => a.deviceId === copy.id)).toHaveLength(p.actions.filter((a) => a.deviceId === src.id).length);
      const ports = pasted.signals.filter((s) => s.deviceId === copy.id).map((s) => s.portKey).sort();
      expect(ports).toEqual(p.signals.filter((s) => s.deviceId === src.id).map((s) => s.portKey).sort());
    }
    const added = fresh(p, pasted);
    expect(added).toHaveLength(1);
    expect(added[0].kind).toBe('signal');
    expect(new Set([added[0].from.nodeId, added[0].to.nodeId])).toEqual(new Set(copies.map((d) => d.id)));
    expect(pasted.signals.some((s) => s.id === added[0].from.signalId && s.deviceId === added[0].from.nodeId)).toBe(true);
    expect(pasted.signals.some((s) => s.id === added[0].to.signalId && s.deviceId === added[0].to.nodeId)).toBe(true);
    expect(added.some((c) => c.from.nodeId === 'CYL-01' || c.to.nodeId === 'CYL-01' || c.from.nodeId === 'BCR-02' || c.to.nodeId === 'STP-02')).toBe(false);
    expect(note.message).toContain('바깥 연결');
    expect(note.message).toContain('시퀀스 단계');
    expect(note.message).not.toContain('자재 경로');
    expect(pasted.sequence.steps).toEqual(steps);
    expect(pasted.materials).toEqual(materials);
    expect(errors(pasted)).toEqual([]);

    const again = okp(pasteClipboard(pasted, clip, ['U-S5'], idOf));
    expect(again.devices.filter((d) => d.name.startsWith('STP-02 사본'))).toHaveLength(2);
    expect(again.devices.some((d) => d.name === 'STP-02 사본 2')).toBe(true);
  });

  it('AC3 AC6 a unit paste keeps inner devices and links, misses the route, and overlaps nothing', () => {
    const p = buildSampleProject();
    const clip = clipOf(p, ['U-S2', 'BCR-02']);
    expect(clip.kind).toBe('units');
    expect(clip.devices.map((d) => d.id).sort()).toEqual(['BCR-02', 'STP-02']);
    const steps = structuredClone(p.sequence);
    const materials = structuredClone(p.materials);
    const first = pasteClipboard(p, clip, [], idOf);
    const pasted = okp(first);
    const note = splitPasteNote(first.ok ? first.note : '');
    const nu = pasted.units.find((u) => u.lineage?.duplicatedFrom === 'U-S2')!;
    expect(nu.id).not.toBe('U-S2');
    expect(nu.name).toBe('S2 식별 사본');
    expect(pasted.equipment.unitIds).toContain(nu.id);
    expect(new Set(pasted.units.map((u) => u.code)).size).toBe(pasted.units.length);
    const srcDevs = p.devices.filter((d) => d.unitId === 'U-S2');
    const copyDevs = pasted.devices.filter((d) => d.unitId === nu.id);
    expect(copyDevs).toHaveLength(srcDevs.length);
    const srcStp = srcDevs.find((d) => d.id === 'STP-02')!;
    const srcBcr = srcDevs.find((d) => d.id === 'BCR-02')!;
    const cStp = copyDevs.find((d) => d.lineage?.duplicatedFrom === 'STP-02')!;
    const cBcr = copyDevs.find((d) => d.lineage?.duplicatedFrom === 'BCR-02')!;
    expect(cStp.layout.x - cBcr.layout.x).toBe(srcStp.layout.x - srcBcr.layout.x);
    expect(cStp.layout.y - cBcr.layout.y).toBe(srcStp.layout.y - srcBcr.layout.y);
    for (const u of pasted.units) if (u.id !== nu.id) expect(rectsOverlap(u.layout, nu.layout)).toBe(false);
    expect(nu.layout.x).toBeGreaterThan(p.units.find((u) => u.id === 'U-S2')!.layout.x);
    const added = fresh(p, pasted);
    expect(added.filter((c) => c.kind === 'flow')).toHaveLength(0);
    expect(added.filter((c) => c.kind === 'signal')).toHaveLength(1);
    expect(new Set([added[0].from.nodeId, added[0].to.nodeId])).toEqual(new Set([cStp.id, cBcr.id]));
    expect(pasted.sequence).toEqual(steps);
    expect(pasted.materials).toEqual(materials);
    expect(pasted.constraints).toEqual(p.constraints);
    expect(note.message).toContain('시퀀스 단계');
    expect(note.message).toContain('바깥 연결');
    expect(note.message).toContain('자재 경로');
    expect(note.ids).toEqual([nu.id]);
    expect(errors(pasted)).toEqual([]);

    const pair = clipOf(p, ['U-S1', 'U-S2']);
    const both = okp(pasteClipboard(p, pair, [], idOf));
    const n1 = both.units.find((u) => u.lineage?.duplicatedFrom === 'U-S1')!;
    const n2 = both.units.find((u) => u.lineage?.duplicatedFrom === 'U-S2')!;
    const flows = fresh(p, both).filter((c) => c.kind === 'flow');
    expect(flows).toHaveLength(1);
    expect(flows[0].from.nodeId).toBe(n1.id);
    expect(flows[0].to.nodeId).toBe(n2.id);
    for (const u of both.units) {
      if (u.id === n1.id || u.id === n2.id) continue;
      expect(rectsOverlap(u.layout, n1.layout)).toBe(false);
      expect(rectsOverlap(u.layout, n2.layout)).toBe(false);
    }
    expect(rectsOverlap(n1.layout, n2.layout)).toBe(false);
    expect(errors(both)).toEqual([]);
  });

  it('AC4 one paste is one undo, and redo brings the copies back', () => {
    const p = buildSampleProject();
    const clip = clipOf(p, ['CYL-03', 'STP-03']);
    const result = pasteClipboard(p, clip, ['U-S1'], idOf);
    const h = applyEdit(initHistory(p), result, '붙여넣기', false).history;
    expect(h.past).toHaveLength(1);
    expect(h.present.revision).toBe(p.revision + 1);
    expect(h.present.devices.length).toBe(p.devices.length + 2);
    const back = undo(h, false).history;
    expect(back.present).toBe(p);
    expect(back.future).toHaveLength(1);
    const forward = redo(back, false).history;
    expect(forward.present).toBe(h.present);
    const locked = applyEdit(initHistory(p), result, '붙여넣기', true);
    expect(locked.error).toMatch(/차단/);
    expect(locked.history.present).toBe(p);
    expect(splitPasteNote(result.ok ? result.note : '').message).toContain('Interlock');
  });

  it('AC6 a unit pasted into an empty project has no broken refs, and a missing asset is left out', () => {
    const p = buildSampleProject();
    const clip = clipOf(p, ['U-S2']);
    const empty = emptyProject('빈', idOf);
    const pasted = okp(pasteClipboard(empty, clip, [], idOf));
    expect(pasted.units).toHaveLength(1);
    expect(pasted.devices).toHaveLength(2);
    expect(pasted.sequence.steps).toEqual([]);
    expect(pasted.materials).toEqual([]);
    expect(errors(pasted)).toEqual([]);
    expect(p.revision).toBe(1);
    expect(p.units).toHaveLength(5);
    const host = pasted.units[0].id;
    expect(pasted.actions.filter((a) => a.deviceId === pasted.devices.find((d) => d.lineage?.duplicatedFrom === 'STP-02')!.id).some((a) => a.effect.moveTo && a.effect.moveTo !== 'EXIT' && a.effect.moveTo !== host)).toBe(false);

    const bad = structuredClone(clip);
    bad.devices[0].definitionRef = { assetId: 'missing-asset', version: '0' };
    const partialResult = pasteClipboard(p, bad, [], idOf);
    const partial = okp(partialResult);
    expect(splitPasteNote(partialResult.ok ? partialResult.note : '').message).toContain('에셋 정의 missing-asset');
    expect(splitPasteNote(partialResult.ok ? partialResult.note : '').message).toContain('붙이지 않았습니다');
    expect(partial.devices.filter((d) => d.lineage?.duplicatedFrom === bad.devices[0].id)).toHaveLength(0);
    expect(errors(partial)).toEqual([]);
    const bare = structuredClone(clip);
    for (const d of bare.devices) d.definitionRef = { assetId: 'missing-asset', version: '0' };
    const keptUnit = okp(pasteClipboard(p, bare, [], idOf));
    expect(keptUnit.units.some((u) => u.lineage?.duplicatedFrom === 'U-S2')).toBe(true);
    expect(keptUnit.devices.some((d) => d.lineage?.duplicatedFrom === 'STP-02' || d.lineage?.duplicatedFrom === 'BCR-02')).toBe(false);
    expect(errors(keptUnit)).toEqual([]);
    const devicesOnly = clipOf(p, ['STP-02', 'BCR-02']);
    for (const d of devicesOnly.devices) d.definitionRef = { assetId: 'missing-asset', version: '0' };
    const refused = pasteClipboard(p, devicesOnly, ['U-S5'], idOf);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toContain('missing-asset');
    expect(p.devices).toHaveLength(buildSampleProject().devices.length);
  });

  it('nothing selected pastes devices back into their own unit, and two selected units are refused', () => {
    const p = buildSampleProject();
    const clip = clipOf(p, ['PSH-01', 'CYL-01']);
    const home = okp(pasteClipboard(p, clip, [], idOf));
    const copies = home.devices.filter((d) => d.lineage);
    expect(copies.every((d) => d.unitId === 'U-S1')).toBe(true);
    const refused = pasteClipboard(p, clip, ['U-S4', 'U-S5'], idOf);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toContain('하나만');
    const other = emptyProject('다른', idOf);
    const need = pasteClipboard(other, clip, [], idOf);
    expect(need.ok).toBe(false);
    if (!need.ok) expect(need.reason).toContain('Unit');
  });
});
