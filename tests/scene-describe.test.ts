import { describe, expect, it } from 'vitest';
import { BUILTIN_KINDS } from '../src/model/types';
import * as C from '../src/model/commands';
import { initHistory, applyEdit } from '../src/model/history';
import { buildFlowSampleProject, buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import { advance, createRuntime, runToEnd, start } from '../src/runtime/engine';
import { sceneFits, fitCamera, orbitCamera, panCamera, zoomCamera, gestureMode, applyCameraKey } from '../src/scene/camera';
import { activeDeviceIds, describeScene, faultDeviceIds } from '../src/scene/describe';
import { describeRunInfo, formatMs } from '../src/scene/runInfo';
import { revertDurationEdits } from '../src/scene/revertDurations';
import { knownShapeCount, shapeForKind } from '../src/scene/shapes';
import { summarizeRun } from '../src/runtime/runSummary';

describe('TURN-029 scene description', () => {
  it('AC2 maps every unit, device, and flow, and keeps each device inside its unit', () => {
    for (const project of [buildSampleProject(), buildFlowSampleProject(), buildParallelSampleProject()]) {
      const scene = describeScene(project, null);
      expect(scene.zones.map((z) => z.id)).toEqual(project.units.map((u) => u.id));
      expect(scene.solids.map((s) => s.id)).toEqual(project.devices.map((d) => d.id));
      expect(scene.flows.map((f) => f.id)).toEqual(project.connections.filter((c) => c.kind === 'flow').map((c) => c.id));
      for (const unit of project.units) {
        const zone = scene.zones.find((z) => z.id === unit.id)!;
        expect(zone.x).toBe(unit.layout.x);
        expect(zone.z).toBe(unit.layout.y);
        expect(zone.w).toBe(unit.layout.w);
        expect(zone.d).toBe(unit.layout.h);
      }
      for (const device of project.devices) {
        const solid = scene.solids.find((s) => s.id === device.id)!;
        const zone = scene.zones.find((z) => z.id === device.unitId)!;
        expect(solid.x).toBe(device.layout.x);
        expect(solid.z).toBe(device.layout.y);
        expect(solid.w).toBe(device.layout.w);
        expect(solid.d).toBe(device.layout.h);
        expect(solid.x).toBeGreaterThanOrEqual(zone.x);
        expect(solid.z).toBeGreaterThanOrEqual(zone.z);
        expect(solid.x + solid.w).toBeLessThanOrEqual(zone.x + zone.w + 0.001);
        expect(solid.z + solid.d).toBeLessThanOrEqual(zone.z + zone.d + 0.001);
        expect(solid.parts.length).toBeGreaterThan(0);
      }
      for (const flow of scene.flows) {
        const from = project.units.find((u) => u.id === flow.fromId)!;
        const to = project.units.find((u) => u.id === flow.toId)!;
        expect(flow.points[0]).toEqual({ x: from.layout.x + from.layout.w / 2, z: from.layout.y + from.layout.h / 2 });
        expect(flow.points[1]).toEqual({ x: to.layout.x + to.layout.w / 2, z: to.layout.y + to.layout.h / 2 });
      }
    }
  });

  it('AC2 gives each of the 14 asset kinds its own shape and uses a box otherwise', () => {
    const shapes = BUILTIN_KINDS.map((kind) => shapeForKind(kind));
    expect(new Set(shapes).size).toBe(BUILTIN_KINDS.length);
    expect(knownShapeCount()).toBe(BUILTIN_KINDS.length);
    expect(shapeForKind('not-a-kind')).toBe('box');
    const project = buildSampleProject();
    project.devices[0].kind = 'not-a-kind';
    expect(describeScene(project, null).solids[0].shape).toBe('box');
    expect(describeScene(project, null).solids[0].parts).toHaveLength(1);
  });

  it('AC3 highlights the running device, drops it when the step ends, and follows the material', () => {
    const project = buildFlowSampleProject();
    let rt = advance(start(createRuntime(project)), 1);
    const running = describeScene(project, rt.state);
    expect(running.highlights.filter((h) => h.reason === 'active').map((h) => h.deviceId)).toEqual(['PSH-01']);
    expect(running.materials[0].unitId).toBe('U-S1');
    rt = advance(rt, 900);
    const next = describeScene(project, rt.state);
    expect(next.highlights.some((h) => h.reason === 'active' && h.deviceId === 'PSH-01')).toBe(false);
    expect(activeDeviceIds(project, rt.state)).not.toContain('PSH-01');
    expect(next.materials[0].unitId).toBe('U-S2');
    const unit = project.units.find((u) => u.id === 'U-S2')!;
    expect(next.materials[0].x).toBe(unit.layout.x + unit.layout.w / 2);
    expect(next.materials[0].z).toBe(unit.layout.y + unit.layout.h / 2);

    let parallel = advance(start(createRuntime(buildParallelSampleProject())), 1);
    const both = describeScene(buildParallelSampleProject(), parallel.state).highlights.filter((h) => h.reason === 'active').map((h) => h.deviceId);
    expect(both).toEqual(expect.arrayContaining(['STP-A1', 'STP-B1']));
    expect(both.length).toBeGreaterThanOrEqual(2);
    parallel = runToEnd(parallel);
    expect(describeScene(buildParallelSampleProject(), parallel.state).highlights.filter((h) => h.reason === 'active')).toEqual([]);
  });

  it('AC3 marks the device that stopped on a timeout', () => {
    const project = buildSampleProject();
    const read = project.actions.find((a) => a.deviceId === 'BCR-02')!;
    project.simSettings.faults.neverTrueSignalIds = [read.completeSignalId!];
    const rt = runToEnd(createRuntime(project));
    expect(rt.state.status).toBe('error');
    expect(faultDeviceIds(project, rt.state)).toContain('BCR-02');
    const scene = describeScene(project, rt.state);
    expect(scene.highlights.find((h) => h.deviceId === 'BCR-02')?.reason).toBe('fault');
    expect(scene.solids.find((s) => s.id === 'BCR-02')?.highlight).toBe('fault');
    expect(scene.materials[0].unitId).toBe('U-S2');
  });

  it('AC5 bar times match the run summary, and assumed times are used before a run', () => {
    const project = buildSampleProject();
    const before = describeRunInfo(project, null);
    expect(before.assumed).toBe(true);
    expect(before.longestText).toContain('가장 긴 단계');
    expect(before.bars.find((b) => b.name.includes('가공'))!.timeText).toBe('00:02.000');
    const rt = runToEnd(createRuntime(project));
    const summary = summarizeRun(project, rt.state);
    const info = describeRunInfo(project, rt.state);
    expect(info.assumed).toBe(false);
    expect(info.timeText).toBe('00:11.100');
    expect(info.status).toBe('completed');
    expect(info.bars.map((b) => b.timeText)).toEqual(summary.steps.map((s) => (s.elapsedMs === null ? '-' : formatMs(s.elapsedMs))));
    expect(info.longestText).toBe(`가장 긴 단계 ${summary.longest!.name} ${formatMs(summary.longest!.elapsedMs)}`);
    expect(info.material?.where).toContain('배출');
    expect(info.unitTotals.reduce((n, row) => n + row.ms, 0)).toBe(summary.steps.reduce((n, s) => n + (s.elapsedMs ?? 0), 0));
  });
});

describe('TURN-029 camera', () => {
  const bounds = describeScene(buildSampleProject(), null).bounds;
  const cam = fitCamera(bounds, 1.6);

  it('AC9 fit keeps the scene in frame, and keys, drag, and zoom move the camera', () => {
    expect(sceneFits(cam, bounds)).toBe(true);
    expect(orbitCamera(cam, 40, 0).yaw).not.toBe(cam.yaw);
    expect(panCamera(cam, 24, 0).targetX).not.toBe(cam.targetX);
    expect(zoomCamera(cam, 180).distance).toBeGreaterThan(cam.distance);
    expect(zoomCamera(cam, -180).distance).toBeLessThan(cam.distance);
    expect(gestureMode(2, false)).toBe('pan');
    expect(gestureMode(0, true)).toBe('pan');
    expect(gestureMode(0, false)).toBe('orbit');
    const turned = applyCameraKey(cam, 'ArrowRight', bounds)!;
    expect(turned.yaw).not.toBe(cam.yaw);
    expect(applyCameraKey(cam, 'ArrowUp', bounds)!.pitch).not.toBe(cam.pitch);
    expect(applyCameraKey(cam, '+', bounds)!.distance).toBeLessThan(cam.distance);
    expect(applyCameraKey(cam, 'k', bounds)).toBeNull();
    const home = applyCameraKey(turned, 'Home', bounds)!;
    expect(sceneFits(home, bounds)).toBe(true);
    expect(home.yaw).toBeCloseTo(0.7);
  });
});

describe('TURN-029 revert durations', () => {
  it('AC8 undoes duration edits and leaves another edit in place', () => {
    const project = buildSampleProject();
    const pusher = project.actions.find((a) => a.name === 'S1 푸셔 투입')!;
    const other = project.actions.find((a) => a.name === 'S5 컨베이어 배출')!;
    const snap = project.actions.map((a) => ({ id: a.id, value: a.duration.value, assumption: a.duration.assumption }));
    let history = initHistory(project);
    const base = history.past.length;
    const fault = applyEdit(history, C.setFaults(history.present, { ...history.present.simSettings.faults, readFailActionIds: [pusher.id] }), '읽기 실패 주입', false);
    history = fault.history;
    const first = applyEdit(history, C.setQuantity(history.present, { kind: 'action', id: pusher.id, field: 'duration' }, 1.8, true), '3D 동작 시간', false);
    history = first.history;
    const second = applyEdit(history, C.setQuantity(history.present, { kind: 'action', id: other.id, field: 'duration' }, 3, true), '3D 동작 시간', false);
    history = second.history;
    const back = revertDurationEdits(history, base, snap);
    expect(back.present.actions.find((a) => a.id === pusher.id)!.duration.value).toBe(0.8);
    expect(back.present.actions.find((a) => a.id === other.id)!.duration.value).toBe(2);
    expect(back.present.simSettings.faults.readFailActionIds).toEqual([pusher.id]);
    expect(back.present.units.map((u) => u.name)).toEqual(project.units.map((u) => u.name));

    let buried = initHistory(buildSampleProject());
    const snap2 = buried.present.actions.map((a) => ({ id: a.id, value: a.duration.value, assumption: a.duration.assumption }));
    const id = buried.present.actions.find((a) => a.name === 'S1 푸셔 투입')!.id;
    buried = applyEdit(buried, C.setQuantity(buried.present, { kind: 'action', id, field: 'duration' }, 4, true), '3D 동작 시간', false).history;
    buried = applyEdit(buried, C.renameObject(buried.present, buried.present.units[0].id, '이름 유지'), '이름', false).history;
    const kept = revertDurationEdits(buried, 0, snap2);
    expect(kept.present.actions.find((a) => a.id === id)!.duration.value).toBe(0.8);
    expect(kept.present.units[0].name).toBe('이름 유지');
  });
});
