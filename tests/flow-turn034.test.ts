// TURN-034 parallel wrap splits selected rows into lanes. Samples and versions stay put.
import { describe, expect, it } from 'vitest';
import { applyEdit, initHistory, undo } from '../src/model/history';
import { buildFlowSampleProject, buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import * as C from '../src/model/commands';
import { findById, parallelWrapLanes } from '../src/model/flow';
import { checkRunReadiness } from '../src/model/validate';
import { createRuntime, runToEnd } from '../src/runtime/engine';
import { aggregateStepStatus, stepStatusLabel } from '../src/runtime/runSummary';
import { APP_VERSION, FILE_FORMAT_VERSION, RUNTIME_RULES_VERSION, type FlowNode, type Project } from '../src/model/types';

const keyOf = (n: FlowNode) => (n.kind === 'step' ? n.stepId : n.id);

function lanesOf(p: Project, id = 'P'): string[][] {
  const node = findById(p.sequence.flow ?? [], id)?.node;
  if (!node || node.kind !== 'parallel') throw new Error('parallel block missing');
  return node.lanes.map((lane) => lane.map(keyOf));
}

function wrap(p: Project, n: number) {
  const ids = p.sequence.steps.slice(0, n).map((s) => s.id);
  const result = C.wrapFlow(p, ids, 'parallel', () => 'P');
  expect(result.ok, ids.join(',')).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return { project: result.project, ids };
}

describe('TURN-034 parallel wrap lanes', () => {
  it('AC2 status priority is 오류 > 진행 중 > 정지 > 완료 > 건너뜀 > 대기 and the words come from stepStatusLabel', () => {
    const word = stepStatusLabel;
    expect(aggregateStepStatus([{ status: 'active' }, { status: 'stopped' }, { status: 'error' }])).toEqual({ phase: 'error', label: word('error') });
    expect(aggregateStepStatus([{ status: 'stopped' }, { status: 'active' }, { status: 'done' }])).toEqual({ phase: 'active', label: word('active') });
    expect(aggregateStepStatus([{ status: 'done' }, { status: 'stopped' }, { status: 'skipped' }])).toEqual({ phase: 'stopped', label: word('stopped') });
    expect(aggregateStepStatus([{ status: 'done' }, { status: 'done' }, { status: 'skipped' }, { status: 'pending' }])).toEqual({ phase: 'done', label: `${word('done')} 2회` });
    expect(aggregateStepStatus([{ status: 'skipped' }, { status: 'done' }])).toEqual({ phase: 'done', label: `${word('done')} · ${word('skipped')}` });
    expect(aggregateStepStatus([{ status: 'done' }])).toEqual({ phase: 'done', label: word('done') });
    expect(aggregateStepStatus([{ status: 'skipped' }, { status: 'pending' }])).toEqual({ phase: 'skipped', label: word('skipped') });
    expect(aggregateStepStatus([])).toEqual({ phase: 'pending', label: word('pending') });
    expect(word('active')).toBe('진행 중');
    expect(word('stopped')).toBe('정지');
    expect(aggregateStepStatus([{ status: 'active' }]).label).not.toBe('실행 중');
  });

  it('AC4 two, three, and four rows become one lane each; one row keeps an empty lane; five or more fill lane 4', () => {
    const base = buildSampleProject();
    for (const n of [2, 3, 4]) {
      const { project, ids } = wrap(base, n);
      expect(lanesOf(project)).toEqual(ids.map((id) => [id]));
    }
    const one = wrap(base, 1);
    expect(lanesOf(one.project)).toEqual([[one.ids[0]], []]);
    const five = wrap(base, 5);
    expect(lanesOf(five.project)).toEqual([[five.ids[0]], [five.ids[1]], [five.ids[2]], [five.ids[3], five.ids[4]]]);
    const six = wrap(base, 6);
    expect(lanesOf(six.project)).toEqual([[six.ids[0]], [six.ids[1]], [six.ids[2]], [six.ids[3], six.ids[4], six.ids[5]]]);
    expect(parallelWrapLanes([])).toEqual([[], []]);
  });

  it('AC5 one undo restores the wrap, and the lane rules still reject a bad wrap', () => {
    const p0 = buildSampleProject();
    const ids = p0.sequence.steps.slice(0, 3).map((s) => s.id);
    const edited = applyEdit(initHistory(p0), C.wrapFlow(p0, ids, 'parallel', () => 'P'), '병렬로 묶기', false);
    expect(edited.error).toBeUndefined();
    expect(lanesOf(edited.history.present)).toEqual(ids.map((id) => [id]));
    const back = undo(edited.history, false);
    expect(back.history.present).toEqual(p0);
    expect(back.history.present.sequence.flow).toBeUndefined();

    const split = wrap(p0, 2);
    const again = C.wrapFlow(split.project, split.ids, 'parallel');
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.reason).toBe('같은 갈래에서 연속된 단계만 묶을 수 있습니다');
    const together = C.moveFlowInto(split.project, split.ids[1], 'P', 0);
    expect(together.ok).toBe(true);
    if (!together.ok) return;
    const nested = C.wrapFlow(together.project, split.ids, 'parallel');
    expect(nested.ok).toBe(false);
    if (nested.ok) return;
    expect(nested.reason).toBe('병렬 갈래 안에는 병렬과 Substation 단계를 넣지 않습니다');
    expect(C.wrapFlow(together.project, split.ids, 'loop').ok).toBe(true);

    const gap = C.wrapFlow(p0, [p0.sequence.steps[0].id, p0.sequence.steps[2].id], 'parallel');
    expect(gap.ok).toBe(false);
    if (gap.ok) return;
    expect(gap.reason).toBe('같은 갈래에서 연속된 단계만 묶을 수 있습니다');

    const sub = C.addSubstationNode(p0, p0.units[0].id, () => 'FLW-SUB');
    expect(sub.ok).toBe(true);
    if (!sub.ok) return;
    const prev = sub.project.sequence.flow![sub.project.sequence.flow!.length - 2];
    const prevId = prev.kind === 'step' ? prev.stepId : prev.id;
    const withSub = C.wrapFlow(sub.project, [prevId, 'FLW-SUB'], 'parallel');
    expect(withSub.ok).toBe(false);
    if (withSub.ok) return;
    expect(withSub.reason).toBe('병렬 갈래 안에는 병렬과 Substation 단계를 넣지 않습니다');
  });

  it('AC6 two steps on different devices pass the pre-run check and run to the end', () => {
    const p0 = buildSampleProject();
    p0.sequence.steps = [];
    const cyl = p0.actions.find((a) => a.deviceId === 'CYL-01')!;
    const up = p0.actions.find((a) => a.name === 'S5 스토퍼 상승(정지)')!;
    expect(cyl.deviceId).not.toBe(up.deviceId);
    const first = C.addStep(p0, cyl.id, undefined, 'dnd', undefined, () => 'STEP-A');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = C.addStep(first.project, up.id, undefined, 'dnd', undefined, () => 'STEP-B');
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const wrapped = C.wrapFlow(second.project, ['STEP-A', 'STEP-B'], 'parallel', () => 'FLW-P');
    expect(wrapped.ok).toBe(true);
    if (!wrapped.ok) return;
    expect(lanesOf(wrapped.project, 'FLW-P')).toEqual([['STEP-A'], ['STEP-B']]);
    const ready = checkRunReadiness(wrapped.project);
    expect(ready.ok).toBe(true);
    const rt = runToEnd(createRuntime(wrapped.project));
    expect(rt.state.status).toBe('completed');
    expect(rt.state.error).toBeNull();
    expect(rt.state.steps.map((s) => [s.stepId, s.status])).toEqual([['STEP-A', 'done'], ['STEP-B', 'done']]);
  });

  it('AC7 sample times and version constants stay put', () => {
    expect(FILE_FORMAT_VERSION).toBe('0.3.0');
    expect(APP_VERSION).toBe('0.3.0-prototype');
    expect(RUNTIME_RULES_VERSION).toBe('seq-runtime/0.5.0');
    expect(runToEnd(createRuntime(buildFlowSampleProject())).state.timeMs).toBe(13100);
    expect(runToEnd(createRuntime(buildParallelSampleProject())).state.timeMs).toBe(2500);
    expect(runToEnd(createRuntime(buildSampleProject())).state.timeMs).toBe(11100);
  });
});
