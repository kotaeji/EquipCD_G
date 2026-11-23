import { useEffect, useId, useState } from 'react';
import type { ConfirmStamp } from '../model/confirmationLog';
import type { Quantity } from '../model/types';
import { useConfirmationGate } from './confirmationGate';
import './confirmation-log.css';
import { StatusMark } from './StatusMark';

/** Count units must be whole numbers. Time, length, weight, and other quantities may be decimal. None may be negative. */
export function quantityDraftError(raw: string, unit: string): string | null {
  const t = raw.trim();
  if (t === '') return null;
  if (t.startsWith('-')) return /^-(?:\d+(?:\.\d+)?|\.\d+)?$/.test(t) ? '음수는 허용되지 않습니다' : '숫자가 아닙니다';
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(t)) return '숫자가 아닙니다';
  const n = Number(t);
  if (!Number.isFinite(n)) return '숫자가 아닙니다';
  const u = unit.trim().toLowerCase();
  if ((u === 'ea' || u === '개' || u === 'count') && !Number.isInteger(n)) return '개수는 정수만 됩니다';
  return null;
}

/** Numeric quantity editor. Empty = 미정 (null). A bad draft stays on screen and is not written. */
export function QtyInput({ q, onCommit, disabled, title, note }: { q: Quantity; onCommit: (v: string, assumption: boolean, stamp?: ConfirmStamp) => void; disabled?: boolean; title?: string; note?: string | null }) {
  const gate = useConfirmationGate();
  const [v, setV] = useState(q.value === null ? '' : String(q.value));
  const [err, setErr] = useState<string | null>(null);
  const errId = useId();
  useEffect(() => setV(q.value === null ? '' : String(q.value)), [q.value]);
  const commit = (assumption = q.assumption) => {
    const next = quantityDraftError(v, q.unit);
    setErr(next);
    if (next) return;
    const cur = q.value === null ? '' : String(q.value);
    const send = (stamp?: ConfirmStamp) => {
      if (cur !== v.trim() || assumption !== q.assumption) onCommit(v.trim(), assumption, stamp);
    };
    if (assumption !== q.assumption) gate((stamp) => send(stamp));
    else send();
  };
  return (
    <span className="qty-field" title={title}>
      <span className={`qty${err ? ' is-error' : ''}`} data-unit={q.unit}>
        <input className="num" value={v} placeholder="미정" disabled={disabled} aria-invalid={err ? true : undefined} aria-describedby={err ? errId : undefined}
          onChange={(e) => { setV(e.target.value); setErr(quantityDraftError(e.target.value, q.unit)); }}
          onBlur={() => commit()} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        <span className="qty-unit">{q.unit}</span>
      </span>
      {err && <span className="qty-error" id={errId} role="alert">{err}</span>}
      <label className="qty-assume muted">
        <input type="checkbox" checked={q.assumption} disabled={disabled} onChange={(e) => commit(e.target.checked)} />
        {q.assumption ? <StatusMark status="assumption" /> : '가정'}
      </label>
      {q.value === null && !err && <StatusMark status="undetermined" />}
      {note && <span className="confirm-note" data-confirm-note>{note}</span>}
    </span>
  );
}

export function TextInput({ value, onCommit, disabled, width }: { value: string; onCommit: (v: string) => void; disabled?: boolean; width?: number }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <input value={v} disabled={disabled} style={{ width: width ?? 170 }} onChange={(e) => setV(e.target.value)} onBlur={() => { if (v !== value) onCommit(v); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
}

export function Badge({ kind, children }: { kind?: 'ok' | 'warn' | 'err' | 'acc'; children: React.ReactNode }) {
  return <span className={`badge ${kind ?? ''}`}>{children}</span>;
}
