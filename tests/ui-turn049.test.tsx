// @vitest-environment jsdom
// TURN-049 flow editor, readiness jump, and the run-step pause controls.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { findById } from '../src/model/flow';
import type { History } from '../src/model/history';
import { buildParallelSampleProject } from '../src/model/sample';
import * as C from '../src/model/commands';
import { advance, createRuntime, pauseSubstation, start } from '../src/runtime/engine';
import { App } from '../src/ui/App';
import { RunDetails } from '../src/ui/RunDetails';
import { RunStepsPanel } from '../src/ui/RunInfoPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  const click = async (node: Element | undefined) => {
    if (!node) throw new Error('missing control');
    await act(async () => { (node as HTMLElement).click(); });
  };
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label);
  const flowTable = () => el.querySelector('table[aria-label="Station 흐름"]') as HTMLTableElement;
  const row = (kind: string) => flowTable().querySelector(`tr[data-flow-kind="${kind}"]`) as HTMLTableRowElement;
  const typeInto = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  return { el, click, btn, flowTable, row, typeInto, history: () => seen.h! };
}

describe('TURN-049 flow editor and run controls', () => {
  it('AC5 AC7 adds, edits, moves, and deletes a wait, and a missing timeout jumps to that row', async () => {
    const u = await mount();
    await u.click(u.btn('흐름 예제'));
    await u.click(u.el.querySelector('.stepper [data-stepid="sequence"]')!);
    const rev = u.history().present.revision;
    await u.click(u.btn('신호 기다림 추가'));
    expect(u.history().present.revision).toBe(rev + 1);
    const row = u.row('wait');
    expect(row.querySelector('b')!.textContent).toBe('신호 기다림');
    const name = row.querySelector('input[aria-label="신호 기다림 이름"]') as HTMLInputElement;
    await u.typeInto(name, '도착 기다림');
    await act(async () => { name.blur(); });
    expect((u.row('wait').querySelector('input[aria-label="신호 기다림 이름"]') as HTMLInputElement).value).toBe('도착 기다림');
    const select = u.row('wait').querySelector('select[aria-label="조건"]') as HTMLSelectElement;
    const option = [...select.options].find((o) => o.value.startsWith('sig:') && o.value.endsWith(':1'));
    expect(option).toBeTruthy();
    await act(async () => {
      select.value = option!.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const timeout = u.row('wait').querySelector('input[aria-label="기다림 타임아웃"]') as HTMLInputElement;
    await u.typeInto(timeout, '3');
    const edited = findById(u.history().present.sequence.flow!, u.row('wait').getAttribute('data-flow-id')!)!.node;
    expect(edited.kind).toBe('wait');
    if (edited.kind !== 'wait') return;
    expect(edited.cond.kind).toBe('signal');
    expect(edited.timeout.value).toBe(3);
    await u.click(u.btn('위로', u.row('wait')));
    const afterMove = u.history().present.sequence.flow!;
    expect(afterMove[afterMove.length - 1]?.kind).not.toBe('wait');
    await u.click(u.el.querySelector('[aria-label="실행 취소"]')!);
    const afterUndo = u.history().present.sequence.flow!;
    expect(afterUndo[afterUndo.length - 1]?.kind).toBe('wait');
    await u.click(u.btn('삭제', u.row('wait')));
    expect(u.flowTable().querySelector('tr[data-flow-kind="wait"]')).toBeNull();
    await u.click(u.el.querySelector('[aria-label="실행 취소"]')!);
    const id = u.row('wait').getAttribute('data-flow-id')!;
    const cleared = u.row('wait').querySelector('input[aria-label="기다림 타임아웃"]') as HTMLInputElement;
    await u.typeInto(cleared, '');
    await u.click(u.btn('SFC 미리보기'));
    const sfc = u.el.querySelector('svg[aria-label="SFC 미리보기"]')!;
    expect(sfc.querySelector(`[data-sfc-wait="${id}"]`)!.textContent).toContain('신호 기다림');
    expect(sfc.textContent).toMatch(/=/);
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    const move = u.el.querySelector('button[data-blocker-code="WAIT_TIMEOUT_UNDEFINED"]') as HTMLButtonElement;
    expect(move).toBeTruthy();
    await u.click(move);
    const flashed = u.el.querySelector(`tr[data-jump="flow:${id}"]`);
    expect(flashed?.classList.contains('jump-flash') || u.el.querySelector('.jump-flash')).toBeTruthy();
  });

  it('AC13 shows a wait row, a Substation pause button, the hold notice, and the log', async () => {
    const base = buildParallelSampleProject();
    const ids = base.sequence.flow!.map((n) => (n.kind === 'step' ? n.stepId : n.id));
    const wrapped = C.wrapFlow(base, ids, 'parallel', () => 'FLW-BOTH');
    expect(wrapped.ok).toBe(true);
    if (!wrapped.ok) return;
    const p = wrapped.project;
    const sig = p.signals.find((s) => s.role === 'result') ?? p.signals[0];
    p.sequence.flow = [
      ...(p.sequence.flow ?? []),
      { kind: 'wait', id: 'FLW-WAIT', name: '신호 기다림', cond: { kind: 'signal', signalId: sig.id, equals: true }, timeout: { value: 1, unit: 's', assumption: true } },
    ];
    // The wait sits after the parallel, so it has not started. Drive the Substation pause on its own.
    let rt = start(createRuntime(p));
    rt = advance(rt, 100);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const paint = async (runtime = rt) => {
      await act(async () => {
        root!.render(<>
          <RunStepsPanel p={p} rt={runtime.state} selectedId={null} folded={false} onToggleFold={() => {}} onPauseSubstation={(id) => { rt = pauseSubstation(runtime, id); }} onResumeSubstation={() => {}} />
          <RunDetails p={p} rt={runtime.state} open tab="log" onToggle={() => {}} onTab={() => {}} />
        </>);
      });
    };
    root = createRoot(host);
    await paint();
    const pauseBtn = host.querySelector('button[data-sub-pause="FLW-SUB-S1"]') as HTMLButtonElement;
    expect(pauseBtn.textContent).toContain('일시정지');
    await act(async () => { pauseBtn.click(); });
    rt = pauseSubstation(rt, 'FLW-SUB-S1');
    await paint(rt);
    expect(host.querySelector('[data-sub-hold]')!.textContent).toContain('Substation 1개 일시정지 중');
    expect(host.querySelector('button[data-sub-resume="FLW-SUB-S1"]')!.textContent).toBe('재개');
    expect(host.textContent).toContain('일시정지');
    expect(host.querySelector('[aria-label="실행 로그"]')!.textContent).toContain('SUB_PAUSE');

    const waiting = buildParallelSampleProject();
    const step = waiting.actions[0];
    waiting.sequence.steps = [];
    waiting.sequence.flow = [{
      kind: 'wait', id: 'FLW-WAIT', name: '신호 기다림',
      cond: { kind: 'signal', signalId: step.completeSignalId ?? waiting.signals[0].id, equals: true },
      timeout: { value: 2, unit: 's', assumption: true },
    }];
    const held = advance(start(createRuntime(waiting)), 50);
    await act(async () => {
      root!.render(<RunStepsPanel p={waiting} rt={held.state} selectedId={null} folded={false} onToggleFold={() => {}} />);
    });
    const waitRow = host.querySelector('[data-wait="true"]')!;
    expect(waitRow.textContent).toContain('신호 기다림');
    expect(waitRow.textContent).toContain('대기');
    expect(host.querySelector('[aria-label="실행 로그"]')).toBeNull();
    const logHost = document.createElement('div');
    host.appendChild(logHost);
    await act(async () => {
      root!.render(<>
        <RunStepsPanel p={waiting} rt={held.state} selectedId={null} folded={false} onToggleFold={() => {}} />
        <RunDetails p={waiting} rt={held.state} open tab="log" onToggle={() => {}} onTab={() => {}} />
      </>);
    });
    const log = host.querySelector('[aria-label="실행 로그"]')!.textContent ?? '';
    expect(log).toContain('WAIT_START');
    expect(host.querySelector('[data-wait="true"]')!.textContent).toContain('= ON');
  });
});
