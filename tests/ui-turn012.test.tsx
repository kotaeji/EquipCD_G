// @vitest-environment jsdom
// TURN-012: port press does not move a device; signal wires drag or two-click. jsdom, not a browser.
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { History } from '../src/model/history';
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

function pos(root: ParentNode, id: string) {
  const n = root.querySelector(`.react-flow__node[data-id="${id}"]`) as HTMLElement | null;
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
  const click = async (node: Element) => { await act(async () => { (node as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
  const point = async (node: Element, type: string, x: number, y: number) => {
    await act(async () => { node.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1 })); });
  };
  const mouse = async (node: Element | Document, type: string, x: number, y: number) => {
    await act(async () => { node.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })); });
  };
  const btn = (label: string) => [...el.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label || b.getAttribute('aria-label') === label) as HTMLButtonElement;
  const port = (device: string, dir: 'in' | 'out', key?: string) => el.querySelector(`.rf-port.${dir}[data-device="${device}"]${key ? `[data-port="${key}"]` : ''}`) as HTMLElement;
  await click(btn('시작하기'));
  await click(el.querySelector('.stepper [data-stepid="canvas"]')!);
  await click(el.querySelector('#layout-tab-diagram')!);
  return {
    el, click, point, mouse, btn, port,
    history: () => seen.h!,
    startNote: () => [...el.querySelectorAll('.notice')].map((n) => n.textContent ?? '').find((t) => t.includes('연결 시작')) ?? '',
    rev: () => seen.h!.present.revision,
    sigs: () => seen.h!.present.connections.filter((c) => c.kind === 'signal'),
    flows: () => seen.h!.present.connections.filter((c) => c.kind === 'flow'),
  };
}

async function dragWire(u: Awaited<ReturnType<typeof mount>>, from: Element, to: Element) {
  const prev = document.elementFromPoint?.bind(document);
  document.elementFromPoint = () => to as HTMLElement;
  try {
    await u.mouse(from, 'mousedown', 4, 4);
    await u.mouse(document, 'mousemove', 40, 24);
    await u.mouse(document, 'mouseup', 40, 24);
  } finally {
    if (prev) document.elementFromPoint = prev;
  }
}

describe('TURN-012 port connect', () => {
  it('AC1: pressing an out port, even with a wobble, does not move the device; the body still drags', async () => {
    const u = await mount();
    const before = pos(u.el, 'PSH-01');
    const rev0 = u.rev();
    const out = u.port('PSH-01', 'out', 'pushDone');
    const prev = document.elementFromPoint?.bind(document);
    document.elementFromPoint = () => null;
    try {
      await u.point(out, 'pointerdown', before.x + 8, before.y + 8);
      await u.mouse(out, 'mousedown', before.x + 8, before.y + 8);
      await u.point(out, 'pointermove', before.x + 14, before.y + 12);
      await u.mouse(document, 'mousemove', before.x + 14, before.y + 12);
      await u.point(out, 'pointerup', before.x + 14, before.y + 12);
      await u.mouse(document, 'mouseup', before.x + 14, before.y + 12);
    } finally {
      if (prev) document.elementFromPoint = prev;
    }
    expect(pos(u.el, 'PSH-01')).toEqual(before);
    expect(u.rev()).toBe(rev0);
    expect(u.sigs()).toHaveLength(3);
    const body = u.el.querySelector('[data-id="PSH-01"] .rf-device')!;
    await u.point(body, 'pointerdown', before.x + 20, before.y + 16);
    await u.point(body, 'pointermove', before.x + 50, before.y + 16);
    await u.point(body, 'pointerup', before.x + 50, before.y + 16);
    expect(pos(u.el, 'PSH-01').x - before.x).toBe(30);
    expect(u.rev()).toBe(rev0 + 1);
  });

  it('AC2: dragging an out port onto another device in port adds one signal and one undo', async () => {
    const u = await mount();
    const rev0 = u.rev();
    const before = u.sigs().length;
    await dragWire(u, u.port('PSH-01', 'out', 'pushDone'), u.port('CYL-01', 'in', 'cmdFwd'));
    const added = u.sigs().filter((c) => !['SIGC-1', 'SIGC-2', 'SIGC-3'].includes(c.id));
    expect(added).toHaveLength(1);
    expect(added[0].from).toMatchObject({ nodeId: 'PSH-01', signalId: 'PSH-01.sig2' });
    expect(added[0].to).toMatchObject({ nodeId: 'CYL-01', signalId: 'CYL-01.sig1' });
    expect(u.sigs()).toHaveLength(before + 1);
    expect(u.rev()).toBe(rev0 + 1);
    expect(u.history().past).toHaveLength(1);
    await u.click(u.btn('실행 취소'));
    expect(u.sigs()).toHaveLength(before);
    expect(u.rev()).toBe(rev0);
    expect(u.history().past).toHaveLength(0);
  });

  it('AC3: signal mode still connects with two pointer downs', async () => {
    const u = await mount();
    const before = u.sigs().length;
    await u.click(u.btn('신호 연결'));
    await u.point(u.port('STP-05', 'out'), 'pointerdown', 0, 0);
    await u.point(u.port('CNV-05', 'in'), 'pointerdown', 0, 0);
    expect(u.sigs()).toHaveLength(before + 1);
    expect(u.startNote()).toBe('');
  });

  it('AC3: the start notice does not move the diagram canvas', async () => {
    const u = await mount();
    await u.click(u.btn('신호 연결'));
    const host = () => u.el.querySelector('.diagram-canvas .rf-host') as HTMLElement;
    const before = host().getBoundingClientRect().top;
    await u.point(u.port('CYL-01', 'out', 'fwdDone'), 'pointerdown', 0, 0);
    expect(u.startNote()).toContain('연결 시작');
    expect(host().getBoundingClientRect().top).toBe(before);
    const notes = [...u.el.querySelectorAll('.notice')].filter((n) => (n.textContent ?? '').includes('연결 시작'));
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) {
      expect(n.closest('.rf-host, .board')).not.toBeNull();
      expect((n as HTMLElement).style.position).toBe('absolute');
    }
  });

  it('AC4: in-port start, same device, duplicate, empty drop, and Esc do not connect', async () => {
    const u = await mount();
    const rev0 = u.rev();
    const before = u.sigs().length;
    await u.point(u.port('PSH-01', 'in', 'cmdPush'), 'pointerdown', 0, 0);
    expect(u.el.querySelector('.toast')?.textContent).toContain('출력(out) 포트에서 시작하세요');
    expect(u.sigs()).toHaveLength(before);
    expect(u.rev()).toBe(rev0);

    await dragWire(u, u.port('PSH-01', 'out', 'pushDone'), u.port('PSH-01', 'in', 'cmdPush'));
    expect(u.el.querySelector('.toast')?.textContent).toContain('같은 Device');
    expect(u.sigs()).toHaveLength(before);

    await dragWire(u, u.port('PSH-01', 'out', 'pushDone'), u.port('CYL-01', 'in', 'cmdFwd'));
    expect(u.sigs()).toHaveLength(before + 1);
    await dragWire(u, u.port('PSH-01', 'out', 'pushDone'), u.port('CYL-01', 'in', 'cmdFwd'));
    expect(u.el.querySelector('.toast')?.textContent).toContain('이미 같은 신호 연결');
    expect(u.sigs()).toHaveLength(before + 1);

    const prev = document.elementFromPoint?.bind(document);
    document.elementFromPoint = () => null;
    try {
      await u.mouse(u.port('STP-05', 'out'), 'mousedown', 2, 2);
      await u.mouse(document, 'mousemove', 48, 30);
      await u.mouse(document, 'mouseup', 48, 30);
    } finally {
      if (prev) document.elementFromPoint = prev;
    }
    expect(u.sigs()).toHaveLength(before + 1);

    await u.click(u.btn('신호 연결'));
    await u.point(u.port('STP-05', 'out'), 'pointerdown', 0, 0);
    expect(u.startNote()).toContain('연결 시작');
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(u.startNote()).toBe('');
    expect(u.sigs()).toHaveLength(before + 1);

    const inn = u.port('CNV-05', 'in');
    document.elementFromPoint = () => inn;
    try {
      await u.mouse(u.port('STP-05', 'out'), 'mousedown', 1, 1);
      await u.mouse(document, 'mousemove', 36, 18);
      await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
      await u.mouse(document, 'mouseup', 36, 18);
    } finally {
      if (prev) document.elementFromPoint = prev;
    }
    expect(u.sigs()).toHaveLength(before + 1);
    expect(u.rev()).toBe(rev0 + 1);
  });

  it('AC5: a running project does not start a drag-connect and shows the edit block', async () => {
    const u = await mount();
    const before = u.sigs().length;
    const rev0 = u.rev();
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
    try {
      await u.click(u.btn('▶ 실행'));
      expect(u.el.querySelector('.statusbar')?.textContent).toContain('실행 중 편집 잠금');
      const out = u.port('PSH-01', 'out', 'pushDone');
      await u.point(out, 'pointerdown', 8, 8);
      expect(u.el.querySelector('.toast')?.textContent).toContain('모델 편집이 차단');
      await dragWire(u, out, u.port('CYL-01', 'in', 'cmdFwd'));
      expect(u.sigs()).toHaveLength(before);
      expect(u.rev()).toBe(rev0);
    } finally {
      globalThis.requestAnimationFrame = raf;
    }
  });

  it('AC6: signal mode on the card board does not add a flow; flow mode on the diagram uses the device unit', async () => {
    const u = await mount();
    const flows0 = u.flows().length;
    await u.click(u.btn('신호 연결'));
    await u.click(u.el.querySelector('#layout-tab-board')!);
    const card = u.el.querySelector('.station-card')!;
    await u.click(card);
    expect(u.flows()).toHaveLength(flows0);
    expect(u.el.querySelector('.toast')?.textContent).toContain('신호 연결은 도면 도식 탭의 포트에서 합니다');

    await u.click(u.btn('물류 연결'));
    await u.click(u.el.querySelector('#layout-tab-diagram')!);
    await u.point(u.el.querySelector('[data-id="CYL-03"] .rf-device')!, 'pointerdown', 12, 12);
    await u.point(u.el.querySelector('[data-id="U-S1"] .rf-unit')!, 'pointerdown', 12, 12);
    const added = u.flows().filter((c) => !c.id.startsWith('FLOW-'));
    expect(added).toHaveLength(1);
    expect(added[0].from.nodeId).toBe('U-S3');
    expect(added[0].to.nodeId).toBe('U-S1');
  });

  it('AC7: the port hit box is at least 16px and valid ends are marked while linking', async () => {
    const rule = css.slice(css.indexOf('.rf-host .rf-port {'));
    expect(rule).toMatch(/min-width:\s*16px/);
    expect(rule).toMatch(/min-height:\s*16px/);
    expect(rule).toMatch(/pointer-events:\s*all/);
    expect(css).toMatch(/\.rf-port\.is-target/);
    expect(css).toMatch(/\.rf-port\.is-dim/);
    const u = await mount();
    await u.click(u.btn('신호 연결'));
    await u.point(u.port('PSH-01', 'out', 'pushDone'), 'pointerdown', 0, 0);
    expect(u.el.querySelector('.rf-host')?.getAttribute('data-linking')).toBe('1');
    expect(u.port('PSH-01', 'out', 'pushDone').classList.contains('from')).toBe(true);
    expect(u.port('CYL-01', 'in', 'cmdFwd').classList.contains('is-target')).toBe(true);
    expect(u.port('PSH-01', 'in', 'cmdPush').classList.contains('is-dim')).toBe(true);
    expect(u.port('PSH-01', 'in', 'cmdPush').classList.contains('is-target')).toBe(false);
    expect(u.el.querySelector('.diagram-hint')?.textContent).toContain('출력● 포트를 입력○ 포트로 끌어 연결');
  });

  it('AC8: the start notice uses the device name, the signal name, and the direction', async () => {
    const u = await mount();
    await u.click(u.btn('신호 연결'));
    await u.point(u.port('PSH-01', 'out', 'pushDone'), 'pointerdown', 0, 0);
    const note = u.startNote();
    expect(note).toContain('PSH-01 푸셔');
    expect(note).toContain('pushDone');
    expect(note).toContain('(출력)');
    expect(note).not.toContain('PSH-01.sig');
  });
});
