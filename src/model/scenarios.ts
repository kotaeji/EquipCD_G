// Named run scenarios (TURN-082). Feed, fault injection, and playback speed.
// Action duration and timeout stay on the model. The batch run uses Evolution Lab's copy runner.
import type { CmdResult } from './commands';
import { newId } from './factory';
import { runPreparedBatch } from './lab';
import type { Project, RunScenario, ScenarioInjection, SequenceStep } from './types';
import { feedCountOf } from './types';
import type { RunSummary } from '../runtime/runSummary';
import { formatMs } from '../scene/runInfo';

/** Keep in step with the 가동 조건 speed list. */
export const RUN_SPEEDS = [0.25, 0.5, 1, 2, 4, 16] as const;

export const SCENARIO_NAME_MAX = 60;
export const SCENARIO_CURRENT = '(지금 설정)';
export const SCENARIO_LOCK = '실행 중 · 일시정지 중에는 시나리오를 고를 수 없습니다. 초기화한 뒤 고르세요.';

export function missingStepNote(count: number): string {
  return `단계 ${count}개를 찾을 수 없어 뺐습니다`;
}

type Faults = Project['simSettings']['faults'];

const no = (reason: string): CmdResult => ({ ok: false, reason });

export function normalizeSpeed(speed: number): number {
  return (RUN_SPEEDS as readonly number[]).includes(speed) ? speed : 1;
}

function allSteps(p: Project): SequenceStep[] {
  return [...p.sequence.steps, ...(p.substationSequences ?? []).flatMap((q) => q.steps)];
}

function isInjection(v: unknown): v is ScenarioInjection {
  if (!v || typeof v !== 'object') return false;
  const o = v as ScenarioInjection;
  if (o.stepId != null && typeof o.stepId !== 'string') return false;
  if (o.actionId != null && typeof o.actionId !== 'string') return false;
  if (o.readFail != null && o.readFail !== true) return false;
  if (o.readFailFirstN != null && (typeof o.readFailFirstN !== 'number' || !Number.isFinite(o.readFailFirstN))) return false;
  if (o.neverTrueSignalId != null && typeof o.neverTrueSignalId !== 'string') return false;
  return typeof o.actionId === 'string' || typeof o.stepId === 'string';
}

export function isRunScenario(v: unknown): v is RunScenario {
  if (!v || typeof v !== 'object') return false;
  const o = v as RunScenario;
  return typeof o.id === 'string' && o.id !== ''
    && typeof o.name === 'string' && o.name.trim() !== ''
    && Number.isInteger(o.feedCount) && o.feedCount >= 1
    && (o.feedInterval === null || (typeof o.feedInterval === 'number' && Number.isFinite(o.feedInterval) && o.feedInterval >= 0))
    && typeof o.speed === 'number' && Number.isFinite(o.speed)
    && Array.isArray(o.injections) && o.injections.every(isInjection);
}

export function scenariosOf(p: Project): RunScenario[] {
  if (!Array.isArray(p.runScenarios)) return [];
  return p.runScenarios.filter(isRunScenario);
}

function faultsEqual(a: Faults, b: Faults): boolean {
  const ids = (xs: string[]) => [...xs].sort().join('\n');
  if (ids(a.readFailActionIds) !== ids(b.readFailActionIds)) return false;
  if (ids(a.neverTrueSignalIds) !== ids(b.neverTrueSignalIds)) return false;
  const am = a.readFailFirstN ?? {};
  const bm = b.readFailFirstN ?? {};
  const keys = new Set([...Object.keys(am), ...Object.keys(bm)]);
  for (const key of keys) if (am[key] !== bm[key]) return false;
  return true;
}

/** Current 가동 조건, without Action duration or timeout. */
export function captureRunScenario(p: Project, speed: number, name: string, id: string): RunScenario {
  const faults = p.simSettings.faults;
  const injections: ScenarioInjection[] = [];
  const coveredActions = new Set<string>();
  const coveredSignals = new Set<string>();
  for (const step of allSteps(p)) {
    const action = p.actions.find((a) => a.id === step.actionId);
    if (!action) continue;
    const readFail = faults.readFailActionIds.includes(action.id);
    const neverId = action.completeSignalId && faults.neverTrueSignalIds.includes(action.completeSignalId)
      ? action.completeSignalId
      : undefined;
    if (!readFail && !neverId) continue;
    const firstN = faults.readFailFirstN?.[action.id];
    injections.push({
      stepId: step.id,
      actionId: action.id,
      ...(readFail ? { readFail: true } : {}),
      ...(readFail && firstN != null ? { readFailFirstN: firstN } : {}),
      ...(neverId ? { neverTrueSignalId: neverId } : {}),
    });
    coveredActions.add(action.id);
    if (neverId) coveredSignals.add(neverId);
  }
  for (const actionId of faults.readFailActionIds) {
    if (coveredActions.has(actionId)) continue;
    const firstN = faults.readFailFirstN?.[actionId];
    injections.push({
      actionId,
      readFail: true,
      ...(firstN != null ? { readFailFirstN: firstN } : {}),
    });
    coveredActions.add(actionId);
  }
  for (const signalId of faults.neverTrueSignalIds) {
    if (coveredSignals.has(signalId)) continue;
    const action = p.actions.find((a) => a.completeSignalId === signalId);
    const row = action ? injections.find((item) => !item.stepId && item.actionId === action.id) : undefined;
    if (row) row.neverTrueSignalId = signalId;
    else injections.push(action ? { actionId: action.id, neverTrueSignalId: signalId } : { neverTrueSignalId: signalId });
    coveredSignals.add(signalId);
  }
  const material = p.materials[0];
  return {
    id,
    name,
    feedCount: feedCountOf(material),
    feedInterval: material?.feedInterval.value ?? null,
    speed: normalizeSpeed(speed),
    injections,
  };
}

/** Drop rows whose step, action, or complete signal is gone. */
export function resolveInjections(p: Project, injections: readonly ScenarioInjection[]): { faults: Faults; dropped: number } {
  const readFailActionIds: string[] = [];
  const readFailFirstN: Record<string, number> = {};
  const neverTrueSignalIds: string[] = [];
  let dropped = 0;
  const steps = allSteps(p);
  for (const row of injections) {
    const action = row.stepId
      ? (() => {
        const step = steps.find((s) => s.id === row.stepId);
        if (!step) return null;
        const found = p.actions.find((a) => a.id === step.actionId);
        if (!found || (row.actionId != null && found.id !== row.actionId)) return null;
        return found;
      })()
      : (row.actionId ? p.actions.find((a) => a.id === row.actionId) ?? null : null);
    if (!action) { dropped += 1; continue; }
    if (row.readFail && !readFailActionIds.includes(action.id)) readFailActionIds.push(action.id);
    if (row.readFail && row.readFailFirstN != null && row.readFailFirstN >= 1) {
      readFailFirstN[action.id] = Math.round(row.readFailFirstN);
    }
    if (row.neverTrueSignalId) {
      const signalOk = action.completeSignalId === row.neverTrueSignalId
        && p.signals.some((s) => s.id === row.neverTrueSignalId);
      if (signalOk) {
        if (!neverTrueSignalIds.includes(row.neverTrueSignalId)) neverTrueSignalIds.push(row.neverTrueSignalId);
      } else dropped += 1;
    }
  }
  const faults: Faults = { neverTrueSignalIds, readFailActionIds };
  if (Object.keys(readFailFirstN).length) faults.readFailFirstN = readFailFirstN;
  return { faults, dropped };
}

function writeScenario(p: Project, scenario: RunScenario): { project: Project; changed: boolean; dropped: number } {
  const resolved = resolveInjections(p, scenario.injections);
  const next = structuredClone(p);
  let changed = false;
  const material = next.materials[0];
  if (material) {
    if (feedCountOf(material) !== scenario.feedCount) {
      material.feedCount = scenario.feedCount;
      changed = true;
    }
    if (material.feedInterval.value !== scenario.feedInterval) {
      const prev = material.feedInterval;
      const value = scenario.feedInterval;
      material.feedInterval = {
        ...prev,
        value,
        source: { method: 'direct-input' },
        history: [...(prev.history ?? []), { at: `rev${p.revision + 1}`, from: prev.value, to: value, assumption: prev.assumption }],
      };
      changed = true;
    }
  }
  if (!faultsEqual(next.simSettings.faults, resolved.faults)) {
    next.simSettings.faults = resolved.faults;
    changed = true;
  }
  return { project: next, changed, dropped: resolved.dropped };
}

/** Copy with this scenario's feed and faults. Does not bump revision and does not write `p`. */
export function projectForScenario(p: Project, scenario: RunScenario): { project: Project; dropped: number } {
  const written = writeScenario(p, scenario);
  return { project: written.project, dropped: written.dropped };
}

export interface ScenarioApply {
  project: Project;
  changed: boolean;
  dropped: number;
}

/** One undo when feed or faults change. Playback speed is not a model value. */
export function commitRunScenario(p: Project, scenario: RunScenario): ScenarioApply {
  const written = writeScenario(p, scenario);
  if (!written.changed) return { project: p, changed: false, dropped: written.dropped };
  written.project.revision = p.revision + 1;
  return { project: written.project, changed: true, dropped: written.dropped };
}

export function scenarioMatches(p: Project, speed: number, scenario: RunScenario): boolean {
  const material = p.materials[0];
  if (feedCountOf(material) !== scenario.feedCount) return false;
  if ((material?.feedInterval.value ?? null) !== scenario.feedInterval) return false;
  if (normalizeSpeed(speed) !== scenario.speed) return false;
  const resolved = resolveInjections(p, scenario.injections);
  if (resolved.dropped > 0) return false;
  return faultsEqual(p.simSettings.faults, resolved.faults);
}

function cleanName(raw: string): string {
  return raw.trim();
}

function nameError(name: string, existing: readonly RunScenario[], exceptId?: string): string | null {
  if (!name) return '이름을 입력하세요';
  if (name.length > SCENARIO_NAME_MAX) return `이름은 ${SCENARIO_NAME_MAX}자 이하입니다`;
  if (existing.some((s) => s.id !== exceptId && s.name.toLowerCase() === name.toLowerCase())) return '같은 이름의 시나리오가 있습니다';
  return null;
}

function withScenarios(p: Project, list: RunScenario[]): Project {
  const next = structuredClone(p);
  if (list.length === 0) delete next.runScenarios;
  else next.runScenarios = list;
  next.revision = p.revision + 1;
  return next;
}

export function addRunScenario(p: Project, speed: number, rawName: string, idOf: () => string = () => newId('scn')): CmdResult {
  const name = cleanName(rawName);
  const existing = scenariosOf(p);
  const reason = nameError(name, existing);
  if (reason) return no(reason);
  const scenario = captureRunScenario(p, speed, name, idOf());
  return { ok: true, project: withScenarios(p, [...existing, scenario]), note: scenario.id };
}

export function renameRunScenario(p: Project, id: string, rawName: string): CmdResult {
  const existing = scenariosOf(p);
  const current = existing.find((s) => s.id === id);
  if (!current) return no('시나리오 없음');
  const name = cleanName(rawName);
  if (name === current.name) return no('이름이 바뀌지 않았습니다');
  const reason = nameError(name, existing, id);
  if (reason) return no(reason);
  return { ok: true, project: withScenarios(p, existing.map((s) => (s.id === id ? { ...s, name } : s))) };
}

export function deleteRunScenario(p: Project, id: string): CmdResult {
  const existing = scenariosOf(p);
  if (!existing.some((s) => s.id === id)) return no('시나리오 없음');
  return { ok: true, project: withScenarios(p, existing.filter((s) => s.id !== id)) };
}

export function branchSummary(summary: RunSummary | null, status: string): string {
  if (!summary || status === 'blocked') return '—';
  const skipped = summary.steps.filter((s) => s.status === 'skipped');
  const lanes = [...new Set(summary.steps.filter((s) => s.lane && s.status !== 'skipped' && s.status !== 'pending').map((s) => s.lane as string))];
  const parts: string[] = [];
  if (lanes.length) parts.push(lanes.join(' · '));
  if (skipped.length) parts.push(`안 감: ${skipped.map((s) => s.name).join(', ')}`);
  return parts.length ? parts.join(' · ') : '갈래 없음';
}

export interface ScenarioRunRow {
  id: string;
  name: string;
  status: 'completed' | 'error' | 'blocked';
  code: string | null;
  totalMs: number | null;
  branchSummary: string;
  dropped: number;
}

export function scenarioStatusText(row: Pick<ScenarioRunRow, 'status' | 'code'>): string {
  if (row.status === 'completed') return '끝남';
  if (row.status === 'blocked') return row.code ? `실행 불가 ${row.code}` : '실행 불가';
  return row.code ?? '오류';
}

export function scenarioTimeText(ms: number | null): string {
  return ms == null ? '—' : formatMs(ms);
}

/** Run each saved scenario on a copy, to the end. Does not write `project`. */
export function runAllScenarios(project: Project, scenarios: readonly RunScenario[]): ScenarioRunRow[] {
  const prepared = scenarios.map((scenario) => {
    const applied = projectForScenario(project, scenario);
    return { scenario, project: applied.project, dropped: applied.dropped };
  });
  const runs = runPreparedBatch(prepared.map((item) => ({
    id: item.scenario.id,
    name: item.scenario.name,
    project: item.project,
  })));
  return runs.map((run, i) => ({
    id: run.id,
    name: run.name,
    status: run.column.status,
    code: run.column.code,
    totalMs: run.column.totalMs,
    branchSummary: branchSummary(run.summary, run.column.status),
    dropped: prepared[i].dropped,
  }));
}
