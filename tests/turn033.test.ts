import { describe, expect, it } from 'vitest';
import { analyzeGaps, GAP_KIND_LABEL } from '../src/model/gaps';
import * as C from '../src/model/commands';
import { applyEdit, initHistory } from '../src/model/history';
import { buildFlowSampleProject, buildSampleProject } from '../src/model/sample';
import { createRuntime, runToEnd } from '../src/runtime/engine';
import { CYCLE_PENDING, describeRunInfo, THROUGHPUT_EMPTY, THROUGHPUT_NOTE } from '../src/scene/runInfo';
import { revertDurationEdits } from '../src/scene/revertDurations';

describe('TURN-033 run info numbers', () => {
  it('AC1 AC2 cycle and throughput follow a finished run and stay blank before it', () => {
    const sample = buildSampleProject();
    const before = describeRunInfo(sample, null);
    expect(before.cycleText).toBe(CYCLE_PENDING);
    expect(before.throughputText).toBe(THROUGHPUT_EMPTY);
    expect(before.throughputNote).toBe(THROUGHPUT_NOTE);

    const done = runToEnd(createRuntime(sample));
    const info = describeRunInfo(sample, done.state);
    expect(done.state.timeMs).toBe(11_100);
    expect(info.cycleText).toBe('00:11.100');
    expect(info.throughputText).toBe('324.3');

    const flow = buildFlowSampleProject();
    const flowDone = runToEnd(createRuntime(flow));
    const flowInfo = describeRunInfo(flow, flowDone.state);
    expect(flowDone.state.timeMs).toBe(13_100);
    expect(flowInfo.cycleText).toBe('00:13.100');
    expect(flowInfo.throughputText).toBe((Math.round((3_600_000 / 13_100) * 10) / 10).toFixed(1));

    const paused = createRuntime(sample);
    paused.state.status = 'running';
    expect(describeRunInfo(sample, paused.state).cycleText).toBe(CYCLE_PENDING);
    expect(describeRunInfo(sample, paused.state).throughputText).toBe(THROUGHPUT_EMPTY);
  });

  it('AC2 an error run has no throughput and keeps the virtual time as the cycle', () => {
    const project = buildSampleProject();
    const read = project.actions.find((a) => a.deviceId === 'BCR-02')!;
    project.simSettings.faults.neverTrueSignalIds = [read.completeSignalId!];
    const rt = runToEnd(createRuntime(project));
    expect(rt.state.status).toBe('error');
    const info = describeRunInfo(project, rt.state);
    expect(info.cycleText).toBe('00:03.100');
    expect(info.throughputText).toBe(THROUGHPUT_EMPTY);
  });

  it('AC3 the bottleneck is the first unit when totals tie, otherwise the greatest total', () => {
    const project = buildSampleProject();
    const done = describeRunInfo(project, runToEnd(createRuntime(project)).state);
    const max = Math.max(...done.unitTotals.map((row) => row.ms));
    expect(done.bottleneck?.unitId).toBe(done.unitTotals.find((row) => row.ms === max)!.unitId);
    expect(done.bottleneck!.timeText).toBe(done.unitTotals.find((row) => row.unitId === done.bottleneck!.unitId)!.timeText);

    for (const action of project.actions) action.duration = { ...action.duration, value: 0 };
    const first = project.units[0].id;
    const second = project.units[1].id;
    const a0 = project.actions.find((a) => a.unitId === first)!;
    const a1 = project.actions.find((a) => a.unitId === second)!;
    a0.duration = { ...a0.duration, value: 5 };
    a1.duration = { ...a1.duration, value: 5 };
    const tied = describeRunInfo(project, null);
    expect(tied.unitTotals.find((row) => row.unitId === first)!.ms).toBe(tied.unitTotals.find((row) => row.unitId === second)!.ms);
    expect(tied.bottleneck?.unitId).toBe(first);
  });

  it('AC4 gap counts use the same analyzeGaps result, including while a run exists', () => {
    const project = buildSampleProject();
    const gaps = analyzeGaps(project);
    const running = createRuntime(project);
    running.state.status = 'running';
    const info = describeRunInfo(project, running.state);
    expect(info.gapTotal).toBe(gaps.length);
    expect(info.gapKinds.map((row) => [row.kind, row.label, row.count])).toEqual(
      (['io', 'unit', 'axisSpec', 'interference', 'timing'] as const).map((kind) => [kind, GAP_KIND_LABEL[kind], gaps.filter((g) => g.kind === kind).length]),
    );
  });

  it('AC7 revert restores durations and timeouts and leaves another edit', () => {
    const project = buildSampleProject();
    const pusher = project.actions.find((a) => a.name === 'S1 푸셔 투입')!;
    const other = project.actions.find((a) => a.name === 'S5 컨베이어 배출')!;
    const snap = project.actions.map((a) => ({
      id: a.id,
      value: a.duration.value,
      assumption: a.duration.assumption,
      timeout: a.timeout.value,
      timeoutAssumption: a.timeout.assumption,
    }));
    let history = initHistory(project);
    history = applyEdit(history, C.setFaults(history.present, { ...history.present.simSettings.faults, readFailActionIds: [pusher.id] }), '읽기 실패 주입', false).history;
    history = applyEdit(history, C.setQuantity(history.present, { kind: 'action', id: pusher.id, field: 'duration' }, 1.5, true), '3D 동작 시간', false).history;
    history = applyEdit(history, C.setQuantity(history.present, { kind: 'action', id: pusher.id, field: 'timeout' }, 0.4, true), '3D 타임아웃', false).history;
    history = applyEdit(history, C.setQuantity(history.present, { kind: 'action', id: other.id, field: 'timeout' }, 1, true), '3D 타임아웃', false).history;
    history = applyEdit(history, C.renameObject(history.present, history.present.units[0].id, '이름 유지'), '이름', false).history;
    const back = revertDurationEdits(history, 0, snap);
    expect(back.present.actions.find((a) => a.id === pusher.id)!.duration.value).toBe(0.8);
    expect(back.present.actions.find((a) => a.id === pusher.id)!.timeout.value).toBe(pusher.timeout.value);
    expect(back.present.actions.find((a) => a.id === other.id)!.timeout.value).toBe(other.timeout.value);
    expect(back.present.actions.find((a) => a.id === other.id)!.duration.value).toBe(2);
    expect(back.present.simSettings.faults.readFailActionIds).toEqual([pusher.id]);
    expect(back.present.units[0].name).toBe('이름 유지');
  });
});
