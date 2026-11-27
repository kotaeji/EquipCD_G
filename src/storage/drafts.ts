/**
 * TURN-047 — browser-local draft (임시 저장). Separate from the saved project body and the saved index.
 * A draft never changes `ecd.v1.project.*`, `ecd.v1.index`, or the model's revision.
 * Writes go through applyAtomic and the same file-format check as a real save.
 */
import type { Project } from '../model/types';
import { formatLocalClock } from '../ui/localClock';
import { parseProjectFile, serializeProject, type ParseResult } from './fileFormat';
import type { KV, QuarantineEntry } from './localStore';
import { applyAtomic, type TxnOp } from './txn';

export const DRAFT_DELAY_MS = 5000;
export const DRAFTS_KEY = 'ecd.v1.drafts';
export const DRAFT_KEY = (id: string) => `ecd.v1.draft.${id}`;

export interface DraftMeta { id: string; name: string; savedAt: string; revision: number }

const isMeta = (e: unknown): e is DraftMeta => !!e && typeof e === 'object'
  && typeof (e as DraftMeta).id === 'string' && (e as DraftMeta).id.length > 0
  && typeof (e as DraftMeta).name === 'string'
  && typeof (e as DraftMeta).savedAt === 'string'
  && typeof (e as DraftMeta).revision === 'number' && Number.isFinite((e as DraftMeta).revision);

export function readDraftsStrict(kv: KV): { ok: true; entries: DraftMeta[] } | { ok: false; reason: string; raw: string | null } {
  let raw: string | null;
  try { raw = kv.getItem(DRAFTS_KEY); } catch (e) { return { ok: false, reason: `임시 저장 목록 읽기 실패: ${(e as Error).message}`, raw: null }; }
  if (raw === null) return { ok: true, entries: [] };
  try {
    const o = JSON.parse(raw);
    if (Array.isArray(o) && o.every(isMeta)) return { ok: true, entries: o };
  } catch { /* fall through */ }
  return { ok: false, reason: '임시 저장 목록이 손상되어 있습니다 — 원문을 덮어쓰지 않았습니다', raw };
}

function safeGet(kv: KV, key: string): string | null | undefined {
  try { return kv.getItem(key); } catch { return undefined; }
}

/** Drafts whose body still parses. Invalid bodies are skipped, not deleted. */
export function readDraftList(kv: KV): DraftMeta[] {
  const idx = readDraftsStrict(kv);
  if (!idx.ok) return [];
  const out: DraftMeta[] = [];
  for (const e of idx.entries) {
    const raw = safeGet(kv, DRAFT_KEY(e.id));
    if (!raw) continue;
    const parsed = parseProjectFile(raw);
    if (!parsed.ok || parsed.project.id !== e.id) continue;
    out.push({ id: e.id, name: parsed.project.name, savedAt: e.savedAt, revision: parsed.project.revision });
  }
  return out;
}

export function loadDraft(kv: KV, id: string): ParseResult | { ok: false; errors: { id: string; severity: 'error'; code: string; objectId: string; message: string }[]; raw: string } {
  let raw: string | null;
  try { raw = kv.getItem(DRAFT_KEY(id)); } catch (e) {
    return { ok: false, raw: '', errors: [{ id: 'DRAFT_READ', severity: 'error', code: 'DRAFT_READ', objectId: id, message: (e as Error).message }] };
  }
  if (raw === null) return { ok: false, raw: '', errors: [{ id: 'DRAFT_MISSING', severity: 'error', code: 'DRAFT_MISSING', objectId: id, message: `임시 저장 ${id}를 찾을 수 없습니다` }] };
  return parseProjectFile(raw);
}

/**
 * Ask to recover only when the draft is a newer revision than the saved copy and not older in time.
 * No saved copy → the start screen lists it; this returns false.
 */
export function draftOffersRecovery(draft: { revision: number; savedAt: string }, saved: { revision: number; savedAt: string } | null): boolean {
  if (!saved) return false;
  if (draft.revision <= saved.revision) return false;
  if (draft.savedAt < saved.savedAt) return false;
  return true;
}

/** Local date and minute, with the zone. Empty when the timestamp cannot be read. */
export function formatClock(iso: string | null | undefined): string {
  return formatLocalClock(iso);
}

/** Work-line text. One line, no trailing separator. */
export function workTimesLabel(savedAt: string | null, draftAt: string | null, failed: boolean): string {
  const parts: string[] = [];
  const saved = formatClock(savedAt);
  if (saved) parts.push(`저장 ${saved}`);
  if (failed) parts.push('임시 저장 실패');
  else {
    const draft = formatClock(draftAt);
    if (draft) parts.push(`임시 저장 ${draft}`);
  }
  return parts.join(' · ');
}

/** Tooltip for the work line. The stored instants, still ISO (UTC). */
export function workTimesTitle(savedAt: string | null, draftAt: string | null, failed: boolean): string {
  const parts: string[] = [];
  if (savedAt) parts.push(`저장 ${savedAt}`);
  if (!failed && draftAt) parts.push(`임시 저장 ${draftAt}`);
  return parts.join(' · ');
}

export type DraftWrite = { ok: true; savedAt: string } | { ok: false; reason: string };

/** Write one draft. Does not touch the saved project, the saved index, or `project`. */
export function saveDraft(kv: KV, p: Project, now = new Date()): DraftWrite {
  const text = serializeProject(p);
  const checked = parseProjectFile(text);
  if (!checked.ok || checked.project.id !== p.id) return { ok: false, reason: '임시 저장 형식 검사에 실패했습니다 — 편집 내용은 그대로입니다' };
  let savedAt = '';
  const t = applyAtomic(kv, `임시 저장 ${p.id}`, () => {
    const idx = readDraftsStrict(kv);
    if (!idx.ok) return { ok: false as const, reason: idx.reason };
    savedAt = now.toISOString();
    const entries: DraftMeta[] = [{ id: p.id, name: p.name, savedAt, revision: p.revision }, ...idx.entries.filter((e) => e.id !== p.id)];
    const ops: TxnOp[] = [{ key: DRAFT_KEY(p.id), value: text }, { key: DRAFTS_KEY, value: JSON.stringify(entries) }];
    return { ok: true as const, ops };
  }, now);
  return t.ok ? { ok: true, savedAt } : { ok: false, reason: t.reason };
}

/** Remove one draft. No-op (and no write) when that project has no draft. */
export function discardDraft(kv: KV, id: string, now = new Date()): { ok: true } | { ok: false; reason: string } {
  let body: string | null;
  try { body = kv.getItem(DRAFT_KEY(id)); } catch (e) { return { ok: false, reason: (e as Error).message }; }
  const idx = readDraftsStrict(kv);
  if (!idx.ok) return body === null ? { ok: true } : { ok: false, reason: idx.reason };
  const listed = idx.entries.some((e) => e.id === id);
  if (body === null && !listed) return { ok: true };
  const t = applyAtomic(kv, `임시 저장 삭제 ${id}`, () => {
    const fresh = readDraftsStrict(kv);
    if (!fresh.ok) return { ok: false as const, reason: fresh.reason };
    const ops: TxnOp[] = [];
    if (kv.getItem(DRAFT_KEY(id)) !== null) ops.push({ key: DRAFT_KEY(id), value: null });
    if (fresh.entries.some((e) => e.id === id)) ops.push({ key: DRAFTS_KEY, value: JSON.stringify(fresh.entries.filter((e) => e.id !== id)) });
    if (!ops.length) return { ok: false as const, reason: '지울 임시 저장이 없습니다' };
    return { ok: true as const, ops };
  }, now);
  if (!t.ok && t.reason === '지울 임시 저장이 없습니다') return { ok: true };
  return t.ok ? { ok: true } : { ok: false, reason: t.reason };
}

/**
 * Drop draft bodies that do not parse. Their raw text is returned for the quarantine box.
 * The saved project is never read or written. A damaged draft index is left in place (not overwritten).
 */
export function sweepDrafts(kv: KV, now = new Date()): { entries: DraftMeta[]; quarantine: QuarantineEntry[] } {
  const idx = readDraftsStrict(kv);
  if (!idx.ok) {
    const quarantine = idx.raw ? [{ at: now.toLocaleString(), label: 'drafts-index', raw: idx.raw, errors: [idx.reason] }] : [];
    return { entries: [], quarantine };
  }
  const good: DraftMeta[] = [];
  const quarantine: QuarantineEntry[] = [];
  const drop: string[] = [];
  for (const e of idx.entries) {
    const raw = safeGet(kv, DRAFT_KEY(e.id));
    if (raw === undefined) continue; // could not read; leave it for next time
    if (raw === null) { drop.push(e.id); continue; }
    const parsed = parseProjectFile(raw);
    if (!parsed.ok || parsed.project.id !== e.id) {
      quarantine.push({ at: now.toLocaleString(), label: `draft:${e.id}`, raw, errors: parsed.ok ? ['프로젝트 ID가 임시 저장 키와 다릅니다'] : parsed.errors.map((err) => err.message) });
      drop.push(e.id);
      continue;
    }
    good.push({ id: e.id, name: parsed.project.name, savedAt: e.savedAt, revision: parsed.project.revision });
  }
  if (drop.length) {
    for (let i = 0; i < drop.length; i += 15) {
      const batch = drop.slice(i, i + 15);
      applyAtomic(kv, '손상된 임시 저장 격리', () => {
        const fresh = readDraftsStrict(kv);
        if (!fresh.ok) return { ok: false as const, reason: fresh.reason };
        const ops: TxnOp[] = batch.filter((id) => kv.getItem(DRAFT_KEY(id)) !== null).map((id) => ({ key: DRAFT_KEY(id), value: null }));
        ops.push({ key: DRAFTS_KEY, value: JSON.stringify(fresh.entries.filter((e) => !batch.includes(e.id))) });
        return { ok: true as const, ops };
      }, now);
    }
  }
  return { entries: good, quarantine };
}
