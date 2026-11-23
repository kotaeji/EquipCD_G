// @vitest-environment jsdom
// TURN-076: CSV file, pasted table, and IO-list export. jsdom, not a browser.
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ExtractSheet, ExportSheet } from '../src/ui/SparseScreens';
import { InputHubPanel } from '../src/ui/Panels';
import { buildSampleProject } from '../src/model/sample';
import type { Project } from '../src/model/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
});

async function mount(node: ReactNode) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(node); });
  return el;
}

async function pick(input: HTMLInputElement, bytes: Uint8Array, name: string, type = '') {
  const file = new File([Uint8Array.from(bytes)], name, type ? { type } : undefined);
  await act(async () => {
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

function btn(el: ParentNode, label: string) {
  return [...el.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(label)) as HTMLButtonElement;
}

const TSV = [
  'Unit\tDevice\tType\tSignal\tDirection\tAddress\tMemo',
  'S1 투입\tCYL-01\t실린더\t전진 명령\t출력\tY101\t보조',
  'S6 검사\tSEN-99\t센서\t감지\t입력\tX1\t',
].join('\n');

describe('TURN-076 intake screen', () => {
  it('lists CSV as supported next to XLSX', async () => {
    const el = await mount(<ExtractSheet />);
    expect(el.querySelector('[data-format="CSV"]')!.textContent).toContain('지원');
    expect(el.querySelector('[data-format="XLSX"]')!.textContent).toContain('지원(IO 리스트 · 사양표)');
    expect(el.querySelector('[data-format="PDF"]')!.textContent).toContain('추출 미구현');
    expect(el.querySelector('textarea[aria-label="표 붙여넣기"]')).toBeTruthy();
  });

  it('AC1 a CSV file follows the same preview, mapping, and candidate steps', async () => {
    const p = buildSampleProject();
    const seen: Project[] = [];
    const el = await mount(<ExtractSheet p={p} onCandidates={(next) => { seen.push(next); return true; }} />);
    const csv = new TextEncoder().encode('Unit,Device,Type,Signal,Direction,Address,Memo\nS1 투입,CYL-01,실린더,전진 명령,출력,Y101,보조\n');
    await pick(el.querySelector('input[type="file"]') as HTMLInputElement, csv, 'io-list.csv', 'text/csv');
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(el.querySelector('[data-xlsx-sheet]')!.textContent).toBe('CSV');
    expect(el.querySelector('[data-xlsx-preview]')!.textContent).toContain('CYL-01');
    expect(el.querySelector('[data-xlsx-preview]')!.textContent).toContain('Unit');
    const device = el.querySelector('select[aria-label="B 열 역할"]') as HTMLSelectElement;
    expect(device.value).toBe('deviceName');
    expect(el.querySelector('[data-guessed="true"]')).toBeTruthy();
    await act(async () => { btn(el, '매핑 확정').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await act(async () => { btn(el, '후보 만들기').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(seen).toHaveLength(1);
    expect(seen[0].units).toHaveLength(p.units.length);
    expect(seen[0].devices).toHaveLength(p.devices.length);
    expect(seen[0].revision).toBe(p.revision);
    expect(seen[0].candidates.some((c) => c.name === 'CYL-01' && c.alreadyExists)).toBe(true);
    expect(p.candidates).toHaveLength(0);
  });

  it('AC3 a pasted tab-separated table becomes candidates', async () => {
    const p = buildSampleProject();
    const seen: Project[] = [];
    const el = await mount(<ExtractSheet p={p} onCandidates={(next) => { seen.push(next); return true; }} />);
    const area = el.querySelector('textarea[aria-label="표 붙여넣기"]') as HTMLTextAreaElement;
    await act(async () => {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', {
        value: { getData: (type: string) => (type === 'text/plain' || type === 'text' ? TSV : '') },
      });
      area.dispatchEvent(event);
    });
    expect(area.value).toBe(TSV);
    expect(el.querySelector('[data-xlsx-sheet]')!.textContent).toBe('붙여넣기');
    expect(el.querySelector('[data-xlsx-preview]')!.textContent).toContain('SEN-99');
    expect((el.querySelector('select[aria-label="B 열 역할"]') as HTMLSelectElement).value).toBe('deviceName');
    await act(async () => { btn(el, '후보 만들기').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(seen).toHaveLength(1);
    const next = seen[0];
    expect(next.units).toHaveLength(p.units.length);
    expect(next.devices).toHaveLength(p.devices.length);
    expect(next.revision).toBe(p.revision);
    expect(next.candidates.some((c) => c.targetKind === 'device' && c.name === 'SEN-99' && !c.alreadyExists)).toBe(true);
    expect(next.candidates.some((c) => c.targetKind === 'device' && c.name === 'CYL-01' && c.alreadyExists)).toBe(true);
    expect(p.revision).toBe(1);
  });

  it('AC4 a non-UTF-8 CSV is refused and the model stays', async () => {
    const p = buildSampleProject();
    let calls = 0;
    const el = await mount(<ExtractSheet p={p} onCandidates={() => { calls += 1; return true; }} />);
    await pick(el.querySelector('input[type="file"]') as HTMLInputElement, new Uint8Array([0xb0, 0xa1, 0x2c, 0x41]), 'legacy.csv');
    const problem = el.querySelector('[role="alert"]')!;
    expect(problem.querySelector('[data-problem-what]')!.textContent).toContain('UTF-8');
    expect(problem.querySelector('[data-problem-how]')!.textContent).toContain('UTF-8 로 저장해 주세요');
    expect(problem.querySelector('[data-problem-how]')!.textContent).toContain('모델과 후보표는 바꾸지 않았습니다');
    expect(calls).toBe(0);
    expect(el.querySelector('[data-xlsx-preview]')).toBeNull();
    expect(p.revision).toBe(1);
    expect(p.candidates).toHaveLength(0);
    expect(p.units).toHaveLength(5);
  });
});

describe('TURN-076 IO list export button', () => {
  it('AC5 AC7 the candidate table downloads a CSV and does not edit the model', async () => {
    const p = buildSampleProject();
    const before = JSON.stringify(p);
    let file = '';
    let body = '';
    let mime = '';
    let edits = 0;
    const el = await mount(<InputHubPanel p={p} locked={false} edit={() => { edits += 1; return true; }} onDownload={(name, text, type) => { file = name; body = text; mime = type ?? ''; }} />);
    await act(async () => { el.querySelector<HTMLButtonElement>('[data-io-export]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(file).toMatch(/_IO리스트\.csv$/);
    expect(body.startsWith('\uFEFFUnit,코드,Device,Type,Signal,Direction,역할,Address,주소 상태,Memo')).toBe(true);
    expect(body).toContain('CYL-01');
    expect(body).toContain('미지정');
    expect(mime).toContain('text/csv');
    expect(edits).toBe(0);
    expect(JSON.stringify(p)).toBe(before);
    expect(p.revision).toBe(1);
  });

  it('step 5 offers the same export without changing revision', async () => {
    const p = buildSampleProject();
    let body = '';
    const el = await mount(<ExportSheet p={p} onDownload={(_name, text) => { body = text; }} onGuide={() => {}} />);
    expect(btn(el, 'Export 파일 만들기')).toBeTruthy();
    await act(async () => { el.querySelector<HTMLButtonElement>('[data-io-export]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(body.startsWith('\uFEFF')).toBe(true);
    expect(el.querySelector('[data-model-rev]')!.getAttribute('data-model-rev')).toBe(String(p.revision));
  });
});
