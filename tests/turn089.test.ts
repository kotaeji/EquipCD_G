import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CAMERA_FOV, projectToScreen, type CameraState } from '../src/scene/camera';
import { describeScene, framePoints, zoneLookAt } from '../src/scene/describe';
import { buildSampleProject } from '../src/model/sample';
import {
  COMPASS_COMPACT_BELOW, COMPASS_COMPACT_PX, STEP6_CHECK_WINDOWS, VIEWPOINT_BUTTONS, VIEWPOINT_KEY_HINT,
  cameraHold, compassScreenRect, compassSize, fitViewpoint, heldCamera, viewpointAngles,
} from '../src/scene/viewQuality';

const scene = describeScene(buildSampleProject(), null);
const look = zoneLookAt(scene);
const points = framePoints(scene);

/** Canvas measured in Chrome. 712×277 is the 1024×700 cell. 576×377 is the 1280×800 cell. */
const PANES = [
  { window: { width: 1024, height: 700 }, view: { width: 712, height: 277 } },
  { window: { width: 1280, height: 800 }, view: { width: 576, height: 377 } },
] as const;

function preset(id: 'iso' | 'top' | 'front' | 'side', view: { width: number; height: number }) {
  const pose = viewpointAngles(id);
  return fitViewpoint({
    targetX: look.x, targetY: look.y, targetZ: look.z,
    yaw: pose.yaw, pitch: pose.pitch, distance: 800,
    aspect: view.width / view.height, fov: CAMERA_FOV,
  }, points, view);
}

function screenBox(cam: CameraState, view: { width: number; height: number }) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    const at = projectToScreen(cam, point, view);
    expect(at.ok).toBe(true);
    minX = Math.min(minX, at.x);
    maxX = Math.max(maxX, at.x);
    minY = Math.min(minY, at.y);
    maxY = Math.max(maxY, at.y);
  }
  return { minX, maxX, minY, maxY };
}

describe('TURN-089 low and narrow screens', () => {
  it('AC1 AC3 named views keep every framed point inside the cell and off the compact rose', () => {
    expect(STEP6_CHECK_WINDOWS.map((size) => `${size.width}x${size.height}`)).toEqual(['1024x700', '1280x800']);
    expect(PANES.map((pane) => pane.window.width)).toEqual(STEP6_CHECK_WINDOWS.map((size) => size.width));
    for (const pane of PANES) {
      const rose = compassScreenRect(pane.view);
      for (const id of ['iso', 'top', 'front', 'side'] as const) {
        const cam = preset(id, pane.view);
        const box = screenBox(cam, pane.view);
        expect(box.minX, `${pane.window.width} ${id} left`).toBeGreaterThanOrEqual(15);
        expect(box.maxX, `${pane.window.width} ${id} right`).toBeLessThanOrEqual(pane.view.width - 15);
        expect(box.minY, `${pane.window.width} ${id} top`).toBeGreaterThanOrEqual(15);
        expect(box.maxY, `${pane.window.width} ${id} bottom`).toBeLessThanOrEqual(pane.view.height - 15);
        if (rose) {
          const hits = box.maxX > rose.x && box.minX < rose.x + rose.w && box.maxY > rose.y && box.minY < rose.y + rose.h;
          expect(hits, `${id} rose`).toBe(false);
        }
      }
    }
    expect(compassSize(COMPASS_COMPACT_BELOW - 1)).toBe('compact');
    expect(compassSize(COMPASS_COMPACT_BELOW)).toBe('full');
    expect(compassSize(0)).toBe('full');
    expect(COMPASS_COMPACT_PX).toBeLessThan(96);
  });

  it('AC2 refits a preset when the cell changes and leaves a hand-moved camera alone', () => {
    const short = { width: 712, height: 240 };
    const tall = { width: 900, height: 420 };
    const fitShort = preset('top', short);
    const fitTall = preset('top', tall);
    expect(Math.abs(fitShort.distance - fitTall.distance)).toBeGreaterThan(20);
    expect(cameraHold(true, true)).toBe('preset');
    expect(cameraHold(false, false)).toBe('free');
    expect(cameraHold(false, true)).toBe('user');
    const kept = heldCamera(fitShort, 'user', tall.width / tall.height, fitTall);
    expect(kept.distance).toBe(fitShort.distance);
    expect(kept.yaw).toBe(fitShort.yaw);
    expect(kept.aspect).toBeCloseTo(tall.width / tall.height);
    expect(heldCamera(fitShort, 'preset', tall.width / tall.height, fitTall)).toBe(fitTall);
  });

  it('AC6 the viewpoint hint is the phrase on the buttons and in the shortcut list', () => {
    expect(VIEWPOINT_KEY_HINT).toBe('장면을 누른 뒤 1~4 키');
    expect(VIEWPOINT_BUTTONS.map((item) => item.key)).toEqual(['1', '2', '3', '4']);
    const view = readFileSync('src/ui/Scene3D.tsx', 'utf8');
    expect(view).toContain('title={VIEWPOINT_KEY_HINT}');
    expect(view).toContain('cameraHold(');
    expect(view).toContain('heldCamera(');
    const commands = readFileSync('src/ui/commandModel.ts', 'utf8');
    expect(commands).toContain(VIEWPOINT_KEY_HINT);
    const css = readFileSync('src/ui/scene3d-quality.css', 'utf8');
    expect(css).toContain('[data-compass-size="compact"]');
    expect(css).toContain('calc(var(--sp-6) * 2)');
    const row = readFileSync('src/ui/overflow-row.css', 'utf8');
    expect(row).toContain('.overflow-row.tool-pills { flex-wrap: nowrap; }');
    expect(row).toContain('.run-clock');
    expect(row).toContain('gap: var(--sp-2)');
  });
});
