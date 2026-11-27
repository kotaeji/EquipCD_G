// @vitest-environment jsdom
// TURN-047: autosave draft, recovery prompt, unsaved-work list, view toggle.
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { History } from '../src/model/history';
import { DRAFT_DELAY_MS, DRAFTS_KEY, DRAFT_KEY } from '../src/storage/drafts';
import { INDEX_KEY, PROJECT_KEY } from '../src/storage/localStore';
import { App } from '../src/ui/App';
import { loadView } from '../src/ui/viewSettings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  vi.useRealTimers();
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  localStorage.clear();
});

async function mount(opts?: { fresh?: boolean }) {
  if (opts?.fresh !== false) localStorage.clear();
  const el = document.createElement('div');
  document.body.appendChild(el);
  const seen: { h: History | null } = { h: null };
  root = createRoot(el);
  await act(async () => { root!.render(<App onHistory={(h) => { seen.h = h; }} />); });
  const click = async (node: Element | null | undefined) => {
    if (!node) throw new Error('missing control');
    await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  };
  const type = async (inp: HTMLInputElement, v: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(inp, v);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label || b.getAttribute('aria-label') === label) as HTMLButtonElement;
  const chip = () => el.querySelector('.save-chip')!;
  const bar = () => el.querySelector('.workbar')!;
  const modal = () => el.querySelector('.modal');
  const save = () => click(el.querySelector('.header button.btn-main.primary'));
  const rename = async (name: string) => {
    const current = seen.h!.present.name;
    await click(btn(`${current} 프로젝트 상세`));
    await click(btn(`${current} 이름 변경`));
    const dlg = [...el.querySelectorAll<HTMLElement>('[role=dialog]')].find((d) => d.querySelector('input'))!;
    await type(dlg.querySelector('input') as HTMLInputElement, name);
    await click(btn('이름 변경', dlg));
  };
  const remount = async () => {
    await act(async () => { root!.unmount(); });
    root = createRoot(el);
    await act(async () => { root!.render(<App onHistory={(h) => { seen.h = h; }} />); });
  };
  return { el, click, type, btn, chip, bar, modal, save, rename, remount, history: () => seen.h! };
}

const draftKeys = () => Object.keys(localStorage).filter((k) => k.startsWith('ecd.v1.draft.')).sort();
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
/** jsdom ignores assigning localStorage.setItem. Stub the prototype. */
function stubSetItem(fn: (key: string, value: string, orig: (key: string, value: string) => void) => void) {
  const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key: string, value: string) {
    fn(String(key), String(value), (k, v) => orig.call(this, k, v));
  };
  return () => { Storage.prototype.setItem = orig; };
}

describe('TURN-047 autosave and recovery', () => {
  it('AC1 AC2 AC11 AC12 an edit drafts once, and the saved list and unsaved mark stay', async () => {
    vi.useFakeTimers();
    const u = await mount();
    await u.save();
    const index = localStorage.getItem(INDEX_KEY);
    const body = localStorage.getItem(PROJECT_KEY(u.history().present.id));
    const rev = u.history().present.revision;
    let writes = 0;
    const restore = stubSetItem((k, v, orig) => { if (k.startsWith('ecd.v1.draft.')) writes += 1; orig(k, v); });
    try {
    await u.rename('한 번');
    const undo = u.history().past.length;
    await advance(DRAFT_DELAY_MS - 1000);
    expect(writes).toBe(0);
    expect(draftKeys()).toEqual([]);
    await u.rename('두 번');
    await advance(DRAFT_DELAY_MS - 1000);
    expect(draftKeys()).toEqual([]);
    expect(writes).toBe(0);
    await advance(1000);
    expect(writes).toBe(1);
    expect(u.history().past.length).toBe(undo + 1);
    expect(u.history().present.revision).toBe(rev + 2);
    expect(u.chip().textContent).toBe('● 저장 안 됨');
    expect(localStorage.getItem(INDEX_KEY)).toBe(index);
    expect(localStorage.getItem(PROJECT_KEY(u.history().present.id))).toBe(body);
    expect(JSON.parse(localStorage.getItem(INDEX_KEY)! )[0].revision).toBe(rev);
    const line = u.bar().querySelector('.work-times')!.textContent ?? '';
    expect(line).toMatch(/^저장 \d{4}-\d{2}-\d{2} \d{2}:\d{2} \(UTC(?:[+-]\d{1,2}(?::\d{2})?)?\) · 임시 저장 \d{4}-\d{2}-\d{2} \d{2}:\d{2} \(UTC(?:[+-]\d{1,2}(?::\d{2})?)?\)$/);
    expect(u.bar().querySelector('.work-times')!.getAttribute('title')).toMatch(/^저장 \d{4}-\d{2}-\d{2}T.+Z · 임시 저장 \d{4}-\d{2}-\d{2}T.+Z$/);
    expect(line).not.toMatch(/\n/);
    expect(readFileSync('src/ui/styles.css', 'utf8')).toMatch(/\.work-times \{ white-space: nowrap/);
    expect(readFileSync('src/ui/styles.css', 'utf8')).toMatch(/\.app > \.workbar \{[^}]*flex-wrap: nowrap/);
    } finally { restore(); }
  });

  it('AC3 recover opens the draft unsaved with an empty undo stack; discard keeps the save and deletes the draft', async () => {
    vi.useFakeTimers();
    const u = await mount();
    const original = u.history().present.name;
    await u.save();
    const id = u.history().present.id;
    const body = localStorage.getItem(PROJECT_KEY(id));
    const index = localStorage.getItem(INDEX_KEY);
    await u.rename('복구할 이름');
    await advance(DRAFT_DELAY_MS);
    expect(localStorage.getItem(PROJECT_KEY(id))).toBe(body);
    await u.remount();
    const dlg = u.modal();
    expect(dlg?.textContent).toContain('저장 안 된 변경이 있습니다');
    expect(dlg?.textContent).toMatch(/임시 저장 \d{4}-\d{2}-\d{2} \d{2}:\d{2} \(UTC/);
    expect(dlg?.querySelector('time')?.getAttribute('title')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(dlg?.textContent).toContain(`rev ${JSON.parse(localStorage.getItem(DRAFTS_KEY)!)[0].revision}`);
    await u.click(u.btn('복구', dlg!));
    expect(u.history().present.name).toBe('복구할 이름');
    expect(u.history().past).toEqual([]);
    expect(u.history().future).toEqual([]);
    expect(u.chip().textContent).toBe('● 저장 안 됨');
    expect(localStorage.getItem(PROJECT_KEY(id))).toBe(body);
    expect(localStorage.getItem(INDEX_KEY)).toBe(index);

    await u.remount();
    await u.click(u.btn('버리기', u.modal()!));
    expect(u.history().present.name).toBe(original);
    expect(draftKeys()).toEqual([]);
    await u.remount();
    expect(u.modal()).toBeNull();
    expect(u.history().present.name).toBe(original);
  });

  it('AC4 a never-saved draft is listed above recent projects and can be opened or discarded', async () => {
    vi.useFakeTimers();
    const u = await mount();
    await u.rename('안 저장한 작업');
    await advance(DRAFT_DELAY_MS);
    await u.remount();
    const home = u.el.querySelector('.home-main')!;
    const headings = [...home.querySelectorAll('h2')].map((h) => h.textContent);
    expect(headings.indexOf('저장 안 된 작업')).toBeGreaterThanOrEqual(0);
    expect(headings.indexOf('저장 안 된 작업')).toBeLessThan(headings.indexOf('최근 프로젝트'));
    expect(home.querySelector('[data-unsaved-draft]')!.textContent).toContain('안 저장한 작업');
    await u.click(u.btn('안 저장한 작업 임시 저장 열기'));
    expect(u.history().present.name).toBe('안 저장한 작업');
    expect(u.history().past).toEqual([]);
    expect(u.chip().textContent).toBe('● 저장 안 됨');

    const view = JSON.parse(localStorage.getItem('ecd.v1.userView')!);
    view.home = true;
    localStorage.setItem('ecd.v1.userView', JSON.stringify(view));
    await u.remount();
    await u.click(u.btn('안 저장한 작업 임시 저장 버리기'));
    expect(u.el.querySelector('[data-unsaved-draft]')).toBeNull();
    expect(draftKeys()).toEqual([]);
    expect(u.el.textContent).not.toContain('저장 안 된 작업');
  });

  it('an unsaved draft asks on reopen even when home is false, and stays until answered', async () => {
    vi.useFakeTimers();
    const u = await mount();
    await u.click(u.btn('시작하기'));
    await u.rename('복구될 예제');
    const id = u.history().present.id;
    const rev = u.history().present.revision;
    await advance(DRAFT_DELAY_MS);
    const draftBody = localStorage.getItem(DRAFT_KEY(id));
    const view = JSON.parse(localStorage.getItem('ecd.v1.userView')!);
    view.home = false;
    view.step = 'attributes';
    localStorage.setItem('ecd.v1.userView', JSON.stringify(view));
    await u.remount();
    expect(u.el.querySelector('.app')!.classList.contains('is-home')).toBe(false);
    expect(u.el.querySelector('.app')!.getAttribute('data-step')).toBe('attributes');
    const dlg = u.modal();
    expect(dlg?.textContent).toContain('저장 안 된 변경이 있습니다');
    expect(dlg?.textContent).toContain('저장본은 없습니다');
    expect(dlg?.textContent).toContain(`rev ${rev}`);
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(u.modal()).toBeNull();
    await u.rename('다른 편집');
    await advance(DRAFT_DELAY_MS);
    expect(localStorage.getItem(DRAFT_KEY(id))).toBe(draftBody);
    expect(u.history().present.name).toBe('다른 편집');
    await u.remount();
    await u.click(u.btn('복구', u.modal()!));
    expect(u.history().present.name).toBe('복구될 예제');
    expect(u.history().present.revision).toBe(rev);
    expect(u.history().past).toEqual([]);
    expect(u.chip().textContent).toBe('● 저장 안 됨');
  });

  it('several unsaved drafts are listed, and 나중에 leaves every draft in place', async () => {
    vi.useFakeTimers();
    const u = await mount();
    await u.rename('첫째 작업');
    await advance(DRAFT_DELAY_MS);
    await u.click(u.btn('프로젝트 추가'));
    await u.click(u.btn('5공정 예제'));
    await u.rename('둘째 작업');
    await advance(DRAFT_DELAY_MS);
    const keys = draftKeys();
    const before = Object.fromEntries(keys.map((k) => [k, localStorage.getItem(k)]));
    await u.remount();
    const dlg = u.modal()!;
    expect(dlg.querySelectorAll('[data-recovery-id]')).toHaveLength(2);
    expect(dlg.textContent).toContain('첫째 작업');
    expect(dlg.textContent).toContain('둘째 작업');
    await u.click(u.btn('나중에', dlg));
    expect(u.modal()).toBeNull();
    await u.rename('덮어쓰면 안 됨');
    await advance(DRAFT_DELAY_MS);
    for (const k of keys) expect(localStorage.getItem(k)).toBe(before[k]);
  });

  it('AC5 save, close without saving, and delete each remove the draft', async () => {
    vi.useFakeTimers();
    const u = await mount();
    await u.save();
    const id = u.history().present.id;
    await u.rename('지울 임시');
    await advance(DRAFT_DELAY_MS);
    expect(draftKeys()).toEqual([DRAFT_KEY(id)]);
    await u.save();
    expect(draftKeys()).toEqual([]);
    expect(u.chip().textContent).toBe('저장됨');
    await u.remount();
    expect(u.modal()).toBeNull();

    await u.rename('닫으면 버려짐');
    await advance(DRAFT_DELAY_MS);
    expect(draftKeys()).toEqual([DRAFT_KEY(id)]);
    await u.click(u.btn(`${u.history().present.name} 프로젝트 상세`));
    await u.click(u.btn(`${u.history().present.name} 닫기`));
    await u.click(u.btn('저장하지 않고 닫기'));
    expect(draftKeys()).toEqual([]);

    await u.save();
    const savedId = u.history().present.id;
    const savedName = u.history().present.name;
    await u.click(u.btn('프로젝트 추가'));
    await u.click(u.btn('빈 프로젝트'));
    await u.click(u.btn(`${savedName} 프로젝트 상세`));
    await u.click(u.btn(`${savedName} 닫기`));
    localStorage.setItem(DRAFT_KEY(savedId), localStorage.getItem(PROJECT_KEY(savedId))!);
    localStorage.setItem(DRAFTS_KEY, JSON.stringify([{ id: savedId, name: savedName, savedAt: '2026-11-23T08:00:00.000Z', revision: 99 }]));
    await u.click(u.btn(`${savedName} 프로젝트 상세`));
    await u.click(u.btn(`${savedName} 영구 삭제`));
    await u.click(u.btn('영구 삭제'));
    expect(localStorage.getItem(PROJECT_KEY(savedId))).toBeNull();
    expect(draftKeys()).toEqual([]);
  });

  it('AC6 a draft at the saved revision does not ask', async () => {
    const u = await mount();
    await u.save();
    const id = u.history().present.id;
    const rev = JSON.parse(localStorage.getItem(INDEX_KEY)!)[0].revision as number;
    localStorage.setItem(DRAFT_KEY(id), localStorage.getItem(PROJECT_KEY(id))!);
    localStorage.setItem(DRAFTS_KEY, JSON.stringify([{ id, name: '같음', savedAt: '2099-01-01T00:00:00.000Z', revision: rev }]));
    await u.remount();
    expect(u.modal()).toBeNull();
    expect(u.history().present.name).not.toBe('같음');
  });

  it('AC7 a broken draft is quarantined and the saved project still opens', async () => {
    const u = await mount();
    await u.save();
    const id = u.history().present.id;
    const name = u.history().present.name;
    const body = localStorage.getItem(PROJECT_KEY(id));
    localStorage.setItem(DRAFT_KEY(id), '{broken');
    localStorage.setItem(DRAFTS_KEY, JSON.stringify([{ id, name: '깨진 임시', savedAt: '2099-01-01T00:00:00.000Z', revision: 99 }]));
    await u.remount();
    expect(u.modal()).toBeNull();
    expect(u.el.textContent).not.toContain('복구');
    expect(u.history().present.name).toBe(name);
    expect(localStorage.getItem(PROJECT_KEY(id))).toBe(body);
    expect(localStorage.getItem(DRAFT_KEY(id))).toBeNull();
    const box = JSON.parse(localStorage.getItem('ecd.v1.quarantine')!) as { raw: string; label: string }[];
    expect(box.some((q) => q.raw === '{broken' && q.label === `draft:${id}`)).toBe(true);
  });

  it('AC8 a failed draft write keeps editing and undo, and shows 임시 저장 실패', async () => {
    vi.useFakeTimers();
    const u = await mount();
    const restore = stubSetItem((k, _v, orig) => {
      if (k.startsWith('ecd.v1.draft')) throw new Error('quota');
      orig(k, _v);
    });
    try {
    await u.rename('실패해도 남음');
    const rev = u.history().present.revision;
    const past = u.history().past.length;
    await advance(DRAFT_DELAY_MS);
    expect(u.bar().textContent).toContain('임시 저장 실패');
    expect(u.history().present.revision).toBe(rev);
    expect(u.history().present.name).toBe('실패해도 남음');
    expect(u.history().past.length).toBe(past);
    await u.click(u.el.querySelector('[aria-label="실행 취소"]'));
    expect(u.history().present.name).not.toBe('실패해도 남음');
    expect(u.history().past.length).toBe(past - 1);
    } finally { restore(); }
  });

  it('AC8 memory-only storage shows 임시 저장 실패 and still edits', async () => {
    vi.useFakeTimers();
    const store = window.localStorage;
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
    try {
      const u = await mount({ fresh: false });
      await u.rename('메모리만');
      const rev = u.history().present.revision;
      await advance(DRAFT_DELAY_MS);
      expect(u.bar().textContent).toContain('임시 저장 실패');
      expect(u.history().present.revision).toBe(rev);
      await u.click(u.el.querySelector('[aria-label="실행 취소"]'));
      expect(u.history().present.revision).toBe(rev - 1);
    } finally {
      Object.defineProperty(window, 'localStorage', { configurable: true, value: store });
    }
  });

  it('AC9 a running project does not draft; two tabs draft separately', async () => {
    vi.useFakeTimers();
    const raf = window.requestAnimationFrame;
    window.requestAnimationFrame = () => 0;
    try {
      const u = await mount();
      await u.click(u.el.querySelector('.stepper [data-stepid="run"]'));
      await u.rename('실행 중');
      await u.click(u.btn('▶ 실행'));
      await advance(DRAFT_DELAY_MS + 1000);
      expect(draftKeys()).toEqual([]);
      await u.click(u.btn('⟲ 초기화'));
      await advance(DRAFT_DELAY_MS);
      expect(draftKeys()).toHaveLength(1);

      await u.click(u.btn('프로젝트 추가'));
      await u.click(u.btn('5공정 예제'));
      await u.rename('둘째 탭');
      await advance(DRAFT_DELAY_MS);
      expect(draftKeys()).toHaveLength(2);
      const texts = draftKeys().map((k) => localStorage.getItem(k) ?? '');
      expect(texts.some((t) => t.includes('실행 중'))).toBe(true);
      expect(texts.some((t) => t.includes('둘째 탭'))).toBe(true);
    } finally {
      window.requestAnimationFrame = raf;
    }
  });

  it('AC10 the view setting turns drafts off and is remembered', async () => {
    vi.useFakeTimers();
    const u = await mount();
    expect(loadView(localStorage).autoDraft).toBe(true);
    await u.click(u.btn('보기 설정'));
    const box = u.modal()!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(box.checked).toBe(true);
    await act(async () => { box.click(); });
    expect(loadView(localStorage).autoDraft).toBe(false);
    await u.click(u.btn('닫기', u.modal()!));
    await u.rename('끄면 없음');
    await advance(DRAFT_DELAY_MS);
    expect(draftKeys()).toEqual([]);
    await u.remount();
    await u.click(u.btn('보기 설정'));
    expect((u.modal()!.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(false);
    await act(async () => { (u.modal()!.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); });
    expect(loadView(localStorage).autoDraft).toBe(true);
    await u.remount();
    expect(loadView(localStorage).autoDraft).toBe(true);
  });
});
