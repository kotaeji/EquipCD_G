// Read one CSV or a pasted table in memory. Same sheet shape as an XLSX book, so preview and column mapping stay one path.
import { XLSX_MAX_BYTES, XLSX_MAX_ROWS, type XlsxBook } from './xlsxRead';

export const CSV_MAX_BYTES = XLSX_MAX_BYTES;
export const CSV_MAX_ROWS = XLSX_MAX_ROWS;

export type CsvDelimiter = ',' | ';' | '\t';

export type CsvReadCode = 'not-utf8' | 'too-big' | 'too-many-rows';

export type CsvReadResult = { ok: true; book: XlsxBook; delimiter: CsvDelimiter } | { ok: false; code: CsvReadCode; why: string };

const DELIMITERS: CsvDelimiter[] = [',', ';', '\t'];

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Strict UTF-8. A legacy encoding is refused instead of being shown as replacement characters. */
export function decodeCsvBytes(bytes: Uint8Array): { ok: true; text: string } | { ok: false } {
  if (bytes.byteLength >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) return { ok: false };
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.includes('\u0000')) return { ok: false };
    return { ok: true, text: stripBom(text) };
  } catch {
    return { ok: false };
  }
}

/**
 * RFC 4180 fields. A quote starts a field only at the field boundary.
 * `""` inside quotes is one quote. Newlines inside quotes stay in the field.
 * Returns the row-limit code once the sheet passes 5,000 records.
 */
export function parseCsv(text: string, delimiter: CsvDelimiter): string[][] | 'too-many-rows' {
  const src = stripBom(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') { quoted = true; continue; }
    if (ch === delimiter) { row.push(field); field = ''; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      if (rows.length > CSV_MAX_ROWS) return 'too-many-rows';
      continue;
    }
    field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
    if (rows.length > CSV_MAX_ROWS) return 'too-many-rows';
  }
  return rows;
}

function padRows(rows: string[][]): string[][] {
  let width = 0;
  for (const row of rows) width = Math.max(width, row.length);
  return rows.map((row) => {
    if (row.length >= width) return row;
    const line = row.slice();
    while (line.length < width) line.push('');
    return line;
  });
}

function columnRank(rows: string[][]): number {
  const widths = rows.filter((row) => row.some((cell) => cell.trim() !== '')).map((row) => row.length);
  if (!widths.length) return -1;
  const freq = new Map<number, number>();
  for (const width of widths) freq.set(width, (freq.get(width) ?? 0) + 1);
  let mode = 1;
  let count = 0;
  for (const [width, n] of freq) {
    if (n > count || (n === count && width > mode)) { mode = width; count = n; }
  }
  if (mode < 2) return -1;
  return mode * 10000 + count;
}

/** The delimiter whose records share the widest repeated column count. A one-column file stays comma-separated. A tie that contains tabs is a spreadsheet paste. */
export function detectDelimiter(text: string): CsvDelimiter {
  const sample = firstRecords(stripBom(text), 20);
  let best: CsvDelimiter = ',';
  let bestRank = -1;
  const ranks = new Map<CsvDelimiter, number>();
  for (const delim of DELIMITERS) {
    const parsed = parseCsv(sample, delim);
    const rank = Array.isArray(parsed) ? columnRank(parsed) : -1;
    ranks.set(delim, rank);
    if (rank > bestRank) { bestRank = rank; best = delim; }
  }
  const tabRank = ranks.get('\t') ?? -1;
  if (tabRank >= 0 && tabRank === bestRank && sample.includes('\t')) return '\t';
  return best;
}

/** A prefix of complete records, so a quoted newline is not cut in half. */
function firstRecords(text: string, limit: number): string {
  let seen = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { i += 1; continue; }
      quoted = !quoted;
      continue;
    }
    if (!quoted && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      seen += 1;
      if (seen >= limit) return text.slice(0, i + 1);
    }
  }
  return text;
}

function tooBig(): CsvReadResult {
  return { ok: false, code: 'too-big', why: '5MB를 넘습니다.' };
}

function tooLong(): CsvReadResult {
  return { ok: false, code: 'too-many-rows', why: `표가 ${CSV_MAX_ROWS.toLocaleString('ko-KR')}줄을 넘습니다.` };
}

/** Parse text that is already a string (a paste, or bytes that decoded as UTF-8). */
export function readCsvText(text: string, sheetName = 'CSV'): CsvReadResult {
  if (new TextEncoder().encode(text).byteLength > CSV_MAX_BYTES) return tooBig();
  const delimiter = detectDelimiter(text);
  const parsed = parseCsv(text, delimiter);
  if (parsed === 'too-many-rows') return tooLong();
  return { ok: true, book: { sheets: [{ name: sheetName, rows: padRows(parsed) }] }, delimiter };
}

/** One CSV file. Non-UTF-8 bytes are refused with no decoded stand-in. */
export function readCsv(bytes: Uint8Array, sheetName = 'CSV'): CsvReadResult {
  if (bytes.byteLength > CSV_MAX_BYTES) return tooBig();
  const decoded = decodeCsvBytes(bytes);
  if (!decoded.ok) return { ok: false, code: 'not-utf8', why: 'UTF-8이 아닌 글자가 있습니다.' };
  return readCsvText(decoded.text, sheetName);
}
