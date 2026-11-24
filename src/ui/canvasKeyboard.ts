// TURN-084. Keyboard traversal, nudge steps, and link targets for the diagram.
// Model edits stay in commands.ts. This file only decides what the key means.

import type { Project } from '../model/types';

export const NUDGE_GRID = 10;
export const NUDGE_LARGE = 50;
export const NUDGE_FINE = 1;
/** One undo for arrow keys released within this window of each other. */
export const NUDGE_GAP_MS = 500;
export const NUDGE_LABEL = '방향키 이동';

export const LOCKED_NUDGE = '위치 잠금된 Unit은 움직이지 않습니다';
/** Same sentence as a drag that starts while a run is active. */
export const RUN_CANVAS_BLOCKED = '실행 중에는 배치 이동(모델 편집)이 차단됩니다. 선택·보기만 가능합니다.';
export const NO_DEVICE = '이 Unit 안에 Device 가 없습니다';
export const NEED_UNIT = 'Unit 하나를 고르세요';
export const NEED_DEVICE = 'Device 를 고르세요';
export const START_OUT = '출력(out) 포트에서 시작하세요';
export const NO_FLOW_TARGET = '연결할 다른 Unit이 없습니다';
export const NO_SIGNAL_TARGET = '연결할 입력 포트가 없습니다';
export const FLOW_START = '물류 연결: 도착 Unit을 클릭하세요';
export const SIGNAL_START = '신호 연결: 도착 입력(in) 포트를 클릭하세요';

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;
export const REVEAL_MARGIN = 24;

export interface KeyBits {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export type CanvasKeyPlan =
  | { type: 'pass' }
  | { type: 'tab'; dir: 1 | -1 }
  | { type: 'enter' }
  | { type: 'esc' }
  | { type: 'nudge'; dx: number; dy: number }
  | { type: 'flow' }
  | { type: 'signal' }
  | { type: 'zoom'; dir: 1 | -1 | 0 };

export type DiagramCursor =
  | { level: 'unit'; id: string }
  | { level: 'device'; unitId: string; id: string };

export type DiagramLink =
  | { kind: 'flow'; fromId: string; targetId: string }
  | { kind: 'signal'; fromSignalId: string; targetSignalId: string; deviceId: string };

export interface DiagramNav {
  cursor: DiagramCursor | null;
  link: DiagramLink | null;
}

export interface NudgeBurst {
  ids: string[];
  dx: number;
  dy: number;
  /** Project before the first key of this burst. Later keys replace that one edit. */
  base: Project;
  /** Set when the arrow key goes up. Null while the key is still down. */
  upAt: number | null;
}

export function nudgeStep(shift: boolean, alt: boolean): number {
  if (alt) return NUDGE_FINE;
  if (shift) return NUDGE_LARGE;
  return NUDGE_GRID;
}

export function arrowDelta(key: string, step: number): { dx: number; dy: number } | null {
  if (key === 'ArrowLeft') return { dx: -step, dy: 0 };
  if (key === 'ArrowRight') return { dx: step, dy: 0 };
  if (key === 'ArrowUp') return { dx: 0, dy: -step };
  if (key === 'ArrowDown') return { dx: 0, dy: step };
  return null;
}

/** `+` / `=` zoom in, `-` zoom out, `0` fit. Shift is already folded into the key. */
export function zoomByKey(key: string): 1 | -1 | 0 | null {
  if (key === '+' || key === '=' || key === 'Add') return 1;
  if (key === '-' || key === '_' || key === 'Subtract') return -1;
  if (key === '0') return 0;
  return null;
}

/** The diagram under the key, when the key is not on a control inside it. */
export function diagramTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  if (target.closest('button, input, textarea, select, a')) return null;
  const host = target.closest('.rf-host');
  if (!(host instanceof HTMLElement)) return null;
  if (host.closest('[hidden]')) return null;
  return host;
}

export function planCanvasKey(e: KeyBits): CanvasKeyPlan {
  if (e.ctrlKey || e.metaKey) return { type: 'pass' };
  if (e.key === 'Tab') return { type: 'tab', dir: e.shiftKey ? -1 : 1 };
  if (e.key === 'Enter') return { type: 'enter' };
  if (e.key === 'Escape') return { type: 'esc' };
  const delta = arrowDelta(e.key, nudgeStep(e.shiftKey, e.altKey));
  if (delta) return { type: 'nudge', ...delta };
  if (e.altKey) return { type: 'pass' };
  const zoom = zoomByKey(e.key);
  if (zoom !== null) return { type: 'zoom', dir: zoom };
  const letter = e.key.length === 1 ? e.key.toLowerCase() : '';
  if (letter === 'l') return { type: 'flow' };
  if (letter === 's') return { type: 'signal' };
  return { type: 'pass' };
}

export function nextZoom(zoom: number, dir: 1 | -1): number {
  const raw = dir > 0 ? zoom + 0.1 : zoom - 0.1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +raw.toFixed(2)));
}

export function readingOrder<T extends { id: string; x: number; y: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function orderedUnitIds(project: Project): string[] {
  return readingOrder(project.units.map((u) => ({ id: u.id, x: u.layout.x, y: u.layout.y }))).map((u) => u.id);
}

export function orderedDeviceIds(project: Project, unitId: string): string[] {
  const rows = project.devices.filter((d) => d.unitId === unitId).map((d) => ({ id: d.id, x: d.layout.x, y: d.layout.y }));
  return readingOrder(rows).map((d) => d.id);
}

export function orderedDeviceIdsAll(project: Project): string[] {
  return readingOrder(project.devices.map((d) => ({ id: d.id, x: d.layout.x, y: d.layout.y }))).map((d) => d.id);
}

/** `current` null starts at the first item (or the last, when going backward). */
export function cycle(ids: string[], current: string | null, dir: 1 | -1): string | null {
  if (!ids.length) return null;
  const at = current == null ? -1 : ids.indexOf(current);
  if (at < 0) return dir === 1 ? ids[0] : ids[ids.length - 1];
  return ids[(at + dir + ids.length) % ids.length];
}

export function cursorPlace(unitName: string, deviceName?: string | null): string {
  return deviceName ? `${unitName} › ${deviceName}` : unitName;
}

export function movedPlace(label: string, x: number, y: number): string {
  return `${label} (${Math.round(x)}, ${Math.round(y)})`;
}

export function linkPlace(kind: 'flow' | 'signal', from: string, to: string): string {
  return `${kind === 'flow' ? '물류 연결' : '신호 연결'}: ${from} → ${to}`;
}

export function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((id, i) => id === b[i]);
}

/** A burst stays open until 0.5s after the key is released. */
export function burstOpen(burst: NudgeBurst | null, ids: string[], now: number, gap = NUDGE_GAP_MS): boolean {
  if (!burst || !sameIds(burst.ids, ids)) return false;
  if (burst.upAt == null) return true;
  return now - burst.upAt < gap;
}

export function outputSignalIds(project: Project, deviceId: string): string[] {
  return project.signals.filter((s) => s.deviceId === deviceId && s.direction === 'out').map((s) => s.id);
}

export function inputSignalIds(project: Project, exceptDeviceId: string): string[] {
  const rank = new Map(orderedDeviceIdsAll(project).map((id, i) => [id, i]));
  return project.signals
    .filter((s) => s.direction === 'in' && s.deviceId !== exceptDeviceId)
    .sort((a, b) => (rank.get(a.deviceId) ?? 0) - (rank.get(b.deviceId) ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((s) => s.id);
}

export interface Rect { id: string; x: number; y: number; w: number; h: number }

function contains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/**
 * The other Unit under the device center after a nudge.
 * Still inside the parent, or in the gap between Units, returns null.
 */
export function crossingUnit(units: Rect[], parentId: string, x: number, y: number, w: number, h: number, dx: number, dy: number): string | null {
  const cx = x + dx + w / 2;
  const cy = y + dy + h / 2;
  const parent = units.find((u) => u.id === parentId);
  if (parent && contains(parent, cx, cy)) return null;
  for (let i = units.length - 1; i >= 0; i--) {
    const u = units[i];
    if (u.id !== parentId && contains(u, cx, cy)) return u.id;
  }
  return null;
}

export function panToReveal(
  vp: { x: number; y: number; zoom: number },
  node: { x: number; y: number; w: number; h: number },
  pane: { w: number; h: number },
  margin = REVEAL_MARGIN,
): { x: number; y: number } | null {
  if (pane.w <= margin * 2 || pane.h <= margin * 2) return null;
  const z = vp.zoom > 0 ? vp.zoom : 1;
  const left = vp.x + node.x * z;
  const top = vp.y + node.y * z;
  const width = node.w * z;
  const height = node.h * z;
  let dx = 0;
  let dy = 0;
  if (left < margin) dx = margin - left;
  else if (left + Math.min(width, pane.w - margin * 2) > pane.w - margin) dx = (pane.w - margin) - (left + Math.min(width, pane.w - margin * 2));
  if (top < margin) dy = margin - top;
  else if (top + Math.min(height, pane.h - margin * 2) > pane.h - margin) dy = (pane.h - margin) - (top + Math.min(height, pane.h - margin * 2));
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return null;
  return { x: vp.x + dx, y: vp.y + dy };
}

export type DiagramEffect =
  | { type: 'none' }
  | { type: 'cursor'; cursor: DiagramCursor; place: string; focusId: string }
  | { type: 'link'; cursor: DiagramCursor; link: DiagramLink; place: string; focusId: string; toast: string; mode: 'flow' | 'signal'; connectFrom: string }
  | { type: 'commit-link'; link: DiagramLink; cursor: DiagramCursor; place: string }
  | { type: 'cancel-link'; cursor: DiagramCursor | null; place: string }
  | { type: 'esc-top' }
  | { type: 'nudge'; ids: string[]; dx: number; dy: number; note?: string }
  | { type: 'refuse'; place: string; toast: string }
  | { type: 'zoom'; dir: 1 | -1 | 0 };

function unitOf(project: Project, id: string) {
  return project.units.find((u) => u.id === id);
}
function deviceOf(project: Project, id: string) {
  return project.devices.find((d) => d.id === id);
}

function placeOf(project: Project, cursor: DiagramCursor): string {
  if (cursor.level === 'unit') return unitOf(project, cursor.id)?.name ?? cursor.id;
  const unit = unitOf(project, cursor.unitId);
  const dev = deviceOf(project, cursor.id);
  return cursorPlace(unit?.name ?? cursor.unitId, dev?.name ?? cursor.id);
}

function flowLinkPlace(project: Project, link: Extract<DiagramLink, { kind: 'flow' }>): string {
  return linkPlace('flow', unitOf(project, link.fromId)?.name ?? link.fromId, unitOf(project, link.targetId)?.name ?? link.targetId);
}

function signalLinkPlace(project: Project, link: Extract<DiagramLink, { kind: 'signal' }>): string {
  const from = project.signals.find((s) => s.id === link.fromSignalId);
  const to = project.signals.find((s) => s.id === link.targetSignalId);
  return linkPlace('signal', from?.name ?? link.fromSignalId, to?.name ?? link.targetSignalId);
}

function signalFocus(project: Project, signalId: string): string {
  return project.signals.find((s) => s.id === signalId)?.deviceId ?? signalId;
}

function selectedUnitId(project: Project, selection: string[]): string | null {
  if (selection.length !== 1) return null;
  if (unitOf(project, selection[0])) return selection[0];
  return null;
}

function selectedDevice(project: Project, selection: string[]) {
  if (selection.length !== 1) return undefined;
  return deviceOf(project, selection[0]);
}

function moveIds(project: Project, nav: DiagramNav, selection: string[]): string[] {
  if (nav.link) return [];
  if (nav.cursor) return [nav.cursor.id];
  return selection.filter((id) => unitOf(project, id) || deviceOf(project, id));
}

/** What one diagram key should do. `locked` is a running or paused simulation. */
export function diagramEffect(plan: CanvasKeyPlan, nav: DiagramNav, project: Project, selection: string[], locked: boolean): DiagramEffect {
  if (plan.type === 'pass') return { type: 'none' };
  if (plan.type === 'zoom') return { type: 'zoom', dir: plan.dir };
  if (plan.type === 'esc') {
    if (nav.link?.kind === 'flow') {
      const cursor: DiagramCursor = { level: 'unit', id: nav.link.fromId };
      return { type: 'cancel-link', cursor, place: placeOf(project, cursor) };
    }
    if (nav.link?.kind === 'signal') {
      const dev = deviceOf(project, nav.link.deviceId);
      const cursor: DiagramCursor = { level: 'device', unitId: dev?.unitId ?? '', id: nav.link.deviceId };
      return { type: 'cancel-link', cursor, place: placeOf(project, cursor) };
    }
    if (nav.cursor?.level === 'device') {
      const cursor: DiagramCursor = { level: 'unit', id: nav.cursor.unitId };
      return { type: 'cursor', cursor, place: placeOf(project, cursor), focusId: cursor.id };
    }
    return { type: 'esc-top' };
  }
  if (plan.type === 'tab') {
    const flowLink = nav.link?.kind === 'flow' ? nav.link : null;
    if (flowLink) {
      const ids = orderedUnitIds(project).filter((id) => id !== flowLink.fromId);
      const targetId = cycle(ids, flowLink.targetId, plan.dir);
      if (!targetId) return { type: 'refuse', place: NO_FLOW_TARGET, toast: NO_FLOW_TARGET };
      const link: DiagramLink = { kind: 'flow', fromId: flowLink.fromId, targetId };
      const cursor: DiagramCursor = { level: 'unit', id: flowLink.fromId };
      return { type: 'link', cursor, link, place: flowLinkPlace(project, link), focusId: targetId, toast: '', mode: 'flow', connectFrom: flowLink.fromId };
    }
    if (nav.link?.kind === 'signal') {
      const ids = inputSignalIds(project, nav.link.deviceId);
      const targetSignalId = cycle(ids, nav.link.targetSignalId, plan.dir);
      if (!targetSignalId) return { type: 'refuse', place: NO_SIGNAL_TARGET, toast: NO_SIGNAL_TARGET };
      const link: DiagramLink = { ...nav.link, targetSignalId };
      const dev = deviceOf(project, nav.link.deviceId);
      const cursor: DiagramCursor = { level: 'device', unitId: dev?.unitId ?? '', id: nav.link.deviceId };
      return { type: 'link', cursor, link, place: signalLinkPlace(project, link), focusId: signalFocus(project, targetSignalId), toast: '', mode: 'signal', connectFrom: nav.link.fromSignalId };
    }
    if (nav.cursor?.level === 'device') {
      const ids = orderedDeviceIds(project, nav.cursor.unitId);
      const id = cycle(ids, nav.cursor.id, plan.dir);
      if (!id) return { type: 'refuse', place: NO_DEVICE, toast: NO_DEVICE };
      const cursor: DiagramCursor = { level: 'device', unitId: nav.cursor.unitId, id };
      return { type: 'cursor', cursor, place: placeOf(project, cursor), focusId: id };
    }
    const ids = orderedUnitIds(project);
    const current = nav.cursor?.level === 'unit'
      ? nav.cursor.id
      : selectedUnitId(project, selection) ?? selectedDevice(project, selection)?.unitId ?? null;
    const id = cycle(ids, current, plan.dir);
    if (!id) return { type: 'refuse', place: NEED_UNIT, toast: NEED_UNIT };
    const cursor: DiagramCursor = { level: 'unit', id };
    return { type: 'cursor', cursor, place: placeOf(project, cursor), focusId: id };
  }
  if (plan.type === 'enter') {
    if (nav.link?.kind === 'flow') {
      const cursor: DiagramCursor = { level: 'unit', id: nav.link.fromId };
      return { type: 'commit-link', link: nav.link, cursor, place: placeOf(project, cursor) };
    }
    if (nav.link?.kind === 'signal') {
      const dev = deviceOf(project, nav.link.deviceId);
      const cursor: DiagramCursor = { level: 'device', unitId: dev?.unitId ?? '', id: nav.link.deviceId };
      return { type: 'commit-link', link: nav.link, cursor, place: placeOf(project, cursor) };
    }
    if (nav.cursor?.level === 'device') return { type: 'none' };
    const unitId = nav.cursor?.level === 'unit' ? nav.cursor.id : selectedUnitId(project, selection);
    if (!unitId) return { type: 'refuse', place: NEED_UNIT, toast: NEED_UNIT };
    const ids = orderedDeviceIds(project, unitId);
    if (!ids.length) return { type: 'refuse', place: NO_DEVICE, toast: NO_DEVICE };
    const cursor: DiagramCursor = { level: 'device', unitId, id: ids[0] };
    return { type: 'cursor', cursor, place: placeOf(project, cursor), focusId: ids[0] };
  }
  if (plan.type === 'flow' || plan.type === 'signal') {
    if (locked) return { type: 'refuse', place: RUN_CANVAS_BLOCKED, toast: RUN_CANVAS_BLOCKED };
  }
  if (plan.type === 'flow') {
    const unitId = nav.cursor?.level === 'unit' ? nav.cursor.id : selectedUnitId(project, selection);
    if (!unitId) return { type: 'refuse', place: NEED_UNIT, toast: NEED_UNIT };
    const targetId = orderedUnitIds(project).find((id) => id !== unitId) ?? null;
    if (!targetId) return { type: 'refuse', place: NO_FLOW_TARGET, toast: NO_FLOW_TARGET };
    const link: DiagramLink = { kind: 'flow', fromId: unitId, targetId };
    const cursor: DiagramCursor = { level: 'unit', id: unitId };
    return { type: 'link', cursor, link, place: flowLinkPlace(project, link), focusId: targetId, toast: FLOW_START, mode: 'flow', connectFrom: unitId };
  }
  if (plan.type === 'signal') {
    const dev = nav.cursor?.level === 'device' ? deviceOf(project, nav.cursor.id) : selectedDevice(project, selection);
    if (!dev) return { type: 'refuse', place: NEED_DEVICE, toast: NEED_DEVICE };
    const outs = outputSignalIds(project, dev.id);
    if (!outs.length) return { type: 'refuse', place: START_OUT, toast: START_OUT };
    const ins = inputSignalIds(project, dev.id);
    if (!ins.length) return { type: 'refuse', place: NO_SIGNAL_TARGET, toast: NO_SIGNAL_TARGET };
    const link: DiagramLink = { kind: 'signal', fromSignalId: outs[0], targetSignalId: ins[0], deviceId: dev.id };
    const cursor: DiagramCursor = { level: 'device', unitId: dev.unitId, id: dev.id };
    return { type: 'link', cursor, link, place: signalLinkPlace(project, link), focusId: signalFocus(project, ins[0]), toast: SIGNAL_START, mode: 'signal', connectFrom: outs[0] };
  }
  if (plan.type === 'nudge') {
    if (locked) return { type: 'refuse', place: RUN_CANVAS_BLOCKED, toast: RUN_CANVAS_BLOCKED };
    const ids = moveIds(project, nav, selection);
    if (!ids.length) return { type: 'none' };
    const lockedIds = ids.filter((id) => unitOf(project, id)?.positionLocked === true);
    const movable = ids.filter((id) => !lockedIds.includes(id));
    if (!movable.length) return { type: 'refuse', place: LOCKED_NUDGE, toast: LOCKED_NUDGE };
    return { type: 'nudge', ids: movable, dx: plan.dx, dy: plan.dy, note: lockedIds.length ? LOCKED_NUDGE : undefined };
  }
  return { type: 'none' };
}

/** The node a keyboard move should keep on screen. */
export function nudgeFocusId(effect: DiagramEffect): string | null {
  if (effect.type === 'nudge') return effect.ids[0] ?? null;
  if (effect.type === 'cursor' || effect.type === 'link') return effect.focusId;
  return null;
}
