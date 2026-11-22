import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILTIN_KINDS } from '../src/model/types';
import { buildFlowSampleProject, buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import { advance, createRuntime, start } from '../src/runtime/engine';
import { fitToPoints, type CameraState, type Viewport } from '../src/scene/camera';
import { framePoints, describeScene } from '../src/scene/describe';
import { emWidth, floorNameAxes, floorNameForZone, floorNameReadable, floorNameYaw, projectedGlyphHeight } from '../src/scene/floorLabel';
import { anchorLabels, visibleFloorNames } from '../src/scene/labels';
import { partsFor, shapeForKind } from '../src/scene/shapes';
import { materialFor, photoPartsFor, renderStyle, ROLE_MATERIAL } from '../src/scene/style';

/** 3D pane inside a 1280×800 window: explorer 224, info 200, conditions 220, and the rows above the canvas. */
const VIEW_1280: Viewport = { width: 636, height: 360 };

describe('TURN-031 floor names', () => {
  it('AC1 lays each unit name on the floor outside the back edge, parallel to that edge', () => {
    for (const project of [buildSampleProject(), buildFlowSampleProject(), buildParallelSampleProject()]) {
      const scene = describeScene(project, null);
      expect(scene.floorNames.map((n) => n.id)).toEqual(scene.zones.map((z) => z.id));
      for (const zone of scene.zones) {
        const name = scene.floorNames.find((n) => n.id === zone.id)!;
        expect(name.text).toBe(zone.name);
        expect(name.yaw).toBe(0);
        expect(name.length).toBeGreaterThan(name.depth);
        expect(name.x).toBeCloseTo(zone.x + zone.w / 2, 3);
        expect(name.z + name.depth / 2).toBeLessThanOrEqual(zone.z - 8);
        expect(name.textHeight).toBeGreaterThan(0);
        expect(name.depth).toBeGreaterThan(name.textHeight);
      }
      const labels = anchorLabels(scene, true, true);
      expect(labels.some((label) => (label.kind as string) === 'unit')).toBe(false);
      expect(labels.some((label) => label.kind === 'device')).toBe(true);
    }
  });

  it('AC2 flips the letters when the camera crosses to the far side', () => {
    const yaws = [0, 0.35, 0.7, 1.2, Math.PI / 2 - 0.2, Math.PI / 2 + 0.2, 2.2, Math.PI, Math.PI + 0.7, -0.4, -2.2, 4.2, -3.4];
    for (const yaw of yaws) {
      const labelYaw = floorNameYaw(yaw);
      expect([0, Math.PI]).toContain(labelYaw);
      expect(floorNameReadable(yaw, labelYaw)).toBe(true);
      const cam: CameraState = { targetX: 0, targetY: 0, targetZ: 0, yaw, pitch: 0.62, distance: 700, aspect: 1.4, fov: 45 };
      const view = { width: 800, height: 500 };
      const axes = floorNameAxes(labelYaw);
      const name = { id: 'z', text: 'Inspection', x: 0, z: 0, length: 80, depth: 40, textHeight: 24, yaw: 0 as const };
      const height = projectedGlyphHeight({ ...cam }, { ...name }, view);
      expect(height).toBeGreaterThan(0);
      const top = { x: axes.up.x, z: axes.up.z };
      const away = -Math.sin(yaw) * top.x + -Math.cos(yaw) * top.z;
      expect(away).toBeGreaterThanOrEqual(-1e-9);
    }
    expect(floorNameYaw(0.7)).toBe(0);
    expect(floorNameYaw(0.7 + Math.PI)).toBe(Math.PI);
    expect(floorNameReadable(Math.PI, 0)).toBe(false);
  });

  it('AC3 fit keeps zones and floor names inside the 1280 pane, with glyphs at least 11px', () => {
    const views = [VIEW_1280, { width: 636, height: 407 }, { width: 1100, height: 600 }];
    for (const project of [buildSampleProject(), buildFlowSampleProject(), buildParallelSampleProject()]) {
      const scene = describeScene(project, null);
      for (const view of views) {
        const cam = fitToPoints(framePoints(scene), view.width / view.height, view);
        for (const name of scene.floorNames) {
          expect(projectedGlyphHeight(cam, name, view)).toBeGreaterThanOrEqual(11);
        }
      }
    }
  });

  it('shrinks a long name to the zone width and keeps the strip inside that width', () => {
    const zone = { id: 'u', name: 'S1 투입', x: 0, z: 100, w: 220 };
    const short = floorNameForZone(zone);
    const inspection = floorNameForZone({ ...zone, name: 'Inspection' });
    const long = floorNameForZone({ ...zone, name: '아주긴유닛이름표입니다열두자넘음' });
    expect(short.textHeight).toBeGreaterThan(40);
    expect(long.textHeight).toBeLessThan(inspection.textHeight);
    expect(long.textHeight).toBeLessThan(short.textHeight);
    expect(long.length).toBeLessThanOrEqual(zone.w * 0.96 + 0.01);
    expect(inspection.length).toBeLessThanOrEqual(zone.w * 0.96 + 0.01);
    expect(long.textHeight * emWidth(long.text)).toBeLessThanOrEqual(long.length * 0.92 + 0.5);
    expect(inspection.textHeight * emWidth('Inspection')).toBeLessThanOrEqual(inspection.length * 0.92 + 0.5);
  });

  it('AC4 hiding names drops floor strips and device tags, and keeps markers and the material', () => {
    const project = buildFlowSampleProject();
    const rt = advance(start(createRuntime(project)), 1);
    const scene = describeScene(project, rt.state);
    expect(visibleFloorNames(scene.floorNames, true)).toHaveLength(scene.zones.length);
    expect(visibleFloorNames(scene.floorNames, false)).toEqual([]);
    const on = anchorLabels(scene, true, true);
    const off = anchorLabels(scene, false, true);
    expect(on.some((label) => label.kind === 'device')).toBe(true);
    expect(off.some((label) => label.kind === 'device')).toBe(false);
    expect(off.some((label) => label.kind === 'marker' && label.text === '▼ 동작 중')).toBe(true);
    expect(off.some((label) => label.kind === 'material')).toBe(true);
    expect(on.filter((label) => label.kind === 'marker').map((label) => label.text)).toEqual(off.filter((label) => label.kind === 'marker').map((label) => label.text));
  });
});

describe('TURN-031 photo style', () => {
  it('AC5 photo and schematic are two render styles, and schematic lights stay as they were', () => {
    const photo = renderStyle('photo');
    const schematic = renderStyle('schematic');
    expect(photo.id).toBe('photo');
    expect(schematic.id).toBe('schematic');
    expect(photo.shadows).toBe(true);
    expect(photo.key).toBeGreaterThan(0);
    expect(photo.fill).toBeGreaterThan(0);
    expect(photo.floorPattern).toBe(true);
    expect(schematic.shadows).toBe(false);
    expect(schematic.fill).toBe(0);
    expect(schematic.floorPattern).toBe(false);
    expect(schematic.ambient).toBeCloseTo(0.78);
    expect(schematic.key).toBeCloseTo(0.95);
  });

  it('AC6 gives every built-in kind more photo parts than the schematic, and an unknown kind a single box', () => {
    for (const kind of BUILTIN_KINDS) {
      const shape = shapeForKind(kind);
      const schematic = partsFor(shape, 120, 80);
      const photo = photoPartsFor(shape, 120, 80);
      expect(photo.length).toBeGreaterThan(schematic.length);
      expect(new Set(photo.map((part) => part.role)).size).toBeGreaterThan(1);
      for (const part of photo) {
        const mat = materialFor(part);
        expect(ROLE_MATERIAL[part.role]).toBeTruthy();
        expect(mat.color).toMatch(/^#[0-9a-f]{6}$/i);
        expect(mat.metalness).toBeGreaterThanOrEqual(0);
        expect(mat.metalness).toBeLessThanOrEqual(1);
        expect(mat.roughness).toBeGreaterThanOrEqual(0);
        expect(mat.roughness).toBeLessThanOrEqual(1);
      }
    }
    const box = photoPartsFor('box', 40, 40);
    expect(box).toHaveLength(1);
    expect(box[0].primitive).toBe('box');
    expect(photoPartsFor(shapeForKind('not-a-kind'), 40, 40)).toHaveLength(1);
    expect(photoPartsFor('conveyor', 120, 80).some((part) => part.name === 'roller')).toBe(true);
    expect(photoPartsFor('conveyor', 120, 80).some((part) => part.name === 'side')).toBe(true);
    expect(photoPartsFor('gantry', 120, 80).some((part) => part.name === 'rail')).toBe(true);
    expect(photoPartsFor('gantry', 120, 80).some((part) => part.name === 'head')).toBe(true);
    expect(photoPartsFor('picker', 120, 80).some((part) => part.name === 'gripper')).toBe(true);
    expect(photoPartsFor('stopper', 120, 80).some((part) => part.name === 'pin')).toBe(true);
    expect(photoPartsFor('barcode', 120, 80).some((part) => part.name === 'lens')).toBe(true);
    expect(photoPartsFor('limit', 120, 80).some((part) => part.name === 'lever')).toBe(true);
    const sources = ['src/scene/style.ts', 'src/scene/floorLabel.ts', 'src/scene/describe.ts'].map((file) => readFileSync(file, 'utf8')).join('\n');
    expect(sources).not.toMatch(/\.gltf|\.png|\.jpg|readFile|fetch\(/);
  });

  it('AC7 a running photo scene still names the active step and the material', () => {
    const project = buildSampleProject();
    const rt = advance(start(createRuntime(project)), 1);
    const scene = describeScene(project, rt.state);
    const labels = anchorLabels(scene, true, true);
    expect(labels.some((label) => label.kind === 'marker' && label.text === '▼ 동작 중')).toBe(true);
    expect(labels.some((label) => label.kind === 'material')).toBe(true);
    expect(renderStyle('photo').shadows).toBe(true);
    expect(renderStyle('photo').key).toBeGreaterThan(0);
    expect(renderStyle('photo').fill).toBeGreaterThan(0);
    const faulted = buildSampleProject();
    const read = faulted.actions.find((a) => a.deviceId === 'BCR-02')!;
    faulted.simSettings.faults.neverTrueSignalIds = [read.completeSignalId!];
    const done = advance(start(createRuntime(faulted)), 1);
    expect(anchorLabels(describeScene(faulted, done.state), false, true).some((label) => label.text === '▼ 동작 중' || label.text === '오류' || label.kind === 'material')).toBe(true);
  });
});
