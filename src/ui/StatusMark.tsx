import type { HTMLAttributes } from 'react';
import { STATUS, type StatusKey } from './status';

/** Shared status chip: mark + word + the status color variable. */
export function StatusMark({ status, word, compact, wordAttrs }: {
  status: StatusKey;
  /** Override when the word is kept (건너뜀, 정지, 실행 중, …). */
  word?: string;
  /** Narrow row: the mark is visible and the word is the accessible name. */
  compact?: boolean;
  wordAttrs?: HTMLAttributes<HTMLSpanElement> & Record<string, string | undefined>;
}) {
  const def = STATUS[status];
  const label = word ?? def.word;
  const { className: wordClass, ...rest } = wordAttrs ?? {};
  return (
    <span className={`status-mark status-${status}${compact ? ' is-compact' : ''}`} data-status={status} title={label} aria-label={compact ? label : undefined}>
      <span className="status-sym" aria-hidden="true">{def.mark}</span>
      <span className={`status-word${wordClass ? ` ${wordClass}` : ''}`} aria-hidden={compact ? true : undefined} {...rest}>{label}</span>
    </span>
  );
}
