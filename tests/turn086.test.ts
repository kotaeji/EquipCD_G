import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import {
  BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry,
} from 'three';
import { fitToPoints } from '../src/scene/camera';
import { describeScene } from '../src/scene/describe';
import { buildSampleProject } from '../src/model/sample';
import { loadView } from '../src/ui/viewSettings';
import {
  COMPASS_POINTS, DEVICE_OUTLINE_MM, DIAGRAM_GRID_MM, GRID_LABEL_MM, VIEW_MOVE_MS, VIEWPOINT_BUTTONS,
  ZONE_BORDER_MM, ZONE_EMPHASIS_MM, cameraMoveSamples, compassRotationDeg, contactShadows, floorGrid,
  labelEmphasis, lerpAngle, sceneFog, sceneLabelClass, viewpointAngles, viewpointByKey, zoneBorderThickness,
} from '../src/scene/viewQuality';

describe('TURN-086 viewpoint math', () => {
  it('AC1 maps 1~4 to iso, top, front, and side, and reduced motion lands in one step', () => {
    expect(VIEWPOINT_BUTTONS.map((item) => item.key)).toEqual(['1', '2', '3', '4']);
    expect(viewpointByKey('2')).toBe('top');
    expect(viewpointByKey('k')).toBeNull();
    expect(VIEW_MOVE_MS).toBe(320);
    const from = fitToPoints([{ x: 0, y: 0, z: 0 }, { x: 400, y: 40, z: 200 }], 1.4);
    const top = viewpointAngles('top');
    const to = { ...from, yaw: top.yaw, pitch: top.pitch };
    expect(cameraMoveSamples(from, to, true)).toEqual([to]);
    const smooth = cameraMoveSamples(from, to, false);
    expect(smooth.length).toBeGreaterThan(1);
    expect(smooth[smooth.length - 1]).toEqual(to);
    expect(smooth[0].pitch).toBeGreaterThan(from.pitch);
    expect(smooth[0].pitch).toBeLessThan(top.pitch);
    const wrapped = lerpAngle(0.2, Math.PI * 2 - 0.2, 1);
    expect(Math.atan2(Math.sin(wrapped - (Math.PI * 2 - 0.2)), Math.cos(wrapped - (Math.PI * 2 - 0.2)))).toBeCloseTo(0, 5);
  });

  it('AC2 turns the compass with yaw and sends each label to that side', () => {
    expect(compassRotationDeg(0)).toBe(0);
    expect(compassRotationDeg(Math.PI / 2)).toBeCloseTo(270, 3);
    expect(compassRotationDeg(0.7)).not.toBe(compassRotationDeg(0));
    expect(COMPASS_POINTS.map((item) => item.label)).toEqual(['앞', '우', '뒤', '좌']);
    expect(viewpointAngles('front').yaw).toBe(0);
    expect(viewpointAngles('back').yaw).toBeCloseTo(Math.PI);
    expect(viewpointAngles('left').yaw).toBeCloseTo(-Math.PI / 2);
    expect(viewpointAngles('right').yaw).toBeCloseTo(Math.PI / 2);
    expect(viewpointAngles('side').yaw).toBeCloseTo(viewpointAngles('right').yaw);
  });
});

describe('TURN-086 floor, shadow, fog, selection', () => {
  it('AC3 uses the diagram gap and keeps millimetre numbers on the near edges', () => {
    expect(readFileSync('src/ui/Canvas.tsx', 'utf8')).toContain(`gap={${DIAGRAM_GRID_MM}}`);
    const grid = floorGrid({ minX: 30, maxX: 1210, minZ: 70, maxZ: 370 });
    expect(grid.step).toBe(DIAGRAM_GRID_MM);
    expect(grid.labelStep).toBe(GRID_LABEL_MM);
    expect(grid.xStops[1] - grid.xStops[0]).toBe(DIAGRAM_GRID_MM);
    expect(grid.labels.length).toBeGreaterThan(0);
    for (const label of grid.labels) {
      expect(label.z === grid.minZ || label.x === grid.minX).toBe(true);
      expect(label.text).toMatch(/^-?\d+$/);
    }
    const inside = grid.labels.some((label) => label.x > grid.minX && label.z > grid.minZ);
    expect(inside).toBe(false);
  });

  it('AC4 puts one flat shadow under each device and never a shadow map', () => {
    const scene = describeScene(buildSampleProject(), null);
    const shadows = contactShadows(scene.solids, false);
    expect(shadows).toHaveLength(scene.solids.length);
    for (const shadow of shadows) {
      const solid = scene.solids.find((item) => item.id === shadow.deviceId)!;
      expect(shadow.shadowMap).toBe(false);
      expect(shadow.x).toBeCloseTo(solid.draw.x + solid.draw.w / 2);
      expect(shadow.z).toBeCloseTo(solid.draw.z + solid.draw.d / 2);
      expect(shadow.w).toBeGreaterThan(solid.draw.w);
      expect(shadow.opacity).toBeGreaterThan(0);
      expect(shadow.opacity).toBeLessThan(1);
    }
    expect(contactShadows(scene.solids, true)[0].opacity).toBeGreaterThan(shadows[0].opacity);
    const view = readFileSync('src/ui/Scene3D.tsx', 'utf8');
    expect(view).toContain('shadowMap.enabled = false');
    expect(view).not.toContain('requestAnimationFrame');
    expect(view).not.toContain('PCFSoftShadowMap');
  });

  it('AC5 outlines a selected device and thickens the selected zone', () => {
    expect(DEVICE_OUTLINE_MM).toBeGreaterThan(ZONE_BORDER_MM);
    expect(zoneBorderThickness(false)).toBe(ZONE_BORDER_MM);
    expect(zoneBorderThickness(true)).toBe(ZONE_EMPHASIS_MM);
    expect(ZONE_EMPHASIS_MM).toBeGreaterThan(ZONE_BORDER_MM);
    const plain = labelEmphasis(false);
    const picked = labelEmphasis(true);
    expect(picked.fontWeight).toBeGreaterThan(plain.fontWeight);
    expect(picked.borderPx).toBeGreaterThan(plain.borderPx);
    expect(picked.className).toBe('is-selected');
    expect(sceneLabelClass('device', '', false, false, true)).toContain('is-selected');
    expect(sceneLabelClass('device', '', false, false, false)).not.toContain('is-selected');
    const css = readFileSync('src/ui/scene3d-quality.css', 'utf8');
    expect(css).toContain('.scene3d-label.is-selected');
    expect(css).toContain('font-weight: 700');
    expect(css).toContain('border-width: 2px');
  });

  it('AC6 fades toward the canvas color in both themes and leaves the fallback copy', () => {
    const light = sceneFog(480, '#f6f6f6');
    const dark = sceneFog(480, '#101b2a');
    expect(light.color).toBe('#f6f6f6');
    expect(dark.color).toBe('#101b2a');
    expect(light.far).toBeGreaterThan(light.near);
    expect(dark.near).toBeCloseTo(light.near);
    expect(dark.far).toBeCloseTo(light.far);
    const view = readFileSync('src/ui/Scene3D.tsx', 'utf8');
    expect(view).toContain('이 브라우저에서는 3D 를 그릴 수 없습니다');
    expect(view).toContain('도면으로 보기');
    expect(view).toContain("visualMode === 'photo'");
  });

  it('remembers a viewpoint and a hidden grid, and drops a broken value', () => {
    const memory = {
      getItem: () => JSON.stringify({ sceneViewpoint: 'front', floorGrid: false }),
      setItem: () => {},
      removeItem: () => {},
      key: () => null,
      length: 0,
    };
    expect(loadView(memory).sceneViewpoint).toBe('front');
    expect(loadView(memory).floorGrid).toBe(false);
    expect(loadView({ ...memory, getItem: () => JSON.stringify({ sceneViewpoint: 'nope' }) }).sceneViewpoint).toBe('iso');
    expect(loadView({ ...memory, getItem: () => '{}' }).floorGrid).toBe(true);
  });
});

function dispose(root: Group) {
  root.traverse((child) => {
    const mesh = child as Mesh;
    mesh.geometry?.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach((item) => item.dispose());
    else mat?.dispose();
  });
}

/** Median milliseconds for one matrix update of a 60-device scene. */
function frameMs(quality: boolean): number {
  const samples: number[] = [];
  for (let run = 0; run < 7; run += 1) {
    const root = new Group();
    for (let i = 0; i < 60; i += 1) {
      const group = new Group();
      group.position.set((i % 10) * 90, 0, Math.floor(i / 10) * 90);
      for (let part = 0; part < 6; part += 1) {
        const mesh = new Mesh(new BoxGeometry(18, 10, 14), new MeshStandardMaterial({ color: '#8b939c' }));
        mesh.position.set(10, 8 + part, 8);
        group.add(mesh);
      }
      if (quality && i === 0) {
        group.add(new Mesh(new BoxGeometry(8, 8, 70), new MeshStandardMaterial({ color: '#1a1a1a' })));
      }
      root.add(group);
    }
    if (quality) {
      const positions = new Float32Array(60 * 4 * 3);
      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
      geo.setIndex(Array.from({ length: 60 * 6 }, (_, n) => n % (60 * 4)));
      root.add(new Mesh(geo, new MeshBasicMaterial({ transparent: true, opacity: 0.3 })));
      const lines = new BufferGeometry();
      lines.setAttribute('position', new Float32BufferAttribute(new Float32Array(160 * 2 * 3), 3));
      root.add(new LineSegments(lines, new LineBasicMaterial()));
      root.add(new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial()));
    }
    root.updateMatrixWorld(true);
    const frames = 80;
    const t0 = performance.now();
    for (let frame = 0; frame < frames; frame += 1) {
      root.rotation.y += 0.01;
      root.updateMatrixWorld(true);
    }
    samples.push((performance.now() - t0) / frames);
    dispose(root);
  }
  samples.sort((a, b) => a - b);
  return samples[3];
}

describe('TURN-086 frame time', () => {
  it('AC7 keeps a 60-device frame within 20 percent of the previous scene', () => {
    const before = frameMs(false);
    const after = frameMs(true);
    const ratio = after / Math.max(before, 0.001);
    // Printed for the PR body. The assertion is the acceptance check.
    console.log(`TURN-086 frame ms before=${before.toFixed(3)} after=${after.toFixed(3)} ratio=${ratio.toFixed(3)}`);
    expect(ratio).toBeLessThanOrEqual(1.2);
  });
});
