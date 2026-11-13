import type { Project } from '../model/types';
import type { RuntimeState } from '../runtime/engine';
import { summarizeRun, type RunStepPhase } from '../runtime/runSummary';
import { Fold } from './Fold';
import './run-summary.css';

/** Same virtual-time text as `fmt` in Panels.tsx (`mm:ss.mmm`). */
const fmt = (msv: number) => `${String(Math.floor(msv / 60000)).padStart(2, '0')}:${(Math.floor(msv / 1000) % 60).toString().padStart(2, '0')}.${(msv % 1000).toString().padStart(3, '0')}`;

const STATUS_LABEL: Record<RunStepPhase, string> = {
  pending: '대기',
  active: '진행 중',
  done: '완료',
  error: '오류',
};

const dash = (ms: number | null) => (ms === null ? '-' : fmt(ms));

/** Station run summary, placed above the runtime log table. Starts expanded. */
export function RunSummary({ p, rt }: { p: Project; rt: RuntimeState | null }) {
  const empty = !rt || rt.log.length === 0;
  const summary = empty ? null : summarizeRun(p, rt);
  return (
    <Fold className="run-summary" summary="실행 결과 요약">
      {empty || !summary ? <p className="run-summary-empty">실행하면 단계별 시간이 여기에 나옵니다</p> : (
        <>
          <p className="run-summary-head">
            {summary.aborted && <span className="run-summary-abort">오류로 중단 </span>}
            총 {dash(summary.totalMs)} · {summary.finishedCount} / {summary.totalCount} 단계
            {summary.longest && <> · 가장 긴 단계 {summary.longest.name} {fmt(summary.longest.elapsedMs)}</>}
          </p>
          <div className="run-summary-scroll">
            <table className="grid run-summary-table">
              <thead>
                <tr><th>단계 이름</th><th>상태</th><th>시작</th><th>끝</th><th>걸린 시간</th></tr>
              </thead>
              <tbody>
                {summary.steps.map((step) => {
                  const longest = summary.longest?.stepId === step.stepId;
                  return (
                    <tr key={step.stepId} className={longest ? 'is-longest' : undefined} data-step-id={step.stepId}>
                      <td>{step.name}{longest && <span className="run-summary-tag">가장 김</span>}</td>
                      <td className={step.status === 'error' ? 'run-summary-error' : undefined}>{STATUS_LABEL[step.status]}</td>
                      <td className="mono">{dash(step.startMs)}</td>
                      <td className="mono">{dash(step.endMs)}</td>
                      <td className="mono">{dash(step.elapsedMs)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="run-summary-note">가정 시간 기준 · 실제 택트가 아닙니다</p>
        </>
      )}
    </Fold>
  );
}
