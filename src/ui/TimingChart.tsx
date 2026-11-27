import { useState } from 'react';
import { materialKindLook, materialKindLooks, type MaterialKindLook } from '../model/materialKind';
import type { Project } from '../model/types';
import type { RuntimeState } from '../runtime/engine';
import { chartPlotWidth, timingChart, type TimingBar, type TimingLane, type TimingRow } from '../runtime/timingChart';
import { formatMs } from '../scene/runInfo';
import { MaterialKindMark } from './MaterialKindMark';
import { EmptyState } from './EmptyState';
import { IconLabel } from './Icon';
import { StatusMark } from './StatusMark';
import { STATUS } from './status';
import './timing-chart.css';

const BAR = 16;
const ROW_GAP = 4;
const AXIS = 16;
const LABEL_W = 120;
const ZOOMS = [1, 2, 4] as const;

function barMark(bar: TimingBar): { mark: string; word: string } {
  if (bar.hatch === 'standby' || (bar.hatch === 'signal' && bar.status === 'active')) return { mark: STATUS.pending.mark, word: '대기' };
  if (bar.status === 'stopped') return { mark: STATUS.assumption.mark, word: '정지' };
  if (bar.status === 'error') return { mark: STATUS.error.mark, word: STATUS.error.word };
  if (bar.status === 'active') return { mark: STATUS.active.mark, word: STATUS.active.word };
  return { mark: STATUS.done.mark, word: STATUS.done.word };
}

function whereText(bar: TimingBar): string {
  const parts = [bar.lane, bar.pass != null ? `${bar.pass}회` : '', bar.condText].filter(Boolean);
  return parts.join(' · ') || '—';
}

function elapsedText(bar: TimingBar): string {
  if (bar.endMs == null) return '-';
  return formatMs(Math.max(0, bar.endMs - bar.startMs));
}

function barKey(bar: TimingBar): string {
  return `${bar.summaryIndex}:${bar.hatch ?? 'run'}:${bar.startMs}:${bar.rowId}`;
}

function clip(label: string): string {
  return label.length > 16 ? `${label.slice(0, 15)}…` : label;
}

function rowTops(rows: TimingRow[]): Map<string, number> {
  const top = new Map<string, number>();
  let y = 0;
  for (const row of rows) {
    top.set(row.id, y);
    y += row.sublanes * BAR + ROW_GAP;
  }
  return top;
}

/** SVG timing chart. One bar is one step execution. Grouping is Unit, Device, or piece. */
export function TimingChart({ p, rt, nowMs, onPick, onRun, runDisabled, runReason }: {
  p: Project;
  rt: RuntimeState | null;
  /** Overrides the live cursor. Scrubbing passes the finished chart plus this instant. */
  nowMs?: number | null;
  onPick: (summaryIndex: number) => void;
  onRun?: () => void;
  runDisabled?: boolean;
  runReason?: string;
}) {
  const [requested, setRequested] = useState<TimingLane>('unit');
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>(1);
  const [hover, setHover] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const model = timingChart(p, rt, requested);
  const tip = model.bars.find((bar) => barKey(bar) === (focus ?? hover)) ?? null;
  if (model.empty) {
    return (
      <div className="timing-chart" data-timing-empty="">
        <EmptyState symbol={STATUS.pending.mark} line="실행 기록이 없습니다." actions={[{ label: '실행', icon: 'run', onClick: onRun, disabled: runDisabled, reason: runReason }]} />
      </div>
    );
  }
  const kinds = materialKindLooks(p);
  const rowLook = (rowId: string): MaterialKindLook | null => {
    const index = /^piece:(\d+)$/.exec(rowId);
    if (!index || !rt?.pieces) return null;
    const pc = rt.pieces.find((row) => row.index === Number(index[1]));
    return pc ? materialKindLook(p, pc.material.materialId) : null;
  };
  const plotW = chartPlotWidth(model.spanMs, zoom);
  const tops = rowTops(model.rows);
  const plotH = model.rows.reduce((sum, row) => sum + row.sublanes * BAR + ROW_GAP, 0);
  const xOf = (ms: number) => ((ms - model.originMs) / model.spanMs) * plotW;
  const cursor = nowMs === undefined ? model.nowMs : nowMs;
  const zoomDown = () => setZoom((z) => (z === 4 ? 2 : 1));
  const zoomUp = () => setZoom((z) => (z === 1 ? 2 : 4));
  return (
    <div className="timing-chart" data-timing-lane={model.lane} data-zoom={zoom} data-plot-w={plotW}>
      <div className="timing-tools">
        <div role="radiogroup" aria-label="타이밍 줄">
          {([
            ['unit', 'Unit 별', 'object-unit'],
            ['device', 'Device 별', 'object-device'],
            ['piece', '개체 별', 'run-piece'],
          ] as const).filter(([id]) => model.lanes.includes(id)).map(([id, label, icon]) => (
            <button key={id} type="button" className="small" role="radio" aria-checked={model.lane === id} data-timing-lane={id} onClick={() => setRequested(id)}><IconLabel id={icon}>{label}</IconLabel></button>
          ))}
        </div>
        <button type="button" className="small" aria-label="축소" disabled={zoom <= 1} onClick={zoomDown}><IconLabel id="zoom-out">축소</IconLabel></button>
        <button type="button" className="small" aria-label="확대" disabled={zoom >= 4} onClick={zoomUp}><IconLabel id="zoom-in">확대</IconLabel></button>
        <span className="timing-zoom">{zoom}×</span>
        <span className="muted">가정 시간 · 실제 택트 아님</span>
      </div>
      <div className="timing-legend" aria-label="막대 범례">
        <StatusMark status="done" />
        <StatusMark status="active" />
        <StatusMark status="error" />
        <StatusMark status="assumption" word="정지" />
        <span className="timing-legend-wait">
          <svg className="timing-swatch" width="16" height="10" aria-hidden="true">
            <rect width="16" height="10" fill="var(--panel)" stroke="var(--status-pending)" />
            <path d="M0 10 L10 0 M6 10 L16 0" stroke="var(--status-pending)" />
          </svg>
          대기 · 기다림
        </span>
        {kinds.map((look) => <span key={look.materialId} data-kind-legend={look.mark}><MaterialKindMark look={look} name /></span>)}
      </div>
      <div className="timing-scroll" data-timing-scroll="">
        <div className="timing-sheet">
        <svg className="timing-labels" width={LABEL_W} height={plotH + AXIS} aria-hidden="true">
          <defs>
            <pattern id="mat-pat-hatch" width="4" height="4" patternUnits="userSpaceOnUse">
              <path d="M-1 3 L3 -1 M1 5 L5 1" stroke="var(--text)" strokeWidth="1" />
            </pattern>
            <pattern id="mat-pat-dots" width="4" height="4" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="0.8" fill="var(--text)" />
            </pattern>
            <pattern id="mat-pat-lines" width="4" height="4" patternUnits="userSpaceOnUse">
              <path d="M0 2 H4" stroke="var(--text)" strokeWidth="1" />
            </pattern>
          </defs>
          {model.rows.map((row) => {
            const y = tops.get(row.id) ?? 0;
            const h = row.sublanes * BAR + ROW_GAP;
            const look = rowLook(row.id);
            const mid = y + h / 2;
            return (
              <g key={row.id}>
                {look && <rect x={2} y={mid - 6} width={12} height={12} fill={`var(${look.token})`} stroke="var(--text)" />}
                {look && look.pattern !== 'solid' && <rect x={2} y={mid - 6} width={12} height={12} fill={`url(#mat-pat-${look.pattern})`} />}
                <text data-timing-row={row.id} data-mat-token={look?.token} data-mat-pattern={look?.pattern} data-mat-mark={look?.mark} x={LABEL_W - 8} y={mid} textAnchor="end" dominantBaseline="middle"><title>{row.label}</title>{clip(row.label)}</text>
              </g>
            );
          })}
        </svg>
          <svg width={plotW + 28} height={plotH + AXIS} role="group" aria-label="타이밍 차트">
            <defs>
              <pattern id="timing-hatch" width="5" height="5" patternUnits="userSpaceOnUse">
                <rect width="5" height="5" fill="var(--panel)" />
                <path d="M0 5 L5 0" stroke="var(--status-pending)" strokeWidth="1" />
              </pattern>
            </defs>
            {model.ticks.map((tick) => {
              const x = xOf(tick.ms);
              return (
                <g key={tick.ms} data-tick-ms={tick.ms}>
                  <line className="timing-axis" x1={x} x2={x} y1={0} y2={plotH} />
                  <text x={x + 2} y={plotH + 12}>{tick.label}</text>
                </g>
              );
            })}
            {cursor != null && (
              <g data-timing-now="" data-now-ms={cursor}>
                <line className="timing-now" x1={xOf(cursor)} x2={xOf(cursor)} y1={0} y2={plotH} />
                <text x={xOf(cursor) + 2} y={10}>지금</text>
              </g>
            )}
            {model.bars.map((bar) => {
              const key = barKey(bar);
              const y = (tops.get(bar.rowId) ?? 0) + bar.sublane * BAR + 1;
              const x = xOf(bar.startMs);
              const w = Math.max(xOf(bar.drawEndMs) - x, 4);
              const mark = barMark(bar);
              const label = [bar.name, `시작 ${formatMs(bar.startMs)}`, `끝 ${bar.endMs == null ? '-' : formatMs(bar.endMs)}`, `걸린 시간 ${elapsedText(bar)}`, whereText(bar), bar.piece != null ? `개체 ${bar.piece}` : ''].filter(Boolean).join(', ');
              return (
                <g
                  key={key}
                  className="timing-hit"
                  role="button"
                  tabIndex={0}
                  data-timing-bar=""
                  data-summary-index={bar.summaryIndex}
                  data-step-id={bar.stepId}
                  data-status={bar.status}
                  data-hatch={bar.hatch ?? undefined}
                  data-start-ms={bar.startMs}
                  data-end-ms={bar.endMs ?? undefined}
                  data-piece={bar.piece ?? undefined}
                  data-row-id={bar.rowId}
                  aria-label={label}
                  aria-describedby={tip && barKey(tip) === key ? 'timing-tip' : undefined}
                  onClick={() => { if (bar.summaryIndex >= 0) onPick(bar.summaryIndex); }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    if (bar.summaryIndex >= 0) onPick(bar.summaryIndex);
                  }}
                  onMouseEnter={() => setHover(key)}
                  onMouseLeave={() => setHover((cur) => (cur === key ? null : cur))}
                  onFocus={() => setFocus(key)}
                  onBlur={() => setFocus((cur) => (cur === key ? null : cur))}
                >
                  <rect className={`timing-bar is-${bar.status}${bar.hatch ? ' is-hatch' : ''}`} x={x} y={y} width={w} height={BAR - 2} rx={2} />
                  <rect className="timing-chip" x={x + 1} y={y + 1} width={12} height={12} rx={2} />
                  <text className="timing-sym" data-mark={mark.mark} x={x + 7} y={y + 7} textAnchor="middle" dominantBaseline="middle">{mark.mark}</text>
                  {bar.piece != null && <>
                    <rect className="timing-chip" x={x + 14} y={y + 1} width={12} height={12} rx={2} />
                    <text className="timing-sym" data-piece-num={bar.piece} x={x + 20} y={y + 7} textAnchor="middle" dominantBaseline="middle">{bar.piece}</text>
                  </>}
                </g>
              );
            })}
          </svg>
        </div>
      </div>
      <p id="timing-tip" className="timing-tip" data-timing-tip="" role="tooltip">
        {tip ? <>
          <span data-tip-name="">{tip.name}</span>
          <span data-tip-start="">시작 {formatMs(tip.startMs)}</span>
          <span data-tip-end="">끝 {tip.endMs == null ? '-' : formatMs(tip.endMs)}</span>
          <span data-tip-elapsed="">걸린 시간 {elapsedText(tip)}</span>
          <span data-tip-where="">{whereText(tip)}</span>
          {tip.piece != null && <span data-tip-piece="">개체 {tip.piece}</span>}
          <span>{barMark(tip).word}</span>
        </> : '막대에 초점을 주면 시간과 갈래가 나옵니다'}
      </p>
    </div>
  );
}
