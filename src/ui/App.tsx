import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ASSET_LIBRARY, exportLibraryAml, findAsset, LOADED_LIBRARIES, registerImported } from '../assets/library';
import { resolveGenerated } from '../assets/visuals';
import * as C from '../model/commands';
import { captureCopy, COPY_NEED_NODE, PASTE_EMPTY, PASTE_LOCKED, pasteClipboard, splitPasteNote, type Clipboard } from '../model/copyPaste';
import { emptyProject } from '../model/factory';
import { analyzeGaps, reconcileGapReview, type Gap } from '../model/gaps';
import { analyzeRunGaps } from '../model/runGaps';
import { applyEdit, initHistory, redo, undo, type History } from '../model/history';
import { buildFlowSampleProject, buildParallelSampleProject, buildSampleProject } from '../model/sample';
import type { AssetDefinition, AssetKind, Project } from '../model/types';
import { APP_VERSION, feedCountOf, FILE_FORMAT_VERSION, PRODUCT_NAME, RUNTIME_RULES_VERSION } from '../model/types';
import { advance, createRuntime, pause, pauseSubstation, reset, resume, resumeSubstation, runToEnd, start, type Runtime } from '../runtime/engine';
import { activeDeviceIds as sceneActiveIds, faultDeviceIds, interlockFaultDeviceIds } from '../scene/describe';
import { equipmentMotionDefault, prefersReducedMotion, presentScene } from '../scene/motion';
import { DURATION_EDIT_LABEL, TIMEOUT_EDIT_LABEL, revertDurationEdits, type DurationSnap } from '../scene/revertDurations';
import { parseProjectFile, serializeProject } from '../storage/fileFormat';
import { DRAFT_DELAY_MS, discardDraft, draftOffersRecovery, formatClock, loadDraft, readDraftList, saveDraft, sweepDrafts, workTimesLabel, type DraftMeta } from '../storage/drafts';
import { detectStorage, loadProject, quarantine, readIndex, readQuarantine, type KV, type QuarantineEntry } from '../storage/localStore';
import { Canvas, type Mode } from './Canvas';
import { CommandPaletteDialog, ShortcutSheet } from './CommandPalette';
import { commandById, commandForEvent, shortcutText, usesMacShortcut, type CommandActions, type CommandState } from './commandModel';
import { ContextMenu } from './ContextMenu';
import { buildContextMenu, hitFromSelection, isTextField, pasteBlockReason, planContext, type ContextRequest, type ContextSurface, type MenuAction, type MenuKind } from './contextMenuModel';
import { selectAll, SELECT_HINT } from './selectAll';
import { flowSummary, LayoutBoard } from './LayoutBoard';
import { Inspector, InterlockPanel, type ConfirmDelete } from './Inspector';
import { LibraryWorkspace } from './Library';
import { focusJump, jumpCaption, jumpTarget, runGapJump } from './itemJump';
import { ConditionMark } from './conditionMark';
import { StatusMark } from './StatusMark';
import { deviceDisplayStatus, gapJudgementMark, ITEM_LEVEL_STATUS, statusCssVars, WIZARD_BADGE_STATUS } from './status';
import { BADGE_MARK, BADGE_WORD, evaluateSteps, stepBadge, STEPS, type StepId, type StepItem } from './wizard';
import { connectStartLabel, devName, runStatusBar, runStatusLabel, unitName } from './labels';
import { QtyInput, TextInput } from './widgets';
import { DiagPanel, ExportPanel, ExtendPanel, ExtractPanel, fmtTime, GapPanel, InputHubPanel, LabPanel, MaterialPanel, RunGapSection, SequencePanel, SfcPanel } from './Panels';
import { PaletteIcon } from './Symbols';
import { SubSequencePanel } from './SubstationPanels';
import type { BlockerGuide } from './blockerTarget';
import { checkRunReadiness, type Diagnostic } from '../model/validate';
import { conditionsFormula, runBlockFormula } from '../model/conditionFormula';
import type { ConditionFinding } from '../model/conditionCheck';
import { appearanceOf, loadView, paletteTheme, saveView, THEMES, type ExplorerTab, type LayerId, type LayoutTab, type PanelKey, type RunDetailsTab, type UserView } from './viewSettings';
import { screenOf } from './screens';
import { AmlResultSheet, BlockerSheet, BundleSheet, DiagSheet, ExportSheet, ExtendSheet, ExtractSheet, FilesSheet, gapVisible, LabSheet, materialSize, routeText, SearchSheet, signalCaption, signalRole } from './SparseScreens';
import * as W from '../storage/workspaces';
import { collapseAllIds, ProjectTree } from './ProjectTree';
import { dialogOpen, NameDialog, ProjectList, type ProjectListRow, StaticModalFrame, WorkspaceManager } from './WorkspacePanels';
import { TourBubble } from './TourBubble';
import { isTourSample, TOUR_AGAIN, TOUR_BUTTON, TOUR_STEPS } from './tour';
import { BrandMark } from './BrandMark';
import { FlowEditor } from './FlowEditor';
import { Fold } from './Fold';
import { PanelSplit } from './PanelSplit';
import { RunConditions } from './RunConditions';
import { RunDetails } from './RunDetails';
import { RunStepsPanel, RunSummaryStrip } from './RunInfoPanel';
import { EmptyState, LoadingPlaceholder } from './EmptyState';
import { Problem } from './Problem';
import { EMPTY, LARGE_IMPORT_BYTES, LOADING_FILE, RUN_LOCK, draftProblem, importRejectProblem, refusal, runErrorProblem, saveProblem, type ProblemCopy } from './problemCopy';
import { Scene3D } from './Scene3D';
import { Tabs } from './Tabs';
import { HelpPanel } from './HelpPanel';
import { helpTopic, resolveHelpId } from './helpCopy';
import { TermHintsProvider, Terms } from './Term';

interface Tab {
  key: string; history: History; savedRevision: number | null; savedAt: string | null; runtime: Runtime | null; runRecord: Runtime | null; gaps: Gap[]; analyzedRevision: number | null;
  /** Revision at open. A never-saved project is drafted only after the model moves past this. */
  baselineRevision: number;
  draftAt: string | null;
  /** Revision last written by this session. Null until a draft write succeeds. */
  draftedRevision: number | null;
  /** Revision last attempted. Stops a failed write from retrying until the next edit. */
  draftTriedRevision: number | null;
  draftError: boolean;
  /** True only after this session's timer wrote a draft. Opening an existing draft does not set it. */
  sessionDraft: boolean;
}

/** Keep a finished run for Gap after a later model edit. Reset clears it. A new finish replaces it. */
function keepRun(t: Tab, runtime: Runtime): Tab {
  const ended = runtime.state.status === 'completed' || runtime.state.status === 'error';
  return ended ? { ...t, runtime, runRecord: runtime } : { ...t, runtime };
}
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
function makeTab(p: Project, saved: { rev: number; at: string } | null = null, draft: { at: string; revision: number } | null = null): Tab {
  const gaps = analyzeGaps(p);
  const review = reconcileGapReview(p.gapReview ?? {}, gaps, p.revision, new Set(gaps.filter((g) => g.safety).map((g) => g.id)));
  const proj = { ...p, gapReview: review };
  return {
    key: `tab-${++tabSeq}`, history: initHistory(proj), savedRevision: saved?.rev ?? null, savedAt: saved?.at ?? null, runtime: null, runRecord: null, gaps, analyzedRevision: p.revision,
    baselineRevision: saved?.rev ?? p.revision, draftAt: draft?.at ?? null, draftedRevision: draft?.revision ?? null, draftTriedRevision: draft?.revision ?? null, draftError: false, sessionDraft: false,
  };
}
const runBusy = (t: Tab) => t.runtime?.state.status === 'running' || t.runtime?.state.status === 'paused';
/** A draft is due when the open model is ahead of the saved copy, or ahead of the revision this tab was created at. */
const draftDue = (t: Tab) => (t.savedRevision !== null ? t.history.present.revision > t.savedRevision : t.history.present.revision > t.baselineRevision);
function bootDrafts(kv: KV | null): { drafts: DraftMeta[]; quarantine: QuarantineEntry[] } {
  if (!kv) return { drafts: [], quarantine: [] };
  const swept = sweepDrafts(kv);
  let list = readQuarantine(kv);
  for (const entry of swept.quarantine) {
    if (list.some((q) => q.label === entry.label && q.raw === entry.raw)) continue;
    list = quarantine(kv, entry, list);
  }
  return { drafts: readDraftList(kv), quarantine: list };
}
const noDraft = { draftAt: null, draftedRevision: null, draftTriedRevision: null, draftError: false, sessionDraft: false };

/** Header undo / redo. A 24px stroke sits inside the 44px button; currentColor follows the button. */
function HistoryIcon({ dir }: { dir: 'undo' | 'redo' }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M8 4.5 3.5 9.5 8 14.5M4 9.5h10a5.5 5.5 0 1 1 0 11H9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        transform={dir === 'redo' ? 'translate(24 0) scale(-1 1)' : undefined}
      />
    </svg>
  );
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
  const [draftBoot] = useState(() => bootDrafts(kv));
  const [qlist, setQlist] = useState<QuarantineEntry[]>(() => draftBoot.quarantine);
  const [drafts, setDrafts] = useState<DraftMeta[]>(() => draftBoot.drafts);
  const [toast, setToast] = useState<{ msg?: string; err?: boolean; problem?: ProblemCopy } | null>(null);
  const [importBusy, setImportBusy] = useState(false);
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
  useEffect(() => { setFlowPicked([]); }, [activeKey]);
  const [selection, setSelection] = useState<string[]>([]);
  /** Station flow checkboxes. Kept here so a command from another step still sees them. */
  const [flowPicked, setFlowPicked] = useState<string[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutOpen, setShortcutOpen] = useState(false);
  /** App-held copy of Units or Devices. Shared by every project tab. Not the OS clipboard. */
  const [clip, setClip] = useState<Clipboard | null>(null);
  const [mode, setMode] = useState<Mode>('select');
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; surface: ContextSurface; kind: MenuKind; focus: HTMLElement | null } | null>(null);
  const [propsFold, setPropsFold] = useState(true);
  const [propPeek, setPropPeek] = useState(false);
  const [fitToken, setFitToken] = useState(0);
  const [rightTab, setRightTab] = useState('props');
  const [subTab, setSubTab] = useState<Record<StepId, string>>({ library: 'cards', canvas: '', attributes: '', sequence: 'sequence', check: 'gap', run: '' });
  const [itemsStep, setItemsStep] = useState<StepId | null>(null);
  const [actionFocus, setActionFocus] = useState<string | null>(null);
  const [jumpTick, setJumpTick] = useState(0);
  const jumpRef = useRef<StepItem['jump']>(null);
  const step = view.step;
  const [helpScope, setHelpScope] = useState<'main' | 'explorer'>('main');
  const helpReturn = useRef<HTMLElement | null>(null);
  const helpWas = useRef(false);
  const goStep = (s: StepId, sub?: string) => { setHelpScope('main'); setView((v) => ({ ...v, step: s, home: false })); if (sub) setSubTab((t) => ({ ...t, [s]: sub })); setItemsStep(null); };
  const pickRight = (k: string) => { setHelpScope('main'); setRightTab(k); };
  const toggleItems = (s: StepId) => setItemsStep((cur) => (cur === s ? null : s));
  const chooseTheme = (mode: 'light' | 'dark') => { const next = mode === 'dark' ? 'B' as const : 'A' as const; setView((v) => (v.theme === next ? v : { ...v, theme: next })); };
  const setBottomTab = (k: string) => {
    const map: Record<string, [StepId, string]> = { runtime: ['run', ''], material: ['sequence', 'material'], sequence: ['sequence', 'sequence'], diag: ['check', 'diag'], gap: ['check', 'gap'] };
    const m = map[k]; if (m) goStep(m[0], m[1]);
  };
  const [layerOpen, setLayerOpen] = useState(false);
  const [arrangeOpen, setArrangeOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [tourIndex, setTourIndex] = useState<number | null>(null);
  const tourReturn = useRef<HTMLElement | null>(null);
  const tourIndexRef = useRef<number | null>(null);
  useEffect(() => {
    if (helpWas.current && !view.helpOpen) {
      const back = helpReturn.current;
      if (back?.isConnected) back.focus();
      else document.querySelector<HTMLElement>('[data-help-toggle]')?.focus();
    }
    helpWas.current = view.helpOpen;
  }, [view.helpOpen]);
  const [speed, setSpeed] = useState(1);
  const [showNames, setShowNames] = useState(true);
  const [emphasizeMotion, setEmphasizeMotion] = useState(true);
  const [equipmentMotion, setEquipmentMotion] = useState(() => equipmentMotionDefault(prefersReducedMotion()));
  const [foldSteps, setFoldSteps] = useState(false);
  const [foldCond, setFoldCond] = useState(false);
  const durationBaseline = useRef<{ sessionKey: string; depth: number; snap: DurationSnap[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const tab = tabs.find((t) => t.key === activeKey) ?? tabs[0];
  const p = tab.history.present;
  const rt = tab.runtime?.state ?? null;
  const locked = rt?.status === 'running' || rt?.status === 'paused';
  const [subUnitPref, setSubUnitPref] = useState('');
  const runMode = 'station' as const;
  const explorerOpen = view.explorerOpen;
  const [libDetail, setLibDetail] = useState(false);
  const [guide, setGuide] = useState<'files' | 'bundle' | 'search' | null>(null);
  const [gapFilter, setGapFilter] = useState<'all' | 'shortfall' | 'human' | 'hidden'>('all');
  const selUnit = (() => { const id = selection[0]; return p.units.find((u) => u.id === id)?.id ?? p.devices.find((d) => d.id === id)?.unitId; })();
  const subUnitId = (p.units.some((u) => u.id === subUnitPref) ? subUnitPref : selUnit ?? p.units.find((u) => (p.substationSequences ?? []).some((q) => q.unitId === u.id))?.id ?? p.units[0]?.id ?? '');

  useEffect(() => { saveView(kv, view); }, [kv, view]);
  const paletteRef = useRef<HTMLDivElement>(null);
  const [paletteHidden, setPaletteHidden] = useState(0);
  useEffect(() => {
    const el = paletteRef.current;
    const fold = el?.closest('.palette-fold') as HTMLElement | null;
    if (!el || !fold) { setPaletteHidden(0); return; }
    const count = () => {
      const box = fold.getBoundingClientRect();
      if (box.height < 1 || fold.scrollHeight <= fold.clientHeight + 1) { setPaletteHidden(0); return; }
      let n = 0;
      for (const item of el.querySelectorAll('.pi')) {
        const r = item.getBoundingClientRect();
        if (r.height < 1) continue;
        if (r.top < box.top - 1 || r.bottom > box.bottom + 1) n += 1;
      }
      setPaletteHidden((v) => (v === n ? v : n));
    };
    count();
    const ro = new ResizeObserver(count);
    ro.observe(fold);
    fold.addEventListener('scroll', count);
    return () => { ro.disconnect(); fold.removeEventListener('scroll', count); };
  }, [step, view.paletteOpen, view.layoutTab]);
  useEffect(() => { if (wsInit?.warnings.length) say(wsInit.warnings.join(' / '), true); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onHistory?.(tab.history); }, [onHistory, tab.history]);
  // N03: a project that is not active never keeps running in the background → pause (state kept, no auto resume)
  useEffect(() => {
    setTabs((ts) => ts.some((t) => t.key !== activeKey && t.runtime?.state.status === 'running')
      ? ts.map((t) => (t.key === activeKey ? t : { ...t, runtime: t.runtime && t.runtime.state.status === 'running' ? pause(t.runtime) : t.runtime }))
      : ts);
  }, [activeKey]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), toast.err ? 6000 : 3000); return () => clearTimeout(t); }, [toast]);
  useEffect(() => {
    if (!arrangeOpen) return;
    const close = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest('.arrange-menu')) setArrangeOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [arrangeOpen]);
  const say = (msg: string, err = false) => setToast({ msg, err });
  const sayProblem = (problem: ProblemCopy) => setToast({ problem, err: true });

  const updTab = useCallback((key: string, f: (t: Tab) => Tab) => setTabs((ts) => ts.map((t) => (t.key === key ? f(t) : t))), []);
  const tabsRef = useRef(tabs); tabsRef.current = tabs;
  const kvRef = useRef(kv); kvRef.current = kv;
  const autoRef = useRef(view.autoDraft); autoRef.current = view.autoDraft;
  const recoveryArmed = useRef(false);
  /** Drafts the user has not recovered or discarded. This session must not overwrite them. */
  const protectedDrafts = useRef<Set<string>>(new Set());
  const draftTimers = useRef<number[]>([]);
  const clearDraftTimers = () => { for (const id of draftTimers.current) window.clearTimeout(id); draftTimers.current = []; };
  // TURN-047: one draft per tab, measured from the last edit. Running and paused tabs wait.
  useEffect(() => {
    if (!view.autoDraft) { clearDraftTimers(); return; }
    const timers: number[] = [];
    for (const t of tabs) {
      const rev = t.history.present.revision;
      if (runBusy(t) || !draftDue(t)) {
        if (!draftDue(t) && t.sessionDraft && kv) {
          const id = t.history.present.id;
          const cleared = discardDraft(kv, id);
          if (cleared.ok) { setDrafts(readDraftList(kv)); updTab(t.key, (x) => ({ ...x, ...noDraft })); }
        }
        continue;
      }
      if (t.draftTriedRevision === rev && (t.draftedRevision === rev || t.draftError)) continue;
      const key = t.key;
      timers.push(window.setTimeout(() => {
        if (!autoRef.current) return;
        const cur = tabsRef.current.find((x) => x.key === key);
        const storage = kvRef.current;
        if (!cur || cur.history.present.revision !== rev || runBusy(cur) || !draftDue(cur)) return;
        if (protectedDrafts.current.has(cur.history.present.id) && !cur.sessionDraft) return;
        if (!storage) { updTab(key, (x) => ({ ...x, draftError: true, draftTriedRevision: rev })); return; }
        const written = saveDraft(storage, cur.history.present, new Date());
        if (!written.ok) { updTab(key, (x) => ({ ...x, draftError: true, draftTriedRevision: rev })); return; }
        updTab(key, (x) => (x.history.present.revision !== rev ? x : { ...x, draftAt: written.savedAt, draftedRevision: rev, draftTriedRevision: rev, draftError: false, sessionDraft: true }));
        setDrafts(readDraftList(storage));
      }, DRAFT_DELAY_MS));
    }
    draftTimers.current = timers;
    return () => { for (const id of timers) window.clearTimeout(id); };
  }, [tabs, view.autoDraft, kv, updTab]);

  /** Apply one model edit as one undo unit. Returns false if blocked/rejected. */
  const edit = (r: C.CmdResult, label: string): boolean => {
    const o = applyEdit(tab.history, r, label, locked);
    if (o.error) {
      if (label === '붙여넣기') sayProblem(refusal('paste', o.error));
      else if (label === '물류 연결' || label === '신호 연결') sayProblem(refusal('connect', o.error));
      else if (label.includes('삭제')) sayProblem(refusal('delete', o.error));
      else say(o.error, true);
      return false;
    }
    updTab(tab.key, (t) => ({ ...t, history: o.history, runtime: null }));
    return true;
  };

  // ---------- runtime driver (virtual time; wall-clock speed only affects pacing, not results) ----------
  const running = rt?.status === 'running';
  useEffect(() => {
    if (!running) return;
    let last = performance.now(); let raf = 0;
    const loop = (now: number) => {
      const dt = Math.min(250, now - last) * speed; last = now;
      updTab(tab.key, (t) => (t.runtime && t.runtime.state.status === 'running' ? keepRun(t, advance(t.runtime, dt)) : t));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, speed, tab.key, updTab]);

  const doRun = () => {
    let r = tab.runtime;
    if (!r || (r.state.status === 'idle' && r.snapshot.revision !== p.revision) || r.state.status === 'completed' || r.state.status === 'error') r = createRuntime(p, `run-${Date.now().toString(36)}`);
    const s = start(r);
    if (s.state.status !== 'running') { say(`실행 준비 실패: ${s.state.blockers.map((b) => b.message).slice(0, 2).join(' / ')}`, true); setBottomTab('runtime'); }
    updTab(tab.key, (t) => keepRun(t, s));
  };
  const doPause = () => updTab(tab.key, (t) => (t.runtime ? keepRun(t, pause(t.runtime)) : t));
  const doResume = () => updTab(tab.key, (t) => (t.runtime ? keepRun(t, resume(t.runtime)) : t));
  const doReset = () => updTab(tab.key, (t) => (t.runtime ? { ...t, runtime: reset(t.runtime), runRecord: null } : t));
  const doStep = () => updTab(tab.key, (t) => (t.runtime && t.runtime.state.status === 'paused' ? keepRun(t, pause(advance(resume(t.runtime), 100))) : t));
  const doToEnd = () => updTab(tab.key, (t) => (t.runtime && t.runtime.state.status === 'running' ? keepRun(t, runToEnd(t.runtime)) : t));
  const doPauseSub = (nodeId: string) => updTab(tab.key, (t) => (t.runtime ? keepRun(t, pauseSubstation(t.runtime, nodeId)) : t));
  const doResumeSub = (nodeId: string) => updTab(tab.key, (t) => (t.runtime ? keepRun(t, resumeSubstation(t.runtime, nodeId)) : t));

  const onActionQuantity = (actionId: string, field: 'duration' | 'timeout', value: number) => {
    const action = p.actions.find((a) => a.id === actionId);
    if (!action || action[field].value === value) return;
    const label = field === 'duration' ? DURATION_EDIT_LABEL : TIMEOUT_EDIT_LABEL;
    const other = field === 'duration' ? 'timeout' : 'duration';
    const last = tab.history.labels[tab.history.labels.length - 1];
    const prev = tab.history.past[tab.history.past.length - 1];
    // Typing or dragging keeps one undo: replace the latest edit of this field on this action.
    if (last === label && prev) {
      const before = prev.actions.find((a) => a.id === actionId);
      const sameOthers = prev.actions.length === p.actions.length && prev.actions.every((a) => {
        if (a.id === actionId) return true;
        const cur = p.actions.find((x) => x.id === a.id);
        return !!cur && a.duration.value === cur.duration.value && a.timeout.value === cur.timeout.value;
      });
      if (before && before[field].value !== action[field].value && before[other].value === action[other].value && sameOthers) {
        const replaced = C.setQuantity(prev, { kind: 'action', id: actionId, field }, value, action[field].assumption);
        if (replaced.ok) { updTab(tab.key, (t) => ({ ...t, history: { ...t.history, present: replaced.project }, runtime: null })); return; }
      }
    }
    edit(C.setQuantity(p, { kind: 'action', id: actionId, field }, value, action[field].assumption), label);
  };
  const onDuration = (actionId: string, value: number) => onActionQuantity(actionId, 'duration', value);
  const onTimeout = (actionId: string, value: number) => onActionQuantity(actionId, 'timeout', value);
  const revertDurations = () => {
    const base = durationBaseline.current;
    if (!base || locked) return;
    const next = revertDurationEdits(tab.history, base.depth, base.snap);
    if (next === tab.history) return;
    updTab(tab.key, (t) => ({ ...t, history: next, runtime: null }));
  };
  const doUndo = () => { const o = undo(tab.history, locked); if (o.error) say(o.error, true); else updTab(tab.key, (t) => ({ ...t, history: o.history, runtime: null })); };
  const doRedo = () => { const o = redo(tab.history, locked); if (o.error) say(o.error, true); else updTab(tab.key, (t) => ({ ...t, history: o.history, runtime: null })); };

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
    if (g.fromRun && g.fix) {
      const j = runGapJump(g.fix);
      if (j.selectId) {
        setSelection([j.selectId]);
        const unitId = p.units.some((u) => u.id === j.selectId) ? j.selectId : p.devices.find((d) => d.id === j.selectId)?.unitId;
        if (unitId) setSubUnitPref(unitId);
      }
      if (j.rightTab) pickRight(j.rightTab);
      if (j.actionId) setActionFocus(j.actionId);
      if (j.step === 'canvas') setView((v) => (v.layoutTab === 'board' ? v : { ...v, layoutTab: 'board' }));
      jumpRef.current = j;
      setJumpTick((n) => n + 1);
      goStep(j.step, j.sub);
      return;
    }
    const id = g.target.objectId;
    if (g.target.panel === 'material') setBottomTab('material');
    else if (g.target.panel === 'sequence') setBottomTab('sequence');
    else { setSelection(id ? [id] : []); goStep(g.target.panel === 'canvas' ? 'canvas' : 'attributes'); pickRight(g.target.panel === 'configurator' && p.devices.some((d) => d.id === id) ? (g.kind === 'axisSpec' ? 'props' : 'actions') : 'props'); }
  };

  // ---------- canvas handlers ----------
  const onDropAsset = (kind: AssetKind | 'unit', at: { x: number; y: number }, unitId?: string) => {
    if (locked) { say('실행 중에는 배치(모델 편집)가 차단됩니다', true); return; }
    if (kind === 'unit') { const r = C.addUnit(p, '', { x: Math.round(at.x - 108), y: Math.round(at.y - 20) }); if (edit(r, 'Unit 배치') && r.ok) setSelection([r.note!]); return; }
    const def = findAsset(kind);
    if (def?.template) { const r2 = C.addUnitFromTemplate(p, kind, { x: Math.round(at.x - 108), y: Math.round(at.y - 20) }); if (edit(r2, `${def.name} 배치`) && r2.ok) setSelection([r2.note!]); return; }
    const pt = unitId ? { x: Math.round(at.x), y: Math.round(at.y) } : { x: Math.round(at.x - 25), y: Math.round(at.y - 20) };
    const r = C.addDevice(p, kind, pt, undefined, undefined, unitId);
    if (edit(r, `${def?.name ?? kind} 배치`) && r.ok) { setSelection([r.note!]); pickRight('props'); }
  };
  const onResizeCommit = (unitId: string, w: number, h: number) => { edit(C.resizeUnit(p, unitId, w, h), 'Unit 크기'); };
  const fitSelectedUnit = () => {
    const id = selection.length === 1 && p.units.some((u) => u.id === selection[0]) ? selection[0] : null;
    if (!id) return;
    edit(C.fitUnitToContent(p, id), '크기 맞춤');
  };
  const arrangeTarget = C.arrangeDevicesTarget(p, selection);
  const arrangeDevicesTitle = locked
    ? C.ARRANGE_DEVICES_LOCKED
    : 'unitId' in arrangeTarget ? C.ARRANGE_DEVICES_HINT : arrangeTarget.reason;
  const arrangeSelectedDevices = () => {
    const target = C.arrangeDevicesTarget(p, selection);
    if (!('unitId' in target)) return;
    edit(C.arrangeDevices(p, target.unitId), '자동 정렬');
  };
  const selectedUnitCount = p.units.filter((u) => selection.includes(u.id)).length;
  const selectedDeviceIds = selection.filter((id) => p.devices.some((d) => d.id === id));
  const selectedNodeIds = selection.filter((id) => p.units.some((u) => u.id === id) || p.devices.some((d) => d.id === id));
  const copyTitle = selectedNodeIds.length === 0 ? COPY_NEED_NODE : '복사 (Ctrl/Cmd+C)';
  const pasteTitle = locked ? PASTE_LOCKED : !clip ? PASTE_EMPTY : '붙여넣기 (Ctrl/Cmd+V)';
  const copyPasteButtons = () => (
    <>
      <button type="button" onClick={requestCopy} disabled={selectedNodeIds.length === 0} title={copyTitle}>복사</button>
      <button type="button" onClick={requestPaste} disabled={locked || !clip} title={pasteTitle}>붙여넣기</button>
    </>
  );
  const runArrange = (r: C.CmdResult, label: string) => {
    setArrangeOpen(false);
    if (edit(r, label) && r.ok && r.note) say(r.note);
  };
  const arrangeItems: { label: string; min: number; undo: string; run: () => C.CmdResult }[] = [
    { label: '가로 간격 같게', min: 3, undo: '가로 간격 같게', run: () => C.distributeUnits(p, selection, 'x') },
    { label: '세로 간격 같게', min: 3, undo: '세로 간격 같게', run: () => C.distributeUnits(p, selection, 'y') },
    { label: '너비 같게', min: 2, undo: '너비 같게', run: () => C.matchUnitSize(p, selection, 'w') },
    { label: '높이 같게', min: 2, undo: '높이 같게', run: () => C.matchUnitSize(p, selection, 'h') },
    { label: '겹침 풀기', min: 2, undo: '겹침 풀기', run: () => C.spreadUnits(p, selection, C.UNIT_SPREAD_GAP) },
  ];
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
  const onFlowConnect = (fromId: string, toId: string) => {
    const r = C.addConnection(p, 'flow', fromId, toId);
    if (edit(r, '물류 연결')) say('물류 연결 추가');
    setConnectFrom(null);
  };
  const onConnectCancel = () => setConnectFrom(null);
  const requestDelete = (id: string) => {
    if (locked) { sayProblem(refusal('delete', '실행 중에는 삭제가 차단됩니다')); return; }
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
      actions: [{ label: '취소', focus: true, run: () => {} }, { label: '참조 해제 후 삭제', danger: true, run: () => { if (edit(C.deleteNode(p, id), `${name} 삭제`)) setSelection([]); } }],
    });
  };
  const requestDeleteMany = (ids: string[]) => {
    if (locked) { sayProblem(refusal('delete', '실행 중에는 삭제가 차단됩니다')); return; }
    const targets = ids.filter((id) => p.units.some((u) => u.id === id) || p.devices.some((d) => d.id === id));
    if (targets.length < 2) return;
    const imp = C.impactOfNodes(p, targets);
    setModal({
      title: '여러 개 삭제 — 참조 영향 확인',
      body: <div>
        <p>삭제될 Unit {imp.units}개, Device {imp.devices}개.</p>
        <p>Action {imp.actions}개, 시퀀스 단계 {imp.steps}개, 연결 {imp.connections}개, Substation 시퀀스 {imp.subSequences}개.</p>
        <p>다른 Action에서 참조하던 조건은 “미정” 조건으로 바뀌어 실행이 차단되고 Gap에 표시됩니다 (임의 true 처리 안 함).</p>
        <p className="muted">한 번에 지워지고, Undo 한 번에 돌아옵니다.</p></div>,
      actions: [{ label: '취소', focus: true, run: () => {} }, { label: '참조 해제 후 삭제', danger: true, run: () => { if (edit(C.deleteNodes(p, targets), '여러 개 삭제')) setSelection([]); } }],
    });
  };
  const confirmDelete: ConfirmDelete = (title, detail, run) => {
    if (locked) { sayProblem(refusal('delete', '실행 중에는 삭제가 차단됩니다')); return; }
    if (!detail) { run(); return; }
    setModal({
      title,
      body: <div><p data-delete-detail>{detail}</p><p className="muted">확인해야 지워집니다. Undo로 되돌릴 수 있습니다.</p></div>,
      actions: [{ label: '취소', focus: true, run: () => {} }, { label: '삭제', danger: true, run }],
    });
  };
  const requestDuplicate = () => {
    if (!selectedDeviceIds.length) { say(C.DUPLICATE_NEED_DEVICE, true); return; }
    const r = C.duplicateDevices(p, selection);
    if (edit(r, 'Device 복제') && r.ok) setSelection(r.note ? r.note.split(',') : []);
  };
  const requestCopy = () => {
    const r = captureCopy(p, selection);
    if (!r.ok) { say(r.reason, true); return; }
    setClip(r.clip);
    const n = r.clip.kind === 'units' ? r.clip.units.length : r.clip.devices.length;
    const noun = r.clip.kind === 'units' ? 'Unit' : 'Device';
    say(`${noun} ${n}개를 복사했습니다`);
  };
  const requestPaste = () => {
    if (locked) { sayProblem(refusal('paste', PASTE_LOCKED)); return; }
    if (!clip) { sayProblem(refusal('paste', PASTE_EMPTY)); return; }
    const r = pasteClipboard(p, clip, selection);
    if (edit(r, '붙여넣기') && r.ok) {
      const { ids, message } = splitPasteNote(r.note);
      setSelection(ids);
      if (message) say(message);
    }
  };
  const requestReparent = (deviceId: string, unitId: string) => {
    const d = p.devices.find((x) => x.id === deviceId); const u = p.units.find((x) => x.id === unitId);
    if (!d || !u || d.unitId === unitId) return;
    const imp = C.impactOf(p, deviceId);
    setModal({ title: `${d.name} 소속을 ${u.name}(으)로 변경`, body: <p>영향 Action {imp.actions.length}개, 시퀀스 단계 {imp.steps.length}개. 좌표는 새 Unit 안쪽으로 옮깁니다.</p>,
      actions: [{ label: '변경', primary: true, run: () => { edit(C.reparentDevice(p, deviceId, unitId, { x: u.layout.x + 20, y: u.layout.y + 40 }), 'Device 소속 변경'); } }, { label: '취소', run: () => {} }] });
  };
  const openContext = (req: ContextRequest) => {
    const plan = planContext(p, selection, req.hit);
    const same = plan.selection.length === selection.length && plan.selection.every((id, i) => id === selection[i]);
    if (!same) setSelection(plan.selection);
    setCtx({ x: req.x, y: req.y, surface: req.surface, kind: plan.kind, focus: req.focus });
  };
  const runMenu = (id: MenuAction) => {
    setCtx(null);
    if (id === 'props') {
      setPropPeek(false);
      setPropsFold(true);
      pickRight('props');
      if (step !== 'canvas' && step !== 'attributes') goStep('canvas');
      return;
    }
    if (id === 'propsView') { setPropPeek(true); return; }
    if (id === 'fitView') { setFitToken((n) => n + 1); return; }
    if (id === 'selectAll') {
      const hit = selectAll(p, selection);
      if ('keep' in hit) say(hit.message, true);
      else setSelection(hit.ids);
      return;
    }
    if (id === 'copy') { requestCopy(); return; }
    if (id === 'paste') { requestPaste(); return; }
    if (id === 'duplicate') { requestDuplicate(); return; }
    if (id === 'arrange') { arrangeSelectedDevices(); return; }
    if (id === 'fit') { fitSelectedUnit(); return; }
    if (id === 'rename') {
      const u = p.units.find((x) => x.id === selection[0]);
      if (!u || locked) return;
      setNameDlg({
        title: `Unit 이름 변경 — ${u.name}`,
        initial: u.name,
        submitLabel: '이름 변경',
        hint: 'Unit 이름입니다. 한 번에 rev +1, Undo 한 번.',
        validate: (n) => (n.trim() ? null : '이름은 비울 수 없습니다'),
        onSubmit: (n) => { if (edit(C.renameObject(p, u.id, n), 'Unit 이름')) setNameDlg(null); },
      });
      return;
    }
    if (id === 'delete') {
      if (selectedNodeIds.length >= 2) requestDeleteMany(selectedNodeIds);
      else if (selection.length >= 1) requestDelete(selection[0]);
      return;
    }
    if (id === 'alignLeft') { edit(C.alignNodes(p, selection, 'left'), '왼쪽 정렬'); return; }
    if (id === 'alignTop') { edit(C.alignNodes(p, selection, 'top'), '위 정렬'); return; }
    if (id === 'gapX') { const r = C.distributeUnits(p, selection, 'x'); runArrange(r, '가로 간격 같게'); return; }
    if (id === 'gapY') { runArrange(C.distributeUnits(p, selection, 'y'), '세로 간격 같게'); return; }
    if (id === 'matchW') { runArrange(C.matchUnitSize(p, selection, 'w'), '너비 같게'); return; }
    if (id === 'matchH') { runArrange(C.matchUnitSize(p, selection, 'h'), '높이 같게'); return; }
  };

  // ---------- keyboard ----------
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      const tag = target?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || isTextField(target);
      const cmd = commandForEvent(e);
      const blocked = dialogOpen() || tourIndex !== null;
      // Ctrl/Cmd+K opens the palette from an input too. It does not open over a dialog or the tour.
      if (cmd?.id === 'palette') {
        e.preventDefault();
        if (paletteOpen) { setPaletteOpen(false); return; }
        if (blocked) return;
        setCtx(null);
        setPaletteOpen(true);
        return;
      }
      // `?` is a character while a field is focused. The sheet is not a model edit.
      if (cmd?.id === 'shortcuts') {
        if (typing) return;
        if (blocked || paletteOpen) return;
        e.preventDefault();
        setShortcutOpen(true);
        return;
      }
      // Bookmark (Ctrl/Cmd+D) is always swallowed. Duplicate itself still follows the dialog / input rule.
      if (cmd?.id === 'duplicate') {
        e.preventDefault();
        if (blocked || typing) return;
        if (step === 'canvas' || step === 'attributes') requestDuplicate();
        return;
      }
      // rev 4: while any dialog is open, background project shortcuts (Undo/Redo/Delete/Esc mode reset) never act
      if (blocked) return;
      if (typing) return;
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        const el = e.target as HTMLElement | null;
        if (!el || isTextField(el) || el.closest('.ctx-menu')) return;
        const treeItem = el.closest<HTMLElement>('[data-tree-id]');
        if (treeItem) {
          const id = treeItem.dataset.treeId ?? '';
          const hit = p.units.some((u) => u.id === id) ? { kind: 'unit' as const, id } : p.devices.some((d) => d.id === id) ? { kind: 'device' as const, id } : null;
          if (!hit) return;
          e.preventDefault();
          const r = treeItem.getBoundingClientRect();
          openContext({ x: r.left, y: r.bottom, hit, surface: 'tree', focus: treeItem });
          return;
        }
        const host = el.closest<HTMLElement>('.rf-host, .board');
        if (!host || view.home || guide) return;
        e.preventDefault();
        const rect = host.getBoundingClientRect();
        const surface: ContextSurface = step === 'run' ? 'run' : host.classList.contains('board') ? 'board' : 'diagram';
        openContext({ x: rect.left + 8, y: rect.top + 8, hit: hitFromSelection(p, selection), surface, focus: el });
        return;
      }
      // TURN-044. Step 2, and the explorer tree. An input already returned, so text copy stays native.
      const inTree = !!(e.target as HTMLElement | null)?.closest?.('.tree');
      const onCanvas = !view.home && !guide && step === 'canvas';
      if ((cmd?.id === 'copy' || cmd?.id === 'paste') && (onCanvas || inTree)) {
        e.preventDefault();
        if (cmd.id === 'copy') requestCopy();
        else requestPaste();
        return;
      }
      // TURN-027. Step 2 only. Inputs and dialogs already returned, so the browser keeps its own Ctrl+A.
      if (cmd?.id === 'select-all') {
        if (view.home || guide || step !== 'canvas') return;
        e.preventDefault();
        const hit = selectAll(p, selection);
        if ('keep' in hit) say(hit.message, true);
        else setSelection(hit.ids);
        return;
      }
      if (cmd?.id === 'undo') { e.preventDefault(); doUndo(); }
      else if (cmd?.id === 'redo') { e.preventDefault(); doRedo(); }
      else if (cmd?.id === 'delete' && (step === 'canvas' || step === 'attributes')) {
        if (selectedNodeIds.length >= 2) { e.preventDefault(); requestDeleteMany(selectedNodeIds); }
        else if (selection.length === 1) { e.preventDefault(); requestDelete(selection[0]); }
      }
      else if (e.key === 'Escape') { setConnectFrom(null); setMode('select'); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  // ---------- file / workspace ----------
  const persistTab = (target: Tab): boolean => {
    if (!kv) { sayProblem(saveProblem(`${storage.reason} — JSON 내보내기를 사용하세요. 메모리 변경은 유지됩니다.`)); return false; }
    const proj = target.history.present;
    const owner = W.ownerOf(reg, proj.id);
    if (owner && owner.id !== reg.activeId) {
      if (target.key === tab.key) {
        setModal({ title: '다른 Workspace에 같은 ID가 저장되어 있음', body: <p>{proj.name} ({proj.id})와 같은 ID의 프로젝트가 Workspace 「{owner.name}」에 저장되어 있습니다. 덮어쓰지 않았습니다. 새 ID 사본으로 현재 Workspace 「{curWs.name}」에 저장할 수 있습니다.</p>,
          actions: [{ label: '취소', focus: true, run: () => {} }, { label: '새 ID 사본으로 저장', primary: true, run: () => saveAsCopy() }] });
      } else sayProblem(saveProblem('다른 Workspace에 같은 ID가 있어 저장하지 못했습니다. 탭은 그대로 두었습니다.'));
      return false;
    }
    // TURN-002 rev 2: body + index + membership in one transaction — either all saved or nothing changed
    const r = W.saveProjectInWorkspace(kv, reg, reg.activeId, proj);
    if (!r.ok) { sayProblem(saveProblem(r.reason)); return false; }
    setReg(r.reg);
    clearDraftTimers();
    const cleared = discardDraft(kv, proj.id);
    setDrafts(readDraftList(kv));
    updTab(target.key, (t) => ({ ...t, savedRevision: proj.revision, savedAt: r.savedAt, ...noDraft }));
    say(`브라우저 저장소에 저장됨 (Workspace 「${curWs.name}」, 저장 후 읽기 확인 완료)${cleared.ok ? '' : ` 임시 저장은 지우지 못했습니다: ${cleared.reason}`}`);
    return true;
  };
  const doSave = () => { persistTab(tab); };
  /** project id saved in another workspace → save a copy with a new id here (the original tab content moves to the copy; nothing lost) */
  const saveAsCopy = () => {
    if (!kv) return;
    const oldId = p.id;
    const copy = { ...p, id: `${p.id}-copy-${Date.now().toString(36)}` };
    const r = W.saveProjectInWorkspace(kv, reg, reg.activeId, copy);
    if (!r.ok) { sayProblem(saveProblem(`${r.reason} — 사본을 만들지 않았고 현재 탭은 그대로입니다`)); return; }
    setReg(r.reg);
    discardDraft(kv, oldId);
    setDrafts(readDraftList(kv));
    const t = makeTab(copy, { rev: copy.revision, at: r.savedAt });
    setTabs((ts) => ts.map((x) => (x.key === tab.key ? t : x))); setActiveKey(t.key);
    say(`새 ID 사본 ${copy.id}로 저장했습니다 (원래 Workspace의 프로젝트는 그대로)`);
  };
  const savedStamp = (id: string) => {
    const entry = kv ? readIndex(kv).find((e) => e.id === id) : undefined;
    return entry ? { revision: entry.revision, savedAt: entry.savedAt } : null;
  };
  type SavedStamp = { revision: number; savedAt: string };
  const releaseDraft = (id: string) => { protectedDrafts.current.delete(id); };
  const askRecovery = (id: string, draft: DraftMeta, saved: SavedStamp | null) => {
    setModal({
      title: '저장 안 된 변경이 있습니다',
      body: saved
        ? <p>임시 저장 {formatClock(draft.savedAt)} · rev {draft.revision}. 저장본은 rev {saved.revision} 그대로 둡니다.</p>
        : <p>임시 저장 {formatClock(draft.savedAt)} · rev {draft.revision}. 저장본은 없습니다.</p>,
      actions: [
        { label: '복구', primary: true, focus: true, run: () => recoverInto(id, saved) },
        { label: '버리기', danger: true, run: () => dropDraft(id) },
      ],
    });
  };
  const recoverInto = (id: string, saved: SavedStamp | null) => {
    if (!kv) return;
    const loaded = loadDraft(kv, id);
    if (!loaded.ok) {
      if (loaded.raw) setQlist((l) => quarantine(kv, { at: new Date().toLocaleString(), label: `draft:${id}`, raw: loaded.raw, errors: loaded.errors.map((e) => e.message) }, l));
      discardDraft(kv, id);
      releaseDraft(id);
      setDrafts(readDraftList(kv));
      sayProblem(draftProblem(saved ? '임시 저장을 열지 못했습니다. 저장본을 유지합니다.' : '임시 저장을 열지 못했습니다.'));
      return;
    }
    const meta = readDraftList(kv).find((d) => d.id === id);
    const draftInfo = meta ? { at: meta.savedAt, revision: loaded.project.revision } : null;
    const next = makeTab(loaded.project, saved ? { rev: saved.revision, at: saved.savedAt } : null, draftInfo);
    releaseDraft(id);
    const tabKey = tabsRef.current.find((t) => t.history.present.id === id)?.key ?? null;
    if (tabKey) {
      setTabs((ts) => ts.map((t) => (t.key === tabKey ? { ...next, key: tabKey } : t)));
      setActiveKey(tabKey);
    } else {
      setTabs((ts) => [...ts, next]);
      setActiveKey(next.key);
    }
    setSelection([]); setView((v) => ({ ...v, home: false }));
  };
  const dropDraft = (id: string, tabKey?: string) => {
    clearDraftTimers();
    if (!kv) return;
    const r = discardDraft(kv, id);
    if (!r.ok) { sayProblem(draftProblem(r.reason)); return; }
    releaseDraft(id);
    setDrafts(readDraftList(kv));
    const key = tabKey ?? tabsRef.current.find((t) => t.history.present.id === id)?.key;
    if (key) updTab(key, (t) => ({ ...t, ...noDraft }));
  };
  const openDraft = (id: string) => {
    if (!kv) return;
    const loaded = loadDraft(kv, id);
    if (!loaded.ok) {
      if (loaded.raw) setQlist((l) => quarantine(kv, { at: new Date().toLocaleString(), label: `draft:${id}`, raw: loaded.raw, errors: loaded.errors.map((e) => e.message) }, l));
      discardDraft(kv, id);
      releaseDraft(id);
      setDrafts(readDraftList(kv));
      sayProblem(draftProblem('임시 저장을 열지 못했습니다.'));
      return;
    }
    const meta = drafts.find((d) => d.id === id) ?? readDraftList(kv).find((d) => d.id === id);
    const draftInfo = { at: meta?.savedAt ?? new Date().toISOString(), revision: loaded.project.revision };
    const existing = tabs.find((t) => t.history.present.id === id);
    const untouched = !!existing && existing.history.past.length === 0 && existing.history.future.length === 0 && existing.savedRevision === null && existing.history.present.revision === existing.baselineRevision;
    if (existing && !untouched) { setActiveKey(existing.key); setView((v) => ({ ...v, home: false })); return; }
    releaseDraft(id);
    const next = makeTab(loaded.project, null, draftInfo);
    if (existing && untouched) {
      setTabs((ts) => ts.map((t) => (t.key === existing.key ? { ...next, key: existing.key } : t)));
      setActiveKey(existing.key);
    } else {
      setTabs((ts) => [...ts, next]); setActiveKey(next.key);
    }
    setSelection([]); setView((v) => ({ ...v, home: false }));
  };
  const promptDrafts = (items: { draft: DraftMeta; saved: SavedStamp | null }[]) => {
    if (items.length === 0) { setModal(null); return; }
    if (items.length === 1) { askRecovery(items[0].draft.id, items[0].draft, items[0].saved); return; }
    setModal({
      title: '저장 안 된 변경이 있습니다',
      body: <div>
        <p>임시 저장 {items.length}개가 있습니다. 복구하거나 버리기 전에는 같은 프로젝트의 새 편집이 이 임시 저장을 덮어쓰지 않습니다.</p>
        {items.map((item) => <div key={item.draft.id} className="home-recent" data-recovery-id={item.draft.id}>
          <div><b>{item.draft.name}</b><div className="muted">임시 저장 {formatClock(item.draft.savedAt)} · rev {item.draft.revision}{item.saved ? ` · 저장본 rev ${item.saved.revision}` : ' · 저장본 없음'}</div></div>
          <button type="button" className="btn-main danger" aria-label={`${item.draft.name} 임시 저장 버리기`} onClick={() => { dropDraft(item.draft.id); promptDrafts(items.filter((x) => x.draft.id !== item.draft.id)); }}>버리기</button>
          <button type="button" className="btn-main primary" aria-label={`${item.draft.name} 임시 저장 복구`} onClick={() => { recoverInto(item.draft.id, item.saved); promptDrafts(items.filter((x) => x.draft.id !== item.draft.id)); }}>복구</button>
        </div>)}
      </div>,
      actions: [{ label: '나중에', focus: true, run: () => {} }],
    });
  };
  useEffect(() => {
    if (recoveryArmed.current) return;
    recoveryArmed.current = true;
    if (!kv) return;
    const pending: { draft: DraftMeta; saved: SavedStamp | null }[] = [];
    for (const draft of drafts) {
      const saved = savedStamp(draft.id);
      if (saved ? draftOffersRecovery(draft, saved) : true) pending.push({ draft, saved });
    }
    for (const item of pending) protectedDrafts.current.add(item.draft.id);
    promptDrafts(pending);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const openSaved = (id: string) => {
    const existing = tabs.find((t) => t.history.present.id === id);
    const saved = savedStamp(id);
    const draft = drafts.find((d) => d.id === id);
    if (existing) {
      setActiveKey(existing.key); setView((v) => ({ ...v, home: false }));
      if (draft && saved && draftOffersRecovery(draft, saved)) { protectedDrafts.current.add(id); askRecovery(id, draft, saved); return; }
      say('이미 열린 프로젝트입니다 — 기존 탭으로 이동했습니다'); return;
    }
    const r = loadProject(kv!, id);
    if (!r.ok) {
      if (r.raw) setQlist((l) => quarantine(kv, { at: new Date().toLocaleString(), label: `saved:${id}`, raw: r.raw, errors: r.errors.map((e) => e.message) }, l));
      say(`열기 실패: ${r.errors.map((e) => e.message).slice(0, 2).join(' / ')} (원본 덮어쓰기 없음)`, true); return;
    }
    const entry = readIndex(kv!).find((e) => e.id === id);
    const t = makeTab(r.project, { rev: r.project.revision, at: entry?.savedAt ?? '' });
    setTabs((ts) => [...ts, t]); setActiveKey(t.key); setSelection([]); setView((v) => ({ ...v, home: false }));
    if (draft && saved && draftOffersRecovery(draft, { revision: r.project.revision, savedAt: saved.savedAt })) { protectedDrafts.current.add(id); askRecovery(id, draft, { revision: r.project.revision, savedAt: saved.savedAt }); }
    else if (r.warnings.length) say(`경고 ${r.warnings.length}: ${r.warnings[0].message}`);
  };
  const openExplorerTab = (id: ExplorerTab) => {
    setHelpScope('explorer');
    setView((v) => (v.explorerTab === id && v.explorerOpen ? v : { ...v, explorerTab: id, explorerOpen: true }));
  };
  const toggleExplorer = () => setView((v) => ({ ...v, explorerOpen: !v.explorerOpen }));
  const setRunDetailsOpen = (open: boolean) => setView((v) => (v.runDetailsOpen === open ? v : { ...v, runDetailsOpen: open }));
  const setRunDetailsTab = (id: RunDetailsTab) => setView((v) => (v.runDetailsTab === id ? v : { ...v, runDetailsTab: id }));
  const toggleRunStrip = () => setView((v) => ({ ...v, runStripFolded: !v.runStripFolded }));
  const openLayoutTab = (id: LayoutTab) => {
    setHelpScope('main');
    setView((v) => (v.layoutTab === id ? v : { ...v, layoutTab: id }));
  };
  const showOpen = () => {
    if (!kv) { say(`${storage.reason}. JSON 가져오기를 사용하세요.`, true); return; }
    openExplorerTab('project');
  };
  const newProject = (kind: 'blank' | 'sample' | 'parallel' | 'flow') => {
    const used = projectNames();
    const proj = kind === 'sample' ? { ...buildSampleProject(), id: `prj-${Date.now().toString(36)}`, name: W.uniqueName(`5공정 예제 사본 ${tabs.length + 1}`, used) }
      : kind === 'parallel' ? { ...buildParallelSampleProject(), id: `prj-par-${Date.now().toString(36)}`, name: W.uniqueName(`병렬 Substation 예제 ${tabs.length + 1}`, used) }
      : kind === 'flow' ? { ...buildFlowSampleProject(), id: `prj-flow-${Date.now().toString(36)}`, name: W.uniqueName(`흐름 예제 ${tabs.length + 1}`, used) }
      : emptyProject(W.uniqueName(`새 프로젝트 ${tabs.length + 1}`, used));
    const t = makeTab(proj); setTabs((ts) => [...ts, t]); setActiveKey(t.key); setSelection([]);
    setView((v) => ({ ...v, home: false }));
  };
  const restoreTourFocus = () => {
    const back = tourReturn.current;
    if (back?.isConnected) { back.focus(); return; }
    document.querySelector<HTMLElement>('.stepper .st.on .st-go')?.focus();
  };
  const endTour = () => {
    tourIndexRef.current = null;
    setTourIndex(null);
    setView((v) => (v.tourSeen ? v : { ...v, tourSeen: true }));
  };
  const goTour = (index: number) => {
    const spec = TOUR_STEPS[index];
    if (!spec) { endTour(); return; }
    tourIndexRef.current = index;
    setTourIndex(index);
    setHelpScope('main');
    setLibDetail(false);
    setItemsStep(null);
    setGuide(null);
    setView((v) => ({ ...v, home: false, step: spec.step, ...(spec.step === 'canvas' ? { layoutTab: 'board' as const } : {}) }));
    if (spec.sub) setSubTab((t) => ({ ...t, [spec.step]: spec.sub! }));
    if (spec.step === 'attributes') pickRight('props');
  };
  const beginTour = (opener: HTMLElement | null) => {
    tourReturn.current = opener;
    setViewOpen(false);
    const existing = tabs.find((t) => isTourSample(t.history.present));
    if (!existing) newProject('sample');
    else if (existing.key !== tab.key) { setActiveKey(existing.key); setSelection([]); }
    goTour(0);
  };
  const nextTour = () => { const i = tourIndexRef.current; if (i === null) return; goTour(i + 1); };
  const prevTour = () => { const i = tourIndexRef.current; if (i === null || i <= 0) return; goTour(i - 1); };
  const closeTab = (key: string) => {
    const t = tabs.find((x) => x.key === key)!;
    const doClose = () => setTabs((ts) => { const n = ts.filter((x) => x.key !== key); const list = n.length ? n : [makeTab(emptyProject('새 프로젝트'))]; if (key === activeKey) setActiveKey(list[0].key); return list; });
    if (t.savedRevision !== t.history.present.revision) setModal({ title: '저장하지 않은 변경', body: <p>{t.history.present.name}에 저장되지 않은 변경이 있습니다. 저장에 성공한 뒤에만 탭을 닫습니다. 버리기는 이 확인에서만 적용됩니다.</p>, actions: [
      { label: '취소 (변경 유지)', focus: true, run: () => {} },
      { label: '저장 후 닫기', primary: true, run: () => { if (persistTab(t)) doClose(); } },
      { label: '저장하지 않고 닫기', danger: true, run: () => { dropDraft(t.history.present.id); doClose(); } },
    ] });
    else doClose();
  };
  const onImportFile = async (f: File) => {
    const large = f.size >= LARGE_IMPORT_BYTES;
    if (large) setImportBusy(true);
    try {
    const text = await f.text();
    const r = parseProjectFile(text);
    if (!r.ok) {
      setQlist((l) => quarantine(kv, { at: new Date().toLocaleString(), label: f.name, raw: text, errors: r.errors.map((e) => `[${e.code}] ${e.objectId}: ${e.message}`) }, l));
      setModal({ title: '가져오기 거부 — 현재 모델 불변', body: <div data-import-reject=""><Problem copy={importRejectProblem(f.name)} />{r.errors.slice(0, 12).map((e) => <div key={e.id} style={{ fontSize: 12 }}>[{e.code}] {e.objectId}: {e.message}</div>)}</div>, actions: [{ label: '확인', run: () => setBottomTab('diag') }] });
      return;
    }
    const existing = tabs.find((t) => t.history.present.id === r.project.id);
    if (existing) {
      setModal({ title: '같은 ID의 프로젝트가 이미 열려 있음', body: <Problem copy={{ tone: 'error', what: '같은 ID가 이미 열려 있습니다', why: `${r.project.name} (${r.project.id}). 기존 탭을 덮어쓰지 않습니다.`, how: '새 ID로 사본을 열 수 있습니다.' }} />,
        actions: [{ label: '새 ID 사본으로 열기', primary: true, run: () => { const t = makeTab({ ...r.project, id: `${r.project.id}-copy-${Date.now().toString(36)}`, name: `${r.project.name} (가져온 사본)` }); setTabs((ts) => [...ts, t]); setActiveKey(t.key); setView((v) => ({ ...v, home: false })); } }, { label: '기존 탭으로 이동', run: () => { setActiveKey(existing.key); setView((v) => ({ ...v, home: false })); } }] });
      return;
    }
    const t = makeTab(r.project); setTabs((ts) => [...ts, t]); setActiveKey(t.key); setSelection([]); setView((v) => ({ ...v, home: false }));
    say(`가져오기 완료${r.warnings.length ? ` (경고 ${r.warnings.length}: ${r.warnings[0].message})` : ''} — 아직 브라우저 저장소에는 저장되지 않음`);
    } finally { if (large) setImportBusy(false); }
  };

  const appearance = appearanceOf(view.theme);
  const themeVars = THEMES[paletteTheme(view.theme)].vars;
  const setPanel = (key: PanelKey, n: number) => setView((v) => (v.panels[key] === n ? v : { ...v, panels: { ...v.panels, [key]: n } }));
  const style = { ...Object.fromEntries(Object.entries(themeVars).map(([k, v]) => [`--${k}`, v])),
    ...statusCssVars(appearance),
    '--exw': `${explorerOpen ? view.panels.explorer : 40}px`, '--libw': `${view.panels.library}px`, '--propw': `${view.panels.canvas}px`, '--runw': `${view.panels.run}px` } as React.CSSProperties;
  const selectedId = selection.length === 1 ? selection[0] : null;
  const dirty = tab.savedRevision !== p.revision;
  const L = view.layers;

  const photoMissingKinds = ASSET_LIBRARY.filter((d) => resolveGenerated(d.kind).status === 'missing').map((d) => d.kind);
  const runRecord = tab.runRecord;
  const runGaps = analyzeRunGaps(runRecord?.snapshot ?? p, runRecord?.state ?? null);
  const runStale = !!runRecord && runRecord.state.modelRevision !== p.revision;
  const evals = evaluateSteps(p, { gaps: [...tab.gaps, ...runGaps], rt, saved: !dirty, photoMissingKinds });
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
      actions: [{ label: '머무르며 수정', primary: true, run: () => setItemsStep(step) }, { label: '확인 없이 다음 화면 보기', run: () => goStep(nx.id) }] });
  };
  const goItem = (it: StepItem) => {
    const j = it.jump;
    if (!j) { setItemsStep(null); return; }
    if (j.selectId) {
      setSelection([j.selectId]);
      const unitId = p.units.find((u) => u.id === j.selectId)?.id ?? p.devices.find((d) => d.id === j.selectId)?.unitId;
      if (unitId) setSubUnitPref(unitId);
    }
    if (j.rightTab) pickRight(j.rightTab);
    if (j.actionId) setActionFocus(j.actionId);
    if (j.gapFilter) setGapFilter(j.gapFilter);
    jumpRef.current = j;
    setJumpTick((n) => n + 1);
    if (j.save) setItemsStep(null);
    else goStep(j.step, j.sub);
  };
  // TURN-001: 6단계 그룹 실행 차단 항목 → 원인 수정/확인 화면으로 이동 (보기 상태만 변경, 모델·Undo 불변).
  // 그룹 실행 대상(subUnitId)은 이동 전에 보기 선호값으로 고정해, 편집 대상 선택이 실행 Substation을 바꾸지 않게 한다.
  const jumpInterlock = (id: string) => {
    const k = p.constraints.find((c) => c.id === id);
    const dev = k?.relatedIds.find((rid) => p.devices.some((d) => d.id === rid));
    if (dev) {
      setSelection([dev]);
      const unitId = p.devices.find((d) => d.id === dev)?.unitId;
      if (unitId) setSubUnitPref(unitId);
    }
    pickRight('check');
    jumpRef.current = { step: 'attributes', selectId: dev, rightTab: 'check', field: `interlock:${id}` };
    setJumpTick((n) => n + 1);
    goStep('attributes');
  };
  const goBlocker = (_b: Diagnostic, g: BlockerGuide) => {
    if (!g.dest) return;
    if (subUnitId) setSubUnitPref(subUnitId);
    if (g.focus) { setSelection([g.focus.id]); pickRight(g.focus.kind === 'device' ? 'actions' : 'props'); }
    if (g.actionId) setActionFocus(g.actionId);
    if (g.field) {
      jumpRef.current = {
        step: g.dest.step,
        sub: g.dest.sub,
        selectId: g.focus?.id,
        rightTab: g.focus?.kind === 'device' ? 'actions' : g.focus ? 'props' : undefined,
        actionId: g.actionId,
        field: g.field,
      };
      setJumpTick((n) => n + 1);
    }
    goStep(g.dest.step, g.dest.sub);
  };
  const showPalette = (field: string) => {
    setView((v) => ({ ...v, paletteOpen: true, home: false, step: 'canvas' }));
    jumpRef.current = { step: 'canvas', field };
    setJumpTick((n) => n + 1);
  };
  const jumpRunError = () => {
    if (!rt?.error) return;
    const hit = analyzeRunGaps(p, rt).find((g) => g.id.startsWith('run:error:') && g.fix);
    if (hit) goGap(hit);
  };
  const listEval = itemsStep ? evals[itemsStep] : null;
  const listMeta = itemsStep ? STEPS.find((s) => s.id === itemsStep)! : null;
  useEffect(() => {
    const j = jumpRef.current;
    if (!jumpTick || !j?.field) return;
    const field = j.field;
    const until = Date.now() + 2000;
    let timer = 0;
    let focused = false;
    const paint = () => {
      const el = jumpTarget(field);
      if (!el) {
        if (Date.now() < until) timer = window.setTimeout(paint, 30);
        return;
      }
      if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center', inline: 'nearest' });
      el.classList.add('jump-flash');
      if (!focused) { focused = true; focusJump(el); }
      if (Date.now() < until) timer = window.setTimeout(paint, 80);
      else el.classList.remove('jump-flash');
    };
    paint();
    return () => {
      window.clearTimeout(timer);
      document.querySelectorAll('.jump-flash').forEach((n) => n.classList.remove('jump-flash'));
    };
  }, [jumpTick]);
  useEffect(() => {
    if (!itemsStep) return;
    const pop = document.querySelector('.itemspop');
    const first = pop?.querySelector<HTMLElement>('button.item-jump') ?? pop?.querySelector<HTMLElement>('button');
    first?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setItemsStep(null); };
    const onPtr = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || t.closest('.itemspop') || t.closest('[data-step-badge]') || t.closest('[data-items-toggle]')) return;
      setItemsStep(null);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPtr);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onPtr); };
  }, [itemsStep]);
  const onItemKey = (e: React.KeyboardEvent, run: () => void) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    run();
  };
  const sub = subTab[step];
  const Sub = ({ items }: { items: [string, string][] }) => <div className="tabs subtabs">{items.map(([k, l]) => <button key={k} className={sub === k ? 'on' : ''} onClick={() => { setHelpScope('main'); setSubTab((t) => ({ ...t, [step]: k })); }}><Terms text={l} /></button>)}</div>;
  const subCount = (uid: string) => (p.substationSequences ?? []).filter((q) => q.unitId === uid).length;
  const pick = (id: string) => { setSelection([id]); const u = p.units.find((x) => x.id === id)?.id ?? p.devices.find((d) => d.id === id)?.unitId; if (u) setSubUnitPref(u); };
  const collapsed = view.treeCollapsed[p.id] ?? [];
  const setCollapsed = (ids: string[]) => setView((v) => ({ ...v, treeCollapsed: { ...v.treeCollapsed, [p.id]: ids } }));
  const faultIds = faultDeviceIds(p, rt);
  const interlockIds = interlockFaultDeviceIds(p, rt);
  const runningIds = sceneActiveIds(p, rt);
  const statusOf = Object.fromEntries(p.devices.flatMap((d) => {
    const key = deviceDisplayStatus({
      fault: faultIds.includes(d.id),
      active: runningIds.includes(d.id),
      undetermined: Object.values(d.properties).some((q) => q.value === null),
      assumption: Object.values(d.properties).some((q) => q.value !== null && q.assumption),
    });
    return key ? [[d.id, key]] : [];
  }));
  const tree = <ProjectTree p={p} selection={selection} collapsed={collapsed} onCollapsedChange={setCollapsed} onPick={pick} subCount={subCount} statusOf={statusOf} onContextMenu={openContext} />;

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
    if (tabs.some((t) => t.runtime?.state.status === 'running' || t.runtime?.state.status === 'paused')) {
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
        const o = applyEdit(t.history, C.renameProject(t.history.present, n), '프로젝트 이름 변경', !!(t.runtime && t.runtime.state.status !== 'idle'));
        if (o.error) { say(o.error, true); return; }
        updTab(key, (x) => ({ ...x, history: o.history, runtime: null })); setNameDlg(null); say(`프로젝트 이름을 「${n}」(으)로 바꿨습니다 — 저장하면 목록에 반영됩니다`);
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
        { label: '영구 삭제', danger: true, run: () => { const r = W.deleteSavedProject(kv, reg, id); if (!r.ok) { say(r.reason, true); return; } dropDraft(id); setReg(r.reg); say(`「${e.name}」을(를) 삭제했습니다`); } }] }); };
  /** N03: switching projects while this project runs → pause its run first (state kept, no auto resume). */
  const switchTab = (key: string) => {
    if (key !== tab.key) {
      if (rt?.status === 'running') {
        say(`${p.name}: 실행을 일시정지하고 전환했습니다 (돌아와서 재개 가능, 자동 재개 없음)`);
      }
      setActiveKey(key); setSelection([]); setConnectFrom(null);
    }
    setView((v) => ({ ...v, home: false }));
  };
  const savedList = kv ? W.listProjects(kv, reg, reg.activeId) : [];
  const savedById = new Map(savedList.map((e) => [e.id, e]));
  const unsavedDrafts = drafts.filter((d) => !savedById.has(d.id));
  const savedForLine = tab.savedRevision !== null && tab.savedAt ? { revision: tab.savedRevision, savedAt: tab.savedAt } : null;
  const draftMeta = drafts.find((d) => d.id === p.id) ?? null;
  const draftShown = tab.draftAt ?? (draftMeta && savedForLine && draftOffersRecovery(draftMeta, savedForLine) ? draftMeta.savedAt : null);
  const workTimes = workTimesLabel(tab.savedAt, tab.draftError ? null : draftShown, tab.draftError);
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
    {explorerOpen && <PanelSplit kind="explorer" value={view.panels.explorer} onChange={(n) => setPanel('explorer', n)} label="탐색기 너비" />}
    <div className="exhead"><button className="small icon" onClick={toggleExplorer} aria-expanded={explorerOpen} aria-label={explorerOpen ? '탐색기 접기' : '탐색기 펼치기'} title={explorerOpen ? '탐색기 접기' : '탐색기 펼치기'}>{explorerOpen ? '⟨' : '⟩'}</button>{explorerOpen && <b>탐색기</b>}</div>
    {explorerOpen && <Tabs label="탐색기" idBase="explorer" value={view.explorerTab} onChange={openExplorerTab} tabs={[
      { id: 'workspace', label: 'Workspace', panel: workspacePanel },
      { id: 'project', label: 'Project', panel: projectPanel },
    ]} />}
  </aside>;
  const visualToggle = <>
    <button className={view.visualMode === 'schematic' ? 'on' : ''} onClick={() => setView({ ...view, visualMode: 'schematic' })}>도식</button>
    <button className={view.visualMode === 'photo' ? 'on' : ''} onClick={() => setView({ ...view, visualMode: 'photo' })} title="AI 생성 실사풍 이미지 표시 — 실제 촬영 사진 아님 (모델·연결·상태 불변)">실사풍(AI)</button></>;
  const runControls = <>
    <button className="primary" data-jump="run-start" data-tour="run" onClick={doRun} disabled={running || rt?.status === 'paused'}>▶ 실행</button>
    <button onClick={doPause} disabled={!running}>❚❚ 일시정지</button>
    <button onClick={doResume} disabled={rt?.status !== 'paused'}>재개</button>
    <button onClick={doStep} disabled={rt?.status !== 'paused'} title="일시정지 중 가상 0.1초 진행">+0.1s</button>
    <button onClick={doReset} disabled={!tab.runtime || rt?.status === 'idle'}>⟲ 초기화</button>
    <button onClick={doToEnd} disabled={!running} title="실행 중(▶ 실행 후)에만 활성 — 남은 단계를 즉시 계산">끝까지</button>
    <select aria-label="배속" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} title="화면 재생 속도 (논리 결과에 영향 없음)">{[0.25, 0.5, 1, 2, 4].map((s) => <option key={s} value={s}>{s}x</option>)}</select>
    <span className="mono" style={{ minWidth: 80 }}>{fmtTime(rt?.timeMs ?? 0)}</span></>;
  const setRunView = (runView: 'diagram' | '3d') => { setHelpScope('main'); setView((v) => (v.runView === runView ? v : { ...v, runView })); };
  const runSession = `${tab.key}:${step}`;
  if (step === 'run') {
    if (!durationBaseline.current || durationBaseline.current.sessionKey !== runSession) {
      durationBaseline.current = {
        sessionKey: runSession,
        depth: tab.history.past.length,
        snap: p.actions.map((a) => ({
          id: a.id,
          value: a.duration.value,
          assumption: a.duration.assumption,
          timeout: a.timeout.value,
          timeoutAssumption: a.timeout.assumption,
        })),
      };
    }
  } else if (durationBaseline.current) durationBaseline.current = null;
  const canRevertDurations = !!durationBaseline.current && p.actions.some((a) => {
    const snap = durationBaseline.current?.snap.find((s) => s.id === a.id);
    return !!snap && (snap.value !== a.duration.value || snap.timeout !== a.timeout.value);
  });
  const runViewToggle = <div role="radiogroup" aria-label="실행 보기">
    <button type="button" role="radio" aria-checked={view.runView === 'diagram'} className={view.runView === 'diagram' ? 'on' : ''} onClick={() => setRunView('diagram')}>도면</button>
    <button type="button" role="radio" aria-checked={view.runView === '3d'} className={view.runView === '3d' ? 'on' : ''} onClick={() => setRunView('3d')}>3D</button>
  </div>;
  const scene3d = view.runView === '3d' ? presentScene(p, rt, equipmentMotion) : null;
  const activeDeviceIds = runningIds;
  const onZoomChange = (z: number) => setView((v) => (Math.abs(v.zoom - z) < 0.001 ? v : { ...v, zoom: z }));
  const onMinimapChange = (frame: 'layout' | 'run', open: boolean) => setView((v) => (v.minimap[frame] === open ? v : { ...v, minimap: { ...v.minimap, [frame]: open } }));
  const connectNote = connectFrom ? `연결 시작: ${connectStartLabel(p, connectFrom)}. Esc로 취소합니다.` : null;
  const runCanvasEl = <Canvas frame="run" project={p} rt={rt} activeDeviceIds={activeDeviceIds.length ? activeDeviceIds : undefined} faultDeviceIds={faultIds.length ? faultIds : undefined} interlockDeviceIds={interlockIds.length ? interlockIds : undefined} view={view} selection={selection} mode={mode} connectFrom={connectFrom} locked={locked}
    onSelect={(ids) => setSelection(ids)} onMoveCommit={onMoveCommit} onResizeCommit={onResizeCommit} onDropAsset={onDropAsset} onPortClick={onPortClick}
    onSignalConnect={onSignalConnect} onFlowConnect={onFlowConnect} onConnectCancel={onConnectCancel} onContextMenu={openContext} fitToken={fitToken}
    onUnitConnectClick={onUnitConnectClick} onBlocked={(m) => say(m, true)} onZoomChange={onZoomChange} onMinimapChange={onMinimapChange} connectNote={connectNote} />;
  const canvasEl = <Canvas project={p} rt={rt} view={view} selection={selection} mode={mode} connectFrom={connectFrom} locked={locked}
    onSelect={(ids) => setSelection(ids)} onMoveCommit={onMoveCommit} onResizeCommit={onResizeCommit} onDropAsset={onDropAsset} onPortClick={onPortClick}
    onSignalConnect={onSignalConnect} onFlowConnect={onFlowConnect} onConnectCancel={onConnectCancel} onContextMenu={openContext} fitToken={fitToken}
    onUnitConnectClick={onUnitConnectClick} onBlocked={(m) => say(m, true)} onZoomChange={onZoomChange} onMinimapChange={onMinimapChange} connectNote={connectNote} />;
  const menuNodes = selection.filter((id) => p.units.some((u) => u.id === id) || p.devices.some((d) => d.id === id));
  const menuItems = ctx ? buildContextMenu({
    surface: ctx.surface,
    kind: ctx.kind,
    locked,
    pasteReason: pasteBlockReason(locked, !!clip, selection.filter((id) => p.units.some((u) => u.id === id)).length),
    canArrange: 'unitId' in arrangeTarget,
    arrangeReason: 'unitId' in arrangeTarget ? undefined : arrangeTarget.reason,
    unitCount: menuNodes.filter((id) => p.units.some((u) => u.id === id)).length,
    allUnits: menuNodes.length >= 2 && menuNodes.every((id) => p.units.some((u) => u.id === id)),
    canViewProps: selection.some((id) => p.units.some((u) => u.id === id) || p.devices.some((d) => d.id === id) || p.connections.some((c) => c.id === id)),
  }) : [];
  const inspectorEl = <Inspector project={p} selectedId={selectedId} locked={locked} gaps={tab.gaps} edit={edit} onAddStep={(id) => edit(C.addStep(p, id), '단계 추가')}
    onDelete={requestDelete} confirmDelete={confirmDelete} onReparent={requestReparent} tab={rightTab} setTab={pickRight} visualMode={view.visualMode} />;

  const screen = screenOf({ home: !!view.home, step, sub, rightTab, runMode, groupBlocked: false, stationError: rt?.status === 'error' || (rt?.blockers.length ?? 0) > 0, libDetail, guide });
  const onThemeKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); chooseTheme('dark'); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); chooseTheme('light'); }
  };
  const macShortcut = usesMacShortcut();
  const commandState: CommandState = {
    step, home: !!view.home, locked, running, paused: rt?.status === 'paused',
    idle: !rt || rt.status === 'idle', hasRuntime: !!tab.runtime,
    canUndo: tab.history.past.length > 0, canRedo: tab.history.future.length > 0,
    project: p, selection, hasClip: !!clip, flowPicked,
    appearance, showNames, explorerOpen, minimapLayout: view.minimap.layout, minimapRun: view.minimap.run,
    tourSeen: view.tourSeen,
  };
  const commandActions: CommandActions = {
    goStep,
    setLayoutTab: openLayoutTab,
    setRunView,
    save: doSave,
    exportJson: () => download(`${p.name.replace(/[^\w가-힣-]+/g, '_')}.ecd.json`, serializeProject(p)),
    importJson: () => fileRef.current?.click(),
    newProject,
    undo: doUndo,
    redo: doRedo,
    copy: requestCopy,
    paste: requestPaste,
    duplicate: requestDuplicate,
    deleteSelection: () => {
      if (selectedNodeIds.length >= 2) requestDeleteMany(selectedNodeIds);
      else if (selectedNodeIds.length === 1) requestDelete(selectedNodeIds[0]);
      else if (selection.length === 1) requestDelete(selection[0]);
    },
    selectAll: () => {
      const hit = selectAll(p, selection);
      if ('keep' in hit) say(hit.message, true);
      else setSelection(hit.ids);
    },
    align: (mode) => { edit(C.alignNodes(p, selection, mode), mode === 'left' ? '왼쪽 정렬' : '위 정렬'); },
    distribute: (axis) => runArrange(C.distributeUnits(p, selection, axis), axis === 'x' ? '가로 간격 같게' : '세로 간격 같게'),
    matchSize: (axis) => runArrange(C.matchUnitSize(p, selection, axis), axis === 'w' ? '너비 같게' : '높이 같게'),
    spread: () => runArrange(C.spreadUnits(p, selection, C.UNIT_SPREAD_GAP), '겹침 풀기'),
    arrangeDevices: arrangeSelectedDevices,
    fitUnit: fitSelectedUnit,
    connectMode: (next) => { setMode(next); setConnectFrom(null); if (next === 'signal') openLayoutTab('diagram'); },
    wrapFlow: (kind) => {
      const label = kind === 'branch' ? '분기로 묶기' : kind === 'parallel' ? '병렬로 묶기' : kind === 'loop' ? '반복으로 묶기' : '재시도로 묶기';
      if (edit(C.wrapFlow(p, flowPicked, kind), label)) setFlowPicked([]);
    },
    unwrapFlow: () => { const id = flowPicked[0]; if (id) edit(C.unwrapFlow(p, id), '블록 풀기'); },
    addWait: () => { edit(C.addWaitNode(p), '신호 기다림 추가'); },
    addSubstation: () => {
      const unitId = p.units.find((u) => selection.includes(u.id))?.id ?? p.units[0]?.id;
      if (unitId) edit(C.addSubstationNode(p, unitId), 'Substation 시퀀스 넣기');
    },
    run: doRun,
    pause: doPause,
    resume: doResume,
    stepTime: doStep,
    reset: doReset,
    toEnd: doToEnd,
    fitView: () => setFitToken((n) => n + 1),
    theme: chooseTheme,
    toggleNames: () => setShowNames((v) => !v),
    toggleMinimap: () => {
      const frame = step === 'run' ? 'run' : 'layout';
      onMinimapChange(frame, !view.minimap[frame]);
    },
    toggleExplorer,
    openViewSettings: () => setViewOpen(true),
    startTour: () => beginTour(document.querySelector<HTMLElement>('[aria-label="명령 찾기"]')),
    openShortcuts: () => setShortcutOpen(true),
    openPalette: () => setPaletteOpen(true),
  };
  const runCommand = (id: string) => {
    const cmd = commandById(id);
    if (!cmd || !cmd.available(commandState).ok) return;
    setPaletteOpen(false);
    setShortcutOpen(false);
    cmd.run(commandActions, commandState);
  };

  const helpId = resolveHelpId({
    scope: helpScope, home: !!view.home, explorer: view.explorerTab, step, sub, layout: view.layoutTab,
    right: rightTab, runView: view.runView, runBlocked: screen === 'S62', libDetail,
  });
  const closeHelp = () => setView((v) => (v.helpOpen ? { ...v, helpOpen: false } : v));
  return (
    <TermHintsProvider value={view.termHints}>
    <div className={`app ${explorerOpen ? '' : 'ex-collapsed'} ${view.home ? 'is-home' : ''} ${view.helpOpen ? 'help-open' : ''}`} style={style} data-theme={view.theme} data-appearance={appearance} data-step={step} data-screen={screen}>
      <header className="header">
        <span className="brand" aria-label={`${PRODUCT_NAME} ${APP_VERSION}`}><BrandMark /><span className="title">{PRODUCT_NAME}</span></span>
        <span className="subtitle">논리 시뮬레이션</span>
        <span className="grow" />
        <button type="button" className="btn-main secondary cmd-open" aria-label="명령 찾기" onClick={() => setPaletteOpen(true)}>
          명령 찾기<span className="cmd-key">{shortcutText(commandById('palette')!, macShortcut)}</span>
        </button>
        <button className="btn-main primary" data-jump="save" onClick={doSave} aria-label={dirty ? '저장, 저장 안 됨' : '저장'}>저장{dirty ? <span className="save-dot" aria-hidden="true" /> : null}</button>
        <button className="btn-main secondary" onClick={() => download(`${p.name.replace(/[^\w가-힣-]+/g, '_')}.ecd.json`, serializeProject(p))}>내보내기</button>
        <button className="btn-main secondary" onClick={() => setViewOpen(true)}>보기 설정</button>
        <button type="button" className="btn-main secondary" data-help-toggle aria-expanded={view.helpOpen} aria-label="도움말" onClick={(e) => { helpReturn.current = e.currentTarget; setView((v) => ({ ...v, helpOpen: !v.helpOpen })); }}><span className="help-mark" aria-hidden="true">?</span>도움말</button>
        <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportFile(f); e.target.value = ''; }} />
        <button className="icon" onClick={doUndo} disabled={!tab.history.past.length || locked} title="실행 취소 (Ctrl/Cmd+Z)" aria-label="실행 취소"><HistoryIcon dir="undo" /></button>
        <button className="icon" onClick={doRedo} disabled={!tab.history.future.length || locked} title="다시 실행 (Ctrl/Cmd+Shift+Z)" aria-label="다시 실행"><HistoryIcon dir="redo" /></button>
      </header>
      <div className="workbar" aria-label="현재 작업">
        <button type="button" className="work-crumb" onClick={() => openExplorerTab('workspace')}><Terms text="Workspace" /> {curWs.name}</button>
        <span className="work-sep" aria-hidden="true">›</span>
        <button type="button" className="work-crumb" onClick={() => openExplorerTab('project')}>Project {p.name}</button>
        <span className="work-rev"><Terms text="rev" /> {p.revision}</span>
        <span className={dirty ? 'save-chip dirty' : 'save-chip saved'}>{dirty ? '● 저장 안 됨' : '저장됨'}</span>
        {workTimes && <span className="work-times">{workTimes}</span>}
      </div>
      <div className="stepper" role="navigation" aria-label="단계" data-tour="stepbar">
        {STEPS.map((s) => { const b = stepBadge(evals[s.id], confirmed[s.id]); const n = evals[s.id].items.length; const on = !view.home && step === s.id; return (
          <div key={s.id} className={`st ${on ? 'on' : ''}`} data-stepid={s.id} onClick={(e) => { if ((e.target as HTMLElement).closest('[data-step-badge]')) return; goStep(s.id); }}>
            <button type="button" className="st-go" aria-current={on ? 'step' : undefined}>{s.no} <Terms text={s.label} /></button>
            <button type="button" className={`badge st-badge status-${WIZARD_BADGE_STATUS[b]}`} data-step-badge={s.id} data-status={WIZARD_BADGE_STATUS[b]} aria-haspopup="dialog" aria-expanded={itemsStep === s.id}
              aria-label={`${s.no} ${s.label} ${BADGE_WORD[b]}, 남은 항목 ${n}`}
              onClick={(e) => { e.stopPropagation(); toggleItems(s.id); }}
              onKeyDown={(e) => onItemKey(e, () => toggleItems(s.id))}>
              <span aria-hidden="true">{BADGE_MARK[b]}</span>
              <span className="st-word">{BADGE_WORD[b]}</span>
              <span className="st-count">{n}</span>
            </button>
          </div>); })}
        <div className="theme-toggle" role="radiogroup" aria-label="테마" onKeyDown={onThemeKey}>
          <button role="radio" aria-checked={appearance === 'light'} aria-label="라이트 테마" className={appearance === 'light' ? 'on' : ''} data-theme-choice="light" onClick={() => chooseTheme('light')}>라이트</button>
          <button role="radio" aria-checked={appearance === 'dark'} aria-label="다크 테마" className={appearance === 'dark' ? 'on' : ''} data-theme-choice="dark" onClick={() => chooseTheme('dark')}>다크</button>
        </div>
      </div>
      {explorer}
      {listEval && listMeta && <div className="itemspop" style={style} role="dialog" aria-label={`${listMeta.no} ${listMeta.label} 남은 항목`} data-items-step={listMeta.id}>
        <div className="row" style={{ justifyContent: 'space-between' }}><b>{listMeta.no} {listMeta.label} — 남은 항목 (실제 데이터 기준 재계산)</b><button className="small" onClick={() => setItemsStep(null)}>닫기</button></div>
        {listEval.items.length === 0 && <div className="muted">남은 항목 없음</div>}
        {listEval.items.map((it, i) => <div key={i} className="item-row" data-item-kind={it.kind}>
          <StatusMark status={ITEM_LEVEL_STATUS[it.level].status} word={ITEM_LEVEL_STATUS[it.level].word} />
          {it.jump
            ? <button type="button" className="item-jump" onClick={() => goItem(it)} onKeyDown={(e) => onItemKey(e, () => goItem(it))}>{it.text}</button>
            : <span className="item-jump-text">{it.text}</span>}
          <span className="item-go">{jumpCaption(it.jump)}</span>
        </div>)}
        {itemsStep && confirmed[itemsStep] && confirmed[itemsStep] !== listEval.fingerprint && <div className="notice warn">이 단계는 이전에 확인되었지만 관련 데이터가 바뀌었습니다 — 재확인 필요</div>}
      </div>}

      {guide === 'files' && <div className="workspace ws-full"><div className="bbody sparse-page"><button type="button" onClick={() => setGuide(null)}>닫기</button><FilesSheet entries={savedList.map((e) => ({ id: e.id, name: e.name, revision: e.revision }))} onImport={() => fileRef.current?.click()} onExport={() => download(`${p.name}.json`, serializeProject(p))} onOpen={(id) => { setGuide(null); openSaved(id); }} onNew={() => { setGuide(null); newProject('blank'); }} onSample={() => { setGuide(null); newProject('sample'); }} /></div></div>}
      {guide === 'bundle' && <div className="workspace ws-full"><div className="bbody sparse-page"><button type="button" onClick={() => setGuide(null)}>닫기</button><BundleSheet kv={kv} reg={reg} dirtyNames={tabs.filter((t) => t.savedRevision !== t.history.present.revision).map((t) => t.history.present.name)} openIds={[...openIds]} storageReason={kv ? null : storage.reason ?? '저장소 없음'} onDownload={(name, text) => download(name, text)} onCommitted={(r) => { setReg(r.reg); if (r.quarantine.length) setQlist((list) => r.quarantine.reduce((acc, entry) => quarantine(kv, entry, acc), list)); }} onSwitch={requestSwitch} /></div></div>}
      {guide === 'search' && <div className="workspace ws-full"><div className="bbody sparse-page"><button type="button" onClick={() => setGuide(null)}>닫기</button>
        <SearchSheet tabs={tabs.map((t) => ({ key: t.key, name: t.history.present.name, active: t.key === tab.key }))}
          tree={p.units.flatMap((u) => [{ id: u.id, label: u.name, depth: 0 }, ...u.deviceIds.map((id) => ({ id, label: devName(p, id), depth: 1 }))])}
          onTab={(key) => switchTab(key)} onPick={(id) => { setSelection([id]); setGuide(null); goStep('canvas'); }} onFold={() => setView((v) => ({ ...v, explorerOpen: false }))} onCanvas={() => { setGuide(null); goStep('canvas'); }} />
      </div></div>}

      {!guide && view.home && <div className="workspace home-main">
        <h1>어떤 장비를 설계할까요?</h1>
        <p className="muted">현재 Workspace 「{curWs.name}」에서 새로 시작하거나 저장된 설계를 이어갑니다.</p>
        <div className={`home-tour${savedList.length === 0 && !view.tourSeen ? ' is-primary' : ''}`}>
          {savedList.length === 0 && !view.tourSeen && <p>일곱 걸음 안에 1~6단계가 하는 일을 보고, 예제를 실행해 볼 수 있습니다.</p>}
          <button type="button" className={`btn-main tour-cta ${savedList.length === 0 && !view.tourSeen ? 'primary' : 'secondary'}`}
            data-tour-start data-tour-offer={savedList.length === 0 && !view.tourSeen ? 'primary' : view.tourSeen ? 'again' : 'quiet'}
            onClick={(e) => beginTour(e.currentTarget)}>{view.tourSeen ? TOUR_AGAIN : TOUR_BUTTON}</button>
        </div>
        <div className="home-cards">
          <section className="home-card">
            <h2>새 설계 시작</h2>
            <p>자료가 없어도 시작할 수 있습니다.<br />에셋 선택부터 단계별로 안내합니다.</p>
            <button className="btn-main primary" onClick={() => newProject('blank')}>빈 프로젝트 만들기</button>
          </section>
          <section className="home-card">
            <h2>예제로 익히기</h2>
            <p>5공정 조립 라인 · 병렬 시퀀스 · 분기와 반복<br />실제 장비가 아닌 논리 실행 예제입니다.</p>
            <div className="row"><button className="btn-main primary" onClick={() => newProject('sample')}>예제 열기</button>
              <button className="btn-main secondary" onClick={() => newProject('parallel')}>병렬 예제</button>
              <button className="btn-main secondary" onClick={() => newProject('flow')}>흐름 예제</button></div>
          </section>
        </div>
        {unsavedDrafts.length > 0 && <h2>저장 안 된 작업</h2>}
        {unsavedDrafts.map((d) => <div key={d.id} className="home-recent" data-unsaved-draft={d.id}>
          <div><b>{d.name}</b><div className="muted">rev {d.revision} · 임시 저장 {formatClock(d.savedAt)}</div></div>
          <button type="button" className="btn-main danger" aria-label={`${d.name} 임시 저장 버리기`} onClick={() => dropDraft(d.id)}>버리기</button>
          <button type="button" className="btn-main primary" aria-label={`${d.name} 임시 저장 열기`} onClick={() => openDraft(d.id)}>열기</button>
        </div>)}
        <h2>최근 프로젝트</h2>
        {savedList.length === 0 && <EmptyState symbol="○" line={EMPTY.projects} actions={[{ label: '새 프로젝트', onClick: () => newProject('blank') }, { label: '예제', onClick: () => newProject('sample') }]} />}
        {savedList.slice(0, 6).map((e) => <div key={e.id} className="home-recent">
          <div><b>{e.name}</b><div className="muted">rev {e.revision} · {e.savedAt ? new Date(e.savedAt).toLocaleString() : '저장 시각 없음'}</div></div>
          <button className="btn-main secondary" onClick={showOpen}>프로젝트 관리</button>
          <button className="btn-main primary" onClick={() => openSaved(e.id)}>계속하기</button>
        </div>)}
        <p className="muted">JSON 가져오기: 원본은 덮어쓰지 않고 새 탭으로 엽니다. Workspace 묶음은 「파일 묶음」에서 가져옵니다.</p>
      </div>}

      {!guide && !view.home && step === 'library' && <div className="workspace ws-full">
        <Sub items={[['cards', '에셋 라이브러리'], ['input', '입력 후보표 (F1)'], ['aml', 'AML 입출력'], ['extract', '자료 입력']]} />
        {sub === 'input' ? <div className="bbody sparse-page"><h1 className="stage-title"><Terms text="입력 후보표" /></h1><p className="muted">후보는 확인 전에 모델에 들어가지 않습니다.</p><section className="sheet wide"><InputHubPanel p={p} locked={locked} edit={edit} /></section></div>
          : sub === 'aml' ? <div className="bbody sparse-page"><h1 className="stage-title"><Terms text="AML 입출력 결과" /></h1><AmlResultSheet onCandidates={() => { setHelpScope('main'); setSubTab((t) => ({ ...t, library: 'input' })); }} /></div>
          : sub === 'extract' ? <div className="bbody sparse-page"><h1 className="stage-title"><Terms text="자료 입력" /></h1><ExtractSheet onInstead={() => { setHelpScope('main'); setSubTab((t) => ({ ...t, library: 'input' })); }} /><Fold className="fold-panel" summary="기존 안내"><ExtractPanel /></Fold></div>
          : <LibraryWorkspace p={p} locked={locked} mode={view.visualMode} filter={view.libraryFilter} libVersion={libVersion} detail={libDetail} setDetail={setLibDetail}
            detailWidth={view.panels.library} onDetailWidth={(n) => setPanel('library', n)}
            setFilter={(f) => setView({ ...view, libraryFilter: f })} setMode={(m) => setView({ ...view, visualMode: m })}
            onAdd={onAddFromLibrary} onImportAml={onImportAml} onExportAml={() => download('ecd-library-export.aml', exportLibraryAml(), 'application/xml')} />}
      </div>}

      {!guide && !view.home && step === 'canvas' && <div className="workspace ws-canvas">
        <PanelSplit kind="canvas" value={view.panels.canvas} onChange={(n) => setPanel('canvas', n)} label="속성 패널 너비" />
        <div className="stage layout-stage">
          <div className="stage-head">
            <h1 className="stage-title"><span data-tour="canvas"><Terms text="배치·연결" /></span></h1>
            <div className="tool-pills">
              <button className={mode === 'select' ? 'on' : ''} onClick={() => { setMode('select'); setConnectFrom(null); }}>선택/이동</button>
              <button className={mode === 'flow' ? 'on' : ''} onClick={() => { setMode('flow'); setConnectFrom(null); }} title="Unit → Unit 물류 흐름 연결"><Terms text="물류 연결" /></button>
              <button className={mode === 'signal' ? 'on' : ''} onClick={() => { setMode('signal'); setConnectFrom(null); openLayoutTab('diagram'); }} title="출력 포트를 입력 포트로 끌어 연결합니다. 이 모드에서는 두 번 눌러서도 됩니다. 포트는 도면 도식 탭에 있습니다"><Terms text="신호 연결" /></button>
              <div className="layerbox"><button className={layerOpen ? 'on' : ''} onClick={() => setLayerOpen(!layerOpen)}>레이어</button>
                {layerOpen && <div className="layerpop">{([['background', '배경'], ['units', 'Substation'], ['axis', '축·이송'], ['io', '포트·신호선'], ['positions', '포지션'], ['flow', '물류·자재']] as [LayerId, string][]).map(([k, l]) =>
                  <label key={k}><input type="checkbox" checked={L[k]} onChange={(e) => setView({ ...view, layers: { ...L, [k]: e.target.checked } })} /> {l}</label>)}
                  <div className="muted">숨김은 삭제가 아니고 실행에서도 빼지 않습니다.</div></div>}</div>
              <span className="zoom-pill"><button type="button" aria-label="축소" onClick={() => setView({ ...view, zoom: Math.max(0.5, +(view.zoom - 0.1).toFixed(2)) })}>−</button><span>{Math.round(view.zoom * 100)}%</span><button type="button" aria-label="확대" onClick={() => setView({ ...view, zoom: Math.min(2, +(view.zoom + 0.1).toFixed(2)) })}>+</button></span>
            </div>
          </div>
          <p className="palette-hint">팔레트: 빈 유닛 / 푸셔 / 실린더 / 센서 / 유닛 템플릿. 카드를 끌어 다른 Substation에 놓으면 소속이 바뀝니다.</p>
          <Fold className="palette-fold" open={view.paletteOpen} onToggle={(open) => setView((v) => (v.paletteOpen === open ? v : { ...v, paletteOpen: open }))} summary={<><span className="fold-closed">팔레트 펼치기 ({ASSET_LIBRARY.length}종 + 빈 유닛)</span><span className="fold-open">팔레트 ({ASSET_LIBRARY.length}종 + 빈 유닛)</span>{paletteHidden > 0 && <span className="palette-more" data-palette-more={paletteHidden}>+{paletteHidden}개 더</span>}</>}>
            <div className="palette" ref={paletteRef}>
              <div className="pi" data-jump="palette-unit" draggable onDragStart={(e) => e.dataTransfer.setData('application/x-ecd-asset', 'unit')}><PaletteIcon kind="unit" />빈 유닛</div>
              {ASSET_LIBRARY.map((a) => <div key={a.kind} className="pi" data-jump={!a.template && a.kind === ASSET_LIBRARY.find((x) => !x.template)?.kind ? 'palette-device' : undefined} draggable onDragStart={(e) => e.dataTransfer.setData('application/x-ecd-asset', a.kind)} title={`${a.id}@${a.version}`}><PaletteIcon kind={a.kind} />{a.name}</div>)}
            </div>
          </Fold>
          <div className="layout-tabs">
            <Tabs label="배치·연결" idBase="layout" value={view.layoutTab} onChange={openLayoutTab} tabs={[
              { id: 'board', label: '카드 보드', panel: <>
                <div className="copy-tools">{copyPasteButtons()}</div>
                <LayoutBoard project={p} selection={selection} mode={mode} locked={locked}
                  onSelect={(ids) => setSelection(ids)} onDropAsset={onDropAsset} onUnitConnectClick={onUnitConnectClick}
                  onSignalHint={() => say('신호 연결은 도면 도식 탭의 포트에서 합니다')} onReparent={requestReparent}
                  connectNote={connectNote} onContextMenu={openContext}
                  onFocusUnit={() => showPalette('palette-unit')} onFocusDevice={() => showPalette('palette-device')}
                  onStartFlow={() => { setMode('flow'); setConnectFrom(null); }} />
                <p className="path-note">{p.connections.some((c) => c.kind === 'flow') ? <>{flowSummary(p)}<br /></> : null}카드는 실제 Substation·Device입니다. 좌표·포트·신호선은 도면 도식 탭에서 움직입니다. 정밀 물리 검증은 아닙니다.</p>
              </> },
              { id: 'diagram', label: '도면 도식', panel: <>
                <div className="diagram-tools">
                  <p className="diagram-hint" title={`Shift + 끌기: 여러 개 고르기 · ${SELECT_HINT}`}>물류: Unit 오른쪽 손잡이를 다른 Unit으로 끌기 · 신호: 출력● 포트를 입력○ 포트로 끌어 연결 · 장치 이동은 몸체를 끌기 · Shift + 끌기: 여러 개 고르기<br />{SELECT_HINT}</p>
                  {visualToggle}
                  <button onClick={() => edit(C.alignNodes(p, selection, 'left'), '왼쪽 정렬')} disabled={selection.length < 2 || locked}>좌 정렬</button>
                  <button onClick={() => edit(C.alignNodes(p, selection, 'top'), '위 정렬')} disabled={selection.length < 2 || locked}>상 정렬</button>
                  <div className="layerbox arrange-menu">
                    <button type="button" className={arrangeOpen ? 'on' : ''} aria-expanded={arrangeOpen} aria-haspopup="menu" aria-controls="arrange-menu" title="고른 Unit의 간격·크기·겹침" onClick={() => setArrangeOpen((v) => !v)}>배치 ▾</button>
                    {arrangeOpen && <div className="layerpop arrange-pop" id="arrange-menu" role="menu">
                      {arrangeItems.map((item) => {
                        const reason = selectedUnitCount < item.min ? (item.min >= 3 ? C.ARRANGE_NEED_3 : C.ARRANGE_NEED_2) : undefined;
                        return <button key={item.label} type="button" role="menuitem" disabled={!!reason} title={reason} onClick={() => runArrange(item.run(), item.undo)}>{item.label}</button>;
                      })}
                    </div>}
                  </div>
                  <button type="button" onClick={fitSelectedUnit} disabled={!(selection.length === 1 && p.units.some((u) => u.id === selection[0]))}>크기 맞춤</button>
                  <button type="button" onClick={arrangeSelectedDevices} disabled={locked || !('unitId' in arrangeTarget)} title={arrangeDevicesTitle}>자동 정렬</button>
                  {copyPasteButtons()}
                  <button type="button" onClick={requestDuplicate} disabled={selectedDeviceIds.length === 0 || locked} title={selectedDeviceIds.length === 0 ? C.DUPLICATE_NEED_DEVICE : locked ? '실행 중에는 복제가 차단됩니다' : '선택한 Device 복제 (Ctrl+D)'}>복제</button>
                  <button type="button" className="danger" onClick={() => { if (selectedNodeIds.length >= 2) requestDeleteMany(selectedNodeIds); else if (selectedNodeIds.length === 1) requestDelete(selectedNodeIds[0]); else if (selection.length === 1) requestDelete(selection[0]); }} disabled={locked || (selectedNodeIds.length === 0 && !(selection.length === 1 && p.connections.some((c) => c.id === selection[0])))}>삭제</button>
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
              return <p key={pd.key}>{pd.label}<br />{qv.value === null ? <StatusMark status="undetermined" /> : qv.value} {qv.unit}{qv.assumption ? <> <StatusMark status="assumption" /></> : null}</p>;
            })}
            {!d && host && <button type="button" className="btn-main secondary" onClick={fitSelectedUnit}>크기 맞춤</button>}
            {missingComplete && <p className="warn-note"><StatusMark status="undetermined" /> 완료 신호 · 실행 차단<br />필수 값은 임의로 채우지 않습니다.</p>}
            <div className="prop-actions">
              <button type="button" className="btn-main primary" disabled={!d} onClick={() => { if (!d) return; setSelection([d.id]); pickRight('actions'); goStep('attributes'); }}>Action 편집</button>
              <button type="button" className="danger" disabled={!selectedId || locked} onClick={() => selectedId && requestDelete(selectedId)}>삭제 영향 확인</button>
            </div>
            <Fold className="prop-more" summary="속성 자세히" open={propsFold} onToggle={setPropsFold}>{inspectorEl}</Fold>
          </div>;
        })()}</div></div>
      </div>}

      {!guide && !view.home && step === 'attributes' && <div className="workspace ws-full ws-noTabs">
        <div className="bbody sparse-page">
          <h1 className="stage-title"><span data-tour="attributes"><Terms text={rightTab === 'signals' || rightTab === 'positions' ? '신호와 포지션' : rightTab === 'actions' || rightTab === 'check' ? 'Action 정의' : '장치 속성'} /></span></h1>
          <p className="muted">기본 화면은 성긴 폼입니다. 신호·Action·정의 체크의 나머지 입력은 아래 접는 칸에 있습니다.</p>
          {(() => {
            const d = p.devices.find((x) => x.id === selectedId) ?? p.devices[0];
            const host = d ? p.units.find((u) => u.id === d.unitId) : undefined;
            const def = d ? findAsset(d.kind) : undefined;
            if (!d || !def) return <EmptyState symbol="○" line={EMPTY.devices} actions={[{ label: '팔레트에서 고르기', onClick: () => showPalette('palette-device') }]} />;
            const fields = def.properties.slice(0, 4);
            const sigs = p.signals.filter((s) => s.deviceId === d.id);
            const poss = p.positions.filter((x) => x.deviceId === d.id);
            const acts = p.actions.filter((a) => a.deviceId === d.id);
            const act = acts.find((a) => a.id === actionFocus) ?? acts[0];
            if (rightTab === 'signals' || rightTab === 'positions') return <div className="sparse-split">
              <section className="sheet">
                <h2>개념 신호 역할</h2>
                <table className="grid plain"><thead><tr><th>이름</th><th>방향</th><th>역할</th></tr></thead>
                  <tbody>{sigs.map((s) => <tr key={s.id}><td>{s.name}</td><td>{s.direction === 'in' ? '입력' : '출력'}</td><td>{signalRole(s.role)}</td></tr>)}
                    {sigs.length === 0 && <tr><td colSpan={3}>신호 없음</td></tr>}</tbody></table>
                <p className="field-ro">{sigs.find((s) => s.address)?.address ?? <><StatusMark status="undetermined" /> 실제 장비 주소 아님</>}</p>
                <button type="button" onClick={() => pickRight('actions')}>Action으로 복귀</button>
              </section>
              <aside className="sheet">
                <h2>포지션 정의</h2>
                {poss.map((x) => <label key={x.id}>{x.name}<span className="field-ro">{x.value.value === null ? <StatusMark status="undetermined" /> : x.value.value} {x.value.unit}{x.value.assumption ? <> <StatusMark status="assumption" /></> : null}</span></label>)}
                {poss.length === 0 && <p className="muted">포지션 없음</p>}
                <p className="warn-note">단위·방향·신호 참조는 보존합니다. 실주소와 실측 역매핑은 하지 않습니다.</p>
              </aside>
            </div>;
            if (rightTab === 'actions' || rightTab === 'check') return <div className="sparse-split" data-jump={`device:${d.id}`}>
              <section className="sheet">
                <h2>{act ? `${host?.code ?? ''} ${act.name}`.trim() : `${d.name} · Action 없음`}</h2>
                {act ? <div className="form-grid">
                  <label data-jump={`duration:${act.id}`}>동작 시간<QtyInput q={act.duration} disabled={locked} onCommit={(v, as) => edit(C.setQuantity(p, { kind: 'action', id: act.id, field: 'duration' }, v, as), '동작 시간')} /></label>
                  <label data-jump={`timeout:${act.id}`}><Terms text="타임아웃" /><QtyInput q={act.timeout} disabled={locked} onCommit={(v, as) => edit(C.setQuantity(p, { kind: 'action', id: act.id, field: 'timeout' }, v, as), '타임아웃')} /></label>
                  <label>명령 신호<span className="field-ro">{signalCaption(p, act.commandSignalId)}</span></label>
                  <label>완료 신호<span className="field-ro">{signalCaption(p, act.completeSignalId)}</span></label>
                  <label>사전 조건<span className="field-ro cond-line" data-jump={`pre:${act.id}`} data-cond-formula="">{conditionsFormula(p, act.pre) || '없음'}<ConditionMark p={p} site={`action:${act.id}:pre`} /></span></label>
                  <label>완료 후 조건<span className="field-ro cond-line" data-jump={`post:${act.id}`} data-cond-formula="">{conditionsFormula(p, act.post) || '없음'}<ConditionMark p={p} site={`action:${act.id}:post`} /></span></label>
                </div> : <p>이 Device에 Action이 없습니다. 아래 접는 칸에서 추가합니다.</p>}
                <div className="tool-pills">
                  <button type="button" className="on" disabled={!act || locked} onClick={() => act && edit(C.addStep(p, act.id), '단계 추가')}>시퀀스 끝에 추가</button>
                  <button type="button" onClick={() => pickRight('props')}>속성으로</button>
                </div>
              </section>
              <aside className="sheet">
                <h2>정의 체크와 사람 확인</h2>
                <ul className="check-list">
                  <li>완료 신호 · {act?.completeSignalId ? '지정됨' : <StatusMark status="undetermined" />}</li>
                  <li>동작 시간 · {act?.duration.value ?? <StatusMark status="undetermined" />}{act?.duration.assumption ? <> <StatusMark status="assumption" /></> : null}</li>
                  <li>타임아웃 · {act?.timeout.value ?? <StatusMark status="undetermined" />}{act?.timeout.assumption ? <> <StatusMark status="assumption" /></> : null}</li>
                  <li>실제 주소 · {sigs.some((s) => s.address) ? '있음' : <StatusMark status="undetermined" />}</li>
                </ul>
                <p className="warn-note">Interlock 후보는 사람이 확인합니다. 자동 안전 승인은 없습니다.</p>
                <button type="button" onClick={() => goStep('sequence', 'sequence')}>시퀀스 보기</button>
              </aside>
            </div>;
            return <div className="sparse-split" data-jump="device-props">
              <section className="sheet">
                <h2 data-jump={`device:${d.id}`}>{d.name} · 속성 편집</h2>
                <div className="form-grid">
                  <label>이름<TextInput value={d.name} disabled={locked} onCommit={(v) => edit(C.renameObject(p, d.id, v), 'Device 이름')} /></label>
                  <label>소속 Substation
                    <select disabled={locked} value={d.unitId} onChange={(e) => requestReparent(d.id, e.target.value)}>{p.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                  </label>
                  {fields.map((pd) => {
                    const qv = d.properties[pd.key];
                    if (!qv) return null;
                    return <label key={pd.key} data-jump={`prop:${d.id}:${pd.key}`}>{pd.label}
                      <QtyInput q={qv} disabled={locked} onCommit={(v, as) => edit(C.setDeviceProperty(p, d.id, pd.key, v, as), `${pd.label} 변경`)} />
                    </label>;
                  })}
                  <label>정의 버전<span className="field-ro">{d.definitionRef.assetId}@{d.definitionRef.version}</span></label>
                </div>
                <div className="tool-pills">
                  <button type="button" className="on" onClick={() => pickRight('actions')}>Action 편집</button>
                  <button type="button" onClick={() => pickRight('signals')}>신호·포지션</button>
                  <button type="button" className="danger" disabled={locked} onClick={() => requestDelete(d.id)}>삭제 영향 확인</button>
                </div>
              </section>
              <aside className="sheet">
                <h2>선택과 제공 능력</h2>
                <p>{host ? `${host.code} ${host.name}` : '소속 없음'} / {d.name}</p>
                <p className="muted">제공 Action</p>
                <ul className="check-list">{p.actions.filter((a) => a.deviceId === d.id).slice(0, 4).map((a) => <li key={a.id}>{a.name}</li>)}</ul>
                <button type="button" onClick={() => pickRight('check')}>정의 체크</button>
                <p className="muted">능력 표 전체는 아래 접는 칸에 있습니다.</p>
              </aside>
            </div>;
          })()}
          <InterlockPanel p={p} locked={locked} edit={edit} />
          <Fold className="fold-panel" summary="신호, 포지션, Action, 정의 체크 자세히">
            <div className="fold-body">{inspectorEl}</div>
          </Fold>
        </div>
      </div>}

      {!guide && !view.home && step === 'sequence' && <div className="workspace ws-full">
        <h1 className="stage-title"><span data-tour="sequence"><Terms text={sub === 'material' ? '자재와 흐름' : sub === 'subseq' ? 'Substation 시퀀스' : sub === 'sfc' ? 'SFC 미리보기' : sub === 'extend' ? '누락 편집 확장' : 'Station 시퀀스'} /></span></h1>
        <Sub items={[['sequence', 'Station 시퀀스 Draft (F5)'], ['subseq', `Substation 시퀀스 (${(p.substationSequences ?? []).length})`], ['material', '자재·Flow (F4)'], ['sfc', 'SFC 미리보기'], ['extend', '누락 편집 확장']]} />
        <div className="bbody sparse-page">
          {sub === 'sequence' && <section className="sheet wide">
            <div className="tool-pills">
              <button type="button" className="on" data-jump="sequence-add" onClick={() => { const a = p.actions[0]; if (a) edit(C.addStep(p, a.id), '단계 추가'); }}><Terms text="Action 추가" /></button>
              <button type="button" onClick={() => { setHelpScope('main'); setSubTab((t) => ({ ...t, sequence: 'sfc' })); }}><Terms text="SFC 미리보기" /></button>
              <button type="button" onClick={() => { setHelpScope('main'); setSubTab((t) => ({ ...t, sequence: 'subseq' })); }}><Terms text="Substation 시퀀스" /></button>
            </div>
            <h2 data-jump="sequence-steps"><Terms text="Station 시퀀스 Draft" /></h2>
            {p.sequence.steps.length === 0 && <EmptyState symbol="○" line={EMPTY.steps} actions={[{ label: '단계 추가', disabled: locked || !p.actions[0], reason: locked ? RUN_LOCK : !p.actions[0] ? 'Action이 없습니다. 3단계 Action을 먼저 만드세요.' : undefined, onClick: () => { const a = p.actions[0]; if (a) edit(C.addStep(p, a.id), '단계 추가'); } }]} />}
            {p.sequence.unresolved.length > 0 && <p className="warn-note" data-jump="sequence-unresolved">미해결: {p.sequence.unresolved.join(' · ')}</p>}
            <FlowEditor p={p} rt={rt} locked={locked} edit={edit} picked={flowPicked} onPicked={setFlowPicked} />
            <Fold className="fold-panel" summary="단계 편집, 구조화 문장, 순서 변경">
              <SequencePanel p={p} rt={rt} locked={locked} edit={edit} confirmDelete={confirmDelete} onSelect={(id) => { setSelection([id]); pickRight('actions'); goStep('attributes'); }} />
            </Fold>
          </section>}
          {sub === 'material' && <div className="sparse-split">
            <section className="sheet">
              <h2>{p.materials[0] ? `${p.materials[0].name} · 정의와 초기 조건` : '자재 없음'}</h2>
              {p.materials[0] ? <div className="form-grid">
                <label>이름<TextInput value={p.materials[0].name} disabled={locked} onCommit={(v) => edit(C.renameObject(p, p.materials[0].id, v), '자재 이름')} /></label>
                <label>투입 개수<input key={feedCountOf(p.materials[0])} type="number" aria-label="자재 화면 투입 개수" className="num" min={1} step={1} disabled={locked} defaultValue={feedCountOf(p.materials[0])} onBlur={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n !== feedCountOf(p.materials[0])) edit(C.setFeedCount(p, p.materials[0].id, n), '투입 개수'); else e.target.value = String(feedCountOf(p.materials[0])); }} /></label>
                <label data-jump="feed-interval">투입 간격<QtyInput q={p.materials[0].feedInterval} disabled={locked} onCommit={(v, as) => edit(C.setQuantity(p, { kind: 'material', id: p.materials[0].id, field: 'feedInterval' }, v, as), '투입 간격')} /></label>
                <label>초기 위치<span className="field-ro">{p.materials[0].initialLocation ? unitName(p, p.materials[0].initialLocation) : '미정'}</span></label>
                <label>초기 상태<span className="field-ro">{p.materials[0].initialState ?? '미정'}</span></label>
                <label>크기<span className="field-ro">{materialSize(p)}</span></label>
                <label>무게<span className="field-ro">{p.materials[0].weight.value ?? '미정'} {p.materials[0].weight.unit}{p.materials[0].weight.assumption ? ' · 가정' : ''}</span></label>
                <label>Unit 경로<span className="field-ro">{routeText(p)}</span></label>
              </div> : <EmptyState symbol="○" line={EMPTY.materials} actions={[{ label: '자재 추가', disabled: locked, reason: locked ? RUN_LOCK : undefined, onClick: () => edit(C.addMaterial(p), '자재 추가'), attrs: { 'data-jump': 'material-add' } }]} />}
              <button type="button" className="btn-main primary" onClick={() => { setHelpScope('main'); setSubTab((t) => ({ ...t, sequence: 'sequence' })); }}><Terms text="Station 시퀀스 작성" /></button>
            </section>
            <aside className="sheet">
              <h2>상태 전이</h2>
              <table className="grid plain"><thead><tr><th>상태</th><th><Terms text="완료 Action" /></th></tr></thead>
                <tbody>{p.actions.filter((a) => a.effect.setState || a.effect.moveTo).slice(0, 6).map((a) => <tr key={a.id}><td>{a.effect.setState ?? (a.effect.moveTo === 'EXIT' ? '배출' : a.effect.moveTo ? unitName(p, a.effect.moveTo) : a.name)}</td><td>{a.name}</td></tr>)}
                  {p.actions.every((a) => !a.effect.setState && !a.effect.moveTo) && <tr><td colSpan={2}>자재 변화가 있는 Action이 없습니다.</td></tr>}</tbody></table>
              <p className="warn-note">실행은 자재 정의 하나를 투입 개수만큼 이어서 넣습니다. 정의가 여러 종류이거나 캐리어에 싣는 것은 없습니다.</p>
            </aside>
            <Fold className="fold-panel" summary="자재 값과 경로 편집"><MaterialPanel p={p} locked={locked} edit={edit} /></Fold>
          </div>}
          {sub === 'subseq' && <section className="sheet wide">
            <h2><Terms text="Substation 시퀀스" /></h2>
            <SubSequencePanel p={p} unitId={subUnitId} setUnitId={(id) => setSubUnitPref(id)} locked={locked} edit={edit} confirmDelete={confirmDelete} gs={null} />
          </section>}
          {sub === 'sfc' && <section className="sheet wide"><h2><Terms text="SFC 미리보기" /></h2><p className="muted">분기 · 병렬 · 반복 · 재시도 · 신호 기다림 · Substation 단계를 읽기 전용으로 그립니다.</p><SfcPanel p={p} rt={rt} /></section>}
          {sub === 'extend' && <><ExtendSheet /><Fold className="fold-panel" summary="미구현 안내"><ExtendPanel /></Fold></>}
        </div>
      </div>}

      {!guide && !view.home && step === 'check' && <div className="workspace ws-full">
        <h1 className="stage-title"><span data-tour="check"><Terms text={sub === 'diag' ? '진단과 저장' : sub === 'export' ? 'Export 미리보기' : sub === 'lab' ? 'Evolution Lab' : 'Gap 점검'} /></span></h1>
        <Sub items={[['gap', `Gap (F6) ${tab.gaps.length + runGaps.length}`], ['diag', '진단·저장·AML'], ['export', 'Export 미리보기 (F8)'], ['lab', 'Evolution Lab (F7)']]} />
        <div className="bbody sparse-page">
          {sub === 'gap' && <section className="sheet wide">
            <div className="tool-pills">
              <button type="button" className={gapFilter === 'all' ? 'on' : ''} onClick={() => { setGapFilter('all'); reanalyze(); }}>재분석</button>
              <button type="button" className={gapFilter === 'shortfall' ? 'on' : ''} onClick={() => setGapFilter('shortfall')}>차단 항목만</button>
              <button type="button" className={gapFilter === 'human' ? 'on' : ''} onClick={() => setGapFilter('human')}>사람 확인 필요</button>
              <button type="button" className={gapFilter === 'hidden' ? 'on' : ''} onClick={() => setGapFilter('hidden')}>숨긴 항목</button>
            </div>
            <h2 data-jump="check-gaps"><Terms text={`Gap 목록 · 기준 모델 rev ${tab.analyzedRevision ?? p.revision}`} /></h2>
            <RunGapSection gaps={runGaps} ran={!!runRecord} stale={runStale} onGo={goGap} />
            <table className="grid plain">
              <thead><tr><th>종류와 판정</th><th>근거</th><th>관련 대상</th><th>다음 행동</th></tr></thead>
              <tbody>{tab.gaps.filter((g) => gapVisible(g, gapFilter, p.gapReview[g.id]?.status === 'hidden')).slice(0, 12).map((g) => <tr key={g.id} data-jump={`gap:${g.id}`}><td>{g.title} <StatusMark status={gapJudgementMark(g.judgement).status} word={gapJudgementMark(g.judgement).word} /></td><td>{g.evidence}</td><td>{g.objectIds.slice(0, 2).join(' / ') || '-'}</td><td><button type="button" className="small" onClick={() => goGap(g)}>수정 이동</button></td></tr>)}
                {tab.gaps.length === 0 && <tr><td colSpan={4}><EmptyState symbol="✓" line={EMPTY.gaps} actions={[{ label: '재분석', onClick: reanalyze }]} /></td></tr>}
                {tab.gaps.length > 0 && tab.gaps.filter((g) => gapVisible(g, gapFilter, p.gapReview[g.id]?.status === 'hidden')).length === 0 && <tr><td colSpan={4}>이 보기에 해당하는 항목이 없습니다.</td></tr>}</tbody>
            </table>
            <p className="warn-note">간섭 후보는 정밀 물리·안전 검증 결과가 아닙니다. 근거가 부족하면 문제 없음 대신 비교 불가로 둡니다.</p>
            <Fold className="fold-panel" summary="숨김, 사람 확인, 근거 자세히">
              <GapPanel p={p} gaps={tab.gaps} analyzedRevision={tab.analyzedRevision} onReanalyze={reanalyze} onGo={goGap} onReview={reviewGap} />
            </Fold>
          </section>}
          {sub === 'diag' && <><DiagSheet p={p} storageReason={storage.kv ? null : storage.reason ?? '저장소 없음'} quarantineList={qlist} onDownload={(name, text) => download(name, text, 'application/octet-stream')} onAml={() => goStep('library', 'aml')} onJumpCondition={(f: ConditionFinding) => goItem({ level: f.level === 'error' ? 'missing' : 'undetermined', kind: 'condition', text: f.where, jump: f.jump })} /><Fold className="fold-panel" summary="진단 자세히"><DiagPanel p={p} storageReason={storage.kv ? null : storage.reason ?? '저장소 없음'} quarantineList={qlist} onDownload={download} /></Fold></>}
          {sub === 'export' && <><ExportSheet p={p} onDownload={download} onGuide={goBlocker} /><Fold className="fold-panel" summary="행 단위 미리보기"><ExportPanel p={p} /></Fold></>}
          {sub === 'lab' && <><LabSheet revision={p.revision} onInstead={() => goStep('run')} /><Fold className="fold-panel" summary="미구현 안내"><LabPanel /></Fold></>}
        </div>
      </div>}

      {!guide && !view.home && step === 'run' && <div className={`workspace ws-run ${foldSteps ? 'fold-steps' : ''} ${foldCond ? 'fold-cond' : ''} ${view.runStripFolded ? 'fold-strip' : ''}`} data-run-view={view.runView}>
        <h1 className="stage-title run-title"><Terms text={screen === 'S62' ? '실행 차단과 수정' : 'Station 논리 실행'} /></h1>
        <div className="toolbar tool-pills">
          {runControls}<div className="sep" />{runViewToggle}<div className="sep" />{visualToggle}<div className="sep" /><button onClick={doSave}>저장</button>
          <span className="badge">{dirty ? '저장 안 됨' : '저장됨'}</span>
          <span className="badge">시뮬 {runStatusLabel(rt?.status)}</span>
          <span className="badge">실행 전 검사 {checkRunReadiness(p).ok ? '통과' : '미통과'}</span></div>
        <RunStepsPanel p={p} rt={rt} selectedId={selection[0] ?? null} folded={foldSteps} onToggleFold={() => setFoldSteps((v) => !v)} onPauseSubstation={doPauseSub} onResumeSubstation={doResumeSub} />
        <div className="run-center">
          <RunSummaryStrip p={p} rt={rt} folded={view.runStripFolded} onToggleFold={toggleRunStrip} onOpenGaps={() => goStep('check', 'gap')} />
          {rt?.error && (() => {
            const named = rt.error.message.match(/^\[([^\]]+)\]/)?.[1] ?? null;
            const interlockId = rt.interlockBlocks.find((row) => row.stepId === rt.error?.stepId)?.interlockId ?? rt.interlockBlocks[0]?.interlockId;
            const rule = p.constraints.find((k) => k.id === interlockId)?.rule;
            const phrase = runBlockFormula(p, rt.error.code, rt.error.stepId, rule?.form === 'allow' ? rule.conditions : undefined);
            const base = runErrorProblem(rt.error.code, rt.error.message, named);
            const copy = base && phrase ? { ...base, why: `${base.why} ${phrase}` } : base;
            if (!copy) return null;
            const jump = rt.error.code === 'INTERLOCK_BLOCK'
              ? () => {
                const id = rt.interlockBlocks.find((row) => row.stepId === rt.error?.stepId)?.interlockId ?? rt.interlockBlocks[0]?.interlockId;
                if (id) jumpInterlock(id);
              }
              : jumpRunError;
            return <section aria-label="실행이 막힐 때" data-run-error={rt.error.code} data-interlock-guide={rt.error.code === 'INTERLOCK_BLOCK' ? '' : undefined}>
              <Problem copy={copy} onJump={jump} />
            </section>;
          })()}
          {screen === 'S62' && <BlockerSheet p={p} title="Station 실행 차단" timeLabel={fmtTime(rt?.timeMs ?? 0)} blockers={rt?.blockers ?? []} onGuide={goBlocker} onRecheck={doReset} />}
          {propPeek && <section className="run-prop-peek" data-prop-peek aria-label="속성 보기">
            <div className="row"><b>속성 보기</b><button type="button" className="small" onClick={() => setPropPeek(false)}>닫기</button></div>
            <Inspector project={p} selectedId={selection[0] ?? null} locked gaps={tab.gaps} edit={edit} onAddStep={() => {}} onDelete={() => {}} confirmDelete={() => {}} onReparent={() => {}} tab="props" setTab={() => {}} visualMode={view.visualMode} />
          </section>}
          <div className="run-canvas">
            {view.runView === '3d' && scene3d
              ? <Scene3D scene={scene3d} showNames={showNames} emphasize={emphasizeMotion} visualMode={view.visualMode} equipmentMotion={equipmentMotion} running={rt?.status === 'running'} selectedId={p.devices.some((d) => d.id === selection[0]) ? selection[0] : null}
                onSelect={(id) => setSelection(id ? [id] : [])} onDiagram={() => setRunView('diagram')} />
              : <div className="diagram-canvas">{runCanvasEl}</div>}
          </div>
          <RunDetails p={p} rt={rt} open={view.runDetailsOpen} tab={view.runDetailsTab} onToggle={() => setRunDetailsOpen(!view.runDetailsOpen)} onTab={setRunDetailsTab} onJumpInterlock={jumpInterlock}
            onRun={doRun} runDisabled={running || rt?.status === 'paused'} runReason={running || rt?.status === 'paused' ? '실행 중이거나 일시정지 중입니다. 초기화한 뒤 다시 실행하세요.' : undefined} onJumpError={jumpRunError} />
        </div>
        <RunConditions p={p} locked={locked} edit={edit} speed={speed} setSpeed={setSpeed} showNames={showNames} setShowNames={setShowNames} folded={foldCond} onToggleFold={() => setFoldCond((v) => !v)}
          emphasize={emphasizeMotion} setEmphasize={setEmphasizeMotion} equipmentMotion={equipmentMotion} setEquipmentMotion={setEquipmentMotion} canRevert={canRevertDurations} onRevert={revertDurations} onDuration={onDuration} onTimeout={onTimeout}
          sceneOptions={view.runView === '3d'} onGoBlocker={goBlocker} />
      </div>}

      <div className="statusbar">
        <b>논리 시뮬레이션 · 실제 장비 제어/안전 검증 아님</b>
        <span>rev {p.revision}</span><span>Undo {tab.history.past.length}</span>
        <span>{runStatusBar(rt?.status)}</span>
        {locked && <span>실행 중 편집 잠금</span>}
        <span className="grow" />
        {!view.home && <>
          <button className="small" data-items-toggle onClick={() => toggleItems(step)}>남은 항목 {curEval.items.length}</button>
          <button className="btn-main secondary" disabled={cur.no === 1} onClick={() => goStep(STEPS[cur.no - 2].id)}>이전</button>
          <button className="btn-main primary" disabled={cur.no === 6} onClick={goNext}>다음 단계</button>
        </>}
        {view.home && <>
          <button className="btn-main secondary" onClick={() => fileRef.current?.click()}>JSON 가져오기</button>
          <button className="btn-main primary" onClick={() => { setHelpScope('main'); setView((v) => ({ ...v, home: false })); }}>시작하기</button>
        </>}
        <span className="muted">형식 {FILE_FORMAT_VERSION} · 규칙 {RUNTIME_RULES_VERSION}</span>
      </div>

      {importBusy && <div className="import-hold"><LoadingPlaceholder label={LOADING_FILE} /></div>}
      {toast && <div className={`toast ${toast.err ? 'err' : ''}`} style={style}>{toast.problem ? <Problem copy={toast.problem} compact /> : toast.msg}</div>}
      {viewOpen && <StaticModalFrame title="보기 설정" style={style} onCancel={() => setViewOpen(false)}>
        <p className="muted">보기만 바꿉니다. 모델, rev, 실행, 선택, 입력은 그대로입니다. 보관된 이전 팔레트는 고를 수 없습니다.</p>
        <label className="draft-toggle"><input type="checkbox" checked={view.autoDraft} onChange={(e) => setView((v) => ({ ...v, autoDraft: e.target.checked }))} />자동 임시 저장</label>
        <p className="muted">켜 두면 마지막 편집 후 5초 뒤에 이 브라우저에만 임시 저장합니다. 「저장」한 내용과 저장 목록은 바꾸지 않습니다.</p>
        <label className="draft-toggle"><input type="checkbox" data-term-hints checked={view.termHints} onChange={(e) => setView((v) => ({ ...v, termHints: e.target.checked }))} />용어 밑줄</label>
        <p className="muted">켜 두면 제목, 탭, 단계 바, 표 머리에 용어 풀이가 붙습니다. 끄면 밑줄과 풀이가 사라집니다. 모델은 바뀌지 않습니다.</p>
        <div className="row" style={{ gap: 8 }}>{visualToggle}</div>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn-main secondary" onClick={() => {
            const headerBtn = [...document.querySelectorAll<HTMLElement>('.header button')].find((b) => (b.textContent ?? '').trim() === '보기 설정') ?? null;
            beginTour(headerBtn);
          }}>{view.tourSeen ? TOUR_AGAIN : TOUR_BUTTON}</button>
        </div>
        <p className="muted">화면 {screen} · 단계 {cur.no} {cur.label} · 확대 {Math.round(view.zoom * 100)}%</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn-main secondary" onClick={() => setViewOpen(false)}>닫기</button></div>
      </StaticModalFrame>}
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} kind={ctx.kind} items={menuItems} returnFocus={ctx.focus} onRun={runMenu} onClose={() => setCtx(null)} />}
      {nameDlg && <NameDialog key={nameDlg.title} {...nameDlg} onCancel={() => setNameDlg(null)} />}
      {modal && <StaticModalFrame key={modal.title} title={modal.title} style={style} onCancel={() => setModal(null)}>
        {modal.body}
        <div className="modal-actions">{modal.actions.map((a) => <button key={a.label} type="button" autoFocus={a.focus} ref={a.focus ? (el) => { el?.focus(); } : undefined} className={a.primary ? 'primary' : a.danger ? 'danger' : ''} onClick={() => { setModal(null); a.run(); }}>{a.label}</button>)}</div>
      </StaticModalFrame>}
      {view.helpOpen && <HelpPanel topic={helpTopic(helpId)} onClose={closeHelp} onTour={(el) => beginTour(el)} onShortcuts={() => setShortcutOpen(true)} />}
      {tourIndex !== null && TOUR_STEPS[tourIndex] && <TourBubble step={TOUR_STEPS[tourIndex]} onPrev={prevTour} onNext={nextTour} onSkip={endTour} onRestore={restoreTourFocus} />}
      {paletteOpen && <CommandPaletteDialog state={commandState} mac={macShortcut} onRun={runCommand} onClose={() => setPaletteOpen(false)} />}
      {shortcutOpen && <ShortcutSheet state={commandState} mac={macShortcut} onClose={() => setShortcutOpen(false)} />}
    </div>
    </TermHintsProvider>
  );
}
