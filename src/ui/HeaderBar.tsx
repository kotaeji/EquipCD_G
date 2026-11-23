// TURN-069. Header actions. Save, undo, redo, and command search stay.
// Export, view settings, help, and later extras fold into 「더 보기」 when the bar is short.
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { APP_VERSION, PRODUCT_NAME } from '../model/types';
import { BrandMark } from './BrandMark';
import { ContextMenu } from './ContextMenu';
import { IconLabel } from './Icon';
import {
  headerTier, measureHeaderOverflow, sameIds, type HeaderTier,
} from './headerOverflow';
import './header-bar.css';

interface Props {
  viewportWidth: number;
  dirty: boolean;
  helpOpen: boolean;
  undo: ReactNode;
  redo: ReactNode;
  paletteLabel: string;
  paletteShortcut: string;
  onPalette: () => void;
  onSave: () => void;
  onExport: () => void;
  onViewSettings: () => void;
  onHelp: (opener: HTMLElement) => void;
  fileRef: RefObject<HTMLInputElement>;
  onImportFile: (file: File) => void;
}

export function HeaderBar({
  viewportWidth, dirty, helpOpen, undo, redo,
  paletteLabel, paletteShortcut, onPalette, onSave, onExport, onViewSettings, onHelp,
  fileRef, onImportFile,
}: Props) {
  const headerRef = useRef<HTMLElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const tier: HeaderTier = headerTier(viewportWidth);
  const [collapsed, setCollapsed] = useState<string[]>(() => (tier === 'compact' ? ['export-json', 'view-settings', 'help'] : []));
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const measuring = useRef(false);
  const closeMenu = useCallback(() => setMenuAt(null), []);

  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const apply = () => {
      if (measuring.current) return;
      measuring.current = true;
      try {
        const next = measureHeaderOverflow(header, headerTier(window.innerWidth || viewportWidth));
        setCollapsed((cur) => (sameIds(cur, next) ? cur : next));
      } finally { measuring.current = false; }
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(header);
    return () => ro.disconnect();
  }, [viewportWidth, dirty, helpOpen, paletteShortcut]);

  const hidden = (id: string) => collapsed.includes(id);
  const cls = (base: string, id: string) => (hidden(id) ? `${base} header-overflow` : base);
  const run = (id: string, opener: HTMLElement) => {
    closeMenu();
    if (id === 'export-json') onExport();
    else if (id === 'view-settings') onViewSettings();
    else if (id === 'help') onHelp(opener);
  };
  const menuItems = collapsed.map((id) => {
    const button = headerRef.current?.querySelector<HTMLButtonElement>(`[data-overflow="${id}"]`);
    const label = button?.getAttribute('aria-label') || button?.textContent?.replace(/\s+/g, ' ').trim() || id;
    return { id, label };
  });

  return (
    <header ref={headerRef} className="header" data-header-tier={tier}>
      <span className="brand" aria-label={`${PRODUCT_NAME} ${APP_VERSION}`}><BrandMark /><span className="title">{PRODUCT_NAME}</span></span>
      <span className="subtitle">논리 시뮬레이션</span>
      <span className="grow" />
      <button type="button" className="btn-main secondary cmd-open" aria-label={paletteLabel} onClick={onPalette}>
        <IconLabel id="palette">{paletteLabel}</IconLabel><span className="cmd-key">{paletteShortcut}</span>
      </button>
      <button className="btn-main primary" data-jump="save" onClick={onSave} aria-label={dirty ? '저장, 저장 안 됨' : '저장'}><IconLabel id="save">저장{dirty ? <span className="save-dot" aria-hidden="true" /> : null}</IconLabel></button>
      <button className={cls('btn-main secondary', 'export-json')} data-overflow="export-json" onClick={onExport}><IconLabel id="export-json">내보내기</IconLabel></button>
      <button className={cls('btn-main secondary', 'view-settings')} data-overflow="view-settings" onClick={onViewSettings}><IconLabel id="view-settings">보기 설정</IconLabel></button>
      <button type="button" className={cls('btn-main secondary', 'help')} data-overflow="help" data-help-toggle aria-expanded={helpOpen} aria-label="도움말" onClick={(e) => onHelp(e.currentTarget)}><IconLabel id="help">도움말</IconLabel></button>
      <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportFile(f); e.target.value = ''; }} />
      {undo}
      {redo}
      <button
        type="button"
        ref={moreRef}
        className={collapsed.length === 0 ? 'btn-main secondary header-overflow' : 'btn-main secondary'}
        data-header-more
        aria-label="더 보기"
        aria-haspopup="menu"
        aria-expanded={menuAt !== null}
        onClick={(e) => {
          if (menuAt) { closeMenu(); return; }
          const r = e.currentTarget.getBoundingClientRect();
          setMenuAt({ x: r.left, y: r.bottom });
        }}
      >
        <IconLabel id="object-more">더 보기</IconLabel>
      </button>
      {menuAt && menuItems.length > 0 && createPortal(
        <ContextMenu
          x={menuAt.x}
          y={menuAt.y}
          kind="header"
          menuLabel="더 보기"
          items={menuItems}
          returnFocus={moreRef.current}
          anchor={moreRef.current}
          onRun={(id) => run(id, moreRef.current ?? document.body)}
          onClose={closeMenu}
        />,
        document.body,
      )}
    </header>
  );
}
