// @vitest-environment jsdom
// TURN-041 export screen. jsdom checks the controls; screenshots are taken in Chrome.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AURORA_EXPORT_DRAFT_NOTICE, buildAuroraExport, serializeAuroraExport } from '../src/model/auroraExport';
import { buildSampleProject } from '../src/model/sample';
import { App } from '../src/ui/App';
import { ExportSheet } from '../src/ui/SparseScreens';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  localStorage.clear();
  vi.restoreAllMocks();
});

async function pickFile(input: HTMLInputElement, text: string, name = 'sample.aurora-export.json') {
  const file = new File([text], name, { type: 'application/json' });
  await act(async () => {
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
  });
}

describe('TURN-041 export sheet', () => {
  it('AC7 a model that fails the run check cannot export and offers a place to fix it', async () => {
    const p = buildSampleProject();
    const step = p.sequence.steps[0];
    const action = p.actions.find((a) => a.id === step.actionId)!;
    action.duration = { ...action.duration, value: null };
    const onDownload = vi.fn();
    const onGuide = vi.fn();
    const el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => { root!.render(<ExportSheet p={p} onDownload={onDownload} onGuide={onGuide} />); });
    expect(el.textContent).toContain('실행 전 검사를 통과하지 못했습니다');
    expect(el.textContent).toContain('동작 시간 미정');
    const create = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Export 파일 만들기') as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    const go = [...el.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('화면으로 이동')) as HTMLButtonElement;
    expect(go).toBeTruthy();
    expect(go.textContent).toContain('Action');
    await act(async () => { go.click(); });
    expect(onGuide).toHaveBeenCalledTimes(1);
    expect(onDownload).not.toHaveBeenCalled();
    expect(el.querySelector('[data-model-rev]')!.getAttribute('data-model-rev')).toBe(String(p.revision));
    const core = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Core 전송') as HTMLButtonElement;
    expect(core.disabled).toBe(true);
  });

  it('AC8 AC12 the ack is required, and a bad file explains itself without touching the model', async () => {
    const p = buildSampleProject();
    const onDownload = vi.fn();
    const el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => { root!.render(<ExportSheet p={p} onDownload={onDownload} onGuide={() => {}} />); });
    const flags = el.querySelector('[data-export-flags]')!;
    const undetermined = flags.getAttribute('data-export-undetermined');
    const assumption = flags.getAttribute('data-export-assumption');
    expect(Number(undetermined)).toBeGreaterThan(0);
    expect(Number(assumption)).toBeGreaterThan(0);
    expect(flags.textContent).toContain(`미정 ${undetermined} · 가정 ${assumption} 을 표시한 채 내보내기`);
    expect(el.querySelectorAll('[data-flag="undetermined"]').length).toBe(Number(undetermined));
    expect(el.querySelectorAll('[data-flag="assumption"]').length).toBe(Number(assumption));
    const create = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Export 파일 만들기') as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    await act(async () => { create.click(); });
    expect(onDownload).not.toHaveBeenCalled();
    const box = flags.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => { box.click(); });
    expect(create.disabled).toBe(false);
    const rev = p.revision;
    await pickFile(el.querySelector('[data-export-inspect]') as HTMLInputElement, '{ not json');
    expect(el.querySelector('[data-export-error]')!.textContent).toContain('JSON 파싱 실패');
    expect(el.querySelector('[data-export-inspect-result]')).toBeNull();
    expect(p.revision).toBe(rev);
    expect(el.querySelector('[data-model-rev]')!.getAttribute('data-model-rev')).toBe(String(rev));
    await pickFile(el.querySelector('[data-export-inspect]') as HTMLInputElement, '{"format":"equipment-concept-designer/project","formatVersion":"0.3.0"}');
    expect(el.querySelector('[data-export-error]')!.textContent).toContain('형식이 다릅니다');
    expect(p.revision).toBe(rev);
  });

  it('AC11 choosing the old file shows the rename, the time, and the deleted signal', async () => {
    const p = buildSampleProject();
    p.signals.push({ id: 'SIG-EXTRA', name: '여분 신호', deviceId: p.devices[0].id, portKey: null, direction: 'in', valueType: 'bool', role: 'sensor', address: null, addressStatus: 'unassigned' });
    const text = serializeAuroraExport(buildAuroraExport(p));
    const edited = structuredClone(p);
    edited.devices[0].name = '이름변경';
    const step = edited.sequence.steps[0];
    const action = edited.actions.find((a) => a.id === step.actionId)!;
    action.duration = { ...action.duration, value: 9.5 };
    edited.signals = edited.signals.filter((s) => s.id !== 'SIG-EXTRA');
    const el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => { root!.render(<ExportSheet p={edited} onDownload={() => {}} onGuide={() => {}} />); });
    const rev = edited.revision;
    await pickFile(el.querySelector('[data-export-inspect]') as HTMLInputElement, text, '조립.aurora-export.json');
    const result = el.querySelector('[data-export-inspect-result]')!;
    const diffs = [...result.querySelectorAll('[data-diff]')];
    expect(diffs.map((d) => `${d.getAttribute('data-diff')}:${d.getAttribute('data-diff-kind')}:${d.getAttribute('data-diff-id')}:${d.getAttribute('data-diff-field')}`).sort()).toEqual([
      `changed:device:${edited.devices[0].id}:이름`,
      `changed:step:${step.id}:동작 시간`,
      'removed:signal:SIG-EXTRA:',
    ].sort());
    expect(result.textContent).toContain('삭제');
    expect(result.textContent).toContain('변경');
    expect(result.textContent).toContain('이름변경');
    expect(result.textContent).toContain('9.5');
    expect(result.textContent).toContain('SIG-EXTRA');
    expect(edited.revision).toBe(rev);
  });
});

describe('TURN-041 export screen in the app', () => {
  it('AC1 AC8 AC10 AC13 AC14 creating the file downloads it and leaves rev and undo', async () => {
    localStorage.clear();
    const urlApi = URL as unknown as { createObjectURL?: (b: Blob) => string; revokeObjectURL?: (u: string) => void };
    urlApi.createObjectURL = () => 'blob:export';
    urlApi.revokeObjectURL = () => {};
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
    const el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => { root!.render(<App />); });
    const click = async (node: Element) => { await act(async () => { (node as HTMLElement).click(); }); };
    const btn = (label: string) => [...el.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(label))!;
    await click(btn('시작하기'));
    await click(el.querySelector('.stepper [data-stepid="check"]')!);
    await click(btn('Export 미리보기'));
    expect(el.textContent).toContain(AURORA_EXPORT_DRAFT_NOTICE);
    const core = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Core 전송') as HTMLButtonElement;
    expect(core.disabled).toBe(true);
    expect(el.textContent).toContain('F8 왕복 계약 · 미구현');
    const bar = () => el.querySelector('.statusbar')!.textContent;
    const before = bar();
    expect(before).toContain('rev 1');
    expect(before).toContain('Undo 0');
    const create = btn('Export 파일 만들기') as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    await click(el.querySelector('[data-export-flags] input[type="checkbox"]')!);
    expect(create.disabled).toBe(false);
    await click(create);
    expect(names).toEqual(['조립 라인 01 (5공정 예제).aurora-export.json']);
    const created = el.querySelector('[data-export-created]')!;
    expect(created.textContent).toContain('빠진 것 0 · 다른 것 0');
    expect(created.querySelector('[data-count-kind="signal"]')!.textContent).toContain('신호');
    expect(created.querySelector('[data-diff]')).toBeNull();
    expect(bar()).toBe(before);
    expect(el.querySelector('[data-model-rev]')!.getAttribute('data-model-rev')).toBe('1');
  });
});
