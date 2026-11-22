// Device bodies for the 3D view. Primitive parts only — no CAD, no external models.
// Coordinates are local to a device footprint: origin at the minimum corner, y up.

import { BUILTIN_KINDS } from '../model/types';

export const SHAPE_IDS = [
  'box', 'conveyor', 'gantry', 'picker', 'cylinder', 'pusher', 'stopper',
  'sensor', 'photoelectric', 'proximity', 'limit', 'barcode',
  'unitInput', 'unitIdentify', 'unitTransfer',
] as const;

export type ShapeId = typeof SHAPE_IDS[number];

const SHAPE_OF: Record<string, ShapeId> = {
  cylinder: 'cylinder',
  pusher: 'pusher',
  barcodeReader: 'barcode',
  conveyor: 'conveyor',
  stopper: 'stopper',
  gantry: 'gantry',
  picker: 'picker',
  sensor: 'sensor',
  photoelectricSensor: 'photoelectric',
  proximitySensor: 'proximity',
  limitSwitch: 'limit',
  unitInput: 'unitInput',
  unitIdentify: 'unitIdentify',
  unitTransfer: 'unitTransfer',
};

/** Shape for an asset kind. An unknown kind is the plain box. */
export function shapeForKind(kind: string): ShapeId {
  return SHAPE_OF[kind] ?? 'box';
}

export function knownShapeCount(): number {
  return BUILTIN_KINDS.filter((kind) => shapeForKind(kind) !== 'box').length;
}

export interface LocalPart {
  primitive: 'box' | 'cylinder';
  /** Center, in footprint units. y is up from the floor. */
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  axis: 'x' | 'y' | 'z';
  /** Piece that `partDeltas` moves. Absent on a part that stays still. */
  motion?: string;
}

const box = (x: number, y: number, z: number, w: number, h: number, d: number, motion?: string): LocalPart =>
  ({ primitive: 'box', x, y, z, w, h, d, axis: 'y', ...(motion ? { motion } : {}) });

const cyl = (x: number, y: number, z: number, w: number, h: number, d: number, axis: 'x' | 'y' | 'z', motion?: string): LocalPart =>
  ({ primitive: 'cylinder', x, y, z, w, h, d, axis, ...(motion ? { motion } : {}) });

/** Parts that sit on the footprint. w/d are the diagram width and height. */
export function partsFor(shape: ShapeId, w: number, d: number): LocalPart[] {
  const ww = Math.max(8, w);
  const dd = Math.max(8, d);
  const rise = Math.max(64, Math.min(ww, dd) * 1.15);
  switch (shape) {
    case 'conveyor':
      return [
        box(ww / 2, 10, dd / 2, ww * 0.92, 16, dd * 0.5, 'belt'),
        box(ww / 2, 20, dd * 0.16, ww * 0.92, 8, dd * 0.12),
        box(ww / 2, 20, dd * 0.84, ww * 0.92, 8, dd * 0.12),
        cyl(ww * 0.28, 16, dd / 2, 10, dd * 0.36, 10, 'z', 'roller'),
        cyl(ww * 0.72, 16, dd / 2, 10, dd * 0.36, 10, 'z', 'roller'),
      ];
    case 'gantry':
      return [
        box(ww * 0.14, rise * 0.5, dd / 2, Math.max(6, ww * 0.1), rise, Math.max(6, dd * 0.18)),
        box(ww * 0.86, rise * 0.5, dd / 2, Math.max(6, ww * 0.1), rise, Math.max(6, dd * 0.18)),
        box(ww / 2, rise * 0.9, dd / 2, ww * 0.78, Math.max(6, rise * 0.14), Math.max(6, dd * 0.16)),
        box(ww / 2, rise * 0.62, dd / 2, ww * 0.16, rise * 0.2, dd * 0.2, 'head'),
      ];
    case 'picker':
      return [
        box(ww / 2, rise * 0.72, dd / 2, ww * 0.42, rise * 0.28, dd * 0.42),
        box(ww * 0.32, rise * 0.28, dd / 2, ww * 0.12, rise * 0.5, dd * 0.16, 'grip'),
        box(ww * 0.68, rise * 0.28, dd / 2, ww * 0.12, rise * 0.5, dd * 0.16, 'grip'),
      ];
    case 'cylinder':
      return [cyl(ww / 2, rise * 0.45, dd / 2, Math.min(ww, dd) * 0.42, rise * 0.9, Math.min(ww, dd) * 0.42, 'y', 'rod')];
    case 'pusher':
      return [
        box(ww * 0.32, 9, dd / 2, ww * 0.46, 14, dd * 0.46),
        box(ww * 0.72, 11, dd / 2, ww * 0.36, 8, dd * 0.2, 'blade'),
      ];
    case 'stopper':
      return [
        box(ww / 2, 4, dd / 2, ww * 0.7, 8, dd * 0.7),
        box(ww / 2, 24, dd * 0.32, Math.max(6, ww * 0.16), 32, Math.max(4, dd * 0.14), 'pin'),
      ];
    case 'sensor':
      return [
        cyl(ww / 2, 8, dd / 2, ww * 0.16, 16, ww * 0.16, 'y'),
        box(ww / 2, 22, dd / 2, ww * 0.55, 12, dd * 0.4, 'lamp'),
      ];
    case 'photoelectric':
      return [
        box(ww * 0.18, 16, dd / 2, ww * 0.16, 28, dd * 0.28),
        box(ww * 0.82, 16, dd / 2, ww * 0.16, 28, dd * 0.28),
        cyl(ww / 2, 20, dd / 2, ww * 0.08, ww * 0.5, ww * 0.08, 'x', 'lamp'),
      ];
    case 'proximity':
      return [cyl(ww / 2, 7, dd / 2, Math.min(ww, dd) * 0.55, 12, Math.min(ww, dd) * 0.55, 'y', 'lamp')];
    case 'limit':
      return [
        box(ww * 0.38, 8, dd / 2, ww * 0.4, 14, dd * 0.5),
        box(ww * 0.72, 14, dd / 2, ww * 0.4, 4, dd * 0.12, 'lamp'),
      ];
    case 'barcode':
      return [
        box(ww / 2, 12, dd * 0.58, ww * 0.7, 18, dd * 0.46),
        box(ww / 2, 20, dd * 0.28, ww * 0.5, 6, dd * 0.22, 'lamp'),
      ];
    case 'unitInput':
      return [
        box(ww / 2, 8, dd * 0.62, ww * 0.7, 14, dd * 0.4, 'belt'),
        box(ww / 2, 22, dd * 0.38, ww * 0.4, 16, dd * 0.28),
        cyl(ww / 2, 14, dd * 0.62, 8, dd * 0.28, 8, 'z', 'roller'),
      ];
    case 'unitIdentify':
      return [
        box(ww * 0.15, 16, dd / 2, ww * 0.12, 28, dd * 0.7),
        box(ww * 0.85, 16, dd / 2, ww * 0.12, 28, dd * 0.7),
        box(ww / 2, 28, dd / 2, ww * 0.7, 6, dd * 0.7, 'lamp'),
      ];
    case 'unitTransfer':
      return [
        box(ww / 2, 10, dd * 0.2, ww * 0.84, 8, dd * 0.12),
        box(ww / 2, 10, dd * 0.8, ww * 0.84, 8, dd * 0.12),
        box(ww / 2, 14, dd / 2, ww * 0.7, 4, dd * 0.36, 'belt'),
        cyl(ww * 0.3, 10, dd / 2, dd * 0.22, ww * 0.35, dd * 0.22, 'x', 'roller'),
        cyl(ww * 0.7, 10, dd / 2, dd * 0.22, ww * 0.35, dd * 0.22, 'x', 'roller'),
      ];
    default:
      return [box(ww / 2, rise * 0.35, dd / 2, ww * 0.7, rise * 0.7, dd * 0.7, 'lamp')];
  }
}
