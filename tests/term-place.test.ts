import { describe, expect, it } from 'vitest';
import { nextTermTipPos, placeTermTip, type TermTipPos } from '../src/ui/termPlace';

const colors = { bg: '#ffffff', fg: '#1c1c1c', border: '#8c8c8c' };
const anchor = { left: 32.890625, bottom: 239.484375 };

describe('glossary tip placement', () => {
  it('places the tip under the anchor and clamps it to the viewport', () => {
    expect(placeTermTip(anchor, 1280, colors)).toEqual({
      top: 243.484375, left: 32.890625, ...colors,
    });
    expect(placeTermTip({ left: -40, bottom: 10 }, 300, colors, 280)).toMatchObject({ left: 8, top: 14 });
    expect(placeTermTip({ left: 500, bottom: 10 }, 300, colors, 280)).toMatchObject({ left: 12 });
    expect(placeTermTip(null, 1280, colors)).toBeNull();
  });

  it('the same input does not replace state', () => {
    const first = placeTermTip(anchor, 1280, colors)!;
    const again = placeTermTip(anchor, 1280, colors)!;
    expect(again).toEqual(first);
    expect(again).not.toBe(first);
    expect(nextTermTipPos(first, again)).toBe(first);
    expect(nextTermTipPos(first, null)).toBe(first);

    let state: TermTipPos = { top: 0, left: 0, bg: '', fg: '', border: '' };
    let writes = 0;
    for (let i = 0; i < 60; i += 1) {
      const resolved = nextTermTipPos(state, placeTermTip(anchor, 1280, colors));
      if (resolved !== state) writes += 1;
      state = resolved;
    }
    expect(writes).toBe(1);
    expect(state).toEqual(first);
  });
});
