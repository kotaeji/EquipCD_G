import { StatusMark } from './StatusMark';
import { Problem } from './Problem';
import { noticeBody, noticeClock, type NoticeItem } from './notices';
import './notices.css';

const KIND = {
  info: { status: 'pending' as const, word: '정보' },
  success: { status: 'done' as const, word: '성공' },
  reject: { status: 'error' as const, word: '거절' },
};

/** Newest first. The message node stays `.toast` so existing checks read the same words. */
export function NoticeStack({ items, onDismiss }: { items: NoticeItem[]; onDismiss: (id: number) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="toast-stack" data-toast-stack={items.length}>
      {items.map((item) => {
        const kind = KIND[item.kind];
        return (
          <div key={item.id} className="toast-card" data-toast-kind={item.kind} data-notice-id={item.id} role={item.kind === 'reject' ? 'alert' : 'status'}>
            <StatusMark status={kind.status} word={kind.word} />
            <div className={`toast${item.kind === 'reject' ? ' err' : ''}`}>{item.problem ? <Problem copy={item.problem} compact={!item.full} /> : item.text}</div>
            <button type="button" className="toast-x" aria-label="알림 닫기" onClick={() => onDismiss(item.id)}>×</button>
          </div>
        );
      })}
    </div>
  );
}

/** This session only. Closing the app drops the list. Nothing is written to storage. */
export function NoticeLog({ items, onClose }: { items: NoticeItem[]; onClose: () => void }) {
  return (
    <section className="notice-log" aria-label="알림 이력" data-notice-log="">
      <div className="notice-log-head">
        <b>알림</b>
        <button type="button" className="small" onClick={onClose}>닫기</button>
      </div>
      {items.length === 0
        ? <p className="notice-log-empty">이번 세션의 알림이 없습니다</p>
        : <ol>
          {items.map((item) => {
            const kind = KIND[item.kind];
            return (
              <li key={item.id} data-notice-kind={item.kind}>
                <time dateTime={new Date(item.at).toISOString()}>{noticeClock(item.at)}</time>
                <StatusMark status={kind.status} word={kind.word} />
                <span>{noticeBody(item)}</span>
              </li>
            );
          })}
        </ol>}
    </section>
  );
}
