// @vitest-environment jsdom
// TURN-079 print view. Opening it does not edit the model.
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { diagramFrame, PRINT_LIMIT, stationFlow } from '../src/model/printReport';
import { buildFlowSampleProject } from '../src/model/sample';
import { APP_VERSION } from '../src/model/types';
import type { History } from '../src/model/history';
import { App } from '../src/ui/App';
import { PALETTE_LABEL } from '../src/ui/CommandPalette';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  localStorage.clear();
  vi.restoreAllMocks();
});

async function mount() {
  localStorage.clear();
  const el = document.createElement('div');
  document.body.appendChild(el);
  const seen: { h: History | null } = { h: null };
  root = createRoot(el);
  await act(async () => { root!.render(<App onHistory={(h) => { seen.h = h; }} />); });
  const click = async (node: Element | undefined | null) => {
    if (!node) throw new Error('missing control');
    await act(async () => { (node as HTMLElement).click(); });
  };
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label || b.getAttribute('aria-label') === label) as HTMLButtonElement | undefined;
  const view = () => el.querySelector('[data-print-view]');
  const openPrint = async () => {
    await click(btn('내보내기'));
    await click(btn('인쇄용 보기'));
  };
  return {
    el, click, btn, view, openPrint,
    rev: () => seen.h!.present.revision,
    undoN: () => seen.h!.past.length,
    project: () => seen.h!.present,
  };
}

const css = readFileSync('src/ui/print-view.css', 'utf8');

describe('TURN-079 print sheets', () => {
  it('AC4 the flow sample keeps indentation, and the print CSS repeats table heads', () => {
    const rows = stationFlow(buildFlowSampleProject()).rows;
    const depths = rows.map((r) => r.depth);
    expect(Math.min(...depths)).toBe(0);
    expect(Math.max(...depths)).toBeGreaterThanOrEqual(2);
    expect(rows.some((r) => r.depth >= 2 && r.title.length > 0)).toBe(true);
    expect(css).toContain('display: table-header-group');
    expect(css).toContain('break-inside: avoid');
    expect(css).toContain('page-break-inside: avoid');
  });

  it('AC3 print rules hide chrome and force a white page, and spacing stays on tokens', () => {
    const print = css.slice(css.indexOf('@media print'));
    for (const sel of ['.header', '.workbar', '.explorer', '.toolbar', '.statusbar', '.toast', '.print-chrome']) {
      expect(print, sel).toContain(sel);
    }
    expect(print).toContain('display: none !important');
    expect(print).toContain('background: #fff !important');
    expect(print).toContain('color: #1c1c1c !important');
    expect(css).toContain('size: A4 landscape');
    expect(css).toContain('size: A4 portrait');
    expect(css).toContain('content: counter(page)');
    expect(css).toContain('break-before: page');
    const stray: string[] = [];
    const body = css.replace(/@page[\s\S]*?\n\}/g, '');
    if (/font-size:\s*\d+(?:\.\d+)?px/.test(body)) stray.push('font-size px');
    const prop = /(padding|margin|gap|row-gap|column-gap|padding-(?:top|right|bottom|left)|margin-(?:top|right|bottom|left))\s*:\s*([^;}{]+)/g;
    for (const match of body.matchAll(prop)) {
      for (const px of match[2].matchAll(/-?\d+(?:\.\d+)?px/g)) {
        const n = Number(px[0].replace('px', ''));
        if (n === 0) continue;
        stray.push(`${match[1]}: ${match[2].trim()}`);
      }
    }
    expect(stray).toEqual([]);
  });
});

describe('TURN-079 print view', () => {
  it('AC1 AC2 AC5 AC6 the view opens, keeps rev, and follows the checks', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]'));
    await u.click(u.btn('확대'));
    const step = u.el.querySelector('.app')!.getAttribute('data-step');
    const rev = u.rev();
    const undo = u.undoN();
    const name = u.project().name;
    expect(step).toBe('canvas');
    await u.openPrint();
    const view = u.view()!;
    expect(view.getAttribute('aria-label')).toBe('인쇄용 보기');
    expect(view.getAttribute('data-orientation')).toBe('landscape');
    for (const id of ['cover', 'structure', 'diagram', 'station', 'substation', 'sfc', 'signals', 'notes']) {
      expect(view.querySelector(`[data-print-section="${id}"]`), id).toBeTruthy();
      expect(view.querySelector(`[data-print-toggle="${id}"]`), id).toBeTruthy();
    }
    const cover = view.querySelector('[data-print-cover]')!;
    expect(cover.textContent).toContain(name);
    expect(cover.querySelector('[data-print-rev]')!.textContent).toBe(String(rev));
    expect(cover.querySelector('[data-print-version]')!.textContent).toBe(APP_VERSION);
    expect(cover.querySelector('[data-print-date]')!.textContent).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const limits = [...view.querySelectorAll('[data-print-limit]')];
    expect(limits.length).toBeGreaterThanOrEqual(2);
    for (const node of limits) expect(node.textContent).toBe(PRINT_LIMIT);
    expect(view.querySelector('[data-print-running-head]')!.textContent).toContain(name);
    const sheet = view.querySelector('[data-print-sheet]') as HTMLElement;
    expect(sheet.getAttribute('style')).toContain('#ffffff');
    expect(sheet.getAttribute('style')).toContain('#1c1c1c');
    const diagram = view.querySelector('[data-print-diagram]')!;
    const frame = diagramFrame(u.project());
    expect(diagram.getAttribute('viewBox')).toBe(`${frame.x} ${frame.y} ${frame.w} ${frame.h}`);
    expect(diagram.getAttribute('width')).toBe('100%');
    expect(diagram.querySelector('[data-print-unit]')).toBeTruthy();
    const sfc = view.querySelector('[data-print-sfc] svg')!;
    expect(sfc.tagName.toLowerCase()).toBe('svg');
    expect(sfc.getAttribute('viewBox')).toBeTruthy();
    expect(css).toMatch(/\.print-sfc svg,\s*\.print-diagram\s*\{[^}]*width:\s*100%/);
    await u.click(view.querySelector('[data-print-orient="portrait"]'));
    expect(u.view()!.getAttribute('data-orientation')).toBe('portrait');
    await u.click(view.querySelector('[data-print-toggle="sfc"]'));
    await u.click(u.view()!.querySelector('[data-print-toggle="diagram"]'));
    expect(u.view()!.querySelector('[data-print-section="sfc"]')).toBeNull();
    expect(u.view()!.querySelector('[data-print-section="diagram"]')).toBeNull();
    expect(u.view()!.querySelector('[data-print-section="station"]')).toBeTruthy();
    const spy = vi.spyOn(window, 'print').mockImplementation(() => {});
    await u.click(u.btn('인쇄', u.view()!));
    expect(spy).toHaveBeenCalledOnce();
    expect(u.rev()).toBe(rev);
    expect(u.undoN()).toBe(undo);
    await u.click(u.btn('닫기', u.view()!));
    expect(u.view()).toBeNull();
    expect(u.el.querySelector('.app')!.getAttribute('data-step')).toBe('canvas');
    expect(u.rev()).toBe(rev);
    expect(u.undoN()).toBe(undo);
    expect(u.project().name).toBe(name);
  });

  it('AC3 the sheet stays light when the app is dark', async () => {
    const u = await mount();
    await u.click(u.btn('다크 테마'));
    expect(u.el.querySelector('.app')!.getAttribute('data-appearance')).toBe('dark');
    await u.openPrint();
    const sheet = u.view()!.querySelector('[data-print-sheet]') as HTMLElement;
    expect(sheet.getAttribute('style')).toContain('#ffffff');
    expect(sheet.getAttribute('style')).toContain('#1c1c1c');
    expect(u.view()!.querySelector('.header')).toBeNull();
    expect(u.view()!.querySelector('.explorer')).toBeNull();
  });

  it('AC4 the station table keeps the flow indent and a repeating head', async () => {
    const u = await mount();
    await u.click(u.btn('흐름 예제'));
    await u.openPrint();
    const station = u.view()!.querySelector('[data-print-section="station"]')!;
    expect(station.querySelector('thead')).toBeTruthy();
    const depths = [...station.querySelectorAll('[data-depth]')].map((td) => td.getAttribute('data-depth'));
    expect(depths).toContain('0');
    expect(depths).toContain('2');
    const shallow = station.querySelector('[data-depth="0"]') as HTMLElement;
    const deep = station.querySelector('[data-depth="2"]') as HTMLElement;
    expect(shallow.style.paddingLeft).toBe('calc(var(--sp-2) + 0 * var(--sp-4))');
    expect(deep.style.paddingLeft).toBe('calc(var(--sp-2) + 2 * var(--sp-4))');
    expect(station.textContent).toContain('분기');
  });

  it('AC7 the command finder opens the print view without editing', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    const rev = u.rev();
    const undo = u.undoN();
    await u.click(u.btn(PALETTE_LABEL));
    const palette = u.el.querySelector(`[role="dialog"][aria-label="${PALETTE_LABEL}"]`)!;
    const input = palette.querySelector('input') as HTMLInputElement;
    await act(async () => {
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '인쇄용 보기');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const row = palette.querySelector('[data-command="print-view"]') as HTMLButtonElement;
    expect(row.textContent).toContain('인쇄용 보기');
    await u.click(row);
    expect(u.view()).toBeTruthy();
    expect(u.el.querySelector(`[role="dialog"][aria-label="${PALETTE_LABEL}"]`)).toBeNull();
    expect(u.rev()).toBe(rev);
    expect(u.undoN()).toBe(undo);
  });
});
