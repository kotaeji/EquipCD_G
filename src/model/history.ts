import type { CmdResult } from './commands';
import type { Project } from './types';

export interface History {
  past: Project[];
  present: Project;
  future: Project[];
  /** One name per undo step. labels[i] produced past[i + 1], or present when i is the last. */
  labels: string[];
  /** One name per redo step, same order as future. Undo keeps the edit name. */
  futureLabels: string[];
  /** True once an edit fell off HISTORY_LIMIT. The oldest snapshot then has no name. */
  trimmed: boolean;
}
export const HISTORY_LIMIT = 100;

/** Shown when an edit was stored without a name, or the name was dropped past the limit. */
export const UNNAMED_EDIT = '편집';
/** The project as it was when this tab opened, before the remembered edits. */
export const HISTORY_START = '처음';
export const UNDO_BLOCKED = '실행 중에는 Undo가 차단됩니다';

export function initHistory(p: Project): History {
  return { past: [], present: p, future: [], labels: [], futureLabels: [], trimmed: false };
}

export type EditOutcome = { history: History; error?: string; note?: string };

export function editName(label: string | undefined): string {
  const text = (label ?? '').trim();
  return text ? text : UNNAMED_EDIT;
}

/** Apply a command result as one undo unit. `locked` = run in progress (D05: model edit blocked). */
export function applyEdit(h: History, r: CmdResult, label: string, locked: boolean): EditOutcome {
  if (locked) return { history: h, error: '실행 중(또는 일시정지 중)에는 모델 편집이 차단됩니다. 초기화 후 편집하세요. (화면 이동·선택·테마·레이어는 허용)' };
  if (!r.ok) return { history: h, error: r.reason };
  const pastAll = [...h.past, h.present];
  const labelsAll = [...h.labels, label];
  const trimmed = h.trimmed || pastAll.length > HISTORY_LIMIT;
  return {
    history: {
      past: pastAll.slice(-HISTORY_LIMIT),
      present: r.project,
      future: [],
      labels: labelsAll.slice(-HISTORY_LIMIT),
      futureLabels: [],
      trimmed,
    },
    note: r.note,
  };
}

export function undo(h: History, locked: boolean): EditOutcome {
  if (locked) return { history: h, error: UNDO_BLOCKED };
  if (!h.past.length) return { history: h, error: '되돌릴 편집이 없습니다' };
  const prev = h.past[h.past.length - 1];
  const label = h.labels[h.labels.length - 1] ?? '';
  return {
    history: {
      past: h.past.slice(0, -1),
      present: prev,
      future: [h.present, ...h.future],
      labels: h.labels.slice(0, -1),
      futureLabels: [label, ...(h.futureLabels ?? [])],
      trimmed: h.trimmed,
    },
  };
}

export function redo(h: History, locked: boolean): EditOutcome {
  if (locked) return { history: h, error: '실행 중에는 Redo가 차단됩니다' };
  if (!h.future.length) return { history: h, error: '다시 실행할 편집이 없습니다' };
  const [next, ...rest] = h.future;
  const futureLabels = h.futureLabels ?? [];
  const [label, ...left] = futureLabels;
  return {
    history: {
      past: [...h.past, h.present],
      present: next,
      future: rest,
      labels: [...h.labels, label ?? ''],
      futureLabels: left,
      trimmed: h.trimmed,
    },
  };
}

export interface HistoryRow {
  /** Steps from the oldest snapshot. 0 is that snapshot. */
  index: number;
  label: string;
  revision: number;
  place: 'past' | 'current' | 'future';
}

/** Newest edit first. Rows above the current place can be redone. */
export function historyRows(h: History): HistoryRow[] {
  const rows: HistoryRow[] = [];
  const baseline = h.past[0] ?? h.present;
  rows.push({
    index: 0,
    label: h.trimmed ? UNNAMED_EDIT : HISTORY_START,
    revision: baseline.revision,
    place: h.past.length === 0 ? 'current' : 'past',
  });
  for (let i = 0; i < h.labels.length; i++) {
    const index = i + 1;
    const revision = i < h.labels.length - 1 ? h.past[i + 1].revision : h.present.revision;
    rows.push({
      index,
      label: editName(h.labels[i]),
      revision,
      place: index === h.past.length ? 'current' : 'past',
    });
  }
  const futureLabels = h.futureLabels ?? [];
  for (let j = 0; j < h.future.length; j++) {
    rows.push({
      index: h.past.length + 1 + j,
      label: editName(futureLabels[j]),
      revision: h.future[j].revision,
      place: 'future',
    });
  }
  return rows.reverse();
}

/** Move to a historyRows index. Same project as undoing or redoing that many times. */
export function jumpHistory(h: History, index: number, locked: boolean): EditOutcome {
  if (locked) return { history: h, error: UNDO_BLOCKED };
  const current = h.past.length;
  const last = h.past.length + h.future.length;
  if (index === current) return { history: h };
  if (index < 0 || index > last) return { history: h, error: '그 시점의 이력이 없습니다' };
  let cur = h;
  if (index < current) {
    for (let n = 0; n < current - index; n++) {
      const step = undo(cur, false);
      if (step.error) return step;
      cur = step.history;
    }
  } else {
    for (let n = 0; n < index - current; n++) {
      const step = redo(cur, false);
      if (step.error) return step;
      cur = step.history;
    }
  }
  return { history: cur };
}

export function undoTooltip(h: History): string {
  if (!h.past.length) return '실행 취소 (Ctrl/Cmd+Z)';
  const name = editName(h.labels[h.labels.length - 1]);
  return `실행 취소: ${name} (Ctrl/Cmd+Z)`;
}

export function redoTooltip(h: History): string {
  if (!h.future.length) return '다시 실행 (Ctrl/Cmd+Shift+Z)';
  const name = editName((h.futureLabels ?? [])[0]);
  return `다시 실행: ${name} (Ctrl/Cmd+Shift+Z)`;
}
