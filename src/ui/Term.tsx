// Dotted glossary mark for titles, tab names, the step bar, and table headers.
// The tip is portaled so a button's textContent stays the original label.
import { createContext, useContext, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { GLOSSARY, splitTerms, type TermId } from './glossary';
import './term.css';

const TermHints = createContext(true);

export function TermHintsProvider({ value, children }: { value: boolean; children: ReactNode }) {
  return <TermHints.Provider value={value}>{children}</TermHints.Provider>;
}

function TermMark({ id, text }: { id: TermId; text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const tipId = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, bg: '', fg: '', border: '' });
  const place = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const width = 280;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const top = r.bottom + 4;
    const app = ref.current?.closest('.app');
    const cs = app ? getComputedStyle(app) : null;
    const bg = cs?.getPropertyValue('--panel').trim() || '';
    const fg = cs?.getPropertyValue('--text').trim() || '';
    const border = cs?.getPropertyValue('--border').trim() || '';
    setPos((p) => (p.top === top && p.left === left && p.bg === bg && p.fg === fg && p.border === border ? p : { top, left, bg, fg, border }));
  };
  useLayoutEffect(() => { if (open) place(); });
  return (
    <>
      <span
        ref={ref}
        className="ecd-term"
        data-term={id}
        tabIndex={0}
        aria-describedby={open ? tipId : undefined}
        onMouseEnter={() => { place(); setOpen(true); }}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => { place(); setOpen(true); }}
        onBlur={() => setOpen(false)}
      >{text}</span>
      {open && createPortal(
        <span id={tipId} role="tooltip" className="ecd-term-tip" data-term-tip={id} style={{ top: pos.top, left: pos.left, background: pos.bg || undefined, color: pos.fg || undefined, borderColor: pos.border || undefined }}>{GLOSSARY[id].line}</span>,
        document.body,
      )}
    </>
  );
}

/** Underline glossary words in a label. With hints off, the string is unchanged and has no tip. */
export function Terms({ text }: { text: string }) {
  const on = useContext(TermHints);
  if (!on) return <>{text}</>;
  const parts = splitTerms(text);
  if (!parts.some((p) => p.id)) return <>{text}</>;
  return <>{parts.map((p, i) => (p.id ? <TermMark key={i} id={p.id} text={p.text} /> : <span key={i}>{p.text}</span>))}</>;
}
