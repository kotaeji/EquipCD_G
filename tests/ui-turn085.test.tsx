// @vitest-environment jsdom
// TURN-085: width tiers, per-tier layout memory, and reset.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { History } from '../src/model/history';
import { VIEW_KEY } from '../src/storage/localStore';
import { App } from '../src/ui/App';
import {
  columnWidths, defaultLayout, resetLayout, restoreLayout, settledLayoutWidth, viewportTooNarrow,
  widthTier, workColumnWidth,
} from '../src/ui/layoutTier';
import { loadView, saveView, WIDE_CANVAS_MAX, type UserView } from '../src/ui/viewSettings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const widthDesc = Object.getOwnPropertyDescriptor(window, 'innerWidth');
const heightDesc = Object.getOwnPropertyDescriptor(window, 'innerHeight');
const clientDesc = Object.getOwnPropertyDescriptor(document.documentElement, 'clientWidth');

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  localStorage.clear();
  if (widthDesc) Object.defineProperty(window, 'innerWidth', widthDesc);
  if (heightDesc) Object.defineProperty(window, 'innerHeight', heightDesc);
  if (clientDesc) Object.defineProperty(document.documentElement, 'clientWidth', clientDesc);
  else delete (document.documentElement as unknown as { clientWidth?: number }).clientWidth;
});

function setViewport(width: number, height = 800) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: height });
}

async function mount(width?: number) {
  if (width) setViewport(width);
  const el = document.createElement('div');
  document.body.appendChild(el);
  const seen: { h: History | null } = { h: null };
  root = createRoot(el);
  await act(async () => { root!.render(<App onHistory={(h) => { seen.h = h; }} />); });
  const click = async (node: Element | null) => {
    if (!node) throw new Error('missing button');
    await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  };
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim() === label || b.getAttribute('aria-label') === label) as HTMLButtonElement | undefined;
  return { el, click, btn, history: () => seen.h! };
}

async function resize(width: number, height = 800) {
  setViewport(width, height);
  await act(async () => { window.dispatchEvent(new Event('resize')); });
}

const app = (el: ParentNode) => el.querySelector('.app') as HTMLElement;

describe('TURN-085 tiers', () => {
  it('AC1 AC3 splits 1024, 1280, 1440, and 1920, and the wide center is wider', () => {
    expect(settledLayoutWidth(1024, 0)).toBe(1280);
    expect(widthTier(1024)).toBe('narrow');
    expect(widthTier(1279)).toBe('narrow');
    expect(widthTier(1280)).toBe('normal');
    expect(widthTier(1440)).toBe('normal');
    expect(widthTier(1599)).toBe('normal');
    expect(widthTier(1600)).toBe('wide');
    expect(widthTier(1920)).toBe('wide');
    expect(viewportTooNarrow(1023)).toBe(true);
    expect(viewportTooNarrow(1024)).toBe(false);
    const sizes = [1024, 1280, 1440, 1920];
    for (const size of sizes) {
      const tier = widthTier(size);
      const slice = defaultLayout(tier);
      expect(workColumnWidth(size, tier, slice, 'canvas'), `canvas ${size}`).toBeGreaterThan(200);
      expect(workColumnWidth(size, tier, slice, 'run'), `run ${size}`).toBeGreaterThan(200);
      const cols = columnWidths(tier, slice);
      expect(cols.explorer + cols.props).toBeLessThan(size);
      expect(cols.explorer + cols.steps + cols.cond).toBeLessThan(size);
    }
    const normal = defaultLayout('normal');
    const wide = defaultLayout('wide');
    expect(workColumnWidth(1920, 'wide', wide, 'canvas')).toBeGreaterThan(workColumnWidth(1280, 'normal', normal, 'canvas'));
    expect(workColumnWidth(1920, 'wide', wide, 'run')).toBeGreaterThan(workColumnWidth(1280, 'normal', normal, 'run'));
    expect(columnWidths('wide', wide).props).toBe(256);
    expect(WIDE_CANVAS_MAX).toBeGreaterThan(560);
  });

  it('AC2 narrow starts with the explorer, property column, and run conditions folded', () => {
    const narrow = defaultLayout('narrow');
    expect(narrow.explorerOpen).toBe(false);
    expect(narrow.propsFolded).toBe(true);
    expect(narrow.condFolded).toBe(true);
    expect(narrow.stepsFolded).toBe(false);
    expect(columnWidths('narrow', narrow)).toMatchObject({ explorer: 40, props: 40, cond: 40 });
    expect(defaultLayout('normal').explorerOpen).toBe(true);
    expect(defaultLayout('normal').propsFolded).toBe(false);
    expect(defaultLayout('wide').condFolded).toBe(false);
  });

  it('AC4 keeps an older saved width on the normal tier only', () => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({
      theme: 'B',
      panels: { explorer: 300, library: 280, canvas: 400, run: 360 },
      explorerOpen: false,
      runStripFolded: true,
      runDetailsOpen: true,
    }));
    const v = loadView(localStorage);
    expect(v.theme).toBe('B');
    expect(v.panels.explorer).toBe(300);
    expect(v.explorerOpen).toBe(false);
    expect(v.layoutByTier.normal.panels).toEqual(v.panels);
    expect(v.layoutByTier.normal.explorerOpen).toBe(false);
    expect(v.layoutByTier.normal.runStripFolded).toBe(true);
    expect(v.layoutByTier.normal.runDetailsOpen).toBe(true);
    expect(v.layoutByTier.narrow.explorerOpen).toBe(false);
    expect(v.layoutByTier.narrow.propsFolded).toBe(true);
    expect(v.layoutByTier.narrow.panels.explorer).toBe(224);
    expect(v.layoutByTier.wide.explorerOpen).toBe(true);
    expect(v.layoutByTier.wide.panels.canvas).toBe(256);
    const changed = {
      ...v,
      layoutByTier: {
        ...v.layoutByTier,
        narrow: { ...v.layoutByTier.narrow, panels: { ...v.layoutByTier.narrow.panels, explorer: 200 }, explorerOpen: true },
      },
    };
    saveView(localStorage, changed);
    const again = loadView(localStorage);
    expect(again.layoutByTier.narrow.panels.explorer).toBe(200);
    expect(again.layoutByTier.narrow.explorerOpen).toBe(true);
    expect(again.layoutByTier.normal.panels.explorer).toBe(300);
    expect(again.panels.explorer).toBe(300);
  });

  it('AC5 resets layout only, and one restore puts it back', () => {
    const v = loadView(null);
    const custom: UserView = {
      ...v,
      theme: 'B',
      termHints: false,
      confirmerName: '매튜',
      visualMode: 'photo',
      paletteOpen: false,
      helpSide: 'left',
      helpFolded: true,
      helpOpen: true,
      minimap: { layout: false, run: true },
      layoutByTier: {
        ...v.layoutByTier,
        normal: { ...v.layoutByTier.normal, explorerOpen: false, panels: { ...v.layoutByTier.normal.panels, explorer: 300 } },
      },
      panels: { ...v.panels, explorer: 300 },
      explorerOpen: false,
    };
    const back = resetLayout(custom);
    expect(back.theme).toBe('B');
    expect(back.termHints).toBe(false);
    expect(back.confirmerName).toBe('매튜');
    expect(back.visualMode).toBe('photo');
    expect(back.helpOpen).toBe(true);
    expect(back.paletteOpen).toBe(true);
    expect(back.minimap).toEqual({ layout: true, run: false });
    expect(back.helpSide).toBe('right');
    expect(back.helpFolded).toBe(false);
    expect(back.explorerOpen).toBe(true);
    expect(back.panels.explorer).toBe(224);
    expect(back.layoutByTier.narrow.propsFolded).toBe(true);
    expect(restoreLayout(back, {
      layoutByTier: custom.layoutByTier,
      panels: custom.panels,
      explorerOpen: custom.explorerOpen,
      runStripFolded: custom.runStripFolded,
      runDetailsOpen: custom.runDetailsOpen,
      paletteOpen: custom.paletteOpen,
      minimap: custom.minimap,
      helpSide: custom.helpSide,
      helpFolded: custom.helpFolded,
    }).explorerOpen).toBe(false);
  });
});

describe('TURN-085 screen', () => {
  it('AC2 AC6 AC7 the narrow shell folds, the banner does not block, and rev stays', async () => {
    const u = await mount(1100);
    const shell = app(u.el);
    expect(shell.dataset.widthTier).toBe('narrow');
    expect(shell.dataset.narrowWarn).toBe('0');
    expect(shell.className).toContain('ex-collapsed');
    expect(shell.querySelector('[aria-label="탐색기 펼치기"]')).toBeTruthy();
    expect(shell.querySelector('[data-narrow-banner]')).toBeNull();
    const rev = u.history().present.revision;
    const undo = u.history().past.length;
    await u.click(u.btn('시작하기')!);
    await u.click(shell.querySelector('.stepper [data-stepid="canvas"] .st-go')!);
    expect(shell.querySelector('.ws-canvas')!.className).toContain('fold-props');
    expect(shell.querySelector('[aria-label="속성 칸 펼치기"]')).toBeTruthy();
    expect(shell.querySelector('[data-stepid="canvas"] .st-short')!.textContent).toBe('배치');
    await u.click(shell.querySelector('.stepper [data-stepid="run"] .st-go')!);
    expect(shell.querySelector('.ws-run')!.className).toContain('fold-cond');
    expect(shell.querySelector('.ws-run')!.className).not.toContain('fold-steps');
    expect(u.history().present.revision).toBe(rev);
    expect(u.history().past.length).toBe(undo);

    await resize(800, 700);
    expect(app(u.el).dataset.narrowWarn).toBe('1');
    const banner = app(u.el).querySelector('[data-narrow-banner]') as HTMLElement;
    expect(banner.textContent).toBe('화면이 좁습니다 — 1024 이상에서 쓰세요');
    expect(banner.className).toContain('layout-narrow-banner');
    await u.click(u.btn('이전')!);
    expect(u.history().present.revision).toBe(rev);
    expect(u.history().past.length).toBe(undo);
  });

  it('AC3 AC5 AC7 reset keeps theme and one undo restores the layout without touching rev', async () => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({
      theme: 'B', termHints: false, confirmerName: '매튜', home: false,
      panels: { explorer: 300, library: 256, canvas: 256, run: 380 },
      explorerOpen: false, paletteOpen: false, minimap: { layout: false, run: true },
      helpSide: 'left', helpFolded: true,
    }));
    const u = await mount(1280);
    const shell = app(u.el);
    expect(shell.dataset.widthTier).toBe('normal');
    expect(shell.className).toContain('ex-collapsed');
    expect(shell.style.getPropertyValue('--exw')).toBe('40px');
    const rev = u.history().present.revision;
    const undo = u.history().past.length;
    const wide = workColumnWidth(1920, 'wide', defaultLayout('wide'), 'run');
    const mid = Number(shell.dataset.workWidth);
    expect(wide).toBeGreaterThan(mid);

    await u.click(u.btn('보기 설정')!);
    await u.click(u.el.querySelector('[data-layout-reset]')!);
    expect(app(u.el).dataset.theme).toBe('B');
    expect(loadView(localStorage).termHints).toBe(false);
    expect(loadView(localStorage).confirmerName).toBe('매튜');
    expect(loadView(localStorage).paletteOpen).toBe(true);
    expect(loadView(localStorage).minimap).toEqual({ layout: true, run: false });
    expect(loadView(localStorage).helpSide).toBe('right');
    expect(loadView(localStorage).explorerOpen).toBe(true);
    expect(app(u.el).className).not.toContain('ex-collapsed');
    expect(u.history().present.revision).toBe(rev);
    expect(u.history().past.length).toBe(undo);

    await u.click(u.el.querySelector('[data-notice-action="되돌리기"]')!);
    expect(loadView(localStorage).explorerOpen).toBe(false);
    expect(loadView(localStorage).paletteOpen).toBe(false);
    expect(loadView(localStorage).helpSide).toBe('left');
    expect(loadView(localStorage).theme).toBe('B');
    expect(u.el.querySelector('[data-notice-action="되돌리기"]')).toBeNull();
    expect(u.history().present.revision).toBe(rev);
    expect(u.history().past.length).toBe(undo);

    await resize(1920, 1080);
    expect(app(u.el).dataset.widthTier).toBe('wide');
    expect(Number(app(u.el).dataset.workWidth)).toBeGreaterThan(mid);
    expect(u.history().present.revision).toBe(rev);
  });
});
