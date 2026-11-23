import { useEffect, useState, type ButtonHTMLAttributes } from 'react';

type ButtonExtra = ButtonHTMLAttributes<HTMLButtonElement> & Record<`data-${string}`, string | undefined>;

export interface EmptyButton {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  reason?: string;
  attrs?: ButtonExtra;
}

/** Shared empty list: a mark, one line, and the next action. */
export function EmptyState({ symbol = '○', line, actions = [], attrs }: {
  symbol?: string;
  line: string;
  actions?: EmptyButton[];
  attrs?: Record<string, string>;
}) {
  return (
    <div className="empty-state" data-empty="" role="status" {...attrs}>
      <span className="empty-mark" aria-hidden="true">{symbol}</span>
      <p className="empty-line">{line}</p>
      {actions.length > 0 && (
        <div className="empty-actions">
          {actions.map((a) => (
            <button key={a.label} type="button" disabled={a.disabled} title={a.disabled ? a.reason : undefined} onClick={a.onClick} {...a.attrs}>{a.label}</button>
          ))}
        </div>
      )}
      {actions.filter((a) => a.disabled && a.reason).map((a) => <p key={`${a.label}-why`} className="empty-reason">{a.reason}</p>)}
    </div>
  );
}

/** Wait a moment before showing, so a fast load does not flash. */
export const LOADING_DELAY_MS = 150;

export function LoadingPlaceholder({ label }: { label: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setShown(true), LOADING_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);
  if (!shown) return <div className="loading-hold" data-loading="wait" hidden />;
  return <div className="loading-hold is-shown" data-loading="shown" role="status">{label}</div>;
}

/** 3D boot and large-file import share this hold. Children stay mounted so the scene can finish. */
export function BootGate({ ready, label, children }: { ready: boolean; label: string; children: React.ReactNode }) {
  return (
    <div className="boot-gate" data-boot={ready ? 'ready' : 'pending'}>
      {!ready && <LoadingPlaceholder label={label} />}
      <div className={ready ? undefined : 'boot-pending'}>{children}</div>
    </div>
  );
}
