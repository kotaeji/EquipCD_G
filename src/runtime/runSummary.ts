// Station run summary (TURN-018). Reads a finished or in-progress RuntimeState.
// Does not advance time and does not write the engine.
import type { Project } from '../model/types';
import type { RuntimeState, StepRecord } from './engine';

export type RunStepPhase = 'pending' | 'active' | 'done' | 'error';

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
  /** Last finished step's end − first started step's start. Null until a step has ended. */
  totalMs: number | null;
  /** Steps that reached 완료 or 오류. */
  finishedCount: number;
  totalCount: number;
  /**
   * The step with the greatest elapsed time.
   * A tie keeps the earlier step in sequence order.
   * Null when no step has both a start and an end.
   */
  longest: LongestStep | null;
}

const PHASES: readonly RunStepPhase[] = ['pending', 'active', 'done', 'error'];

function phaseOf(status: StepRecord['status'] | undefined): RunStepPhase {
  return status && (PHASES as readonly string[]).includes(status) ? status : 'pending';
}

/** Summarize one Station sequence run. `state` null means the run has not started. */
export function summarizeRun(p: Project, state: RuntimeState | null): RunSummary {
  const records = new Map<string, StepRecord>();
  if (state) for (const rec of state.steps) records.set(rec.stepId, rec);

  const steps: RunStepSummary[] = p.sequence.steps.map((step) => {
    const rec = records.get(step.id);
    const status = phaseOf(rec?.status);
    const startMs = rec?.startMs ?? null;
    const ended = status === 'done' || status === 'error';
    const endMs = ended && rec?.endMs !== undefined ? rec.endMs : null;
    const elapsedMs = startMs !== null && endMs !== null ? endMs - startMs : null;
    return { stepId: step.id, name: step.name, status, startMs, endMs, elapsedMs };
  });

  const started = steps.filter((s) => s.startMs !== null);
  const finished = steps.filter((s) => s.endMs !== null);
  const firstStart = started.length > 0 ? Math.min(...started.map((s) => s.startMs as number)) : null;
  const lastEnd = finished.length > 0 ? finished[finished.length - 1].endMs : null;
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
    longest,
  };
}
