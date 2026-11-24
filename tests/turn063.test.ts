// TURN-063: a branch may have two to four arms. Two arms stay the old file shape.
import { describe, expect, it } from 'vitest';
import { buildAuroraExport, serializeAuroraExport } from '../src/model/auroraExport';
import { checkConditions } from '../src/model/conditionCheck';
import * as C from '../src/model/commands';
import { armLabel, branchArms } from '../src/model/flow';
import { applyEdit, initHistory, undo } from '../src/model/history';
import { buildFlowSampleProject, buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import { FILE_FORMAT_VERSION, RUNTIME_RULES_VERSION, type FlowNode, type Project } from '../src/model/types';
import { checkRunReadiness } from '../src/model/validate';
import { createRuntime, runToEnd } from '../src/runtime/engine';
import { parseProjectFile, serializeProject } from '../src/storage/fileFormat';
import { branchArmField } from '../src/ui/blockerTarget';

function branchOf(p: Project): Extract<FlowNode, { kind: 'branch' }> {
  const node = p.sequence.flow?.find((n) => n.kind === 'branch');
  if (!node || node.kind !== 'branch') throw new Error('branch missing');
  return node;
}

describe('TURN-063 multi-way branch', () => {
  it('AC1 adds up to four arms, rejects a fifth, and each edit is one revision and one undo', () => {
    const p0 = buildFlowSampleProject();
    const id = 'FLW-BRANCH';
    expect(branchArms(branchOf(p0))).toHaveLength(2);
    let h = initHistory(p0);
    for (let n = 3; n <= 4; n++) {
      const next = applyEdit(h, C.addBranchArm(h.present, id), '갈래 추가', false);
      expect(next.error).toBeUndefined();
      h = next.history;
      expect(h.present.revision).toBe(p0.revision + (n - 2));
      expect(branchArms(branchOf(h.present))).toHaveLength(n);
      const back = undo(h, false);
      expect(branchArms(branchOf(back.history.present))).toHaveLength(n - 1);
      h = applyEdit(back.history, C.addBranchArm(back.history.present, id), '갈래 추가', false).history;
    }
    const fifth = C.addBranchArm(h.present, id);
    expect(fifth.ok).toBe(false);
    if (fifth.ok) return;
    expect(fifth.reason).toBe('갈래는 4개까지입니다');

    const removed = applyEdit(h, C.removeBranchArm(h.present, id, 1), '이 갈래 삭제', false);
    expect(removed.error).toBeUndefined();
    expect(removed.history.present.revision).toBe(h.present.revision + 1);
    expect(branchArms(branchOf(removed.history.present))).toHaveLength(3);
    expect(branchOf(undo(removed.history, false).history.present).cases).toHaveLength(2);

    const moved = applyEdit(h, C.moveBranchArm(h.present, id, 1, -1), '갈래 위로', false);
    expect(moved.error).toBeUndefined();
    expect(moved.history.present.revision).toBe(h.present.revision + 1);
    const before = branchArms(branchOf(h.present));
    const after = branchArms(branchOf(moved.history.present));
    expect(after[0].body).toEqual(before[1].body);
    expect(after[1].body).toEqual(before[0].body);
    expect(after[0].cond).toEqual(before[1].cond);
    const restored = undo(moved.history, false);
    expect(branchArms(branchOf(restored.history.present))[0].cond).toEqual(before[0].cond);
    expect(C.removeBranchArm(p0, id, 0).ok).toBe(false);
  });

  it('AC2 AC3 takes the first true arm, else 그 밖, and the log names the arm', () => {
    const base = buildSampleProject();
    const steps = base.sequence.steps.slice(0, 3);
    const flow = (first: string, second: string): Project => {
      const p = structuredClone(base);
      for (const step of steps) {
        const action = p.actions.find((a) => a.id === step.actionId);
        if (action) { action.pre = []; action.post = []; }
      }
      p.sequence.flow = [{
        kind: 'branch', id: 'B', name: '검사',
        cond: { kind: 'materialState', state: first },
        then: [{ kind: 'step', stepId: steps[0].id }],
        cases: [{ cond: { kind: 'materialState', state: second }, body: [{ kind: 'step', stepId: steps[1].id }] }],
        else: [{ kind: 'step', stepId: steps[2].id }],
      }];
      return p;
    };
    const run = (first: string, second: string) => {
      const p = flow(first, second);
      expect(checkRunReadiness(p).ok).toBe(true);
      const a = runToEnd(createRuntime(p));
      const b = runToEnd(createRuntime(structuredClone(p)));
      expect(a.state.log).toEqual(b.state.log);
      return a;
    };
    const first = run('대기', '식별실패');
    expect(first.state.status).toBe('completed');
    expect(first.state.steps.find((s) => s.stepId === steps[0].id)?.status).toBe('done');
    expect(first.state.steps.find((s) => s.stepId === steps[1].id)?.status).toBe('skipped');
    expect(first.state.steps.find((s) => s.stepId === steps[2].id)?.status).toBe('skipped');
    const line1 = first.state.log.find((l) => l.code === 'BRANCH_TAKEN')!;
    expect(line1.message).toContain('갈래 1');
    expect(line1.message).toContain(armLabel(3, 0));
    expect(line1.message).toContain('자재 상태 == 대기');

    const second = run('가공됨', '대기');
    expect(second.state.steps.find((s) => s.stepId === steps[1].id)?.status).toBe('done');
    expect(second.state.steps.find((s) => s.stepId === steps[0].id)?.status).toBe('skipped');
    expect(second.state.log.find((l) => l.code === 'BRANCH_TAKEN')!.message).toContain('갈래 2');

    const other = run('가공됨', '식별실패');
    expect(other.state.steps.find((s) => s.stepId === steps[2].id)?.status).toBe('done');
    expect(other.state.steps.filter((s) => s.stepId !== steps[2].id).every((s) => s.status === 'skipped')).toBe(true);
    const elseLine = other.state.log.find((l) => l.code === 'BRANCH_TAKEN')!;
    expect(elseLine.message).toContain('갈래 3');
    expect(elseLine.message).toContain('그 밖');
    expect(elseLine.message).toContain('앞 갈래가 모두 거짓');
    expect(elseLine.message).toContain('가공됨');
  });

  it('AC4 old two-arm files and the three examples keep their bytes and their times', () => {
    expect(FILE_FORMAT_VERSION).toBe('0.3.0');
    for (const p of [buildSampleProject(), buildParallelSampleProject(), buildFlowSampleProject()]) {
      const raw = serializeProject(p);
      expect(raw).not.toContain('"cases"');
      const opened = parseProjectFile(raw);
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      expect(serializeProject(opened.project)).toBe(raw);
    }
    expect(runToEnd(createRuntime(buildSampleProject())).state.timeMs).toBe(11100);
    expect(runToEnd(createRuntime(buildParallelSampleProject())).state.timeMs).toBe(2500);
    expect(runToEnd(createRuntime(buildFlowSampleProject())).state.timeMs).toBe(13100);
    const exported = serializeAuroraExport(buildAuroraExport(buildFlowSampleProject()));
    expect(exported).not.toContain('"cases"');
    const back = undo(applyEdit(initHistory(buildFlowSampleProject()), C.addBranchArm(buildFlowSampleProject(), 'FLW-BRANCH'), '갈래 추가', false).history, false);
    expect(serializeProject(back.history.present)).toBe(serializeProject(buildFlowSampleProject()));
  });

  it('AC6 a repeated later condition is 도달하지 않음 and does not block the run', () => {
    const p = buildSampleProject();
    const steps = p.sequence.steps.slice(0, 3);
    const same = { kind: 'materialState' as const, state: '대기' };
    p.sequence.flow = [{
      kind: 'branch', id: 'B', name: '검사',
      cond: same,
      then: [{ kind: 'step', stepId: steps[0].id }],
      cases: [{ cond: { ...same }, body: [{ kind: 'step', stepId: steps[1].id }] }],
      else: [{ kind: 'step', stepId: steps[2].id }],
    }];
    const hit = checkConditions(p).filter((f) => f.kind === 'unreachable');
    expect(hit).toHaveLength(1);
    expect(hit[0].level).toBe('info');
    expect(hit[0].reason).toContain('도달하지 않음');
    expect(hit[0].jump.field).toBe('flow:B:arm:1');
    expect(checkRunReadiness(p).ok).toBe(true);
    for (const sample of [buildSampleProject(), buildParallelSampleProject(), buildFlowSampleProject()]) {
      expect(checkConditions(sample).some((f) => f.kind === 'unreachable')).toBe(false);
    }
  });

  it('AC7 an empty arm does not block, and an undetermined condition still points at that arm', () => {
    const open = buildSampleProject();
    const step = open.sequence.steps[0];
    const action = open.actions.find((a) => a.id === step.actionId)!;
    action.pre = [];
    action.post = [];
    open.sequence.flow = [{
      kind: 'branch', id: 'B', name: '검사',
      cond: { kind: 'materialState', state: '대기' },
      then: [{ kind: 'step', stepId: step.id }],
      else: [],
    }];
    const ready = checkRunReadiness(open);
    expect(ready.blockers.some((b) => b.code === 'EMPTY_LANE')).toBe(false);
    expect(ready.ok).toBe(true);
    expect(runToEnd(createRuntime(open)).state.status).toBe('completed');
    const notice = checkConditions(open).find((f) => f.kind === 'emptyArm');
    expect(notice?.level).toBe('info');
    expect(notice?.reason).toContain('빈 갈래');
    expect(notice?.jump.field).toBe('flow:B:arm:1');

    const p = buildFlowSampleProject();
    const added = C.addBranchArm(p, 'FLW-BRANCH');
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const blocked = checkRunReadiness(added.project);
    expect(blocked.ok).toBe(false);
    expect(blocked.blockers.some((b) => b.code === 'EMPTY_LANE')).toBe(false);
    const unset = blocked.blockers.find((b) => b.code === 'CONDITION_UNDEFINED' && b.objectId === 'FLW-BRANCH');
    expect(unset?.message).toContain('미정 조건');
    expect(branchArmField(added.project, unset!)).toBe('flow:FLW-BRANCH:arm:1');
    expect(createRuntime(added.project).state.status).toBe('idle');
  });

  it('AC8 the runtime rule is seq-runtime/0.9.0', () => {
    expect(RUNTIME_RULES_VERSION).toBe('seq-runtime/0.9.0');
    expect(runToEnd(createRuntime(buildSampleProject())).state.rulesVersion).toBe('seq-runtime/0.9.0');
  });
});
