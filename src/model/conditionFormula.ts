// One line for a condition, shared by the screens. The runtime log keeps flow.conditionText.
import { findById } from './flow';
import type { Condition, Project, SequenceStep } from './types';

export function stepById(p: Project, id: string): SequenceStep | undefined {
  return p.sequence.steps.find((s) => s.id === id)
    ?? (p.substationSequences ?? []).flatMap((q) => q.steps).find((s) => s.id === id);
}

function bit(equals: boolean): 'ON' | 'OFF' {
  return equals ? 'ON' : 'OFF';
}

/** Device and port, without the ON / OFF. Missing pieces stay readable. */
export function signalHead(p: Project, signalId: string): string {
  const sig = p.signals.find((s) => s.id === signalId);
  if (!sig) return `없는 신호 ${signalId}`;
  const dev = p.devices.find((d) => d.id === sig.deviceId);
  const devName = dev?.name ?? '장치 없음';
  const port = sig.portKey ?? (sig.name.startsWith(`${devName}.`) ? sig.name.slice(devName.length + 1) : sig.name);
  return `${devName}.${port}`;
}

/** One condition. The same value always returns the same line. */
export function conditionFormula(p: Project, c: Condition): string {
  switch (c.kind) {
    case 'signal': return `${signalHead(p, c.signalId)} = ${bit(c.equals)}`;
    case 'materialAt': {
      const unit = p.units.find((u) => u.id === c.unitId);
      return `자재 위치 = ${unit?.name ?? `없는 Unit ${c.unitId}`}`;
    }
    case 'materialState': return `자재 상태 = ${c.state}`;
    case 'materialHeldBy': {
      if (!c.deviceId) return '자재 잡음 = 없음';
      const dev = p.devices.find((d) => d.id === c.deviceId);
      return `자재 잡음 = ${dev?.name ?? `없는 Device ${c.deviceId}`}`;
    }
    case 'undefined': return `미정(${c.note})`;
  }
}

/** A bundle that must all be true. Empty is an empty line. */
export function conditionsFormula(p: Project, list: readonly Condition[]): string {
  return list.map((c) => conditionFormula(p, c)).join(' 그리고 ');
}

/**
 * Condition text on a step row.
 * A signal-wait row uses the block condition. Any other step uses its Action pre and entry.
 */
export function shownStepCondition(p: Project, stepId: string): string | null {
  const hit = p.sequence.flow ? findById(p.sequence.flow, stepId) : null;
  if (hit?.node.kind === 'wait') return conditionFormula(p, hit.node.cond);
  const step = stepById(p, stepId);
  if (!step) return null;
  const action = p.actions.find((a) => a.id === step.actionId);
  const list = [...(action?.pre ?? []), ...step.entry];
  return list.length ? conditionsFormula(p, list) : null;
}

/** Undefined conditions owned by a step or a flow block. Used on a readiness row. */
export function undefinedFormula(p: Project, objectId: string): string {
  const bits: Condition[] = [];
  const step = stepById(p, objectId);
  if (step) {
    const action = p.actions.find((a) => a.id === step.actionId);
    for (const c of [...(action?.pre ?? []), ...(action?.post ?? []), ...step.entry]) {
      if (c.kind === 'undefined') bits.push(c);
    }
  }
  const hit = p.sequence.flow ? findById(p.sequence.flow, objectId) : null;
  const node = hit?.node;
  const cond = node?.kind === 'branch' || node?.kind === 'wait' ? node.cond : node?.kind === 'retry' ? node.until : null;
  if (cond?.kind === 'undefined') bits.push(cond);
  return conditionsFormula(p, bits);
}

/** Formula for a run-stop message. Empty when this stop is not a condition. */
export function runBlockFormula(p: Project, code: string, stepId: string | null, interlockConditions?: readonly Condition[]): string {
  if ((code === 'PRE_UNMET' || code === 'POST_UNMET') && stepId) {
    const step = stepById(p, stepId);
    const action = step ? p.actions.find((a) => a.id === step.actionId) : undefined;
    if (!step || !action) return '';
    const list = code === 'PRE_UNMET' ? [...action.pre, ...step.entry] : action.post;
    return conditionsFormula(p, list);
  }
  if (code === 'WAIT_TIMEOUT' && stepId) {
    const hit = p.sequence.flow ? findById(p.sequence.flow, stepId) : null;
    return hit?.node.kind === 'wait' ? conditionFormula(p, hit.node.cond) : '';
  }
  if (code === 'INTERLOCK_BLOCK' && interlockConditions) return conditionsFormula(p, interlockConditions);
  return '';
}
