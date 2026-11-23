// S14 — read one XLSX in the browser and turn rows into candidates. PDF, DWG, and USD stay unimplemented.
import { useState } from 'react';
import { addImportCandidates, buildImportCandidates } from '../import/candidatesFromSheet';
import { COLUMN_ROLES, guessColumns, type ColumnMapping, type ColumnRole } from '../import/columnMap';
import { readXlsx, XLSX_PREVIEW_ROWS, type XlsxBook } from '../import/xlsxRead';
import type { Project } from '../model/types';
import { Problem } from './Problem';
import { xlsxReadProblem } from './problemCopy';
import './xlsx-intake.css';

export interface XlsxIntakeProps {
  p?: Project;
  locked?: boolean;
  onCandidates?: (next: Project) => boolean | void;
  onOpenCandidates?: () => void;
}

const FORMATS: [string, string][] = [
  ['PDF', '추출 미구현'],
  ['DWG', '추출 미구현'],
  ['XLSX', '지원(IO 리스트 · 사양표)'],
  ['USD', '추출 미구현'],
];

function fileBytes(file: File): Promise<Uint8Array> {
  const read = (file as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer;
  if (typeof read === 'function') return read.call(file).then((buf) => new Uint8Array(buf));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('read'));
    reader.readAsArrayBuffer(file);
  });
}

function colLetter(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function headersFor(rows: string[][], headerRow: number): string[] {
  let width = rows[headerRow - 1]?.length ?? 0;
  for (let i = 0; i < Math.min(rows.length, XLSX_PREVIEW_ROWS); i++) width = Math.max(width, rows[i]?.length ?? 0);
  const row = rows[headerRow - 1] ?? [];
  return Array.from({ length: width }, (_, i) => row[i] ?? '');
}

export function XlsxIntake({ p, locked, onCandidates, onOpenCandidates }: XlsxIntakeProps) {
  const [error, setError] = useState<ReturnType<typeof xlsxReadProblem> | null>(null);
  const [book, setBook] = useState<XlsxBook | null>(null);
  const [fileName, setFileName] = useState('');
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerRow, setHeaderRow] = useState(1);
  const [columns, setColumns] = useState<ColumnMapping[]>([]);
  const [notice, setNotice] = useState('');
  const sheet = book?.sheets[sheetIndex];
  const hasDevice = columns.some((c) => c.role === 'deviceName');

  async function load(file: File) {
    setNotice('');
    const bytes = await fileBytes(file);
    const result = readXlsx(bytes);
    if (!result.ok) {
      setBook(null);
      setColumns([]);
      setError(xlsxReadProblem(result.code, result.why));
      return;
    }
    setError(null);
    setFileName(file.name);
    setBook(result.book);
    setSheetIndex(0);
    setHeaderRow(1);
    setColumns(guessColumns(headersFor(result.book.sheets[0]?.rows ?? [], 1)));
  }

  function chooseSheet(index: number) {
    if (!book) return;
    setSheetIndex(index);
    setHeaderRow(1);
    setColumns(guessColumns(headersFor(book.sheets[index].rows, 1)));
    setNotice('');
  }

  function chooseHeader(raw: number) {
    if (!book || !sheet) return;
    const row = Math.max(1, Math.floor(raw) || 1);
    setHeaderRow(row);
    setColumns(guessColumns(headersFor(sheet.rows, row)));
    setNotice('');
  }

  function setRole(index: number, role: ColumnRole) {
    setColumns((cols) => cols.map((c, i) => {
      if (i === index) return { ...c, role, guessed: false };
      if (role !== 'ignore' && c.role === role) return { ...c, role: 'ignore', guessed: false };
      return c;
    }));
  }

  function makeCandidates() {
    if (!book || !sheet || !p || !onCandidates || !hasDevice) return;
    const made = buildImportCandidates(p, { fileName, sheetName: sheet.name, rows: sheet.rows, headerRow, columns });
    if (!made.length) {
      setNotice('Device 이름이 있는 줄이 없습니다. 모델은 바꾸지 않았습니다.');
      return;
    }
    const ok = onCandidates(addImportCandidates(p, made));
    if (ok === false) return;
    setNotice(`후보 ${made.length}개를 입력 후보표에 넣었습니다. Unit · Device 수와 rev는 그대로입니다.`);
  }

  const preview = sheet ? sheet.rows.slice(0, XLSX_PREVIEW_ROWS) : [];
  return <div className="xlsx-intake" data-xlsx-intake="">
    <p className="xlsx-lead">자료에서 장비와 신호를 후보로 올리는 화면입니다. XLSX(IO 리스트 · 사양표)만 이 브라우저에서 읽습니다. 업로드와 외부 전송은 없습니다.</p>
    <table className="grid plain" data-format-table=""><thead><tr><th>형식</th><th>지원 상태</th></tr></thead><tbody>
      {FORMATS.map(([name, status]) => <tr key={name} data-format={name}><td>{name}</td><td>{status}</td></tr>)}
    </tbody></table>
    <div className="xlsx-tools">
      <label>XLSX 파일
        <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="XLSX 파일" disabled={locked}
          onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void load(file); }} />
      </label>
    </div>
    {error && <Problem copy={error} />}
    {sheet && book && <>
      <div className="xlsx-tools" role="group" aria-label="시트">
        {book.sheets.map((s, i) => <button key={s.name} type="button" className={i === sheetIndex ? 'on' : ''} data-xlsx-sheet={s.name} onClick={() => chooseSheet(i)}>{s.name}</button>)}
      </div>
      <label className="xlsx-tools">머리 줄
        <input type="number" min={1} aria-label="머리 줄" value={headerRow} onChange={(e) => chooseHeader(Number(e.target.value))} />
      </label>
      <p className="xlsx-note">앞 {preview.length}줄입니다. 이 시트는 {sheet.rows.length.toLocaleString('ko-KR')}줄입니다. 수식은 저장된 값만 읽고, 병합은 첫 칸만, 매크로와 그림은 무시합니다.</p>
      <div className="xlsx-scroll" data-xlsx-preview="">
        <table className="grid plain"><thead><tr><th>줄</th>{(preview[0] ?? []).map((_, i) => <th key={i}>{colLetter(i)}</th>)}</tr></thead>
          <tbody>{preview.map((row, i) => <tr key={i} className={i + 1 === headerRow ? 'is-header' : ''} data-sheet-row={i + 1}>
            <td>{i + 1}</td>{(row ?? []).map((value, c) => <td key={c}>{value}</td>)}
          </tr>)}</tbody></table>
      </div>
      <table className="grid plain" data-xlsx-mapping=""><thead><tr><th>열</th><th>머리글</th><th>의미</th></tr></thead>
        <tbody>{columns.map((c) => <tr key={c.index} data-column-index={c.index} data-guessed={c.guessed ? 'true' : 'false'}>
          <td>{colLetter(c.index)}</td>
          <td>{c.header || '(빈 머리글)'}</td>
          <td>
            <select aria-label={`${colLetter(c.index)} 열 역할`} value={c.role} onChange={(e) => setRole(c.index, e.target.value as ColumnRole)}>
              {COLUMN_ROLES.map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}
            </select>
            {c.guessed && <span className="xlsx-guess">추측</span>}
          </td>
        </tr>)}</tbody></table>
      {!hasDevice && <p className="xlsx-block">Device 이름 열을 지정해야 후보를 만들 수 있습니다.</p>}
      <div className="xlsx-tools">
        <button type="button" disabled={locked || columns.length === 0} onClick={() => setColumns((cols) => cols.map((c) => ({ ...c, guessed: false })))}>매핑 확정</button>
        <button type="button" disabled={locked || !hasDevice || !p || !onCandidates} onClick={makeCandidates}>후보 만들기</button>
        {notice && onOpenCandidates && <button type="button" onClick={onOpenCandidates}>입력 후보표에서 보기</button>}
      </div>
      {notice && <p className="xlsx-note" data-xlsx-notice="">{notice}</p>}
    </>}
    <p className="warn-note">PDF · DWG · USD는 추출하지 않습니다. 후보를 만들어도 Unit과 Device는 바뀌지 않습니다. 반영은 입력 후보표에서 확인한 것만입니다.</p>
  </div>;
}
