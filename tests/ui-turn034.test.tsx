// @vitest-environment jsdom
// TURN-034 flow table: stopped steps, shared status words, kind-only headings.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSampleProject } from '../src/model/sample';
import type { History } from '../src/model/history';
import type { Action, Project, SequenceStep } from '../src/model/types';
import { checkRunReadiness } from '../src/model/validate';
import { createRuntime, runToEnd, type RuntimeState } from '../src/runtime/engine';
import { stepStatusLabel } from '../src/runtime/runSummary';
import { App } from '../src/ui/App';
import { FlowEditor } from '../src/ui/FlowEditor';
import { SequencePanel } from '../src/ui/Panels';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  localStorage.clear();
});

const edit = () => true;

function clearMotion(a: Action, dur: number, timeout: number) {
  a.pre = [];
  a.post = [];
  a.effect = {};
  a.duration = { ...a.duration, value: dur };
  a.timeout = { ...a.timeout, value: timeout };
}

const stepOf = (id: string, name: string, actionId: string): SequenceStep =>
  ({ id, name, actionId, timeoutOverride: null, entry: [], origin: 'dnd' });

/** Lane 2 times out while lane 1 is still moving. */
function stoppedPair() {
  const p = buildSampleProject();
  const used = new Set(p.sequence.steps.map((s) => s.actionId));
  const long = p.actions.find((a) => a.deviceId === 'CYL-01')!;
  const free = p.actions.find((a) => a.deviceId === 'STP-05' && !used.has(a.id))!;
  clearMotion(long, 3, 5);
  clearMotion(free, 0.2, 0.2);
  const slow = stepOf('STEP-LONG', '긴 갈래', long.id);
  const other = stepOf('STEP-SHORT', '짧은 갈래', free.id);
  p.sequence.steps = [slow, other];
  p.sequence.flow = [{
    kind: 'parallel', id: 'FLW-P', name: '나란히',
    lanes: [[{ kind: 'step', stepId: slow.id }], [{ kind: 'step', stepId: other.id }]],
  }];
  p.simSettings.faults.neverTrueSignalIds = [free.completeSignalId!];
  return { p, slow, other };
}

async function renderTables(p: Project, rt: RuntimeState) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => {
    root!.render(<>
      <FlowEditor p={p} rt={rt} locked={false} edit={edit} />
      <SequencePanel p={p} rt={rt} locked={false} edit={edit} onSelect={() => {}} />
    </>);
  });
  const flow = el.querySelector('table[aria-label="Station 흐름"]') as HTMLTableElement;
  const seq = [...el.querySelectorAll('table')].find((t) => t !== flow) as HTMLTableElement;
  const cell = (table: HTMLTableElement, name: string, index: number) => {
    const row = [...table.querySelectorAll('tbody tr')].find((tr) => (tr.textContent ?? '').includes(name));
    if (!row) throw new Error(`missing ${name}`);
    return row.querySelectorAll('td')[index]?.textContent ?? '';
  };
  return { el, flow, seq, cell };
}

describe('TURN-034 flow table polish', () => {
  it('AC1 a timed-out lane shows 정지 for the other lane in the flow table and the step table', async () => {
    const { p, slow, other } = stoppedPair();
    expect(checkRunReadiness(p).ok).toBe(true);
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.steps.find((s) => s.stepId === other.id)?.status).toBe('error');
    expect(rt.state.steps.find((s) => s.stepId === slow.id)?.status).toBe('stopped');
    const u = await renderTables(p, rt.state);
    expect(u.cell(u.flow, slow.name, 3)).toBe(stepStatusLabel('stopped'));
    expect(u.cell(u.flow, other.name, 3)).toBe(stepStatusLabel('error'));
    expect(u.cell(u.seq, slow.name, 7)).toBe(stepStatusLabel('stopped'));
    expect(u.cell(u.seq, other.name, 7)).toBe(stepStatusLabel('error'));
    expect(u.flow.textContent).not.toContain('실행 중');
    expect(u.seq.textContent).not.toContain('실행 중');
  });

  it('AC2 the flow table says 진행 중 and follows the shared priority', async () => {
    const p = buildSampleProject();
    const steps = p.sequence.steps;
    const rt = createRuntime(p);
    rt.state.steps = [
      { stepId: steps[0].id, status: 'active' },
      { stepId: steps[0].id, status: 'error' },
      { stepId: steps[0].id, status: 'stopped' },
      { stepId: steps[1].id, status: 'stopped' },
      { stepId: steps[1].id, status: 'active' },
      { stepId: steps[2].id, status: 'done' },
      { stepId: steps[2].id, status: 'stopped' },
      { stepId: steps[3].id, status: 'done' },
      { stepId: steps[3].id, status: 'done' },
      { stepId: steps[3].id, status: 'skipped' },
      { stepId: steps[4].id, status: 'done' },
      { stepId: steps[4].id, status: 'skipped' },
      { stepId: steps[5].id, status: 'skipped' },
      { stepId: steps[6].id, status: 'pending' },
    ];
    const u = await renderTables(p, rt.state);
    const word = stepStatusLabel;
    const expectBoth = (index: number, label: string) => {
      expect(u.cell(u.flow, steps[index].name, 3)).toBe(label);
      expect(u.cell(u.seq, steps[index].name, 7)).toBe(label);
    };
    expectBoth(0, word('error'));
    expectBoth(1, word('active'));
    expectBoth(2, word('stopped'));
    expectBoth(3, `${word('done')} 2회`);
    expectBoth(4, `${word('done')} · ${word('skipped')}`);
    expectBoth(5, word('skipped'));
    expectBoth(6, word('pending'));
    expect(u.flow.textContent).toContain('진행 중');
    expect(u.flow.textContent).not.toContain('실행 중');
    expect(u.seq.textContent).not.toContain('실행 중');
  });
});

describe('TURN-034 flow editor headings', () => {
  it('AC3 the bold heading is the kind word, and the checkbox and the SFC keep the full title', async () => {
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
    await click(btn('흐름 예제'));
    await click(el.querySelector('.stepper [data-stepid="sequence"]')!);
    const flow = el.querySelector('table[aria-label="Station 흐름"]') as HTMLTableElement;
    const row = (kind: string) => flow.querySelector(`tr[data-flow-kind="${kind}"]`) as HTMLTableRowElement;
    expect(el.textContent).toContain('병렬로 묶으면 고른 줄이 갈래마다 하나씩 나뉩니다');
    expect(row('branch').querySelector('b')!.textContent).toBe('분기');
    expect((row('branch').querySelector('input[aria-label="분기 이름"]') as HTMLInputElement).value).toBe('읽기 결과');
    expect(row('branch').querySelector('input[type="checkbox"]')!.getAttribute('aria-label')).toBe('분기 읽기 결과 선택');
    expect(row('parallel').querySelector('b')!.textContent).toBe('병렬');
    expect(row('loop').querySelector('b')!.textContent).toBe('반복');
    expect(row('retry').querySelector('b')!.textContent).toBe('재시도');
    const name = row('branch').querySelector('input[aria-label="분기 이름"]') as HTMLInputElement;
    await act(async () => {
      name.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, '검사 결과');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { name.blur(); });
    expect(row('branch').querySelector('b')!.textContent).toBe('분기');
    expect((row('branch').querySelector('input[aria-label="분기 이름"]') as HTMLInputElement).value).toBe('검사 결과');
    expect(row('branch').querySelector('input[type="checkbox"]')!.getAttribute('aria-label')).toBe('분기 검사 결과 선택');
    await click(btn('SFC 미리보기', el.querySelector('.subtabs')!));
    const captions = [...el.querySelectorAll('svg text')].map((n) => n.textContent);
    expect(captions).toContain('분기 검사 결과');
    expect(captions).toContain('병렬 이송과 정지');
    expect(captions).toContain('반복 가공 반복');
    expect(captions).toContain('재시도 읽기 재시도');
    expect(seen.h).not.toBeNull();
  });
});
