// @vitest-environment jsdom
// TURN-075: example gallery and the skeleton wizard.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { captureUnitTemplate } from '../src/model/userTemplates';
import { buildSampleProject } from '../src/model/sample';
import { formatVirtualTime, sampleCards, STARTER_NEXT } from '../src/model/starter';
import { rectsOverlap } from '../src/model/unitLayout';
import { validateProject } from '../src/model/validate';
import type { History } from '../src/model/history';
import { saveTemplate } from '../src/storage/userTemplates';
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
  const el = document.createElement('div');
  document.body.appendChild(el);
  const seen: { h: History | null } = { h: null };
  root = createRoot(el);
  await act(async () => { root!.render(<App onHistory={(h) => { seen.h = h; }} />); });
  const click = async (node: Element | null | undefined) => {
    if (!node) throw new Error('missing control');
    await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  };
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label) as HTMLButtonElement | undefined;
  const type = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const choose = async (sel: HTMLSelectElement, value: string) => {
    await act(async () => {
      sel.value = value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  return { el, click, btn, type, choose, history: () => seen.h! };
}

describe('TURN-075 gallery', () => {
  it('AC1 three cards show the description, what it demonstrates, the counts, the virtual time, and 열기 opens that example', async () => {
    const u = await mount();
    const cards = [...u.el.querySelectorAll('[data-sample-card]')];
    expect(cards.map((c) => c.getAttribute('data-sample-card'))).toEqual(['sample', 'parallel', 'flow']);
    for (const card of sampleCards()) {
      const node = u.el.querySelector(`[data-sample-card="${card.kind}"]`)!;
      expect(node.textContent).toContain(card.name);
      expect(node.textContent).toContain(card.summary);
      expect(node.textContent).toContain(card.shows);
      expect(node.textContent).toContain(`Unit ${card.units}`);
      expect(node.textContent).toContain(`Device ${card.devices}`);
      expect(node.textContent).toContain(`단계 ${card.steps}`);
      expect(node.textContent).toContain(formatVirtualTime(card.virtualMs));
      const open = node.querySelector('[data-sample-open]') as HTMLButtonElement;
      expect(open.textContent?.trim()).toBe('열기');
      expect(open.getAttribute('aria-label')).toBe(card.openLabel);
    }
    expect(u.btn('5공정 예제로 둘러보기')).toBeTruthy();
    expect(u.btn('빈 프로젝트 만들기')).toBeTruthy();
    const before = u.history().present.id;
    await u.click(u.el.querySelector('[data-sample-open="flow"]'));
    expect(u.el.querySelector('.home-main')).toBeNull();
    expect(u.history().present.name).toContain('흐름 예제');
    expect(u.history().present.id).not.toBe(before);
    expect(u.history().present.units).toHaveLength(sampleCards()[2].units);
    expect(u.history().past).toEqual([]);
  });

  it('AC7 a blank project is still empty and the tour button stays', async () => {
    const u = await mount();
    expect(u.el.querySelector('[data-tour-start]')!.textContent).toBe('5공정 예제로 둘러보기');
    await u.click(u.btn('빈 프로젝트 만들기')!);
    expect(u.history().present.units).toEqual([]);
    expect(u.history().present.devices).toEqual([]);
    expect(u.history().past).toEqual([]);
    expect(u.el.querySelector('.app')!.getAttribute('data-step')).toBe('library');
    expect(u.el.querySelector('[data-starter-next]')).toBeNull();
  });
});

describe('TURN-075 wizard', () => {
  it('AC3 AC4 the three steps build a skeleton whose counts match the preview', async () => {
    const u = await mount();
    await u.click(u.btn('뼈대부터'));
    const wiz = () => u.el.querySelector('[data-starter-wizard]')!;
    expect(wiz().getAttribute('data-starter-step')).toBe('1');
    await u.type(wiz().querySelector('[aria-label="프로젝트 이름"]') as HTMLInputElement, '시작 라인');
    await u.choose(wiz().querySelector('[aria-label="Unit 수"]') as HTMLSelectElement, '2');
    await u.type(wiz().querySelector('[aria-label="Unit 1 이름"]') as HTMLInputElement, '첫째');
    await u.type(wiz().querySelector('[aria-label="Unit 2 이름"]') as HTMLInputElement, '둘째');
    await u.click(u.btn('다음', wiz()));
    expect(wiz().getAttribute('data-starter-step')).toBe('2');
    const bundle = (wiz().querySelector('optgroup[label="번들 유닛 템플릿"] option') as HTMLOptionElement).value;
    await u.choose(wiz().querySelector('[aria-label="첫째 내용"]') as HTMLSelectElement, bundle);
    await u.choose(wiz().querySelector('[aria-label="둘째 내용"]') as HTMLSelectElement, 'empty');
    await u.click(u.btn('다음', wiz()));
    expect(wiz().getAttribute('data-starter-step')).toBe('3');
    const preview = wiz().querySelector('[data-starter-preview]')!.textContent ?? '';
    expect(preview).toMatch(/^Unit \d+ · Device \d+ · 연결 \d+$/);
    const [units, devices, connections] = [...preview.matchAll(/\d+/g)].map((m) => Number(m[0]));
    await u.click(u.btn('만들기', wiz()));
    const p = u.history().present;
    expect(p.name).toBe('시작 라인');
    expect(p.units.map((unit) => unit.name)).toEqual(['첫째', '둘째']);
    expect(p.units).toHaveLength(units);
    expect(p.devices).toHaveLength(devices);
    expect(p.connections).toHaveLength(connections);
    expect(p.materials).toEqual([]);
    expect(p.sequence.steps).toEqual([]);
    expect(u.history().past).toEqual([]);
    expect(u.el.querySelector('.app')!.getAttribute('data-step')).toBe('canvas');
    expect(u.el.querySelector('.workbar')!.textContent).toContain('저장 안 됨');
    expect(u.el.querySelector('.statusbar')!.textContent).toContain('Undo 0');
    expect(u.el.querySelector('[data-starter-next]')!.textContent).toContain(STARTER_NEXT);
    for (let i = 0; i < p.units.length; i++) for (let j = i + 1; j < p.units.length; j++) {
      expect(rectsOverlap(p.units[i].layout, p.units[j].layout)).toBe(false);
    }
    expect(validateProject(p).filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('AC5 a saved template can be chosen and the placed unit has a new id', async () => {
    const captured = captureUnitTemplate(buildSampleProject(), 'U-S2');
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    const saved = saveTemplate(localStorage, captured.captured, '보관 유닛', { id: 'tpl-kept', now: new Date('2026-11-24T00:00:00Z') });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const u = await mount();
    await u.click(u.btn('뼈대부터'));
    const wiz = () => u.el.querySelector('[data-starter-wizard]')!;
    await u.choose(wiz().querySelector('[aria-label="Unit 수"]') as HTMLSelectElement, '1');
    await u.click(u.btn('다음', wiz()));
    const mine = [...wiz().querySelectorAll('optgroup[label="내 템플릿"] option')].map((o) => o.textContent);
    expect(mine).toContain('보관 유닛');
    await u.choose(wiz().querySelector('[aria-label="S1 내용"]') as HTMLSelectElement, 'user:tpl-kept');
    await u.click(u.btn('다음', wiz()));
    await u.click(u.btn('만들기', wiz()));
    const unit = u.history().present.units[0];
    expect(unit.id).not.toBe(saved.template.unit.id);
    expect(unit.lineage?.fromTemplate?.id).toBe('tpl-kept');
    for (const d of u.history().present.devices) expect(saved.template.devices.some((src) => src.id === d.id)).toBe(false);
    expect(u.history().past).toEqual([]);
  });

  it('AC6 cancel creates nothing, and back keeps what was typed', async () => {
    const u = await mount();
    const namesBefore = u.history().present.name;
    const tabsBefore = u.el.querySelectorAll('.exitem').length;
    await u.click(u.btn('뼈대부터'));
    const wiz = () => u.el.querySelector('[data-starter-wizard]')!;
    await u.type(wiz().querySelector('[aria-label="프로젝트 이름"]') as HTMLInputElement, '만들지 않음');
    await u.type(wiz().querySelector('[aria-label="Unit 1 이름"]') as HTMLInputElement, '남길 이름');
    await u.choose(wiz().querySelector('[aria-label="Unit 수"]') as HTMLSelectElement, '2');
    await u.click(u.btn('다음', wiz()));
    await u.choose(wiz().querySelector('[aria-label="남길 이름 내용"]') as HTMLSelectElement, 'bundle:unitInput');
    await u.click(u.btn('다음', wiz()));
    const off = [...wiz().querySelectorAll('input[type="radio"]')].find((r) => r.parentElement?.textContent?.includes('끄기')) as HTMLInputElement;
    await u.click(off);
    expect(wiz().querySelector('[data-starter-preview]')!.textContent).toContain('연결');
    await act(async () => { off.dispatchEvent(new Event('change', { bubbles: true })); });
    await u.click(u.btn('뒤로', wiz()));
    expect((wiz().querySelector('[aria-label="남길 이름 내용"]') as HTMLSelectElement).value).toBe('bundle:unitInput');
    await u.click(u.btn('뒤로', wiz()));
    expect(wiz().getAttribute('data-starter-step')).toBe('1');
    expect((wiz().querySelector('[aria-label="프로젝트 이름"]') as HTMLInputElement).value).toBe('만들지 않음');
    expect((wiz().querySelector('[aria-label="Unit 1 이름"]') as HTMLInputElement).value).toBe('남길 이름');
    expect((wiz().querySelector('[aria-label="Unit 수"]') as HTMLSelectElement).value).toBe('2');
    await u.click(u.btn('취소', wiz()));
    expect(u.el.querySelector('[data-starter-wizard]')).toBeNull();
    expect(u.el.querySelector('[data-sample-gallery]')).not.toBeNull();
    expect(u.history().present.name).toBe(namesBefore);
    expect(u.el.querySelectorAll('.exitem').length).toBe(tabsBefore);
    expect(u.el.textContent).not.toContain('만들지 않음');
  });
});
