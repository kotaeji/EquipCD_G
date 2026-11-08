import type { Condition, MaterialEffect, Project } from '../model/types';

export function sigName(p: Project, id: string | null | undefined) { if (!id) return '(없음)'; return p.signals.find((s) => s.id === id)?.name ?? `⚠없음:${id}`; }
export function unitName(p: Project, id: string | null | undefined) { if (!id) return '(없음)'; if (id === 'EXIT') return '배출(장비 밖)'; return p.units.find((u) => u.id === id)?.name ?? `⚠없음:${id}`; }
export function devName(p: Project, id: string | null | undefined) { if (!id) return '(없음)'; return p.devices.find((d) => d.id === id)?.name ?? `⚠없음:${id}`; }
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
