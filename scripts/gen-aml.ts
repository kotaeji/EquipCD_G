// Writes the bundled AML asset library + visual resources. Run: npm run gen:aml
//  assets/aml/ecd-sample-library.aml   (the app's asset source of truth, CAEX 3.0)
//  assets/visuals/schematic/<kind>.svg (non-photo schematics rendered from src/ui/Symbols.tsx)
//  assets/visuals/photos/*.jpg + photo-manifest.json + ATTRIBUTION.md (copied from media-sources/, real photos, not generated)
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { serializeAmlLibrary } from '../src/assets/aml';
import { Symbol } from '../src/ui/Symbols';
import { seedDefinitions } from './asset-seed';

const manifest = JSON.parse(readFileSync('media-sources/manifest.json', 'utf8'));
const scope: Record<string, string> = {};
for (const [k, v] of Object.entries<any>(manifest)) if (k !== '_meta') scope[k] = v.scopeNote;
const defs = seedDefinitions(scope);

mkdirSync('assets/aml', { recursive: true });
rmSync('assets/aml', { recursive: true, force: true }); mkdirSync('assets/aml', { recursive: true });
writeFileSync('assets/aml/ecd-sample-library.aml', serializeAmlLibrary(defs, { fileName: 'ecd-sample-library.aml', lastWritingDateTime: '2026-11-08T00:00:00Z', originVersion: '0.2.0' }));

rmSync('assets/visuals', { recursive: true, force: true });
mkdirSync('assets/visuals/schematic', { recursive: true }); mkdirSync('assets/visuals/photos', { recursive: true });
const colors: Record<string, string> = { '--text': '#172B4D', '--accent': '#2563EB', '--panel': '#FFFFFF', '--grid': '#E8EDF4', '--muted': '#64748B' };
for (const d of defs) {
  const [w, h] = d.template ? [120, 80] : [80, 60];
  let svg = renderToStaticMarkup(createElement('svg', { xmlns: 'http://www.w3.org/2000/svg', width: w, height: h, viewBox: `0 0 ${w} ${h}` }, createElement(Symbol, { kind: d.kind, w, h })));
  for (const [k, v] of Object.entries(colors)) svg = svg.split(`var(${k})`).join(v);
  writeFileSync(`assets/visuals/schematic/${d.kind}.svg`, `<!-- schematic (non-photo, hand-drawn vector) for ${d.kind} — not a product drawing -->\n${svg}\n`);
}
const byFile: Record<string, any> = {};
for (const [k, v] of Object.entries<any>(manifest)) {
  if (k === '_meta') continue;
  const file = v.file.split('/').pop();
  byFile[file] ??= { file, title: v.title, author: v.author, license: v.license, licenseUrl: v.licenseUrl, sourcePageUrl: v.sourcePageUrl, originalImageUrl: v.originalImageUrl,
    attribution: v.attribution, captureType: v.actualPhoto ? 'actual-photo' : 'unknown', width: v.width, height: v.height, bytes: v.bytes, usedBy: [] };
  byFile[file].usedBy.push(k);
  copyFileSync(v.file, `assets/visuals/photos/${file}`);
}
writeFileSync('assets/visuals/photo-manifest.json', JSON.stringify({ _meta: { ...manifest._meta, note: `${manifest._meta.note} 대표 범위(class/component/assembly)는 에셋별로 AML ReferencePhoto 인터페이스(ECD.PhotoMatchType)에 기록.` }, photos: byFile }, null, 2));
copyFileSync('media-sources/ATTRIBUTION.md', 'assets/visuals/ATTRIBUTION.md');
console.log(`wrote AML with ${defs.length} SystemUnitClasses, ${defs.length} schematics, ${Object.keys(byFile).length} photos`);
