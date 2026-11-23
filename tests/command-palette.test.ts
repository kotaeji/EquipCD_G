// TURN-053. Command definitions: filter, order, groups, shortcuts. No DOM.
import { describe, expect, it } from 'vitest';
import { buildSampleProject } from '../src/model/sample';
import { DUPLICATE_NEED_DEVICE } from '../src/model/commands';
import { COPY_NEED_NODE } from '../src/model/copyPaste';
import { EDIT_LOCKED } from '../src/ui/contextMenuModel';
import {
  COMMAND_GROUPS,
  COMMANDS,
  EXTRA_GROUP,
  EXTRA_SHORTCUTS,
  NO_FLOW_ROW,
  blankCommandState,
  commandForEvent,
  eventMatches,
  formatKey,
  normalizeQuery,
  shortcutSheet,
  shortcutText,
  usesMacShortcut,
  visibleCommands,
  type KeySpec,
} from '../src/ui/commandModel';
import { readFileSync } from 'node:fs';

const project = buildSampleProject();
const appSrc = readFileSync('src/ui/App.tsx', 'utf8');

function press(spec: KeySpec, over: Partial<{ ctrl: boolean; meta: boolean; shift: boolean; alt: boolean }> = {}) {
  const key = spec.key.length === 1 && spec.key !== '?' ? spec.key : spec.key === '?' ? '?' : spec.key;
  return {
    key,
    ctrlKey: over.ctrl ?? !!spec.mod,
    metaKey: over.meta ?? false,
    shiftKey: over.shift ?? (spec.key === '?' ? true : !!spec.shift),
    altKey: over.alt ?? !!spec.alt,
  };
}

describe('TURN-053 command definitions', () => {
  it('AC2 filters by name, ignoring case and spaces', () => {
    const state = blankCommandState(project, { step: 'sequence' });
    const parallel = visibleCommands(state, '병렬').map((r) => r.name);
    expect(parallel).toContain('병렬로 묶기');
    expect(parallel.every((name) => normalizeQuery(name).includes('병렬'))).toBe(true);
    expect(visibleCommands(state, '병 렬').some((r) => r.name === '병렬로 묶기')).toBe(true);
    const view = visibleCommands(state, '3d').map((r) => r.name);
    expect(view).toContain('3D 보기');
    expect(visibleCommands(state, '3 D').some((r) => r.name === '3D 보기')).toBe(true);
    expect(visibleCommands(state, '3D').some((r) => r.name === '3D 보기')).toBe(true);
  });

  it('AC4 lists every command from the seven groups', () => {
    expect(new Set(COMMANDS.map((c) => c.group))).toEqual(new Set(COMMAND_GROUPS));
    const names = COMMANDS.map((c) => (typeof c.name === 'string' ? c.name : c.name(blankCommandState(project))));
    const need = [
      '1 입력·에셋 선택', '2 배치·연결', '3 속성·Action', '4 자재·시퀀스', '5 점검', '6 실행·저장',
      '에셋 라이브러리', '입력 후보표 (F1)', 'AML 입출력', '자료 입력',
      '카드 보드', '도면 도식', 'Station 시퀀스 Draft (F5)', 'Substation 시퀀스', '자재·Flow (F4)', 'SFC 미리보기', '누락 편집 확장',
      'Gap (F6)', '진단·저장·AML', 'Export 미리보기 (F8)', 'Evolution Lab (F7)',
      '저장', 'JSON 내보내기', '인쇄용 보기', 'JSON 가져오기', '새 프로젝트', '예제 열기', '병렬 예제', '흐름 예제',
      '실행 취소', '다시 실행', '복사', '붙여넣기', '복제', '삭제', '모두 선택',
      '좌 정렬', '상 정렬', '가로 간격 같게', '세로 간격 같게', '너비 같게', '높이 같게', '겹침 풀기', '자동 정렬', '크기 맞춤',
      '물류 연결', '신호 연결',
      '분기로 묶기', '병렬로 묶기', '반복으로 묶기', '재시도로 묶기', '블록 풀기', '신호 기다림 추가', 'Substation 시퀀스 넣기',
      '실행', '일시정지', '재개', '+0.1s', '초기화', '끝까지', '도면 보기', '3D 보기', '화면 맞춤',
      '라이트', '다크', '이름 표시', '미니맵', '탐색기 접기', '보기 설정', '둘러보기 다시 보기', '단축키 목록', '명령 · 대상 찾기',
    ];
    for (const name of need) expect(names, name).toContain(name);
  });

  it('AC5 availability reuses the context-menu reasons', () => {
    const bare = blankCommandState(project, { step: 'canvas' });
    const dup = visibleCommands(bare, '복제').find((r) => r.id === 'duplicate')!;
    expect(dup.ok).toBe(false);
    expect(dup.reason).toBe(DUPLICATE_NEED_DEVICE);
    const locked = visibleCommands(blankCommandState(project, { step: 'sequence', locked: true, flowPicked: ['a'] }), '병렬로 묶기');
    expect(locked.find((r) => r.id === 'wrap-parallel')!.reason).toBe(EDIT_LOCKED);
    const copy = visibleCommands(bare, '복사').find((r) => r.id === 'copy')!;
    expect(copy.reason).toBe(COPY_NEED_NODE);
    const none = visibleCommands(blankCommandState(project, { step: 'run' }), '병렬').find((r) => r.id === 'wrap-parallel')!;
    expect(none.ok).toBe(false);
    expect(none.reason).toBe(NO_FLOW_ROW);
  });

  it('AC7 puts commands that work on this step first', () => {
    const run = visibleCommands(blankCommandState(project, { step: 'run' }), '');
    const view3d = run.findIndex((r) => r.id === 'view-3d');
    const parallel = run.findIndex((r) => r.id === 'wrap-parallel');
    expect(view3d).toBeGreaterThanOrEqual(0);
    expect(parallel).toBeGreaterThan(view3d);
    expect(run[view3d].ok).toBe(true);
    expect(run[parallel].ok).toBe(false);
    expect(run[0].rank).toBe(0);
    expect(run[0].ok).toBe(true);
    expect(COMMANDS.find((c) => c.id === run[0].id)?.steps?.includes('run')).toBe(true);
    const firstDim = run.findIndex((r) => !r.ok);
    expect(run.slice(0, firstDim).every((r) => r.ok)).toBe(true);
    expect(run.slice(firstDim).every((r) => !r.ok)).toBe(true);

    const sequence = visibleCommands(blankCommandState(project, { step: 'sequence', flowPicked: ['STEP'] }), '');
    const wrap = sequence.findIndex((r) => r.id === 'wrap-parallel');
    const flow = sequence.findIndex((r) => r.id === 'mode-flow');
    expect(wrap).toBeGreaterThanOrEqual(0);
    expect(flow).toBeGreaterThan(wrap);
    expect(sequence[wrap].rank).toBe(0);
    expect(sequence[flow].rank).toBe(2);
  });

  it('AC9 shortcut rows come from commands or the extra group, and match the key test', () => {
    const state = blankCommandState(project);
    const sheet = shortcutSheet(state, false);
    const lines = sheet.flatMap((g) => g.rows);
    const commandIds = new Set(COMMANDS.filter((c) => c.keys?.length).map((c) => c.id));
    const extraIds = new Set(EXTRA_SHORTCUTS.map((r) => r.id));
    for (const line of lines) {
      if (line.source === 'command') expect(commandIds.has(line.id)).toBe(true);
      else expect(extraIds.has(line.id)).toBe(true);
    }
    for (const id of commandIds) expect(lines.some((l) => l.id === id && l.source === 'command')).toBe(true);
    for (const id of extraIds) expect(lines.some((l) => l.id === id && l.source === 'extra')).toBe(true);
    expect(sheet.some((g) => g.group === EXTRA_GROUP)).toBe(true);
    expect(sheet.find((g) => g.group === EXTRA_GROUP)!.rows.map((r) => r.name)).toEqual(EXTRA_SHORTCUTS.map((r) => r.name));

    for (const cmd of COMMANDS) {
      for (const spec of cmd.keys ?? []) {
        expect(commandForEvent(press(spec))?.id, `${cmd.id} ${spec.key}`).toBe(cmd.id);
        expect(eventMatches(press(spec), spec)).toBe(true);
        if (spec.mod) expect(commandForEvent(press(spec, { ctrl: false, meta: false }))?.id).not.toBe(cmd.id);
      }
    }
    expect(commandForEvent(press({ key: 'z', mod: true, shift: true }))?.id).toBe('redo');
    expect(commandForEvent({ key: 'k', ctrlKey: false, metaKey: true, shiftKey: false, altKey: false })?.id).toBe('palette');
    expect(appSrc).toContain('commandForEvent');
    const undo = COMMANDS.find((c) => c.id === 'undo')!;
    expect(sheet.flatMap((g) => g.rows).find((r) => r.id === 'undo')!.keys).toBe(shortcutText(undo, false));
  });

  it('AC10 shows ⌘ on Mac and Ctrl elsewhere', () => {
    const spec: KeySpec = { key: 'k', mod: true };
    expect(formatKey(spec, true)).toBe('⌘K');
    expect(formatKey(spec, false)).toBe('Ctrl+K');
    expect(formatKey({ key: 'z', mod: true, shift: true }, true)).toBe('⌘⇧Z');
    expect(formatKey({ key: 'z', mod: true, shift: true }, false)).toBe('Ctrl+Shift+Z');
    expect(formatKey({ key: '?', shift: true }, true)).toBe('?');
    expect(formatKey({ key: '?', shift: true }, false)).toBe('?');
    expect(usesMacShortcut('MacIntel')).toBe(true);
    expect(usesMacShortcut('Win32')).toBe(false);
    expect(usesMacShortcut('Linux x86_64')).toBe(false);
  });
});
