import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSampleProject } from '../src/model/sample';
import { clearLegendViewport, unitNameScreen } from '../src/ui/Canvas';
import {
  LABEL_NEAR_DISTANCE,
  LABEL_UNIT_MIN_PX,
  LABEL_ZOOM_DETAIL,
  LABEL_ZOOM_FAR,
  cullOverlappingLabels,
  deviceCode,
  layoutDiagramLabels,
  sceneLabelInRange,
  unitNameFontPx,
  zoomTier,
  type DiagramLabel,
} from '../src/scene/labels';

const CSS_FILES = ['src/ui/styles.css', 'src/ui/run3d.css', 'src/ui/run-summary.css', 'src/ui/sparse-extra.css'];
const FONT_CSS = [...CSS_FILES, 'src/ui/help-panel.css', 'src/ui/term.css', 'src/ui/lab.css', 'src/ui/bundle-screen.css', 'src/ui/user-templates.css', 'src/ui/xlsx-intake.css', 'src/ui/background-tools.css', 'src/ui/diagram-background.css', 'src/ui/unit-lock.css', 'src/ui/problem.css'];

/** Diagram glyphs that scale with the drawing, plus the 16px close mark locked by TURN-007. */
const FONT_PX_OK = [
  '.rf-code', '.rf-unit-name', '.rf-unit-meta', '.rf-dev-name', '.rf-photo-note',
  '.rf-interlock-word', '.rf-mat-label', '.rf-edge-label', '.rf-port-name', '.scene3d-label',
  '.exitem .x', '.ptab .x', '.proj-add',
];

function rulesOf(css: string): { selector: string; body: string }[] {
  const rules: { selector: string; body: string }[] = [];
  let buf = '';
  const stack: string[] = [];
  for (const ch of css) {
    if (ch === '{') { stack.push(buf); buf = ''; continue; }
    if (ch === '}') {
      const selector = stack.pop() ?? '';
      if (stack.length === 0 || !selector.trim().startsWith('@')) rules.push({ selector, body: buf });
      buf = '';
      continue;
    }
    buf += ch;
  }
  return rules;
}

describe('TURN-054 type scale', () => {
  it('AC1 keeps UI font sizes on four steps plus two headings', () => {
    const root = readFileSync('src/ui/styles.css', 'utf8');
    const tokens = [...root.matchAll(/--fs-[a-z0-9]+\s*:\s*[^;]+/g)].map((m) => m[0].split(':')[0].trim());
    expect(tokens).toEqual(['--fs-xs', '--fs-sm', '--fs-md', '--fs-lg', '--fs-h2', '--fs-h1']);
    const stray: string[] = [];
    for (const file of FONT_CSS) {
      for (const rule of rulesOf(readFileSync(file, 'utf8'))) {
        if (!/font-size:\s*\d+(?:\.\d+)?px/.test(rule.body)) continue;
        if (FONT_PX_OK.some((name) => rule.selector.includes(name))) continue;
        stray.push(`${file} ${rule.selector.trim()} { ${rule.body.trim()} }`);
      }
    }
    expect(stray).toEqual([]);
    const tsx = readdirSync('src/ui').filter((name) => name.endsWith('.tsx'));
    const inline: string[] = [];
    for (const name of tsx) {
      const text = readFileSync(`src/ui/${name}`, 'utf8');
      if (/fontSize:\s*\d+/.test(text)) inline.push(`${name} fontSize number`);
      const svg = [...text.matchAll(/fontSize=\{(\d+)\}/g)].map((m) => m[1]);
      if (svg.some((n) => n !== '8' || (name !== 'Canvas.tsx' && name !== 'Symbols.tsx'))) {
        inline.push(`${name} svg ${svg.join(',')}`);
      }
    }
    expect(inline).toEqual([]);
  });

  it('AC2 keeps padding, margin, and gap on the 4px steps', () => {
    const allow = new Set(['40px', '44px', '10px']);
    const bad: string[] = [];
    const prop = /(padding|margin|gap|row-gap|column-gap|padding-(?:top|right|bottom|left)|margin-(?:top|right|bottom|left))\s*:\s*([^;}{]+)/g;
    for (const file of CSS_FILES) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(prop)) {
        for (const px of match[2].matchAll(/-?\d+(?:\.\d+)?px/g)) {
          const n = Number(px[0].replace('px', ''));
          if (n < 0 && n >= -1) continue;
          if (n >= 0 && n <= 3) continue;
          if (allow.has(px[0]) && (match[1] === 'padding-right' || match[1] === 'gap')) continue;
          bad.push(`${file} ${match[1]}: ${match[2].trim()}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('AC3 gives panel heads one height, one type step, and one side inset', () => {
    const css = readFileSync('src/ui/styles.css', 'utf8');
    const block = css.slice(css.indexOf('/* TURN-054: one panel head'));
    for (const selector of ['.exhead', '.fold-panel > summary', '.run-details-head', '.section > h4', '.run3d-head']) {
      expect(block).toContain(selector);
    }
    expect(block).toContain('height: 32px');
    expect(block).toContain('font-size: var(--fs-sm)');
    expect(block).toContain('padding-left: var(--sp-2)');
    expect(block).toContain('padding-right: var(--sp-2)');
    const run = readFileSync('src/ui/run3d.css', 'utf8');
    expect(run).toContain('font-size: var(--fs-sm)');
    expect(run).toContain('.run-steps h2');
    expect(run).toContain('.run-conditions h2');
  });
});

function box(partial: Partial<DiagramLabel> & Pick<DiagramLabel, 'id' | 'kind' | 'fullText'>): DiagramLabel {
  return { selected: false, alert: false, x: 0, y: 0, w: 80, h: 16, ...partial };
}

describe('TURN-054 diagram labels', () => {
  it('AC7 shows unit names, then device codes, then names, status, and ports', () => {
    const labels = [
      box({ id: 'u', kind: 'unit', fullText: '투입' }),
      box({ id: 'd', kind: 'device', fullText: 'CYL-01 보조', x: 200 }),
      box({ id: 'p', kind: 'port', fullText: '전진', x: 400 }),
      box({ id: 's', kind: 'status', fullText: '진행 중', x: 600 }),
    ];
    const ids = (zoom: number) => layoutDiagramLabels(zoom, labels).filter((label) => !label.hidden).map((label) => label.id);
    expect(zoomTier(LABEL_ZOOM_FAR - 0.01)).toBe('far');
    expect(ids(0.5)).toEqual(['u']);
    expect(zoomTier(LABEL_ZOOM_FAR)).toBe('mid');
    expect(zoomTier(LABEL_ZOOM_DETAIL - 0.01)).toBe('mid');
    const mid = layoutDiagramLabels(1, labels).filter((label) => !label.hidden);
    expect(mid.map((label) => label.id)).toEqual(['u', 'd']);
    expect(mid.find((label) => label.id === 'd')!.text).toBe('CYL-01');
    expect(zoomTier(LABEL_ZOOM_DETAIL)).toBe('near');
    const near = layoutDiagramLabels(1.2, labels).filter((label) => !label.hidden);
    expect(near.map((label) => label.id).sort()).toEqual(['d', 'p', 's', 'u']);
    expect(near.find((label) => label.id === 'd')!.text).toBe('CYL-01 보조');
  });

  it('AC8 keeps the unit name at least 11px on screen', () => {
    expect(unitNameFontPx(1) * 1).toBeGreaterThanOrEqual(LABEL_UNIT_MIN_PX);
    expect(unitNameFontPx(0.5) * 0.5).toBeGreaterThanOrEqual(LABEL_UNIT_MIN_PX);
    expect(unitNameFontPx(0.25) * 0.25).toBeCloseTo(LABEL_UNIT_MIN_PX);
    expect(unitNameFontPx(2)).toBe(12);
  });

  it('AC9 hides the lower label, keeps the selection, and leaves a tooltip', () => {
    const labels = [
      box({ id: 'u', kind: 'unit', fullText: '투입', x: 0 }),
      box({ id: 'd', kind: 'device', fullText: 'PSH-01', x: 10 }),
      box({ id: 'sel', kind: 'device', fullText: 'CYL-01', x: 10, y: 40, selected: true }),
      box({ id: 'port', kind: 'port', fullText: '상승', x: 8, y: 40 }),
    ];
    const placed = layoutDiagramLabels(1.2, labels);
    expect(placed.find((label) => label.id === 'd')!.hidden).toBe(true);
    expect(placed.find((label) => label.id === 'd')!.title).toBe('PSH-01');
    expect(placed.find((label) => label.id === 'sel')!.hidden).toBe(false);
    expect(placed.find((label) => label.id === 'u')!.hidden).toBe(false);
    const far = layoutDiagramLabels(0.4, [
      box({ id: 'u', kind: 'unit', fullText: '투입' }),
      box({ id: 'd', kind: 'device', fullText: 'CYL-01', x: 300 }),
      box({ id: 'sel', kind: 'device', fullText: 'PSH-01', x: 500, selected: true }),
    ]);
    expect(far.find((label) => label.id === 'd')!.hidden).toBe(true);
    expect(far.find((label) => label.id === 'd')!.title).toBe('CYL-01');
    expect(far.find((label) => label.id === 'sel')!.hidden).toBe(false);
    expect(far.find((label) => label.id === 'sel')!.text).toBe('PSH-01');
    expect(deviceCode('이름만')).toBe('이름만');
  });

  it('AC10 uses distance for 3D names and keeps fault and pause at any distance', () => {
    const far = LABEL_NEAR_DISTANCE + 1;
    const near = LABEL_NEAR_DISTANCE;
    expect(sceneLabelInRange({ showNames: true, kind: 'unit', alert: false, distance: far, selected: false })).toBe(true);
    expect(sceneLabelInRange({ showNames: true, kind: 'device', alert: false, distance: far, selected: false })).toBe(false);
    expect(sceneLabelInRange({ showNames: true, kind: 'device', alert: false, distance: near, selected: false })).toBe(true);
    expect(sceneLabelInRange({ showNames: true, kind: 'marker', alert: false, distance: far, selected: false })).toBe(false);
    expect(sceneLabelInRange({ showNames: true, kind: 'marker', alert: false, distance: near, selected: false })).toBe(true);
    expect(sceneLabelInRange({ showNames: true, kind: 'marker', alert: true, distance: far, selected: false })).toBe(true);
    expect(sceneLabelInRange({ showNames: true, kind: 'device', alert: false, distance: far, selected: true })).toBe(true);
  });

  it('AC11 drops names when the switch is off and leaves markers', () => {
    const labels = [
      box({ id: 'u', kind: 'unit', fullText: '투입' }),
      box({ id: 'd', kind: 'device', fullText: 'CYL-01', x: 200 }),
      box({ id: 's', kind: 'status', fullText: '진행 중', x: 400 }),
    ];
    const off = layoutDiagramLabels(1.5, labels, false);
    expect(off.find((label) => label.id === 'u')!.hidden).toBe(true);
    expect(off.find((label) => label.id === 'd')!.hidden).toBe(true);
    expect(off.find((label) => label.id === 's')!.hidden).toBe(false);
    expect(sceneLabelInRange({ showNames: false, kind: 'device', alert: false, distance: 10, selected: true })).toBe(false);
    expect(sceneLabelInRange({ showNames: false, kind: 'unit', alert: false, distance: 10, selected: false })).toBe(false);
    expect(sceneLabelInRange({ showNames: false, kind: 'marker', alert: false, distance: 10, selected: false })).toBe(true);
    expect(sceneLabelInRange({ showNames: false, kind: 'material', alert: false, distance: 10, selected: false })).toBe(true);
    const kept = cullOverlappingLabels([
      { id: 'u', kind: 'unit', x: 0, y: 0, w: 80, h: 18, text: 'S1 투입' },
      { id: 'd', kind: 'device', x: 10, y: 2, w: 60, h: 16, text: 'PSH-01' },
      { id: 'far', kind: 'device', x: 200, y: 0, w: 60, h: 16, text: 'CNV-05' },
    ]);
    expect(kept.map((label) => label.id).sort()).toEqual(['far', 'u']);
  });
});

describe('TURN-054 legend clearance', () => {
  it('the first fit keeps every unit name clear of the legend', () => {
    const units = buildSampleProject().units.map((u) => ({ x: u.layout.x, y: u.layout.y, w: u.layout.w }));
    const legend = { x: 15, y: 15, w: 435, h: 28 };
    const zoom = 0.5;
    const vp = { x: 52 - units[0].x * zoom, y: 20 - units[0].y * zoom, zoom };
    const hits = (view: typeof vp) => units.filter((unit) => {
      const head = unitNameScreen(unit, view);
      return head.x < legend.x + legend.w && head.x + head.w > legend.x
        && head.y < legend.y + legend.h && head.y + head.h > legend.y;
    });
    expect(hits(vp).length).toBeGreaterThan(0);
    const next = clearLegendViewport(vp, units, legend);
    expect(hits(next)).toEqual([]);
    expect(next.x).toBe(vp.x);
    expect(next.zoom).toBe(zoom);
    expect(clearLegendViewport(vp, units, { x: 0, y: 0, w: 0, h: 0 })).toEqual(vp);
  });
});
