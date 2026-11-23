// Run-result gaps (TURN-043). Reads a finished RuntimeState. Does not advance time
// and does not write the engine or the project file.
import type { Gap, GapKind, RunGapFix } from './gaps';
import { findById } from './flow';
import type { Project } from './types';
import type { PieceRun, RuntimeState, StepRecord } from '../runtime/engine';

/**
 * [설계 제안] 한 개 통과 시간에서 한 단계가 이 몫 이상이면 실행 결과 Gap.
 * 승인된 제품 기준이 아니다. 이 파일의 이 상수가 유일한 기준값이다.
 */
export const RUN_STEP_SHARE = 0.3;

const SHARE_NOTE = `[설계 제안] 한 단계가 한 개 통과 시간의 ${Math.round(RUN_STEP_SHARE * 100)}% 이상`;

/** Steady-state cycle, or the first piece's pass time when fewer than 3 pieces exist. */
export function steadyCycleMs(pieces: readonly { fedAtMs: number | null; exitedAtMs: number | null }[]): number | null {
  if (pieces.length < 3) {
    const first = pieces[0];
    if (first?.fedAtMs == null || first.exitedAtMs == null) return null;
    return first.exitedAtMs - first.fedAtMs;
  }
  const exits = pieces.map((pc) => pc.exitedAtMs).filter((t): t is number => t != null).sort((a, b) => a - b);
  if (exits.length < 2) return null;
  let sum = 0;
  for (let i = 1; i < exits.length; i++) sum += exits[i] - exits[i - 1];
  return sum / (exits.length - 1);
}

function formatMs(msv: number): string {
  const v = Math.abs(Math.round(msv));
  const sign = msv < 0 ? '-' : '';
  return `${sign}${String(Math.floor(v / 60000)).padStart(2, '0')}:${String(Math.floor(v / 1000) % 60).padStart(2, '0')}.${String(v % 1000).padStart(3, '0')}`;
}

function sec(msv: number): string {
  return (msv / 1000).toFixed(3);
}

function basis(t: number, code: string, stepName: string): string {
  return `가상 시각 ${formatMs(t)} · 로그 ${code} · 단계 ${stepName}`;
}

function stepOf(p: Project, stepId: string) {
  return p.sequence.steps.find((s) => s.id === stepId)
    ?? (p.substationSequences ?? []).flatMap((q) => q.steps).find((s) => s.id === stepId);
}

function actionOf(p: Project, stepId: string) {
  const step = stepOf(p, stepId);
  const action = step ? p.actions.find((a) => a.id === step.actionId) : undefined;
  return step && action ? { step, action } : null;
}

function gap(partial: Omit<Gap, 'fromRun' | 'safety' | 'judgement'> & { judgement?: Gap['judgement'] }): Gap {
  return { safety: false, judgement: partial.judgement ?? 'shortfall', fromRun: true, ...partial };
}

function charges(message: string, unitName: string, deviceNames: readonly string[]): { capacity: boolean; device: boolean } {
  return {
    capacity: message.includes(`Unit 가득 (${unitName})`),
    device: deviceNames.some((name) => message.includes(`Device 사용 중 (${name})`)),
  };
}

function waitOn(pc: PieceRun, unitId: string, now: number): number {
  let ms = pc.waitByUnit[unitId] ?? 0;
  if (pc.wait?.unitId === unitId) ms += Math.max(0, now - pc.wait.sinceMs);
  return ms;
}

function bottleneckGap(p: Project, rt: RuntimeState): Gap | null {
  const pieces = rt.pieces ?? [];
  if (pieces.length === 0) return null;
  let best: { unitId: string; name: string; ms: number; count: number } | null = null;
  for (const unit of p.units) {
    let ms = 0;
    let count = 0;
    for (const pc of pieces) {
      const w = waitOn(pc, unit.id, rt.timeMs);
      if (w > 0) { ms += w; count += 1; }
    }
    if (ms <= 0) continue;
    if (!best || ms > best.ms) best = { unitId: unit.id, name: unit.name, ms, count };
  }
  if (!best) return null;
  const unit = p.units.find((u) => u.id === best.unitId)!;
  const deviceNames = p.devices.filter((d) => d.unitId === unit.id).map((d) => d.name);
  const reasons = new Set<string>();
  const stepNames = new Set<string>();
  let when = rt.timeMs;
  let code = 'WAIT';
  for (const entry of rt.log) {
    if (entry.code !== 'WAIT' && entry.code !== 'WAIT_END') continue;
    const hit = charges(entry.message, unit.name, deviceNames);
    if (!hit.capacity && !hit.device) continue;
    if (hit.capacity) reasons.add('Unit 가득');
    if (hit.device) reasons.add('Device 사용 중');
    if (entry.code === 'WAIT_END') { code = 'WAIT_END'; when = entry.t; }
    else if (code !== 'WAIT_END') when = entry.t;
  }
  for (const rec of rt.steps) {
    if (!rec.waitNote || !(rec.waitMs && rec.waitMs > 0)) continue;
    const hit = charges(rec.waitNote, unit.name, deviceNames);
    if (!hit.capacity && !hit.device) continue;
    const name = stepOf(p, rec.stepId)?.name;
    if (name) stepNames.add(name);
  }
  if (stepNames.size === 0) {
    const fallback = p.sequence.steps.find((s) => actionOf(p, s.id)?.action.unitId === unit.id)?.name ?? unit.name;
    stepNames.add(fallback);
  }
  const why = [...reasons].join(' · ') || '대기';
  return gap({
    id: `run:bottleneck:${unit.id}`,
    kind: 'timing',
    title: `병목 Unit ${unit.name}`,
    evidence: `기다린 시간 합 ${sec(best.ms)} s · 기다린 개체 ${best.count} · 까닭 ${why}. ${basis(when, code, [...stepNames].join(' · '))}`,
    stepIds: p.sequence.steps.filter((s) => actionOf(p, s.id)?.action.unitId === unit.id).map((s) => s.id),
    objectIds: [unit.id],
    suggestion: `${unit.name}에서 기다린 시간이 가장 깁니다. 이 Unit의 동작 시간을 줄이거나 수용 개수를 늘리세요.`,
    target: { panel: 'canvas', objectId: unit.id },
    assumptions: ['[설계 제안] 병목은 기다린 시간 합이 가장 큰 Unit'],
    fix: { to: 'unit', unitId: unit.id },
  });
}

function cycleGap(p: Project, rt: RuntimeState): Gap | null {
  const pieces = rt.pieces ?? [];
  const material = p.materials[0];
  if (rt.status !== 'completed' || !material || pieces.length < 3) return null;
  const interval = material.feedInterval.value;
  if (interval == null) return null;
  const cycle = steadyCycleMs(pieces);
  const intervalMs = Math.round(interval * 1000);
  if (cycle == null || !(cycle > intervalMs)) return null;
  const exits = pieces.map((pc) => pc.exitedAtMs).filter((t): t is number => t != null).sort((a, b) => a - b);
  const lastDone = [...rt.log].reverse().find((entry) => entry.code === 'STEP_DONE');
  const lastStep = p.sequence.steps[p.sequence.steps.length - 1];
  const stepName = (lastDone?.refId ? stepOf(p, lastDone.refId)?.name : undefined) ?? lastStep?.name ?? '배출';
  const when = exits.length ? exits[exits.length - 1] : rt.timeMs;
  return gap({
    id: `run:cycle:${material.id}`,
    kind: 'timing',
    title: '사이클 > 투입 간격',
    evidence: `정상 상태 사이클 ${sec(cycle)} s > 투입 간격 ${interval.toFixed(3)} s. 배출 시각 ${exits.map((t) => `${sec(t)} s`).join(', ')}. ${basis(when, 'RUN_COMPLETE', stepName)}`,
    stepIds: lastDone?.refId ? [lastDone.refId] : [],
    objectIds: [material.id],
    suggestion: '투입 간격을 사이클 이상으로 늘리거나, 오래 걸리는 단계의 동작 시간을 줄이세요.',
    target: { panel: 'material', objectId: material.id },
    assumptions: ['[설계 제안] 정상 상태 사이클은 배출 간격의 평균 (개체 3개 이상)'],
    fix: { to: 'interval', materialId: material.id },
  });
}

function elapsedOf(rec: StepRecord): number | null {
  if (rec.status !== 'done' || rec.startMs == null || rec.endMs == null) return null;
  return rec.endMs - rec.startMs;
}

function shareGaps(p: Project, rt: RuntimeState): Gap[] {
  if (rt.status !== 'completed') return [];
  const first = rt.pieces?.[0];
  let pass: number | null = null;
  if (first) {
    if (first.fedAtMs == null || first.exitedAtMs == null) return [];
    pass = first.exitedAtMs - first.fedAtMs;
  } else if (rt.timeMs > 0) pass = rt.timeMs;
  if (pass == null || pass <= 0) return [];
  const rows = first ? rt.steps.filter((rec) => rec.instanceId === first.instanceId) : rt.steps;
  const byStep = new Map<string, { ms: number; end: number }>();
  for (const rec of rows) {
    const elapsed = elapsedOf(rec);
    if (elapsed == null || elapsed <= 0) continue;
    const prev = byStep.get(rec.stepId) ?? { ms: 0, end: 0 };
    byStep.set(rec.stepId, { ms: prev.ms + elapsed, end: Math.max(prev.end, rec.endMs ?? 0) });
  }
  const found: { stepId: string; ms: number; end: number; share: number }[] = [];
  for (const [stepId, row] of byStep) {
    const share = row.ms / pass;
    if (share + 1e-9 >= RUN_STEP_SHARE) found.push({ stepId, ms: row.ms, end: row.end, share });
  }
  found.sort((a, b) => b.share - a.share || a.stepId.localeCompare(b.stepId));
  return found.flatMap((row) => {
    const foundStep = actionOf(p, row.stepId);
    if (!foundStep) return [];
    const { step, action } = foundStep;
    const fix: RunGapFix = { to: 'duration', actionId: action.id, deviceId: action.deviceId };
    return [gap({
      id: `run:share:${step.id}`,
      kind: 'timing',
      title: `${step.name}: 통과 시간의 큰 몫`,
      evidence: `단계 시간 ${sec(row.ms)} s / 통과 시간 ${sec(pass)} s (${Math.round(row.share * 100)}%). ${basis(row.end, 'STEP_DONE', step.name)}`,
      stepIds: [step.id],
      objectIds: [action.deviceId, action.id],
      suggestion: `${step.name}의 동작 시간을 줄이면 한 개 통과 시간이 짧아집니다.`,
      target: { panel: 'configurator', objectId: action.deviceId },
      assumptions: [SHARE_NOTE],
      fix,
    })];
  });
}

function errorKind(code: string): GapKind {
  if (code === 'CAPACITY_FULL') return 'unit';
  if (code === 'INTERLOCK_BLOCK') return 'interference';
  if (code === 'PRE_UNMET' || code === 'POST_UNMET' || code === 'READ_FAILED') return 'io';
  return 'timing';
}

function errorTitle(code: string, stepName: string | null): string {
  if (code === 'DEADLOCK') return '교착';
  if (code === 'TIMEOUT') return `${stepName ?? '실행'} 타임아웃`;
  if (code === 'INTERLOCK_BLOCK') return `${stepName ?? '실행'} Interlock 차단`;
  if (code === 'WAIT_TIMEOUT') return `${stepName ?? '신호 기다림'} 시간 초과`;
  if (code === 'PRE_UNMET' || code === 'POST_UNMET') return `${stepName ?? '실행'} 조건 불충족`;
  if (code === 'CAPACITY_FULL') return `${stepName ?? '실행'} 수용 부족`;
  return `${stepName ?? '실행'} 실행 오류`;
}

function errorSuggestion(code: string): string {
  if (code === 'TIMEOUT') return '타임아웃을 동작 시간보다 길게 하거나, 완료 신호가 켜지는지 확인하세요.';
  if (code === 'PRE_UNMET' || code === 'POST_UNMET') return '이 단계의 조건을 맞추거나, 앞 단계가 그 조건을 만들게 하세요.';
  if (code === 'DEADLOCK') return '서로 기다리는 Unit의 수용이나 순서를 바꾸세요.';
  if (code === 'CAPACITY_FULL') return 'Unit 수용 개수를 늘리거나, 앞 단계가 비운 뒤에 들어가게 하세요.';
  if (code === 'READ_FAILED') return '읽기 결과가 실패입니다. 조건이나 오류 주입을 확인하세요.';
  if (code === 'INTERLOCK_BLOCK') return '확인된 Interlock이 이 단계의 시작을 막았습니다. 조건을 맞추거나 확인을 거절하세요.';
  if (code === 'WAIT_TIMEOUT') return '타임아웃을 늘리거나, 다른 갈래가 그 조건을 먼저 만들게 하세요.';
  return '이 단계에서 실행이 멈췄습니다. 근거를 보고 그 칸을 고치세요.';
}

function flowWaitName(p: Project, id: string | null): string | null {
  if (!id || !p.sequence.flow) return null;
  const hit = findById(p.sequence.flow, id);
  return hit?.node.kind === 'wait' ? hit.node.name : null;
}

function errorGap(p: Project, rt: RuntimeState): Gap | null {
  if (rt.status !== 'error' || !rt.error) return null;
  const err = rt.error;
  const found = err.stepId ? actionOf(p, err.stepId) : null;
  const waited = err.code === 'WAIT_TIMEOUT' ? flowWaitName(p, err.stepId) : null;
  const stopped = rt.steps.find((rec) => rec.status === 'error' || rec.status === 'stopped');
  const stepName = found?.step.name ?? waited ?? (stopped ? stepOf(p, stopped.stepId)?.name : undefined) ?? null;
  const log = [...rt.log].reverse().find((entry) => entry.code === err.code);
  const when = log?.t ?? rt.timeMs;
  const block = err.code === 'INTERLOCK_BLOCK'
    ? (rt.interlockBlocks ?? []).find((row) => row.stepId === err.stepId) ?? rt.interlockBlocks?.[0]
    : undefined;
  let fix: RunGapFix | undefined;
  if (block) fix = { to: 'interlock', interlockId: block.interlockId };
  else if (err.code === 'WAIT_TIMEOUT' && err.stepId) fix = { to: 'flow', blockId: err.stepId };
  else if (err.code === 'TIMEOUT' && found) fix = { to: 'timeout', actionId: found.action.id, deviceId: found.action.deviceId };
  else if (err.code === 'CAPACITY_FULL' && found) fix = { to: 'unit', unitId: found.action.unitId };
  else if (err.code === 'DEADLOCK') {
    const unitId = bottleneckUnitId(p, rt) ?? p.units[0]?.id;
    if (unitId) fix = { to: 'unit', unitId };
  } else if (found) fix = { to: 'step', stepId: found.step.id };
  else if (stopped) fix = { to: 'step', stepId: stopped.stepId };
  const name = stepName ?? '교착';
  return gap({
    id: `run:error:${err.code}:${err.stepId ?? 'none'}`,
    kind: errorKind(err.code),
    title: errorTitle(err.code, stepName),
    evidence: `${err.message}. ${basis(when, err.code, name)}`,
    stepIds: found ? [found.step.id] : err.code === 'WAIT_TIMEOUT' && err.stepId ? [err.stepId] : stopped ? [stopped.stepId] : [],
    objectIds: found ? [found.action.deviceId, found.action.id] : fix?.to === 'unit' ? [fix.unitId] : [],
    suggestion: errorSuggestion(err.code),
    target: fix?.to === 'unit'
      ? { panel: 'canvas', objectId: fix.unitId }
      : fix?.to === 'timeout' || fix?.to === 'duration'
        ? { panel: 'configurator', objectId: fix.deviceId }
        : fix?.to === 'step'
          ? { panel: 'sequence', objectId: fix.stepId }
          : fix?.to === 'flow'
            ? { panel: 'sequence', objectId: fix.blockId }
            : { panel: 'sequence', objectId: p.sequence.steps[0]?.id ?? '' },
    assumptions: ['[설계 제안] 실행이 타임아웃·조건 불충족·교착으로 끝나면 그 단계를 Gap으로 올립니다'],
    ...(fix ? { fix } : {}),
  });
}

function bottleneckUnitId(p: Project, rt: RuntimeState): string | null {
  const pieces = rt.pieces ?? [];
  let best: { id: string; ms: number } | null = null;
  for (const unit of p.units) {
    let ms = 0;
    for (const pc of pieces) ms += waitOn(pc, unit.id, rt.timeMs);
    if (ms <= 0) continue;
    if (!best || ms > best.ms) best = { id: unit.id, ms };
  }
  return best?.id ?? null;
}

/**
 * Gaps read from one finished run. Idle, running, and paused runs contribute nothing.
 * `p` should be the model the run used (the runtime snapshot) so names match the record.
 */
export function analyzeRunGaps(p: Project, rt: RuntimeState | null): Gap[] {
  if (!rt || (rt.status !== 'completed' && rt.status !== 'error')) return [];
  const out: Gap[] = [];
  const bottleneck = bottleneckGap(p, rt);
  if (bottleneck) out.push(bottleneck);
  const cycle = cycleGap(p, rt);
  if (cycle) out.push(cycle);
  out.push(...shareGaps(p, rt));
  const error = errorGap(p, rt);
  if (error) out.push(error);
  return out;
}
