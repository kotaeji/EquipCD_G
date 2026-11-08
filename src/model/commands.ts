// Pure model editing commands (F2/F3/F4/F5). Each returns a new Project or a rejection; never mutates input.
import { findAsset, getAssetById } from '../assets/library';
import { instantiateDevice, makeUnit, newId } from './factory';
import type { Action, AssetKind, Condition, Connection, Device, Material, Position, Project, Quantity, SequenceStep, Signal, SubstationSequence, Unit } from './types';
import { q } from './types';

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
  const u = makeUnit(name || `${code} 새 유닛`, code, { x: at.x, y: at.y, w: 216, h: 300 }, idOf);
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
  return ok(p, u.id);
}

export function addDevice(p0: Project, kind: AssetKind, at: { x: number; y: number }, name?: string, idOf: (s: string) => string = newId): CmdResult {
  const unit = unitAt(p0, at.x, at.y);
  if (!unit) return no('Device는 Unit 영역 안에 놓아야 합니다 (Equipment > Unit > Device). 먼저 Unit을 배치하세요.');
  const p = clone(p0);
  const b = instantiateDevice(kind, unit.id, at, name, idOf);
  p.devices.push(b.device); p.signals.push(...b.signals); p.positions.push(...b.positions); p.actions.push(...b.actions);
  p.units.find((u) => u.id === unit.id)!.deviceIds.push(b.device.id);
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
  const deviceIds = isUnit ? p.devices.filter((d) => d.unitId === id).map((d) => d.id) : [id];
  const sigIds = new Set(p.signals.filter((s) => deviceIds.includes(s.deviceId)).map((s) => s.id));
  const removedActions = new Set(p.actions.filter((a) => deviceIds.includes(a.deviceId) || a.unitId === id).map((a) => a.id));
  p.devices = p.devices.filter((d) => !deviceIds.includes(d.id));
  p.signals = p.signals.filter((s) => !sigIds.has(s.id));
  p.positions = p.positions.filter((x) => !deviceIds.includes(x.deviceId));
  p.actions = p.actions.filter((a) => !removedActions.has(a.id));
  p.sequence.steps = p.sequence.steps.filter((s) => !removedActions.has(s.actionId));
  p.substationSequences = (p.substationSequences ?? []).filter((q) => !(isUnit && q.unitId === id));
  for (const q of p.substationSequences) q.steps = q.steps.filter((s) => !removedActions.has(s.actionId));
  const fixCond = (c: Condition): Condition => {
    if (c.kind === 'signal' && sigIds.has(c.signalId)) return { kind: 'undefined', note: `삭제된 Signal ${c.signalId} 참조 해제됨` };
    if (c.kind === 'materialAt' && c.unitId === id) return { kind: 'undefined', note: `삭제된 Unit ${id} 참조 해제됨` };
    if (c.kind === 'materialHeldBy' && c.deviceId && deviceIds.includes(c.deviceId)) return { kind: 'undefined', note: `삭제된 Device ${c.deviceId} 참조 해제됨` };
    return c;
  };
  for (const a of p.actions) {
    a.pre = a.pre.map(fixCond); a.post = a.post.map(fixCond);
    if (a.effect.moveTo === id) { delete a.effect.moveTo; a.pre.push({ kind: 'undefined', note: `이동 대상 Unit ${id} 삭제됨 — 대체 필요` }); }
    if (a.effect.holder && deviceIds.includes(a.effect.holder)) a.effect.holder = null;
  }
  for (const s of p.sequence.steps) s.entry = s.entry.map(fixCond);
  for (const q of p.substationSequences) for (const s of q.steps) s.entry = s.entry.map(fixCond);
  p.connections = p.connections.filter((c) => ![id, ...deviceIds].includes(c.from.nodeId) && ![id, ...deviceIds].includes(c.to.nodeId));
  for (const k of p.constraints) k.relatedIds = k.relatedIds.filter((r) => ![id, ...deviceIds].includes(r));
  if (isUnit) {
    p.units = p.units.filter((u) => u.id !== id);
    p.equipment.unitIds = p.equipment.unitIds.filter((u) => u !== id);
    for (const m of p.materials) {
      m.route = m.route.filter((r) => r !== id);
      if (m.initialLocation === id) m.initialLocation = null;
    }
  } else {
    for (const u of p.units) u.deviceIds = u.deviceIds.filter((d) => d !== id);
  }
  return ok(p);
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
