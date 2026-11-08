import { useEffect, useState } from 'react';
import type { Quantity } from '../model/types';

/** Numeric quantity editor. Empty = 미정 (null). Commits on blur / Enter. */
export function QtyInput({ q, onCommit, disabled, title }: { q: Quantity; onCommit: (v: string, assumption: boolean) => void; disabled?: boolean; title?: string }) {
  const [v, setV] = useState(q.value === null ? '' : String(q.value));
  useEffect(() => setV(q.value === null ? '' : String(q.value)), [q.value]);
  const commit = () => { if ((q.value === null ? '' : String(q.value)) !== v) onCommit(v, q.assumption); };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title={title}>
      <input className="num" value={v} placeholder="미정" disabled={disabled} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      <span className="muted mono" style={{ minWidth: 30 }}>{q.unit}</span>
      <label style={{ width: 'auto', display: 'inline-flex', gap: 2, alignItems: 'center', fontSize: 11 }} className="muted">
        <input type="checkbox" checked={q.assumption} disabled={disabled} onChange={(e) => onCommit(v, e.target.checked)} />가정
      </label>
      {q.value === null && <span className="badge warn">미정</span>}
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
