// TURN-001: where to fix — or only inspect — a Substation group-run blocker (6 실행·저장 → "실행 전 검사 — 차단 N건").
// Guidance is resolved per actual Diagnostic object (not only per code) so the UI never promises an editor that does
// not exist. Navigation only: never changes the model, the group gate rules, or run blocking.
import type { Diagnostic } from '../model/validate';
import type { Condition, Project, SubstationSequence } from '../model/types';
import { STEPS, type StepId } from './wizard';

/** fix = the cause is edited at the destination; inspect = the destination only shows the cause / context;
 *  unsupported = the current UI has no editor for this cause (optional inspect destination). */
export type GuideKind = 'fix' | 'inspect' | 'unsupported';
export interface Dest { step: StepId; sub?: string; place: string }
export interface BlockerGuide {
  kind: GuideKind;
  /** fix: edit location · inspect/unsupported: where the cause can be looked at (may be absent for unsupported) */
  dest?: Dest;
  /** object selected for step-3 fixes (view state only) */
  focus?: { id: string; kind: 'device' | 'unit' };
  /** user-facing note: why it is inspect-only / not editable */
  note?: string;
}

const SUBSEQ: Dest = { step: 'sequence', sub: 'subseq', place: 'Substation 시퀀스' };
const ACTION: Dest = { step: 'attributes', place: 'Action' };
const CAPACITY: Dest = { step: 'attributes', place: '속성 (수용 개수)' };
const MATERIAL: Dest = { step: 'sequence', sub: 'material', place: '자재·Flow (F4)' };
const DIAG: Dest = { step: 'check', sub: 'diag', place: '진단·저장·AML' };
const CHECK: Dest = { step: 'check', place: '점검' };

/** Codes raised by checkGroupReadiness itself (src/runtime/group.ts). */
export const GROUP_CODES = ['NO_SUBSTATION', 'NO_SUB_SEQUENCES', 'NO_STEPS', 'DEVICE_OUTSIDE_SUBSTATION', 'NO_COMPLETE_SIGNAL',
  'DURATION_UNDEFINED', 'TIMEOUT_UNDEFINED', 'CONDITION_UNDEFINED', 'CAPACITY_UNDEFINED', 'DEVICE_CONFLICT',
  'SHARED_MATERIAL_CONFLICT', 'MATERIAL_COUNT', 'MAT_NO_LOCATION', 'MAT_NO_STATE'] as const;
/** Error codes of validateProject (src/model/validate.ts) — the group gate returns these first. */
export const VALIDATE_ERROR_CODES = ['SHAPE', 'ID_INVALID', 'ID_DUPLICATE', 'REF_MISSING_UNIT', 'ORPHAN_UNIT', 'REF_MISSING_DEVICE',
  'DUP_OWNERSHIP', 'OWNERSHIP_MISMATCH', 'ASSET_UNKNOWN', 'REF_MISSING_SIGNAL', 'REF_MISSING_POSITION', 'REF_MISSING_ACTION',
  'REF_MISSING_NODE', 'STATE_UNKNOWN'] as const;

const stepOf = (p: Project, stepId: string): { q: SubstationSequence; s: SubstationSequence['steps'][number] } | undefined => {
  for (const q of p.substationSequences ?? []) { const s = q.steps.find((x) => x.id === stepId); if (s) return { q, s }; }
  return undefined;
};
const UNSUPPORTED_STEP_NOTE = '이 값은 Substation 단계 자체에 저장되어 있고(가져온 파일 등), 현재 화면에는 이를 고치는 편집기가 없습니다. Action 값을 고쳐도 이 차단은 풀리지 않습니다.';

/** Resolve guidance for one blocker. `all` = the full blocker list in gate order (needed to tell which undefined
 *  condition of a step a CONDITION_UNDEFINED entry refers to: the gate emits them in pre → post → entry order). */
export function resolveBlocker(p: Project, b: Pick<Diagnostic, 'code' | 'objectId'>, all: readonly Pick<Diagnostic, 'code' | 'objectId'>[]): BlockerGuide {
  const code = b.code;
  if ((VALIDATE_ERROR_CODES as readonly string[]).includes(code)) return { kind: 'inspect', dest: DIAG, note: '참조 무결성 오류 — 진단 목록에서 원인 객체를 확인하세요' };
  switch (code) {
    case 'NO_SUB_SEQUENCES': case 'NO_STEPS': case 'DEVICE_OUTSIDE_SUBSTATION': case 'DEVICE_CONFLICT': case 'SHARED_MATERIAL_CONFLICT':
      return { kind: 'fix', dest: SUBSEQ };
    case 'NO_COMPLETE_SIGNAL': case 'DURATION_UNDEFINED': case 'TIMEOUT_UNDEFINED': case 'CONDITION_UNDEFINED': case 'CAPACITY_UNDEFINED':
      return resolveStepValue(p, b, all);
    case 'MATERIAL_COUNT':
      if (p.materials.length === 0) return { kind: 'fix', dest: MATERIAL };
      return { kind: 'unsupported', note: `자재 정의가 ${p.materials.length}개입니다. 이 시제품 실행은 1개만 지원하며, 현재 화면은 첫 자재만 편집하고 자재 삭제 기능이 없어 화면에서 개수를 줄일 수 없습니다.` };
    case 'MAT_NO_LOCATION': case 'MAT_NO_STATE':
      return { kind: 'fix', dest: MATERIAL };
    case 'NO_SUBSTATION':
      return { kind: 'inspect', dest: CHECK, note: '선택된 Substation을 찾을 수 없습니다 — 6단계 Substation 목록에서 다시 선택하세요' };
    default:
      return { kind: 'inspect', dest: CHECK, note: '정해진 수정 위치가 없는 차단입니다' };
  }
}

function resolveStepValue(p: Project, b: Pick<Diagnostic, 'code' | 'objectId'>, all: readonly Pick<Diagnostic, 'code' | 'objectId'>[]): BlockerGuide {
  const hit = stepOf(p, b.objectId);
  const a = hit && p.actions.find((x) => x.id === hit.s.actionId);
  if (!hit || !a) return { kind: 'inspect', dest: SUBSEQ, note: '차단된 단계를 찾을 수 없습니다 — Substation 시퀀스에서 확인하세요' };
  const device = p.devices.some((d) => d.id === a.deviceId) ? { id: a.deviceId, kind: 'device' as const } : undefined;
  const actionFix: BlockerGuide = device ? { kind: 'fix', dest: ACTION, focus: device } : { kind: 'inspect', dest: SUBSEQ, note: 'Action의 Device를 찾을 수 없습니다' };
  const unsupportedStep: BlockerGuide = { kind: 'unsupported', dest: SUBSEQ, note: UNSUPPORTED_STEP_NOTE };
  switch (b.code) {
    case 'NO_COMPLETE_SIGNAL': case 'DURATION_UNDEFINED': return actionFix;
    case 'TIMEOUT_UNDEFINED':
      // gate uses (step.timeoutOverride ?? action.timeout): a present override wins even when the Action timeout is set
      return hit.s.timeoutOverride != null ? { ...unsupportedStep, note: `단계 타임아웃(덮어쓰기)이 미정입니다. ${UNSUPPORTED_STEP_NOTE}` } : actionFix;
    case 'CONDITION_UNDEFINED': {
      const src: ('action' | 'entry')[] = [...[...a.pre, ...a.post].filter(undef).map((): 'action' | 'entry' => 'action'),
        ...hit.s.entry.filter(undef).map((): 'action' | 'entry' => 'entry')];
      const same = all.filter((x) => x.code === b.code && x.objectId === b.objectId);
      const ordinal = same.indexOf(b);
      const which = ordinal >= 0 ? src[ordinal] : undefined;
      if (which === 'action') return actionFix;
      if (which === 'entry') return { ...unsupportedStep, note: `단계 진입 조건이 미정입니다. ${UNSUPPORTED_STEP_NOTE}` };
      return { kind: 'inspect', dest: SUBSEQ, note: '이 조건이 Action 조건인지 단계 진입 조건인지 판별할 수 없습니다' };
    }
    case 'CAPACITY_UNDEFINED': {
      const u = a.effect.moveTo && a.effect.moveTo !== 'EXIT' ? p.units.find((x) => x.id === a.effect.moveTo) : undefined;
      return u ? { kind: 'fix', dest: CAPACITY, focus: { id: u.id, kind: 'unit' } } : { kind: 'inspect', dest: SUBSEQ, note: '이동 대상 Unit을 찾을 수 없습니다' };
    }
  }
  return { kind: 'inspect', dest: CHECK };
}
const undef = (c: Condition) => c.kind === 'undefined';

/** "4 자재·시퀀스 › Substation 시퀀스" — step number + real step label + sub-tab/place. */
export function destLabel(d: Dest): string {
  const s = STEPS.find((x) => x.id === d.step)!;
  return `${s.no} ${s.label} › ${d.place}`;
}

/** Visible copy + accessible name per guide kind (kept here so tests and UI share one source). */
export function guideCopy(code: string, g: BlockerGuide): { lead: string; button?: string; aria?: string; badge?: string } {
  const where = g.dest ? destLabel(g.dest) : '';
  if (g.kind === 'fix') return { lead: `수정 위치: ${where}`, button: `${where} 화면으로 이동`, aria: `${code} 원인 수정: ${where} 화면으로 이동` };
  if (g.kind === 'inspect') return { lead: `원인 확인: ${where}${g.note ? ` — ${g.note}` : ''}`, button: `${where}에서 원인 확인`, aria: `${code} 원인 확인(직접 수정 위치 아님): ${where} 화면으로 이동` };
  return { badge: '현재 화면에서 직접 편집 불가', lead: g.note ?? '', button: g.dest ? `${where}에서 원인 확인` : undefined,
    aria: g.dest ? `${code} 현재 화면에서 직접 편집 불가 — 원인 확인: ${where} 화면으로 이동` : undefined };
}
