// @vitest-environment jsdom
// TURN-087. The order line is readable, and arrow-key coordinates follow undo and redo.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { History } from '../src/model/history';
import { diffProjects } from '../src/model/projectDiff';
import { App } from '../src/ui/App';
import { ProjectDiffList } from '../src/ui/ProjectDiffView';

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
    await act(async () => { (node as HTMLElement).click(); });
  };
  const key = async (node: EventTarget, init: KeyboardEventInit) => {
    await act(async () => { node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })); });
  };
  const point = async (node: Element, type: string, x: number, y: number) => {
    await act(async () => { node.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0 })); });
  };
  const btn = (label: string) => [...el.querySelectorAll('button')].find((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim() === label || b.getAttribute('aria-label') === label);
  await click(btn('시작하기'));
  await click(el.querySelector('.stepper [data-stepid="canvas"]'));
  await click(el.querySelector('#layout-tab-diagram'));
  const host = () => el.querySelector('.diagram-canvas .rf-host') as HTMLElement;
  const place = () => el.querySelector('[data-kbd-place]')?.textContent ?? '';
  const project = () => seen.h!.present;
  const unit = (id: string) => project().units.find((u) => u.id === id)!;
  return { el, click, key, point, btn, host, place, project, unit };
}

function coords(label: string, x: number, y: number) {
  return `${label} (${Math.round(x)}, ${Math.round(y)})`;
}

describe('TURN-087 keyboard status line', () => {
  it('AC5 arrow, undo, and redo keep the status line on the model coordinates', async () => {
    const u = await mount();
    u.host().focus();
    await u.key(u.host(), { key: 'Tab' });
    const before = { ...u.unit('U-S1').layout };
    await u.key(u.host(), { key: 'ArrowRight' });
    const moved = u.unit('U-S1').layout;
    expect(moved.x).toBe(before.x + 10);
    expect(u.place()).toBe(coords('S1 투입', moved.x, moved.y));
    await u.key(window, { key: 'z', ctrlKey: true });
    const back = u.unit('U-S1').layout;
    expect(back.x).toBe(before.x);
    expect(u.place()).toBe(coords('S1 투입', back.x, back.y));
    await u.key(window, { key: 'y', ctrlKey: true });
    const again = u.unit('U-S1').layout;
    expect(again.x).toBe(before.x + 10);
    expect(u.place()).toBe(coords('S1 투입', again.x, again.y));
  });

  it('AC5 a drag of the same unit updates the coordinates', async () => {
    const u = await mount();
    u.host().focus();
    await u.key(u.host(), { key: 'Tab' });
    await u.key(u.host(), { key: 'ArrowRight' });
    const body = u.el.querySelector('.react-flow__node[data-id="U-S1"] .rf-unit') as HTMLElement;
    expect(body).toBeTruthy();
    await u.point(body, 'pointerdown', 80, 80);
    await u.point(body, 'pointermove', 120, 80);
    await u.point(body, 'pointerup', 120, 80);
    const box = u.unit('U-S1').layout;
    expect(box.x).not.toBe(40);
    expect(u.place()).toBe(coords('S1 투입', box.x, box.y));
  });

  it('AC6 undo that removes the selected device clears the status line', async () => {
    const u = await mount();
    u.host().focus();
    await u.key(u.host(), { key: 'Tab' });
    await u.key(u.host(), { key: 'Enter' });
    expect(u.place()).toContain('CYL-01');
    await u.click(u.btn('복제'));
    const copy = u.project().devices.find((d) => d.name === 'CYL-01 사본');
    expect(copy).toBeTruthy();
    expect(u.place()).toBe('');
    u.host().focus();
    await u.key(u.host(), { key: 'ArrowRight' });
    const moved = u.project().devices.find((d) => d.id === copy!.id)!.layout;
    expect(u.place()).toBe(coords('S1 투입 › CYL-01 사본', moved.x, moved.y));
    await u.key(window, { key: 'z', ctrlKey: true });
    const back = u.project().devices.find((d) => d.id === copy!.id)!.layout;
    expect(back.x).toBe(moved.x - 10);
    expect(u.place()).toBe(coords('S1 투입 › CYL-01 사본', back.x, back.y));
    await u.key(window, { key: 'z', ctrlKey: true });
    expect(u.project().devices.some((d) => d.id === copy!.id)).toBe(false);
    expect(u.place()).toBe('');
  });
});

describe('TURN-087 diff screen', () => {
  it('AC1 the order line shows the sentence and not the internal id', async () => {
    const { emptyProject } = await import('../src/model/factory');
    const before = emptyProject('화면');
    before.sequence = {
      id: 'SEQ', name: 'Station', unresolved: [],
      steps: [
        { id: 's1', name: 'S1', actionId: 'A', timeoutOverride: null, entry: [], origin: 'sample' },
        { id: 's2', name: 'S2', actionId: 'A', timeoutOverride: null, entry: [], origin: 'sample' },
      ],
      flow: [{ kind: 'step', stepId: 's1' }, { kind: 'step', stepId: 's2' }],
    };
    const after = structuredClone(before);
    after.sequence.flow!.push({
      kind: 'wait', id: 'flow-secret', name: '신호 기다림',
      cond: { kind: 'undefined', note: '없음' },
      timeout: { value: null, unit: 's', assumption: true },
    });
    const el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => { root!.render(<ProjectDiffList diff={diffProjects(before, after)} />); });
    const line = el.querySelector('[data-diff-field="흐름"] [data-diff-order]');
    expect(line?.textContent).toBe('흐름 더함: 신호 기다림(S2 뒤)');
    expect(el.textContent).not.toContain('flow-secret');
    expect(el.textContent).not.toContain('s1');
    expect(el.textContent).not.toContain('s2');
  });
});
