// @vitest-environment jsdom
// TURN-009: layout card board and diagram share the TURN-008 tab control. jsdom, not a browser.
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ASSET_LIBRARY } from '../src/assets/library';
import type { History } from '../src/model/history';
import { serializeProject } from '../src/storage/fileFormat';
import { App } from '../src/ui/App';
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
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label || b.getAttribute('aria-label') === label) as HTMLButtonElement;
  const tab = (id: 'board' | 'diagram') => el.querySelector(`#layout-tab-${id}`) as HTMLButtonElement;
  const panel = (id: 'board' | 'diagram') => el.querySelector(`#layout-panel-${id}`) as HTMLElement;
  const start = btn('시작하기');
  if (start) {
    await click(start);
    await click(el.querySelector('.stepper [data-stepid="canvas"]')!);
  }
  return { el, click, key, btn, tab, panel, history: () => seen.h! };
}

async function drag(from: Element, to: Element) {
  const dt = {
    store: {} as Record<string, string>,
    setData(type: string, value: string) { this.store[type] = value; },
    getData(type: string) { return this.store[type] ?? ''; },
    effectAllowed: 'copy',
  };
  const fire = async (node: Element, type: string) => {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: dt });
    Object.defineProperty(ev, 'clientX', { value: 160 });
    Object.defineProperty(ev, 'clientY', { value: 120 });
    await act(async () => { node.dispatchEvent(ev); });
  };
  await fire(from, 'dragstart');
  await fire(to, 'dragover');
  await fire(to, 'drop');
}

describe('TURN-009 layout tabs', () => {
  it('AC1: the shared tabs sit under the open palette, and only the card board shows at first', async () => {
    const u = await mount();
    const palette = u.el.querySelector('.palette-fold')!;
    const list = u.el.querySelector('.layout-tabs [role=tablist]')!;
    expect(palette.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(palette.className).toContain('palette-fold');
    expect((palette as HTMLDetailsElement).open).toBe(true);
    expect([...u.el.querySelectorAll('.layout-tabs [role=tab]')].map((t) => t.textContent)).toEqual(['카드 보드', '도면 도식']);
    expect(list.getAttribute('aria-label')).toBe('배치·연결');
    expect(list.className).toBe('ui-tabs');
    expect(u.tab('board').getAttribute('aria-selected')).toBe('true');
    expect(u.panel('board').hasAttribute('hidden')).toBe(false);
    expect(u.panel('diagram').hasAttribute('hidden')).toBe(true);
    expect(u.panel('board').querySelector('.board')).not.toBeNull();
    expect(u.panel('board').textContent).toContain('도면 도식 탭에서');
    expect(u.panel('board').textContent).not.toContain('아래 도면에서');
    expect(u.panel('diagram').querySelector('.diagram-canvas .react-flow')).not.toBeNull();
    expect(u.panel('diagram').querySelector('.diagram-tools')).not.toBeNull();
    expect(u.el.querySelector('.diagram-fold')).toBeNull();
    expect(u.el.querySelector('.stage.layout-stage details')).toBe(palette);
    await u.key(u.tab('board'), 'ArrowRight');
    expect(u.tab('diagram').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(u.tab('diagram'));
    expect(u.panel('board').hasAttribute('hidden')).toBe(true);
    expect(u.panel('diagram').hasAttribute('hidden')).toBe(false);
    await u.click(u.tab('board'));
    expect(u.panel('diagram').hasAttribute('hidden')).toBe(true);
    const rule = css.slice(css.indexOf('.ui-tabs [role="tab"][aria-selected="true"]'));
    expect(rule).toMatch(/color:\s*var\(--accent\)/);
    expect(css).not.toMatch(/\.layout-tabs \[role="tab"\]/);
    expect(css).toMatch(/\.layout-tabs \.diagram-canvas \{[^}]*min-height:\s*360px/);
    expect(css).toMatch(/\.stage\.layout-stage \{[^}]*overflow:\s*hidden/);
  });

  it('AC2: signal mode opens the diagram tab and a card selection stays across the switch', async () => {
    const u = await mount();
    const chip = u.el.querySelector('.station-card .chip') as HTMLButtonElement;
    const name = chip.textContent ?? '';
    await u.click(chip);
    expect(chip.classList.contains('on')).toBe(true);
    const id = u.history().present.devices.find((d) => name.startsWith(d.name))!.id;
    await u.click(u.tab('diagram'));
    expect(chip.classList.contains('on')).toBe(true);
    expect(u.el.querySelector(`[data-id="${id}"] .rf-device.is-sel`)).not.toBeNull();
    await u.click(u.tab('board'));
    expect(u.tab('board').getAttribute('aria-selected')).toBe('true');
    expect(chip.classList.contains('on')).toBe(true);
    await u.click(u.btn('신호 연결'));
    expect(u.tab('diagram').getAttribute('aria-selected')).toBe('true');
    expect(u.panel('board').hasAttribute('hidden')).toBe(true);
    expect(u.el.querySelector('.tool-pills button.on')!.textContent).toBe('신호 연결');
    expect(chip.classList.contains('on')).toBe(true);
    expect(u.el.querySelector(`[data-id="${id}"] .rf-device.is-sel`)).not.toBeNull();
  });

  it('AC3: both tabs accept a palette drop, and the board still connects with two clicks', async () => {
    const u = await mount();
    const units = () => u.history().present.units.length;
    const devices = () => u.history().present.devices.length;
    const flows = () => u.history().present.connections.filter((c) => c.kind === 'flow').length;
    const beforeUnits = units();
    const beforeFlows = flows();
    const idsBefore = new Set(u.history().present.units.map((x) => x.id));
    await drag(u.el.querySelector('.palette .pi')!, u.panel('board').querySelector('.board-row')!);
    expect(units()).toBe(beforeUnits + 1);
    const added = u.history().present.units.find((x) => !idsBefore.has(x.id))!;
    const host = u.history().present.units.find((x) => idsBefore.has(x.id))!;
    const device = ASSET_LIBRARY.find((a) => !a.template)!;
    const pi = u.el.querySelector(`.palette .pi[title="${device.id}@${device.version}"]`)!;
    const beforeDevices = devices();
    await drag(pi, u.panel('board').querySelector('.station-card')!);
    expect(devices()).toBe(beforeDevices + 1);
    await u.click(u.btn('물류 연결'));
    const cardOf = (code: string) => [...u.panel('board').querySelectorAll('.station-card')].find((c) => {
      const h = c.querySelector('h3')?.textContent ?? '';
      return h === code || h.startsWith(`${code} `);
    })!;
    await u.click(cardOf(host.code));
    await u.click(cardOf(added.code));
    expect(flows()).toBe(beforeFlows + 1);
    expect(u.panel('board').querySelector('.path-note')!.textContent).toContain('물류 경로');
    const rev = u.history().present.revision;
    await u.click(u.tab('diagram'));
    await drag(u.el.querySelector('.palette .pi')!, u.panel('diagram').querySelector('.rf-host')!);
    expect(units()).toBe(beforeUnits + 2);
    expect(u.history().present.revision).toBe(rev + 1);
    await u.click(u.btn('실사풍(AI)', u.panel('diagram')));
    expect(u.panel('diagram').querySelectorAll('svg image').length).toBeGreaterThan(0);
    await u.click(u.btn('도식', u.panel('diagram')));
    expect(u.panel('diagram').querySelectorAll('svg image').length).toBe(0);
    expect(u.history().present.revision).toBe(rev + 1);
    const align = [...u.panel('diagram').querySelectorAll('.diagram-tools button')].find((b) => (b.textContent ?? '').includes('좌 정렬'))!;
    const del = u.panel('diagram').querySelector('.diagram-tools .danger')!;
    expect(align).toBeTruthy();
    expect(del).toBeTruthy();
  });

  it('AC5: the chosen tab survives a remount and stays out of the project JSON', async () => {
    localStorage.setItem('ecd.v1.userView', JSON.stringify({ layoutTab: 'later', home: false, step: 'canvas' }));
    expect(loadView(localStorage).layoutTab).toBe('board');
    localStorage.clear();
    const u = await mount();
    const before = serializeProject(u.history().present);
    expect(loadView(localStorage).layoutTab).toBe('board');
    expect(u.tab('board').getAttribute('aria-selected')).toBe('true');
    await u.click(u.tab('diagram'));
    expect(JSON.parse(localStorage.getItem('ecd.v1.userView')!).layoutTab).toBe('diagram');
    expect(serializeProject(u.history().present)).toBe(before);
    expect(before).not.toContain('layoutTab');
    await u.click(u.el.querySelector('.header button.btn-main.primary')!);
    const projectKey = Object.keys(localStorage).find((k) => k.startsWith('ecd.v1.project.'))!;
    expect(localStorage.getItem(projectKey)).not.toContain('layoutTab');
    await act(async () => { root!.unmount(); });
    root = null;
    const again = await mount({ fresh: false });
    expect(again.tab('diagram').getAttribute('aria-selected')).toBe('true');
    expect(again.panel('board').hasAttribute('hidden')).toBe(true);
    expect(loadView(localStorage).layoutTab).toBe('diagram');
    expect(again.el.querySelector('#explorer-tab-project')!.getAttribute('aria-selected')).toBe('true');
  });
});
