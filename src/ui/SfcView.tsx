// Read-only SFC for a Station flow: branch labels, parallel double bars, loop and retry return arrows.
import type { ReactNode } from 'react';
import type { FlowNode, Project } from '../model/types';
import type { RuntimeState } from '../runtime/engine';
import { condLabel } from './labels';

const BOX_W = 168;
const BOX_H = 26;
const GAP = 14;

interface Block { w: number; h: number; body: (x: number, y: number) => ReactNode }

function stepName(p: Project, id: string): string {
  return p.sequence.steps.find((s) => s.id === id)?.name
    ?? (p.substationSequences ?? []).flatMap((q) => q.steps).find((s) => s.id === id)?.name
    ?? id;
}

function box(key: string, label: string, x: number, y: number, hot: boolean, done: boolean): ReactNode {
  return <g key={key}>
    <rect x={x} y={y} width={BOX_W} height={BOX_H} rx={2} fill={hot ? 'var(--selected)' : done ? 'var(--grid)' : 'var(--panel)'} stroke={hot ? 'var(--accent, var(--text))' : 'var(--text)'} />
    <text x={x + 8} y={y + 17} fontSize={11} fill="var(--text)">{label.slice(0, 18)}</text>
  </g>;
}

function layoutSeq(p: Project, nodes: FlowNode[], active: Set<string>, done: Set<string>): Block {
  const parts = nodes.map((n) => layoutNode(p, n, active, done));
  const w = Math.max(BOX_W, ...parts.map((b) => b.w), 40);
  const h = parts.reduce((sum, b) => sum + b.h, 0) + Math.max(0, parts.length - 1) * GAP;
  return {
    w, h, body: (x, y) => {
      let yy = y;
      const cx = x + w / 2;
      const els: ReactNode[] = [];
      parts.forEach((b, i) => {
        if (i > 0) els.push(<line key={`v${i}`} x1={cx} y1={yy - GAP} x2={cx} y2={yy} stroke="var(--text)" />);
        els.push(<g key={i}>{b.body(x + (w - b.w) / 2, yy)}</g>);
        yy += b.h + GAP;
      });
      return <g>{els}</g>;
    },
  };
}

function layoutNode(p: Project, n: FlowNode, active: Set<string>, done: Set<string>): Block {
  if (n.kind === 'step') {
    return { w: BOX_W, h: BOX_H, body: (x, y) => box(n.stepId, stepName(p, n.stepId), x, y, active.has(n.stepId), done.has(n.stepId)) };
  }
  if (n.kind === 'branch') {
    const thenB = layoutSeq(p, n.then, active, done);
    const elseB = layoutSeq(p, n.else, active, done);
    const gap = 28;
    const w = Math.max(BOX_W, thenB.w + elseB.w + gap);
    const h = 36 + Math.max(thenB.h, elseB.h) + 18;
    const thenLabel = `참 ${condLabel(p, n.cond)}`;
    const elseLabel = `거짓 ${condLabel(p, { ...n.cond, ...(n.cond.kind === 'signal' ? { equals: !n.cond.equals } : {}) })}`;
    return {
      w, h, body: (x, y) => {
        const mid = x + w / 2;
        const top = y + 16;
        return <g>
          <text x={mid} y={y + 12} fontSize={11} textAnchor="middle" fill="var(--text)">분기 {n.name}</text>
          <line x1={mid} y1={top} x2={x + thenB.w / 2} y2={top + 16} stroke="var(--text)" />
          <line x1={mid} y1={top} x2={x + thenB.w + gap + elseB.w / 2} y2={top + 16} stroke="var(--text)" />
          <text x={x + 4} y={top + 12} fontSize={10} fill="var(--text)">{thenLabel.slice(0, 28)}</text>
          <text x={x + thenB.w + gap} y={top + 12} fontSize={10} fill="var(--text)">{elseLabel.slice(0, 28)}</text>
          {thenB.body(x, top + 18)}
          {elseB.body(x + thenB.w + gap, top + 18)}
          <line x1={x + thenB.w / 2} y1={top + 18 + thenB.h} x2={mid} y2={y + h} stroke="var(--text)" />
          <line x1={x + thenB.w + gap + elseB.w / 2} y1={top + 18 + elseB.h} x2={mid} y2={y + h} stroke="var(--text)" />
        </g>;
      },
    };
  }
  if (n.kind === 'parallel' || n.kind === 'substation') {
    const lanes: FlowNode[][] = n.kind === 'parallel'
      ? n.lanes
      : (p.substationSequences ?? []).filter((q) => q.unitId === n.unitId).map((q) => [{ kind: 'step', stepId: q.id }]);
    const names = n.kind === 'substation'
      ? (p.substationSequences ?? []).filter((q) => q.unitId === n.unitId).map((q) => q.name)
      : n.lanes.map((_, idx) => `갈래 ${idx + 1}`);
    const laid = lanes.map((lane) => lane.length ? layoutSeq(p, lane, active, done) : { w: BOX_W, h: BOX_H, body: (x: number, y: number) => box('empty', '(빈 갈래)', x, y, false, false) });
    if (n.kind === 'substation') {
      laid.forEach((b, idx) => { b.body = (x, y) => box(names[idx] ?? String(idx), names[idx] ?? '시퀀스', x, y, false, false); b.w = BOX_W; b.h = BOX_H; });
    }
    const gap = 20;
    const w = Math.max(BOX_W, laid.reduce((s, b) => s + b.w, 0) + gap * Math.max(0, laid.length - 1));
    const h = 28 + Math.max(...laid.map((b) => b.h), BOX_H) + 16;
    const title = n.kind === 'parallel' ? `병렬 ${n.name}` : `Substation ${(p.units.find((u) => u.id === n.unitId)?.name) ?? ''}`;
    return {
      w, h, body: (x, y) => {
        let xx = x;
        return <g>
          <text x={x} y={y + 12} fontSize={11} fill="var(--text)">{title}</text>
          <line x1={x} y1={y + 16} x2={x + w} y2={y + 16} stroke="var(--text)" strokeWidth={2} />
          <line x1={x} y1={y + 20} x2={x + w} y2={y + 20} stroke="var(--text)" strokeWidth={2} />
          {laid.map((b, idx) => { const el = <g key={idx}>{b.body(xx, y + 28)}</g>; xx += b.w + gap; return el; })}
          <line x1={x} y1={y + h - 8} x2={x + w} y2={y + h - 8} stroke="var(--text)" strokeWidth={2} />
          <line x1={x} y1={y + h - 4} x2={x + w} y2={y + h - 4} stroke="var(--text)" strokeWidth={2} />
        </g>;
      },
    };
  }
  const body = n.kind === 'loop' ? n.body : n.body;
  const inner = layoutSeq(p, body, active, done);
  const caption = n.kind === 'loop' ? `반복 ${n.name} ×${n.count}` : `재시도 ${n.name} 최대 ${n.maxRetries}회`;
  const w = inner.w + 48;
  const h = 16 + inner.h;
  return {
    w, h, body: (x, y) => <g>
      <text x={x} y={y + 12} fontSize={11} fill="var(--text)">{caption}</text>
      {inner.body(x, y + 16)}
      <path d={`M ${x + inner.w + 8} ${y + 16 + inner.h - 8} H ${x + w - 8} V ${y + 20} H ${x + inner.w + 8}`} fill="none" stroke="var(--text)" />
      {n.kind === 'loop' && <text x={x + inner.w + 12} y={y + 28} fontSize={10} fill="var(--text)">×{n.count}</text>}
    </g>,
  };
}

export function SfcView({ p, rt }: { p: Project; rt: RuntimeState | null }) {
  const flow: FlowNode[] = p.sequence.flow ?? p.sequence.steps.map((s) => ({ kind: 'step', stepId: s.id }));
  const active = new Set((rt?.steps ?? []).filter((s) => s.status === 'active').map((s) => s.stepId));
  const done = new Set((rt?.steps ?? []).filter((s) => s.status === 'done').map((s) => s.stepId));
  const laid = layoutSeq(p, flow, active, done);
  const h = Math.max(80, laid.h + 36);
  const w = Math.max(420, laid.w + 48);
  const maxH = 380;
  const scale = Math.min(1, maxH / h);
  return <svg width={w * scale} height={h * scale} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="SFC 미리보기">
    <text x={16} y={16} fontSize={11} fill="var(--muted)">초기</text>
    {laid.body(24, 24)}
  </svg>;
}
