// @vitest-environment jsdom
// TURN-010: compact Project tab. jsdom, not a browser.
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { History } from '../src/model/history';
import { buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import { saveProject } from '../src/storage/localStore';
import { DEFAULT_WS_NAME } from '../src/storage/workspaces';
import { App } from '../src/ui/App';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const css = readFileSync('src/ui/styles.css', 'utf8');
let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  localStorage.clear();
});

async function mount() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const seen: { h: History | null } = { h: null };
  root = createRoot(el);
  await act(async () => { root!.render(<App onHistory={(h) => { seen.h = h; }} />); });
  const click = async (node: Element) => { await act(async () => { (node as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
  const key = async (node: Element, k: string) => { await act(async () => { node.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); }); };
  const type = async (inp: HTMLInputElement, v: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(inp, v);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label || b.getAttribute('aria-label') === label) as HTMLButtonElement;
  const panel = () => el.querySelector('#explorer-panel-project') as HTMLElement;
  const rows = () => [...panel().querySelectorAll<HTMLElement>('.proj-list [data-project-id]')];
  const dialogs = () => [...el.querySelectorAll<HTMLElement>('[role=dialog]')];
  const top = () => dialogs()[dialogs().length - 1];
  const openMenu = async () => { await click(btn('프로젝트 추가', panel())); return panel().querySelector('[role=menu]') as HTMLElement; };
  const openDetail = async (name: string) => { const b = btn(`${name} 프로젝트 상세`, panel()); b.focus(); await click(b); return top(); };
  return { el, click, key, type, btn, panel, rows, dialogs, top, openMenu, openDetail, history: () => seen.h! };
}

const seedThree = () => {
  saveProject(localStorage, { ...buildSampleProject(), id: 'prj-a', name: 'A 라인' }, new Date('2026-11-01T00:00:00Z'));
  saveProject(localStorage, { ...buildSampleProject(), id: 'prj-b', name: 'B 라인' }, new Date('2026-11-02T00:00:00Z'));
  saveProject(localStorage, { ...buildParallelSampleProject(), id: 'prj-c', name: 'C 라인' }, new Date('2026-11-03T00:00:00Z'));
};

describe('TURN-010 project tab', () => {
  it('AC1: Workspace line, project list, then the equipment tree — no saved table, note, or new-project button row', async () => {
    const u = await mount();
    const text = u.panel().textContent ?? '';
    const at = (s: string) => text.indexOf(s);
    expect(at('Workspace:')).toBeGreaterThanOrEqual(0);
    expect(at('프로젝트 (')).toBeGreaterThan(at('Workspace:'));
    expect(at('장비 구조')).toBeGreaterThan(at('프로젝트 ('));
    expect(text).not.toContain('저장된 프로젝트');
    expect(text).not.toContain('현재 Workspace에 저장된 프로젝트만 보입니다');
    expect(text).not.toContain('+ 빈 프로젝트');
    expect(text).not.toContain('+ 5공정 예제');
    expect(text).not.toContain('+ 병렬 예제');
    expect(u.panel().querySelector('.saved-row')).toBeNull();
    expect(u.panel().querySelector('.exbtns')).toBeNull();
    expect(u.panel().querySelector('[role=tree]')).not.toBeNull();
    expect(text).toContain('모두 펼치기');
    expect(text).toContain('모두 접기');
    expect(text).toContain('접기는 모델을 바꾸지 않습니다');
    expect(css).toMatch(/\.proj-list \{[^}]*max-height:\s*168px/);
    expect(css).toMatch(/\.proj-list \{[^}]*overflow:\s*auto/);
  });

  it('AC2: open tabs then saved projects, one row per id, with editing / open / unsaved marks', async () => {
    seedThree();
    const u = await mount();
    await u.click((await u.openMenu()).querySelector('button')!); // 빈 프로젝트
    const rows = u.rows();
    expect(rows.map((r) => r.querySelector('.nm')!.textContent)).toEqual(['C 라인', '새 프로젝트 2', 'B 라인', 'A 라인']);
    const byName = (name: string) => rows.find((r) => r.querySelector('.nm')!.textContent === name)!;
    const current = byName('새 프로젝트 2');
    expect(current.classList.contains('on')).toBe(true);
    expect(current.dataset.current).toBe('true');
    expect(current.dataset.dirty).toBe('true');
    expect(current.querySelector('.dirty')!.getAttribute('aria-label')).toBe('미저장');
    expect(current.querySelector('.open-dot')).toBeNull();
    const opened = byName('C 라인');
    expect(opened.classList.contains('on')).toBe(false);
    expect(opened.dataset.open).toBe('true');
    expect(opened.dataset.dirty).toBe('false');
    expect(opened.querySelector('.open-dot')!.getAttribute('aria-label')).toBe('열림');
    expect(opened.querySelector('.dirty')).toBeNull();
    for (const name of ['A 라인', 'B 라인']) {
      const closed = byName(name);
      expect(closed.dataset.open).toBe('false');
      expect(closed.querySelector('.open-dot')).toBeNull();
      expect(closed.querySelector('.dirty')).toBeNull();
      expect(closed.classList.contains('on')).toBe(false);
    }
  });

  it('AC3: a row switches or opens, and the + menu creates, imports, and opens project files', async () => {
    seedThree();
    const u = await mount();
    expect(u.history().present.name).toBe('C 라인');
    await u.click(u.rows().find((r) => r.dataset.projectId === 'prj-b')!);
    expect(u.history().present.id).toBe('prj-b');
    expect(u.rows().find((r) => r.dataset.projectId === 'prj-b')!.classList.contains('on')).toBe(true);
    await u.click(u.rows().find((r) => r.dataset.projectId === 'prj-c')!);
    expect(u.history().present.id).toBe('prj-c');

    await u.click((await u.openMenu()).querySelectorAll('button')[0]);
    expect(u.history().present.name).toMatch(/^새 프로젝트/);
    await u.click((await u.openMenu()).querySelectorAll('button')[1]);
    expect(u.history().present.name).toContain('5공정 예제');
    await u.click((await u.openMenu()).querySelectorAll('button')[2]);
    expect(u.history().present.name).toContain('병렬');

    const file = u.el.querySelector('input[type=file]') as HTMLInputElement;
    let clicks = 0;
    file.click = () => { clicks += 1; };
    await u.click((await u.openMenu()).querySelectorAll('button')[3]);
    expect(clicks).toBe(1);

    await u.click((await u.openMenu()).querySelectorAll('button')[4]);
    expect(u.el.querySelector('h1')!.textContent).toBe('프로젝트 파일');
  });

  it('AC4: the detail popup shows identity and runs open, rename, close, and delete; Esc returns focus', async () => {
    const u = await mount();
    const name0 = u.history().present.name;
    const more = u.btn(`${name0} 프로젝트 상세`);
    more.focus();
    await u.click(more);
    const pop = u.top();
    expect(pop.getAttribute('aria-label')).toBe(`프로젝트 — ${name0}`);
    expect(pop.textContent).toContain(name0);
    expect(pop.textContent).toContain(u.history().present.id);
    expect(pop.textContent).toContain('편집 중');
    expect(pop.textContent).toContain('아직 저장한 적 없음');
    expect(pop.textContent).toContain(DEFAULT_WS_NAME);
    expect(pop.textContent).toContain('탭 닫기는 저장 데이터를 지우지 않습니다');
    expect(pop.textContent).toContain('새 프로젝트는 저장할 때 이 Workspace에 들어옵니다');
    const go = u.btn('이 프로젝트로 전환', pop);
    expect(go.disabled).toBe(true);
    expect(go.getAttribute('title')).toContain('이미 편집 중');
    expect(u.btn(`${name0} 닫기`, pop).disabled).toBe(false);
    const del = u.btn(`${name0} 삭제 불가: 열린 프로젝트`, pop);
    expect(del.disabled).toBe(true);
    expect(del.getAttribute('title')).toContain('열린 프로젝트는 삭제할 수 없습니다');

    await u.click(u.btn(`${name0} 이름 변경`, pop));
    const nameDlg = u.dialogs().find((d) => d.querySelector('input'))!;
    await u.type(nameDlg.querySelector('input') as HTMLInputElement, '바꾼 프로젝트');
    const rev0 = u.history().present.revision;
    await u.click(u.btn('이름 변경', nameDlg));
    expect(u.history().present.name).toBe('바꾼 프로젝트');
    expect(u.history().present.revision).toBe(rev0 + 1);
    expect(u.history().labels[u.history().labels.length - 1]).toBe('프로젝트 이름 변경');

    await u.key(document.activeElement!, 'Escape');
    expect(u.dialogs()).toHaveLength(0);
    expect(document.activeElement).toBe(u.btn('바꾼 프로젝트 프로젝트 상세'));

    await u.openDetail('바꾼 프로젝트');
    await u.click(u.btn('닫기', u.top()));
    expect(u.dialogs()).toHaveLength(0);
    expect(document.activeElement).toBe(u.btn('바꾼 프로젝트 프로젝트 상세'));
  });

  it('AC4: a closed saved project opens, renames on the saved copy, and cannot close a tab', async () => {
    seedThree();
    const u = await mount();
    const pop = await u.openDetail('A 라인');
    expect(pop.textContent).toContain('닫힘');
    expect(pop.textContent).toContain('저장됨 rev');
    expect(pop.textContent).toContain('prj-a');
    expect(u.btn('열기', pop).disabled).toBe(false);
    const close = u.btn('A 라인 탭 닫기 불가: 닫힌 프로젝트', pop);
    expect(close.disabled).toBe(true);
    expect(close.getAttribute('title')).toContain('닫힌 프로젝트에는 닫을 탭이 없습니다');
    expect(u.btn('A 라인 영구 삭제', pop).disabled).toBe(false);
    await u.click(u.btn('열기', pop));
    expect(u.history().present.id).toBe('prj-a');
    expect(u.rows().find((r) => r.dataset.projectId === 'prj-a')!.dataset.current).toBe('true');
  });

  it('AC4: without storage the list is open projects only and the popup says storage is unavailable', async () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function () { throw new Error('blocked'); };
    let u: Awaited<ReturnType<typeof mount>>;
    try { u = await mount(); } finally { Storage.prototype.setItem = orig; }
    expect(u.rows()).toHaveLength(1);
    const pop = await u.openDetail(u.history().present.name);
    expect(pop.textContent).toContain('브라우저 저장소 사용 불가');
    expect(pop.textContent).not.toContain('저장됨 rev');
  });
});
