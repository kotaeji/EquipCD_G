// Shared with the run-conditions column. A shorter timeout is the existing TIMEOUT warning.
import type { Action } from '../model/types';

export const TIMEOUT_WARN = '타임아웃이 동작 시간보다 짧습니다 — 실행하면 TIMEOUT';
export const TIMEOUT_EQUAL = '타임아웃이 동작 시간과 같습니다 — 여유가 없습니다';

/** Matches the engine tie rule: equal millisecond instants succeed, a shorter timeout is TIMEOUT. */
export function timeoutNote(action: Pick<Action, 'timeout' | 'duration'>): string | null {
  const timeout = action.timeout.value;
  const duration = action.duration.value;
  if (timeout === null || duration === null) return null;
  const timeoutMs = Math.round(timeout * 1000);
  const durationMs = Math.round(duration * 1000);
  if (timeoutMs < durationMs) return TIMEOUT_WARN;
  if (timeoutMs === durationMs) return TIMEOUT_EQUAL;
  return null;
}
