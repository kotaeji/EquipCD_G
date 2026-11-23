// Station sequence flow tree (TURN-022). Flat `steps` stay the action list; `flow` is the control structure.
// Parallel-inside-parallel and substation-inside-parallel are rejected. Other nesting is allowed.
import type { Condition, FlowNode, Project, SequenceStep } from './types';
import { DEFAULT_MAX_RETRIES } from './types';
import type { Diagnostic } from './validate';

export { DEFAULT_MAX_RETRIES };

export function hasFlow(p: Project): boolean {
  return Array.isArray(p.sequence.flow);
}

export function linearFlow(steps: SequenceStep[]): FlowNode[] {
  return steps.map((s) => ({ kind: 'step', stepId: s.id }));
}

/**
 * Indices into `sequence.steps` when the run is a flat list.
 * No `flow` uses the step array. A flow of only `step` nodes uses that order.
 * A branch, parallel, loop, retry, or substation step returns null.
 */
export function stepOrder(p: Project): number[] | null {
  const flow = p.sequence.flow;
  if (!flow) return p.sequence.steps.map((_, i) => i);
  const order: number[] = [];
  for (const n of flow) {
    if (n.kind !== 'step') return null;
    const i = p.sequence.steps.findIndex((s) => s.id === n.stepId);
    if (i < 0) return null;
    order.push(i);
  }
  return order;
}

/** Depth-first step ids, each node once (loops are not unrolled). */
export function collectStepIds(nodes: FlowNode[]): string[] {
  const out: string[] = [];
  walk(nodes, (n) => { if (n.kind === 'step') out.push(n.stepId); });
  return out;
}

export function walk(nodes: FlowNode[], fn: (n: FlowNode, list: FlowNode[], index: number) => void): void {
  const rec = (list: FlowNode[]) => {
    list.forEach((n, i) => {
      fn(n, list, i);
      if (n.kind === 'branch') { rec(n.then); rec(n.else); }
      else if (n.kind === 'parallel') n.lanes.forEach(rec);
      else if (n.kind === 'loop' || n.kind === 'retry') rec(n.body);
    });
  };
  rec(nodes);
}

export function blockId(n: FlowNode): string | null {
  return n.kind === 'step' ? null : n.id;
}

export interface NodeHit { list: FlowNode[]; index: number; node: FlowNode }

export function findNode(nodes: FlowNode[], pred: (n: FlowNode) => boolean): NodeHit | null {
  let hit: NodeHit | null = null;
  walk(nodes, (n, list, index) => { if (!hit && pred(n)) hit = { list, index, node: n }; });
  return hit;
}

export function findById(nodes: FlowNode[], id: string): NodeHit | null {
  return findNode(nodes, (n) => n.kind === 'step' ? n.stepId === id : n.id === id);
}

/** The block whose child list is `list`, plus that block's own sibling list. */
export function findOwner(nodes: FlowNode[], list: FlowNode[]): NodeHit | null {
  let hit: NodeHit | null = null;
  walk(nodes, (n, owner, index) => {
    if (hit) return;
    const lists: FlowNode[][] = [];
    if (n.kind === 'branch') lists.push(n.then, n.else);
    else if (n.kind === 'parallel') lists.push(...n.lanes);
    else if (n.kind === 'loop' || n.kind === 'retry') lists.push(n.body);
    if (lists.includes(list)) hit = { list: owner, index, node: n };
  });
  return hit;
}

export function listInsideParallel(nodes: FlowNode[], list: FlowNode[]): boolean {
  let inside = false;
  const rec = (cur: FlowNode[], par: boolean) => {
    if (cur === list && par) inside = true;
    for (const n of cur) {
      if (n.kind === 'branch') { rec(n.then, par); rec(n.else, par); }
      else if (n.kind === 'parallel') n.lanes.forEach((lane) => rec(lane, true));
      else if (n.kind === 'loop' || n.kind === 'retry') rec(n.body, par);
    }
  };
  rec(nodes, false);
  return inside;
}

export function containsParallelOrSubstation(n: FlowNode): boolean {
  if (n.kind === 'parallel' || n.kind === 'substation') return true;
  if (n.kind === 'branch') return [...n.then, ...n.else].some(containsParallelOrSubstation);
  if (n.kind === 'loop' || n.kind === 'retry') return n.body.some(containsParallelOrSubstation);
  return false;
}

/** True when `id` is a block that contains `list` (moving into itself). */
export function containsList(node: FlowNode, list: FlowNode[]): boolean {
  if (node.kind === 'branch') return node.then === list || node.else === list || node.then.some((n) => containsList(n, list)) || node.else.some((n) => containsList(n, list));
  if (node.kind === 'parallel') return node.lanes.some((lane) => lane === list || lane.some((n) => containsList(n, list)));
  if (node.kind === 'loop' || node.kind === 'retry') return node.body === list || node.body.some((n) => containsList(n, list));
  return false;
}

export function cloneFlow(nodes: FlowNode[]): FlowNode[] {
  return structuredClone(nodes);
}

/** Drop step nodes and substation nodes that no longer exist. Fix conditions with `fixCond`. */
export function scrubFlow(nodes: FlowNode[], removedSteps: Set<string>, removedUnits: Set<string>, fixCond: (c: Condition) => Condition): FlowNode[] {
  const rec = (list: FlowNode[]): FlowNode[] => {
    const out: FlowNode[] = [];
    for (const n of list) {
      if (n.kind === 'step') { if (!removedSteps.has(n.stepId)) out.push(n); continue; }
      if (n.kind === 'substation') { if (!removedUnits.has(n.unitId)) out.push({ ...n }); continue; }
      if (n.kind === 'branch') out.push({ ...n, cond: fixCond(n.cond), then: rec(n.then), else: rec(n.else) });
      else if (n.kind === 'parallel') out.push({ ...n, lanes: n.lanes.map(rec) });
      else if (n.kind === 'loop') out.push({ ...n, body: rec(n.body) });
      else out.push({ ...n, until: fixCond(n.until), body: rec(n.body) });
    }
    return out;
  };
  return rec(nodes);
}

export function nodeKey(n: FlowNode): string {
  return n.kind === 'step' ? n.stepId : n.id;
}

/** First sibling run whose keys equal `ids` in order. */
export function findConsecutive(nodes: FlowNode[], ids: string[]): { list: FlowNode[]; index: number } | null {
  if (ids.length === 0) return null;
  let hit: { list: FlowNode[]; index: number } | null = null;
  walk(nodes, (_n, list, index) => {
    if (hit || index + ids.length > list.length) return;
    if (ids.every((id, k) => nodeKey(list[index + k]) === id)) hit = { list, index };
  });
  return hit;
}

/**
 * Parallel wrap. One node stays in lane 1 and lane 2 stays empty.
 * Two to four nodes get one lane each, top to bottom.
 * Five or more: the first three nodes each get a lane, and the rest stay in lane 4, in order.
 */
export function parallelWrapLanes(inner: FlowNode[]): FlowNode[][] {
  if (inner.length <= 1) return [inner, []];
  if (inner.length <= 4) return inner.map((n) => [n]);
  return [[inner[0]], [inner[1]], [inner[2]], inner.slice(3)];
}

function putInner(block: FlowNode, inner: FlowNode[]): FlowNode {
  if (block.kind === 'branch') return { ...block, then: inner };
  if (block.kind === 'parallel') return { ...block, lanes: parallelWrapLanes(inner) };
  if (block.kind === 'loop' || block.kind === 'retry') return { ...block, body: inner };
  return block;
}

/**
 * Replace a consecutive sibling run (steps, blocks, or substation steps) with one block.
 * The matched nodes, including anything inside a block, become the block body.
 * Returns null if they are not consecutive siblings.
 */
export function wrapStepNodes(nodes: FlowNode[], ids: string[], block: FlowNode): FlowNode[] | null {
  if (ids.length === 0 || block.kind === 'step' || block.kind === 'substation') return null;
  let placed = false;
  const rec = (list: FlowNode[]): FlowNode[] => {
    if (placed) return list;
    for (let i = 0; i + ids.length <= list.length; i++) {
      const slice = list.slice(i, i + ids.length);
      if (slice.every((n, k) => nodeKey(n) === ids[k])) {
        placed = true;
        return [...list.slice(0, i), putInner(block, slice), ...list.slice(i + ids.length)];
      }
    }
    return list.map((n) => {
      if (placed || n.kind === 'step' || n.kind === 'substation') return n;
      if (n.kind === 'branch') return { ...n, then: rec(n.then), else: rec(n.else) };
      if (n.kind === 'parallel') return { ...n, lanes: n.lanes.map(rec) };
      return { ...n, body: rec(n.body) };
    });
  };
  const next = rec(nodes);
  return placed ? next : null;
}

export function unwrapBlock(nodes: FlowNode[], blockId: string): FlowNode[] | null {
  let placed = false;
  const flat = (n: FlowNode): FlowNode[] => {
    if (n.kind === 'branch') return [...n.then, ...n.else];
    if (n.kind === 'parallel') return n.lanes.flat();
    if (n.kind === 'loop' || n.kind === 'retry') return [...n.body];
    return [];
  };
  const rec = (list: FlowNode[]): FlowNode[] => list.flatMap((n) => {
    if (n.kind !== 'step' && n.id === blockId) { placed = true; return flat(n); }
    if (n.kind === 'branch') return [{ ...n, then: rec(n.then), else: rec(n.else) }];
    if (n.kind === 'parallel') return [{ ...n, lanes: n.lanes.map(rec) }];
    if (n.kind === 'loop' || n.kind === 'retry') return [{ ...n, body: rec(n.body) }];
    return [n];
  });
  const next = rec(nodes);
  return placed ? next : null;
}

/** Move a node by delta inside its sibling list. */
export function moveNodeBy(nodes: FlowNode[], id: string, delta: number): FlowNode[] | null {
  const hit = findById(nodes, id);
  if (!hit) return null;
  const to = hit.index + delta;
  if (to < 0 || to >= hit.list.length) return null;
  const list = hit.list;
  const [n] = list.splice(hit.index, 1);
  list.splice(to, 0, n);
  return nodes;
}

export function moveNodeTo(nodes: FlowNode[], id: string, target: FlowNode[], index: number): FlowNode[] | null {
  const hit = findById(nodes, id);
  if (!hit) return null;
  if (hit.node.kind !== 'step' && containsList(hit.node, target)) return null;
  if (hit.list === target) {
    const from = hit.index;
    const to = Math.max(0, Math.min(index > from ? index - 1 : index, target.length - 1));
    if (to === from) return nodes;
    const [n] = target.splice(from, 1);
    target.splice(to, 0, n);
    return nodes;
  }
  const [n] = hit.list.splice(hit.index, 1);
  target.splice(Math.max(0, Math.min(index, target.length)), 0, n);
  return nodes;
}

const insideParallel = (nodes: FlowNode[], pred: (n: FlowNode) => boolean): boolean => {
  let bad = false;
  const rec = (list: FlowNode[], par: boolean) => {
    for (const n of list) {
      if (par && pred(n)) bad = true;
      if (n.kind === 'branch') { rec(n.then, par); rec(n.else, par); }
      else if (n.kind === 'parallel') n.lanes.forEach((lane) => rec(lane, true));
      else if (n.kind === 'loop' || n.kind === 'retry') rec(n.body, par);
    }
  };
  rec(nodes, false);
  return bad;
};

function pushDiag(out: Diagnostic[], code: string, objectId: string, message: string) {
  out.push({ id: `${code}:${objectId}:${out.length}`, severity: 'error', code, objectId, message });
}

/** Reference integrity of `flow`. These reject a file on open. Empty arms and run conflicts are not included. */
export function flowIntegrity(p: Project): Diagnostic[] {
  const flow = p.sequence.flow;
  if (!flow) return [];
  const out: Diagnostic[] = [];
  const err = (code: string, objectId: string, message: string) => pushDiag(out, code, objectId, message);
  const stepIds = new Set(p.sequence.steps.map((s) => s.id));
  const seenStep = new Set<string>();
  const seenBlock = new Set<string>();
  const cond = (c: Condition, owner: string, label: string) => {
    if (c.kind === 'signal' && !p.signals.some((s) => s.id === c.signalId)) err('REF_MISSING_SIGNAL', owner, `${label}: 없는 Signal ${c.signalId}`);
    if (c.kind === 'materialAt' && !p.units.some((u) => u.id === c.unitId)) err('REF_MISSING_UNIT', owner, `${label}: 없는 Unit ${c.unitId}`);
    if (c.kind === 'materialHeldBy' && c.deviceId && !p.devices.some((d) => d.id === c.deviceId)) err('REF_MISSING_DEVICE', owner, `${label}: 없는 Device ${c.deviceId}`);
  };
  walk(flow, (n) => {
    if (n.kind === 'step') {
      if (!stepIds.has(n.stepId)) err('REF_MISSING_STEP', n.stepId, `흐름이 없는 단계 ${n.stepId} 를 가리킴`);
      if (seenStep.has(n.stepId)) err('DUP_STEP_IN_FLOW', n.stepId, `단계 ${n.stepId} 가 흐름에 두 번 있음`);
      seenStep.add(n.stepId);
      return;
    }
    if (!n.id) err('ID_INVALID', n.kind, '흐름 블록 ID 없음');
    else if (seenBlock.has(n.id)) err('ID_DUPLICATE', n.id, `흐름 블록 ID 중복: ${n.id}`);
    else seenBlock.add(n.id);
    if (n.kind === 'branch') cond(n.cond, n.id, `분기 ${n.name}`);
    if (n.kind === 'retry') cond(n.until, n.id, `재시도 ${n.name}`);
    if (n.kind === 'substation' && !p.units.some((u) => u.id === n.unitId)) err('REF_MISSING_UNIT', n.id, `Substation 단계 ${n.id}: Unit ${n.unitId} 없음`);
  });
  return out;
}

/** Run blockers that are still legal to save: empty lanes, ranges, nesting, undefined conditions. */
export function flowShapeBlockers(p: Project): Diagnostic[] {
  const flow = p.sequence.flow;
  if (!flow) return [];
  const out: Diagnostic[] = [];
  const err = (code: string, objectId: string, message: string) => pushDiag(out, code, objectId, message);
  const cond = (c: Condition, owner: string, label: string) => {
    if (c.kind === 'undefined') err('CONDITION_UNDEFINED', owner, `${label}: 미정 조건 "${c.note}" — 임의 true 처리 안 함`);
  };
  walk(flow, (n) => {
    if (n.kind === 'branch') cond(n.cond, n.id, `분기 ${n.name}`);
    if (n.kind === 'retry') {
      cond(n.until, n.id, `재시도 ${n.name}`);
      if (!Number.isInteger(n.maxRetries) || n.maxRetries < 0 || n.maxRetries > DEFAULT_MAX_RETRIES) err('RETRY_RANGE', n.id, `재시도 ${n.name}: 추가 횟수는 0~${DEFAULT_MAX_RETRIES}`);
      if (n.body.length === 0) err('EMPTY_BLOCK', n.id, `재시도 ${n.name}: 본문이 비어 있음`);
    }
    if (n.kind === 'loop') {
      if (!Number.isInteger(n.count) || n.count < 1 || n.count > 10) err('LOOP_RANGE', n.id, `반복 ${n.name}: 횟수는 1~10`);
      if (n.body.length === 0) err('EMPTY_BLOCK', n.id, `반복 ${n.name}: 본문이 비어 있음`);
    }
    if (n.kind === 'parallel') {
      if (n.lanes.length < 2 || n.lanes.length > 4) err('LANE_RANGE', n.id, `병렬 ${n.name}: 갈래는 2~4개 (현재 ${n.lanes.length})`);
      n.lanes.forEach((lane, i) => { if (lane.length === 0) err('EMPTY_LANE', n.id, `병렬 ${n.name}: 갈래 ${i + 1} 이 비어 있음`); });
    }
  });
  if (insideParallel(flow, (n) => n.kind === 'parallel' || n.kind === 'substation')) {
    err('FLOW_NESTING', p.sequence.id, '병렬 갈래 안에 병렬 또는 Substation 단계는 두지 않습니다');
  }
  return out;
}

/** A branch or retry condition reads this signal. Used to keep a failed read going. */
export function flowUsesSignal(nodes: FlowNode[], signalId: string): boolean {
  let used = false;
  const see = (c: Condition) => { if (c.kind === 'signal' && c.signalId === signalId) used = true; };
  walk(nodes, (n) => {
    if (n.kind === 'branch') see(n.cond);
    if (n.kind === 'retry') see(n.until);
  });
  return used;
}

export interface LaneWork { name: string; steps: SequenceStep[] }

/** Direct step children of one parallel lane (nested loop/branch/retry bodies included, nested parallel is rejected earlier). */
export function laneSteps(p: Project, nodes: FlowNode[]): SequenceStep[] {
  const ids = collectStepIds(nodes);
  return ids.map((id) => p.sequence.steps.find((s) => s.id === id)).filter((s): s is SequenceStep => !!s);
}

/**
 * Assumed cycle seconds for Gap. Parallel = longest lane, loop = count × body,
 * branch = longer arm, retry = one body run, substation = longest sequence.
 * Unknown durations count as 0 (the caller also flags them).
 */
export function assumedCycleSeconds(p: Project, nodes: FlowNode[]): number {
  const stepDur = (id: string) => {
    const s = p.sequence.steps.find((x) => x.id === id);
    const a = s && p.actions.find((x) => x.id === s.actionId);
    return a?.duration.value ?? 0;
  };
  const rec = (list: FlowNode[]): number => {
    let t = 0;
    for (const n of list) {
      if (n.kind === 'step') t += stepDur(n.stepId);
      else if (n.kind === 'branch') t += Math.max(rec(n.then), rec(n.else));
      else if (n.kind === 'parallel') t += n.lanes.reduce((m, lane) => Math.max(m, rec(lane)), 0);
      else if (n.kind === 'loop') t += n.count * rec(n.body);
      else if (n.kind === 'retry') t += rec(n.body);
      else t += substationSeconds(p, n.unitId);
    }
    return t;
  };
  return rec(nodes);
}

export function substationSeconds(p: Project, unitId: string): number {
  const seqs = (p.substationSequences ?? []).filter((q) => q.unitId === unitId);
  let max = 0;
  for (const q of seqs) {
    let t = 0;
    for (const s of q.steps) {
      const a = p.actions.find((x) => x.id === s.actionId);
      t += a?.duration.value ?? 0;
    }
    if (t > max) max = t;
  }
  return max;
}

/** Per-unit assumed seconds using the same rules, for the Gap "longest unit" line. */
export function assumedSecondsByUnit(p: Project, nodes: FlowNode[]): Map<string, number> {
  const per = new Map<string, number>();
  const add = (unitId: string, sec: number) => per.set(unitId, (per.get(unitId) ?? 0) + sec);
  const stepUnit = (id: string): { unitId: string; sec: number } | null => {
    const s = p.sequence.steps.find((x) => x.id === id);
    const a = s && p.actions.find((x) => x.id === s.actionId);
    if (!a) return null;
    return { unitId: a.unitId, sec: a.duration.value ?? 0 };
  };
  const rec = (list: FlowNode[]) => {
    for (const n of list) {
      if (n.kind === 'step') { const u = stepUnit(n.stepId); if (u) add(u.unitId, u.sec); }
      else if (n.kind === 'branch') {
        const a = unitMap(p, n.then), b = unitMap(p, n.else);
        const keys = new Set([...a.keys(), ...b.keys()]);
        for (const k of keys) add(k, Math.max(a.get(k) ?? 0, b.get(k) ?? 0));
      } else if (n.kind === 'parallel') {
        const maps = n.lanes.map((lane) => unitMap(p, lane));
        const keys = new Set(maps.flatMap((m) => [...m.keys()]));
        for (const k of keys) add(k, Math.max(...maps.map((m) => m.get(k) ?? 0)));
      } else if (n.kind === 'loop') {
        for (const [k, v] of unitMap(p, n.body)) add(k, v * n.count);
      } else if (n.kind === 'retry') {
        for (const [k, v] of unitMap(p, n.body)) add(k, v);
      } else add(n.unitId, substationSeconds(p, n.unitId));
    }
  };
  rec(nodes);
  return per;
}

function unitMap(p: Project, nodes: FlowNode[]): Map<string, number> {
  return assumedSecondsByUnit(p, nodes);
}
