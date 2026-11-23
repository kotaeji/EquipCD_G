import { describe, expect, it } from 'vitest';
import { applyEdit, initHistory, undo } from '../src/model/history';
import {
  applyLabVariant, formatDelta, formatLabMs, labBasis, labDiff, runLab, type LabVariant,
} from '../src/model/lab';
import { buildSampleProject } from '../src/model/sample';
import { serializeProject, parseProjectFile } from '../src/storage/fileFormat';
import { createRuntime, runToEnd, start } from '../src/runtime/engine';
import { summarizeRun } from '../src/runtime/runSummary';

function actionNamed(name: string) {
  const action = buildSampleProject().actions.find((item) => item.name === name);
  if (!action) throw new Error(name);
  return action;
}

const machined = () => actionNamed('S3 가공 실린더 전진(가상 작업)');

function variant(patch: Partial<LabVariant> & Pick<LabVariant, 'id' | 'name'>): LabVariant {
  return { durations: [], scale: null, timeouts: [], feedCount: null, ...patch };
}

describe('TURN-058 what-if compare', () => {
  it('AC3 lab total time matches 끝까지 for the sample and for one shorter action', () => {
    const sample = buildSampleProject();
    const action = machined();
    const baseline = runToEnd(start(createRuntime(sample)));
    const edited = structuredClone(sample);
    const target = edited.actions.find((item) => item.id === action.id)!;
    target.duration.value = 1;
    const manual = runToEnd(start(createRuntime(edited)));
    const report = runLab(sample, [variant({ id: 'lab-1', name: '짧게', durations: [{ actionId: action.id, value: 1 }] })]);
    expect(report.columns[0].status).toBe('completed');
    expect(report.columns[1].status).toBe('completed');
    expect(report.columns[0].totalMs).toBe(baseline.state.timeMs);
    expect(report.columns[1].totalMs).toBe(manual.state.timeMs);
    expect(report.columns[1].totalMs).toBeLessThan(report.columns[0].totalMs!);
    expect(summarizeRun(edited, manual.state).totalMs).toBe(manual.state.timeMs);
  });

  it('a scale of one half shortens every Action duration and the total time', () => {
    const sample = buildSampleProject();
    const plan = variant({ id: 'lab-1', name: '반', scale: 0.5 });
    const report = runLab(sample, [plan]);
    const applied = applyLabVariant(sample, plan);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    for (const before of sample.actions) {
      const after = applied.project.actions.find((item) => item.id === before.id)!;
      if (before.duration.value == null) continue;
      expect(after.duration.value).toBe(Math.round(before.duration.value * 500) / 1000);
      expect(after.duration.source?.note).toBe(labBasis('반'));
      expect(after.duration.assumption).toBe(true);
    }
    expect(report.columns[1].status).toBe('completed');
    expect(report.columns[1].totalMs).toBeLessThan(report.columns[0].totalMs!);
  });

  it('AC4 uses the existing cycle, throughput, bottleneck, and longest step', () => {
    const sample = buildSampleProject();
    const report = runLab(sample, [variant({ id: 'lab-1', name: '다섯', feedCount: 5, feedInterval: 0 })]);
    const fast = report.columns[1];
    expect(fast.status).toBe('completed');
    expect(fast.cycleBasis).toBe('정상 상태(가정)');
    expect(formatLabMs(fast.cycleMs!)).toBe('00:04.500');
    expect(fast.throughput).toBe(800);
    expect(fast.bottleneckName).toBe('S2 식별');
    expect(formatLabMs(fast.bottleneckMs!)).toBe('00:13.100');
    expect(fast.longestName).toContain('S3 가공');
    expect(fast.longestMs).toBe(2000);
    const base = report.columns[0];
    expect(base.cycleBasis).toBe('한 개 기준');
    const delta = fast.totalMs! - base.totalMs!;
    const pct = (delta / base.totalMs!) * 100;
    const text = formatDelta(fast.totalMs!, base.totalMs!);
    expect(delta).toBeGreaterThan(0);
    expect(text.startsWith('+')).toBe(true);
    expect(text).toContain(formatLabMs(delta));
    expect(text).toContain(`${pct.toFixed(1)}%`);
  });

  it('AC5 a blocked variant and a timeout leave the other column finished', () => {
    const sample = buildSampleProject();
    const action = machined();
    const report = runLab(sample, [
      variant({ id: 'lab-1', name: '간격 없음', feedCount: 2, feedInterval: null }),
      variant({ id: 'lab-2', name: '짧은 타임아웃', timeouts: [{ actionId: action.id, value: 0.1 }] }),
    ]);
    expect(report.columns.map((column) => column.status)).toEqual(['completed', 'blocked', 'error']);
    expect(report.columns[1].code).toBe('FEED_INTERVAL');
    expect(report.columns[1].detail).toContain('투입 간격');
    expect(report.columns[2].code).toBe('TIMEOUT');
    expect(report.columns[2].detail).toContain(action.name);
    expect(report.columns[0].totalMs).not.toBeNull();
  });

  it('AC6 the same model and variants produce the same table', () => {
    const sample = buildSampleProject();
    const action = machined();
    const variants = [variant({ id: 'lab-1', name: '짧게', durations: [{ actionId: action.id, value: 1 }] })];
    expect(runLab(sample, variants)).toEqual(runLab(sample, variants));
  });

  it('AC2 AC8 editing a variant does not touch the model, and apply is one undo with the lab name', () => {
    const sample = buildSampleProject();
    const action = machined();
    const before = serializeProject(sample);
    const plan = variant({ id: 'lab-1', name: '짧게', durations: [{ actionId: action.id, value: 1 }] });
    runLab(sample, [plan]);
    expect(serializeProject(sample)).toBe(before);
    expect(labDiff(sample, plan).map((row) => `${row.label} ${row.from} → ${row.to}`)).toEqual([
      `${action.name} 동작 시간 2 s → 1 s`,
    ]);

    const history = initHistory(sample);
    const locked = applyEdit(history, applyLabVariant(sample, plan), 'Evolution Lab 짧게', true);
    expect(locked.error).toContain('실행 중');
    expect(locked.history.present.revision).toBe(sample.revision);

    const applied = applyEdit(history, applyLabVariant(sample, plan), 'Evolution Lab 짧게', false);
    expect(applied.history.past).toHaveLength(1);
    expect(applied.history.present.revision).toBe(sample.revision + 1);
    const next = applied.history.present.actions.find((item) => item.id === action.id)!;
    expect(next.duration.value).toBe(1);
    expect(next.duration.assumption).toBe(true);
    expect(next.duration.source?.note).toBe(labBasis('짧게'));
    expect(next.duration.history?.[next.duration.history.length - 1]?.note).toBe(labBasis('짧게'));
    const untouched = applied.history.present.actions.find((item) => item.name === 'S1 푸셔 투입')!;
    expect(untouched.duration.source?.note).not.toBe(labBasis('짧게'));

    const parsed = parseProjectFile(serializeProject(applied.history.present));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.project.actions.find((item) => item.id === action.id)?.duration.source?.note).toBe(labBasis('짧게'));
    expect(serializeProject(applied.history.present)).not.toContain('"id":"lab-1"');

    const back = undo(applied.history, false);
    expect(back.history.present.revision).toBe(sample.revision);
    expect(back.history.present.actions.find((item) => item.id === action.id)?.duration.value).toBe(2);
    expect(back.history.past).toHaveLength(0);
  });

  it('keeps the lab name on a feed-count change and refuses a variant that changes nothing', () => {
    const sample = buildSampleProject();
    const same = variant({ id: 'lab-1', name: '그대로' });
    expect(applyLabVariant(sample, same).ok).toBe(false);
    const counted = variant({ id: 'lab-2', name: '많이', feedCount: 4, feedInterval: 0 });
    const applied = applyLabVariant(sample, counted);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.project.materials[0].feedCount).toBe(4);
    expect(applied.project.materials[0].feedInterval.value).toBe(0);
    expect(applied.project.materials[0].feedInterval.assumption).toBe(true);
    expect(applied.project.materials[0].feedInterval.source?.note).toBe(labBasis('많이'));
    expect(applied.project.assumptionsNote.some((line) => line.includes(labBasis('많이')) && line.includes('투입 개수 1 → 4'))).toBe(true);
    expect(applied.project.revision).toBe(sample.revision + 1);
  });
});
