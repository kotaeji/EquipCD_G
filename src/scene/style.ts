// Schematic vs photo look for the 3D view. Numbers only — no Three.js, no image files.
// Schematic parts stay in shapes.ts. Photo parts are a finer build of the same footprint.

import type { LocalPart, ShapeId } from './shapes';

export type VisualStyleId = 'schematic' | 'photo';

export type PartRole = 'frame' | 'belt' | 'roller' | 'rod' | 'plastic' | 'safety' | 'lens';

export interface RoleMaterial {
  color: string;
  metalness: number;
  roughness: number;
}

export const ROLE_MATERIAL: Record<PartRole, RoleMaterial> = {
  frame: { color: '#8b939c', metalness: 0.72, roughness: 0.36 },
  belt: { color: '#2c3036', metalness: 0.04, roughness: 0.88 },
  roller: { color: '#d5dde6', metalness: 0.86, roughness: 0.24 },
  rod: { color: '#f2f5f8', metalness: 0.92, roughness: 0.16 },
  plastic: { color: '#2f6f8f', metalness: 0.06, roughness: 0.42 },
  safety: { color: '#e2a100', metalness: 0.12, roughness: 0.46 },
  lens: { color: '#1a2230', metalness: 0.35, roughness: 0.14 },
};

export interface StyledPart extends LocalPart {
  role: PartRole;
  /** What the part is, so tests can ask for a roller or a lens. */
  name: string;
  color?: string;
}

export function materialFor(part: Pick<StyledPart, 'role' | 'color'>): RoleMaterial {
  const base = ROLE_MATERIAL[part.role];
  return part.color ? { ...base, color: part.color } : base;
}

export interface RenderStyle {
  id: VisualStyleId;
  shadows: boolean;
  ambient: number;
  key: number;
  fill: number;
  floorPattern: boolean;
}

export function renderStyle(id: VisualStyleId): RenderStyle {
  if (id === 'photo') {
    return { id, shadows: true, ambient: 0.42, key: 1.25, fill: 0.5, floorPattern: true };
  }
  return { id: 'schematic', shadows: false, ambient: 0.78, key: 0.95, fill: 0, floorPattern: false };
}

/** Photo zone pad. Schematic keeps the theme palette, so this is photo-only. */
export function photoZoneColors(dark: boolean): { fill: string; edge: string; floorInk: string } {
  return dark
    ? { fill: '#243140', edge: '#9aabbd', floorInk: '#d7dee8' }
    : { fill: '#cfc6b8', edge: '#6d747c', floorInk: '#8a8175' };
}

export function floorNameColors(dark: boolean): { band: string; ink: string } {
  return dark
    ? { band: '#1c2838', ink: '#f4f7fb' }
    : { band: '#f6f3ec', ink: '#1c1c1c' };
}

const box = (name: string, role: PartRole, x: number, y: number, z: number, w: number, h: number, d: number, color?: string): StyledPart =>
  ({ name, role, primitive: 'box', x, y, z, w, h, d, axis: 'y', color });

const cyl = (name: string, role: PartRole, x: number, y: number, z: number, w: number, h: number, d: number, axis: 'x' | 'y' | 'z', color?: string): StyledPart =>
  ({ name, role, primitive: 'cylinder', x, y, z, w, h, d, axis, color });

const PHOTO_MOTION: Partial<Record<ShapeId, Record<string, string>>> = {
  conveyor: { belt: 'belt', roller: 'roller' },
  gantry: { head: 'head' },
  picker: { finger: 'grip', gripper: 'grip' },
  cylinder: { rod: 'rod' },
  pusher: { rod: 'blade', blade: 'blade' },
  stopper: { pin: 'pin', cap: 'pin' },
  sensor: { lens: 'lamp' },
  photoelectric: { lens: 'lamp' },
  proximity: { face: 'lamp' },
  limit: { body: 'lamp' },
  barcode: { lens: 'lamp' },
  unitInput: { deck: 'belt', roller: 'roller' },
  unitIdentify: { lamp: 'lamp' },
  unitTransfer: { belt: 'belt', roller: 'roller' },
  box: { box: 'lamp' },
};

function tagPhotoMotion(shape: ShapeId, parts: StyledPart[]): StyledPart[] {
  const map = PHOTO_MOTION[shape];
  if (!map) return parts;
  return parts.map((part) => {
    const motion = map[part.name];
    return motion ? { ...part, motion } : part;
  });
}

/** Photo parts for one footprint. An unknown shape is a single frame box. */
export function photoPartsFor(shape: ShapeId, w: number, d: number): StyledPart[] {
  return tagPhotoMotion(shape, photoPartsRaw(shape, w, d));
}

function photoPartsRaw(shape: ShapeId, w: number, d: number): StyledPart[] {
  const ww = Math.max(8, w);
  const dd = Math.max(8, d);
  const rise = Math.max(64, Math.min(ww, dd) * 1.15);
  switch (shape) {
    case 'conveyor':
      return [
        box('side', 'frame', ww / 2, 18, dd * 0.14, ww * 0.96, 16, dd * 0.1),
        box('side', 'frame', ww / 2, 18, dd * 0.86, ww * 0.96, 16, dd * 0.1),
        box('belt', 'belt', ww / 2, 16, dd / 2, ww * 0.9, 5, dd * 0.58),
        box('leg', 'frame', ww * 0.14, 7, dd / 2, ww * 0.08, 14, dd * 0.55),
        box('leg', 'frame', ww * 0.86, 7, dd / 2, ww * 0.08, 14, dd * 0.55),
        cyl('roller', 'roller', ww * 0.18, 15, dd / 2, 9, dd * 0.5, 9, 'z'),
        cyl('roller', 'roller', ww * 0.4, 15, dd / 2, 9, dd * 0.5, 9, 'z'),
        cyl('roller', 'roller', ww * 0.62, 15, dd / 2, 9, dd * 0.5, 9, 'z'),
        cyl('roller', 'roller', ww * 0.84, 15, dd / 2, 9, dd * 0.5, 9, 'z'),
        box('cap', 'safety', ww * 0.04, 22, dd * 0.14, 8, 6, dd * 0.12),
        box('cap', 'safety', ww * 0.96, 22, dd * 0.86, 8, 6, dd * 0.12, '#e07a1f'),
      ];
    case 'gantry':
      return [
        box('post', 'frame', ww * 0.12, rise * 0.48, dd / 2, Math.max(8, ww * 0.1), rise * 0.96, Math.max(8, dd * 0.16)),
        box('post', 'frame', ww * 0.88, rise * 0.48, dd / 2, Math.max(8, ww * 0.1), rise * 0.96, Math.max(8, dd * 0.16)),
        box('beam', 'frame', ww / 2, rise * 0.9, dd / 2, ww * 0.82, Math.max(8, rise * 0.12), Math.max(8, dd * 0.14)),
        box('rail', 'rod', ww / 2, rise * 0.78, dd / 2, ww * 0.7, 4, Math.max(4, dd * 0.06)),
        box('head', 'plastic', ww * 0.55, rise * 0.62, dd / 2, ww * 0.16, rise * 0.22, dd * 0.22, '#3d7ea0'),
        box('stripe', 'safety', ww * 0.12, rise * 0.22, dd / 2, Math.max(8, ww * 0.1) + 1, 6, Math.max(8, dd * 0.16) + 1),
        cyl('grip', 'safety', ww * 0.55, rise * 0.4, dd / 2, ww * 0.08, 10, ww * 0.08, 'y', '#e07a1f'),
      ];
    case 'picker':
      return [
        box('body', 'frame', ww / 2, rise * 0.74, dd / 2, ww * 0.4, rise * 0.26, dd * 0.4),
        box('finger', 'frame', ww * 0.32, rise * 0.3, dd / 2, ww * 0.08, rise * 0.48, dd * 0.1),
        box('finger', 'frame', ww * 0.68, rise * 0.3, dd / 2, ww * 0.08, rise * 0.48, dd * 0.1),
        box('gripper', 'safety', ww * 0.32, rise * 0.08, dd / 2, ww * 0.1, rise * 0.1, dd * 0.16, '#e07a1f'),
        box('gripper', 'safety', ww * 0.68, rise * 0.08, dd / 2, ww * 0.1, rise * 0.1, dd * 0.16, '#e07a1f'),
        cyl('wrist', 'rod', ww / 2, rise * 0.55, dd / 2, ww * 0.12, rise * 0.16, ww * 0.12, 'y'),
      ];
    case 'cylinder':
      return [
        cyl('body', 'frame', ww / 2, rise * 0.4, dd / 2, Math.min(ww, dd) * 0.46, rise * 0.62, Math.min(ww, dd) * 0.46, 'y'),
        cyl('rod', 'rod', ww / 2, rise * 0.78, dd / 2, Math.min(ww, dd) * 0.22, rise * 0.36, Math.min(ww, dd) * 0.22, 'y'),
        box('flange', 'frame', ww / 2, 4, dd / 2, Math.min(ww, dd) * 0.7, 8, Math.min(ww, dd) * 0.7),
        box('port', 'plastic', ww * 0.72, rise * 0.28, dd / 2, ww * 0.12, 8, dd * 0.16, '#3d7ea0'),
      ];
    case 'pusher':
      return [
        box('base', 'frame', ww * 0.32, 8, dd / 2, ww * 0.42, 14, dd * 0.5),
        box('guide', 'frame', ww * 0.55, 12, dd / 2, ww * 0.16, 10, dd * 0.28),
        cyl('rod', 'rod', ww * 0.62, 14, dd / 2, dd * 0.16, ww * 0.28, dd * 0.16, 'x'),
        box('blade', 'safety', ww * 0.82, 16, dd / 2, ww * 0.1, 22, dd * 0.55, '#e07a1f'),
      ];
    case 'stopper':
      return [
        box('base', 'frame', ww / 2, 4, dd / 2, ww * 0.72, 8, dd * 0.72),
        box('housing', 'plastic', ww / 2, 16, dd * 0.62, ww * 0.36, 20, dd * 0.28, '#3d7ea0'),
        cyl('pin', 'rod', ww / 2, 28, dd * 0.34, Math.max(6, ww * 0.12), 28, Math.max(6, ww * 0.12), 'y'),
        box('cap', 'safety', ww / 2, 44, dd * 0.34, Math.max(8, ww * 0.16), 6, Math.max(8, ww * 0.16)),
      ];
    case 'sensor':
      return [
        cyl('pole', 'frame', ww / 2, 8, dd / 2, ww * 0.14, 16, ww * 0.14, 'y'),
        box('head', 'plastic', ww / 2, 24, dd / 2, ww * 0.55, 14, dd * 0.42, '#3d7ea0'),
        box('lens', 'lens', ww / 2, 24, dd * 0.22, ww * 0.22, 8, dd * 0.1),
      ];
    case 'photoelectric':
      return [
        box('post', 'frame', ww * 0.16, 16, dd / 2, ww * 0.12, 30, dd * 0.22),
        box('post', 'frame', ww * 0.84, 16, dd / 2, ww * 0.12, 30, dd * 0.22),
        box('head', 'plastic', ww * 0.16, 30, dd / 2, ww * 0.2, 12, dd * 0.28, '#3d7ea0'),
        box('head', 'plastic', ww * 0.84, 30, dd / 2, ww * 0.2, 12, dd * 0.28, '#3d7ea0'),
        cyl('lens', 'lens', ww * 0.26, 30, dd / 2, 10, 6, 10, 'x'),
        cyl('lens', 'lens', ww * 0.74, 30, dd / 2, 10, 6, 10, 'x'),
        box('bracket', 'safety', ww / 2, 8, dd / 2, ww * 0.2, 6, dd * 0.16),
      ];
    case 'proximity':
      return [
        cyl('body', 'plastic', ww / 2, 8, dd / 2, Math.min(ww, dd) * 0.55, 14, Math.min(ww, dd) * 0.55, 'y', '#c4a35a'),
        cyl('face', 'lens', ww / 2, 16, dd / 2, Math.min(ww, dd) * 0.36, 4, Math.min(ww, dd) * 0.36, 'y'),
        cyl('cable', 'frame', ww * 0.78, 6, dd / 2, dd * 0.1, ww * 0.28, dd * 0.1, 'x'),
      ];
    case 'limit':
      return [
        box('body', 'plastic', ww * 0.34, 9, dd / 2, ww * 0.36, 16, dd * 0.48, '#d4652f'),
        box('lever', 'frame', ww * 0.66, 16, dd / 2, ww * 0.42, 4, dd * 0.1),
        cyl('roller', 'roller', ww * 0.9, 16, dd / 2, 8, 12, 8, 'z'),
        box('plunger', 'rod', ww * 0.5, 14, dd / 2, ww * 0.08, 6, dd * 0.08),
      ];
    case 'barcode':
      return [
        box('body', 'plastic', ww / 2, 12, dd * 0.6, ww * 0.68, 18, dd * 0.4, '#343a44'),
        box('hood', 'frame', ww / 2, 22, dd * 0.36, ww * 0.5, 8, dd * 0.22),
        box('lens', 'lens', ww / 2, 18, dd * 0.24, ww * 0.28, 8, dd * 0.08),
        box('bracket', 'frame', ww / 2, 6, dd * 0.78, ww * 0.3, 10, dd * 0.12),
      ];
    case 'unitInput':
      return [
        box('deck', 'belt', ww / 2, 8, dd * 0.66, ww * 0.78, 10, dd * 0.36),
        box('tower', 'frame', ww / 2, 24, dd * 0.32, ww * 0.28, 28, dd * 0.22),
        cyl('roller', 'roller', ww * 0.32, 13, dd * 0.66, 8, dd * 0.28, 8, 'z'),
        cyl('roller', 'roller', ww * 0.68, 13, dd * 0.66, 8, dd * 0.28, 8, 'z'),
        box('guide', 'safety', ww * 0.12, 16, dd * 0.66, ww * 0.06, 16, dd * 0.4),
      ];
    case 'unitIdentify':
      return [
        box('post', 'frame', ww * 0.14, 18, dd / 2, ww * 0.1, 34, dd * 0.62),
        box('post', 'frame', ww * 0.86, 18, dd / 2, ww * 0.1, 34, dd * 0.62),
        box('beam', 'frame', ww / 2, 34, dd / 2, ww * 0.74, 6, dd * 0.16),
        box('head', 'plastic', ww / 2, 26, dd / 2, ww * 0.22, 12, dd * 0.28, '#3d7ea0'),
        box('lamp', 'lens', ww / 2, 26, dd * 0.32, ww * 0.16, 4, dd * 0.06),
        box('stripe', 'safety', ww * 0.14, 8, dd / 2, ww * 0.1, 5, dd * 0.62),
      ];
    case 'unitTransfer':
      return [
        box('side', 'frame', ww / 2, 12, dd * 0.16, ww * 0.9, 12, dd * 0.08),
        box('side', 'frame', ww / 2, 12, dd * 0.84, ww * 0.9, 12, dd * 0.08),
        box('belt', 'belt', ww / 2, 10, dd / 2, ww * 0.82, 4, dd * 0.52),
        cyl('roller', 'roller', ww * 0.22, 12, dd / 2, 8, dd * 0.46, 8, 'z'),
        cyl('roller', 'roller', ww * 0.5, 12, dd / 2, 8, dd * 0.46, 8, 'z'),
        cyl('roller', 'roller', ww * 0.78, 12, dd / 2, 8, dd * 0.46, 8, 'z'),
        box('cap', 'safety', ww * 0.06, 16, dd * 0.16, 8, 6, dd * 0.1),
      ];
    default:
      return [box('box', 'frame', ww / 2, rise * 0.35, dd / 2, ww * 0.7, rise * 0.7, dd * 0.7)];
  }
}
