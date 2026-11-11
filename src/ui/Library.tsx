// Step 1 central workspace: asset library as cards (C03-07/08, F1-09). Detail view and "add to project" are separate
// actions (C03-AC5): opening a card never changes the model.
import { useMemo, useState } from 'react';
import xsdReport from '../../assets/aml/xsd-report.json';
import { ASSET_LIBRARY, BUNDLED_AML_FILE, BUNDLED_AML_TEXT, LOADED_LIBRARIES } from '../assets/library';
import { AI_BADGE, GENERATED_META, MATCH_LABEL, resolveGenerated, resolvePhoto } from '../assets/visuals';
import type { AssetDefinition, Project } from '../model/types';
import diagramPusher from './slots/a3687.svg?url';
import diagramBarcode from './slots/238b4.svg?url';
import diagramConveyor from './slots/91c95.svg?url';
import diagramStopper from './slots/stopper.svg?url';
import diagramGantry from './slots/gantry.svg?url';
import diagramPicker from './slots/picker.svg?url';
import diagramSensor from './slots/sensor.svg?url';
import diagramPhotoelectric from './slots/photoelectricSensor.svg?url';
import diagramProximity from './slots/proximitySensor.svg?url';
import diagramLimit from './slots/limitSwitch.svg?url';
import diagramUnitInput from './slots/unitInput.svg?url';
import diagramUnitIdentify from './slots/unitIdentify.svg?url';
import diagramUnitTransfer from './slots/unitTransfer.svg?url';
import { Symbol } from './Symbols';
import { Badge } from './widgets';
import { Fold } from './Fold';
import { PanelSplit } from './PanelSplit';

/**
 * Card diagrams, 100×48. Four kinds keep the handed slot files. Cylinder card 1:594 was returned as the same file as the
 * pusher slot 1:585 (assets-manifest callsites both reference a3687.svg). This app does not redraw a second cylinder.
 * The other ten are card-only SVGs: same size, stroke #245BCE, fill #E5EDFF, no backdrop. Files (not a second Symbol)
 * so every card uses one img path and the canvas Symbol stays unchanged.
 */
export const DIAGRAM_SLOTS: Record<string, { src: string; slot: string; file: string }> = {
  pusher: { src: diagramPusher, slot: '1:585', file: 'a3687.svg' },
  cylinder: { src: diagramPusher, slot: '1:594', file: 'a3687.svg' },
  barcodeReader: { src: diagramBarcode, slot: '1:774', file: '238b4.svg' },
  conveyor: { src: diagramConveyor, slot: '1:778', file: '91c95.svg' },
  stopper: { src: diagramStopper, slot: 'card:stopper', file: 'stopper.svg' },
  gantry: { src: diagramGantry, slot: 'card:gantry', file: 'gantry.svg' },
  picker: { src: diagramPicker, slot: 'card:picker', file: 'picker.svg' },
  sensor: { src: diagramSensor, slot: 'card:sensor', file: 'sensor.svg' },
  photoelectricSensor: { src: diagramPhotoelectric, slot: 'card:photoelectricSensor', file: 'photoelectricSensor.svg' },
  proximitySensor: { src: diagramProximity, slot: 'card:proximitySensor', file: 'proximitySensor.svg' },
  limitSwitch: { src: diagramLimit, slot: 'card:limitSwitch', file: 'limitSwitch.svg' },
  unitInput: { src: diagramUnitInput, slot: 'card:unitInput', file: 'unitInput.svg' },
  unitIdentify: { src: diagramUnitIdentify, slot: 'card:unitIdentify', file: 'unitIdentify.svg' },
  unitTransfer: { src: diagramUnitTransfer, slot: 'card:unitTransfer', file: 'unitTransfer.svg' },
};
export const DIAGRAM_SLOT_W = 100;
export const DIAGRAM_SLOT_H = 48;

const CAT_LABEL: Record<string, string> = { axis: '축/구동', io: 'I/O', sensor: '센서·식별', transport: '이송', unit: '복합 유닛 템플릿' };
const fnv = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };
const BUNDLED_XSD_HASH_MATCH = xsdReport.fnv1a === fnv(BUNDLED_AML_TEXT);
const BUNDLED_XSD_OK = xsdReport.xsdValid === true && BUNDLED_XSD_HASH_MATCH;

export function xsdStatus(def: AssetDefinition): { kind: 'ok' | 'warn'; text: string } {
  if (def.amlSource.origin === 'bundled' && def.amlSource.file === BUNDLED_AML_FILE)
    return BUNDLED_XSD_OK ? { kind: 'ok', text: `공식 CAEX 3.0 XSD 통과 — 앱 밖 개발 환경에서 자동 검사 기록 (${xsdReport.tool}, ${xsdReport.checkedAt}; XSD 파일은 배포에 미포함)` }
      : !BUNDLED_XSD_HASH_MATCH ? { kind: 'warn', text: 'XSD 검증 기록이 현재 번들 AML과 불일치 → 미검증' }
      : { kind: 'warn', text: 'XSD 검증 기록상 실패 → 미검증' };
  return { kind: 'warn', text: '공식 XSD 미검증 (브라우저 안에서는 XSD 검사 안 함 — scripts/validate-aml.py로 별도 검사)' };
}

/** Card figure. Schematic and photo share one slot so the name column does not move. Photo is an AI image, not a real photo. */
export function Visual({ def, mode }: { def: AssetDefinition; mode: 'schematic' | 'photo' }) {
  const slot = DIAGRAM_SLOTS[def.kind];
  const frame = { width: DIAGRAM_SLOT_W, height: DIAGRAM_SLOT_H };
  const diagram = slot
    ? <img src={slot.src} alt="" width={DIAGRAM_SLOT_W} height={DIAGRAM_SLOT_H} />
    : <svg width={DIAGRAM_SLOT_W} height={DIAGRAM_SLOT_H} role="img" aria-label={`${def.name} 도식`}><Symbol kind={def.kind} w={DIAGRAM_SLOT_W} h={DIAGRAM_SLOT_H} /></svg>;
  if (mode === 'photo') {
    const g = resolveGenerated(def.kind);
    if (g.status === 'available') return <div className="slot-diagram" data-visual="photo" style={frame}>
      <img src={g.url} alt={`${def.name} — AI 생성 실사풍 이미지 (실제 사진 아님)`} width={DIAGRAM_SLOT_W} height={DIAGRAM_SLOT_H} />
      <span className="aichip" title={GENERATED_META.label}>{AI_BADGE}</span>
    </div>;
    return <div className="slot-diagram" data-visual="photo-missing" style={frame}>
      {diagram}
      <span className="badge warn slot-missing">AI 이미지 미준비 → 도식</span>
    </div>;
  }
  if (slot) return <div className="slot-diagram" data-visual="schematic" data-slot={slot.slot} data-slot-file={slot.file} style={frame}>{diagram}</div>;
  return <div className="slot-diagram" data-visual="schematic-fallback" style={frame}>{diagram}</div>;
}

interface Props {
  p: Project; locked: boolean; mode: 'schematic' | 'photo'; filter: { q: string; category: string }; libVersion: number;
  setFilter: (f: { q: string; category: string }) => void; setMode: (m: 'schematic' | 'photo') => void;
  onAdd: (def: AssetDefinition, unitId: string | null) => void;
  onImportAml: (f: File) => void; onExportAml: () => void;
  detail: boolean; setDetail: (open: boolean) => void;
  detailWidth: number; onDetailWidth: (n: number) => void;
}

export function LibraryWorkspace(props: Props) {
  const { p, mode, filter } = props;
  const [sel, setSel] = useState<string | null>(null);
  const [target, setTarget] = useState<string>('');
  const defs = useMemo(() => ASSET_LIBRARY.filter((d) => (!filter.category || d.category === filter.category)
    && (!filter.q || `${d.name} ${d.kind} ${d.id}`.toLowerCase().includes(filter.q.toLowerCase()))), [filter, props.libVersion]);
  const def = ASSET_LIBRARY.find((d) => d.id === sel) ?? null;
  return <div className="libws">
    <div className="libmain">
      {props.detail && def ? <AssetDetailSheet def={def} onBack={() => props.setDetail(false)} onAdd={() => props.onAdd(def, def.template ? null : target)} locked={props.locked} unitOk={!!def.template || p.units.some((u) => u.id === target)} /> : <>
      <h1 className="stage-title">에셋 라이브러리</h1>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input placeholder="검색 (이름/키/ID)" value={filter.q} onChange={(e) => props.setFilter({ ...filter, q: e.target.value })} style={{ width: 200 }} />
        <select value={filter.category} onChange={(e) => props.setFilter({ ...filter, category: e.target.value })}><option value="">모든 분류</option>{Object.entries(CAT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <span className="muted" style={{ fontSize: 12 }}>{defs.length} / {ASSET_LIBRARY.length}개 정의 · 출처 AML 파일 {LOADED_LIBRARIES.length}개</span>
        <span className="grow" />
        <button className={mode === 'schematic' ? 'on' : ''} onClick={() => props.setMode('schematic')}>도식</button>
        <button className={mode === 'photo' ? 'on' : ''} onClick={() => props.setMode('photo')} title="AI 생성 실사풍 이미지 — 실제 촬영 사진 아님">실사풍(AI)</button>
        <label className="filebtn"><input type="file" accept=".aml,.xml" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) props.onImportAml(f); e.target.value = ''; }} />AML 가져오기</label>
        <button onClick={props.onExportAml}>AML 라이브러리 내보내기</button>
      </div>
      {mode === 'photo' && <div className="notice warn" role="note"><b>{GENERATED_META.label}.</b> 도식과 같은 방향·구도로 생성한 종류 대표 이미지입니다 (생성: {GENERATED_META.generatedAt}). 표시 전환은 모델·배치·연결·선택을 바꾸지 않습니다. 생성 정보는 카드 상세에서 확인하세요.</div>}
      <div className="cards">
        {defs.map((d) => { const g = resolveGenerated(d.kind); const x = xsdStatus(d); return (
          <div key={d.id} className={`card ${sel === d.id ? 'sel' : ''}`} onClick={() => setSel(d.id)} data-kind={d.kind} role="button" tabIndex={0} aria-pressed={sel === d.id}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel(d.id); } }}>
            <Visual def={d} mode={mode} />
            <div className="cname">{d.name}</div>
            <div className="mono muted card-id">{d.id} · {d.version}</div>
            <div className="card-note">선택하면 상세란 열립니다.</div>
            <div className="cbadges">
              <Badge>{CAT_LABEL[d.category]}</Badge>
              {g.status === 'available' ? <Badge kind="acc">AI 실사풍·종류 대표</Badge> : <Badge kind="warn">AI 이미지 미준비</Badge>}
              <Badge kind={d.amlSource.origin === 'bundled' ? 'ok' : 'acc'}>AML {d.amlSource.origin === 'bundled' ? '번들' : '가져옴'}</Badge>
              <Badge kind={x.kind}>{x.kind === 'ok' ? 'XSD 통과' : 'XSD 미검증'}</Badge>
            </div>
          </div>); })}
        {defs.length === 0 && <div className="muted">조건에 맞는 정의가 없습니다.</div>}
      </div>
      </>}
    </div>
    <PanelSplit kind="library" value={props.detailWidth} onChange={props.onDetailWidth} label="카드 상세 너비" />
    <div className="libdetail">
      <div className="libdetail-body">
      {!def ? <div className="section"><h2>카드 상세</h2><p className="muted">카드를 고르면 이름, AML 출처, 넣을 Unit이 여기에 열립니다. 고르는 것만으로 모델은 바뀌지 않습니다.</p></div>
        : <CardDetail def={def} p={p} mode={mode} locked={props.locked} target={target} setTarget={setTarget} onAdd={props.onAdd} onOpen={() => props.setDetail(true)} />}
      </div>
    </div>
  </div>;
}

function AssetDetailSheet({ def, onBack, onAdd, locked, unitOk }: { def: AssetDefinition; onBack: () => void; onAdd: () => void; locked: boolean; unitOk: boolean }) {
  const x = xsdStatus(def);
  return <div className="sparse-page">
    <div className="tool-pills"><button type="button" onClick={onBack}>목록으로</button></div>
    <h1 className="stage-title">에셋 카드 상세</h1>
    <div className="sparse-split">
      <section className="sheet">
        <h2>{def.name}</h2>
        <p className="field-ro">{def.id} · {def.version} · {def.amlSource.file}</p>
        <table className="grid plain"><tbody>
          <tr><th>분류</th><td>{CAT_LABEL[def.category] ?? def.category}</td></tr>
          <tr><th>명령 포트</th><td>{def.ports.filter((pt) => pt.direction === 'in').map((pt) => pt.label).join(' · ') || '없음'}</td></tr>
          <tr><th>완료 포트</th><td>{def.ports.filter((pt) => pt.direction === 'out').map((pt) => pt.label).join(' · ') || '없음'}</td></tr>
          <tr><th>Action</th><td>{def.actions.map((a) => a.label).join(' · ') || '없음'}</td></tr>
        </tbody></table>
        <button type="button" className="btn-main primary" disabled={locked || !unitOk} onClick={onAdd}>선택 에셋 추가</button>
      </section>
      <aside className="sheet">
        <h2>출처와 적용 전 확인</h2>
        <p>{x.text}</p>
        <p className="muted">도식과 실사풍 전환은 개념 표현입니다. 실사풍은 실제 촬영 사진이 아닙니다.</p>
        <button type="button" className="btn-main secondary" disabled>신호 상세 보기</button>
        <p className="muted">신호와 포지션은 프로젝트에 넣은 뒤 3단계에서 편집합니다. 정의 카드에서는 포트를 읽기만 합니다.</p>
      </aside>
    </div>
  </div>;
}

function CardDetail({ def, p, mode, locked, target, setTarget, onAdd, onOpen }: { def: AssetDefinition; p: Project; mode: 'schematic' | 'photo'; locked: boolean; target: string; setTarget: (s: string) => void; onAdd: Props['onAdd']; onOpen: () => void }) {
  const ph = resolvePhoto(def); const gen = resolveGenerated(def.kind); const x = xsdStatus(def);
  const lib = LOADED_LIBRARIES.find((l) => l.file === def.amlSource.file);
  const diags = lib?.result.diags.filter((d) => d.where.startsWith(def.amlSource.sucPath)) ?? [];
  const isUnit = !!def.template;
  const unitOk = isUnit || p.units.some((u) => u.id === target);
  return <div>
    <div className="section">
      <h2>{def.name}</h2>
      <p className="muted">정의 {def.id}@{def.version}<br />{x.kind === 'ok' ? '번들 AML · XSD 구조 검사 기록 있음' : 'XSD 미검증'} · {def.amlSource.file}</p>
      <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
        {isUnit ? <span className="muted" style={{ fontSize: 12 }}>새 Unit + 자식 {def.template!.children.length}개 생성</span>
          : <><label>넣을 Unit</label><select value={target} onChange={(e) => setTarget(e.target.value)}><option value="">(Unit 선택)</option>{p.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></>}
        <button className="primary" disabled={locked || !unitOk} onClick={() => onAdd(def, isUnit ? null : target)} title={locked ? '실행 중에는 추가 불가' : ''}>프로젝트에 추가</button>
        <button type="button" onClick={onOpen}>카드 상세</button>
      </div>
      {!isUnit && p.units.length === 0 && <div className="notice">Device는 Unit 안에만 놓을 수 있습니다. 먼저 유닛 템플릿을 추가하거나 2단계 Canvas에서 빈 Unit을 배치하세요.</div>}
      {locked && <div className="notice warn">실행 중 — 조회만 가능, 추가·수정 차단 (C10-08)</div>}
    </div>
    <Fold className="lib-more" summary="AML·속성·포트 자세히">
    <div className="section"><h4>AML 원본 · 지원 상태</h4>
      <div className="row"><label>파일</label><span className="mono" style={{ fontSize: 11 }}>{def.amlSource.file}</span></div>
      <div className="row"><label>SUC 경로</label><span className="mono" style={{ fontSize: 11 }}>{def.amlSource.sucPath}</span></div>
      <div className="row"><label>RoleClass</label><span className="mono" style={{ fontSize: 11 }}>{def.roleClassPath}</span></div>
      <div className="row"><label>CAEX</label><span>{lib?.result.meta.schemaVersion ?? '?'} · {lib?.result.meta.superiorStandard.join(', ') || '-'}</span></div>
      <div className="row"><label>앱 subset</label><Badge kind="ok">해석 성공</Badge><span className="muted" style={{ fontSize: 11 }}>경고 {diags.length}</span></div>
      <div className="row"><label>공식 XSD</label><Badge kind={x.kind}>{x.kind === 'ok' ? '통과' : '미검증'}</Badge></div>
      <div className="muted" style={{ fontSize: 11 }}>{x.text}. 표시는 {mode === 'photo' ? '실사풍' : '도식'}입니다. XSD 통과는 구조 적합성만 의미하며 AutomationML 의미 규칙 전체 적합성 인증이 아닙니다.</div>
      {diags.map((d, i) => <div key={i} style={{ fontSize: 11, color: d.severity === 'error' ? 'var(--danger)' : 'var(--warning)' }}>[{d.code}] {d.message}</div>)}
    </div>
    {def.properties.length > 0 && <div className="section"><h4>속성 (Attribute)</h4><table className="grid"><tbody>{def.properties.map((pp) => <tr key={pp.key}><td>{pp.label}{pp.requiredForRun ? ' *' : ''}</td><td className="mono">{pp.defaultValue ?? '미정'} {pp.unit}</td><td className="muted">[예시]</td></tr>)}</tbody></table></div>}
    {def.ports.length > 0 && <div className="section"><h4>포트 (ExternalInterface)</h4><table className="grid"><tbody>{def.ports.map((pt) => <tr key={pt.key}><td>{pt.label}</td><td className="mono">{pt.key}</td><td>{pt.direction}</td><td>{pt.role}</td></tr>)}</tbody></table></div>}
    {def.actions.length > 0 && <div className="section"><h4>Action (앱 확장)</h4><table className="grid"><tbody>{def.actions.map((a) => <tr key={a.key}><td>{a.label}</td><td className="mono">{a.commandPort} → {a.completePort ?? '미정'}</td><td className="mono">{a.durationS ?? '미정'}s / TO {a.timeoutS ?? '미정'}s</td></tr>)}</tbody></table></div>}
    {def.template && <div className="section"><h4>유닛 템플릿 (InternalElement / InternalLink)</h4>
      <table className="grid"><tbody>{def.template.children.map((c) => <tr key={c.localId}><td className="mono">{c.localId}</td><td>{c.label}</td><td className="mono" style={{ fontSize: 10 }}>{c.assetId}</td></tr>)}</tbody></table>
      {def.template.links.map((l, i) => <div key={i} className="mono" style={{ fontSize: 11 }}>링크: {l.from.child}.{l.from.port} → {l.to.child}.{l.to.port}</div>)}
      {def.template.rules.map((r, i) => <div key={i} style={{ fontSize: 11 }}>규칙: {r.child}.{r.action} 사전조건 {r.pre.map((x) => `${x.child}.${x.port}=${x.equals}`).join(', ')} <span className="muted">(가정)</span></div>)}
      <div className="muted" style={{ fontSize: 11 }}>배치할 때마다 새 Unit/Device/Signal/Action ID를 만들고 내부 링크를 새 ID로 재연결. 인스턴스끼리·정의와 편집이 전파되지 않음. Unit 자체 외부 포트는 없고 자식 Device의 포트가 그대로 노출됨(시제품 계약).</div>
    </div>}
    <div className="section"><h4>시각 자료</h4>
      <div className="row"><label>도식</label><span className="mono" style={{ fontSize: 11 }}>{def.visualRefs.schematic ?? '없음'}</span></div>
      {gen.status === 'available' ? <div style={{ fontSize: 12 }}>
        <div className="cbadges"><Badge kind="acc">{AI_BADGE} 실사풍 이미지</Badge><Badge kind="warn">실제 촬영 사진 아님</Badge><Badge kind="warn">정확 모델 일치: 아니오</Badge><Badge>대표 범위: 종류(class)</Badge><Badge>검토: 에이전트 대조 · 사람 검수 전</Badge></div>
        <table className="grid kv" style={{ marginTop: 6 }}><tbody>
          <tr><th>생성 도구</th><td>{gen.meta.tool}</td></tr>
          <tr><th>생성일</th><td>{gen.meta.generatedAt}</td></tr>
          <tr><th>방향·구도</th><td>{gen.info.orientation}</td></tr>
          <tr><th>구도 참고</th><td className="mono">{gen.info.referenceImage}</td></tr>
          <tr><th>생성 지시(brief)</th><td style={{ fontSize: 11 }}>{gen.info.brief}</td></tr>
          <tr><th>공통 지시</th><td style={{ fontSize: 11 }}>{gen.meta.commonBrief}</td></tr>
          <tr><th>파일</th><td className="mono" style={{ fontSize: 10 }}>generated/{gen.info.file} · {gen.info.savedSize.join('×')} · {gen.info.bytes} B · sha256 {gen.info.sha256.slice(0, 12)}…</td></tr>
          <tr><th>사용 조건</th><td style={{ fontSize: 11 }}>{gen.meta.usageTerms}</td></tr>
        </tbody></table>
        <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{gen.meta.toggleRule}. {gen.meta.reviewNote}. AI 이미지는 앱 표시 계층이며 AML에 들어가지 않습니다.</div>
      </div> : <div className="notice warn">{gen.reason}</div>}
      <Fold className="history" summary="이전 참고 사진 (v0.2 출처 이력)">
        <div className="row"><label>AML 사진 참조</label><span className="mono" style={{ fontSize: 11 }}>{def.visualRefs.photo ?? '없음'}</span></div>
        {ph.status === 'available' ? <div style={{ fontSize: 12 }}>
          <div><Badge>{MATCH_LABEL[ph.scope?.matchType ?? 'class-reference']}</Badge> <Badge>촬영 유형: {ph.info.captureType === 'actual-photo' ? '실제 촬영 사진(제3자, 생성 이미지 아님)' : '미확인'}</Badge></div>
          <div style={{ marginTop: 4 }}>{ph.info.title} — {ph.info.author} — <a href={ph.info.licenseUrl} target="_blank" rel="noreferrer">{ph.info.license}</a> — <a href={ph.info.sourcePageUrl} target="_blank" rel="noreferrer">출처 페이지</a></div>
          <div className="muted" style={{ fontSize: 11 }}>{ph.info.attribution}. {GENERATED_META.previousPhotos}.</div>
        </div> : <div className="muted">{ph.reason}</div>}
      </Fold>
    </div>
    </Fold>
  </div>;
}

export function AmlLoadStatus({ libVersion: _v }: { libVersion: number }) {
  return <div style={{ marginTop: 10 }}><h4>AML 로드 상태</h4>
    <table className="grid"><thead><tr><th>파일</th><th>출처</th><th>CAEX</th><th>정의</th><th>오류/경고</th></tr></thead><tbody>
      {LOADED_LIBRARIES.map((l, i) => <tr key={i} className={l.result.ok ? '' : 'err'}><td className="mono" style={{ fontSize: 10 }}>{l.file}</td><td>{l.origin === 'bundled' ? '번들' : '가져옴'}</td><td>{l.result.meta.schemaVersion ?? '?'}</td><td>{l.result.defs.length}</td>
        <td>{l.result.diags.filter((d) => d.severity === 'error').length} / {l.result.diags.filter((d) => d.severity === 'warning').length}</td></tr>)}
    </tbody></table>
    <div className="muted" style={{ fontSize: 11 }}>단계: ① XML 구문 ② CAEX 루트·namespace·SchemaVersion 3.0 ③ 앱 subset 의미 검사(타입·단위·포트 방향·Action 포트·자식 참조·링크 방향) ④ 공식 XSD = 번들 파일만 빌드 전 검사, 가져온 파일은 미검증.</div>
  </div>;
}
