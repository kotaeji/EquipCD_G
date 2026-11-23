// Minimal XLSX writer for the sample file and tests. The app does not import this.
import { strToU8, zipSync } from 'fflate';

export type XlsxCell = string | number | null | { formula: string; result: string };

export interface XlsxSheetSpec {
  name: string;
  rows: XlsxCell[][];
  merges?: string[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function colName(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Build a spreadsheet. Strings go through the shared string table. Formulas keep only the given stored result. */
export function buildXlsx(sheets: XlsxSheetSpec[], extra: Record<string, Uint8Array> = {}): Uint8Array {
  const shared: string[] = [];
  const indexOf = (s: string) => {
    let i = shared.indexOf(s);
    if (i < 0) { i = shared.length; shared.push(s); }
    return i;
  };
  const sheetXml = sheets.map((sheet) => {
    const body = sheet.rows.map((row, r) => {
      const cells = row.map((cell, c) => {
        if (cell === null || cell === '') return '';
        const ref = `${colName(c)}${r + 1}`;
        if (typeof cell === 'number') return `<c r="${ref}"><v>${cell}</v></c>`;
        if (typeof cell === 'object') return `<c r="${ref}"><f>${esc(cell.formula)}</f><v>${esc(cell.result)}</v></c>`;
        return `<c r="${ref}" t="s"><v>${indexOf(cell)}</v></c>`;
      }).join('');
      return `<row r="${r + 1}">${cells}</row>`;
    }).join('');
    const merges = sheet.merges?.length
      ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((ref) => `<mergeCell ref="${esc(ref)}"/>`).join('')}</mergeCells>`
      : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData>${merges}</worksheet>`;
  });
  const sst = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`;
  const root = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(types),
    '_rels/.rels': strToU8(root),
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(rels),
    'xl/sharedStrings.xml': strToU8(sst),
    ...extra,
  };
  sheetXml.forEach((xml, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(xml); });
  return zipSync(files);
}
