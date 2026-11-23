// @vitest-environment jsdom
// TURN-038: step badges show the remaining count, and an item jumps to the field.
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { newCandidate } from '../src/model/candidates';
import { emptyProject, makeUnit } from '../src/model/factory';
import { analyzeGaps } from '../src/model/gaps';
import { buildSampleProject } from '../src/model/sample';
import type { Project } from '../src/model/types';
import type { RuntimeState } from '../src/runtime/engine';
import { App } from '../src/ui/App';
import { jumpCaption, NO_JUMP } from '../src/ui/itemJump';
import { evaluateSteps, ITEM_KINDS, type EvalContext, type ItemKind } from '../src/ui/wizard';
import { holdRuntimeClock } from './holdRuntimeClock';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WORDS = ['필수 누락', '재확인 필요', '필수 충족', '확인됨'];

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
  const key = async (node: Element, k: string) => { await act(async () => { node.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); }); };
  const btn = (label: string) => [...el.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label) as HTMLButtonElement;
  return { el, click, key, btn };
}

function stat(el: HTMLElement) {
  const text = el.querySelector('.statusbar')!.textContent ?? '';
  return { rev: /rev (\d+)/.exec(text)![1], undo: /Undo (\d+)/.exec(text)![1] };
}

async function clearTimeoutOfFirstAction(el: HTMLElement) {
  const click = async (node: Element) => { await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
  await click(el.querySelector('.stepper [data-stepid="attributes"]')!);
  await click([...el.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Action 편집')!);
  const label = [...el.querySelectorAll('.form-grid label')].find((node) => (node.textContent ?? '').startsWith('타임아웃'))!;
  const input = label.querySelector('input.num') as HTMLInputElement;
  const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  await act(async () => {
    proto?.set?.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const live = (input.isConnected ? input : el.querySelector('.form-grid label input.num')) as HTMLInputElement;
  await act(async () => { live.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
}

const ctx = (extra: Partial<EvalContext> = {}): EvalContext => ({ gaps: extra.gaps ?? [], rt: extra.rt ?? null, saved: extra.saved ?? true, photoMissingKinds: extra.photoMissingKinds ?? [] });

describe('TURN-038 item destinations', () => {
  it('AC6 every evaluateSteps kind has a place or the no-screen words', () => {
    const bag = new Set<ItemKind>();
    const take = (p: Project, extra: Partial<EvalContext> = {}) => {
      for (const step of Object.values(evaluateSteps(p, ctx(extra)))) for (const it of step.items) {
        bag.add(it.kind);
        const cap = jumpCaption(it.jump);
        expect(cap.trim().length).toBeGreaterThan(0);
        expect(ITEM_KINDS).toContain(it.kind);
        if (it.jump) expect(cap).not.toBe(NO_JUMP);
        else expect(cap).toBe(NO_JUMP);
      }
    };
    take(emptyProject('빈'), { saved: false });
    const one = emptyProject('하나');
    const u1 = makeUnit('빈 유닛', 'S1', { x: 0, y: 0, w: 100, h: 80 }, () => 'U-1');
    one.units = [u1];
    one.equipment.unitIds = [u1.id];
    take(one);
    const two = emptyProject('둘');
    const a = makeUnit('A', 'S1', { x: 0, y: 0, w: 100, h: 80 }, () => 'U-A');
    const b = makeUnit('B', 'S2', { x: 200, y: 0, w: 100, h: 80 }, () => 'U-B');
    two.units = [a, b];
    two.equipment.unitIds = [a.id, b.id];
    take(two);
    const sample = buildSampleProject();
    take(sample, { gaps: analyzeGaps(sample), saved: false, photoMissingKinds: ['cylinder'] });
    sample.candidates.push(newCandidate('device', 'SEN-X', 'sensor', sample.units[0].id, 'direct', () => 'CAND-X'));
    const prop = sample.devices[0];
    const key = Object.keys(prop.properties)[0];
    prop.properties[key] = { ...prop.properties[key], value: null };
    const used = sample.actions.find((act) => sample.sequence.steps.some((s) => s.actionId === act.id))!;
    used.completeSignalId = null;
    used.timeout = { ...used.timeout, value: null };
    used.pre = [...used.pre, { kind: 'undefined', note: '테스트' }];
    sample.materials[0] = { ...sample.materials[0], initialLocation: null, initialState: null, route: [] };
    sample.sequence.unresolved = ['모호: 테스트'];
    take(sample, { gaps: analyzeGaps(sample), saved: false, photoMissingKinds: ['cylinder'], rt: { status: 'paused' } as RuntimeState });
    expect(jumpCaption(null)).toBe(NO_JUMP);
    expect([...ITEM_KINDS].filter((k) => !bag.has(k))).toEqual([]);
  });
});

describe('TURN-038 step badges', () => {
  it('AC1 AC2 the six badges show a status word and a count, and the bar does not scroll', async () => {
    const css = readFileSync('src/ui/styles.css', 'utf8');
    const rule = css.slice(css.lastIndexOf('/* TURN-038'));
    expect(rule).toMatch(/\.app > \.stepper \{ overflow: hidden;/);
    expect(rule).toMatch(/\.app > \.stepper \.st \.badge \{[^}]*position: static/);
    expect(rule).not.toMatch(/clip:\s*rect/);
    const u = await mount();
    await u.click(u.btn('시작하기'));
    const badges = [...u.el.querySelectorAll<HTMLButtonElement>('.stepper [data-step-badge]')];
    expect(badges).toHaveLength(6);
    for (const badge of badges) {
      expect(badge.tagName).toBe('BUTTON');
      expect(badge.getAttribute('aria-hidden')).not.toBe('true');
      const word = badge.querySelector('.st-word')!.textContent;
      expect(WORDS).toContain(word);
      expect(badge.querySelector('.st-count')!.textContent).toMatch(/^\d+$/);
      expect(badge.textContent).toContain(word);
    }
    expect(u.el.querySelector('.stepper .theme-toggle')).not.toBeNull();
  });

  it('AC3 a badge opens that step’s list and leaves the current step', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    expect(u.el.querySelector('.app')!.getAttribute('data-step')).toBe('library');
    await u.click(u.el.querySelector('[data-step-badge="attributes"]')!);
    expect(u.el.querySelector('.app')!.getAttribute('data-step')).toBe('library');
    const pop = u.el.querySelector('.itemspop')!;
    expect(pop.getAttribute('data-items-step')).toBe('attributes');
    expect(pop.textContent).toContain('3 속성·Action');
    expect(pop.textContent).toMatch(/가정값|Interlock/);
    expect([...pop.querySelectorAll('.item-go')].every((n) => (n.textContent ?? '').trim().length > 0)).toBe(true);
  });

  it('AC4 a sequence action timeout jumps to that device’s timeout field', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    await clearTimeoutOfFirstAction(u.el);
    const before = stat(u.el);
    await u.click(u.el.querySelector('.stepper [data-stepid="library"]')!);
    expect(u.el.querySelector('.app')!.getAttribute('data-step')).toBe('library');
    await u.click(u.el.querySelector('[data-step-badge="attributes"]')!);
    expect(u.el.querySelector('.app')!.getAttribute('data-step')).toBe('library');
    const item = [...u.el.querySelectorAll('.item-jump')].find((b) => (b.textContent ?? '').includes('타임아웃 미정'))!;
    expect(item.textContent).toContain('시퀀스에서 사용 중');
    await u.click(item);
    expect(u.el.querySelector('.itemspop')).toBeNull();
    expect(u.el.querySelector('.app')!.getAttribute('data-step')).toBe('attributes');
    expect(u.el.querySelector('h1')!.textContent).toContain('Action 정의');
    expect(u.el.querySelector('[data-tree-id="PSH-01"]')!.getAttribute('aria-selected')).toBe('true');
    const flash = u.el.querySelector('.jump-flash') as HTMLElement;
    expect(flash.getAttribute('data-jump')).toMatch(/^timeout:/);
    expect(flash.textContent).toContain('타임아웃');
    expect(document.activeElement).toBe(flash.querySelector('input.num'));
    expect(stat(u.el)).toEqual(before);
  });

  it('AC5 an empty project jumps to material and to the canvas', async () => {
    const u = await mount();
    await u.click(u.btn('빈 프로젝트 만들기'));
    expect(u.el.querySelector('.app')!.getAttribute('data-step')).toBe('library');
    await u.click(u.el.querySelector('[data-step-badge="sequence"]')!);
    expect(u.el.querySelector('.app')!.getAttribute('data-step')).toBe('library');
    await u.click([...u.el.querySelectorAll('.item-jump')].find((b) => b.textContent === '자재 정의 없음')!);
    expect(u.el.querySelector('.app')!.getAttribute('data-step')).toBe('sequence');
    expect([...u.el.querySelectorAll('.subtabs button.on')].some((b) => (b.textContent ?? '').includes('자재·Flow'))).toBe(true);
    expect(u.el.querySelector('[data-jump="material-add"]')!.classList.contains('jump-flash')).toBe(true);
    await u.click(u.el.querySelector('[data-step-badge="canvas"]')!);
    expect(u.el.querySelector('.app')!.getAttribute('data-step')).toBe('sequence');
    await u.click([...u.el.querySelectorAll('.item-jump')].find((b) => b.textContent === 'Unit이 없습니다')!);
    expect(u.el.querySelector('.app')!.getAttribute('data-step')).toBe('canvas');
    expect(u.el.querySelector('[data-jump="palette-unit"]')!.classList.contains('jump-flash')).toBe(true);
  });

  it('AC7 opening the list and jumping does not change rev or undo', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    const before = stat(u.el);
    await u.click(u.el.querySelector('[data-step-badge="run"]')!);
    expect(u.el.querySelector('.itemspop')).not.toBeNull();
    expect(stat(u.el)).toEqual(before);
    const item = u.el.querySelector('.item-jump') as HTMLButtonElement;
    await u.click(item);
    expect(stat(u.el)).toEqual(before);
  });

  it('AC8 Esc, an outside press, and the keyboard close and move', async () => {
    const u = await mount();
    await u.click(u.btn('빈 프로젝트 만들기'));
    const badge = u.el.querySelector('[data-step-badge="canvas"]') as HTMLButtonElement;
    badge.focus();
    expect(document.activeElement).toBe(badge);
    await u.key(badge, 'Enter');
    expect(u.el.querySelector('.itemspop')).not.toBeNull();
    expect(u.el.querySelector('.app')!.getAttribute('data-step')).toBe('library');
    const item = document.activeElement as HTMLButtonElement;
    expect(item.classList.contains('item-jump')).toBe(true);
    expect(item.textContent).toBe('Unit이 없습니다');
    await u.key(item, 'Enter');
    expect(u.el.querySelector('.itemspop')).toBeNull();
    expect(u.el.querySelector('.app')!.getAttribute('data-step')).toBe('canvas');

    await u.click(u.el.querySelector('[data-step-badge="sequence"]')!);
    expect(u.el.querySelector('.itemspop')).not.toBeNull();
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(u.el.querySelector('.itemspop')).toBeNull();

    await u.click(u.el.querySelector('[data-step-badge="sequence"]')!);
    expect(u.el.querySelector('.itemspop')).not.toBeNull();
    await act(async () => { u.el.querySelector('.header')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    expect(u.el.querySelector('.itemspop')).toBeNull();

    await u.click(u.el.querySelector('[data-items-toggle]')!);
    expect(u.el.querySelector('.itemspop')!.getAttribute('data-items-step')).toBe('canvas');
  });

  it('AC9 a running project still opens the list and jumps without moving the run', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    const clock = holdRuntimeClock();
    try {
      await u.click(u.btn('▶ 실행'));
      expect(u.el.querySelector('.statusbar')!.textContent).toContain('실행 중');
      const before = stat(u.el);
      const time = u.el.querySelector('.toolbar .mono')!.textContent;
      await u.click(u.el.querySelector('[data-step-badge="attributes"]')!);
      expect(u.el.querySelector('.app')!.getAttribute('data-step')).toBe('run');
      expect(u.el.querySelector('.itemspop')).not.toBeNull();
      const item = u.el.querySelector('.item-jump') as HTMLButtonElement;
      await u.click(item);
      expect(u.el.querySelector('.itemspop')).toBeNull();
      expect(u.el.querySelector('.statusbar')!.textContent).toContain('실행 중');
      expect(stat(u.el)).toEqual(before);
      await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
      expect(u.el.querySelector('.toolbar .mono')!.textContent).toBe(time);
      expect(u.el.querySelector('.statusbar')!.textContent).toContain('실행 중');
      expect(stat(u.el)).toEqual(before);
    } finally {
      clock.restore();
    }
  });
});
