// @vitest-environment jsdom
// Canvas behavior under jsdom + the ResizeObserver/DOMMatrix stand-ins in tests/setup-dom.ts.
// Wheel, fit-view, and paint are checked again in Chrome (see docs/turns/TURN-005.md). This file is not that check.
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { App } from '../src/ui/App';
import { leftAlignedViewport } from '../src/ui/Canvas';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function pos(root: ParentNode, id: string) {
  const n = root.querySelector(`.react-flow__node[data-id="${id}"]`) as HTMLElement | null;
  const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(n?.style.transform ?? '');
  return { x: m ? Number(m[1]) : NaN, y: m ? Number(m[2]) : NaN };
}

async function mount() {
  localStorage.clear();
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => { root.render(<App />); });
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(label));
  const click = async (node: Element | undefined) => {
    if (!node) throw new Error('missing button');
    await act(async () => { (node as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  };
  const point = async (node: Element, type: string, x: number, y: number, init: PointerEventInit = {}) => {
    await act(async () => {
      node.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, ...init }));
    });
  };
  const rev = () => /rev (\d+)/.exec(el.querySelector('.statusbar')!.textContent!)![1];
  const undoN = () => Number(/Undo (\d+)/.exec(el.querySelector('.statusbar')!.textContent!)![1]);
  await click(btn('시작하기'));
  await click(el.querySelector('.stepper [data-stepid="canvas"]')!);
  return { el, root, btn, click, point, rev, undoN };
}

describe('React Flow canvas (TURN-005)', () => {
  it('a min-zoom fit pins the leftmost node to the left inset and keeps the vertical center', () => {
    const fitted = leftAlignedViewport({ x: -180, y: 36, zoom: 0.5 }, 0.5, 30, 52);
    expect(fitted.y).toBe(36);
    expect(fitted.zoom).toBe(0.5);
    expect(30 * fitted.zoom + fitted.x).toBeCloseTo(52);
    expect(30 * fitted.zoom + fitted.x).toBeGreaterThanOrEqual(52);
    expect(leftAlignedViewport({ x: 12, y: 20, zoom: 0.8 }, 0.5, 30, 52)).toEqual({ x: 12, y: 20, zoom: 0.8 });
  });

  it('AC1 both diagram and run step mount React Flow and drop the hand-drawn svg', async () => {
    const { el, root, click } = await mount();
    expect(el.querySelector('svg.canvas-svg')).toBeNull();
    expect(el.querySelector('.react-flow')).not.toBeNull();
    expect(el.querySelector('.react-flow__minimap')).not.toBeNull();
    expect(el.querySelector('.react-flow__controls')).not.toBeNull();
    expect(el.querySelector('.rf-legend')?.textContent).toContain('자재 흐름(물류)');
    expect(el.querySelector('.rf-mat')).not.toBeNull();
    await click(el.querySelector('.stepper [data-stepid="run"]')!);
    expect(el.querySelector('svg.canvas-svg')).toBeNull();
    expect(el.querySelector('.react-flow')).not.toBeNull();
    await act(async () => { root.unmount(); });
  });

  it('AC2 one drag of several nodes is one undo step and redo puts them back', async () => {
    const { el, root, point, undoN, click } = await mount();
    const a0 = pos(el, 'CYL-01');
    const b0 = pos(el, 'CYL-03');
    const flows = el.querySelectorAll('.rf-edge-flow').length;
    const sigs = el.querySelectorAll('.rf-edge-sig').length;
    const hit = (id: string) => el.querySelector(`.react-flow__node[data-id="${id}"] .rf-device`)!;
    await point(hit('CYL-01'), 'pointerdown', a0.x, a0.y);
    await point(hit('CYL-01'), 'pointerup', a0.x, a0.y);
    await point(hit('CYL-03'), 'pointerdown', b0.x, b0.y, { shiftKey: true });
    await point(hit('CYL-03'), 'pointerup', b0.x, b0.y, { shiftKey: true });
    await point(hit('CYL-03'), 'pointerdown', b0.x, b0.y);
    await point(hit('CYL-03'), 'pointermove', b0.x + 40, b0.y - 10);
    await point(hit('CYL-03'), 'pointerup', b0.x + 40, b0.y - 10);
    const a1 = pos(el, 'CYL-01');
    const b1 = pos(el, 'CYL-03');
    expect(a1.x - a0.x).toBe(40);
    expect(a1.y - a0.y).toBe(-10);
    expect(b1.x - b0.x).toBe(40);
    expect(b1.y - b0.y).toBe(-10);
    expect(undoN()).toBe(1);
    expect(el.querySelectorAll('.rf-edge-flow').length).toBe(flows);
    expect(el.querySelectorAll('.rf-edge-sig').length).toBe(sigs);
    expect(el.querySelector('[data-id="CYL-01"]')).not.toBeNull();
    expect(el.querySelector('[data-id="U-S1"]')).not.toBeNull();
    await click(el.querySelector('[aria-label="실행 취소"]')!);
    expect(pos(el, 'CYL-01')).toEqual(a0);
    expect(pos(el, 'CYL-03')).toEqual(b0);
    expect(undoN()).toBe(0);
    await click(el.querySelector('[aria-label="다시 실행"]')!);
    expect(pos(el, 'CYL-01')).toEqual(a1);
    expect(pos(el, 'CYL-03')).toEqual(b1);
    expect(undoN()).toBe(1);
    await act(async () => { root.unmount(); });
  }, 20000);

  it('AC3 dropping a device on another unit opens the same reparent modal', async () => {
    const { el, root, point } = await mount();
    const hit = el.querySelector('.react-flow__node[data-id="CYL-01"] .rf-device')!;
    const start = pos(el, 'CYL-01');
    await point(hit, 'pointerdown', start.x + 10, start.y + 10);
    await point(hit, 'pointermove', 320, 200);
    await point(hit, 'pointerup', 320, 200);
    const dlg = el.querySelector('.modal');
    expect(dlg?.getAttribute('aria-label')).toMatch(/소속 Unit 변경/);
    expect(dlg?.textContent).toContain('좌표만 이동');
    expect(dlg?.textContent).toContain('소속 변경 + 이동');
    await act(async () => { root.unmount(); });
  });

  it('a selected unit stays under its devices, signal edges, and the material', async () => {
    const { el, root, point } = await mount();
    const z = (id: string) => Number((el.querySelector(`.react-flow__node[data-id="${id}"]`) as HTMLElement).style.zIndex);
    const at = pos(el, 'U-S2');
    await point(el.querySelector('[data-id="U-S2"] .rf-unit')!, 'pointerdown', at.x + 8, at.y + 8);
    await point(el.querySelector('[data-id="U-S2"] .rf-unit')!, 'pointerup', at.x + 8, at.y + 8);
    expect(el.querySelector('[data-id="U-S2"] .rf-unit')?.classList.contains('is-sel')).toBe(true);
    expect(z('BCR-02')).toBeGreaterThan(z('U-S2'));
    expect(z('STP-02')).toBeGreaterThan(z('U-S2'));
    expect(z('runtime-material')).toBeGreaterThan(z('U-S2'));
    const edgeSvg = el.querySelector('.rf-edge-sig')?.closest('svg') as SVGElement;
    expect(Number(edgeSvg.style.zIndex)).toBeGreaterThan(z('U-S2'));
    expect(el.querySelector('.rf-legend')?.getAttribute('title')).toContain('배경: 도면/VC 탑뷰 없음');
    expect(el.querySelector('.rf-bg-note')).toBeNull();
    await act(async () => { root.unmount(); });
  });

  it('AC4 toolbar, controls, and wheel change zoom without writing model coordinates', async () => {
    const { el, root, click, rev } = await mount();
    const before = pos(el, 'U-S1');
    const r0 = rev();
    const pill = () => el.querySelector('.zoom-pill span')!.textContent;
    expect(pill()).toBe('100%');
    await click(el.querySelector('[aria-label="확대"]')!);
    expect(pill()).toBe('110%');
    expect(pos(el, 'U-S1')).toEqual(before);
    expect(rev()).toBe(r0);
    await click(el.querySelector('.react-flow__controls-zoomin')!);
    expect(pill()).not.toBe('110%');
    expect(pos(el, 'U-S1')).toEqual(before);
    expect(rev()).toBe(r0);
    const flow = el.querySelector('.react-flow')!;
    await act(async () => {
      flow.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120, clientX: 40, clientY: 40 }));
    });
    expect(pos(el, 'U-S1')).toEqual(before);
    expect(rev()).toBe(r0);
    await click(el.querySelector('.react-flow__controls-fitview')!);
    expect(pos(el, 'U-S1')).toEqual(before);
    expect(rev()).toBe(r0);
    await act(async () => { root.unmount(); });
  });

  it('AC5 connect, layers, align, delete, and the run lock still work', async () => {
    const { el, root, btn, click, point, rev } = await mount();
    const r0 = rev();
    await click(btn('물류 연결')!);
    await point(el.querySelector('[data-id="U-S1"] .rf-unit')!, 'pointerdown', 40, 80);
    await point(el.querySelector('[data-id="U-S3"] .rf-unit')!, 'pointerdown', 520, 80);
    expect(Number(rev())).toBe(Number(r0) + 1);
    expect(el.querySelectorAll('.rf-edge-flow').length).toBe(5);
    await click(btn('신호 연결')!);
    const out = el.querySelector('.rf-port.out[data-device="STP-05"]')!;
    const inn = el.querySelector('.rf-port.in[data-device="CNV-05"]')!;
    await point(out, 'pointerdown', 0, 0);
    await point(inn, 'pointerdown', 0, 0);
    expect(el.querySelectorAll('.rf-edge-sig').length).toBe(4);
    await click(btn('선택/이동')!);
    await click(btn('레이어')!);
    const flowBox = [...el.querySelectorAll('.layerpop label')].find((l) => (l.textContent ?? '').includes('물류'))!.querySelector('input')!;
    await click(flowBox);
    expect(el.querySelector('.rf-edge-flow')).toBeNull();
    expect(el.querySelector('.rf-mat')).toBeNull();
    const unitBox = [...el.querySelectorAll('.layerpop label')].find((l) => (l.textContent ?? '').includes('Substation'))!.querySelector('input')!;
    await click(unitBox);
    expect(el.querySelector('.rf-unit')?.classList.contains('is-off')).toBe(true);
    const ioBox = [...el.querySelectorAll('.layerpop label')].find((l) => (l.textContent ?? '').includes('포트'))!.querySelector('input')!;
    await click(ioBox);
    expect(el.querySelector('.rf-edge-sig')).toBeNull();
    expect(el.querySelector('.rf-device')?.classList.contains('ports-off')).toBe(true);
    await click(flowBox);
    await click(unitBox);
    await click(ioBox);
    const rPhoto = rev();
    await click(btn('실사풍(AI)')!);
    expect(el.querySelectorAll('svg image').length).toBeGreaterThan(0);
    expect(rev()).toBe(rPhoto);
    await click(btn('도식')!);
    expect(el.querySelectorAll('svg image').length).toBe(0);
    expect(rev()).toBe(rPhoto);
    const a = pos(el, 'CYL-01');
    const b = pos(el, 'CYL-03');
    const hit = (id: string) => el.querySelector(`.react-flow__node[data-id="${id}"] .rf-device`)!;
    await point(hit('CYL-01'), 'pointerdown', a.x, a.y);
    await point(hit('CYL-01'), 'pointerup', a.x, a.y);
    await point(hit('CYL-03'), 'pointerdown', b.x, b.y, { shiftKey: true });
    await point(hit('CYL-03'), 'pointerup', b.x, b.y, { shiftKey: true });
    await click([...el.querySelectorAll('.diagram-tools button')].find((b) => (b.textContent ?? '').includes('좌 정렬'))!);
    expect(pos(el, 'CYL-01').x).toBe(pos(el, 'CYL-03').x);
    await click(el.querySelector('.react-flow__pane')!);
    const only = pos(el, 'CYL-01');
    await point(hit('CYL-01'), 'pointerdown', only.x, only.y);
    await point(hit('CYL-01'), 'pointerup', only.x, only.y);
    await click(el.querySelector('.diagram-tools .danger')!);
    expect(el.querySelector('.modal')?.textContent ?? '').toContain('삭제');
    await click([...el.querySelectorAll('.modal button')].find((b) => (b.textContent ?? '').includes('참조 해제 후 삭제'))!);
    expect(el.querySelector('[data-id="CYL-01"]')).toBeNull();
    await click(el.querySelector('.stepper [data-stepid="run"]')!);
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
    try {
      await click(btn('▶ 실행')!);
      expect(el.querySelector('.statusbar')?.textContent).toContain('실행 중 편집 잠금');
    } finally {
      globalThis.requestAnimationFrame = raf;
    }
    const dev = el.querySelector('.react-flow__node[data-id="PSH-01"] .rf-device')!;
    const at = pos(el, 'PSH-01');
    await point(dev, 'pointerdown', at.x, at.y);
    expect(el.querySelector('.toast')?.textContent).toContain('실행 중에는 배치 이동');
    await act(async () => { root.unmount(); });
  }, 20000);

  it('AC7 visual rules use tokens, and only the unit shadow is a new color literal', () => {
    const css = readFileSync('src/ui/styles.css', 'utf8');
    const src = readFileSync('src/ui/Canvas.tsx', 'utf8');
    const section = css.slice(css.indexOf('/* TURN-005'));
    expect(src).toContain("@xyflow/react/dist/base.css");
    expect(src).not.toContain('style.css');
    expect(section).toContain('border-radius: 10px');
    expect(section).toContain('background: var(--panel)');
    expect(section).toContain('border: 1px solid var(--border)');
    expect(section).toContain('height: 28px');
    expect(section).toMatch(/\.rf-legend \{[\s\S]*?height: 28px/);
    expect(section).toMatch(/\.rf-legend \{[\s\S]*?flex-direction: row/);
    expect(section).toContain('background: var(--selected)');
    expect(section).toContain('border-radius: 6px');
    expect(section).toContain('font-weight: 600');
    expect(section).toContain('font-size: 11px');
    expect(section).toContain('color: var(--muted)');
    expect(section).toContain('border-radius: 8px');
    expect(section).toContain('outline: 2px solid var(--accent)');
    expect(section).toContain('outline-offset: 2px');
    expect(section).toContain('color-mix(in srgb, var(--accent) 25%, transparent)');
    expect(section).toContain('stroke-dasharray: 5 4');
    expect(section).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.react-flow__edge-path\.rf-sig-on \{ animation: none; \}/);
    expect(section).toContain('width: 28px');
    expect(section).toContain('height: 28px');
    expect(section).toContain('width: 160px');
    expect(section).toContain('height: 110px');
    expect(section).toContain('box-shadow: 0 1px 2px rgba(16, 24, 40, .06), 0 4px 12px rgba(16, 24, 40, .06)');
    expect(section).toContain('box-shadow: none');
    const bare = section.replace(/rgba\(16,\s*24,\s*40,\s*\.06\)/g, '');
    expect(bare).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(bare).not.toMatch(/rgba?\(/);
    expect(css).toMatch(/\.diagram-canvas \{[^}]*overflow: hidden/);
  });
});
