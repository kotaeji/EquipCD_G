// TURN-073. Flow-table menu contents. Building the menu does not edit the project.
import * as C from '../model/commands';
import type { CmdResult } from '../model/commands';
import type { Condition, FlowNode, Project } from '../model/types';
import { armLabel, branchArms } from '../model/flow';
import { flowBlockWord } from './labels';
import { EDIT_LOCKED } from './contextMenuModel';
import { ROOT_LIST, branchListKey, listKeyFor } from './flowDrag';

export type FlowArm = 'then' | 'else' | 'body' | number;

export interface FlowRow {
  key: string;
  depth: number;
  kind: 'step' | 'branch' | 'parallel' | 'loop' | 'retry' | 'wait' | 'substation' | 'arm';
  title: string;
  stepId?: string;
  blockId?: string;
  arm?: FlowArm;
  armOf?: 'branch' | 'parallel';
  armCount?: number;
  /** Set on a multi-way arm. Null is 「그 밖」. Omitted on a two-arm branch. */
  armCond?: Condition | null;
  node?: FlowNode;
  id: string | null;
  listKey: string;
  index: number;
}

export type FlowMenuAction =
  | 'up' | 'down' | 'out' | 'into'
  | 'wrapBranch' | 'wrapParallel' | 'wrapLoop' | 'wrapRetry'
  | 'unwrap' | 'rename' | 'openAction' | 'delete';

export interface FlowMenuItem {
  id: FlowMenuAction;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  reason?: string;
  separatorBefore?: boolean;
}

export function flattenFlowRows(p: Project, nodes: FlowNode[], depth: number, listKey = ROOT_LIST): FlowRow[] {
  const out: FlowRow[] = [];
  nodes.forEach((n, index) => {
    if (n.kind === 'step') {
      const step = p.sequence.steps.find((s) => s.id === n.stepId);
      out.push({
        key: n.stepId, depth, kind: 'step', title: step?.name ?? n.stepId, stepId: n.stepId,
        id: n.stepId, listKey, index, node: n,
      });
      return;
    }
    const id = n.id;
    if (n.kind === 'branch') {
      const arms = branchArms(n);
      out.push({ key: id, depth, kind: 'branch', title: flowBlockWord('branch'), blockId: id, id, listKey, index, node: n, armCount: arms.length });
      arms.forEach((arm, i) => {
        out.push({
          key: `${id}:arm${i}`, depth: depth + 1, kind: 'arm', title: armLabel(arms.length, i),
          blockId: id, arm: i, armOf: 'branch', armCount: arms.length,
          armCond: arms.length > 2 ? arm.cond : undefined,
          id: null, listKey: branchListKey(id, i), index: -1,
        });
        out.push(...flattenFlowRows(p, arm.body, depth + 2, branchListKey(id, i)));
      });
    } else if (n.kind === 'parallel') {
      out.push({ key: id, depth, kind: 'parallel', title: flowBlockWord('parallel'), blockId: id, id, listKey, index, node: n });
      n.lanes.forEach((lane, i) => {
        out.push({ key: `${id}:lane${i}`, depth: depth + 1, kind: 'arm', title: `갈래 ${i + 1}`, blockId: id, arm: i, armOf: 'parallel', id: null, listKey: listKeyFor(id, i), index: -1 });
        out.push(...flattenFlowRows(p, lane, depth + 2, listKeyFor(id, i)));
      });
    } else if (n.kind === 'loop') {
      out.push({ key: id, depth, kind: 'loop', title: flowBlockWord('loop'), blockId: id, id, listKey, index, node: n });
      out.push(...flattenFlowRows(p, n.body, depth + 1, listKeyFor(id, 'body')));
    } else if (n.kind === 'retry') {
      out.push({ key: id, depth, kind: 'retry', title: flowBlockWord('retry'), blockId: id, id, listKey, index, node: n });
      out.push(...flattenFlowRows(p, n.body, depth + 1, listKeyFor(id, 'body')));
    } else if (n.kind === 'wait') {
      out.push({ key: id, depth, kind: 'wait', title: flowBlockWord('wait'), blockId: id, id, listKey, index, node: n });
    } else {
      const unit = p.units.find((u) => u.id === n.unitId);
      out.push({ key: id, depth, kind: 'substation', title: `Substation ${unit?.name ?? n.unitId}`, blockId: id, id, listKey, index, node: n });
    }
  });
  return out;
}

export function flowMenuKind(row: FlowRow): string {
  if (row.kind === 'step') return 'flow-step';
  if (row.kind === 'arm') return 'flow-arm';
  if (row.kind === 'substation') return 'flow-substation';
  if (row.kind === 'wait') return 'flow-wait';
  return 'flow-block';
}

/** Right-click an unchecked row checks only that row. A checked row keeps the checks. */
export function planFlowPick(picked: string[], id: string | null): string[] {
  if (!id) return picked;
  if (picked.includes(id)) return picked;
  return [id];
}

function fail(r: CmdResult): string | undefined {
  return r.ok ? undefined : r.reason;
}

function gate(id: FlowMenuAction, label: string, reason?: string, extra?: Partial<FlowMenuItem>): FlowMenuItem {
  return { id, label, ...extra, ...(reason ? { disabled: true, reason } : {}) };
}

const NAMED = new Set<FlowRow['kind']>(['branch', 'parallel', 'loop', 'retry', 'wait']);

export function buildFlowMenu(input: { p: Project; row: FlowRow; ordered: string[]; locked: boolean }): FlowMenuItem[] {
  const { p, row, ordered, locked } = input;
  const editLock = locked ? EDIT_LOCKED : undefined;
  const delLock = locked ? '실행 중에는 삭제가 차단됩니다' : undefined;
  const moveReason = (delta: number) => {
    if (row.kind === 'arm' && row.armOf === 'branch' && typeof row.arm === 'number' && row.blockId && (row.armCount ?? 0) > 2) {
      if (editLock) return editLock;
      return fail(C.moveBranchArm(p, row.blockId, row.arm, delta as -1 | 1));
    }
    if (!row.id) return '갈래는 옮기지 않습니다';
    if (editLock) return editLock;
    return fail(C.moveFlowNode(p, row.id, delta));
  };
  let intoReason: string | undefined;
  if (row.kind !== 'arm' || row.arm == null || !row.blockId) intoReason = '갈래 줄에서 고른 줄을 넣습니다';
  else if (editLock) intoReason = editLock;
  else if (ordered.length === 0) intoReason = '옮길 줄을 먼저 고르세요';
  else intoReason = fail(C.moveFlowInto(p, ordered[0], row.blockId, row.arm));
  const wrapReason = (kind: C.WrapKind) => editLock ?? fail(C.wrapFlow(p, ordered, kind));
  let unwrapReason: string | undefined;
  if (editLock) unwrapReason = editLock;
  else if (row.kind === 'wait') unwrapReason = '신호 기다림은 삭제로 뺍니다';
  else if (!row.id || row.kind === 'arm' || row.kind === 'step') unwrapReason = '블록 없음';
  else unwrapReason = fail(C.unwrapFlow(p, row.id));
  const renameReason = NAMED.has(row.kind) ? editLock : '이 줄은 이름을 바꾸지 않습니다';
  const step = row.stepId ? p.sequence.steps.find((s) => s.id === row.stepId) : undefined;
  const openReason = step && p.actions.some((a) => a.id === step.actionId) ? undefined : '이 줄에는 Action이 없습니다';
  let deleteReason: string | undefined;
  if (delLock) deleteReason = delLock;
  else if (row.kind === 'step' && row.stepId) deleteReason = fail(C.removeStep(p, row.stepId));
  else if (row.kind === 'wait' && row.blockId) deleteReason = fail(C.unwrapFlow(p, row.blockId));
  else if (row.kind === 'arm' && row.armOf === 'branch' && typeof row.arm === 'number' && row.blockId) deleteReason = fail(C.removeBranchArm(p, row.blockId, row.arm));
  else if (row.kind === 'arm' && row.armOf === 'parallel' && typeof row.arm === 'number' && row.blockId) deleteReason = fail(C.removeParallelLane(p, row.blockId, row.arm));
  else if (row.kind === 'arm') deleteReason = '참·거짓 갈래는 지울 수 없습니다';
  else deleteReason = '블록은 「블록 풀기」로 안의 줄을 남깁니다';
  return [
    gate('up', '위로', moveReason(-1)),
    gate('down', '아래로', moveReason(1)),
    gate('out', '밖으로', !row.id ? '갈래는 옮기지 않습니다' : editLock ?? fail(C.moveFlowOut(p, row.id))),
    gate('into', '선택 넣기', intoReason),
    gate('wrapBranch', '분기로 묶기', wrapReason('branch')),
    gate('wrapParallel', '병렬로 묶기', wrapReason('parallel')),
    gate('wrapLoop', '반복으로 묶기', wrapReason('loop')),
    gate('wrapRetry', '재시도로 묶기', wrapReason('retry')),
    gate('unwrap', '블록 풀기', unwrapReason),
    gate('rename', '이름 변경', renameReason),
    gate('openAction', '3단계 Action 열기', openReason),
    gate('delete', '삭제', deleteReason, { danger: true, separatorBefore: true }),
  ];
}
