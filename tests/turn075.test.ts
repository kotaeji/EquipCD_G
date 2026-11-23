import { describe, expect, it } from 'vitest';
import { ASSET_LIBRARY } from '../src/assets/library';
import { captureUnitTemplate } from '../src/model/userTemplates';
import { buildFlowSampleProject, buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import {
  buildStarter,
  formatVirtualTime,
  sampleCards,
  sampleStepCount,
  sampleVirtualMs,
  starterPreview,
  type StarterSpec,
} from '../src/model/starter';
import { rectsOverlap } from '../src/model/unitLayout';
import type { Project } from '../src/model/types';
import { validateProject } from '../src/model/validate';
import { createRuntime, runToEnd } from '../src/runtime/engine';

const projects = {
  sample: buildSampleProject(),
  parallel: buildParallelSampleProject(),
  flow: buildFlowSampleProject(),
};

function stepCount(p: Project): number {
  return p.sequence.steps.length + (p.substationSequences ?? []).reduce((n, q) => n + q.steps.length, 0);
}

function overlaps(p: Project): boolean {
  const boxes = p.units.map((u) => u.layout);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (rectsOverlap(boxes[i], boxes[j])) return true;
  return false;
}

const seq = (prefix: string) => {
  let n = 0;
  return (p: string) => `${prefix}-${p}-${++n}`;
};

describe('TURN-075 example numbers', () => {
  it('AC2 card counts and virtual time are the sample model, not typed numbers', () => {
    const cards = sampleCards();
    expect(cards.map((c) => c.kind)).toEqual(['sample', 'parallel', 'flow']);
    for (const card of cards) {
      const p = projects[card.kind];
      expect(card.name).toBe(p.name);
      expect(card.units).toBe(p.units.length);
      expect(card.devices).toBe(p.devices.length);
      expect(card.steps).toBe(stepCount(p));
      expect(card.steps).toBe(sampleStepCount(p));
      expect(card.virtualMs).toBe(runToEnd(createRuntime(p)).state.timeMs);
      expect(card.virtualMs).toBe(sampleVirtualMs(p));
      expect(card.virtualMs).toBeGreaterThan(0);
      expect(formatVirtualTime(card.virtualMs)).toBe(`${(card.virtualMs / 1000).toFixed(1).replace(/\.0$/, '')} s`);
    }
  });
});

describe('TURN-075 skeleton', () => {
  const bundles = ASSET_LIBRARY.filter((d) => d.template).map((d) => d.kind);

  it('AC4 a mixed skeleton matches its preview, does not overlap, and has no diagnostic errors', () => {
    expect(bundles.length).toBeGreaterThan(0);
    const spec: StarterSpec = {
      name: '뼈대 라인',
      linkFlow: true,
      units: [
        { name: '투입', fill: { kind: 'bundle', assetKind: bundles[0] } },
        { name: '빈칸', fill: { kind: 'empty' } },
        { name: '식별', fill: { kind: 'bundle', assetKind: bundles[1] ?? bundles[0] } },
      ],
    };
    const built = buildStarter(spec, seq('a'));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const again = buildStarter(spec, seq('b'));
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(starterPreview(built.project)).toEqual(starterPreview(again.project));
    const p = built.project;
    expect(p.name).toBe('뼈대 라인');
    expect(p.units.map((u) => u.name)).toEqual(['투입', '빈칸', '식별']);
    expect(p.materials).toEqual([]);
    expect(p.sequence.steps).toEqual([]);
    expect(p.sequence.flow).toBeUndefined();
    expect(p.connections.filter((c) => c.kind === 'flow')).toHaveLength(2);
    expect(overlaps(p)).toBe(false);
    expect(validateProject(p).filter((d) => d.severity === 'error')).toEqual([]);
    expect(starterPreview(p)).toEqual({
      units: p.units.length,
      devices: p.devices.length,
      connections: p.connections.length,
    });
  });

  it('AC4 eight empty units stay apart, and turning links off adds no flow', () => {
    const spec: StarterSpec = {
      name: '여덟',
      linkFlow: false,
      units: Array.from({ length: 8 }, (_, i) => ({ name: `S${i + 1}`, fill: { kind: 'empty' as const } })),
    };
    const built = buildStarter(spec, seq('c'));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.project.units).toHaveLength(8);
    expect(built.project.devices).toHaveLength(0);
    expect(built.project.connections).toHaveLength(0);
    expect(overlaps(built.project)).toBe(false);
    expect(validateProject(built.project).filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('AC5 a placed user template gets new ids', () => {
    const captured = captureUnitTemplate(buildSampleProject(), 'U-S1');
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    const template = {
      format: 'aurora-concept-designer/unit-template' as const,
      formatVersion: '0.1.0' as const,
      id: 'tpl-mine',
      name: '내 투입',
      savedAt: '2026-11-24T00:00:00.000Z',
      unit: captured.captured.unit,
      devices: captured.captured.devices,
      signals: captured.captured.signals,
      positions: captured.captured.positions,
      actions: captured.captured.actions,
      connections: captured.captured.connections,
    };
    const oldIds = new Set([
      template.unit.id,
      ...template.devices.map((d) => d.id),
      ...template.signals.map((s) => s.id),
      ...template.actions.map((a) => a.id),
    ]);
    const built = buildStarter({
      name: '템플릿 뼈대',
      linkFlow: true,
      units: [
        { name: '첫째', fill: { kind: 'user', template } },
        { name: '둘째', fill: { kind: 'empty' } },
      ],
    }, seq('d'));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const placed = built.project.units[0];
    expect(placed.name).toBe('첫째');
    expect(oldIds.has(placed.id)).toBe(false);
    expect(placed.lineage?.fromTemplate).toEqual({ id: 'tpl-mine', name: '내 투입' });
    for (const d of built.project.devices) expect(oldIds.has(d.id)).toBe(false);
    expect(built.project.devices.length).toBe(template.devices.length);
    expect(overlaps(built.project)).toBe(false);
    expect(validateProject(built.project).filter((d) => d.severity === 'error')).toEqual([]);
    expect(built.project.sequence.steps).toEqual([]);
    expect(built.project.materials).toEqual([]);
  });
});
