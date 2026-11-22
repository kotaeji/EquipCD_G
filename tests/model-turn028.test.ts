import { describe, expect, it } from 'vitest';
import * as C from '../src/model/commands';
import { DEVICE_ARRANGE_GAP, deviceVisualBox } from '../src/model/deviceArrange';
import { emptyProject } from '../src/model/factory';
import { applyEdit, initHistory, redo, undo } from '../src/model/history';
import { buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import type { AssetKind, Project } from '../src/model/types';
import { UNIT_DEFAULT_H, UNIT_DEFAULT_W, UNIT_HEADER, UNIT_PAD, rectsOverlap } from '../src/model/unitLayout';

const okp = (r: C.CmdResult) => { if (!r.ok) throw new Error(r.reason); return r.project; };
const layout = (p: Project, id: string) => {
  const box = p.units.find((u) => u.id === id)?.layout ?? p.devices.find((d) => d.id === id)?.layout;
  if (!box) throw new Error(id);
  return { ...box };
};
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
const visual = (p: Project, id: string) => {
  const d = p.devices.find((x) => x.id === id)!;
  return deviceVisualBox(d, p.signals.some((s) => s.deviceId === id && s.direction === 'in'), p.signals.some((s) => s.deviceId === id && s.direction === 'out'));
};
const visualsOf = (p: Project, unitId: string) => p.devices.filter((d) => d.unitId === unitId).map((d) => visual(p, d.id));

function expectClear(p: Project, unitId: string) {
  const u = p.units.find((x) => x.id === unitId)!;
  const boxes = visualsOf(p, unitId);
  for (let i = 0; i < boxes.length; i++) {
    expect(boxes[i].x).toBeGreaterThanOrEqual(u.layout.x);
    expect(boxes[i].y).toBeGreaterThanOrEqual(u.layout.y);
    expect(boxes[i].x + boxes[i].w).toBeLessThanOrEqual(u.layout.x + u.layout.w);
    expect(boxes[i].y + boxes[i].h).toBeLessThanOrEqual(u.layout.y + u.layout.h);
    for (let j = i + 1; j < boxes.length; j++) expect(rectsOverlap(boxes[i], boxes[j])).toBe(false);
  }
  for (const d of p.devices.filter((x) => x.unitId === unitId)) {
    expect(d.layout.x).toBeGreaterThanOrEqual(u.layout.x + UNIT_PAD);
    expect(d.layout.y).toBeGreaterThanOrEqual(u.layout.y + UNIT_HEADER + UNIT_PAD);
    expect(d.layout.x + d.layout.w).toBeLessThanOrEqual(u.layout.x + u.layout.w - UNIT_PAD);
    expect(d.layout.y + d.layout.h).toBeLessThanOrEqual(u.layout.y + u.layout.h - UNIT_PAD);
  }
}

function expectGap(p: Project, unitId: string) {
  const devs = p.devices.filter((d) => d.unitId === unitId);
  const xs = [...new Set(devs.map((d) => d.layout.x))].sort((a, b) => a - b);
  for (let i = 0; i < xs.length - 1; i++) {
    const left = devs.filter((d) => d.layout.x === xs[i]).map((d) => visual(p, d.id));
    const right = devs.filter((d) => d.layout.x === xs[i + 1]).map((d) => visual(p, d.id));
    const edge = Math.max(...left.map((b) => b.x + b.w));
    const next = Math.min(...right.map((b) => b.x));
    expect(next - edge).toBe(DEVICE_ARRANGE_GAP);
  }
  for (const x of xs) {
    const col = devs.filter((d) => d.layout.x === x).map((d) => visual(p, d.id)).sort((a, b) => a.y - b.y);
    for (let i = 0; i < col.length - 1; i++) expect(col[i + 1].y - (col[i].y + col[i].h)).toBeGreaterThanOrEqual(DEVICE_ARRANGE_GAP);
  }
}

function addDevices(kinds: AssetKind[], at = { x: 80, y: 60 }) {
  let p = okp(C.addUnit(emptyProject('t'), 'M', at));
  const unitId = p.units[0].id;
  const ids: string[] = [];
  for (const kind of kinds) {
    p = okp(C.addDevice(p, kind, { x: at.x + 16, y: at.y + 40 }, undefined, undefined, unitId));
    ids.push(p.devices[p.devices.length - 1].id);
  }
  return { p, unitId, ids };
}

function stack(p: Project, ids: string[]) {
  const cur = structuredClone(p);
  const anchor = cur.devices.find((d) => d.id === ids[0])!.layout;
  for (const id of ids) {
    const d = cur.devices.find((x) => x.id === id)!;
    d.layout.x = anchor.x;
    d.layout.y = anchor.y;
  }
  return cur;
}

function internalEdges(p: Project, unitId: string) {
  const ids = new Set(p.devices.filter((d) => d.unitId === unitId).map((d) => d.id));
  return p.connections.filter((c) => c.kind === 'signal' && ids.has(c.from.nodeId) && ids.has(c.to.nodeId));
}

describe('TURN-028 device auto arrange', () => {
  it('AC2 sample units, one device, and an empty unit leave every visual box inside and unstacked', () => {
    for (const sample of [buildSampleProject(), buildParallelSampleProject()]) {
      for (const u of sample.units) {
        const out = okp(C.arrangeDevices(sample, u.id));
        expectClear(out, u.id);
        expectGap(out, u.id);
        expect(layout(out, u.id).x).toBe(u.layout.x);
        expect(layout(out, u.id).y).toBe(u.layout.y);
      }
    }
    const one = addDevices(['sensor']);
    const piled = okp(C.resizeUnit(one.p, one.unitId, 420, 420));
    const fitted = okp(C.arrangeDevices(piled, one.unitId));
    expectClear(fitted, one.unitId);
    expect(fitted.devices).toHaveLength(1);
    expect(layout(fitted, one.unitId).x).toBe(layout(piled, one.unitId).x);
    expect(layout(fitted, one.unitId).y).toBe(layout(piled, one.unitId).y);

    let empty = okp(C.addUnit(emptyProject('e'), 'E', { x: 12, y: 24 }));
    const eid = empty.units[0].id;
    empty = okp(C.resizeUnit(empty, eid, 400, 180));
    const reset = okp(C.arrangeDevices(empty, eid));
    expect(layout(reset, eid)).toEqual({ x: 12, y: 24, w: UNIT_DEFAULT_W, h: UNIT_DEFAULT_H });
    expect(C.arrangeDevices(reset, eid).ok).toBe(false);
  });

  it('AC2 four overlapped devices with two signals separate, and a long name stays inside the unit', () => {
    const built = addDevices(['sensor', 'pusher', 'cylinder', 'conveyor']);
    let p = stack(built.p, built.ids);
    const [sensor, pusher, cylinder, conveyor] = built.ids;
    p = link(p, sensor, conveyor);
    p = link(p, cylinder, pusher);
    expect(internalEdges(p, built.unitId).length).toBeGreaterThanOrEqual(2);
    const before = visualsOf(p, built.unitId);
    expect(before.some((a, i) => before.some((b, j) => i < j && rectsOverlap(a, b)))).toBe(true);
    const out = okp(C.arrangeDevices(p, built.unitId));
    expectClear(out, built.unitId);
    expectGap(out, built.unitId);
    expect(layout(out, sensor).x).toBeLessThan(layout(out, conveyor).x);
    expect(layout(out, cylinder).x).toBeLessThan(layout(out, pusher).x);
    const crosses = (layout(out, sensor).y - layout(out, cylinder).y) * (layout(out, conveyor).y - layout(out, pusher).y) < 0;
    expect(crosses).toBe(false);

    const named = structuredClone(out);
    named.devices.find((d) => d.id === sensor)!.name = '아주긴광전센서이름표입니다';
    const wide = okp(C.arrangeDevices(named, built.unitId));
    expectClear(wide, built.unitId);
  });

  it('a signal that skips a column keeps a lane so the line is not forced through the device in between', () => {
    const built = addDevices(['photoelectricSensor', 'pusher', 'stopper', 'conveyor']);
    const [sensor, pusher, stopper, conveyor] = built.ids;
    let p = link(built.p, sensor, conveyor);
    p = link(p, stopper, pusher);
    p = link(p, pusher, conveyor);
    const out = okp(C.arrangeDevices(p, built.unitId));
    expectClear(out, built.unitId);
    const portY = (id: string) => layout(out, id).y + layout(out, id).h / 2;
    const bandTop = Math.min(portY(sensor), portY(conveyor));
    const bandBot = Math.max(portY(sensor), portY(conveyor));
    const mid = layout(out, pusher);
    const clear = bandBot <= mid.y || bandTop >= mid.y + mid.h;
    expect(clear).toBe(true);
    expect(layout(out, stopper).x).toBeLessThan(layout(out, pusher).x);
    expect(layout(out, pusher).x).toBeLessThan(layout(out, conveyor).x);
  });

  it('AC3 a signal that is not in a cycle places the sender to the left of the receiver', () => {
    for (const sample of [buildSampleProject(), buildParallelSampleProject()]) {
      for (const u of sample.units) {
        const out = okp(C.arrangeDevices(sample, u.id));
        for (const edge of internalEdges(out, u.id)) {
          expect(layout(out, edge.from.nodeId).x).toBeLessThan(layout(out, edge.to.nodeId).x);
        }
      }
    }
    const built = addDevices(['cylinder', 'cylinder', 'cylinder']);
    const [a, b, c] = built.ids;
    let p = link(built.p, a, b);
    p = link(p, b, c);
    p = link(p, c, a);
    const out = okp(C.arrangeDevices(p, built.unitId));
    const kept = internalEdges(out, built.unitId).filter((edge) => layout(out, edge.from.nodeId).x < layout(out, edge.to.nodeId).x);
    expect(kept.length).toBe(2);
    expect(layout(out, a).x).toBeLessThan(layout(out, b).x);
    expect(layout(out, b).x).toBeLessThan(layout(out, c).x);
  });

  it('AC4 a left-hand unit pulls a device to the left column and a right-hand unit pulls one to the right', () => {
    let p = okp(C.addUnit(emptyProject('row'), 'L', { x: 0, y: 40 }));
    p = okp(C.addUnit(p, 'M', { x: 500, y: 40 }));
    p = okp(C.addUnit(p, 'R', { x: 1000, y: 80 }));
    const [left, mid, right] = p.units.map((u) => u.id);
    const put = (kind: AssetKind, unitId: string) => {
      p = okp(C.addDevice(p, kind, { x: 0, y: 0 }, undefined, undefined, unitId));
      return p.devices[p.devices.length - 1].id;
    };
    const l1 = put('cylinder', left);
    const r1 = put('cylinder', right);
    const inbound = put('pusher', mid);
    const outbound = put('stopper', mid);
    const src = put('cylinder', mid);
    const both = put('cylinder', mid);
    const sink = put('conveyor', mid);
    const loose = put('sensor', mid);
    p = link(p, l1, inbound);
    p = link(p, l1, both);
    p = link(p, outbound, r1);
    p = link(p, both, r1);
    p = link(p, src, both);
    p = link(p, both, sink);
    const origin = layout(p, mid);
    const others = p.units.filter((u) => u.id !== mid).map((u) => ({ ...u.layout }));
    const out = okp(C.arrangeDevices(p, mid));
    const xs = out.devices.filter((d) => d.unitId === mid).map((d) => d.layout.x);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    expect(layout(out, inbound).x).toBe(minX);
    expect(layout(out, outbound).x).toBe(maxX);
    expect(layout(out, src).x).toBeLessThan(layout(out, both).x);
    expect(layout(out, both).x).toBeLessThan(layout(out, sink).x);
    expect(layout(out, both).x).toBeGreaterThan(minX);
    expect(layout(out, both).x).toBeLessThan(maxX);
    expect(layout(out, loose).x).toBeGreaterThanOrEqual(minX);
    expect(layout(out, mid)).toMatchObject({ x: origin.x, y: origin.y });
    expect(out.units.filter((u) => u.id !== mid).map((u) => u.layout)).toEqual(others);
    expectClear(out, mid);
  });

  it('AC5 the same project arranges the same way, and a second run changes nothing', () => {
    const built = addDevices(['sensor', 'pusher', 'cylinder', 'conveyor', 'stopper']);
    let p = link(built.p, built.ids[0], built.ids[1]);
    p = link(p, built.ids[2], built.ids[3]);
    p = link(p, built.ids[1], built.ids[4]);
    const once = okp(C.arrangeDevices(p, built.unitId));
    const twice = C.arrangeDevices(once, built.unitId);
    expect(twice.ok).toBe(false);
    if (twice.ok) return;
    expect(twice.reason).toBe(C.ARRANGE_UNCHANGED);
    expect(once.revision).toBe(p.revision + 1);

    const shuffled = structuredClone(p);
    shuffled.devices.forEach((d, i) => { d.layout.x = 1000 - i * 30; d.layout.y = 40 + (i % 3) * 15; });
    const again = okp(C.arrangeDevices(shuffled, built.unitId));
    expect(again.devices.map((d) => d.layout)).toEqual(once.devices.map((d) => d.layout));
    expect(again.units.map((u) => u.layout)).toEqual(once.units.map((u) => u.layout));
  });

  it('AC6 one undo restores device positions and the unit size, and redo puts the arrangement back', () => {
    const sample = buildSampleProject();
    const id = 'U-S2';
    const beforeDevices = sample.devices.map((d) => ({ ...d.layout }));
    const beforeUnit = layout(sample, id);
    const h = applyEdit(initHistory(sample), C.arrangeDevices(sample, id), '자동 정렬', false).history;
    expect(h.past).toHaveLength(1);
    expect(h.present.revision).toBe(sample.revision + 1);
    const back = undo(h, false).history;
    expect(back.present.devices.map((d) => d.layout)).toEqual(beforeDevices);
    expect(layout(back.present, id)).toEqual(beforeUnit);
    expect(back.present.revision).toBe(sample.revision);
    const forward = redo(back, false).history.present;
    expect(forward.devices.map((d) => d.layout)).toEqual(h.present.devices.map((d) => d.layout));
    expect(layout(forward, id)).toEqual(layout(h.present, id));
  });

  it('AC7 other units, links, ownership, and ids stay put while this unit keeps its top-left', () => {
    const sample = buildSampleProject();
    const id = 'U-S4';
    const origin = layout(sample, id);
    const out = okp(C.arrangeDevices(sample, id));
    expect(layout(out, id).x).toBe(origin.x);
    expect(layout(out, id).y).toBe(origin.y);
    expect(out.units.filter((u) => u.id !== id).map((u) => u.layout)).toEqual(sample.units.filter((u) => u.id !== id).map((u) => u.layout));
    expect(out.connections).toEqual(sample.connections);
    expect(out.devices.map((d) => ({ id: d.id, unitId: d.unitId, name: d.name, kind: d.kind, w: d.layout.w, h: d.layout.h, properties: d.properties }))).toEqual(
      sample.devices.map((d) => ({ id: d.id, unitId: d.unitId, name: d.name, kind: d.kind, w: d.layout.w, h: d.layout.h, properties: d.properties })),
    );
    expect(out.units.map((u) => ({ id: u.id, deviceIds: u.deviceIds, name: u.name }))).toEqual(
      sample.units.map((u) => ({ id: u.id, deviceIds: u.deviceIds, name: u.name })),
    );
    expect(out.signals).toEqual(sample.signals);
    expect(out.actions).toEqual(sample.actions);
    expect(C.arrangeDevices(sample, 'missing').ok).toBe(false);
  });

  it('the button target is one unit, or the devices of one unit', () => {
    const p = buildSampleProject();
    expect(C.arrangeDevicesTarget(p, [])).toEqual({ reason: C.ARRANGE_DEVICES_NEED_ONE });
    expect(C.arrangeDevicesTarget(p, ['U-S2'])).toEqual({ unitId: 'U-S2' });
    expect(C.arrangeDevicesTarget(p, ['U-S1', 'U-S2'])).toEqual({ reason: C.ARRANGE_DEVICES_NEED_ONE });
    expect(C.arrangeDevicesTarget(p, ['PSH-01', 'CYL-01'])).toEqual({ unitId: 'U-S1' });
    expect(C.arrangeDevicesTarget(p, ['PSH-01', 'STP-02'])).toEqual({ reason: C.ARRANGE_DEVICES_NEED_ONE });
    expect(C.arrangeDevicesTarget(p, ['U-S1', 'STP-02'])).toEqual({ unitId: 'U-S1' });
    expect(C.arrangeDevicesTarget(p, ['SIGC-1'])).toEqual({ reason: C.ARRANGE_DEVICES_NEED_ONE });
    const blocked = applyEdit(initHistory(p), C.arrangeDevices(p, 'U-S2'), '자동 정렬', true);
    expect(blocked.error).toMatch(/차단/);
    expect(blocked.history.present).toBe(p);
  });
});
