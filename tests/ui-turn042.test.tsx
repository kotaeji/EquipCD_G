// @vitest-environment jsdom
// TURN-042: first-run tour. jsdom has no layout, so bubble geometry is tested on placeTourBubble.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { emptyProject } from '../src/model/factory';
import { saveProject, VIEW_KEY } from '../src/storage/localStore';
import { App } from '../src/ui/App';
import { placeTourBubble, TOUR_AGAIN, TOUR_BUTTON, TOUR_STEPS, type Box } from '../src/ui/tour';
import { loadView } from '../src/ui/viewSettings';
import { holdRuntimeClock } from './holdRuntimeClock';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  localStorage.clear();
});

async function mount(fresh = true) {
  if (fresh) localStorage.clear();
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(<App />); });
  const click = async (node: Element) => { await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
  const key = async (node: Element | Window, k: string) => {
    await act(async () => { node.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });
  };
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label) as HTMLButtonElement;
  return { el, click, key, btn };
}

const stat = (el: HTMLElement) => {
  const text = el.querySelector('.statusbar')!.textContent ?? '';
  return { rev: /rev (\d+)/.exec(text)![1], undo: /Undo (\d+)/.exec(text)![1] };
};
const pop = (el: HTMLElement) => el.querySelector('.tour-pop') as HTMLElement | null;
const stepOf = (el: HTMLElement) => el.querySelector('.app')!.getAttribute('data-step');

describe('TURN-042 tour placement', () => {
  it('AC8 a 1280×800 bubble stays inside the viewport and does not cover its anchor', () => {
    const viewport = { w: 1280, h: 800 };
    const bubble = { w: 320, h: 220 };
    const anchors: { name: string; box: Box }[] = [
      { name: 'library', box: { x: 248, y: 196, w: 160, h: 32 } },
      { name: 'canvas', box: { x: 248, y: 196, w: 120, h: 32 } },
      { name: 'attributes', box: { x: 248, y: 196, w: 140, h: 32 } },
      { name: 'sequence', box: { x: 248, y: 188, w: 180, h: 32 } },
      { name: 'check', box: { x: 248, y: 188, w: 120, h: 32 } },
      { name: 'run', box: { x: 248, y: 236, w: 88, h: 32 } },
      { name: 'stepbar', box: { x: 0, y: 108, w: 1280, h: 72 } },
      { name: 'bottom-right', box: { x: 1100, y: 700, w: 140, h: 40 } },
      { name: 'top-right', box: { x: 1000, y: 8, w: 200, h: 44 } },
    ];
    for (const anchor of anchors) {
      const pos = placeTourBubble(anchor.box, bubble, viewport);
      const placed = { x: pos.left, y: pos.top, w: bubble.w, h: bubble.h };
      expect(placed.x, anchor.name).toBeGreaterThanOrEqual(8);
      expect(placed.y, anchor.name).toBeGreaterThanOrEqual(8);
      expect(placed.x + placed.w, anchor.name).toBeLessThanOrEqual(viewport.w - 8);
      expect(placed.y + placed.h, anchor.name).toBeLessThanOrEqual(viewport.h - 8);
      const overlaps = placed.x < anchor.box.x + anchor.box.w && placed.x + placed.w > anchor.box.x
        && placed.y < anchor.box.y + anchor.box.h && placed.y + placed.h > anchor.box.y;
      expect(overlaps, anchor.name).toBe(false);
    }
  });
});

describe('TURN-042 first-run tour', () => {
  it('remembers tourSeen only in the view settings', () => {
    expect(loadView(localStorage).tourSeen).toBe(false);
    localStorage.setItem(VIEW_KEY, JSON.stringify({ theme: 'B', home: false }));
    expect(loadView(localStorage).tourSeen).toBe(false);
    localStorage.setItem(VIEW_KEY, JSON.stringify({ tourSeen: true, home: false, step: 'run' }));
    const view = loadView(localStorage);
    expect(view.tourSeen).toBe(true);
    expect(view.home).toBe(false);
    expect(view.step).toBe('run');
  });

  it('AC1 a browser with no record shows the tour as the primary button, and blank project stays', async () => {
    const u = await mount();
    const tour = u.el.querySelector('[data-tour-offer="primary"]') as HTMLButtonElement;
    const blank = u.btn('빈 프로젝트 만들기');
    expect(tour.textContent).toBe(TOUR_BUTTON);
    expect(tour.classList.contains('primary')).toBe(true);
    expect(blank).toBeTruthy();
    expect(u.el.querySelector('.home-main')).not.toBeNull();
    expect(tour.compareDocumentPosition(blank) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(pop(u.el)).toBeNull();
  });

  it('AC2 AC3 AC4 opening the tour shows the 5공정 example and walks steps 1–6', async () => {
    const u = await mount();
    const before = stat(u.el);
    await u.click(u.btn(TOUR_BUTTON));
    expect(u.el.querySelector('.workbar')!.textContent).toContain('조립 라인 01 (5공정 예제)');
    expect(u.el.querySelector('.workbar')!.textContent).not.toContain('사본');
    const screens = ['library', 'canvas', 'attributes', 'sequence', 'check', 'run'];
    expect(TOUR_STEPS.length).toBeLessThanOrEqual(7);
    expect(TOUR_STEPS.length).toBe(7);
    for (let i = 0; i < screens.length; i++) {
      const bubble = pop(u.el)!;
      expect(stepOf(u.el)).toBe(screens[i]);
      expect(bubble.getAttribute('data-tour-step')).toBe(TOUR_STEPS[i].id);
      expect(bubble.textContent).toContain(`${i + 1} / ${TOUR_STEPS.length}`);
      expect(bubble.textContent).toContain(TOUR_STEPS[i].body.slice(0, 12));
      for (const label of ['이전', '다음', '건너뛰기']) expect(u.btn(label, bubble)).toBeTruthy();
      expect(u.btn('이전', bubble).disabled).toBe(i === 0);
      const anchor = u.el.querySelector(TOUR_STEPS[i].anchor);
      expect(anchor, TOUR_STEPS[i].id).not.toBeNull();
      expect(anchor!.classList.contains('tour-target')).toBe(true);
      await u.click(u.btn('다음', bubble));
    }
    const last = pop(u.el)!;
    expect(stepOf(u.el)).toBe('run');
    expect(last.getAttribute('data-tour-step')).toBe('finish');
    expect(last.textContent).toContain(`7 / ${TOUR_STEPS.length}`);
    expect(u.el.querySelector('[data-tour="stepbar"]')!.classList.contains('tour-target')).toBe(true);
    expect(last.textContent).toContain('필수 충족');
    expect(last.textContent).toContain('저장');
    expect(last.textContent).toContain('빈 프로젝트 만들기');
    expect(stat(u.el)).toEqual(before);
  });

  it('AC6 the run step can be started while the bubble is open', async () => {
    const clock = holdRuntimeClock();
    try {
      const u = await mount();
      await u.click(u.btn(TOUR_BUTTON));
      for (let i = 0; i < 5; i++) await u.click(u.btn('다음', pop(u.el)!));
      expect(pop(u.el)!.getAttribute('data-tour-step')).toBe('run');
      const run = u.el.querySelector('[data-tour="run"]') as HTMLButtonElement;
      expect(run.disabled).toBe(false);
      expect(u.el.querySelector('.modal-bg')).toBeNull();
      const before = stat(u.el);
      await u.click(run);
      expect(pop(u.el)).not.toBeNull();
      expect(u.el.querySelector('.statusbar')!.textContent).toContain('실행 중');
      expect(stat(u.el)).toEqual(before);
    } finally { clock.restore(); }
  });

  it('AC7 walking the whole tour leaves rev and undo unchanged', async () => {
    const u = await mount();
    const before = stat(u.el);
    await u.click(u.btn(TOUR_BUTTON));
    for (let i = 0; i < TOUR_STEPS.length; i++) await u.click(u.btn('다음', pop(u.el)!));
    expect(pop(u.el)).toBeNull();
    expect(stat(u.el)).toEqual(before);
    expect(u.el.querySelector('.workbar')!.textContent).toContain('조립 라인 01 (5공정 예제)');
    expect(JSON.parse(localStorage.getItem(VIEW_KEY)!).tourSeen).toBe(true);
    expect(Object.keys(localStorage).filter((k) => k.startsWith('ecd.v1.project.')).every((k) => !localStorage.getItem(k)!.includes('tourSeen'))).toBe(true);
  });

  it('AC5 skip, Esc, and finishing do not bring the tour back, and 다시 보기 does', async () => {
    for (const how of ['skip', 'esc', 'done'] as const) {
      if (root) await act(async () => { root!.unmount(); });
      root = null;
      document.body.innerHTML = '';
      localStorage.clear();
      const u = await mount();
      await u.click(u.btn(TOUR_BUTTON));
      if (how === 'skip') await u.click(u.btn('건너뛰기', pop(u.el)!));
      else if (how === 'esc') await u.key(window, 'Escape');
      else for (let i = 0; i < TOUR_STEPS.length; i++) await u.click(u.btn('다음', pop(u.el)!));
      expect(pop(u.el)).toBeNull();
      expect(JSON.parse(localStorage.getItem(VIEW_KEY)!).tourSeen).toBe(true);

      await act(async () => { root!.unmount(); });
      root = null;
      document.body.innerHTML = '';
      const again = await mount(false);
      expect(pop(again.el)).toBeNull();
      await again.click([...again.el.querySelectorAll('.explorer [role="tab"]')].find((b) => b.textContent === 'Workspace')!);
      await again.click(again.btn('작업 시작 화면'));
      const restart = again.el.querySelector('[data-tour-start]') as HTMLButtonElement;
      expect(restart.textContent).toBe(TOUR_AGAIN);
      expect(restart.getAttribute('data-tour-offer')).toBe('again');
      expect(restart.classList.contains('primary')).toBe(false);
      await again.click(restart);
      expect(pop(again.el)!.getAttribute('data-tour-step')).toBe('library');
      await again.click(again.btn('보기 설정'));
      expect(again.el.querySelector('.modal')!.textContent).toContain(TOUR_AGAIN);
    }
  });

  it('AC9 keyboard moves the tour and returns focus', async () => {
    const u = await mount();
    const opener = u.btn(TOUR_BUTTON);
    opener.focus();
    await u.click(opener);
    const bubble = pop(u.el)!;
    expect(bubble.contains(document.activeElement)).toBe(true);
    await u.key(bubble, 'ArrowRight');
    expect(pop(u.el)!.getAttribute('data-tour-step')).toBe('canvas');
    expect(stepOf(u.el)).toBe('canvas');
    await u.key(pop(u.el)!, 'ArrowLeft');
    expect(pop(u.el)!.getAttribute('data-tour-step')).toBe('library');
    await u.key(window, 'Escape');
    expect(pop(u.el)).toBeNull();
    expect(document.activeElement).toBe(u.el.querySelector('.stepper .st.on .st-go'));

    await u.click(u.btn('보기 설정'));
    const header = [...u.el.querySelectorAll<HTMLButtonElement>('.header button')].find((b) => (b.textContent ?? '').trim() === '보기 설정')!;
    await u.click(u.btn(TOUR_AGAIN, u.el.querySelector('.modal')!));
    expect(pop(u.el)!.contains(document.activeElement)).toBe(true);
    await u.key(window, 'Escape');
    expect(pop(u.el)).toBeNull();
    expect(document.activeElement).toBe(header);
  });

  it('AC10 a browser that already has a saved project does not open the tour by itself', async () => {
    expect(saveProject(localStorage, emptyProject('저장된 라인', (prefix) => `${prefix}-saved`)).ok).toBe(true);
    const u = await mount(false);
    expect(pop(u.el)).toBeNull();
    expect(u.el.querySelector('[data-tour-offer="primary"]')).toBeNull();
    expect(u.el.textContent).toContain('저장된 라인');
    const quiet = u.el.querySelector('[data-tour-start]') as HTMLButtonElement;
    expect(quiet.textContent).toBe(TOUR_BUTTON);
    expect(quiet.classList.contains('primary')).toBe(false);

    await act(async () => { root!.unmount(); });
    root = null;
    document.body.innerHTML = '';
    localStorage.setItem(VIEW_KEY, JSON.stringify({ home: false, step: 'canvas', tourSeen: false }));
    const back = await mount(false);
    expect(pop(back.el)).toBeNull();
    expect(stepOf(back.el)).toBe('canvas');
    expect(back.el.querySelector('.home-main')).toBeNull();
  });
});
