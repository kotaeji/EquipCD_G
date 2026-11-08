import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ASSET_LIBRARY, exportLibraryAml, findAsset, LOADED_LIBRARIES, registerImported } from '../assets/library';
import { resolveGenerated } from '../assets/visuals';
import * as C from '../model/commands';
import { emptyProject } from '../model/factory';
import { analyzeGaps, reconcileGapReview, type Gap } from '../model/gaps';
import { applyEdit, initHistory, redo, undo, type History } from '../model/history';
import { buildParallelSampleProject, buildSampleProject } from '../model/sample';
import type { AssetDefinition, AssetKind, Project } from '../model/types';
import { APP_VERSION, FILE_FORMAT_VERSION, GROUP_RULES_VERSION, PRODUCT_NAME, RUNTIME_RULES_VERSION } from '../model/types';
import { advance, createRuntime, pause, reset, resume, runToEnd, start, type Runtime } from '../runtime/engine';
import { advanceGroup, createGroupRuntime, pauseGroup, resetGroup, resumeGroup, runGroupToEnd, startGroup, type GroupRuntime, type GroupState } from '../runtime/group';
import { parseProjectFile, serializeProject } from '../storage/fileFormat';
import { detectStorage, loadProject, quarantine, readIndex, readQuarantine, saveProject, type KV, type QuarantineEntry } from '../storage/localStore';
import { Canvas, type Mode } from './Canvas';
import { CapabilityTable, Inspector } from './Inspector';
import { LibraryWorkspace } from './Library';
import { evaluateSteps, LEVEL_LABEL, stepBadge, STEPS, type StepId, type StepItem } from './wizard';
import { devName, unitName } from './labels';
import { DiagPanel, ExportPanel, fmtTime, GapPanel, InputHubPanel, LabPanel, MaterialPanel, RuntimePanel, SequencePanel, SfcPanel } from './Panels';
import { PaletteIcon } from './Symbols';
import { GroupRunPanel, SubSequencePanel, SubstationSelect } from './SubstationPanels';
import { loadView, nextTheme, saveView, THEME_ORDER, THEMES, type LayerId, type UserView } from './viewSettings';

interface Tab { key: string; history: History; savedRevision: number | null; savedAt: string | null; runtime: Runtime | null; group: GroupRuntime | null; gaps: Gap[]; analyzedRevision: number | null }
interface Modal { title: string; body: React.ReactNode; actions: { label: string; primary?: boolean; danger?: boolean; run: () => void }[] }

let tabSeq = 0;
export const IMPORTED_AML_KEY = 'ecd.v1.importedAml';
let restored = false;
/** re-register AML libraries imported in earlier sessions (user-local, like UserView; not part of project files) */
function restoreImportedAml(kv: KV | null) {
  if (restored || !kv) return; restored = true;
  try { for (const e of JSON.parse(kv.getItem(IMPORTED_AML_KEY) ?? '[]') as { file: string; text: string }[]) if (!LOADED_LIBRARIES.some((l) => l.file === e.file)) registerImported(e.text, e.file); } catch { /* ignore broken list */ }
}
function makeTab(p: Project, saved: { rev: number; at: string } | null = null): Tab {
  const gaps = analyzeGaps(p);
  const review = reconcileGapReview(p.gapReview ?? {}, gaps, p.revision, new Set(gaps.filter((g) => g.safety).map((g) => g.id)));
  const proj = { ...p, gapReview: review };
  return { key: `tab-${++tabSeq}`, history: initHistory(proj), savedRevision: saved?.rev ?? null, savedAt: saved?.at ?? null, runtime: null, group: null, gaps, analyzedRevision: p.revision };
}

function download(name: string, text: string, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function App() {
  const storage = useMemo(() => detectStorage(), []);
  const kv = storage.kv;
  useState(() => { restoreImportedAml(kv); return 0; });
  const [libVersion, setLibVersion] = useState(0);
  const [view, setView] = useState<UserView>(() => loadView(kv));
  const [qlist, setQlist] = useState<QuarantineEntry[]>(() => readQuarantine(kv));
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [tabs, setTabs] = useState<Tab[]>(() => {
    if (kv) {
      const idx = readIndex(kv);
      if (idx.length) {
        const r = loadProject(kv, idx[0].id);
        if (r.ok) return [makeTab(r.project, { rev: r.project.revision, at: idx[0].savedAt })];
      }
    }
    return [makeTab(buildSampleProject())];
  });
  const [activeKey, setActiveKey] = useState(() => tabs[0].key);
  const [selection, setSelection] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>('select');
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState('props');
  const [subTab, setSubTab] = useState<Record<StepId, string>>({ library: 'cards', canvas: '', attributes: '', sequence: 'sequence', check: 'gap', run: '' });
  const [itemsOpen, setItemsOpen] = useState(false);
  const step = view.step;
  const goStep = (s: StepId, sub?: string) => { setView((v) => ({ ...v, step: s })); if (sub) setSubTab((t) => ({ ...t, [s]: sub })); setItemsOpen(false); };
  const setBottomTab = (k: string) => {
    const map: Record<string, [StepId, string]> = { runtime: ['run', ''], material: ['sequence', 'material'], sequence: ['sequence', 'sequence'], diag: ['check', 'diag'], gap: ['check', 'gap'] };
    const m = map[k]; if (m) goStep(m[0], m[1]);
  };
  const [layerOpen, setLayerOpen] = useState(false);
  const [speed, setSpeed] = useState(1);
  const fileRef = useRef<HTMLInputElement>(null);

  const tab = tabs.find((t) => t.key === activeKey) ?? tabs[0];
  const p = tab.history.present;
  const rt = tab.runtime?.state ?? null;
  const gs: GroupState | null = tab.group?.state ?? null;
  const groupLocked = gs?.status === 'running' || gs?.status === 'paused';
  const locked = rt?.status === 'running' || rt?.status === 'paused' || groupLocked;
  const [subUnitPref, setSubUnitPref] = useState('');
  const [runMode, setRunMode] = useState<'station' | 'group'>('station');
  const [explorerOpen, setExplorerOpen] = useState(true);
  const selUnit = (() => { const id = selection[0]; return p.units.find((u) => u.id === id)?.id ?? p.devices.find((d) => d.id === id)?.unitId; })();
  const subUnitId = gs?.unitId ?? (p.units.some((u) => u.id === subUnitPref) ? subUnitPref : selUnit ?? p.units.find((u) => (p.substationSequences ?? []).some((q) => q.unitId === u.id))?.id ?? p.units[0]?.id ?? '');

  useEffect(() => { saveView(kv, view); }, [kv, view]);
  // N03: a project that is not active never keeps running in the background → pause (state kept, no auto resume)
  useEffect(() => {
    setTabs((ts) => ts.some((t) => t.key !== activeKey && (t.runtime?.state.status === 'running' || t.group?.state.status === 'running'))
      ? ts.map((t) => (t.key === activeKey ? t : { ...t, runtime: t.runtime && t.runtime.state.status === 'running' ? pause(t.runtime) : t.runtime, group: t.group && t.group.state.status === 'running' ? pauseGroup(t.group) : t.group }))
      : ts);
  }, [activeKey]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), toast.err ? 6000 : 3000); return () => clearTimeout(t); }, [toast]);
  const say = (msg: string, err = false) => setToast({ msg, err });

  const updTab = useCallback((key: string, f: (t: Tab) => Tab) => setTabs((ts) => ts.map((t) => (t.key === key ? f(t) : t))), []);

  /** Apply one model edit as one undo unit. Returns false if blocked/rejected. */
  const edit = (r: C.CmdResult, label: string): boolean => {
    const o = applyEdit(tab.history, r, label, locked);
    if (o.error) { say(o.error, true); return false; }
    updTab(tab.key, (t) => ({ ...t, history: o.history, runtime: null, group: null }));
    return true;
  };

  // ---------- runtime driver (virtual time; wall-clock speed only affects pacing, not results) ----------
  const running = rt?.status === 'running';
  useEffect(() => {
    if (!running) return;
    let last = performance.now(); let raf = 0;
    const loop = (now: number) => {
      const dt = Math.min(250, now - last) * speed; last = now;
      updTab(tab.key, (t) => (t.runtime && t.runtime.state.status === 'running' ? { ...t, runtime: advance(t.runtime, dt) } : t));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, speed, tab.key, updTab]);
  const gRunning = gs?.status === 'running';
  useEffect(() => {
    if (!gRunning) return;
    let last = performance.now(); let raf = 0;
    const loop = (now: number) => {
      const dt = Math.min(250, now - last) * speed; last = now;
      updTab(tab.key, (t) => (t.group && t.group.state.status === 'running' ? { ...t, group: advanceGroup(t.group, dt) } : t));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [gRunning, speed, tab.key, updTab]);
  const gRun = () => {
    if (rt?.status === 'running' || rt?.status === 'paused') { say('Station 시퀀스 실행 중에는 그룹 실행을 시작할 수 없습니다 (먼저 초기화)', true); return; }
    let g = tab.group;
    if (!g || g.state.unitId !== subUnitId || g.snapshot.revision !== p.revision || g.state.status !== 'idle') g = createGroupRuntime(p, subUnitId, `grp-${Date.now().toString(36)}`);
    const s2 = startGroup(g);
    if (s2.state.status !== 'running') say(`그룹 실행 전 검사 차단: ${checkMsg(s2.state)}`, true);
    updTab(tab.key, (t) => ({ ...t, group: s2 }));
  };
  const checkMsg = (st: GroupState) => st.log.map((e) => e.message).slice(-1)[0] ?? '';
  const gPause = () => updTab(tab.key, (t) => (t.group ? { ...t, group: pauseGroup(t.group) } : t));
  const gResume = () => updTab(tab.key, (t) => (t.group ? { ...t, group: resumeGroup(t.group) } : t));
  const gReset = () => updTab(tab.key, (t) => (t.group ? { ...t, group: resetGroup(t.group) } : t));
  const gToEnd = () => updTab(tab.key, (t) => (t.group && t.group.state.status === 'running' ? { ...t, group: runGroupToEnd(t.group) } : t));

  const doRun = () => {
    if (groupLocked) { say('Substation 그룹 실행 중에는 Station 시퀀스를 시작할 수 없습니다 (먼저 그룹 초기화)', true); return; }
    let r = tab.runtime;
    if (!r || (r.state.status === 'idle' && r.snapshot.revision !== p.revision) || r.state.status === 'completed' || r.state.status === 'error') r = createRuntime(p, `run-${Date.now().toString(36)}`);
    const s = start(r);
    if (s.state.status !== 'running') { say(`실행 준비 실패: ${s.state.blockers.map((b) => b.message).slice(0, 2).join(' / ')}`, true); setBottomTab('runtime'); }
    updTab(tab.key, (t) => ({ ...t, runtime: s }));
  };
  const doPause = () => updTab(tab.key, (t) => (t.runtime ? { ...t, runtime: pause(t.runtime) } : t));
  const doResume = () => updTab(tab.key, (t) => (t.runtime ? { ...t, runtime: resume(t.runtime) } : t));
  const doReset = () => updTab(tab.key, (t) => (t.runtime ? { ...t, runtime: reset(t.runtime) } : t));
  const doStep = () => updTab(tab.key, (t) => (t.runtime && t.runtime.state.status === 'paused' ? { ...t, runtime: pause(advance(resume(t.runtime), 100)) } : t));
  const doToEnd = () => updTab(tab.key, (t) => (t.runtime && t.runtime.state.status === 'running' ? { ...t, runtime: runToEnd(t.runtime) } : t));

  const doUndo = () => { const o = undo(tab.history, locked); if (o.error) say(o.error, true); else updTab(tab.key, (t) => ({ ...t, history: o.history, runtime: null, group: null })); };
  const doRedo = () => { const o = redo(tab.history, locked); if (o.error) say(o.error, true); else updTab(tab.key, (t) => ({ ...t, history: o.history, runtime: null, group: null })); };

  const reanalyze = () => {
    const gaps = analyzeGaps(p);
    const review = reconcileGapReview(p.gapReview, gaps, p.revision, new Set(gaps.filter((g) => g.safety).map((g) => g.id)));
    // analysis bookkeeping is not a model edit → not added to Undo history, revision unchanged
    updTab(tab.key, (t) => ({ ...t, gaps, analyzedRevision: p.revision, history: { ...t.history, present: { ...t.history.present, gapReview: review } } }));
    say(`재분석 완료: ${gaps.length}건 (rev ${p.revision})`);
  };
  const reviewGap = (id: string, status: 'hidden' | 'humanConfirmed' | 'open') => {
    updTab(tab.key, (t) => { const pr = t.history.present; const old = pr.gapReview[id]; if (!old) return t; return { ...t, history: { ...t.history, present: { ...pr, gapReview: { ...pr.gapReview, [id]: { ...old, status } } } } }; });
  };
  const goGap = (g: Gap) => {
    const id = g.target.objectId;
    if (g.target.panel === 'material') setBottomTab('material');
    else if (g.target.panel === 'sequence') setBottomTab('sequence');
    else { setSelection(id ? [id] : []); goStep(g.target.panel === 'canvas' ? 'canvas' : 'attributes'); setRightTab(g.target.panel === 'configurator' && p.devices.some((d) => d.id === id) ? (g.kind === 'axisSpec' ? 'props' : 'actions') : 'props'); }
  };

  // ---------- canvas handlers ----------
  const onDropAsset = (kind: AssetKind | 'unit', at: { x: number; y: number }) => {
    if (locked) { say('실행 중에는 배치(모델 편집)가 차단됩니다', true); return; }
    if (kind === 'unit') { const r = C.addUnit(p, '', { x: Math.round(at.x - 108), y: Math.round(at.y - 20) }); if (edit(r, 'Unit 배치') && r.ok) setSelection([r.note!]); return; }
    const def = findAsset(kind);
    if (def?.template) { const r2 = C.addUnitFromTemplate(p, kind, { x: Math.round(at.x - 108), y: Math.round(at.y - 20) }); if (edit(r2, `${def.name} 배치`) && r2.ok) setSelection([r2.note!]); return; }
    const r = C.addDevice(p, kind, { x: Math.round(at.x - 25), y: Math.round(at.y - 20) });
    if (edit(r, `${def?.name ?? kind} 배치`) && r.ok) { setSelection([r.note!]); setRightTab('props'); }
  };
  /** Library card "프로젝트에 추가" (C03-AC5): the only path from the library that changes the model. */
  const onAddFromLibrary = (def: AssetDefinition, unitId: string | null) => {
    if (locked) { say('실행 중에는 추가(모델 편집)가 차단됩니다', true); return; }
    if (def.template) {
      const x = Math.max(40, ...p.units.map((u) => u.layout.x + u.layout.w + 40));
      const r = C.addUnitFromTemplate(p, def.kind, { x, y: 40 });
      if (edit(r, `${def.name} 추가`) && r.ok) { setSelection([r.note!]); say(`${def.name} → 새 Unit + 자식 ${def.template.children.length}개 추가 (2 배치·연결에서 확인)`); }
      return;
    }
    const u = p.units.find((x) => x.id === unitId); if (!u) { say('넣을 Unit을 선택하세요', true); return; }
    const n = u.deviceIds.length;
    const at = { x: u.layout.x + 16 + (n % 3) * 64, y: u.layout.y + 36 + Math.floor(n / 3) * 70 };
    const r = C.addDevice(p, def.kind, at);
    if (edit(r, `${def.name} 추가`) && r.ok) { setSelection([r.note!]); say(`${def.name} → ${u.name}에 추가`); }
  };
  const onImportAml = async (f: File) => {
    const text = await f.text();
    const out = registerImported(text, `imported/${f.name}`);
    if (out.added.length && kv) {
      try { const list = JSON.parse(kv.getItem(IMPORTED_AML_KEY) ?? '[]'); list.push({ file: `imported/${f.name}`, text }); kv.setItem(IMPORTED_AML_KEY, JSON.stringify(list)); } catch { say('가져온 AML을 브라우저에 보관하지 못함 — 다시 열면 정의가 없을 수 있음', true); }
    }
    setLibVersion((v) => v + 1);
    const errs = out.result.diags.filter((d) => d.severity === 'error'); const warns = out.result.diags.filter((d) => d.severity === 'warning');
    setModal({ title: `AML 가져오기 — ${f.name}`, body: <div>
      <p>XML 구문: {out.result.diags.some((d) => d.code === 'XML_SYNTAX') ? '실패' : '통과'} · CAEX SchemaVersion: {out.result.meta.schemaVersion ?? '없음'} · 앱 subset: 오류 {errs.length} / 경고 {warns.length} · <b>공식 XSD: 미검증</b> (브라우저 내 미실행)</p>
      <p>추가된 정의 {out.added.length}개: {out.added.map((d) => d.name).join(', ') || '없음'}</p>
      {out.skipped.length > 0 && <p>건너뜀 {out.skipped.length}: {out.skipped.map((x) => `${x.id} (${x.reason})`).join(' / ')}</p>}
      {out.result.diags.slice(0, 14).map((d, i) => <div key={i} style={{ fontSize: 11, color: d.severity === 'error' ? 'var(--danger)' : 'var(--warning)' }}>[{d.code}] {d.where}: {d.message}</div>)}
      <p className="muted">오류가 있는 정의는 라이브러리에 넣지 않았습니다. 기존 정의와 열린 프로젝트는 변경되지 않았습니다{out.added.length ? " (새 정의만 추가됨, 이 브라우저에 보관)" : ""}.</p></div>, actions: [{ label: '확인', run: () => {} }] });
  };
  const onMoveCommit = (ids: string[], dx: number, dy: number, pointer: { x: number; y: number }) => {
    const single = ids.length === 1 ? p.devices.find((d) => d.id === ids[0]) : undefined;
    if (single) {
      const target = C.unitAt(p, pointer.x, pointer.y);
      if (target && target.id !== single.unitId) {
        const imp = C.impactOf(p, single.id);
        setModal({
          title: `${single.name}의 소속 Unit 변경?`,
          body: <div><p>{unitName(p, single.unitId)} → <b>{target.name}</b> (계층 이동). 좌표 이동과 별개입니다.</p>
            <p>영향 Action {imp.actions.length}개: {imp.actions.map((a) => a.name).join(', ') || '없음'}</p>
            <p>영향 시퀀스 단계 {imp.steps.length}개: {imp.steps.map((s) => s.name).join(', ') || '없음'}</p>
            <p className="muted">Action의 소속 Unit도 함께 바뀝니다. 자재 이동 조건은 바뀌지 않으니 Gap 재분석을 권장합니다.</p></div>,
          actions: [
            { label: '소속 변경 + 이동', primary: true, run: () => { edit(C.reparentDevice(p, single.id, target.id, { x: single.layout.x + dx, y: single.layout.y + dy }), 'Device 소속 변경'); } },
            { label: '좌표만 이동 (소속 유지)', run: () => { edit(C.moveNodes(p, ids, dx, dy), '이동'); } },
            { label: '취소', run: () => {} },
          ],
        });
        return;
      }
    }
    edit(C.moveNodes(p, ids, dx, dy), ids.length > 1 ? `${ids.length}개 이동` : '이동');
  };
  const onUnitConnectClick = (uid: string) => {
    if (!connectFrom) { setConnectFrom(uid); say('물류 연결: 도착 Unit을 클릭하세요'); return; }
    const r = C.addConnection(p, 'flow', connectFrom, uid);
    if (edit(r, '물류 연결')) say('물류 연결 추가');
    setConnectFrom(null);
  };
  const onPortClick = (sid: string) => {
    if (!connectFrom) { setConnectFrom(sid); say('신호 연결: 도착 입력(in) 포트를 클릭하세요'); return; }
    const r = C.addConnection(p, 'signal', connectFrom, sid);
    if (edit(r, '신호 연결')) say('신호 연결 추가');
    setConnectFrom(null);
  };
  const requestDelete = (id: string) => {
    if (locked) { say('실행 중에는 삭제가 차단됩니다', true); return; }
    if (p.connections.some((c) => c.id === id)) { edit(C.deleteConnection(p, id), '연결 삭제'); setSelection([]); return; }
    const imp = C.impactOf(p, id);
    const name = p.units.find((u) => u.id === id)?.name ?? devName(p, id);
    setModal({
      title: `${name} 삭제 — 참조 영향 확인`,
      body: <div>
        <p>삭제되는 Action {imp.actions.filter((a) => a.deviceId === id || a.unitId === id || p.devices.find((d) => d.id === a.deviceId)?.unitId === id).length}개, 시퀀스 단계 {imp.steps.length}개 제거: {imp.steps.map((s) => s.name).join(', ') || '없음'}</p>
        <p>연결 {imp.connections.length}개 제거. 자재 경로 영향: {imp.materials.map((m) => m.name).join(', ') || '없음'} {imp.materials.length > 0 && <b style={{ color: 'var(--danger)' }}>(경로 단절 — 정상 흐름 아님)</b>}</p>
        <p>다른 Action에서 참조하던 조건은 “미정” 조건으로 바뀌어 실행이 차단되고 Gap에 표시됩니다 (임의 true 처리 안 함).</p>
        <p className="muted">Undo로 되돌릴 수 있습니다.</p></div>,
      actions: [{ label: '참조 해제 후 삭제', danger: true, run: () => { if (edit(C.deleteNode(p, id), `${name} 삭제`)) setSelection([]); } }, { label: '취소', run: () => {} }],
    });
  };
  const requestReparent = (deviceId: string, unitId: string) => {
    const d = p.devices.find((x) => x.id === deviceId); const u = p.units.find((x) => x.id === unitId);
    if (!d || !u || d.unitId === unitId) return;
    const imp = C.impactOf(p, deviceId);
    setModal({ title: `${d.name} 소속을 ${u.name}(으)로 변경`, body: <p>영향 Action {imp.actions.length}개, 시퀀스 단계 {imp.steps.length}개. 좌표는 새 Unit 안쪽으로 옮깁니다.</p>,
      actions: [{ label: '변경', primary: true, run: () => { edit(C.reparentDevice(p, deviceId, unitId, { x: u.layout.x + 20, y: u.layout.y + 40 }), 'Device 소속 변경'); } }, { label: '취소', run: () => {} }] });
  };

  // ---------- keyboard ----------
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
      else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); doRedo(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length === 1 && (step === 'canvas' || step === 'attributes')) { e.preventDefault(); requestDelete(selection[0]); }
      else if (e.key === 'Escape') { setConnectFrom(null); setMode('select'); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  // ---------- file / workspace ----------
  const doSave = () => {
    if (!kv) { say(`${storage.reason} — JSON 내보내기를 사용하세요. 메모리 변경은 유지됩니다.`, true); return; }
    const r = saveProject(kv, p);
    if (!r.ok) { say(r.reason, true); return; }
    updTab(tab.key, (t) => ({ ...t, savedRevision: p.revision, savedAt: r.savedAt }));
    say('브라우저 저장소에 저장됨 (저장 후 읽기 확인 완료)');
  };
  const openSaved = (id: string) => {
    const existing = tabs.find((t) => t.history.present.id === id);
    if (existing) { setActiveKey(existing.key); say('이미 열린 프로젝트입니다 — 기존 탭으로 이동했습니다'); return; }
    const r = loadProject(kv!, id);
    if (!r.ok) {
      if (r.raw) setQlist((l) => quarantine(kv, { at: new Date().toLocaleString(), label: `saved:${id}`, raw: r.raw, errors: r.errors.map((e) => e.message) }, l));
      say(`열기 실패: ${r.errors.map((e) => e.message).slice(0, 2).join(' / ')} (원본 덮어쓰기 없음)`, true); return;
    }
    const entry = readIndex(kv!).find((e) => e.id === id);
    const t = makeTab(r.project, { rev: r.project.revision, at: entry?.savedAt ?? '' });
    setTabs((ts) => [...ts, t]); setActiveKey(t.key); setSelection([]);
    if (r.warnings.length) say(`경고 ${r.warnings.length}: ${r.warnings[0].message}`);
  };
  const showOpen = () => {
    if (!kv) { say(`${storage.reason}. JSON 가져오기를 사용하세요.`, true); return; }
    const idx = readIndex(kv);
    setModal({ title: '저장된 프로젝트 열기 (최근 작업)', body: idx.length ? <table className="grid"><tbody>{idx.map((e) => <tr key={e.id}><td>{e.name}</td><td className="mono" style={{ fontSize: 10 }}>{e.id}</td><td className="muted" style={{ fontSize: 11 }}>rev {e.revision} · {new Date(e.savedAt).toLocaleString()}</td><td><button className="small" onClick={() => { setModal(null); openSaved(e.id); }}>열기</button></td></tr>)}</tbody></table> : <div className="muted">저장된 프로젝트가 없습니다.</div>, actions: [{ label: '닫기', run: () => {} }] });
  };
  const newProject = (kind: 'blank' | 'sample' | 'parallel') => {
    const proj = kind === 'sample' ? { ...buildSampleProject(), id: `prj-${Date.now().toString(36)}`, name: `5공정 예제 사본 ${tabs.length + 1}` }
      : kind === 'parallel' ? { ...buildParallelSampleProject(), id: `prj-par-${Date.now().toString(36)}`, name: `병렬 Substation 예제 ${tabs.length + 1}` }
      : emptyProject(`새 프로젝트 ${tabs.length + 1}`);
    const t = makeTab(proj); setTabs((ts) => [...ts, t]); setActiveKey(t.key); setSelection([]);
  };
  const closeTab = (key: string) => {
    const t = tabs.find((x) => x.key === key)!;
    const doClose = () => setTabs((ts) => { const n = ts.filter((x) => x.key !== key); const list = n.length ? n : [makeTab(emptyProject('새 프로젝트'))]; if (key === activeKey) setActiveKey(list[0].key); return list; });
    if (t.savedRevision !== t.history.present.revision) setModal({ title: '저장하지 않은 변경', body: <p>{t.history.present.name}에 저장되지 않은 변경이 있습니다. 닫으면 메모리 변경이 사라집니다.</p>, actions: [{ label: '저장하지 않고 닫기', danger: true, run: doClose }, { label: '취소 (변경 유지)', run: () => {} }] });
    else doClose();
  };
  const onImportFile = async (f: File) => {
    const text = await f.text();
    const r = parseProjectFile(text);
    if (!r.ok) {
      setQlist((l) => quarantine(kv, { at: new Date().toLocaleString(), label: f.name, raw: text, errors: r.errors.map((e) => `[${e.code}] ${e.objectId}: ${e.message}`) }, l));
      setModal({ title: '가져오기 거부 — 현재 모델 불변', body: <div><p>파일 <b>{f.name}</b> 을(를) 열지 않았습니다. 원본은 격리 보관함(진단 탭)에 그대로 보존했습니다.</p>{r.errors.slice(0, 12).map((e) => <div key={e.id} style={{ fontSize: 12, color: 'var(--danger)' }}>[{e.code}] {e.objectId}: {e.message}</div>)}</div>, actions: [{ label: '확인', run: () => setBottomTab('diag') }] });
      return;
    }
    const existing = tabs.find((t) => t.history.present.id === r.project.id);
    if (existing) {
      setModal({ title: '같은 ID의 프로젝트가 이미 열려 있음', body: <p>{r.project.name} ({r.project.id}). 기존 탭을 덮어쓰지 않습니다. 새 ID로 사본을 열 수 있습니다.</p>,
        actions: [{ label: '새 ID 사본으로 열기', primary: true, run: () => { const t = makeTab({ ...r.project, id: `${r.project.id}-copy-${Date.now().toString(36)}`, name: `${r.project.name} (가져온 사본)` }); setTabs((ts) => [...ts, t]); setActiveKey(t.key); } }, { label: '기존 탭으로 이동', run: () => setActiveKey(existing.key) }] });
      return;
    }
    const t = makeTab(r.project); setTabs((ts) => [...ts, t]); setActiveKey(t.key); setSelection([]);
    say(`가져오기 완료${r.warnings.length ? ` (경고 ${r.warnings.length}: ${r.warnings[0].message})` : ''} — 아직 브라우저 저장소에는 저장되지 않음`);
  };

  const themeVars = THEMES[view.theme].vars;
  const style = Object.fromEntries(Object.entries(themeVars).map(([k, v]) => [`--${k}`, v])) as React.CSSProperties;
  const selectedId = selection.length === 1 ? selection[0] : null;
  const dirty = tab.savedRevision !== p.revision;
  const L = view.layers;

  const photoMissingKinds = ASSET_LIBRARY.filter((d) => resolveGenerated(d.kind).status === 'missing').map((d) => d.kind);
  const evals = evaluateSteps(p, { gaps: tab.gaps, rt, saved: !dirty, photoMissingKinds });
  const confirmed = view.confirmed[p.id] ?? {};
  const cur = STEPS.find((s) => s.id === step)!;
  const curEval = evals[step];
  const missing = curEval.items.filter((i) => i.level === 'missing');
  const confirmStep = (s: StepId) => setView((v) => ({ ...v, confirmed: { ...v.confirmed, [p.id]: { ...(v.confirmed[p.id] ?? {}), [s]: evals[s].fingerprint } } }));
  const goNext = () => {
    const nx = STEPS[cur.no]; if (!nx) return;
    if (curEval.ready) { confirmStep(step); goStep(nx.id); return; }
    setModal({ title: `${cur.no} ${cur.label}: 필수 데이터 누락 ${missing.length}건`, body: <div>
      {missing.slice(0, 10).map((m, i) => <div key={i} style={{ fontSize: 12, color: 'var(--danger)' }}>• {m.text}</div>)}
      <p className="muted">단계 확인(완료 표시)은 실제 데이터가 채워져야 됩니다. 다음 화면을 보는 것은 가능하지만 이 단계는 ‘필수 누락’으로 남고, 실행은 실행 전 검사에서 따로 차단됩니다.</p></div>,
      actions: [{ label: '머무르며 수정', primary: true, run: () => setItemsOpen(true) }, { label: '확인 없이 다음 화면 보기', run: () => goStep(nx.id) }] });
  };
  const goItem = (it: StepItem) => {
    if (it.targetStep) { goStep(it.targetStep); return; }
    if (!it.targetId) return;
    if (p.materials.some((m) => m.id === it.targetId)) { goStep('sequence', 'material'); return; }
    if (p.sequence.steps.some((s) => s.id === it.targetId)) { goStep('sequence', 'sequence'); return; }
    const isNode = p.devices.some((d) => d.id === it.targetId) || p.units.some((u) => u.id === it.targetId);
    if (isNode) { setSelection([it.targetId]); goStep(step === 'canvas' ? 'canvas' : 'attributes'); setRightTab(p.devices.some((d) => d.id === it.targetId) ? 'actions' : 'props'); }
  };
  const BADGE = { ready: ['ok', '필수 충족'], blocked: ['err', '필수 누락'], recheck: ['warn', '재확인 필요'], confirmed: ['ok', '확인됨 ✓'] } as const;
  const sub = subTab[step];
  const Sub = ({ items }: { items: [string, string][] }) => <div className="tabs subtabs">{items.map(([k, l]) => <button key={k} className={sub === k ? 'on' : ''} onClick={() => setSubTab((t) => ({ ...t, [step]: k }))}>{l}</button>)}</div>;
  const subCount = (uid: string) => (p.substationSequences ?? []).filter((q) => q.unitId === uid).length;
  const pick = (id: string) => { setSelection([id]); const u = p.units.find((x) => x.id === id)?.id ?? p.devices.find((d) => d.id === id)?.unitId; if (u && !groupLocked) setSubUnitPref(u); };
  const treeKey = (e: React.KeyboardEvent, id: string) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(id); } };
  const tree = <div className="tree" role="tree" aria-label="Station / Substation / Device">
    <div className="tnode muted" role="treeitem" aria-expanded="true">▾ {p.equipment.name} <span className="kind">Station · Equipment</span></div>
    {p.units.map((u) => <div key={u.id} role="group">
      <div role="treeitem" tabIndex={0} aria-selected={selection.includes(u.id)} className={`tnode ${selection.includes(u.id) ? 'sel' : ''}`} style={{ paddingLeft: 18 }} onClick={() => pick(u.id)} onKeyDown={(e) => treeKey(e, u.id)} title={`${u.name} — Substation(Unit) ${u.id}`}>
        ▸ {u.name}{u.templateRef ? ' ⧉' : ''} <span className="kind">Substation · 시퀀스 {subCount(u.id)}</span></div>
      {u.deviceIds.map((d) => <div key={d} role="treeitem" tabIndex={0} aria-selected={selection.includes(d)} className={`tnode ${selection.includes(d) ? 'sel' : ''}`} style={{ paddingLeft: 34, fontSize: 12 }} onClick={() => pick(d)} onKeyDown={(e) => treeKey(e, d)}>○ {devName(p, d)} <span className="muted">{findAsset(p.devices.find((x) => x.id === d)?.kind ?? '')?.name ?? '정의 없음'}</span></div>)}
    </div>)}
    {p.units.length === 0 && <div className="tempty">Substation이 없습니다. 1 라이브러리에서 유닛 템플릿을 추가하거나 2 배치에서 “빈 유닛”을 캔버스로 드래그하세요.</div>}
  </div>;
  const recent = kv ? readIndex(kv).slice(0, 6) : [];
  /** N03: switching projects while this project runs → pause its run first (state kept, no auto resume). */
  const switchTab = (key: string) => {
    if (key === tab.key) return;
    if (rt?.status === 'running' || gs?.status === 'running') {
      say(`${p.name}: 실행을 일시정지하고 전환했습니다 (돌아와서 재개 가능, 자동 재개 없음)`);
    }
    setActiveKey(key); setSelection([]); setConnectFrom(null);
  };
  const explorer = <aside className={`explorer ${explorerOpen ? '' : 'collapsed'}`} aria-label="Workspace / Project 탐색기">
    <div className="exhead"><button className="small icon" onClick={() => setExplorerOpen(!explorerOpen)} aria-label={explorerOpen ? '탐색기 접기' : '탐색기 펼치기'} title={explorerOpen ? '탐색기 접기' : '탐색기 펼치기'}>{explorerOpen ? '⟨' : '⟩'}</button>{explorerOpen && <b>WORKSPACE</b>}</div>
    {explorerOpen && <>
      <div className="exsec">
        <div className="exlabel">열린 프로젝트 ({tabs.length})</div>
        <div className="exlist" role="listbox" aria-label="열린 프로젝트">
          {tabs.map((t) => <div key={t.key} role="option" tabIndex={0} aria-selected={t.key === tab.key} className={`exitem ${t.key === tab.key ? 'on' : ''}`} title={t.history.present.id}
            onClick={() => switchTab(t.key)} onKeyDown={(e) => { if (e.key === 'Enter') switchTab(t.key); }}>
            <span className="nm">{t.history.present.name}</span>{t.savedRevision !== t.history.present.revision && <span className="dirty" title="저장 안 됨">● 미저장</span>}
            <button className="x" onClick={(e) => { e.stopPropagation(); closeTab(t.key); }} aria-label={`${t.history.present.name} 닫기`}>×</button></div>)}
        </div>
        <div className="exbtns">
          <button className="small" onClick={() => newProject('blank')} title="빈 프로젝트로 시작">+ 빈 프로젝트</button>
          <button className="small" onClick={() => newProject('sample')} title="기본 5공정 Station 예제 사본">+ 5공정 예제</button>
          <button className="small" onClick={() => newProject('parallel')} title="Substation 하나에 병렬 시퀀스 2개가 있는 예제">+ 병렬 예제</button>
          <button className="small" onClick={showOpen}>열기…</button>
          <button className="small" onClick={() => fileRef.current?.click()}>JSON 가져오기</button>
        </div>
      </div>
      <div className="exsec">
        <div className="exlabel">최근 저장 (이 브라우저)</div>
        {!kv && <div className="tempty">브라우저 저장소 사용 불가 — JSON 가져오기/내보내기를 사용하세요.</div>}
        {kv && recent.length === 0 && <div className="tempty">아직 저장한 프로젝트가 없습니다.</div>}
        {recent.map((e) => <button key={e.id} className="exrecent" onClick={() => openSaved(e.id)} title={`${e.id} · rev ${e.revision}`}><span className="nm">{e.name}</span><span className="muted">rev {e.revision}</span></button>)}
      </div>
      <div className="exsec grow">
        <div className="exlabel">구조 — Station › Substation › Device</div>
        {tree}
      </div>
    </>}
  </aside>;
  const visualToggle = <>
    <button className={view.visualMode === 'schematic' ? 'on' : ''} onClick={() => setView({ ...view, visualMode: 'schematic' })}>도식</button>
    <button className={view.visualMode === 'photo' ? 'on' : ''} onClick={() => setView({ ...view, visualMode: 'photo' })} title="AI 생성 실사풍 이미지 표시 — 실제 촬영 사진 아님 (모델·연결·상태 불변)">실사풍(AI)</button></>;
  const runControls = <>
    <button className="primary" onClick={doRun} disabled={running || rt?.status === 'paused'}>▶ 실행</button>
    <button onClick={doPause} disabled={!running}>❚❚ 일시정지</button>
    <button onClick={doResume} disabled={rt?.status !== 'paused'}>재개</button>
    <button onClick={doStep} disabled={rt?.status !== 'paused'} title="일시정지 중 가상 0.1초 진행">+0.1s</button>
    <button onClick={doReset} disabled={!tab.runtime || rt?.status === 'idle'}>⟲ 초기화</button>
    <button onClick={doToEnd} disabled={!running} title="실행 중(▶ 실행 후)에만 활성 — 남은 단계를 즉시 계산">끝까지</button>
    <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} title="화면 재생 속도 (논리 결과에 영향 없음)">{[0.25, 0.5, 1, 2, 4].map((s) => <option key={s} value={s}>{s}x</option>)}</select>
    <span className="mono" style={{ minWidth: 80 }}>{fmtTime(rt?.timeMs ?? 0)}</span></>;
  const groupControls = <>
    <SubstationSelect p={p} value={subUnitId} onChange={(id) => setSubUnitPref(id)} />
    <button className="primary" onClick={gRun} disabled={gs?.status === 'running' || gs?.status === 'paused' || !subUnitId}>▶ 그룹 실행</button>
    <button onClick={gPause} disabled={gs?.status !== 'running'}>❚❚ 그룹 일시정지</button>
    <button onClick={gResume} disabled={gs?.status !== 'paused'}>그룹 재개</button>
    <button onClick={gReset} disabled={!tab.group || gs?.status === 'idle'}>⟲ 그룹 초기화</button>
    <button onClick={gToEnd} disabled={gs?.status !== 'running'}>끝까지</button>
    <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} title="화면 재생 속도 (논리 결과에 영향 없음)" aria-label="재생 속도">{[0.25, 0.5, 1, 2, 4].map((s) => <option key={s} value={s}>{s}x</option>)}</select>
    <span className="mono" style={{ minWidth: 80 }}>{fmtTime(gs?.timeMs ?? 0)}</span></>;
  const groupCanvasRt = gs ? ({ ...gs, stepIndex: 0, active: null, steps: [] } as unknown as typeof rt) : null;
  const activeDeviceIds = gs ? gs.lanes.filter((l) => l.active).map((l) => { const q = (p.substationSequences ?? []).find((x) => x.id === l.seqId); const a = p.actions.find((x) => x.id === q?.steps[l.stepIndex]?.actionId); return a?.deviceId ?? ''; }) : [];
  const runCanvasEl = <Canvas project={p} rt={runMode === 'group' ? groupCanvasRt : rt} activeDeviceIds={runMode === 'group' ? activeDeviceIds : undefined} view={view} selection={selection} mode={mode} connectFrom={connectFrom} locked={locked}
    onSelect={(ids) => setSelection(ids)} onMoveCommit={onMoveCommit} onDropAsset={onDropAsset} onPortClick={onPortClick}
    onUnitConnectClick={onUnitConnectClick} onBlocked={(m) => say(m, true)} />;
  const canvasEl = <Canvas project={p} rt={rt} view={view} selection={selection} mode={mode} connectFrom={connectFrom} locked={locked}
    onSelect={(ids) => setSelection(ids)} onMoveCommit={onMoveCommit} onDropAsset={onDropAsset} onPortClick={onPortClick}
    onUnitConnectClick={onUnitConnectClick} onBlocked={(m) => say(m, true)} />;
  const inspectorEl = <Inspector project={p} selectedId={selectedId} locked={locked} gaps={tab.gaps} edit={edit} onAddStep={(id) => edit(C.addStep(p, id), '단계 추가')}
    onDelete={requestDelete} onReparent={requestReparent} tab={rightTab} setTab={setRightTab} visualMode={view.visualMode} />;

  return (
    <div className={`app ${explorerOpen ? '' : 'ex-collapsed'}`} style={style} data-theme={view.theme} data-step={step}>
      <div className="header">
        <span className="brand" aria-label={`${PRODUCT_NAME} ${APP_VERSION}`}><span className="logo" aria-hidden="true">◆</span><span className="title">{PRODUCT_NAME}</span><span className="badge">v{APP_VERSION}</span></span>
        <div className="sep" />
        <span className="crumb" title={p.id}>{p.name}{dirty ? ' ●' : ''} <span className="muted">/ {cur.no} {cur.label}</span></span>
        <span className="grow" />
        <span style={{ fontSize: 12, color: dirty ? 'var(--warning)' : 'var(--success)' }}>{dirty ? '저장 안 됨' : `저장됨 ${tab.savedAt ? new Date(tab.savedAt).toLocaleTimeString() : ''}`}</span>
        <button onClick={doSave}>저장</button>
        <button onClick={() => download(`${p.name.replace(/[^\w가-힣-]+/g, '_')}.ecd.json`, serializeProject(p))}>JSON 내보내기</button>
        <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportFile(f); e.target.value = ''; }} />
        <button onClick={doUndo} disabled={!tab.history.past.length || locked} title="실행 취소 (Ctrl/Cmd+Z)" aria-label="실행 취소">↶</button>
        <button onClick={doRedo} disabled={!tab.history.future.length || locked} title="다시 실행 (Ctrl/Cmd+Shift+Z)" aria-label="다시 실행">↷</button>
        <div className="sep" />
        <button onClick={() => setView({ ...view, theme: nextTheme(view.theme) })} title="테마 토글 A→B→C">테마: {THEMES[view.theme].label}</button>
        {THEME_ORDER.map((t) => <button key={t} className={`small ${view.theme === t ? 'on' : ''}`} onClick={() => setView({ ...view, theme: t })}>{t}</button>)}
      </div>

      {explorer}
      <div className="stepper" role="navigation" aria-label="단계">
        {STEPS.map((s) => { const b = stepBadge(evals[s.id], confirmed[s.id]); return (
          <button key={s.id} className={`st ${step === s.id ? 'on' : ''}`} onClick={() => goStep(s.id)} data-stepid={s.id} aria-current={step === s.id ? 'step' : undefined}>
            <span className="n">{s.no} / 6</span><b>{s.label}</b><span className={`badge ${BADGE[b][0]}`}>{BADGE[b][1]}</span></button>); })}
        <div className="goal">
          <div><b>현재: {cur.no} {cur.label}</b> · <span className="muted">작업영역 {cur.workspace}</span></div>
          <div className="muted">{cur.goal}</div>
          <div className="row" style={{ minHeight: 22, gap: 6 }}>
            <button className="small" onClick={() => setItemsOpen(!itemsOpen)}>남은 항목 {curEval.items.length} (필수 누락 {missing.length}) {itemsOpen ? '▴' : '▾'}</button>
            <button className="small" disabled={cur.no === 1} onClick={() => goStep(STEPS[cur.no - 2].id)}>◀ 이전</button>
            <button className="small primary" disabled={cur.no === 6} onClick={goNext}>다음 ▶</button>
            {locked && <span className="badge warn">실행 중 — 모델 편집 잠금 (조회만)</span>}
          </div>
        </div>
      </div>
      {itemsOpen && <div className="itemspop" style={style}>
        <div className="row" style={{ justifyContent: 'space-between' }}><b>{cur.no} {cur.label} — 남은 항목 (실제 데이터 기준 재계산)</b><button className="small" onClick={() => setItemsOpen(false)}>닫기</button></div>
        {curEval.items.length === 0 && <div className="muted">남은 항목 없음</div>}
        {curEval.items.map((it, i) => <div key={i} className="row" style={{ minHeight: 22, fontSize: 12 }}>
          <span className={`badge ${it.level === 'missing' ? 'err' : it.level === 'human' ? 'acc' : 'warn'}`}>{LEVEL_LABEL[it.level]}</span><span style={{ flex: 1 }}>{it.text}</span>
          {(it.targetId || it.targetStep) && <button className="small" onClick={() => goItem(it)}>편집으로 이동</button>}</div>)}
        {confirmed[step] && confirmed[step] !== curEval.fingerprint && <div className="notice warn">이 단계는 이전에 확인되었지만 관련 데이터가 바뀌었습니다 — 재확인 필요</div>}
      </div>}

      {step === 'library' && <div className="workspace ws-full">
        <Sub items={[['cards', '에셋 라이브러리 카드'], ['input', '입력 후보표 (F1)']]} />
        {sub === 'input' ? <div className="bbody"><InputHubPanel p={p} locked={locked} edit={edit} /></div>
          : <LibraryWorkspace p={p} locked={locked} mode={view.visualMode} filter={view.libraryFilter} libVersion={libVersion}
            setFilter={(f) => setView({ ...view, libraryFilter: f })} setMode={(m) => setView({ ...view, visualMode: m })}
            onAdd={onAddFromLibrary} onImportAml={onImportAml} onExportAml={() => download('ecd-library-export.aml', exportLibraryAml(), 'application/xml')} />}
      </div>}

      {step === 'canvas' && <div className="workspace ws-canvas">
        <div className="toolbar">
          <button className={mode === 'select' ? 'on' : ''} onClick={() => { setMode('select'); setConnectFrom(null); }}>선택/이동</button>
          <button className={mode === 'flow' ? 'on' : ''} onClick={() => { setMode('flow'); setConnectFrom(null); }} title="Unit → Unit 물류 흐름 연결">물류 연결</button>
          <button className={mode === 'signal' ? 'on' : ''} onClick={() => { setMode('signal'); setConnectFrom(null); }} title="출력(out) 포트 → 입력(in) 포트">신호 연결</button>
          <div className="sep" />
          <button onClick={() => edit(C.alignNodes(p, selection, 'left'), '왼쪽 정렬')} disabled={selection.length < 2 || locked}>좌 정렬</button>
          <button onClick={() => edit(C.alignNodes(p, selection, 'top'), '위 정렬')} disabled={selection.length < 2 || locked}>상 정렬</button>
          <button className="danger" onClick={() => selectedId && requestDelete(selectedId)} disabled={!selectedId || locked}>삭제</button>
          <div className="sep" />
          {visualToggle}
          <div className="layerbox"><button onClick={() => setLayerOpen(!layerOpen)}>레이어 ▾</button>
            {layerOpen && <div className="layerpop">{([['background', 'Background'], ['units', 'Units'], ['axis', 'Axis(축·이송 Device)'], ['io', 'I/O(포트·신호선)'], ['positions', 'Positions'], ['flow', 'Flow(물류·자재)']] as [LayerId, string][]).map(([k, l]) =>
              <label key={k} style={{ fontSize: 12, whiteSpace: 'nowrap' }}><input type="checkbox" checked={L[k]} onChange={(e) => setView({ ...view, layers: { ...L, [k]: e.target.checked } })} /> {l}</label>)}
              <div className="muted" style={{ fontSize: 10 }}>숨김 ≠ 삭제 · 시뮬 제외 아님</div></div>}</div>
          <button onClick={() => setView({ ...view, zoom: Math.max(0.5, +(view.zoom - 0.1).toFixed(2)) })}>−</button>
          <span className="mono">{Math.round(view.zoom * 100)}%</span>
          <button onClick={() => setView({ ...view, zoom: Math.min(2, +(view.zoom + 0.1).toFixed(2)) })}>+</button>
          {connectFrom && <span className="badge acc">연결 시작: {connectFrom} (Esc 취소)</span>}
        </div>
        <div className="left">
          <div className="ph">팔레트 ({ASSET_LIBRARY.length}종 AML 정의 + 빈 유닛) — 드래그</div>
          <div className="palette">
            <div className="pi" draggable onDragStart={(e) => e.dataTransfer.setData('application/x-ecd-asset', 'unit')}><PaletteIcon kind="unit" />빈 유닛</div>
            {ASSET_LIBRARY.map((a) => <div key={a.kind} className="pi" draggable onDragStart={(e) => e.dataTransfer.setData('application/x-ecd-asset', a.kind)} title={`${a.id}@${a.version} · ${a.amlSource.file}`}><PaletteIcon kind={a.kind} />{a.name}</div>)}
          </div>
        </div>
        <div className="center">{canvasEl}</div>
        <div className="right">{inspectorEl}</div>
      </div>}

      {step === 'attributes' && <div className="workspace ws-full ws-noTabs">
        <div className="bbody" style={{ display: 'grid', gridTemplateColumns: 'minmax(360px, 1fr) minmax(300px, 1fr)', gap: 12, alignContent: 'start' }}>
          <div style={{ border: '1px solid var(--border)', borderRadius: 6 }}>{inspectorEl}</div>
          <div>
            {(() => { const uid = p.units.find((u) => u.id === selectedId)?.id ?? p.devices.find((d) => d.id === selectedId)?.unitId; return uid
              ? <div className="section"><h4>제공 능력표 — {unitName(p, uid)} (F3-03)</h4><CapabilityTable p={p} unitId={uid} /></div>
              : <div className="notice">왼쪽에서 Unit 또는 Device를 선택하면 속성/신호/포지션/Action 편집기와 제공 능력표가 열립니다.</div>; })()}
            <div className="section"><h4>이 단계 남은 항목</h4>{evals.attributes.items.slice(0, 30).map((it, i) => <div key={i} style={{ fontSize: 11 }}><span className={`badge ${it.level === 'missing' ? 'err' : 'warn'}`}>{LEVEL_LABEL[it.level]}</span> {it.text} {it.targetId && <button className="small" onClick={() => goItem(it)}>선택</button>}</div>)}</div>
          </div>
        </div>
      </div>}

      {step === 'sequence' && <div className="workspace ws-full">
        <Sub items={[['sequence', 'Station 시퀀스 Draft (F5)'], ['subseq', `Substation 시퀀스 (${(p.substationSequences ?? []).length})`], ['material', '자재·Flow (F4)'], ['sfc', 'SFC 미리보기']]} />
        <div className="bbody">
          {sub === 'sequence' && <SequencePanel p={p} rt={rt} locked={locked} edit={edit} onSelect={(id) => { setSelection([id]); setRightTab('actions'); goStep('attributes'); }} />}
          {sub === 'subseq' && <SubSequencePanel p={p} unitId={subUnitId} setUnitId={(id) => setSubUnitPref(id)} locked={locked} edit={edit} gs={gs} />}
          {sub === 'material' && <MaterialPanel p={p} locked={locked} edit={edit} />}
          {sub === 'sfc' && <SfcPanel p={p} rt={rt} />}
        </div>
      </div>}

      {step === 'check' && <div className="workspace ws-full">
        <Sub items={[['gap', `Gap (F6) ${tab.gaps.length}`], ['diag', '진단·저장·AML'], ['export', 'Export 미리보기 (F8)'], ['lab', 'Evolution Lab (F7)']]} />
        <div className="bbody">
          {sub === 'gap' && <GapPanel p={p} gaps={tab.gaps} analyzedRevision={tab.analyzedRevision} onReanalyze={reanalyze} onGo={goGap} onReview={reviewGap} />}
          {sub === 'diag' && <DiagPanel p={p} storageReason={storage.kv ? null : storage.reason ?? '저장소 없음'} quarantineList={qlist} onDownload={download} />}
          {sub === 'export' && <ExportPanel p={p} />}
          {sub === 'lab' && <LabPanel />}
        </div>
      </div>}

      {step === 'run' && <div className="workspace ws-run">
        <div className="toolbar">
          <div className="seg" role="tablist" aria-label="실행 대상">
            <button role="tab" aria-selected={runMode === 'station'} className={runMode === 'station' ? 'on' : ''} onClick={() => setRunMode('station')}>Station 시퀀스</button>
            <button role="tab" aria-selected={runMode === 'group'} className={runMode === 'group' ? 'on' : ''} onClick={() => setRunMode('group')}>Substation 그룹</button></div>
          <div className="sep" />
          {runMode === 'station' ? runControls : groupControls}<div className="sep" />{visualToggle}<div className="sep" /><button onClick={doSave}>저장</button>
          <span className="badge">{dirty ? '저장 안 됨' : '저장됨'}</span>
          {runMode === 'station' ? <><span className="badge">{rt?.status === 'completed' ? '시뮬 완료' : `시뮬 ${rt?.status ?? 'idle'}`}</span>
            <span className="badge">실행 전 검사 {evals.check.items.some((i) => i.level === 'missing') ? '미통과' : '통과'}</span></> : <span className="badge">그룹 {gs?.status ?? 'idle'}</span>}</div>
        <div className="center">{runCanvasEl}</div>
        <div className="right"><div className="bbody">{runMode === 'station' ? <><RuntimePanel p={p} rt={rt} locked={locked} edit={edit} />
          {rt?.status === 'completed' && <div className="notice">완료 요약: 논리 시뮬레이션 완료 (실제 장비 안전·정밀 물리 검증·Core Export 준비 완료 아님). 남은 가정/미정은 5 점검 단계에서 확인.</div>}</>
          : <><GroupRunPanel p={p} gs={gs} unitId={subUnitId} />
            {gs?.status === 'completed' && <div className="notice">그룹 완료: 이 Substation의 시퀀스가 모두 논리적으로 완주했습니다 (실제 장비 동시 동작·안전 검증 아님).</div>}</>}</div></div>
      </div>}

      <div className="statusbar">
        <b style={{ color: 'var(--warning)' }}>논리 시뮬레이션 · 실제 장비 제어 아님 · 정밀 물리/충돌 검증 아님</b>
        <span>rev {p.revision}</span><span>Undo {tab.history.past.length} / Redo {tab.history.future.length}</span>
        <span>실행 {rt?.status ?? 'idle'}{tab.runtime ? ` (스냅샷 rev ${tab.runtime.snapshot.revision})` : ''} · 그룹 {gs?.status ?? 'idle'}</span>
        <span>저장소: {kv ? 'localStorage' : '메모리 전용'}</span>
        <span>에셋 {ASSET_LIBRARY.length}종 (AML {LOADED_LIBRARIES.length}파일)</span>
        <span className="grow" />
        <span>형식 {FILE_FORMAT_VERSION} · 규칙 {RUNTIME_RULES_VERSION} / {GROUP_RULES_VERSION} · 수치는 [예시] 가정값</span>
      </div>

      {toast && <div className={`toast ${toast.err ? 'err' : ''}`} style={style}>{toast.msg}</div>}
      {modal && <div className="modal-bg" style={style} onClick={() => setModal(null)}><div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{modal.title}</h3>{modal.body}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>{modal.actions.map((a) => <button key={a.label} className={a.primary ? 'primary' : a.danger ? 'danger' : ''} onClick={() => { setModal(null); a.run(); }}>{a.label}</button>)}</div>
      </div></div>}
    </div>
  );
}
