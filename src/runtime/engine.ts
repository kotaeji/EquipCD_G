// Deterministic logic runtime (C04). Pure functions; virtual time in integer milliseconds.
// Evaluation order at one virtual instant (prototype rule, 설계 제안):
//   1) sensor signals follow the material's current Unit (applySensorSignals)
//   2) activate next step (check entry+pre)  3) completion vs timeout
//   4) apply transition (post check → effect commit → sensor signals again)  5) record log.
// Tie rule (prototype assumption): completion at exactly the timeout instant counts as success.
// This is NOT equipment control and NOT physics simulation.
import type { Action, Condition, FlowNode, Project } from '../model/types';
import { collectStepIds, conditionText, flowUsesSignal, hasFlow, stepOrder, walk } from '../model/flow';
import { RUNTIME_RULES_VERSION } from '../model/types';
import { checkRunReadiness, type Diagnostic } from '../model/validate';
import { judgeInterlock, type InterlockBlockRecord, type InterlockHit } from './interlock';
import { admitPieces, advancePieces, makePieces, seatPieces } from './multi';

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
  status: 'pending' | 'active' | 'done' | 'error' | 'skipped' | 'stopped';
  startMs?: number;
  endMs?: number;
  /** 1-based time this step has started (loop / retry). */
  pass?: number;
  /** Parallel lane, Substation sequence, or `개체 N` when several pieces run. */
  lane?: string;
  /** Set on a multi-piece run. The piece that executed this row. */
  instanceId?: string;
  /** Time this piece waited before or during the row. */
  waitMs?: number;
  /** Why it waited (Device 사용 중 / Unit 가득 / 신호 기다림). */
  waitNote?: string;
  /** Set when this row is a signal-wait block, not an Action step. `stepId` is the block id. */
  waitBlockId?: string;
  /** Condition text kept on a signal-wait row. */
  condText?: string;
}

/** One Substation flow node held still while the rest of the run continues. */
export interface PausedSubstation {
  nodeId: string;
  unitId: string;
  /** Virtual time when this pause began. Action deadlines shift by the pause length on resume. */
  sinceMs: number;
}

/** Why a piece is standing still. Charged to `unitId` for the bottleneck. */
export interface PieceWait {
  reason: 'device' | 'capacity' | 'interlock';
  sinceMs: number;
  unitId: string;
  note: string;
}

export interface PieceActive {
  stepIndex: number;
  startMs: number;
  completeAtMs: number | null;
  timeoutAtMs: number;
  recordIndex: number;
  /** The action time has elapsed and the move is waiting for a free unit. */
  hold: boolean;
}

/** One fed instance. Present only when the feed count is 2 or more. */
export interface PieceRun {
  index: number;
  instanceId: string;
  material: MaterialInstance;
  stepIndex: number;
  phase: 'queued' | 'ready' | 'active' | 'waiting' | 'done';
  active: PieceActive | null;
  /** Virtual time at which this piece may enter. `(index - 1) × feed interval`. */
  readyAtMs: number;
  fedAtMs: number | null;
  exitedAtMs: number | null;
  waitMs: number;
  waitByUnit: Record<string, number>;
  wait: PieceWait | null;
  pendingWaitMs: number;
  pendingWaitNote: string;
  /** Index into the flat step plan (`stepOrder`). Equals `stepIndex` when the plan is the step array. */
  planCursor: number;
  /**
   * This piece's own flow. Set only when the station flow has blocks.
   * Absent on a flat sequence — that path stays the TURN-040 interpreter.
   */
  flow?: FlowRunState;
  /** Command, complete, and result signals this piece has written. Sensors stay shared. */
  signals?: Record<string, boolean>;
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
  /** Fed instances. Absent when the feed count is 1 — that path is unchanged. */
  pieces?: PieceRun[];
  occupancy: Record<string, string | null>;
  steps: StepRecord[];
  log: LogEntry[];
  error: { code: string; stepId: string | null; message: string } | null;
  blockers: Diagnostic[];
  /** Interlock stops. Empty when none has fired. */
  interlockBlocks: InterlockBlockRecord[];
  /** How many times a read action has been attempted under "fail the first N". Absent unless that fault is set. */
  readFailSeen?: Record<string, number>;
  /** Control-flow cursor. Present only when `sequence.flow` is an array. */
  flowRun?: FlowRunState;
  /** Substation nodes held still. Absent when none are paused. */
  pausedSubstations?: PausedSubstation[];
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
  /** Mutex hold. The step has not started. */
  wait?: { sinceMs: number; note: string; interlockId: string };
  /** Signal-wait block in progress. The fiber is not running an Action. */
  holding?: {
    blockId: string;
    name: string;
    cond: Condition;
    sinceMs: number;
    timeoutAtMs: number;
    recordIndex: number;
  };
  /** Set on fibers spawned for one Substation step. */
  owner?: { kind: 'substation'; nodeId: string; unitId: string };
  /** This Substation is paused. Deadlines stay put until resume shifts them. */
  frozen?: boolean;
  /** Action time has elapsed and the move is waiting for a free unit. Not a second timeout. */
  pendingCommit?: boolean;
  /** This fiber is waiting for a device, a unit, or an interlock. Charged when it ends. */
  blocked?: { sinceMs: number; unitId: string; note: string; reason: 'device' | 'capacity' | 'interlock' };
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
  const flow = hasFlow(p);
  // A flow of only step nodes is the same list, in that order. Blocks get one flow per piece (TURN-071).
  const linear = stepOrder(p);
  const pieces = linear ? makePieces(p) : attachFlowPieces(makePieces(p), p);
  let material: MaterialInstance | null = null;
  if (!pieces && m && m.initialLocation && m.initialState) {
    material = { instanceId: `${m.id}#1`, materialId: m.id, location: m.initialLocation, state: m.initialState, holder: null };
    occupancy[m.initialLocation] = material.instanceId;
  }
  const devicePositions: Record<string, string | null> = {};
  for (const d of p.devices) devicePositions[d.id] = null;
  const state: RuntimeState = {
    rulesVersion: RUNTIME_RULES_VERSION, runId, modelRevision: p.revision, status: 'idle', timeMs: 0, stepIndex: 0, active: null,
    signals, devicePositions, material, occupancy,
    steps: pieces
      ? []
      : flow
        ? collectStepIds(p.sequence.flow ?? []).map((stepId) => ({ stepId, status: 'pending' as const }))
        : p.sequence.steps.map((s) => ({ stepId: s.id, status: 'pending' as const })),
    log: [], error: null, blockers: [], interlockBlocks: [],
    ...(pieces ? { pieces } : {}),
  };
  if (flow && !pieces) {
    state.flowRun = {
      nextId: 2,
      fibers: [{ id: 1, status: 'live', stack: [{ role: 'seq', nodes: p.sequence.flow ?? [], index: 0 }], active: null }],
    };
  }
  if (pieces) seatPieces(p, state);
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
export function applySensorSignals(p: Project, s: { timeMs: number; signals: Record<string, boolean>; material: MaterialInstance | null; log: LogEntry[]; pieces?: { phase: string; material: MaterialInstance }[] }): void {
  const locs = new Set<string>();
  if (s.pieces && s.pieces.length) {
    for (const pc of s.pieces) {
      if (pc.phase === 'queued') continue;
      if (pc.material.location && pc.material.location !== 'EXIT') locs.add(pc.material.location);
    }
  } else if (s.material && s.material.location !== 'EXIT') locs.add(s.material.location);
  for (const sig of p.signals) {
    if (sig.role !== 'sensor') continue;
    const dev = p.devices.find((d) => d.id === sig.deviceId);
    const next = !!dev && locs.has(dev.unitId);
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

function pushBlock(s: RuntimeState, stepId: string, hit: InterlockHit) {
  s.interlockBlocks.push({
    t: s.timeMs, interlockId: hit.interlockId, description: hit.description,
    stepId, stepName: hit.stepName, reason: hit.reason,
  });
}

function flowActiveActionIds(p: Project, s: RuntimeState, exceptFiber?: FlowFiber): string[] {
  const ids: string[] = [];
  const fibers = s.pieces?.some((pc) => pc.flow) ? everyFiber(s) : (s.flowRun?.fibers ?? []);
  for (const fiber of fibers) {
    if (!fiber.active || fiber === exceptFiber) continue;
    const found = locateStep(p, fiber.active.stepId);
    if (found) ids.push(found.action.id);
  }
  return ids;
}

function activate(p: Project, s: RuntimeState) {
  applySensorSignals(p, s);
  const step = p.sequence.steps[s.stepIndex];
  const a = p.actions.find((x) => x.id === step.actionId) as Action;
  const gate = judgeInterlock(p, a.id, step.name, [], false, (c) => evalCond(c, s, p), unmetText);
  if (gate.kind === 'block') {
    pushBlock(s, step.id, gate.hit);
    const rec = s.steps[s.stepIndex];
    if (rec && rec.startMs === undefined) rec.startMs = s.timeMs;
    fail(s, 'INTERLOCK_BLOCK', step.id, gate.hit.message);
    return;
  }
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
  if (rt.state.pieces && rt.state.pieces.length > 1) {
    if (rt.state.pieces.some((pc) => pc.flow)) return advanceFlowPieces(rt, dtMs);
    return advancePieces(rt, dtMs);
  }
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

/** Run to the end (or error) — convenience for tests and "끝까지 실행". A paused Substation stops the scan and says so. */
export function runToEnd(rt: Runtime, maxMs = 3_600_000): Runtime {
  let r = rt.state.status === 'idle' ? start(rt) : rt;
  while (r.state.status === 'running' && r.state.timeMs < maxMs) {
    const before = r.state.timeMs;
    r = advance(r, 60_000);
    if (r.state.status === 'running' && r.state.timeMs === before) {
      const n = r.state.pausedSubstations?.length ?? 0;
      if (n > 0) {
        const s = structuredClone(r.state);
        s.log.push({ t: s.timeMs, level: 'info', code: 'SUB_PAUSE_HOLD', message: `Substation ${n}개 일시정지 중 — 멈춘 곳까지만 실행했습니다` });
        return { ...r, state: s };
      }
      break;
    }
  }
  return r;
}

function substationName(p: Project, unitId: string): string {
  return p.units.find((u) => u.id === unitId)?.name ?? unitId;
}

function substationFibers(s: RuntimeState): FlowFiber[] {
  if (s.pieces?.some((pc) => pc.flow)) return s.pieces.flatMap((pc) => pc.flow?.fibers ?? []);
  return s.flowRun?.fibers ?? [];
}

/** Hold one in-progress Substation step. Other lanes and the virtual clock keep going. */
export function pauseSubstation(rt: Runtime, nodeId: string): Runtime {
  if (rt.state.status !== 'running') return rt;
  if (!rt.state.flowRun && !rt.state.pieces?.some((pc) => pc.flow)) return rt;
  if (rt.state.pausedSubstations?.some((row) => row.nodeId === nodeId)) return rt;
  const live = substationFibers(rt.state).filter((f) => f.owner?.nodeId === nodeId && f.status !== 'done');
  if (live.length === 0) return rt;
  const s = structuredClone(rt.state);
  for (const fiber of substationFibers(s)) if (fiber.owner?.nodeId === nodeId) fiber.frozen = true;
  const unitId = live[0].owner!.unitId;
  s.pausedSubstations = [...(s.pausedSubstations ?? []), { nodeId, unitId, sinceMs: s.timeMs }];
  s.log.push({ t: s.timeMs, level: 'info', code: 'SUB_PAUSE', message: `Substation ${substationName(rt.snapshot, unitId)} 일시정지`, refId: nodeId });
  return { ...rt, state: s };
}

/** Continue a paused Substation. Remaining Action time and its timeout are kept. */
export function resumeSubstation(rt: Runtime, nodeId: string): Runtime {
  if (rt.state.status !== 'running') return rt;
  if (!rt.state.flowRun && !rt.state.pieces?.some((pc) => pc.flow)) return rt;
  const row = rt.state.pausedSubstations?.find((item) => item.nodeId === nodeId);
  if (!row) return rt;
  const s = structuredClone(rt.state);
  const dt = s.timeMs - row.sinceMs;
  for (const fiber of substationFibers(s)) {
    if (fiber.owner?.nodeId !== nodeId) continue;
    fiber.frozen = false;
    if (fiber.active && dt !== 0) {
      if (fiber.active.completeAtMs !== null) fiber.active.completeAtMs += dt;
      fiber.active.timeoutAtMs += dt;
    }
  }
  const rest = (s.pausedSubstations ?? []).filter((item) => item.nodeId !== nodeId);
  if (rest.length) s.pausedSubstations = rest;
  else delete s.pausedSubstations;
  s.log.push({ t: s.timeMs, level: 'info', code: 'SUB_RESUME', message: `Substation ${substationName(rt.snapshot, row.unitId)} 재개`, refId: nodeId });
  return { ...rt, state: s };
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
  // Other lanes were in progress when this error stopped the run. Close them as 정지, not 실행 중.
  for (const rec of s.steps) {
    if (rec.status === 'active') { rec.status = 'stopped'; rec.endMs = s.timeMs; }
  }
  for (const fiber of everyFiber(s)) {
    fiber.active = null;
    fiber.holding = undefined;
    fiber.pendingCommit = false;
    fiber.blocked = undefined;
    fiber.frozen = false;
  }
  s.active = null;
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

function ranRecord(rec: StepRecord): boolean {
  return rec.status === 'active' || rec.status === 'done' || rec.status === 'error' || rec.status === 'stopped';
}

function beginRecord(s: RuntimeState, stepId: string, lane?: string): number {
  const pieceId = activePiece(s)?.instanceId;
  const mine = (r: StepRecord) => pieceId == null || r.instanceId === pieceId;
  const started = s.steps.filter((r) => r.stepId === stepId && r.pass != null && mine(r)).length;
  const pass = started + 1;
  // A later pass executes a step this loop skipped earlier. Replace that skip; do not keep both.
  const skipped = s.steps.findIndex((r) => r.stepId === stepId && r.status === 'skipped' && mine(r));
  if (skipped >= 0) {
    const rec = s.steps[skipped];
    rec.status = 'active'; rec.startMs = s.timeMs; rec.pass = pass; delete rec.endMs;
    if (lane) rec.lane = lane;
    if (pieceId) rec.instanceId = pieceId;
    return skipped;
  }
  const pending = s.steps.findIndex((r) => r.stepId === stepId && r.status === 'pending' && r.pass == null && mine(r));
  if (pending >= 0 && pass === 1) {
    const rec = s.steps[pending];
    rec.pass = 1; rec.status = 'active'; rec.startMs = s.timeMs;
    if (lane) rec.lane = lane;
    if (pieceId) rec.instanceId = pieceId;
    return pending;
  }
  s.steps.push({ stepId, status: 'active', startMs: s.timeMs, pass, ...(lane ? { lane } : {}), ...(pieceId ? { instanceId: pieceId } : {}) });
  return s.steps.length - 1;
}

function skipTree(s: RuntimeState, nodes: FlowNode[]) {
  const piece = activePiece(s);
  const pieceId = piece?.instanceId;
  const lane = piece?.flow?.fibers[0]?.lane;
  walk(nodes, (n) => {
    if (n.kind !== 'step') return;
    const rows = s.steps.filter((r) => r.stepId === n.stepId && (pieceId == null || r.instanceId === pieceId));
    // Once a step has run, a later iteration must not add a skip beside that record.
    if (rows.some(ranRecord)) return;
    if (rows.some((r) => r.status === 'skipped')) return;
    if (pieceId == null) {
      const i = s.steps.findIndex((r) => r.stepId === n.stepId && r.status === 'pending');
      if (i >= 0) s.steps[i].status = 'skipped';
      else s.steps.push({ stepId: n.stepId, status: 'skipped' });
      return;
    }
    s.steps.push({ stepId: n.stepId, status: 'skipped', instanceId: pieceId, ...(lane ? { lane } : {}) });
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
      logAt(s, 'info', 'LOOP_ITER', `${pieceTag(s)}${frame.name ?? '반복'} ${frame.iter}/${count}`, frame.blockId);
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
    const tag = pieceTag(s);
    if (verdict.ok) { fiber.stack.pop(); if (!top(fiber)) finishFiber(s, fiber); return; }
    if (used < max) {
      frame.attempt = used + 1;
      frame.index = 0;
      logAt(s, 'warn', 'RETRY', `${tag}${frame.name ?? '재시도'} ${frame.attempt}/${max} — ${verdict.why}`, frame.blockId);
      return;
    }
    logAt(s, 'warn', 'RETRY_EXHAUSTED', `${tag}${frame.name ?? '재시도'} ${used}/${max} — ${verdict.why}`, frame.blockId);
    fiber.stack.pop();
    if (!top(fiber)) finishFiber(s, fiber);
    return;
  }
  fiber.stack.pop();
  if (!top(fiber)) finishFiber(s, fiber);
}

type FiberGate = 'go' | 'wait' | 'park' | 'stop';

function activateFiber(p: Project, s: RuntimeState, fiber: FlowFiber, stepId: string): FiberGate {
  applySensorSignals(p, s);
  const found = locateStep(p, stepId);
  if (!found) { failFlow(s, 'REF_MISSING_ACTION', stepId, `단계 ${stepId} 의 Action 을 찾을 수 없음`); return 'stop'; }
  const { step, action: a } = found;
  const pc = activePiece(s);
  if (pc && deviceHeld(p, s, a.deviceId, fiber)) {
    const dev = p.devices.find((d) => d.id === a.deviceId);
    blockFiber(s, pc, fiber, { reason: 'device', unitId: dev?.unitId ?? a.unitId, note: `Device 사용 중 (${dev?.name ?? a.deviceId})` }, step.id);
    return 'wait';
  }
  const moveTo = a.effect.moveTo;
  if (pc && moveTo && moveTo !== 'EXIT' && piecesAt(s, moveTo, pc.instanceId) >= unitCap(p, moveTo)) {
    const unit = p.units.find((u) => u.id === moveTo);
    blockFiber(s, pc, fiber, { reason: 'capacity', unitId: moveTo, note: `Unit 가득 (${unit?.name ?? moveTo})` }, step.id);
    return 'wait';
  }
  const concurrent = pc ? true : (s.flowRun?.fibers.filter((f) => f.status !== 'done').length ?? 0) > 1;
  const gate = judgeInterlock(
    p, a.id, step.name, flowActiveActionIds(p, s, fiber), concurrent,
    (c) => evalCond(c, s, p), unmetText,
  );
  if (gate.kind === 'block') {
    pushBlock(s, step.id, gate.hit);
    const message = pc ? gate.hit.message.replace(`[${step.name}]`, `[개체 ${pc.index} ${step.name}]`) : gate.hit.message;
    failFlow(s, 'INTERLOCK_BLOCK', step.id, message);
    return 'stop';
  }
  if (gate.kind === 'wait') {
    if (pc) {
      blockFiber(s, pc, fiber, { reason: 'interlock', unitId: gate.wait.unitId, note: gate.wait.note }, step.id);
      return 'wait';
    }
    if (!fiber.wait || fiber.wait.note !== gate.wait.note) {
      fiber.wait = { sinceMs: s.timeMs, note: gate.wait.note, interlockId: gate.wait.interlockId };
      logAt(s, 'info', 'WAIT', `[${fiber.lane ?? '갈래'}] ${step.name} 대기 — ${gate.wait.note}`, step.id);
    }
    return 'wait';
  }
  let waited: { waitMs: number; waitNote: string } | null = null;
  if (fiber.wait) {
    const dt = s.timeMs - fiber.wait.sinceMs;
    const note = fiber.wait.note;
    fiber.wait = undefined;
    if (dt > 0) waited = { waitMs: dt, waitNote: note };
    logAt(s, 'info', 'WAIT_END', `[${fiber.lane ?? '갈래'}] ${step.name} 대기 끝 — ${note} ${(dt / 1000).toFixed(3)}s`, step.id);
  }
  if (pc) releaseFiberBlock(s, pc, fiber);
  const recordIndex = beginRecord(s, step.id, fiber.lane);
  if (waited) Object.assign(s.steps[recordIndex], waited);
  if (pc) takePendingWait(pc, s.steps[recordIndex]);
  for (const c of [...step.entry, ...a.pre]) {
    const r = evalCond(c, s, p);
    if (!r.ok) { failFlow(s, 'PRE_UNMET', step.id, `[${pc ? `개체 ${pc.index} ` : ''}${step.name}] 전제 조건 미충족: ${unmetText(r)} — 다른 진행 주체가 없어 대기하지 않고 오류 처리`); return 'stop'; }
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
  return 'go';
}

function spawnLanes(s: RuntimeState, parent: FlowFiber, lists: FlowNode[][], labels: string[], message: string, owner?: FlowFiber['owner']) {
  if (!s.flowRun) return;
  const pc = activePiece(s);
  parent.status = 'joining';
  const childIds: number[] = [];
  lists.forEach((nodes, i) => {
    const id = s.flowRun!.nextId++;
    childIds.push(id);
    const lane = pc ? `개체 ${pc.index} · ${labels[i]}` : labels[i];
    s.flowRun!.fibers.push({
      id, status: 'live', parentId: parent.id, lane, active: null,
      stack: [{ role: 'seq', nodes, index: 0 }],
      ...(owner ? { owner } : {}),
    });
  });
  parent.join = { childIds, message };
}

function laneWord(fiber: FlowFiber): string {
  return fiber.lane ?? '순차';
}

function secondsText(msValue: number): string {
  return (msValue / 1000).toFixed(3);
}

function finishWait(p: Project, s: RuntimeState, fiber: FlowFiber) {
  const held = fiber.holding;
  if (!held) return;
  const rec = s.steps[held.recordIndex];
  const waited = s.timeMs - held.sinceMs;
  const phrase = conditionText(p, held.cond);
  if (rec) { rec.status = 'done'; rec.endMs = s.timeMs; rec.waitMs = waited; rec.condText = phrase; }
  logAt(s, 'info', 'WAIT_END', `[${laneWord(fiber)}] ${held.name} 끝 — ${phrase} — ${secondsText(waited)}s`, held.blockId);
  fiber.holding = undefined;
  const frame = top(fiber);
  if (frame) frame.index += 1;
}

function beginWait(p: Project, s: RuntimeState, fiber: FlowFiber, node: Extract<FlowNode, { kind: 'wait' }>): FiberGate {
  const phrase = conditionText(p, node.cond);
  const recordIndex = beginRecord(s, node.id, fiber.lane);
  const rec = s.steps[recordIndex];
  if (rec) { rec.waitBlockId = node.id; rec.condText = phrase; rec.waitNote = phrase; }
  logAt(s, 'info', 'WAIT_START', `[${laneWord(fiber)}] ${node.name} 시작 — ${phrase}`, node.id);
  const verdict = evalCond(node.cond, s, p);
  if (verdict.ok) {
    if (rec) { rec.status = 'done'; rec.endMs = s.timeMs; rec.waitMs = 0; }
    logAt(s, 'info', 'WAIT_END', `[${laneWord(fiber)}] ${node.name} 끝 — ${phrase} — ${secondsText(0)}s`, node.id);
    const frame = top(fiber);
    if (frame) frame.index += 1;
    return 'go';
  }
  const timeout = node.timeout.value;
  if (timeout === null || Number.isNaN(timeout)) {
    failFlow(s, 'WAIT_TIMEOUT', node.id, `[${laneWord(fiber)}] ${node.name} 시간 초과 — ${phrase} — 타임아웃 미정`);
    return 'stop';
  }
  fiber.holding = {
    blockId: node.id, name: node.name, cond: node.cond,
    sinceMs: s.timeMs, timeoutAtMs: s.timeMs + ms(timeout), recordIndex,
  };
  return 'park';
}

function enterNode(p: Project, s: RuntimeState, fiber: FlowFiber, node: FlowNode): FiberGate {
  const frame = top(fiber)!;
  if (node.kind === 'step') return activateFiber(p, s, fiber, node.stepId);
  if (node.kind === 'wait') return beginWait(p, s, fiber, node);
  frame.index += 1;
  const tag = pieceTag(s);
  if (node.kind === 'branch') {
    const verdict = evalCond(node.cond, s, p);
    const takeThen = verdict.ok;
    logAt(s, 'info', 'BRANCH_TAKEN', `${tag}${node.name} ${takeThen ? '참' : '거짓'} — ${verdict.why}`, node.id);
    skipTree(s, takeThen ? node.else : node.then);
    fiber.stack.push({ role: 'seq', nodes: takeThen ? node.then : node.else, index: 0 });
    return 'go';
  }
  if (node.kind === 'loop') {
    logAt(s, 'info', 'LOOP_ITER', `${tag}${node.name} 1/${node.count}`, node.id);
    fiber.stack.push({ role: 'loop', nodes: node.body, index: 0, count: node.count, iter: 1, blockId: node.id, name: node.name });
    return 'go';
  }
  if (node.kind === 'retry') {
    fiber.stack.push({ role: 'retry', nodes: node.body, index: 0, maxRetries: node.maxRetries, attempt: 0, until: node.until, blockId: node.id, name: node.name });
    return 'go';
  }
  if (node.kind === 'parallel') {
    if (node.lanes.length === 0) { logAt(s, 'info', 'PAR_JOIN', `${tag}${node.name} 합류`); return 'go'; }
    spawnLanes(s, fiber, node.lanes, node.lanes.map((_, i) => `갈래 ${i + 1}`), `${tag}${node.name} 합류`);
    return 'go';
  }
  const unit = p.units.find((u) => u.id === node.unitId);
  const seqs = (p.substationSequences ?? []).filter((q) => q.unitId === node.unitId);
  if (seqs.length === 0) { logAt(s, 'info', 'PAR_JOIN', `${tag}${unit?.name ?? node.unitId} Substation 합류`); return 'go'; }
  spawnLanes(
    s, fiber,
    seqs.map((q) => q.steps.map((step) => ({ kind: 'step' as const, stepId: step.id }))),
    seqs.map((q) => q.name),
    `${tag}${unit?.name ?? node.unitId} Substation 합류`,
    { kind: 'substation', nodeId: node.id, unitId: node.unitId },
  );
  return 'go';
}

function progressFiber(p: Project, s: RuntimeState, fiber: FlowFiber): FiberGate {
  const frame = top(fiber);
  if (!frame) { finishFiber(s, fiber); return 'go'; }
  if (frame.index >= frame.nodes.length) { finishFrame(p, s, fiber); return 'go'; }
  return enterNode(p, s, fiber, frame.nodes[frame.index]);
}

function completeFiber(p: Project, s: RuntimeState, fiber: FlowFiber) {
  const active = fiber.active;
  if (!active) return;
  const found = locateStep(p, active.stepId);
  if (!found) { failFlow(s, 'REF_MISSING_ACTION', active.stepId, `단계 ${active.stepId} 의 Action 을 찾을 수 없음`); return; }
  const { step, action: a } = found;
  const pc = activePiece(s);
  if (pc) {
    const to = a.effect.moveTo;
    if (to && to !== 'EXIT' && piecesAt(s, to, pc.instanceId) >= unitCap(p, to)) {
      const unit = p.units.find((u) => u.id === to);
      fiber.pendingCommit = true;
      blockFiber(s, pc, fiber, { reason: 'capacity', unitId: to, note: `Unit 가득 (${unit?.name ?? to})` }, step.id);
      return;
    }
    if (fiber.pendingCommit || fiber.blocked) {
      releaseFiberBlock(s, pc, fiber, s.steps[active.recordIndex]);
      fiber.pendingCommit = false;
    }
  }
  if (a.completeSignalId) s.signals[a.completeSignalId] = true;
  const readFail = readIsFailing(p, s, a.id);
  const resultSig = a.kind === 'read' ? resultOf(p, a) : undefined;
  const keepGoing = readFail && !!resultSig && !!p.sequence.flow && flowUsesSignal(p.sequence.flow, resultSig.id);
  if (a.kind === 'read' && resultSig) s.signals[resultSig.id] = !readFail;
  if (readFail && !keepGoing) {
    if (s.material && p.materials[0]?.states.includes('식별실패')) s.material.state = '식별실패';
    const who = pc ? `개체 ${pc.index} ` : '';
    failFlow(s, 'READ_FAILED', step.id, `[${who}${step.name}] 읽기 완료, 결과=실패 (식별 실패 상태 구별). 분기 미지원으로 이후 공정 진행 안 함`);
    return;
  }
  const m = s.material ? { ...s.material } : null;
  const occ = { ...s.occupancy };
  if (m) {
    if (a.effect.holder !== undefined) m.holder = a.effect.holder;
    if (a.effect.moveTo) {
      const to = a.effect.moveTo;
      if (to !== 'EXIT' && !pc) {
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
    if (!r.ok) { failFlow(s, 'POST_UNMET', step.id, `[${pc ? `개체 ${pc.index} ` : ''}${step.name}] 완료 후 조건 미충족: ${unmetText(r)} — 상태 변경 커밋 안 함`); return; }
  }
  s.material = m; s.occupancy = occ;
  if (pc && m) {
    pc.material = m;
    if (m.location === 'EXIT' && pc.exitedAtMs == null) pc.exitedAtMs = s.timeMs;
  }
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

function releaseWaits(p: Project, s: RuntimeState): boolean {
  let moved = false;
  const run = s.flowRun;
  if (!run) return false;
  for (const fiber of [...run.fibers].sort((a, b) => a.id - b.id)) {
    if (s.status !== 'running') return moved;
    if (!fiber.holding || fiber.frozen) continue;
    if (!evalCond(fiber.holding.cond, s, p).ok) continue;
    finishWait(p, s, fiber);
    moved = true;
  }
  return moved;
}

function failWaitTimeout(p: Project, s: RuntimeState, fiber: FlowFiber) {
  const held = fiber.holding;
  if (!held) return;
  const waited = s.timeMs - held.sinceMs;
  const phrase = conditionText(p, held.cond);
  failFlow(s, 'WAIT_TIMEOUT', held.blockId, `[${laneWord(fiber)}] ${held.name} 시간 초과 — ${phrase} — 기다린 ${secondsText(waited)}s`);
}

function advanceFlow(rt: Runtime, dtMs: number): Runtime {
  const p = rt.snapshot;
  const s = structuredClone(rt.state);
  const target = s.timeMs + Math.round(dtMs);
  let guard = 0;
  let hold = false;
  while (s.status === 'running' && guard++ < 100000) {
    const run = s.flowRun;
    if (!run) break;
    if (releaseWaits(p, s)) continue;
    if (s.status !== 'running') break;
    const idle = run.fibers.filter((f) => f.status === 'live' && !f.active && !f.holding && !f.frozen).sort((a, b) => a.id - b.id);
    let moved = false;
    let waiting = false;
    for (const fiber of idle) {
      const gate = progressFiber(p, s, fiber);
      if (s.status !== 'running') break;
      if (gate === 'wait') { waiting = true; continue; }
      if (gate === 'park') continue;
      moved = true;
      break;
    }
    if (s.status !== 'running') break;
    if (moved) continue;
    const pending = run.fibers.some((f) => (f.status === 'live' || f.status === 'joining' || !!f.active) && f.status !== 'done');
    if (!pending) {
      s.status = 'completed';
      logAt(s, 'info', 'RUN_COMPLETE', `시퀀스 완료 — 최종 자재 ${s.material?.location}/${s.material?.state}`);
      break;
    }
    let actionNext = Infinity;
    let who: FlowFiber | null = null;
    let isComplete = false;
    for (const f of [...run.fibers].sort((a, b) => a.id - b.id)) {
      if (!f.active || f.frozen) continue;
      const c = f.active.completeAtMs !== null && f.active.completeAtMs <= f.active.timeoutAtMs;
      const t = c ? f.active.completeAtMs! : f.active.timeoutAtMs;
      if (t < actionNext) { actionNext = t; who = f; isComplete = c; }
    }
    let waitNext = Infinity;
    let waitFiber: FlowFiber | null = null;
    for (const f of [...run.fibers].sort((a, b) => a.id - b.id)) {
      if (!f.holding || f.frozen) continue;
      if (f.holding.timeoutAtMs < waitNext) { waitNext = f.holding.timeoutAtMs; waitFiber = f; }
    }
    if (!who && !waitFiber) {
      if ((s.pausedSubstations?.length ?? 0) > 0) { hold = true; break; }
      if (waiting) failFlow(s, 'DEADLOCK', null, 'Interlock 동시 금지로 진행할 수 없음 — 기다리는 상대 Action이 진행 중이 아닙니다');
      break;
    }
    const next = Math.min(actionNext, waitNext);
    if (next > target) break;
    if (who && actionNext === next) {
      s.timeMs = next;
      if (isComplete) completeFiber(p, s, who);
      else {
        const found = locateStep(p, who.active!.stepId);
        const step = found?.step;
        const a = found?.action;
        failFlow(s, 'TIMEOUT', step?.id ?? who.active!.stepId, `[${step?.name ?? who.active!.stepId}] 타임아웃 — 완료 신호 ${signalLabel(p, a?.completeSignalId)} 미발생. 이후 공정 통과 안 함`);
      }
      continue;
    }
    s.timeMs = waitNext;
    if (waitFiber) failWaitTimeout(p, s, waitFiber);
  }
  if (s.status === 'running' && !hold) s.timeMs = Math.max(s.timeMs, target);
  syncCursor(s);
  return { ...rt, state: s };
}

// --- several pieces on one flow (TURN-071). The single-piece interpreter above is unchanged. ---

function everyFiber(s: RuntimeState): FlowFiber[] {
  if (s.pieces?.some((pc) => pc.flow)) return s.pieces.flatMap((pc) => pc.flow?.fibers ?? []);
  return s.flowRun?.fibers ?? [];
}

function activePiece(s: RuntimeState): PieceRun | undefined {
  if (!s.flowRun || !s.pieces) return undefined;
  return s.pieces.find((pc) => pc.flow === s.flowRun);
}

function pieceTag(s: RuntimeState): string {
  const pc = activePiece(s);
  return pc ? `개체 ${pc.index} ` : '';
}

function attachFlowPieces(pieces: PieceRun[] | null, p: Project): PieceRun[] | null {
  if (!pieces || !p.sequence.flow) return pieces;
  for (const pc of pieces) {
    pc.flow = {
      nextId: 2,
      fibers: [{
        id: 1, status: 'live', active: null, lane: `개체 ${pc.index}`,
        stack: [{ role: 'seq', nodes: p.sequence.flow, index: 0 }],
      }],
    };
    pc.signals = {};
  }
  return pieces;
}

function unitCap(p: Project, unitId: string): number {
  return p.units.find((u) => u.id === unitId)?.capacity.maxMaterials.value ?? 0;
}

function piecesAt(s: RuntimeState, unitId: string, exceptId?: string): number {
  let n = 0;
  for (const pc of s.pieces ?? []) {
    if (pc.phase === 'queued' || pc.instanceId === exceptId) continue;
    if (pc.material.location === unitId) n += 1;
  }
  return n;
}

function deviceHeld(p: Project, s: RuntimeState, deviceId: string, self: FlowFiber): boolean {
  for (const fiber of everyFiber(s)) {
    if (fiber === self || !fiber.active) continue;
    const found = locateStep(p, fiber.active.stepId);
    if (found?.action.deviceId === deviceId) return true;
  }
  return false;
}

function blockFiber(
  s: RuntimeState, pc: PieceRun, fiber: FlowFiber,
  block: { reason: 'device' | 'capacity' | 'interlock'; unitId: string; note: string },
  refId?: string,
) {
  if (fiber.blocked && fiber.blocked.note === block.note && fiber.blocked.unitId === block.unitId) return;
  releaseFiberBlock(s, pc, fiber);
  fiber.blocked = { ...block, sinceMs: s.timeMs };
  pc.wait = { reason: block.reason, sinceMs: s.timeMs, unitId: block.unitId, note: block.note };
  pc.phase = 'waiting';
  logAt(s, 'info', 'WAIT', `개체 ${pc.index} 대기 — ${block.note}`, refId ?? pc.instanceId);
}

function releaseFiberBlock(s: RuntimeState, pc: PieceRun, fiber: FlowFiber, rec?: StepRecord) {
  const blocked = fiber.blocked;
  if (!blocked) return;
  fiber.blocked = undefined;
  const dt = s.timeMs - blocked.sinceMs;
  if (pc.wait?.note === blocked.note && pc.wait.sinceMs === blocked.sinceMs) pc.wait = null;
  if (dt <= 0) return;
  pc.waitMs += dt;
  pc.waitByUnit[blocked.unitId] = (pc.waitByUnit[blocked.unitId] ?? 0) + dt;
  if (rec) {
    rec.waitMs = (rec.waitMs ?? 0) + dt;
    rec.waitNote = blocked.note;
  } else {
    pc.pendingWaitMs += dt;
    pc.pendingWaitNote = blocked.note;
  }
  logAt(s, 'info', 'WAIT_END', `개체 ${pc.index} 대기 끝 — ${blocked.note} ${(dt / 1000).toFixed(3)}s`, rec?.stepId ?? pc.instanceId);
}

function takePendingWait(pc: PieceRun, rec: StepRecord | undefined) {
  if (!rec || pc.pendingWaitMs <= 0) return;
  rec.waitMs = (rec.waitMs ?? 0) + pc.pendingWaitMs;
  rec.waitNote = pc.pendingWaitNote;
  pc.pendingWaitMs = 0;
  pc.pendingWaitNote = '';
}

function bindPiece(p: Project, s: RuntimeState, pc: PieceRun) {
  s.flowRun = pc.flow;
  s.material = pc.material;
  const owned = pc.signals ?? {};
  for (const sig of p.signals) {
    if (sig.role === 'sensor') continue;
    s.signals[sig.id] = owned[sig.id] ?? false;
  }
}

function unbindPiece(p: Project, s: RuntimeState, pc: PieceRun) {
  const owned: Record<string, boolean> = {};
  for (const sig of p.signals) {
    if (sig.role === 'sensor') continue;
    owned[sig.id] = s.signals[sig.id] ?? false;
  }
  pc.signals = owned;
  if (s.material) pc.material = s.material;
}

function settlePiece(p: Project, s: RuntimeState, pc: PieceRun): boolean {
  if (!pc.flow || pc.fedAtMs == null) return false;
  bindPiece(p, s, pc);
  let progressed = false;
  try {
    let guard = 0;
    while (s.status === 'running' && guard++ < 2000) {
      if (releaseWaits(p, s)) { progressed = true; continue; }
      let committed = false;
      for (const fiber of [...pc.flow.fibers].sort((a, b) => a.id - b.id)) {
        if (!fiber.pendingCommit || !fiber.active || fiber.frozen) continue;
        completeFiber(p, s, fiber);
        if (s.status !== 'running') return progressed;
        if (!fiber.pendingCommit) { committed = true; break; }
      }
      if (committed) { progressed = true; continue; }
      const idle = pc.flow.fibers
        .filter((f) => f.status === 'live' && !f.active && !f.holding && !f.frozen && !f.pendingCommit)
        .sort((a, b) => a.id - b.id);
      let moved = false;
      for (const fiber of idle) {
        const gate = progressFiber(p, s, fiber);
        if (s.status !== 'running') return progressed;
        if (gate === 'wait' || gate === 'park') continue;
        if (gate === 'stop') return progressed;
        moved = true;
        break;
      }
      if (!moved) break;
      progressed = true;
    }
  } finally {
    unbindPiece(p, s, pc);
  }
  return progressed;
}

function pieceFlowDone(pc: PieceRun): boolean {
  return pc.fedAtMs != null && !!pc.flow && pc.flow.fibers.every((f) => f.status === 'done');
}

interface FlowEvent {
  t: number;
  pieceIndex: number;
  fiberId: number;
  kind: 'done' | 'timeout' | 'wait' | 'feed';
  pc: PieceRun;
  fiber?: FlowFiber;
}

function flowEvents(s: RuntimeState): FlowEvent[] {
  const out: FlowEvent[] = [];
  for (const pc of s.pieces ?? []) {
    if (pc.fedAtMs == null && pc.readyAtMs > s.timeMs) {
      out.push({ t: pc.readyAtMs, pieceIndex: pc.index, fiberId: -1, kind: 'feed', pc });
    }
    for (const fiber of pc.flow?.fibers ?? []) {
      if (fiber.frozen) continue;
      if (fiber.active && !fiber.pendingCommit) {
        const complete = fiber.active.completeAtMs !== null && fiber.active.completeAtMs <= fiber.active.timeoutAtMs;
        const t = complete ? fiber.active.completeAtMs! : fiber.active.timeoutAtMs;
        out.push({ t, pieceIndex: pc.index, fiberId: fiber.id, kind: complete ? 'done' : 'timeout', pc, fiber });
      }
      if (fiber.holding) {
        out.push({ t: fiber.holding.timeoutAtMs, pieceIndex: pc.index, fiberId: fiber.id, kind: 'wait', pc, fiber });
      }
    }
  }
  const rank = (kind: FlowEvent['kind']) => kind === 'done' ? 0 : 1;
  out.sort((a, b) => a.t - b.t || a.pieceIndex - b.pieceIndex || rank(a.kind) - rank(b.kind) || a.fiberId - b.fiberId);
  return out;
}

function flowDeadlockText(pieces: PieceRun[]): string {
  const parts = pieces.filter((pc) => !pieceFlowDone(pc)).map((pc) => {
    const blocked = pc.flow?.fibers.find((f) => f.blocked)?.blocked;
    const note = blocked?.note ?? pc.wait?.note ?? (pc.fedAtMs == null ? '투입 대기' : pc.phase);
    return `개체 ${pc.index}: ${note}`;
  });
  return `서로 기다려 진행할 수 없음 — ${parts.join(', ')}`;
}

function fireFlowEvent(p: Project, s: RuntimeState, ev: FlowEvent) {
  const fiber = ev.fiber;
  if (!fiber) return;
  bindPiece(p, s, ev.pc);
  try {
    if (ev.kind === 'wait') {
      if (fiber.holding) failWaitTimeout(p, s, fiber);
      return;
    }
    if (!fiber.active || fiber.pendingCommit) return;
    if (ev.kind === 'done') completeFiber(p, s, fiber);
    else {
      const found = locateStep(p, fiber.active.stepId);
      const lane = fiber.lane ? `${fiber.lane} ` : '';
      failFlow(s, 'TIMEOUT', found?.step.id ?? fiber.active.stepId, `[${lane}${found?.step.name ?? fiber.active.stepId}] 타임아웃 — 완료 신호 ${signalLabel(p, found?.action.completeSignalId)} 미발생. 이후 공정 통과 안 함`);
    }
  } finally {
    unbindPiece(p, s, ev.pc);
  }
}

function syncFlowPieces(p: Project, s: RuntimeState) {
  const pieces = s.pieces ?? [];
  for (const pc of pieces) {
    if (!pc.flow) continue;
    const fibers = pc.flow.fibers;
    const running = fibers.filter((f) => f.active && !f.pendingCommit && !f.frozen);
    const holding = fibers.some((f) => f.holding && !f.frozen);
    const blocked = fibers.find((f) => f.blocked);
    const live = fibers.some((f) => f.status !== 'done');
    if (pc.fedAtMs == null) continue;
    if (!live) pc.phase = 'done';
    else if (running.length > 0) pc.phase = 'active';
    else if (blocked || holding || fibers.some((f) => f.pendingCommit)) pc.phase = 'waiting';
    else pc.phase = 'ready';
    const shown = running[0] ?? fibers.find((f) => f.active);
    if (shown?.active) {
      const idx = p.sequence.steps.findIndex((step) => step.id === shown.active!.stepId);
      if (idx >= 0) pc.stepIndex = idx;
    }
    if (blocked?.blocked) {
      pc.wait = { reason: blocked.blocked.reason, sinceMs: blocked.blocked.sinceMs, unitId: blocked.blocked.unitId, note: blocked.blocked.note };
    } else pc.wait = null;
  }
  const focus = pieces.find((pc) => pc.phase !== 'done' && pc.phase !== 'queued')
    ?? pieces.find((pc) => pc.phase !== 'queued')
    ?? pieces[0];
  s.material = focus ? { ...focus.material } : null;
  for (const unit of p.units) {
    const at = pieces.find((pc) => pc.phase !== 'queued' && pc.material.location === unit.id);
    s.occupancy[unit.id] = at ? at.instanceId : null;
  }
  const act = pieces.flatMap((pc) => pc.flow?.fibers ?? []).filter((f) => f.active && !f.pendingCommit).sort((a, b) => a.id - b.id);
  if (act[0]?.active) {
    const a = act[0].active;
    s.stepIndex = a.stepIndex;
    s.active = { stepIndex: a.stepIndex, startMs: a.startMs, completeAtMs: a.completeAtMs, timeoutAtMs: a.timeoutAtMs, stepId: a.stepId };
  } else s.active = null;
  if (focus?.signals) {
    for (const sig of p.signals) {
      if (sig.role === 'sensor') continue;
      s.signals[sig.id] = focus.signals[sig.id] ?? false;
    }
  }
  s.flowRun = undefined;
}

function advanceFlowPieces(rt: Runtime, dtMs: number): Runtime {
  const p = rt.snapshot;
  const s = structuredClone(rt.state);
  const target = s.timeMs + Math.round(dtMs);
  let guard = 0;
  let hold = false;
  while (s.status === 'running' && guard++ < 100000) {
    const pieces = s.pieces ?? [];
    let moved = false;
    if (admitPieces(p, s)) moved = true;
    for (const pc of pieces) {
      if (settlePiece(p, s, pc)) moved = true;
      if (s.status !== 'running') break;
    }
    if (s.status !== 'running') break;
    if (pieces.length > 0 && pieces.every(pieceFlowDone)) {
      s.status = 'completed';
      s.active = null;
      logAt(s, 'info', 'RUN_COMPLETE', `시퀀스 완료 — 개체 ${pieces.length}개 배출`);
      break;
    }
    if (moved) continue;
    const events = flowEvents(s).filter((ev) => ev.kind !== 'feed' || ev.t > s.timeMs);
    const due = events.filter((ev) => ev.kind !== 'feed' && ev.t <= s.timeMs);
    if (due.length > 0) {
      fireFlowEvent(p, s, due[0]);
      continue;
    }
    const nxt = events[0];
    if (!nxt) {
      if ((s.pausedSubstations?.length ?? 0) > 0) { hold = true; break; }
      failFlow(s, 'DEADLOCK', null, flowDeadlockText(pieces));
      break;
    }
    if (nxt.t > target) break;
    s.timeMs = nxt.t;
    if (nxt.kind !== 'feed') fireFlowEvent(p, s, nxt);
  }
  if (s.status === 'running' && !hold) s.timeMs = Math.max(s.timeMs, target);
  syncFlowPieces(p, s);
  applySensorSignals(p, s);
  return { ...rt, state: s };
}
