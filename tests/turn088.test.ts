import { describe, expect, it } from 'vitest';
import { buildAuroraExport, serializeAuroraExport } from '../src/model/auroraExport';
import * as C from '../src/model/commands';
import { confirmationClock, confirmedCaption } from '../src/model/confirmationLog';
import { printDate } from '../src/model/printReport';
import { buildSampleProject } from '../src/model/sample';
import type { Project } from '../src/model/types';
import { createRuntime, runToEnd } from '../src/runtime/engine';
import { formatClock, saveDraft, workTimesLabel, workTimesTitle } from '../src/storage/drafts';
import { serializeProject } from '../src/storage/fileFormat';
import { MemoryKV } from '../src/storage/localStore';
import { exportWorkspaceBundle } from '../src/storage/workspaceBundle';
import { ensureWorkspaces, saveProjectInWorkspace } from '../src/storage/workspaces';
import { formatLocalClock, utcCsvHeader } from '../src/ui/localClock';
import { noticeClock } from '../src/ui/noticeModel';
import {
  LOG_HEADERS, STEP_HEADERS, exportClockLabel, exportStamp, renderLogCsv, renderRunReportHtml, renderStepCsv, runReportFileName,
} from '../src/ui/runReport';

const AT = '2026-11-27T13:46:32.000Z';
const WHEN = new Date(AT);

function okProject(result: C.CmdResult): Project {
  if (!result.ok) throw new Error(result.reason);
  return result.project;
}

describe('TURN-088 local clock', () => {
  it('AC6 Seoul, UTC, a negative offset, and 30-minute zones', () => {
    expect(formatLocalClock(AT, { timeZone: 'Asia/Seoul' })).toBe('2026-11-27 22:46 (UTC+9)');
    expect(formatLocalClock(AT, { seconds: true, timeZone: 'Asia/Seoul' })).toBe('2026-11-27 22:46:32 (UTC+9)');
    expect(formatLocalClock(AT, { timeZone: 'UTC' })).toBe('2026-11-27 13:46 (UTC)');
    expect(formatLocalClock(AT, { seconds: true, timeZone: 'UTC' })).toBe('2026-11-27 13:46:32 (UTC)');
    expect(formatLocalClock(AT, { timeZone: 'America/New_York' })).toBe('2026-11-27 08:46 (UTC-5)');
    expect(formatLocalClock(AT, { timeZone: 'Asia/Kolkata' })).toBe('2026-11-27 19:16 (UTC+5:30)');
    expect(formatLocalClock(AT, { timeZone: 'Pacific/Marquesas' })).toBe('2026-11-27 04:16 (UTC-9:30)');
    expect(formatLocalClock(AT, { timeZone: 'America/St_Johns' })).toBe('2026-11-27 10:16 (UTC-3:30)');
    expect(formatLocalClock(AT, { timeZone: 'Australia/Eucla' })).toBe('2026-11-27 22:31 (UTC+8:45)');
    expect(formatLocalClock('2026-11-27T15:30:00.000Z', { timeZone: 'Asia/Seoul' })).toBe('2026-11-28 00:30 (UTC+9)');
    expect(formatLocalClock('')).toBe('');
    expect(formatLocalClock('not-a-time')).toBe('');
    expect(formatLocalClock(null)).toBe('');
  });

  it('AC2 AC3 the report, the print cover, the work line, notices, and the confirmation log share one function', () => {
    const saved = '2026-11-23T05:02:00.000Z';
    const draft = '2026-11-23T05:05:00.000Z';
    expect(formatClock(saved)).toBe(formatLocalClock(saved));
    expect(exportClockLabel(WHEN)).toBe(formatLocalClock(WHEN));
    expect(printDate(WHEN)).toBe(formatLocalClock(WHEN));
    expect(confirmationClock(AT)).toBe(formatLocalClock(AT));
    expect(noticeClock(WHEN.getTime())).toBe(formatLocalClock(WHEN, { seconds: true }));
    expect(workTimesLabel(saved, draft, false)).toBe(`저장 ${formatLocalClock(saved)} · 임시 저장 ${formatLocalClock(draft)}`);
    expect(workTimesLabel(saved, draft, true)).toBe(`저장 ${formatLocalClock(saved)} · 임시 저장 실패`);
    expect(workTimesTitle(saved, draft, false)).toBe(`저장 ${saved} · 임시 저장 ${draft}`);
    expect(workTimesTitle(saved, draft, true)).toBe(`저장 ${saved}`);

    const base = buildSampleProject();
    const action = base.actions[0];
    const ref = { kind: 'action' as const, id: action.id, field: 'duration' as const };
    const p = okProject(C.setQuantity(base, ref, action.duration.value, false, { by: '박확인', at: AT }));
    expect(confirmedCaption(p.confirmationLog, { kind: 'quantity', ref }, true)).toBe(`확인: 박확인 · ${formatLocalClock(AT)}`);
  });

  it('AC2 the report stamp is local and the tooltip keeps the ISO instant', () => {
    const p = buildSampleProject();
    const rt = runToEnd(createRuntime(p));
    const html = renderRunReportHtml(p, rt.state, WHEN);
    const iso = WHEN.toISOString();
    expect(html).toContain(`내보낸 시각 ${formatLocalClock(WHEN)}`);
    expect(html).toContain(`data-exported-at="${iso}"`);
    expect(html).toContain(`title="${iso}"`);
    expect(html).toContain('00:');
    expect(html).not.toContain(formatLocalClock(WHEN).replace(' (UTC', ' UTC'));
  });

  it('AC4 stored instants and the file-name stamp stay UTC', () => {
    const p = okProject(C.setConstraintConfirmation(buildSampleProject(), 'IL-01', 'confirmed', { by: '김검토', at: AT }));
    const file = serializeProject(p);
    expect(file).toContain(AT);
    expect(file).not.toContain(formatLocalClock(AT, { timeZone: 'Asia/Seoul' }));
    expect(file).not.toContain('(UTC+9)');

    const kv = new MemoryKV();
    const boot = ensureWorkspaces(kv, WHEN);
    const saved = saveProjectInWorkspace(kv, boot.reg, boot.reg.activeId, p, WHEN);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.savedAt).toBe(AT);
    const draft = saveDraft(kv, p, WHEN);
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect(draft.savedAt).toBe(AT);

    const bundle = exportWorkspaceBundle(kv, saved.reg, saved.reg.activeId, WHEN);
    expect('text' in bundle).toBe(true);
    if (!('text' in bundle)) return;
    expect(JSON.parse(bundle.text).createdAt).toBe(AT);
    expect(bundle.text).toContain(AT);
    expect(bundle.text).not.toContain('(UTC+9)');
    expect(bundle.text).not.toContain('(UTC)');

    const exported = serializeAuroraExport(buildAuroraExport(p));
    expect(exported).toContain(AT);
    expect(exported).not.toContain(formatLocalClock(AT, { timeZone: 'Asia/Seoul' }));
    expect(exported).not.toContain('(UTC');

    expect(exportStamp(WHEN)).toBe('20261127-1346');
    expect(runReportFileName('라인', 'html', WHEN)).toBe('라인_실행결과_20261127-1346.html');
    expect(runReportFileName('라인', 'steps', WHEN)).toBe('라인_실행결과_단계_20261127-1346.csv');
    expect(runReportFileName('라인', 'log', WHEN)).toBe('라인_실행결과_로그_20261127-1346.csv');
  });

  it('AC5 a wall-clock CSV header says (UTC), and virtual-time columns stay unlabeled', () => {
    expect(utcCsvHeader('시각')).toBe('시각 (UTC)');
    expect(utcCsvHeader('확인 시각')).toBe('확인 시각 (UTC)');
    expect(utcCsvHeader('시각 (UTC)')).toBe('시각 (UTC)');
    const p = buildSampleProject();
    const rt = runToEnd(createRuntime(p));
    const steps = renderStepCsv(p, rt.state);
    const log = renderLogCsv(rt.state);
    expect(steps).toContain(STEP_HEADERS.join(','));
    expect(log).toContain(LOG_HEADERS.join(','));
    expect(steps).not.toContain('(UTC)');
    expect(log).not.toContain('(UTC)');
    expect(log).toContain('가상 시각');
    expect(steps).toMatch(/\d{2}:\d{2}\.\d{3}/);
  });
});
