import { strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildXlsx } from '../src/import/xlsxWrite';
import { readXlsx, XLSX_MAX_BYTES, XLSX_MAX_ROWS } from '../src/import/xlsxRead';
import { readFileSync } from 'node:fs';

const sample = new Uint8Array(readFileSync(new URL('../docs/samples/io-list-5step.xlsx', import.meta.url)));

describe('XLSX read', () => {
  it('reads the sample sheets, stored text, and ignores a merge expansion', () => {
    const book = readXlsx(sample);
    expect(book.ok).toBe(true);
    if (!book.ok) return;
    expect(book.book.sheets.map((s) => s.name)).toEqual(['IO', '참고']);
    expect(book.book.sheets[0].rows[0]).toEqual(['Unit', 'Device', 'Type', 'Signal', 'Direction', 'Address', 'Memo']);
    expect(book.book.sheets[0].rows[1][1]).toBe('PSH-01');
    expect(book.book.sheets[0].rows.length).toBe(9);
    const merged = buildXlsx([{ name: 'M', rows: [['hello', ''], ['1', '2']], merges: ['A1:B1'] }]);
    const read = readXlsx(merged);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.book.sheets[0].rows[0]).toEqual(['hello', '']);
  });

  it('keeps a formula result and skips pictures and macros', () => {
    const bytes = buildXlsx(
      [{ name: 'F', rows: [[{ formula: '1+2', result: '3' }, '옆에 그림']] }],
      { 'xl/media/pic.png': strToU8('not-a-picture'), 'xl/vbaProject.bin': strToU8('macro') },
    );
    const read = readXlsx(bytes);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.book.sheets[0].rows[0][0]).toBe('3');
    expect(read.book.sheets[0].rows[0][1]).toBe('옆에 그림');
  });

  it('rejects a non-xlsx, a broken zip, a file over 5MB, and a sheet over 5000 rows', () => {
    expect(readXlsx(strToU8('hello.pdf'))).toMatchObject({ ok: false, code: 'not-xlsx' });
    expect(readXlsx(strToU8('%PDF-1.4'))).toMatchObject({ ok: false, code: 'not-xlsx' });
    const broken = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
    expect(readXlsx(broken)).toMatchObject({ ok: false, code: 'corrupt' });
    const big = readXlsx(new Uint8Array(XLSX_MAX_BYTES + 1));
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.code).toBe('too-big');
    const rows: string[][] = [['Device']];
    for (let i = 0; i < XLSX_MAX_ROWS; i++) rows.push([`D${i}`]);
    expect(rows.length).toBe(XLSX_MAX_ROWS + 1);
    const over = readXlsx(buildXlsx([{ name: 'Long', rows }]));
    expect(over).toMatchObject({ ok: false, code: 'too-many-rows' });
    const exact = rows.slice(0, XLSX_MAX_ROWS);
    expect(readXlsx(buildXlsx([{ name: 'Fit', rows: exact }])).ok).toBe(true);
  });
});
