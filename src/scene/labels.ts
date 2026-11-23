// Screen-space name tags. Sizes are in pixels, so they stay readable as the camera moves.
// Unit names are floor strips, not screen tags. Overlap keeps markers, then the material, then device names.

import type { SceneDescription } from './describe';
import { markerText, waitingLead } from '../ui/status';

export type LabelKind = 'unit' | 'device' | 'marker' | 'material' | 'port' | 'status';

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
        text: solid.highlight === 'fault'
          ? `${markerText('fault')}${solid.interlock ? ' · Interlock' : ''}`
          : solid.highlight === 'paused'
            ? markerText('paused')
            : markerText('active'),
        x: solid.draw.x + solid.draw.w / 2, y: top + 18, z: solid.draw.z + solid.draw.d / 2,
      });
    }
  }
  for (const mat of scene.materials) {
    out.push({
      id: `mat:${mat.id}`, kind: 'material', px: 12,
      text: `${mat.waiting ? `${waitingLead()} · ` : ''}${mat.name} · ${mat.state || '상태 없음'}`,
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
  /** Words for the hover tip. Defaults to `text`. */
  fullText?: string;
  selected?: boolean;
  /** Fault or pause. Outranks a unit name when the two overlap. */
  alert?: boolean;
}

export interface PlacedLabel extends ScreenLabel {
  hidden: boolean;
  title: string;
}

function hits(a: ScreenLabel, b: ScreenLabel): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Selected, then fault/pause, then unit, then device, then a port. */
function priority(label: ScreenLabel): number {
  if (label.selected) return 0;
  if (label.alert || label.kind === 'marker' || label.kind === 'status') return 1;
  if (label.kind === 'unit') return 2;
  if (label.kind === 'material') return 3;
  if (label.kind === 'device') return 4;
  return 5;
}

function shortened(label: ScreenLabel, kept: readonly ScreenLabel[]): ScreenLabel | null {
  const full = label.fullText ?? label.text;
  if (full.length < 2) return null;
  const per = label.w / Math.max(full.length, 1);
  for (let n = full.length - 1; n >= 1; n -= 1) {
    const text = `${full.slice(0, n)}…`;
    const next: ScreenLabel = { ...label, text, fullText: full, w: Math.max(8, text.length * per) };
    if (!kept.some((other) => hits(next, other))) return next;
  }
  return null;
}

/**
 * Higher priority stays. A lower label is shortened with … when that clears the overlap,
 * otherwise it is hidden and keeps its full words for a tooltip.
 */
export function placeLabels(labels: readonly ScreenLabel[]): PlacedLabel[] {
  const ordered = [...labels].sort((a, b) => priority(a) - priority(b) || a.id.localeCompare(b.id));
  const kept: ScreenLabel[] = [];
  const placed: PlacedLabel[] = [];
  for (const label of ordered) {
    const full = label.fullText ?? label.text;
    if (label.selected || !kept.some((other) => hits(label, other))) {
      kept.push(label);
      placed.push({ ...label, fullText: full, hidden: false, title: full });
      continue;
    }
    const fit = shortened(label, kept);
    if (fit) {
      kept.push(fit);
      placed.push({ ...fit, hidden: false, title: full });
      continue;
    }
    placed.push({ ...label, fullText: full, hidden: true, title: full });
  }
  return placed;
}

/** Labels that stay on screen. Hidden ones are dropped; their titles live on `placeLabels`. */
export function cullOverlappingLabels(labels: readonly ScreenLabel[]): ScreenLabel[] {
  return placeLabels(labels).filter((label) => !label.hidden);
}

/** 2D drawing. Below 70% only unit names, from 70% device codes, from 120% full names, status, and ports. */
export const LABEL_ZOOM_FAR = 0.7;
export const LABEL_ZOOM_DETAIL = 1.2;
export const LABEL_UNIT_MIN_PX = 11;

/** 3D. A device at or inside this world-unit distance shows its name. Fault and pause ignore it. */
export const LABEL_NEAR_DISTANCE = 480;

export type ZoomTier = 'far' | 'mid' | 'near';

export function zoomTier(zoom: number): ZoomTier {
  if (!(zoom >= LABEL_ZOOM_FAR)) return 'far';
  if (zoom < LABEL_ZOOM_DETAIL) return 'mid';
  return 'near';
}

/** Flow-space font size so the unit name is at least 11px on screen. */
export function unitNameFontPx(zoom: number, base = 12): number {
  const z = zoom > 0 && Number.isFinite(zoom) ? zoom : 1;
  return Math.max(base, LABEL_UNIT_MIN_PX / z);
}

/** Leading code such as CYL-01. A name without that shape keeps its first word. */
export function deviceCode(name: string): string {
  const matched = name.match(/[A-Za-z]{2,}-\d+/);
  if (matched) return matched[0];
  const token = name.trim().split(/\s+/)[0];
  return token || name;
}

export interface DiagramLabel {
  id: string;
  kind: 'unit' | 'device' | 'port' | 'status';
  fullText: string;
  selected: boolean;
  alert: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * What the 2D drawing shows at this zoom.
 * `showNames` false skips the zoom rules and hides unit, device, and port names.
 */
export function layoutDiagramLabels(zoom: number, labels: readonly DiagramLabel[], showNames = true): PlacedLabel[] {
  const tier = zoomTier(zoom);
  const screen: ScreenLabel[] = [];
  const held: PlacedLabel[] = [];
  const hold = (label: DiagramLabel) => {
    held.push({
      id: label.id, kind: label.kind, x: label.x, y: label.y, w: label.w, h: label.h,
      text: label.fullText, fullText: label.fullText, selected: label.selected, alert: label.alert,
      hidden: true, title: label.fullText,
    });
  };
  for (const label of labels) {
    const named = label.kind === 'unit' || label.kind === 'device' || label.kind === 'port';
    if (!showNames) {
      if (named) hold(label);
      else screen.push({ ...label, text: label.fullText, fullText: label.fullText, kind: 'status' });
      continue;
    }
    if (label.kind === 'port' || label.kind === 'status') {
      if (tier === 'near') screen.push({ ...label, text: label.fullText, fullText: label.fullText });
      else hold(label);
      continue;
    }
    if (label.kind === 'device' && tier === 'far' && !label.selected) {
      hold(label);
      continue;
    }
    const text = label.kind === 'device' && tier === 'mid' && !label.selected ? deviceCode(label.fullText) : label.fullText;
    const per = label.w / Math.max(label.fullText.length, 1);
    screen.push({
      ...label, text, fullText: label.fullText,
      w: label.kind === 'device' ? Math.max(8, text.length * per) : label.w,
    });
  }
  return [...placeLabels(screen), ...held];
}

/**
 * 3D tag at this camera distance.
 * Names off keeps today's markers and the material, and drops device and unit tags.
 * Names on: far shows the unit, near adds the device and a running status. Fault and pause stay either way.
 */
export function sceneLabelInRange(label: {
  showNames: boolean;
  kind: 'unit' | 'device' | 'marker' | 'material';
  alert: boolean;
  distance: number;
  selected: boolean;
}): boolean {
  if (!label.showNames) return label.kind === 'marker' || label.kind === 'material';
  if (label.kind === 'unit' || label.kind === 'material') return true;
  if (label.alert || label.selected) return true;
  return label.distance <= LABEL_NEAR_DISTANCE;
}
