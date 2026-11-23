// Evolution Lab what-if (TURN-058). Compares copies of the open model.
// Variants are not part of the project file. The runtime is only called, never changed.
import type { CmdResult } from './commands';
import type { Project, Quantity } from './types';
import { feedCountOf } from './types';
import { checkRunReadiness } from './validate';
import { createRuntime, runToEnd, start } from '../runtime/engine';
import { summarizeRun } from '../runtime/runSummary';
import { CYCLE_PENDING, describeRunInfo, formatMs, THROUGHPUT_EMPTY } from '../scene/runInfo';

/** Baseline plus at most this many variants (4 columns). */
export const MAX_LAB_VARIANTS = 3;
export const LAB_BASELINE_ID = 'baseline';
export const LAB_BASELINE_NAME = '기준';
export const LAB_APPLY_LOCK = '실행 중(또는 일시정지 중)에는 모델 편집이 차단됩니다. 초기화 후 편집하세요.';
export const LAB_STALE = '이전 rev 의 결과';

export interface LabDurationChange { actionId: string; value: number }
export interface LabTimeoutChange { actionId: string; value: number }

/** Numbers only. Structure (units, devices, sequence, flow, conditions) stays as it is. */
export interface LabVariant {
  id: string;
  name: string;
  /** Ignored when `scale` is set. */
  durations: LabDurationChange[];
  /** Multiply every Action duration. Exclusive with per-action durations. */
  scale: number | null;
  timeouts: LabTimeoutChange[];
  /** Null keeps the open model's feed count. */
  feedCount: number | null;
  /**
   * Omitted keeps the open interval.
   * Null sets 미정. A number sets that many seconds.
   */
  feedInterval?: number | null;
}

export interface LabDiffRow {
  label: string;
  from: string;
  to: string;
}

export type LabRunStatus = 'completed' | 'error' | 'blocked';

export interface LabColumn {
  id: string;
  name: string;
  kind: 'baseline' | 'variant';
  status: LabRunStatus;
  /** Engine error code, or the first readiness code. */
  code: string | null;
  detail: string;
  totalMs: number | null;
  cycleMs: number | null;
  cycleBasis: string | null;
  throughput: number | null;
  bottleneckName: string | null;
  bottleneckMs: number | null;
  longestName: string | null;
  longestMs: number | null;
}

export interface LabReport {
  modelRevision: number;
  variantKey: string;
  columns: LabColumn[];
}

export function labBasis(name: string): string {
  return `Evolution Lab 안 〈${name}〉에서`;
}

export function labVariantKey(variants: readonly LabVariant[]): string {
  return JSON.stringify(variants.map((v) => ({
    id: v.id,
    name: v.name,
    durations: v.durations,
    scale: v.scale,
    timeouts: v.timeouts,
    feedCount: v.feedCount,
    feedInterval: v.feedInterval === undefined ? null : v.feedInterval,
    feedIntervalSet: v.feedInterval !== undefined,
  })));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function qtyText(n: number | null, unit: string): string {
  if (n == null) return '미정';
  const rounded = round3(n);
  const text = Object.is(rounded, -0) ? '0' : String(rounded);
  return `${text} ${unit}`;
}

/** Write variant numbers onto a clone. Returns whether any stored number changed. */
function writeChanges(project: Project, variant: LabVariant): boolean {
  let changed = false;
  const setDuration = (actionId: string, value: number) => {
    const action = project.actions.find((a) => a.id === actionId);
    if (!action) return;
    const next = round3(value);
    if (action.duration.value !== next) changed = true;
    action.duration.value = next;
  };
  if (variant.scale != null) {
    for (const action of project.actions) {
      if (action.duration.value == null) continue;
      setDuration(action.id, action.duration.value * variant.scale);
    }
  } else {
    for (const row of variant.durations) setDuration(row.actionId, row.value);
  }
  for (const row of variant.timeouts) {
    const action = project.actions.find((a) => a.id === row.actionId);
    if (!action) continue;
    const next = round3(row.value);
    if (action.timeout.value !== next) changed = true;
    action.timeout.value = next;
  }
  const material = project.materials[0];
  if (material && variant.feedCount != null && feedCountOf(material) !== variant.feedCount) {
    changed = true;
    material.feedCount = variant.feedCount;
  }
  if (material && variant.feedInterval !== undefined && material.feedInterval.value !== variant.feedInterval) {
    changed = true;
    material.feedInterval.value = variant.feedInterval;
  }
  return changed;
}

export function labDiff(project: Project, variant: LabVariant): LabDiffRow[] {
  const next = structuredClone(project);
  writeChanges(next, variant);
  const rows: LabDiffRow[] = [];
  project.actions.forEach((prev, i) => {
    const after = next.actions[i];
    if (!after) return;
    if (prev.duration.value !== after.duration.value) {
      rows.push({ label: `${prev.name} 동작 시간`, from: qtyText(prev.duration.value, 's'), to: qtyText(after.duration.value, 's') });
    }
    if (prev.timeout.value !== after.timeout.value) {
      rows.push({ label: `${prev.name} 타임아웃`, from: qtyText(prev.timeout.value, 's'), to: qtyText(after.timeout.value, 's') });
    }
  });
  const prevM = project.materials[0];
  const nextM = next.materials[0];
  if (prevM && nextM) {
    if (feedCountOf(prevM) !== feedCountOf(nextM)) {
      rows.push({ label: '투입 개수', from: String(feedCountOf(prevM)), to: String(feedCountOf(nextM)) });
    }
    if (prevM.feedInterval.value !== nextM.feedInterval.value) {
      rows.push({ label: '투입 간격', from: qtyText(prevM.feedInterval.value, 's'), to: qtyText(nextM.feedInterval.value, 's') });
    }
  }
  return rows;
}

function stampQty(prev: Quantity, next: Quantity, note: string, at: string): void {
  if (prev.value === next.value) return;
  next.assumption = true;
  next.source = { method: 'direct-input', note };
  next.history = [...(prev.history ?? []), { at, from: prev.value, to: next.value, assumption: true, note }];
}

/** One undo step. Changed quantities become 가정 and keep the variant name as their basis. */
export function applyLabVariant(project: Project, variant: LabVariant): CmdResult {
  if (labDiff(project, variant).length === 0) return { ok: false, reason: '바꿀 값이 없습니다' };
  const next = structuredClone(project);
  writeChanges(next, variant);
  const note = labBasis(variant.name);
  const at = `rev${project.revision + 1}`;
  project.actions.forEach((prev, i) => {
    const action = next.actions[i];
    if (!action) return;
    stampQty(prev.duration, action.duration, note, at);
    stampQty(prev.timeout, action.timeout, note, at);
  });
  const prevM = project.materials[0];
  const nextM = next.materials[0];
  if (prevM && nextM) {
    stampQty(prevM.feedInterval, nextM.feedInterval, note, at);
    if (feedCountOf(prevM) !== feedCountOf(nextM)) {
      const line = `${note} 투입 개수 ${feedCountOf(prevM)} → ${feedCountOf(nextM)}`;
      if (!next.assumptionsNote.includes(line)) next.assumptionsNote.push(line);
    }
  }
  next.revision = project.revision + 1;
  return { ok: true, project: next };
}

function parseClock(text: string): number | null {
  const matched = /^(\d+):(\d{2})\.(\d{3})$/.exec(text);
  if (!matched) return null;
  return Number(matched[1]) * 60000 + Number(matched[2]) * 1000 + Number(matched[3]);
}

function blank(id: string, name: string, kind: LabColumn['kind'], status: LabRunStatus, code: string | null, detail: string): LabColumn {
  return {
    id, name, kind, status, code, detail,
    totalMs: null, cycleMs: null, cycleBasis: null, throughput: null,
    bottleneckName: null, bottleneckMs: null, longestName: null, longestMs: null,
  };
}

function columnOf(project: Project, id: string, name: string, kind: LabColumn['kind']): LabColumn {
  const ready = checkRunReadiness(project);
  if (!ready.ok) {
    const detail = ready.blockers.map((b) => `${b.code} ${b.message}`).join(' / ');
    return blank(id, name, kind, 'blocked', ready.blockers[0]?.code ?? null, detail);
  }
  const rt = runToEnd(start(createRuntime(project, `lab-${id}`)));
  const state = rt.state;
  if (state.status !== 'completed' && state.status !== 'error') {
    return blank(id, name, kind, 'error', 'NOT_RUN', '실행이 끝나지 않았습니다');
  }
  const info = describeRunInfo(project, state);
  const summary = summarizeRun(project, state);
  const done = state.status === 'completed';
  const throughput = Number(info.throughputText);
  return {
    id,
    name,
    kind,
    status: state.status,
    code: state.status === 'error' ? state.error?.code ?? null : null,
    detail: state.status === 'error' ? (state.error?.message ?? '') : '',
    totalMs: state.timeMs,
    cycleMs: done && info.cycleText !== CYCLE_PENDING ? parseClock(info.cycleText) : null,
    cycleBasis: done ? info.metricBasis : null,
    throughput: done && info.throughputText !== THROUGHPUT_EMPTY && Number.isFinite(throughput) ? throughput : null,
    bottleneckName: info.bottleneck?.name ?? null,
    bottleneckMs: info.bottleneck ? parseClock(info.bottleneck.timeText) : null,
    longestName: summary.longest?.name ?? null,
    longestMs: summary.longest?.elapsedMs ?? null,
  };
}

function scenarioOf(project: Project, variant: LabVariant | null): Project {
  const next = structuredClone(project);
  if (variant) writeChanges(next, variant);
  return next;
}

/** Run the baseline and each variant to the end. Does not write `project`. */
export function runLab(project: Project, variants: readonly LabVariant[]): LabReport {
  const columns = [
    columnOf(scenarioOf(project, null), LAB_BASELINE_ID, LAB_BASELINE_NAME, 'baseline'),
    ...variants.map((variant) => columnOf(scenarioOf(project, variant), variant.id, variant.name, 'variant')),
  ];
  return { modelRevision: project.revision, variantKey: labVariantKey(variants), columns };
}

/** Shown difference of total virtual time against the baseline column. */
export function formatDelta(ms: number, baseMs: number): string {
  const delta = ms - baseMs;
  if (delta === 0) return '0 (0%)';
  const sign = delta < 0 ? '−' : '+';
  const body = formatMs(Math.abs(delta));
  if (baseMs === 0) return `${sign}${body}`;
  const pct = Math.abs((delta / baseMs) * 100).toFixed(1);
  return `${sign}${body} (${sign}${pct}%)`;
}

export function formatLabMs(ms: number): string {
  return formatMs(ms);
}
