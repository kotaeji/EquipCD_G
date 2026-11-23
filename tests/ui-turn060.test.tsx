// @vitest-environment jsdom
// TURN-060: XLSX intake. jsdom, not a browser.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ExtractSheet } from '../src/ui/SparseScreens';
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

async function pick(input: HTMLInputElement, bytes: Uint8Array, name: string) {
  const file = new File([Uint8Array.from(bytes)], name);
  await act(async () => {
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

async function setSelect(select: HTMLSelectElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
  await act(async () => {
    set.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function setNumber(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

const sample = new Uint8Array(readFileSync(join(process.cwd(), 'docs/samples/io-list-5step.xlsx')));

function btn(el: ParentNode, label: string) {
  return [...el.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement;
}

describe('TURN-060 XLSX intake screen', () => {
  it('AC12 shows XLSX as supported and the other formats as unimplemented', async () => {
    const el = await mount(<ExtractSheet />);
    expect(el.querySelector('.not-ready')).toBeNull();
    expect(el.textContent).not.toContain('준비 중');
    const status = (name: string) => el.querySelector(`[data-format="${name}"]`)!.textContent;
    expect(status('XLSX')).toContain('지원(IO 리스트 · 사양표)');
    expect(status('PDF')).toContain('추출 미구현');
    expect(status('DWG')).toContain('추출 미구현');
    expect(status('USD')).toContain('추출 미구현');
  });

  it('AC1 AC3 loads the sample, guesses columns, and blocks progress without a device column', async () => {
    const el = await mount(<ExtractSheet p={buildSampleProject()} onCandidates={() => true} />);
    await pick(el.querySelector('input[type="file"]') as HTMLInputElement, sample, 'io-list-5step.xlsx');
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect([...el.querySelectorAll('[data-xlsx-sheet]')].map((b) => b.textContent)).toEqual(['IO', '참고']);
    expect(el.querySelector('[data-xlsx-preview]')!.textContent).toContain('PSH-01');
    expect(el.querySelector('[data-xlsx-preview]')!.textContent).toContain('Unit');
    const header = el.querySelector('input[aria-label="머리 줄"]') as HTMLInputElement;
    expect(header.value).toBe('1');
    expect(el.querySelectorAll('[data-guessed="true"]').length).toBeGreaterThan(0);
    expect(el.textContent).toContain('추측');
    const make = btn(el, '후보 만들기');
    expect(make.disabled).toBe(false);
    const device = el.querySelector('select[aria-label="B 열 역할"]') as HTMLSelectElement;
    expect(device.value).toBe('deviceName');
    await setSelect(device, 'ignore');
    expect(btn(el, '후보 만들기').disabled).toBe(true);
    expect(el.textContent).toContain('Device 이름 열을 지정해야 후보를 만들 수 있습니다.');
    await setSelect(el.querySelector('select[aria-label="B 열 역할"]') as HTMLSelectElement, 'deviceName');
    expect(btn(el, '후보 만들기').disabled).toBe(false);
    expect(el.querySelector('[data-column-index="1"]')!.getAttribute('data-guessed')).toBe('false');
    await setNumber(header, '2');
    expect(header.value).toBe('2');
    expect(el.querySelector('[data-sheet-row="2"]')!.className).toContain('is-header');
    expect(el.querySelector('[data-xlsx-preview]')!.textContent).toContain('PSH-01');
  });

  it('AC2 a file that is not an xlsx is refused and the candidate callback is not used', async () => {
    let calls = 0;
    const p = buildSampleProject();
    const el = await mount(<ExtractSheet p={p} onCandidates={() => { calls += 1; return true; }} />);
    await pick(el.querySelector('input[type="file"]') as HTMLInputElement, new TextEncoder().encode('not a sheet'), 'notes.pdf');
    const problem = el.querySelector('[role="alert"]')!;
    expect(problem.querySelector('[data-problem-what]')!.textContent).toContain('이 파일은 XLSX가 아닙니다');
    expect(problem.querySelector('[data-problem-why]')!.textContent!.length).toBeGreaterThan(0);
    expect(problem.querySelector('[data-problem-how]')!.textContent).toContain('모델과 후보표는 바꾸지 않았습니다');
    expect(calls).toBe(0);
    expect(el.querySelector('[data-xlsx-preview]')).toBeNull();
    expect(p.revision).toBe(1);
    expect(p.candidates).toHaveLength(0);
  });

  it('AC6 AC9 making candidates keeps the model and marks names that already exist', async () => {
    const p = buildSampleProject();
    const seen: Project[] = [];
    const el = await mount(<ExtractSheet p={p} onCandidates={(next) => { seen.push(next); return true; }} />);
    await pick(el.querySelector('input[type="file"]') as HTMLInputElement, sample, 'io-list-5step.xlsx');
    await act(async () => { btn(el, '매핑 확정').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(el.querySelector('[data-guessed="true"]')).toBeNull();
    await act(async () => { btn(el, '후보 만들기').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(seen).toHaveLength(1);
    const next = seen[0];
    expect(next.units.length).toBe(p.units.length);
    expect(next.devices.length).toBe(p.devices.length);
    expect(next.revision).toBe(p.revision);
    expect(next.candidates.length).toBeGreaterThan(0);
    expect(p.candidates).toHaveLength(0);
    if (root) await act(async () => { root!.unmount(); });
    root = null;
    document.body.innerHTML = '';
    const table = await mount(<InputHubPanel p={next} locked={false} edit={() => true} />);
    const dups = [...table.querySelectorAll('[data-candidate-kind="device"][data-already="true"]')];
    const cyl = dups.find((row) => row.textContent?.includes('CYL-01'));
    expect(cyl).toBeTruthy();
    expect(cyl!.textContent).toContain('이미 있음');
    expect(table.textContent).toContain('SEN-06');
    expect(table.textContent).toContain('io-list-5step.xlsx');
  });
});
