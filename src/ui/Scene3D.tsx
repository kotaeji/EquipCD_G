import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  AmbientLight, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color, ConeGeometry,
  CylinderGeometry, DirectionalLight, EdgesGeometry, Group, LineBasicMaterial, LineSegments,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, Raycaster, Scene, Sprite,
  SpriteMaterial, SRGBColorSpace, TorusGeometry, Vector2, WebGLRenderer, type Material, type Object3D,
} from 'three';
import { applyCameraKey, fitCamera, gestureMode, orbitCamera, panCamera, zoomCamera, type CameraState } from '../scene/camera';
import type { SceneDescription } from '../scene/describe';
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
    solid: pick('--muted', fallback.muted),
    active: pick('--accent', fallback.accent),
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

function makeLabel(text: string, color: string): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = '600 36px sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 48);
  }
  const tex = new CanvasTexture(canvas);
  const sprite = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.scale.set(90, 18, 1);
  sprite.userData.label = true;
  return sprite;
}

function lineLoop(x: number, z: number, w: number, d: number, color: string): LineSegments {
  const y = 0.6;
  const positions = new Float32Array([
    x, y, z, x + w, y, z,
    x + w, y, z, x + w, y, z + d,
    x + w, y, z + d, x, y, z + d,
    x, y, z + d, x, y, z,
  ]);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(positions, 3));
  return new LineSegments(geo, new LineBasicMaterial({ color }));
}

function buildScene(root: Group, scene: SceneDescription, palette: ScenePalette, showNames: boolean, emphasize: boolean, selectedId: string | null) {
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
      new BoxGeometry(zone.w, 0.4, zone.d),
      new MeshStandardMaterial({ color: palette.zone, transparent: true, opacity: 0.55, roughness: 1 }),
    );
    fill.position.set(zone.x + zone.w / 2, 0.2, zone.z + zone.d / 2);
    root.add(fill);
    root.add(lineLoop(zone.x, zone.z, zone.w, zone.d, palette.zoneLine));
    if (showNames) {
      const label = makeLabel(zone.name, palette.label);
      label.position.set(zone.x + zone.w / 2, 6, zone.z + 10);
      root.add(label);
    }
  }

  for (const solid of scene.solids) {
    const group = new Group();
    group.position.set(solid.x, 0, solid.z);
    group.userData.deviceId = solid.id;
    const emphasized = emphasize && solid.highlight !== 'none';
    const color = solid.highlight === 'fault' && emphasize ? palette.fault
      : solid.highlight === 'active' && emphasize ? palette.active
        : palette.solid;
    let top = 8;
    for (const part of solid.parts) {
      const mesh = partMesh(part, color);
      group.add(mesh);
      top = Math.max(top, part.y + part.h / 2);
      if (emphasized || solid.id === selectedId) {
        const edges = new LineSegments(new EdgesGeometry(mesh.geometry), new LineBasicMaterial({ color: palette.edge }));
        edges.position.copy(mesh.position);
        edges.rotation.copy(mesh.rotation);
        group.add(edges);
      }
    }
    if (emphasized && solid.highlight === 'active') {
      const ring = new Mesh(new TorusGeometry(Math.max(solid.w, solid.d) * 0.42, 1.4, 8, 24), new MeshBasicMaterial({ color: palette.edge }));
      ring.rotation.x = Math.PI / 2;
      ring.position.set(solid.w / 2, 1.2, solid.d / 2);
      group.add(ring);
    }
    if (emphasized && solid.highlight === 'fault') {
      const beacon = new Mesh(new BoxGeometry(6, 18, 6), new MeshStandardMaterial({ color: palette.beacon }));
      beacon.position.set(solid.w / 2, top + 12, solid.d / 2);
      group.add(beacon);
    }
    if (showNames) {
      const label = makeLabel(solid.name, palette.label);
      label.position.set(solid.w / 2, top + (emphasized && solid.highlight === 'fault' ? 28 : 14), solid.d / 2);
      group.add(label);
    }
    root.add(group);
  }

  for (const flow of scene.flows) {
    const [a, c] = flow.points;
    if (!a || !c) continue;
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array([a.x, 1.2, a.z, c.x, 1.2, c.z]), 3));
    root.add(new LineSegments(geo, new LineBasicMaterial({ color: palette.flow })));
    const head = new Mesh(new ConeGeometry(5, 14, 8), new MeshStandardMaterial({ color: palette.flow }));
    head.position.set(c.x, 1.2, c.z);
    head.lookAt(c.x * 2 - a.x, 1.2, c.z * 2 - a.z);
    head.rotateX(Math.PI / 2);
    root.add(head);
  }

  for (const mat of scene.materials) {
    const box = new Mesh(new BoxGeometry(16, 12, 16), new MeshStandardMaterial({ color: palette.material }));
    box.position.set(mat.x, 8, mat.z);
    root.add(box);
  }
}

function SceneCanvas({ scene, palette, cam, showNames, emphasize, selectedId, onCamera, onSelect }: {
  scene: SceneDescription;
  palette: ScenePalette;
  cam: CameraState;
  showNames: boolean;
  emphasize: boolean;
  selectedId: string | null;
  onCamera: (fn: (cam: CameraState) => CameraState) => void;
  onSelect: (id: string | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const api = useRef<{
    renderer: WebGLRenderer;
    camera: PerspectiveCamera;
    scene: Scene;
    root: Group;
    render: () => void;
  } | null>(null);
  const drag = useRef<{ x: number; y: number; button: number; shift: boolean; moved: boolean } | null>(null);
  const props = useRef({ scene, palette, showNames, emphasize, selectedId, onSelect });
  props.current = { scene, palette, showNames, emphasize, selectedId, onSelect };

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
    buildScene(view.root, scene, palette, showNames, emphasize, selectedId);
    applyCamera(view.camera, cam);
    view.render();
  }, [scene, palette, showNames, emphasize, selectedId, cam]);

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
      onContextMenu={(e) => e.preventDefault()} />
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
  const [cam, setCam] = useState<CameraState>(() => fitCamera(scene.bounds));
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
    setCam((c) => fitCamera(scene.bounds, c.aspect));
  }, [boundsKey, scene.bounds]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const next = applyCameraKey(cam, e.key, scene.bounds);
    if (!next) return;
    e.preventDefault();
    setCam(next);
  };

  return (
    <div className="run-stage" tabIndex={0} aria-label="3D 시뮬레이션" onKeyDown={onKey}
      data-camera-yaw={cam.yaw.toFixed(3)} data-camera-pitch={cam.pitch.toFixed(3)} data-camera-distance={cam.distance.toFixed(1)}>
      <div className="scene3d-bar">
        <button type="button" aria-label="전체 보기" onClick={() => setCam((c) => fitCamera(scene.bounds, c.aspect))}>전체 보기</button>
        <p className="scene3d-help">끌어서 회전 · 오른쪽 끌기 또는 Shift+끌기 이동 · 휠 확대 · 화살표 회전 · +/− 확대 · Home 전체 보기</p>
      </div>
      {gl
        ? <SceneCanvas scene={scene} palette={palette} cam={cam} showNames={showNames} emphasize={emphasize} selectedId={selectedId}
          onCamera={setCam} onSelect={onSelect} />
        : <div className="scene3d-fallback" role="status">
          <p>이 브라우저에서는 3D 를 그릴 수 없습니다</p>
          <button type="button" onClick={onDiagram}>도면으로 보기</button>
        </div>}
    </div>
  );
}
