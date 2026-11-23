// Read-only SFC. Drawn 1:1 (11px text). The page scrolls when the chart is taller than the screen.
import type { ReactNode } from 'react';
import type { FlowNode, Project } from '../model/types';
import type { RuntimeState } from '../runtime/engine';
import { aggregateStepStatus } from '../runtime/runSummary';
import { condLabel, flowBlockTitle } from './labels';
import { phaseShape, STATUS, type StatusKey } from './status';

const BOX_W = 180;
const BOX_H = 28;
const GAP = 18;
const FONT = 11;

interface Block { w: number; h: number; body: (x: number, y: number) => ReactNode }

function stepName(p: Project, id: string): string {
  return p.sequence.steps.find((s) => s.id === id)?.name
    ?? (p.substationSequences ?? []).flatMap((q) => q.steps).find((s) => s.id === id)?.name
    ?? id;
}

function box(key: string, label: string, x: number, y: number, tone: StatusKey): ReactNode {
  const def = STATUS[tone];
  const hot = tone === 'active';
  return <g key={key} data-sfc-status={tone} role="img" aria-label={`${def.word} ${label}`}>
    <rect x={x} y={y} width={BOX_W} height={BOX_H} rx={2} fill={hot ? 'var(--selected)' : 'var(--panel)'} stroke={`var(${def.colorVar})`} strokeWidth={hot ? 2 : 1} />
    <text x={x + 6} y={y + 18} fontSize={FONT} fill={`var(${def.colorVar})`}>{def.mark}</text>
    <text x={x + 20} y={y + 18} fontSize={FONT} fill="var(--text)">{label.slice(0, 16)}</text>
  </g>;
}

function arrowHead(x: number, y: number, dir: 'left' | 'up'): ReactNode {
  if (dir === 'left') return <polygon points={`${x},${y} ${x + 8},${y - 4} ${x + 8},${y + 4}`} fill="var(--text)" />;
  return <polygon points={`${x},${y} ${x - 4},${y + 8} ${x + 4},${y + 8}`} fill="var(--text)" />;
}

function layoutSeq(p: Project, nodes: FlowNode[], tone: (id: string) => StatusKey): Block {
  const parts = nodes.map((n) => layoutNode(p, n, tone));
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

function layoutNode(p: Project, n: FlowNode, tone: (id: string) => StatusKey): Block {
  if (n.kind === 'step') {
    return { w: BOX_W, h: BOX_H, body: (x, y) => box(n.stepId, stepName(p, n.stepId), x, y, tone(n.stepId)) };
  }
  if (n.kind === 'branch') {
    const thenB = layoutSeq(p, n.then, tone);
    const elseB = layoutSeq(p, n.else, tone);
    const gap = 36;
    const w = Math.max(BOX_W, thenB.w + elseB.w + gap);
    const h = 40 + Math.max(thenB.h, elseB.h) + 20;
    const thenLabel = `참 ${condLabel(p, n.cond)}`;
    const elseLabel = `거짓 ${condLabel(p, n.cond.kind === 'signal' ? { ...n.cond, equals: !n.cond.equals } : n.cond)}`;
    return {
      w, h, body: (x, y) => {
        const thenCx = x + thenB.w / 2;
        const elseCx = x + thenB.w + gap + elseB.w / 2;
        const splitY = y + 28;
        const bodyY = splitY + 14;
        const joinY = y + h - 2;
        return <g>
          <text x={x} y={y + 14} fontSize={FONT} fill="var(--text)">{flowBlockTitle('branch', n.name)}</text>
          <text x={x} y={splitY - 2} fontSize={FONT} fill="var(--text)">{thenLabel}</text>
          <text x={x + thenB.w + gap} y={splitY - 2} fontSize={FONT} fill="var(--text)">{elseLabel}</text>
          <line x1={thenCx} y1={splitY} x2={elseCx} y2={splitY} stroke="var(--text)" />
          <line x1={thenCx} y1={splitY} x2={thenCx} y2={bodyY} stroke="var(--text)" />
          <line x1={elseCx} y1={splitY} x2={elseCx} y2={bodyY} stroke="var(--text)" />
          {thenB.body(x, bodyY)}
          {elseB.body(x + thenB.w + gap, bodyY)}
          <line x1={thenCx} y1={bodyY + thenB.h} x2={thenCx} y2={joinY} stroke="var(--text)" />
          <line x1={elseCx} y1={bodyY + elseB.h} x2={elseCx} y2={joinY} stroke="var(--text)" />
          <line x1={thenCx} y1={joinY} x2={elseCx} y2={joinY} stroke="var(--text)" />
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
    const laid = lanes.map((lane) => lane.length
      ? layoutSeq(p, lane, tone)
      : { w: BOX_W, h: BOX_H, body: (x: number, y: number) => box(`empty-${n.id}`, '(빈 갈래)', x, y, 'pending') });
    if (n.kind === 'substation') {
      laid.forEach((b, idx) => {
        b.body = (x, y) => box(names[idx] ?? String(idx), names[idx] ?? '시퀀스', x, y, 'pending');
        b.w = BOX_W;
        b.h = BOX_H;
      });
    }
    const gap = 24;
    const w = Math.max(BOX_W, laid.reduce((s, b) => s + b.w, 0) + gap * Math.max(0, laid.length - 1));
    const h = 36 + Math.max(...laid.map((b) => b.h), BOX_H) + 20;
    const title = n.kind === 'parallel' ? flowBlockTitle('parallel', n.name) : `Substation ${p.units.find((u) => u.id === n.unitId)?.name ?? ''}`;
    return {
      w, h, body: (x, y) => {
        let xx = x;
        const bars = (yy: number) => <>
          <line x1={x} y1={yy} x2={x + w} y2={yy} stroke="var(--text)" strokeWidth={2} />
          <line x1={x} y1={yy + 4} x2={x + w} y2={yy + 4} stroke="var(--text)" strokeWidth={2} />
        </>;
        return <g>
          <text x={x} y={y + 14} fontSize={FONT} fill="var(--text)">{title}</text>
          {bars(y + 20)}
          {laid.map((b, idx) => { const el = <g key={idx}>{b.body(xx, y + 32)}</g>; xx += b.w + gap; return el; })}
          {bars(y + h - 10)}
        </g>;
      },
    };
  }
  const inner = layoutSeq(p, n.body, tone);
  const tag = n.kind === 'loop' ? `×${n.count}` : `최대 ${n.maxRetries}회`;
  const caption = n.kind === 'loop' ? flowBlockTitle('loop', n.name) : flowBlockTitle('retry', n.name);
  const extra = n.kind === 'loop' ? 44 : 84;
  const w = inner.w + extra;
  const h = 20 + inner.h + 8;
  return {
    w, h, body: (x, y) => {
      const top = y + 22;
      const bottom = top + inner.h;
      const rail = x + inner.w + 16;
      return <g>
        <text x={x} y={y + 14} fontSize={FONT} fill="var(--text)">{caption}</text>
        {inner.body(x, top)}
        <line x1={x + inner.w / 2} y1={bottom} x2={rail} y2={bottom} stroke="var(--text)" />
        <line x1={rail} y1={bottom} x2={rail} y2={top + 8} stroke="var(--text)" />
        <line x1={rail} y1={top + 8} x2={x + inner.w - 2} y2={top + 8} stroke="var(--text)" />
        {arrowHead(x + inner.w - 10, top + 8, 'left')}
        <text x={rail + 6} y={top + (inner.h / 2)} fontSize={FONT} fill="var(--text)">{tag}</text>
      </g>;
    },
  };
}

export function SfcView({ p, rt }: { p: Project; rt: RuntimeState | null }) {
  const flow: FlowNode[] = p.sequence.flow ?? p.sequence.steps.map((s) => ({ kind: 'step', stepId: s.id }));
  const tone = (id: string) => phaseShape(aggregateStepStatus((rt?.steps ?? []).filter((s) => s.stepId === id)).phase).status;
  const laid = layoutSeq(p, flow, tone);
  const h = Math.max(80, laid.h + 40);
  const w = Math.max(BOX_W + 48, laid.w + 48);
  return <svg width={w} height={h} role="img" aria-label="SFC 미리보기">
    <text x={16} y={18} fontSize={FONT} fill="var(--muted)">초기</text>
    {laid.body(24, 28)}
  </svg>;
}
