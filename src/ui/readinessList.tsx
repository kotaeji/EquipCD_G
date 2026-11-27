// TURN-093. One checklist of the checks that already exist. No new gate and no new rule.
import { useState } from 'react';
import { checkConditions, type ConditionJump } from '../model/conditionCheck';
import { undefinedFormula } from '../model/conditionFormula';
import { findById } from '../model/flow';
import type { Action, Constraint, FlowNode, Project, SequenceStep } from '../model/types';
import { checkRunReadiness, type Diagnostic } from '../model/validate';
import { flowBlockOwner, resolveBlocker, type BlockerGuide } from './blockerTarget';
import { Problem } from './Problem';
import { blockerProblem, type ProblemCopy } from './problemCopy';
import { TIMEOUT_WARN, timeoutNote } from './timeoutNote';
import type { ItemJump } from './wizard';
import './readiness-list.css';

export interface ReadinessEntry {
  id: string;
  kind: 'block' | 'warn';
  what: string;
  where: string;
  copy: ProblemCopy;
  code?: string;
  blocker?: Diagnostic;
  guide?: BlockerGuide;
  jump?: ItemJump;
  notice?: 'interlock' | 'wait';
}

const place = (...parts: (string | undefined)[]) => parts.filter((part): part is string => !!part).join(' · ');

function stepOf(p: Project, id: string): SequenceStep | undefined {
  const station = p.sequence.steps.find((s) => s.id === id);
  if (station) return station;
  for (const seq of p.substationSequences ?? []) {
    const step = seq.steps.find((s) => s.id === id);
    if (step) return step;
  }
  return undefined;
}

function flowNode(p: Project, id: string): FlowNode | null {
  const flows = [p.sequence.flow, ...(p.substationSequences ?? []).map((seq) => seq.flow)];
  for (const flow of flows) {
    if (!flow) continue;
    const hit = findById(flow, id);
    if (hit) return hit.node;
  }
  return null;
}

function whereAction(p: Project, action: Action, stepName?: string): string {
  const unit = p.units.find((u) => u.id === action.unitId)?.name;
  const device = p.devices.find((d) => d.id === action.deviceId)?.name;
  return place(unit, device, stepName ?? action.name);
}

function whereStep(p: Project, step: SequenceStep): string {
  const action = p.actions.find((a) => a.id === step.actionId);
  return action ? whereAction(p, action, step.name) : step.name;
}

function whereDevice(p: Project, id: string | undefined): string {
  const device = id ? p.devices.find((d) => d.id === id) : undefined;
  if (!device) return '';
  return place(p.units.find((u) => u.id === device.unitId)?.name, device.name);
}

function whereInterlock(p: Project, constraint: Constraint): string {
  const deviceId = constraint.relatedIds.find((id) => p.devices.some((d) => d.id === id));
  return place(whereDevice(p, deviceId), constraint.id);
}

function whereBlocker(p: Project, blocker: Diagnostic): string {
  const step = stepOf(p, blocker.objectId);
  if (step) return whereStep(p, step);
  const action = p.actions.find((a) => a.id === blocker.objectId);
  if (action) return whereAction(p, action);
  const unit = p.units.find((u) => u.id === blocker.objectId);
  if (unit) return unit.name;
  const device = p.devices.find((d) => d.id === blocker.objectId);
  if (device) return whereDevice(p, device.id);
  const material = p.materials.find((m) => m.id === blocker.objectId);
  if (material) return material.name;
  if (blocker.objectId === 'materials') return '자재';
  if (blocker.objectId === p.sequence.id) return p.sequence.name;
  const sub = (p.substationSequences ?? []).find((seq) => seq.id === blocker.objectId);
  if (sub) return sub.name;
  const node = flowNode(p, blocker.objectId);
  if (node) {
    if (node.kind === 'step') {
      const named = stepOf(p, node.stepId);
      return named ? whereStep(p, named) : '';
    }
    if (node.kind === 'substation') return p.units.find((u) => u.id === node.unitId)?.name ?? '';
    return node.name;
  }
  const constraint = p.constraints.find((k) => k.id === blocker.objectId);
  if (constraint) return whereInterlock(p, constraint);
  return '';
}

function actionJump(action: Action, field: string): ItemJump {
  return { step: 'attributes', selectId: action.deviceId, rightTab: 'actions', actionId: action.id, field };
}

function interlockJump(p: Project, id: string): ItemJump {
  const constraint = p.constraints.find((k) => k.id === id);
  const selectId = constraint?.relatedIds.find((rid) => p.devices.some((d) => d.id === rid));
  return { step: 'attributes', selectId, rightTab: 'check', field: `interlock:${id}` };
}

function flowJump(p: Project, id: string): ItemJump {
  const owner = flowBlockOwner(p, id);
  if (owner && owner !== 'station') return { step: 'sequence', sub: 'subseq', selectId: owner.unitId, field: `flow:${id}` };
  return { step: 'sequence', sub: 'sequence', field: `flow:${id}` };
}

function fromCondition(jump: ConditionJump): ItemJump {
  return jump;
}

function warn(id: string, what: string, where: string, copy: ProblemCopy, jump?: ItemJump, notice?: ReadinessEntry['notice']): ReadinessEntry {
  return { id, kind: 'warn', what, where, copy: { ...copy, jump: jump ? '이동' : undefined, jumpAria: jump ? `${what} 이동` : undefined }, jump, notice };
}

/** Blockers from `checkRunReadiness`, then the warnings already produced elsewhere. */
export function readinessEntries(p: Project): ReadinessEntry[] {
  const ready = checkRunReadiness(p);
  const blocks: ReadinessEntry[] = ready.blockers.map((blocker) => {
    const guide = resolveBlocker(p, blocker, ready.blockers);
    const base = blockerProblem(blocker.message, blocker.code, guide);
    const phrase = blocker.code === 'CONDITION_UNDEFINED' ? undefinedFormula(p, blocker.objectId) : '';
    const copy = phrase ? { ...base, why: `${base.why} ${phrase}` } : base;
    return {
      id: blocker.id,
      kind: 'block',
      what: copy.what,
      where: whereBlocker(p, blocker),
      copy,
      code: blocker.code,
      blocker,
      guide,
    };
  });

  const warns: ReadinessEntry[] = [];
  for (const finding of checkConditions(p)) {
    if (finding.level === 'error') continue;
    const jump = fromCondition(finding.jump);
    const where = whereDevice(p, jump.selectId) || finding.where;
    warns.push(warn(finding.id, finding.where, where, {
      tone: finding.level === 'undetermined' ? 'undetermined' : 'assumption',
      what: finding.where,
      why: finding.reason,
      how: finding.formula,
    }, jump));
  }
  for (const action of p.actions) {
    if (timeoutNote(action) !== TIMEOUT_WARN) continue;
    const jump = actionJump(action, `timeout:${action.id}`);
    warns.push(warn(`timeout-short:${action.id}`, action.name, whereAction(p, action), {
      tone: 'error',
      what: action.name,
      why: TIMEOUT_WARN,
      how: '타임아웃을 동작 시간보다 길게 하세요.',
    }, jump));
  }
  const assumed = p.actions.filter((action) => action.duration.value !== null && action.duration.assumption);
  if (assumed.length) {
    const first = assumed[0];
    warns.push(warn('duration-assumed', `가정 상태인 동작 시간 ${assumed.length}개`, whereAction(p, first), {
      tone: 'assumption',
      what: `가정 상태인 동작 시간 ${assumed.length}개`,
      why: '동작 시간 가정값 포함',
      how: '동작 시간 칸에서 가정인지 확인하세요.',
    }, actionJump(first, `duration:${first.id}`)));
  }
  const openInterlocks = p.constraints.filter((k) => k.kind === 'interlock-candidate' && k.confirmation === 'unconfirmed');
  if (openInterlocks.length) {
    const first = openInterlocks[0];
    warns.push(warn('interlock-unconfirmed', `Interlock 후보 미확인 ${openInterlocks.length}개`, whereInterlock(p, first), {
      tone: 'undetermined',
      what: `Interlock 후보 미확인 ${openInterlocks.length}개`,
      why: `Interlock 후보 확인 필요: ${first.description}`,
      how: '속성 점검에서 확인하거나 거절하세요.',
    }, interlockJump(p, first.id)));
  }
  for (const notice of ready.warnings) {
    if (notice.code !== 'INTERLOCK_NO_RULE' && notice.code !== 'INTERLOCK_UNDETERMINED' && notice.code !== 'WAIT_UNREACHABLE') continue;
    const wait = notice.code === 'WAIT_UNREACHABLE';
    const jump = wait ? flowJump(p, notice.objectId) : interlockJump(p, notice.objectId);
    const node = wait ? flowNode(p, notice.objectId) : null;
    const where = wait
      ? (node && node.kind !== 'step' && node.kind !== 'substation' ? node.name : notice.objectId)
      : (p.constraints.find((k) => k.id === notice.objectId) ? whereInterlock(p, p.constraints.find((k) => k.id === notice.objectId)!) : notice.objectId);
    warns.push(warn(notice.id, notice.message, where, {
      tone: 'assumption',
      what: notice.message,
      why: notice.message,
      how: wait ? '이 조건을 바꾸는 단계를 확인하세요.' : '규칙을 확인하세요.',
    }, jump, wait ? 'wait' : 'interlock'));
  }
  return [...blocks, ...warns];
}

/** `차단 2 · 경고 3`. Empty when there is nothing to show. */
export function readinessSummary(entries: readonly ReadinessEntry[]): string {
  const blocks = entries.filter((entry) => entry.kind === 'block').length;
  const warns = entries.length - blocks;
  const parts: string[] = [];
  if (blocks) parts.push(`차단 ${blocks}`);
  if (warns) parts.push(`경고 ${warns}`);
  return parts.join(' · ');
}

export function ReadinessChecklist({ p, onGoBlocker, onGoJump, emphasizeFirst, folded }: {
  p: Project;
  onGoBlocker?: (b: Diagnostic, g: BlockerGuide) => void;
  onGoJump?: (jump: ItemJump) => void;
  emphasizeFirst?: boolean;
  /** Running or scrubbing. The rows stay in the document and are not shown. */
  folded?: boolean;
}) {
  const entries = readinessEntries(p);
  const summary = readinessSummary(entries);
  const blockCount = entries.filter((entry) => entry.kind === 'block').length;
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (id: string) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const go = (entry: ReadinessEntry) => {
    if (entry.kind === 'block' && entry.blocker && entry.guide) onGoBlocker?.(entry.blocker, entry.guide);
    else if (entry.jump) onGoJump?.(entry.jump);
  };
  return (
    <section className="run-readiness" aria-label="준비 검사" data-readiness-folded={folded ? '1' : '0'}>
      <h3>준비 검사</h3>
      {summary
        ? <p className="readiness-summary" data-readiness-summary="">{summary}</p>
        : <p data-readiness="ok">실행 가능</p>}
      <div hidden={!!folded}>
        {blockCount >= 2 && <p className="blocker-remain" data-blocker-remain={blockCount}>남은 차단 {blockCount}개</p>}
        {entries.length > 0 && (
          <div className="readiness-cols" aria-hidden="true">
            <span>종류</span><span>무엇</span><span>어디</span><span>이동</span>
          </div>
        )}
        <ul className="readiness-list">
          {entries.map((entry) => {
            const shown = open.has(entry.id);
            const next = !!emphasizeFirst && entry.kind === 'block' && entry.id === entries.find((row) => row.kind === 'block')?.id;
            return (
              <li
                key={entry.id}
                className={`${entry.kind === 'block' ? 'blocker-item ' : ''}readiness-row${next ? ' is-next' : ''}${shown ? ' is-open' : ''}`}
                data-readiness-kind={entry.kind === 'block' ? 'block' : 'warn'}
                data-readiness-id={entry.id}
                data-guide-kind={entry.guide?.kind}
                data-next-blocker={next ? '1' : undefined}
                data-interlock-notice={entry.notice === 'interlock' ? entry.id.split(':').slice(1).join(':') : undefined}
                data-wait-notice={entry.notice === 'wait' ? entry.id.split(':').slice(1).join(':') : undefined}
                tabIndex={0}
                aria-expanded={shown}
                onClick={(e) => {
                  const target = e.target as HTMLElement;
                  if (target.closest('button') || target.closest('[data-readiness-detail]')) return;
                  toggle(entry.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpen((prev) => {
                      if (!prev.has(entry.id)) return prev;
                      const nextSet = new Set(prev);
                      nextSet.delete(entry.id);
                      return nextSet;
                    });
                    return;
                  }
                  if (e.key === 'Enter' && e.target === e.currentTarget) {
                    e.preventDefault();
                    toggle(entry.id);
                  }
                }}
              >
                <div className="readiness-line">
                  <span className={`readiness-kind ${entry.kind === 'block' ? 'is-block' : 'is-warn'}`}>{entry.kind === 'block' ? '차단' : '경고'}</span>
                  <span className="readiness-what">{entry.what}{entry.code && <span className="mono readiness-code">[{entry.code}]</span>}</span>
                  <span className="readiness-where">{entry.where}</span>
                  {entry.copy.jump && (
                    <button
                      type="button"
                      className="small readiness-jump"
                      aria-label={entry.copy.jumpAria ?? entry.copy.jump}
                      data-blocker-code={entry.kind === 'block' ? entry.code : undefined}
                      data-guide-kind={entry.guide?.kind}
                      data-readiness-jump=""
                      onClick={(e) => { e.stopPropagation(); go(entry); }}
                    >
                      <span className="readiness-jump-full">{entry.copy.jump}</span>
                    </button>
                  )}
                </div>
                <div className="readiness-detail" data-readiness-detail="" hidden={!shown}>
                  <Problem
                    copy={entry.copy}
                    badge={entry.copy.badge}
                    buttonLabel={entry.copy.jump}
                    buttonAria={entry.copy.jumpAria}
                    onJump={entry.copy.jump ? () => go(entry) : undefined}
                    buttonAttrs={entry.kind === 'block' ? { 'data-blocker-code': entry.code, 'data-guide-kind': entry.guide?.kind } : undefined}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
