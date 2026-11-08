import { copyFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
mkdirSync('release', { recursive: true });
const html = readFileSync('dist/index.html', 'utf8');
// sanity: standalone file must not reference external scripts/styles
const ext = html.match(/<(script|link)[^>]+(src|href)="(?!data:)[^"]+"/g);
if (ext) { console.error('External references found in build output:', ext); process.exit(1); }
// sanity: no Unicode noncharacters / lone surrogates (Vite's HTML parser rejects them → HTTP 500 when served via the dev server)
const nonchar = [...html].findIndex((ch) => { const o = ch.codePointAt(0); return (o & 0xfffe) === 0xfffe || (o >= 0xfdd0 && o <= 0xfdef) || (o >= 0xd800 && o <= 0xdfff); });
if (nonchar >= 0) { console.error(`Unicode noncharacter in build output near ${JSON.stringify(html.slice(Math.max(0, nonchar - 40), nonchar + 10))}`); process.exit(1); }
copyFileSync('dist/index.html', 'release/equipment-concept-designer.html');
console.log(`release/equipment-concept-designer.html (${statSync('release/equipment-concept-designer.html').size} bytes, no external script/link refs, no Unicode noncharacters)`);
