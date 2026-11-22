// @vitest-environment jsdom
// TURN-023 flow editing. jsdom, not a browser. Screenshots are taken in Chrome.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { findById } from '../src/model/flow';
import type { History } from '../src/model/history';
import { App } from '../src/ui/App';
import { holdRuntimeClock } from './holdRuntimeClock';

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
  const typeName = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { input.blur(); });
  };
  return { el, click, btn, flowTable, row, typeName, history: () => seen.h! };
}

describe('TURN-023 flow editor UI', () => {
  it('AC1 AC2 renames a block, rejects an empty name, undoes, and uses one title in the table and the SFC', async () => {
    const u = await mount();
    await u.click(u.btn('시작하기'));
    await u.click(u.el.querySelector('.stepper [data-stepid="sequence"]')!);
    const boxes = [...u.flowTable().querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    await u.click(boxes[0]);
    await u.click(boxes[1]);
    await u.click(u.btn('분기로 묶기'));
    const branch = u.row('branch');
    expect(branch.querySelector('b')!.textContent).toBe('분기');
    expect(u.el.textContent).not.toContain('분기 분기');
    const name = branch.querySelector('input[aria-label="분기 이름"]') as HTMLInputElement;
    expect(name.value).toBe('분기');
    const rev = u.history().present.revision;
    await u.typeName(name, '   ');
    expect(name.value).toBe('분기');
    expect(u.el.querySelector('.toast.err')!.textContent).toContain('이름 필요');
    expect(u.history().present.revision).toBe(rev);
    await u.typeName(name, '검사 결과');
    expect(branch.querySelector('b')!.textContent).toBe('분기');
    expect(branch.querySelector('input[type="checkbox"]')!.getAttribute('aria-label')).toBe('분기 검사 결과 선택');
    expect((branch.querySelector('input[aria-label="분기 이름"]') as HTMLInputElement).value).toBe('검사 결과');
    await u.click(u.el.querySelector('[aria-label="실행 취소"]')!);
    expect(u.row('branch').querySelector('b')!.textContent).toBe('분기');

    await act(async () => { root!.unmount(); });
    root = null;
    document.body.innerHTML = '';
    const flow = await mount();
    await flow.click(flow.btn('흐름 예제'));
    await flow.click(flow.el.querySelector('.stepper [data-stepid="sequence"]')!);
    const u2 = flow;
    const titled = u2.row('branch');
    expect(titled.querySelector('b')!.textContent).toBe('분기');
    expect(titled.querySelector('input[type="checkbox"]')!.getAttribute('aria-label')).toBe('분기 읽기 결과 선택');
    expect(u2.row('parallel').querySelector('b')!.textContent).toBe('병렬');
    expect(u2.row('parallel').querySelector('input[type="checkbox"]')!.getAttribute('aria-label')).toBe('병렬 이송과 정지 선택');
    expect(u2.row('loop').querySelector('b')!.textContent).toBe('반복');
    expect(u2.row('retry').querySelector('b')!.textContent).toBe('재시도');
    expect(u2.el.textContent).not.toContain('분기 분기');
    await u2.typeName(titled.querySelector('input[aria-label="분기 이름"]') as HTMLInputElement, '검사 결과');
    expect(u2.row('branch').querySelector('b')!.textContent).toBe('분기');
    expect(u2.row('branch').querySelector('input[type="checkbox"]')!.getAttribute('aria-label')).toBe('분기 검사 결과 선택');
    await u2.click(u2.btn('SFC 미리보기', u2.el.querySelector('.subtabs')!));
    const captions = [...u2.el.querySelectorAll('svg text')].map((n) => n.textContent);
    expect(captions).toContain('분기 검사 결과');
    expect(captions).toContain('재시도 읽기 재시도');
    expect(captions).not.toContain('분기 분기');

    await u2.click(u2.el.querySelector('.stepper [data-stepid="run"]')!);
    // The flow example ends at 13.100s of performance.now(). Hold that clock and
    // skip 15s so the name stays locked however long this test takes.
    // TURN025_WALL_MS=15000 waits that long for real before the skip.
    const clock = holdRuntimeClock();
    try {
      await u2.click(u2.btn('▶ 실행'));
      expect(clock.queued()).toBeGreaterThan(0);
      const wallMs = Number(process.env.TURN025_WALL_MS ?? '0');
      if (Number.isFinite(wallMs) && wallMs > 0) await clock.wall(wallMs);
      await clock.elapse(15_000);
      expect(clock.queued()).toBeGreaterThan(0);
      expect(u2.el.textContent).toContain('시뮬 실행 중');
      await u2.click(u2.el.querySelector('.stepper [data-stepid="sequence"]')!);
      await u2.click(u2.btn('Station 시퀀스 Draft (F5)', u2.el.querySelector('.subtabs')!));
      expect((u2.row('branch').querySelector('input[aria-label="분기 이름"]') as HTMLInputElement).disabled).toBe(true);
      await u2.click(u2.el.querySelector('.stepper [data-stepid="run"]')!);
      await u2.click(u2.btn('❚❚ 일시정지'));
      await u2.click(u2.el.querySelector('.stepper [data-stepid="sequence"]')!);
      expect((u2.row('branch').querySelector('input[aria-label="분기 이름"]') as HTMLInputElement).disabled).toBe(true);
      await u2.click(u2.el.querySelector('.stepper [data-stepid="run"]')!);
      await u2.click(u2.btn('⟲ 초기화'));
    } finally {
      clock.restore();
    }
  });

  it('AC3 moves a block and a substation step with buttons and arrow keys', async () => {
    const u = await mount();
    await u.click(u.btn('흐름 예제'));
    await u.click(u.el.querySelector('.stepper [data-stepid="sequence"]')!);
    const retry = u.row('retry');
    expect([...retry.querySelectorAll('button')].map((b) => b.textContent)).toEqual(expect.arrayContaining(['위로', '아래로', '밖으로']));
    const before = structuredClone(findById(u.history().present.sequence.flow!, 'FLW-RETRY')!.node);
    const index = findById(u.history().present.sequence.flow!, 'FLW-RETRY')!.index;
    await u.click([...retry.querySelectorAll('button')].find((b) => b.textContent === '아래로'));
    expect(findById(u.history().present.sequence.flow!, 'FLW-RETRY')!.node).toEqual(before);
    expect(findById(u.history().present.sequence.flow!, 'FLW-RETRY')!.index).toBe(index + 1);
    await act(async () => {
      u.row('retry').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    });
    expect(findById(u.history().present.sequence.flow!, 'FLW-RETRY')!.index).toBe(index);
    expect(findById(u.history().present.sequence.flow!, 'FLW-RETRY')!.node).toEqual(before);
    await u.click([...u.flowTable().querySelectorAll('tbody tr')[0].querySelectorAll('button')].find((b) => b.textContent === '위로'));
    expect(u.el.querySelector('.toast.err')!.textContent).toContain('이동 불가');
    await u.click([...u.row('retry').querySelectorAll('button')].find((b) => b.textContent === '밖으로'));
    expect(u.el.querySelector('.toast.err')!.textContent).toContain('이미 맨 바깥입니다');

    await u.click(u.btn('Substation 시퀀스 넣기'));
    const sub = u.row('substation');
    expect([...sub.querySelectorAll('button')].map((b) => b.textContent)).toEqual(expect.arrayContaining(['위로', '아래로', '밖으로']));
    await act(async () => {
      sub.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    });
    const flow = u.history().present.sequence.flow!;
    expect(flow[flow.length - 1].kind).not.toBe('substation');
    expect(flow.some((n) => n.kind === 'substation')).toBe(true);
  });

  it('AC4 AC5 inserts and wraps a block or substation step when the run is consecutive', async () => {
    const u = await mount();
    await u.click(u.btn('흐름 예제'));
    await u.click(u.el.querySelector('.stepper [data-stepid="sequence"]')!);
    const check = (kind: string) => u.row(kind).querySelector('input[type="checkbox"]') as HTMLInputElement;
    await u.click(check('retry'));
    const falsy = [...u.flowTable().querySelectorAll('tr[data-flow-kind="arm"]')].find((r) => (r.textContent ?? '').includes('거짓'))!;
    await u.click([...falsy.querySelectorAll('button')].find((b) => b.textContent === '선택 넣기'));
    const branch = findById(u.history().present.sequence.flow!, 'FLW-BRANCH')!.node;
    expect(branch.kind === 'branch' && branch.else.some((n) => n.kind === 'retry')).toBe(true);

    await u.click(check('branch'));
    const truthy = [...u.flowTable().querySelectorAll('tr[data-flow-kind="arm"]')].find((r) => (r.textContent ?? '').includes('참'))!;
    await u.click([...truthy.querySelectorAll('button')].find((b) => b.textContent === '선택 넣기'));
    expect(u.el.querySelector('.toast.err')!.textContent).toContain('블록을 자기 자신 안에 넣을 수 없습니다');
    await u.click(check('branch'));

    await u.click(u.btn('Substation 시퀀스 넣기'));
    await u.click(check('substation'));
    const lane = [...u.flowTable().querySelectorAll('tr[data-flow-kind="arm"]')].find((r) => (r.textContent ?? '').includes('갈래 1'))!;
    await u.click([...lane.querySelectorAll('button')].find((b) => b.textContent === '선택 넣기'));
    expect(u.el.querySelector('.toast.err')!.textContent).toContain('병렬 갈래 안에는 병렬과 Substation 단계를 넣지 않습니다');

    await act(async () => { root!.unmount(); });
    root = null;
    document.body.innerHTML = '';
    const fresh = await mount();
    await fresh.click(fresh.btn('흐름 예제'));
    await fresh.click(fresh.el.querySelector('.stepper [data-stepid="sequence"]')!);
    const step = fresh.history().present.sequence.flow![1];
    const stepId = step.kind === 'step' ? step.stepId : '';
    const stepName = fresh.history().present.sequence.steps.find((s) => s.id === stepId)!.name;
    await fresh.click(fresh.flowTable().querySelector(`input[aria-label="${stepName} 선택"]`)!);
    await fresh.click(fresh.row('retry').querySelector('input[type="checkbox"]')!);
    const retryBefore = structuredClone(findById(fresh.history().present.sequence.flow!, 'FLW-RETRY')!.node);
    await fresh.click(fresh.btn('반복으로 묶기'));
    const loop = fresh.history().present.sequence.flow!.find((n) => n.kind === 'loop' && n.id !== 'FLW-LOOP');
    expect(loop && loop.kind === 'loop' && loop.body.map((n) => n.kind === 'step' ? n.stepId : n.id)).toEqual([stepId, 'FLW-RETRY']);
    expect(loop && loop.kind === 'loop' && loop.body[1]).toEqual(retryBefore);
    await fresh.click(fresh.flowTable().querySelectorAll('input[type="checkbox"]')[0]);
    await fresh.click(fresh.row('retry').querySelector('input[type="checkbox"]')!);
    await fresh.click(fresh.btn('분기로 묶기'));
    expect(fresh.el.querySelector('.toast.err')!.textContent).toContain('같은 갈래에서 연속된 단계만 묶을 수 있습니다');
  });

  it('AC6 draws the station flow table and the wrap row once, and keeps step editing', async () => {
    const u = await mount();
    await u.click(u.btn('흐름 예제'));
    await u.click(u.el.querySelector('.stepper [data-stepid="sequence"]')!);
    expect(u.el.querySelectorAll('table[aria-label="Station 흐름"]')).toHaveLength(1);
    for (const label of ['분기로 묶기', '병렬로 묶기', '반복으로 묶기', '재시도로 묶기']) {
      expect([...u.el.querySelectorAll('button')].filter((b) => (b.textContent ?? '').trim() === label)).toHaveLength(1);
    }
    const fold = u.el.querySelector('details');
    expect(fold?.textContent).toContain('단계 편집, 구조화 문장, 순서 변경');
    expect(fold?.querySelector('textarea')).not.toBeNull();
    expect(fold?.querySelectorAll('table[aria-label="Station 흐름"]')).toHaveLength(0);
    expect(fold?.textContent).toContain('제공 Action');
    const stepsBefore = u.history().present.sequence.steps.length;
    await u.click([...fold!.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '×'));
    expect(u.history().present.sequence.steps.length).toBe(stepsBefore - 1);
  });
});
