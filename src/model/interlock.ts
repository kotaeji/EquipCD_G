// Interlock rules (TURN-046). A missing rule is the pre-TURN-046 file.
// Only a confirmed allow or mutex rule is applied by the runtime.
import type { Condition, Constraint, InterlockRule, Project } from './types';

export interface InterlockNotice {
  id: string;
  severity: 'warning';
  code: string;
  objectId: string;
  message: string;
}

export const INTERLOCK_NO_RULE = '확인됨 · 규칙 없음 — 실행에 적용되지 않음';

export function ruleApplies(rule: InterlockRule | undefined): rule is Extract<InterlockRule, { form: 'allow' | 'mutex' }> {
  return !!rule && rule.form !== 'undetermined';
}

/** Confirmed allow / mutex rules, in file order. */
export function applicableInterlocks(p: Project): (Constraint & { rule: Extract<InterlockRule, { form: 'allow' | 'mutex' }> })[] {
  const out: (Constraint & { rule: Extract<InterlockRule, { form: 'allow' | 'mutex' }> })[] = [];
  for (const k of p.constraints) {
    if (k.confirmation !== 'confirmed' || !ruleApplies(k.rule)) continue;
    out.push(k as Constraint & { rule: Extract<InterlockRule, { form: 'allow' | 'mutex' }> });
  }
  return out;
}

function actionName(p: Project, id: string): string {
  return p.actions.find((a) => a.id === id)?.name ?? id;
}

function condText(p: Project, c: Condition): string {
  if (c.kind === 'signal') {
    const sig = p.signals.find((s) => s.id === c.signalId);
    const dev = sig ? p.devices.find((d) => d.id === sig.deviceId) : undefined;
    return `${dev?.name ?? '장치 없음'} · ${sig?.name ?? c.signalId} = ${c.equals ? '참' : '거짓'}`;
  }
  if (c.kind === 'materialAt') return `자재 위치 = ${p.units.find((u) => u.id === c.unitId)?.name ?? c.unitId}`;
  if (c.kind === 'materialState') return `자재 상태 = ${c.state}`;
  if (c.kind === 'materialHeldBy') return `자재 잡음 = ${c.deviceId ? (p.devices.find((d) => d.id === c.deviceId)?.name ?? c.deviceId) : '없음'}`;
  return `미정: ${c.note}`;
}

/** One line a person can read next to the Interlock. */
export function interlockSummary(p: Project, k: Constraint): string {
  const rule = k.rule;
  if (!rule) return '규칙 없음 — 실행에 적용되지 않음';
  if (rule.form === 'undetermined') return `규칙 미정 — ${rule.note}`;
  const act = actionName(p, rule.actionId);
  if (rule.form === 'mutex') return `${act} — 동시 금지: ${actionName(p, rule.otherActionId)} 진행 중에는 시작하지 않음`;
  const conds = rule.conditions.map((c) => condText(p, c)).join(', ') || '조건 없음';
  return `${act} — 허용 조건: ${conds}`;
}

/** Devices the rule mentions. Used so the Interlock still shows on those devices. */
export function devicesOfRule(p: Project, rule: InterlockRule): string[] {
  if (rule.form === 'undetermined') return [];
  const ids = new Set<string>();
  const take = (actionId: string) => {
    const a = p.actions.find((x) => x.id === actionId);
    if (a) ids.add(a.deviceId);
  };
  take(rule.actionId);
  if (rule.form === 'mutex') take(rule.otherActionId);
  if (rule.form === 'allow') {
    for (const c of rule.conditions) {
      if (c.kind === 'signal') {
        const s = p.signals.find((x) => x.id === c.signalId);
        if (s) ids.add(s.deviceId);
      }
      if (c.kind === 'materialHeldBy' && c.deviceId) ids.add(c.deviceId);
    }
  }
  return [...ids];
}

/**
 * Notice, not a blocker. A confirmed Interlock with no usable rule does not stop a run.
 * `undetermined` uses its own sentence so the no-rule phrase stays exact.
 */
export function interlockNotices(p: Project): InterlockNotice[] {
  const out: InterlockNotice[] = [];
  for (const k of p.constraints) {
    if (k.kind !== 'interlock-candidate' || k.confirmation !== 'confirmed') continue;
    if (!k.rule) {
      out.push({
        id: `INTERLOCK_NO_RULE:${k.id}`, severity: 'warning', code: 'INTERLOCK_NO_RULE', objectId: k.id,
        message: `${k.id}: ${INTERLOCK_NO_RULE}`,
      });
    } else if (k.rule.form === 'undetermined') {
      out.push({
        id: `INTERLOCK_UNDETERMINED:${k.id}`, severity: 'warning', code: 'INTERLOCK_UNDETERMINED', objectId: k.id,
        message: `${k.id}: 확인됨 · 규칙 미정 — 실행에 적용되지 않음 (${k.rule.note})`,
      });
    }
  }
  return out;
}

export interface GoneRefs {
  actionIds?: ReadonlySet<string>;
  signalIds?: ReadonlySet<string>;
  deviceIds?: ReadonlySet<string>;
  unitIds?: ReadonlySet<string>;
}

function conditionBroken(c: Condition, gone: GoneRefs): boolean {
  if (c.kind === 'signal' && gone.signalIds?.has(c.signalId)) return true;
  if (c.kind === 'materialAt' && gone.unitIds?.has(c.unitId)) return true;
  if (c.kind === 'materialHeldBy' && c.deviceId && gone.deviceIds?.has(c.deviceId)) return true;
  return false;
}

/** Drop a rule that pointed at a deleted Action or Signal. The rule becomes 미정 and keeps no id. */
export function releaseBrokenInterlocks(p: Project, gone: GoneRefs): void {
  const actionGone = (id: string) => !!gone.actionIds?.has(id);
  for (const k of p.constraints) {
    const rule = k.rule;
    if (!rule || rule.form === 'undetermined') continue;
    if (rule.form === 'mutex') {
      if (actionGone(rule.actionId) || actionGone(rule.otherActionId)) {
        k.rule = { form: 'undetermined', note: '대상 Action이 삭제되어 규칙을 풀었습니다' };
      }
      continue;
    }
    if (actionGone(rule.actionId)) {
      k.rule = { form: 'undetermined', note: '대상 Action이 삭제되어 규칙을 풀었습니다' };
      continue;
    }
    if (rule.conditions.some((c) => conditionBroken(c, gone))) {
      k.rule = { form: 'undetermined', note: '조건의 Signal이 삭제되어 규칙을 풀었습니다' };
    }
  }
}
