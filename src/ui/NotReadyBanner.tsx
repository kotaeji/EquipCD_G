import './sparse-extra.css';

/** Same notice on screens that only explain a missing feature. Meaning is in the words. */
export function NotReadyBanner({ hint, purpose, instead, onInstead }: {
  hint?: string;
  /** What this screen is for, once it exists. */
  purpose?: string;
  /** What to use today. */
  instead?: string;
  onInstead?: () => void;
}) {
  return <div className="not-ready" role="note">
    <p className="not-ready-lead">준비 중 — 이 화면은 아직 동작하지 않습니다</p>
    {purpose ? <p className="not-ready-purpose" data-screen-purpose="">{purpose}</p> : null}
    {hint ? <p className="not-ready-hint">{hint}</p> : null}
    {instead ? <p className="not-ready-instead" data-screen-instead="">{instead}{onInstead && <button type="button" onClick={onInstead}>이동</button>}</p> : null}
  </div>;
}
