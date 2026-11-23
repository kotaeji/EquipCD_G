// TURN-057. Browser-local Unit templates. Not part of a project file and not part of the project transaction.
import { newId } from '../model/factory';
import {
  exportTemplateText,
  normalizeTemplateName,
  parseTemplateFile,
  TEMPLATE_FORMAT,
  TEMPLATE_FORMAT_VERSION,
  templateNameKey,
  type CapturedTemplate,
  type UserTemplate,
} from '../model/userTemplates';
import type { KV } from './localStore';

export const TEMPLATES_INDEX_KEY = 'ecd.v1.templates';
export const templateBodyKey = (id: string) => `ecd.v1.templates.${id}`;

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

export interface TemplateList { templates: UserTemplate[]; skipped: number }

function readRaw(kv: KV, key: string): string | null {
  try { return kv.getItem(key); } catch { return null; }
}

function bodyKeys(kv: KV): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < kv.length; i++) {
      const key = kv.key(i);
      if (key && key.startsWith('ecd.v1.templates.') && key !== TEMPLATES_INDEX_KEY) out.push(key);
    }
  } catch { /* a broken store yields nothing rather than throwing */ }
  return out;
}

function loadBody(raw: string | null): UserTemplate | null {
  if (!raw) return null;
  const parsed = parseTemplateFile(raw);
  if (!parsed.ok) return null;
  if (!SAFE_ID.test(parsed.template.id)) return null;
  return parsed.template;
}

function parseIndex(raw: string | null): { ok: true; ids: string[] } | { ok: false } {
  if (raw == null) return { ok: true, ids: [] };
  try {
    const data = JSON.parse(raw) as { ids?: unknown };
    if (data && Array.isArray(data.ids) && data.ids.every((id) => typeof id === 'string' && SAFE_ID.test(id))) return { ok: true, ids: data.ids };
  } catch { /* the index itself is one broken item */ }
  return { ok: false };
}

/** Never throws. A broken item is skipped and the rest are returned. */
export function readTemplates(kv: KV | null): TemplateList {
  if (!kv) return { templates: [], skipped: 0 };
  const index = parseIndex(readRaw(kv, TEMPLATES_INDEX_KEY));
  const ids = index.ok ? index.ids : bodyKeys(kv).map((key) => key.slice('ecd.v1.templates.'.length)).filter((id) => SAFE_ID.test(id));
  let skipped = index.ok ? 0 : 1;
  const templates: UserTemplate[] = [];
  for (const id of ids) {
    const body = loadBody(readRaw(kv, templateBodyKey(id)));
    if (!body || body.id !== id) { skipped += 1; continue; }
    templates.push(body);
  }
  return { templates, skipped };
}

function writeIndex(kv: KV, ids: string[]): { ok: true } | { ok: false; reason: string } {
  const body = JSON.stringify({ v: 1, ids });
  try {
    kv.setItem(TEMPLATES_INDEX_KEY, body);
    if (kv.getItem(TEMPLATES_INDEX_KEY) !== body) return { ok: false, reason: '템플릿 목록을 확인하지 못했습니다' };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `템플릿 목록을 저장하지 못했습니다 (${(e as Error).message})` };
  }
}

export function saveTemplate(
  kv: KV,
  captured: CapturedTemplate,
  name: string,
  opts?: { id?: string; now?: Date },
): { ok: true; template: UserTemplate } | { ok: false; reason: string } {
  const clean = normalizeTemplateName(name);
  if (!clean) return { ok: false, reason: '이름을 입력하세요 (공백만은 안 됩니다)' };
  if (clean.length > 60) return { ok: false, reason: '이름은 60자 이하로 입력하세요' };
  const id = opts?.id && SAFE_ID.test(opts.id) ? opts.id : newId('tpl');
  const template: UserTemplate = {
    format: TEMPLATE_FORMAT,
    formatVersion: TEMPLATE_FORMAT_VERSION,
    id,
    name: clean,
    savedAt: (opts?.now ?? new Date()).toISOString(),
    unit: captured.unit,
    devices: captured.devices,
    signals: captured.signals,
    positions: captured.positions,
    actions: captured.actions,
    connections: captured.connections,
  };
  const body = exportTemplateText(template);
  const key = templateBodyKey(id);
  let previous: string | null = null;
  try { previous = kv.getItem(key); } catch { return { ok: false, reason: '템플릿 저장소를 읽지 못했습니다' }; }
  try {
    kv.setItem(key, body);
    if (kv.getItem(key) !== body) {
      if (previous == null) kv.removeItem(key);
      else kv.setItem(key, previous);
      return { ok: false, reason: '템플릿 저장을 확인하지 못했습니다' };
    }
  } catch (e) {
    return { ok: false, reason: `템플릿을 저장하지 못했습니다 (${(e as Error).message})` };
  }
  const current = readTemplates(kv);
  const ids = [id, ...current.templates.map((t) => t.id).filter((x) => x !== id)];
  const index = writeIndex(kv, ids);
  if (!index.ok) {
    try { if (previous == null) kv.removeItem(key); else kv.setItem(key, previous); } catch { /* the body may remain; the next read still skips a bad index */ }
    return index;
  }
  return { ok: true, template };
}

export function renameTemplate(kv: KV, id: string, name: string, now = new Date()): { ok: true; template: UserTemplate } | { ok: false; reason: string } {
  const current = readTemplates(kv).templates.find((t) => t.id === id);
  if (!current) return { ok: false, reason: '템플릿을 찾지 못했습니다' };
  const clean = normalizeTemplateName(name);
  if (!clean) return { ok: false, reason: '이름을 입력하세요 (공백만은 안 됩니다)' };
  const taken = readTemplates(kv).templates.filter((t) => t.id !== id);
  if (taken.some((t) => templateNameKey(t.name) === templateNameKey(clean))) return { ok: false, reason: `같은 이름 「${clean}」이(가) 이미 있습니다` };
  const captured: CapturedTemplate = {
    unit: current.unit, devices: current.devices, signals: current.signals, positions: current.positions,
    actions: current.actions, connections: current.connections, notice: '', omitted: { sequenceSteps: 0, materialRoutes: 0, interlocks: 0 }, externalConnections: 0,
  };
  return saveTemplate(kv, captured, clean, { id, now });
}

export function deleteTemplate(kv: KV, id: string): { ok: true } | { ok: false; reason: string } {
  if (!SAFE_ID.test(id)) return { ok: false, reason: '템플릿을 찾지 못했습니다' };
  try { kv.removeItem(templateBodyKey(id)); } catch (e) {
    return { ok: false, reason: `템플릿을 지우지 못했습니다 (${(e as Error).message})` };
  }
  const ids = readTemplates(kv).templates.map((t) => t.id).filter((x) => x !== id);
  return writeIndex(kv, ids);
}
