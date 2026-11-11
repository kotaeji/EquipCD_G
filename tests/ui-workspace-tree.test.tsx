// @vitest-environment jsdom
// TURN-002 jsdom tests (NOT a real browser): workspace / project management + foldable tree. Throwaway localStorage only.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { History } from '../src/model/history';
import { buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import { serializeProject } from '../src/storage/fileFormat';
import { readIndex, saveProject } from '../src/storage/localStore';
import * as W from '../src/storage/workspaces';
import { App } from '../src/ui/App';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
beforeEach(() => localStorage.clear());
afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); root = null; document.body.innerHTML = ''; localStorage.clear(); });

async function mount() {
  const el = document.createElement('div'); document.body.appendChild(el);
  const seen: { h: History | null } = { h: null };
  root = createRoot(el);
  await act(async () => { root!.render(<App onHistory={(h) => { seen.h = h; }} />); });
  const all = (sel: string) => [...el.querySelectorAll<HTMLElement>(sel)];
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.textContent ?? '').trim() === label || b.getAttribute('aria-label') === label)!;
  const click = async (b: Element) => { await act(async () => { (b as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
  const key = async (t: Element, k: string) => { await act(async () => { t.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); }); };
  const type = async (inp: HTMLInputElement, v: string) => { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(inp, v); inp.dispatchEvent(new Event('input', { bubbles: true })); }); };
  const choose = async (s: HTMLSelectElement, v: string) => { await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(s, v); s.dispatchEvent(new Event('change', { bubbles: true })); }); };
  const item = (id: string) => el.querySelector<HTMLElement>(`[role=treeitem][data-tree-id="${id}"]`);
  const history = () => structuredClone(seen.h!);
  const dialog = () => el.querySelector<HTMLElement>('[role=dialog]');
  const top = () => { const d = el.querySelectorAll<HTMLElement>('[role=dialog]'); return d[d.length - 1]; };
  const modal = () => el.querySelector<HTMLElement>('.modal:not([role=dialog])');
  const tabNames = () => all('.exitem .nm').map((n) => n.textContent);
  const openDetail = async (name: string) => {
    const b = btn(`${name} 프로젝트 상세`); b.focus(); await click(b); return top();
  };
  const wsRow = (id: string) => el.querySelector<HTMLElement>(`[data-ws-id="${id}"]`)!;
  const switchWs = async (id: string) => { await click(btn('전환', wsRow(id))); };
  const wsNames = () => [...el.querySelectorAll<HTMLElement>('[data-ws-id] .ws-name')].map((n) => n.textContent);
  const activeWsId = () => el.querySelector<HTMLElement>('[data-ws-id].on')?.getAttribute('data-ws-id') ?? '';
  return { el, all, btn, click, key, type, choose, item, history, dialog, top, modal, tabNames, openDetail, wsRow, switchWs, wsNames, activeWsId, txt: () => el.textContent ?? '' };
}
const reg = () => JSON.parse(localStorage.getItem(W.WS_KEY)!) as W.WorkspaceRegistry;
const projKeys = () => Object.keys(localStorage).filter((k) => k.startsWith('ecd.v1.project.')).sort();
const seedTwo = () => {
  saveProject(localStorage, { ...buildSampleProject(), id: 'prj-a', name: 'A 라인' }, new Date('2026-11-01T00:00:00Z'));
  saveProject(localStorage, { ...buildParallelSampleProject(), id: 'prj-par', name: '병렬 라인' }, new Date('2026-11-02T00:00:00Z'));
};

describe('TURN-002 tree fold/unfold (AC4)', () => {
  it('twisty / keyboard / fold-all change only UserView; selection, history, rev, export unchanged; aria-expanded matches', async () => {
    seedTwo(); const u = await mount();
    const p0 = u.history().present; const st = p0.equipment.id; const S1 = 'U-PS1';
    expect(u.item(st)!.getAttribute('aria-expanded')).toBe('true');
    expect(u.item(S1)!.getAttribute('aria-expanded')).toBe('true');
    await u.click(u.item('STP-A1')!); // select a device (Enter/click = select, existing behaviour)
    expect(u.item('STP-A1')!.getAttribute('aria-selected')).toBe('true');
    const h0 = u.history(); const export0 = serializeProject(h0.present); const body0 = localStorage.getItem('ecd.v1.project.prj-par');
    // twisty click folds without selecting
    await u.click(u.item(S1)!.querySelector('.twisty')!);
    expect(u.item(S1)!.getAttribute('aria-expanded')).toBe('false');
    expect(u.item('STP-A1')).toBeNull();
    expect(u.item(S1)!.textContent).toContain('● 선택 포함');
    expect(u.item(S1)!.getAttribute('aria-selected')).toBe('false');
    expect(JSON.parse(localStorage.getItem('ecd.v1.userView')!).treeCollapsed['prj-par']).toEqual([S1]);
    // keyboard → / ← on the Substation row
    await u.key(u.item(S1)!, 'ArrowRight'); expect(u.item(S1)!.getAttribute('aria-expanded')).toBe('true');
    await u.key(u.item(S1)!, 'ArrowLeft'); expect(u.item(S1)!.getAttribute('aria-expanded')).toBe('false');
    await u.key(u.item(S1)!, 'ArrowRight');
    // ← on a device moves focus to its Substation (no fold, no select)
    u.item('STP-B1')!.focus(); await u.key(u.item('STP-B1')!, 'ArrowLeft');
    expect(document.activeElement).toBe(u.item(S1));
    // ↓ moves to next visible item
    await u.key(u.item(S1)!, 'ArrowDown'); expect(document.activeElement).toBe(u.item('STP-A1'));
    // fold all = Station AND every Substation with devices really folded (independent review): only the Station row stays visible
    await u.click(u.btn('트리 모두 접기'));
    expect(u.item(st)!.getAttribute('aria-expanded')).toBe('false'); expect(u.item(S1)).toBeNull(); expect(u.item('STP-A1')).toBeNull();
    expect(u.all('[role=treeitem]')).toHaveLength(1);
    expect(u.item(st)!.textContent).toContain('● 선택 포함');
    expect(JSON.parse(localStorage.getItem('ecd.v1.userView')!).treeCollapsed['prj-par'].sort()).toEqual([st, ...h0.present.units.filter((x) => x.deviceIds.length).map((x) => x.id)].sort());
    // opening the Station shows every Substation still folded
    await u.key(u.item(st)!, 'ArrowRight'); expect(u.item(st)!.getAttribute('aria-expanded')).toBe('true');
    expect(u.all('[role=treeitem][aria-expanded=false]').length).toBe(h0.present.units.filter((x) => x.deviceIds.length).length);
    // fold all again while Station is already folded keeps it folded (never toggles it open)
    await u.key(u.item(st)!, 'ArrowLeft'); await u.click(u.btn('트리 모두 접기'));
    expect(u.item(st)!.getAttribute('aria-expanded')).toBe('false'); expect(u.all('[role=treeitem]')).toHaveLength(1);
    await u.click(u.btn('트리 모두 펼치기'));
    expect(u.all('[role=treeitem][aria-expanded=false]')).toHaveLength(0);
    // nothing in the model moved
    expect(u.history()).toEqual(h0);
    expect(serializeProject(u.history().present)).toBe(export0);
    expect(localStorage.getItem('ecd.v1.project.prj-par')).toBe(body0);
    expect(u.item('STP-A1')!.getAttribute('aria-selected')).toBe('true');
    // Enter on a row still selects (existing behaviour) and does not fold
    await u.key(u.item(S1)!, 'Enter');
    expect(u.item(S1)!.getAttribute('aria-selected')).toBe('true'); expect(u.item(S1)!.getAttribute('aria-expanded')).toBe('true');
  });

  it('fold does not change the group-run target; step navigation does not auto-unfold', async () => {
    seedTwo(); const u = await mount();
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!); await u.click(u.btn('Substation 그룹'));
    const heading = () => [...u.el.querySelectorAll('h4')].map((h) => h.textContent ?? '').find((t) => t.startsWith('그룹 실행 — '));
    const h0 = heading(); expect(h0).toContain('S1 듀얼 클램프');
    await u.click(u.btn('트리 모두 접기'));
    expect(heading()).toBe(h0);
    await u.click(u.el.querySelector('.stepper [data-stepid="attributes"]')!);
    expect(u.item('U-PS1')).toBeNull(); // Station folded too → Substation rows hidden, not auto-unfolded
    await u.key(u.all('[role=treeitem]')[0], 'ArrowRight');
    expect(u.item('U-PS1')!.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('TURN-002 workspace management (AC1/AC2)', () => {
  it('migrates existing projects into 기본 Workspace on start without touching project data', async () => {
    seedTwo(); const before = projKeys().map((k) => localStorage.getItem(k)); const idx = localStorage.getItem('ecd.v1.index');
    const u = await mount();
    expect(reg().workspaces).toHaveLength(1);
    expect(new Set(reg().workspaces[0].projectIds)).toEqual(new Set(['prj-a', 'prj-par']));
    expect(projKeys().map((k) => localStorage.getItem(k))).toEqual(before); expect(localStorage.getItem('ecd.v1.index')).toBe(idx);
    expect(u.activeWsId()).toBe(W.DEFAULT_WS_ID);
  });

  it('create (validation) → switch → isolation → unsaved-edit switch block → save attaches → rename → delete rules', async () => {
    seedTwo(); const u = await mount();
    await u.click(u.btn('+ 새 Workspace'));
    const inp = u.el.querySelector<HTMLInputElement>('[role=dialog] input')!;
    const make = () => u.btn('만들기', u.top());
    expect(make().disabled).toBe(true);
    await u.type(inp, '   '); expect(make().disabled).toBe(true); expect(u.txt()).toContain('공백만은 안 됩니다');
    await u.type(inp, '기본 workspace'); expect(make().disabled).toBe(true); expect(u.txt()).toContain('이미 있습니다');
    await u.type(inp, '  설비   B '); expect(make().disabled).toBe(false);
    await u.click(make());
    const b = reg().workspaces.find((w) => w.name === '설비 B')!; expect(b.id).toMatch(/^ws-/);
    // switch from the Workspace tab list (current tab is clean → allowed)
    await u.switchWs(b.id);
    expect(reg().activeId).toBe(b.id); expect(u.tabNames()).toEqual(['새 프로젝트']);
    expect(u.txt()).not.toContain('A 라인');
    expect(projKeys()).toEqual(['ecd.v1.project.prj-a', 'ecd.v1.project.prj-par']); // nothing deleted
    // edit the new tab (rename via ✎) → switching back is blocked and the tab stays
    await u.openDetail('새 프로젝트');
    await u.click(u.btn('새 프로젝트 이름 변경'));
    await u.type(u.el.querySelector<HTMLInputElement>('[role=dialog] input')!, 'B 설비 프로젝트');
    await u.click(u.btn('이름 변경', u.top()));
    expect(u.tabNames()).toEqual(['B 설비 프로젝트']);
    await u.switchWs(W.DEFAULT_WS_ID);
    expect(reg().activeId).toBe(b.id); expect(u.modal()!.textContent).toContain('Workspace 전환 불가');
    expect(u.tabNames()).toEqual(['B 설비 프로젝트']);
    await u.click(u.btn('저장하러 돌아가기'));
    // save → attached to 설비 B, then switching back works and lists only default projects
    await u.click(u.btn('저장'));
    const pid = u.history().present.id;
    expect(reg().workspaces.find((w) => w.id === b.id)!.projectIds).toEqual([pid]);
    await u.switchWs(W.DEFAULT_WS_ID);
    expect(reg().activeId).toBe(W.DEFAULT_WS_ID);
    const ids = [...u.el.querySelectorAll('[data-project-id]')].map((r) => r.getAttribute('data-project-id')).sort();
    expect(ids).toEqual(['prj-a', 'prj-par']);
    // workspace delete rules live on the Workspace tab list
    const delOf = (id: string) => u.el.querySelector<HTMLButtonElement>(`[data-ws-id="${id}"] button.danger`)!;
    expect(delOf(W.DEFAULT_WS_ID).disabled).toBe(true); // current
    expect(delOf(b.id).disabled).toBe(true); // not empty
    expect(delOf(b.id).getAttribute('aria-label')).toContain('저장 프로젝트 1개');
    // rename 설비 B (duplicate refused, id stable)
    await u.click(u.el.querySelector(`[data-ws-id="${b.id}"] button[aria-label$="이름 변경"]`)!);
    const rin = u.el.querySelectorAll<HTMLInputElement>('[role=dialog] input'); const rinp = rin[rin.length - 1];
    await u.type(rinp, W.DEFAULT_WS_NAME); expect(u.btn('이름 변경', u.top()).disabled).toBe(true);
    await u.type(rinp, '설비 C'); await u.click(u.btn('이름 변경', u.top()));
    expect(reg().workspaces.find((w) => w.id === b.id)!.name).toBe('설비 C');
    // an empty, non-current workspace can be deleted after confirmation (cancel = default focus, no change)
    await u.click(u.btn('+ 새 Workspace'));
    const cin = u.el.querySelectorAll<HTMLInputElement>('[role=dialog] input'); await u.type(cin[cin.length - 1], '빈 WS'); await u.click(u.btn('만들기', u.top()));
    const e = reg().workspaces.find((w) => w.name === '빈 WS')!;
    await u.click(delOf(e.id));
    expect((document.activeElement as HTMLElement).textContent).toBe('취소');
    await u.click(u.btn('취소', u.modal()!)); expect(reg().workspaces.some((w) => w.id === e.id)).toBe(true);
    await u.click(delOf(e.id)); await u.click(u.btn('Workspace 삭제'));
    expect(reg().workspaces.some((w) => w.id === e.id)).toBe(false);
    expect(projKeys()).toContain(`ecd.v1.project.${pid}`);
  });
});

describe('TURN-002 project rename / delete (AC3)', () => {
  it('open project rename = model edit (rev+1, Undo restores exactly, saved list updates on save); duplicate refused', async () => {
    seedTwo(); const u = await mount();
    const h0 = u.history(); const name0 = h0.present.name;
    await u.openDetail(name0);
    await u.click(u.btn(`${name0} 이름 변경`));
    const inp = u.el.querySelector<HTMLInputElement>('[role=dialog] input')!;
    const other = readIndex(localStorage).find((e) => e.id !== h0.present.id)!.name;
    await u.type(inp, other.toUpperCase()); expect(u.btn('이름 변경', u.top()).disabled).toBe(true);
    await u.type(inp, '새 이름 라인'); await u.click(u.btn('이름 변경', u.top()));
    const h1 = u.history();
    expect(h1.present.name).toBe('새 이름 라인'); expect(h1.present.revision).toBe(h0.present.revision + 1);
    expect(h1.labels[h1.labels.length - 1]).toBe('프로젝트 이름 변경');
    expect(u.el.querySelector('.exitem.on .nm')!.textContent).toBe('새 이름 라인');
    expect(u.el.querySelector('.exitem.on .dirty')!.getAttribute('aria-label')).toBe('미저장');
    expect(readIndex(localStorage).find((e) => e.id === h0.present.id)!.name).toBe(name0); // not saved yet
    await u.click(u.btn('실행 취소'));
    expect(u.history().present).toEqual(h0.present);
    await u.click(u.btn('다시 실행')); expect(u.history().present).toEqual(h1.present);
    await u.click(u.btn('저장'));
    expect(readIndex(localStorage).find((e) => e.id === h0.present.id)!.name).toBe('새 이름 라인');
  });

  it('saved-project list: open project cannot be renamed/deleted; closed one renamed then deleted (cancel default, no other data touched)', async () => {
    seedTwo(); const u = await mount();
    const openId = u.history().present.id; const closedId = openId === 'prj-a' ? 'prj-par' : 'prj-a';
    const row = (id: string) => u.el.querySelector<HTMLElement>(`[data-project-id="${id}"]`)!;
    const openName = row(openId).querySelector('.nm')!.textContent!;
    const closedName = row(closedId).querySelector('.nm')!.textContent!;
    // row buttons are only "…"; rename and delete live in the detail popup (TURN-010)
    expect(row(openId).querySelector('button.danger')).toBeNull();
    await u.openDetail(openName);
    const openDelete = u.btn(`${openName} 삭제 불가: 열린 프로젝트`);
    expect(openDelete.disabled).toBe(true); expect(openDelete.getAttribute('aria-label')).toContain('삭제 불가');
    expect(u.btn(`${openName} 이름 변경`).disabled).toBe(false);
    await u.key(document.body, 'Escape');
    // rename closed
    await u.openDetail(closedName);
    await u.click(u.btn(`${closedName} 이름 변경`));
    const inp = u.el.querySelectorAll<HTMLInputElement>('[role=dialog] input'); const ri = inp[inp.length - 1];
    await u.type(ri, '바뀐 이름'); await u.click(u.btn('이름 변경', u.top()));
    expect(readIndex(localStorage).find((e) => e.id === closedId)!.name).toBe('바뀐 이름');
    expect(row(closedId).textContent).toContain('바뀐 이름');
    // delete closed: cancel first (default focus) → unchanged; then confirm
    const openBody = localStorage.getItem(`ecd.v1.project.${openId}`); const before = projKeys();
    await u.click(u.btn('바뀐 이름 영구 삭제'));
    expect(u.modal()!.textContent).toContain('되돌릴 수 없습니다'); expect(u.modal()!.textContent).toContain(closedId);
    expect((document.activeElement as HTMLElement).textContent).toBe('취소');
    await u.click(u.btn('취소', u.modal()!)); expect(projKeys()).toEqual(before);
    await u.click(u.btn('바뀐 이름 영구 삭제')); await u.click(u.btn('영구 삭제'));
    expect(projKeys()).toEqual([`ecd.v1.project.${openId}`]);
    expect(readIndex(localStorage).map((e) => e.id)).toEqual([openId]);
    expect(reg().workspaces[0].projectIds).toEqual([openId]);
    expect(localStorage.getItem(`ecd.v1.project.${openId}`)).toBe(openBody);
    expect(u.el.querySelector(`[data-project-id="${closedId}"]`)).toBeNull();
  });

  it('closing a tab never deletes saved data', async () => {
    seedTwo(); const u = await mount(); const before = projKeys().map((k) => localStorage.getItem(k));
    await u.openDetail(u.history().present.name);
    await u.click(u.btn(`${u.history().present.name} 닫기`));
    expect(projKeys().map((k) => localStorage.getItem(k))).toEqual(before);
  });
});

describe('TURN-002 switch with a never-saved, unedited tab', () => {
  it('asks before closing it (cancel = default focus, nothing changes); confirm switches', async () => {
    const u = await mount(); // empty storage → start sample tab (never saved, no edits)
    await u.click(u.btn('+ 새 Workspace'));
    await u.type(u.top().querySelector('input')!, 'WS 2'); await u.click(u.btn('만들기', u.top()));
    const id = reg().workspaces.find((w) => w.name === 'WS 2')!.id; const names0 = u.tabNames();
    await u.switchWs(id);
    expect(u.modal()!.textContent).toContain('새 탭 1개');
    expect((document.activeElement as HTMLElement).textContent).toBe('취소');
    await u.click(u.btn('취소', u.modal()!));
    expect(reg().activeId).toBe(W.DEFAULT_WS_ID); expect(u.tabNames()).toEqual(names0); expect(u.activeWsId()).toBe(W.DEFAULT_WS_ID);
    await u.switchWs(id); await u.click(u.btn('닫고 전환'));
    expect(reg().activeId).toBe(id); expect(u.tabNames()).toEqual(['새 프로젝트']);
  });
});

describe('TURN-002 rev 2 — H4: "새 ID 사본으로 저장" with a failing write (jsdom, throwaway storage)', () => {
  /** ws-b active + empty; prj-a is saved in 기본 Workspace; the same prj-a JSON is imported in ws-b */
  const setup = async () => {
    seedTwo();
    const base = W.ensureWorkspaces(localStorage).reg; const c = W.createWorkspace(base, 'B', new Date(), 'ws-b'); if (!c.ok) throw new Error();
    const a = W.setActive(c.reg, 'ws-b'); if (!a.ok) throw new Error(); expect(W.writeRegistry(localStorage, a.reg, base).ok).toBe(true);
    const u = await mount();
    const inp = u.el.querySelector<HTMLInputElement>('input[type=file]')!;
    const raw = localStorage.getItem('ecd.v1.project.prj-a')!; // jsdom File has no .text() → minimal File-like stand-in
    const f = { name: 'prj-a.json', text: async () => raw };
    Object.defineProperty(inp, 'files', { value: [f], configurable: true });
    await act(async () => { inp.dispatchEvent(new Event('change', { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); });
    expect(u.history().present.id).toBe('prj-a');
    await u.click(u.btn('저장'));
    expect(u.modal()!.textContent).toContain('다른 Workspace에 같은 ID');
    return u;
  };
  const snap = () => Object.fromEntries(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)]));
  const restartOwners = async () => {
    if (root) await act(async () => { root!.unmount(); }); root = null; document.body.innerHTML = '';
    await mount(); return Object.fromEntries(reg().workspaces.map((w) => [w.id, [...w.projectIds].sort()]));
  };

  it.each([['registry', W.WS_KEY], ['body', 'ecd.v1.project.prj-a-copy-'], ['index', 'ecd.v1.index']])('%s write fails → error toast, no copy, tab kept, restart: copy not in any workspace', async (_n, keyPrefix) => {
    const u = await setup(); const before = snap();
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) { if (k.startsWith(keyPrefix)) throw new Error('QuotaExceededError (test)'); return orig.call(this, k, v); };
    try { await u.click(u.btn('새 ID 사본으로 저장')); } finally { Storage.prototype.setItem = orig; }
    expect(u.txt()).toContain('사본을 만들지 않았고 현재 탭은 그대로입니다'); expect(u.txt()).not.toContain('새 ID 사본 prj-a-copy');
    expect(u.history().present.id).toBe('prj-a');
    expect(snap()).toEqual(before); expect(localStorage.getItem('ecd.v1.txn')).toBeNull();
    expect(await restartOwners()).toEqual({ [W.DEFAULT_WS_ID]: ['prj-a', 'prj-par'], 'ws-b': [] });
  });

  it('success path: copy owned by ws-b (the intended workspace) also after restart', async () => {
    const u = await setup();
    await u.click(u.btn('새 ID 사본으로 저장'));
    const id = u.history().present.id; expect(id).toMatch(/^prj-a-copy-/);
    expect(u.txt()).toContain(`새 ID 사본 ${id}로 저장했습니다`);
    expect(await restartOwners()).toEqual({ [W.DEFAULT_WS_ID]: ['prj-a', 'prj-par'], 'ws-b': [id] });
  });
});

describe('TURN-002 rev 3 — R1 in the real App: registry read fails at start → this session never replaces it (jsdom)', () => {
  it('first WS_KEY read throws on mount → create Workspace / save are refused; stored registry and data unchanged; reload works', async () => {
    seedTwo();
    const base = W.ensureWorkspaces(localStorage).reg; const c = W.createWorkspace(base, 'B', new Date(), 'ws-b'); if (!c.ok) throw new Error();
    expect(W.writeRegistry(localStorage, c.reg, base).ok).toBe(true);
    // data keys only (the UI-view key ecd.v1.userView is display preference, written independently)
    const snap = () => Object.fromEntries(Object.keys(localStorage).filter((k) => k !== 'ecd.v1.userView').sort().map((k) => [k, localStorage.getItem(k)]));
    const before = snap();
    const orig = Storage.prototype.getItem; let hits = 0;
    Storage.prototype.getItem = function (k: string) { if (k === W.WS_KEY && hits === 0) { hits++; throw new Error('SecurityError (test)'); } return orig.call(this, k); };
    let u: Awaited<ReturnType<typeof mount>>;
    try { u = await mount(); } finally { Storage.prototype.getItem = orig; }
    expect(hits).toBe(1);
    expect(u.txt()).toContain('읽지 못했습니다');
    await u.click(u.btn('+ 새 Workspace'));
    await u.type(u.top().querySelector('input')!, 'WS C'); await u.click(u.btn('만들기', u.top()));
    expect(u.txt()).toContain('변경하지 않았습니다');
    await u.click(u.btn('저장'));
    expect(snap()).toEqual(before);
    // reload (read works) → original registry with ws-b
    if (root) await act(async () => { root!.unmount(); }); root = null; document.body.innerHTML = '';
    const u2 = await mount(); expect(u2.wsNames()).toEqual([W.DEFAULT_WS_NAME, 'B']);
  });
});

describe('TURN-002 rev 3 — Esc closes the top-most management dialog even when focus stayed outside (jsdom)', () => {
  it('이름 dialog: Esc from outside focus closes it and creates nothing; the project list is not a dialog', async () => {
    seedTwo(); const u = await mount();
    const esc = async (t: Element = document.body) => u.key(t, 'Escape');
    const opener = u.btn('+ 새 Workspace'); opener.focus(); await u.click(opener);
    expect(u.all('[role=dialog]')).toHaveLength(1); expect(u.top().contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.tagName).toBe('INPUT');
    await esc(opener); expect(u.all('[role=dialog]')).toHaveLength(0);
    await u.click(u.btn('+ 새 Workspace'));
    await esc(document.activeElement!); expect(u.all('[role=dialog]')).toHaveLength(0);
    expect(u.el.querySelector('[data-project-id]')).not.toBeNull();
    expect(u.all('[role=dialog]')).toHaveLength(0);
    expect(reg().workspaces).toHaveLength(1); // nothing created by closing
  });
});

// ---------------------------------------------------------------- rev 4: dialog keyboard boundary + tree ARIA hierarchy
describe('TURN-002 rev 4 — dialog layers: static confirm Esc = 취소, background shortcuts blocked, focus return (jsdom)', () => {
  const ctrl = async (t: Element, key: string, shift = false) => {
    let ev: KeyboardEvent | null = null;
    await act(async () => { ev = new KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey: shift, bubbles: true, cancelable: true }); t.dispatchEvent(ev); });
    return ev!;
  };
  const data = () => Object.fromEntries(Object.keys(localStorage).filter((k) => k !== 'ecd.v1.userView').sort().map((k) => [k, localStorage.getItem(k)]));
  const seedWithEmptyWs = () => {
    seedTwo(); const base = W.ensureWorkspaces(localStorage).reg; const c = W.createWorkspace(base, 'B', new Date(), 'ws-b'); if (!c.ok) throw new Error();
    expect(W.writeRegistry(localStorage, c.reg, base).ok).toBe(true);
  };
  const delBtn = (scope: ParentNode, sel: string) => [...scope.querySelectorAll<HTMLButtonElement>(`${sel} button`)].find((b) => (b.textContent ?? '').trim() === '삭제')!;

  it('static Workspace-delete confirm: Esc closes ONLY the confirm (nothing deleted, no write), focus back to its 삭제 button; Esc again closes 관리', async () => {
    seedWithEmptyWs(); const u = await mount(); const before = data();
    const del = delBtn(u.el, '[data-ws-id="ws-b"]'); del.focus(); await u.click(del);
    const conf = u.modal()!; expect(conf.getAttribute('role')).toBe('alertdialog'); expect(conf.textContent).toContain('삭제');
    expect(document.activeElement?.textContent).toBe('취소'); // cancel is the default focus
    await u.key(document.activeElement!, 'Escape');
    expect(u.modal()).toBeNull(); expect(u.all('[role=dialog]')).toHaveLength(0);
    expect(document.activeElement).toBe(del);
    expect(data()).toEqual(before); expect(reg().workspaces.map((w) => w.id)).toEqual([W.DEFAULT_WS_ID, 'ws-b']);
    await u.key(document.activeElement!, 'Escape'); expect(u.all('[role=dialog]')).toHaveLength(0);
  });

  it('static project-delete confirm: Esc = 취소 (project kept, storage unchanged); backdrop click also cancels', async () => {
    seedTwo(); const u = await mount(); const before = data(); const closed = 'prj-a'; expect(u.history().present.id).not.toBe(closed);
    await u.openDetail('A 라인');
    await u.click(u.btn('A 라인 영구 삭제')); expect(u.modal()!.textContent).toContain('영구 삭제');
    await u.key(document.body, 'Escape'); expect(u.modal()).toBeNull(); expect(data()).toEqual(before);
    await u.click(u.btn('A 라인 영구 삭제'));
    await u.click(u.el.querySelectorAll('.modal-bg')[u.el.querySelectorAll('.modal-bg').length - 1]); expect(u.modal()).toBeNull();
    expect(data()).toEqual(before); expect(localStorage.getItem(`ecd.v1.project.${closed}`)).not.toBeNull();
  });

  it('Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z / Delete while a management dialog or static confirm is open never touch the model; text field keeps native undo', async () => {
    seedWithEmptyWs(); const u = await mount();
    const name0 = u.history().present.name;
    await u.openDetail(name0);
    await u.click(u.btn(`${name0} 이름 변경`)); await u.type(u.top().querySelector('input')!, 'Renamed'); await u.click(u.btn('이름 변경', u.top()));
    const h1 = u.history(); expect(h1.present.name).toBe('Renamed'); expect(h1.past.length).toBeGreaterThan(0);
    // select something so Delete would normally ask to delete it
    await u.click(u.item('U-PS1') ?? u.all('[role=treeitem]')[1]); const hSel = u.history();
    // 1) name dialog open, keys on a button inside it and on the body
    await u.click(u.btn('+ 새 Workspace'));
    for (const t of [u.btn('취소', u.top()), document.body]) {
      await ctrl(t, 'z'); await ctrl(t, 'y'); await ctrl(t, 'z', true);
      await u.key(t, 'Delete'); await u.key(t, 'Backspace');
    }
    expect(u.history()).toEqual(hSel); expect(u.modal()).toBeNull();
    await u.key(document.body, 'Escape');
    // 2) static confirm on top
    await u.click(delBtn(u.el, '[data-ws-id="ws-b"]'));
    await ctrl(document.activeElement!, 'z'); await ctrl(document.body, 'y');
    expect(u.history()).toEqual(hSel); expect(u.modal()).not.toBeNull();
    await u.key(document.body, 'Escape'); await u.key(document.body, 'Escape');
    // 3) name dialog: Ctrl+Z inside the text field is left to the browser (not prevented) and does not undo the model
    await u.openDetail('Renamed');
    await u.click(u.btn(`Renamed 이름 변경`)); const inp = u.top().querySelector('input')!;
    const ev = await ctrl(inp, 'z'); expect(ev.defaultPrevented).toBe(false); expect(u.history()).toEqual(hSel);
    await u.key(inp, 'Escape'); // name dialog only; the project detail stays underneath
    expect(u.all('[role=dialog]')).toHaveLength(1);
    await u.key(document.body, 'Escape'); expect(u.all('[role=dialog]')).toHaveLength(0);
    // 4) no dialog → shortcuts work again
    await ctrl(document.body, 'z'); expect(u.history().present.name).toBe(name0);
  });
});

describe('TURN-002 rev 4 — tree ARIA: role=group is owned by (inside) its parent treeitem', () => {
  it('hierarchy, levels and aria-expanded match; clicks/keys act on the closest item only', async () => {
    seedTwo(); const u = await mount();
    const tree = u.el.querySelector('[role=tree]')!;
    const groups = [...tree.querySelectorAll('[role=group]')];
    expect(groups.length).toBeGreaterThan(1);
    for (const g of groups) { const owner = g.parentElement!; expect(owner.getAttribute('role')).toBe('treeitem'); expect(owner.getAttribute('aria-expanded')).toBe('true'); }
    for (const it of tree.querySelectorAll('[role=treeitem]')) {
      const up = it.parentElement!.closest('[role=treeitem],[role=tree]')!;
      const lvl = Number(it.getAttribute('aria-level'));
      if (up.getAttribute('role') === 'tree') expect(lvl).toBe(1);
      else { expect(it.parentElement!.getAttribute('role')).toBe('group'); expect(lvl).toBe(Number(up.getAttribute('aria-level')) + 1); }
      if (it.querySelector('[role=group]')) expect(it.getAttribute('aria-expanded')).toBe('true');
    }
    // folded parent: no group rendered, aria-expanded=false
    const S1 = 'U-PS1'; await u.key(u.item(S1)!, 'ArrowLeft');
    expect(u.item(S1)!.getAttribute('aria-expanded')).toBe('false'); expect(u.item(S1)!.querySelector('[role=group]')).toBeNull();
    await u.key(u.item(S1)!, 'ArrowRight');
    // click on a device selects the device only (parent Substation does not take the click)
    const dev = u.item(S1)!.querySelector<HTMLElement>('[role=treeitem]')!; const devId = dev.dataset.treeId!;
    await u.click(dev);
    expect(u.item(devId)!.getAttribute('aria-selected')).toBe('true'); expect(u.item(S1)!.getAttribute('aria-selected')).toBe('false');
    // keys on a nested item do not bubble into the parent: ← on device moves focus to parent and does NOT fold it; Enter selects only it
    dev.focus(); await u.key(u.item(devId)!, 'ArrowLeft');
    expect(document.activeElement).toBe(u.item(S1)); expect(u.item(S1)!.getAttribute('aria-expanded')).toBe('true');
    await u.key(u.item(devId)!, 'Enter'); expect(u.item(devId)!.getAttribute('aria-selected')).toBe('true');
    // click on the Station row toggles nothing and selects nothing (no handler); twisty still folds
    const st = u.all('[role=treeitem]')[0]; await u.click(st.querySelector('.tnode')!);
    expect(st.getAttribute('aria-expanded')).toBe('true');
  });
});
