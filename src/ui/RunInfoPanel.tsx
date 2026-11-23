import { useEffect, useRef, type RefObject } from 'react';
import { findAsset } from '../assets/library';
import { shownStepCondition } from '../model/conditionFormula';
import type { Project } from '../model/types';
import type { RuntimeState } from '../runtime/engine';
import { faultDeviceIds, activeDeviceIds } from '../scene/describe';
import { describeRunInfo, type RunInfoBar } from '../scene/runInfo';
import { stepStatusLabel } from '../runtime/runSummary';
import { stepLiveClass } from './RunSummary';
import { IconLabel } from './Icon';
import { StatusMark } from './StatusMark';
import { phaseShape, piecePhaseStatus, stationShape, type StatusKey } from './status';

/** How many running names stay on the strip before 「외 N」. */
const RUNNING_SHOWN = 2;
const SCROLL_HOLD_MS = 3000;

function deviceState(p: Project, rt: RuntimeState | null, deviceId: string): { status: StatusKey; word: string } {
  if (faultDeviceIds(p, rt).includes(deviceId)) return { status: 'error', word: '오류' };
  if (activeDeviceIds(p, rt).includes(deviceId)) return phaseShape('active');
  const records = (rt?.steps ?? []).filter((rec) => {
    const step = p.sequence.steps.find((s) => s.id === rec.stepId)
      ?? (p.substationSequences ?? []).flatMap((q) => q.steps).find((s) => s.id === rec.stepId);
    const action = step ? p.actions.find((a) => a.id === step.actionId) : undefined;
    return action?.deviceId === deviceId && rec.status !== 'pending';
  });
  const last = records[records.length - 1];
  if (!last) return phaseShape('pending');
  const shape = phaseShape(last.status);
  return { status: shape.status, word: stepStatusLabel(last.status) };
}

function barMark(bar: { status: string; statusLabel: string; stepId?: string; wait?: boolean; substationPaused?: boolean }, rt: RuntimeState | null): { status: StatusKey; word: string } {
  if (bar.statusLabel === '가정') return { status: 'assumption', word: '가정' };
  if (bar.substationPaused) return { status: 'assumption', word: '일시정지' };
  if (bar.wait && bar.status === 'active') return { status: 'pending', word: '대기' };
  const shape = phaseShape(bar.status);
  const blocked = rt?.error?.code === 'INTERLOCK_BLOCK' && bar.status === 'error'
    && (rt.error.stepId === bar.stepId || (rt.interlockBlocks ?? []).some((row) => row.stepId === bar.stepId));
  return { status: shape.status, word: blocked ? `${bar.statusLabel} · Interlock` : bar.statusLabel };
}

function runningText(row: { name: string; lane?: string }): string {
  return row.lane ? `${row.lane} · ${row.name}` : row.name;
}

function rowOutside(root: HTMLElement, row: HTMLElement): boolean {
  const box = root.getBoundingClientRect();
  const rect = row.getBoundingClientRect();
  if (box.height <= 0 || rect.height <= 0) return false;
  return rect.top < box.top - 1 || rect.bottom > box.bottom + 1;
}

/** Keep a running row in view unless the person scrolled this list in the last 3 seconds. */
function useFollowRunning(listRef: RefObject<HTMLElement | null>, token: string, active: boolean) {
  const holdUntil = useRef(0);
  const programmatic = useRef(false);
  useEffect(() => {
    const root = listRef.current;
    if (!root || !active) return;
    const onScroll = () => {
      if (programmatic.current) return;
      holdUntil.current = Date.now() + SCROLL_HOLD_MS;
    };
    root.addEventListener('scroll', onScroll);
    return () => root.removeEventListener('scroll', onScroll);
  }, [listRef, active]);
  useEffect(() => {
    const root = listRef.current;
    if (!root || !active || Date.now() < holdUntil.current) return;
    const rows = [...root.querySelectorAll<HTMLElement>('.step-row.is-running')];
    const target = [...rows].reverse().find((row) => rowOutside(root, row));
    if (!target || typeof target.scrollIntoView !== 'function') return;
    programmatic.current = true;
    target.scrollIntoView({ block: 'nearest' });
    queueMicrotask(() => { programmatic.current = false; });
  }, [token, active, listRef]);
}

/** Center strip above the canvas. The first lines of the old info column, on two rows. */
export function RunSummaryStrip({ p, rt, folded, onToggleFold, onOpenGaps }: {
  p: Project;
  rt: RuntimeState | null;
  folded: boolean;
  onToggleFold: () => void;
  onOpenGaps: () => void;
}) {
  const info = describeRunInfo(p, rt);
  const station = stationShape(info.status);
  const full = info.running.map(runningText).join(', ');
  const shown = info.running.slice(0, RUNNING_SHOWN).map(runningText).join(', ');
  const extra = info.running.length - RUNNING_SHOWN;
  const gapTitle = info.gapKinds.map((row) => `${row.label} ${row.count}`).join(' · ');
  return (
    <section className={`run-strip ${folded ? 'is-folded' : ''}`} aria-label="실행 요약">
      <div className="run-strip-row">
        {!folded && <span className="run-strip-id" title={`${info.projectName} · Unit ${info.unitCount} · Device ${info.deviceCount} · 단계 ${info.stepCount}`}><span data-project-name="">{info.projectName}</span> · U{info.unitCount} D{info.deviceCount} 단계{info.stepCount}</span>}
        <span className="run-strip-fixed">실행 상태 <StatusMark status={station.status} word={station.word} wordAttrs={{ 'data-run-status': info.status }} />{rt?.error?.code === 'INTERLOCK_BLOCK' && <b data-run-interlock=""> Interlock</b>}</span>
        <span className="run-strip-fixed">가상 시간 <b className="mono" data-run-time="">{info.timeText}</b></span>
        <span className="run-strip-running">실행 중 <b data-running-count={info.running.length} title={full || undefined}>{info.running.length === 0 ? '없음' : shown}{extra > 0 ? ` 외 ${extra}` : ''}</b></span>
        {!folded && <span className="run-strip-fixed" data-material="" data-fed={info.fedCount} data-exited={info.exitCount} data-feed-total={info.feedTotal}>자재 {info.materialText}</span>}
        <button type="button" className="small run-strip-fold" aria-label={folded ? '요약 펼치기' : '요약 접기'} onClick={onToggleFold}><IconLabel id={folded ? 'unfold' : 'fold'}>{folded ? '펼치기' : '접기'}</IconLabel></button>
      </div>
      {!folded && <div className="run-strip-row metrics">
        <span className="run-strip-fixed">사이클 <b className="mono" data-cycle-time="" aria-label="사이클 시간">{info.cycleText}</b>{info.metricBasis && <span data-metric-basis="">{info.metricBasis}</span>}</span>
        <span className="run-strip-fixed" title={info.throughputNote}>시간당 <b className="mono" data-throughput="" aria-label="시간당 생산량">{info.throughputText}</b> <span className="run-strip-tip" title={info.throughputNote}>ⓘ</span></span>
        {info.bottleneck
          ? <span className="run-strip-fixed" data-bottleneck={info.bottleneck.unitId} aria-label="병목 Unit">병목 {info.bottleneck.name} {info.bottleneck.timeText}</span>
          : <span className="run-strip-fixed muted">Unit 없음</span>}
        <span className="run-strip-fixed" data-gap-total={info.gapTotal} aria-label="Gap 건수" title={gapTitle}>Gap {info.gapTotal}건</span>
        <button type="button" className="small run3d-gap-open" aria-label="5단계에서 보기" onClick={onOpenGaps}>5단계에서 보기</button>
      </div>}
      <span className="run-strip-sr" data-throughput-note="">{info.throughputNote}</span>
      <span className="run-strip-sr run3d-gap-kinds">{info.gapKinds.map((row) => <span key={row.kind} data-gap-kind={row.kind} data-gap-count={row.count}>{row.label} {row.count}</span>)}</span>
    </section>
  );
}

function whereText(p: Project, bar: RunInfoBar): string {
  const cond = shownStepCondition(p, bar.stepId) ?? (bar.wait ? bar.condText : '');
  return [bar.lane, bar.pass != null ? `${bar.pass}회` : '', cond].filter(Boolean).join(' · ');
}

/** Left column: step times, unit totals, and the selected device. */
export function RunStepsPanel({ p, rt, selectedId, folded, onToggleFold, onPauseSubstation, onResumeSubstation }: {
  p: Project;
  rt: RuntimeState | null;
  selectedId: string | null;
  folded: boolean;
  onToggleFold: () => void;
  onPauseSubstation?: (nodeId: string) => void;
  onResumeSubstation?: (nodeId: string) => void;
}) {
  const info = describeRunInfo(p, rt);
  const listRef = useRef<HTMLUListElement>(null);
  const token = info.bars.filter((bar) => bar.status === 'active').map((bar) => bar.key).join('|');
  useFollowRunning(listRef, token, !folded);
  const maxMs = Math.max(1, ...info.bars.map((bar) => bar.widthMs));
  const unitMax = Math.max(1, ...info.unitTotals.map((row) => row.ms));
  const device = selectedId ? p.devices.find((d) => d.id === selectedId) : undefined;
  const unit = device ? p.units.find((u) => u.id === device.unitId) : undefined;
  return (
    <aside className={`run-steps ${folded ? 'is-folded' : ''}`} aria-label="단계">
      <div className="run3d-head">
        <h2>단계</h2>
        <button type="button" className="small" aria-label={folded ? '단계 펼치기' : '단계 접기'} onClick={onToggleFold}><IconLabel id={folded ? 'unfold' : 'fold'}>{folded ? '펼치기' : '접기'}</IconLabel></button>
      </div>
      {!folded && <>
        <section className="run-steps-main" aria-label="단계별 시간">
          <h3>단계별 시간</h3>
          {info.longestText && <p className="run3d-longest" data-longest="">{info.longestText}</p>}
          {info.pieceRows && info.pieceRows.length > 1 && <ul className="run3d-bars" aria-label="개체">
            {info.pieceRows.map((row) => (
              <li key={row.instanceId} className={row.phase === 'active' ? 'step-row is-running' : 'step-row'} data-piece={row.instanceId} data-piece-phase={row.phase}>
                <span className="run3d-bar-name">개체 {row.index}</span>
                <span className="run3d-bar-where">{row.stepName}</span>
                <span className="run3d-bar-status"><StatusMark status={piecePhaseStatus(row.phase)} word={row.statusLabel} wordAttrs={{ 'data-piece-status': '' }} /></span>
                <span className="run3d-bar-time">{row.note}</span>
              </li>
            ))}
          </ul>}
          {(rt?.pausedSubstations?.length ?? 0) > 0 && <p className="notice" data-sub-hold="">{`Substation ${rt!.pausedSubstations!.length}개 일시정지 중`}</p>}
          <ul className="run3d-bars run-steps-scroll" ref={listRef}>
            {info.bars.map((bar) => {
              const mark = barMark(bar, rt);
              const canToggle = rt?.status === 'running' && bar.substationNodeId && bar.status === 'active';
              return (
              <li key={bar.key} className={`${stepLiveClass(bar.substationPaused ? 'stopped' : bar.status)}${bar.longest ? ' is-longest' : ''}${bar.wait ? ' is-wait' : ''}`} data-step-id={bar.stepId} data-step-key={bar.key} data-elapsed={bar.timeText} data-wait={bar.wait ? 'true' : undefined} data-substation={bar.substationNodeId}>
                <span className="run3d-bar-name" title={bar.name}>{bar.name}</span>
                <span className="run3d-bar-where" data-lane={bar.lane ?? ''} data-pass={bar.pass != null ? String(bar.pass) : ''} data-step-cond="">{whereText(p, bar) || '—'}</span>
                <span className="run3d-bar-status"><StatusMark status={mark.status} word={mark.word} /></span>
                {canToggle && (bar.substationPaused
                  ? <button type="button" className="small" data-sub-resume={bar.substationNodeId} onClick={() => onResumeSubstation?.(bar.substationNodeId!)}>재개</button>
                  : <button type="button" className="small" data-sub-pause={bar.substationNodeId} onClick={() => onPauseSubstation?.(bar.substationNodeId!)}>이 Substation 일시정지</button>)}
                <span className="run3d-bar-track" aria-hidden="true"><span className="run3d-bar-fill" style={{ width: `${Math.min(100, (bar.widthMs / maxMs) * 100)}%` }} /></span>
                <span className="mono run3d-bar-time">{bar.timeText}</span>
              </li>
              );
            })}
          </ul>
        </section>
        <section className="run-steps-units" aria-label="Unit 별 합계">
          <h3>Unit 별 합계</h3>
          <ul className="run3d-bars units">
            {info.unitTotals.map((row) => (
              <li key={row.unitId} className={info.bottleneck?.unitId === row.unitId ? 'is-bottleneck' : ''} data-unit-total={row.unitId}>
                <span className="run3d-bar-name" title={row.name}>{row.name}{info.bottleneck?.unitId === row.unitId ? ' · 병목' : ''}</span>
                <span className="run3d-bar-track" aria-hidden="true"><span className="run3d-bar-fill" style={{ width: `${Math.min(100, (row.ms / unitMax) * 100)}%` }} /></span>
                <span className="mono run3d-bar-time">{row.timeText}</span>
              </li>
            ))}
          </ul>
        </section>
        <section aria-label="선택한 Device">
          <h3>선택한 Device</h3>
          {device
            ? <p data-selected-device="">{device.name} · {findAsset(device.kind)?.name ?? device.kind} · {unit?.name ?? device.unitId} · <StatusMark status={deviceState(p, rt, device.id).status} word={deviceState(p, rt, device.id).word} /></p>
            : <p className="muted">Device를 누르면 여기에 나옵니다</p>}
        </section>
        <p className="run3d-note">{info.assumed ? '실행 전 막대는 Action의 가정 동작 시간입니다. ' : ''}시간 · 속도는 가정값입니다. 실제 택트가 아닙니다.</p>
      </>}
    </aside>
  );
}
