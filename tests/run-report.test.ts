import { describe, expect, it } from 'vitest';
import { APP_VERSION, RUNTIME_RULES_VERSION, type Project } from '../src/model/types';
import { analyzeRunGaps } from '../src/model/runGaps';
import { buildSampleProject } from '../src/model/sample';
import { setFeedCount, setQuantity } from '../src/model/commands';
import { createRuntime, runToEnd } from '../src/runtime/engine';
import { describeRunInfo } from '../src/scene/runInfo';
import { summarizeRun } from '../src/runtime/runSummary';
import {
  LOG_HEADERS,
  REPORT_BEFORE,
  REPORT_DURING,
  RUN_REPORT_LIMIT,
  STEP_HEADERS,
  collectValueNotes,
  exportClockLabel,
  logTableRows,
  renderLogCsv,
  renderRunReportHtml,
  renderStepCsv,
  reportAvailability,
  reportErrorCopy,
  runReportFileName,
  stepTableRows,
  withoutExportStamp,
} from '../src/ui/runReport';

const AT = new Date('2026-11-23T15:43:00.000Z');
const LATER = new Date('2026-11-24T01:05:00.000Z');

function fed(p: Project, count: number, interval: number): Project {
  const id = p.materials[0].id;
  const counted = setFeedCount(p, id, count);
  if (!counted.ok) throw new Error(counted.reason);
  const timed = setQuantity(counted.project, { kind: 'material', id, field: 'feedInterval' }, interval, true);
  if (!timed.ok) throw new Error(timed.reason);
  return timed.project;
}

function moveStopperAfterCylinder(p: Project) {
  const steps = p.sequence.steps;
  const up = steps.findIndex((s) => s.name.includes('S3 스토퍼 상승'));
  const [step] = steps.splice(up, 1);
  const cyl = steps.findIndex((s) => s.name.includes('가공 실린더'));
  steps.splice(cyl + 1, 0, step);
}

function parseCsv(raw: string): string[][] {
  expect(raw.charCodeAt(0)).toBe(0xfeff);
  const text = raw.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; continue; }
        quoted = false;
        continue;
      }
      cell += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { row.push(cell); cell = ''; continue; }
    if (ch === '\n') {
      if (cell.endsWith('\r')) cell = cell.slice(0, -1);
      row.push(cell);
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += ch;
  }
  return rows;
}

describe('TURN-065 run report', () => {
  it('AC1 the control is on only after the run has ended', () => {
    expect(reportAvailability(null)).toEqual({ enabled: false, reason: REPORT_BEFORE });
    const idle = createRuntime(buildSampleProject());
    expect(reportAvailability(idle.state).enabled).toBe(false);
    expect(reportAvailability(idle.state).reason).toBe(REPORT_BEFORE);
    const running = runToEnd(createRuntime(buildSampleProject()));
    expect(running.state.status).toBe('completed');
    expect(reportAvailability(running.state)).toEqual({ enabled: true, reason: '' });
    const failed = buildSampleProject();
    failed.simSettings.faults.neverTrueSignalIds = [failed.actions.find((a) => a.deviceId === 'BCR-02')!.completeSignalId!];
    const error = runToEnd(createRuntime(failed));
    expect(error.state.status).toBe('error');
    expect(reportAvailability(error.state).enabled).toBe(true);
    expect(reportAvailability({ ...idle.state, status: 'running' }).reason).toBe(REPORT_DURING);
    expect(reportAvailability({ ...idle.state, status: 'paused' }).reason).toBe(REPORT_DURING);
  });

  it('AC2 AC3 the HTML report repeats the screen numbers and has no external reference', () => {
    const p = fed(buildSampleProject(), 5, 0);
    const rt = runToEnd(createRuntime(p));
    const html = renderRunReportHtml(p, rt.state, AT);
    const info = describeRunInfo(p, rt.state);
    const summary = summarizeRun(p, rt.state);
    expect(html).toContain(p.name);
    expect(html).toContain(`>${p.revision}<`);
    expect(html).toContain(info.timeText);
    expect(html).toContain(APP_VERSION);
    expect(html).toContain(rt.state.rulesVersion);
    expect(rt.state.rulesVersion).toBe(RUNTIME_RULES_VERSION);
    expect(html).toContain(RUN_REPORT_LIMIT);
    expect(html).toContain(`${summary.finishedCount} / ${summary.totalCount}`);
    expect(html).toContain(info.cycleText);
    expect(html).toContain(info.throughputText);
    expect(html).toContain(info.bottleneck!.name);
    expect(html).toContain(info.bottleneck!.timeText);
    expect(html).toContain('5');
    expect(html).toContain('0 s · 가정');
    expect(html).toContain('오류 주입');
    expect(html).toContain('없음');
    const asHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    for (const gap of analyzeRunGaps(p, rt.state)) {
      expect(html).toContain(asHtml(gap.title));
      expect(html).toContain(asHtml(gap.evidence));
    }
    expect(html).toContain('병목 Unit S2 식별');
    expect(html).toContain('기다린 시간 합 13.100 s');
    expect(html).toContain(p.assumptionsNote[0]);
    expect(collectValueNotes(p).some((n) => n.kind === '가정' && n.detail === p.assumptionsNote[0])).toBe(true);
    expect(collectValueNotes(p).some((n) => n.kind === '미정')).toBe(true);
    expect(html).not.toMatch(/https?:/i);
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/url\s*\(/i);
    expect(stepTableRows(p, rt.state).length).toBe(summary.steps.length);
    for (const header of STEP_HEADERS) expect(html).toContain(header);
  });

  it('AC4 an error run puts the three-line guide above the title', () => {
    const p = buildSampleProject();
    p.simSettings.faults.neverTrueSignalIds = [p.actions.find((a) => a.deviceId === 'BCR-02')!.completeSignalId!];
    const rt = runToEnd(createRuntime(p));
    const copy = reportErrorCopy(p, rt.state);
    expect(copy).toBeTruthy();
    const html = renderRunReportHtml(p, rt.state, AT);
    const whatAt = html.indexOf(copy!.what);
    expect(whatAt).toBeGreaterThan(-1);
    expect(whatAt).toBeLessThan(html.indexOf('<h1'));
    expect(html.indexOf(copy!.why)).toBeLessThan(html.indexOf('<h1'));
    expect(html.indexOf(copy!.how!)).toBeLessThan(html.indexOf('<h1'));
    expect(html).toContain('무엇');
    expect(html).toContain('왜');
    expect(html).toContain('어떻게');
  });

  it('AC5 CSV keeps a BOM, quoting, and the same columns and rows as the tables', () => {
    const p = buildSampleProject();
    p.sequence.steps[0].name = '가,나"다';
    const rt = runToEnd(createRuntime(p));
    rt.state.log.push({ t: rt.state.timeMs, level: 'info', code: 'NOTE', message: '쉼표, 그리고 "따옴표"' });
    const steps = parseCsv(renderStepCsv(p, rt.state));
    expect(steps[0]).toEqual([...STEP_HEADERS]);
    expect(steps.slice(1)).toEqual(stepTableRows(p, rt.state));
    expect(steps[1][0]).toBe('가,나"다');
    const log = parseCsv(renderLogCsv(rt.state));
    expect(log[0]).toEqual([...LOG_HEADERS]);
    expect(log.slice(1)).toEqual(logTableRows(rt.state));
    expect(log[1]).toEqual([logTableRows(rt.state)[0][0], 'NOTE', '쉼표, 그리고 "따옴표"']);
    expect(renderStepCsv(p, rt.state)).toContain('"가,나""다"');
    expect(renderLogCsv(rt.state)).toContain('"쉼표, 그리고 ""따옴표"""');
  });

  it('AC6 the same run differs only by the export clock and does not change the model', () => {
    const p = buildSampleProject();
    const rt = runToEnd(createRuntime(p));
    const before = JSON.stringify(p);
    const rev = p.revision;
    const a = renderRunReportHtml(p, rt.state, AT);
    const b = renderRunReportHtml(p, rt.state, LATER);
    expect(a).not.toBe(b);
    expect(withoutExportStamp(a)).toBe(withoutExportStamp(b));
    expect(a).toContain(exportClockLabel(AT));
    expect(b).toContain(exportClockLabel(LATER));
    expect(renderStepCsv(p, rt.state)).toBe(renderStepCsv(p, rt.state));
    expect(renderLogCsv(rt.state)).toBe(renderLogCsv(rt.state));
    expect(p.revision).toBe(rev);
    expect(JSON.stringify(p)).toBe(before);
    expect(runReportFileName(p.name, 'html', AT)).toBe('조립_라인_01_5공정_예제_실행결과_20261123-1543.html');
    expect(runReportFileName(p.name, 'steps', AT)).toBe('조립_라인_01_5공정_예제_실행결과_단계_20261123-1543.csv');
    expect(runReportFileName(p.name, 'log', AT)).toBe('조립_라인_01_5공정_예제_실행결과_로그_20261123-1543.csv');
  });

  it('AC7 user text keeps < and & as text', () => {
    const p = buildSampleProject();
    p.name = '이름 <b> & "따옴표"';
    p.assumptionsNote = ['메모 <script src="http://evil"> & 더'];
    const rt = runToEnd(createRuntime(p));
    const html = renderRunReportHtml(p, rt.state, AT);
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<script');
    expect(html).toContain('이름 &lt;b&gt; &amp; &quot;따옴표&quot;');
    expect(html).toContain('메모 &lt;script src=&quot;http://evil&quot;&gt; &amp; 더');
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/<link\b/i);
  });

  it('an Interlock stop is listed with the same id, step, and reason', () => {
    const p = buildSampleProject();
    moveStopperAfterCylinder(p);
    p.constraints[0].confirmation = 'confirmed';
    const rt = runToEnd(createRuntime(p));
    expect(rt.state.error?.code).toBe('INTERLOCK_BLOCK');
    const html = renderRunReportHtml(p, rt.state, AT);
    const block = rt.state.interlockBlocks[0];
    expect(html.indexOf('무엇')).toBeLessThan(html.indexOf('<h1'));
    expect(html).toContain(block.interlockId);
    expect(html).toContain(block.stepName);
    expect(html).toContain(block.reason);
    expect(html).toContain(block.description);
  });
});
