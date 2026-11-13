// @vitest-environment jsdom
// TURN-015 favicon data URI stays. TURN-016 put the same paths on a 32px white tile,
// so the header assertions below follow that shape. jsdom, not a browser.
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { APP_VERSION, PRODUCT_NAME } from '../src/model/types';
import { App } from '../src/ui/App';

const FAVICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#A20034"/><g fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 20L12 4l7.5 16"/><circle cx="8.3" cy="13.5" r="1.7" fill="#fff"/><circle cx="15.7" cy="13.5" r="1.7"/></g></svg>';

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
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(<App />); });
  return el;
}

function mark(el: ParentNode) {
  return el.querySelector('.header .brand .logo-tile svg') as SVGSVGElement;
}

describe('TURN-015 brand mark', () => {
  it('AC1 AC2: header shows the E mark on a 32px tile, hidden from the name, label unchanged', async () => {
    const css = document.createElement('style');
    css.textContent = readFileSync('src/ui/styles.css', 'utf8');
    document.head.appendChild(css);
    const el = await mount();
    const brand = el.querySelector('.header .brand') as HTMLElement;
    const tile = brand.querySelector('.logo-tile') as HTMLElement;
    const svg = mark(el);
    expect(brand.getAttribute('aria-label')).toBe(`${PRODUCT_NAME} ${APP_VERSION}`);
    expect(brand.querySelector('.title')!.textContent).toBe(PRODUCT_NAME);
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('aria-label')).toBeNull();
    expect(svg.querySelector('title')).toBeNull();
    expect(svg.getAttribute('width')).toBe('22');
    expect(svg.getAttribute('height')).toBe('22');
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('fill')).toBe('none');
    expect(svg.getAttribute('stroke')).toBeNull();
    expect(svg.getAttribute('stroke-width')).toBe('2.2');
    expect(svg.getAttribute('stroke-linecap')).toBe('round');
    expect(svg.getAttribute('stroke-linejoin')).toBe('round');
    const paths = [...svg.querySelectorAll('path')].map((p) => p.getAttribute('d'));
    expect(paths).toEqual(['M4.5 20L12 4l7.5 16', 'M10 13.5h4']);
    expect(svg.querySelectorAll('path')[1].getAttribute('stroke-dasharray')).toBe('1.6 1.4');
    const circles = [...svg.querySelectorAll('circle')];
    expect(circles.map((c) => [c.getAttribute('cx'), c.getAttribute('cy'), c.getAttribute('r'), c.getAttribute('fill'), c.getAttribute('class')])).toEqual([
      ['8.3', '13.5', '1.7', null, 'dot'],
      ['15.7', '13.5', '1.7', null, null],
    ]);
    expect(tile.outerHTML).not.toContain('var(--header-bg)');
    expect(getComputedStyle(tile).width).toBe('32px');
    expect(getComputedStyle(tile).height).toBe('32px');
    expect(getComputedStyle(tile).borderRadius).toBe('7px');
    const tileRule = /\.header \.brand \.logo-tile \{[^}]*\}/.exec(css.textContent!)?.[0] ?? '';
    expect(tileRule).toMatch(/background:\s*var\(--header-fg\)/);
    expect(tileRule).toMatch(/border:\s*none/);
    const svgRule = /\.header \.brand \.logo-tile svg \{[^}]*\}/.exec(css.textContent!)?.[0] ?? '';
    const dotRule = /\.header \.brand \.logo-tile svg \.dot \{[^}]*\}/.exec(css.textContent!)?.[0] ?? '';
    expect(svgRule).toMatch(/stroke:\s*var\(--header-bg\)/);
    expect(dotRule).toMatch(/fill:\s*var\(--header-bg\)/);
    const app = el.querySelector('.app') as HTMLElement;
    expect(app.style.getPropertyValue('--header-fg').toUpperCase()).toBe('#FFFFFF');
    expect(app.style.getPropertyValue('--header-bg').toUpperCase()).toBe('#A20034');
    expect(getComputedStyle(svg).width).toBe('22px');
    expect(getComputedStyle(svg).height).toBe('22px');
    expect(getComputedStyle(brand).gap).toBe('10px');
    expect(getComputedStyle(brand).alignItems).toBe('center');
    expect(brand.firstElementChild).toBe(tile);
    expect(tile.firstElementChild).toBe(svg);
    const header = el.querySelector('.app > .header') as HTMLElement;
    expect(getComputedStyle(header).height).toBe('64px');
    expect(getComputedStyle(header).alignItems).toBe('center');
    const light = tile.outerHTML;
    await act(async () => { el.querySelector<HTMLButtonElement>('[data-theme-choice="dark"]')!.click(); });
    expect(mark(el).parentElement!.outerHTML).toBe(light);
    expect(el.querySelector('.app')!.getAttribute('data-appearance')).toBe('dark');
  });

  it('AC1: stored C keeps the same mark and header tokens', async () => {
    localStorage.setItem('ecd.v1.userView', JSON.stringify({ theme: 'C', step: 'library', home: false }));
    const el = await mount();
    const svg = mark(el);
    const app = el.querySelector('.app') as HTMLElement;
    expect(app.getAttribute('data-theme')).toBe('C');
    expect(svg.getAttribute('stroke')).toBeNull();
    expect(svg.querySelector('circle')!.getAttribute('fill')).toBeNull();
    expect(svg.querySelector('circle')!.getAttribute('class')).toBe('dot');
    expect(svg.querySelector('path')!.getAttribute('d')).toBe('M4.5 20L12 4l7.5 16');
    expect(app.style.getPropertyValue('--header-fg').toUpperCase()).toBe('#FFFFFF');
    expect(app.style.getPropertyValue('--header-bg').toUpperCase()).toBe('#A20034');
  });

  it('AC4: favicon is the header-color mark as a data URI, with no file and no dash', () => {
    const html = readFileSync('index.html', 'utf8');
    const icons = [...html.matchAll(/<link\s+rel="icon"[^>]*>/g)].map((m) => m[0]);
    expect(icons).toHaveLength(1);
    const href = /href="([^"]+)"/.exec(icons[0])![1];
    expect(href.startsWith('data:image/svg+xml,')).toBe(true);
    expect(href).not.toMatch(/\.(svg|png|ico)(\?|")/i);
    expect(decodeURIComponent(href.slice('data:image/svg+xml,'.length))).toBe(FAVICON_SVG);
    expect(FAVICON_SVG).not.toContain('stroke-dasharray');
    expect(FAVICON_SVG).toContain('fill="#A20034"');
    expect(FAVICON_SVG).toContain('stroke="#fff"');
    expect(FAVICON_SVG).toContain('stroke-width="2.2"');
    expect(html).not.toMatch(/href="(?!data:)[^"]*favicon/i);
  });
});
