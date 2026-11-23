import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { guessColumns } from '../src/import/columnMap';
import { CSV_MAX_BYTES, CSV_MAX_ROWS, detectDelimiter, parseCsv, readCsv, readCsvText } from '../src/import/csvRead';
import { buildImportCandidates } from '../src/import/candidatesFromSheet';
import { readXlsx } from '../src/import/xlsxRead';
import { buildSampleProject } from '../src/model/sample';

const sampleXlsx = new Uint8Array(readFileSync(new URL('../docs/samples/io-list-5step.xlsx', import.meta.url)));

const TABLE = [
  ['Unit', 'Device', 'Type', 'Signal', 'Direction', 'Address', 'Memo'],
  ['S1 투입', 'CYL-01', '실린더', '전진 명령', '출력', 'Y101', '보조'],
  ['S6 검사', 'SEN-99', '센서', '감지', '입력', 'X1', ''],
];

function joinTable(delimiter: string): string {
  return TABLE.map((row) => row.join(delimiter)).join('\n');
}

function namesOf(text: string) {
  const read = readCsvText(text);
  if (!read.ok) throw new Error(read.why);
  const sheet = read.book.sheets[0];
  const columns = guessColumns(sheet.rows[0]);
  const made = buildImportCandidates(buildSampleProject(), {
    fileName: 'io.csv', sheetName: sheet.name, rows: sheet.rows, headerRow: 1, columns,
  }, (() => { let n = 0; return () => `c${++n}`; })());
  return {
    delimiter: read.delimiter,
    roles: columns.map((c) => c.role),
    units: made.filter((c) => c.targetKind === 'unit').map((c) => c.name),
    devices: made.filter((c) => c.targetKind === 'device').map((c) => c.name),
    signals: made.filter((c) => c.targetKind === 'signal').map((c) => c.name),
  };
}

describe('CSV delimiters and the same candidate path as XLSX', () => {
  it('AC1 reads comma, semicolon, and tab into the same mapping and candidates', () => {
    const comma = namesOf(joinTable(','));
    const semi = namesOf(joinTable(';'));
    const tab = namesOf(joinTable('\t'));
    expect(comma.delimiter).toBe(',');
    expect(semi.delimiter).toBe(';');
    expect(tab.delimiter).toBe('\t');
    expect(comma.roles.slice(0, 7)).toEqual(['unitName', 'deviceName', 'deviceKind', 'signalName', 'signalDirection', 'address', 'memo']);
    expect(semi.roles).toEqual(comma.roles);
    expect(tab.roles).toEqual(comma.roles);
    expect(semi.units).toEqual(comma.units);
    expect(tab.devices).toEqual(['CYL-01', 'SEN-99']);
    expect(comma.signals).toEqual(['전진 명령', '감지']);
    expect(semi.signals).toEqual(comma.signals);

    const euro = 'Unit;Device;Type;Signal\nS1;CYL-01;실린더;"전진, 후진"\n';
    expect(detectDelimiter(euro)).toBe(';');
    const read = readCsvText(euro);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.book.sheets[0].rows[1][3]).toBe('전진, 후진');

    const book = readXlsx(sampleXlsx);
    expect(book.ok).toBe(true);
    if (!book.ok) return;
    const rows = book.book.sheets[0].rows;
    const csv = readCsvText(rows.map((row) => row.join(',')).join('\n'));
    expect(csv.ok).toBe(true);
    if (!csv.ok) return;
    expect(csv.book.sheets[0].rows).toEqual(rows);
    expect(guessColumns(csv.book.sheets[0].rows[0]).map((c) => c.role)).toEqual(guessColumns(rows[0]).map((c) => c.role));
  });

  it('AC2 keeps commas, newlines, and doubled quotes inside quotes', () => {
    const text = 'Unit,Device,Signal,Memo\nS1,CYL-01,"전진, 후진","줄1\n줄2"\nS1,CYL-01,"말 ""그대로""","끝"\n';
    const read = readCsvText(text);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const rows = read.book.sheets[0].rows;
    expect(rows[1][2]).toBe('전진, 후진');
    expect(rows[1][3]).toBe('줄1\n줄2');
    expect(rows[2][2]).toBe('말 "그대로"');
    expect(rows[2][3]).toBe('끝');
    expect(rows).toHaveLength(3);
  });

  it('strips a UTF-8 BOM and keeps Korean text', () => {
    const body = new TextEncoder().encode('Unit,Device\n투입,CYL-01\n');
    const bom = new Uint8Array(body.byteLength + 3);
    bom.set([0xef, 0xbb, 0xbf], 0);
    bom.set(body, 3);
    const read = readCsv(bom);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.book.sheets[0].rows[0][0]).toBe('Unit');
    expect(read.book.sheets[0].rows[1]).toEqual(['투입', 'CYL-01']);
  });
});

describe('CSV refusal leaves no sheet', () => {
  it('AC4 refuses bytes that are not UTF-8, including EUC-KR and UTF-16', () => {
    const euc = readCsv(new Uint8Array([0x55, 0x6e, 0x69, 0x74, 0x2c, 0xb0, 0xa1]));
    expect(euc).toMatchObject({ ok: false, code: 'not-utf8' });
    if (!euc.ok) {
      expect(euc.why).toContain('UTF-8');
      expect(euc.why).not.toMatch(/\uFFFD/);
    }
    expect(readCsv(new Uint8Array([0xff, 0xfe, 0x55, 0x00]))).toMatchObject({ ok: false, code: 'not-utf8' });
    expect(readCsv(new Uint8Array([0xfe, 0xff, 0x00, 0x55]))).toMatchObject({ ok: false, code: 'not-utf8' });
  });

  it('AC4 refuses a file over 5MB and a table over 5000 rows', () => {
    expect(readCsv(new Uint8Array(CSV_MAX_BYTES + 1))).toMatchObject({ ok: false, code: 'too-big' });
    const lines = ['Device'];
    for (let i = 0; i < CSV_MAX_ROWS; i++) lines.push(`D${i}`);
    expect(lines).toHaveLength(CSV_MAX_ROWS + 1);
    expect(readCsvText(lines.join('\n'))).toMatchObject({ ok: false, code: 'too-many-rows' });
    expect(readCsvText(lines.slice(0, CSV_MAX_ROWS).join('\n')).ok).toBe(true);
    expect(parseCsv(lines.join('\n'), ',')).toBe('too-many-rows');
  });
});
