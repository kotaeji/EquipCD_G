// Read-only "what else is touched" text for delete buttons. Does not change the model.
import type { Condition, FlowNode, Project } from './types';
import { walk } from './flow';

export interface UsageParts {
  steps?: number;
  conditions?: number;
  actions?: number;
  connections?: number;
  flow?: number;
}

/** 「단계 2 · 조건 1에서 쓰임」. Empty when nothing else is involved. */
export function usageText(parts: UsageParts): string | null {
  const bits: string[] = [];
  if (parts.steps) bits.push(`단계 ${parts.steps}`);
  if (parts.conditions) bits.push(`조건 ${parts.conditions}`);
  if (parts.actions) bits.push(`Action ${parts.actions}`);
  if (parts.connections) bits.push(`연결 ${parts.connections}`);
  if (parts.flow) bits.push(`흐름 ${parts.flow}`);
  if (!bits.length) return null;
  return `${bits.join(' · ')}에서 쓰임`;
}

function signalCond(id: string) {
  return (c: Condition) => c.kind === 'signal' && c.signalId === id;
}

function countConds(list: Condition[], hit: (c: Condition) => boolean): number {
  return list.reduce((n, c) => n + (hit(c) ? 1 : 0), 0);
}

function flowHits(flow: FlowNode[] | undefined, stepId: string): number {
  if (!flow) return 0;
  let n = 0;
  walk(flow, (node) => { if (node.kind === 'step' && node.stepId === stepId) n += 1; });
  return n;
}

export function actionUsage(p: Project, id: string): string | null {
  const steps = p.sequence.steps.filter((s) => s.actionId === id).length
    + (p.substationSequences ?? []).reduce((n, q) => n + q.steps.filter((s) => s.actionId === id).length, 0);
  return usageText({ steps });
}

export function actionDeleteDetail(p: Project, id: string): string | null {
  const u = actionUsage(p, id);
  return u ? `${u}. 확인하면 Action과 그 단계가 함께 지워집니다` : null;
}

export function signalUsage(p: Project, id: string): string | null {
  const hit = signalCond(id);
  let conditions = 0;
  let actions = 0;
  for (const a of p.actions) {
    if (a.commandSignalId === id || a.completeSignalId === id) actions += 1;
    conditions += countConds(a.pre, hit) + countConds(a.post, hit);
  }
  for (const s of p.sequence.steps) conditions += countConds(s.entry, hit);
  for (const q of p.substationSequences ?? []) for (const s of q.steps) conditions += countConds(s.entry, hit);
  if (p.sequence.flow) walk(p.sequence.flow, (n) => {
    if (n.kind === 'branch' && hit(n.cond)) conditions += 1;
    if (n.kind === 'retry' && hit(n.until)) conditions += 1;
  });
  for (const q of p.substationSequences ?? []) if (q.flow) walk(q.flow, (n) => {
    if (n.kind === 'branch' && hit(n.cond)) conditions += 1;
    if (n.kind === 'retry' && hit(n.until)) conditions += 1;
  });
  const connections = p.connections.filter((c) => c.from.signalId === id || c.to.signalId === id).length;
  return usageText({ actions, conditions, connections });
}

export function signalDeleteDetail(p: Project, id: string): string | null {
  const u = signalUsage(p, id);
  return u ? `${u}. 확인하면 참조가 풀리고 신호는 지워집니다` : null;
}

export function positionUsage(p: Project, id: string): string | null {
  const actions = p.actions.filter((a) => a.targetPositionId === id);
  const ids = new Set(actions.map((a) => a.id));
  const steps = p.sequence.steps.filter((s) => ids.has(s.actionId)).length
    + (p.substationSequences ?? []).reduce((n, q) => n + q.steps.filter((s) => ids.has(s.actionId)).length, 0);
  if (steps) return usageText({ steps });
  return usageText({ actions: actions.length });
}

export function positionDeleteDetail(p: Project, id: string): string | null {
  const u = positionUsage(p, id);
  return u ? `${u}. 확인하면 목표 참조가 풀리고 Position은 지워집니다` : null;
}

export function stepUsage(p: Project, stepId: string): string | null {
  const station = p.sequence.steps.find((s) => s.id === stepId);
  if (station) return usageText({ conditions: station.entry.length, flow: flowHits(p.sequence.flow, stepId) });
  for (const q of p.substationSequences ?? []) {
    const s = q.steps.find((x) => x.id === stepId);
    if (s) return usageText({ conditions: s.entry.length, flow: flowHits(q.flow, stepId) });
  }
  return null;
}

export function stepDeleteDetail(p: Project, stepId: string): string | null {
  const u = stepUsage(p, stepId);
  return u ? `${u}. 확인하면 단계가 지워집니다` : null;
}

export function subSequenceDeleteDetail(p: Project, seqId: string): string | null {
  const q = (p.substationSequences ?? []).find((x) => x.id === seqId);
  if (!q || q.steps.length === 0) return null;
  return `단계 ${q.steps.length}개 함께 지워짐`;
}
