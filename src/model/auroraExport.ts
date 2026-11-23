// TURN-041 — draft Aurora export. This is the app's own JSON shape, not an Aurora Core schema.
// The model → slot table lives in docs/turns/TURN-041.md. A later turn should only change that mapping.
import { getAssetById } from '../assets/library';
import { stableStringify } from '../storage/fileFormat';
import type { Action, Condition, FlowNode, InterlockRule, Project, Quantity, SequenceDraft, SequenceStep } from './types';
import { APP_VERSION } from './types';

export const AURORA_EXPORT_FORMAT = 'aurora-concept-designer/export-draft';
export const AURORA_EXPORT_VERSION = '0.1.0';
/** Shown on the export screen and written in the file header. */
export const AURORA_EXPORT_DRAFT_NOTICE = '초안 형식 — Aurora Core 가 바로 읽는 형식 아님';

/** JSON paths of the draft file. The preview table uses these as the target column. */
export const EXPORT_SLOTS = {
  unit: 'structure.station.units[]',
  device: 'structure.station.units[].devices[]',
  signal: 'signals[]',
  position: 'positions[]',
  sequence: 'sequence',
  step: 'sequence.steps[]',
  flow: 'sequence.flow[]',
  substationSequence: 'substationSequences[]',
  interlock: 'interlocks[]',
  excluded: 'excluded[]',
} as const;

export type ValueStatus = 'confirmed' | 'assumption' | 'undetermined';

export interface ExportQuantity {
  value: number | null;
  unit: string;
  status: ValueStatus;
}

export interface ExportProperty {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  status: ValueStatus;
}

export interface ExportDevice {
  id: string;
  name: string;
  kind: string;
  definitionRef: { assetId: string; version: string };
  properties: ExportProperty[];
}

export interface ExportUnit {
  id: string;
  name: string;
  code: string;
  capacity: { maxMaterials: ExportQuantity; maxWeight: ExportQuantity };
  devices: ExportDevice[];
}

export interface ExportSignal {
  id: string;
  name: string;
  deviceId: string;
  direction: 'in' | 'out';
  role: string;
  address: string | null;
  /** Set when there is no I/O address. */
  conceptual: '개념 신호' | null;
  addressStatus: ValueStatus;
}

export interface ExportPosition {
  id: string;
  name: string;
  deviceId: string;
  value: ExportQuantity;
}

export interface ExportStep {
  id: string;
  name: string;
  order: number;
  actionId: string;
  actionName: string;
  deviceId: string;
  commandSignalId: string | null;
  completeSignalId: string | null;
  duration: ExportQuantity;
  timeout: ExportQuantity;
  conditions: { pre: Condition[]; post: Condition[]; entry: Condition[] };
  effect: Action['effect'] | null;
  targetPositionId: string | null;
}

export type ExportFlowNode =
  | { kind: 'step'; stepId: string }
  | { kind: 'branch'; id: string; name: string; cond: Condition; then: ExportFlowNode[]; else: ExportFlowNode[]; cases?: { cond: Condition; body: ExportFlowNode[] }[] }
  | { kind: 'parallel'; id: string; name: string; lanes: ExportFlowNode[][] }
  | { kind: 'loop'; id: string; name: string; count: number; body: ExportFlowNode[] }
  | { kind: 'retry'; id: string; name: string; until: Condition; maxRetries: number; body: ExportFlowNode[] }
  | { kind: 'substation'; id: string; unitId: string }
  | { kind: 'wait'; id: string; name: string; cond: Condition; timeout: ExportQuantity };

export interface ExportSequence {
  id: string;
  name: string;
  steps: ExportStep[];
  flow: ExportFlowNode[] | null;
  unresolved: string[];
}

export interface ExportSubstationSequence extends ExportSequence {
  unitId: string;
}

export interface ExportInterlock {
  id: string;
  description: string;
  relatedIds: string[];
  confirmation: 'confirmed';
  /** Present when the confirmed Interlock has a machine-readable rule. */
  rule?: InterlockRule;
}

export interface ExportExcluded {
  id: string;
  kind: 'material' | 'interlock' | 'constraint';
  name: string;
  reason: string;
}

export interface AuroraExportFile {
  format: typeof AURORA_EXPORT_FORMAT;
  formatVersion: typeof AURORA_EXPORT_VERSION;
  draft: true;
  draftNotice: typeof AURORA_EXPORT_DRAFT_NOTICE;
  appVersion: string;
  projectId: string;
  projectName: string;
  revision: number;
  structure: { station: { id: string; name: string; units: ExportUnit[] } };
  signals: ExportSignal[];
  positions: ExportPosition[];
  sequence: ExportSequence;
  substationSequences: ExportSubstationSequence[];
  interlocks: ExportInterlock[];
  excluded: ExportExcluded[];
}

export interface ExportFlag {
  status: 'undetermined' | 'assumption';
  id: string;
  place: string;
  label: string;
}

/** null stays null. A missing number is undetermined even when the assumption flag is set. */
export function exportQuantity(q: Quantity): ExportQuantity {
  if (q.value === null || Number.isNaN(q.value)) return { value: null, unit: q.unit, status: 'undetermined' };
  return { value: q.value, unit: q.unit, status: q.assumption ? 'assumption' : 'confirmed' };
}

function exportFlow(nodes: FlowNode[]): ExportFlowNode[] {
  return nodes.map((n) => {
    if (n.kind === 'step') return { kind: 'step', stepId: n.stepId };
    if (n.kind === 'branch') {
      const then = exportFlow(n.then);
      const elseArm = exportFlow(n.else);
      if (!n.cases?.length) return { kind: 'branch', id: n.id, name: n.name, cond: structuredClone(n.cond), then, else: elseArm };
      return {
        kind: 'branch', id: n.id, name: n.name, cond: structuredClone(n.cond), then, else: elseArm,
        cases: n.cases.map((c) => ({ cond: structuredClone(c.cond), body: exportFlow(c.body) })),
      };
    }
    if (n.kind === 'parallel') return { kind: 'parallel', id: n.id, name: n.name, lanes: n.lanes.map(exportFlow) };
    if (n.kind === 'loop') return { kind: 'loop', id: n.id, name: n.name, count: n.count, body: exportFlow(n.body) };
    if (n.kind === 'retry') return { kind: 'retry', id: n.id, name: n.name, until: structuredClone(n.until), maxRetries: n.maxRetries, body: exportFlow(n.body) };
    if (n.kind === 'wait') return { kind: 'wait', id: n.id, name: n.name, cond: structuredClone(n.cond), timeout: exportQuantity(n.timeout) };
    return { kind: 'substation', id: n.id, unitId: n.unitId };
  });
}

function exportStep(p: Project, step: SequenceStep, order: number): ExportStep {
  const action = p.actions.find((a) => a.id === step.actionId);
  const timeout = step.timeoutOverride ?? action?.timeout ?? { value: null, unit: 's', assumption: true };
  return {
    id: step.id,
    name: step.name,
    order,
    actionId: step.actionId,
    actionName: action?.name ?? '',
    deviceId: action?.deviceId ?? '',
    commandSignalId: action?.commandSignalId ?? null,
    completeSignalId: action?.completeSignalId ?? null,
    duration: action ? exportQuantity(action.duration) : { value: null, unit: 's', status: 'undetermined' },
    timeout: exportQuantity(timeout),
    conditions: {
      pre: structuredClone(action?.pre ?? []),
      post: structuredClone(action?.post ?? []),
      entry: structuredClone(step.entry),
    },
    effect: action ? structuredClone(action.effect) : null,
    targetPositionId: action?.targetPositionId ?? null,
  };
}

function exportSequence(p: Project, seq: SequenceDraft): ExportSequence {
  return {
    id: seq.id,
    name: seq.name,
    steps: seq.steps.map((s, i) => exportStep(p, s, i)),
    flow: seq.flow ? exportFlow(seq.flow) : null,
    unresolved: [...seq.unresolved],
  };
}

function exportDevice(p: Project, id: string): ExportDevice | null {
  const d = p.devices.find((x) => x.id === id);
  if (!d) return null;
  const def = getAssetById(d.definitionRef.assetId);
  const properties = Object.keys(d.properties).sort().map((key) => {
    const q = exportQuantity(d.properties[key]);
    return { key, label: def?.properties.find((pd) => pd.key === key)?.label ?? key, ...q };
  });
  return {
    id: d.id,
    name: d.name,
    kind: d.kind,
    definitionRef: { assetId: d.definitionRef.assetId, version: d.definitionRef.version },
    properties,
  };
}

export function buildAuroraExport(p: Project): AuroraExportFile {
  const unitById = new Map(p.units.map((u) => [u.id, u]));
  const seen = new Set<string>();
  const units: ExportUnit[] = [];
  const pushUnit = (id: string) => {
    const u = unitById.get(id);
    if (!u || seen.has(u.id)) return;
    seen.add(u.id);
    const deviceIds = [...u.deviceIds];
    for (const d of p.devices) if (d.unitId === u.id && !deviceIds.includes(d.id)) deviceIds.push(d.id);
    units.push({
      id: u.id,
      name: u.name,
      code: u.code,
      capacity: { maxMaterials: exportQuantity(u.capacity.maxMaterials), maxWeight: exportQuantity(u.capacity.maxWeight) },
      devices: deviceIds.map((id) => exportDevice(p, id)).filter((d): d is ExportDevice => d !== null),
    });
  };
  for (const id of p.equipment.unitIds) pushUnit(id);
  for (const u of p.units) pushUnit(u.id);

  const signals: ExportSignal[] = p.signals.map((s) => {
    const conceptual = s.address ? null : '개념 신호' as const;
    const addressStatus: ValueStatus = !s.address || s.addressStatus === 'unassigned' ? 'undetermined' : s.addressStatus === 'confirmed' ? 'confirmed' : 'assumption';
    return { id: s.id, name: s.name, deviceId: s.deviceId, direction: s.direction, role: s.role, address: s.address, conceptual, addressStatus };
  });

  const positions: ExportPosition[] = p.positions.map((ps) => ({ id: ps.id, name: ps.name, deviceId: ps.deviceId, value: exportQuantity(ps.value) }));

  const interlocks: ExportInterlock[] = [];
  const excluded: ExportExcluded[] = [];
  for (const k of p.constraints) {
    if (k.kind === 'interlock-candidate' && k.confirmation === 'confirmed') {
      interlocks.push({
        id: k.id, description: k.description, relatedIds: [...k.relatedIds], confirmation: 'confirmed',
        ...(k.rule ? { rule: structuredClone(k.rule) } : {}),
      });
    } else if (k.kind === 'interlock-candidate') {
      excluded.push({ id: k.id, kind: 'interlock', name: k.description, reason: `확인되지 않은 Interlock (${k.confirmation}) — 확인된 것만 본문에 넣음` });
    } else {
      excluded.push({ id: k.id, kind: 'constraint', name: k.description, reason: `Interlock이 아닌 제약 (${k.kind}) — 초안 형식의 Interlock 자리가 아님` });
    }
  }
  for (const m of p.materials) {
    excluded.push({ id: m.id, kind: 'material', name: m.name, reason: '대상 자리 없음 — 자재는 원본 모델에 유지하고 Export 본문에 넣지 않음' });
  }

  return {
    format: AURORA_EXPORT_FORMAT,
    formatVersion: AURORA_EXPORT_VERSION,
    draft: true,
    draftNotice: AURORA_EXPORT_DRAFT_NOTICE,
    appVersion: APP_VERSION,
    projectId: p.id,
    projectName: p.name,
    revision: p.revision,
    structure: { station: { id: p.equipment.id, name: p.equipment.name, units } },
    signals,
    positions,
    sequence: exportSequence(p, p.sequence),
    substationSequences: (p.substationSequences ?? []).map((q) => ({ ...exportSequence(p, q), unitId: q.unitId })),
    interlocks,
    excluded,
  };
}

export function serializeAuroraExport(file: AuroraExportFile): string {
  return stableStringify(file);
}

export function auroraExportFileName(projectName: string): string {
  const base = projectName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim() || 'export';
  return `${base}.aurora-export.json`;
}

export type ParseExportResult = { ok: true; file: AuroraExportFile } | { ok: false; reason: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function parseAuroraExport(raw: string): ParseExportResult {
  let data: unknown;
  try { data = JSON.parse(raw); } catch (e) { return { ok: false, reason: `JSON 파싱 실패: ${(e as Error).message}` }; }
  if (!isRecord(data)) return { ok: false, reason: '객체가 아닙니다. Export 초안 형식의 JSON 객체가 필요합니다' };
  if (data.format !== AURORA_EXPORT_FORMAT) {
    const shown = typeof data.format === 'string' && data.format ? data.format : '(형식 이름 없음)';
    return { ok: false, reason: `형식이 다릅니다: ${shown}. 초안 형식 ${AURORA_EXPORT_FORMAT} 이 아닙니다` };
  }
  if (data.formatVersion !== AURORA_EXPORT_VERSION) return { ok: false, reason: `지원하지 않는 초안 형식 버전 ${String(data.formatVersion)} (이 앱은 ${AURORA_EXPORT_VERSION})` };
  if (data.draft !== true || data.draftNotice !== AURORA_EXPORT_DRAFT_NOTICE) return { ok: false, reason: `초안 표시가 없습니다. 파일 머리에 「${AURORA_EXPORT_DRAFT_NOTICE}」가 있어야 합니다` };
  const structure = data.structure;
  if (!isRecord(structure) || !isRecord(structure.station) || !Array.isArray(structure.station.units)) return { ok: false, reason: '장비 구조(structure.station.units)가 없습니다' };
  if (!Array.isArray(data.signals)) return { ok: false, reason: '신호 목록이 없습니다' };
  if (!Array.isArray(data.positions)) return { ok: false, reason: '포지션 목록이 없습니다' };
  if (!isRecord(data.sequence) || !Array.isArray(data.sequence.steps)) return { ok: false, reason: 'Station 시퀀스가 없습니다' };
  if (!Array.isArray(data.substationSequences)) return { ok: false, reason: 'Substation 시퀀스 목록이 없습니다' };
  if (!Array.isArray(data.interlocks)) return { ok: false, reason: 'Interlock 목록이 없습니다' };
  if (!Array.isArray(data.excluded)) return { ok: false, reason: '제외 목록이 없습니다' };
  return { ok: true, file: data as unknown as AuroraExportFile };
}

function qtyText(q: ExportQuantity | undefined): string {
  if (!q) return '';
  return `${q.value === null ? 'null' : String(q.value)} ${q.unit} ${q.status}`;
}

interface Row { kind: string; id: string; name: string; fields: Record<string, string> }

function childKeys(list: ExportFlowNode[] | undefined): string {
  return (list ?? []).map((n) => n.kind === 'step' ? `step:${n.stepId}` : `${n.kind}:${n.id}`).join('|');
}

function flowFields(n: ExportFlowNode): Record<string, string> | null {
  if (n.kind === 'step') return null;
  if (n.kind === 'branch') {
    const fields: Record<string, string> = { 이름: n.name, 조건: stableStringify(n.cond, 0), 참: childKeys(n.then), 거짓: childKeys(n.else) };
    if (n.cases?.length) fields['사이'] = n.cases.map((c) => `${stableStringify(c.cond, 0)}:${childKeys(c.body)}`).join(' || ');
    return fields;
  }
  if (n.kind === 'parallel') return { 이름: n.name, 갈래: n.lanes.map((lane) => childKeys(lane)).join(' || ') };
  if (n.kind === 'loop') return { 이름: n.name, 횟수: String(n.count), 본문: childKeys(n.body) };
  if (n.kind === 'retry') return { 이름: n.name, 조건: stableStringify(n.until, 0), 최대: String(n.maxRetries), 본문: childKeys(n.body) };
  if (n.kind === 'wait') return { 이름: n.name, 조건: stableStringify(n.cond, 0), 타임아웃: qtyText(n.timeout) };
  return { 유닛: n.unitId };
}

function flowName(n: ExportFlowNode): string {
  if (n.kind === 'step') return n.stepId;
  if (n.kind === 'substation') return n.unitId;
  return n.name;
}

function addFlowRows(rows: Row[], nodes: ExportFlowNode[] | null | undefined) {
  const rec = (list: ExportFlowNode[] | undefined) => {
    for (const n of list ?? []) {
      const fields = flowFields(n);
      if (fields && n.kind !== 'step') rows.push({ kind: 'flow', id: n.id, name: flowName(n), fields });
      if (n.kind === 'branch') { rec(n.then); for (const c of n.cases ?? []) rec(c.body); rec(n.else); }
      else if (n.kind === 'parallel') n.lanes.forEach(rec);
      else if (n.kind === 'loop' || n.kind === 'retry') rec(n.body);
    }
  };
  rec(nodes ?? undefined);
}

function stepRow(kind: 'step' | 'substationStep', s: ExportStep): Row {
  return {
    kind, id: s.id, name: s.name,
    fields: {
      이름: s.name,
      순서: String(s.order),
      Action: s.actionId,
      동작: s.actionName,
      장치: s.deviceId,
      명령: s.commandSignalId ?? '',
      완료: s.completeSignalId ?? '',
      '동작 시간': qtyText(s.duration),
      타임아웃: qtyText(s.timeout),
      조건: stableStringify(s.conditions, 0),
      효과: stableStringify(s.effect, 0),
      목표: s.targetPositionId ?? '',
    },
  };
}

function rowsOf(file: AuroraExportFile): Row[] {
  const rows: Row[] = [];
  const station = file.structure?.station;
  rows.push({
    kind: 'sequence', id: file.sequence?.id ?? '', name: file.sequence?.name ?? '',
    fields: {
      이름: file.sequence?.name ?? '',
      흐름: childKeys(file.sequence?.flow ?? undefined),
      미정: stableStringify(file.sequence?.unresolved ?? [], 0),
    },
  });
  for (const u of station?.units ?? []) {
    rows.push({
      kind: 'unit', id: u.id, name: u.name,
      fields: {
        이름: u.name,
        코드: u.code,
        '수용 개수': qtyText(u.capacity?.maxMaterials),
        '허용 무게': qtyText(u.capacity?.maxWeight),
        장치: (u.devices ?? []).map((d) => d.id).join('|'),
      },
    });
    (u.devices ?? []).forEach((d, i) => rows.push({
      kind: 'device', id: d.id, name: d.name,
      fields: {
        이름: d.name,
        순서: String(i),
        종류: d.kind,
        정의: `${d.definitionRef?.assetId ?? ''}@${d.definitionRef?.version ?? ''}`,
        속성: stableStringify(d.properties ?? [], 0),
      },
    }));
  }
  for (const s of file.signals ?? []) {
    rows.push({
      kind: 'signal', id: s.id, name: s.name,
      fields: {
        이름: s.name, 장치: s.deviceId, 방향: s.direction, 역할: s.role,
        주소: s.address ?? '', 개념: s.conceptual ?? '', '주소 상태': s.addressStatus,
      },
    });
  }
  for (const ps of file.positions ?? []) {
    rows.push({ kind: 'position', id: ps.id, name: ps.name, fields: { 이름: ps.name, 장치: ps.deviceId, 값: qtyText(ps.value) } });
  }
  for (const s of file.sequence?.steps ?? []) rows.push(stepRow('step', s));
  addFlowRows(rows, file.sequence?.flow);
  for (const q of file.substationSequences ?? []) {
    rows.push({
      kind: 'substationSequence', id: q.id, name: q.name,
      fields: { 이름: q.name, 유닛: q.unitId, 단계: (q.steps ?? []).map((s) => s.id).join('|'), 흐름: childKeys(q.flow ?? undefined) },
    });
    for (const s of q.steps ?? []) rows.push(stepRow('substationStep', s));
    addFlowRows(rows, q.flow);
  }
  for (const k of file.interlocks ?? []) {
    rows.push({
      kind: 'interlock', id: k.id, name: k.description,
      fields: { 설명: k.description, 관련: (k.relatedIds ?? []).join('|'), 규칙: k.rule ? stableStringify(k.rule, 0) : '' },
    });
  }
  for (const x of file.excluded ?? []) {
    rows.push({ kind: 'excluded', id: x.id, name: x.name, fields: { 종류: x.kind, 이름: x.name, 까닭: x.reason } });
  }
  return rows;
}

export const EXPORT_KIND_LABEL: Record<string, string> = {
  unit: 'Unit',
  device: 'Device',
  signal: '신호',
  position: '포지션',
  step: 'Station 단계',
  flow: '흐름 블록',
  sequence: 'Station 시퀀스',
  substationSequence: 'Substation 시퀀스',
  substationStep: 'Substation 단계',
  interlock: 'Interlock',
  excluded: '제외',
};

const KIND_ORDER = Object.keys(EXPORT_KIND_LABEL);

export type ExportChange = 'added' | 'removed' | 'changed';

export interface ExportDiff {
  change: ExportChange;
  kind: string;
  kindLabel: string;
  id: string;
  name: string;
  field: string;
  fileValue: string;
  modelValue: string;
}

export interface ExportCount { kind: string; label: string; model: number; file: number }

export interface RoundTripReport {
  /** In the model, absent from the file. Summary calls these 빠진 것; the list calls them 추가. */
  missing: ExportDiff[];
  /** In the file, absent from the model. The list calls these 삭제. */
  removed: ExportDiff[];
  changed: ExportDiff[];
  counts: ExportCount[];
}

function indexRows(rows: Row[]): Map<string, Row> {
  const map = new Map<string, Row>();
  for (const row of rows) map.set(`${row.kind}\0${row.id}`, row);
  return map;
}

export function compareAuroraExport(model: AuroraExportFile, file: AuroraExportFile): RoundTripReport {
  const modelRows = indexRows(rowsOf(model));
  const fileRows = indexRows(rowsOf(file));
  const missing: ExportDiff[] = [];
  const removed: ExportDiff[] = [];
  const changed: ExportDiff[] = [];
  const base = (row: Row, change: ExportChange): Omit<ExportDiff, 'field' | 'fileValue' | 'modelValue'> => ({
    change, kind: row.kind, kindLabel: EXPORT_KIND_LABEL[row.kind] ?? row.kind, id: row.id, name: row.name,
  });
  for (const [key, modelRow] of modelRows) {
    const fileRow = fileRows.get(key);
    if (!fileRow) {
      missing.push({ ...base(modelRow, 'added'), field: '', fileValue: '', modelValue: modelRow.name });
      continue;
    }
    const fields = [...new Set([...Object.keys(modelRow.fields), ...Object.keys(fileRow.fields)])].sort();
    for (const field of fields) {
      const modelValue = modelRow.fields[field] ?? '';
      const fileValue = fileRow.fields[field] ?? '';
      if (modelValue !== fileValue) changed.push({ ...base(modelRow, 'changed'), name: modelRow.name || fileRow.name, field, fileValue, modelValue });
    }
  }
  for (const [key, fileRow] of fileRows) {
    if (!modelRows.has(key)) removed.push({ ...base(fileRow, 'removed'), field: '', fileValue: fileRow.name, modelValue: '' });
  }
  const counts = KIND_ORDER.map((kind) => ({
    kind,
    label: EXPORT_KIND_LABEL[kind],
    model: [...modelRows.values()].filter((r) => r.kind === kind).length,
    file: [...fileRows.values()].filter((r) => r.kind === kind).length,
  }));
  const byId = (a: ExportDiff, b: ExportDiff) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id) || a.field.localeCompare(b.field);
  missing.sort(byId); removed.sort(byId); changed.sort(byId);
  return { missing, removed, changed, counts };
}

function pushQty(out: ExportFlag[], q: ExportQuantity | undefined, id: string, place: string, label: string) {
  if (!q || q.status === 'confirmed') return;
  out.push({ status: q.status, id, place, label: `${label} · ${q.value === null ? '미정' : q.value} ${q.unit}` });
}

/** Undetermined and assumption values that the draft file keeps visible. */
export function collectExportFlags(file: AuroraExportFile): { undetermined: ExportFlag[]; assumption: ExportFlag[] } {
  const out: ExportFlag[] = [];
  for (const u of file.structure.station.units) {
    pushQty(out, u.capacity.maxMaterials, u.id, EXPORT_SLOTS.unit, `${u.name} · 수용 개수`);
    pushQty(out, u.capacity.maxWeight, u.id, EXPORT_SLOTS.unit, `${u.name} · 허용 무게`);
    for (const d of u.devices) for (const prop of d.properties) pushQty(out, prop, d.id, `${EXPORT_SLOTS.device}.${prop.key}`, `${d.name} · ${prop.label}`);
  }
  for (const s of file.signals) {
    if (s.addressStatus === 'confirmed') continue;
    out.push({
      status: s.addressStatus === 'assumption' ? 'assumption' : 'undetermined',
      id: s.id,
      place: EXPORT_SLOTS.signal,
      label: s.conceptual ? `${s.name} · 개념 신호` : `${s.name} · 주소 ${s.address} · ${s.addressStatus}`,
    });
  }
  for (const ps of file.positions) pushQty(out, ps.value, ps.id, EXPORT_SLOTS.position, `${ps.name} · 값`);
  const stepsOf = (seq: ExportSequence, place: string) => {
    for (const s of seq.steps) {
      pushQty(out, s.duration, s.id, place, `${s.name} · 동작 시간`);
      pushQty(out, s.timeout, s.id, place, `${s.name} · 타임아웃`);
    }
  };
  stepsOf(file.sequence, EXPORT_SLOTS.step);
  for (const q of file.substationSequences) stepsOf(q, EXPORT_SLOTS.substationSequence);
  return {
    undetermined: out.filter((f) => f.status === 'undetermined'),
    assumption: out.filter((f) => f.status === 'assumption'),
  };
}
