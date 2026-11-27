// TURN-065. A finished run as one HTML file and two CSV files.
// Pure: the same project and runtime differ only by the export clock.
import { getAssetById } from '../assets/library';
import { runBlockFormula, shownStepCondition } from '../model/conditionFormula';
import { walk } from '../model/flow';
import { GAP_KIND_LABEL, type Gap } from '../model/gaps';
import { analyzeRunGaps } from '../model/runGaps';
import { APP_VERSION, feedCountOf, type Condition, type FlowNode, type Project, type Quantity } from '../model/types';
import type { RuntimeState } from '../runtime/engine';
import { stepStatusLabel, summarizeRun, type RunStepSummary, type RunSummary } from '../runtime/runSummary';
import { describeRunInfo, formatMs } from '../scene/runInfo';
import { formatLocalClock } from './localClock';
import { runErrorProblem, type ProblemCopy } from './problemCopy';

/** Printed on every report. Not equipment control and not a safety proof. */
export const RUN_REPORT_LIMIT = '논리 시뮬레이션 — 실제 장비 제어 / 안전 검증 아님';

export const REPORT_BEFORE = '실행이 끝나면 보고서를 내보낼 수 있습니다';
export const REPORT_DURING = '실행 중에는 보고서를 내보낼 수 없습니다. 실행이 끝난 뒤 내보내세요.';

export const STEP_HEADERS = ['단계 이름', '갈래 · 회차', '상태', '시작', '끝', '걸린 시간'] as const;
export const LOG_HEADERS = ['가상 시각', '코드', '내용'] as const;

export type ReportKind = 'html' | 'steps' | 'log';

export interface ValueNote {
  kind: '가정' | '미정';
  where: string;
  detail: string;
}

const EMPTY_GAPS = '이 실행에서는 실행 결과 Gap 이 없습니다.';
const EMPTY_BLOCKS = 'Interlock 차단 없음';
const NO_FAULTS = '없음';

/** Finished runs (완료 · 오류) can be exported. Before and during a run, the control stays dim. */
export function reportAvailability(rt: RuntimeState | null): { enabled: boolean; reason: string } {
  if (rt?.status === 'completed' || rt?.status === 'error') return { enabled: true, reason: '' };
  if (rt?.status === 'running' || rt?.status === 'paused') return { enabled: false, reason: REPORT_DURING };
  return { enabled: false, reason: REPORT_BEFORE };
}

function fmtMs(msv: number): string {
  return `${String(Math.floor(msv / 60000)).padStart(2, '0')}:${(Math.floor(msv / 1000) % 60).toString().padStart(2, '0')}.${(msv % 1000).toString().padStart(3, '0')}`;
}

function dash(ms: number | null): string {
  return ms === null ? '-' : fmtMs(ms);
}

function statusWord(step: RunStepSummary): string {
  if (step.wait && step.status === 'active') return stepStatusLabel('pending');
  return stepStatusLabel(step.status);
}

function isLongest(summary: RunSummary, step: RunStepSummary, index: number): boolean {
  return summary.longest?.stepId === step.stepId && summary.longest.elapsedMs === step.elapsedMs
    && summary.steps.findIndex((s) => s.stepId === step.stepId && s.elapsedMs === step.elapsedMs) === index;
}

/** One data row, same columns and order as the summary table on screen. */
export function stepTableRows(p: Project, rt: RuntimeState): string[][] {
  const summary = summarizeRun(p, rt);
  return summary.steps.map((step, index) => {
    const cond = shownStepCondition(p, step.stepId) ?? (step.wait ? step.condText ?? '' : '');
    const where = [step.lane, step.pass != null ? `${step.pass}회` : '', cond].filter(Boolean).join(' · ') || '—';
    const name = isLongest(summary, step, index) ? `${step.name} 가장 김` : step.name;
    return [name, where, statusWord(step), dash(step.startMs), dash(step.endMs), dash(step.elapsedMs)];
  });
}

/** Log rows newest first, matching the on-screen log table. */
export function logTableRows(rt: RuntimeState): string[][] {
  return [...rt.log].reverse().map((line) => [fmtMs(line.t), line.code, line.message]);
}

function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function csvTable(headers: readonly string[], rows: string[][]): string {
  const lines = [headers.join(','), ...rows.map((row) => row.map(csvCell).join(','))];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function renderStepCsv(p: Project, rt: RuntimeState): string {
  return csvTable(STEP_HEADERS, stepTableRows(p, rt));
}

export function renderLogCsv(rt: RuntimeState): string {
  return csvTable(LOG_HEADERS, logTableRows(rt));
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** UTC stamp so the same instant is the same file on any machine. */
export function exportStamp(at: Date): string {
  return `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}-${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}`;
}

export function exportClockLabel(at: Date): string {
  return formatLocalClock(at);
}

export function runReportFileName(projectName: string, kind: ReportKind, exportedAt: Date): string {
  const base = projectName.replace(/[^\w가-힣-]+/g, '_').replace(/^_+|_+$/g, '') || '실행결과';
  const stamp = exportStamp(exportedAt);
  if (kind === 'steps') return `${base}_실행결과_단계_${stamp}.csv`;
  if (kind === 'log') return `${base}_실행결과_로그_${stamp}.csv`;
  return `${base}_실행결과_${stamp}.html`;
}

function pushQty(out: ValueNote[], where: string, q: Quantity | null | undefined) {
  if (!q) return;
  if (q.value === null) out.push({ kind: '미정', where, detail: `미정 ${q.unit}`.trim() });
  else if (q.assumption) out.push({ kind: '가정', where, detail: `${q.value} ${q.unit}` });
}

function pushUndefined(out: ValueNote[], where: string, conds: readonly Condition[]) {
  for (const c of conds) {
    if (c.kind === 'undefined') out.push({ kind: '미정', where, detail: c.note || '조건 미정' });
  }
}

function walkFlow(out: ValueNote[], nodes: FlowNode[] | undefined) {
  if (!nodes) return;
  walk(nodes, (node) => {
    if (node.kind === 'branch') pushUndefined(out, node.name || '분기', [node.cond]);
    else if (node.kind === 'retry') pushUndefined(out, node.name || '재시도', [node.until]);
    else if (node.kind === 'wait') {
      pushUndefined(out, node.name || '신호 기다림', [node.cond]);
      pushQty(out, `${node.name || '신호 기다림'} 타임아웃`, node.timeout);
    }
  });
}

/** Assumption notes, assumed quantities, and values that are still unset. Stable order. */
export function collectValueNotes(p: Project): ValueNote[] {
  const out: ValueNote[] = [];
  for (const note of p.assumptionsNote) out.push({ kind: '가정', where: '가정 메모', detail: note });
  for (const item of p.sequence.unresolved) out.push({ kind: '미정', where: p.sequence.name, detail: item });
  for (const unit of p.units) {
    pushQty(out, `${unit.name} 수용 개수`, unit.capacity.maxMaterials);
    pushQty(out, `${unit.name} 허용 무게`, unit.capacity.maxWeight);
  }
  for (const device of p.devices) {
    const def = getAssetById(device.definitionRef.assetId);
    for (const [key, qty] of Object.entries(device.properties)) {
      const label = def?.properties.find((prop) => prop.key === key)?.label ?? key;
      pushQty(out, `${device.name} ${label}`, qty);
    }
  }
  for (const position of p.positions) pushQty(out, position.name, position.value);
  for (const action of p.actions) {
    pushQty(out, `${action.name} 동작 시간`, action.duration);
    pushQty(out, `${action.name} 타임아웃`, action.timeout);
    for (const [key, qty] of Object.entries(action.params)) pushQty(out, `${action.name} ${key}`, qty);
    pushUndefined(out, action.name, [...action.pre, ...action.post]);
  }
  const sequences = [p.sequence, ...(p.substationSequences ?? [])];
  for (const seq of sequences) {
    for (const item of seq === p.sequence ? [] : seq.unresolved) out.push({ kind: '미정', where: seq.name, detail: item });
    for (const step of seq.steps) {
      if (step.timeoutOverride) pushQty(out, `${step.name} 타임아웃 덮어쓰기`, step.timeoutOverride);
      pushUndefined(out, step.name, step.entry);
    }
    walkFlow(out, seq.flow);
  }
  for (const material of p.materials) {
    pushQty(out, `${material.name} 크기 W`, material.size.w);
    pushQty(out, `${material.name} 크기 L`, material.size.l);
    pushQty(out, `${material.name} 크기 H`, material.size.h);
    pushQty(out, `${material.name} 무게`, material.weight);
    pushQty(out, `${material.name} 투입 간격`, material.feedInterval);
    if (material.initialLocation == null) out.push({ kind: '미정', where: `${material.name} 초기 위치`, detail: '미정' });
    if (material.initialState == null) out.push({ kind: '미정', where: `${material.name} 초기 상태`, detail: '미정' });
  }
  for (const signal of p.signals) {
    if (!signal.address || signal.addressStatus === 'unassigned') out.push({ kind: '미정', where: `${signal.name} 주소`, detail: '주소 없음' });
    else if (signal.addressStatus === 'assumed') out.push({ kind: '가정', where: `${signal.name} 주소`, detail: signal.address });
  }
  return out;
}

function faultLines(p: Project): string[] {
  const faults = p.simSettings.faults;
  const lines: string[] = [];
  for (const id of faults.neverTrueSignalIds) {
    const name = p.signals.find((s) => s.id === id)?.name ?? id;
    lines.push(`완료 신호 미발생: ${name}`);
  }
  for (const id of faults.readFailActionIds) {
    const name = p.actions.find((a) => a.id === id)?.name ?? id;
    const n = faults.readFailFirstN?.[id];
    lines.push(n != null ? `${name}: 결과 실패 · 처음 ${n}회` : `${name}: 결과 실패`);
  }
  return lines.length ? lines : [NO_FAULTS];
}

function feedLines(p: Project): { count: string; interval: string } {
  const material = p.materials[0];
  if (!material) return { count: '없음', interval: '없음' };
  const interval = material.feedInterval.value === null
    ? '미정'
    : `${material.feedInterval.value} ${material.feedInterval.unit}${material.feedInterval.assumption ? ' · 가정' : ''}`;
  return { count: String(feedCountOf(material)), interval };
}

/** Same three lines as the run-screen error box. Unknown codes stay empty. */
export function reportErrorCopy(p: Project, rt: RuntimeState): ProblemCopy | null {
  if (rt.status !== 'error' || !rt.error) return null;
  const named = rt.error.message.match(/^\[([^\]]+)\]/)?.[1] ?? null;
  const interlockId = rt.interlockBlocks.find((row) => row.stepId === rt.error?.stepId)?.interlockId ?? rt.interlockBlocks[0]?.interlockId;
  const rule = p.constraints.find((k) => k.id === interlockId)?.rule;
  const phrase = runBlockFormula(p, rt.error.code, rt.error.stepId, rule?.form === 'allow' ? rule.conditions : undefined);
  const base = runErrorProblem(rt.error.code, rt.error.message, named);
  if (!base) return null;
  return phrase ? { ...base, why: `${base.why} ${phrase}` } : base;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function table(headers: readonly string[], rows: string[][]): string {
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function kv(rows: [string, string][]): string {
  return `<table class="kv">${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>`;
}

function gapRows(gaps: Gap[]): string[][] {
  return gaps.map((g) => [
    `실행 결과 · ${GAP_KIND_LABEL[g.kind]}`,
    g.title,
    g.assumptions.length ? `${g.evidence} ${g.assumptions.join(' · ')}` : g.evidence,
    g.suggestion,
  ]);
}

function summaryHead(summary: RunSummary): string {
  const bits = [`총 ${dash(summary.totalMs)}`, `${summary.finishedCount} / ${summary.totalCount} 단계`];
  if (summary.longest) bits.push(`가장 긴 단계 ${summary.longest.name} ${fmtMs(summary.longest.elapsedMs)}`);
  if (summary.skippedCount > 0 || summary.stoppedCount > 0 || summary.steps.some((s) => (s.pass ?? 1) > 1 || s.lane)) {
    bits.push(`실행 ${summary.executedCount}`, `건너뜀 ${summary.skippedCount}`);
    if (summary.stoppedCount > 0) bits.push(`정지 ${summary.stoppedCount}`);
  }
  return bits.join(' · ');
}

const REPORT_CSS = `
:root { --fs-xs: 11px; --fs-sm: 12px; --fs-md: 13px; --fs-lg: 15px; --fs-h2: 18px; --fs-h1: 24px; --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 24px; }
* { box-sizing: border-box; }
body { margin: var(--sp-5); font-family: system-ui, sans-serif; font-size: var(--fs-md); line-height: 1.45; background: #fff; color: #1a1a1a; }
h1 { font-size: var(--fs-h1); margin: 0 0 var(--sp-3); }
h2 { font-size: var(--fs-h2); margin: var(--sp-5) 0 var(--sp-2); }
.error { border: 2px solid #b42336; padding: var(--sp-3); margin: 0 0 var(--sp-4); }
.error p { margin: 0 0 var(--sp-1); }
.limit { font-weight: 700; margin: var(--sp-3) 0; }
.note, .meta { color: #5c5c5c; font-size: var(--fs-sm); }
table { border-collapse: collapse; width: 100%; margin: 0 0 var(--sp-3); }
th, td { border: 1px solid #ccc; padding: var(--sp-1) var(--sp-2); text-align: left; vertical-align: top; font-size: var(--fs-sm); }
th { background: #f3f3f3; }
table.kv th { width: 10em; }
ul { margin: 0 0 var(--sp-3); padding-left: var(--sp-4); }
.stamp { margin-top: var(--sp-5); font-size: var(--fs-sm); color: #5c5c5c; }
@media (prefers-color-scheme: dark) {
  body { background: #101b2a; color: #e7eef8; }
  .note, .meta, .stamp { color: #b3c4d9; }
  th, td { border-color: #3d5166; }
  th { background: #19283a; }
  .error { border-color: #ff9fab; }
}
@media print {
  body { margin: 12mm; background: #fff; color: #000; }
  .error { break-inside: avoid; }
  tr { break-inside: avoid; }
}
`.trim();

/** One self-contained HTML file. `exportedAt` is the only input that may change between two calls. */
export function renderRunReportHtml(p: Project, rt: RuntimeState, exportedAt: Date): string {
  const summary = summarizeRun(p, rt);
  const info = describeRunInfo(p, rt);
  const feed = feedLines(p);
  const gaps = analyzeRunGaps(p, rt);
  const notes = collectValueNotes(p);
  const blocks = rt.interlockBlocks.map((row) => [fmtMs(row.t), `${row.interlockId} ${row.description}`, row.stepName, row.reason]);
  const error = reportErrorCopy(p, rt);
  const rev = rt.modelRevision !== p.revision ? `${p.revision} · 실행한 모델 rev ${rt.modelRevision}` : String(p.revision);
  const bottleneck = info.bottleneck ? `${info.bottleneck.name} ${info.bottleneck.timeText}` : 'Unit 없음';
  const errorHtml = error
    ? `<section class="error" data-run-error="${esc(rt.error?.code ?? '')}"><p><b>무엇</b> ${esc(error.what)}</p><p><b>왜</b> ${esc(error.why)}</p><p><b>어떻게</b> ${esc(error.how ?? '')}</p></section>`
    : '';
  const gapHtml = gaps.length
    ? table(['종류', '항목', '근거', '수정 제안'], gapRows(gaps))
    : `<p>${esc(EMPTY_GAPS)}</p>`;
  const noteHtml = notes.length
    ? table(['구분', '위치', '내용'], notes.map((n) => [n.kind, n.where, n.detail]))
    : '<p>없음</p>';
  const blockHtml = blocks.length
    ? table(['가상 시각', 'Interlock', '단계', '까닭'], blocks)
    : `<p>${esc(EMPTY_BLOCKS)}</p>`;
  const faults = faultLines(p).map((line) => `<li>${esc(line)}</li>`).join('');
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${esc(p.name)} 실행 결과</title>
<style>${REPORT_CSS}</style>
</head>
<body>
${errorHtml}
<header>
<h1>${esc(p.name)} 실행 결과</h1>
${kv([
    ['프로젝트', p.name],
    ['rev', rev],
    ['실행 시각', `${formatMs(rt.timeMs)} (가상 시각)`],
    ['앱 버전', APP_VERSION],
    ['실행 규칙 버전', rt.rulesVersion],
  ])}
<p class="limit">${esc(RUN_REPORT_LIMIT)}</p>
</header>
<h2>실행 요약</h2>
<p>${esc(summaryHead(summary))}${summary.aborted ? ' · 오류로 중단' : ''}</p>
${kv([
    ['총 시간', dash(summary.totalMs)],
    ['끝난 단계', `${summary.finishedCount} / ${summary.totalCount}`],
    ['사이클', info.cycleText],
    ['시간당 생산량', info.throughputText],
    ['병목', bottleneck],
  ])}
<p class="note">${esc(info.throughputNote)}</p>
<p class="note">${info.metricBasis ? esc(info.metricBasis) : ''}</p>
<p class="note">가정 시간 기준 · 실제 택트가 아닙니다</p>
<h2>가동 조건</h2>
${kv([
    ['투입 개수', feed.count],
    ['투입 간격', feed.interval],
  ])}
<p class="meta">오류 주입</p>
<ul>${faults}</ul>
<h2>단계 표</h2>
${table(STEP_HEADERS, stepTableRows(p, rt))}
<h2>실행 결과 Gap</h2>
${gapHtml}
<h2>가정 · 미정 값</h2>
${noteHtml}
<h2>Interlock 차단 이력</h2>
${blockHtml}
<p class="stamp" data-exported-at="${esc(exportedAt.toISOString())}" title="${esc(exportedAt.toISOString())}">내보낸 시각 ${esc(exportClockLabel(exportedAt))}</p>
</body>
</html>
`;
}

/** Drop the export clock so two renders of one run can be compared. */
export function withoutExportStamp(html: string): string {
  return html.replace(/<p class="stamp"[\s\S]*?<\/p>/, '');
}
