// TURN-052 condition formula and condition check. The run gate and the engine stay as they were.
import { describe, expect, it } from 'vitest';
import { checkConditions } from '../src/model/conditionCheck';
import { conditionFormula, conditionsFormula } from '../src/model/conditionFormula';
import { buildFlowSampleProject, buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import type { Condition, Project, SequenceStep } from '../src/model/types';
import { checkRunReadiness } from '../src/model/validate';
import { createRuntime, runToEnd } from '../src/runtime/engine';
import { evaluateSteps } from '../src/ui/wizard';

const ctx = { gaps: [], rt: null, saved: true, photoMissingKinds: [] };

function clone(p: Project): Project {
  return structuredClone(p);
}

describe('TURN-052 condition formula', () => {
  it('AC1 writes the five kinds and a bundle, and the same input stays the same line', () => {
    const p = buildSampleProject();
    const signal = p.signals.find((s) => s.deviceId === 'CYL-01' && s.portKey === 'fwdDone')!;
    const unit = p.units.find((u) => u.code === 'S2')!;
    const picker = p.devices.find((d) => d.id === 'PCK-04')!;
    const one: Condition = { kind: 'signal', signalId: signal.id, equals: true };
    const two: Condition = { kind: 'materialAt', unitId: unit.id };
    const three: Condition = { kind: 'materialState', state: '식별됨' };
    const four: Condition = { kind: 'materialHeldBy', deviceId: picker.id };
    const five: Condition = { kind: 'undefined', note: '메모' };
    const loose: Condition = { kind: 'materialHeldBy', deviceId: null };
    expect(conditionFormula(p, one)).toBe('CYL-01.전진 완료 = ON');
    expect(conditionFormula(p, { ...one, equals: false })).toBe('CYL-01.전진 완료 = OFF');
    expect(conditionFormula(p, two)).toBe('자재 위치 = S2 식별');
    expect(conditionFormula(p, three)).toBe('자재 상태 = 식별됨');
    expect(conditionFormula(p, four)).toBe('자재 잡음 = PCK-04');
    expect(conditionFormula(p, loose)).toBe('자재 잡음 = 없음');
    expect(conditionFormula(p, five)).toBe('미정(메모)');
    const line = conditionsFormula(p, [one, two]);
    expect(line).toBe('CYL-01.전진 완료 = ON 그리고 자재 위치 = S2 식별');
    expect(conditionsFormula(p, [one, two])).toBe(line);
    expect(conditionFormula(p, { kind: 'signal', signalId: 'gone', equals: true })).toBe('⚠없음:gone = ON');
  });
});

describe('TURN-052 condition check', () => {
  it('AC3 a missing signal, Unit, Device, or material state is a broken reference', () => {
    const p = clone(buildSampleProject());
    const action = p.actions[0];
    action.pre = [
      { kind: 'signal', signalId: 'NO-SIG', equals: true },
      { kind: 'materialAt', unitId: 'NO-UNIT' },
      { kind: 'materialHeldBy', deviceId: 'NO-DEV' },
      { kind: 'materialState', state: '없는상태' },
    ];
    const found = checkConditions(p).filter((f) => f.site === `action:${action.id}:pre` && f.kind === 'broken');
    expect(found.map((f) => f.level)).toEqual(['error', 'error', 'error', 'error']);
    expect(found.map((f) => f.reason).join('\n')).toContain('없는 신호 NO-SIG');
    expect(found.map((f) => f.reason).join('\n')).toContain('없는 Unit NO-UNIT');
    expect(found.map((f) => f.reason).join('\n')).toContain('없는 Device NO-DEV');
    expect(found.map((f) => f.reason).join('\n')).toContain('없는상태');
  });

  it('AC4 ON and OFF, two places, two states, and two holders are always false', () => {
    const p = clone(buildSampleProject());
    const action = p.actions[0];
    const signal = p.signals[0];
    const [a, b] = p.units;
    action.pre = [
      { kind: 'signal', signalId: signal.id, equals: true },
      { kind: 'signal', signalId: signal.id, equals: false },
      { kind: 'materialAt', unitId: a.id },
      { kind: 'materialAt', unitId: b.id },
      { kind: 'materialState', state: '대기' },
      { kind: 'materialState', state: '투입됨' },
      { kind: 'materialHeldBy', deviceId: null },
      { kind: 'materialHeldBy', deviceId: 'PCK-04' },
    ];
    const found = checkConditions(p).filter((f) => f.site === `action:${action.id}:pre` && f.kind === 'alwaysFalse');
    expect(found).toHaveLength(4);
    expect(found.every((f) => f.level === 'error')).toBe(true);
    expect(found[0].reason).toContain('ON 과 OFF');
    expect(found[1].reason).toContain('자재 위치');
    expect(found[2].reason).toContain('자재 상태');
    expect(found[3].reason).toContain('잡은 Device');
  });

  it('AC5 a repeated condition is a notice and an undefined condition is undetermined', () => {
    const p = clone(buildSampleProject());
    const action = p.actions[0];
    const signal = p.signals[0];
    action.pre = [
      { kind: 'signal', signalId: signal.id, equals: true },
      { kind: 'signal', signalId: signal.id, equals: true },
      { kind: 'undefined', note: '메모' },
    ];
    const found = checkConditions(p).filter((f) => f.site === `action:${action.id}:pre`);
    expect(found.map((f) => `${f.kind}:${f.level}`)).toEqual(['overlap:info', 'undetermined:undetermined']);
    expect(found[1].reason).toContain('통과하지 못합니다');
  });

  it('AC6 opposite signal pres in different lanes are a notice, and the same lane or a sequence is not', () => {
    const base = buildSampleProject();
    const signal = base.signals.find((s) => s.portKey === 'upDone')!;
    const left = base.sequence.steps[0];
    const right = base.sequence.steps[1];
    const third = base.sequence.steps[2];
    const on: Condition = { kind: 'signal', signalId: signal.id, equals: true };
    const off: Condition = { kind: 'signal', signalId: signal.id, equals: false };
    const set = (p: Project, step: SequenceStep, cond: Condition) => {
      const action = p.actions.find((a) => a.id === step.actionId)!;
      action.pre = [cond];
    };
    const opposite = clone(base);
    set(opposite, left, on);
    set(opposite, right, off);
    opposite.sequence.flow = [{
      kind: 'parallel', id: 'P1', name: '나란히',
      lanes: [[{ kind: 'step', stepId: left.id }], [{ kind: 'step', stepId: right.id }]],
    }];
    const hit = checkConditions(opposite).filter((f) => f.kind === 'opposite');
    expect(hit).toHaveLength(1);
    expect(hit[0].level).toBe('info');
    expect(hit[0].reason).toContain('동시에 만족되지 않을 수 있음');

    const same = clone(base);
    set(same, left, on);
    set(same, right, off);
    same.sequence.flow = [{
      kind: 'parallel', id: 'P2', name: '한 갈래',
      lanes: [[{ kind: 'step', stepId: left.id }, { kind: 'step', stepId: right.id }], [{ kind: 'step', stepId: third.id }]],
    }];
    expect(checkConditions(same).some((f) => f.kind === 'opposite')).toBe(false);

    const flat = clone(base);
    set(flat, left, on);
    set(flat, right, off);
    flat.sequence.flow = undefined;
    expect(checkConditions(flat).some((f) => f.kind === 'opposite')).toBe(false);
  });

  it('AC7 a pre OFF and a post ON are quiet, the three samples have no errors, and the run times stay', () => {
    const quiet = clone(buildSampleProject());
    const action = quiet.actions.find((a) => a.commandSignalId)!;
    action.pre = [{ kind: 'signal', signalId: action.commandSignalId!, equals: false }];
    action.post = [{ kind: 'signal', signalId: action.commandSignalId!, equals: true }];
    const own = checkConditions(quiet).filter((f) => f.site.startsWith(`action:${action.id}:`));
    expect(own).toEqual([]);

    const samples = [buildSampleProject(), buildParallelSampleProject(), buildFlowSampleProject()];
    for (const sample of samples) {
      const found = checkConditions(sample);
      expect(found.filter((f) => f.level === 'error')).toEqual([]);
      expect(found.filter((f) => f.level !== 'error').map((f) => `${f.kind} ${f.where}`)).toEqual([]);
    }
    expect(runToEnd(createRuntime(buildSampleProject())).state.timeMs).toBe(11100);
    expect(runToEnd(createRuntime(buildParallelSampleProject())).state.timeMs).toBe(2500);
    expect(runToEnd(createRuntime(buildFlowSampleProject())).state.timeMs).toBe(13100);
    const ready = checkRunReadiness(buildSampleProject());
    expect(ready.ok).toBe(true);
    expect(ready.blockers).toEqual([]);
  });

  it('AC10 the step-5 count includes condition errors and undetermined, and the same model stays in order', () => {
    const p = buildSampleProject();
    const before = evaluateSteps(p, ctx).check.items.length;
    const next = clone(p);
    const action = next.actions.find((a) => a.name.includes('시퀀스 미사용'))!;
    const signal = next.signals.find((s) => s.deviceId === action.deviceId)!;
    action.pre = [
      { kind: 'signal', signalId: signal.id, equals: true },
      { kind: 'signal', signalId: signal.id, equals: false },
      { kind: 'undefined', note: '메모' },
    ];
    const items = evaluateSteps(next, ctx).check.items.filter((i) => i.kind === 'condition');
    expect(items.map((i) => i.level)).toEqual(['missing', 'undetermined']);
    expect(evaluateSteps(next, ctx).check.items.length).toBe(before + 2);
    expect(evaluateSteps(next, ctx).check.ready).toBe(true);
    const again = checkConditions(next);
    expect(checkConditions(next)).toEqual(again);
  });
});
