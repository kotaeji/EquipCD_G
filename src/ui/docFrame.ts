// TURN-095. Shared cover, tables, and status marks for the run report and the print view.
// The report inlines doc-frame.css. The print view imports the same file.
import { MATERIAL_PATTERNS, type MaterialPattern } from '../model/materialKind';
import { PRODUCT_NAME } from '../model/types';
import { formatLocalClock } from './localClock';
import { STATUS, type StatusKey } from './status';
import docFrameCss from './doc-frame.css?raw';
import materialKindCss from './material-kind.css?raw';

export { docFrameCss, materialKindCss };

/** Same sentence on both covers and on the printed running head. */
export const DOC_LIMIT = '검토 후보 — 논리 시뮬레이션, 실제 장비 제어 / 안전 검증 아님';

export const DOC_KIND_RUN = '실행 결과 보고서';
export const DOC_KIND_DESIGN = '설계 요약';

/** Columns whose cells are a count or a virtual time. Same idea as ecd-num. */
export const DOC_NUM_HEADERS = new Set([
  '시작', '끝', '걸린 시간', '가상 시각', '시각', 'rev',
  '총 시간', '사이클', '시간당 생산량', '투입 개수', '끝난 단계',
]);

/** Cells whose whole text is a status word. The word stays; the mark is added around it. */
export const DOC_STATUS_HEADERS = new Set(['상태', '구분', '판정']);

const WORD_KEY: Record<string, StatusKey> = {
  '진행 중': 'active',
  '완료': 'done',
  '오류': 'error',
  '대기': 'pending',
  '미정': 'undetermined',
  '가정': 'assumption',
  '건너뜀': 'pending',
  '정지': 'assumption',
  '부족': 'error',
  '사람 확인 후보': 'assumption',
};

/** Pattern name next to the swatch, so a black-and-white page still separates kinds. */
export const PATTERN_WORD: Record<MaterialPattern, string> = {
  solid: '민무늬',
  hatch: '빗금',
  dots: '점',
  lines: '가로줄',
};

export const DOC_PATTERN_WORDS = MATERIAL_PATTERNS.map((pattern) => PATTERN_WORD[pattern]);

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function statusParts(word: string): { key: StatusKey; mark: string } | null {
  const key = WORD_KEY[word];
  if (!key) return null;
  return { key, mark: STATUS[key].mark };
}

/** Mark plus the original word. Unknown words stay plain escaped text. */
export function statusMarkHtml(word: string): string {
  const part = statusParts(word);
  if (!part) return esc(word);
  return `<span class="doc-status" data-status="${part.key}"><span class="doc-status-mark" aria-hidden="true">${part.mark}</span><span class="doc-status-word">${esc(word)}</span></span>`;
}

function numClass(header: string): string {
  return DOC_NUM_HEADERS.has(header) ? ' class="ecd-num"' : '';
}

function cellHtml(header: string, value: string): string {
  if (DOC_STATUS_HEADERS.has(header)) return statusMarkHtml(value);
  return esc(value);
}

export function docTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const head = headers.map((h) => `<th${numClass(h)}>${esc(h)}</th>`).join('');
  const body = rows.map((row) => `<tr>${row.map((cell, i) => `<td${numClass(headers[i] ?? '')}>${cellHtml(headers[i] ?? '', cell)}</td>`).join('')}</tr>`).join('');
  return `<table class="doc-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function docKv(rows: readonly (readonly [string, string])[]): string {
  const body = rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td${numClass(k)}>${cellHtml(k, v)}</td></tr>`).join('');
  return `<table class="doc-table doc-kv"><thead><tr><th>항목</th><th>값</th></tr></thead><tbody>${body}</tbody></table>`;
}

export interface DocCoverFields {
  projectName: string;
  kind: string;
  printedAt: Date;
  rev: string;
  rules: string;
  version: string;
  equipment: string;
}

function metaRow(label: string, value: string, attrs = ''): string {
  return `<tr><th scope="row">${esc(label)}</th><td${numClass(label)}${attrs}>${esc(value)}</td></tr>`;
}

/** Cover markup. Both documents call this so the elements, order, and classes match. */
export function docCoverHtml(f: DocCoverFields): string {
  const iso = f.printedAt.toISOString();
  const clock = formatLocalClock(f.printedAt);
  const rows = [
    metaRow('프로젝트', f.projectName),
    metaRow('문서', f.kind),
    metaRow('시각', clock, ` data-doc-date data-print-date title="${esc(iso)}"`),
    metaRow('rev', f.rev, ' data-doc-rev data-print-rev'),
    metaRow('실행 규칙', f.rules),
    metaRow('앱 버전', f.version, ' data-doc-version data-print-version'),
    metaRow('장비', f.equipment),
  ].join('');
  return `<header class="doc-cover" data-doc-cover data-print-cover>
<p class="doc-kicker">${esc(PRODUCT_NAME)}</p>
<h1 class="doc-title">${esc(f.projectName)}</h1>
<p class="doc-kind" data-doc-kind="${esc(f.kind)}">${esc(f.kind)}</p>
<p class="doc-limit" data-doc-limit data-print-limit>${esc(DOC_LIMIT)}</p>
<table class="doc-table doc-kv" aria-label="표지"><thead><tr><th>항목</th><th>값</th></tr></thead><tbody>${rows}</tbody></table>
</header>`;
}

export function docRunningHeadHtml(projectName: string): string {
  return `<div class="doc-runhead print-runhead" data-doc-runhead data-print-running-head><span class="doc-runhead-name" data-print-project>${esc(projectName)}</span><span class="doc-runhead-limit print-runhead-limit" data-print-limit>${esc(DOC_LIMIT)}</span></div>`;
}

export const DOC_PAGE_NUMBER = 'counter(page) " / " counter(pages)';
