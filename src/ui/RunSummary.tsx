import { useEffect, useRef } from 'react';
import { shownStepCondition } from '../model/conditionFormula';
import type { Project } from '../model/types';
import type { RuntimeState } from '../runtime/engine';
import { summarizeRun } from '../runtime/runSummary';
import { Fold } from './Fold';
import { Clip, ECD_TABLE } from './dataTable';
import { StatusMark } from './StatusMark';
import { phaseShape } from './status';
import './run-summary.css';

/** Same virtual-time text as `fmt` in Panels.tsx (`mm:ss.mmm`). */
const fmt = (msv: number) => `${String(Math.floor(msv / 60000)).padStart(2, '0')}:${(Math.floor(msv / 1000) % 60).toString().padStart(2, '0')}.${(msv % 1000).toString().padStart(3, '0')}`;

const dash = (ms: number | null) => (ms === null ? '-' : fmt(ms));

/** Shared row cue for a running, failed, or stopped step. Color is not the only difference. */
export function stepLiveClass(status: string): string {
  if (status === 'active') return 'step-row is-running';
  if (status === 'error') return 'step-row is-error';
  if (status === 'stopped') return 'step-row is-stopped';
  return 'step-row';
}

/** Station run summary. Embedded under 「자세히」; the fold is the standalone form. */
export function RunSummary({ p, rt, embedded = false, chartPick = null }: {
  p: Project;
  rt: RuntimeState | null;
  embedded?: boolean;
  /** Row chosen from the timing chart. The index is `summarizeRun().steps`. */
  chartPick?: number | null;
}) {
  // Before a run: no runtime, or no step has started. A log line that is not a step
  // (for example a sensor turning on) does not count as a start.
  const summary = rt ? summarizeRun(p, rt) : null;
  const notStarted = !summary || summary.steps.every((step) => step.startMs === null);
  const pickRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    const node = pickRef.current;
    const scroller = node?.closest('.run-summary-scroll');
    if (!node || !(scroller instanceof HTMLElement)) return;
    const top = node.offsetTop - scroller.clientHeight / 2;
    scroller.scrollTop = Math.max(0, top);
  }, [chartPick]);
  const body = notStarted || !summary ? <p className="run-summary-empty">실행하면 단계별 시간이 여기에 나옵니다</p> : (
        <>
          <p className="run-summary-head">
            {summary.aborted && <span className="run-summary-abort"><StatusMark status="error" />로 중단 </span>}
            총 {dash(summary.totalMs)} · {summary.finishedCount} / {summary.totalCount} 단계
            {summary.longest && <> · 가장 긴 단계 {summary.longest.name} {fmt(summary.longest.elapsedMs)}</>}
            {(summary.skippedCount > 0 || summary.stoppedCount > 0 || summary.steps.some((s) => (s.pass ?? 1) > 1 || s.lane)) && <> · 실행 {summary.executedCount} · 건너뜀 {summary.skippedCount}{summary.stoppedCount > 0 ? ` · 정지 ${summary.stoppedCount}` : ''}</>}
          </p>
          <div className="run-summary-scroll">
            <table className={`grid run-summary-table ${ECD_TABLE}`}>
              <thead>
                <tr><th>단계 이름</th><th>갈래 · 회차</th><th>상태</th><th className="ecd-num">시작</th><th className="ecd-num">끝</th><th className="ecd-num">걸린 시간</th></tr>
              </thead>
              <tbody>
                {summary.steps.map((step, i) => {
                  const longest = summary.longest?.stepId === step.stepId && summary.longest.elapsedMs === step.elapsedMs
                    && summary.steps.findIndex((s) => s.stepId === step.stepId && s.elapsedMs === step.elapsedMs) === i;
                  const cond = shownStepCondition(p, step.stepId) ?? (step.wait ? step.condText : '');
                  const where = [step.lane, step.pass != null ? `${step.pass}회` : '', cond].filter(Boolean).join(' · ');
                  const shape = step.wait && step.status === 'active' ? phaseShape('pending') : phaseShape(step.status);
                  const word = step.wait && step.status === 'active' ? '대기' : shape.word;
                  const tone = step.status === 'error' ? 'run-summary-error' : step.status === 'stopped' ? 'run-summary-stopped' : undefined;
                  return (
                    <tr key={`${step.stepId}:${i}`} ref={chartPick === i ? pickRef : undefined} className={`${stepLiveClass(step.status)}${longest ? ' is-longest' : ''}${chartPick === i ? ' is-chart-pick' : ''}`} data-step-id={step.stepId} data-chart-pick={chartPick === i ? '' : undefined}>
                      <td><Clip text={step.name} />{longest && <span className="run-summary-tag">가장 김</span>}{chartPick === i && <span className="run-summary-chart-tag">차트</span>}</td>
                      <td><Clip text={where || '—'} /></td>
                      <td><StatusMark status={shape.status} word={word} wordAttrs={tone ? { className: tone } : undefined} /></td>
                      <td className="mono ecd-num">{dash(step.startMs)}</td>
                      <td className="mono ecd-num">{dash(step.endMs)}</td>
                      <td className="mono ecd-num">{dash(step.elapsedMs)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="run-summary-note">가정 시간 기준 · 실제 택트가 아닙니다</p>
        </>
      );
  if (embedded) return <div className="run-summary is-embedded">{body}</div>;
  return <Fold className="run-summary" summary="실행 결과 요약">{body}</Fold>;
}
