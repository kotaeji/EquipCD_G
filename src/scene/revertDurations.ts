// Put Action durations and timeouts changed on the 3D screen back.
// Trailing "3D 동작 시간" and "3D 타임아웃" edits are undone. A later edit that
// is neither stays. Values buried under that edit are written back with the same command.

import * as C from '../model/commands';
import { applyEdit, undo, type History } from '../model/history';

export const DURATION_EDIT_LABEL = '3D 동작 시간';
export const TIMEOUT_EDIT_LABEL = '3D 타임아웃';

const SCREEN_QUANTITY_LABELS = new Set<string>([DURATION_EDIT_LABEL, TIMEOUT_EDIT_LABEL]);

export interface DurationSnap {
  id: string;
  value: number | null;
  assumption: boolean;
  /** Absent on snaps that only tracked duration. */
  timeout?: number | null;
  timeoutAssumption?: boolean;
}

export function revertDurationEdits(h: History, baselineDepth: number, snap: DurationSnap[]): History {
  let cur = h;
  while (cur.past.length > baselineDepth && SCREEN_QUANTITY_LABELS.has(cur.labels[cur.labels.length - 1] ?? '')) {
    const undone = undo(cur, false);
    if (undone.error) break;
    cur = undone.history;
  }
  for (const item of snap) {
    const action = cur.present.actions.find((a) => a.id === item.id);
    if (!action) continue;
    if (action.duration.value !== item.value) {
      const result = C.setQuantity(cur.present, { kind: 'action', id: item.id, field: 'duration' }, item.value, item.assumption);
      if (result.ok) {
        const applied = applyEdit(cur, result, DURATION_EDIT_LABEL, false);
        if (!applied.error) cur = applied.history;
      }
    }
    if (item.timeout !== undefined && cur.present.actions.find((a) => a.id === item.id)?.timeout.value !== item.timeout) {
      const result = C.setQuantity(cur.present, { kind: 'action', id: item.id, field: 'timeout' }, item.timeout, item.timeoutAssumption ?? false);
      if (result.ok) {
        const applied = applyEdit(cur, result, TIMEOUT_EDIT_LABEL, false);
        if (!applied.error) cur = applied.history;
      }
    }
  }
  return cur;
}
