import { confirmationClock, sortedConfirmationLog, targetLive } from '../model/confirmationLog';
import type { ConfirmationEntry, Project } from '../model/types';
import { IconLabel } from './Icon';
import './confirmation-log.css';

export function ConfirmationLog({ p, onJump }: { p: Project; onJump: (entry: ConfirmationEntry) => void }) {
  const rows = sortedConfirmationLog(p.confirmationLog);
  return (
    <section className="sheet wide confirm-log" aria-label="확인 이력" data-confirmation-log>
      <h2>확인 이력</h2>
      <p className="muted">확인하거나 확인을 되돌린 기록입니다. 실행 취소하면 그 줄도 함께 사라집니다.</p>
      <table className="grid plain">
        <thead><tr><th>시각</th><th>확인자</th><th>대상</th><th>바뀐 내용</th></tr></thead>
        <tbody>
          {rows.map((e, i) => {
            const live = targetLive(p, e.target);
            return (
              <tr key={`${e.at}:${i}`} data-confirmation-at={e.at} data-confirmation-by={e.by} data-confirmation-live={live ? '1' : '0'}>
                <td title={e.at}>{confirmationClock(e.at)}</td>
                <td>{e.by}</td>
                <td>
                  {e.name}
                  {live
                    ? <button type="button" className="small" aria-label={`${e.name} 이동`} onClick={() => onJump(e)}><IconLabel id="jump">이동</IconLabel></button>
                    : <span className="confirm-gone" data-confirmation-gone>삭제됨</span>}
                </td>
                <td>{e.from} → {e.to}</td>
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={4}>확인 이력이 없습니다.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}
