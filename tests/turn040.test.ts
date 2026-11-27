import { describe, expect, it } from 'vitest';
import { emptyProject, instantiateDevice, makeUnit } from '../src/model/factory';
import { linearFlow } from '../src/model/flow';
import { setFeedCount, setQuantity, unwrapFlow, wrapFlow } from '../src/model/commands';
import { buildFlowSampleProject, buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import { feedCountOf, q, RUNTIME_RULES_VERSION, type Project } from '../src/model/types';
import { checkRunReadiness } from '../src/model/validate';
import { parseProjectFile, serializeProject } from '../src/storage/fileFormat';
import { advance, createRuntime, pause, reset, resume, runToEnd, start } from '../src/runtime/engine';
import { describeScene } from '../src/scene/describe';
import { anchorLabels } from '../src/scene/labels';
import { describeRunInfo, steadyCycleMs } from '../src/scene/runInfo';
import { waitingLead } from '../src/ui/status';
import { resolveBlocker } from '../src/ui/blockerTarget';

function fed(p: Project, count: number, interval: number | null): Project {
  const id = p.materials[0].id;
  const counted = setFeedCount(p, id, count);
  if (!counted.ok) throw new Error(counted.reason);
  const timed = setQuantity(counted.project, { kind: 'material', id, field: 'feedInterval' }, interval, true);
  if (!timed.ok) throw new Error(timed.reason);
  return timed.project;
}

describe('TURN-040 multi-piece feed', () => {
  it('AC1 a feed count of 1 matches the single-piece 5-step run', () => {
    const plain = runToEnd(createRuntime(buildSampleProject()));
    const explicit = runToEnd(createRuntime(fed(buildSampleProject(), 1, 10)));
    expect(plain.state.timeMs).toBe(11100);
    expect(plain.state.pieces).toBeUndefined();
    expect(explicit.state.timeMs).toBe(11100);
    expect(explicit.state.pieces).toBeUndefined();
    expect(explicit.state.material).toEqual(plain.state.material);
    const steps = (rt: typeof plain) => rt.state.log.filter((l) => l.code === 'STEP_DONE').map((l) => l.refId);
    expect(steps(explicit)).toEqual(steps(plain));
    expect(steps(plain)).toEqual(buildSampleProject().sequence.steps.map((s) => s.id));
  });

  it('AC2 AC4 three pieces at a 2s interval all exit, and waits are logged', () => {
    const p = fed(buildSampleProject(), 3, 2);
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.status).toBe('completed');
    expect(rt.state.pieces?.every((pc) => pc.material.location === 'EXIT' && pc.phase === 'done')).toBe(true);
    const ended = rt.state.log.filter((l) => l.code === 'WAIT_END');
    expect(ended.length).toBeGreaterThan(0);
    expect(ended.some((l) => l.message.includes('Unit 가득') && /\d+\.\d{3}s/.test(l.message))).toBe(true);
    expect(rt.state.steps.some((s) => (s.waitMs ?? 0) > 0 && (s.waitNote ?? '').includes('Unit 가득'))).toBe(true);
    expect(rt.state.error).toBeNull();
  });

  it('AC3 capacity and device exclusivity hold at every 0.1s', () => {
    const p = fed(buildSampleProject(), 3, 2);
    let rt = start(createRuntime(p));
    const cap = new Map(p.units.map((u) => [u.id, u.capacity.maxMaterials.value ?? 0]));
    for (let i = 0; i < 400 && rt.state.status === 'running'; i++) {
      rt = advance(rt, 100);
      const pieces = rt.state.pieces ?? [];
      for (const u of p.units) {
        const n = pieces.filter((pc) => pc.phase !== 'queued' && pc.material.location === u.id).length;
        expect(n).toBeLessThanOrEqual(cap.get(u.id) ?? 0);
      }
      const busy = new Map<string, number>();
      for (const pc of pieces) {
        if (!pc.active) continue;
        const step = p.sequence.steps[pc.active.stepIndex];
        const action = p.actions.find((a) => a.id === step?.actionId);
        if (!action) continue;
        busy.set(action.deviceId, (busy.get(action.deviceId) ?? 0) + 1);
      }
      for (const n of busy.values()) expect(n).toBe(1);
    }
    expect(rt.state.status).toBe('completed');
  });

  it('AC5 a long interval has no wait and the steady cycle equals that interval', () => {
    const p = fed(buildSampleProject(), 3, 20);
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.pieces?.reduce((sum, pc) => sum + pc.waitMs, 0)).toBe(0);
    expect(steadyCycleMs(rt.state.pieces ?? [])).toBe(20000);
    const info = describeRunInfo(p, rt.state);
    expect(info.cycleText).toBe('00:20.000');
    expect(info.metricBasis).toBe('정상 상태(가정)');
    expect(info.throughputText).toBe('180.0');
    expect(info.bottleneck?.name).toContain('S3');
    expect(info.bottleneck?.timeText).toBe('00:03.300');
  });

  it('AC6 five pieces at interval 0 publish the steady numbers', () => {
    const p = fed(buildSampleProject(), 5, 0);
    const rt = runToEnd(createRuntime(p));
    const exits = (rt.state.pieces ?? []).map((pc) => pc.exitedAtMs);
    // Exit instants from the linear line, capacity 1, interval 0. Every gap is 4.5s.
    expect(exits).toEqual([11100, 15600, 20100, 24600, 29100]);
    expect(steadyCycleMs(rt.state.pieces ?? [])).toBe(4500);
    const info = describeRunInfo(p, rt.state);
    expect(info.cycleText).toBe('00:04.500');
    expect(info.throughputText).toBe('800.0');
    expect(info.metricBasis).toBe('정상 상태(가정)');
    // Wait charged to S2 is the largest (13.1s). One-piece longest unit would have been S3.
    expect(info.bottleneck?.unitId).toBe('U-S2');
    expect(info.bottleneck?.timeText).toBe('00:13.100');
    const waited = (rt.state.pieces ?? []).reduce<Record<string, number>>((acc, pc) => {
      for (const [id, ms] of Object.entries(pc.waitByUnit)) acc[id] = (acc[id] ?? 0) + ms;
      return acc;
    }, {});
    expect(waited['U-S1']).toBe(12600);
    expect(waited['U-S2']).toBe(13100);
    expect(waited['U-S3']).toBe(6800);
  });

  it('AC8 a swap of two pieces deadlocks and names both', () => {
    let n = 0;
    const id = (prefix: string) => `${prefix}-${++n}`;
    const p = emptyProject('맞물림', id);
    const a = makeUnit('A 투입', 'A', { x: 0, y: 0, w: 200, h: 200 }, id);
    const b = makeUnit('B 되돌림', 'B', { x: 240, y: 0, w: 200, h: 200 }, id);
    p.units = [a, b];
    p.equipment.unitIds = [a.id, b.id];
    const put = (unitId: string, name: string) => {
      const bundle = instantiateDevice('pusher', unitId, { x: 10, y: 10 }, name, id);
      const host = p.units.find((u) => u.id === unitId)!;
      host.deviceIds.push(bundle.device.id);
      p.devices.push(bundle.device);
      p.signals.push(...bundle.signals);
      p.actions.push(...bundle.actions);
      return bundle.actions[0];
    };
    const toB = put(a.id, 'DA');
    const toA = put(b.id, 'DB');
    toB.duration = q(0.5, 's', true);
    toB.timeout = q(2, 's', true);
    toB.effect = { moveTo: b.id };
    toA.duration = q(0.5, 's', true);
    toA.timeout = q(2, 's', true);
    toA.effect = { moveTo: a.id };
    p.sequence.steps = [
      { id: id('step'), name: 'A에서 B로', actionId: toB.id, timeoutOverride: null, entry: [], origin: 'sample' },
      { id: id('step'), name: 'B에서 A로', actionId: toA.id, timeoutOverride: null, entry: [], origin: 'sample' },
    ];
    p.materials = [{
      id: 'MAT-D', name: '맞물림', kind: 'individual', carrierOf: null,
      size: { w: q(10, 'mm'), l: q(10, 'mm'), h: q(10, 'mm') }, weight: q(0.1, 'kg'), handling: '',
      states: ['대기'], initialState: '대기', initialLocation: a.id, route: [a.id, b.id],
      feedInterval: q(0, 's', true), feedCount: 2,
    }];
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.status).toBe('error');
    expect(rt.state.error?.code).toBe('DEADLOCK');
    expect(rt.state.error?.message).toContain('개체 1');
    expect(rt.state.error?.message).toContain('개체 2');
    expect(rt.state.error?.message).toContain('Unit 가득');
  });

  it('a shared device waits instead of running two steps at once', () => {
    let n = 0;
    const id = (prefix: string) => `${prefix}-b${++n}`;
    const p = emptyProject('한 장치', id);
    const u = makeUnit('S1', 'S1', { x: 0, y: 0, w: 200, h: 200 }, id);
    u.capacity.maxMaterials = q(2, 'ea', true);
    p.units = [u];
    p.equipment.unitIds = [u.id];
    const bundle = instantiateDevice('pusher', u.id, { x: 10, y: 10 }, 'PUSH', id);
    u.deviceIds.push(bundle.device.id);
    p.devices.push(bundle.device);
    p.signals.push(...bundle.signals);
    p.actions.push(...bundle.actions);
    const action = bundle.actions[0];
    action.duration = q(1, 's', true);
    action.timeout = q(3, 's', true);
    action.effect = {};
    p.sequence.steps = [{ id: id('step'), name: '밀기', actionId: action.id, timeoutOverride: null, entry: [], origin: 'sample' }];
    p.materials = [{
      id: 'MAT-B', name: '하나', kind: 'individual', carrierOf: null,
      size: { w: q(10, 'mm'), l: q(10, 'mm'), h: q(10, 'mm') }, weight: q(0.1, 'kg'), handling: '',
      states: ['대기'], initialState: '대기', initialLocation: u.id, route: [u.id],
      feedInterval: q(0, 's', true), feedCount: 2,
    }];
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.status).toBe('completed');
    const line = rt.state.log.find((l) => l.code === 'WAIT_END' && l.message.includes('Device 사용 중'));
    expect(line?.message).toContain('1.000s');
    expect(rt.state.steps.some((s) => (s.waitNote ?? '').includes('Device 사용 중'))).toBe(true);
  });

  it('a step-only flow runs in that order and matches the flat sequence', () => {
    const flat = fed(buildSampleProject(), 3, 2);
    const lined = structuredClone(flat);
    lined.sequence.flow = linearFlow(lined.sequence.steps);
    expect(checkRunReadiness(lined).blockers.some((b) => b.code === 'MULTI_FLOW')).toBe(false);
    const plain = runToEnd(createRuntime(flat));
    const withFlow = runToEnd(createRuntime(lined));
    expect(withFlow.state.status).toBe('completed');
    expect(withFlow.state.pieces?.map((pc) => pc.exitedAtMs)).toEqual(plain.state.pieces?.map((pc) => pc.exitedAtMs));

    const wrapped = wrapFlow(flat, flat.sequence.steps.slice(0, 2).map((s) => s.id), 'loop');
    expect(wrapped.ok).toBe(true);
    if (!wrapped.ok) return;
    expect(checkRunReadiness(wrapped.project).blockers.some((b) => b.code === 'MULTI_FLOW')).toBe(false);
    expect(checkRunReadiness(wrapped.project).ok).toBe(true);
    const opened = unwrapFlow(wrapped.project, wrapped.note ?? '');
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.project.sequence.flow?.every((n) => n.kind === 'step')).toBe(true);
    const unwrapped = runToEnd(createRuntime(opened.project));
    expect(unwrapped.state.pieces?.map((pc) => pc.exitedAtMs)).toEqual(plain.state.pieces?.map((pc) => pc.exitedAtMs));
  });

  it('a step-only flow follows its own order, not the step-array order', () => {
    const p = fed(buildSampleProject(), 2, 0);
    const second = p.sequence.steps[1];
    p.sequence.flow = [{ kind: 'step', stepId: second.id }, { kind: 'step', stepId: p.sequence.steps[0].id }];
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.error?.stepId).toBe(second.id);
  });

  it('AC10 parallel and flow samples are not blocked when two pieces are requested', () => {
    for (const sample of [buildParallelSampleProject(), buildFlowSampleProject()]) {
      const ready = checkRunReadiness(fed(sample, 2, 2));
      expect(ready.blockers.some((b) => b.code === 'MULTI_FLOW')).toBe(false);
      expect(ready.ok).toBe(true);
    }
    const flow = runToEnd(createRuntime(fed(buildFlowSampleProject(), 2, 2)));
    expect(flow.state.status).toBe('completed');
    expect(flow.state.pieces).toHaveLength(2);
  });

  it('AC9 a missing interval blocks and points at the material', () => {
    const p = fed(buildSampleProject(), 2, null);
    const ready = checkRunReadiness(p);
    expect(ready.ok).toBe(false);
    const hit = ready.blockers.find((b) => b.code === 'FEED_INTERVAL');
    expect(hit?.message).toContain('투입 간격');
    const guide = resolveBlocker(p, hit!, ready.blockers);
    expect(guide.kind).toBe('fix');
    expect(guide.dest?.sub).toBe('material');
  });

  it('AC13 pause, step, reset, and a second run stay deterministic', () => {
    const p = fed(buildSampleProject(), 3, 2);
    const once = runToEnd(createRuntime(p, 'a'));
    const twice = runToEnd(createRuntime(p, 'a'));
    expect(twice.state.log).toEqual(once.state.log);
    let rt = pause(start(createRuntime(p, 'a')));
    expect(rt.state.status).toBe('paused');
    const frozen = rt.state.timeMs;
    rt = advance(rt, 500);
    expect(rt.state.timeMs).toBe(frozen);
    rt = pause(advance(resume(rt), 100));
    expect(rt.state.status).toBe('paused');
    expect(rt.state.timeMs).toBe(100);
    rt = reset(rt);
    expect(rt.state.status).toBe('idle');
    expect(rt.state.timeMs).toBe(0);
    expect(rt.state.pieces?.filter((pc) => pc.fedAtMs != null)).toHaveLength(1);
  });

  it('AC14 old files omit feed count, and a saved count round-trips', () => {
    const raw = serializeProject(buildSampleProject());
    for (const version of ['0.1.0', '0.2.0', '0.3.0']) {
      const file = JSON.parse(raw) as { formatVersion: string; project: Project };
      file.formatVersion = version;
      delete file.project.materials[0].feedCount;
      if (version.startsWith('0.1')) delete file.project.substationSequences;
      const parsed = parseProjectFile(JSON.stringify(file));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(feedCountOf(parsed.project.materials[0])).toBe(1);
      expect(parsed.project.materials[0].feedCount).toBeUndefined();
      expect(runToEnd(createRuntime(parsed.project)).state.timeMs).toBe(11100);
    }
    const stored = fed(buildSampleProject(), 4, 1.5);
    const again = parseProjectFile(serializeProject(stored));
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.project.materials[0].feedCount).toBe(4);
    expect(again.project.materials[0].feedInterval.value).toBe(1.5);
    expect(again.project.materials[0]).toEqual(stored.materials[0]);
  });

  it('AC15 the rules version moved to 0.4.0', () => {
    expect(RUNTIME_RULES_VERSION).toBe('seq-runtime/0.11.0');
    expect(runToEnd(createRuntime(buildSampleProject())).state.rulesVersion).toBe('seq-runtime/0.11.0');
  });

  it('three pieces are drawn, and a waiting one is marked', () => {
    const p = fed(buildSampleProject(), 3, 0);
    const rt = advance(start(createRuntime(p)), 2000);
    const scene = describeScene(p, rt.state);
    expect(scene.materials.length).toBeGreaterThanOrEqual(2);
    expect(scene.materials.some((m) => m.waiting)).toBe(true);
    expect(anchorLabels(scene, false, false).some((label) => label.text.startsWith(`${waitingLead()} ·`))).toBe(true);
    const info = describeRunInfo(p, rt.state);
    expect(info.materialText).toMatch(/투입 \d\/3 · 배출/);
    expect(info.pieceRows?.some((row) => row.statusLabel === '대기')).toBe(true);
  });
});
