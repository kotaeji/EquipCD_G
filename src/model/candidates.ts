// F1 후보표 → 사람 확인 → 반영. 직접 입력과 XLSX 가져오기가 같은 규칙을 쓴다.
import { findAsset } from '../assets/library';
import { signalMatchesName } from '../import/signalMatch';
import { addDevice, addSignal, addUnit } from './commands';
import { newId } from './factory';
import type { AssetKind, Candidate, Project, Signal } from './types';

export function newCandidate(targetKind: 'unit' | 'device', name: string, deviceKind: AssetKind | null, assignedUnitId: string | null, level: Candidate['confidence']['level'] = 'direct', idOf: (s: string) => string = newId): Candidate {
  return {
    id: idOf('cand'), targetKind, name, deviceKind, assignedUnitId,
    sourceRefs: [{ method: 'direct-input', note: '사용자 직접 입력' }],
    confidence: { level, basis: level === 'direct' ? '사용자 직접 지정 (이름·종류 명시)' : '수동 지정 신뢰도' },
    confirmation: 'unconfirmed', appliedObjectId: null,
  };
}

export interface ApplyPlanItem { candidateId: string; name: string; apply: boolean; reason: string }

const LOW = '낮은 신뢰도 — 사람 배정/확인 재검토 필요';

function gate(c: Candidate): string | null {
  if (c.confirmation === 'rejected') return '거절됨';
  if (c.alreadyExists && c.confirmation !== 'confirmed') return '이미 있음';
  if (c.confirmation !== 'confirmed') return '사람 확인 전 — 반영 안 함';
  return null;
}

function unitResolvable(p: Project, c: Candidate, applyingUnitNames: Set<string>): boolean {
  if (c.assignedUnitId && p.units.some((u) => u.id === c.assignedUnitId)) return true;
  if (c.assignedUnitName && (p.units.some((u) => u.name === c.assignedUnitName) || applyingUnitNames.has(c.assignedUnitName))) return true;
  return false;
}

/** Preview: which candidates would be applied and why others are skipped (F1-05 / F1-AC3). */
export function planCandidateApply(p: Project): ApplyPlanItem[] {
  const pending = p.candidates.filter((c) => !c.appliedObjectId);
  const decision = new Map<string, { apply: boolean; reason: string }>();
  const applyingUnitNames = new Set<string>();
  for (const c of pending) {
    if (c.targetKind !== 'unit') continue;
    const why = gate(c);
    decision.set(c.id, why ? { apply: false, reason: why } : { apply: true, reason: '확인됨' });
    if (!why) applyingUnitNames.add(c.name);
  }
  const applyingDeviceNames = new Set<string>();
  for (const c of pending) {
    if (c.targetKind !== 'device') continue;
    const why = gate(c);
    if (why) { decision.set(c.id, { apply: false, reason: why }); continue; }
    if (!c.deviceKind) { decision.set(c.id, { apply: false, reason: 'Device 종류 미지정' }); continue; }
    if (!unitResolvable(p, c, applyingUnitNames)) { decision.set(c.id, { apply: false, reason: '소속 Unit 미배정 — 사람 배정 필요' }); continue; }
    if (c.confidence.level === 'low') { decision.set(c.id, { apply: false, reason: LOW }); continue; }
    decision.set(c.id, { apply: true, reason: '확인됨' });
    applyingDeviceNames.add(c.name);
  }
  for (const c of pending) {
    if (c.targetKind !== 'signal') continue;
    const why = gate(c);
    if (why) { decision.set(c.id, { apply: false, reason: why }); continue; }
    if (c.confidence.level === 'low') { decision.set(c.id, { apply: false, reason: LOW }); continue; }
    const deviceName = c.signalDeviceName ?? '';
    const known = p.devices.some((d) => d.name === deviceName) || applyingDeviceNames.has(deviceName);
    decision.set(c.id, known ? { apply: true, reason: '확인됨' } : { apply: false, reason: '소속 Device 없음' });
  }
  return pending.map((c) => {
    const d = decision.get(c.id) ?? { apply: false, reason: '사람 확인 전 — 반영 안 함' };
    return { candidateId: c.id, name: c.name, apply: d.apply, reason: d.reason };
  });
}

function resolveUnitId(p: Project, c: Candidate, created: Map<string, string>): string | null {
  if (c.assignedUnitId && p.units.some((u) => u.id === c.assignedUnitId)) return c.assignedUnitId;
  if (c.assignedUnitName && created.has(c.assignedUnitName)) return created.get(c.assignedUnitName) ?? null;
  if (c.assignedUnitName) return p.units.find((u) => u.name === c.assignedUnitName)?.id ?? null;
  return null;
}

function placeDevice(p: Project, c: Candidate, unitId: string) {
  const u = p.units.find((uu) => uu.id === unitId);
  if (!u || !c.deviceKind) return null;
  const n = u.deviceIds.length;
  return addDevice(p, c.deviceKind, { x: u.layout.x + 20 + (n % 2) * 100, y: u.layout.y + 40 + Math.floor(n / 2) * 70 }, c.name, newId, unitId);
}

function matchingSignal(p: Project, deviceId: string, deviceName: string, kind: string, wanted: string): Signal | undefined {
  const ports = findAsset(kind)?.ports ?? [];
  return p.signals.find((s) => s.deviceId === deviceId && signalMatchesName(deviceName, s, ports, wanted));
}

/** Apply only planned items. Units first, then devices inside them, then signals. One returned project is one undo. */
export function applyCandidates(p0: Project): { project: Project; applied: string[]; skipped: ApplyPlanItem[] } {
  const plan = planCandidateApply(p0);
  let p = structuredClone(p0);
  const applied: string[] = [];
  const createdUnits = new Map<string, string>();
  const createdDevices = new Map<string, string>();
  const items = plan.filter((i) => i.apply);
  const of = (id: string) => p.candidates.find((c) => c.id === id);
  for (const item of items) {
    const c = of(item.candidateId);
    if (!c || c.targetKind !== 'unit') continue;
    const x = 30 + p.units.length * 236;
    const r = addUnit(p, c.name, { x, y: 70 });
    if (!r.ok || !r.note) continue;
    p = r.project;
    const cc = p.candidates.find((k) => k.id === c.id)!;
    cc.appliedObjectId = r.note;
    createdUnits.set(c.name, r.note);
    applied.push(c.id);
  }
  for (const item of items) {
    const c = of(item.candidateId);
    if (!c || c.targetKind !== 'device') continue;
    const unitId = resolveUnitId(p, c, createdUnits);
    if (!unitId) continue;
    const r = placeDevice(p, c, unitId);
    if (!r || !r.ok || !r.note) continue;
    p = r.project;
    const cc = p.candidates.find((k) => k.id === c.id)!;
    cc.appliedObjectId = r.note;
    createdDevices.set(c.name, r.note);
    applied.push(c.id);
  }
  for (const item of items) {
    const c = of(item.candidateId);
    if (!c || c.targetKind !== 'signal' || !c.signalDeviceName) continue;
    const deviceId = createdDevices.get(c.signalDeviceName) ?? p.devices.find((d) => d.name === c.signalDeviceName)?.id;
    const device = deviceId ? p.devices.find((d) => d.id === deviceId) : undefined;
    if (!device) continue;
    const existing = matchingSignal(p, device.id, device.name, device.kind, c.name);
    if (existing) {
      if (c.signalAddress) { existing.address = c.signalAddress; existing.addressStatus = 'assumed'; }
      const cc = p.candidates.find((k) => k.id === c.id)!;
      cc.appliedObjectId = existing.id;
      applied.push(c.id);
      continue;
    }
    const direction = c.signalDirection === 'out' ? 'out' : 'in';
    const r = addSignal(p, device.id, direction, direction === 'out' ? 'command' : 'sensor');
    if (!r.ok || !r.note) continue;
    p = r.project;
    const created = p.signals.find((s) => s.id === r.note);
    if (created) {
      created.name = c.name;
      created.direction = direction;
      if (c.signalAddress) { created.address = c.signalAddress; created.addressStatus = 'assumed'; }
    }
    const cc = p.candidates.find((k) => k.id === c.id)!;
    cc.appliedObjectId = r.note;
    applied.push(c.id);
  }
  return { project: p, applied, skipped: plan.filter((i) => !i.apply) };
}
