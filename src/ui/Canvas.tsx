import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  Handle,
  EdgeLabelRenderer,
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
  useViewport,
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
import { IconLabel } from './Icon';
import { StatusMark } from './StatusMark';
import { STATUS, waitingLead } from './status';
import type { AssetKind, Device, Project, Signal } from '../model/types';
import type { RuntimeState } from '../runtime/engine';
import { pausedDeviceIds, pausedUnitIds } from '../scene/describe';
import { Symbol } from './Symbols';
import { overlappingUnitIds, rectsOverlap, unitMinSize, type Box } from '../model/unitLayout';
import {
  DIM_EDGE_OPACITY,
  edgeTone,
  edgeWidth,
  flowCaption,
  graphFocus,
  portWord,
  signalCaption,
  type EdgeTone,
} from './edgeFocus';
import {
  layoutDiagramLabels,
  unitNameFontPx,
  zoomTier,
  type DiagramLabel,
  type PlacedLabel,
} from '../scene/labels';
import { pointerSelection, SELECT_HINT } from './selectAll';
import { EDIT_LOCKED as EDIT_LOCKED_MSG, FLOW_UNIT_ONLY, isTextField, type ContextRequest } from './contextMenuModel';
import { appearanceOf, paletteTheme, THEMES, type UserView } from './viewSettings';
import { readDiagramBackground } from '../model/background';
import { DiagramBackground } from './DiagramBackground';
import { UnitLockMark } from './UnitLock';
import './canvas-select.css';

export type Mode = 'select' | 'flow' | 'signal';

interface Props {
  project: Project;
  rt: RuntimeState | null;
  /** v0.3 group run: devices active in any lane (highlight only) */
  activeDeviceIds?: string[];
  /** Devices whose step stopped on an error. Same set the 3D view uses. */
  faultDeviceIds?: string[];
  /** Subset of the fault devices stopped by a confirmed Interlock. */
  interlockDeviceIds?: string[];
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
  /** Drag a Unit flow handle onto another Unit. Model update stays in addConnection. */
  onFlowConnect: (fromUnitId: string, toUnitId: string) => void;
  /** Drag released on empty space, or Esc while a line is out. No model change. */
  onConnectCancel: () => void;
  /** Right-click on the diagram. The menu itself lives in App. */
  onContextMenu?: (req: ContextRequest) => void;
  /** Increments when the user asks the diagram to fit. 0 does nothing. */
  fitToken?: number;
  onUnitConnectClick: (unitId: string) => void;
  onBlocked: (msg: string) => void;
  /** Bottom-right handle released. One resizeUnit command. */
  onResizeCommit: (unitId: string, w: number, h: number) => void;
  /** Shown over the diagram. Null keeps the canvas from growing. */
  connectNote: string | null;
  /** Two-point scale mode. Clicks on an unlocked background report image pixels. */
  backgroundPicking?: boolean;
  onBackgroundMove?: (x: number, y: number) => void;
  onBackgroundPoint?: (px: number, py: number) => void;
  /** Viewport zoom → UserView.zoom. Pan is not stored. */
  onZoomChange?: (zoom: number) => void;
  /** Stage-2 and stage-6 remember the minimap apart. View only. */
  onMinimapChange?: (frame: 'layout' | 'run', open: boolean) => void;
  /**
   * `layout` keeps the stage-2 fit (once, large insets, left pin at min zoom).
   * `run` fits the station into the stage-6 pane and refits when that pane changes.
   */
  frame?: 'layout' | 'run';
}

const BLOCKED = '실행 중에는 배치 이동(모델 편집)이 차단됩니다. 선택·보기만 가능합니다.';
/** Same sentence as applyEdit when a model edit is refused while running. */
const EDIT_LOCKED = EDIT_LOCKED_MSG;
const START_OUT = '출력(out) 포트에서 시작하세요';
const FIT_MIN_ZOOM = 0.5;
const FIT_LEFT = 52;
const FIT_PADDING = { top: '48px', right: '188px', bottom: '140px', left: '52px' } as const;

/** When a fit is clamped to the minimum zoom, pin the leftmost node to the left inset and keep the vertical center. */
export function leftAlignedViewport(vp: { x: number; y: number; zoom: number }, minZoom: number, leftmostX: number, leftInset: number) {
  if (vp.zoom > minZoom + 0.001) return vp;
  return { x: leftInset - leftmostX * vp.zoom, y: vp.y, zoom: vp.zoom };
}

/** Unit name lives in this strip at the top of the unit box. */
export const UNIT_NAME_H = 28;
/** Gap kept between the legend's bottom edge and a unit name. */
export const LEGEND_NAME_GAP = 4;

export interface NameBox { x: number; y: number; w: number }
export interface ScreenRect { x: number; y: number; w: number; h: number }

/** Screen rectangle of a unit's name strip. */
export function unitNameScreen(unit: NameBox, vp: { x: number; y: number; zoom: number }): ScreenRect {
  return {
    x: unit.x * vp.zoom + vp.x,
    y: unit.y * vp.zoom + vp.y,
    w: unit.w * vp.zoom,
    h: UNIT_NAME_H * vp.zoom,
  };
}

function screensOverlap(a: ScreenRect, b: ScreenRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Move the viewport down until no unit name meets the legend.
 * Zoom and x stay. A legend with no size (no layout yet) is left alone.
 */
export function clearLegendViewport(
  vp: { x: number; y: number; zoom: number },
  units: readonly NameBox[],
  legend: ScreenRect,
): { x: number; y: number; zoom: number } {
  if (!(vp.zoom > 0) || legend.w < 1 || legend.h < 1) return vp;
  let dy = 0;
  for (const unit of units) {
    const head = unitNameScreen(unit, vp);
    if (!screensOverlap(head, legend)) continue;
    dy = Math.max(dy, legend.y + legend.h + LEGEND_NAME_GAP - head.y);
  }
  if (dy <= 0) return vp;
  return { ...vp, y: vp.y + dy };
}

function legendInPane(host: HTMLElement | null): ScreenRect | null {
  const legend = host?.querySelector('.rf-legend');
  const pane = host?.querySelector('.react-flow');
  if (!legend || !pane) return null;
  const lr = legend.getBoundingClientRect();
  const pr = pane.getBoundingClientRect();
  if (lr.width < 1 || lr.height < 1) return null;
  return { x: lr.left - pr.left, y: lr.top - pr.top, w: lr.width, h: lr.height };
}

/** Stage-6 insets. Top clears the 28px legend; the other sides stay small so the station can fill the pane. */
export const RUN_FIT_PAD = { top: 44, right: 12, bottom: 16, left: 12 } as const;
/** Minimap box. The panel margin matches React Flow's 15px corner inset. */
export const MINIMAP_W = 160;
export const MINIMAP_H = 110;
export const MINIMAP_MARGIN = 15;
/** Collapse button (22px) and the gap above the map, used when the map is open. */
export const MINIMAP_BTN = 22;
export const MINIMAP_GAP = 4;

/** Stage-6 fit. An open minimap keeps its 160×110 box, plus the button above it, clear of every unit. */
export function runFitPad(minimapOpen: boolean) {
  if (!minimapOpen) return RUN_FIT_PAD;
  return {
    top: RUN_FIT_PAD.top,
    left: RUN_FIT_PAD.left,
    right: MINIMAP_MARGIN + MINIMAP_W + 8,
    bottom: MINIMAP_MARGIN + MINIMAP_H + MINIMAP_GAP + MINIMAP_BTN + 8,
  };
}

/** Screen rectangle of the open minimap inside a pane of `width` × `height`. */
export function minimapScreenRect(width: number, height: number): PlanBox {
  return {
    x: width - MINIMAP_MARGIN - MINIMAP_W,
    y: height - MINIMAP_MARGIN - MINIMAP_H,
    w: MINIMAP_W,
    h: MINIMAP_H,
  };
}

export function screenBox(box: PlanBox, vp: { x: number; y: number; zoom: number }): PlanBox {
  return { x: box.x * vp.zoom + vp.x, y: box.y * vp.zoom + vp.y, w: box.w * vp.zoom, h: box.h * vp.zoom };
}

/** True when no unit rectangle meets the open minimap. */
export function unitsClearMinimap(units: PlanBox[], width: number, height: number, vp: { x: number; y: number; zoom: number }) {
  const map = minimapScreenRect(width, height);
  return units.every((u) => !rectsOverlap(screenBox(u, vp), map));
}
export const RUN_FIT_MIN_ZOOM = 0.05;
export const RUN_FIT_MAX_ZOOM = 2;

export type PlanBox = { x: number; y: number; w: number; h: number };

export function unionBounds(boxes: PlanBox[]): PlanBox | null {
  if (!boxes.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  if (!Number.isFinite(x0) || x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Center `bounds` in the pane inside `pad`. Zoom stays within the run limits. */
export function runPlanViewport(
  bounds: PlanBox,
  width: number,
  height: number,
  pad: { top: number; right: number; bottom: number; left: number } = RUN_FIT_PAD,
  minZoom = RUN_FIT_MIN_ZOOM,
  maxZoom = RUN_FIT_MAX_ZOOM,
) {
  const innerW = Math.max(1, width - pad.left - pad.right);
  const innerH = Math.max(1, height - pad.top - pad.bottom);
  const zoom = Math.min(maxZoom, Math.max(minZoom, Math.min(innerW / bounds.w, innerH / bounds.h)));
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  return {
    x: pad.left + innerW / 2 - cx * zoom,
    y: pad.top + innerH / 2 - cy * zoom,
    zoom,
  };
}

/** How much of the pane the box uses, and whether it sits inside the pane. */
export function planFitReport(bounds: PlanBox, width: number, height: number, vp: { x: number; y: number; zoom: number }, maxZoom = RUN_FIT_MAX_ZOOM) {
  const left = bounds.x * vp.zoom + vp.x;
  const top = bounds.y * vp.zoom + vp.y;
  const boxW = bounds.w * vp.zoom;
  const boxH = bounds.h * vp.zoom;
  const inside = left >= -0.5 && top >= -0.5 && left + boxW <= width + 0.5 && top + boxH <= height + 0.5;
  const ratio = Math.max(boxW / width, boxH / height);
  const atMax = vp.zoom >= maxZoom - 0.001;
  return { inside, ratio, atMax, fills: atMax || ratio >= 0.7 - 1e-6, left, top, boxW, boxH };
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
  selected: boolean; from: boolean; off: boolean; overlap: boolean; tone: string;
  flowFrom: boolean; flowTarget: boolean;
  showResize: boolean; minW: number; minH: number; api: DragApi;
  paused?: boolean;
  positionLocked?: boolean;
  nameShown: string; nameTitle: string; nameHidden: boolean; nameFont: number; showPause: boolean;
};
type SignalLink = { fromId: string; fromDevice: string; taken: string[] };
type DeviceData = {
  device: Device; selected: boolean; off: boolean; portsOff: boolean; locked: boolean; active: boolean; fault: boolean; interlock: boolean; paused: boolean; tone: string;
  extended: boolean; raised: boolean; holding: boolean; photo: boolean;
  signals: Signal[]; onIds: string[]; positions: { id: string; name: string; assumption: boolean; current: boolean }[];
  showPositions: boolean; mode: Mode; link: SignalLink | null; api: DragApi;
  nameShown: string; nameTitle: string; nameHidden: boolean; showStatus: boolean;
  portLabels: { id: string; text: string; title: string; top: number; side: 'in' | 'out' }[];
};
type MatData = { label: string; waiting?: boolean; pieceId?: string };
type EdgeView = { on?: boolean; tone: EdgeTone; caption: string; hover: boolean };

function edgePaint(kind: 'flow' | 'signal', tone: EdgeTone, selected: boolean, liveColor: string) {
  return {
    stroke: selected ? 'var(--accent)' : liveColor,
    strokeWidth: edgeWidth(kind, tone, selected),
    opacity: tone === 'dim' ? DIM_EDGE_OPACITY : 1,
  };
}

function EdgeCaption({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <EdgeLabelRenderer>
      <div className="rf-edge-label nopan" style={{ transform: `translate(-50%, -130%) translate(${x}px,${y}px)` }}>{text}</div>
    </EdgeLabelRenderer>
  );
}

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

/** What a flow-handle drop landed on. An empty miss changes nothing. */
function flowDropAt(project: Project, x: number, y: number): { kind: 'empty' } | { kind: 'unit'; id: string } | { kind: 'other' } {
  const el = (document.elementFromPoint?.(x, y) ?? null) as Element | null;
  if (!el) return { kind: 'empty' };
  const handleId = el.closest?.('[data-flow-handle]')?.getAttribute('data-flow-handle') ?? '';
  if (handleId && project.units.some((u) => u.id === handleId)) return { kind: 'unit', id: handleId };
  const node = el.closest?.('.react-flow__node');
  const id = node?.getAttribute('data-id') ?? '';
  if (id && project.units.some((u) => u.id === id)) return { kind: 'unit', id };
  // A Device is drawn on its Unit. Dropping there connects that Unit.
  const device = project.devices.find((d) => d.id === id);
  if (device) return { kind: 'unit', id: device.unitId };
  if (id) return { kind: 'other' };
  return { kind: 'empty' };
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
      data-jump={`unit:${d.unitId}`}
      className={`rf-unit nopan${d.selected || d.from ? ' is-sel' : ''}${d.off ? ' is-off' : ''}${d.overlap ? ' is-overlap' : ''}${d.flowFrom ? ' is-flow-from' : ''}${d.flowTarget ? ' is-flow-target' : ''}${d.paused ? ' is-paused' : ''}${d.tone}`}
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
        <span className={`rf-unit-name${d.nameHidden ? ' is-culled' : ''}`} style={{ fontSize: d.nameFont }} title={d.nameTitle}>{d.nameShown}</span>
        {d.showPause && d.paused && <span className="rf-paused-word" data-unit-paused={d.unitId}>일시정지</span>}
        <span className="rf-unit-meta">{d.meta}</span>
      </div>
      {d.positionLocked && <UnitLockMark unitId={d.unitId} />}
      <Handle type="target" position={Position.Left} id="flow-in" isConnectable={false} isConnectableStart={false} isConnectableEnd={false}
        className="rf-flow-anchor" style={{ top: '50%', left: 0, right: 'auto', transform: 'translate(-50%, -50%)' }} />
      <Handle type="source" position={Position.Right} id="flow-out" isConnectable={false} isConnectableStart={false} isConnectableEnd={false}
        className="rf-flow-anchor" style={{ top: '50%', right: 0, left: 'auto', transform: 'translate(50%, -50%)' }} />
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
      data-jump={`device:${dev.id}`}
      className={`rf-device nopan${d.selected ? ' is-sel' : ''}${d.fault ? ' is-fault' : d.paused ? ' is-paused' : d.active ? ' is-active' : ''}${d.off ? ' is-off' : ''}${d.portsOff ? ' ports-off' : ''}${d.tone}`}
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
      {d.showStatus && (d.fault || d.paused || d.active) && <div className="rf-run-mark"><StatusMark status={d.fault ? 'error' : d.paused ? 'assumption' : 'active'} word={d.paused ? '일시정지' : undefined} />{d.interlock && <span className="rf-interlock-word">Interlock</span>}</div>}
      <div className={`rf-dev-name${d.nameHidden ? ' is-culled' : ''}`} title={d.nameTitle}>{d.nameShown}</div>
      {d.portLabels.map((port) => <span key={port.id} className={`rf-port-name ${port.side}`} style={{ top: port.top }} title={port.title}>{port.text}</span>)}
      {d.photo && <div className={`rf-photo-note ${photo?.status === 'available' ? 'ok' : 'miss'}`}>{photo?.status === 'available' ? `${AI_BADGE} 실사풍·실제 사진 아님` : 'AI 이미지 미준비→도식'}</div>}
      {d.showPositions && d.positions.length > 0 && (
        <svg className="rf-positions" width={dev.layout.w} height={dev.layout.h + 24} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}>
          {d.positions.map((ps, i) => {
            const x = ((i + 1) * dev.layout.w) / (d.positions.length + 1);
            const y = dev.layout.h + 4;
            return <g key={ps.id}><path d={`M${x} ${y} l-4 7 l8 0 z`} fill={ps.current ? 'var(--accent)' : 'none'} stroke={ps.assumption ? 'var(--status-assumption)' : 'var(--text)'} /><text x={x} y={y + 16} fontSize={8} textAnchor="middle" fill={ps.assumption ? 'var(--status-assumption)' : 'var(--text)'}>{ps.name}{ps.assumption ? ` ${STATUS.assumption.mark} ${STATUS.assumption.word}` : ''}</text></g>;
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
    <div className={`rf-mat nopan${d.waiting ? ' is-waiting' : ''}`} data-waiting={d.waiting ? 'true' : 'false'} data-piece={d.pieceId ?? ''}>
      <div className="rf-mat-box" />
      <div className="rf-mat-label">{d.label}</div>
    </div>
  );
}

function FlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, data }: EdgeProps) {
  const d = data as EdgeView | undefined;
  const tone = d?.tone ?? 'plain';
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 8 });
  const paint = edgePaint('flow', tone, !!selected, 'var(--text)');
  const markerId = `flow-arrow-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const show = !!selected || !!d?.hover;
  return (
    <>
      <defs>
        <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L10 5 L0 10 Z" fill={paint.stroke} opacity={paint.opacity} />
        </marker>
      </defs>
      <BaseEdge id={id} path={path} markerEnd={`url(#${markerId})`} style={paint} />
      {show && d?.caption ? <EdgeCaption x={labelX} y={labelY} text={d.caption} /> : null}
    </>
  );
}

function SignalEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, data }: EdgeProps) {
  const d = data as EdgeView | undefined;
  const tone = d?.tone ?? 'plain';
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const on = !!d?.on && !selected && tone !== 'dim';
  const paint = edgePaint('signal', tone, !!selected, on ? 'var(--success)' : 'var(--muted)');
  const show = !!selected || !!d?.hover;
  return (
    <>
      <BaseEdge id={id} path={path} className={on ? 'rf-sig-on' : undefined} style={{ ...paint, strokeDasharray: '5 4' }} />
      {show && d?.caption ? <EdgeCaption x={labelX} y={labelY} text={d.caption} /> : null}
    </>
  );
}

function FlowCanvas(props: Props) {
  const { project: p, rt, view, selection, mode, connectFrom, frame = 'layout' } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const { screenToFlowPosition, zoomTo, fitView, getViewport, getNodes, setViewport } = useReactFlow();
  const flowRef = useRef(screenToFlowPosition);
  flowRef.current = screenToFlowPosition;
  const dragRef = useRef<{ ids: string[]; sx: number; sy: number; origin: string } | null>(null);
  const abortRef = useRef(false);
  const flowDragRef = useRef<{ fromId: string; x: number; y: number; sx: number; sy: number } | null>(null);
  const flowListeners = useRef<(() => void) | null>(null);
  const [flowDrag, setFlowDrag] = useState<{ fromId: string; x: number; y: number } | null>(null);
  const { x: vpX, y: vpY, zoom: vpZoom } = useViewport();
  const [preview, setPreview] = useState<{ ids: string[]; dx: number; dy: number } | null>(null);
  const [resizePreview, setResizePreview] = useState<{ id: string; w: number; h: number } | null>(null);
  const [dragFrom, setDragFrom] = useState<string | null>(null);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [band, setBand] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const bandListeners = useRef<(() => void) | null>(null);
  const bandLive = useRef(false);
  const skipPaneClear = useRef(false);
  const store = useStoreApi();
  const L = view.layers;

  useEffect(() => () => { bandListeners.current?.(); bandLive.current = false; flowListeners.current?.(); }, []);

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
      if (flowDragRef.current) {
        flowDragRef.current = null;
        setFlowDrag(null);
        flowListeners.current?.();
        flowListeners.current = null;
      }
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
      if (e.button !== 0) return;
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
      hostRef.current?.focus({ preventScroll: true });
      const have = modelIds(cur.selection);
      const next = pointerSelection(have, id, e);
      cur.onSelect(next.ids, false);
      // Ctrl/Cmd click that removes the node must not drag whatever is still selected.
      if (!next.drag) { dragRef.current = null; return; }
      if (cur.locked) { cur.onBlocked(BLOCKED); return; }
      const lockedUnit = (nodeId: string) => cur.project.units.some((u) => u.id === nodeId && u.positionLocked === true);
      if (lockedUnit(id)) { dragRef.current = null; return; }
      const dragIds = next.ids.filter((nodeId) => !lockedUnit(nodeId));
      if (!dragIds.length) { dragRef.current = null; return; }
      const pt = flowRef.current({ x: e.clientX, y: e.clientY });
      dragRef.current = { ids: dragIds, sx: pt.x, sy: pt.y, origin: id };
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

  const endFlowDrag = (ev: PointerEvent | null, commit: boolean) => {
    const d = flowDragRef.current;
    if (!d && !flowListeners.current) return;
    flowDragRef.current = null;
    setFlowDrag(null);
    const detach = flowListeners.current;
    flowListeners.current = null;
    detach?.();
    if (!commit || !ev || !d) return;
    if (Math.abs(ev.clientX - d.sx) + Math.abs(ev.clientY - d.sy) < 3) return;
    const cur = propsRef.current;
    if (cur.locked) { cur.onBlocked(EDIT_LOCKED); return; }
    const hit = flowDropAt(cur.project, ev.clientX, ev.clientY);
    if (hit.kind === 'empty') return;
    if (hit.kind === 'other') { cur.onBlocked(FLOW_UNIT_ONLY); return; }
    cur.onFlowConnect(d.fromId, hit.id);
  };

  const startFlow = (e: React.PointerEvent, unitId: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const cur = propsRef.current;
    if (cur.locked) { cur.onBlocked(EDIT_LOCKED); return; }
    flowListeners.current?.();
    const origin = { fromId: unitId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY };
    flowDragRef.current = origin;
    const move = (ev: PointerEvent) => {
      const live = flowDragRef.current;
      if (!live) return;
      const next = { ...live, x: ev.clientX, y: ev.clientY };
      flowDragRef.current = next;
      if (Math.abs(next.x - next.sx) + Math.abs(next.y - next.sy) < 1) return;
      setFlowDrag({ fromId: next.fromId, x: next.x, y: next.y });
    };
    const up = (ev: PointerEvent) => endFlowDrag(ev, true);
    const cancel = () => endFlowDrag(null, false);
    const detach = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
    flowListeners.current = detach;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  };

  const off = (id: string, unitId?: string) => {
    if (!preview) return { dx: 0, dy: 0 };
    if (preview.ids.includes(id) || (unitId && preview.ids.includes(unitId))) return preview;
    return { dx: 0, dy: 0 };
  };

  const activeDevice = rt?.active ? p.actions.find((a) => a.id === p.sequence.steps[rt.active!.stepIndex]?.actionId)?.deviceId : undefined;
  const pieceDevices = new Set((rt?.pieces ?? []).flatMap((pc) => {
    if (!pc.active) return [];
    const step = p.sequence.steps[pc.active.stepIndex];
    const action = step ? p.actions.find((a) => a.id === step.actionId) : undefined;
    return action ? [action.deviceId] : [];
  }));
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
  const focus = graphFocus({
    selection,
    units: p.units.map((u) => ({ id: u.id })),
    devices: p.devices.map((d) => ({ id: d.id, unitId: d.unitId })),
    connections: p.connections.map((c) => ({ id: c.id, kind: c.kind, from: c.from.nodeId, to: c.to.nodeId })),
  });
  const toneOf = (id: string) => (focus.active ? (focus.hotNodes.has(id) ? ' is-focus' : ' is-quiet') : '');
  const captionOf = (c: (typeof p.connections)[number]) => {
    if (c.kind === 'flow') {
      const a = p.units.find((u) => u.id === c.from.nodeId);
      const b = p.units.find((u) => u.id === c.to.nodeId);
      return flowCaption(a?.name ?? c.from.nodeId, b?.name ?? c.to.nodeId);
    }
    const fromDev = p.devices.find((d) => d.id === c.from.nodeId);
    const toDev = p.devices.find((d) => d.id === c.to.nodeId);
    const fromSig = p.signals.find((s) => s.id === c.from.signalId);
    const toSig = p.signals.find((s) => s.id === c.to.signalId);
    const fromName = fromDev?.name ?? c.from.nodeId;
    const toName = toDev?.name ?? c.to.nodeId;
    return signalCaption(fromName, portWord(fromName, fromSig?.name, fromSig?.portKey), toName, portWord(toName, toSig?.name, toSig?.portKey));
  };
  const pausedUnits = new Set(pausedUnitIds(rt));
  const pausedDevices = new Set(pausedDeviceIds(p, rt));
  const nameFont = unitNameFontPx(vpZoom);
  const sx = (x: number) => x * vpZoom + vpX;
  const sy = (y: number) => y * vpZoom + vpY;
  const diagramLabels: DiagramLabel[] = [];
  for (const u of p.units) {
    const box = boxes.find((b) => b.id === u.id)!;
    const short = u.name.replace(new RegExp(`^${u.code}\\s*`), '') || u.name;
    diagramLabels.push({
      id: `unit:${u.id}`, kind: 'unit', fullText: short, selected: selection.includes(u.id), alert: false,
      x: sx(box.x + 36), y: sy(box.y + 6), w: Math.max(28, short.length * 12 * vpZoom), h: 16 * vpZoom,
    });
    if (pausedUnits.has(u.id)) {
      diagramLabels.push({
        id: `status:${u.id}`, kind: 'status', fullText: '일시정지', selected: false, alert: true,
        x: sx(box.x + box.w - 72), y: sy(box.y + 6), w: 64 * vpZoom, h: 16 * vpZoom,
      });
    }
  }
  for (const d of p.devices) {
    const o = off(d.id, d.unitId);
    const x = d.layout.x + o.dx;
    const y = d.layout.y + o.dy;
    const alert = !!props.faultDeviceIds?.includes(d.id) || pausedDevices.has(d.id);
    diagramLabels.push({
      id: `device:${d.id}`, kind: 'device', fullText: d.name, selected: selection.includes(d.id), alert,
      x: sx(x), y: sy(y + d.layout.h + 2), w: Math.max(28, d.name.length * 11 * vpZoom), h: 14 * vpZoom,
    });
    if (alert || activeDevice === d.id || pieceDevices.has(d.id) || !!props.activeDeviceIds?.includes(d.id)) {
      const word = props.faultDeviceIds?.includes(d.id) ? '오류' : pausedDevices.has(d.id) ? '일시정지' : '진행 중';
      diagramLabels.push({
        id: `status:${d.id}`, kind: 'status', fullText: word, selected: false, alert,
        x: sx(x), y: sy(y - 18), w: 72 * vpZoom, h: 16 * vpZoom,
      });
    }
    const signals = p.signals.filter((s) => s.deviceId === d.id);
    const ins = signals.filter((s) => s.direction === 'in');
    const outs = signals.filter((s) => s.direction === 'out');
    for (const s of signals) {
      const list = s.direction === 'in' ? ins : outs;
      const word = portWord(d.name, s.name, s.portKey);
      diagramLabels.push({
        id: `port:${s.id}`, kind: 'port', fullText: word, selected: false, alert: false,
        x: sx(x + (s.direction === 'in' ? -4 : d.layout.w - 36)), y: sy(y + portTop(list, s, d.layout.h) - 6),
        w: Math.max(24, word.length * 8 * vpZoom), h: 12 * vpZoom,
      });
    }
  }
  const placed = new Map(layoutDiagramLabels(vpZoom, diagramLabels, true).map((label) => [label.id, label]));
  const shown = (id: string, fallback: string): PlacedLabel => placed.get(id) ?? {
    id, kind: 'device', x: 0, y: 0, w: 0, h: 0, text: fallback, fullText: fallback, hidden: false, title: fallback,
  };
  const nodes: Node[] = [];
  for (const u of p.units) {
    const box = boxes.find((b) => b.id === u.id)!;
    const short = u.name.replace(new RegExp(`^${u.code}\\s*`), '');
    const unitLabel = shown(`unit:${u.id}`, short);
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
        off: !L.units, overlap: overlap.has(u.id), tone: toneOf(u.id),
        flowFrom: flowDrag?.fromId === u.id,
        flowTarget: !!flowDrag && flowDrag.fromId !== u.id && !p.connections.some((c) => c.kind === 'flow' && c.from.nodeId === flowDrag.fromId && c.to.nodeId === u.id),
        showResize: selected && mode === 'select' && !props.locked && L.units && u.positionLocked !== true,
        minW: min.w, minH: min.h, api, paused: pausedUnits.has(u.id), positionLocked: u.positionLocked === true,
        nameShown: unitLabel.text, nameTitle: unitLabel.title, nameHidden: unitLabel.hidden,
        nameFont, showPause: pausedUnits.has(u.id) && shown(`status:${u.id}`, '일시정지').hidden === false,
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
    const devLabel = shown(`device:${d.id}`, d.name);
    const devSignals = p.signals.filter((s) => s.deviceId === d.id);
    const devIns = devSignals.filter((s) => s.direction === 'in');
    const devOuts = devSignals.filter((s) => s.direction === 'out');
    nodes.push({
      id: d.id, type: 'device', zIndex: selection.includes(d.id) ? 6 : 3,
      position: { x: d.layout.x + o.dx, y: d.layout.y + o.dy },
      width: d.layout.w, height: d.layout.h, measured: { width: d.layout.w, height: d.layout.h },
      draggable: false, selectable: false, connectable: !props.locked, deletable: false,
      className: 'nopan',
      data: {
        device: d, selected: selection.includes(d.id), off: axisOff, portsOff: !L.io || axisOff, locked: props.locked, tone: toneOf(d.id),
        active: activeDevice === d.id || pieceDevices.has(d.id) || !!props.activeDeviceIds?.includes(d.id),
        fault: !!props.faultDeviceIds?.includes(d.id),
        interlock: !!props.interlockDeviceIds?.includes(d.id),
        paused: pausedDevices.has(d.id),
        extended: d.kind === 'cylinder' ? sigOn(d.id, 'cmdFwd') || sigOn(d.id, 'fwdDone')
          : d.kind === 'pusher' ? sigOn(d.id, 'cmdPush') || sigOn(d.id, 'pushDone')
          : d.kind === 'gantry' ? (rt?.devicePositions?.[d.id] ?? null) !== null || sigOn(d.id, 'cmdMove') : false,
        raised: d.kind === 'stopper' && (sigOn(d.id, 'upDone') || sigOn(d.id, 'cmdUp')),
        holding: rt?.pieces && rt.pieces.length > 1
          ? rt.pieces.some((pc) => pc.material.holder === d.id)
          : rt?.material?.holder === d.id,
        photo: view.visualMode === 'photo',
        signals: devSignals, onIds, positions, showPositions: L.positions,
        mode, link, api,
        nameShown: devLabel.text, nameTitle: devLabel.title, nameHidden: devLabel.hidden,
        showStatus: shown(`status:${d.id}`, '').hidden === false,
        portLabels: devSignals.flatMap((s) => {
          const row = shown(`port:${s.id}`, portWord(d.name, s.name, s.portKey));
          if (row.hidden) return [];
          const list = s.direction === 'in' ? devIns : devOuts;
          return [{ id: s.id, text: row.text, title: row.title, top: portTop(list, s, d.layout.h), side: s.direction }];
        }),
      } satisfies DeviceData,
    });
  }

  for (const mat of materialMarkers(p, rt, off)) {
    if (!L.flow) break;
    nodes.push({
      id: mat.id, type: 'material', zIndex: 8,
      position: { x: mat.x - 11, y: mat.y - 11 },
      width: 22, height: 22, measured: { width: 22, height: 22 },
      draggable: false, selectable: false, connectable: false, deletable: false, focusable: false,
      className: 'nopan',
      style: { pointerEvents: 'none' },
      data: { label: mat.label, waiting: mat.waiting, pieceId: mat.pieceId } satisfies MatData,
    });
  }

  const edgeClass = (kind: 'flow' | 'signal', id: string) => {
    const tone = edgeTone(focus, id);
    return `nopan ${kind === 'flow' ? 'rf-edge-flow' : 'rf-edge-sig'}${tone === 'hot' ? ' is-hot' : tone === 'dim' ? ' is-dim' : ''}`;
  };
  const edges: Edge[] = [];
  if (L.flow) {
    for (const c of p.connections) if (c.kind === 'flow') {
      edges.push({
        id: c.id, type: 'flow', source: c.from.nodeId, target: c.to.nodeId, sourceHandle: 'flow-out', targetHandle: 'flow-in',
        selected: selection.includes(c.id), selectable: true, deletable: false, zIndex: edgeTone(focus, c.id) === 'hot' ? 4 : 3,
        className: edgeClass('flow', c.id),
        data: { tone: edgeTone(focus, c.id), caption: captionOf(c), hover: hoverEdge === c.id } satisfies EdgeView,
      });
    }
  }
  if (L.io) {
    for (const c of p.connections) if (c.kind === 'signal' && c.from.signalId && c.to.signalId) {
      edges.push({
        id: c.id, type: 'signal', source: c.from.nodeId, target: c.to.nodeId, sourceHandle: c.from.signalId, targetHandle: c.to.signalId,
        selected: selection.includes(c.id), selectable: true, deletable: false, zIndex: edgeTone(focus, c.id) === 'hot' ? 4 : 3,
        className: edgeClass('signal', c.id),
        data: { on: !!rt?.signals?.[c.from.signalId], tone: edgeTone(focus, c.id), caption: captionOf(c), hover: hoverEdge === c.id } satisfies EdgeView,
      });
    }
  }

  const placeFitted = useCallback((vp: Viewport) => {
    const nodes = getNodes();
    if (!nodes.length) return vp;
    const minX = Math.min(...nodes.map((n) => n.position.x));
    let next = leftAlignedViewport(vp, FIT_MIN_ZOOM, minX, FIT_LEFT);
    const legend = legendInPane(hostRef.current);
    if (legend) {
      const units = nodes.filter((n) => n.type === 'unit').map((n) => ({
        x: n.position.x,
        y: n.position.y,
        w: n.width ?? n.measured?.width ?? (n.data as { w?: number }).w ?? 0,
      }));
      next = clearLegendViewport(next, units, legend);
    }
    return next;
  }, [getNodes]);

  const alignLeftIfMin = useCallback(() => {
    const vp = getViewport();
    const next = placeFitted(vp);
    if (Math.abs(next.x - vp.x) < 0.5 && Math.abs(next.y - vp.y) < 0.5) return;
    void setViewport(next, { duration: 0 });
  }, [getViewport, placeFitted, setViewport]);

  const fitCanvas = useCallback(async () => {
    // Insets clear the 28px legend, 28px controls, and 160×110 minimap. Panel margin is 15px.
    await fitView({ padding: FIT_PADDING, duration: 0, minZoom: FIT_MIN_ZOOM, maxZoom: 2 });
    alignLeftIfMin();
  }, [fitView, alignLeftIfMin]);

  const userAdjusted = useRef(false);
  const fitting = useRef(false);
  const fittedVp = useRef<Viewport | null>(null);
  const lastSize = useRef({ width: 0, height: 0 });
  const setViewportRef = useRef(setViewport);
  setViewportRef.current = setViewport;
  const getViewportRef = useRef(getViewport);
  getViewportRef.current = getViewport;

  const minimapOpen = frame === 'run' ? view.minimap.run : view.minimap.layout;
  const minimapRef = useRef(minimapOpen);
  minimapRef.current = minimapOpen;

  const fitRunTo = useCallback((width: number, height: number) => {
    if (width <= 40 || height <= 40) return;
    const bounds = unionBounds(runEquipmentBoxes(propsRef.current.project, propsRef.current.rt));
    if (!bounds) return;
    const units = propsRef.current.project.units.map((u) => ({ x: u.layout.x, y: u.layout.y, w: u.layout.w }));
    const legend = legendInPane(hostRef.current);
    const planned = runPlanViewport(bounds, width, height, runFitPad(minimapRef.current));
    const vp = legend ? clearLegendViewport(planned, units, legend) : planned;
    fitting.current = true;
    userAdjusted.current = false;
    void setViewportRef.current(vp, { duration: 0 }).then(() => {
      fittedVp.current = getViewportRef.current();
      fitting.current = false;
    });
  }, []);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof ResizeObserver === 'undefined' || frame === 'run') return;
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
  }, [frame, fitCanvas]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof ResizeObserver === 'undefined' || frame !== 'run') return;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      lastSize.current = { width: box.width, height: box.height };
      if (userAdjusted.current) return;
      fitRunTo(box.width, box.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [frame, fitRunTo]);

  useEffect(() => {
    if (frame === 'run') return;
    const vp = getViewport();
    if (Math.abs(vp.zoom - view.zoom) < 0.001) return;
    void zoomTo(view.zoom, { duration: 0 });
  }, [frame, view.zoom, getViewport, zoomTo]);

  const noteUserViewport = useCallback((_event: MouseEvent | TouchEvent | null, vp: Viewport) => {
    // Zoom buttons call into the viewport with a null event. A drift from the last fit is the user's view.
    if (propsRef.current.frame !== 'run' || fitting.current) return;
    const fitted = fittedVp.current;
    if (!fitted) return;
    const drifted = Math.abs(vp.x - fitted.x) >= 1 || Math.abs(vp.y - fitted.y) >= 1 || Math.abs(vp.zoom - fitted.zoom) >= 0.002;
    if (drifted) userAdjusted.current = true;
  }, []);

  const onMove = useCallback((event: MouseEvent | TouchEvent | null, vp: Viewport) => {
    if (propsRef.current.frame === 'run') {
      noteUserViewport(event, vp);
      return;
    }
    const z = Math.min(2, Math.max(0.5, vp.zoom));
    if (Math.abs(z - propsRef.current.view.zoom) < 0.001) return;
    propsRef.current.onZoomChange?.(z);
  }, [noteUserViewport]);

  const onMoveStart = useCallback((event: MouseEvent | TouchEvent | null, vp: Viewport) => {
    noteUserViewport(event, vp);
  }, [noteUserViewport]);

  const fittedToken = useRef(0);
  useEffect(() => {
    const token = props.fitToken ?? 0;
    if (!token || token === fittedToken.current) return;
    fittedToken.current = token;
    if (propsRef.current.frame === 'run') {
      const rect = hostRef.current?.getBoundingClientRect();
      const width = rect && rect.width > 40 ? rect.width : lastSize.current.width;
      const height = rect && rect.height > 40 ? rect.height : lastSize.current.height;
      fitRunTo(width, height);
      return;
    }
    void fitCanvas();
  }, [props.fitToken, fitCanvas, fitRunTo]);

  const onRunFitClick = () => {
    const el = hostRef.current;
    const rect = el?.getBoundingClientRect();
    const width = rect && rect.width > 40 ? rect.width : lastSize.current.width;
    const height = rect && rect.height > 40 ? rect.height : lastSize.current.height;
    fitRunTo(width, height);
  };

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
    if (t.closest('.react-flow__node, .react-flow__edge, .react-flow__handle, .react-flow__controls, .react-flow__minimap, .rf-legend, .rf-connect-note, .react-flow__attribution, .react-flow__panel, [data-flow-handle], [data-diagram-bg]')) return;
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
  const openContext = (e: React.MouseEvent) => {
    const cur = propsRef.current;
    if (!cur.onContextMenu) return;
    const t = e.target as HTMLElement;
    if (isTextField(t)) return;
    e.preventDefault();
    if (t.closest('.react-flow__controls, .react-flow__minimap, .rf-legend, .rf-minimap-toggle, .rf-run-fit, .react-flow__attribution, .react-flow__panel')) return;
    const focus = document.activeElement instanceof HTMLElement ? document.activeElement : hostRef.current;
    const surface = cur.frame === 'run' ? 'run' : 'diagram';
    const at = { x: e.clientX, y: e.clientY, surface, focus } as const;
    const handleId = t.closest('[data-flow-handle]')?.getAttribute('data-flow-handle') ?? '';
    if (handleId) { cur.onContextMenu({ ...at, hit: { kind: 'unit', id: handleId } }); return; }
    const node = t.closest('.react-flow__node');
    const nodeId = node?.getAttribute('data-id') ?? '';
    if (nodeId && cur.project.units.some((u) => u.id === nodeId)) { cur.onContextMenu({ ...at, hit: { kind: 'unit', id: nodeId } }); return; }
    if (nodeId && cur.project.devices.some((d) => d.id === nodeId)) { cur.onContextMenu({ ...at, hit: { kind: 'device', id: nodeId } }); return; }
    const edge = t.closest('.react-flow__edge');
    const edgeId = edge?.getAttribute('data-id') ?? '';
    if (edgeId) { cur.onContextMenu({ ...at, hit: { kind: 'edge', id: edgeId } }); return; }
    cur.onContextMenu({ ...at, hit: { kind: 'empty' } });
  };
  const hostBox = hostRef.current?.getBoundingClientRect();
  // The line starts at the handle (right-center of the source unit) and ends at the pointer.
  const previewLine = (() => {
    if (!flowDrag || !hostBox) return null;
    const src = p.units.find((u) => u.id === flowDrag.fromId);
    if (!src) return null;
    const o = off(src.id);
    const x = src.layout.x + o.dx;
    const y = src.layout.y + o.dy;
    const rz = resizePreview?.id === src.id ? resizePreview : null;
    const w = rz?.w ?? src.layout.w;
    const h = rz?.h ?? src.layout.h;
    return {
      x1: x * vpZoom + vpX + w * vpZoom,
      y1: y * vpZoom + vpY + (h * vpZoom) / 2,
      x2: flowDrag.x - hostBox.left,
      y2: flowDrag.y - hostBox.top,
    };
  })();
  return (
    <div ref={hostRef} className="rf-host" tabIndex={-1} data-mode={mode} data-frame={frame} data-focus={focus.active ? '1' : '0'} data-minimap={minimapOpen ? 'open' : 'closed'} data-linking={link ? '1' : '0'} data-flow-drag={flowDrag ? '1' : '0'} data-label-tier={zoomTier(vpZoom)} onPointerDownCapture={onBandDown} onContextMenuCapture={openContext} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onMove={onMove}
        onMoveStart={onMoveStart}
        onNodeClick={() => undefined /* NodeWrapper turns pointer events on only when a click handler exists. Selection stays on pointerdown. */}
        onEdgeClick={(_, edge) => propsRef.current.onSelect([edge.id], false)}
        onEdgeMouseEnter={(_, edge) => setHoverEdge(edge.id)}
        onEdgeMouseLeave={() => setHoverEdge(null)}
        onPaneClick={(e) => {
          if (skipPaneClear.current) { skipPaneClear.current = false; return; }
          const t = e.target as HTMLElement;
          if (t.closest('.react-flow__node, .react-flow__edge, .react-flow__handle, .react-flow__controls, .react-flow__minimap, .rf-legend, .rf-connect-note, .react-flow__attribution')) return;
          if (propsRef.current.mode === 'select') propsRef.current.onSelect([], false);
        }}
        defaultViewport={{ x: 0, y: 0, zoom: view.zoom }}
        minZoom={frame === 'run' ? RUN_FIT_MIN_ZOOM : 0.5}
        maxZoom={frame === 'run' ? RUN_FIT_MAX_ZOOM : 2}
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
        {frame === 'layout' && L.background && readDiagramBackground(p) && (
          <DiagramBackground
            bg={readDiagramBackground(p)!}
            editLocked={props.locked}
            picking={!!props.backgroundPicking}
            onMove={(x, y) => propsRef.current.onBackgroundMove?.(x, y)}
            onPoint={(px, py) => propsRef.current.onBackgroundPoint?.(px, py)}
          />
        )}
        <Controls showInteractive={false} showFitView={frame !== 'run'} position="bottom-left" className="nopan" aria-label="도면 확대 축소"
          fitViewOptions={{ padding: FIT_PADDING, duration: 0, minZoom: FIT_MIN_ZOOM, maxZoom: 2 }}
          onFitView={() => { requestAnimationFrame(() => requestAnimationFrame(() => alignLeftIfMin())); }} />
        {frame === 'run' && (
          <Panel position="top-right" className="rf-run-fit nopan">
            <button type="button" className="small" onClick={onRunFitClick}>화면 맞춤</button>
          </Panel>
        )}
        {minimapOpen && (
          <MiniMap
            className="nopan"
            position="bottom-right"
            pannable
            zoomable
            style={{ width: MINIMAP_W, height: MINIMAP_H }}
            bgColor={pal.panel}
            maskColor={hexAlpha(pal.canvas, 0.7)}
            nodeStrokeWidth={0}
            nodeColor={(n) => n.type === 'unit' ? pal.selected : n.type === 'device' ? pal.muted : pal.warning}
            ariaLabel="도면 미니맵"
          />
        )}
        <Panel position="bottom-right" className="rf-minimap-toggle nopan">
          <button
            type="button"
            className="small"
            aria-pressed={minimapOpen}
            aria-label={minimapOpen ? '미니맵 접기' : '미니맵 펼치기'}
            onClick={() => propsRef.current.onMinimapChange?.(frame, !minimapOpen)}
          >{minimapOpen ? <IconLabel id="fold">접기</IconLabel> : <IconLabel id="minimap">미니맵</IconLabel>}</button>
        </Panel>
        {props.connectNote && <Panel position="top-left" className="notice rf-connect-note nopan" style={{ position: 'absolute', top: 48, pointerEvents: 'none' }}>{props.connectNote}</Panel>}
        <Panel position="top-left" className="rf-legend nopan" title={`배경: 격자 · 배경 도면은 있으면 레이어와 함께 · 배경 없이도 동작 · Shift + 끌기: 여러 개 고르기 · ${SELECT_HINT}`}>
          <div><svg width="22" height="8" aria-hidden="true"><line x1="0" y1="4" x2="14" y2="4" stroke="var(--text)" strokeWidth="2" /><path d="M12 1 L20 4 L12 7 Z" fill="var(--text)" /></svg>자재 흐름(물류)</div>
          <div><svg width="22" height="8" aria-hidden="true"><line x1="0" y1="4" x2="22" y2="4" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="5 4" /></svg>논리 신호 (out●→in○)</div>
          <div><svg width="12" height="8" aria-hidden="true"><path d="M6 0 L2 8 L10 8 Z" fill="none" stroke="var(--warning)" /></svg>Position</div>
          <div><svg width="12" height="8" aria-hidden="true"><rect x="1" y="0" width="10" height="8" fill="var(--warning)" fillOpacity={0.2} stroke="var(--warning)" /></svg>자재(런타임 개체)</div>
        </Panel>
      </ReactFlow>
      {L.units && (
        <div className="rf-flow-handles">
          {p.units.map((u) => {
            const box = boxes.find((b) => b.id === u.id)!;
            const left = box.x * vpZoom + vpX + box.w * vpZoom;
            const top = box.y * vpZoom + vpY + (box.h * vpZoom) / 2;
            return (
              <div
                key={u.id}
                className={`rf-flow-handle${flowDrag?.fromId === u.id ? ' is-from' : ''}`}
                data-flow-handle={u.id}
                role="button"
                tabIndex={-1}
                aria-label={`${u.code} 물류 손잡이`}
                title="다른 Unit으로 끌어 물류 연결"
                style={{ left, top }}
                onPointerDown={(e) => startFlow(e, u.id)}
              />
            );
          })}
        </div>
      )}
      {previewLine && (
        <svg className="rf-flow-preview" data-testid="flow-preview" data-from={flowDrag?.fromId ?? ''}>
          <defs>
            <marker id="rf-flow-preview-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0 L10 5 L0 10 Z" fill="currentColor" />
            </marker>
          </defs>
          <line data-testid="flow-preview-line" x1={previewLine.x1} y1={previewLine.y1} x2={previewLine.x2} y2={previewLine.y2} markerEnd="url(#rf-flow-preview-arrow)" />
        </svg>
      )}
      {band && <div className="rf-marquee" data-testid="marquee" style={{ left: band.left, top: band.top, width: band.width, height: band.height }} />}
    </div>
  );
}

function materialMarkers(p: Project, rt: RuntimeState | null, off: (id: string, unitId?: string) => { dx: number; dy: number }): { id: string; x: number; y: number; label: string; waiting: boolean; pieceId?: string }[] {
  if (rt?.pieces && rt.pieces.length > 1) {
    const live = rt.pieces.filter((pc) => pc.phase !== 'queued' && pc.material.location !== 'EXIT' && pc.material.location !== '');
    const byUnit = new Map<string, typeof live>();
    for (const pc of live) {
      const list = byUnit.get(pc.material.location) ?? [];
      list.push(pc);
      byUnit.set(pc.material.location, list);
    }
    const out: { id: string; x: number; y: number; label: string; waiting: boolean; pieceId?: string }[] = [];
    for (const pc of live) {
      const mates = byUnit.get(pc.material.location) ?? [pc];
      const i = mates.indexOf(pc);
      const span = Math.max(1, mates.length - 1);
      const shift = mates.length > 1 ? (i - span / 2) * 26 : 0;
      let pos = unitAnchor(p, off, pc.material.location as string | 'EXIT');
      if (pc.material.holder) {
        const d = p.devices.find((x) => x.id === pc.material.holder);
        if (d) { const o = off(d.id, d.unitId); pos = { x: d.layout.x + o.dx + d.layout.w / 2, y: d.layout.y + o.dy + d.layout.h + 10 }; }
      }
      if (pc.active && !pc.active.hold && pc.active.completeAtMs !== null) {
        const step = p.sequence.steps[pc.active.stepIndex];
        const a = p.actions.find((x) => x.id === step?.actionId);
        if (a?.effect.moveTo && a.duration.value && pos) {
          const to = a.effect.moveTo === 'EXIT' ? unitAnchor(p, off, 'EXIT') : unitAnchor(p, off, a.effect.moveTo);
          const f = Math.min(1, Math.max(0, (rt.timeMs - pc.active.startMs) / (a.duration.value * 1000)));
          if (to) pos = { x: pos.x + (to.x - pos.x) * f, y: pos.y + (to.y - pos.y) * f };
        }
      }
      if (!pos) continue;
      pos = { x: pos.x + shift, y: pos.y };
      out.push({
        id: pc.index === 1 ? 'runtime-material' : `runtime-material-${pc.instanceId}`,
        x: pos.x, y: pos.y,
        label: `${pc.phase === 'waiting' ? `${waitingLead()} · ` : ''}개체 ${pc.index} · ${pc.material.state}`,
        waiting: pc.phase === 'waiting',
        pieceId: pc.instanceId,
      });
    }
    return out;
  }
  const one = materialMarker(p, rt, off);
  return one ? [{ id: 'runtime-material', x: one.x, y: one.y, label: one.label, waiting: false }] : [];
}

function unitAnchor(p: Project, off: (id: string, unitId?: string) => { dx: number; dy: number }, uid: string | 'EXIT') {
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

/** Units, devices, and the runtime material marker. Stage-6 fit uses this box. */
export function runEquipmentBoxes(project: Project, rt: RuntimeState | null): PlanBox[] {
  const boxes: PlanBox[] = [
    ...project.units.map((u) => ({ x: u.layout.x, y: u.layout.y, w: u.layout.w, h: u.layout.h })),
    ...project.devices.map((d) => ({ x: d.layout.x, y: d.layout.y, w: d.layout.w, h: d.layout.h })),
  ];
  for (const mat of materialMarkers(project, rt, () => ({ dx: 0, dy: 0 }))) boxes.push({ x: mat.x - 11, y: mat.y - 11, w: 22, h: 22 });
  return boxes;
}

export function Canvas(props: Props) {
  return (
    <ReactFlowProvider>
      <FlowCanvas {...props} />
    </ReactFlowProvider>
  );
}
