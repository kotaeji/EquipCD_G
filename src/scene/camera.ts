// Orbit camera for the 3D view. Pure so tests can move it without WebGL.
import type { SceneBounds } from './describe';

export const CAMERA_FOV = 45;

export interface CameraState {
  targetX: number;
  targetY: number;
  targetZ: number;
  /** Radians. 0 looks from +z toward the target. */
  yaw: number;
  /** Radians above the floor. */
  pitch: number;
  distance: number;
  aspect: number;
  fov: number;
}

export function cameraPosition(cam: CameraState): { x: number; y: number; z: number } {
  const cp = Math.cos(cam.pitch);
  return {
    x: cam.targetX + cam.distance * cp * Math.sin(cam.yaw),
    y: cam.targetY + cam.distance * Math.sin(cam.pitch),
    z: cam.targetZ + cam.distance * cp * Math.cos(cam.yaw),
  };
}

/** How much of the viewport the bounds cover. 1 means edge to edge. */
export interface ProjectionFill { width: number; height: number }

/** Side columns of the 3D run layout, in px. The center takes the rest and is at least half the work area. */
export const RUN3D_INFO_W = 200;
export const RUN3D_COND_W = 220;

export function centerFraction(workWidth: number): number {
  return (workWidth - RUN3D_INFO_W - RUN3D_COND_W) / workWidth;
}

function cornersOf(bounds: SceneBounds): { x: number; y: number; z: number }[] {
  const out: { x: number; y: number; z: number }[] = [];
  for (const y of [bounds.minY, bounds.maxY]) {
    for (const x of [bounds.minX, bounds.maxX]) {
      for (const z of [bounds.minZ, bounds.maxZ]) out.push({ x, y, z });
    }
  }
  return out;
}

function viewBasis(cam: CameraState) {
  const eye = cameraPosition(cam);
  let fx = cam.targetX - eye.x;
  let fy = cam.targetY - eye.y;
  let fz = cam.targetZ - eye.z;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl; fy /= fl; fz /= fl;
  let rx = -fz;
  let ry = 0;
  let rz = fx;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl; ry /= rl; rz /= rl;
  const ux = ry * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - ry * fx;
  return { eye, f: { x: fx, y: fy, z: fz }, r: { x: rx, y: ry, z: rz }, u: { x: ux, y: uy, z: uz } };
}

export interface Viewport { width: number; height: number }

/** Pixels kept clear around a fitted scene. */
export const FRAME_MARGIN = 16;

export interface ScreenPoint { x: number; y: number; ok: boolean }

/** Project one world point into the viewport. y grows downward. */
export function projectToScreen(cam: CameraState, p: { x: number; y: number; z: number }, view: Viewport): ScreenPoint {
  const basis = viewBasis(cam);
  const vx = p.x - basis.eye.x;
  const vy = p.y - basis.eye.y;
  const vz = p.z - basis.eye.z;
  const depth = vx * basis.f.x + vy * basis.f.y + vz * basis.f.z;
  if (depth <= 1) return { x: -1e6, y: -1e6, ok: false };
  const fovY = (cam.fov * Math.PI) / 180;
  const tanY = Math.tan(fovY / 2);
  const tanX = tanY * Math.max(0.2, cam.aspect);
  const ndcX = (vx * basis.r.x + vy * basis.r.y + vz * basis.r.z) / depth / tanX;
  const ndcY = (vx * basis.u.x + vy * basis.u.y + vz * basis.u.z) / depth / tanY;
  return { x: (ndcX * 0.5 + 0.5) * view.width, y: (-ndcY * 0.5 + 0.5) * view.height, ok: true };
}

function ndcBox(cam: CameraState, points: { x: number; y: number; z: number }[]) {
  const basis = viewBasis(cam);
  const fovY = (cam.fov * Math.PI) / 180;
  const tanY = Math.tan(fovY / 2);
  const tanX = tanY * Math.max(0.2, cam.aspect);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let depthSum = 0;
  for (const p of points) {
    const vx = p.x - basis.eye.x;
    const vy = p.y - basis.eye.y;
    const vz = p.z - basis.eye.z;
    const depth = vx * basis.f.x + vy * basis.f.y + vz * basis.f.z;
    if (depth <= 1) return null;
    const ndcX = (vx * basis.r.x + vy * basis.r.y + vz * basis.r.z) / depth / tanX;
    const ndcY = (vx * basis.u.x + vy * basis.u.y + vz * basis.u.z) / depth / tanY;
    minX = Math.min(minX, ndcX);
    maxX = Math.max(maxX, ndcX);
    minY = Math.min(minY, ndcY);
    maxY = Math.max(maxY, ndcY);
    depthSum += depth;
  }
  return { minX, maxX, minY, maxY, depth: depthSum / points.length, tanX, tanY, basis };
}

/** Slide the look-at point so the projected box moves toward the screen center. One small step. */
function nudgeCenter(cam: CameraState, points: { x: number; y: number; z: number }[]): CameraState | null {
  const box = ndcBox(cam, points);
  if (!box) return null;
  const cx = Math.max(-1.5, Math.min(1.5, (box.minX + box.maxX) / 2));
  const cy = Math.max(-1.5, Math.min(1.5, (box.minY + box.maxY) / 2));
  const shiftX = cx * box.tanX * box.depth;
  const shiftY = cy * box.tanY * box.depth;
  return {
    ...cam,
    targetX: cam.targetX + shiftX * box.basis.r.x + shiftY * box.basis.u.x,
    targetY: cam.targetY + shiftX * box.basis.r.y + shiftY * box.basis.u.y,
    targetZ: cam.targetZ + shiftX * box.basis.r.z + shiftY * box.basis.u.z,
  };
}

/** Projected width and height of the bounds, as fractions of the viewport. */
export function projectedFill(cam: CameraState, bounds: SceneBounds): ProjectionFill {
  const basis = viewBasis(cam);
  const fovY = (cam.fov * Math.PI) / 180;
  const tanY = Math.tan(fovY / 2);
  const tanX = tanY * Math.max(0.2, cam.aspect);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of cornersOf(bounds)) {
    const vx = p.x - basis.eye.x;
    const vy = p.y - basis.eye.y;
    const vz = p.z - basis.eye.z;
    const depth = vx * basis.f.x + vy * basis.f.y + vz * basis.f.z;
    if (depth <= 1) return { width: 2, height: 2 };
    const ndcX = (vx * basis.r.x + vy * basis.r.y + vz * basis.r.z) / depth / tanX;
    const ndcY = (vx * basis.u.x + vy * basis.u.y + vz * basis.u.z) / depth / tanY;
    minX = Math.min(minX, ndcX);
    maxX = Math.max(maxX, ndcX);
    minY = Math.min(minY, ndcY);
    maxY = Math.max(maxY, ndcY);
  }
  return { width: (maxX - minX) / 2, height: (maxY - minY) / 2 };
}

function pointCenter(points: { x: number; y: number; z: number }[]) {
  const n = Math.max(1, points.length);
  return points.reduce((s, p) => ({ x: s.x + p.x / n, y: s.y + p.y / n, z: s.z + p.z / n }), { x: 0, y: 0, z: 0 });
}

/**
 * Frame these world points inside the viewport by `FRAME_MARGIN` pixels,
 * with the projected box centered on the panel.
 */
export function fitToPoints(
  points: { x: number; y: number; z: number }[],
  aspect = 1.4,
  viewport?: Viewport,
  pose?: { yaw: number; pitch: number },
): CameraState {
  const aspectSafe = aspect > 0.2 ? aspect : 1.4;
  const view = viewport && viewport.width > 40 && viewport.height > 40
    ? viewport
    : { width: Math.max(80, Math.round(400 * aspectSafe)), height: 400 };
  const safe = points.length ? points : [{ x: 0, y: 0, z: 0 }, { x: 200, y: 40, z: 200 }];
  const margin = FRAME_MARGIN;
  const mid = pointCenter(safe);
  const span = safe.reduce((m, p) => Math.max(m, Math.hypot(p.x - mid.x, p.y - mid.y, p.z - mid.z)), 1);
  let cam: CameraState = {
    targetX: mid.x, targetY: mid.y, targetZ: mid.z,
    yaw: pose?.yaw ?? 0.7, pitch: pose?.pitch ?? 0.62,
    distance: Math.max(80, span / Math.sin((CAMERA_FOV * Math.PI) / 360)),
    aspect: aspectSafe, fov: CAMERA_FOV,
  };
  const limitX = 1 - (margin * 2) / view.width;
  const limitY = 1 - (margin * 2) / view.height;
  for (let i = 0; i < 14; i++) {
    for (let n = 0; n < 6; n++) {
      const next = nudgeCenter(cam, safe);
      if (!next) { cam = { ...cam, distance: cam.distance * 1.25, targetX: mid.x, targetY: mid.y, targetZ: mid.z }; break; }
      cam = next;
    }
    const box = ndcBox(cam, safe);
    if (!box) { cam = { ...cam, distance: cam.distance * 1.3, targetX: mid.x, targetY: mid.y, targetZ: mid.z }; continue; }
    const scale = Math.max((box.maxX - box.minX) / (2 * limitX), (box.maxY - box.minY) / (2 * limitY));
    if (Math.abs(scale - 1) < 0.015) break;
    cam = { ...cam, distance: Math.min(80000, Math.max(30, cam.distance * scale)) };
  }
  for (let i = 0; i < 10; i++) {
    const next = nudgeCenter(cam, safe);
    if (next) cam = next;
    const box = ndcBox(cam, safe);
    const outside = !box || box.minX < -limitX || box.maxX > limitX || box.minY < -limitY || box.maxY > limitY;
    if (!outside) break;
    cam = { ...cam, distance: cam.distance * 1.06 };
  }
  return cam;
}

/**
 * Keep yaw, pitch, and the look-at point. Pull `distance` in until the points
 * still sit inside the frame on both axes. A box that is small but off to one
 * side does not count as fitting.
 */
export function fitDistance(cam: CameraState, points: { x: number; y: number; z: number }[], viewport?: Viewport): CameraState {
  const view = viewport && viewport.width > 40 && viewport.height > 40
    ? viewport
    : { width: Math.max(80, Math.round(400 * Math.max(0.2, cam.aspect))), height: 400 };
  const safe = points.length ? points : [{ x: 0, y: 0, z: 0 }, { x: 200, y: 40, z: 200 }];
  const aspect = view.width / view.height;
  const limitX = 1 - (FRAME_MARGIN * 2) / view.width;
  const limitY = 1 - (FRAME_MARGIN * 2) / view.height;
  let lo = 30;
  let hi = 20000;
  let best = hi;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    const box = ndcBox({ ...cam, distance: mid, aspect }, safe);
    const inside = !!box
      && box.minX >= -limitX && box.maxX <= limitX
      && box.minY >= -limitY && box.maxY <= limitY;
    if (!inside) lo = mid;
    else { best = mid; hi = mid; }
  }
  return { ...cam, distance: best, aspect };
}

/** Frame the bounds box. Prefer `fitToPoints` with the scene's zone corners and device tops. */
export function fitCamera(bounds: SceneBounds, aspect = 1.4, viewport?: Viewport): CameraState {
  return fitToPoints(cornersOf(bounds), aspect, viewport);
}

/** Bounding sphere of `bounds` is inside the camera frustum. */
export function sceneFits(cam: CameraState, bounds: SceneBounds): boolean {
  const c = cameraPosition(cam);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const radius = Math.max(1, Math.hypot((bounds.maxX - bounds.minX) / 2, (bounds.maxY - bounds.minY) / 2, (bounds.maxZ - bounds.minZ) / 2));
  const dist = Math.hypot(c.x - cx, c.y - cy, c.z - cz);
  if (dist <= radius + 0.5) return false;
  const halfAngle = Math.asin(Math.min(1, radius / dist));
  const fovY = cam.fov * Math.PI / 180;
  const fovX = 2 * Math.atan(Math.tan(fovY / 2) * cam.aspect);
  return halfAngle <= Math.min(fovY, fovX) / 2 + 1e-4;
}

export function orbitCamera(cam: CameraState, dx: number, dy: number): CameraState {
  const yaw = cam.yaw - dx * 0.008;
  const pitch = Math.min(1.35, Math.max(0.12, cam.pitch - dy * 0.006));
  return { ...cam, yaw, pitch };
}

export function panCamera(cam: CameraState, dx: number, dy: number): CameraState {
  const scale = cam.distance * 0.0015;
  const rx = Math.cos(cam.yaw);
  const rz = -Math.sin(cam.yaw);
  const fx = -Math.sin(cam.yaw);
  const fz = -Math.cos(cam.yaw);
  return {
    ...cam,
    targetX: cam.targetX - dx * scale * rx + dy * scale * fx,
    targetZ: cam.targetZ - dx * scale * rz + dy * scale * fz,
  };
}

export function zoomCamera(cam: CameraState, deltaY: number): CameraState {
  const distance = Math.min(8000, Math.max(20, cam.distance * Math.exp(deltaY * 0.0012)));
  return { ...cam, distance };
}

/** Right button, or Shift held, pans. Any other drag orbits. */
export function gestureMode(button: number, shift: boolean): 'orbit' | 'pan' {
  return button === 2 || shift ? 'pan' : 'orbit';
}

/**
 * Arrow keys orbit, +/− zoom, Home frames the scene.
 * Returns null when the key is not a camera key.
 */
export function applyCameraKey(cam: CameraState, key: string, bounds: SceneBounds, viewport?: Viewport): CameraState | null {
  if (key === 'ArrowLeft') return orbitCamera(cam, -48, 0);
  if (key === 'ArrowRight') return orbitCamera(cam, 48, 0);
  if (key === 'ArrowUp') return orbitCamera(cam, 0, -36);
  if (key === 'ArrowDown') return orbitCamera(cam, 0, 36);
  if (key === '+' || key === '=' || key === 'Add') return zoomCamera(cam, -140);
  if (key === '-' || key === '_' || key === 'Subtract') return zoomCamera(cam, 140);
  if (key === 'Home') return fitCamera(bounds, cam.aspect, viewport);
  return null;
}
