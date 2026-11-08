// Project file (JSON) serialize / parse with version & reference integrity checks (C05, D02~D04).
import { ASSET_LIBRARY, getAssetById } from '../assets/library';
import type { Project, ProjectFile } from '../model/types';
import { APP_VERSION, FILE_FORMAT_ID, FILE_FORMAT_VERSION } from '../model/types';
import { validateProject, type Diagnostic } from '../model/validate';

export function toProjectFile(p: Project): ProjectFile {
  const used = new Map<string, string>();
  for (const d of p.devices) used.set(d.definitionRef.assetId, d.definitionRef.version);
  return {
    format: FILE_FORMAT_ID, formatVersion: FILE_FORMAT_VERSION, appVersion: APP_VERSION,
    assetDefinitions: [...used.entries()].map(([id, version]) => ({ id, version })),
    project: p,
  };
}

/** Stable JSON (sorted keys) so the same model always serializes identically. */
export function stableStringify(v: unknown, indent = 2): string {
  const norm = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(norm);
    if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, norm((x as any)[k])]));
    return x;
  };
  return JSON.stringify(norm(v), null, indent);
}

export function serializeProject(p: Project): string { return stableStringify(toProjectFile(p)); }

export type ParseResult =
  | { ok: true; project: Project; warnings: Diagnostic[] }
  | { ok: false; errors: Diagnostic[]; raw: string };

const d = (code: string, objectId: string, message: string, severity: Diagnostic['severity'] = 'error'): Diagnostic => ({ id: `${code}:${objectId}`, severity, code, objectId, message });

export function isSupportedVersion(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  const [maj, min] = v.split('.');
  const [cm, cn] = FILE_FORMAT_VERSION.split('.');
  return maj === cm && min === cn;
}

/** Parse untrusted text. On ANY error returns ok:false with the untouched raw text (caller must not overwrite current model). */
export function parseProjectFile(raw: string): ParseResult {
  let data: any;
  try { data = JSON.parse(raw); } catch (e) { return { ok: false, raw, errors: [d('JSON_PARSE', 'file', `JSON 파싱 실패: ${(e as Error).message}`)] }; }
  if (!data || typeof data !== 'object') return { ok: false, raw, errors: [d('SHAPE', 'file', '객체가 아님')] };
  if (data.format !== FILE_FORMAT_ID) return { ok: false, raw, errors: [d('FORMAT_UNKNOWN', 'file', `알 수 없는 형식: ${String(data.format)}`)] };
  if (!isSupportedVersion(data.formatVersion)) return { ok: false, raw, errors: [d('VERSION_UNSUPPORTED', 'file', `지원하지 않는 형식 버전 ${String(data.formatVersion)} (지원: ${FILE_FORMAT_VERSION.split('.').slice(0, 2).join('.')}.x). 원본은 변경하지 않았습니다`)] };
  const p = data.project as Project;
  if (!p || typeof p !== 'object' || typeof p.id !== 'string') return { ok: false, raw, errors: [d('SHAPE', 'project', 'project 없음')] };
  const diags = validateProject(p);
  const errors = diags.filter((x) => x.severity === 'error');
  if (errors.length) return { ok: false, raw, errors };
  const warnings = diags.filter((x) => x.severity === 'warning');
  for (const ref of (data.assetDefinitions ?? []) as { id: string; version: string }[]) {
    const def = getAssetById(ref.id);
    if (!def) warnings.push(d('ASSET_UNKNOWN', ref.id, `에셋 정의 ${ref.id} 없음`));
    else if (def.version !== ref.version) warnings.push(d('ASSET_VERSION_DIFF', ref.id, `에셋 정의 버전 차이: 파일 ${ref.version}, 라이브러리 ${def.version} — 자동 업데이트하지 않음`, 'warning'));
  }
  return { ok: true, project: p, warnings };
}

export const LIBRARY_VERSIONS = ASSET_LIBRARY.map((a) => `${a.id}@${a.version}`);
