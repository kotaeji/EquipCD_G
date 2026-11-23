// @vitest-environment jsdom
// TURN-061: one icon set. Words, accessible names, and data-* stay.
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/ui/App';
import { ICONS } from '../src/ui/Icon';
import { COMMANDS } from '../src/ui/commandModel';
import { MENU_ICON, COMMAND_ICONS, ICON_PX, ICON_STROKE, commandIcon, iconCollisions, menuIconId } from '../src/ui/icons';
import { STATUS } from '../src/ui/status';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('TURN-061 icon table', () => {
  it('AC1 AC4 every command has one icon and no two commands share it', () => {
    const missing = COMMANDS.filter((c) => !commandIcon(c.id)).map((c) => c.id);
    expect(missing).toEqual([]);
    expect(iconCollisions()).toEqual([]);
    for (const name of Object.values(COMMAND_ICONS)) expect(ICONS[name], name).toBeTypeOf('object');
    expect(ICON_PX.sm).toBe(16);
    expect(ICON_PX.md).toBe(24);
    expect(ICON_STROKE).toBe(2);
    expect(new Set(Object.values(ICON_PX)).size).toBe(2);
  });

  it('AC4 a menu action uses the same icon as its command', () => {
    expect(commandIcon(menuIconId('copy')!)).toBe(commandIcon('copy'));
    expect(commandIcon(menuIconId('paste')!)).toBe(commandIcon('paste'));
    expect(commandIcon(menuIconId('delete')!)).toBe(commandIcon('delete'));
    expect(commandIcon(menuIconId('fit')!)).toBe(commandIcon('fit-unit'));
    expect(commandIcon(menuIconId('alignLeft')!)).toBe(commandIcon('align-left'));
    expect(commandIcon(menuIconId('selectAll')!)).toBe(commandIcon('select-all'));
    expect(commandIcon(menuIconId('lockPosition', '위치 잠금 해제')!)).toBe(commandIcon('unlock'));
    expect(commandIcon(MENU_ICON.saveTemplate)).toBe(commandIcon('save-template'));
    expect(commandIcon('undo')).toBe(commandIcon('redo') === commandIcon('undo') ? undefined : commandIcon('undo'));
  });

  it('AC5 AC6 icons follow currentColor and the status marks stay glyphs', () => {
    const css = readFileSync('src/ui/icons.css', 'utf8');
    expect(css).toContain('color: currentColor');
    expect(css).toContain('stroke: currentColor');
    expect(css).toMatch(/button\.danger:has\(\.ecd-icon\)::before \{ content: none; \}/);
    const danger = readFileSync('src/ui/styles.css', 'utf8');
    expect(danger).toMatch(/button\.danger::before \{ content: "✕ "; font-weight: 700; \}/);
    expect(danger).toMatch(/button:disabled \{ opacity: \.45/);
    expect(STATUS.active.mark).toBe('▶');
    expect(STATUS.done.mark).toBe('✓');
    expect(STATUS.error.mark).toBe('!');
    expect(STATUS.pending.mark).toBe('○');
    expect(STATUS.undetermined.mark).toBe('?');
    expect(STATUS.assumption.mark).toBe('△');
  });
});

describe('TURN-061 icons on screen', () => {
  it('AC2 AC4 AC5 header, run, and the command list share icons and keep the words', async () => {
    localStorage.clear();
    const el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => { root!.render(<App />); });
    const btn = (label: string) => [...el.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label || b.getAttribute('aria-label') === label) as HTMLButtonElement;
    const iconOf = (node: Element | null | undefined) => node?.querySelector('.ecd-icon')?.getAttribute('data-icon');

    expect(btn('저장').textContent).toContain('저장');
    expect(btn('내보내기').textContent?.trim()).toBe('내보내기');
    expect(btn('보기 설정').textContent?.trim()).toBe('보기 설정');
    expect(btn('도움말').getAttribute('aria-label')).toBe('도움말');
    expect(btn('도움말').textContent).toContain('도움말');
    expect(btn('명령 찾기').getAttribute('aria-label')).toBe('명령 찾기');
    expect(btn('실행 취소').getAttribute('aria-label')).toBe('실행 취소');
    expect(btn('다시 실행').getAttribute('aria-label')).toBe('다시 실행');
    expect(iconOf(btn('저장'))).toBe(commandIcon('save'));
    expect(iconOf(btn('내보내기'))).toBe(commandIcon('export-json'));
    expect(iconOf(btn('보기 설정'))).toBe(commandIcon('view-settings'));
    expect(iconOf(btn('도움말'))).toBe(commandIcon('help'));
    expect(iconOf(btn('명령 찾기'))).toBe(commandIcon('palette'));
    expect(iconOf(btn('실행 취소'))).toBe(commandIcon('undo'));
    expect(iconOf(btn('다시 실행'))).toBe(commandIcon('redo'));

    const redo = btn('다시 실행');
    expect(redo.disabled).toBe(true);
    const svg = redo.querySelector('svg')!;
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('width')).toBe('24');
    expect(svg.getAttribute('height')).toBe('24');

    await act(async () => { btn('시작하기').click(); });
    await act(async () => { el.querySelector<HTMLElement>('.stepper [data-stepid="run"]')!.click(); });
    const run = btn('▶ 실행');
    expect(run.textContent?.trim()).toBe('▶ 실행');
    expect(run.getAttribute('aria-label')).toBeNull();
    expect(iconOf(run)).toBe(commandIcon('run'));
    expect(btn('❚❚ 일시정지').textContent?.trim()).toBe('❚❚ 일시정지');
    expect(btn('재개').textContent?.trim()).toBe('재개');
    expect(btn('+0.1s').textContent?.trim()).toBe('+0.1s');
    expect(btn('⟲ 초기화').textContent?.trim()).toBe('⟲ 초기화');
    expect(btn('끝까지').textContent?.trim()).toBe('끝까지');
    expect(btn('❚❚ 일시정지').disabled).toBe(true);
    expect(btn('❚❚ 일시정지').querySelector('svg')!.getAttribute('stroke')).toBe('currentColor');

    for (const icon of el.querySelectorAll('.ecd-icon')) {
      expect(icon.getAttribute('aria-hidden')).toBe('true');
      const host = icon.closest('button, [role="option"], summary');
      if (!host) continue;
      const name = host.getAttribute('aria-label') || host.textContent?.replace(/\s+/g, ' ').trim();
      expect(name, icon.getAttribute('data-icon') ?? '').toBeTruthy();
    }

    await act(async () => { btn('명령 찾기').click(); });
    const palette = el.querySelector('[role="dialog"][aria-label="명령 찾기"]')!;
    const row = (id: string) => palette.querySelector(`[data-command="${id}"]`);
    expect(iconOf(row('save'))).toBe(iconOf(btn('저장')));
    expect(iconOf(row('undo'))).toBe(iconOf(btn('실행 취소')));
    expect(iconOf(row('run'))).toBe(iconOf(btn('▶ 실행')));
    expect(iconOf(row('palette'))).toBe(iconOf(btn('명령 찾기')));
    expect(row('copy')!.textContent).toContain('복사');
    const dim = palette.querySelector('.cmd-row.is-dim')!;
    expect(dim.querySelector('.ecd-icon')).not.toBeNull();
  });
});
