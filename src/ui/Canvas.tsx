import { useRef, useState } from 'react';
import { findAsset } from '../assets/library';
import { resolvePhoto } from '../assets/visuals';
import type { AssetKind, Device, Project, Signal } from '../model/types';
import type { RuntimeState } from '../runtime/engine';
import { Symbol } from './Symbols';
import type { UserView } from './viewSettings';

export type Mode = 'select' | 'flow' | 'signal';

interface Props {
  project: Project;
  rt: RuntimeState | null;
  view: UserView;
  selection: string[];
  mode: Mode;
  connectFrom: string | null;
  locked: boolean;
  onSelect: (ids: string[], additive: boolean) => void;
  onMoveCommit: (ids: string[], dx: number, dy: number, pointer: { x: number; y: number }) => void;
  onDropAsset: (kind: AssetKind | 'unit', at: { x: number; y: number }) => void;
  onPortClick: (signalId: string) => void;
  onUnitConnectClick: (unitId: string) => void;
  onBlocked: (msg: string) => void;
}

const sigState = (rt: RuntimeState | null, p: Project, deviceId: string, port: string) => {
  if (!rt) return false;
  const s = p.signals.find((x) => x.deviceId === deviceId && x.portKey === port);
  return s ? !!rt.signals[s.id] : false;
};

export function portPos(d: Device, sigs: Signal[], s: Signal) {
  const same = sigs.filter((x) => x.deviceId === d.id && x.direction === s.direction);
  const i = same.findIndex((x) => x.id === s.id);
  const y = d.layout.y + ((i + 1) * d.layout.h) / (same.length + 1);
  return { x: s.direction === 'in' ? d.layout.x - 4 : d.layout.x + d.layout.w + 4, y };
}

export function Canvas(props: Props) {
  const { project: p, rt, view, selection, mode, connectFrom, locked } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ ids: string[]; sx: number; sy: number; dx: number; dy: number } | null>(null);
  const W = Math.max(1260, ...p.units.map((u) => u.layout.x + u.layout.w + 120));
  const H = Math.max(470, ...p.units.map((u) => u.layout.y + u.layout.h + 60));
  const L = view.layers;

  const toSvg = (clientX: number, clientY: number) => {
    const svg = svgRef.current!; const pt = svg.createSVGPoint(); pt.x = clientX; pt.y = clientY;
    const m = svg.getScreenCTM(); if (!m) return { x: 0, y: 0 };
    const r = pt.matrixTransform(m.inverse()); return { x: r.x, y: r.y };
  };

  const dragOffset = (id: string, unitId?: string) => {
    if (!drag) return { dx: 0, dy: 0 };
    if (drag.ids.includes(id) || (unitId && drag.ids.includes(unitId))) return { dx: drag.dx, dy: drag.dy };
    return { dx: 0, dy: 0 };
  };

  const startDrag = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    if (mode !== 'select') return;
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const ids = selection.includes(id) && !additive ? selection : additive ? [...new Set([...selection, id])] : [id];
    props.onSelect(ids, false);
    if (locked) { props.onBlocked('실행 중에는 배치 이동(모델 편집)이 차단됩니다. 선택·보기만 가능합니다.'); return; }
    const pt = toSvg(e.clientX, e.clientY);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ ids, sx: pt.x, sy: pt.y, dx: 0, dy: 0 });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const pt = toSvg(e.clientX, e.clientY);
    setDrag({ ...drag, dx: Math.round(pt.x - drag.sx), dy: Math.round(pt.y - drag.sy) });
  };
  const onUp = (e: React.PointerEvent) => {
    if (!drag) return;
    const pt = toSvg(e.clientX, e.clientY);
    const d = drag; setDrag(null);
    if (Math.abs(d.dx) + Math.abs(d.dy) >= 2) props.onMoveCommit(d.ids, d.dx, d.dy, pt);
  };

  // material marker
  let mat: { x: number; y: number; label: string } | null = null;
  const m0 = p.materials[0];
  const mi = rt?.material ?? (m0 && m0.initialLocation ? { location: m0.initialLocation, state: m0.initialState ?? '', holder: null, instanceId: `${m0.id}#1` } : null);
  const unitAnchor = (uid: string | 'EXIT') => {
    if (uid === 'EXIT') { const last = p.units[p.units.length - 1]; return last ? { x: last.layout.x + last.layout.w + 40, y: last.layout.y + last.layout.h - 34 } : { x: 20, y: 20 }; }
    const u = p.units.find((x) => x.id === uid); return u ? { x: u.layout.x + u.layout.w / 2, y: u.layout.y + u.layout.h - 34 } : null;
  };
  if (mi) {
    let pos = unitAnchor(mi.location);
    if (mi.holder) { const d = p.devices.find((x) => x.id === mi.holder); if (d) pos = { x: d.layout.x + d.layout.w / 2, y: d.layout.y + d.layout.h + 10 }; }
    if (rt?.active) {
      const step = p.sequence.steps[rt.active.stepIndex]; const a = p.actions.find((x) => x.id === step?.actionId);
      if (a?.effect.moveTo && a.duration.value) {
        const to = a.effect.moveTo === 'EXIT' ? unitAnchor('EXIT') : unitAnchor(a.effect.moveTo);
        const f = Math.min(1, Math.max(0, (rt.timeMs - rt.active.startMs) / (a.duration.value * 1000)));
        if (pos && to && rt.active.completeAtMs !== null) pos = { x: pos.x + (to.x - pos.x) * f, y: pos.y + (to.y - pos.y) * f };
      }
    }
    if (pos) mat = { ...pos, label: `${m0?.name.split(' ')[0] ?? 'M'} · ${mi.state}` };
  }
  const activeDevice = rt?.active ? p.actions.find((a) => a.id === p.sequence.steps[rt.active!.stepIndex]?.actionId)?.deviceId : undefined;

  return (
    <svg ref={svgRef} className="canvas-svg" width={W * view.zoom} height={H * view.zoom} viewBox={`0 0 ${W} ${H}`}
      onPointerMove={onMove} onPointerUp={onUp}
      onPointerDown={() => { if (mode === 'select') props.onSelect([], false); }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); const k = e.dataTransfer.getData('application/x-ecd-asset') as AssetKind | 'unit'; if (k) props.onDropAsset(k, toSvg(e.clientX, e.clientY)); }}>
      <defs>
        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="var(--grid)" strokeWidth="1" /></pattern>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--text)" /></marker>
      </defs>
      {L.background && <rect x={0} y={0} width={W} height={H} fill="url(#grid)" />}
      {L.background && <text x={12} y={H - 10} fontSize={10} fill="var(--muted)">배경: 도면/VC 탑뷰 없음 (선택 사항 — 배경 없이 동작)</text>}

      {/* units */}
      {p.units.map((u) => {
        const o = dragOffset(u.id); const sel = selection.includes(u.id); const isFrom = connectFrom === u.id;
        if (!L.units) return null;
        return (
          <g key={u.id} transform={`translate(${u.layout.x + o.dx},${u.layout.y + o.dy})`}
            onPointerDown={(e) => { if (mode === 'flow') { e.stopPropagation(); props.onUnitConnectClick(u.id); } else startDrag(e, u.id); }}
            style={{ cursor: mode === 'flow' ? 'crosshair' : 'move' }}>
            <rect width={u.layout.w} height={u.layout.h} fill="var(--panel)" fillOpacity={0.55} stroke={sel || isFrom ? 'var(--accent)' : 'var(--border)'} strokeWidth={sel || isFrom ? 2 : 1} strokeDasharray={isFrom ? '5 3' : undefined} />
            <rect width={u.layout.w} height={22} fill={sel ? 'var(--selected)' : 'var(--canvas)'} stroke="var(--border)" />
            <text x={8} y={15} fontSize={12} fontWeight={600} fill="var(--text)">{u.code}</text>
            <text x={32} y={15} fontSize={12} fill="var(--text)">{u.name.replace(/^S\d+\s*/, '')}</text>
            <text x={u.layout.w - 6} y={15} fontSize={10} textAnchor="end" fill="var(--muted)">{u.deviceIds.length} dev · cap {u.capacity.maxMaterials.value ?? '?'}</text>
            <line x1={4} y1={u.layout.h - 18} x2={u.layout.w - 4} y2={u.layout.h - 18} stroke="var(--muted)" strokeDasharray="2 4" />
          </g>
        );
      })}

      {/* flow connections */}
      {L.flow && p.connections.filter((c) => c.kind === 'flow').map((c) => {
        const a = p.units.find((u) => u.id === c.from.nodeId); const b = p.units.find((u) => u.id === c.to.nodeId);
        if (!a || !b) return null;
        const oa = dragOffset(a.id), ob = dragOffset(b.id);
        const y1 = a.layout.y + a.layout.h - 18 + oa.dy, y2 = b.layout.y + b.layout.h - 18 + ob.dy;
        const sel = selection.includes(c.id);
        return <line key={c.id} x1={a.layout.x + a.layout.w + oa.dx} y1={y1} x2={b.layout.x + ob.dx} y2={y2} stroke={sel ? 'var(--accent)' : 'var(--text)'} strokeWidth={sel ? 3 : 2} markerEnd="url(#arrow)"
          onPointerDown={(e) => { e.stopPropagation(); props.onSelect([c.id], false); }} style={{ cursor: 'pointer' }} />;
      })}

      {/* devices */}
      {p.devices.map((d) => {
        const def = findAsset(d.kind);
        if (!L.axis && def && (def.category === 'axis' || def.category === 'transport')) return null;
        const photo = view.visualMode === 'photo' && def ? resolvePhoto(def) : null;
        const o = dragOffset(d.id, d.unitId); const sel = selection.includes(d.id);
        const st = {
          active: activeDevice === d.id,
          extended: d.kind === 'cylinder' ? sigState(rt, p, d.id, 'cmdFwd') || sigState(rt, p, d.id, 'fwdDone')
            : d.kind === 'pusher' ? sigState(rt, p, d.id, 'cmdPush') || sigState(rt, p, d.id, 'pushDone')
            : d.kind === 'gantry' ? (rt?.devicePositions[d.id] ?? null) !== null || sigState(rt, p, d.id, 'cmdMove') : false,
          raised: d.kind === 'stopper' && (sigState(rt, p, d.id, 'upDone') || sigState(rt, p, d.id, 'cmdUp')),
          holding: rt?.material?.holder === d.id,
        };
        return (
          <g key={d.id} transform={`translate(${d.layout.x + o.dx},${d.layout.y + o.dy})`} onPointerDown={(e) => startDrag(e, d.id)} style={{ cursor: mode === 'select' ? 'move' : 'default' }}>
            <rect x={-3} y={-3} width={d.layout.w + 6} height={d.layout.h + 6} fill="transparent" stroke={sel ? 'var(--accent)' : 'none'} strokeWidth={1.5} strokeDasharray="4 2" />
            {photo?.status === 'available'
              ? <g><clipPath id={`clip-${d.id}`}><rect width={d.layout.w} height={d.layout.h} rx={3} /></clipPath>
                <image href={photo.url} width={d.layout.w} height={d.layout.h} preserveAspectRatio="xMidYMid slice" clipPath={`url(#clip-${d.id})`} />
                <rect width={d.layout.w} height={d.layout.h} rx={3} fill="none" stroke={st.active ? 'var(--accent)' : 'var(--border)'} strokeWidth={st.active ? 3 : 1} /></g>
              : <Symbol kind={d.kind} w={d.layout.w} h={d.layout.h} st={st} />}
            <text x={d.layout.w / 2} y={-6} fontSize={10} textAnchor="middle" fill={st.active ? 'var(--accent)' : 'var(--text)'} fontWeight={sel ? 700 : 400}>{d.name}</text>
            {photo && <text x={d.layout.w / 2} y={d.layout.h + 11} fontSize={8} textAnchor="middle" fill={photo.status === 'available' ? 'var(--muted)' : 'var(--warning)'}>{photo.status === 'available' ? '참고사진(모델 일치 아님)' : '사진 미확보→도식'}</text>}
          </g>
        );
      })}

      {/* positions (gantry etc.) */}
      {L.positions && p.positions.map((ps) => {
        const d = p.devices.find((x) => x.id === ps.deviceId); if (!d) return null;
        const o = dragOffset(d.id, d.unitId);
        const list = p.positions.filter((x) => x.deviceId === d.id); const i = list.indexOf(ps);
        const x = d.layout.x + o.dx + ((i + 1) * d.layout.w) / (list.length + 1); const y = d.layout.y + o.dy + d.layout.h + 4;
        const cur = rt?.devicePositions[d.id] === ps.id;
        return <g key={ps.id}><path d={`M${x} ${y} l-4 7 l8 0 z`} fill={cur ? 'var(--accent)' : 'none'} stroke="var(--warning)" /><text x={x} y={y + 17} fontSize={8} textAnchor="middle" fill="var(--warning)">{ps.name.replace(d.name, '').trim()}{ps.value.assumption ? '(가정)' : ''}</text></g>;
      })}

      {/* signal connections */}
      {L.io && p.connections.filter((c) => c.kind === 'signal').map((c) => {
        const s1 = p.signals.find((s) => s.id === c.from.signalId); const s2 = p.signals.find((s) => s.id === c.to.signalId);
        const d1 = p.devices.find((d) => d.id === s1?.deviceId); const d2 = p.devices.find((d) => d.id === s2?.deviceId);
        if (!s1 || !s2 || !d1 || !d2) return null;
        const o1 = dragOffset(d1.id, d1.unitId), o2 = dragOffset(d2.id, d2.unitId);
        const a = portPos(d1, p.signals, s1), b = portPos(d2, p.signals, s2);
        const on = rt ? !!rt.signals[s1.id] : false; const sel = selection.includes(c.id);
        const x1 = a.x + o1.dx, y1 = a.y + o1.dy, x2 = b.x + o2.dx, y2 = b.y + o2.dy;
        const midY = Math.min(y1, y2) - 26;
        return <path key={c.id} d={`M${x1} ${y1} C${x1 + 30} ${midY}, ${x2 - 30} ${midY}, ${x2} ${y2}`} fill="none" stroke={sel ? 'var(--accent)' : on ? 'var(--success)' : 'var(--muted)'} strokeWidth={sel ? 2.5 : 1.3} strokeDasharray="5 4"
          onPointerDown={(e) => { e.stopPropagation(); props.onSelect([c.id], false); }} style={{ cursor: 'pointer' }} />;
      })}

      {/* ports */}
      {L.io && p.signals.map((s) => {
        const d = p.devices.find((x) => x.id === s.deviceId); if (!d) return null;
        if (!L.axis && ['axis', 'transport'].includes(findAsset(d.kind)?.category ?? '')) return null;
        const o = dragOffset(d.id, d.unitId); const pt = portPos(d, p.signals, s);
        const on = rt ? !!rt.signals[s.id] : false; const isFrom = connectFrom === s.id;
        return <circle key={s.id} cx={pt.x + o.dx} cy={pt.y + o.dy} r={mode === 'signal' ? 5 : 3.5} fill={on ? 'var(--success)' : isFrom ? 'var(--accent)' : 'var(--panel)'} stroke={s.direction === 'in' ? 'var(--accent)' : 'var(--text)'} strokeWidth={1.3}
          onPointerDown={(e) => { if (mode === 'signal') { e.stopPropagation(); props.onPortClick(s.id); } }} style={{ cursor: mode === 'signal' ? 'crosshair' : 'default' }}>
          <title>{`${s.name} [${s.direction === 'in' ? '입력' : '출력'} · ${s.role}] 주소: ${s.address ?? '미정(개념 신호)'}${on ? ' · ON' : ''}`}</title>
        </circle>;
      })}

      {/* material */}
      {mat && L.flow && (
        <g transform={`translate(${mat.x},${mat.y})`} pointerEvents="none">
          <rect x={-11} y={-11} width={22} height={22} fill="var(--warning)" fillOpacity={0.25} stroke="var(--warning)" strokeWidth={2} />
          <text y={26} fontSize={10} textAnchor="middle" fill="var(--text)">{mat.label}</text>
        </g>
      )}
      <g transform={`translate(12, ${H - 40})`} fontSize={10} fill="var(--muted)">
        <line x1={0} y1={0} x2={26} y2={0} stroke="var(--text)" strokeWidth={2} /><text x={32} y={3}>자재 흐름(물류)</text>
        <line x1={120} y1={0} x2={146} y2={0} stroke="var(--muted)" strokeDasharray="5 4" /><text x={152} y={3}>논리 신호 (out●→in○)</text>
        <path d="M290 -4 l-4 7 l8 0z" fill="none" stroke="var(--warning)" /><text x={300} y={3}>Position</text>
        <rect x={360} y={-6} width={12} height={12} fill="var(--warning)" fillOpacity={0.25} stroke="var(--warning)" /><text x={378} y={3}>자재(런타임 개체)</text>
      </g>
    </svg>
  );
}
