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

/** Readable format versions: current 0.2.x and legacy 0.1.x (migrated on read, original text untouched). */
export const READABLE_VERSIONS = ['0.1', '0.2'];
export function isSupportedVersion(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  const [maj, min] = v.split('.');
  return READABLE_VERSIONS.includes(`${maj}.${min}`);
}

/**
 * 0.1.x → 0.2.0 migration (v0.3 임시 정책): the single Station-level sequence is kept AS IS in `project.sequence`
 * (still runs as before); `substationSequences` is added empty. No IDs or relations are changed.
 */
export function migrateProject(p: Project, fromVersion: string): { project: Project; migrated: boolean } {
  if (fromVersion.startsWith('0.1.') || !Array.isArray(p.substationSequences)) {
    return { project: { ...p, substationSequences: Array.isArray(p.substationSequences) ? p.substationSequences : [] }, migrated: fromVersion.startsWith('0.1.') };
  }
  return { project: p, migrated: false };
}

/** Parse untrusted text. On ANY error returns ok:false with the untouched raw text (caller must not overwrite current model). */
export function parseProjectFile(raw: string): ParseResult {
  let data: any;
  try { data = JSON.parse(raw); } catch (e) { return { ok: false, raw, errors: [d('JSON_PARSE', 'file', `JSON 파싱 실패: ${(e as Error).message}`)] }; }
  if (!data || typeof data !== 'object') return { ok: false, raw, errors: [d('SHAPE', 'file', '객체가 아님')] };
  if (data.format !== FILE_FORMAT_ID) return { ok: false, raw, errors: [d('FORMAT_UNKNOWN', 'file', `알 수 없는 형식: ${String(data.format)}`)] };
  if (!isSupportedVersion(data.formatVersion)) return { ok: false, raw, errors: [d('VERSION_UNSUPPORTED', 'file', `지원하지 않는 형식 버전 ${String(data.formatVersion)} (지원: ${READABLE_VERSIONS.map((v) => `${v}.x`).join(', ')}; 현재 쓰기 ${FILE_FORMAT_VERSION}). 원본은 변경하지 않았습니다`)] };
  const p0 = data.project as Project;
  if (!p0 || typeof p0 !== 'object' || typeof p0.id !== 'string') return { ok: false, raw, errors: [d('SHAPE', 'project', 'project 없음')] };
  const mig = migrateProject(p0, String(data.formatVersion));
  const p = mig.project;
  const diags = validateProject(p);
  const errors = diags.filter((x) => x.severity === 'error');
  if (errors.length) return { ok: false, raw, errors };
  const warnings = diags.filter((x) => x.severity === 'warning');
  if (mig.migrated) warnings.push(d('MIGRATED_FORMAT', 'file', `형식 ${String(data.formatVersion)} → ${FILE_FORMAT_VERSION} 변환: 기존 단일 시퀀스는 Station 시퀀스로 그대로 유지, Substation 시퀀스는 비어 있음. 저장하면 새 형식으로 기록됩니다 (원본 파일은 변경 안 함)`, 'warning'));
  for (const ref of (data.assetDefinitions ?? []) as { id: string; version: string }[]) {
    const def = getAssetById(ref.id);
    if (!def) warnings.push(d('ASSET_UNKNOWN', ref.id, `에셋 정의 ${ref.id} 없음`));
    else if (def.version !== ref.version) warnings.push(d('ASSET_VERSION_DIFF', ref.id, `에셋 정의 버전 차이: 파일 ${ref.version}, 라이브러리 ${def.version} — 자동 업데이트하지 않음`, 'warning'));
  }
  return { ok: true, project: p, warnings };
}

export const LIBRARY_VERSIONS = ASSET_LIBRARY.map((a) => `${a.id}@${a.version}`);
