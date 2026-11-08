/**
 * TURN-002 — Workspaces: a local management unit inside this browser's storage (NOT a file-system folder).
 * Registry key `ecd.v1.workspaces`. Project bodies (`ecd.v1.project.<id>`) and the saved index (`ecd.v1.index`)
 * keep their existing format; workspace membership is never written into project files.
 */
import { parseProjectFile } from './fileFormat';
import { INDEX_KEY, PROJECT_KEY, readIndex, readIndexStrict, saveOps, type IndexEntry, type KV } from './localStore';
import type { Project } from '../model/types';
import { applyAtomic, recoverJournal, type TxnGuard, type TxnOp } from './txn';

export const WS_KEY = 'ecd.v1.workspaces';
/** prefix for backups of an unreadable registry: `${WS_CORRUPT_KEY}.<time>` — never overwritten */
export const WS_CORRUPT_KEY = `${WS_KEY}.corrupt`;
export const WS_FORMAT_VERSION = 1;
export const DEFAULT_WS_ID = 'ws-default';
export const DEFAULT_WS_NAME = '기본 Workspace';
export const NAME_MAX = 60;

export interface Workspace { id: string; name: string; createdAt: string; updatedAt: string; projectIds: string[] }
export interface WorkspaceRegistry { formatVersion: 1; activeId: string; workspaces: Workspace[] }
export type Res<T> = ({ ok: true } & T) | { ok: false; reason: string };

export const normalizeName = (s: string) => s.trim().replace(/\s+/g, ' ');
const nameKey = (s: string) => normalizeName(s).toLocaleLowerCase();

/** blank / too long / duplicate (case-insensitive, after normalising spaces) → reason; otherwise null */
export function validateName(name: string, others: string[]): string | null {
  const n = normalizeName(name);
  if (!n) return '이름을 입력하세요 (공백만은 안 됩니다)';
  if (n.length > NAME_MAX) return `이름은 ${NAME_MAX}자 이하로 입력하세요`;
  if (others.some((o) => nameKey(o) === nameKey(n))) return `같은 이름 「${n}」이(가) 이미 있습니다`;
  return null;
}

/** "base", "base 2", "base 3"… — first name not used in `others` */
export function uniqueName(base: string, others: string[]): string {
  if (!validateName(base, others)) return normalizeName(base);
  for (let i = 2; ; i++) { const c = `${normalizeName(base)} ${i}`; if (!validateName(c, others)) return c; }
}

function freshRegistry(projectIds: string[], now: string): WorkspaceRegistry {
  return { formatVersion: 1, activeId: DEFAULT_WS_ID, workspaces: [{ id: DEFAULT_WS_ID, name: DEFAULT_WS_NAME, createdAt: now, updatedAt: now, projectIds: [...projectIds] }] };
}

export function parseRegistry(raw: string | null): WorkspaceRegistry | null {
  if (raw === null) return null;
  try {
    const o = JSON.parse(raw);
    if (!o || o.formatVersion !== 1 || typeof o.activeId !== 'string' || !Array.isArray(o.workspaces) || o.workspaces.length === 0) return null;
    for (const w of o.workspaces) if (!w || typeof w.id !== 'string' || typeof w.name !== 'string' || !normalizeName(w.name) || !Array.isArray(w.projectIds) || w.projectIds.some((x: unknown) => typeof x !== 'string')) return null;
    if (new Set(o.workspaces.map((w: Workspace) => w.id)).size !== o.workspaces.length) return null;
    return { formatVersion: 1, activeId: o.activeId, workspaces: o.workspaces.map((w: Workspace) => ({ id: w.id, name: w.name, createdAt: String(w.createdAt ?? ''), updatedAt: String(w.updatedAt ?? ''), projectIds: [...w.projectIds] })) };
  } catch { return null; }
}

/** orphans → default (or first) workspace, duplicates → first owner only, invalid activeId → first workspace. Pure. */
export function reconcile(reg: WorkspaceRegistry, savedIds: string[]): WorkspaceRegistry {
  const seen = new Set<string>();
  const workspaces = reg.workspaces.map((w) => ({ ...w, projectIds: w.projectIds.filter((id) => (seen.has(id) ? false : (seen.add(id), true))) }));
  const orphans = savedIds.filter((id) => !seen.has(id));
  if (orphans.length) { const home = workspaces.find((w) => w.id === DEFAULT_WS_ID) ?? workspaces[0]; home.projectIds = [...home.projectIds, ...orphans]; }
  const activeId = workspaces.some((w) => w.id === reg.activeId) ? reg.activeId : workspaces[0].id;
  return { formatVersion: 1, activeId, workspaces };
}

export interface EnsureResult { reg: WorkspaceRegistry; migrated: boolean; persisted: boolean; warnings: string[] }

const backupKeys = (kv: KV) => { const out: string[] = []; try { for (let i = 0; i < kv.length; i++) { const k = kv.key(i); if (k && k.startsWith(`${WS_CORRUPT_KEY}.`)) out.push(k); } } catch { /* ignore */ } return out; };

/**
 * Before anything replaces WS_KEY: if it currently holds an unreadable registry, it must already be backed up
 * (same text under a `.corrupt.<time>` key) or be backed up now, verified. Returns false → caller must not write WS_KEY.
 */
export function ensureRegistryBackup(kv: KV, now = new Date()): { ok: true; backedUp: boolean } | { ok: false; reason: string } {
  try {
    const raw = kv.getItem(WS_KEY);
    if (raw === null || parseRegistry(raw)) return { ok: true, backedUp: false };
    for (const k of backupKeys(kv)) if (kv.getItem(k) === raw) return { ok: true, backedUp: true };
    let key = `${WS_CORRUPT_KEY}.${now.getTime()}`; for (let i = 1; kv.getItem(key) !== null; i++) key = `${WS_CORRUPT_KEY}.${now.getTime()}-${i}`;
    try { kv.setItem(key, raw); if (kv.getItem(key) !== raw) throw new Error('읽기 확인 불일치'); }
    catch (e) { try { if (kv.getItem(key) !== raw) kv.removeItem(key); } catch { /* ignore */ } return { ok: false, reason: `손상된 Workspace 목록 원문을 백업하지 못했습니다 (${(e as Error).message}) — 원문을 덮어쓰지 않았습니다` }; }
    return { ok: true, backedUp: true };
  } catch (e) {
    return { ok: false, reason: `Workspace 목록 백업 확인 중 읽기 실패 (${(e as Error).message}) — 원문을 덮어쓰지 않았습니다` };
  }
}

/** compare-before-write: the stored registry must still be exactly the one this session derived its copy from */
const regGuard = (prev: WorkspaceRegistry): TxnGuard => ({ key: WS_KEY, expect: JSON.stringify(prev) });

/**
 * Non-destructive migration + startup recovery/reconcile. Writes only WS_KEY (+ a registry backup key); never
 * touches project bodies or the saved index (except finishing/undoing an interrupted transaction from the journal).
 * Unreadable registry/index → memory-only for this session, originals left exactly as they were. Idempotent.
 */
export function ensureWorkspaces(kv: KV, now = new Date()): EnsureResult {
  try { return ensureInner(kv, now); }
  catch (e) { return { reg: freshRegistry([], now.toISOString()), migrated: false, persisted: false, warnings: [`저장소 확인 중 오류 (${(e as Error).message}) — 이번에는 메모리에서만 관리하며 저장하지 않습니다. 저장된 데이터는 그대로입니다`] }; }
}
function ensureInner(kv: KV, now: Date): EnsureResult {
  const warnings: string[] = [];
  const rec = recoverJournal(kv);
  if (!rec.ok) warnings.push(`${rec.reason} (이번 세션은 저장·Workspace 변경이 막힙니다)`);
  else if (rec.recovered === 'rolled-back') warnings.push('지난번에 끝나지 않은 저장 작업을 원래 상태로 되돌렸습니다');
  const idx = readIndexStrict(kv);
  if (!idx.ok) warnings.push(idx.reason);
  const savedIds = idx.ok ? idx.entries.map((e) => e.id) : [];
  // memory-only session: the returned registry differs from what is stored, so every later guarded write is refused
  const memoryOnly = (reg: WorkspaceRegistry, why: string): EnsureResult => { warnings.push(why); return { reg: reconcile(reg, savedIds), migrated: false, persisted: false, warnings }; };
  let raw: string | null;
  try { raw = kv.getItem(WS_KEY); } catch (e) { return memoryOnly(freshRegistry([], now.toISOString()), `Workspace 목록을 읽지 못했습니다 (${(e as Error).message}) — 이번에는 메모리에서만 관리하며 저장된 목록은 그대로 둡니다`); }
  let reg = parseRegistry(raw);
  let migrated = false;
  if (!reg) {
    if (raw !== null) {
      const b = ensureRegistryBackup(kv, now);
      if (!b.ok) return memoryOnly(freshRegistry([], now.toISOString()), `${b.reason}. 이번에는 메모리에서만 관리합니다 (프로젝트 데이터는 그대로)`);
      warnings.push('Workspace 목록을 읽을 수 없어 기본 Workspace로 다시 만들었습니다 (원문은 별도 키에 보관, 프로젝트 데이터는 그대로)');
    }
    reg = freshRegistry([], now.toISOString()); migrated = true;
  }
  reg = reconcile(reg, savedIds);
  const text = JSON.stringify(reg);
  let persisted = rec.ok;
  if (text !== raw && rec.ok) {
    const w = applyAtomic(kv, 'Workspace 목록 정리', { ops: [{ key: WS_KEY, value: text }], guards: [{ key: WS_KEY, expect: raw }] }, now);
    if (!w.ok) { persisted = false; warnings.push(`Workspace 목록 저장 실패 (${w.reason}) — 이번에는 메모리에서만 관리합니다. 프로젝트 데이터는 그대로입니다`); }
  }
  return { reg, migrated, persisted, warnings };
}

/**
 * Write `next` only if the stored registry is still exactly `prev` (the registry this session holds). A session that
 * started memory-only (read failure, unreadable registry, failed recovery) or a registry changed by another tab can
 * therefore never replace the stored one.
 */
export function writeRegistry(kv: KV, next: WorkspaceRegistry, prev: WorkspaceRegistry): Res<object> {
  const t = applyAtomic(kv, 'Workspace 목록', { ops: [{ key: WS_KEY, value: JSON.stringify(next) }], guards: [regGuard(prev)] });
  return t.ok ? { ok: true } : { ok: false, reason: t.reason };
}

export const activeWs = (reg: WorkspaceRegistry) => reg.workspaces.find((w) => w.id === reg.activeId) ?? reg.workspaces[0];
export const ownerOf = (reg: WorkspaceRegistry, projectId: string) => reg.workspaces.find((w) => w.projectIds.includes(projectId));

/** saved projects of a workspace, most recent first (index order); ids without a saved index entry are skipped */
export function listProjects(kv: KV, reg: WorkspaceRegistry, wsId: string): IndexEntry[] {
  const w = reg.workspaces.find((x) => x.id === wsId); if (!w) return [];
  const ids = new Set(w.projectIds);
  return readIndex(kv).filter((e) => ids.has(e.id));
}

const stamp = (now: Date) => now.toISOString();
export function newWsId(now = new Date()) { return `ws-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`; }

export function createWorkspace(reg: WorkspaceRegistry, name: string, now = new Date(), id = newWsId(now)): Res<{ reg: WorkspaceRegistry; ws: Workspace }> {
  const err = validateName(name, reg.workspaces.map((w) => w.name)); if (err) return { ok: false, reason: err };
  if (reg.workspaces.some((w) => w.id === id)) return { ok: false, reason: 'ID 충돌 — 다시 시도하세요' };
  const ws: Workspace = { id, name: normalizeName(name), createdAt: stamp(now), updatedAt: stamp(now), projectIds: [] };
  return { ok: true, ws, reg: { ...reg, workspaces: [...reg.workspaces, ws] } };
}

export function renameWorkspace(reg: WorkspaceRegistry, id: string, name: string, now = new Date()): Res<{ reg: WorkspaceRegistry }> {
  const w = reg.workspaces.find((x) => x.id === id); if (!w) return { ok: false, reason: 'Workspace를 찾을 수 없습니다' };
  const err = validateName(name, reg.workspaces.filter((x) => x.id !== id).map((x) => x.name)); if (err) return { ok: false, reason: err };
  return { ok: true, reg: { ...reg, workspaces: reg.workspaces.map((x) => (x.id === id ? { ...x, name: normalizeName(name), updatedAt: stamp(now) } : x)) } };
}

/** why this workspace cannot be deleted (null = allowed). savedCount = saved projects that really exist in it. */
export function deleteBlockReason(reg: WorkspaceRegistry, id: string, savedCount: number): string | null {
  if (!reg.workspaces.some((w) => w.id === id)) return 'Workspace를 찾을 수 없습니다';
  if (reg.workspaces.length <= 1) return '마지막 Workspace는 삭제할 수 없습니다';
  if (reg.activeId === id) return '현재 Workspace는 삭제할 수 없습니다 — 다른 Workspace로 전환한 뒤 삭제하세요';
  if (savedCount > 0) return `저장 프로젝트 ${savedCount}개가 있어 삭제할 수 없습니다 — 빈 Workspace만 삭제됩니다 (프로젝트는 함께 지우지 않음)`;
  return null;
}

export function deleteWorkspace(reg: WorkspaceRegistry, id: string, savedCount: number): Res<{ reg: WorkspaceRegistry }> {
  const why = deleteBlockReason(reg, id, savedCount); if (why) return { ok: false, reason: why };
  return { ok: true, reg: { ...reg, workspaces: reg.workspaces.filter((w) => w.id !== id) } };
}

export function setActive(reg: WorkspaceRegistry, id: string): Res<{ reg: WorkspaceRegistry }> {
  if (!reg.workspaces.some((w) => w.id === id)) return { ok: false, reason: 'Workspace를 찾을 수 없습니다' };
  return { ok: true, reg: { ...reg, activeId: id } };
}

/** add membership (no-op if already there). Refuses when the id belongs to another workspace. */
export function attachProject(reg: WorkspaceRegistry, wsId: string, projectId: string): Res<{ reg: WorkspaceRegistry }> {
  const owner = ownerOf(reg, projectId);
  if (owner && owner.id !== wsId) return { ok: false, reason: `같은 ID의 프로젝트가 Workspace 「${owner.name}」에 저장되어 있습니다` };
  if (owner) return { ok: true, reg };
  return { ok: true, reg: { ...reg, workspaces: reg.workspaces.map((w) => (w.id === wsId ? { ...w, projectIds: [...w.projectIds, projectId] } : w)) } };
}

export const detachProject = (reg: WorkspaceRegistry, projectId: string): WorkspaceRegistry =>
  ({ ...reg, workspaces: reg.workspaces.map((w) => ({ ...w, projectIds: w.projectIds.filter((x) => x !== projectId) })) });

/**
 * Save `p` into workspace `wsId`: body + index + (membership if new) in ONE transaction. Refuses an id owned by another
 * workspace. On failure nothing is changed (or it is restored at next start) and the registry passed in stays valid.
 */
export function saveProjectInWorkspace(kv: KV, reg: WorkspaceRegistry, wsId: string, p: Project, now = new Date()): Res<{ reg: WorkspaceRegistry; savedAt: string }> {
  const a = attachProject(reg, wsId, p.id); if (!a.ok) return a;
  let savedAt = '';
  // plan computed inside the transaction → after recovery, from fresh index (never a pre-recovery snapshot)
  const t = applyAtomic(kv, `저장 ${p.id}`, () => {
    const s = saveOps(kv, p, now); if (!s.ok) return s;
    savedAt = s.savedAt;
    const ops: TxnOp[] = [...s.ops];
    if (a.reg !== reg) ops.push({ key: WS_KEY, value: JSON.stringify(a.reg) });
    return { ok: true, ops, guards: [regGuard(reg)] };
  }, now);
  return t.ok ? { ok: true, reg: a.reg, savedAt } : { ok: false, reason: t.reason };
}

/** rename a CLOSED saved project: body + index rewritten together (revision +1, verified, all-or-nothing). Undo does not apply. */
export function renameSavedProject(kv: KV, id: string, name: string, now = new Date()): Res<{ savedAt: string; revision: number }> {
  let savedAt = ''; let revision = 0;
  const t = applyAtomic(kv, `이름 변경 ${id}`, () => {
    let raw: string | null; try { raw = kv.getItem(PROJECT_KEY(id)); } catch (e) { return { ok: false, reason: (e as Error).message }; }
    if (raw === null) return { ok: false, reason: '저장된 프로젝트를 찾을 수 없습니다' };
    const r = parseProjectFile(raw);
    if (!r.ok) return { ok: false, reason: `저장본을 읽을 수 없어 이름을 바꾸지 않았습니다: ${r.errors[0]?.message ?? ''}` };
    const p = { ...r.project, name: normalizeName(name), revision: r.project.revision + 1 };
    const s = saveOps(kv, p, now); if (!s.ok) return s;
    savedAt = s.savedAt; revision = p.revision;
    return { ok: true, ops: s.ops, guards: [{ key: PROJECT_KEY(id), expect: raw }] };
  }, now);
  return t.ok ? { ok: true, savedAt, revision } : { ok: false, reason: t.reason };
}

/** Permanently delete a CLOSED saved project: index entry + body + membership in ONE transaction. Callers must block open projects. */
export function deleteSavedProject(kv: KV, reg: WorkspaceRegistry, id: string): Res<{ reg: WorkspaceRegistry }> {
  const next = detachProject(reg, id);
  const t = applyAtomic(kv, `삭제 ${id}`, () => {
    const idx = readIndexStrict(kv); if (!idx.ok) return { ok: false, reason: idx.reason };
    return { ok: true, guards: [regGuard(reg)], ops: [
      { key: INDEX_KEY, value: JSON.stringify(idx.entries.filter((e) => e.id !== id)) },
      { key: PROJECT_KEY(id), value: null },
      { key: WS_KEY, value: JSON.stringify(next) },
    ] };
  });
  return t.ok ? { ok: true, reg: next } : { ok: false, reason: t.reason };
}
