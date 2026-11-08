import type { AssetKind } from '../model/types';

// 직접 작성한 간단한 2D 도식 (사진 아님). w×h 박스 안에 그린다.
export interface SymState { active?: boolean; extended?: boolean; raised?: boolean; holding?: boolean }

export function Symbol({ kind, w, h, st = {} }: { kind: AssetKind; w: number; h: number; st?: SymState }) {
  const s = 'var(--text)';
  const a = st.active ? 'var(--accent)' : s;
  const sw = 1.4;
  switch (kind) {
    case 'cylinder': {
      const rod = st.extended ? h * 0.42 : h * 0.18;
      return (<g stroke={a} strokeWidth={sw} fill="none">
        <rect x={w * 0.25} y={2} width={w * 0.5} height={h * 0.52} fill="var(--panel)" />
        <rect x={w * 0.3} y={h * 0.32} width={w * 0.4} height={h * 0.1} fill="var(--grid)" />
        <line x1={w / 2} y1={h * 0.54} x2={w / 2} y2={h * 0.54 + rod} strokeWidth={3} />
        <rect x={w * 0.32} y={h * 0.54 + rod} width={w * 0.36} height={5} fill={a} />
      </g>);
    }
    case 'pusher': {
      const ext = st.extended ? w * 0.35 : 0;
      return (<g stroke={a} strokeWidth={sw} fill="none">
        <rect x={2} y={h * 0.25} width={w * 0.45} height={h * 0.5} fill="var(--panel)" />
        <line x1={w * 0.47} y1={h / 2} x2={w * 0.55 + ext} y2={h / 2} strokeWidth={3} />
        <rect x={w * 0.55 + ext} y={h * 0.12} width={5} height={h * 0.76} fill={a} />
      </g>);
    }
    case 'barcodeReader':
      return (<g stroke={a} strokeWidth={sw} fill="none">
        <rect x={w * 0.15} y={2} width={w * 0.7} height={h * 0.4} fill="var(--panel)" />
        {[0.25, 0.35, 0.42, 0.55, 0.62, 0.72].map((f) => <line key={f} x1={w * f} y1={6} x2={w * f} y2={h * 0.34} />)}
        <path d={`M${w * 0.4} ${h * 0.42} L${w * 0.15} ${h - 2} M${w * 0.6} ${h * 0.42} L${w * 0.85} ${h - 2}`} strokeDasharray="3 3" stroke={st.active ? 'var(--accent)' : 'var(--muted)'} />
      </g>);
    case 'conveyor':
      return (<g stroke={a} strokeWidth={sw} fill="none">
        <rect x={1} y={h * 0.2} width={w - 2} height={h * 0.6} rx={h * 0.3} fill="var(--panel)" />
        {Array.from({ length: Math.max(3, Math.floor(w / 22)) }).map((_, i, arr) => <circle key={i} cx={10 + (i * (w - 20)) / (arr.length - 1)} cy={h / 2} r={h * 0.18} />)}
        {st.active && <path d={`M${w * 0.4} ${h / 2} l${w * 0.2} 0 m-6 -4 l6 4 l-6 4`} stroke="var(--accent)" />}
      </g>);
    case 'stopper': {
      const up = st.raised ? 0 : h * 0.3;
      return (<g stroke={a} strokeWidth={sw} fill="none">
        <rect x={w * 0.3} y={2 + up} width={w * 0.4} height={h * 0.45} fill={st.raised ? a : 'var(--panel)'} />
        <rect x={w * 0.15} y={h * 0.75} width={w * 0.7} height={h * 0.22} fill="var(--panel)" />
      </g>);
    }
    case 'gantry':
      return (<g stroke={a} strokeWidth={sw} fill="none">
        <line x1={6} y1={6} x2={6} y2={h - 2} /><line x1={w - 6} y1={6} x2={w - 6} y2={h - 2} />
        <rect x={2} y={4} width={w - 4} height={8} fill="var(--panel)" />
        <rect x={st.extended ? w * 0.62 : w * 0.18} y={1} width={w * 0.2} height={14} fill={st.active ? 'var(--accent)' : 'var(--grid)'} />
      </g>);
    case 'picker':
      return (<g stroke={a} strokeWidth={sw} fill="none">
        <rect x={w * 0.3} y={2} width={w * 0.4} height={h * 0.25} fill="var(--panel)" />
        <line x1={w / 2} y1={h * 0.27} x2={w / 2} y2={h * 0.65} strokeWidth={3} />
        <path d={st.holding ? `M${w * 0.32} ${h * 0.65} L${w * 0.68} ${h * 0.65} M${w * 0.36} ${h * 0.65} L${w * 0.36} ${h - 3} M${w * 0.64} ${h * 0.65} L${w * 0.64} ${h - 3}` : `M${w * 0.25} ${h * 0.65} L${w * 0.75} ${h * 0.65} M${w * 0.25} ${h * 0.65} L${w * 0.2} ${h - 3} M${w * 0.75} ${h * 0.65} L${w * 0.8} ${h - 3}`} />
      </g>);
    case 'sensor':
      return (<g stroke={a} strokeWidth={sw} fill="none">
        <rect x={w * 0.2} y={h * 0.25} width={w * 0.45} height={h * 0.5} fill="var(--panel)" />
        <path d={`M${w * 0.72} ${h * 0.35} q6 ${h * 0.15} 0 ${h * 0.3} M${w * 0.82} ${h * 0.25} q9 ${h * 0.25} 0 ${h * 0.5}`} />
      </g>);
    case 'photoelectricSensor':
      return (<g stroke={a} strokeWidth={sw} fill="none">
        <rect x={2} y={h * 0.22} width={w * 0.42} height={h * 0.56} rx={2} fill="var(--panel)" />
        <circle cx={w * 0.36} cy={h / 2} r={Math.min(w, h) * 0.1} fill={st.active ? 'var(--accent)' : 'var(--grid)'} />
        <path d={`M${w * 0.46} ${h * 0.42} L${w - 2} ${h * 0.42} M${w * 0.46} ${h * 0.58} L${w - 2} ${h * 0.58}`} strokeDasharray="2 2" stroke={st.active ? 'var(--accent)' : 'var(--muted)'} />
      </g>);
    case 'proximitySensor':
      return (<g stroke={a} strokeWidth={sw} fill="none">
        <rect x={2} y={h * 0.3} width={w * 0.6} height={h * 0.4} fill="var(--panel)" />
        {[0.15, 0.27, 0.39, 0.51].map((f) => <line key={f} x1={w * f} y1={h * 0.3} x2={w * f} y2={h * 0.7} stroke="var(--muted)" />)}
        <rect x={w * 0.62} y={h * 0.36} width={w * 0.1} height={h * 0.28} fill={st.active ? 'var(--accent)' : 'var(--grid)'} />
        <path d={`M${w * 0.8} ${h * 0.3} q5 ${h * 0.2} 0 ${h * 0.4}`} />
      </g>);
    case 'limitSwitch':
      return (<g stroke={a} strokeWidth={sw} fill="none">
        <rect x={w * 0.1} y={h * 0.45} width={w * 0.6} height={h * 0.5} fill="var(--panel)" />
        <line x1={w * 0.4} y1={h * 0.45} x2={w * 0.85} y2={st.active ? h * 0.3 : h * 0.12} strokeWidth={2} />
        <circle cx={w * 0.85} cy={st.active ? h * 0.3 : h * 0.12} r={Math.min(w, h) * 0.08} fill="var(--grid)" />
      </g>);
    default:
      if (kind.startsWith('unit')) return <UnitTemplateSymbol kind={kind} w={w} h={h} />;
      return (<g stroke={s} strokeWidth={sw} fill="none"><rect x={2} y={2} width={w - 4} height={h - 4} strokeDasharray="3 2" /><text x={w / 2} y={h / 2 + 3} fontSize={8} textAnchor="middle" fill="var(--muted)" stroke="none">?</text></g>);
  }
}

const TEMPLATE_KINDS: Record<string, AssetKind[]> = { unitInput: ['photoelectricSensor', 'pusher', 'cylinder'], unitIdentify: ['barcodeReader', 'stopper', 'proximitySensor'], unitTransfer: ['gantry', 'picker', 'limitSwitch'] };
function UnitTemplateSymbol({ kind, w, h }: { kind: AssetKind; w: number; h: number }) {
  const kids = TEMPLATE_KINDS[kind] ?? [];
  const cw = (w - 8) / Math.max(1, kids.length);
  return (<g>
    <rect x={1} y={1} width={w - 2} height={h - 2} fill="none" stroke="var(--text)" strokeDasharray="4 2" />
    {kids.map((k, i) => <g key={k} transform={`translate(${4 + i * cw},${h * 0.2})`}><Symbol kind={k} w={cw - 4} h={h * 0.6} /></g>)}
  </g>);
}

export function PaletteIcon({ kind }: { kind: AssetKind | 'unit' }) {
  if (kind === 'unit') return <svg width={34} height={22}><rect x={2} y={2} width={30} height={18} fill="none" stroke="var(--text)" strokeDasharray="4 2" /></svg>;
  return <svg width={34} height={22}><Symbol kind={kind} w={34} h={22} /></svg>;
}
