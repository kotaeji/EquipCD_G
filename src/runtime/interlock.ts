// Decide whether a confirmed Interlock stops a step that is about to start.
// Allow failures are errors. Mutex in a concurrent run waits; otherwise it errors.
// Callers pass condition evaluation so this file does not import the engine.
import { applicableInterlocks } from '../model/interlock';
import type { Condition, Project } from '../model/types';

export interface InterlockHit {
  interlockId: string;
  description: string;
  stepName: string;
  reason: string;
  message: string;
}

export interface InterlockWait {
  interlockId: string;
  otherActionId: string;
  note: string;
  unitId: string;
}

export interface InterlockBlockRecord {
  t: number;
  interlockId: string;
  description: string;
  stepId: string;
  stepName: string;
  reason: string;
}

export type InterlockGate =
  | { kind: 'go' }
  | { kind: 'block'; hit: InterlockHit }
  | { kind: 'wait'; wait: InterlockWait };

type Verdict = { ok: boolean; why: string; sensor: boolean };

function named(p: Project, actionId: string): string {
  return p.actions.find((a) => a.id === actionId)?.name ?? actionId;
}

/**
 * Rules that name `actionId`, confirmed and fully specified.
 * Allow is judged before mutex: an allow failure cannot be waited out.
 * Within one form, constraint order wins. The same model always picks the same rule.
 */
export function judgeInterlock(
  p: Project,
  actionId: string,
  stepName: string,
  activeActionIds: readonly string[],
  concurrent: boolean,
  evalOne: (c: Condition) => Verdict,
  unmet: (r: Verdict) => string,
): InterlockGate {
  const rules = applicableInterlocks(p).filter((k) => k.rule.actionId === actionId);
  for (const k of rules) {
    if (k.rule.form !== 'allow') continue;
    const bad = k.rule.conditions.map((c) => evalOne(c)).filter((r) => !r.ok);
    if (!bad.length) continue;
    const reason = `거짓: ${bad.map((r) => unmet(r)).join(', ')}`;
    return {
      kind: 'block',
      hit: {
        interlockId: k.id, description: k.description, stepName, reason,
        message: `[${stepName}] Interlock ${k.id} 차단 — ${k.description} — ${reason}`,
      },
    };
  }
  for (const k of rules) {
    if (k.rule.form !== 'mutex') continue;
    if (!activeActionIds.includes(k.rule.otherActionId)) continue;
    const other = named(p, k.rule.otherActionId);
    if (concurrent) {
      const action = p.actions.find((a) => a.id === actionId);
      const unitId = action ? (p.devices.find((d) => d.id === action.deviceId)?.unitId ?? action.unitId) : '';
      return {
        kind: 'wait',
        wait: {
          interlockId: k.id,
          otherActionId: k.rule.otherActionId,
          note: `Interlock ${k.id} — ${other} 진행 중`,
          unitId,
        },
      };
    }
    const reason = `진행 중: ${other}`;
    return {
      kind: 'block',
      hit: {
        interlockId: k.id, description: k.description, stepName, reason,
        message: `[${stepName}] Interlock ${k.id} 차단 — ${k.description} — ${reason}`,
      },
    };
  }
  return { kind: 'go' };
}
