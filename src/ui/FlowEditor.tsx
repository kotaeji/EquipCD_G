// Station sequence flow editor (TURN-022, names and moves in TURN-023).
// TURN-073 adds the row menu and the grip drag. Both call the existing flow commands.
import { useEffect, useRef, useState } from 'react';
import * as C from '../model/commands';
import { stepDeleteDetail } from '../model/deleteImpact';
import { MAX_BRANCH_ARMS } from '../model/flow';
import type { Condition, Project } from '../model/types';
import { DEFAULT_MAX_RETRIES } from '../model/types';
import type { RuntimeState } from '../runtime/engine';
import { aggregateStepStatus } from '../runtime/runSummary';
import { StatusMark } from './StatusMark';
import { phaseShape } from './status';
import type { ConfirmDelete, EditFn } from './Inspector';
import { stepLiveClass } from './RunSummary';
import { conditionFormula } from '../model/conditionFormula';
import { ConditionMark } from './conditionMark';
import { materialMark } from '../model/materialMix';
import { condLabel, devName, flowBlockTitle, flowBlockWord, signalChoiceLabel, unitName, type FlowBlockKind } from './labels';
import { Terms } from './Term';
import { ContextMenu } from './ContextMenu';
import { EDIT_LOCKED, isTextField } from './contextMenuModel';
import { IconLabel } from './Icon';
import { Clip, ECD_TABLE } from './dataTable';
import { buildFlowMenu, flattenFlowRows, flowMenuKind, planFlowPick, type FlowMenuAction, type FlowMenuItem, type FlowRow } from './flowMenuModel';
import { dragIds, dropSlots, edgeScrollDelta, nearestSlot, readMeasuredRow, relocateFlow, scrollParent, type DropSlot } from './flowDrag';
import './flow-table.css';

type Arm = 'then' | 'else' | 'body' | number;

function condValue(c: Condition): string {
  if (c.kind === 'signal') return `sig:${c.signalId}:${c.equals ? '1' : '0'}`;
  if (c.kind === 'materialState') return `st:${c.state}`;
  if (c.kind === 'materialAt') return `at:${c.unitId}`;
  if (c.kind === 'materialType') return `ty:${c.materialId}`;
  return 'undef';
}

function condFrom(value: string): Condition {
  if (value.startsWith('sig:')) {
    const [, id, bit] = value.split(':');
    return { kind: 'signal', signalId: id, equals: bit === '1' };
  }
  if (value.startsWith('st:')) return { kind: 'materialState', state: value.slice(3) };
  if (value.startsWith('at:')) return { kind: 'materialAt', unitId: value.slice(3) };
  if (value.startsWith('ty:')) return { kind: 'materialType', materialId: value.slice(3) };
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
    {p.materials.map((m) => <option key={m.id} value={`ty:${m.id}`}>자재 종류 = {materialMark(p, m.id)}</option>)}
  </select>;
}

function isBlockKind(kind: FlowRow['kind']): kind is FlowBlockKind {
  return kind === 'branch' || kind === 'parallel' || kind === 'loop' || kind === 'retry' || kind === 'wait';
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

interface MenuState {
  x: number;
  y: number;
  kind: string;
  focus: HTMLElement | null;
  rowKey: string;
  items: FlowMenuItem[];
  ordered: string[];
}

export function FlowEditor({ p, rt, locked, edit, picked, onPicked, confirmDelete, onOpenAction, seqId }: {
  p: Project;
  rt: RuntimeState | null;
  locked: boolean;
  edit: EditFn;
  /** Controlled row checkboxes. Omit to keep the selection inside this table. */
  picked?: string[];
  onPicked?: (ids: string[]) => void;
  confirmDelete?: ConfirmDelete;
  /** Open the step's Action on stage 3. Navigation only — it does not edit the model. */
  onOpenAction?: (actionId: string) => void;
  /** Substation sequence to edit. Absent means the Station sequence. */
  seqId?: string;
}) {
  const [innerPicked, setInnerPicked] = useState<string[]>([]);
  const pickedIds = picked ?? innerPicked;
  const setPicked = (next: string[] | ((cur: string[]) => string[])) => {
    const value = typeof next === 'function' ? next(pickedIds) : next;
    if (onPicked) onPicked(value);
    else setInnerPicked(value);
  };
  const [unitId, setUnitId] = useState(p.units[0]?.id ?? '');
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dragging, setDragging] = useState(false);
  const [drop, setDrop] = useState<DropSlot | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const dragRef = useRef<{ pointerId: number; ids: string[]; x: number; y: number; slot: DropSlot | null } | null>(null);
  const edgeRef = useRef(0);
  const home = seqId
    ? (p.substationSequences ?? []).find((q) => q.id === seqId) ?? null
    : p.sequence;
  const live = useRef({ p, locked, edit, pickedIds, seqId, flow: home?.flow });
  live.current = { p, locked, edit, pickedIds, seqId, flow: home?.flow };
  const nodes = (home?.flow ?? home?.steps.map((s) => ({ kind: 'step' as const, stepId: s.id }))) ?? [];
  const rows = flattenFlowRows(p, nodes, 0);
  const orderedOf = (ids: string[]) => rows.map((r) => r.id).filter((id): id is string => !!id && ids.includes(id));
  const toggle = (id: string) => setPicked((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  const selected = orderedOf(pickedIds);
  const wrap = (kind: C.WrapKind, label: string) => {
    if (edit(C.wrapFlow(p, selected, kind, undefined, seqId), label)) setPicked([]);
  };

  const slotAt = (clientX: number, clientY: number, ids: string[]): DropSlot | null => {
    const table = tableRef.current;
    const flow = live.current.flow;
    if (!table || !flow) return null;
    const measured = [...table.querySelectorAll<HTMLTableRowElement>('tbody tr')].map(readMeasuredRow);
    const box = table.getBoundingClientRect();
    return nearestSlot(dropSlots(measured, flow, ids), clientX, clientY, box.top, box.bottom);
  };
  const slotAtRef = useRef(slotAt);
  slotAtRef.current = slotAt;

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      d.x = e.clientX;
      d.y = e.clientY;
      const scroller = scrollParent(tableRef.current);
      if (scroller) {
        const box = scroller.getBoundingClientRect();
        edgeRef.current = edgeScrollDelta(e.clientY, box.top, box.bottom);
        if (edgeRef.current) scroller.scrollTop += edgeRef.current;
      } else edgeRef.current = 0;
      d.slot = slotAtRef.current(e.clientX, e.clientY, d.ids);
      setDrop(d.slot);
    };
    const finish = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      const slot = slotAtRef.current(e.clientX, e.clientY, d.ids);
      dragRef.current = null;
      edgeRef.current = 0;
      setDragging(false);
      setDrop(null);
      const cur = live.current;
      if (!slot || slot.noop) return;
      if (!slot.valid) {
        cur.edit({ ok: false, reason: slot.reason ?? '이동 불가' }, '흐름 옮기기');
        return;
      }
      const moved = relocateFlow(cur.p, d.ids, slot.listKey, slot.index, cur.seqId);
      if (moved) cur.edit(moved, '흐름 옮기기');
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !dragRef.current) return;
      dragRef.current = null;
      edgeRef.current = 0;
      setDragging(false);
      setDrop(null);
    };
    const timer = window.setInterval(() => {
      const d = dragRef.current;
      if (!d || !edgeRef.current) return;
      const scroller = scrollParent(tableRef.current);
      if (scroller) scroller.scrollTop += edgeRef.current;
      d.slot = slotAtRef.current(d.x, d.y, d.ids);
      setDrop(d.slot);
    }, 50);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const openMenu = (row: FlowRow, x: number, y: number, focus: HTMLElement | null) => {
    const next = planFlowPick(pickedIds, row.id);
    if (next !== pickedIds && (next.length !== pickedIds.length || next.some((id, i) => id !== pickedIds[i]))) setPicked(next);
    const ordered = orderedOf(next);
    setMenu({
      x, y, focus, rowKey: row.key, kind: flowMenuKind(row), ordered,
      items: buildFlowMenu({ p, row, ordered, locked, seqId }),
    });
  };

  const runMenu = (action: FlowMenuAction) => {
    const state = menu;
    setMenu(null);
    if (!state) return;
    const row = rows.find((r) => r.key === state.rowKey);
    if (!row) return;
    const ordered = state.ordered;
    const what = row.kind === 'step' ? '단계' : '블록';
    if ((action === 'up' || action === 'down') && row.kind === 'arm' && row.armOf === 'branch' && typeof row.arm === 'number' && row.blockId) {
      const delta = action === 'up' ? -1 : 1;
      edit(C.moveBranchArm(p, row.blockId, row.arm, delta, seqId), delta < 0 ? '갈래 위로' : '갈래 아래로');
      return;
    }
    if (action === 'up' && row.id) { edit(C.moveFlowNode(p, row.id, -1, seqId), `${what} 위로`); return; }
    if (action === 'down' && row.id) { edit(C.moveFlowNode(p, row.id, 1, seqId), `${what} 아래로`); return; }
    if (action === 'out' && row.id) { edit(C.moveFlowOut(p, row.id, seqId), '블록 밖으로'); return; }
    if (action === 'into' && row.blockId && row.arm != null && ordered[0]) {
      if (edit(C.moveFlowInto(p, ordered[0], row.blockId, row.arm, seqId), '갈래로 옮기기')) setPicked(ordered.slice(1));
      return;
    }
    if (action === 'wrapBranch' || action === 'wrapParallel' || action === 'wrapLoop' || action === 'wrapRetry') {
      const kind = action === 'wrapBranch' ? 'branch' : action === 'wrapParallel' ? 'parallel' : action === 'wrapLoop' ? 'loop' : 'retry';
      const label = kind === 'branch' ? '분기로 묶기' : kind === 'parallel' ? '병렬로 묶기' : kind === 'loop' ? '반복으로 묶기' : '재시도로 묶기';
      if (edit(C.wrapFlow(p, ordered, kind, undefined, seqId), label)) setPicked([]);
      return;
    }
    if (action === 'unwrap' && row.blockId) { edit(C.unwrapFlow(p, row.blockId, seqId), '블록 풀기'); return; }
    if (action === 'rename') {
      const key = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(row.key) : row.key;
      const input = tableRef.current?.querySelector<HTMLInputElement>(`tr[data-row-key="${key}"] input[aria-label$="이름"]`);
      input?.focus();
      input?.select();
      return;
    }
    if (action === 'openAction' && row.stepId) {
      const step = home?.steps.find((s) => s.id === row.stepId);
      if (step) onOpenAction?.(step.actionId);
      return;
    }
    if (action === 'delete' && row.kind === 'step' && row.stepId) {
      const step = home?.steps.find((s) => s.id === row.stepId);
      const detail = stepDeleteDetail(p, row.stepId);
      const run = () => edit(seqId ? C.removeSubStep(p, seqId, row.stepId!) : C.removeStep(p, row.stepId!), '단계 삭제');
      if (detail && confirmDelete) confirmDelete(`${step?.name ?? row.title} 삭제`, detail, run);
      else run();
      return;
    }
    if (action === 'delete' && row.kind === 'wait' && row.blockId) { edit(C.unwrapFlow(p, row.blockId, seqId), '신호 기다림 삭제'); return; }
    if (action === 'delete' && row.kind === 'arm' && row.armOf === 'branch' && typeof row.arm === 'number' && row.blockId) {
      edit(C.removeBranchArm(p, row.blockId, row.arm, seqId), '이 갈래 삭제');
      return;
    }
    if (action === 'delete' && row.kind === 'arm' && typeof row.arm === 'number' && row.blockId) {
      edit(C.removeParallelLane(p, row.blockId, row.arm, seqId), '갈래 삭제');
    }
  };

  const onGripDown = (e: React.PointerEvent<HTMLButtonElement>, row: FlowRow) => {
    if (e.button !== 0 || e.pointerType === 'touch' || !row.id) return;
    e.preventDefault();
    e.stopPropagation();
    const cur = live.current;
    if (cur.locked) {
      cur.edit({ ok: false, reason: EDIT_LOCKED }, '흐름 옮기기');
      return;
    }
    const flow = cur.flow;
    if (!flow) {
      cur.edit({ ok: false, reason: '흐름 없음' }, '흐름 옮기기');
      return;
    }
    const moving = dragIds(flow, cur.pickedIds, row.id);
    if ('reason' in moving) {
      cur.edit({ ok: false, reason: moving.reason }, '흐름 옮기기');
      return;
    }
    setMenu(null);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* jsdom has no capture */ }
    dragRef.current = { pointerId: e.pointerId, ids: moving.ids, x: e.clientX, y: e.clientY, slot: null };
    edgeRef.current = 0;
    setDragging(true);
    setDrop(null);
  };

  const onKey = (e: React.KeyboardEvent<HTMLTableRowElement>, row: FlowRow) => {
    if (isTextField(e.target as Element)) return;
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      openMenu(row, rect.left, rect.bottom, e.currentTarget);
      return;
    }
    const id = row.id;
    if (!id) return;
    if (e.key === ' ' && (e.target as HTMLElement).tagName !== 'BUTTON' && !locked) { e.preventDefault(); toggle(id); }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && home?.flow) {
      e.preventDefault();
      const up = e.key === 'ArrowUp';
      const what = row.kind === 'step' ? '단계' : '블록';
      edit(C.moveFlowNode(p, id, up ? -1 : 1, seqId), up ? `${what} 위로` : `${what} 아래로`);
    }
  };
  const showLine = dragging && drop && drop.valid && !drop.noop;
  const showReason = dragging && drop && !drop.valid && drop.reason;
  return <div>
    <div className="row wrap" style={{ gap: 'var(--sp-1)', marginBottom: 'var(--sp-1)' }}>
      <button type="button" disabled={locked || selected.length === 0} onClick={() => wrap('branch', '분기로 묶기')}>분기로 묶기</button>
      <button type="button" disabled={locked || selected.length === 0} onClick={() => wrap('parallel', '병렬로 묶기')}>병렬로 묶기</button>
      <button type="button" disabled={locked || selected.length === 0} onClick={() => wrap('loop', '반복으로 묶기')}>반복으로 묶기</button>
      <button type="button" disabled={locked || selected.length === 0} onClick={() => wrap('retry', '재시도로 묶기')}>재시도로 묶기</button>
      {!seqId && <select aria-label="Substation" disabled={locked} value={unitId} onChange={(e) => setUnitId(e.target.value)}>
        {p.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>}
      <button type="button" disabled={locked || (!seqId && !unitId)} onClick={() => edit(C.addSubstationNode(p, unitId, undefined, seqId), 'Substation 시퀀스 넣기')}><Terms text="Substation 시퀀스 넣기" /></button>
      <button type="button" disabled={locked} onClick={() => edit(C.addWaitNode(p, undefined, seqId), '신호 기다림 추가')}>신호 기다림 추가</button>
    </div>
    {seqId
      ? <p className="muted" data-subflow-note="" style={{ fontSize: 'var(--fs-xs)' }}>Substation 시퀀스 흐름입니다. Station 흐름과 따로입니다. 병렬과 Substation 단계는 한 Substation의 시퀀스들이 이미 함께 돌아서 넣지 않습니다. 칸에서 Space로 선택하고, 흐름이 있으면 ↑↓ 키로 옮깁니다. 재시도 기본값은 {DEFAULT_MAX_RETRIES}회입니다.</p>
      : <>
        <p className="muted" style={{ fontSize: 'var(--fs-xs)' }}>같은 갈래에서 연속된 단계·블록·Substation 단계를 고르고 묶습니다. 칸에서 Space로 선택하고, 흐름이 있으면 ↑↓ 키로 같은 갈래 안에서 옮깁니다. 줄을 우클릭하면 명령이 열리고, 왼쪽 손잡이를 끌어 다른 자리로 옮깁니다. 재시도 기본값은 {DEFAULT_MAX_RETRIES}회입니다.</p>
        <p className="muted" style={{ fontSize: 'var(--fs-xs)' }}>병렬로 묶으면 고른 줄이 갈래마다 하나씩 나뉩니다.</p>
      </>}
    {showReason && <p className="flow-drag-reason" role="status">{drop?.reason}</p>}
    <table ref={tableRef} className={`grid flow-table ${ECD_TABLE}`} aria-label={seqId ? `Substation 흐름 ${home?.name ?? ''}` : 'Station 흐름'} data-flow-drag={dragging ? '1' : '0'} data-flow-home={seqId ? 'substation' : 'station'}>
      <thead><tr><th></th><th>흐름</th>{seqId && <th className="ecd-num">시간</th>}<th>조건 · 횟수 · 갈래</th><th>상태</th><th></th></tr></thead>
      <tbody>
        {rows.map((row) => {
          const id = row.id;
          const step = row.stepId ? home?.steps.find((s) => s.id === row.stepId) : undefined;
          const action = step ? p.actions.find((a) => a.id === step.actionId) : undefined;
          const blockName = row.node && 'name' in row.node ? row.node.name : '';
          const selectLabel = isBlockKind(row.kind) ? flowBlockTitle(row.kind, blockName) : row.title;
          const liveRow = row.stepId ? statusOf(rt, row.stepId) : null;
          const armIndex = typeof row.arm === 'number' ? row.arm : null;
          const jump = row.armOf === 'branch' && row.blockId && armIndex != null
            ? `flow:${row.blockId}:arm:${armIndex}`
            : row.stepId ? `step:${row.stepId}` : row.blockId && row.kind !== 'arm' ? `flow:${row.blockId}` : undefined;
          const picked = !!id && pickedIds.includes(id);
          const rowClass = [row.stepId ? stepLiveClass(liveRow?.phase ?? 'pending') : '', picked ? 'is-picked' : ''].filter(Boolean).join(' ');
          return <tr key={row.key} className={rowClass || undefined}
            data-flow-kind={row.kind} data-flow-id={row.blockId ?? row.stepId} data-node-id={id ?? ''} data-list-key={row.listKey}
            data-flow-index={row.index} data-depth={row.depth} data-row-key={row.key}
            data-flow-arm={armIndex ?? undefined} data-arm-count={row.armCount} data-jump={jump} tabIndex={0}
            onKeyDown={(e) => onKey(e, row)}
            onContextMenu={(e) => {
              if (isTextField(e.target as Element)) return;
              e.preventDefault();
              openMenu(row, e.clientX, e.clientY, e.currentTarget);
            }}>
            <td className="flow-mark">{id && <>
              <button type="button" className="small flow-grip" aria-label={`${selectLabel} 옮기기`} data-flow-grip={id}
                aria-disabled={locked || !home?.flow ? true : undefined}
                title={locked ? EDIT_LOCKED : !home?.flow ? '흐름 없음' : '끌어 옮기기'}
                onPointerDown={(e) => onGripDown(e, row)}
              ><IconLabel id="flow-grip" glyph="⋮⋮" /></button>
              <label className="check-hit"><input type="checkbox" aria-label={`${selectLabel} 선택`} disabled={locked} checked={pickedIds.includes(id)} onChange={() => toggle(id)} /></label>
            </>}</td>
            <td style={{ paddingLeft: 8 + row.depth * 16 }}>
              <b><Clip text={row.title} /></b>
              {isBlockKind(row.kind) && <BlockName name={blockName} word={flowBlockWord(row.kind)} disabled={locked} onCommit={(v) => edit(C.renameFlowBlock(p, row.blockId!, v, seqId), '블록 이름')} />}
              {row.kind === 'step' && action && <div className="muted" style={{ fontSize: 'var(--fs-xs)' }}>{unitName(p, action.unitId)} / {devName(p, action.deviceId)}</div>}
              {row.kind === 'arm' && <span className="muted"> {row.title === '참' ? '(조건이 참)' : row.title === '거짓' ? '(조건이 거짓)' : row.title === '그 밖' ? '(앞 갈래가 모두 거짓)' : ''}</span>}
            </td>
            {seqId && <td className="mono ecd-num">{action ? (action.duration.value == null ? '—' : `${action.duration.value}s`) : ''}</td>}
            <td>
              {row.node?.kind === 'wait' && <div className="row" style={{ gap: 'var(--sp-1)' }}>
                <CondSelect p={p} cond={row.node.cond} disabled={locked} onChange={(c) => edit(C.setFlowCondition(p, row.blockId!, c, seqId), '기다림 조건')} />
                <label style={{ whiteSpace: 'nowrap' }}>타임아웃 <input aria-label="기다림 타임아웃" type="number" min={0} step={0.1} disabled={locked} value={row.node.timeout.value ?? ''} style={{ width: 64 }}
                  onChange={(e) => edit(C.setWaitTimeout(p, row.blockId!, e.target.value === '' ? null : Number(e.target.value), seqId), '기다림 타임아웃')} />s</label>
              </div>}
              {row.node?.kind === 'wait' && <div className="muted cond-head" style={{ fontSize: 'var(--fs-xs)' }} data-cond-formula="">{condLabel(p, row.node.cond)}<ConditionMark p={p} site={`flow:${row.blockId}`} /></div>}
              {row.node?.kind === 'branch' && row.armCount === 2 && <CondSelect p={p} cond={row.node.cond} disabled={locked} onChange={(c) => edit(C.setFlowCondition(p, row.blockId!, c, seqId), '분기 조건')} />}
              {row.node?.kind === 'branch' && row.armCount === 2 && <div className="muted cond-head" style={{ fontSize: 'var(--fs-xs)' }} data-cond-formula="">{condLabel(p, row.node.cond)}<ConditionMark p={p} site={`flow:${row.blockId}`} /></div>}
              {row.node?.kind === 'branch' && <button type="button" className="small" disabled={locked || (row.armCount ?? 0) >= MAX_BRANCH_ARMS} onClick={() => edit(C.addBranchArm(p, row.blockId!, seqId), '갈래 추가')}><IconLabel id="action-add">갈래 추가</IconLabel></button>}
              {row.armOf === 'branch' && row.armCond && armIndex != null && <>
                <CondSelect p={p} cond={row.armCond} disabled={locked} label={`${row.title} 조건`} onChange={(c) => edit(C.setBranchArmCondition(p, row.blockId!, armIndex, c, seqId), '갈래 조건')} />
                <div className="muted cond-head" style={{ fontSize: 'var(--fs-xs)' }} data-cond-formula="">{condLabel(p, row.armCond)}<ConditionMark p={p} site={`flow:${row.blockId}:arm:${armIndex}`} /></div>
              </>}
              {row.node?.kind === 'retry' && <div className="muted cond-head" style={{ fontSize: 'var(--fs-xs)' }} data-cond-formula="">{conditionFormula(p, row.node.until)}<ConditionMark p={p} site={`flow:${row.blockId}`} /></div>}
              {row.node?.kind === 'retry' && <div className="row" style={{ gap: 'var(--sp-1)' }}>
                <CondSelect p={p} cond={row.node.until} disabled={locked} onChange={(c) => edit(C.setFlowCondition(p, row.blockId!, c, seqId), '재시도 조건')} />
                <label>최대 <input aria-label="재시도 횟수" type="number" min={0} max={DEFAULT_MAX_RETRIES} disabled={locked} value={row.node.maxRetries} style={{ width: 48 }}
                  onChange={(e) => edit(C.setRetryMax(p, row.blockId!, Number(e.target.value), seqId), '재시도 횟수')} />회</label>
              </div>}
              {row.node?.kind === 'loop' && <label>횟수 <input aria-label="반복 횟수" type="number" min={1} max={10} disabled={locked} value={row.node.count} style={{ width: 48 }}
                onChange={(e) => edit(C.setLoopCount(p, row.blockId!, Number(e.target.value), seqId), '반복 횟수')} /></label>}
              {row.node?.kind === 'parallel' && <span>갈래 {row.node.lanes.length}
                <button type="button" className="small" disabled={locked || row.node.lanes.length >= 4} onClick={() => edit(C.addParallelLane(p, row.blockId!, seqId), '갈래 추가')}>갈래 추가</button>
              </span>}
              {row.armOf === 'parallel' && armIndex != null && <button type="button" className="small danger" disabled={locked} onClick={() => edit(C.removeParallelLane(p, row.blockId!, armIndex, seqId), '갈래 삭제')}>이 갈래 삭제</button>}
              {row.armOf === 'branch' && (row.armCount ?? 0) > 2 && armIndex != null && <button type="button" className="small danger" disabled={locked} onClick={() => edit(C.removeBranchArm(p, row.blockId!, armIndex, seqId), '이 갈래 삭제')}><IconLabel id="delete">이 갈래 삭제</IconLabel></button>}
            </td>
            <td>{liveRow ? <StatusMark status={phaseShape(liveRow.phase).status} word={liveRow.label} /> : ''}</td>
            <td style={{ whiteSpace: 'nowrap' }}>
              {id && <>
                <button type="button" className="small" disabled={locked || !home?.flow} onClick={() => edit(C.moveFlowNode(p, id, -1, seqId), row.kind === 'step' ? '단계 위로' : '블록 위로')}>위로</button>
                <button type="button" className="small" disabled={locked || !home?.flow} onClick={() => edit(C.moveFlowNode(p, id, 1, seqId), row.kind === 'step' ? '단계 아래로' : '블록 아래로')}>아래로</button>
                <button type="button" className="small" disabled={locked || !home?.flow} onClick={() => edit(C.moveFlowOut(p, id, seqId), '블록 밖으로')}>밖으로</button>
              </>}
              {row.blockId && row.kind !== 'arm' && row.kind !== 'step' && row.kind !== 'wait' && <button type="button" className="small" disabled={locked} onClick={() => edit(C.unwrapFlow(p, row.blockId!, seqId), '블록 풀기')}>블록 풀기</button>}
              {row.kind === 'wait' && row.blockId && <button type="button" className="small" disabled={locked} onClick={() => edit(C.unwrapFlow(p, row.blockId!, seqId), '신호 기다림 삭제')}>삭제</button>}
              {row.armOf === 'branch' && (row.armCount ?? 0) > 2 && armIndex != null && <>
                <button type="button" className="small" disabled={locked || armIndex === 0} onClick={() => edit(C.moveBranchArm(p, row.blockId!, armIndex, -1, seqId), '갈래 위로')}>위로</button>
                <button type="button" className="small" disabled={locked || armIndex === (row.armCount ?? 1) - 1} onClick={() => edit(C.moveBranchArm(p, row.blockId!, armIndex, 1, seqId), '갈래 아래로')}>아래로</button>
              </>}
              {row.kind === 'arm' && row.arm != null && selected.length > 0 && <button type="button" className="small" disabled={locked} onClick={() => { if (edit(C.moveFlowInto(p, selected[0], row.blockId!, row.arm as Arm, seqId), '갈래로 옮기기')) setPicked(selected.slice(1)); }}>선택 넣기</button>}
            </td>
          </tr>;
        })}
        {rows.length === 0 && <tr><td colSpan={seqId ? 6 : 5}>시퀀스 단계가 없습니다.</td></tr>}
      </tbody>
    </table>
    {showLine && drop && <div className="flow-drop-line" data-testid="flow-drop-line" data-drop-list={drop.listKey} data-drop-index={drop.index} style={{ top: drop.y, left: drop.left + drop.depth * 16, width: Math.max(drop.width - drop.depth * 16, 48) }} />}
    {menu && <ContextMenu x={menu.x} y={menu.y} kind={menu.kind} items={menu.items} returnFocus={menu.focus} onRun={runMenu} onClose={() => setMenu(null)} />}
  </div>;
}
