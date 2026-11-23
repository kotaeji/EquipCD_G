import { useEffect, useRef, useState } from 'react';
import { clampMenu, MENU_WIDTH, menuHeight } from './contextMenuModel';
import { IconLabel } from './Icon';
import { menuIconId } from './icons';

interface MenuEntry<A extends string> {
  id: A;
  label: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  reason?: string;
  separatorBefore?: boolean;
}

interface Props<A extends string> {
  x: number;
  y: number;
  kind: string;
  items: readonly MenuEntry<A>[];
  returnFocus: HTMLElement | null;
  /** A press on this element does not dismiss the menu, so its button can toggle. */
  anchor?: HTMLElement | null;
  menuLabel?: string;
  onRun: (id: A) => void;
  onClose: () => void;
}

/** Command menu. Arrow keys move, Enter runs, Esc and an outside press close. Focus returns on dismiss. */
export function ContextMenu<A extends string>({ x, y, kind, items, returnFocus, anchor, menuLabel = '명령', onRun, onClose }: Props<A>) {
  const ref = useRef<HTMLDivElement>(null);
  const acted = useRef(false);
  const estimated = menuHeight(items);
  const view = () => ({ w: window.innerWidth || 1280, h: window.innerHeight || 800 });
  const [box, setBox] = useState(() => clampMenu(x, y, MENU_WIDTH, estimated, view().w, view().h));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const w = r.width > 0 ? r.width : MENU_WIDTH;
    const h = r.height > 0 ? r.height : estimated;
    const next = clampMenu(x, y, w, h, view().w, view().h);
    setBox((prev) => (prev.left === next.left && prev.top === next.top ? prev : next));
    el.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [x, y, estimated, items]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const root = ref.current;
      if (!root) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      const buttons = [...root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        if (!buttons.length) return;
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === 'ArrowDown' ? (i + 1) % buttons.length : (i - 1 + buttons.length) % buttons.length;
        buttons[next]?.focus();
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        const fromTarget = (e.target as HTMLElement | null)?.closest?.('button[role="menuitem"]') as HTMLButtonElement | null;
        const focused = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
        const btn = fromTarget ?? focused;
        if (!btn || btn.disabled || !root.contains(btn) || btn.getAttribute('role') !== 'menuitem') return;
        e.preventDefault();
        e.stopPropagation();
        acted.current = true;
        btn.click();
      }
    };
    const onPtr = (e: PointerEvent) => {
      const root = ref.current;
      if (!root) return;
      if (e.button !== 0) return;
      if (root.contains(e.target as Node)) return;
      if (anchor && anchor.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPtr, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPtr, true);
      if (!acted.current) returnFocus?.focus();
    };
  }, [onClose, returnFocus, anchor]);

  return (
    <div
      ref={ref}
      className="ctx-menu"
      role="menu"
      data-ctx-menu
      data-ctx-kind={kind}
      aria-label={menuLabel}
      style={{ left: box.left, top: box.top }}
    >
      {items.map((item) => (
        <div key={item.id} className="ctx-row">
          {item.separatorBefore && <hr role="separator" />}
          <button
            type="button"
            role="menuitem"
            data-action={item.id}
            className={item.danger ? 'danger' : undefined}
            disabled={item.disabled}
            title={item.reason}
            onClick={() => { acted.current = true; onRun(item.id); }}
          >
            <span className="ctx-label"><IconLabel id={menuIconId(item.id, item.label) ?? item.id}>{item.label}</IconLabel></span>
            {item.shortcut && <span className="ctx-key">{item.shortcut}</span>}
          </button>
        </div>
      ))}
    </div>
  );
}
