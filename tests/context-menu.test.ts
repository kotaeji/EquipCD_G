import { describe, expect, it } from 'vitest';
import { buildSampleProject } from '../src/model/sample';
import { PASTE_EMPTY, PASTE_LOCKED, PASTE_ONE_UNIT } from '../src/model/copyPaste';
import { ARRANGE_NEED_2, ARRANGE_NEED_3 } from '../src/model/commands';
import {
  MENU_WIDTH,
  buildContextMenu,
  clampMenu,
  menuHeight,
  pasteBlockReason,
  planContext,
} from '../src/ui/contextMenuModel';

const base = {
  locked: false,
  canArrange: true,
  unitCount: 1,
  allUnits: false,
  canViewProps: true,
};

describe('TURN-050 menu position', () => {
  it('AC12: a menu opened at the bottom-right of 1280×800 stays inside', () => {
    const menuW = MENU_WIDTH;
    const menuH = 280;
    const box = clampMenu(1270, 790, menuW, menuH, 1280, 800);
    expect(box.left).toBeGreaterThanOrEqual(8);
    expect(box.top).toBeGreaterThanOrEqual(8);
    expect(box.left + menuW).toBeLessThanOrEqual(1280 - 8);
    expect(box.top + menuH).toBeLessThanOrEqual(800 - 8);
    expect(box).toEqual({ left: 1280 - menuW - 8, top: 800 - menuH - 8 });
  });

  it('AC12: a menu opened at the top-left is not pushed off the origin', () => {
    expect(clampMenu(-40, -10, 200, 80, 1280, 800)).toEqual({ left: 8, top: 8 });
  });

  it('AC12: estimated height matches the rows the menu renders', () => {
    const items = buildContextMenu({ ...base, surface: 'diagram', kind: 'device' });
    expect(menuHeight(items)).toBe(8 + 32 * 4 + 9);
  });
});

describe('TURN-050 menu contents', () => {
  const p = buildSampleProject();

  it('right-click selects an unselected object and keeps a multi selection', () => {
    expect(planContext(p, [], { kind: 'device', id: 'PSH-01' })).toEqual({ selection: ['PSH-01'], kind: 'device' });
    expect(planContext(p, ['U-S2'], { kind: 'unit', id: 'U-S1' })).toEqual({ selection: ['U-S1'], kind: 'unit' });
    expect(planContext(p, ['U-S1', 'U-S2'], { kind: 'unit', id: 'U-S2' }).kind).toBe('multi');
    expect(planContext(p, ['U-S1', 'U-S2'], { kind: 'unit', id: 'U-S2' }).selection).toEqual(['U-S1', 'U-S2']);
    expect(planContext(p, ['U-S1', 'PSH-01'], { kind: 'empty' }).selection).toEqual(['U-S1', 'PSH-01']);
  });

  it('lists the commands for each target, with shortcuts and the danger item last', () => {
    const labels = (kind: 'device' | 'unit' | 'edge' | 'empty') => buildContextMenu({ ...base, surface: 'diagram', kind, pasteReason: PASTE_EMPTY }).map((item) => item.label);
    expect(labels('device')).toEqual(['속성 열기', '복사', '복제', '삭제']);
    expect(labels('unit')).toEqual(['속성 열기', '이름 변경', '복사', '붙여넣기(이 Unit 에)', '자동 정렬', '크기 맞춤', '삭제']);
    expect(labels('edge')).toEqual(['속성 열기', '삭제']);
    expect(labels('empty')).toEqual(['붙여넣기', '모두 선택', '화면 맞춤']);
    const device = buildContextMenu({ ...base, surface: 'diagram', kind: 'device' });
    expect(device.find((item) => item.id === 'copy')?.shortcut).toBe('Ctrl/Cmd+C');
    expect(device.find((item) => item.id === 'duplicate')?.shortcut).toBe('Ctrl/Cmd+D');
    const del = device[device.length - 1];
    expect(del.id).toBe('delete');
    expect(del.danger).toBe(true);
    expect(del.separatorBefore).toBe(true);
    expect(del.shortcut).toBe('Delete');
  });

  it('dims edits while running and keeps view commands', () => {
    const unit = buildContextMenu({ ...base, surface: 'tree', kind: 'unit', locked: true, pasteReason: PASTE_LOCKED, canArrange: false });
    expect(unit.find((item) => item.id === 'props')?.disabled).toBeUndefined();
    expect(unit.find((item) => item.id === 'copy')?.disabled).toBeUndefined();
    for (const id of ['rename', 'paste', 'arrange', 'fit', 'delete']) expect(unit.find((item) => item.id === id)?.disabled).toBe(true);
    expect(unit.find((item) => item.id === 'paste')?.reason).toBe(PASTE_LOCKED);
    const run = buildContextMenu({ ...base, surface: 'run', kind: 'device', locked: true });
    expect(run.map((item) => item.label)).toEqual(['화면 맞춤', '속성 보기']);
    expect(run.every((item) => !item.disabled)).toBe(true);
  });

  it('shows align, gap, and size on a multi Unit selection and dims what needs more Units', () => {
    const items = buildContextMenu({ ...base, surface: 'diagram', kind: 'multi', allUnits: true, unitCount: 2 });
    expect(items.map((item) => item.id)).toEqual(['copy', 'alignLeft', 'alignTop', 'gapX', 'gapY', 'matchW', 'matchH', 'delete']);
    expect(items.find((item) => item.id === 'alignLeft')?.disabled).toBeUndefined();
    expect(items.find((item) => item.id === 'gapX')?.reason).toBe(ARRANGE_NEED_3);
    expect(items.find((item) => item.id === 'matchW')?.disabled).toBeUndefined();
    const devices = buildContextMenu({ ...base, surface: 'board', kind: 'multi', allUnits: false, unitCount: 0 });
    expect(devices.map((item) => item.id)).toEqual(['copy', 'delete']);
    expect(buildContextMenu({ ...base, surface: 'diagram', kind: 'multi', allUnits: true, unitCount: 1 }).find((item) => item.id === 'alignLeft')?.reason).toBe(ARRANGE_NEED_2);
  });

  it('pasteBlockReason matches the paste command', () => {
    expect(pasteBlockReason(true, true, 1)).toBe(PASTE_LOCKED);
    expect(pasteBlockReason(false, false, 1)).toBe(PASTE_EMPTY);
    expect(pasteBlockReason(false, true, 2)).toBe(PASTE_ONE_UNIT);
    expect(pasteBlockReason(false, true, 1)).toBeUndefined();
  });
});
