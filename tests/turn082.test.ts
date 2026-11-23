import { describe, expect, it } from 'vitest';
import { applyEdit, initHistory, undo } from '../src/model/history';
import * as C from '../src/model/commands';
import {
  addRunScenario,
  captureRunScenario,
  commitRunScenario,
  deleteRunScenario,
  missingStepNote,
  projectForScenario,
  renameRunScenario,
  runAllScenarios,
  scenarioStatusText,
} from '../src/model/scenarios';
import { buildFlowSampleProject, buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import { FILE_FORMAT_VERSION, feedCountOf, type Project } from '../src/model/types';
import { createRuntime, runToEnd, start } from '../src/runtime/engine';
import { parseProjectFile, serializeProject } from '../src/storage/fileFormat';

function must(r: C.CmdResult): Project {
  if (!r.ok) throw new Error(r.reason);
  return r.project;
}

function timesOf(p: Project): string {
  return JSON.stringify(p.actions.map((a) => [a.id, a.duration, a.timeout]));
}

describe('TURN-082 run scenarios', () => {
  it('AC2 a scenario stores feed, faults, and speed, and not action times', () => {
    const p = buildSampleProject();
    const read = p.actions.find((a) => a.name.includes('바코드'))!;
    const work = p.actions.find((a) => a.name.includes('가공'))!;
    p.materials[0].feedCount = 3;
    p.materials[0].feedInterval = { ...p.materials[0].feedInterval, value: 0 };
    p.simSettings.faults = {
      readFailActionIds: [read.id],
      readFailFirstN: { [read.id]: 2 },
      neverTrueSignalIds: [work.completeSignalId!],
    };
    const before = timesOf(p);
    const scenario = captureRunScenario(p, 4, '재검사 길 확인', 'scn-1');
    expect(Object.keys(scenario).sort()).toEqual(['feedCount', 'feedInterval', 'id', 'injections', 'name', 'speed']);
    expect(scenario.feedCount).toBe(3);
    expect(scenario.feedInterval).toBe(0);
    expect(scenario.speed).toBe(4);
    expect(scenario.injections.some((row) => row.stepId && row.readFail && row.readFailFirstN === 2 && row.actionId === read.id)).toBe(true);
    expect(scenario.injections.some((row) => row.neverTrueSignalId === work.completeSignalId)).toBe(true);
    expect(JSON.stringify(scenario)).not.toMatch(/duration|timeout/);
    const saved = must(addRunScenario(p, 4, '재검사 길 확인', () => 'scn-1'));
    expect(timesOf(saved)).toBe(before);
    expect(saved.actions.find((a) => a.id === work.id)!.duration.value).toBe(work.duration.value);
    expect(saved.actions.find((a) => a.id === work.id)!.timeout.value).toBe(work.timeout.value);
  });

  it('AC3 save, rename, and delete are one undo, and a locked edit is refused', () => {
    const p = buildSampleProject();
    const h0 = initHistory(p);
    const saved = addRunScenario(p, 1, 'NG 길 확인', () => 'scn-1');
    const blocked = applyEdit(h0, saved, '시나리오 저장', true);
    expect(blocked.error).toMatch(/차단/);
    expect(blocked.history).toBe(h0);

    const h1 = applyEdit(h0, saved, '시나리오 저장', false);
    expect(h1.error).toBeUndefined();
    expect(h1.history.past).toHaveLength(1);
    expect(h1.history.present.revision).toBe(p.revision + 1);
    expect(h1.history.present.runScenarios?.map((s) => s.name)).toEqual(['NG 길 확인']);

    const renamed = applyEdit(h1.history, renameRunScenario(h1.history.present, 'scn-1', '재검사'), '시나리오 이름 바꾸기', false);
    expect(renamed.history.past).toHaveLength(2);
    expect(renamed.history.present.revision).toBe(p.revision + 2);
    expect(renamed.history.present.runScenarios?.[0].name).toBe('재검사');
    const nameBack = undo(renamed.history, false);
    expect(nameBack.history.present.runScenarios?.[0].name).toBe('NG 길 확인');
    expect(nameBack.history.past).toHaveLength(1);

    const removed = applyEdit(h1.history, deleteRunScenario(h1.history.present, 'scn-1'), '시나리오 삭제', false);
    expect(removed.history.past).toHaveLength(2);
    expect(removed.history.present.runScenarios).toBeUndefined();
    expect(removed.history.present.revision).toBe(p.revision + 2);
    const back = undo(removed.history, false);
    expect(back.history.present.runScenarios?.[0].id).toBe('scn-1');
    expect(back.history.present.revision).toBe(p.revision + 1);
  });

  it('AC4 round-trips scenarios and leaves files without them, including the three samples, unchanged', () => {
    expect(FILE_FORMAT_VERSION).toBe('0.3.0');
    for (const build of [buildSampleProject, buildParallelSampleProject, buildFlowSampleProject]) {
      const raw = serializeProject(build());
      expect(raw).not.toContain('runScenarios');
      expect(JSON.parse(raw).formatVersion).toBe('0.3.0');
      const parsed = parseProjectFile(raw);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.project.runScenarios).toBeUndefined();
      expect(serializeProject(parsed.project)).toBe(raw);
    }
    const bare = JSON.parse(serializeProject(buildSampleProject())) as { project: Project };
    delete bare.project.runScenarios;
    const opened = parseProjectFile(JSON.stringify(bare));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.project.runScenarios).toBeUndefined();

    const stored = must(addRunScenario(buildSampleProject(), 2, '재검사 길 확인', () => 'scn-keep'));
    const again = parseProjectFile(serializeProject(stored));
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.project.runScenarios).toEqual(stored.runScenarios);
    expect(JSON.parse(serializeProject(again.project)).formatVersion).toBe('0.3.0');
    const cleared = must(deleteRunScenario(again.project, 'scn-keep'));
    expect(cleared.runScenarios).toBeUndefined();
    expect(serializeProject(cleared)).not.toContain('runScenarios');
  });

  it('AC5 drops a missing step and counts it', () => {
    const p = buildSampleProject();
    const read = p.actions.find((a) => a.name.includes('바코드'))!;
    p.simSettings.faults = { readFailActionIds: [read.id], readFailFirstN: { [read.id]: 1 }, neverTrueSignalIds: [] };
    const scenario = captureRunScenario(p, 1, '실패', 'scn-1');
    const step = p.sequence.steps.find((s) => s.actionId === read.id)!;
    const removed = must(C.removeStep(p, step.id));
    expect(removed.actions.some((a) => a.id === read.id)).toBe(true);
    const applied = commitRunScenario(removed, scenario);
    expect(applied.dropped).toBe(1);
    expect(missingStepNote(applied.dropped)).toBe('단계 1개를 찾을 수 없어 뺐습니다');
    expect(applied.project.simSettings.faults.readFailActionIds).toEqual([]);
    expect(applied.project.simSettings.faults.readFailFirstN).toBeUndefined();
    expect(applied.changed).toBe(true);
  });

  it('AC6 a scenario run matches the same conditions entered by hand', () => {
    const flow = buildFlowSampleProject();
    const read = flow.actions.find((a) => a.name.includes('바코드'))!;
    const work = flow.actions.find((a) => a.name.includes('가공'))!;
    flow.materials[0].feedCount = 1;
    flow.simSettings.faults = {
      readFailActionIds: [read.id],
      neverTrueSignalIds: [],
    };
    const scenario = captureRunScenario(flow, 16, 'NG 길 확인', 'scn-ng');
    const clean = buildFlowSampleProject();
    const via = projectForScenario(clean, scenario).project;
    const hand = structuredClone(clean);
    hand.simSettings.faults = {
      readFailActionIds: [read.id],
      neverTrueSignalIds: [],
    };
    expect(timesOf(via)).toBe(timesOf(clean));
    expect(work.duration.value).toBe(via.actions.find((a) => a.id === work.id)!.duration.value);
    const scenarioRun = runToEnd(start(createRuntime(via, 'run-1')));
    const manualRun = runToEnd(start(createRuntime(hand, 'run-1')));
    expect(scenarioRun.state.status).toBe(manualRun.state.status);
    expect(scenarioRun.state.timeMs).toBe(manualRun.state.timeMs);
    expect(scenarioRun.state.error).toEqual(manualRun.state.error);
    expect(scenarioRun.state.log).toEqual(manualRun.state.log);

    const rows = runAllScenarios(clean, [scenario, captureRunScenario(clean, 1, '정상', 'scn-ok')]);
    expect(rows[0].totalMs).toBe(manualRun.state.timeMs);
    expect(rows[0].status).toBe(manualRun.state.status);
    expect(scenarioStatusText(rows[0])).toBe(manualRun.state.status === 'completed' ? '끝남' : manualRun.state.error?.code);
    expect(rows[1].status).toBe('completed');
    expect(rows[1].branchSummary).toContain('안 감: S2 NG 배출');
    expect(rows[0].branchSummary).not.toContain('안 감: S2 NG 배출');
    expect(rows.map((row) => row.name)).toEqual(['NG 길 확인', '정상']);
  });

  it('AC7 running every scenario leaves the open project and its revision alone', () => {
    const p = buildSampleProject();
    const read = p.actions.find((a) => a.name.includes('바코드'))!;
    const withFault = structuredClone(p);
    withFault.simSettings.faults = { readFailActionIds: [read.id], neverTrueSignalIds: [] };
    const scenarios = [
      captureRunScenario(p, 1, '정상', 'scn-ok'),
      captureRunScenario(withFault, 2, '읽기 실패', 'scn-bad'),
    ];
    const before = serializeProject(p);
    const rev = p.revision;
    const rows = runAllScenarios(p, scenarios);
    expect(serializeProject(p)).toBe(before);
    expect(p.revision).toBe(rev);
    expect(feedCountOf(p.materials[0])).toBe(1);
    expect(p.simSettings.faults.readFailActionIds).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe('completed');
    expect(rows[0].totalMs).toBe(runToEnd(start(createRuntime(p))).state.timeMs);
    expect(rows[1].status).toBe('error');
    expect(rows[1].code).toBe('READ_FAILED');
    expect(rows[1].totalMs).not.toBe(rows[0].totalMs);
  });
});
