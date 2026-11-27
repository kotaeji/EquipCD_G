// TURN-053. Command names, groups, shortcuts, availability, and the call to make.
// Opening the palette does not edit the model. Availability phrases that the context menu
// already uses are taken from the same helpers.
import { findById } from '../model/flow';
import {
  ARRANGE_DEVICES_LOCKED,
  ARRANGE_NEED_2,
  ARRANGE_NEED_3,
  arrangeDevicesTarget,
  DEVICE_ARRANGE_NEED_2,
  DEVICE_ARRANGE_NEED_3,
  DEVICE_ARRANGE_ONE_UNIT,
  DUPLICATE_NEED_DEVICE,
  selectedArrangeTarget,
  SUB_NO_PARALLEL,
  SUB_NO_SUBSTEP,
  type WrapKind,
} from '../model/commands';
import { COPY_NEED_NODE } from '../model/copyPaste';
import type { FlowNode, Project } from '../model/types';
import { EDIT_LOCKED, pasteBlockReason } from './contextMenuModel';
import { TOUR_AGAIN, TOUR_BUTTON } from './tour';
import type { LayoutTab } from './viewSettings';
import { STEPS, type StepId } from './wizard';

export const COMMAND_GROUPS = ['이동', '파일', '편집', '연결', '시퀀스', '실행', '보기'] as const;
export type CommandGroup = (typeof COMMAND_GROUPS)[number];

export const EXTRA_GROUP = '그 밖의 조작';

/** Shown when a sequence wrap has no rows. The flow toolbar disables the same case. */
export const NO_FLOW_ROW = '고른 줄이 없습니다';
export const NO_SELECTION = '고른 것이 없습니다';
export const NOT_RUNNING = '실행 중이 아닙니다';
export const NOT_PAUSED = '일시정지 중이 아닙니다';
export const NO_RUN = '실행 기록이 없습니다';
export const RUN_BUSY = '실행 중이거나 일시정지 중입니다. 초기화한 뒤 다시 실행하세요.';
export const NEED_ONE_UNIT = 'Unit 하나를 고르세요';
export const NEED_ONE_BLOCK = '블록을 하나 고르세요';

export interface KeySpec {
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface CommandState {
  step: StepId;
  home: boolean;
  locked: boolean;
  running: boolean;
  paused: boolean;
  /** No runtime, or the runtime is idle. */
  idle: boolean;
  hasRuntime: boolean;
  canUndo: boolean;
  canRedo: boolean;
  project: Project;
  selection: string[];
  hasClip: boolean;
  /** Row ids checked in the Station flow table. Survives a step change. */
  flowPicked: string[];
  /** 4단계 Substation 시퀀스 화면. 그 화면에서는 병렬과 Substation 단계를 넣지 않는다. */
  flowHome: 'station' | 'substation';
  appearance: 'light' | 'dark';
  showNames: boolean;
  explorerOpen: boolean;
  minimapLayout: boolean;
  minimapRun: boolean;
  tourSeen: boolean;
}

export interface CommandActions {
  goStep: (step: StepId, sub?: string) => void;
  setLayoutTab: (tab: LayoutTab) => void;
  setRunView: (view: 'diagram' | '3d') => void;
  save: () => void;
  exportJson: () => void;
  openPrint: () => void;
  importJson: () => void;
  newProject: (kind: 'blank' | 'sample' | 'parallel' | 'flow') => void;
  undo: () => void;
  redo: () => void;
  openHistory: () => void;
  copy: () => void;
  paste: () => void;
  duplicate: () => void;
  deleteSelection: () => void;
  selectAll: () => void;
  align: (mode: 'left' | 'top') => void;
  distribute: (axis: 'x' | 'y') => void;
  matchSize: (axis: 'w' | 'h') => void;
  spread: () => void;
  arrangeDevices: () => void;
  arrangeSelected: () => void;
  fitUnit: () => void;
  connectMode: (mode: 'flow' | 'signal') => void;
  wrapFlow: (kind: WrapKind) => void;
  unwrapFlow: () => void;
  addWait: () => void;
  addSubstation: () => void;
  run: () => void;
  pause: () => void;
  resume: () => void;
  stepTime: () => void;
  reset: () => void;
  toEnd: () => void;
  fitView: () => void;
  theme: (mode: 'light' | 'dark') => void;
  toggleNames: () => void;
  toggleMinimap: () => void;
  toggleExplorer: () => void;
  openViewSettings: () => void;
  startTour: () => void;
  openShortcuts: () => void;
  openPalette: () => void;
}

type Gate = { ok: true } | { ok: false; reason: string };
const yes = (): Gate => ({ ok: true });
const no = (reason: string): Gate => ({ ok: false, reason });

export interface CommandDef {
  id: string;
  name: string | ((s: CommandState) => string);
  group: CommandGroup;
  /** Steps where an enabled command sorts first. Omit when it belongs on every step. */
  steps?: readonly StepId[];
  keys?: readonly KeySpec[];
  /** Where the shortcut works. Shortcut sheet only. */
  where?: string;
  available: (s: CommandState) => Gate;
  run: (a: CommandActions, s: CommandState) => void;
}

export interface ExtraShortcut {
  id: string;
  keys: string;
  name: string;
  where: string;
}

export const EXTRA_SHORTCUTS: readonly ExtraShortcut[] = [
  { id: 'extra-flow-move', keys: '↑ ↓', name: '같은 갈래에서 줄 옮기기', where: '4단계 Station 시퀀스' },
  { id: 'extra-flow-pick', keys: 'Space', name: '줄 선택', where: '4단계 Station 시퀀스' },
  { id: 'extra-shift-drag', keys: 'Shift+끌기', name: '여러 개 고르기', where: '2단계 도면' },
  { id: 'extra-wheel', keys: '휠', name: '확대·축소', where: '도면' },
  { id: 'extra-menu', keys: 'Shift+F10', name: '우클릭 메뉴', where: '2단계 도면 · 카드 보드 · 탐색기' },
  { id: 'extra-esc', keys: 'Esc', name: '연결 취소 · 도면에서 한 겹 나오기', where: '연결 모드 · 2단계 도면' },
  { id: 'extra-tree', keys: '↑ ↓ ← →', name: '트리 이동·접기', where: '탐색기' },
  { id: 'extra-ctrl-click', keys: 'Ctrl+클릭', name: '선택과 해제', where: '2단계 도면' },
  { id: 'extra-cam-view', keys: '1 2 3 4', name: '3D 시점 등각 · 위 · 앞 · 옆', where: '6단계 3D · 장면을 누른 뒤 1~4 키' },
  { id: 'extra-cam', keys: '← → ↑ ↓', name: '3D 카메라 돌리기', where: '6단계 3D' },
  { id: 'extra-cam-zoom', keys: '+ −', name: '3D 확대·축소', where: '6단계 3D' },
  { id: 'extra-cam-home', keys: 'Home', name: '3D 화면 맞춤', where: '6단계 3D' },
  { id: 'extra-diagram-tab', keys: 'Tab · Shift+Tab', name: '도면의 Unit · Device 순회', where: '2단계 · 6단계 도면' },
  { id: 'extra-diagram-enter', keys: 'Enter', name: '도면에서 Unit 안으로 · 연결 확정', where: '2단계 · 6단계 도면' },
  { id: 'extra-diagram-nudge', keys: '← → ↑ ↓', name: '도면 격자 한 칸(10) 이동', where: '2단계 · 6단계 도면' },
  { id: 'extra-diagram-nudge-lg', keys: 'Shift+방향키', name: '도면 큰 걸음(50) 이동', where: '2단계 · 6단계 도면' },
  { id: 'extra-diagram-nudge-px', keys: 'Alt+방향키', name: '도면 1 이동', where: '2단계 · 6단계 도면' },
  { id: 'extra-diagram-flow', keys: 'L', name: '물류 잇기', where: '2단계 · 6단계 도면' },
  { id: 'extra-diagram-signal', keys: 'S', name: '신호 잇기', where: '2단계 · 6단계 도면' },
  { id: 'extra-diagram-zoom', keys: '+ −', name: '도면 확대·축소', where: '2단계 · 6단계 도면' },
  { id: 'extra-diagram-fit', keys: '0', name: '도면 화면 맞춤', where: '2단계 · 6단계 도면' },
  { id: 'extra-arrange-selected', keys: '배치 ▾', name: '고른 것만 자동 정렬', where: '2단계 도면 · Unit 둘 이상' },
];

function unitIds(s: CommandState) {
  return s.selection.filter((id) => s.project.units.some((u) => u.id === id));
}
function deviceIds(s: CommandState) {
  return s.selection.filter((id) => s.project.devices.some((d) => d.id === id));
}
function nodeIds(s: CommandState) {
  return s.selection.filter((id) => s.project.units.some((u) => u.id === id) || s.project.devices.some((d) => d.id === id));
}
function oneConnection(s: CommandState) {
  return s.selection.length === 1 && s.project.connections.some((c) => c.id === s.selection[0]);
}

/** Unit count wins. Otherwise Devices of one Unit. `unitsOnly` ignores Devices. */
function arrangeGate(s: CommandState, min: number, unitsOnly = false): Gate {
  if (s.locked) return no(EDIT_LOCKED);
  const units = unitIds(s);
  const devs = deviceIds(s);
  if (!unitsOnly && units.length < 2 && devs.length >= 2) {
    const owners = new Set(devs.map((id) => s.project.devices.find((d) => d.id === id)!.unitId));
    if (owners.size !== 1) return no(DEVICE_ARRANGE_ONE_UNIT);
    if (devs.length < min) return no(min >= 3 ? DEVICE_ARRANGE_NEED_3 : DEVICE_ARRANGE_NEED_2);
    return yes();
  }
  if (units.length < min) return no(min >= 3 ? ARRANGE_NEED_3 : ARRANGE_NEED_2);
  return yes();
}

function lockOr(s: CommandState, reason: string | undefined): Gate {
  if (s.locked) return no(EDIT_LOCKED);
  if (reason) return no(reason);
  return yes();
}

function pickedFlow(s: CommandState): FlowNode | null {
  if (s.flowPicked.length !== 1 || !s.project.sequence.flow) return null;
  return findById(s.project.sequence.flow, s.flowPicked[0])?.node ?? null;
}

function wrapGate(s: CommandState): Gate {
  if (s.locked) return no(EDIT_LOCKED);
  if (s.flowPicked.length === 0) return no(NO_FLOW_ROW);
  return yes();
}

function wrapParallelGate(s: CommandState): Gate {
  if (s.flowHome === 'substation') return no(SUB_NO_PARALLEL);
  return wrapGate(s);
}

function addSubstationGate(s: CommandState): Gate {
  if (s.flowHome === 'substation') return no(SUB_NO_SUBSTEP);
  if (s.locked) return no(EDIT_LOCKED);
  return s.project.units.length ? yes() : no('Substation 없음');
}

function go(step: StepId, sub?: string) {
  return (a: CommandActions) => { a.goStep(step, sub); };
}

const stepCommands: CommandDef[] = STEPS.map((s) => ({
  id: `step-${s.id}`,
  name: `${s.no} ${s.label}`,
  group: '이동' as const,
  available: yes,
  run: go(s.id),
}));

const tab = (
  id: string, name: string, step: StepId, sub: string | undefined, run: (a: CommandActions) => void,
): CommandDef => ({
  id, name, group: '이동', steps: [step], available: yes, run: (a) => { a.goStep(step, sub); run(a); },
});

export const COMMANDS: readonly CommandDef[] = [
  ...stepCommands,
  tab('tab-cards', '에셋 라이브러리', 'library', 'cards', () => {}),
  tab('tab-input', '입력 후보표 (F1)', 'library', 'input', () => {}),
  tab('tab-aml', 'AML 입출력', 'library', 'aml', () => {}),
  tab('tab-extract', '자료 입력', 'library', 'extract', () => {}),
  tab('tab-board', '카드 보드', 'canvas', undefined, (a) => a.setLayoutTab('board')),
  tab('tab-diagram', '도면 도식', 'canvas', undefined, (a) => a.setLayoutTab('diagram')),
  tab('tab-station', 'Station 시퀀스 Draft (F5)', 'sequence', 'sequence', () => {}),
  tab('tab-subseq', 'Substation 시퀀스', 'sequence', 'subseq', () => {}),
  tab('tab-material', '자재·Flow (F4)', 'sequence', 'material', () => {}),
  tab('tab-sfc', 'SFC 미리보기', 'sequence', 'sfc', () => {}),
  tab('tab-extend', '누락 편집 확장', 'sequence', 'extend', () => {}),
  tab('tab-gap', 'Gap (F6)', 'check', 'gap', () => {}),
  tab('tab-diag', '진단·저장·AML', 'check', 'diag', () => {}),
  tab('tab-export', 'Export 미리보기 (F8)', 'check', 'export', () => {}),
  tab('tab-lab', 'Evolution Lab (F7)', 'check', 'lab', () => {}),

  { id: 'save', name: '저장', group: '파일', available: yes, run: (a) => a.save() },
  { id: 'export-json', name: 'JSON 내보내기', group: '파일', available: yes, run: (a) => a.exportJson() },
  { id: 'print-view', name: '인쇄용 보기', group: '파일', available: yes, run: (a) => a.openPrint() },
  { id: 'import-json', name: 'JSON 가져오기', group: '파일', available: yes, run: (a) => a.importJson() },
  { id: 'new-project', name: '새 프로젝트', group: '파일', available: yes, run: (a) => a.newProject('blank') },
  { id: 'sample', name: '예제 열기', group: '파일', available: yes, run: (a) => a.newProject('sample') },
  { id: 'sample-parallel', name: '병렬 예제', group: '파일', available: yes, run: (a) => a.newProject('parallel') },
  { id: 'sample-flow', name: '흐름 예제', group: '파일', available: yes, run: (a) => a.newProject('flow') },

  {
    id: 'undo', name: '실행 취소', group: '편집', where: '입력 칸 밖',
    keys: [{ key: 'z', mod: true }],
    available: (s) => (s.locked ? no('실행 중에는 Undo가 차단됩니다') : s.canUndo ? yes() : no('되돌릴 편집이 없습니다')),
    run: (a) => a.undo(),
  },
  {
    id: 'redo', name: '다시 실행', group: '편집', where: '입력 칸 밖',
    keys: [{ key: 'z', mod: true, shift: true }, { key: 'y', mod: true }],
    available: (s) => (s.locked ? no('실행 중에는 Redo가 차단됩니다') : s.canRedo ? yes() : no('다시 실행할 편집이 없습니다')),
    run: (a) => a.redo(),
  },
  {
    id: 'undo-history', name: '실행 취소 이력', group: '편집',
    available: yes,
    run: (a) => a.openHistory(),
  },
  {
    id: 'copy', name: '복사', group: '편집', steps: ['canvas'], where: '2단계 · 탐색기',
    keys: [{ key: 'c', mod: true }],
    available: (s) => (nodeIds(s).length ? yes() : no(COPY_NEED_NODE)),
    run: (a) => a.copy(),
  },
  {
    id: 'paste', name: '붙여넣기', group: '편집', steps: ['canvas'], where: '2단계 · 탐색기',
    keys: [{ key: 'v', mod: true }],
    available: (s) => {
      const reason = pasteBlockReason(s.locked, s.hasClip, unitIds(s).length);
      return reason ? no(reason) : yes();
    },
    run: (a) => a.paste(),
  },
  {
    id: 'duplicate', name: '복제', group: '편집', steps: ['canvas', 'attributes'], where: '2단계 · 3단계',
    keys: [{ key: 'd', mod: true }],
    available: (s) => (s.locked ? no('실행 중에는 복제가 차단됩니다') : unitIds(s).length || deviceIds(s).length ? yes() : no(DUPLICATE_NEED_DEVICE)),
    run: (a) => a.duplicate(),
  },
  {
    id: 'delete', name: '삭제', group: '편집', steps: ['canvas', 'attributes'], where: '2단계 · 3단계',
    keys: [{ key: 'Delete' }, { key: 'Backspace' }],
    available: (s) => (s.locked ? no('실행 중에는 삭제가 차단됩니다') : nodeIds(s).length || oneConnection(s) ? yes() : no(NO_SELECTION)),
    run: (a) => a.deleteSelection(),
  },
  {
    id: 'select-all', name: '모두 선택', group: '편집', steps: ['canvas'], where: '2단계',
    keys: [{ key: 'a', mod: true }],
    available: yes,
    run: (a) => a.selectAll(),
  },
  {
    id: 'align-left', name: '좌 정렬', group: '편집', steps: ['canvas'],
    available: (s) => lockOr(s, s.selection.length < 2 ? ARRANGE_NEED_2 : undefined),
    run: (a) => { a.goStep('canvas'); a.setLayoutTab('diagram'); a.align('left'); },
  },
  {
    id: 'align-top', name: '상 정렬', group: '편집', steps: ['canvas'],
    available: (s) => lockOr(s, s.selection.length < 2 ? ARRANGE_NEED_2 : undefined),
    run: (a) => { a.goStep('canvas'); a.setLayoutTab('diagram'); a.align('top'); },
  },
  {
    id: 'gap-x', name: '가로 간격 같게', group: '편집', steps: ['canvas'],
    available: (s) => arrangeGate(s, 3),
    run: (a) => { a.goStep('canvas'); a.setLayoutTab('diagram'); a.distribute('x'); },
  },
  {
    id: 'gap-y', name: '세로 간격 같게', group: '편집', steps: ['canvas'],
    available: (s) => arrangeGate(s, 3),
    run: (a) => { a.goStep('canvas'); a.setLayoutTab('diagram'); a.distribute('y'); },
  },
  {
    id: 'match-w', name: '너비 같게', group: '편집', steps: ['canvas'],
    available: (s) => arrangeGate(s, 2),
    run: (a) => { a.goStep('canvas'); a.setLayoutTab('diagram'); a.matchSize('w'); },
  },
  {
    id: 'match-h', name: '높이 같게', group: '편집', steps: ['canvas'],
    available: (s) => arrangeGate(s, 2),
    run: (a) => { a.goStep('canvas'); a.setLayoutTab('diagram'); a.matchSize('h'); },
  },
  {
    id: 'spread', name: '겹침 풀기', group: '편집', steps: ['canvas'],
    available: (s) => lockOr(s, unitIds(s).length < 2 ? ARRANGE_NEED_2 : undefined),
    run: (a) => { a.goStep('canvas'); a.setLayoutTab('diagram'); a.spread(); },
  },
  {
    id: 'arrange-selected', name: '고른 것만 자동 정렬', group: '편집', steps: ['canvas'],
    available: (s) => {
      if (s.locked) return no(ARRANGE_DEVICES_LOCKED);
      const target = selectedArrangeTarget(s.project, s.selection);
      if (target.kind !== 'units') return no(ARRANGE_NEED_2);
      return yes();
    },
    run: (a) => { a.goStep('canvas'); a.setLayoutTab('diagram'); a.arrangeSelected(); },
  },
  {
    id: 'arrange', name: '자동 정렬', group: '편집', steps: ['canvas'],
    available: (s) => {
      if (s.locked) return no(ARRANGE_DEVICES_LOCKED);
      const target = arrangeDevicesTarget(s.project, s.selection);
      return 'unitId' in target ? yes() : no(target.reason);
    },
    run: (a) => { a.goStep('canvas'); a.setLayoutTab('diagram'); a.arrangeDevices(); },
  },
  {
    id: 'fit-unit', name: '크기 맞춤', group: '편집', steps: ['canvas'],
    available: (s) => lockOr(s, unitIds(s).length === 1 && s.selection.length === 1 ? undefined : NEED_ONE_UNIT),
    run: (a) => { a.goStep('canvas'); a.setLayoutTab('diagram'); a.fitUnit(); },
  },

  {
    id: 'mode-flow', name: '물류 연결', group: '연결', steps: ['canvas'],
    available: yes,
    run: (a) => { a.goStep('canvas'); a.connectMode('flow'); },
  },
  {
    id: 'mode-signal', name: '신호 연결', group: '연결', steps: ['canvas'],
    available: yes,
    run: (a) => { a.goStep('canvas'); a.setLayoutTab('diagram'); a.connectMode('signal'); },
  },

  {
    id: 'wrap-branch', name: '분기로 묶기', group: '시퀀스', steps: ['sequence'],
    available: wrapGate,
    run: (a) => { a.goStep('sequence', 'sequence'); a.wrapFlow('branch'); },
  },
  {
    id: 'wrap-parallel', name: '병렬로 묶기', group: '시퀀스', steps: ['sequence'],
    available: wrapParallelGate,
    run: (a) => { a.goStep('sequence', 'sequence'); a.wrapFlow('parallel'); },
  },
  {
    id: 'wrap-loop', name: '반복으로 묶기', group: '시퀀스', steps: ['sequence'],
    available: wrapGate,
    run: (a) => { a.goStep('sequence', 'sequence'); a.wrapFlow('loop'); },
  },
  {
    id: 'wrap-retry', name: '재시도로 묶기', group: '시퀀스', steps: ['sequence'],
    available: wrapGate,
    run: (a) => { a.goStep('sequence', 'sequence'); a.wrapFlow('retry'); },
  },
  {
    id: 'unwrap', name: '블록 풀기', group: '시퀀스', steps: ['sequence'],
    available: (s) => {
      if (s.locked) return no(EDIT_LOCKED);
      if (s.flowPicked.length === 0) return no(NO_FLOW_ROW);
      const node = pickedFlow(s);
      if (!node || node.kind === 'step' || node.kind === 'wait') return no(NEED_ONE_BLOCK);
      return yes();
    },
    run: (a) => { a.goStep('sequence', 'sequence'); a.unwrapFlow(); },
  },
  {
    id: 'add-wait', name: '신호 기다림 추가', group: '시퀀스', steps: ['sequence'],
    available: (s) => (s.locked ? no(EDIT_LOCKED) : yes()),
    run: (a) => { a.goStep('sequence', 'sequence'); a.addWait(); },
  },
  {
    id: 'add-substation', name: 'Substation 시퀀스 넣기', group: '시퀀스', steps: ['sequence'],
    available: addSubstationGate,
    run: (a) => { a.goStep('sequence', 'sequence'); a.addSubstation(); },
  },

  {
    id: 'run', name: '실행', group: '실행', steps: ['run'],
    available: (s) => (s.running || s.paused ? no(RUN_BUSY) : yes()),
    run: (a) => { a.goStep('run'); a.run(); },
  },
  {
    id: 'pause', name: '일시정지', group: '실행', steps: ['run'],
    available: (s) => (s.running ? yes() : no(NOT_RUNNING)),
    run: (a) => { a.goStep('run'); a.pause(); },
  },
  {
    id: 'resume', name: '재개', group: '실행', steps: ['run'],
    available: (s) => (s.paused ? yes() : no(NOT_PAUSED)),
    run: (a) => { a.goStep('run'); a.resume(); },
  },
  {
    id: 'step-time', name: '+0.1s', group: '실행', steps: ['run'],
    available: (s) => (s.paused ? yes() : no(NOT_PAUSED)),
    run: (a) => { a.goStep('run'); a.stepTime(); },
  },
  {
    id: 'reset', name: '초기화', group: '실행', steps: ['run'],
    available: (s) => (s.hasRuntime && !s.idle ? yes() : no(NO_RUN)),
    run: (a) => { a.goStep('run'); a.reset(); },
  },
  {
    id: 'to-end', name: '끝까지', group: '실행', steps: ['run'],
    available: (s) => (s.running ? yes() : no(NOT_RUNNING)),
    run: (a) => { a.goStep('run'); a.toEnd(); },
  },
  {
    id: 'view-diagram', name: '도면 보기', group: '실행', steps: ['run'],
    available: yes,
    run: (a) => { a.goStep('run'); a.setRunView('diagram'); },
  },
  {
    id: 'view-3d', name: '3D 보기', group: '실행', steps: ['run'],
    available: yes,
    run: (a) => { a.goStep('run'); a.setRunView('3d'); },
  },
  {
    id: 'fit-view', name: '화면 맞춤', group: '실행', steps: ['canvas', 'run'],
    available: yes,
    run: (a, s) => {
      if (s.step !== 'run') { a.goStep('canvas'); a.setLayoutTab('diagram'); }
      a.fitView();
    },
  },

  { id: 'theme-light', name: '라이트', group: '보기', available: yes, run: (a) => a.theme('light') },
  { id: 'theme-dark', name: '다크', group: '보기', available: yes, run: (a) => a.theme('dark') },
  {
    id: 'names', name: '이름 표시', group: '보기', steps: ['run'], available: yes,
    run: (a) => a.toggleNames(),
  },
  {
    id: 'minimap', name: '미니맵', group: '보기', steps: ['canvas', 'run'], available: yes,
    run: (a, s) => {
      if (s.step !== 'run' && s.step !== 'canvas') { a.goStep('canvas'); a.setLayoutTab('diagram'); }
      a.toggleMinimap();
    },
  },
  {
    id: 'explorer',
    name: (s) => (s.explorerOpen ? '탐색기 접기' : '탐색기 펼치기'),
    group: '보기', available: yes, run: (a) => a.toggleExplorer(),
  },
  { id: 'view-settings', name: '보기 설정', group: '보기', available: yes, run: (a) => a.openViewSettings() },
  {
    id: 'tour',
    name: (s) => (s.tourSeen ? TOUR_AGAIN : TOUR_BUTTON),
    group: '보기', available: yes, run: (a) => a.startTour(),
  },
  {
    id: 'shortcuts', name: '단축키 목록', group: '보기', where: '입력 칸 밖',
    keys: [{ key: '?', shift: true }],
    available: yes, run: (a) => a.openShortcuts(),
  },
  {
    id: 'palette', name: '명령 · 대상 찾기', group: '보기', where: '어느 단계에서나 · 입력 칸 포함',
    keys: [{ key: 'k', mod: true }],
    available: yes, run: (a) => a.openPalette(),
  },
];

export function commandById(id: string): CommandDef | undefined {
  return COMMANDS.find((c) => c.id === id);
}

export function commandName(cmd: CommandDef, s: CommandState): string {
  return typeof cmd.name === 'string' ? cmd.name : cmd.name(s);
}

/** Letters, case, and spaces dropped so 「3 d」 matches 「3D 보기」. */
export function normalizeQuery(q: string): string {
  return q.replace(/\s+/g, '').toLowerCase();
}

export function usesMacShortcut(platform = typeof navigator === 'undefined' ? '' : navigator.platform): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

export function formatKey(spec: KeySpec, mac: boolean): string {
  if (spec.key === '?') return '?';
  const parts: string[] = [];
  if (spec.mod) parts.push(mac ? '⌘' : 'Ctrl');
  if (spec.shift) parts.push(mac ? '⇧' : 'Shift');
  if (spec.alt) parts.push(mac ? '⌥' : 'Alt');
  parts.push(spec.key.length === 1 ? spec.key.toUpperCase() : spec.key);
  return mac ? parts.join('') : parts.join('+');
}

export function shortcutText(cmd: CommandDef, mac: boolean): string {
  return (cmd.keys ?? []).map((k) => formatKey(k, mac)).join(' · ');
}

export interface CommandRow {
  id: string;
  name: string;
  group: CommandGroup;
  shortcut: string;
  ok: boolean;
  reason?: string;
  rank: number;
}

/** This step's enabled commands, then commands for every step, then other steps, then dimmed ones. */
export function visibleCommands(state: CommandState, query: string, mac = false): CommandRow[] {
  const q = normalizeQuery(query);
  const rows: { row: CommandRow; index: number }[] = [];
  COMMANDS.forEach((cmd, index) => {
    const name = commandName(cmd, state);
    if (q && !normalizeQuery(name).includes(q)) return;
    const gate = cmd.available(state);
    // 0 this step, 1 every step, 2 another step, 3 not available.
    const onStep = !!cmd.steps?.includes(state.step);
    const rank = !gate.ok ? 3 : onStep ? 0 : cmd.steps ? 2 : 1;
    rows.push({
      index,
      row: {
        id: cmd.id, name, group: cmd.group, shortcut: shortcutText(cmd, mac),
        ok: gate.ok, reason: gate.ok ? undefined : gate.reason, rank,
      },
    });
  });
  rows.sort((a, b) => a.row.rank - b.row.rank || a.index - b.index);
  return rows.map((r) => r.row);
}

export interface ShortcutLine {
  id: string;
  keys: string;
  name: string;
  where: string;
  source: 'command' | 'extra';
}

export function shortcutSheet(state: CommandState, mac: boolean): { group: string; rows: ShortcutLine[] }[] {
  const buckets = new Map<string, ShortcutLine[]>(COMMAND_GROUPS.map((g) => [g, []]));
  for (const cmd of COMMANDS) {
    if (!cmd.keys?.length || !cmd.where) continue;
    buckets.get(cmd.group)!.push({
      id: cmd.id,
      keys: shortcutText(cmd, mac),
      name: commandName(cmd, state),
      where: cmd.where,
      source: 'command',
    });
  }
  const out = [...buckets.entries()].filter(([, rows]) => rows.length).map(([group, rows]) => ({ group, rows }));
  out.push({
    group: EXTRA_GROUP,
    rows: EXTRA_SHORTCUTS.map((row) => ({ ...row, source: 'extra' as const })),
  });
  return out;
}

type KeyLike = { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean };

function eventKey(e: KeyLike): string {
  if ((e.key === '?' || e.key === '/') && e.shiftKey) return '?';
  return e.key.length === 1 ? e.key.toLowerCase() : e.key;
}

/** The palette, the shortcut sheet, and the real key handler share this test. */
export function eventMatches(e: KeyLike, spec: KeySpec): boolean {
  const key = eventKey(e);
  const want = spec.key.length === 1 && spec.key !== '?' ? spec.key.toLowerCase() : spec.key;
  if (key !== want) return false;
  if (!!spec.mod !== (e.ctrlKey || e.metaKey)) return false;
  if (!!spec.alt !== e.altKey) return false;
  if (spec.key === '?') return e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
  return !!spec.shift === e.shiftKey;
}

export function commandForEvent(e: KeyLike): CommandDef | null {
  for (const cmd of COMMANDS) {
    if (cmd.keys?.some((k) => eventMatches(e, k))) return cmd;
  }
  return null;
}

export function blankCommandState(project: Project, partial: Partial<CommandState> = {}): CommandState {
  return {
    step: 'library',
    home: false,
    locked: false,
    running: false,
    paused: false,
    idle: true,
    hasRuntime: false,
    canUndo: false,
    canRedo: false,
    project,
    selection: [],
    hasClip: false,
    flowPicked: [],
    flowHome: 'station',
    appearance: 'light',
    showNames: true,
    explorerOpen: true,
    minimapLayout: true,
    minimapRun: false,
    tourSeen: true,
    ...partial,
  };
}
