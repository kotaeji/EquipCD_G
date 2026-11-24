import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProblemCopy } from './problemCopy';

/** Info fades on its own. A rejection stays until it is closed, or for this long. */
export const NOTICE_MS = 3000;
export const REJECT_MS = 8000;
export const NOTICE_STACK = 3;
export const NOTICE_LOG = 20;

export type NoticeKind = 'info' | 'success' | 'reject';

export interface NoticeAction {
  label: string;
  run: () => void;
}

export interface NoticeItem {
  id: number;
  kind: NoticeKind;
  at: number;
  deadline: number;
  text: string;
  problem?: ProblemCopy;
  full?: boolean;
  action?: NoticeAction;
}

export interface NoticeInput {
  kind: NoticeKind;
  text: string;
  problem?: ProblemCopy;
  full?: boolean;
  action?: NoticeAction;
}

/**
 * `say(msg, true)` and `sayProblem` are rejections.
 * A finished action (완료, 저장, 추가, …) is success. Anything else is info.
 * Call sites stay as they are. The words of the notice do not change.
 */
export function noticeKind(err: boolean, text: string): NoticeKind {
  if (err) return 'reject';
  if (/완료|저장|추가|복사|바꿨|만들었습니다|삭제했습니다|반영/.test(text)) return 'success';
  return 'info';
}

export function noticeClock(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function noticeBody(item: NoticeItem): string {
  if (!item.problem) return item.text;
  const how = item.full ? item.problem.how : '';
  return [item.problem.what, item.problem.why, how].filter(Boolean).join(' ');
}

export function useNotices() {
  const [live, setLive] = useState<NoticeItem[]>([]);
  const [log, setLog] = useState<NoticeItem[]>([]);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);
  const openRef = useRef(false);
  openRef.current = open;

  const push = useCallback((input: NoticeInput) => {
    const now = Date.now();
    const item: NoticeItem = {
      id: ++seq.current,
      kind: input.kind,
      at: now,
      deadline: now + (input.kind === 'reject' ? REJECT_MS : NOTICE_MS),
      text: input.text,
      problem: input.problem,
      full: input.full,
      action: input.action,
    };
    setLive((cur) => [item, ...cur].slice(0, NOTICE_STACK));
    setLog((cur) => [item, ...cur].slice(0, NOTICE_LOG));
  }, []);

  const dismiss = useCallback((id: number) => {
    setLive((cur) => cur.filter((item) => item.id !== id));
  }, []);

  useEffect(() => {
    if (live.length === 0) return;
    const timers = live.map((item) => window.setTimeout(() => dismiss(item.id), Math.max(0, item.deadline - Date.now())));
    return () => { for (const timer of timers) window.clearTimeout(timer); };
  }, [live, dismiss]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('.modal-bg')) return;
      if (openRef.current) { setOpen(false); return; }
      setLive((cur) => (cur.length ? cur.slice(1) : cur));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return { live, log, open, setOpen, push, dismiss };
}
