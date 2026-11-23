// Substation group runtime (v0.3, 설계 제안 — 사용자 확정 아님).
// Several SubstationSequences of ONE Unit (= Substation) run together on ONE shared virtual clock.
//  - Scheduler: event-driven. At each virtual instant lanes are processed in fixed order (sequence list order);
//    a lane activates its next step at the same instant its previous step completed. Result is independent of dt chunking.
//  - Pause freezes ALL lanes (virtual clock stops; remaining times are kept as absolute event times). Resume continues.
//  - Reset restores the initial state of the snapshot. Undo is separate (design model is never written).
//  - Error policy (conservative, 설계 제안): any lane error (PRE_UNMET / TIMEOUT / POST_UNMET / READ_FAILED / CAPACITY_FULL)
//    stops the WHOLE group; other lanes keep their state for inspection and do not continue.
//  - Before run, conflicts that this prototype cannot model are BLOCKED with diagnostics instead of guessed:
//    the same Device (→ concurrent writes to its command/complete signals) used by two lanes, and the shared material
//    being moved/held/changed by more than one lane (duplicate ownership).
// NOT equipment control, NOT physics.
import type { Action, Project, SequenceStep, SubstationSequence } from '../model/types';
import { feedCountOf, GROUP_RULES_VERSION } from '../model/types';
import { checkLanes } from '../model/laneCheck';
import { validateProject, type Diagnostic } from '../model/validate';
import { interlockNotices } from '../model/interlock';
import { applySensorSignals, evalCond, ms, signalLabel, unmetText, type LogEntry, type MaterialInstance } from './engine';
import { judgeInterlock } from './interlock';

export type GroupStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error';
export type LaneStatus = 'pending' | 'active' | 'done' | 'error' | 'stopped';

export interface Lane {
  seqId: string;
  name: string;
  stepIndex: number;
  status: LaneStatus;
  active: { startMs: number; completeAtMs: number | null; timeoutAtMs: number } | null;
  steps: { stepId: string; status: 'pending' | 'active' | 'done' | 'error'; startMs?: number; endMs?: number; waitMs?: number; waitNote?: string }[];
  endMs?: number;
  /** Mutex hold. The step has not started. */
  wait?: { sinceMs: number; note: string; interlockId: string };
}

export interface GroupState {
  rulesVersion: string;
  runId: string;
  unitId: string;
  modelRevision: number;
  status: GroupStatus;
  timeMs: number;
  lanes: Lane[];
  signals: Record<string, boolean>;
  devicePositions: Record<string, string | null>;
  material: MaterialInstance | null;
  occupancy: Record<string, string | null>;
  log: LogEntry[];
  error: { code: string; seqId: string | null; stepId: string | null; message: string } | null;
  blockers: Diagnostic[];
}

export interface GroupRuntime { snapshot: Project; state: GroupState }

const seqsOf = (p: Project, unitId: string): SubstationSequence[] => (p.substationSequences ?? []).filter((q) => q.unitId === unitId);

export interface GroupReadiness { ok: boolean; blockers: Diagnostic[]; warnings: Diagnostic[]; usesMaterial: boolean }

/** Pre-run check for one Substation group. Never fills undefined values; conflicts are blocked explicitly. */
export function checkGroupReadiness(p: Project, unitId: string): GroupReadiness {
  const diags = validateProject(p);
  const blockers = diags.filter((d) => d.severity === 'error');
  const warnings = [...diags.filter((d) => d.severity === 'warning'), ...interlockNotices(p)];
  const b = (code: string, objectId: string, message: string) => blockers.push({ id: `${code}:${objectId}:${blockers.length}`, severity: 'error', code, objectId, message });
  if (blockers.length) return { ok: false, blockers, warnings, usesMaterial: false };
  const unit = p.units.find((u) => u.id === unitId);
  if (!unit) { b('NO_SUBSTATION', unitId, `Substation ${unitId} 없음`); return { ok: false, blockers, warnings, usesMaterial: false }; }
  const seqs = seqsOf(p, unitId);
  if (seqs.length === 0) b('NO_SUB_SEQUENCES', unitId, `${unit.name}: Substation 시퀀스가 없음 — 4 자재·시퀀스 › Substation 시퀀스에서 추가하세요`);
  const lane = checkLanes(p, seqs.map((q) => ({ id: q.id, name: q.name, steps: q.steps })), unitId);
  blockers.push(...lane.blockers);
  const usesMaterial = lane.usesMaterial;
  if (usesMaterial) {
    if (p.materials.length !== 1) b('MATERIAL_COUNT', 'materials', `자재 정의 1개만 지원 (현재 ${p.materials.length}개)`);
    const m = p.materials[0];
    if (m && !m.initialLocation) b('MAT_NO_LOCATION', m.id, '자재 초기 위치 미정');
    if (m && !m.initialState) b('MAT_NO_STATE', m.id, '자재 초기 상태 미정');
    if (m && feedCountOf(m) >= 2) b('MULTI_FEED', m.id, '투입 개수 2 이상은 Substation 그룹 실행에서 지원하지 않습니다. Station 순차 시퀀스에서 실행하세요.');
  }
  return { ok: blockers.length === 0, blockers, warnings, usesMaterial };
}

function initialState(p: Project, unitId: string, runId: string): GroupState {
  const signals: Record<string, boolean> = {};
  for (const s of p.signals) signals[s.id] = false;
  const occupancy: Record<string, string | null> = {};
  for (const u of p.units) occupancy[u.id] = null;
  const m = p.materials[0];
  let material: MaterialInstance | null = null;
  if (m && m.initialLocation && m.initialState) { material = { instanceId: `${m.id}#1`, materialId: m.id, location: m.initialLocation, state: m.initialState, holder: null }; occupancy[m.initialLocation] = material.instanceId; }
  const devicePositions: Record<string, string | null> = {};
  for (const d of p.devices) devicePositions[d.id] = null;
  const lanes: Lane[] = seqsOf(p, unitId).map((q) => ({ seqId: q.id, name: q.name, stepIndex: 0, status: 'pending', active: null, steps: q.steps.map((s) => ({ stepId: s.id, status: 'pending' })) }));
  const state: GroupState = { rulesVersion: GROUP_RULES_VERSION, runId, unitId, modelRevision: p.revision, status: 'idle', timeMs: 0, lanes, signals, devicePositions, material, occupancy, log: [], error: null, blockers: [] };
  applySensorSignals(p, state);
  return state;
}

export function createGroupRuntime(project: Project, unitId: string, runId = 'grp-1'): GroupRuntime {
  const snapshot = structuredClone(project);
  return { snapshot, state: initialState(snapshot, unitId, runId) };
}

const L = (s: GroupState, level: LogEntry['level'], code: string, message: string, refId?: string) => s.log.push({ t: s.timeMs, level, code, message, refId });

export function startGroup(rt: GroupRuntime): GroupRuntime {
  if (rt.state.status !== 'idle') return rt;
  const s = structuredClone(rt.state);
  const r = checkGroupReadiness(rt.snapshot, s.unitId);
  if (!r.ok) { s.blockers = r.blockers; L(s, 'error', 'NOT_READY', `그룹 실행 준비 실패: ${r.blockers.length}건 — ${r.blockers.map((x) => x.message).slice(0, 3).join(' / ')}`); return { ...rt, state: s }; }
  s.status = 'running'; s.blockers = [];
  for (const l of s.lanes) l.status = 'active';
  L(s, 'info', 'GROUP_START', `그룹 실행 시작 — 시퀀스 ${s.lanes.length}개 동시, 공통 가상 시계 (모델 리비전 ${s.modelRevision}, 규칙 ${s.rulesVersion})`);
  return { ...rt, state: s };
}

export function pauseGroup(rt: GroupRuntime): GroupRuntime {
  if (rt.state.status !== 'running') return rt;
  const s = structuredClone(rt.state); s.status = 'paused';
  L(s, 'info', 'GROUP_PAUSE', `그룹 일시정지 — 소속 시퀀스 ${s.lanes.filter((l) => l.status === 'active').length}개 모두 동결 (가상 시간 정지)`);
  return { ...rt, state: s };
}

export function resumeGroup(rt: GroupRuntime): GroupRuntime {
  if (rt.state.status !== 'paused') return rt;
  const s = structuredClone(rt.state); s.status = 'running';
  const rem = s.lanes.filter((l) => l.active).map((l) => `${l.name} ${((Math.min(l.active!.completeAtMs ?? Infinity, l.active!.timeoutAtMs) - s.timeMs) / 1000).toFixed(3)}s`);
  L(s, 'info', 'GROUP_RESUME', `그룹 재개 — 남은 시간 유지: ${rem.join(', ') || '진행 중 단계 없음'}`);
  return { ...rt, state: s };
}

export function resetGroup(rt: GroupRuntime): GroupRuntime {
  return { snapshot: rt.snapshot, state: initialState(rt.snapshot, rt.state.unitId, rt.state.runId) };
}

function stepOf(p: Project, l: Lane): { q: SubstationSequence; step: SequenceStep; a: Action } {
  const q = (p.substationSequences ?? []).find((x) => x.id === l.seqId)!;
  const step = q.steps[l.stepIndex];
  return { q, step, a: p.actions.find((x) => x.id === step.actionId)! };
}

function failGroup(s: GroupState, l: Lane, code: string, stepId: string, message: string) {
  s.status = 'error'; l.status = 'error';
  s.error = { code, seqId: l.seqId, stepId, message };
  const r = l.steps.find((x) => x.stepId === stepId); if (r) { r.status = 'error'; r.endMs = s.timeMs; }
  L(s, 'error', code, `[${l.name}] ${message}`, stepId);
  for (const o of s.lanes) if (o !== l && o.status === 'active') o.status = 'stopped';
  L(s, 'error', 'GROUP_STOPPED', `보수적 그룹 정지 (설계 제안): ${l.name} 오류로 같은 Substation의 다른 시퀀스도 정지 — 이후 단계 진행 안 함`);
}

function laneActiveActionIds(p: Project, s: GroupState, except: Lane): string[] {
  const ids: string[] = [];
  for (const other of s.lanes) {
    if (other === except || !other.active) continue;
    const step = stepOf(p, other).step;
    ids.push(step.actionId);
  }
  return ids;
}

function activate(p: Project, s: GroupState, l: Lane): 'started' | 'wait' {
  applySensorSignals(p, s);
  const { step, a } = stepOf(p, l);
  const concurrent = s.lanes.filter((lane) => lane.status === 'active' || lane.status === 'pending').length > 1;
  const gate = judgeInterlock(
    p, a.id, step.name, laneActiveActionIds(p, s, l), concurrent,
    (c) => evalCond(c, s, p), unmetText,
  );
  if (gate.kind === 'block') {
    failGroup(s, l, 'INTERLOCK_BLOCK', step.id, gate.hit.message);
    return 'started';
  }
  if (gate.kind === 'wait') {
    if (!l.wait || l.wait.note !== gate.wait.note) {
      l.wait = { sinceMs: s.timeMs, note: gate.wait.note, interlockId: gate.wait.interlockId };
      L(s, 'info', 'WAIT', `[${l.name}] ${step.name} 대기 — ${gate.wait.note}`, step.id);
    }
    return 'wait';
  }
  for (const c of [...step.entry, ...a.pre]) {
    const r = evalCond(c, s, p);
    if (!r.ok) { failGroup(s, l, 'PRE_UNMET', step.id, `${step.name}: 전제 조건 미충족 ${unmetText(r)} — 대기하지 않고 오류 처리 (동기화/대기 규칙 미정)`); return 'started'; }
  }
  if (a.completeSignalId) s.signals[a.completeSignalId] = false;
  if (a.commandSignalId) s.signals[a.commandSignalId] = true;
  const timeout = (step.timeoutOverride ?? a.timeout).value ?? 0;
  const neverTrue = a.completeSignalId ? p.simSettings.faults.neverTrueSignalIds.includes(a.completeSignalId) : true;
  l.active = { startMs: s.timeMs, completeAtMs: neverTrue ? null : s.timeMs + ms(a.duration.value), timeoutAtMs: s.timeMs + ms(timeout) };
  const rec = l.steps[l.stepIndex]; rec.status = 'active'; rec.startMs = s.timeMs;
  if (l.wait) {
    const dt = s.timeMs - l.wait.sinceMs;
    rec.waitMs = dt;
    rec.waitNote = l.wait.note;
    L(s, 'info', 'WAIT_END', `[${l.name}] ${step.name} 대기 끝 — ${l.wait.note} ${(dt / 1000).toFixed(3)}s`, step.id);
    l.wait = undefined;
  }
  L(s, 'info', 'STEP_START', `[${l.name}] ${step.name} 시작 (가정 ${a.duration.value}s, 타임아웃 ${timeout}s)`, step.id);
  return 'started';
}

function complete(p: Project, s: GroupState, l: Lane) {
  const { step, a } = stepOf(p, l);
  if (a.completeSignalId) s.signals[a.completeSignalId] = true;
  const m = s.material ? { ...s.material } : null;
  const occ = { ...s.occupancy };
  if (m) {
    if (a.effect.holder !== undefined) m.holder = a.effect.holder;
    if (a.effect.moveTo) {
      const to = a.effect.moveTo;
      if (to !== 'EXIT') {
        const unit = p.units.find((u) => u.id === to)!;
        const used = Object.entries(occ).filter(([uid, inst]) => uid === to && inst && inst !== m.instanceId).length;
        if (used >= (unit.capacity.maxMaterials.value ?? 0)) { failGroup(s, l, 'CAPACITY_FULL', step.id, `${step.name}: ${unit.name} 수용 불가`); return; }
      }
      if (m.location !== 'EXIT') occ[m.location] = null;
      m.location = to; if (to !== 'EXIT') occ[to] = m.instanceId;
    }
    if (a.effect.setState) m.state = a.effect.setState;
  }
  if (a.kind === 'read') {
    const readFail = p.simSettings.faults.readFailActionIds.includes(a.id);
    const resultSig = p.signals.find((x) => x.deviceId === a.deviceId && x.role === 'result');
    if (resultSig) s.signals[resultSig.id] = !readFail;
    if (readFail) { failGroup(s, l, 'READ_FAILED', step.id, `${step.name}: 읽기 결과=실패 (분기 미지원)`); return; }
  }
  const tentative = { signals: s.signals, material: m };
  for (const c of a.post) { const r = evalCond(c, tentative, p); if (!r.ok) { failGroup(s, l, 'POST_UNMET', step.id, `${step.name}: 완료 후 조건 미충족 ${unmetText(r)} — 커밋 안 함`); return; } }
  s.material = m; s.occupancy = occ;
  if (a.commandSignalId) s.signals[a.commandSignalId] = false;
  for (const sg of p.signals) if (sg.deviceId === a.deviceId && sg.role === 'complete' && sg.id !== a.completeSignalId) s.signals[sg.id] = false;
  if (a.targetPositionId) s.devicePositions[a.deviceId] = a.targetPositionId;
  applySensorSignals(p, s);
  const rec = l.steps[l.stepIndex]; rec.status = 'done'; rec.endMs = s.timeMs;
  L(s, 'info', 'STEP_DONE', `[${l.name}] ${step.name} 완료`, step.id);
  l.active = null; l.stepIndex += 1;
}

/** Advance the shared virtual clock by dtMs. Deterministic; independent of how dt is chunked. */
export function advanceGroup(rt: GroupRuntime, dtMs: number): GroupRuntime {
  if (rt.state.status !== 'running' || dtMs < 0) return rt;
  const p = rt.snapshot;
  const s = structuredClone(rt.state);
  const target = s.timeMs + Math.round(dtMs);
  let guard = 0;
  while (s.status === 'running' && guard++ < 100000) {
    // 1) at the current instant: finish / activate lanes in fixed order until nothing changes
    let changed = false;
    for (const l of s.lanes) {
      if (s.status !== 'running') break;
      if (l.status !== 'active' || l.active) continue;
      const q = (p.substationSequences ?? []).find((x) => x.id === l.seqId)!;
      if (l.stepIndex >= q.steps.length) { l.status = 'done'; l.endMs = s.timeMs; L(s, 'info', 'SEQ_COMPLETE', `[${l.name}] 시퀀스 완료`); changed = true; continue; }
      const outcome = activate(p, s, l);
      if (outcome === 'started') changed = true;
    }
    if (s.status !== 'running') break;
    if (s.lanes.every((l) => l.status === 'done')) { s.status = 'completed'; L(s, 'info', 'GROUP_COMPLETE', `그룹 완료 — 시퀀스 ${s.lanes.length}개 모두 완주`); break; }
    if (changed) continue;
    // 2) next event among active lanes
    let next = Infinity; let who: Lane | null = null; let isComplete = false;
    for (const l of s.lanes) {
      if (!l.active) continue;
      const c = l.active.completeAtMs !== null && l.active.completeAtMs <= l.active.timeoutAtMs;
      const t = c ? l.active.completeAtMs! : l.active.timeoutAtMs;
      if (t < next) { next = t; who = l; isComplete = c; }
    }
    if (!who) {
      const held = s.lanes.find((l) => l.wait);
      if (held) failGroup(s, held, 'DEADLOCK', stepOf(p, held).step.id, `${stepOf(p, held).step.name}: Interlock 동시 금지로 진행할 수 없음`);
      break;
    }
    if (next > target) break;
    s.timeMs = next;
    if (isComplete) complete(p, s, who);
    else { const { step, a } = stepOf(p, who); failGroup(s, who, 'TIMEOUT', step.id, `${step.name}: 타임아웃 — 완료 신호 ${signalLabel(p, a.completeSignalId)} 미발생`); }
  }
  if (s.status === 'running') s.timeMs = Math.max(s.timeMs, target);
  return { ...rt, state: s };
}

export function runGroupToEnd(rt: GroupRuntime, maxMs = 3_600_000): GroupRuntime {
  let r = rt.state.status === 'idle' ? startGroup(rt) : rt;
  while (r.state.status === 'running' && r.state.timeMs < maxMs) r = advanceGroup(r, 60_000);
  return r;
}
