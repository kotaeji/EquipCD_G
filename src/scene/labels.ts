// Screen-space name tags. Sizes are in pixels, so they stay readable as the camera moves.
// Overlap keeps unit names, then markers, then the material, then device names.

export type LabelKind = 'unit' | 'device' | 'marker' | 'material';

export interface ScreenLabel {
  id: string;
  kind: LabelKind;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

function hits(a: ScreenLabel, b: ScreenLabel): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

const RANK: Record<LabelKind, number> = { unit: 0, marker: 1, material: 2, device: 3 };

/** Keep unit names and markers. A material or device name that covers one of those is dropped. */
export function cullOverlappingLabels(labels: readonly ScreenLabel[]): ScreenLabel[] {
  const ordered = [...labels].sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.id.localeCompare(b.id));
  const kept: ScreenLabel[] = [];
  for (const label of ordered) {
    if ((label.kind === 'device' || label.kind === 'material') && kept.some((other) => hits(label, other))) continue;
    kept.push(label);
  }
  return kept;
}
