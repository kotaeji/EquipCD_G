// TURN-057. A browser Unit template is a copy/paste snapshot of one Unit.
// Placing it mints new ids. It does not stay linked to the template or change the project file format.
import { getAssetById } from '../assets/library';
import { captureCopy, pasteClipboard, type Clipboard, type PasteOmission } from './copyPaste';
import { newId } from './factory';
import type { CmdResult } from './commands';
import type { Action, Connection, Device, Position, Project, Signal, Unit } from './types';

export const TEMPLATE_FORMAT = 'aurora-concept-designer/unit-template';
export const TEMPLATE_FORMAT_VERSION = '0.1.0';
export const TEMPLATE_DRAG_PREFIX = 'user-template:';

export const SAVE_NEED_UNIT = 'Unit 을 고르세요';
export const SAVE_ONE_UNIT = 'Unit 을 하나만 고르세요';
export const STORAGE_UNAVAILABLE = '이 브라우저 저장소를 쓸 수 없어 내 템플릿을 저장하지 못합니다';
export const PLACE_LOCKED = '실행 중에는 템플릿을 놓지 못합니다';

export interface UserTemplate {
  format: typeof TEMPLATE_FORMAT;
  formatVersion: typeof TEMPLATE_FORMAT_VERSION;
  id: string;
  name: string;
  savedAt: string;
  unit: Unit;
  devices: Device[];
  signals: Signal[];
  positions: Position[];
  actions: Action[];
  connections: Connection[];
}

export interface CapturedTemplate {
  unit: Unit;
  devices: Device[];
  signals: Signal[];
  positions: Position[];
  actions: Action[];
  connections: Connection[];
  /** Empty when nothing was left out. Otherwise `빠짐: …`. */
  notice: string;
  omitted: PasteOmission;
  externalConnections: number;
}

export type CaptureTemplateResult = { ok: true; captured: CapturedTemplate } | { ok: false; reason: string };

export function templateDragToken(id: string): string {
  return `${TEMPLATE_DRAG_PREFIX}${id}`;
}

export function templateIdFromDrag(token: string): string | null {
  if (!token.startsWith(TEMPLATE_DRAG_PREFIX)) return null;
  const id = token.slice(TEMPLATE_DRAG_PREFIX.length);
  return id || null;
}

export function isUserTemplateDrag(token: string): boolean {
  return templateIdFromDrag(token) !== null;
}

export function templateOriginText(name: string): string {
  return `내 템플릿 〈${name}〉에서`;
}

export function normalizeTemplateName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function templateNameKey(name: string): string {
  return normalizeTemplateName(name).toLocaleLowerCase();
}

export function suggestTemplateName(base: string, taken: string[]): string {
  const n = normalizeTemplateName(base);
  const keys = new Set(taken.map(templateNameKey));
  if (n && !keys.has(templateNameKey(n))) return n;
  let i = 2;
  while (keys.has(templateNameKey(`${n} ${i}`))) i += 1;
  return `${n} ${i}`;
}

/** Toolbar gate. A context click already names one Unit, so it only checks storage. */
export function templateSaveGate(input: { storage: boolean; selectedIds: string[]; unitIds: string[] }): { ok: boolean; reason: string } {
  if (!input.storage) return { ok: false, reason: STORAGE_UNAVAILABLE };
  const units = input.selectedIds.filter((id) => input.unitIds.includes(id));
  if (input.selectedIds.length === 1 && units.length === 1) return { ok: true, reason: '내 템플릿으로 저장' };
  if (units.length > 1) return { ok: false, reason: SAVE_ONE_UNIT };
  return { ok: false, reason: SAVE_NEED_UNIT };
}

function omissionNotice(omitted: PasteOmission, externalConnections: number): string {
  const parts: string[] = [];
  if (omitted.sequenceSteps) parts.push(`시퀀스 단계 ${omitted.sequenceSteps}`);
  if (externalConnections) parts.push(`바깥 연결 ${externalConnections}`);
  if (omitted.materialRoutes) parts.push(`자재 경로 ${omitted.materialRoutes}`);
  if (omitted.interlocks) parts.push(`Interlock ${omitted.interlocks}`);
  return parts.length ? `빠짐: ${parts.join(', ')}` : '';
}

/** One Unit, same slice as copy. Outside links stay out of the snapshot and are named in `notice`. */
export function captureUnitTemplate(p: Project, unitId: string): CaptureTemplateResult {
  const unit = p.units.find((u) => u.id === unitId);
  if (!unit) return { ok: false, reason: SAVE_NEED_UNIT };
  const captured = captureCopy(p, [unit.id]);
  if (!captured.ok || captured.clip.kind !== 'units' || captured.clip.units.length !== 1) return { ok: false, reason: SAVE_NEED_UNIT };
  const clip = captured.clip;
  const nodes = new Set<string>([unit.id, ...clip.devices.map((d) => d.id)]);
  const signals = new Set(clip.signals.map((s) => s.id));
  const inside = (c: Connection) => {
    if (!nodes.has(c.from.nodeId) || !nodes.has(c.to.nodeId)) return false;
    if (c.kind !== 'signal') return true;
    return !!c.from.signalId && !!c.to.signalId && signals.has(c.from.signalId) && signals.has(c.to.signalId);
  };
  let externalConnections = 0;
  const connections: Connection[] = [];
  for (const c of clip.connections) {
    if (inside(c)) connections.push(structuredClone(c));
    else if (nodes.has(c.from.nodeId) || nodes.has(c.to.nodeId)) externalConnections += 1;
  }
  return {
    ok: true,
    captured: {
      unit: structuredClone(clip.units[0]),
      devices: structuredClone(clip.devices),
      signals: structuredClone(clip.signals),
      positions: structuredClone(clip.positions),
      actions: structuredClone(clip.actions),
      connections,
      omitted: clip.omitted,
      externalConnections,
      notice: omissionNotice(clip.omitted, externalConnections),
    },
  };
}

function missingAssets(devices: Device[]): string[] {
  const ids: string[] = [];
  for (const d of devices) {
    if (!getAssetById(d.definitionRef.assetId)) ids.push(d.definitionRef.assetId);
  }
  return [...new Set(ids)];
}

export function placeUserTemplate(p0: Project, template: UserTemplate, at: { x: number; y: number }, idOf: (s: string) => string = newId): CmdResult {
  const missing = missingAssets(template.devices);
  if (missing.length) return { ok: false, reason: `에셋 정의 ${missing.join(', ')} 가 없어 놓지 않았습니다` };
  const clip: Clipboard = {
    kind: 'units',
    units: [structuredClone(template.unit)],
    devices: structuredClone(template.devices),
    signals: structuredClone(template.signals),
    positions: structuredClone(template.positions),
    actions: structuredClone(template.actions),
    connections: structuredClone(template.connections),
    omitted: { sequenceSteps: 0, materialRoutes: 0, interlocks: 0 },
  };
  const placed = pasteClipboard(p0, clip, [], idOf, {
    at,
    names: 'keep',
    deviceLineage: false,
    clearTemplateRef: true,
    requireAssets: true,
    lineageForUnit: () => ({ fromTemplate: { id: template.id, name: template.name } }),
  });
  if (!placed.ok) return placed;
  const ids = (placed.note ?? '').split('\n')[0] ?? '';
  return { ok: true, project: placed.project, note: `${ids}\n${templateOriginText(template.name)} Unit을 놓았습니다` };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function layoutOk(v: unknown): boolean {
  if (!isRecord(v)) return false;
  return ['x', 'y', 'w', 'h'].every((k) => typeof v[k] === 'number' && Number.isFinite(v[k] as number));
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

/** Read a template file. A broken file is refused and nothing is stored. */
export function parseTemplateFile(raw: string): { ok: true; template: UserTemplate } | { ok: false; reason: string } {
  let data: unknown;
  try { data = JSON.parse(raw); } catch {
    return { ok: false, reason: '템플릿 파일을 읽지 못했습니다' };
  }
  if (!isRecord(data)) return { ok: false, reason: '템플릿 파일이 객체가 아닙니다' };
  if (data.format !== TEMPLATE_FORMAT) return { ok: false, reason: `알 수 없는 템플릿 형식: ${String(data.format)}` };
  if (data.formatVersion !== TEMPLATE_FORMAT_VERSION) return { ok: false, reason: `지원하지 않는 템플릿 형식 버전 ${String(data.formatVersion)}` };
  if (typeof data.name !== 'string' || !normalizeTemplateName(data.name)) return { ok: false, reason: '템플릿 이름이 없습니다' };
  if (typeof data.savedAt !== 'string' || !data.savedAt) return { ok: false, reason: '템플릿 저장 시각이 없습니다' };
  if (!isRecord(data.unit) || typeof data.unit.id !== 'string' || typeof data.unit.name !== 'string') return { ok: false, reason: '템플릿 Unit 이 없습니다' };
  if (!layoutOk(data.unit.layout) || !Array.isArray(data.unit.deviceIds)) return { ok: false, reason: '템플릿 Unit 형식이 깨졌습니다' };
  const lists = ['devices', 'signals', 'positions', 'actions', 'connections'] as const;
  for (const key of lists) if (!Array.isArray(data[key])) return { ok: false, reason: `템플릿 ${key} 목록이 없습니다` };
  const unit = data.unit as unknown as Unit;
  const devices = data.devices as Device[];
  const signals = data.signals as Signal[];
  const positions = data.positions as Position[];
  const actions = data.actions as Action[];
  const connections = data.connections as Connection[];
  const deviceIds = new Set<string>();
  for (const d of devices) {
    if (!d || typeof d.id !== 'string' || typeof d.name !== 'string' || typeof d.kind !== 'string') return { ok: false, reason: '템플릿 Device 형식이 깨졌습니다' };
    if (d.unitId !== unit.id || !layoutOk(d.layout) || !isRecord(d.definitionRef) || typeof d.definitionRef.assetId !== 'string') return { ok: false, reason: '템플릿 Device 소속이 깨졌습니다' };
    deviceIds.add(d.id);
  }
  if (devices.length !== deviceIds.size) return { ok: false, reason: '템플릿 Device ID 가 겹칩니다' };
  const signalIds = new Set<string>();
  for (const s of signals) {
    if (!s || typeof s.id !== 'string' || !deviceIds.has(s.deviceId)) return { ok: false, reason: '템플릿 신호가 깨졌습니다' };
    signalIds.add(s.id);
  }
  for (const s of positions) if (!s || typeof s.id !== 'string' || !deviceIds.has(s.deviceId)) return { ok: false, reason: '템플릿 포지션이 깨졌습니다' };
  for (const a of actions) {
    if (!a || typeof a.id !== 'string' || a.unitId !== unit.id || !deviceIds.has(a.deviceId)) return { ok: false, reason: '템플릿 Action 이 깨졌습니다' };
    if (!Array.isArray(a.pre) || !Array.isArray(a.post) || !isRecord(a.effect)) return { ok: false, reason: '템플릿 Action 조건이 깨졌습니다' };
  }
  const nodes = new Set<string>([unit.id, ...deviceIds]);
  for (const c of connections) {
    if (!c || typeof c.id !== 'string' || (c.kind !== 'flow' && c.kind !== 'signal')) return { ok: false, reason: '템플릿 연결이 깨졌습니다' };
    if (!c.from || !c.to || !nodes.has(c.from.nodeId) || !nodes.has(c.to.nodeId)) return { ok: false, reason: '템플릿 연결이 바깥을 가리킵니다' };
    if (c.kind === 'signal' && (!c.from.signalId || !c.to.signalId || !signalIds.has(c.from.signalId) || !signalIds.has(c.to.signalId))) return { ok: false, reason: '템플릿 신호 연결이 깨졌습니다' };
  }
  const id = typeof data.id === 'string' && SAFE_ID.test(data.id) ? data.id : newId('tpl');
  const template: UserTemplate = {
    format: TEMPLATE_FORMAT,
    formatVersion: TEMPLATE_FORMAT_VERSION,
    id,
    name: normalizeTemplateName(data.name),
    savedAt: data.savedAt,
    unit: structuredClone(unit),
    devices: structuredClone(devices),
    signals: structuredClone(signals),
    positions: structuredClone(positions),
    actions: structuredClone(actions),
    connections: structuredClone(connections),
  };
  return { ok: true, template };
}

export function exportTemplateText(template: UserTemplate): string {
  return JSON.stringify(template, null, 2);
}
