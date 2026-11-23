// TURN-050. Context menu contents and on-screen position. Opening the menu does not edit the model.
import type { Project } from '../model/types';
import { ARRANGE_DEVICES_LOCKED, ARRANGE_DEVICES_NEED_ONE, ARRANGE_NEED_2, ARRANGE_NEED_3 } from '../model/commands';
import { PASTE_EMPTY, PASTE_LOCKED, PASTE_ONE_UNIT } from '../model/copyPaste';

export type ContextHit =
  | { kind: 'device'; id: string }
  | { kind: 'unit'; id: string }
  | { kind: 'edge'; id: string }
  | { kind: 'empty' };

export type ContextSurface = 'diagram' | 'board' | 'tree' | 'run';

export interface ContextRequest {
  x: number;
  y: number;
  hit: ContextHit;
  surface: ContextSurface;
  focus: HTMLElement | null;
}

export type MenuKind = 'device' | 'unit' | 'edge' | 'empty' | 'multi';

export type MenuAction =
  | 'props'
  | 'propsView'
  | 'rename'
  | 'copy'
  | 'paste'
  | 'duplicate'
  | 'arrange'
  | 'fit'
  | 'delete'
  | 'selectAll'
  | 'fitView'
  | 'alignLeft'
  | 'alignTop'
  | 'gapX'
  | 'gapY'
  | 'matchW'
  | 'matchH';

export interface MenuItem {
  id: MenuAction;
  label: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  reason?: string;
  separatorBefore?: boolean;
}

export const SHORTCUT = {
  copy: 'Ctrl/Cmd+C',
  paste: 'Ctrl/Cmd+V',
  duplicate: 'Ctrl/Cmd+D',
  selectAll: 'Ctrl/Cmd+A',
  delete: 'Delete',
} as const;

/** Same sentence the canvas shows when a model edit is refused while running. */
export const EDIT_LOCKED = '실행 중(또는 일시정지 중)에는 모델 편집이 차단됩니다. 초기화 후 편집하세요. (화면 이동·선택·테마·레이어는 허용)';
/** Same sentence addConnection returns when a flow drop is not Unit → Unit. */
export const FLOW_UNIT_ONLY = '물류 흐름 연결은 Unit → Unit만 허용됩니다 (시제품 규칙)';

export const MENU_WIDTH = 260;
const ROW = 32;
const SEP = 9;
const PAD = 8;

export function isTextField(el: Element | null): boolean {
  if (!el) return false;
  return !!el.closest('input, textarea, select, [contenteditable="true"]');
}

/** Keep the menu inside the viewport. `x`/`y` are the pointer; the menu opens down-right from there. */
export function clampMenu(x: number, y: number, menuW: number, menuH: number, viewW: number, viewH: number, margin = 8) {
  const w = Math.max(0, menuW);
  const h = Math.max(0, menuH);
  const maxLeft = Math.max(margin, viewW - w - margin);
  const maxTop = Math.max(margin, viewH - h - margin);
  return {
    left: Math.min(Math.max(margin, x), maxLeft),
    top: Math.min(Math.max(margin, y), maxTop),
  };
}

export function menuHeight(items: MenuItem[]): number {
  return PAD + items.reduce((n, it) => n + ROW + (it.separatorBefore ? SEP : 0), 0);
}

function nodeIdsOf(p: Project, selection: string[]) {
  const units = new Set(p.units.map((u) => u.id));
  const devices = new Set(p.devices.map((d) => d.id));
  return selection.filter((id) => units.has(id) || devices.has(id));
}

/**
 * Right-click an unselected object → select only that object.
 * Right-click one of several selected nodes → keep the selection and show the multi menu.
 * Empty canvas keeps the selection.
 */
export function planContext(p: Project, selection: string[], hit: ContextHit): { selection: string[]; kind: MenuKind } {
  if (hit.kind === 'empty') return { selection, kind: 'empty' };
  const nodes = nodeIdsOf(p, selection);
  if (nodes.length >= 2 && nodes.includes(hit.id)) return { selection, kind: 'multi' };
  return { selection: [hit.id], kind: hit.kind };
}

/** Keyboard open (no pointer target): the menu follows the current selection. */
export function hitFromSelection(p: Project, selection: string[]): ContextHit {
  const nodes = nodeIdsOf(p, selection);
  if (nodes.length >= 1) {
    const id = nodes[0];
    return p.units.some((u) => u.id === id) ? { kind: 'unit', id } : { kind: 'device', id };
  }
  const edge = selection.find((id) => p.connections.some((c) => c.id === id));
  if (edge) return { kind: 'edge', id: edge };
  return { kind: 'empty' };
}

export interface MenuBuildInput {
  surface: ContextSurface;
  kind: MenuKind;
  locked: boolean;
  /** Set when paste cannot run. Omit when paste is allowed. */
  pasteReason?: string;
  canArrange: boolean;
  arrangeReason?: string;
  unitCount: number;
  /** Every selected node is a Unit (edges ignored). */
  allUnits: boolean;
  canViewProps: boolean;
}

function dim(reason: string | undefined): Pick<MenuItem, 'disabled' | 'reason'> {
  return reason ? { disabled: true, reason } : {};
}

export function buildContextMenu(input: MenuBuildInput): MenuItem[] {
  if (input.surface === 'run') {
    return [
      { id: 'fitView', label: '화면 맞춤' },
      { id: 'propsView', label: '속성 보기', ...dim(input.canViewProps ? undefined : '고른 Unit · Device · 연결이 없습니다') },
    ];
  }
  const lock = input.locked ? EDIT_LOCKED : undefined;
  if (input.kind === 'empty') {
    return [
      { id: 'paste', label: '붙여넣기', shortcut: SHORTCUT.paste, ...dim(input.pasteReason) },
      { id: 'selectAll', label: '모두 선택', shortcut: SHORTCUT.selectAll },
      { id: 'fitView', label: '화면 맞춤' },
    ];
  }
  if (input.kind === 'multi') {
    const items: MenuItem[] = [{ id: 'copy', label: '복사', shortcut: SHORTCUT.copy }];
    if (input.allUnits) {
      const align = lock ?? (input.unitCount < 2 ? ARRANGE_NEED_2 : undefined);
      const gap = lock ?? (input.unitCount < 3 ? ARRANGE_NEED_3 : undefined);
      const size = lock ?? (input.unitCount < 2 ? ARRANGE_NEED_2 : undefined);
      items.push(
        { id: 'alignLeft', label: '좌 정렬', ...dim(align) },
        { id: 'alignTop', label: '상 정렬', ...dim(align) },
        { id: 'gapX', label: '가로 간격 같게', ...dim(gap) },
        { id: 'gapY', label: '세로 간격 같게', ...dim(gap) },
        { id: 'matchW', label: '너비 같게', ...dim(size) },
        { id: 'matchH', label: '높이 같게', ...dim(size) },
      );
    }
    items.push({
      id: 'delete', label: '삭제', shortcut: SHORTCUT.delete, danger: true, separatorBefore: true,
      ...dim(input.locked ? '실행 중에는 삭제가 차단됩니다' : undefined),
    });
    return items;
  }
  if (input.kind === 'edge') {
    return [
      { id: 'props', label: '속성 열기' },
      {
        id: 'delete', label: '삭제', shortcut: SHORTCUT.delete, danger: true, separatorBefore: true,
        ...dim(input.locked ? '실행 중에는 삭제가 차단됩니다' : undefined),
      },
    ];
  }
  if (input.kind === 'device') {
    return [
      { id: 'props', label: '속성 열기' },
      { id: 'copy', label: '복사', shortcut: SHORTCUT.copy },
      { id: 'duplicate', label: '복제', shortcut: SHORTCUT.duplicate, ...dim(input.locked ? '실행 중에는 복제가 차단됩니다' : undefined) },
      {
        id: 'delete', label: '삭제', shortcut: SHORTCUT.delete, danger: true, separatorBefore: true,
        ...dim(input.locked ? '실행 중에는 삭제가 차단됩니다' : undefined),
      },
    ];
  }
  const arrange = input.locked ? ARRANGE_DEVICES_LOCKED : input.canArrange ? undefined : (input.arrangeReason || ARRANGE_DEVICES_NEED_ONE);
  return [
    { id: 'props', label: '속성 열기' },
    { id: 'rename', label: '이름 변경', ...dim(lock) },
    { id: 'copy', label: '복사', shortcut: SHORTCUT.copy },
    { id: 'paste', label: '붙여넣기(이 Unit 에)', shortcut: SHORTCUT.paste, ...dim(input.pasteReason) },
    { id: 'arrange', label: '자동 정렬', ...dim(arrange) },
    { id: 'fit', label: '크기 맞춤', ...dim(lock) },
    {
      id: 'delete', label: '삭제', shortcut: SHORTCUT.delete, danger: true, separatorBefore: true,
      ...dim(input.locked ? '실행 중에는 삭제가 차단됩니다' : undefined),
    },
  ];
}

/** Paste refusal shared by the empty menu and the Unit menu. A missing clipboard or a running project wins. */
export function pasteBlockReason(locked: boolean, hasClip: boolean, unitPickCount: number, emptyReason = PASTE_EMPTY): string | undefined {
  if (locked) return PASTE_LOCKED;
  if (!hasClip) return emptyReason;
  if (unitPickCount > 1) return PASTE_ONE_UNIT;
  return undefined;
}
