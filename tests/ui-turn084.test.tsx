// @vitest-environment jsdom
// TURN-084 keyboard on the stage-2 diagram.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { History } from '../src/model/history';
import { App } from '../src/ui/App';
import { holdRuntimeClock } from './holdRuntimeClock';

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
  const up = async (node: EventTarget, init: KeyboardEventInit) => {
    await act(async () => { node.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, ...init })); });
  };
  const btn = (label: string) => [...el.querySelectorAll('button')].find((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim() === label || b.getAttribute('aria-label') === label);
  await click(btn('시작하기'));
  await click(el.querySelector('.stepper [data-stepid="canvas"]'));
  await click(el.querySelector('#layout-tab-diagram'));
  const host = () => el.querySelector('.diagram-canvas .rf-host') as HTMLElement;
  const place = () => el.querySelector('[data-kbd-place]')?.textContent ?? '';
  const project = () => seen.h!.present;
  const unit = (id: string) => project().units.find((u) => u.id === id)!;
  return { el, click, key, up, btn, host, place, project, unit, history: () => seen.h!, rev: () => seen.h!.present.revision, past: () => seen.h!.past.length };
}

describe('TURN-084 diagram keyboard', () => {
  it('AC1 Tab, Enter, and Esc walk units and devices and name the place', async () => {
    const u = await mount();
    u.host().focus();
    await u.key(u.host(), { key: 'Tab' });
    expect(u.place()).toBe('S1 투입');
    expect(u.el.querySelector('.react-flow__node[data-id="U-S1"]')?.classList.contains('is-kbd-target')).toBe(true);
    await u.key(u.host(), { key: 'Tab' });
    expect(u.place()).toBe('S2 식별');
    await u.key(u.host(), { key: 'Enter' });
    expect(u.place()).toBe('S2 식별 › BCR-02');
    expect(u.el.querySelector('.react-flow__node[data-id="BCR-02"]')?.classList.contains('is-kbd-target')).toBe(true);
    await u.key(u.host(), { key: 'Tab' });
    expect(u.place()).toContain('STP-02');
    await u.key(u.host(), { key: 'Escape' });
    expect(u.place()).toBe('S2 식별');
    await u.key(u.host(), { key: 'Tab', shiftKey: true });
    expect(u.place()).toBe('S1 투입');
    expect(u.rev()).toBe(1);
  });

  it('AC2 arrow, shift, and alt move 10, 50, and 1, and a burst is one undo', async () => {
    const u = await mount();
    u.host().focus();
    await u.key(u.host(), { key: 'Tab' });
    const x0 = u.unit('U-S1').layout.x;
    const past0 = u.past();
    await u.key(u.host(), { key: 'ArrowRight' });
    await u.key(u.host(), { key: 'ArrowRight' });
    expect(u.unit('U-S1').layout.x).toBe(x0 + 20);
    expect(u.past()).toBe(past0 + 1);
    expect(u.rev()).toBe(2);
    expect(u.place()).toBe(`S1 투입 (${x0 + 20}, ${u.unit('U-S1').layout.y})`);
    await u.key(window, { key: 'z', ctrlKey: true });
    expect(u.unit('U-S1').layout.x).toBe(x0);
    expect(u.past()).toBe(past0);

    await u.key(u.host(), { key: 'ArrowRight', shiftKey: true });
    expect(u.unit('U-S1').layout.x).toBe(x0 + 50);
    await u.key(window, { key: 'z', ctrlKey: true });
    await u.key(u.host(), { key: 'ArrowRight', altKey: true });
    expect(u.unit('U-S1').layout.x).toBe(x0 + 1);
    await u.key(window, { key: 'z', ctrlKey: true });

    await u.key(u.host(), { key: 'ArrowDown' });
    await u.up(u.host(), { key: 'ArrowDown' });
    await act(async () => { await new Promise((r) => setTimeout(r, 600)); });
    await u.key(u.host(), { key: 'ArrowDown' });
    expect(u.unit('U-S1').layout.y).toBe(70 + 20);
    expect(u.past()).toBe(past0 + 2);
    await u.key(window, { key: 'z', ctrlKey: true });
    expect(u.unit('U-S1').layout.y).toBe(70 + 10);
  });

  it('AC3 a locked unit stays put and the reason is shown', async () => {
    const u = await mount();
    u.host().focus();
    await u.key(u.host(), { key: 'Tab' });
    await u.click(u.btn('위치 잠금'));
    const x0 = u.unit('U-S1').layout.x;
    const rev = u.rev();
    await u.key(u.host(), { key: 'ArrowRight' });
    expect(u.unit('U-S1').layout.x).toBe(x0);
    expect(u.rev()).toBe(rev);
    expect(u.el.querySelector('.toast')?.textContent).toContain('위치 잠금된 Unit은 움직이지 않습니다');
    expect(u.place()).toContain('위치 잠금된 Unit은 움직이지 않습니다');
  });

  it('AC4 L and S connect with the same refusal as a pointer', async () => {
    const u = await mount();
    u.host().focus();
    await u.key(u.host(), { key: 'Tab' });
    const before = u.project().connections.length;
    await u.key(u.host(), { key: 'l' });
    expect(u.place()).toContain('물류 연결');
    expect(u.place()).toContain('S2 식별');
    expect(u.el.querySelector('.toast')?.textContent).toContain('물류 연결: 도착 Unit을 클릭하세요');
    await u.key(u.host(), { key: 'Enter' });
    expect(u.project().connections.length).toBe(before);
    expect(u.el.querySelector('.toast')?.textContent).toContain('이미 같은 물류 연결이 있습니다');
    await u.key(u.host(), { key: 'l' });
    await u.key(u.host(), { key: 'Tab' });
    expect(u.place()).toContain('S3 가공');
    await u.key(u.host(), { key: 'Enter' });
    const added = u.project().connections.find((c) => c.kind === 'flow' && c.from.nodeId === 'U-S1' && c.to.nodeId === 'U-S3');
    expect(added).toBeTruthy();
    await u.key(window, { key: 'z', ctrlKey: true });
    expect(u.project().connections.some((c) => c.id === added!.id)).toBe(false);

    await u.key(u.host(), { key: 'Tab' });
    expect(u.place()).toBe('S2 식별');
    await u.key(u.host(), { key: 'Enter' });
    const signals = u.project().connections.filter((c) => c.kind === 'signal').length;
    await u.key(u.host(), { key: 's' });
    expect(u.place()).toContain('신호 연결');
    expect(u.el.querySelector('.toast')?.textContent).toContain('신호 연결: 도착 입력(in) 포트를 클릭하세요');
    await u.key(u.host(), { key: 'Enter' });
    expect(u.project().connections.filter((c) => c.kind === 'signal').length).toBe(signals + 1);
    await u.key(u.host(), { key: 's' });
    await u.key(u.host(), { key: 'Enter' });
    expect(u.el.querySelector('.toast')?.textContent).toContain('이미 같은 신호 연결이 있습니다');
    expect(u.project().connections.filter((c) => c.kind === 'signal').length).toBe(signals + 1);

  });

  it('AC4 a device step that lands in another unit asks the same question as a drag', async () => {
    const u = await mount();
    u.host().focus();
    await u.key(u.host(), { key: 'Tab' });
    await u.key(u.host(), { key: 'Enter' });
    expect(u.place()).toContain('CYL-01');
    const x0 = u.project().devices.find((d) => d.id === 'CYL-01')!.layout.x;
    await u.key(u.host(), { key: 'ArrowRight', shiftKey: true });
    await u.key(u.host(), { key: 'ArrowRight', shiftKey: true });
    expect(u.el.querySelector('.modal')?.textContent ?? '').toContain('소속 Unit 변경');
    expect(u.el.querySelector('.modal')?.textContent ?? '').toContain('좌표만 이동 (소속 유지)');
    expect(u.project().devices.find((d) => d.id === 'CYL-01')!.layout.x).toBe(x0 + 50);
    expect(u.project().devices.find((d) => d.id === 'CYL-01')!.unitId).toBe('U-S1');
    await u.click(u.btn('취소'));
    expect(u.el.querySelector('.modal')).toBeNull();
  });

  it('AC5 plus, minus, and zero change the view and a far node is pulled back', async () => {
    const u = await mount();
    u.host().focus();
    const pill = () => Number((u.el.querySelector('.zoom-pill')?.textContent ?? '').replace(/[^\d]/g, ''));
    const before = pill();
    await u.key(u.host(), { key: '+' });
    expect(pill()).toBe(before + 10);
    expect(u.place()).toContain('확대');
    await u.key(u.host(), { key: '-' });
    expect(pill()).toBe(before);
    const rev = u.rev();
    await u.key(u.host(), { key: '0' });
    expect(u.place()).toBe('화면 맞춤');
    expect(u.rev()).toBe(rev);
    await u.key(u.host(), { key: 'Tab' });
    expect(u.el.querySelector('.rf-host')?.getAttribute('data-kbd-target')).toBe('U-S1');
  });

  it('AC6 an input swallows the keys, and Ctrl+A still selects units', async () => {
    const u = await mount();
    u.host().focus();
    await u.key(u.host(), { key: 'Tab' });
    const input = u.el.querySelector('.right input:not([type="checkbox"])') as HTMLInputElement;
    expect(input).toBeTruthy();
    input.focus();
    const x0 = u.unit('U-S1').layout.x;
    const links = u.project().connections.length;
    await u.key(input, { key: 'ArrowRight' });
    await u.key(input, { key: 'l' });
    expect(u.unit('U-S1').layout.x).toBe(x0);
    expect(u.project().connections.length).toBe(links);
    expect(u.place()).not.toContain('물류 연결');
    await u.click(u.el.querySelector('.react-flow__pane'));
    u.host().focus();
    await u.key(u.host(), { key: 'a', ctrlKey: true });
    expect(u.el.querySelectorAll('.rf-unit.is-sel').length).toBe(u.project().units.length);
  });

  it('AC7 the shortcut sheet lists the diagram keys', async () => {
    const u = await mount();
    u.host().focus();
    await u.key(window, { key: '?', shiftKey: true });
    const sheet = document.querySelector('[aria-label="단축키 목록"]');
    expect(sheet).toBeTruthy();
    const text = sheet!.textContent ?? '';
    expect(text).toContain('물류 잇기');
    expect(text).toContain('신호 잇기');
    expect(text).toContain('도면 격자 한 칸(10) 이동');
    expect(text).toContain('도면 화면 맞춤');
  });

  it('AC8 a running diagram can be walked and zoomed, and move and link stay blocked', async () => {
    const clock = holdRuntimeClock();
    try {
      const u = await mount();
      await u.click(u.el.querySelector('.stepper [data-stepid="run"]'));
      await u.click(u.btn('▶ 실행'));
      expect(u.el.querySelector('.statusbar')?.textContent).toContain('실행 중');
      const host = u.el.querySelector('.run-canvas .rf-host') as HTMLElement;
      expect(host).toBeTruthy();
      host.focus();
      const x0 = u.unit('U-S1').layout.x;
      const links = u.project().connections.length;
      const rev = u.rev();
      await u.key(host, { key: 'Tab' });
      expect(u.place()).toBe('S1 투입');
      await u.key(host, { key: 'ArrowRight' });
      await u.key(host, { key: 'l' });
      expect(u.unit('U-S1').layout.x).toBe(x0);
      expect(u.project().connections.length).toBe(links);
      expect(u.rev()).toBe(rev);
      expect(u.el.querySelector('.toast')?.textContent).toContain('실행 중에는 배치 이동');
      await u.key(host, { key: '+' });
      expect(u.place()).toContain('확대');
      expect(u.rev()).toBe(rev);
    } finally {
      clock.restore();
    }
  });
});
