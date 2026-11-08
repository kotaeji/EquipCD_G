// Asset library = definitions READ FROM AML (C02-04). The bundled library file is assets/aml/ecd-sample-library.aml;
// there is no hard-coded definition list in the app. Additional AML files can be imported at runtime (registerImported).
import bundledAml from '../../assets/aml/ecd-sample-library.aml?raw';
import type { AssetDefinition, AssetKind } from '../model/types';
import { parseAmlLibrary, serializeAmlLibrary, type AmlParseResult } from './aml';

export const BUNDLED_AML_FILE = 'aml/ecd-sample-library.aml';
export const BUNDLED_AML_TEXT: string = bundledAml;

export interface LoadedLibrary { file: string; origin: 'bundled' | 'imported'; result: AmlParseResult; loadedAt: string }

const bundled = parseAmlLibrary(bundledAml, BUNDLED_AML_FILE, 'bundled');
if (!bundled.ok) console.error('bundled AML library has errors', bundled.diags);

/** live list (mutated by registerImported) */
export const ASSET_LIBRARY: AssetDefinition[] = [...bundled.defs];
export const LOADED_LIBRARIES: LoadedLibrary[] = [{ file: BUNDLED_AML_FILE, origin: 'bundled', result: bundled, loadedAt: 'build' }];

export interface ImportOutcome { added: AssetDefinition[]; skipped: { id: string; reason: string }[]; result: AmlParseResult }

/**
 * Register definitions from an imported AML. Only error-free definitions are added (C02-10); existing definitions
 * with the same ID are never overwritten (same ID + same version = skip as duplicate, different version = conflict).
 */
export function registerImported(xml: string, file: string): ImportOutcome {
  const result = parseAmlLibrary(xml, file, 'imported');
  const added: AssetDefinition[] = []; const skipped: ImportOutcome['skipped'] = [];
  for (const d of result.defs) {
    const ex = ASSET_LIBRARY.find((x) => x.id === d.id || x.kind === d.kind);
    if (ex) { skipped.push({ id: d.id, reason: ex.id === d.id && ex.version === d.version ? `이미 로드됨 (${ex.amlSource.file})` : `ID/이름 충돌: 기존 ${ex.id}@${ex.version} (${ex.amlSource.file}) — 덮어쓰지 않음` }); continue; }
    added.push(d);
  }
  // unit templates whose children are not available are rejected
  for (const d of [...added]) if (d.template) {
    const miss = d.template.children.filter((c) => !ASSET_LIBRARY.some((x) => x.id === c.assetId) && !added.some((x) => x.id === c.assetId));
    if (miss.length) { added.splice(added.indexOf(d), 1); skipped.push({ id: d.id, reason: `자식 정의 없음: ${miss.map((m) => m.assetId).join(', ')}` }); }
  }
  ASSET_LIBRARY.push(...added);
  LOADED_LIBRARIES.push({ file, origin: 'imported', result, loadedAt: new Date().toISOString() });
  return { added, skipped, result };
}

/** test helper: drop imported definitions */
export function resetImported() {
  ASSET_LIBRARY.splice(0, ASSET_LIBRARY.length, ...bundled.defs);
  LOADED_LIBRARIES.splice(1);
}

export function findAsset(kind: AssetKind): AssetDefinition | undefined { return ASSET_LIBRARY.find((x) => x.kind === kind); }
export function getAsset(kind: AssetKind): AssetDefinition {
  const a = findAsset(kind);
  if (!a) throw new Error(`unknown asset kind ${kind}`);
  return a;
}
export function getAssetById(id: string): AssetDefinition | undefined { return ASSET_LIBRARY.find((x) => x.id === id); }

/** Export current library (bundled + imported) as one CAEX 3.0 file. */
export function exportLibraryAml(defs: AssetDefinition[] = ASSET_LIBRARY, at = new Date().toISOString()): string {
  return serializeAmlLibrary(defs, { fileName: 'ecd-library-export.aml', lastWritingDateTime: at.replace(/\.\d+Z$/, 'Z'), originVersion: '0.2.0' });
}
