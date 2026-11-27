/**
 * TURN-094 — named save points. One key per project in this browser.
 * Creating, renaming, and deleting a point does not write the project body, the saved index, or Undo.
 * Restoring a point is a model edit and lives in the UI, not here.
 */
import { newId } from '../model/factory';
import type { Project } from '../model/types';
import { parseProjectFile, serializeProject } from './fileFormat';
import type { KV } from './localStore';
import { applyAtomic, type TxnGuard, type TxnOp } from './txn';

export const SAVE_POINT_LIMIT = 20;
export const SAVE_POINT_NAME_MAX = 60;
export const SAVE_POINT_NOTE_MAX = 200;
export const SAVEPOINTS_KEY = (projectId: string) => `ecd.v1.savepoints.${projectId}`;

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

export interface SavePointRecord {
  id: string;
  name: string;
  note: string;
  savedAt: string;
  revision: number;
  /** Project file text (`serializeProject`). Newest record is first. */
  body: string;
}

export type SavePointRead = { ok: true; points: SavePointRecord[] } | { ok: false; reason: string };
export type SavePointFailure = { ok: false; reason: string };
export type CreateSavePointResult =
  | { ok: true; id: string; savedAt: string; revision: number; droppedId: string | null }
  | SavePointFailure;

export function normalizeSavePointName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function normalizeSavePointNote(note: string): string {
  return note.trim().replace(/\s+/g, ' ');
}

export function validateSavePointName(name: string): string | null {
  const n = normalizeSavePointName(name);
  if (!n) return '이름을 입력하세요 (공백만은 안 됩니다)';
  if (n.length > SAVE_POINT_NAME_MAX) return `이름은 ${SAVE_POINT_NAME_MAX}자 이하로 입력하세요`;
  return null;
}

export function validateSavePointNote(note: string): string | null {
  const n = normalizeSavePointNote(note);
  if (n.length > SAVE_POINT_NOTE_MAX) return `메모는 ${SAVE_POINT_NOTE_MAX}자 이하로 입력하세요`;
  return null;
}

/** Meta fields only. The project body is checked by the caller. */
export function savePointMetaError(meta: { id: string; name: string; note: string; savedAt: string; revision: number }): string | null {
  if (typeof meta.id !== 'string' || !ID_RE.test(meta.id)) return '저장 지점 ID를 읽지 못했습니다';
  const nameError = validateSavePointName(meta.name);
  if (nameError) return nameError;
  const noteError = validateSavePointNote(meta.note);
  if (noteError) return noteError;
  if (typeof meta.savedAt !== 'string' || Number.isNaN(Date.parse(meta.savedAt))) return '저장 지점 시각을 읽지 못했습니다';
  if (typeof meta.revision !== 'number' || !Number.isFinite(meta.revision)) return '저장 지점 rev 를 읽지 못했습니다';
  return null;
}

function corrupt(reason: string): SavePointFailure {
  return { ok: false, reason: `${reason} — 목록은 덮어쓰지 않았습니다` };
}

export function readSavePointRecords(kv: KV, projectId: string): SavePointRead {
  let raw: string | null;
  try { raw = kv.getItem(SAVEPOINTS_KEY(projectId)); }
  catch (e) { return { ok: false, reason: `저장 지점 목록 읽기 실패: ${(e as Error).message}` }; }
  if (raw === null) return { ok: true, points: [] };
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return corrupt('저장 지점 목록이 손상되어 있습니다'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return corrupt('저장 지점 목록이 손상되어 있습니다');
  const bag = data as { v?: unknown; points?: unknown };
  if (bag.v !== 1 || !Array.isArray(bag.points)) return corrupt('저장 지점 목록이 손상되어 있습니다');
  if (bag.points.length > SAVE_POINT_LIMIT) return corrupt(`저장 지점은 ${SAVE_POINT_LIMIT}개까지입니다`);
  const points: SavePointRecord[] = [];
  const seen = new Set<string>();
  for (const item of bag.points) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return corrupt('저장 지점 목록이 손상되어 있습니다');
    const row = item as Partial<SavePointRecord>;
    const meta = {
      id: typeof row.id === 'string' ? row.id : '',
      name: typeof row.name === 'string' ? row.name : '',
      note: typeof row.note === 'string' ? row.note : '',
      savedAt: typeof row.savedAt === 'string' ? row.savedAt : '',
      revision: typeof row.revision === 'number' ? row.revision : Number.NaN,
    };
    const metaError = savePointMetaError(meta);
    if (metaError) return corrupt(metaError);
    if (seen.has(meta.id)) return corrupt('저장 지점 ID가 겹칩니다');
    seen.add(meta.id);
    if (typeof row.body !== 'string' || !row.body) return corrupt(`저장 지점 「${normalizeSavePointName(meta.name)}」을 읽지 못했습니다`);
    const parsed = parseProjectFile(row.body);
    if (!parsed.ok) return corrupt(`저장 지점 「${normalizeSavePointName(meta.name)}」을 읽지 못했습니다`);
    points.push({
      id: meta.id,
      name: normalizeSavePointName(meta.name),
      note: normalizeSavePointNote(meta.note),
      savedAt: meta.savedAt,
      revision: meta.revision,
      body: row.body,
    });
  }
  return { ok: true, points };
}

export function savePointCount(kv: KV, projectId: string): { ok: true; count: number } | SavePointFailure {
  const read = readSavePointRecords(kv, projectId);
  if (!read.ok) return read;
  return { ok: true, count: read.points.length };
}

export function loadSavePoint(kv: KV, projectId: string, pointId: string): { ok: true; record: SavePointRecord; project: Project } | SavePointFailure {
  const read = readSavePointRecords(kv, projectId);
  if (!read.ok) return read;
  const record = read.points.find((p) => p.id === pointId);
  if (!record) return { ok: false, reason: '저장 지점을 찾지 못했습니다' };
  const parsed = parseProjectFile(record.body);
  if (!parsed.ok) return corrupt(`저장 지점 「${record.name}」을 읽지 못했습니다`);
  return { ok: true, record, project: parsed.project };
}

function encode(points: SavePointRecord[]): string {
  return JSON.stringify({
    v: 1,
    points: points.map((p) => ({
      id: p.id, name: p.name, note: p.note, savedAt: p.savedAt, revision: p.revision, body: p.body,
    })),
  });
}

/** Reject a list that this browser would not store. Does not write. */
export function packSavePoints(points: SavePointRecord[]): { ok: true; value: string } | SavePointFailure {
  if (points.length > SAVE_POINT_LIMIT) return { ok: false, reason: `저장 지점은 ${SAVE_POINT_LIMIT}개까지입니다` };
  const seen = new Set<string>();
  for (const point of points) {
    const metaError = savePointMetaError(point);
    if (metaError) return { ok: false, reason: metaError };
    if (seen.has(point.id)) return { ok: false, reason: '저장 지점 ID가 겹칩니다' };
    seen.add(point.id);
    const parsed = parseProjectFile(point.body);
    if (!parsed.ok) return { ok: false, reason: `저장 지점 「${point.name}」을 읽지 못했습니다` };
  }
  return { ok: true, value: encode(points) };
}

/** Replace one project's list. Used when a workspace bundle brings points back. A quota failure writes nothing. */
export function writeSavePointRecords(kv: KV, projectId: string, points: SavePointRecord[], now = new Date()): { ok: true } | SavePointFailure {
  const packed = points.length ? packSavePoints(points) : { ok: true as const, value: null };
  if (!packed.ok) return packed;
  const t = applyAtomic(kv, `저장 지점 가져오기 ${projectId}`, () => {
    let current: string | null;
    try { current = kv.getItem(SAVEPOINTS_KEY(projectId)); }
    catch (e) { return { ok: false as const, reason: (e as Error).message }; }
    const ops: TxnOp[] = [{ key: SAVEPOINTS_KEY(projectId), value: packed.value }];
    const guards: TxnGuard[] = [{ key: SAVEPOINTS_KEY(projectId), expect: current }];
    return { ok: true as const, ops, guards };
  }, now);
  return t.ok ? { ok: true } : { ok: false, reason: t.reason };
}

/**
 * Keep the open model as it is. At the limit, pass `dropOldest` or nothing is written.
 * The dropped point is the oldest one (last in the newest-first list).
 */
export function createSavePoint(
  kv: KV,
  project: Project,
  name: string,
  note: string,
  now = new Date(),
  opts?: { dropOldest?: boolean; id?: string },
): CreateSavePointResult {
  const nameError = validateSavePointName(name);
  if (nameError) return { ok: false, reason: nameError };
  const noteError = validateSavePointNote(note);
  if (noteError) return { ok: false, reason: noteError };
  const id = opts?.id ?? newId('sp');
  if (!ID_RE.test(id)) return { ok: false, reason: '저장 지점 ID를 만들지 못했습니다' };
  const body = serializeProject(project);
  const checked = parseProjectFile(body);
  if (!checked.ok || checked.project.id !== project.id) return { ok: false, reason: '저장 지점 형식 검사에 실패했습니다 — 모델은 그대로입니다' };
  let savedAt = '';
  let droppedId: string | null = null;
  const t = applyAtomic(kv, `저장 지점 ${project.id}`, () => {
    const cur = readSavePointRecords(kv, project.id);
    if (!cur.ok) return { ok: false as const, reason: cur.reason };
    if (cur.points.some((p) => p.id === id)) return { ok: false as const, reason: '같은 ID의 저장 지점이 있습니다 — 만들지 않았습니다' };
    let next = cur.points;
    if (next.length >= SAVE_POINT_LIMIT) {
      if (!opts?.dropOldest) return { ok: false as const, reason: `저장 지점은 ${SAVE_POINT_LIMIT}개까지입니다 — 만들지 않았습니다` };
      droppedId = next[next.length - 1]?.id ?? null;
      next = next.slice(0, SAVE_POINT_LIMIT - 1);
    }
    savedAt = now.toISOString();
    const point: SavePointRecord = {
      id,
      name: normalizeSavePointName(name),
      note: normalizeSavePointNote(note),
      savedAt,
      revision: project.revision,
      body,
    };
    const packed = packSavePoints([point, ...next]);
    if (!packed.ok) return { ok: false as const, reason: packed.reason };
    let current: string | null;
    try { current = kv.getItem(SAVEPOINTS_KEY(project.id)); }
    catch (e) { return { ok: false as const, reason: (e as Error).message }; }
    const ops: TxnOp[] = [{ key: SAVEPOINTS_KEY(project.id), value: packed.value }];
    const guards: TxnGuard[] = [{ key: SAVEPOINTS_KEY(project.id), expect: current }];
    return { ok: true as const, ops, guards };
  }, now);
  if (!t.ok) return { ok: false, reason: t.reason };
  return { ok: true, id, savedAt, revision: project.revision, droppedId };
}

/** Name and note only. The stored instant, rev, and model body stay. */
export function renameSavePoint(kv: KV, projectId: string, pointId: string, name: string, note: string, now = new Date()): { ok: true } | SavePointFailure {
  const nameError = validateSavePointName(name);
  if (nameError) return { ok: false, reason: nameError };
  const noteError = validateSavePointNote(note);
  if (noteError) return { ok: false, reason: noteError };
  const cleanName = normalizeSavePointName(name);
  const cleanNote = normalizeSavePointNote(note);
  return applyPlan(kv, projectId, `저장 지점 이름 ${projectId}`, now, (points) => {
    const index = points.findIndex((p) => p.id === pointId);
    if (index < 0) return { ok: false, reason: '저장 지점을 찾지 못했습니다' };
    const next = points.slice();
    next[index] = { ...points[index], name: cleanName, note: cleanNote };
    return { ok: true, points: next };
  });
}

export function deleteSavePoint(kv: KV, projectId: string, pointId: string, now = new Date()): { ok: true } | SavePointFailure {
  return applyPlan(kv, projectId, `저장 지점 삭제 ${projectId}`, now, (points) => {
    if (!points.some((p) => p.id === pointId)) return { ok: false, reason: '저장 지점을 찾지 못했습니다' };
    return { ok: true, points: points.filter((p) => p.id !== pointId) };
  });
}

function applyPlan(
  kv: KV,
  projectId: string,
  label: string,
  now: Date,
  change: (points: SavePointRecord[]) => { ok: true; points: SavePointRecord[] } | SavePointFailure,
): { ok: true } | SavePointFailure {
  const t = applyAtomic(kv, label, () => {
    let current: string | null;
    try { current = kv.getItem(SAVEPOINTS_KEY(projectId)); }
    catch (e) { return { ok: false as const, reason: (e as Error).message }; }
    const cur = readSavePointRecords(kv, projectId);
    if (!cur.ok) return { ok: false as const, reason: cur.reason };
    const changed = change(cur.points);
    if (!changed.ok) return { ok: false as const, reason: changed.reason };
    const packed = changed.points.length ? packSavePoints(changed.points) : { ok: true as const, value: null };
    if (!packed.ok) return { ok: false as const, reason: packed.reason };
    const ops: TxnOp[] = [{ key: SAVEPOINTS_KEY(projectId), value: packed.value }];
    const guards: TxnGuard[] = [{ key: SAVEPOINTS_KEY(projectId), expect: current }];
    return { ok: true as const, ops, guards };
  }, now);
  return t.ok ? { ok: true } : { ok: false, reason: t.reason };
}

/** The model that one Undo step restores to: same project id, revision + 1. */
export function restoredProject(current: Project, snapshot: Project): Project {
  return { ...snapshot, id: current.id, revision: current.revision + 1 };
}

/** Rewrite the project id inside a stored snapshot. The rest of the model stays. */
export function retargetSavePointBody(body: string, projectId: string): { ok: true; body: string } | SavePointFailure {
  const parsed = parseProjectFile(body);
  if (!parsed.ok) return { ok: false, reason: '저장 지점의 프로젝트를 읽지 못했습니다' };
  if (parsed.project.id === projectId) return { ok: true, body };
  return { ok: true, body: serializeProject({ ...parsed.project, id: projectId }) };
}
