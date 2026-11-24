import { describe, expect, it } from 'vitest';
import { addMaterial, removeMaterial, setFeedCount, setFeedCounts, setFeedPattern, setMaterialMark, setQuantity } from '../src/model/commands';
import { findingsOf } from '../src/model/conditionCheck';
import { conditionFormula } from '../src/model/conditionFormula';
import { materialDeleteDetail } from '../src/model/deleteImpact';
import { feedMarks, kindTallies, MAX_MATERIAL_DEFS } from '../src/model/materialMix';
import { buildFlowSampleProject, buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import { RUNTIME_RULES_VERSION, type Condition, type Project } from '../src/model/types';
import { checkRunReadiness } from '../src/model/validate';
import { createRuntime, evalCond, runToEnd } from '../src/runtime/engine';
import { timingChart } from '../src/runtime/timingChart';
import { describeScene } from '../src/scene/describe';
import { anchorLabels } from '../src/scene/labels';
import { parseProjectFile, serializeProject } from '../src/storage/fileFormat';

function fed(p: Project, count: number, interval: number): Project {
  const id = p.materials[0].id;
  const counted = setFeedCount(p, id, count);
  if (!counted.ok) throw new Error(counted.reason);
  const timed = setQuantity(counted.project, { kind: 'material', id, field: 'feedInterval' }, interval, true);
  if (!timed.ok) throw new Error(timed.reason);
  return timed.project;
}

function withKind(p: Project, mark = 'B'): Project {
  const added = addMaterial(p, () => 'MAT-B');
  if (!added.ok) throw new Error(added.reason);
  const marked = setMaterialMark(added.project, 'MAT-B', mark);
  if (!marked.ok) throw new Error(marked.reason);
  return marked.project;
}

describe('TURN-080 several material definitions', () => {
  it('AC2 a pattern A, A, B repeated for 6 pieces is A A B A A B', () => {
    const mixed = withKind(fed(buildSampleProject(), 6, 0));
    const ordered = setFeedPattern(mixed, ['MAT-001', 'MAT-001', 'MAT-B']);
    if (!ordered.ok) throw new Error(ordered.reason);
    expect(feedMarks(ordered.project)).toEqual(['A', 'A', 'B', 'A', 'A', 'B']);
    const rt = runToEnd(createRuntime(ordered.project));
    expect(rt.state.status).toBe('completed');
    expect(rt.state.pieces?.map((pc) => pc.material.materialId)).toEqual([
      'MAT-001', 'MAT-001', 'MAT-B', 'MAT-001', 'MAT-001', 'MAT-B',
    ]);
    const feeds = rt.state.log.filter((l) => l.code === 'FEED').map((l) => l.message);
    expect(feeds.map((line) => /종류 (\S+)/.exec(line)?.[1])).toEqual(['A', 'A', 'B', 'A', 'A', 'B']);
  });

  it('AC2 kind counts build the same cycle and the feed count repeats it', () => {
    const mixed = withKind(fed(buildSampleProject(), 6, 0));
    const counted = setFeedCounts(mixed, { 'MAT-001': 2, 'MAT-B': 1 });
    if (!counted.ok) throw new Error(counted.reason);
    expect(feedMarks(counted.project)).toEqual(['A', 'A', 'B', 'A', 'A', 'B']);
  });

  it('AC3 material type is a formula, a check, and a per-piece condition', () => {
    const p = withKind(buildSampleProject());
    const cond: Condition = { kind: 'materialType', materialId: 'MAT-B' };
    expect(conditionFormula(p, cond)).toBe('자재 종류 = B');
    const broken = findingsOf({
      ...p,
      actions: p.actions.map((a, i) => i === 0 ? { ...a, pre: [{ kind: 'materialType', materialId: 'MAT-GONE' }] } : a),
    });
    expect(broken.some((f) => f.kind === 'broken' && f.formula.includes('없는 자재'))).toBe(true);
    const both = findingsOf({
      ...p,
      actions: p.actions.map((a, i) => i === 0 ? { ...a, pre: [cond, { kind: 'materialType', materialId: 'MAT-001' }] } : a),
    });
    expect(both.some((f) => f.kind === 'alwaysFalse')).toBe(true);
    const rt = createRuntime(p);
    expect(evalCond(cond, { signals: {}, material: { instanceId: 'x', materialId: 'MAT-B', location: 'U-S1', state: '대기', holder: null } }, p).ok).toBe(true);
    expect(evalCond(cond, { signals: rt.state.signals, material: rt.state.material }, p).ok).toBe(false);
  });

  it('AC4 a flow sends each kind down its own arm', () => {
    const mixed = withKind(fed(buildFlowSampleProject(), 2, 0));
    const ordered = setFeedPattern(mixed, ['MAT-001', 'MAT-B']);
    if (!ordered.ok) throw new Error(ordered.reason);
    const p = ordered.project;
    const flow = p.sequence.flow ?? [];
    const branch = flow.find((n) => n.kind === 'branch');
    if (branch?.kind !== 'branch') throw new Error('branch');
    branch.cond = { kind: 'materialType', materialId: 'MAT-B' };
    expect(checkRunReadiness(p).ok).toBe(true);
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.status, rt.state.error?.message).toBe('completed');
    const taken = rt.state.log.filter((l) => l.code === 'BRANCH_TAKEN').map((l) => l.message);
    expect(taken).toHaveLength(2);
    expect(taken[0]).toContain('개체 1 · A');
    expect(taken[0]).toContain('거짓');
    expect(taken[1]).toContain('개체 2 · B');
    expect(taken[1]).toContain('참');
    expect(rt.state.steps.find((s) => s.stepId === 'STEP-NG' && s.instanceId === 'MAT-001#1')?.status).toBe('done');
    expect(rt.state.steps.find((s) => s.stepId === 'STEP-NG' && s.instanceId === 'MAT-B#2')?.status).toBe('skipped');
  });

  it('a Substation sequence flow branches on material kind', () => {
    const base = fed(buildParallelSampleProject(), 2, 0);
    const added = addMaterial(base, () => 'MAT-B');
    if (!added.ok) throw new Error(added.reason);
    const marked = setMaterialMark(added.project, 'MAT-B', 'B');
    if (!marked.ok) throw new Error(marked.reason);
    const ordered = setFeedPattern(marked.project, ['MAT-P1', 'MAT-B']);
    if (!ordered.ok) throw new Error(ordered.reason);
    const p = ordered.project;
    const start = p.units.find((u) => u.id === 'U-PS1')!;
    start.capacity.maxMaterials = { ...start.capacity.maxMaterials, value: 2 };
    const seqA = p.substationSequences!.find((q) => q.id === 'SSEQ-S1-A')!;
    seqA.flow = [{
      kind: 'branch', id: 'SUB-KIND', name: '종류 분기',
      cond: { kind: 'materialType', materialId: 'MAT-B' },
      then: [{ kind: 'step', stepId: 'SSTEP-A1' }],
      else: [{ kind: 'step', stepId: 'SSTEP-A2' }],
    }];
    expect(checkRunReadiness(p).ok).toBe(true);
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.status, rt.state.error?.message).toBe('completed');
    const taken = rt.state.log.filter((l) => l.code === 'BRANCH_TAKEN' && l.message.includes('종류 분기')).map((l) => l.message);
    expect(taken).toHaveLength(2);
    expect(taken[0]).toContain('개체 1 · A');
    expect(taken[0]).toContain(seqA.name);
    expect(taken[0]).toContain('거짓');
    expect(taken[1]).toContain('개체 2 · B');
    expect(taken[1]).toContain('참');
    expect(rt.state.steps.find((s) => s.stepId === 'SSTEP-A2' && s.instanceId === 'MAT-P1#1')?.status).toBe('done');
    expect(rt.state.steps.find((s) => s.stepId === 'SSTEP-A1' && s.instanceId === 'MAT-P1#1')?.status).toBe('skipped');
    expect(rt.state.steps.find((s) => s.stepId === 'SSTEP-A1' && s.instanceId === 'MAT-B#2')?.status).toBe('done');
    expect(rt.state.steps.find((s) => s.stepId === 'SSTEP-A2' && s.instanceId === 'MAT-B#2')?.status).toBe('skipped');
  });

  it('AC5 the summary and the timing rows count production and mean pass time by kind', () => {
    const mixed = withKind(fed(buildSampleProject(), 6, 0));
    const ordered = setFeedPattern(mixed, ['MAT-001', 'MAT-001', 'MAT-B']);
    if (!ordered.ok) throw new Error(ordered.reason);
    const rt = runToEnd(createRuntime(ordered.project));
    expect(rt.state.status).toBe('completed');
    const pieces = rt.state.pieces ?? [];
    const mean = (id: string) => {
      const done = pieces.filter((pc) => pc.material.materialId === id && pc.fedAtMs != null && pc.exitedAtMs != null);
      return Math.round(done.reduce((sum, pc) => sum + ((pc.exitedAtMs ?? 0) - (pc.fedAtMs ?? 0)), 0) / done.length);
    };
    const tallies = kindTallies(ordered.project, pieces);
    expect(tallies.map((row) => [row.mark, row.produced, row.avgPassMs])).toEqual([
      ['A', 4, mean('MAT-001')],
      ['B', 2, mean('MAT-B')],
    ]);
    expect(rt.state.steps.some((s) => s.lane === '개체 1 · A')).toBe(true);
    expect(rt.state.steps.some((s) => s.lane === '개체 3 · B')).toBe(true);
    const chart = timingChart(ordered.project, rt.state, 'piece');
    expect(chart.rows.map((row) => row.label).slice(0, 3)).toEqual(['개체 1 A', '개체 2 A', '개체 3 B']);
  });

  it('AC6 one-kind files, the three samples, and their logs stay the same apart from the rule version', () => {
    for (const build of [buildSampleProject, buildParallelSampleProject, buildFlowSampleProject]) {
      const fresh = build();
      const raw = serializeProject(fresh);
      expect(raw).not.toContain('feedPattern');
      expect(raw).not.toContain('"mark"');
      const opened = parseProjectFile(raw);
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      expect(serializeProject(opened.project)).toBe(raw);
      const rt = runToEnd(createRuntime(opened.project));
      expect(rt.state.log.some((l) => l.message.includes('종류'))).toBe(false);
      expect(rt.state.rulesVersion).toBe('seq-runtime/0.10.0');
    }
    const sample = buildSampleProject();
    const opened = parseProjectFile(serializeProject(sample));
    if (!opened.ok) throw new Error('sample');
    const again = runToEnd(createRuntime(sample));
    const replay = runToEnd(createRuntime(opened.project));
    expect(replay.state.log).toEqual(again.state.log);
    expect(again.state.timeMs).toBe(11100);
    const lined = fed(buildSampleProject(), 5, 0);
    const multi = runToEnd(createRuntime(lined));
    expect(multi.state.pieces?.map((pc) => pc.exitedAtMs)).toEqual([11100, 15600, 20100, 24600, 29100]);
    const flow = runToEnd(createRuntime(fed(buildFlowSampleProject(), 3, 0)));
    expect(flow.state.pieces?.map((pc) => pc.exitedAtMs)).toEqual([13100, 19600, 26100]);
    expect(flow.state.log.some((l) => l.message.includes('종류'))).toBe(false);
  });

  it('AC7 scene labels carry the kind letter and a single kind does not', () => {
    const mixed = withKind(fed(buildSampleProject(), 2, 0));
    const ordered = setFeedPattern(mixed, ['MAT-001', 'MAT-B']);
    if (!ordered.ok) throw new Error(ordered.reason);
    const start = ordered.project.units.find((u) => u.id === ordered.project.materials[0].initialLocation)!;
    start.capacity.maxMaterials = { ...start.capacity.maxMaterials, value: 2 };
    const rt = createRuntime(ordered.project);
    const scene = describeScene(ordered.project, rt.state);
    expect(scene.materials.map((m) => m.mark).filter(Boolean).sort()).toEqual(['A', 'B']);
    const labels = anchorLabels(scene, true, false).filter((l) => l.kind === 'material').map((l) => l.text);
    expect(labels.some((text) => text.includes(' A '))).toBe(true);
    expect(labels.some((text) => text.includes(' B '))).toBe(true);
    const plain = describeScene(buildSampleProject(), runToEnd(createRuntime(buildSampleProject())).state);
    expect(plain.materials.every((m) => m.mark == null)).toBe(true);
  });

  it('AC8 the same model yields the same log and the rule version moved to 0.10.0', () => {
    expect(RUNTIME_RULES_VERSION).toBe('seq-runtime/0.10.0');
    const p = withKind(fed(buildSampleProject(), 4, 1));
    const ordered = setFeedPattern(p, ['MAT-001', 'MAT-B']);
    if (!ordered.ok) throw new Error(ordered.reason);
    const a = runToEnd(createRuntime(ordered.project, 'same'));
    const b = runToEnd(createRuntime(ordered.project, 'same'));
    expect(b.state.log).toEqual(a.state.log);
    expect(a.state.rulesVersion).toBe('seq-runtime/0.10.0');
    expect(a.state.log.find((l) => l.code === 'RUN_START')?.message).toContain('seq-runtime/0.10.0');
  });

  it('refuses a fifth definition and clears a used kind only through the command', () => {
    let p = buildSampleProject();
    for (let i = 0; i < 3; i++) {
      const added = addMaterial(p, (prefix) => `${prefix}-${i}`);
      if (!added.ok) throw new Error(added.reason);
      p = added.project;
    }
    expect(p.materials).toHaveLength(MAX_MATERIAL_DEFS);
    expect(addMaterial(p).ok).toBe(false);
    expect(checkRunReadiness(p).blockers.some((b) => b.code === 'MATERIAL_COUNT')).toBe(false);
    const extra = structuredClone(p.materials[0]);
    extra.id = 'MAT-FIFTH';
    const tooMany = { ...p, materials: [...p.materials, extra] };
    expect(checkRunReadiness(tooMany).blockers.some((b) => b.code === 'MATERIAL_COUNT')).toBe(true);
    const used = setFeedPattern(p, ['MAT-001', 'mat-0']);
    if (!used.ok) throw new Error(used.reason);
    used.project.actions[0].pre = [{ kind: 'materialType', materialId: 'mat-0' }];
    expect(materialDeleteDetail(used.project, 'mat-0')).toContain('조건');
    expect(materialDeleteDetail(used.project, 'mat-0')).toContain('투입 순서');
    const removed = removeMaterial(used.project, 'mat-0');
    if (!removed.ok) throw new Error(removed.reason);
    expect(removed.project.materials.some((m) => m.id === 'mat-0')).toBe(false);
    expect(removed.project.actions[0].pre[0].kind).toBe('undefined');
    expect(removed.project.feedPattern).not.toContain('mat-0');
    const lone = buildSampleProject();
    expect(serializeProject(lone)).toBe(serializeProject(buildSampleProject()));
    expect(setMaterialMark(lone, lone.materials[0].id, 'A').ok).toBe(true);
  });
});
