// TURN-079. Read-only sheets for the print view. Nothing here edits the project.
import { findAsset } from '../assets/library';
import { formatLocalClock } from '../ui/localClock';
import { conditionFormula } from './conditionFormula';
import { walk } from './flow';
import { analyzeGaps, GAP_KIND_LABEL } from './gaps';
import { interlockSummary } from './interlock';
import type { FlowNode, Layout, Project, Quantity, SequenceStep } from './types';

export const PRINT_LIMIT = '논리 시뮬레이션 — 실제 장비 제어 / 안전 검증 아님 · 검토 후보';

export const PRINT_SECTIONS = [
  { id: 'cover', label: '표지' },
  { id: 'structure', label: '장비 구조' },
  { id: 'diagram', label: '도면 도식' },
  { id: 'station', label: 'Station 시퀀스' },
  { id: 'substation', label: 'Substation 시퀀스' },
  { id: 'sfc', label: 'SFC' },
  { id: 'signals', label: '신호 · Interlock' },
  { id: 'notes', label: '가정 · 미정 · Gap' },
] as const;

export type PrintSectionId = (typeof PRINT_SECTIONS)[number]['id'];

const BLOCK_WORD: Record<string, string> = {
  branch: '분기', parallel: '병렬', loop: '반복', retry: '재시도', wait: '신호 기다림',
};

const SIGNAL_ROLE: Record<string, string> = { command: '명령', complete: '완료', sensor: '센서', result: '결과' };
const CONFIRM: Record<string, string> = {
  unconfirmed: '미확인 후보', confirmed: '사람 확인됨', rejected: '거절됨', needsRecheck: '재확인 필요',
};
const CONSTRAINT_KIND: Record<string, string> = {
  'interlock-candidate': 'Interlock', prohibition: '금지', premise: '전제',
};

export interface DiagramFrame { x: number; y: number; w: number; h: number }

/** Bounds of the current model. Screen zoom and pan are not an input. */
export function diagramFrame(p: Project): DiagramFrame {
  const boxes = [...p.units.map((u) => u.layout), ...p.devices.map((d) => d.layout)];
  if (boxes.length === 0) return { x: 0, y: 0, w: 480, h: 280 };
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const maxY = Math.max(...boxes.map((b) => b.y + b.h));
  const pad = 28;
  return {
    x: minX - pad,
    y: minY - pad,
    w: Math.max(40, maxX - minX + pad * 2),
    h: Math.max(40, maxY - minY + pad * 2 + 18),
  };
}

export function nodeLayout(p: Project, id: string): Layout | null {
  return p.units.find((u) => u.id === id)?.layout ?? p.devices.find((d) => d.id === id)?.layout ?? null;
}

export interface StructureRow { station: string; unit: string; code: string; device: string; kind: string }

export function structureRows(p: Project): StructureRow[] {
  const station = p.equipment.name;
  const ordered = p.equipment.unitIds.map((id) => p.units.find((u) => u.id === id)).filter((u): u is NonNullable<typeof u> => !!u);
  for (const u of p.units) if (!ordered.includes(u)) ordered.push(u);
  const rows: StructureRow[] = [];
  for (const u of ordered) {
    const devices = u.deviceIds.map((id) => p.devices.find((d) => d.id === id)).filter((d): d is NonNullable<typeof d> => !!d);
    if (devices.length === 0) rows.push({ station, unit: u.name, code: u.code, device: '', kind: '' });
    for (const d of devices) rows.push({ station, unit: u.name, code: u.code, device: d.name, kind: findAsset(d.kind)?.name ?? d.kind });
  }
  return rows;
}

export interface FlowLine { key: string; depth: number; title: string; detail: string }

function unitName(p: Project, id: string) { return p.units.find((u) => u.id === id)?.name ?? id; }
function devName(p: Project, id: string) { return p.devices.find((d) => d.id === id)?.name ?? id; }

function blockTitle(kind: string, name: string): string {
  const word = BLOCK_WORD[kind] ?? kind;
  const trimmed = name.trim();
  if (!trimmed || trimmed === word) return word;
  return `${word} ${trimmed}`;
}

function flatten(p: Project, steps: SequenceStep[], nodes: FlowNode[], depth: number): FlowLine[] {
  const out: FlowLine[] = [];
  for (const n of nodes) {
    if (n.kind === 'step') {
      const step = steps.find((s) => s.id === n.stepId);
      const action = step ? p.actions.find((a) => a.id === step.actionId) : undefined;
      out.push({
        key: n.stepId, depth, title: step?.name ?? n.stepId,
        detail: action ? `${unitName(p, action.unitId)} / ${devName(p, action.deviceId)}` : '',
      });
    } else if (n.kind === 'branch') {
      out.push({ key: n.id, depth, title: blockTitle('branch', n.name), detail: conditionFormula(p, n.cond) });
      out.push({ key: `${n.id}:then`, depth: depth + 1, title: '참', detail: '조건이 참' });
      out.push(...flatten(p, steps, n.then, depth + 2));
      out.push({ key: `${n.id}:else`, depth: depth + 1, title: '거짓', detail: '조건이 거짓' });
      out.push(...flatten(p, steps, n.else, depth + 2));
    } else if (n.kind === 'parallel') {
      out.push({ key: n.id, depth, title: blockTitle('parallel', n.name), detail: `갈래 ${n.lanes.length}` });
      n.lanes.forEach((lane, i) => {
        out.push({ key: `${n.id}:lane${i}`, depth: depth + 1, title: `갈래 ${i + 1}`, detail: '' });
        out.push(...flatten(p, steps, lane, depth + 2));
      });
    } else if (n.kind === 'loop') {
      out.push({ key: n.id, depth, title: blockTitle('loop', n.name), detail: `${n.count}회` });
      out.push(...flatten(p, steps, n.body, depth + 1));
    } else if (n.kind === 'retry') {
      out.push({ key: n.id, depth, title: blockTitle('retry', n.name), detail: `${conditionFormula(p, n.until)} · 최대 ${n.maxRetries}회` });
      out.push(...flatten(p, steps, n.body, depth + 1));
    } else if (n.kind === 'wait') {
      const timeout = n.timeout.value === null ? '미정' : `${n.timeout.value} ${n.timeout.unit}`;
      out.push({ key: n.id, depth, title: blockTitle('wait', n.name), detail: `${conditionFormula(p, n.cond)} · 타임아웃 ${timeout}` });
    } else {
      out.push({ key: n.id, depth, title: `Substation ${unitName(p, n.unitId)}`, detail: '' });
    }
  }
  return out;
}

export function stationFlow(p: Project): { name: string; rows: FlowLine[] } {
  const nodes = p.sequence.flow ?? p.sequence.steps.map((s) => ({ kind: 'step' as const, stepId: s.id }));
  return { name: p.sequence.name, rows: flatten(p, p.sequence.steps, nodes, 0) };
}

export interface SubFlow { id: string; name: string; unit: string; rows: FlowLine[] }

export function substationFlows(p: Project): SubFlow[] {
  return (p.substationSequences ?? []).map((q) => {
    const nodes = q.flow ?? q.steps.map((s) => ({ kind: 'step' as const, stepId: s.id }));
    return { id: q.id, name: q.name, unit: unitName(p, q.unitId), rows: flatten(p, q.steps, nodes, 0) };
  });
}

export interface SignalLine { id: string; name: string; device: string; direction: string; role: string; address: string }

export function signalRows(p: Project): SignalLine[] {
  return p.signals.map((s) => ({
    id: s.id,
    name: s.name,
    device: devName(p, s.deviceId),
    direction: s.direction === 'out' ? '출력' : '입력',
    role: SIGNAL_ROLE[s.role] ?? s.role,
    address: s.address ?? '미정',
  }));
}

export interface InterlockLine { id: string; kind: string; confirmation: string; description: string; rule: string }

export function interlockRows(p: Project): InterlockLine[] {
  return p.constraints.map((k) => ({
    id: k.id,
    kind: CONSTRAINT_KIND[k.kind] ?? k.kind,
    confirmation: CONFIRM[k.confirmation] ?? k.confirmation,
    description: k.description,
    rule: interlockSummary(p, k),
  }));
}

export interface FlagLine { id: string; text: string }

function pushQty(und: FlagLine[], ass: FlagLine[], q: Quantity | undefined, id: string, label: string) {
  if (!q) return;
  if (q.value === null || Number.isNaN(q.value)) und.push({ id, text: `${label} 미정` });
  else if (q.assumption) ass.push({ id, text: `${label} ${q.value} ${q.unit} (가정)` });
}

export function printFlags(p: Project): { memos: string[]; undetermined: FlagLine[]; assumptions: FlagLine[] } {
  const undetermined: FlagLine[] = [];
  const assumptions: FlagLine[] = [];
  for (const u of p.units) {
    pushQty(undetermined, assumptions, u.capacity.maxMaterials, `${u.id}:count`, `${u.name} · 수용 개수`);
    pushQty(undetermined, assumptions, u.capacity.maxWeight, `${u.id}:weight`, `${u.name} · 허용 무게`);
  }
  for (const d of p.devices) {
    for (const [key, q] of Object.entries(d.properties)) pushQty(undetermined, assumptions, q, `${d.id}:${key}`, `${d.name} · ${key}`);
  }
  for (const a of p.actions) {
    pushQty(undetermined, assumptions, a.duration, `${a.id}:duration`, `${a.name} · 동작 시간`);
    pushQty(undetermined, assumptions, a.timeout, `${a.id}:timeout`, `${a.name} · 타임아웃`);
    for (const [key, q] of Object.entries(a.params)) pushQty(undetermined, assumptions, q, `${a.id}:${key}`, `${a.name} · ${key}`);
  }
  for (const m of p.materials) {
    pushQty(undetermined, assumptions, m.size.w, `${m.id}:w`, `${m.name} · 가로`);
    pushQty(undetermined, assumptions, m.size.l, `${m.id}:l`, `${m.name} · 세로`);
    pushQty(undetermined, assumptions, m.size.h, `${m.id}:h`, `${m.name} · 높이`);
    pushQty(undetermined, assumptions, m.weight, `${m.id}:weight`, `${m.name} · 무게`);
    pushQty(undetermined, assumptions, m.feedInterval, `${m.id}:feed`, `${m.name} · 투입 간격`);
  }
  for (const pos of p.positions) pushQty(undetermined, assumptions, pos.value, pos.id, `${pos.name} · 값`);
  const flows = [p.sequence.flow, ...(p.substationSequences ?? []).map((q) => q.flow)].filter((f): f is FlowNode[] => !!f);
  for (const flow of flows) walk(flow, (n) => {
    if (n.kind === 'wait') pushQty(undetermined, assumptions, n.timeout, n.id, `${blockTitle('wait', n.name)} · 타임아웃`);
  });
  for (const s of p.signals) {
    if (!s.address || s.addressStatus === 'unassigned') undetermined.push({ id: s.id, text: `${s.name} · 개념 신호` });
    else if (s.addressStatus === 'assumed') assumptions.push({ id: s.id, text: `${s.name} · 주소 ${s.address} (가정)` });
  }
  p.sequence.unresolved.forEach((line, i) => undetermined.push({ id: `unresolved:${p.sequence.id}:${i}`, text: `${p.sequence.name}: ${line}` }));
  for (const q of p.substationSequences ?? []) q.unresolved.forEach((line, i) => undetermined.push({ id: `unresolved:${q.id}:${i}`, text: `${q.name}: ${line}` }));
  return { memos: [...(p.assumptionsNote ?? [])], undetermined, assumptions };
}

export interface GapLine { id: string; kind: string; judgement: string; title: string; evidence: string }

export function gapRows(p: Project): GapLine[] {
  const word = { shortfall: '부족', undetermined: '미정', candidate: '사람 확인 후보' } as const;
  return analyzeGaps(p).map((g) => ({
    id: g.id,
    kind: GAP_KIND_LABEL[g.kind],
    judgement: word[g.judgement],
    title: g.title,
    evidence: g.evidence,
  }));
}

export function printDate(d = new Date()): string {
  return formatLocalClock(d);
}
