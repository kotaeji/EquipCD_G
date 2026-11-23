// Copy / paste for Units and Devices (TURN-044).
// The clipboard is a snapshot the app holds. It is not the operating-system clipboard.
// One paste is one revision. Sequences, material routes, and interlocks are not copied.
import { getAssetById } from '../assets/library';
import { newId } from './factory';
import type { CmdResult } from './commands';
import { UNIT_SPREAD_GAP } from './commands';
import { walk } from './flow';
import type { Action, Condition, Connection, Device, MaterialEffect, Position, Project, Signal, Unit } from './types';
import { fitUnit, nextDeviceSlot, rectsOverlap } from './unitLayout';

export const COPY_NEED_NODE = 'Unit 또는 Device 를 고르세요';
export const PASTE_EMPTY = '복사한 것이 없습니다';
export const PASTE_LOCKED = '실행 중에는 붙여넣기가 차단됩니다';
export const PASTE_NEED_UNIT = '붙여 넣을 Unit 을 고르세요';
export const PASTE_ONE_UNIT = '붙여 넣을 Unit 을 하나만 고르세요';

export interface PasteOmission {
  sequenceSteps: number;
  materialRoutes: number;
  interlocks: number;
}

/** Snapshot taken at copy time. Later edits to the source project do not change it. */
export interface Clipboard {
  kind: 'devices' | 'units';
  units: Unit[];
  devices: Device[];
  signals: Signal[];
  positions: Position[];
  actions: Action[];
  /** Connections that touch the copied set, including ones that leave it. */
  connections: Connection[];
  omitted: PasteOmission;
}

export type CaptureResult = { ok: true; clip: Clipboard } | { ok: false; reason: string };

const unique = (ids: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
};

/** Same rule as Device 복제: `이름 사본`, then `이름 사본 2`. */
function duplicateName(taken: Set<string>, name: string): string {
  const first = `${name} 사본`;
  if (!taken.has(first)) return first;
  let n = 2;
  while (taken.has(`${name} 사본 ${n}`)) n += 1;
  return `${name} 사본 ${n}`;
}

/** Keep the name when it is free. The next one is `이름 2`. */
function numberedName(taken: Set<string>, name: string): string {
  if (!taken.has(name)) return name;
  let n = 2;
  while (taken.has(`${name} ${n}`)) n += 1;
  return `${name} ${n}`;
}

/** How a Unit snapshot is named and stamped when it is pasted. Omit every field to keep copy/paste. */
export interface UnitPasteOptions {
  /** New origin of the first Unit. Later Units keep their offset, then non-overlap runs. */
  at?: { x: number; y: number };
  /** `copy` is `이름 사본`. `keep` reuses the name, then `이름 2`. */
  names?: 'copy' | 'keep';
  lineageForUnit?: (src: Unit) => Unit['lineage'];
  /** Default true. False leaves Devices without a paste lineage. */
  deviceLineage?: boolean;
  /** A missing asset refuses the whole paste. */
  requireAssets?: boolean;
  /** Drop `templateRef` copied from the source Unit. */
  clearTemplateRef?: boolean;
}

function copiedObjectName(original: string, sourceName: string, copyName: string): string {
  const tail = copyName.slice(sourceName.length);
  if (sourceName && original.startsWith(sourceName)) return copyName + original.slice(sourceName.length);
  return original + tail;
}

function omissionOf(p: Project, deviceIds: Set<string>, unitIds: Set<string>): PasteOmission {
  const actionIds = new Set(p.actions.filter((a) => deviceIds.has(a.deviceId)).map((a) => a.id));
  let sequenceSteps = p.sequence.steps.filter((s) => actionIds.has(s.actionId)).length;
  for (const q of p.substationSequences ?? []) sequenceSteps += q.steps.filter((s) => actionIds.has(s.actionId)).length;
  const materialRoutes = p.materials.filter((m) =>
    (m.initialLocation != null && unitIds.has(m.initialLocation)) || m.route.some((r) => unitIds.has(r)),
  ).length;
  const interlocks = p.constraints.filter((k) =>
    k.kind.startsWith('interlock') && k.relatedIds.some((id) => deviceIds.has(id) || unitIds.has(id)),
  ).length;
  return { sequenceSteps, materialRoutes, interlocks };
}

function sliceOf(p: Project, devices: Device[], nodeIds: Set<string>): Pick<Clipboard, 'signals' | 'positions' | 'actions' | 'connections'> {
  const deviceIds = new Set(devices.map((d) => d.id));
  return {
    signals: structuredClone(p.signals.filter((s) => deviceIds.has(s.deviceId))),
    positions: structuredClone(p.positions.filter((s) => deviceIds.has(s.deviceId))),
    actions: structuredClone(p.actions.filter((a) => deviceIds.has(a.deviceId))),
    connections: structuredClone(p.connections.filter((c) => nodeIds.has(c.from.nodeId) || nodeIds.has(c.to.nodeId))),
  };
}

/**
 * Units in the selection win: the whole Unit, including every Device inside it.
 * A selection of only Devices copies those Devices. Anything else is refused.
 */
export function captureCopy(p: Project, ids: string[]): CaptureResult {
  const want = unique(ids);
  const units = want.flatMap((id) => {
    const u = p.units.find((x) => x.id === id);
    return u ? [u] : [];
  });
  if (units.length) {
    const unitIds = new Set(units.map((u) => u.id));
    const devices = p.devices.filter((d) => unitIds.has(d.unitId));
    const deviceIds = new Set(devices.map((d) => d.id));
    const nodeIds = new Set<string>([...unitIds, ...deviceIds]);
    return {
      ok: true,
      clip: {
        kind: 'units',
        units: structuredClone(units),
        devices: structuredClone(devices),
        ...sliceOf(p, devices, nodeIds),
        omitted: omissionOf(p, deviceIds, unitIds),
      },
    };
  }
  const devices = want.flatMap((id) => {
    const d = p.devices.find((x) => x.id === id);
    return d ? [d] : [];
  });
  if (!devices.length) return { ok: false, reason: COPY_NEED_NODE };
  const deviceIds = new Set(devices.map((d) => d.id));
  return {
    ok: true,
    clip: {
      kind: 'devices',
      units: [],
      devices: structuredClone(devices),
      ...sliceOf(p, devices, deviceIds),
      omitted: omissionOf(p, deviceIds, new Set()),
    },
  };
}

function usedIds(p: Project): Set<string> {
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
    id = guard > 1000 ? `${prefix}-paste-${used.size}-${guard}` : idOf(prefix);
    if (guard > 1000) break;
  }
  used.add(id);
  return id;
}

function allocCode(used: Set<string>): string {
  let n = 1;
  while (used.has(`S${n}`)) n += 1;
  const code = `S${n}`;
  used.add(code);
  return code;
}

interface Live {
  unit: Set<string>;
  device: Set<string>;
  signal: Set<string>;
  position: Set<string>;
}

function mapRef(id: string | null | undefined, map: Map<string, string>, live: Set<string>): string | null {
  if (!id) return id ?? null;
  if (map.has(id)) return map.get(id)!;
  if (live.has(id)) return id;
  return null;
}

function remapCond(c: Condition, dev: Map<string, string>, sig: Map<string, string>, unit: Map<string, string>, live: Live): Condition {
  if (c.kind === 'signal') {
    if (sig.has(c.signalId)) return { ...c, signalId: sig.get(c.signalId)! };
    if (live.signal.has(c.signalId)) return c;
    return { kind: 'undefined', note: '복사에 포함되지 않은 신호' };
  }
  if (c.kind === 'materialAt') {
    const id = mapRef(c.unitId, unit, live.unit);
    if (id) return { ...c, unitId: id };
    return { kind: 'undefined', note: '복사에 포함되지 않은 Unit' };
  }
  if (c.kind === 'materialHeldBy') {
    if (c.deviceId == null) return c;
    const id = mapRef(c.deviceId, dev, live.device);
    if (id) return { ...c, deviceId: id };
    return { kind: 'undefined', note: '복사에 포함되지 않은 Device' };
  }
  return c;
}

function remapEffect(effect: MaterialEffect, dev: Map<string, string>, unit: Map<string, string>, live: Live): MaterialEffect {
  const next: MaterialEffect = { ...effect };
  if (next.holder) {
    const id = mapRef(next.holder, dev, live.device);
    if (id) next.holder = id;
    else delete next.holder;
  }
  if (next.moveTo && next.moveTo !== 'EXIT') {
    const id = mapRef(next.moveTo, unit, live.unit);
    if (id) next.moveTo = id;
    else delete next.moveTo;
  }
  return next;
}

function skipLine(name: string, assetId: string): string {
  return `에셋 정의 ${assetId} 가 없어 ${name} 은 붙이지 않았습니다`;
}

function pasteMessage(kind: Clipboard['kind'], counts: { units: number; devices: number }, omitted: PasteOmission, externalConnections: number, skipped: string[]): string {
  const what = kind === 'units' ? `Unit ${counts.units}개` : `Device ${counts.devices}개`;
  const parts: string[] = [];
  if (omitted.sequenceSteps) parts.push(`시퀀스 단계 ${omitted.sequenceSteps}`);
  if (externalConnections) parts.push(`바깥 연결 ${externalConnections}`);
  if (omitted.materialRoutes) parts.push(`자재 경로 ${omitted.materialRoutes}`);
  if (omitted.interlocks) parts.push(`Interlock ${omitted.interlocks}`);
  let msg = `${what}를 붙여 넣었습니다`;
  if (parts.length) msg += `. 빠짐: ${parts.join(', ')}`;
  if (skipped.length) msg += `. ${skipped.join(' ')}`;
  return msg;
}

/** First line is the new top-level ids. The rest is the one-line notice. */
export function splitPasteNote(note: string | undefined): { ids: string[]; message: string } {
  const [line, ...rest] = (note ?? '').split('\n');
  return { ids: line ? line.split(',').filter(Boolean) : [], message: rest.join('\n').trim() };
}

function knownAsset(d: Device): boolean {
  return !!getAssetById(d.definitionRef.assetId);
}

/** Selected Unit wins. Selected Devices use their Unit when they share one. Nothing selected returns each Device to its original Unit. */
function deviceTarget(p: Project, devices: Device[], selectedIds: string[]): { ok: true; unitId: string | null } | { ok: false; reason: string } {
  const units: string[] = [];
  const seenU = new Set<string>();
  for (const id of selectedIds) {
    if (seenU.has(id) || !p.units.some((u) => u.id === id)) continue;
    seenU.add(id);
    units.push(id);
  }
  if (units.length > 1) return { ok: false, reason: PASTE_ONE_UNIT };
  if (units.length === 1) return { ok: true, unitId: units[0] };
  const devUnits: string[] = [];
  const seenD = new Set<string>();
  for (const id of selectedIds) {
    const d = p.devices.find((x) => x.id === id);
    if (!d || seenD.has(d.unitId)) continue;
    seenD.add(d.unitId);
    devUnits.push(d.unitId);
  }
  if (devUnits.length > 1) return { ok: false, reason: PASTE_ONE_UNIT };
  if (devUnits.length === 1) return { ok: true, unitId: devUnits[0] };
  if (devices.some((d) => !p.units.some((u) => u.id === d.unitId))) return { ok: false, reason: PASTE_NEED_UNIT };
  return { ok: true, unitId: null };
}

function shiftUnit(p: Project, unitId: string, dx: number, dy: number) {
  const mx = Math.round(dx);
  const my = Math.round(dy);
  if (mx === 0 && my === 0) return;
  const u = p.units.find((x) => x.id === unitId);
  if (!u) return;
  u.layout.x += mx;
  u.layout.y += my;
  for (const d of p.devices) if (d.unitId === unitId) { d.layout.x += mx; d.layout.y += my; }
}

/** Slide the new Units, as a group, until none overlaps a Unit outside the group. Then separate the group from itself. */
function settleUnits(p: Project, newIds: string[]) {
  const ids = new Set(newIds);
  for (let n = 0; n < 48; n++) {
    let dx = 0;
    for (const u of p.units) {
      if (!ids.has(u.id)) continue;
      for (const o of p.units) {
        if (ids.has(o.id) || !rectsOverlap(u.layout, o.layout)) continue;
        const need = o.layout.x + o.layout.w + UNIT_SPREAD_GAP - u.layout.x;
        if (need > dx) dx = need;
      }
    }
    if (dx > 0) {
      for (const id of ids) shiftUnit(p, id, dx, 0);
      continue;
    }
    const ordered = p.units.filter((u) => ids.has(u.id)).sort((a, b) => a.layout.x - b.layout.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    let moved = false;
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1];
      const cur = ordered[i];
      if (!rectsOverlap(prev.layout, cur.layout)) continue;
      const need = prev.layout.x + prev.layout.w + UNIT_SPREAD_GAP - cur.layout.x;
      if (need > 0) { shiftUnit(p, cur.id, need, 0); moved = true; }
    }
    if (!moved) return;
  }
}

function besideDelta(existing: Unit[], sources: Unit[]): { dx: number; dy: number } {
  const minX = Math.min(...sources.map((u) => u.layout.x));
  const present = sources.flatMap((s) => {
    const u = existing.find((x) => x.id === s.id);
    return u ? [u] : [];
  });
  const anchorRight = present.length
    ? Math.max(...present.map((u) => u.layout.x + u.layout.w))
    : (existing.length ? Math.max(...existing.map((u) => u.layout.x + u.layout.w)) : 30 - UNIT_SPREAD_GAP);
  return { dx: anchorRight + UNIT_SPREAD_GAP - minX, dy: 0 };
}

function finish(p: Project, ids: string[], message: string): CmdResult {
  p.revision += 1;
  return { ok: true, project: p, note: `${ids.join(',')}\n${message}` };
}

const no = (reason: string): CmdResult => ({ ok: false, reason });

/**
 * Paste a snapshot into `p0`.
 * Devices land in the selected Unit, or the selected Device's Unit, or each Device's original Unit.
 * Units land beside the original, then shift until they do not overlap another Unit.
 * `note` is `<new ids>\n<one-line notice>`.
 */
export function pasteClipboard(p0: Project, clip: Clipboard, selectedIds: string[], idOf: (s: string) => string = newId, options?: UnitPasteOptions): CmdResult {
  const skipped = clip.devices.filter((d) => !knownAsset(d));
  const skippedMsg = skipped.map((d) => skipLine(d.name, d.definitionRef.assetId));
  if (options?.requireAssets && skipped.length) return no(skippedMsg.join(' ') || COPY_NEED_NODE);
  const keep = clip.devices.filter((d) => knownAsset(d));
  const nextName = options?.names === 'keep' ? numberedName : duplicateName;
  if (clip.kind === 'devices' && !keep.length) return no(skippedMsg.join(' ') || COPY_NEED_NODE);
  if (clip.kind === 'units' && !clip.units.length) return no(COPY_NEED_NODE);

  let targetUnit: string | null = null;
  if (clip.kind === 'devices') {
    const target = deviceTarget(p0, keep, selectedIds);
    if (!target.ok) return no(target.reason);
    targetUnit = target.unitId;
  }

  const p = structuredClone(p0);
  const used = usedIds(p);
  const codes = new Set(p.units.map((u) => u.code));
  const unitNames = new Set(p.units.map((u) => u.name));
  const deviceNames = new Set(p.devices.map((d) => d.name));
  const live: Live = {
    unit: new Set(p.units.map((u) => u.id)),
    device: new Set(p.devices.map((d) => d.id)),
    signal: new Set(p.signals.map((s) => s.id)),
    position: new Set(p.positions.map((s) => s.id)),
  };
  const unitMap = new Map<string, string>();
  const devMap = new Map<string, string>();
  const sigMap = new Map<string, string>();
  const posMap = new Map<string, string>();
  const nameOf = new Map<string, string>();
  const created: string[] = [];
  const touched = new Set<string>();
  const placed: { src: Device; id: string; unitId: string }[] = [];

  if (clip.kind === 'units') {
    const delta = options?.at
      ? { dx: options.at.x - clip.units[0].layout.x, dy: options.at.y - clip.units[0].layout.y }
      : besideDelta(p.units, clip.units);
    for (const src of clip.units) {
      const id = takeId(idOf, 'unit', used);
      unitMap.set(src.id, id);
      const name = nextName(unitNames, src.name);
      unitNames.add(name);
      const u = structuredClone(src);
      u.id = id;
      u.name = name;
      u.code = allocCode(codes);
      u.deviceIds = [];
      u.layout = {
        x: Math.round(src.layout.x + delta.dx),
        y: Math.round(src.layout.y + delta.dy),
        w: src.layout.w,
        h: src.layout.h,
      };
      u.lineage = options?.lineageForUnit ? options.lineageForUnit(src) : { duplicatedFrom: src.id };
      if (options?.clearTemplateRef) delete u.templateRef;
      p.units.push(u);
      p.equipment.unitIds.push(id);
      created.push(id);
    }
  }

  // Pass 1: objects and id maps. Actions are rewritten after every copied Device has an id.
  for (const src of keep) {
    const unitId = clip.kind === 'units' ? unitMap.get(src.unitId) : (targetUnit ?? src.unitId);
    if (!unitId || !p.units.some((u) => u.id === unitId)) continue;
    const id = takeId(idOf, 'dev', used);
    devMap.set(src.id, id);
    const name = nextName(deviceNames, src.name);
    deviceNames.add(name);
    nameOf.set(src.id, name);
    const device = structuredClone(src);
    device.id = id;
    device.name = name;
    device.unitId = unitId;
    if (options?.deviceLineage === false) delete device.lineage;
    else device.lineage = { duplicatedFrom: src.id };
    delete device.templateChild;
    if (clip.kind === 'units') {
      const origin = clip.units.find((u) => u.id === src.unitId)!;
      const host = p.units.find((u) => u.id === unitId)!;
      device.layout = {
        x: Math.round(src.layout.x + (host.layout.x - origin.layout.x)),
        y: Math.round(src.layout.y + (host.layout.y - origin.layout.y)),
        w: src.layout.w,
        h: src.layout.h,
      };
    } else {
      const slot = nextDeviceSlot(p, unitId, src.kind);
      device.layout = { x: slot.x, y: slot.y, w: src.layout.w, h: src.layout.h };
    }
    p.devices.push(device);
    p.units.find((u) => u.id === unitId)!.deviceIds.push(id);
    touched.add(unitId);
    placed.push({ src, id, unitId });
    if (clip.kind === 'devices') created.push(id);

    for (const s of clip.signals.filter((x) => x.deviceId === src.id)) {
      const sid = takeId(idOf, 'sig', used);
      sigMap.set(s.id, sid);
      const copy = structuredClone(s);
      copy.id = sid;
      copy.name = copiedObjectName(s.name, src.name, name);
      copy.deviceId = id;
      p.signals.push(copy);
    }
    for (const s of clip.positions.filter((x) => x.deviceId === src.id)) {
      const pid = takeId(idOf, 'pos', used);
      posMap.set(s.id, pid);
      const copy = structuredClone(s);
      copy.id = pid;
      copy.name = copiedObjectName(s.name, src.name, name);
      copy.deviceId = id;
      p.positions.push(copy);
    }
  }

  for (const { src, id, unitId } of placed) {
    const name = nameOf.get(src.id)!;
    for (const a of clip.actions.filter((x) => x.deviceId === src.id)) {
      const copy = structuredClone(a);
      copy.id = takeId(idOf, 'act', used);
      copy.name = copiedObjectName(a.name, src.name, name);
      copy.deviceId = id;
      copy.unitId = unitId;
      copy.commandSignalId = mapRef(copy.commandSignalId, sigMap, live.signal);
      copy.completeSignalId = mapRef(copy.completeSignalId, sigMap, live.signal);
      copy.targetPositionId = mapRef(copy.targetPositionId, posMap, live.position);
      copy.effect = remapEffect(copy.effect, devMap, unitMap, live);
      copy.pre = copy.pre.map((c) => remapCond(c, devMap, sigMap, unitMap, live));
      copy.post = copy.post.map((c) => remapCond(c, devMap, sigMap, unitMap, live));
      p.actions.push(copy);
    }
  }

  if (clip.kind === 'devices' && created.length === 0) return no(skippedMsg.join(' ') || PASTE_NEED_UNIT);

  for (const id of touched) fitUnit(p, id);
  if (clip.kind === 'units') settleUnits(p, [...unitMap.values()]);

  const pastedNodes = new Set<string>([...unitMap.keys(), ...devMap.keys()]);
  let external = 0;
  for (const c of clip.connections) {
    const fromIn = pastedNodes.has(c.from.nodeId);
    const toIn = pastedNodes.has(c.to.nodeId);
    if (!fromIn && !toIn) continue;
    if (!fromIn || !toIn) { external += 1; continue; }
    const fromNode = unitMap.get(c.from.nodeId) ?? devMap.get(c.from.nodeId);
    const toNode = unitMap.get(c.to.nodeId) ?? devMap.get(c.to.nodeId);
    if (!fromNode || !toNode) { external += 1; continue; }
    const fromSig = c.from.signalId ? sigMap.get(c.from.signalId) : undefined;
    const toSig = c.to.signalId ? sigMap.get(c.to.signalId) : undefined;
    if (c.kind === 'signal' && (!fromSig || !toSig)) { external += 1; continue; }
    p.connections.push({
      id: takeId(idOf, c.kind === 'flow' ? 'flow' : 'sigc', used),
      kind: c.kind,
      from: { nodeId: fromNode, ...(fromSig ? { signalId: fromSig } : {}) },
      to: { nodeId: toNode, ...(toSig ? { signalId: toSig } : {}) },
    });
  }

  const message = pasteMessage(
    clip.kind,
    { units: unitMap.size, devices: devMap.size },
    clip.omitted,
    external,
    skippedMsg,
  );
  return finish(p, created, message);
}
