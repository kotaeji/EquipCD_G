// Creates release ZIPs (node_modules / dist excluded) with python zipfile:
//  - equipment-concept-designer-src.zip          full source + docs + assets + samples
//  - equipment-concept-designer-verification.zip verification docs + screenshots + machine-readable results
//  - equipment-concept-designer-assets.zip       AML library + visuals (schematics, photos, attribution) + CAEX XSD source/hash note (XSD itself NOT included) + AML samples
// Third-party files whose redistribution terms are unconfirmed (official CAEX XSD) are never packaged: EXCLUDE_EXT.
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const PY = join(tmpdir(), 'ecd-zip.py');

function zip(out, root, items) {
  if (existsSync(out)) rmSync(out);
  const py = `import zipfile,os,sys,json
out,root,items=sys.argv[1],sys.argv[2],json.loads(sys.argv[3])
EXCL=('.xsd',)
n=0
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
  for it in items:
    if os.path.isdir(it):
      for r,ds,fs in os.walk(it):
        ds[:]=sorted(d for d in ds if d not in ('node_modules','dist','__MACOSX'))
        for f in sorted(fs):
          if f.lower().endswith(EXCL): continue
          z.write(os.path.join(r,f), os.path.join(root, r, f)); n+=1
    elif os.path.exists(it) and not it.lower().endswith(EXCL): z.write(it, os.path.join(root, it)); n+=1
    else: print('missing', it, file=sys.stderr); sys.exit(1)
bad=[x for x in zipfile.ZipFile(out).namelist() if x.lower().endswith(EXCL)]
if bad: print('excluded file packaged', bad, file=sys.stderr); sys.exit(1)
print(out, n, 'files (no .xsd)')`;
  writeFileSync(PY, py);
  execFileSync('python3', [PY, out, root, JSON.stringify(items)], { stdio: 'inherit' });
}

const docs = ['README.md', 'REQUIREMENTS-VERIFICATION.md', 'AMBIGUITIES.md', 'AML-SUPPORT.md', 'BROWSER-TEST-SCENARIOS.md', 'BROWSER-VERIFICATION.md'];
zip('release/equipment-concept-designer-src.zip', 'equipment-concept-designer', ['package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'index.html',
  'src', 'tests', 'scripts', 'assets', 'samples', 'docs', 'standards', 'media-sources', ...docs]);
zip('release/equipment-concept-designer-verification.zip', 'equipment-concept-designer-verification', [...docs, 'docs/screenshots', 'docs/verification', 'docs/requirements-v0.2.md']);
zip('release/equipment-concept-designer-assets.zip', 'equipment-concept-designer-assets', ['assets/aml', 'assets/visuals', 'standards/caex3.0', 'samples/aml', 'AML-SUPPORT.md']);
