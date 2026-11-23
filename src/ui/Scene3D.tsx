import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  ACESFilmicToneMapping, AmbientLight, BoxGeometry, CanvasTexture, Color, ConeGeometry, CylinderGeometry, DirectionalLight,
  Group, Mesh, MeshStandardMaterial, PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, Raycaster,
  NoToneMapping, RepeatWrapping, Scene, SRGBColorSpace, Vector2, Vector3, WebGLRenderer, type Material, type Object3D,
} from 'three';
import { applyCameraKey, fitToPoints, gestureMode, orbitCamera, panCamera, zoomCamera, type CameraState, type Viewport } from '../scene/camera';
import { framePoints, type PartDelta, type SceneDescription } from '../scene/describe';
import { shouldRedraw } from '../scene/motion';
import { emWidth, floorNameAxes, floorNameYaw, type FloorName } from '../scene/floorLabel';
import { anchorLabels, placeLabels, sceneLabelInRange, visibleFloorNames, type ScreenLabel } from '../scene/labels';
import type { LocalPart } from '../scene/shapes';
import { floorNameColors, materialFor, photoPartsFor, photoZoneColors, renderStyle, type StyledPart, type VisualStyleId } from '../scene/style';
import { BootGate } from './EmptyState';
import { LOADING_3D } from './problemCopy';
import { canUseWebGL } from './webgl';
import { markerText, STATUS_COLOR, waitingLead } from './status';
import { THEMES } from './viewSettings';

export const PHOTO_NOTE = '3D 실사풍은 재질 · 조명 표현입니다. 실제 설비 형상이 아닙니다.';

export interface ScenePalette {
  background: string;
  floor: string;
  zone: string;
  zoneLine: string;
  solid: string;
  active: string;
  fault: string;
  pending: string;
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
    active: pick('--status-active', STATUS_COLOR.light.active),
    fault: pick('--status-error', STATUS_COLOR.light.error),
    pending: pick('--status-pending', STATUS_COLOR.light.pending),
    beacon: pick('--warning', fallback.warning),
    material: pick('--warning', fallback.warning),
    flow: pick('--accent', fallback.accent),
    label: pick('--text', fallback.text),
    edge: pick('--text', fallback.text),
  };
}

function isDark(hex: string): boolean {
  const h = hex.trim().replace('#', '');
  if (h.length < 6) return false;
  const n = Number.parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return false;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.45;
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

function placePart(mesh: Mesh, part: LocalPart, delta: PartDelta | undefined) {
  mesh.position.set(part.x + (delta?.dx ?? 0), part.y + (delta?.dy ?? 0), part.z + (delta?.dz ?? 0));
  mesh.rotation.set(0, 0, 0);
  if (part.primitive === 'cylinder' && part.axis === 'x') mesh.rotateZ(Math.PI / 2);
  if (part.primitive === 'cylinder' && part.axis === 'z') mesh.rotateX(Math.PI / 2);
  if (delta?.spin) {
    const axis = part.axis === 'x' ? new Vector3(1, 0, 0) : part.axis === 'z' ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
    mesh.rotateOnWorldAxis(axis, delta.spin);
  }
  if (delta?.glow) {
    const mat = mesh.material as MeshStandardMaterial;
    mat.emissive = new Color('#ffd36a');
    mat.emissiveIntensity = delta.glow;
  }
}

function partMesh(part: LocalPart, color: string, delta?: PartDelta): Mesh {
  const geo = part.primitive === 'cylinder'
    ? new CylinderGeometry(Math.max(part.w, part.d) / 2, Math.max(part.w, part.d) / 2, part.h, 16)
    : new BoxGeometry(part.w, part.h, part.d);
  const mesh = new Mesh(geo, new MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.04 }));
  placePart(mesh, part, delta);
  return mesh;
}

function styledMesh(part: StyledPart, delta?: PartDelta): Mesh {
  const spec = materialFor(part);
  const geo = part.primitive === 'cylinder'
    ? new CylinderGeometry(Math.max(part.w, part.d) / 2, Math.max(part.w, part.d) / 2, part.h, 20)
    : new BoxGeometry(part.w, part.h, part.d);
  const mesh = new Mesh(geo, new MeshStandardMaterial({ color: spec.color, metalness: spec.metalness, roughness: spec.roughness }));
  placePart(mesh, part, delta);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function markerRing(w: number, d: number, color: string): Group {
  const g = new Group();
  const t = 5;
  const y = 1.4;
  const mat = () => new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.7, roughness: 0.4, metalness: 0.08 });
  const add = (px: number, pz: number, bw: number, bd: number) => {
    const mesh = new Mesh(new BoxGeometry(bw, 2.2, bd), mat());
    mesh.position.set(px, y, pz);
    g.add(mesh);
  };
  add(w / 2, t / 2, w + 10, t);
  add(w / 2, d - t / 2, w + 10, t);
  add(t / 2, d / 2, t, d);
  add(w - t / 2, d / 2, t, d);
  return g;
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

function seeded(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function factoryFloorMap(dark: boolean, anisotropy: number): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.anisotropy = anisotropy;
  if (!ctx) return tex;
  ctx.fillStyle = dark ? '#1a2433' : '#d7d2c8';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 1400; i++) {
    const a = seeded(i) * (dark ? 0.05 : 0.07);
    ctx.fillStyle = dark ? `rgba(255,255,255,${a})` : `rgba(30,30,30,${a})`;
    ctx.fillRect(seeded(i + 3) * 512, seeded(i + 9) * 512, 2, 2);
  }
  ctx.strokeStyle = dark ? 'rgba(190,205,220,0.16)' : 'rgba(60,60,60,0.22)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 512; i += 64) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke();
  }
  ctx.strokeStyle = dark ? 'rgba(226,161,0,0.4)' : 'rgba(190,130,20,0.5)';
  ctx.lineWidth = 10;
  ctx.strokeRect(26, 26, 460, 460);
  tex.needsUpdate = true;
  return tex;
}

function nameTexture(text: string, ink: string, anisotropy: number): { texture: CanvasTexture; aspect: number } {
  const height = 512;
  const fontPx = Math.floor(height * 0.9);
  const font = `700 ${fontPx}px "Noto Sans KR", sans-serif`;
  const probe = document.createElement('canvas').getContext('2d');
  if (probe) probe.font = font;
  const textW = probe ? Math.max(fontPx, probe.measureText(text).width) : fontPx * emWidth(text);
  const width = Math.max(64, Math.ceil(textW + fontPx * 0.16));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = anisotropy;
  if (ctx) {
    ctx.clearRect(0, 0, width, height);
    ctx.font = font;
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, width / 2, height * 0.52);
    texture.needsUpdate = true;
  }
  return { texture, aspect: width / height };
}

function floorNameMesh(name: FloorName, yaw: number, dark: boolean, anisotropy: number): Group {
  const colors = floorNameColors(dark);
  const g = new Group();
  g.position.set(name.x, 0, name.z);
  g.rotation.y = yaw;
  g.userData.floorName = name.id;
  const band = new Mesh(
    new BoxGeometry(name.length, 1.4, name.depth),
    new MeshStandardMaterial({ color: colors.band, roughness: 0.94, metalness: 0 }),
  );
  band.position.y = 1.2;
  band.receiveShadow = true;
  g.add(band);
  const plate = nameTexture(name.text, colors.ink, anisotropy);
  const planeW = Math.min(name.length * 0.92, name.textHeight * plate.aspect);
  const planeH = planeW / plate.aspect;
  const plane = new Mesh(
    new PlaneGeometry(planeW, planeH),
    new MeshStandardMaterial({ map: plate.texture, transparent: true, roughness: 1, metalness: 0, depthWrite: false }),
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = 2.05;
  g.add(plane);
  return g;
}

function applyFloorYaw(root: Group, cameraYaw: number) {
  const yaw = floorNameYaw(cameraYaw);
  root.traverse((obj) => {
    if (obj.userData.floorName) obj.rotation.y = yaw;
  });
}

function buildScene(root: Group, scene: SceneDescription, palette: ScenePalette, emphasize: boolean, visual: VisualStyleId, showNames: boolean, cameraYaw: number, anisotropy: number) {
  disposeTree(root);
  root.clear();
  const photo = visual === 'photo';
  const dark = isDark(palette.background);
  const pad = 80;
  const b = scene.bounds;
  const floorW = Math.max(40, b.maxX - b.minX + pad * 2);
  const floorD = Math.max(40, b.maxZ - b.minZ + pad * 2);
  const floorMat = new MeshStandardMaterial({ color: photo ? (dark ? '#1a2433' : '#d7d2c8') : palette.floor, roughness: 1, metalness: 0 });
  if (photo) {
    const map = factoryFloorMap(dark, anisotropy);
    map.repeat.set(Math.max(1, floorW / 220), Math.max(1, floorD / 220));
    floorMat.map = map;
  }
  const floor = new Mesh(new BoxGeometry(floorW, 1, floorD), floorMat);
  floor.position.set((b.minX + b.maxX) / 2, -0.5, (b.minZ + b.maxZ) / 2);
  floor.receiveShadow = photo;
  root.add(floor);

  const zoneLook = photo ? photoZoneColors(dark) : null;
  for (const zone of scene.zones) {
    const fill = new Mesh(
      new BoxGeometry(Math.max(1, zone.w - 8), 1, Math.max(1, zone.d - 8)),
      new MeshStandardMaterial({ color: zoneLook?.fill ?? palette.zone, roughness: 1 }),
    );
    fill.position.set(zone.x + zone.w / 2, 0.4, zone.z + zone.d / 2);
    fill.receiveShadow = photo;
    root.add(fill);
    root.add(zoneBorder(zone.x, zone.z, zone.w, zone.d, zoneLook?.edge ?? palette.edge));
  }

  const yaw = floorNameYaw(cameraYaw);
  for (const name of visibleFloorNames(scene.floorNames, showNames)) root.add(floorNameMesh(name, yaw, dark, anisotropy));

  for (const solid of scene.solids) {
    const group = new Group();
    group.position.set(solid.draw.x, 0, solid.draw.z);
    group.userData.deviceId = solid.id;
    const deltaFor = (motion?: string) => (motion ? solid.deltas?.find((delta) => delta.motion === motion) : undefined);
    if (photo) {
      for (const part of photoPartsFor(solid.shape, solid.draw.w, solid.draw.d)) group.add(styledMesh(part, deltaFor(part.motion)));
      if (emphasize && solid.highlight !== 'none') {
        group.add(markerRing(solid.draw.w, solid.draw.d, solid.highlight === 'fault' ? palette.fault : solid.highlight === 'paused' ? palette.pending : palette.active));
      }
    } else {
      const color = solid.highlight === 'fault' && emphasize ? palette.fault
        : solid.highlight === 'paused' && emphasize ? palette.pending
          : solid.highlight === 'active' && emphasize ? palette.active
            : palette.solid;
      for (const part of solid.parts) group.add(partMesh(part, color, deltaFor(part.motion)));
    }
    root.add(group);
  }

  for (const flow of scene.flows) {
    const [a, c] = flow.points;
    if (!a || !c) continue;
    root.add(arrowBetween(a.x, a.z, c.x, c.z, palette.flow));
  }

  for (const mat of scene.materials) {
    const box = new Mesh(new BoxGeometry(42, 30, 42), new MeshStandardMaterial({
      color: mat.waiting ? palette.pending : palette.material,
      roughness: 0.45,
      emissive: mat.waiting ? palette.pending : palette.material,
      emissiveIntensity: mat.waiting ? 0.05 : (photo ? 0.18 : 0),
      transparent: !!mat.waiting,
      opacity: mat.waiting ? 0.55 : 1,
    }));
    box.position.set(mat.x, 18, mat.z);
    box.castShadow = photo;
    root.add(box);
  }
}

function floorNameScreenBox(name: FloorName, cameraYaw: number, project: (x: number, y: number, z: number) => { x: number; y: number } | null): ScreenLabel | null {
  const axes = floorNameAxes(floorNameYaw(cameraYaw));
  const hx = name.length / 2;
  const hz = name.depth / 2;
  const pts = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => project(
    name.x + axes.right.x * hx * sx + axes.up.x * hz * sz,
    2,
    name.z + axes.right.z * hx * sx + axes.up.z * hz * sz,
  )));
  if (pts.some((p) => !p)) return null;
  const xs = pts.map((p) => p!.x);
  const ys = pts.map((p) => p!.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { id: `u:${name.id}`, kind: 'unit', text: name.text, x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function syncLabels(layer: HTMLElement, camera: PerspectiveCamera, scene: SceneDescription, showNames: boolean, emphasize: boolean, cameraYaw: number, selectedId: string | null) {
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
    for (const name of scene.floorNames) {
      const box = floorNameScreenBox(name, cameraYaw, project);
      if (box) boxes.push(box);
    }
  }
  const cam = camera.position;
  for (const label of anchorLabels(scene, showNames, emphasize)) {
    const distance = Math.hypot(cam.x - label.x, cam.y - label.y, cam.z - label.z);
    const alert = label.kind === 'marker' && (label.text.includes('일시정지') || label.text.includes('오류'));
    const selected = label.kind === 'device' && selectedId != null && label.id === `d:${selectedId}`;
    if (!sceneLabelInRange({ showNames, kind: label.kind, alert, distance, selected })) continue;
    const at = project(label.x, label.y, label.z);
    if (!at) continue;
    const size = rough(label.text, label.px);
    const y = label.kind === 'material' ? at.y + 6 : at.y - size.h - (label.kind === 'marker' ? 36 : 18);
    boxes.push({
      id: label.id, kind: label.kind, x: at.x - size.w / 2, y, w: size.w, h: size.h, text: label.text,
      fullText: label.text, selected, alert,
    });
  }
  const kept = placeLabels(boxes).filter((label) => label.kind !== 'unit');
  layer.replaceChildren(...kept.map((label) => {
    const el = document.createElement('div');
    const marker = label.kind === 'marker'
      ? (label.text.includes('일시정지') ? ' paused' : label.text.includes(markerText('fault')) || label.text.includes('오류') ? ' fault' : ' active')
      : '';
    const waiting = label.kind === 'material' && label.text.startsWith(`${waitingLead()}`);
    el.className = `scene3d-label ${label.kind}${marker}${waiting ? ' waiting' : ''}${label.hidden ? ' is-culled' : ''}`;
    el.textContent = label.hidden ? '' : label.text;
    el.title = label.title;
    el.style.left = `${label.x + label.w / 2}px`;
    el.style.top = `${label.y + label.h}px`;
    return el;
  }));
}

function SceneCanvas({ scene, palette, cam, showNames, emphasize, visualMode, selectedId, onCamera, onSelect, onView, onReady }: {
  scene: SceneDescription;
  palette: ScenePalette;
  cam: CameraState;
  showNames: boolean;
  emphasize: boolean;
  visualMode: VisualStyleId;
  selectedId: string | null;
  onCamera: (fn: (cam: CameraState) => CameraState) => void;
  onSelect: (id: string | null) => void;
  onView: (width: number, height: number) => void;
  onReady: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const viewSink = useRef(onView);
  viewSink.current = onView;
  const readySink = useRef(onReady);
  readySink.current = onReady;
  const viewProps = useRef({ scene, showNames, emphasize, yaw: cam.yaw, selectedId });
  viewProps.current = { scene, showNames, emphasize, yaw: cam.yaw, selectedId };
  const paintLabels = () => {
    const view = api.current;
    if (!view || !labelRef.current) return;
    const current = viewProps.current;
    syncLabels(labelRef.current, view.camera, current.scene, current.showNames, current.emphasize, current.yaw, current.selectedId);
  };
  const paintSink = useRef(paintLabels);
  paintSink.current = paintLabels;
  const yawRef = useRef(cam.yaw);
  yawRef.current = cam.yaw;
  const camRef = useRef(cam);
  camRef.current = cam;
  const buildRef = useRef(() => {});
  const api = useRef<{
    renderer: WebGLRenderer;
    camera: PerspectiveCamera;
    scene: Scene;
    root: Group;
    ambient: AmbientLight;
    key: DirectionalLight;
    fill: DirectionalLight;
    render: () => void;
  } | null>(null);
  const drag = useRef<{ x: number; y: number; button: number; shift: boolean; moved: boolean } | null>(null);
  const props = useRef({ scene, palette, showNames, emphasize, visualMode, selectedId, onSelect });
  props.current = { scene, palette, showNames, emphasize, visualMode, selectedId, onSelect };
  const [fontsReady, setFontsReady] = useState(false);

  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts) { setFontsReady(true); return; }
    let live = true;
    fonts.ready.then(() => { if (live) setFontsReady(true); });
    return () => { live = false; };
  }, []);

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
    renderer.shadowMap.type = PCFSoftShadowMap;
    renderer.domElement.setAttribute('aria-label', '3D 장면');
    host.appendChild(renderer.domElement);
    const threeScene = new Scene();
    const camera = new PerspectiveCamera(45, 1, 0.5, 20000);
    const ambient = new AmbientLight(0xffffff, 0.78);
    const sun = new DirectionalLight(0xffffff, 0.95);
    sun.position.set(240, 520, 180);
    sun.castShadow = false;
    sun.shadow.mapSize.set(2048, 2048);
    const fill = new DirectionalLight(0xe7eef8, 0);
    fill.position.set(-220, 280, -140);
    const root = new Group();
    threeScene.add(ambient, sun, fill, sun.target, fill.target, root);
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
    api.current = { renderer, camera, scene: threeScene, root, ambient, key: sun, fill, render };
    resize();
    buildRef.current();
    readySink.current();
    return () => {
      ro.disconnect();
      renderer.domElement.removeEventListener('wheel', onWheel);
      disposeTree(root);
      renderer.dispose();
      renderer.domElement.remove();
      api.current = null;
    };
  }, [onCamera]);

  buildRef.current = () => {
    const view = api.current;
    if (!view) return;
    const { scene, palette, showNames, emphasize, visualMode, selectedId } = props.current;
    const look = renderStyle(visualMode);
    view.renderer.shadowMap.enabled = look.shadows;
    view.renderer.toneMapping = visualMode === 'photo' ? ACESFilmicToneMapping : NoToneMapping;
    view.renderer.toneMappingExposure = visualMode === 'photo' ? 1.08 : 1;
    view.ambient.intensity = look.ambient;
    view.key.intensity = look.key;
    view.fill.intensity = look.fill;
    view.key.castShadow = look.shadows;
    const b = scene.bounds;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    if (visualMode === 'photo') {
      view.key.position.set(cx + 160, 700, cz + 260);
      view.fill.position.set(cx - 300, 360, cz - 140);
      view.key.target.position.set(cx, 0, cz);
      view.fill.target.position.set(cx, 0, cz);
    } else {
      view.key.position.set(240, 520, 180);
      view.fill.position.set(-220, 280, -140);
      view.key.target.position.set(0, 0, 0);
      view.fill.target.position.set(0, 0, 0);
    }
    view.key.target.updateMatrixWorld();
    view.fill.target.updateMatrixWorld();
    const span = Math.max(480, (b.maxX - b.minX), (b.maxZ - b.minZ));
    const shadowCam = view.key.shadow.camera;
    shadowCam.left = -span;
    shadowCam.right = span;
    shadowCam.top = span;
    shadowCam.bottom = -span;
    shadowCam.near = 20;
    shadowCam.far = 2200;
    shadowCam.updateProjectionMatrix();
    view.scene.background = new Color(palette.background);
    const anisotropy = Math.min(8, view.renderer.capabilities.getMaxAnisotropy());
    buildScene(view.root, scene, palette, emphasize, visualMode, showNames, yawRef.current, anisotropy);
    applyCamera(view.camera, camRef.current);
    view.camera.aspect = Math.max(0.2, view.renderer.domElement.clientWidth / Math.max(1, view.renderer.domElement.clientHeight));
    view.camera.updateProjectionMatrix();
    view.render();
    if (labelRef.current) syncLabels(labelRef.current, view.camera, scene, showNames, emphasize, yawRef.current, selectedId);
  };

  useEffect(() => {
    buildRef.current();
  }, [scene, palette, showNames, emphasize, visualMode, fontsReady]);

  useEffect(() => {
    const view = api.current;
    if (!view) return;
    applyCamera(view.camera, cam);
    view.camera.aspect = Math.max(0.2, view.renderer.domElement.clientWidth / Math.max(1, view.renderer.domElement.clientHeight));
    view.camera.updateProjectionMatrix();
    applyFloorYaw(view.root, cam.yaw);
    view.render();
    if (labelRef.current) syncLabels(labelRef.current, view.camera, scene, showNames, emphasize, cam.yaw, selectedId);
  }, [cam, scene, showNames, emphasize, selectedId]);

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
export function Scene3D({ scene, showNames, emphasize, visualMode, equipmentMotion, running, selectedId, onSelect, onDiagram }: {
  scene: SceneDescription;
  showNames: boolean;
  emphasize: boolean;
  visualMode: VisualStyleId;
  equipmentMotion: boolean;
  running: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onDiagram: () => void;
}) {
  const [gl] = useState(canUseWebGL);
  const [booted, setBooted] = useState(!gl);
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

  const onCamera = useCallback((fn: (cam: CameraState) => CameraState) => {
    moved.current = true;
    setCam(fn);
  }, []);
  const fittedSize = useRef({ width: 0, height: 0 });
  const onView = (width: number, height: number) => {
    viewSize.current = { width, height };
    if (width < 2 || height < 2) return;
    if (Math.abs(width - fittedSize.current.width) < 2 && Math.abs(height - fittedSize.current.height) < 2) return;
    fittedSize.current = { width, height };
    const aspect = width / height;
    setCam((c) => (moved.current
      ? (Math.abs(c.aspect - aspect) < 0.01 ? c : { ...c, aspect })
      : framed(aspect, { width, height })));
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
      data-visual-style={visualMode} data-show-names={showNames ? 'on' : 'off'} data-floor-names={showNames ? scene.floorNames.length : 0}
      data-equipment-motion={equipmentMotion ? 'on' : 'off'} data-redraw={shouldRedraw({ running, interacting: false }) ? 'live' : 'still'}
      data-camera-yaw={cam.yaw.toFixed(3)} data-camera-pitch={cam.pitch.toFixed(3)} data-camera-distance={cam.distance.toFixed(1)}>
      <div className="scene3d-bar" title="끌어서 회전 · 오른쪽 끌기 또는 Shift+끌기 이동 · 휠 확대 · 화살표 회전 · +/− 확대 · Home 전체 보기">
        <button type="button" aria-label="전체 보기" title="끌어서 회전 · 오른쪽 끌기 또는 Shift+끌기 이동 · 휠 확대 · 화살표 회전 · +/− 확대 · Home 전체 보기" onClick={() => { moved.current = false; fittedSize.current = { width: 0, height: 0 }; setCam(framed(viewSize.current.width / Math.max(1, viewSize.current.height), viewSize.current)); }}>전체 보기</button>
      </div>
      {visualMode === 'photo' && <p className="scene3d-photo-note">{PHOTO_NOTE}</p>}
      {gl
        ? <BootGate ready={booted} label={LOADING_3D}>
          <SceneCanvas scene={scene} palette={palette} cam={cam} showNames={showNames} emphasize={emphasize} visualMode={visualMode} selectedId={selectedId}
            onCamera={onCamera} onSelect={onSelect} onView={onView} onReady={() => setBooted(true)} />
        </BootGate>
        : <div className="scene3d-fallback" role="status">
          <p>이 브라우저에서는 3D 를 그릴 수 없습니다</p>
          <button type="button" onClick={onDiagram}>도면으로 보기</button>
        </div>}
    </div>
  );
}
