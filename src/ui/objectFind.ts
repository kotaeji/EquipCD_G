// TURN-066. Read-only index of named objects. Search and the list it returns do not edit the model.
import { findAsset } from '../assets/library';
import { analyzeGaps, GAP_KIND_LABEL, type Gap } from '../model/gaps';
import { walk } from '../model/flow';
import { interlockSummary } from '../model/interlock';
import type { Action, Device, FlowNode, Project, SequenceDraft, SequenceStep, Unit } from '../model/types';
import { deviceCode } from '../scene/labels';
import { portWord } from './edgeFocus';
import { flowBlockTitle } from './labels';
import { normalizeQuery } from './commandModel';
import type { ItemJump } from './wizard';

export const OBJECT_KINDS = [
  'unit', 'device', 'signal', 'position', 'action', 'step', 'block', 'interlock', 'material', 'gap',
] as const;
export type ObjectKind = (typeof OBJECT_KINDS)[number];

export const OBJECT_KIND_LABEL: Record<ObjectKind, string> = {
  unit: 'Unit',
  device: 'Device',
  signal: '신호',
  position: '포지션',
  action: 'Action',
  step: '단계',
  block: '블록',
  interlock: 'Interlock',
  material: '자재',
  gap: 'Gap',
};

/** Rows kept on screen for one kind before 「N개 더」. */
export const OBJECT_PAGE = 5;

export interface ObjectEntry {
  id: string;
  kind: ObjectKind;
  name: string;
  code: string;
  /** Words the screen shows that the stored name may not contain. */
  screenName: string;
  /** 「S1 투입 › CYL-01」 */
  where: string;
  jump: ItemJump;
  /** Station flow row to check. View only. */
  flowId?: string;
}

export interface ObjectGroup {
  kind: ObjectKind;
  label: string;
  shown: ObjectEntry[];
  /** How many matches stay behind 「N개 더」. Zero hides that row. */
  more: number;
}

export type FindScope = 'all' | 'commands' | 'objects';

/** `>` is commands only, `@` is objects only. The marker is not part of the text. */
export function parseFindQuery(raw: string): { scope: FindScope; text: string } {
  const trimmed = raw.trimStart();
  if (trimmed.startsWith('>')) return { scope: 'commands', text: trimmed.slice(1).trimStart() };
  if (trimmed.startsWith('@')) return { scope: 'objects', text: trimmed.slice(1).trimStart() };
  return { scope: 'all', text: raw };
}

const SEP = ' › ';

const SIGNAL_ROLE: Record<string, string> = { command: '명령', complete: '완료', sensor: '센서', result: '결과' };

function signalRole(role: string): string {
  return SIGNAL_ROLE[role] ?? role;
}

function joinWhere(parts: Array<string | undefined>): string {
  return parts.map((p) => p?.trim() ?? '').filter(Boolean).join(SEP);
}

function shortUnit(unit: Unit): string {
  const rest = unit.name.replace(new RegExp(`^${unit.code}\\s*`), '').trim();
  return rest || unit.name;
}

function deviceWhere(unit: Unit | undefined, device: Device): string {
  return joinWhere([unit?.name, deviceCode(device.name)]);
}

function actionDevice(p: { devices: Device[] }, action: Action | undefined): Device | undefined {
  return action ? p.devices.find((d) => d.id === action.deviceId) : undefined;
}

function pushStep(
  out: ObjectEntry[],
  step: SequenceStep,
  seq: SequenceDraft,
  project: Project,
  unitById: Map<string, Unit>,
  sub: string,
) {
  const action = project.actions.find((a) => a.id === step.actionId);
  const device = actionDevice(project, action);
  const unit = device ? unitById.get(device.unitId) : action ? unitById.get(action.unitId) : undefined;
  out.push({
    id: step.id,
    kind: 'step',
    name: step.name,
    code: step.id,
    screenName: step.name,
    where: joinWhere([seq.name, unit?.name, device ? deviceCode(device.name) : undefined]),
    jump: {
      step: 'sequence',
      sub,
      selectId: device?.id,
      rightTab: device ? 'actions' : undefined,
      actionId: action?.id,
      field: `step:${step.id}`,
    },
    flowId: sub === 'sequence' ? step.id : undefined,
  });
}

function pushBlock(
  out: ObjectEntry[],
  node: FlowNode,
  seqName: string,
  sub: string,
) {
  if (node.kind === 'step') return;
  let name = '';
  let screen = '';
  if (node.kind === 'substation') {
    name = node.unitId;
    screen = `Substation ${node.unitId}`;
  } else {
    name = node.name;
    screen = flowBlockTitle(node.kind, node.name);
  }
  out.push({
    id: node.id,
    kind: 'block',
    name: name || screen,
    code: node.id,
    screenName: screen,
    where: seqName,
    jump: { step: 'sequence', sub, field: `flow:${node.id}` },
    flowId: sub === 'sequence' ? node.id : undefined,
  });
}

function indexSequence(
  out: ObjectEntry[],
  seq: SequenceDraft,
  project: Project,
  unitById: Map<string, Unit>,
  sub: string,
) {
  for (const step of seq.steps) pushStep(out, step, seq, project, unitById, sub);
  if (!seq.flow) return;
  walk(seq.flow, (node) => {
    if (node.kind === 'step') return;
    if (node.kind === 'substation') {
      const unit = unitById.get(node.unitId);
      const label = unit?.name ?? node.unitId;
      out.push({
        id: node.id,
        kind: 'block',
        name: label,
        code: node.id,
        screenName: `Substation ${label}`,
        where: joinWhere([seq.name, label]),
        jump: { step: 'sequence', sub, selectId: unit?.id, field: `flow:${node.id}` },
        flowId: sub === 'sequence' ? node.id : undefined,
      });
      return;
    }
    pushBlock(out, node, seq.name, sub);
  });
}

function gapWhere(project: Project, gap: Gap, unitById: Map<string, Unit>, deviceById: Map<string, Device>): string {
  const parts: string[] = [];
  for (const id of gap.objectIds) {
    const unit = unitById.get(id);
    if (unit) { parts.push(unit.name); continue; }
    const device = deviceById.get(id);
    if (device) { parts.push(deviceWhere(unitById.get(device.unitId), device)); continue; }
    const step = project.sequence.steps.find((s) => s.id === id);
    if (step) parts.push(step.name);
  }
  return parts.filter((p, i) => parts.indexOf(p) === i).slice(0, 2).join(SEP);
}

/** Every named object the palette can open. Order inside a kind is model order. */
export function indexObjects(project: Project, gaps: readonly Gap[] = analyzeGaps(project)): ObjectEntry[] {
  const unitById = new Map(project.units.map((u) => [u.id, u]));
  const deviceById = new Map(project.devices.map((d) => [d.id, d]));
  const out: ObjectEntry[] = [];

  for (const unit of project.units) {
    out.push({
      id: unit.id,
      kind: 'unit',
      name: unit.name,
      code: unit.code,
      screenName: shortUnit(unit),
      where: unit.name,
      jump: { step: 'canvas', selectId: unit.id, field: `unit:${unit.id}` },
    });
  }

  for (const device of project.devices) {
    const unit = unitById.get(device.unitId);
    const asset = findAsset(device.kind);
    out.push({
      id: device.id,
      kind: 'device',
      name: device.name,
      code: deviceCode(device.name),
      screenName: [device.name, asset?.name].filter(Boolean).join(' '),
      where: deviceWhere(unit, device),
      jump: { step: 'canvas', selectId: device.id, field: `device:${device.id}` },
    });
  }

  for (const signal of project.signals) {
    const device = deviceById.get(signal.deviceId);
    const unit = device ? unitById.get(device.unitId) : undefined;
    const word = device ? portWord(device.name, signal.name, signal.portKey) : signal.name;
    const code = deviceCode(signal.name) || (device ? deviceCode(device.name) : signal.id);
    out.push({
      id: signal.id,
      kind: 'signal',
      name: signal.name,
      code,
      screenName: `${word} ${signal.direction === 'in' ? '입력' : '출력'} ${signalRole(signal.role)}`,
      where: device ? deviceWhere(unit, device) : (unit?.name ?? ''),
      jump: { step: 'attributes', selectId: device?.id, rightTab: 'signals', field: `signal:${signal.id}` },
    });
  }

  for (const position of project.positions) {
    const device = deviceById.get(position.deviceId);
    const unit = device ? unitById.get(device.unitId) : undefined;
    const bare = device ? position.name.replace(device.name, '').trim() : position.name;
    out.push({
      id: position.id,
      kind: 'position',
      name: position.name,
      code: deviceCode(position.name) || (device ? deviceCode(device.name) : position.id),
      screenName: bare || position.name,
      where: device ? deviceWhere(unit, device) : '',
      jump: { step: 'attributes', selectId: device?.id, rightTab: 'positions', field: `position:${position.id}` },
    });
  }

  for (const action of project.actions) {
    const device = deviceById.get(action.deviceId);
    const unit = unitById.get(action.unitId) ?? (device ? unitById.get(device.unitId) : undefined);
    out.push({
      id: action.id,
      kind: 'action',
      name: action.name,
      code: device ? deviceCode(device.name) : action.id,
      screenName: `${unit?.code ?? ''} ${action.name}`.trim(),
      where: device ? deviceWhere(unit, device) : (unit?.name ?? ''),
      jump: {
        step: 'attributes',
        selectId: device?.id,
        rightTab: 'actions',
        actionId: action.id,
        field: `timeout:${action.id}`,
      },
    });
  }

  indexSequence(out, project.sequence, project, unitById, 'sequence');
  for (const seq of project.substationSequences ?? []) indexSequence(out, seq, project, unitById, 'subseq');

  for (const rule of project.constraints) {
    const deviceId = rule.relatedIds.find((id) => deviceById.has(id));
    const device = deviceId ? deviceById.get(deviceId) : undefined;
    const unit = device ? unitById.get(device.unitId) : undefined;
    out.push({
      id: rule.id,
      kind: 'interlock',
      name: rule.description,
      code: rule.id,
      screenName: interlockSummary(project, rule),
      where: device ? deviceWhere(unit, device) : joinWhere(rule.relatedIds.map((id) => unitById.get(id)?.name)),
      jump: { step: 'attributes', selectId: device?.id ?? unit?.id, rightTab: 'check', field: `interlock:${rule.id}` },
    });
  }

  for (const material of project.materials) {
    const unit = material.initialLocation ? unitById.get(material.initialLocation) : undefined;
    out.push({
      id: material.id,
      kind: 'material',
      name: material.name,
      code: material.id,
      screenName: material.name,
      where: unit?.name ?? '',
      jump: { step: 'sequence', sub: 'material', selectId: unit?.id, field: `material:${material.id}` },
    });
  }

  for (const gap of gaps) {
    const deviceId = gap.objectIds.find((id) => deviceById.has(id));
    const unitId = gap.objectIds.find((id) => unitById.has(id));
    out.push({
      id: gap.id,
      kind: 'gap',
      name: gap.title,
      code: gap.id,
      screenName: `${GAP_KIND_LABEL[gap.kind]} ${gap.title}`,
      where: gapWhere(project, gap, unitById, deviceById),
      jump: {
        step: 'check',
        sub: 'gap',
        selectId: deviceId ?? unitId,
        field: `gap:${gap.id}`,
      },
    });
  }

  return out;
}

function hit(entry: ObjectEntry, q: string): boolean {
  if (!q) return true;
  return [entry.name, entry.code, entry.screenName].some((value) => normalizeQuery(value).includes(q));
}

/** Matches in kind order. Each kind keeps `OBJECT_PAGE` rows unless that kind is expanded. */
export function searchObjects(
  entries: readonly ObjectEntry[],
  text: string,
  expanded: ReadonlySet<ObjectKind> = new Set(),
): ObjectGroup[] {
  const q = normalizeQuery(text);
  const buckets = new Map<ObjectKind, ObjectEntry[]>(OBJECT_KINDS.map((kind) => [kind, []]));
  for (const entry of entries) {
    if (!hit(entry, q)) continue;
    buckets.get(entry.kind)!.push(entry);
  }
  const groups: ObjectGroup[] = [];
  for (const kind of OBJECT_KINDS) {
    const rows = buckets.get(kind)!;
    if (!rows.length) continue;
    const open = expanded.has(kind);
    const shown = open ? rows : rows.slice(0, OBJECT_PAGE);
    groups.push({
      kind,
      label: OBJECT_KIND_LABEL[kind],
      shown,
      more: open ? 0 : Math.max(0, rows.length - OBJECT_PAGE),
    });
  }
  return groups;
}

/** Index and search once. The palette calls the two steps so typing does not rebuild the index. */
export function findObjects(project: Project, text: string, expanded?: ReadonlySet<ObjectKind>): ObjectGroup[] {
  return searchObjects(indexObjects(project), text, expanded);
}
