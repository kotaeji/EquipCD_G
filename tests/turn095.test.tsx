// @vitest-environment jsdom
// TURN-095. The run report and the print view share one cover, one table rule, and one limit sentence.
import { readFileSync } from 'node:fs';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { PRINT_LIMIT } from '../src/model/printReport';
import { addMaterial, setFeedCount, setFeedPattern, setQuantity } from '../src/model/commands';
import { buildSampleProject } from '../src/model/sample';
import type { Project } from '../src/model/types';
import { createRuntime, runToEnd } from '../src/runtime/engine';
import {
  DOC_KIND_DESIGN,
  DOC_KIND_RUN,
  DOC_LIMIT,
  DOC_PAGE_NUMBER,
  DOC_PATTERN_WORDS,
  statusMarkHtml,
} from '../src/ui/docFrame';
import { PrintView } from '../src/ui/PrintView';
import { RUN_REPORT_LIMIT, STEP_HEADERS, renderRunReportHtml, stepTableRows } from '../src/ui/runReport';
import { STATUS, STATUS_KEYS } from '../src/ui/status';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WHEN = new Date('2026-11-27T13:46:32.000Z');
const docCss = readFileSync('src/ui/doc-frame.css', 'utf8');
const printCss = readFileSync('src/ui/print-view.css', 'utf8');

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
});

async function render(node: ReactNode) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(node); });
  return el;
}

function skeleton(el: Element): string {
  const parts: string[] = [];
  const walk = (node: Element) => {
    const classes = [...node.classList].join('.');
    const data = [...node.attributes].filter((a) => a.name.startsWith('data-')).map((a) => a.name).sort().join(',');
    parts.push(`${node.tagName.toLowerCase()}|${classes}|${data}`);
    for (const child of [...node.children]) walk(child);
  };
  walk(el);
  return parts.join('\n');
}

function mixed(): Project {
  const base = buildSampleProject();
  const counted = setFeedCount(base, base.materials[0].id, 2);
  if (!counted.ok) throw new Error(counted.reason);
  const timed = setQuantity(counted.project, { kind: 'material', id: counted.project.materials[0].id, field: 'feedInterval' }, 0, true);
  if (!timed.ok) throw new Error(timed.reason);
  const added = addMaterial(timed.project, () => 'MAT-B');
  if (!added.ok) throw new Error(added.reason);
  const ordered = setFeedPattern(added.project, [added.project.materials[0].id, 'MAT-B']);
  if (!ordered.ok) throw new Error(ordered.reason);
  return ordered.project;
}

describe('TURN-095 shared document frame', () => {
  it('AC1 the two covers use the same elements, order, and classes, and both carry the limit', async () => {
    const p = buildSampleProject();
    const rt = runToEnd(createRuntime(p));
    const html = renderRunReportHtml(p, rt.state, WHEN);
    const report = new DOMParser().parseFromString(html, 'text/html');
    const el = await render(<PrintView project={p} onClose={() => {}} />);
    const reportCover = report.querySelector('.doc-cover');
    const printCover = el.querySelector('.doc-cover');
    expect(reportCover).toBeTruthy();
    expect(printCover).toBeTruthy();
    expect(skeleton(printCover!)).toBe(skeleton(reportCover!));
    expect(reportCover!.querySelector('.doc-kind')!.textContent).toBe(DOC_KIND_RUN);
    expect(printCover!.querySelector('.doc-kind')!.textContent).toBe(DOC_KIND_DESIGN);
    const rowLabel = (cover: Element) => [...cover.querySelectorAll('table[aria-label="표지"] > tbody > tr > th')].map((th) => th.textContent);
    const labels = rowLabel(reportCover!);
    expect(labels).toEqual(['프로젝트', '문서', '시각', 'rev', '실행 규칙', '앱 버전', '장비']);
    expect(rowLabel(printCover!)).toEqual(labels);
    for (const cover of [reportCover!, printCover!]) {
      expect(cover.querySelector('[data-print-limit]')!.textContent).toBe(DOC_LIMIT);
      expect(cover.querySelector('.doc-limit')!.textContent).toBe(DOC_LIMIT);
    }
    expect(RUN_REPORT_LIMIT).toBe(DOC_LIMIT);
    expect(PRINT_LIMIT).toBe(DOC_LIMIT);
    expect(html).toContain(DOC_LIMIT);
  });

  it('AC2 both documents right-align times and the print rules repeat heads without cutting a row', async () => {
    const p = buildSampleProject();
    const rt = runToEnd(createRuntime(p));
    const html = renderRunReportHtml(p, rt.state, WHEN);
    const report = new DOMParser().parseFromString(html, 'text/html');
    const step = [...report.querySelectorAll('table')].find((table) => {
      const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent);
      return heads.join(',') === STEP_HEADERS.join(',');
    })!;
    const bodyRows = [...step.querySelectorAll('tr')].filter((tr) => tr.parentElement?.tagName === 'TBODY');
    for (const name of ['시작', '끝', '걸린 시간']) {
      const index = STEP_HEADERS.indexOf(name as typeof STEP_HEADERS[number]);
      const head = [...step.querySelectorAll('thead th')][index] as HTMLElement;
      expect(head.textContent).toBe(name);
      expect(head.classList.contains('ecd-num')).toBe(true);
      expect(bodyRows.length).toBeGreaterThan(0);
      for (const tr of bodyRows) {
        const td = [...tr.children].filter((cell) => cell.tagName === 'TD')[index] as HTMLElement;
        expect(td.classList.contains('ecd-num')).toBe(true);
      }
    }
    const el = await render(<PrintView project={p} onClose={() => {}} />);
    const date = el.querySelector('[data-print-date]') as HTMLElement;
    const rev = el.querySelector('[data-print-rev]') as HTMLElement;
    expect(date.classList.contains('ecd-num')).toBe(true);
    expect(rev.classList.contains('ecd-num')).toBe(true);
    for (const table of [...el.querySelectorAll('table')]) {
      if (table.classList.contains('doc-frame') || table.classList.contains('print-frame')) continue;
      expect(table.classList.contains('doc-table')).toBe(true);
    }
    for (const css of [docCss, printCss, html]) {
      expect(css).toContain('display: table-header-group');
      expect(css).toContain('break-inside: avoid');
      expect(css).toContain('page-break-inside: avoid');
    }
    expect(docCss).toContain('text-align: right');
    expect(docCss).toContain('tabular-nums');
    expect(docCss).not.toContain('ellipsis');
    const numRule = docCss.match(/th\.ecd-num,\s*table\.doc-table td\.ecd-num \{[^}]*\}/)?.[0] ?? '';
    expect(numRule).toContain('white-space: nowrap');
    expect(numRule).not.toContain('anywhere');
    expect(docCss).toContain('table.doc-table:not(.doc-kv) td.ecd-num');
    expect(docCss).toMatch(/:not\(\.doc-kv\) td\.ecd-num \{\s*width: 1%/);
    expect(html).not.toContain('ellipsis');
    expect(printCss).toContain(`content: ${DOC_PAGE_NUMBER}`);
    expect(html).toContain(`content: ${DOC_PAGE_NUMBER}`);
  });

  it('AC4 the report stays one file with no external reference', () => {
    const p = buildSampleProject();
    const html = renderRunReportHtml(p, runToEnd(createRuntime(p)).state, WHEN);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/@import/i);
    expect(html).not.toMatch(/@font-face/i);
    expect(html).not.toMatch(/url\s*\(/i);
    expect(html).not.toMatch(/https?:/i);
    expect(html).toContain('<style>');
    expect(html).toContain('.doc-cover {');
    expect(html).toContain('class="doc-cover"');
  });

  it('AC5 status marks and material patterns stay readable without color', () => {
    const seen = new Set<string>();
    for (const key of STATUS_KEYS) {
      const word = STATUS[key].word;
      const html = statusMarkHtml(word);
      expect(html).toContain(`data-status="${key}"`);
      expect(html).toContain(STATUS[key].mark);
      expect(html).toContain(`>${word}<`);
      expect(docCss).toContain(`data-status="${key}"`);
      seen.add(STATUS[key].mark);
    }
    expect(seen.size).toBe(STATUS_KEYS.length);
    expect(new Set(DOC_PATTERN_WORDS).size).toBe(4);
    for (const pattern of ['solid', 'hatch', 'dots', 'lines']) {
      expect(docCss.includes(`[data-mat-pattern="${pattern}"]`) || readFileSync('src/ui/material-kind.css', 'utf8').includes(`[data-mat-pattern="${pattern}"]`)).toBe(true);
    }
    const p = mixed();
    const html = renderRunReportHtml(p, runToEnd(createRuntime(p)).state, WHEN);
    expect(html).toContain('data-mat-pattern="solid"');
    expect(html).toContain('data-mat-pattern="hatch"');
    expect(html).toContain('>A ');
    expect(html).toContain('>B ');
    expect(html).toContain('민무늬');
    expect(html).toContain('빗금');
    expect(html).toContain('repeating-linear-gradient(-45deg');
    expect(html).toContain('class="doc-status-mark"');
    const plain = stepTableRows(buildSampleProject(), runToEnd(createRuntime(buildSampleProject())).state);
    for (const row of plain) expect(row[2]).toBe(row[2].replace(/[▶✓○△?]/g, ''));
  });

  it('AC2 the running head is in the document and hidden until print', async () => {
    const el = await render(<PrintView project={buildSampleProject()} onClose={() => {}} />);
    const head = el.querySelector('[data-print-running-head]')!;
    expect(head.textContent).toContain(buildSampleProject().name);
    expect(head.querySelector('[data-print-limit]')!.textContent).toBe(DOC_LIMIT);
    expect(docCss).toMatch(/\.doc-runhead\s*\{[^}]*display:\s*none/);
    expect(docCss).toMatch(/@media print[\s\S]*\.doc-runhead\s*\{[^}]*display:\s*flex/);
    expect(printCss).toMatch(/\.print-runhead\s*\{[^}]*display:\s*none/);
    expect(printCss).toMatch(/@media print[\s\S]*\.doc-runhead\s*\{[^}]*display:\s*flex/);
  });

  it('the shared frame does not put raw type or space sizes in doc-frame.css', () => {
    const stray: string[] = [];
    if (/font-size:\s*\d+(?:\.\d+)?px/.test(docCss)) stray.push('font-size px');
    const prop = /(padding|margin|gap|row-gap|column-gap|padding-(?:top|right|bottom|left)|margin-(?:top|right|bottom|left))\s*:\s*([^;}{]+)/g;
    for (const match of docCss.matchAll(prop)) {
      for (const px of match[2].matchAll(/-?\d+(?:\.\d+)?px/g)) {
        const n = Number(px[0].replace('px', ''));
        if (n === 0) continue;
        stray.push(`${match[1]}: ${match[2].trim()}`);
      }
    }
    expect(stray).toEqual([]);
  });
});
