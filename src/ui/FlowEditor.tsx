// Station sequence flow editor (TURN-022). Blocks are indented and named in words, not by color alone.
import { useState } from 'react';
import * as C from '../model/commands';
import type { Condition, FlowNode, Project } from '../model/types';
import { DEFAULT_MAX_RETRIES } from '../model/types';
import type { RuntimeState } from '../runtime/engine';
import type { EditFn } from './Inspector';
import { condLabel, devName, signalChoiceLabel, unitName } from './labels';

type Arm = 'then' | 'else' | 'body' | number;

interface Row {
  key: string;
  depth: number;
  kind: 'step' | 'branch' | 'parallel' | 'loop' | 'retry' | 'substation' | 'arm';
  title: string;
  stepId?: string;
  blockId?: string;
  arm?: Arm;
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
      out.push({ key: n.id, depth, kind: 'branch', title: `분기 ${n.name}`, blockId: n.id, node: n });
      out.push({ key: `${n.id}:then`, depth: depth + 1, kind: 'arm', title: '참', blockId: n.id, arm: 'then' });
      out.push(...flatten(p, n.then, depth + 2));
      out.push({ key: `${n.id}:else`, depth: depth + 1, kind: 'arm', title: '거짓', blockId: n.id, arm: 'else' });
      out.push(...flatten(p, n.else, depth + 2));
    } else if (n.kind === 'parallel') {
      out.push({ key: n.id, depth, kind: 'parallel', title: `병렬 ${n.name}`, blockId: n.id, node: n });
      n.lanes.forEach((lane, i) => {
        out.push({ key: `${n.id}:lane${i}`, depth: depth + 1, kind: 'arm', title: `갈래 ${i + 1}`, blockId: n.id, arm: i });
        out.push(...flatten(p, lane, depth + 2));
      });
    } else if (n.kind === 'loop') {
      out.push({ key: n.id, depth, kind: 'loop', title: `반복 ${n.name}`, blockId: n.id, node: n });
      out.push(...flatten(p, n.body, depth + 1));
    } else if (n.kind === 'retry') {
      out.push({ key: n.id, depth, kind: 'retry', title: `재시도 ${n.name}`, blockId: n.id, node: n });
      out.push(...flatten(p, n.body, depth + 1));
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

function CondSelect({ p, cond, disabled, onChange }: { p: Project; cond: Condition; disabled: boolean; onChange: (c: Condition) => void }) {
  const states = p.materials[0]?.states ?? [];
  return <select aria-label="조건" disabled={disabled} value={condValue(cond)} onChange={(e) => onChange(condFrom(e.target.value))} style={{ maxWidth: 280 }}>
    <option value="undef">조건 없음</option>
    {p.signals.map((s) => <option key={`${s.id}:1`} value={`sig:${s.id}:1`}>{signalChoiceLabel(p, s.id, true)}</option>)}
    {p.signals.map((s) => <option key={`${s.id}:0`} value={`sig:${s.id}:0`}>{signalChoiceLabel(p, s.id, false)}</option>)}
    {states.map((st) => <option key={st} value={`st:${st}`}>자재 상태 = {st}</option>)}
    {p.units.map((u) => <option key={u.id} value={`at:${u.id}`}>자재 위치 = {u.name}</option>)}
  </select>;
}

function statusOf(rt: RuntimeState | null, stepId: string): string {
  const rows = rt?.steps.filter((r) => r.stepId === stepId) ?? [];
  if (!rows.length) return '대기';
  if (rows.some((r) => r.status === 'active')) return '실행 중';
  if (rows.some((r) => r.status === 'error')) return '오류';
  const done = rows.filter((r) => r.status === 'done').length;
  const skipped = rows.some((r) => r.status === 'skipped');
  if (done > 1) return `완료 ${done}회`;
  if (done === 1 && skipped) return '완료 · 건너뜀';
  if (done === 1) return '완료';
  if (skipped) return '건너뜀';
  return '대기';
}

export function FlowEditor({ p, rt, locked, edit }: { p: Project; rt: RuntimeState | null; locked: boolean; edit: EditFn }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [unitId, setUnitId] = useState(p.units[0]?.id ?? '');
  const nodes = p.sequence.flow ?? p.sequence.steps.map((s) => ({ kind: 'step' as const, stepId: s.id }));
  const rows = flatten(p, nodes, 0);
  const toggle = (id: string) => setPicked((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  const selected = rows.filter((r) => r.stepId && picked.includes(r.stepId)).map((r) => r.stepId!);
  const wrap = (kind: 'branch' | 'parallel' | 'loop' | 'retry', label: string) => {
    if (edit(C.wrapFlow(p, selected, kind), label)) setPicked([]);
  };
  const onKey = (e: React.KeyboardEvent<HTMLTableRowElement>, row: Row) => {
    if (e.key === ' ' && row.stepId) { e.preventDefault(); toggle(row.stepId); }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && row.stepId && p.sequence.flow) {
      e.preventDefault();
      edit(C.moveFlowNode(p, row.stepId, e.key === 'ArrowUp' ? -1 : 1), e.key === 'ArrowUp' ? '단계 위로' : '단계 아래로');
    }
  };
  return <div>
    <div className="row wrap" style={{ gap: 6, marginBottom: 6 }}>
      <button type="button" disabled={locked || selected.length === 0} onClick={() => wrap('branch', '분기로 묶기')}>분기로 묶기</button>
      <button type="button" disabled={locked || selected.length === 0} onClick={() => wrap('parallel', '병렬로 묶기')}>병렬로 묶기</button>
      <button type="button" disabled={locked || selected.length === 0} onClick={() => wrap('loop', '반복으로 묶기')}>반복으로 묶기</button>
      <button type="button" disabled={locked || selected.length === 0} onClick={() => wrap('retry', '재시도로 묶기')}>재시도로 묶기</button>
      <select aria-label="Substation" disabled={locked} value={unitId} onChange={(e) => setUnitId(e.target.value)}>
        {p.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
      <button type="button" disabled={locked || !unitId} onClick={() => edit(C.addSubstationNode(p, unitId), 'Substation 시퀀스 넣기')}>Substation 시퀀스 넣기</button>
    </div>
    <p className="muted" style={{ fontSize: 11 }}>연속된 단계를 고르고 묶습니다. 칸에서 Space로 선택하고, 흐름이 있으면 ↑↓ 키로 같은 갈래 안에서 옮깁니다. 재시도 기본값은 {DEFAULT_MAX_RETRIES}회입니다.</p>
    <table className="grid" aria-label="Station 흐름">
      <thead><tr><th></th><th>흐름</th><th>조건 · 횟수 · 갈래</th><th>상태</th><th></th></tr></thead>
      <tbody>
        {rows.map((row) => {
          const step = row.stepId ? p.sequence.steps.find((s) => s.id === row.stepId) : undefined;
          const action = step ? p.actions.find((a) => a.id === step.actionId) : undefined;
          return <tr key={row.key} data-flow-kind={row.kind} tabIndex={0} onKeyDown={(e) => onKey(e, row)}>
            <td>{row.stepId && <input type="checkbox" aria-label={`${row.title} 선택`} disabled={locked} checked={picked.includes(row.stepId)} onChange={() => toggle(row.stepId!)} />}</td>
            <td style={{ paddingLeft: 8 + row.depth * 16 }}>
              <b>{row.kind === 'step' ? row.title : row.title}</b>
              {row.kind === 'step' && action && <div className="muted" style={{ fontSize: 11 }}>{unitName(p, action.unitId)} / {devName(p, action.deviceId)}</div>}
              {row.kind === 'arm' && <span className="muted"> {row.title === '참' ? '(조건이 참)' : row.title === '거짓' ? '(조건이 거짓)' : ''}</span>}
            </td>
            <td>
              {row.node?.kind === 'branch' && <CondSelect p={p} cond={row.node.cond} disabled={locked} onChange={(c) => edit(C.setFlowCondition(p, row.blockId!, c), '분기 조건')} />}
              {row.node?.kind === 'branch' && <div className="muted" style={{ fontSize: 11 }}>{condLabel(p, row.node.cond)}</div>}
              {row.node?.kind === 'retry' && <div className="row" style={{ gap: 4 }}>
                <CondSelect p={p} cond={row.node.until} disabled={locked} onChange={(c) => edit(C.setFlowCondition(p, row.blockId!, c), '재시도 조건')} />
                <label>최대 <input aria-label="재시도 횟수" type="number" min={0} max={DEFAULT_MAX_RETRIES} disabled={locked} value={row.node.maxRetries} style={{ width: 48 }}
                  onChange={(e) => edit(C.setRetryMax(p, row.blockId!, Number(e.target.value)), '재시도 횟수')} />회</label>
              </div>}
              {row.node?.kind === 'loop' && <label>횟수 <input aria-label="반복 횟수" type="number" min={1} max={10} disabled={locked} value={row.node.count} style={{ width: 48 }}
                onChange={(e) => edit(C.setLoopCount(p, row.blockId!, Number(e.target.value)), '반복 횟수')} /></label>}
              {row.node?.kind === 'parallel' && <span>갈래 {row.node.lanes.length}
                <button type="button" className="small" disabled={locked || row.node.lanes.length >= 4} onClick={() => edit(C.addParallelLane(p, row.blockId!), '갈래 추가')}>갈래 추가</button>
              </span>}
              {row.kind === 'arm' && typeof row.arm === 'number' && <button type="button" className="small" disabled={locked} onClick={() => edit(C.removeParallelLane(p, row.blockId!, row.arm as number), '갈래 삭제')}>이 갈래 삭제</button>}
            </td>
            <td>{row.stepId ? statusOf(rt, row.stepId) : ''}</td>
            <td style={{ whiteSpace: 'nowrap' }}>
              {row.stepId && <>
                <button type="button" className="small" disabled={locked || !p.sequence.flow} onClick={() => edit(C.moveFlowNode(p, row.stepId!, -1), '단계 위로')}>위로</button>
                <button type="button" className="small" disabled={locked || !p.sequence.flow} onClick={() => edit(C.moveFlowNode(p, row.stepId!, 1), '단계 아래로')}>아래로</button>
                <button type="button" className="small" disabled={locked || !p.sequence.flow} onClick={() => edit(C.moveFlowOut(p, row.stepId!), '블록 밖으로')}>밖으로</button>
              </>}
              {row.blockId && row.kind !== 'arm' && row.kind !== 'step' && <button type="button" className="small" disabled={locked} onClick={() => edit(C.unwrapFlow(p, row.blockId!), '블록 풀기')}>블록 풀기</button>}
              {row.kind === 'arm' && row.arm != null && selected.length > 0 && <button type="button" className="small" disabled={locked} onClick={() => { if (edit(C.moveFlowInto(p, selected[0], row.blockId!, row.arm as Arm), '갈래로 옮기기')) setPicked(selected.slice(1)); }}>선택 넣기</button>}
            </td>
          </tr>;
        })}
        {rows.length === 0 && <tr><td colSpan={5}>단계가 없습니다.</td></tr>}
      </tbody>
    </table>
  </div>;
}
