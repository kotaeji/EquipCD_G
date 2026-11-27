import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addMaterial, setFeedCount, setFeedPattern, setMaterialMark, setQuantity } from '../src/model/commands';
import { MATERIAL_KIND_COLORS, MATERIAL_PATTERNS, materialKindLook, materialKindLooks } from '../src/model/materialKind';
import { materialMark } from '../src/model/materialMix';
import { buildFlowSampleProject, buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import type { Project } from '../src/model/types';
import { createRuntime, runToEnd } from '../src/runtime/engine';
import { describeScene } from '../src/scene/describe';
import { renderRunReportHtml } from '../src/ui/runReport';
import { serializeProject } from '../src/storage/fileFormat';

const SAMPLE_SHA = {
  sample: '868d9c3dc4f0ebec055d9b1a51e139eb4d9998261238f0157fb7f26df8dc516a',
  flow: 'a645351dc026ae366d8f57ce6996b37c1bab0c2c6476027a8f9052b6620a1f61',
  parallel: '1d48b067aa024bdc0bc2e5a4a28ebf0596a7f0df47150760a922f922b253dd52',
} as const;

function fed(p: Project, count: number, interval: number): Project {
  const id = p.materials[0].id;
  const counted = setFeedCount(p, id, count);
  if (!counted.ok) throw new Error(counted.reason);
  const timed = setQuantity(counted.project, { kind: 'material', id, field: 'feedInterval' }, interval, true);
  if (!timed.ok) throw new Error(timed.reason);
  return timed.project;
}

function mixed(pattern: 'pair' | 'cycle'): Project {
  const count = pattern === 'pair' ? 2 : 6;
  const added = addMaterial(fed(buildSampleProject(), count, 0), () => 'MAT-B');
  if (!added.ok) throw new Error(added.reason);
  const first = added.project.materials[0].id;
  const ids = pattern === 'pair' ? [first, 'MAT-B'] : [first, first, 'MAT-B'];
  const ordered = setFeedPattern(added.project, ids);
  if (!ordered.ok) throw new Error(ordered.reason);
  const start = ordered.project.units.find((u) => u.id === ordered.project.materials[0].initialLocation);
  if (start) start.capacity.maxMaterials = { ...start.capacity.maxMaterials, value: 2 };
  return ordered.project;
}

describe('TURN-091 material kind color and pattern', () => {
  it('AC3 the four patterns differ and follow definition order', () => {
    expect(new Set(MATERIAL_PATTERNS).size).toBe(4);
    expect([...MATERIAL_PATTERNS]).toEqual(['solid', 'hatch', 'dots', 'lines']);
    const css = readFileSync('src/ui/material-kind.css', 'utf8');
    expect(css).toContain('[data-mat-pattern="solid"]');
    expect(css).toContain('[data-mat-pattern="hatch"]');
    expect(css).toContain('[data-mat-pattern="dots"]');
    expect(css).toContain('[data-mat-pattern="lines"]');
    expect(css).not.toMatch(/\[data-mat-pattern="solid"\][^{]*\{[^}]*repeating-linear-gradient/);
    const hatch = css.match(/\[data-mat-pattern="hatch"\] \{[^}]*\}/)?.[0] ?? '';
    const dots = css.match(/\[data-mat-pattern="dots"\] \{[^}]*\}/)?.[0] ?? '';
    const lines = css.match(/\[data-mat-pattern="lines"\] \{[^}]*\}/)?.[0] ?? '';
    expect(hatch).toContain('repeating-linear-gradient(-45deg');
    expect(dots).toContain('radial-gradient');
    expect(lines).toContain('repeating-linear-gradient(to bottom');
    expect(new Set([hatch, dots, lines]).size).toBe(3);
  });

  it('AC2 light and dark fills are the theme tokens', () => {
    expect(MATERIAL_KIND_COLORS.light['mat-1']).toBe('#1690ce');
    expect(MATERIAL_KIND_COLORS.dark['mat-1']).toBe('#2775ad');
    expect(Object.keys(MATERIAL_KIND_COLORS.light)).toEqual(['mat-1', 'mat-2', 'mat-3', 'mat-4']);
  });

  it('AC1 AC7 a mixed scene carries the kind token, and one definition does not', () => {
    const p = mixed('pair');
    const scene = describeScene(p, createRuntime(p).state);
    const marked = scene.materials.filter((m) => m.mark);
    expect(marked.length).toBeGreaterThan(0);
    for (const mat of marked) {
      const look = materialKindLook(p, p.materials.find((m) => materialMark(p, m.id) === mat.mark)!.id);
      expect(mat.kindColor).toBe(look?.token);
    }
    expect(marked.some((m) => m.kindColor === '--mat-1' && m.mark === 'A')).toBe(true);
    expect(marked.some((m) => m.kindColor === '--mat-2' && m.mark === 'B')).toBe(true);
    const plain = describeScene(buildSampleProject(), runToEnd(createRuntime(buildSampleProject())).state);
    expect(plain.materials.every((m) => m.kindColor == null && m.mark == null)).toBe(true);
    expect(materialKindLooks(buildSampleProject())).toEqual([]);
  });

  it('AC5 an empty mark stays empty in the file and the fallback letter remains', () => {
    const added = addMaterial(buildSampleProject(), () => 'MAT-B');
    if (!added.ok) throw new Error(added.reason);
    const cleared = setMaterialMark(added.project, 'MAT-B', '');
    if (!cleared.ok) throw new Error(cleared.reason);
    expect(cleared.project.materials[1].mark).toBeUndefined();
    expect(materialMark(cleared.project, 'MAT-B')).toBe('B');
    expect(serializeProject(cleared.project)).not.toContain('"mark"');
    expect(materialKindLook(cleared.project, 'MAT-B')?.token).toBe('--mat-2');
    expect(materialKindLook(cleared.project, 'MAT-B')?.pattern).toBe('hatch');
  });

  it('AC6 one definition keeps the sample bytes and the log has no kind word', () => {
    const builds = [
      ['sample', buildSampleProject, 11100],
      ['flow', buildFlowSampleProject, 13100],
      ['parallel', buildParallelSampleProject, 2500],
    ] as const;
    for (const [name, build, timeMs] of builds) {
      const p = build();
      expect(p.materials).toHaveLength(1);
      expect(materialKindLooks(p)).toEqual([]);
      const bytes = serializeProject(p);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(SAMPLE_SHA[name]);
      const rt = runToEnd(createRuntime(p));
      expect(rt.state.timeMs).toBe(timeMs);
      expect(rt.state.log.some((line) => line.message.includes('종류'))).toBe(false);
      const html = renderRunReportHtml(p, rt.state, new Date('2026-11-27T00:00:00Z'));
      expect(html).not.toContain('data-kind-legend');
      expect(html).not.toMatch(/url\s*\(/i);
    }
  });

  it('the report paints the same token and letter, and black-and-white patterns stay in the file', () => {
    const p = mixed('cycle');
    const rt = runToEnd(createRuntime(p));
    const html = renderRunReportHtml(p, rt.state, new Date('2026-11-27T00:00:00Z'));
    expect(html).toContain('data-mat-token="--mat-1"');
    expect(html).toContain('data-mat-token="--mat-2"');
    expect(html).toContain('data-mat-pattern="solid"');
    expect(html).toContain('data-mat-pattern="hatch"');
    expect(html).toContain('>A ');
    expect(html).toContain('>B ');
    expect(html).not.toMatch(/url\s*\(/i);
    expect(html).toContain('repeating-linear-gradient(-45deg');
  });
});
