// Read one XLSX in memory. Formulas contribute only their stored value. Merged cells keep the first cell. Pictures and macros are skipped.
import { strFromU8, unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

export const XLSX_MAX_BYTES = 5 * 1024 * 1024;
export const XLSX_MAX_ROWS = 5000;
export const XLSX_PREVIEW_ROWS = 20;
/** Declared uncompressed size. Stops a small zip from expanding without bound. */
export const XLSX_MAX_UNCOMPRESSED = 32 * 1024 * 1024;

export interface XlsxSheet {
  name: string;
  /** 1-based row index matches the array index + 1. Missing cells are empty strings. */
  rows: string[][];
}

export interface XlsxBook { sheets: XlsxSheet[] }

export type XlsxReadCode = 'not-xlsx' | 'corrupt' | 'too-big' | 'too-many-rows';

export type XlsxReadResult = { ok: true; book: XlsxBook } | { ok: false; code: XlsxReadCode; why: string };

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  ignoreDeclaration: true,
  isArray: (name) => ['sheet', 'Relationship', 'si', 'r', 'row', 'c', 'mergeCell'].includes(name),
});

type X = Record<string, unknown>;
const arr = (v: unknown): X[] => (Array.isArray(v) ? v as X[] : v === undefined || v === null ? [] : [v as X]);

function nodeText(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (typeof node === 'object') {
    const o = node as X;
    if ('#text' in o) return nodeText(o['#text']);
    if ('t' in o) return nodeText(o.t);
  }
  return '';
}

function siText(si: unknown): string {
  if (!si || typeof si !== 'object') return nodeText(si);
  const o = si as X;
  if (o.r !== undefined) return nodeText(o.r);
  if (o.t !== undefined) return nodeText(o.t);
  return '';
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5 || bytes[2] === 7);
}

function entry(files: Record<string, Uint8Array>, name: string): Uint8Array | undefined {
  if (files[name]) return files[name];
  const want = name.toLowerCase();
  const key = Object.keys(files).find((k) => k.replace(/\\/g, '/').toLowerCase() === want);
  return key ? files[key] : undefined;
}

function resolveTarget(target: string): string {
  const t = target.replace(/\\/g, '/');
  if (t.startsWith('/')) return t.slice(1);
  if (t.startsWith('xl/')) return t;
  return `xl/${t.replace(/^\.\//, '')}`;
}

function colIndex(cellRef: string): number {
  const letters = /^[A-Z]+/i.exec(cellRef)?.[0].toUpperCase() ?? '';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
}

function cellValue(c: X, shared: string[]): string {
  const t = String(c['@_t'] ?? '');
  if (t === 'inlineStr') return nodeText(c.is);
  if (t === 's') {
    const idx = Number(nodeText(c.v));
    return Number.isInteger(idx) && idx >= 0 ? shared[idx] ?? '' : '';
  }
  if (t === 'b') {
    const v = nodeText(c.v);
    if (v === '1') return 'TRUE';
    if (v === '0') return 'FALSE';
    return v;
  }
  if (t === 'e') return '';
  return nodeText(c.v);
}

function parseSheet(xml: string, shared: string[], name: string): XlsxSheet | { error: XlsxReadResult } {
  let doc: X;
  try { doc = parser.parse(xml) as X; } catch { return { error: { ok: false, code: 'corrupt', why: `시트 「${name}」의 XML을 읽지 못했습니다.` } }; }
  const rows = arr((doc.worksheet as X | undefined)?.sheetData && ((doc.worksheet as X).sheetData as X).row);
  const grid: string[][] = [];
  let next = 1;
  for (const row of rows) {
    const stated = Number(row['@_r']);
    const r = Number.isFinite(stated) && stated > 0 ? stated : next;
    next = r + 1;
    if (r > XLSX_MAX_ROWS) return { error: { ok: false, code: 'too-many-rows', why: `시트 「${name}」가 ${XLSX_MAX_ROWS.toLocaleString('ko-KR')}줄을 넘습니다.` } };
    const line = grid[r - 1] ?? [];
    grid[r - 1] = line;
    let colCursor = 0;
    for (const c of arr(row.c)) {
      const ref = String(c['@_r'] ?? '');
      const col = ref ? colIndex(ref) : colCursor;
      line[col] = cellValue(c, shared);
      colCursor = col + 1;
    }
  }
  if (grid.length > XLSX_MAX_ROWS) return { error: { ok: false, code: 'too-many-rows', why: `시트 「${name}」가 ${XLSX_MAX_ROWS.toLocaleString('ko-KR')}줄을 넘습니다.` } };
  let width = 0;
  for (const line of grid) width = Math.max(width, line?.length ?? 0);
  const filled: string[][] = [];
  for (let i = 0; i < grid.length; i++) {
    const line = grid[i] ? grid[i].slice() : [];
    for (let c = 0; c < width; c++) if (line[c] === undefined) line[c] = '';
    filled.push(line);
  }
  return { name, rows: filled };
}

export function readXlsx(bytes: Uint8Array): XlsxReadResult {
  if (bytes.byteLength > XLSX_MAX_BYTES) return { ok: false, code: 'too-big', why: '5MB를 넘습니다.' };
  if (!isZip(bytes)) return { ok: false, code: 'not-xlsx', why: '압축된 스프레드시트(XLSX)가 아닙니다.' };
  let files: Record<string, Uint8Array>;
  try {
    let total = 0;
    files = unzipSync(bytes, {
      filter(file) {
        const lower = file.name.replace(/\\/g, '/').toLowerCase();
        if (lower.startsWith('xl/media/') || lower.endsWith('vbaproject.bin')) return false;
        total += file.originalSize || 0;
        if ((file.originalSize || 0) > XLSX_MAX_UNCOMPRESSED || total > XLSX_MAX_UNCOMPRESSED) {
          throw new Error('uncompressed-limit');
        }
        return true;
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'uncompressed-limit') return { ok: false, code: 'too-big', why: '압축을 푼 내용이 32MB를 넘습니다.' };
    return { ok: false, code: 'corrupt', why: '압축을 풀지 못했습니다.' };
  }
  const declared = Object.values(files).reduce((sum, b) => sum + b.byteLength, 0);
  if (declared > XLSX_MAX_UNCOMPRESSED) return { ok: false, code: 'too-big', why: '압축을 푼 내용이 32MB를 넘습니다.' };
  const bookXml = entry(files, 'xl/workbook.xml');
  if (!bookXml) return { ok: false, code: 'not-xlsx', why: '통합 문서(workbook)가 없는 압축 파일입니다.' };
  let workbook: X;
  try { workbook = parser.parse(strFromU8(bookXml)) as X; } catch { return { ok: false, code: 'corrupt', why: '통합 문서 XML을 읽지 못했습니다.' }; }
  const sheets = arr((workbook.workbook as X | undefined)?.sheets && ((workbook.workbook as X).sheets as X).sheet);
  if (!sheets.length) return { ok: false, code: 'corrupt', why: '시트가 없습니다.' };
  const relXml = entry(files, 'xl/_rels/workbook.xml.rels');
  let rels: X[] = [];
  if (relXml) {
    try { rels = arr(((parser.parse(strFromU8(relXml)) as X).Relationships as X | undefined)?.Relationship); } catch { return { ok: false, code: 'corrupt', why: '시트 목록 연결을 읽지 못했습니다.' }; }
  }
  const sharedXml = entry(files, 'xl/sharedStrings.xml');
  let shared: string[] = [];
  if (sharedXml) {
    try {
      const sst = parser.parse(strFromU8(sharedXml)) as X;
      shared = arr(sst.sst && (sst.sst as X).si).map(siText);
    } catch { return { ok: false, code: 'corrupt', why: '공유 문자열을 읽지 못했습니다.' }; }
  }
  const out: XlsxSheet[] = [];
  for (const sheet of sheets) {
    const name = String(sheet['@_name'] ?? 'Sheet');
    const rid = String(sheet['@_id'] ?? '');
    const rel = rels.find((r) => String(r['@_Id'] ?? r['@_id'] ?? '') === rid);
    const target = rel ? resolveTarget(String(rel['@_Target'] ?? '')) : '';
    const xmlBytes = target ? entry(files, target) : undefined;
    if (!xmlBytes) return { ok: false, code: 'corrupt', why: `시트 「${name}」 파일을 찾지 못했습니다.` };
    const parsed = parseSheet(strFromU8(xmlBytes), shared, name);
    if ('error' in parsed) return parsed.error;
    out.push(parsed);
  }
  return { ok: true, book: { sheets: out } };
}
