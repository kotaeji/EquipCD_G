// Pure model editing commands (F2/F3/F4/F5). Each returns a new Project or a rejection; never mutates input.
import { findAsset, getAssetById } from '../assets/library';
import { instantiateDevice, makeUnit, newId } from './factory';
import type { Action, AssetKind, Condition, Connection, Device, Material, Position, Project, Quantity, SequenceStep, Signal, SubstationSequence, Unit } from './types';
import { q } from './types';
import { UNIT_DEFAULT_H, UNIT_DEFAULT_W, fitUnit, nextDeviceSlot, tightUnitLayout, unitMinSize } from './unitLayout';

export type CmdResult = { ok: true; project: Project; note?: string } | { ok: false; reason: string };

const clone = (p: Project): Project => structuredClone(p);
const bump = (p: Project): Project => { p.revision += 1; return p; };
const ok = (project: Project, note?: string): CmdResult => ({ ok: true, project: bump(project), note });
const no = (reason: string): CmdResult => ({ ok: false, reason });

export function unitAt(p: Project, x: number, y: number): Unit | undefined {
  // topmost (last) unit containing point
  return [...p.units].reverse().find((u) => x >= u.layout.x && x <= u.layout.x + u.layout.w && y >= u.layout.y && y <= u.layout.y + u.layout.h);
}

export function addUnit(p0: Project, name: string, at: { x: number; y: number }, idOf: (s: string) => string = newId): CmdResult {
  const p = clone(p0);
  const code = `S${p.units.length + 1}`;
  const u = makeUnit(name || `${code} 새 유닛`, code, { x: at.x, y: at.y, w: UNIT_DEFAULT_W, h: UNIT_DEFAULT_H }, idOf);
  p.units.push(u); p.equipment.unitIds.push(u.id);
  return ok(p, u.id);
}

/**
 * C02-09 template instantiation: new Unit + new child Devices/Signals/Actions with fresh IDs, internal links re-wired
 * to the new signal IDs, template rules → Action preconditions. Definition pinned via templateRef; editing one instance
 * never changes another instance or the definition.
 */
export function addUnitFromTemplate(p0: Project, kind: AssetKind, at: { x: number; y: number }, idOf: (s: string) => string = newId): CmdResult {
  const def = findAsset(kind);
  if (!def || !def.template) return no(`${kind} 은(는) 유닛 템플릿이 아닙니다`);
  const t = def.template;
  for (const c of t.children) if (!getAssetById(c.assetId)) return no(`템플릿 자식 정의 ${c.assetId} 없음 — 배치 취소 (부분 인스턴스 없음)`);
  const p = clone(p0);
  const n = p.units.length + 1;
  const sameCount = p.units.filter((u) => u.templateRef?.assetId === def.id).length + 1;
  const u = makeUnit(`S${n} ${def.name.replace(' 템플릿', '')} ${sameCount}`, `S${n}`, { x: at.x, y: at.y, w: t.size.w, h: t.size.h }, idOf);
  u.templateRef = { assetId: def.id, version: def.version };
  p.units.push(u); p.equipment.unitIds.push(u.id);
  const byLocal = new Map<string, ReturnType<typeof instantiateDevice>>();
  for (const c of t.children) {
    const cd = getAssetById(c.assetId)!;
    const b = instantiateDevice(cd.kind, u.id, { x: at.x + c.dx, y: at.y + c.dy }, `${cd.namePrefix}-${u.code}-${c.localId}`, idOf, c.localId);
    byLocal.set(c.localId, b);
    p.devices.push(b.device); p.signals.push(...b.signals); p.positions.push(...b.positions); p.actions.push(...b.actions);
    u.deviceIds.push(b.device.id);
  }
  const sig = (child: string, port: string) => byLocal.get(child)?.signals.find((s) => s.portKey === port);
  for (const l of t.links) {
    const a = sig(l.from.child, l.from.port); const b = sig(l.to.child, l.to.port);
    if (!a || !b) return no(`템플릿 내부 연결 ${l.from.child}.${l.from.port} → ${l.to.child}.${l.to.port} 해석 실패 — 배치 취소`);
    p.connections.push({ id: idOf('sigc'), kind: 'signal', from: { nodeId: a.deviceId, signalId: a.id }, to: { nodeId: b.deviceId, signalId: b.id } });
  }
  for (const r of t.rules) {
    const b = byLocal.get(r.child); const tmpl = getAssetById(t.children.find((c) => c.localId === r.child)!.assetId)!.actions.find((x) => x.key === r.action);
    const act = b && tmpl ? p.actions.find((x) => x.deviceId === b.device.id && x.kind === tmpl.kind && x.commandSignalId === b.signals.find((s) => s.portKey === tmpl.commandPort)?.id) : undefined;
    if (!act) return no(`템플릿 규칙 대상 ${r.child}.${r.action} 해석 실패 — 배치 취소`);
    for (const pr of r.pre) { const s = sig(pr.child, pr.port); if (!s) return no(`템플릿 규칙 조건 ${pr.child}.${pr.port} 해석 실패 — 배치 취소`); act.pre.push({ kind: 'signal', signalId: s.id, equals: pr.equals }); }
    act.note = `유닛 템플릿 ${def.id}@${def.version} 규칙에서 생성된 사전조건 (가정, 확인 필요)`;
  }
  fitUnit(p, u.id);
  return ok(p, u.id);
}

export function addDevice(p0: Project, kind: AssetKind, at: { x: number; y: number }, name?: string, idOf: (s: string) => string = newId, unitId?: string): CmdResult {
  const unit = unitId ? p0.units.find((u) => u.id === unitId) : unitAt(p0, at.x, at.y);
  if (!unit) return no(unitId ? '대상 Unit 없음' : 'Device는 Unit 영역 안에 놓아야 합니다 (Equipment > Unit > Device). 먼저 Unit을 배치하세요.');
  const p = clone(p0);
  const b = instantiateDevice(kind, unit.id, at, name, idOf);
  p.devices.push(b.device); p.signals.push(...b.signals); p.positions.push(...b.positions); p.actions.push(...b.actions);
  p.units.find((u) => u.id === unit.id)!.deviceIds.push(b.device.id);
  fitUnit(p, unit.id);
  return ok(p, b.device.id);
}

/** Move canvas nodes by delta (one undo unit). Moving a Unit moves its Devices along (coordinate move only, no hierarchy change). */
export function moveNodes(p0: Project, ids: string[], dx: number, dy: number): CmdResult {
  if (!ids.length || (dx === 0 && dy === 0)) return no('이동 없음');
  const p = clone(p0);
  const moved = new Set<string>();
  const mv = (l: { x: number; y: number }) => { l.x = Math.round(l.x + dx); l.y = Math.round(l.y + dy); };
  for (const id of ids) {
    const u = p.units.find((x) => x.id === id);
    if (u) { mv(u.layout); moved.add(u.id); for (const d of p.devices) if (d.unitId === u.id && !moved.has(d.id)) { mv(d.layout); moved.add(d.id); } }
  }
  for (const id of ids) {
    const d = p.devices.find((x) => x.id === id);
    if (d && !moved.has(d.id)) { mv(d.layout); moved.add(d.id); }
  }
  const grow = new Set<string>();
  for (const d of p.devices) if (moved.has(d.id) && !moved.has(d.unitId)) grow.add(d.unitId);
  for (const id of grow) fitUnit(p, id);
  return ok(p);
}

export function alignNodes(p0: Project, ids: string[], mode: 'left' | 'top'): CmdResult {
  const devs = p0.devices.filter((d) => ids.includes(d.id));
  const units = p0.units.filter((u) => ids.includes(u.id));
  const items = [...devs.map((d) => d.layout), ...units.map((u) => u.layout)];
  if (items.length < 2) return no('정렬하려면 두 개 이상 선택하세요');
  const p = clone(p0);
  const v = Math.min(...items.map((l) => (mode === 'left' ? l.x : l.y)));
  for (const d of p.devices) if (ids.includes(d.id)) { if (mode === 'left') d.layout.x = v; else d.layout.y = v; }
  for (const u of p.units) if (ids.includes(u.id)) {
    const delta = mode === 'left' ? v - u.layout.x : v - u.layout.y;
    if (mode === 'left') u.layout.x = v; else u.layout.y = v;
    for (const d of p.devices) if (d.unitId === u.id && !ids.includes(d.id)) { if (mode === 'left') d.layout.x += delta; else d.layout.y += delta; }
  }
  const grow = new Set<string>();
  for (const d of p.devices) if (ids.includes(d.id)) grow.add(d.unitId);
  for (const id of grow) fitUnit(p, id);
  return ok(p);
}

/** Shown on the duplicate button when the selection has no Device. */
export const DUPLICATE_NEED_DEVICE = 'Device 를 고르세요';

/** User-facing refusal when a Unit arrange command has nothing to do. */
export const ARRANGE_UNCHANGED = '바뀐 것 없음';
export const ARRANGE_NEED_2 = 'Unit 을 2개 이상 고르세요';
export const ARRANGE_NEED_3 = 'Unit 을 3개 이상 고르세요';
/** Shown with a successful distribute when the equal gap is still an overlap. */
export const ARRANGE_OVERLAP_HINT = '먼저 겹침 풀기를 누르세요';
/** 「겹침 풀기」 minimum horizontal gap. Same pitch as the 5-step sample (236 − 216). */
export const UNIT_SPREAD_GAP = 20;

type ArrangeAxis = 'x' | 'y';

function pickedUnits(p: Project, ids: string[]): Unit[] {
  const want = new Set(ids);
  return p.units.filter((u) => want.has(u.id));
}

function sortUnits(units: Unit[], axis: ArrangeAxis): Unit[] {
  const other: ArrangeAxis = axis === 'x' ? 'y' : 'x';
  return [...units].sort((a, b) => a.layout[axis] - b.layout[axis] || a.layout[other] - b.layout[other] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Move a Unit and every Device that belongs to it. Devices named in the selection are not a separate target. */
function shiftUnit(unit: Unit, devices: Device[], dx: number, dy: number): boolean {
  const mx = Math.round(dx);
  const my = Math.round(dy);
  if (mx === 0 && my === 0) return false;
  unit.layout.x += mx;
  unit.layout.y += my;
  for (const d of devices) if (d.unitId === unit.id) { d.layout.x += mx; d.layout.y += my; }
  return true;
}

/**
 * PowerPoint-style distribute. The first and last Unit on `axis` stay put.
 * Middles move so the empty gap between neighbors (previous far edge → next near edge) is equal.
 * The other axis is unchanged. Fewer than 3 Units is refused. Devices in `ids` are ignored.
 */
export function distributeUnits(p0: Project, ids: string[], axis: ArrangeAxis): CmdResult {
  if (pickedUnits(p0, ids).length < 3) return no(ARRANGE_NEED_3);
  const p = clone(p0);
  const sorted = sortUnits(pickedUnits(p, ids), axis);
  const size = axis === 'x' ? 'w' : 'h';
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const gapCount = sorted.length - 1;
  const middleSum = sorted.slice(1, -1).reduce((sum, u) => sum + u.layout[size], 0);
  const span = last.layout[axis] - (first.layout[axis] + first.layout[size]);
  const gap = (span - middleSum) / gapCount;
  const start = first.layout[axis] + first.layout[size];
  let changed = false;
  let placed = 0;
  for (let i = 1; i < sorted.length - 1; i++) {
    const ideal = start + i * gap + placed;
    const delta = Math.round(ideal) - sorted[i].layout[axis];
    const moved = axis === 'x' ? shiftUnit(sorted[i], p.devices, delta, 0) : shiftUnit(sorted[i], p.devices, 0, delta);
    changed = moved || changed;
    placed += sorted[i].layout[size];
  }
  if (!changed) return no(ARRANGE_UNCHANGED);
  const overlaps = sorted.some((u, i) => i > 0 && u.layout[axis] < sorted[i - 1].layout[axis] + sorted[i - 1].layout[size]);
  return ok(p, overlaps ? ARRANGE_OVERLAP_HINT : undefined);
}

/**
 * Match the chosen side to the largest selected Unit. Origin stays.
 * Never smaller than `unitMinSize`, so a Device is not cut. Devices in `ids` are ignored.
 */
export function matchUnitSize(p0: Project, ids: string[], dim: 'w' | 'h'): CmdResult {
  const picked = pickedUnits(p0, ids);
  if (picked.length < 2) return no(ARRANGE_NEED_2);
  const target = Math.max(...picked.map((u) => u.layout[dim]));
  const p = clone(p0);
  let changed = false;
  for (const u of pickedUnits(p, ids)) {
    const min = unitMinSize(p, u.id);
    const next = Math.round(Math.max(target, dim === 'w' ? min.w : min.h));
    if (u.layout[dim] !== next) { u.layout[dim] = next; changed = true; }
  }
  if (!changed) return no(ARRANGE_UNCHANGED);
  return ok(p);
}

/**
 * Push selected Units to the right until each neighbor gap is at least `gap`.
 * Order is x. The leftmost Unit stays. A Unit that is already far enough stays. y stays.
 * Units that were not selected do not move. Devices in `ids` are ignored.
 */
export function spreadUnits(p0: Project, ids: string[], gap: number): CmdResult {
  if (pickedUnits(p0, ids).length < 2) return no(ARRANGE_NEED_2);
  if (!Number.isFinite(gap) || gap < 0) return no('간격이 올바르지 않습니다');
  const p = clone(p0);
  const sorted = sortUnits(pickedUnits(p, ids), 'x');
  let changed = false;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const space = cur.layout.x - (prev.layout.x + prev.layout.w);
    if (space < gap) changed = shiftUnit(cur, p.devices, prev.layout.x + prev.layout.w + gap - cur.layout.x, 0) || changed;
  }
  if (!changed) return no(ARRANGE_UNCHANGED);
  return ok(p);
}

export interface Impact { actions: Action[]; steps: SequenceStep[]; connections: Connection[]; materials: Material[]; constraints: string[]; subSteps: { seq: string; step: SequenceStep }[]; subSequences: SubstationSequence[] }

export function impactOf(p: Project, id: string): Impact {
  const isUnit = p.units.some((u) => u.id === id);
  const deviceIds = isUnit ? p.devices.filter((d) => d.unitId === id).map((d) => d.id) : [id];
  const sigIds = p.signals.filter((s) => deviceIds.includes(s.deviceId)).map((s) => s.id);
  const actions = p.actions.filter((a) => deviceIds.includes(a.deviceId) || a.unitId === id
    || (a.effect.moveTo === id) || a.pre.concat(a.post).some((c) => (c.kind === 'materialAt' && c.unitId === id) || (c.kind === 'signal' && sigIds.includes(c.signalId)) || (c.kind === 'materialHeldBy' && c.deviceId !== null && deviceIds.includes(c.deviceId))));
  const actionIds = actions.map((a) => a.id);
  return {
    actions,
    steps: p.sequence.steps.filter((s) => actionIds.includes(s.actionId)),
    connections: p.connections.filter((c) => [id, ...deviceIds].includes(c.from.nodeId) || [id, ...deviceIds].includes(c.to.nodeId)),
    materials: isUnit ? p.materials.filter((m) => m.route.includes(id) || m.initialLocation === id) : [],
    constraints: p.constraints.filter((k) => k.relatedIds.some((r) => [id, ...deviceIds].includes(r))).map((k) => k.id),
    subSteps: (p.substationSequences ?? []).flatMap((q) => q.steps.filter((s) => actionIds.includes(s.actionId)).map((step) => ({ seq: q.name, step }))),
    subSequences: isUnit ? (p.substationSequences ?? []).filter((q) => q.unitId === id) : [],
  };
}

/** Units in `ids`, plus Devices in `ids` whose Unit is not also being deleted. Child Devices of a deleted Unit are removed with the Unit, once. */
function resolveDelete(p: Project, ids: string[]): { unitIds: string[]; looseDeviceIds: string[]; deviceIds: string[] } {
  const want = new Set(ids);
  const unitIds = p.units.filter((u) => want.has(u.id)).map((u) => u.id);
  const unitSet = new Set(unitIds);
  const looseDeviceIds = p.devices.filter((d) => want.has(d.id) && !unitSet.has(d.unitId)).map((d) => d.id);
  const looseSet = new Set(looseDeviceIds);
  const deviceIds = p.devices.filter((d) => unitSet.has(d.unitId) || looseSet.has(d.id)).map((d) => d.id);
  return { unitIds, looseDeviceIds, deviceIds };
}

export interface NodesImpact { units: number; devices: number; actions: number; steps: number; connections: number; subSequences: number }

/** Combined impact of `deleteNodes`. A Device selected together with its Unit is counted once. */
export function impactOfNodes(p: Project, ids: string[]): NodesImpact {
  const t = resolveDelete(p, ids);
  const unitSet = new Set(t.unitIds);
  const deviceSet = new Set(t.deviceIds);
  const actions = p.actions.filter((a) => deviceSet.has(a.deviceId) || unitSet.has(a.unitId));
  const actionIds = new Set(actions.map((a) => a.id));
  return {
    units: t.unitIds.length,
    devices: t.deviceIds.length,
    actions: actions.length,
    steps: p.sequence.steps.filter((s) => actionIds.has(s.actionId)).length,
    connections: p.connections.filter((c) => unitSet.has(c.from.nodeId) || unitSet.has(c.to.nodeId) || deviceSet.has(c.from.nodeId) || deviceSet.has(c.to.nodeId)).length,
    subSequences: (p.substationSequences ?? []).filter((q) => unitSet.has(q.unitId)).length,
  };
}

/**
 * Remove the resolved Units and Devices from a cloned project. One pass: a Device that belongs to a deleted Unit
 * is not removed again. Conditions in surviving Actions become explicit 'undefined' (never silently true).
 */
function eraseNodes(p: Project, unitIds: string[], looseDeviceIds: string[]): void {
  const unitSet = new Set(unitIds);
  const looseSet = new Set(looseDeviceIds);
  const deviceIds = p.devices.filter((d) => unitSet.has(d.unitId) || looseSet.has(d.id)).map((d) => d.id);
  const deviceSet = new Set(deviceIds);
  const sigIds = new Set(p.signals.filter((s) => deviceSet.has(s.deviceId)).map((s) => s.id));
  const removedActions = new Set(p.actions.filter((a) => deviceSet.has(a.deviceId) || unitSet.has(a.unitId)).map((a) => a.id));
  const nodeSet = new Set<string>([...unitIds, ...deviceIds]);
  p.devices = p.devices.filter((d) => !deviceSet.has(d.id));
  p.signals = p.signals.filter((s) => !sigIds.has(s.id));
  p.positions = p.positions.filter((x) => !deviceSet.has(x.deviceId));
  p.actions = p.actions.filter((a) => !removedActions.has(a.id));
  p.sequence.steps = p.sequence.steps.filter((s) => !removedActions.has(s.actionId));
  p.substationSequences = (p.substationSequences ?? []).filter((q) => !unitSet.has(q.unitId));
  for (const q of p.substationSequences) q.steps = q.steps.filter((s) => !removedActions.has(s.actionId));
  const fixCond = (c: Condition): Condition => {
    if (c.kind === 'signal' && sigIds.has(c.signalId)) return { kind: 'undefined', note: `삭제된 Signal ${c.signalId} 참조 해제됨` };
    if (c.kind === 'materialAt' && unitSet.has(c.unitId)) return { kind: 'undefined', note: `삭제된 Unit ${c.unitId} 참조 해제됨` };
    if (c.kind === 'materialHeldBy' && c.deviceId && deviceSet.has(c.deviceId)) return { kind: 'undefined', note: `삭제된 Device ${c.deviceId} 참조 해제됨` };
    return c;
  };
  for (const a of p.actions) {
    a.pre = a.pre.map(fixCond); a.post = a.post.map(fixCond);
    if (a.effect.moveTo && unitSet.has(a.effect.moveTo)) {
      const gone = a.effect.moveTo;
      delete a.effect.moveTo;
      a.pre.push({ kind: 'undefined', note: `이동 대상 Unit ${gone} 삭제됨 — 대체 필요` });
    }
    if (a.effect.holder && deviceSet.has(a.effect.holder)) a.effect.holder = null;
  }
  for (const s of p.sequence.steps) s.entry = s.entry.map(fixCond);
  for (const q of p.substationSequences) for (const s of q.steps) s.entry = s.entry.map(fixCond);
  p.connections = p.connections.filter((c) => !nodeSet.has(c.from.nodeId) && !nodeSet.has(c.to.nodeId));
  for (const k of p.constraints) k.relatedIds = k.relatedIds.filter((r) => !nodeSet.has(r));
  if (unitIds.length) {
    p.units = p.units.filter((u) => !unitSet.has(u.id));
    p.equipment.unitIds = p.equipment.unitIds.filter((u) => !unitSet.has(u));
    for (const m of p.materials) {
      m.route = m.route.filter((r) => !unitSet.has(r));
      if (m.initialLocation && unitSet.has(m.initialLocation)) m.initialLocation = null;
    }
  }
  for (const u of p.units) u.deviceIds = u.deviceIds.filter((d) => !deviceSet.has(d));
}

/**
 * Delete a Unit or Device after the user explicitly confirmed the impact list (참조 해제 후 삭제).
 * Actions owned by deleted devices and steps calling them are removed; conditions in OTHER actions that referenced
 * deleted objects are replaced by explicit 'undefined' conditions (not silently true) so the gap stays visible.
 */
export function deleteNode(p0: Project, id: string): CmdResult {
  const isUnit = p0.units.some((u) => u.id === id);
  const isDev = p0.devices.some((d) => d.id === id);
  if (!isUnit && !isDev) return no(`삭제 대상 ${id} 없음`);
  const p = clone(p0);
  eraseNodes(p, isUnit ? [id] : [], isUnit ? [] : [id]);
  return ok(p);
}

/** Delete every listed Unit and Device in one revision. A Device whose Unit is also listed is removed only with that Unit. */
export function deleteNodes(p0: Project, ids: string[]): CmdResult {
  const t = resolveDelete(p0, ids);
  if (!t.unitIds.length && !t.looseDeviceIds.length) return no('삭제 대상 없음');
  const p = clone(p0);
  eraseNodes(p, t.unitIds, t.looseDeviceIds);
  return ok(p);
}

function duplicateName(taken: Set<string>, name: string): string {
  const first = `${name} 사본`;
  if (!taken.has(first)) return first;
  let n = 2;
  while (taken.has(`${name} 사본 ${n}`)) n += 1;
  return `${name} 사본 ${n}`;
}

function remapId(id: string | null, map: Map<string, string>): string | null {
  if (!id) return id;
  return map.get(id) ?? id;
}

/**
 * Rewrite a copy's own references. Another Device's signal or holder stays.
 * The tail is whatever `duplicateName` appended (` 사본`, ` 사본 2`, …).
 */
function copiedObjectName(original: string, sourceName: string, copyName: string): string {
  const tail = copyName.slice(sourceName.length);
  if (sourceName && original.startsWith(sourceName)) return copyName + original.slice(sourceName.length);
  return original + tail;
}

function remapCond(c: Condition, sigMap: Map<string, string>, srcId: string, copyId: string): Condition {
  if (c.kind === 'signal' && sigMap.has(c.signalId)) return { ...c, signalId: sigMap.get(c.signalId)! };
  if (c.kind === 'materialHeldBy' && c.deviceId === srcId) return { ...c, deviceId: copyId };
  return c;
}

/**
 * Copy each Device in `ids` (Units in the list are ignored) into the next free slot of its own Unit.
 * Signals, positions, and actions are copied with new ids. A copy's own signal, position, holder,
 * and materialHeldBy references point at the copy. Connections, sequence steps, and templateChild are not.
 * `note` is the new Device ids, comma-separated, in selection order. One revision.
 */
export function duplicateDevices(p0: Project, ids: string[], idOf: (s: string) => string = newId): CmdResult {
  const seen = new Set<string>();
  const sources: Device[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const d = p0.devices.find((x) => x.id === id);
    if (!d) continue;
    seen.add(id);
    sources.push(d);
  }
  if (!sources.length) return no(DUPLICATE_NEED_DEVICE);
  const p = clone(p0);
  const taken = new Set(p.devices.map((d) => d.name));
  const created: string[] = [];
  const units = new Set<string>();
  for (const src0 of sources) {
    const src = p.devices.find((d) => d.id === src0.id)!;
    const slot = nextDeviceSlot(p, src.unitId, src.kind);
    const nid = idOf('dev');
    const name = duplicateName(taken, src.name);
    taken.add(name);
    const device: Device = structuredClone(src);
    device.id = nid;
    device.name = name;
    device.layout = { x: slot.x, y: slot.y, w: src.layout.w, h: src.layout.h };
    device.lineage = { duplicatedFrom: src.id };
    delete device.templateChild;
    p.devices.push(device);
    p.units.find((u) => u.id === src.unitId)?.deviceIds.push(nid);
    const sigMap = new Map<string, string>();
    for (const s of p.signals.filter((x) => x.deviceId === src.id)) {
      const id = idOf('sig');
      sigMap.set(s.id, id);
      const copy = structuredClone(s);
      copy.id = id;
      copy.name = copiedObjectName(s.name, src.name, name);
      copy.deviceId = nid;
      p.signals.push(copy);
    }
    const posMap = new Map<string, string>();
    for (const s of p.positions.filter((x) => x.deviceId === src.id)) {
      const id = idOf('pos');
      posMap.set(s.id, id);
      const copy = structuredClone(s);
      copy.id = id;
      copy.deviceId = nid;
      p.positions.push(copy);
    }
    for (const a of p.actions.filter((x) => x.deviceId === src.id)) {
      const copy = structuredClone(a);
      copy.id = idOf('act');
      copy.name = copiedObjectName(a.name, src.name, name);
      copy.deviceId = nid;
      copy.unitId = src.unitId;
      copy.commandSignalId = remapId(copy.commandSignalId, sigMap);
      copy.completeSignalId = remapId(copy.completeSignalId, sigMap);
      copy.targetPositionId = remapId(copy.targetPositionId, posMap);
      if (copy.effect.holder === src.id) copy.effect.holder = nid;
      copy.pre = copy.pre.map((c) => remapCond(c, sigMap, src.id, nid));
      copy.post = copy.post.map((c) => remapCond(c, sigMap, src.id, nid));
      p.actions.push(copy);
    }
    created.push(nid);
    units.add(src.unitId);
  }
  for (const id of units) fitUnit(p, id);
  return ok(p, created.join(','));
}

/** Reassign a Device to another Unit (hierarchy move). Caller must show impactOf() first. */
export function reparentDevice(p0: Project, deviceId: string, newUnitId: string, at?: { x: number; y: number }): CmdResult {
  const d0 = p0.devices.find((d) => d.id === deviceId);
  if (!d0) return no('Device 없음');
  if (!p0.units.some((u) => u.id === newUnitId)) return no('대상 Unit 없음');
  if (d0.unitId === newUnitId) return no('같은 Unit');
  const p = clone(p0);
  const d = p.devices.find((x) => x.id === deviceId)!;
  for (const u of p.units) u.deviceIds = u.deviceIds.filter((x) => x !== deviceId);
  p.units.find((u) => u.id === newUnitId)!.deviceIds.push(deviceId);
  d.unitId = newUnitId;
  if (at) { d.layout.x = Math.round(at.x); d.layout.y = Math.round(at.y); }
  for (const a of p.actions) if (a.deviceId === deviceId) a.unitId = newUnitId;
  fitUnit(p, newUnitId);
  return ok(p);
}

/** Bottom-right resize. x/y stay. Smaller than the Devices (plus header and pad) is clamped, not applied as a cut. */
export function resizeUnit(p0: Project, unitId: string, w: number, h: number): CmdResult {
  const u0 = p0.units.find((u) => u.id === unitId);
  if (!u0) return no('Unit 없음');
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return no('크기가 올바르지 않습니다');
  const min = unitMinSize(p0, unitId);
  const nw = Math.round(Math.max(w, min.w));
  const nh = Math.round(Math.max(h, min.h));
  if (nw === u0.layout.w && nh === u0.layout.h) return no('크기 변화 없음');
  const p = clone(p0);
  const u = p.units.find((x) => x.id === unitId)!;
  u.layout.w = nw;
  u.layout.h = nh;
  return ok(p);
}

/** 「크기 맞춤」: shrink (or snap) to the Devices. Empty unit returns to 216×300. One undo step. */
export function fitUnitToContent(p0: Project, unitId: string): CmdResult {
  const u0 = p0.units.find((u) => u.id === unitId);
  if (!u0) return no('Unit 없음');
  const layout = tightUnitLayout(p0, unitId);
  if (!layout) return no('Unit 없음');
  if (layout.x === u0.layout.x && layout.y === u0.layout.y && layout.w === u0.layout.w && layout.h === u0.layout.h) return no('크기 변화 없음');
  const p = clone(p0);
  p.units.find((u) => u.id === unitId)!.layout = layout;
  return ok(p);
}

export function addConnection(p0: Project, kind: 'flow' | 'signal', fromId: string, toId: string, idOf: (s: string) => string = newId): CmdResult {
  if (fromId === toId) return no('자기 자신과 연결할 수 없습니다');
  if (kind === 'flow') {
    const a = p0.units.find((u) => u.id === fromId); const b = p0.units.find((u) => u.id === toId);
    if (!a || !b) return no('물류 흐름 연결은 Unit → Unit만 허용됩니다 (시제품 규칙)');
    if (p0.connections.some((c) => c.kind === 'flow' && c.from.nodeId === fromId && c.to.nodeId === toId)) return no('이미 같은 물류 연결이 있습니다');
    const p = clone(p0);
    p.connections.push({ id: idOf('flow'), kind, from: { nodeId: fromId }, to: { nodeId: toId } });
    return ok(p);
  }
  const s1 = p0.signals.find((s) => s.id === fromId); const s2 = p0.signals.find((s) => s.id === toId);
  if (!s1 || !s2) return no('신호 연결은 Signal 포트끼리만 가능합니다');
  if (s1.direction !== 'out') return no(`출발 포트 ${s1.name}는 입력(in) 포트입니다. 출력(out) → 입력(in) 방향만 허용됩니다`);
  if (s2.direction !== 'in') return no(`도착 포트 ${s2.name}는 출력(out) 포트입니다. 출력(out) → 입력(in) 방향만 허용됩니다`);
  if (s1.deviceId === s2.deviceId) return no('같은 Device 내부 포트끼리는 연결하지 않습니다 (시제품 규칙)');
  if (p0.connections.some((c) => c.kind === 'signal' && c.from.signalId === fromId && c.to.signalId === toId)) return no('이미 같은 신호 연결이 있습니다');
  const p = clone(p0);
  p.connections.push({ id: idOf('sigc'), kind, from: { nodeId: s1.deviceId, signalId: s1.id }, to: { nodeId: s2.deviceId, signalId: s2.id } });
  return ok(p);
}

export function deleteConnection(p0: Project, id: string): CmdResult {
  if (!p0.connections.some((c) => c.id === id)) return no('연결 없음');
  const p = clone(p0); p.connections = p.connections.filter((c) => c.id !== id); return ok(p);
}

export function renameObject(p0: Project, id: string, name: string): CmdResult {
  if (!name.trim()) return no('이름은 비울 수 없습니다');
  const p = clone(p0);
  const lists: { id: string; name: string }[][] = [p.units, p.devices, p.signals, p.positions, p.actions, p.materials, p.sequence.steps];
  for (const l of lists) { const o = l.find((x) => x.id === id); if (o) { o.name = name; return ok(p); } }
  return no('대상 없음');
}

function parseNum(v: string | number | null): number | null | 'invalid' {
  if (v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 'invalid';
}

export function setDeviceProperty(p0: Project, deviceId: string, key: string, value: string | number | null, assumption: boolean): CmdResult {
  const n = parseNum(value);
  if (n === 'invalid') return no('숫자가 아닙니다 (빈 값 = 미정)');
  if (n !== null && n < 0) return no('음수는 허용되지 않습니다');
  const p = clone(p0);
  const d = p.devices.find((x) => x.id === deviceId); if (!d) return no('Device 없음');
  const prev = d.properties[key]; if (!prev) return no('속성 없음');
  d.properties[key] = { ...prev, value: n, assumption, source: { method: 'direct-input' }, history: [...(prev.history ?? []), { at: `rev${p.revision + 1}`, from: prev.value, to: n, assumption }] };
  return ok(p);
}

export function setQuantity(p0: Project, path: { kind: 'action'; id: string; field: 'duration' | 'timeout' } | { kind: 'position'; id: string } | { kind: 'unitCap'; id: string; field: 'maxMaterials' | 'maxWeight' } | { kind: 'material'; id: string; field: 'weight' | 'feedInterval' | 'w' | 'l' | 'h' } | { kind: 'stepTimeout'; id: string }, value: string | number | null, assumption: boolean): CmdResult {
  const n = parseNum(value);
  if (n === 'invalid') return no('숫자가 아닙니다 (빈 값 = 미정)');
  if (n !== null && n < 0) return no('음수는 허용되지 않습니다');
  const p = clone(p0);
  const upd = (prev: Quantity): Quantity => ({ ...prev, value: n, assumption, source: { method: 'direct-input' }, history: [...(prev.history ?? []), { at: `rev${p.revision + 1}`, from: prev.value, to: n, assumption }] });
  if (path.kind === 'action') { const a = p.actions.find((x) => x.id === path.id); if (!a) return no('Action 없음'); a[path.field] = upd(a[path.field]); }
  else if (path.kind === 'position') { const x = p.positions.find((y) => y.id === path.id); if (!x) return no('Position 없음'); x.value = upd(x.value); }
  else if (path.kind === 'unitCap') { const u = p.units.find((y) => y.id === path.id); if (!u) return no('Unit 없음'); u.capacity[path.field] = upd(u.capacity[path.field]); }
  else if (path.kind === 'stepTimeout') {
    const s = p.sequence.steps.find((y) => y.id === path.id); if (!s) return no('단계 없음');
    s.timeoutOverride = n === null && value === null ? null : upd(s.timeoutOverride ?? q(null, 's'));
  } else {
    const m = p.materials.find((y) => y.id === path.id); if (!m) return no('자재 없음');
    if (path.field === 'weight') m.weight = upd(m.weight);
    else if (path.field === 'feedInterval') m.feedInterval = upd(m.feedInterval);
    else m.size[path.field] = upd(m.size[path.field]);
  }
  return ok(p);
}

export function updateAction(p0: Project, id: string, patch: Partial<Pick<Action, 'commandSignalId' | 'completeSignalId' | 'targetPositionId' | 'pre' | 'post' | 'effect' | 'name' | 'note'>>): CmdResult {
  const p = clone(p0);
  const a = p.actions.find((x) => x.id === id); if (!a) return no('Action 없음');
  for (const k of ['commandSignalId', 'completeSignalId'] as const) {
    const v = patch[k];
    if (v !== undefined && v !== null) {
      const sg = p.signals.find((s) => s.id === v);
      if (!sg) return no('없는 Signal');
      if (k === 'completeSignalId' && sg.direction !== 'out') return no('완료 Signal은 Device 출력(out) Signal이어야 합니다');
      if (k === 'commandSignalId' && sg.direction !== 'in') return no('명령 Signal은 Device 입력(in) Signal이어야 합니다');
    }
  }
  Object.assign(a, patch);
  return ok(p);
}

export function addAction(p0: Project, deviceId: string, idOf: (s: string) => string = newId): CmdResult {
  const d = p0.devices.find((x) => x.id === deviceId); if (!d) return no('Device 없음');
  const p = clone(p0);
  const a: Action = { id: idOf('act'), name: `${d.name} 새 Action`, unitId: d.unitId, deviceId, kind: 'work', params: {},
    duration: q(null, 's'), timeout: q(null, 's'), commandSignalId: null, completeSignalId: null, targetPositionId: null, pre: [], post: [], effect: {} };
  p.actions.push(a);
  return ok(p, a.id);
}

export function deleteAction(p0: Project, id: string): CmdResult {
  if (!p0.actions.some((a) => a.id === id)) return no('Action 없음');
  const used = [...p0.sequence.steps, ...(p0.substationSequences ?? []).flatMap((q) => q.steps)].filter((s) => s.actionId === id);
  if (used.length) return no(`사용 중인 Action입니다. 영향 단계: ${used.map((s) => s.name).join(', ')} — 먼저 단계를 제거하세요`);
  const p = clone(p0); p.actions = p.actions.filter((a) => a.id !== id); return ok(p);
}

export function addSignal(p0: Project, deviceId: string, direction: 'in' | 'out', role: Signal['role'], idOf: (s: string) => string = newId): CmdResult {
  const d = p0.devices.find((x) => x.id === deviceId); if (!d) return no('Device 없음');
  const p = clone(p0);
  const s: Signal = { id: idOf('sig'), name: `${d.name}.새 신호`, deviceId, portKey: null, direction, valueType: 'bool', role, address: null, addressStatus: 'unassigned' };
  p.signals.push(s); return ok(p, s.id);
}

export function updateSignal(p0: Project, id: string, patch: Partial<Pick<Signal, 'name' | 'direction' | 'role' | 'address' | 'addressStatus'>>): CmdResult {
  const p = clone(p0); const s = p.signals.find((x) => x.id === id); if (!s) return no('Signal 없음');
  Object.assign(s, patch);
  if (patch.address !== undefined) { s.address = patch.address || null; if (!s.address) s.addressStatus = 'unassigned'; else if (s.addressStatus === 'unassigned') s.addressStatus = 'assumed'; }
  return ok(p);
}

export function deleteSignal(p0: Project, id: string): CmdResult {
  const users = p0.actions.filter((a) => a.commandSignalId === id || a.completeSignalId === id || a.pre.concat(a.post).some((c) => c.kind === 'signal' && c.signalId === id));
  if (users.length) return no(`사용 중인 Signal입니다: ${users.map((a) => a.name).join(', ')}`);
  const p = clone(p0); p.signals = p.signals.filter((s) => s.id !== id);
  p.connections = p.connections.filter((c) => c.from.signalId !== id && c.to.signalId !== id);
  return ok(p);
}

export function addPosition(p0: Project, deviceId: string, idOf: (s: string) => string = newId): CmdResult {
  const d = p0.devices.find((x) => x.id === deviceId); if (!d) return no('Device 없음');
  const p = clone(p0);
  const ps: Position = { id: idOf('pos'), name: `${d.name} 새 위치`, deviceId, value: q(null, 'mm') };
  p.positions.push(ps); return ok(p, ps.id);
}

export function deletePosition(p0: Project, id: string): CmdResult {
  const users = p0.actions.filter((a) => a.targetPositionId === id);
  if (users.length) return no(`사용 중인 Position입니다: ${users.map((a) => a.name).join(', ')}`);
  const p = clone(p0); p.positions = p.positions.filter((x) => x.id !== id); return ok(p);
}

// ---- sequence (F5) ----
export function addStep(p0: Project, actionId: string, index?: number, origin: SequenceStep['origin'] = 'dnd', sourceText?: string, idOf: (s: string) => string = newId): CmdResult {
  const a = p0.actions.find((x) => x.id === actionId); if (!a) return no('Action 없음');
  const p = clone(p0);
  const step: SequenceStep = { id: idOf('step'), name: a.name, actionId, timeoutOverride: null, entry: [], origin, ...(sourceText ? { sourceText } : {}) };
  const i = index === undefined ? p.sequence.steps.length : Math.max(0, Math.min(index, p.sequence.steps.length));
  p.sequence.steps.splice(i, 0, step);
  return ok(p, step.id);
}

export function moveStep(p0: Project, from: number, to: number): CmdResult {
  const n = p0.sequence.steps.length;
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) return no('이동 불가');
  const p = clone(p0); const [s] = p.sequence.steps.splice(from, 1); p.sequence.steps.splice(to, 0, s); return ok(p);
}

export function removeStep(p0: Project, stepId: string): CmdResult {
  if (!p0.sequence.steps.some((s) => s.id === stepId)) return no('단계 없음');
  const p = clone(p0); p.sequence.steps = p.sequence.steps.filter((s) => s.id !== stepId); return ok(p);
}

export function updateStep(p0: Project, stepId: string, patch: Partial<Pick<SequenceStep, 'name' | 'entry'>>): CmdResult {
  const p = clone(p0); const s = p.sequence.steps.find((x) => x.id === stepId); if (!s) return no('단계 없음');
  Object.assign(s, patch); return ok(p);
}

// ---- material (F4) ----
export function updateMaterial(p0: Project, id: string, patch: Partial<Pick<Material, 'name' | 'kind' | 'handling' | 'states' | 'initialState' | 'initialLocation' | 'route'>>): CmdResult {
  const p = clone(p0); const m = p.materials.find((x) => x.id === id); if (!m) return no('자재 없음');
  if (patch.route) for (const r of patch.route) if (!p.units.some((u) => u.id === r)) return no(`경로의 Unit ${r} 없음`);
  if (patch.initialLocation && !p.units.some((u) => u.id === patch.initialLocation)) return no('초기 위치 Unit 없음');
  Object.assign(m, patch);
  if (m.initialState && !m.states.includes(m.initialState)) return no('초기 상태는 상태집합 안에 있어야 합니다');
  return ok(p);
}

export function addMaterial(p0: Project, idOf: (s: string) => string = newId): CmdResult {
  const p = clone(p0);
  p.materials.push({ id: idOf('mat'), name: '새 자재', kind: 'individual', carrierOf: null, size: { w: q(null, 'mm'), l: q(null, 'mm'), h: q(null, 'mm') },
    weight: q(null, 'kg'), handling: '', states: ['대기'], initialState: '대기', initialLocation: p.units[0]?.id ?? null, route: p.units.map((u) => u.id), feedInterval: q(null, 's') });
  return ok(p);
}

// ---- constraints / interlock (human confirmation only) ----
export function setConstraintConfirmation(p0: Project, id: string, confirmation: 'confirmed' | 'rejected' | 'unconfirmed'): CmdResult {
  const p = clone(p0); const k = p.constraints.find((x) => x.id === id); if (!k) return no('제약 없음');
  k.confirmation = confirmation; return ok(p);
}

export function setFaults(p0: Project, faults: Project['simSettings']['faults']): CmdResult {
  const p = clone(p0); p.simSettings.faults = structuredClone(faults); return ok(p);
}

export function renameProject(p0: Project, name: string): CmdResult {
  if (!name.trim()) return no('이름 필요');
  const p = clone(p0); p.name = name; return ok(p);
}

export type { Device };

// ---- v0.3 Substation sequences (several per Unit, group Play/Pause/Resume) ----
const subs = (p: Project) => (p.substationSequences ??= []);
export function addSubSequence(p0: Project, unitId: string, name?: string, idOf: (s: string) => string = newId): CmdResult {
  const u = p0.units.find((x) => x.id === unitId); if (!u) return no('Substation(Unit) 없음');
  const p = clone(p0); const list = subs(p);
  const n = list.filter((q) => q.unitId === unitId).length + 1;
  const q: SubstationSequence = { id: idOf('sseq'), name: name?.trim() || `${u.code} 시퀀스 ${String.fromCharCode(64 + Math.min(n, 26))}`, unitId, steps: [], unresolved: [] };
  list.push(q); return ok(p, q.id);
}
export function renameSubSequence(p0: Project, seqId: string, name: string): CmdResult {
  if (!name.trim()) return no('이름이 비어 있음');
  const p = clone(p0); const q = subs(p).find((x) => x.id === seqId); if (!q) return no('시퀀스 없음');
  q.name = name.trim(); return ok(p);
}
export function deleteSubSequence(p0: Project, seqId: string): CmdResult {
  if (!(p0.substationSequences ?? []).some((q) => q.id === seqId)) return no('시퀀스 없음');
  const p = clone(p0); p.substationSequences = subs(p).filter((q) => q.id !== seqId); return ok(p);
}
/** Only Actions of Devices inside the same Substation can be added (cross-Substation Actions are rejected, not moved). */
export function addSubStep(p0: Project, seqId: string, actionId: string, idOf: (s: string) => string = newId): CmdResult {
  const q0 = (p0.substationSequences ?? []).find((x) => x.id === seqId); if (!q0) return no('시퀀스 없음');
  const a = p0.actions.find((x) => x.id === actionId); if (!a) return no('Action 없음');
  const dev = p0.devices.find((d) => d.id === a.deviceId);
  if (!dev || dev.unitId !== q0.unitId) return no(`${a.name}: 다른 Substation의 Device Action은 이 시퀀스에 넣을 수 없습니다`);
  const p = clone(p0); const q = subs(p).find((x) => x.id === seqId)!;
  q.steps.push({ id: idOf('sstep'), name: a.name, actionId, timeoutOverride: null, entry: [], origin: 'dnd' });
  return ok(p);
}
export function removeSubStep(p0: Project, seqId: string, stepId: string): CmdResult {
  const p = clone(p0); const q = subs(p).find((x) => x.id === seqId); if (!q || !q.steps.some((s) => s.id === stepId)) return no('단계 없음');
  q.steps = q.steps.filter((s) => s.id !== stepId); return ok(p);
}
export function moveSubStep(p0: Project, seqId: string, from: number, to: number): CmdResult {
  const q0 = (p0.substationSequences ?? []).find((x) => x.id === seqId); if (!q0) return no('시퀀스 없음');
  if (from < 0 || from >= q0.steps.length || to < 0 || to >= q0.steps.length || from === to) return no('이동 범위 오류');
  const p = clone(p0); const q = subs(p).find((x) => x.id === seqId)!; const [s] = q.steps.splice(from, 1); q.steps.splice(to, 0, s); return ok(p);
}
