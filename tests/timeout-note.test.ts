import { describe, expect, it } from 'vitest';
import { timeoutNote, TIMEOUT_WARN, TIMEOUT_EQUAL } from '../src/ui/timeoutNote';

describe('timeoutNote', () => {
  it('returns null when timeout or duration is null', () => {
    const action1 = { timeout: { value: null }, duration: { value: 1.0 } } as Parameters<typeof timeoutNote>[0];
    expect(timeoutNote(action1)).toBeNull();

    const action2 = { timeout: { value: 1.0 }, duration: { value: null } } as Parameters<typeof timeoutNote>[0];
    expect(timeoutNote(action2)).toBeNull();
  });

  it('returns TIMEOUT_WARN when timeout is shorter than duration', () => {
    const action = { timeout: { value: 0.5 }, duration: { value: 1.0 } } as Parameters<typeof timeoutNote>[0];
    expect(timeoutNote(action)).toBe(TIMEOUT_WARN);
  });

  it('returns TIMEOUT_EQUAL when timeout equals duration after millisecond rounding', () => {
    const action = { timeout: { value: 1.0004 }, duration: { value: 1.0 } } as Parameters<typeof timeoutNote>[0];
    expect(timeoutNote(action)).toBe(TIMEOUT_EQUAL);
  });

  it('returns null when timeout is longer than duration', () => {
    const action = { timeout: { value: 2.0 }, duration: { value: 1.0 } } as Parameters<typeof timeoutNote>[0];
    expect(timeoutNote(action)).toBeNull();
  });
});
