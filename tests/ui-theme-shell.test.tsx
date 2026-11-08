// @vitest-environment jsdom
// jsdom only (not a browser): theme storage, dialog focus trap, and background shortcuts.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { History } from '../src/model/history';
import { App } from '../src/ui/App';
import { appearanceOf, loadView, paletteTheme, THEMES } from '../src/ui/viewSettings';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); root = null; document.body.innerHTML = ''; localStorage.clear(); });

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

  it('Tab stays inside the top dialog and Ctrl+Z does not undo behind it', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    const before = u.history();
    await u.click(u.btn('관리…'));
    const dlg = u.el.querySelector('[role=dialog]') as HTMLElement;
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    const focusable = [...dlg.querySelectorAll<HTMLElement>('button, input, select, textarea')].filter((b) => !b.hasAttribute('disabled'));
    focusable[focusable.length - 1].focus();
    await act(async () => { focusable[focusable.length - 1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })); });
    expect(document.activeElement).toBe(focusable[0]);
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })); });
    expect(u.history()).toEqual(before);
  });
});
