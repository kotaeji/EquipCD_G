// @vitest-environment jsdom
// TURN-057. jsdom checks the save dialog, palette, library, and a drop. Screenshots are separate.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { captureUnitTemplate, STORAGE_UNAVAILABLE } from '../src/model/userTemplates';
import { buildSampleProject } from '../src/model/sample';
import type { History } from '../src/model/history';
import { saveTemplate, TEMPLATES_INDEX_KEY, templateBodyKey } from '../src/storage/userTemplates';
import type { KV } from '../src/storage/localStore';
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
  const click = async (node: Element | undefined | null) => {
    if (!node) throw new Error('missing button');
    await act(async () => { (node as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  };
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label) as HTMLButtonElement;
  await click(btn('시작하기'));
  return { el, click, btn, history: () => seen.h! };
}

async function drag(from: Element, to: Element) {
  const dt = {
    store: {} as Record<string, string>,
    setData(type: string, value: string) { this.store[type] = value; },
    getData(type: string) { return this.store[type] ?? ''; },
  };
  const fire = async (node: Element, type: string) => {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: dt });
    await act(async () => { node.dispatchEvent(ev); });
  };
  await fire(from, 'dragstart');
  await fire(to, 'dragover');
  await fire(to, 'drop');
}

describe('TURN-057 my template UI', () => {
  it('AC1 AC2 AC3 saving does not change rev and the template shows in the palette and library', async () => {
    const u = await mount();
    await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]')!);
    const rev = u.history().present.revision;
    const past = u.history().past.length;
    const body = localStorage.getItem('ecd.v1.project.prj-sample-5step');
    await u.click(u.el.querySelector('[data-tree-id="U-S1"]')!);
    const save = u.el.querySelector('[data-save-template]') as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    await u.click(save);
    const dialog = u.el.querySelector('[aria-label="내 템플릿으로 저장"]')!;
    const input = dialog.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('S1 투입');
    expect(dialog.textContent).toContain('빠짐:');
    await u.click(u.btn('저장', dialog));
    expect(u.el.querySelector('.toast')?.textContent).toContain('빠짐:');
    expect(u.history().present.revision).toBe(rev);
    expect(u.history().past.length).toBe(past);
    expect(localStorage.getItem('ecd.v1.project.prj-sample-5step')).toBe(body);
    expect(u.el.querySelector('.palette [data-template-group="mine"]')?.textContent).toContain('내 템플릿');
    expect(u.el.querySelector('.palette [data-template-id]')?.textContent).toContain('S1 투입');
    await u.click(u.el.querySelector('.stepper [data-stepid="library"]')!);
    const group = u.el.querySelector('.my-templates')!;
    expect(group.textContent).toContain('내 템플릿');
    expect(group.textContent).toContain('S1 투입');
  });

  it('AC4 AC5 AC6 a drop in another project is one undo and is blocked while running', async () => {
    const u = await mount();
    await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]')!);
    await u.click(u.el.querySelector('[data-tree-id="U-S1"]')!);
    await u.click(u.el.querySelector('[data-save-template]')!);
    await u.click(u.btn('저장', u.el.querySelector('[aria-label="내 템플릿으로 저장"]')!));
    await u.click(u.el.querySelector('[aria-label="프로젝트 추가"]')!);
    await u.click(u.btn('빈 프로젝트'));
    expect(u.history().present.units).toHaveLength(0);
    const token = u.el.querySelector('.palette [data-template-id]')!;
    expect(token).toBeTruthy();
    const rev = u.history().present.revision;
    await drag(token, u.el.querySelector('.board-row')!);
    expect(u.history().present.units).toHaveLength(1);
    expect(u.history().present.revision).toBe(rev + 1);
    expect(u.history().past).toHaveLength(1);
    expect(u.history().present.units[0].lineage?.fromTemplate?.name).toBe('S1 투입');
    const firstIds = u.history().present.devices.map((d) => d.id);
    await drag(u.el.querySelector('.palette [data-template-id]')!, u.el.querySelector('.board-row')!);
    expect(u.history().present.units).toHaveLength(2);
    const ids = u.history().present.devices.map((d) => d.id);
    expect(ids.filter((id) => !firstIds.includes(id))).toHaveLength(firstIds.length);
    expect(new Set(ids).size).toBe(ids.length);
    await u.click(u.el.querySelector('[aria-label="실행 취소"]')!);
    expect(u.history().present.units).toHaveLength(1);
    const sample = [...u.el.querySelectorAll('.exitem')].find((row) => (row.textContent ?? '').includes('조립 라인'));
    await u.click(sample);
    expect(u.history().present.units.length).toBeGreaterThan(1);

    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
    try {
      await u.click(u.btn('▶ 실행'));
      await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]')!);
      const before = u.history().present.units.length;
      await drag(u.el.querySelector('.palette [data-template-id]')!, u.el.querySelector('.board-row')!);
      expect(u.el.querySelector('.toast')?.textContent).toContain('실행 중');
      expect(u.history().present.units).toHaveLength(before);
    } finally {
      globalThis.requestAnimationFrame = raf;
    }
  });

  it('asks before overwriting a template of the same name', async () => {
    const u = await mount();
    await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]')!);
    await u.click(u.el.querySelector('[data-tree-id="U-S1"]')!);
    const save = () => u.click(u.el.querySelector('[data-save-template]')!);
    await save();
    await u.click(u.btn('저장', u.el.querySelector('[aria-label="내 템플릿으로 저장"]')!));
    await save();
    await u.click(u.btn('저장', u.el.querySelector('[aria-label="내 템플릿으로 저장"]')!));
    const dialog = u.el.querySelector('[aria-label="같은 이름 「S1 투입」"]')!;
    expect(dialog).toBeTruthy();
    expect(document.activeElement?.textContent).toBe('취소');
    await u.click(u.btn('덮어쓰기', dialog));
    expect(u.el.querySelectorAll('.palette [data-template-id]')).toHaveLength(1);
    expect(u.history().past).toHaveLength(0);
  });

  it('AC8 a template with a missing asset shows the reason and places nothing', async () => {
    const captured = captureUnitTemplate(buildSampleProject(), 'U-S1');
    if (!captured.ok) throw new Error('capture');
    captured.captured.devices[0].definitionRef = { assetId: 'asset.missing', version: '0' };
    const saved = saveTemplate(localStorage as unknown as KV, captured.captured, '없는 에셋');
    if (!saved.ok) throw new Error(saved.reason);
    const u = await mount();
    await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]')!);
    const before = u.history().present.units.length;
    await drag(u.el.querySelector('.palette [data-template-id]')!, u.el.querySelector('.board-row')!);
    expect(u.el.querySelector('.toast')?.textContent).toContain('asset.missing');
    expect(u.history().present.units).toHaveLength(before);
    expect(u.history().past).toHaveLength(0);
  });

  it('AC7 deleting asks first, focuses 취소, and leaves the placed Unit', async () => {
    const u = await mount();
    await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]')!);
    await u.click(u.el.querySelector('[data-tree-id="U-S1"]')!);
    const node = u.el.querySelector('[data-tree-id="U-S1"]')!;
    await act(async () => { node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 })); });
    await u.click(u.el.querySelector('[data-action="saveTemplate"]')!);
    await u.click(u.btn('저장', u.el.querySelector('[aria-label="내 템플릿으로 저장"]')!));
    await drag(u.el.querySelector('.palette [data-template-id]')!, u.el.querySelector('.board-row')!);
    const placed = u.history().present.units.find((unit) => unit.lineage?.fromTemplate);
    expect(placed?.name).toContain('S1 투입');
    const kept = JSON.stringify(placed);
    await u.click(u.el.querySelector('.stepper [data-stepid="library"]')!);
    await u.click(u.el.querySelector('.my-template')!);
    expect(u.el.querySelector('[data-template-detail]')?.textContent).toContain('Device');
    expect(u.el.querySelector('[data-template-detail]')?.textContent).toContain('Action');
    await u.click(u.btn('삭제', u.el.querySelector('.my-template-detail')!));
    const dialog = u.el.querySelector('[aria-label="S1 투입 삭제"]')!;
    expect(document.activeElement?.textContent).toBe('취소');
    await u.click(u.btn('삭제', dialog));
    expect(u.el.querySelector('.my-template')).toBeNull();
    await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]')!);
    const still = u.history().present.units.find((unit) => unit.lineage?.fromTemplate);
    expect(JSON.stringify(still)).toBe(kept);
  });

  it('AC10 a broken item stays out and a memory-only browser dims the save button', async () => {
    const captured = captureUnitTemplate(buildSampleProject(), 'U-S1');
    if (!captured.ok) throw new Error('capture');
    const saved = saveTemplate(localStorage as unknown as KV, captured.captured, '살아 있는 틀');
    if (!saved.ok) throw new Error(saved.reason);
    const index = JSON.parse(localStorage.getItem(TEMPLATES_INDEX_KEY)!) as { ids: string[] };
    index.ids.push('bad');
    localStorage.setItem(TEMPLATES_INDEX_KEY, JSON.stringify(index));
    localStorage.setItem(templateBodyKey('bad'), '{');
    const u = await mount();
    expect(u.el.querySelector('.my-templates')?.textContent).toContain('살아 있는 틀');
    expect(u.el.querySelector('[data-template-skipped]')?.textContent).toContain('빼고');

    await act(async () => { root!.unmount(); });
    root = null;
    document.body.innerHTML = '';
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItemBlocked() { throw new Error('memory only'); };
    try {
      const blocked = await mount();
      await blocked.click(blocked.el.querySelector('.stepper [data-stepid="canvas"]')!);
      await blocked.click(blocked.el.querySelector('[data-tree-id="U-S1"]')!);
      const save = blocked.el.querySelector('[data-save-template]') as HTMLButtonElement;
      expect(save.disabled).toBe(true);
      expect(save.title).toBe(STORAGE_UNAVAILABLE);
    } finally {
      Storage.prototype.setItem = orig;
    }
  });
});
