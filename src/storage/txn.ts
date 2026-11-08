/**
 * TURN-002 (rev 3) — all-or-nothing writes for project body / saved index / workspace registry.
 *
 * applyAtomic(kv, label, plan):
 * 1. finish/undo any interrupted transaction FIRST (recoverJournal). If that is not possible → no change.
 * 2. call `plan()` only now, so every write is computed from data read AFTER recovery (never from an older snapshot).
 * 3. pre-check: read every original; `guards` (expected current values) must match — otherwise no change.
 * 4. write + verify a journal (originals, their hashes, hashes of the new values, checksum) BEFORE any data key changes.
 * 5. apply + read back. On failure restore the originals (verified); if that fails too the journal stays and the
 *    next transaction / next start restores them.
 *
 * recoverJournal never trusts the journal blindly: schema, key scope, duplicates, value types, hash formats, per-value
 * hashes and the checksum must all be valid AND every target key must currently hold either its original or its new
 * value. Otherwise it changes nothing, keeps the journal as it is and reports an error (all later writes stay blocked).
 */
import type { KV } from './localStore';

export const TXN_KEY = 'ecd.v1.txn';
export interface TxnOp { key: string; value: string | null } // null = remove
export interface TxnGuard { key: string; expect: string | null } // must equal the current value, else no change
export interface TxnPlan { ops: TxnOp[]; guards?: TxnGuard[] }
export type PlanResult = ({ ok: true } & TxnPlan) | { ok: false; reason: string };
interface JournalOp { key: string; before: string | null; beforeHash: string | null; after: string | null }
interface Journal { v: 1; at: string; label: string; ops: JournalOp[]; sum: string }
export type TxnResult = { ok: true } | { ok: false; reason: string; restored: boolean };

/** FNV-1a 32-bit + length — detects accidental damage/mismatch; NOT a cryptographic signature. */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${s.length}:${h.toString(16)}`;
}
const HASH_RE = /^\d{1,10}:[0-9a-f]{1,8}$/;
/** the only keys a journal may touch */
export const isDataKey = (k: string) => k === 'ecd.v1.index' || k === 'ecd.v1.workspaces' || /^ecd\.v1\.project\.[^\s]{1,200}$/.test(k);
const matches = (cur: string | null, after: string | null) => (after === null ? cur === null : cur !== null && hashText(cur) === after);
const sumOf = (j: Omit<Journal, 'sum'>) => hashText(JSON.stringify([j.v, j.at, j.label, j.ops.map((o) => [o.key, o.before, o.beforeHash, o.after])]));

function read(kv: KV, key: string): { ok: true; v: string | null } | { ok: false; reason: string } {
  try { return { ok: true, v: kv.getItem(key) }; } catch (e) { return { ok: false, reason: `${key} 읽기 실패: ${(e as Error).message}` }; }
}
function put(kv: KV, key: string, v: string | null): boolean {
  try { if (kv.getItem(key) === v) return true; if (v === null) kv.removeItem(key); else kv.setItem(key, v); return kv.getItem(key) === v; } catch { return false; }
}
function restore(kv: KV, ops: JournalOp[]): boolean {
  let ok = true;
  for (const o of [...ops].reverse()) if (!put(kv, o.key, o.before)) ok = false;
  return ok;
}

const isStrOrNull = (x: unknown): x is string | null => x === null || typeof x === 'string';
const exactKeys = (o: object, keys: string[]) => { const k = Object.keys(o).sort(); return k.length === keys.length && [...keys].sort().every((x, i) => x === k[i]); };
/** strict journal validation — returns null when anything is off */
export function parseJournal(raw: string): Journal | null {
  let j: unknown; try { j = JSON.parse(raw); } catch { return null; }
  if (!j || typeof j !== 'object' || Array.isArray(j) || !exactKeys(j, ['v', 'at', 'label', 'ops', 'sum'])) return null;
  const J = j as Journal;
  if (J.v !== 1 || typeof J.at !== 'string' || typeof J.label !== 'string' || J.label.length > 200 || typeof J.sum !== 'string') return null;
  if (!Array.isArray(J.ops) || J.ops.length < 1 || J.ops.length > 16) return null;
  const seen = new Set<string>();
  for (const o of J.ops as unknown[]) {
    if (!o || typeof o !== 'object' || Array.isArray(o) || !exactKeys(o, ['key', 'before', 'beforeHash', 'after'])) return null;
    const op = o as JournalOp;
    if (typeof op.key !== 'string' || !isDataKey(op.key) || seen.has(op.key)) return null;
    seen.add(op.key);
    if (!isStrOrNull(op.before) || !isStrOrNull(op.beforeHash) || !isStrOrNull(op.after)) return null;
    if (op.after !== null && !HASH_RE.test(op.after)) return null;
    if ((op.before === null) !== (op.beforeHash === null)) return null;
    if (op.before !== null && op.beforeHash !== hashText(op.before)) return null;
  }
  if (sumOf(J) !== J.sum) return null;
  return J;
}

/** Recover an interrupted transaction (called at start and before every new transaction). Never throws. */
export function recoverJournal(kv: KV): { ok: true; recovered: 'none' | 'committed' | 'rolled-back' } | { ok: false; reason: string } {
  try {
    const r = read(kv, TXN_KEY); if (!r.ok) return { ok: false, reason: `복구 기록 ${r.reason}` };
    if (r.v === null) return { ok: true, recovered: 'none' };
    const j = parseJournal(r.v);
    if (!j) return { ok: false, reason: '복구 기록(journal)이 손상되었거나 검증되지 않아 자동 복구하지 않았습니다 — 저장 데이터와 복구 기록은 그대로 두었고, 저장은 막아 둡니다' };
    const cur = j.ops.map((o) => read(kv, o.key));
    if (cur.some((c) => !c.ok)) return { ok: false, reason: '복구 기록의 대상 키를 읽을 수 없습니다 — 아무 것도 바꾸지 않았습니다' };
    const vals = cur.map((c) => (c as { v: string | null }).v);
    const state = j.ops.map((o, i) => (matches(vals[i], o.after) ? 'after' : vals[i] === o.before ? 'before' : 'other'));
    if (state.includes('other')) return { ok: false, reason: `복구 기록 「${j.label}」의 대상 값이 예상과 달라(다른 곳에서 바뀜) 자동 복구하지 않았습니다 — 아무 것도 바꾸지 않았습니다` };
    const committed = state.every((s) => s === 'after');
    if (!committed && !restore(kv, j.ops)) return { ok: false, reason: `「${j.label}」 중단 기록을 되돌리지 못했습니다 — 다음에 다시 시도합니다` };
    if (!put(kv, TXN_KEY, null)) return { ok: false, reason: '복구 기록을 지우지 못했습니다' };
    return { ok: true, recovered: committed ? 'committed' : 'rolled-back' };
  } catch (e) {
    return { ok: false, reason: `복구 확인 중 오류: ${(e as Error).message} — 아무 것도 바꾸지 않았습니다` };
  }
}

export function applyAtomic(kv: KV, label: string, plan: TxnPlan | (() => PlanResult), now = new Date()): TxnResult {
  try {
    const rec = recoverJournal(kv);
    if (!rec.ok) return { ok: false, reason: `이전 저장 작업 복구가 끝나지 않아 변경하지 않았습니다: ${rec.reason}`, restored: true };
    const p = typeof plan === 'function' ? plan() : ({ ok: true, ...plan } as PlanResult);
    if (!p.ok) return { ok: false, reason: p.reason, restored: true };
    const { ops, guards = [] } = p;
    const keys = new Set<string>();
    for (const o of ops) { if (!isDataKey(o.key) || keys.has(o.key)) return { ok: false, reason: `잘못된 쓰기 대상 ${o.key}`, restored: true }; keys.add(o.key); }
    for (const g of guards) {
      const r = read(kv, g.key); if (!r.ok) return { ok: false, reason: `${r.reason} — 변경하지 않았습니다`, restored: true };
      if (r.v !== g.expect) return { ok: false, reason: '저장소 내용이 이 화면이 알고 있는 상태와 다릅니다(읽기 실패 후이거나 다른 탭에서 변경됨) — 변경하지 않았습니다. 페이지를 새로 고친 뒤 다시 시도하세요', restored: true };
    }
    const jops: JournalOp[] = [];
    for (const o of ops) {
      const r = read(kv, o.key); if (!r.ok) return { ok: false, reason: `${r.reason} — 변경하지 않았습니다`, restored: true };
      jops.push({ key: o.key, before: r.v, beforeHash: r.v === null ? null : hashText(r.v), after: o.value === null ? null : hashText(o.value) });
    }
    const body = { v: 1 as const, at: now.toISOString(), label: label.slice(0, 200), ops: jops };
    const journal = JSON.stringify({ ...body, sum: sumOf(body) } satisfies Journal);
    if (!put(kv, TXN_KEY, journal)) { put(kv, TXN_KEY, null); return { ok: false, reason: '저장 공간 부족 등으로 복구 기록을 쓸 수 없어 변경하지 않았습니다', restored: true }; }
    let failed: string | null = null;
    for (const o of ops) {
      try { if (o.value === null) kv.removeItem(o.key); else kv.setItem(o.key, o.value); }
      catch (e) { failed = `${o.key}: ${(e as Error).message}`; break; }
    }
    if (!failed) for (const o of ops) { const r = read(kv, o.key); if (!r.ok || r.v !== o.value) { failed = `${o.key}: 저장 후 읽기 확인 실패`; break; } }
    if (failed) {
      const restored = restore(kv, jops);
      if (restored) { put(kv, TXN_KEY, null); return { ok: false, reason: `저장 실패 (${failed}) — 원래 상태로 되돌렸습니다`, restored }; } // a leftover journal would find every key == original → harmless
      // could not undo: if every key verifiably holds the new value the change is in fact complete — report it as done
      // (recovery would also treat it as committed), never as "failed" while it is stored
      const now2 = ops.map((o) => read(kv, o.key));
      if (now2.every((r, i) => r.ok && r.v === ops[i].value)) { put(kv, TXN_KEY, null); return { ok: true }; }
      return { ok: false, reason: `저장 실패 (${failed}) — 원래 상태로 되돌리지 못했습니다. 다음 저장 또는 다음 시작 때 복구 기록으로 자동 복구합니다. 페이지를 새로 고친 뒤 결과를 확인하세요`, restored };
    }
    put(kv, TXN_KEY, null); // if this fails: recovery sees every key == new value → committed
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `저장 처리 오류: ${(e as Error).message}`, restored: false };
  }
}
