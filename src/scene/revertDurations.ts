// Put Action durations changed on the 3D screen back.
// Trailing "3D 동작 시간" edits are undone. A later edit that is not a duration
// stays. Durations buried under that edit are written back with the same command.

import * as C from '../model/commands';
import { applyEdit, undo, type History } from '../model/history';

export const DURATION_EDIT_LABEL = '3D 동작 시간';

export interface DurationSnap {
  id: string;
  value: number | null;
  assumption: boolean;
}

export function revertDurationEdits(h: History, baselineDepth: number, snap: DurationSnap[]): History {
  let cur = h;
  while (cur.past.length > baselineDepth && cur.labels[cur.labels.length - 1] === DURATION_EDIT_LABEL) {
    const undone = undo(cur, false);
    if (undone.error) break;
    cur = undone.history;
  }
  for (const item of snap) {
    const action = cur.present.actions.find((a) => a.id === item.id);
    if (!action || action.duration.value === item.value) continue;
    const result = C.setQuantity(cur.present, { kind: 'action', id: item.id, field: 'duration' }, item.value, item.assumption);
    if (!result.ok) continue;
    const applied = applyEdit(cur, result, DURATION_EDIT_LABEL, false);
    if (applied.error) continue;
    cur = applied.history;
  }
  return cur;
}
