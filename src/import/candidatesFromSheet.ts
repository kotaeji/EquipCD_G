// Group spreadsheet rows into Unit, Device, and signal candidates. Does not change the project.
import { findAsset } from '../assets/library';
import { newId } from '../model/factory';
import type { Candidate, Project } from '../model/types';
import { signalMatchesName } from './signalMatch';
import { matchDeviceKind, parseDirection, type ColumnMapping, type ColumnRole } from './columnMap';

export interface SheetCandidateInput {
  fileName: string;
  sheetName: string;
  rows: string[][];
  /** 1-based header row. Data starts on the next row. */
  headerRow: number;
  columns: ColumnMapping[];
}

function cell(row: string[], columns: ColumnMapping[], role: ColumnRole): string {
  const col = columns.find((c) => c.role === role);
  if (!col) return '';
  return (row[col.index] ?? '').trim();
}

function guessed(columns: ColumnMapping[], roles: ColumnRole[]): boolean {
  return columns.some((c) => roles.includes(c.role) && c.guessed);
}

function confidence(target: Candidate['targetKind'], deviceKind: string | null, isGuess: boolean): Candidate['confidence'] {
  if (target === 'device' && !deviceKind && isGuess) return { level: 'low', basis: '종류 미지정 · 추측 매핑' };
  if (target === 'device' && !deviceKind) return { level: 'low', basis: '종류 미지정' };
  if (isGuess) return { level: 'low', basis: '추측 매핑' };
  if (target === 'device') return { level: 'medium', basis: '종류를 에셋에 맞춤' };
  return { level: 'medium', basis: '열 매핑을 확정함' };
}

function sourceNote(fileName: string, sheetName: string, rows: number[], memo: string | null): string {
  const list = [...rows].sort((a, b) => a - b);
  const base = `${fileName} · ${sheetName} · 줄 ${list.join(', ')}`;
  return memo ? `${base} · 메모 ${memo}` : base;
}

function unitTaken(p: Project, name: string): boolean {
  return p.units.some((u) => u.name === name) || p.candidates.some((c) => c.targetKind === 'unit' && c.name === name && !c.appliedObjectId);
}

function deviceTaken(p: Project, name: string): boolean {
  return p.devices.some((d) => d.name === name) || p.candidates.some((c) => c.targetKind === 'device' && c.name === name && !c.appliedObjectId);
}

function signalTaken(p: Project, deviceName: string, signalName: string): boolean {
  if (p.candidates.some((c) => c.targetKind === 'signal' && c.signalDeviceName === deviceName && c.name === signalName && !c.appliedObjectId)) return true;
  for (const d of p.devices) {
    if (d.name !== deviceName) continue;
    const ports = findAsset(d.kind)?.ports ?? [];
    if (p.signals.some((s) => s.deviceId === d.id && signalMatchesName(d.name, s, ports, signalName))) return true;
  }
  return false;
}

interface UnitAcc { name: string; rows: number[] }
interface DeviceAcc { name: string; rows: number[]; unitName: string | null; kindText: string | null }
interface SignalAcc { deviceName: string; name: string; rows: number[]; direction: 'in' | 'out' | null; address: string | null; memo: string | null }

/** One candidate per distinct Unit name, Device name, and Device+signal name. */
export function buildImportCandidates(p: Project, input: SheetCandidateInput, idOf: (prefix: string) => string = newId): Candidate[] {
  const units = new Map<string, UnitAcc>();
  const devices = new Map<string, DeviceAcc>();
  const signals = new Map<string, SignalAcc>();
  const start = Math.max(0, input.headerRow);
  for (let i = start; i < input.rows.length; i++) {
    const row = input.rows[i] ?? [];
    const sheetRow = i + 1;
    const deviceName = cell(row, input.columns, 'deviceName');
    if (!deviceName) continue;
    const unitName = cell(row, input.columns, 'unitName');
    const kindText = cell(row, input.columns, 'deviceKind');
    const signalName = cell(row, input.columns, 'signalName');
    const direction = parseDirection(cell(row, input.columns, 'signalDirection'));
    const address = cell(row, input.columns, 'address');
    const memo = cell(row, input.columns, 'memo');
    if (unitName) {
      const u = units.get(unitName) ?? { name: unitName, rows: [] };
      u.rows.push(sheetRow);
      units.set(unitName, u);
    }
    const d = devices.get(deviceName) ?? { name: deviceName, rows: [], unitName: null, kindText: null };
    d.rows.push(sheetRow);
    if (!d.unitName && unitName) d.unitName = unitName;
    if (!d.kindText && kindText) d.kindText = kindText;
    devices.set(deviceName, d);
    if (signalName) {
      const key = `${deviceName}\0${signalName}`;
      const s = signals.get(key) ?? { deviceName, name: signalName, rows: [], direction: null, address: null, memo: null };
      s.rows.push(sheetRow);
      if (!s.direction && direction) s.direction = direction;
      if (!s.address && address) s.address = address;
      if (!s.memo && memo) s.memo = memo;
      signals.set(key, s);
    }
  }
  const unitGuess = guessed(input.columns, ['unitName']);
  const deviceGuess = guessed(input.columns, ['deviceName', 'deviceKind', 'unitName']);
  const signalGuess = guessed(input.columns, ['signalName', 'signalDirection', 'address', 'memo']);
  const made: Candidate[] = [];
  for (const u of units.values()) {
    const existing = p.units.find((x) => x.name === u.name);
    made.push({
      id: idOf('cand'), targetKind: 'unit', name: u.name, deviceKind: null,
      assignedUnitId: existing?.id ?? null, assignedUnitName: u.name,
      sourceRefs: [{ method: 'import', note: sourceNote(input.fileName, input.sheetName, u.rows, null) }],
      confidence: confidence('unit', null, unitGuess),
      confirmation: 'unconfirmed', appliedObjectId: null,
      alreadyExists: unitTaken(p, u.name),
    });
  }
  for (const d of devices.values()) {
    const kind = d.kindText ? matchDeviceKind(d.kindText) : null;
    const existing = d.unitName ? p.units.find((x) => x.name === d.unitName) : undefined;
    made.push({
      id: idOf('cand'), targetKind: 'device', name: d.name, deviceKind: kind,
      assignedUnitId: existing?.id ?? null, assignedUnitName: d.unitName,
      sourceRefs: [{ method: 'import', note: sourceNote(input.fileName, input.sheetName, d.rows, null) }],
      confidence: confidence('device', kind, deviceGuess),
      confirmation: 'unconfirmed', appliedObjectId: null,
      alreadyExists: deviceTaken(p, d.name),
    });
  }
  for (const s of signals.values()) {
    made.push({
      id: idOf('cand'), targetKind: 'signal', name: s.name, deviceKind: null,
      assignedUnitId: null, signalDeviceName: s.deviceName, signalDirection: s.direction,
      signalAddress: s.address, signalMemo: s.memo,
      sourceRefs: [{ method: 'import', note: sourceNote(input.fileName, input.sheetName, s.rows, s.memo) }],
      confidence: confidence('signal', null, signalGuess),
      confirmation: 'unconfirmed', appliedObjectId: null,
      alreadyExists: signalTaken(p, s.deviceName, s.name),
    });
  }
  return made;
}

/** Append candidates. Unit count, device count, and revision stay as they are. */
export function addImportCandidates(p: Project, made: Candidate[]): Project {
  if (!made.length) return p;
  const n = structuredClone(p);
  n.candidates.push(...made);
  return n;
}
