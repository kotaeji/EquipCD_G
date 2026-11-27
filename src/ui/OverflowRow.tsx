// TURN-085. Same idea as the header 「더 보기」: the tail leaves the row when it does not fit.
import { Children, Fragment, cloneElement, isValidElement, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ContextMenu } from './ContextMenu';
import { IconLabel } from './Icon';
import './overflow-row.css';

const MORE_PX = 96;

function same(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((n, i) => n === b[i]);
}

function labelOf(el: HTMLElement): string {
  const btn = el.matches('button') ? el : el.querySelector('button');
  const raw = btn?.getAttribute('aria-label') || btn?.textContent || el.textContent || '';
  return raw.replace(/\s+/g, ' ').trim();
}

function press(el: HTMLElement) {
  const btn = el.matches('button') ? el : el.querySelector('button');
  (btn ?? el).dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function tailThatOverflows(nodes: HTMLElement[], limit: number): number[] {
  const widths = nodes.map((n) => Math.ceil(n.getBoundingClientRect().width));
  const gap = 8;
  const used = (hide: number[]) => widths.reduce((sum, w, i) => (hide.includes(i) || nodes[i].hasAttribute('data-overflow-keep') ? sum : sum + w + gap), 0);
  if (used([]) <= limit) return [];
  const hide: number[] = [];
  for (let i = nodes.length - 1; i >= 1 && used(hide) + MORE_PX > limit; i--) {
    if (nodes[i].hasAttribute('data-overflow-keep')) continue;
    hide.unshift(i);
  }
  return hide;
}

/** A fragment variable is one child to React.Children. Split it so each control can leave the row on its own. */
function flatChildren(children: ReactNode): ReactNode[] {
  const out: ReactNode[] = [];
  const walk = (node: ReactNode) => {
    Children.forEach(node, (child) => {
      if (isValidElement(child) && child.type === Fragment) walk((child.props as { children?: ReactNode }).children);
      else if (child != null && typeof child !== 'boolean') out.push(child);
    });
  };
  walk(children);
  return out;
}

/** Direct children stay direct children so `> button` rules keep matching. */
export function OverflowRow({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [hidden, setHidden] = useState<number[]>([]);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const items = flatChildren(children);
  const measuring = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      if (measuring.current) return;
      measuring.current = true;
      try {
        const nodes = [...el.querySelectorAll<HTMLElement>(':scope > [data-overflow-item]')];
        if (el.clientWidth <= 0 || nodes.length === 0 || nodes.every((n) => n.getBoundingClientRect().width === 0)) {
          setHidden((cur) => (cur.length ? [] : cur));
          return;
        }
        nodes.forEach((n) => n.classList.remove('is-overflow'));
        let hide = tailThatOverflows(nodes, el.clientWidth);
        const paint = (list: number[]) => {
          nodes.forEach((n, i) => n.classList.toggle('is-overflow', list.includes(i)));
        };
        paint(hide);
        let guard = 0;
        while (el.scrollWidth > el.clientWidth + 1 && guard < nodes.length) {
          const extra = [...nodes.keys()].reverse().find((i) => i > 0 && !hide.includes(i) && !nodes[i].hasAttribute('data-overflow-keep'));
          if (extra == null) break;
          hide = [...hide, extra].sort((a, b) => a - b);
          paint(hide);
          guard += 1;
        }
        setHidden((cur) => (same(cur, hide) ? cur : hide));
      } finally { measuring.current = false; }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [items.length, hidden.length]);

  const tagged = items.map((child, i) => {
    const off = hidden.includes(i);
    const host = isValidElement(child) && typeof child.type === 'string';
    if (!host) {
      return <div key={i} data-overflow-item={String(i)} className={off ? 'is-overflow' : undefined}>{child}</div>;
    }
    const prev = (child.props as { className?: string }).className ?? '';
    return cloneElement(child as ReactElement<{ className?: string; 'data-overflow-item'?: string }>, {
      key: i,
      'data-overflow-item': String(i),
      className: off ? `${prev} is-overflow`.trim() : prev,
    });
  });

  const menuItems = hidden.flatMap((i) => {
    const node = ref.current?.querySelector<HTMLElement>(`[data-overflow-item="${i}"]`);
    if (!node) return [];
    const label = labelOf(node);
    return label ? [{ id: `tool-${i}`, label }] : [];
  });

  return (
    <div ref={ref} className={className ? `overflow-row ${className}` : 'overflow-row'}>
      {tagged}
      {hidden.length > 0 && (
        <button
          type="button"
          ref={moreRef}
          data-overflow-more=""
          className="btn-main secondary"
          aria-label="더 보기"
          aria-haspopup="menu"
          aria-expanded={menuAt !== null}
          onClick={(e) => {
            if (menuAt) { setMenuAt(null); return; }
            const r = e.currentTarget.getBoundingClientRect();
            setMenuAt({ x: r.left, y: r.bottom });
          }}
        >
          <IconLabel id="object-more">더 보기</IconLabel>
        </button>
      )}
      {menuAt && menuItems.length > 0 && createPortal(
        <ContextMenu
          x={menuAt.x}
          y={menuAt.y}
          kind="tool"
          menuLabel="더 보기"
          items={menuItems}
          returnFocus={moreRef.current}
          anchor={moreRef.current}
          onRun={(id) => {
            const i = Number(id.slice('tool-'.length));
            const node = ref.current?.querySelector<HTMLElement>(`[data-overflow-item="${i}"]`);
            setMenuAt(null);
            if (node) press(node);
          }}
          onClose={() => setMenuAt(null)}
        />,
        document.body,
      )}
    </div>
  );
}
