// Unit names painted on the floor, outside the back edge of each zone.
// Pure: no Three.js. The mesh uses these numbers and rotates with the camera yaw.

import { projectToScreen, type CameraState, type Viewport } from './camera';

export const FLOOR_NAME_GAP = 64;
/** Lower bound used when the zone is wide enough. A long name may go lower so it still fits the zone width. */
export const MIN_GLYPH_HEIGHT = 28;
const MAX_GLYPH_HEIGHT = 58;

/** Width of the name in em, using square Korean and narrower Latin. */
export function emWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    if (ch === ' ') w += 0.34;
    else if (ch >= '가' && ch <= '힣') w += 1.02;
    else w += 0.62;
  }
  return Math.max(1, w);
}

export interface FloorName {
  id: string;
  text: string;
  /** Center of the strip on the floor. */
  x: number;
  z: number;
  /** Length along the zone edge (world X). */
  length: number;
  /** Depth of the faint band, perpendicular to that edge (world Z). */
  depth: number;
  /** Glyph height in world units. The letters stand this tall along the band's depth. */
  textHeight: number;
  /**
   * Rest yaw around Y, before the camera flip.
   * 0 keeps the baseline parallel to the zone edge and the tops of the letters toward −Z.
   */
  yaw: 0;
}

export function floorNameForZone(zone: { id: string; name: string; x: number; z: number; w: number }): FloorName {
  const em = emWidth(zone.name);
  const length = Math.max(48, zone.w * 0.96);
  const proportional = Math.min(MAX_GLYPH_HEIGHT, zone.w * 0.24);
  const fitted = (length * 0.9) / em;
  // Stay inside the zone width. A very long name gets smaller rather than spilling into the next zone.
  const textHeight = Math.min(proportional, fitted);
  const depth = textHeight * 1.38;
  return {
    id: zone.id,
    text: zone.name,
    x: zone.x + zone.w / 2,
    z: zone.z - FLOOR_NAME_GAP - depth / 2,
    length,
    depth,
    textHeight,
    yaw: 0,
  };
}

/**
 * Yaw of the floor text so it stays readable.
 * 0 reads from the +Z side. π flips it when the camera has gone to the −Z side.
 */
export function floorNameYaw(cameraYaw: number): number {
  return Math.cos(cameraYaw) >= 0 ? 0 : Math.PI;
}

/** Floor axes after `yaw`. Rest pose: right is +X, up (tops of letters) is −Z. */
export function floorNameAxes(yaw: number): { right: { x: number; z: number }; up: { x: number; z: number } } {
  const turn = (v: { x: number; z: number }) => ({
    x: v.x * Math.cos(yaw) + v.z * Math.sin(yaw),
    z: -v.x * Math.sin(yaw) + v.z * Math.cos(yaw),
  });
  return { right: turn({ x: 1, z: 0 }), up: turn({ x: 0, z: -1 }) };
}

/**
 * Tops of the letters point away from the camera, so the line is not upside down.
 * Side-on (the camera sitting on the X axis) is treated as still readable.
 */
export function floorNameReadable(cameraYaw: number, labelYaw: number): boolean {
  const up = floorNameAxes(labelYaw).up;
  const awayX = -Math.sin(cameraYaw);
  const awayZ = -Math.cos(cameraYaw);
  return up.x * awayX + up.z * awayZ >= -1e-9;
}

/** Screen-space distance between the top and bottom of the glyphs. */
export function projectedGlyphHeight(cam: CameraState, name: FloorName, view: Viewport): number {
  const up = floorNameAxes(floorNameYaw(cam.yaw)).up;
  const half = name.textHeight / 2;
  const a = projectToScreen(cam, { x: name.x - up.x * half, y: 1, z: name.z - up.z * half }, view);
  const b = projectToScreen(cam, { x: name.x + up.x * half, y: 1, z: name.z + up.z * half }, view);
  if (!a.ok || !b.ok) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
}
