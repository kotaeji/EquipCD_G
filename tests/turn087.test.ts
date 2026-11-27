// TURN-087. Order lines name what changed. The status line follows the model.
import { describe, expect, it } from 'vitest';
import { emptyProject, makeUnit } from '../src/model/factory';
import { describeOrderChange, diffProjects, type OrderEntry } from '../src/model/projectDiff';
import type { FlowNode, Project, SequenceDraft, SequenceStep } from '../src/model/types';
import { syncTrackedPlace } from '../src/ui/canvasKeyboard';

function step(id: string, name: string): SequenceStep {
  return { id, name, actionId: 'ACT', timeoutOverride: null, entry: [], origin: 'sample' };
}

function node(id: string): FlowNode {
  return { kind: 'step', stepId: id };
}

function wait(id = 'flow-secret'): FlowNode {
  return {
    kind: 'wait', id, name: '신호 기다림',
    cond: { kind: 'undefined', note: '없음' },
    timeout: { value: null, unit: 's', assumption: true },
  };
}

function project(seq: SequenceDraft, extra?: (p: Project) => void): Project {
  let n = 0;
  const p = emptyProject('순서', (prefix) => `${prefix}-${++n}`);
  const unit = makeUnit('S2', 'S2', { x: 0, y: 0, w: 200, h: 120 }, () => 'U-S2');
  p.units = [unit];
  p.equipment.unitIds = [unit.id];
  p.sequence = seq;
  extra?.(p);
  return p;
}

function order(diff: ReturnType<typeof diffProjects>, field: string, id?: string) {
  const row = diff.rows.find((r) => r.orderText && r.field === field && (id === undefined || r.id === id));
  if (!row?.orderText) throw new Error(`no order line ${field}`);
  return row;
}

describe('TURN-087 order lines', () => {
  it('AC1 an added step is named after the step in front, with no internal id', () => {
    const before = project({
      id: 'SEQ', name: 'Station', unresolved: [],
      steps: [step('s1', 'S1'), step('s2', 'S2')],
      flow: [node('s1'), node('s2')],
    });
    const after = structuredClone(before);
    after.sequence.flow!.push(wait());
    const diff = diffProjects(before, after);
    const row = order(diff, '흐름');
    expect(row.orderText).toBe('더함: 신호 기다림(S2 뒤)');
    expect(row.after).toBe(row.orderText);
    expect(row.before).toBe('');
    expect(row.orderText).not.toContain('flow-secret');
    expect(row.orderText).not.toContain('s1');
    expect(row.orderText).not.toContain('s2');
    expect(diffProjects(structuredClone(before), structuredClone(after))).toEqual(diff);
  });

  it('AC2 a removal and a move use 뺌 and 옮김 with the old and new place', () => {
    const steps = [step('a', 'S1'), step('b', 'S2'), step('d', 'S4 피커 잡기'), step('x', '사이'), step('y', '끝'), step('c', 'S3 스토퍼 상승')];
    const removed = project({
      id: 'SEQ', name: 'Station', unresolved: [],
      steps, flow: [node('a'), node('b'), node('c')],
    });
    const without = structuredClone(removed);
    without.sequence.flow = [node('a'), node('b')];
    expect(order(diffProjects(removed, without), '흐름').orderText).toBe('뺌: S3 스토퍼 상승');

    const moved = project({
      id: 'SEQ', name: 'Station', unresolved: [],
      steps, flow: [node('a'), node('b'), node('d'), node('x'), node('y')],
    });
    const shifted = structuredClone(moved);
    shifted.sequence.flow = [node('a'), node('b'), node('x'), node('y'), node('d')];
    expect(order(diffProjects(moved, shifted), '흐름').orderText).toBe('옮김: S4 피커 잡기 3번째 → 5번째');
  });

  it('AC3 a substation sequence and a block body use the same sentence', () => {
    const steps = [step('a', 'S2'), step('c', 'S3 스토퍼 상승')];
    const beforeFlow = [node('a'), node('c')];
    const afterFlow = [node('a')];
    const loop = (body: FlowNode[]): FlowNode => ({ kind: 'loop', id: 'LOOP', name: '반복', count: 2, body });
    const before = project({
      id: 'SEQ', name: 'Station', unresolved: [],
      steps, flow: [loop(beforeFlow)],
    }, (p) => {
      p.substationSequences = [{
        id: 'SUB', name: 'S2 시퀀스', unitId: 'U-S2', unresolved: [],
        steps, flow: beforeFlow,
      }];
    });
    const after = structuredClone(before);
    after.sequence.flow = [loop(afterFlow)];
    after.substationSequences![0].flow = afterFlow;
    after.substationSequences![0].steps = [step('a', 'S2')];
    const diff = diffProjects(before, after);
    const block = order(diff, '순서', 'LOOP').orderText;
    const subFlow = order(diff, '흐름', 'SUB').orderText;
    const subSteps = order(diff, '단계 순서', 'SUB').orderText;
    expect(block).toBe('뺌: S3 스토퍼 상승');
    expect(subFlow).toBe(block);
    expect(subSteps).toBe(block);
    expect(diffProjects(structuredClone(before), structuredClone(after))).toEqual(diff);
  });

  it('AC4 more than six changes end with 그 밖 N개 and the same models repeat', () => {
    const entries: OrderEntry[] = Array.from({ length: 7 }, (_, i) => ({ id: `id-${i}`, name: `단계${i + 1}` }));
    const text = describeOrderChange([], entries);
    expect(text.startsWith('더함: 단계1(맨 앞)')).toBe(true);
    expect(text).toContain('더함: 단계6(단계5 뒤)');
    expect(text.endsWith('그 밖 1개')).toBe(true);
    expect(text).not.toContain('단계7');
    expect(text).not.toContain('id-');
    expect(describeOrderChange([], entries)).toBe(text);

    const before = project({ id: 'SEQ', name: 'Station', unresolved: [], steps: [] });
    const after = structuredClone(before);
    after.sequence.steps = entries.map((e) => step(e.id, e.name));
    const diff = diffProjects(before, after);
    expect(order(diff, '단계 순서').orderText).toBe(text);
    expect(diffProjects(structuredClone(before), structuredClone(after))).toEqual(diff);

    const mixed = describeOrderChange(
      [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }],
      [{ id: 'a', name: 'A' }, { id: 'd', name: 'D' }, { id: 'c', name: 'C' }],
    );
    expect(mixed).toBe('뺌: B · 더함: D(A 뒤)');
    expect(describeOrderChange(
      [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      [{ id: 'a', name: 'A' }, { id: 'w', name: 'W' }, { id: 'b', name: 'B' }],
    )).toBe('더함: W(A 뒤)');
    expect(describeOrderChange(
      [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      [{ id: 'b', name: 'B' }, { id: 'a', name: 'A' }],
    )).toBe('옮김: A 1번째 → 2번째');
  });

  it('a renamed step is not an order change', () => {
    const before = project({
      id: 'SEQ', name: 'Station', unresolved: [],
      steps: [step('s1', 'S1')],
    });
    const after = structuredClone(before);
    after.sequence.steps[0].name = '다른 이름';
    const diff = diffProjects(before, after);
    expect(diff.rows.filter((r) => r.orderText)).toEqual([]);
    expect(diff.rows.find((r) => r.kind === 'step' && r.field === '이름')?.after).toBe('다른 이름');
  });
});

describe('TURN-087 status line coordinates', () => {
  it('follows a move and clears when the node is gone', () => {
    const track = { id: 'U-S1', x: 30, y: 70 };
    expect(syncTrackedPlace(track, { id: 'U-S1', label: 'S1 투입', x: 30, y: 70 }).place).toBeNull();
    expect(syncTrackedPlace(track, { id: 'U-S1', label: 'S1 투입', x: 40, y: 70 })).toEqual({
      track: { id: 'U-S1', x: 40, y: 70 },
      place: 'S1 투입 (40, 70)',
    });
    expect(syncTrackedPlace({ id: 'U-S1', x: 40, y: 70 }, { id: 'U-S1', label: 'S1 투입', x: 30, y: 70 }).place).toBe('S1 투입 (30, 70)');
    expect(syncTrackedPlace(track, null)).toEqual({ track: null, place: '' });
  });
});
