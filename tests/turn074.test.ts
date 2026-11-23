import { describe, expect, it } from 'vitest';
import { applyBulkEdit, bulkOperandError, BULK_SOURCE_NOTE, previewBulkEdit } from '../src/model/bulkEdit';
import { setQuantity } from '../src/model/commands';
import { applyEdit, initHistory, undo } from '../src/model/history';
import { buildSampleProject } from '../src/model/sample';
import { quantityDraftError } from '../src/ui/widgets';

function actionNamed(name: string) {
  const project = buildSampleProject();
  const action = project.actions.find((item) => item.name === name);
  if (!action) throw new Error(name);
  return { project, action };
}

describe('TURN-074 bulk edit', () => {
  it('AC2 set, scale, and add match the arithmetic, and other actions stay', () => {
    const { project, action } = actionNamed('S3 가공 실린더 전진(가상 작업)');
    expect(action.duration.value).toBe(2);
    expect(action.timeout.value).toBe(4);

    const set = applyBulkEdit(project, { actionIds: [action.id], duration: { mode: 'set', amount: 1.5 } });
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    expect(set.project.revision).toBe(project.revision + 1);
    const setAction = set.project.actions.find((item) => item.id === action.id)!;
    expect(setAction.duration.value).toBe(1.5);
    expect(setAction.timeout.value).toBe(4);
    expect(setAction.duration.source).toEqual({ method: 'direct-input', note: BULK_SOURCE_NOTE });
    expect(setAction.timeout.source?.note).toBeUndefined();
    expect(project.actions.find((item) => item.id === action.id)!.duration.value).toBe(2);

    const scale = applyBulkEdit(project, { actionIds: [action.id], duration: { mode: 'scale', amount: 0.5 } });
    expect(scale.ok && scale.project.actions.find((item) => item.id === action.id)!.duration.value).toBe(1);

    const add = applyBulkEdit(project, { actionIds: [action.id], timeout: { mode: 'add', amount: -1 } });
    expect(add.ok && add.project.actions.find((item) => item.id === action.id)!.timeout.value).toBe(3);
    expect(add.ok && add.project.actions.find((item) => item.id === action.id)!.duration.value).toBe(2);

    const pusher = project.actions.find((item) => item.name === 'S1 푸셔 투입')!;
    const both = applyBulkEdit(project, { actionIds: [action.id, pusher.id], duration: { mode: 'add', amount: 0.2 } });
    expect(both.ok).toBe(true);
    if (!both.ok) return;
    expect(both.project.actions.find((item) => item.id === action.id)!.duration.value).toBe(2.2);
    expect(both.project.actions.find((item) => item.id === pusher.id)!.duration.value).toBe(1);
    const untouched = project.actions.filter((item) => item.id !== action.id && item.id !== pusher.id);
    for (const item of untouched) {
      const next = both.project.actions.find((row) => row.id === item.id)!;
      expect(next.duration).toEqual(item.duration);
      expect(next.timeout).toEqual(item.timeout);
    }
  });

  it('AC3 sets timeout from duration × factor + margin, using the duration in the same request', () => {
    const { project, action } = actionNamed('S3 가공 실린더 전진(가상 작업)');
    const rule = applyBulkEdit(project, { actionIds: [action.id], timeoutRule: { factor: 2, margin: 0.5 } });
    expect(rule.ok && rule.project.actions.find((item) => item.id === action.id)!.timeout.value).toBe(4.5);
    expect(rule.ok && rule.project.actions.find((item) => item.id === action.id)!.duration.value).toBe(2);

    const together = applyBulkEdit(project, {
      actionIds: [action.id],
      duration: { mode: 'set', amount: 1 },
      timeoutRule: { factor: 3, margin: 0.25 },
    });
    expect(together.ok && together.project.actions.find((item) => item.id === action.id)!.duration.value).toBe(1);
    expect(together.ok && together.project.actions.find((item) => item.id === action.id)!.timeout.value).toBe(3.25);
  });

  it('AC4 warns on negative, zero, and a short timeout, and does not write those rows', () => {
    const { project, action } = actionNamed('S3 가공 실린더 전진(가상 작업)');
    const slow = project.actions.find((item) => item.name === 'S5 스토퍼 하강(해제)')!;
    expect(slow.duration.value).toBe(0.3);

    const zero = previewBulkEdit(project, { actionIds: [action.id], duration: { mode: 'set', amount: 0 } });
    expect(zero.rows[0].warnings).toContain('동작 시간 0');
    expect(zero.rows[0].durationTo).toBe('0 s');
    expect(zero.rows[0].apply).toBe(false);
    expect(applyBulkEdit(project, { actionIds: [action.id], duration: { mode: 'set', amount: 0 } }).ok).toBe(false);

    const negative = previewBulkEdit(project, { actionIds: [action.id], duration: { mode: 'add', amount: -5 } });
    expect(negative.rows[0].warnings).toContain('동작 시간 음수');
    expect(negative.rows[0].durationFrom).toBe('2 s');
    expect(negative.rows[0].durationTo).toBe('-3 s');
    expect(applyBulkEdit(project, { actionIds: [action.id], duration: { mode: 'add', amount: -5 } }).ok).toBe(false);

    const short = previewBulkEdit(project, { actionIds: [action.id], timeout: { mode: 'set', amount: 0.2 } });
    expect(short.rows[0].warnings).toContain('타임아웃이 동작 시간보다 짧습니다');
    expect(short.rows[0].timeoutFrom).toBe('4 s');
    expect(short.rows[0].timeoutTo).toBe('0.2 s');
    expect(applyBulkEdit(project, { actionIds: [action.id], timeout: { mode: 'set', amount: 0.2 } }).ok).toBe(false);

    const mixed = applyBulkEdit(project, { actionIds: [action.id, slow.id], duration: { mode: 'add', amount: -0.5 } });
    expect(mixed.ok).toBe(true);
    if (!mixed.ok) return;
    expect(mixed.project.actions.find((item) => item.id === action.id)!.duration.value).toBe(1.5);
    expect(mixed.project.actions.find((item) => item.id === slow.id)!.duration.value).toBe(0.3);
    expect(mixed.project.actions.find((item) => item.id === slow.id)!.duration.source?.note).toBeUndefined();
    expect(mixed.project.revision).toBe(project.revision + 1);
  });

  it('AC5 is one revision and one undo, and a running edit is refused', () => {
    const project = buildSampleProject();
    const ids = project.actions.slice(0, 3).map((item) => item.id);
    const history = initHistory(project);
    const result = applyBulkEdit(project, { actionIds: ids, duration: { mode: 'scale', amount: 0.5 } });
    const applied = applyEdit(history, result, '일괄 편집', false);
    expect(applied.error).toBeUndefined();
    expect(applied.history.past).toHaveLength(1);
    expect(applied.history.present.revision).toBe(project.revision + 1);
    for (const id of ids) {
      const before = project.actions.find((item) => item.id === id)!.duration.value!;
      expect(applied.history.present.actions.find((item) => item.id === id)!.duration.value).toBe(Math.round(before * 0.5 * 1000) / 1000);
    }
    const back = undo(applied.history, false);
    expect(back.history.past).toHaveLength(0);
    expect(back.history.present.actions.map((item) => item.duration.value)).toEqual(project.actions.map((item) => item.duration.value));
    expect(back.history.present.revision).toBe(project.revision);

    const refused = applyEdit(history, result, '일괄 편집', true);
    expect(refused.error).toContain('차단');
    expect(refused.history.present).toBe(history.present);
    expect(refused.history.past).toHaveLength(0);
  });

  it('AC6 flips 가정 and 확인, and 미정 clears both numbers', () => {
    const { project, action } = actionNamed('S1 푸셔 투입');
    expect(action.duration.assumption).toBe(true);
    const confirmed = applyBulkEdit(project, { actionIds: [action.id], status: 'confirm' });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    const next = confirmed.project.actions.find((item) => item.id === action.id)!;
    expect(next.duration.value).toBe(action.duration.value);
    expect(next.timeout.value).toBe(action.timeout.value);
    expect(next.duration.assumption).toBe(false);
    expect(next.timeout.assumption).toBe(false);
    expect(next.duration.source?.note).toBe(BULK_SOURCE_NOTE);
    const history = next.duration.history ?? [];
    expect(history[history.length - 1]?.note).toBe(BULK_SOURCE_NOTE);

    const assumed = applyBulkEdit(confirmed.project, { actionIds: [action.id], status: 'assume' });
    expect(assumed.ok && assumed.project.actions.find((item) => item.id === action.id)!.duration.assumption).toBe(true);
    expect(assumed.ok && assumed.project.actions.find((item) => item.id === action.id)!.timeout.assumption).toBe(true);

    const cleared = applyBulkEdit(project, { actionIds: [action.id], status: 'unset' });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    const empty = cleared.project.actions.find((item) => item.id === action.id)!;
    expect(empty.duration.value).toBeNull();
    expect(empty.timeout.value).toBeNull();
    expect(empty.duration.source?.note).toBe(BULK_SOURCE_NOTE);

    const again = applyBulkEdit(cleared.project, { actionIds: [action.id], status: 'unset' });
    expect(again.ok).toBe(false);
  });

  it('AC8 matches one-by-one edits when the numbers and flags are the same', () => {
    const project = buildSampleProject();
    const ids = project.actions.slice(0, 2).map((item) => item.id);
    let single = project;
    for (const id of ids) {
      const duration = setQuantity(single, { kind: 'action', id, field: 'duration' }, 1.25, false);
      expect(duration.ok).toBe(true);
      if (!duration.ok) return;
      single = duration.project;
      const timeout = setQuantity(single, { kind: 'action', id, field: 'timeout' }, 3.5, false);
      expect(timeout.ok).toBe(true);
      if (!timeout.ok) return;
      single = timeout.project;
    }
    const bulk = applyBulkEdit(project, {
      actionIds: ids,
      duration: { mode: 'set', amount: 1.25 },
      timeout: { mode: 'set', amount: 3.5 },
      status: 'confirm',
    });
    expect(bulk.ok).toBe(true);
    if (!bulk.ok) return;
    for (const id of ids) {
      const left = single.actions.find((item) => item.id === id)!;
      const right = bulk.project.actions.find((item) => item.id === id)!;
      expect(right.duration.value).toBe(left.duration.value);
      expect(right.duration.assumption).toBe(left.duration.assumption);
      expect(right.timeout.value).toBe(left.timeout.value);
      expect(right.timeout.assumption).toBe(left.timeout.assumption);
      expect(right.duration.unit).toBe(left.duration.unit);
      expect(right.duration.source?.note).toBe(BULK_SOURCE_NOTE);
      expect(left.duration.source?.note).toBeUndefined();
    }
    expect(bulk.project.revision).toBe(project.revision + 1);
    expect(single.revision).toBe(project.revision + ids.length * 2);
  });

  it('uses the same number rejects as the time field, and 더하기 may be negative', () => {
    for (const raw of ['abc', '-2', '1.5', '0', '.5', '1.2.3']) {
      expect(bulkOperandError(raw, 'set')).toBe(quantityDraftError(raw, 's'));
    }
    expect(bulkOperandError('', 'set')).toBe('숫자를 입력하세요');
    expect(bulkOperandError('-1', 'add')).toBeNull();
    expect(bulkOperandError('0.5', 'scale')).toBeNull();
  });
});
