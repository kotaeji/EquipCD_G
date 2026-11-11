// @vitest-environment jsdom
// jsdom render smoke test (NOT a real browser test): checks that the step workspaces mount and switch without exceptions,
// that viewing/toggling never changes the model, and that library "add" is the only model-changing library action.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { App } from '../src/ui/App';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('UI smoke (jsdom)', () => {
  it('central workspace follows the step, library cards → detail → add, photo toggle keeps the model, themes switch', async () => {
    localStorage.clear();
    const el = document.createElement('div'); document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => { root.render(<App />); });
    const txt = () => el.textContent ?? '';
    const btn = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(label))!;
    const click = async (b: Element) => { await act(async () => { (b as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
    const rev = () => /rev (\d+)/.exec(el.querySelector('.statusbar')!.textContent!)![1];
    const appEl = el.querySelector('.app') as HTMLElement;
    expect(appEl.dataset.screen).toBe('S00');
    expect(txt()).toContain('어떤 장비를 설계할까요');
    await click(btn('시작하기'));
    // step 1: library cards in the centre (not the canvas)
    expect(appEl.dataset.step).toBe('library');
    expect(appEl.dataset.screen).toBe('S10');
    expect(txt()).toContain('Aurora Concept Designer');
    expect(el.querySelector('.explorer')).not.toBeNull();
    expect(el.querySelectorAll('.cards .card').length).toBe(14);
    expect(el.querySelector('svg.canvas-svg')).toBeNull();
    const r0 = rev();
    await click(el.querySelector('.card[data-kind="unitTransfer"]')!);
    expect(txt()).toContain('InternalElement');
    expect(rev()).toBe(r0); // detail view does not change the model
    await click(btn('실사풍(AI)'));
    expect(el.querySelectorAll('.cards img').length).toBe(14);
    expect(el.querySelectorAll('.cards .aichip').length).toBe(14); // every AI image carries an "AI 생성" label
    expect(txt()).toContain('실제 촬영 사진 아님');
    expect(txt()).toContain('생성 도구');
    expect(txt()).toContain('CC BY-SA'); // previous photo attribution kept as history (details)
    expect(rev()).toBe(r0); // photo toggle does not change the model
    await click(btn('프로젝트에 추가'));
    expect(Number(rev())).toBe(Number(r0) + 1);
    // step 2: canvas workspace
    await click(el.querySelector('.stepper [data-stepid="canvas"]')!);
    expect(appEl.dataset.step).toBe('canvas');
    expect(el.querySelectorAll('.palette .pi').length).toBe(15);
    expect(txt()).toContain('S1'); expect(txt()).toContain('S6 이송 유닛 1');
    expect(el.querySelectorAll('svg image').length).toBeGreaterThan(0); // photo mode on canvas
    await click([...el.querySelectorAll('.diagram-tools button')].find((b) => (b.textContent ?? '').trim() === '도식')!);
    expect(el.querySelectorAll('svg image').length).toBe(0);
    const treeItem = [...el.querySelectorAll('.tree div')].find((d) => (d.textContent ?? '').startsWith('○ CYL-03'))! as HTMLElement;
    await click(treeItem);
    for (const t of ['신호', '포지션', 'Action', '정의 체크', '속성']) await click([...el.querySelectorAll('.right .tabs button')].find((b) => (b.textContent ?? '').startsWith(t))!);
    expect(txt()).toContain('CYL-03');
    // steps 3..6 + sub tabs
    for (const [s, subs] of [['attributes', []], ['sequence', ['자재·Flow', 'SFC 미리보기', 'Substation 시퀀스', 'Station 시퀀스 Draft']], ['check', ['진단·저장', 'Export 미리보기', 'Evolution Lab', 'Gap (F6)']], ['run', []]] as [string, string[]][]) {
      await click(el.querySelector(`.stepper [data-stepid="${s}"]`)!);
      expect(appEl.dataset.step).toBe(s);
      expect(el.querySelector('.explorer .tree')).not.toBeNull(); // N03: left explorer on every step
      for (const t of subs) await click(btn(t, el.querySelector('.subtabs')!));
    }
    expect(txt()).toContain('CYL-03'); // selection survives step round trip
    await click(btn('다음 단계')); // disabled on last step → no throw
    await click(btn('이전'));
    expect(appEl.dataset.step).toBe('check');
    // themes: light/dark only. Stored id A = light, B = dark. Archived C is not a button.
    expect(appEl.dataset.theme).toBe('A');
    expect(appEl.dataset.appearance).toBe('light');
    const revBeforeTheme = rev();
    await click(btn('다크')); expect(appEl.dataset.theme).toBe('B'); expect(appEl.dataset.appearance).toBe('dark');
    await click(btn('라이트')); expect(appEl.dataset.theme).toBe('A'); expect(appEl.dataset.appearance).toBe('light');
    expect(rev()).toBe(revBeforeTheme);
    // save → stored; UserView keeps the step separately from the project
    await click(btn('저장'));
    expect(Object.keys(localStorage).some((k) => k.startsWith('ecd.v1.project.'))).toBe(true);
    expect(JSON.parse(localStorage.getItem('ecd.v1.userView')!).step).toBe('check');
    const saved = localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('ecd.v1.project.'))!)!;
    expect(saved).not.toContain('"step"');
    expect(saved).not.toContain('visualMode');
    // v0.3: parallel sample → Substation sequences → group run on the run step
    await click(btn('+ 병렬 예제'));
    await click(el.querySelector('.stepper [data-stepid="sequence"]')!);
    await click(btn('Substation 시퀀스', el.querySelector('.subtabs')!));
    expect(el.querySelectorAll('.seqcard').length).toBe(2);
    expect(txt()).toContain('그룹 실행 전 검사: 통과');
    await click(el.querySelector('.stepper [data-stepid="run"]')!);
    await click(btn('Substation 그룹'));
    const r1 = rev();
    await click(btn('▶ 그룹 실행'));
    expect(txt()).toContain('그룹 running');
    expect(btn('+ 시퀀스 추가')).toBeUndefined(); // editor not on this step
    await click(btn('❚❚ 그룹 일시정지'));
    expect(txt()).toContain('그룹 paused');
    await click(btn('그룹 재개'));
    await click(btn('끝까지'));
    expect(txt()).toContain('그룹 completed');
    expect(txt()).toContain('GROUP_COMPLETE');
    expect(rev()).toBe(r1); // running never edits the model
    await click(btn('⟲ 그룹 초기화'));
    expect(txt()).toContain('그룹 idle');
    await act(async () => { root.unmount(); });
  });
});
