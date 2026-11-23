// @vitest-environment jsdom
// TURN-039: one status language — word, mark, and color — across the screens that show it.
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSampleProject } from '../src/model/sample';
import { stepStatusLabel } from '../src/runtime/runSummary';
import { App } from '../src/ui/App';
import { StatusMark } from '../src/ui/StatusMark';
import {
  ITEM_LEVEL_STATUS, STATUS, STATUS_COLOR, STATUS_KEYS, STATUS_SURFACES,
  WIZARD_BADGE_STATUS, exportStatusMark, gapJudgementMark, phaseShape, stationShape, statusCssVars,
} from '../src/ui/status';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  localStorage.clear();
});

async function mount() {
  localStorage.clear();
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(<App />); });
  const click = async (node: Element) => { await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
  const btn = (label: string) => [...el.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label) as HTMLButtonElement;
  return { el, click, btn };
}

function marks(rootEl: ParentNode, status: string) {
  return [...rootEl.querySelectorAll<HTMLElement>(`[data-status="${status}"]`)];
}

describe('TURN-039 status tokens', () => {
  it('AC1 AC4 the six statuses are one table: distinct words, marks, and color variables', () => {
    expect(STATUS_KEYS).toHaveLength(6);
    expect(new Set(STATUS_KEYS.map((k) => STATUS[k].word)).size).toBe(6);
    expect(new Set(STATUS_KEYS.map((k) => STATUS[k].mark)).size).toBe(6);
    expect(new Set(STATUS_KEYS.map((k) => STATUS[k].colorVar)).size).toBe(6);
    const src = readFileSync('src/ui/status.ts', 'utf8');
    for (const key of STATUS_KEYS) {
      expect(src).toContain(STATUS[key].word);
      expect(src).toContain(STATUS[key].mark);
      expect(src).toContain(STATUS_COLOR.light[key]);
      expect(src).toContain(STATUS_COLOR.dark[key]);
    }
    const css = readFileSync('src/ui/styles.css', 'utf8');
    for (const key of STATUS_KEYS) expect(css).toContain(`.status-${key} { color: var(${STATUS[key].colorVar}); }`);
  });

  it('maps run phases and keeps 건너뜀 · 정지 · station words', () => {
    for (const phase of ['pending', 'active', 'done', 'error', 'skipped', 'stopped']) {
      expect(phaseShape(phase).word).toBe(stepStatusLabel(phase));
    }
    expect(phaseShape('pending').status).toBe('pending');
    expect(phaseShape('active').status).toBe('active');
    expect(phaseShape('done').status).toBe('done');
    expect(phaseShape('error').status).toBe('error');
    expect(phaseShape('skipped')).toEqual({ status: 'pending', word: '건너뜀' });
    expect(phaseShape('stopped')).toEqual({ status: 'assumption', word: '정지' });
    expect(stationShape('idle').word).toBe('대기');
    expect(stationShape('running')).toEqual({ status: 'active', word: '실행 중' });
    expect(stationShape('paused')).toEqual({ status: 'pending', word: '일시정지' });
    expect(stationShape('completed').word).toBe('완료');
    expect(stationShape('error').word).toBe('오류');
    expect(gapJudgementMark('undetermined').word).toBe('미정');
    expect(exportStatusMark('assumption')).toEqual({ status: 'assumption', word: '가정' });
    expect(exportStatusMark('undetermined').word).toBe('미정');
    expect(ITEM_LEVEL_STATUS.assumption.word).toBe('가정');
    expect(ITEM_LEVEL_STATUS.undetermined.word).toBe('미정');
  });

  it('AC5 status ink is 4.5:1 and the same ink as a border is 3:1 on every surface', () => {
    for (const appearance of ['light', 'dark'] as const) {
      const vars = statusCssVars(appearance);
      for (const key of STATUS_KEYS) {
        expect(vars[STATUS[key].colorVar]).toBe(STATUS_COLOR[appearance][key]);
        for (const [name, bg] of Object.entries(STATUS_SURFACES[appearance])) {
          const ink = STATUS_COLOR[appearance][key];
          expect(ratio(ink, bg), `${appearance} ${key} on ${name}`).toBeGreaterThanOrEqual(4.5);
          expect(ratio(ink, bg), `${appearance} ${key} border on ${name}`).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it('AC7 the running row keeps the light fill, 2px accent edge, and bold type', () => {
    const css = readFileSync('src/ui/styles.css', 'utf8');
    expect(css).toMatch(/\.step-row\.is-running\s*\{[^}]*background:\s*var\(--selected\)/);
    expect(css).toMatch(/\.step-row\.is-running\s*\{[^}]*border:\s*2px solid var\(--accent\)/);
    expect(css).toMatch(/\.step-row\.is-running\s*\{[^}]*font-weight:\s*700/);
  });

  it('AC2 AC3 AC6 the same status uses the same mark, word, and color variable', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const local = createRoot(host);
    await act(async () => {
      local.render(<div>
        <StatusMark status="undetermined" />
        <StatusMark status="assumption" />
        <StatusMark status="active" />
        <StatusMark status="error" />
      </div>);
    });
    const chip = (status: string) => host.querySelector<HTMLElement>(`[data-status="${status}"]`)!;
    for (const key of ['undetermined', 'assumption', 'active', 'error'] as const) {
      expect(chip(key).querySelector('.status-sym')!.textContent).toBe(STATUS[key].mark);
      expect(chip(key).querySelector('.status-word')!.textContent).toBe(STATUS[key].word);
      expect(chip(key).className).toContain(`status-${key}`);
    }
    await act(async () => { local.unmount(); });

    const u = await mount();
    await u.click(u.btn('시작하기'));
    const badges = [...u.el.querySelectorAll<HTMLElement>('.stepper [data-step-badge]')];
    expect(badges.length).toBe(6);
    for (const badge of badges) {
      const key = badge.getAttribute('data-status') as keyof typeof STATUS;
      expect(STATUS_KEYS).toContain(key);
      expect(badge.querySelector('[aria-hidden="true"]')!.textContent).toBe(STATUS[key].mark);
      expect(badge.className).toContain(`status-${key}`);
    }
    expect(WIZARD_BADGE_STATUS.ready).toBe('done');
    expect(WIZARD_BADGE_STATUS.confirmed).toBe('done');
    expect(WIZARD_BADGE_STATUS.blocked).toBe('error');
    expect(WIZARD_BADGE_STATUS.recheck).toBe('undetermined');

    const treeAssumed = marks(u.el.querySelector('.tree')!, 'assumption');
    expect(treeAssumed.length).toBeGreaterThan(0);
    expect(treeAssumed[0].className).toContain('is-compact');
    expect(treeAssumed[0].querySelector('.status-sym')!.textContent).toBe(STATUS.assumption.mark);
    expect(treeAssumed[0].getAttribute('aria-label')).toBe('가정');
    expect(treeAssumed[0].getAttribute('title')).toBe('가정');
    const bcr = u.el.querySelector('[data-tree-id="BCR-02"]')!;
    expect(bcr.textContent).toContain('바코드리더');
    const css = readFileSync('src/ui/styles.css', 'utf8');
    expect(css).toMatch(/\.tree \.status-mark\.is-compact \{[^}]*max-width:\s*22px/);

    await u.click(u.el.querySelector('[data-step-badge="attributes"]')!);
    const list = u.el.querySelector('.itemspop')!;
    const assumed = marks(list, 'assumption');
    expect(assumed.length).toBeGreaterThan(0);
    expect(assumed[0].querySelector('.status-word')!.textContent).toBe('가정');
    expect(assumed[0].querySelector('.status-sym')!.textContent).toBe(STATUS.assumption.mark);

    await u.click(u.el.querySelector('.stepper [data-stepid="sequence"]')!);
    const flow = u.el.querySelector('table[aria-label="Station 흐름"]')!;
    const waiting = marks(flow, 'pending');
    expect(waiting.length).toBeGreaterThan(0);
    expect(waiting[0].querySelector('.status-word')!.textContent).toBe('대기');
    expect(waiting[0].querySelector('.status-sym')!.textContent).toBe(STATUS.pending.mark);

    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    const steps = u.el.querySelector('.run-steps')!;
    const stepAssumed = marks(steps, 'assumption');
    expect(stepAssumed.length).toBeGreaterThan(0);
    expect(stepAssumed[0].querySelector('.status-sym')!.textContent).toBe(treeAssumed[0].querySelector('.status-sym')!.textContent);
    expect(stepAssumed[0].querySelector('.status-word')!.textContent).toBe('가정');
    expect(u.el.querySelector('[data-run-status]')!.textContent).toBe('대기');

    await u.click(u.el.querySelector('.stepper [data-stepid="attributes"]')!);
    const prop = u.el.querySelector('.prop-sheet, .sparse-page')!;
    expect(marks(prop, 'assumption').some((n) => n.querySelector('.status-word')?.textContent === '가정')).toBe(true);
    await u.click(u.el.querySelector('.stepper [data-stepid="check"]')!);
    await u.click([...u.el.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Export 미리보기'))!);
    const exported = [...u.el.querySelectorAll('[data-status]')];
    const same = (word: string, key: 'assumption' | 'undetermined') => exported.filter((n) => n.getAttribute('data-status') === key && n.querySelector('.status-word')?.textContent === word);
    expect(same('가정', 'assumption').length).toBeGreaterThan(0);
    expect(same('가정', 'assumption')[0].querySelector('.status-sym')!.textContent).toBe(STATUS.assumption.mark);
    expect(same('미정', 'undetermined').length).toBeGreaterThan(0);
    expect(same('미정', 'undetermined')[0].querySelector('.status-sym')!.textContent).toBe(STATUS.undetermined.mark);

    const css3d = readFileSync('src/ui/run3d.css', 'utf8');
    const canvasCss = readFileSync('src/ui/styles.css', 'utf8');
    expect(css3d).toMatch(/\.scene3d-label\.marker\.active \{[^}]*var\(--status-active\)/);
    expect(css3d).toMatch(/\.scene3d-label\.marker\.fault \{[^}]*var\(--status-error\)/);
    expect(canvasCss).toMatch(/\.rf-device\.is-active \{[^}]*var\(--status-active/);
    expect(canvasCss).toMatch(/\.rf-device\.is-fault \{[^}]*var\(--status-error/);
    expect(buildSampleProject().devices.length).toBeGreaterThan(0);
  });
});
