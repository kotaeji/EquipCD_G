#!/usr/bin/env python3
"""Official-XSD validation of AML files (outside the browser).
Schema: CAEX_ClassModel_V.3.0.xsd from AutomationML e.V. — NOT redistributed with this project (terms unconfirmed).
Download it yourself (see standards/caex3.0/SOURCE.md) and place it at standards/caex3.0/CAEX_ClassModel_V.3.0.xsd
or point the CAEX_XSD environment variable to it. Without the XSD this script reports "not run" and exits 2;
it never reports a pass and never rewrites assets/aml/xsd-report.json.
Usage: python3 scripts/validate-aml.py [files...]   (default: bundled library + samples/aml/*.aml)
Writes a JSON report to stdout; exit 1 if any file that is expected to be valid fails.
XSD validation checks STRUCTURE only. It does not prove AutomationML semantic conformance (role/interface
library rules, AML application recommendations) — those are not checked here."""
import glob, json, sys, datetime
from lxml import etree

import hashlib, os
XSD = os.environ.get('CAEX_XSD', 'standards/caex3.0/CAEX_ClassModel_V.3.0.xsd')
EXPECTED_SHA256 = '36275ee6f39d75a0ba831f44b67a8bda01f44fa0eff103cadc5396cf54ef123f'  # XSD used for the recorded results
SOURCE_PAGE = 'https://www.automationml.org/about-automationml/publications/amlbook/a-practical-guide/chapter-2-the-caex-and-automationml-guide/'
if not os.path.exists(XSD):
    sys.stderr.write(f'''[validate-aml] XSD validation NOT RUN — schema file not found: {XSD}
  The official CAEX 3.0 XSD is not redistributed with this project (redistribution terms unconfirmed).
  1) Open {SOURCE_PAGE}
  2) Download "CAEX_ClassModel_V.3.0.xsd (zip compressed)" and unzip it
  3) Put CAEX_ClassModel_V.3.0.xsd at standards/caex3.0/ (or set CAEX_XSD=/path/to/CAEX_ClassModel_V.3.0.xsd)
  4) Re-run: npm run validate:aml   (needs python3 + lxml: pip install lxml)
  Expected sha256 of the XSD used for the recorded results: {EXPECTED_SHA256}
  assets/aml/xsd-report.json was NOT modified.
''')
    sys.exit(2)
xsd_sha = hashlib.sha256(open(XSD, 'rb').read()).hexdigest()
if xsd_sha != EXPECTED_SHA256:
    sys.stderr.write(f'[validate-aml] warning: XSD sha256 {xsd_sha} differs from the recorded {EXPECTED_SHA256}\n')
schema = etree.XMLSchema(etree.parse(XSD))
files = [a for a in sys.argv[1:] if not a.startswith('--')] or ['assets/aml/ecd-sample-library.aml', *sorted(glob.glob('samples/aml/*.aml'))]
report = []
for f in files:
    r = {'file': f}
    try:
        doc = etree.parse(f)
        r['wellFormed'] = True
        r['schemaVersion'] = doc.getroot().get('SchemaVersion')
        ok = schema.validate(doc)
        r['xsdValid'] = ok
        r['errors'] = [f'line {e.line}: {e.message}' for e in schema.error_log][:20]
    except etree.XMLSyntaxError as e:
        r.update(wellFormed=False, xsdValid=False, errors=[str(e)])
    report.append(r)
print(json.dumps({'xsd': os.path.basename(XSD), 'xsdSha256': xsd_sha, 'tool': f'lxml {etree.__version__} / libxml2 {".".join(map(str, etree.LIBXML_VERSION))}', 'results': report}, ensure_ascii=False, indent=2))
def fnv(t):
    h = 2166136261
    for ch in t:
        h ^= ord(ch); h = (h * 16777619) & 0xFFFFFFFF
    return format(h, 'x')
# record the result for the bundled library so the app can show "XSD 통과 (앱 밖 자동 검사 기록)" only for the identical file text
b = next((r for r in report if r['file'].endswith('ecd-sample-library.aml')), None)
if b:
    text = open('assets/aml/ecd-sample-library.aml', encoding='utf-8').read()
    json.dump({'file': 'aml/ecd-sample-library.aml', 'xsd': 'CAEX_ClassModel_V.3.0.xsd (AutomationML e.V.)', 'xsdSha256': xsd_sha, 'tool': f'lxml {etree.__version__}',
               'xsdValid': b['xsdValid'], 'errors': b['errors'], 'fnv1a': fnv(text), 'checkedAt': datetime.datetime.now().astimezone().isoformat(timespec='seconds')},
              open('assets/aml/xsd-report.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
must = [r for r in report if r['file'].endswith('ecd-sample-library.aml') or 'extra-asset' in r['file']]
sys.exit(0 if all(r['xsdValid'] for r in must) else 1)
