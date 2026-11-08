// Static checks for the theme-B readability bug and A/B/C color contrast (WCAG ratio, computed — not a visual browser check).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { THEME_ORDER, THEMES } from '../src/ui/viewSettings';

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

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
  }
});
