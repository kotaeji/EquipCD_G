// TURN-059. One PNG or JPEG behind the stage-2 diagram.
// Optional on the project. Older files have no field and open unchanged.
// The file format version is not raised.
import type { CmdResult } from './commands';
import type { DiagramBackground, Project } from './types';

export const BACKGROUND_MAX_BYTES = 2 * 1024 * 1024;
export const BACKGROUND_MAX_EDGE = 4096;
export const BACKGROUND_OPACITY_MIN = 10;
export const BACKGROUND_OPACITY_MAX = 100;

export type BackgroundReject =
  | { code: 'too-big'; bytes: number }
  | { code: 'too-wide'; edge: number }
  | { code: 'not-image' };

export type AssessedImage = { dataUrl: string; width: number; height: number };

const clone = (p: Project): Project => structuredClone(p);
const bump = (p: Project): Project => { p.revision += 1; return p; };
const ok = (project: Project, note?: string): CmdResult => ({ ok: true, project: bump(project), note });
const no = (reason: string): CmdResult => ({ ok: false, reason });

function u32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function u16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 24
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52;
}

function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (!isPng(bytes)) return null;
  const width = u32(bytes, 16);
  const height = u32(bytes, 20);
  if (width < 1 || height < 1) return null;
  return { width, height };
}

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) { i += 1; continue; }
    while (bytes[i] === 0xff) i += 1;
    if (i >= bytes.length) return null;
    const marker = bytes[i];
    i += 1;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (i + 1 >= bytes.length) return null;
    const len = u16(bytes, i);
    if (len < 2 || i + len > bytes.length) return null;
    if (SOF.has(marker)) {
      if (len < 7) return null;
      const height = u16(bytes, i + 3);
      const width = u16(bytes, i + 5);
      if (width < 1 || height < 1) return null;
      return { width, height };
    }
    i += len;
  }
  return null;
}

export function normalizeImageMime(type: string, name = ''): string {
  const t = type.toLowerCase();
  if (t === 'image/png') return 'image/png';
  if (t === 'image/jpeg' || t === 'image/jpg') return 'image/jpeg';
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (!t && ext === 'png') return 'image/png';
  if (!t && (ext === 'jpg' || ext === 'jpeg')) return 'image/jpeg';
  return t;
}

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return `data:${mime};base64,${btoa(bin)}`;
}

/** Reject a file that is over the size limit, over the long edge, or not a PNG/JPEG. The model is not touched. */
export function assessBackground(bytes: Uint8Array, mime: string): { ok: true; image: AssessedImage } | { ok: false; reason: BackgroundReject } {
  const kind = mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpeg' : '';
  const size = kind === 'png' ? pngSize(bytes) : kind === 'jpeg' ? jpegSize(bytes) : null;
  if (!kind || !size) return { ok: false, reason: { code: 'not-image' } };
  if (bytes.byteLength > BACKGROUND_MAX_BYTES) return { ok: false, reason: { code: 'too-big', bytes: bytes.byteLength } };
  const edge = Math.max(size.width, size.height);
  if (edge > BACKGROUND_MAX_EDGE) return { ok: false, reason: { code: 'too-wide', edge } };
  return { ok: true, image: { dataUrl: bytesToDataUrl(bytes, mime), width: size.width, height: size.height } };
}

/**
 * Millimetres per image pixel. Two points `pixelDistance` apart on the picture
 * become `distanceMm` on the diagram grid. 200px and 1000mm → 5.
 */
export function calibrateScale(pixelDistance: number, distanceMm: number): number | null {
  if (!Number.isFinite(pixelDistance) || !Number.isFinite(distanceMm)) return null;
  if (pixelDistance <= 0 || distanceMm <= 0) return null;
  const scale = distanceMm / pixelDistance;
  if (!Number.isFinite(scale) || scale <= 0) return null;
  return scale;
}

export function pixelDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function finiteBox(b: DiagramBackground | undefined): b is DiagramBackground {
  if (!b) return false;
  if (typeof b.dataUrl !== 'string' || !b.dataUrl.startsWith('data:image/')) return false;
  const nums = [b.width, b.height, b.x, b.y, b.scale, b.opacity];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
  return b.width > 0 && b.height > 0 && b.scale > 0;
}

/** A missing or unreadable background is treated as none. Lock defaults to on. */
export function readDiagramBackground(p: Project): DiagramBackground | null {
  const b = p.diagramBackground;
  if (!finiteBox(b)) return null;
  const opacity = Math.min(BACKGROUND_OPACITY_MAX, Math.max(BACKGROUND_OPACITY_MIN, Math.round(b.opacity)));
  return { ...b, opacity, locked: b.locked !== false };
}

export function placeDiagramBackground(p0: Project, image: AssessedImage): CmdResult {
  if (!image.dataUrl.startsWith('data:image/png') && !image.dataUrl.startsWith('data:image/jpeg')) return no('PNG 또는 JPEG가 아닙니다');
  if (image.width < 1 || image.height < 1 || image.width > BACKGROUND_MAX_EDGE || image.height > BACKGROUND_MAX_EDGE) return no('그림 크기가 한도를 넘습니다');
  const p = clone(p0);
  const prev = readDiagramBackground(p0);
  p.diagramBackground = {
    dataUrl: image.dataUrl,
    width: image.width,
    height: image.height,
    x: prev?.x ?? 0,
    y: prev?.y ?? 0,
    scale: prev?.scale ?? 1,
    opacity: prev?.opacity ?? 100,
    locked: prev?.locked ?? true,
  };
  return ok(p);
}

export function clearDiagramBackground(p0: Project): CmdResult {
  if (!p0.diagramBackground) return no('배경 도면이 없습니다');
  const p = clone(p0);
  delete p.diagramBackground;
  return ok(p);
}

export function updateDiagramBackground(p0: Project, patch: Partial<Pick<DiagramBackground, 'x' | 'y' | 'scale' | 'opacity' | 'locked'>>): CmdResult {
  const cur = readDiagramBackground(p0);
  if (!cur) return no('배경 도면이 없습니다');
  const next: DiagramBackground = { ...cur };
  if (patch.x != null) {
    if (!Number.isFinite(patch.x)) return no('위치가 올바르지 않습니다');
    next.x = Math.round(patch.x);
  }
  if (patch.y != null) {
    if (!Number.isFinite(patch.y)) return no('위치가 올바르지 않습니다');
    next.y = Math.round(patch.y);
  }
  if (patch.scale != null) {
    if (!Number.isFinite(patch.scale) || patch.scale <= 0) return no('배율이 올바르지 않습니다');
    next.scale = patch.scale;
  }
  if (patch.opacity != null) {
    if (!Number.isFinite(patch.opacity)) return no('불투명도가 올바르지 않습니다');
    next.opacity = Math.min(BACKGROUND_OPACITY_MAX, Math.max(BACKGROUND_OPACITY_MIN, Math.round(patch.opacity)));
  }
  if (patch.locked != null) next.locked = patch.locked;
  if (next.x === cur.x && next.y === cur.y && next.scale === cur.scale && next.opacity === cur.opacity && next.locked === cur.locked) return no('변화 없음');
  const p = clone(p0);
  p.diagramBackground = next;
  return ok(p);
}
