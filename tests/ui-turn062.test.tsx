// @vitest-environment jsdom
// TURN-062. Wait-timeout copy, help manual line, tour finish button, next blocker.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { conditionFormula } from '../src/model/conditionFormula';
import type { History } from '../src/model/history';
import { buildSampleProject } from '../src/model/sample';
import type { Project } from '../src/model/types';
import { saveProject } from '../src/storage/localStore';
import { App } from '../src/ui/App';
import { HELP_TOPICS, helpTopic, manualLine } from '../src/ui/helpCopy';
import { TOUR_BUTTON, TOUR_STEPS } from '../src/ui/tour';
import { checkRunReadiness } from '../src/model/validate';
import { holdRuntimeClock } from './holdRuntimeClock';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  localStorage.clear();
});

async function mount(keepStorage = false) {
  if (!keepStorage) localStorage.clear();
  const el = document.createElement('div');
  document.body.appendChild(el);
  const seen: { h: History | null } = { h: null };
  root = createRoot(el);
  await act(async () => { root!.render(<App onHistory={(h) => { seen.h = h; }} />); });
  const click = async (node: Element | undefined) => {
    if (!node) throw new Error('missing control');
    await act(async () => { (node as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  };
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label) as HTMLButtonElement | undefined;
  return { el, click, btn, history: () => seen.h! };
}

function lines(rootNode: ParentNode) {
  const box = rootNode.querySelector('[data-problem]') as HTMLElement;
  return {
    box,
    what: box?.querySelector('[data-problem-what]')?.textContent ?? '',
    why: box?.querySelector('[data-problem-why]')?.textContent ?? '',
    how: box?.querySelector('[data-problem-how]')?.textContent ?? '',
  };
}

function waitProject(): Project {
  const p = buildSampleProject();
  const sig = p.signals.find((s) => s.role === 'result')!;
  p.sequence.flow = [{
    kind: 'wait', id: 'FLW-WAIT', name: '도착 기다림',
    cond: { kind: 'signal', signalId: sig.id, equals: true },
    timeout: { value: 0.2, unit: 's', assumption: true },
  }];
  return p;
}

describe('TURN-062 wait timeout copy', () => {
  it('AC1 a WAIT_TIMEOUT stop is three lines on the run screen and in 자세히, and 이동 opens that flow row', async () => {
    const p = waitProject();
    const node = p.sequence.flow![0];
    if (node.kind !== 'wait') throw new Error('expected a wait');
    const formula = conditionFormula(p, node.cond);
    expect(checkRunReadiness(p).ok).toBe(true);
    expect(saveProject(localStorage, p).ok).toBe(true);
    const clock = holdRuntimeClock();
    try {
      const u = await mount(true);
      await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
      const run = u.btn('▶ 실행')!;
      expect(run.disabled).toBe(false);
      await u.click(run);
      const end = u.btn('끝까지')!;
      expect(end.disabled).toBe(false);
      await u.click(end);
      const panel = u.el.querySelector('[data-run-error="WAIT_TIMEOUT"]') as HTMLElement;
      expect(panel).toBeTruthy();
      const row = lines(panel);
      expect(row.what).toContain('도착 기다림');
      expect(row.what).toContain('시간 초과');
      expect(row.why).toContain(formula);
      expect(row.why).toContain('기다린 0.200s');
      expect(row.how).toContain('조건을 바꾸는 단계');
      expect(row.how).toContain('타임아웃');
      expect(panel.querySelector('button')!.textContent).toBe('이동');
      await u.click(u.btn('자세히')!);
      const detail = lines(u.el.querySelector('.run-details')!);
      expect(detail.what).toBe(row.what);
      expect(detail.why).toBe(row.why);
      expect(detail.how).toContain('타임아웃');
      expect(u.el.querySelector('.run-details [data-problem] button')!.textContent).toBe('이동');
      await u.click(panel.querySelector('button')!);
      expect(u.el.querySelector('.app')!.getAttribute('data-step')).toBe('sequence');
      const flashed = u.el.querySelector('tr[data-jump="flow:FLW-WAIT"]');
      expect(flashed?.classList.contains('jump-flash')).toBe(true);
    } finally { clock.restore(); }
  });

  it('AC1 a missing wait timeout is the same three-line shape', async () => {
    const p = waitProject();
    const node = p.sequence.flow![0];
    if (node.kind === 'wait') node.timeout = { ...node.timeout, value: null };
    expect(saveProject(localStorage, p).ok).toBe(true);
    const u = await mount(true);
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    const item = u.el.querySelector('.blocker-item')!;
    expect(item.textContent).toContain('[WAIT_TIMEOUT_UNDEFINED]');
    const row = lines(item);
    expect(row.what).toContain('도착 기다림');
    expect(row.why).toContain('타임아웃 미정');
    expect(row.how).toContain('타임아웃');
    expect(row.how).toContain('Station 시퀀스');
    expect(item.querySelector('button')!.textContent).toContain('이동');
  });
});

describe('TURN-062 help manual line', () => {
  it('AC2 the dock shows the section and title without feature ids, and the stored heading still matches', () => {
    for (const topic of HELP_TOPICS) {
      const line = manualLine(topic.manual);
      expect(line, topic.id).not.toContain('`');
      expect(line, topic.id).not.toMatch(/FL-\d+/);
      expect(line.startsWith(`매뉴얼 ${topic.manual.section} `), topic.id).toBe(true);
    }
    expect(manualLine(helpTopic('canvas:diagram').manual)).toBe('매뉴얼 6.2 도면 도식');
    expect(helpTopic('canvas:diagram').manual.title).toContain('FL-32');
  });

  it('AC2 the open help dock hides backticks and feature ids', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기')!);
    await u.click(u.el.querySelector('[data-stepid="canvas"] .st-go')!);
    await u.click(u.el.querySelector('[data-tab-id="diagram"]')!);
    await u.click(u.el.querySelector('[data-help-toggle]')!);
    const line = u.el.querySelector('.help-manual')!;
    expect(line.textContent).toBe('매뉴얼 6.2 도면 도식');
    expect(line.textContent).not.toContain('`');
    expect(line.textContent).not.toMatch(/FL-/);
  });
});

describe('TURN-062 tour finish', () => {
  it('AC3 the last step says 끝내기 and closes the tour; earlier steps stay 다음', async () => {
    const u = await mount();
    await u.click(u.btn(TOUR_BUTTON)!);
    for (let i = 0; i < TOUR_STEPS.length - 1; i++) {
      const bubble = u.el.querySelector('.tour-pop')!;
      expect(bubble.getAttribute('data-tour-step')).toBe(TOUR_STEPS[i].id);
      expect(u.btn('다음', bubble)).toBeTruthy();
      expect(u.btn('끝내기', bubble)).toBeUndefined();
      await u.click(u.btn('다음', bubble)!);
    }
    const last = u.el.querySelector('.tour-pop')!;
    expect(last.getAttribute('data-tour-step')).toBe('finish');
    expect(u.btn('다음', last)).toBeUndefined();
    expect(u.btn('이전', last)).toBeTruthy();
    expect(u.btn('건너뛰기', last)).toBeTruthy();
    await u.click(u.btn('끝내기', last)!);
    expect(u.el.querySelector('.tour-pop')).toBeNull();
  });
});

describe('TURN-062 next blocker', () => {
  it('AC4 two or more blockers show the count, and returning highlights the first one left', async () => {
    const p = buildSampleProject();
    const steps = p.sequence.steps.slice(0, 3);
    for (const step of steps) {
      const action = p.actions.find((a) => a.id === step.actionId)!;
      action.timeout = { ...action.timeout, value: null };
    }
    const before = checkRunReadiness(p);
    expect(before.blockers.filter((b) => b.code === 'TIMEOUT_UNDEFINED')).toHaveLength(3);
    expect(saveProject(localStorage, p).ok).toBe(true);
    const u = await mount(true);
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    const count = u.el.querySelector('[data-blocker-remain]')!;
    expect(count.textContent).toBe(`남은 차단 ${before.blockers.length}개`);
    expect(u.el.querySelector('[data-next-blocker]')).toBeNull();
    const first = u.el.querySelector('.blocker-item button') as HTMLButtonElement;
    await u.click(first);
    expect(u.el.querySelector('.app')!.getAttribute('data-step')).toBe('attributes');
    const host = u.el.querySelector(`[data-jump="timeout:${steps[0].actionId}"]`) as HTMLElement;
    const field = host?.querySelector('input');
    if (!(field instanceof HTMLInputElement)) throw new Error('timeout field missing');
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(field, '2');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { field.blur(); });
    const left = checkRunReadiness(u.history().present);
    expect(left.blockers.some((b) => b.objectId === steps[0].id)).toBe(false);
    expect(left.blockers.length).toBe(before.blockers.length - 1);
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    const again = u.el.querySelector('[data-blocker-remain]')!;
    expect(again.textContent).toBe(`남은 차단 ${left.blockers.length}개`);
    const marked = u.el.querySelector('[data-next-blocker]')!;
    expect(marked).toBe(u.el.querySelector('.blocker-item'));
    expect(marked.textContent).toContain(steps[1].name);
    expect(marked.textContent).not.toContain(`[${'WAIT'}_TIMEOUT]`);
    expect([...u.el.querySelectorAll('.blocker-item')].map((li) => li.querySelector('.mono')!.textContent)).toEqual(left.blockers.map((b) => `[${b.code}]`));
  });
});
