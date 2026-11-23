// @vitest-environment jsdom
// TURN-048: edge emphasis is view-only, and the 1280×800 diagram keeps at least 320px.
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSampleProject } from '../src/model/sample';
import { App } from '../src/ui/App';
import {
  minimapScreenRect,
  planFitReport,
  runEquipmentBoxes,
  runFitPad,
  runPlanViewport,
  screenBox,
  unionBounds,
  unitsClearMinimap,
  RUN_FIT_PAD,
} from '../src/ui/Canvas';
import { DIM_EDGE_OPACITY, edgeWidth, flowCaption, graphFocus, portWord, signalCaption } from '../src/ui/edgeFocus';
import { DIAGRAM_MIN, PALETTE_NATURAL, fitPalette, roomForPaletteAndDiagram, stage2DiagramHeight, stage2OverlayClears } from '../src/ui/screenRoom';
import { loadView } from '../src/ui/viewSettings';
import { VIEW_KEY } from '../src/storage/localStore';
import { holdRuntimeClock } from './holdRuntimeClock';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const css = readFileSync('src/ui/styles.css', 'utf8');
const appSrc = readFileSync('src/ui/App.tsx', 'utf8');
let root: Root | null = null;
let restoreObserver: (() => void) | null = null;

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  restoreObserver?.();
  restoreObserver = null;
  document.body.innerHTML = '';
  localStorage.clear();
});

function installPane(width: number, height: number) {
  const previous = globalThis.ResizeObserver;
  const box = (w: number, h: number) => ({
    x: 0, y: 0, top: 0, left: 0, right: w, bottom: h, width: w, height: h, toJSON() { return {}; },
  });
  const watched: { cb: ResizeObserverCallback; target: Element }[] = [];
  const fire = () => {
    for (const w of [...watched]) {
      const host = w.target.classList.contains('rf-host') || w.target.classList.contains('react-flow');
      w.cb([{
        target: w.target,
        contentRect: box(host ? width : 0, host ? height : 0) as DOMRectReadOnly,
        borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [],
      } as unknown as ResizeObserverEntry], {} as ResizeObserver);
    }
  };
  class RO {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) { this.cb = cb; }
    observe(target: Element) { watched.push({ cb: this.cb, target }); fire(); }
    unobserve(target: Element) {
      const i = watched.findIndex((w) => w.cb === this.cb && w.target === target);
      if (i >= 0) watched.splice(i, 1);
    }
    disconnect() {
      for (let i = watched.length - 1; i >= 0; i -= 1) if (watched[i].cb === this.cb) watched.splice(i, 1);
    }
  }
  globalThis.ResizeObserver = RO as unknown as typeof ResizeObserver;
  restoreObserver = () => { globalThis.ResizeObserver = previous; };
  return { fire };
}

async function mount() {
  localStorage.clear();
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(<App />); });
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label || b.getAttribute('aria-label') === label);
  const click = async (node: Element | undefined) => {
    if (!node) throw new Error('missing control');
    await act(async () => { (node as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  };
  const point = async (node: Element, type: string, x = 0, y = 0) => {
    await act(async () => {
      node.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1 }));
    });
  };
  const rev = () => el.querySelector('.statusbar')!.textContent ?? '';
  await click(btn('시작하기'));
  return { el, btn, click, point, rev };
}

function pathOf(edge: Element) {
  return edge.querySelector('.react-flow__edge-path') as SVGPathElement;
}

function widthOf(edge: Element) {
  return parseFloat(pathOf(edge).style.strokeWidth);
}

function opacityOf(edge: Element) {
  const raw = pathOf(edge).style.opacity;
  return raw === '' ? 1 : parseFloat(raw);
}

const sample = buildSampleProject();

function captionFor(id: string) {
  const c = sample.connections.find((x) => x.id === id)!;
  if (c.kind === 'flow') {
    const a = sample.units.find((u) => u.id === c.from.nodeId)!;
    const b = sample.units.find((u) => u.id === c.to.nodeId)!;
    return flowCaption(a.name, b.name);
  }
  const from = sample.devices.find((d) => d.id === c.from.nodeId)!;
  const to = sample.devices.find((d) => d.id === c.to.nodeId)!;
  const fs = sample.signals.find((s) => s.id === c.from.signalId)!;
  const ts = sample.signals.find((s) => s.id === c.to.signalId)!;
  return signalCaption(from.name, portWord(from.name, fs.name, fs.portKey), to.name, portWord(to.name, ts.name, ts.portKey));
}

async function openDiagram(u: Awaited<ReturnType<typeof mount>>) {
  await u.click(u.el.querySelector('.stepper [data-stepid="canvas"] .st-go')!);
  await u.click(u.btn('도면 도식'));
}

describe('TURN-048 edge emphasis', () => {
  it('AC1 picking a device highlights only its signal lines, and clearing the pick restores plain lines', async () => {
    const u = await mount();
    await openDiagram(u);
    const flows = () => [...u.el.querySelectorAll('.rf-edge-flow')];
    const sigs = () => [...u.el.querySelectorAll('.rf-edge-sig')];
    expect(u.el.querySelector('.rf-host')!.getAttribute('data-focus')).toBe('0');
    expect(u.el.querySelector('.is-hot, .is-dim')).toBeNull();
    expect(widthOf(flows()[0])).toBe(edgeWidth('flow', 'plain', false));

    const dev = u.el.querySelector('[data-id="STP-02"] .rf-device')!;
    await u.point(dev, 'pointerdown', 8, 8);
    await u.point(dev, 'pointerup', 8, 8);
    expect(u.el.querySelector('.rf-host')!.getAttribute('data-focus')).toBe('1');
    const hot = sigs().filter((e) => e.classList.contains('is-hot')).map((e) => e.getAttribute('data-id'));
    expect(hot).toEqual(['SIGC-1']);
    expect(sigs().filter((e) => e.classList.contains('is-dim')).map((e) => e.getAttribute('data-id')).sort()).toEqual(['SIGC-2', 'SIGC-3']);
    expect(flows().every((e) => e.classList.contains('is-dim'))).toBe(true);
    expect(u.el.querySelector('[data-id="BCR-02"] .rf-device')!.classList.contains('is-focus')).toBe(true);

    const pane = u.el.querySelector('.react-flow__pane')!;
    await act(async () => { pane.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(u.el.querySelector('.rf-host')!.getAttribute('data-focus')).toBe('0');
    expect(u.el.querySelector('.is-hot, .is-dim')).toBeNull();
    expect(widthOf(flows()[0])).toBe(edgeWidth('flow', 'plain', false));
  });

  it('AC2 picking a unit highlights its flow lines and the signal lines of its devices', async () => {
    const u = await mount();
    await openDiagram(u);
    const unit = u.el.querySelector('[data-id="U-S2"] .rf-unit')!;
    await u.point(unit, 'pointerdown', 8, 8);
    await u.point(unit, 'pointerup', 8, 8);
    const hot = [...u.el.querySelectorAll('.react-flow__edge.is-hot')].map((e) => e.getAttribute('data-id')).sort();
    expect(hot).toEqual(['FLOW-1', 'FLOW-2', 'SIGC-1']);
    expect(u.el.querySelector('[data-id="SIGC-2"]')!.classList.contains('is-dim')).toBe(true);
    expect(u.el.querySelector('[data-id="U-S1"] .rf-unit')!.classList.contains('is-focus')).toBe(true);
    expect(u.el.querySelector('[data-id="BCR-02"] .rf-device')!.classList.contains('is-focus')).toBe(true);
  });

  it('AC3 a hot line is thicker, and a dim line stays visible', async () => {
    const u = await mount();
    await openDiagram(u);
    const dev = u.el.querySelector('[data-id="STP-02"] .rf-device')!;
    await u.point(dev, 'pointerdown', 4, 4);
    await u.point(dev, 'pointerup', 4, 4);
    const hot = u.el.querySelector('.rf-edge-sig.is-hot')!;
    const dim = u.el.querySelector('.rf-edge-flow.is-dim')!;
    expect(widthOf(hot)).toBe(edgeWidth('signal', 'hot', false));
    expect(widthOf(dim)).toBe(edgeWidth('flow', 'dim', false));
    expect(widthOf(hot)).toBeGreaterThan(widthOf(u.el.querySelector('.rf-edge-sig.is-dim')!));
    expect(opacityOf(dim)).toBe(DIM_EDGE_OPACITY);
    expect(opacityOf(dim)).toBeGreaterThan(0);
    expect(opacityOf(hot)).toBe(1);
    expect(edgeWidth('flow', 'hot', false)).toBeGreaterThan(edgeWidth('flow', 'plain', false));
  });

  it('AC4 hovering a line shows the from → to names, and picking the line does too', async () => {
    const u = await mount();
    await openDiagram(u);
    expect(u.el.querySelector('.rf-edge-label')).toBeNull();
    const sig = u.el.querySelector('.react-flow__edge[data-id="SIGC-1"]')!;
    await act(async () => { sig.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    expect(u.el.querySelector('.rf-edge-label')!.textContent).toBe(captionFor('SIGC-1'));
    expect(captionFor('SIGC-1')).toContain('STP-02 · ');
    expect(captionFor('SIGC-1')).toContain(' → ');
    expect(captionFor('SIGC-1')).toContain('BCR-02 · ');
    await act(async () => { sig.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })); });
    expect(u.el.querySelector('.rf-edge-label')).toBeNull();

    const flow = u.el.querySelector('.react-flow__edge[data-id="FLOW-1"]')!;
    await act(async () => { flow.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(u.el.querySelector('.rf-edge-label')!.textContent).toBe(captionFor('FLOW-1'));
    expect(captionFor('FLOW-1')).toBe('S1 투입 → S2 식별');
  });

  it('AC5 the run drawing highlights and names lines without changing the run', async () => {
    const u = await mount();
    await u.click(u.el.querySelector('.stepper [data-stepid="run"] .st-go')!);
    const clock = holdRuntimeClock();
    try {
      await u.click(u.btn('▶ 실행'));
      await clock.elapse(400);
    } finally {
      clock.restore();
    }
    const snap = () => ({
      status: u.el.querySelector('[data-run-status]')!.textContent,
      time: u.el.querySelector('[data-run-time]')!.textContent,
      rev: u.rev(),
    });
    const before = snap();
    expect(before.status).toBe('실행 중');
    const dev = u.el.querySelector('.run-canvas [data-id="STP-02"] .rf-device')!;
    await u.point(dev, 'pointerdown', 4, 4);
    await u.point(dev, 'pointerup', 4, 4);
    expect(u.el.querySelector('.run-canvas .rf-edge-sig.is-hot')!.getAttribute('data-id')).toBe('SIGC-1');
    expect(u.el.querySelectorAll('.run-canvas .is-dim').length).toBeGreaterThan(0);
    const sig = u.el.querySelector('.run-canvas .react-flow__edge[data-id="SIGC-1"]')!;
    await act(async () => { sig.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    const label = u.el.querySelector('.rf-edge-label')!;
    expect(label.textContent).toBe(captionFor('SIGC-1'));
    expect(label.getAttribute('hidden')).toBeNull();
    expect(getComputedStyle(label).opacity).not.toBe('0');
    // TURN-054: names and ports still wait for 120%. This session stays at 100% (mid).
    // TURN-078: the run symbol stays at that tier, so the state is not color alone.
    expect(u.el.querySelector('.run-canvas .rf-host')?.getAttribute('data-label-tier')).toBe('mid');
    expect(u.el.querySelector('.run-canvas .rf-run-mark [data-status="active"]')).not.toBeNull();
    expect(snap()).toEqual(before);
  });

  it('AC6 emphasis and the name label do not change rev or the undo count', async () => {
    const u = await mount();
    await openDiagram(u);
    const before = u.rev();
    expect(before).toMatch(/Undo 0/);
    const dev = u.el.querySelector('[data-id="CYL-03"] .rf-device')!;
    await u.point(dev, 'pointerdown', 4, 4);
    await u.point(dev, 'pointerup', 4, 4);
    const edge = u.el.querySelector('.react-flow__edge[data-id="SIGC-2"]')!;
    await act(async () => { edge.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    expect(u.el.querySelector('.rf-edge-label')).not.toBeNull();
    await act(async () => { edge.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(u.rev()).toBe(before);
    const focus = graphFocus({
      selection: ['CYL-03'],
      units: sample.units,
      devices: sample.devices,
      connections: sample.connections.map((c) => ({ id: c.id, kind: c.kind, from: c.from.nodeId, to: c.to.nodeId })),
    });
    expect(focus.active).toBe(true);
    expect(focus.hotEdges.has('SIGC-2')).toBe(true);
    expect(sample.revision).toBe(buildSampleProject().revision);
  });
});

describe('TURN-048 screen room', () => {
  it('AC7 the palette keeps every row while the diagram stays at least 320px, and marks hidden rows', async () => {
    const wide = fitPalette(roomForPaletteAndDiagram(1000), PALETTE_NATURAL.w1600);
    expect(wide.clipped).toBe(false);
    expect(wide.palette).toBe(PALETTE_NATURAL.w1600);
    expect(wide.diagram).toBeGreaterThanOrEqual(DIAGRAM_MIN);
    const narrow = fitPalette(roomForPaletteAndDiagram(800), PALETTE_NATURAL.w1280);
    expect(narrow.diagram).toBeGreaterThanOrEqual(DIAGRAM_MIN);
    expect(narrow.diagram).toBe(stage2DiagramHeight());
    expect(narrow.clipped).toBe(true);
    expect(narrow.palette).toBeLessThan(PALETTE_NATURAL.w1280);
    expect(stage2OverlayClears(narrow.diagram)).toBe(true);
    expect(css).toMatch(/\.app \.ws-canvas > \.stage\.layout-stage \{[^}]*padding:\s*2px var\(--sp-4\)/);
    expect(css).toMatch(/\.app \.ws-canvas > \.stage\.layout-stage \{[^}]*gap:\s*var\(--sp-1\)/);
    expect(css).toMatch(/\.layout-stage \.layout-tabs \.diagram-canvas \{[^}]*min-height:\s*320px/);
    expect(css).not.toMatch(/\.layout-stage \.palette-fold \.palette \{[^}]*max-height:\s*40px/);
    expect(css).toMatch(/\.layout-stage \.palette-fold \.palette \{[^}]*overflow-y:\s*auto/);
    expect(css).toMatch(/\.layout-stage \.palette-fold \.palette \{[^}]*overflow-x:\s*hidden/);
    expect(css).toMatch(/\.palette-more \{/);
    expect(appSrc).toContain('data-palette-more');
    expect(appSrc).toContain('개 더');
    const u = await mount();
    await openDiagram(u);
    const items = [...u.el.querySelectorAll('.layout-stage .palette .pi')];
    expect(items).toHaveLength(15);
    expect(items.every((n) => n.getAttribute('draggable') === 'true' && !n.hasAttribute('hidden'))).toBe(true);
    expect(items.some((n) => (n.textContent ?? '').includes('빈 유닛'))).toBe(true);
    expect(u.el.querySelector('.palette-fold')!.hasAttribute('open')).toBe(true);
  });

  it('AC8 the palette fold is remembered and the strip opens it again', async () => {
    const u = await mount();
    await u.click(u.el.querySelector('.stepper [data-stepid="canvas"] .st-go')!);
    const fold = () => u.el.querySelector('.palette-fold') as HTMLDetailsElement;
    expect(fold().open).toBe(true);
    await act(async () => {
      fold().open = false;
      fold().dispatchEvent(new Event('toggle'));
    });
    expect(fold().open).toBe(false);
    expect(loadView(localStorage).paletteOpen).toBe(false);
    expect(u.el.querySelector('.palette-fold .fold-closed')!.textContent).toContain('팔레트 펼치기');
    await act(async () => { root!.unmount(); });
    root = createRoot(u.el);
    await act(async () => { root!.render(<App />); });
    await u.click(u.el.querySelector('.stepper [data-stepid="canvas"] .st-go')!);
    expect(fold().open).toBe(false);
    await act(async () => {
      fold().open = true;
      fold().dispatchEvent(new Event('toggle'));
    });
    expect(fold().open).toBe(true);
    expect(loadView(localStorage).paletteOpen).toBe(true);
    expect(u.el.querySelectorAll('.palette .pi')).toHaveLength(15);
  });

  it('AC9 the minimap folds per drawing, layout open and run closed at first', async () => {
    expect(loadView(null).minimap).toEqual({ layout: true, run: false });
    expect(loadView(null).paletteOpen).toBe(true);
    localStorage.setItem(VIEW_KEY, JSON.stringify({ home: false, step: 'canvas' }));
    expect(loadView(localStorage).minimap).toEqual({ layout: true, run: false });
    localStorage.clear();

    const u = await mount();
    await openDiagram(u);
    expect(u.el.querySelector('.layout-tabs .react-flow__minimap')).not.toBeNull();
    expect(u.el.querySelector('.rf-host')!.getAttribute('data-minimap')).toBe('open');
    await u.click(u.btn('미니맵 접기'));
    expect(u.el.querySelector('.layout-tabs .react-flow__minimap')).toBeNull();
    expect(u.el.querySelector('[aria-label="미니맵 펼치기"]')).not.toBeNull();
    expect(loadView(localStorage).minimap).toEqual({ layout: false, run: false });

    await u.click(u.el.querySelector('.stepper [data-stepid="run"] .st-go')!);
    expect(u.el.querySelector('.run-canvas .react-flow__minimap')).toBeNull();
    expect(u.el.querySelector('.run-canvas .rf-host')!.getAttribute('data-minimap')).toBe('closed');
    await u.click(u.btn('미니맵 펼치기'));
    expect(u.el.querySelector('.run-canvas .react-flow__minimap')).not.toBeNull();
    expect(loadView(localStorage).minimap).toEqual({ layout: false, run: true });

    await u.click(u.el.querySelector('.stepper [data-stepid="canvas"] .st-go')!);
    expect(u.el.querySelector('.layout-tabs .react-flow__minimap')).toBeNull();
    expect(loadView(localStorage).minimap.layout).toBe(false);
  });

  it('AC10 fitting the run drawing with the minimap open keeps every unit clear of it', async () => {
    const project = buildSampleProject();
    const equipment = unionBounds(runEquipmentBoxes(project, null))!;
    const units = project.units.map((u) => ({ x: u.layout.x, y: u.layout.y, w: u.layout.w, h: u.layout.h }));
    expect(units).toHaveLength(5);
    expect(runFitPad(false)).toEqual(RUN_FIT_PAD);
    const openPad = runFitPad(true);
    expect(openPad.right).toBeGreaterThan(RUN_FIT_PAD.right);
    expect(openPad.bottom).toBeGreaterThan(RUN_FIT_PAD.bottom);
    for (const [w, h] of [[576, 389], [1100, 240], [768, 360]] as const) {
      const vp = runPlanViewport(equipment, w, h, openPad);
      expect(unitsClearMinimap(units, w, h, vp), `${w}×${h}`).toBe(true);
      const map = minimapScreenRect(w, h);
      for (const unit of units) {
        const box = screenBox(unit, vp);
        expect(box.x + box.w).toBeLessThanOrEqual(map.x + 0.5);
        expect(box.y + box.h).toBeLessThanOrEqual(map.y + 0.5);
      }
    }

    installPane(576, 389);
    const u = await mount();
    await u.click(u.el.querySelector('.stepper [data-stepid="run"] .st-go')!);
    await act(async () => { await Promise.resolve(); });
    const read = () => {
      const t = (u.el.querySelector('.run-canvas .react-flow__viewport') as HTMLElement).style.transform;
      const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/.exec(t);
      if (!m) throw new Error(t);
      return { x: Number(m[1]), y: Number(m[2]), zoom: Number(m[3]) };
    };
    const closed = runPlanViewport(equipment, 576, 389, RUN_FIT_PAD);
    const first = read();
    expect(first.zoom).toBeCloseTo(closed.zoom, 2);
    expect(planFitReport(unionBounds(units)!, 576, 389, first).inside).toBe(true);
    await u.click(u.btn('미니맵 펼치기'));
    await u.click(u.btn('화면 맞춤'));
    await act(async () => { await Promise.resolve(); });
    const fitted = read();
    const expected = runPlanViewport(equipment, 576, 389, openPad);
    expect(fitted.zoom).toBeCloseTo(expected.zoom, 2);
    expect(fitted.x).toBeCloseTo(expected.x, 0);
    expect(fitted.y).toBeCloseTo(expected.y, 0);
    expect(unitsClearMinimap(units, 576, 389, fitted)).toBe(true);
    expect(u.rev()).toMatch(/Undo 0/);
  });
});
