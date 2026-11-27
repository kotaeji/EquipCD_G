// @vitest-environment jsdom
// TURN-090. Flow-table density. jsdom has no layout, so table width is set on clientWidth.
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import * as C from '../src/model/commands';
import { SUB_NO_PARALLEL, SUB_NO_SUBSTEP } from '../src/model/commands';
import type { History } from '../src/model/history';
import { App } from '../src/ui/App';
import { PALETTE_LABEL } from '../src/ui/CommandPalette';
import { visibleCommands, blankCommandState } from '../src/ui/commandModel';
import { buildParallelSampleProject } from '../src/model/sample';
import {
  FLOW_TABLE_WIDE,
  SEQ_CARD_MIN,
  flowRowActionsCompact,
  seqColumnCount,
} from '../src/ui/flowTableLayout';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MENU = ['up', 'down', 'out', 'into', 'wrapBranch', 'wrapParallel', 'wrapLoop', 'wrapRetry', 'unwrap', 'rename', 'openAction', 'delete'];

type Watch = { cb: ResizeObserverCallback; target: Element };
let watched: Watch[] = [];
let restoreObserver: (() => void) | null = null;
let root: Root | null = null;

function installObserver() {
  restoreObserver?.();
  restoreObserver = null;
  watched = [];
  const previous = globalThis.ResizeObserver;
  class RO {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) { this.cb = cb; }
    observe(target: Element) {
      watched.push({ cb: this.cb, target });
      this.cb([{ target } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = RO as unknown as typeof ResizeObserver;
  restoreObserver = () => { globalThis.ResizeObserver = previous; };
}

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  localStorage.clear();
  restoreObserver?.();
  restoreObserver = null;
  watched = [];
});

async function mount() {
  installObserver();
  localStorage.clear();
  const el = document.createElement('div');
  document.body.appendChild(el);
  const seen: { h: History | null } = { h: null };
  root = createRoot(el);
  await act(async () => { root!.render(<App onHistory={(h) => { seen.h = h; }} />); });
  const click = async (node: Element | null | undefined) => {
    if (!node) throw new Error('missing control');
    await act(async () => { (node as HTMLElement).click(); });
  };
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim() === label || b.getAttribute('aria-label') === label) as HTMLButtonElement | undefined;
  const flowTable = () => el.querySelector('table[aria-label="Station 흐름"]') as HTMLTableElement;
  const rows = (kind: string, table: ParentNode = flowTable()) => [...table.querySelectorAll<HTMLTableRowElement>(`tbody tr[data-flow-kind="${kind}"]`)];
  const setWidth = async (table: HTMLElement, width: number) => {
    await act(async () => {
      Object.defineProperty(table, 'clientWidth', { configurable: true, get: () => width });
      const hits = watched.filter((w) => w.target === table);
      const hit = hits[hits.length - 1];
      if (!hit) throw new Error('flow table is not observed');
      hit.cb([{ target: table } as unknown as ResizeObserverEntry], {} as ResizeObserver);
    });
  };
  const menu = () => document.querySelector('[data-ctx-menu]') as HTMLElement | null;
  const actions = () => [...(menu()?.querySelectorAll<HTMLButtonElement>('[data-action]') ?? [])].map((b) => b.getAttribute('data-action'));
  const key = async (target: EventTarget, keyName: string) => {
    await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true })); });
  };
  const right = async (node: Element) => {
    await act(async () => { node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20, button: 2 })); });
  };
  const typeQuery = async (value: string) => {
    const input = el.querySelector(`[role="dialog"][aria-label="${PALETTE_LABEL}"] input`) as HTMLInputElement;
    await act(async () => {
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  return { el, click, btn, flowTable, rows, setWidth, menu, actions, key, right, typeQuery, history: () => seen.h!, rev: () => seen.h!.present.revision };
}

async function openFlow() {
  const u = await mount();
  await u.click(u.el.querySelector('[data-sample-open="flow"]'));
  await u.click(u.el.querySelector('.stepper [data-stepid="sequence"]'));
  return u;
}

async function openSubseq() {
  const u = await mount();
  await u.click(u.el.querySelector('[data-sample-open="parallel"]'));
  await u.click(u.el.querySelector('.stepper [data-stepid="sequence"]'));
  await u.click([...u.el.querySelectorAll('.subtabs button')].find((b) => (b.textContent ?? '').includes('Substation 시퀀스')));
  return u;
}

describe('TURN-090 flow table density', () => {
  it('folds row buttons by table width', () => {
    expect(flowRowActionsCompact(0)).toBe(false);
    expect(flowRowActionsCompact(FLOW_TABLE_WIDE - 1)).toBe(true);
    expect(flowRowActionsCompact(FLOW_TABLE_WIDE)).toBe(false);
    expect(SEQ_CARD_MIN).toBe(32 * 16);
    expect(seqColumnCount(900)).toBe(1);
    expect(seqColumnCount(SEQ_CARD_MIN * 2 + 12)).toBe(2);
    expect(seqColumnCount(400)).toBe(1);
  });

  it('AC2 a narrow table shows one ⋯ menu with the same items and order as the row menu', async () => {
    const u = await openFlow();
    const table = u.flowTable();
    const row = u.rows('step')[1];
    await u.setWidth(table, FLOW_TABLE_WIDE - 1);
    expect(table.getAttribute('data-flow-compact')).toBe('1');
    expect(row.querySelector('[data-flow-more]')?.getAttribute('aria-label')).toBe('⋯');
    expect([...row.querySelectorAll('button')].some((b) => (b.textContent ?? '').trim() === '위로')).toBe(false);
    await u.click(row.querySelector('[data-flow-more]'));
    const fromMore = u.actions();
    expect(fromMore).toEqual(MENU);
    expect(u.menu()?.querySelector('[data-action="unwrap"]')!.getAttribute('title')).toBe('블록 없음');
    expect(u.menu()?.querySelector('[data-action="delete"]')!.classList.contains('danger')).toBe(true);
    await u.key(window, 'Escape');
    await u.right(row);
    expect(u.actions()).toEqual(fromMore);

    await u.setWidth(table, FLOW_TABLE_WIDE);
    expect(table.getAttribute('data-flow-compact')).toBe('0');
    expect(row.querySelector('[data-flow-more]')).toBeNull();
    expect([...row.querySelectorAll('button')].some((b) => (b.textContent ?? '').trim() === '위로')).toBe(true);
  });

  it('AC3 Enter, arrows, and Esc open and close the ⋯ menu and focus returns', async () => {
    const u = await openFlow();
    const row = u.rows('step')[1];
    const rev = u.rev();
    await u.setWidth(u.flowTable(), 400);
    const more = row.querySelector<HTMLButtonElement>('[data-flow-more]')!;
    more.focus();
    await u.key(more, 'Enter');
    expect(u.menu()?.getAttribute('data-ctx-kind')).toBe('flow-step');
    expect(document.activeElement?.getAttribute('data-action')).toBe('up');
    await u.key(window, 'ArrowDown');
    expect(document.activeElement?.getAttribute('data-action')).toBe('down');
    await u.key(window, 'ArrowUp');
    expect(document.activeElement?.getAttribute('data-action')).toBe('up');
    await u.key(window, 'Escape');
    expect(u.menu()).toBeNull();
    expect(document.activeElement).toBe(more);
    expect(u.rev()).toBe(rev);

    more.focus();
    await u.key(more, ' ');
    expect(u.menu()).toBeTruthy();
    await u.key(window, 'Enter');
    expect(u.menu()).toBeNull();
    expect(u.rev()).toBe(rev + 1);
  });

  it('AC4 depths 1, 2, and 3 share one step and both flow tables use flow-name', async () => {
    const css = readFileSync('src/ui/flow-table.css', 'utf8');
    expect(css).toContain('--flow-step: var(--sp-4)');
    expect(css).toContain('padding-left: calc(var(--sp-2) + (var(--flow-depth, 0) * var(--flow-step)))');
    expect(css).toContain('repeating-linear-gradient');
    expect(css).toContain('height: var(--sp-6)');
    const names = (table: ParentNode) => [...table.querySelectorAll<HTMLTableCellElement>('td.flow-name')];
    const depths = (table: ParentNode) => new Set(names(table).map((cell) => cell.style.getPropertyValue('--flow-depth')));

    const station = await openFlow();
    const stationCells = names(station.flowTable());
    expect(stationCells.length).toBeGreaterThan(0);
    for (const cell of stationCells) {
      expect(cell.classList.contains('flow-name')).toBe(true);
      expect(cell.style.getPropertyValue('--flow-depth')).toBe(cell.parentElement!.getAttribute('data-depth'));
    }
    const got = depths(station.flowTable());
    expect(got.has('1') && got.has('2') && got.has('3')).toBe(true);
    expect(station.flowTable().querySelector('td.flow-name')!.className).toBe('flow-name');

    await act(async () => { root!.unmount(); });
    root = null;
    document.body.innerHTML = '';
    const sub = await openSubseq();
    const card = sub.el.querySelector('section.seqcard') as HTMLElement;
    const table = card.querySelector('table[data-flow-home="substation"]') as HTMLTableElement;
    const boxes = () => [...table.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    await sub.click(boxes()[0]);
    await sub.click(sub.btn('반복으로 묶기', card));
    await sub.click(table.querySelector('tr[data-flow-kind="step"] input[type="checkbox"]'));
    await sub.click(sub.btn('분기로 묶기', card));
    const subCells = names(table);
    expect(subCells.every((cell) => cell.classList.contains('flow-name'))).toBe(true);
    const subDepths = new Set(subCells.map((cell) => cell.style.getPropertyValue('--flow-depth')));
    expect(subDepths.has('1') && subDepths.has('2') && subDepths.has('3')).toBe(true);
    expect(table.querySelector('td.flow-name')!.className).toBe('flow-name');
  });

  it('AC5 cards use one minimum and stack when a card would be narrower', () => {
    const css = readFileSync('src/ui/substation-panels.css', 'utf8');
    expect(css).toContain('--seq-card-min: calc(var(--sp-6) * 16)');
    expect(css).toContain('repeat(auto-fill, minmax(min(100%, var(--seq-card-min)), 1fr))');
    expect(css).toContain('overflow: clip');
    expect(seqColumnCount(SEQ_CARD_MIN * 2)).toBe(1);
    expect(seqColumnCount(SEQ_CARD_MIN * 2 + 12)).toBe(2);
  });

  it('AC5 the sequence grid publishes that minimum', async () => {
    const u = await openSubseq();
    const grid = u.el.querySelector('.seqgrid') as HTMLElement;
    expect(grid.getAttribute('data-seq-card-min')).toBe(String(SEQ_CARD_MIN));
    expect(u.el.querySelectorAll('.seqcard').length).toBeGreaterThan(1);
    expect(grid.querySelector('table[data-flow-home="substation"] td.flow-name')).toBeTruthy();
  });

  it('AC6 Substation sequence turns off parallel and a Substation step, including the menu and command search', async () => {
    const u = await openSubseq();
    const card = u.el.querySelector('section.seqcard') as HTMLElement;
    const parallel = u.btn('병렬로 묶기', card)!;
    const subStep = u.btn('Substation 시퀀스 넣기', card)!;
    expect(parallel.disabled).toBe(true);
    expect(parallel.title).toBe(SUB_NO_PARALLEL);
    expect(subStep.disabled).toBe(true);
    expect(subStep.title).toBe(SUB_NO_SUBSTEP);
    const rev = u.rev();
    await u.right(card.querySelector('tbody tr')!);
    const wrap = u.menu()!.querySelector<HTMLButtonElement>('[data-action="wrapParallel"]')!;
    expect(wrap.disabled).toBe(true);
    expect(wrap.title).toBe(SUB_NO_PARALLEL);
    expect(u.actions()).toEqual(MENU);
    await u.key(window, 'Escape');

    await u.click(u.btn(PALETTE_LABEL));
    await u.typeQuery('병렬로 묶기');
    const paletteParallel = u.el.querySelector('[data-command="wrap-parallel"]') as HTMLButtonElement;
    expect(paletteParallel.getAttribute('aria-disabled')).toBe('true');
    expect(paletteParallel.title).toBe(SUB_NO_PARALLEL);
    await u.typeQuery('Substation 시퀀스 넣기');
    const paletteSub = u.el.querySelector('[data-command="add-substation"]') as HTMLButtonElement;
    expect(paletteSub.getAttribute('aria-disabled')).toBe('true');
    expect(paletteSub.title).toBe(SUB_NO_SUBSTEP);
    expect(u.rev()).toBe(rev);

    const project = buildParallelSampleProject();
    const seqId = project.substationSequences![0].id;
    const stepId = project.substationSequences![0].steps[0].id;
    expect(C.wrapFlow(project, [stepId], 'parallel', () => 'P', seqId)).toEqual({ ok: false, reason: SUB_NO_PARALLEL });
    expect(C.addSubstationNode(project, project.units[0].id, () => 'S', seqId)).toEqual({ ok: false, reason: SUB_NO_SUBSTEP });
    const state = blankCommandState(project, { step: 'sequence', flowHome: 'substation', flowPicked: [stepId] });
    expect(visibleCommands(state, '병렬로 묶기').find((r) => r.id === 'wrap-parallel')).toMatchObject({ ok: false, reason: SUB_NO_PARALLEL });
    expect(visibleCommands(state, 'Substation 시퀀스 넣기').find((r) => r.id === 'add-substation')).toMatchObject({ ok: false, reason: SUB_NO_SUBSTEP });
    const station = blankCommandState(project, { step: 'sequence', flowPicked: [stepId] });
    expect(visibleCommands(station, '병렬로 묶기').find((r) => r.id === 'wrap-parallel')!.ok).toBe(true);
  });
});
