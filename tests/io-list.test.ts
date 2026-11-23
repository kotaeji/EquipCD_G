import { describe, expect, it } from 'vitest';
import { findAsset } from '../src/assets/library';
import { addImportCandidates, buildImportCandidates } from '../src/import/candidatesFromSheet';
import { guessColumns } from '../src/import/columnMap';
import { readCsv } from '../src/import/csvRead';
import { IO_LIST_HEADERS, ioListFileName, ioListRows, renderIoListCsv } from '../src/import/ioList';
import { buildSampleProject } from '../src/model/sample';
import type { Project, Signal } from '../src/model/types';

const STATUS: Record<Signal['addressStatus'], string> = {
  unassigned: '미지정',
  assumed: '가정',
  confirmed: '확인',
};

function ids(): (prefix: string) => string {
  let n = 0;
  return () => `c${++n}`;
}

function withMarkedSignal(p: Project): { project: Project; signal: Signal } {
  const project = structuredClone(p);
  const signal = project.signals.find((s) => s.deviceId === 'CYL-01' && s.direction === 'out')!;
  signal.name = '전진, "특수"\n다음';
  signal.address = 'Y1,2';
  signal.addressStatus = 'confirmed';
  const assumed = project.signals.find((s) => s.deviceId === 'BCR-02')!;
  assumed.address = 'D100';
  assumed.addressStatus = 'assumed';
  return { project, signal };
}

describe('IO list CSV', () => {
  it('AC5 writes every signal once with unit, device, direction, address, and address status', () => {
    const { project, signal } = withMarkedSignal(buildSampleProject());
    const rows = ioListRows(project);
    expect(rows).toHaveLength(project.signals.length);
    const seen = new Set<string>();
    for (const s of project.signals) {
      const device = project.devices.find((d) => d.id === s.deviceId)!;
      const unit = project.units.find((u) => u.id === device.unitId)!;
      const row = rows.find((r) => r[2] === device.name && r[4] === s.name)!;
      expect(row, s.name).toBeTruthy();
      expect(row[0]).toBe(unit.name);
      expect(row[1]).toBe(device.name.match(/[A-Za-z]{2,}-\d+/)?.[0] ?? device.name);
      expect(row[3]).toBe(findAsset(device.kind)?.name ?? device.kind);
      expect(row[5]).toBe(s.direction === 'out' ? '출력' : '입력');
      expect(row[6].length).toBeGreaterThan(0);
      expect(row[7]).toBe(s.address ?? '');
      expect(row[8]).toBe(STATUS[s.addressStatus]);
      expect(row[9]).toBe('');
      seen.add(`${device.name}\0${s.name}`);
    }
    expect(seen.size).toBe(project.signals.length);
    const marked = rows.find((r) => r[4] === signal.name)!;
    expect(marked[5]).toBe('출력');
    expect(marked[7]).toBe('Y1,2');
    expect(marked[8]).toBe('확인');
    const text = renderIoListCsv(project);
    expect(text.startsWith('\uFEFF')).toBe(true);
    expect(text).toContain('"Y1,2"');
    expect(text).toContain('"전진, ""특수""');
    expect(ioListFileName(project.name)).toMatch(/_IO리스트\.csv$/);
  });

  it('AC6 a round trip maps every column and marks every candidate as already present', () => {
    const { project } = withMarkedSignal(buildSampleProject());
    const before = JSON.stringify(project);
    const text = renderIoListCsv(project);
    expect(JSON.stringify(project)).toBe(before);
    const read = readCsv(new TextEncoder().encode(text));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const sheet = read.book.sheets[0];
    expect(sheet.rows[0]).toEqual([...IO_LIST_HEADERS]);
    const columns = guessColumns(sheet.rows[0]);
    expect(columns.map((c) => c.role)).toEqual([
      'unitName', 'deviceCode', 'deviceName', 'deviceKind', 'signalName', 'signalDirection', 'signalRole', 'address', 'addressStatus', 'memo',
    ]);
    expect(columns.every((c) => c.guessed)).toBe(true);
    const made = buildImportCandidates(project, {
      fileName: 'round.csv', sheetName: sheet.name, rows: sheet.rows, headerRow: 1, columns,
    }, ids());
    expect(made.length).toBeGreaterThan(0);
    expect(made.every((c) => c.alreadyExists)).toBe(true);
    expect(made.filter((c) => c.targetKind === 'signal')).toHaveLength(project.signals.length);
    const marked = made.find((c) => c.targetKind === 'signal' && c.name.includes('특수'))!;
    expect(marked.signalAddress).toBe('Y1,2');
    expect(marked.signalDirection).toBe('out');
    const next = addImportCandidates(project, made);
    expect(next.units).toHaveLength(project.units.length);
    expect(next.devices).toHaveLength(project.devices.length);
    expect(next.signals).toHaveLength(project.signals.length);
    expect(next.revision).toBe(project.revision);
    expect(project.candidates).toHaveLength(0);
  });

  it('AC7 export and candidate creation leave unit count, device count, and revision', () => {
    const project = buildSampleProject();
    const snap = { units: project.units.length, devices: project.devices.length, rev: project.revision, signals: project.signals.length };
    const text = renderIoListCsv(project);
    expect(project.units).toHaveLength(snap.units);
    expect(project.devices).toHaveLength(snap.devices);
    expect(project.revision).toBe(snap.rev);
    const read = readCsv(new TextEncoder().encode(text));
    if (!read.ok) throw new Error(read.why);
    const made = buildImportCandidates(project, {
      fileName: ioListFileName(project.name),
      sheetName: read.book.sheets[0].name,
      rows: read.book.sheets[0].rows,
      headerRow: 1,
      columns: guessColumns(read.book.sheets[0].rows[0]).map((c) => ({ ...c, guessed: false })),
    }, ids());
    const next = addImportCandidates(project, made);
    expect(next.units).toHaveLength(snap.units);
    expect(next.devices).toHaveLength(snap.devices);
    expect(next.signals).toHaveLength(snap.signals);
    expect(next.revision).toBe(snap.rev);
    expect(text.length).toBeGreaterThan(IO_LIST_HEADERS.length);
  });
});
