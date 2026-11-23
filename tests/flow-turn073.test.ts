// TURN-073. A drag lands on the same tree as moveFlowNode / moveFlowInto / moveFlowOut.
import { describe, expect, it } from 'vitest';
import * as C from '../src/model/commands';
import { findById, nodeKey } from '../src/model/flow';
import { applyEdit, initHistory, undo } from '../src/model/history';
import { buildFlowSampleProject, buildSampleProject } from '../src/model/sample';
import type { FlowNode } from '../src/model/types';
import {
  dragIds, edgeScrollDelta, judgeDrop, listKeyFor, placeIndex, relocateFlow,
} from '../src/ui/flowDrag';
import { buildFlowMenu, flattenFlowRows, flowMenuKind } from '../src/ui/flowMenuModel';

function keys(nodes: FlowNode[] | undefined): string[] {
  return (nodes ?? []).map(nodeKey);
}

function bodyOf(p: { sequence: { flow?: FlowNode[] } }, id: string) {
  const n = findById(p.sequence.flow!, id)!.node;
  return structuredClone(n);
}

describe('TURN-073 flow drag model', () => {
  it('AC3 a same-list drop matches 위로 and 아래로', () => {
    const p0 = buildFlowSampleProject();
    const flow = p0.sequence.flow!;
    const first = flow[0].kind === 'step' ? flow[0].stepId : '';
    const second = flow[1].kind === 'step' ? flow[1].stepId : '';
    const up = relocateFlow(p0, [second], 'root', 0);
    const upCmd = C.moveFlowNode(p0, second, -1);
    expect(up?.ok).toBe(true);
    expect(upCmd.ok).toBe(true);
    if (!up?.ok || !upCmd.ok) return;
    expect(up.project.sequence.flow).toEqual(upCmd.project.sequence.flow);
    expect(up.project.revision).toBe(upCmd.project.revision);

    const down = relocateFlow(p0, [first], 'root', 2);
    const downCmd = C.moveFlowNode(p0, first, 1);
    expect(down?.ok && downCmd.ok).toBe(true);
    if (!down?.ok || !downCmd.ok) return;
    expect(down.project.sequence.flow).toEqual(downCmd.project.sequence.flow);
    expect(placeIndex(0, 1, 4, 4, 2, true)).toBe(1);
    expect(relocateFlow(p0, [second], 'root', 1)).toBeNull();
    expect(relocateFlow(p0, [second], 'root', 2)).toBeNull();
  });

  it('AC3 dropping into another arm matches 선택 넣기, and leaving a block matches 밖으로', () => {
    const p0 = buildFlowSampleProject();
    const branch = findById(p0.sequence.flow!, 'FLW-BRANCH')!;
    expect(branch.node.kind).toBe('branch');
    if (branch.node.kind !== 'branch') return;
    const step = p0.sequence.flow![0].kind === 'step' ? p0.sequence.flow![0].stepId : '';
    const into = relocateFlow(p0, [step], listKeyFor('FLW-BRANCH', 'else'), branch.node.else.length);
    const intoCmd = C.moveFlowInto(p0, step, 'FLW-BRANCH', 'else');
    expect(into?.ok && intoCmd.ok).toBe(true);
    if (!into?.ok || !intoCmd.ok) return;
    expect(into.project.sequence.flow).toEqual(intoCmd.project.sequence.flow);

    const out = relocateFlow(p0, ['FLW-LOOP'], 'root', branch.index + 1);
    const outCmd = C.moveFlowOut(p0, 'FLW-LOOP');
    expect(out?.ok && outCmd.ok).toBe(true);
    if (!out?.ok || !outCmd.ok) return;
    expect(out.project.sequence.flow).toEqual(outCmd.project.sequence.flow);
    expect(findById(out.project.sequence.flow!, 'FLW-LOOP')!.list).toBe(out.project.sequence.flow);
  });

  it('AC4 refuses a block inside itself and a parallel inside a parallel without changing the project', () => {
    const p0 = buildFlowSampleProject();
    const self = relocateFlow(p0, ['FLW-BRANCH'], listKeyFor('FLW-BRANCH', 'then'), 0);
    expect(self).toEqual({ ok: false, reason: '블록을 자기 자신 안에 넣을 수 없습니다' });
    expect(judgeDrop(p0.sequence.flow, ['FLW-BRANCH'], listKeyFor('FLW-BRANCH', 'else'), 1).reason).toBe('블록을 자기 자신 안에 넣을 수 없습니다');
    expect(p0.revision).toBe(1);

    const base = buildSampleProject();
    const ids = base.sequence.steps.slice(0, 4).map((s) => s.id);
    const first = C.wrapFlow(base, ids.slice(0, 2), 'parallel', () => 'P1');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = C.wrapFlow(first.project, ids.slice(2, 4), 'parallel', () => 'P2');
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const clash = relocateFlow(second.project, ['P2'], listKeyFor('P1', 0), 0);
    const cmd = C.moveFlowInto(second.project, 'P2', 'P1', 0);
    expect(clash).toEqual({ ok: false, reason: '병렬 갈래 안에는 병렬을 넣지 않습니다' });
    expect(cmd).toEqual({ ok: false, reason: '병렬 갈래 안에는 병렬을 넣지 않습니다' });
    expect(second.project.sequence.flow).toBe(second.project.sequence.flow);
  });

  it('AC5 moves a block with its body, and contiguous checked rows together', () => {
    const p0 = buildFlowSampleProject();
    const before = bodyOf(p0, 'FLW-RETRY');
    const moved = relocateFlow(p0, ['FLW-RETRY'], 'root', 4);
    const cmd = C.moveFlowNode(p0, 'FLW-RETRY', 1);
    expect(moved?.ok && cmd.ok).toBe(true);
    if (!moved?.ok || !cmd.ok) return;
    expect(moved.project.sequence.flow).toEqual(cmd.project.sequence.flow);
    expect(bodyOf(moved.project, 'FLW-RETRY')).toEqual(before);

    const flow = p0.sequence.flow!;
    const pair = [flow[0], flow[1]].map((n) => n.kind === 'step' ? n.stepId : '');
    expect(dragIds(flow, pair, pair[0])).toEqual({ ids: pair });
    expect(dragIds(flow, [pair[0], 'FLW-RETRY'], pair[0])).toEqual({ reason: '같은 갈래에서 연속된 단계만 묶을 수 있습니다' });
    expect(dragIds(flow, [pair[0]], pair[1])).toEqual({ ids: [pair[1]] });
    const together = relocateFlow(p0, pair, 'root', 4);
    expect(together?.ok).toBe(true);
    if (!together?.ok) return;
    expect(keys(together.project.sequence.flow).slice(-2)).toEqual(pair);
    expect(together.project.revision).toBe(p0.revision + 1);
  });

  it('AC6 one relocation is one undo, and a running project blocks it', () => {
    const p0 = buildFlowSampleProject();
    const step = p0.sequence.flow![1].kind === 'step' ? p0.sequence.flow![1].stepId : '';
    const h0 = initHistory(p0);
    const moved = relocateFlow(p0, [step], 'root', 0);
    expect(moved?.ok).toBe(true);
    if (!moved?.ok) return;
    const edited = applyEdit(h0, moved, '흐름 옮기기', false);
    expect(edited.history.past).toHaveLength(1);
    expect(edited.history.present.revision).toBe(p0.revision + 1);
    const back = undo(edited.history, false);
    expect(back.history.present.sequence.flow).toEqual(p0.sequence.flow);
    expect(back.history.past).toHaveLength(0);
    const locked = applyEdit(h0, moved, '흐름 옮기기', true);
    expect(locked.error).toContain('실행 중');
    expect(locked.history.present).toEqual(p0);
    expect(locked.history.past).toHaveLength(0);
  });

  it('AC7 building a menu does not change the project', () => {
    const p0 = buildFlowSampleProject();
    const rows = flattenFlowRows(p0, p0.sequence.flow!, 0);
    const snap = structuredClone(p0);
    for (const kind of ['step', 'branch', 'arm', 'substation', 'wait'] as const) {
      const row = rows.find((r) => r.kind === kind);
      if (!row && kind !== 'substation' && kind !== 'wait') throw new Error(kind);
      if (!row) continue;
      const items = buildFlowMenu({ p: p0, row, ordered: row.id ? [row.id] : [], locked: false });
      expect(flowMenuKind(row).startsWith('flow-')).toBe(true);
      expect(items[items.length - 1].id).toBe('delete');
      expect(items[items.length - 1].danger).toBe(true);
    }
    expect(p0).toEqual(snap);
    expect(edgeScrollDelta(4, 0, 400)).toBe(-16);
    expect(edgeScrollDelta(390, 0, 400)).toBe(16);
    expect(edgeScrollDelta(200, 0, 400)).toBe(0);
  });
});
