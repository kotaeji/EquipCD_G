// Equipment motion for the 3D view. Pure: kind + progress → part shift,
// runtime + flow links → material point. No Three.js. The same runtime state
// always draws the same picture — nothing here reads the display frame.

import type { Project, Unit } from '../model/types';
import type { RuntimeState } from '../runtime/engine';
import { describeScene, type PartDelta, type SceneDescription } from './describe';

/** Indicator blink in virtual time. Two beats a second, under the 3 Hz cap. */
export const INDICATOR_BLINK_HZ = 2;

export type MotionFamily = 'stroke' | 'conveyor' | 'indicator';

const STROKE: Record<string, { motion: string; dx: number; dy: number }> = {
  cylinder: { motion: 'rod', dx: 0, dy: 24 },
  pusher: { motion: 'blade', dx: 30, dy: 0 },
  stopper: { motion: 'pin', dx: 0, dy: 18 },
  gantry: { motion: 'head', dx: 36, dy: 0 },
  picker: { motion: 'grip', dx: 0, dy: -14 },
};

const CONVEYOR = new Set(['conveyor', 'unitInput', 'unitTransfer']);

export function motionFamily(kind: string): MotionFamily {
  if (STROKE[kind]) return 'stroke';
  if (CONVEYOR.has(kind)) return 'conveyor';
  return 'indicator';
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** 0 at the ends, 1 halfway. A stroke leaves and comes back inside one step. */
function strokeOf(progress: number): number {
  const t = clamp01(progress);
  if (t === 0 || t === 1) return 0;
  return Math.sin(Math.PI * t);
}

const zero = (motion: string, extra: Partial<PartDelta> = {}): PartDelta => ({
  motion, dx: 0, dy: 0, dz: 0, spin: 0, glow: 0, ...extra,
});

/**
 * Part shifts for one asset kind at `progress` (0..1).
 * Stroke kinds rest at 0 and at 1, and travel farthest at 0.5.
 * Conveyors keep turning: the roller angle grows with progress, so 1 is a full turn.
 * Indicator lamps stay lit at the ends and are brightest at 0.5.
 */
export function partDeltas(kind: string, progress: number): PartDelta[] {
  const family = motionFamily(kind);
  if (family === 'stroke') {
    const spec = STROKE[kind];
    const s = strokeOf(progress);
    return [zero(spec.motion, { dx: spec.dx * s, dy: spec.dy * s })];
  }
  if (family === 'conveyor') {
    const t = clamp01(progress);
    return [
      zero('roller', { spin: t * Math.PI * 2 }),
      zero('belt', { dx: strokeOf(t) * 18 }),
    ];
  }
  return [zero('lamp', { glow: 0.55 + 0.45 * strokeOf(progress) })];
}

/** On for the first half of each beat, dim for the second. Same elapsed time → same value. */
export function indicatorBlink(elapsedMs: number): number {
  const period = 1000 / INDICATOR_BLINK_HZ;
  const phase = ((elapsedMs % period) + period) % period / period;
  return phase < 0.5 ? 1 : 0.2;
}

/** Rising edges of `indicatorBlink` over one second of virtual time. */
export function blinksPerSecond(): number {
  let rises = 0;
  let prev = 0;
  for (let t = 0; t < 1000; t += 1) {
    const v = indicatorBlink(t);
    if (v > 0.5 && prev <= 0.5) rises += 1;
    prev = v;
  }
  return rises;
}

/**
 * Whether the 3D view should paint again.
 * A stopped run with no camera gesture does not.
 */
export function shouldRedraw(input: { running: boolean; interacting: boolean }): boolean {
  return input.running || input.interacting;
}

/** Default for 「설비 동작」. Reduced motion starts off. */
export function equipmentMotionDefault(prefersReducedMotion: boolean): boolean {
  return !prefersReducedMotion;
}

export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export interface DeviceMotion {
  deviceId: string;
  kind: string;
  /** 0..1 while the step is in progress. */
  progress: number;
  elapsedMs: number;
  fault: boolean;
}

interface LiveStep extends DeviceMotion {
  moveTo?: string;
}

function clampProgress(timeMs: number, startMs: number, endMs: number): number {
  const span = endMs - startMs;
  if (span <= 0) return 1;
  return clamp01((timeMs - startMs) / span);
}

function locate(project: Project, stepId: string) {
  const step = project.sequence.steps.find((s) => s.id === stepId)
    ?? (project.substationSequences ?? []).flatMap((q) => q.steps).find((s) => s.id === stepId);
  const action = step ? project.actions.find((a) => a.id === step.actionId) : undefined;
  if (!step || !action) return null;
  const device = project.devices.find((d) => d.id === action.deviceId);
  return { step, action, kind: device?.kind ?? 'box' };
}

function pushLive(out: LiveStep[], project: Project, stepId: string, progress: number, elapsedMs: number, fault: boolean) {
  const found = locate(project, stepId);
  if (!found) return;
  out.push({
    deviceId: found.action.deviceId,
    kind: found.kind,
    progress,
    elapsedMs,
    fault,
    moveTo: found.action.effect.moveTo,
  });
}

function collectLive(project: Project, state: RuntimeState | null): LiveStep[] {
  if (!state || state.status === 'idle' || state.status === 'completed') return [];
  const fault = state.status === 'error';
  const out: LiveStep[] = [];
  if (!state.flowRun && state.active) {
    const step = project.sequence.steps[state.active.stepIndex];
    if (step) {
      const end = state.active.completeAtMs ?? state.active.timeoutAtMs;
      pushLive(out, project, step.id, clampProgress(state.timeMs, state.active.startMs, end), Math.max(0, state.timeMs - state.active.startMs), fault);
    }
  }
  for (const fiber of state.flowRun?.fibers ?? []) {
    if (!fiber.active) continue;
    const end = fiber.active.completeAtMs ?? fiber.active.timeoutAtMs;
    pushLive(
      out, project, fiber.active.stepId,
      clampProgress(state.timeMs, fiber.active.startMs, end),
      Math.max(0, state.timeMs - fiber.active.startMs),
      fault,
    );
  }
  if (fault && out.length === 0) {
    for (const rec of state.steps) {
      if (rec.status !== 'error' && rec.status !== 'stopped') continue;
      if (rec.startMs === undefined) continue;
      const found = locate(project, rec.stepId);
      if (!found) continue;
      const dur = Math.round((found.action.duration.value ?? 0) * 1000);
      const end = rec.startMs + Math.max(dur, 1);
      const at = rec.endMs ?? rec.startMs;
      pushLive(out, project, rec.stepId, clampProgress(at, rec.startMs, end), Math.max(0, at - rec.startMs), true);
    }
  }
  const byId = new Map<string, LiveStep>();
  for (const live of out) {
    const prev = byId.get(live.deviceId);
    if (!prev || live.progress > prev.progress) byId.set(live.deviceId, live);
  }
  return [...byId.values()].sort((a, b) => a.deviceId.localeCompare(b.deviceId));
}

/** Devices that are mid-step. Done, waiting, and skipped steps are absent. A pause keeps the values. */
export function deviceMotions(project: Project, state: RuntimeState | null): DeviceMotion[] {
  return collectLive(project, state).map(({ deviceId, kind, progress, elapsedMs, fault }) => ({ deviceId, kind, progress, elapsedMs, fault }));
}

export interface MaterialSpot {
  visible: boolean;
  x: number;
  z: number;
  unitId: string;
}

export interface PlanPoint { x: number; z: number }

/** Point along a flow polyline, or along the straight segment when `via` is null. */
export function pointOnPath(from: PlanPoint, to: PlanPoint, via: PlanPoint[] | null, t: number): PlanPoint {
  const u = clamp01(t);
  const raw = via && via.length >= 2 ? via : [from, to];
  const d0 = Math.hypot(raw[0].x - from.x, raw[0].z - from.z);
  const d1 = Math.hypot(raw[raw.length - 1].x - from.x, raw[raw.length - 1].z - from.z);
  const line = d0 <= d1 ? raw : [...raw].reverse();
  let total = 0;
  const segs: { a: PlanPoint; b: PlanPoint; len: number }[] = [];
  for (let i = 0; i < line.length - 1; i += 1) {
    const len = Math.hypot(line[i + 1].x - line[i].x, line[i + 1].z - line[i].z);
    segs.push({ a: line[i], b: line[i + 1], len });
    total += len;
  }
  if (total < 1e-6) return { x: from.x, z: from.z };
  let remain = total * u;
  for (let i = 0; i < segs.length; i += 1) {
    const seg = segs[i];
    if (remain <= seg.len || i === segs.length - 1) {
      const f = seg.len < 1e-6 ? 0 : Math.min(1, remain / seg.len);
      return { x: seg.a.x + (seg.b.x - seg.a.x) * f, z: seg.a.z + (seg.b.z - seg.a.z) * f };
    }
    remain -= seg.len;
  }
  return { x: to.x, z: to.z };
}

function centerOf(unit: Unit): PlanPoint {
  return { x: unit.layout.x + unit.layout.w / 2, z: unit.layout.y + unit.layout.h / 2 };
}

function flowPath(project: Project, fromId: string, toId: string): PlanPoint[] | null {
  const link = project.connections.find((c) => c.kind === 'flow' && (
    (c.from.nodeId === fromId && c.to.nodeId === toId) || (c.from.nodeId === toId && c.to.nodeId === fromId)
  ));
  if (!link) return null;
  const from = project.units.find((u) => u.id === fromId);
  const to = project.units.find((u) => u.id === toId);
  if (!from || !to) return null;
  return [centerOf(from), centerOf(to)];
}

function flowDirection(project: Project, unitId: string): PlanPoint {
  const unit = project.units.find((u) => u.id === unitId);
  const outgoing = project.connections.find((c) => c.kind === 'flow' && c.from.nodeId === unitId);
  const incoming = project.connections.find((c) => c.kind === 'flow' && c.to.nodeId === unitId);
  const otherId = outgoing?.to.nodeId ?? incoming?.from.nodeId;
  const other = otherId ? project.units.find((u) => u.id === otherId) : undefined;
  if (unit && other) {
    const a = centerOf(outgoing ? unit : other);
    const b = centerOf(outgoing ? other : unit);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len > 1e-6) return { x: dx / len, z: dz / len };
  }
  return { x: 1, z: 0 };
}

/** From the unit center, out past the edge on the flow side. Progress 1 is outside the rectangle. */
export function exitPoint(unit: Unit, dir: PlanPoint, t: number): PlanPoint {
  const c = centerOf(unit);
  const len = Math.hypot(dir.x, dir.z) || 1;
  const ux = dir.x / len;
  const uz = dir.z / len;
  const hw = unit.layout.w / 2;
  const hd = unit.layout.h / 2;
  const tx = Math.abs(ux) < 1e-6 ? Infinity : hw / Math.abs(ux);
  const tz = Math.abs(uz) < 1e-6 ? Infinity : hd / Math.abs(uz);
  const edge = Math.min(tx, tz);
  const dist = (edge + 56) * clamp01(t);
  return { x: c.x + ux * dist, z: c.z + uz * dist };
}

/** Where the material box sits. With motion off this matches `describeScene`. */
export function materialSpot(project: Project, state: RuntimeState | null, enabled: boolean): MaterialSpot | null {
  const scene = describeScene(project, state);
  const mat = scene.materials[0];
  if (!mat) return null;
  if (!enabled || !state) return { visible: true, x: mat.x, z: mat.z, unitId: mat.unitId };
  const mover = collectLive(project, state).find((live) => live.moveTo && state.material && state.material.location !== 'EXIT' && state.material.location !== live.moveTo);
  if (!mover || !mover.moveTo || !state.material) {
    if (mat.exited) return { visible: false, x: mat.x, z: mat.z, unitId: mat.unitId };
    return { visible: true, x: mat.x, z: mat.z, unitId: mat.unitId };
  }
  const fromUnit = project.units.find((u) => u.id === state.material!.location);
  if (!fromUnit) return { visible: true, x: mat.x, z: mat.z, unitId: mat.unitId };
  if (mover.moveTo === 'EXIT') {
    const at = exitPoint(fromUnit, flowDirection(project, fromUnit.id), mover.progress);
    return { visible: true, x: at.x, z: at.z, unitId: fromUnit.id };
  }
  const toUnit = project.units.find((u) => u.id === mover.moveTo);
  if (!toUnit) return { visible: true, x: mat.x, z: mat.z, unitId: mat.unitId };
  const from = centerOf(fromUnit);
  const to = centerOf(toUnit);
  const at = pointOnPath(from, to, flowPath(project, fromUnit.id, toUnit.id), mover.progress);
  return { visible: true, x: at.x, z: at.z, unitId: fromUnit.id };
}

function moved(delta: PartDelta): boolean {
  return delta.dx !== 0 || delta.dy !== 0 || delta.dz !== 0 || delta.spin !== 0 || delta.glow !== 0;
}

/**
 * Scene to draw. Motion off is the TURN-031 picture.
 * Motion on shifts the running devices and slides a material that is changing unit.
 * A finished exit is left out of the scene.
 */
export function presentScene(project: Project, state: RuntimeState | null, enabled: boolean): SceneDescription {
  const scene = describeScene(project, state);
  if (!enabled || !state) return scene;
  const next = structuredClone(scene);
  for (const live of collectLive(project, state)) {
    const solid = next.solids.find((s) => s.id === live.deviceId);
    if (!solid) continue;
    const blink = motionFamily(live.kind) === 'indicator' ? indicatorBlink(live.elapsedMs) : 1;
    const deltas = partDeltas(live.kind, live.progress)
      .map((delta) => (delta.glow ? { ...delta, glow: delta.glow * blink } : delta))
      .filter(moved);
    if (deltas.length) solid.deltas = deltas;
  }
  const spot = materialSpot(project, state, true);
  if (!spot || !spot.visible) next.materials = [];
  else if (next.materials[0]) {
    next.materials[0] = { ...next.materials[0], x: spot.x, z: spot.z };
  }
  return next;
}
