import { useEffect, useRef, useState } from 'react';
import type { Project } from '../model/types';
import type { RuntimeState } from '../runtime/engine';
import {
  renderLogCsv,
  renderRunReportHtml,
  renderStepCsv,
  reportAvailability,
  runReportFileName,
  type ReportKind,
} from './runReport';
import './run-report.css';

const ITEMS: { kind: ReportKind; label: string; mime: string }[] = [
  { kind: 'html', label: 'HTML 보고서', mime: 'text/html;charset=utf-8' },
  { kind: 'steps', label: '단계 표 CSV', mime: 'text/csv;charset=utf-8' },
  { kind: 'log', label: '로그 CSV', mime: 'text/csv;charset=utf-8' },
];

function saveText(name: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function textOf(p: Project, rt: RuntimeState, kind: ReportKind, at: Date): string {
  if (kind === 'steps') return renderStepCsv(p, rt);
  if (kind === 'log') return renderLogCsv(rt);
  return renderRunReportHtml(p, rt, at);
}

/** 「보고서 내보내기 ▾」 on the run summary. Enabled only after the run has ended. */
export function RunReportMenu({ p, rt }: { p: Project; rt: RuntimeState | null }) {
  const gate = reportAvailability(rt);
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) { setOpen((v) => !v); return; }
    const menuH = 132;
    const below = window.innerHeight - rect.bottom;
    const top = below >= menuH ? rect.bottom + 4 : Math.max(4, rect.top - 4 - menuH);
    const left = Math.max(4, Math.min(rect.left, window.innerWidth - 180));
    setBox({ top, left });
    setOpen((v) => !v);
  };

  const pick = (kind: ReportKind, mime: string) => {
    if (!rt || !gate.enabled) return;
    const at = new Date();
    saveText(runReportFileName(p.name, kind, at), textOf(p, rt, kind, at), mime);
    setOpen(false);
  };

  return (
    <div className="run-report" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className="small run-report-btn"
        data-report-export=""
        data-report-ready={gate.enabled ? '1' : '0'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="run-report-menu"
        disabled={!gate.enabled}
        title={gate.enabled ? 'HTML 보고서, 단계 표 CSV, 로그 CSV' : gate.reason}
        onClick={toggle}
      >보고서 내보내기 ▾</button>
      {!gate.enabled && <span className="run-report-reason" data-report-reason="">{gate.reason}</span>}
      {open && gate.enabled && box && (
        <div
          ref={menuRef}
          id="run-report-menu"
          className="run-report-menu"
          role="menu"
          aria-label="보고서 내보내기"
          style={{ top: box.top, left: box.left }}
        >
          {ITEMS.map((item) => (
            <button key={item.kind} type="button" role="menuitem" data-report-kind={item.kind} onClick={() => pick(item.kind, item.mime)}>{item.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
