import './sparse-extra.css';

/** Same notice on screens that only explain a missing feature. Meaning is in the words. */
export function NotReadyBanner({ hint }: { hint?: string }) {
  return <div className="not-ready" role="note">
    <p className="not-ready-lead">준비 중 — 이 화면은 아직 동작하지 않습니다</p>
    {hint ? <p className="not-ready-hint">{hint}</p> : null}
  </div>;
}
