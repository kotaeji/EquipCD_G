// TURN-096. Duplicate a Unit, lay out only the selected Units, and match selected Devices.
// Pure: each call returns a new project or a refusal. The input project is not mutated.
import { newId } from './factory';
import { branchArms, branchFromArms, walk } from './flow';
import type { CmdResult } from './commands';
import type { Action, Condition, Connection, Device, FlowNode, MaterialEffect, Position, Project, SequenceStep, Signal, SubstationSequence, Unit } from './types';
import { fitUnit, rectsOverlap, UNIT_HEADER, UNIT_PAD } from './unitLayout';

/** Same pitch as `UNIT_SPREAD_GAP` (TURN-036). Copies and the selected-unit row use it. */
const GAP = 20;

const clone = (p: Project): Project => structuredClone(p);
const bump = (p: Project): Project => { p.revision += 1; return p; };
const ok = (project: Project, note?: string): CmdResult => ({ ok: true, project: bump(project), note });
const no = (reason: string): CmdResult => ({ ok: false, reason });

export const DEVICE_ARRANGE_NEED_2 = '같은 Unit의 Device 를 2개 이상 고르세요';
export const DEVICE_ARRANGE_NEED_3 = '같은 Unit의 Device 를 3개 이상 고르세요';
export const DEVICE_ARRANGE_ONE_UNIT = '같은 Unit 안의 Device만 맞출 수 있습니다';
export const DUPLICATE_NEED_UNIT = 'Unit 을 고르세요';
/** Shown on 「고른 것만 자동 정렬」. Unselected Units stay where they are. */
export const ARRANGE_SELECTED_HINT = '고른 Unit만 물류 순서대로 왼쪽부터 나란히 놓습니다. 고르지 않은 Unit은 그대로입니다';

const ARRANGE_UNCHANGED = '바뀐 것 없음';
const ARRANGE_NEED_2 = 'Unit 을 2개 이상 고르세요';

function lockedNote(count: number): string {
  return `잠긴 Unit ${count}개는 제외`;
}

function joinNote(a?: string, b?: string): string | undefined {
  if (a && b) return `${a}. ${b}`;
  return a || b || undefined;
}

function duplicateName(taken: Set<string>, name: string): string {
  const first = `${name} 사본`;
  if (!taken.has(first)) return first;
  let n = 2;
  while (taken.has(`${name} 사본 ${n}`)) n += 1;
  return `${name} 사본 ${n}`;
}

function copiedObjectName(original: string, sourceName: string, copyName: string): string {
  const tail = copyName.slice(sourceName.length);
  if (sourceName && original.startsWith(sourceName)) return copyName + original.slice(sourceName.length);
  return original + tail;
}

function allocCode(used: Set<string>): string {
  let n = 1;
  while (used.has(`S${n}`)) n += 1;
  const code = `S${n}`;
  used.add(code);
  return code;
}

function collectIds(p: Project): Set<string> {
  const ids = new Set<string>();
  const add = (list: { id: string }[]) => { for (const x of list) if (x?.id) ids.add(x.id); };
  ids.add(p.id);
  ids.add(p.equipment.id);
  ids.add(p.sequence.id);
  add(p.units); add(p.devices); add(p.signals); add(p.positions); add(p.actions);
  add(p.materials); add(p.connections); add(p.constraints); add(p.candidates); add(p.sequence.steps);
  for (const q of p.substationSequences ?? []) {
    ids.add(q.id);
    add(q.steps);
    if (q.flow) walk(q.flow, (n) => { if (n.kind !== 'step') ids.add(n.id); });
  }
  if (p.sequence.flow) walk(p.sequence.flow, (n) => { if (n.kind !== 'step') ids.add(n.id); });
  return ids;
}

function takeId(idOf: (s: string) => string, prefix: string, used: Set<string>): string {
  let id = idOf(prefix);
  let guard = 0;
  while (!id || used.has(id)) {
    guard += 1;
    id = guard > 1000 ? `${prefix}-dup-${used.size}-${guard}` : idOf(prefix);
    if (guard > 1000) break;
  }
  used.add(id);
  return id;
}

function shiftUnits(p: Project, ids: Set<string>, dx: number, dy: number): boolean {
  const mx = Math.round(dx);
  const my = Math.round(dy);
  if (mx === 0 && my === 0) return false;
  let moved = false;
  for (const u of p.units) {
    if (!ids.has(u.id)) continue;
    u.layout.x += mx;
    u.layout.y += my;
    moved = true;
    for (const d of p.devices) if (d.unitId === u.id) { d.layout.x += mx; d.layout.y += my; }
  }
  return moved;
}

/** Slide the copies right until they miss every Unit that is not a copy, then separate the copies. */
function settleCopies(p: Project, newIds: string[]) {
  const ids = new Set(newIds);
  for (let n = 0; n < 64; n++) {
    let dx = 0;
    for (const u of p.units) {
      if (!ids.has(u.id)) continue;
      for (const o of p.units) {
        if (ids.has(o.id) || !rectsOverlap(u.layout, o.layout)) continue;
        const need = o.layout.x + o.layout.w + GAP - u.layout.x;
        if (need > dx) dx = need;
      }
    }
    if (dx > 0) { shiftUnits(p, ids, dx, 0); continue; }
    const ordered = p.units.filter((u) => ids.has(u.id)).sort((a, b) => a.layout.x - b.layout.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    let moved = false;
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1];
      const cur = ordered[i];
      if (!rectsOverlap(prev.layout, cur.layout)) continue;
      const need = prev.layout.x + prev.layout.w + GAP - cur.layout.x;
      if (need > 0) { shiftUnits(p, new Set([cur.id]), need, 0); moved = true; }
    }
    if (!moved) return;
  }
}

function mapCond(c: Condition, unitMap: Map<string, string>, devMap: Map<string, string>, sigMap: Map<string, string>): Condition {
  if (c.kind === 'signal' && sigMap.has(c.signalId)) return { ...c, signalId: sigMap.get(c.signalId)! };
  if (c.kind === 'materialAt' && unitMap.has(c.unitId)) return { ...c, unitId: unitMap.get(c.unitId)! };
  if (c.kind === 'materialHeldBy' && c.deviceId && devMap.has(c.deviceId)) return { ...c, deviceId: devMap.get(c.deviceId)! };
  return c;
}

function mapEffect(effect: MaterialEffect, unitMap: Map<string, string>, devMap: Map<string, string>): MaterialEffect {
  const next: MaterialEffect = { ...effect };
  if (next.holder && devMap.has(next.holder)) next.holder = devMap.get(next.holder)!;
  if (next.moveTo && next.moveTo !== 'EXIT' && unitMap.has(next.moveTo)) next.moveTo = unitMap.get(next.moveTo)!;
  return next;
}

function mapId(id: string | null, map: Map<string, string>): string | null {
  if (!id) return id;
  return map.get(id) ?? id;
}

function remapFlow(
  nodes: FlowNode[],
  stepMap: Map<string, string>,
  unitMap: Map<string, string>,
  take: (prefix: string) => string,
  fix: (c: Condition) => Condition,
): FlowNode[] {
  const rec = (list: FlowNode[]): FlowNode[] => list.flatMap((n): FlowNode[] => {
    if (n.kind === 'step') {
      const stepId = stepMap.get(n.stepId);
      return stepId ? [{ kind: 'step', stepId }] : [];
    }
    if (n.kind === 'branch') {
      const arms = branchArms(n).map((arm) => ({
        cond: arm.cond ? fix(arm.cond) : null,
        body: rec(arm.body),
      }));
      return [branchFromArms({ ...structuredClone(n), id: take('flw') }, arms)];
    }
    if (n.kind === 'parallel') return [{ ...structuredClone(n), id: take('flw'), lanes: n.lanes.map(rec) }];
    if (n.kind === 'loop') return [{ ...structuredClone(n), id: take('flw'), body: rec(n.body) }];
    if (n.kind === 'retry') return [{ ...structuredClone(n), id: take('flw'), until: fix(n.until), body: rec(n.body) }];
    if (n.kind === 'wait') return [{ ...structuredClone(n), id: take('flw'), cond: fix(n.cond) }];
    return [{ ...structuredClone(n), id: take('flw'), unitId: unitMap.get(n.unitId) ?? n.unitId }];
  });
  return rec(nodes);
}

export interface DuplicateUnitsOptions {
  /** Copy each Unit's substation sequences and flow blocks under new ids. Default off. */
  copySequences?: boolean;
}

/**
 * Copy each Unit in `ids`. Devices, signals, positions, actions, and signal links that stay
 * inside that Unit are copied with new ids. Flow links, signal links that leave the Unit,
 * station steps, and material routes are not. Substation sequences are copied only when
 * `copySequences` is set. The copy is named 「이름 사본」, gets the next free `S` code,
 * is unlocked, and lands to the right of the originals without covering another Unit.
 * `note` is the new Unit ids, comma-separated, in selection order. One revision.
 */
export function duplicateUnits(p0: Project, ids: string[], options: DuplicateUnitsOptions = {}, idOf: (s: string) => string = newId): CmdResult {
  const seen = new Set<string>();
  const sources: Unit[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const u = p0.units.find((x) => x.id === id);
    if (!u) continue;
    seen.add(id);
    sources.push(u);
  }
  if (!sources.length) return no(DUPLICATE_NEED_UNIT);

  const p = clone(p0);
  const used = collectIds(p);
  const take = (prefix: string) => takeId(idOf, prefix, used);
  const codes = new Set(p.units.map((u) => u.code));
  const unitNames = new Set(p.units.map((u) => u.name));
  const deviceNames = new Set(p.devices.map((d) => d.name));
  const seqNames = new Set<string>([p.sequence.name, ...(p.substationSequences ?? []).map((q) => q.name)]);
  const unitMap = new Map<string, string>();
  const devMap = new Map<string, string>();
  const sigMap = new Map<string, string>();
  const posMap = new Map<string, string>();
  const actMap = new Map<string, string>();
  const nameOfUnit = new Map<string, string>();
  const nameOfDev = new Map<string, string>();
  const created: string[] = [];

  for (const src of sources) {
    const id = take('unit');
    unitMap.set(src.id, id);
    const name = duplicateName(unitNames, src.name);
    unitNames.add(name);
    nameOfUnit.set(src.id, name);
    const u = structuredClone(src);
    u.id = id;
    u.name = name;
    u.code = allocCode(codes);
    u.deviceIds = [];
    u.lineage = { duplicatedFrom: src.id };
    delete u.positionLocked;
    p.units.push(u);
    p.equipment.unitIds.push(id);
    created.push(id);
  }

  const sourceDevices = p.devices.filter((d) => unitMap.has(d.unitId));
  for (const src of sourceDevices) {
    const id = take('dev');
    devMap.set(src.id, id);
    const name = duplicateName(deviceNames, src.name);
    deviceNames.add(name);
    nameOfDev.set(src.id, name);
    const device: Device = structuredClone(src);
    device.id = id;
    device.name = name;
    device.unitId = unitMap.get(src.unitId)!;
    device.lineage = { duplicatedFrom: src.id };
    delete device.templateChild;
    p.devices.push(device);
    p.units.find((u) => u.id === device.unitId)!.deviceIds.push(id);
  }

  for (const src of sourceDevices) {
    const deviceId = devMap.get(src.id)!;
    const deviceName = nameOfDev.get(src.id)!;
    for (const s of p.signals.filter((x) => x.deviceId === src.id)) {
      if (sigMap.has(s.id)) continue;
      const id = take('sig');
      sigMap.set(s.id, id);
      const copy: Signal = structuredClone(s);
      copy.id = id;
      copy.name = copiedObjectName(s.name, src.name, deviceName);
      copy.deviceId = deviceId;
      p.signals.push(copy);
    }
    for (const s of p.positions.filter((x) => x.deviceId === src.id)) {
      if (posMap.has(s.id)) continue;
      const id = take('pos');
      posMap.set(s.id, id);
      const copy: Position = structuredClone(s);
      copy.id = id;
      copy.name = copiedObjectName(s.name, src.name, deviceName);
      copy.deviceId = deviceId;
      p.positions.push(copy);
    }
  }
  for (const src of sourceDevices) {
    const deviceId = devMap.get(src.id)!;
    const deviceName = nameOfDev.get(src.id)!;
    for (const a of p.actions.filter((x) => x.deviceId === src.id)) {
      if (actMap.has(a.id)) continue;
      const id = take('act');
      actMap.set(a.id, id);
      const copy: Action = structuredClone(a);
      copy.id = id;
      copy.name = copiedObjectName(a.name, src.name, deviceName);
      copy.deviceId = deviceId;
      copy.unitId = unitMap.get(src.unitId)!;
      copy.commandSignalId = mapId(copy.commandSignalId, sigMap);
      copy.completeSignalId = mapId(copy.completeSignalId, sigMap);
      copy.targetPositionId = mapId(copy.targetPositionId, posMap);
      copy.effect = mapEffect(copy.effect, unitMap, devMap);
      copy.pre = copy.pre.map((c) => mapCond(c, unitMap, devMap, sigMap));
      copy.post = copy.post.map((c) => mapCond(c, unitMap, devMap, sigMap));
      p.actions.push(copy);
    }
  }

  for (const c of p0.connections) {
    if (c.kind !== 'signal') continue;
    const fromDev = p0.devices.find((d) => d.id === c.from.nodeId);
    const toDev = p0.devices.find((d) => d.id === c.to.nodeId);
    if (!fromDev || !toDev || fromDev.unitId !== toDev.unitId || !unitMap.has(fromDev.unitId)) continue;
    const fromNode = devMap.get(c.from.nodeId);
    const toNode = devMap.get(c.to.nodeId);
    const fromSig = c.from.signalId ? sigMap.get(c.from.signalId) : undefined;
    const toSig = c.to.signalId ? sigMap.get(c.to.signalId) : undefined;
    if (!fromNode || !toNode || !fromSig || !toSig) continue;
    const link: Connection = {
      id: take('sigc'),
      kind: 'signal',
      from: { nodeId: fromNode, signalId: fromSig },
      to: { nodeId: toNode, signalId: toSig },
    };
    p.connections.push(link);
  }

  if (options.copySequences) {
    const fix = (c: Condition) => mapCond(c, unitMap, devMap, sigMap);
    for (const src of p0.substationSequences ?? []) {
      if (!unitMap.has(src.unitId)) continue;
      const stepMap = new Map<string, string>();
      const steps: SequenceStep[] = [];
      for (const step of src.steps) {
        const actionId = actMap.get(step.actionId);
        if (!actionId) continue;
        const id = take('sstep');
        stepMap.set(step.id, id);
        const copy: SequenceStep = structuredClone(step);
        copy.id = id;
        copy.actionId = actionId;
        copy.entry = copy.entry.map(fix);
        steps.push(copy);
      }
      if (!steps.length && src.steps.length) continue;
      const seq: SubstationSequence = {
        id: take('sseq'),
        name: duplicateName(seqNames, src.name),
        unitId: unitMap.get(src.unitId)!,
        steps,
        unresolved: structuredClone(src.unresolved),
      };
      seqNames.add(seq.name);
      if (src.flow) seq.flow = remapFlow(src.flow, stepMap, unitMap, take, fix);
      (p.substationSequences ??= []).push(seq);
    }
  }

  const minX = Math.min(...sources.map((u) => u.layout.x));
  const anchorRight = Math.max(...sources.map((u) => u.layout.x + u.layout.w));
  shiftUnits(p, new Set(created), anchorRight + GAP - minX, 0);
  settleCopies(p, created);
  return ok(p, created.join(','));
}

/** Two or more Units, or two or more Devices of one Unit and no Unit. */
export function selectedArrangeTarget(p: Project, ids: string[]):
  | { kind: 'units'; ids: string[] }
  | { kind: 'devices'; ids: string[]; unitId: string }
  | { kind: 'none' } {
  const seen = new Set<string>();
  const unitIds: string[] = [];
  const deviceIds: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (p.units.some((u) => u.id === id)) unitIds.push(id);
    else if (p.devices.some((d) => d.id === id)) deviceIds.push(id);
  }
  if (unitIds.length >= 2) return { kind: 'units', ids: unitIds };
  if (unitIds.length === 0 && deviceIds.length >= 2) {
    const owners = new Set(deviceIds.map((id) => p.devices.find((d) => d.id === id)!.unitId));
    if (owners.size === 1) return { kind: 'devices', ids: deviceIds, unitId: [...owners][0] };
  }
  return { kind: 'none' };
}

/** Logistics order. A cycle keeps the current left-to-right order. */
function flowRank(p: Project): Map<string, number> {
  const ids = p.units.map((u) => u.id);
  const incoming = new Map(ids.map((id) => [id, 0]));
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const c of p.connections) {
    if (c.kind !== 'flow') continue;
    if (!incoming.has(c.from.nodeId) || !incoming.has(c.to.nodeId)) continue;
    out.get(c.from.nodeId)!.push(c.to.nodeId);
    incoming.set(c.to.nodeId, (incoming.get(c.to.nodeId) ?? 0) + 1);
  }
  const pos = new Map(p.units.map((u) => [u.id, u]));
  const cmp = (a: string, b: string) => {
    const ua = pos.get(a)!;
    const ub = pos.get(b)!;
    return ua.layout.x - ub.layout.x || ua.layout.y - ub.layout.y || (a < b ? -1 : a > b ? 1 : 0);
  };
  const ready = ids.filter((id) => incoming.get(id) === 0).sort(cmp);
  const rank = new Map<string, number>();
  let n = 0;
  while (ready.length) {
    ready.sort(cmp);
    const id = ready.shift()!;
    rank.set(id, n++);
    for (const v of out.get(id) ?? []) {
      incoming.set(v, (incoming.get(v) ?? 1) - 1);
      if (incoming.get(v) === 0) ready.push(v);
    }
  }
  for (const id of ids.filter((x) => !rank.has(x)).sort(cmp)) rank.set(id, n++);
  return rank;
}

/**
 * Lay the unlocked selected Units in one row, left to right in logistics order.
 * Unselected Units and locked Units stay put. The row slides right if it would cover them.
 * One revision. The note names locked Units that were left out.
 */
export function arrangeSelectedUnits(p0: Project, ids: string[]): CmdResult {
  const want = new Set(ids);
  const picked = p0.units.filter((u) => want.has(u.id));
  if (picked.length < 2) return no(ARRANGE_NEED_2);
  const skipped = picked.filter((u) => u.positionLocked === true).length;
  const freeIds = picked.filter((u) => u.positionLocked !== true).map((u) => u.id);
  const note = skipped ? lockedNote(skipped) : undefined;
  if (freeIds.length < 2) return no(note ? `${note} — ${ARRANGE_NEED_2}` : ARRANGE_NEED_2);

  const rank = flowRank(p0);
  const p = clone(p0);
  const free = new Set(freeIds);
  const units = p.units.filter((u) => free.has(u.id)).sort((a, b) => (rank.get(a.id)! - rank.get(b.id)!) || a.layout.x - b.layout.x || (a.id < b.id ? -1 : 1));
  const y = Math.min(...units.map((u) => u.layout.y));
  let x = Math.min(...units.map((u) => u.layout.x));
  let changed = false;
  for (const u of units) {
    changed = shiftUnits(p, new Set([u.id]), x - u.layout.x, y - u.layout.y) || changed;
    x = u.layout.x + u.layout.w + GAP;
  }
  for (let n = 0; n < 64; n++) {
    let dx = 0;
    for (const u of p.units) {
      if (!free.has(u.id)) continue;
      for (const o of p.units) {
        if (free.has(o.id) || !rectsOverlap(u.layout, o.layout)) continue;
        const need = o.layout.x + o.layout.w + GAP - u.layout.x;
        if (need > dx) dx = need;
      }
    }
    if (dx <= 0) break;
    changed = shiftUnits(p, free, dx, 0) || changed;
  }
  if (!changed) return no(joinNote(note, ARRANGE_UNCHANGED) ?? ARRANGE_UNCHANGED);
  return ok(p, note);
}

function deviceGroup(p: Project, ids: string[]): { ids: string[]; unitId: string } | { reason: string } {
  const seen = new Set<string>();
  const devs: Device[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const d = p.devices.find((x) => x.id === id);
    if (!d) continue;
    seen.add(id);
    devs.push(d);
  }
  if (devs.length < 2) return { reason: DEVICE_ARRANGE_NEED_2 };
  const owners = new Set(devs.map((d) => d.unitId));
  if (owners.size !== 1) return { reason: DEVICE_ARRANGE_ONE_UNIT };
  return { ids: devs.map((d) => d.id), unitId: devs[0].unitId };
}

function clampDevices(p: Project, unitId: string, ids: Set<string>) {
  const u = p.units.find((x) => x.id === unitId);
  if (!u) return;
  const left = u.layout.x + UNIT_PAD;
  const top = u.layout.y + UNIT_HEADER + UNIT_PAD;
  const right = u.layout.x + u.layout.w - UNIT_PAD;
  const bottom = u.layout.y + u.layout.h - UNIT_PAD;
  for (const d of p.devices) {
    if (!ids.has(d.id)) continue;
    if (d.layout.w > right - left) d.layout.w = Math.max(1, right - left);
    if (d.layout.h > bottom - top) d.layout.h = Math.max(1, bottom - top);
    if (d.layout.x < left) d.layout.x = left;
    if (d.layout.y < top) d.layout.y = top;
    if (d.layout.x + d.layout.w > right) d.layout.x = right - d.layout.w;
    if (d.layout.y + d.layout.h > bottom) d.layout.y = bottom - d.layout.h;
  }
}

function finishDevices(p0: Project, p: Project, unitId: string, ids: string[]): CmdResult {
  const unit = p.units.find((u) => u.id === unitId);
  if (!unit) return no('Unit 없음');
  if (unit.positionLocked === true) clampDevices(p, unitId, new Set(ids));
  else fitUnit(p, unitId);
  const same = ids.every((id) => {
    const before = p0.devices.find((d) => d.id === id)!;
    const after = p.devices.find((d) => d.id === id)!;
    return before.layout.x === after.layout.x && before.layout.y === after.layout.y && before.layout.w === after.layout.w && before.layout.h === after.layout.h;
  }) && p0.units.find((u) => u.id === unitId)!.layout.x === unit.layout.x
    && p0.units.find((u) => u.id === unitId)!.layout.y === unit.layout.y
    && p0.units.find((u) => u.id === unitId)!.layout.w === unit.layout.w
    && p0.units.find((u) => u.id === unitId)!.layout.h === unit.layout.h;
  if (same) return no(ARRANGE_UNCHANGED);
  return ok(p);
}

/** Equal edge gaps. The first and last Device on `axis` stay. One Unit only. One revision. */
export function distributeDevices(p0: Project, ids: string[], axis: 'x' | 'y'): CmdResult {
  const group = deviceGroup(p0, ids);
  if ('reason' in group) return no(group.reason);
  if (group.ids.length < 3) return no(DEVICE_ARRANGE_NEED_3);
  const p = clone(p0);
  const want = new Set(group.ids);
  const sorted = p.devices.filter((d) => want.has(d.id)).sort((a, b) => {
    const other = axis === 'x' ? 'y' : 'x';
    return a.layout[axis] - b.layout[axis] || a.layout[other] - b.layout[other] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
  const size = axis === 'x' ? 'w' : 'h';
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const middleSum = sorted.slice(1, -1).reduce((sum, d) => sum + d.layout[size], 0);
  const span = last.layout[axis] - (first.layout[axis] + first.layout[size]);
  const gap = (span - middleSum) / (sorted.length - 1);
  const start = first.layout[axis] + first.layout[size];
  let placed = 0;
  let changed = false;
  for (let i = 1; i < sorted.length - 1; i++) {
    const ideal = start + i * gap + placed;
    const delta = Math.round(ideal) - sorted[i].layout[axis];
    if (delta !== 0) { sorted[i].layout[axis] += delta; changed = true; }
    placed += sorted[i].layout[size];
  }
  if (!changed) return no(ARRANGE_UNCHANGED);
  return finishDevices(p0, p, group.unitId, group.ids);
}

/** Match `dim` to the largest selected Device. Origin stays. The Unit grows when it is unlocked. */
export function matchDeviceSize(p0: Project, ids: string[], dim: 'w' | 'h'): CmdResult {
  const group = deviceGroup(p0, ids);
  if ('reason' in group) return no(group.reason);
  const picked = p0.devices.filter((d) => group.ids.includes(d.id));
  const target = Math.max(...picked.map((d) => d.layout[dim]));
  const p = clone(p0);
  let changed = false;
  for (const d of p.devices) {
    if (!group.ids.includes(d.id)) continue;
    if (d.layout[dim] !== target) { d.layout[dim] = target; changed = true; }
  }
  if (!changed) return no(ARRANGE_UNCHANGED);
  return finishDevices(p0, p, group.unitId, group.ids);
}
