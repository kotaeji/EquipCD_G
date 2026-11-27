// TURN-079. Print preview. It reads the project and does not edit it.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  PRINT_LIMIT,
  PRINT_SECTIONS,
  diagramFrame,
  gapRows,
  interlockRows,
  nodeLayout,
  printDate,
  printFlags,
  signalRows,
  stationFlow,
  structureRows,
  substationFlows,
  type FlowLine,
  type PrintSectionId,
} from '../model/printReport';
import type { Project } from '../model/types';
import { APP_VERSION, PRODUCT_NAME } from '../model/types';
import { IconLabel } from './Icon';
import { SfcView } from './SfcView';
import { Symbol } from './Symbols';
import { STATUS_COLOR } from './status';
import './print-view.css';

const LIGHT = STATUS_COLOR.light;
const INK = '#1c1c1c';
const MUTED = '#5c5c5c';

const SHEET_STYLE = {
  '--bg': '#ffffff',
  '--panel': '#ffffff',
  '--canvas': '#ffffff',
  '--text': INK,
  '--muted': MUTED,
  '--border': '#8c8c8c',
  '--accent': '#1a1a1a',
  '--grid': '#8c8c8c',
  '--selected': '#e6e6e6',
  '--status-active': LIGHT.active,
  '--status-done': LIGHT.done,
  '--status-error': LIGHT.error,
  '--status-pending': LIGHT.pending,
  '--status-undetermined': LIGHT.undetermined,
  '--status-assumption': LIGHT.assumption,
} as CSSProperties;

function FlowTable({ label, rows }: { label: string; rows: FlowLine[] }) {
  return (
    <table className="grid print-table print-flow" aria-label={label}>
      <thead><tr><th>흐름</th><th>내용</th></tr></thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={2}>단계가 없습니다.</td></tr>}
        {rows.map((row) => (
          <tr key={row.key}>
            <td data-depth={row.depth} style={{ paddingLeft: `calc(var(--sp-2) + ${row.depth} * var(--sp-4))` }}><b>{row.title}</b></td>
            <td>{row.detail}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Diagram({ p }: { p: Project }) {
  const frame = diagramFrame(p);
  return (
    <svg
      className="print-diagram"
      data-print-diagram
      role="img"
      aria-label="도면 도식"
      viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`}
      width="100%"
      preserveAspectRatio="xMidYMid meet"
    >
      <rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} fill="#ffffff" />
      <defs>
        <marker id="print-flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L10 5 L0 10 Z" fill={INK} />
        </marker>
      </defs>
      {p.units.map((u) => (
        <g key={u.id} data-print-unit={u.id}>
          <rect x={u.layout.x} y={u.layout.y} width={u.layout.w} height={u.layout.h} fill="#f6f6f6" stroke={INK} />
          <text x={u.layout.x + 8} y={u.layout.y + 16} fill={INK}>{u.code} {u.name}</text>
        </g>
      ))}
      {p.connections.map((c) => {
        const from = nodeLayout(p, c.from.nodeId);
        const to = nodeLayout(p, c.to.nodeId);
        if (!from || !to) return null;
        const x1 = from.x + from.w / 2;
        const y1 = from.y + from.h / 2;
        const x2 = to.x + to.w / 2;
        const y2 = to.y + to.h / 2;
        const signal = c.kind === 'signal';
        return (
          <line
            key={c.id}
            x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={signal ? MUTED : INK}
            strokeDasharray={signal ? '5 4' : undefined}
            markerEnd={signal ? undefined : 'url(#print-flow-arrow)'}
          />
        );
      })}
      {p.devices.map((d) => (
        <g key={d.id} data-print-device={d.id} transform={`translate(${d.layout.x} ${d.layout.y})`}>
          <Symbol kind={d.kind} w={d.layout.w} h={d.layout.h} />
          <text x={d.layout.w / 2} y={d.layout.h - 4} textAnchor="middle" fill={INK}>{d.name}</text>
        </g>
      ))}
    </svg>
  );
}

export function PrintView({ project, onClose }: { project: Project; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [printedAt] = useState(() => new Date());
  const [orient, setOrient] = useState<'landscape' | 'portrait'>('landscape');
  const [on, setOn] = useState<Record<PrintSectionId, boolean>>(() => Object.fromEntries(PRINT_SECTIONS.map((s) => [s.id, true])) as Record<PrintSectionId, boolean>);
  useEffect(() => { closeRef.current?.focus(); }, []);
  const flow = stationFlow(project);
  const subs = substationFlows(project);
  const flags = printFlags(project);
  const gaps = gapRows(project);
  const show = (id: PrintSectionId) => on[id];
  return (
    <div className="print-root" data-print-view role="dialog" aria-modal="true" aria-label="인쇄용 보기" data-orientation={orient}>
      <div className="print-chrome">
        <span className="print-chrome-title">인쇄용 보기</span>
        <div className="print-checks">
          {PRINT_SECTIONS.map((s) => (
            <label key={s.id} className="print-check">
              <input
                type="checkbox"
                checked={on[s.id]}
                data-print-toggle={s.id}
                aria-label={s.label}
                onChange={(e) => setOn((cur) => ({ ...cur, [s.id]: e.target.checked }))}
              />
              {s.label}
            </label>
          ))}
        </div>
        <div className="print-orient" role="radiogroup" aria-label="용지 방향">
          <button type="button" role="radio" aria-checked={orient === 'landscape'} data-print-orient="landscape" className={orient === 'landscape' ? 'on' : ''} onClick={() => setOrient('landscape')}>가로</button>
          <button type="button" role="radio" aria-checked={orient === 'portrait'} data-print-orient="portrait" className={orient === 'portrait' ? 'on' : ''} onClick={() => setOrient('portrait')}>세로</button>
        </div>
        <button type="button" className="btn-main primary" onClick={() => window.print()}><IconLabel id="print-view">인쇄</IconLabel></button>
        <button type="button" className="btn-main secondary" ref={closeRef} onClick={onClose}><IconLabel id="close">닫기</IconLabel></button>
        <p className="print-hint">지금 모델을 인쇄합니다. 화면의 확대·이동·테마와 무관하고, rev · Undo 는 바꾸지 않습니다.</p>
      </div>
      <div className="print-scroll">
        <article className="print-sheet" data-print-sheet style={SHEET_STYLE}>
          <table className="print-frame">
            <thead>
              <tr>
                <td>
                  <div className="print-runhead" data-print-running-head>
                    <span data-print-project>{project.name}</span>
                    <span className="print-runhead-limit" data-print-limit>{PRINT_LIMIT}</span>
                  </div>
                </td>
              </tr>
            </thead>
            <tbody>
              {show('cover') && <tr className="print-section" data-print-section="cover"><td data-print-cover>
                <p className="print-kicker">{PRODUCT_NAME}</p>
                <h1>{project.name}</h1>
                <p className="print-limit" data-print-limit>{PRINT_LIMIT}</p>
                <table className="grid print-table" aria-label="표지">
                  <thead><tr><th>항목</th><th>값</th></tr></thead>
                  <tbody>
                    <tr><th scope="row">프로젝트</th><td>{project.name}</td></tr>
                    <tr><th scope="row">rev</th><td data-print-rev>{project.revision}</td></tr>
                    <tr><th scope="row">시각</th><td data-print-date title={printedAt.toISOString()}>{printDate(printedAt)}</td></tr>
                    <tr><th scope="row">앱 버전</th><td data-print-version>{APP_VERSION}</td></tr>
                    <tr><th scope="row">장비</th><td>{project.equipment.name}</td></tr>
                  </tbody>
                </table>
              </td></tr>}
              {show('structure') && <tr className="print-section" data-print-section="structure"><td>
                <h2>장비 구조</h2>
                <table className="grid print-table" aria-label="장비 구조">
                  <thead><tr><th>Station</th><th>Unit</th><th>코드</th><th>Device</th><th>종류</th></tr></thead>
                  <tbody>
                    {structureRows(project).length === 0 && <tr><td colSpan={5}>장비가 없습니다.</td></tr>}
                    {structureRows(project).map((row, i) => (
                      <tr key={`${row.code}:${row.device}:${i}`}>
                        <td>{row.station}</td><td>{row.unit}</td><td>{row.code}</td><td>{row.device}</td><td>{row.kind}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </td></tr>}
              {show('diagram') && <tr className="print-section" data-print-section="diagram"><td>
                <h2>도면 도식</h2>
                <Diagram p={project} />
                <p className="print-legend">실선은 물류, 점선은 논리 신호입니다. 화면의 확대·이동과 무관하게 지금 모델 전체를 한 쪽 너비에 맞춥니다.</p>
              </td></tr>}
              {show('station') && <tr className="print-section" data-print-section="station"><td>
                <h2>Station 시퀀스</h2>
                <h3>{flow.name}</h3>
                <FlowTable label="Station 흐름" rows={flow.rows} />
              </td></tr>}
              {show('substation') && <tr className="print-section" data-print-section="substation"><td>
                <h2>Substation 시퀀스</h2>
                {subs.length === 0 && <p className="print-empty">Substation 시퀀스가 없습니다.</p>}
                {subs.map((q) => (
                  <div key={q.id}>
                    <h3>{q.name} · {q.unit}</h3>
                    <FlowTable label={q.name} rows={q.rows} />
                  </div>
                ))}
              </td></tr>}
              {show('sfc') && <tr className="print-section" data-print-section="sfc"><td>
                <h2>SFC</h2>
                <div className="print-sfc" data-print-sfc><SfcView p={project} rt={null} /></div>
              </td></tr>}
              {show('signals') && <tr className="print-section" data-print-section="signals"><td>
                <h2>신호 · Interlock</h2>
                <h3>신호</h3>
                <table className="grid print-table" aria-label="신호">
                  <thead><tr><th>이름</th><th>Device</th><th>방향</th><th>역할</th><th>주소</th></tr></thead>
                  <tbody>
                    {signalRows(project).length === 0 && <tr><td colSpan={5}>신호가 없습니다.</td></tr>}
                    {signalRows(project).map((s) => (
                      <tr key={s.id}><td>{s.name}</td><td>{s.device}</td><td>{s.direction}</td><td>{s.role}</td><td>{s.address}</td></tr>
                    ))}
                  </tbody>
                </table>
                <h3>Interlock</h3>
                <table className="grid print-table" aria-label="Interlock">
                  <thead><tr><th>ID</th><th>종류</th><th>확인</th><th>설명</th><th>규칙</th></tr></thead>
                  <tbody>
                    {interlockRows(project).length === 0 && <tr><td colSpan={5}>Interlock이 없습니다.</td></tr>}
                    {interlockRows(project).map((k) => (
                      <tr key={k.id}><td>{k.id}</td><td>{k.kind}</td><td>{k.confirmation}</td><td>{k.description}</td><td>{k.rule}</td></tr>
                    ))}
                  </tbody>
                </table>
              </td></tr>}
              {show('notes') && <tr className="print-section" data-print-section="notes"><td>
                <h2>가정 · 미정 · Gap</h2>
                <h3>가정 메모</h3>
                {flags.memos.length === 0 && <p className="print-empty">가정 메모가 없습니다.</p>}
                {flags.memos.length > 0 && <ul>{flags.memos.map((line) => <li key={line}>{line}</li>)}</ul>}
                <h3>미정</h3>
                {flags.undetermined.length === 0 && <p className="print-empty">미정이 없습니다.</p>}
                {flags.undetermined.length > 0 && (
                  <table className="grid print-table" aria-label="미정">
                    <thead><tr><th>항목</th></tr></thead>
                    <tbody>{flags.undetermined.map((f) => <tr key={f.id}><td>{f.text}</td></tr>)}</tbody>
                  </table>
                )}
                <h3>가정 값</h3>
                {flags.assumptions.length === 0 && <p className="print-empty">가정 값이 없습니다.</p>}
                {flags.assumptions.length > 0 && (
                  <table className="grid print-table" aria-label="가정 값">
                    <thead><tr><th>항목</th></tr></thead>
                    <tbody>{flags.assumptions.map((f) => <tr key={f.id}><td>{f.text}</td></tr>)}</tbody>
                  </table>
                )}
                <h3>Gap</h3>
                <table className="grid print-table" aria-label="Gap">
                  <thead><tr><th>종류</th><th>판정</th><th>제목</th><th>근거</th></tr></thead>
                  <tbody>
                    {gaps.length === 0 && <tr><td colSpan={4}>Gap이 없습니다.</td></tr>}
                    {gaps.map((g) => <tr key={g.id}><td>{g.kind}</td><td>{g.judgement}</td><td>{g.title}</td><td>{g.evidence}</td></tr>)}
                  </tbody>
                </table>
              </td></tr>}
            </tbody>
          </table>
        </article>
      </div>
    </div>
  );
}
