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

/**
 * Frame the bounds so the larger screen axis covers about 88% of the view
 * and both axes stay inside the frame.
 */
export function fitCamera(bounds: SceneBounds, aspect = 1.4): CameraState {
  const aspectSafe = aspect > 0.2 ? aspect : 1.4;
  const aim = {
    targetX: (bounds.minX + bounds.maxX) / 2,
    targetY: (bounds.minY + bounds.maxY) / 2,
    targetZ: (bounds.minZ + bounds.maxZ) / 2,
    yaw: 0.7,
    pitch: 0.62,
    aspect: aspectSafe,
    fov: CAMERA_FOV,
  };
  let lo = 30;
  let hi = 8000;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    const fill = projectedFill({ ...aim, distance: mid }, bounds);
    if (Math.max(fill.width, fill.height) > 0.88) lo = mid;
    else hi = mid;
  }
  return { ...aim, distance: hi };
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
export function applyCameraKey(cam: CameraState, key: string, bounds: SceneBounds): CameraState | null {
  if (key === 'ArrowLeft') return orbitCamera(cam, -48, 0);
  if (key === 'ArrowRight') return orbitCamera(cam, 48, 0);
  if (key === 'ArrowUp') return orbitCamera(cam, 0, -36);
  if (key === 'ArrowDown') return orbitCamera(cam, 0, 36);
  if (key === '+' || key === '=' || key === 'Add') return zoomCamera(cam, -140);
  if (key === '-' || key === '_' || key === 'Subtract') return zoomCamera(cam, 140);
  if (key === 'Home') return { ...fitCamera(bounds, cam.aspect), aspect: cam.aspect };
  return null;
}
