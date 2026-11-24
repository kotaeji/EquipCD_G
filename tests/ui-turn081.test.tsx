// @vitest-environment jsdom
// TURN-081: saved-vs-now list, jump, recovery diff, and read-only file compare.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { History } from '../src/model/history';
import { buildSampleProject } from '../src/model/sample';
import { serializeProject } from '../src/storage/fileFormat';
import { DRAFT_DELAY_MS } from '../src/storage/drafts';
import { saveProject } from '../src/storage/localStore';
import { App } from '../src/ui/App';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  vi.useRealTimers();
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
  const type = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
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
  return { el, click, type, btn, save, openDiag, history: () => seen.h! };
}

async function pickFile(input: HTMLInputElement, text: string, name: string) {
  const file = new File([text], name, { type: 'application/json' });
  await act(async () => {
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
  });
}

describe('TURN-081 diff view', () => {
  it('AC3 an unchanged save says it matches, and saving again clears the list', async () => {
    const u = await mount();
    await u.save();
    await u.openDiag();
    expect(u.el.querySelector('[data-diff-same]')!.textContent).toBe('저장본과 같습니다');
    expect(u.el.querySelector('[data-diff-list]')).toBeNull();
    await u.click(u.btn(`${u.history().present.name} 프로젝트 상세`));
    await u.click(u.btn(`${u.history().present.name} 이름 변경`));
    const dlg = [...u.el.querySelectorAll<HTMLElement>('[role=dialog]')].find((d) => d.querySelector('input'))!;
    await u.type(dlg.querySelector('input') as HTMLInputElement, '이름만 바꿈');
    await u.click(u.btn('이름 변경', dlg));
    await u.openDiag();
    const summary = u.el.querySelector('[data-diff-summary]')!;
    expect(summary.textContent).toBe('추가 0 · 삭제 0 · 바뀜 1');
    expect(u.el.querySelector('[data-diff-same]')).toBeNull();
    expect(u.el.querySelector('[data-diff-field="이름"]')!.textContent).toContain('이름만 바꿈');
    await u.save();
    expect(u.el.querySelector('[data-diff-same]')!.textContent).toBe('저장본과 같습니다');
    expect(u.el.querySelector('[data-diff-list]')).toBeNull();
    expect(u.el.querySelector('[data-diff-summary]')).toBeNull();
  });

  it('AC4 이동 opens the changed action and a deleted device has no 이동', async () => {
    const u = await mount();
    await u.save();
    await u.click(u.btn('시작하기'));
    await u.click(u.el.querySelector('[data-stepid="canvas"] button.st-go'));
    await u.click(u.el.querySelector('[data-tree-id="PSH-01"]'));
    await u.click(u.btn('Action 편집'));
    const duration = u.el.querySelector('[data-jump^="duration:"] input') as HTMLInputElement;
    const actionId = (duration.closest('[data-jump]') as HTMLElement).getAttribute('data-jump')!.slice('duration:'.length);
    await u.type(duration, '9.5');
    const live = u.el.querySelector(`[data-jump="duration:${actionId}"] input`) as HTMLInputElement;
    await act(async () => { live.focus(); live.blur(); });
    await u.click(u.el.querySelector('[data-stepid="canvas"] button.st-go'));
    await u.click(u.el.querySelector('[data-tree-id="CNV-05"]'));
    await u.click(u.btn('삭제 영향 확인'));
    await u.click(u.btn('참조 해제 후 삭제'));
    const rev = u.history().present.revision;
    const undo = u.history().past.length;
    await u.openDiag();
    const changed = u.el.querySelector(`[data-diff-id="${actionId}"][data-diff-field="동작 시간"]`)!;
    expect(changed.getAttribute('data-diff-change')).toBe('changed');
    expect(changed.querySelector('[data-diff-after]')!.textContent).toContain('9.5 s');
    expect(changed.querySelector('button')!.textContent).toBe('이동');
    const removed = u.el.querySelector('[data-diff-id="CNV-05"][data-diff-change="removed"]')!;
    expect(removed.querySelector('button')).toBeNull();
    expect(removed.textContent).not.toContain('이동');
    await u.click(changed.querySelector('button'));
    expect(u.el.querySelector('.app')!.getAttribute('data-step')).toBe('attributes');
    expect(u.el.querySelector(`[data-jump="duration:${actionId}"]`)).toBeTruthy();
    expect(u.history().present.revision).toBe(rev);
    expect(u.history().past.length).toBe(undo);
  });

  it('AC5 the recovery window shows the draft against the saved copy before choosing', async () => {
    vi.useFakeTimers();
    const u = await mount();
    await u.save();
    const savedName = u.history().present.name;
    await u.click(u.btn(`${savedName} 프로젝트 상세`));
    await u.click(u.btn(`${savedName} 이름 변경`));
    const dlg = [...u.el.querySelectorAll<HTMLElement>('[role=dialog]')].find((d) => d.querySelector('input'))!;
    await u.type(dlg.querySelector('input') as HTMLInputElement, '임시 이름');
    await u.click(u.btn('이름 변경', dlg));
    await act(async () => { await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS); });
    await act(async () => { root!.unmount(); });
    root = createRoot(u.el);
    await act(async () => { root!.render(<App onHistory={() => {}} />); });
    const modal = u.el.querySelector('.modal')!;
    expect(modal.textContent).toContain('저장 안 된 변경이 있습니다');
    expect(modal.querySelector('[data-draft-diff]')).toBeTruthy();
    expect(modal.querySelector('[data-diff-summary]')).toBeNull();
    await u.click(u.btn('차이 보기', modal));
    const summary = modal.querySelector('[data-diff-summary]')!;
    expect(summary.textContent).toContain('바뀜 1');
    const row = modal.querySelector('[data-diff-field="이름"]')!;
    expect(row.querySelector('[data-diff-before]')!.textContent).toContain(savedName);
    expect(row.querySelector('[data-diff-after]')!.textContent).toContain('임시 이름');
    expect(modal.textContent).toContain('앞은 저장본, 뒤는 임시 저장입니다.');
    expect(u.btn('복구', modal)).toBeTruthy();
    expect(u.btn('버리기', modal)).toBeTruthy();
  });

  it('AC6 a broken file is refused and a real file or project does not change rev or undo', async () => {
    const u = await mount();
    await u.save();
    const other = structuredClone(u.history().present);
    other.id = 'prj-other-081';
    other.name = '다른 설계';
    expect(saveProject(localStorage, other).ok).toBe(true);
    await u.openDiag();
    const rev = u.history().present.revision;
    const undo = u.history().past.length;
    const future = u.history().future.length;
    const input = u.el.querySelector('[data-diff-file]') as HTMLInputElement;
    await pickFile(input, '{', 'broken.json');
    expect(u.el.querySelector('[data-diff-error]')!.textContent).toContain('JSON');
    expect(u.history().present.revision).toBe(rev);
    expect(u.history().past.length).toBe(undo);
    expect(u.history().future.length).toBe(future);
    expect(u.el.querySelector('[data-diff-summary]')).toBeNull();

    const fileProject = structuredClone(buildSampleProject());
    fileProject.name = '파일에서 온 이름';
    await pickFile(input, serializeProject(fileProject), 'other.ecd.json');
    expect(u.el.querySelector('[data-diff-error]')).toBeNull();
    expect(u.el.querySelector('[data-diff-mode]')!.getAttribute('data-diff-mode')).toBe('file');
    expect(u.el.querySelector('[data-project-diff]')!.textContent).toContain('파일 other.ecd.json과 지금');
    expect(u.el.querySelector('[data-diff-field="이름"] [data-diff-after]')!.textContent).toContain(u.history().present.name);
    expect(u.history().present.name).not.toBe('파일에서 온 이름');
    expect(u.history().present.revision).toBe(rev);
    expect(u.history().past.length).toBe(undo);

    const select = u.el.querySelector('[data-diff-project]') as HTMLSelectElement;
    expect([...select.options].some((o) => o.value === 'prj-other-081')).toBe(true);
    await act(async () => {
      select.value = 'prj-other-081';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(u.el.querySelector('[data-diff-mode]')!.getAttribute('data-diff-mode')).toBe('project');
    expect(u.el.querySelector('[data-project-diff]')!.textContent).toContain('다른 설계');
    expect(u.el.querySelector('[data-diff-summary]')).toBeTruthy();
    expect(u.history().present.revision).toBe(rev);
    expect(u.history().past.length).toBe(undo);
    expect(u.history().future.length).toBe(future);
    await u.click(u.btn('저장본'));
    expect(u.el.querySelector('[data-diff-same]')!.textContent).toBe('저장본과 같습니다');
  });
});
