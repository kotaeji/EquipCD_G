// Deterministic logic runtime (C04). Pure functions; virtual time in integer milliseconds.
// Evaluation order at one virtual instant (prototype rule, 설계 제안):
//   1) sensor signals follow the material's current Unit (applySensorSignals)
//   2) activate next step (check entry+pre)  3) completion vs timeout
//   4) apply transition (post check → effect commit → sensor signals again)  5) record log.
// Tie rule (prototype assumption): completion at exactly the timeout instant counts as success.
// This is NOT equipment control and NOT physics simulation.
import type { Action, Condition, FlowNode, Project } from '../model/types';
import { collectStepIds, flowUsesSignal, hasFlow, walk } from '../model/flow';
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

export interface StepRecord {
  stepId: string;
  status: 'pending' | 'active' | 'done' | 'error' | 'skipped';
  startMs?: number;
  endMs?: number;
  /** 1-based time this step has started (loop / retry). */
  pass?: number;
  /** Parallel lane or Substation sequence name. */
  lane?: string;
}

export interface ActiveStep {
  stepIndex: number;
  startMs: number;
  completeAtMs: number | null;
  timeoutAtMs: number;
  /** Set when a flow is running. Linear runs keep using stepIndex only. */
  stepId?: string;
}

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
  /** How many times a read action has been attempted under "fail the first N". Absent unless that fault is set. */
  readFailSeen?: Record<string, number>;
  /** Control-flow cursor. Present only when `sequence.flow` is an array. */
  flowRun?: FlowRunState;
}

export interface FlowFrame {
  role: 'seq' | 'loop' | 'retry';
  nodes: FlowNode[];
  index: number;
  count?: number;
  iter?: number;
  maxRetries?: number;
  attempt?: number;
  until?: Condition;
  blockId?: string;
  name?: string;
}

export interface FlowFiber {
  id: number;
  status: 'live' | 'joining' | 'done';
  stack: FlowFrame[];
  active: { recordIndex: number; stepId: string; stepIndex: number; startMs: number; completeAtMs: number | null; timeoutAtMs: number } | null;
  parentId?: number;
  lane?: string;
  join?: { childIds: number[]; message: string };
}

export interface FlowRunState { fibers: FlowFiber[]; nextId: number }

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
  const flow = hasFlow(p);
  const state: RuntimeState = {
    rulesVersion: RUNTIME_RULES_VERSION, runId, modelRevision: p.revision, status: 'idle', timeMs: 0, stepIndex: 0, active: null,
    signals, devicePositions, material, occupancy,
    steps: flow
      ? collectStepIds(p.sequence.flow ?? []).map((stepId) => ({ stepId, status: 'pending' as const }))
      : p.sequence.steps.map((s) => ({ stepId: s.id, status: 'pending' as const })),
    log: [], error: null, blockers: [],
  };
  if (flow) {
    state.flowRun = {
      nextId: 2,
      fibers: [{ id: 1, status: 'live', stack: [{ role: 'seq', nodes: p.sequence.flow ?? [], index: 0 }], active: null }],
    };
  }
  applySensorSignals(p, state);
  return state;
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

/** Shown when a sensor-role condition fails. Sensor values are the material's Unit, not a separate input. */
export const SENSOR_HINT = '센서는 자재가 이 Unit 에 있을 때 켜집니다';

/** Device name and signal name. Runtime messages use this instead of the signal id. */
export function signalLabel(p: Project, signalId: string | null | undefined): string {
  if (!signalId) return '(없음)';
  const sig = p.signals.find((x) => x.id === signalId);
  if (!sig) return '없는 신호';
  const dev = p.devices.find((d) => d.id === sig.deviceId);
  return `${dev?.name ?? '장치 없음'} · ${sig.name}`;
}

export function unmetText(r: { why: string; sensor: boolean }): string {
  return r.sensor ? `${r.why} — ${SENSOR_HINT}` : r.why;
}

/**
 * Sensor signal (`role === 'sensor'`) is true iff the material is currently in that signal's Device Unit.
 * Other roles are left alone. A change is one log line (`SENSOR_ON` / `SENSOR_OFF`) with the signal name.
 * Station and Substation group runtimes both call this.
 */
export function applySensorSignals(p: Project, s: { timeMs: number; signals: Record<string, boolean>; material: MaterialInstance | null; log: LogEntry[] }): void {
  const loc = s.material && s.material.location !== 'EXIT' ? s.material.location : null;
  for (const sig of p.signals) {
    if (sig.role !== 'sensor') continue;
    const dev = p.devices.find((d) => d.id === sig.deviceId);
    const next = !!dev && dev.unitId === loc;
    const prev = s.signals[sig.id] ?? false;
    if (prev === next) continue;
    s.signals[sig.id] = next;
    s.log.push({
      t: s.timeMs, level: 'info', code: next ? 'SENSOR_ON' : 'SENSOR_OFF',
      message: `${signalLabel(p, sig.id)} ${next ? 'ON' : 'OFF'}`, refId: sig.id,
    });
  }
}

export function evalCond(c: Condition, s: Pick<RuntimeState, "signals" | "material">, p: Project): { ok: boolean; why: string; sensor: boolean } {
  switch (c.kind) {
    case 'signal': {
      const sig = p.signals.find((x) => x.id === c.signalId);
      return { ok: (s.signals[c.signalId] ?? false) === c.equals, why: `${signalLabel(p, c.signalId)} == ${c.equals}`, sensor: sig?.role === 'sensor' };
    }
    case 'materialAt': return { ok: s.material?.location === c.unitId, why: `자재 위치 == ${c.unitId}`, sensor: false };
    case 'materialState': return { ok: s.material?.state === c.state, why: `자재 상태 == ${c.state}`, sensor: false };
    case 'materialHeldBy': return { ok: (s.material?.holder ?? null) === c.deviceId, why: `자재 holder == ${c.deviceId ?? '없음'}`, sensor: false };
    case 'undefined': return { ok: false, why: `미정 조건: ${c.note}`, sensor: false };
  }
}

function fail(s: RuntimeState, code: string, stepId: string | null, message: string) {
  s.status = 'error';
  s.error = { code, stepId, message };
  if (stepId) { const r = s.steps.find((x) => x.stepId === stepId); if (r) { r.status = 'error'; r.endMs = s.timeMs; } }
  s.log.push({ t: s.timeMs, level: 'error', code, message, refId: stepId ?? undefined });
}

function activate(p: Project, s: RuntimeState) {
  applySensorSignals(p, s);
  const step = p.sequence.steps[s.stepIndex];
  const a = p.actions.find((x) => x.id === step.actionId) as Action;
  for (const c of [...step.entry, ...a.pre]) {
    const r = evalCond(c, s, p);
    if (!r.ok) { fail(s, 'PRE_UNMET', step.id, `[${step.name}] 전제 조건 미충족: ${unmetText(r)} — 다른 진행 주체가 없어 대기하지 않고 오류 처리`); return; }
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
  s.log.push({ t: s.timeMs, level: 'info', code: 'STEP_START', message: `[${step.name}] 시작 — 명령 ${signalLabel(p, a.commandSignalId)}=ON, 완료조건 ${signalLabel(p, a.completeSignalId)}=true 대기 (가정 ${a.duration.value}s, 타임아웃 ${timeout}s)`, refId: step.id });
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
    const r = evalCond(c, tentative, p);
    if (!r.ok) { fail(s, 'POST_UNMET', step.id, `[${step.name}] 완료 후 조건 미충족: ${unmetText(r)} — 상태 변경 커밋 안 함`); return; }
  }
  s.material = m; s.occupancy = occ;
  if (a.commandSignalId) s.signals[a.commandSignalId] = false;
  // other completion signals of same device become false (mutually exclusive device states — prototype assumption)
  for (const sg of p.signals) if (sg.deviceId === a.deviceId && sg.role === 'complete' && sg.id !== a.completeSignalId) s.signals[sg.id] = false;
  if (a.targetPositionId) s.devicePositions[a.deviceId] = a.targetPositionId;
  applySensorSignals(p, s);
  const rec = s.steps[s.stepIndex]; rec.status = 'done'; rec.endMs = s.timeMs;
  s.log.push({ t: s.timeMs, level: 'info', code: 'STEP_DONE', message: `[${step.name}] 완료 — 자재 ${m ? `${m.location}/${m.state}${m.holder ? `/잡음:${m.holder}` : ''}` : '없음'}`, refId: step.id });
  s.active = null;
  s.stepIndex += 1;
}

/** Advance virtual time by dtMs (>=0). Result is independent of how dt is chunked. */
export function advance(rt: Runtime, dtMs: number): Runtime {
  if (rt.state.status !== 'running' || dtMs < 0) return rt;
  if (rt.state.flowRun) return advanceFlow(rt, dtMs);
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
      fail(s, 'TIMEOUT', step.id, `[${step.name}] 타임아웃 — 완료 신호 ${signalLabel(p, a.completeSignalId)} 미발생. 이후 공정 통과 안 함`);
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

// --- flow interpreter (sequence.flow). The linear path above is unchanged. ---

function locateStep(p: Project, stepId: string): { step: Project['sequence']['steps'][number]; action: Action } | null {
  const step = p.sequence.steps.find((s) => s.id === stepId)
    ?? (p.substationSequences ?? []).flatMap((q) => q.steps).find((s) => s.id === stepId);
  const action = step ? p.actions.find((a) => a.id === step.actionId) : undefined;
  return step && action ? { step, action } : null;
}

function logAt(s: RuntimeState, level: LogEntry['level'], code: string, message: string, refId?: string) {
  s.log.push({ t: s.timeMs, level, code, message, refId });
}

function failFlow(s: RuntimeState, code: string, stepId: string | null, message: string) {
  s.status = 'error';
  s.error = { code, stepId, message };
  if (stepId) {
    const rec = [...s.steps].reverse().find((r) => r.stepId === stepId && (r.status === 'active' || r.status === 'pending'));
    if (rec) { rec.status = 'error'; rec.endMs = s.timeMs; if (rec.startMs === undefined) rec.startMs = s.timeMs; }
  }
  logAt(s, 'error', code, message, stepId ?? undefined);
}

function readIsFailing(p: Project, s: RuntimeState, actionId: string): boolean {
  const faults = p.simSettings.faults;
  if (!faults.readFailActionIds.includes(actionId)) return false;
  const limit = faults.readFailFirstN?.[actionId];
  if (limit === undefined) return true;
  const n = (s.readFailSeen?.[actionId] ?? 0) + 1;
  s.readFailSeen = { ...(s.readFailSeen ?? {}), [actionId]: n };
  return n <= limit;
}

function resultOf(p: Project, action: Action) {
  return p.signals.find((sig) => sig.deviceId === action.deviceId && sig.role === 'result');
}

function beginRecord(s: RuntimeState, stepId: string, lane?: string): number {
  const started = s.steps.filter((r) => r.stepId === stepId && r.pass != null).length;
  const pass = started + 1;
  const pending = s.steps.findIndex((r) => r.stepId === stepId && r.status === 'pending' && r.pass == null);
  if (pending >= 0 && pass === 1) {
    const rec = s.steps[pending];
    rec.pass = 1; rec.status = 'active'; rec.startMs = s.timeMs;
    if (lane) rec.lane = lane;
    return pending;
  }
  s.steps.push({ stepId, status: 'active', startMs: s.timeMs, pass, ...(lane ? { lane } : {}) });
  return s.steps.length - 1;
}

function skipTree(s: RuntimeState, nodes: FlowNode[]) {
  walk(nodes, (n) => {
    if (n.kind !== 'step') return;
    const i = s.steps.findIndex((r) => r.stepId === n.stepId && r.status === 'pending');
    if (i >= 0) s.steps[i].status = 'skipped';
    else if (!s.steps.some((r) => r.stepId === n.stepId && r.status === 'skipped')) s.steps.push({ stepId: n.stepId, status: 'skipped' });
  });
}

function syncCursor(s: RuntimeState) {
  const act = (s.flowRun?.fibers ?? []).filter((f) => f.active).sort((a, b) => a.id - b.id);
  if (!act.length) { s.active = null; return; }
  const a = act[0].active!;
  s.stepIndex = a.stepIndex;
  s.active = { stepIndex: a.stepIndex, startMs: a.startMs, completeAtMs: a.completeAtMs, timeoutAtMs: a.timeoutAtMs, stepId: a.stepId };
}

function top(f: FlowFiber): FlowFrame | undefined { return f.stack[f.stack.length - 1]; }

function wakeParent(s: RuntimeState, fiber: FlowFiber) {
  if (fiber.parentId == null || !s.flowRun) return;
  const parent = s.flowRun.fibers.find((f) => f.id === fiber.parentId);
  if (!parent?.join) return;
  const kids = parent.join.childIds.map((id) => s.flowRun!.fibers.find((f) => f.id === id));
  if (kids.every((k) => k?.status === 'done')) {
    const message = parent.join.message;
    parent.join = undefined;
    parent.status = 'live';
    logAt(s, 'info', 'PAR_JOIN', message);
  }
}

function finishFiber(s: RuntimeState, fiber: FlowFiber) {
  fiber.status = 'done';
  fiber.active = null;
  if (fiber.parentId != null) logAt(s, 'info', 'SEQ_COMPLETE', `[${fiber.lane ?? '갈래'}] 시퀀스 완료`);
  wakeParent(s, fiber);
}

function finishFrame(p: Project, s: RuntimeState, fiber: FlowFiber) {
  const frame = top(fiber);
  if (!frame) { finishFiber(s, fiber); return; }
  if (frame.role === 'loop') {
    const iter = frame.iter ?? 1;
    const count = frame.count ?? 1;
    if (iter < count) {
      frame.iter = iter + 1;
      frame.index = 0;
      logAt(s, 'info', 'LOOP_ITER', `${frame.name ?? '반복'} ${frame.iter}/${count}`, frame.blockId);
      return;
    }
    fiber.stack.pop();
    if (!top(fiber)) finishFiber(s, fiber);
    return;
  }
  if (frame.role === 'retry') {
    const until = frame.until!;
    const verdict = evalCond(until, s, p);
    const used = frame.attempt ?? 0;
    const max = frame.maxRetries ?? 0;
    if (verdict.ok) { fiber.stack.pop(); if (!top(fiber)) finishFiber(s, fiber); return; }
    if (used < max) {
      frame.attempt = used + 1;
      frame.index = 0;
      logAt(s, 'warn', 'RETRY', `${frame.name ?? '재시도'} ${frame.attempt}/${max} — ${verdict.why}`, frame.blockId);
      return;
    }
    logAt(s, 'warn', 'RETRY_EXHAUSTED', `${frame.name ?? '재시도'} ${used}/${max} — ${verdict.why}`, frame.blockId);
    fiber.stack.pop();
    if (!top(fiber)) finishFiber(s, fiber);
    return;
  }
  fiber.stack.pop();
  if (!top(fiber)) finishFiber(s, fiber);
}

function activateFiber(p: Project, s: RuntimeState, fiber: FlowFiber, stepId: string) {
  applySensorSignals(p, s);
  const found = locateStep(p, stepId);
  if (!found) { failFlow(s, 'REF_MISSING_ACTION', stepId, `단계 ${stepId} 의 Action 을 찾을 수 없음`); return; }
  const { step, action: a } = found;
  const recordIndex = beginRecord(s, step.id, fiber.lane);
  for (const c of [...step.entry, ...a.pre]) {
    const r = evalCond(c, s, p);
    if (!r.ok) { failFlow(s, 'PRE_UNMET', step.id, `[${step.name}] 전제 조건 미충족: ${unmetText(r)} — 다른 진행 주체가 없어 대기하지 않고 오류 처리`); return; }
  }
  if (a.completeSignalId) s.signals[a.completeSignalId] = false;
  if (a.commandSignalId) s.signals[a.commandSignalId] = true;
  const timeout = (step.timeoutOverride ?? a.timeout).value ?? 0;
  const neverTrue = a.completeSignalId ? p.simSettings.faults.neverTrueSignalIds.includes(a.completeSignalId) : true;
  const stepIndex = p.sequence.steps.findIndex((x) => x.id === step.id);
  fiber.active = {
    recordIndex, stepId: step.id, stepIndex,
    startMs: s.timeMs, completeAtMs: neverTrue ? null : s.timeMs + ms(a.duration.value), timeoutAtMs: s.timeMs + ms(timeout),
  };
  const lane = fiber.lane ? `${fiber.lane} ` : '';
  logAt(s, 'info', 'STEP_START', `[${lane}${step.name}] 시작 — 명령 ${signalLabel(p, a.commandSignalId)}=ON, 완료조건 ${signalLabel(p, a.completeSignalId)}=true 대기 (가정 ${a.duration.value}s, 타임아웃 ${timeout}s)`, step.id);
}

function spawnLanes(s: RuntimeState, parent: FlowFiber, lists: FlowNode[][], labels: string[], message: string) {
  if (!s.flowRun) return;
  parent.status = 'joining';
  const childIds: number[] = [];
  lists.forEach((nodes, i) => {
    const id = s.flowRun!.nextId++;
    childIds.push(id);
    s.flowRun!.fibers.push({
      id, status: 'live', parentId: parent.id, lane: labels[i], active: null,
      stack: [{ role: 'seq', nodes, index: 0 }],
    });
  });
  parent.join = { childIds, message };
}

function enterNode(p: Project, s: RuntimeState, fiber: FlowFiber, node: FlowNode) {
  const frame = top(fiber)!;
  if (node.kind === 'step') { activateFiber(p, s, fiber, node.stepId); return; }
  frame.index += 1;
  if (node.kind === 'branch') {
    const verdict = evalCond(node.cond, s, p);
    const takeThen = verdict.ok;
    logAt(s, 'info', 'BRANCH_TAKEN', `${node.name} ${takeThen ? '참' : '거짓'} — ${verdict.why}`, node.id);
    skipTree(s, takeThen ? node.else : node.then);
    fiber.stack.push({ role: 'seq', nodes: takeThen ? node.then : node.else, index: 0 });
    return;
  }
  if (node.kind === 'loop') {
    logAt(s, 'info', 'LOOP_ITER', `${node.name} 1/${node.count}`, node.id);
    fiber.stack.push({ role: 'loop', nodes: node.body, index: 0, count: node.count, iter: 1, blockId: node.id, name: node.name });
    return;
  }
  if (node.kind === 'retry') {
    fiber.stack.push({ role: 'retry', nodes: node.body, index: 0, maxRetries: node.maxRetries, attempt: 0, until: node.until, blockId: node.id, name: node.name });
    return;
  }
  if (node.kind === 'parallel') {
    if (node.lanes.length === 0) { logAt(s, 'info', 'PAR_JOIN', `${node.name} 합류`); return; }
    spawnLanes(s, fiber, node.lanes, node.lanes.map((_, i) => `갈래 ${i + 1}`), `${node.name} 합류`);
    return;
  }
  const unit = p.units.find((u) => u.id === node.unitId);
  const seqs = (p.substationSequences ?? []).filter((q) => q.unitId === node.unitId);
  if (seqs.length === 0) { logAt(s, 'info', 'PAR_JOIN', `${unit?.name ?? node.unitId} Substation 합류`); return; }
  spawnLanes(
    s, fiber,
    seqs.map((q) => q.steps.map((step) => ({ kind: 'step' as const, stepId: step.id }))),
    seqs.map((q) => q.name),
    `${unit?.name ?? node.unitId} Substation 합류`,
  );
}

function progressFiber(p: Project, s: RuntimeState, fiber: FlowFiber) {
  const frame = top(fiber);
  if (!frame) { finishFiber(s, fiber); return; }
  if (frame.index >= frame.nodes.length) { finishFrame(p, s, fiber); return; }
  enterNode(p, s, fiber, frame.nodes[frame.index]);
}

function completeFiber(p: Project, s: RuntimeState, fiber: FlowFiber) {
  const active = fiber.active;
  if (!active) return;
  const found = locateStep(p, active.stepId);
  if (!found) { failFlow(s, 'REF_MISSING_ACTION', active.stepId, `단계 ${active.stepId} 의 Action 을 찾을 수 없음`); return; }
  const { step, action: a } = found;
  if (a.completeSignalId) s.signals[a.completeSignalId] = true;
  const readFail = readIsFailing(p, s, a.id);
  const resultSig = a.kind === 'read' ? resultOf(p, a) : undefined;
  const keepGoing = readFail && !!resultSig && !!p.sequence.flow && flowUsesSignal(p.sequence.flow, resultSig.id);
  if (a.kind === 'read' && resultSig) s.signals[resultSig.id] = !readFail;
  if (readFail && !keepGoing) {
    if (s.material && p.materials[0]?.states.includes('식별실패')) s.material.state = '식별실패';
    failFlow(s, 'READ_FAILED', step.id, `[${step.name}] 읽기 완료, 결과=실패 (식별 실패 상태 구별). 분기 미지원으로 이후 공정 진행 안 함`);
    return;
  }
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
        if (used >= cap) { failFlow(s, 'CAPACITY_FULL', step.id, `[${step.name}] ${unit.name} 수용 불가 (물류 수용 불가 — 논리 조건과 별개)`); return; }
      }
      if (m.location !== 'EXIT') occ[m.location] = null;
      m.location = to;
      if (to !== 'EXIT') occ[to] = m.instanceId;
    }
    if (a.effect.setState && !(readFail && keepGoing)) m.state = a.effect.setState;
  }
  const tentative: RuntimeState = { ...s, material: m, occupancy: occ };
  for (const c of a.post) {
    const r = evalCond(c, tentative, p);
    if (!r.ok) { failFlow(s, 'POST_UNMET', step.id, `[${step.name}] 완료 후 조건 미충족: ${unmetText(r)} — 상태 변경 커밋 안 함`); return; }
  }
  s.material = m; s.occupancy = occ;
  if (a.commandSignalId) s.signals[a.commandSignalId] = false;
  for (const sg of p.signals) if (sg.deviceId === a.deviceId && sg.role === 'complete' && sg.id !== a.completeSignalId) s.signals[sg.id] = false;
  if (a.targetPositionId) s.devicePositions[a.deviceId] = a.targetPositionId;
  applySensorSignals(p, s);
  const rec = s.steps[active.recordIndex];
  if (rec) { rec.status = 'done'; rec.endMs = s.timeMs; }
  const lane = fiber.lane ? `${fiber.lane} ` : '';
  logAt(s, 'info', 'STEP_DONE', `[${lane}${step.name}] 완료 — 자재 ${m ? `${m.location}/${m.state}${m.holder ? `/잡음:${m.holder}` : ''}` : '없음'}`, step.id);
  fiber.active = null;
  const frame = top(fiber);
  if (frame) frame.index += 1;
}

function advanceFlow(rt: Runtime, dtMs: number): Runtime {
  const p = rt.snapshot;
  const s = structuredClone(rt.state);
  const target = s.timeMs + Math.round(dtMs);
  let guard = 0;
  while (s.status === 'running' && guard++ < 100000) {
    const run = s.flowRun;
    if (!run) break;
    const idle = run.fibers.filter((f) => f.status === 'live' && !f.active).sort((a, b) => a.id - b.id);
    if (idle.length) { progressFiber(p, s, idle[0]); continue; }
    if (s.status !== 'running') break;
    const pending = run.fibers.some((f) => f.status === 'live' || f.active);
    if (!pending) {
      s.status = 'completed';
      logAt(s, 'info', 'RUN_COMPLETE', `시퀀스 완료 — 최종 자재 ${s.material?.location}/${s.material?.state}`);
      break;
    }
    let next = Infinity;
    let who: FlowFiber | null = null;
    let isComplete = false;
    for (const f of [...run.fibers].sort((a, b) => a.id - b.id)) {
      if (!f.active) continue;
      const c = f.active.completeAtMs !== null && f.active.completeAtMs <= f.active.timeoutAtMs;
      const t = c ? f.active.completeAtMs! : f.active.timeoutAtMs;
      if (t < next) { next = t; who = f; isComplete = c; }
    }
    if (!who || next > target) break;
    s.timeMs = next;
    if (isComplete) completeFiber(p, s, who);
    else {
      const found = locateStep(p, who.active!.stepId);
      const step = found?.step;
      const a = found?.action;
      failFlow(s, 'TIMEOUT', step?.id ?? who.active!.stepId, `[${step?.name ?? who.active!.stepId}] 타임아웃 — 완료 신호 ${signalLabel(p, a?.completeSignalId)} 미발생. 이후 공정 통과 안 함`);
    }
  }
  if (s.status === 'running') s.timeMs = Math.max(s.timeMs, target);
  syncCursor(s);
  return { ...rt, state: s };
}
