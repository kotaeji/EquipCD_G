// Shared device / material conflict check for Substation sequences and Station parallel lanes.
// Messages for a Substation group match the historical group runtime text.
import type { Action, Condition, Project, SequenceStep } from './types';
import type { Diagnostic } from './validate';

export interface LaneRef { id: string; name: string; steps: SequenceStep[] }

const touchesMaterial = (a: Action) => a.effect.moveTo !== undefined || a.effect.holder !== undefined || a.effect.setState !== undefined || a.kind === 'read';
const matCond = (c: Condition) => c.kind === 'materialAt' || c.kind === 'materialState' || c.kind === 'materialHeldBy';

export interface LaneCheck { blockers: Diagnostic[]; usesMaterial: boolean }

/**
 * `unitId` set: each step's device must belong to that Substation (group rule).
 * `unitId` omitted: lanes may use different Substations (a Station parallel block).
 */
export function checkLanes(p: Project, lanes: LaneRef[], unitId?: string): LaneCheck {
  const blockers: Diagnostic[] = [];
  const b = (code: string, objectId: string, message: string) =>
    blockers.push({ id: `${code}:${objectId}:${blockers.length}`, severity: 'error', code, objectId, message });
  const devOwner = new Map<string, string>();
  const matOwners = new Set<string>();
  const unit = unitId ? p.units.find((u) => u.id === unitId) : undefined;
  const word = unitId ? '시퀀스' : '갈래';
  for (const q of lanes) {
    if (q.steps.length === 0) b('NO_STEPS', q.id, `[${q.name}] 단계가 없음`);
    const devs = new Set<string>();
    for (const s of q.steps) {
      const a = p.actions.find((x) => x.id === s.actionId);
      const dev = a && p.devices.find((d) => d.id === a.deviceId);
      if (!a || !dev) continue;
      if (unitId && dev.unitId !== unitId) b('DEVICE_OUTSIDE_SUBSTATION', s.id, `[${q.name}] ${s.name}: Device ${dev.name}는 ${unit?.name ?? unitId} 소속이 아님 — Substation 밖 Device는 그룹 시퀀스에 넣을 수 없음`);
      devs.add(dev.id);
      if (!a.completeSignalId) b('NO_COMPLETE_SIGNAL', s.id, `[${q.name}] ${s.name}: 완료 Signal 미정 — 완료 판정 불가`);
      if (a.duration.value === null) b('DURATION_UNDEFINED', s.id, `[${q.name}] ${s.name}: 동작 시간 미정`);
      if ((s.timeoutOverride ?? a.timeout).value === null) b('TIMEOUT_UNDEFINED', s.id, `[${q.name}] ${s.name}: 타임아웃 미정`);
      for (const c of [...a.pre, ...a.post, ...s.entry]) if (c.kind === 'undefined') b('CONDITION_UNDEFINED', s.id, `[${q.name}] ${s.name}: 미정 조건 "${c.note}" — 임의 true 처리 안 함`);
      if (touchesMaterial(a) || [...a.pre, ...a.post, ...s.entry].some(matCond)) matOwners.add(q.id);
      const mv = a.effect.moveTo;
      if (mv && mv !== 'EXIT' && p.units.find((u) => u.id === mv)?.capacity.maxMaterials.value === null) b('CAPACITY_UNDEFINED', s.id, `[${q.name}] ${s.name}: 이동 대상 수용 개수 미정`);
    }
    for (const d of devs) {
      const prev = devOwner.get(d);
      if (prev) b('DEVICE_CONFLICT', d, `Device ${p.devices.find((x) => x.id === d)?.name ?? d}를 ${word} "${prev}"와 "${q.name}"가 함께 사용 — 동시 쓰기(명령/완료 Signal 충돌)를 이 시제품은 해석하지 않으므로 실행 전 차단`);
      else devOwner.set(d, q.name);
    }
  }
  if (matOwners.size > 1) b('SHARED_MATERIAL_CONFLICT', unitId ?? 'parallel', `자재를 다루는 ${word}가 ${matOwners.size}개 (${lanes.filter((q) => matOwners.has(q.id)).map((q) => q.name).join(', ')}) — 자재 중복 소유/동시 이동은 지원하지 않아 실행 전 차단 (자재를 다루는 ${word}는 1개만 허용)`);
  return { blockers, usesMaterial: matOwners.size > 0 };
}
