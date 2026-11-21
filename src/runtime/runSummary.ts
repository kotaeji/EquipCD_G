// Station run summary (TURN-018). Reads a finished or in-progress RuntimeState.
// Does not advance time and does not write the engine.
import { collectStepIds } from '../model/flow';
import type { Project } from '../model/types';
import type { RuntimeState, StepRecord } from './engine';

export type RunStepPhase = 'pending' | 'active' | 'done' | 'error' | 'skipped';

export interface RunStepSummary {
  stepId: string;
  name: string;
  status: RunStepPhase;
  /** Virtual ms. Null until the step starts. */
  startMs: number | null;
  /** Virtual ms. Null while the step is waiting or still in progress (including pause). */
  endMs: number | null;
  /** endMs − startMs. Null when either bound is missing. */
  elapsedMs: number | null;
  /** 1-based pass when the same step runs more than once. */
  pass?: number;
  /** Parallel lane or Substation sequence name. */
  lane?: string;
}

export interface LongestStep {
  stepId: string;
  name: string;
  elapsedMs: number;
}

export interface RunSummary {
  /** True when the run stopped on an engine error (timeout, unmet condition, read fail). */
  aborted: boolean;
  steps: RunStepSummary[];
  /** Latest finished end − earliest start. Null until a step has ended. For a flat sequence this is the last step's end. */
  totalMs: number | null;
  /** Steps that reached 완료 or 오류. */
  finishedCount: number;
  totalCount: number;
  /** Steps that reached 완료. Skipped steps are not included. */
  executedCount: number;
  /** Steps the branch did not take. */
  skippedCount: number;
  /**
   * The step with the greatest elapsed time.
   * A tie keeps the earlier step in sequence order.
   * Null when no step has both a start and an end.
   */
  longest: LongestStep | null;
}

const PHASES: readonly RunStepPhase[] = ['pending', 'active', 'done', 'error', 'skipped'];

function phaseOf(status: StepRecord['status'] | undefined): RunStepPhase {
  return status && (PHASES as readonly string[]).includes(status) ? status : 'pending';
}

function stepName(p: Project, stepId: string): string {
  return p.sequence.steps.find((s) => s.id === stepId)?.name
    ?? (p.substationSequences ?? []).flatMap((q) => q.steps).find((s) => s.id === stepId)?.name
    ?? stepId;
}

function rowOf(rec: StepRecord | undefined, stepId: string, name: string): RunStepSummary {
  const status = phaseOf(rec?.status);
  const startMs = rec?.startMs ?? null;
  const ended = status === 'done' || status === 'error';
  const endMs = ended && rec?.endMs !== undefined ? rec.endMs : null;
  const elapsedMs = startMs !== null && endMs !== null ? endMs - startMs : null;
  return { stepId, name, status, startMs, endMs, elapsedMs, ...(rec?.pass != null ? { pass: rec.pass } : {}), ...(rec?.lane ? { lane: rec.lane } : {}) };
}

function laneRank(lane?: string): number {
  const m = /갈래\s*(\d+)/.exec(lane ?? '');
  return m ? Number(m[1]) : 0;
}

export interface OrderableStep {
  stepId: string;
  status: string;
  startMs?: number | null;
  pass?: number;
  lane?: string;
}

/**
 * Executed rows follow start time (then lane number, then the original order).
 * Skipped and not-yet-started rows stay at their place in `flow`.
 * A flat sequence (no flow) keeps its existing order.
 */
export function orderRunRecords<T extends OrderableStep>(p: Project, rows: readonly T[]): T[] {
  if (!p.sequence.flow) return [...rows];
  const at = new Map<string, number>();
  collectStepIds(p.sequence.flow).forEach((id, i) => { if (!at.has(id)) at.set(id, i); });
  const indexOf = (r: T) => at.get(r.stepId) ?? 1_000_000;
  const placed = rows.filter((r) => r.status === 'skipped' || r.status === 'pending' || r.startMs == null);
  const executed = rows.filter((r) => r.status !== 'skipped' && r.status !== 'pending' && r.startMs != null);
  const byPlace = [...placed].sort((a, b) => indexOf(a) - indexOf(b));
  const byTime = executed.map((r, i) => ({ r, i })).sort((a, b) =>
    (a.r.startMs ?? 0) - (b.r.startMs ?? 0) || laneRank(a.r.lane) - laneRank(b.r.lane) || a.i - b.i);
  const out: T[] = [];
  let pi = 0;
  for (const { r } of byTime) {
    const ix = indexOf(r);
    while (pi < byPlace.length && indexOf(byPlace[pi]) < ix) out.push(byPlace[pi++]);
    out.push(r);
  }
  while (pi < byPlace.length) out.push(byPlace[pi++]);
  return out;
}

/** One row per step id, in sequence order. Used when the run is a flat list. */
function linearRows(p: Project, state: RuntimeState | null): RunStepSummary[] {
  const records = new Map<string, StepRecord>();
  if (state) for (const rec of state.steps) records.set(rec.stepId, rec);
  return p.sequence.steps.map((step) => rowOf(records.get(step.id), step.id, step.name));
}

function occurrenceMode(p: Project, state: RuntimeState | null): boolean {
  if (!state) return false;
  if (p.sequence.flow) return true;
  return state.steps.some((r) => r.status === 'skipped' || (r.pass ?? 1) > 1 || !!r.lane);
}

/** Summarize one Station sequence run. `state` null means the run has not started. */
export function summarizeRun(p: Project, state: RuntimeState | null): RunSummary {
  const raw: RunStepSummary[] = occurrenceMode(p, state) && state
    ? state.steps.map((rec) => rowOf(rec, rec.stepId, stepName(p, rec.stepId)))
    : linearRows(p, state);
  const steps = occurrenceMode(p, state) ? orderRunRecords(p, raw) : raw;

  const started = steps.filter((s) => s.startMs !== null);
  const finished = steps.filter((s) => s.endMs !== null);
  const firstStart = started.length > 0 ? Math.min(...started.map((s) => s.startMs as number)) : null;
  const lastEnd = finished.length > 0 ? Math.max(...finished.map((s) => s.endMs as number)) : null;
  const totalMs = firstStart !== null && lastEnd !== null ? lastEnd - firstStart : null;

  let longest: LongestStep | null = null;
  for (const step of steps) {
    if (step.elapsedMs === null) continue;
    if (!longest || step.elapsedMs > longest.elapsedMs) {
      longest = { stepId: step.stepId, name: step.name, elapsedMs: step.elapsedMs };
    }
  }

  return {
    aborted: state?.status === 'error',
    steps,
    totalMs,
    finishedCount: steps.filter((s) => s.status === 'done' || s.status === 'error').length,
    totalCount: steps.length,
    executedCount: steps.filter((s) => s.status === 'done').length,
    skippedCount: steps.filter((s) => s.status === 'skipped').length,
    longest,
  };
}
