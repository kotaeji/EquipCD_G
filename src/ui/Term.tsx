// Dotted glossary mark for titles, tab names, the step bar, and table headers.
// The tip is portaled so a button's textContent stays the original label.
import { createContext, useContext, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { GLOSSARY, splitTerms, type TermId } from './glossary';
import { nextTermTipPos, placeTermTip, type TermTipPos } from './termPlace';
import './term.css';

const TermHints = createContext(true);

export function TermHintsProvider({ value, children }: { value: boolean; children: ReactNode }) {
  return <TermHints.Provider value={value}>{children}</TermHints.Provider>;
}

const EMPTY_POS: TermTipPos = { top: 0, left: 0, bg: '', fg: '', border: '' };

function visibleAnchor(node: HTMLElement | null): node is HTMLElement {
  return !!node && node.isConnected && !node.closest('[hidden]');
}

function measureTerm(node: HTMLElement): TermTipPos | null {
  const rect = node.getBoundingClientRect();
  const app = node.closest('.app');
  const cs = app ? getComputedStyle(app) : null;
  return placeTermTip(
    { left: rect.left, bottom: rect.bottom },
    window.innerWidth,
    {
      bg: cs?.getPropertyValue('--panel').trim() || '',
      fg: cs?.getPropertyValue('--text').trim() || '',
      border: cs?.getPropertyValue('--border').trim() || '',
    },
  );
}

function TermMark({ id, text }: { id: TermId; text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const tipId = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<TermTipPos>(EMPTY_POS);
  // Last place we published. A layout replay can hand setState the initial
  // object again; comparing here stops that from scheduling another render.
  const posRef = useRef(pos);
  const place = () => {
    const node = ref.current;
    if (!visibleAnchor(node)) {
      setOpen(false);
      return;
    }
    const resolved = nextTermTipPos(posRef.current, measureTerm(node));
    if (resolved === posRef.current) return;
    posRef.current = resolved;
    setPos(resolved);
  };
  const placeRef = useRef(place);
  placeRef.current = place;

  useLayoutEffect(() => {
    if (!open) return;
    placeRef.current();
    const onMove = () => placeRef.current();
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    const node = ref.current;
    const observer = node && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onMove) : null;
    if (node && observer) observer.observe(node);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
      observer?.disconnect();
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    if (!visibleAnchor(ref.current)) setOpen(false);
  });

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
