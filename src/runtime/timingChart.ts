// Timing chart geometry (TURN-064). Reads a finished or in-progress run.
// Does not advance time and does not write the engine or the model.
import { materialMark, mixActive } from '../model/materialMix';
import type { Project } from '../model/types';
import type { RuntimeState, StepRecord } from './engine';
import { summarizeRun, type RunStepSummary } from './runSummary';

export type TimingLane = 'unit' | 'device' | 'piece';

export interface TimingBar {
  /** Index in `summarizeRun().steps`. Negative when the wait has no summary row yet. */
  summaryIndex: number;
  stepId: string;
  name: string;
  status: 'active' | 'done' | 'error' | 'stopped';
  startMs: number;
  /** Null while this bar is still open. */
  endMs: number | null;
  drawEndMs: number;
  /** Signal-wait block, or a multi-piece standby stretch. Null on an ordinary step. */
  hatch: 'signal' | 'standby' | null;
  lane?: string;
  pass?: number;
  /** 1-based piece number. Null on a single-piece run. */
  piece: number | null;
  condText?: string;
  rowId: string;
  sublane: number;
}

export interface TimingRow {
  id: string;
  label: string;
  sublanes: number;
}

export interface TimingTick {
  ms: number;
  label: string;
}

export interface TimingModel {
  empty: boolean;
  lane: TimingLane;
  lanes: TimingLane[];
  rows: TimingRow[];
  bars: TimingBar[];
  originMs: number;
  endMs: number;
  spanMs: number;
  tickStepMs: number;
  ticks: TimingTick[];
  /** Virtual time of the "now" line. Set while the station run is running or paused. */
  nowMs: number | null;
}

/** Horizontal scale before the fit cap. Zoom 2 and 4 grow past the panel and scroll inside it. */
export const CHART_PX_PER_SEC = 64;
/** Zoom 1 keeps a long run on one screen. Further zoom scrolls inside the chart. */
export const CHART_FIT_MAX = 400;

const TICK_STEPS_MS = [500, 1000, 2000, 5000, 10000, 30000, 60000];

interface Place {
  unitId: string;
  unitLabel: string;
  deviceId: string;
  deviceLabel: string;
}

interface Draft {
  summaryIndex: number;
  stepId: string;
  name: string;
  status: TimingBar['status'];
  startMs: number;
  endMs: number | null;
  drawEndMs: number;
  hatch: TimingBar['hatch'];
  lane?: string;
  pass?: number;
  piece: number | null;
  condText?: string;
  place: Place;
}

/** Tick spacing for a span, aiming at about eight labels. 0.5s, 1s, 2s, 5s, then wider. */
export function tickStepMs(spanMs: number): number {
  const span = Math.max(0, spanMs);
  for (const step of TICK_STEPS_MS) {
    if (span / step <= 8) return step;
  }
  return TICK_STEPS_MS[TICK_STEPS_MS.length - 1];
}

export function tickLabel(ms: number): string {
  const sec = ms / 1000;
  if (Number.isInteger(sec)) return `${sec}s`;
  return `${sec.toFixed(1)}s`;
}

export function chartPlotWidth(spanMs: number, zoom: number): number {
  const natural = (Math.max(spanMs, 1) / 1000) * CHART_PX_PER_SEC;
  const fitted = Math.min(Math.max(natural, 160), CHART_FIT_MAX);
  return Math.ceil(fitted * Math.max(zoom, 1));
}

function pieceNumber(lane?: string): number | null {
  const m = /개체\s*(\d+)/.exec(lane ?? '');
  return m ? Number(m[1]) : null;
}

function actionPlace(p: Project, stepId: string): Place | null {
  const step = p.sequence.steps.find((s) => s.id === stepId)
    ?? (p.substationSequences ?? []).flatMap((q) => q.steps).find((s) => s.id === stepId);
  const action = step ? p.actions.find((a) => a.id === step.actionId) : undefined;
  if (!action) return null;
  const unit = p.units.find((u) => u.id === action.unitId);
  const device = p.devices.find((d) => d.id === action.deviceId);
  return {
    unitId: action.unitId,
    unitLabel: unit?.name ?? action.unitId,
    deviceId: action.deviceId,
    deviceLabel: device?.name ?? action.deviceId,
  };
}

function signalPlace(): Place {
  return { unitId: 'signal-wait', unitLabel: '신호 기다림', deviceId: 'signal-wait', deviceLabel: '신호 기다림' };
}

function unitStandby(p: Project, unitId: string): Place {
  const unit = p.units.find((u) => u.id === unitId);
  const label = unit?.name ?? unitId;
  return { unitId, unitLabel: label, deviceId: `standby:${unitId}`, deviceLabel: `대기 · ${label}` };
}

/** A standby note names the Device or the Unit the piece is waiting on. */
function standbyPlace(p: Project, note: string, fallback: Place): Place {
  const device = [...p.devices].sort((a, b) => b.name.length - a.name.length).find((d) => d.name.length > 0 && note.includes(d.name));
  if (device) {
    const unit = p.units.find((u) => u.id === device.unitId);
    return {
      unitId: device.unitId,
      unitLabel: unit?.name ?? device.unitId,
      deviceId: device.id,
      deviceLabel: device.name,
    };
  }
  const unit = [...p.units].sort((a, b) => b.name.length - a.name.length).find((u) => u.name.length > 0 && note.includes(u.name));
  if (unit) return unitStandby(p, unit.id);
  return {
    ...fallback,
    deviceId: `standby:${fallback.unitId}`,
    deviceLabel: `대기 · ${fallback.unitLabel}`,
  };
}

function matchRecord(state: RuntimeState, step: RunStepSummary): StepRecord | undefined {
  return state.steps.find((rec) => rec.stepId === step.stepId
    && (rec.startMs ?? null) === step.startMs
    && (rec.lane ?? '') === (step.lane ?? '')
    && (rec.pass ?? 0) === (step.pass ?? 0)
    && rec.status === step.status);
}

function previousEnd(steps: Draft[], piece: number | null, lane: string | undefined, startMs: number): number | null {
  let best: number | null = null;
  for (const step of steps) {
    if (step.hatch || step.piece !== piece || (step.lane ?? '') !== (lane ?? '')) continue;
    if (step.endMs == null || step.endMs > startMs) continue;
    if (best == null || step.endMs > best) best = step.endMs;
  }
  return best;
}

function waitSegments(start: number, end: number | null, waitMs: number, prevEnd: number | null): { startMs: number; endMs: number }[] {
  if (waitMs <= 0) return [];
  const gap = prevEnd == null ? waitMs : Math.max(0, start - prevEnd);
  const before = Math.min(waitMs, gap);
  const during = waitMs - before;
  const out: { startMs: number; endMs: number }[] = [];
  if (before > 0) out.push({ startMs: Math.max(0, start - before), endMs: start });
  if (during > 0 && end != null && end > start) {
    const drawn = Math.min(during, end - start);
    out.push({ startMs: end - drawn, endMs: end });
  }
  return out;
}

function emptyModel(lane: TimingLane, lanes: TimingLane[]): TimingModel {
  return {
    empty: true, lane, lanes, rows: [], bars: [],
    originMs: 0, endMs: 0, spanMs: 0, tickStepMs: 500, ticks: [], nowMs: null,
  };
}

function rowIdentity(p: Project, state: RuntimeState | null, lane: TimingLane, draft: Draft): { id: string; label: string } {
  if (lane === 'device') return { id: draft.place.deviceId, label: draft.place.deviceLabel };
  if (lane === 'piece') {
    if (draft.piece == null) return { id: 'piece:seq', label: '순차' };
    const pc = state?.pieces?.find((row) => row.index === draft.piece);
    const mark = pc && mixActive(p) ? ` ${materialMark(p, pc.material.materialId)}` : '';
    return { id: `piece:${draft.piece}`, label: `개체 ${draft.piece}${mark}` };
  }
  return { id: draft.place.unitId, label: draft.place.unitLabel };
}

function orderRowIds(p: Project, lane: TimingLane, used: string[]): string[] {
  const preferred = lane === 'device'
    ? p.devices.map((d) => d.id)
    : lane === 'piece'
      ? []
      : p.units.map((u) => u.id);
  const out = preferred.filter((id) => used.includes(id));
  const rest = used.filter((id) => !out.includes(id));
  if (lane === 'piece') {
    rest.sort((a, b) => {
      const na = Number(a.slice(a.indexOf(':') + 1));
      const nb = Number(b.slice(b.indexOf(':') + 1));
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }
  return [...out, ...rest];
}

function assignSublanes(bars: TimingBar[]): Map<string, number> {
  const byRow = new Map<string, TimingBar[]>();
  for (const bar of bars) {
    const list = byRow.get(bar.rowId) ?? [];
    list.push(bar);
    byRow.set(bar.rowId, list);
  }
  const counts = new Map<string, number>();
  for (const [rowId, list] of byRow) {
    list.sort((a, b) => a.startMs - b.startMs || a.drawEndMs - b.drawEndMs);
    const ends: number[] = [];
    for (const bar of list) {
      let sub = ends.findIndex((end) => end <= bar.startMs);
      if (sub < 0) {
        sub = ends.length;
        ends.push(bar.drawEndMs);
      } else ends[sub] = bar.drawEndMs;
      bar.sublane = sub;
    }
    counts.set(rowId, Math.max(1, ends.length));
  }
  return counts;
}

/** Rows and bars for one grouping. Skipped steps are omitted. Pending steps are omitted. */
export function timingChart(p: Project, state: RuntimeState | null, requested: TimingLane = 'unit'): TimingModel {
  const summary = state ? summarizeRun(p, state) : summarizeRun(p, null);
  const steps: Draft[] = [];
  if (state) {
    summary.steps.forEach((step, summaryIndex) => {
      if (step.startMs == null || step.status === 'skipped' || step.status === 'pending') return;
      if (step.status !== 'active' && step.status !== 'done' && step.status !== 'error' && step.status !== 'stopped') return;
      const place = step.wait ? signalPlace() : (actionPlace(p, step.stepId) ?? signalPlace());
      steps.push({
        summaryIndex,
        stepId: step.stepId,
        name: step.name,
        status: step.status,
        startMs: step.startMs,
        endMs: step.endMs,
        drawEndMs: step.endMs ?? state.timeMs,
        hatch: step.wait ? 'signal' : null,
        ...(step.lane ? { lane: step.lane } : {}),
        ...(step.pass != null ? { pass: step.pass } : {}),
        piece: pieceNumber(step.lane),
        ...(step.condText ? { condText: step.condText } : {}),
        place,
      });
    });
  }

  const drafts: Draft[] = [...steps];
  if (state) {
    for (const step of steps) {
      if (step.hatch) continue;
      const rec = summary.steps[step.summaryIndex];
      const record = matchRecord(state, rec);
      const note = record?.waitNote ?? '';
      for (const seg of waitSegments(step.startMs, step.endMs, record?.waitMs ?? 0, previousEnd(steps, step.piece, step.lane, step.startMs))) {
        drafts.push({
          ...step,
          name: note || '대기',
          status: 'done',
          startMs: seg.startMs,
          endMs: seg.endMs,
          drawEndMs: seg.endMs,
          hatch: 'standby',
          place: standbyPlace(p, note, step.place),
        });
      }
    }
    for (const pc of state.pieces ?? []) {
      if (!pc.wait || state.timeMs <= pc.wait.sinceMs) continue;
      const fallback = unitStandby(p, pc.wait.unitId);
      drafts.push({
        summaryIndex: -1,
        stepId: '',
        name: pc.wait.note || '대기',
        status: 'active',
        startMs: pc.wait.sinceMs,
        endMs: null,
        drawEndMs: state.timeMs,
        hatch: 'standby',
        lane: `개체 ${pc.index}`,
        piece: pc.index,
        place: standbyPlace(p, pc.wait.note, fallback),
      });
    }
  }

  const pieceIds = new Set<number>();
  for (const draft of drafts) if (draft.piece != null) pieceIds.add(draft.piece);
  for (const pc of state?.pieces ?? []) pieceIds.add(pc.index);
  const lanes: TimingLane[] = pieceIds.size >= 2 ? ['unit', 'device', 'piece'] : ['unit', 'device'];
  const lane: TimingLane = lanes.includes(requested) ? requested : 'unit';
  if (drafts.length === 0) return emptyModel(lane, lanes);

  const seen: { id: string; label: string }[] = [];
  for (const draft of drafts) {
    const row = rowIdentity(p, state, lane, draft);
    if (!seen.some((item) => item.id === row.id)) seen.push(row);
  }
  const order = orderRowIds(p, lane, seen.map((item) => item.id));
  const labelOf = new Map(seen.map((item) => [item.id, item.label]));
  const bars: TimingBar[] = drafts.map((draft) => {
    const row = rowIdentity(p, state, lane, draft);
    return {
      summaryIndex: draft.summaryIndex,
      stepId: draft.stepId,
      name: draft.name,
      status: draft.status,
      startMs: draft.startMs,
      endMs: draft.endMs,
      drawEndMs: draft.drawEndMs,
      hatch: draft.hatch,
      ...(draft.lane ? { lane: draft.lane } : {}),
      ...(draft.pass != null ? { pass: draft.pass } : {}),
      piece: draft.piece,
      ...(draft.condText ? { condText: draft.condText } : {}),
      rowId: row.id,
      sublane: 0,
    };
  });
  const sublanes = assignSublanes(bars);
  const rows: TimingRow[] = order.map((id) => ({ id, label: labelOf.get(id) ?? id, sublanes: sublanes.get(id) ?? 1 }));
  const originMs = 0;
  const endMs = Math.max(...bars.map((bar) => bar.drawEndMs));
  const spanMs = Math.max(endMs - originMs, 1);
  const step = tickStepMs(spanMs);
  const ticks: TimingTick[] = [];
  for (let t = 0; t <= endMs + 1e-6; t += step) ticks.push({ ms: t, label: tickLabel(t) });
  const nowMs = state && (state.status === 'running' || state.status === 'paused') ? state.timeMs : null;
  return { empty: false, lane, lanes, rows, bars, originMs, endMs, spanMs, tickStepMs: step, ticks, nowMs };
}
