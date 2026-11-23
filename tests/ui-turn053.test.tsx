// @vitest-environment jsdom
// TURN-053 command palette and shortcut sheet.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { DUPLICATE_NEED_DEVICE } from '../src/model/commands';
import type { History } from '../src/model/history';
import { NO_FLOW_ROW, shortcutText, usesMacShortcut, commandById } from '../src/ui/commandModel';
import { EDIT_LOCKED } from '../src/ui/contextMenuModel';
import { App } from '../src/ui/App';
import { holdRuntimeClock } from './holdRuntimeClock';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  const seen: { h: History | null } = { h: null };
  root = createRoot(el);
  await act(async () => { root!.render(<App onHistory={(h) => { seen.h = h; }} />); });
  const click = async (node: Element | undefined | null) => {
    if (!node) throw new Error('missing control');
    await act(async () => { (node as HTMLElement).click(); });
  };
  const key = async (node: EventTarget, init: KeyboardEventInit) => {
    let ev!: KeyboardEvent;
    await act(async () => {
      ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      node.dispatchEvent(ev);
    });
    return ev;
  };
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label || b.getAttribute('aria-label') === label) as HTMLButtonElement | undefined;
  const palette = () => el.querySelector('[role="dialog"][aria-label="명령 찾기"]');
  const sheet = () => el.querySelector('[role="dialog"][aria-label="단축키 목록"]');
  const typeQuery = async (value: string) => {
    const input = palette()?.querySelector('input') as HTMLInputElement;
    await act(async () => {
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const row = (id: string) => palette()?.querySelector(`[data-command="${id}"]`) as HTMLButtonElement | null;
  const enter = async () => { await key(window, { key: 'Enter' }); };
  const rev = () => seen.h!.present.revision;
  const undoN = () => seen.h!.past.length;
  return { el, click, key, btn, palette, sheet, typeQuery, row, enter, history: () => seen.h!, rev, undoN };
}

describe('TURN-053 command palette UI', () => {
  it('AC1 opens from Ctrl+K, Cmd+K, and the header on every step, and Esc returns focus', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    const steps = ['library', 'canvas', 'run'] as const;
    for (const step of steps) {
      const anchor = u.el.querySelector(`.stepper [data-stepid="${step}"] .st-go`) as HTMLButtonElement;
      await u.click(anchor);
      anchor.focus();
      await u.key(window, { key: 'k', ctrlKey: true });
      expect(u.palette(), step).toBeTruthy();
      expect(document.activeElement?.getAttribute('aria-label')).toBe('명령 검색');
      await u.key(window, { key: 'Escape' });
      expect(u.palette()).toBeNull();
      expect(document.activeElement).toBe(anchor);

      anchor.focus();
      await u.key(window, { key: 'k', metaKey: true });
      expect(u.palette(), `${step} meta`).toBeTruthy();
      await u.key(window, { key: 'Escape' });
      expect(document.activeElement).toBe(anchor);
    }
    const header = u.btn('명령 찾기')!;
    header.focus();
    await u.click(header);
    expect(u.palette()).toBeTruthy();
    expect(header.querySelector('.cmd-key')!.textContent).toBe(shortcutText(commandById('palette')!, usesMacShortcut()));
    await u.key(window, { key: 'Escape' });
    expect(document.activeElement).toBe(header);
  });

  it('AC3 runs one command from edit, sequence, run, and view the same way as its button', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]'));
    await u.click(u.el.querySelector('#layout-tab-diagram'));
    await u.click(u.el.querySelector('[data-tree-id="PSH-01"]'));
    const before = u.history().present.devices.map((d) => d.name).sort();
    const baseRev = u.rev();
    await u.key(window, { key: 'k', ctrlKey: true });
    await u.typeQuery('복제');
    expect(u.row('duplicate')!.getAttribute('aria-selected')).toBe('true');
    await u.key(window, { key: 'ArrowDown' });
    await u.enter();
    expect(u.rev()).toBe(baseRev + 1);
    expect(u.undoN()).toBe(1);
    const viaPalette = u.history().present.devices.map((d) => d.name).sort();
    expect(viaPalette.length).toBe(before.length + 1);
    await u.click(u.btn('실행 취소'));
    expect(u.rev()).toBe(baseRev);
    expect(u.history().present.devices.map((d) => d.name).sort()).toEqual(before);
    await u.click(u.el.querySelector('[data-tree-id="PSH-01"]'));
    await u.click(u.btn('복제', u.el.querySelector('.diagram-tools')!));
    expect(u.rev()).toBe(baseRev + 1);
    expect(u.undoN()).toBe(1);
    expect(u.history().present.devices.map((d) => d.name).sort()).toEqual(viaPalette);

    const clock = holdRuntimeClock();
    try {
      await u.click(u.el.querySelector('.stepper [data-stepid="run"]'));
      const runRev = u.rev();
      const runUndo = u.undoN();
      await u.key(window, { key: 'k', ctrlKey: true });
      await u.typeQuery('실행');
      expect(u.row('run')!.getAttribute('aria-selected')).toBe('true');
      await u.enter();
      expect(u.rev()).toBe(runRev);
      expect(u.undoN()).toBe(runUndo);
      expect(u.btn('❚❚ 일시정지')!.disabled).toBe(false);
      const status = u.el.querySelector('.statusbar')!.textContent;
      await u.click(u.btn('⟲ 초기화'));
      expect(u.btn('❚❚ 일시정지')!.disabled).toBe(true);
      await u.click(u.btn('▶ 실행'));
      expect(u.btn('❚❚ 일시정지')!.disabled).toBe(false);
      expect(u.el.querySelector('.statusbar')!.textContent).toBe(status);
      expect(u.rev()).toBe(runRev);
      await u.click(u.btn('⟲ 초기화'));
    } finally { clock.restore(); }

    await u.key(window, { key: 'k', ctrlKey: true });
    await u.typeQuery('흐름 예제');
    await u.enter();
    await u.click(u.el.querySelector('.stepper [data-stepid="sequence"]'));
    const seqRev = u.rev();
    await u.key(window, { key: 'k', ctrlKey: true });
    await u.typeQuery('신호 기다림');
    await u.key(window, { key: 'ArrowUp' });
    await u.enter();
    expect(u.rev()).toBe(seqRev + 1);
    expect(u.undoN()).toBe(1);
    const lastKind = () => { const flow = u.history().present.sequence.flow!; return flow[flow.length - 1]?.kind; };
    expect(lastKind()).toBe('wait');
    await u.click(u.btn('실행 취소'));
    expect(lastKind()).not.toBe('wait');
    await u.click(u.btn('신호 기다림 추가'));
    expect(u.rev()).toBe(seqRev + 1);
    expect(u.undoN()).toBe(1);
    expect(lastKind()).toBe('wait');

    await u.key(window, { key: 'k', ctrlKey: true });
    await u.typeQuery('다크');
    await u.key(window, { key: 'ArrowDown' });
    await u.enter();
    expect(u.el.querySelector('.app')!.getAttribute('data-appearance')).toBe('dark');
    const themeRev = u.rev();
    const themeUndo = u.undoN();
    await u.click(u.btn('라이트'));
    expect(u.el.querySelector('.app')!.getAttribute('data-appearance')).toBe('light');
    await u.key(window, { key: 'k', ctrlKey: true });
    await u.typeQuery('다크');
    await u.enter();
    expect(u.el.querySelector('.app')!.getAttribute('data-appearance')).toBe('dark');
    expect(u.rev()).toBe(themeRev);
    expect(u.undoN()).toBe(themeUndo);
  });

  it('AC5 a command that cannot run is dim, shows why, and Enter does nothing', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    const rev = u.rev();
    const undo = u.undoN();
    await u.key(window, { key: 'k', ctrlKey: true });
    await u.typeQuery('복제');
    const dim = u.row('duplicate')!;
    expect(dim.classList.contains('is-dim')).toBe(true);
    expect(dim.getAttribute('aria-disabled')).toBe('true');
    expect(dim.textContent).toContain(DUPLICATE_NEED_DEVICE);
    await u.enter();
    expect(u.palette()).toBeTruthy();
    expect(u.rev()).toBe(rev);
    expect(u.undoN()).toBe(undo);
    await u.key(window, { key: 'Escape' });

    const clock = holdRuntimeClock();
    try {
      await u.click(u.el.querySelector('.stepper [data-stepid="run"]'));
      await u.click(u.btn('▶ 실행'));
      await u.key(window, { key: 'k', ctrlKey: true });
      await u.typeQuery('병렬로 묶기');
      const locked = u.row('wrap-parallel')!;
      expect(locked.classList.contains('is-dim')).toBe(true);
      expect(locked.textContent).toContain(EDIT_LOCKED);
      await u.enter();
      expect(u.palette()).toBeTruthy();
      expect(u.rev()).toBe(rev);
    } finally { clock.restore(); }
  });

  it('AC6 runs a command from another step after moving there', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]'));
    await u.key(window, { key: 'k', ctrlKey: true });
    await u.typeQuery('물류 연결');
    await u.enter();
    expect(u.el.querySelector('.app')!.getAttribute('data-step')).toBe('canvas');
    expect(u.btn('물류 연결')!.classList.contains('on')).toBe(true);

    await u.key(window, { key: 'k', ctrlKey: true });
    await u.typeQuery('흐름 예제');
    await u.enter();
    await u.click(u.el.querySelector('.stepper [data-stepid="sequence"]'));
    const box = u.el.querySelector('table[aria-label="Station 흐름"] input[type="checkbox"]') as HTMLInputElement;
    await u.click(box);
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]'));
    const rev = u.rev();
    await u.key(window, { key: 'k', ctrlKey: true });
    await u.typeQuery('병렬로 묶기');
    expect(u.row('wrap-parallel')!.getAttribute('aria-disabled')).toBe('false');
    await u.enter();
    expect(u.el.querySelector('.app')!.getAttribute('data-step')).toBe('sequence');
    expect(u.rev()).toBe(rev + 1);
    expect(u.undoN()).toBe(1);
    expect(u.history().present.sequence.flow!.some((n) => n.kind === 'parallel')).toBe(true);

    await u.click(u.el.querySelector('.stepper [data-stepid="run"]'));
    await u.key(window, { key: 'k', ctrlKey: true });
    await u.typeQuery('3D 보기');
    await u.enter();
    expect(u.el.querySelector('.app')!.getAttribute('data-step')).toBe('run');
    expect(u.el.querySelector('[data-run-view]')!.getAttribute('data-run-view')).toBe('3d');
  });

  it('AC8 ? opens the sheet outside a field and types inside one', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    const input = u.el.querySelector('input[placeholder="검색 (이름/키/ID)"]') as HTMLInputElement;
    input.focus();
    const typed = await u.key(input, { key: '?', shiftKey: true });
    expect(typed.defaultPrevented).toBe(false);
    expect(u.sheet()).toBeNull();
    const anchor = u.el.querySelector('.stepper .st-go') as HTMLButtonElement;
    anchor.focus();
    const opened = await u.key(anchor, { key: '?', shiftKey: true });
    expect(opened.defaultPrevented).toBe(true);
    expect(u.sheet()).toBeTruthy();
    await u.click(u.btn('닫기', u.sheet()!));
    expect(u.sheet()).toBeNull();
  });

  it('AC9 AC10 the sheet lists the same shortcuts the keys use', async () => {
    const u = await mount();
    const anchor = u.btn('시작하기')!;
    anchor.focus();
    await u.key(anchor, { key: '?', shiftKey: true });
    const mac = usesMacShortcut();
    const lines = [...u.sheet()!.querySelectorAll('[data-shortcut]')];
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(['command', 'extra']).toContain(line.getAttribute('data-shortcut-source'));
    }
    const undo = u.sheet()!.querySelector('[data-shortcut="undo"]')!;
    expect(undo.querySelector('.cmd-kbd')!.textContent).toBe(shortcutText(commandById('undo')!, mac));
    expect(u.sheet()!.querySelector('[data-shortcut="palette"] .cmd-kbd')!.textContent).toBe(mac ? '⌘K' : 'Ctrl+K');
    expect(u.sheet()!.textContent).toContain('그 밖의 조작');
    expect(u.sheet()!.textContent).toContain('Shift+끌기');
    await u.key(window, { key: 'Escape' });

    await u.click(anchor);
    await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]'));
    await u.click(u.el.querySelector('[data-tree-id="PSH-01"]'));
    await u.key(window, { key: 'k', ctrlKey: true });
    await u.typeQuery('복제');
    await u.enter();
    const rev = u.rev();
    await u.key(window, { key: 'z', ctrlKey: true });
    expect(u.rev()).toBe(rev - 1);
  });

  it('AC11 opening and closing does not touch rev, and a dialog blocks both', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    const rev = u.rev();
    const undo = u.undoN();
    const anchor = u.el.querySelector('.stepper .st-go') as HTMLButtonElement;
    anchor.focus();
    await u.key(window, { key: 'k', ctrlKey: true });
    await u.typeQuery('병렬');
    await u.key(window, { key: 'Escape' });
    await u.key(anchor, { key: '?', shiftKey: true });
    await u.key(window, { key: 'Escape' });
    expect(u.palette()).toBeNull();
    expect(u.sheet()).toBeNull();
    expect(u.rev()).toBe(rev);
    expect(u.undoN()).toBe(undo);

    await u.click(u.btn('보기 설정'));
    expect(u.el.querySelector('.modal-bg')).toBeTruthy();
    await u.key(window, { key: 'k', ctrlKey: true });
    expect(u.palette()).toBeNull();
    await u.key(window, { key: '?', shiftKey: true });
    expect(u.sheet()).toBeNull();
    expect(u.rev()).toBe(rev);
    await u.click(u.btn('5공정 예제로 둘러보기'));
    expect(u.el.querySelector('.modal-bg')).toBeNull();
    expect(u.el.querySelector('.tour-pop')).toBeTruthy();
    await u.key(window, { key: 'k', ctrlKey: true });
    expect(u.palette()).toBeNull();
    await u.key(window, { key: '?', shiftKey: true });
    expect(u.sheet()).toBeNull();
  });

  it('shows the empty-selection reason for a sequence command on step 6', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]'));
    await u.key(window, { key: 'k', ctrlKey: true });
    await u.typeQuery('병렬로 묶기');
    expect(u.row('wrap-parallel')!.textContent).toContain(NO_FLOW_ROW);
    expect(u.row('wrap-parallel')!.getAttribute('aria-disabled')).toBe('true');
  });
});
