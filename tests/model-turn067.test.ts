import { describe, expect, it } from 'vitest';
import * as C from '../src/model/commands';
import { emptyProject } from '../src/model/factory';
import {
  HISTORY_LIMIT,
  UNNAMED_EDIT,
  applyEdit,
  historyRows,
  initHistory,
  jumpHistory,
  redo,
  redoTooltip,
  undo,
  undoTooltip,
} from '../src/model/history';

function named(label: string) {
  return (h: ReturnType<typeof initHistory>) => applyEdit(h, C.renameProject(h.present, label), label, false).history;
}

describe('TURN-067 undo history', () => {
  it('AC2 AC3 a row jump matches that many undos and redos, and a new edit drops the redo side', () => {
    let h = initHistory(emptyProject('t'));
    h = named('하나')(h);
    h = named('둘')(h);
    h = named('셋')(h);
    const latest = h.present;
    const once = undo(h, false).history;
    const twice = undo(once, false).history;
    expect(jumpHistory(h, h.past.length - 2, false).history.present).toEqual(twice.present);
    expect(jumpHistory(h, h.past.length - 2, false).history.labels).toEqual(twice.labels);
    const jumped = jumpHistory(h, once.past.length, false).history;
    expect(jumped.present).toEqual(once.present);
    expect(jumped.futureLabels[0]).toBe('셋');
    const forward = jumpHistory(jumped, jumped.past.length + jumped.future.length, false).history;
    expect(forward.present).toEqual(latest);
    expect(forward.labels).toEqual(['하나', '둘', '셋']);
    expect(forward.future).toEqual([]);
    const branched = applyEdit(jumped, C.renameProject(jumped.present, '새 편집'), '새 편집', false).history;
    expect(branched.future).toEqual([]);
    expect(historyRows(branched).some((row) => row.place === 'future' || row.label === '셋')).toBe(false);
    expect(historyRows(branched)[0]).toMatchObject({ label: '새 편집', place: 'current' });
  });

  it('AC4 tooltips name the next undo and redo', () => {
    let h = initHistory(emptyProject('t'));
    expect(undoTooltip(h)).toBe('실행 취소 (Ctrl/Cmd+Z)');
    expect(redoTooltip(h)).toBe('다시 실행 (Ctrl/Cmd+Shift+Z)');
    h = named('Device 이동')(h);
    h = named('물류 연결')(h);
    expect(undoTooltip(h)).toBe('실행 취소: 물류 연결 (Ctrl/Cmd+Z)');
    h = undo(h, false).history;
    expect(redoTooltip(h)).toBe('다시 실행: 물류 연결 (Ctrl/Cmd+Shift+Z)');
    expect(undoTooltip(h)).toBe('실행 취소: Device 이동 (Ctrl/Cmd+Z)');
    const restored = redo(h, false).history;
    expect(restored.labels[restored.labels.length - 1]).toBe('물류 연결');
  });

  it('AC5 a locked jump keeps the history and gives the undo reason', () => {
    const h = named('하나')(initHistory(emptyProject('t')));
    const blocked = jumpHistory(h, 0, true);
    expect(blocked.history).toBe(h);
    expect(blocked.error).toBe('실행 중에는 Undo가 차단됩니다');
    expect(undo(h, true).error).toBe(blocked.error);
  });

  it('AC6 drops the oldest edit after 100 and keeps a blank name as 편집', () => {
    let h = initHistory(emptyProject('t'));
    h = applyEdit(h, C.renameProject(h.present, '빈'), '   ', false).history;
    expect(historyRows(h).find((row) => row.place === 'current')!.label).toBe(UNNAMED_EDIT);
    for (let i = 0; i < HISTORY_LIMIT + 1; i++) h = named(`이름 ${i}`)(h);
    expect(h.labels).toHaveLength(HISTORY_LIMIT);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.labels[0]).toBe('이름 1');
    expect(h.labels).not.toContain('이름 0');
    const rows = historyRows(h);
    expect(rows.filter((row) => row.label.startsWith('이름'))).toHaveLength(HISTORY_LIMIT);
    expect(rows.some((row) => row.label === '이름 0')).toBe(false);
    expect(rows[rows.length - 1]).toMatchObject({ label: UNNAMED_EDIT, place: 'past' });
    expect(rows[0]).toMatchObject({ label: `이름 ${HISTORY_LIMIT}`, place: 'current' });
    const other = named('다른 탭')(initHistory(emptyProject('other')));
    expect(other.labels).toEqual(['다른 탭']);
    expect(h.labels).not.toContain('다른 탭');
  });
});
