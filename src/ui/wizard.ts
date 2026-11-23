// C10 beginner wizard (design proposal): 6 steps, each with its own central workspace.
// Readiness is ALWAYS computed from the current model (never from "visited"/checkbox clicks).
// Step confirmation stores a fingerprint of the data the step depends on; if that data changes later the
// step shows "재확인 필요" (C10-07). View-only state (photo/schematic, theme, layers) is not part of any fingerprint.
// TURN-038 adds kind + jump on each item. level, ready, and fingerprint are unchanged.
import type { Gap } from '../model/gaps';
import type { Project } from '../model/types';
import { checkRunReadiness } from '../model/validate';
import type { RuntimeState } from '../runtime/engine';
import { runStatusLabel } from './labels';
import { wizardBadgeMark } from './status';

export type StepId = 'library' | 'canvas' | 'attributes' | 'sequence' | 'check' | 'run';
export const STEPS: { id: StepId; no: number; label: string; workspace: string; goal: string }[] = [
  { id: 'library', no: 1, label: '입력·에셋 선택', workspace: '에셋 라이브러리 카드 · 입력 후보표', goal: '사용할 에셋(AML 정의)을 고르고 프로젝트에 추가합니다.' },
  { id: 'canvas', no: 2, label: '배치·연결', workspace: 'Canvas (F2)', goal: 'Unit 안에 Device를 배치하고 물류/신호를 연결합니다.' },
  { id: 'attributes', no: 3, label: '속성·Action', workspace: '속성/Action 편집기 (F3)', goal: '필요 사양, 명령·완료 Signal, 동작/타임아웃을 채웁니다.' },
  { id: 'sequence', no: 4, label: '자재·시퀀스', workspace: '자재/Flow (F4) · 시퀀스 Draft/SFC (F5)', goal: '자재 초기 위치·경로와 시퀀스 단계를 정합니다.' },
  { id: 'check', no: 5, label: '점검', workspace: 'Gap 목록 (F6) · 진단 · Export 미리보기', goal: '차단 사유·미정·사람 확인 항목을 확인합니다.' },
  { id: 'run', no: 6, label: '실행·저장', workspace: '논리 시뮬레이션 (C04) · 저장 상태', goal: '실행 전 검사를 통과하면 실행하고 결과를 저장합니다.' },
];

export type ItemLevel = 'missing' | 'assumption' | 'undetermined' | 'optional' | 'human';
export const LEVEL_LABEL: Record<ItemLevel, string> = { missing: '필수 데이터 누락', assumption: '가정값 존재', undetermined: '미정', optional: '선택 사항 미확보', human: '사람 확인 필요' };

/** One row kind from evaluateSteps. The UI gives every kind a destination, or the words 「이동할 화면 없음」. */
export const ITEM_KINDS = [
  'library-empty', 'candidate', 'photo-missing',
  'no-unit', 'unit-empty', 'unit-no-flow',
  'prop-unset', 'assumptions', 'action-complete', 'action-timeout', 'action-pre', 'interlock',
  'no-material', 'material-location', 'material-state', 'material-route', 'no-steps', 'sequence-unresolved',
  'run-blocker', 'gap-human', 'gap',
  'run-not-ready', 'not-run', 'unsaved',
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** View destination. save = highlight the header 저장 button and leave the step alone. */
export interface ItemJump {
  step: StepId;
  sub?: string;
  selectId?: string;
  rightTab?: string;
  /** matches [data-jump] on the field to scroll and outline */
  field?: string;
  actionId?: string;
  save?: boolean;
  gapFilter?: 'all' | 'human';
}
export interface StepItem {
  level: ItemLevel;
  kind: ItemKind;
  text: string;
  /** null only when this screen has nowhere to send the user */
  jump: ItemJump | null;
  targetId?: string;
  targetStep?: StepId;
}
export interface StepEval { id: StepId; ready: boolean; items: StepItem[]; fingerprint: string }

const fp = (o: unknown) => { const s = JSON.stringify(o); let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };

export interface EvalContext { gaps: Gap[]; rt: RuntimeState | null; saved: boolean; photoMissingKinds: string[] }

const CHECK: ItemJump = { step: 'check', sub: 'gap', field: 'check-gaps' };

/** Best screen for an object id. Unknown ids fall back to 5 점검. */
function locate(p: Project, objectId: string | undefined, fallback: ItemJump = CHECK): ItemJump {
  if (!objectId) return fallback;
  if (p.devices.some((d) => d.id === objectId)) return { step: 'attributes', selectId: objectId, rightTab: 'actions', field: `device:${objectId}` };
  if (p.units.some((u) => u.id === objectId)) return { step: 'canvas', selectId: objectId, field: `unit:${objectId}` };
  if (objectId === 'materials') return { step: 'sequence', sub: 'material', field: p.materials.length ? 'material-location' : 'material-add' };
  const material = p.materials.find((m) => m.id === objectId);
  if (material) return { step: 'sequence', sub: 'material', selectId: material.id, field: material.initialLocation ? 'material-state' : 'material-location' };
  if (p.sequence.steps.some((s) => s.id === objectId)) return { step: 'sequence', sub: 'sequence', field: `step:${objectId}` };
  if (objectId === p.sequence.id) return { step: 'sequence', sub: 'sequence', field: p.sequence.steps.length ? 'sequence-steps' : 'sequence-add' };
  const action = p.actions.find((a) => a.id === objectId);
  if (action) return { step: 'attributes', selectId: action.deviceId, rightTab: 'actions', actionId: action.id, field: `timeout:${action.id}` };
  const sub = (p.substationSequences ?? []).flatMap((q) => q.steps).find((s) => s.id === objectId);
  if (sub) {
    const a = p.actions.find((x) => x.id === sub.actionId);
    return a
      ? { step: 'attributes', selectId: a.deviceId, rightTab: 'actions', actionId: a.id, field: `timeout:${a.id}` }
      : { step: 'sequence', sub: 'subseq', field: 'sequence-steps' };
  }
  return fallback;
}

export function evaluateSteps(p: Project, ctx: EvalContext): Record<StepId, StepEval> {
  const out = {} as Record<StepId, StepEval>;
  const mk = (id: StepId, items: StepItem[], basis: unknown) => { out[id] = { id, ready: !items.some((i) => i.level === 'missing'), items, fingerprint: fp(basis) }; };

  // 1 library / input
  const s1: StepItem[] = [];
  if (p.units.length === 0 && p.devices.length === 0) s1.push({ level: 'missing', kind: 'library-empty', text: '프로젝트에 추가된 에셋/유닛이 없습니다 — 카드에서 "프로젝트에 추가"', jump: { step: 'library', sub: 'cards', field: 'library-cards' } });
  for (const c of p.candidates.filter((c) => c.confirmation === 'unconfirmed')) s1.push({ level: 'human', kind: 'candidate', text: `입력 후보 "${c.name}" 확인 대기`, jump: { step: 'library', sub: 'input', field: `candidate:${c.id}` } });
  const usedKinds = [...new Set(p.devices.map((d) => d.kind))];
  for (const k of usedKinds.filter((k) => ctx.photoMissingKinds.includes(k))) s1.push({ level: 'optional', kind: 'photo-missing', text: `${k}: AI 생성 이미지 미준비 → 도식 사용 (진행 차단 아님)`, jump: { step: 'library', sub: 'cards', field: `asset:${k}` } });
  mk('library', s1, { u: p.units.map((u) => [u.id, u.templateRef]), d: p.devices.map((d) => [d.id, d.definitionRef]), c: p.candidates.map((c) => [c.id, c.confirmation]) });

  // 2 canvas
  const s2: StepItem[] = [];
  if (p.units.length === 0) s2.push({ level: 'missing', kind: 'no-unit', text: 'Unit이 없습니다', targetStep: 'canvas', jump: { step: 'canvas', field: 'palette-unit' } });
  for (const u of p.units) if (u.deviceIds.length === 0) s2.push({ level: 'missing', kind: 'unit-empty', text: `${u.name}: Device 없음`, targetId: u.id, jump: { step: 'canvas', selectId: u.id, field: `unit:${u.id}` } });
  const flows = p.connections.filter((c) => c.kind === 'flow');
  if (p.units.length > 1) for (const u of p.units) if (!flows.some((f) => f.from.nodeId === u.id || f.to.nodeId === u.id)) s2.push({ level: 'undetermined', kind: 'unit-no-flow', text: `${u.name}: 물류 연결 없음`, targetId: u.id, jump: { step: 'canvas', selectId: u.id, field: `unit:${u.id}` } });
  mk('canvas', s2, { u: p.units.map((u) => [u.id, u.deviceIds]), f: flows.map((f) => [f.from, f.to]), s: p.connections.filter((c) => c.kind === 'signal').map((c) => [c.from, c.to]) });

  // 3 attributes / actions
  const s3: StepItem[] = [];
  for (const d of p.devices) for (const [k, qv] of Object.entries(d.properties)) {
    if (qv.value === null) s3.push({ level: 'undetermined', kind: 'prop-unset', text: `${d.name}.${k} 값 미정`, targetId: d.id, jump: { step: 'attributes', selectId: d.id, rightTab: 'props', field: `prop:${d.id}:${k}` } });
  }
  const assumed = p.devices.reduce((n, d) => n + Object.values(d.properties).filter((q) => q.value !== null && q.assumption).length, 0);
  if (assumed) {
    let jump: ItemJump = { step: 'attributes', rightTab: 'props', field: 'device-props' };
    for (const d of p.devices) {
      const hit = Object.entries(d.properties).find(([, qv]) => qv.value !== null && qv.assumption);
      if (hit) { jump = { step: 'attributes', selectId: d.id, rightTab: 'props', field: `prop:${d.id}:${hit[0]}` }; break; }
    }
    s3.push({ level: 'assumption', kind: 'assumptions', text: `가정값 속성 ${assumed}개 (확정 사양 아님)`, jump });
  }
  const usedActionIds = new Set(p.sequence.steps.map((s) => s.actionId));
  for (const a of p.actions) {
    const used = usedActionIds.has(a.id);
    const lvl: ItemLevel = used ? 'missing' : 'undetermined';
    const base = { step: 'attributes' as const, selectId: a.deviceId, rightTab: 'actions', actionId: a.id };
    if (!a.completeSignalId) s3.push({ level: lvl, kind: 'action-complete', text: `Action ${a.name}: 완료 Signal 미정${used ? ' (시퀀스에서 사용 중)' : ''}`, targetId: a.deviceId, jump: { ...base, field: `complete:${a.id}` } });
    if (a.timeout.value === null) s3.push({ level: lvl, kind: 'action-timeout', text: `Action ${a.name}: 타임아웃 미정${used ? ' (시퀀스에서 사용 중)' : ''}`, targetId: a.deviceId, jump: { ...base, field: `timeout:${a.id}` } });
    if (a.pre.some((c) => c.kind === 'undefined')) s3.push({ level: lvl, kind: 'action-pre', text: `Action ${a.name}: 미정 사전조건`, targetId: a.deviceId, jump: { ...base, field: `pre:${a.id}` } });
  }
  for (const k of p.constraints.filter((k) => k.confirmation === 'unconfirmed')) {
    const dev = k.relatedIds.find((id) => p.devices.some((d) => d.id === id));
    s3.push({ level: 'human', kind: 'interlock', text: `Interlock 후보 확인 필요: ${k.description}`, jump: { step: 'attributes', selectId: dev, rightTab: 'check', field: `interlock:${k.id}` } });
  }
  mk('attributes', s3, { a: p.actions.map((a) => [a.id, a.commandSignalId, a.completeSignalId, a.timeout.value, a.duration.value, a.pre, a.post]), s: p.signals.map((s) => s.id), d: p.devices.map((d) => [d.id, d.properties]), k: p.constraints.map((k) => [k.confirmation, k.rule ?? null]) });

  // 4 material / sequence
  const s4: StepItem[] = [];
  if (p.materials.length === 0) s4.push({ level: 'missing', kind: 'no-material', text: '자재 정의 없음', jump: { step: 'sequence', sub: 'material', field: 'material-add' } });
  for (const m of p.materials) {
    if (!m.initialLocation) s4.push({ level: 'missing', kind: 'material-location', text: `${m.name}: 초기 위치 미정`, targetId: m.id, jump: { step: 'sequence', sub: 'material', selectId: m.id, field: 'material-location' } });
    if (!m.initialState) s4.push({ level: 'missing', kind: 'material-state', text: `${m.name}: 초기 상태 미정`, targetId: m.id, jump: { step: 'sequence', sub: 'material', selectId: m.id, field: 'material-state' } });
    if (m.route.length === 0) s4.push({ level: 'undetermined', kind: 'material-route', text: `${m.name}: 경로 미정`, targetId: m.id, jump: { step: 'sequence', sub: 'material', selectId: m.id, field: 'material-route' } });
  }
  if (p.sequence.steps.length === 0) s4.push({ level: 'missing', kind: 'no-steps', text: '시퀀스 단계 없음', jump: { step: 'sequence', sub: 'sequence', field: 'sequence-add' } });
  for (const u of p.sequence.unresolved) s4.push({ level: 'undetermined', kind: 'sequence-unresolved', text: `시퀀스 미해결: ${u}`, jump: { step: 'sequence', sub: 'sequence', field: 'sequence-unresolved' } });
  mk('sequence', s4, { m: p.materials, st: p.sequence.steps, un: p.sequence.unresolved });

  // 5 check
  const s5: StepItem[] = [];
  const rd = checkRunReadiness(p);
  for (const b of rd.blockers) s5.push({ level: 'missing', kind: 'run-blocker', text: `실행 차단: ${b.message}`, targetId: b.objectId, jump: locate(p, b.objectId) });
  for (const g of ctx.gaps.filter((g) => g.safety || g.judgement === 'candidate')) s5.push({ level: 'human', kind: 'gap-human', text: `Gap(사람 확인): ${g.title}`, targetId: g.target.objectId, jump: { step: 'check', sub: 'gap', field: `gap:${g.id}`, gapFilter: 'human' } });
  for (const g of ctx.gaps.filter((g) => !g.safety && g.judgement !== 'candidate')) s5.push({ level: g.judgement === 'shortfall' ? 'assumption' : 'undetermined', kind: 'gap', text: `Gap: ${g.title}`, targetId: g.target.objectId, jump: { step: 'check', sub: 'gap', field: `gap:${g.id}`, gapFilter: 'all' } });
  mk('check', s5, { b: rd.blockers.map((b) => b.code + b.objectId), g: ctx.gaps.map((g) => g.id), r: p.revision });

  // 6 run / save
  const s6: StepItem[] = [];
  if (!rd.ok) s6.push({ level: 'missing', kind: 'run-not-ready', text: `실행 전 검사 미통과 (${rd.blockers.length}건) — 5 점검 단계 참고`, targetStep: 'check', jump: { step: 'check', sub: 'gap', field: 'check-gaps' } });
  if (!ctx.rt || ctx.rt.status !== 'completed') s6.push({ level: 'undetermined', kind: 'not-run', text: ctx.rt ? `시뮬 상태 ${runStatusLabel(ctx.rt.status)} (완료 아님)` : '아직 실행하지 않음', jump: { step: 'run', field: 'run-start' } });
  if (!ctx.saved) s6.push({ level: 'undetermined', kind: 'unsaved', text: '저장되지 않은 변경 있음', jump: { step: 'run', save: true, field: 'save' } });
  mk('run', s6, { r: p.revision, st: ctx.rt?.status ?? null, saved: ctx.saved });
  return out;
}

/** Visible status word. The mark comes from the same status as the badge color. */
export const BADGE_WORD = { ready: '필수 충족', blocked: '필수 누락', recheck: '재확인 필요', confirmed: '확인됨' } as const;
export const BADGE_MARK = { ready: wizardBadgeMark('ready'), blocked: wizardBadgeMark('blocked'), recheck: wizardBadgeMark('recheck'), confirmed: wizardBadgeMark('confirmed') } as const;
export const BADGE_TONE = { ready: 'ok', blocked: 'err', recheck: 'warn', confirmed: 'ok' } as const;

/** step status for the stepper: 'ready' | 'blocked' | 'recheck' (confirmed earlier but dependency data changed) */
export function stepBadge(e: StepEval, confirmed: string | undefined): 'ready' | 'blocked' | 'recheck' | 'confirmed' {
  if (confirmed && confirmed !== e.fingerprint) return 'recheck';
  if (!e.ready) return 'blocked';
  return confirmed === e.fingerprint ? 'confirmed' : 'ready';
}
