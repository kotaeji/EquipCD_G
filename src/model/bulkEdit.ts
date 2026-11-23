// TURN-074. One revision edits many Action durations, timeouts, and assumption flags.
// TURN-070 confirmation history is not on main, so the record stays on Quantity.history
// and source.note, the same shape as setQuantity.

import type { CmdResult } from './commands';
import type { Project, Quantity } from './types';

export const BULK_SOURCE_NOTE = '일괄 편집';

export type BulkNumberMode = 'set' | 'scale' | 'add';
export type BulkStatusOp = 'assume' | 'confirm' | 'unset';
export type QtyStatus = 'assumed' | 'confirmed' | 'unset';

export interface BulkNumberOp {
  mode: BulkNumberMode;
  /** set: seconds. scale: multiplier. add: seconds, negative subtracts. */
  amount: number;
}

export interface BulkTimeoutRule {
  /** timeout = duration × factor + margin. Duration is the value after the duration op in this same request. */
  factor: number;
  margin: number;
}

export interface BulkEditRequest {
  actionIds: readonly string[];
  duration?: BulkNumberOp | null;
  timeout?: BulkNumberOp | null;
  /** When set, this replaces `timeout`. */
  timeoutRule?: BulkTimeoutRule | null;
  /** After the numbers. unset clears both values. assume/confirm touch only values that stay non-null. */
  status?: BulkStatusOp | null;
}

export interface BulkPreviewRow {
  actionId: string;
  actionName: string;
  unitName: string;
  deviceName: string;
  durationFrom: string;
  durationTo: string;
  timeoutFrom: string;
  timeoutTo: string;
  statusFrom: string;
  statusTo: string;
  warnings: string[];
  /** Written on apply. Warned rows and unchanged rows stay as they are. */
  apply: boolean;
}

export interface BulkPreview {
  rows: BulkPreviewRow[];
  applicable: number;
  warned: number;
  unchanged: number;
}

const QTY_STATUS_WORD: Record<QtyStatus, string> = {
  assumed: '가정',
  confirmed: '확인',
  unset: '미정',
};

export function quantityStatus(q: Quantity): QtyStatus {
  if (q.value === null) return 'unset';
  return q.assumption ? 'assumed' : 'confirmed';
}

export function formatSeconds(value: number | null): string {
  if (value === null) return '미정';
  const n = Object.is(value, -0) ? 0 : value;
  return `${n} s`;
}

export function statusLine(duration: Pick<Quantity, 'value' | 'assumption'>, timeout: Pick<Quantity, 'value' | 'assumption'>): string {
  return `동작 ${QTY_STATUS_WORD[quantityStatus(duration as Quantity)]} · 타임아웃 ${QTY_STATUS_WORD[quantityStatus(timeout as Quantity)]}`;
}

/** Same rejects as TURN-045 time fields: not a number, or negative. Empty is not 미정 here. 더하기 / 빼기 may be negative. */
export function bulkOperandError(raw: string, mode: BulkNumberMode | 'factor' | 'margin'): string | null {
  const t = raw.trim();
  if (t === '') return '숫자를 입력하세요';
  if (mode === 'add') {
    if (t === '-' || t === '.' || t === '-.' || t === '+') return '숫자를 입력하세요';
    if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(t)) return '숫자가 아닙니다';
    if (!Number.isFinite(Number(t))) return '숫자가 아닙니다';
    return null;
  }
  if (t.startsWith('-')) return /^-(?:\d+(?:\.\d+)?|\.\d+)?$/.test(t) ? '음수는 허용되지 않습니다' : '숫자가 아닙니다';
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(t)) return '숫자가 아닙니다';
  if (!Number.isFinite(Number(t))) return '숫자가 아닙니다';
  return null;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function judged(value: number): { value: number; warning: string | null } {
  if (!Number.isFinite(value)) return { value, warning: '숫자가 아닙니다' };
  if (value < 0) return { value, warning: '음수' };
  if (value === 0) return { value, warning: '0' };
  return { value, warning: null };
}

function nextNumber(current: number | null, op: BulkNumberOp): { value: number | null; warning: string | null } {
  if (!Number.isFinite(op.amount)) return { value: current, warning: '숫자가 아닙니다' };
  if (op.mode === 'set') return judged(op.amount);
  if (current === null) return { value: null, warning: '미정이라 계산할 수 없습니다' };
  const raw = op.mode === 'scale' ? current * op.amount : current + op.amount;
  return judged(round3(raw));
}

function fieldWarning(field: string, warning: string | null): string | null {
  if (!warning) return null;
  return `${field} ${warning}`;
}

interface Planned {
  actionId: string;
  actionName: string;
  unitName: string;
  deviceName: string;
  prevDuration: Quantity;
  prevTimeout: Quantity;
  nextDuration: { value: number | null; assumption: boolean };
  nextTimeout: { value: number | null; assumption: boolean };
  warnings: string[];
  changed: boolean;
}

function assumptionOf(value: number | null, assumption: boolean, status: BulkStatusOp | null | undefined): boolean {
  if (!status || status === 'unset' || value === null) return assumption;
  return status === 'assume';
}

function plan(project: Project, request: BulkEditRequest): Planned[] {
  const wanted = new Set(request.actionIds);
  const out: Planned[] = [];
  for (const action of project.actions) {
    if (!wanted.has(action.id)) continue;
    const unit = project.units.find((u) => u.id === action.unitId);
    const device = project.devices.find((d) => d.id === action.deviceId);
    let durationValue = action.duration.value;
    let timeoutValue = action.timeout.value;
    const warnings: string[] = [];

    if (request.duration) {
      const next = nextNumber(action.duration.value, request.duration);
      durationValue = next.value;
      const msg = fieldWarning('동작 시간', next.warning);
      if (msg) warnings.push(msg);
    }

    if (request.timeoutRule) {
      const { factor, margin } = request.timeoutRule;
      if (!Number.isFinite(factor) || !Number.isFinite(margin)) warnings.push('타임아웃 숫자가 아닙니다');
      else if (durationValue === null) warnings.push('동작 시간이 미정이라 타임아웃을 계산할 수 없습니다');
      else {
        const next = judged(round3(durationValue * factor + margin));
        timeoutValue = next.value;
        const msg = fieldWarning('타임아웃', next.warning);
        if (msg) warnings.push(msg);
      }
    } else if (request.timeout) {
      const next = nextNumber(action.timeout.value, request.timeout);
      timeoutValue = next.value;
      const msg = fieldWarning('타임아웃', next.warning);
      if (msg) warnings.push(msg);
    }

    if (request.status === 'unset') {
      durationValue = null;
      timeoutValue = null;
      warnings.length = 0;
    } else if (durationValue !== null && timeoutValue !== null && timeoutValue < durationValue && (request.duration || request.timeout || request.timeoutRule)) {
      warnings.push('타임아웃이 동작 시간보다 짧습니다');
    }

    const nextDuration = { value: durationValue, assumption: assumptionOf(durationValue, action.duration.assumption, request.status) };
    const nextTimeout = { value: timeoutValue, assumption: assumptionOf(timeoutValue, action.timeout.assumption, request.status) };
    const changed = action.duration.value !== nextDuration.value
      || action.duration.assumption !== nextDuration.assumption
      || action.timeout.value !== nextTimeout.value
      || action.timeout.assumption !== nextTimeout.assumption;
    out.push({
      actionId: action.id,
      actionName: action.name,
      unitName: unit?.name ?? action.unitId,
      deviceName: device?.name ?? action.deviceId,
      prevDuration: action.duration,
      prevTimeout: action.timeout,
      nextDuration,
      nextTimeout,
      warnings,
      changed,
    });
  }
  return out;
}

function toPreview(row: Planned): BulkPreviewRow {
  return {
    actionId: row.actionId,
    actionName: row.actionName,
    unitName: row.unitName,
    deviceName: row.deviceName,
    durationFrom: formatSeconds(row.prevDuration.value),
    durationTo: formatSeconds(row.nextDuration.value),
    timeoutFrom: formatSeconds(row.prevTimeout.value),
    timeoutTo: formatSeconds(row.nextTimeout.value),
    statusFrom: statusLine(row.prevDuration, row.prevTimeout),
    statusTo: statusLine(row.nextDuration, row.nextTimeout),
    warnings: row.warnings,
    apply: row.warnings.length === 0 && row.changed,
  };
}

export function previewBulkEdit(project: Project, request: BulkEditRequest): BulkPreview {
  const rows = plan(project, request).map(toPreview);
  return {
    rows,
    applicable: rows.filter((r) => r.apply).length,
    warned: rows.filter((r) => r.warnings.length > 0).length,
    unchanged: rows.filter((r) => r.warnings.length === 0 && !r.apply).length,
  };
}

function writeQty(prev: Quantity, next: { value: number | null; assumption: boolean }, at: string): Quantity {
  if (prev.value === next.value && prev.assumption === next.assumption) return prev;
  return {
    ...prev,
    value: next.value,
    assumption: next.assumption,
    source: { method: 'direct-input', note: BULK_SOURCE_NOTE },
    history: [...(prev.history ?? []), { at, from: prev.value, to: next.value, assumption: next.assumption, note: BULK_SOURCE_NOTE }],
  };
}

/** One revision. Warned rows are left untouched. Nothing to write is a rejection, so revision stays. */
export function applyBulkEdit(project: Project, request: BulkEditRequest): CmdResult {
  const planned = plan(project, request);
  const writable = planned.filter((row) => row.warnings.length === 0 && row.changed);
  if (writable.length === 0) {
    const reason = planned.some((row) => row.warnings.length > 0) ? '경고가 있는 값은 적용되지 않습니다' : '바꿀 값이 없습니다';
    return { ok: false, reason };
  }
  const next = structuredClone(project);
  const at = `rev${project.revision + 1}`;
  const byId = new Map(planned.map((row) => [row.actionId, row]));
  for (const action of next.actions) {
    const row = byId.get(action.id);
    if (!row || row.warnings.length > 0 || !row.changed) continue;
    action.duration = writeQty(action.duration, row.nextDuration, at);
    action.timeout = writeQty(action.timeout, row.nextTimeout, at);
  }
  next.revision = project.revision + 1;
  return { ok: true, project: next };
}
