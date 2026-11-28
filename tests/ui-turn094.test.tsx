// @vitest-environment jsdom
// TURN-094: named save points. Create leaves the model alone. Restore is one undo.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { History } from '../src/model/history';
import { serializeProject } from '../src/storage/fileFormat';
import { PROJECT_KEY } from '../src/storage/localStore';
import { SAVEPOINTS_KEY, SAVE_POINT_LIMIT, createSavePoint } from '../src/storage/savePoints';
import { PALETTE_LABEL } from '../src/ui/CommandPalette';
import { COMMANDS } from '../src/ui/commandModel';
import { formatLocalClock } from '../src/ui/localClock';
import { App } from '../src/ui/App';

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
  const click = async (node: Element | null | undefined) => {
    if (!node) throw new Error('missing control');
    await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  };
  const type = async (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    await act(async () => {
      const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim() === label || b.getAttribute('aria-label') === label) as HTMLButtonElement;
  const save = () => click(el.querySelector('.header button.btn-main.primary'));
  const openDiag = async () => {
    if (el.querySelector('.app')!.classList.contains('is-home')) await click(btn('시작하기'));
    await click(el.querySelector('[data-stepid="check"] button.st-go'));
    await click(btn('진단·저장·AML'));
  };
  const dialog = (label: string) => [...el.querySelectorAll<HTMLElement>('[role=dialog], [role=alertdialog]')].find((d) => d.getAttribute('aria-label') === label || d.querySelector('h3')?.textContent === label);
  return { el, click, type, btn, save, openDiag, dialog, history: () => seen.h! };
}

describe('TURN-094 save point screen', () => {
  it('AC1 creating a point lists the name, local time, and rev without touching the model', async () => {
    expect(COMMANDS.some((c) => c.id === 'save-point' && c.name === '저장 지점 만들기')).toBe(true);
    const u = await mount();
    await u.save();
    const rev = u.history().present.revision;
    const undo = u.history().past.length;
    const name = u.history().present.name;
    await u.click(u.btn(PALETTE_LABEL));
    const search = u.el.querySelector('[aria-label="명령 검색"]') as HTMLInputElement;
    await u.type(search, '저장 지점');
    await u.click(u.el.querySelector('[data-command="save-point"]'));
    const dlg = u.dialog('저장 지점 만들기')!;
    expect(dlg).toBeTruthy();
    expect(u.el.querySelector('.app')!.getAttribute('data-step')).toBe('check');
    await u.type(dlg.querySelector('[aria-label="저장 지점 이름"]') as HTMLInputElement, '출하 전');
    await u.type(dlg.querySelector('[aria-label="저장 지점 메모"]') as HTMLTextAreaElement, '포장기 전');
    await u.click(u.btn('만들기', dlg));
    expect(u.dialog('저장 지점 만들기')).toBeUndefined();
    const row = u.el.querySelector('[data-save-point]')!;
    expect(row.querySelector('[data-save-point-name]')!.textContent).toBe('출하 전');
    expect(row.querySelector('[data-save-point-note]')!.textContent).toBe('포장기 전');
    expect(row.querySelector('[data-save-point-rev]')!.textContent).toBe(`rev ${rev}`);
    const clock = row.querySelector('time')!;
    expect(clock.textContent).toBe(formatLocalClock(clock.getAttribute('dateTime')));
    expect(clock.getAttribute('title')).toBe(clock.getAttribute('dateTime'));
    expect(u.history().present.revision).toBe(rev);
    expect(u.history().past.length).toBe(undo);
    expect(u.history().present.name).toBe(name);
    expect(u.el.querySelector('[data-save-points]')!.getAttribute('data-save-point-count')).toBe('1');
  });

  it('AC2 차이 보기 lists the save point against now in the same rows', async () => {
    const u = await mount();
    await u.save();
    await u.openDiag();
    await u.click(u.btn('저장 지점 만들기'));
    const dlg = u.dialog('저장 지점 만들기')!;
    await u.type(dlg.querySelector('input') as HTMLInputElement, '이름 전');
    await u.click(u.btn('만들기', dlg));
    const rev = u.history().present.revision;
    const undo = u.history().past.length;
    await u.click(u.btn(`${u.history().present.name} 프로젝트 상세`));
    await u.click(u.btn(`${u.history().present.name} 이름 변경`));
    const rename = [...u.el.querySelectorAll<HTMLElement>('[role=dialog]')].find((d) => d.querySelector('input') && d.getAttribute('aria-label') !== '저장 지점 만들기')!;
    await u.type(rename.querySelector('input') as HTMLInputElement, '이름만 바꿈');
    await u.click(u.btn('이름 변경', rename));
    await u.openDiag();
    await u.click(u.btn('이름 전 차이 보기'));
    const summary = u.el.querySelector('[data-save-point-diff] [data-diff-summary]')!;
    expect(summary.textContent).toBe('추가 0 · 삭제 0 · 바뀜 1');
    const changed = u.el.querySelector('[data-save-point-diff] [data-diff-field="이름"]')!;
    expect(changed.getAttribute('data-diff-change')).toBe('changed');
    expect(changed.querySelector('[data-diff-after]')!.textContent).toContain('이름만 바꿈');
    expect(u.el.querySelector('[data-save-point-diff] [data-diff-list]')).toBeTruthy();
    expect(u.history().present.revision).toBe(rev + 1);
    expect(u.history().past.length).toBe(undo + 1);
  });

  it('AC3 사본으로 열기 opens a new id and leaves the original project', async () => {
    const u = await mount();
    await u.save();
    await u.openDiag();
    const originalId = u.history().present.id;
    const originalName = u.history().present.name;
    const deviceId = u.history().present.devices[0].id;
    await u.click(u.btn('저장 지점 만들기'));
    const dlg = u.dialog('저장 지점 만들기')!;
    await u.type(dlg.querySelector('input') as HTMLInputElement, '사본 원본');
    await u.click(u.btn('만들기', dlg));
    await u.click(u.btn(`${originalName} 프로젝트 상세`));
    await u.click(u.btn(`${originalName} 이름 변경`));
    const rename = [...u.el.querySelectorAll<HTMLElement>('[role=dialog]')].find((d) => (d.getAttribute('aria-label') ?? '').includes('프로젝트 이름'))!;
    await u.type(rename.querySelector('input') as HTMLInputElement, '원본은 유지');
    await u.click(u.btn('이름 변경', rename));
    const rev = u.history().present.revision;
    const undo = u.history().past.length;
    await u.openDiag();
    await u.click(u.btn('사본 원본 사본으로 열기'));
    expect(u.history().present.id).not.toBe(originalId);
    expect(u.history().present.name).toBe(originalName);
    expect(u.history().present.devices.some((d) => d.id === deviceId)).toBe(true);
    expect(u.history().past.length).toBe(0);
    expect(localStorage.getItem(PROJECT_KEY(u.history().present.id))).toBeNull();
    await u.click(u.el.querySelector(`[data-project-id="${originalId}"] .nm`));
    expect(u.history().present.id).toBe(originalId);
    expect(u.history().present.name).toBe('원본은 유지');
    expect(u.history().present.revision).toBe(rev);
    expect(u.history().past.length).toBe(undo);
    expect(u.el.querySelector('[data-save-point-name]')!.textContent).toBe('사본 원본');
  });

  it('AC4 restore confirms the change count, then one undo returns', async () => {
    const u = await mount();
    await u.save();
    await u.openDiag();
    const savedName = u.history().present.name;
    await u.click(u.btn('저장 지점 만들기'));
    const dlg = u.dialog('저장 지점 만들기')!;
    await u.type(dlg.querySelector('input') as HTMLInputElement, '되돌릴 곳');
    await u.click(u.btn('만들기', dlg));
    await u.click(u.btn(`${savedName} 프로젝트 상세`));
    await u.click(u.btn(`${savedName} 이름 변경`));
    const rename = [...u.el.querySelectorAll<HTMLElement>('[role=dialog]')].find((d) => (d.getAttribute('aria-label') ?? '').includes('프로젝트 이름'))!;
    await u.type(rename.querySelector('input') as HTMLInputElement, '잠깐 바꾼 이름');
    await u.click(u.btn('이름 변경', rename));
    const rev = u.history().present.revision;
    const undo = u.history().past.length;
    await u.openDiag();
    await u.click(u.btn('되돌릴 곳 이 지점으로 되돌리기'));
    const ask = u.el.querySelector('[data-save-point-restore]')!;
    expect(Number(ask.getAttribute('data-change-count'))).toBeGreaterThan(0);
    expect(ask.textContent).toContain('바뀌는 항목');
    expect(ask.textContent).toContain('실행 취소 한 번');
    expect(u.history().present.name).toBe('잠깐 바꾼 이름');
    await u.click(u.el.querySelector('[data-save-point-restore-cancel]'));
    expect(u.history().present.name).toBe('잠깐 바꾼 이름');
    expect(u.history().present.revision).toBe(rev);
    await u.click(u.btn('되돌릴 곳 이 지점으로 되돌리기'));
    await u.click(u.el.querySelector('[data-save-point-restore-confirm]'));
    expect(u.history().present.name).toBe(savedName);
    expect(u.history().present.revision).toBe(rev + 1);
    expect(u.history().past.length).toBe(undo + 1);
    expect(u.history().labels[u.history().labels.length - 1]).toBe('저장 지점으로 되돌리기');
    await u.click(u.el.querySelector('[aria-label="실행 취소"]'));
    expect(u.history().present.name).toBe('잠깐 바꾼 이름');
    expect(u.history().present.revision).toBe(rev);
    expect(u.history().past.length).toBe(undo);
  });

  it('AC5 the 21st asks before dropping the oldest, and a full store refuses the write', async () => {
    const u = await mount();
    await u.save();
    const project = u.history().present;
    for (let i = 0; i < SAVE_POINT_LIMIT; i++) {
      const written = createSavePoint(localStorage, project, `오래된 ${String(i).padStart(2, '0')}`, '', new Date(Date.UTC(2026, 0, i + 1)), { id: `sp${i}` });
      expect(written.ok, written.ok ? '' : written.reason).toBe(true);
    }
    await u.openDiag();
    expect(u.el.querySelectorAll('[data-save-point]')).toHaveLength(20);
    expect(u.el.querySelector('[data-save-point-name]')!.textContent).toBe('오래된 19');
    await u.click(u.btn('저장 지점 만들기'));
    const dlg = u.dialog('저장 지점 만들기')!;
    await u.type(dlg.querySelector('input') as HTMLInputElement, '스물하나');
    await u.click(u.btn('만들기', dlg));
    const ask = u.el.querySelector('[data-save-point-drop]')!;
    expect(ask.textContent).toContain('오래된 00');
    await u.click(u.el.querySelector('[data-save-point-drop-cancel]'));
    expect(u.el.querySelectorAll('[data-save-point]')).toHaveLength(20);
    expect(localStorage.getItem(SAVEPOINTS_KEY(project.id))).toContain('sp0');
    await u.click(u.btn('만들기', u.dialog('저장 지점 만들기')!));
    await u.click(u.el.querySelector('[data-save-point-drop-confirm]'));
    expect(u.el.querySelector('[data-save-point-name]')!.textContent).toBe('스물하나');
    expect(u.el.querySelectorAll('[data-save-point]')).toHaveLength(20);
    expect(localStorage.getItem(SAVEPOINTS_KEY(project.id))).not.toContain('"id":"sp0"');
    expect(u.history().present.revision).toBe(project.revision);

    await u.click(u.btn('저장 지점 만들기'));
    const again = u.dialog('저장 지점 만들기')!;
    await u.type(again.querySelector('input') as HTMLInputElement, '거절');
    await u.click(u.btn('만들기', again));
    expect(u.el.querySelector('[data-save-point-drop]')!.textContent).toContain('오래된 01');
    const orig = Storage.prototype.setItem;
    let thrown = false;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (!thrown && String(key).startsWith('ecd.v1.savepoints.')) {
        thrown = true;
        throw new DOMException('quota', 'QuotaExceededError');
      }
      return orig.call(this, key, value);
    };
    try {
      await u.click(u.el.querySelector('[data-save-point-drop-confirm]'));
      const err = u.el.querySelector('[data-save-point-error]');
      expect(err).toBeTruthy();
      expect(err!.textContent).toContain('원래 상태로 되돌렸습니다');
      expect(u.history().present.revision).toBe(project.revision);
      expect(localStorage.getItem(SAVEPOINTS_KEY(project.id))).toContain('스물하나');
      expect(localStorage.getItem(SAVEPOINTS_KEY(project.id))).not.toContain('거절');
    } finally {
      Storage.prototype.setItem = orig;
    }
  });

  it('AC7 deleting a project shows the save-point count and removes them', async () => {
    const u = await mount();
    await u.save();
    const id = u.history().present.id;
    const name = u.history().present.name;
    const saved = localStorage.getItem(PROJECT_KEY(id));
    await u.openDiag();
    await u.click(u.btn('저장 지점 만들기'));
    const dlg = u.dialog('저장 지점 만들기')!;
    await u.type(dlg.querySelector('input') as HTMLInputElement, '같이 지워질 것');
    await u.click(u.btn('만들기', dlg));
    await u.click(u.el.querySelector(`[data-project-id="${id}"] button`));
    await u.click(u.el.querySelector(`[aria-label="${name} 닫기"]`));
    await u.click(u.el.querySelector(`[data-project-id="${id}"] button`));
    await u.click(u.el.querySelector(`[aria-label="${name} 영구 삭제"]`));
    const modal = [...u.el.querySelectorAll<HTMLElement>('[role=alertdialog]')].find((d) => d.textContent?.includes('영구 삭제'))!;
    expect(modal.querySelector('[data-save-point-count]')!.getAttribute('data-save-point-count')).toBe('1');
    expect(modal.textContent).toContain('저장 지점 1개');
    await u.click(u.btn('취소', modal));
    expect(localStorage.getItem(SAVEPOINTS_KEY(id))).toBeTruthy();
    expect(localStorage.getItem(PROJECT_KEY(id))).toBe(saved);
    await u.click(u.el.querySelector(`[data-project-id="${id}"] button`));
    await u.click(u.el.querySelector(`[aria-label="${name} 영구 삭제"]`));
    const again = [...u.el.querySelectorAll<HTMLElement>('[role=alertdialog]')].find((d) => d.textContent?.includes('영구 삭제'))!;
    await u.click(u.btn('영구 삭제', again));
    expect(localStorage.getItem(SAVEPOINTS_KEY(id))).toBeNull();
    expect(localStorage.getItem(PROJECT_KEY(id))).toBeNull();
    expect(serializeProject(u.history().present)).not.toContain('같이 지워질 것');
  });
});
