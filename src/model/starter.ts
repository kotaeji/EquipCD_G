// TURN-075. Example cards and a skeleton project.
// Counts and the virtual time come from the sample model. They are not typed in.
// The skeleton is built with the same commands as the canvas: add a Unit, place a template, connect flow.
import { ASSET_LIBRARY } from '../assets/library';
import { addConnection, addUnit, addUnitFromTemplate, moveNodes, renameObject, UNIT_SPREAD_GAP } from './commands';
import { emptyProject, newId } from './factory';
import { placeUserTemplate, type UserTemplate } from './userTemplates';
import { rectsOverlap } from './unitLayout';
import { buildFlowSampleProject, buildParallelSampleProject, buildSampleProject } from './sample';
import type { Project } from './types';
import { createRuntime, runToEnd } from '../runtime/engine';

export type SampleKind = 'sample' | 'parallel' | 'flow';

export const SAMPLE_KINDS: SampleKind[] = ['sample', 'parallel', 'flow'];

/** The home button these cards replace. Opening still runs that same action. */
export const SAMPLE_OPEN_LABEL: Record<SampleKind, string> = {
  sample: '예제 열기',
  parallel: '병렬 예제',
  flow: '흐름 예제',
};

const SAMPLE_ICON: Record<SampleKind, string> = {
  sample: 'sample',
  parallel: 'sample-parallel',
  flow: 'sample-flow',
};

const SAMPLE_COPY: Record<SampleKind, { summary: string; shows: string }> = {
  sample: {
    summary: '투입부터 배출까지 다섯 공정을 한 줄로 실행하는 조립 라인입니다.',
    shows: '순차 시퀀스',
  },
  parallel: {
    summary: '한 Substation 안에서 시퀀스 두 개가 한 시계로 동시에 끝납니다.',
    shows: '병렬 · Substation 단계',
  },
  flow: {
    summary: '읽기 결과로 갈라지고, 실패하면 다시 읽으며, 가공을 반복합니다.',
    shows: '분기 · 재시도',
  },
};

export interface SampleCard {
  kind: SampleKind;
  icon: string;
  /** Accessible name of the old home button. The visible word is 「열기」. */
  openLabel: string;
  name: string;
  summary: string;
  shows: string;
  units: number;
  devices: number;
  steps: number;
  virtualMs: number;
}

/** Station steps plus Substation steps. A loop is not unrolled. */
export function sampleStepCount(p: Project): number {
  const sub = (p.substationSequences ?? []).reduce((n, q) => n + q.steps.length, 0);
  return p.sequence.steps.length + sub;
}

/** Virtual milliseconds until the sample run stops. */
export function sampleVirtualMs(p: Project): number {
  return runToEnd(createRuntime(p)).state.timeMs;
}

export function formatVirtualTime(ms: number): string {
  const sec = ms / 1000;
  const text = Number.isInteger(sec) ? String(sec) : sec.toFixed(1).replace(/\.0$/, '');
  return `${text} s`;
}

function cardOf(kind: SampleKind, project: Project): SampleCard {
  const copy = SAMPLE_COPY[kind];
  return {
    kind,
    icon: SAMPLE_ICON[kind],
    openLabel: SAMPLE_OPEN_LABEL[kind],
    name: project.name,
    summary: copy.summary,
    shows: copy.shows,
    units: project.units.length,
    devices: project.devices.length,
    steps: sampleStepCount(project),
    virtualMs: sampleVirtualMs(project),
  };
}

let cardCache: SampleCard[] | null = null;

export function sampleCards(): SampleCard[] {
  if (!cardCache) {
    cardCache = [
      cardOf('sample', buildSampleProject()),
      cardOf('parallel', buildParallelSampleProject()),
      cardOf('flow', buildFlowSampleProject()),
    ];
  }
  return cardCache;
}

export const STARTER_MIN_UNITS = 1;
export const STARTER_MAX_UNITS = 8;
export const STARTER_NEXT = '다음: 3단계에서 Action 을 확인하고 4단계에서 시퀀스를 만드세요';

export type StarterFill =
  | { kind: 'empty' }
  | { kind: 'bundle'; assetKind: string }
  | { kind: 'user'; template: UserTemplate };

export interface StarterUnit {
  name: string;
  fill: StarterFill;
}

export interface StarterSpec {
  name: string;
  units: StarterUnit[];
  linkFlow: boolean;
}

export interface StarterPreview {
  units: number;
  devices: number;
  connections: number;
}

export type StarterResult = { ok: true; project: Project } | { ok: false; reason: string };

function createdId(note: string | undefined): string | null {
  const id = (note ?? '').split('\n')[0]?.split(',')[0]?.trim() ?? '';
  return id || null;
}

/** Push a Unit right until its box clears the Unit on its left. Uses the move command. */
function separateUnits(project: Project): Project {
  let cur = project;
  for (let guard = 0; guard < 24; guard++) {
    const ordered = [...cur.units].sort((a, b) => a.layout.x - b.layout.x || a.layout.y - b.layout.y || (a.id < b.id ? -1 : 1));
    let moved = false;
    for (let i = 1; i < ordered.length; i++) {
      const prev = cur.units.find((u) => u.id === ordered[i - 1].id)!;
      const unit = cur.units.find((u) => u.id === ordered[i].id)!;
      const overlaps = rectsOverlap(prev.layout, unit.layout);
      const gap = unit.layout.x - (prev.layout.x + prev.layout.w);
      if (!overlaps && gap >= UNIT_SPREAD_GAP) continue;
      const dx = prev.layout.x + prev.layout.w + UNIT_SPREAD_GAP - unit.layout.x;
      if (dx <= 0) continue;
      const shifted = moveNodes(cur, [unit.id], dx, 0);
      if (!shifted.ok) return cur;
      cur = shifted.project;
      moved = true;
      break;
    }
    if (!moved) return cur;
  }
  return cur;
}

/**
 * Build a new project from the wizard answers.
 * Sequences and materials are left empty. Undo is the caller's job: this returns one project, not a history.
 */
export function buildStarter(spec: StarterSpec, idOf: (prefix: string) => string = newId): StarterResult {
  if (spec.units.length < STARTER_MIN_UNITS || spec.units.length > STARTER_MAX_UNITS) {
    return { ok: false, reason: `Unit 수는 ${STARTER_MIN_UNITS}에서 ${STARTER_MAX_UNITS}까지입니다` };
  }
  const name = spec.name.trim() || '새 프로젝트';
  let project = emptyProject(name, idOf);
  const ids: string[] = [];
  let x = 30;
  const y = 70;
  for (let i = 0; i < spec.units.length; i++) {
    const unit = spec.units[i];
    const unitName = unit.name.trim() || `S${i + 1}`;
    const fill = unit.fill;
    const placed = fill.kind === 'empty'
      ? addUnit(project, unitName, { x, y }, idOf)
      : fill.kind === 'bundle'
        ? addUnitFromTemplate(project, fill.assetKind, { x, y }, idOf)
        : placeUserTemplate(project, fill.template, { x, y }, idOf);
    if (!placed.ok) return { ok: false, reason: placed.reason };
    project = placed.project;
    const id = createdId(placed.note);
    if (!id || !project.units.some((u) => u.id === id)) return { ok: false, reason: '놓은 Unit 을 찾지 못했습니다' };
    if (fill.kind !== 'empty') {
      const renamed = renameObject(project, id, unitName);
      if (!renamed.ok) return { ok: false, reason: renamed.reason };
      project = renamed.project;
    }
    ids.push(id);
    const box = project.units.find((u) => u.id === id)!;
    x = box.layout.x + box.layout.w + UNIT_SPREAD_GAP;
  }
  if (spec.linkFlow) {
    for (let i = 0; i < ids.length - 1; i++) {
      const linked = addConnection(project, 'flow', ids[i], ids[i + 1], idOf);
      if (!linked.ok) return { ok: false, reason: linked.reason };
      project = linked.project;
    }
  }
  project = separateUnits(project);
  return { ok: true, project };
}

export function starterPreview(project: Project): StarterPreview {
  return {
    units: project.units.length,
    devices: project.devices.length,
    connections: project.connections.length,
  };
}

export function bundleTemplates() {
  return ASSET_LIBRARY.filter((d) => d.template);
}
