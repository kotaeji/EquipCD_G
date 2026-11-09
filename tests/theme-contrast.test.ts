// Static checks for the theme-B readability bug and A/B/C color contrast (WCAG ratio, computed — not a visual browser check).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { THEME_ORDER, THEMES } from '../src/ui/viewSettings';

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const HEADER = { bg: '#A20034', fg: '#FFFFFF', muted: '#F5D6DE', border: '#FFFFFF' };
const hex = (v: string) => v.toUpperCase();

describe('theme colors', () => {
  it('base text color is applied on .app (where theme vars live), not only on body', () => {
    const css = readFileSync('src/ui/styles.css', 'utf8');
    expect(css).toMatch(/\.app, \.modal-bg, \.toast \{ color: var\(--text\)/);
    expect(css).not.toMatch(/body \{[^}]*color: var\(--text\)/);
    expect(css).toMatch(/\.tree div \{ color: var\(--text\)/);
    expect(css).toMatch(/\.palette \.pi \{ color: var\(--text\)/);
  });
  for (const t of THEME_ORDER) {
    it(`theme ${t}: text ≥ 4.5:1 and muted/accent ≥ 3:1 on bg/panel/canvas/selected; primary button label ≥ 3:1`, () => {
      const v = THEMES[t].vars;
      for (const bg of [v.bg, v.panel, v.canvas, v.selected]) {
        expect(ratio(v.text, bg)).toBeGreaterThanOrEqual(4.5);
        expect(ratio(v.muted, bg)).toBeGreaterThanOrEqual(3);
        expect(ratio(v.accent, bg)).toBeGreaterThanOrEqual(3);
      }
      expect(ratio(v['on-accent'], v.accent)).toBeGreaterThanOrEqual(3);
      expect(v.scheme).toBe(t === 'B' ? 'dark' : 'light');
    });
    it(`theme ${t}: header tokens are the same brand colors and clear the header background`, () => {
      const v = THEMES[t].vars;
      expect(hex(v['header-bg'])).toBe(HEADER.bg);
      expect(hex(v['header-fg'])).toBe(HEADER.fg);
      expect(hex(v['header-muted'])).toBe(HEADER.muted);
      expect(hex(v['header-border'])).toBe(HEADER.border);
      // AC2: product name and muted header text sit on the header background.
      expect(ratio(v['header-fg'], v['header-bg'])).toBeGreaterThanOrEqual(4.5);
      expect(ratio(v['header-muted'], v['header-bg'])).toBeGreaterThanOrEqual(4.5);
      // Button edge and the white focus outline use the same white as header-border.
      expect(ratio(v['header-border'], v['header-bg'])).toBeGreaterThanOrEqual(3);
      // Active white labels (secondary, icon) on the header background.
      expect(ratio('#FFFFFF', v['header-bg'])).toBeGreaterThanOrEqual(4.5);
      // Save label is brand-on-white, then brand-on-#F5D6DE while hovered. Measured against the button fill.
      expect(ratio('#A20034', '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
      expect(ratio('#A20034', '#F5D6DE')).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('AC8: header focus ring is a white 2px outline with 2px offset, and the global accent ring stays', () => {
    const css = readFileSync('src/ui/styles.css', 'utf8');
    const block = css.match(/\.header :focus-visible \{[\s\S]*?\}/)?.[0] ?? '';
    expect(block).toMatch(/outline:\s*2px solid #FFFFFF/);
    expect(block).toMatch(/outline-offset:\s*2px/);
    expect(block).not.toMatch(/--accent/);
    expect(css).toMatch(/:where\(button, a, select, input, textarea, \[tabindex\]\):focus-visible \{ outline: 2px solid var\(--accent\)/);
    const headerRule = css.slice(css.lastIndexOf('.app > .header {'));
    expect(headerRule).toMatch(/background:\s*var\(--header-bg\)/);
    expect(headerRule).toMatch(/color:\s*var\(--header-fg\)/);
    expect(headerRule).toMatch(/border-bottom:\s*1px solid #7A0027/);
    expect(css).toMatch(/\.app\[data-appearance="light"\] button\.btn-main\.primary \{ background-color: #245bce; color: #ffffff; \}/);
    expect(css).toMatch(/\.app\[data-appearance="dark"\] button\.btn-main\.primary \{ background-color: #42d6cc; color: #102c2d; \}/);
    expect(css).toMatch(/\.app\[data-appearance="light"\] button\.btn-main\.secondary \{ background-color: #e5edff; color: #17283f; \}/);
    expect(css).toMatch(/\.app\[data-appearance="dark"\] button\.btn-main\.secondary \{ background-color: #203d4c; color: #eff5fd; \}/);
  });

  it('header icon buttons are transparent with white text, and hover rules do not draw an outline', () => {
    const css = readFileSync('src/ui/styles.css', 'utf8');
    const header = css.slice(css.lastIndexOf('/* TURN-004'));
    const icon = header.match(/\.app > \.header button\.icon \{[\s\S]*?\}/)?.[0] ?? '';
    expect(icon).toMatch(/color:\s*#FFFFFF/);
    expect(icon).toMatch(/background-color:\s*transparent/);
    expect(icon).toMatch(/border-color:\s*transparent/);
    const iconHover = header.match(/\.app > \.header button\.icon:hover:not\(:disabled\) \{[\s\S]*?\}/)?.[0] ?? '';
    expect(iconHover).toMatch(/background-color:\s*rgba\(255,\s*255,\s*255,\s*\.12\)/);
    expect(iconHover).toMatch(/border-color:\s*transparent/);
    const hoverBlocks = [...header.matchAll(/:hover:not\(:disabled\) \{[\s\S]*?\}/g)].map((m) => m[0]);
    expect(hoverBlocks.length).toBeGreaterThanOrEqual(4);
    for (const block of hoverBlocks) expect(block).not.toMatch(/outline/);
    expect(header).toMatch(/\.header :focus-visible \{[\s\S]*?outline:\s*2px solid #FFFFFF/);
    expect(header).toMatch(/\.header :focus-visible \{[\s\S]*?outline-offset:\s*2px/);
  });
});
