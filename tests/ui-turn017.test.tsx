// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { App } from '../src/ui/App';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('TURN-017 rules version on the status bar (AC8)', () => {
  it('shows file format 0.2.0 and runtime rules 0.2.0', async () => {
    localStorage.clear();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => { root.render(<App />); });
    const text = el.querySelector('.statusbar')?.textContent ?? '';
    expect(text).toContain('형식 0.2.0');
    expect(text).toContain('seq-runtime/0.2.0');
    expect(text).toContain('group-runtime/0.2.0');
    await act(async () => { root.unmount(); });
  });
});
