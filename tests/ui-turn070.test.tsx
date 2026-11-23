// @vitest-environment jsdom
// TURN-070: confirmer name, confirmation log table, and the note beside a confirmed value.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { History } from '../src/model/history';
import { App } from '../src/ui/App';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  localStorage.clear();
});

async function mount() {
  localStorage.clear();
  const el = document.createElement('div');
  document.body.appendChild(el);
  const seen: { h: History | null } = { h: null };
  root = createRoot(el);
  await act(async () => { root!.render(<App onHistory={(h) => { seen.h = h; }} />); });
  const click = async (node: Element | null) => { await act(async () => { (node as HTMLElement).click(); }); };
  const btn = (label: string) => [...el.querySelectorAll('button')].find((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim() === label) as HTMLButtonElement;
  const type = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
      const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      proto?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  await click(el.querySelector('[data-sample-open="sample"]'));
  return { el, click, btn, type, history: () => seen.h!, project: () => seen.h!.present };
}

describe('TURN-070 confirmation UI', () => {
  it('AC1 asks for a name the first time and lets 보기 설정 change it', async () => {
    const u = await mount();
    await u.click(u.el.querySelector('[data-stepid="attributes"] button.st-go'));
    const box = u.el.querySelector('.form-grid input[type="checkbox"]') as HTMLInputElement;
    expect(box.checked).toBe(true);
    await u.click(box);
    const ask = u.el.querySelector('[data-confirmer-dialog]');
    expect(ask?.textContent).toContain('프로젝트 파일');
    expect(ask?.textContent).toContain('로그인이나 인증은 없습니다');
    expect(u.project().confirmationLog).toBeUndefined();
    const input = u.el.querySelector('[data-confirmer-input]') as HTMLInputElement;
    await u.type(input, '김검토');
    await u.click(u.btn('이 이름으로 확인'));
    expect(u.project().confirmationLog?.[0].by).toBe('김검토');
    expect(u.project().confirmationLog?.[0].from).toBe('가정');
    expect(u.project().confirmationLog?.[0].to).toBe('확인');

    await u.click(u.btn('보기 설정'));
    const name = u.el.querySelector('[data-confirmer-name]') as HTMLInputElement;
    expect(name.value).toBe('김검토');
    await u.type(name, '이검토');
    await u.click(u.btn('닫기'));
    const interlock = u.el.querySelector('[aria-label="IL-01 확인"]') as HTMLButtonElement;
    await u.click(interlock);
    expect(u.el.querySelector('[data-confirmer-dialog]')).toBeNull();
    expect(u.project().confirmationLog?.map((e) => e.by)).toEqual(['김검토', '이검토']);
  });

  it('AC5 lists rows in time order, 이동 opens the target, and a deleted target says 삭제됨', async () => {
    const u = await mount();
    await u.click(u.btn('보기 설정'));
    await u.type(u.el.querySelector('[data-confirmer-name]') as HTMLInputElement, '김검토');
    await u.click(u.btn('닫기'));
    await u.click(u.el.querySelector('[data-stepid="attributes"] button.st-go'));
    const box = u.el.querySelector('.form-grid input[type="checkbox"]') as HTMLInputElement;
    await u.click(box);
    await u.click(u.el.querySelector('[aria-label="IL-01 확인"]'));
    await u.click(u.el.querySelector('[data-stepid="check"] button.st-go'));
    await u.click(u.btn('진단·저장·AML'));
    const rows = [...u.el.querySelectorAll('[data-confirmation-log] tbody tr')];
    expect(rows).toHaveLength(2);
    const times = rows.map((r) => r.getAttribute('data-confirmation-at') ?? '');
    expect(times[0] <= times[1]).toBe(true);
    expect(rows[0].textContent).toContain('가정 → 확인');
    expect(rows[1].textContent).toContain('미확인 → 확인됨');
    await u.click(rows[0].querySelector('button'));
    expect(u.el.querySelector('[data-stepid="attributes"]')?.classList.contains('on')).toBe(true);
    expect(u.el.querySelector('.jump-flash, [data-jump^="prop:"]')).toBeTruthy();

    await u.click(u.btn('삭제 영향 확인'));
    await u.click(u.btn('참조 해제 후 삭제'));
    await u.click(u.el.querySelector('[data-stepid="check"] button.st-go'));
    await u.click(u.btn('진단·저장·AML'));
    const again = [...u.el.querySelectorAll('[data-confirmation-log] tbody tr')];
    expect(again[0].querySelector('[data-confirmation-gone]')?.textContent).toBe('삭제됨');
    expect(again[0].textContent).not.toContain('이동');
    expect(again[1].textContent).toContain('이동');
  });

  it('AC6 shows the confirmer and date beside the confirmed value', async () => {
    const u = await mount();
    await u.click(u.btn('보기 설정'));
    await u.type(u.el.querySelector('[data-confirmer-name]') as HTMLInputElement, '박확인');
    await u.click(u.btn('닫기'));
    await u.click(u.el.querySelector('[data-stepid="attributes"] button.st-go'));
    const label = [...u.el.querySelectorAll('.form-grid label')].find((node) => node.querySelector('input[type="checkbox"]')) as HTMLElement;
    await u.click(label.querySelector('input[type="checkbox"]'));
    const note = label.querySelector('[data-confirm-note]');
    expect(note?.textContent).toMatch(/^확인: 박확인 · \d{4}-\d{2}-\d{2}$/);
  });
});
