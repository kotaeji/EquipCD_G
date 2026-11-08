// F5 구조화 문장 → SequenceDraft 결정적 변환 (AI 미사용). 자연어 Dictation/의미 추론(3등급)은 미구현.
// 문법(시제품 가정): 한 줄 = 한 단계. 줄 내용이 Action 이름과 정확히 일치(앞뒤 공백·번호 "1." 무시)하거나
// "<Unit코드> <Action이름 일부>" 형태로 유일하게 매칭될 때만 확정. 복수 후보면 선택 필요로 남긴다.
import type { Project } from './types';

export interface ParsedLine { line: string; status: 'matched' | 'ambiguous' | 'notFound'; actionId?: string; candidates: { id: string; name: string }[] }

export function parseStructuredSequence(p: Project, text: string): ParsedLine[] {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);
  return lines.map((line) => {
    const exact = p.actions.filter((a) => a.name.trim() === line);
    if (exact.length === 1) return { line, status: 'matched', actionId: exact[0].id, candidates: [] };
    if (exact.length > 1) return { line, status: 'ambiguous', candidates: exact.map((a) => ({ id: a.id, name: `${a.name} (${a.deviceId})` })) };
    const lower = line.toLowerCase();
    const partial = p.actions.filter((a) => {
      const unit = p.units.find((u) => u.id === a.unitId);
      const hay = `${unit?.code ?? ''} ${unit?.name ?? ''} ${a.name} ${a.deviceId}`.toLowerCase();
      return lower.split(/\s+/).every((tok) => hay.includes(tok));
    });
    if (partial.length === 1) return { line, status: 'matched', actionId: partial[0].id, candidates: [] };
    if (partial.length > 1) return { line, status: 'ambiguous', candidates: partial.map((a) => ({ id: a.id, name: `${a.name} (${a.deviceId})` })) };
    return { line, status: 'notFound', candidates: [] };
  });
}
