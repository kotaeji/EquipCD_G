// @vitest-environment jsdom
// TURN-065: the report menu on the run summary, and downloads that leave rev alone.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/ui/App';
import { RUN_REPORT_LIMIT, STEP_HEADERS } from '../src/ui/runReport';
import { holdRuntimeClock } from './holdRuntimeClock';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  vi.restoreAllMocks();
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  localStorage.clear();
});

async function mount() {
  document.body.innerHTML = '';
  localStorage.clear();
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(<App />); });
  const click = async (node: Element | null | undefined) => {
    if (!node) throw new Error('missing control');
    await act(async () => { (node as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  };
  const btn = (label: string) => [...el.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(label));
  return { el, click, btn };
}

function parseCsv(raw: string): string[][] {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; continue; }
        quoted = false;
        continue;
      }
      cell += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { row.push(cell); cell = ''; continue; }
    if (ch === '\n') {
      if (cell.endsWith('\r')) cell = cell.slice(0, -1);
      row.push(cell);
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += ch;
  }
  return rows;
}

describe('TURN-065 report menu', () => {
  it('AC1 AC6 a finished run can export HTML and both CSV files without changing rev or undo', async () => {
    const files: { name: string; text: string }[] = [];
    const pending: Promise<void>[] = [];
    let last: Blob | null = null;
    const urlApi = URL as unknown as { createObjectURL?: (b: Blob) => string; revokeObjectURL?: (u: string) => void };
    urlApi.createObjectURL = (b: Blob) => { last = b; return 'blob:report'; };
    urlApi.revokeObjectURL = () => {};
    const readBlob = (blob: Blob) => new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      const blob = last;
      const name = this.download;
      const index = files.length;
      files.push({ name, text: '' });
      if (!blob) return;
      pending.push(readBlob(blob).then((text) => { files[index].text = text; }));
    });

    const u = await mount();
    await u.click(u.btn('시작하기'));
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]'));
    await u.click(u.el.querySelector('[aria-label="자세히 펼치기"]'));
    const gate = () => u.el.querySelector('[data-report-export]') as HTMLButtonElement;
    expect(gate().disabled).toBe(true);
    expect(gate().getAttribute('data-report-ready')).toBe('0');
    expect(u.el.querySelector('[data-report-reason]')!.textContent).toContain('실행이 끝나면');
    expect(u.el.querySelector('[data-report-kind]')).toBeNull();

    const clock = holdRuntimeClock();
    try {
      await u.click(u.btn('▶ 실행'));
      expect(gate().disabled).toBe(true);
      expect(u.el.querySelector('[data-report-reason]')!.textContent).toContain('실행 중에는');
      await u.click(u.btn('끝까지'));
    } finally {
      clock.restore();
    }

    expect(u.el.querySelector('[data-run-status]')!.getAttribute('data-run-status')).toBe('completed');
    expect(gate().disabled).toBe(false);
    expect(u.el.querySelector('[data-report-reason]')).toBeNull();
    const bar = u.el.querySelector('.statusbar')!.textContent;
    expect(bar).toContain('rev 1');
    expect(bar).toContain('Undo 0');

    await u.click(gate());
    const kinds = [...document.body.querySelectorAll('[data-report-kind]')].map((b) => b.getAttribute('data-report-kind'));
    expect(kinds).toEqual(['html', 'steps', 'log']);
    expect(document.body.textContent).toContain('HTML 보고서');
    expect(document.body.textContent).toContain('단계 표 CSV');
    expect(document.body.textContent).toContain('로그 CSV');
    for (const kind of kinds) {
      await u.click(document.body.querySelector(`[data-report-kind="${kind}"]`));
      if (kind !== 'log') await u.click(gate());
    }
    await act(async () => { await Promise.all(pending); });
    expect(files.map((f) => f.name.replace(/_\d{8}-\d{4}/, '_STAMP'))).toEqual([
      '조립_라인_01_5공정_예제_실행결과_STAMP.html',
      '조립_라인_01_5공정_예제_실행결과_단계_STAMP.csv',
      '조립_라인_01_5공정_예제_실행결과_로그_STAMP.csv',
    ]);
    expect(u.el.querySelector('.statusbar')!.textContent).toBe(bar);

    const html = files[0].text;
    expect(html).toContain(RUN_REPORT_LIMIT);
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/<link\b/i);
    const cycle = u.el.querySelector('[data-cycle-time]')!.textContent;
    const throughput = u.el.querySelector('[data-throughput]')!.textContent;
    const total = u.el.querySelector('.run-summary-head')!.textContent;
    expect(html).toContain(cycle);
    expect(html).toContain(throughput);
    expect(html).toContain('12 / 12');
    expect(total).toContain('12 / 12');

    const csv = parseCsv(files[1].text);
    expect(csv[0]).toEqual([...STEP_HEADERS]);
    const dom = [...u.el.querySelectorAll('.run-summary-table tbody tr')].map((tr) => {
      const td = [...tr.querySelectorAll('td')];
      return [
        (td[0].textContent ?? '').replace('가장 김', '').trim(),
        td[1].textContent ?? '',
        td[2].querySelector('.status-word')!.textContent ?? '',
        td[3].textContent ?? '',
        td[4].textContent ?? '',
        td[5].textContent ?? '',
      ];
    });
    expect(csv.slice(1).map((row) => [row[0].replace(/ 가장 김$/, ''), ...row.slice(1)])).toEqual(dom);

    const logCsv = parseCsv(files[2].text);
    const logDom = [...u.el.querySelectorAll('[aria-label="실행 로그"] tbody tr')]
      .map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent ?? ''))
      .filter((row) => row.length === 3);
    expect(logCsv.slice(1)).toEqual(logDom);
  });
});
