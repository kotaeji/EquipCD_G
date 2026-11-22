// @vitest-environment jsdom
// TURN-030: step 6 diagram view splits status, canvas, and checks into the shared tabs.
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/ui/App';
import { loadView } from '../src/ui/viewSettings';
import { holdRuntimeClock } from './holdRuntimeClock';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const css = readFileSync('src/ui/styles.css', 'utf8');
let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  localStorage.clear();
});

type RunTabId = 'status' | 'diagram' | 'inspect';

async function mount(opts?: { fresh?: boolean; sample?: 'flow' | 'parallel' }) {
  if (opts?.fresh !== false) localStorage.clear();
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(<App />); });
  const click = async (node: Element) => { await act(async () => { (node as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
  const key = async (node: Element, k: string) => { await act(async () => { node.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); }); };
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label || b.getAttribute('aria-label') === label) as HTMLButtonElement;
  const tab = (id: RunTabId) => el.querySelector(`#run-tab-${id}`) as HTMLButtonElement;
  const panel = (id: RunTabId) => el.querySelector(`#run-panel-${id}`) as HTMLElement;
  if (opts?.sample === 'flow') await click(btn('흐름 예제'));
  else if (opts?.sample === 'parallel') await click(btn('병렬 예제'));
  else if (btn('시작하기')) await click(btn('시작하기'));
  const step = el.querySelector('.stepper [data-stepid="run"]');
  if (step && el.querySelector('.app')!.getAttribute('data-step') !== 'run') await click(step);
  return { el, click, key, btn, tab, panel };
}

const STATUS_EN = /\b(idle|running|paused|completed|error)\b/;

function screenText(el: ParentNode) {
  const run = el.querySelector('.ws-run')?.textContent ?? '';
  const bar = el.querySelector('.statusbar')?.textContent ?? '';
  return `${run}\n${bar}`;
}

describe('TURN-030 run tabs', () => {
  it('AC1 AC2 the diagram view uses the shared tabs and drops the fold', async () => {
    const u = await mount({ sample: 'flow' });
    const list = u.el.querySelector('.run-tabs [role=tablist]')!;
    expect(list.getAttribute('aria-label')).toBe('실행');
    expect(list.className).toBe('ui-tabs');
    expect([...u.el.querySelectorAll('.run-tabs [role=tab]')].map((t) => t.textContent)).toEqual(['실행 상태', '실행 도면', '검사 · 오류 주입']);
    expect(u.tab('status').getAttribute('aria-selected')).toBe('true');
    expect(u.panel('status').hasAttribute('hidden')).toBe(false);
    expect(u.panel('diagram').hasAttribute('hidden')).toBe(true);
    expect(u.panel('inspect').hasAttribute('hidden')).toBe(true);
    expect(u.panel('status').textContent).toContain('Station 실행 상태');
    expect(u.panel('status').querySelector('.run-summary summary')!.textContent).toBe('실행 결과 요약');
    expect(u.panel('diagram').querySelector('.diagram-canvas .react-flow')).not.toBeNull();
    expect(u.panel('diagram').querySelector('table')).toBeNull();
    expect(u.panel('diagram').querySelector('.run-summary')).toBeNull();
    expect(u.panel('inspect').textContent).toContain('준비 검사');
    expect(u.panel('inspect').textContent).toContain('검증용 오류 주입');
    expect(u.panel('inspect').querySelector('.diagram-canvas')).toBeNull();
    expect(u.el.textContent).not.toContain('실행 도면, 로그, 차단 이동');
    expect(u.el.querySelector('.run-side h2')!.textContent).toBe('실행 로그');
    expect(css).toMatch(/\.run-tabs #run-panel-diagram:not\(\[hidden\]\) \.diagram-canvas \{[^}]*min-height:\s*360px/);
    expect(css).not.toMatch(/\.run-tabs \[role="tab"\]/);
    const rule = css.slice(css.indexOf('.ui-tabs [role="tab"][aria-selected="true"]'));
    expect(rule).toMatch(/color:\s*var\(--accent\)/);

    await u.key(u.tab('status'), 'ArrowRight');
    expect(u.tab('diagram').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(u.tab('diagram'));
    expect(u.panel('diagram').hasAttribute('hidden')).toBe(false);
    await u.key(u.tab('diagram'), 'End');
    expect(u.tab('inspect').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(u.tab('inspect'));
    await u.key(u.tab('inspect'), 'Home');
    expect(u.tab('status').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(u.tab('status'));
    await u.key(u.tab('status'), 'ArrowLeft');
    expect(u.tab('inspect').getAttribute('aria-selected')).toBe('true');
  });

  it('AC3 switching tabs keeps the run, and both examples still finish on their totals', async () => {
    const sample = await mount();
    const rev = sample.el.querySelector('.work-rev')!.textContent;
    const clock = holdRuntimeClock();
    try {
      await sample.click(sample.btn('▶ 실행'));
      expect(clock.queued()).toBeGreaterThan(0);
      expect(screenText(sample.el)).toContain('시뮬 실행 중');
      await sample.click(sample.tab('diagram'));
      await sample.click(sample.tab('inspect'));
      await sample.click(sample.tab('status'));
      expect(clock.queued()).toBeGreaterThan(0);
      expect(screenText(sample.el)).toContain('시뮬 실행 중');
      expect(sample.el.querySelector('.work-rev')!.textContent).toBe(rev);
      await sample.click(sample.btn('❚❚ 일시정지'));
      expect(screenText(sample.el)).toContain('시뮬 일시정지');
      await sample.click(sample.btn('+0.1s'));
      expect(screenText(sample.el)).toContain('00:00.100');
      await sample.click(sample.tab('diagram'));
      expect(sample.panel('diagram').hasAttribute('hidden')).toBe(false);
      expect(screenText(sample.el)).toContain('00:00.100');
      expect(screenText(sample.el)).toContain('시뮬 일시정지');
      await sample.click(sample.btn('재개'));
      expect(clock.queued()).toBeGreaterThan(0);
      await sample.click(sample.btn('끝까지'));
    } finally {
      clock.restore();
    }
    expect(screenText(sample.el)).toContain('00:11.100');
    expect(screenText(sample.el)).toContain('시뮬 완료');

    await act(async () => { root!.unmount(); });
    root = null;
    document.body.innerHTML = '';
    const flow = await mount({ sample: 'flow' });
    const flowClock = holdRuntimeClock();
    try {
      await flow.click(flow.btn('▶ 실행'));
      await flow.click(flow.tab('diagram'));
      expect(flowClock.queued()).toBeGreaterThan(0);
      await flow.click(flow.btn('끝까지'));
    } finally {
      flowClock.restore();
    }
    expect(screenText(flow.el)).toContain('00:13.100');
    expect(flow.panel('diagram').querySelector('.diagram-canvas')).not.toBeNull();
  });

  it('AC4 the chosen tab survives a remount and stays out of the project file', async () => {
    localStorage.setItem('ecd.v1.userView', JSON.stringify({ runTab: 'later', home: false, step: 'run' }));
    expect(loadView(localStorage).runTab).toBe('status');
    localStorage.clear();
    const u = await mount();
    expect(loadView(localStorage).runTab).toBe('status');
    expect(u.tab('status').getAttribute('aria-selected')).toBe('true');
    await u.click(u.tab('diagram'));
    const view = JSON.parse(localStorage.getItem('ecd.v1.userView')!);
    expect(view.runTab).toBe('diagram');
    await u.click(u.el.querySelector('.header button.btn-main.primary')!);
    const projectKey = Object.keys(localStorage).find((k) => k.startsWith('ecd.v1.project.'))!;
    const stored = localStorage.getItem(projectKey)!;
    expect(stored).not.toContain('runTab');
    expect(stored).not.toContain('실행 도면');
    await act(async () => { root!.unmount(); });
    root = null;
    const again = await mount({ fresh: false });
    expect(again.tab('diagram').getAttribute('aria-selected')).toBe('true');
    expect(again.panel('status').hasAttribute('hidden')).toBe(true);
    expect(loadView(localStorage).runTab).toBe('diagram');
  });

  it('AC5 a blocker notice stays above the tabs, and fault injection still lives on the inspect tab', async () => {
    const u = await mount();
    await u.click(u.tab('inspect'));
    const fault = [...u.panel('inspect').querySelectorAll('select')].find((s) => (s.textContent ?? '').includes('완료 신호 미발생')) as HTMLSelectElement;
    expect(fault).toBeTruthy();
    expect(u.panel('status').querySelector('select')).toBeNull();
    expect(u.panel('diagram').textContent).not.toContain('완료 신호 미발생');
    const opt = [...fault.options].find((o) => (o.textContent ?? '').includes('S2 바코드'))!;
    await act(async () => {
      fault.value = opt.value;
      fault.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const clock = holdRuntimeClock();
    try {
      await u.click(u.btn('▶ 실행'));
      await u.click(u.btn('끝까지'));
    } finally {
      clock.restore();
    }
    const notice = [...u.el.querySelectorAll('h2')].find((h) => h.textContent === 'Station 실행 차단')!;
    const list = u.el.querySelector('.run-tabs [role=tablist]')!;
    expect(notice.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(u.el.querySelector('.run-summary-head')!.textContent).toContain('오류로 중단');
    expect(screenText(u.el)).toContain('시뮬 오류');
    expect(screenText(u.el)).not.toMatch(STATUS_EN);
  });

  it('AC6 AC7 status words are Korean on the diagram view, and 3D has no run tabs', async () => {
    const u = await mount();
    expect(screenText(u.el)).toContain('시뮬 대기');
    expect(screenText(u.el)).toContain('실행 대기');
    expect(screenText(u.el)).not.toMatch(STATUS_EN);
    const clock = holdRuntimeClock();
    try {
      await u.click(u.btn('▶ 실행'));
      expect(screenText(u.el)).not.toMatch(STATUS_EN);
      await u.click(u.btn('❚❚ 일시정지'));
      expect(screenText(u.el)).toContain('일시정지');
      expect(screenText(u.el)).not.toMatch(STATUS_EN);
      await u.click([...u.el.querySelectorAll('.statusbar button')].find((b) => (b.textContent ?? '').startsWith('남은 항목'))!);
      expect(u.el.querySelector('.itemspop')!.textContent).toContain('시뮬 상태 일시정지');
      expect(u.el.querySelector('.itemspop')!.textContent).not.toMatch(STATUS_EN);
    } finally {
      clock.restore();
    }
    await u.click(u.btn('3D'));
    expect(u.el.querySelector('[data-run-view]')!.getAttribute('data-run-view')).toBe('3d');
    expect(u.el.querySelector('.run-tabs')).toBeNull();
    expect(u.el.querySelector('#run-tab-status')).toBeNull();
    expect(u.el.querySelector('.run-info')).not.toBeNull();
    expect(u.el.querySelector('.run-stage')).not.toBeNull();
    expect(u.el.querySelector('.run-conditions')).not.toBeNull();
    await u.click(u.btn('도면'));
    expect(u.el.querySelector('.run-tabs [role=tablist]')).not.toBeNull();
    expect(u.el.querySelector('.run-info')).toBeNull();
  });
});
