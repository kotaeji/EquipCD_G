// TURN-026: achromatic light theme, width-following cards and palette, larger undo / redo.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { THEMES } from '../src/ui/viewSettings';

const lum = (hex: string) => {
  const h = hex.replace('#', '');
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const chroma = (hex: string) => {
  const h = hex.replace('#', '');
  const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return Math.max(...rgb) - Math.min(...rgb);
};

const LIGHT_KEYS = ['bg', 'panel', 'canvas', 'border', 'text', 'muted', 'accent', 'selected', 'grid', 'on-accent', 'theme-light-bg', 'theme-light-fg', 'theme-dark-bg', 'theme-dark-fg'] as const;
const BANNED = ['#245bce', '#e5edff', '#17283f', '#f2f5fa', '#cbd5e2', '#d5deea', '#53647b'];

const DARK = {
  bg: '#101b2a', panel: '#19283a', canvas: '#101b2a', border: '#5c8496', text: '#eff5fd', muted: '#b3c4d9', accent: '#42d6cc', selected: '#203d4c', success: '#88dfb1', warning: '#ffd18a', danger: '#ff9fab', grid: '#5c8496', rowh: '32px', pad: '12px', scheme: 'dark', 'on-accent': '#102c2d', 'theme-light-bg': '#19283a', 'theme-light-fg': '#eff5fd', 'theme-dark-bg': '#42d6cc', 'theme-dark-fg': '#102c2d', 'header-bg': '#A20034', 'header-fg': '#FFFFFF', 'header-muted': '#F5D6DE', 'header-border': '#FFFFFF',
};
const ARCHIVED = {
  bg: '#F1F0EB', panel: '#FCFBF7', canvas: '#F7F6F1', border: '#D9DDD5', text: '#283D3B', muted: '#73807B', accent: '#3E807A', selected: '#DFECE6', success: '#487D5E', warning: '#9E7B43', danger: '#A4473A', grid: '#E7E9E1', rowh: '36px', pad: '14px', scheme: 'light', 'on-accent': '#FFFFFF', 'header-bg': '#A20034', 'header-fg': '#FFFFFF', 'header-muted': '#F5D6DE', 'header-border': '#FFFFFF',
};

function srcFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = `${dir}/${name}`;
    if (statSync(path).isDirectory()) out.push(...srcFiles(path));
    else if (/\.(tsx?|css|svg)$/.test(name)) out.push(path);
  }
  return out;
}

function block(css: string, selector: string): string {
  const found = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{[^}]*\\}`));
  expect(found, selector).not.toBeNull();
  return found![0];
}

describe('TURN-026 light gray theme and adaptive layout', () => {
  const css = readFileSync('src/ui/styles.css', 'utf8');
  const app = readFileSync('src/ui/App.tsx', 'utf8');

  it('AC1: light surface, text, accent, and theme-chip tokens are achromatic', () => {
    const v = THEMES.A.vars;
    for (const key of LIGHT_KEYS) {
      expect(chroma(v[key]), key).toBeLessThanOrEqual(12);
    }
    expect(v.success).toBe('#176642');
    expect(v.warning).toBe('#8b4800');
    expect(v.danger).toBe('#b42336');
  });

  it('AC2: header, dark, and archived C tokens are unchanged', () => {
    expect(THEMES.B.vars).toEqual(DARK);
    expect(THEMES.C.vars).toEqual(ARCHIVED);
    for (const t of ['A', 'B', 'C'] as const) {
      expect(THEMES[t].vars['header-bg'].toUpperCase()).toBe('#A20034');
      expect(THEMES[t].vars['header-fg'].toUpperCase()).toBe('#FFFFFF');
      expect(THEMES[t].vars['header-muted'].toUpperCase()).toBe('#F5D6DE');
      expect(THEMES[t].vars['header-border'].toUpperCase()).toBe('#FFFFFF');
    }
  });

  it('AC3: accent button text clears 4.5:1 and selection is marked by an edge', () => {
    const v = THEMES.A.vars;
    expect(ratio(v['on-accent'], v.accent)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(v['theme-light-fg'], v['theme-light-bg'])).toBeGreaterThanOrEqual(4.5);
    const mark = css.slice(css.indexOf('/* TURN-026'));
    expect(mark).toMatch(/button\.on,\s*\.ptab\.on,\s*\.exitem\.on,\s*\.stepper \.st\.on/);
    expect(mark).toMatch(/box-shadow:\s*inset 0 0 0 2px var\(--accent\)/);
    expect(mark).toMatch(/\.tree div\.sel \{ box-shadow: inset 3px 0 0 var\(--accent\); \}/);
    expect(mark).toMatch(/\.card\.sel \{ border-width: 2px; box-shadow: 0 0 0 2px var\(--accent\); \}/);
  });

  it('AC4: the old light-blue literals are gone from src', () => {
    for (const file of srcFiles('src')) {
      const text = readFileSync(file, 'utf8').toLowerCase();
      for (const hex of BANNED) expect(text.includes(hex), `${file} ${hex}`).toBe(false);
    }
  });

  it('AC5: library cards fill the width down to 280px instead of a fixed pair of columns', () => {
    const cards = block(css, '.libmain .cards');
    expect(cards).toContain('repeat(auto-fill, minmax(280px, 1fr))');
    expect(cards).not.toContain('repeat(2');
  });

  it('AC6: the layout palette wraps and does not scroll sideways', () => {
    const fold = block(css, '.layout-stage .palette-fold');
    const palette = block(css, '.layout-stage .palette-fold .palette');
    expect(fold).toContain('display: block');
    expect(fold).toContain('width: 100%');
    expect(fold).toContain('max-width: 100%');
    expect(palette).toContain('width: 100%');
    expect(palette).toContain('flex-wrap: wrap');
    expect(palette).toContain('overflow-x: hidden');
    expect(palette).not.toContain('nowrap');
    expect(palette).not.toContain('overflow-x: auto');
  });

  it('AC7: undo and redo keep their names and shortcuts, and the box and glyph grow', () => {
    expect(app).toContain('aria-label="실행 취소"');
    expect(app).toContain('aria-label="다시 실행"');
    expect(app).toContain('title={undoTooltip(tab.history)}');
    expect(app).toContain('title={redoTooltip(tab.history)}');
    const history = readFileSync('src/model/history.ts', 'utf8');
    expect(history).toContain('실행 취소: ${name} (Ctrl/Cmd+Z)');
    expect(history).toContain('다시 실행: ${name} (Ctrl/Cmd+Shift+Z)');
    expect(app).toContain('disabled={!tab.history.past.length || locked}');
    expect(app).toContain('disabled={!tab.history.future.length || locked}');
    expect(app).toContain('<HistoryIcon dir="undo" />');
    expect(app).toContain('<HistoryIcon dir="redo" />');
    expect(app).toContain('width="24"');
    expect(app).toContain('height="24"');
    expect(app).toContain('strokeWidth="2"');
    expect(app).not.toContain('scale(2.4)');
    const icon = block(css, '.app > .header button.icon');
    expect(icon).toContain('width: 44px');
    expect(icon).toContain('height: 44px');
    expect(icon).toContain('min-width: 44px');
    expect(icon).toContain('min-height: 44px');
    expect(icon).not.toContain('overflow: hidden');
    expect(icon).not.toContain('transform:');
    const glyph = block(css, '.app > .header button.icon svg');
    expect(glyph).toContain('width: 24px');
    expect(glyph).toContain('height: 24px');
    expect(glyph).not.toContain('transform:');
    const disabled = block(css, '.app > .header button.icon:disabled');
    expect(disabled).toContain('opacity: 1');
    expect(disabled).toContain('color: #F5D6DE');
    expect(ratio(THEMES.A.vars['header-muted'], THEMES.A.vars['header-bg'])).toBeGreaterThanOrEqual(4.5);
  });
});
