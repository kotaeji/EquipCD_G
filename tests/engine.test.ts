import { describe, expect, it } from 'vitest';
import { buildSampleProject } from '../src/model/sample';
import { advance, createRuntime, pause, reset, resume, runToEnd, start } from '../src/runtime/engine';
import { checkRunReadiness } from '../src/model/validate';

const sample = () => buildSampleProject();

describe('runtime — 5공정 정상 (SC-AC1)', () => {
  it('sample model is ready to run', () => {
    const r = checkRunReadiness(sample());
    expect(r.blockers).toEqual([]);
    expect(r.ok).toBe(true);
  });
  it('runs S1..S5 sequentially and ends with material at EXIT / 배출 완료', () => {
    const rt = runToEnd(createRuntime(sample()));
    expect(rt.state.status).toBe('completed');
    expect(rt.state.material?.location).toBe('EXIT');
    expect(rt.state.material?.state).toBe('배출 완료');
    expect(rt.state.steps.every((s) => s.status === 'done')).toBe(true);
    expect(rt.state.timeMs).toBe(11100); // sum of [예시] durations
    const doneOrder = rt.state.log.filter((l) => l.code === 'STEP_DONE').map((l) => l.refId);
    expect(doneOrder).toEqual(sample().sequence.steps.map((s) => s.id));
  });
  it('material is conserved (exactly one instance, occupancy consistent) at every step', () => {
    let rt = start(createRuntime(sample()));
    for (let i = 0; i < 200 && rt.state.status === 'running'; i++) {
      rt = advance(rt, 73);
      const occ = Object.values(rt.state.occupancy).filter(Boolean);
      if (rt.state.material!.location === 'EXIT') expect(occ.length).toBe(0);
      else { expect(occ).toEqual([rt.state.material!.instanceId]); expect(rt.state.occupancy[rt.state.material!.location]).toBe(rt.state.material!.instanceId); }
    }
    expect(rt.state.status).toBe('completed');
  });
  it('S4 pick/place sets and clears holder; gantry position recorded', () => {
    let rt = start(createRuntime(sample()));
    rt = advance(rt, 0.8e3 + 0.3e3 + 0.5e3 + 1.2e3 + 0.3e3 + 2.0e3 + 1.0e3 + 0.6e3); // through S4 pick
    expect(rt.state.material?.holder).toBe('PCK-04');
    rt = advance(rt, 1500);
    expect(rt.state.devicePositions['GNT-04']).toBe('GNT-04.pos-place');
    rt = advance(rt, 600);
    expect(rt.state.material?.holder).toBeNull();
    expect(rt.state.material?.location).toBe('U-S5');
  });
});

describe('runtime — 결정성', () => {
  it('result is independent of dt chunking', () => {
    const a = runToEnd(createRuntime(sample()));
    let b = start(createRuntime(sample()));
    while (b.state.status === 'running') b = advance(b, 17);
    let c = start(createRuntime(sample()));
    while (c.state.status === 'running') c = advance(c, 1000);
    const strip = (r: typeof a) => r.state.log.filter((l) => l.code.startsWith('STEP')).map((l) => [l.t, l.code, l.refId]);
    expect(strip(b)).toEqual(strip(a));
    expect(strip(c)).toEqual(strip(a));
    expect(b.state.material).toEqual(a.state.material);
  });
  it('runtime never mutates the design model', () => {
    const p = sample();
    const before = JSON.stringify(p);
    runToEnd(createRuntime(p));
    expect(JSON.stringify(p)).toBe(before);
  });
});

describe('runtime — 타임아웃 (C04-AC3 / SC-AC2)', () => {
  it('S2 read-complete signal never rises → TIMEOUT at start+2.0s, later steps not passed', () => {
    const p = sample();
    const bcr = p.actions.find((a) => a.deviceId === 'BCR-02')!;
    p.simSettings.faults.neverTrueSignalIds = [bcr.completeSignalId!];
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.status).toBe('error');
    expect(rt.state.error?.code).toBe('TIMEOUT');
    expect(rt.state.error?.stepId).toBe('STEP-03');
    expect(rt.state.timeMs).toBe(800 + 300 + 2000);
    expect(rt.state.material?.location).toBe('U-S2');
    expect(rt.state.material?.state).toBe('투입됨');
    expect(rt.state.steps.slice(3).every((s) => s.status === 'pending')).toBe(true);
  });
  it('S3 work complete never rises → material NOT silently set to 가공됨 (F4-AC2)', () => {
    const p = sample();
    const cyl = p.actions.find((a) => a.deviceId === 'CYL-03')!;
    p.simSettings.faults.neverTrueSignalIds = [cyl.completeSignalId!];
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.error?.code).toBe('TIMEOUT');
    expect(rt.state.material?.state).toBe('식별됨');
  });
  it('barcode read fail is distinguished from timeout', () => {
    const p = sample();
    const bcr = p.actions.find((a) => a.deviceId === 'BCR-02')!;
    p.simSettings.faults.readFailActionIds = [bcr.id];
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.error?.code).toBe('READ_FAILED');
    expect(rt.state.material?.state).toBe('식별실패');
  });
  it('unmet precondition errors immediately with cause step', () => {
    const p = sample();
    p.materials[0].initialLocation = 'U-S2';
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.error?.code).toBe('PRE_UNMET');
    expect(rt.state.error?.stepId).toBe('STEP-01');
  });
});

describe('runtime — pause/resume/reset (C04-AC1/AC2, SC-AC3)', () => {
  it('pause freezes virtual time during S4; resume keeps remaining delay', () => {
    let rt = start(createRuntime(sample()));
    rt = advance(rt, 6500); // in S4 pick window (pick starts 6.1s)
    expect(rt.state.steps.find((s) => s.status === 'active')?.stepId).toBe('STEP-08');
    rt = pause(rt);
    const t = rt.state.timeMs;
    rt = advance(rt, 99999);
    expect(rt.state.timeMs).toBe(t);
    expect(rt.state.status).toBe('paused');
    rt = resume(rt);
    rt = advance(rt, 199);
    expect(rt.state.material?.holder).toBeNull();
    rt = advance(rt, 1);
    expect(rt.state.material?.holder).toBe('PCK-04'); // completes at 6.7s total virtual, paused span excluded
    expect(rt.state.timeMs).toBe(6700);
  });
  it('reset restores initial conditions', () => {
    const fresh = createRuntime(sample());
    let rt = start(fresh);
    rt = advance(rt, 7000);
    rt = reset(rt);
    expect(rt.state.status).toBe('idle');
    expect(rt.state.timeMs).toBe(0);
    expect(rt.state.material).toEqual(fresh.state.material);
    expect(rt.state.signals).toEqual(fresh.state.signals);
    expect(rt.state.occupancy).toEqual(fresh.state.occupancy);
  });
});

describe('readiness — 미정 조건 차단 (F5-AC3)', () => {
  it('missing complete signal / undefined timeout / undefined condition block run', () => {
    const p = sample();
    p.actions[0].completeSignalId = null;
    p.actions.find((a) => a.deviceId === 'BCR-02')!.timeout.value = null;
    p.actions.find((a) => a.deviceId === 'CYL-03')!.pre.push({ kind: 'undefined', note: '가공 지그 클램프 조건' });
    const r = checkRunReadiness(p);
    expect(r.ok).toBe(false);
    const codes = r.blockers.map((b) => b.code);
    expect(codes).toContain('NO_COMPLETE_SIGNAL');
    expect(codes).toContain('TIMEOUT_UNDEFINED');
    expect(codes).toContain('CONDITION_UNDEFINED');
    const rt = start(createRuntime(p));
    expect(rt.state.status).toBe('idle');
    expect(rt.state.blockers.length).toBeGreaterThan(0);
  });
});
