// @vitest-environment jsdom
// TURN-008: explorer Workspace/Project tabs and the work line. jsdom, not a browser.
import { readFileSync } from 'node:fs';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { History } from '../src/model/history';
import { serializeProject } from '../src/storage/fileFormat';
import { App } from '../src/ui/App';
import { Tabs } from '../src/ui/Tabs';
import { loadView } from '../src/ui/viewSettings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const css = readFileSync('src/ui/styles.css', 'utf8');
let root: Root | null = null;
afterEach(async () => {
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
  const click = async (node: Element) => { await act(async () => { (node as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
  const key = async (node: Element, k: string) => { await act(async () => { node.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); }); };
  const type = async (inp: HTMLInputElement, v: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(inp, v);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label || b.getAttribute('aria-label') === label) as HTMLButtonElement;
  const tab = (id: string) => el.querySelector(`#explorer-tab-${id}`) as HTMLButtonElement;
  const panel = (id: string) => el.querySelector(`#explorer-panel-${id}`) as HTMLElement;
  return { el, click, key, type, btn, tab, panel, history: () => seen.h! };
}

describe('TURN-008 shared tabs', () => {
  it('AC1: Tabs exposes a tablist, shows one panel, and moves with the arrow keys', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const seen: string[] = [];
    function Harness() {
      const [value, setValue] = useState<'a' | 'b'>('a');
      return <Tabs label="예시" idBase="demo" value={value} onChange={(id) => { seen.push(id); setValue(id); }} tabs={[
        { id: 'a', label: '가', panel: <p>가 내용</p> },
        { id: 'b', label: '나', panel: <p>나 내용</p> },
      ]} />;
    }
    root = createRoot(host);
    await act(async () => { root!.render(<Harness />); });
    const tabs = [...host.querySelectorAll('[role=tab]')];
    expect(host.querySelector('[role=tablist]')!.getAttribute('aria-label')).toBe('예시');
    expect(tabs.map((t) => t.textContent)).toEqual(['가', '나']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].getAttribute('tabindex')).toBe('-1');
    expect(host.querySelector('#demo-panel-b')!.hasAttribute('hidden')).toBe(true);
    expect(host.querySelector('#demo-panel-a')!.hasAttribute('hidden')).toBe(false);
    await act(async () => { tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
    expect(seen[seen.length - 1]).toBe('b');
    expect(host.querySelector('#demo-tab-b')!.getAttribute('aria-selected')).toBe('true');
    expect(host.querySelector('#demo-panel-a')!.hasAttribute('hidden')).toBe(true);
    expect(document.activeElement).toBe(host.querySelector('#demo-tab-b'));
    const rule = css.slice(css.indexOf('.ui-tabs [role="tab"][aria-selected="true"]'));
    expect(rule).toMatch(/color:\s*var\(--accent\)/);
    expect(rule).toMatch(/font-weight:\s*600/);
    expect(rule).toMatch(/border-bottom-color:\s*var\(--accent\)/);
    expect(css).toMatch(/\.ui-tabs \[role="tab"\] \{[^}]*color:\s*var\(--muted\)/);
    expect(css).toMatch(/border-bottom:\s*2px solid transparent/);
  });
});

describe('TURN-008 explorer', () => {
  it('AC1 AC3: Workspace then Project, click and arrows swap the visible panel, Project holds the project tools and the tree', async () => {
    const u = await mount();
    const tabs = [...u.el.querySelectorAll('.explorer [role=tab]')];
    expect(tabs.map((t) => t.textContent)).toEqual(['Workspace', 'Project']);
    expect(u.tab('project').getAttribute('aria-selected')).toBe('true');
    expect(u.panel('project').hasAttribute('hidden')).toBe(false);
    expect(u.panel('workspace').hasAttribute('hidden')).toBe(true);
    expect(u.panel('project').textContent).toContain('Workspace:');
    expect(u.panel('project').textContent).toContain('프로젝트 (');
    expect(u.panel('project').textContent).toContain('장비 구조');
    expect(u.panel('project').textContent).not.toContain('저장된 프로젝트');
    expect(u.panel('project').textContent).not.toContain('+ 빈 프로젝트');
    expect(u.panel('project').querySelector('[role=tree]')).not.toBeNull();
    expect(u.panel('project').textContent).toContain('모두 펼치기');
    await u.click(u.btn('프로젝트 추가', u.panel('project')));
    const menu = u.panel('project').querySelector('[role=menu]')!;
    expect(menu.textContent).toContain('빈 프로젝트');
    expect(menu.textContent).toContain('5공정 예제');
    expect(menu.textContent).toContain('병렬 예제');
    expect(menu.textContent).toContain('JSON 가져오기');
    expect(menu.textContent).toContain('프로젝트 파일');
    await u.key(menu, 'Escape');
    await u.click(u.tab('workspace'));
    expect(u.tab('workspace').getAttribute('aria-selected')).toBe('true');
    expect(u.panel('workspace').hasAttribute('hidden')).toBe(false);
    expect(u.panel('project').hasAttribute('hidden')).toBe(true);
    expect(u.panel('workspace').textContent).toContain('이 브라우저의 작업 묶음. 다른 PC와 자동 공유되지 않습니다.');
    expect(u.panel('workspace').textContent).toContain('+ 새 Workspace');
    expect(u.panel('workspace').textContent).toContain('파일 묶음');
    expect(u.panel('workspace').textContent).toContain('공통 탐색');
    expect(u.panel('workspace').textContent).toContain('작업 시작 화면');
    await u.key(u.tab('workspace'), 'ArrowRight');
    expect(u.tab('project').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(u.tab('project'));
    await u.key(u.tab('project'), 'ArrowLeft');
    expect(u.tab('workspace').getAttribute('aria-selected')).toBe('true');
  });

  it('AC5: the work line shows Workspace, Project, rev, and flips between 저장됨 and ● 저장 안 됨', async () => {
    const u = await mount();
    const bar = u.el.querySelector('.workbar')!;
    const chip = () => bar.querySelector('.save-chip')!;
    const dot = () => u.el.querySelector('.header .save-dot');
    expect(bar.textContent).toContain('Workspace');
    expect(bar.textContent).toContain(`Project ${u.history().present.name}`);
    expect(bar.querySelector('.work-rev')!.textContent).toBe(`rev ${u.history().present.revision}`);
    expect(chip().textContent).toBe('● 저장 안 됨');
    expect(chip().className).toContain('dirty');
    expect(dot()).not.toBeNull();
    await u.click(u.el.querySelector('.header button.btn-main.primary')!);
    expect(chip().textContent).toBe('저장됨');
    expect(chip().className).toContain('saved');
    expect(dot()).toBeNull();
    const name0 = u.history().present.name;
    await u.click(u.btn(`${name0} 프로젝트 상세`));
    await u.click(u.btn(`${name0} 이름 변경`));
    const nameDlg = [...u.el.querySelectorAll<HTMLElement>('[role=dialog]')].find((d) => d.querySelector('input'))!;
    await u.type(nameDlg.querySelector('input') as HTMLInputElement, '바뀐 작업');
    await u.click(u.btn('이름 변경', nameDlg));
    expect(chip().textContent).toBe('● 저장 안 됨');
    expect(bar.textContent).toContain('Project 바뀐 작업');
    expect(dot()).not.toBeNull();
    await u.click(u.el.querySelector('.header button.btn-main.primary')!);
    expect(chip().textContent).toBe('저장됨');
    expect(dot()).toBeNull();
    await u.click(bar.querySelectorAll('.work-crumb')[0]);
    expect(u.tab('workspace').getAttribute('aria-selected')).toBe('true');
    await u.click(bar.querySelectorAll('.work-crumb')[1]);
    expect(u.tab('project').getAttribute('aria-selected')).toBe('true');
  });

  it('AC7: the explorer tab stays after a remount and is not written into the project JSON', async () => {
    const u = await mount();
    const before = serializeProject(u.history().present);
    expect(loadView(localStorage).explorerTab).toBe('project');
    await u.click(u.tab('workspace'));
    expect(JSON.parse(localStorage.getItem('ecd.v1.userView')!).explorerTab).toBe('workspace');
    expect(serializeProject(u.history().present)).toBe(before);
    expect(before).not.toContain('explorerTab');
    await u.click(u.el.querySelector('.header button.btn-main.primary')!);
    const projectKey = Object.keys(localStorage).find((k) => k.startsWith('ecd.v1.project.'))!;
    expect(localStorage.getItem(projectKey)).not.toContain('explorerTab');
    await act(async () => { root!.unmount(); });
    root = null;
    const again = await mount({ fresh: false });
    expect(again.tab('workspace').getAttribute('aria-selected')).toBe('true');
    expect(again.panel('project').hasAttribute('hidden')).toBe(true);
    expect(loadView(localStorage).explorerTab).toBe('workspace');
  });
});
