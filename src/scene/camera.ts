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

/** Distance and aim that put the whole bounds inside the frustum. */
export function fitCamera(bounds: SceneBounds, aspect = 1.4): CameraState {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const hx = Math.max(1, (bounds.maxX - bounds.minX) / 2);
  const hy = Math.max(1, (bounds.maxY - bounds.minY) / 2);
  const hz = Math.max(1, (bounds.maxZ - bounds.minZ) / 2);
  const radius = Math.hypot(hx, hy, hz);
  const aspectSafe = aspect > 0.2 ? aspect : 1.4;
  const fovY = CAMERA_FOV * Math.PI / 180;
  const fovX = 2 * Math.atan(Math.tan(fovY / 2) * aspectSafe);
  const half = Math.min(fovY, fovX) / 2;
  const distance = Math.min(8000, Math.max(30, (radius / Math.sin(half)) * 1.2));
  return { targetX: cx, targetY: cy, targetZ: cz, yaw: 0.7, pitch: 0.62, distance, aspect: aspectSafe, fov: CAMERA_FOV };
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
