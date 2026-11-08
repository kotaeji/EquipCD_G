// Visual resources referenced by AML ExternalDataReference (refURI relative to the AML file).
// Bundled photos/schematics are inlined at build time (offline single HTML). Imported AML files cannot ship
// image files with them in this prototype → their photo refs are reported as "참조 해석 불가" and fall back to schematic.
import manifest from '../../assets/visuals/photo-manifest.json';
import type { AssetDefinition, PhotoScope } from '../model/types';

const photoUrls = import.meta.glob('../../assets/visuals/photos/*.jpg', { eager: true, query: '?inline', import: 'default' }) as Record<string, string>;

export interface PhotoInfo {
  file: string; title: string; author: string; license: string; licenseUrl: string; sourcePageUrl: string; originalImageUrl: string;
  attribution: string; captureType: 'actual-photo' | 'unknown'; width: number; height: number; bytes: number; usedBy: string[];
}
export const PHOTO_COMMON_NOTICE: string = (manifest as any)._meta.commonNotice;
const PHOTOS = (manifest as any).photos as Record<string, PhotoInfo>;

export type PhotoResolution =
  | { status: 'available'; url: string; info: PhotoInfo; scope: PhotoScope | null }
  | { status: 'missing'; reason: string };

/** Resolve the AML ReferencePhoto of a definition to an inlined image + attribution. Never fabricates a photo. */
export function resolvePhoto(def: AssetDefinition): PhotoResolution {
  const ref = def.visualRefs.photo;
  if (!ref) return { status: 'missing', reason: '실제 사진 미확보 (AML에 ReferencePhoto 참조 없음) — 도식으로 대체' };
  if (def.amlSource.origin !== 'bundled') return { status: 'missing', reason: `가져온 AML의 사진 참조 ${ref} 는 이 시제품에서 해석 불가 (파일 동봉 미지원) — 도식으로 대체` };
  const file = ref.split('/').pop()!;
  const url = Object.entries(photoUrls).find(([k]) => k.endsWith(`/photos/${file}`))?.[1];
  const info = PHOTOS[file];
  if (!url || !info) return { status: 'missing', reason: `사진 파일 ${ref} 없음 — 도식으로 대체` };
  return { status: 'available', url, info, scope: def.visualRefs.photoScope };
}

export const MATCH_LABEL: Record<PhotoScope['matchType'], string> = {
  'class-reference': '같은 종류(클래스) 대표 사진', 'component-reference': '구성품 참고 사진 (조립체 아님)',
  'assembly-reference': '복합 조립체 참고 구조 사진', 'exact-model': '정확 모델 사진',
};
export const MATCH_SHORT: Record<PhotoScope['matchType'], string> = { 'class-reference': '종류 대표', 'component-reference': '구성품', 'assembly-reference': '조립체 참고', 'exact-model': '정확 모델' };
