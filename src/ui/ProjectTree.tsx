/**
 * TURN-002 — Station › Substation › Device tree with fold/unfold.
 * Fold state is user view only (UserView.treeCollapsed per project): it never changes the model, selection,
 * history, revision, export or the group-run target. Folding never selects; selecting never unfolds.
 */
import { useRef } from 'react';
import { findAsset } from '../assets/library';
import type { Project } from '../model/types';
import { devName } from './labels';

export interface ProjectTreeProps {
  p: Project;
  selection: string[];
  collapsed: string[];
  onCollapsedChange: (ids: string[]) => void;
  onPick: (id: string) => void;
  subCount: (unitId: string) => number;
}

/** "모두 접기" = Station and every Substation (with devices) folded; unfolding the Station then shows folded Substations. */
export const collapseAllIds = (p: Project) => [...(p.units.length ? [p.equipment.id] : []), ...p.units.filter((u) => u.deviceIds.length > 0).map((u) => u.id)];

export function ProjectTree({ p, selection, collapsed, onCollapsedChange, onPick, subCount }: ProjectTreeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isCol = (id: string) => collapsed.includes(id);
  const setCol = (id: string, fold: boolean) => {
    if (fold === isCol(id)) return;
    onCollapsedChange(fold ? [...collapsed, id] : collapsed.filter((x) => x !== id));
  };
  const stationId = p.equipment.id;
  const stationOpen = !isCol(stationId);
  const stationHasKids = p.units.length > 0;

  const focusMove = (from: HTMLElement, delta: number) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role=treeitem]') ?? []);
    const i = items.indexOf(from); const next = items[i + delta]; if (next) next.focus();
  };
  const focusId = (id: string) => Array.from(ref.current?.querySelectorAll<HTMLElement>('[role=treeitem]') ?? []).find((x) => x.dataset.treeId === id)?.focus();

  /** shared keys: ↑/↓ move, → unfold, ← fold (or go to parent), Enter/Space = select (or toggle for Station) */
  const onKey = (e: React.KeyboardEvent<HTMLElement>, id: string, opts: { expandable: boolean; open: boolean; parent?: string; select?: () => void }) => {
    if (e.target !== e.currentTarget) return; // nested treeitems: only the focused item handles its keys
    const k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); focusMove(e.currentTarget, k === 'ArrowDown' ? 1 : -1); return; }
    if (k === 'ArrowRight') { e.preventDefault(); if (opts.expandable && !opts.open) setCol(id, false); return; }
    if (k === 'ArrowLeft') { e.preventDefault(); if (opts.expandable && opts.open) setCol(id, true); else if (opts.parent) focusId(opts.parent); return; }
    if (k === 'Enter' || k === ' ') { e.preventDefault(); if (opts.select) opts.select(); else if (opts.expandable) setCol(id, opts.open); }
  };
  const Twisty = ({ id, open, label }: { id: string; open: boolean; label: string }) => (
    <button type="button" className="twisty" tabIndex={-1} aria-label={`${label} ${open ? '접기' : '펼치기'}`} title={open ? '접기' : '펼치기'}
      onClick={(e) => { e.stopPropagation(); setCol(id, open); }}>{open ? '▾' : '▸'}</button>);
  const leafPad = <span className="twisty-pad" aria-hidden="true" />;
  const selMark = <span className="selmark" title="선택한 항목이 접힌 행 안에 있습니다">● 선택 포함</span>;
  const hasSel = selection.length > 0;
  /** nested treeitems: a click belongs to the closest treeitem only (parents ignore clicks bubbling from children) */
  const own = (e: React.MouseEvent<HTMLElement>, fn: () => void) => { if ((e.target as Element).closest('[role=treeitem]') === e.currentTarget) fn(); };

  // rev 4 (ARIA): each child role=group is INSIDE its parent treeitem (owned hierarchy), the visible row is a child div
  return <div className="tree" role="tree" aria-label="Station / Substation / Device" ref={ref}>
    <div className="titem" role="treeitem" tabIndex={0} data-tree-id={stationId} aria-level={1} aria-expanded={stationHasKids ? stationOpen : undefined}
      onKeyDown={(e) => onKey(e, stationId, { expandable: stationHasKids, open: stationOpen })}>
      <div className="tnode station">
        {stationHasKids ? <Twisty id={stationId} open={stationOpen} label={p.equipment.name} /> : leafPad}
        {p.equipment.name} <span className="kind">Station · Equipment</span>{!stationOpen && hasSel && selMark}</div>
      {stationOpen && stationHasKids && <div role="group">
        {p.units.map((u) => {
          const kids = u.deviceIds.length > 0; const open = !isCol(u.id); const sel = selection.includes(u.id);
          const hiddenSel = !open && u.deviceIds.some((d) => selection.includes(d));
          return <div key={u.id} role="treeitem" tabIndex={0} data-tree-id={u.id} aria-level={2} aria-selected={sel} aria-expanded={kids ? open : undefined}
            className="titem tunit" onClick={(e) => own(e, () => onPick(u.id))}
            onKeyDown={(e) => onKey(e, u.id, { expandable: kids, open, parent: stationId, select: () => onPick(u.id) })} title={`${u.name} — Substation(Unit) ${u.id}`}>
            <div className={`tnode ${sel ? 'sel' : ''}`} style={{ paddingLeft: 14 }}>
              {kids ? <Twisty id={u.id} open={open} label={u.name} /> : leafPad}
              {u.name}{u.templateRef ? ' ⧉' : ''} <span className="kind">Substation · 시퀀스 {subCount(u.id)}</span>{hiddenSel && selMark}</div>
            {kids && open && <div role="group">
              {u.deviceIds.map((d) => {
                const dsel = selection.includes(d);
                return <div key={d} role="treeitem" tabIndex={0} data-tree-id={d} aria-level={3} aria-selected={dsel} className={`tnode ${dsel ? 'sel' : ''}`}
                  style={{ paddingLeft: 44, fontSize: 12 }} onClick={(e) => own(e, () => onPick(d))}
                  onKeyDown={(e) => onKey(e, d, { expandable: false, open: false, parent: u.id, select: () => onPick(d) })}>
                  ○ {devName(p, d)} <span className="muted">{findAsset(p.devices.find((x) => x.id === d)?.kind ?? '')?.name ?? '정의 없음'}</span></div>;
              })}
            </div>}
          </div>;
        })}
      </div>}
    </div>
    {p.units.length === 0 && <div className="tempty">Substation이 없습니다. 1 라이브러리에서 유닛 템플릿을 추가하거나 2 배치에서 “빈 유닛”을 캔버스로 드래그하세요.</div>}
  </div>;
}
