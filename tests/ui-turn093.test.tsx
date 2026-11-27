// @vitest-environment jsdom
// TURN-093. The run-readiness checklist lists every blocker and the existing warnings.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { History } from '../src/model/history';
import { buildFlowSampleProject, buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import type { Project } from '../src/model/types';
import { checkRunReadiness } from '../src/model/validate';
import { saveProject } from '../src/storage/localStore';
import { App } from '../src/ui/App';
import { readinessEntries, readinessSummary } from '../src/ui/readinessList';
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
  const key = async (node: EventTarget, init: KeyboardEventInit) => {
    await act(async () => { node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })); });
  };
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label || b.getAttribute('aria-label') === label) as HTMLButtonElement | undefined;
  return { el, click, key, btn, history: () => seen.h! };
}

function badgeCount(el: ParentNode): number {
  return Number(el.querySelector('[data-step-badge="run"] .st-count')!.textContent);
}

function kinds(el: ParentNode): string[] {
  return [...el.querySelectorAll('[data-readiness-kind]')].map((node) => node.getAttribute('data-readiness-kind') ?? '');
}

/** Drop the sample's assumed durations and unconfirmed interlocks so only the blockers we add remain. */
function quiet(p: Project) {
  for (const action of p.actions) {
    if (action.duration.value !== null) action.duration = { ...action.duration, assumption: false };
    if (action.timeout.value !== null) {
      const floor = (action.duration.value ?? 0) + 1;
      action.timeout = { ...action.timeout, value: Math.max(action.timeout.value, floor), assumption: false };
    }
  }
  for (const constraint of p.constraints) {
    if (constraint.kind === 'interlock-candidate') constraint.confirmation = 'confirmed';
  }
}

function clearTimeouts(p: Project, count: number) {
  for (const step of p.sequence.steps.slice(0, count)) {
    const action = p.actions.find((a) => a.id === step.actionId)!;
    action.timeout = { ...action.timeout, value: null };
  }
}

describe('TURN-093 readiness checklist', () => {
  it('AC1 three blockers are three rows and the summary is 차단 3', async () => {
    const p = buildSampleProject();
    quiet(p);
    clearTimeouts(p, 3);
    const entries = readinessEntries(p);
    expect(entries.filter((entry) => entry.kind === 'block')).toHaveLength(3);
    expect(readinessSummary(entries)).toBe('차단 3');
    expect(saveProject(localStorage, p).ok).toBe(true);
    const u = await mount(true);
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    expect(u.el.querySelector('[data-readiness-summary]')!.textContent).toBe('차단 3');
    expect(u.el.querySelectorAll('.blocker-item')).toHaveLength(3);
    expect(kinds(u.el).filter((kind) => kind === 'warn')).toHaveLength(0);
    expect(badgeCount(u.el)).toBe(3);
  });

  it('AC2 warnings sit under blockers, and warnings alone still allow 실행', async () => {
    const mixed = buildSampleProject();
    clearTimeouts(mixed, 1);
    const mixedEntries = readinessEntries(mixed);
    const order = mixedEntries.map((entry) => entry.kind);
    expect(order.includes('block')).toBe(true);
    expect(order.includes('warn')).toBe(true);
    expect(order.lastIndexOf('block')).toBeLessThan(order.indexOf('warn'));
    expect(readinessSummary(mixedEntries)).toMatch(/^차단 1 · 경고 \d+$/);

    const ready = buildSampleProject();
    expect(checkRunReadiness(ready).ok).toBe(true);
    expect(readinessEntries(ready).some((entry) => entry.kind === 'warn')).toBe(true);
    expect(saveProject(localStorage, ready).ok).toBe(true);
    const u = await mount(true);
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    expect(u.el.querySelector('.blocker-item')).toBeNull();
    expect(u.el.querySelector('[data-readiness-kind="warn"]')).not.toBeNull();
    expect(u.btn('▶ 실행')!.disabled).toBe(false);
    expect(badgeCount(u.el)).toBe(0);
  });

  it('AC3 이동 opens the same timeout field the blocker guide uses', async () => {
    const p = buildSampleProject();
    quiet(p);
    const step = p.sequence.steps[0];
    const action = p.actions.find((a) => a.id === step.actionId)!;
    action.timeout = { ...action.timeout, value: null };
    expect(saveProject(localStorage, p).ok).toBe(true);
    const u = await mount(true);
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    const item = u.el.querySelector('.blocker-item')!;
    const go = item.querySelector('button[data-readiness-jump]') as HTMLButtonElement;
    expect(go.textContent).toContain('이동');
    await u.click(go);
    expect(u.el.querySelector('.app')!.getAttribute('data-step')).toBe('attributes');
    const field = u.el.querySelector(`[data-jump="timeout:${action.id}"]`) as HTMLElement;
    expect(field.classList.contains('jump-flash')).toBe(true);
  });

  it('AC4 a row opens the three lines, and Enter and Escape do the same', async () => {
    const p = buildSampleProject();
    quiet(p);
    clearTimeouts(p, 1);
    expect(saveProject(localStorage, p).ok).toBe(true);
    const u = await mount(true);
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    const row = u.el.querySelector('.readiness-row') as HTMLElement;
    const detail = () => row.querySelector('[data-readiness-detail]') as HTMLElement;
    expect(detail().hidden).toBe(true);
    await u.click(row);
    expect(detail().hidden).toBe(false);
    expect(detail().querySelector('[data-problem-what]')!.textContent).toContain(p.sequence.steps[0].name);
    expect(detail().querySelector('[data-problem-why]')!.textContent).toContain('타임아웃 미정');
    expect(detail().querySelector('[data-problem-how]')!.textContent!.length).toBeGreaterThan(0);
    row.focus();
    await u.key(row, { key: 'Escape' });
    expect(detail().hidden).toBe(true);
    await u.key(row, { key: 'Enter' });
    expect(detail().hidden).toBe(false);
    expect(row.getAttribute('aria-expanded')).toBe('true');
  });

  it('AC5 fixing one blocker shrinks the table and the step badge together', async () => {
    const p = buildSampleProject();
    clearTimeouts(p, 2);
    const before = checkRunReadiness(p).blockers.length;
    expect(before).toBeGreaterThanOrEqual(2);
    expect(saveProject(localStorage, p).ok).toBe(true);
    const u = await mount(true);
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    expect(u.el.querySelectorAll('.blocker-item')).toHaveLength(before);
    expect(badgeCount(u.el)).toBe(before);
    const step = p.sequence.steps[0];
    const field = u.el.querySelector(`[aria-label="${step.name} 타임아웃 숫자"]`) as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(field, '5');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const left = checkRunReadiness(u.history().present).blockers.length;
    expect(left).toBe(before - 1);
    expect(u.el.querySelectorAll('.blocker-item')).toHaveLength(left);
    expect(badgeCount(u.el)).toBe(left);
    expect(u.el.querySelector('[data-readiness-summary]')!.textContent).toContain(`차단 ${left}`);
  });

  it('AC6 an empty checklist says 실행 가능, and the three samples keep the same gate', () => {
    for (const build of [buildSampleProject, buildParallelSampleProject, buildFlowSampleProject]) {
      expect(checkRunReadiness(build()).ok).toBe(true);
    }
    const p = buildSampleProject();
    quiet(p);
    expect(readinessEntries(p)).toHaveLength(0);
    expect(readinessSummary(readinessEntries(p))).toBe('');
  });

  it('AC6 the quiet model shows only 실행 가능', async () => {
    const p = buildSampleProject();
    quiet(p);
    expect(saveProject(localStorage, p).ok).toBe(true);
    const u = await mount(true);
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    expect(u.el.querySelector('[data-readiness="ok"]')!.textContent).toBe('실행 가능');
    expect(u.el.querySelector('[data-readiness-summary]')).toBeNull();
    expect(u.el.querySelector('[data-readiness-kind]')).toBeNull();
    expect(u.btn('▶ 실행')!.disabled).toBe(false);
  });

  it('running folds the checklist, and the folded strip shows the blocker count', async () => {
    const p = buildSampleProject();
    clearTimeouts(p, 2);
    const count = checkRunReadiness(p).blockers.length;
    expect(saveProject(localStorage, p).ok).toBe(true);
    const blocked = await mount(true);
    await blocked.click(blocked.el.querySelector('.stepper [data-stepid="run"]')!);
    await blocked.click(blocked.el.querySelector('[aria-label="가동 조건 접기"]')!);
    const strip = blocked.el.querySelector('[data-strip-blockers]') as HTMLElement;
    expect(strip.hidden).toBe(false);
    expect(strip.textContent).toBe(String(count));
    expect(blocked.el.querySelector('[data-readiness-summary]')).toBeNull();
    await blocked.click(blocked.el.querySelector('[aria-label="가동 조건 펼치기"]')!);
    expect(blocked.el.querySelector('[data-readiness-summary]')!.textContent).toContain(`차단 ${count}`);
    await act(async () => { root!.unmount(); });
    root = null;
    document.body.innerHTML = '';

    const ready = buildSampleProject();
    expect(saveProject(localStorage, ready).ok).toBe(true);
    const u = await mount(true);
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    const clock = holdRuntimeClock();
    try {
      await u.click(u.btn('▶ 실행')!);
      expect(u.el.querySelector('[data-readiness-folded]')!.getAttribute('data-readiness-folded')).toBe('1');
      expect((u.el.querySelector('[data-readiness-summary]')!.parentElement!.querySelector('div') as HTMLElement).hidden).toBe(true);
    } finally { clock.restore(); }
  });
});
