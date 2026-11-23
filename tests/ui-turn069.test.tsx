// @vitest-environment jsdom
// TURN-069 header overflow and the help dock overlay.
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { VIEW_KEY } from '../src/storage/localStore';
import { App } from '../src/ui/App';
import { PALETTE_LABEL } from '../src/ui/CommandPalette';
import { collapseOverflow, headerTier, helpLayout } from '../src/ui/headerOverflow';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const widthDesc = Object.getOwnPropertyDescriptor(window, 'innerWidth');
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  localStorage.clear();
  if (widthDesc) Object.defineProperty(window, 'innerWidth', widthDesc);
});

function setWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
}

async function mount(width = 1024) {
  setWidth(width);
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(<App />); });
  const click = async (node: Element) => { await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
  const btn = (label: string, scope: ParentNode = document) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim() === label || b.getAttribute('aria-label') === label) as HTMLButtonElement;
  return { el, click, btn };
}

async function resize(width: number) {
  setWidth(width);
  await act(async () => { window.dispatchEvent(new Event('resize')); });
}

const header = (el: ParentNode) => el.querySelector('.header') as HTMLElement;
const overflow = (el: ParentNode) => [...header(el).querySelectorAll<HTMLButtonElement>('[data-overflow]')];
const hiddenIds = (el: ParentNode) => overflow(el).filter((b) => b.classList.contains('header-overflow')).map((b) => b.dataset.overflow);

describe('TURN-069 overflow order', () => {
  it('hides the tail first and keeps the named widths', () => {
    expect(headerTier(1440)).toBe('wide');
    expect(headerTier(1280)).toBe('medium');
    expect(headerTier(1024)).toBe('compact');
    expect(helpLayout(1440)).toBe('beside');
    expect(helpLayout(1439)).toBe('overlay');
    const ids = ['export-json', 'view-settings', 'help'];
    expect(collapseOverflow(ids, 0, [100, 100, 100], 80)).toEqual([]);
    expect(collapseOverflow(ids, 30, [120, 110, 100], 80)).toEqual(['view-settings', 'help']);
    expect(collapseOverflow(ids, 400, [120, 110, 100], 80)).toEqual(ids);
  });
});

describe('TURN-069 header', () => {
  it('AC1 AC2 1024 keeps save, undo, redo, and command search, and folds the rest in order', async () => {
    const u = await mount(1024);
    const bar = header(u.el);
    expect(bar.dataset.headerTier).toBe('compact');
    expect(bar.querySelector('.brand .title')!.textContent).toBe('Aurora Concept Designer');
    for (const label of ['저장', '실행 취소', '다시 실행', PALETTE_LABEL]) {
      const button = u.btn(label, bar);
      expect(button, label).toBeTruthy();
      expect(button.classList.contains('header-overflow')).toBe(false);
      expect(button.hidden).toBe(false);
    }
    expect(hiddenIds(u.el)).toEqual(['export-json', 'view-settings', 'help', 'undo-history']);
    expect(u.btn('더 보기', bar).classList.contains('header-overflow')).toBe(false);
    const css = readFileSync('src/ui/header-bar.css', 'utf8');
    expect(css).toMatch(/\.app > \.header \{[^}]*flex-wrap:\s*nowrap/);
    expect(css).toContain('min-width: 1024px');
    expect(css).toContain('display: none');
  });

  it('AC2 the more menu runs the same actions, with the same names and icons', async () => {
    const u = await mount(1024);
    const bar = header(u.el);
    const icons = Object.fromEntries(overflow(u.el).map((b) => [b.dataset.overflow, b.querySelector('.ecd-icon')?.getAttribute('data-icon')]));
    await u.click(u.btn('더 보기', bar));
    const menu = document.querySelector('[role="menu"][data-ctx-kind="header"]') as HTMLElement;
    expect(menu.getAttribute('aria-label')).toBe('더 보기');
    const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    expect(items.map((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim())).toEqual(['JSON 내보내기', '인쇄용 보기', '보기 설정', '도움말', '실행 취소 이력']);
    expect(items.map((b) => b.querySelector('.ecd-icon')?.getAttribute('data-icon'))).toEqual([icons['export-json'], 'Printer', icons['view-settings'], icons.help, icons['undo-history']]);
    const blobs: string[] = [];
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = () => { blobs.push('blob'); return 'blob:turn069'; };
    URL.revokeObjectURL = () => {};
    try {
      await u.click(items.find((b) => b.getAttribute('data-action') === 'export-json')!);
      expect(blobs.length).toBe(1);
      expect(document.querySelector('[role="menu"]')).toBeNull();
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    }
    await u.click(u.btn('더 보기', bar));
    await u.click(document.querySelector('[data-action="view-settings"]')!);
    const viewDlg = document.querySelector('[aria-label="보기 설정"]') as HTMLElement;
    expect(viewDlg.textContent).toContain('보기 설정');
    await u.click(u.btn('닫기', viewDlg));
    await u.click(u.btn('더 보기', bar));
    await u.click(document.querySelector('[data-action="help"]')!);
    expect(u.el.querySelector('[data-help-panel]')).not.toBeNull();
    await u.click(u.btn('더 보기', bar));
    await u.click(document.querySelector('[data-action="undo-history"]')!);
    expect(document.querySelector('[role="dialog"][aria-label="실행 취소 이력"]')).not.toBeNull();
    expect(u.el.querySelector('[data-help-toggle]')!.getAttribute('aria-expanded')).toBe('true');
  });

  it('AC3 arrows, Enter, and Esc run the menu and return focus', async () => {
    const u = await mount(1024);
    const more = u.btn('더 보기', header(u.el));
    more.focus();
    await u.click(more);
    const item = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    expect(document.activeElement).toBe(item()[0]);
    const viewItem = () => item().find((b) => b.getAttribute('data-action') === 'view-settings');
    for (let n = 0; n < 6 && document.activeElement !== viewItem(); n += 1) {
      await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
    }
    expect(document.activeElement).toBe(viewItem());
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    const viewDlg = document.querySelector('[aria-label="보기 설정"]') as HTMLElement;
    expect(viewDlg.textContent).toContain('보기 설정');
    await u.click(u.btn('닫기', viewDlg));
    more.focus();
    await u.click(more);
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it('AC1 AC2 1280 may hide only a tail, and 1440 keeps every action on the bar', async () => {
    const mid = await mount(1280);
    expect(header(mid.el).dataset.headerTier).toBe('medium');
    const ids = overflow(mid.el).map((b) => b.dataset.overflow);
    const hidden = hiddenIds(mid.el);
    expect(ids.slice(ids.length - hidden.length)).toEqual(hidden);
    for (const label of ['저장', '실행 취소', '다시 실행', PALETTE_LABEL]) {
      expect(uBtn(mid.el, label).classList.contains('header-overflow')).toBe(false);
    }
    await act(async () => { root!.unmount(); });
    root = null;
    document.body.innerHTML = '';
    const wide = await mount(1440);
    expect(header(wide.el).dataset.headerTier).toBe('wide');
    expect(hiddenIds(wide.el)).toEqual([]);
    expect(uBtn(wide.el, '더 보기').classList.contains('header-overflow')).toBe(true);
    expect(uBtn(wide.el, '내보내기').classList.contains('header-overflow')).toBe(false);
    expect(uBtn(wide.el, '보기 설정').classList.contains('header-overflow')).toBe(false);
    expect(uBtn(wide.el, '도움말').classList.contains('header-overflow')).toBe(false);
  });

  it('AC4 a long project name keeps a tooltip and does not push rev or the save chip out of the rules', async () => {
    const u = await mount(1024);
    await u.click(u.btn('저장', header(u.el)));
    const name0 = u.el.querySelector('[data-project-name]') as HTMLButtonElement;
    expect(name0.title).toBe(`Project ${name0.dataset.projectName}`);
    expect(name0.textContent).toContain(name0.dataset.projectName!);
    await u.click(u.btn(`${name0.dataset.projectName} 프로젝트 상세`));
    await u.click(u.btn(`${name0.dataset.projectName} 이름 변경`));
    const dlg = [...u.el.querySelectorAll<HTMLElement>('.modal')].find((d) => d.querySelector('input'));
    expect(dlg).toBeTruthy();
    const input = dlg!.querySelector('input') as HTMLInputElement;
    const long = '아주 긴 프로젝트 이름입니다 헤더를 넘기지 않아야 합니다';
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, long);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await u.click(u.btn('이름 변경', dlg));
    const named = u.el.querySelector('[data-project-name]') as HTMLButtonElement;
    expect(named.dataset.projectName).toBe(long);
    expect(named.title).toBe(`Project ${long}`);
    expect(named.textContent).toContain(long);
    const rev = u.el.querySelector('.work-rev') as HTMLElement;
    const chip = u.el.querySelector('.save-chip') as HTMLElement;
    expect(rev.title).toBe(rev.textContent);
    expect(chip.title).toBe('저장 안 됨');
    const css = `${readFileSync('src/ui/styles.css', 'utf8')}\n${readFileSync('src/ui/header-bar.css', 'utf8')}`;
    expect(css).toMatch(/\.work-crumb \{[^}]*text-overflow:\s*ellipsis/);
    expect(css).toMatch(/\.app > \.workbar \.work-crumb \{[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.work-rev,\s*\n\.app > \.workbar \.save-chip[\s\S]*flex:\s*none/);
  });
});

function uBtn(el: ParentNode, label: string) {
  return [...el.querySelectorAll('button')].find((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim() === label || b.getAttribute('aria-label') === label) as HTMLButtonElement;
}

describe('TURN-069 help overlay', () => {
  it('AC5 1280 overlays and 1440 sits beside, without a modal', async () => {
    const u = await mount(1280);
    const before = u.el.querySelector('.workspace');
    await u.click(u.el.querySelector('[data-help-toggle]')!);
    const app = u.el.querySelector('.app') as HTMLElement;
    const panel = u.el.querySelector('[data-help-panel]') as HTMLElement;
    expect(app.dataset.helpLayout).toBe('overlay');
    expect(panel.dataset.helpLayout).toBe('overlay');
    expect(panel.dataset.helpSide).toBe('right');
    expect(panel.getAttribute('role')).toBe('region');
    expect(panel.closest('.modal-bg')).toBeNull();
    expect(panel.closest('.app')).toBe(app);
    expect(u.el.querySelector('.workspace')).toBe(before);
    const css = readFileSync('src/ui/help-panel.css', 'utf8');
    expect(css).toContain('.app.help-open[data-help-layout="beside"]');
    expect(css).toContain('position: fixed');
    expect(css).not.toMatch(/\.app\.help-open \{[^}]*320px/);
    await u.click(u.el.querySelector('[data-stepid="library"] .st-go')!);
    expect(app.dataset.step).toBe('library');
    expect(panel.isConnected).toBe(true);
    await resize(1440);
    expect(app.dataset.helpLayout).toBe('beside');
    expect(panel.dataset.helpLayout).toBe('beside');
    expect(panel.querySelector('[data-help-fold]')).toBeNull();
  });

  it('AC6 dragging and folding the overlay is remembered in this browser', async () => {
    const u = await mount(1280);
    await u.click(u.el.querySelector('[data-help-toggle]')!);
    const panel = () => u.el.querySelector('[data-help-panel]') as HTMLElement;
    await u.click(panel().querySelector('[data-help-fold]')!);
    expect(panel().classList.contains('is-folded')).toBe(true);
    expect(panel().querySelector('[data-help-fold]')!.textContent).toContain('펼치기');
    expect(JSON.parse(localStorage.getItem(VIEW_KEY)!).helpFolded).toBe(true);
    const head = panel().querySelector('[data-help-drag]') as HTMLElement;
    await act(async () => {
      head.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 1100, pointerId: 1 }));
      head.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 40, pointerId: 1 }));
    });
    expect(panel().dataset.helpSide).toBe('left');
    expect(JSON.parse(localStorage.getItem(VIEW_KEY)!).helpSide).toBe('left');
    expect(JSON.parse(localStorage.getItem(VIEW_KEY)!).helpOpen).toBe(true);
    await act(async () => { root!.unmount(); });
    root = null;
    const again = await mount(1280);
    const next = again.el.querySelector('[data-help-panel]') as HTMLElement;
    expect(next).not.toBeNull();
    expect(next.dataset.helpSide).toBe('left');
    expect(next.classList.contains('is-folded')).toBe(true);
    expect(JSON.parse(localStorage.getItem(VIEW_KEY)!).helpFolded).toBe(true);
  });
});
