// @vitest-environment jsdom
// TURN-001 (rev 2) jsdom tests (NOT a real browser): 6단계 group-run blocker list → per-object guidance + move button.
// Evidence: real gate Diagnostics (fixtures), real React clicks, deep equality of the whole undo history
// (past/present/future/labels) before/after navigation, Undo/Redo restoration, and the group run target kept (H3).
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { History } from '../src/model/history';
import { buildParallelSampleProject } from '../src/model/sample';
import { checkGroupReadiness } from '../src/runtime/group';
import { saveProject } from '../src/storage/localStore';
import { App } from '../src/ui/App';
import { guideCopy, resolveBlocker } from '../src/ui/blockerTarget';
import { FIXTURES, S1 } from './fixtures/blocker-fixtures';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); root = null; document.body.innerHTML = ''; });

async function mount() {
  const el = document.createElement('div'); document.body.appendChild(el);
  const seen: { h: History | null } = { h: null };
  root = createRoot(el);
  await act(async () => { root!.render(<App onHistory={(h) => { seen.h = h; }} />); });
  const txt = () => el.textContent ?? '';
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(label))!;
  const click = async (b: Element) => { await act(async () => { (b as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
  const status = () => el.querySelector('.statusbar')!.textContent!;
  const appEl = el.querySelector('.app') as HTMLElement;
  const groupHeading = () => [...el.querySelectorAll('h4')].map((h) => h.textContent ?? '').find((t) => t.startsWith('그룹 실행 — ')) ?? '';
  const history = () => structuredClone(seen.h!);
  const toRunGroup = async () => { await click(el.querySelector('.stepper [data-stepid="run"]')!); await click(btn('Substation 그룹')); };
  return { el, txt, btn, click, status, appEl, groupHeading, history, toRunGroup };
}

describe('TURN-001 group-run blocker guidance (jsdom)', () => {
  const cases = FIXTURES.filter((f) => f.ui !== false).flatMap((f) => [false, true].map((pressRun) => ({ ...f, pressRun })));
  it.each(cases)('$name ($code) — ▶ pressed first: $pressRun', async (f) => {
    localStorage.clear();
    const p = buildParallelSampleProject(); f.mutate(p);
    expect(saveProject(localStorage, p).ok).toBe(true);
    const r = checkGroupReadiness(p, S1);
    const diag = r.blockers.find((b) => b.code === f.code)!;
    const g = resolveBlocker(p, diag, r.blockers);
    const copy = guideCopy(f.code, g);
    const u = await mount();
    expect(u.history().present.id).toBe(p.id); // the seeded project is the one on screen
    await u.toRunGroup();
    expect(u.groupHeading()).toContain('S1 듀얼 클램프');
    if (f.pressRun) { await u.click(u.btn('▶ 그룹 실행')); expect(u.status()).toContain('그룹 idle'); expect(u.txt()).toContain('그룹 실행 전 검사 차단'); }
    const item = [...u.el.querySelectorAll('.blocker-item')].find((li) => (li.textContent ?? '').includes(`[${f.code}]`) && li.getAttribute('data-guide-kind') === f.expect.kind)!;
    expect(item, 'blocker row with the expected guide kind').toBeDefined();
    expect(item.textContent).toContain(copy.lead.slice(0, 30));
    const b = item.querySelector('button[data-blocker-code]') as HTMLButtonElement | null;
    if (f.expect.kind === 'unsupported') expect(item.textContent).toContain('현재 화면에서 직접 편집 불가');
    if (!g.dest) { expect(b).toBeNull(); return; }
    expect(b!.textContent).toBe(copy.button);
    expect(b!.getAttribute('aria-label')).toBe(copy.aria);
    expect(b!.getAttribute('data-guide-kind')).toBe(g.kind);
    if (g.kind !== 'fix') expect(b!.getAttribute('aria-label')).not.toContain('원인 수정');
    const before = u.history();
    await u.click(b!);
    expect(u.appEl.dataset.step).toBe(g.dest.step);
    if (g.dest.sub) expect(u.el.querySelector('.subtabs button.on')!.textContent).toContain(g.dest.place.replace(/ \(F4\)$/, ''));
    if (g.focus) {
      if (g.focus.kind === 'device') expect([...u.el.querySelectorAll('.tabs button.on')].some((x) => (x.textContent ?? '').startsWith('Action'))).toBe(true);
      else expect(u.el.querySelector('.workspace')!.textContent).toContain('수용 개수'); // Unit inspector shows the capacity field directly (no tabs)
      const name = g.focus.kind === 'device' ? p.devices.find((d) => d.id === g.focus!.id)!.name : p.units.find((x) => x.id === g.focus!.id)!.name;
      expect(u.el.querySelector('.workspace')!.textContent).toContain(name);
    }
    expect(u.history()).toEqual(before); // whole history (past/present/future/labels) unchanged by navigation
    // H3: back on step 6 the group run target is still the original Substation and the blocker is still listed
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    expect(u.groupHeading()).toContain('S1 듀얼 클램프');
    expect([...u.el.querySelectorAll('.blocker-item')].some((li) => (li.textContent ?? '').includes(`[${f.code}]`))).toBe(true);
    expect(u.history()).toEqual(before);
  });

  it('UI-built DEVICE_CONFLICT: navigation keeps history deep-equal; Undo/Redo restore the exact projects', async () => {
    localStorage.clear();
    const u = await mount();
    await u.click(u.btn('+ 병렬 예제'));
    await u.click(u.el.querySelector('.stepper [data-stepid="sequence"]')!);
    await u.click(u.btn('Substation 시퀀스', u.el.querySelector('.subtabs')!));
    const cardA = [...u.el.querySelectorAll('.seqcard')].find((c) => [...c.querySelectorAll('input')].some((i) => (i as HTMLInputElement).value.includes('시퀀스 A')))!;
    const sel = cardA.querySelector('select[aria-label="추가할 Action"]') as HTMLSelectElement;
    const opt = [...sel.options].find((o) => o.text.includes('CYL-B1'))!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(sel, opt.value); sel.dispatchEvent(new Event('change', { bubbles: true })); });
    await u.click(u.btn('단계 추가', cardA));
    await u.toRunGroup();
    const before = u.history();
    expect(before.labels[before.labels.length - 1]).toBe('단계 추가');
    const go = u.el.querySelector('button[data-blocker-code="DEVICE_CONFLICT"]')!;
    expect(go.textContent).toBe('4 자재·시퀀스 › Substation 시퀀스 화면으로 이동');
    await u.click(u.btn('▶ 그룹 실행'));
    expect(u.status()).toContain('그룹 idle');
    await u.click(u.el.querySelector('button[data-blocker-code="DEVICE_CONFLICT"]')!);
    expect(u.appEl.dataset.step).toBe('sequence');
    expect(u.el.querySelector('.subtabs button.on')!.textContent).toMatch(/^Substation 시퀀스/);
    expect(u.history()).toEqual(before);
    await u.click(u.btn('↶'));
    expect(u.history().present).toEqual(before.past[before.past.length - 1]);
    await u.click(u.btn('↷'));
    expect(u.history().present).toEqual(before.present);
    expect(u.history().past).toEqual(before.past);
  });
});
