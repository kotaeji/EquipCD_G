import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DIAGRAM_SLOT_H, DIAGRAM_SLOT_W } from '../src/ui/Library';

const slots = [
  ['src/ui/slots/a3687.svg', 100, 48],
  ['src/ui/slots/238b4.svg', 100, 48],
  ['src/ui/slots/91c95.svg', 100, 48],
  ['src/ui/slots/47069.svg', 16, 16],
  ['src/ui/slots/e5f85.svg', 16, 16],
] as const;

describe('official diagram slots', () => {
  it('keeps the handed SVG root size and does not point cards at a remote asset URL', () => {
    for (const [file, w, h] of slots) {
      const text = readFileSync(file, 'utf8');
      expect(text).toContain(`width="${w}"`);
      expect(text).toContain(`height="${h}"`);
      expect(text.length).toBeGreaterThan(100);
    }
    expect(DIAGRAM_SLOT_W).toBe(100);
    expect(DIAGRAM_SLOT_H).toBe(48);
    const lib = readFileSync('src/ui/Library.tsx', 'utf8');
    const tree = readFileSync('src/ui/ProjectTree.tsx', 'utf8');
    expect(lib).toContain('width={DIAGRAM_SLOT_W}');
    expect(lib).toContain('height={DIAGRAM_SLOT_H}');
    expect(lib).not.toContain('figma.com/api');
    expect(tree).toContain('width={16}');
    expect(tree).toContain('height={16}');
    expect(tree).not.toContain('figma.com/api');
  });
});
