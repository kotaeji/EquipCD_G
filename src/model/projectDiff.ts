// TURN-081. Diff two projects by id. Pure: neither project is mutated.
import { addressWord, confirmationWord, gapStatusWord, targetKey } from './confirmationLog';
import { armLabel, branchArms, walk } from './flow';
import type {
  Condition, ConfirmationEntry, Connection, Device, DiagramBackground, FlowNode, MaterialEffect, Project,
  Quantity, RunScenario, ScenarioInjection, SequenceDraft, Unit,
} from './types';
import { feedCountOf } from './types';

export const DIFF_KINDS = [
  'project', 'equipment', 'unit', 'device', 'signal', 'position', 'action', 'connection', 'material',
  'sequence', 'step', 'flow', 'interlock', 'constraint', 'candidate', 'background', 'lock',
  'sim', 'gap', 'confirmation', 'scenario',
] as const;

export type DiffKind = (typeof DIFF_KINDS)[number];

export const DIFF_KIND_LABEL: Record<DiffKind, string> = {
  project: '프로젝트',
  equipment: '장비',
  unit: 'Unit',
  device: 'Device',
  signal: '신호',
  position: '포지션',
  action: 'Action',
  connection: '연결',
  material: '자재',
  sequence: '시퀀스',
  step: '시퀀스 단계',
  flow: '흐름 블록',
  interlock: 'Interlock',
  constraint: '제약',
  candidate: '후보',
  background: '배경',
  lock: '잠금',
  sim: '시뮬',
  gap: 'Gap',
  confirmation: '확인 이력',
  scenario: '실행 시나리오',
};

export type DiffChange = 'added' | 'removed' | 'changed';

export interface DiffRow {
  change: DiffChange;
  kind: DiffKind;
  id: string;
  name: string;
  /** Empty when the whole object was added or removed. */
  field: string;
  before: string;
  after: string;
  /**
   * Set on a sequence or block order line (TURN-087).
   * The screen shows this instead of two id lists. `after` is the same text.
   */
  orderText?: string;
}

export interface ProjectDiff {
  rows: DiffRow[];
  added: number;
  removed: number;
  changed: number;
}

export interface DiffGroup {
  kind: DiffKind;
  label: string;
  rows: DiffRow[];
}

export const EMPTY_PROJECT_DIFF: ProjectDiff = { rows: [], added: 0, removed: 0, changed: 0 };

export const SAME_AS_SAVED = '저장본과 같습니다';

const KIND_INDEX = new Map(DIFF_KINDS.map((kind, index) => [kind, index]));
const CHANGE_INDEX: Record<DiffChange, number> = { added: 0, removed: 1, changed: 2 };

const ACTION_KIND: Record<string, string> = {
  extend: '전진', retract: '후진', read: '읽기', work: '작업', pick: '잡기', move: '이동',
  place: '놓기', convey: '이송', raise: '상승', lower: '하강', detect: '감지',
};

const SOURCE: Record<string, string> = {
  'direct-input': '직접', 'asset-default': '에셋', 'sample-example': '예제', import: '가져오기', 'unit-template': '템플릿',
};

function cmp(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function list(ids: readonly string[]): string {
  return ids.length ? ids.join(' · ') : '없음';
}

function qtyText(q: Quantity | null | undefined): string {
  if (!q) return '없음';
  const value = q.value === null ? '미정' : `${q.value} ${q.unit}`;
  const flag = q.assumption ? '가정' : '확인';
  const method = q.source ? (SOURCE[q.source.method] ?? q.source.method) : '';
  return method ? `${value} · ${flag} · ${method}` : `${value} · ${flag}`;
}

function qtyMap(rec: Record<string, Quantity> | undefined): string {
  if (!rec) return '없음';
  const keys = Object.keys(rec).sort(cmp);
  if (!keys.length) return '없음';
  return keys.map((key) => `${key} ${qtyText(rec[key])}`).join(' · ');
}

function condText(c: Condition): string {
  switch (c.kind) {
    case 'signal': return `신호 ${c.signalId} ${c.equals ? '켜짐' : '꺼짐'}`;
    case 'materialAt': return `자재 위치 ${c.unitId}`;
    case 'materialState': return `자재 상태 ${c.state}`;
    case 'materialHeldBy': return `자재 보유 ${c.deviceId ?? '없음'}`;
    case 'materialType': return `자재 종류 ${c.materialId}`;
    case 'undefined': return `미정 ${c.note}`;
  }
}

function condsText(listIn: readonly Condition[]): string {
  return listIn.length ? listIn.map(condText).join(' · ') : '없음';
}

function effectText(e: MaterialEffect | undefined): string {
  if (!e) return '없음';
  const parts: string[] = [];
  if (e.moveTo !== undefined) parts.push(`이동 ${e.moveTo}`);
  if (e.setState !== undefined) parts.push(`상태 ${e.setState}`);
  if (e.holder !== undefined) parts.push(`보유 ${e.holder ?? '놓음'}`);
  return parts.length ? parts.join(' · ') : '없음';
}

/** How many 더함 · 뺌 · 옮김 phrases one order line shows before 「그 밖 N개」. */
export const ORDER_CHANGE_LIMIT = 6;

export interface OrderEntry {
  id: string;
  name: string;
}

const BLOCK_WORD: Record<'branch' | 'parallel' | 'loop' | 'retry' | 'wait', string> = {
  branch: '분기', parallel: '병렬', loop: '반복', retry: '재시도', wait: '신호 기다림',
};

/** The name on the flow table: the kind word, or the name typed into the block. */
function blockVisibleName(kind: keyof typeof BLOCK_WORD, name: string): string {
  const word = BLOCK_WORD[kind];
  const trimmed = name.trim();
  if (!trimmed || trimmed === word) return word;
  return trimmed;
}

function ordinal(index: number): string {
  return `${index}번째`;
}

/**
 * Ids kept by one deterministic LCS.
 * A tie skips the earlier before-item, so the same two lists always pick the same kept ids.
 */
function lcsKept(before: readonly string[], after: readonly string[]): Set<string> {
  const n = before.length;
  const m = after.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = before[i] === after[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const kept = new Set<string>();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      kept.add(before[i]);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i += 1;
    else j += 1;
  }
  return kept;
}

/**
 * What changed between two orders. Empty when the ids are the same sequence.
 * Phrases are 뺌 (before order), then 더함 (after order), then 옮김 (before order).
 * A shift caused only by an insert or delete is not a move.
 * More than {@link ORDER_CHANGE_LIMIT} phrases keep the first ones and end with 「그 밖 N개」.
 */
export function describeOrderChange(before: readonly OrderEntry[], after: readonly OrderEntry[]): string {
  const beforeIds = before.map((e) => e.id);
  const afterIds = after.map((e) => e.id);
  if (beforeIds.length === afterIds.length && beforeIds.every((id, i) => id === afterIds[i])) return '';
  const beforeName = new Map(before.map((e) => [e.id, e.name]));
  const afterName = new Map(after.map((e) => [e.id, e.name]));
  const nameOf = (id: string) => afterName.get(id) ?? beforeName.get(id) ?? '단계';
  const afterSet = new Set(afterIds);
  const beforeSet = new Set(beforeIds);
  const phrases: string[] = [];
  for (const entry of before) {
    if (!afterSet.has(entry.id)) phrases.push(`뺌: ${entry.name}`);
  }
  for (let index = 0; index < after.length; index++) {
    const entry = after[index];
    if (beforeSet.has(entry.id)) continue;
    const anchor = index > 0 ? `(${nameOf(afterIds[index - 1])} 뒤)` : '(맨 앞)';
    phrases.push(`더함: ${entry.name}${anchor}`);
  }
  const commonBefore = beforeIds.filter((id) => afterSet.has(id));
  const commonAfter = afterIds.filter((id) => beforeSet.has(id));
  const kept = lcsKept(commonBefore, commonAfter);
  const beforePos = new Map(beforeIds.map((id, i) => [id, i + 1]));
  const afterPos = new Map(afterIds.map((id, i) => [id, i + 1]));
  for (const id of commonBefore) {
    if (kept.has(id)) continue;
    phrases.push(`옮김: ${nameOf(id)} ${ordinal(beforePos.get(id) ?? 0)} → ${ordinal(afterPos.get(id) ?? 0)}`);
  }
  if (phrases.length <= ORDER_CHANGE_LIMIT) return phrases.join(' · ');
  const rest = phrases.length - ORDER_CHANGE_LIMIT;
  return [...phrases.slice(0, ORDER_CHANGE_LIMIT), `그 밖 ${rest}개`].join(' · ');
}

function imageMark(dataUrl: string): string {
  let h = 2166136261;
  for (let i = 0; i < dataUrl.length; i++) {
    h ^= dataUrl.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${dataUrl.length}자 · ${(h >>> 0).toString(36)}`;
}

function layoutText(l: { x: number; y: number; w: number; h: number }): string {
  return `${l.x}, ${l.y} · ${l.w}×${l.h}`;
}

interface Entity {
  kind: DiffKind;
  id: string;
  name: string;
  fields: [string, string][];
}

function push(out: Entity[], kind: DiffKind, id: string, name: string, fields: [string, string][]) {
  out.push({ kind, id, name: name || id, fields });
}

function unitFields(u: Unit): [string, string][] {
  return [
    ['이름', u.name],
    ['코드', u.code],
    ['장치', list(u.deviceIds)],
    ['위치', layoutText(u.layout)],
    ['수용 개수', qtyText(u.capacity.maxMaterials)],
    ['허용 무게', qtyText(u.capacity.maxWeight)],
    ['템플릿', u.templateRef ? `${u.templateRef.assetId}@${u.templateRef.version}` : '없음'],
    ['계보', u.lineage?.duplicatedFrom ? `복제 ${u.lineage.duplicatedFrom}` : u.lineage?.fromTemplate ? `템플릿 ${u.lineage.fromTemplate.name}` : '없음'],
  ];
}

function deviceFields(d: Device): [string, string][] {
  return [
    ['이름', d.name],
    ['종류', d.kind],
    ['정의', `${d.definitionRef.assetId}@${d.definitionRef.version}`],
    ['Unit', d.unitId],
    ['위치', layoutText(d.layout)],
    ['속성', qtyMap(d.properties)],
    ['템플릿 자식', d.templateChild ?? '없음'],
    ['계보', d.lineage?.duplicatedFrom ? `복제 ${d.lineage.duplicatedFrom}` : '없음'],
  ];
}

function sequenceFields(seq: SequenceDraft, unitId?: string): [string, string][] {
  return [
    ['이름', seq.name],
    ['Unit', unitId ?? '없음'],
    ['미정', list(seq.unresolved)],
  ];
}

function flowFields(n: FlowNode): [string, string][] {
  if (n.kind === 'step') return [];
  const fields: [string, string][] = [['종류', flowKind(n.kind)], ['이름', n.kind === 'substation' ? n.unitId : n.name]];
  switch (n.kind) {
    case 'branch':
      fields.push(['갈래', branchArms(n).map((arm) => (arm.cond ? condText(arm.cond) : '나머지')).join(' | ')]);
      break;
    case 'parallel':
      fields.push(['갈래 수', String(n.lanes.length)]);
      break;
    case 'loop':
      fields.push(['횟수', String(n.count)]);
      break;
    case 'retry':
      fields.push(['조건', condText(n.until)], ['최대', String(n.maxRetries)]);
      break;
    case 'wait':
      fields.push(['조건', condText(n.cond)], ['타임아웃', qtyText(n.timeout)]);
      break;
    case 'substation':
      fields.push(['Unit', n.unitId]);
      break;
  }
  return fields;
}

function flowKind(kind: Exclude<FlowNode['kind'], 'step'>): string {
  switch (kind) {
    case 'branch': return '분기';
    case 'parallel': return '병렬';
    case 'loop': return '반복';
    case 'retry': return '재시도';
    case 'wait': return '기다림';
    case 'substation': return 'Substation';
  }
}

function addFlow(out: Entity[], nodes: FlowNode[] | undefined) {
  if (!nodes) return;
  walk(nodes, (n) => {
    if (n.kind === 'step') return;
    push(out, 'flow', n.id, n.kind === 'substation' ? n.unitId : n.name, flowFields(n));
  });
}

function addSequence(out: Entity[], seq: SequenceDraft, unitId?: string) {
  push(out, 'sequence', seq.id, seq.name, sequenceFields(seq, unitId));
  for (const s of seq.steps) {
    push(out, 'step', s.id, s.name, [
      ['이름', s.name],
      ['시퀀스', seq.name],
      ['Action', s.actionId],
      ['타임아웃', s.timeoutOverride ? qtyText(s.timeoutOverride) : '없음'],
      ['진입 조건', condsText(s.entry)],
      ['원문', s.sourceText ?? '없음'],
      ['출처', s.origin],
    ]);
  }
  addFlow(out, seq.flow);
}

function injectionText(rows: readonly ScenarioInjection[]): string {
  if (!rows.length) return '없음';
  return rows.map((r) => [r.stepId && `단계 ${r.stepId}`, r.actionId && `Action ${r.actionId}`, r.readFail && '읽기 실패', r.readFailFirstN != null && `처음 ${r.readFailFirstN}`, r.neverTrueSignalId && `신호 ${r.neverTrueSignalId}`].filter(Boolean).join(' ')).join(' | ');
}

function scenarioFields(s: RunScenario): [string, string][] {
  return [
    ['이름', s.name],
    ['투입 개수', String(s.feedCount)],
    ['투입 간격', s.feedInterval === null ? '미정' : `${s.feedInterval} s`],
    ['배속', String(s.speed)],
    ['주입', injectionText(s.injections)],
  ];
}

function backgroundFields(bg: DiagramBackground): [string, string][] {
  return [
    ['위치', `${bg.x}, ${bg.y}`],
    ['크기', `${bg.width}×${bg.height}`],
    ['배율', String(bg.scale)],
    ['투명도', String(bg.opacity)],
    ['그림', imageMark(bg.dataUrl)],
  ];
}

function confirmationId(e: ConfirmationEntry): string {
  return `${e.at}|${e.by}|${e.name}|${e.from}|${e.to}|${targetKey(e.target)}`;
}

function entitiesOf(p: Project): Entity[] {
  const out: Entity[] = [];
  push(out, 'project', 'project', p.name, [
    ['ID', p.id],
    ['이름', p.name],
    ['가정 메모', list(p.assumptionsNote)],
  ]);
  push(out, 'equipment', p.equipment.id, p.equipment.name, [
    ['이름', p.equipment.name],
    ['Unit 순서', list(p.equipment.unitIds)],
  ]);
  for (const u of p.units) push(out, 'unit', u.id, u.name, unitFields(u));
  for (const d of p.devices) push(out, 'device', d.id, d.name, deviceFields(d));
  for (const s of p.signals) {
    push(out, 'signal', s.id, s.name, [
      ['이름', s.name],
      ['Device', s.deviceId],
      ['포트', s.portKey ?? '없음'],
      ['방향', s.direction === 'in' ? '입력' : '출력'],
      ['역할', { command: '명령', complete: '완료', sensor: '센서', result: '결과' }[s.role] ?? s.role],
      ['주소', s.address ?? '없음'],
      ['주소 상태', addressWord(s.addressStatus)],
    ]);
  }
  for (const pos of p.positions) push(out, 'position', pos.id, pos.name, [['이름', pos.name], ['Device', pos.deviceId], ['값', qtyText(pos.value)]]);
  for (const a of p.actions) {
    push(out, 'action', a.id, a.name, [
      ['이름', a.name],
      ['Unit', a.unitId],
      ['Device', a.deviceId],
      ['종류', ACTION_KIND[a.kind] ?? a.kind],
      ['동작 시간', qtyText(a.duration)],
      ['타임아웃', qtyText(a.timeout)],
      ['명령 신호', a.commandSignalId ?? '없음'],
      ['완료 신호', a.completeSignalId ?? '없음'],
      ['목표 포지션', a.targetPositionId ?? '없음'],
      ['매개변수', qtyMap(a.params)],
      ['사전 조건', condsText(a.pre)],
      ['사후 조건', condsText(a.post)],
      ['효과', effectText(a.effect)],
      ['메모', a.note ?? '없음'],
    ]);
  }
  for (const c of p.connections) push(out, 'connection', c.id, connectionName(c), [
    ['종류', c.kind === 'flow' ? '물류' : '신호'],
    ['출발', endText(c.from)],
    ['도착', endText(c.to)],
  ]);
  for (const m of p.materials) {
    push(out, 'material', m.id, m.name, [
      ['이름', m.name],
      ['종류', m.kind === 'individual' ? '개별' : '캐리어'],
      ['캐리어', m.carrierOf ?? '없음'],
      ['가로', qtyText(m.size.w)],
      ['세로', qtyText(m.size.l)],
      ['높이', qtyText(m.size.h)],
      ['무게', qtyText(m.weight)],
      ['취급', m.handling],
      ['상태 목록', list(m.states)],
      ['처음 상태', m.initialState ?? '없음'],
      ['처음 위치', m.initialLocation ?? '없음'],
      ['경로', list(m.route)],
      ['투입 간격', qtyText(m.feedInterval)],
      ['투입 개수', String(feedCountOf(m))],
    ]);
  }
  addSequence(out, p.sequence);
  for (const seq of p.substationSequences ?? []) addSequence(out, seq, seq.unitId);
  for (const k of p.constraints) {
    const interlock = k.kind === 'interlock-candidate';
    push(out, interlock ? 'interlock' : 'constraint', k.id, k.description, [
      ['설명', k.description],
      ['종류', interlock ? 'Interlock' : k.kind === 'prohibition' ? '금지' : '전제'],
      ['관련', list(k.relatedIds)],
      ['확인', confirmationWord(k.confirmation)],
      ['출처', SOURCE[k.source.method] ?? k.source.method],
      ['규칙', ruleText(k.rule)],
    ]);
  }
  for (const c of p.candidates) {
    push(out, 'candidate', c.id, c.name, [
      ['이름', c.name],
      ['대상', c.targetKind === 'unit' ? 'Unit' : c.targetKind === 'device' ? 'Device' : '신호'],
      ['장치 종류', c.deviceKind ?? '없음'],
      ['Unit', c.assignedUnitId ?? '없음'],
      ['Unit 이름', c.assignedUnitName ?? '없음'],
      ['신호 장치', c.signalDeviceName ?? '없음'],
      ['신호 방향', c.signalDirection === 'in' ? '입력' : c.signalDirection === 'out' ? '출력' : '없음'],
      ['주소', c.signalAddress ?? '없음'],
      ['메모', c.signalMemo ?? '없음'],
      ['이미 있음', c.alreadyExists ? '예' : '아니오'],
      ['확인', confirmationWord(c.confirmation)],
      ['적용', c.appliedObjectId ?? '없음'],
      ['신뢰', `${c.confidence.level} · ${c.confidence.basis}`],
      ['출처', list(c.sourceRefs.map((s) => SOURCE[s.method] ?? s.method))],
    ]);
  }
  if (p.diagramBackground) push(out, 'background', 'background', '배경', backgroundFields(p.diagramBackground));
  const faults = p.simSettings.faults;
  const firstN = faults.readFailFirstN;
  const firstKeys = firstN ? Object.keys(firstN).sort(cmp) : [];
  push(out, 'sim', 'sim', '시뮬', [
    ['배속', String(p.simSettings.speed)],
    ['항상 거짓', list(faults.neverTrueSignalIds)],
    ['읽기 실패', list(faults.readFailActionIds)],
    ['처음 N회', firstKeys.length && firstN ? firstKeys.map((key) => `${key} ${firstN[key]}`).join(' · ') : '없음'],
  ]);
  for (const id of Object.keys(p.gapReview).sort(cmp)) {
    const g = p.gapReview[id];
    push(out, 'gap', id, id, [
      ['상태', gapStatusWord(g.status)],
      ['처음', String(g.firstSeenRevision)],
      ['마지막', String(g.lastSeenRevision)],
      ['근거', g.lastEvidence],
      ['해결', g.resolvedRevision == null ? '없음' : String(g.resolvedRevision)],
    ]);
  }
  const seen = new Map<string, number>();
  for (const e of p.confirmationLog ?? []) {
    const base = confirmationId(e);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    push(out, 'confirmation', n === 0 ? base : `${base}|${n}`, e.name, [
      ['시각', e.at],
      ['확인자', e.by],
      ['이전', e.from],
      ['이후', e.to],
      ['대상', targetKey(e.target)],
    ]);
  }
  for (const s of p.runScenarios ?? []) push(out, 'scenario', s.id, s.name, scenarioFields(s));
  return out;
}

function endText(e: { nodeId: string; signalId?: string }): string {
  return e.signalId ? `${e.nodeId} · ${e.signalId}` : e.nodeId;
}

function connectionName(c: Connection): string {
  return `${endText(c.from)} → ${endText(c.to)}`;
}

function ruleText(rule: Project['constraints'][number]['rule']): string {
  if (!rule) return '없음';
  if (rule.form === 'allow') return `허용 ${rule.actionId} · ${condsText(rule.conditions)}`;
  if (rule.form === 'mutex') return `동시 금지 ${rule.actionId} · ${rule.otherActionId}`;
  return `미정 ${rule.note}`;
}

function indexEntities(listIn: Entity[]): Map<string, Entity> {
  const map = new Map<string, Entity>();
  const seen = new Map<string, number>();
  for (const e of listIn) {
    const base = `${e.kind}\0${e.id}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    map.set(n === 0 ? base : `${base}\0${n}`, e);
  }
  return map;
}

function row(change: DiffChange, e: Entity, field = '', before = '', after = ''): DiffRow {
  return { change, kind: e.kind, id: e.id, name: e.name, field, before, after };
}

function lockRows(before: Project, after: Project): DiffRow[] {
  const rows: DiffRow[] = [];
  const beforeUnits = new Map(before.units.map((u) => [u.id, u]));
  const afterUnits = new Map(after.units.map((u) => [u.id, u]));
  const ids = [...new Set([...beforeUnits.keys(), ...afterUnits.keys()])].sort(cmp);
  for (const id of ids) {
    const b = beforeUnits.get(id);
    const a = afterUnits.get(id);
    const bv = b?.positionLocked === true;
    const av = a?.positionLocked === true;
    const name = a?.name || b?.name || id;
    if (b && a) {
      if (bv !== av) rows.push({ change: 'changed', kind: 'lock', id, name, field: '위치 잠금', before: bv ? '잠김' : '풀림', after: av ? '잠김' : '풀림' });
    } else if (a && av) rows.push({ change: 'added', kind: 'lock', id, name, field: '', before: '', after: name });
    else if (b && bv) rows.push({ change: 'removed', kind: 'lock', id, name, field: '', before: name, after: '' });
  }
  const bBg = before.diagramBackground;
  const aBg = after.diagramBackground;
  if (bBg && aBg) {
    if ((bBg.locked === true) !== (aBg.locked === true)) {
      rows.push({ change: 'changed', kind: 'lock', id: 'background', name: '배경', field: '잠금', before: bBg.locked ? '잠김' : '풀림', after: aBg.locked ? '잠김' : '풀림' });
    }
  } else if (aBg?.locked) rows.push({ change: 'added', kind: 'lock', id: 'background', name: '배경', field: '', before: '', after: '배경' });
  else if (bBg?.locked) rows.push({ change: 'removed', kind: 'lock', id: 'background', name: '배경', field: '', before: '배경', after: '' });
  return rows;
}

function compareEntities(before: Entity[], after: Entity[]): DiffRow[] {
  const left = indexEntities(before);
  const right = indexEntities(after);
  const rows: DiffRow[] = [];
  for (const [key, entity] of right) {
    const prev = left.get(key);
    if (!prev) {
      rows.push(row('added', entity, '', '', entity.name));
      continue;
    }
    const keys: string[] = [];
    const seen = new Set<string>();
    for (const [label] of prev.fields) if (!seen.has(label)) { seen.add(label); keys.push(label); }
    for (const [label] of entity.fields) if (!seen.has(label)) { seen.add(label); keys.push(label); }
    const prevMap = new Map(prev.fields);
    const nextMap = new Map(entity.fields);
    for (const label of keys) {
      const was = prevMap.get(label) ?? '없음';
      const now = nextMap.get(label) ?? '없음';
      if (was !== now) rows.push({ change: 'changed', kind: entity.kind, id: entity.id, name: entity.name || prev.name, field: label, before: was, after: now });
    }
  }
  for (const [key, entity] of left) {
    if (!right.has(key)) rows.push(row('removed', entity, '', entity.name, ''));
  }
  return rows;
}

function sortRows(rows: DiffRow[]): DiffRow[] {
  return [...rows].sort((a, b) => (
    (KIND_INDEX.get(a.kind) ?? 0) - (KIND_INDEX.get(b.kind) ?? 0)
    || CHANGE_INDEX[a.change] - CHANGE_INDEX[b.change]
    || cmp(a.id, b.id)
    || cmp(a.field, b.field)
  ));
}

interface NameBook {
  step: Map<string, string>;
  unit: Map<string, string>;
}

function nameBook(project: Project, seq: SequenceDraft): NameBook {
  return {
    step: new Map(seq.steps.map((s) => [s.id, s.name.trim() || '단계'])),
    unit: new Map(project.units.map((u) => [u.id, u.name])),
  };
}

function flowEntry(n: FlowNode, names: NameBook): OrderEntry {
  if (n.kind === 'step') return { id: n.stepId, name: names.step.get(n.stepId) ?? '단계' };
  if (n.kind === 'substation') {
    const unit = names.unit.get(n.unitId);
    return { id: n.id, name: unit ? `Substation ${unit}` : 'Substation' };
  }
  return { id: n.id, name: blockVisibleName(n.kind, n.name) };
}

function flowEntries(nodes: readonly FlowNode[], names: NameBook): OrderEntry[] {
  return nodes.map((n) => flowEntry(n, names));
}

function stepEntries(seq: SequenceDraft): OrderEntry[] {
  return seq.steps.map((s) => ({ id: s.id, name: s.name.trim() || '단계' }));
}

interface ChildList {
  label: string;
  items: OrderEntry[];
}

function childLists(n: FlowNode, names: NameBook): ChildList[] {
  if (n.kind === 'loop' || n.kind === 'retry') return [{ label: '순서', items: flowEntries(n.body, names) }];
  if (n.kind === 'parallel') {
    return n.lanes.map((lane, i) => ({
      label: n.lanes.length > 1 ? `갈래 ${i + 1}` : '순서',
      items: flowEntries(lane, names),
    }));
  }
  if (n.kind === 'branch') {
    const arms = branchArms(n);
    return arms.map((arm, i) => ({ label: armLabel(arms.length, i), items: flowEntries(arm.body, names) }));
  }
  return [];
}

function pushOrder(rows: DiffRow[], kind: DiffKind, id: string, name: string, field: string, before: OrderEntry[], after: OrderEntry[]) {
  const text = describeOrderChange(before, after);
  if (!text) return;
  rows.push({ change: 'changed', kind, id, name: name || id, field, before: '', after: text, orderText: text });
}

function blocksById(nodes: FlowNode[] | undefined): Map<string, FlowNode> {
  const map = new Map<string, FlowNode>();
  if (!nodes) return map;
  walk(nodes, (n) => { if (n.kind !== 'step') map.set(n.id, n); });
  return map;
}

function sequenceOrderRows(before: Project, after: Project, bSeq: SequenceDraft, aSeq: SequenceDraft): DiffRow[] {
  const rows: DiffRow[] = [];
  const name = aSeq.name || bSeq.name;
  pushOrder(rows, 'sequence', aSeq.id, name, '단계 순서', stepEntries(bSeq), stepEntries(aSeq));
  const bFlow = bSeq.flow ? flowEntries(bSeq.flow, nameBook(before, bSeq)) : null;
  const aFlow = aSeq.flow ? flowEntries(aSeq.flow, nameBook(after, aSeq)) : null;
  if (bFlow || aFlow) {
    pushOrder(rows, 'sequence', aSeq.id, name, '흐름', bFlow ?? stepEntries(bSeq), aFlow ?? stepEntries(aSeq));
  }
  const bBlocks = blocksById(bSeq.flow);
  const aBlocks = blocksById(aSeq.flow);
  const bNames = nameBook(before, bSeq);
  const aNames = nameBook(after, aSeq);
  for (const id of [...bBlocks.keys()].filter((key) => aBlocks.has(key)).sort(cmp)) {
    const bNode = bBlocks.get(id)!;
    const aNode = aBlocks.get(id)!;
    if (bNode.kind === 'step' || aNode.kind === 'step' || bNode.kind !== aNode.kind) continue;
    const blockName = aNode.kind === 'substation' ? flowEntry(aNode, aNames).name : blockVisibleName(aNode.kind, aNode.name);
    const bLists = childLists(bNode, bNames);
    const aLists = childLists(aNode, aNames);
    const count = Math.max(bLists.length, aLists.length);
    for (let i = 0; i < count; i++) {
      const label = aLists[i]?.label ?? bLists[i]?.label ?? '순서';
      pushOrder(rows, 'flow', id, blockName, label, bLists[i]?.items ?? [], aLists[i]?.items ?? []);
    }
  }
  return rows;
}

/** Step and block order lines. Same two models always emit the same phrases. */
function orderRows(before: Project, after: Project): DiffRow[] {
  const rows: DiffRow[] = [];
  if (before.sequence.id === after.sequence.id) rows.push(...sequenceOrderRows(before, after, before.sequence, after.sequence));
  const bSubs = new Map((before.substationSequences ?? []).map((seq) => [seq.id, seq]));
  const aSubs = new Map((after.substationSequences ?? []).map((seq) => [seq.id, seq]));
  for (const id of [...bSubs.keys()].filter((key) => aSubs.has(key)).sort(cmp)) {
    rows.push(...sequenceOrderRows(before, after, bSubs.get(id)!, aSubs.get(id)!));
  }
  return rows;
}

/** Added, removed, and changed rows. Position (x, y, width, height) is one field. */
export function diffProjects(before: Project, after: Project): ProjectDiff {
  const rows = sortRows([
    ...compareEntities(entitiesOf(before), entitiesOf(after)),
    ...lockRows(before, after),
    ...orderRows(before, after),
  ]);
  return {
    rows,
    added: rows.filter((r) => r.change === 'added').length,
    removed: rows.filter((r) => r.change === 'removed').length,
    changed: rows.filter((r) => r.change === 'changed').length,
  };
}

export function diffSummaryText(diff: ProjectDiff): string {
  return `추가 ${diff.added} · 삭제 ${diff.removed} · 바뀜 ${diff.changed}`;
}

export function groupDiff(diff: ProjectDiff): DiffGroup[] {
  const buckets = new Map<DiffKind, DiffRow[]>();
  for (const row of diff.rows) {
    const listIn = buckets.get(row.kind);
    if (listIn) listIn.push(row);
    else buckets.set(row.kind, [row]);
  }
  const groups: DiffGroup[] = [];
  for (const kind of DIFF_KINDS) {
    const rows = buckets.get(kind);
    if (rows?.length) groups.push({ kind, label: DIFF_KIND_LABEL[kind], rows });
  }
  return groups;
}
