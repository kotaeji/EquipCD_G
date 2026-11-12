import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as C from '../src/model/commands';
import { emptyProject } from '../src/model/factory';
import { applyEdit, initHistory, undo } from '../src/model/history';
import { buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import { parseProjectFile } from '../src/storage/fileFormat';
import type { Layout, Project } from '../src/model/types';
import { UNIT_DEFAULT_H, UNIT_DEFAULT_W, UNIT_HEADER, UNIT_PAD, fitUnit, nextDeviceSlot, overlappingUnitIds } from '../src/model/unitLayout';

const okp = (r: C.CmdResult) => { if (!r.ok) throw new Error(r.reason); return r.project; };
const layout = (p: Project, id: string): Layout => {
  const u = p.units.find((x) => x.id === id);
  const d = p.devices.find((x) => x.id === id);
  const box = u?.layout ?? d?.layout;
  if (!box) throw new Error(id);
  return { ...box };
};
const wraps = (p: Project, unitId: string) => {
  const u = p.units.find((x) => x.id === unitId)!;
  return p.devices.filter((d) => d.unitId === unitId).every((d) =>
    d.layout.x >= u.layout.x + UNIT_PAD
    && d.layout.y >= u.layout.y + UNIT_HEADER + UNIT_PAD
    && d.layout.x + d.layout.w <= u.layout.x + u.layout.w - UNIT_PAD
    && d.layout.y + d.layout.h <= u.layout.y + u.layout.h - UNIT_PAD);
};
const overlap = (a: Layout, b: Layout) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function placed() {
  let p = okp(C.addUnit(emptyProject('t'), 'U', { x: 100, y: 100 }));
  const unitId = p.units[0].id;
  p = okp(C.addDevice(p, 'cylinder', { x: 120, y: 160 }));
  const deviceId = p.devices[0].id;
  return { p, unitId, deviceId };
}

describe('TURN-013 unit size', () => {
  it('AC1 moving a device out on any side grows the unit in that command, and one undo restores both', () => {
    const base = placed();
    const expectGrow = (dx: number, dy: number, check: (before: Project, after: Project) => void) => {
      const before = base.p;
      const rev = before.revision;
      const moved = okp(C.moveNodes(before, [base.deviceId], dx, dy));
      expect(moved.revision).toBe(rev + 1);
      expect(wraps(moved, base.unitId)).toBe(true);
      check(before, moved);
      const h = applyEdit(initHistory(before), C.moveNodes(before, [base.deviceId], dx, dy), '이동', false).history;
      expect(h.past).toHaveLength(1);
      const back = undo(h, false).history.present;
      expect(layout(back, base.unitId)).toEqual(layout(before, base.unitId));
      expect(layout(back, base.deviceId)).toEqual(layout(before, base.deviceId));
      expect(back.revision).toBe(rev);
    };
    expectGrow(200, 0, (before, after) => {
      expect(layout(after, base.unitId).x).toBe(layout(before, base.unitId).x);
      expect(layout(after, base.unitId).w).toBeGreaterThan(layout(before, base.unitId).w);
      expect(layout(after, base.unitId).h).toBe(layout(before, base.unitId).h);
    });
    expectGrow(0, 220, (before, after) => {
      expect(layout(after, base.unitId).y).toBe(layout(before, base.unitId).y);
      expect(layout(after, base.unitId).h).toBeGreaterThan(layout(before, base.unitId).h);
      expect(layout(after, base.unitId).w).toBe(layout(before, base.unitId).w);
    });
    expectGrow(-80, 0, (before, after) => {
      expect(layout(after, base.unitId).x).toBeLessThan(layout(before, base.unitId).x);
      expect(layout(after, base.unitId).x + layout(after, base.unitId).w).toBe(layout(before, base.unitId).x + layout(before, base.unitId).w);
    });
    expectGrow(0, -80, (before, after) => {
      expect(layout(after, base.unitId).y).toBeLessThan(layout(before, base.unitId).y);
      expect(layout(after, base.unitId).y + layout(after, base.unitId).h).toBe(layout(before, base.unitId).y + layout(before, base.unitId).h);
    });
  });

  it('AC2 add, template, reparent, and align keep the owning unit around its devices', () => {
    const added = placed();
    expect(wraps(added.p, added.unitId)).toBe(true);
    expect(layout(added.p, added.unitId)).toEqual({ x: 100, y: 100, w: UNIT_DEFAULT_W, h: UNIT_DEFAULT_H });

    const templ = okp(C.addUnitFromTemplate(emptyProject('t'), 'unitTransfer', { x: 40, y: 40 }));
    const tu = templ.units[0];
    expect(tu.layout.w).toBe(216);
    expect(tu.layout.h).toBe(300);
    expect(wraps(templ, tu.id)).toBe(true);

    const host = placed();
    let p = okp(C.addUnit(host.p, 'V', { x: 500, y: 100 }));
    const other = p.units[1].id;
    const oldBox = layout(p, host.unitId);
    const rev = p.revision;
    p = okp(C.reparentDevice(p, host.deviceId, other, { x: 480, y: 80 }));
    expect(p.revision).toBe(rev + 1);
    expect(layout(p, host.unitId)).toEqual(oldBox);
    expect(wraps(p, other)).toBe(true);
    expect(layout(p, other).x).toBeLessThan(500);

    let row = okp(C.addUnit(emptyProject('row'), 'A', { x: 0, y: 0 }));
    row = okp(C.addUnit(row, 'B', { x: 400, y: 0 }));
    row = okp(C.addDevice(row, 'cylinder', { x: 40, y: 80 }));
    row = okp(C.addDevice(row, 'pusher', { x: 440, y: 90 }));
    const leftId = row.devices[0].id;
    const rightId = row.devices[1].id;
    const bId = row.units[1].id;
    const aligned = okp(C.alignNodes(row, [leftId, rightId], 'left'));
    expect(aligned.devices.find((d) => d.id === rightId)!.layout.x).toBe(aligned.devices.find((d) => d.id === leftId)!.layout.x);
    expect(wraps(aligned, bId)).toBe(true);
    expect(wraps(aligned, row.units[0].id)).toBe(true);
  });

  it('AC3 resize keeps the origin, refuses to cut a device, and is one undo step', () => {
    const { p, unitId, deviceId } = placed();
    const box = layout(p, unitId);
    const dev = layout(p, deviceId);
    const grown = okp(C.resizeUnit(p, unitId, 420, 480));
    expect(grown.revision).toBe(p.revision + 1);
    expect(layout(grown, unitId)).toEqual({ ...box, w: 420, h: 480 });
    expect(layout(grown, deviceId)).toEqual(dev);
    const h = applyEdit(initHistory(p), C.resizeUnit(p, unitId, 420, 480), 'Unit 크기', false).history;
    expect(undo(h, false).history.present.units[0].layout).toEqual(box);

    const clamped = okp(C.resizeUnit(p, unitId, 40, 40));
    const min = layout(clamped, unitId);
    expect(min.x).toBe(box.x);
    expect(min.y).toBe(box.y);
    expect(min.w).toBeLessThan(box.w);
    expect(wraps(clamped, unitId)).toBe(true);
    expect(C.resizeUnit(clamped, unitId, min.w, min.h).ok).toBe(false);
    expect(C.resizeUnit(p, 'missing', 300, 300).ok).toBe(false);
  });

  it('AC4 fit-to-content shrinks to the devices, and an empty unit returns to the default size', () => {
    const { p, unitId } = placed();
    const wide = okp(C.resizeUnit(p, unitId, 500, 500));
    const fitted = okp(C.fitUnitToContent(wide, unitId));
    expect(fitted.revision).toBe(wide.revision + 1);
    expect(layout(fitted, unitId).w).toBeLessThan(500);
    expect(layout(fitted, unitId).h).toBeLessThan(500);
    expect(wraps(fitted, unitId)).toBe(true);
    expect(C.fitUnitToContent(fitted, unitId).ok).toBe(false);
    const back = undo(applyEdit(initHistory(wide), C.fitUnitToContent(wide, unitId), '크기 맞춤', false).history, false).history.present;
    expect(layout(back, unitId)).toEqual(layout(wide, unitId));

    let empty = okp(C.addUnit(emptyProject('e'), 'E', { x: 10, y: 20 }));
    const id = empty.units[0].id;
    empty = okp(C.resizeUnit(empty, id, 400, 180));
    const reset = okp(C.fitUnitToContent(empty, id));
    expect(layout(reset, id)).toEqual({ x: 10, y: 20, w: UNIT_DEFAULT_W, h: UNIT_DEFAULT_H });
  });

  it('AC5 three devices dropped on one unit card do not overlap, and a full unit grows', () => {
    let p = okp(C.addUnit(emptyProject('b'), 'U', { x: 30, y: 70 }));
    const id = p.units[0].id;
    const kind = 'cylinder' as const;
    for (let i = 0; i < 3; i++) p = okp(C.addDevice(p, kind, nextDeviceSlot(p, id, kind), undefined, undefined, id));
    const boxes = p.devices.map((d) => d.layout);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j])).toBe(false);
    expect(wraps(p, id)).toBe(true);

    let full = p;
    for (let i = 0; i < 8; i++) full = okp(C.addDevice(full, kind, nextDeviceSlot(full, id, kind), undefined, undefined, id));
    expect(layout(full, id).h).toBeGreaterThan(UNIT_DEFAULT_H);
    expect(wraps(full, id)).toBe(true);
    const all = full.devices.map((d) => d.layout);
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlap(all[i], all[j])).toBe(false);
  });

  it('AC6 resize and fit are blocked while running', () => {
    const { p, unitId } = placed();
    const h = initHistory(p);
    const a = applyEdit(h, C.resizeUnit(p, unitId, 400, 400), 'Unit 크기', true);
    const b = applyEdit(h, C.fitUnitToContent(p, unitId), '크기 맞춤', true);
    expect(a.error).toMatch(/차단/);
    expect(b.error).toMatch(/차단/);
    expect(a.history).toBe(h);
    expect(b.history).toBe(h);
  });

  it('AC7 opening the sample files does not change revision or unit size', () => {
    for (const file of ['samples/sample-5step.ecd.json', 'samples/sample-parallel-substation.ecd.json']) {
      const raw = JSON.parse(readFileSync(file, 'utf8'));
      const parsed = parseProjectFile(readFileSync(file, 'utf8'));
      if (!parsed.ok) throw new Error(parsed.errors.map((e) => e.message).join('; '));
      expect(parsed.project.revision).toBe(raw.project.revision);
      expect(parsed.project.units.map((u) => u.layout)).toEqual(raw.project.units.map((u: { layout: Layout }) => u.layout));
      const clone = structuredClone(parsed.project);
      for (const u of clone.units) fitUnit(clone, u.id);
      expect(clone.units.map((u) => u.layout)).toEqual(parsed.project.units.map((u) => u.layout));
      expect(clone.revision).toBe(parsed.project.revision);
    }
    for (const built of [buildSampleProject(), buildParallelSampleProject()]) {
      const clone = structuredClone(built);
      for (const u of clone.units) fitUnit(clone, u.id);
      expect(clone.units.map((u) => ({ id: u.id, layout: u.layout }))).toEqual(built.units.map((u) => ({ id: u.id, layout: u.layout })));
    }
  });

  it('a grown unit may overlap its neighbor and does not push it', () => {
    let p = okp(C.addUnit(emptyProject('n'), 'A', { x: 0, y: 0 }));
    p = okp(C.addUnit(p, 'B', { x: 400, y: 0 }));
    p = okp(C.addDevice(p, 'cylinder', { x: 40, y: 80 }));
    const a = p.units[0].id;
    const b = p.units[1].id;
    const dev = p.devices[0].id;
    const beforeB = layout(p, b);
    p = okp(C.moveNodes(p, [dev], 360, 0));
    expect(layout(p, b)).toEqual(beforeB);
    expect(wraps(p, a)).toBe(true);
    const boxes = p.units.map((u) => ({ id: u.id, ...u.layout }));
    expect(overlappingUnitIds(boxes).sort()).toEqual([a, b].sort());
    const hit = C.unitAt(p, layout(p, b).x + 4, layout(p, b).y + 4);
    expect(hit?.id).toBe(b);
  });
});
