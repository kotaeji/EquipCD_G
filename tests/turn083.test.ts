import { describe, expect, it } from 'vitest';
import { buildFlowSampleProject, buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import type { Project } from '../src/model/types';
import { advance, createRuntime, pause, runToEnd, start, type Runtime } from '../src/runtime/engine';
import { buildScrubIndex, scrubMarkers, scrubWorld, seekScrub, SCRUB_CACHE_MS } from '../src/runtime/scrub';

function walk(p: Project, ms: number, runId: string): Runtime {
  return pause(advance(start(createRuntime(p, runId)), ms));
}

function sameWorld(p: Project, ms: number) {
  const finished = runToEnd(createRuntime(p, 'scrub'));
  const index = buildScrubIndex(finished);
  const seen = seekScrub(index, ms);
  const paced = walk(p, ms, 'scrub');
  expect(scrubWorld(seen)).toEqual(scrubWorld(paced));
  expect(seen.state.status === 'running' || seen.state.status === 'error' || seen.state.status === 'completed').toBe(true);
  expect(paced.state.status).toBe('paused');
  return { finished, index, seen };
}

describe('TURN-083 scrub replay', () => {
  it('AC2 matches a pause along the sample, including signals and the material', () => {
    const p = buildSampleProject();
    const at = sameWorld(p, 2300);
    expect(at.seen.state.timeMs).toBe(2300);
    expect(at.seen.state.material?.state).toBe('식별됨');
    expect(at.seen.state.steps.find((s) => s.stepId === 'STEP-04')?.status).toBe('active');
    expect(at.seen.state.steps.find((s) => s.stepId === 'STEP-05')?.status).toBe('pending');
    sameWorld(p, 0);
    sameWorld(p, 800);
  });

  it('AC4 seeking the end is the finished run itself', () => {
    const finished = runToEnd(createRuntime(buildSampleProject(), 'end'));
    const index = buildScrubIndex(finished);
    expect(seekScrub(index, finished.state.timeMs)).toBe(finished);
    expect(seekScrub(index, finished.state.timeMs + 50)).toBe(finished);
    expect(scrubWorld(seekScrub(index, finished.state.timeMs))).toEqual(scrubWorld(finished));
  });

  it('AC5 replay does not write the design model', () => {
    const p = buildSampleProject();
    const before = JSON.stringify(p);
    const finished = runToEnd(createRuntime(p));
    buildScrubIndex(finished);
    seekScrub(buildScrubIndex(finished), 2300);
    expect(JSON.stringify(p)).toBe(before);
    expect(p.revision).toBe(1);
  });

  it('AC6 covers the flow sample, the parallel sample, and several pieces', () => {
    sameWorld(buildFlowSampleProject(), 2500);
    sameWorld(buildParallelSampleProject(), 400);
    const multi = buildSampleProject();
    multi.materials[0].feedCount = 3;
    multi.materials[0].feedInterval = { ...multi.materials[0].feedInterval, value: 0 };
    const at = sameWorld(multi, 4500);
    expect(at.seen.state.pieces?.length).toBe(3);
    expect(at.seen.state.pieces?.some((pc) => pc.phase !== 'queued')).toBe(true);
  });

  it('AC2 an error run matches the pause up to the fault, and marks the error time', () => {
    const p = buildSampleProject();
    const bcr = p.actions.find((a) => a.deviceId === 'BCR-02')!;
    p.simSettings.faults.neverTrueSignalIds = [bcr.completeSignalId!];
    const finished = runToEnd(createRuntime(p, 'fault'));
    expect(finished.state.status).toBe('error');
    const index = buildScrubIndex(finished);
    expect(scrubWorld(seekScrub(index, 1000))).toEqual(scrubWorld(walk(p, 1000, 'fault')));
    expect(seekScrub(index, finished.state.timeMs)).toBe(finished);
    expect(scrubMarkers(finished).some((m) => m.kind === 'error' && m.t === finished.state.timeMs)).toBe(true);
    expect(index.markers.some((m) => m.kind === 'start' && m.t === 0)).toBe(true);
  });

  it('AC7 one seek in a 60s run stays under 100ms', () => {
    const p = buildSampleProject();
    const push = p.actions.find((a) => a.name.startsWith('S1 푸셔'))!;
    push.duration = { ...push.duration, value: 60 };
    push.timeout = { ...push.timeout, value: 90 };
    const finished = runToEnd(createRuntime(p, 'long'));
    expect(finished.state.timeMs).toBeGreaterThanOrEqual(60_000);
    const index = buildScrubIndex(finished);
    expect(index.points.length).toBeGreaterThan(60_000 / SCRUB_CACHE_MS);
    expect(index.points[1].state.timeMs - index.points[0].state.timeMs).toBe(SCRUB_CACHE_MS);
    const started = performance.now();
    const seen = seekScrub(index, 30_100);
    const elapsed = performance.now() - started;
    expect(seen.state.timeMs).toBe(30_100);
    expect(elapsed).toBeLessThan(100);
  });

  it('AC8 keeps the sample finish time and step order', () => {
    const p = buildSampleProject();
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.status).toBe('completed');
    expect(rt.state.timeMs).toBe(11100);
    expect(rt.state.log.filter((line) => line.code === 'STEP_DONE').map((line) => line.refId)).toEqual(p.sequence.steps.map((s) => s.id));
  });
});
