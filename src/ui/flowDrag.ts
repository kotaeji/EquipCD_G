// TURN-073. One drag uses the same flow tree and the same refusal sentences as moveFlow*.
import type { CmdResult } from '../model/commands';
import {
  armLists, containsList, containsParallel, findById, listInsideParallel, nodeKey, walk,
} from '../model/flow';
import type { FlowNode, Project } from '../model/types';

export const ROOT_LIST = 'root';

export function listKeyFor(blockId: string, arm: 'then' | 'else' | 'body' | number): string {
  return typeof arm === 'number' ? `${blockId}::lane::${arm}` : `${blockId}::${arm}`;
}

/** One branch arm, including the arms between 「참」 and 「그 밖」. */
export function branchListKey(blockId: string, index: number): string {
  return `${blockId}::barm::${index}`;
}

export function listOf(flow: FlowNode[], key: string): FlowNode[] | null {
  if (key === ROOT_LIST) return flow;
  const lane = /^(.*)::lane::(\d+)$/.exec(key);
  const barm = lane ? null : /^(.*)::barm::(\d+)$/.exec(key);
  const arm = lane || barm ? null : /^(.*)::(then|else|body)$/.exec(key);
  const id = lane?.[1] ?? barm?.[1] ?? arm?.[1];
  if (!id) return null;
  const hit = findById(flow, id);
  if (!hit) return null;
  const n = hit.node;
  if (lane && n.kind === 'parallel') return n.lanes[Number(lane[2])] ?? null;
  if (barm && n.kind === 'branch') return armLists(n)[Number(barm[2])] ?? null;
  if (arm?.[2] === 'then' && n.kind === 'branch') return armLists(n)[0] ?? null;
  if (arm?.[2] === 'else' && n.kind === 'branch') { const lists = armLists(n); return lists[lists.length - 1] ?? null; }
  if (arm?.[2] === 'body' && (n.kind === 'loop' || n.kind === 'retry')) return n.body;
  return null;
}

function blockIdOfList(key: string): string | null {
  const lane = /^(.*)::(?:lane|barm)::\d+$/.exec(key);
  if (lane) return lane[1];
  const arm = /^(.*)::(then|else|body)$/.exec(key);
  return arm ? arm[1] : null;
}

function childKeys(n: FlowNode): string[] {
  if (n.kind === 'branch') return armLists(n).map((_, i) => branchListKey(n.id, i));
  if (n.kind === 'parallel') return n.lanes.map((_, i) => listKeyFor(n.id, i));
  if (n.kind === 'loop' || n.kind === 'retry') return [listKeyFor(n.id, 'body')];
  return [];
}

function childListsOf(node: FlowNode): FlowNode[][] {
  if (node.kind === 'branch') return armLists(node);
  if (node.kind === 'parallel') return node.lanes;
  if (node.kind === 'loop' || node.kind === 'retry') return [node.body];
  return [];
}

function nodeHas(node: FlowNode, id: string): boolean {
  return childListsOf(node).some((list) => list.some((n) => nodeKey(n) === id || nodeHas(n, id)));
}

/** Checked rows move together only when they are one contiguous sibling run. A block carries its body. */
export function dragIds(flow: FlowNode[], picked: string[], dragId: string): { ids: string[] } | { reason: string } {
  if (!findById(flow, dragId)) return { reason: '노드 없음' };
  if (!picked.includes(dragId)) return { ids: [dragId] };
  const known = picked.filter((id) => findById(flow, id));
  const tops = known.filter((id) => !known.some((other) => {
    if (other === id) return false;
    const parent = findById(flow, other);
    return !!parent && parent.node.kind !== 'step' && nodeHas(parent.node, id);
  }));
  if (!tops.includes(dragId) || tops.length === 1) return { ids: [dragId] };
  const hit = findById(flow, dragId)!;
  const order = hit.list.map(nodeKey);
  const chosen = order.filter((id) => tops.includes(id));
  if (chosen.length !== tops.length) return { reason: '같은 갈래에서 연속된 단계만 묶을 수 있습니다' };
  const start = order.indexOf(chosen[0]);
  const last = order.indexOf(chosen[chosen.length - 1]);
  if (last - start + 1 !== chosen.length) return { reason: '같은 갈래에서 연속된 단계만 묶을 수 있습니다' };
  return { ids: chosen };
}

/** Index after the moved slice is removed. `null` means the drop is the same place. */
export function placeIndex(start: number, count: number, fromLength: number, targetLength: number, index: number, same: boolean): number | null {
  if (same) {
    const at = Math.max(0, Math.min(index > start ? index - count : index, fromLength - count));
    return at === start ? null : at;
  }
  return Math.max(0, Math.min(index, targetLength));
}

export function judgeDrop(flow: FlowNode[] | undefined, ids: string[], listKey: string, index: number): { valid: boolean; noop: boolean; reason?: string } {
  if (!flow) return { valid: false, noop: false, reason: '흐름 없음' };
  if (ids.length === 0) return { valid: false, noop: false, reason: '노드 없음' };
  const target = listOf(flow, listKey);
  if (!target) return { valid: false, noop: false, reason: '갈래 없음' };
  const first = findById(flow, ids[0]);
  if (!first) return { valid: false, noop: false, reason: '노드 없음' };
  for (let i = 0; i < ids.length; i++) {
    const n = first.list[first.index + i];
    if (!n || nodeKey(n) !== ids[i]) return { valid: false, noop: false, reason: '같은 갈래에서 연속된 단계만 묶을 수 있습니다' };
  }
  for (const id of ids) {
    const moving = findById(flow, id)!;
    if (moving.node.kind !== 'step' && containsList(moving.node, target)) return { valid: false, noop: false, reason: '블록을 자기 자신 안에 넣을 수 없습니다' };
    if (listInsideParallel(flow, target) && containsParallel(moving.node)) return { valid: false, noop: false, reason: '병렬 갈래 안에는 병렬을 넣지 않습니다' };
  }
  const at = placeIndex(first.index, ids.length, first.list.length, target.length, index, first.list === target);
  if (at === null) return { valid: true, noop: true };
  return { valid: true, noop: false };
}

function flowOfProject(p: Project, seqId?: string) {
  if (!seqId) return p.sequence.flow;
  return (p.substationSequences ?? []).find((q) => q.id === seqId)?.flow;
}

/** One relocation. `null` means the drop does not change the tree, so the caller must not edit. */
export function relocateFlow(p0: Project, ids: string[], listKey: string, index: number, seqId?: string): CmdResult | null {
  const verdict = judgeDrop(flowOfProject(p0, seqId), ids, listKey, index);
  if (!verdict.valid) return { ok: false, reason: verdict.reason ?? '이동 불가' };
  if (verdict.noop) return null;
  const p = structuredClone(p0);
  const owned = seqId ? (p.substationSequences ?? []).find((q) => q.id === seqId) : null;
  if (seqId && !owned?.flow) return { ok: false, reason: '흐름 없음' };
  const flow = seqId ? owned!.flow! : p.sequence.flow!;
  const target = listOf(flow, listKey)!;
  const first = findById(flow, ids[0])!;
  const at = placeIndex(first.index, ids.length, first.list.length, target.length, index, first.list === target);
  if (at === null) return null;
  const chunk = first.list.splice(first.index, ids.length);
  (first.list === target ? first.list : target).splice(at, 0, ...chunk);
  p.revision += 1;
  return { ok: true, project: p };
}

export interface MeasuredRow {
  kind: string;
  id: string | null;
  listKey: string;
  index: number;
  depth: number;
  top: number;
  bottom: number;
  left: number;
  width: number;
}

export interface DropSlot {
  listKey: string;
  index: number;
  y: number;
  left: number;
  width: number;
  /** Visual indent. Slots that share a y are chosen by how far right the pointer is. */
  depth: number;
  valid: boolean;
  noop: boolean;
  reason?: string;
}

export function readMeasuredRow(tr: HTMLTableRowElement): MeasuredRow {
  const box = tr.getBoundingClientRect();
  return {
    kind: tr.dataset.flowKind ?? '',
    id: tr.dataset.nodeId || null,
    listKey: tr.dataset.listKey ?? '',
    index: Number(tr.dataset.flowIndex ?? '-1'),
    depth: Number(tr.dataset.depth ?? '0'),
    top: box.top,
    bottom: box.bottom,
    left: box.left,
    width: box.width,
  };
}

function subtreeBottom(rows: MeasuredRow[], index: number): number {
  const depth = rows[index].depth;
  let bottom = rows[index].bottom;
  for (let j = index + 1; j < rows.length && rows[j].depth > depth; j++) bottom = Math.max(bottom, rows[j].bottom);
  return bottom;
}

function anchorFor(rows: MeasuredRow[], listKey: string): { y: number; left: number; width: number } | null {
  const arm = rows.find((r) => r.kind === 'arm' && r.listKey === listKey);
  if (arm) return { y: arm.bottom, left: arm.left, width: arm.width };
  const id = blockIdOfList(listKey);
  const header = id ? rows.find((r) => r.id === id) : undefined;
  if (header) return { y: header.bottom, left: header.left, width: header.width };
  return null;
}

/** Every gap a drag can aim at. Invalid gaps stay in the list so a drop there can show its reason. */
export function dropSlots(rows: MeasuredRow[], flow: FlowNode[], ids: string[]): DropSlot[] {
  const lists = new Map<string, MeasuredRow[]>();
  for (const row of rows) {
    if (!row.id || row.index < 0) continue;
    const arr = lists.get(row.listKey) ?? [];
    arr.push(row);
    lists.set(row.listKey, arr);
  }
  walk(flow, (n) => {
    for (const key of childKeys(n)) if (!lists.has(key)) lists.set(key, []);
  });
  if (!lists.has(ROOT_LIST)) lists.set(ROOT_LIST, []);
  const slots: DropSlot[] = [];
  for (const [listKey, kids] of lists) {
    const sorted = [...kids].sort((a, b) => a.index - b.index);
    const points: { index: number; y: number; left: number; width: number; depth: number }[] = [];
    if (sorted.length === 0) {
      const anchor = anchorFor(rows, listKey);
      if (!anchor) continue;
      const arm = rows.find((r) => r.kind === 'arm' && r.listKey === listKey);
      const header = rows.find((r) => r.id === blockIdOfList(listKey));
      points.push({ index: 0, ...anchor, depth: ((arm ?? header)?.depth ?? 0) + 1 });
    } else {
      for (const kid of sorted) points.push({ index: kid.index, y: kid.top, left: kid.left, width: kid.width, depth: kid.depth });
      const last = sorted[sorted.length - 1];
      const i = rows.indexOf(last);
      points.push({ index: sorted.length, y: i >= 0 ? subtreeBottom(rows, i) : last.bottom, left: last.left, width: last.width, depth: last.depth });
    }
    for (const pt of points) {
      const verdict = judgeDrop(flow, ids, listKey, pt.index);
      slots.push({ listKey, ...pt, valid: verdict.valid, noop: verdict.noop, reason: verdict.reason });
    }
  }
  return slots;
}

function slotScore(s: DropSlot): number {
  return s.valid && !s.noop ? 2 : s.valid ? 1 : 0;
}

/**
 * Closest gap to the pointer. Gaps on the same line belong to different lists;
 * a pointer further right picks the deeper list, and one at the left picks the outer list.
 */
export function nearestSlot(slots: DropSlot[], x: number, y: number, spanTop: number, spanBottom: number): DropSlot | null {
  if (!slots.length || y < spanTop - 24 || y > spanBottom + 24) return null;
  let bestD = Infinity;
  for (const s of slots) bestD = Math.min(bestD, Math.abs(s.y - y));
  const band = slots.filter((s) => Math.abs(s.y - y) <= bestD + 0.5);
  const eligible = band.filter((s) => s.depth * 16 <= x + 12);
  const pool = eligible.length ? eligible : band;
  let best = pool[0];
  for (const s of pool.slice(1)) {
    if (s.depth > best.depth || (s.depth === best.depth && slotScore(s) > slotScore(best))) best = s;
  }
  return best;
}

/** Scroll step while the pointer sits in the top or bottom band of a long table. */
export function edgeScrollDelta(clientY: number, top: number, bottom: number): number {
  const band = 28;
  const step = 16;
  if (clientY < top + band) return -step;
  if (clientY > bottom - band) return step;
  return 0;
}

export function scrollParent(el: HTMLElement | null): HTMLElement | null {
  let n = el?.parentElement ?? null;
  while (n) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && n.scrollHeight > n.clientHeight + 1) return n;
    n = n.parentElement;
  }
  return null;
}
