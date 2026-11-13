// @vitest-environment jsdom
// TURN-018 run summary. jsdom, not a browser.
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/ui/App';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  document.head.querySelectorAll('style').forEach((s) => s.remove());
  localStorage.clear();
});

async function mount() {
  localStorage.clear();
  const css = document.createElement('style');
  css.textContent = `${readFileSync('src/ui/styles.css', 'utf8')}\n${readFileSync('src/ui/run-summary.css', 'utf8')}`;
  document.head.appendChild(css);
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(<App />); });
  const click = async (node: Element) => { await act(async () => { (node as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
  const btn = (label: string) => [...el.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label) as HTMLButtonElement;
  await click(btn('시작하기'));
  await click(el.querySelector('.stepper [data-stepid="run"]')!);
  return { el, click, btn };
}

function summaryOf(el: ParentNode) {
  return el.querySelector('.run-summary') as HTMLDetailsElement;
}

function logTable(el: ParentNode) {
  return [...el.querySelectorAll('table.grid')].find((t) => (t.querySelector('th')?.textContent ?? '') === '가상 시각') as HTMLTableElement;
}

describe('TURN-018 run summary UI', () => {
  it('AC4 before a run, and again after reset, only the empty note is shown', async () => {
    const u = await mount();
    const box = summaryOf(u.el);
    expect(box).not.toBeNull();
    expect(box.open).toBe(true);
    expect(box.querySelector('summary')!.textContent).toBe('실행 결과 요약');
    expect(box.querySelector('.run-summary-empty')!.textContent).toBe('실행하면 단계별 시간이 여기에 나옵니다');
    expect(box.querySelector('table')).toBeNull();
    expect(logTable(u.el).textContent).toContain('로그 없음');

    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
    try {
      await u.click(u.btn('▶ 실행'));
      await u.click(u.btn('끝까지'));
    } finally {
      globalThis.requestAnimationFrame = raf;
    }
    expect(summaryOf(u.el).querySelector('table')).not.toBeNull();
    await u.click(u.btn('⟲ 초기화'));
    const again = summaryOf(u.el);
    expect(again.querySelector('.run-summary-empty')!.textContent).toBe('실행하면 단계별 시간이 여기에 나옵니다');
    expect(again.querySelector('table')).toBeNull();
    expect(logTable(u.el).textContent).toContain('로그 없음');
  });

  it('AC5 the summary sits above the log, names the longest step in words, and states the assumption', async () => {
    const u = await mount();
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
    try {
      await u.click(u.btn('▶ 실행'));
      await u.click(u.btn('끝까지'));
    } finally {
      globalThis.requestAnimationFrame = raf;
    }
    const box = summaryOf(u.el);
    const log = logTable(u.el);
    expect(box.compareDocumentPosition(log) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(box.querySelector('.run-summary-head')!.textContent).toBe('총 00:11.100 · 12 / 12 단계 · 가장 긴 단계 S3 가공 실린더 전진(가상 작업) 00:02.000');
    const longest = box.querySelector('tr.is-longest')!;
    expect(longest.textContent).toContain('가장 김');
    expect(longest.textContent).toContain('S3 가공 실린더 전진(가상 작업)');
    expect(longest.textContent).toContain('완료');
    expect(longest.textContent).toContain('00:02.000');
    expect(box.querySelectorAll('tbody tr')).toHaveLength(12);
    expect(box.querySelector('.run-summary-note')!.textContent).toBe('가정 시간 기준 · 실제 택트가 아닙니다');
    expect(log.textContent).toContain('RUN_COMPLETE');
    const css = readFileSync('src/ui/run-summary.css', 'utf8');
    expect(css).toMatch(/max-width:\s*100%/);
    expect(css).toMatch(/background:\s*var\(--selected\)/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it('AC2 a timeout shows 오류로 중단, the error step, and later steps still waiting', async () => {
    const u = await mount();
    const fault = [...u.el.querySelectorAll('select')].find((s) => (s.textContent ?? '').includes('완료 신호 미발생')) as HTMLSelectElement;
    const opt = [...fault.options].find((o) => (o.textContent ?? '').includes('S2 바코드'))!;
    await act(async () => {
      fault.value = opt.value;
      fault.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
    try {
      await u.click(u.btn('▶ 실행'));
      await u.click(u.btn('끝까지'));
    } finally {
      globalThis.requestAnimationFrame = raf;
    }
    const box = summaryOf(u.el);
    expect(box.querySelector('.run-summary-head')!.textContent).toBe('오류로 중단 총 00:03.100 · 3 / 12 단계 · 가장 긴 단계 S2 바코드 읽기 00:02.000');
    const rows = [...box.querySelectorAll('tbody tr')];
    expect(rows[2].textContent).toContain('오류');
    expect(rows[2].textContent).toContain('00:03.100');
    expect(rows.slice(3).every((row) => (row.textContent ?? '').includes('대기'))).toBe(true);
    expect(logTable(u.el).textContent).toContain('TIMEOUT');
  });
});
