// @vitest-environment jsdom
// TURN-019: dark card-diagram strokes clear 3:1. Light colors stay on the SVG attributes.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ASSET_LIBRARY } from '../src/assets/library';
import { BUILTIN_KINDS } from '../src/model/types';
import { VIEW_KEY } from '../src/storage/localStore';
import { App } from '../src/ui/App';
import { buildSampleProject } from '../src/model/sample';
import { DIAGRAM_SLOT_H, DIAGRAM_SLOT_W, DIAGRAM_SLOTS, LibraryWorkspace, slotSvgHtml, Visual } from '../src/ui/Library';
import { THEMES } from '../src/ui/viewSettings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PANEL = '#19283a';
const SELECTED = '#203d4c';
const LIGHT_STROKE = '#245BCE';
const LIGHT_FILL = '#E5EDFF';

const lum = (hex: string) => {
  const h = hex.replace('#', '');
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

function cssHex(prop: string): string {
  const css = readFileSync('src/ui/slot-theme.css', 'utf8');
  const found = [...css.matchAll(new RegExp(`${prop}:\\s*(#[0-9A-Fa-f]{6})`, 'g'))].map((m) => m[1].toUpperCase());
  expect(found, prop).toHaveLength(1);
  return found[0];
}

function srcFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = `${dir}/${name}`;
    if (statSync(path).isDirectory()) out.push(...srcFiles(path));
    else if (/\.(tsx?|css|svg)$/.test(name)) out.push(path);
  }
  return out;
}

function rgbHex(input: string): string {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(input);
  if (!m) return input.trim().toUpperCase();
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  document.head.querySelectorAll('style').forEach((s) => s.remove());
  localStorage.clear();
});

async function mount(node: ReactNode) {
  const css = document.createElement('style');
  css.textContent = readFileSync('src/ui/slot-theme.css', 'utf8');
  document.head.appendChild(css);
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(node); });
  return el;
}

function library(mode: 'schematic' | 'photo') {
  return <LibraryWorkspace p={buildSampleProject()} locked={false} mode={mode} filter={{ q: '', category: '' }} libVersion={0}
    setFilter={() => {}} setMode={() => {}} onAdd={() => {}} onImportAml={() => {}} onExportAml={() => {}}
    detail={false} setDetail={() => {}} detailWidth={256} onDetailWidth={() => {}} />;
}

describe('TURN-019 dark card diagrams', () => {
  const stroke = cssHex('stroke');
  const fill = cssHex('fill');

  it('AC1 AC5: the dark stroke clears 3:1 on both card surfaces and is declared once', () => {
    expect(THEMES.B.vars.panel.toLowerCase()).toBe(PANEL);
    expect(THEMES.B.vars.selected.toLowerCase()).toBe(SELECTED);
    expect(ratio(stroke, PANEL)).toBeGreaterThanOrEqual(3);
    expect(ratio(stroke, SELECTED)).toBeGreaterThanOrEqual(3);
    expect(lum(fill)).toBeGreaterThan(lum(PANEL));
    expect(lum(fill)).toBeLessThan(lum(stroke));
    expect(ratio(stroke, fill)).toBeGreaterThanOrEqual(3);
    expect(ratio(fill, PANEL)).toBeLessThan(2);
    const css = readFileSync('src/ui/slot-theme.css', 'utf8');
    expect(css).not.toMatch(/\bfilter\s*:/);
    expect(css).not.toMatch(/https?:/);
    for (const file of srcFiles('src')) {
      if (file.endsWith('src/ui/slot-theme.css')) continue;
      const text = readFileSync(file, 'utf8').toUpperCase();
      expect(text.includes(stroke), file).toBe(false);
      expect(text.includes(fill), file).toBe(false);
    }
    for (const file of ['src/ui/styles.css', 'src/ui/viewSettings.ts', 'src/ui/Symbols.tsx', 'README.md']) {
      expect(readFileSync(file, 'utf8')).not.toContain('slot-stroke');
    }
  });

  it('AC2: light stroke and fill stay on the card files, and every line is marked for the dark override', () => {
    expect(readFileSync('src/ui/slots/47069.svg', 'utf8')).toContain('stroke="#53647B"');
    expect(readFileSync('src/ui/slots/e5f85.svg', 'utf8')).toContain('stroke="#53647B"');
    for (const kind of BUILTIN_KINDS) {
      const raw = readFileSync(`src/ui/slots/${DIAGRAM_SLOTS[kind].file}`, 'utf8');
      const strokes = raw.match(/stroke="#245BCE"/g)?.length ?? 0;
      const fills = raw.match(/fill="#E5EDFF"/g)?.length ?? 0;
      expect(strokes).toBeGreaterThan(0);
      expect(fills).toBeGreaterThan(0);
      const html = slotSvgHtml(raw, kind);
      expect(html.match(/stroke="#245BCE"/g)?.length).toBe(strokes);
      expect(html.match(/fill="#E5EDFF"/g)?.length).toBe(fills);
      expect(html.match(/\bslot-stroke\b/g)?.length).toBe(strokes);
      expect(html.match(/\bslot-fill\b/g)?.length).toBe(fills);
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain(`width="${DIAGRAM_SLOT_W}"`);
      expect(html).toContain(`height="${DIAGRAM_SLOT_H}"`);
      expect(html.toUpperCase()).not.toContain(stroke);
      expect(html.toUpperCase()).not.toContain(fill);
    }
    expect(DIAGRAM_SLOTS.cylinder.raw).toBe(DIAGRAM_SLOTS.pusher.raw);
    expect(DIAGRAM_SLOTS.cylinder.src).toBe(DIAGRAM_SLOTS.pusher.src);
  });

  it('AC3 AC4: flipping appearance recolors the inline diagram and leaves the card text in place', async () => {
    const el = await mount(<div className="app" data-appearance="light">{library('schematic')}</div>);
    const cards = [...el.querySelectorAll('.libmain .card')];
    expect(cards).toHaveLength(14);
    const ids = cards.map((card) => card.querySelector('.card-id')!.textContent);
    expect(ids.every((id) => id && id.includes('·'))).toBe(true);
    for (const kind of BUILTIN_KINDS) {
      const card = el.querySelector(`.card[data-kind="${kind}"]`)!;
      const fig = card.querySelector('.slot-diagram') as HTMLElement;
      const svg = card.querySelector('.slot-diagram svg') as SVGSVGElement;
      expect(fig.style.width).toBe(`${DIAGRAM_SLOT_W}px`);
      expect(fig.style.height).toBe(`${DIAGRAM_SLOT_H}px`);
      expect(svg.getAttribute('width')).toBe(String(DIAGRAM_SLOT_W));
      expect(svg.getAttribute('height')).toBe(String(DIAGRAM_SLOT_H));
      expect(card.querySelector('.slot-diagram')!.getAttribute('data-slot-file')).toBe(DIAGRAM_SLOTS[kind].file);
      const raw = readFileSync(`src/ui/slots/${DIAGRAM_SLOTS[kind].file}`, 'utf8');
      expect(card.querySelectorAll('.slot-stroke').length).toBe(raw.match(/stroke="#245BCE"/g)?.length ?? 0);
      expect(card.querySelectorAll('.slot-fill').length).toBe(raw.match(/fill="#E5EDFF"/g)?.length ?? 0);
      for (const line of card.querySelectorAll('.slot-stroke')) expect(line.getAttribute('stroke')).toBe(LIGHT_STROKE);
      for (const body of card.querySelectorAll('.slot-fill')) expect(body.getAttribute('fill')).toBe(LIGHT_FILL);
    }
    const sample = el.querySelector('.slot-stroke') as Element;
    const app = el.querySelector('.app')!;
    app.setAttribute('data-appearance', 'dark');
    expect(rgbHex(getComputedStyle(sample).stroke)).toBe(stroke);
    expect(rgbHex(getComputedStyle(el.querySelector('.slot-fill')!).fill)).toBe(fill);
    expect(cards.map((card) => card.querySelector('.card-id')!.textContent)).toEqual(ids);
    app.setAttribute('data-appearance', 'light');
    expect(rgbHex(getComputedStyle(sample).stroke)).not.toBe(stroke);
    expect(sample.getAttribute('stroke')).toBe(LIGHT_STROKE);
  });

  it('AC3: the theme control recolors the diagrams and leaves the model revision', async () => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ theme: 'A', step: 'library', home: false, visualMode: 'schematic' }));
    const el = await mount(<App />);
    expect(el.querySelector('.app')!.getAttribute('data-appearance')).toBe('light');
    const ids = [...el.querySelectorAll('.libmain .card-id')].map((n) => n.textContent);
    const rev = el.querySelector('.work-rev')!.textContent;
    expect(ids).toHaveLength(14);
    expect(el.querySelectorAll('.libmain .slot-stroke').length).toBeGreaterThan(0);
    await act(async () => { el.querySelector<HTMLButtonElement>('[data-theme-choice="dark"]')!.click(); });
    expect(el.querySelector('.app')!.getAttribute('data-appearance')).toBe('dark');
    expect(el.querySelector('.app')!.getAttribute('data-theme')).toBe('B');
    const painted = el.querySelector('.libmain .slot-stroke') as Element;
    expect(painted.getAttribute('stroke')).toBe(LIGHT_STROKE);
    expect(rgbHex(getComputedStyle(painted).stroke)).toBe(stroke);
    expect([...el.querySelectorAll('.libmain .card-id')].map((n) => n.textContent)).toEqual(ids);
    expect(el.querySelector('.work-rev')!.textContent).toBe(rev);
    await act(async () => { el.querySelector<HTMLButtonElement>('[data-theme-choice="light"]')!.click(); });
    expect(el.querySelector('.app')!.getAttribute('data-appearance')).toBe('light');
    expect(rgbHex(getComputedStyle(el.querySelector('.libmain .slot-stroke')!).stroke)).not.toBe(stroke);
    expect(el.querySelector('.work-rev')!.textContent).toBe(rev);
  });

  it('AC2 AC4: archived C keeps the light diagram colors; photo mode and the missing-image slot stay put', async () => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ theme: 'C', step: 'library', home: false, visualMode: 'schematic' }));
    const el = await mount(<App />);
    const app = el.querySelector('.app')!;
    expect(app.getAttribute('data-theme')).toBe('C');
    expect(app.getAttribute('data-appearance')).toBe('light');
    const painted = el.querySelector('.libmain .slot-stroke') as Element;
    expect(painted.getAttribute('stroke')).toBe(LIGHT_STROKE);
    expect(rgbHex(getComputedStyle(painted).stroke)).not.toBe(stroke);
    const ids = [...el.querySelectorAll('.libmain .card-id')].map((n) => n.textContent);
    const photo = [...el.querySelectorAll<HTMLButtonElement>('.libmain button')].find((b) => b.textContent === '실사풍(AI)')!;
    await act(async () => { photo.click(); });
    expect(el.querySelectorAll('.libmain .card')).toHaveLength(14);
    expect(el.querySelectorAll('.libmain .slot-diagram img')).toHaveLength(14);
    expect(el.querySelectorAll('.libmain .slot-stroke')).toHaveLength(0);
    expect(el.querySelectorAll('.libmain .aichip')).toHaveLength(14);
    expect([...el.querySelectorAll('.libmain .card-id')].map((n) => n.textContent)).toEqual(ids);
    const ghost = { ...ASSET_LIBRARY[0], id: 'asset.ghost', kind: 'ghostKind', name: '없는 장치' };
    await act(async () => { root!.render(<div className="app" data-appearance="dark"><Visual def={ghost} mode="photo" /></div>); });
    const fig = document.querySelector('.slot-diagram') as HTMLElement;
    expect(fig.getAttribute('data-visual')).toBe('photo-missing');
    expect(fig.style.width).toBe(`${DIAGRAM_SLOT_W}px`);
    expect(fig.style.height).toBe(`${DIAGRAM_SLOT_H}px`);
    expect(fig.textContent).toContain('AI 이미지 미준비');
    expect(fig.querySelector('.slot-stroke')).toBeNull();
  });
});
