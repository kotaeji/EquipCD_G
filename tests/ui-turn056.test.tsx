// @vitest-environment jsdom
// TURN-056 in-app help and glossary tips.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { VIEW_KEY } from '../src/storage/localStore';
import { App } from '../src/ui/App';
import { GLOSSARY } from '../src/ui/glossary';

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
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim() === label) as HTMLButtonElement;
  return { el, click, btn };
}

const stat = (el: HTMLElement) => {
  const text = el.querySelector('.statusbar')!.textContent ?? '';
  return { rev: /rev (\d+)/.exec(text)![1], undo: /Undo (\d+)/.exec(text)![1] };
};
const panel = (el: HTMLElement) => el.querySelector('[data-help-panel]') as HTMLElement | null;
const topic = (el: HTMLElement) => panel(el)?.getAttribute('data-help-topic');

describe('TURN-056 help panel', () => {
  it('AC1 the header button opens the dock, and Esc or 닫기 closes it and returns focus', async () => {
    const u = await mount();
    const toggle = u.el.querySelector('[data-help-toggle]') as HTMLButtonElement;
    expect(toggle.textContent).toContain('도움말');
    expect(panel(u.el)).toBeNull();
    await u.click(toggle);
    const open = panel(u.el)!;
    expect(open).not.toBeNull();
    expect(open.getAttribute('role')).toBe('region');
    expect(open.closest('.modal-bg')).toBeNull();
    expect(topic(u.el)).toBe('home');
    expect(open.textContent).toContain('이 화면에서 하는 일');
    expect(open.textContent).toContain('자주 하는 일');
    expect(open.textContent).toContain('막힐 때');
    expect(open.textContent).toContain('매뉴얼 2.3 처음 열면');
    expect(open.textContent).toContain('둘러보기 다시 보기');
    expect(open.textContent).not.toContain('단축키');
    expect(document.activeElement).toBe(open);
    await u.click(u.btn('닫기', open));
    expect(panel(u.el)).toBeNull();
    expect(document.activeElement).toBe(toggle);
    await u.click(toggle);
    expect(panel(u.el)).not.toBeNull();
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(panel(u.el)).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });

  it('AC3 AC5 the open dock follows the step and tab, and the screen still works', async () => {
    const u = await mount();
    await u.click(u.el.querySelector('[data-help-toggle]')!);
    expect(topic(u.el)).toBe('home');
    await u.click(u.btn('시작하기'));
    expect(u.el.querySelector('.app')!.getAttribute('data-step')).toBe('library');
    expect(topic(u.el)).toBe('library:cards');
    expect(panel(u.el)!.textContent).toContain('에셋 라이브러리');
    await u.click(u.btn('AML 입출력'));
    expect(topic(u.el)).toBe('library:aml');
    expect(panel(u.el)!.textContent).toContain('매뉴얼 5.3');
    await u.click(u.el.querySelector('[data-stepid="canvas"] .st-go')!);
    expect(topic(u.el)).toBe('canvas:board');
    await u.click(u.el.querySelector('[data-tab-id="diagram"]')!);
    expect(topic(u.el)).toBe('canvas:diagram');
    expect(panel(u.el)!.textContent).toContain('도면 도식');
    await u.click(u.el.querySelector('#explorer-tab-workspace')!);
    expect(topic(u.el)).toBe('workspace');
    await u.click(u.el.querySelector('[data-stepid="run"] .st-go')!);
    expect(u.el.querySelector('.app')!.getAttribute('data-step')).toBe('run');
    expect(topic(u.el)).toBe('run:diagram');
    await u.click(u.el.querySelector('[aria-label="실행 보기"] [aria-checked="false"]')!);
    expect(topic(u.el)).toBe('run:3d');
    expect(panel(u.el)!.closest('.app')).not.toBeNull();
  });

  it('AC6 opening and closing is remembered and does not change rev or undo', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    const before = stat(u.el);
    await u.click(u.el.querySelector('[data-help-toggle]')!);
    await u.click(u.btn('닫기', panel(u.el)!));
    expect(stat(u.el)).toEqual(before);
    await u.click(u.el.querySelector('[data-help-toggle]')!);
    expect(JSON.parse(localStorage.getItem(VIEW_KEY)!).helpOpen).toBe(true);
    const rev = stat(u.el);
    await act(async () => { root!.unmount(); });
    root = null;
    const again = await mount(false);
    expect(panel(again.el)).not.toBeNull();
    expect(stat(again.el)).toEqual(rev);
    await again.click(again.btn('닫기', panel(again.el)!));
    expect(JSON.parse(localStorage.getItem(VIEW_KEY)!).helpOpen).toBe(false);
    expect(stat(again.el)).toEqual(rev);
    await act(async () => { root!.unmount(); });
    root = null;
    const closed = await mount(false);
    expect(panel(closed.el)).toBeNull();
  });
});

describe('TURN-056 glossary on screen', () => {
  it('AC8 a title, the step bar, and a table header show the line and describe it', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    await u.click(u.el.querySelector('[data-stepid="sequence"] .st-go')!);
    const title = u.el.querySelector('.stage-title [data-term="station"]') as HTMLElement;
    expect(title.textContent).toBe('Station');
    await act(async () => { title.focus(); });
    const tipId = title.getAttribute('aria-describedby');
    const tip = document.getElementById(tipId!)!;
    expect(tip.getAttribute('role')).toBe('tooltip');
    expect(tip.textContent).toBe(GLOSSARY.station.line);
    await act(async () => { title.blur(); });
    const action = u.el.querySelector('.stepper [data-term="action"]') as HTMLElement;
    await act(async () => { action.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    expect(document.querySelector('[data-term-tip="action"]')!.textContent).toBe(GLOSSARY.action.line);
    const head = [...u.el.querySelectorAll('th')].find((th) => (th.textContent ?? '').includes('타임아웃'))!;
    const mark = head.querySelector('[data-term="timeout"]') as HTMLElement;
    expect(head.textContent).toContain('타임아웃');
    await act(async () => { mark.focus(); });
    expect(document.getElementById(mark.getAttribute('aria-describedby')!)!.textContent).toBe(GLOSSARY.timeout.line);
  });

  it('AC9 보기 설정 turns the underlines and tips off without changing rev', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    await u.click(u.el.querySelector('[data-stepid="attributes"] .st-go')!);
    const before = stat(u.el);
    expect(u.el.querySelector('[data-term="action"]')).not.toBeNull();
    await u.click(u.btn('보기 설정'));
    const box = u.el.querySelector('[data-term-hints]') as HTMLInputElement;
    expect(box.checked).toBe(true);
    await act(async () => { box.click(); });
    expect(stat(u.el)).toEqual(before);
    expect(JSON.parse(localStorage.getItem(VIEW_KEY)!).termHints).toBe(false);
    await u.click(u.btn('닫기'));
    expect(u.el.querySelector('[data-term]')).toBeNull();
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    expect(u.el.querySelector('.stepper [data-stepid="attributes"] .st-go')!.textContent).toContain('3 속성·Action');
    expect(stat(u.el)).toEqual(before);
  });
});
