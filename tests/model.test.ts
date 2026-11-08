import { describe, expect, it } from 'vitest';
import { XMLValidator } from 'fast-xml-parser';
import { ASSET_LIBRARY, exportLibraryAml } from '../src/assets/library';
import { applyCandidates, newCandidate, planCandidateApply } from '../src/model/candidates';
import * as C from '../src/model/commands';
import { analyzeGaps, reconcileGapReview } from '../src/model/gaps';
import { applyEdit, initHistory, redo, undo } from '../src/model/history';
import { buildSampleProject } from '../src/model/sample';
import { parseStructuredSequence } from '../src/model/structuredText';
import { buildExportPreview } from '../src/model/exportPreview';
import { emptyProject } from '../src/model/factory';
import { validateProject } from '../src/model/validate';
import { createRuntime, runToEnd } from '../src/runtime/engine';
import { parseProjectFile, serializeProject } from '../src/storage/fileFormat';
import { MemoryKV, loadProject, quarantine, readIndex, readQuarantine, saveProject } from '../src/storage/localStore';
import { DEFAULT_VIEW, loadView, nextTheme, saveView } from '../src/ui/viewSettings';

const okp = (r: C.CmdResult) => { if (!r.ok) throw new Error(r.reason); return r.project; };

describe('asset library & AML samples (C02)', () => {
  it('library is read from AML: initial 8 kinds kept + 3 sensors + 3 unit templates = 14', () => {
    const kinds = ASSET_LIBRARY.map((a) => a.kind);
    for (const k of ['barcodeReader', 'conveyor', 'cylinder', 'gantry', 'picker', 'pusher', 'sensor', 'stopper']) expect(kinds).toContain(k);
    expect(kinds.length).toBe(14);
    expect(ASSET_LIBRARY.every((a) => a.amlSource.file === 'aml/ecd-sample-library.aml' && a.amlSource.origin === 'bundled')).toBe(true);
  });
  it('exported library AML is well-formed XML', () => {
    expect(XMLValidator.validate(exportLibraryAml())).toBe(true);
  });
  it('two instances of same definition are independent (C02-AC1)', () => {
    let p = buildSampleProject();
    p = okp(C.setDeviceProperty(p, 'CYL-03', 'stroke', 120, false));
    expect(p.devices.find((d) => d.id === 'CYL-03')!.properties.stroke.value).toBe(120);
    expect(p.devices.find((d) => d.id === 'CYL-01')!.properties.stroke.value).toBe(100);
  });
});

describe('canvas editing + undo/redo (F2, C06)', () => {
  it('device must be dropped inside a unit; creates Equipment>Unit>Device (F2-AC1)', () => {
    let p = emptyProject('t');
    expect(C.addDevice(p, 'cylinder', { x: 10, y: 10 }).ok).toBe(false);
    p = okp(C.addUnit(p, 'U', { x: 0, y: 0 }));
    const r = C.addDevice(p, 'cylinder', { x: 50, y: 50 });
    expect(r.ok).toBe(true);
    p = okp(r);
    const u = p.units[0];
    expect(p.equipment.unitIds).toEqual([u.id]);
    expect(u.deviceIds.length).toBe(1);
    expect(p.devices[0].unitId).toBe(u.id);
    expect(p.actions.filter((a) => a.deviceId === p.devices[0].id).length).toBe(1);
    expect(validateProject(p)).toEqual([]);
  });
  it('move + undo/redo keeps ids, hierarchy, connections; only positions round-trip (F2-AC3, C06-AC1)', () => {
    const p0 = buildSampleProject();
    let h = initHistory(p0);
    h = applyEdit(h, C.moveNodes(h.present, ['U-S2', 'CYL-03'], 40, -10), 'move', false).history;
    const moved = h.present;
    expect(moved.units.find((u) => u.id === 'U-S2')!.layout.x).toBe(p0.units[1].layout.x + 40);
    expect(moved.devices.find((d) => d.id === 'BCR-02')!.layout.x).toBe(p0.devices.find((d) => d.id === 'BCR-02')!.layout.x + 40);
    h = undo(h, false).history;
    expect(h.present).toEqual(p0);
    h = redo(h, false).history;
    expect(h.present).toEqual(moved);
    expect(h.present.connections).toEqual(p0.connections);
  });
  it('edits are blocked while running (D05 / C06-AC2)', () => {
    const h = initHistory(buildSampleProject());
    const o = applyEdit(h, C.moveNodes(h.present, ['U-S1'], 5, 5), 'move', true);
    expect(o.error).toMatch(/차단/);
    expect(o.history).toBe(h);
    expect(undo(h, true).error).toBeTruthy();
  });
  it('signal connection direction rule: out → in only; failure keeps original connections (F2-AC5)', () => {
    const p = buildSampleProject();
    const out = p.signals.find((s) => s.id.startsWith('STP-05') && s.direction === 'out')!;
    const inn = p.signals.find((s) => s.id.startsWith('CNV-05') && s.direction === 'in')!;
    const bad = C.addConnection(p, 'signal', inn.id, out.id);
    expect(bad.ok).toBe(false);
    const good = C.addConnection(p, 'signal', out.id, inn.id);
    expect(good.ok).toBe(true);
    expect(C.addConnection(p, 'flow', 'U-S1', 'STP-05').ok).toBe(false);
  });
  it('delete unit shows impact and leaves explicit undefined conditions instead of silent success (F4-AC5)', () => {
    const p = buildSampleProject();
    const imp = C.impactOf(p, 'U-S3');
    expect(imp.steps.length).toBeGreaterThan(0);
    expect(imp.materials.map((m) => m.id)).toEqual(['MAT-001']);
    const after = okp(C.deleteNode(p, 'U-S3'));
    expect(validateProject(after).filter((d) => d.severity === 'error')).toEqual([]);
    expect(after.materials[0].route).not.toContain('U-S3');
    const gaps = analyzeGaps(after);
    expect(gaps.some((g) => g.kind === 'unit' && g.judgement === 'shortfall')).toBe(true);
    const rt = runToEnd(createRuntime(after));
    expect(rt.state.status).not.toBe('completed');
  });
  it('reparent device moves its actions to the new unit', () => {
    const p = okp(C.reparentDevice(buildSampleProject(), 'CYL-01', 'U-S2'));
    expect(p.units.find((u) => u.id === 'U-S2')!.deviceIds).toContain('CYL-01');
    expect(p.units.find((u) => u.id === 'U-S1')!.deviceIds).not.toContain('CYL-01');
    expect(p.actions.filter((a) => a.deviceId === 'CYL-01').every((a) => a.unitId === 'U-S2')).toBe(true);
  });
  it('property input: empty = null (미정), not 0; non-number rejected', () => {
    let p = buildSampleProject();
    p = okp(C.setDeviceProperty(p, 'GNT-04', 'speed', '', true));
    expect(p.devices.find((d) => d.id === 'GNT-04')!.properties.speed.value).toBeNull();
    expect(C.setDeviceProperty(p, 'GNT-04', 'speed', 'abc', true).ok).toBe(false);
  });
});

describe('sequence (F5)', () => {
  it('add / reorder / remove steps', () => {
    let p = buildSampleProject();
    const n = p.sequence.steps.length;
    p = okp(C.addStep(p, p.actions.find((a) => a.deviceId === 'CYL-01')!.id, 0));
    expect(p.sequence.steps.length).toBe(n + 1);
    expect(p.sequence.steps[0].actionId).toBe(p.actions.find((a) => a.deviceId === 'CYL-01')!.id);
    p = okp(C.moveStep(p, 0, 2));
    expect(p.sequence.steps[2].actionId).toBe(p.actions.find((a) => a.deviceId === 'CYL-01')!.id);
    p = okp(C.removeStep(p, p.sequence.steps[2].id));
    expect(p.sequence.steps.length).toBe(n);
  });
  it('structured text: exact match is deterministic; ambiguous stays unresolved (F5-AC1/AC2 partial)', () => {
    const p = buildSampleProject();
    const res = parseStructuredSequence(p, '1. S1 푸셔 투입\n2. S2 바코드 읽기\n스토퍼 상승\n없는 동작');
    expect(res[0].status).toBe('matched');
    expect(res[1].status).toBe('matched');
    expect(res[2].status).toBe('ambiguous');
    expect(res[2].candidates.length).toBeGreaterThan(1);
    expect(res[3].status).toBe('notFound');
    // DnD and text produce same action references
    const ids = res.slice(0, 2).map((r) => r.actionId);
    expect(ids).toEqual([p.sequence.steps[0].actionId, p.sequence.steps[2].actionId]);
  });
  it('deleting an action used by a step is refused with impact', () => {
    const p = buildSampleProject();
    const r = C.deleteAction(p, p.sequence.steps[0].actionId);
    expect(r.ok).toBe(false);
  });
});

describe('gap analysis (F6)', () => {
  it('sample shows timing bottleneck with assumptions and interlock candidates needing human', () => {
    const gaps = analyzeGaps(buildSampleProject());
    const timing = gaps.find((g) => g.kind === 'timing')!;
    expect(timing.judgement).toBe('shortfall');
    expect(timing.assumptions.join(' ')).toMatch(/가정/);
    expect(timing.evidence).toMatch(/정밀 물리 아님/);
    expect(gaps.filter((g) => g.kind === 'interference').every((g) => g.safety)).toBe(true);
  });
  it('missing complete signal → 부족 I/O with step and configurator target (F6-AC1)', () => {
    const p = buildSampleProject();
    p.actions.find((a) => a.deviceId === 'BCR-02')!.completeSignalId = null;
    const g = analyzeGaps(p).find((x) => x.kind === 'io')!;
    expect(g.stepIds).toEqual(['STEP-03']);
    expect(g.target).toEqual({ panel: 'configurator', objectId: 'BCR-02' });
  });
  it('undefined axis spec → 미정 축 사양, not satisfied (F6-AC2)', () => {
    const p = okp(C.setDeviceProperty(buildSampleProject(), 'GNT-04', 'speed', null, true));
    const g = analyzeGaps(p).find((x) => x.kind === 'axisSpec');
    expect(g?.judgement).toBe('undetermined');
  });
  it('weight over capacity → shortfall; unknown → undetermined (F4-AC3)', () => {
    let p = buildSampleProject();
    p = okp(C.setQuantity(p, { kind: 'material', id: 'MAT-001', field: 'weight' }, 6, true));
    expect(analyzeGaps(p).some((g) => g.id.startsWith('unit:over-weight') && g.judgement === 'shortfall')).toBe(true);
    p = okp(C.setQuantity(p, { kind: 'unitCap', id: 'U-S1', field: 'maxWeight' }, null, true));
    expect(analyzeGaps(p).some((g) => g.id === 'unit:cap-weight:U-S1:MAT-001' && g.judgement === 'undetermined')).toBe(true);
  });
  it('reanalysis collapses resolved general rows but keeps evidence; safety rows never auto-close (F6-AC3/AC4)', () => {
    let p = buildSampleProject();
    const g1 = analyzeGaps(p);
    const safety = new Set(g1.filter((g) => g.safety).map((g) => g.id));
    const r1 = reconcileGapReview({}, g1, p.revision, safety);
    p = okp(C.setQuantity(p, { kind: 'material', id: 'MAT-001', field: 'feedInterval' }, 15, true));
    p = okp(C.setConstraintConfirmation(p, 'IL-01', 'confirmed'));
    const g2 = analyzeGaps(p);
    const r2 = reconcileGapReview(r1, g2, p.revision, safety);
    expect(r2['timing:cycle:MAT-001'].status).toBe('resolved');
    expect(r2['timing:cycle:MAT-001'].lastEvidence).toBe(r1['timing:cycle:MAT-001'].lastEvidence);
    expect(r2['intf:interlock:IL-01'].status).toBe('needsHuman');
  });
});

describe('F1 direct input candidates', () => {
  it('only confirmed + assigned candidates are applied; others report reasons (F1-AC1/AC3)', () => {
    let p = buildSampleProject();
    const a = newCandidate('device', 'SEN-02', 'sensor', 'U-S2'); a.confirmation = 'confirmed';
    const b = newCandidate('device', 'SEN-X', 'sensor', null); b.confirmation = 'confirmed';
    const c = newCandidate('device', 'SEN-Y', 'sensor', 'U-S2', 'low'); c.confirmation = 'confirmed';
    const d = newCandidate('device', 'SEN-Z', 'sensor', 'U-S2');
    p = { ...p, candidates: [a, b, c, d] };
    const plan = planCandidateApply(p);
    expect(plan.filter((x) => x.apply).map((x) => x.name)).toEqual(['SEN-02']);
    const res = applyCandidates(p);
    expect(res.applied).toEqual([a.id]);
    expect(res.project.devices.some((x) => x.name === 'SEN-02' && x.unitId === 'U-S2')).toBe(true);
    expect(res.skipped.find((x) => x.name === 'SEN-X')!.reason).toMatch(/미배정/);
    expect(p.devices.some((x) => x.name === 'SEN-02')).toBe(false); // original untouched (cancel = not applying)
  });
});

describe('file format & storage (C01, C05, D02~D04)', () => {
  it('save → reopen round-trips the model exactly; two projects do not mix (C01-AC1)', () => {
    const kv = new MemoryKV();
    const p1 = buildSampleProject();
    const p2 = okp(C.renameProject(emptyProject('other'), 'other2'));
    expect(saveProject(kv, p1).ok).toBe(true);
    expect(saveProject(kv, p2).ok).toBe(true);
    const r1 = loadProject(kv, p1.id); const r2 = loadProject(kv, p2.id);
    expect(r1.ok && r1.project).toEqual(p1);
    expect(r2.ok && r2.project).toEqual(p2);
    expect(readIndex(kv).map((e) => e.id).sort()).toEqual([p1.id, p2.id].sort());
  });
  it('serialization is stable', () => {
    expect(serializeProject(buildSampleProject())).toBe(serializeProject(buildSampleProject()));
  });
  it('save failure is reported; in-memory model unchanged (C01-AC2)', () => {
    const kv = new MemoryKV(); kv.failWrites = true;
    const p = buildSampleProject(); const before = JSON.stringify(p);
    const r = saveProject(kv, p);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(p)).toBe(before);
  });
  it('missing recent entry → error, no overwrite (C01-AC3)', () => {
    const r = loadProject(new MemoryKV(), 'nope');
    expect(r.ok).toBe(false);
  });
  it('corrupt JSON / unsupported version / missing reference rejected with raw preserved (C05-AC2/AC3, X05)', () => {
    const good = serializeProject(buildSampleProject());
    const corrupt = good.slice(0, 200);
    const r1 = parseProjectFile(corrupt);
    expect(r1.ok).toBe(false);
    if (!r1.ok) { expect(r1.raw).toBe(corrupt); expect(r1.errors[0].code).toBe('JSON_PARSE'); }
    const v = JSON.parse(good); v.formatVersion = '9.0.0';
    const r2 = parseProjectFile(JSON.stringify(v));
    expect(!r2.ok && r2.errors[0].code).toBe('VERSION_UNSUPPORTED');
    const m = JSON.parse(good); m.project.sequence.steps[0].actionId = 'ghost-action';
    const r3 = parseProjectFile(JSON.stringify(m));
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.errors.some((e) => e.objectId === 'STEP-01' && e.code === 'REF_MISSING_ACTION')).toBe(true);
    const dup = JSON.parse(good); dup.project.devices[1].id = dup.project.devices[0].id;
    const r4 = parseProjectFile(JSON.stringify(dup));
    expect(!r4.ok && r4.errors.some((e) => e.code === 'ID_DUPLICATE')).toBe(true);
    const kv = new MemoryKV();
    quarantine(kv, { at: 'now', label: 'bad.json', raw: corrupt, errors: ['x'] }, []);
    expect(readQuarantine(kv)[0].raw).toBe(corrupt);
  });
  it('asset version difference is a warning, not auto-updated', () => {
    const v = JSON.parse(serializeProject(buildSampleProject()));
    v.assetDefinitions[0].version = '0.0.9';
    const r = parseProjectFile(JSON.stringify(v));
    expect(r.ok && r.warnings.some((w) => w.code === 'ASSET_VERSION_DIFF')).toBe(true);
  });
  it('assumption flags and units survive save/reopen (F3-AC2, F4-AC4)', () => {
    const r = parseProjectFile(serializeProject(buildSampleProject()));
    if (!r.ok) throw new Error('parse');
    expect(r.project.positions.find((x) => x.id === 'GNT-04.pos-place')!.value).toMatchObject({ value: 400, unit: 'mm', assumption: true });
    expect(r.project.materials[0].size.w).toMatchObject({ value: 100, unit: 'mm', assumption: true });
    expect(r.project.signals.every((s) => s.address === null && s.addressStatus === 'unassigned')).toBe(true);
  });
});

describe('theme / view invariance (C03-AC1, SC-AC4, X06)', () => {
  it('theme cycles A→B→C→A and is stored separately from project data', () => {
    expect(nextTheme('A')).toBe('B'); expect(nextTheme('B')).toBe('C'); expect(nextTheme('C')).toBe('A');
    const kv = new MemoryKV();
    const p = buildSampleProject();
    saveProject(kv, p);
    const before = kv.getItem(`ecd.v1.project.${p.id}`);
    for (const t of ['B', 'C', 'A'] as const) saveView(kv, { ...DEFAULT_VIEW, theme: t, visualMode: 'photo', layers: { ...DEFAULT_VIEW.layers, io: false } });
    expect(kv.getItem(`ecd.v1.project.${p.id}`)).toBe(before);
    expect(loadView(kv).theme).toBe('A');
    expect(serializeProject(p)).not.toMatch(/"theme"/);
  });
  it('simulation result identical regardless of view settings', () => {
    const a = runToEnd(createRuntime(buildSampleProject()));
    saveView(new MemoryKV(), { ...DEFAULT_VIEW, theme: 'B', visualMode: 'photo' });
    const b = runToEnd(createRuntime(buildSampleProject()));
    expect(b.state.log).toEqual(a.state.log);
  });
});

describe('F8 preview (read-only)', () => {
  it('lists destinations; material marked not-in-target; nothing claims ready without contract', () => {
    const rows = buildExportPreview(buildSampleProject());
    expect(rows.find((r) => r.category === 'Material')!.status).toBe('notInTarget');
    expect(rows.filter((r) => r.category === 'Signal').every((r) => r.status === 'undetermined')).toBe(true);
    expect(rows.filter((r) => r.category === 'Position').every((r) => r.status === 'assumption')).toBe(true);
  });
});
