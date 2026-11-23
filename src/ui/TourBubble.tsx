// TURN-042 tour bubble. The page stays usable: there is no backdrop, and the bubble does not cover its anchor.
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { dialogOpen } from './WorkspacePanels';
import { placeTourBubble, TOUR_STEPS, type TourStep } from './tour';

export function TourBubble({ step, onPrev, onNext, onSkip, onRestore }: {
  step: TourStep;
  onPrev: () => void;
  onNext: () => void;
  onSkip: () => void;
  /** Called once, when the bubble unmounts. Restores focus to the control that opened the tour. */
  onRestore: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const placeRef = useRef({ top: 8, left: 8 });
  const restoreRef = useRef(onRestore);
  restoreRef.current = onRestore;
  const index = TOUR_STEPS.indexOf(step);
  const total = TOUR_STEPS.length;
  const atStart = index <= 0;
  const atEnd = index === total - 1;

  useLayoutEffect(() => {
    const node = box.current;
    if (!node) return;
    const place = () => {
      const anchor = document.querySelector(step.anchor);
      document.querySelectorAll('.tour-target').forEach((el) => { if (el !== anchor) el.classList.remove('tour-target'); });
      anchor?.classList.add('tour-target');
      const rect = anchor?.getBoundingClientRect();
      const bubble = node.getBoundingClientRect();
      const pos = placeTourBubble(
        { x: rect?.left ?? 0, y: rect?.top ?? 0, w: rect?.width ?? 0, h: rect?.height ?? 0 },
        { w: bubble.width || 320, h: bubble.height || 188 },
        { w: window.innerWidth, h: window.innerHeight },
      );
      placeRef.current = pos;
      node.style.top = `${pos.top}px`;
      node.style.left = `${pos.left}px`;
    };
    place();
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('resize', place);
      document.querySelectorAll('.tour-target').forEach((el) => el.classList.remove('tour-target'));
    };
  }, [step]);

  useLayoutEffect(() => {
    box.current?.focus();
  }, [step]);

  useLayoutEffect(() => () => { restoreRef.current(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (dialogOpen()) return;
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
      if (typing && !box.current?.contains(t)) return;
      e.preventDefault();
      e.stopPropagation();
      onSkip();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onSkip]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); onNext(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); if (!atStart) onPrev(); }
  };

  return (
    <div
      ref={box}
      className="tour-pop"
      role="dialog"
      aria-modal="false"
      aria-labelledby="tour-title"
      aria-describedby="tour-body"
      tabIndex={-1}
      data-tour-pop
      data-tour-step={step.id}
      style={{ top: placeRef.current.top, left: placeRef.current.left }}
      onKeyDown={onKeyDown}
    >
      <h2 id="tour-title">{step.title}</h2>
      <p id="tour-body">{step.body}</p>
      <div className="tour-nav">
        <button type="button" onClick={onPrev} disabled={atStart}>이전</button>
        <button type="button" className="primary" onClick={onNext}>{atEnd ? '끝내기' : '다음'}</button>
        <button type="button" onClick={onSkip}>건너뛰기</button>
        <span className="tour-count">{index + 1} / {total}</span>
      </div>
      <p className="tour-keys">← → 이동 · Esc 건너뛰기</p>
    </div>
  );
}
