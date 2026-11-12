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
import { detectStorage, loadProject, quarantine, readIndex, readQuarantine, type KV, type QuarantineEntry } from '../storage/localStore';
import { Canvas, type Mode } from './Canvas';
import { flowSummary, LayoutBoard } from './LayoutBoard';
import { Inspector } from './Inspector';
import { LibraryWorkspace } from './Library';
import { evaluateSteps, LEVEL_LABEL, stepBadge, STEPS, type StepId, type StepItem } from './wizard';
import { connectStartLabel, devName, sigName, unitName } from './labels';
import { QtyInput, TextInput } from './widgets';
import { DiagPanel, ExportPanel, ExtendPanel, ExtractPanel, fmtTime, GapPanel, InputHubPanel, LabPanel, MaterialPanel, RuntimePanel, SequencePanel, SfcPanel } from './Panels';
import { PaletteIcon } from './Symbols';
import { GroupRunPanel, SubSequencePanel, SubstationSelect } from './SubstationPanels';
import type { BlockerGuide } from './blockerTarget';
import type { Diagnostic } from '../model/validate';
import { appearanceOf, loadView, paletteTheme, saveView, THEMES, type ExplorerTab, type LayerId, type LayoutTab, type PanelKey, type UserView } from './viewSettings';
import { screenOf } from './screens';
import { AmlResultSheet, BlockerSheet, BundleSheet, DiagSheet, ExportSheet, ExtendSheet, ExtractSheet, FilesSheet, gapVisible, LabSheet, materialSize, routeText, SearchSheet, signalCaption, signalRole } from './SparseScreens';
import * as W from '../storage/workspaces';
import { collapseAllIds, ProjectTree } from './ProjectTree';
import { dialogOpen, NameDialog, ProjectList, type ProjectListRow, StaticModalFrame, WorkspaceManager } from './WorkspacePanels';
import { Fold } from './Fold';
import { PanelSplit } from './PanelSplit';
import { Tabs } from './Tabs';

interface Tab { key: string; history: History; savedRevision: number | null; savedAt: string | null; runtime: Runtime | null; group: GroupRuntime | null; gaps: Gap[]; analyzedRevision: number | null }
interface Modal { title: string; body: React.ReactNode; actions: { label: string; primary?: boolean; danger?: boolean; focus?: boolean; run: () => void }[] }
interface NameDlg { title: string; initial: string; hint?: string; submitLabel: string; validate: (n: string) => string | null; onSubmit: (n: string) => void }

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

/** onHistory: test seam (unit tests only) — receives the active tab's undo history after each change. No global exposure. */
export function App({ onHistory }: { onHistory?: (h: History) => void } = {}) {
  const storage = useMemo(() => detectStorage(), []);
  const kv = storage.kv;
  useState(() => { restoreImportedAml(kv); return 0; });
  const [libVersion, setLibVersion] = useState(0);
  const [view, setView] = useState<UserView>(() => loadView(kv));
  const [qlist, setQlist] = useState<QuarantineEntry[]>(() => readQuarantine(kv));
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  // TURN-002: workspaces (browser-local management unit). Non-destructive migration on start; memory-only without storage.
  const [wsInit] = useState(() => (kv ? W.ensureWorkspaces(kv) : null));
  const [reg, setReg] = useState<W.WorkspaceRegistry>(() => wsInit?.reg ?? { formatVersion: 1, activeId: W.DEFAULT_WS_ID, workspaces: [{ id: W.DEFAULT_WS_ID, name: W.DEFAULT_WS_NAME, createdAt: '', updatedAt: '', projectIds: [] }] });
  const [tabs, setTabs] = useState<Tab[]>(() => {
    if (kv && wsInit) {
      const idx = W.listProjects(kv, wsInit.reg, wsInit.reg.activeId);
      if (idx.length) {
        const r = loadProject(kv, idx[0].id);
        if (r.ok) return [makeTab(r.project, { rev: r.project.revision, at: idx[0].savedAt })];
      }
      // a non-default, empty workspace starts with a blank project; the default workspace keeps the old 5-step sample start
      if (wsInit.reg.activeId !== W.DEFAULT_WS_ID) return [makeTab(emptyProject('새 프로젝트'))];
    }
    return [makeTab(buildSampleProject())];
  });
  const [nameDlg, setNameDlg] = useState<NameDlg | null>(null);
  const [activeKey, setActiveKey] = useState(() => tabs[0].key);
  const [selection, setSelection] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>('select');
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState('props');
  const [subTab, setSubTab] = useState<Record<StepId, string>>({ library: 'cards', canvas: '', attributes: '', sequence: 'sequence', check: 'gap', run: '' });
  const [itemsOpen, setItemsOpen] = useState(false);
  const step = view.step;
  const goStep = (s: StepId, sub?: string) => { setView((v) => ({ ...v, step: s, home: false })); if (sub) setSubTab((t) => ({ ...t, [s]: sub })); setItemsOpen(false); };
  const chooseTheme = (mode: 'light' | 'dark') => { const next = mode === 'dark' ? 'B' as const : 'A' as const; setView((v) => (v.theme === next ? v : { ...v, theme: next })); };
  const setBottomTab = (k: string) => {
    const map: Record<string, [StepId, string]> = { runtime: ['run', ''], material: ['sequence', 'material'], sequence: ['sequence', 'sequence'], diag: ['check', 'diag'], gap: ['check', 'gap'] };
    const m = map[k]; if (m) goStep(m[0], m[1]);
  };
  const [layerOpen, setLayerOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
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
  const [libDetail, setLibDetail] = useState(false);
  const [guide, setGuide] = useState<'files' | 'bundle' | 'search' | null>(null);
  const [gapFilter, setGapFilter] = useState<'all' | 'shortfall' | 'human' | 'hidden'>('all');
  const selUnit = (() => { const id = selection[0]; return p.units.find((u) => u.id === id)?.id ?? p.devices.find((d) => d.id === id)?.unitId; })();
  const subUnitId = gs?.unitId ?? (p.units.some((u) => u.id === subUnitPref) ? subUnitPref : selUnit ?? p.units.find((u) => (p.substationSequences ?? []).some((q) => q.unitId === u.id))?.id ?? p.units[0]?.id ?? '');

  useEffect(() => { saveView(kv, view); }, [kv, view]);
  useEffect(() => { if (wsInit?.warnings.length) say(wsInit.warnings.join(' / '), true); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onHistory?.(tab.history); }, [onHistory, tab.history]);
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
    if (s2.state.status !== 'running') say(`그룹 실행 전 검사 차단: ${checkMsg(s2.state)} — 오른쪽 「실행 전 검사」의 이동 버튼으로 수정 위치를 엽니다`, true);
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
  const onDropAsset = (kind: AssetKind | 'unit', at: { x: number; y: number }, unitId?: string) => {
    if (locked) { say('실행 중에는 배치(모델 편집)가 차단됩니다', true); return; }
    if (kind === 'unit') { const r = C.addUnit(p, '', { x: Math.round(at.x - 108), y: Math.round(at.y - 20) }); if (edit(r, 'Unit 배치') && r.ok) setSelection([r.note!]); return; }
    const def = findAsset(kind);
    if (def?.template) { const r2 = C.addUnitFromTemplate(p, kind, { x: Math.round(at.x - 108), y: Math.round(at.y - 20) }); if (edit(r2, `${def.name} 배치`) && r2.ok) setSelection([r2.note!]); return; }
    const pt = unitId ? { x: Math.round(at.x), y: Math.round(at.y) } : { x: Math.round(at.x - 25), y: Math.round(at.y - 20) };
    const r = C.addDevice(p, kind, pt, undefined, undefined, unitId);
    if (edit(r, `${def?.name ?? kind} 배치`) && r.ok) { setSelection([r.note!]); setRightTab('props'); }
  };
  const onResizeCommit = (unitId: string, w: number, h: number) => { edit(C.resizeUnit(p, unitId, w, h), 'Unit 크기'); };
  const fitSelectedUnit = () => {
    const id = selection.length === 1 && p.units.some((u) => u.id === selection[0]) ? selection[0] : null;
    if (!id) return;
    edit(C.fitUnitToContent(p, id), '크기 맞춤');
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
  const onSignalConnect = (fromId: string, toId: string) => {
    const r = C.addConnection(p, 'signal', fromId, toId);
    if (edit(r, '신호 연결')) say('신호 연결 추가');
    setConnectFrom(null);
  };
  const onConnectCancel = () => setConnectFrom(null);
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
      // rev 4: while any dialog is open, background project shortcuts (Undo/Redo/Delete/Esc mode reset) never act
      if (dialogOpen()) return;
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
  const persistTab = (target: Tab): boolean => {
    if (!kv) { say(`${storage.reason} — JSON 내보내기를 사용하세요. 메모리 변경은 유지됩니다.`, true); return false; }
    const proj = target.history.present;
    const owner = W.ownerOf(reg, proj.id);
    if (owner && owner.id !== reg.activeId) {
      if (target.key === tab.key) {
        setModal({ title: '다른 Workspace에 같은 ID가 저장되어 있음', body: <p>{proj.name} ({proj.id})와 같은 ID의 프로젝트가 Workspace 「{owner.name}」에 저장되어 있습니다. 덮어쓰지 않았습니다. 새 ID 사본으로 현재 Workspace 「{curWs.name}」에 저장할 수 있습니다.</p>,
          actions: [{ label: '취소', focus: true, run: () => {} }, { label: '새 ID 사본으로 저장', primary: true, run: () => saveAsCopy() }] });
      } else say('다른 Workspace에 같은 ID가 있어 저장하지 못했습니다. 탭은 그대로 두었습니다.', true);
      return false;
    }
    // TURN-002 rev 2: body + index + membership in one transaction — either all saved or nothing changed
    const r = W.saveProjectInWorkspace(kv, reg, reg.activeId, proj);
    if (!r.ok) { say(r.reason, true); return false; }
    setReg(r.reg);
    updTab(target.key, (t) => ({ ...t, savedRevision: proj.revision, savedAt: r.savedAt }));
    say(`브라우저 저장소에 저장됨 (Workspace 「${curWs.name}」, 저장 후 읽기 확인 완료)`);
    return true;
  };
  const doSave = () => { persistTab(tab); };
  /** project id saved in another workspace → save a copy with a new id here (the original tab content moves to the copy; nothing lost) */
  const saveAsCopy = () => {
    if (!kv) return;
    const copy = { ...p, id: `${p.id}-copy-${Date.now().toString(36)}` };
    const r = W.saveProjectInWorkspace(kv, reg, reg.activeId, copy);
    if (!r.ok) { say(`${r.reason} — 사본을 만들지 않았고 현재 탭은 그대로입니다`, true); return; }
    setReg(r.reg);
    const t = makeTab(copy, { rev: copy.revision, at: r.savedAt });
    setTabs((ts) => ts.map((x) => (x.key === tab.key ? t : x))); setActiveKey(t.key);
    say(`새 ID 사본 ${copy.id}로 저장했습니다 (원래 Workspace의 프로젝트는 그대로)`);
  };
  const openSaved = (id: string) => {
    const existing = tabs.find((t) => t.history.present.id === id);
    if (existing) { setActiveKey(existing.key); setView((v) => ({ ...v, home: false })); say('이미 열린 프로젝트입니다 — 기존 탭으로 이동했습니다'); return; }
    const r = loadProject(kv!, id);
    if (!r.ok) {
      if (r.raw) setQlist((l) => quarantine(kv, { at: new Date().toLocaleString(), label: `saved:${id}`, raw: r.raw, errors: r.errors.map((e) => e.message) }, l));
      say(`열기 실패: ${r.errors.map((e) => e.message).slice(0, 2).join(' / ')} (원본 덮어쓰기 없음)`, true); return;
    }
    const entry = readIndex(kv!).find((e) => e.id === id);
    const t = makeTab(r.project, { rev: r.project.revision, at: entry?.savedAt ?? '' });
    setTabs((ts) => [...ts, t]); setActiveKey(t.key); setSelection([]); setView((v) => ({ ...v, home: false }));
    if (r.warnings.length) say(`경고 ${r.warnings.length}: ${r.warnings[0].message}`);
  };
  const openExplorerTab = (id: ExplorerTab) => {
    setExplorerOpen(true);
    setView((v) => (v.explorerTab === id ? v : { ...v, explorerTab: id }));
  };
  const openLayoutTab = (id: LayoutTab) => {
    setView((v) => (v.layoutTab === id ? v : { ...v, layoutTab: id }));
  };
  const showOpen = () => {
    if (!kv) { say(`${storage.reason}. JSON 가져오기를 사용하세요.`, true); return; }
    openExplorerTab('project');
  };
  const newProject = (kind: 'blank' | 'sample' | 'parallel') => {
    const used = projectNames();
    const proj = kind === 'sample' ? { ...buildSampleProject(), id: `prj-${Date.now().toString(36)}`, name: W.uniqueName(`5공정 예제 사본 ${tabs.length + 1}`, used) }
      : kind === 'parallel' ? { ...buildParallelSampleProject(), id: `prj-par-${Date.now().toString(36)}`, name: W.uniqueName(`병렬 Substation 예제 ${tabs.length + 1}`, used) }
      : emptyProject(W.uniqueName(`새 프로젝트 ${tabs.length + 1}`, used));
    const t = makeTab(proj); setTabs((ts) => [...ts, t]); setActiveKey(t.key); setSelection([]);
    setView((v) => ({ ...v, home: false }));
  };
  const closeTab = (key: string) => {
    const t = tabs.find((x) => x.key === key)!;
    const doClose = () => setTabs((ts) => { const n = ts.filter((x) => x.key !== key); const list = n.length ? n : [makeTab(emptyProject('새 프로젝트'))]; if (key === activeKey) setActiveKey(list[0].key); return list; });
    if (t.savedRevision !== t.history.present.revision) setModal({ title: '저장하지 않은 변경', body: <p>{t.history.present.name}에 저장되지 않은 변경이 있습니다. 저장에 성공한 뒤에만 탭을 닫습니다. 버리기는 이 확인에서만 적용됩니다.</p>, actions: [
      { label: '취소 (변경 유지)', focus: true, run: () => {} },
      { label: '저장 후 닫기', primary: true, run: () => { if (persistTab(t)) doClose(); } },
      { label: '저장하지 않고 닫기', danger: true, run: doClose },
    ] });
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
        actions: [{ label: '새 ID 사본으로 열기', primary: true, run: () => { const t = makeTab({ ...r.project, id: `${r.project.id}-copy-${Date.now().toString(36)}`, name: `${r.project.name} (가져온 사본)` }); setTabs((ts) => [...ts, t]); setActiveKey(t.key); setView((v) => ({ ...v, home: false })); } }, { label: '기존 탭으로 이동', run: () => { setActiveKey(existing.key); setView((v) => ({ ...v, home: false })); } }] });
      return;
    }
    const t = makeTab(r.project); setTabs((ts) => [...ts, t]); setActiveKey(t.key); setSelection([]); setView((v) => ({ ...v, home: false }));
    say(`가져오기 완료${r.warnings.length ? ` (경고 ${r.warnings.length}: ${r.warnings[0].message})` : ''} — 아직 브라우저 저장소에는 저장되지 않음`);
  };

  const appearance = appearanceOf(view.theme);
  const themeVars = THEMES[paletteTheme(view.theme)].vars;
  const setPanel = (key: PanelKey, n: number) => setView((v) => (v.panels[key] === n ? v : { ...v, panels: { ...v.panels, [key]: n } }));
  const style = { ...Object.fromEntries(Object.entries(themeVars).map(([k, v]) => [`--${k}`, v])),
    '--exw': `${view.panels.explorer}px`, '--libw': `${view.panels.library}px`, '--propw': `${view.panels.canvas}px`, '--runw': `${view.panels.run}px` } as React.CSSProperties;
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
  // TURN-001: 6단계 그룹 실행 차단 항목 → 원인 수정/확인 화면으로 이동 (보기 상태만 변경, 모델·Undo 불변).
  // 그룹 실행 대상(subUnitId)은 이동 전에 보기 선호값으로 고정해, 편집 대상 선택이 실행 Substation을 바꾸지 않게 한다.
  const goBlocker = (_b: Diagnostic, g: BlockerGuide) => {
    if (!g.dest) return;
    if (subUnitId) setSubUnitPref(subUnitId);
    if (g.focus) { setSelection([g.focus.id]); setRightTab(g.focus.kind === 'device' ? 'actions' : 'props'); }
    goStep(g.dest.step, g.dest.sub);
  };
  const BADGE = { ready: ['ok', '필수 충족'], blocked: ['err', '필수 누락'], recheck: ['warn', '재확인 필요'], confirmed: ['ok', '확인됨 ✓'] } as const;
  const sub = subTab[step];
  const Sub = ({ items }: { items: [string, string][] }) => <div className="tabs subtabs">{items.map(([k, l]) => <button key={k} className={sub === k ? 'on' : ''} onClick={() => setSubTab((t) => ({ ...t, [step]: k }))}>{l}</button>)}</div>;
  const subCount = (uid: string) => (p.substationSequences ?? []).filter((q) => q.unitId === uid).length;
  const pick = (id: string) => { setSelection([id]); const u = p.units.find((x) => x.id === id)?.id ?? p.devices.find((d) => d.id === id)?.unitId; if (u && !groupLocked) setSubUnitPref(u); };
  const collapsed = view.treeCollapsed[p.id] ?? [];
  const setCollapsed = (ids: string[]) => setView((v) => ({ ...v, treeCollapsed: { ...v.treeCollapsed, [p.id]: ids } }));
  const tree = <ProjectTree p={p} selection={selection} collapsed={collapsed} onCollapsedChange={setCollapsed} onPick={pick} subCount={subCount} />;

  // ---------- TURN-002: workspace / project management ----------
  const curWs = W.activeWs(reg);
  /** names in scope for duplicate checks: saved projects of the current workspace + open tabs (optionally excluding one project id) */
  const projectNames = (exceptId?: string) => {
    const saved = kv ? W.listProjects(kv, reg, reg.activeId).filter((e) => e.id !== exceptId).map((e) => e.name) : [];
    return [...saved, ...tabs.filter((t) => t.history.present.id !== exceptId).map((t) => t.history.present.name)];
  };
  const savedCount = (wsId: string) => (kv ? W.listProjects(kv, reg, wsId).length : 0);
  const commitReg = (next: W.WorkspaceRegistry, okMsg: string) => {
    if (kv) { const w = W.writeRegistry(kv, next, reg); if (!w.ok) { say(`${w.reason} — 변경하지 않았습니다`, true); return false; } }
    setReg(next); say(okMsg); return true;
  };
  const openIds = new Set(tabs.map((t) => t.history.present.id));
  /** switching workspaces closes the current tabs, so it is refused while any tab has unsaved edits (never drop user input) */
  const requestSwitch = (id: string) => {
    if (id === reg.activeId) return;
    const target = reg.workspaces.find((w) => w.id === id); if (!target) return;
    if (tabs.some((t) => t.runtime?.state.status === 'running' || t.runtime?.state.status === 'paused' || t.group?.state.status === 'running' || t.group?.state.status === 'paused')) {
      say('실행 중이거나 일시정지된 프로젝트가 있어 Workspace를 바꿀 수 없습니다 — 먼저 초기화하세요', true); return;
    }
    const edited = tabs.filter((t) => t.savedRevision !== t.history.present.revision && !(t.savedRevision === null && t.history.past.length === 0));
    if (edited.length) {
      setModal({ title: 'Workspace 전환 불가 — 저장하지 않은 변경', body: <div><p>다음 프로젝트에 저장하지 않은 변경이 있습니다. 전환하면 탭이 닫히므로 막았습니다. 변경 내용은 그대로 있습니다.</p>
        <ul>{edited.map((t) => <li key={t.key}>{t.history.present.name}</li>)}</ul><p className="muted">먼저 「저장」하거나 탭을 닫은 뒤 다시 전환하세요.</p></div>, actions: [{ label: '저장하러 돌아가기', focus: true, run: () => {} }] });
      return;
    }
    const fresh = tabs.filter((t) => t.savedRevision === null);
    const go = () => {
      const a = W.setActive(reg, id); if (!a.ok) { say(a.reason, true); return; }
      if (!commitReg(a.reg, `Workspace 「${target.name}」(으)로 전환했습니다`)) return;
      const idx = kv ? W.listProjects(kv, a.reg, id) : [];
      const r = idx.length && kv ? loadProject(kv, idx[0].id) : null;
      const t = r && r.ok ? makeTab(r.project, { rev: r.project.revision, at: idx[0].savedAt }) : makeTab(emptyProject('새 프로젝트'));
      setTabs([t]); setActiveKey(t.key); setSelection([]); setConnectFrom(null); setSubUnitPref('');
    };
    if (fresh.length) {
      setModal({ title: `Workspace 「${target.name}」(으)로 전환`, body: <div><p>저장한 적 없는 새 탭 {fresh.length}개(편집 없음)가 닫힙니다:</p><ul>{fresh.map((t) => <li key={t.key}>{t.history.present.name}</li>)}</ul><p className="muted">저장된 프로젝트는 원래 Workspace에 그대로 남습니다.</p></div>,
        actions: [{ label: '취소', focus: true, run: () => {} }, { label: '닫고 전환', primary: true, run: go }] });
      return;
    }
    go();
  };
  const createWs = () => setNameDlg({ title: '새 Workspace', initial: '', submitLabel: '만들기', hint: '이 브라우저 안의 새 프로젝트 묶음을 만듭니다(파일 폴더 아님).',
    validate: (n) => W.validateName(n, reg.workspaces.map((w) => w.name)),
    onSubmit: (n) => { const r = W.createWorkspace(reg, n); if (!r.ok) { say(r.reason, true); return; } if (commitReg(r.reg, `Workspace 「${r.ws.name}」을(를) 만들었습니다 — 「전환」으로 이동하세요`)) setNameDlg(null); } });
  const renameWs = (id: string) => { const w = reg.workspaces.find((x) => x.id === id); if (!w) return;
    setNameDlg({ title: `Workspace 이름 변경 — ${w.name}`, initial: w.name, submitLabel: '이름 변경', hint: `ID ${w.id}는 바뀌지 않습니다.`,
      validate: (n) => W.validateName(n, reg.workspaces.filter((x) => x.id !== id).map((x) => x.name)),
      onSubmit: (n) => { const r = W.renameWorkspace(reg, id, n); if (!r.ok) { say(r.reason, true); return; } if (commitReg(r.reg, `Workspace 이름을 「${n}」(으)로 바꿨습니다`)) setNameDlg(null); } }); };
  const deleteWs = (id: string) => { const w = reg.workspaces.find((x) => x.id === id); if (!w) return;
    const why = W.deleteBlockReason(reg, id, savedCount(id)); if (why) { say(why, true); return; }
    setModal({ title: `Workspace 삭제 — ${w.name}`, body: <p>빈 Workspace 「{w.name}」({w.id})을(를) 삭제합니다. 프로젝트는 없습니다.</p>,
      actions: [{ label: '취소', focus: true, run: () => {} }, { label: 'Workspace 삭제', danger: true, run: () => { const r = W.deleteWorkspace(reg, id, savedCount(id)); if (!r.ok) { say(r.reason, true); return; } commitReg(r.reg, `Workspace 「${w.name}」을(를) 삭제했습니다`); } }] }); };
  const renameOpenProject = (key: string) => { const t = tabs.find((x) => x.key === key); if (!t) return;
    if (key !== tab.key) { switchTab(key); }
    const cur = t.history.present;
    setNameDlg({ title: `프로젝트 이름 변경 — ${cur.name}`, initial: cur.name, submitLabel: '이름 변경', hint: '열린 프로젝트의 모델 변경입니다: rev +1, Undo/Redo 가능, 「저장」하면 저장 목록에 반영됩니다. ID는 바뀌지 않습니다.',
      validate: (n) => W.validateName(n, projectNames(cur.id)),
      onSubmit: (n) => {
        const o = applyEdit(t.history, C.renameProject(t.history.present, n), '프로젝트 이름 변경', !!(t.runtime && t.runtime.state.status !== 'idle') || !!(t.group && t.group.state.status !== 'idle'));
        if (o.error) { say(o.error, true); return; }
        updTab(key, (x) => ({ ...x, history: o.history, runtime: null, group: null })); setNameDlg(null); say(`프로젝트 이름을 「${n}」(으)로 바꿨습니다 — 저장하면 목록에 반영됩니다`);
      } }); };
  const renameSaved = (id: string) => { if (!kv) return; const e = W.listProjects(kv, reg, reg.activeId).find((x) => x.id === id); if (!e) return;
    if (openIds.has(id)) { say('열린 프로젝트는 프로젝트 상세에서 이름을 바꾸세요', true); return; }
    setNameDlg({ title: `저장된 프로젝트 이름 변경 — ${e.name}`, initial: e.name, submitLabel: '이름 변경', hint: '닫힌 저장본의 이름을 바꿔 다시 저장합니다(rev +1, Undo 대상 아님). ID는 바뀌지 않습니다.',
      validate: (n) => W.validateName(n, projectNames(id)),
      onSubmit: (n) => { const r = W.renameSavedProject(kv, id, n); if (!r.ok) { say(r.reason, true); return; } setNameDlg(null); setReg((x) => ({ ...x })); say(`저장된 프로젝트 이름을 「${n}」(으)로 바꿨습니다 (rev ${r.revision})`); } }); };
  const deleteSaved = (id: string) => { if (!kv) return; const e = W.listProjects(kv, reg, reg.activeId).find((x) => x.id === id); if (!e) return;
    if (openIds.has(id)) { say('열린 프로젝트는 삭제할 수 없습니다 — 먼저 탭을 닫으세요', true); return; }
    setModal({ title: `프로젝트 영구 삭제 — ${e.name}`, body: <div><p><b>{e.name}</b> <span className="mono">({e.id})</span>, rev {e.revision}</p>
      <p className="err-text">이 브라우저 저장소에서 영구 삭제합니다. <b>되돌릴 수 없습니다</b>(Undo 대상 아님). 필요하면 먼저 JSON으로 내보내세요.</p></div>,
      actions: [{ label: '취소', focus: true, run: () => {} },
        { label: 'JSON 내보내기', run: () => { const raw = kv.getItem(`ecd.v1.project.${id}`); if (raw) download(`${e.name.replace(/[^\w가-힣-]+/g, '_')}.ecd.json`, raw); setTimeout(() => deleteSaved(id), 0); } },
        { label: '영구 삭제', danger: true, run: () => { const r = W.deleteSavedProject(kv, reg, id); if (!r.ok) { say(r.reason, true); return; } setReg(r.reg); say(`「${e.name}」을(를) 삭제했습니다`); } }] }); };
  /** N03: switching projects while this project runs → pause its run first (state kept, no auto resume). */
  const switchTab = (key: string) => {
    if (key !== tab.key) {
      if (rt?.status === 'running' || gs?.status === 'running') {
        say(`${p.name}: 실행을 일시정지하고 전환했습니다 (돌아와서 재개 가능, 자동 재개 없음)`);
      }
      setActiveKey(key); setSelection([]); setConnectFrom(null);
    }
    setView((v) => ({ ...v, home: false }));
  };
  const savedList = kv ? W.listProjects(kv, reg, reg.activeId) : [];
  const savedById = new Map(savedList.map((e) => [e.id, e]));
  const projectRows: ProjectListRow[] = [
    ...tabs.map((t) => {
      const id = t.history.present.id;
      const saved = savedById.get(id);
      return {
        id, name: t.history.present.name, tabKey: t.key, current: t.key === tab.key, open: true,
        dirty: t.savedRevision !== t.history.present.revision,
        savedRevision: t.savedRevision, savedAt: t.savedAt ?? saved?.savedAt ?? null,
      };
    }),
    ...savedList.filter((e) => !openIds.has(e.id)).map((e) => ({
      id: e.id, name: e.name, tabKey: null, current: false, open: false, dirty: false,
      savedRevision: e.revision, savedAt: e.savedAt,
    })),
  ];
  const selDev = p.devices.find((d) => d.id === selection[0]);
  const selUnitOnly = p.units.find((u) => u.id === selection[0]);
  const selCaption = selDev?.name ?? (selUnitOnly ? `${selUnitOnly.code} ${selUnitOnly.name}` : '없음');
  const workspacePanel = <div className="ex-panel">
    <WorkspaceManager workspaces={reg.workspaces} activeId={reg.activeId} counts={Object.fromEntries(reg.workspaces.map((w) => [w.id, savedCount(w.id)]))}
      deleteBlock={(id) => W.deleteBlockReason(reg, id, savedCount(id))} onSwitch={requestSwitch} onCreate={createWs} onRename={renameWs} onDelete={deleteWs} disabled={!kv}
      onBundle={() => { setGuide('bundle'); setView((v) => ({ ...v, home: false })); }}
      onSearch={() => { setGuide('search'); setView((v) => ({ ...v, home: false })); }}
      onHome={() => setView((v) => ({ ...v, home: true }))} />
  </div>;
  const projectPanel = <div className="ex-panel">
    <div className="proj-line"><button type="button" className="work-crumb" onClick={() => openExplorerTab('workspace')}>Workspace: {curWs.name}</button></div>
    <ProjectList rows={projectRows} kv={!!kv} wsName={curWs.name}
      onActivate={(row) => { if (row.tabKey) switchTab(row.tabKey); else openSaved(row.id); }}
      onCreate={newProject} onImport={() => fileRef.current?.click()}
      onFiles={() => { setGuide('files'); setView((v) => ({ ...v, home: false })); }}
      onSwitch={switchTab} onOpen={openSaved} onRenameOpen={renameOpenProject} onRenameSaved={renameSaved} onClose={closeTab} onDelete={deleteSaved} />
    <div className="canvas-rail">
      <div className="rail-tools"><span>장비 구조</span>
        <button type="button" className="small" aria-label="트리 모두 펼치기" onClick={() => setCollapsed([])}>모두 펼치기</button>
        <button type="button" className="small" aria-label="트리 모두 접기" onClick={() => setCollapsed(collapseAllIds(p))}>모두 접기</button>
      </div>
      <div className="rail-station">Station · {p.equipment.name}</div>
      {tree}
      <p className="muted">선택: {selCaption}<br />접기는 모델을 바꾸지 않습니다.</p>
    </div>
  </div>;
  const explorer = <aside className={`explorer ${explorerOpen ? '' : 'collapsed'}`} aria-label="Workspace / Project 탐색기">
    <PanelSplit kind="explorer" value={view.panels.explorer} onChange={(n) => setPanel('explorer', n)} label="탐색기 너비" />
    <div className="exhead"><button className="small icon" onClick={() => setExplorerOpen(!explorerOpen)} aria-label={explorerOpen ? '탐색기 접기' : '탐색기 펼치기'} title={explorerOpen ? '탐색기 접기' : '탐색기 펼치기'}>{explorerOpen ? '⟨' : '⟩'}</button>{explorerOpen && <b>탐색기</b>}</div>
    {explorerOpen && <Tabs label="탐색기" idBase="explorer" value={view.explorerTab} onChange={openExplorerTab} tabs={[
      { id: 'workspace', label: 'Workspace', panel: workspacePanel },
      { id: 'project', label: 'Project', panel: projectPanel },
    ]} />}
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
  const onZoomChange = (z: number) => setView((v) => (Math.abs(v.zoom - z) < 0.001 ? v : { ...v, zoom: z }));
  const connectNote = connectFrom ? `연결 시작: ${connectStartLabel(p, connectFrom)}. Esc로 취소합니다.` : null;
  const runCanvasEl = <Canvas project={p} rt={runMode === 'group' ? groupCanvasRt : rt} activeDeviceIds={runMode === 'group' ? activeDeviceIds : undefined} view={view} selection={selection} mode={mode} connectFrom={connectFrom} locked={locked}
    onSelect={(ids) => setSelection(ids)} onMoveCommit={onMoveCommit} onResizeCommit={onResizeCommit} onDropAsset={onDropAsset} onPortClick={onPortClick}
    onSignalConnect={onSignalConnect} onConnectCancel={onConnectCancel}
    onUnitConnectClick={onUnitConnectClick} onBlocked={(m) => say(m, true)} onZoomChange={onZoomChange} connectNote={connectNote} />;
  const canvasEl = <Canvas project={p} rt={rt} view={view} selection={selection} mode={mode} connectFrom={connectFrom} locked={locked}
    onSelect={(ids) => setSelection(ids)} onMoveCommit={onMoveCommit} onResizeCommit={onResizeCommit} onDropAsset={onDropAsset} onPortClick={onPortClick}
    onSignalConnect={onSignalConnect} onConnectCancel={onConnectCancel}
    onUnitConnectClick={onUnitConnectClick} onBlocked={(m) => say(m, true)} onZoomChange={onZoomChange} connectNote={connectNote} />;
  const inspectorEl = <Inspector project={p} selectedId={selectedId} locked={locked} gaps={tab.gaps} edit={edit} onAddStep={(id) => edit(C.addStep(p, id), '단계 추가')}
    onDelete={requestDelete} onReparent={requestReparent} tab={rightTab} setTab={setRightTab} visualMode={view.visualMode} />;

  const screen = screenOf({ home: !!view.home, step, sub, rightTab, runMode, groupBlocked: !!(gs && (gs.blockers.length > 0 || gs.status === 'error')), stationError: rt?.status === 'error' || (rt?.blockers.length ?? 0) > 0, libDetail, guide });
  const onThemeKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); chooseTheme('dark'); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); chooseTheme('light'); }
  };

  return (
    <div className={`app ${explorerOpen ? '' : 'ex-collapsed'} ${view.home ? 'is-home' : ''}`} style={style} data-theme={view.theme} data-appearance={appearance} data-step={step} data-screen={screen}>
      <header className="header">
        <span className="brand" aria-label={`${PRODUCT_NAME} ${APP_VERSION}`}><span className="title">{PRODUCT_NAME}</span></span>
        <span className="subtitle">논리 시뮬레이션</span>
        <span className="grow" />
        <button className="btn-main primary" onClick={doSave} aria-label={dirty ? '저장, 저장 안 됨' : '저장'}>저장{dirty ? <span className="save-dot" aria-hidden="true" /> : null}</button>
        <button className="btn-main secondary" onClick={() => download(`${p.name.replace(/[^\w가-힣-]+/g, '_')}.ecd.json`, serializeProject(p))}>내보내기</button>
        <button className="btn-main secondary" onClick={() => setViewOpen(true)}>보기 설정</button>
        <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportFile(f); e.target.value = ''; }} />
        <button className="icon" onClick={doUndo} disabled={!tab.history.past.length || locked} title="실행 취소 (Ctrl/Cmd+Z)" aria-label="실행 취소">↶</button>
        <button className="icon" onClick={doRedo} disabled={!tab.history.future.length || locked} title="다시 실행 (Ctrl/Cmd+Shift+Z)" aria-label="다시 실행">↷</button>
      </header>
      <div className="workbar" aria-label="현재 작업">
        <button type="button" className="work-crumb" onClick={() => openExplorerTab('workspace')}>Workspace {curWs.name}</button>
        <span className="work-sep" aria-hidden="true">›</span>
        <button type="button" className="work-crumb" onClick={() => openExplorerTab('project')}>Project {p.name}</button>
        <span className="work-rev">rev {p.revision}</span>
        <span className={dirty ? 'save-chip dirty' : 'save-chip saved'}>{dirty ? '● 저장 안 됨' : '저장됨'}</span>
      </div>
      <div className="stepper" role="navigation" aria-label="단계">
        {STEPS.map((s) => { const b = stepBadge(evals[s.id], confirmed[s.id]); return (
          <button key={s.id} className={`st ${!view.home && step === s.id ? 'on' : ''}`} onClick={() => goStep(s.id)} data-stepid={s.id} aria-current={!view.home && step === s.id ? 'step' : undefined}>
            <span>{s.no} {s.label}</span><span className={`badge ${BADGE[b][0]}`}>{BADGE[b][1]}</span></button>); })}
        <div className="theme-toggle" role="radiogroup" aria-label="테마" onKeyDown={onThemeKey}>
          <button role="radio" aria-checked={appearance === 'light'} aria-label="라이트 테마" className={appearance === 'light' ? 'on' : ''} data-theme-choice="light" onClick={() => chooseTheme('light')}>라이트</button>
          <button role="radio" aria-checked={appearance === 'dark'} aria-label="다크 테마" className={appearance === 'dark' ? 'on' : ''} data-theme-choice="dark" onClick={() => chooseTheme('dark')}>다크</button>
        </div>
      </div>
      {explorer}
      {itemsOpen && <div className="itemspop" style={style}>
        <div className="row" style={{ justifyContent: 'space-between' }}><b>{cur.no} {cur.label} — 남은 항목 (실제 데이터 기준 재계산)</b><button className="small" onClick={() => setItemsOpen(false)}>닫기</button></div>
        {curEval.items.length === 0 && <div className="muted">남은 항목 없음</div>}
        {curEval.items.map((it, i) => <div key={i} className="row" style={{ minHeight: 22, fontSize: 12 }}>
          <span className={`badge ${it.level === 'missing' ? 'err' : it.level === 'human' ? 'acc' : 'warn'}`}>{LEVEL_LABEL[it.level]}</span><span style={{ flex: 1 }}>{it.text}</span>
          {(it.targetId || it.targetStep) && <button className="small" onClick={() => goItem(it)}>편집으로 이동</button>}</div>)}
        {confirmed[step] && confirmed[step] !== curEval.fingerprint && <div className="notice warn">이 단계는 이전에 확인되었지만 관련 데이터가 바뀌었습니다 — 재확인 필요</div>}
      </div>}

      {guide === 'files' && <div className="workspace ws-full"><div className="bbody sparse-page"><button type="button" onClick={() => setGuide(null)}>닫기</button><FilesSheet entries={savedList.map((e) => ({ id: e.id, name: e.name, revision: e.revision }))} onImport={() => fileRef.current?.click()} onExport={() => download(`${p.name}.json`, serializeProject(p))} onOpen={(id) => { setGuide(null); openSaved(id); }} /></div></div>}
      {guide === 'bundle' && <div className="workspace ws-full"><div className="bbody sparse-page"><button type="button" onClick={() => setGuide(null)}>닫기</button><BundleSheet wsName={curWs.name} projectCount={savedCount(reg.activeId)} assetCount={ASSET_LIBRARY.length} assumptionCount={p.assumptionsNote.length} /></div></div>}
      {guide === 'search' && <div className="workspace ws-full"><div className="bbody sparse-page"><button type="button" onClick={() => setGuide(null)}>닫기</button>
        <SearchSheet tabs={tabs.map((t) => ({ key: t.key, name: t.history.present.name, active: t.key === tab.key }))}
          tree={p.units.flatMap((u) => [{ id: u.id, label: u.name, depth: 0 }, ...u.deviceIds.map((id) => ({ id, label: devName(p, id), depth: 1 }))])}
          onTab={(key) => switchTab(key)} onPick={(id) => { setSelection([id]); setGuide(null); goStep('canvas'); }} onFold={() => setExplorerOpen(false)} onCanvas={() => { setGuide(null); goStep('canvas'); }} />
      </div></div>}

      {!guide && view.home && <div className="workspace home-main">
        <h1>어떤 장비를 설계할까요?</h1>
        <p className="muted">현재 Workspace 「{curWs.name}」에서 새로 시작하거나 저장된 설계를 이어갑니다.</p>
        <div className="home-cards">
          <section className="home-card">
            <h2>새 설계 시작</h2>
            <p>자료가 없어도 시작할 수 있습니다.<br />에셋 선택부터 단계별로 안내합니다.</p>
            <button className="btn-main primary" onClick={() => newProject('blank')}>빈 프로젝트 만들기</button>
          </section>
          <section className="home-card">
            <h2>예제로 익히기</h2>
            <p>5공정 조립 라인 · 병렬 시퀀스<br />실제 장비가 아닌 논리 실행 예제입니다.</p>
            <div className="row"><button className="btn-main primary" onClick={() => newProject('sample')}>예제 열기</button>
              <button className="btn-main secondary" onClick={() => newProject('parallel')}>병렬 예제</button></div>
          </section>
        </div>
        <h2>최근 프로젝트</h2>
        {savedList.length === 0 && <p className="muted">이 Workspace에 저장된 프로젝트가 없습니다. 예시는 저장 목록이 아닙니다.</p>}
        {savedList.slice(0, 6).map((e) => <div key={e.id} className="home-recent">
          <div><b>{e.name}</b><div className="muted">rev {e.revision} · {e.savedAt ? new Date(e.savedAt).toLocaleString() : '저장 시각 없음'}</div></div>
          <button className="btn-main secondary" onClick={showOpen}>프로젝트 관리</button>
          <button className="btn-main primary" onClick={() => openSaved(e.id)}>계속하기</button>
        </div>)}
        <p className="muted">JSON 가져오기: 원본은 덮어쓰지 않고 새 탭으로 엽니다. Workspace 묶음 파일은 미구현입니다.</p>
      </div>}

      {!guide && !view.home && step === 'library' && <div className="workspace ws-full">
        <Sub items={[['cards', '에셋 라이브러리'], ['input', '입력 후보표 (F1)'], ['aml', 'AML 입출력'], ['extract', '자료 입력']]} />
        {sub === 'input' ? <div className="bbody sparse-page"><h1 className="stage-title">입력 후보표</h1><p className="muted">후보는 확인 전에 모델에 들어가지 않습니다.</p><section className="sheet wide"><InputHubPanel p={p} locked={locked} edit={edit} /></section></div>
          : sub === 'aml' ? <div className="bbody sparse-page"><h1 className="stage-title">AML 입출력 결과</h1><AmlResultSheet onCandidates={() => setSubTab((t) => ({ ...t, library: 'input' }))} /></div>
          : sub === 'extract' ? <div className="bbody sparse-page"><h1 className="stage-title">자료 입력</h1><ExtractSheet /><Fold className="fold-panel" summary="기존 안내"><ExtractPanel /></Fold></div>
          : <LibraryWorkspace p={p} locked={locked} mode={view.visualMode} filter={view.libraryFilter} libVersion={libVersion} detail={libDetail} setDetail={setLibDetail}
            detailWidth={view.panels.library} onDetailWidth={(n) => setPanel('library', n)}
            setFilter={(f) => setView({ ...view, libraryFilter: f })} setMode={(m) => setView({ ...view, visualMode: m })}
            onAdd={onAddFromLibrary} onImportAml={onImportAml} onExportAml={() => download('ecd-library-export.aml', exportLibraryAml(), 'application/xml')} />}
      </div>}

      {!guide && !view.home && step === 'canvas' && <div className="workspace ws-canvas">
        <PanelSplit kind="canvas" value={view.panels.canvas} onChange={(n) => setPanel('canvas', n)} label="속성 패널 너비" />
        <div className="stage layout-stage">
          <div className="stage-head">
            <h1 className="stage-title">배치·연결</h1>
            <div className="tool-pills">
              <button className={mode === 'select' ? 'on' : ''} onClick={() => { setMode('select'); setConnectFrom(null); }}>선택/이동</button>
              <button className={mode === 'flow' ? 'on' : ''} onClick={() => { setMode('flow'); setConnectFrom(null); }} title="Unit → Unit 물류 흐름 연결">물류 연결</button>
              <button className={mode === 'signal' ? 'on' : ''} onClick={() => { setMode('signal'); setConnectFrom(null); openLayoutTab('diagram'); }} title="출력 포트를 입력 포트로 끌어 연결합니다. 이 모드에서는 두 번 눌러서도 됩니다. 포트는 도면 도식 탭에 있습니다">신호 연결</button>
              <div className="layerbox"><button className={layerOpen ? 'on' : ''} onClick={() => setLayerOpen(!layerOpen)}>레이어</button>
                {layerOpen && <div className="layerpop">{([['background', '배경'], ['units', 'Substation'], ['axis', '축·이송'], ['io', '포트·신호선'], ['positions', '포지션'], ['flow', '물류·자재']] as [LayerId, string][]).map(([k, l]) =>
                  <label key={k}><input type="checkbox" checked={L[k]} onChange={(e) => setView({ ...view, layers: { ...L, [k]: e.target.checked } })} /> {l}</label>)}
                  <div className="muted">숨김은 삭제가 아니고 실행에서도 빼지 않습니다.</div></div>}</div>
              <span className="zoom-pill"><button type="button" aria-label="축소" onClick={() => setView({ ...view, zoom: Math.max(0.5, +(view.zoom - 0.1).toFixed(2)) })}>−</button><span>{Math.round(view.zoom * 100)}%</span><button type="button" aria-label="확대" onClick={() => setView({ ...view, zoom: Math.min(2, +(view.zoom + 0.1).toFixed(2)) })}>+</button></span>
            </div>
          </div>
          <p className="palette-hint">팔레트: 빈 유닛 / 푸셔 / 실린더 / 센서 / 유닛 템플릿. 카드를 끌어 다른 Substation에 놓으면 소속이 바뀝니다.</p>
          <Fold className="palette-fold" summary={<><span className="fold-closed">팔레트 펼치기 ({ASSET_LIBRARY.length}종 + 빈 유닛)</span><span className="fold-open">팔레트 ({ASSET_LIBRARY.length}종 + 빈 유닛)</span></>}>
            <div className="palette">
              <div className="pi" draggable onDragStart={(e) => e.dataTransfer.setData('application/x-ecd-asset', 'unit')}><PaletteIcon kind="unit" />빈 유닛</div>
              {ASSET_LIBRARY.map((a) => <div key={a.kind} className="pi" draggable onDragStart={(e) => e.dataTransfer.setData('application/x-ecd-asset', a.kind)} title={`${a.id}@${a.version}`}><PaletteIcon kind={a.kind} />{a.name}</div>)}
            </div>
          </Fold>
          <div className="layout-tabs">
            <Tabs label="배치·연결" idBase="layout" value={view.layoutTab} onChange={openLayoutTab} tabs={[
              { id: 'board', label: '카드 보드', panel: <>
                <LayoutBoard project={p} selection={selection} mode={mode} locked={locked}
                  onSelect={(ids) => setSelection(ids)} onDropAsset={onDropAsset} onUnitConnectClick={onUnitConnectClick}
                  onSignalHint={() => say('신호 연결은 도면 도식 탭의 포트에서 합니다')} onReparent={requestReparent}
                  connectNote={connectNote} />
                <p className="path-note">{flowSummary(p)}<br />카드는 실제 Substation·Device입니다. 좌표·포트·신호선은 도면 도식 탭에서 움직입니다. 정밀 물리 검증은 아닙니다.</p>
              </> },
              { id: 'diagram', label: '도면 도식', panel: <>
                <div className="diagram-tools">
                  <p className="diagram-hint">신호: 출력● 포트를 입력○ 포트로 끌어 연결 · 장치 이동은 몸체를 끌기</p>
                  {visualToggle}
                  <button onClick={() => edit(C.alignNodes(p, selection, 'left'), '왼쪽 정렬')} disabled={selection.length < 2 || locked}>좌 정렬</button>
                  <button onClick={() => edit(C.alignNodes(p, selection, 'top'), '위 정렬')} disabled={selection.length < 2 || locked}>상 정렬</button>
                  <button type="button" onClick={fitSelectedUnit} disabled={!(selection.length === 1 && p.units.some((u) => u.id === selection[0]))}>크기 맞춤</button>
                  <button className="danger" onClick={() => selectedId && requestDelete(selectedId)} disabled={!selectedId || locked}>삭제</button>
                </div>
                <div className="diagram-canvas">{canvasEl}</div>
              </> },
            ]} />
          </div>
        </div>
        <div className="right prop-col">
          <div className="prop-body">{(() => {
          const d = p.devices.find((x) => x.id === selection[0]);
          const host = d ? p.units.find((u) => u.id === d.unitId) : p.units.find((u) => u.id === selection[0]);
          const def = d ? findAsset(d.kind) : undefined;
          const missingComplete = d ? p.actions.some((a) => a.deviceId === d.id && !a.completeSignalId) : false;
          return <div className="prop-sheet">
            <h2>{d ? `${d.name} · ${def?.name ?? d.kind}` : host ? `${host.code} ${host.name}` : '선택 없음'}</h2>
            <p className="muted">{host ? `Station / ${host.code} ${host.name.replace(new RegExp(`^${host.code}\\s*`), '')}` : '왼쪽 또는 카드에서 고르세요.'}{d ? <><br />Device · {d.definitionRef.assetId}@{d.definitionRef.version}</> : null}</p>
            <p>속성 / 신호 / Action</p>
            {d && host && <p>소속 Substation<br />{host.name}</p>}
            {d && def && def.properties.slice(0, 3).map((pd) => {
              const qv = d.properties[pd.key];
              if (!qv) return null;
              return <p key={pd.key}>{pd.label}<br />{qv.value ?? '미정'} {qv.unit}{qv.assumption ? ' · 가정값' : ''}</p>;
            })}
            {!d && host && <button type="button" className="btn-main secondary" onClick={fitSelectedUnit}>크기 맞춤</button>}
            <button type="button" className="btn-main primary" disabled={!d} onClick={() => { if (!d) return; setSelection([d.id]); setRightTab('actions'); goStep('attributes'); }}>Action 편집</button>
            {missingComplete && <p className="warn-note">완료 신호 미정 · 실행 차단<br />필수 값은 임의로 채우지 않습니다.</p>}
            <button type="button" className="btn-main secondary" disabled={!selectedId || locked} onClick={() => selectedId && requestDelete(selectedId)}>삭제 영향 확인</button>
            <Fold className="prop-more" summary="속성 자세히">{inspectorEl}</Fold>
          </div>;
        })()}</div></div>
      </div>}

      {!guide && !view.home && step === 'attributes' && <div className="workspace ws-full ws-noTabs">
        <div className="bbody sparse-page">
          <h1 className="stage-title">{rightTab === 'signals' || rightTab === 'positions' ? '신호와 포지션' : rightTab === 'actions' || rightTab === 'check' ? 'Action 정의' : '장치 속성'}</h1>
          <p className="muted">기본 화면은 성긴 폼입니다. 신호·Action·정의 체크의 나머지 입력은 아래 접는 칸에 있습니다.</p>
          {(() => {
            const d = p.devices.find((x) => x.id === selectedId) ?? p.devices[0];
            const host = d ? p.units.find((u) => u.id === d.unitId) : undefined;
            const def = d ? findAsset(d.kind) : undefined;
            if (!d || !def) return <div className="sheet">선택된 Device가 없습니다. 왼쪽 트리에서 고르세요.</div>;
            const fields = def.properties.slice(0, 4);
            const sigs = p.signals.filter((s) => s.deviceId === d.id);
            const poss = p.positions.filter((x) => x.deviceId === d.id);
            const acts = p.actions.filter((a) => a.deviceId === d.id);
            const act = acts[0];
            if (rightTab === 'signals' || rightTab === 'positions') return <div className="sparse-split">
              <section className="sheet">
                <h2>개념 신호 역할</h2>
                <table className="grid plain"><thead><tr><th>이름</th><th>방향</th><th>역할</th></tr></thead>
                  <tbody>{sigs.map((s) => <tr key={s.id}><td>{s.name}</td><td>{s.direction === 'in' ? '입력' : '출력'}</td><td>{signalRole(s.role)}</td></tr>)}
                    {sigs.length === 0 && <tr><td colSpan={3}>신호 없음</td></tr>}</tbody></table>
                <p className="field-ro">{sigs.find((s) => s.address)?.address ?? '미정 · 실제 장비 주소 아님'}</p>
                <button type="button" onClick={() => setRightTab('actions')}>Action으로 복귀</button>
              </section>
              <aside className="sheet">
                <h2>포지션 정의</h2>
                {poss.map((x) => <label key={x.id}>{x.name}<span className="field-ro">{x.value.value ?? '미정'} {x.value.unit}{x.value.assumption ? ' · 가정' : ''}</span></label>)}
                {poss.length === 0 && <p className="muted">포지션 없음</p>}
                <p className="warn-note">단위·방향·신호 참조는 보존합니다. 실주소와 실측 역매핑은 하지 않습니다.</p>
              </aside>
            </div>;
            if (rightTab === 'actions' || rightTab === 'check') return <div className="sparse-split">
              <section className="sheet">
                <h2>{act ? `${host?.code ?? ''} ${act.name}`.trim() : `${d.name} · Action 없음`}</h2>
                {act ? <div className="form-grid">
                  <label>동작 시간<QtyInput q={act.duration} disabled={locked} onCommit={(v, as) => edit(C.setQuantity(p, { kind: 'action', id: act.id, field: 'duration' }, v, as), '동작 시간')} /></label>
                  <label>타임아웃<QtyInput q={act.timeout} disabled={locked} onCommit={(v, as) => edit(C.setQuantity(p, { kind: 'action', id: act.id, field: 'timeout' }, v, as), '타임아웃')} /></label>
                  <label>명령 신호<span className="field-ro">{signalCaption(p, act.commandSignalId)}</span></label>
                  <label>완료 신호<span className="field-ro">{signalCaption(p, act.completeSignalId)}</span></label>
                </div> : <p>이 Device에 Action이 없습니다. 아래 접는 칸에서 추가합니다.</p>}
                <div className="tool-pills">
                  <button type="button" className="on" disabled={!act || locked} onClick={() => act && edit(C.addStep(p, act.id), '단계 추가')}>시퀀스 끝에 추가</button>
                  <button type="button" onClick={() => setRightTab('props')}>속성으로</button>
                </div>
              </section>
              <aside className="sheet">
                <h2>정의 체크와 사람 확인</h2>
                <ul className="check-list">
                  <li>완료 신호 · {act?.completeSignalId ? '지정됨' : '미정'}</li>
                  <li>동작 시간 · {act?.duration.value ?? '미정'}{act?.duration.assumption ? ' · 가정' : ''}</li>
                  <li>타임아웃 · {act?.timeout.value ?? '미정'}{act?.timeout.assumption ? ' · 가정' : ''}</li>
                  <li>실제 주소 · {sigs.some((s) => s.address) ? '있음' : '미정'}</li>
                </ul>
                <p className="warn-note">Interlock 후보는 사람이 확인합니다. 자동 안전 승인은 없습니다.</p>
                <button type="button" onClick={() => goStep('sequence', 'sequence')}>시퀀스 보기</button>
              </aside>
            </div>;
            return <div className="sparse-split">
              <section className="sheet">
                <h2>{d.name} · 속성 편집</h2>
                <div className="form-grid">
                  <label>이름<TextInput value={d.name} disabled={locked} onCommit={(v) => edit(C.renameObject(p, d.id, v), 'Device 이름')} /></label>
                  <label>소속 Substation
                    <select disabled={locked} value={d.unitId} onChange={(e) => requestReparent(d.id, e.target.value)}>{p.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                  </label>
                  {fields.map((pd) => {
                    const qv = d.properties[pd.key];
                    if (!qv) return null;
                    return <label key={pd.key}>{pd.label}{qv.assumption ? ' · 가정값' : ''}
                      <QtyInput q={qv} disabled={locked} onCommit={(v, as) => edit(C.setDeviceProperty(p, d.id, pd.key, v, as), `${pd.label} 변경`)} />
                    </label>;
                  })}
                  <label>정의 버전<span className="field-ro">{d.definitionRef.assetId}@{d.definitionRef.version}</span></label>
                </div>
                <div className="tool-pills">
                  <button type="button" className="on" onClick={() => setRightTab('actions')}>Action 편집</button>
                  <button type="button" onClick={() => setRightTab('signals')}>신호·포지션</button>
                  <button type="button" className="danger" disabled={locked} onClick={() => requestDelete(d.id)}>삭제 영향 확인</button>
                </div>
              </section>
              <aside className="sheet">
                <h2>선택과 제공 능력</h2>
                <p>{host ? `${host.code} ${host.name}` : '소속 없음'} / {d.name}</p>
                <p className="muted">제공 Action</p>
                <ul className="check-list">{p.actions.filter((a) => a.deviceId === d.id).slice(0, 4).map((a) => <li key={a.id}>{a.name}</li>)}</ul>
                <button type="button" onClick={() => setRightTab('check')}>정의 체크</button>
                <p className="muted">능력 표 전체는 아래 접는 칸에 있습니다.</p>
              </aside>
            </div>;
          })()}
          <Fold className="fold-panel" summary="신호, 포지션, Action, 정의 체크 자세히">
            <div className="fold-body">{inspectorEl}</div>
          </Fold>
        </div>
      </div>}

      {!guide && !view.home && step === 'sequence' && <div className="workspace ws-full">
        <h1 className="stage-title">{sub === 'material' ? '자재와 흐름' : sub === 'subseq' ? 'Substation 시퀀스' : sub === 'sfc' ? 'SFC 미리보기' : sub === 'extend' ? '누락 편집 확장' : 'Station 시퀀스'}</h1>
        <Sub items={[['sequence', 'Station 시퀀스 Draft (F5)'], ['subseq', `Substation 시퀀스 (${(p.substationSequences ?? []).length})`], ['material', '자재·Flow (F4)'], ['sfc', 'SFC 미리보기'], ['extend', '누락 편집 확장']]} />
        <div className="bbody sparse-page">
          {sub === 'sequence' && <section className="sheet wide">
            <div className="tool-pills">
              <button type="button" className="on" onClick={() => { const a = p.actions[0]; if (a) edit(C.addStep(p, a.id), '단계 추가'); }}>Action 추가</button>
              <button type="button" onClick={() => setSubTab((t) => ({ ...t, sequence: 'sfc' }))}>SFC 미리보기</button>
              <button type="button" onClick={() => setSubTab((t) => ({ ...t, sequence: 'subseq' }))}>Substation 시퀀스</button>
            </div>
            <h2>Station 시퀀스 Draft</h2>
            <table className="grid plain">
              <thead><tr><th>단계 / 대상</th><th>Action / 완료</th><th>시간 / 타임아웃</th><th>편집</th></tr></thead>
              <tbody>{p.sequence.steps.map((s, i) => {
                const a = p.actions.find((x) => x.id === s.actionId);
                return <tr key={s.id}><td>{String(i + 1).padStart(2, '0')} · {a ? devName(p, a.deviceId) : s.name}</td><td>{a?.name ?? '없음'} / {a?.completeSignalId ? sigName(p, a.completeSignalId) : '미정'}</td><td>{a ? `${a.duration.value ?? '미정'}s / ${a.timeout.value ?? '미정'}s${a.duration.assumption ? ' · 가정' : ''}` : '없음'}</td><td>
                  <button type="button" className="small" disabled={locked || i === 0} onClick={() => edit(C.moveStep(p, i, i - 1), '단계 위로')}>위로</button>
                  <button type="button" className="small" disabled={locked || i === p.sequence.steps.length - 1} onClick={() => edit(C.moveStep(p, i, i + 1), '단계 아래로')}>아래로</button>
                  <button type="button" className="small danger" disabled={locked} onClick={() => edit(C.removeStep(p, s.id), '단계 삭제')}>삭제</button>
                </td></tr>;
              })}
              {p.sequence.steps.length === 0 && <tr><td colSpan={4}>단계가 없습니다. Action 추가로 현재 장치의 첫 Action을 넣습니다.</td></tr>}</tbody>
            </table>
            <p className="warn-note">한 시퀀스 안의 분기, 병렬, 루프는 미구현입니다.</p>
            <Fold className="fold-panel" summary="단계 편집, 구조화 문장, 순서 변경">
              <SequencePanel p={p} rt={rt} locked={locked} edit={edit} onSelect={(id) => { setSelection([id]); setRightTab('actions'); goStep('attributes'); }} />
            </Fold>
          </section>}
          {sub === 'material' && <div className="sparse-split">
            <section className="sheet">
              <h2>{p.materials[0] ? `${p.materials[0].name} · 정의와 초기 조건` : '자재 없음'}</h2>
              {p.materials[0] ? <div className="form-grid">
                <label>이름<TextInput value={p.materials[0].name} disabled={locked} onCommit={(v) => edit(C.renameObject(p, p.materials[0].id, v), '자재 이름')} /></label>
                <label>투입 간격<QtyInput q={p.materials[0].feedInterval} disabled={locked} onCommit={(v, as) => edit(C.setQuantity(p, { kind: 'material', id: p.materials[0].id, field: 'feedInterval' }, v, as), '투입 간격')} /></label>
                <label>초기 위치<span className="field-ro">{p.materials[0].initialLocation ? unitName(p, p.materials[0].initialLocation) : '미정'}</span></label>
                <label>초기 상태<span className="field-ro">{p.materials[0].initialState ?? '미정'}</span></label>
                <label>크기<span className="field-ro">{materialSize(p)}</span></label>
                <label>무게<span className="field-ro">{p.materials[0].weight.value ?? '미정'} {p.materials[0].weight.unit}{p.materials[0].weight.assumption ? ' · 가정' : ''}</span></label>
                <label>Unit 경로<span className="field-ro">{routeText(p)}</span></label>
              </div> : <button type="button" disabled={locked} onClick={() => edit(C.addMaterial(p), '자재 추가')}>자재 추가</button>}
              <button type="button" className="btn-main primary" onClick={() => setSubTab((t) => ({ ...t, sequence: 'sequence' }))}>Station 시퀀스 작성</button>
            </section>
            <aside className="sheet">
              <h2>상태 전이</h2>
              <table className="grid plain"><thead><tr><th>상태</th><th>완료 Action</th></tr></thead>
                <tbody>{p.actions.filter((a) => a.effect.setState || a.effect.moveTo).slice(0, 6).map((a) => <tr key={a.id}><td>{a.effect.setState ?? (a.effect.moveTo === 'EXIT' ? '배출' : a.effect.moveTo ? unitName(p, a.effect.moveTo) : a.name)}</td><td>{a.name}</td></tr>)}
                  {p.actions.every((a) => !a.effect.setState && !a.effect.moveTo) && <tr><td colSpan={2}>자재 변화가 있는 Action이 없습니다.</td></tr>}</tbody></table>
              <p className="warn-note">실행은 자재 하나만 지원합니다. 여러 자재와 캐리어는 미구현입니다.</p>
            </aside>
            <Fold className="fold-panel" summary="자재 값과 경로 편집"><MaterialPanel p={p} locked={locked} edit={edit} /></Fold>
          </div>}
          {sub === 'subseq' && <section className="sheet wide">
            <h2>Substation 시퀀스</h2>
            <SubSequencePanel p={p} unitId={subUnitId} setUnitId={(id) => setSubUnitPref(id)} locked={locked} edit={edit} gs={gs} />
          </section>}
          {sub === 'sfc' && <section className="sheet wide"><h2>SFC 미리보기</h2><p className="muted">읽기 전용 순차 표시입니다. 분기와 루프는 그리지 않습니다.</p><SfcPanel p={p} rt={rt} /></section>}
          {sub === 'extend' && <><ExtendSheet /><Fold className="fold-panel" summary="미구현 안내"><ExtendPanel /></Fold></>}
        </div>
      </div>}

      {!guide && !view.home && step === 'check' && <div className="workspace ws-full">
        <h1 className="stage-title">{sub === 'diag' ? '진단과 저장' : sub === 'export' ? 'Export 미리보기' : sub === 'lab' ? 'Evolution Lab' : 'Gap 점검'}</h1>
        <Sub items={[['gap', `Gap (F6) ${tab.gaps.length}`], ['diag', '진단·저장·AML'], ['export', 'Export 미리보기 (F8)'], ['lab', 'Evolution Lab (F7)']]} />
        <div className="bbody sparse-page">
          {sub === 'gap' && <section className="sheet wide">
            <div className="tool-pills">
              <button type="button" className={gapFilter === 'all' ? 'on' : ''} onClick={() => { setGapFilter('all'); reanalyze(); }}>재분석</button>
              <button type="button" className={gapFilter === 'shortfall' ? 'on' : ''} onClick={() => setGapFilter('shortfall')}>차단 항목만</button>
              <button type="button" className={gapFilter === 'human' ? 'on' : ''} onClick={() => setGapFilter('human')}>사람 확인 필요</button>
              <button type="button" className={gapFilter === 'hidden' ? 'on' : ''} onClick={() => setGapFilter('hidden')}>숨긴 항목</button>
            </div>
            <h2>Gap 목록 · 기준 모델 rev {tab.analyzedRevision ?? p.revision}</h2>
            <table className="grid plain">
              <thead><tr><th>종류와 판정</th><th>근거</th><th>관련 대상</th><th>다음 행동</th></tr></thead>
              <tbody>{tab.gaps.filter((g) => gapVisible(g, gapFilter, p.gapReview[g.id]?.status === 'hidden')).slice(0, 12).map((g) => <tr key={g.id}><td>{g.title}</td><td>{g.evidence}</td><td>{g.objectIds.slice(0, 2).join(' / ') || '-'}</td><td><button type="button" className="small" onClick={() => goGap(g)}>수정 이동</button></td></tr>)}
                {tab.gaps.filter((g) => gapVisible(g, gapFilter, p.gapReview[g.id]?.status === 'hidden')).length === 0 && <tr><td colSpan={4}>이 보기에 해당하는 항목이 없습니다.</td></tr>}</tbody>
            </table>
            <p className="warn-note">간섭 후보는 정밀 물리·안전 검증 결과가 아닙니다. 근거가 부족하면 문제 없음 대신 비교 불가로 둡니다.</p>
            <Fold className="fold-panel" summary="숨김, 사람 확인, 근거 자세히">
              <GapPanel p={p} gaps={tab.gaps} analyzedRevision={tab.analyzedRevision} onReanalyze={reanalyze} onGo={goGap} onReview={reviewGap} />
            </Fold>
          </section>}
          {sub === 'diag' && <><DiagSheet p={p} storageReason={storage.kv ? null : storage.reason ?? '저장소 없음'} quarantineList={qlist} onDownload={(name, text) => download(name, text, 'application/octet-stream')} onAml={() => goStep('library', 'aml')} /><Fold className="fold-panel" summary="진단 자세히"><DiagPanel p={p} storageReason={storage.kv ? null : storage.reason ?? '저장소 없음'} quarantineList={qlist} onDownload={download} /></Fold></>}
          {sub === 'export' && <><ExportSheet p={p} /><Fold className="fold-panel" summary="행 단위 미리보기"><ExportPanel p={p} /></Fold></>}
          {sub === 'lab' && <><LabSheet revision={p.revision} /><Fold className="fold-panel" summary="미구현 안내"><LabPanel /></Fold></>}
        </div>
      </div>}

      {!guide && !view.home && step === 'run' && <div className="workspace ws-run">
        <h1 className="stage-title run-title">{screen === 'S62' ? '실행 차단과 수정' : runMode === 'group' ? 'Substation 그룹 실행' : 'Station 논리 실행'}</h1>
        <div className="toolbar tool-pills">
          <div className="seg" role="tablist" aria-label="실행 대상">
            <button role="tab" aria-selected={runMode === 'station'} className={runMode === 'station' ? 'on' : ''} onClick={() => setRunMode('station')}>Station 시퀀스</button>
            <button role="tab" aria-selected={runMode === 'group'} className={runMode === 'group' ? 'on' : ''} onClick={() => setRunMode('group')}>Substation 그룹</button></div>
          <div className="sep" />
          {runMode === 'station' ? runControls : groupControls}<div className="sep" />{visualToggle}<div className="sep" /><button onClick={doSave}>저장</button>
          <span className="badge">{dirty ? '저장 안 됨' : '저장됨'}</span>
          {runMode === 'station' ? <><span className="badge">{rt?.status === 'completed' ? '시뮬 완료' : `시뮬 ${rt?.status ?? 'idle'}`}</span>
            <span className="badge">실행 전 검사 {evals.check.items.some((i) => i.level === 'missing') ? '미통과' : '통과'}</span></> : <span className="badge">그룹 {gs?.status ?? 'idle'}</span>}</div>
        <div className="center sparse-page">
        {screen === 'S62' && <BlockerSheet p={p} title={runMode === 'group' ? '그룹 실행 차단' : 'Station 실행 차단'} timeLabel={fmtTime(runMode === 'group' ? (gs?.timeMs ?? 0) : (rt?.timeMs ?? 0))} blockers={runMode === 'group' ? (gs?.blockers ?? []) : (rt?.blockers ?? [])} onGuide={goBlocker} onRecheck={() => { if (runMode === 'group') gReset(); else doReset(); }} />}
          <section className="sheet">
            <h2>{runMode === 'group' ? '그룹 실행 상태' : 'Station 실행 상태'}</h2>
            <div className="form-grid">
              <label>실행 상태<span className="field-ro">{runMode === 'group' ? (gs?.status ?? 'idle') : (rt?.status ?? 'idle')}{locked ? ' · 편집 잠금' : ''}</span></label>
              <label>가상 시간<span className="field-ro">{fmtTime(runMode === 'group' ? (gs?.timeMs ?? 0) : (rt?.timeMs ?? 0))}</span></label>
            </div>
            {runMode === 'station' && <table className="grid plain"><thead><tr><th>단계</th><th>상태</th><th>자재</th></tr></thead>
              <tbody>{(rt?.steps ?? p.sequence.steps.map((s) => ({ stepId: s.id, status: 'pending' }))).map((row) => {
                const step = p.sequence.steps.find((s) => s.id === row.stepId);
                return <tr key={row.stepId}><td>{step?.name ?? row.stepId}</td><td>{row.status}</td><td>{rt?.material ? unitName(p, rt.material.location) : '대기'}</td></tr>;
              })}</tbody></table>}
            <p className="muted">이 값은 이번 실행의 가상 시각과 단계 상태입니다. 예시 시각을 고정해 두지 않습니다. 논리 실행이며 안전 판정이 아닙니다.</p>
          </section>
        <Fold className="fold-panel" summary="실행 도면, 로그, 차단 이동">
          <div className="diagram-canvas">{runCanvasEl}</div>
          {runMode === 'station' ? <RuntimePanel p={p} rt={rt} locked={locked} edit={edit} /> : <GroupRunPanel p={p} gs={gs} unitId={subUnitId} onGoBlocker={goBlocker} />}
        </Fold>
        </div>
        <div className="right run-side">
          <PanelSplit kind="run" value={view.panels.run} onChange={(n) => setPanel('run', n)} label="실행 패널 너비" />
          <div className="run-side-body">
            <aside className="sheet">
              <h2>실행 로그</h2>
              <ul className="log-list">{(rt?.log ?? []).length === 0 && <li>로그 없음. 실행을 누르면 이 세션의 기록이 쌓입니다.</li>}
                {(rt?.log ?? []).slice(-8).map((l, i) => <li key={i}>{fmtTime(l.t)} {l.code}</li>)}</ul>
              <button type="button" className="btn-main primary" onClick={doSave}>{dirty ? '저장' : '저장됨'}</button>
            </aside>
          </div>
        </div>
      </div>}

      <div className="statusbar">
        <b>논리 시뮬레이션 · 실제 장비 제어/안전 검증 아님</b>
        <span>rev {p.revision}</span><span>Undo {tab.history.past.length}</span>
        <span>실행 {rt?.status ?? 'idle'} · 그룹 {gs?.status ?? 'idle'}</span>
        {locked && <span>실행 중 편집 잠금</span>}
        <span className="grow" />
        {!view.home && <>
          <button className="small" onClick={() => setItemsOpen(!itemsOpen)}>남은 항목 {curEval.items.length}</button>
          <button className="btn-main secondary" disabled={cur.no === 1} onClick={() => goStep(STEPS[cur.no - 2].id)}>이전</button>
          <button className="btn-main primary" disabled={cur.no === 6} onClick={goNext}>다음 단계</button>
        </>}
        {view.home && <>
          <button className="btn-main secondary" onClick={() => fileRef.current?.click()}>JSON 가져오기</button>
          <button className="btn-main primary" onClick={() => setView((v) => ({ ...v, home: false }))}>시작하기</button>
        </>}
        <span className="muted">형식 {FILE_FORMAT_VERSION} · 규칙 {RUNTIME_RULES_VERSION} / {GROUP_RULES_VERSION}</span>
      </div>

      {toast && <div className={`toast ${toast.err ? 'err' : ''}`} style={style}>{toast.msg}</div>}
      {viewOpen && <StaticModalFrame title="보기 설정" style={style} onCancel={() => setViewOpen(false)}>
        <p className="muted">보기만 바꿉니다. 모델, rev, 실행, 선택, 입력은 그대로입니다. 보관된 이전 팔레트는 고를 수 없습니다.</p>
        <div className="row" style={{ gap: 8 }}>{visualToggle}</div>
        <p className="muted">화면 {screen} · 단계 {cur.no} {cur.label} · 확대 {Math.round(view.zoom * 100)}%</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn-main secondary" onClick={() => setViewOpen(false)}>닫기</button></div>
      </StaticModalFrame>}
      {nameDlg && <NameDialog key={nameDlg.title} {...nameDlg} onCancel={() => setNameDlg(null)} />}
      {modal && <StaticModalFrame key={modal.title} title={modal.title} style={style} onCancel={() => setModal(null)}>
        {modal.body}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>{modal.actions.map((a) => <button key={a.label} autoFocus={a.focus} className={a.primary ? 'primary' : a.danger ? 'danger' : ''} onClick={() => { setModal(null); a.run(); }}>{a.label}</button>)}</div>
      </StaticModalFrame>}
    </div>
  );
}
