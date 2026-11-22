import { findAsset } from '../assets/library';
import type { Condition, MaterialEffect, Project } from '../model/types';

export type FlowBlockKind = 'branch' | 'parallel' | 'loop' | 'retry';

const FLOW_BLOCK_WORD: Record<FlowBlockKind, string> = {
  branch: '분기',
  parallel: '병렬',
  loop: '반복',
  retry: '재시도',
};

/** Shared block heading for the flow table and the SFC. The kind word is not repeated when it is already the name. */
export function flowBlockTitle(kind: FlowBlockKind, name: string): string {
  const word = FLOW_BLOCK_WORD[kind];
  const trimmed = name.trim();
  if (!trimmed || trimmed === word) return word;
  return `${word} ${trimmed}`;
}

export function flowBlockWord(kind: FlowBlockKind): string {
  return FLOW_BLOCK_WORD[kind];
}

const RUN_STATUS_KO: Record<string, string> = {
  idle: '대기',
  running: '실행 중',
  paused: '일시정지',
  completed: '완료',
  error: '오류',
};

/** Station run status on step 6. Step-row words stay in `stepStatusLabel`. */
export function runStatusLabel(status: string | null | undefined): string {
  if (!status) return RUN_STATUS_KO.idle;
  return RUN_STATUS_KO[status] ?? status;
}

/** Status-bar phrase. 「실행 중」 already starts with 실행, so it is not prefixed again. */
export function runStatusBar(status: string | null | undefined): string {
  const word = runStatusLabel(status);
  return word === '실행 중' ? word : `실행 ${word}`;
}

export function sigName(p: Project, id: string | null | undefined) { if (!id) return '(없음)'; return p.signals.find((s) => s.id === id)?.name ?? `⚠없음:${id}`; }
export function unitName(p: Project, id: string | null | undefined) { if (!id) return '(없음)'; if (id === 'EXIT') return '배출(장비 밖)'; return p.units.find((u) => u.id === id)?.name ?? `⚠없음:${id}`; }
export function devName(p: Project, id: string | null | undefined) { if (!id) return '(없음)'; return p.devices.find((d) => d.id === id)?.name ?? `⚠없음:${id}`; }

/** Connection-start notice: device name, signal name, direction — not the internal id. */
export function connectStartLabel(p: Project, id: string): string {
  const s = p.signals.find((x) => x.id === id);
  if (s) {
    const d = p.devices.find((x) => x.id === s.deviceId);
    const kind = d ? findAsset(d.kind)?.name : '';
    const who = [d?.name, kind].filter(Boolean).join(' ');
    const dir = s.direction === 'out' ? '출력' : '입력';
    return `${who} · ${s.portKey || s.name} (${dir})`;
  }
  return p.units.find((u) => u.id === id)?.name ?? id;
}
/** Condition picker text. Signal rows lead with the Device name so identical port names stay distinct. */
export function signalChoiceLabel(p: Project, signalId: string, equals: boolean): string {
  const s = p.signals.find((x) => x.id === signalId);
  if (!s) return '(없음)';
  const dev = devName(p, s.deviceId);
  const bare = s.name.startsWith(`${dev}.`) ? s.name.slice(dev.length + 1) : s.name;
  return `${dev} · ${bare} = ${equals ? '참' : '거짓'}`;
}

export function condLabel(p: Project, c: Condition): string {
  switch (c.kind) {
    case 'signal': return `${sigName(p, c.signalId)} = ${c.equals}`;
    case 'materialAt': return `자재 위치 = ${unitName(p, c.unitId)}`;
    case 'materialState': return `자재 상태 = ${c.state}`;
    case 'materialHeldBy': return `자재 잡음 = ${c.deviceId ? devName(p, c.deviceId) : '없음'}`;
    case 'undefined': return `미정: ${c.note}`;
  }
}
export function effectLabel(p: Project, e: MaterialEffect): string {
  const parts: string[] = [];
  if (e.moveTo) parts.push(`위치→${unitName(p, e.moveTo)}`);
  if (e.setState) parts.push(`상태→${e.setState}`);
  if (e.holder !== undefined) parts.push(e.holder ? `잡음→${devName(p, e.holder)}` : '놓음');
  return parts.join(', ') || '(자재 변화 없음)';
}
