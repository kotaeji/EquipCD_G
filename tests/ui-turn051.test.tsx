// @vitest-environment jsdom
// TURN-051. Shared problem lines and empty screens. jsdom, not a browser.
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { History } from '../src/model/history';
import { buildSampleProject } from '../src/model/sample';
import { saveProject } from '../src/storage/localStore';
import { App } from '../src/ui/App';
import { BootGate, LOADING_DELAY_MS } from '../src/ui/EmptyState';
import { BlockerList, Problem } from '../src/ui/Problem';
import { resolveBlocker } from '../src/ui/blockerTarget';
import { ExtractSheet, FilesSheet, SearchSheet } from '../src/ui/SparseScreens';
import { LOADING_3D, runErrorProblem, saveProblem } from '../src/ui/problemCopy';
import { checkRunReadiness } from '../src/model/validate';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  vi.useRealTimers();
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  localStorage.clear();
});

async function mount(node: ReactNode) {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(node); });
  return el;
}

async function mountApp(opts?: { keepStorage?: boolean }) {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
  if (!opts?.keepStorage) localStorage.clear();
  const el = document.createElement('div');
  document.body.appendChild(el);
  const seen: { h: History | null } = { h: null };
  root = createRoot(el);
  await act(async () => { root!.render(<App onHistory={(h) => { seen.h = h; }} />); });
  const click = async (node: Element | undefined) => {
    if (!node) throw new Error('missing control');
    await act(async () => { (node as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  };
  const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label) as HTMLButtonElement | undefined;
  const key = async (node: EventTarget, init: KeyboardEventInit) => {
    await act(async () => { node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })); });
  };
  return { el, click, btn, key, history: () => seen.h! };
}

function lines(rootNode: ParentNode) {
  const box = rootNode.querySelector('[data-problem]') as HTMLElement;
  return {
    box,
    what: box?.querySelector('[data-problem-what]')?.textContent ?? '',
    why: box?.querySelector('[data-problem-why]')?.textContent ?? '',
    how: box?.querySelector('[data-problem-how]')?.textContent ?? '',
    mark: box?.querySelector('.status-mark')?.getAttribute('data-status') ?? '',
  };
}

describe('TURN-051 problem shape', () => {
  it('AC1 AC3 the five run errors share 무엇 · 왜 · 어떻게 and an error mark', async () => {
    const cases = [
      ['TIMEOUT', '타임아웃', '타임아웃을 동작 시간보다 길게'],
      ['PRE_UNMET', '조건 불충족', '이 단계의 조건을 맞추거나'],
      ['CAPACITY_FULL', '수용 부족', 'Unit 수용 개수를 늘리거나'],
      ['DEADLOCK', '교착', '서로 기다리는 Unit'],
      ['INTERLOCK_BLOCK', 'Interlock 차단', '확인을 거절하세요'],
    ] as const;
    for (const [code, what, how] of cases) {
      const copy = runErrorProblem(code, `[밀기] ${code}`, '밀기');
      expect(copy, code).not.toBeNull();
      const el = await mount(<Problem copy={copy!} onJump={() => {}} />);
      const row = lines(el);
      expect(row.box.className).toContain('problem');
      expect(row.mark).toBe('error');
      expect(row.what).toContain(what);
      expect(row.why.length).toBeGreaterThan(0);
      expect(row.how).toContain(how);
      expect(row.box.querySelector('button')!.textContent).toBe('이동');
      await act(async () => { root!.unmount(); });
      root = null;
      document.body.innerHTML = '';
    }
  });

  it('AC6 a blocker with nowhere to go has no jump and keeps the unsupported note', async () => {
    const p = buildSampleProject();
    const extra = structuredClone(p.materials[0]);
    extra.id = 'MAT-EXTRA';
    p.materials.push(extra);
    const ready = checkRunReadiness(p);
    const b = ready.blockers.find((x) => x.code === 'MATERIAL_COUNT')!;
    expect(b).toBeDefined();
    const g = resolveBlocker(p, b, ready.blockers);
    expect(g.kind).toBe('unsupported');
    expect(g.dest).toBeUndefined();
    const el = await mount(<BlockerList p={p} blockers={[b]} onGuide={() => {}} />);
    const item = el.querySelector('.blocker-item')!;
    expect(item.textContent).toContain('현재 화면에서 직접 편집 불가');
    expect(item.textContent).toContain('자재 삭제 기능이 없어');
    expect(item.querySelector('button')).toBeNull();
  });
});

describe('TURN-051 run gate', () => {
  it('AC2 a missing timeout is three lines, and 이동 highlights the Action field', async () => {
    const p = buildSampleProject();
    const step = p.sequence.steps[0];
    const action = p.actions.find((a) => a.id === step.actionId)!;
    action.timeout = { ...action.timeout, value: null };
    localStorage.clear();
    expect(saveProject(localStorage, p).ok).toBe(true);
    const u = await mountApp({ keepStorage: true });
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    const item = [...u.el.querySelectorAll('.blocker-item')].find((li) => (li.textContent ?? '').includes('TIMEOUT_UNDEFINED'))!;
    expect(item).toBeTruthy();
    const row = lines(item);
    expect(row.what).toContain(step.name);
    expect(row.why).toContain('타임아웃 미정');
    expect(row.how).toContain('3단계 Action');
    expect(row.how).toContain('값을 입력');
    expect(row.mark).toBe('undetermined');
    const go = item.querySelector('button') as HTMLButtonElement;
    expect(go.textContent).toContain('이동');
    await u.click(go);
    expect(u.el.querySelector('.app')!.getAttribute('data-step')).toBe('attributes');
    const field = u.el.querySelector(`[data-jump="timeout:${action.id}"]`) as HTMLElement;
    expect(field).toBeTruthy();
    expect(field.classList.contains('jump-flash')).toBe(true);
  });
});

describe('TURN-051 refusals', () => {
  it('AC4 import rejection and save failure use the same problem shape, and the copy button stays', async () => {
    const u = await mountApp();
    const input = u.el.querySelector('input[type="file"]') as HTMLInputElement;
    const file = { name: 'broken.json', size: 1, text: async () => '{' };
    await act(async () => {
      Object.defineProperty(input, 'files', { configurable: true, value: [file] });
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    const box = u.el.querySelector('[data-import-reject]')!;
    const row = lines(box);
    expect(row.what).toContain('가져오기 거부');
    expect(row.why).toContain('broken.json');
    expect(row.why).toContain('열지 않았습니다');
    expect(row.how).toContain('격리 보관함');
    expect(u.btn('확인')).toBeTruthy();

    const saved = saveProblem('다른 Workspace에 같은 ID가 있어 저장하지 못했습니다. 탭은 그대로 두었습니다.');
    const el = await mount(<Problem copy={saved} />);
    expect(lines(el).what).toContain('저장 실패');
    expect(lines(el).why).toContain('탭은 그대로 두었습니다');
    expect(lines(el).how).toContain('JSON으로 내보내세요');
  });

  it('AC5 paste and connect refusals are 무엇 and 왜', async () => {
    const u = await mountApp();
    await u.click(u.btn('시작하기'));
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
    try { await u.click(u.btn('▶ 실행')); } finally { globalThis.requestAnimationFrame = raf; }
    await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]')!);
    await u.key(window, { key: 'v', ctrlKey: true });
    const paste = lines(u.el.querySelector('.toast')!);
    expect(paste.what).toContain('붙여넣기 불가');
    expect(paste.why).toContain('실행 중에는 붙여넣기가 차단됩니다');
    expect(u.el.querySelector('.toast [data-problem-how]')).toBeNull();

    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    await u.click(u.btn('⟲ 초기화'));
    await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]')!);
    await u.click(u.el.querySelector('#layout-tab-board')!);
    await u.click(u.btn('물류 연결'));
    const card = u.el.querySelector('.station-card') as HTMLElement;
    await u.click(card);
    await u.click(card);
    const connect = lines(u.el.querySelector('.toast')!);
    expect(connect.what).toContain('연결 불가');
    expect(connect.why).toContain('자기 자신과 연결할 수 없습니다');
  });
});

describe('TURN-051 empty and not-ready screens', () => {
  it('AC7 AC8 empty lists name the next action, and 자재 추가 creates one material', async () => {
    const search = await mount(<SearchSheet tabs={[{ key: 't', name: '탭', active: true }]} tree={[{ id: 'a', label: '알파', depth: 0 }]} onTab={() => {}} onPick={() => {}} onFold={() => {}} onCanvas={() => {}} />);
    const input = search.querySelector('input[type="search"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '없는이름');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(search.querySelector('[data-empty] .empty-line')!.textContent).toBe('찾는 이름이 없습니다');
    expect([...search.querySelectorAll('button')].some((b) => b.textContent === '지우기')).toBe(true);

    const files = await mount(<FilesSheet entries={[]} onImport={() => {}} onExport={() => {}} onOpen={() => {}} onNew={() => {}} onSample={() => {}} />);
    expect(files.textContent).toContain('저장된 프로젝트가 없습니다');
    expect([...files.querySelectorAll('button')].map((b) => b.textContent)).toEqual(expect.arrayContaining(['새 프로젝트', '예제']));

    const u = await mountApp();
    await u.click(u.btn('빈 프로젝트 만들기'));
    await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]')!);
    expect(u.el.textContent).toContain('Unit이 없습니다');
    expect(u.btn('팔레트의 빈 유닛')).toBeTruthy();
    await u.click(u.el.querySelector('.stepper [data-stepid="sequence"]')!);
    expect(u.el.textContent).toContain('시퀀스 단계가 없습니다');
    expect(u.btn('단계 추가')!.disabled).toBe(true);
    expect(u.el.textContent).toContain('Action이 없습니다');
    await u.click(u.el.querySelector('.stepper [data-stepid="check"]')!);
    expect(u.el.textContent).toContain('남은 Gap 이 없습니다');
    await u.click(u.el.querySelector('.stepper [data-stepid="sequence"]')!);
    await u.click(u.btn('자재·Flow (F4)'));
    expect(u.history().present.materials).toHaveLength(0);
    await u.click(u.btn('자재 추가'));
    expect(u.history().present.materials).toHaveLength(1);
    await u.click(u.el.querySelector('.stepper [data-stepid="attributes"]')!);
    expect(u.el.textContent).toContain('Device가 없습니다');
    expect(u.el.textContent).toContain('Interlock이 없습니다');
    await u.click(u.btn('Interlock 추가'));
    expect(u.history().present.constraints.length).toBeGreaterThan(0);
    await u.click(u.el.querySelector('.stepper [data-stepid="run"]')!);
    await u.click(u.btn('자세히'));
    await u.click(u.btn('실행 로그'));
    expect(u.el.textContent).toContain('실행 로그가 없습니다');
    await u.click(u.el.querySelector('.stepper [data-stepid="library"]')!);
    await u.click(u.btn('입력 후보표 (F1)'));
    expect(u.el.textContent).toContain('입력 후보가 없습니다');
  });

  it('AC9 the guide screens that now work do not keep 준비 중', async () => {
    // Evolution Lab은 TURN-058, 파일 묶음은 TURN-055, 자료 입력은 TURN-060에서 동작한다.
    const el = await mount(<ExtractSheet />);
    expect(el.querySelector('.not-ready')).toBeNull();
    expect(el.textContent).not.toContain('준비 중');
    expect(el.textContent).toContain('지원(IO 리스트 · 사양표)');
  });

  it('AC10 the loading hold waits, then leaves when the scene is ready', async () => {
    vi.useFakeTimers();
    const el = await mount(<BootGate ready={false} label={LOADING_3D}><p data-scene="">scene</p></BootGate>);
    expect(el.querySelector('[data-boot]')!.getAttribute('data-boot')).toBe('pending');
    expect(el.querySelector('[data-loading="shown"]')).toBeNull();
    await act(async () => { vi.advanceTimersByTime(LOADING_DELAY_MS); });
    expect(el.querySelector('[data-loading="shown"]')!.textContent).toBe(LOADING_3D);
    await act(async () => { root!.render(<BootGate ready label={LOADING_3D}><p data-scene="">scene</p></BootGate>); });
    expect(el.querySelector('[data-boot]')!.getAttribute('data-boot')).toBe('ready');
    expect(el.querySelector('[data-loading="shown"]')).toBeNull();
    expect(el.querySelector('[data-scene]')!.textContent).toBe('scene');
  });
});

describe('TURN-051 empty flow on a placed unit', () => {
  it('AC7 a project with units and no flow offers 물류 연결, and the empty unit button highlights the palette', async () => {
    const p = buildSampleProject();
    p.connections = p.connections.filter((c) => c.kind !== 'flow');
    localStorage.clear();
    expect(saveProject(localStorage, p).ok).toBe(true);
    const seeded = await mountApp({ keepStorage: true });
    await seeded.click(seeded.btn('시작하기'));
    await seeded.click(seeded.el.querySelector('.stepper [data-stepid="canvas"]')!);
    await seeded.click(seeded.el.querySelector('#layout-tab-board')!);
    expect(seeded.el.textContent).toContain('물류 연결이 없습니다');
    expect(seeded.btn('물류 연결', seeded.el.querySelector('[data-empty]')!)).toBeTruthy();

    const u = await mountApp();
    await u.click(u.btn('빈 프로젝트 만들기'));
    await u.click(u.el.querySelector('.stepper [data-stepid="canvas"]')!);
    await u.click(u.btn('팔레트의 빈 유닛'));
    expect(u.el.querySelector('[data-jump="palette-unit"]')!.classList.contains('jump-flash')).toBe(true);
  });
});
