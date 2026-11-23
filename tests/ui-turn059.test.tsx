// @vitest-environment jsdom
// TURN-059: background drawing and unit position lock.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { assessBackground } from '../src/model/background';
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

function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(24);
  b.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  b[16] = (width >>> 24) & 255; b[17] = (width >>> 16) & 255; b[18] = (width >>> 8) & 255; b[19] = width & 255;
  b[20] = (height >>> 24) & 255; b[21] = (height >>> 16) & 255; b[22] = (height >>> 8) & 255; b[23] = height & 255;
  return b;
}

function jpeg(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >> 8) & 255, height & 255, (width >> 8) & 255, width & 255,
    0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
  ]);
}

function fileOf(bytes: Uint8Array, name: string, type: string) {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new File([copy], name, { type });
}

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
  const click = async (node: Element | null) => { await act(async () => { (node as HTMLElement).click(); }); };
  const point = async (node: Element, type: string, x: number, y: number, extra: PointerEventInit = {}) => {
    await act(async () => { node.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, ...extra })); });
  };
  const btn = (label: string) => [...el.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label || b.getAttribute('aria-label') === label) as HTMLButtonElement;
  await click(btn('시작하기'));
  await click(el.querySelector('.stepper [data-stepid="canvas"]')!);
  await click(el.querySelector('#layout-tab-diagram')!);
  const choose = async (file: File) => {
    const input = el.querySelector('[data-background-file]') as HTMLInputElement;
    await act(async () => {
      Object.defineProperty(input, 'files', { configurable: true, value: [file] });
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
    });
  };
  return {
    el, click, point, btn, choose,
    history: () => seen.h!,
    project: () => seen.h!.present,
    rev: () => seen.h!.present.revision,
    past: () => seen.h!.past.length,
  };
}

describe('TURN-059 background on the diagram', () => {
  it('AC1 AC5 AC6: a PNG lands behind the drawing, stays locked, and one undo removes it', async () => {
    const u = await mount();
    const rev0 = u.rev();
    await u.click(u.btn('배경 도면'));
    const got = assessBackground(png(120, 60), 'image/png');
    expect(got.ok).toBe(true);
    await u.choose(fileOf(png(120, 60), 'layout.png', 'image/png'));
    const bg = u.el.querySelector('[data-diagram-bg]') as HTMLElement;
    expect(bg).toBeTruthy();
    expect(bg.closest('.react-flow__node')).toBeNull();
    expect(bg.getAttribute('data-bg-locked')).toBe('1');
    expect(bg.style.pointerEvents).toBe('none');
    expect(u.project().diagramBackground?.width).toBe(120);
    expect(u.rev()).toBe(rev0 + 1);
    expect(u.past()).toBe(1);
    await u.click(u.btn('실행 취소'));
    expect(u.project().diagramBackground).toBeUndefined();
    expect(u.rev()).toBe(rev0);
    await u.click(u.btn('다시 실행'));
    expect(u.project().diagramBackground?.width).toBe(120);
    const unit = pos(u.el, 'U-S1');
    await u.point(u.el.querySelector('[data-id="U-S1"] .rf-unit')!, 'pointerdown', unit.x + 20, unit.y + 16);
    await u.point(u.el.querySelector('[data-id="U-S1"] .rf-unit')!, 'pointerup', unit.x + 20, unit.y + 16);
    expect(u.el.querySelector('[data-id="U-S1"] .rf-unit')!.classList.contains('is-sel')).toBe(true);
    expect(u.rev()).toBe(rev0 + 1);

    await u.point(bg, 'pointerdown', 4, 4);
    await u.point(bg, 'pointermove', 40, 4);
    await u.point(bg, 'pointerup', 40, 4);
    expect(u.project().diagramBackground?.x).toBe(0);
    expect(u.rev()).toBe(rev0 + 1);

    const lock = u.el.querySelector('.bg-panel input[type="checkbox"]') as HTMLInputElement;
    await u.click(lock);
    expect(u.project().diagramBackground?.locked).toBe(false);
    expect(u.rev()).toBe(rev0 + 2);
    await u.point(u.el.querySelector('[data-diagram-bg]')!, 'pointerdown', 4, 4);
    await u.point(u.el.querySelector('[data-diagram-bg]')!, 'pointermove', 44, 10);
    await u.point(u.el.querySelector('[data-diagram-bg]')!, 'pointerup', 44, 10);
    expect(u.project().diagramBackground).toMatchObject({ x: 40, y: 6 });
    await u.click(u.btn('실행 취소'));
    expect(u.project().diagramBackground).toMatchObject({ x: 0, y: 0, locked: false });

    const opacity = u.el.querySelector('[aria-label="배경 불투명도"]') as HTMLInputElement;
    await act(async () => {
      opacity.value = '40';
      opacity.dispatchEvent(new Event('input', { bubbles: true }));
      opacity.dispatchEvent(new Event('change', { bubbles: true }));
      opacity.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    });
    expect(u.project().diagramBackground?.opacity).toBe(40);
    const past = u.past();
    await u.click(u.btn('실행 취소'));
    expect(u.past()).toBe(past - 1);
    expect(u.project().diagramBackground?.opacity).toBe(100);

    await u.click(u.btn('배경 바꾸기'));
    await u.choose(fileOf(jpeg(32, 16), 'layout.jpg', 'image/jpeg'));
    expect(u.project().diagramBackground?.width).toBe(32);
    await u.click(u.btn('실행 취소'));
    expect(u.project().diagramBackground?.width).toBe(120);

    await u.click(u.btn('배경 지우기'));
    expect(document.querySelector('.modal-bg')?.textContent).toContain('지웁니다');
    await u.click([...document.querySelectorAll('.modal-actions button')].find((b) => b.textContent === '취소')!);
    expect(u.project().diagramBackground).toBeTruthy();
    await u.click(u.btn('배경 지우기'));
    await u.click([...document.querySelectorAll('.modal-actions button')].find((b) => (b.textContent ?? '').includes('지우기'))!);
    expect(u.project().diagramBackground).toBeUndefined();
    await u.click(u.btn('실행 취소'));
    expect(u.project().diagramBackground?.width).toBe(120);
  });

  it('AC3 AC7: a non-image is refused, and the layer, board, run drawing, and 3D hide the picture', async () => {
    const u = await mount();
    const rev0 = u.rev();
    await u.click(u.btn('배경 도면'));
    await u.choose(new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    const problem = u.el.querySelector('[data-background-reject]')!;
    expect(problem.querySelector('[data-problem-what]')?.textContent).toContain('배경 도면을 넣지 못했습니다');
    expect(problem.querySelector('[data-problem-why]')?.textContent).toContain('PNG');
    expect(problem.querySelector('[data-problem-how]')?.textContent).toContain('JPEG');
    expect(u.rev()).toBe(rev0);
    expect(u.project().diagramBackground).toBeUndefined();

    const wide = new Uint8Array(24);
    wide.set(png(4097, 8));
    await u.choose(fileOf(wide, 'wide.png', 'image/png'));
    expect(u.el.querySelector('[data-problem-why]')?.textContent).toContain('4096');
    expect(u.rev()).toBe(rev0);

    await u.choose(fileOf(png(80, 40), 'ok.png', 'image/png'));
    expect(u.el.querySelector('[data-diagram-bg]')).toBeTruthy();
    const kept = u.rev();
    await u.click(u.btn('레이어'));
    const layer = [...u.el.querySelectorAll('.layerpop label')].find((l) => (l.textContent ?? '').includes('배경'))!;
    await u.click(layer.querySelector('input')!);
    expect(u.el.querySelector('[data-diagram-bg]')).toBeNull();
    expect(u.project().diagramBackground?.width).toBe(80);
    expect(u.rev()).toBe(kept);

    await u.click(u.el.querySelector('#layout-tab-board')!);
    expect(u.el.querySelector('.board [data-diagram-bg]')).toBeNull();
    expect(u.el.querySelector('#layout-panel-diagram')?.hasAttribute('hidden')).toBe(true);

    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    expect(u.el.querySelector('[data-frame="run"] [data-diagram-bg]')).toBeNull();
    await u.click(u.el.querySelector('[aria-label="실행 보기"] [aria-label="3D"], [role="radio"][aria-checked]')!);
    const three = [...u.el.querySelectorAll('[role="radio"]')].find((b) => b.textContent === '3D')!;
    await u.click(three);
    expect(u.el.querySelector('[data-diagram-bg]')).toBeNull();
    expect(u.project().diagramBackground?.width).toBe(80);
  });
});

describe('TURN-059 unit lock on the diagram', () => {
  it('AC9 AC10 AC11: a locked unit does not drag, align skips it, and the padlock stays', async () => {
    const u = await mount();
    const rev0 = u.rev();
    const before = pos(u.el, 'U-S1');
    await u.point(u.el.querySelector('[data-id="U-S1"] .rf-unit')!, 'pointerdown', before.x + 24, before.y + 16);
    await u.point(u.el.querySelector('[data-id="U-S1"] .rf-unit')!, 'pointerup', before.x + 24, before.y + 16);
    await u.click(u.btn('위치 잠금'));
    expect(u.project().units.find((unit) => unit.id === 'U-S1')?.positionLocked).toBe(true);
    expect(u.el.querySelector('[data-unit-lock="U-S1"]')?.getAttribute('aria-label')).toBe('위치 잠금');
    expect(u.el.querySelector('[data-id="U-S1"] .rf-unit-resize')).toBeNull();
    expect(u.rev()).toBe(rev0 + 1);

    await u.point(u.el.querySelector('[data-id="U-S1"] .rf-unit')!, 'pointerdown', before.x + 24, before.y + 16);
    await u.point(u.el.querySelector('[data-id="U-S1"] .rf-unit')!, 'pointermove', before.x + 80, before.y + 16);
    await u.point(u.el.querySelector('[data-id="U-S1"] .rf-unit')!, 'pointerup', before.x + 80, before.y + 16);
    expect(pos(u.el, 'U-S1')).toEqual(before);
    expect(u.rev()).toBe(rev0 + 1);

    const host = u.el.querySelector('.rf-host')!;
    await act(async () => { host.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
    expect(pos(u.el, 'U-S1')).toEqual(before);

    const dev = u.el.querySelector('[data-id="PSH-01"] .rf-device')!;
    const devBefore = pos(u.el, 'PSH-01');
    await u.point(dev, 'pointerdown', devBefore.x + 4, devBefore.y + 4);
    await u.point(dev, 'pointermove', devBefore.x + 30, devBefore.y + 4);
    await u.point(dev, 'pointerup', devBefore.x + 30, devBefore.y + 4);
    const hostBox = u.project().units.find((unit) => unit.id === 'U-S1')!.layout;
    expect(u.project().devices.find((d) => d.id === 'PSH-01')!.layout.x).toBeGreaterThan(devBefore.x);
    expect(hostBox).toEqual({ x: 30, y: 70, w: 216, h: 300 });

    await u.point(u.el.querySelector('[data-id="U-S1"] .rf-unit')!, 'pointerdown', 8, 8, { ctrlKey: true });
    await u.point(u.el.querySelector('[data-id="U-S2"] .rf-unit')!, 'pointerdown', 8, 8, { ctrlKey: true });
    await u.point(u.el.querySelector('[data-id="U-S3"] .rf-unit')!, 'pointerdown', 8, 8, { ctrlKey: true });
    const s3 = u.project().units.find((unit) => unit.id === 'U-S3')!.layout.x;
    await u.click(u.btn('좌 정렬'));
    expect(u.el.querySelector('.toast')?.textContent).toContain('잠긴 Unit 1개는 제외');
    expect(u.project().units.find((unit) => unit.id === 'U-S1')!.layout.x).toBe(before.x);
    expect(u.project().units.find((unit) => unit.id === 'U-S3')!.layout.x).not.toBe(s3);

    await u.click(u.el.querySelector('.react-flow__pane')!);
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true })); });
    await u.click(u.btn('모두 잠금'));
    expect(u.project().units.every((unit) => unit.positionLocked === true)).toBe(true);
    expect(u.el.querySelectorAll('[data-unit-lock]').length).toBe(u.project().units.length);
    await u.click(u.btn('모두 풀기'));
    expect(u.project().units.every((unit) => unit.positionLocked !== true)).toBe(true);
    expect(u.el.querySelector('[data-unit-lock]')).toBeNull();

    await u.click(u.el.querySelector('.react-flow__pane')!);
    await u.point(u.el.querySelector('[data-id="U-S2"] .rf-unit')!, 'pointerdown', 12, 12);
    await u.point(u.el.querySelector('[data-id="U-S2"] .rf-unit')!, 'pointerup', 12, 12);
    const summary = [...u.el.querySelectorAll('summary')].find((s) => s.textContent?.includes('속성 자세히'))!;
    await u.click(summary);
    const box = u.el.querySelector('[aria-label="S2 위치 잠금"]') as HTMLInputElement;
    expect(box.checked).toBe(false);
    await u.click(box);
    expect(u.project().units.find((unit) => unit.id === 'U-S2')?.positionLocked).toBe(true);
    expect(u.el.querySelector('[data-unit-lock="U-S2"]')).toBeTruthy();

    const free = pos(u.el, 'U-S4');
    await u.point(u.el.querySelector('[data-id="U-S4"] .rf-unit')!, 'pointerdown', free.x + 12, free.y + 12);
    await u.point(u.el.querySelector('[data-id="U-S4"] .rf-unit')!, 'pointerup', free.x + 12, free.y + 12);
    const host2 = u.el.querySelector('.rf-host')!;
    await act(async () => { host2.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
    expect(u.project().units.find((unit) => unit.id === 'U-S4')!.layout.x).toBe(free.x + 10);
  });
});
