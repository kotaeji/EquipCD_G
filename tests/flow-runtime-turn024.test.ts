// @vitest-environment jsdom
// TURN-024 run records: stopped sibling lanes, one skip per step, first-N hint.
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { buildFlowSampleProject, buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import { FILE_FORMAT_VERSION, RUNTIME_RULES_VERSION, type Action, type FlowNode, type Project, type SequenceStep } from '../src/model/types';
import { checkRunReadiness } from '../src/model/validate';
import { createRuntime, runToEnd, signalLabel, start } from '../src/runtime/engine';
import { stepStatusLabel, summarizeRun } from '../src/runtime/runSummary';
import { parseProjectFile, serializeProject } from '../src/storage/fileFormat';
import { App } from '../src/ui/App';
import { RuntimePanel } from '../src/ui/Panels';
import { RunSummary } from '../src/ui/RunSummary';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  localStorage.clear();
});

const stepOf = (id: string, name: string, actionId: string, entry: SequenceStep['entry'] = []): SequenceStep =>
  ({ id, name, actionId, timeoutOverride: null, entry, origin: 'dnd' });

function clearMotion(a: Action, dur: number, timeout: number) {
  a.pre = [];
  a.post = [];
  a.effect = {};
  a.duration = { ...a.duration, value: dur };
  a.timeout = { ...a.timeout, value: timeout };
}

/** Two parallel lanes. Lane 1 is a 3s motion. Lane 2 is the caller’s step. */
function parallelLanes(lane2: (p: Project, free: Action) => SequenceStep) {
  const p = buildSampleProject();
  const used = new Set(p.sequence.steps.map((s) => s.actionId));
  const long = p.actions.find((a) => a.deviceId === 'CYL-01')!;
  const free = p.actions.find((a) => a.deviceId === 'STP-05' && !used.has(a.id))!;
  clearMotion(long, 3, 5);
  clearMotion(free, 0.2, 2);
  const slow = stepOf('STEP-LONG', '긴 갈래', long.id);
  const other = lane2(p, free);
  p.sequence.steps.push(slow, other);
  p.sequence.flow = [{
    kind: 'parallel', id: 'FLW-P', name: '나란히',
    lanes: [[{ kind: 'step', stepId: slow.id }], [{ kind: 'step', stepId: other.id }]],
  }];
  return { p, slow, other, long, free };
}

function phasesAddUp(p: Project, state: ReturnType<typeof runToEnd>['state']) {
  const sum = summarizeRun(p, state);
  const n = (status: string) => sum.steps.filter((s) => s.status === status).length;
  expect(n('done') + n('skipped') + n('stopped') + n('error') + n('pending') + n('active')).toBe(sum.totalCount);
  expect(sum.executedCount).toBe(n('done'));
  expect(sum.skippedCount).toBe(n('skipped'));
  expect(sum.stoppedCount).toBe(n('stopped'));
  expect(sum.steps.some((s) => s.status === 'active')).toBe(false);
  expect(state.steps.some((s) => s.status === 'active')).toBe(false);
  return sum;
}

describe('TURN-024 sibling lanes stop together (AC1 AC2)', () => {
  it('AC1 a lane TIMEOUT closes the other lane as stopped at the same time', () => {
    const { p, slow, other, free } = parallelLanes((_p, short) => stepOf('STEP-SHORT', '짧은 갈래', short.id));
    p.simSettings.faults.neverTrueSignalIds = [free.completeSignalId!];
    free.timeout = { ...free.timeout, value: 0.2 };
    expect(checkRunReadiness(p).ok).toBe(true);
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.error).toEqual({
      code: 'TIMEOUT',
      stepId: other.id,
      message: `[짧은 갈래] 타임아웃 — 완료 신호 ${signalLabel(p, free.completeSignalId)} 미발생. 이후 공정 통과 안 함`,
    });
    const err = rt.state.steps.find((s) => s.stepId === other.id)!;
    const stopped = rt.state.steps.find((s) => s.stepId === slow.id)!;
    expect(err.status).toBe('error');
    expect(err.endMs).toBe(200);
    expect(stopped.status).toBe('stopped');
    expect(stopped.endMs).toBe(200);
    expect(stopped.startMs).toBe(0);
    expect(rt.state.timeMs).toBe(200);
    expect(rt.state.flowRun?.fibers.every((f) => f.active === null)).toBe(true);
    const sum = phasesAddUp(p, rt.state);
    expect(sum.stoppedCount).toBe(1);
    expect(sum.steps.find((s) => s.stepId === slow.id)?.endMs).toBe(200);
  });

  it('AC2 PRE_UNMET, POST_UNMET, and READ_FAILED stop the other lane the same way', () => {
    const pre = parallelLanes((p, short) => stepOf('STEP-SHORT', '전제 갈래', short.id, [
      { kind: 'signal', signalId: p.actions.find((a) => a.deviceId === 'CYL-01')!.completeSignalId!, equals: true },
    ]));
    expect(checkRunReadiness(pre.p).ok).toBe(true);
    const preRun = runToEnd(createRuntime(pre.p));
    expect(preRun.state.error?.code).toBe('PRE_UNMET');
    expect(preRun.state.error?.message).toContain('[전제 갈래] 전제 조건 미충족');
    expect(preRun.state.steps.find((s) => s.stepId === pre.slow.id)).toMatchObject({ status: 'stopped', endMs: 0 });
    expect(preRun.state.steps.find((s) => s.stepId === pre.other.id)?.status).toBe('error');
    phasesAddUp(pre.p, preRun.state);

    const post = parallelLanes((p, short) => {
      short.post = [{ kind: 'signal', signalId: p.actions.find((a) => a.deviceId === 'CYL-01')!.completeSignalId!, equals: true }];
      return stepOf('STEP-SHORT', '완료 갈래', short.id);
    });
    expect(checkRunReadiness(post.p).ok).toBe(true);
    const postRun = runToEnd(createRuntime(post.p));
    expect(postRun.state.error?.code).toBe('POST_UNMET');
    expect(postRun.state.error?.message).toContain('[완료 갈래] 완료 후 조건 미충족');
    expect(postRun.state.steps.find((s) => s.stepId === post.slow.id)).toMatchObject({ status: 'stopped', endMs: 200 });
    expect(postRun.state.steps.find((s) => s.stepId === post.other.id)?.status).toBe('error');
    phasesAddUp(post.p, postRun.state);

    const read = parallelLanes((p, _short) => {
      const act = p.actions.find((a) => a.kind === 'read')!;
      clearMotion(act, 0.2, 2);
      act.kind = 'read';
      p.simSettings.faults.readFailActionIds = [act.id];
      return stepOf('STEP-READ', '읽기 갈래', act.id);
    });
    expect(checkRunReadiness(read.p).ok).toBe(true);
    const readRun = runToEnd(createRuntime(read.p));
    expect(readRun.state.error?.code).toBe('READ_FAILED');
    expect(readRun.state.error?.message).toContain('[읽기 갈래] 읽기 완료, 결과=실패');
    expect(readRun.state.steps.find((s) => s.stepId === read.slow.id)).toMatchObject({ status: 'stopped', endMs: 200 });
    expect(readRun.state.steps.find((s) => s.stepId === 'STEP-READ')?.status).toBe('error');
    phasesAddUp(read.p, readRun.state);
  });

  it('AC2 a Substation lane TIMEOUT and PRE_UNMET stop the other sequence', () => {
    const timed = buildParallelSampleProject();
    const seqA = timed.substationSequences!.find((q) => q.id === 'SSEQ-S1-A')!;
    const actA = timed.actions.find((a) => a.id === seqA.steps[0].actionId)!;
    seqA.steps[0].timeoutOverride = { ...actA.timeout, value: 0.2 };
    timed.simSettings.faults.neverTrueSignalIds = [actA.completeSignalId!];
    expect(checkRunReadiness(timed).ok).toBe(true);
    const rt = runToEnd(createRuntime(timed));
    expect(rt.state.error?.code).toBe('TIMEOUT');
    expect(rt.state.error?.stepId).toBe(seqA.steps[0].id);
    const sibling = rt.state.steps.find((s) => s.stepId === 'SSTEP-B1')!;
    expect(sibling.status).toBe('stopped');
    expect(sibling.endMs).toBe(200);
    expect(sibling.lane).toContain('시퀀스 B');
    phasesAddUp(timed, rt.state);

    const pre = buildParallelSampleProject();
    const seqB = pre.substationSequences!.find((q) => q.id === 'SSEQ-S1-B')!;
    const other = pre.actions.find((a) => a.deviceId === 'PSH-21')!;
    seqB.steps[0].entry = [{ kind: 'signal', signalId: other.completeSignalId!, equals: true }];
    expect(checkRunReadiness(pre).ok).toBe(true);
    const stopped = runToEnd(createRuntime(pre));
    expect(stopped.state.error?.code).toBe('PRE_UNMET');
    expect(stopped.state.error?.stepId).toBe(seqB.steps[0].id);
    expect(stopped.state.steps.find((s) => s.stepId === 'SSTEP-A1')).toMatchObject({ status: 'stopped', endMs: 0 });
    phasesAddUp(pre, stopped.state);
  });

  it('AC2 a lane device conflict is blocked before any step becomes active', () => {
    const p = buildSampleProject();
    const cyl = p.actions.find((a) => a.deviceId === 'CYL-01')!;
    clearMotion(cyl, 0.4, 2);
    const a = stepOf('STEP-A', '갈래 A', cyl.id);
    const b = stepOf('STEP-B', '갈래 B', cyl.id);
    p.sequence.steps.push(a, b);
    const flow: FlowNode[] = [{
      kind: 'parallel', id: 'FLW-P', name: '겹침',
      lanes: [[{ kind: 'step', stepId: a.id }], [{ kind: 'step', stepId: b.id }]],
    }];
    p.sequence.flow = flow;
    const ready = checkRunReadiness(p);
    expect(ready.blockers.map((x) => x.code)).toContain('DEVICE_CONFLICT');
    const started = start(createRuntime(p));
    expect(started.state.status).toBe('idle');
    expect(started.state.steps.some((s) => s.status === 'active' || s.status === 'stopped')).toBe(false);
  });
});

describe('TURN-024 skip records inside a repeat (AC4 AC5)', () => {
  it('AC4 a looped branch that flips leaves one done record per arm and no skip', () => {
    const p = buildSampleProject();
    const thenStep = p.sequence.steps[0];
    const elseStep = p.sequence.steps[1];
    p.sequence.flow = [{
      kind: 'loop', id: 'FLW-L', name: '두 번', count: 2, body: [{
        kind: 'branch', id: 'FLW-B', name: '상태',
        cond: { kind: 'materialState', state: '대기' },
        then: [{ kind: 'step', stepId: thenStep.id }],
        else: [{ kind: 'step', stepId: elseStep.id }],
      }],
    }];
    expect(checkRunReadiness(p).ok).toBe(true);
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.status).toBe('completed');
    expect(rt.state.log.filter((l) => l.code === 'BRANCH_TAKEN').map((l) => l.message)).toEqual([
      expect.stringContaining('참'),
      expect.stringContaining('거짓'),
    ]);
    expect(rt.state.steps.filter((s) => s.stepId === thenStep.id)).toEqual([
      expect.objectContaining({ status: 'done', pass: 1 }),
    ]);
    expect(rt.state.steps.filter((s) => s.stepId === elseStep.id)).toEqual([
      expect.objectContaining({ status: 'done', pass: 1 }),
    ]);
    expect(rt.state.steps.some((s) => s.status === 'skipped')).toBe(false);
    expect(summarizeRun(p, rt.state).skippedCount).toBe(0);
  });

  it('AC5 a step that never runs has one skip record, not one per iteration', () => {
    const p = buildSampleProject();
    const cyl = p.actions.find((a) => a.deviceId === 'CYL-01')!;
    clearMotion(cyl, 0.1, 1);
    const run = stepOf('STEP-RUN', '항상', cyl.id);
    const skip = p.sequence.steps[1];
    p.sequence.steps.push(run);
    const sig = p.signals[0];
    p.sequence.flow = [{
      kind: 'loop', id: 'FLW-L', name: '세 번', count: 3, body: [{
        kind: 'branch', id: 'FLW-B', name: '항상 참',
        cond: { kind: 'signal', signalId: sig.id, equals: false },
        then: [{ kind: 'step', stepId: run.id }],
        else: [{ kind: 'step', stepId: skip.id }],
      }],
    }];
    expect(checkRunReadiness(p).ok).toBe(true);
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.status).toBe('completed');
    expect(rt.state.steps.filter((s) => s.stepId === skip.id)).toEqual([{ stepId: skip.id, status: 'skipped' }]);
    expect(rt.state.steps.filter((s) => s.stepId === run.id && s.status === 'done')).toHaveLength(3);
    expect(rt.state.steps.filter((s) => s.stepId === run.id && s.status === 'skipped')).toHaveLength(0);
    expect(summarizeRun(p, rt.state).skippedCount).toBe(1);
  });
});

describe('TURN-024 first-N hint and unchanged results (AC6 AC7 AC8)', () => {
  it('AC6 the hint shows only when first-N has no branch or retry that reads the result', async () => {
    const read = (p: Project) => p.actions.find((a) => a.kind === 'read')!;
    const flat = buildSampleProject();
    flat.simSettings.faults.readFailActionIds = [read(flat).id];
    flat.simSettings.faults.readFailFirstN = { [read(flat).id]: 2 };
    const flow = buildFlowSampleProject();
    flow.simSettings.faults.readFailActionIds = [read(flow).id];
    flow.simSettings.faults.readFailFirstN = { [read(flow).id]: 1 };
    const unused = buildFlowSampleProject();
    unused.sequence.flow = (unused.sequence.flow ?? []).filter((n) => n.kind === 'step');
    unused.simSettings.faults.readFailActionIds = [read(unused).id];
    unused.simSettings.faults.readFailFirstN = { [read(unused).id]: 2 };
    const empty = buildSampleProject();

    const mount = async (p: Project) => {
      const el = document.createElement('div');
      document.body.appendChild(el);
      root = createRoot(el);
      await act(async () => {
        root!.render(createElement(RuntimePanel, { p, rt: null, locked: false, edit: () => true }));
      });
      return el;
    };
    const hint = '결과를 쓰는 분기 · 재시도가 없어 첫 실패에서 멈춥니다';
    expect((await mount(flat)).textContent).toContain(hint);
    await act(async () => { root!.unmount(); });
    document.body.innerHTML = '';
    expect((await mount(unused)).textContent).toContain(hint);
    await act(async () => { root!.unmount(); });
    document.body.innerHTML = '';
    const used = await mount(flow);
    expect(used.textContent).not.toContain(hint);
    expect(used.querySelector('input[aria-label="S2 바코드 읽기 실패 횟수"]')).not.toBeNull();
    await act(async () => { root!.unmount(); });
    document.body.innerHTML = '';
    expect((await mount(empty)).textContent).not.toContain(hint);
  });

  it('AC7 the flow sample stays 13.100s with one skip, and the parallel sample stays 2.500s', () => {
    const flow = runToEnd(createRuntime(buildFlowSampleProject()));
    expect(flow.state.status).toBe('completed');
    expect(flow.state.timeMs).toBe(13100);
    const flowSum = summarizeRun(flow.snapshot, flow.state);
    expect(flowSum.skippedCount).toBe(1);
    expect(flowSum.stoppedCount).toBe(0);
    const skippedIds = new Set(flow.state.steps.filter((s) => s.status === 'skipped').map((s) => s.stepId));
    expect([...skippedIds]).toEqual(['STEP-NG']);
    for (const id of skippedIds) {
      expect(flow.state.steps.some((s) => s.stepId === id && s.status !== 'skipped')).toBe(false);
    }

    const parallel = runToEnd(createRuntime(buildParallelSampleProject()));
    expect(parallel.state.status).toBe('completed');
    expect(parallel.state.timeMs).toBe(2500);
    expect(parallel.state.steps.some((s) => s.status === 'stopped' || s.status === 'active')).toBe(false);
  });

  it('AC7 a flat sequence still stops on the first read failure when first-N is set', () => {
    const p = buildSampleProject();
    const id = p.actions.find((a) => a.kind === 'read')!.id;
    p.simSettings.faults.readFailActionIds = [id];
    p.simSettings.faults.readFailFirstN = { [id]: 3 };
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.status).toBe('error');
    expect(rt.state.error?.code).toBe('READ_FAILED');
    expect(rt.state.steps.some((s) => s.status === 'stopped')).toBe(false);
  });

  it('AC8 rules are seq-runtime/0.7.0 and a 0.3.0 file still opens', () => {
    expect(RUNTIME_RULES_VERSION).toBe('seq-runtime/0.7.0');
    expect(FILE_FORMAT_VERSION).toBe('0.3.0');
    const sample = buildSampleProject();
    const text = serializeProject(sample);
    expect(text).toContain('"formatVersion": "0.3.0"');
    const opened = parseProjectFile(text);
    expect(opened.ok).toBe(true);
    expect(runToEnd(createRuntime(sample)).state.rulesVersion).toBe('seq-runtime/0.7.0');
    const legacy = JSON.parse(text) as { formatVersion: string };
    legacy.formatVersion = '0.3.0';
    expect(parseProjectFile(JSON.stringify(legacy)).ok).toBe(true);
  });
});

describe('TURN-024 stopped is a word on the run screen (AC3)', () => {
  it('the summary says 정지 and the phase counts add up', async () => {
    const { p, free } = parallelLanes((_p, short) => stepOf('STEP-SHORT', '짧은 갈래', short.id));
    p.simSettings.faults.neverTrueSignalIds = [free.completeSignalId!];
    free.timeout = { ...free.timeout, value: 0.2 };
    const rt = runToEnd(createRuntime(p));
    const el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => { root!.render(createElement(RunSummary, { p, rt: rt.state })); });
    const head = el.querySelector('.run-summary-head')!.textContent ?? '';
    expect(head).toContain('정지 1');
    expect(el.querySelector('.run-summary-stopped')!.textContent).toBe('정지');
    expect(stepStatusLabel('stopped')).toBe('정지');
    const sum = summarizeRun(p, rt.state);
    const n = (status: string) => sum.steps.filter((s) => s.status === status).length;
    expect(sum.executedCount + sum.skippedCount + sum.stoppedCount + n('error') + n('pending') + n('active')).toBe(sum.totalCount);
  });

  it('the station run table shows 정지 after a parallel-lane timeout', async () => {
    localStorage.clear();
    const el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => { root!.render(createElement(App)); });
    const click = async (node: Element) => {
      await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    };
    const btn = (label: string) => [...el.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label)!;
    await click(el.querySelector('[data-sample-open="parallel"]')!);
    await click(el.querySelector('.stepper [data-stepid="run"]')!);
    const fault = [...el.querySelectorAll('select')].find((s) => (s.textContent ?? '').includes('완료 신호 미발생')) as HTMLSelectElement;
    const opt = [...fault.options].find((o) => (o.textContent ?? '').includes('A 클램프 상승'))!;
    await act(async () => {
      fault.value = opt.value;
      fault.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
    try {
      await click(btn('▶ 실행'));
      await click(btn('끝까지'));
    } finally {
      globalThis.requestAnimationFrame = raf;
    }
    await click([...el.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '자세히 펼치기')!);
    const table = [...el.querySelectorAll('table')].find((t) => (t.textContent ?? '').includes('갈래 · 회차'))!;
    const statuses = [...table.querySelectorAll('tbody tr')].map((tr) => tr.children[2]?.querySelector('.status-word')?.textContent ?? tr.children[2]?.textContent ?? '');
    expect(statuses).toContain('정지');
    expect(statuses).not.toContain('active');
    expect(el.querySelector('.run-summary-head')!.textContent).toContain('정지');
    expect(el.querySelector('.run-summary-stopped')!.textContent).toBe('정지');
  });
});
