// What the stage-6 diagram draws on top of a run. Pure: project + runtime + the
// motion switch → marks and material points. The engine, the log, and the clock
// stay where they are. The same virtual time always returns the same picture.

import type { Project, Unit } from '../model/types';
import type { FlowFiber, PieceRun, RuntimeState } from '../runtime/engine';
import { deviceOfStep } from '../scene/describe';
import { deviceMotions } from '../scene/motion';
import { materialKindLook, type MaterialPattern } from '../model/materialKind';
import { waitingLead } from './status';

/** Wall-clock lengths of the three motion steps. Virtual progress does not use these. */
export const DUR_1_MS = 120;
export const DUR_2_MS = 200;
export const DUR_3_MS = 320;

export interface MotionSwitches {
  /** `prefers-reduced-motion: reduce`. Same read as `scene/motion.ts`. */
  reduced: boolean;
  /** 「동작 강조」. */
  emphasize: boolean;
  /** 「설비 동작」. */
  equipment: boolean;
}

/** Transitions and diagram travel run only when every switch allows motion. */
export function diagramMotionOn(input: MotionSwitches): boolean {
  return !input.reduced && input.emphasize && input.equipment;
}

export interface DeviceRunMark {
  deviceId: string;
  /** 0..1 while that device's action is in progress. Null otherwise. A pause keeps the number. */
  progress: number | null;
  /** The latest completion is still inside the one-shot window (`--dur-3` of virtual time). */
  justDone: boolean;
  /** Completed, and the one-shot window has passed. */
  done: boolean;
}

export interface WaitSpot {
  id: string;
  kind: 'unit' | 'device';
}

export interface Pt { x: number; y: number }

export interface MaterialPose {
  id: string;
  x: number;
  y: number;
  label: string;
  waiting: boolean;
  pieceId?: string;
  /** Kind letter when several definitions are in the feed. */
  mark?: string;
  /** CSS token. Set with the letter, and only when several kinds are defined. */
  kindToken?: string;
  kindPattern?: MaterialPattern;
  kindSlot?: number;
  /** Fraction along the flow line. Null when the marker is sitting on a unit. */
  travel: number | null;
}

type OffFn = (id: string, unitId?: string) => { dx: number; dy: number };

const noOff: OffFn = () => ({ dx: 0, dy: 0 });

function kindPose(project: Project, materialId: string): Pick<MaterialPose, 'mark' | 'kindToken' | 'kindPattern' | 'kindSlot'> {
  const look = materialKindLook(project, materialId);
  if (!look) return {};
  return { mark: look.mark, kindToken: look.token, kindPattern: look.pattern, kindSlot: look.slot };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function fraction(timeMs: number, startMs: number, endMs: number | null): number | null {
  if (endMs === null) return null;
  const span = endMs - startMs;
  if (span <= 0) return 1;
  return clamp01((timeMs - startMs) / span);
}

function findStep(project: Project, stepId: string) {
  return project.sequence.steps.find((s) => s.id === stepId)
    ?? (project.substationSequences ?? []).flatMap((q) => q.steps).find((s) => s.id === stepId);
}

/** Devices the diagram should badge from the run. Idle (and a missing run) badge nothing. */
export function deviceRunMarks(project: Project, state: RuntimeState | null, justWindowMs = DUR_3_MS): DeviceRunMark[] {
  if (!state || state.status === 'idle') return [];
  const live = new Map(deviceMotions(project, state).map((row) => [row.deviceId, row.progress]));
  const doneAt = new Map<string, number>();
  for (const rec of state.steps) {
    if (rec.status !== 'done' || rec.endMs === undefined) continue;
    const id = deviceOfStep(project, rec.stepId);
    if (!id) continue;
    const prev = doneAt.get(id);
    if (prev === undefined || rec.endMs >= prev) doneAt.set(id, rec.endMs);
  }
  const ids = new Set<string>([...live.keys(), ...doneAt.keys()]);
  const out: DeviceRunMark[] = [];
  for (const deviceId of [...ids].sort((a, b) => a.localeCompare(b))) {
    const progress = live.has(deviceId) ? live.get(deviceId)! : null;
    const end = doneAt.get(deviceId);
    const fresh = progress === null && end !== undefined && state.timeMs >= end && state.timeMs - end <= justWindowMs;
    out.push({
      deviceId,
      progress,
      justDone: fresh,
      done: progress === null && end !== undefined && !fresh,
    });
  }
  return out;
}

function pushSpot(spots: WaitSpot[], spot: WaitSpot) {
  if (!spot.id) return;
  if (spots.some((row) => row.kind === spot.kind && row.id === spot.id)) return;
  spots.push(spot);
}

function fiberNode(fiber: FlowFiber) {
  const frame = fiber.stack[fiber.stack.length - 1];
  if (!frame || frame.index >= frame.nodes.length) return null;
  return frame.nodes[frame.index];
}

/** Units and devices that are standing still for a reason other than pause. */
export function waitSpots(project: Project, state: RuntimeState | null): WaitSpot[] {
  if (!state || state.status === 'idle' || state.status === 'completed') return [];
  const spots: WaitSpot[] = [];
  for (const pc of state.pieces ?? []) {
    if (pc.phase !== 'waiting' || !pc.wait) continue;
    pushSpot(spots, { id: pc.wait.unitId, kind: 'unit' });
  }
  for (const fiber of state.flowRun?.fibers ?? []) {
    if (fiber.frozen) continue;
    if (fiber.wait) {
      const node = fiberNode(fiber);
      if (node && node.kind === 'step') {
        const id = deviceOfStep(project, node.stepId);
        if (id) pushSpot(spots, { id, kind: 'device' });
      }
    }
    if (fiber.holding) {
      if (fiber.owner) pushSpot(spots, { id: fiber.owner.unitId, kind: 'unit' });
      else if (state.material && state.material.location && state.material.location !== 'EXIT') {
        pushSpot(spots, { id: state.material.location, kind: 'unit' });
      }
    }
  }
  return spots.sort((a, b) => (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind === 'device' ? -1 : 1));
}

/** Right-center (out) or left-center (in) of a unit. That is where the flow handle sits. */
export function unitFlowHandle(unit: Unit, side: 'out' | 'in', off: { dx: number; dy: number } = { dx: 0, dy: 0 }): Pt {
  const x = unit.layout.x + off.dx;
  const y = unit.layout.y + off.dy;
  return {
    x: side === 'out' ? x + unit.layout.w : x,
    y: y + unit.layout.h / 2,
  };
}

/**
 * Centerline of a smooth-step flow edge. Corners are cut by `radius`, matching the
 * drawn edge's 8px corner. A straight pair (no vertical gap) stays a segment.
 */
export function smoothStepPoints(from: Pt, to: Pt, radius = 8): Pt[] {
  const midX = (from.x + to.x) / 2;
  const rise = Math.abs(to.y - from.y);
  const r = Math.min(radius, Math.abs(midX - from.x), Math.abs(to.x - midX), rise / 2);
  if (r < 0.5 || rise < 0.5) return [from, to];
  const dirY = to.y > from.y ? 1 : -1;
  const dirIn = midX >= from.x ? 1 : -1;
  const dirOut = to.x >= midX ? 1 : -1;
  return [
    from,
    { x: midX - dirIn * r, y: from.y },
    { x: midX, y: from.y + dirY * r },
    { x: midX, y: to.y - dirY * r },
    { x: midX + dirOut * r, y: to.y },
    to,
  ];
}

/** Point at fraction `t` along a polyline. `t` 0 is the first point, `t` 1 the last. */
export function pointAlong(points: Pt[], t: number): Pt {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return { ...points[0] };
  const u = clamp01(t);
  const segs: { a: Pt; b: Pt; len: number }[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const len = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    segs.push({ a: points[i], b: points[i + 1], len });
    total += len;
  }
  if (total < 1e-6) return { ...points[0] };
  let remain = total * u;
  for (let i = 0; i < segs.length; i += 1) {
    const seg = segs[i];
    if (remain <= seg.len || i === segs.length - 1) {
      const f = seg.len < 1e-6 ? 0 : Math.min(1, remain / seg.len);
      return { x: seg.a.x + (seg.b.x - seg.a.x) * f, y: seg.a.y + (seg.b.y - seg.a.y) * f };
    }
    remain -= seg.len;
  }
  return { ...points[points.length - 1] };
}

/** Polyline the material follows from one unit to the next. A missing link is the straight segment. */
export function flowPoints(project: Project, fromId: string, toId: string, off: OffFn = noOff): Pt[] | null {
  const from = project.units.find((u) => u.id === fromId);
  const to = project.units.find((u) => u.id === toId);
  if (!from || !to) return null;
  const start = unitFlowHandle(from, 'out', off(from.id));
  const end = unitFlowHandle(to, 'in', off(to.id));
  const forward = project.connections.some((c) => c.kind === 'flow' && c.from.nodeId === fromId && c.to.nodeId === toId);
  if (forward) return smoothStepPoints(start, end);
  const back = project.connections.some((c) => c.kind === 'flow' && c.from.nodeId === toId && c.to.nodeId === fromId);
  if (back) return [...smoothStepPoints(unitFlowHandle(to, 'out', off(to.id)), unitFlowHandle(from, 'in', off(from.id)))].reverse();
  return [start, end];
}

function unitAnchor(project: Project, off: OffFn, uid: string | 'EXIT'): Pt | null {
  if (uid === 'EXIT') {
    const last = project.units[project.units.length - 1];
    if (!last) return { x: 20, y: 20 };
    const o = off(last.id);
    return { x: last.layout.x + o.dx + last.layout.w + 40, y: last.layout.y + o.dy + last.layout.h - 34 };
  }
  const unit = project.units.find((u) => u.id === uid);
  if (!unit) return null;
  const o = off(unit.id);
  return { x: unit.layout.x + o.dx + unit.layout.w / 2, y: unit.layout.y + o.dy + unit.layout.h - 34 };
}

function holderPoint(project: Project, off: OffFn, holder: string | null): Pt | null {
  if (!holder) return null;
  const device = project.devices.find((d) => d.id === holder);
  if (!device) return null;
  const o = off(device.id, device.unitId);
  return { x: device.layout.x + o.dx + device.layout.w / 2, y: device.layout.y + o.dy + device.layout.h + 10 };
}

interface Move { fromId: string; toId: string; t: number }

function moveOf(fromId: string, toId: string | undefined, t: number | null): Move | null {
  if (!toId || t === null || !fromId || fromId === 'EXIT' || fromId === toId) return null;
  return { fromId, toId, t };
}

function pieceMove(project: Project, state: RuntimeState, pc: PieceRun): Move | null {
  if (!pc.active || pc.active.hold || pc.active.completeAtMs === null) return null;
  const step = project.sequence.steps[pc.active.stepIndex];
  const action = step ? project.actions.find((a) => a.id === step.actionId) : undefined;
  return moveOf(pc.material.location, action?.effect.moveTo, fraction(state.timeMs, pc.active.startMs, pc.active.completeAtMs));
}

function activeMove(project: Project, state: RuntimeState): Move | null {
  const active = state.active;
  const material = state.material;
  if (!active || !material) return null;
  const step = active.stepId ? findStep(project, active.stepId) : project.sequence.steps[active.stepIndex];
  const action = step ? project.actions.find((a) => a.id === step.actionId) : undefined;
  return moveOf(material.location, action?.effect.moveTo, fraction(state.timeMs, active.startMs, active.completeAtMs));
}

function placeMove(project: Project, off: OffFn, move: Move, rest: Pt, motion: boolean): { at: Pt; travel: number | null } {
  if (!motion) return { at: rest, travel: null };
  if (move.toId === 'EXIT') {
    const from = project.units.find((u) => u.id === move.fromId);
    const exit = unitAnchor(project, off, 'EXIT');
    if (!from || !exit) return { at: rest, travel: null };
    const start = unitFlowHandle(from, 'out', off(from.id));
    return { at: pointAlong([start, exit], move.t), travel: move.t };
  }
  const line = flowPoints(project, move.fromId, move.toId, off);
  if (!line) return { at: rest, travel: null };
  return { at: pointAlong(line, move.t), travel: move.t };
}

/** Material markers. With motion on, a move rides the flow line. With motion off, the marker stays on the unit it is in. */
export function materialPoses(project: Project, state: RuntimeState | null, motion: boolean, off: OffFn = noOff): MaterialPose[] {
  if (state?.pieces && state.pieces.length > 1) {
    const live = state.pieces.filter((pc) => pc.phase !== 'queued' && pc.material.location !== 'EXIT' && pc.material.location !== '');
    const byUnit = new Map<string, PieceRun[]>();
    for (const pc of live) {
      const list = byUnit.get(pc.material.location) ?? [];
      list.push(pc);
      byUnit.set(pc.material.location, list);
    }
    const out: MaterialPose[] = [];
    for (const pc of live) {
      const mates = byUnit.get(pc.material.location) ?? [pc];
      const index = mates.indexOf(pc);
      const span = Math.max(1, mates.length - 1);
      const shift = mates.length > 1 ? (index - span / 2) * 26 : 0;
      let rest = unitAnchor(project, off, pc.material.location);
      const held = holderPoint(project, off, pc.material.holder);
      if (held) rest = held;
      if (!rest) continue;
      const move = pieceMove(project, state, pc);
      const placed = move ? placeMove(project, off, move, rest, motion) : { at: rest, travel: null };
      const at = placed.travel === null ? { x: placed.at.x + shift, y: placed.at.y } : placed.at;
      const kind = kindPose(project, pc.material.materialId);
      out.push({
        id: pc.index === 1 ? 'runtime-material' : `runtime-material-${pc.instanceId}`,
        x: at.x,
        y: at.y,
        label: `${pc.phase === 'waiting' ? `${waitingLead()} · ` : ''}개체 ${pc.index}${kind.mark ? ` ${kind.mark}` : ''} · ${pc.material.state}`,
        waiting: pc.phase === 'waiting',
        pieceId: pc.instanceId,
        travel: placed.travel,
        ...kind,
      });
    }
    return out;
  }
  const defined = project.materials[0];
  const material = state?.material ?? (defined && defined.initialLocation
    ? { location: defined.initialLocation, state: defined.initialState ?? '', holder: null as string | null, instanceId: `${defined.id}#1` }
    : null);
  if (!material) return [];
  let rest = unitAnchor(project, off, material.location as string | 'EXIT');
  const held = holderPoint(project, off, material.holder);
  if (held) rest = held;
  if (!rest) return [];
  const move = state ? activeMove(project, state) : null;
  const placed = move ? placeMove(project, off, move, rest, motion) : { at: rest, travel: null };
  const piece = state?.pieces?.length === 1 ? state.pieces[0] : null;
  const materialId = piece?.material.materialId ?? defined?.id ?? '';
  const kind = materialId ? kindPose(project, materialId) : {};
  return [{
    id: 'runtime-material',
    x: placed.at.x,
    y: placed.at.y,
    label: kind.mark ? `${kind.mark} · ${material.state}` : `${defined?.name.split(' ')[0] ?? 'M'} · ${material.state}`,
    waiting: false,
    travel: placed.travel,
    ...kind,
  }];
}
