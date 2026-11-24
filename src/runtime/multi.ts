// Several instances of one material definition on a flat station sequence (TURN-040).
// Feed count 1 never comes here. A flow that is only step nodes runs in that order.
// A branch, parallel, loop, retry, wait, or substation step is a per-piece flow (TURN-071).
// At one virtual instant, in piece-index order: seat whoever may enter, commit a move
// that was waiting for room, then start the next step. Device exclusivity and unit
// capacity wait instead of failing. A piece's own location, state, and holder are what
// its conditions see. Sensor signals stay on while any piece is in the unit.
import { stepOrder } from '../model/flow';
import { feedMaterialAt, materialMark, mixActive, pieceHead } from '../model/materialMix';
import type { Action, Project } from '../model/types';
import { feedCountOf } from '../model/types';
import {
  applySensorSignals, evalCond, ms, signalLabel, unmetText,
  type PieceRun, type Runtime, type RuntimeState, type StepRecord,
} from './engine';
import { judgeInterlock, type InterlockHit } from './interlock';

export function makePieces(p: Project): PieceRun[] | null {
  const m = p.materials[0];
  const n = feedCountOf(m);
  if (!m || n <= 1 || !m.initialLocation || !m.initialState) return null;
  const interval = ms(m.feedInterval.value);
  const first = stepOrder(p)?.[0] ?? 0;
  const pieces: PieceRun[] = [];
  for (let i = 0; i < n; i++) {
    const def = feedMaterialAt(p, i) ?? m;
    const state = def.initialState ?? m.initialState;
    const instanceId = `${def.id}#${i + 1}`;
    pieces.push({
      index: i + 1,
      instanceId,
      material: { instanceId, materialId: def.id, location: '', state, holder: null },
      stepIndex: first,
      planCursor: 0,
      phase: 'queued',
      active: null,
      readyAtMs: i * interval,
      fedAtMs: null,
      exitedAtMs: null,
      waitMs: 0,
      waitByUnit: {},
      wait: null,
      pendingWaitMs: 0,
      pendingWaitNote: '',
    });
  }
  return pieces;
}

/** Place pieces whose feed time has arrived and whose start unit has room. No steps start. */
export function seatPieces(p: Project, s: RuntimeState): void {
  tryAdmit(p, s);
  syncView(p, s);
}

function logAt(s: RuntimeState, level: 'info' | 'warn' | 'error', code: string, message: string, refId?: string) {
  s.log.push({ t: s.timeMs, level, code, message, refId });
}

function piecesOf(s: RuntimeState): PieceRun[] {
  return s.pieces ?? [];
}

function capOf(p: Project, unitId: string): number {
  return p.units.find((u) => u.id === unitId)?.capacity.maxMaterials.value ?? 0;
}

function countAt(pieces: PieceRun[], unitId: string, exceptId?: string): number {
  let n = 0;
  for (const pc of pieces) {
    if (pc.phase === 'queued' || pc.instanceId === exceptId) continue;
    if (pc.material.location === unitId) n += 1;
  }
  return n;
}

function deviceBusy(p: Project, pieces: PieceRun[], deviceId: string): boolean {
  for (const pc of pieces) {
    if (!pc.active) continue;
    const step = p.sequence.steps[pc.active.stepIndex];
    const action = step ? p.actions.find((a) => a.id === step.actionId) : undefined;
    if (action?.deviceId === deviceId) return true;
  }
  return false;
}

function closeWait(s: RuntimeState, pc: PieceRun) {
  const wait = pc.wait;
  if (!wait) return;
  const dt = s.timeMs - wait.sinceMs;
  pc.wait = null;
  if (dt <= 0) return;
  pc.waitMs += dt;
  pc.waitByUnit[wait.unitId] = (pc.waitByUnit[wait.unitId] ?? 0) + dt;
  if (pc.active) {
    const rec = s.steps[pc.active.recordIndex];
    if (rec) {
      rec.waitMs = (rec.waitMs ?? 0) + dt;
      rec.waitNote = wait.note;
    }
  } else {
    pc.pendingWaitMs += dt;
    pc.pendingWaitNote = wait.note;
  }
  logAt(s, 'info', 'WAIT_END', `개체 ${pc.index} 대기 끝 — ${wait.note} ${(dt / 1000).toFixed(3)}s`, pc.instanceId);
}

function openWait(s: RuntimeState, pc: PieceRun, wait: { reason: 'device' | 'capacity' | 'interlock'; unitId: string; note: string }) {
  if (pc.wait && pc.wait.note === wait.note && pc.wait.unitId === wait.unitId) return;
  closeWait(s, pc);
  pc.wait = { ...wait, sinceMs: s.timeMs };
  pc.phase = 'waiting';
  logAt(s, 'info', 'WAIT', `개체 ${pc.index} 대기 — ${wait.note}`, pc.instanceId);
}

export function admitPieces(p: Project, s: RuntimeState): boolean {
  return tryAdmit(p, s);
}

function tryAdmit(p: Project, s: RuntimeState): boolean {
  const pieces = piecesOf(s);
  let changed = false;
  const blocked = new Set<string>();
  for (let i = 0; i < pieces.length; i++) {
    const pc = pieces[i];
    if (pc.fedAtMs != null) continue;
    if (pc.phase !== 'queued' && pc.phase !== 'waiting') continue;
    if (pc.readyAtMs > s.timeMs) break;
    const def = p.materials.find((m) => m.id === pc.material.materialId) ?? p.materials[0];
    const start = def?.initialLocation;
    if (!def || !start || !def.initialState) continue;
    const unit = p.units.find((u) => u.id === start);
    if (blocked.has(start) || countAt(pieces, start) >= capOf(p, start)) {
      if (s.status === 'running') {
        openWait(s, pc, { reason: 'capacity', unitId: start, note: `Unit 가득 (${unit?.name ?? start})` });
      }
      blocked.add(start);
      const laterOther = pieces.slice(i + 1).some((other) => {
        if (other.fedAtMs != null || other.readyAtMs > s.timeMs) return false;
        const otherDef = p.materials.find((m) => m.id === other.material.materialId) ?? p.materials[0];
        return !!otherDef?.initialLocation && otherDef.initialLocation !== start;
      });
      if (!laterOther) break;
      continue;
    }
    closeWait(s, pc);
    pc.phase = 'ready';
    pc.fedAtMs = s.timeMs;
    pc.material = { ...pc.material, location: start, state: def.initialState, holder: null };
    const kind = mixActive(p) ? ` 종류 ${materialMark(p, def.id)}` : '';
    logAt(s, 'info', 'FEED', `개체 ${pc.index}${kind} 투입 — ${unit?.name ?? start}`, pc.instanceId);
    changed = true;
  }
  return changed;
}

function syncView(p: Project, s: RuntimeState) {
  const pieces = piecesOf(s);
  const focus = pieces.find((pc) => pc.phase !== 'done' && pc.phase !== 'queued')
    ?? pieces.find((pc) => pc.phase !== 'queued')
    ?? pieces[0];
  s.material = focus ? { ...focus.material } : null;
  for (const u of p.units) {
    const at = pieces.find((pc) => pc.phase !== 'queued' && pc.material.location === u.id);
    s.occupancy[u.id] = at ? at.instanceId : null;
  }
  const act = pieces.find((pc) => pc.active);
  if (act?.active) {
    const step = p.sequence.steps[act.active.stepIndex];
    s.stepIndex = act.active.stepIndex;
    s.active = {
      stepIndex: act.active.stepIndex,
      startMs: act.active.startMs,
      completeAtMs: act.active.hold ? null : act.active.completeAtMs,
      timeoutAtMs: act.active.timeoutAtMs,
      stepId: step?.id,
    };
  } else s.active = null;
}

function failRun(s: RuntimeState, code: string, stepId: string | null, message: string) {
  s.status = 'error';
  s.error = { code, stepId, message };
  if (stepId) {
    const rec = [...s.steps].reverse().find((r) => r.stepId === stepId && r.status === 'active');
    if (rec) { rec.status = 'error'; rec.endMs = s.timeMs; }
    else s.steps.push({ stepId, status: 'error', startMs: s.timeMs, endMs: s.timeMs });
  }
  for (const rec of s.steps) {
    if (rec.status === 'active') { rec.status = 'stopped'; rec.endMs = s.timeMs; }
  }
  for (const pc of piecesOf(s)) pc.active = null;
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

function pushBlock(s: RuntimeState, stepId: string, hit: InterlockHit) {
  s.interlockBlocks.push({
    t: s.timeMs, interlockId: hit.interlockId, description: hit.description,
    stepId, stepName: hit.stepName, reason: hit.reason,
  });
}

function activeActionIds(p: Project, s: RuntimeState, except?: string): string[] {
  const ids: string[] = [];
  for (const other of piecesOf(s)) {
    if (!other.active || other.instanceId === except) continue;
    const step = p.sequence.steps[other.active.stepIndex];
    if (step) ids.push(step.actionId);
  }
  return ids;
}

function actionOf(p: Project, stepIndex: number): { step: Project['sequence']['steps'][number]; action: Action } | null {
  const step = p.sequence.steps[stepIndex];
  const action = step ? p.actions.find((a) => a.id === step.actionId) : undefined;
  return step && action ? { step, action } : null;
}

function tryStart(p: Project, s: RuntimeState, pc: PieceRun): boolean {
  if (pc.fedAtMs == null || pc.phase === 'done' || pc.phase === 'queued' || pc.active) return false;
  const plan = stepOrder(p) ?? [];
  if (pc.planCursor >= plan.length) {
    closeWait(s, pc);
    pc.phase = 'done';
    return true;
  }
  pc.stepIndex = plan[pc.planCursor];
  const found = actionOf(p, pc.stepIndex);
  if (!found) {
    failRun(s, 'REF_MISSING_ACTION', p.sequence.steps[pc.stepIndex]?.id ?? null, `개체 ${pc.index}: 단계의 Action 을 찾을 수 없음`);
    return false;
  }
  const { step, action: a } = found;
  const dev = p.devices.find((d) => d.id === a.deviceId);
  if (deviceBusy(p, piecesOf(s), a.deviceId)) {
    openWait(s, pc, {
      reason: 'device',
      unitId: dev?.unitId ?? a.unitId,
      note: `Device 사용 중 (${dev?.name ?? a.deviceId})`,
    });
    return false;
  }
  const to = a.effect.moveTo;
  if (to && to !== 'EXIT') {
    const unit = p.units.find((u) => u.id === to);
    if (countAt(piecesOf(s), to, pc.instanceId) >= capOf(p, to)) {
      openWait(s, pc, { reason: 'capacity', unitId: to, note: `Unit 가득 (${unit?.name ?? to})` });
      return false;
    }
  }
  const view = { signals: s.signals, material: pc.material };
  const gate = judgeInterlock(
    p, a.id, step.name, activeActionIds(p, s, pc.instanceId), true,
    (c) => evalCond(c, view, p), unmetText,
  );
  if (gate.kind === 'wait') {
    openWait(s, pc, { reason: 'interlock', unitId: gate.wait.unitId, note: gate.wait.note });
    return false;
  }
  if (gate.kind === 'block') {
    closeWait(s, pc);
    pushBlock(s, step.id, gate.hit);
    const message = gate.hit.message.replace(`[${step.name}]`, `[개체 ${pc.index} ${step.name}]`);
    failRun(s, 'INTERLOCK_BLOCK', step.id, message);
    return false;
  }
  closeWait(s, pc);
  for (const c of [...step.entry, ...a.pre]) {
    const r = evalCond(c, view, p);
    if (!r.ok) {
      failRun(s, 'PRE_UNMET', step.id, `[개체 ${pc.index} ${step.name}] 전제 조건 미충족: ${unmetText(r)}`);
      return false;
    }
  }
  if (a.completeSignalId) s.signals[a.completeSignalId] = false;
  if (a.commandSignalId) s.signals[a.commandSignalId] = true;
  const timeout = (step.timeoutOverride ?? a.timeout).value ?? 0;
  const neverTrue = a.completeSignalId ? p.simSettings.faults.neverTrueSignalIds.includes(a.completeSignalId) : true;
  const rec: StepRecord = {
    stepId: step.id, status: 'active', startMs: s.timeMs, lane: pieceHead(p, pc.index, pc.material.materialId), instanceId: pc.instanceId,
  };
  if (pc.pendingWaitMs > 0) {
    rec.waitMs = pc.pendingWaitMs;
    rec.waitNote = pc.pendingWaitNote;
    pc.pendingWaitMs = 0;
    pc.pendingWaitNote = '';
  }
  s.steps.push(rec);
  pc.active = {
    stepIndex: pc.stepIndex,
    startMs: s.timeMs,
    completeAtMs: neverTrue ? null : s.timeMs + ms(a.duration.value),
    timeoutAtMs: s.timeMs + ms(timeout),
    recordIndex: s.steps.length - 1,
    hold: false,
  };
  pc.phase = 'active';
  logAt(s, 'info', 'STEP_START', `[개체 ${pc.index} ${step.name}] 시작 — 명령 ${signalLabel(p, a.commandSignalId)}=ON, 완료조건 ${signalLabel(p, a.completeSignalId)}=true 대기 (가정 ${a.duration.value}s, 타임아웃 ${timeout}s)`, step.id);
  return true;
}

function commitStep(p: Project, s: RuntimeState, pc: PieceRun): boolean {
  const active = pc.active;
  if (!active) return false;
  const found = actionOf(p, active.stepIndex);
  if (!found) {
    failRun(s, 'REF_MISSING_ACTION', null, `개체 ${pc.index}: 단계의 Action 을 찾을 수 없음`);
    return false;
  }
  const { step, action: a } = found;
  const to = a.effect.moveTo;
  if (to && to !== 'EXIT' && countAt(piecesOf(s), to, pc.instanceId) >= capOf(p, to)) {
    const unit = p.units.find((u) => u.id === to);
    active.hold = true;
    openWait(s, pc, { reason: 'capacity', unitId: to, note: `Unit 가득 (${unit?.name ?? to})` });
    return false;
  }
  if (a.completeSignalId) s.signals[a.completeSignalId] = true;
  const readFail = readIsFailing(p, s, a.id);
  if (a.kind === 'read') {
    const resultSig = p.signals.find((x) => x.deviceId === a.deviceId && x.role === 'result');
    if (resultSig) s.signals[resultSig.id] = !readFail;
  }
  if (readFail) {
    const def = p.materials.find((m) => m.id === pc.material.materialId) ?? p.materials[0];
    if (def?.states.includes('식별실패')) pc.material = { ...pc.material, state: '식별실패' };
    failRun(s, 'READ_FAILED', step.id, `[개체 ${pc.index} ${step.name}] 읽기 완료, 결과=실패 (식별 실패 상태 구별). 이후 공정 진행 안 함`);
    return false;
  }
  const m = { ...pc.material };
  if (a.effect.holder !== undefined) m.holder = a.effect.holder;
  if (a.effect.moveTo) {
    m.location = a.effect.moveTo;
    if (a.effect.moveTo === 'EXIT') pc.exitedAtMs = s.timeMs;
  }
  if (a.effect.setState) m.state = a.effect.setState;
  const tentative = { signals: s.signals, material: m };
  for (const c of a.post) {
    const r = evalCond(c, tentative, p);
    if (!r.ok) {
      failRun(s, 'POST_UNMET', step.id, `[개체 ${pc.index} ${step.name}] 완료 후 조건 미충족: ${unmetText(r)} — 상태 변경 커밋 안 함`);
      return false;
    }
  }
  closeWait(s, pc);
  pc.material = m;
  if (a.commandSignalId) s.signals[a.commandSignalId] = false;
  for (const sg of p.signals) if (sg.deviceId === a.deviceId && sg.role === 'complete' && sg.id !== a.completeSignalId) s.signals[sg.id] = false;
  if (a.targetPositionId) s.devicePositions[a.deviceId] = a.targetPositionId;
  const rec = s.steps[active.recordIndex];
  if (rec) { rec.status = 'done'; rec.endMs = s.timeMs; }
  logAt(s, 'info', 'STEP_DONE', `[개체 ${pc.index} ${step.name}] 완료 — 자재 ${m.location}/${m.state}${m.holder ? `/잡음:${m.holder}` : ''}`, step.id);
  pc.active = null;
  pc.planCursor += 1;
  const plan = stepOrder(p) ?? [];
  if (pc.planCursor >= plan.length) pc.phase = 'done';
  else { pc.stepIndex = plan[pc.planCursor]; pc.phase = 'ready'; }
  applySensorSignals(p, s);
  return true;
}

function eventAt(pc: PieceRun): number | null {
  if (!pc.active || pc.active.hold) return null;
  const done = pc.active.completeAtMs !== null && pc.active.completeAtMs <= pc.active.timeoutAtMs;
  return done ? pc.active.completeAtMs! : pc.active.timeoutAtMs;
}

function nextInstant(s: RuntimeState): number | null {
  let t = Infinity;
  for (const pc of piecesOf(s)) {
    const ev = eventAt(pc);
    if (ev !== null && ev < t) t = ev;
    if (pc.phase === 'queued' && pc.readyAtMs > s.timeMs && pc.readyAtMs < t) t = pc.readyAtMs;
  }
  return t === Infinity ? null : t;
}

function deadlockText(pieces: PieceRun[]): string {
  const parts = pieces.filter((pc) => pc.phase !== 'done').map((pc) => {
    const note = pc.wait?.note ?? (pc.phase === 'queued' ? '투입 대기' : pc.phase);
    return `개체 ${pc.index}: ${note}`;
  });
  return `서로 기다려 진행할 수 없음 — ${parts.join(', ')}`;
}

function settle(p: Project, s: RuntimeState): void {
  let guard = 0;
  let progressed = true;
  while (progressed && s.status === 'running' && guard++ < 10000) {
    progressed = false;
    if (tryAdmit(p, s)) progressed = true;
    if (s.status !== 'running') return;
    for (const pc of piecesOf(s)) {
      if (pc.active?.hold && commitStep(p, s, pc)) progressed = true;
      if (s.status !== 'running') return;
    }
    for (const pc of piecesOf(s)) {
      if (tryStart(p, s, pc)) progressed = true;
      if (s.status !== 'running') return;
    }
  }
}

export function advancePieces(rt: Runtime, dtMs: number): Runtime {
  const p = rt.snapshot;
  const s = structuredClone(rt.state);
  const target = s.timeMs + Math.round(dtMs);
  let guard = 0;
  while (s.status === 'running' && guard++ < 100000) {
    settle(p, s);
    if (s.status !== 'running') break;
    if (piecesOf(s).every((pc) => pc.phase === 'done')) {
      s.status = 'completed';
      s.active = null;
      logAt(s, 'info', 'RUN_COMPLETE', `시퀀스 완료 — 개체 ${piecesOf(s).length}개 배출`);
      break;
    }
    const ev = nextInstant(s);
    if (ev === null) {
      failRun(s, 'DEADLOCK', null, deadlockText(piecesOf(s)));
      break;
    }
    if (ev > target) break;
    s.timeMs = ev;
    const due = piecesOf(s).filter((pc) => eventAt(pc) === ev).sort((a, b) => a.index - b.index);
    for (const pc of due) {
      if (s.status !== 'running' || !pc.active) continue;
      const timedOut = pc.active.completeAtMs === null || pc.active.completeAtMs > pc.active.timeoutAtMs;
      if (timedOut) {
        const found = actionOf(p, pc.active.stepIndex);
        failRun(s, 'TIMEOUT', found?.step.id ?? null, `[개체 ${pc.index} ${found?.step.name ?? ''}] 타임아웃 — 완료 신호 ${signalLabel(p, found?.action.completeSignalId)} 미발생. 이후 공정 통과 안 함`);
        break;
      }
      commitStep(p, s, pc);
      if (s.status !== 'running') break;
    }
  }
  if (s.status === 'running') s.timeMs = Math.max(s.timeMs, target);
  syncView(p, s);
  applySensorSignals(p, s);
  return { ...rt, state: s };
}
