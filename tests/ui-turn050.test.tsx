// @vitest-environment jsdom
// TURN-050: drag a Unit handle to make a flow connection, and open the context menu.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { History } from '../src/model/history';
import type { Project } from '../src/model/types';
import { PASTE_EMPTY } from '../src/model/copyPaste';
import { ARRANGE_NEED_3 } from '../src/model/commands';
import { App } from '../src/ui/App';
import { MENU_WIDTH, menuHeight } from '../src/ui/contextMenuModel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  localStorage.clear();
});

function pos(scope: ParentNode, id: string) {
  const n = scope.querySelector(`.react-flow__node[data-id="${id}"]`) as HTMLElement | null;
  const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(n?.style.transform ?? '');
  return { x: m ? Number(m[1]) : NaN, y: m ? Number(m[2]) : NaN };
}

async function mount() {
  localStorage.clear();
  const el = document.createElement('div');
  document.body.appendChild(el);
  const seen: { h: History | null } = { h: null };
  root = createRoot(el);
  await act(async () => { root!.render(<App onHistory={(h) => { seen.h = h; }} />); });
  const click = async (node: Element) => { await act(async () => { (node as HTMLElement).click(); }); };
  const point = async (node: Element, type: string, x: number, y: number, extra: PointerEventInit = {}) => {
    await act(async () => { node.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, ...extra })); });
  };
  const mouse = async (node: Element | Document, type: string, x: number, y: number) => {
    await act(async () => { node.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })); });
  };
  const right = async (node: Element, x = 12, y = 12) => {
    await act(async () => { node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 })); });
  };
  const key = async (keyName: string, init: KeyboardEventInit = {}) => {
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true, ...init })); });
  };
  const btn = (label: string) => [...el.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label || b.getAttribute('aria-label') === label) as HTMLButtonElement;
  const port = (device: string, dir: 'in' | 'out', portKey?: string) => el.querySelector(`.rf-port.${dir}[data-device="${device}"]${portKey ? `[data-port="${portKey}"]` : ''}`) as HTMLElement;
  await click(btn('시작하기'));
  await click(el.querySelector('.stepper [data-stepid="canvas"]')!);
  await click(el.querySelector('#layout-tab-diagram')!);
  const menu = () => document.querySelector('[data-ctx-menu]') as HTMLElement | null;
  const action = (id: string) => menu()?.querySelector(`[data-action="${id}"]`) as HTMLButtonElement | null;
  const actions = () => [...(menu()?.querySelectorAll<HTMLButtonElement>('[data-action]') ?? [])].map((b) => b.getAttribute('data-action'));
  return {
    el, click, point, mouse, right, key, btn, port, menu, action, actions,
    history: () => seen.h!,
    project: () => seen.h!.present,
    rev: () => seen.h!.present.revision,
    past: () => seen.h!.past.length,
    flows: () => seen.h!.present.connections.filter((c) => c.kind === 'flow'),
    sigs: () => seen.h!.present.connections.filter((c) => c.kind === 'signal'),
  };
}

function shape(p: Project) {
  const unitCode = (id: string) => p.units.find((u) => u.id === id)?.code ?? id;
  return {
    devices: p.devices.map((d) => `${unitCode(d.unitId)}:${d.kind}:${d.name}`).sort(),
    flows: p.connections.filter((c) => c.kind === 'flow').length,
    signals: p.connections.filter((c) => c.kind === 'signal').length,
    actions: p.actions.length,
  };
}

async function dragHandle(u: Awaited<ReturnType<typeof mount>>, fromId: string, to: Element | null, x = 40, y = 28) {
  const handle = u.el.querySelector(`[data-flow-handle="${fromId}"]`)!;
  const prev = document.elementFromPoint?.bind(document);
  document.elementFromPoint = () => to as HTMLElement;
  try {
    await u.point(handle, 'pointerdown', 4, 4);
    await act(async () => { window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y, pointerId: 1 })); });
    await act(async () => { window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x + 8, clientY: y, pointerId: 1 })); });
  } finally {
    if (prev) document.elementFromPoint = prev;
    else delete (document as { elementFromPoint?: typeof document.elementFromPoint }).elementFromPoint;
  }
}

describe('TURN-050 flow handle', () => {
  it('AC1: dragging a Unit handle onto another Unit adds one flow, one revision, and one undo', async () => {
    const u = await mount();
    const rev0 = u.rev();
    const before = u.flows().length;
    expect(u.btn('선택/이동').classList.contains('on')).toBe(true);
    await dragHandle(u, 'U-S1', u.el.querySelector('[data-id="U-S3"]'));
    const added = u.flows().filter((c) => !c.id.startsWith('FLOW-'));
    expect(added).toHaveLength(1);
    expect(added[0].kind).toBe('flow');
    expect(added[0].from.nodeId).toBe('U-S1');
    expect(added[0].to.nodeId).toBe('U-S3');
    expect(u.flows()).toHaveLength(before + 1);
    expect(u.rev()).toBe(rev0 + 1);
    expect(u.past()).toBe(1);
    expect(u.btn('선택/이동').classList.contains('on')).toBe(true);
    await u.click(u.btn('실행 취소'));
    expect(u.flows()).toHaveLength(before);
    expect(u.rev()).toBe(rev0);
    expect(u.past()).toBe(0);
  });

  it('AC2: a handle drag does not move the Unit, and a body drag still does', async () => {
    const u = await mount();
    const before = pos(u.el, 'U-S1');
    const rev0 = u.rev();
    await dragHandle(u, 'U-S1', null);
    expect(pos(u.el, 'U-S1')).toEqual(before);
    expect(u.rev()).toBe(rev0);
    const body = u.el.querySelector('[data-id="U-S1"] .rf-unit')!;
    await u.point(body, 'pointerdown', before.x + 30, before.y + 20);
    await u.point(body, 'pointermove', before.x + 70, before.y + 20);
    await u.point(body, 'pointerup', before.x + 70, before.y + 20);
    expect(pos(u.el, 'U-S1').x - before.x).toBe(40);
  });

  it('AC2: an out port still drags a signal onto an in port', async () => {
    const u = await mount();
    const before = u.sigs().length;
    const from = u.port('PSH-01', 'out', 'pushDone');
    const to = u.port('CYL-01', 'in', 'cmdFwd');
    const prev = document.elementFromPoint?.bind(document);
    document.elementFromPoint = () => to;
    try {
      await u.mouse(from, 'mousedown', 4, 4);
      await u.mouse(document, 'mousemove', 40, 24);
      await u.mouse(document, 'mouseup', 40, 24);
    } finally {
      if (prev) document.elementFromPoint = prev;
    }
    expect(u.sigs()).toHaveLength(before + 1);
  });

  it('AC3: self, duplicate, a non-unit, and empty space do not add a flow', async () => {
    const u = await mount();
    const rev0 = u.rev();
    const before = u.flows().length;
    await dragHandle(u, 'U-S1', u.el.querySelector('[data-id="U-S1"]'));
    expect(u.el.querySelector('.toast')?.textContent).toContain('자기 자신');
    expect(u.flows()).toHaveLength(before);
    await dragHandle(u, 'U-S1', u.el.querySelector('[data-id="PSH-01"]'));
    expect(u.el.querySelector('.toast')?.textContent).toContain('자기 자신');
    expect(u.flows()).toHaveLength(before);
    await dragHandle(u, 'U-S1', u.el.querySelector('[data-id="U-S2"]'));
    expect(u.el.querySelector('.toast')?.textContent).toContain('이미 같은 물류 연결');
    expect(u.flows()).toHaveLength(before);
    await dragHandle(u, 'U-S1', u.el.querySelector('[data-id="STP-02"]'));
    expect(u.el.querySelector('.toast')?.textContent).toContain('이미 같은 물류 연결');
    expect(u.flows()).toHaveLength(before);
    await dragHandle(u, 'U-S1', u.el.querySelector('[data-id="runtime-material"]'));
    expect(u.el.querySelector('.toast')?.textContent).toContain('Unit → Unit');
    expect(u.flows()).toHaveLength(before);
    await dragHandle(u, 'U-S1', null);
    expect(u.flows()).toHaveLength(before);
    expect(u.rev()).toBe(rev0);
    await dragHandle(u, 'U-S1', u.el.querySelector('[data-id="CYL-03"]'));
    expect(u.flows().some((c) => c.from.nodeId === 'U-S1' && c.to.nodeId === 'U-S3' && !c.id.startsWith('FLOW-'))).toBe(true);
  });

  it('AC4: the drag shows an arrow and highlights Units that can take the connection', async () => {
    const u = await mount();
    const handle = u.el.querySelector('[data-flow-handle="U-S1"]')!;
    await u.point(handle, 'pointerdown', 4, 4);
    await act(async () => { window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 30, clientY: 16, pointerId: 1 })); });
    const line = u.el.querySelector('[data-testid="flow-preview-line"]');
    expect(u.el.querySelector('[data-testid="flow-preview"]')).toBeTruthy();
    expect(line?.getAttribute('marker-end')).toContain('arrow');
    expect(u.el.querySelector('.rf-host')?.getAttribute('data-flow-drag')).toBe('1');
    const marked = (id: string) => u.el.querySelector(`[data-id="${id}"] .rf-unit`)?.classList.contains('is-flow-target');
    expect(marked('U-S1')).toBe(false);
    expect(u.el.querySelector('[data-id="U-S1"] .rf-unit')?.classList.contains('is-flow-from')).toBe(true);
    expect(marked('U-S2')).toBe(false);
    expect(marked('U-S3')).toBe(true);
    expect(marked('U-S5')).toBe(true);
    const x2 = Number(line?.getAttribute('x2'));
    await act(async () => { window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 90, clientY: 40, pointerId: 1 })); });
    expect(Number(u.el.querySelector('[data-testid="flow-preview-line"]')?.getAttribute('x2'))).not.toBe(x2);
    await act(async () => { window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 90, clientY: 40, pointerId: 1 })); });
    expect(u.el.querySelector('[data-testid="flow-preview"]')).toBeNull();
  });

  it('AC1: a running project does not start a flow drag', async () => {
    const u = await mount();
    const rev0 = u.rev();
    const before = u.flows().length;
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
    try {
      await u.click(u.btn('▶ 실행'));
      expect(u.el.querySelector('.statusbar')?.textContent).toContain('실행 중 편집 잠금');
      await u.point(u.el.querySelector('[data-flow-handle="U-S1"]')!, 'pointerdown', 4, 4);
      expect(u.el.querySelector('.toast')?.textContent).toContain('모델 편집이 차단');
      expect(u.el.querySelector('[data-testid="flow-preview"]')).toBeNull();
      expect(u.flows()).toHaveLength(before);
      expect(u.rev()).toBe(rev0);
    } finally {
      globalThis.requestAnimationFrame = raf;
    }
  });
});

describe('TURN-050 context menu', () => {
  it('AC5: diagram Device, Unit, edge, and empty each open their menu', async () => {
    const u = await mount();
    await u.right(u.el.querySelector('[data-id="PSH-01"] .rf-device')!);
    expect(u.actions()).toEqual(['props', 'copy', 'duplicate', 'delete']);
    expect(u.action('copy')?.textContent).toContain('Ctrl/Cmd+C');
    expect(u.action('delete')?.classList.contains('danger')).toBe(true);
    const sep = u.menu()?.querySelector('hr[role="separator"]');
    expect(sep?.nextElementSibling?.getAttribute('data-action')).toBe('delete');

    await u.right(u.el.querySelector('[data-id="U-S2"] .rf-unit')!);
    expect(u.actions()).toEqual(['props', 'rename', 'copy', 'paste', 'arrange', 'fit', 'lockPosition', 'delete']);
    expect(u.action('paste')?.textContent).toContain('붙여넣기(이 Unit 에)');
    expect(u.action('paste')?.disabled).toBe(true);
    expect(u.action('paste')?.title).toBe(PASTE_EMPTY);

    await u.right(u.el.querySelector('.react-flow__edge[data-id="FLOW-1"]')!);
    expect(u.actions()).toEqual(['props', 'delete']);
    expect(u.menu()?.getAttribute('data-ctx-kind')).toBe('edge');

    await u.right(u.el.querySelector('.react-flow__pane')!);
    expect(u.actions()).toEqual(['paste', 'selectAll', 'fitView']);
  });

  it('AC6: the tree and the card board open the same Device and Unit menus', async () => {
    const u = await mount();
    await u.right(u.el.querySelector('[data-id="PSH-01"] .rf-device')!);
    const device = u.actions();
    await u.right(u.el.querySelector('[data-tree-id="PSH-01"]')!);
    expect(u.actions()).toEqual(device);
    await u.click(u.el.querySelector('#layout-tab-board')!);
    await u.right(u.el.querySelector('.chip')!);
    expect(u.actions()).toEqual(device);

    await u.click(u.el.querySelector('#layout-tab-diagram')!);
    await u.right(u.el.querySelector('[data-id="U-S1"] .rf-unit')!);
    const unit = u.actions();
    await u.right(u.el.querySelector('[data-tree-id="U-S1"]')!);
    expect(u.actions()).toEqual(unit);
    await u.click(u.el.querySelector('#layout-tab-board')!);
    await u.right(u.el.querySelector('.station-card')!);
    expect(u.actions()).toEqual(unit);
  });

  it('AC7: menu copy then paste matches Ctrl+C / Ctrl+V', async () => {
    const menu = await mount();
    const rev0 = menu.rev();
    await menu.right(menu.el.querySelector('[data-id="PSH-01"] .rf-device')!);
    await menu.click(menu.action('copy')!);
    await menu.right(menu.el.querySelector('[data-id="U-S2"] .rf-unit')!);
    await menu.click(menu.action('paste')!);
    const fromMenu = shape(menu.project());
    expect(menu.rev()).toBe(rev0 + 1);
    expect(fromMenu.devices.some((row) => row.startsWith('S2:') && row.includes('사본'))).toBe(true);

    if (root) await act(async () => { root!.unmount(); });
    root = null;
    document.body.innerHTML = '';
    const keys = await mount();
    const dev = keys.el.querySelector('[data-id="PSH-01"] .rf-device')!;
    const unit = keys.el.querySelector('[data-id="U-S2"] .rf-unit')!;
    await keys.point(dev, 'pointerdown', 8, 8);
    await keys.point(dev, 'pointerup', 8, 8);
    await keys.key('c', { ctrlKey: true });
    await keys.point(unit, 'pointerdown', 8, 8);
    await keys.point(unit, 'pointerup', 8, 8);
    await keys.key('v', { ctrlKey: true });
    expect(shape(keys.project())).toEqual(fromMenu);
    expect(keys.rev()).toBe(rev0 + 1);
  });

  it('AC8: delete is the danger item at the bottom and opens the existing confirm dialog', async () => {
    const u = await mount();
    const rev0 = u.rev();
    await u.right(u.el.querySelector('[data-id="PSH-01"] .rf-device')!);
    const buttons = [...u.menu()!.querySelectorAll<HTMLButtonElement>('[data-action]')];
    expect(buttons[buttons.length - 1].getAttribute('data-action')).toBe('delete');
    expect(buttons[buttons.length - 1].classList.contains('danger')).toBe(true);
    expect(buttons[buttons.length - 1].textContent).toContain('삭제');
    await u.click(buttons[buttons.length - 1]);
    expect(u.menu()).toBeNull();
    expect(document.querySelector('.modal-bg')?.textContent).toContain('삭제');
    expect(document.querySelector('.modal-bg')?.textContent).toContain('참조 영향');
    expect(document.querySelector('.modal-actions button.danger')?.textContent).toContain('참조 해제 후 삭제');
    expect(u.rev()).toBe(rev0);
    await u.click([...document.querySelectorAll('.modal-actions button')].find((b) => b.textContent === '취소')!);
    expect(document.querySelector('.modal-bg')).toBeNull();
    expect(u.rev()).toBe(rev0);
    expect(u.past()).toBe(0);
  });

  it('AC9: an unselected object becomes the selection; one of a multi selection keeps it', async () => {
    const u = await mount();
    const dev = (id: string) => u.el.querySelector(`[data-id="${id}"] .rf-device`)!;
    const unit = (id: string) => u.el.querySelector(`[data-id="${id}"] .rf-unit`)!;
    await u.point(dev('PSH-01'), 'pointerdown', 6, 6);
    await u.point(dev('PSH-01'), 'pointerup', 6, 6);
    await u.right(dev('CYL-01'));
    expect(dev('CYL-01').classList.contains('is-sel')).toBe(true);
    expect(dev('PSH-01').classList.contains('is-sel')).toBe(false);
    expect(u.menu()?.getAttribute('data-ctx-kind')).toBe('device');

    await u.point(unit('U-S1'), 'pointerdown', 8, 8);
    await u.point(unit('U-S1'), 'pointerup', 8, 8);
    await u.point(unit('U-S2'), 'pointerdown', 8, 8, { ctrlKey: true });
    await u.point(unit('U-S2'), 'pointerup', 8, 8, { ctrlKey: true });
    expect(unit('U-S1').classList.contains('is-sel')).toBe(true);
    expect(unit('U-S2').classList.contains('is-sel')).toBe(true);
    await u.right(unit('U-S2'));
    expect(unit('U-S1').classList.contains('is-sel')).toBe(true);
    expect(unit('U-S2').classList.contains('is-sel')).toBe(true);
    expect(u.menu()?.getAttribute('data-ctx-kind')).toBe('multi');
    expect(u.actions()).toContain('alignLeft');
    expect(u.action('gapX')?.disabled).toBe(true);
    expect(u.action('gapX')?.title).toBe(ARRANGE_NEED_3);
    expect(u.action('delete')?.classList.contains('danger')).toBe(true);
  });

  it('AC10: Shift+F10 opens the menu, arrows and Enter use it, and Esc returns focus', async () => {
    const u = await mount();
    const tree = u.el.querySelector('[data-tree-id="PSH-01"]') as HTMLElement;
    tree.focus();
    await act(async () => { tree.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true })); });
    expect(u.menu()?.getAttribute('data-ctx-kind')).toBe('device');
    expect(document.activeElement?.getAttribute('data-action')).toBe('props');
    await u.key('ArrowDown');
    expect(document.activeElement?.getAttribute('data-action')).toBe('copy');
    await u.key('Enter');
    expect(u.menu()).toBeNull();
    expect(u.el.querySelector('.toast')?.textContent).toContain('복사');
    expect(u.rev()).toBe(u.history().present.revision);

    tree.focus();
    const rev = u.rev();
    const past = u.past();
    await act(async () => { tree.dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true })); });
    expect(u.menu()).toBeTruthy();
    await u.key('Escape');
    expect(u.menu()).toBeNull();
    expect(document.activeElement).toBe(tree);
    expect(u.rev()).toBe(rev);
    expect(u.past()).toBe(past);
  });

  it('AC11: opening and closing the menu does not edit, and a running project dims edits', async () => {
    const u = await mount();
    const rev0 = u.rev();
    const past0 = u.past();
    await u.right(u.el.querySelector('[data-id="U-S1"] .rf-unit')!);
    expect(u.menu()).toBeTruthy();
    await u.key('Escape');
    expect(u.menu()).toBeNull();
    expect(u.rev()).toBe(rev0);
    expect(u.past()).toBe(past0);

    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
    try {
      await u.click(u.btn('▶ 실행'));
      await u.right(u.el.querySelector('[data-tree-id="U-S1"]')!);
      expect(u.action('props')?.disabled).toBe(false);
      expect(u.action('copy')?.disabled).toBe(false);
      for (const id of ['rename', 'paste', 'arrange', 'fit', 'delete']) {
        expect(u.action(id)?.disabled).toBe(true);
        expect(u.action(id)?.title.length).toBeGreaterThan(0);
      }
      await u.right(u.el.querySelector('.react-flow__pane')!);
      expect(u.actions()).toEqual(['fitView', 'propsView']);
      await u.click(u.action('fitView')!);
      expect(u.rev()).toBe(rev0);
      expect(u.past()).toBe(past0);
    } finally {
      globalThis.requestAnimationFrame = raf;
    }
  });

  it('AC12: the menu opened at the corner of 1280×800 is placed inside the window', async () => {
    const prevW = window.innerWidth;
    const prevH = window.innerHeight;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    try {
      const u = await mount();
      await u.right(u.el.querySelector('.react-flow__pane')!, 1270, 790);
      const menu = u.menu()!;
      const left = parseFloat(menu.style.left);
      const top = parseFloat(menu.style.top);
      const height = menuHeight([
        { id: 'paste', label: '붙여넣기' },
        { id: 'selectAll', label: '모두 선택' },
        { id: 'fitView', label: '화면 맞춤' },
      ]);
      expect(left).toBeGreaterThanOrEqual(8);
      expect(top).toBeGreaterThanOrEqual(8);
      expect(left + MENU_WIDTH).toBeLessThanOrEqual(1280 - 8);
      expect(top + height).toBeLessThanOrEqual(800 - 8);
      expect(left).toBeLessThan(1270);
      expect(top).toBeLessThan(790);
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: prevW });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: prevH });
    }
  });

  it('AC13: a right-click on a text field does not open the app menu', async () => {
    const u = await mount();
    const unit = u.el.querySelector('[data-id="U-S1"] .rf-unit')!;
    await u.point(unit, 'pointerdown', 8, 8);
    await u.point(unit, 'pointerup', 8, 8);
    const input = u.el.querySelector('.prop-col input, .prop-more input') as HTMLElement;
    expect(input).toBeTruthy();
    await u.right(input, 6, 6);
    expect(u.menu()).toBeNull();
    expect(u.rev()).toBe(u.history().present.revision);
  });

  it('stage 6 shows only fit and property view, and property view does not edit', async () => {
    const u = await mount();
    const rev0 = u.rev();
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    await u.right(u.el.querySelector('[data-id="PSH-01"] .rf-device')!);
    expect(u.actions()).toEqual(['fitView', 'propsView']);
    await u.click(u.action('propsView')!);
    expect(u.el.querySelector('[data-prop-peek]')?.textContent).toContain('PSH-01');
    expect(u.rev()).toBe(rev0);
    expect(u.past()).toBe(0);
  });
});
