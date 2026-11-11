// @vitest-environment jsdom
// jsdom only (not a browser): theme storage, dialog focus trap, and background shortcuts.
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { History } from '../src/model/history';
import { App } from '../src/ui/App';
import { appearanceOf, loadView, paletteTheme, THEMES } from '../src/ui/viewSettings';

const HEADER_BG = '#A20034';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  document.head.querySelectorAll('style').forEach((s) => s.remove());
  localStorage.clear();
});

async function mount() {
  const el = document.createElement('div'); document.body.appendChild(el);
  const seen: { h: History | null } = { h: null };
  root = createRoot(el);
  await act(async () => { root!.render(<App onHistory={(h) => { seen.h = h; }} />); });
  const app = () => el.querySelector('.app') as HTMLElement;
  const btn = (label: string) => [...el.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(label)) as HTMLButtonElement;
  const click = async (b: Element) => { await act(async () => { (b as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
  return { el, app, btn, click, history: () => structuredClone(seen.h!) };
}

describe('theme shell (jsdom)', () => {
  it('stored C paints light and is not rewritten until the user picks a theme', async () => {
    localStorage.setItem('ecd.v1.userView', JSON.stringify({ theme: 'C', step: 'library', home: false }));
    const u = await mount();
    expect(u.app().dataset.theme).toBe('C');
    expect(u.app().dataset.appearance).toBe('light');
    expect(u.app().style.getPropertyValue('--accent')).toBe(THEMES[paletteTheme('C')].vars.accent);
    expect(u.app().style.getPropertyValue('--accent')).not.toBe(THEMES.C.vars.accent);
    expect(JSON.parse(localStorage.getItem('ecd.v1.userView')!).theme).toBe('C');
    const rev = u.history().present.revision;
    await u.click(u.btn('다크'));
    expect(u.app().dataset.theme).toBe('B');
    expect(u.app().dataset.appearance).toBe('dark');
    expect(u.history().present.revision).toBe(rev);
    expect(loadView(localStorage).theme).toBe('B');
    expect(appearanceOf('C')).toBe('light');
  });

  it('AC1 AC4: header brand color stays rgb(162, 0, 52) on light, dark, and stored C', async () => {
    const css = document.createElement('style');
    css.textContent = readFileSync('src/ui/styles.css', 'utf8');
    document.head.appendChild(css);
    const toRgb = (value: string) => {
      const n = value.trim().replace('#', '');
      return `rgb(${parseInt(n.slice(0, 2), 16)}, ${parseInt(n.slice(2, 4), 16)}, ${parseInt(n.slice(4, 6), 16)})`;
    };
    // jsdom does not resolve var() inside getComputedStyle, so the brand color is read from the
    // custom property the header rule uses. A resolving engine must still report rgb(162, 0, 52).
    const headerBg = (app: HTMLElement) => {
      const token = app.style.getPropertyValue('--header-bg');
      expect(token.toUpperCase()).toBe(HEADER_BG);
      expect(toRgb(token)).toBe('rgb(162, 0, 52)');
      expect(app.style.getPropertyValue('--header-fg').toUpperCase()).toBe('#FFFFFF');
      expect(app.style.getPropertyValue('--header-muted').toUpperCase()).toBe('#F5D6DE');
      const header = app.querySelector('.header') as HTMLElement;
      const painted = getComputedStyle(header).backgroundColor;
      if (painted !== 'rgba(0, 0, 0, 0)') expect(painted).toBe('rgb(162, 0, 52)');
      expect(getComputedStyle(header).borderBottomColor).toBe('rgb(122, 0, 39)');
      return token.toUpperCase();
    };
    const light = await mount();
    const lightBg = headerBg(light.app());
    expect(light.app().dataset.theme).toBe('A');
    const rev = light.history().present.revision;
    await light.click(light.el.querySelector('[data-theme-choice="dark"]')!);
    expect(light.app().dataset.theme).toBe('B');
    expect(light.app().dataset.appearance).toBe('dark');
    expect(headerBg(light.app())).toBe(lightBg);
    expect(light.history().present.revision).toBe(rev);
    expect(loadView(localStorage).theme).toBe('B');

    localStorage.setItem('ecd.v1.userView', JSON.stringify({ theme: 'C', step: 'library', home: false }));
    await act(async () => { root!.unmount(); });
    root = null;
    document.body.innerHTML = '';
    document.head.appendChild(css);
    const stored = await mount();
    expect(stored.app().dataset.theme).toBe('C');
    expect(stored.app().dataset.appearance).toBe('light');
    expect(headerBg(stored.app())).toBe(lightBg);
    expect(JSON.parse(localStorage.getItem('ecd.v1.userView')!).theme).toBe('C');
    expect(stored.app().style.getPropertyValue('--header-bg').toUpperCase()).toBe(THEMES.C.vars['header-bg']);
    const outside = stored.el.querySelector('.statusbar button.btn-main.secondary') as HTMLElement;
    const save = stored.el.querySelector('.header button.btn-main.primary') as HTMLElement;
    expect(getComputedStyle(save).backgroundColor).toBe('rgb(255, 255, 255)');
    expect(getComputedStyle(save).color).toBe('rgb(162, 0, 52)');
    expect(getComputedStyle(outside).backgroundColor).not.toBe('rgb(255, 255, 255)');
    expect(getComputedStyle(outside).backgroundColor).not.toBe('rgb(162, 0, 52)');
    const icon = stored.el.querySelector('.header button.icon') as HTMLElement;
    const iconStyle = getComputedStyle(icon);
    expect(iconStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(iconStyle.color).toBe('rgb(255, 255, 255)');
    expect(iconStyle.borderTopColor).toBe('rgba(0, 0, 0, 0)');
    expect(iconStyle.opacity).toBe('0.5');
  });

  it('Tab stays inside the top dialog and Ctrl+Z does not undo behind it', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    const before = u.history();
    await u.click(u.el.querySelector('.exitem .x')!);
    const detail = u.el.querySelector('[role=dialog]') as HTMLElement;
    await u.click([...detail.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '이름 변경')!);
    const dlg = [...u.el.querySelectorAll<HTMLElement>('[role=dialog]')].find((d) => d.querySelector('input'))!;
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    const focusable = [...dlg.querySelectorAll<HTMLElement>('button, input, select, textarea')].filter((b) => !b.hasAttribute('disabled'));
    focusable[focusable.length - 1].focus();
    await act(async () => { focusable[focusable.length - 1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })); });
    expect(document.activeElement).toBe(focusable[0]);
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })); });
    expect(u.history()).toEqual(before);
  });
});
