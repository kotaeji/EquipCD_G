// TURN-070 — who confirmed a value, and when. The log is part of the project, so one undo removes the row.
import { getAssetById } from '../assets/library';
import { formatLocalClock } from '../ui/localClock';
import type {
  Confirmation, ConfirmationEntry, ConfirmationTarget, GapReviewEntry, Project, Quantity, QuantityRef, Signal,
} from './types';

export const CONFIRMER_NAME_MAX = 60;
export const CONFIRMER_REQUIRED = '확인자 이름은 비울 수 없습니다';

export const Q_ASSUMPTION = '가정';
export const Q_CONFIRMED = '확인';

/** Passed into a confirming command. `at` defaults to now. Omitted stamp keeps the old behavior (no row). */
export interface ConfirmStamp { by: string; at?: string }

export function normalizeConfirmerName(raw: string): string {
  return raw.trim().slice(0, CONFIRMER_NAME_MAX);
}

export type StampReady = { by: string; at: string } | 'skip' | 'bad';

/** `skip` = caller did not ask to record. `bad` = a stamp was passed with an empty name. */
export function takeStamp(stamp: ConfirmStamp | undefined, now: () => string = () => new Date().toISOString()): StampReady {
  if (stamp === undefined) return 'skip';
  const by = normalizeConfirmerName(stamp.by);
  if (!by) return 'bad';
  const at = stamp.at?.trim() ? stamp.at.trim() : now();
  return { by, at };
}

export function assumptionWord(assumption: boolean): string {
  return assumption ? Q_ASSUMPTION : Q_CONFIRMED;
}

export function confirmationWord(c: Confirmation): string {
  return { unconfirmed: '미확인', confirmed: '확인됨', rejected: '거절', needsRecheck: '재확인' }[c];
}

export function gapStatusWord(s: GapReviewEntry['status']): string {
  return { open: '열림', needsHuman: '사람 확인 필요', humanConfirmed: '사람 확인', resolved: '해결', hidden: '숨김' }[s];
}

export function addressWord(s: Signal['addressStatus']): string {
  return { unassigned: '미지정', assumed: '가정', confirmed: '확인' }[s];
}

export function quantityConfirmationChange(from: boolean, to: boolean): boolean {
  return from !== to;
}

export function interlockConfirmationChange(from: Confirmation, to: Confirmation): boolean {
  if (from === to) return false;
  return to === 'confirmed' || from === 'confirmed';
}

export function candidateConfirmationChange(from: Confirmation, to: Confirmation): boolean {
  if (from === to) return false;
  const notable = (s: Confirmation) => s === 'confirmed' || s === 'rejected';
  return notable(from) || notable(to);
}

export function gapConfirmationChange(from: GapReviewEntry['status'], to: GapReviewEntry['status']): boolean {
  if (from === to) return false;
  return from === 'humanConfirmed' || to === 'humanConfirmed';
}

export function addressConfirmationChange(from: Signal['addressStatus'], to: Signal['addressStatus']): boolean {
  if (from === to) return false;
  return from === 'confirmed' || to === 'confirmed';
}

export function targetKey(t: ConfirmationTarget): string {
  if (t.kind === 'quantity') {
    const r = t.ref;
    if (r.kind === 'action') return `quantity:action:${r.id}:${r.field}`;
    if (r.kind === 'device') return `quantity:device:${r.id}:${r.key}`;
    if (r.kind === 'position') return `quantity:position:${r.id}`;
    if (r.kind === 'unitCap') return `quantity:unit:${r.id}:${r.field}`;
    if (r.kind === 'material') return `quantity:material:${r.id}:${r.field}`;
    return `quantity:step:${r.id}`;
  }
  return `${t.kind}:${t.id}`;
}

export function sameTarget(a: ConfirmationTarget, b: ConfirmationTarget): boolean {
  return targetKey(a) === targetKey(b);
}

export function quantityOf(p: Project, ref: QuantityRef): Quantity | null {
  if (ref.kind === 'device') return p.devices.find((d) => d.id === ref.id)?.properties[ref.key] ?? null;
  if (ref.kind === 'action') return p.actions.find((a) => a.id === ref.id)?.[ref.field] ?? null;
  if (ref.kind === 'position') return p.positions.find((x) => x.id === ref.id)?.value ?? null;
  if (ref.kind === 'unitCap') return p.units.find((u) => u.id === ref.id)?.capacity[ref.field] ?? null;
  if (ref.kind === 'stepTimeout') return p.sequence.steps.find((s) => s.id === ref.id)?.timeoutOverride ?? null;
  const m = p.materials.find((x) => x.id === ref.id);
  if (!m) return null;
  if (ref.field === 'weight') return m.weight;
  if (ref.field === 'feedInterval') return m.feedInterval;
  return m.size[ref.field];
}

const FIELD_WORD: Record<string, string> = {
  duration: '동작 시간', timeout: '타임아웃', maxMaterials: '수용 개수', maxWeight: '허용 무게',
  weight: '무게', feedInterval: '투입 간격', w: '가로', l: '세로', h: '높이',
};

export function quantityName(p: Project, ref: QuantityRef): string {
  if (ref.kind === 'device') {
    const d = p.devices.find((x) => x.id === ref.id);
    const label = (d ? getAssetById(d.definitionRef.assetId)?.properties.find((pd) => pd.key === ref.key)?.label : undefined) ?? ref.key;
    return `${d?.name ?? ref.id} ${label}`;
  }
  if (ref.kind === 'action') {
    const a = p.actions.find((x) => x.id === ref.id);
    return `${a?.name ?? ref.id} ${FIELD_WORD[ref.field]}`;
  }
  if (ref.kind === 'position') return p.positions.find((x) => x.id === ref.id)?.name ?? ref.id;
  if (ref.kind === 'unitCap') {
    const u = p.units.find((x) => x.id === ref.id);
    return `${u?.name ?? ref.id} ${FIELD_WORD[ref.field]}`;
  }
  if (ref.kind === 'stepTimeout') return `${p.sequence.steps.find((s) => s.id === ref.id)?.name ?? ref.id} 단계 타임아웃`;
  const m = p.materials.find((x) => x.id === ref.id);
  return `${m?.name ?? ref.id} ${FIELD_WORD[ref.field]}`;
}

export function appendConfirmation(p: Project, entry: ConfirmationEntry): void {
  p.confirmationLog = [...(p.confirmationLog ?? []), { ...entry, by: normalizeConfirmerName(entry.by) }];
}

export function sortedConfirmationLog(log: ConfirmationEntry[] | undefined): ConfirmationEntry[] {
  return (log ?? []).map((e, i) => ({ e, i })).sort((a, b) => (a.e.at < b.e.at ? -1 : a.e.at > b.e.at ? 1 : a.i - b.i)).map((x) => x.e);
}

function entryMarksConfirmed(e: ConfirmationEntry): boolean {
  if (e.target.kind === 'quantity' || e.target.kind === 'signalAddress') return e.to === Q_CONFIRMED;
  if (e.target.kind === 'gap') return e.to === '사람 확인';
  return e.to === '확인됨';
}

/** Latest confirming row for this target, when the value is still in the confirmed state. */
export function confirmedCaption(log: ConfirmationEntry[] | undefined, target: ConfirmationTarget, active: boolean): string | null {
  if (!active) return null;
  for (let i = (log?.length ?? 0) - 1; i >= 0; i--) {
    const e = log![i];
    if (!sameTarget(e.target, target)) continue;
    if (!entryMarksConfirmed(e)) return null;
    const when = formatLocalClock(e.at) || e.at;
    return `확인: ${e.by} · ${when}`;
  }
  return null;
}

export function confirmationClock(at: string): string {
  return formatLocalClock(at) || at;
}

/** A quantity target is live while its object is still in the model. */
export function quantityTargetLive(p: Project, ref: QuantityRef): boolean {
  if (ref.kind === 'device') return !!p.devices.find((d) => d.id === ref.id)?.properties[ref.key];
  if (ref.kind === 'action') return p.actions.some((a) => a.id === ref.id);
  if (ref.kind === 'position') return p.positions.some((x) => x.id === ref.id);
  if (ref.kind === 'unitCap') return p.units.some((u) => u.id === ref.id);
  if (ref.kind === 'material') return p.materials.some((m) => m.id === ref.id);
  return p.sequence.steps.some((s) => s.id === ref.id) || (p.substationSequences ?? []).some((q) => q.steps.some((s) => s.id === ref.id));
}

export function targetLive(p: Project, t: ConfirmationTarget): boolean {
  if (t.kind === 'quantity') return quantityTargetLive(p, t.ref);
  if (t.kind === 'interlock') return p.constraints.some((k) => k.id === t.id);
  if (t.kind === 'candidate') return p.candidates.some((c) => c.id === t.id);
  if (t.kind === 'gap') return Object.prototype.hasOwnProperty.call(p.gapReview, t.id);
  return p.signals.some((s) => s.id === t.id);
}

function isTarget(v: unknown): v is ConfirmationTarget {
  if (!v || typeof v !== 'object') return false;
  const o = v as ConfirmationTarget;
  if (o.kind === 'quantity') {
    const ref = o.ref;
    if (!ref || typeof ref !== 'object' || typeof (ref as { id?: unknown }).id !== 'string') return false;
    return ref.kind === 'device' || ref.kind === 'action' || ref.kind === 'position' || ref.kind === 'unitCap' || ref.kind === 'material' || ref.kind === 'stepTimeout';
  }
  return (o.kind === 'interlock' || o.kind === 'candidate' || o.kind === 'gap' || o.kind === 'signalAddress') && typeof o.id === 'string';
}

function isEntry(v: unknown): v is ConfirmationEntry {
  if (!v || typeof v !== 'object') return false;
  const o = v as ConfirmationEntry;
  return typeof o.at === 'string' && typeof o.by === 'string' && typeof o.name === 'string'
    && typeof o.from === 'string' && typeof o.to === 'string' && isTarget(o.target);
}

/** Drop a missing, empty, or unreadable log so older files stay as they were. */
export function normalizeProjectConfirmation(p: Project): Project {
  const raw = (p as { confirmationLog?: unknown }).confirmationLog;
  if (raw === undefined) return p;
  const next = { ...p };
  delete next.confirmationLog;
  if (!Array.isArray(raw)) return next;
  const log = raw.filter(isEntry).map((e) => ({ ...e, by: normalizeConfirmerName(e.by) })).filter((e) => e.by);
  if (!log.length) return next;
  return { ...p, confirmationLog: log };
}

/** Omit an empty list so the file matches a project that never had the field. */
export function projectForFile(p: Project): Project {
  if (!p.confirmationLog?.length) {
    if (p.confirmationLog === undefined) return p;
    const next = { ...p };
    delete next.confirmationLog;
    return next;
  }
  return p;
}
