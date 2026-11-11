// @vitest-environment jsdom
// Card figures: same slot in both view modes, transparent backdrop, one palette on the ten new diagrams.
import { readFileSync } from 'node:fs';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { ASSET_LIBRARY } from '../src/assets/library';
import { BUILTIN_KINDS } from '../src/model/types';
import { buildSampleProject } from '../src/model/sample';
import { DIAGRAM_SLOT_H, DIAGRAM_SLOT_W, DIAGRAM_SLOTS, LibraryWorkspace, Visual } from '../src/ui/Library';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NEW_KINDS = ['stopper', 'gantry', 'picker', 'sensor', 'photoelectricSensor', 'proximitySensor', 'limitSwitch', 'unitInput', 'unitIdentify', 'unitTransfer'] as const;
const HANDED = ['a3687.svg', '238b4.svg', '91c95.svg'] as const;
const ALLOWED = new Set(['#245BCE', '#E5EDFF']);

const fullBackdrop = (text: string) => /<rect\b[^>]*\bwidth="100"(?=[^>]*\bheight="48")/.test(text)
  || /<rect\b[^>]*\bheight="48"(?=[^>]*\bwidth="100")/.test(text)
  || /<rect\b[^>]*\bwidth="100%"/.test(text);

async function mount(node: ReactNode) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => { root.render(node); });
  return { el, root };
}

function library(mode: 'schematic' | 'photo') {
  return <LibraryWorkspace p={buildSampleProject()} locked={false} mode={mode} filter={{ q: '', category: '' }} libVersion={0}
    setFilter={() => {}} setMode={() => {}} onAdd={() => {}} onImportAml={() => {}} onExportAml={() => {}}
    detail={false} setDetail={() => {}} detailWidth={256} onDetailWidth={() => {}} />;
}

describe('library card diagrams', () => {
  it('covers all 14 kinds at one slot size; cylinder still shares the pusher file', () => {
    expect([...BUILTIN_KINDS].sort()).toEqual(Object.keys(DIAGRAM_SLOTS).sort());
    expect(DIAGRAM_SLOT_W).toBe(100);
    expect(DIAGRAM_SLOT_H).toBe(48);
    expect(DIAGRAM_SLOTS.cylinder.file).toBe('a3687.svg');
    expect(DIAGRAM_SLOTS.cylinder.src).toBe(DIAGRAM_SLOTS.pusher.src);
    for (const kind of BUILTIN_KINDS) {
      const text = readFileSync(`src/ui/slots/${DIAGRAM_SLOTS[kind].file}`, 'utf8');
      expect(text).toContain(`width="${DIAGRAM_SLOT_W}"`);
      expect(text).toContain(`height="${DIAGRAM_SLOT_H}"`);
      expect(fullBackdrop(text)).toBe(false);
      expect(text).not.toMatch(/fill="white"/i);
    }
  });

  it('drops only the white backdrop from the handed diagrams and leaves the tree chevrons', () => {
    for (const file of HANDED) {
      const text = readFileSync(`src/ui/slots/${file}`, 'utf8');
      expect(text).not.toContain('<rect width="100" height="48" fill="white"/>');
      expect(text).toContain('fill="#E5EDFF"');
      expect(text).toContain('stroke="#245BCE"');
    }
    expect(readFileSync('src/ui/slots/47069.svg', 'utf8')).toContain('<rect width="16" height="16" fill="white"/>');
    expect(readFileSync('src/ui/slots/e5f85.svg', 'utf8')).not.toContain('fill="white"');
  });

  it('paints the ten new diagrams with only #245BCE and #E5EDFF', () => {
    for (const kind of NEW_KINDS) {
      const text = readFileSync(`src/ui/slots/${DIAGRAM_SLOTS[kind].file}`, 'utf8');
      const hexes = text.match(/#[0-9A-Fa-f]{3,8}/g) ?? [];
      expect(hexes.length).toBeGreaterThan(0);
      for (const hex of hexes) expect(ALLOWED.has(hex.toUpperCase()), `${kind} ${hex}`).toBe(true);
      expect(text).not.toMatch(/\b(?:white|black|rgb|hsl)\b/i);
      expect(text).toContain('fill="#E5EDFF"');
      expect(text).toContain('stroke="#245BCE"');
    }
  });

  it('keeps the slot background transparent and the card column equal to the figure', () => {
    const css = readFileSync('src/ui/styles.css', 'utf8');
    const slotRule = css.match(/\.slot-diagram \{[^}]+\}/)?.[0] ?? '';
    expect(slotRule).toContain('background: transparent');
    expect(slotRule).toContain(`width: ${DIAGRAM_SLOT_W}px`);
    expect(slotRule).toContain(`height: ${DIAGRAM_SLOT_H}px`);
    expect(slotRule).not.toMatch(/#fff|white/i);
    const grid = [...css.matchAll(/\.card \{[^}]+\}/g)].map((m) => m[0]).find((rule) => rule.includes('grid-template-columns'));
    expect(grid).toContain(`grid-template-columns: ${DIAGRAM_SLOT_W}px`);
    expect(css).toContain('object-fit: contain');
  });

  it('renders 14 cards in both modes inside the same slot, with no gray .vis backdrop', async () => {
    for (const mode of ['schematic', 'photo'] as const) {
      const { el, root } = await mount(library(mode));
      const cards = [...el.querySelectorAll('.cards .card')];
      expect(cards).toHaveLength(14);
      expect(el.querySelectorAll('.card .vis')).toHaveLength(0);
      const sizes = cards.map((card) => {
        const fig = card.querySelector('.slot-diagram') as HTMLElement;
        const img = card.querySelector('img') as HTMLImageElement;
        expect(fig).not.toBeNull();
        expect(fig.style.width).toBe(`${DIAGRAM_SLOT_W}px`);
        expect(fig.style.height).toBe(`${DIAGRAM_SLOT_H}px`);
        expect(img.getAttribute('width')).toBe(String(DIAGRAM_SLOT_W));
        expect(img.getAttribute('height')).toBe(String(DIAGRAM_SLOT_H));
        expect(card.querySelector('.cname')!.textContent!.length).toBeGreaterThan(0);
        expect(card.querySelector('.card-id')!.textContent!.length).toBeGreaterThan(0);
        expect(card.querySelector('.card-note')!.textContent!.length).toBeGreaterThan(0);
        return `${fig.style.width}x${fig.style.height}`;
      });
      expect(new Set(sizes).size).toBe(1);
      if (mode === 'schematic') {
        expect(el.querySelectorAll('.card .aichip')).toHaveLength(0);
        for (const kind of BUILTIN_KINDS) {
          const card = el.querySelector(`.card[data-kind="${kind}"]`)!;
          expect(card.querySelector('.slot-diagram')!.getAttribute('data-slot-file')).toBe(DIAGRAM_SLOTS[kind].file);
        }
      } else {
        expect(el.querySelectorAll('.card .aichip')).toHaveLength(14);
        expect(el.querySelector('[data-visual="photo"] img')!.getAttribute('alt')).toContain('실제 사진 아님');
      }
      await act(async () => { root.unmount(); });
      el.remove();
    }
  });

  it('keeps a missing AI image inside the same slot instead of the gray backdrop', async () => {
    const ghost = { ...ASSET_LIBRARY[0], id: 'asset.ghost', kind: 'ghostKind', name: '없는 장치' };
    const { el, root } = await mount(<Visual def={ghost} mode="photo" />);
    const fig = el.querySelector('.slot-diagram') as HTMLElement;
    expect(el.querySelector('.vis')).toBeNull();
    expect(fig.style.width).toBe(`${DIAGRAM_SLOT_W}px`);
    expect(fig.style.height).toBe(`${DIAGRAM_SLOT_H}px`);
    expect(fig.getAttribute('data-visual')).toBe('photo-missing');
    expect(fig.textContent).toContain('AI 이미지 미준비');
    await act(async () => { root.unmount(); });
    el.remove();
  });
});
