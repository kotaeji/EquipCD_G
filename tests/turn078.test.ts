import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as C from '../src/model/commands';
import { buildSampleProject } from '../src/model/sample';
import type { Action, FlowNode, SequenceStep } from '../src/model/types';
import { advance, createRuntime, pause, runToEnd, start } from '../src/runtime/engine';
import {
  DUR_1_MS, DUR_2_MS, DUR_3_MS, deviceRunMarks, diagramMotionOn, flowPoints, materialPoses, pointAlong, waitSpots,
} from '../src/ui/runDiagram';

/** Continuous signal dash. It is not a state transition. Reduced motion still clears it. */
export const MOTION_TIME_EXCEPTIONS = ['.react-flow__edge-path.rf-sig-on'];

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...cssFiles(path));
    else if (name.endsWith('.css')) out.push(path);
  }
  return out;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('TURN-078 motion tokens', () => {
  it('AC1 durations and curves are the only times on transition and animation', () => {
    const root = readFileSync('src/ui/motion.css', 'utf8');
    expect(root).toContain(`--dur-1: ${DUR_1_MS}ms`);
    expect(root).toContain(`--dur-2: ${DUR_2_MS}ms`);
    expect(root).toContain(`--dur-3: ${DUR_3_MS}ms`);
    expect(root).toContain('--ease-enter:');
    expect(root).toContain('--ease-exit:');
    const stray: string[] = [];
    const decl = /(?:^|[{;])\s*((?:transition|animation)(?:-duration)?)\s*:\s*([^;{}]+)/g;
    for (const file of cssFiles('src')) {
      let text = stripComments(readFileSync(file, 'utf8'));
      for (const selector of MOTION_TIME_EXCEPTIONS) {
        text = text.replace(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*\\}`, 'g'), '');
      }
      for (const match of text.matchAll(decl)) {
        const value = match[2].replace(/var\(\s*--dur-[123]\s*\)/g, '');
        if (/(?<![\w-])\d*\.?\d+m?s\b/.test(value)) stray.push(`${file} ${match[1]}: ${match[2].trim()}`);
      }
    }
    expect(stray).toEqual([]);
  });

  it('AC2 motion is off for reduced motion, emphasis off, or equipment motion off', () => {
    expect(diagramMotionOn({ reduced: false, emphasize: true, equipment: true })).toBe(true);
    expect(diagramMotionOn({ reduced: true, emphasize: true, equipment: true })).toBe(false);
    expect(diagramMotionOn({ reduced: false, emphasize: false, equipment: true })).toBe(false);
    expect(diagramMotionOn({ reduced: false, emphasize: true, equipment: false })).toBe(false);
    const css = readFileSync('src/ui/motion.css', 'utf8');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*transition: none !important/);
    expect(css).toContain('.app[data-motion="off"]');
    const diagram = readFileSync('src/ui/run-diagram.css', 'utf8');
    const wait = diagram.slice(diagram.indexOf('.rf-device.is-wait'));
    expect(wait).toContain('dashed');
    expect(wait.split('}')[0]).not.toMatch(/animation|transition/);
  });
});

function runAt(ms: number) {
  const project = buildSampleProject();
  let rt = start(createRuntime(project, 'turn078'));
  rt = advance(rt, ms);
  return { project, rt };
}

describe('TURN-078 run diagram', () => {
  it('AC3 progress fills from virtual time and holds while paused', () => {
    const { project, rt } = runAt(0);
    const atStart = deviceRunMarks(project, rt.state).find((row) => row.deviceId === 'PSH-01')!;
    expect(atStart.progress).toBe(0);
    const mid = runAt(400);
    const half = deviceRunMarks(mid.project, mid.rt.state).find((row) => row.deviceId === 'PSH-01')!;
    expect(half.progress).toBeCloseTo(0.5);
    const held = pause(mid.rt);
    const frozen = deviceRunMarks(mid.project, held.state).find((row) => row.deviceId === 'PSH-01')!;
    expect(held.state.status).toBe('paused');
    expect(frozen.progress).toBe(half.progress);
    const later = runAt(800);
    const done = deviceRunMarks(later.project, later.rt.state).find((row) => row.deviceId === 'PSH-01')!;
    expect(done.progress).toBeNull();
    expect(done.justDone).toBe(true);
    const aged = deviceRunMarks(later.project, { ...later.rt.state, timeMs: later.rt.state.timeMs + DUR_3_MS }).find((row) => row.deviceId === 'PSH-01')!;
    expect(aged.justDone).toBe(true);
    const passed = deviceRunMarks(later.project, { ...later.rt.state, timeMs: later.rt.state.timeMs + DUR_3_MS + 1 }).find((row) => row.deviceId === 'PSH-01')!;
    expect(passed.justDone).toBe(false);
    expect(passed.done).toBe(true);
  });

  it('AC4 a material point on the flow line is a function of virtual time', () => {
    const project = buildSampleProject();
    const fromId = project.materials[0].initialLocation!;
    const toId = project.actions.find((a) => a.deviceId === 'PSH-01')!.effect.moveTo!;
    const line = flowPoints(project, fromId, toId)!;
    const poseAt = (ms: number) => {
      const rt = advance(start(createRuntime(project, 'move')), ms);
      const pose = materialPoses(project, rt.state, true)[0];
      return { pose, again: materialPoses(project, rt.state, true)[0] };
    };
    const startPose = poseAt(0);
    expect(startPose.pose).toEqual(startPose.again);
    expect(startPose.pose.travel).toBe(0);
    expect({ x: startPose.pose.x, y: startPose.pose.y }).toEqual(line[0]);
    const mid = poseAt(400);
    expect(mid.pose).toEqual(mid.again);
    expect(mid.pose.travel).toBeCloseTo(0.5);
    expect({ x: mid.pose.x, y: mid.pose.y }).toEqual(pointAlong(line, 0.5));
    const late = poseAt(799);
    expect({ x: late.pose.x, y: late.pose.y }).toEqual(pointAlong(line, 799 / 800));
    const still = materialPoses(project, advance(start(createRuntime(project, 'off')), 400).state, false)[0];
    expect(still.travel).toBeNull();
    expect({ x: still.x, y: still.y }).not.toEqual({ x: mid.pose.x, y: mid.pose.y });
    const paused = pause(advance(start(createRuntime(project, 'pause')), 400));
    expect(materialPoses(project, paused.state, true)[0]).toEqual(mid.pose);
  });

  it('AC5 waiting spots name the unit or the device, and the sample run time is unchanged', () => {
    const project = buildSampleProject();
    const fed = C.setFeedCount(project, project.materials[0].id, 2);
    expect(fed.ok).toBe(true);
    if (!fed.ok) return;
    const spaced = C.setQuantity(fed.project, { kind: 'material', id: project.materials[0].id, field: 'feedInterval' }, 0, true);
    expect(spaced.ok).toBe(true);
    if (!spaced.ok) return;
    const rt = advance(start(createRuntime(spaced.project, 'wait')), 400);
    const spots = waitSpots(spaced.project, rt.state);
    expect(spots).toContainEqual({ id: project.materials[0].initialLocation, kind: 'unit' });
    const waitingPiece = rt.state.pieces!.find((pc) => pc.phase === 'waiting')!;
    expect(waitingPiece.wait?.unitId).toBe(project.materials[0].initialLocation);

    const { p } = signalWait();
    const waiting = advance(start(createRuntime(p, 'signal')), 100);
    expect(waitSpots(p, waiting.state).some((row) => row.kind === 'unit' && row.id === p.materials[0].initialLocation)).toBe(true);
    const device = waitSpots(p, waiting.state).find((row) => row.kind === 'device');
    expect(device === undefined || p.devices.some((d) => d.id === device.id)).toBe(true);

    const sample = runToEnd(start(createRuntime(buildSampleProject(), 'sample')));
    expect(sample.state.status).toBe('completed');
    expect(sample.state.timeMs).toBe(11100);
  });
});

const stepOf = (id: string, name: string, actionId: string): SequenceStep =>
  ({ id, name, actionId, timeoutOverride: null, entry: [], origin: 'dnd' });

function clearMotion(a: Action, dur: number, timeout: number) {
  a.pre = [];
  a.post = [];
  a.effect = {};
  a.duration = { ...a.duration, value: dur };
  a.timeout = { ...a.timeout, value: timeout };
}

function signalWait() {
  const p = buildSampleProject();
  const used = new Set(p.sequence.steps.map((s) => s.actionId));
  const slowA = p.actions.find((a) => a.deviceId === 'CYL-01')!;
  const otherA = p.actions.find((a) => a.deviceId === 'STP-05' && !used.has(a.id))!;
  clearMotion(slowA, 2, 4);
  clearMotion(otherA, 0.2, 2);
  const slow = stepOf('STEP-SLOW', '느린 단계', slowA.id);
  const after = stepOf('STEP-AFTER', '다음 단계', otherA.id);
  p.sequence.steps = [slow, after];
  const wait: FlowNode = {
    kind: 'wait', id: 'FLW-WAIT', name: '신호 기다림',
    cond: { kind: 'signal', signalId: slowA.completeSignalId!, equals: true },
    timeout: { value: 5, unit: 's', assumption: true },
  };
  p.sequence.flow = [{
    kind: 'parallel', id: 'FLW-P', name: '나란히',
    lanes: [[{ kind: 'step', stepId: slow.id }], [wait, { kind: 'step', stepId: after.id }]],
  }];
  return { p, slowA };
}
