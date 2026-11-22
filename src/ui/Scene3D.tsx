import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  AmbientLight, BoxGeometry, Color, ConeGeometry, CylinderGeometry, DirectionalLight,
  Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Raycaster, Scene, SRGBColorSpace,
  Vector2, Vector3, WebGLRenderer, type Material, type Object3D,
} from 'three';
import { applyCameraKey, fitToPoints, gestureMode, orbitCamera, panCamera, zoomCamera, type CameraState, type Viewport } from '../scene/camera';
import { framePoints, type SceneDescription } from '../scene/describe';
import { cullOverlappingLabels, type ScreenLabel } from '../scene/labels';
import type { LocalPart } from '../scene/shapes';
import { canUseWebGL } from './webgl';
import { THEMES } from './viewSettings';

export interface ScenePalette {
  background: string;
  floor: string;
  zone: string;
  zoneLine: string;
  solid: string;
  active: string;
  fault: string;
  beacon: string;
  material: string;
  flow: string;
  label: string;
  edge: string;
}

function readPalette(): ScenePalette {
  const el = document.querySelector('.app') ?? document.documentElement;
  const cs = getComputedStyle(el);
  const fallback = THEMES.A.vars;
  const pick = (name: string, backup: string) => cs.getPropertyValue(name).trim() || backup;
  return {
    background: pick('--canvas', fallback.canvas),
    floor: pick('--bg', fallback.bg),
    zone: pick('--selected', fallback.selected),
    zoneLine: pick('--border', fallback.border),
    solid: pick('--success', fallback.success),
    active: pick('--warning', fallback.warning),
    fault: pick('--danger', fallback.danger),
    beacon: pick('--warning', fallback.warning),
    material: pick('--warning', fallback.warning),
    flow: pick('--accent', fallback.accent),
    label: pick('--text', fallback.text),
    edge: pick('--text', fallback.text),
  };
}

function disposeTree(root: Object3D) {
  root.traverse((child) => {
    const mesh = child as Mesh;
    mesh.geometry?.dispose();
    const mat = mesh.material as Material | Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => disposeMaterial(m));
    else if (mat) disposeMaterial(mat);
  });
}

function disposeMaterial(mat: Material) {
  const map = (mat as MeshStandardMaterial).map;
  map?.dispose();
  mat.dispose();
}

function applyCamera(camera: PerspectiveCamera, cam: CameraState) {
  const cp = Math.cos(cam.pitch);
  camera.position.set(
    cam.targetX + cam.distance * cp * Math.sin(cam.yaw),
    cam.targetY + cam.distance * Math.sin(cam.pitch),
    cam.targetZ + cam.distance * cp * Math.cos(cam.yaw),
  );
  camera.lookAt(cam.targetX, cam.targetY, cam.targetZ);
  camera.fov = cam.fov;
  camera.updateProjectionMatrix();
}

function partMesh(part: LocalPart, color: string): Mesh {
  const geo = part.primitive === 'cylinder'
    ? new CylinderGeometry(Math.max(part.w, part.d) / 2, Math.max(part.w, part.d) / 2, part.h, 16)
    : new BoxGeometry(part.w, part.h, part.d);
  const mesh = new Mesh(geo, new MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.04 }));
  mesh.position.set(part.x, part.y, part.z);
  if (part.primitive === 'cylinder' && part.axis === 'x') mesh.rotation.z = Math.PI / 2;
  if (part.primitive === 'cylinder' && part.axis === 'z') mesh.rotation.x = Math.PI / 2;
  return mesh;
}

function zoneBorder(x: number, z: number, w: number, d: number, color: string): Group {
  const g = new Group();
  const t = 4;
  const h = 3;
  const y = h / 2;
  const mat = () => new MeshStandardMaterial({ color, roughness: 0.8 });
  const add = (px: number, pz: number, bw: number, bd: number) => {
    const mesh = new Mesh(new BoxGeometry(bw, h, bd), mat());
    mesh.position.set(px, y, pz);
    g.add(mesh);
  };
  add(x + w / 2, z + t / 2, w, t);
  add(x + w / 2, z + d - t / 2, w, t);
  add(x + t / 2, z + d / 2, t, d);
  add(x + w - t / 2, z + d / 2, t, d);
  return g;
}

function arrowBetween(ax: number, az: number, bx: number, bz: number, color: string): Group {
  const g = new Group();
  const dir = new Vector3(bx - ax, 0, bz - az);
  const len = dir.length();
  if (len < 8) return g;
  dir.normalize();
  const head = 22;
  const shaft = Math.max(8, len - head);
  const mid = new Vector3(ax, 3, az).addScaledVector(dir, shaft / 2);
  const beam = new Mesh(new BoxGeometry(6, 3, shaft), new MeshStandardMaterial({ color, roughness: 0.5 }));
  beam.position.copy(mid);
  beam.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), dir);
  g.add(beam);
  const cone = new Mesh(new ConeGeometry(10, head, 14), new MeshStandardMaterial({ color, roughness: 0.4 }));
  cone.position.set(bx - dir.x * head / 2, 3, bz - dir.z * head / 2);
  cone.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir);
  g.add(cone);
  return g;
}

function buildScene(root: Group, scene: SceneDescription, palette: ScenePalette, emphasize: boolean) {
  disposeTree(root);
  root.clear();
  const pad = 80;
  const b = scene.bounds;
  const floor = new Mesh(
    new BoxGeometry(Math.max(40, b.maxX - b.minX + pad * 2), 1, Math.max(40, b.maxZ - b.minZ + pad * 2)),
    new MeshStandardMaterial({ color: palette.floor, roughness: 1 }),
  );
  floor.position.set((b.minX + b.maxX) / 2, -0.5, (b.minZ + b.maxZ) / 2);
  root.add(floor);

  for (const zone of scene.zones) {
    const fill = new Mesh(
      new BoxGeometry(Math.max(1, zone.w - 8), 1, Math.max(1, zone.d - 8)),
      new MeshStandardMaterial({ color: palette.zone, roughness: 1 }),
    );
    fill.position.set(zone.x + zone.w / 2, 0.4, zone.z + zone.d / 2);
    root.add(fill);
    root.add(zoneBorder(zone.x, zone.z, zone.w, zone.d, palette.edge));
  }

  for (const solid of scene.solids) {
    const group = new Group();
    group.position.set(solid.draw.x, 0, solid.draw.z);
    group.userData.deviceId = solid.id;
    const color = solid.highlight === 'fault' && emphasize ? palette.fault
      : solid.highlight === 'active' && emphasize ? palette.active
        : palette.solid;
    for (const part of solid.parts) group.add(partMesh(part, color));
    root.add(group);
  }

  for (const flow of scene.flows) {
    const [a, c] = flow.points;
    if (!a || !c) continue;
    root.add(arrowBetween(a.x, a.z, c.x, c.z, palette.flow));
  }

  for (const mat of scene.materials) {
    const box = new Mesh(new BoxGeometry(42, 30, 42), new MeshStandardMaterial({ color: palette.material, roughness: 0.45 }));
    box.position.set(mat.x, 18, mat.z);
    root.add(box);
  }
}

function topOf(parts: LocalPart[]): number {
  return parts.reduce((h, part) => Math.max(h, part.y + part.h / 2), 12);
}

function syncLabels(layer: HTMLElement, camera: PerspectiveCamera, scene: SceneDescription, showNames: boolean, emphasize: boolean) {
  const w = layer.clientWidth || 1;
  const h = layer.clientHeight || 1;
  const project = (x: number, y: number, z: number) => {
    const v = new Vector3(x, y, z).project(camera);
    if (v.z < -1 || v.z > 1) return null;
    return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h };
  };
  const rough = (text: string, px: number) => ({ w: Math.max(28, text.length * px * 0.62 + 10), h: px + 8 });
  const boxes: ScreenLabel[] = [];
  if (showNames) {
    for (const zone of scene.zones) {
      const cam = camera.position;
      let far = { x: zone.x, z: zone.z, d: -1 };
      for (const x of [zone.x, zone.x + zone.w]) {
        for (const z of [zone.z, zone.z + zone.d]) {
          const d = (x - cam.x) ** 2 + (z - cam.z) ** 2;
          if (d > far.d) far = { x, z, d };
        }
      }
      const at = project(far.x, 14, far.z);
      if (!at) continue;
      const size = rough(zone.name, 14);
      boxes.push({ id: `u:${zone.id}`, kind: 'unit', x: at.x - size.w / 2, y: at.y - size.h, w: size.w, h: size.h, text: zone.name });
    }
    for (const solid of scene.solids) {
      const top = topOf(solid.parts);
      const at = project(solid.draw.x + solid.draw.w / 2, top + 6, solid.draw.z + solid.draw.d / 2);
      if (!at) continue;
      const size = rough(solid.name, 12);
      boxes.push({ id: `d:${solid.id}`, kind: 'device', x: at.x - size.w / 2, y: at.y - size.h - 18, w: size.w, h: size.h, text: solid.name });
    }
  }
  if (emphasize) {
    for (const solid of scene.solids) {
      if (solid.highlight === 'none') continue;
      const text = solid.highlight === 'fault' ? '오류' : '▼ 동작 중';
      const top = topOf(solid.parts);
      const at = project(solid.draw.x + solid.draw.w / 2, top + 18, solid.draw.z + solid.draw.d / 2);
      if (!at) continue;
      const size = rough(text, 13);
      boxes.push({ id: `m:${solid.id}`, kind: 'marker', x: at.x - size.w / 2, y: at.y - size.h - 36, w: size.w, h: size.h, text });
    }
  }
  for (const mat of scene.materials) {
    const text = `${mat.name} · ${mat.state || '상태 없음'}`;
    const at = project(mat.x, 20, mat.z);
    if (!at) continue;
    const size = rough(text, 12);
    boxes.push({ id: `mat:${mat.id}`, kind: 'material', x: at.x - size.w / 2, y: at.y + 6, w: size.w, h: size.h, text });
  }
  const kept = cullOverlappingLabels(boxes);
  layer.replaceChildren(...kept.map((label) => {
    const el = document.createElement('div');
    const marker = label.kind === 'marker' ? (label.text === '오류' ? ' fault' : ' active') : '';
    el.className = `scene3d-label ${label.kind}${marker}`;
    el.textContent = label.text;
    el.style.left = `${label.x + label.w / 2}px`;
    el.style.top = `${label.y + label.h}px`;
    return el;
  }));
}

function SceneCanvas({ scene, palette, cam, showNames, emphasize, onCamera, onSelect, onView }: {
  scene: SceneDescription;
  palette: ScenePalette;
  cam: CameraState;
  showNames: boolean;
  emphasize: boolean;
  onCamera: (fn: (cam: CameraState) => CameraState) => void;
  onSelect: (id: string | null) => void;
  onView: (width: number, height: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const viewSink = useRef(onView);
  viewSink.current = onView;
  const viewProps = useRef({ scene, showNames, emphasize });
  viewProps.current = { scene, showNames, emphasize };
  const paintLabels = () => {
    const view = api.current;
    if (!view || !labelRef.current) return;
    const current = viewProps.current;
    syncLabels(labelRef.current, view.camera, current.scene, current.showNames, current.emphasize);
  };
  const paintSink = useRef(paintLabels);
  paintSink.current = paintLabels;
  const api = useRef<{
    renderer: WebGLRenderer;
    camera: PerspectiveCamera;
    scene: Scene;
    root: Group;
    render: () => void;
  } | null>(null);
  const drag = useRef<{ x: number; y: number; button: number; shift: boolean; moved: boolean } | null>(null);
  const props = useRef({ scene, palette, showNames, emphasize, onSelect });
  props.current = { scene, palette, showNames, emphasize, onSelect };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      return;
    }
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.setAttribute('aria-label', '3D 장면');
    host.appendChild(renderer.domElement);
    const threeScene = new Scene();
    const camera = new PerspectiveCamera(45, 1, 0.5, 20000);
    const ambient = new AmbientLight(0xffffff, 0.78);
    const sun = new DirectionalLight(0xffffff, 0.95);
    sun.position.set(240, 520, 180);
    const root = new Group();
    threeScene.add(ambient, sun, root);
    const render = () => renderer.render(threeScene, camera);
    const resize = () => {
      const w = Math.max(1, host.clientWidth);
      const h = Math.max(1, host.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render();
      paintSink.current();
      viewSink.current(w, h);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      onCamera((c) => zoomCamera(c, e.deltaY));
    };
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
    api.current = { renderer, camera, scene: threeScene, root, render };
    resize();
    return () => {
      ro.disconnect();
      renderer.domElement.removeEventListener('wheel', onWheel);
      disposeTree(root);
      renderer.dispose();
      renderer.domElement.remove();
      api.current = null;
    };
  }, [onCamera]);

  useEffect(() => {
    const view = api.current;
    if (!view) return;
    view.scene.background = new Color(palette.background);
    buildScene(view.root, scene, palette, emphasize);
    applyCamera(view.camera, cam);
    view.camera.aspect = Math.max(0.2, view.renderer.domElement.clientWidth / Math.max(1, view.renderer.domElement.clientHeight));
    view.camera.updateProjectionMatrix();
    view.render();
    if (labelRef.current) syncLabels(labelRef.current, view.camera, scene, showNames, emphasize);
  }, [scene, palette, showNames, emphasize, cam]);

  const pick = (ev: PointerEvent): string | null => {
    const view = api.current;
    if (!view) return null;
    const rect = view.renderer.domElement.getBoundingClientRect();
    const pointer = new Vector2(
      ((ev.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((ev.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    const ray = new Raycaster();
    ray.setFromCamera(pointer, view.camera);
    const hits = ray.intersectObjects(view.root.children, true);
    for (const hit of hits) {
      let node: Object3D | null = hit.object;
      while (node) {
        const id = node.userData.deviceId as string | undefined;
        if (id) return id;
        node = node.parent;
      }
    }
    return null;
  };

  return (
    <div className="scene3d-host" ref={hostRef}
      onPointerDown={(e) => {
        if (e.button !== 0 && e.button !== 2) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (Math.hypot(dx, dy) > 3) d.moved = true;
        const mode = gestureMode(d.button, d.shift || e.shiftKey);
        onCamera((c) => (mode === 'pan' ? panCamera(c, dx, dy) : orbitCamera(c, dx, dy)));
        d.x = e.clientX;
        d.y = e.clientY;
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (d && !d.moved && d.button === 0) props.current.onSelect(pick(e.nativeEvent));
      }}
      onContextMenu={(e) => e.preventDefault()}>
      <div className="scene3d-labels" ref={labelRef} />
    </div>
  );
}

/** Center column. Without WebGL it explains that and offers the diagram. */
export function Scene3D({ scene, showNames, emphasize, selectedId, onSelect, onDiagram }: {
  scene: SceneDescription;
  showNames: boolean;
  emphasize: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onDiagram: () => void;
}) {
  const [gl] = useState(canUseWebGL);
  const [palette, setPalette] = useState(readPalette);
  const boundsKey = useMemo(() => scene.zones.map((z) => z.id).join('|') + '/' + scene.solids.map((s) => `${s.id}:${s.x}:${s.z}`).join('|'), [scene]);
  const framed = (aspect: number, view?: Viewport) => fitToPoints(framePoints(scene), aspect, view);
  const [cam, setCam] = useState<CameraState>(() => framed(1.4));
  const viewSize = useRef({ width: 640, height: 400 });
  const moved = useRef(false);
  const seen = useRef(boundsKey);
  useEffect(() => {
    const app = document.querySelector('.app');
    if (!app) return;
    const sync = () => setPalette(readPalette());
    const mo = new MutationObserver(sync);
    mo.observe(app, { attributes: true, attributeFilter: ['data-appearance', 'style'] });
    sync();
    return () => mo.disconnect();
  }, []);
  useEffect(() => {
    if (seen.current === boundsKey) return;
    seen.current = boundsKey;
    setCam((c) => framed(c.aspect, viewSize.current));
  }, [boundsKey, scene.bounds]);

  const onView = (width: number, height: number) => {
    viewSize.current = { width, height };
    const aspect = width / Math.max(1, height);
    setCam((c) => {
      if (moved.current) return Math.abs(c.aspect - aspect) < 0.01 ? c : { ...c, aspect };
      const next = framed(aspect, { width, height });
      if (Math.abs(next.distance - c.distance) < 0.5 && Math.abs(next.targetX - c.targetX) < 0.5 && Math.abs(next.aspect - c.aspect) < 0.01) return c;
      return next;
    });
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.key === 'Home') {
      e.preventDefault();
      moved.current = false;
      setCam(framed(cam.aspect, viewSize.current));
      return;
    }
    const next = applyCameraKey(cam, e.key, scene.bounds, viewSize.current);
    if (!next) return;
    e.preventDefault();
    moved.current = true;
    setCam(next);
  };

  return (
    <div className="run-stage" tabIndex={0} aria-label="3D 시뮬레이션" onKeyDown={onKey} data-selected-device={selectedId ?? ''}
      data-camera-yaw={cam.yaw.toFixed(3)} data-camera-pitch={cam.pitch.toFixed(3)} data-camera-distance={cam.distance.toFixed(1)}>
      <div className="scene3d-bar">
        <button type="button" aria-label="전체 보기" onClick={() => { moved.current = false; setCam(framed(viewSize.current.width / Math.max(1, viewSize.current.height), viewSize.current)); }}>전체 보기</button>
        <p className="scene3d-help">끌어서 회전 · 오른쪽 끌기 또는 Shift+끌기 이동 · 휠 확대 · 화살표 회전 · +/− 확대 · Home 전체 보기</p>
      </div>
      {gl
        ? <SceneCanvas scene={scene} palette={palette} cam={cam} showNames={showNames} emphasize={emphasize}
          onCamera={(fn) => { moved.current = true; setCam(fn); }} onSelect={onSelect} onView={onView} />
        : <div className="scene3d-fallback" role="status">
          <p>이 브라우저에서는 3D 를 그릴 수 없습니다</p>
          <button type="button" onClick={onDiagram}>도면으로 보기</button>
        </div>}
    </div>
  );
}
