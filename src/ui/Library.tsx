// Step 1 central workspace: asset library as cards (C03-07/08, F1-09). Detail view and "add to project" are separate
// actions (C03-AC5): opening a card never changes the model.
import { useMemo, useState } from 'react';
import xsdReport from '../../assets/aml/xsd-report.json';
import { ASSET_LIBRARY, BUNDLED_AML_FILE, BUNDLED_AML_TEXT, LOADED_LIBRARIES } from '../assets/library';
import { MATCH_LABEL, MATCH_SHORT, PHOTO_COMMON_NOTICE, resolvePhoto } from '../assets/visuals';
import type { AssetDefinition, Project } from '../model/types';
import { Symbol } from './Symbols';
import { Badge } from './widgets';

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

export function Visual({ def, mode, w, h }: { def: AssetDefinition; mode: 'schematic' | 'photo'; w: number; h: number }) {
  const ph = mode === 'photo' ? resolvePhoto(def) : null;
  if (ph && ph.status === 'available') return <img src={ph.url} alt={`${def.name} 참고 사진 — ${ph.info.title}`} style={{ width: w, height: h, objectFit: 'cover', borderRadius: 4, display: 'block' }} />;
  return <div style={{ position: 'relative' }}><svg width={w} height={h} style={{ display: 'block' }}><Symbol kind={def.kind} w={w} h={h} /></svg>
    {ph && <span className="badge warn" style={{ position: 'absolute', left: 2, bottom: 2, background: 'var(--panel)' }}>실제 사진 미확보 → 도식</span>}</div>;
}

interface Props {
  p: Project; locked: boolean; mode: 'schematic' | 'photo'; filter: { q: string; category: string }; libVersion: number;
  setFilter: (f: { q: string; category: string }) => void; setMode: (m: 'schematic' | 'photo') => void;
  onAdd: (def: AssetDefinition, unitId: string | null) => void;
  onImportAml: (f: File) => void; onExportAml: () => void;
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
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input placeholder="검색 (이름/키/ID)" value={filter.q} onChange={(e) => props.setFilter({ ...filter, q: e.target.value })} style={{ width: 200 }} />
        <select value={filter.category} onChange={(e) => props.setFilter({ ...filter, category: e.target.value })}><option value="">모든 분류</option>{Object.entries(CAT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <span className="muted" style={{ fontSize: 12 }}>{defs.length} / {ASSET_LIBRARY.length}개 정의 · 출처 AML 파일 {LOADED_LIBRARIES.length}개</span>
        <span className="grow" />
        <button className={mode === 'schematic' ? 'on' : ''} onClick={() => props.setMode('schematic')}>도식</button>
        <button className={mode === 'photo' ? 'on' : ''} onClick={() => props.setMode('photo')}>실사진</button>
        <label className="filebtn"><input type="file" accept=".aml,.xml" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) props.onImportAml(f); e.target.value = ''; }} />AML 가져오기</label>
        <button onClick={props.onExportAml}>AML 라이브러리 내보내기</button>
      </div>
      {mode === 'photo' && <div className="notice warn">{PHOTO_COMMON_NOTICE}. 실사진은 Wikimedia Commons 참고 사진이며 대표 범위(종류/구성품/조립체)를 카드에 표시합니다. 표시 전환은 모델을 바꾸지 않습니다.</div>}
      <div className="cards">
        {defs.map((d) => { const ph = resolvePhoto(d); const x = xsdStatus(d); return (
          <div key={d.id} className={`card ${sel === d.id ? 'sel' : ''}`} onClick={() => setSel(d.id)} data-kind={d.kind}>
            <Visual def={d} mode={mode} w={168} h={96} />
            <div className="cname">{d.name}</div>
            <div className="mono muted" style={{ fontSize: 10 }}>{d.kind} · {d.id}@{d.version}</div>
            <div className="cbadges">
              <Badge>{CAT_LABEL[d.category]}</Badge>
              {ph.status === 'available' ? <Badge kind="acc">실사진·{ph.scope ? MATCH_SHORT[ph.scope.matchType] : '범위 미확인'}</Badge> : <Badge kind="warn">실사진 미확보</Badge>}
              <Badge kind={d.amlSource.origin === 'bundled' ? 'ok' : 'acc'}>AML {d.amlSource.origin === 'bundled' ? '번들' : '가져옴'}</Badge>
              <Badge kind={x.kind}>{x.kind === 'ok' ? 'XSD 통과' : 'XSD 미검증'}</Badge>
            </div>
          </div>); })}
        {defs.length === 0 && <div className="muted">조건에 맞는 정의가 없습니다.</div>}
      </div>
    </div>
    <div className="libdetail">
      {!def ? <div className="section"><h4>카드 상세</h4><div className="muted">카드를 클릭하면 상세(AML 원본·속성·포트·Action·사진 출처)를 봅니다. 상세 보기만으로는 모델이 바뀌지 않습니다.</div><AmlLoadStatus libVersion={props.libVersion} /></div>
        : <CardDetail def={def} p={p} mode={mode} locked={props.locked} target={target} setTarget={setTarget} onAdd={props.onAdd} />}
    </div>
  </div>;
}

function CardDetail({ def, p, mode, locked, target, setTarget, onAdd }: { def: AssetDefinition; p: Project; mode: 'schematic' | 'photo'; locked: boolean; target: string; setTarget: (s: string) => void; onAdd: Props['onAdd'] }) {
  const ph = resolvePhoto(def); const x = xsdStatus(def);
  const lib = LOADED_LIBRARIES.find((l) => l.file === def.amlSource.file);
  const diags = lib?.result.diags.filter((d) => d.where.startsWith(def.amlSource.sucPath)) ?? [];
  const isUnit = !!def.template;
  const unitOk = isUnit || p.units.some((u) => u.id === target);
  return <div>
    <div className="section">
      <div className="row" style={{ justifyContent: 'space-between' }}><b>{def.name}</b><span className="mono" style={{ fontSize: 11, color: 'var(--accent)' }}>{def.id}@{def.version}</span></div>
      <Visual def={def} mode={mode} w={290} h={150} />
      <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
        {isUnit ? <span className="muted" style={{ fontSize: 12 }}>새 Unit + 자식 {def.template!.children.length}개 생성</span>
          : <><label>넣을 Unit</label><select value={target} onChange={(e) => setTarget(e.target.value)}><option value="">(Unit 선택)</option>{p.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></>}
        <button className="primary" disabled={locked || !unitOk} onClick={() => onAdd(def, isUnit ? null : target)} title={locked ? '실행 중에는 추가 불가' : ''}>프로젝트에 추가</button>
      </div>
      {!isUnit && p.units.length === 0 && <div className="notice">Device는 Unit 안에만 놓을 수 있습니다. 먼저 유닛 템플릿을 추가하거나 2단계 Canvas에서 빈 Unit을 배치하세요.</div>}
      {locked && <div className="notice warn">실행 중 — 조회만 가능, 추가·수정 차단 (C10-08)</div>}
    </div>
    <div className="section"><h4>AML 원본 · 지원 상태</h4>
      <div className="row"><label>파일</label><span className="mono" style={{ fontSize: 11 }}>{def.amlSource.file}</span></div>
      <div className="row"><label>SUC 경로</label><span className="mono" style={{ fontSize: 11 }}>{def.amlSource.sucPath}</span></div>
      <div className="row"><label>RoleClass</label><span className="mono" style={{ fontSize: 11 }}>{def.roleClassPath}</span></div>
      <div className="row"><label>CAEX</label><span>{lib?.result.meta.schemaVersion ?? '?'} · {lib?.result.meta.superiorStandard.join(', ') || '-'}</span></div>
      <div className="row"><label>앱 subset</label><Badge kind="ok">해석 성공</Badge><span className="muted" style={{ fontSize: 11 }}>경고 {diags.length}</span></div>
      <div className="row"><label>공식 XSD</label><Badge kind={x.kind}>{x.kind === 'ok' ? '통과' : '미검증'}</Badge></div>
      <div className="muted" style={{ fontSize: 11 }}>{x.text}. XSD 통과 = 구조 적합성만 의미하며 AutomationML 의미 규칙 전체 적합성 인증 아님. Action·시간·NamePrefix·템플릿 배치/규칙은 앱 확장(ECD.AppExtension).</div>
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
      <div className="row"><label>사진 참조</label><span className="mono" style={{ fontSize: 11 }}>{def.visualRefs.photo ?? '없음'}</span></div>
      {ph.status === 'available' ? <div style={{ fontSize: 12 }}>
        <div><Badge kind="acc">{MATCH_LABEL[ph.scope?.matchType ?? 'class-reference']}</Badge> <Badge kind="warn">정확 모델 일치: {ph.scope?.exactModelMatch ? '예' : '아니오'}</Badge> <Badge>촬영 유형: {ph.info.captureType === 'actual-photo' ? '실제 촬영 사진(생성 이미지 아님)' : '미확인'}</Badge></div>
        <div className="muted" style={{ marginTop: 4 }}>{ph.scope?.note}</div>
        <div style={{ marginTop: 4 }}>{ph.info.title} — {ph.info.author} — <a href={ph.info.licenseUrl} target="_blank" rel="noreferrer">{ph.info.license}</a> — <a href={ph.info.sourcePageUrl} target="_blank" rel="noreferrer">출처 페이지</a></div>
        <div className="muted" style={{ fontSize: 11 }}>{ph.info.attribution}</div>
      </div> : <div className="notice warn">{ph.reason}</div>}
    </div>
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
