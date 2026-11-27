// TURN-086. Viewpoint, floor grid, contact shadows, fog, and selection chrome.
// Pure numbers — no Three.js. The 3D view only draws what these functions return.
// Diagram dots use a 20px gap at 1 unit = 1 mm, so the floor grid uses the same step.

import { FRAME_MARGIN, fitDistance, projectToScreen, type CameraState, type FrameEdges, type Viewport } from './camera';

/** Same spacing as the diagram dot grid (`Background` gap in Canvas). */
export const DIAGRAM_GRID_MM = 20;
/** Millimetre numbers sit on this step, and only on the two near edges. */
export const GRID_LABEL_MM = 100;
/** Matches `--dur-3`. Reduced motion skips the steps and lands on the last pose. */
export const VIEW_MOVE_MS = 320;

export const DEVICE_OUTLINE_MM = 6;
export const ZONE_BORDER_MM = 4;
export const ZONE_EMPHASIS_MM = 9;

export type SceneViewpoint = 'iso' | 'top' | 'front' | 'side' | 'back' | 'left' | 'right';

const VIEWPOINT_IDS: readonly SceneViewpoint[] = ['iso', 'top', 'front', 'side', 'back', 'left', 'right'];

export function isSceneViewpoint(value: unknown): value is SceneViewpoint {
  return typeof value === 'string' && (VIEWPOINT_IDS as readonly string[]).includes(value);
}

export interface ViewpointAngles { yaw: number; pitch: number }

/** yaw 0 looks from +z (앞). pitch is radians above the floor, capped like orbit. */
const POSE: Record<SceneViewpoint, ViewpointAngles> = {
  iso: { yaw: 0.7, pitch: 0.62 },
  /** yaw 0 matches the diagram's front. Pitch stays short of straight down so the view basis stays defined. */
  top: { yaw: 0, pitch: 1.5 },
  front: { yaw: 0, pitch: 0.42 },
  side: { yaw: Math.PI / 2, pitch: 0.42 },
  back: { yaw: Math.PI, pitch: 0.42 },
  left: { yaw: -Math.PI / 2, pitch: 0.42 },
  right: { yaw: Math.PI / 2, pitch: 0.42 },
};

export function viewpointAngles(id: SceneViewpoint): ViewpointAngles {
  return { ...POSE[id] };
}

export const VIEWPOINT_BUTTONS: { id: SceneViewpoint; label: string; key: '1' | '2' | '3' | '4' }[] = [
  { id: 'iso', label: '등각', key: '1' },
  { id: 'top', label: '위', key: '2' },
  { id: 'front', label: '앞', key: '3' },
  { id: 'side', label: '옆', key: '4' },
];

export const COMPASS_POINTS: { id: SceneViewpoint; label: string }[] = [
  { id: 'front', label: '앞' },
  { id: 'right', label: '우' },
  { id: 'back', label: '뒤' },
  { id: 'left', label: '좌' },
];

export function viewpointByKey(key: string): SceneViewpoint | null {
  return VIEWPOINT_BUTTONS.find((item) => item.key === key)?.id ?? null;
}

export function applyViewpoint(cam: CameraState, id: SceneViewpoint): CameraState {
  const pose = POSE[id];
  return { ...cam, yaw: pose.yaw, pitch: pose.pitch };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Shortest yaw step, so a turn never spins the long way around. */
export function lerpAngle(a: number, b: number, t: number): number {
  let delta = b - a;
  const turn = Math.PI * 2;
  while (delta > Math.PI) delta -= turn;
  while (delta < -Math.PI) delta += turn;
  return a + delta * t;
}

export function lerpCamera(from: CameraState, to: CameraState, t: number): CameraState {
  const u = Math.min(1, Math.max(0, t));
  return {
    targetX: lerp(from.targetX, to.targetX, u),
    targetY: lerp(from.targetY, to.targetY, u),
    targetZ: lerp(from.targetZ, to.targetZ, u),
    yaw: lerpAngle(from.yaw, to.yaw, u),
    pitch: lerp(from.pitch, to.pitch, u),
    distance: lerp(from.distance, to.distance, u),
    aspect: lerp(from.aspect, to.aspect, u),
    fov: lerp(from.fov, to.fov, u),
  };
}

function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * Poses from `from` to `to`. Reduced motion is one sample, the destination.
 * Otherwise eight steps over `VIEW_MOVE_MS`, and the last sample is `to`.
 */
export function cameraMoveSamples(from: CameraState, to: CameraState, reduced: boolean): CameraState[] {
  if (reduced) return [to];
  const steps = 8;
  const out: CameraState[] = [];
  for (let i = 1; i <= steps; i += 1) out.push(lerpCamera(from, to, easeOut(i / steps)));
  out[out.length - 1] = to;
  return out;
}

/** Step 6 diagram and 3D are checked at these windows, including the low laptop. */
export const STEP6_CHECK_WINDOWS = [
  { width: 1024, height: 700 },
  { width: 1280, height: 800 },
] as const;

/** The corner rose shrinks when the 3D cell is shorter than this. */
export const COMPASS_COMPACT_BELOW = 320;
/** Full rose, `--sp-6 * 3`. Compact rose, `--sp-6 * 2`. Edge inset is `--sp-1`. */
export const COMPASS_FULL_PX = 96;
export const COMPASS_COMPACT_PX = 64;
export const COMPASS_EDGE_PX = 4;

export type CompassSize = 'full' | 'compact';

/** A cell that has not been measured yet stays full, so the first paint is not a flicker. */
export function compassSize(cellHeight: number): CompassSize {
  return cellHeight > 0 && cellHeight < COMPASS_COMPACT_BELOW ? 'compact' : 'full';
}

/**
 * Pixels the fitted scene must leave clear. Compact roses sit in the bottom-right,
 * so that corner gets the rose plus the usual frame margin.
 */
export function compassFrameEdges(cellHeight: number): FrameEdges | undefined {
  if (compassSize(cellHeight) !== 'compact') return undefined;
  const clear = COMPASS_EDGE_PX + COMPASS_COMPACT_PX + FRAME_MARGIN;
  return { left: FRAME_MARGIN, right: clear, top: FRAME_MARGIN, bottom: clear };
}

/** Screen box of the compact rose. Null while the rose is full size. */
export function compassScreenRect(view: Viewport, cellHeight = view.height): { x: number; y: number; w: number; h: number } | null {
  if (compassSize(cellHeight) !== 'compact') return null;
  return {
    x: view.width - COMPASS_EDGE_PX - COMPASS_COMPACT_PX,
    y: view.height - COMPASS_EDGE_PX - COMPASS_COMPACT_PX,
    w: COMPASS_COMPACT_PX,
    h: COMPASS_COMPACT_PX,
  };
}

export type CameraHold = 'preset' | 'free' | 'user';

/**
 * A named viewpoint follows the cell. 「전체 보기」 follows until the user
 * orbits, pans, or zooms. After that the distance stays put.
 */
export function cameraHold(onPreset: boolean, userMoved: boolean): CameraHold {
  if (onPreset) return 'preset';
  return userMoved ? 'user' : 'free';
}

/** User hold keeps the distance and only updates the aspect. Any other hold takes `next`. */
export function heldCamera(cam: CameraState, hold: CameraHold, aspect: number, next: CameraState): CameraState {
  if (hold !== 'user') return next;
  return Math.abs(cam.aspect - aspect) < 0.01 ? cam : { ...cam, aspect };
}

/**
 * Fit a named viewpoint. The compact rose sits in the bottom-right corner, so a
 * scene that already clears that corner keeps its distance. One that would slide
 * under the rose is pulled back until the corner is empty.
 */
export function fitViewpoint(
  cam: CameraState,
  points: { x: number; y: number; z: number }[],
  view: Viewport,
): CameraState {
  const plain = fitDistance(cam, points, view);
  if (!projectionHitsRose(plain, points, view)) return plain;
  return fitDistance(cam, points, view, compassFrameEdges(view.height));
}

function projectionHitsRose(
  cam: CameraState,
  points: { x: number; y: number; z: number }[],
  view: Viewport,
): boolean {
  const rose = compassScreenRect(view);
  if (!rose || points.length === 0) return false;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    const at = projectToScreen(cam, point, view);
    if (!at.ok) return true;
    minX = Math.min(minX, at.x);
    maxX = Math.max(maxX, at.x);
    minY = Math.min(minY, at.y);
    maxY = Math.max(maxY, at.y);
  }
  const slop = 8;
  return maxX > rose.x - slop && minX < rose.x + rose.w && maxY > rose.y - slop && minY < rose.y + rose.h;
}

/** Shown on the viewpoint buttons and in the shortcut sheet. */
export const VIEWPOINT_KEY_HINT = '장면을 누른 뒤 1~4 키';

/** Degrees for the corner rose. yaw 0 keeps 앞 at the top of the rose. */
export function compassRotationDeg(yaw: number): number {
  if (!Number.isFinite(yaw)) return 0;
  const deg = -yaw * (180 / Math.PI);
  const wrapped = ((deg % 360) + 360) % 360;
  return Math.round(wrapped * 1000) / 1000;
}

export interface GridLabel {
  text: string;
  x: number;
  z: number;
  axis: 'x' | 'z';
}

export interface FloorGrid {
  step: number;
  labelStep: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Lines of constant x, from minZ to maxZ. */
  xStops: number[];
  /** Lines of constant z, from minX to maxX. */
  zStops: number[];
  labels: GridLabel[];
}

function snapDown(n: number, step: number): number {
  return Math.floor(n / step) * step;
}

function snapUp(n: number, step: number): number {
  return Math.ceil(n / step) * step;
}

function stops(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  for (let at = min; at <= max + 1e-6; at += step) out.push(Math.round(at));
  return out;
}

/** Faint floor grid. Line step matches the diagram. Numbers are on the min-x and min-z edges only. */
export function floorGrid(bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, step = DIAGRAM_GRID_MM): FloorGrid {
  const safe = step > 0 ? step : DIAGRAM_GRID_MM;
  const pad = safe;
  const minX = snapDown(bounds.minX - pad, safe);
  const maxX = snapUp(bounds.maxX + pad, safe);
  const minZ = snapDown(bounds.minZ - pad, safe);
  const maxZ = snapUp(bounds.maxZ + pad, safe);
  const cap = 240;
  const xStep = (maxX - minX) / safe > cap ? Math.ceil((maxX - minX) / cap / safe) * safe : safe;
  const zStep = (maxZ - minZ) / safe > cap ? Math.ceil((maxZ - minZ) / cap / safe) * safe : safe;
  const labelStep = Math.max(GRID_LABEL_MM, xStep, zStep);
  const labels: GridLabel[] = [];
  for (let x = snapUp(minX, labelStep); x <= maxX + 1e-6; x += labelStep) {
    labels.push({ text: String(Math.round(x)), x: Math.round(x), z: minZ, axis: 'x' });
  }
  for (let z = snapUp(minZ, labelStep); z <= maxZ + 1e-6; z += labelStep) {
    if (Math.round(z) === minZ) continue;
    labels.push({ text: String(Math.round(z)), x: minX, z: Math.round(z), axis: 'z' });
  }
  return {
    step: safe,
    labelStep,
    minX,
    maxX,
    minZ,
    maxZ,
    xStops: stops(minX, maxX, xStep),
    zStops: stops(minZ, maxZ, zStep),
    labels,
  };
}

export interface ContactShadow {
  deviceId: string;
  x: number;
  z: number;
  w: number;
  d: number;
  opacity: number;
  /** Always a flat plane. The renderer must not turn on a shadow map for these. */
  shadowMap: false;
}

export function contactShadows(
  solids: readonly { id: string; draw: { x: number; z: number; w: number; d: number } }[],
  dark: boolean,
): ContactShadow[] {
  return solids.map((solid) => ({
    deviceId: solid.id,
    x: solid.draw.x + solid.draw.w / 2,
    z: solid.draw.z + solid.draw.d / 2,
    w: Math.max(8, solid.draw.w * 1.18),
    d: Math.max(8, solid.draw.d * 1.18),
    opacity: dark ? 0.45 : 0.3,
    shadowMap: false as const,
  }));
}

export interface SceneFog {
  color: string;
  near: number;
  far: number;
}

/** Far objects fade toward the canvas color, in either theme. */
export function sceneFog(distance: number, background: string): SceneFog {
  const dist = Math.max(40, Number.isFinite(distance) ? distance : 40);
  return { color: background, near: dist * 0.72, far: dist * 3.1 };
}

export function deviceOutlineSpec(selected: boolean): { thickness: number } | null {
  return selected ? { thickness: DEVICE_OUTLINE_MM } : null;
}

export function zoneBorderThickness(selected: boolean): number {
  return selected ? ZONE_EMPHASIS_MM : ZONE_BORDER_MM;
}

/** Selected names are heavier and thicker, so the mark is not color alone. */
export function labelEmphasis(selected: boolean): { className: string; fontWeight: number; borderPx: number } {
  return selected
    ? { className: 'is-selected', fontWeight: 700, borderPx: 2 }
    : { className: '', fontWeight: 600, borderPx: 1 };
}

export function sceneLabelClass(kind: string, marker: string, waiting: boolean, hidden: boolean, selected: boolean): string {
  const emphasis = labelEmphasis(selected).className;
  return `scene3d-label ${kind}${marker}${waiting ? ' waiting' : ''}${hidden ? ' is-culled' : ''}${emphasis ? ` ${emphasis}` : ''}`;
}
