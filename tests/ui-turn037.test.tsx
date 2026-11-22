// @vitest-environment jsdom
// TURN-037: stage-6 plan fits the pane. jsdom has no layout, so the pane size is delivered through ResizeObserver.
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSampleProject } from '../src/model/sample';
import { App } from '../src/ui/App';
import {
  planFitReport,
  runEquipmentBoxes,
  runPlanViewport,
  unionBounds,
  type PlanBox,
} from '../src/ui/Canvas';
import { holdRuntimeClock } from './holdRuntimeClock';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const styles = readFileSync('src/ui/styles.css', 'utf8');
const canvasSrc = readFileSync('src/ui/Canvas.tsx', 'utf8');
let root: Root | null = null;
let restoreObserver: (() => void) | null = null;

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  restoreObserver?.();
  restoreObserver = null;
  document.body.innerHTML = '';
  localStorage.clear();
});

type Pane = {
  set: (w: number, h: number) => void;
  apply: (w: number, h: number) => Promise<void>;
  size: () => { w: number; h: number };
};

function installPane(width = 576, height = 389): Pane {
  const previous = globalThis.ResizeObserver;
  let size = { w: width, h: height };
  const watched: { cb: ResizeObserverCallback; target: Element }[] = [];
  const box = (w: number, h: number) => ({
    x: 0, y: 0, top: 0, left: 0, right: w, bottom: h, width: w, height: h, toJSON() { return {}; },
  });
  const fire = () => {
    for (const w of [...watched]) {
      const host = w.target.classList.contains('rf-host') || w.target.classList.contains('react-flow');
      const wdt = host ? size.w : 0;
      const hgt = host ? size.h : 0;
      w.cb([{
        target: w.target,
        contentRect: box(wdt, hgt) as DOMRectReadOnly,
        borderBoxSize: [],
        contentBoxSize: [],
        devicePixelContentBoxSize: [],
      } as unknown as ResizeObserverEntry], {} as ResizeObserver);
    }
  };
  class RO {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) { this.cb = cb; }
    observe(target: Element) {
      watched.push({ cb: this.cb, target });
      fire();
    }
    unobserve(target: Element) {
      const i = watched.findIndex((w) => w.cb === this.cb && w.target === target);
      if (i >= 0) watched.splice(i, 1);
    }
    disconnect() {
      for (let i = watched.length - 1; i >= 0; i -= 1) if (watched[i].cb === this.cb) watched.splice(i, 1);
    }
  }
  globalThis.ResizeObserver = RO as unknown as typeof ResizeObserver;
  restoreObserver = () => { globalThis.ResizeObserver = previous; };
  return {
    set(w: number, h: number) { size = { w, h }; },
    async apply(w: number, h: number) {
      size = { w, h };
      await act(async () => { fire(); });
    },
    size: () => size,
  };
}

function readViewport(scope: ParentNode) {
  const vp = scope.querySelector('.run-canvas .react-flow__viewport') as HTMLElement | null;
  const t = vp?.style.transform ?? '';
  const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/.exec(t);
  if (!m) return null;
  return { x: Number(m[1]), y: Number(m[2]), zoom: Number(m[3]) };
}

function unitBounds(project = buildSampleProject()): PlanBox {
  const bounds = unionBounds(project.units.map((u) => ({ x: u.layout.x, y: u.layout.y, w: u.layout.w, h: u.layout.h })));
  if (!bounds) throw new Error('no units');
  return bounds;
}

function expectFit(scope: ParentNode, width: number, height: number) {
  const vp = readViewport(scope);
  expect(vp).not.toBeNull();
  const equipment = unionBounds(runEquipmentBoxes(buildSampleProject(), null));
  expect(equipment).not.toBeNull();
  const expected = runPlanViewport(equipment!, width, height);
  expect(vp!.zoom).toBeCloseTo(expected.zoom, 2);
  expect(vp!.x).toBeCloseTo(expected.x, 0);
  expect(vp!.y).toBeCloseTo(expected.y, 0);
  const report = planFitReport(unitBounds(), width, height, vp!);
  expect(report.inside).toBe(true);
  expect(report.fills).toBe(true);
  return vp!;
}

async function mountRun(pane = installPane()) {
  localStorage.clear();
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(<App />); });
  const click = async (node: Element | undefined) => {
    if (!node) throw new Error('missing control');
    await act(async () => { (node as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  };
  const btn = (label: string) => [...el.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label || b.getAttribute('aria-label') === label) as HTMLButtonElement | undefined;
  await click(btn('시작하기'));
  await click(el.querySelector('.stepper [data-stepid="run"]')!);
  await act(async () => { await Promise.resolve(); });
  return { el, click, btn, pane };
}

describe('TURN-037 stage-6 plan fit', () => {
  it('AC1 the first diagram fits every unit and uses at least 70% of the pane', async () => {
    const { el } = await mountRun(installPane(576, 389));
    expectFit(el, 576, 389);
  });

  it('a short pane still fills by height, and a tiny station may stop at max zoom', () => {
    const project = buildSampleProject();
    const units = unitBounds(project);
    const short = runPlanViewport(unionBounds(runEquipmentBoxes(project, null))!, 1100, 200);
    const shortReport = planFitReport(units, 1100, 200, short);
    expect(shortReport.inside).toBe(true);
    expect(shortReport.fills).toBe(true);
    const tiny = { x: 0, y: 0, w: 40, h: 30 };
    const capped = runPlanViewport(tiny, 800, 600);
    const cappedReport = planFitReport(tiny, 800, 600, capped);
    expect(capped.zoom).toBe(2);
    expect(cappedReport.atMax).toBe(true);
    expect(cappedReport.fills).toBe(true);
    expect(cappedReport.inside).toBe(true);
  });

  it('AC2 folding the explorer, steps, conditions, or details refits the new pane', async () => {
    const { el, click, btn, pane } = await mountRun();
    expectFit(el, 576, 389);
    const steps: [string, number, number][] = [
      ['단계 접기', 768, 389],
      ['가동 조건 접기', 960, 389],
      ['탐색기 접기', 1100, 360],
      ['자세히 펼치기', 1100, 240],
    ];
    for (const [label, w, h] of steps) {
      await click(btn(label));
      await pane.apply(w, h);
      expectFit(el, w, h);
    }
    await click(btn('자세히 접기'));
    await pane.apply(1100, 389);
    expectFit(el, 1100, 389);
  });

  it('AC3 returning from 3D fits again, even after a zoom', async () => {
    const { el, click, btn, pane } = await mountRun();
    expectFit(el, 576, 389);
    await click(el.querySelector('.run-canvas .react-flow__controls-zoomin')!);
    const zoomed = readViewport(el)!;
    expect(zoomed.zoom).toBeGreaterThan(runPlanViewport(unionBounds(runEquipmentBoxes(buildSampleProject(), null))!, 576, 389).zoom + 0.05);
    await click(btn('3D'));
    expect(el.querySelector('.run-canvas .react-flow')).toBeNull();
    await click(btn('도면'));
    await act(async () => { await Promise.resolve(); });
    expectFit(el, pane.size().w, pane.size().h);
  });

  it('AC4 a zoom survives a pane change until 화면 맞춤', async () => {
    const { el, click, btn, pane } = await mountRun();
    expectFit(el, 576, 389);
    await click(el.querySelector('.run-canvas .react-flow__controls-zoomin')!);
    const zoomed = readViewport(el)!;
    await pane.apply(960, 420);
    const held = readViewport(el)!;
    expect(held.zoom).toBeCloseTo(zoomed.zoom, 2);
    expect(held.x).toBeCloseTo(zoomed.x, 0);
    expect(held.y).toBeCloseTo(zoomed.y, 0);
    await click(btn('화면 맞춤'));
    expectFit(el, 960, 420);
  });

  it('AC5 refitting during a run does not change status, time, or step records', async () => {
    const { el, click, btn, pane } = await mountRun();
    const clock = holdRuntimeClock();
    try {
      await click(btn('▶ 실행'));
      await clock.elapse(400);
    } finally {
      clock.restore();
    }
    const snap = () => ({
      status: el.querySelector('[data-run-status]')!.textContent,
      time: el.querySelector('[data-run-time]')!.textContent,
      log: el.querySelector('.run-details-last')!.textContent,
      steps: el.querySelector('.run-steps-scroll')!.textContent,
      rev: el.querySelector('.statusbar')!.textContent,
    });
    const before = snap();
    expect(before.status).toBe('실행 중');
    expect(before.log).not.toBe('로그 없음');
    await pane.apply(880, 340);
    expect(snap()).toEqual(before);
    const fitted = planFitReport(unitBounds(), 880, 340, readViewport(el)!);
    expect(fitted.inside).toBe(true);
    expect(fitted.fills).toBe(true);
  });

  it('AC6 the details label stays one line, and stage 2 keeps its own fit', async () => {
    expect(styles).toMatch(/\.run-details-head > button \{[^}]*white-space:\s*nowrap/);
    expect(styles).toMatch(/\.run-details-head > button \{[^}]*flex:\s*0 0 auto/);
    expect(styles).toMatch(/\.run-details-head > button \{[^}]*min-width:\s*max-content/);
    expect(canvasSrc).toContain("const FIT_PADDING = { top: '48px', right: '188px', bottom: '140px', left: '52px' }");
    expect(canvasSrc).toContain('const FIT_MIN_ZOOM = 0.5');
    const { el, click, btn } = await mountRun();
    const label = () => el.querySelector('.run-details-head > button') as HTMLButtonElement;
    expect(label().textContent).toBe('자세히');
    expect(label().childNodes).toHaveLength(1);
    expect(el.querySelector('.run-canvas .react-flow__controls-fitview')).toBeNull();
    expect([...el.querySelectorAll('button')].some((b) => (b.textContent ?? '').trim() === '화면 맞춤')).toBe(true);
    await click(btn('자세히 펼치기'));
    expect(label().textContent).toBe('자세히');
    expect(label().getAttribute('aria-expanded')).toBe('true');
    expect(label().childNodes).toHaveLength(1);
    await click(el.querySelector('.stepper [data-stepid="canvas"]')!);
    await click(btn('도면 도식') ?? [...el.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('도면 도식')));
    expect(el.querySelector('.layout-tabs .react-flow__controls-fitview')).not.toBeNull();
    expect([...el.querySelectorAll('button')].some((b) => (b.textContent ?? '').trim() === '화면 맞춤')).toBe(false);
  });
});
