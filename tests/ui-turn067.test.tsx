// @vitest-environment jsdom
// TURN-067 undo history list.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { History } from '../src/model/history';
import type { Project } from '../src/model/types';
import { App } from '../src/ui/App';
import { PALETTE_LABEL } from '../src/ui/CommandPalette';
import { visibleCommands, blankCommandState } from '../src/ui/commandModel';
import { buildSampleProject } from '../src/model/sample';
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
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim() === label || b.getAttribute('aria-label') === label) as HTMLButtonElement | undefined;
  const list = () => el.querySelector('[role="dialog"][aria-label="실행 취소 이력"]');
  const rows = () => [...(list()?.querySelectorAll<HTMLButtonElement>('.hist-row') ?? [])];
  const openList = async () => {
    if (!list()) await click(btn('실행 취소 이력'));
  };
  return { el, click, btn, list, rows, openList, history: () => seen.h! };
}

describe('TURN-067 history list UI', () => {
  it('AC1 AC2 AC3 AC4 shows names and rev, jumps, and drops the redo side after a new edit', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    await u.click(u.el.querySelector('.stepper [data-stepid="sequence"]'));
    await u.click(u.btn('신호 기다림 추가'));
    await u.click(u.btn('Substation 시퀀스 넣기'));
    const latest = structuredClone(u.history().present) as Project;
    expect(u.btn('실행 취소')!.title).toBe('실행 취소: Substation 시퀀스 넣기 (Ctrl/Cmd+Z)');
    await u.click(u.btn('실행 취소'));
    const middle = structuredClone(u.history().present) as Project;
    expect(u.btn('다시 실행')!.title).toBe('다시 실행: Substation 시퀀스 넣기 (Ctrl/Cmd+Shift+Z)');
    expect(u.btn('실행 취소')!.title).toBe('실행 취소: 신호 기다림 추가 (Ctrl/Cmd+Z)');

    await u.openList();
    const shown = u.rows().map((row) => ({
      label: row.getAttribute('data-history-label'),
      rev: row.getAttribute('data-history-rev'),
      place: row.getAttribute('data-history-place'),
    }));
    expect(shown.map((row) => row.rev).map(Number)).toEqual([latest.revision, middle.revision, middle.revision - 1]);
    expect(shown).toEqual([
      { label: 'Substation 시퀀스 넣기', rev: String(latest.revision), place: 'future' },
      { label: '신호 기다림 추가', rev: String(middle.revision), place: 'current' },
      { label: '처음', rev: String(middle.revision - 1), place: 'past' },
    ]);
    expect(u.rows()[1].getAttribute('aria-current')).toBe('true');
    expect(u.rows()[1].textContent).toContain('지금');
    expect(u.rows()[0].classList.contains('is-future')).toBe(true);

    await u.click(u.rows()[0]);
    expect(u.list()).toBeTruthy();
    expect(u.history().present).toEqual(latest);
    await u.click(u.rows().find((row) => row.getAttribute('data-history-place') === 'past' && row.getAttribute('data-history-label') === '신호 기다림 추가')!);
    expect(u.history().present).toEqual(middle);
    await u.click(u.rows()[0]);
    expect(u.history().present).toEqual(latest);

    await u.click(u.btn('실행 취소'));
    await u.click(u.btn('신호 기다림 추가'));
    await u.openList();
    expect(u.rows().some((row) => row.getAttribute('data-history-label') === 'Substation 시퀀스 넣기')).toBe(false);
    expect(u.rows().some((row) => row.getAttribute('data-history-place') === 'future')).toBe(false);
    expect(u.rows()[0].getAttribute('data-history-label')).toBe('신호 기다림 추가');
    expect(u.rows()[0].getAttribute('aria-current')).toBe('true');
  });

  it('AC5 keeps the list visible while running and blocks the move', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]'));
    await u.click(u.el.querySelector('#layout-tab-diagram'));
    await u.click(u.el.querySelector('[data-tree-id="PSH-01"]'));
    await u.click(u.btn('복제', u.el.querySelector('.diagram-tools')!));
    expect(u.history().labels[u.history().labels.length - 1]).toBe('Device 복제');
    const rev = u.history().present.revision;
    const clock = holdRuntimeClock();
    try {
      await u.click(u.el.querySelector('.stepper [data-stepid="run"]'));
      await u.click(u.btn('▶ 실행'));
      expect(u.btn('❚❚ 일시정지')!.disabled).toBe(false);
      await u.openList();
      expect(u.list()?.textContent).toContain('Device 복제');
      expect(u.list()?.textContent).toContain('실행 중에는 Undo가 차단됩니다');
      for (const row of u.rows()) expect(row.disabled).toBe(true);
      await u.click(u.rows()[0]);
      expect(u.history().present.revision).toBe(rev);
      expect(u.list()).toBeTruthy();
    } finally { clock.restore(); }
  });

  it('AC6 keeps a separate list on each project tab', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    await u.click(u.el.querySelector('.stepper [data-stepid="sequence"]'));
    await u.click(u.btn('신호 기다림 추가'));
    await u.openList();
    expect(u.rows().some((row) => row.getAttribute('data-history-label') === '신호 기다림 추가')).toBe(true);
    await u.click(u.el.querySelector('[aria-label="프로젝트 추가"]'));
    await u.click(u.btn('빈 프로젝트'));
    await u.openList();
    expect(u.rows().map((row) => row.getAttribute('data-history-label'))).toEqual(['처음']);
    await u.click(u.el.querySelector('[data-project-id="prj-sample-5step"]'));
    await u.openList();
    expect(u.rows().some((row) => row.getAttribute('data-history-label') === '신호 기다림 추가')).toBe(true);
    expect(u.history().labels).toEqual(['신호 기다림 추가']);
  });

  it('opens the list from the command finder', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    const state = blankCommandState(buildSampleProject(), { locked: true, canUndo: true });
    expect(visibleCommands(state, '실행 취소 이력').find((row) => row.id === 'undo-history')!.ok).toBe(true);
    await u.click(u.btn(PALETTE_LABEL));
    const row = u.el.querySelector('[data-command="undo-history"]') as HTMLButtonElement;
    expect(row.textContent).toContain('실행 취소 이력');
    await u.click(row);
    expect(u.el.querySelector(`[role="dialog"][aria-label="${PALETTE_LABEL}"]`)).toBeNull();
    expect(u.list()).toBeTruthy();
  });
});
