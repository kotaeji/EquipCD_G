import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  Handle,
  MiniMap,
  NodeResizeControl,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  getSmoothStepPath,
  useReactFlow,
  useStoreApi,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type OnConnectEnd,
  type ResizeParams,
  type ResizeParamsWithDirection,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import { findAsset } from '../assets/library';
import { AI_BADGE, resolveGenerated } from '../assets/visuals';
import type { AssetKind, Device, Project, Signal } from '../model/types';
import type { RuntimeState } from '../runtime/engine';
import { Symbol } from './Symbols';
import { overlappingUnitIds, rectsOverlap, unitMinSize, type Box } from '../model/unitLayout';
import { appearanceOf, paletteTheme, THEMES, type UserView } from './viewSettings';
import './canvas-select.css';

export type Mode = 'select' | 'flow' | 'signal';

interface Props {
  project: Project;
  rt: RuntimeState | null;
  /** v0.3 group run: devices active in any lane (highlight only) */
  activeDeviceIds?: string[];
  view: UserView;
  selection: string[];
  mode: Mode;
  connectFrom: string | null;
  locked: boolean;
  onSelect: (ids: string[], additive: boolean) => void;
  onMoveCommit: (ids: string[], dx: number, dy: number, pointer: { x: number; y: number }) => void;
  onDropAsset: (kind: AssetKind | 'unit', at: { x: number; y: number }) => void;
  onPortClick: (signalId: string) => void;
  /** Drag from an out port onto an in port. Model update stays in addConnection. */
  onSignalConnect: (fromSignalId: string, toSignalId: string) => void;
  /** Drag released on empty space, or Esc while a line is out. No model change. */
  onConnectCancel: () => void;
  onUnitConnectClick: (unitId: string) => void;
  onBlocked: (msg: string) => void;
  /** Bottom-right handle released. One resizeUnit command. */
  onResizeCommit: (unitId: string, w: number, h: number) => void;
  /** Shown over the diagram. Null keeps the canvas from growing. */
  connectNote: string | null;
  /** Viewport zoom → UserView.zoom. Pan is not stored. */
  onZoomChange?: (zoom: number) => void;
}

const BLOCKED = '실행 중에는 배치 이동(모델 편집)이 차단됩니다. 선택·보기만 가능합니다.';
/** Same sentence as applyEdit when a model edit is refused while running. */
const EDIT_LOCKED = '실행 중(또는 일시정지 중)에는 모델 편집이 차단됩니다. 초기화 후 편집하세요. (화면 이동·선택·테마·레이어는 허용)';
const START_OUT = '출력(out) 포트에서 시작하세요';
const FIT_MIN_ZOOM = 0.5;
const FIT_LEFT = 52;
const FIT_PADDING = { top: '48px', right: '188px', bottom: '140px', left: '52px' } as const;

/** When a fit is clamped to the minimum zoom, pin the leftmost node to the left inset and keep the vertical center. */
export function leftAlignedViewport(vp: { x: number; y: number; zoom: number }, minZoom: number, leftmostX: number, leftInset: number) {
  if (vp.zoom > minZoom + 0.001) return vp;
  return { x: leftInset - leftmostX * vp.zoom, y: vp.y, zoom: vp.zoom };
}

type DragApi = {
  down: (e: React.PointerEvent, id: string) => void;
  move: (e: React.PointerEvent, id: string) => void;
  up: (e: React.PointerEvent, id: string) => void;
  port: (e: React.PointerEvent, signalId: string) => void;
  resize: (id: string, w: number, h: number) => void;
  resizeEnd: (id: string, w: number, h: number) => void;
};

type UnitData = {
  unitId: string; code: string; name: string; meta: string; w: number; h: number;
  selected: boolean; from: boolean; off: boolean; overlap: boolean;
  showResize: boolean; minW: number; minH: number; api: DragApi;
};
type SignalLink = { fromId: string; fromDevice: string; taken: string[] };
type DeviceData = {
  device: Device; selected: boolean; off: boolean; portsOff: boolean; locked: boolean; active: boolean;
  extended: boolean; raised: boolean; holding: boolean; photo: boolean;
  signals: Signal[]; onIds: string[]; positions: { id: string; name: string; assumption: boolean; current: boolean }[];
  showPositions: boolean; mode: Mode; link: SignalLink | null; api: DragApi;
};
type MatData = { label: string };
type SigEdgeData = { on: boolean };

const nodeTypes = { unit: UnitNode, device: DeviceNode, material: MaterialNode };
const edgeTypes = { flow: FlowEdge, signal: SignalEdge };

function hexAlpha(hex: string, a: number) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function sigTitle(s: Signal, on: boolean) {
  return `${s.name} [${s.direction === 'in' ? '입력' : '출력'} · ${s.role}] 주소: ${s.address ?? '미정(개념 신호)'}${on ? ' · ON' : ''}`;
}

function portTop(list: Signal[], s: Signal, h: number) {
  const i = Math.max(0, list.findIndex((x) => x.id === s.id));
  return ((i + 1) * h) / (list.length + 1);
}

function nodeIdOf(el: Element) {
  return (el.closest('.react-flow__node') as HTMLElement | null)?.dataset.id ?? '';
}

function UnitNode({ data }: NodeProps) {
  const d = data as UnitData;
  const live = useRef(d);
  live.current = d;
  const onResize = useCallback((_: unknown, params: ResizeParamsWithDirection) => {
    live.current.api.resize(live.current.unitId, params.width, params.height);
  }, []);
  const onResizeEnd = useCallback((_: unknown, params: ResizeParams) => {
    live.current.api.resizeEnd(live.current.unitId, params.width, params.height);
  }, []);
  return (
    <div
      className={`rf-unit nopan${d.selected || d.from ? ' is-sel' : ''}${d.off ? ' is-off' : ''}${d.overlap ? ' is-overlap' : ''}`}
      style={{ width: d.w, height: d.h }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('.react-flow__resize-control')) { e.stopPropagation(); return; }
        d.api.down(e, nodeIdOf(e.currentTarget));
      }}
      onPointerMove={(e) => d.api.move(e, nodeIdOf(e.currentTarget))}
      onPointerUp={(e) => d.api.up(e, nodeIdOf(e.currentTarget))}
    >
      {d.showResize && (
        <NodeResizeControl
          position="bottom-right"
          className="rf-unit-resize"
          minWidth={d.minW}
          minHeight={d.minH}
          onResize={onResize}
          onResizeEnd={onResizeEnd}
        />
      )}
      <div className="rf-unit-head">
        <span className="rf-code">{d.code}</span>
        <span className="rf-unit-name">{d.name}</span>
        <span className="rf-unit-meta">{d.meta}</span>
      </div>
      <Handle type="target" position={Position.Left} id="flow-in" isConnectable={false} isConnectableStart={false} isConnectableEnd={false}
        className="rf-flow-anchor" style={{ top: d.h - 18, left: 0, right: 'auto', transform: 'translate(-50%, -50%)' }} />
      <Handle type="source" position={Position.Right} id="flow-out" isConnectable={false} isConnectableStart={false} isConnectableEnd={false}
        className="rf-flow-anchor" style={{ top: d.h - 18, right: 0, left: 'auto', transform: 'translate(50%, -50%)' }} />
    </div>
  );
}

function DeviceNode({ data }: NodeProps) {
  const d = data as DeviceData;
  const { device: dev } = d;
  const ins = d.signals.filter((s) => s.direction === 'in');
  const outs = d.signals.filter((s) => s.direction === 'out');
  const photo = d.photo ? resolveGenerated(dev.kind) : null;
  return (
    <div
      className={`rf-device nopan${d.selected ? ' is-sel' : ''}${d.active ? ' is-active' : ''}${d.off ? ' is-off' : ''}${d.portsOff ? ' ports-off' : ''}`}
      style={{ width: dev.layout.w, height: dev.layout.h }}
      onPointerDown={(e) => d.api.down(e, nodeIdOf(e.currentTarget))}
      onPointerMove={(e) => d.api.move(e, nodeIdOf(e.currentTarget))}
      onPointerUp={(e) => d.api.up(e, nodeIdOf(e.currentTarget))}
    >
      {photo?.status === 'available'
        ? <svg width={dev.layout.w} height={dev.layout.h}>
          <clipPath id={`clip-${dev.id}`}><rect width={dev.layout.w} height={dev.layout.h} rx={3} /></clipPath>
          <rect width={dev.layout.w} height={dev.layout.h} rx={3} fill="var(--panel)" />
          <image href={photo.url} width={dev.layout.w} height={dev.layout.h} preserveAspectRatio="xMidYMid meet" clipPath={`url(#clip-${dev.id})`} />
          <rect width={dev.layout.w} height={dev.layout.h} rx={3} fill="none" stroke="var(--border)" strokeWidth={1} />
        </svg>
        : <svg width={dev.layout.w} height={dev.layout.h}><Symbol kind={dev.kind} w={dev.layout.w} h={dev.layout.h} st={{ active: d.active, extended: d.extended, raised: d.raised, holding: d.holding }} /></svg>}
      <div className="rf-dev-name">{dev.name}</div>
      {d.photo && <div className={`rf-photo-note ${photo?.status === 'available' ? 'ok' : 'miss'}`}>{photo?.status === 'available' ? `${AI_BADGE} 실사풍·실제 사진 아님` : 'AI 이미지 미준비→도식'}</div>}
      {d.showPositions && d.positions.length > 0 && (
        <svg className="rf-positions" width={dev.layout.w} height={dev.layout.h + 24} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}>
          {d.positions.map((ps, i) => {
            const x = ((i + 1) * dev.layout.w) / (d.positions.length + 1);
            const y = dev.layout.h + 4;
            return <g key={ps.id}><path d={`M${x} ${y} l-4 7 l8 0 z`} fill={ps.current ? 'var(--accent)' : 'none'} stroke="var(--warning)" /><text x={x} y={y + 16} fontSize={8} textAnchor="middle" fill="var(--warning)">{ps.name}{ps.assumption ? '(가정)' : ''}</text></g>;
          })}
        </svg>
      )}
      {d.signals.map((s) => {
        const list = s.direction === 'in' ? ins : outs;
        const on = d.onIds.includes(s.id);
        const live = !d.locked && !d.portsOff;
        const mine = d.link?.fromId === s.id;
        const canEnd = !!d.link && s.direction === 'in' && dev.id !== d.link.fromDevice && !d.link.taken.includes(s.id);
        const dim = !!d.link && !mine && !canEnd;
        return (
          <Handle key={s.id} id={s.id} type={s.direction === 'in' ? 'target' : 'source'} position={s.direction === 'in' ? Position.Left : Position.Right}
            isConnectable={live} isConnectableStart={live && s.direction === 'out'} isConnectableEnd={live && s.direction === 'in'}
            className={`rf-port ${s.direction}${on ? ' on' : ''}${mine ? ' from' : ''}${canEnd ? ' is-target' : ''}${dim ? ' is-dim' : ''}`}
            style={{ top: portTop(list, s, dev.layout.h) }}
            title={sigTitle(s, on)}
            data-device={dev.id} data-dir={s.direction} data-port={s.portKey ?? ''}
            onPointerDown={(e) => d.api.port(e, s.id)} />
        );
      })}
    </div>
  );
}

function MaterialNode({ data }: NodeProps) {
  const d = data as MatData;
  return (
    <div className="rf-mat nopan">
      <div className="rf-mat-box" />
      <div className="rf-mat-label">{d.label}</div>
    </div>
  );
}

function FlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected }: EdgeProps) {
  const [path] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 8 });
  const color = selected ? 'var(--accent)' : 'var(--text)';
  const markerId = `flow-arrow-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  return (
    <>
      <defs>
        <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L10 5 L0 10 Z" fill={color} />
        </marker>
      </defs>
      <BaseEdge id={id} path={path} markerEnd={`url(#${markerId})`} style={{ stroke: color, strokeWidth: selected ? 3 : 2 }} />
    </>
  );
}

function SignalEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, data }: EdgeProps) {
  const d = data as SigEdgeData | undefined;
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const on = !!d?.on && !selected;
  const color = selected ? 'var(--accent)' : on ? 'var(--success)' : 'var(--muted)';
  return <BaseEdge id={id} path={path} className={on ? 'rf-sig-on' : undefined} style={{ stroke: color, strokeWidth: selected ? 2.5 : 1.5, strokeDasharray: '5 4' }} />;
}

function FlowCanvas(props: Props) {
  const { project: p, rt, view, selection, mode, connectFrom } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const { screenToFlowPosition, zoomTo, fitView, getViewport, getNodes, setViewport } = useReactFlow();
  const flowRef = useRef(screenToFlowPosition);
  flowRef.current = screenToFlowPosition;
  const dragRef = useRef<{ ids: string[]; sx: number; sy: number; origin: string } | null>(null);
  const abortRef = useRef(false);
  const [preview, setPreview] = useState<{ ids: string[]; dx: number; dy: number } | null>(null);
  const [resizePreview, setResizePreview] = useState<{ id: string; w: number; h: number } | null>(null);
  const [dragFrom, setDragFrom] = useState<string | null>(null);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [band, setBand] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const bandListeners = useRef<(() => void) | null>(null);
  const bandLive = useRef(false);
  const skipPaneClear = useRef(false);
  const store = useStoreApi();
  const L = view.layers;

  useEffect(() => () => { bandListeners.current?.(); bandLive.current = false; }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(true); };
    const up = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(false); };
    const blur = () => setShiftHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  useEffect(() => {
    if (props.locked && resizePreview) setResizePreview(null);
  }, [props.locked, resizePreview]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      abortRef.current = true;
      store.getState().cancelConnection();
      setDragFrom(null);
      if (!bandLive.current) return;
      bandLive.current = false;
      bandListeners.current?.();
      bandListeners.current = null;
      setBand(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);

  const onConnect = useCallback((c: Connection) => {
    if (abortRef.current || !c.sourceHandle || !c.targetHandle) return;
    propsRef.current.onSignalConnect(c.sourceHandle, c.targetHandle);
  }, []);
  const onConnectStart = useCallback((_: unknown, params: { handleId: string | null }) => {
    abortRef.current = false;
    if (params.handleId) setDragFrom(params.handleId);
  }, []);
  const onConnectEnd = useCallback<OnConnectEnd>((_, state) => {
    setDragFrom(null);
    if (abortRef.current) { abortRef.current = false; propsRef.current.onConnectCancel(); return; }
    // A valid drop is already applied in onConnect. A drop on a port that React Flow marked invalid still goes through addConnection so the existing refusal is shown.
    if (state.isValid === true) return;
    const from = state.fromHandle?.id ?? null;
    const to = state.toHandle?.id ?? null;
    if (from && to) { propsRef.current.onSignalConnect(from, to); return; }
    propsRef.current.onConnectCancel();
  }, []);
  const isValidConnection = useCallback((c: Connection | Edge) => {
    const proj = propsRef.current.project;
    const a = proj.signals.find((s) => s.id === c.sourceHandle);
    const b = proj.signals.find((s) => s.id === c.targetHandle);
    if (!a || !b || a.direction !== 'out' || b.direction !== 'in' || a.deviceId === b.deviceId) return false;
    return !proj.connections.some((x) => x.kind === 'signal' && x.from.signalId === a.id && x.to.signalId === b.id);
  }, []);

  const modelIds = useCallback((ids: string[]) => {
    const ok = new Set<string>([...p.units.map((u) => u.id), ...p.devices.map((d) => d.id)]);
    return ids.filter((id) => ok.has(id));
  }, [p.units, p.devices]);

  const api: DragApi = {
    down: (e, id) => {
      if (!id) return;
      const cur = propsRef.current;
      if (cur.mode === 'flow') {
        e.stopPropagation();
        const unitId = cur.project.units.some((u) => u.id === id) ? id : cur.project.devices.find((d) => d.id === id)?.unitId;
        if (unitId) cur.onUnitConnectClick(unitId);
        return;
      }
      if (cur.mode !== 'select') return;
      e.stopPropagation();
      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      const have = modelIds(cur.selection);
      const ids = have.includes(id) && !additive ? have : additive ? [...new Set([...have, id])] : [id];
      cur.onSelect(ids, false);
      if (cur.locked) { cur.onBlocked(BLOCKED); return; }
      const pt = flowRef.current({ x: e.clientX, y: e.clientY });
      dragRef.current = { ids, sx: pt.x, sy: pt.y, origin: id };
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* jsdom */ }
    },
    move: (e, id) => {
      const d = dragRef.current;
      if (!d || d.origin !== id) return;
      const pt = flowRef.current({ x: e.clientX, y: e.clientY });
      const dx = Math.round(pt.x - d.sx);
      const dy = Math.round(pt.y - d.sy);
      setPreview((prev) => (prev && prev.dx === dx && prev.dy === dy && prev.ids === d.ids ? prev : { ids: d.ids, dx, dy }));
    },
    up: (e, id) => {
      const d = dragRef.current;
      if (!d || d.origin !== id) return;
      dragRef.current = null;
      const pt = flowRef.current({ x: e.clientX, y: e.clientY });
      const dx = Math.round(pt.x - d.sx);
      const dy = Math.round(pt.y - d.sy);
      setPreview(null);
      if (Math.abs(dx) + Math.abs(dy) >= 2) propsRef.current.onMoveCommit(d.ids, dx, dy, pt);
    },
    resize: (id, w, h) => {
      const nw = Math.round(w);
      const nh = Math.round(h);
      setResizePreview((prev) => (prev && prev.id === id && prev.w === nw && prev.h === nh ? prev : { id, w: nw, h: nh }));
    },
    resizeEnd: (id, w, h) => {
      setResizePreview(null);
      const cur = propsRef.current;
      const u = cur.project.units.find((x) => x.id === id);
      if (!u) return;
      const min = unitMinSize(cur.project, id);
      const nw = Math.round(Math.max(w, min.w));
      const nh = Math.round(Math.max(h, min.h));
      if (nw === u.layout.w && nh === u.layout.h) return;
      cur.onResizeCommit(id, nw, nh);
    },
    port: (e, signalId) => {
      // Keep the event from reaching the device body. Do not preventDefault — that would swallow the mouse down React Flow uses to start a connection line.
      e.stopPropagation();
      const cur = propsRef.current;
      if (cur.locked) { cur.onBlocked(EDIT_LOCKED); return; }
      const sig = cur.project.signals.find((s) => s.id === signalId);
      if (!sig) return;
      const pending = cur.mode === 'signal' && !!cur.connectFrom;
      if (sig.direction === 'in' && !pending) { cur.onBlocked(START_OUT); return; }
      if (cur.mode !== 'signal') return;
      if (cur.connectFrom === signalId) return;
      cur.onPortClick(signalId);
    },
  };

  const off = (id: string, unitId?: string) => {
    if (!preview) return { dx: 0, dy: 0 };
    if (preview.ids.includes(id) || (unitId && preview.ids.includes(unitId))) return preview;
    return { dx: 0, dy: 0 };
  };

  const activeDevice = rt?.active ? p.actions.find((a) => a.id === p.sequence.steps[rt.active!.stepIndex]?.actionId)?.deviceId : undefined;
  const sigOn = (deviceId: string, port: string) => {
    const s = p.signals.find((x) => x.deviceId === deviceId && x.portKey === port);
    return !!(s && rt?.signals?.[s.id]);
  };

  const pendingId = dragFrom ?? (mode === 'signal' ? connectFrom : null);
  const pendingSig = pendingId ? p.signals.find((s) => s.id === pendingId) : undefined;
  const link: SignalLink | null = pendingSig ? {
    fromId: pendingSig.id, fromDevice: pendingSig.deviceId,
    taken: p.connections.filter((c) => c.kind === 'signal' && c.from.signalId === pendingSig.id && c.to.signalId).map((c) => c.to.signalId!),
  } : null;

  const boxes: (Box & { id: string })[] = p.units.map((u) => {
    const o = off(u.id);
    const rz = resizePreview?.id === u.id ? resizePreview : null;
    return { id: u.id, x: u.layout.x + o.dx, y: u.layout.y + o.dy, w: rz?.w ?? u.layout.w, h: rz?.h ?? u.layout.h };
  });
  const overlap = new Set(overlappingUnitIds(boxes));
  const nodes: Node[] = [];
  for (const u of p.units) {
    const box = boxes.find((b) => b.id === u.id)!;
    const short = u.name.replace(new RegExp(`^${u.code}\\s*`), '');
    const min = unitMinSize(p, u.id);
    const selected = selection.includes(u.id);
    nodes.push({
      id: u.id, type: 'unit', zIndex: selected ? 2 : 1,
      position: { x: box.x, y: box.y },
      width: box.w, height: box.h, measured: { width: box.w, height: box.h },
      draggable: false, selectable: false, connectable: false, deletable: false,
      className: 'nopan',
      data: {
        unitId: u.id, code: u.code, name: short, meta: `${u.deviceIds.length} dev · cap ${u.capacity.maxMaterials.value ?? '?'}`,
        w: box.w, h: box.h, selected, from: connectFrom === u.id,
        off: !L.units, overlap: overlap.has(u.id),
        showResize: selected && mode === 'select' && !props.locked && L.units,
        minW: min.w, minH: min.h, api,
      } satisfies UnitData,
    });
  }
  for (const d of p.devices) {
    const cat = findAsset(d.kind)?.category;
    const axisOff = !L.axis && (cat === 'axis' || cat === 'transport');
    const o = off(d.id, d.unitId);
    const onIds = p.signals.filter((s) => s.deviceId === d.id && rt?.signals?.[s.id]).map((s) => s.id);
    const positions = p.positions.filter((ps) => ps.deviceId === d.id).map((ps) => ({
      id: ps.id, name: ps.name.replace(d.name, '').trim(), assumption: !!ps.value.assumption, current: rt?.devicePositions?.[d.id] === ps.id,
    }));
    nodes.push({
      id: d.id, type: 'device', zIndex: selection.includes(d.id) ? 6 : 3,
      position: { x: d.layout.x + o.dx, y: d.layout.y + o.dy },
      width: d.layout.w, height: d.layout.h, measured: { width: d.layout.w, height: d.layout.h },
      draggable: false, selectable: false, connectable: !props.locked, deletable: false,
      className: 'nopan',
      data: {
        device: d, selected: selection.includes(d.id), off: axisOff, portsOff: !L.io || axisOff, locked: props.locked,
        active: activeDevice === d.id || !!props.activeDeviceIds?.includes(d.id),
        extended: d.kind === 'cylinder' ? sigOn(d.id, 'cmdFwd') || sigOn(d.id, 'fwdDone')
          : d.kind === 'pusher' ? sigOn(d.id, 'cmdPush') || sigOn(d.id, 'pushDone')
          : d.kind === 'gantry' ? (rt?.devicePositions?.[d.id] ?? null) !== null || sigOn(d.id, 'cmdMove') : false,
        raised: d.kind === 'stopper' && (sigOn(d.id, 'upDone') || sigOn(d.id, 'cmdUp')),
        holding: rt?.material?.holder === d.id,
        photo: view.visualMode === 'photo',
        signals: p.signals.filter((s) => s.deviceId === d.id), onIds, positions, showPositions: L.positions,
        mode, link, api,
      } satisfies DeviceData,
    });
  }

  const mat = materialMarker(p, rt, off);
  if (mat && L.flow) {
    nodes.push({
      id: 'runtime-material', type: 'material', zIndex: 8,
      position: { x: mat.x - 11, y: mat.y - 11 },
      width: 22, height: 22, measured: { width: 22, height: 22 },
      draggable: false, selectable: false, connectable: false, deletable: false, focusable: false,
      className: 'nopan',
      style: { pointerEvents: 'none' },
      data: { label: mat.label } satisfies MatData,
    });
  }

  const edges: Edge[] = [];
  if (L.flow) {
    for (const c of p.connections) if (c.kind === 'flow') {
      edges.push({
        id: c.id, type: 'flow', source: c.from.nodeId, target: c.to.nodeId, sourceHandle: 'flow-out', targetHandle: 'flow-in',
        selected: selection.includes(c.id), selectable: true, deletable: false, zIndex: 3, className: 'nopan rf-edge-flow',
      });
    }
  }
  if (L.io) {
    for (const c of p.connections) if (c.kind === 'signal' && c.from.signalId && c.to.signalId) {
      edges.push({
        id: c.id, type: 'signal', source: c.from.nodeId, target: c.to.nodeId, sourceHandle: c.from.signalId, targetHandle: c.to.signalId,
        selected: selection.includes(c.id), selectable: true, deletable: false, zIndex: 3, className: 'nopan rf-edge-sig',
        data: { on: !!rt?.signals?.[c.from.signalId] } satisfies SigEdgeData,
      });
    }
  }

  const alignLeftIfMin = useCallback(() => {
    const vp = getViewport();
    const nodes = getNodes();
    if (!nodes.length) return;
    const minX = Math.min(...nodes.map((n) => n.position.x));
    const next = leftAlignedViewport(vp, FIT_MIN_ZOOM, minX, FIT_LEFT);
    if (Math.abs(next.x - vp.x) < 0.5) return;
    void setViewport(next, { duration: 0 });
  }, [getViewport, getNodes, setViewport]);

  const fitCanvas = useCallback(async () => {
    // Insets clear the 28px legend, 28px controls, and 160×110 minimap. Panel margin is 15px.
    await fitView({ padding: FIT_PADDING, duration: 0, minZoom: FIT_MIN_ZOOM, maxZoom: 2 });
    alignLeftIfMin();
  }, [fitView, alignLeftIfMin]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let fitted = false;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width > 40 && r.height > 40) {
        if (!fitted) {
          fitted = true;
          void fitCanvas();
        }
      } else fitted = false;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitCanvas]);

  useEffect(() => {
    const vp = getViewport();
    if (Math.abs(vp.zoom - view.zoom) < 0.001) return;
    void zoomTo(view.zoom, { duration: 0 });
  }, [view.zoom, getViewport, zoomTo]);

  const onMove = useCallback((_: unknown, vp: Viewport) => {
    const z = Math.min(2, Math.max(0.5, vp.zoom));
    if (Math.abs(z - propsRef.current.view.zoom) < 0.001) return;
    propsRef.current.onZoomChange?.(z);
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const k = e.dataTransfer?.getData('application/x-ecd-asset') as AssetKind | 'unit' | '';
    if (!k) return;
    propsRef.current.onDropAsset(k, flowRef.current({ x: e.clientX, y: e.clientY }));
  };

  const onBandDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const cur = propsRef.current;
    if (cur.mode !== 'select' || !e.shiftKey) return;
    const t = e.target as HTMLElement;
    if (t.closest('.react-flow__node, .react-flow__edge, .react-flow__handle, .react-flow__controls, .react-flow__minimap, .rf-legend, .rf-connect-note, .react-flow__attribution, .react-flow__panel')) return;
    const host = hostRef.current;
    if (!host) return;
    // Capture phase: stop the event before React Flow's pan listener on the renderer sees it.
    e.stopPropagation();
    e.preventDefault();
    try { host.setPointerCapture(e.pointerId); } catch { /* jsdom */ }
    const origin = host.getBoundingClientRect();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const left0 = x0 - origin.left;
    const top0 = y0 - origin.top;
    bandLive.current = true;
    setBand({ left: left0, top: top0, width: 0, height: 0 });
    let detach = () => {};
    const finish = (ev: PointerEvent | null, commit: boolean) => {
      if (!bandLive.current) return;
      bandLive.current = false;
      detach();
      bandListeners.current = null;
      setBand(null);
      if (ev) { try { host.releasePointerCapture(ev.pointerId); } catch { /* jsdom */ } }
      if (!commit || !ev) return;
      const dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      if (Math.abs(dx) + Math.abs(dy) < 3) return;
      skipPaneClear.current = true;
      const a = flowRef.current({ x: x0, y: y0 });
      const b = flowRef.current({ x: ev.clientX, y: ev.clientY });
      const box: Box = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
      const proj = propsRef.current.project;
      const hit: string[] = [];
      for (const u of proj.units) if (rectsOverlap(box, u.layout)) hit.push(u.id);
      for (const d of proj.devices) if (rectsOverlap(box, d.layout)) hit.push(d.id);
      propsRef.current.onSelect([...new Set([...propsRef.current.selection, ...hit])], true);
    };
    const move = (ev: PointerEvent) => {
      if (!bandLive.current) return;
      const r = host.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const y = ev.clientY - r.top;
      setBand({ left: Math.min(left0, x), top: Math.min(top0, y), width: Math.abs(x - left0), height: Math.abs(y - top0) });
    };
    const up = (ev: PointerEvent) => finish(ev, true);
    const cancel = () => finish(null, false);
    detach = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
    bandListeners.current = detach;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  };

  const pal = THEMES[paletteTheme(view.theme)].vars;
  return (
    <div ref={hostRef} className="rf-host" data-mode={mode} data-linking={link ? '1' : '0'} onPointerDownCapture={onBandDown} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onMove={onMove}
        onNodeClick={() => undefined /* NodeWrapper turns pointer events on only when a click handler exists. Selection stays on pointerdown. */}
        onEdgeClick={(_, edge) => propsRef.current.onSelect([edge.id], false)}
        onPaneClick={(e) => {
          if (skipPaneClear.current) { skipPaneClear.current = false; return; }
          const t = e.target as HTMLElement;
          if (t.closest('.react-flow__node, .react-flow__edge, .react-flow__handle, .react-flow__controls, .react-flow__minimap, .rf-legend, .rf-connect-note, .react-flow__attribution')) return;
          if (propsRef.current.mode === 'select') propsRef.current.onSelect([], false);
        }}
        defaultViewport={{ x: 0, y: 0, zoom: view.zoom }}
        minZoom={0.5}
        maxZoom={2}
        panOnDrag={!(mode === 'select' && shiftHeld)}
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}
        selectionOnDrag={false}
        nodesDraggable={false}
        nodesConnectable={!props.locked}
        connectOnClick={false}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        connectionLineStyle={{ stroke: 'var(--muted)', strokeWidth: 1.5, strokeDasharray: '5 4' }}
        elementsSelectable
        nodesFocusable={false}
        edgesFocusable={false}
        elevateNodesOnSelect={false}
        zIndexMode="manual"
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        selectNodesOnDrag={false}
        edgesReconnectable={false}
        preventScrolling
        colorMode={appearanceOf(view.theme) === 'dark' ? 'dark' : 'light'}
        proOptions={{ hideAttribution: false }}
        style={{ background: 'var(--canvas)' }}
      >
        {L.background && <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--grid)" />}
        <Controls showInteractive={false} position="bottom-left" className="nopan" aria-label="도면 확대 축소"
          fitViewOptions={{ padding: FIT_PADDING, duration: 0, minZoom: FIT_MIN_ZOOM, maxZoom: 2 }}
          onFitView={() => { requestAnimationFrame(() => requestAnimationFrame(() => alignLeftIfMin())); }} />
        <MiniMap
          className="nopan"
          position="bottom-right"
          pannable
          zoomable
          style={{ width: 160, height: 110 }}
          bgColor={pal.panel}
          maskColor={hexAlpha(pal.canvas, 0.7)}
          nodeStrokeWidth={0}
          nodeColor={(n) => n.type === 'unit' ? pal.selected : n.type === 'device' ? pal.muted : pal.warning}
          ariaLabel="도면 미니맵"
        />
        {props.connectNote && <Panel position="top-left" className="notice rf-connect-note nopan" style={{ position: 'absolute', top: 48, pointerEvents: 'none' }}>{props.connectNote}</Panel>}
        <Panel position="top-left" className="rf-legend nopan" title="배경: 도면/VC 탑뷰 없음 (선택 사항 — 배경 없이 동작) · Shift + 끌기: 여러 개 고르기">
          <div><svg width="22" height="8" aria-hidden="true"><line x1="0" y1="4" x2="14" y2="4" stroke="var(--text)" strokeWidth="2" /><path d="M12 1 L20 4 L12 7 Z" fill="var(--text)" /></svg>자재 흐름(물류)</div>
          <div><svg width="22" height="8" aria-hidden="true"><line x1="0" y1="4" x2="22" y2="4" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="5 4" /></svg>논리 신호 (out●→in○)</div>
          <div><svg width="12" height="8" aria-hidden="true"><path d="M6 0 L2 8 L10 8 Z" fill="none" stroke="var(--warning)" /></svg>Position</div>
          <div><svg width="12" height="8" aria-hidden="true"><rect x="1" y="0" width="10" height="8" fill="var(--warning)" fillOpacity={0.2} stroke="var(--warning)" /></svg>자재(런타임 개체)</div>
        </Panel>
      </ReactFlow>
      {band && <div className="rf-marquee" data-testid="marquee" style={{ left: band.left, top: band.top, width: band.width, height: band.height }} />}
    </div>
  );
}

function materialMarker(p: Project, rt: RuntimeState | null, off: (id: string, unitId?: string) => { dx: number; dy: number }) {
  const m0 = p.materials[0];
  const mi = rt?.material ?? (m0 && m0.initialLocation ? { location: m0.initialLocation, state: m0.initialState ?? '', holder: null as string | null, instanceId: `${m0.id}#1` } : null);
  const unitAnchor = (uid: string | 'EXIT') => {
    if (uid === 'EXIT') {
      const last = p.units[p.units.length - 1];
      if (!last) return { x: 20, y: 20 };
      const o = off(last.id);
      return { x: last.layout.x + o.dx + last.layout.w + 40, y: last.layout.y + o.dy + last.layout.h - 34 };
    }
    const u = p.units.find((x) => x.id === uid);
    if (!u) return null;
    const o = off(u.id);
    return { x: u.layout.x + o.dx + u.layout.w / 2, y: u.layout.y + o.dy + u.layout.h - 34 };
  };
  if (!mi) return null;
  let pos = unitAnchor(mi.location as string | 'EXIT');
  if (mi.holder) {
    const d = p.devices.find((x) => x.id === mi.holder);
    if (d) { const o = off(d.id, d.unitId); pos = { x: d.layout.x + o.dx + d.layout.w / 2, y: d.layout.y + o.dy + d.layout.h + 10 }; }
  }
  if (rt?.active) {
    const step = p.sequence.steps[rt.active.stepIndex];
    const a = p.actions.find((x) => x.id === step?.actionId);
    if (a?.effect.moveTo && a.duration.value) {
      const to = a.effect.moveTo === 'EXIT' ? unitAnchor('EXIT') : unitAnchor(a.effect.moveTo);
      const f = Math.min(1, Math.max(0, (rt.timeMs - rt.active.startMs) / (a.duration.value * 1000)));
      if (pos && to && rt.active.completeAtMs !== null) pos = { x: pos.x + (to.x - pos.x) * f, y: pos.y + (to.y - pos.y) * f };
    }
  }
  if (!pos) return null;
  return { ...pos, label: `${m0?.name.split(' ')[0] ?? 'M'} · ${mi.state}` };
}

export function Canvas(props: Props) {
  return (
    <ReactFlowProvider>
      <FlowCanvas {...props} />
    </ReactFlowProvider>
  );
}
