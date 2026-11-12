import { describe, expect, it } from 'vitest';
import * as C from '../src/model/commands';
import { emptyProject } from '../src/model/factory';
import { applyEdit, initHistory, undo } from '../src/model/history';
import type { Layout, Project } from '../src/model/types';
import { overlappingUnitIds, unitMinSize } from '../src/model/unitLayout';

const okp = (r: C.CmdResult) => { if (!r.ok) throw new Error(r.reason); return r.project; };
const layout = (p: Project, id: string): Layout => {
  const box = p.units.find((u) => u.id === id)?.layout ?? p.devices.find((d) => d.id === id)?.layout;
  if (!box) throw new Error(id);
  return { ...box };
};
const gapX = (p: Project, a: string, b: string) => {
  const left = layout(p, a);
  const right = layout(p, b);
  return right.x - (left.x + left.w);
};
const gapY = (p: Project, a: string, b: string) => {
  const top = layout(p, a);
  const bottom = layout(p, b);
  return bottom.y - (top.y + top.h);
};

function boxes(specs: { x: number; y: number; w: number; h: number }[]) {
  let p = emptyProject('t');
  const ids: string[] = [];
  for (const s of specs) {
    p = okp(C.addUnit(p, 'U', { x: s.x, y: s.y }));
    const id = p.units[p.units.length - 1].id;
    ids.push(id);
    const box = p.units[p.units.length - 1].layout;
    if (box.w !== s.w || box.h !== s.h) p = okp(C.resizeUnit(p, id, s.w, s.h));
  }
  return { p, ids };
}

describe('TURN-014 unit arrange', () => {
  it('AC1 equal horizontal gaps keep the ends, move owned devices, and undo in one step', () => {
    const { p, ids } = boxes([
      { x: 0, y: 10, w: 100, h: 120 },
      { x: 110, y: 40, w: 100, h: 120 },
      { x: 260, y: 70, w: 100, h: 120 },
    ]);
    const withDev = okp(C.addDevice(p, 'sensor', { x: 122, y: 80 }, undefined, undefined, ids[1]));
    const devId = withDev.devices[0].id;
    const devBefore = layout(withDev, devId);
    const ends = [layout(withDev, ids[0]), layout(withDev, ids[2])];
    const rev = withDev.revision;
    expect(gapX(withDev, ids[0], ids[1])).toBe(10);
    expect(gapX(withDev, ids[1], ids[2])).toBe(50);

    const distributed = C.distributeUnits(withDev, [...ids, devId], 'x');
    expect(distributed.ok).toBe(true);
    if (!distributed.ok) return;
    const out = distributed.project;
    expect(out.revision).toBe(rev + 1);
    expect(distributed.note).toBeUndefined();
    expect(layout(out, ids[0])).toEqual(ends[0]);
    expect(layout(out, ids[2])).toEqual(ends[1]);
    expect(layout(out, ids[1]).y).toBe(40);
    expect(gapX(out, ids[0], ids[1])).toBe(30);
    expect(gapX(out, ids[1], ids[2])).toBe(30);
    expect(layout(out, devId).x).toBe(devBefore.x + (layout(out, ids[1]).x - 110));
    expect(layout(out, devId).y).toBe(devBefore.y);

    const h = applyEdit(initHistory(withDev), C.distributeUnits(withDev, ids, 'x'), '가로 간격 같게', false).history;
    expect(h.past).toHaveLength(1);
    const back = undo(h, false).history.present;
    expect(layout(back, ids[1])).toEqual(layout(withDev, ids[1]));
    expect(layout(back, devId)).toEqual(devBefore);
    expect(back.revision).toBe(rev);
  });

  it('AC2 equal vertical gaps keep x and the end units', () => {
    const { p, ids } = boxes([
      { x: 0, y: 0, w: 100, h: 100 },
      { x: 20, y: 110, w: 100, h: 100 },
      { x: 40, y: 260, w: 100, h: 100 },
    ]);
    const rev = p.revision;
    const out = okp(C.distributeUnits(p, ids, 'y'));
    expect(out.revision).toBe(rev + 1);
    expect(layout(out, ids[0])).toEqual(layout(p, ids[0]));
    expect(layout(out, ids[2])).toEqual(layout(p, ids[2]));
    expect(layout(out, ids[1]).x).toBe(20);
    expect(gapY(out, ids[0], ids[1])).toBe(30);
    expect(gapY(out, ids[1], ids[2])).toBe(30);
    const h = applyEdit(initHistory(p), C.distributeUnits(p, ids, 'y'), '세로 간격 같게', false).history;
    expect(undo(h, false).history.present.units.map((u) => u.layout)).toEqual(p.units.map((u) => u.layout));
  });

  it('AC3 match width and height to the largest value, keep the origin, and do not cut a device', () => {
    let { p, ids } = boxes([
      { x: 10, y: 20, w: 160, h: 140 },
      { x: 400, y: 80, w: 220, h: 180 },
    ]);
    p = okp(C.addDevice(p, 'sensor', { x: 30, y: 60 }, undefined, undefined, ids[0]));
    const dev = layout(p, p.devices[0].id);
    const rev = p.revision;
    const wide = okp(C.matchUnitSize(p, ids, 'w'));
    expect(wide.revision).toBe(rev + 1);
    expect(layout(wide, ids[0])).toEqual({ x: 10, y: 20, w: 220, h: 140 });
    expect(layout(wide, ids[1])).toEqual({ x: 400, y: 80, w: 220, h: 180 });
    expect(layout(wide, p.devices[0].id)).toEqual(dev);
    const min = unitMinSize(wide, ids[0]);
    expect(layout(wide, ids[0]).w).toBeGreaterThanOrEqual(min.w);
    expect(layout(wide, ids[0]).h).toBeGreaterThanOrEqual(min.h);

    const tall = okp(C.matchUnitSize(wide, ids, 'h'));
    expect(layout(tall, ids[0])).toEqual({ x: 10, y: 20, w: 220, h: 180 });
    expect(layout(tall, ids[1])).toEqual(layout(wide, ids[1]));
    expect(layout(tall, p.devices[0].id)).toEqual(dev);

    const forced = structuredClone(wide);
    forced.units.find((u) => u.id === ids[0])!.layout.w = 40;
    const clamped = okp(C.matchUnitSize(forced, ids, 'w'));
    const floor = unitMinSize(forced, ids[0]).w;
    expect(layout(clamped, ids[0]).w).toBe(Math.max(220, floor));
    expect(layout(clamped, ids[0]).x).toBe(10);
    const box = layout(clamped, ids[0]);
    const child = layout(clamped, p.devices[0].id);
    expect(child.x + child.w).toBeLessThanOrEqual(box.x + box.w);
  });

  it('AC4 spread pushes only units closer than 20px, and leaves the rest', () => {
    const { p, ids } = boxes([
      { x: 0, y: 0, w: 100, h: 140 },
      { x: 90, y: 15, w: 100, h: 140 },
      { x: 400, y: 30, w: 100, h: 140 },
      { x: 700, y: 0, w: 100, h: 140 },
    ]);
    const withDev = okp(C.addDevice(p, 'sensor', { x: 110, y: 70 }, undefined, undefined, ids[1]));
    const devId = withDev.devices[0].id;
    const devBefore = layout(withDev, devId);
    const bystander = layout(withDev, ids[3]);
    const rev = withDev.revision;
    expect(overlappingUnitIds(withDev.units.map((u) => ({ id: u.id, ...u.layout })))).toEqual(expect.arrayContaining([ids[0], ids[1]]));

    const out = okp(C.spreadUnits(withDev, [ids[0], ids[1], ids[2]], C.UNIT_SPREAD_GAP));
    expect(out.revision).toBe(rev + 1);
    expect(layout(out, ids[0])).toEqual(layout(withDev, ids[0]));
    expect(layout(out, ids[1]).x).toBe(120);
    expect(layout(out, ids[1]).y).toBe(15);
    expect(gapX(out, ids[0], ids[1])).toBe(20);
    expect(layout(out, ids[2])).toEqual(layout(withDev, ids[2]));
    expect(layout(out, ids[3])).toEqual(bystander);
    expect(layout(out, devId).x).toBe(devBefore.x + 30);
    expect(layout(out, devId).y).toBe(devBefore.y);
    expect(overlappingUnitIds(out.units.map((u) => ({ id: u.id, ...u.layout })))).toEqual([]);

    const h = applyEdit(initHistory(withDev), C.spreadUnits(withDev, [ids[0], ids[1], ids[2]], C.UNIT_SPREAD_GAP), '겹침 풀기', false).history;
    const back = undo(h, false).history.present;
    expect(layout(back, ids[1])).toEqual(layout(withDev, ids[1]));
    expect(layout(back, devId)).toEqual(devBefore);
  });

  it('a selected device is ignored, and an unselected unit does not move with distribute', () => {
    const { p, ids } = boxes([
      { x: 0, y: 0, w: 100, h: 120 },
      { x: 200, y: 0, w: 100, h: 120 },
      { x: 500, y: 0, w: 100, h: 120 },
      { x: 800, y: 0, w: 100, h: 120 },
    ]);
    const hosted = okp(C.addDevice(p, 'sensor', { x: 820, y: 40 }, undefined, undefined, ids[3]));
    const devId = hosted.devices[0].id;
    const out = okp(C.distributeUnits(hosted, [ids[0], ids[1], ids[2], devId], 'x'));
    expect(layout(out, ids[3])).toEqual(layout(hosted, ids[3]));
    expect(layout(out, devId)).toEqual(layout(hosted, devId));
    expect(layout(out, ids[0]).x).toBe(0);
    expect(layout(out, ids[2]).x).toBe(500);
    expect(layout(out, ids[1]).x).not.toBe(200);
  });

  it('a negative equal gap still applies and asks for spread', () => {
    const { p, ids } = boxes([
      { x: 0, y: 0, w: 100, h: 80 },
      { x: 40, y: 0, w: 100, h: 80 },
      { x: 70, y: 0, w: 100, h: 80 },
    ]);
    const rev = p.revision;
    const r = C.distributeUnits(p, ids, 'x');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.note).toBe(C.ARRANGE_OVERLAP_HINT);
    expect(r.project.revision).toBe(rev + 1);
    expect(layout(r.project, ids[0]).x).toBe(0);
    expect(layout(r.project, ids[2]).x).toBe(70);
    expect(gapX(r.project, ids[0], ids[1])).toBeLessThan(0);
  });

  it('AC6 an already-even arrange does not bump rev, and a running edit is blocked', () => {
    const { p, ids } = boxes([
      { x: 0, y: 0, w: 100, h: 80 },
      { x: 130, y: 0, w: 100, h: 80 },
      { x: 260, y: 0, w: 100, h: 80 },
    ]);
    const rev = p.revision;
    for (const r of [
      C.distributeUnits(p, ids, 'x'),
      C.distributeUnits(p, ids, 'y'),
      C.matchUnitSize(p, ids, 'w'),
      C.matchUnitSize(p, ids, 'h'),
      C.spreadUnits(p, ids, C.UNIT_SPREAD_GAP),
    ]) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe(C.ARRANGE_UNCHANGED);
    }
    expect(p.revision).toBe(rev);
    const h = initHistory(p);
    for (const r of [
      C.distributeUnits(p, ids, 'x'),
      C.distributeUnits(p, ids, 'y'),
      C.matchUnitSize(p, ids, 'w'),
      C.matchUnitSize(p, ids, 'h'),
      C.spreadUnits(p, ids, C.UNIT_SPREAD_GAP),
    ]) {
      const o = applyEdit(h, r, '배치', true);
      expect(o.error).toMatch(/차단/);
      expect(o.history).toBe(h);
    }
    const refused = applyEdit(h, C.distributeUnits(p, ids, 'x'), '가로 간격 같게', false);
    expect(refused.error).toBe(C.ARRANGE_UNCHANGED);
    expect(refused.history.present.revision).toBe(rev);
  });

  it('too few units are refused, and only device ids do not count', () => {
    const { p, ids } = boxes([
      { x: 0, y: 0, w: 100, h: 80 },
      { x: 300, y: 0, w: 140, h: 90 },
    ]);
    const hosted = okp(C.addDevice(p, 'sensor', { x: 20, y: 40 }, undefined, undefined, ids[0]));
    const devId = hosted.devices[0].id;
    const few = C.distributeUnits(hosted, ids, 'x');
    expect(few.ok).toBe(false);
    if (!few.ok) expect(few.reason).toBe(C.ARRANGE_NEED_3);
    for (const r of [C.matchUnitSize(hosted, [ids[0]], 'w'), C.spreadUnits(hosted, [devId], C.UNIT_SPREAD_GAP), C.distributeUnits(hosted, [devId], 'y')]) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect([C.ARRANGE_NEED_2, C.ARRANGE_NEED_3]).toContain(r.reason);
    }
    expect(C.spreadUnits(hosted, ids, Number.NaN).ok).toBe(false);
  });
});
