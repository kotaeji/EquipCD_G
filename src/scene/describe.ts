// What the 3D view draws. Pure: Project + RuntimeState → scene. No Three.js.
// Diagram x stays 3D x. Diagram y becomes 3D z. A device footprint is its layout box,
// so a device that sits inside its unit on the diagram sits inside that zone here.

import type { Project, Unit } from '../model/types';
import type { RuntimeState } from '../runtime/engine';
import { floorNameForZone, type FloorName } from './floorLabel';
import { partsFor, shapeForKind, type LocalPart, type ShapeId } from './shapes';

export type HighlightReason = 'active' | 'fault' | 'paused';

export interface SceneZone {
  id: string;
  name: string;
  x: number;
  z: number;
  w: number;
  d: number;
  /** The Substation on this floor is held still. */
  paused?: boolean;
}

export interface SceneDraw {
  /** Visual box. The center matches the diagram footprint unless the unit edge forces a nudge. */
  x: number;
  z: number;
  w: number;
  d: number;
}

/** One moving piece. Zero channels are the rest pose. */
export interface PartDelta {
  /** Matches `LocalPart.motion` on the schematic part and the photo part. */
  motion: string;
  dx: number;
  dy: number;
  dz: number;
  /** Radians added around the part axis. Rollers use this. */
  spin: number;
  /** 0..1 emissive added on a lamp. */
  glow: number;
}

export interface SceneSolid {
  id: string;
  name: string;
  kind: string;
  shape: ShapeId;
  unitId: string;
  /** Diagram footprint. x = layout.x, z = layout.y. */
  x: number;
  z: number;
  w: number;
  d: number;
  /** Larger body used for the mesh, still inside the unit and clear of its siblings. */
  draw: SceneDraw;
  parts: LocalPart[];
  highlight: HighlightReason | 'none';
  /** Diagram and 3D say Interlock as well as 오류. */
  interlock?: boolean;
  /** Set only while equipment motion is on and this device is away from its rest pose. */
  deltas?: PartDelta[];
}

export interface SceneFlow {
  id: string;
  fromId: string;
  toId: string;
  points: { x: number; z: number }[];
}

export interface SceneMaterial {
  id: string;
  name: string;
  unitId: string;
  state: string;
  x: number;
  z: number;
  /** True when the material has left the line (`EXIT`). */
  exited: boolean;
  /** Standing still for a device or a full unit. */
  waiting?: boolean;
}

export interface SceneHighlight {
  deviceId: string;
  reason: HighlightReason;
  /** Fault came from a confirmed Interlock, not a timeout or injected fault. */
  interlock?: boolean;
}

export interface SceneBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/** Center of every unit zone. Y is the middle of the framed scene, so a front view is not stuck on the floor. */
export function zoneLookAt(scene: SceneDescription): { x: number; y: number; z: number } {
  const points = framePoints(scene);
  const ys = points.length ? points : [{ x: 0, y: 0, z: 0 }];
  const minY = ys.reduce((m, p) => Math.min(m, p.y), 0);
  const maxY = ys.reduce((m, p) => Math.max(m, p.y), 0);
  if (!scene.zones.length) {
    const b = scene.bounds;
    return { x: (b.minX + b.maxX) / 2, y: (minY + maxY) / 2, z: (b.minZ + b.maxZ) / 2 };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const zone of scene.zones) {
    minX = Math.min(minX, zone.x);
    maxX = Math.max(maxX, zone.x + zone.w);
    minZ = Math.min(minZ, zone.z);
    maxZ = Math.max(maxZ, zone.z + zone.d);
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 };
}

/** Unit corners on the floor and the top face of every device. These are what 「전체 보기」 must keep on screen. */
export function framePoints(scene: SceneDescription): { x: number; y: number; z: number }[] {
  const pts: { x: number; y: number; z: number }[] = [];
  for (const zone of scene.zones) {
    for (const x of [zone.x, zone.x + zone.w]) for (const z of [zone.z, zone.z + zone.d]) pts.push({ x, y: 0, z });
  }
  for (const name of scene.floorNames) {
    const hx = name.length / 2;
    const hz = name.depth / 2;
    for (const x of [name.x - hx, name.x + hx]) for (const z of [name.z - hz, name.z + hz]) pts.push({ x, y: 0, z });
  }
  for (const solid of scene.solids) {
    const top = solid.parts.reduce((h, part) => Math.max(h, part.y + part.h / 2), 0);
    for (const x of [solid.draw.x, solid.draw.x + solid.draw.w]) {
      for (const z of [solid.draw.z, solid.draw.z + solid.draw.d]) pts.push({ x, y: top, z });
    }
  }
  return pts;
}

export interface SceneDescription {
  zones: SceneZone[];
  solids: SceneSolid[];
  flows: SceneFlow[];
  materials: SceneMaterial[];
  highlights: SceneHighlight[];
  /** Unit names lying on the floor, outside the back edge. Direction is the rest yaw; the camera may flip it. */
  floorNames: FloorName[];
  bounds: SceneBounds;
}

function findStep(p: Project, stepId: string) {
  return p.sequence.steps.find((s) => s.id === stepId)
    ?? (p.substationSequences ?? []).flatMap((q) => q.steps).find((s) => s.id === stepId);
}

export function deviceOfStep(p: Project, stepId: string): string | null {
  const step = findStep(p, stepId);
  if (!step) return null;
  return p.actions.find((a) => a.id === step.actionId)?.deviceId ?? null;
}

/** Devices whose step is running now. Linear runs use `active`. Flow runs use fibers. */
export function activeDeviceIds(p: Project, rt: RuntimeState | null): string[] {
  if (!rt) return [];
  const ids: string[] = [];
  const fibers = rt.flowRun?.fibers ?? [];
  if (rt.pieces && rt.pieces.length > 1) {
    for (const pc of rt.pieces) {
      if (pc.flow) {
        for (const fiber of pc.flow.fibers) {
          if (!fiber.active || fiber.frozen) continue;
          const id = deviceOfStep(p, fiber.active.stepId);
          if (id) ids.push(id);
        }
        continue;
      }
      if (!pc.active) continue;
      const step = p.sequence.steps[pc.active.stepIndex];
      const action = step ? p.actions.find((a) => a.id === step.actionId) : undefined;
      if (action) ids.push(action.deviceId);
    }
  } else if (rt.flowRun) {
    for (const fiber of fibers) {
      if (!fiber.active || fiber.frozen) continue;
      const id = deviceOfStep(p, fiber.active.stepId);
      if (id) ids.push(id);
    }
  } else if (rt.active) {
    const step = rt.active.stepId ? findStep(p, rt.active.stepId) : p.sequence.steps[rt.active.stepIndex];
    const action = step ? p.actions.find((a) => a.id === step.actionId) : undefined;
    if (action) ids.push(action.deviceId);
  }
  return [...new Set(ids)];
}

/** Devices whose Action is held because their Substation step is paused. */
export function pausedDeviceIds(p: Project, rt: RuntimeState | null): string[] {
  const fibers = rt?.pieces?.some((pc) => pc.flow)
    ? rt.pieces.flatMap((pc) => pc.flow?.fibers ?? [])
    : (rt?.flowRun?.fibers ?? []);
  if (!fibers.length) return [];
  const ids: string[] = [];
  for (const fiber of fibers) {
    if (!fiber.frozen || !fiber.active) continue;
    const id = deviceOfStep(p, fiber.active.stepId);
    if (id) ids.push(id);
  }
  return [...new Set(ids)];
}

/** Units whose Substation step is paused. */
export function pausedUnitIds(rt: RuntimeState | null): string[] {
  return [...new Set((rt?.pausedSubstations ?? []).map((row) => row.unitId))];
}

/** Devices whose step stopped on an error. */
export function faultDeviceIds(p: Project, rt: RuntimeState | null): string[] {
  if (!rt) return [];
  const ids: string[] = [];
  for (const rec of rt.steps) {
    if (rec.status !== 'error') continue;
    const id = deviceOfStep(p, rec.stepId);
    if (id) ids.push(id);
  }
  if (rt.error?.stepId) {
    const id = deviceOfStep(p, rt.error.stepId);
    if (id) ids.push(id);
  }
  return [...new Set(ids)];
}

/** Device of the step a confirmed Interlock stopped. Empty for every other error. */
export function interlockFaultDeviceIds(p: Project, rt: RuntimeState | null): string[] {
  if (!rt || rt.error?.code !== 'INTERLOCK_BLOCK') return [];
  const ids: string[] = [];
  for (const row of rt.interlockBlocks ?? []) {
    const id = deviceOfStep(p, row.stepId);
    if (id) ids.push(id);
  }
  if (rt.error.stepId) {
    const id = deviceOfStep(p, rt.error.stepId);
    if (id) ids.push(id);
  }
  return [...new Set(ids)];
}

const DRAW_PAD = 8;
const DRAW_MIN_W = 72;
const DRAW_MIN_D = 52;

function rectsHit(a: SceneDraw, b: SceneDraw, gap = 4): boolean {
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.z < b.z + b.d + gap && a.z + a.d + gap > b.z;
}

/** Grow a diagram footprint around its center, staying inside the unit and clear of boxes already placed. */
export function drawFootprint(layout: { x: number; y: number; w: number; h: number }, unit: { x: number; y: number; w: number; h: number }, taken: SceneDraw[]): SceneDraw {
  const cx = layout.x + layout.w / 2;
  const cz = layout.y + layout.h / 2;
  const roomW = Math.max(layout.w, unit.w - DRAW_PAD * 2);
  const roomD = Math.max(layout.h, unit.h - DRAW_PAD * 2);
  const wantW = Math.min(roomW, Math.max(layout.w, DRAW_MIN_W));
  const wantD = Math.min(roomD, Math.max(layout.h, DRAW_MIN_D));
  const place = (w: number, d: number): SceneDraw | null => {
    if (w > unit.w || d > unit.h) return null;
    let x = cx - w / 2;
    let z = cz - d / 2;
    const minX = unit.x;
    const maxX = unit.x + unit.w - w;
    const minZ = unit.y;
    const maxZ = unit.y + unit.h - d;
    if (maxX < minX || maxZ < minZ) return null;
    x = Math.min(Math.max(x, minX), maxX);
    z = Math.min(Math.max(z, minZ), maxZ);
    const box = { x, z, w, d };
    if (taken.some((t) => rectsHit(t, box))) return null;
    return box;
  };
  for (let step = 10; step >= 0; step -= 1) {
    const t = step / 10;
    const box = place(layout.w + (wantW - layout.w) * t, layout.h + (wantD - layout.h) * t);
    if (box) return box;
  }
  return { x: layout.x, z: layout.y, w: layout.w, d: layout.h };
}

function unitCenter(u: Unit): { x: number; z: number } {
  return { x: u.layout.x + u.layout.w / 2, z: u.layout.y + u.layout.h / 2 };
}

function emptyBounds(): SceneBounds {
  return { minX: 0, maxX: 200, minY: 0, maxY: 40, minZ: 0, maxZ: 200 };
}

function grow(b: SceneBounds, x: number, y: number, z: number) {
  b.minX = Math.min(b.minX, x);
  b.maxX = Math.max(b.maxX, x);
  b.minY = Math.min(b.minY, y);
  b.maxY = Math.max(b.maxY, y);
  b.minZ = Math.min(b.minZ, z);
  b.maxZ = Math.max(b.maxZ, z);
}

export function describeScene(p: Project, rt: RuntimeState | null): SceneDescription {
  const faults = new Set(faultDeviceIds(p, rt));
  const interlocks = new Set(interlockFaultDeviceIds(p, rt));
  const active = new Set(activeDeviceIds(p, rt));
  const paused = new Set(pausedDeviceIds(p, rt));
  const pausedUnits = new Set(pausedUnitIds(rt));
  const highlights: SceneHighlight[] = [
    ...[...faults].map((deviceId) => ({ deviceId, reason: 'fault' as const, ...(interlocks.has(deviceId) ? { interlock: true } : {}) })),
    ...[...paused].filter((id) => !faults.has(id)).map((deviceId) => ({ deviceId, reason: 'paused' as const })),
    ...[...active].filter((id) => !faults.has(id) && !paused.has(id)).map((deviceId) => ({ deviceId, reason: 'active' as const })),
  ];
  const reasonOf = (id: string): SceneSolid['highlight'] => (faults.has(id) ? 'fault' : paused.has(id) ? 'paused' : active.has(id) ? 'active' : 'none');

  const zones: SceneZone[] = p.units.map((u) => ({
    id: u.id, name: u.name, x: u.layout.x, z: u.layout.y, w: u.layout.w, d: u.layout.h,
    ...(pausedUnits.has(u.id) ? { paused: true } : {}),
  }));
  const floorNames = zones.map((zone) => floorNameForZone(zone));

  const taken = new Map<string, SceneDraw[]>();
  const solids: SceneSolid[] = p.devices.map((d) => {
    const unit = p.units.find((u) => u.id === d.unitId);
    const zone = unit ? { x: unit.layout.x, y: unit.layout.y, w: unit.layout.w, h: unit.layout.h } : { x: d.layout.x, y: d.layout.y, w: d.layout.w, h: d.layout.h };
    const siblings = taken.get(d.unitId) ?? [];
    const draw = drawFootprint(d.layout, zone, siblings);
    siblings.push(draw);
    taken.set(d.unitId, siblings);
    const shape = shapeForKind(d.kind);
    return {
      id: d.id,
      name: d.name,
      kind: d.kind,
      shape,
      unitId: d.unitId,
      x: d.layout.x,
      z: d.layout.y,
      w: d.layout.w,
      d: d.layout.h,
      draw,
      parts: partsFor(shape, draw.w, draw.d),
      highlight: reasonOf(d.id),
      ...(interlocks.has(d.id) ? { interlock: true } : {}),
    };
  });

  const flows: SceneFlow[] = [];
  for (const c of p.connections) {
    if (c.kind !== 'flow') continue;
    const from = p.units.find((u) => u.id === c.from.nodeId);
    const to = p.units.find((u) => u.id === c.to.nodeId);
    if (!from || !to) continue;
    flows.push({ id: c.id, fromId: from.id, toId: to.id, points: [unitCenter(from), unitCenter(to)] });
  }

  const materials: SceneMaterial[] = [];
  const live = rt?.material;
  const def = p.materials[0];
  const crowd = rt?.pieces && rt.pieces.length > 1 ? rt.pieces.filter((pc) => pc.phase !== 'queued' && pc.material.location !== 'EXIT' && pc.material.location !== '') : null;
  if (crowd) {
    const byUnit = new Map<string, typeof crowd>();
    for (const pc of crowd) {
      const list = byUnit.get(pc.material.location) ?? [];
      list.push(pc);
      byUnit.set(pc.material.location, list);
    }
    for (const [unitId, list] of byUnit) {
      const u = p.units.find((unit) => unit.id === unitId);
      const c = u ? unitCenter(u) : { x: 0, z: 0 };
      list.forEach((pc, i) => {
        const span = Math.max(1, list.length - 1);
        const dx = list.length > 1 ? (i - span / 2) * 52 : 0;
        materials.push({
          id: pc.instanceId,
          name: `개체 ${pc.index}`,
          unitId,
          state: pc.material.state,
          x: c.x + dx,
          z: c.z,
          exited: false,
          waiting: pc.phase === 'waiting',
        });
      });
    }
  } else if (live) {
    if (live.location === 'EXIT') {
      const last = p.units[p.units.length - 1];
      materials.push({
        id: live.instanceId,
        name: def?.name ?? live.materialId,
        unitId: 'EXIT',
        state: live.state,
        x: last ? last.layout.x + last.layout.w + 36 : 0,
        z: last ? last.layout.y + last.layout.h / 2 : 0,
        exited: true,
      });
    } else {
      const u = p.units.find((unit) => unit.id === live.location);
      const c = u ? unitCenter(u) : { x: 0, z: 0 };
      materials.push({
        id: live.instanceId, name: def?.name ?? live.materialId, unitId: live.location, state: live.state, x: c.x, z: c.z, exited: false,
      });
    }
  } else if (def?.initialLocation) {
    const u = p.units.find((unit) => unit.id === def.initialLocation);
    if (u) {
      const c = unitCenter(u);
      materials.push({
        id: def.id, name: def.name, unitId: u.id, state: def.initialState ?? '', x: c.x, z: c.z, exited: false,
      });
    }
  }

  const bounds = emptyBounds();
  let any = false;
  const mark = (x: number, y: number, z: number) => { if (!any) { bounds.minX = bounds.maxX = x; bounds.minY = bounds.maxY = y; bounds.minZ = bounds.maxZ = z; any = true; } grow(bounds, x, y, z); };
  for (const z of zones) {
    mark(z.x, 0, z.z); mark(z.x + z.w, 0, z.z + z.d);
  }
  for (const name of floorNames) {
    mark(name.x - name.length / 2, 0, name.z - name.depth / 2);
    mark(name.x + name.length / 2, 0, name.z + name.depth / 2);
  }
  for (const s of solids) {
    mark(s.draw.x, 0, s.draw.z);
    mark(s.draw.x + s.draw.w, 0, s.draw.z + s.draw.d);
    for (const part of s.parts) mark(s.draw.x + part.x, part.y + part.h / 2, s.draw.z + part.z);
  }
  for (const m of materials) mark(m.x, 36, m.z);
  if (!any) return { zones, solids, flows, materials, highlights, floorNames, bounds: emptyBounds() };
  return { zones, solids, flows, materials, highlights, floorNames, bounds };
}
