// F6 basic gap analysis — prototype rules (설계 제안). Thresholds/severity are NOT confirmed product rules.
import { getAssetById } from '../assets/library';
import type { GapReviewEntry, Project } from './types';
import { indexProject } from './validate';

export type GapKind = 'io' | 'unit' | 'axisSpec' | 'interference' | 'timing';
export const GAP_KIND_LABEL: Record<GapKind, string> = {
  io: '부족 I/O', unit: '부족 Unit', axisSpec: '미정 축 사양', interference: '간섭 후보', timing: '타이밍 병목',
};

export interface Gap {
  id: string;
  kind: GapKind;
  judgement: 'shortfall' | 'undetermined' | 'candidate'; // 부족 / 비교 불가·미정 / 사람 확인 후보
  title: string;
  evidence: string;
  stepIds: string[];
  objectIds: string[];
  suggestion: string;
  target: { panel: 'configurator' | 'canvas' | 'material' | 'sequence'; objectId: string };
  safety: boolean; // 간섭/안전: 자동 종료 금지
  assumptions: string[];
}

export function analyzeGaps(p: Project): Gap[] {
  const ix = indexProject(p);
  const gaps: Gap[] = [];
  const add = (g: Gap) => { if (!gaps.some((x) => x.id === g.id)) gaps.push(g); };

  // --- 부족 I/O ---
  for (const s of p.sequence.steps) {
    const a = ix.action.get(s.actionId);
    if (!a) { add({ id: `io:missing-action:${s.id}`, kind: 'io', judgement: 'shortfall', title: `단계 ${s.name}: Action 없음`, evidence: `actionId ${s.actionId} 를 찾을 수 없음`, stepIds: [s.id], objectIds: [s.actionId], suggestion: '시퀀스에서 Action 재지정', target: { panel: 'sequence', objectId: s.id }, safety: false, assumptions: [] }); continue; }
    if (!a.completeSignalId || !ix.signal.has(a.completeSignalId))
      add({ id: `io:no-complete:${a.id}`, kind: 'io', judgement: 'shortfall', title: `${a.name}: 완료 Signal 없음`, evidence: a.completeSignalId ? `참조 Signal ${a.completeSignalId} 없음` : '완료 조건 Signal 미지정 — 요구: 완료 판정용 출력(out) 신호', stepIds: [s.id], objectIds: [a.id, a.deviceId], suggestion: 'Configurator에서 완료 Signal 지정 또는 Device에 complete 역할 출력 Signal 추가', target: { panel: 'configurator', objectId: a.deviceId }, safety: false, assumptions: [] });
    if (!a.commandSignalId || !ix.signal.has(a.commandSignalId))
      add({ id: `io:no-command:${a.id}`, kind: 'io', judgement: 'shortfall', title: `${a.name}: 명령 Signal 없음`, evidence: '명령 역할 입력(in) Signal 미지정', stepIds: [s.id], objectIds: [a.id, a.deviceId], suggestion: 'Configurator에서 명령 Signal 지정', target: { panel: 'configurator', objectId: a.deviceId }, safety: false, assumptions: [] });
    for (const c of [...a.pre, ...a.post, ...s.entry]) if (c.kind === 'signal' && !ix.signal.has(c.signalId))
      add({ id: `io:cond-signal:${a.id}:${c.signalId}`, kind: 'io', judgement: 'shortfall', title: `${a.name}: 조건 Signal 없음`, evidence: `조건이 없는 Signal ${c.signalId} 참조`, stepIds: [s.id], objectIds: [a.id], suggestion: '조건 Signal 재지정', target: { panel: 'configurator', objectId: a.deviceId }, safety: false, assumptions: [] });
  }

  // --- 부족 Unit (경로·이동 능력·수용) ---
  const steps = p.sequence.steps.map((s) => ({ s, a: ix.action.get(s.actionId) })).filter((x) => x.a);
  for (const m of p.materials) {
    if (!m.initialLocation || m.route.length === 0)
      add({ id: `unit:no-route:${m.id}`, kind: 'unit', judgement: 'undetermined', title: `${m.name}: 경로/초기 위치 미정`, evidence: '자재 경로 또는 초기 위치가 비어 있음', stepIds: [], objectIds: [m.id], suggestion: 'Material & Flow에서 경로 지정', target: { panel: 'material', objectId: m.id }, safety: false, assumptions: [] });
    for (let i = 0; i < m.route.length - 1; i++) {
      const from = m.route[i], to = m.route[i + 1];
      const fu = ix.unit.get(from), tu = ix.unit.get(to);
      if (!fu || !tu) continue;
      const mover = steps.find(({ a }) => a!.effect.moveTo === to);
      if (!mover) add({ id: `unit:no-mover:${from}:${to}`, kind: 'unit', judgement: 'shortfall', title: `${fu.name} → ${tu.name} 이동 능력 없음`, evidence: `경로 구간을 수행하는 Action(이동 효과 → ${tu.name})이 시퀀스에 없음`, stepIds: [], objectIds: [from, to], suggestion: '이동 Action을 가진 Device/Unit 추가 또는 시퀀스에 단계 추가', target: { panel: 'canvas', objectId: from }, safety: false, assumptions: [] });
      if (!p.connections.some((c) => c.kind === 'flow' && c.from.nodeId === from && c.to.nodeId === to))
        add({ id: `unit:no-flow-link:${from}:${to}`, kind: 'unit', judgement: 'shortfall', title: `${fu.name} → ${tu.name} 물류 연결 없음`, evidence: '자재 경로 구간에 대응하는 물류 흐름 연결선이 캔버스에 없음 (연결선은 자동 이동을 만들지 않음)', stepIds: [], objectIds: [from, to], suggestion: 'Canvas에서 연결 도구로 Unit 간 물류 연결 추가', target: { panel: 'canvas', objectId: from }, safety: false, assumptions: [] });
    }
    for (const uid of m.route) {
      const u = ix.unit.get(uid); if (!u) continue;
      const w = m.weight.value, cap = u.capacity.maxWeight.value;
      if (u.capacity.maxMaterials.value === null)
        add({ id: `unit:cap-count:${uid}`, kind: 'unit', judgement: 'undetermined', title: `${u.name}: 수용 개수 미정`, evidence: '수용 능력이 알려지지 않음 → 적합이 아니라 미정', stepIds: [], objectIds: [uid], suggestion: 'Unit 수용 개수 입력', target: { panel: 'configurator', objectId: uid }, safety: false, assumptions: [] });
      if (w === null || cap === null)
        add({ id: `unit:cap-weight:${uid}:${m.id}`, kind: 'unit', judgement: 'undetermined', title: `${u.name}: 허용 무게 비교 불가`, evidence: `자재 무게 ${w ?? '미정'} kg, Unit 허용 ${cap ?? '미정'} kg`, stepIds: [], objectIds: [uid, m.id], suggestion: '자재 무게 / Unit 허용 무게 입력', target: { panel: cap === null ? 'configurator' : 'material', objectId: cap === null ? uid : m.id }, safety: false, assumptions: [] });
      else if (w > cap)
        add({ id: `unit:over-weight:${uid}:${m.id}`, kind: 'unit', judgement: 'shortfall', title: `${u.name}: 허용 무게 부족`, evidence: `자재 ${w} kg > Unit 허용 ${cap} kg${m.weight.assumption || u.capacity.maxWeight.assumption ? ' (가정값 포함)' : ''}`, stepIds: [], objectIds: [uid, m.id], suggestion: 'Unit 대체 또는 자재 조건 재검토', target: { panel: 'configurator', objectId: uid }, safety: false, assumptions: m.weight.assumption ? ['자재 무게 가정'] : [] });
    }
    // picker payload
    for (const { s, a } of steps) if (a!.effect.holder) {
      const d = ix.device.get(a!.effect.holder); const pl = d?.properties.payload?.value; const w = m.weight.value;
      if (d && pl !== undefined && pl !== null && w !== null && w > pl)
        add({ id: `unit:payload:${d.id}:${m.id}`, kind: 'unit', judgement: 'shortfall', title: `${d.name}: 허용 하중 부족`, evidence: `자재 ${w} kg > 허용 하중 ${pl} kg`, stepIds: [s.id], objectIds: [d.id, m.id], suggestion: '피커 사양 변경/대체', target: { panel: 'configurator', objectId: d.id }, safety: false, assumptions: [] });
    }
  }

  // --- 미정 축 사양 ---
  for (const d of p.devices) {
    const def = getAssetById(d.definitionRef.assetId); if (!def) continue;
    for (const pd of def.properties) if (pd.requiredForRun && (d.properties[pd.key]?.value ?? null) === null)
      add({ id: `axis:${d.id}:${pd.key}`, kind: 'axisSpec', judgement: 'undetermined', title: `${d.name}: ${pd.label} 미정`, evidence: `실행/수용 판정에 필요한 사양(${pd.label}, ${pd.unit})이 비어 있음 — 정상 충족으로 판정하지 않음`, stepIds: p.sequence.steps.filter((s) => ix.action.get(s.actionId)?.deviceId === d.id).map((s) => s.id), objectIds: [d.id], suggestion: 'Configurator에서 사양 입력 (가정값이면 가정 표시)', target: { panel: 'configurator', objectId: d.id }, safety: false, assumptions: [] });
  }
  for (const { s, a } of steps) {
    if (a!.duration.value === null) add({ id: `axis:duration:${a!.id}`, kind: 'axisSpec', judgement: 'undetermined', title: `${a!.name}: 동작 시간 미정`, evidence: '동작 시간 없음 → 타이밍 판정 불가', stepIds: [s.id], objectIds: [a!.id], suggestion: 'Action 동작 시간 입력', target: { panel: 'configurator', objectId: a!.deviceId }, safety: false, assumptions: [] });
  }

  // --- 간섭 후보 (논리 배치 중첩 / Interlock 후보) — 정밀 물리 검증 아님 ---
  for (let i = 0; i < p.devices.length; i++) for (let j = i + 1; j < p.devices.length; j++) {
    const A = p.devices[i].layout, B = p.devices[j].layout;
    if (A.x < B.x + B.w && B.x < A.x + A.w && A.y < B.y + B.h && B.y < A.y + A.h)
      add({ id: `intf:overlap:${p.devices[i].id}:${p.devices[j].id}`, kind: 'interference', judgement: 'candidate', title: `${p.devices[i].name} ↔ ${p.devices[j].name} 2D 배치 중첩`, evidence: `캔버스 도식 사각형 중첩 (${A.x},${A.y},${A.w}x${A.h}) ∩ (${B.x},${B.y},${B.w}x${B.h}) — 정밀 물리/충돌 검증 아님`, stepIds: [], objectIds: [p.devices[i].id, p.devices[j].id], suggestion: '배치 조정 또는 사람이 간섭 여부 확인', target: { panel: 'canvas', objectId: p.devices[i].id }, safety: true, assumptions: ['2D 도식 크기 기준'] });
  }
  for (const k of p.constraints) if (k.kind === 'interlock-candidate' && k.confirmation !== 'confirmed' && k.confirmation !== 'rejected')
    add({ id: `intf:interlock:${k.id}`, kind: 'interference', judgement: 'candidate', title: `Interlock 후보 미확인: ${k.id}`, evidence: k.description, stepIds: [], objectIds: k.relatedIds, suggestion: '사람이 확인/거절 (자동 확정 안 함)', target: { panel: 'configurator', objectId: k.relatedIds[0] ?? '' }, safety: true, assumptions: [] });

  // --- 타이밍 병목 (경량, 가정 시간 기반) ---
  const m = p.materials[0];
  if (m && steps.length) {
    const total = steps.reduce((t, { a }) => t + (a!.duration.value ?? 0), 0);
    const anyUnknown = steps.some(({ a }) => a!.duration.value === null);
    const anyAssumed = steps.some(({ a }) => a!.duration.assumption);
    const perUnit = new Map<string, number>();
    for (const { a } of steps) perUnit.set(a!.unitId, (perUnit.get(a!.unitId) ?? 0) + (a!.duration.value ?? 0));
    const [topUnit, topT] = [...perUnit.entries()].sort((x, y) => y[1] - x[1])[0];
    const assumptions = [`자재 ${p.materials.length}개, 순차 실행(병렬 미지원)`, anyAssumed ? '동작 시간 가정값 포함' : '동작 시간 입력값', `투입 간격 ${m.feedInterval.value ?? '미정'} s${m.feedInterval.assumption ? ' (가정)' : ''}`];
    if (m.feedInterval.value === null || anyUnknown)
      add({ id: `timing:undetermined:${m.id}`, kind: 'timing', judgement: 'undetermined', title: '타이밍 판정 불가', evidence: m.feedInterval.value === null ? '투입 간격 미정' : '동작 시간이 미정인 단계 존재', stepIds: [], objectIds: [m.id], suggestion: '투입 간격/동작 시간 입력', target: { panel: 'material', objectId: m.id }, safety: false, assumptions });
    else if (total > m.feedInterval.value)
      add({ id: `timing:cycle:${m.id}`, kind: 'timing', judgement: 'shortfall', title: `가정 사이클 ${total.toFixed(1)} s > 투입 간격 ${m.feedInterval.value} s`, evidence: `한 자재 순차 사이클 합계 ${total.toFixed(1)} s. 최대 점유 Unit: ${ix.unit.get(topUnit)?.name ?? topUnit} ${topT.toFixed(1)} s. 경량 논리 계산이며 확정 택트·정밀 물리 아님`, stepIds: steps.filter(({ a }) => a!.unitId === topUnit).map(({ s }) => s.id), objectIds: [topUnit, m.id], suggestion: '동작 시간 단축, 투입 간격 조정, 또는 (향후) 병렬/버퍼 변형 검토', target: { panel: 'sequence', objectId: steps[0].s.id }, safety: false, assumptions });
  }
  return gaps;
}

/** Re-analysis bookkeeping: resolved rows collapse (history kept); safety rows never auto-close. */
export function reconcileGapReview(prev: Record<string, GapReviewEntry>, gaps: Gap[], revision: number, safetyIds: Set<string>): Record<string, GapReviewEntry> {
  const next: Record<string, GapReviewEntry> = {};
  const now = new Set(gaps.map((g) => g.id));
  for (const g of gaps) {
    const old = prev[g.id];
    let status: GapReviewEntry['status'] = g.safety ? 'needsHuman' : 'open';
    if (old) {
      if (old.status === 'hidden') status = 'hidden';
      else if (old.status === 'humanConfirmed' && old.lastEvidence === g.evidence) status = 'humanConfirmed';
    }
    next[g.id] = { status, firstSeenRevision: old?.firstSeenRevision ?? revision, lastSeenRevision: revision, lastEvidence: g.evidence };
  }
  for (const [id, old] of Object.entries(prev)) {
    if (now.has(id)) continue;
    if (safetyIds.has(id) || id.startsWith('intf:')) {
      next[id] = { ...old, status: old.status === 'humanConfirmed' ? 'humanConfirmed' : 'needsHuman', lastEvidence: `${old.lastEvidence} — [조건 변경됨: 재분석에서 미검출, 사람 확인 필요]` };
    } else {
      next[id] = { ...old, status: 'resolved', resolvedRevision: old.status === 'resolved' ? old.resolvedRevision : revision };
    }
  }
  return next;
}
