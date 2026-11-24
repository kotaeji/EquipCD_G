// Condition diagnosis (TURN-052). Reads the model only. Does not block a run.
// The same model returns the same findings in the same order.
import { armLabel, armLists, branchArms, walk } from './flow';
import { conditionFormula, conditionsFormula, signalHead, stepById } from './conditionFormula';
import type { Condition, FlowNode, Project, SequenceStep } from './types';

export type ConditionLevel = 'error' | 'undetermined' | 'info';
export type ConditionKind = 'broken' | 'alwaysFalse' | 'overlap' | 'undetermined' | 'opposite' | 'unreachable' | 'emptyArm';

export interface ConditionJump {
  step: 'attributes' | 'sequence';
  sub?: string;
  selectId?: string;
  rightTab?: string;
  actionId?: string;
  field: string;
}

export interface ConditionFinding {
  id: string;
  level: ConditionLevel;
  kind: ConditionKind;
  /** Primary place. Marks also look at `sites`. */
  site: string;
  sites: string[];
  where: string;
  formula: string;
  reason: string;
  jump: ConditionJump;
}

const RANK: Record<ConditionLevel, number> = { error: 3, undetermined: 2, info: 1 };

const cache = new WeakMap<Project, ConditionFinding[]>();

/** Cached by project object. An edit replaces the project, so the cache stays honest. */
export function findingsOf(p: Project): ConditionFinding[] {
  let hit = cache.get(p);
  if (!hit) {
    hit = checkConditions(p);
    cache.set(p, hit);
  }
  return hit;
}

export function levelAt(findings: readonly ConditionFinding[], site: string): ConditionLevel | null {
  let best: ConditionLevel | null = null;
  for (const f of findings) {
    if (!f.sites.includes(site)) continue;
    if (!best || RANK[f.level] > RANK[best]) best = f.level;
  }
  return best;
}

function condKey(c: Condition): string {
  switch (c.kind) {
    case 'signal': return `signal:${c.signalId}:${c.equals ? 1 : 0}`;
    case 'materialAt': return `at:${c.unitId}`;
    case 'materialState': return `st:${c.state}`;
    case 'materialHeldBy': return `held:${c.deviceId ?? ''}`;
    case 'materialType': return `type:${c.materialId}`;
    case 'undefined': return `undef:${c.note}`;
  }
}

function knownStates(p: Project): Set<string> {
  const states = new Set<string>();
  for (const m of p.materials) for (const st of m.states) states.add(st);
  return states;
}

interface Site {
  key: string;
  where: string;
  list: Condition[];
  jump: ConditionJump;
  /** Marks also look here. Defaults to `[key]`. */
  sites?: string[];
}

function actionJump(p: Project, actionId: string, field: string): ConditionJump {
  const action = p.actions.find((a) => a.id === actionId);
  return {
    step: 'attributes',
    selectId: action?.deviceId,
    rightTab: 'actions',
    actionId,
    field,
  };
}

function flowJump(blockId: string): ConditionJump {
  return { step: 'sequence', sub: 'sequence', field: `flow:${blockId}` };
}

function entryJump(p: Project, step: SequenceStep): ConditionJump {
  const sub = (p.substationSequences ?? []).some((q) => q.steps.some((s) => s.id === step.id));
  return { step: 'sequence', sub: sub ? 'subseq' : 'sequence', field: `step:${step.id}` };
}

function sitesOf(p: Project): Site[] {
  const out: Site[] = [];
  for (const a of p.actions) {
    if (a.pre.length) out.push({ key: `action:${a.id}:pre`, where: `Action ${a.name} 사전조건`, list: a.pre, jump: actionJump(p, a.id, `pre:${a.id}`) });
    if (a.post.length) out.push({ key: `action:${a.id}:post`, where: `Action ${a.name} 완료조건`, list: a.post, jump: actionJump(p, a.id, `post:${a.id}`) });
  }
  const pushEntry = (step: SequenceStep) => {
    if (!step.entry.length) return;
    out.push({ key: `step:${step.id}:entry`, where: `단계 ${step.name} 진입 조건`, list: step.entry, jump: entryJump(p, step) });
  };
  for (const step of p.sequence.steps) pushEntry(step);
  for (const seq of p.substationSequences ?? []) for (const step of seq.steps) pushEntry(step);
  const flow = p.sequence.flow;
  if (flow) {
    walk(flow, (n) => {
      if (n.kind === 'branch') {
        const arms = branchArms(n);
        arms.forEach((arm, index) => {
          if (!arm.cond) return;
          const multi = arms.length > 2;
          const key = index === 0 ? `flow:${n.id}` : `flow:${n.id}:arm:${index}`;
          out.push({
            key,
            where: multi ? `분기 ${n.name} ${armLabel(arms.length, index)}` : `분기 ${n.name}`,
            list: [arm.cond],
            jump: multi ? { step: 'sequence', sub: 'sequence', field: `flow:${n.id}:arm:${index}` } : flowJump(n.id),
            sites: !multi ? undefined : index === 0 ? [`flow:${n.id}`, `flow:${n.id}:arm:0`] : [`flow:${n.id}:arm:${index}`],
          });
        });
      }
      else if (n.kind === 'retry') out.push({ key: `flow:${n.id}`, where: `재시도 ${n.name}`, list: [n.until], jump: flowJump(n.id) });
      else if (n.kind === 'wait') out.push({ key: `flow:${n.id}`, where: `신호 기다림 ${n.name}`, list: [n.cond], jump: flowJump(n.id) });
    });
  }
  for (const k of p.constraints) {
    if (k.rule?.form !== 'allow' || k.rule.conditions.length === 0) continue;
    const dev = k.relatedIds.find((id) => p.devices.some((d) => d.id === id));
    out.push({
      key: `interlock:${k.id}`,
      where: `Interlock ${k.id}`,
      list: k.rule.conditions,
      jump: { step: 'attributes', selectId: dev, rightTab: 'check', field: `interlock:${k.id}` },
    });
  }
  return out;
}

function bundleFindings(p: Project, site: Site, states: Set<string>): ConditionFinding[] {
  const out: ConditionFinding[] = [];
  const formula = conditionsFormula(p, site.list);
  const push = (kind: ConditionKind, level: ConditionLevel, id: string, reason: string) => {
    out.push({ id, level, kind, site: site.key, sites: site.sites ?? [site.key], where: site.where, formula, reason, jump: site.jump });
  };
  site.list.forEach((c, i) => {
    if (c.kind === 'signal' && !p.signals.some((s) => s.id === c.signalId)) {
      push('broken', 'error', `broken:${site.key}:signal:${i}`, `끊긴 참조 — 없는 신호 ${c.signalId}`);
    } else if (c.kind === 'materialAt' && !p.units.some((u) => u.id === c.unitId)) {
      push('broken', 'error', `broken:${site.key}:unit:${i}`, `끊긴 참조 — 없는 Unit ${c.unitId}`);
    } else if (c.kind === 'materialHeldBy' && c.deviceId && !p.devices.some((d) => d.id === c.deviceId)) {
      push('broken', 'error', `broken:${site.key}:device:${i}`, `끊긴 참조 — 없는 Device ${c.deviceId}`);
    } else if (c.kind === 'materialState' && !states.has(c.state)) {
      push('broken', 'error', `broken:${site.key}:state:${i}`, `끊긴 참조 — 자재 상태 「${c.state}」가 자재 정의에 없습니다`);
    } else if (c.kind === 'materialType' && !p.materials.some((m) => m.id === c.materialId)) {
      push('broken', 'error', `broken:${site.key}:type:${i}`, `끊긴 참조 — 없는 자재 종류 ${c.materialId}`);
    }
  });
  const on = new Map<string, boolean>();
  const off = new Map<string, boolean>();
  const places = new Map<string, string>();
  const statesSeen: string[] = [];
  const units: string[] = [];
  const holders: string[] = [];
  const types: string[] = [];
  for (const c of site.list) {
    if (c.kind === 'signal') {
      (c.equals ? on : off).set(c.signalId, true);
      if (!places.has(c.signalId)) places.set(c.signalId, signalHead(p, c.signalId));
    } else if (c.kind === 'materialAt' && !units.includes(c.unitId)) units.push(c.unitId);
    else if (c.kind === 'materialState' && !statesSeen.includes(c.state)) statesSeen.push(c.state);
    else if (c.kind === 'materialHeldBy') {
      const key = c.deviceId ?? '';
      if (!holders.includes(key)) holders.push(key);
    } else if (c.kind === 'materialType' && !types.includes(c.materialId)) types.push(c.materialId);
  }
  for (const id of places.keys()) {
    if (on.has(id) && off.has(id)) {
      push('alwaysFalse', 'error', `false:${site.key}:signal:${id}`, `항상 거짓 — ${places.get(id)} 를 ON 과 OFF 로 함께 요구합니다`);
    }
  }
  if (types.length > 1) {
    push('alwaysFalse', 'error', `false:${site.key}:type`, '항상 거짓 — 자재 종류를 두 가지 이상으로 함께 요구합니다');
  }
  if (units.length > 1) {
    const names = units.map((id) => p.units.find((u) => u.id === id)?.name ?? id);
    push('alwaysFalse', 'error', `false:${site.key}:at`, `항상 거짓 — 자재 위치를 ${names.join(' · ')} 로 함께 요구합니다`);
  }
  if (statesSeen.length > 1) {
    push('alwaysFalse', 'error', `false:${site.key}:state`, `항상 거짓 — 자재 상태를 ${statesSeen.join(' · ')} 로 함께 요구합니다`);
  }
  if (holders.length > 1) {
    const names = holders.map((id) => (id ? (p.devices.find((d) => d.id === id)?.name ?? id) : '없음'));
    push('alwaysFalse', 'error', `false:${site.key}:held`, `항상 거짓 — 잡은 Device 를 ${names.join(' · ')} 로 함께 요구합니다`);
  }
  const seen = new Map<string, number>();
  for (const c of site.list) seen.set(condKey(c), (seen.get(condKey(c)) ?? 0) + 1);
  const reported = new Set<string>();
  for (const c of site.list) {
    const key = condKey(c);
    if ((seen.get(key) ?? 0) < 2 || reported.has(key)) continue;
    reported.add(key);
    push('overlap', 'info', `overlap:${site.key}:${key}`, `겹침 — 같은 조건이 두 번 있습니다 (${conditionFormula(p, c)})`);
  }
  site.list.forEach((c, i) => {
    if (c.kind !== 'undefined') return;
    push('undetermined', 'undetermined', `undef:${site.key}:${i}`, '미정 — 미정 조건은 참으로 치지 않아 이 자리는 통과하지 못합니다');
  });
  return out;
}

function stepsUnder(p: Project, nodes: FlowNode[]): SequenceStep[] {
  const out: SequenceStep[] = [];
  const rec = (list: FlowNode[]) => {
    for (const n of list) {
      if (n.kind === 'step') {
        const step = stepById(p, n.stepId);
        if (step) out.push(step);
      } else if (n.kind === 'branch') armLists(n).forEach(rec);
      else if (n.kind === 'parallel') n.lanes.forEach(rec);
      else if (n.kind === 'loop' || n.kind === 'retry') rec(n.body);
    }
  };
  rec(nodes);
  return out;
}

function oppositeFindings(p: Project): ConditionFinding[] {
  const flow = p.sequence.flow;
  if (!flow) return [];
  const out: ConditionFinding[] = [];
  walk(flow, (n) => {
    if (n.kind !== 'parallel') return;
    const lanes = n.lanes.map((lane) => stepsUnder(p, lane));
    const seen = new Set<string>();
    lanes.forEach((steps) => {
      for (const step of steps) {
        const action = p.actions.find((a) => a.id === step.actionId);
        if (!action) continue;
        for (const c of action.pre) {
          if (c.kind !== 'signal' || seen.has(c.signalId)) continue;
          const ons: { lane: number; step: SequenceStep }[] = [];
          const offs: { lane: number; step: SequenceStep }[] = [];
          lanes.forEach((group, index) => {
            for (const other of group) {
              const otherAction = p.actions.find((a) => a.id === other.actionId);
              if (!otherAction) continue;
              for (const cond of otherAction.pre) {
                if (cond.kind !== 'signal' || cond.signalId !== c.signalId) continue;
                (cond.equals ? ons : offs).push({ lane: index, step: other });
              }
            }
          });
          seen.add(c.signalId);
          const on = ons[0];
          const off = offs.find((row) => row.lane !== on?.lane);
          if (!on || !off) continue;
          const onFormula = conditionFormula(p, { kind: 'signal', signalId: c.signalId, equals: true });
          const offFormula = conditionFormula(p, { kind: 'signal', signalId: c.signalId, equals: false });
          const site = `parallel:${n.id}`;
          out.push({
            id: `opposite:${n.id}:${c.signalId}`,
            level: 'info',
            kind: 'opposite',
            site,
            sites: [site, `action:${on.step.actionId}:pre`, `action:${off.step.actionId}:pre`, `flow:${n.id}`],
            where: `병렬 ${n.name} · ${on.step.name} / ${off.step.name}`,
            formula: `${onFormula} 그리고 ${offFormula}`,
            reason: `동시에 만족되지 않을 수 있음 — ${on.step.name} 은 ${onFormula}, ${off.step.name} 은 ${offFormula}`,
            jump: actionJump(p, on.step.actionId, `pre:${on.step.actionId}`),
          });
        }
      }
    });
  });
  return out;
}

/** A later arm repeats an earlier arm's condition, so the first true arm always wins. */
function unreachableFindings(p: Project): ConditionFinding[] {
  const flow = p.sequence.flow;
  if (!flow) return [];
  const out: ConditionFinding[] = [];
  walk(flow, (n) => {
    if (n.kind !== 'branch') return;
    const arms = branchArms(n);
    if (arms.length < 3) return;
    const prior = new Map<string, number>();
    arms.forEach((arm, index) => {
      if (!arm.cond || arm.cond.kind === 'undefined') return;
      const key = condKey(arm.cond);
      const first = prior.get(key);
      if (first === undefined) { prior.set(key, index); return; }
      const site = `flow:${n.id}:arm:${index}`;
      out.push({
        id: `unreachable:${n.id}:${index}`,
        level: 'info',
        kind: 'unreachable',
        site,
        sites: [site],
        where: `분기 ${n.name} ${armLabel(arms.length, index)}`,
        formula: conditionFormula(p, arm.cond),
        reason: `도달하지 않음 — ${armLabel(arms.length, first)} 과 같은 조건이라 앞에서 먼저 갈라집니다`,
        jump: { step: 'sequence', sub: 'sequence', field: site },
      });
    });
  });
  return out;
}

/** An empty arm is not a run block. The branch just passes through it. */
function emptyArmFindings(p: Project): ConditionFinding[] {
  const flow = p.sequence.flow;
  if (!flow) return [];
  const out: ConditionFinding[] = [];
  walk(flow, (n) => {
    if (n.kind !== 'branch') return;
    const arms = branchArms(n);
    arms.forEach((arm, index) => {
      if (arm.body.length > 0) return;
      const label = armLabel(arms.length, index);
      const site = `flow:${n.id}:arm:${index}`;
      out.push({
        id: `empty-arm:${n.id}:${index}`,
        level: 'info',
        kind: 'emptyArm',
        site,
        sites: [site],
        where: `분기 ${n.name} ${label}`,
        formula: arm.cond ? conditionFormula(p, arm.cond) : label,
        reason: '빈 갈래 — 줄이 없어 이 갈래는 그냥 지나갑니다',
        jump: { step: 'sequence', sub: 'sequence', field: site },
      });
    });
  });
  return out;
}

/** Every condition site, then opposite lanes, then unreachable and empty arms. Order is file order. */
export function checkConditions(p: Project): ConditionFinding[] {
  const states = knownStates(p);
  const out: ConditionFinding[] = [];
  for (const site of sitesOf(p)) out.push(...bundleFindings(p, site, states));
  out.push(...oppositeFindings(p));
  out.push(...unreachableFindings(p));
  out.push(...emptyArmFindings(p));
  return out;
}
