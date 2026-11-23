// One status language for the app: six shapes, each with a word, a mark, and a color.
// Run-step words for 대기 · 진행 중 · 완료 · 오류 · 건너뜀 · 정지 stay in stepStatusLabel.
// Station words (대기 · 실행 중 · 일시정지 · 완료 · 오류) stay in runStatusLabel.
import { stepStatusLabel } from '../runtime/runSummary';
import { runStatusLabel } from './labels';

export const STATUS_KEYS = ['active', 'done', 'error', 'pending', 'undetermined', 'assumption'] as const;
export type StatusKey = (typeof STATUS_KEYS)[number];

export interface StatusDef {
  key: StatusKey;
  word: string;
  mark: string;
  /** Text, mark, and border. Set on .app from STATUS_COLOR. */
  colorVar: string;
}

export const STATUS: Record<StatusKey, StatusDef> = {
  active: { key: 'active', word: '진행 중', mark: '▶', colorVar: '--status-active' },
  done: { key: 'done', word: '완료', mark: '✓', colorVar: '--status-done' },
  error: { key: 'error', word: '오류', mark: '!', colorVar: '--status-error' },
  pending: { key: 'pending', word: '대기', mark: '○', colorVar: '--status-pending' },
  undetermined: { key: 'undetermined', word: '미정', mark: '?', colorVar: '--status-undetermined' },
  assumption: { key: 'assumption', word: '가정', mark: '△', colorVar: '--status-assumption' },
};

/** Light and dark inks. Each clears 4.5:1 on panel, canvas, selected, and bg. */
export const STATUS_COLOR: Record<'light' | 'dark', Record<StatusKey, string>> = {
  light: {
    active: '#1a1a1a',
    done: '#176642',
    error: '#b42336',
    pending: '#5c5c5c',
    undetermined: '#1a4f8b',
    assumption: '#8b4800',
  },
  dark: {
    active: '#42d6cc',
    done: '#88dfb1',
    error: '#ff9fab',
    pending: '#b3c4d9',
    undetermined: '#b9d4ff',
    assumption: '#ffd18a',
  },
};

/** Backgrounds a status chip or mark sits on. The contrast test uses these. */
export const STATUS_SURFACES: Record<'light' | 'dark', Record<'panel' | 'canvas' | 'selected' | 'bg', string>> = {
  light: { panel: '#ffffff', canvas: '#f6f6f6', selected: '#e6e6e6', bg: '#f3f3f3' },
  dark: { panel: '#19283a', canvas: '#101b2a', selected: '#203d4c', bg: '#101b2a' },
};

export function statusCssVars(appearance: 'light' | 'dark'): Record<string, string> {
  const colors = STATUS_COLOR[appearance];
  return Object.fromEntries(STATUS_KEYS.map((key) => [STATUS[key].colorVar, colors[key]]));
}

/**
 * Run-step phase → shape.
 * pending / active / done / error use that status's own word.
 * 건너뜀 keeps its word and uses the 대기 shape.
 * 정지 keeps its word and uses the 가정 shape (the warning ink already on the stopped row).
 */
export function phaseShape(phase: string): { status: StatusKey; word: string } {
  const word = stepStatusLabel(phase);
  const status: StatusKey = phase === 'active' ? 'active'
    : phase === 'done' ? 'done'
      : phase === 'error' ? 'error'
        : phase === 'stopped' ? 'assumption'
          : 'pending';
  return { status, word };
}

/**
 * Station run status. The words are runStatusLabel and do not change.
 * 실행 중 uses the 진행 중 shape. 일시정지 uses the 대기 shape.
 */
export function stationShape(status: string | null | undefined): { status: StatusKey; word: string } {
  const word = runStatusLabel(status);
  const key: StatusKey = status === 'running' ? 'active'
    : status === 'completed' ? 'done'
      : status === 'error' ? 'error'
        : 'pending';
  return { status: key, word };
}

/**
 * Step-bar badge shape. The words stay in `BADGE_WORD`.
 * 필수 충족 · 확인됨 use 완료, 필수 누락 uses 오류, 재확인 필요 uses 미정.
 * The mark is `STATUS[this].mark`, so the symbol and the color are the same status.
 */
export const WIZARD_BADGE_STATUS = {
  ready: 'done',
  confirmed: 'done',
  blocked: 'error',
  recheck: 'undetermined',
} as const satisfies Record<string, StatusKey>;

export type WizardBadge = keyof typeof WIZARD_BADGE_STATUS;

/** Mark for a step-bar badge. Same glyph as the status its color comes from. */
export function wizardBadgeMark(badge: WizardBadge): string {
  return STATUS[WIZARD_BADGE_STATUS[badge]].mark;
}

/** Remaining-item chip. 가정값 존재 is shown as 가정 so it matches the other screens. */
export const ITEM_LEVEL_STATUS: Record<'missing' | 'assumption' | 'undetermined' | 'optional' | 'human', { status: StatusKey; word: string }> = {
  missing: { status: 'error', word: '필수 데이터 누락' },
  assumption: { status: 'assumption', word: '가정' },
  undetermined: { status: 'undetermined', word: '미정' },
  optional: { status: 'pending', word: '선택 사항 미확보' },
  human: { status: 'undetermined', word: '사람 확인 필요' },
};

export function gapJudgementMark(judgement: 'shortfall' | 'undetermined' | 'candidate'): { status: StatusKey; word: string } {
  if (judgement === 'shortfall') return { status: 'error', word: '부족' };
  if (judgement === 'undetermined') return { status: 'undetermined', word: '미정' };
  return { status: 'assumption', word: '사람 확인 후보' };
}

export function exportStatusMark(row: 'ready' | 'assumption' | 'undetermined' | 'notInTarget'): { status: StatusKey; word: string } {
  if (row === 'ready') return { status: 'done', word: '준비' };
  if (row === 'assumption') return { status: 'assumption', word: '가정' };
  if (row === 'notInTarget') return { status: 'pending', word: '대상 없음·보관' };
  return { status: 'undetermined', word: '미정' };
}

/** Substation lane. 그룹 정지 keeps its word and uses the 정지 shape (가정 ink). */
export function laneShape(status: string): { status: StatusKey; word: string } {
  if (status === 'stopped') return { status: 'assumption', word: '그룹 정지' };
  return phaseShape(status);
}

/** A piece that is waiting uses the 대기 mark and word, then the rest of its label. */
export function waitingLead(): string {
  return `${STATUS.pending.mark} ${STATUS.pending.word}`;
}

/** Piece phase on the step list and the details table. queued and waiting stay 대기. */
export function piecePhaseStatus(phase: string): StatusKey {
  if (phase === 'done') return 'done';
  if (phase === 'active') return 'active';
  return 'pending';
}

/** Diagram and 3D marker text. Same words and marks as the status chip. */
export function markerText(highlight: 'active' | 'fault' | 'paused'): string {
  if (highlight === 'paused') return `${STATUS.pending.mark} 일시정지`;
  const key: StatusKey = highlight === 'fault' ? 'error' : 'active';
  return `${STATUS[key].mark} ${STATUS[key].word}`;
}

/** Tree row. A fault or a running device wins over an empty or assumed property. */
export function deviceDisplayStatus(flags: { fault: boolean; active: boolean; undetermined: boolean; assumption: boolean }): StatusKey | null {
  if (flags.fault) return 'error';
  if (flags.active) return 'active';
  if (flags.undetermined) return 'undetermined';
  if (flags.assumption) return 'assumption';
  return null;
}
