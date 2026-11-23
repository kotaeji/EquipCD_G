// Replay a finished run up to a virtual time. The engine is deterministic and is only called.
import type { Project } from '../model/types';
import { advance, createRuntime, start, type Runtime, type RuntimeState, type StepRecord } from './engine';

/** Remember a state this often so a drag seeks at most one slice. */
export const SCRUB_CACHE_MS = 500;
/** ← / → on the time bar. */
export const SCRUB_NUDGE_MS = 100;
/** Shift+← / Shift+→ on the time bar. */
export const SCRUB_PAGE_MS = 1000;

export interface ScrubMarker {
  t: number;
  kind: 'start' | 'end' | 'error';
  stepId?: string;
  label: string;
}

export interface ScrubIndex {
  totalMs: number;
  /** States at 0, then every `SCRUB_CACHE_MS`, while the replay is still running. */
  points: Runtime[];
  /** The run that actually finished. Seeking to `totalMs` returns this object. */
  finished: Runtime;
  markers: ScrubMarker[];
}

function stepName(p: Project, stepId: string): string {
  const step = p.sequence.steps.find((s) => s.id === stepId)
    ?? (p.substationSequences ?? []).flatMap((q) => q.steps).find((s) => s.id === stepId);
  return step?.name ?? stepId;
}

function markerLabel(p: Project, rec: StepRecord, kind: ScrubMarker['kind']): string {
  const name = rec.condText || stepName(p, rec.stepId);
  if (kind === 'start') return `${name} 시작`;
  if (kind === 'error') return `${name} 오류`;
  return `${name} 끝`;
}

export function scrubMarkers(rt: Runtime): ScrubMarker[] {
  const p = rt.snapshot;
  const out: ScrubMarker[] = [];
  for (const rec of rt.state.steps) {
    if (rec.startMs != null) out.push({ t: rec.startMs, kind: 'start', stepId: rec.stepId, label: markerLabel(p, rec, 'start') });
    if (rec.endMs != null) {
      const kind: ScrubMarker['kind'] = rec.status === 'error' ? 'error' : 'end';
      out.push({ t: rec.endMs, kind, stepId: rec.stepId, label: markerLabel(p, rec, kind) });
    }
  }
  if (rt.state.error && !out.some((m) => m.kind === 'error' && m.t === rt.state.timeMs)) {
    out.push({ t: rt.state.timeMs, kind: 'error', stepId: rt.state.error.stepId ?? undefined, label: '오류' });
  }
  out.sort((a, b) => a.t - b.t || a.kind.localeCompare(b.kind));
  return out;
}

/** Replay `finished` from 0. Checkpoints keep a later seek inside one cache slice. */
export function buildScrubIndex(finished: Runtime): ScrubIndex {
  const totalMs = finished.state.timeMs;
  let cursor = advance(start(createRuntime(finished.snapshot, finished.state.runId)), 0);
  const points: Runtime[] = [cursor];
  let guard = 0;
  while (cursor.state.status === 'running' && cursor.state.timeMs + SCRUB_CACHE_MS < totalMs && guard++ < 100000) {
    const next = advance(cursor, SCRUB_CACHE_MS);
    if (next.state.timeMs <= cursor.state.timeMs && next.state.status === 'running') break;
    cursor = next;
    points.push(cursor);
  }
  return { totalMs, points, finished, markers: scrubMarkers(finished) };
}

/** State at `timeMs`, recomputed from the nearest checkpoint. `timeMs >= total` is the finished run. */
export function seekScrub(index: ScrubIndex, timeMs: number): Runtime {
  const t = Math.max(0, Math.min(index.totalMs, Math.round(timeMs)));
  if (t >= index.totalMs) return index.finished;
  let best = index.points[0];
  for (const point of index.points) {
    if (point.state.timeMs <= t) best = point;
    else break;
  }
  const dt = t - best.state.timeMs;
  if (dt <= 0 || best.state.status !== 'running') return best;
  return advance(best, dt);
}

export interface ScrubWorld {
  timeMs: number;
  steps: { stepId: string; status: string; startMs?: number; endMs?: number; instanceId?: string; lane?: string }[];
  signals: Record<string, boolean>;
  material: { location: string; state: string; holder: string | null } | null;
  devicePositions: Record<string, string | null>;
  occupancy: Record<string, string | null>;
  pieces: { instanceId: string; location: string; state: string; holder: string | null; phase: string; stepIndex: number }[] | null;
  fibers: { id: number; status: string; stepId: string | null }[] | null;
  error: RuntimeState['error'];
}

/** Step, signal, and material facts. A pause log line is not part of this. */
export function scrubWorld(rt: Runtime): ScrubWorld {
  const s = rt.state;
  return {
    timeMs: s.timeMs,
    steps: s.steps.map((rec) => ({
      stepId: rec.stepId, status: rec.status, startMs: rec.startMs, endMs: rec.endMs, instanceId: rec.instanceId, lane: rec.lane,
    })),
    signals: s.signals,
    material: s.material ? { location: s.material.location, state: s.material.state, holder: s.material.holder } : null,
    devicePositions: s.devicePositions,
    occupancy: s.occupancy,
    pieces: s.pieces?.map((pc) => ({
      instanceId: pc.instanceId,
      location: pc.material.location,
      state: pc.material.state,
      holder: pc.material.holder,
      phase: pc.phase,
      stepIndex: pc.stepIndex,
    })) ?? null,
    fibers: s.flowRun?.fibers.map((fiber) => ({ id: fiber.id, status: fiber.status, stepId: fiber.active?.stepId ?? null })) ?? null,
    error: s.error,
  };
}
