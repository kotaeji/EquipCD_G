import { describe, expect, it } from 'vitest';
import { buildAuroraExport } from '../src/model/auroraExport';
import * as C from '../src/model/commands';
import { analyzeRunGaps } from '../src/model/runGaps';
import { buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import { parseProjectFile, serializeProject } from '../src/storage/fileFormat';
import { INTERLOCK_NO_RULE } from '../src/model/interlock';
import { RUNTIME_RULES_VERSION, type Project } from '../src/model/types';
import { validateProject, checkRunReadiness } from '../src/model/validate';
import { createRuntime, runToEnd } from '../src/runtime/engine';
import { createGroupRuntime, runGroupToEnd } from '../src/runtime/group';

function moveStopperAfterCylinder(p: Project) {
  const steps = p.sequence.steps;
  const up = steps.findIndex((s) => s.name.includes('S3 스토퍼 상승'));
  const [step] = steps.splice(up, 1);
  const cyl = steps.findIndex((s) => s.name.includes('가공 실린더'));
  steps.splice(cyl + 1, 0, step);
}

function errorsOf(p: Project) {
  return validateProject(p).filter((d) => d.severity === 'error');
}

describe('TURN-046 interlock runtime', () => {
  it('AC1 AC13 an unconfirmed rule does not change the three examples, and the rules version moved', () => {
    expect(RUNTIME_RULES_VERSION).toBe('seq-runtime/0.8.0');
    for (const build of [buildSampleProject, buildParallelSampleProject]) {
      const rt = runToEnd(createRuntime(build()));
      expect(rt.state.status).toBe('completed');
      expect(rt.state.rulesVersion).toBe('seq-runtime/0.8.0');
      expect(rt.state.log.some((l) => l.code === 'INTERLOCK_BLOCK')).toBe(false);
    }
    expect(runToEnd(createRuntime(buildSampleProject())).state.timeMs).toBe(11100);
  });

  it('AC2 confirming IL-01 on the sample order still finishes at 00:11.100', () => {
    const p = buildSampleProject();
    p.constraints[0].confirmation = 'confirmed';
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.status).toBe('completed');
    expect(rt.state.timeMs).toBe(11100);
    expect(rt.state.error).toBeNull();
  });

  it('AC3 a false allow condition stops the cylinder step with INTERLOCK_BLOCK', () => {
    const p = buildSampleProject();
    moveStopperAfterCylinder(p);
    p.constraints[0].confirmation = 'confirmed';
    const rt = runToEnd(createRuntime(p));
    const cyl = p.sequence.steps.find((s) => s.name.includes('가공 실린더'))!;
    expect(rt.state.status).toBe('error');
    expect(rt.state.error?.code).toBe('INTERLOCK_BLOCK');
    expect(rt.state.error?.stepId).toBe(cyl.id);
    expect(rt.state.error?.message).toContain('IL-01');
    expect(rt.state.error?.message).toContain(p.constraints[0].description);
    expect(rt.state.error?.message).toContain('거짓');
    expect(rt.state.log.some((l) => l.code === 'STEP_START' && l.refId === cyl.id)).toBe(false);
    expect(rt.state.log.some((l) => l.code === 'PRE_UNMET')).toBe(false);
    expect(rt.state.interlockBlocks).toEqual([
      expect.objectContaining({ interlockId: 'IL-01', stepId: cyl.id, reason: expect.stringContaining('거짓') }),
    ]);
    const gap = analyzeRunGaps(p, rt.state).find((g) => g.id.includes('INTERLOCK_BLOCK'));
    expect(gap?.title).toContain('Interlock');
    expect(gap?.fix).toEqual({ to: 'interlock', interlockId: 'IL-01' });
  });

  it('AC4 the same reordered model is not stopped by an unconfirmed or rejected interlock', () => {
    for (const confirmation of ['unconfirmed', 'rejected'] as const) {
      const p = buildSampleProject();
      moveStopperAfterCylinder(p);
      p.constraints[0].confirmation = confirmation;
      const rt = runToEnd(createRuntime(p));
      expect(rt.state.error?.code).not.toBe('INTERLOCK_BLOCK');
      expect(rt.state.log.some((l) => l.code === 'INTERLOCK_BLOCK')).toBe(false);
      expect(rt.state.error?.code).toBe('PRE_UNMET');
    }
  });

  it('AC5 a parallel mutex waits for the other action and records Interlock', () => {
    const p = buildSampleProject();
    const move = p.sequence.steps.find((s) => s.name.includes('갠트리'))!;
    const place = p.sequence.steps.find((s) => s.name.includes('피커 놓기'))!;
    for (const id of [move.actionId, place.actionId]) {
      const action = p.actions.find((a) => a.id === id)!;
      action.pre = [];
      action.post = [];
    }
    p.sequence.flow = [{ kind: 'parallel', id: 'FLW-IL', name: '이송', lanes: [[{ kind: 'step', stepId: move.id }], [{ kind: 'step', stepId: place.id }]] }];
    p.constraints[1].confirmation = 'confirmed';
    const ready = checkRunReadiness(p);
    expect(ready.blockers).toEqual([]);
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.status).toBe('completed');
    expect(rt.state.error).toBeNull();
    const waited = rt.state.steps.find((s) => s.stepId === place.id)!;
    expect(waited.waitNote).toContain('Interlock');
    expect(waited.waitMs).toBe(1500);
    expect(rt.state.log.some((l) => l.code === 'WAIT' && l.message.includes('Interlock'))).toBe(true);
    expect(rt.state.log.some((l) => l.code === 'INTERLOCK_BLOCK')).toBe(false);
    const again = runToEnd(createRuntime(p));
    expect(again.state.log).toEqual(rt.state.log);
  });

  it('AC6 three pieces follow the same allow error and mutex wait', () => {
    const blocked = buildSampleProject();
    moveStopperAfterCylinder(blocked);
    blocked.constraints[0].confirmation = 'confirmed';
    blocked.materials[0].feedCount = 3;
    const stopped = runToEnd(createRuntime(blocked));
    expect(stopped.state.error?.code).toBe('INTERLOCK_BLOCK');
    expect(stopped.state.error?.message).toContain('개체 1');
    expect(stopped.state.error?.message).toContain('IL-01');

    const waiting = buildSampleProject();
    const move = waiting.actions.find((a) => a.name.includes('갠트리'))!;
    const place = waiting.actions.find((a) => a.name.includes('피커 놓기'))!;
    move.duration = { ...move.duration, value: 3 };
    move.pre = [];
    move.effect = {};
    place.pre = [];
    place.post = [];
    place.effect = {};
    const s1 = waiting.units.find((u) => u.code === 'S1')!;
    s1.capacity.maxMaterials = { ...s1.capacity.maxMaterials, value: 3 };
    waiting.sequence.steps = [
      { id: 'STEP-P', name: place.name, actionId: place.id, timeoutOverride: null, entry: [], origin: 'sample' },
      { id: 'STEP-M', name: move.name, actionId: move.id, timeoutOverride: null, entry: [], origin: 'sample' },
    ];
    waiting.materials[0].feedCount = 3;
    waiting.materials[0].feedInterval = { ...waiting.materials[0].feedInterval, value: 1 };
    waiting.constraints[1].confirmation = 'confirmed';
    const ready = checkRunReadiness(waiting);
    expect(ready.blockers).toEqual([]);
    const rt = runToEnd(createRuntime(waiting));
    expect(rt.state.status).toBe('completed');
    const placeRows = rt.state.steps.filter((s) => s.stepId === 'STEP-P' && s.waitNote);
    expect(placeRows.length).toBeGreaterThan(0);
    expect(placeRows.every((s) => s.waitNote!.includes('Interlock'))).toBe(true);
    expect(rt.state.log.some((l) => l.code === 'INTERLOCK_BLOCK')).toBe(false);
  });

  it('AC9 a confirmed interlock with no rule is a notice and does not stop the run', () => {
    const p = buildSampleProject();
    p.constraints[0].confirmation = 'confirmed';
    delete p.constraints[0].rule;
    const ready = checkRunReadiness(p);
    expect(ready.ok).toBe(true);
    expect(ready.blockers).toEqual([]);
    expect(ready.warnings.some((w) => w.code === 'INTERLOCK_NO_RULE' && w.message.includes(INTERLOCK_NO_RULE))).toBe(true);
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.status).toBe('completed');
    expect(rt.state.timeMs).toBe(11100);
  });

  it('AC10 deleting the action or the signal clears the rule and leaves no validate error', () => {
    const byAction = buildSampleProject();
    const cyl = byAction.actions.find((a) => a.name.includes('가공 실린더'))!;
    const removed = C.deleteAction(byAction, cyl.id);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    const rule = removed.project.constraints.find((k) => k.id === 'IL-01')!.rule;
    expect(rule?.form).toBe('undetermined');
    expect(JSON.stringify(rule)).not.toContain(cyl.id);
    expect(errorsOf(removed.project)).toEqual([]);

    const bySignal = buildSampleProject();
    const signalId = bySignal.constraints[0].rule?.form === 'allow' ? bySignal.constraints[0].rule.conditions[0] : null;
    expect(signalId && signalId.kind === 'signal').toBe(true);
    if (!signalId || signalId.kind !== 'signal') return;
    const dropped = C.deleteSignal(bySignal, signalId.signalId);
    expect(dropped.ok).toBe(true);
    if (!dropped.ok) return;
    const cleared = dropped.project.constraints.find((k) => k.id === 'IL-01')!.rule;
    expect(cleared?.form).toBe('undetermined');
    expect(JSON.stringify(cleared)).not.toContain(signalId.signalId);
    expect(errorsOf(dropped.project)).toEqual([]);
  });

  it('AC11 a saved file keeps the rule, and a confirmed export carries it', () => {
    const p = buildSampleProject();
    const raw = serializeProject(p);
    const back = parseProjectFile(raw);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.project.constraints.map((k) => k.rule)).toEqual(p.constraints.map((k) => k.rule));

    p.constraints[0].confirmation = 'confirmed';
    const doc = buildAuroraExport(p);
    expect(doc.interlocks.map((k) => k.id)).toEqual(['IL-01']);
    expect(doc.interlocks[0].rule).toEqual(p.constraints[0].rule);
    expect(doc.excluded.some((x) => x.id === 'IL-02')).toBe(true);
  });

  it('a substation group waits on a mutex instead of stopping', () => {
    const p = buildParallelSampleProject();
    const a = p.actions.find((x) => x.name === 'A 클램프 상승')!;
    const b = p.actions.find((x) => x.name === 'B 클램프 상승')!;
    p.constraints.push({
      id: 'IL-G', kind: 'interlock-candidate', description: 'B는 A가 움직이는 동안 시작하지 않음',
      relatedIds: [a.deviceId, b.deviceId], confirmation: 'confirmed', source: { method: 'direct-input' },
      rule: { form: 'mutex', actionId: b.id, otherActionId: a.id },
    });
    const rt = runGroupToEnd(createGroupRuntime(p, p.units[0].id));
    expect(rt.state.status).toBe('completed');
    expect(rt.state.error).toBeNull();
    expect(rt.state.log.some((l) => l.code === 'WAIT' && l.message.includes('Interlock'))).toBe(true);
  });
});
