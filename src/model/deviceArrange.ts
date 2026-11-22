// Arrange Devices inside one Unit (TURN-028). Pure: no mutation, no DOM, no layout library.
// Columns follow signal edges (out → in) left to right. A cycle is broken by a depth-first
// walk in model-array order: an edge that returns to a device still on the stack is dropped
// from the column math only. The connection itself is not deleted.
// A device tied to another Unit is pulled to that side's outer column. A device tied to both
// sides keeps the column the internal edges assign. Inside a column, order follows the
// average row of linked devices so signal lines cross less. Devices with no signal sit in
// the remaining cells, in model-array order.
import type { Device, Layout, Project, Unit } from './types';
import { UNIT_DEFAULT_H, UNIT_DEFAULT_W, UNIT_HEADER, UNIT_MIN_W, UNIT_PAD } from './unitLayout';

/** Gap between visual boxes (symbol + ports + name). Same pitch as the Unit inner pad. */
export const DEVICE_ARRANGE_GAP = UNIT_PAD;
/** `.rf-dev-name` is `top: calc(100% + 2px)`. */
export const DEVICE_NAME_GAP = 2;
/** 11px font, line-height 1.2 → 13.2, rounded up so the name is inside the box. */
export const DEVICE_NAME_LINE = 14;
/** `.rf-port` is 16px and centered on the symbol edge, so 8px hangs outside the symbol. */
export const DEVICE_PORT_OUTSET = 8;
/** Empty row kept for a signal that skips a column, so that line has a lane beside the devices. */
const DEVICE_LANE = 28;
const DUMMY = '\0';

export const ARRANGE_DEVICES_NEED_ONE = 'Unit 하나를 고르거나, 한 Unit의 Device만 고르세요';
export const ARRANGE_DEVICES_LOCKED = '실행 중에는 자동 정렬이 차단됩니다';
export const ARRANGE_DEVICES_HINT = '이 Unit 안의 Device를 신호가 왼쪽에서 오른쪽으로 보이게 다시 놓습니다';

export interface Box { x: number; y: number; w: number; h: number }

interface Chrome { padL: number; padR: number; padB: number }

/** ASCII ~7px, anything else ~11px, at the 11px name size. Enough to keep labels from covering a neighbor. */
export function deviceNameWidth(name: string): number {
  let w = 0;
  for (const ch of name) w += (ch.codePointAt(0) ?? 0) <= 0x7f ? 7 : 11;
  return w;
}

export function deviceChrome(device: Device, hasIn: boolean, hasOut: boolean): Chrome {
  const hang = Math.ceil(Math.max(0, deviceNameWidth(device.name) - device.layout.w) / 2);
  return {
    padL: Math.max(hasIn ? DEVICE_PORT_OUTSET : 0, hang),
    padR: Math.max(hasOut ? DEVICE_PORT_OUTSET : 0, hang),
    padB: DEVICE_NAME_GAP + DEVICE_NAME_LINE,
  };
}

/** Symbol plus the name under it and the port circles that hang off the sides. */
export function deviceVisualBox(device: Device, hasIn: boolean, hasOut: boolean): Box {
  const c = deviceChrome(device, hasIn, hasOut);
  return {
    x: device.layout.x - c.padL,
    y: device.layout.y,
    w: device.layout.w + c.padL + c.padR,
    h: device.layout.h + c.padB,
  };
}

type Side = 'left' | 'right' | 'both';

/** One Unit, or only Devices of one Unit. A single selected Unit wins over extra Devices. */
export function arrangeDevicesTarget(p: Project, ids: string[]): { unitId: string } | { reason: string } {
  const unitIds = ids.filter((id) => p.units.some((u) => u.id === id));
  if (unitIds.length === 1) return { unitId: unitIds[0] };
  if (unitIds.length > 1) return { reason: ARRANGE_DEVICES_NEED_ONE };
  if (ids.length > 0 && ids.every((id) => p.devices.some((d) => d.id === id))) {
    const owners = new Set(ids.map((id) => p.devices.find((d) => d.id === id)!.unitId));
    if (owners.size === 1) return { unitId: [...owners][0] };
  }
  return { reason: ARRANGE_DEVICES_NEED_ONE };
}

function centerSide(other: Unit, mine: Unit): 'left' | 'right' | null {
  const oc = other.layout.x * 2 + other.layout.w;
  const mc = mine.layout.x * 2 + mine.layout.w;
  if (oc < mc) return 'left';
  if (oc > mc) return 'right';
  return null;
}

function uniquePairs(edges: [string, string][]): [string, string][] {
  const seen = new Set<string>();
  const out: [string, string][] = [];
  for (const [u, v] of edges) {
    if (u === v) continue;
    const key = `${u}\0${v}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([u, v]);
  }
  return out;
}

/** Drop edges that return to a device still on the stack. Walk starts in model order; targets are tried in model order. */
function breakCycles(order: string[], edges: [string, string][]): [string, string][] {
  const index = new Map(order.map((id, i) => [id, i]));
  const adj = new Map<string, string[]>();
  for (const id of order) adj.set(id, []);
  for (const [u, v] of edges) adj.get(u)?.push(v);
  for (const list of adj.values()) list.sort((a, b) => (index.get(a) ?? 0) - (index.get(b) ?? 0));
  const color = new Map<string, 0 | 1 | 2>();
  const drop = new Set<string>();
  const dfs = (u: string) => {
    color.set(u, 1);
    for (const v of adj.get(u) ?? []) {
      const c = color.get(v) ?? 0;
      if (c === 1) { drop.add(`${u}\0${v}`); continue; }
      if (c === 0) dfs(v);
    }
    color.set(u, 2);
  };
  for (const id of order) if ((color.get(id) ?? 0) === 0) dfs(id);
  return edges.filter(([u, v]) => !drop.has(`${u}\0${v}`));
}

function assignLayers(order: string[], edges: [string, string][], side: Map<string, Side | null>, external: Set<string>): Map<string, number> {
  const linked = order.filter((id) => external.has(id) || edges.some(([u, v]) => u === id || v === id));
  const layer = new Map<string, number>();
  if (!linked.length) return layer;
  if (!edges.length) {
    const groups: string[][] = [[], [], []];
    for (const id of linked) {
      const s = side.get(id);
      // No internal edge: left column, middle (both sides, or the other Unit is not left/right), right column.
      groups[s === 'left' ? 0 : s === 'right' ? 2 : 1].push(id);
    }
    let col = 0;
    for (const group of groups) {
      if (!group.length) continue;
      for (const id of group) layer.set(id, col);
      col += 1;
    }
    return layer;
  }
  for (const id of linked) layer.set(id, 0);
  for (let k = 0; k < linked.length; k++) {
    for (const [u, v] of edges) layer.set(v, Math.max(layer.get(v) ?? 0, (layer.get(u) ?? 0) + 1));
  }
  const succ = new Set(edges.map(([u]) => u));
  const maxL = Math.max(...layer.values());
  for (const id of linked) {
    if (side.get(id) !== 'right' || succ.has(id)) continue;
    layer.set(id, Math.max(layer.get(id) ?? 0, maxL));
  }
  const used = [...new Set(layer.values())].sort((a, b) => a - b);
  const remap = new Map(used.map((v, i) => [v, i]));
  for (const [id, v] of layer) layer.set(id, remap.get(v)!);
  return layer;
}

function orderColumns(
  columns: string[][],
  neighbors: Map<string, string[]>,
  externalCenter2: Map<string, number[]>,
  modelIndex: Map<string, number>,
): void {
  for (let pass = 0; pass < 6; pass++) {
    const rows = new Map<string, number>();
    columns.forEach((col) => col.forEach((id, i) => rows.set(id, i)));
    const forward = pass % 2 === 0;
    for (let step = 0; step < columns.length; step++) {
      const c = forward ? step : columns.length - 1 - step;
      const col = columns[c];
      if (col.length < 2) continue;
      const extAvg = new Map<string, number>();
      const avgs: number[] = [];
      for (const id of col) {
        const ys = externalCenter2.get(id);
        if (!ys?.length) continue;
        const avg = Math.round(ys.reduce((a, b) => a + b, 0) / ys.length);
        extAvg.set(id, avg);
        avgs.push(avg);
      }
      const minE = avgs.length ? Math.min(...avgs) : 0;
      const span = avgs.length ? Math.max(...avgs) - minE : 0;
      const scored = col.map((id) => {
        let sum = 0;
        let count = 0;
        for (const nb of neighbors.get(id) ?? []) {
          const row = rows.get(nb);
          if (row === undefined) continue;
          sum += row * 1000;
          count += 1;
        }
        const ext = extAvg.get(id);
        if (ext !== undefined && span > 0 && col.length > 1) {
          sum += Math.round(((ext - minE) * (col.length - 1) * 1000) / span);
          count += 1;
        }
        if (count === 0) { sum = (rows.get(id) ?? 0) * 1000; count = 1; }
        return { id, sum, count, model: modelIndex.get(id) ?? 0 };
      });
      scored.sort((a, b) => (a.sum * b.count - b.sum * a.count) || (a.model - b.model));
      columns[c] = scored.map((s) => s.id);
      columns[c].forEach((id, i) => rows.set(id, i));
    }
  }
}

/** A signal that jumps over a column gets an empty lane in that column, linked for the row sort. */
function insertLanes(columns: string[][], edges: [string, string][], layers: Map<string, number>, neighbors: Map<string, string[]>, modelIndex: Map<string, number>): void {
  let n = 0;
  const link = (a: string, b: string) => {
    const list = neighbors.get(a) ?? [];
    if (!list.includes(b)) list.push(b);
    neighbors.set(a, list);
  };
  for (const [u, v] of edges) {
    const lu = layers.get(u);
    const lv = layers.get(v);
    if (lu === undefined || lv === undefined || lv <= lu + 1) continue;
    let prev = u;
    let row = Math.max(0, columns[lu].indexOf(u));
    for (let col = lu + 1; col < lv; col++) {
      const id = `${DUMMY}lane${n++}`;
      const at = Math.min(row, columns[col].length);
      columns[col].splice(at, 0, id);
      neighbors.set(id, []);
      modelIndex.set(id, 1_000_000 + n);
      link(prev, id);
      link(id, prev);
      prev = id;
    }
    link(prev, v);
    link(v, prev);
  }
}

function fillFree(columns: string[][], free: string[]): string[][] {
  if (!free.length) return columns.filter((col) => col.length > 0);
  if (!columns.some((col) => col.length > 0)) {
    const cols = Math.max(1, Math.ceil(Math.sqrt(free.length)));
    const next: string[][] = Array.from({ length: cols }, () => []);
    free.forEach((id, i) => next[i % cols].push(id));
    return next;
  }
  const grid = columns.map((col) => [...col]);
  let i = 0;
  const maxRows = Math.max(...grid.map((col) => col.length));
  for (let row = 0; row < maxRows && i < free.length; row++) {
    for (let col = 0; col < grid.length && i < free.length; col++) {
      if (grid[col].length <= row) grid[col].push(free[i++]);
    }
  }
  while (i < free.length) {
    for (let col = 0; col < grid.length && i < free.length; col++) grid[col].push(free[i++]);
  }
  return grid.filter((col) => col.length > 0);
}

export interface ArrangedUnit { unit: Layout; devices: { id: string; x: number; y: number }[] }

/** New symbol positions and the Unit box. `undefined` when the Unit is missing. Does not mutate `p`. */
export function arrangeUnitDevices(p: Project, unitId: string): ArrangedUnit | undefined {
  const unit = p.units.find((u) => u.id === unitId);
  if (!unit) return undefined;
  const devices = p.devices.filter((d) => d.unitId === unitId);
  const order = devices.map((d) => d.id);
  const byId = new Map(devices.map((d) => [d.id, d]));
  const inside = new Set(order);
  const internal: [string, string][] = [];
  const side = new Map<string, Side | null>(order.map((id) => [id, null]));
  const external = new Set<string>();
  const externalCenter2 = new Map<string, number[]>();
  const neighbors = new Map<string, string[]>(order.map((id) => [id, []]));
  const addNeighbor = (a: string, b: string) => {
    const list = neighbors.get(a);
    if (list && !list.includes(b)) list.push(b);
  };
  for (const conn of p.connections) {
    if (conn.kind !== 'signal') continue;
    const fromIn = inside.has(conn.from.nodeId);
    const toIn = inside.has(conn.to.nodeId);
    if (fromIn && toIn) {
      internal.push([conn.from.nodeId, conn.to.nodeId]);
      addNeighbor(conn.from.nodeId, conn.to.nodeId);
      addNeighbor(conn.to.nodeId, conn.from.nodeId);
      continue;
    }
    const mine = fromIn ? conn.from.nodeId : toIn ? conn.to.nodeId : null;
    const otherId = fromIn ? conn.to.nodeId : toIn ? conn.from.nodeId : null;
    if (!mine || !otherId) continue;
    const other = p.devices.find((d) => d.id === otherId);
    const otherUnit = other ? p.units.find((u) => u.id === other.unitId) : undefined;
    if (!other || !otherUnit) continue;
    const toward = centerSide(otherUnit, unit);
    const prev = side.get(mine) ?? null;
    external.add(mine);
    if (toward === 'left') side.set(mine, prev === 'right' || prev === 'both' ? 'both' : 'left');
    else if (toward === 'right') side.set(mine, prev === 'left' || prev === 'both' ? 'both' : 'right');
    const ys = externalCenter2.get(mine) ?? [];
    ys.push(other.layout.y * 2 + other.layout.h);
    externalCenter2.set(mine, ys);
  }
  const kept = breakCycles(order, uniquePairs(internal));
  const layers = assignLayers(order, kept, side, external);
  const columnCount = layers.size ? Math.max(...layers.values()) + 1 : 0;
  const columns: string[][] = Array.from({ length: columnCount }, () => []);
  const free: string[] = [];
  for (const id of order) {
    const col = layers.get(id);
    if (col === undefined) free.push(id);
    else columns[col].push(id);
  }
  const modelIndex = new Map(order.map((id, i) => [id, i]));
  insertLanes(columns, kept, layers, neighbors, modelIndex);
  orderColumns(columns, neighbors, externalCenter2, modelIndex);
  const grid = fillFree(columns, free);
  const isDevice = (id: string) => byId.has(id);

  const chrome = new Map<string, Chrome>();
  for (const d of devices) {
    const hasIn = p.signals.some((s) => s.deviceId === d.id && s.direction === 'in');
    const hasOut = p.signals.some((s) => s.deviceId === d.id && s.direction === 'out');
    chrome.set(d.id, deviceChrome(d, hasIn, hasOut));
  }
  const placed = new Map<string, { x: number; y: number }>();
  if (grid.length) {
    const padL = grid.map((col) => {
      const pads = col.filter(isDevice).map((id) => chrome.get(id)!.padL);
      return pads.length ? Math.max(...pads) : 0;
    });
    const bodyR = grid.map((col) => {
      const rights = col.filter(isDevice).map((id) => byId.get(id)!.layout.w + chrome.get(id)!.padR);
      return rights.length ? Math.max(...rights) : 0;
    });
    const rowCount = Math.max(...grid.map((col) => col.length));
    const rowPitch: number[] = [];
    for (let row = 0; row < rowCount; row++) {
      let pitch = 0;
      for (const col of grid) {
        const id = col[row];
        if (!id) continue;
        if (!isDevice(id)) pitch = Math.max(pitch, DEVICE_LANE);
        else pitch = Math.max(pitch, byId.get(id)!.layout.h + chrome.get(id)!.padB);
      }
      rowPitch.push(pitch);
    }
    const rowY: number[] = [];
    let y = unit.layout.y + UNIT_HEADER + UNIT_PAD;
    for (let row = 0; row < rowCount; row++) {
      rowY.push(y);
      y += rowPitch[row] + DEVICE_ARRANGE_GAP;
    }
    const shift = Math.max(0, (padL[0] ?? 0) - UNIT_PAD);
    let x = unit.layout.x + UNIT_PAD + shift;
    grid.forEach((col, c) => {
      col.forEach((id, row) => { if (isDevice(id)) placed.set(id, { x, y: rowY[row] }); });
      const nextPad = c + 1 < grid.length ? padL[c + 1] : 0;
      x += bodyR[c] + DEVICE_ARRANGE_GAP + nextPad;
    });
  }

  if (!placed.size) {
    return { unit: { x: unit.layout.x, y: unit.layout.y, w: UNIT_DEFAULT_W, h: UNIT_DEFAULT_H }, devices: [] };
  }
  let right = unit.layout.x;
  let bottom = unit.layout.y;
  for (const d of devices) {
    const at = placed.get(d.id)!;
    const c = chrome.get(d.id)!;
    right = Math.max(right, at.x + d.layout.w + UNIT_PAD, at.x + d.layout.w + c.padR);
    bottom = Math.max(bottom, at.y + d.layout.h + UNIT_PAD, at.y + d.layout.h + c.padB);
  }
  return {
    unit: {
      x: unit.layout.x,
      y: unit.layout.y,
      w: Math.max(UNIT_MIN_W, right - unit.layout.x),
      h: Math.max(UNIT_HEADER, bottom - unit.layout.y),
    },
    devices: order.map((id) => ({ id, ...placed.get(id)! })),
  };
}
