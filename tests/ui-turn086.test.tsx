// @vitest-environment jsdom
// TURN-086 viewpoint, compass, grid, and selection. jsdom has no WebGL, so the canvas shows the fallback.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/ui/App';
import { Scene3D } from '../src/ui/Scene3D';
import { describeScene } from '../src/scene/describe';
import { buildSampleProject } from '../src/model/sample';
import { loadView } from '../src/ui/viewSettings';
import { compassRotationDeg, type SceneViewpoint } from '../src/scene/viewQuality';

const VIEW_WAIT = 320;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const realMatch = window.matchMedia?.bind(window);

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  document.head.querySelectorAll('style').forEach((node) => node.remove());
  localStorage.clear();
  if (realMatch) window.matchMedia = realMatch;
  vi.useRealTimers();
});

function reduceMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as typeof window.matchMedia;
}

async function mount(keepStorage = false) {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  if (!keepStorage) localStorage.clear();
  const css = document.createElement('style');
  css.textContent = `${readFileSync('src/ui/styles.css', 'utf8')}\n${readFileSync('src/ui/run3d.css', 'utf8')}\n${readFileSync('src/ui/scene3d-quality.css', 'utf8')}`;
  document.head.appendChild(css);
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(<App />); });
  const click = async (node: Element) => { await act(async () => { (node as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
  const btn = (label: string) => [...el.querySelectorAll('button')].find((item) => (item.textContent ?? '').trim() === label) as HTMLButtonElement;
  return { el, click, btn };
}

async function open3d(keepStorage = false) {
  const ui = await mount(keepStorage);
  await ui.click(ui.btn('시작하기'));
  await ui.click(ui.el.querySelector('.stepper [data-stepid="run"]')!);
  await ui.click(ui.btn('3D'));
  return ui;
}

describe('TURN-086 3D view controls', () => {
  it('AC1 viewpoint buttons and keys 1~4 move at once when motion is reduced', async () => {
    reduceMotion(true);
    const ui = await open3d();
    const stage = () => ui.el.querySelector('.run-stage')!;
    expect(stage().getAttribute('data-view-move')).toBe('instant');
    expect(stage().getAttribute('data-viewpoint')).toBe('iso');
    expect(stage().getAttribute('data-camera-yaw')).toBe('0.700');
    await ui.click(ui.el.querySelector('[aria-label="시점 위"]')!);
    expect(stage().getAttribute('data-camera-yaw')).toBe('0.000');
    expect(stage().getAttribute('data-camera-pitch')).toBe('1.500');
    expect(stage().getAttribute('data-viewpoint')).toBe('top');
    expect(loadView(localStorage).sceneViewpoint).toBe('top');
    const host = stage() as HTMLElement;
    await act(async () => { host.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true })); });
    expect(stage().getAttribute('data-camera-yaw')).toBe('0.000');
    expect(stage().getAttribute('data-viewpoint')).toBe('front');
    await act(async () => { host.dispatchEvent(new KeyboardEvent('keydown', { key: '4', bubbles: true })); });
    expect(stage().getAttribute('data-camera-yaw')).toBe('1.571');
    await act(async () => { host.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true })); });
    expect(stage().getAttribute('data-camera-yaw')).toBe('0.700');
    expect(stage().getAttribute('data-camera-pitch')).toBe('0.620');
    await act(async () => { host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })); });
    expect(stage().getAttribute('data-camera-yaw')).toBe('0.700');
  });

  it('AC1 a smooth move waits for the duration, then lands', async () => {
    vi.useFakeTimers();
    reduceMotion(false);
    const scene = describeScene(buildSampleProject(), null);
    const el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    let viewpoint: SceneViewpoint = 'iso';
    const draw = () => {
      root!.render(<Scene3D scene={scene} showNames emphasize visualMode="schematic" equipmentMotion running={false} selectedId={null} selectedUnitId={null}
        viewpoint={viewpoint} onViewpoint={(id) => { viewpoint = id; }} showGrid
        onSelect={() => {}} onDiagram={() => {}} />);
    };
    await act(async () => { draw(); });
    const stage = () => el.querySelector('.run-stage')!;
    expect(stage().getAttribute('data-view-move')).toBe('smooth');
    await act(async () => { (el.querySelector('[aria-label="시점 위"]') as HTMLButtonElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(stage().getAttribute('data-camera-pitch')).toBe('0.620');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(VIEW_WAIT);
      draw();
    });
    expect(stage().getAttribute('data-camera-pitch')).toBe('1.500');
  });

  it('AC2 the compass follows the camera and a click goes to that side', async () => {
    reduceMotion(true);
    const ui = await open3d();
    const stage = () => ui.el.querySelector('.run-stage')!;
    const before = Number(stage().getAttribute('data-compass-rotation'));
    expect(before).toBeCloseTo(compassRotationDeg(0.7), 2);
    const host = stage() as HTMLElement;
    await act(async () => { host.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
    expect(Number(stage().getAttribute('data-compass-rotation'))).not.toBeCloseTo(before, 2);
    await ui.click(ui.el.querySelector('[aria-label="방향 뒤"]')!);
    expect(stage().getAttribute('data-camera-yaw')).toBe('3.142');
    expect(stage().getAttribute('data-viewpoint')).toBe('back');
    expect(ui.el.querySelector('[data-compass="back"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(Number(stage().getAttribute('data-compass-rotation'))).toBeCloseTo(compassRotationDeg(Math.PI), 2);
  });

  it('AC3 the floor grid toggles from the run options and stays remembered', async () => {
    const ui = await open3d();
    const stage = () => ui.el.querySelector('.run-stage')!;
    const box = () => ui.el.querySelector('[aria-label="바닥 격자"]') as HTMLInputElement;
    expect(stage().getAttribute('data-floor-grid')).toBe('on');
    expect(box().checked).toBe(true);
    await ui.click(box());
    expect(stage().getAttribute('data-floor-grid')).toBe('off');
    expect(loadView(localStorage).floorGrid).toBe(false);
    const again = await mount(true);
    expect(again.el.querySelector('.run-stage')!.getAttribute('data-floor-grid')).toBe('off');
    expect((again.el.querySelector('[aria-label="바닥 격자"]') as HTMLInputElement).checked).toBe(false);
    await again.click(again.el.querySelector('[aria-label="바닥 격자"]')!);
    expect(again.el.querySelector('.run-stage')!.getAttribute('data-floor-grid')).toBe('on');
  });

  it('AC5 selecting a device or a unit marks the outline and the zone', async () => {
    reduceMotion(true);
    const ui = await open3d();
    const stage = () => ui.el.querySelector('.run-stage')!;
    expect(stage().getAttribute('data-device-outline')).toBe('');
    expect(stage().getAttribute('data-zone-emphasis')).toBe('');
    await ui.click(ui.el.querySelector('[data-tree-id="PSH-01"]')!);
    expect(stage().getAttribute('data-device-outline')).toBe('PSH-01');
    expect(stage().getAttribute('data-label-emphasis')).toBe('PSH-01');
    expect(stage().getAttribute('data-outline-mm')).toBe('6');
    await ui.click(ui.el.querySelector('[data-tree-id="U-S1"]')!);
    expect(stage().getAttribute('data-device-outline')).toBe('');
    expect(stage().getAttribute('data-zone-emphasis')).toBe('U-S1');
    expect(stage().getAttribute('data-zone-mm')).toBe('9');
  });

  it('AC6 schematic, photo, light, and dark keep the controls, and the fallback stays', async () => {
    const ui = await open3d();
    const stage = () => ui.el.querySelector('.run-stage')!;
    expect(stage().getAttribute('data-visual-style')).toBe('schematic');
    expect(stage().getAttribute('data-shadow-map')).toBe('off');
    expect(stage().getAttribute('data-fog')).toBe('on');
    expect(ui.el.querySelector('.scene3d-fallback')!.textContent).toContain('이 브라우저에서는 3D 를 그릴 수 없습니다');
    expect(ui.btn('도면으로 보기')).toBeTruthy();
    expect(ui.el.querySelector('[aria-label="방향 표시"]')).not.toBeNull();
    await ui.click(ui.btn('실사풍(AI)'));
    expect(ui.el.querySelector('.run-stage')!.getAttribute('data-visual-style')).toBe('photo');
    expect(ui.el.querySelector('.run-stage')!.getAttribute('data-floor-grid')).toBe('on');
    expect(ui.el.querySelector('.run-stage')!.getAttribute('data-shadow-map')).toBe('off');
    expect(ui.el.querySelector('.scene3d-fallback')).not.toBeNull();
    await ui.click(ui.el.querySelector('[aria-label="다크 테마"]')!);
    expect(ui.el.querySelector('.app')!.getAttribute('data-appearance')).toBe('dark');
    expect(ui.el.querySelector('[aria-label="시점 등각"]')).not.toBeNull();
    await ui.click(ui.btn('도식'));
    expect(ui.el.querySelector('.run-stage')!.getAttribute('data-visual-style')).toBe('schematic');
    await ui.click(ui.el.querySelector('[aria-label="라이트 테마"]')!);
    expect(ui.el.querySelector('.app')!.getAttribute('data-appearance')).toBe('light');
    expect(ui.el.querySelector('.scene3d-fallback')!.textContent).toContain('도면으로 보기');
  });
});
