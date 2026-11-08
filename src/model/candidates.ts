// F1 경로 A (직접 입력) 후보표 → 사람 확인 → 반영. 문서/USD 추출(경로 B/C)은 미구현.
import { addDevice, addUnit } from './commands';
import { newId } from './factory';
import type { AssetKind, Candidate, Project } from './types';

export function newCandidate(targetKind: 'unit' | 'device', name: string, deviceKind: AssetKind | null, assignedUnitId: string | null, level: Candidate['confidence']['level'] = 'direct', idOf: (s: string) => string = newId): Candidate {
  return {
    id: idOf('cand'), targetKind, name, deviceKind, assignedUnitId,
    sourceRefs: [{ method: 'direct-input', note: '사용자 직접 입력' }],
    confidence: { level, basis: level === 'direct' ? '사용자 직접 지정 (이름·종류 명시)' : '수동 지정 신뢰도' },
    confirmation: 'unconfirmed', appliedObjectId: null,
  };
}

export interface ApplyPlanItem { candidateId: string; name: string; apply: boolean; reason: string }

/** Preview: which candidates would be applied and why others are skipped (F1-05 / F1-AC3). */
export function planCandidateApply(p: Project): ApplyPlanItem[] {
  return p.candidates.filter((c) => !c.appliedObjectId).map((c) => {
    if (c.confirmation !== 'confirmed') return { candidateId: c.id, name: c.name, apply: false, reason: c.confirmation === 'rejected' ? '거절됨' : '사람 확인 전 — 반영 안 함' };
    if (c.targetKind === 'device') {
      if (!c.deviceKind) return { candidateId: c.id, name: c.name, apply: false, reason: 'Device 종류 미지정' };
      if (!c.assignedUnitId || !p.units.some((u) => u.id === c.assignedUnitId)) return { candidateId: c.id, name: c.name, apply: false, reason: '소속 Unit 미배정 — 사람 배정 필요' };
      if (c.confidence.level === 'low') return { candidateId: c.id, name: c.name, apply: false, reason: '낮은 신뢰도 — 사람 배정/확인 재검토 필요' };
    }
    return { candidateId: c.id, name: c.name, apply: true, reason: '확인됨' };
  });
}

/** Apply only planned items; returns new project (single undo unit). Cancel = simply don't call. */
export function applyCandidates(p0: Project): { project: Project; applied: string[]; skipped: ApplyPlanItem[] } {
  const plan = planCandidateApply(p0);
  let p = structuredClone(p0);
  const applied: string[] = [];
  // units first so devices can be assigned to newly created units in the same batch only if already existing (prototype: existing only)
  for (const item of plan.filter((i) => i.apply)) {
    const c = p.candidates.find((x) => x.id === item.candidateId)!;
    if (c.targetKind === 'unit') {
      const x = 30 + p.units.length * 236;
      const r = addUnit(p, c.name, { x, y: 70 });
      if (r.ok) { p = r.project; const cc = p.candidates.find((k) => k.id === c.id)!; cc.appliedObjectId = r.note ?? null; applied.push(c.id); }
    } else {
      const u = p.units.find((uu) => uu.id === c.assignedUnitId)!;
      const n = u.deviceIds.length;
      const r = addDevice(p, c.deviceKind!, { x: u.layout.x + 20 + (n % 2) * 100, y: u.layout.y + 40 + Math.floor(n / 2) * 70 }, c.name);
      if (r.ok) { p = r.project; const cc = p.candidates.find((k) => k.id === c.id)!; cc.appliedObjectId = r.note ?? null; applied.push(c.id); }
    }
  }
  return { project: p, applied, skipped: plan.filter((i) => !i.apply) };
}
