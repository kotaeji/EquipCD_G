// @vitest-environment jsdom
// TURN-044 copy and paste. jsdom, not a browser. Keyboard feel is a human check.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { COPY_NEED_NODE, PASTE_EMPTY, PASTE_LOCKED } from '../src/model/copyPaste';
import type { History } from '../src/model/history';
import { App } from '../src/ui/App';

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
  const click = async (node: Element | undefined) => {
    if (!node) throw new Error('missing button');
    await act(async () => { (node as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  };
  const key = async (node: EventTarget, init: KeyboardEventInit) => {
    let ev!: KeyboardEvent;
    await act(async () => {
      ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      node.dispatchEvent(ev);
    });
    return ev;
  };
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label) as HTMLButtonElement;
  await click(btn('시작하기'));
  await click(el.querySelector('.stepper [data-stepid="canvas"]')!);
  await click(el.querySelector('#layout-tab-diagram')!);
  const tools = () => el.querySelector('.diagram-tools')!;
  return { el, click, key, btn, tools, history: () => seen.h! };
}

describe('TURN-044 copy paste UI', () => {
  it('AC5 a copy from tab A pastes into tab B and leaves A unchanged', async () => {
    const u = await mount();
    const before = u.history().present;
    const rev = before.revision;
    const units = before.units.map((unit) => unit.id);
    await u.click(u.el.querySelector('[data-tree-id="U-S2"]')!);
    await u.key(window, { key: 'c', ctrlKey: true });
    expect(u.el.querySelector('.toast')?.textContent).toContain('Unit 1개');
    expect(u.history().present.revision).toBe(rev);

    await u.click(u.el.querySelector('[aria-label="프로젝트 추가"]')!);
    await u.click(u.btn('빈 프로젝트'));
    expect(u.history().present.units).toHaveLength(0);
    await u.key(window, { key: 'v', ctrlKey: true });
    expect(u.history().present.revision).toBe(1);
    expect(u.history().present.units).toHaveLength(1);
    expect(u.history().present.units[0].lineage?.duplicatedFrom).toBe('U-S2');
    expect(u.history().present.devices).toHaveLength(2);
    expect(u.history().past).toHaveLength(1);

    const sample = [...u.el.querySelectorAll('.exitem')].find((row) => (row.textContent ?? '').includes('조립 라인'));
    await u.click(sample);
    expect(u.history().present.revision).toBe(rev);
    expect(u.history().present.units.map((unit) => unit.id)).toEqual(units);
    expect(u.history().present.devices).toHaveLength(before.devices.length);
    expect(u.history().past).toHaveLength(0);
  });

  it('AC7 AC8 AC9 the notice names what was left out, an input keeps native copy, and paste stays disabled', async () => {
    const u = await mount();
    const paste = () => u.btn('붙여넣기', u.tools());
    const copy = () => u.btn('복사', u.tools());
    expect(paste().disabled).toBe(true);
    expect(paste().title).toBe(PASTE_EMPTY);
    expect(copy().disabled).toBe(true);
    expect(copy().title).toBe(COPY_NEED_NODE);

    await u.click(u.el.querySelector('[data-tree-id="STP-02"]')!);
    expect(copy().disabled).toBe(false);
    expect(copy().title).toContain('Ctrl');
    expect(paste().disabled).toBe(true);
    await u.click(copy());
    expect(paste().disabled).toBe(false);
    expect(paste().title).toContain('Ctrl');
    const rev = u.history().present.revision;
    const devices = u.history().present.devices.length;

    const field = u.el.querySelector('.prop-sheet input') as HTMLInputElement;
    expect(field.tagName).toBe('INPUT');
    field.focus();
    const copied = await u.key(field, { key: 'c', ctrlKey: true });
    const pastedKey = await u.key(field, { key: 'v', ctrlKey: true });
    expect(copied.defaultPrevented).toBe(false);
    expect(pastedKey.defaultPrevented).toBe(false);
    expect(u.history().present.revision).toBe(rev);
    expect(u.history().present.devices).toHaveLength(devices);

    field.blur();
    await u.click(u.el.querySelector('[data-tree-id="U-S5"]')!);
    await u.click(paste());
    expect(u.history().present.revision).toBe(rev + 1);
    expect(u.history().present.devices).toHaveLength(devices + 1);
    const toast = u.el.querySelector('.toast')?.textContent ?? '';
    expect(toast).toContain('시퀀스 단계');
    expect(toast).toContain('바깥 연결');
    const copyDev = u.history().present.devices.find((d) => d.lineage?.duplicatedFrom === 'STP-02');
    expect(copyDev?.unitId).toBe('U-S5');

    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
    try {
      await u.click(u.btn('▶ 실행'));
      await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]')!);
      await u.click(u.el.querySelector('#layout-tab-diagram')!);
      expect(paste().disabled).toBe(true);
      expect(paste().title).toBe(PASTE_LOCKED);
      await u.key(window, { key: 'v', ctrlKey: true });
      const refused = u.el.querySelector('.toast')?.textContent ?? '';
      expect(refused).toContain('붙여넣기 불가');
      expect(refused).toContain(PASTE_LOCKED);
      expect(u.history().present.revision).toBe(rev + 1);
    } finally {
      globalThis.requestAnimationFrame = raf;
    }
  });

  it('the card board and the explorer tree use the same shortcut', async () => {
    const u = await mount();
    await u.click(u.el.querySelector('#layout-tab-board')!);
    const chip = [...u.el.querySelectorAll('.chip')].find((b) => (b.textContent ?? '').startsWith('CYL-01'))!;
    await u.click(chip);
    await u.key(window, { key: 'c', metaKey: true });
    expect(u.el.querySelector('.toast')?.textContent).toContain('Device 1개');
    const card = [...u.el.querySelectorAll('.station-card')].find((n) => (n.textContent ?? '').includes('S5'))!;
    await u.click(card);
    const rev = u.history().present.revision;
    await u.key(window, { key: 'v', metaKey: true });
    expect(u.history().present.revision).toBe(rev + 1);
    expect(u.history().present.devices.some((d) => d.lineage?.duplicatedFrom === 'CYL-01' && d.unitId === 'U-S5')).toBe(true);

    await u.click(u.el.querySelector('.stepper [data-stepid="library"]')!);
    const node = u.el.querySelector('[data-tree-id="U-S1"]') as HTMLElement;
    await u.click(node);
    await u.key(node, { key: 'c', ctrlKey: true });
    expect(u.el.querySelector('.toast')?.textContent).toContain('Unit 1개');
    await u.key(node, { key: 'v', ctrlKey: true });
    expect(u.history().present.units.some((unit) => unit.lineage?.duplicatedFrom === 'U-S1')).toBe(true);
  });
});
