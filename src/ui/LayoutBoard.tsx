// S20 concept board. Units and devices are the live model (select, drop, reparent, flow click).
// Pixel-accurate port wiring stays on the diagram below; this board does not invent a second layout.
import { findAsset } from '../assets/library';
import type { AssetKind, Project } from '../model/types';
import type { Mode } from './Canvas';

interface Props {
  project: Project;
  selection: string[];
  mode: Mode;
  locked: boolean;
  onSelect: (ids: string[]) => void;
  onDropAsset: (kind: AssetKind | 'unit', at: { x: number; y: number }) => void;
  onUnitConnectClick: (unitId: string) => void;
  onReparent: (deviceId: string, unitId: string) => void;
}

const kindLabel = (kind: string) => findAsset(kind)?.name ?? kind;

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
  const take = (e: React.DragEvent) => {
    const kind = e.dataTransfer.getData('application/x-ecd-asset') as AssetKind | 'unit' | '';
    const deviceId = e.dataTransfer.getData('application/x-ecd-device');
    return { kind, deviceId };
  };
  return <div className="board" data-board="live">
    <div className="board-row" onDragOver={(e) => e.preventDefault()} onDrop={(e) => {
      const { kind } = take(e);
      if (kind === 'unit' || (kind && findAsset(kind)?.template)) props.onDropAsset(kind, { x: 40 + units.length * 240, y: 90 });
    }}>
      {units.map((u) => <article key={u.id} className={`station-card ${selection.includes(u.id) ? 'on' : ''}`}
        onClick={() => { if (mode === 'flow' || mode === 'signal') props.onUnitConnectClick(u.id); else props.onSelect([u.id]); }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.stopPropagation();
          const { kind, deviceId } = take(e);
          if (deviceId && deviceId !== u.id) { props.onReparent(deviceId, u.id); return; }
          if (kind && kind !== 'unit' && !findAsset(kind)?.template) props.onDropAsset(kind, { x: u.layout.x + 48, y: u.layout.y + 90 });
        }}>
        <h3>{u.code} {u.name.replace(new RegExp(`^${u.code}\\s*`), '')}</h3>
        {u.deviceIds.map((id) => {
          const d = p.devices.find((x) => x.id === id);
          if (!d) return null;
          const on = selection.includes(d.id);
          return <button key={id} type="button" className={`chip ${on ? 'on' : ''}`} draggable={!props.locked}
            onClick={(e) => { e.stopPropagation(); props.onSelect([d.id]); }}
            onDragStart={(e) => { e.dataTransfer.setData('application/x-ecd-device', d.id); e.dataTransfer.effectAllowed = 'move'; }}>
            {d.name} · {kindLabel(d.kind)}
          </button>;
        })}
      </article>)}
      {units.length === 0 && <p className="muted">배치된 Substation이 없습니다. 팔레트에서 빈 유닛이나 유닛 템플릿을 놓으세요.</p>}
    </div>
  </div>;
}
