// Screen-space name tags. Sizes are in pixels, so they stay readable as the camera moves.
// When a device name overlaps a unit name, the device name is the one that goes.

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

/** Drop device names that cover a label we keep. Unit names, markers, and the material stay. */
export function cullOverlappingLabels(labels: readonly ScreenLabel[]): ScreenLabel[] {
  const ordered = [...labels].sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.id.localeCompare(b.id));
  const kept: ScreenLabel[] = [];
  for (const label of ordered) {
    if (label.kind === 'device' && kept.some((other) => hits(label, other))) continue;
    kept.push(label);
  }
  return kept;
}
