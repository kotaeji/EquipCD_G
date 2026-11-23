// TURN-038: where a wizard item goes. View navigation only — never a model edit.
import type { RunGapFix } from '../model/gaps';
import { STEPS, type ItemJump } from './wizard';

/** TURN-043. Same flash and focus as a wizard item. Does not edit the model. */
export function runGapJump(fix: RunGapFix): ItemJump {
  switch (fix.to) {
    case 'timeout':
      return { step: 'attributes', selectId: fix.deviceId, rightTab: 'actions', actionId: fix.actionId, field: `timeout:${fix.actionId}` };
    case 'duration':
      return { step: 'attributes', selectId: fix.deviceId, rightTab: 'actions', actionId: fix.actionId, field: `duration:${fix.actionId}` };
    case 'unit':
      return { step: 'canvas', selectId: fix.unitId, field: `unit:${fix.unitId}` };
    case 'interval':
      return { step: 'sequence', sub: 'material', selectId: fix.materialId, field: 'feed-interval' };
    case 'step':
      return { step: 'sequence', sub: 'sequence', field: `step:${fix.stepId}` };
    case 'interlock':
      return { step: 'attributes', rightTab: 'check', field: `interlock:${fix.interlockId}` };
  }
}

export const NO_JUMP = '이동할 화면 없음';

/** Short place name shown on the item row. Null jump is never left blank. */
export function jumpCaption(j: ItemJump | null): string {
  if (!j) return NO_JUMP;
  if (j.save) return '위 「저장」';
  const s = STEPS.find((x) => x.id === j.step)!;
  if (j.step === 'library' && j.sub === 'input') return `${s.no} 입력 후보표`;
  if (j.step === 'sequence' && j.sub === 'material') return `${s.no} 자재·Flow`;
  if (j.step === 'sequence' && j.sub === 'sequence') return `${s.no} Station 시퀀스`;
  if (j.step === 'sequence' && j.sub === 'subseq') return `${s.no} Substation 시퀀스`;
  if (j.step === 'check') return `${s.no} 점검`;
  if (j.step === 'run') return `${s.no} 실행·저장`;
  if (j.step === 'attributes' && j.rightTab === 'actions') return `${s.no} Action`;
  if (j.step === 'attributes' && j.rightTab === 'check') return `${s.no} 정의 체크`;
  return `${s.no} ${s.label}`;
}

/** First visible node with this data-jump. Prefer a node outside a collapsed fold. */
export function jumpTarget(field: string, root: ParentNode = document): HTMLElement | null {
  const nodes = [...root.querySelectorAll<HTMLElement>('[data-jump]')].filter((el) => el.getAttribute('data-jump') === field);
  const open = nodes.filter((el) => {
    const det = el.closest('details');
    return !det || det.open;
  });
  const pool = open.length ? open : nodes;
  const outside = pool.filter((el) => !el.closest('details'));
  return (outside.length ? outside : pool)[0] ?? null;
}

/** Focus the field when it is an input. Buttons and read-only text stay unfocused. */
export function focusJump(el: HTMLElement) {
  const focus = el.matches('input, textarea, select') ? el : el.querySelector('input, textarea, select');
  if (!(focus instanceof HTMLElement) || focus.hasAttribute('disabled')) return;
  try { focus.focus({ preventScroll: true }); } catch { focus.focus(); }
}
