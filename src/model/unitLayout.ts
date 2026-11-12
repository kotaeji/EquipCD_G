// Unit box vs its Devices. One place for the grow-to-fit math (TURN-013).
// Header height matches .rf-unit-head (28px). Inner pad matches the tightest sample inset
// (gantry top sits 12px under that header). Commands call these; the canvas does not recompute them.
import { sizeOf } from './factory';
import type { AssetKind, Layout, Project, Unit } from './types';

export const UNIT_HEADER = 28;
export const UNIT_PAD = 12;
export const UNIT_DEFAULT_W = 216;
export const UNIT_DEFAULT_H = 300;
/** Empty-unit drag floor: the header row stays readable. Fit-to-devices on an empty unit uses the default size. */
export const UNIT_MIN_W = 96;

export interface Box { x: number; y: number; w: number; h: number }

const unitOf = (p: Project, unitId: string): Unit | undefined => p.units.find((u) => u.id === unitId);
const devicesOf = (p: Project, unitId: string) => p.devices.filter((d) => d.unitId === unitId);

/** Grow `unitId` so every child Device sits inside the header and the inner pad. Never shrinks. Mutates `p`. */
export function fitUnit(p: Project, unitId: string): void {
  const u = unitOf(p, unitId);
  if (!u) return;
  const devs = devicesOf(p, unitId);
  if (!devs.length) return;
  let x = u.layout.x;
  let y = u.layout.y;
  let right = x + u.layout.w;
  let bottom = y + u.layout.h;
  for (const d of devs) {
    x = Math.min(x, d.layout.x - UNIT_PAD);
    y = Math.min(y, d.layout.y - UNIT_HEADER - UNIT_PAD);
    right = Math.max(right, d.layout.x + d.layout.w + UNIT_PAD);
    bottom = Math.max(bottom, d.layout.y + d.layout.h + UNIT_PAD);
  }
  u.layout.x = x;
  u.layout.y = y;
  u.layout.w = right - x;
  u.layout.h = bottom - y;
}

/** Smallest width/height the bottom-right handle may set. Origin (x/y) stays put, so a Device on the far side holds the edge. */
export function unitMinSize(p: Project, unitId: string): { w: number; h: number } {
  const u = unitOf(p, unitId);
  if (!u) return { w: UNIT_DEFAULT_W, h: UNIT_DEFAULT_H };
  let w = UNIT_MIN_W;
  let h = UNIT_HEADER;
  for (const d of devicesOf(p, unitId)) {
    w = Math.max(w, d.layout.x + d.layout.w + UNIT_PAD - u.layout.x);
    h = Math.max(h, d.layout.y + d.layout.h + UNIT_PAD - u.layout.y);
  }
  return { w, h };
}

/** Exact wrap. Empty unit → default 216×300 at the same origin. May move x/y. Does not mutate. */
export function tightUnitLayout(p: Project, unitId: string): Layout | undefined {
  const u = unitOf(p, unitId);
  if (!u) return undefined;
  const devs = devicesOf(p, unitId);
  if (!devs.length) return { x: u.layout.x, y: u.layout.y, w: UNIT_DEFAULT_W, h: UNIT_DEFAULT_H };
  let x = Infinity;
  let y = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const d of devs) {
    x = Math.min(x, d.layout.x - UNIT_PAD);
    y = Math.min(y, d.layout.y - UNIT_HEADER - UNIT_PAD);
    right = Math.max(right, d.layout.x + d.layout.w + UNIT_PAD);
    bottom = Math.max(bottom, d.layout.y + d.layout.h + UNIT_PAD);
  }
  let w = right - x;
  let h = bottom - y;
  if (w < UNIT_MIN_W) w = UNIT_MIN_W;
  if (h < UNIT_HEADER) h = UNIT_HEADER;
  return { x, y, w, h };
}

export function rectsOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function overlappingUnitIds(boxes: (Box & { id: string })[]): string[] {
  const hit = new Set<string>();
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (rectsOverlap(boxes[i], boxes[j])) { hit.add(boxes[i].id); hit.add(boxes[j].id); }
    }
  }
  return [...hit];
}

function overlapsDevice(devs: { layout: Layout }[], x: number, y: number, w: number, h: number): boolean {
  return devs.some((d) => rectsOverlap({ x, y, w, h }, d.layout));
}

/**
 * Next top-left for a Device dropped on a Unit card.
 * Rows run left to right, then downward. A full Unit returns the next row below; fitUnit grows the box.
 */
export function nextDeviceSlot(p: Project, unitId: string, kind: AssetKind): { x: number; y: number } {
  const u = unitOf(p, unitId);
  if (!u) return { x: 0, y: 0 };
  const [w, h] = sizeOf(kind);
  const gap = UNIT_PAD;
  const x0 = u.layout.x + UNIT_PAD;
  const y0 = u.layout.y + UNIT_HEADER + UNIT_PAD;
  const innerRight = u.layout.x + u.layout.w - UNIT_PAD;
  const innerBottom = u.layout.y + u.layout.h - UNIT_PAD;
  const devs = devicesOf(p, unitId);
  const stepX = w + gap;
  const stepY = h + gap;
  const cols = Math.max(1, Math.floor((innerRight - x0 + gap) / stepX));
  const rows = Math.max(1, Math.floor((innerBottom - y0 + gap) / stepY));
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = x0 + col * stepX;
      const y = y0 + row * stepY;
      if (x + w <= innerRight && y + h <= innerBottom && !overlapsDevice(devs, x, y, w, h)) return { x, y };
    }
  }
  for (let n = 0; n < devs.length + 4; n++) {
    const y = y0 + (rows + n) * stepY;
    for (let col = 0; col < Math.max(cols, 1); col++) {
      const x = x0 + col * stepX;
      if (!overlapsDevice(devs, x, y, w, h)) return { x, y };
    }
  }
  return { x: x0, y: y0 + (rows + devs.length) * stepY };
}
