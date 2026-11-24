// TURN-084 keyboard diagram decisions. The screen is covered in ui-turn084.
import { describe, expect, it } from 'vitest';
import { buildSampleProject } from '../src/model/sample';
import { EXTRA_SHORTCUTS } from '../src/ui/commandModel';
import { HELP_TOPICS } from '../src/ui/helpCopy';
import {
  LOCKED_NUDGE, NUDGE_GAP_MS, RUN_CANVAS_BLOCKED, START_OUT,
  burstOpen, crossingUnit, cursorPlace, cycle, diagramEffect, movedPlace, nextZoom, nudgeStep, panToReveal, planCanvasKey,
  type DiagramNav, type NudgeBurst,
} from '../src/ui/canvasKeyboard';

const key = (over: Partial<{ key: string; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) => ({
  key: 'ArrowRight', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...over,
});

describe('TURN-084 keyboard plan', () => {
  it('steps are 10, 50, and 1, and letters are not stolen with a modifier', () => {
    expect(nudgeStep(false, false)).toBe(10);
    expect(nudgeStep(true, false)).toBe(50);
    expect(nudgeStep(false, true)).toBe(1);
    expect(planCanvasKey(key({}))).toEqual({ type: 'nudge', dx: 10, dy: 0 });
    expect(planCanvasKey(key({ key: 'ArrowUp', shiftKey: true }))).toEqual({ type: 'nudge', dx: 0, dy: -50 });
    expect(planCanvasKey(key({ key: 'ArrowLeft', altKey: true }))).toEqual({ type: 'nudge', dx: -1, dy: 0 });
    expect(planCanvasKey(key({ key: 'l' }))).toEqual({ type: 'flow' });
    expect(planCanvasKey(key({ key: 'S' }))).toEqual({ type: 'signal' });
    expect(planCanvasKey(key({ key: 'l', ctrlKey: true }))).toEqual({ type: 'pass' });
    expect(planCanvasKey(key({ key: 'a', ctrlKey: true }))).toEqual({ type: 'pass' });
    expect(planCanvasKey(key({ key: '+' }))).toEqual({ type: 'zoom', dir: 1 });
    expect(planCanvasKey(key({ key: '-', }))).toEqual({ type: 'zoom', dir: -1 });
    expect(planCanvasKey(key({ key: '0' }))).toEqual({ type: 'zoom', dir: 0 });
    expect(planCanvasKey(key({ key: 'Tab', shiftKey: true }))).toEqual({ type: 'tab', dir: -1 });
    expect(nextZoom(1, 1)).toBe(1.1);
    expect(nextZoom(0.5, -1)).toBe(0.5);
    expect(nextZoom(2, 1)).toBe(2);
  });

  it('keeps one undo while the key is down and for 0.5s after it is released', () => {
    const burst: NudgeBurst = { ids: ['U-S1'], dx: 10, dy: 0, base: buildSampleProject(), upAt: null };
    expect(burstOpen(burst, ['U-S1'], 1_000)).toBe(true);
    expect(burstOpen({ ...burst, upAt: 1_000 }, ['U-S1'], 1_000 + NUDGE_GAP_MS - 1)).toBe(true);
    expect(burstOpen({ ...burst, upAt: 1_000 }, ['U-S1'], 1_000 + NUDGE_GAP_MS)).toBe(false);
    expect(burstOpen(burst, ['U-S2'], 1_000)).toBe(false);
    expect(NUDGE_GAP_MS).toBe(500);
  });

  it('walks units and devices and names the place S2 식별 › BCR-02', () => {
    const p = buildSampleProject();
    const none: DiagramNav = { cursor: null, link: null };
    const first = diagramEffect({ type: 'tab', dir: 1 }, none, p, [], false);
    expect(first).toMatchObject({ type: 'cursor', place: 'S1 투입', focusId: 'U-S1' });
    const s2 = diagramEffect({ type: 'tab', dir: 1 }, { cursor: { level: 'unit', id: 'U-S1' }, link: null }, p, [], false);
    expect(s2).toMatchObject({ type: 'cursor', place: 'S2 식별', focusId: 'U-S2' });
    const back = diagramEffect({ type: 'tab', dir: -1 }, { cursor: { level: 'unit', id: 'U-S1' }, link: null }, p, [], false);
    expect(back).toMatchObject({ focusId: 'U-S5' });
    const into = diagramEffect({ type: 'enter' }, { cursor: { level: 'unit', id: 'U-S2' }, link: null }, p, [], false);
    expect(into).toMatchObject({ type: 'cursor', place: 'S2 식별 › BCR-02', focusId: 'BCR-02' });
    const nextDev = diagramEffect({ type: 'tab', dir: 1 }, { cursor: { level: 'device', unitId: 'U-S2', id: 'BCR-02' }, link: null }, p, [], false);
    expect(nextDev).toMatchObject({ focusId: 'STP-02' });
    const up = diagramEffect({ type: 'esc' }, { cursor: { level: 'device', unitId: 'U-S2', id: 'BCR-02' }, link: null }, p, [], false);
    expect(up).toMatchObject({ type: 'cursor', place: 'S2 식별', focusId: 'U-S2' });
    expect(cursorPlace('S2 식별', 'BCR-02')).toBe('S2 식별 › BCR-02');
    expect(movedPlace('S2 식별', 266, 70)).toBe('S2 식별 (266, 70)');
    expect(cycle(['a', 'b', 'c'], 'c', 1)).toBe('a');
  });

  it('refuses a locked unit and a running edit, and still allows a look around', () => {
    const p = buildSampleProject();
    p.units.find((u) => u.id === 'U-S1')!.positionLocked = true;
    const nav: DiagramNav = { cursor: { level: 'unit', id: 'U-S1' }, link: null };
    expect(diagramEffect({ type: 'nudge', dx: 10, dy: 0 }, nav, p, [], false)).toMatchObject({ type: 'refuse', toast: LOCKED_NUDGE });
    expect(diagramEffect({ type: 'nudge', dx: 10, dy: 0 }, nav, p, [], true)).toMatchObject({ type: 'refuse', toast: RUN_CANVAS_BLOCKED });
    expect(diagramEffect({ type: 'flow' }, nav, p, [], true)).toMatchObject({ type: 'refuse', toast: RUN_CANVAS_BLOCKED });
    expect(diagramEffect({ type: 'signal' }, { cursor: { level: 'device', unitId: 'U-S2', id: 'BCR-02' }, link: null }, p, [], true).type).toBe('refuse');
    expect(diagramEffect({ type: 'tab', dir: 1 }, nav, p, [], true)).toMatchObject({ type: 'cursor', focusId: 'U-S2' });
    expect(diagramEffect({ type: 'zoom', dir: 1 }, nav, p, [], true)).toEqual({ type: 'zoom', dir: 1 });
    const bare = buildSampleProject();
    bare.signals = bare.signals.filter((s) => s.deviceId !== 'BCR-02' || s.direction !== 'out');
    expect(diagramEffect({ type: 'signal' }, { cursor: { level: 'device', unitId: 'U-S2', id: 'BCR-02' }, link: null }, bare, [], false)).toMatchObject({ toast: START_OUT });
  });

  it('starts a flow on the next unit and a signal on an input port', () => {
    const p = buildSampleProject();
    const flow = diagramEffect({ type: 'flow' }, { cursor: { level: 'unit', id: 'U-S1' }, link: null }, p, [], false);
    expect(flow).toMatchObject({ type: 'link', focusId: 'U-S2', mode: 'flow' });
    if (flow.type !== 'link' || flow.link.kind !== 'flow') throw new Error('flow');
    const hopped = diagramEffect({ type: 'tab', dir: 1 }, { cursor: flow.cursor, link: flow.link }, p, [], false);
    expect(hopped).toMatchObject({ type: 'link', focusId: 'U-S3' });
    const signal = diagramEffect({ type: 'signal' }, { cursor: { level: 'device', unitId: 'U-S2', id: 'BCR-02' }, link: null }, p, [], false);
    expect(signal.type).toBe('link');
    if (signal.type !== 'link' || signal.link.kind !== 'signal') throw new Error('signal');
    expect(signal.link.fromSignalId).not.toBe(signal.link.targetSignalId);
    expect(p.signals.find((s) => s.id === signal.link.fromSignalId)?.direction).toBe('out');
    expect(p.signals.find((s) => s.id === signal.link.targetSignalId)?.direction).toBe('in');
  });

  it('pans a node that sits outside the pane and leaves one that is already inside', () => {
    const pane = { w: 200, h: 200 };
    expect(panToReveal({ x: 0, y: 0, zoom: 1 }, { x: -100, y: 40, w: 20, h: 20 }, pane)).toEqual({ x: 124, y: 0 });
    expect(panToReveal({ x: 0, y: 0, zoom: 1 }, { x: 300, y: 40, w: 40, h: 20 }, pane)?.x).toBeLessThan(0);
    expect(panToReveal({ x: 0, y: 0, zoom: 1 }, { x: 40, y: 40, w: 20, h: 20 }, pane)).toBeNull();
    expect(panToReveal({ x: 0, y: 0, zoom: 1 }, { x: 0, y: 0, w: 10, h: 10 }, { w: 0, h: 0 })).toBeNull();
  });

  it('opens the reparent question when a device center enters another unit', () => {
    const units = [
      { id: 'A', x: 0, y: 0, w: 100, h: 100 },
      { id: 'B', x: 120, y: 0, w: 100, h: 100 },
    ];
    expect(crossingUnit(units, 'A', 40, 40, 20, 20, 10, 0)).toBeNull();
    expect(crossingUnit(units, 'A', 70, 40, 20, 20, 40, 0)).toBe('B');
  });

  it('lists the new diagram keys and mentions them in the diagram help', () => {
    const names = EXTRA_SHORTCUTS.map((row) => row.name);
    for (const name of ['도면의 Unit · Device 순회', '물류 잇기', '신호 잇기', '도면 격자 한 칸(10) 이동', '도면 큰 걸음(50) 이동', '도면 1 이동', '도면 확대·축소', '도면 화면 맞춤']) {
      expect(names).toContain(name);
    }
    const help = HELP_TOPICS.find((t) => t.id === 'canvas:diagram')!;
    expect(help.tasks.some((line) => line.includes('Tab') && line.includes('L') && line.includes('S'))).toBe(true);
    expect(help.stuck.some((line) => line.includes('방향키') && line.includes('Tab'))).toBe(true);
    expect(help.tasks.length).toBeLessThanOrEqual(6);
    expect(help.stuck.length).toBeLessThanOrEqual(3);
  });
});
