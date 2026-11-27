// Kind color and pattern (TURN-091). Presentation only: the file and the run log stay the same.
// One definition has no look, so a single-kind drawing is unchanged.
import { materialMark, mixActive } from './materialMix';
import type { Project } from './types';

/** Definition order 1–4. Solid, diagonal, dots, horizontal. Color is never the only difference. */
export const MATERIAL_PATTERNS = ['solid', 'hatch', 'dots', 'lines'] as const;
export type MaterialPattern = (typeof MATERIAL_PATTERNS)[number];

/**
 * Fills for `--mat-1` … `--mat-4`.
 * Light and dark each clear the page background at 3:1 and the text color at 4.5:1,
 * so a `--text` letter sits on the fill.
 */
export const MATERIAL_KIND_COLORS = {
  light: {
    'mat-1': '#1690ce',
    'mat-2': '#d26b3f',
    'mat-3': '#1a9c50',
    'mat-4': '#b85bfa',
  },
  dark: {
    'mat-1': '#2775ad',
    'mat-2': '#aa5b26',
    'mat-3': '#237f54',
    'mat-4': '#9e45d2',
  },
} as const;

export type MaterialKindToken = '--mat-1' | '--mat-2' | '--mat-3' | '--mat-4';

export interface MaterialKindLook {
  slot: 1 | 2 | 3 | 4;
  token: MaterialKindToken;
  pattern: MaterialPattern;
  mark: string;
  name: string;
  materialId: string;
}

const TOKENS: MaterialKindToken[] = ['--mat-1', '--mat-2', '--mat-3', '--mat-4'];

/** Null when the project has fewer than two definitions, or the id is unknown. */
export function materialKindLook(p: Pick<Project, 'materials'>, id: string): MaterialKindLook | null {
  if (!mixActive(p)) return null;
  const index = p.materials.findIndex((m) => m.id === id);
  if (index < 0 || index >= TOKENS.length) return null;
  const material = p.materials[index];
  return {
    slot: (index + 1) as 1 | 2 | 3 | 4,
    token: TOKENS[index],
    pattern: MATERIAL_PATTERNS[index],
    mark: materialMark(p, id),
    name: material.name,
    materialId: material.id,
  };
}

export function materialKindLooks(p: Pick<Project, 'materials'>): MaterialKindLook[] {
  if (!mixActive(p)) return [];
  return p.materials.flatMap((m) => {
    const look = materialKindLook(p, m.id);
    return look ? [look] : [];
  });
}
