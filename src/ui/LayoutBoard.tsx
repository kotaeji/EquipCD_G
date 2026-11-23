// S20 concept board. Units and devices are the live model (select, drop, reparent, flow click).
// Pixel-accurate port wiring stays on the diagram tab; this board does not invent a second layout.
import { findAsset } from '../assets/library';
import { isUserTemplateDrag } from '../model/userTemplates';
import { nextDeviceSlot } from '../model/unitLayout';
import type { AssetKind, Project } from '../model/types';
import type { Mode } from './Canvas';
import { EmptyState } from './EmptyState';
import { EMPTY, RUN_LOCK } from './problemCopy';
import { cardSelection } from './selectAll';
import { isTextField, type ContextRequest } from './contextMenuModel';

interface Props {
  project: Project;
  selection: string[];
  mode: Mode;
  locked: boolean;
  onSelect: (ids: string[]) => void;
  onDropAsset: (kind: AssetKind | 'unit', at: { x: number; y: number }, unitId?: string) => void;
  onUnitConnectClick: (unitId: string) => void;
  onSignalHint: () => void;
  onReparent: (deviceId: string, unitId: string) => void;
  /** Overlay. It does not take a row, so the cards stay put. */
  connectNote: string | null;
  onContextMenu?: (req: ContextRequest) => void;
  onFocusUnit?: () => void;
  onFocusDevice?: () => void;
  onStartFlow?: () => void;
}

const kindLabel = (kind: string) => findAsset(kind)?.name ?? kind;
const isUnitDrop = (kind: string) => kind === 'unit' || !!findAsset(kind)?.template || isUserTemplateDrag(kind);

export function flowSummary(p: Project): string {
  const flows = p.connections.filter((c) => c.kind === 'flow');
  if (!flows.length) return '물류 연결이 없습니다.';
  const label = (id: string) => {
    const u = p.units.find((x) => x.id === id);
    if (!u) return id;
    const rest = u.name.replace(new RegExp(`^${u.code}\\s*`), '');
    return rest ? `${u.code} ${rest}` : u.code;
  };
  return `물류 경로: ${flows.map((f) => `${label(f.from.nodeId)} → ${label(f.to.nodeId)}`).join(' · ')}`;
}

export function LayoutBoard(props: Props) {
  const { project: p, selection, mode } = props;
  const units = [...p.units].sort((a, b) => a.layout.x - b.layout.x || a.code.localeCompare(b.code));
  const flows = p.connections.filter((c) => c.kind === 'flow');
  const take = (e: React.DragEvent) => {
    const kind = e.dataTransfer.getData('application/x-ecd-asset') as AssetKind | 'unit' | '';
    const deviceId = e.dataTransfer.getData('application/x-ecd-device');
    return { kind, deviceId };
  };
  const ask = (e: React.MouseEvent<HTMLElement>, hit: ContextRequest['hit']) => {
    if (!props.onContextMenu || isTextField(e.target as Element)) return;
    e.preventDefault();
    e.stopPropagation();
    const focus = e.currentTarget;
    props.onContextMenu({ x: e.clientX, y: e.clientY, hit, surface: 'board', focus });
  };
  return <div className="board" tabIndex={-1} data-board="live" onContextMenu={(e) => { if ((e.target as Element).closest('.station-card')) return; ask(e, { kind: 'empty' }); }}>
    {props.connectNote && <p className="notice board-connect-note" style={{ position: 'absolute' }}>{props.connectNote}</p>}
    {units.length > 0 && flows.length === 0 && <EmptyState symbol="→" line={EMPTY.flows} actions={[{ label: '물류 연결', disabled: props.locked, reason: props.locked ? RUN_LOCK : undefined, onClick: props.onStartFlow }]} />}
    {units.length > 0 && p.devices.length === 0 && <EmptyState symbol="○" line={EMPTY.devices} actions={[{ label: '팔레트에서 고르기', disabled: props.locked, reason: props.locked ? RUN_LOCK : undefined, onClick: props.onFocusDevice }]} />}
    <div className="board-row" onDragOver={(e) => e.preventDefault()} onDrop={(e) => {
      const { kind } = take(e);
      if (isUnitDrop(kind)) props.onDropAsset(kind, { x: 40 + units.length * 240, y: 90 });
    }}>
      {units.map((u) => <article key={u.id} data-jump={`unit:${u.id}`} className={`station-card ${selection.includes(u.id) ? 'on' : ''}`}
        onContextMenu={(e) => ask(e, { kind: 'unit', id: u.id })}
        onClick={(e) => { if (mode === 'flow') props.onUnitConnectClick(u.id); else if (mode === 'signal') props.onSignalHint(); else props.onSelect(cardSelection(selection, u.id, e)); }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.stopPropagation();
          const { kind, deviceId } = take(e);
          if (deviceId && deviceId !== u.id) { props.onReparent(deviceId, u.id); return; }
          if (isUnitDrop(kind)) { props.onDropAsset(kind, { x: 40 + units.length * 240, y: 90 }); return; }
          if (kind && kind !== 'unit') props.onDropAsset(kind, nextDeviceSlot(p, u.id, kind), u.id);
        }}>
        <h3>{u.code} {u.name.replace(new RegExp(`^${u.code}\\s*`), '')}</h3>
        {u.deviceIds.map((id) => {
          const d = p.devices.find((x) => x.id === id);
          if (!d) return null;
          const on = selection.includes(d.id);
          return <button key={id} type="button" className={`chip ${on ? 'on' : ''}`} draggable={!props.locked}
            onContextMenu={(e) => ask(e, { kind: 'device', id: d.id })}
            onClick={(e) => { e.stopPropagation(); props.onSelect(cardSelection(selection, d.id, e)); }}
            onDragStart={(e) => { e.dataTransfer.setData('application/x-ecd-device', d.id); e.dataTransfer.effectAllowed = 'move'; }}>
            {d.name} · {kindLabel(d.kind)}
          </button>;
        })}
      </article>)}
      {units.length === 0 && <EmptyState symbol="○" line={EMPTY.units} actions={[{ label: '팔레트의 빈 유닛', disabled: props.locked, reason: props.locked ? RUN_LOCK : undefined, onClick: props.onFocusUnit }]} />}
    </div>
  </div>;
}
