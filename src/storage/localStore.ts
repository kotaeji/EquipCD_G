// Browser localStorage persistence (C01/Q05 prototype choice). Works when localStorage is available;
// under file:// some browsers/policies disable it → we catch and fall back to memory-only + JSON export.
import type { Project } from '../model/types';
import { parseProjectFile, serializeProject, type ParseResult } from './fileFormat';
import { applyAtomic, type TxnOp } from './txn';

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void; key(i: number): string | null; readonly length: number }

const PREFIX = 'ecd.v1.';
export const PROJECT_KEY = (id: string) => `${PREFIX}project.${id}`;
export const INDEX_KEY = `${PREFIX}index`;
const QUARANTINE_KEY = `${PREFIX}quarantine`;
export const VIEW_KEY = `${PREFIX}userView`; // user-local view settings (theme etc.) — separate from design data

export function detectStorage(): { kv: KV | null; reason?: string } {
  try {
    const ls = (globalThis as any).localStorage as KV | undefined;
    if (!ls) return { kv: null, reason: 'localStorage 없음' };
    const t = `${PREFIX}probe`;
    ls.setItem(t, '1'); ls.removeItem(t);
    return { kv: ls };
  } catch (e) {
    return { kv: null, reason: `localStorage 사용 불가 (${(e as Error).message}). file:// 실행 또는 브라우저 정책 때문일 수 있습니다` };
  }
}

export interface IndexEntry { id: string; name: string; savedAt: string; revision: number }

const isEntry = (e: unknown): e is IndexEntry => !!e && typeof e === 'object' && typeof (e as IndexEntry).id === 'string' && typeof (e as IndexEntry).name === 'string';
/** TURN-002: saved index with shape check. `ok:false` = present but unreadable/invalid → callers must not overwrite it. */
export function readIndexStrict(kv: KV): { ok: true; entries: IndexEntry[] } | { ok: false; reason: string } {
  let v: string | null;
  try { v = kv.getItem(INDEX_KEY); } catch (e) { return { ok: false, reason: `저장 목록 읽기 실패: ${(e as Error).message}` }; }
  if (v === null) return { ok: true, entries: [] };
  try { const o = JSON.parse(v); if (Array.isArray(o) && o.every(isEntry)) return { ok: true, entries: o }; } catch { /* fall through */ }
  return { ok: false, reason: '저장 목록(index)이 손상되어 있습니다 — 원문을 덮어쓰지 않았습니다' };
}
/** lenient read for display: invalid/unreadable index → [] (never throws) */
export function readIndex(kv: KV): IndexEntry[] {
  const r = readIndexStrict(kv); return r.ok ? r.entries : [];
}

export type SaveResult = { ok: true; savedAt: string } | { ok: false; reason: string };

/** body + index write ops for saving `p` (index entry moved to the top). Fails when the index is invalid (never overwritten). */
export function saveOps(kv: KV, p: Project, now = new Date()): { ok: true; ops: TxnOp[]; savedAt: string } | { ok: false; reason: string } {
  const idx = readIndexStrict(kv); if (!idx.ok) return { ok: false, reason: idx.reason };
  const savedAt = now.toISOString();
  const entries = [{ id: p.id, name: p.name, savedAt, revision: p.revision }, ...idx.entries.filter((e) => e.id !== p.id)];
  // TURN-002: no 50-entry cap — workspaces list projects from this index, so dropping old entries would hide saved projects
  return { ok: true, savedAt, ops: [{ key: PROJECT_KEY(p.id), value: serializeProject(p) }, { key: INDEX_KEY, value: JSON.stringify(entries) }] };
}

/** Save succeeds only after write + read-back verification (D02). TURN-002: body + index are written all-or-nothing. */
export function saveProject(kv: KV, p: Project, now = new Date()): SaveResult {
  try {
    let savedAt = ''; // plan is computed inside the transaction, after any interrupted one was recovered
    const t = applyAtomic(kv, `저장 ${p.id}`, () => { const o = saveOps(kv, p, now); if (o.ok) savedAt = o.savedAt; return o; }, now);
    return t.ok ? { ok: true, savedAt } : { ok: false, reason: `${t.reason} — 메모리 변경은 유지됩니다. JSON 내보내기를 사용하세요` };
  } catch (e) {
    return { ok: false, reason: `저장 실패: ${(e as Error).message} — 메모리 변경은 유지됩니다. JSON 내보내기를 사용하세요` };
  }
}

export function loadProject(kv: KV, id: string): ParseResult | { ok: false; errors: { id: string; severity: 'error'; code: string; objectId: string; message: string }[]; raw: string } {
  const raw = kv.getItem(PROJECT_KEY(id));
  if (raw === null) return { ok: false, raw: '', errors: [{ id: 'MISSING', severity: 'error', code: 'MISSING', objectId: id, message: `저장된 프로젝트 ${id}를 찾을 수 없습니다 (최근 목록만 남아 있음). 원본을 덮어쓰지 않았습니다` }] };
  return parseProjectFile(raw);
}

export function removeFromIndex(kv: KV, id: string) {
  kv.setItem(INDEX_KEY, JSON.stringify(readIndex(kv).filter((e) => e.id !== id)));
}

export interface QuarantineEntry { at: string; label: string; raw: string; errors: string[] }

/** Keep corrupt / rejected input verbatim (손상 입력 원본 보존). */
export function quarantine(kv: KV | null, entry: QuarantineEntry, memory: QuarantineEntry[]): QuarantineEntry[] {
  const list = [entry, ...memory].slice(0, 10);
  if (kv) { try { kv.setItem(QUARANTINE_KEY, JSON.stringify(list)); } catch { /* memory only */ } }
  return list;
}

export function readQuarantine(kv: KV | null): QuarantineEntry[] {
  if (!kv) return [];
  try { const v = kv.getItem(QUARANTINE_KEY); return v ? JSON.parse(v) : []; } catch { return []; }
}

export class MemoryKV implements KV {
  private m = new Map<string, string>();
  failWrites = false;
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { if (this.failWrites) throw new Error('QuotaExceededError (simulated)'); this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  get length() { return this.m.size; }
}
