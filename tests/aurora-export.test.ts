import { describe, expect, it } from 'vitest';
import {
  AURORA_EXPORT_DRAFT_NOTICE, AURORA_EXPORT_FORMAT, AURORA_EXPORT_VERSION, EXPORT_SLOTS,
  auroraExportFileName, buildAuroraExport, collectExportFlags, compareAuroraExport, exportQuantity,
  parseAuroraExport, serializeAuroraExport, type ExportFlowNode,
} from '../src/model/auroraExport';
import { buildExportPreview } from '../src/model/exportPreview';
import { buildFlowSampleProject, buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import { serializeProject } from '../src/storage/fileFormat';
import { APP_VERSION, q, type Project } from '../src/model/types';

function findFlow(nodes: ExportFlowNode[] | null, id: string): ExportFlowNode | undefined {
  const rec = (list: ExportFlowNode[] | null | undefined): ExportFlowNode | undefined => {
    for (const n of list ?? []) {
      if (n.kind !== 'step' && n.id === id) return n;
      if (n.kind === 'branch') { const hit = rec(n.then) ?? rec(n.else); if (hit) return hit; }
      else if (n.kind === 'parallel') { for (const lane of n.lanes) { const hit = rec(lane); if (hit) return hit; } }
      else if (n.kind === 'loop' || n.kind === 'retry') { const hit = rec(n.body); if (hit) return hit; }
    }
    return undefined;
  };
  return rec(nodes);
}

function roundTrip(p: Project) {
  const text = serializeAuroraExport(buildAuroraExport(p));
  const parsed = parseAuroraExport(text);
  if (!parsed.ok) throw new Error(parsed.reason);
  return compareAuroraExport(buildAuroraExport(p), parsed.file);
}

describe('TURN-041 aurora export draft', () => {
  it('AC1 AC14 the 5-step example file carries the draft header', () => {
    const p = buildSampleProject();
    const doc = buildAuroraExport(p);
    const text = serializeAuroraExport(doc);
    expect(doc.format).toBe(AURORA_EXPORT_FORMAT);
    expect(doc.formatVersion).toBe(AURORA_EXPORT_VERSION);
    expect(doc.draft).toBe(true);
    expect(doc.draftNotice).toBe(AURORA_EXPORT_DRAFT_NOTICE);
    expect(doc.appVersion).toBe(APP_VERSION);
    expect(doc.projectId).toBe(p.id);
    expect(doc.revision).toBe(p.revision);
    expect(text).toContain(AURORA_EXPORT_DRAFT_NOTICE);
    expect(text).not.toMatch(/createdAt|exportedAt|"at":/);
    expect(auroraExportFileName(p.name)).toBe('조립 라인 01 (5공정 예제).aurora-export.json');
  });

  it('AC2 every unit, device, signal, position, and station step is in the file by id', () => {
    const p = buildSampleProject();
    const doc = buildAuroraExport(p);
    const ids = (list: { id: string }[]) => list.map((x) => x.id).sort();
    expect(ids(doc.structure.station.units)).toEqual(ids(p.units));
    expect(ids(doc.structure.station.units.flatMap((u) => u.devices))).toEqual(ids(p.devices));
    expect(ids(doc.signals)).toEqual(ids(p.signals));
    expect(ids(doc.positions)).toEqual(ids(p.positions));
    expect(ids(doc.sequence.steps)).toEqual(ids(p.sequence.steps));
    expect(doc.sequence.flow).toBeNull();
  });

  it('AC3 keeps branch, parallel, loop, retry, and substation sequences', () => {
    const flow = buildAuroraExport(buildFlowSampleProject());
    const retry = findFlow(flow.sequence.flow, 'FLW-RETRY');
    const branch = findFlow(flow.sequence.flow, 'FLW-BRANCH');
    const loop = findFlow(flow.sequence.flow, 'FLW-LOOP');
    const parallel = findFlow(flow.sequence.flow, 'FLW-PAR');
    expect(retry).toMatchObject({ kind: 'retry', name: '읽기 재시도', maxRetries: 2 });
    expect(branch).toMatchObject({ kind: 'branch', name: '읽기 결과' });
    expect(loop).toMatchObject({ kind: 'loop', name: '가공 반복', count: 2 });
    expect(parallel && parallel.kind === 'parallel' && parallel.lanes).toHaveLength(2);
    expect(branch && branch.kind === 'branch' && branch.else).toEqual([{ kind: 'step', stepId: 'STEP-NG' }]);
    const parallelDoc = buildAuroraExport(buildParallelSampleProject());
    expect(parallelDoc.sequence.flow).toEqual([
      { kind: 'substation', id: 'FLW-SUB-S1', unitId: 'U-PS1' },
      { kind: 'substation', id: 'FLW-SUB-S2', unitId: 'U-PS2' },
    ]);
    expect(parallelDoc.substationSequences.map((q) => [q.id, q.unitId, q.steps.map((s) => s.id)])).toEqual([
      ['SSEQ-S1-A', 'U-PS1', ['SSTEP-A1', 'SSTEP-A2']],
      ['SSEQ-S1-B', 'U-PS1', ['SSTEP-B1', 'SSTEP-B2', 'SSTEP-B3']],
      ['SSEQ-S2-A', 'U-PS2', ['SSTEP-C1']],
    ]);
  });

  it('AC4 keeps null undetermined and assumption values as themselves', () => {
    expect(exportQuantity(q(null, 'mm', true))).toEqual({ value: null, unit: 'mm', status: 'undetermined' });
    expect(exportQuantity(q(12, 's', true))).toEqual({ value: 12, unit: 's', status: 'assumption' });
    expect(exportQuantity({ value: 3, unit: 'mm', assumption: false })).toEqual({ value: 3, unit: 'mm', status: 'confirmed' });
    const p = buildSampleProject();
    const undetermined = p.positions.find((x) => x.id === 'GNT-04.pos-pick')!;
    undetermined.value = { value: null, unit: 'mm', assumption: true };
    const assumed = p.positions.find((x) => x.id === 'GNT-04.pos-place')!;
    assumed.value = { value: 400, unit: 'mm', assumption: true };
    p.positions.push({ id: 'POS-CONF', name: '확정 위치', deviceId: 'GNT-04', value: { value: 3, unit: 'mm', assumption: false } });
    const doc = buildAuroraExport(p);
    expect(doc.positions.find((x) => x.id === 'GNT-04.pos-pick')!.value).toEqual({ value: null, unit: 'mm', status: 'undetermined' });
    expect(doc.positions.find((x) => x.id === 'GNT-04.pos-place')!.value).toEqual({ value: 400, unit: 'mm', status: 'assumption' });
    expect(doc.positions.find((x) => x.id === 'POS-CONF')!.value).toEqual({ value: 3, unit: 'mm', status: 'confirmed' });
    const raw = JSON.stringify(doc.positions.find((x) => x.id === 'GNT-04.pos-pick'));
    expect(raw).toContain('"value":null');
    expect(raw).not.toContain('"value":0');
    expect(raw).not.toContain('"value":""');
  });

  it('AC5 writes a conceptual signal or the address with its status', () => {
    const p = buildSampleProject();
    const open = p.signals[0];
    const assumed = p.signals[1];
    open.address = null;
    open.addressStatus = 'unassigned';
    assumed.address = 'Y0.1';
    assumed.addressStatus = 'assumed';
    p.signals[2].address = 'X1.2';
    p.signals[2].addressStatus = 'confirmed';
    const doc = buildAuroraExport(p);
    expect(doc.signals.find((s) => s.id === open.id)).toMatchObject({ address: null, conceptual: '개념 신호', addressStatus: 'undetermined' });
    expect(doc.signals.find((s) => s.id === assumed.id)).toMatchObject({ address: 'Y0.1', conceptual: null, addressStatus: 'assumption' });
    expect(doc.signals.find((s) => s.id === p.signals[2].id)).toMatchObject({ address: 'X1.2', conceptual: null, addressStatus: 'confirmed' });
  });

  it('AC6 puts unconfirmed interlocks and materials in the exclusion list', () => {
    const p = buildSampleProject();
    p.constraints[0].confirmation = 'confirmed';
    const doc = buildAuroraExport(p);
    expect(doc.interlocks.map((k) => k.id)).toEqual(['IL-01']);
    expect(doc.excluded.find((x) => x.id === 'IL-02')!.reason).toContain('확인되지 않은 Interlock');
    expect(doc.excluded.find((x) => x.id === 'MAT-001')).toMatchObject({ kind: 'material' });
    expect(doc.excluded.find((x) => x.id === 'MAT-001')!.reason).toContain('대상 자리 없음');
    const body = JSON.stringify({ structure: doc.structure, signals: doc.signals, positions: doc.positions, sequence: doc.sequence, interlocks: doc.interlocks });
    expect(body).not.toContain('MAT-001');
    expect(body).not.toContain('IL-02');
  });

  it('AC9 the same model serializes to the same bytes', () => {
    for (const p of [buildSampleProject(), buildFlowSampleProject(), buildParallelSampleProject()]) {
      expect(serializeAuroraExport(buildAuroraExport(p))).toBe(serializeAuroraExport(buildAuroraExport(structuredClone(p))));
    }
  });

  it('AC10 a fresh file matches the model with nothing missing or different', () => {
    for (const p of [buildSampleProject(), buildFlowSampleProject(), buildParallelSampleProject()]) {
      const report = roundTrip(p);
      expect(report.missing).toEqual([]);
      expect(report.changed).toEqual([]);
      expect(report.removed).toEqual([]);
      const signal = report.counts.find((c) => c.kind === 'signal')!;
      expect(signal.model).toBe(p.signals.length);
      expect(signal.file).toBe(p.signals.length);
      expect(signal.model).toBeGreaterThan(0);
    }
  });

  it('AC11 a renamed device, a changed action time, and a deleted signal are three diffs', () => {
    const p = buildSampleProject();
    p.signals.push({ id: 'SIG-EXTRA', name: '여분 신호', deviceId: p.devices[0].id, portKey: null, direction: 'in', valueType: 'bool', role: 'sensor', address: null, addressStatus: 'unassigned' });
    const text = serializeAuroraExport(buildAuroraExport(p));
    const edited = structuredClone(p);
    edited.devices[0].name = '이름변경';
    const step = edited.sequence.steps[0];
    const action = edited.actions.find((a) => a.id === step.actionId)!;
    action.duration = { ...action.duration, value: 9.5 };
    edited.signals = edited.signals.filter((s) => s.id !== 'SIG-EXTRA');
    const parsed = parseAuroraExport(text);
    if (!parsed.ok) throw new Error(parsed.reason);
    const report = compareAuroraExport(buildAuroraExport(edited), parsed.file);
    expect(report.missing).toEqual([]);
    expect(report.removed.map((d) => `${d.kind}:${d.id}`)).toEqual(['signal:SIG-EXTRA']);
    expect(report.changed.map((d) => `${d.kind}:${d.id}:${d.field}`).sort()).toEqual([
      `device:${edited.devices[0].id}:이름`,
      `step:${step.id}:동작 시간`,
    ].sort());
    expect(report.changed.find((d) => d.field === '이름')!.modelValue).toBe('이름변경');
    expect(report.changed.find((d) => d.field === '동작 시간')!.modelValue).toContain('9.5');
    expect(report.changed.find((d) => d.field === '동작 시간')!.fileValue).not.toContain('9.5');
  });

  it('AC12 a different or broken file is rejected and does not invent a model', () => {
    const broken = parseAuroraExport('{');
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.reason).toContain('JSON 파싱 실패');
    const other = parseAuroraExport(serializeProject(buildSampleProject()));
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.reason).toContain('형식이 다릅니다');
    const shifted = JSON.parse(serializeAuroraExport(buildAuroraExport(buildSampleProject()))) as { formatVersion: string };
    shifted.formatVersion = '9.9.9';
    const version = parseAuroraExport(JSON.stringify(shifted));
    expect(version.ok).toBe(false);
    if (!version.ok) expect(version.reason).toContain('지원하지 않는 초안 형식 버전');
  });

  it('AC13 building, serializing, and comparing leave revision untouched', () => {
    const p = buildSampleProject();
    const before = serializeProject(p);
    const text = serializeAuroraExport(buildAuroraExport(p));
    const parsed = parseAuroraExport(text);
    if (!parsed.ok) throw new Error(parsed.reason);
    compareAuroraExport(buildAuroraExport(p), parsed.file);
    collectExportFlags(buildAuroraExport(p));
    expect(p.revision).toBe(1);
    expect(serializeProject(p)).toBe(before);
  });

  it('preview targets use the draft slot names', () => {
    const p = buildSampleProject();
    const rows = buildExportPreview(p);
    expect(rows.find((r) => r.sourceId === p.units[0].id)!.target).toBe(EXPORT_SLOTS.unit);
    expect(rows.find((r) => r.sourceId === p.devices[0].id)!.target).toBe(EXPORT_SLOTS.device);
    expect(rows.find((r) => r.category === 'Signal')!.target).toBe(EXPORT_SLOTS.signal);
    expect(rows.find((r) => r.category === 'Position')!.target).toBe(EXPORT_SLOTS.position);
    expect(rows.find((r) => r.category === 'SequenceDraft')!.target).toBe(EXPORT_SLOTS.sequence);
    expect(rows.find((r) => r.category === 'Material')!.target).toBe(EXPORT_SLOTS.excluded);
    expect(rows.find((r) => r.sourceId === 'IL-01')!.target).toBe(EXPORT_SLOTS.excluded);
    const flow = buildExportPreview(buildFlowSampleProject());
    expect(flow.find((r) => r.category === 'SequenceDraft')!.note).toContain('흐름 블록');
    const parallel = buildExportPreview(buildParallelSampleProject());
    expect(parallel.filter((r) => r.category === 'Substation 시퀀스').map((r) => r.target)).toEqual([EXPORT_SLOTS.substationSequence, EXPORT_SLOTS.substationSequence, EXPORT_SLOTS.substationSequence]);
  });
});
