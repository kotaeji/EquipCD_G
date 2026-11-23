// @vitest-environment jsdom
// TURN-055 bundle screen. jsdom checks the controls; screenshots are taken in Chrome.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { emptyProject } from '../src/model/factory';
import type { History } from '../src/model/history';
import { serializeProject } from '../src/storage/fileFormat';
import { MemoryKV, PROJECT_KEY, loadProject } from '../src/storage/localStore';
import { exportWorkspaceBundle, parseWorkspaceBundle } from '../src/storage/workspaceBundle';
import { ensureWorkspaces, saveProjectInWorkspace } from '../src/storage/workspaces';
import { App } from '../src/ui/App';
import { BundleSheet } from '../src/ui/BundleScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  localStorage.clear();
});

const T0 = new Date('2026-11-23T00:00:00.000Z');

function mini(id: string, name: string) {
  return { ...emptyProject(name), id, name, revision: 3 };
}

function bundleText(projects: ReturnType<typeof mini>[], workspaceName = '옮긴 작업') {
  const kv = new MemoryKV();
  let reg = ensureWorkspaces(kv, T0).reg;
  const made = ensureWorkspaces(kv, T0);
  reg = made.reg;
  if (workspaceName !== reg.workspaces[0].name) {
    const renamed = { ...reg, workspaces: reg.workspaces.map((w) => (w.id === reg.activeId ? { ...w, name: workspaceName } : w)) };
    kv.setItem('ecd.v1.workspaces', JSON.stringify(renamed));
    reg = renamed;
  }
  for (const p of projects) {
    const saved = saveProjectInWorkspace(kv, reg, reg.activeId, p, T0);
    if (!saved.ok) throw new Error(saved.reason);
    reg = saved.reg;
  }
  const out = exportWorkspaceBundle(kv, reg, reg.activeId, T0);
  if ('ok' in out) throw new Error(out.reason);
  return out.text;
}

async function pickFile(input: HTMLInputElement, text: string, name = 'job.aurora-workspace.json') {
  const file = new File([text], name, { type: 'application/json' });
  await act(async () => {
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
  });
}

function btn(el: ParentNode, label: string) {
  return [...el.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label) as HTMLButtonElement;
}

async function mountSheet(kv: MemoryKV | null, reg = ensureWorkspaces(kv ?? new MemoryKV(), T0).reg, extra?: { dirty?: string[]; openIds?: string[]; storageReason?: string | null }) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const downloaded: { name: string; text: string }[] = [];
  const committed: unknown[] = [];
  root = createRoot(el);
  await act(async () => {
    root!.render(<BundleSheet
      kv={kv}
      reg={reg}
      dirtyNames={extra?.dirty ?? []}
      openIds={extra?.openIds ?? []}
      storageReason={extra?.storageReason ?? (kv ? null : 'localStorage 없음')}
      onDownload={(name, text) => downloaded.push({ name, text })}
      onCommitted={(r) => committed.push(r)}
      onSwitch={() => {}}
    />);
  });
  return { el, downloaded, committed };
}

describe('TURN-055 bundle screen', () => {
  it('AC11 the bundle screen has no 준비 중 notice, and memory-only disables both buttons', async () => {
    const { el } = await mountSheet(null);
    expect(el.textContent).not.toContain('준비 중');
    expect(el.textContent).toContain('localStorage 없음');
    expect(el.textContent).toContain('메모리 전용');
    expect(btn(el, '묶음 내보내기').disabled).toBe(true);
    expect(btn(el, '묶음 파일 고르기').disabled).toBe(true);
    expect(el.querySelector('[data-screen-note="S04"]')).toBeNull();
  });

  it('AC1 the export list shows name, rev, saved time, and the file size', async () => {
    const kv = new MemoryKV();
    let reg = ensureWorkspaces(kv, T0).reg;
    const saved = saveProjectInWorkspace(kv, reg, reg.activeId, mini('prj-a', '알파'), T0);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    reg = saved.reg;
    const { el, downloaded } = await mountSheet(kv, reg, { dirty: ['알파'] });
    const row = el.querySelector('[data-export-project="prj-a"]')!;
    expect(row.textContent).toContain('알파');
    expect(row.textContent).toContain('3');
    expect(el.querySelector('[data-bundle-bytes]')!.textContent).toMatch(/^\d+바이트$/);
    expect(el.textContent).toContain('저장 안 된 변경은 빠집니다');
    await act(async () => { btn(el, '묶음 내보내기').click(); });
    expect(document.activeElement?.textContent).toBe('취소');
    expect(downloaded).toHaveLength(0);
    await act(async () => { btn(el, '그래도 내보내기').click(); });
    expect(downloaded).toHaveLength(1);
    expect(downloaded[0].name.endsWith('.aurora-workspace.json')).toBe(true);
    const parsed = parseWorkspaceBundle(downloaded[0].text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.bundle.projects).toHaveLength(1);
    expect(downloaded[0].text).not.toContain('ecd.v1.draft');
  });

  it('AC5 overwrite asks, starts on 취소, and writes only after 덮어쓰기', async () => {
    const kv = new MemoryKV();
    let reg = ensureWorkspaces(kv, T0).reg;
    const saved = saveProjectInWorkspace(kv, reg, reg.activeId, mini('prj-a', '원래'), T0);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    reg = saved.reg;
    const text = bundleText([{ ...mini('prj-a', '바꾼이름') }]);
    const { el } = await mountSheet(kv, reg, { openIds: ['prj-a'] });
    await pickFile(el.querySelector('[data-bundle-file]') as HTMLInputElement, text);
    expect(el.querySelector('[data-verdict="conflict"]')!.textContent).toContain('같은 ID 있음');
    const before = kv.getItem(PROJECT_KEY('prj-a'));
    const select = el.querySelector('select') as HTMLSelectElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'overwrite');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => { btn(el, '가져오기').click(); });
    expect(document.activeElement?.textContent).toBe('취소');
    expect(kv.getItem(PROJECT_KEY('prj-a'))).toBe(before);
    await act(async () => { btn(el, '취소').click(); });
    expect(kv.getItem(PROJECT_KEY('prj-a'))).toBe(before);
    await act(async () => { btn(el, '가져오기').click(); });
    await act(async () => { (el.querySelector('[data-overwrite-confirm]') as HTMLButtonElement).click(); });
    const loaded = loadProject(kv, 'prj-a');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.project.name).toBe('바꾼이름');
    expect(el.querySelector('[data-bundle-summary]')!.textContent).toBe('들어옴 0 · 사본 0 · 건너뜀 0 · 덮어씀 1 · 격리 0');
    expect(el.textContent).toContain('저장본이 바뀌었습니다 — 다시 열어 주세요');
  });

  it('AC7 a broken file is refused in three lines and the store stays', async () => {
    const kv = new MemoryKV();
    const reg = ensureWorkspaces(kv, T0).reg;
    const before = kv.getItem('ecd.v1.workspaces');
    const { el } = await mountSheet(kv, reg);
    await pickFile(el.querySelector('[data-bundle-file]') as HTMLInputElement, '{');
    const problem = el.querySelector('[data-problem]')!;
    expect(problem.querySelector('[data-problem-what]')!.textContent).toContain('묶음 파일을 열지 않았습니다');
    expect(problem.querySelector('[data-problem-why]')!.textContent).toContain('JSON');
    expect(problem.querySelector('[data-problem-how]')!.textContent).toContain('저장소는 바꾸지 않았습니다');
    expect(kv.getItem('ecd.v1.workspaces')).toBe(before);
    expect(el.querySelector('[data-bundle-summary]')).toBeNull();
  });

  it('AC10 the summary counts match and an imported project is listed as saved', async () => {
    const text = bundleText([mini('prj-in', '들어온 설계'), mini('prj-in-2', '둘째 설계')], '가져온 묶음');
    localStorage.clear();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const seen: { h: History | null } = { h: null };
    root = createRoot(el);
    await act(async () => { root!.render(<App onHistory={(h) => { seen.h = h; }} />); });
    const click = async (node: Element) => { await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
    const find = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label)!;
    await click(el.querySelector('#explorer-tab-workspace')!);
    await click(find('파일 묶음'));
    expect(el.textContent).not.toContain('준비 중');
    const projectsBefore = localStorage.getItem(PROJECT_KEY('prj-in'));
    await pickFile(el.querySelector('[data-bundle-file]') as HTMLInputElement, text);
    expect(el.querySelectorAll('[data-verdict="new"]')).toHaveLength(2);
    expect(localStorage.getItem(PROJECT_KEY('prj-in'))).toBe(projectsBefore);
    await click(find('가져오기'));
    expect(el.querySelector('[data-bundle-summary]')!.textContent).toBe('들어옴 2 · 사본 0 · 건너뜀 0 · 덮어씀 0 · 격리 0');
    await click(find('바꾸기'));
    const closeFresh = find('닫고 전환');
    if (closeFresh) await click(closeFresh);
    await click(find('닫기'));
    await click(el.querySelector('#explorer-tab-project')!);
    expect(el.querySelector('.save-chip')!.textContent).toBe('저장됨');
    expect(el.textContent).toContain('들어온 설계');
    const detailBtn = el.querySelector('[aria-label="들어온 설계 프로젝트 상세"]') as HTMLButtonElement;
    await click(detailBtn);
    expect(el.textContent).toContain('저장됨 rev 3');
    expect(seen.h!.present.name === '들어온 설계' || seen.h!.present.name === '둘째 설계').toBe(true);
    expect(serializeProject(seen.h!.present)).toBe(localStorage.getItem(PROJECT_KEY(seen.h!.present.id)));
  });

  it('bulk skip leaves the conflicting project out of the summary', async () => {
    const kv = new MemoryKV();
    let reg = ensureWorkspaces(kv, T0).reg;
    const saved = saveProjectInWorkspace(kv, reg, reg.activeId, mini('prj-a', '원래'), T0);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const text = bundleText([mini('prj-a', '파일'), mini('prj-b', '새것')]);
    const { el } = await mountSheet(kv, saved.reg);
    await pickFile(el.querySelector('[data-bundle-file]') as HTMLInputElement, text);
    await act(async () => { btn(el, '모두 건너뛰기').click(); });
    await act(async () => { btn(el, '가져오기').click(); });
    expect(el.querySelector('[data-bundle-summary]')!.textContent).toBe('들어옴 1 · 사본 0 · 건너뜀 1 · 덮어씀 0 · 격리 0');
    expect(loadProject(kv, 'prj-a').ok && (loadProject(kv, 'prj-a') as { project: { name: string } }).project.name).toBe('원래');
  });
});

