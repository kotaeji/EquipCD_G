// @vitest-environment jsdom
// TURN-035: one run frame, a highlighted running row, and an explorer rail that gives the canvas the width.
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSampleProject } from '../src/model/sample';
import { createRuntime } from '../src/runtime/engine';
import { describeRunInfo } from '../src/scene/runInfo';
import { App } from '../src/ui/App';
import { FlowEditor } from '../src/ui/FlowEditor';
import { RunStepsPanel } from '../src/ui/RunInfoPanel';
import { RunSummary } from '../src/ui/RunSummary';
import { VIEW_3D_ONLY } from '../src/ui/RunConditions';
import { loadView } from '../src/ui/viewSettings';
import { holdRuntimeClock } from './holdRuntimeClock';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const styles = readFileSync('src/ui/styles.css', 'utf8');
let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  localStorage.clear();
});

async function mount(opts?: { fresh?: boolean; sample?: 'flow' | 'parallel' }) {
  if (opts?.fresh !== false) localStorage.clear();
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(<App />); });
  const click = async (node: Element) => { await act(async () => { (node as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label || b.getAttribute('aria-label') === label) as HTMLButtonElement;
  if (opts?.sample === 'flow') await click(btn('흐름 예제'));
  else if (opts?.sample === 'parallel') await click(btn('병렬 예제'));
  else if (btn('시작하기')) await click(btn('시작하기'));
  const step = el.querySelector('.stepper [data-stepid="run"]');
  if (step && el.querySelector('.app')!.getAttribute('data-step') !== 'run') await click(step);
  return { el, click, btn };
}

function frame(el: ParentNode) {
  return {
    steps: el.querySelector('.run-steps'),
    strip: el.querySelector('.run-strip'),
    cond: el.querySelector('.run-conditions'),
    details: el.querySelector('.run-details'),
    canvas: el.querySelector('.run-canvas'),
  };
}

describe('TURN-035 unified run layout', () => {
  it('AC1 AC11 diagram and 3D share one frame and only the canvas changes', async () => {
    const u = await mount();
    const diagram = frame(u.el);
    expect(diagram.steps!.getAttribute('aria-label')).toBe('단계');
    expect(diagram.strip!.getAttribute('aria-label')).toBe('실행 요약');
    expect(diagram.cond!.getAttribute('aria-label')).toBe('가동 조건');
    expect(diagram.details!.getAttribute('aria-label')).toBe('자세히');
    expect(diagram.canvas!.querySelector('.diagram-canvas')).not.toBeNull();
    expect(diagram.canvas!.querySelector('.run-stage')).toBeNull();
    expect(u.el.querySelector('.run-tabs')).toBeNull();
    expect(u.el.querySelector('[aria-label="실행 패널 너비"]')).toBeNull();
    await u.click(u.el.querySelector('[data-tree-id="PSH-01"]')!);
    expect(u.el.querySelector('[data-selected-device]')!.textContent).toContain('PSH-01');
    await u.click(u.btn('단계 접기'));
    await u.click(u.btn('3D'));
    expect(u.el.querySelector('[data-run-view]')!.getAttribute('data-run-view')).toBe('3d');
    expect(u.el.querySelector('.run-stage')).not.toBeNull();
    expect(u.el.querySelector('.diagram-canvas')).toBeNull();
    expect(frame(u.el).steps!.className).toContain('is-folded');
    await u.click(u.btn('단계 펼치기'));
    expect(u.el.querySelector('[data-selected-device]')!.textContent).toContain('PSH-01');
    await u.click(u.btn('단계 접기'));
    expect(u.el.querySelector('[aria-label="전체 보기"]')).not.toBeNull();
    await u.click(u.btn('도면'));
    expect(u.el.querySelector('.diagram-canvas')).not.toBeNull();
    expect(u.el.querySelector('.run-stage')).toBeNull();
    expect(u.el.querySelector('.run-steps')!.className).toContain('is-folded');
  });

  it('AC2 the strip matches describeRunInfo and remembers a fold', async () => {
    const u = await mount();
    const info = describeRunInfo(buildSampleProject(), null);
    const strip = u.el.querySelector('.run-strip')!;
    expect(strip.querySelector('[data-run-status]')!.textContent).toBe('대기');
    expect(strip.querySelector('[data-run-time]')!.textContent).toBe(info.timeText);
    expect(strip.querySelector('[data-running-count]')!.textContent).toContain('없음');
    expect(strip.querySelector('[data-material]')!.textContent).toContain(info.material!.where);
    expect(strip.querySelector('[data-cycle-time]')!.textContent).toBe(info.cycleText);
    expect(strip.querySelector('[data-throughput]')!.textContent).toBe(info.throughputText);
    expect(strip.querySelector('[data-throughput-note]')!.textContent).toBe(info.throughputNote);
    expect(strip.querySelector('[data-bottleneck]')!.getAttribute('data-bottleneck')).toBe(info.bottleneck!.unitId);
    expect(strip.querySelector('[data-gap-total]')!.getAttribute('data-gap-total')).toBe(String(info.gapTotal));
    await u.click(u.btn('요약 접기'));
    expect(u.el.querySelector('[data-cycle-time]')).toBeNull();
    expect(u.el.querySelector('[data-material]')).toBeNull();
    expect(u.el.querySelector('[data-run-status]')).not.toBeNull();
    expect(u.el.querySelector('[data-run-time]')).not.toBeNull();
    expect(u.el.querySelector('[data-running-count]')).not.toBeNull();
    expect(loadView(localStorage).runStripFolded).toBe(true);
    await act(async () => { root!.unmount(); });
    root = null;
    const again = await mount({ fresh: false });
    expect(again.el.querySelector('[data-cycle-time]')).toBeNull();
    expect(again.el.querySelector('[data-run-status]')).not.toBeNull();
    await again.click(again.btn('요약 펼치기'));
    expect(again.el.querySelector('[data-cycle-time]')).not.toBeNull();
  });

  it('AC3 the left column is steps, unit totals, and the device, with lane and pass', async () => {
    const u = await mount({ sample: 'flow' });
    const steps = u.el.querySelector('.run-steps')!;
    expect(steps.querySelector('[aria-label="단계별 시간"]')).not.toBeNull();
    expect(steps.querySelector('[aria-label="Unit 별 합계"]')).not.toBeNull();
    expect(steps.querySelector('[aria-label="선택한 Device"]')).not.toBeNull();
    expect(steps.textContent).not.toContain('사이클 시간');
    expect(steps.textContent).not.toContain('시간당 생산량');
    const clock = holdRuntimeClock();
    try {
      await u.click(u.btn('▶ 실행'));
      await u.click(u.btn('끝까지'));
    } finally {
      clock.restore();
    }
    const passes = [...steps.querySelectorAll('[data-pass]')].map((node) => node.getAttribute('data-pass'));
    const lanes = [...steps.querySelectorAll('[data-lane]')].map((node) => node.getAttribute('data-lane'));
    expect(passes).toContain('2');
    expect(lanes.some((lane) => (lane ?? '').includes('갈래'))).toBe(true);
    const parallel = await mount({ sample: 'parallel' });
    const pclock = holdRuntimeClock();
    try {
      await parallel.click(parallel.btn('▶ 실행'));
      await parallel.click(parallel.btn('끝까지'));
    } finally {
      pclock.restore();
    }
    const plane = [...parallel.el.querySelectorAll('.run-steps [data-lane]')].map((node) => node.getAttribute('data-lane'));
    expect(plane.some((lane) => (lane ?? '').includes('시퀀스'))).toBe(true);
  });

  it('AC4 moved diagram facts sit in the strip, the details, and the conditions', async () => {
    const u = await mount();
    expect(u.el.querySelector('.run-conditions [data-readiness="ok"]')!.textContent).toBe('실행 가능');
    expect([...u.el.querySelectorAll('.run-conditions select')].some((node) => (node.textContent ?? '').includes('완료 신호 미발생'))).toBe(true);
    expect([...u.el.querySelectorAll('.run-conditions button')].some((b) => (b.textContent ?? '').trim() === '저장')).toBe(false);
    const clock = holdRuntimeClock();
    try {
      await u.click(u.btn('▶ 실행'));
      await clock.elapse(1);
      await u.click(u.btn('❚❚ 일시정지'));
    } finally {
      clock.restore();
    }
    expect(u.el.querySelector('.run-details-last')!.textContent).not.toBe('로그 없음');
    await u.click(u.btn('자세히 펼치기'));
    expect(u.el.querySelector('.run-summary-table')).not.toBeNull();
    expect(u.el.querySelector('#run-detail-tab-summary')!.getAttribute('aria-selected')).toBe('true');
    await u.click(u.el.querySelector('#run-detail-tab-log')!);
    expect(u.el.querySelector('.log-list')!.textContent).toContain('RUN_START');
    await u.click(u.el.querySelector('#run-detail-tab-signals')!);
    expect(u.el.querySelector('[aria-label="신호 상태"]')!.textContent).toContain('OFF');
    expect(loadView(localStorage).runDetailsOpen).toBe(true);
    expect(loadView(localStorage).runDetailsTab).toBe('signals');
    await u.click(u.btn('⟲ 초기화'));
    const fault = [...u.el.querySelectorAll('.run-conditions select')].find((s) => (s.textContent ?? '').includes('완료 신호 미발생')) as HTMLSelectElement;
    const opt = [...fault.options].find((o) => (o.textContent ?? '').includes('S2 바코드'))!;
    await act(async () => {
      fault.value = opt.value;
      fault.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const end = holdRuntimeClock();
    try {
      await u.click(u.btn('▶ 실행'));
      await u.click(u.btn('끝까지'));
    } finally {
      end.restore();
    }
    const notice = [...u.el.querySelectorAll('h2')].find((h) => h.textContent === 'Station 실행 차단')!;
    expect(u.el.querySelector('.run-center')!.contains(notice)).toBe(true);
    expect(notice.compareDocumentPosition(u.el.querySelector('.run-canvas')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('AC5 switching, folding, and details keep the same run totals', async () => {
    const sample = await mount();
    const clock = holdRuntimeClock();
    try {
      await sample.click(sample.btn('▶ 실행'));
      await sample.click(sample.btn('3D'));
      await sample.click(sample.btn('요약 접기'));
      await sample.click(sample.btn('자세히 펼치기'));
      await sample.click(sample.btn('도면'));
      expect(clock.queued()).toBeGreaterThan(0);
      await sample.click(sample.btn('끝까지'));
    } finally {
      clock.restore();
    }
    expect(sample.el.querySelector('[data-run-time]')!.textContent).toBe('00:11.100');
    const flow = await mount({ sample: 'flow' });
    const flowClock = holdRuntimeClock();
    try {
      await flow.click(flow.btn('▶ 실행'));
      await flow.click(flow.btn('3D'));
      await flow.click(flow.btn('끝까지'));
    } finally {
      flowClock.restore();
    }
    expect(flow.el.querySelector('[data-run-time]')!.textContent).toBe('00:13.100');
    const parallel = await mount({ sample: 'parallel' });
    const pclock = holdRuntimeClock();
    try {
      await parallel.click(parallel.btn('▶ 실행'));
      await parallel.click(parallel.btn('도면'));
      await parallel.click(parallel.btn('끝까지'));
    } finally {
      pclock.restore();
    }
    expect(parallel.el.querySelector('[data-run-time]')!.textContent).toBe('00:02.500');
  });

  it('AC6 the canvas keeps a 200px floor in the stylesheet', () => {
    expect(styles).toMatch(/\.run-canvas\s*\{[^}]*min-height:\s*200px/);
    expect(styles).toMatch(/\.run-details\.is-open\s*\{[^}]*max-height:\s*150px/);
    const runCss = readFileSync('src/ui/run3d.css', 'utf8');
    expect(runCss).toMatch(/\.run-steps-scroll\s*\{[^}]*overflow:\s*auto/);
    expect(runCss).toMatch(/\.run-steps-units\s*\{[^}]*max-height:\s*136px/);
    expect(runCss).toMatch(/\.run-strip\s*\{[^}]*max-height:\s*72px/);
    expect(runCss).toMatch(/\.run-strip-fixed\s*\{[^}]*flex:\s*0 0 auto/);
    expect(runCss).toMatch(/\.run-strip-id\s*\{[^}]*flex:\s*0 1000 auto/);
    expect(runCss).toMatch(/\.run-strip-running\s*\{[^}]*text-overflow:\s*ellipsis/);
  });

  it('AC7 a running row uses the selected fill, and error and stopped rows use other edges', async () => {
    expect(styles).toMatch(/\.step-row\.is-running\s*\{[^}]*background:\s*var\(--selected\)/);
    expect(styles).toMatch(/\.step-row\.is-running\s*\{[^}]*border:\s*2px solid var\(--accent\)/);
    expect(styles).toMatch(/\.step-row\.is-running\s*\{[^}]*font-weight:\s*700/);
    expect(styles).toMatch(/\.step-row\.is-error\s*\{[^}]*var\(--danger\)/);
    expect(styles).toMatch(/\.step-row\.is-stopped\s*\{[^}]*var\(--warning\)/);
    const u = await mount({ sample: 'parallel' });
    const clock = holdRuntimeClock();
    try {
      await u.click(u.btn('▶ 실행'));
      await clock.elapse(1);
      const rows = [...u.el.querySelectorAll('.run-steps .step-row.is-running')];
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows.every((row) => row.textContent?.includes('진행 중'))).toBe(true);
    } finally {
      clock.restore();
    }
    const p = buildSampleProject();
    const rt = createRuntime(p).state;
    const [a, b, c] = p.sequence.steps;
    rt.status = 'running';
    rt.steps = [
      { stepId: a.id, status: 'error', startMs: 0, endMs: 100 },
      { stepId: b.id, status: 'stopped', startMs: 0, endMs: 100 },
      { stepId: c.id, status: 'active', startMs: 100 },
    ];
    const host = document.createElement('div');
    document.body.appendChild(host);
    const local = createRoot(host);
    await act(async () => {
      local.render(<>
        <RunStepsPanel p={p} rt={rt} selectedId={null} folded={false} onToggleFold={() => {}} />
        <RunSummary p={p} rt={rt} embedded />
        <FlowEditor p={p} rt={rt} locked={false} edit={() => true} />
      </>);
    });
    const expectPhase = (scope: ParentNode, name: string, cls: string) => {
      const row = [...scope.querySelectorAll('.step-row')].find((node) => node.textContent?.includes(name));
      expect(row!.className).toContain(cls);
    };
    expectPhase(host.querySelector('.run-steps')!, a.name, 'is-error');
    expectPhase(host.querySelector('.run-steps')!, b.name, 'is-stopped');
    expectPhase(host.querySelector('.run-steps')!, c.name, 'is-running');
    expectPhase(host.querySelector('.run-summary')!, a.name, 'is-error');
    expectPhase(host.querySelector('table[aria-label="Station 흐름"]')!, c.name, 'is-running');
    await act(async () => { local.unmount(); });
  });

  it('AC8 a later running row is scrolled into view unless the list was just scrolled', async () => {
    const calls: HTMLElement[] = [];
    const origScroll = HTMLElement.prototype.scrollIntoView;
    const origRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.scrollIntoView = function scrollIntoView() { calls.push(this as HTMLElement); };
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      const box = (top: number, height: number) => ({ top, bottom: top + height, left: 0, right: 220, width: 220, height, x: 0, y: top, toJSON() { return {}; } }) as DOMRect;
      if (this.classList.contains('run-steps-scroll')) return box(0, 120);
      if (this.classList.contains('step-row')) {
        const rows = [...(this.parentElement?.children ?? [])].filter((node) => (node as Element).classList.contains('step-row'));
        return box(Math.max(0, rows.indexOf(this)) * 40, 36);
      }
      return origRect.call(this);
    };
    try {
      const u = await mount({ sample: 'flow' });
      const clock = holdRuntimeClock();
      try {
        await u.click(u.btn('▶ 실행'));
        await clock.elapse(1);
      } finally {
        clock.restore();
      }
      expect(calls).toHaveLength(0);
      await u.click(u.btn('❚❚ 일시정지'));
      const activeIndex = () => [...u.el.querySelectorAll('.run-steps .step-row')].findIndex((row) => row.classList.contains('is-running'));
      let guard = 0;
      while (activeIndex() < 8 && guard++ < 180) await u.click(u.btn('+0.1s'));
      expect(activeIndex()).toBeGreaterThanOrEqual(8);
      expect(calls.some((node) => node.classList.contains('is-running'))).toBe(true);
      const before = calls.length;
      let now = 1_700_000_000_000;
      const spy = vi.spyOn(Date, 'now').mockImplementation(() => now);
      u.el.querySelector('.run-steps-scroll')!.dispatchEvent(new Event('scroll'));
      const key = () => u.el.querySelector('.run-steps .step-row.is-running')?.getAttribute('data-step-key');
      const held = key();
      for (let i = 0; i < 30 && key() === held; i += 1) await u.click(u.btn('+0.1s'));
      expect(key()).not.toBe(held);
      expect(calls).toHaveLength(before);
      now += 3001;
      const next = key();
      for (let i = 0; i < 30 && key() === next; i += 1) await u.click(u.btn('+0.1s'));
      expect(calls.length).toBeGreaterThan(before);
      spy.mockRestore();
    } finally {
      HTMLElement.prototype.scrollIntoView = origScroll;
      HTMLElement.prototype.getBoundingClientRect = origRect;
    }
  });

  it('AC9 AC10 collapsing the explorer sets a 40px rail and keeps that choice', async () => {
    expect(styles).not.toContain('.app, .app.ex-collapsed { --exw: 224px; }');
    expect(styles).toContain('.app.ex-collapsed { --exw: 40px; }');
    const u = await mount();
    const app = () => u.el.querySelector('.app') as HTMLElement;
    const width = () => app().style.getPropertyValue('--exw');
    expect(width()).toBe('224px');
    await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]')!);
    await u.click(u.btn('탐색기 접기'));
    expect(app().className).toContain('ex-collapsed');
    expect(width()).toBe('40px');
    expect(u.el.querySelector('[aria-label="탐색기 펼치기"]')!.getAttribute('aria-expanded')).toBe('false');
    expect(u.el.querySelector('.proj-sec')).toBeNull();
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    expect(width()).toBe('40px');
    expect(u.el.querySelector('.diagram-canvas')).not.toBeNull();
    await u.click(u.btn('3D'));
    expect(width()).toBe('40px');
    expect(u.el.querySelector('.run-canvas .run-stage')).not.toBeNull();
    await u.click(u.btn('탐색기 펼치기'));
    expect(width()).toBe('224px');
    expect(u.el.querySelector('[aria-label="탐색기 접기"]')!.getAttribute('aria-expanded')).toBe('true');
    await u.click(u.btn('탐색기 접기'));
    expect(loadView(localStorage).explorerOpen).toBe(false);
    await act(async () => { root!.unmount(); });
    root = null;
    const again = await mount({ fresh: false });
    expect((again.el.querySelector('.app') as HTMLElement).style.getPropertyValue('--exw')).toBe('40px');
    expect(again.el.querySelector('.app')!.className).toContain('ex-collapsed');
  });

  it('diagram view shows the 3D options switched off', async () => {
    const u = await mount();
    const names = u.el.querySelector('[aria-label="이름 표시"]') as HTMLInputElement;
    const motion = u.el.querySelector('[aria-label="동작 강조"]') as HTMLInputElement;
    const equipment = u.el.querySelector('[aria-label="설비 동작"]') as HTMLInputElement;
    expect(names.disabled).toBe(true);
    expect(names.checked).toBe(false);
    expect(names.title).toBe(VIEW_3D_ONLY);
    expect(motion.disabled).toBe(true);
    expect(equipment.disabled).toBe(true);
    expect(equipment.checked).toBe(false);
    expect(equipment.title).toBe(VIEW_3D_ONLY);
    await u.click(u.btn('3D'));
    expect((u.el.querySelector('[aria-label="이름 표시"]') as HTMLInputElement).disabled).toBe(false);
    expect((u.el.querySelector('[aria-label="이름 표시"]') as HTMLInputElement).checked).toBe(true);
    expect((u.el.querySelector('[aria-label="설비 동작"]') as HTMLInputElement).disabled).toBe(false);
    expect((u.el.querySelector('[aria-label="설비 동작"]') as HTMLInputElement).checked).toBe(true);
  });
});
