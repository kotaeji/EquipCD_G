// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/ui/App';
import { PrintView } from '../src/ui/PrintView';
import { addMaterial, setFeedPattern } from '../src/model/commands';
import { buildSampleProject } from '../src/model/sample';
import { holdRuntimeClock } from './holdRuntimeClock';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
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
  const btn = (label: string) => [...el.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(label) || (b.getAttribute('aria-label') ?? '').includes(label));
  return { el, click, btn };
}

async function blurInput(input: HTMLInputElement, value: string) {
  const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  await act(async () => {
    proto?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
}

function tokenOf(el: ParentNode, mark: string): string[] {
  return [...el.querySelectorAll(`[data-mat-mark="${mark}"], [data-material-mark="${mark}"], [data-piece-kind="${mark}"], [data-mark="${mark}"]`)]
    .map((node) => node.getAttribute('data-mat-token'))
    .filter((token): token is string => !!token);
}

describe('TURN-091 kind color on the screens', () => {
  it('AC4 AC6 one definition has no kind color and no kind legend', async () => {
    const u = await mount();
    await u.click(u.el.querySelector('[data-sample-open="sample"]'));
    await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]'));
    await u.click(u.el.querySelector('#layout-tab-diagram'));
    expect(u.el.querySelector('[data-kind-legend]')).toBeNull();
    expect(u.el.querySelector('[data-mat-token]')).toBeNull();
    await u.click(u.el.querySelector('.stepper [data-stepid="sequence"]'));
    await u.click(u.btn('자재·Flow'));
    expect(u.el.querySelector('[data-mat-token]')).toBeNull();
    expect(u.el.querySelectorAll('[data-kind-legend]')).toHaveLength(0);
  });

  it('AC5 an empty mark field shows the fallback letter and stores nothing', async () => {
    const u = await mount();
    await u.click(u.el.querySelector('[data-sample-open="sample"]'));
    await u.click(u.el.querySelector('.stepper [data-stepid="sequence"]'));
    await u.click(u.btn('자재·Flow'));
    const first = u.el.querySelector('[aria-label="A 표식"]') as HTMLInputElement;
    expect(first.value).toBe('');
    expect(first.placeholder).toBe('A');
    expect(first.getAttribute('data-mark-stored')).toBe('');
    await u.click(u.el.querySelector('[aria-label="자재 정의 추가"]'));
    const second = u.el.querySelector('[aria-label="B 표식"]') as HTMLInputElement;
    expect(second.value).toBe('B');
    await blurInput(second, '');
    const cleared = u.el.querySelector('[aria-label="B 표식"]') as HTMLInputElement;
    expect(cleared.value).toBe('');
    expect(cleared.placeholder).toBe('B');
    expect(cleared.getAttribute('data-mark-stored')).toBe('');
    expect(u.el.querySelector('[data-material-mark="B"]')?.getAttribute('data-mat-token')).toBe('--mat-2');
    expect(u.el.querySelector('[data-material-mark="B"]')?.getAttribute('data-mat-pattern')).toBe('hatch');
  });

  it('AC1 AC3 AC4 two to four kinds share a token, and the legend appears only then', async () => {
    const u = await mount();
    await u.click(u.el.querySelector('[data-sample-open="sample"]'));
    await u.click(u.el.querySelector('.stepper [data-stepid="sequence"]'));
    await u.click(u.btn('자재·Flow'));
    const add = () => u.el.querySelector('[aria-label="자재 정의 추가"]') as HTMLButtonElement;
    await u.click(add());
    await u.click(add());
    await u.click(add());
    const rows = [...u.el.querySelectorAll('[data-material-def]')];
    expect(rows.map((row) => row.getAttribute('data-mat-token'))).toEqual(['--mat-1', '--mat-2', '--mat-3', '--mat-4']);
    expect(rows.map((row) => row.getAttribute('data-mat-pattern'))).toEqual(['solid', 'hatch', 'dots', 'lines']);
    expect(new Set(rows.map((row) => row.getAttribute('data-mat-pattern'))).size).toBe(4);
    await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]'));
    await u.click(u.el.querySelector('#layout-tab-diagram'));
    const legend = [...u.el.querySelectorAll('[data-kind-legend]')];
    expect(legend.map((row) => row.getAttribute('data-kind-legend'))).toEqual(['A', 'B', 'C', 'D']);
    expect(legend.map((row) => row.querySelector('[data-mat-token]')?.getAttribute('data-mat-token'))).toEqual(['--mat-1', '--mat-2', '--mat-3', '--mat-4']);
    await u.click(u.el.querySelector('.stepper [data-stepid="sequence"]'));
    await u.click(u.btn('자재·Flow'));
    await u.click(u.el.querySelector('[aria-label="D 정의 삭제"]'));
    await u.click(u.el.querySelector('.modal-actions button.danger'));
    await u.click(u.el.querySelector('[aria-label="C 정의 삭제"]'));
    await u.click(u.el.querySelector('.modal-actions button.danger'));
    await blurInput(u.el.querySelector('[aria-label="자재 화면 투입 개수"]') as HTMLInputElement, '6');
    await blurInput(u.el.querySelector('[aria-label="투입 순서"]') as HTMLInputElement, 'A, A, B');
    expect(u.el.querySelector('[data-feed-slot="A"]')?.getAttribute('data-mat-token')).toBe('--mat-1');
    expect(u.el.querySelector('[data-feed-slot="B"]')?.getAttribute('data-mat-token')).toBe('--mat-2');
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]'));
    await blurInput(u.el.querySelector('[aria-label="투입 간격"]') as HTMLInputElement, '0');
    const clock = holdRuntimeClock();
    try {
      await u.click(u.btn('▶ 실행'));
      const live = [...u.el.querySelectorAll('.rf-mat[data-mat-token]')];
      expect(live.some((node) => node.getAttribute('data-mark') === 'A' && node.getAttribute('data-mat-token') === '--mat-1' && node.getAttribute('data-mat-pattern') === 'solid')).toBe(true);
      await u.click(u.el.querySelector('[aria-label="실행 보기"] [aria-checked="false"]'));
      const scene = u.el.querySelector('[data-scene-kind]')?.getAttribute('data-scene-kind') ?? '';
      expect(scene).toContain('--mat-1');
      await u.click(u.btn('끝까지'));
    } finally { clock.restore(); }
    await u.click(u.el.querySelector('[aria-label="자세히 펼치기"]'));
    const pieceA = tokenOf(u.el.querySelector('[aria-label="개체별 시간"]')!, 'A');
    const pieceB = tokenOf(u.el.querySelector('[aria-label="개체별 시간"]')!, 'B');
    expect(pieceA.length).toBeGreaterThan(0);
    expect(new Set(pieceA)).toEqual(new Set(['--mat-1']));
    expect(new Set(pieceB)).toEqual(new Set(['--mat-2']));
    const summary = u.el.querySelector('.run-summary [data-kind-summary]')!;
    expect(summary.textContent).toContain('종류 A');
    expect(summary.textContent).toContain('종류 B');
    expect(summary.querySelector('[data-mat-mark="A"]')?.getAttribute('data-mat-token')).toBe('--mat-1');
    expect(summary.querySelector('[data-mat-mark="B"]')?.getAttribute('data-mat-pattern')).toBe('hatch');
    const strip = u.el.querySelector('.run-strip [data-kind-summary]')!;
    expect(strip.querySelector('[data-mat-mark="A"]')?.getAttribute('data-mat-token')).toBe('--mat-1');
    await u.click(u.btn('타이밍 차트'));
    expect(u.el.querySelectorAll('.timing-legend [data-kind-legend]')).toHaveLength(2);
    await u.click(u.el.querySelector('[data-timing-lane="piece"]'));
    const rowsA = [...u.el.querySelectorAll('[data-timing-row][data-mat-mark="A"]')];
    const rowsB = [...u.el.querySelectorAll('[data-timing-row][data-mat-mark="B"]')];
    expect(rowsA.length).toBeGreaterThan(0);
    expect(rowsA.every((row) => row.getAttribute('data-mat-token') === '--mat-1')).toBe(true);
    expect(rowsB.every((row) => row.getAttribute('data-mat-token') === '--mat-2' && row.getAttribute('data-mat-pattern') === 'hatch')).toBe(true);
  });

  it('AC4 the print sheet lists kinds only when two or more are defined', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(<PrintView project={buildSampleProject()} onClose={() => {}} />); });
    expect(document.querySelector('[data-kind-legend]')).toBeNull();
    const added = addMaterial(buildSampleProject(), () => 'MAT-B');
    if (!added.ok) throw new Error(added.reason);
    const ordered = setFeedPattern(added.project, [added.project.materials[0].id, 'MAT-B']);
    if (!ordered.ok) throw new Error(ordered.reason);
    await act(async () => { root!.render(<PrintView project={ordered.project} onClose={() => {}} />); });
    const lines = [...document.querySelectorAll('[data-kind-legend] [data-mat-token]')];
    expect(lines.map((node) => node.getAttribute('data-mat-token'))).toEqual(['--mat-1', '--mat-2']);
    expect(lines.map((node) => node.getAttribute('data-mat-mark'))).toEqual(['A', 'B']);
    expect(lines.map((node) => node.getAttribute('data-mat-pattern'))).toEqual(['solid', 'hatch']);
  });
});
