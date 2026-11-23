// @vitest-environment jsdom
// TURN-073: flow-table menu and drag. jsdom, not a browser.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import * as C from '../src/model/commands';
import { nodeKey } from '../src/model/flow';
import type { History } from '../src/model/history';
import type { FlowNode } from '../src/model/types';
import { App } from '../src/ui/App';
import { dropSlots, listKeyFor, nearestSlot, readMeasuredRow } from '../src/ui/flowDrag';
import { EDIT_LOCKED } from '../src/ui/contextMenuModel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  localStorage.clear();
});

function rect(top: number, height: number, width = 480) {
  return { x: 0, y: top, top, left: 0, right: width, bottom: top + height, width, height, toJSON() { return {}; } };
}

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
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim() === label || b.getAttribute('aria-label') === label);
  const flowTable = () => el.querySelector('table[aria-label="Station 흐름"]') as HTMLTableElement;
  const rows = (kind: string) => [...flowTable().querySelectorAll<HTMLTableRowElement>(`tbody tr[data-flow-kind="${kind}"]`)];
  const right = async (node: Element, x = 24, y = 24) => {
    await act(async () => { node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 })); });
  };
  const key = async (keyName: string, init: KeyboardEventInit = {}) => {
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true, ...init })); });
  };
  const menu = () => document.querySelector('[data-ctx-menu]') as HTMLElement | null;
  const action = (id: string) => menu()?.querySelector<HTMLButtonElement>(`[data-action="${id}"]`) ?? null;
  const actions = () => [...(menu()?.querySelectorAll<HTMLButtonElement>('[data-action]') ?? [])].map((b) => b.getAttribute('data-action'));
  const stack = () => {
    const table = flowTable();
    const body = [...table.querySelectorAll<HTMLTableRowElement>('tbody tr')];
    const rowH = 40;
    body.forEach((row, i) => { row.getBoundingClientRect = () => rect(i * rowH, rowH); });
    const height = body.length * rowH;
    table.getBoundingClientRect = () => rect(0, height);
    return body;
  };
  const point = async (node: Element | Window, type: string, y: number, x = 12) => {
    await act(async () => { node.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0 })); });
  };
  return {
    el, click, btn, flowTable, rows, right, key, menu, action, actions, stack, point,
    history: () => seen.h!,
    project: () => seen.h!.present,
    rev: () => seen.h!.present.revision,
    past: () => seen.h!.past.length,
  };
}

async function openFlow() {
  const u = await mount();
  await u.click(u.btn('흐름 예제'));
  await u.click(u.el.querySelector('.stepper [data-stepid="sequence"]'));
  return u;
}

function flowKeys(nodes: FlowNode[] | undefined) {
  return (nodes ?? []).map(nodeKey);
}

describe('TURN-073 flow table menu', () => {
  it('AC1 right-click on a step, a block, an arm, a substation step, and a wait opens that row and runs the same command', async () => {
    const u = await openFlow();
    const rev0 = u.rev();
    const step = u.rows('step')[1];
    const stepId = step.dataset.nodeId!;
    expect(step.querySelector('input[type="checkbox"]')!.getAttribute('checked') === null || !(step.querySelector('input') as HTMLInputElement).checked).toBe(true);
    await u.right(step);
    expect(u.menu()?.getAttribute('data-ctx-kind')).toBe('flow-step');
    expect(u.actions()).toEqual(['up', 'down', 'out', 'into', 'wrapBranch', 'wrapParallel', 'wrapLoop', 'wrapRetry', 'unwrap', 'rename', 'openAction', 'delete']);
    expect((step.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
    expect(u.action('up')!.disabled).toBe(false);
    expect(u.action('unwrap')!.disabled).toBe(true);
    expect(u.action('unwrap')!.title).toBe('블록 없음');
    expect(u.action('rename')!.title).toBe('이 줄은 이름을 바꾸지 않습니다');
    expect(u.action('delete')!.classList.contains('danger')).toBe(true);
    expect(u.menu()!.querySelector('hr[role="separator"]')!.nextElementSibling!.getAttribute('data-action')).toBe('delete');
    const expected = C.moveFlowNode(u.project(), stepId, -1);
    await u.click(u.action('up'));
    expect(u.menu()).toBeNull();
    expect(expected.ok).toBe(true);
    if (!expected.ok) return;
    expect(u.project().sequence.flow).toEqual(expected.project.sequence.flow);
    expect(u.rev()).toBe(rev0 + 1);

    await u.click(u.el.querySelector('[aria-label="실행 취소"]'));
    const fresh = u.project();
    const buttonRow = u.rows('step')[1];
    await u.click([...buttonRow.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '위로'));
    expect(u.project().sequence.flow).toEqual(C.moveFlowNode(fresh, stepId, -1).ok ? (C.moveFlowNode(fresh, stepId, -1) as { project: typeof fresh }).project.sequence.flow : fresh.sequence.flow);
    expect(u.rev()).toBe(rev0 + 1);
  });

  it('AC1 a block, an arm, a substation step, and a wait use their own commands', async () => {
    const u = await openFlow();
    const branch = u.rows('branch')[0];
    await u.right(branch);
    expect(u.menu()?.getAttribute('data-ctx-kind')).toBe('flow-block');
    expect(u.action('unwrap')!.disabled).toBe(false);
    expect(u.action('rename')!.disabled).toBe(false);
    expect(u.action('openAction')!.title).toBe('이 줄에는 Action이 없습니다');
    expect(u.action('delete')!.title).toBe('블록은 「블록 풀기」로 안의 줄을 남깁니다');
    const rev = u.rev();
    await u.click(u.action('rename'));
    expect(document.activeElement?.getAttribute('aria-label')).toBe('분기 이름');
    expect(u.rev()).toBe(rev);
    const beforeUnwrap = structuredClone(u.project());
    await u.right(u.rows('branch')[0]);
    const unwrapped = C.unwrapFlow(u.project(), 'FLW-BRANCH');
    await u.click(u.action('unwrap'));
    expect(unwrapped.ok).toBe(true);
    if (!unwrapped.ok) return;
    expect(u.project().sequence.flow).toEqual(unwrapped.project.sequence.flow);
    expect(u.rows('branch')).toHaveLength(0);
    await u.click(u.el.querySelector('[aria-label="실행 취소"]'));
    expect(u.project().sequence.flow).toEqual(beforeUnwrap.sequence.flow);

    const step = u.rows('step')[0];
    const stepId = step.dataset.nodeId!;
    await u.click(step.querySelector('input[type="checkbox"]'));
    await u.click(u.rows('step')[1].querySelector('input[type="checkbox"]'));
    await u.right(u.rows('step')[0]);
    expect((u.rows('step')[0].querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
    expect((u.rows('step')[1].querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
    await u.key('Escape');

    const arm = u.rows('arm').find((r) => r.dataset.listKey === listKeyFor('FLW-BRANCH', 'else'))!;
    await u.right(arm);
    expect(u.menu()?.getAttribute('data-ctx-kind')).toBe('flow-arm');
    expect(u.action('up')!.title).toBe('갈래는 옮기지 않습니다');
    expect(u.action('into')!.disabled).toBe(false);
    const into = C.moveFlowInto(u.project(), stepId, 'FLW-BRANCH', 'else');
    await u.click(u.action('into'));
    expect(into.ok).toBe(true);
    if (!into.ok) return;
    expect(u.project().sequence.flow).toEqual(into.project.sequence.flow);

    await u.click(u.btn('Substation 시퀀스 넣기'));
    const sub = u.rows('substation')[0];
    expect(sub).toBeTruthy();
    await u.right(sub);
    expect(u.menu()?.getAttribute('data-ctx-kind')).toBe('flow-substation');
    const subId = sub.dataset.nodeId!;
    const removed = C.unwrapFlow(u.project(), subId);
    await u.click(u.action('unwrap'));
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(u.project().sequence.flow).toEqual(removed.project.sequence.flow);
    expect(u.rows('substation')).toHaveLength(0);

    await u.click(u.btn('신호 기다림 추가'));
    const wait = u.rows('wait')[0];
    await u.right(wait);
    expect(u.menu()?.getAttribute('data-ctx-kind')).toBe('flow-wait');
    expect(u.action('unwrap')!.title).toBe('신호 기다림은 삭제로 뺍니다');
    expect(u.action('delete')!.disabled).toBe(false);
    const waitId = wait.dataset.nodeId!;
    const gone = C.unwrapFlow(u.project(), waitId);
    await u.click(u.action('delete'));
    expect(gone.ok).toBe(true);
    if (!gone.ok) return;
    expect(u.project().sequence.flow).toEqual(gone.project.sequence.flow);
    expect(u.rows('wait')).toHaveLength(0);
  });

  it('AC1 3단계 Action 열기 moves to that Action and does not edit', async () => {
    const u = await openFlow();
    const rev = u.rev();
    const past = u.past();
    const step = u.rows('step')[0];
    const stepId = step.dataset.nodeId!;
    const actionId = u.project().sequence.steps.find((s) => s.id === stepId)!.actionId;
    const name = u.project().actions.find((a) => a.id === actionId)!.name;
    await u.right(step);
    expect(u.action('openAction')!.disabled).toBe(false);
    await u.click(u.action('openAction'));
    expect(u.el.querySelector('.app')!.getAttribute('data-step')).toBe('attributes');
    expect(u.el.textContent).toContain(name);
    expect(u.rev()).toBe(rev);
    expect(u.past()).toBe(past);
  });

  it('AC2 Shift+F10, arrows, Enter, and Esc work, and focus returns', async () => {
    const u = await openFlow();
    const row = u.rows('step')[1];
    row.focus();
    await act(async () => { row.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true })); });
    expect(u.menu()?.getAttribute('data-ctx-kind')).toBe('flow-step');
    expect(document.activeElement?.getAttribute('data-action')).toBe('up');
    await u.key('ArrowDown');
    expect(document.activeElement?.getAttribute('data-action')).toBe('down');
    await u.key('Enter');
    expect(u.menu()).toBeNull();
    expect(u.past()).toBe(1);
    await u.click(u.el.querySelector('[aria-label="실행 취소"]'));

    row.focus();
    const rev = u.rev();
    const past = u.past();
    await act(async () => { row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true })); });
    expect(u.menu()).toBeTruthy();
    await u.key('Escape');
    expect(u.menu()).toBeNull();
    expect(document.activeElement).toBe(row);
    expect(u.rev()).toBe(rev);
    expect(u.past()).toBe(past);

    const name = u.rows('branch')[0].querySelector('input[aria-label="분기 이름"]')!;
    await u.right(name);
    expect(u.menu()).toBeNull();
  });

  it('AC7 opening and closing the menu leaves rev and undo untouched', async () => {
    const u = await openFlow();
    const rev = u.rev();
    const past = u.past();
    await u.right(u.rows('step')[0]);
    expect(u.menu()).toBeTruthy();
    await u.key('Escape');
    expect(u.menu()).toBeNull();
    expect(u.rev()).toBe(rev);
    expect(u.past()).toBe(past);
    expect(u.project().sequence.flow).toEqual(u.history().present.sequence.flow);
  });
});

describe('TURN-073 flow table drag', () => {
  it('AC3 dragging the grip matches 위로, 선택 넣기, and 밖으로', async () => {
    const u = await openFlow();
    const before = structuredClone(u.project());
    u.stack();
    const second = u.rows('step')[1];
    const stepId = second.dataset.nodeId!;
    const flow = u.project().sequence.flow!;
    const measured = [...u.flowTable().querySelectorAll<HTMLTableRowElement>('tbody tr')].map(readMeasuredRow);
    const up = nearestSlot(dropSlots(measured, flow, [stepId]), 12, 0, 0, measured.length * 40);
    expect(up?.listKey).toBe('root');
    expect(up?.index).toBe(0);
    expect(up?.valid && !up.noop).toBe(true);
    const grip = second.querySelector('[data-flow-grip]')!;
    await u.point(grip, 'pointerdown', 40);
    await u.point(window, 'pointermove', 0);
    expect(u.flowTable().getAttribute('data-flow-drag')).toBe('1');
    const line = u.el.querySelector('[data-testid="flow-drop-line"]');
    expect(line?.getAttribute('data-drop-list')).toBe('root');
    expect(line?.getAttribute('data-drop-index')).toBe('0');
    await u.point(window, 'pointerup', 0);
    const cmd = C.moveFlowNode(before, stepId, -1);
    expect(cmd.ok).toBe(true);
    if (!cmd.ok) return;
    expect(u.project().sequence.flow).toEqual(cmd.project.sequence.flow);
    expect(u.rev()).toBe(before.revision + 1);
    expect(u.past()).toBe(1);

    await u.click(u.el.querySelector('[aria-label="실행 취소"]'));
    u.stack();
    const loop = u.rows('loop')[0];
    const loopId = loop.dataset.nodeId!;
    const again = [...u.flowTable().querySelectorAll<HTMLTableRowElement>('tbody tr')].map(readMeasuredRow);
    const slots = dropSlots(again, u.project().sequence.flow!, [loopId]);
    const out = slots.find((s) => s.listKey === 'root' && s.index === 4 && s.valid && !s.noop);
    expect(out).toBeTruthy();
    await u.point(loop.querySelector('[data-flow-grip]')!, 'pointerdown', out!.y, 4);
    await u.point(window, 'pointermove', out!.y, 4);
    expect(u.el.querySelector('[data-testid="flow-drop-line"]')?.getAttribute('data-drop-list')).toBe('root');
    await u.point(window, 'pointerup', out!.y, 4);
    const outCmd = C.moveFlowOut(before, loopId);
    expect(outCmd.ok).toBe(true);
    if (!outCmd.ok) return;
    expect(flowKeys(u.project().sequence.flow)).toEqual(flowKeys(outCmd.project.sequence.flow));

    await u.click(u.el.querySelector('[aria-label="실행 취소"]'));
    const rootStep = u.rows('step').find((r) => r.dataset.listKey === 'root')!;
    const rootId = rootStep.dataset.nodeId!;
    u.stack();
    const rowsNow = [...u.flowTable().querySelectorAll<HTMLTableRowElement>('tbody tr')].map(readMeasuredRow);
    const elseKey = listKeyFor('FLW-BRANCH', 'else');
    const into = dropSlots(rowsNow, u.project().sequence.flow!, [rootId]).find((s) => s.listKey === elseKey && s.valid && !s.noop && s.index === 1);
    expect(into).toBeTruthy();
    await u.point(rootStep.querySelector('[data-flow-grip]')!, 'pointerdown', into!.y, 240);
    await u.point(window, 'pointermove', into!.y, 240);
    await u.point(window, 'pointerup', into!.y, 240);
    const intoCmd = C.moveFlowInto(before, rootId, 'FLW-BRANCH', 'else');
    expect(intoCmd.ok).toBe(true);
    if (!intoCmd.ok) return;
    expect(u.project().sequence.flow).toEqual(intoCmd.project.sequence.flow);
  });

  it('AC4 an illegal drop shows the reason and leaves the model', async () => {
    const u = await openFlow();
    const rev = u.rev();
    const past = u.past();
    const flow = structuredClone(u.project().sequence.flow);
    u.stack();
    const branch = u.rows('branch')[0];
    const measured = [...u.flowTable().querySelectorAll<HTMLTableRowElement>('tbody tr')].map(readMeasuredRow);
    const bad = dropSlots(measured, u.project().sequence.flow!, ['FLW-BRANCH']).find((s) => s.reason === '블록을 자기 자신 안에 넣을 수 없습니다');
    expect(bad).toBeTruthy();
    const badX = bad!.depth * 16 + 8;
    await u.point(branch.querySelector('[data-flow-grip]')!, 'pointerdown', bad!.y, badX);
    await u.point(window, 'pointermove', bad!.y, badX);
    expect(u.el.querySelector('[data-testid="flow-drop-line"]')).toBeNull();
    expect(u.el.querySelector('.flow-drag-reason')?.textContent).toBe('블록을 자기 자신 안에 넣을 수 없습니다');
    await u.point(window, 'pointerup', bad!.y, badX);
    expect(u.el.querySelector('.toast.err')?.textContent).toContain('자기 자신');
    expect(u.project().sequence.flow).toEqual(flow);
    expect(u.rev()).toBe(rev);
    expect(u.past()).toBe(past);
  });

  it('AC5 a block moves whole and contiguous checks move together', async () => {
    const u = await openFlow();
    u.stack();
    const retry = u.rows('retry')[0];
    const inner = retry.dataset.nodeId!;
    const before = structuredClone(u.project());
    const measured = [...u.flowTable().querySelectorAll<HTMLTableRowElement>('tbody tr')].map(readMeasuredRow);
    const slot = dropSlots(measured, u.project().sequence.flow!, [inner]).find((s) => s.listKey === 'root' && s.index === 4 && s.valid && !s.noop);
    expect(slot).toBeTruthy();
    await u.point(retry.querySelector('[data-flow-grip]')!, 'pointerdown', slot!.y, 4);
    await u.point(window, 'pointermove', slot!.y, 4);
    await u.point(window, 'pointerup', slot!.y, 4);
    const cmd = C.moveFlowNode(before, inner, 1);
    expect(cmd.ok).toBe(true);
    if (!cmd.ok) return;
    expect(u.project().sequence.flow).toEqual(cmd.project.sequence.flow);
    const node = u.project().sequence.flow!.find((n) => n.kind !== 'step' && n.id === inner);
    const old = before.sequence.flow!.find((n) => n.kind !== 'step' && n.id === inner);
    expect(node).toEqual(old);

    await u.click(u.el.querySelector('[aria-label="실행 취소"]'));
    const a = u.rows('step')[0];
    const b = u.rows('step')[1];
    await u.click(a.querySelector('input[type="checkbox"]'));
    await u.click(b.querySelector('input[type="checkbox"]'));
    u.stack();
    const ids = [a.dataset.nodeId!, b.dataset.nodeId!];
    const rowsNow = [...u.flowTable().querySelectorAll<HTMLTableRowElement>('tbody tr')].map(readMeasuredRow);
    const pair = dropSlots(rowsNow, u.project().sequence.flow!, ids).find((s) => s.listKey === 'root' && s.index === 4 && s.valid && !s.noop);
    expect(pair).toBeTruthy();
    const rev = u.rev();
    await u.point(a.querySelector('[data-flow-grip]')!, 'pointerdown', pair!.y, 4);
    await u.point(window, 'pointermove', pair!.y, 4);
    await u.point(window, 'pointerup', pair!.y, 4);
    expect(flowKeys(u.project().sequence.flow).slice(-2)).toEqual(ids);
    expect(u.rev()).toBe(rev + 1);
    expect(u.past()).toBe(1);
    await u.click(u.el.querySelector('[aria-label="실행 취소"]'));
    expect(flowKeys(u.project().sequence.flow).slice(0, 2)).toEqual(ids);
    expect(u.past()).toBe(0);
  });

  it('AC6 one drag is one undo, and a run blocks the grip', async () => {
    const u = await openFlow();
    u.stack();
    const second = u.rows('step')[1];
    const rev0 = u.rev();
    await u.point(second.querySelector('[data-flow-grip]')!, 'pointerdown', 0);
    await u.point(window, 'pointermove', 0);
    await u.point(window, 'pointerup', 0);
    expect(u.rev()).toBe(rev0 + 1);
    expect(u.past()).toBe(1);
    await u.click(u.el.querySelector('[aria-label="실행 취소"]'));
    expect(u.rev()).toBe(rev0);
    expect(u.past()).toBe(0);
  });

  it('AC6 a running project blocks the grip and leaves the model', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]'));
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
    try {
      await u.click(u.btn('▶ 실행'));
      expect(u.el.querySelector('.statusbar')?.textContent).toContain('실행 중 편집 잠금');
      await u.click(u.el.querySelector('.stepper [data-stepid="sequence"]'));
      const grip = u.flowTable().querySelector('[data-flow-grip]')!;
      expect(grip.getAttribute('aria-disabled')).toBe('true');
      expect(grip.getAttribute('title')).toBe(EDIT_LOCKED);
      const rev = u.rev();
      await u.point(grip, 'pointerdown', 8);
      expect(u.el.querySelector('.toast.err')?.textContent).toContain('모델 편집이 차단');
      expect(u.flowTable().getAttribute('data-flow-drag')).not.toBe('1');
      expect(u.rev()).toBe(rev);
      expect(u.past()).toBe(0);
    } finally {
      globalThis.requestAnimationFrame = raf;
    }
  });
});
