// Left-hand run info for the 3D view. Numbers match summarizeRun once a run has started.
// Before a run, bars use each Action's assumed duration.

import type { Project } from '../model/types';
import { collectStepIds } from '../model/flow';
import type { RuntimeState } from '../runtime/engine';
import { stepStatusLabel, summarizeRun, type RunStepSummary } from '../runtime/runSummary';
import { deviceOfStep } from './describe';

export function formatMs(msv: number): string {
  return `${String(Math.floor(msv / 60000)).padStart(2, '0')}:${(Math.floor(msv / 1000) % 60).toString().padStart(2, '0')}.${(Math.round(msv) % 1000).toString().padStart(3, '0')}`;
}

export interface RunInfoBar {
  key: string;
  stepId: string;
  name: string;
  status: string;
  statusLabel: string;
  widthMs: number;
  timeText: string;
  longest: boolean;
  lane?: string;
  pass?: number;
  unitId: string | null;
}

export interface RunInfo {
  projectName: string;
  unitCount: number;
  deviceCount: number;
  stepCount: number;
  status: string;
  timeText: string;
  running: { name: string; lane?: string }[];
  material: { where: string; state: string } | null;
  bars: RunInfoBar[];
  longestText: string | null;
  unitTotals: { unitId: string; name: string; ms: number; timeText: string }[];
  /** True when no step has started and the bars are assumed Action times. */
  assumed: boolean;
}

function stepCountOf(p: Project): number {
  if (p.sequence.flow) {
    const ids = collectStepIds(p.sequence.flow);
    if (ids.length) return ids.length;
    return (p.substationSequences ?? []).reduce((n, q) => n + q.steps.length, 0);
  }
  return p.sequence.steps.length;
}

function unitOfDevice(p: Project, deviceId: string | null): string | null {
  if (!deviceId) return null;
  return p.devices.find((d) => d.id === deviceId)?.unitId ?? null;
}

function assumedMs(p: Project, stepId: string): number {
  const step = p.sequence.steps.find((s) => s.id === stepId)
    ?? (p.substationSequences ?? []).flatMap((q) => q.steps).find((s) => s.id === stepId);
  const action = step ? p.actions.find((a) => a.id === step.actionId) : undefined;
  const value = action?.duration.value;
  return value === null || value === undefined ? 0 : Math.round(value * 1000);
}

function whereText(p: Project, id: string | null | undefined): string {
  if (!id) return '대기';
  if (id === 'EXIT') return '배출(장비 밖)';
  return p.units.find((u) => u.id === id)?.name ?? id;
}

function runningNow(p: Project, rt: RuntimeState | null): { name: string; lane?: string }[] {
  if (!rt) return [];
  if (rt.flowRun) {
    return rt.flowRun.fibers.flatMap((fiber) => {
      if (!fiber.active) return [];
      const step = p.sequence.steps.find((s) => s.id === fiber.active!.stepId)
        ?? (p.substationSequences ?? []).flatMap((q) => q.steps).find((s) => s.id === fiber.active!.stepId);
      return [{ name: step?.name ?? fiber.active.stepId, ...(fiber.lane ? { lane: fiber.lane } : {}) }];
    });
  }
  if (!rt.active) return [];
  const step = rt.active.stepId
    ? p.sequence.steps.find((s) => s.id === rt.active!.stepId)
    : p.sequence.steps[rt.active.stepIndex];
  return step ? [{ name: step.name }] : [];
}

function plannedRows(p: Project): RunStepSummary[] {
  const fromStation = p.sequence.steps.map((s) => ({
    stepId: s.id, name: s.name, status: 'pending' as const, startMs: null, endMs: null, elapsedMs: null,
  }));
  if (fromStation.length) return fromStation;
  return (p.substationSequences ?? []).flatMap((q) => q.steps.map((s) => ({
    stepId: s.id, name: s.name, status: 'pending' as const, startMs: null, endMs: null, elapsedMs: null, lane: q.name,
  })));
}

export function describeRunInfo(p: Project, rt: RuntimeState | null): RunInfo {
  const summary = rt ? summarizeRun(p, rt) : null;
  const started = !!summary && summary.steps.some((s) => s.startMs !== null);
  const rows = started && summary ? summary.steps : plannedRows(p);
  const assumed = !started;

  const bars: RunInfoBar[] = rows.map((row, i) => {
    const unitId = unitOfDevice(p, deviceOfStep(p, row.stepId));
    const widthMs = assumed ? assumedMs(p, row.stepId) : (row.elapsedMs ?? 0);
    const timeText = assumed ? formatMs(widthMs) : (row.elapsedMs === null ? '-' : formatMs(row.elapsedMs));
    return {
      key: `${row.stepId}:${i}`,
      stepId: row.stepId,
      name: row.name,
      status: row.status,
      statusLabel: assumed ? '가정' : stepStatusLabel(row.status),
      widthMs,
      timeText,
      longest: false,
      ...(row.lane ? { lane: row.lane } : {}),
      ...(row.pass != null ? { pass: row.pass } : {}),
      unitId,
    };
  });

  let longestText: string | null = null;
  if (assumed) {
    let best: RunInfoBar | null = null;
    for (const bar of bars) if (!best || bar.widthMs > best.widthMs) best = bar;
    if (best && best.widthMs > 0) {
      best.longest = true;
      longestText = `가장 긴 단계 ${best.name} ${best.timeText}`;
    }
  } else if (summary?.longest) {
    const match = bars.find((bar) => bar.stepId === summary.longest!.stepId && bar.timeText === formatMs(summary.longest!.elapsedMs));
    if (match) match.longest = true;
    longestText = `가장 긴 단계 ${summary.longest.name} ${formatMs(summary.longest.elapsedMs)}`;
  }

  const totals = new Map<string, number>();
  for (const bar of bars) {
    if (!bar.unitId) continue;
    totals.set(bar.unitId, (totals.get(bar.unitId) ?? 0) + bar.widthMs);
  }
  const unitTotals = p.units.map((u) => {
    const ms = totals.get(u.id) ?? 0;
    return { unitId: u.id, name: u.name, ms, timeText: formatMs(ms) };
  });

  const mat = rt?.material;
  const def = p.materials[0];
  const material = mat
    ? { where: whereText(p, mat.location), state: mat.state }
    : def
      ? { where: whereText(p, def.initialLocation), state: def.initialState ?? '대기' }
      : null;

  return {
    projectName: p.name,
    unitCount: p.units.length,
    deviceCount: p.devices.length,
    stepCount: stepCountOf(p),
    status: rt?.status ?? 'idle',
    timeText: formatMs(rt?.timeMs ?? 0),
    running: runningNow(p, rt),
    material,
    bars,
    longestText,
    unitTotals,
    assumed,
  };
}
