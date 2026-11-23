import { describe, expect, it } from 'vitest';
import { assessBackground, BACKGROUND_MAX_BYTES, BACKGROUND_MAX_EDGE, calibrateScale, clearDiagramBackground, placeDiagramBackground, readDiagramBackground, updateDiagramBackground } from '../src/model/background';
import { alignNodes, arrangeDevices, distributeUnits, fitUnitToContent, lockedExcludedNote, matchUnitSize, moveNodes, resizeUnit, setAllUnitPositionLock, setUnitPositionLock, spreadUnits, UNIT_SPREAD_GAP } from '../src/model/commands';
import { applyEdit, initHistory, undo } from '../src/model/history';
import { buildFlowSampleProject, buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import { FILE_FORMAT_VERSION, type Project } from '../src/model/types';
import { overlappingUnitIds } from '../src/model/unitLayout';
import { parseProjectFile, serializeProject } from '../src/storage/fileFormat';
import { runEquipmentBoxes } from '../src/ui/Canvas';
import { backgroundRejectProblem } from '../src/ui/problemCopy';

function okp(r: { ok: boolean; project?: Project; reason?: string; note?: string }): Project {
  if (!r.ok || !r.project) throw new Error(r.reason ?? 'expected ok');
  return r.project;
}

function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(24);
  b.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  b[16] = (width >>> 24) & 255; b[17] = (width >>> 16) & 255; b[18] = (width >>> 8) & 255; b[19] = width & 255;
  b[20] = (height >>> 24) & 255; b[21] = (height >>> 16) & 255; b[22] = (height >>> 8) & 255; b[23] = height & 255;
  return b;
}

function jpeg(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >> 8) & 255, height & 255,
    (width >> 8) & 255, width & 255,
    0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
  ]);
}

function layouts(p: Project) {
  return p.units.map((u) => ({ id: u.id, ...u.layout, locked: u.positionLocked === true }));
}

describe('TURN-059 background file', () => {
  it('AC3 AC4: accepts a small PNG and JPEG, and rejects size, edge, and non-images', () => {
    const pngOk = assessBackground(png(200, 80), 'image/png');
    const jpgOk = assessBackground(jpeg(40, 20), 'image/jpeg');
    expect(pngOk.ok && pngOk.image.width).toBe(200);
    expect(jpgOk.ok && jpgOk.image.dataUrl.startsWith('data:image/jpeg')).toBe(true);
    expect(pngOk.ok && pngOk.image.dataUrl.startsWith('data:image/png')).toBe(true);

    const big = new Uint8Array(BACKGROUND_MAX_BYTES + 1);
    big.set(jpeg(8, 8));
    const tooBig = assessBackground(big, 'image/jpeg');
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) {
      expect(tooBig.reason.code).toBe('too-big');
      const copy = backgroundRejectProblem(tooBig.reason);
      expect(copy.what).toBeTruthy();
      expect(copy.why).toContain('2MB');
      expect(copy.how).toContain('PNG');
    }

    const wide = assessBackground(png(BACKGROUND_MAX_EDGE + 1, 10), 'image/png');
    expect(wide.ok).toBe(false);
    if (!wide.ok) expect(wide.reason).toEqual({ code: 'too-wide', edge: BACKGROUND_MAX_EDGE + 1 });
    expect(assessBackground(png(BACKGROUND_MAX_EDGE, 10), 'image/png').ok).toBe(true);
    expect(assessBackground(Uint8Array.from([1, 2, 3, 4]), 'image/png').ok).toBe(false);
    expect(assessBackground(png(10, 10), 'text/plain').ok).toBe(false);

    const before = buildSampleProject();
    const rejected = assessBackground(png(BACKGROUND_MAX_EDGE + 1, 4), 'image/png');
    expect(rejected.ok).toBe(false);
    expect(before.revision).toBe(buildSampleProject().revision);
    expect(before.diagramBackground).toBeUndefined();
  });

  it('AC4: 200px over 1000mm is 5 mm per pixel', () => {
    expect(calibrateScale(200, 1000)).toBe(5);
    expect(200 * calibrateScale(200, 1000)!).toBe(1000);
    expect(calibrateScale(0, 1000)).toBeNull();
    expect(calibrateScale(200, 0)).toBeNull();
    expect(calibrateScale(-1, 10)).toBeNull();
  });
});

describe('TURN-059 background commands', () => {
  const image = () => {
    const got = assessBackground(png(200, 100), 'image/png');
    if (!got.ok) throw new Error('png');
    return got.image;
  };

  it('AC1 AC6: place, opacity, move, scale, replace, and clear are each one undo', () => {
    let p = buildSampleProject();
    const rev = p.revision;
    let h = initHistory(p);
    h = applyEdit(h, placeDiagramBackground(p, image()), '배경 도면', false).history;
    p = h.present;
    expect(p.revision).toBe(rev + 1);
    expect(readDiagramBackground(p)?.locked).toBe(true);
    expect(readDiagramBackground(p)?.opacity).toBe(100);
    expect(readDiagramBackground(p)?.scale).toBe(1);
    h = undo(h, false).history;
    expect(h.present.diagramBackground).toBeUndefined();
    expect(h.present.revision).toBe(rev);
    h = applyEdit(h, placeDiagramBackground(h.present, image()), '배경 도면', false).history;
    p = h.present;
    const steps: [typeof h, string][] = [];
    const apply = (r: ReturnType<typeof updateDiagramBackground>, label: string) => {
      const next = applyEdit(h, r, label, false);
      expect(next.error).toBeUndefined();
      h = next.history;
      p = h.present;
      steps.push([h, label]);
    };
    apply(updateDiagramBackground(p, { opacity: 40 }), '배경 불투명도');
    expect(readDiagramBackground(p)?.opacity).toBe(40);
    apply(updateDiagramBackground(p, { x: 12, y: 8 }), '배경 위치');
    expect(readDiagramBackground(p)).toMatchObject({ x: 12, y: 8 });
    apply(updateDiagramBackground(p, { scale: calibrateScale(200, 1000)! }), '배경 배율');
    expect(readDiagramBackground(p)?.scale).toBe(5);
    const replaced = assessBackground(jpeg(30, 16), 'image/jpeg');
    if (!replaced.ok) throw new Error('jpeg');
    const swap = applyEdit(h, placeDiagramBackground(p, replaced.image), '배경 바꾸기', false);
    h = swap.history;
    p = h.present;
    expect(readDiagramBackground(p)?.width).toBe(30);
    expect(readDiagramBackground(p)?.scale).toBe(5);
    const cleared = applyEdit(h, clearDiagramBackground(p), '배경 지우기', false);
    h = cleared.history;
    expect(h.present.diagramBackground).toBeUndefined();
    h = undo(h, false).history;
    expect(readDiagramBackground(h.present)?.width).toBe(30);
    expect(h.past).toHaveLength(5);
  });

  it('AC2: save and import keep the background, and an old file still opens', () => {
    let p = buildSampleProject();
    p = okp(placeDiagramBackground(p, image()));
    p = okp(updateDiagramBackground(p, { opacity: 55, x: 3, y: 4, scale: 2, locked: false }));
    const raw = serializeProject(p);
    expect(raw).toContain('diagramBackground');
    expect(JSON.parse(raw).formatVersion).toBe(FILE_FORMAT_VERSION);
    const back = parseProjectFile(raw);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(readDiagramBackground(back.project)).toEqual(readDiagramBackground(p));

    const old = JSON.parse(serializeProject(buildSampleProject()));
    delete old.project.diagramBackground;
    for (const u of old.project.units) delete u.positionLocked;
    const opened = parseProjectFile(JSON.stringify(old));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.project.diagramBackground).toBeUndefined();
    expect(opened.project.units.every((u) => u.positionLocked === undefined)).toBe(true);
    expect(opened.project.units.map((u) => u.layout)).toEqual(buildSampleProject().units.map((u) => u.layout));
  });

  it('AC8: fit boxes, overlap, and auto-arrange ignore the background', () => {
    const base = buildSampleProject();
    const withBg = okp(placeDiagramBackground(base, image()));
    expect(runEquipmentBoxes(withBg, null)).toEqual(runEquipmentBoxes(base, null));
    const boxes = (p: Project) => p.units.map((u) => ({ id: u.id, ...u.layout }));
    expect(overlappingUnitIds(boxes(withBg))).toEqual(overlappingUnitIds(boxes(base)));
    const a = arrangeDevices(base, 'U-S1');
    const b = arrangeDevices(withBg, 'U-S1');
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.project.units.map((u) => u.layout)).toEqual(b.project.units.map((u) => u.layout));
    expect(a.project.devices.map((d) => d.layout)).toEqual(b.project.devices.map((d) => d.layout));
  });
});

describe('TURN-059 unit lock', () => {
  it('AC9 AC10: locked units stay put under move, align, gap, spread, and resize', () => {
    let p = buildSampleProject();
    const ids = p.units.map((u) => u.id);
    p = okp(setUnitPositionLock(p, ['U-S1'], true));
    const before = layouts(p);
    const still = () => expect(layouts(p).find((u) => u.id === 'U-S1')).toEqual(before.find((u) => u.id === 'U-S1'));

    expect(moveNodes(p, ['U-S1'], 30, 10).ok).toBe(false);
    still();
    const moved = okp(moveNodes(p, ['U-S1', 'U-S2'], 30, 0));
    expect(moved.units.find((u) => u.id === 'U-S1')!.layout.x).toBe(p.units.find((u) => u.id === 'U-S1')!.layout.x);
    expect(moved.units.find((u) => u.id === 'U-S2')!.layout.x).toBe(p.units.find((u) => u.id === 'U-S2')!.layout.x + 30);

    const dev = p.devices.find((d) => d.unitId === 'U-S1')!;
    const shifted = okp(moveNodes(p, [dev.id], 15, 0));
    expect(shifted.devices.find((d) => d.id === dev.id)!.layout.x).toBe(dev.layout.x + 15);
    expect(shifted.units.find((u) => u.id === 'U-S1')!.layout).toEqual(p.units.find((u) => u.id === 'U-S1')!.layout);

    const aligned = alignNodes(p, ids, 'left');
    expect(aligned.ok).toBe(true);
    if (!aligned.ok) return;
    expect(aligned.note).toBe(lockedExcludedNote(1));
    expect(aligned.project.units.find((u) => u.id === 'U-S1')!.layout.x).toBe(p.units.find((u) => u.id === 'U-S1')!.layout.x);
    expect(aligned.project.units.find((u) => u.id === 'U-S5')!.layout.x).not.toBe(p.units.find((u) => u.id === 'U-S5')!.layout.x);

    const oneFree = alignNodes(p, ['U-S1', 'U-S2'], 'left');
    expect(oneFree.ok).toBe(false);
    if (!oneFree.ok) expect(oneFree.reason).toContain(lockedExcludedNote(1));
    p = okp(setUnitPositionLock(p, ['U-S2'], true));
    const both = alignNodes(p, ['U-S1', 'U-S2'], 'top');
    expect(both.ok).toBe(false);
    if (!both.ok) expect(both.reason).toContain(lockedExcludedNote(2));

    p = okp(setUnitPositionLock(buildSampleProject(), ['U-S3'], true));
    const s3 = p.units.find((u) => u.id === 'U-S3')!.layout.x;
    p = okp(moveNodes(p, ['U-S2'], -40, 0));
    const spread = spreadUnits(p, p.units.map((u) => u.id), UNIT_SPREAD_GAP);
    expect(spread.ok).toBe(true);
    if (!spread.ok) return;
    expect(spread.note).toBe(lockedExcludedNote(1));
    expect(spread.project.units.find((u) => u.id === 'U-S3')!.layout.x).toBe(s3);
    expect(spread.project.units.find((u) => u.id === 'U-S2')!.layout.x).toBeGreaterThan(p.units.find((u) => u.id === 'U-S2')!.layout.x);

    const gap = distributeUnits(p, ids, 'x');
    expect(gap.ok).toBe(true);
    if (gap.ok) {
      expect(gap.note).toContain('잠긴 Unit 1개');
      expect(gap.project.units.find((u) => u.id === 'U-S3')!.layout).toEqual(p.units.find((u) => u.id === 'U-S3')!.layout);
    }
    expect(resizeUnit(p, 'U-S3', 400, 400).ok).toBe(false);
    expect(fitUnitToContent(p, 'U-S3').ok).toBe(false);
    p = okp(resizeUnit(p, 'U-S1', 400, 320));
    const matched = matchUnitSize(p, ['U-S1', 'U-S2', 'U-S3'], 'w');
    expect(matched.ok).toBe(true);
    if (matched.ok) {
      expect(matched.note).toBe(lockedExcludedNote(1));
      expect(matched.project.units.find((u) => u.id === 'U-S2')!.layout.w).toBe(400);
      expect(matched.project.units.find((u) => u.id === 'U-S3')!.layout.w).toBe(p.units.find((u) => u.id === 'U-S3')!.layout.w);
    }

    const renamed = p.units.find((u) => u.id === 'U-S3')!;
    expect(renamed.positionLocked).toBe(true);
  });

  it('AC10 AC11: lock all, unlock all, and the flag survives a save', () => {
    let p = buildSampleProject();
    const rev = p.revision;
    p = okp(setAllUnitPositionLock(p, true));
    expect(p.revision).toBe(rev + 1);
    expect(p.units.every((u) => u.positionLocked === true)).toBe(true);
    const h = applyEdit(initHistory(buildSampleProject()), setAllUnitPositionLock(buildSampleProject(), true), '모두 잠금', false).history;
    const back = undo(h, false).history.present;
    expect(back.units.every((u) => u.positionLocked === undefined)).toBe(true);
    p = okp(setAllUnitPositionLock(p, false));
    expect(p.units.every((u) => u.positionLocked === undefined)).toBe(true);
    p = okp(setUnitPositionLock(p, ['U-S2'], true));
    const raw = serializeProject(p);
    const opened = parseProjectFile(raw);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.project.units.find((u) => u.id === 'U-S2')?.positionLocked).toBe(true);
    expect(opened.project.units.find((u) => u.id === 'U-S1')?.positionLocked).toBeUndefined();
  });

  it('AC12: the three samples still serialize without a background or a lock', () => {
    for (const make of [buildSampleProject, buildParallelSampleProject, buildFlowSampleProject]) {
      const raw = serializeProject(make());
      expect(raw).not.toContain('diagramBackground');
      expect(raw).not.toContain('positionLocked');
      const opened = parseProjectFile(raw);
      expect(opened.ok).toBe(true);
    }
  });
});
