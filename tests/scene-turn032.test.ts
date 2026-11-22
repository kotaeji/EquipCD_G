import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILTIN_KINDS } from '../src/model/types';
import { buildFlowSampleProject, buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import { advance, createRuntime, pause, resume, runToEnd, start, type Runtime, type RuntimeState } from '../src/runtime/engine';
import { describeScene, type PartDelta } from '../src/scene/describe';
import { formatMs } from '../src/scene/runInfo';
import {
  blinksPerSecond, deviceMotions, equipmentMotionDefault, exitPoint, INDICATOR_BLINK_HZ,
  materialSpot, motionFamily, partDeltas, pointOnPath, presentScene, shouldRedraw,
} from '../src/scene/motion';
import { partsFor, shapeForKind } from '../src/scene/shapes';
import { photoPartsFor } from '../src/scene/style';

function mag(deltas: PartDelta[]): number {
  return deltas.reduce((n, d) => n + Math.hypot(d.dx, d.dy, d.dz) + Math.abs(d.spin) + d.glow, 0);
}

function center(project: ReturnType<typeof buildSampleProject>, id: string) {
  const unit = project.units.find((u) => u.id === id)!;
  return { x: unit.layout.x + unit.layout.w / 2, z: unit.layout.y + unit.layout.h / 2 };
}

function begin(project: ReturnType<typeof buildSampleProject>) {
  return advance(start(createRuntime(project)), 0);
}

/** Step the run until `deviceId` has just started (progress 0). */
function untilDevice(project: ReturnType<typeof buildSampleProject>, deviceId: string): Runtime {
  let rt = begin(project);
  for (let i = 0; i < 40 && rt.state.status === 'running'; i += 1) {
    const live = deviceMotions(project, rt.state);
    if (live.some((m) => m.deviceId === deviceId && m.progress === 0)) return rt;
    const active = rt.state.active ?? rt.state.flowRun?.fibers.find((f) => f.active)?.active ?? null;
    if (!active) break;
    const end = active.completeAtMs ?? active.timeoutAtMs;
    const next = advance(rt, Math.max(0, end - rt.state.timeMs));
    if (next.state.timeMs === rt.state.timeMs && next.state.status === rt.state.status) break;
    rt = next;
  }
  return rt;
}

function atProgress(state: RuntimeState, progress: number): RuntimeState {
  const active = state.active;
  if (!active) return state;
  const end = active.completeAtMs ?? active.timeoutAtMs;
  return { ...state, timeMs: active.startMs + (end - active.startMs) * progress };
}

describe('TURN-032 device pose', () => {
  it('AC1 gives every built-in kind a pose at 0, 0.5, and 1, and repeats the same input', () => {
    expect(BUILTIN_KINDS).toHaveLength(14);
    for (const kind of BUILTIN_KINDS) {
      const startPose = partDeltas(kind, 0);
      const mid = partDeltas(kind, 0.5);
      const end = partDeltas(kind, 1);
      expect(startPose).toEqual(partDeltas(kind, 0));
      expect(mid).toEqual(partDeltas(kind, 0.5));
      expect(end).toEqual(partDeltas(kind, 1));
      expect(mag(mid)).toBeGreaterThan(0);
      expect(mag(mid)).toBeGreaterThanOrEqual(mag(startPose) - 1e-9);
      expect(mag(mid)).toBeGreaterThanOrEqual(mag(end) - 1e-9);
      const family = motionFamily(kind);
      if (family === 'stroke') {
        expect(mag(startPose)).toBe(0);
        expect(mag(end)).toBe(0);
      } else if (family === 'conveyor') {
        expect(mag(end)).toBeGreaterThan(0);
        expect(end.some((d) => d.spin !== 0)).toBe(true);
      } else {
        expect(startPose.some((d) => d.glow > 0)).toBe(true);
        expect(end.some((d) => d.glow > 0)).toBe(true);
      }
    }
    expect(motionFamily('not-a-kind')).toBe('indicator');
    expect(partDeltas('not-a-kind', 0.5)[0].motion).toBe('lamp');
  });

  it('AC7 wires the same moving pieces on the schematic and the photo build', () => {
    for (const kind of BUILTIN_KINDS) {
      const shape = shapeForKind(kind);
      const keys = new Set(partDeltas(kind, 0.5).map((d) => d.motion));
      expect(keys.size).toBeGreaterThan(0);
      for (const parts of [partsFor(shape, 120, 80), photoPartsFor(shape, 120, 80)]) {
        const have = new Set(parts.map((part) => part.motion).filter((motion): motion is string => !!motion));
        for (const key of keys) expect(have.has(key)).toBe(true);
      }
    }
  });
});

describe('TURN-032 runtime progress', () => {
  it('AC2 reads progress only for the running step, keeps it while paused, and stays quiet for done, waiting, and skipped', () => {
    const flow = buildFlowSampleProject();
    const started = begin(flow);
    const running = deviceMotions(flow, started.state);
    expect(running.map((m) => m.deviceId)).toEqual(['PSH-01']);
    expect(running[0].progress).toBe(0);
    expect(running[0].fault).toBe(false);
    const pending = started.state.steps.find((s) => s.status === 'pending')!;
    const skipped = structuredClone(started.state);
    const rec = skipped.steps.find((s) => s.stepId === pending.stepId)!;
    rec.status = 'skipped';
    expect(deviceMotions(flow, skipped).map((m) => m.deviceId)).toEqual(['PSH-01']);

    const half = advance(started, 400);
    expect(deviceMotions(flow, half.state)[0].progress).toBeCloseTo(0.5, 5);
    const paused = pause(half);
    expect(deviceMotions(flow, paused.state)).toEqual(deviceMotions(flow, half.state));

    const next = advance(started, 800);
    expect(deviceMotions(flow, next.state).some((m) => m.deviceId === 'PSH-01')).toBe(false);
    expect(next.state.steps.find((s) => s.status === 'done')).toBeTruthy();

    const parallel = advance(start(createRuntime(buildParallelSampleProject())), 100);
    const both = deviceMotions(buildParallelSampleProject(), parallel.state);
    expect(both.map((m) => m.deviceId)).toEqual(expect.arrayContaining(['STP-A1', 'STP-B1']));
    expect(both.length).toBeGreaterThanOrEqual(2);
    for (const motion of both) {
      expect(motion.progress).toBeGreaterThan(0);
      expect(motion.progress).toBeLessThan(1);
    }
    expect(deviceMotions(buildParallelSampleProject(), pause(parallel).state)).toEqual(both);
  });

  it('keeps a faulted device at the pose where it stopped', () => {
    const project = buildSampleProject();
    const read = project.actions.find((a) => a.deviceId === 'BCR-02')!;
    project.simSettings.faults.neverTrueSignalIds = [read.completeSignalId!];
    const failed = runToEnd(createRuntime(project));
    expect(failed.state.status).toBe('error');
    const frozen = deviceMotions(project, failed.state).find((m) => m.deviceId === 'BCR-02');
    expect(frozen?.fault).toBe(true);
    expect(frozen?.progress).toBe(1);
    const again = advance(failed, 500);
    expect(again.state.timeMs).toBe(failed.state.timeMs);
    expect(deviceMotions(project, again.state)).toEqual(deviceMotions(project, failed.state));

    const mid = advance(begin(buildSampleProject()), 200);
    const stopped = structuredClone(mid.state);
    stopped.status = 'error';
    stopped.error = { code: 'TIMEOUT', stepId: mid.state.active?.stepId ?? null, message: '멈춤' };
    expect(deviceMotions(buildSampleProject(), stopped)[0]).toMatchObject({
      deviceId: 'PSH-01', fault: true, progress: deviceMotions(buildSampleProject(), mid.state)[0].progress,
    });
  });
});

describe('TURN-032 material travel', () => {
  it('AC3 puts the box on the flow line at 0, 0.5, and 1, and back on the unit once the step ends', () => {
    const project = buildSampleProject();
    const from = center(project, 'U-S1');
    const to = center(project, 'U-S2');
    const started = begin(project);
    const at = (progress: number) => materialSpot(project, atProgress(started.state, progress), true)!;
    expect(at(0)).toMatchObject({ x: from.x, z: from.z, visible: true });
    const mid = at(0.5);
    expect(mid.x).toBeCloseTo((from.x + to.x) / 2, 5);
    expect(mid.z).toBeCloseTo((from.z + to.z) / 2, 5);
    expect(mid).toEqual({ ...pointOnPath(from, to, [from, to], 0.5), visible: true, unitId: 'U-S1' });
    expect(at(1)).toMatchObject({ x: to.x, z: to.z });

    const straightProject = buildSampleProject();
    straightProject.connections = straightProject.connections.filter((c) => c.kind !== 'flow');
    const straight = materialSpot(straightProject, atProgress(begin(straightProject).state, 0.5), true)!;
    expect(straight.x).toBeCloseTo((from.x + to.x) / 2, 5);
    expect(straight).toMatchObject(pointOnPath(from, to, null, 0.5));
    const corner = { x: from.x, z: from.z + 90 };
    const via = [from, corner, to];
    const leg = 90 + Math.hypot(to.x - corner.x, to.z - corner.z);
    const atCorner = pointOnPath(from, to, via, 90 / leg);
    expect(atCorner.x).toBeCloseTo(corner.x, 5);
    expect(atCorner.z).toBeCloseTo(corner.z, 5);
    expect(pointOnPath(from, to, via, 0.5)).not.toEqual(pointOnPath(from, to, null, 0.5));

    const done = advance(started, 800);
    expect(done.state.material?.location).toBe('U-S2');
    const after = materialSpot(project, done.state, true)!;
    const snapped = describeScene(project, done.state).materials[0];
    expect(after).toMatchObject({ x: snapped.x, z: snapped.z, visible: true, unitId: 'U-S2' });
    expect(presentScene(project, started.state, true)).toEqual(presentScene(project, started.state, true));
  });

  it('AC4 carries an exit past the last unit edge and then drops it from the scene', () => {
    const project = buildSampleProject();
    const riding = untilDevice(project, 'CNV-05');
    expect(riding.state.material?.location).toBe('U-S5');
    const unit = project.units.find((u) => u.id === 'U-S5')!;
    const leaving = materialSpot(project, atProgress(riding.state, 1), true)!;
    expect(leaving.visible).toBe(true);
    expect(leaving.x).toBeGreaterThan(unit.layout.x + unit.layout.w);
    expect(exitPoint(unit, { x: 1, z: 0 }, 1).x).toBeGreaterThan(unit.layout.x + unit.layout.w);
    const end = riding.state.active!.completeAtMs! - riding.state.timeMs;
    const finished = advance(riding, end);
    expect(finished.state.status).toBe('completed');
    expect(finished.state.material?.location).toBe('EXIT');
    expect(materialSpot(project, finished.state, true)!.visible).toBe(false);
    expect(presentScene(project, finished.state, true).materials).toEqual([]);
    expect(describeScene(project, finished.state).materials[0].exited).toBe(true);
    expect(presentScene(project, finished.state, false).materials[0].exited).toBe(true);
  });
});

describe('TURN-032 switch, step, and redraw', () => {
  it('AC5 turns the motion off back to the TURN-031 picture, and reduced motion defaults off', () => {
    const project = buildFlowSampleProject();
    const rt = advance(begin(project), 400);
    expect(presentScene(project, rt.state, false)).toEqual(describeScene(project, rt.state));
    const on = presentScene(project, rt.state, true);
    expect(on.solids.find((s) => s.id === 'PSH-01')!.deltas?.some((d) => d.motion === 'blade' && d.dx > 0)).toBe(true);
    expect(on.materials[0].x).not.toBe(describeScene(project, rt.state).materials[0].x);
    expect(equipmentMotionDefault(true)).toBe(false);
    expect(equipmentMotionDefault(false)).toBe(true);
  });

  it('AC6 steps 0.1s of pose and travel, and run-to-end keeps the sample times with every device at rest', () => {
    const project = buildFlowSampleProject();
    let rt = pause(begin(project));
    const before = deviceMotions(project, rt.state);
    const beforeSpot = materialSpot(project, rt.state, true)!;
    rt = pause(advance(resume(rt), 100));
    const after = deviceMotions(project, rt.state);
    const afterSpot = materialSpot(project, rt.state, true)!;
    expect(after[0].progress).toBeGreaterThan(before[0].progress);
    expect(afterSpot.x).not.toBe(beforeSpot.x);
    expect(mag(partDeltas('pusher', after[0].progress))).toBeGreaterThan(mag(partDeltas('pusher', before[0].progress)));

    const samples: [ReturnType<typeof buildSampleProject>, string][] = [
      [buildSampleProject(), '00:11.100'],
      [buildFlowSampleProject(), '00:13.100'],
      [buildParallelSampleProject(), '00:02.500'],
    ];
    for (const [sample, time] of samples) {
      const done = runToEnd(createRuntime(sample));
      expect(formatMs(done.state.timeMs)).toBe(time);
      expect(deviceMotions(sample, done.state)).toEqual([]);
      expect(presentScene(sample, done.state, true).solids.every((s) => !s.deltas)).toBe(true);
    }
  });

  it('AC8 blinks at most three times a second and does not ask for a frame when the run is still', () => {
    expect(INDICATOR_BLINK_HZ).toBeLessThanOrEqual(3);
    expect(blinksPerSecond()).toBeLessThanOrEqual(3);
    expect(blinksPerSecond()).toBe(INDICATOR_BLINK_HZ);
    expect(shouldRedraw({ running: false, interacting: false })).toBe(false);
    expect(shouldRedraw({ running: true, interacting: false })).toBe(true);
    expect(shouldRedraw({ running: false, interacting: true })).toBe(true);
    const view = readFileSync('src/ui/Scene3D.tsx', 'utf8');
    expect(view).not.toContain('requestAnimationFrame');
    expect(view).toContain('shouldRedraw');
  });
});
