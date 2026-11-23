// Station sequence flow editor (TURN-022, names and moves in TURN-023). Blocks are indented and named in words, not by color alone.
import { useEffect, useState } from 'react';
import * as C from '../model/commands';
import { armLabel, branchArms, MAX_BRANCH_ARMS } from '../model/flow';
import type { Condition, FlowNode, Project } from '../model/types';
import { DEFAULT_MAX_RETRIES } from '../model/types';
import type { RuntimeState } from '../runtime/engine';
import { aggregateStepStatus } from '../runtime/runSummary';
import { StatusMark } from './StatusMark';
import { phaseShape } from './status';
import type { EditFn } from './Inspector';
import { stepLiveClass } from './RunSummary';
import { conditionFormula } from '../model/conditionFormula';
import { ConditionMark } from './conditionMark';
import { condLabel, devName, flowBlockTitle, flowBlockWord, signalChoiceLabel, unitName, type FlowBlockKind } from './labels';
import { Terms } from './Term';
import { IconLabel } from './Icon';
import { Clip, ECD_TABLE } from './dataTable';

type Arm = 'then' | 'else' | 'body' | number;

interface Row {
  key: string;
  depth: number;
  kind: 'step' | 'branch' | 'parallel' | 'loop' | 'retry' | 'wait' | 'substation' | 'arm';
  title: string;
  stepId?: string;
  blockId?: string;
  arm?: Arm;
  armOf?: 'branch' | 'parallel';
  armCount?: number;
  /** Set on a multi-way arm. Null is 「그 밖」. Omitted on a two-arm branch, which keeps the condition on the header. */
  armCond?: Condition | null;
  node?: FlowNode;
}

function flatten(p: Project, nodes: FlowNode[], depth: number): Row[] {
  const out: Row[] = [];
  for (const n of nodes) {
    if (n.kind === 'step') {
      const step = p.sequence.steps.find((s) => s.id === n.stepId);
      out.push({ key: n.stepId, depth, kind: 'step', title: step?.name ?? n.stepId, stepId: n.stepId });
      continue;
    }
    if (n.kind === 'branch') {
      const arms = branchArms(n);
      out.push({ key: n.id, depth, kind: 'branch', title: flowBlockWord('branch'), blockId: n.id, node: n, armCount: arms.length });
      arms.forEach((arm, i) => {
        out.push({
          key: `${n.id}:arm${i}`,
          depth: depth + 1,
          kind: 'arm',
          title: armLabel(arms.length, i),
          blockId: n.id,
          arm: i,
          armOf: 'branch',
          armCount: arms.length,
          armCond: arms.length > 2 ? arm.cond : undefined,
        });
        out.push(...flatten(p, arm.body, depth + 2));
      });
    } else if (n.kind === 'parallel') {
      out.push({ key: n.id, depth, kind: 'parallel', title: flowBlockWord('parallel'), blockId: n.id, node: n });
      n.lanes.forEach((lane, i) => {
        out.push({ key: `${n.id}:lane${i}`, depth: depth + 1, kind: 'arm', title: `갈래 ${i + 1}`, blockId: n.id, arm: i, armOf: 'parallel' });
        out.push(...flatten(p, lane, depth + 2));
      });
    } else if (n.kind === 'loop') {
      out.push({ key: n.id, depth, kind: 'loop', title: flowBlockWord('loop'), blockId: n.id, node: n });
      out.push(...flatten(p, n.body, depth + 1));
    } else if (n.kind === 'retry') {
      out.push({ key: n.id, depth, kind: 'retry', title: flowBlockWord('retry'), blockId: n.id, node: n });
      out.push(...flatten(p, n.body, depth + 1));
    } else if (n.kind === 'wait') {
      out.push({ key: n.id, depth, kind: 'wait', title: flowBlockWord('wait'), blockId: n.id, node: n });
    } else {
      const unit = p.units.find((u) => u.id === n.unitId);
      out.push({ key: n.id, depth, kind: 'substation', title: `Substation ${unit?.name ?? n.unitId}`, blockId: n.id, node: n });
    }
  }
  return out;
}

function condValue(c: Condition): string {
  if (c.kind === 'signal') return `sig:${c.signalId}:${c.equals ? '1' : '0'}`;
  if (c.kind === 'materialState') return `st:${c.state}`;
  if (c.kind === 'materialAt') return `at:${c.unitId}`;
  return 'undef';
}

function condFrom(value: string): Condition {
  if (value.startsWith('sig:')) {
    const [, id, bit] = value.split(':');
    return { kind: 'signal', signalId: id, equals: bit === '1' };
  }
  if (value.startsWith('st:')) return { kind: 'materialState', state: value.slice(3) };
  if (value.startsWith('at:')) return { kind: 'materialAt', unitId: value.slice(3) };
  return { kind: 'undefined', note: '조건 없음' };
}

function CondSelect({ p, cond, disabled, onChange, label = '조건' }: { p: Project; cond: Condition; disabled: boolean; onChange: (c: Condition) => void; label?: string }) {
  const states = p.materials[0]?.states ?? [];
  return <select aria-label={label} disabled={disabled} value={condValue(cond)} onChange={(e) => onChange(condFrom(e.target.value))} style={{ maxWidth: 280 }}>
    <option value="undef">조건 없음</option>
    {p.signals.map((s) => <option key={`${s.id}:1`} value={`sig:${s.id}:1`}>{signalChoiceLabel(p, s.id, true)}</option>)}
    {p.signals.map((s) => <option key={`${s.id}:0`} value={`sig:${s.id}:0`}>{signalChoiceLabel(p, s.id, false)}</option>)}
    {states.map((st) => <option key={st} value={`st:${st}`}>자재 상태 = {st}</option>)}
    {p.units.map((u) => <option key={u.id} value={`at:${u.id}`}>자재 위치 = {u.name}</option>)}
  </select>;
}

function isBlockKind(kind: Row['kind']): kind is FlowBlockKind {
  return kind === 'branch' || kind === 'parallel' || kind === 'loop' || kind === 'retry' || kind === 'wait';
}

function nodeIdOf(row: Row): string | null {
  if (row.kind === 'arm') return null;
  if (row.kind === 'step') return row.stepId ?? null;
  return row.blockId ?? null;
}

function BlockName({ name, word, disabled, onCommit }: { name: string; word: string; disabled: boolean; onCommit: (v: string) => boolean }) {
  const [v, setV] = useState(name);
  useEffect(() => setV(name), [name]);
  const commit = () => {
    const next = v.trim();
    if (next === name) { setV(name); return; }
    if (!onCommit(v)) setV(name);
  };
  return <input aria-label={`${word} 이름`} value={v} disabled={disabled} style={{ width: 140, marginLeft: 'var(--sp-1)' }}
    onChange={(e) => setV(e.target.value)} onBlur={commit}
    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
}

function statusOf(rt: RuntimeState | null, stepId: string) {
  return aggregateStepStatus(rt?.steps.filter((r) => r.stepId === stepId) ?? []);
}

export function FlowEditor({ p, rt, locked, edit, picked, onPicked }: {
  p: Project;
  rt: RuntimeState | null;
  locked: boolean;
  edit: EditFn;
  /** Controlled row checkboxes. Omit to keep the selection inside this table. */
  picked?: string[];
  onPicked?: (ids: string[]) => void;
}) {
  const [innerPicked, setInnerPicked] = useState<string[]>([]);
  const pickedIds = picked ?? innerPicked;
  const setPicked = (next: string[] | ((cur: string[]) => string[])) => {
    const value = typeof next === 'function' ? next(pickedIds) : next;
    if (onPicked) onPicked(value);
    else setInnerPicked(value);
  };
  const [unitId, setUnitId] = useState(p.units[0]?.id ?? '');
  const nodes = p.sequence.flow ?? p.sequence.steps.map((s) => ({ kind: 'step' as const, stepId: s.id }));
  const rows = flatten(p, nodes, 0);
  const toggle = (id: string) => setPicked((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  const selected = rows.map(nodeIdOf).filter((id): id is string => !!id && pickedIds.includes(id));
  const wrap = (kind: C.WrapKind, label: string) => {
    if (edit(C.wrapFlow(p, selected, kind), label)) setPicked([]);
  };
  const onKey = (e: React.KeyboardEvent<HTMLTableRowElement>, row: Row) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const id = nodeIdOf(row);
    if (!id) return;
    if (e.key === ' ' && tag !== 'BUTTON' && !locked) { e.preventDefault(); toggle(id); }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && p.sequence.flow) {
      e.preventDefault();
      const up = e.key === 'ArrowUp';
      const what = row.kind === 'step' ? '단계' : '블록';
      edit(C.moveFlowNode(p, id, up ? -1 : 1), up ? `${what} 위로` : `${what} 아래로`);
    }
  };
  return <div>
    <div className="row wrap" style={{ gap: 'var(--sp-1)', marginBottom: 'var(--sp-1)' }}>
      <button type="button" disabled={locked || selected.length === 0} onClick={() => wrap('branch', '분기로 묶기')}><IconLabel id="wrap-branch">분기로 묶기</IconLabel></button>
      <button type="button" disabled={locked || selected.length === 0} onClick={() => wrap('parallel', '병렬로 묶기')}><IconLabel id="wrap-parallel">병렬로 묶기</IconLabel></button>
      <button type="button" disabled={locked || selected.length === 0} onClick={() => wrap('loop', '반복으로 묶기')}><IconLabel id="wrap-loop">반복으로 묶기</IconLabel></button>
      <button type="button" disabled={locked || selected.length === 0} onClick={() => wrap('retry', '재시도로 묶기')}><IconLabel id="wrap-retry">재시도로 묶기</IconLabel></button>
      <select aria-label="Substation" disabled={locked} value={unitId} onChange={(e) => setUnitId(e.target.value)}>
        {p.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
      <button type="button" disabled={locked || !unitId} onClick={() => edit(C.addSubstationNode(p, unitId), 'Substation 시퀀스 넣기')}><IconLabel id="add-substation"><Terms text="Substation 시퀀스 넣기" /></IconLabel></button>
      <button type="button" disabled={locked} onClick={() => edit(C.addWaitNode(p), '신호 기다림 추가')}><IconLabel id="add-wait">신호 기다림 추가</IconLabel></button>
    </div>
    <p className="muted" style={{ fontSize: 'var(--fs-xs)' }}>같은 갈래에서 연속된 단계·블록·Substation 단계를 고르고 묶습니다. 칸에서 Space로 선택하고, 흐름이 있으면 ↑↓ 키로 같은 갈래 안에서 옮깁니다. 재시도 기본값은 {DEFAULT_MAX_RETRIES}회입니다.</p>
    <p className="muted" style={{ fontSize: 'var(--fs-xs)' }}>병렬로 묶으면 고른 줄이 갈래마다 하나씩 나뉩니다.</p>
    <table className={`grid ${ECD_TABLE}`} aria-label="Station 흐름">
      <thead><tr><th></th><th>흐름</th><th>조건 · 횟수 · 갈래</th><th>상태</th><th></th></tr></thead>
      <tbody>
        {rows.map((row) => {
          const id = nodeIdOf(row);
          const step = row.stepId ? p.sequence.steps.find((s) => s.id === row.stepId) : undefined;
          const action = step ? p.actions.find((a) => a.id === step.actionId) : undefined;
          const blockName = row.node && 'name' in row.node ? row.node.name : '';
          const selectLabel = isBlockKind(row.kind) ? flowBlockTitle(row.kind, blockName) : row.title;
          const live = row.stepId ? statusOf(rt, row.stepId) : null;
          const armIndex = typeof row.arm === 'number' ? row.arm : null;
          const jump = row.armOf === 'branch' && row.blockId && armIndex != null
            ? `flow:${row.blockId}:arm:${armIndex}`
            : row.stepId ? `step:${row.stepId}` : row.blockId && row.kind !== 'arm' ? `flow:${row.blockId}` : undefined;
          const picked = !!id && pickedIds.includes(id);
          const rowClass = [row.stepId ? stepLiveClass(live?.phase ?? 'pending') : '', picked ? 'is-picked' : ''].filter(Boolean).join(' ');
          return <tr key={row.key} className={rowClass || undefined} data-flow-kind={row.kind} data-flow-id={row.blockId ?? row.stepId} data-flow-arm={armIndex ?? undefined} data-arm-count={row.armCount} data-jump={jump} tabIndex={0} onKeyDown={(e) => onKey(e, row)}>
            <td>{id && <label className="check-hit"><input type="checkbox" aria-label={`${selectLabel} 선택`} disabled={locked} checked={pickedIds.includes(id)} onChange={() => toggle(id)} /></label>}</td>
            <td style={{ paddingLeft: 8 + row.depth * 16 }}>
              <b><Clip text={row.title} /></b>
              {isBlockKind(row.kind) && <BlockName name={blockName} word={flowBlockWord(row.kind)} disabled={locked} onCommit={(v) => edit(C.renameFlowBlock(p, row.blockId!, v), '블록 이름')} />}
              {row.kind === 'step' && action && <div className="muted" style={{ fontSize: 'var(--fs-xs)' }}>{unitName(p, action.unitId)} / {devName(p, action.deviceId)}</div>}
              {row.kind === 'arm' && <span className="muted"> {row.title === '참' ? '(조건이 참)' : row.title === '거짓' ? '(조건이 거짓)' : row.title === '그 밖' ? '(앞 갈래가 모두 거짓)' : ''}</span>}
            </td>
            <td>
              {row.node?.kind === 'wait' && <div className="row" style={{ gap: 'var(--sp-1)' }}>
                <CondSelect p={p} cond={row.node.cond} disabled={locked} onChange={(c) => edit(C.setFlowCondition(p, row.blockId!, c), '기다림 조건')} />
                <label style={{ whiteSpace: 'nowrap' }}>타임아웃 <input aria-label="기다림 타임아웃" type="number" min={0} step={0.1} disabled={locked} value={row.node.timeout.value ?? ''} style={{ width: 64 }}
                  onChange={(e) => edit(C.setWaitTimeout(p, row.blockId!, e.target.value === '' ? null : Number(e.target.value)), '기다림 타임아웃')} />s</label>
              </div>}
              {row.node?.kind === 'wait' && <div className="muted cond-head" style={{ fontSize: 'var(--fs-xs)' }} data-cond-formula="">{condLabel(p, row.node.cond)}<ConditionMark p={p} site={`flow:${row.blockId}`} /></div>}
              {row.node?.kind === 'branch' && row.armCount === 2 && <CondSelect p={p} cond={row.node.cond} disabled={locked} onChange={(c) => edit(C.setFlowCondition(p, row.blockId!, c), '분기 조건')} />}
              {row.node?.kind === 'branch' && row.armCount === 2 && <div className="muted cond-head" style={{ fontSize: 'var(--fs-xs)' }} data-cond-formula="">{condLabel(p, row.node.cond)}<ConditionMark p={p} site={`flow:${row.blockId}`} /></div>}
              {row.node?.kind === 'branch' && <button type="button" className="small" disabled={locked || (row.armCount ?? 0) >= MAX_BRANCH_ARMS} onClick={() => edit(C.addBranchArm(p, row.blockId!), '갈래 추가')}><IconLabel id="action-add">갈래 추가</IconLabel></button>}
              {row.armOf === 'branch' && row.armCond && armIndex != null && <>
                <CondSelect p={p} cond={row.armCond} disabled={locked} label={`${row.title} 조건`} onChange={(c) => edit(C.setBranchArmCondition(p, row.blockId!, armIndex, c), '갈래 조건')} />
                <div className="muted cond-head" style={{ fontSize: 'var(--fs-xs)' }} data-cond-formula="">{condLabel(p, row.armCond)}<ConditionMark p={p} site={`flow:${row.blockId}:arm:${armIndex}`} /></div>
              </>}
              {row.node?.kind === 'retry' && <div className="muted cond-head" style={{ fontSize: 'var(--fs-xs)' }} data-cond-formula="">{conditionFormula(p, row.node.until)}<ConditionMark p={p} site={`flow:${row.blockId}`} /></div>}
              {row.node?.kind === 'retry' && <div className="row" style={{ gap: 'var(--sp-1)' }}>
                <CondSelect p={p} cond={row.node.until} disabled={locked} onChange={(c) => edit(C.setFlowCondition(p, row.blockId!, c), '재시도 조건')} />
                <label>최대 <input aria-label="재시도 횟수" type="number" min={0} max={DEFAULT_MAX_RETRIES} disabled={locked} value={row.node.maxRetries} style={{ width: 48 }}
                  onChange={(e) => edit(C.setRetryMax(p, row.blockId!, Number(e.target.value)), '재시도 횟수')} />회</label>
              </div>}
              {row.node?.kind === 'loop' && <label>횟수 <input aria-label="반복 횟수" type="number" min={1} max={10} disabled={locked} value={row.node.count} style={{ width: 48 }}
                onChange={(e) => edit(C.setLoopCount(p, row.blockId!, Number(e.target.value)), '반복 횟수')} /></label>}
              {row.node?.kind === 'parallel' && <span>갈래 {row.node.lanes.length}
                <button type="button" className="small" disabled={locked || row.node.lanes.length >= 4} onClick={() => edit(C.addParallelLane(p, row.blockId!), '갈래 추가')}>갈래 추가</button>
              </span>}
              {row.armOf === 'parallel' && armIndex != null && <button type="button" className="small danger" disabled={locked} onClick={() => edit(C.removeParallelLane(p, row.blockId!, armIndex), '갈래 삭제')}>이 갈래 삭제</button>}
              {row.armOf === 'branch' && (row.armCount ?? 0) > 2 && armIndex != null && <button type="button" className="small danger" disabled={locked} onClick={() => edit(C.removeBranchArm(p, row.blockId!, armIndex), '이 갈래 삭제')}><IconLabel id="delete">이 갈래 삭제</IconLabel></button>}
            </td>
            <td>{live ? <StatusMark status={phaseShape(live.phase).status} word={live.label} /> : ''}</td>
            <td style={{ whiteSpace: 'nowrap' }}>
              {id && <>
                <button type="button" className="small" disabled={locked || !p.sequence.flow} onClick={() => edit(C.moveFlowNode(p, id, -1), row.kind === 'step' ? '단계 위로' : '블록 위로')}>위로</button>
                <button type="button" className="small" disabled={locked || !p.sequence.flow} onClick={() => edit(C.moveFlowNode(p, id, 1), row.kind === 'step' ? '단계 아래로' : '블록 아래로')}>아래로</button>
                <button type="button" className="small" disabled={locked || !p.sequence.flow} onClick={() => edit(C.moveFlowOut(p, id), '블록 밖으로')}>밖으로</button>
              </>}
              {row.blockId && row.kind !== 'arm' && row.kind !== 'step' && row.kind !== 'wait' && <button type="button" className="small" disabled={locked} onClick={() => edit(C.unwrapFlow(p, row.blockId!), '블록 풀기')}><IconLabel id="unwrap">블록 풀기</IconLabel></button>}
              {row.kind === 'wait' && row.blockId && <button type="button" className="small" disabled={locked} onClick={() => edit(C.unwrapFlow(p, row.blockId!), '신호 기다림 삭제')}>삭제</button>}
              {row.armOf === 'branch' && (row.armCount ?? 0) > 2 && armIndex != null && <>
                <button type="button" className="small" disabled={locked || armIndex === 0} onClick={() => edit(C.moveBranchArm(p, row.blockId!, armIndex, -1), '갈래 위로')}>위로</button>
                <button type="button" className="small" disabled={locked || armIndex === (row.armCount ?? 1) - 1} onClick={() => edit(C.moveBranchArm(p, row.blockId!, armIndex, 1), '갈래 아래로')}>아래로</button>
              </>}
              {row.kind === 'arm' && row.arm != null && selected.length > 0 && <button type="button" className="small" disabled={locked} onClick={() => { if (edit(C.moveFlowInto(p, selected[0], row.blockId!, row.arm as Arm), '갈래로 옮기기')) setPicked(selected.slice(1)); }}>선택 넣기</button>}
            </td>
          </tr>;
        })}
        {rows.length === 0 && <tr><td colSpan={5}>시퀀스 단계가 없습니다.</td></tr>}
      </tbody>
    </table>
  </div>;
}
