// Deterministic logic runtime (C04). Pure functions; virtual time in integer milliseconds.
// Evaluation order at one virtual instant (prototype rule, 설계 제안):
//   1) read current signal/material state  2) activate next step (check entry+pre)  3) completion vs timeout
//   4) apply transition (post check → effect commit)  5) record log.
// Tie rule (prototype assumption): completion at exactly the timeout instant counts as success.
// This is NOT equipment control and NOT physics simulation.
import type { Action, Condition, Project } from '../model/types';
import { RUNTIME_RULES_VERSION } from '../model/types';
import { checkRunReadiness, type Diagnostic } from '../model/validate';

export type RunStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error';

export interface MaterialInstance {
  instanceId: string;
  materialId: string;
  location: string | 'EXIT';
  state: string;
  holder: string | null;
}

export interface LogEntry { t: number; level: 'info' | 'warn' | 'error'; code: string; message: string; refId?: string }

export interface StepRecord { stepId: string; status: 'pending' | 'active' | 'done' | 'error'; startMs?: number; endMs?: number }

export interface ActiveStep { stepIndex: number; startMs: number; completeAtMs: number | null; timeoutAtMs: number }

export interface RuntimeState {
  rulesVersion: string;
  runId: string;
  modelRevision: number;
  status: RunStatus;
  timeMs: number;
  stepIndex: number;
  active: ActiveStep | null;
  signals: Record<string, boolean>;
  devicePositions: Record<string, string | null>;
  material: MaterialInstance | null;
  occupancy: Record<string, string | null>;
  steps: StepRecord[];
  log: LogEntry[];
  error: { code: string; stepId: string | null; message: string } | null;
  blockers: Diagnostic[];
}

export interface Runtime { snapshot: Project; state: RuntimeState }

export const ms = (s: number | null): number => Math.round((s ?? 0) * 1000);

function initialState(p: Project, runId: string): RuntimeState {
  const signals: Record<string, boolean> = {};
  for (const s of p.signals) signals[s.id] = false;
  const occupancy: Record<string, string | null> = {};
  for (const u of p.units) occupancy[u.id] = null;
  const m = p.materials[0];
  let material: MaterialInstance | null = null;
  if (m && m.initialLocation && m.initialState) {
    material = { instanceId: `${m.id}#1`, materialId: m.id, location: m.initialLocation, state: m.initialState, holder: null };
    occupancy[m.initialLocation] = material.instanceId;
  }
  const devicePositions: Record<string, string | null> = {};
  for (const d of p.devices) devicePositions[d.id] = null;
  return {
    rulesVersion: RUNTIME_RULES_VERSION, runId, modelRevision: p.revision, status: 'idle', timeMs: 0, stepIndex: 0, active: null,
    signals, devicePositions, material, occupancy,
    steps: p.sequence.steps.map((s) => ({ stepId: s.id, status: 'pending' })), log: [], error: null, blockers: [],
  };
}

/** Freeze a deep copy of the design model; runtime never writes into design data. */
export function createRuntime(project: Project, runId = 'run-1'): Runtime {
  const snapshot = structuredClone(project);
  return { snapshot, state: initialState(snapshot, runId) };
}

export function start(rt: Runtime): Runtime {
  if (rt.state.status !== 'idle') return rt;
  const r = checkRunReadiness(rt.snapshot);
  if (!r.ok) {
    const s = structuredClone(rt.state);
    s.blockers = r.blockers;
    s.log.push({ t: s.timeMs, level: 'error', code: 'NOT_READY', message: `실행 준비 실패: ${r.blockers.length}건 — ${r.blockers.map((x) => x.message).slice(0, 3).join(' / ')}` });
    return { ...rt, state: s };
  }
  const s = structuredClone(rt.state);
  s.status = 'running';
  s.blockers = [];
  s.log.push({ t: s.timeMs, level: 'info', code: 'RUN_START', message: `실행 시작 (모델 리비전 ${s.modelRevision}, 규칙 ${s.rulesVersion})` });
  return { ...rt, state: s };
}

export function pause(rt: Runtime): Runtime {
  if (rt.state.status !== 'running') return rt;
  const s = structuredClone(rt.state);
  s.status = 'paused';
  s.log.push({ t: s.timeMs, level: 'info', code: 'PAUSE', message: '일시정지 — 가상 시간 동결' });
  return { ...rt, state: s };
}

export function resume(rt: Runtime): Runtime {
  if (rt.state.status !== 'paused') return rt;
  const s = structuredClone(rt.state);
  s.status = 'running';
  s.log.push({ t: s.timeMs, level: 'info', code: 'RESUME', message: '재개' });
  return { ...rt, state: s };
}

/** 초기화: 실행 시작 시점의 스냅샷 초기 조건으로 복원 (Undo와 별개). */
export function reset(rt: Runtime): Runtime {
  return { snapshot: rt.snapshot, state: initialState(rt.snapshot, rt.state.runId) };
}

export function evalCond(c: Condition, s: Pick<RuntimeState, "signals" | "material">): { ok: boolean; why: string } {
  switch (c.kind) {
    case 'signal': return { ok: (s.signals[c.signalId] ?? false) === c.equals, why: `Signal ${c.signalId} == ${c.equals}` };
    case 'materialAt': return { ok: s.material?.location === c.unitId, why: `자재 위치 == ${c.unitId}` };
    case 'materialState': return { ok: s.material?.state === c.state, why: `자재 상태 == ${c.state}` };
    case 'materialHeldBy': return { ok: (s.material?.holder ?? null) === c.deviceId, why: `자재 holder == ${c.deviceId ?? '없음'}` };
    case 'undefined': return { ok: false, why: `미정 조건: ${c.note}` };
  }
}

function fail(s: RuntimeState, code: string, stepId: string | null, message: string) {
  s.status = 'error';
  s.error = { code, stepId, message };
  if (stepId) { const r = s.steps.find((x) => x.stepId === stepId); if (r) { r.status = 'error'; r.endMs = s.timeMs; } }
  s.log.push({ t: s.timeMs, level: 'error', code, message, refId: stepId ?? undefined });
}

function activate(p: Project, s: RuntimeState) {
  const step = p.sequence.steps[s.stepIndex];
  const a = p.actions.find((x) => x.id === step.actionId) as Action;
  for (const c of [...step.entry, ...a.pre]) {
    const r = evalCond(c, s);
    if (!r.ok) { fail(s, 'PRE_UNMET', step.id, `[${step.name}] 전제 조건 미충족: ${r.why} — 다른 진행 주체가 없어 대기하지 않고 오류 처리`); return; }
  }
  if (a.completeSignalId) s.signals[a.completeSignalId] = false;
  if (a.commandSignalId) s.signals[a.commandSignalId] = true;
  const timeout = (step.timeoutOverride ?? a.timeout).value ?? 0;
  const neverTrue = a.completeSignalId ? p.simSettings.faults.neverTrueSignalIds.includes(a.completeSignalId) : true;
  s.active = {
    stepIndex: s.stepIndex, startMs: s.timeMs,
    completeAtMs: neverTrue ? null : s.timeMs + ms(a.duration.value), timeoutAtMs: s.timeMs + ms(timeout),
  };
  const rec = s.steps[s.stepIndex]; rec.status = 'active'; rec.startMs = s.timeMs;
  s.log.push({ t: s.timeMs, level: 'info', code: 'STEP_START', message: `[${step.name}] 시작 — 명령 ${a.commandSignalId ?? '(없음)'}=ON, 완료조건 ${a.completeSignalId}=true 대기 (가정 ${a.duration.value}s, 타임아웃 ${timeout}s)`, refId: step.id });
}

function complete(p: Project, s: RuntimeState) {
  const step = p.sequence.steps[s.stepIndex];
  const a = p.actions.find((x) => x.id === step.actionId) as Action;
  if (a.completeSignalId) s.signals[a.completeSignalId] = true;
  // tentative material state
  const m = s.material ? { ...s.material } : null;
  const occ = { ...s.occupancy };
  if (m) {
    if (a.effect.holder !== undefined) m.holder = a.effect.holder;
    if (a.effect.moveTo) {
      const to = a.effect.moveTo;
      if (to !== 'EXIT') {
        const unit = p.units.find((u) => u.id === to)!;
        const cap = unit.capacity.maxMaterials.value ?? 0;
        const used = Object.entries(occ).filter(([uid, inst]) => uid === to && inst && inst !== m.instanceId).length;
        if (used >= cap) { fail(s, 'CAPACITY_FULL', step.id, `[${step.name}] ${unit.name} 수용 불가 (물류 수용 불가 — 논리 조건과 별개)`); return; }
      }
      if (m.location !== 'EXIT') occ[m.location] = null;
      m.location = to;
      if (to !== 'EXIT') occ[to] = m.instanceId;
    }
  }
  const readFail = a.kind === 'read' && p.simSettings.faults.readFailActionIds.includes(a.id);
  if (a.kind === 'read') {
    const resultSig = p.signals.find((x) => x.deviceId === a.deviceId && x.role === 'result');
    if (resultSig) s.signals[resultSig.id] = !readFail;
  }
  if (readFail) {
    if (s.material) s.material = { ...s.material, state: s.material.state };
    fail(s, 'READ_FAILED', step.id, `[${step.name}] 읽기 완료, 결과=실패 (식별 실패 상태 구별). 분기 미지원으로 이후 공정 진행 안 함`);
    if (s.material && p.materials[0]?.states.includes('식별실패')) s.material.state = '식별실패';
    return;
  }
  if (m && a.effect.setState) m.state = a.effect.setState;
  // post conditions evaluated on tentative state; failure → no silent commit
  const tentative: RuntimeState = { ...s, material: m, occupancy: occ };
  for (const c of a.post) {
    const r = evalCond(c, tentative);
    if (!r.ok) { fail(s, 'POST_UNMET', step.id, `[${step.name}] 완료 후 조건 미충족: ${r.why} — 상태 변경 커밋 안 함`); return; }
  }
  s.material = m; s.occupancy = occ;
  if (a.commandSignalId) s.signals[a.commandSignalId] = false;
  // other completion signals of same device become false (mutually exclusive device states — prototype assumption)
  for (const sg of p.signals) if (sg.deviceId === a.deviceId && sg.role === 'complete' && sg.id !== a.completeSignalId) s.signals[sg.id] = false;
  if (a.targetPositionId) s.devicePositions[a.deviceId] = a.targetPositionId;
  const rec = s.steps[s.stepIndex]; rec.status = 'done'; rec.endMs = s.timeMs;
  s.log.push({ t: s.timeMs, level: 'info', code: 'STEP_DONE', message: `[${step.name}] 완료 — 자재 ${m ? `${m.location}/${m.state}${m.holder ? `/잡음:${m.holder}` : ''}` : '없음'}`, refId: step.id });
  s.active = null;
  s.stepIndex += 1;
}

/** Advance virtual time by dtMs (>=0). Result is independent of how dt is chunked. */
export function advance(rt: Runtime, dtMs: number): Runtime {
  if (rt.state.status !== 'running' || dtMs < 0) return rt;
  const p = rt.snapshot;
  const s = structuredClone(rt.state);
  const target = s.timeMs + Math.round(dtMs);
  let guard = 0;
  while (s.status === 'running' && guard++ < 10000) {
    if (!s.active) {
      if (s.stepIndex >= p.sequence.steps.length) {
        s.status = 'completed';
        s.log.push({ t: s.timeMs, level: 'info', code: 'RUN_COMPLETE', message: `시퀀스 완료 — 최종 자재 ${s.material?.location}/${s.material?.state}` });
        break;
      }
      activate(p, s);
      continue;
    }
    const { completeAtMs, timeoutAtMs } = s.active;
    const isComplete = completeAtMs !== null && completeAtMs <= timeoutAtMs;
    const next = isComplete ? completeAtMs! : timeoutAtMs;
    if (next > target) break;
    s.timeMs = next;
    if (isComplete) complete(p, s);
    else {
      const step = p.sequence.steps[s.stepIndex];
      const a = p.actions.find((x) => x.id === step.actionId)!;
      fail(s, 'TIMEOUT', step.id, `[${step.name}] 타임아웃 — 완료 Signal ${a.completeSignalId} 미발생. 이후 공정 통과 안 함`);
    }
  }
  if (s.status === 'running') s.timeMs = Math.max(s.timeMs, target);
  return { ...rt, state: s };
}

/** Run to the end (or error) — convenience for tests and "끝까지 실행". */
export function runToEnd(rt: Runtime, maxMs = 3_600_000): Runtime {
  let r = rt.state.status === 'idle' ? start(rt) : rt;
  while (r.state.status === 'running' && r.state.timeMs < maxMs) r = advance(r, 60_000);
  return r;
}
