import { describe, expect, it } from 'vitest';
import * as C from '../src/model/commands';
import { arrangeUnitDevices } from '../src/model/deviceArrange';
import { emptyProject } from '../src/model/factory';
import { applyEdit, initHistory, redo, undo } from '../src/model/history';
import { buildSampleProject } from '../src/model/sample';
import type { AssetKind, Project } from '../src/model/types';
import { UNIT_DEFAULT_W, overlappingUnitIds } from '../src/model/unitLayout';

const okp = (r: C.CmdResult) => { if (!r.ok) throw new Error(r.reason); return r.project; };
const layout = (p: Project, id: string) => {
  const box = p.units.find((u) => u.id === id)?.layout ?? p.devices.find((d) => d.id === id)?.layout;
  if (!box) throw new Error(id);
  return { ...box };
};
const overlapIds = (p: Project) => overlappingUnitIds(p.units.map((u) => ({ id: u.id, ...u.layout })));
const outSig = (p: Project, id: string) => {
  const s = p.signals.find((x) => x.deviceId === id && x.direction === 'out');
  if (!s) throw new Error(`out ${id}`);
  return s.id;
};
const inSig = (p: Project, id: string) => {
  const s = p.signals.find((x) => x.deviceId === id && x.direction === 'in');
  if (!s) throw new Error(`in ${id}`);
  return s.id;
};
const link = (p: Project, fromId: string, toId: string) => okp(C.addConnection(p, 'signal', outSig(p, fromId), inSig(p, toId)));

const KINDS: AssetKind[] = ['sensor', 'pusher', 'cylinder', 'conveyor'];

/** Units in a row. Each holds four Devices stacked on one point and chained by signals, so auto-arrange widens the box. */
function crowdedRow(count: number, gap: number, y = 80) {
  let p = emptyProject('row');
  const ids: string[] = [];
  const devices: string[][] = [];
  let x = 40;
  for (let i = 0; i < count; i++) {
    p = okp(C.addUnit(p, `S${i + 1}`, { x, y }));
    const id = p.units[p.units.length - 1].id;
    ids.push(id);
    const mine: string[] = [];
    for (const kind of KINDS) {
      p = okp(C.addDevice(p, kind, { x: x + 24, y: y + 48 }, undefined, undefined, id));
      mine.push(p.devices[p.devices.length - 1].id);
    }
    for (let k = 0; k < mine.length - 1; k++) p = link(p, mine[k], mine[k + 1]);
    devices.push(mine);
    x += UNIT_DEFAULT_W + gap;
  }
  for (let i = 0; i < ids.length - 1; i++) p = okp(C.addConnection(p, 'flow', ids[i], ids[i + 1]));
  p = link(p, devices[0][2], devices[1][1]);
  return { p, ids, devices };
}

describe('TURN-036 arrange does not leave overlapping units', () => {
  it('AC1 a widened unit pushes the row until no two boxes overlap', () => {
    const { p, ids } = crowdedRow(5, C.UNIT_SPREAD_GAP);
    expect(overlapIds(p)).toEqual([]);
    const planned = arrangeUnitDevices(p, ids[0]);
    if (!planned) throw new Error('plan');
    expect(planned.unit.x + planned.unit.w).toBeGreaterThan(layout(p, ids[1]).x);
    const origin = layout(p, ids[0]);
    const rev = p.revision;
    const out = okp(C.arrangeDevices(p, ids[0]));
    expect(out.revision).toBe(rev + 1);
    expect(overlapIds(out)).toEqual([]);
    expect(layout(out, ids[0])).toMatchObject({ x: origin.x, y: origin.y, w: planned.unit.w, h: planned.unit.h });
    for (let i = 1; i < ids.length; i++) {
      expect(layout(out, ids[i]).x).toBeGreaterThan(layout(p, ids[i]).x);
      expect(layout(out, ids[i]).y).toBe(layout(p, ids[i]).y);
      const prev = layout(out, ids[i - 1]);
      const cur = layout(out, ids[i]);
      expect(cur.x - (prev.x + prev.w)).toBe(C.UNIT_SPREAD_GAP);
    }
  });

  it('AC2 units that still clear the grown box do not move', () => {
    const { p, ids } = crowdedRow(3, 800);
    const planned = arrangeUnitDevices(p, ids[0]);
    if (!planned) throw new Error('plan');
    expect(planned.unit.x + planned.unit.w).toBeLessThan(layout(p, ids[1]).x);
    const others = ids.slice(1).map((id) => layout(p, id));
    const devs = p.devices.filter((d) => d.unitId !== ids[0]).map((d) => ({ id: d.id, ...d.layout }));
    const out = okp(C.arrangeDevices(p, ids[0]));
    expect(overlapIds(out)).toEqual([]);
    expect(ids.slice(1).map((id) => layout(out, id))).toEqual(others);
    expect(out.devices.filter((d) => d.unitId !== ids[0]).map((d) => ({ id: d.id, ...d.layout }))).toEqual(devs);
  });

  it('AC3 the arranged unit keeps its top-left even when the unit on its left is closer than the spread gap', () => {
    let p = emptyProject('pin');
    p = okp(C.addUnit(p, 'L', { x: 0, y: 40 }));
    p = okp(C.addUnit(p, 'M', { x: 105, y: 40 }));
    const [left, mid] = p.units.map((u) => u.id);
    p = okp(C.resizeUnit(p, left, 100, 300));
    expect(layout(p, mid).x - (layout(p, left).x + layout(p, left).w)).toBe(5);
    const mine: string[] = [];
    for (const kind of KINDS) {
      p = okp(C.addDevice(p, kind, { x: 120, y: 90 }, undefined, undefined, mid));
      mine.push(p.devices[p.devices.length - 1].id);
    }
    for (let k = 0; k < mine.length - 1; k++) p = link(p, mine[k], mine[k + 1]);
    p = okp(C.addUnit(p, 'R', { x: layout(p, mid).x + layout(p, mid).w, y: 40 }));
    const right = p.units[p.units.length - 1].id;
    const origin = layout(p, mid);
    const leftBefore = layout(p, left);
    const out = okp(C.arrangeDevices(p, mid));
    expect(layout(out, mid).x).toBe(origin.x);
    expect(layout(out, mid).y).toBe(origin.y);
    expect(layout(out, left)).toEqual(leftBefore);
    expect(layout(out, right).x).toBeGreaterThan(layout(p, right).x);
    expect(overlapIds(out)).toEqual([]);
  });

  it('AC4 one undo restores devices, the unit size, and pushed units, and redo matches', () => {
    const { p, ids } = crowdedRow(4, C.UNIT_SPREAD_GAP);
    const beforeUnits = p.units.map((u) => ({ ...u.layout }));
    const beforeDevices = p.devices.map((d) => ({ ...d.layout }));
    const h = applyEdit(initHistory(p), C.arrangeDevices(p, ids[0]), '자동 정렬', false).history;
    expect(h.past).toHaveLength(1);
    expect(h.present.revision).toBe(p.revision + 1);
    expect(overlapIds(h.present)).toEqual([]);
    const back = undo(h, false).history;
    expect(back.present.units.map((u) => u.layout)).toEqual(beforeUnits);
    expect(back.present.devices.map((d) => d.layout)).toEqual(beforeDevices);
    expect(back.present.revision).toBe(p.revision);
    const forward = redo(back, false).history.present;
    expect(forward.units.map((u) => u.layout)).toEqual(h.present.units.map((u) => u.layout));
    expect(forward.devices.map((d) => d.layout)).toEqual(h.present.devices.map((d) => d.layout));
    expect(forward.revision).toBe(h.present.revision);
  });

  it('AC5 pushed units keep flow, signals, and device ownership', () => {
    const { p, ids, devices } = crowdedRow(3, C.UNIT_SPREAD_GAP);
    const out = okp(C.arrangeDevices(p, ids[0]));
    expect(out.connections).toEqual(p.connections);
    expect(out.devices.map((d) => ({ id: d.id, unitId: d.unitId, name: d.name }))).toEqual(
      p.devices.map((d) => ({ id: d.id, unitId: d.unitId, name: d.name })),
    );
    expect(out.units.map((u) => ({ id: u.id, deviceIds: [...u.deviceIds] }))).toEqual(
      p.units.map((u) => ({ id: u.id, deviceIds: [...u.deviceIds] })),
    );
    const pushed = devices[1][0];
    const dx = layout(out, ids[1]).x - layout(p, ids[1]).x;
    expect(dx).toBeGreaterThan(0);
    expect(layout(out, pushed).x - layout(p, pushed).x).toBe(dx);
    expect(layout(out, pushed).y).toBe(layout(p, pushed).y);
    const twice = C.arrangeDevices(out, ids[0]);
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.reason).toBe(C.ARRANGE_UNCHANGED);
  });

  it('AC6 arranging S1 through S5 on the sample and on a crowded row leaves no overlap', () => {
    let sample = buildSampleProject();
    for (const id of sample.units.map((u) => u.id)) {
      const r = C.arrangeDevices(sample, id);
      if (r.ok) sample = r.project;
      else expect(r.reason).toBe(C.ARRANGE_UNCHANGED);
      expect(overlapIds(sample)).toEqual([]);
    }
    let row = crowdedRow(5, C.UNIT_SPREAD_GAP).p;
    const ids = row.units.map((u) => u.id);
    const origins = new Map(ids.map((id) => [id, layout(row, id)]));
    for (const id of ids) {
      const origin = layout(row, id);
      row = okp(C.arrangeDevices(row, id));
      expect(overlapIds(row)).toEqual([]);
      expect(layout(row, id).x).toBe(origin.x);
      expect(layout(row, id).y).toBe(origin.y);
    }
    expect(layout(row, ids[0]).x).toBe(origins.get(ids[0])!.x);
    const again = C.arrangeDevices(row, ids[4]);
    expect(again.ok).toBe(false);
  });

  it('a far unit stays put, and a unit overlapping from the left is pushed left', () => {
    const built = crowdedRow(2, C.UNIT_SPREAD_GAP);
    let p = okp(C.addUnit(built.p, 'Far', { x: 4000, y: 80 }));
    const far = p.units[p.units.length - 1].id;
    const farBefore = layout(p, far);
    const anchor = built.ids[0];
    const host = layout(p, anchor);
    p = okp(C.addUnit(p, 'Left', { x: host.x - 60, y: host.y + 40 }));
    const left = p.units[p.units.length - 1].id;
    p = okp(C.resizeUnit(p, left, 120, 80));
    expect(overlapIds(p)).toContain(left);
    expect(overlapIds(p)).toContain(anchor);
    const origin = layout(p, anchor);
    const out = okp(C.arrangeDevices(p, anchor));
    expect(layout(out, anchor)).toMatchObject({ x: origin.x, y: origin.y });
    expect(layout(out, left).x).toBe(origin.x - C.UNIT_SPREAD_GAP - 120);
    expect(layout(out, left).y).toBe(host.y + 40);
    expect(layout(out, far)).toEqual(farBefore);
    expect(overlapIds(out)).toEqual([]);
  });
});
