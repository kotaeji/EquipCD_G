// @vitest-environment jsdom
// TURN-068. Shared table rules and stacked notices. jsdom, not a browser.
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/ui/App';
import { STATUS } from '../src/ui/status';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  vi.useRealTimers();
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  document.head.querySelectorAll('style').forEach((node) => node.remove());
  localStorage.clear();
});

const tableCss = () => `${readFileSync('src/ui/styles.css', 'utf8')}\n${readFileSync('src/ui/data-table.css', 'utf8')}\n${readFileSync('src/ui/notice-stack.css', 'utf8')}`;

async function mount() {
  document.body.innerHTML = '';
  localStorage.clear();
  const css = document.createElement('style');
  css.textContent = tableCss();
  document.head.appendChild(css);
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(<App />); });
  const click = async (node: Element | null | undefined) => {
    if (!node) throw new Error('missing control');
    await act(async () => { (node as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  };
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((item) => (item.textContent ?? '').trim() === label) as HTMLButtonElement | undefined;
  return { el, click, btn };
}

async function leaveHome(u: Awaited<ReturnType<typeof mount>>) {
  await u.click(u.btn('시작하기'));
}

async function undoKey() {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  });
}

function tableByHead(el: ParentNode, head: string) {
  return [...el.querySelectorAll('table')].find((table) => [...table.querySelectorAll('th')].some((th) => (th.textContent ?? '').trim() === head)) as HTMLTableElement | undefined;
}

describe('TURN-068 tables', () => {
  it('AC1 AC2 the listed tables share one class, one row height, numeric columns, a sticky head, and clipped text', async () => {
    const u = await mount();
    await leaveHome(u);
    await u.click(u.el.querySelector('.stepper [data-stepid="sequence"]'));
    const flow = u.el.querySelector('table[aria-label="Station 흐름"]') as HTMLTableElement;
    const steps = tableByHead(u.el, '#')!;
    expect(flow.classList.contains('ecd-table')).toBe(true);
    expect(steps.classList.contains('ecd-table')).toBe(true);
    const flowHead = flow.querySelector('th')!;
    const stepHead = steps.querySelector('th')!;
    expect(getComputedStyle(flowHead).height).toBe(getComputedStyle(stepHead).height);
    expect(getComputedStyle(flowHead).position).toBe('sticky');
    expect(getComputedStyle(stepHead).textAlign).toBe('right');
    expect(getComputedStyle(stepHead).fontVariantNumeric).toContain('tabular-nums');
    const box = steps.querySelector('td.ecd-num')!;
    expect(getComputedStyle(box).textAlign).toBe('right');

    const row = flow.querySelector('tbody tr')!;
    await u.click(row.querySelector('input[type="checkbox"]'));
    expect(row.classList.contains('is-picked')).toBe(true);
    expect(readFileSync('src/ui/data-table.css', 'utf8')).toMatch(/tr\.is-picked\s*\{[^}]*outline:\s*2px solid var\(--accent\)/);
    const clip = flow.querySelector('.ecd-clip')!;
    expect(clip.getAttribute('title')).toBe(clip.textContent);
    expect(getComputedStyle(clip).textOverflow).toBe('ellipsis');
    expect(getComputedStyle(clip).whiteSpace).toBe('nowrap');

    await u.click(u.el.querySelector('.stepper [data-stepid="check"]'));
    await u.click(u.btn('재분석'));
    const gap = tableByHead(u.el, '근거')!;
    expect(gap.classList.contains('ecd-table')).toBe(true);
    const evidence = [...gap.querySelectorAll('.ecd-clip')].find((node) => (node.textContent ?? '').length > 24)!;
    expect(evidence.getAttribute('title')).toBe(evidence.textContent);
    expect(getComputedStyle(gap.querySelector('th')!).position).toBe('sticky');

    await u.click(u.btn('진단·저장·AML'));
    const diag = tableByHead(u.el, '진단')!;
    expect(diag.classList.contains('ecd-table')).toBe(true);
    expect(diag.querySelector('.ecd-clip')!.getAttribute('title')).toBe(diag.querySelector('.ecd-clip')!.textContent);

    await u.click(u.el.querySelector('.stepper [data-stepid="library"]'));
    await u.click(u.btn('입력 후보표 (F1)'));
    const candidates = tableByHead(u.el, '후보 ID')!;
    expect(candidates.classList.contains('ecd-table')).toBe(true);
    expect(getComputedStyle(candidates.querySelector('th')!).height).toBe(getComputedStyle(flowHead).height);

    await u.click(u.el.querySelector('.stepper [data-stepid="check"]'));
    await u.click(u.btn('Evolution Lab (F7)'));
    await u.click(u.btn('안 추가'));
    await u.click(u.btn('모두 실행'));
    const lab = u.el.querySelector('table[aria-label="가동 조건 비교"]')!;
    expect(lab.classList.contains('ecd-table')).toBe(true);
    const labNum = lab.querySelector('td.ecd-num')!;
    expect(getComputedStyle(labNum).textAlign).toBe('right');
    expect(getComputedStyle(labNum).fontVariantNumeric).toContain('tabular-nums');
    expect(lab.querySelector('.ecd-clip')!.getAttribute('title')).toBe(lab.querySelector('.ecd-clip')!.textContent);

    await u.click(u.btn('파일 묶음'));
    const bundle = tableByHead(u.el, '저장 시각')!;
    expect(bundle.classList.contains('ecd-table')).toBe(true);
    expect(getComputedStyle(bundle.querySelector('th.ecd-num')!).textAlign).toBe('right');
    expect(getComputedStyle(bundle.querySelector('th')!).height).toBe(getComputedStyle(flowHead).height);

    const css = readFileSync('src/ui/data-table.css', 'utf8');
    expect(css).toMatch(/height:\s*var\(--sp-6\)/);
    expect(css).toMatch(/padding:\s*var\(--sp-1\) var\(--sp-2\)/);
    expect(css).toContain('position: sticky');
    expect(css).toContain('text-overflow: ellipsis');
  });

  it('AC1 the substation step table uses the same class and right-aligns the time column', async () => {
    const u = await mount();
    await u.click(u.el.querySelector('[data-sample-open="parallel"]'));
    await u.click(u.el.querySelector('.stepper [data-stepid="sequence"]'));
    await u.click([...u.el.querySelectorAll('.subtabs button')].find((item) => (item.textContent ?? '').includes('Substation 시퀀스')));
    const sub = tableByHead(u.el, '시간')!;
    expect(sub.classList.contains('ecd-table')).toBe(true);
    expect(getComputedStyle(sub.querySelector('th.ecd-num')!).textAlign).toBe('right');
    expect(getComputedStyle(sub.querySelector('td.ecd-num')!).fontVariantNumeric).toContain('tabular-nums');
    expect(getComputedStyle(sub.querySelector('th')!).height).toBe('var(--sp-6)');
    expect(sub.querySelector('.ecd-clip')!.getAttribute('title')).toBe(sub.querySelector('.ecd-clip')!.textContent);
  });

  it('AC1 the run summary uses the same class and right-aligns times', async () => {
    const u = await mount();
    await leaveHome(u);
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]'));
    await u.click(u.btn('자세히'));
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
    try {
      await u.click(u.btn('▶ 실행'));
      await u.click(u.btn('끝까지'));
    } finally {
      globalThis.requestAnimationFrame = raf;
    }
    const table = u.el.querySelector('.run-summary-table') as HTMLTableElement;
    expect(table.classList.contains('ecd-table')).toBe(true);
    const time = table.querySelector('td.ecd-num')!;
    expect(getComputedStyle(time).textAlign).toBe('right');
    expect(getComputedStyle(time).fontVariantNumeric).toContain('tabular-nums');
    expect(table.querySelector('.ecd-clip')!.getAttribute('title')).toBe(table.querySelector('.ecd-clip')!.textContent);
    expect(getComputedStyle(table.querySelector('th')!).height).toBe('var(--sp-6)');
  });
});

describe('TURN-068 notices', () => {
  it('AC4 AC5 AC6 kinds stack to 3, a rejection waits, and the log keeps 20 for this session', async () => {
    const u = await mount();
    await leaveHome(u);
    await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]'));
    await u.click(u.btn('물류 연결'));
    await u.click(u.el.querySelector('.station-card'));
    const info = u.el.querySelector('[data-toast-kind="info"]')!;
    expect(info.getAttribute('role')).toBe('status');
    expect(info.querySelector('.status-word')!.textContent).toBe('정보');
    expect(info.querySelector('.status-sym')!.textContent).toBe(STATUS.pending.mark);
    expect(info.querySelector('.toast')!.textContent).toBe('물류 연결: 도착 Unit을 클릭하세요');

    await u.click(u.el.querySelector('.stepper [data-stepid="check"]'));
    await u.click(u.btn('재분석'));
    const success = u.el.querySelector('[data-toast-kind="success"]')!;
    expect(success.getAttribute('role')).toBe('status');
    expect(success.querySelector('.status-word')!.textContent).toBe('성공');
    expect(success.querySelector('.status-sym')!.textContent).toBe(STATUS.done.mark);
    expect(success.querySelector('.toast')!.textContent).toContain('재분석 완료');

    await undoKey();
    const reject = u.el.querySelector('[data-toast-kind="reject"]')!;
    expect(reject.getAttribute('role')).toBe('alert');
    expect(reject.querySelector('.status-word')!.textContent).toBe('거절');
    expect(reject.querySelector('.status-sym')!.textContent).toBe(STATUS.error.mark);
    expect(reject.querySelector('.toast')!.textContent).toBe('되돌릴 편집이 없습니다');
    expect(reject.classList.contains('toast')).toBe(false);
    expect(reject.querySelector('.toast.err')).not.toBeNull();
    expect(u.el.querySelectorAll('.toast-card').length).toBe(3);

    await undoKey();
    expect(u.el.querySelectorAll('.toast-card').length).toBe(3);
    expect(u.el.querySelector('[data-toast-kind="info"]')).toBeNull();
    expect(u.el.querySelector('[data-toast-stack]')!.getAttribute('data-toast-stack')).toBe('3');

    await u.click(u.el.querySelector('[aria-label="알림 닫기"]'));
    expect(u.el.querySelectorAll('.toast-card').length).toBe(2);
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(u.el.querySelectorAll('.toast-card').length).toBe(1);

    const next = [...u.el.querySelectorAll('.statusbar button')].find((item) => (item.textContent ?? '').includes('다음 단계'))!;
    const stack = u.el.querySelector('.toast-stack')!;
    expect(stack.contains(next)).toBe(false);
    expect(getComputedStyle(stack).position).toBe('fixed');
    expect(getComputedStyle(stack).left).toBe('var(--sp-4)');
    expect(getComputedStyle(stack).bottom).toBe('calc(var(--sp-6) + var(--sp-4) + var(--sp-2))');
    const css = readFileSync('src/ui/notice-stack.css', 'utf8');
    expect(css).toMatch(/\.toast-stack\s*\{[^}]*left:\s*var\(--sp-4\)/);
    expect(css).toMatch(/bottom:\s*calc\(var\(--sp-6\) \+ var\(--sp-4\) \+ var\(--sp-2\)\)/);
    expect(css).not.toMatch(/\.toast-stack\s*\{[^}]*\bright\s*:/);

    await u.click(u.el.querySelector('[data-notice-button]'));
    const log = u.el.querySelector('[aria-label="알림 이력"]')!;
    const rows = [...log.querySelectorAll('li')];
    expect(rows.length).toBe(4);
    for (const row of rows) {
      const clock = row.querySelector('time')!;
      expect(clock.textContent).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \(UTC(?:[+-]\d{1,2}(?::\d{2})?)?\)$/);
      expect(clock.getAttribute('title')).toBe(clock.getAttribute('dateTime'));
      expect(clock.getAttribute('title')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
    expect(rows.some((row) => row.textContent?.includes('재분석 완료'))).toBe(true);
    expect(rows.some((row) => row.textContent?.includes('되돌릴 편집이 없습니다'))).toBe(true);

    const keysBefore = Object.keys(localStorage);
    for (let i = 0; i < 21; i++) await undoKey();
    expect(u.el.querySelectorAll('.toast-card').length).toBe(3);
    expect(u.el.querySelectorAll('[aria-label="알림 이력"] li').length).toBe(20);
    expect(Object.keys(localStorage).some((key) => /notice|toast/i.test(key))).toBe(false);
    expect(Object.keys(localStorage)).toEqual(keysBefore);

    await act(async () => { root!.unmount(); });
    root = createRoot(u.el);
    await act(async () => { root!.render(<App />); });
    await u.click(u.el.querySelector('[data-notice-button]'));
    expect(u.el.querySelector('[aria-label="알림 이력"]')!.textContent).toContain('이번 세션의 알림이 없습니다');
    expect(u.el.querySelector('.toast-card')).toBeNull();
  });

  it('AC5 a rejection stays through 3 seconds and leaves at 8 seconds', async () => {
    vi.useFakeTimers();
    const u = await mount();
    await undoKey();
    expect(u.el.querySelector('[data-toast-kind="reject"]')).not.toBeNull();
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(u.el.querySelector('[data-toast-kind="reject"]')).not.toBeNull();
    await act(async () => { vi.advanceTimersByTime(4999); });
    expect(u.el.querySelector('[data-toast-kind="reject"]')).not.toBeNull();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(u.el.querySelector('[data-toast-kind="reject"]')).toBeNull();
  });
});
