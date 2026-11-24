import { useEffect, useState } from 'react';
import { materialMark, mixActive } from '../model/materialMix';
import type { Project } from '../model/types';
import type { RuntimeState } from '../runtime/engine';
import type { InterlockBlockRecord } from '../runtime/interlock';
import { formatMs } from '../scene/runInfo';
import { fmtTime } from './Panels';
import { RunReportMenu } from './RunReportMenu';
import { RunSummary } from './RunSummary';
import { TimingChart } from './TimingChart';
import { EmptyState } from './EmptyState';
import { Problem } from './Problem';
import { runBlockFormula } from '../model/conditionFormula';
import { EMPTY, runErrorProblem } from './problemCopy';
import { IconLabel } from './Icon';
import { StatusMark } from './StatusMark';
import { piecePhaseStatus } from './status';
import { Tabs } from './Tabs';
import type { RunDetailsTab } from './viewSettings';
import { Terms } from './Term';

function RunLog({ rt, scrubMs, onRun, runDisabled, runReason }: {
  rt: RuntimeState | null;
  scrubMs?: number | null;
  onRun?: () => void;
  runDisabled?: boolean;
  runReason?: string;
}) {
  const rows = [...(rt?.log ?? [])].reverse();
  const scrubbing = scrubMs != null;
  return (
    <div className="log-list" aria-label="실행 로그">
      <table className="grid">
        <thead><tr><th>가상 시각</th><th>코드</th><th>내용</th></tr></thead>
        <tbody>
          {rows.map((line, i) => {
            const live = !scrubbing || line.t <= scrubMs;
            const weight = scrubbing ? (live ? 'is-scrub-now' : 'is-scrub-later') : '';
            return <tr key={i} className={`${line.level === 'error' ? 'err' : ''} ${weight}`.trim()} data-log-t={line.t} data-log-weight={scrubbing ? (live ? 'bold' : 'dim') : undefined}>
              <td className="mono">{fmtTime(line.t)}</td>
              <td className="mono">{line.code}</td>
              <td>{line.message}</td>
            </tr>;
          })}
          {rows.length === 0 && <tr><td colSpan={3}><EmptyState symbol="○" line={EMPTY.log} actions={[{ label: '실행', onClick: onRun, disabled: runDisabled, reason: runReason }]} /></td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function PieceTable({ p, rt }: { p: Project; rt: RuntimeState | null }) {
  const rows = rt?.pieces ?? [];
  if (rows.length < 2) return null;
  const now = rt?.timeMs ?? 0;
  const mixed = mixActive(p);
  return (
    <table className="grid" aria-label="개체별 시간">
      <thead><tr><th>개체</th>{mixed && <th>종류</th>}<th>투입 시각</th><th>배출 시각</th><th>기다린 시간</th><th>상태</th></tr></thead>
      <tbody>
        {rows.map((pc) => {
          const open = pc.wait ? Math.max(0, now - pc.wait.sinceMs) : 0;
          return (
            <tr key={pc.instanceId} data-piece-row={pc.instanceId}>
              <td>개체 {pc.index}</td>
              {mixed && <td data-piece-kind={materialMark(p, pc.material.materialId)}>{materialMark(p, pc.material.materialId)}</td>}
              <td className="mono">{pc.fedAtMs == null ? '-' : formatMs(pc.fedAtMs)}</td>
              <td className="mono">{pc.exitedAtMs == null ? '-' : formatMs(pc.exitedAtMs)}</td>
              <td className="mono" data-piece-wait="">{formatMs(pc.waitMs + open)}</td>
              <td><StatusMark status={piecePhaseStatus(pc.phase)} />{pc.wait ? ` · ${pc.wait.note}` : ''}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function InterlockHistory({ rows, onJump }: { rows: InterlockBlockRecord[]; onJump?: (id: string) => void }) {
  if (!rows.length) return null;
  return (
    <table className="grid" aria-label="Interlock 차단 이력">
      <thead><tr><th>가상 시각</th><th><Terms text="Interlock" /></th><th>단계</th><th>까닭</th><th></th></tr></thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={`${row.interlockId}:${row.t}:${i}`} data-interlock-block={row.interlockId}>
            <td className="mono">{fmtTime(row.t)}</td>
            <td>{row.interlockId} {row.description}</td>
            <td>{row.stepName}</td>
            <td>{row.reason}</td>
            <td>{onJump && <button type="button" className="small" onClick={() => onJump(row.interlockId)}>이동</button>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RunSignals({ p, rt }: { p: Project; rt: RuntimeState | null }) {
  return (
    <table className="grid" aria-label="신호 상태">
      <thead><tr><th><Terms text="신호" /></th><th>상태</th></tr></thead>
      <tbody>
        {p.signals.map((signal) => <tr key={signal.id} data-signal={signal.id}>
          <td>{signal.name}</td>
          <td>{rt?.signals[signal.id] ? 'ON' : 'OFF'}</td>
        </tr>)}
        {p.signals.length === 0 && <tr><td colSpan={2} className="muted">신호 없음</td></tr>}
      </tbody>
    </table>
  );
}

/** Collapsed by default under the canvas. Summary, the full log, and signal state. */
export function RunDetails({ p, rt, open, tab, onToggle, onTab, onJumpInterlock, onRun, runDisabled, runReason, onJumpError, logRt, scrubMs, chartRt }: {
  p: Project;
  rt: RuntimeState | null;
  open: boolean;
  tab: RunDetailsTab;
  onToggle: () => void;
  onTab: (id: RunDetailsTab) => void;
  onJumpInterlock?: (id: string) => void;
  onRun?: () => void;
  runDisabled?: boolean;
  runReason?: string;
  onJumpError?: () => void;
  /** Full finished log while scrubbing. Absent means `rt` is the log. */
  logRt?: RuntimeState | null;
  /** Set while looking at an earlier instant. Log rows at or before this time are bold. */
  scrubMs?: number | null;
  /** Finished run for the timing chart, so later bars stay put and only the now line moves. */
  chartRt?: RuntimeState | null;
}) {
  const [chartPick, setChartPick] = useState<number | null>(null);
  const started = !!rt?.steps.some((rec) => rec.startMs != null && rec.status !== 'skipped' && rec.status !== 'pending');
  useEffect(() => { if (!started) setChartPick(null); }, [started]);
  const logState = logRt ?? rt;
  const last = scrubMs == null
    ? (logState?.log?.length ? logState.log[logState.log.length - 1] : null)
    : [...(logState?.log ?? [])].reverse().find((line) => line.t <= scrubMs) ?? null;
  const lastLine = last ? `${fmtTime(last.t)} ${last.code} ${last.message}` : '로그 없음';
  return (
    <section className={`run-details${open ? ' is-open' : ''}${open && tab === 'timing' ? ' is-timing' : ''}`} aria-label="자세히">
      <div className="run-details-head">
        <button type="button" className="small" aria-expanded={open} aria-label={open ? '자세히 접기' : '자세히 펼치기'} onClick={onToggle}><IconLabel id={open ? 'fold' : 'unfold'}>자세히</IconLabel></button>
        {!open && <span className="run-details-last" title={lastLine}>{lastLine}</span>}
      </div>
      {open && <div className="run-details-body">
        {rt?.error && (() => {
          const phrase = runBlockFormula(p, rt.error.code, rt.error.stepId);
          const copy = runErrorProblem(rt.error.code, rt.error.message, null, phrase);
          return copy ? <Problem copy={{ ...copy, jump: onJumpError ? copy.jump : undefined }} onJump={onJumpError} /> : null;
        })()}
        <InterlockHistory rows={rt?.interlockBlocks ?? []} onJump={onJumpInterlock} />
        <PieceTable p={p} rt={rt} />
        <Tabs label="자세히" idBase="run-detail" value={tab} onChange={onTab} tabs={[
          { id: 'summary', label: '실행 결과 요약', icon: 'run-summary', panel: <><RunReportMenu p={p} rt={rt} /><RunSummary p={p} rt={rt} embedded chartPick={started ? chartPick : null} /></> },
          { id: 'timing', label: '타이밍 차트', icon: 'run-timing', panel: <TimingChart p={p} rt={chartRt ?? rt} nowMs={scrubMs == null ? undefined : scrubMs} onPick={(index) => { setChartPick(index); onTab('summary'); }} onRun={onRun} runDisabled={runDisabled} runReason={runReason} /> },
          { id: 'log', label: '실행 로그', icon: 'run-log', panel: <RunLog rt={logState} scrubMs={scrubMs} onRun={onRun} runDisabled={runDisabled} runReason={runReason} /> },
          { id: 'signals', label: '신호', icon: 'run-signals', panel: <RunSignals p={p} rt={rt} /> },
        ]} />
      </div>}
    </section>
  );
}
