import { getAssetById } from '../assets/library';
import type { Condition, Project } from './types';

export interface Diagnostic {
  id: string;
  severity: 'error' | 'warning';
  code: string;
  objectId: string;
  message: string;
}

export interface Index {
  unit: Map<string, Project['units'][number]>;
  device: Map<string, Project['devices'][number]>;
  signal: Map<string, Project['signals'][number]>;
  position: Map<string, Project['positions'][number]>;
  action: Map<string, Project['actions'][number]>;
  material: Map<string, Project['materials'][number]>;
}

export function indexProject(p: Project): Index {
  return {
    unit: new Map(p.units.map((x) => [x.id, x])),
    device: new Map(p.devices.map((x) => [x.id, x])),
    signal: new Map(p.signals.map((x) => [x.id, x])),
    position: new Map(p.positions.map((x) => [x.id, x])),
    action: new Map(p.actions.map((x) => [x.id, x])),
    material: new Map(p.materials.map((x) => [x.id, x])),
  };
}

function condRefs(c: Condition, ix: Index, owner: string, out: Diagnostic[], ctx: string) {
  const push = (code: string, msg: string) => out.push({ id: `${code}:${owner}:${out.length}`, severity: 'error', code, objectId: owner, message: `${ctx}: ${msg}` });
  if (c.kind === 'signal' && !ix.signal.has(c.signalId)) push('REF_MISSING_SIGNAL', `없는 Signal 참조 ${c.signalId}`);
  if (c.kind === 'materialAt' && !ix.unit.has(c.unitId)) push('REF_MISSING_UNIT', `없는 Unit 참조 ${c.unitId}`);
  if (c.kind === 'materialHeldBy' && c.deviceId !== null && !ix.device.has(c.deviceId)) push('REF_MISSING_DEVICE', `없는 Device 참조 ${c.deviceId}`);
}

/** Reference integrity (D04). Never fills missing references with placeholder objects. */
export function validateProject(p: Project): Diagnostic[] {
  const out: Diagnostic[] = [];
  const err = (code: string, objectId: string, message: string, severity: Diagnostic['severity'] = 'error') =>
    out.push({ id: `${code}:${objectId}:${out.length}`, severity, code, objectId, message });

  // shape
  const arrays = ['units', 'devices', 'signals', 'positions', 'actions', 'materials', 'connections', 'constraints', 'candidates'] as const;
  for (const k of arrays) if (!Array.isArray((p as any)[k])) { err('SHAPE', k, `${k} 목록이 없음`); }
  if (!p.sequence || !Array.isArray(p.sequence.steps)) err('SHAPE', 'sequence', 'sequence.steps 없음');
  if (!p.equipment || !Array.isArray(p.equipment.unitIds)) err('SHAPE', 'equipment', 'equipment.unitIds 없음');
  if (p.substationSequences !== undefined && (!Array.isArray(p.substationSequences) || p.substationSequences.some((q) => !q || !Array.isArray(q.steps)))) err('SHAPE', 'substationSequences', 'substationSequences 형식 오류');
  if (out.length) return out;

  // duplicate ids across all collections
  const seen = new Map<string, string>();
  const all: [string, { id: string }[]][] = [['unit', p.units], ['device', p.devices], ['signal', p.signals], ['position', p.positions],
    ['action', p.actions], ['material', p.materials], ['connection', p.connections], ['constraint', p.constraints], ['step', p.sequence.steps], ['candidate', p.candidates],
    ['substationSequence', p.substationSequences ?? []], ['step', (p.substationSequences ?? []).flatMap((q) => q.steps)]];
  for (const [kind, list] of all) for (const o of list) {
    if (typeof o.id !== 'string' || !o.id) { err('ID_INVALID', kind, `${kind} ID 누락`); continue; }
    if (seen.has(o.id)) err('ID_DUPLICATE', o.id, `ID 중복: ${o.id} (${seen.get(o.id)}, ${kind})`);
    else seen.set(o.id, kind);
  }
  const ix = indexProject(p);

  for (const uid of p.equipment.unitIds) if (!ix.unit.has(uid)) err('REF_MISSING_UNIT', uid, `Equipment가 없는 Unit ${uid} 참조`);
  const owned = new Map<string, string>();
  for (const u of p.units) {
    if (!p.equipment.unitIds.includes(u.id)) err('ORPHAN_UNIT', u.id, `Unit ${u.name}이 Equipment에 소속되지 않음`);
    for (const d of u.deviceIds) {
      if (!ix.device.has(d)) err('REF_MISSING_DEVICE', u.id, `Unit ${u.name}이 없는 Device ${d} 참조`);
      if (owned.has(d)) err('DUP_OWNERSHIP', d, `Device ${d}가 여러 Unit에 소속`);
      owned.set(d, u.id);
    }
  }
  for (const d of p.devices) {
    if (!ix.unit.has(d.unitId)) err('REF_MISSING_UNIT', d.id, `Device ${d.name}의 소속 Unit ${d.unitId} 없음`);
    else if (owned.get(d.id) !== d.unitId) err('OWNERSHIP_MISMATCH', d.id, `Device ${d.name} 소속 불일치`);
    if (!getAssetById(d.definitionRef.assetId)) err('ASSET_UNKNOWN', d.id, `알 수 없는 에셋 정의 ${d.definitionRef.assetId}`);
  }
  for (const s of p.signals) if (!ix.device.has(s.deviceId)) err('REF_MISSING_DEVICE', s.id, `Signal ${s.name}의 Device ${s.deviceId} 없음`);
  for (const ps of p.positions) if (!ix.device.has(ps.deviceId)) err('REF_MISSING_DEVICE', ps.id, `Position ${ps.name}의 Device ${ps.deviceId} 없음`);
  for (const a of p.actions) {
    if (!ix.unit.has(a.unitId)) err('REF_MISSING_UNIT', a.id, `Action ${a.name}의 Unit ${a.unitId} 없음`);
    if (!ix.device.has(a.deviceId)) err('REF_MISSING_DEVICE', a.id, `Action ${a.name}의 Device ${a.deviceId} 없음`);
    if (a.commandSignalId && !ix.signal.has(a.commandSignalId)) err('REF_MISSING_SIGNAL', a.id, `Action ${a.name}의 명령 Signal ${a.commandSignalId} 없음`);
    if (a.completeSignalId && !ix.signal.has(a.completeSignalId)) err('REF_MISSING_SIGNAL', a.id, `Action ${a.name}의 완료 Signal ${a.completeSignalId} 없음`);
    if (a.targetPositionId && !ix.position.has(a.targetPositionId)) err('REF_MISSING_POSITION', a.id, `Action ${a.name}의 Position ${a.targetPositionId} 없음`);
    a.pre.forEach((c) => condRefs(c, ix, a.id, out, `Action ${a.name} pre`));
    a.post.forEach((c) => condRefs(c, ix, a.id, out, `Action ${a.name} post`));
    if (a.effect.moveTo && a.effect.moveTo !== 'EXIT' && !ix.unit.has(a.effect.moveTo)) err('REF_MISSING_UNIT', a.id, `Action ${a.name}의 이동 대상 Unit ${a.effect.moveTo} 없음`);
    if (a.effect.holder && !ix.device.has(a.effect.holder)) err('REF_MISSING_DEVICE', a.id, `Action ${a.name}의 holder ${a.effect.holder} 없음`);
  }
  for (const s of p.sequence.steps) {
    if (!ix.action.has(s.actionId)) err('REF_MISSING_ACTION', s.id, `단계 ${s.name}의 Action ${s.actionId} 없음`);
    s.entry.forEach((c) => condRefs(c, ix, s.id, out, `단계 ${s.name} 진입조건`));
  }
  for (const q of p.substationSequences ?? []) {
    if (!ix.unit.has(q.unitId)) err('REF_MISSING_UNIT', q.id, `Substation 시퀀스 ${q.name}의 Substation(Unit) ${q.unitId} 없음`);
    for (const s of q.steps) {
      if (!ix.action.has(s.actionId)) err('REF_MISSING_ACTION', s.id, `[${q.name}] 단계 ${s.name}의 Action ${s.actionId} 없음`);
      s.entry.forEach((c) => condRefs(c, ix, s.id, out, `[${q.name}] 단계 ${s.name} 진입조건`));
    }
  }
  for (const m of p.materials) {
    if (m.initialLocation && !ix.unit.has(m.initialLocation)) err('REF_MISSING_UNIT', m.id, `자재 ${m.name}의 초기 위치 ${m.initialLocation} 없음`);
    m.route.forEach((r) => { if (!ix.unit.has(r)) err('REF_MISSING_UNIT', m.id, `자재 ${m.name} 경로의 Unit ${r} 없음`); });
    if (m.initialState && !m.states.includes(m.initialState)) err('STATE_UNKNOWN', m.id, `초기 상태 ${m.initialState}가 상태집합에 없음`);
  }
  for (const c of p.connections) {
    const nodeOk = (id: string) => ix.unit.has(id) || ix.device.has(id);
    if (!nodeOk(c.from.nodeId) || !nodeOk(c.to.nodeId)) err('REF_MISSING_NODE', c.id, `연결 ${c.id}의 끝점 노드 없음`);
    if (c.kind === 'signal') {
      if (!c.from.signalId || !ix.signal.has(c.from.signalId) || !c.to.signalId || !ix.signal.has(c.to.signalId)) err('REF_MISSING_SIGNAL', c.id, `신호 연결 ${c.id}의 Signal 없음`);
    }
  }
  for (const k of p.constraints) for (const r of k.relatedIds) if (!seen.has(r)) err('REF_MISSING', k.id, `제약 ${k.id}의 관련 객체 ${r} 없음`, 'warning');
  return out;
}

export interface Readiness { ok: boolean; blockers: Diagnostic[]; warnings: Diagnostic[] }

/** 실행 준비 검사: 미정 필수 조건을 임의로 채우지 않고 실행을 차단한다. */
export function checkRunReadiness(p: Project): Readiness {
  const diags = validateProject(p);
  const blockers = diags.filter((d) => d.severity === 'error');
  const warnings = diags.filter((d) => d.severity === 'warning');
  const b = (code: string, objectId: string, message: string) => blockers.push({ id: `${code}:${objectId}:${blockers.length}`, severity: 'error', code, objectId, message });
  if (blockers.length) return { ok: false, blockers, warnings };
  const ix = indexProject(p);
  if (p.sequence.steps.length === 0) b('NO_STEPS', p.sequence.id, '시퀀스 단계가 없음');
  if (p.materials.length !== 1) b('MATERIAL_COUNT', 'materials', `이번 시제품 실행은 자재 정의 1개만 지원 (현재 ${p.materials.length}개)`);
  const m = p.materials[0];
  if (m) {
    if (!m.initialLocation) b('MAT_NO_LOCATION', m.id, '자재 초기 위치 미정');
    if (!m.initialState) b('MAT_NO_STATE', m.id, '자재 초기 상태 미정');
  }
  for (const s of p.sequence.steps) {
    const a = ix.action.get(s.actionId)!;
    if (!a.completeSignalId) b('NO_COMPLETE_SIGNAL', s.id, `단계 ${s.name}: 완료 Signal 미정 — 완료 판정 불가`);
    if (a.duration.value === null) b('DURATION_UNDEFINED', s.id, `단계 ${s.name}: 동작 시간 미정`);
    const t = s.timeoutOverride ?? a.timeout;
    if (t.value === null) b('TIMEOUT_UNDEFINED', s.id, `단계 ${s.name}: 타임아웃 미정`);
    for (const c of [...a.pre, ...a.post, ...s.entry]) if (c.kind === 'undefined') b('CONDITION_UNDEFINED', s.id, `단계 ${s.name}: 미정 조건 "${c.note}" — 임의 true 처리 안 함`);
    const mv = a.effect.moveTo;
    if (mv && mv !== 'EXIT') {
      const u = ix.unit.get(mv)!;
      if (u.capacity.maxMaterials.value === null) b('CAPACITY_UNDEFINED', s.id, `단계 ${s.name}: 이동 대상 ${u.name} 수용 개수 미정`);
    }
    if (a.effect.setState && m && !m.states.includes(a.effect.setState)) b('STATE_UNKNOWN', s.id, `단계 ${s.name}: 상태 ${a.effect.setState}가 자재 상태집합에 없음`);
  }
  return { ok: blockers.length === 0, blockers, warnings };
}
