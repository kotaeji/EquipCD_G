// Screen-space name tags. Sizes are in pixels, so they stay readable as the camera moves.
// Unit names are floor strips, not screen tags. Overlap keeps markers, then the material, then device names.

import type { SceneDescription } from './describe';

export type LabelKind = 'unit' | 'device' | 'marker' | 'material';

export interface AnchorLabel {
  id: string;
  kind: 'device' | 'marker' | 'material';
  text: string;
  x: number;
  y: number;
  z: number;
  px: number;
}

function topOf(parts: { y: number; h: number }[]): number {
  return parts.reduce((h, part) => Math.max(h, part.y + part.h / 2), 12);
}

/**
 * Tags that face the screen. Unit names are not here — they lie on the floor.
 * Turning names off drops device tags and leaves markers and the material.
 */
export function anchorLabels(scene: SceneDescription, showNames: boolean, emphasize: boolean): AnchorLabel[] {
  const out: AnchorLabel[] = [];
  if (showNames) {
    for (const solid of scene.solids) {
      const top = topOf(solid.parts);
      out.push({
        id: `d:${solid.id}`, kind: 'device', text: solid.name, px: 12,
        x: solid.draw.x + solid.draw.w / 2, y: top + 6, z: solid.draw.z + solid.draw.d / 2,
      });
    }
  }
  if (emphasize) {
    for (const solid of scene.solids) {
      if (solid.highlight === 'none') continue;
      const top = topOf(solid.parts);
      out.push({
        id: `m:${solid.id}`, kind: 'marker', px: 13,
        text: solid.highlight === 'fault' ? '오류' : '▼ 동작 중',
        x: solid.draw.x + solid.draw.w / 2, y: top + 18, z: solid.draw.z + solid.draw.d / 2,
      });
    }
  }
  for (const mat of scene.materials) {
    out.push({
      id: `mat:${mat.id}`, kind: 'material', px: 12,
      text: `${mat.name} · ${mat.state || '상태 없음'}`,
      x: mat.x, y: 20, z: mat.z,
    });
  }
  return out;
}

/** Floor strips follow the same switch as device names. */
export function visibleFloorNames<T>(names: readonly T[], showNames: boolean): T[] {
  return showNames ? [...names] : [];
}

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

/** A material or device name that covers a marker (or a stray unit tag) is dropped. */
export function cullOverlappingLabels(labels: readonly ScreenLabel[]): ScreenLabel[] {
  const ordered = [...labels].sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.id.localeCompare(b.id));
  const kept: ScreenLabel[] = [];
  for (const label of ordered) {
    if ((label.kind === 'device' || label.kind === 'material') && kept.some((other) => hits(label, other))) continue;
    kept.push(label);
  }
  return kept;
}
