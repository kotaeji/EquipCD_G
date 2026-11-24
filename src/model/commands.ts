// Pure model editing commands (F2/F3/F4/F5). Each returns a new Project or a rejection; never mutates input.
import { findAsset, getAssetById } from '../assets/library';
import { instantiateDevice, makeUnit, newId } from './factory';
import { devicesOfRule, releaseBrokenInterlocks } from './interlock';
import {
  addressConfirmationChange, addressWord, appendConfirmation, assumptionWord, candidateConfirmationChange, confirmationWord,
  CONFIRMER_REQUIRED, gapConfirmationChange, gapStatusWord, interlockConfirmationChange, quantityConfirmationChange, quantityName, takeStamp,
  type ConfirmStamp,
} from './confirmationLog';
import type { Action, AssetKind, Candidate, Condition, Connection, Device, FlowNode, GapReviewEntry, InterlockRule, Material, Position, Project, Quantity, QuantityRef, SequenceStep, Signal, SubstationSequence, Unit } from './types';
import { DEFAULT_MAX_RETRIES, q } from './types';
import { armLists, branchArms, branchFromArms, containsList, containsParallel, findById, findConsecutive, findOwner, linearFlow, listInsideParallel, MAX_BRANCH_ARMS, moveNodeBy, moveNodeTo, scrubFlow, unwrapBlock, wrapStepNodes, type BranchArm } from './flow';
import { arrangeUnitDevices } from './deviceArrange';
import { MAX_MATERIAL_DEFS, materialMark, nextMark, patternFromCounts } from './materialMix';
import { UNIT_DEFAULT_H, UNIT_DEFAULT_W, fitUnit, nextDeviceSlot, rectsOverlap, tightUnitLayout, unitMinSize } from './unitLayout';

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

/** Shown when an arrange command skips locked Units and moves the rest. */
export function lockedExcludedNote(count: number): string {
  return `잠긴 Unit ${count}개는 제외`;
}

export function isPositionLocked(u: { positionLocked?: boolean } | undefined): boolean {
  return u?.positionLocked === true;
}

const LOCKED_RESIZE = '위치 잠금된 Unit은 크기를 바꾸지 않습니다';

function lockedUnitIds(p: Project): Set<string> {
  return new Set(p.units.filter((u) => u.positionLocked === true).map((u) => u.id));
}

function joinNote(a?: string, b?: string): string | undefined {
  if (a && b) return `${a}. ${b}`;
  return a || b || undefined;
}

/** Move canvas nodes by delta (one undo unit). Moving a Unit moves its Devices along (coordinate move only, no hierarchy change). A locked Unit stays put. */
export function moveNodes(p0: Project, ids: string[], dx: number, dy: number): CmdResult {
  if (!ids.length || (dx === 0 && dy === 0)) return no('이동 없음');
  const p = clone(p0);
  const moved = new Set<string>();
  const locked = lockedUnitIds(p);
  let sawMovable = false;
  let sawLocked = false;
  const mv = (l: { x: number; y: number }) => { l.x = Math.round(l.x + dx); l.y = Math.round(l.y + dy); };
  for (const id of ids) {
    const u = p.units.find((x) => x.id === id);
    if (!u) continue;
    if (locked.has(u.id)) { sawLocked = true; continue; }
    sawMovable = true;
    mv(u.layout); moved.add(u.id);
    for (const d of p.devices) if (d.unitId === u.id && !moved.has(d.id)) { mv(d.layout); moved.add(d.id); }
  }
  for (const id of ids) {
    const d = p.devices.find((x) => x.id === id);
    if (d && !moved.has(d.id)) { sawMovable = true; mv(d.layout); moved.add(d.id); }
  }
  if (!sawMovable) return sawLocked ? no('이동 없음') : ok(p);
  const grow = new Set<string>();
  for (const d of p.devices) if (moved.has(d.id) && !moved.has(d.unitId)) grow.add(d.unitId);
  for (const id of grow) if (!locked.has(id)) fitUnit(p, id);
  return ok(p);
}

/** Lock or unlock the named Units. One undo. Units that are already in that state are skipped. */
export function setUnitPositionLock(p0: Project, ids: string[], locked: boolean): CmdResult {
  const want = new Set(ids);
  const targets = p0.units.filter((u) => want.has(u.id) && (u.positionLocked === true) !== locked);
  if (!targets.length) return no(locked ? '이미 잠겨 있습니다' : '잠긴 Unit이 없습니다');
  const p = clone(p0);
  for (const u of p.units) {
    if (!want.has(u.id)) continue;
    if (locked) u.positionLocked = true;
    else delete u.positionLocked;
  }
  return ok(p);
}

/** Lock or unlock every Unit. One undo. */
export function setAllUnitPositionLock(p0: Project, locked: boolean): CmdResult {
  return setUnitPositionLock(p0, p0.units.map((u) => u.id), locked);
}

export function alignNodes(p0: Project, ids: string[], mode: 'left' | 'top'): CmdResult {
  const locked = lockedUnitIds(p0);
  const skipped = ids.filter((id) => locked.has(id)).length;
  const live = ids.filter((id) => !locked.has(id));
  const note = skipped ? lockedExcludedNote(skipped) : undefined;
  const devs = p0.devices.filter((d) => live.includes(d.id));
  const units = p0.units.filter((u) => live.includes(u.id));
  const items = [...devs.map((d) => d.layout), ...units.map((u) => u.layout)];
  if (items.length < 2) return no(note ? `${note} — 정렬하려면 두 개 이상 선택하세요` : '정렬하려면 두 개 이상 선택하세요');
  const p = clone(p0);
  const v = Math.min(...items.map((l) => (mode === 'left' ? l.x : l.y)));
  for (const d of p.devices) if (live.includes(d.id)) { if (mode === 'left') d.layout.x = v; else d.layout.y = v; }
  for (const u of p.units) if (live.includes(u.id)) {
    const delta = mode === 'left' ? v - u.layout.x : v - u.layout.y;
    if (mode === 'left') u.layout.x = v; else u.layout.y = v;
    for (const d of p.devices) if (d.unitId === u.id && !live.includes(d.id)) { if (mode === 'left') d.layout.x += delta; else d.layout.y += delta; }
  }
  const grow = new Set<string>();
  for (const d of p.devices) if (live.includes(d.id)) grow.add(d.unitId);
  for (const id of grow) if (!locked.has(id)) fitUnit(p, id);
  return ok(p, note);
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

function withoutLocked(p: Project, ids: string[], min: number, need: string): { ids: string[]; note?: string } | { reason: string } {
  const picked = pickedUnits(p, ids);
  const skipped = picked.filter((u) => u.positionLocked === true).length;
  const free = picked.filter((u) => u.positionLocked !== true).map((u) => u.id);
  const note = skipped ? lockedExcludedNote(skipped) : undefined;
  if (free.length < min) return { reason: note ? `${note} — ${need}` : need };
  return { ids: free, note };
}

/**
 * PowerPoint-style distribute. The first and last Unit on `axis` stay put.
 * Middles move so the empty gap between neighbors (previous far edge → next near edge) is equal.
 * The other axis is unchanged. Fewer than 3 Units is refused. Devices in `ids` are ignored.
 * Locked Units are left out and named in the note.
 */
export function distributeUnits(p0: Project, ids: string[], axis: ArrangeAxis): CmdResult {
  const free = withoutLocked(p0, ids, 3, ARRANGE_NEED_3);
  if ('reason' in free) return no(free.reason);
  const p = clone(p0);
  const sorted = sortUnits(pickedUnits(p, free.ids), axis);
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
  if (!changed) return no(joinNote(free.note, ARRANGE_UNCHANGED) ?? ARRANGE_UNCHANGED);
  const overlaps = sorted.some((u, i) => i > 0 && u.layout[axis] < sorted[i - 1].layout[axis] + sorted[i - 1].layout[size]);
  return ok(p, joinNote(free.note, overlaps ? ARRANGE_OVERLAP_HINT : undefined));
}

/**
 * Match the chosen side to the largest selected Unit. Origin stays.
 * Never smaller than `unitMinSize`, so a Device is not cut. Devices in `ids` are ignored.
 */
export function matchUnitSize(p0: Project, ids: string[], dim: 'w' | 'h'): CmdResult {
  const free = withoutLocked(p0, ids, 2, ARRANGE_NEED_2);
  if ('reason' in free) return no(free.reason);
  const picked = pickedUnits(p0, free.ids);
  const target = Math.max(...picked.map((u) => u.layout[dim]));
  const p = clone(p0);
  let changed = false;
  for (const u of pickedUnits(p, free.ids)) {
    const min = unitMinSize(p, u.id);
    const next = Math.round(Math.max(target, dim === 'w' ? min.w : min.h));
    if (u.layout[dim] !== next) { u.layout[dim] = next; changed = true; }
  }
  if (!changed) return no(joinNote(free.note, ARRANGE_UNCHANGED) ?? ARRANGE_UNCHANGED);
  return ok(p, free.note);
}

/**
 * Push selected Units to the right until each neighbor gap is at least `gap`.
 * Order is x. The leftmost Unit stays. A Unit that is already far enough stays. y stays.
 * Units that were not selected do not move. Devices in `ids` are ignored.
 */
export function spreadUnits(p0: Project, ids: string[], gap: number): CmdResult {
  if (!Number.isFinite(gap) || gap < 0) return no('간격이 올바르지 않습니다');
  const free = withoutLocked(p0, ids, 2, ARRANGE_NEED_2);
  if ('reason' in free) return no(free.reason);
  const p = clone(p0);
  const sorted = sortUnits(pickedUnits(p, free.ids), 'x');
  let changed = false;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const space = cur.layout.x - (prev.layout.x + prev.layout.w);
    if (space < gap) changed = shiftUnit(cur, p.devices, prev.layout.x + prev.layout.w + gap - cur.layout.x, 0) || changed;
  }
  if (!changed) return no(joinNote(free.note, ARRANGE_UNCHANGED) ?? ARRANGE_UNCHANGED);
  return ok(p, free.note);
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
  const removedStepIds = new Set(p.sequence.steps.filter((s) => removedActions.has(s.actionId)).map((s) => s.id));
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
  if (p.sequence.flow) p.sequence.flow = scrubFlow(p.sequence.flow, removedStepIds, unitSet, fixCond);
  p.connections = p.connections.filter((c) => !nodeSet.has(c.from.nodeId) && !nodeSet.has(c.to.nodeId));
  releaseBrokenInterlocks(p, { actionIds: removedActions, signalIds: sigIds, deviceIds: deviceSet, unitIds: unitSet });
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
  if (u0.positionLocked === true) return no(LOCKED_RESIZE);
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
  if (u0.positionLocked === true) return no(LOCKED_RESIZE);
  const layout = tightUnitLayout(p0, unitId);
  if (!layout) return no('Unit 없음');
  if (layout.x === u0.layout.x && layout.y === u0.layout.y && layout.w === u0.layout.w && layout.h === u0.layout.h) return no('크기 변화 없음');
  const p = clone(p0);
  p.units.find((u) => u.id === unitId)!.layout = layout;
  return ok(p);
}

export {
  ARRANGE_DEVICES_HINT,
  ARRANGE_DEVICES_LOCKED,
  ARRANGE_DEVICES_NEED_ONE,
  arrangeDevicesTarget,
  deviceVisualBox,
} from './deviceArrange';

/**
 * After auto-arrange, clear Unit boxes that overlap the arranged Unit.
 * Right side reuses 「겹침 풀기」: x order, minimum `UNIT_SPREAD_GAP`, y stays, Devices move with the Unit.
 * The arranged Unit is the fixed left edge of that walk, so its top-left stays.
 * A Unit on the left that overlaps it is pushed left by the same gap — the stock rule would move this Unit.
 * No other Unit moves when this one overlaps nobody. Unrelated pairs that already overlapped stay overlapped.
 */
function clearArrangeOverlaps(p: Project, anchorId: string): void {
  const anchor = p.units.find((u) => u.id === anchorId);
  if (!anchor) return;
  const sorted = sortUnits(p.units, 'x');
  const ai = sorted.findIndex((u) => u.id === anchorId);
  if (ai < 0) return;
  const overlapsAnchor = (u: Unit) => u.id !== anchorId && rectsOverlap(u.layout, anchor.layout);
  if (!sorted.some(overlapsAnchor)) return;
  if (sorted.slice(ai + 1).some(overlapsAnchor)) {
    for (let i = ai + 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      const space = cur.layout.x - (prev.layout.x + prev.layout.w);
      if (space < UNIT_SPREAD_GAP && cur.positionLocked !== true) shiftUnit(cur, p.devices, prev.layout.x + prev.layout.w + UNIT_SPREAD_GAP - cur.layout.x, 0);
    }
  }
  if (sorted.slice(0, ai).some(overlapsAnchor)) {
    for (let i = ai - 1; i >= 0; i--) {
      const next = sorted[i + 1];
      const cur = sorted[i];
      if (!rectsOverlap(cur.layout, anchor.layout) && !rectsOverlap(cur.layout, next.layout)) continue;
      const space = next.layout.x - (cur.layout.x + cur.layout.w);
      if (space < UNIT_SPREAD_GAP && cur.positionLocked !== true) shiftUnit(cur, p.devices, next.layout.x - UNIT_SPREAD_GAP - cur.layout.w - cur.layout.x, 0);
    }
  }
}

/** 「자동 정렬」: place this Unit's Devices by signal flow, then push Units it overlaps. One undo step. Origin stays. */
export function arrangeDevices(p0: Project, unitId: string): CmdResult {
  const u0 = p0.units.find((u) => u.id === unitId);
  if (!u0) return no('Unit 없음');
  const next = arrangeUnitDevices(p0, unitId);
  if (!next) return no('Unit 없음');
  const sameUnit = u0.layout.x === next.unit.x && u0.layout.y === next.unit.y && u0.layout.w === next.unit.w && u0.layout.h === next.unit.h;
  const sameDevices = next.devices.every((d) => {
    const cur = p0.devices.find((x) => x.id === d.id)!;
    return cur.layout.x === d.x && cur.layout.y === d.y;
  });
  // A locked Unit keeps its box. Devices inside may still be arranged.
  if (u0.positionLocked === true) {
    if (sameDevices) return no(ARRANGE_UNCHANGED);
    const p = clone(p0);
    for (const d of next.devices) {
      const dev = p.devices.find((x) => x.id === d.id)!;
      dev.layout.x = d.x;
      dev.layout.y = d.y;
    }
    return ok(p);
  }
  if (sameUnit && sameDevices) return no(ARRANGE_UNCHANGED);
  const p = clone(p0);
  p.units.find((u) => u.id === unitId)!.layout = next.unit;
  for (const d of next.devices) {
    const dev = p.devices.find((x) => x.id === d.id)!;
    dev.layout.x = d.x;
    dev.layout.y = d.y;
  }
  clearArrangeOverlaps(p, unitId);
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

function recordQuantity(p: Project, ref: QuantityRef, from: boolean, to: boolean, stamp: ConfirmStamp | undefined): string | null {
  if (!quantityConfirmationChange(from, to)) return null;
  const ready = takeStamp(stamp);
  if (ready === 'bad') return CONFIRMER_REQUIRED;
  if (ready === 'skip') return null;
  appendConfirmation(p, {
    at: ready.at, by: ready.by, name: quantityName(p, ref),
    from: assumptionWord(from), to: assumptionWord(to),
    target: { kind: 'quantity', ref },
  });
  return null;
}

export function setDeviceProperty(p0: Project, deviceId: string, key: string, value: string | number | null, assumption: boolean, stamp?: ConfirmStamp): CmdResult {
  const n = parseNum(value);
  if (n === 'invalid') return no('숫자가 아닙니다 (빈 값 = 미정)');
  if (n !== null && n < 0) return no('음수는 허용되지 않습니다');
  const d0 = p0.devices.find((x) => x.id === deviceId); if (!d0) return no('Device 없음');
  const prev0 = d0.properties[key]; if (!prev0) return no('속성 없음');
  if (quantityConfirmationChange(prev0.assumption, assumption) && takeStamp(stamp) === 'bad') return no(CONFIRMER_REQUIRED);
  const p = clone(p0);
  const d = p.devices.find((x) => x.id === deviceId)!;
  const prev = d.properties[key];
  d.properties[key] = { ...prev, value: n, assumption, source: { method: 'direct-input' }, history: [...(prev.history ?? []), { at: `rev${p.revision + 1}`, from: prev.value, to: n, assumption }] };
  const err = recordQuantity(p, { kind: 'device', id: deviceId, key }, prev.assumption, assumption, stamp);
  if (err) return no(err);
  return ok(p);
}

export function setQuantity(p0: Project, path: Exclude<QuantityRef, { kind: 'device' }>, value: string | number | null, assumption: boolean, stamp?: ConfirmStamp): CmdResult {
  const n = parseNum(value);
  if (n === 'invalid') return no('숫자가 아닙니다 (빈 값 = 미정)');
  if (n !== null && n < 0) return no('음수는 허용되지 않습니다');
  const p = clone(p0);
  const upd = (prev: Quantity): Quantity => ({ ...prev, value: n, assumption, source: { method: 'direct-input' }, history: [...(prev.history ?? []), { at: `rev${p.revision + 1}`, from: prev.value, to: n, assumption }] });
  let fromAssumption: boolean | null = null;
  if (path.kind === 'action') {
    const a = p.actions.find((x) => x.id === path.id); if (!a) return no('Action 없음');
    fromAssumption = a[path.field].assumption;
    a[path.field] = upd(a[path.field]);
  } else if (path.kind === 'position') {
    const x = p.positions.find((y) => y.id === path.id); if (!x) return no('Position 없음');
    fromAssumption = x.value.assumption;
    x.value = upd(x.value);
  } else if (path.kind === 'unitCap') {
    const u = p.units.find((y) => y.id === path.id); if (!u) return no('Unit 없음');
    fromAssumption = u.capacity[path.field].assumption;
    u.capacity[path.field] = upd(u.capacity[path.field]);
  } else if (path.kind === 'stepTimeout') {
    const s = p.sequence.steps.find((y) => y.id === path.id); if (!s) return no('단계 없음');
    if (n === null && value === null) s.timeoutOverride = null;
    else {
      fromAssumption = (s.timeoutOverride ?? q(null, 's')).assumption;
      s.timeoutOverride = upd(s.timeoutOverride ?? q(null, 's'));
    }
  } else {
    const m = p.materials.find((y) => y.id === path.id); if (!m) return no('자재 없음');
    const prev = path.field === 'weight' ? m.weight : path.field === 'feedInterval' ? m.feedInterval : m.size[path.field];
    fromAssumption = prev.assumption;
    if (path.field === 'weight') m.weight = upd(m.weight);
    else if (path.field === 'feedInterval') m.feedInterval = upd(m.feedInterval);
    else m.size[path.field] = upd(m.size[path.field]);
  }
  if (fromAssumption !== null) {
    const err = recordQuantity(p, path, fromAssumption, assumption, stamp);
    if (err) return no(err);
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
  const p = clone(p0);
  const removed = new Set(p.sequence.steps.filter((s) => s.actionId === id).map((s) => s.id));
  p.sequence.steps = p.sequence.steps.filter((s) => s.actionId !== id);
  if (p.sequence.flow) p.sequence.flow = scrubFlow(p.sequence.flow, removed, new Set(), (c) => c);
  for (const q of p.substationSequences ?? []) {
    const gone = new Set(q.steps.filter((s) => s.actionId === id).map((s) => s.id));
    q.steps = q.steps.filter((s) => s.actionId !== id);
    if (q.flow && gone.size) q.flow = scrubFlow(q.flow, gone, new Set(), (c) => c);
  }
  releaseBrokenInterlocks(p, { actionIds: new Set([id]) });
  p.actions = p.actions.filter((a) => a.id !== id);
  return ok(p);
}

export function addSignal(p0: Project, deviceId: string, direction: 'in' | 'out', role: Signal['role'], idOf: (s: string) => string = newId): CmdResult {
  const d = p0.devices.find((x) => x.id === deviceId); if (!d) return no('Device 없음');
  const p = clone(p0);
  const s: Signal = { id: idOf('sig'), name: `${d.name}.새 신호`, deviceId, portKey: null, direction, valueType: 'bool', role, address: null, addressStatus: 'unassigned' };
  p.signals.push(s); return ok(p, s.id);
}

function nextAddressStatus(prev: Signal, patch: Partial<Pick<Signal, 'address' | 'addressStatus'>>): Signal['addressStatus'] {
  let status = patch.addressStatus ?? prev.addressStatus;
  if (patch.address !== undefined) {
    const address = patch.address || null;
    if (!address) status = 'unassigned';
    else if (status === 'unassigned') status = 'assumed';
  }
  return status;
}

export function updateSignal(p0: Project, id: string, patch: Partial<Pick<Signal, 'name' | 'direction' | 'role' | 'address' | 'addressStatus'>>, stamp?: ConfirmStamp): CmdResult {
  const s0 = p0.signals.find((x) => x.id === id); if (!s0) return no('Signal 없음');
  const next = nextAddressStatus(s0, patch);
  const logged = addressConfirmationChange(s0.addressStatus, next);
  const ready = logged ? takeStamp(stamp) : 'skip';
  if (ready === 'bad') return no(CONFIRMER_REQUIRED);
  const p = clone(p0); const s = p.signals.find((x) => x.id === id)!;
  Object.assign(s, patch);
  if (patch.address !== undefined) { s.address = patch.address || null; if (!s.address) s.addressStatus = 'unassigned'; else if (s.addressStatus === 'unassigned') s.addressStatus = 'assumed'; }
  if (ready !== 'skip') {
    appendConfirmation(p, {
      at: ready.at, by: ready.by, name: `${s.name} 주소`,
      from: addressWord(s0.addressStatus), to: addressWord(s.addressStatus),
      target: { kind: 'signalAddress', id },
    });
  }
  return ok(p);
}

export function deleteSignal(p0: Project, id: string): CmdResult {
  const p = clone(p0);
  const fix = (c: Condition): Condition => (c.kind === 'signal' && c.signalId === id ? { kind: 'undefined', note: `삭제된 Signal ${id} 참조 해제됨` } : c);
  for (const a of p.actions) {
    if (a.commandSignalId === id) a.commandSignalId = null;
    if (a.completeSignalId === id) a.completeSignalId = null;
    a.pre = a.pre.map(fix);
    a.post = a.post.map(fix);
  }
  for (const s of p.sequence.steps) s.entry = s.entry.map(fix);
  for (const q of p.substationSequences ?? []) for (const s of q.steps) s.entry = s.entry.map(fix);
  releaseBrokenInterlocks(p, { signalIds: new Set([id]) });
  p.signals = p.signals.filter((s) => s.id !== id);
  p.connections = p.connections.filter((c) => c.from.signalId !== id && c.to.signalId !== id);
  if (p.sequence.flow) p.sequence.flow = scrubFlow(p.sequence.flow, new Set(), new Set(), fix);
  for (const q of p.substationSequences ?? []) if (q.flow) q.flow = scrubFlow(q.flow, new Set(), new Set(), fix);
  return ok(p);
}

export function addPosition(p0: Project, deviceId: string, idOf: (s: string) => string = newId): CmdResult {
  const d = p0.devices.find((x) => x.id === deviceId); if (!d) return no('Device 없음');
  const p = clone(p0);
  const ps: Position = { id: idOf('pos'), name: `${d.name} 새 위치`, deviceId, value: q(null, 'mm') };
  p.positions.push(ps); return ok(p, ps.id);
}

export function deletePosition(p0: Project, id: string): CmdResult {
  const p = clone(p0);
  for (const a of p.actions) if (a.targetPositionId === id) a.targetPositionId = null;
  p.positions = p.positions.filter((x) => x.id !== id);
  return ok(p);
}

// ---- sequence (F5) ----
export function addStep(p0: Project, actionId: string, index?: number, origin: SequenceStep['origin'] = 'dnd', sourceText?: string, idOf: (s: string) => string = newId): CmdResult {
  const a = p0.actions.find((x) => x.id === actionId); if (!a) return no('Action 없음');
  const p = clone(p0);
  const step: SequenceStep = { id: idOf('step'), name: a.name, actionId, timeoutOverride: null, entry: [], origin, ...(sourceText ? { sourceText } : {}) };
  const i = index === undefined ? p.sequence.steps.length : Math.max(0, Math.min(index, p.sequence.steps.length));
  p.sequence.steps.splice(i, 0, step);
  if (p.sequence.flow) p.sequence.flow.push({ kind: 'step', stepId: step.id });
  return ok(p, step.id);
}

export function moveStep(p0: Project, from: number, to: number): CmdResult {
  const n = p0.sequence.steps.length;
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) return no('이동 불가');
  const p = clone(p0); const [s] = p.sequence.steps.splice(from, 1); p.sequence.steps.splice(to, 0, s); return ok(p);
}

export function removeStep(p0: Project, stepId: string): CmdResult {
  if (!p0.sequence.steps.some((s) => s.id === stepId)) return no('단계 없음');
  const p = clone(p0);
  p.sequence.steps = p.sequence.steps.filter((s) => s.id !== stepId);
  if (p.sequence.flow) p.sequence.flow = scrubFlow(p.sequence.flow, new Set([stepId]), new Set(), (c) => c);
  return ok(p);
}

export function updateStep(p0: Project, stepId: string, patch: Partial<Pick<SequenceStep, 'name' | 'entry'>>): CmdResult {
  const p = clone(p0); const s = p.sequence.steps.find((x) => x.id === stepId); if (!s) return no('단계 없음');
  Object.assign(s, patch); return ok(p);
}

// ---- material (F4) ----
export function setFeedCount(p0: Project, id: string, count: number): CmdResult {
  if (!Number.isInteger(count) || count < 1) return no('투입 개수는 1 이상의 정수입니다');
  const p = clone(p0);
  const m = p.materials.find((x) => x.id === id); if (!m) return no('자재 없음');
  m.feedCount = count;
  return ok(p);
}

export function updateMaterial(p0: Project, id: string, patch: Partial<Pick<Material, 'name' | 'kind' | 'handling' | 'states' | 'initialState' | 'initialLocation' | 'route'>>): CmdResult {
  const p = clone(p0); const m = p.materials.find((x) => x.id === id); if (!m) return no('자재 없음');
  if (patch.route) for (const r of patch.route) if (!p.units.some((u) => u.id === r)) return no(`경로의 Unit ${r} 없음`);
  if (patch.initialLocation && !p.units.some((u) => u.id === patch.initialLocation)) return no('초기 위치 Unit 없음');
  Object.assign(m, patch);
  if (m.initialState && !m.states.includes(m.initialState)) return no('초기 상태는 상태집합 안에 있어야 합니다');
  return ok(p);
}

export function addMaterial(p0: Project, idOf: (s: string) => string = newId): CmdResult {
  if (p0.materials.length >= MAX_MATERIAL_DEFS) return no(`자재 정의는 ${MAX_MATERIAL_DEFS}개까지입니다`);
  const p = clone(p0);
  const id = idOf('mat');
  const base = p.materials[0];
  const created: Material = base
    ? { ...structuredClone(base), id, name: '새 자재', carrierOf: null }
    : {
      id, name: '새 자재', kind: 'individual', carrierOf: null,
      size: { w: q(null, 'mm'), l: q(null, 'mm'), h: q(null, 'mm') },
      weight: q(null, 'kg'), handling: '', states: ['대기'], initialState: '대기',
      initialLocation: p.units[0]?.id ?? null, route: p.units.map((u) => u.id), feedInterval: q(null, 's'),
    };
  delete created.mark;
  delete created.feedCount;
  p.materials.push(created);
  if (p.materials.length > 1) {
    const letter = nextMark(p, id);
    created.mark = letter;
    created.name = `자재 ${letter}`;
  }
  return ok(p, id);
}

function rewriteConditions(p: Project, fix: (c: Condition) => Condition): void {
  for (const a of p.actions) {
    a.pre = a.pre.map(fix);
    a.post = a.post.map(fix);
  }
  for (const s of p.sequence.steps) s.entry = s.entry.map(fix);
  if (p.sequence.flow) p.sequence.flow = scrubFlow(p.sequence.flow, new Set(), new Set(), fix);
  for (const q of p.substationSequences ?? []) {
    for (const s of q.steps) s.entry = s.entry.map(fix);
    if (q.flow) q.flow = scrubFlow(q.flow, new Set(), new Set(), fix);
  }
  for (const k of p.constraints) {
    if (k.rule?.form === 'allow') k.rule = { ...k.rule, conditions: k.rule.conditions.map(fix) };
  }
}

/** Drop one definition. The shared feed count and interval stay on the first that remains. */
export function removeMaterial(p0: Project, id: string): CmdResult {
  const index = p0.materials.findIndex((m) => m.id === id);
  if (index < 0) return no('자재 없음');
  const p = clone(p0);
  const removed = p.materials[index];
  p.materials = p.materials.filter((m) => m.id !== id);
  if (index === 0 && p.materials[0]) {
    if (p.materials[0].feedCount == null && removed.feedCount != null) p.materials[0].feedCount = removed.feedCount;
    p.materials[0].feedInterval = structuredClone(removed.feedInterval);
  }
  if (p.feedPattern) {
    const known = new Set(p.materials.map((m) => m.id));
    const next = p.feedPattern.filter((x) => known.has(x));
    if (next.length === 0 || p.materials.length < 2) delete p.feedPattern;
    else p.feedPattern = next;
  }
  const fix = (c: Condition): Condition => (
    c.kind === 'materialType' && c.materialId === id
      ? { kind: 'undefined', note: `삭제된 자재 ${removed.name} 참조 해제됨` }
      : c
  );
  rewriteConditions(p, fix);
  return ok(p);
}

/** Repeating feed order. Omitted from the file when only one definition remains. */
export function setFeedPattern(p0: Project, ids: readonly string[]): CmdResult {
  if (p0.materials.length < 2) return no('자재 정의가 하나이면 투입 순서를 두지 않습니다');
  if (ids.length < 1) return no('투입 순서가 비어 있습니다');
  if (ids.some((id) => !p0.materials.some((m) => m.id === id))) return no('없는 자재');
  const p = clone(p0);
  p.feedPattern = [...ids];
  return ok(p);
}

/** Per-kind counts inside one cycle, in definition order. The cycle repeats up to the feed count. */
export function setFeedCounts(p0: Project, counts: Readonly<Record<string, number>>): CmdResult {
  if (p0.materials.length < 2) return no('자재 정의가 하나이면 종류별 개수를 두지 않습니다');
  for (const m of p0.materials) {
    const n = counts[m.id] ?? 0;
    if (!Number.isInteger(n) || n < 0) return no('종류별 개수는 0 이상의 정수입니다');
  }
  const ids = patternFromCounts(p0, counts);
  if (ids.length === 0) return no('한 종류는 1개 이상이어야 합니다');
  return setFeedPattern(p0, ids);
}

/** Drawing letter. Empty clears it and the fallback letter is used. Two letters at most. */
export function setMaterialMark(p0: Project, id: string, mark: string): CmdResult {
  const p = clone(p0);
  const m = p.materials.find((x) => x.id === id);
  if (!m) return no('자재 없음');
  const text = mark.trim();
  if (!text) {
    delete m.mark;
    return ok(p);
  }
  if ([...text].length > 2) return no('표식은 두 글자까지입니다');
  const taken = p.materials.some((other) => other.id !== id && materialMark(p, other.id) === text);
  if (taken) return no('같은 표식이 있습니다');
  m.mark = text;
  return ok(p);
}

// ---- constraints / interlock ----
export function setConstraintConfirmation(p0: Project, id: string, confirmation: 'confirmed' | 'rejected' | 'unconfirmed', stamp?: ConfirmStamp): CmdResult {
  const k0 = p0.constraints.find((x) => x.id === id); if (!k0) return no('제약 없음');
  const logged = interlockConfirmationChange(k0.confirmation, confirmation);
  const ready = logged ? takeStamp(stamp) : 'skip';
  if (ready === 'bad') return no(CONFIRMER_REQUIRED);
  const p = clone(p0); const k = p.constraints.find((x) => x.id === id)!;
  const from = k.confirmation;
  k.confirmation = confirmation;
  if (ready !== 'skip') {
    appendConfirmation(p, {
      at: ready.at, by: ready.by, name: k.description, from: confirmationWord(from), to: confirmationWord(confirmation),
      target: { kind: 'interlock', id },
    });
  }
  return ok(p);
}

export function updateCandidate(p0: Project, id: string, patch: Partial<Pick<Candidate, 'confirmation' | 'deviceKind' | 'assignedUnitId' | 'confidence'>>, stamp?: ConfirmStamp): CmdResult {
  const c0 = p0.candidates.find((x) => x.id === id); if (!c0) return no('후보 없음');
  const next = patch.confirmation ?? c0.confirmation;
  const logged = patch.confirmation !== undefined && candidateConfirmationChange(c0.confirmation, next);
  const ready = logged ? takeStamp(stamp) : 'skip';
  if (ready === 'bad') return no(CONFIRMER_REQUIRED);
  const p = clone(p0); const c = p.candidates.find((x) => x.id === id)!;
  const from = c.confirmation;
  Object.assign(c, patch);
  if (ready !== 'skip') {
    appendConfirmation(p, {
      at: ready.at, by: ready.by, name: c.name, from: confirmationWord(from), to: confirmationWord(c.confirmation),
      target: { kind: 'candidate', id },
    });
  }
  return ok(p);
}

export function setGapReviewStatus(p0: Project, id: string, status: GapReviewEntry['status'], stamp?: ConfirmStamp, title?: string): CmdResult {
  const old = p0.gapReview[id]; if (!old) return no('Gap 검토 없음');
  if (old.status === status) return no('변경 없음');
  const logged = gapConfirmationChange(old.status, status);
  const ready = logged ? takeStamp(stamp) : 'skip';
  if (ready === 'bad') return no(CONFIRMER_REQUIRED);
  const p = clone(p0);
  p.gapReview[id] = { ...old, status };
  if (ready !== 'skip') {
    appendConfirmation(p, {
      at: ready.at, by: ready.by, name: title?.trim() || id,
      from: gapStatusWord(old.status), to: gapStatusWord(status),
      target: { kind: 'gap', id },
    });
  }
  return ok(p);
}

export function addConstraint(p0: Project, idOf: (s: string) => string = newId): CmdResult {
  const p = clone(p0);
  const id = idOf('IL');
  p.constraints.push({
    id, kind: 'interlock-candidate', description: '새 Interlock', relatedIds: [],
    confirmation: 'unconfirmed', source: { method: 'direct-input' },
  });
  return ok(p, id);
}

export function deleteConstraint(p0: Project, id: string): CmdResult {
  if (!p0.constraints.some((k) => k.id === id)) return no('제약 없음');
  const p = clone(p0);
  p.constraints = p.constraints.filter((k) => k.id !== id);
  return ok(p);
}

export function setConstraintDescription(p0: Project, id: string, description: string): CmdResult {
  if (!description.trim()) return no('설명 필요');
  const p = clone(p0);
  const k = p.constraints.find((x) => x.id === id);
  if (!k) return no('제약 없음');
  k.description = description.trim();
  return ok(p);
}

function ruleConditionsOk(p: Project, conditions: Condition[]): string | null {
  for (const c of conditions) {
    if (c.kind === 'signal' && !p.signals.some((s) => s.id === c.signalId)) return '없는 Signal';
    if (c.kind === 'materialAt' && !p.units.some((u) => u.id === c.unitId)) return '없는 Unit';
    if (c.kind === 'materialHeldBy' && c.deviceId && !p.devices.some((d) => d.id === c.deviceId)) return '없는 Device';
    if (c.kind === 'materialType' && !p.materials.some((m) => m.id === c.materialId)) return '없는 자재';
  }
  return null;
}

/** Replace the machine-readable rule. `null` clears it. One call is one revision. */
export function setConstraintRule(p0: Project, id: string, rule: InterlockRule | null): CmdResult {
  const p = clone(p0);
  const k = p.constraints.find((x) => x.id === id);
  if (!k) return no('제약 없음');
  if (!rule) { delete k.rule; return ok(p); }
  if (rule.form === 'undetermined') return no('미정 규칙은 삭제로만 생깁니다');
  if (!p.actions.some((a) => a.id === rule.actionId)) return no('Action 없음');
  if (rule.form === 'mutex') {
    if (rule.actionId === rule.otherActionId) return no('같은 Action에는 동시 금지를 두지 않습니다');
    if (!p.actions.some((a) => a.id === rule.otherActionId)) return no('상대 Action 없음');
  } else {
    const bad = ruleConditionsOk(p, rule.conditions);
    if (bad) return no(bad);
  }
  k.rule = rule.form === 'allow'
    ? { form: 'allow', actionId: rule.actionId, conditions: structuredClone(rule.conditions) }
    : { form: 'mutex', actionId: rule.actionId, otherActionId: rule.otherActionId };
  k.relatedIds = devicesOfRule(p, k.rule);
  return ok(p);
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

// ---- Station flow (TURN-022). One command = rev +1 = one undo. ---
function flowOf(p: Project): FlowNode[] {
  return (p.sequence.flow ??= linearFlow(p.sequence.steps));
}

const resultCond = (p: Project): Condition => {
  const sig = p.signals.find((s) => s.role === 'result');
  return sig ? { kind: 'signal', signalId: sig.id, equals: true } : { kind: 'undefined', note: '조건 없음' };
};

export type WrapKind = 'branch' | 'parallel' | 'loop' | 'retry';

/** Wrap consecutive siblings (steps, blocks, or substation steps). Creates `flow` from the flat list when it was absent. */
export function wrapFlow(p0: Project, ids: string[], kind: WrapKind, idOf: (s: string) => string = newId): CmdResult {
  if (ids.length < 1) return no('단계를 하나 이상 고르세요');
  const p = clone(p0);
  const flow = flowOf(p);
  if (ids.some((id) => !findById(flow, id))) return no('없는 단계');
  const spot = findConsecutive(flow, ids);
  if (!spot) return no('같은 갈래에서 연속된 단계만 묶을 수 있습니다');
  const inner = spot.list.slice(spot.index, spot.index + ids.length);
  if (kind === 'parallel' && (listInsideParallel(flow, spot.list) || inner.some(containsParallel))) {
    return no('병렬 갈래 안에는 병렬을 넣지 않습니다');
  }
  const id = idOf('flow');
  let block: FlowNode;
  if (kind === 'branch') block = { kind: 'branch', id, name: '분기', cond: resultCond(p), then: [], else: [] };
  else if (kind === 'parallel') block = { kind: 'parallel', id, name: '병렬', lanes: [[], []] };
  else if (kind === 'loop') block = { kind: 'loop', id, name: '반복', count: 2, body: [] };
  else block = { kind: 'retry', id, name: '재시도', until: resultCond(p), maxRetries: DEFAULT_MAX_RETRIES, body: [] };
  const next = wrapStepNodes(flow, ids, block);
  if (!next) return no('같은 갈래에서 연속된 단계만 묶을 수 있습니다');
  p.sequence.flow = next;
  return ok(p, id);
}

export function unwrapFlow(p0: Project, blockId: string): CmdResult {
  if (!p0.sequence.flow) return no('흐름 없음');
  const p = clone(p0);
  const next = unwrapBlock(p.sequence.flow!, blockId);
  if (!next) return no('블록 없음');
  p.sequence.flow = next;
  return ok(p);
}

function branchAt(p: Project, blockId: string) {
  const flow = p.sequence.flow;
  if (!flow) return null;
  const hit = findById(flow, blockId);
  if (!hit || hit.node.kind !== 'branch') return null;
  return hit;
}

/** Insert one conditional arm before 「그 밖」. Five arms are rejected. The new arm starts empty and undetermined. */
export function addBranchArm(p0: Project, blockId: string): CmdResult {
  const p = clone(p0);
  const hit = branchAt(p, blockId);
  if (!hit || hit.node.kind !== 'branch') return no('분기 블록 없음');
  const arms = branchArms(hit.node);
  if (arms.length >= MAX_BRANCH_ARMS) return no('갈래는 4개까지입니다');
  const created: BranchArm = { cond: { kind: 'undefined', note: '조건 없음' }, body: [] };
  const next = [...arms.slice(0, -1), created, arms[arms.length - 1]];
  hit.list[hit.index] = branchFromArms(hit.node, next);
  return ok(p);
}

/** Drop one arm. Its lines move to the sibling list after the branch, same as a parallel lane. */
export function removeBranchArm(p0: Project, blockId: string, armIndex: number): CmdResult {
  const p = clone(p0);
  const hit = branchAt(p, blockId);
  if (!hit || hit.node.kind !== 'branch') return no('분기 블록 없음');
  const arms = branchArms(hit.node);
  if (arms.length <= 2) return no('갈래는 2개 이상이어야 합니다');
  if (armIndex < 0 || armIndex >= arms.length) return no('갈래 없음');
  const removed = arms[armIndex];
  const next = arms.filter((_, i) => i !== armIndex);
  hit.list[hit.index] = branchFromArms(hit.node, next);
  hit.list.splice(hit.index + 1, 0, ...removed.body);
  return ok(p);
}

/**
 * Swap an arm with its neighbor. A condition stays on its conditional slot when one side is 「그 밖」,
 * so moving the last arm and moving it back restores the same condition.
 */
export function moveBranchArm(p0: Project, blockId: string, armIndex: number, delta: number): CmdResult {
  if (delta !== -1 && delta !== 1) return no('이동 불가');
  const p = clone(p0);
  const hit = branchAt(p, blockId);
  if (!hit || hit.node.kind !== 'branch') return no('분기 블록 없음');
  const arms = branchArms(hit.node);
  const j = armIndex + delta;
  if (armIndex < 0 || j < 0 || armIndex >= arms.length || j >= arms.length) return no('이동 불가');
  const a = arms[armIndex];
  const b = arms[j];
  if (a.cond && b.cond) {
    arms[armIndex] = b;
    arms[j] = a;
  } else {
    arms[armIndex] = { ...a, body: b.body };
    arms[j] = { ...b, body: a.body };
  }
  hit.list[hit.index] = branchFromArms(hit.node, arms);
  return ok(p);
}

/** Set the condition of one conditional arm. The last arm has no condition. */
export function setBranchArmCondition(p0: Project, blockId: string, armIndex: number, cond: Condition): CmdResult {
  const p = clone(p0);
  const hit = branchAt(p, blockId);
  if (!hit || hit.node.kind !== 'branch') return no('분기 블록 없음');
  const arms = branchArms(hit.node);
  if (armIndex < 0 || armIndex >= arms.length - 1) return no('조건을 두는 갈래가 아닙니다');
  arms[armIndex] = { ...arms[armIndex], cond };
  hit.list[hit.index] = branchFromArms(hit.node, arms);
  return ok(p);
}

export function addParallelLane(p0: Project, blockId: string): CmdResult {
  const p = clone(p0);
  const hit = p.sequence.flow && findById(p.sequence.flow, blockId);
  if (!hit || hit.node.kind !== 'parallel') return no('병렬 블록 없음');
  if (hit.node.lanes.length >= 4) return no('갈래는 4개까지입니다');
  hit.node.lanes.push([]);
  return ok(p);
}

export function removeParallelLane(p0: Project, blockId: string, laneIndex: number): CmdResult {
  const p = clone(p0);
  const hit = p.sequence.flow && findById(p.sequence.flow, blockId);
  if (!hit || hit.node.kind !== 'parallel') return no('병렬 블록 없음');
  if (hit.node.lanes.length <= 2) return no('갈래는 2개 이상이어야 합니다');
  if (laneIndex < 0 || laneIndex >= hit.node.lanes.length) return no('갈래 없음');
  const [lane] = hit.node.lanes.splice(laneIndex, 1);
  hit.list.splice(hit.index + 1, 0, ...lane);
  return ok(p);
}

export function setLoopCount(p0: Project, blockId: string, count: number): CmdResult {
  if (!Number.isInteger(count) || count < 1 || count > 10) return no('횟수는 1~10');
  const p = clone(p0);
  const hit = p.sequence.flow && findById(p.sequence.flow, blockId);
  if (!hit || hit.node.kind !== 'loop') return no('반복 블록 없음');
  hit.node.count = count;
  return ok(p);
}

export function setRetryMax(p0: Project, blockId: string, maxRetries: number): CmdResult {
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > DEFAULT_MAX_RETRIES) return no(`재시도는 0~${DEFAULT_MAX_RETRIES}`);
  const p = clone(p0);
  const hit = p.sequence.flow && findById(p.sequence.flow, blockId);
  if (!hit || hit.node.kind !== 'retry') return no('재시도 블록 없음');
  hit.node.maxRetries = maxRetries;
  return ok(p);
}

export function setFlowCondition(p0: Project, blockId: string, cond: Condition): CmdResult {
  const p = clone(p0);
  const hit = p.sequence.flow && findById(p.sequence.flow, blockId);
  if (!hit) return no('블록 없음');
  if (hit.node.kind === 'branch') hit.node.cond = cond;
  else if (hit.node.kind === 'retry') hit.node.until = cond;
  else if (hit.node.kind === 'wait') hit.node.cond = cond;
  else return no('조건을 두는 블록이 아닙니다');
  return ok(p);
}

export function renameFlowBlock(p0: Project, blockId: string, name: string): CmdResult {
  if (!name.trim()) return no('이름 필요');
  const p = clone(p0);
  const hit = p.sequence.flow && findById(p.sequence.flow, blockId);
  if (!hit || hit.node.kind === 'step' || hit.node.kind === 'substation') return no('블록 없음');
  hit.node.name = name.trim();
  return ok(p);
}

/** Append a signal-wait block. Timeout starts undetermined so a run cannot begin until it is set. */
export function addWaitNode(p0: Project, idOf: (s: string) => string = newId): CmdResult {
  const p = clone(p0);
  const id = idOf('flow');
  flowOf(p).push({
    kind: 'wait', id, name: '신호 기다림', cond: resultCond(p),
    timeout: { value: null, unit: 's', assumption: true },
  });
  return ok(p, id);
}

export function setWaitTimeout(p0: Project, blockId: string, seconds: number | null): CmdResult {
  if (seconds !== null && (!Number.isFinite(seconds) || seconds < 0)) return no('타임아웃은 0 이상');
  const p = clone(p0);
  const hit = p.sequence.flow && findById(p.sequence.flow, blockId);
  if (!hit || hit.node.kind !== 'wait') return no('신호 기다림 블록 없음');
  hit.node.timeout = { ...hit.node.timeout, value: seconds };
  return ok(p);
}

export function addSubstationNode(p0: Project, unitId: string, idOf: (s: string) => string = newId): CmdResult {
  if (!p0.units.some((u) => u.id === unitId)) return no('Substation 없음');
  const p = clone(p0);
  const id = idOf('flow');
  flowOf(p).push({ kind: 'substation', id, unitId });
  return ok(p, id);
}

export function moveFlowNode(p0: Project, id: string, delta: number): CmdResult {
  if (!p0.sequence.flow) return no('흐름 없음');
  const p = clone(p0);
  const next = moveNodeBy(p.sequence.flow!, id, delta);
  if (!next) return no('이동 불가');
  p.sequence.flow = next;
  return ok(p);
}

/** Move a node to the end of a block arm. `arm` is 'then' | 'else' | 'body' or a lane index. */
export function moveFlowInto(p0: Project, id: string, blockId: string, arm: 'then' | 'else' | 'body' | number): CmdResult {
  if (!p0.sequence.flow) return no('흐름 없음');
  const p = clone(p0);
  const flow = p.sequence.flow!;
  const block = findById(flow, blockId);
  if (!block) return no('블록 없음');
  let target: FlowNode[] | null = null;
  if (block.node.kind === 'branch') {
    const lists = armLists(block.node);
    if (arm === 'then') target = lists[0] ?? null;
    else if (arm === 'else') target = lists[lists.length - 1] ?? null;
    else if (typeof arm === 'number') target = lists[arm] ?? null;
  } else if ((block.node.kind === 'loop' || block.node.kind === 'retry') && (arm === 'body' || arm === 'then')) target = block.node.body;
  else if (block.node.kind === 'parallel' && typeof arm === 'number') target = block.node.lanes[arm] ?? null;
  if (!target) return no('갈래 없음');
  const moving = findById(flow, id);
  if (!moving) return no('노드 없음');
  if (moving.node.kind !== 'step' && containsList(moving.node, target)) return no('블록을 자기 자신 안에 넣을 수 없습니다');
  if (listInsideParallel(flow, target) && containsParallel(moving.node)) return no('병렬 갈래 안에는 병렬을 넣지 않습니다');
  const next = moveNodeTo(flow, id, target, target.length);
  if (!next) return no('옮길 수 없습니다');
  p.sequence.flow = next;
  return ok(p);
}

export function moveFlowOut(p0: Project, id: string): CmdResult {
  if (!p0.sequence.flow) return no('흐름 없음');
  const p = clone(p0);
  const flow = p.sequence.flow!;
  const hit = findById(flow, id);
  if (!hit) return no('노드 없음');
  if (hit.list === flow) return no('이미 맨 바깥입니다');
  const owner = findOwner(flow, hit.list);
  if (!owner) return no('바깥 위치를 찾지 못했습니다');
  const next = moveNodeTo(flow, id, owner.list, owner.index + 1);
  if (!next) return no('옮길 수 없습니다');
  p.sequence.flow = next;
  return ok(p);
}
