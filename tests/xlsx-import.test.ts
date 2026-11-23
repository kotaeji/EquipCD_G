import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findAsset } from '../src/assets/library';
import { guessColumns, matchDeviceKind } from '../src/import/columnMap';
import { addImportCandidates, buildImportCandidates } from '../src/import/candidatesFromSheet';
import { readXlsx } from '../src/import/xlsxRead';
import { applyCandidates, planCandidateApply } from '../src/model/candidates';
import { applyEdit, initHistory, undo } from '../src/model/history';
import { buildSampleProject } from '../src/model/sample';
import type { Candidate, Project } from '../src/model/types';

const sampleBytes = new Uint8Array(readFileSync(new URL('../docs/samples/io-list-5step.xlsx', import.meta.url)));

function sampleSheet() {
  const read = readXlsx(sampleBytes);
  if (!read.ok) throw new Error(read.why);
  const sheet = read.book.sheets[0];
  return { sheet, columns: guessColumns(sheet.rows[0]) };
}

function ids(prefix = 'C'): (s: string) => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}

function confirmNamed(p: Project, pick: (c: Candidate) => boolean): Project {
  const n = structuredClone(p);
  for (const c of n.candidates) if (pick(c)) c.confirmation = 'confirmed';
  return n;
}

describe('column guess and device kinds', () => {
  it('guesses the listed headers and leaves the guess flag on', () => {
    const one = (header: string) => guessColumns([header])[0];
    expect(one('Unit').role).toBe('unitName');
    expect(one('Station').role).toBe('unitName');
    expect(one('공정').role).toBe('unitName');
    expect(one('Tag').role).toBe('deviceName');
    expect(one('Device').role).toBe('deviceName');
    expect(one('장치').role).toBe('deviceName');
    expect(one('Type').role).toBe('deviceKind');
    expect(one('종류').role).toBe('deviceKind');
    expect(one('Signal').role).toBe('signalName');
    expect(one('신호').role).toBe('signalName');
    expect(one('IO').role).toBe('signalName');
    expect(one('DI').role).toBe('signalDirection');
    expect(one('DO').role).toBe('signalDirection');
    expect(one('In/Out').role).toBe('signalDirection');
    expect(one('Address').role).toBe('address');
    expect(one('주소').role).toBe('address');
    expect(one('Unit').guessed).toBe(true);
    expect(one('비고').role).toBe('memo');
    expect(one('기타').role).toBe('ignore');
    const row = guessColumns(['Unit', 'Device', 'Type', 'Signal', 'Direction', 'Address', 'Memo']);
    expect(row.map((c) => c.role)).toEqual(['unitName', 'deviceName', 'deviceKind', 'signalName', 'signalDirection', 'address', 'memo']);
    expect(guessColumns(['Device', 'Device'])[1].role).toBe('ignore');
  });

  it('maps asset names and leaves unknown text unspecified', () => {
    expect(matchDeviceKind('실린더')).toBe('cylinder');
    expect(matchDeviceKind('Cylinder')).toBe('cylinder');
    expect(matchDeviceKind('푸셔')).toBe('pusher');
    expect(matchDeviceKind('바코드리더')).toBe('barcodeReader');
    expect(matchDeviceKind('광전 센서')).toBe('photoelectricSensor');
    expect(matchDeviceKind('리밋 스위치')).toBe('limitSwitch');
    expect(matchDeviceKind('로봇')).toBeNull();
    expect(matchDeviceKind('')).toBeNull();
    expect(matchDeviceKind('투입 유닛 템플릿')).toBeNull();
  });
});

describe('candidates from the sample sheet', () => {
  it('builds unit, device, and signal candidates with file, sheet, and row numbers', () => {
    const { sheet, columns } = sampleSheet();
    const manual = columns.map((c) => ({ ...c, guessed: false }));
    const p = buildSampleProject();
    const before = { units: p.units.length, devices: p.devices.length, rev: p.revision, signals: p.signals.length };
    const made = buildImportCandidates(p, { fileName: 'io-list-5step.xlsx', sheetName: sheet.name, rows: sheet.rows, headerRow: 1, columns: manual }, ids());
    const next = addImportCandidates(p, made);
    expect(made.filter((c) => c.targetKind === 'unit').map((c) => c.name)).toEqual(['S1 투입', 'S2 식별', 'S6 검사']);
    expect(made.filter((c) => c.targetKind === 'device').map((c) => c.name)).toEqual(['PSH-01', 'CYL-01', 'BCR-02', 'SEN-06', 'CYL-06', 'ARM-06']);
    expect(made.filter((c) => c.targetKind === 'signal')).toHaveLength(8);
    const cyl = made.find((c) => c.targetKind === 'device' && c.name === 'CYL-01')!;
    expect(cyl.sourceRefs[0]).toEqual({ method: 'import', note: 'io-list-5step.xlsx · IO · 줄 3, 4' });
    expect(cyl.deviceKind).toBe('cylinder');
    expect(made.find((c) => c.name === 'ARM-06' && c.targetKind === 'device')!.deviceKind).toBeNull();
    expect(made.find((c) => c.name === 'ARM-06' && c.targetKind === 'device')!.confidence).toEqual({ level: 'low', basis: '종류 미지정' });
    expect(made.find((c) => c.name === 'SEN-06' && c.targetKind === 'device')!.confidence.level).toBe('medium');
    expect(next.units.length).toBe(before.units);
    expect(next.devices.length).toBe(before.devices);
    expect(next.signals.length).toBe(before.signals);
    expect(next.revision).toBe(before.rev);
    expect(p.candidates).toHaveLength(0);
  });

  it('marks names that already exist and leaves them out of the default plan', () => {
    const { sheet, columns } = sampleSheet();
    const manual = columns.map((c) => ({ ...c, guessed: false }));
    const p = buildSampleProject();
    const made = buildImportCandidates(p, { fileName: 'io-list-5step.xlsx', sheetName: sheet.name, rows: sheet.rows, headerRow: 1, columns: manual }, ids());
    const next = addImportCandidates(p, made);
    const cyl = next.candidates.find((c) => c.targetKind === 'device' && c.name === 'CYL-01')!;
    const fresh = next.candidates.find((c) => c.targetKind === 'device' && c.name === 'SEN-06')!;
    const knownSignal = next.candidates.find((c) => c.targetKind === 'signal' && c.signalDeviceName === 'CYL-01' && c.name === '전진 명령')!;
    expect(cyl.alreadyExists).toBe(true);
    expect(cyl.confirmation).toBe('unconfirmed');
    expect(fresh.alreadyExists).toBe(false);
    expect(knownSignal.alreadyExists).toBe(true);
    const plan = planCandidateApply(next);
    expect(plan.find((x) => x.candidateId === cyl.id)!.reason).toBe('이미 있음');
    expect(plan.find((x) => x.candidateId === cyl.id)!.apply).toBe(false);
    const applied = applyCandidates(next);
    expect(applied.project.devices.filter((d) => d.name === 'CYL-01')).toHaveLength(1);
    expect(applied.applied).toEqual([]);
  });

  it('guessed mapping stays low, so a confirmed device is still skipped', () => {
    const { sheet, columns } = sampleSheet();
    expect(columns.every((c) => c.guessed)).toBe(true);
    const p = addImportCandidates(buildSampleProject(), buildImportCandidates(buildSampleProject(), {
      fileName: 'io-list-5step.xlsx', sheetName: sheet.name, rows: sheet.rows, headerRow: 1, columns,
    }, ids()));
    const sen = p.candidates.find((c) => c.name === 'SEN-06' && c.targetKind === 'device')!;
    expect(sen.confidence).toEqual({ level: 'low', basis: '추측 매핑' });
    sen.confirmation = 'confirmed';
    const unit = p.candidates.find((c) => c.name === 'S6 검사')!;
    unit.confirmation = 'confirmed';
    expect(planCandidateApply(p).find((x) => x.candidateId === sen.id)!.reason).toMatch(/낮은 신뢰도/);
  });
});

describe('apply imported candidates', () => {
  function imported() {
    const { sheet, columns } = sampleSheet();
    const manual = columns.map((c) => ({ ...c, guessed: false }));
    const base = buildSampleProject();
    return addImportCandidates(base, buildImportCandidates(base, {
      fileName: 'io-list-5step.xlsx', sheetName: sheet.name, rows: sheet.rows, headerRow: 1, columns: manual,
    }, ids()));
  }

  it('creates a unit and puts the confirmed device inside it, and one undo restores both', () => {
    const p = confirmNamed(imported(), (c) => (c.targetKind === 'unit' && c.name === 'S6 검사') || (c.targetKind === 'device' && (c.name === 'SEN-06' || c.name === 'CYL-06')));
    const before = { units: p.units.length, devices: p.devices.length, rev: p.revision };
    let h = initHistory(p);
    const res = applyCandidates(p);
    res.project.revision += 1;
    h = applyEdit(h, { ok: true, project: res.project }, '후보 반영', false).history;
    const unit = h.present.units.find((u) => u.name === 'S6 검사')!;
    const sen = h.present.devices.find((d) => d.name === 'SEN-06')!;
    const cyl = h.present.devices.find((d) => d.name === 'CYL-06')!;
    expect(unit).toBeTruthy();
    expect(sen.unitId).toBe(unit.id);
    expect(unit.deviceIds).toEqual(expect.arrayContaining([sen.id, cyl.id]));
    expect(h.present.devices.filter((d) => d.name === 'CYL-01')).toHaveLength(1);
    expect(h.present.units.length).toBe(before.units + 1);
    h = undo(h, false).history;
    expect(h.present.units.length).toBe(before.units);
    expect(h.present.devices.length).toBe(before.devices);
    expect(h.present.devices.some((d) => d.name === 'SEN-06')).toBe(false);
    expect(h.past).toHaveLength(0);
  });

  it('fills the address of an asset signal and adds a signal the asset does not define', () => {
    const p0 = imported();
    const p = confirmNamed(p0, (c) =>
      (c.targetKind === 'unit' && c.name === 'S6 검사')
      || (c.targetKind === 'device' && c.name === 'SEN-06')
      || (c.targetKind === 'signal' && c.signalDeviceName === 'SEN-06')
      || (c.targetKind === 'signal' && c.signalDeviceName === 'CYL-01' && c.name === '전진 명령'));
    const beforeSignals = p.signals.filter((s) => s.deviceId === 'CYL-01').map((s) => ({ name: s.name, direction: s.direction, address: s.address }));
    const res = applyCandidates(p);
    const cyl = res.project.signals.find((s) => s.deviceId === 'CYL-01' && s.name.includes('전진 명령'))!;
    const assetDir = beforeSignals.find((s) => s.name.includes('전진 명령'))!;
    expect(cyl.address).toBe('Y101');
    expect(cyl.direction).toBe(assetDir.direction);
    expect(res.project.signals.filter((s) => s.deviceId === 'CYL-01')).toHaveLength(beforeSignals.length);
    const sen = res.project.devices.find((d) => d.name === 'SEN-06')!;
    const ports = findAsset(sen.kind)!.ports.filter((port) => port.role !== 'flow');
    const sensed = res.project.signals.find((s) => s.deviceId === sen.id && s.portKey === ports[0].key)!;
    expect(sensed.address).toBe('X600');
    expect(sensed.name).toBe(`${sen.name}.${ports[0].label}`);
    const extra = res.project.signals.find((s) => s.deviceId === sen.id && s.name === '예비 신호')!;
    expect(extra.direction).toBe('out');
    expect(extra.address).toBe('Y600');
    expect(res.project.signals.filter((s) => s.deviceId === sen.id)).toHaveLength(ports.length + 1);
  });
});
