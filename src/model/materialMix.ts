// Several material definitions and one shared feed (TURN-080).
// One definition, or a file with no feedPattern, keeps the old single-kind feed.
import type { Material, Project } from './types';
import { feedCountOf } from './types';

/** Station runs accept this many definitions. A fifth add is refused. */
export const MAX_MATERIAL_DEFS = 4;

const FALLBACK = ['A', 'B', 'C', 'D'] as const;

/** Letter on the drawing. A stored mark wins. Otherwise A, B, C, D by definition order. */
export function materialMark(p: Pick<Project, 'materials'>, id: string): string {
  const index = p.materials.findIndex((m) => m.id === id);
  const stored = index >= 0 ? p.materials[index].mark?.trim() : '';
  if (stored) return stored;
  if (index >= 0 && index < FALLBACK.length) return FALLBACK[index];
  return index >= 0 ? String(index + 1) : id;
}

export function mixActive(p: Pick<Project, 'materials'>): boolean {
  return p.materials.length > 1;
}

/** One cycle of definition ids. One definition yields an empty cycle (every piece is the first). */
export function feedCycle(p: Project): string[] {
  if (p.materials.length < 2) return [];
  const known = new Set(p.materials.map((m) => m.id));
  const stored = (p.feedPattern ?? []).filter((id) => known.has(id));
  if (stored.length > 0) return stored;
  return p.materials.map((m) => m.id);
}

/** Definition for piece `index` (0-based). One definition always returns the first. */
export function feedMaterialAt(p: Project, index: number): Material | undefined {
  const first = p.materials[0];
  if (!first) return undefined;
  if (p.materials.length < 2) return first;
  const cycle = feedCycle(p);
  const id = cycle[index % cycle.length];
  return p.materials.find((m) => m.id === id) ?? first;
}

/** Definition id of each piece, length = feed count. */
export function feedMaterialIds(p: Project, count = feedCountOf(p.materials[0])): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const m = feedMaterialAt(p, i);
    if (m) ids.push(m.id);
  }
  return ids;
}

/** Marks of the pieces that will be fed, in order. */
export function feedMarks(p: Project, count = feedCountOf(p.materials[0])): string[] {
  return feedMaterialIds(p, count).map((id) => materialMark(p, id));
}

/** 「A, A, B」. Empty when there is only one definition. */
export function patternText(p: Project): string {
  return feedCycle(p).map((id) => materialMark(p, id)).join(', ');
}

export function parsePatternText(p: Project, text: string): { ok: true; ids: string[] } | { ok: false; reason: string } {
  const tokens = text.split(/[,，\s]+/).map((token) => token.trim()).filter(Boolean);
  if (tokens.length === 0) return { ok: false, reason: '투입 순서가 비어 있습니다' };
  const ids: string[] = [];
  for (const token of tokens) {
    const hit = p.materials.find((m) => materialMark(p, m.id) === token)
      ?? p.materials.find((m) => m.name === token)
      ?? p.materials.find((m) => m.id === token);
    if (!hit) return { ok: false, reason: `없는 종류 ${token}` };
    ids.push(hit.id);
  }
  return { ok: true, ids };
}

/** One cycle built as each definition repeated `counts[id]` times, in definition order. */
export function patternFromCounts(p: Project, counts: Readonly<Record<string, number>>): string[] {
  const ids: string[] = [];
  for (const m of p.materials) {
    const n = counts[m.id] ?? 0;
    for (let i = 0; i < n; i++) ids.push(m.id);
  }
  return ids;
}

/** How many times each definition appears in one cycle. */
export function countsOfCycle(p: Project): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const m of p.materials) counts[m.id] = 0;
  for (const id of feedCycle(p)) counts[id] = (counts[id] ?? 0) + 1;
  return counts;
}

/** Next free fallback letter for a definition that does not have a mark yet. */
export function nextMark(p: Project, exceptId?: string): string {
  const used = new Set(p.materials.filter((m) => m.id !== exceptId).map((m) => materialMark(p, m.id)));
  for (const letter of [...FALLBACK, 'E', 'F']) {
    if (!used.has(letter)) return letter;
  }
  return 'Z';
}

/** Lane and log prefix. One definition stays 「개체 N」 so older logs stay the same. */
export function pieceHead(p: Project, index: number, materialId: string): string {
  if (!mixActive(p)) return `개체 ${index}`;
  return `개체 ${index} · ${materialMark(p, materialId)}`;
}

export interface KindTally {
  materialId: string;
  mark: string;
  name: string;
  produced: number;
  /** Mean of exit − feed for pieces that left the line. Null when none have. */
  avgPassMs: number | null;
}

export function kindTallies(
  p: Project,
  pieces: readonly { material: { materialId: string }; fedAtMs: number | null; exitedAtMs: number | null }[],
): KindTally[] {
  if (!mixActive(p)) return [];
  return p.materials.map((m) => {
    const done = pieces.filter((pc) => pc.material.materialId === m.id && pc.fedAtMs != null && pc.exitedAtMs != null);
    const avg = done.length === 0
      ? null
      : Math.round(done.reduce((sum, pc) => sum + ((pc.exitedAtMs ?? 0) - (pc.fedAtMs ?? 0)), 0) / done.length);
    return {
      materialId: m.id,
      mark: materialMark(p, m.id),
      name: m.name,
      produced: done.length,
      avgPassMs: avg,
    };
  });
}
