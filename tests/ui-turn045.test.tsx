// @vitest-environment jsdom
// TURN-045: danger buttons, quantity errors, and contrast pairs.
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { History } from '../src/model/history';
import { App } from '../src/ui/App';
import { STATUS_COLOR } from '../src/ui/status';
import { THEMES } from '../src/ui/viewSettings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const lum = (hex: string) => {
  const h = hex.replace('#', '');
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  localStorage.clear();
});

async function mount() {
  localStorage.clear();
  const el = document.createElement('div');
  document.body.appendChild(el);
  const seen: { h: History | null } = { h: null };
  root = createRoot(el);
  await act(async () => { root!.render(<App onHistory={(h) => { seen.h = h; }} />); });
  const click = async (node: Element | null | undefined) => {
    if (!node) throw new Error('missing control');
    await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  };
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label) as HTMLButtonElement;
  const typeNum = async (input: HTMLInputElement, value: string) => {
    const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    await act(async () => {
      proto?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
  };
  return { el, click, btn, typeNum, history: () => seen.h! };
}

function foldOf(el: ParentNode, text: string) {
  return [...el.querySelectorAll('details')].find((d) => (d.querySelector('summary')?.textContent ?? '').includes(text))!;
}

describe('TURN-045 contrast pairs', () => {
  const css = readFileSync('src/ui/styles.css', 'utf8');

  it('AC8 body, muted, button, accent, status, border, and selected text clear the ratios in light and dark', () => {
    for (const t of ['A', 'B'] as const) {
      const v = THEMES[t].vars;
      const surfaces = [v.bg, v.panel, v.canvas, v.selected];
      for (const bg of surfaces) {
        expect(ratio(v.text, bg), `${t} text`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(v.muted, bg), `${t} muted`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(v.accent, bg), `${t} accent`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(v.danger, bg), `${t} danger`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(v.warning, bg), `${t} warning`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(v.success, bg), `${t} success`).toBeGreaterThanOrEqual(4.5);
      }
      for (const bg of [v.bg, v.panel, v.canvas]) {
        expect(ratio(v.border, bg), `${t} border`).toBeGreaterThanOrEqual(3);
        expect(ratio(v.grid, bg), `${t} diagram grid`).toBeGreaterThanOrEqual(3);
        expect(ratio(v.text, bg), `${t} diagram line`).toBeGreaterThanOrEqual(3);
      }
      expect(ratio(v.text, v.panel), `${t} button label`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(v['on-accent'], v.accent), `${t} primary button`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(v.text, v.selected), `${t} selected text`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(v.accent, v.selected), `${t} selected accent`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(v.danger, v.panel), `${t} danger button`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('AC9 header red and TURN-039 status inks are unchanged', () => {
    for (const t of ['A', 'B', 'C'] as const) {
      expect(THEMES[t].vars['header-bg'].toUpperCase()).toBe('#A20034');
      expect(THEMES[t].vars['header-fg'].toUpperCase()).toBe('#FFFFFF');
      expect(THEMES[t].vars['header-muted'].toUpperCase()).toBe('#F5D6DE');
      expect(THEMES[t].vars['header-border'].toUpperCase()).toBe('#FFFFFF');
    }
    expect(THEMES.A.vars.success).toBe('#176642');
    expect(THEMES.A.vars.warning).toBe('#8b4800');
    expect(THEMES.A.vars.danger).toBe('#b42336');
    expect(THEMES.B.vars.success).toBe('#88dfb1');
    expect(THEMES.B.vars.warning).toBe('#ffd18a');
    expect(THEMES.B.vars.danger).toBe('#ff9fab');
    expect(STATUS_COLOR.light).toEqual({ active: '#1a1a1a', done: '#176642', error: '#b42336', pending: '#5c5c5c', undetermined: '#1a4f8b', assumption: '#8b4800' });
    expect(STATUS_COLOR.dark).toEqual({ active: '#42d6cc', done: '#88dfb1', error: '#ff9fab', pending: '#b3c4d9', undetermined: '#b9d4ff', assumption: '#ffd18a' });
    expect(css).toMatch(/button\.danger::before \{ content: "✕ "; font-weight: 700; \}/);
    expect(css).toMatch(/border: 1px solid var\(--danger\)/);
    expect(css).toMatch(/\.qty input\.num \{ width: 108px; padding-right: 40px;/);
  });
});

describe('TURN-077 diagram ink added to the TURN-045 contrast check', () => {
  const slotCss = readFileSync('src/ui/slot-theme.css', 'utf8');
  const canvas = readFileSync('src/ui/Canvas.tsx', 'utf8');
  const symbols = readFileSync('src/ui/Symbols.tsx', 'utf8');
  const sfc = readFileSync('src/ui/SfcView.tsx', 'utf8');
  const lightKept = {
    bg: '#f3f3f3', panel: '#ffffff', canvas: '#f6f6f6', border: '#8c8c8c', text: '#1c1c1c', muted: '#5c5c5c',
    accent: '#1a1a1a', selected: '#e6e6e6', success: '#176642', warning: '#8b4800', danger: '#b42336', grid: '#8c8c8c',
  };
  const darkKept = {
    bg: '#101b2a', panel: '#19283a', canvas: '#101b2a', border: '#5c8496', text: '#eff5fd', muted: '#b3c4d9',
    accent: '#42d6cc', selected: '#203d4c', success: '#88dfb1', warning: '#ffd18a', danger: '#ff9fab', grid: '#5c8496',
  };

  it('AC1 AC2 device, flow, signal, port, position, and SFC inks clear 3:1, and light values stay', () => {
    for (const [key, value] of Object.entries(lightKept)) expect(THEMES.A.vars[key], key).toBe(value);
    for (const [key, value] of Object.entries(darkKept)) expect(THEMES.B.vars[key], key).toBe(value);
    expect(THEMES.A.vars.focus).toBe('#1a1a1a');
    expect(THEMES.B.vars.focus).toBe('#42d6cc');
    expect(slotCss).toContain('stroke: #8FB4FF');
    expect(slotCss).toContain('fill: #243448');
    expect(readFileSync('src/ui/slots/gantry.svg', 'utf8')).toContain('stroke="#2C2C2C"');
    expect(readFileSync('src/ui/slots/gantry.svg', 'utf8')).toContain('fill="#E6E6E6"');
    expect(symbols).toContain("const s = 'var(--text)'");
    expect(symbols).toContain("'var(--muted)'");
    expect(canvas).toContain("edgePaint('flow', tone, !!selected, 'var(--text)')");
    expect(canvas).toContain("on ? 'var(--success)' : 'var(--muted)'");
    expect(canvas).toContain("stroke={ps.assumption ? 'var(--status-assumption)' : 'var(--text)'}");
    expect(sfc).toContain('stroke="var(--text)"');
    expect(sfc).not.toMatch(/timing-chart|TimingChart/);

    const surfaces = (t: 'A' | 'B') => [THEMES[t].vars.bg, THEMES[t].vars.panel, THEMES[t].vars.canvas];
    for (const t of ['A', 'B'] as const) {
      const v = THEMES[t].vars;
      for (const bg of surfaces(t)) {
        expect(ratio(v.text, bg), `${t} device and flow and SFC line`).toBeGreaterThanOrEqual(3);
        expect(ratio(v.muted, bg), `${t} signal line`).toBeGreaterThanOrEqual(3);
        expect(ratio(v.accent, bg), `${t} port ring`).toBeGreaterThanOrEqual(3);
        expect(ratio(v.success, bg), `${t} live signal`).toBeGreaterThanOrEqual(3);
        expect(ratio(v.warning, bg), `${t} position legend`).toBeGreaterThanOrEqual(3);
        expect(ratio(v.text, bg), `${t} diagram text`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(v.muted, bg), `${t} muted diagram text`).toBeGreaterThanOrEqual(4.5);
      }
      for (const key of ['active', 'done', 'error', 'pending', 'undetermined', 'assumption'] as const) {
        for (const bg of surfaces(t)) {
          expect(ratio(STATUS_COLOR[t === 'B' ? 'dark' : 'light'][key], bg), `${t} ${key}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
    for (const bg of ['#19283a', '#101b2a', '#203d4c', '#243448']) {
      expect(ratio('#8FB4FF', bg), `dark card stroke on ${bg}`).toBeGreaterThanOrEqual(3);
    }
    for (const bg of ['#ffffff', '#f6f6f6', '#e6e6e6', '#E6E6E6']) {
      expect(ratio('#2C2C2C', bg), `light card stroke on ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('TURN-045 danger buttons and quantities', () => {
  it('AC1 AC2 delete buttons share the danger class and sit at the right end; run reset does not', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]')!);
    await u.click(u.el.querySelector('#layout-tab-diagram')!);
    const toolButtons = [...u.el.querySelector('.diagram-tools')!.querySelectorAll(':scope > button')];
    const lastTool = toolButtons[toolButtons.length - 1];
    expect(lastTool.classList.contains('danger')).toBe(true);
    expect(lastTool.textContent!.trim()).toBe('삭제');
    expect(toolButtons.slice(0, -1).some((b) => b.classList.contains('danger'))).toBe(false);
    const prop = u.el.querySelector('.prop-actions')!;
    expect(prop.lastElementChild!.classList.contains('danger')).toBe(true);
    expect(prop.lastElementChild!.textContent!.trim()).toBe('삭제 영향 확인');
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    const reset = u.btn('⟲ 초기화');
    expect(reset.classList.contains('danger')).toBe(false);
    const words = [...u.el.querySelectorAll('button.danger')].map((b) => (b.textContent ?? '').trim());
    expect(words.length).toBeGreaterThan(0);
    for (const word of words) expect(word).toMatch(/[가-힣]/);
  });

  it('AC3 a used action shows the step count and deletes only after confirm; an unused action deletes at once', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    await u.click(u.el.querySelector('.stepper [data-stepid="attributes"]')!);
    await u.click(u.el.querySelector('[data-tree-id="PSH-01"]')!);
    const fold = foldOf(u.el, '정의 체크');
    await u.click([...fold.querySelectorAll('.tabs button')].find((b) => /^Action /.test(b.textContent ?? ''))!);
    const note = fold.querySelector('[data-delete-impact]')!;
    expect(note.textContent).toMatch(/단계 \d+에서 쓰임/);
    const before = u.history().present.revision;
    const actionId = u.history().present.actions.find((a) => a.deviceId === 'PSH-01')!.id;
    await u.click(u.btn('Action 삭제', fold));
    const modal = () => u.el.querySelector('.modal');
    expect(modal()?.textContent).toContain(note.textContent);
    expect(document.activeElement?.textContent).toContain('취소');
    await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(u.history().present.actions.some((a) => a.id === actionId)).toBe(true);
    expect(u.history().present.revision).toBe(before);
    await u.click(u.btn('삭제', modal()!));
    expect(u.history().present.actions.some((a) => a.id === actionId)).toBe(false);
    expect(u.history().present.sequence.steps.some((s) => s.actionId === actionId)).toBe(false);
    await u.click(u.el.querySelector('[aria-label="실행 취소"]')!);
    expect(u.history().present.actions.some((a) => a.id === actionId)).toBe(true);
    expect(u.history().present.sequence.steps.some((s) => s.actionId === actionId)).toBe(true);

    await u.click(u.el.querySelector('[data-tree-id="CYL-01"]')!);
    const again = foldOf(u.el, '정의 체크');
    await u.click([...again.querySelectorAll('.tabs button')].find((b) => /^Action /.test(b.textContent ?? ''))!);
    expect(again.querySelector('[data-delete-impact]')).toBeNull();
    const idle = u.history().present.actions.find((a) => a.deviceId === 'CYL-01')!.id;
    const rev = u.history().present.revision;
    await u.click(u.btn('Action 삭제', again));
    expect(u.el.querySelector('.modal')).toBeNull();
    expect(u.history().present.actions.some((a) => a.id === idle)).toBe(false);
    expect(u.history().present.revision).toBe(rev + 1);
  });

  it('AC4 a signal used in a condition, a position used by a step, and a flow step confirm; unused ones delete at once', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    await u.click(u.el.querySelector('.stepper [data-stepid="attributes"]')!);
    await u.click(u.el.querySelector('[data-tree-id="STP-02"]')!);
    const fold = foldOf(u.el, '정의 체크');
    await u.click([...fold.querySelectorAll('.tabs button')].find((b) => (b.textContent ?? '').startsWith('신호'))!);
    const sigRow = [...fold.querySelectorAll('[data-delete-impact]')].find((n) => (n.textContent ?? '').includes('조건'))!.parentElement!;
    const sigName = (sigRow.parentElement!.querySelector('input') as HTMLInputElement).value;
    const sig = u.history().present.signals.find((s) => s.name === sigName)!;
    await u.click(sigRow.querySelector('button.danger')!);
    expect(u.el.querySelector('.modal')!.textContent).toContain('조건');
    expect(document.activeElement?.textContent).toContain('취소');
    await u.click(u.btn('취소', u.el.querySelector('.modal')!));
    expect(u.history().present.signals.some((s) => s.id === sig.id)).toBe(true);
    await u.click(sigRow.querySelector('button.danger')!);
    await u.click(u.btn('삭제', u.el.querySelector('.modal')!));
    expect(u.history().present.signals.some((s) => s.id === sig.id)).toBe(false);
    expect(u.history().present.actions.some((a) => a.pre.concat(a.post).some((c) => c.kind === 'signal' && c.signalId === sig.id))).toBe(false);

    const addedBefore = u.history().present.signals.length;
    await u.click(u.btn('+ 센서', fold));
    expect(u.history().present.signals.length).toBe(addedBefore + 1);
    const signals = u.history().present.signals;
    const fresh = signals[signals.length - 1];
    const nameInput = [...fold.querySelectorAll('input')].find((node) => (node as HTMLInputElement).value === fresh.name) as HTMLInputElement;
    let freshBlock: HTMLElement | null = nameInput;
    while (freshBlock && !freshBlock.querySelector('button.danger')) freshBlock = freshBlock.parentElement;
    expect(freshBlock!.querySelector('[data-delete-impact]')).toBeNull();
    await u.click(freshBlock!.querySelector('button.danger')!);
    expect(u.el.querySelector('.modal')).toBeNull();
    expect(u.history().present.signals.some((s) => s.id === fresh.id)).toBe(false);

    await u.click(u.el.querySelector('[data-tree-id="GNT-04"]')!);
    const posFold = foldOf(u.el, '정의 체크');
    await u.click([...posFold.querySelectorAll('.tabs button')].find((b) => (b.textContent ?? '').startsWith('포지션'))!);
    const usedPos = [...posFold.querySelectorAll('[data-delete-impact]')].find((n) => (n.textContent ?? '').includes('단계'))!.parentElement!;
    const posName = usedPos.querySelector('input')!.value;
    const pos = u.history().present.positions.find((x) => x.name === posName)!;
    await u.click(usedPos.querySelector('button.danger')!);
    expect(u.el.querySelector('.modal')!.textContent).toMatch(/단계 \d+에서 쓰임/);
    await u.click(u.btn('삭제', u.el.querySelector('.modal')!));
    expect(u.history().present.positions.some((x) => x.id === pos.id)).toBe(false);
    expect(u.history().present.actions.find((a) => a.deviceId === 'GNT-04')!.targetPositionId).toBeNull();
    const idlePos = [...posFold.querySelectorAll('.section .row')].find((row) => row.querySelector('button.danger') && !row.querySelector('[data-delete-impact]'))!;
    const idleName = idlePos.querySelector('input')!.value;
    const idle = u.history().present.positions.find((x) => x.name === idleName)!;
    await u.click(idlePos.querySelector('button.danger')!);
    expect(u.el.querySelector('.modal')).toBeNull();
    expect(u.history().present.positions.some((x) => x.id === idle.id)).toBe(false);

    await u.click(u.el.querySelector('.stepper [data-stepid="sequence"]')!);
    const seq = foldOf(u.el, '단계 편집');
    const stepId = u.history().present.sequence.steps[0].id;
    expect(seq.querySelector('[data-delete-impact]')).toBeNull();
    await u.click(seq.querySelector('button.danger')!);
    expect(u.el.querySelector('.modal')).toBeNull();
    expect(u.history().present.sequence.steps.some((s) => s.id === stepId)).toBe(false);
  });

  it('AC4 a step that sits in the flow shows the count and waits for confirm', async () => {
    const u = await mount();
    await u.click(u.el.querySelector('[data-sample-open="flow"]')!);
    await u.click(u.el.querySelector('.stepper [data-stepid="sequence"]')!);
    const seq = foldOf(u.el, '단계 편집');
    const note = seq.querySelector('[data-delete-impact]')!;
    expect(note.textContent).toMatch(/흐름 \d+에서 쓰임/);
    const stepId = u.history().present.sequence.steps.find((s) => note.closest('tr')!.textContent!.includes(s.name))!.id;
    await u.click(note.parentElement!.querySelector('button.danger')!);
    expect(u.el.querySelector('.modal')!.textContent).toContain('흐름');
    expect(document.activeElement?.textContent).toContain('취소');
    await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(u.history().present.sequence.steps.some((s) => s.id === stepId)).toBe(true);
    await u.click(u.btn('삭제', u.el.querySelector('.modal')!));
    expect(u.history().present.sequence.steps.some((s) => s.id === stepId)).toBe(false);
  });

  it('AC5 every delete confirm opens with focus on 취소', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]')!);
    await u.click(u.el.querySelector('#layout-tab-diagram')!);
    await u.click(u.el.querySelector('[data-tree-id="U-S1"]')!);
    await u.click(u.btn('삭제', u.el.querySelector('.diagram-tools')!));
    const modal = u.el.querySelector('.modal')!;
    expect(modal.textContent).toContain('삭제');
    expect(document.activeElement?.textContent).toContain('취소');
    const rev = u.history().present.revision;
    await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(u.history().present.units.some((unit) => unit.id === 'U-S1')).toBe(true);
    expect(u.history().present.revision).toBe(rev);
  });

  it('AC6 AC7 the unit sits inside the field, and a bad draft does not change rev', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    await u.click(u.el.querySelector('.stepper [data-stepid="attributes"]')!);
    const time = u.el.querySelector('.qty[data-unit="s"]')!;
    expect(time.querySelector('.qty-unit')!.textContent).toBe('s');
    expect(time.querySelector('input.num')).toBeTruthy();
    const field = time.parentElement!;
    expect(field.querySelector('.status-assumption, .qty-assume')).toBeTruthy();
    const input = time.querySelector('input.num') as HTMLInputElement;
    const rev = u.history().present.revision;
    await u.typeNum(input, '123456789.25');
    expect(time.querySelector('.qty-unit')!.textContent).toBe('s');
    expect(u.el.querySelector('.qty-error')).toBeNull();
    expect(u.history().present.revision).toBe(rev + 1);
    const held = u.history().present.revision;
    await u.typeNum(input, 'abc');
    expect(u.el.querySelector('.qty-error')!.textContent).toBe('숫자가 아닙니다');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(u.history().present.revision).toBe(held);
    await u.typeNum(input, '-2');
    expect(u.el.querySelector('.qty-error')!.textContent).toBe('음수는 허용되지 않습니다');
    expect(u.history().present.revision).toBe(held);
    await u.typeNum(input, '');
    expect(u.el.querySelector('.qty-error')).toBeNull();
    expect(field.querySelector('[data-status="undetermined"]')).toBeTruthy();

    await u.click(u.el.querySelector('[data-tree-id="U-S1"]')!);
    const count = foldOf(u.el, '정의 체크').querySelector('.qty[data-unit="ea"] input.num') as HTMLInputElement;
    const beforeCount = u.history().present.revision;
    await u.typeNum(count, '1.5');
    expect(u.el.querySelector('.qty-error')!.textContent).toBe('개수는 정수만 됩니다');
    expect(u.history().present.revision).toBe(beforeCount);
    expect(u.history().present.units.find((unit) => unit.id === 'U-S1')!.capacity.maxMaterials.value).not.toBe(1.5);
  });
});
