#!/usr/bin/env python3
"""Build the user-manual PDF from the same Markdown source - offline file conversion only.

Markdown --(python-markdown)--> HTML + print CSS --(WeasyPrint)--> PDF.
No web browser, no network access, no remote debugging. Images are read from the
repository (e.g. ../screenshots/*.png) and embedded; relative repository links are
rewritten to GitHub URLs pinned to --ref (or --fallback-ref for files newer than --ref) so the PDF never contains local file paths.

Requirements (see requirements-pdf.txt): Python 3.9+, markdown, weasyprint, and a
Korean font installed on the system (Noto Sans CJK KR or NanumGothic, etc.).

Usage (repository root):
  python3 -m venv .venv-manual && .venv-manual/bin/pip install -r docs/user-manual/requirements-pdf.txt
  .venv-manual/bin/python docs/user-manual/build_user_manual_pdf.py \
      --md docs/user-manual/USER-MANUAL.ko.md --out docs/user-manual/USER-MANUAL.ko.pdf --ref <commit-sha>
"""
from __future__ import annotations

import argparse
import posixpath
import re
import subprocess
import sys
from pathlib import Path

import markdown
from weasyprint import HTML

REPO_URL = 'https://github.com/kotaeji/EquipCD_G'


def github_slug(value: str, separator: str = '-') -> str:
    """GitHub-style heading anchor: lowercase, drop punctuation (keep unicode word chars, '-', ' '), spaces -> '-'."""
    value = re.sub(r'<[^>]+>', '', value).strip().lower()
    value = re.sub(r'[^\w\- ]', '', value, flags=re.UNICODE)
    return value.replace(' ', separator)


CSS = r'''
@page {
  size: A4; margin: 18mm 16mm 18mm 16mm;
  @bottom-center { content: counter(page) " / " counter(pages); font-size: 8.5pt; color: #666; }
  @top-right { content: "Aurora Concept Designer v0.3 사용자 매뉴얼"; font-size: 8pt; color: #888; }
}
html { font-family: "Noto Sans CJK KR", "NanumGothic", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; font-size: 10pt; line-height: 1.55; color: #1b1f24; }
h1 { font-size: 19pt; margin: 0 0 10pt; line-height: 1.3; }
h2 { font-size: 14pt; margin: 18pt 0 6pt; padding-bottom: 3pt; border-bottom: 1px solid #ccd3dc; page-break-after: avoid; }
h3 { font-size: 11.5pt; margin: 12pt 0 4pt; page-break-after: avoid; }
p, li { orphans: 2; widows: 2; }
a { color: #1d4ed8; text-decoration: none; overflow-wrap: anywhere; }
code { font-family: "DejaVu Sans Mono", "Noto Sans CJK KR", monospace; font-size: 8.6pt; background: #f2f4f7; padding: 0 2pt; border-radius: 2pt; overflow-wrap: anywhere; }
pre { background: #f2f4f7; border: 1px solid #dde3ea; border-radius: 3pt; padding: 6pt 8pt; white-space: pre-wrap; overflow-wrap: anywhere; page-break-inside: avoid; }
pre code { background: none; padding: 0; font-size: 8.4pt; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 8.8pt; table-layout: auto; }
th, td { border: 1px solid #ccd3dc; padding: 3pt 5pt; vertical-align: top; text-align: left; overflow-wrap: break-word; word-break: keep-all; }
th { background: #eef1f5; }
td:first-child, th:first-child { min-width: 5em; }
tr { page-break-inside: avoid; }
blockquote { margin: 8pt 0; padding: 4pt 10pt; border-left: 3pt solid #f0b429; background: #fff8e6; }
img { max-width: 100%; height: auto; border: 1px solid #ccd3dc; display: block; margin: 6pt auto 2pt; }
em { color: #444; }
'''


def exists_at(repo_root: Path, ref: str, path: str) -> bool:
    r = subprocess.run(['git', '-C', str(repo_root), 'cat-file', '-e', f'{ref}:{path}'], capture_output=True)
    return r.returncode == 0


def rewrite_links(html: str, md_path: Path, repo_root: Path, ref: str, fallback_ref: str) -> str:
    md_dir = md_path.parent.resolve().relative_to(repo_root.resolve()).as_posix()

    def fix(m: re.Match) -> str:
        href = m.group(2)
        if re.match(r'^(https?:|mailto:|#)', href):
            return m.group(0)
        target = posixpath.normpath(posixpath.join(md_dir, href.split('#')[0]))
        if target.startswith('..'):
            raise SystemExit(f'link escapes repository: {href}')
        anchor = ('#' + href.split('#', 1)[1]) if '#' in href else ''
        kind = 'tree' if (repo_root / target).is_dir() else 'blob'
        use = ref if exists_at(repo_root, ref, target) else fallback_ref  # files added after --ref
        return f'{m.group(1)}{REPO_URL}/{kind}/{use}/{target}{anchor}"'

    return re.sub(r'(<a [^>]*href=")([^"]+)"', fix, html)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--md', required=True, type=Path)
    ap.add_argument('--out', required=True, type=Path)
    ap.add_argument('--ref', required=True, help='git commit SHA (or tag) that relative links in the PDF should point to')
    ap.add_argument('--fallback-ref', default='main', help='ref used for linked files that do not exist at --ref yet')
    ap.add_argument('--repo-root', type=Path, default=Path('.'))
    a = ap.parse_args()

    src = a.md.read_text(encoding='utf-8')
    body = markdown.markdown(src, extensions=['tables', 'fenced_code', 'sane_lists', 'toc'],
                             extension_configs={'toc': {'slugify': github_slug, 'permalink': False}}, output_format='html5')
    body = rewrite_links(body, a.md, a.repo_root, a.ref, a.fallback_ref)
    title = re.search(r'^# (.+)$', src, re.M).group(1).strip()
    doc = f'<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>{title}</title><style>{CSS}</style></head><body>{body}</body></html>'
    # base_url = Markdown folder: images such as ../screenshots/x.png are resolved and embedded from local files
    HTML(string=doc, base_url=str(a.md.parent.resolve()) + '/').write_pdf(str(a.out))
    missing = [m for m in re.findall(r'<img [^>]*src="([^"]+)"', body) if not (a.md.parent / m).exists()]
    if missing:
        print('missing images:', missing, file=sys.stderr)
        return 1
    print(f'wrote {a.out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
