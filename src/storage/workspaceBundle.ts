/**
 * TURN-055 — one Workspace (its saved projects only) as a single JSON file.
 * Drafts, view settings, the quarantine box, and run records are not part of the file.
 * Import is one applyAtomic transaction: all of the accepted projects, or none of them.
 */
import type { Project } from '../model/types';
import { APP_VERSION, FILE_FORMAT_ID } from '../model/types';
import { parseProjectFile, serializeProject, stableStringify } from './fileFormat';
import { INDEX_KEY, PROJECT_KEY, readIndexStrict, type IndexEntry, type KV, type QuarantineEntry } from './localStore';
import { applyAtomic, TXN_OP_LIMIT, type TxnGuard, type TxnOp } from './txn';
import {
  attachProject, createWorkspace, newWsId, normalizeName, ownerOf, uniqueName, WS_KEY,
  type WorkspaceRegistry,
} from './workspaces';

export const BUNDLE_FORMAT = 'aurora-concept-designer/workspace-bundle';
export const BUNDLE_VERSION = '0.1.0';

export interface WorkspaceBundle {
  format: typeof BUNDLE_FORMAT;
  formatVersion: typeof BUNDLE_VERSION;
  createdAt: string;
  appVersion: string;
  workspaceName: string;
  projects: unknown[];
}

export interface BundleProjectInfo {
  id: string;
  name: string;
  revision: number;
  savedAt: string;
}

export interface BundleExport {
  text: string;
  fileName: string;
  bytes: number;
  projects: BundleProjectInfo[];
  omitted: { id: string; reason: string }[];
}

export type BundleVerdict = 'new' | 'conflict' | 'unreadable';

export interface BundlePreviewRow {
  index: number;
  id: string | null;
  name: string;
  revision: number | null;
  verdict: BundleVerdict;
  reason: string;
}

export interface BundlePreview {
  workspaceName: string;
  rows: BundlePreviewRow[];
}

export type ConflictChoice = 'copy' | 'skip' | 'overwrite';
export type BundleMode = 'new' | 'add';

export interface BundleSummary {
  imported: number;
  copied: number;
  skipped: number;
  overwritten: number;
  quarantined: number;
}

export interface BundleApplyResult {
  ok: true;
  reg: WorkspaceRegistry;
  summary: BundleSummary;
  quarantine: QuarantineEntry[];
  overwrittenIds: string[];
  /** Set when mode is `new` and the workspace list was written. */
  newWorkspace: { id: string; name: string } | null;
}

export type BundleFailure = { ok: false; reason: string };

const TOP_KEYS = ['format', 'formatVersion', 'createdAt', 'appVersion', 'workspaceName', 'projects'] as const;

export function bundleFileName(workspaceName: string): string {
  const safe = normalizeName(workspaceName).replace(/[^\w가-힣-]+/g, '_') || 'workspace';
  return `${safe}.aurora-workspace.json`;
}

export function bundleBytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function summaryLine(s: BundleSummary): string {
  return `들어옴 ${s.imported} · 사본 ${s.copied} · 건너뜀 ${s.skipped} · 덮어씀 ${s.overwritten} · 격리 ${s.quarantined}`;
}

function projectError(raw: string): string {
  const parsed = parseProjectFile(raw);
  if (parsed.ok) return '';
  const e = parsed.errors[0];
  return e ? `[${e.code}] ${e.objectId}: ${e.message}` : '프로젝트를 읽지 못했습니다';
}

function asProjectText(entry: unknown): string | null {
  if (typeof entry === 'string') return entry;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  return stableStringify(entry);
}

function peekProject(entry: unknown): { id: string | null; name: string; revision: number | null } {
  const body = entry && typeof entry === 'object' && !Array.isArray(entry) ? (entry as { project?: unknown }).project : null;
  const p = body && typeof body === 'object' ? body as { id?: unknown; name?: unknown; revision?: unknown } : null;
  return {
    id: p && typeof p.id === 'string' ? p.id : null,
    name: p && typeof p.name === 'string' && p.name.trim() ? p.name : '읽을 수 없음',
    revision: p && typeof p.revision === 'number' ? p.revision : null,
  };
}

/** Saved projects of one workspace, in index order. Does not read drafts, view settings, or quarantine. */
export function exportWorkspaceBundle(kv: KV, reg: WorkspaceRegistry, wsId: string, now = new Date()): BundleExport | BundleFailure {
  const ws = reg.workspaces.find((w) => w.id === wsId);
  if (!ws) return { ok: false, reason: 'Workspace를 찾을 수 없습니다' };
  const idx = readIndexStrict(kv);
  if (!idx.ok) return { ok: false, reason: idx.reason };
  const member = new Set(ws.projectIds);
  const projects: unknown[] = [];
  const listed: BundleProjectInfo[] = [];
  const omitted: { id: string; reason: string }[] = [];
  for (const entry of idx.entries) {
    if (!member.has(entry.id)) continue;
    let raw: string | null;
    try { raw = kv.getItem(PROJECT_KEY(entry.id)); }
    catch (e) { return { ok: false, reason: `저장본을 읽지 못했습니다 (${(e as Error).message})` }; }
    if (raw === null) { omitted.push({ id: entry.id, reason: '저장본이 없습니다' }); continue; }
    const parsed = parseProjectFile(raw);
    if (!parsed.ok) { omitted.push({ id: entry.id, reason: projectError(raw) }); continue; }
    let file: unknown;
    try { file = JSON.parse(raw); } catch { omitted.push({ id: entry.id, reason: '저장본 JSON을 읽지 못했습니다' }); continue; }
    projects.push(file);
    listed.push({ id: parsed.project.id, name: parsed.project.name, revision: parsed.project.revision, savedAt: entry.savedAt });
  }
  const bundle: WorkspaceBundle = {
    format: BUNDLE_FORMAT,
    formatVersion: BUNDLE_VERSION,
    createdAt: now.toISOString(),
    appVersion: APP_VERSION,
    workspaceName: ws.name,
    projects,
  };
  const text = stableStringify(bundle);
  return { text, fileName: bundleFileName(ws.name), bytes: bundleBytes(text), projects: listed, omitted };
}

/** Reject a file that is not a bundle. Does not write. */
export function parseWorkspaceBundle(raw: string): { ok: true; bundle: WorkspaceBundle } | { ok: false; why: string } {
  let data: unknown;
  try { data = JSON.parse(raw); } catch (e) { return { ok: false, why: `JSON이 아닙니다 (${(e as Error).message}).` }; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, why: '묶음 파일이 객체가 아닙니다.' };
  const o = data as Record<string, unknown>;
  if (o.format !== BUNDLE_FORMAT) {
    const shown = typeof o.format === 'string' ? o.format : String(o.format);
    return { ok: false, why: o.format === FILE_FORMAT_ID
      ? '프로젝트 파일입니다. Workspace 묶음 파일이 아닙니다.'
      : `형식 이름이 다릅니다 (${shown}).` };
  }
  if (o.formatVersion !== BUNDLE_VERSION) return { ok: false, why: `지원하지 않는 묶음 형식 버전입니다 (${String(o.formatVersion)}). 이 앱은 ${BUNDLE_VERSION} 만 읽습니다.` };
  if (typeof o.workspaceName !== 'string') return { ok: false, why: 'Workspace 이름이 없습니다.' };
  if (!Array.isArray(o.projects)) return { ok: false, why: '프로젝트 목록이 없습니다.' };
  for (const key of TOP_KEYS) {
    if (key === 'createdAt' || key === 'appVersion') {
      if (o[key] !== undefined && typeof o[key] !== 'string') return { ok: false, why: `${key} 값이 글자가 아닙니다.` };
    }
  }
  return {
    ok: true,
    bundle: {
      format: BUNDLE_FORMAT,
      formatVersion: BUNDLE_VERSION,
      createdAt: typeof o.createdAt === 'string' ? o.createdAt : '',
      appVersion: typeof o.appVersion === 'string' ? o.appVersion : '',
      workspaceName: o.workspaceName,
      projects: o.projects,
    },
  };
}

export function knownProjectIds(kv: KV, reg: WorkspaceRegistry): Set<string> {
  const ids = new Set<string>();
  const idx = readIndexStrict(kv);
  if (idx.ok) for (const e of idx.entries) ids.add(e.id);
  for (const w of reg.workspaces) for (const id of w.projectIds) ids.add(id);
  return ids;
}

export function previewWorkspaceBundle(kv: KV, reg: WorkspaceRegistry, bundle: WorkspaceBundle): BundlePreview {
  const known = knownProjectIds(kv, reg);
  const seen = new Set<string>(known);
  const rows: BundlePreviewRow[] = bundle.projects.map((entry, index) => {
    const peek = peekProject(entry);
    const text = asProjectText(entry);
    const parsed = text === null ? null : parseProjectFile(text);
    if (!parsed || !parsed.ok) {
      return {
        index, id: peek.id, name: peek.name, revision: peek.revision, verdict: 'unreadable' as const,
        reason: text === null ? '프로젝트 형식이 아닙니다' : projectError(text),
      };
    }
    const id = parsed.project.id;
    const conflict = seen.has(id);
    seen.add(id);
    return {
      index, id, name: parsed.project.name, revision: parsed.project.revision,
      verdict: conflict ? 'conflict' as const : 'new' as const,
      reason: conflict ? '이 브라우저에 같은 ID가 있습니다' : '',
    };
  });
  return { workspaceName: bundle.workspaceName, rows };
}

function copyId(base: string, taken: Set<string>): string {
  const stem = base.replace(/\s+/g, '-').slice(0, 160) || 'project';
  let n = 1;
  let id = `${stem}-copy`;
  while (taken.has(id)) { n += 1; id = `${stem}-copy-${n}`; }
  return id.length > 200 ? id.slice(0, 200) : id;
}

function workspaceTitle(name: string, others: string[]): string {
  const trimmed = normalizeName(name).slice(0, 60);
  return uniqueName(trimmed || '가져온 Workspace', others);
}

interface PlannedProject {
  id: string;
  text: string;
  entry: IndexEntry;
  /** null = leave membership where it is */
  attachTo: string | null;
}

/**
 * Write every accepted project, the saved index, and the workspace list together.
 * A quota failure restores the previous bytes. Unreadable projects are returned for the
 * quarantine box and are not written as projects. Calling this is the only write.
 */
export function applyWorkspaceBundle(
  kv: KV,
  reg: WorkspaceRegistry,
  bundle: WorkspaceBundle,
  mode: BundleMode,
  choices: Record<number, ConflictChoice>,
  now = new Date(),
  wsId = newWsId(now),
): BundleApplyResult | BundleFailure {
  const preview = previewWorkspaceBundle(kv, reg, bundle);
  const summary: BundleSummary = { imported: 0, copied: 0, skipped: 0, overwritten: 0, quarantined: 0 };
  const quarantine: QuarantineEntry[] = [];
  const overwrittenIds: string[] = [];
  const taken = knownProjectIds(kv, reg);
  const planned: PlannedProject[] = [];
  let next = reg;
  let newWorkspace: { id: string; name: string } | null = null;
  let destId = reg.activeId;

  if (mode === 'new') {
    const name = workspaceTitle(bundle.workspaceName, reg.workspaces.map((w) => w.name));
    const created = createWorkspace(reg, name, now, wsId);
    if (!created.ok) return { ok: false, reason: created.reason };
    if (reg.workspaces.some((w) => w.id === created.ws.id)) return { ok: false, reason: 'ID 충돌 — 다시 시도하세요' };
    next = created.reg;
    destId = created.ws.id;
    newWorkspace = { id: created.ws.id, name: created.ws.name };
  } else if (!reg.workspaces.some((w) => w.id === destId)) {
    return { ok: false, reason: '현재 Workspace를 찾을 수 없습니다' };
  }

  const savedAt = now.toISOString();
  for (const row of preview.rows) {
    const entry = bundle.projects[row.index];
    if (row.verdict === 'unreadable') {
      summary.quarantined += 1;
      const text = asProjectText(entry);
      quarantine.push({
        at: now.toLocaleString(),
        label: `bundle:${row.name}`,
        raw: text ?? stableStringify(entry),
        errors: [row.reason],
      });
      continue;
    }
    const text = asProjectText(entry);
    const parsed = text ? parseProjectFile(text) : null;
    if (!text || !parsed || !parsed.ok) {
      summary.quarantined += 1;
      quarantine.push({ at: now.toLocaleString(), label: `bundle:${row.name}`, raw: text ?? '', errors: [row.reason] });
      continue;
    }
    const choice: ConflictChoice | 'new' = row.verdict === 'conflict' ? (choices[row.index] ?? 'copy') : 'new';
    if (choice === 'skip') { summary.skipped += 1; continue; }
    if (choice === 'overwrite') {
      const project = parsed.project;
      planned.push({
        id: project.id,
        text,
        entry: { id: project.id, name: project.name, savedAt, revision: project.revision },
        attachTo: ownerOf(next, project.id) ? null : destId,
      });
      overwrittenIds.push(project.id);
      summary.overwritten += 1;
      continue;
    }
    const project = parsed.project;
    if (choice === 'copy' || taken.has(project.id)) {
      const id = copyId(project.id, taken);
      const copy: Project = { ...project, id, name: `${project.name} 사본` };
      taken.add(id);
      planned.push({
        id,
        text: serializeProject(copy),
        entry: { id, name: copy.name, savedAt, revision: copy.revision },
        attachTo: destId,
      });
      summary.copied += 1;
      continue;
    }
    taken.add(project.id);
    planned.push({
      id: project.id,
      text,
      entry: { id: project.id, name: project.name, savedAt, revision: project.revision },
      attachTo: destId,
    });
    summary.imported += 1;
  }

  const writes = new Map<string, PlannedProject>();
  for (const item of planned) writes.set(item.id, item);
  const unique = [...writes.values()];
  for (const item of unique) {
    if (!item.attachTo) continue;
    const attached = attachProject(next, item.attachTo, item.id);
    if (!attached.ok) return { ok: false, reason: attached.reason };
    next = attached.reg;
  }

  const registryChanged = JSON.stringify(next) !== JSON.stringify(reg);
  const writing = unique.length > 0 || registryChanged;
  if (!writing) return { ok: true, reg, summary, quarantine, overwrittenIds, newWorkspace: null };

  const opCount = unique.length + 1 + (registryChanged ? 1 : 0);
  if (opCount > TXN_OP_LIMIT) {
    return { ok: false, reason: `한 번에 넣을 수 있는 프로젝트는 ${TXN_OP_LIMIT - 2}개까지입니다. 아무것도 바꾸지 않았습니다.` };
  }

  const txn = applyAtomic(kv, '묶음 가져오기', () => {
    const idx = readIndexStrict(kv);
    if (!idx.ok) return { ok: false as const, reason: idx.reason };
    let freshRegRaw: string | null;
    try { freshRegRaw = kv.getItem(WS_KEY); } catch (e) { return { ok: false as const, reason: (e as Error).message }; }
    if (freshRegRaw !== JSON.stringify(reg)) {
      return { ok: false as const, reason: 'Workspace 목록이 이 화면이 알고 있는 상태와 다릅니다 — 변경하지 않았습니다' };
    }
    const replaced = new Set(unique.map((p) => p.id));
    const entries = [...unique.map((p) => p.entry), ...idx.entries.filter((e) => !replaced.has(e.id))];
    const ops: TxnOp[] = unique.map((p) => ({ key: PROJECT_KEY(p.id), value: p.text }));
    ops.push({ key: INDEX_KEY, value: JSON.stringify(entries) });
    if (registryChanged) ops.push({ key: WS_KEY, value: JSON.stringify(next) });
    const guards: TxnGuard[] = [{ key: WS_KEY, expect: freshRegRaw }, { key: INDEX_KEY, expect: kv.getItem(INDEX_KEY) }];
    for (const item of unique) {
      let current: string | null;
      try { current = kv.getItem(PROJECT_KEY(item.id)); } catch (e) { return { ok: false as const, reason: (e as Error).message }; }
      guards.push({ key: PROJECT_KEY(item.id), expect: current });
    }
    return { ok: true as const, ops, guards };
  }, now);
  if (!txn.ok) return { ok: false, reason: txn.reason };
  return { ok: true, reg: next, summary, quarantine, overwrittenIds, newWorkspace };
}
