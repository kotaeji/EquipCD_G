import { useState } from 'react';
import { findAsset } from '../assets/library';
import { AI_BADGE, GENERATED_META, resolveGenerated } from '../assets/visuals';
import * as C from '../model/commands';
import type { Gap } from '../model/gaps';
import type { Action, Condition, Project } from '../model/types';
import { condLabel, devName, effectLabel, sigName, unitName } from './labels';
import { Badge, QtyInput, TextInput } from './widgets';

export type EditFn = (r: C.CmdResult, label: string) => boolean;

interface Props {
  project: Project;
  selectedId: string | null;
  locked: boolean;
  gaps: Gap[];
  edit: EditFn;
  onAddStep: (actionId: string) => void;
  onDelete: (id: string) => void;
  onReparent: (deviceId: string, unitId: string) => void;
  tab: string;
  setTab: (t: string) => void;
  visualMode: 'schematic' | 'photo';
}

function ConditionEditor({ p, list, onChange, disabled }: { p: Project; list: Condition[]; onChange: (l: Condition[]) => void; disabled: boolean }) {
  const [kind, setKind] = useState<Condition['kind']>('signal');
  const [target, setTarget] = useState('');
  const [eq, setEq] = useState(true);
  const add = () => {
    let c: Condition | null = null;
    if (kind === 'signal' && target) c = { kind, signalId: target, equals: eq };
    if (kind === 'materialAt' && target) c = { kind, unitId: target };
    if (kind === 'materialState' && target) c = { kind, state: target };
    if (kind === 'materialHeldBy') c = { kind, deviceId: target || null };
    if (kind === 'undefined') c = { kind, note: target || '미정 조건' };
    if (c) onChange([...list, c]);
  };
  const states = p.materials[0]?.states ?? [];
  return (
    <div>
      {list.length === 0 && <div className="muted" style={{ fontSize: 11 }}>(없음)</div>}
      {list.map((c, i) => (
        <div key={i} className="row" style={{ minHeight: 22 }}>
          <span style={{ flex: 1, fontSize: 11, color: c.kind === 'undefined' ? 'var(--warning)' : undefined }}>{condLabel(p, c)}</span>
          <button className="small" disabled={disabled} onClick={() => onChange(list.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <select value={kind} disabled={disabled} onChange={(e) => { setKind(e.target.value as Condition['kind']); setTarget(''); }}>
          <option value="signal">Signal 값</option><option value="materialAt">자재 위치</option><option value="materialState">자재 상태</option><option value="materialHeldBy">자재 잡음</option><option value="undefined">미정(메모)</option>
        </select>
        {kind === 'signal' && <><select value={target} disabled={disabled} onChange={(e) => setTarget(e.target.value)} style={{ width: 150 }}><option value="">Signal 선택</option>{p.signals.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select value={String(eq)} disabled={disabled} onChange={(e) => setEq(e.target.value === 'true')}><option value="true">= true</option><option value="false">= false</option></select></>}
        {kind === 'materialAt' && <select value={target} disabled={disabled} onChange={(e) => setTarget(e.target.value)}><option value="">Unit 선택</option>{p.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>}
        {kind === 'materialState' && <select value={target} disabled={disabled} onChange={(e) => setTarget(e.target.value)}><option value="">상태 선택</option>{states.map((s) => <option key={s}>{s}</option>)}</select>}
        {kind === 'materialHeldBy' && <select value={target} disabled={disabled} onChange={(e) => setTarget(e.target.value)}><option value="">없음(비어 있음)</option>{p.devices.filter((d) => d.kind === 'picker').map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}
        {kind === 'undefined' && <input value={target} disabled={disabled} placeholder="미정 내용" onChange={(e) => setTarget(e.target.value)} />}
        <button className="small" disabled={disabled} onClick={add}>+ 조건</button>
      </div>
    </div>
  );
}

function ActionEditor({ p, a, locked, edit, onAddStep }: { p: Project; a: Action; locked: boolean; edit: EditFn; onAddStep: (id: string) => void }) {
  const devSignals = p.signals.filter((s) => s.deviceId === a.deviceId);
  const states = p.materials[0]?.states ?? [];
  const used = p.sequence.steps.filter((s) => s.actionId === a.id);
  const upd = (patch: Parameters<typeof C.updateAction>[2], label: string) => edit(C.updateAction(p, a.id, patch), label);
  return (
    <div className="section">
      <div className="row"><TextInput value={a.name} disabled={locked} width={220} onCommit={(v) => edit(C.renameObject(p, a.id, v), 'Action 이름')} /></div>
      <div className="row"><label>ID</label><span className="mono muted" style={{ fontSize: 11 }}>{a.id}</span></div>
      <div className="row"><label>동작 시간</label><QtyInput q={a.duration} disabled={locked} onCommit={(v, as) => edit(C.setQuantity(p, { kind: 'action', id: a.id, field: 'duration' }, v, as), '동작 시간')} /></div>
      <div className="row"><label>타임아웃</label><QtyInput q={a.timeout} disabled={locked} onCommit={(v, as) => edit(C.setQuantity(p, { kind: 'action', id: a.id, field: 'timeout' }, v, as), '타임아웃')} /></div>
      <div className="row"><label>명령 Signal</label><select disabled={locked} value={a.commandSignalId ?? ''} onChange={(e) => upd({ commandSignalId: e.target.value || null }, '명령 Signal')} style={{ width: 170 }}><option value="">(없음)</option>{devSignals.filter((s) => s.direction === 'in').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
      <div className="row"><label>완료 조건</label><select disabled={locked} value={a.completeSignalId ?? ''} onChange={(e) => upd({ completeSignalId: e.target.value || null }, '완료 Signal')} style={{ width: 150 }}><option value="">(미정)</option>{devSignals.filter((s) => s.direction === 'out').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select><span className="mono muted">= true</span></div>
      {!a.completeSignalId && <div className="notice warn">완료 조건 미정 — 실행 준비 검사에서 차단, Gap(부족 I/O) 표시</div>}
      <div className="row"><label>목표 Position</label><select disabled={locked} value={a.targetPositionId ?? ''} onChange={(e) => upd({ targetPositionId: e.target.value || null }, '목표 Position')} style={{ width: 170 }}><option value="">(없음)</option>{p.positions.filter((x) => x.deviceId === a.deviceId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
      <h4 style={{ marginTop: 8 }}>전제(pre) 조건</h4>
      <ConditionEditor p={p} list={a.pre} disabled={locked} onChange={(l) => upd({ pre: l }, 'pre 조건')} />
      <h4 style={{ marginTop: 8 }}>완료 후(post) 검증 조건</h4>
      <ConditionEditor p={p} list={a.post} disabled={locked} onChange={(l) => upd({ post: l }, 'post 조건')} />
      <h4 style={{ marginTop: 8 }}>자재 변화 (완료 시)</h4>
      <div className="row"><label>위치 이동</label><select disabled={locked} value={a.effect.moveTo ?? ''} onChange={(e) => { const eff = { ...a.effect }; if (e.target.value) eff.moveTo = e.target.value; else delete eff.moveTo; upd({ effect: eff }, '자재 이동'); }}><option value="">(변화 없음)</option>{p.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}<option value="EXIT">배출(장비 밖)</option></select></div>
      <div className="row"><label>상태 변경</label><select disabled={locked} value={a.effect.setState ?? ''} onChange={(e) => { const eff = { ...a.effect }; if (e.target.value) eff.setState = e.target.value; else delete eff.setState; upd({ effect: eff }, '자재 상태'); }}><option value="">(변화 없음)</option>{states.map((s) => <option key={s}>{s}</option>)}</select></div>
      <div className="row"><label>잡기/놓기</label><select disabled={locked} value={a.effect.holder === undefined ? '' : a.effect.holder === null ? '__release' : a.effect.holder} onChange={(e) => { const eff = { ...a.effect }; if (e.target.value === '') delete eff.holder; else eff.holder = e.target.value === '__release' ? null : e.target.value; upd({ effect: eff }, '잡기/놓기'); }}><option value="">(변화 없음)</option><option value="__release">놓기(해제)</option>{p.devices.filter((d) => d.kind === 'picker').map((d) => <option key={d.id} value={d.id}>{d.name} 잡음</option>)}</select></div>
      <div className="row" style={{ marginTop: 6 }}>
        <button disabled={locked} onClick={() => onAddStep(a.id)}>시퀀스 끝에 추가</button>
        <button className="danger" disabled={locked} onClick={() => edit(C.deleteAction(p, a.id), 'Action 삭제')}>Action 삭제</button>
        {used.length > 0 && <span className="muted" style={{ fontSize: 11 }}>사용 단계 {used.length}</span>}
      </div>
    </div>
  );
}

export function CapabilityTable({ p, unitId }: { p: Project; unitId: string }) {
  const acts = p.actions.filter((a) => a.unitId === unitId);
  const interlocks = (a: Action) => p.constraints.filter((k) => k.relatedIds.includes(a.deviceId));
  return (
    <table className="grid">
      <thead><tr><th>동작(Action)</th><th>I/O (명령→완료)</th><th>Position</th><th>자재 변화</th><th>전제/금지</th><th>근거</th></tr></thead>
      <tbody>{acts.map((a) => (
        <tr key={a.id}>
          <td>{a.name}<div className="muted mono" style={{ fontSize: 10 }}>{devName(p, a.deviceId)}</div></td>
          <td style={{ fontSize: 11 }}>{sigName(p, a.commandSignalId)} → {a.completeSignalId ? sigName(p, a.completeSignalId) : <Badge kind="warn">완료 미정</Badge>}</td>
          <td style={{ fontSize: 11 }}>{a.targetPositionId ? p.positions.find((x) => x.id === a.targetPositionId)?.name : '-'}</td>
          <td style={{ fontSize: 11 }}>{effectLabel(p, a.effect)}</td>
          <td style={{ fontSize: 11 }}>{a.pre.map((c) => condLabel(p, c)).join('; ') || '-'}{interlocks(a).map((k) => <div key={k.id}><Badge kind={k.confirmation === 'confirmed' ? 'ok' : 'warn'}>IL {k.confirmation === 'confirmed' ? '확인됨' : '후보'}</Badge> {k.description}</div>)}</td>
          <td style={{ fontSize: 10 }} className="muted">시간 {a.duration.value ?? '미정'}s{a.duration.assumption ? '(가정)' : ''} · {a.duration.source?.method ?? '-'}</td>
        </tr>))}
        {acts.length === 0 && <tr><td colSpan={6} className="muted">Action 없음</td></tr>}
      </tbody>
    </table>
  );
}

export function Inspector(props: Props) {
  const { project: p, selectedId, locked, edit, tab, setTab } = props;
  const unit = p.units.find((u) => u.id === selectedId);
  const dev = p.devices.find((d) => d.id === selectedId);
  const conn = p.connections.find((c) => c.id === selectedId);
  const relatedGaps = props.gaps.filter((g) => selectedId && g.objectIds.includes(selectedId));

  if (!selectedId || (!unit && !dev && !conn)) {
    return <div className="section"><h4>속성</h4><div className="muted">캔버스나 트리에서 Unit / Device / 연결을 선택하세요.</div>
      <div className="notice">Device는 팔레트에서 Unit 영역 안으로 드래그해 놓습니다. Unit은 팔레트의 “유닛”을 빈 곳에 놓습니다.</div>
      <h4 style={{ marginTop: 12 }}>Interlock 후보 (사람 확인 필요)</h4>
      {p.constraints.map((k) => <InterlockRow key={k.id} p={p} id={k.id} locked={locked} edit={edit} />)}
    </div>;
  }
  if (conn) {
    return <div className="section"><h4>연결 {conn.kind === 'flow' ? '(물류 흐름)' : '(논리 신호)'}</h4>
      <div className="row"><label>ID</label><span className="mono">{conn.id}</span></div>
      <div className="row"><label>From</label>{conn.kind === 'flow' ? unitName(p, conn.from.nodeId) : sigName(p, conn.from.signalId)}</div>
      <div className="row"><label>To</label>{conn.kind === 'flow' ? unitName(p, conn.to.nodeId) : sigName(p, conn.to.signalId)}</div>
      <div className="notice">{conn.kind === 'flow' ? '물류 연결선은 자재를 자동 이동시키지 않습니다. 이동은 Action의 자재 변화로만 일어납니다.' : '신호 연결은 논리 관계 표시이며 이번 시제품 런타임은 시퀀스 단계의 명령/완료 Signal로 진행합니다.'}</div>
      <button className="danger" disabled={locked} onClick={() => edit(C.deleteConnection(p, conn.id), '연결 삭제')}>연결 삭제</button>
    </div>;
  }
  if (unit) {
    return <div>
      <div className="section">
        <h4>Unit</h4>
        <div className="row"><label>이름</label><TextInput value={unit.name} disabled={locked} onCommit={(v) => edit(C.renameObject(p, unit.id, v), 'Unit 이름')} /></div>
        <div className="row"><label>ID / 코드</label><span className="mono">{unit.id} · {unit.code}</span></div>
        <div className="row"><label>소속</label>{p.equipment.name} &gt; {unit.name}</div>
        {unit.templateRef && <div className="row"><label>유닛 템플릿</label><span className="mono" style={{ fontSize: 11 }}>{unit.templateRef.assetId}@{unit.templateRef.version} (고정, 인스턴스별 독립 편집)</span></div>}
        <div className="row"><label>수용 개수</label><QtyInput q={unit.capacity.maxMaterials} disabled={locked} onCommit={(v, as) => edit(C.setQuantity(p, { kind: 'unitCap', id: unit.id, field: 'maxMaterials' }, v, as), '수용 개수')} /></div>
        <div className="row"><label>허용 무게</label><QtyInput q={unit.capacity.maxWeight} disabled={locked} onCommit={(v, as) => edit(C.setQuantity(p, { kind: 'unitCap', id: unit.id, field: 'maxWeight' }, v, as), '허용 무게')} /></div>
        <div className="row"><label>Device</label><span>{unit.deviceIds.map((d) => devName(p, d)).join(', ') || '(없음)'}</span></div>
        <button className="danger" disabled={locked} onClick={() => props.onDelete(unit.id)}>Unit 삭제(영향 확인)</button>
      </div>
      <div className="section"><h4>제공 능력표 (F3-03, 자동 생성)</h4><CapabilityTable p={p} unitId={unit.id} /></div>
      <GapList gaps={relatedGaps} />
    </div>;
  }
  const d = dev!;
  const def = findAsset(d.kind);
  if (!def) return <div className="section"><div className="notice err">에셋 정의 {d.definitionRef.assetId}@{d.definitionRef.version} 을(를) 라이브러리에서 찾을 수 없음 (가져온 AML이 다시 로드되지 않음?) — 모델은 보존됨</div></div>;
  const gen = resolveGenerated(d.kind);
  const unitT = p.units.find((u) => u.id === d.unitId)?.templateRef;
  const sigs = p.signals.filter((s) => s.deviceId === d.id);
  const poss = p.positions.filter((x) => x.deviceId === d.id);
  const acts = p.actions.filter((a) => a.deviceId === d.id);
  return <div>
    <div className="section">
      <div className="row" style={{ justifyContent: 'space-between' }}><b>{def.name}</b><span className="mono" style={{ color: 'var(--accent)' }}>{d.id}</span></div>
      <div className="row"><label>이름</label><TextInput value={d.name} disabled={locked} onCommit={(v) => edit(C.renameObject(p, d.id, v), 'Device 이름')} /></div>
      <div className="row"><label>정의</label><span className="mono" style={{ fontSize: 11 }}>{d.definitionRef.assetId}@{d.definitionRef.version} (고정)</span></div>
      <div className="row"><label>Substation</label><select disabled={locked} value={d.unitId} onChange={(e) => props.onReparent(d.id, e.target.value)}>{p.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
      <div className="row"><label>시각</label>{props.visualMode === 'photo' ? (gen.status === 'available' ? <span title={GENERATED_META.label}><Badge kind="acc">{AI_BADGE} 실사풍 (실제 사진 아님) · 종류 대표</Badge></span> : <Badge kind="warn">AI 이미지 미준비 → 도식</Badge>) : <Badge>도식 사용 중</Badge>}</div>
      <div className="muted" style={{ fontSize: 11 }}>AML 원본: {def.amlSource.file} · {def.amlSource.sucPath}{d.templateChild ? ` · 템플릿 자식 ${d.templateChild}${unitT ? ` (${unitT.assetId}@${unitT.version})` : ''}` : ''}</div>
    </div>
    <div className="tabs">{[['props', '속성'], ['signals', `신호 ${sigs.length}`], ['positions', `포지션 ${poss.length}`], ['actions', `Action ${acts.length}`], ['check', '정의 체크']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
    {tab === 'props' && <div className="section">
      {def.properties.map((pd) => { const qv = d.properties[pd.key]; return qv ? <div key={pd.key} className="row"><label>{pd.label}{pd.requiredForRun ? ' *' : ''}</label><QtyInput q={qv} disabled={locked} onCommit={(v, as) => edit(C.setDeviceProperty(p, d.id, pd.key, v, as), `${pd.label} 변경`)} /></div> : null; })}
      <div className="muted" style={{ fontSize: 11 }}>* 실행/수용 판정에 필요 (비우면 미정 축 사양 Gap). 빈 값 = 미정, 0과 다름.</div>
      <button className="danger" style={{ marginTop: 8 }} disabled={locked} onClick={() => props.onDelete(d.id)}>Device 삭제(영향 확인)</button>
    </div>}
    {tab === 'signals' && <div className="section">
      {sigs.map((s) => <div key={s.id} style={{ borderBottom: '1px solid var(--border)', padding: '4px 0' }}>
        <div className="row"><TextInput value={s.name} disabled={locked} width={160} onCommit={(v) => edit(C.renameObject(p, s.id, v), 'Signal 이름')} />
          <Badge kind={s.direction === 'in' ? 'acc' : undefined}>{s.direction === 'in' ? '입력 in' : '출력 out'}</Badge><Badge>{s.role}</Badge></div>
        <div className="row"><label>실제 주소</label><TextInput value={s.address ?? ''} width={90} disabled={locked} onCommit={(v) => edit(C.updateSignal(p, s.id, { address: v }), 'Signal 주소')} />
          <Badge kind={s.address ? 'warn' : undefined}>{s.address ? s.addressStatus : '미정(개념 신호)'}</Badge>
          <button className="small danger" disabled={locked} onClick={() => edit(C.deleteSignal(p, s.id), 'Signal 삭제')}>삭제</button></div>
      </div>)}
      <div className="row" style={{ marginTop: 6 }}>
        <button className="small" disabled={locked} onClick={() => edit(C.addSignal(p, d.id, 'out', 'complete'), 'Signal 추가')}>+ 출력(완료)</button>
        <button className="small" disabled={locked} onClick={() => edit(C.addSignal(p, d.id, 'in', 'command'), 'Signal 추가')}>+ 입력(명령)</button>
        <button className="small" disabled={locked} onClick={() => edit(C.addSignal(p, d.id, 'out', 'sensor'), 'Signal 추가')}>+ 센서</button>
      </div>
      <div className="muted" style={{ fontSize: 11 }}>실제 I/O 주소가 없어도 역할 기반 개념 신호로 설계 가능 (주소 = 미정 유지).</div>
    </div>}
    {tab === 'positions' && <div className="section">
      {poss.map((x) => <div key={x.id} className="row"><TextInput value={x.name} width={120} disabled={locked} onCommit={(v) => edit(C.renameObject(p, x.id, v), 'Position 이름')} />
        <QtyInput q={x.value} disabled={locked} onCommit={(v, as) => edit(C.setQuantity(p, { kind: 'position', id: x.id }, v, as), 'Position 값')} />
        <button className="small danger" disabled={locked} onClick={() => edit(C.deletePosition(p, x.id), 'Position 삭제')}>×</button></div>)}
      <button className="small" disabled={locked} onClick={() => edit(C.addPosition(p, d.id), 'Position 추가')}>+ Position</button>
      <div className="muted" style={{ fontSize: 11 }}>가정값은 가정 표시와 함께 저장됩니다. 실측 교체(역매핑)는 미구현.</div>
    </div>}
    {tab === 'actions' && <div>
      {acts.map((a) => <ActionEditor key={a.id} p={p} a={a} locked={locked} edit={edit} onAddStep={props.onAddStep} />)}
      <div className="section"><button disabled={locked} onClick={() => edit(C.addAction(p, d.id), 'Action 추가')}>+ Action</button></div>
    </div>}
    {tab === 'check' && <div className="section">
      <DefinitionCheck p={p} deviceId={d.id} />
      {p.constraints.filter((k) => k.relatedIds.includes(d.id)).map((k) => <InterlockRow key={k.id} p={p} id={k.id} locked={locked} edit={edit} />)}
    </div>}
    <GapList gaps={relatedGaps} />
  </div>;
}

function InterlockRow({ p, id, locked, edit }: { p: Project; id: string; locked: boolean; edit: EditFn }) {
  const k = p.constraints.find((x) => x.id === id)!;
  return <div style={{ borderBottom: '1px solid var(--border)', padding: '4px 0', fontSize: 12 }}>
    <div><b className="mono">{k.id}</b> {k.description}</div>
    <div className="row"><Badge kind={k.confirmation === 'confirmed' ? 'ok' : k.confirmation === 'rejected' ? 'err' : 'warn'}>{{ unconfirmed: '미확인 후보', confirmed: '사람 확인됨', rejected: '거절됨', needsRecheck: '재확인 필요' }[k.confirmation]}</Badge>
      <button className="small" disabled={locked} onClick={() => edit(C.setConstraintConfirmation(p, k.id, 'confirmed'), 'Interlock 확인')}>확인</button>
      <button className="small" disabled={locked} onClick={() => edit(C.setConstraintConfirmation(p, k.id, 'rejected'), 'Interlock 거절')}>거절</button>
      <button className="small" disabled={locked} onClick={() => edit(C.setConstraintConfirmation(p, k.id, 'unconfirmed'), 'Interlock 되돌림')}>미확인</button></div>
    <div className="muted" style={{ fontSize: 10 }}>로컬 표시용 확인 — 법적 안전 승인 아님. 자동 확정 없음.</div>
  </div>;
}

function DefinitionCheck({ p, deviceId }: { p: Project; deviceId: string }) {
  const acts = p.actions.filter((a) => a.deviceId === deviceId);
  const items: { ok: boolean; text: string }[] = [];
  for (const a of acts) {
    items.push({ ok: !!a.completeSignalId && p.signals.some((s) => s.id === a.completeSignalId), text: `${a.name}: 완료 조건 Signal` });
    items.push({ ok: !!a.commandSignalId, text: `${a.name}: 명령 Signal` });
    items.push({ ok: a.duration.value !== null, text: `${a.name}: 동작 시간${a.duration.assumption ? ' (가정)' : ''}` });
    items.push({ ok: a.timeout.value !== null, text: `${a.name}: 타임아웃` });
    items.push({ ok: !a.pre.concat(a.post).some((c) => c.kind === 'undefined'), text: `${a.name}: 미정 조건 없음` });
  }
  const d = p.devices.find((x) => x.id === deviceId)!;
  for (const pd of (findAsset(d.kind)?.properties ?? []).filter((x) => x.requiredForRun)) items.push({ ok: d.properties[pd.key]?.value !== null, text: `사양 ${pd.label}` });
  return <div>{items.map((it, i) => <div key={i} className="row" style={{ minHeight: 20, fontSize: 12 }}><Badge kind={it.ok ? 'ok' : 'warn'}>{it.ok ? 'OK' : '미정/누락'}</Badge>{it.text}</div>)}
    {items.length === 0 && <div className="muted">Action 없음 (센서 등)</div>}</div>;
}

function GapList({ gaps }: { gaps: Gap[] }) {
  if (!gaps.length) return null;
  return <div className="section"><h4>관련 Gap</h4>{gaps.map((g) => <div key={g.id} style={{ fontSize: 11, marginBottom: 4 }}><Badge kind={g.judgement === 'shortfall' ? 'err' : 'warn'}>{g.kind}</Badge> {g.title}</div>)}</div>;
}
