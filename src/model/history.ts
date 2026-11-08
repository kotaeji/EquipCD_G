import type { CmdResult } from './commands';
import type { Project } from './types';

export interface History { past: Project[]; present: Project; future: Project[]; labels: string[] }
export const HISTORY_LIMIT = 100;

export function initHistory(p: Project): History { return { past: [], present: p, future: [], labels: [] }; }

export type EditOutcome = { history: History; error?: string; note?: string };

/** Apply a command result as one undo unit. `locked` = run in progress (D05: model edit blocked). */
export function applyEdit(h: History, r: CmdResult, label: string, locked: boolean): EditOutcome {
  if (locked) return { history: h, error: '실행 중(또는 일시정지 중)에는 모델 편집이 차단됩니다. 초기화 후 편집하세요. (화면 이동·선택·테마·레이어는 허용)' };
  if (!r.ok) return { history: h, error: r.reason };
  const past = [...h.past, h.present].slice(-HISTORY_LIMIT);
  return { history: { past, present: r.project, future: [], labels: [...h.labels, label].slice(-HISTORY_LIMIT) }, note: r.note };
}

export function undo(h: History, locked: boolean): EditOutcome {
  if (locked) return { history: h, error: '실행 중에는 Undo가 차단됩니다' };
  if (!h.past.length) return { history: h, error: '되돌릴 편집이 없습니다' };
  const prev = h.past[h.past.length - 1];
  return { history: { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future], labels: h.labels.slice(0, -1) } };
}

export function redo(h: History, locked: boolean): EditOutcome {
  if (locked) return { history: h, error: '실행 중에는 Redo가 차단됩니다' };
  if (!h.future.length) return { history: h, error: '다시 실행할 편집이 없습니다' };
  const [next, ...rest] = h.future;
  return { history: { past: [...h.past, h.present], present: next, future: rest, labels: [...h.labels, 'redo'] } };
}
