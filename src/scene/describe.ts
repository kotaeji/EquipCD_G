// What the 3D view draws. Pure: Project + RuntimeState → scene. No Three.js.
// Diagram x stays 3D x. Diagram y becomes 3D z. A device footprint is its layout box,
// so a device that sits inside its unit on the diagram sits inside that zone here.

import type { Project, Unit } from '../model/types';
import type { RuntimeState } from '../runtime/engine';
import { partsFor, shapeForKind, type LocalPart, type ShapeId } from './shapes';

export type HighlightReason = 'active' | 'fault';

export interface SceneZone {
  id: string;
  name: string;
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface SceneSolid {
  id: string;
  name: string;
  kind: string;
  shape: ShapeId;
  unitId: string;
  /** Footprint minimum corner. x = layout.x, z = layout.y. */
  x: number;
  z: number;
  w: number;
  d: number;
  parts: LocalPart[];
  highlight: HighlightReason | 'none';
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
}

export interface SceneHighlight {
  deviceId: string;
  reason: HighlightReason;
}

export interface SceneBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface SceneDescription {
  zones: SceneZone[];
  solids: SceneSolid[];
  flows: SceneFlow[];
  materials: SceneMaterial[];
  highlights: SceneHighlight[];
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
  if (rt.flowRun) {
    for (const fiber of fibers) {
      if (!fiber.active) continue;
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
  const active = new Set(activeDeviceIds(p, rt));
  const highlights: SceneHighlight[] = [
    ...[...faults].map((deviceId) => ({ deviceId, reason: 'fault' as const })),
    ...[...active].filter((id) => !faults.has(id)).map((deviceId) => ({ deviceId, reason: 'active' as const })),
  ];
  const reasonOf = (id: string): SceneSolid['highlight'] => (faults.has(id) ? 'fault' : active.has(id) ? 'active' : 'none');

  const zones: SceneZone[] = p.units.map((u) => ({
    id: u.id, name: u.name, x: u.layout.x, z: u.layout.y, w: u.layout.w, d: u.layout.h,
  }));

  const solids: SceneSolid[] = p.devices.map((d) => ({
    id: d.id,
    name: d.name,
    kind: d.kind,
    shape: shapeForKind(d.kind),
    unitId: d.unitId,
    x: d.layout.x,
    z: d.layout.y,
    w: d.layout.w,
    d: d.layout.h,
    parts: partsFor(shapeForKind(d.kind), d.layout.w, d.layout.h),
    highlight: reasonOf(d.id),
  }));

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
  if (live) {
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
  for (const s of solids) {
    mark(s.x, 0, s.z);
    mark(s.x + s.w, 0, s.z + s.d);
    for (const part of s.parts) mark(s.x + part.x, part.y + part.h / 2, s.z + part.z);
  }
  for (const m of materials) mark(m.x, 16, m.z);
  if (!any) return { zones, solids, flows, materials, highlights, bounds: emptyBounds() };
  return { zones, solids, flows, materials, highlights, bounds };
}
