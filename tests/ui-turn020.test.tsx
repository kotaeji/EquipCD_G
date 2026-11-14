// @vitest-environment jsdom
// TURN-020: name search on the common explorer, and the shared not-ready banner. jsdom, not a browser.
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { serializeProject } from '../src/storage/fileFormat';
import { App } from '../src/ui/App';
import { BundleSheet, ExtendSheet, ExtractSheet, LabSheet, SearchSheet } from '../src/ui/SparseScreens';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  localStorage.clear();
});

async function mount(node: ReactNode) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(node); });
  return el;
}

async function click(node: Element) {
  await act(async () => { (node as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

async function setInput(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const tree = [
  { id: 'st', label: 'Station Alpha', depth: 0 },
  { id: 'sub', label: 'Substation Beta', depth: 1 },
  { id: 'dev', label: 'Device Gamma', depth: 2 },
  { id: 'dev2', label: 'Device Alpha-2', depth: 2 },
  { id: 'sub2', label: 'Substation Gamma', depth: 1 },
  { id: 'st2', label: 'Station Delta', depth: 0 },
  { id: 'sub3', label: 'Substation Quiet', depth: 1 },
];

const tabs = [{ key: 't1', name: '열린 탭', active: true }];

function labels(el: ParentNode) {
  return [...el.querySelectorAll('.tree-link')].map((b) => b.textContent);
}

function searchInput(el: ParentNode) {
  return el.querySelector('input[type="search"]') as HTMLInputElement;
}

describe('TURN-020 common search', () => {
  it('AC1 keeps a name hit and its Station and Substation, ignoring case and surrounding spaces', async () => {
    const el = await mount(<SearchSheet tabs={tabs} tree={tree} onTab={() => {}} onPick={() => {}} onFold={() => {}} onCanvas={() => {}} />);
    const input = searchInput(el);
    expect(input).not.toBeNull();
    expect(input.labels?.[0]?.textContent).toContain('이름으로 찾기');
    expect(labels(el)).toEqual(['Station Alpha', 'Substation Beta', 'Device Gamma', 'Device Alpha-2', 'Substation Gamma', 'Station Delta', 'Substation Quiet']);

    await setInput(input, '  GaMmA  ');
    expect(input.value).toBe('  GaMmA  ');
    expect(labels(el)).toEqual(['Station Alpha', 'Substation Beta', 'Device Gamma', 'Substation Gamma']);
    expect(el.querySelector('.search-count')!.textContent).toBe('2개 찾음');
    expect(el.textContent).not.toContain('찾는 이름이 없습니다');

    await setInput(input, 'alpha');
    expect(labels(el)).toEqual(['Station Alpha', 'Substation Beta', 'Device Alpha-2']);
    expect(el.querySelector('.search-count')!.textContent).toBe('2개 찾음');
    expect(labels(el)).not.toContain('Device Gamma');
    expect(labels(el)).not.toContain('Substation Quiet');
  });

  it('AC2 shows the hit count, and 지우기 restores the whole tree when nothing matches', async () => {
    const el = await mount(<SearchSheet tabs={tabs} tree={tree} onTab={() => {}} onPick={() => {}} onFold={() => {}} onCanvas={() => {}} />);
    const input = searchInput(el);
    await setInput(input, '없는이름');
    expect(el.querySelector('.search-count')!.textContent).toBe('0개 찾음');
    expect(el.textContent).toContain('찾는 이름이 없습니다');
    expect(labels(el)).toEqual([]);
    const clear = [...el.querySelectorAll('button')].find((b) => b.textContent === '지우기')!;
    await click(clear);
    expect(searchInput(el).value).toBe('');
    expect(el.querySelector('.search-count')).toBeNull();
    expect(el.textContent).not.toContain('찾는 이름이 없습니다');
    expect(labels(el)).toHaveLength(tree.length);
    expect([...el.querySelectorAll('button')].some((b) => b.textContent === '지우기')).toBe(false);
  });

  it('AC3 typing does not call pick, tab, fold, or canvas, and a row calls onPick with its id', async () => {
    const calls: string[] = [];
    const el = await mount(<SearchSheet tabs={tabs} tree={tree}
      onTab={(key) => calls.push(`tab:${key}`)} onPick={(id) => calls.push(`pick:${id}`)}
      onFold={() => calls.push('fold')} onCanvas={() => calls.push('canvas')} />);
    await setInput(searchInput(el), 'gamma');
    expect(calls).toEqual([]);
    await click([...el.querySelectorAll('.tree-link')].find((b) => b.textContent === 'Device Gamma')!);
    expect(calls).toEqual(['pick:dev']);
  });
});

describe('TURN-020 not-ready banners', () => {
  const lead = '준비 중 — 이 화면은 아직 동작하지 않습니다';

  it('AC4 puts the same note at the top of the four guide screens', async () => {
    const cases: [string, ReactNode, string, string][] = [
      ['extract', <ExtractSheet />, '입력 후보표의 직접 입력과 AML 라이브러리를 쓰세요', '자료 선택 예시'],
      ['bundle', <BundleSheet wsName="작업" projectCount={1} assetCount={2} assumptionCount={3} />, '프로젝트별 JSON 내보내기를 쓰세요', '묶음 내보내기'],
      ['lab', <LabSheet revision={4} />, 'Gap 목록의 가정 시간 합계를 쓰세요', '변형 차이 검토 예시'],
      ['extend', <ExtendSheet />, 'Station 단계 시간은 4단계 Station 시퀀스에서 편집하세요', '편집 반영 미리보기'],
    ];
    for (const [name, node, hint, kept] of cases) {
      if (root) await act(async () => { root!.unmount(); });
      root = null;
      document.body.innerHTML = '';
      const el = await mount(node);
      const note = el.querySelector('[role="note"]') as HTMLElement;
      expect(note, name).not.toBeNull();
      expect(note.className).toContain('not-ready');
      expect(note.querySelector('.not-ready-lead')!.textContent).toBe(lead);
      expect(note.querySelector('.not-ready-hint')!.textContent).toBe(hint);
      expect(el.firstElementChild === note || el.firstElementChild?.firstElementChild === note, name).toBe(true);
      const button = [...el.querySelectorAll('button')].find((b) => b.textContent === kept) as HTMLButtonElement;
      expect(button.disabled, name).toBe(true);
    }
  });
});

describe('TURN-020 search inside the app', () => {
  it('AC3 searching leaves the model, revision, selection, and saved view unchanged', async () => {
    localStorage.clear();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const seen: { rev: number; json: string } = { rev: -1, json: '' };
    root = createRoot(el);
    await act(async () => { root!.render(<App onHistory={(h) => { seen.rev = h.present.revision; seen.json = serializeProject(h.present); }} />); });
    const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label)!;
    await click(btn('시작하기'));
    const rev = seen.rev;
    const json = seen.json;
    const selected = () => [...el.querySelectorAll('[role="treeitem"]')].filter((n) => n.getAttribute('aria-selected') === 'true').map((n) => n.getAttribute('data-tree-id'));
    expect(selected()).toEqual([]);
    await click(btn('Workspace', el.querySelector('[aria-label="탐색기"]')!));
    await click(btn('공통 탐색'));
    const viewBefore = localStorage.getItem('ecd.v1.userView');
    const input = searchInput(el);
    await setInput(input, '  cYL  ');
    expect(el.querySelector('.search-count')!.textContent).toBe('2개 찾음');
    expect(labels(el)).toEqual(['S1 투입', 'CYL-01', 'S3 가공', 'CYL-03']);
    expect(seen.rev).toBe(rev);
    expect(seen.json).toBe(json);
    expect(selected()).toEqual([]);
    expect(localStorage.getItem('ecd.v1.userView')).toBe(viewBefore);
    expect(viewBefore ?? '').not.toContain('cYL');
    await click([...el.querySelectorAll('.tree-link')].find((b) => b.textContent === 'CYL-03')!);
    expect(selected()).toEqual(['CYL-03']);
    expect(el.querySelector('.app')!.getAttribute('data-step')).toBe('canvas');
    expect(seen.rev).toBe(rev);
    expect(seen.json).toBe(json);
  });
});
