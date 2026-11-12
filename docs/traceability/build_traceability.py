#!/usr/bin/env python3
"""docs/FEATURE-LIST.md 에서 기능 추적 파일 두 개를 만든다.

- Feature_Traceability.xlsx  (openpyxl 필요 — requirements-trace.txt)
- Feature_Map.html            (표준 라이브러리만, 한 파일)

정본은 docs/FEATURE-LIST.md 다. 두 파일은 거기서 뽑은 보기용 사본이므로 손으로 고치지 않는다.
기능 목록을 고치면 이 스크립트를 다시 돌린다.

    python3 -m venv /tmp/venv-trace && /tmp/venv-trace/bin/pip install -r docs/traceability/requirements-trace.txt
    /tmp/venv-trace/bin/python docs/traceability/build_traceability.py   # 저장소 밖 가상 환경 — 프로젝트 의존성 아님
"""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
DOCS = HERE.parent
ROOT = DOCS.parent
FL_MD = DOCS / "FEATURE-LIST.md"
MANUAL_MD = DOCS / "user-manual" / "USER-MANUAL.ko.md"
UX_MD = DOCS / "UX-SCENARIOS.md"
REQ_MD = DOCS / "requirements-v0.3.md"
GH = "https://github.com/kotaeji/EquipCD_G/blob/main/docs/"

STATUS_ORDER = ["✅", "◐", "📄", "✗"]
STATUS_NAME = {"✅": "구현", "◐": "일부 구현", "📄": "안내 화면만", "✗": "미구현"}
PDF = {
    "WF": "design-review/figma/Aurora-Wireframes.ko.pdf",
    "UX": "design-review/figma/Aurora-UX-Scenarios.ko.pdf",
    "GUI": "design-review/figma/Aurora-GUI-Light-Dark.ko.pdf",
}


# ---------------------------------------------------------------- 읽기
def cells(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def slug(text: str) -> str:
    """GitHub 머리글 앵커."""
    t = text.strip().lower().replace("`", "")
    t = re.sub(r"[^\w\- ]", "", t)
    return t.replace(" ", "-")


def git_head() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT,
                              capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return "?"


def parse_feature_list():
    lines = FL_MD.read_text(encoding="utf-8").splitlines()
    base = next((l for l in lines if l.startswith("- 기준:")), "")
    screens, features, reqs, review = {}, [], [], []
    variants = {}
    section, group = "", ""
    for l in lines:
        if l.startswith("## "):
            section = l[3:].strip()
        if l.startswith("### "):
            group = l[4:].strip()
        if l.startswith("상태 변형 `Vxx`"):
            for m in re.finditer(r"(V\d\d)(?:·(V\d\d))? ([^(]+?)\(([\d·]+)\)", l):
                pages = m.group(4).split("·")
                for i, vid in enumerate([m.group(1), m.group(2)]):
                    if vid:
                        variants[vid] = {"id": vid, "name": m.group(3).strip(),
                                         "gui": int(pages[min(i, len(pages) - 1)])}
        if not l.startswith("| ") or l.startswith("|---"):
            continue
        c = cells(l)
        if section.startswith("1.") and re.fullmatch(r"S\d\d", c[0]):
            screens[c[0]] = {"id": c[0], "name": c[1], "where": c[2].replace("**", ""), "wfText": c[3],
                             "wf": int(c[4]), "ux": int(c[5]), "gui": int(c[6]), "shot": c[7]}
        elif section.startswith("2.") and c[0].startswith("FL-"):
            st = c[5]
            status = next((s for s in STATUS_ORDER if s in st), "?")
            step = re.sub(r"^2\.\d\s*", "", group)
            features.append({
                "id": c[0], "step": step, "name": c[1].replace("`", ""),
                "reqs": [r.strip() for r in re.split(r"·", c[2]) if r.strip()],
                "screens": re.findall(r"[SV]\d\d(?:–V\d\d)?", c[3]) or [c[3]],
                "ux": re.findall(r"UX-\d\d", c[4]),
                "status": status, "human": "👤" in st, "evidence": c[6].replace("`", ""),
            })
        elif section.startswith("3.") and re.match(r"[CFN]\d", c[0]):
            reqs.append({"id": c[0], "scope": c[1], "features": c[2], "now": c[3], "gap": c[4]})
        elif section.startswith("4.") and c[0].startswith("TURN-"):
            review.append({"turn": c[0], "what": c[1], "features": c[2]})
    # V05–V08 같은 범위 펼치기
    for f in features:
        out = []
        for s in f["screens"]:
            m = re.fullmatch(r"V(\d\d)–V(\d\d)", s)
            out += [f"V{i:02d}" for i in range(int(m.group(1)), int(m.group(2)) + 1)] if m else [s]
        f["screens"] = out
    return base, screens, variants, features, reqs, review


def expand_fl(text: str) -> list[str]:
    """'FL-01 · 02 · 05–09' → FL-01, FL-02, FL-05..FL-09"""
    out = []
    for part in re.split(r"·", text):
        nums = re.findall(r"\d\d", part)
        if "–" in part and len(nums) == 2:
            out += [f"FL-{i:02d}" for i in range(int(nums[0]), int(nums[1]) + 1)]
        elif nums:
            out.append(f"FL-{nums[0]}")
    return out


def parse_manual(feature_ids):
    """기능 → 매뉴얼 절(가장 구체적인 소절)과 그 절의 그림."""
    lines = MANUAL_MD.read_text(encoding="utf-8").splitlines()
    heads, cur = [], None
    for l in lines:
        m = re.match(r"^(#{2,3}) (.+)$", l)
        if m:
            cur = {"level": len(m.group(1)), "title": m.group(2).strip(), "images": []}
            cur["anchor"] = slug(cur["title"])
            cur["fl"] = re.findall(r"FL-\d\d", cur["title"])
            heads.append(cur)
            continue
        im = re.match(r"!\[([^\]]*)\]\((images/[^)]+)\)", l)
        if im and cur:
            cur["images"].append({"src": im.group(2), "alt": im.group(1)})
    # 부록 A: FL → 절 번호
    appendix = {}
    in_a = False
    for l in lines:
        if l.startswith("## 부록 A"):
            in_a = True
        elif l.startswith("## ") and in_a:
            break
        elif in_a and l.startswith("| FL-"):
            c = cells(l)
            appendix[c[0]] = [s.strip() for s in c[3].split(",")]
    out = {}
    for fid in feature_ids:
        secs = []
        sub = [h for h in heads if h["level"] == 3 and fid in h["fl"]]
        for h in sub:
            secs.append(h)
        for num in appendix.get(fid, []):
            top = next((h for h in heads if h["level"] == 2 and h["title"].startswith(f"{num}.")), None)
            if top and not any(s["title"].startswith(f"{num}.") for s in secs):
                secs.append(top)
        imgs = []
        for s in secs:
            # 그 절 바로 아래 그림만 — 다른 기능을 다루는 소절 그림은 가져오지 않는다
            for im in s["images"]:
                if im not in imgs:
                    imgs.append(im)
        out[fid] = {
            "sections": [{"title": s["title"].replace("`", ""), "anchor": s["anchor"]} for s in secs],
            "images": imgs[:3],
            "appendix": appendix.get(fid, []),
        }
    return out


def parse_ux():
    ux = {}
    for l in UX_MD.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^### (UX-\d\d) — (.+)$", l)
        if m:
            ux[m.group(1)] = {"id": m.group(1), "title": m.group(2).strip(), "anchor": slug(l[4:])}
    return ux


def parse_req_titles():
    t = {}
    for l in REQ_MD.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^### ([CN]\d\d)\. (.+)$", l)
        if m and m.group(1) not in t:
            t[m.group(1)] = m.group(2).strip()
        m = re.match(r"^## \d+\. (F\d) (.+)$", l)
        if m:
            t[m.group(1)] = m.group(2).strip()
    return t


def build():
    base, screens, variants, features, reqs, review = parse_feature_list()
    manual = parse_manual([f["id"] for f in features])
    ux = parse_ux()
    req_titles = parse_req_titles()
    for r in reqs:
        r["featureIds"] = expand_fl(r["features"])
        r["title"] = req_titles.get(r["id"].split(" ")[0], "")
    for f in features:
        f["manual"] = manual[f["id"]]
    return {
        "base": base.replace("- 기준:", "").replace("`", "").strip(),
        "builtFrom": git_head(),
        "screens": screens, "variants": variants, "features": features,
        "reqs": reqs, "review": review, "ux": ux, "reqTitles": req_titles,
    }


# ---------------------------------------------------------------- xlsx
def write_xlsx(d, path: Path):
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    head_fill = PatternFill("solid", fgColor="1F3A68")
    head_font = Font(bold=True, color="FFFFFF")
    st_fill = {"✅": "E3F4E8", "◐": "FFF4D6", "📄": "E8EEF8", "✗": "FBE3E3"}
    wrap = Alignment(wrap_text=True, vertical="top")

    def sheet(title, header, rows, widths, status_col=None):
        ws = wb.create_sheet(title)
        ws.append(header)
        for c in ws[1]:
            c.fill, c.font, c.alignment = head_fill, head_font, Alignment(vertical="center", wrap_text=True)
        for r in rows:
            ws.append(r)
        for row in ws.iter_rows(min_row=2):
            for c in row:
                c.alignment = wrap
            if status_col is not None:
                v = str(row[status_col].value or "")
                k = next((s for s in STATUS_ORDER if v.startswith(s)), None)
                if k:
                    row[status_col].fill = PatternFill("solid", fgColor=st_fill[k])
        for i, w in enumerate(widths, 1):
            ws.column_dimensions[get_column_letter(i)].width = w
        ws.freeze_panes = "B2"
        ws.auto_filter.ref = ws.dimensions
        return ws

    # 0 읽는 법
    ws = wb.active
    ws.title = "읽는 법"
    info = [
        ["Aurora Concept Designer — 기능 추적표"],
        [],
        ["정본", "docs/FEATURE-LIST.md (이 파일은 그 문서에서 뽑은 사본 — 손으로 고치지 않는다)"],
        ["기능 목록 기준", d["base"]],
        ["이 파일을 만든 커밋", d["builtFrom"]],
        ["만드는 법", "docs/traceability/build_traceability.py"],
        ["상태", "✅ 구현 · ◐ 일부 구현 · 📄 안내 화면만 · ✗ 미구현 · 👤 사람 검수 대기"],
        ["검토 상태", "검토 후보. 사람 검수 전. 요구 ID 는 공개본 requirements-v0.3.md 기준이며 앰플노트 정본과 대조하지 않았다"],
        [],
        ["시트", "내용"],
        ["기능 목록", "기능 52개 — 요구 · 화면 · UX · 시안 PDF 쪽 · 매뉴얼 절 · 상태 · 근거를 한 줄로"],
        ["요구 커버리지", "요구(C·F·N) → 맡는 기능, 지금 상태, 안 된 것"],
        ["화면 커버리지", "화면 ID(S·V) → 앱 위치, 와이어프레임·UX·GUI 시안 쪽, 그 화면을 쓰는 기능"],
        ["UX 커버리지", "UX-01~12 → 기능, 화면"],
        ["사람 검수 대기", "TURN 별로 Matthew 가 볼 것"],
    ]
    for r in info:
        ws.append(r)
    ws["A1"].font = Font(bold=True, size=14)
    for r in (3, 4, 5, 6, 7, 8, 10):
        ws[f"A{r}"].font = Font(bold=True)
    ws.column_dimensions["A"].width = 22
    ws.column_dimensions["B"].width = 110

    def pages(f, kind):
        out = []
        for s in f["screens"]:
            if s in d["screens"]:
                out.append(f"{s}:{d['screens'][s][kind]}")
            elif s in d["variants"] and kind == "gui":
                out.append(f"{s}:{d['variants'][s]['gui']}")
        return " · ".join(out)

    rows = []
    for f in d["features"]:
        st = f["status"] + " " + STATUS_NAME.get(f["status"], "")
        rows.append([
            f["id"], f["step"], f["name"], " · ".join(f["reqs"]), " · ".join(f["screens"]),
            " · ".join(f["ux"]), pages(f, "wf"), pages(f, "ux"), pages(f, "gui"),
            " · ".join(s["title"] for s in f["manual"]["sections"]) or "—",
            st, "👤" if f["human"] else "", f["evidence"],
        ])
    sheet("기능 목록",
          ["ID", "단계", "기능", "요구", "화면", "UX", "WF 시안 쪽", "UX 시안 쪽", "GUI 시안 쪽",
           "매뉴얼 절", "상태", "사람 검수", "근거"],
          rows, [8, 18, 52, 16, 14, 14, 14, 14, 14, 36, 12, 8, 40], status_col=10)

    rows = []
    for r in d["reqs"]:
        rows.append([r["id"], r["title"], r["scope"], ", ".join(r["featureIds"]) or r["features"],
                     len(r["featureIds"]), r["now"], r["gap"]])
    sheet("요구 커버리지", ["요구", "요구 이름(v0.3)", "범위", "기능", "기능 수", "지금", "안 된 것"],
          rows, [10, 30, 30, 40, 8, 14, 46], status_col=5)

    by_screen = {}
    for f in d["features"]:
        for s in f["screens"]:
            by_screen.setdefault(s, []).append(f)
    rows = []
    for sid, s in d["screens"].items():
        fs = by_screen.get(sid, [])
        rows.append([sid, s["name"], s["where"], s["wfText"], s["wf"], s["ux"], s["gui"],
                     ", ".join(f["id"] for f in fs), " ".join(sorted({f["status"] for f in fs}, key=STATUS_ORDER.index)),
                     s["shot"]])
    for vid, v in d["variants"].items():
        fs = by_screen.get(vid, [])
        rows.append([vid, v["name"], "상태 변형", "", "", "", v["gui"], ", ".join(f["id"] for f in fs),
                     " ".join(sorted({f["status"] for f in fs}, key=STATUS_ORDER.index)), ""])
    sheet("화면 커버리지",
          ["화면", "이름", "지금 앱 위치", "텍스트 WF", "WF 쪽", "UX 쪽", "GUI 쪽", "기능", "기능 상태", "지금 화면 스크린샷"],
          rows, [8, 22, 46, 12, 7, 7, 7, 30, 12, 22])

    rows = []
    for uid, u in d["ux"].items():
        fs = [f for f in d["features"] if uid in f["ux"]]
        scr = sorted({s for f in fs for s in f["screens"]})
        rows.append([uid, u["title"], ", ".join(f["id"] for f in fs), len(fs),
                     " ".join(f"{k}{sum(1 for f in fs if f['status'] == k)}" for k in STATUS_ORDER
                              if any(f["status"] == k for f in fs)),
                     ", ".join(scr)])
    sheet("UX 커버리지", ["UX", "시나리오", "기능", "기능 수", "상태별 수", "화면"],
          rows, [8, 40, 44, 8, 16, 40])

    sheet("사람 검수 대기", ["TURN", "무엇을 보나", "기능"],
          [[r["turn"], r["what"], r["features"]] for r in d["review"]], [16, 50, 24])

    wb.save(path)


# ---------------------------------------------------------------- html
def write_html(d, path: Path):
    data = json.dumps({**d, "gh": GH, "pdf": PDF}, ensure_ascii=False)
    html = HTML_TEMPLATE.replace("/*__DATA__*/null", data)
    path.write_text(html, encoding="utf-8")


HTML_TEMPLATE = r"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Aurora 기능 지도</title>
<style>
:root{
  --bg:#f6f7f9;--panel:#ffffff;--ink:#1b2430;--muted:#5d6876;--line:#dde2e8;--soft:#eef1f5;
  --brand:#a8002f;--accent:#245bce;--accent-soft:#e5edff;
  --ok:#1f7a3d;--ok-bg:#e3f4e8;--part:#8a5a00;--part-bg:#fff4d6;--doc:#2f4f86;--doc-bg:#e8eef8;--no:#b42318;--no-bg:#fbe3e3;
  --focus:#245bce;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --bg:#11151b;--panel:#181d25;--ink:#e6eaf0;--muted:#9aa5b3;--line:#2b333f;--soft:#202733;
    --brand:#ff6b8a;--accent:#8fb0ff;--accent-soft:#1f2b45;
    --ok:#7fd99a;--ok-bg:#16301f;--part:#f2c46b;--part-bg:#3a2e12;--doc:#a9c1f0;--doc-bg:#1d2840;--no:#ff9a8f;--no-bg:#3d1c1a;
    --focus:#8fb0ff;
  }
}
:root[data-theme="dark"]{
  --bg:#11151b;--panel:#181d25;--ink:#e6eaf0;--muted:#9aa5b3;--line:#2b333f;--soft:#202733;
  --brand:#ff6b8a;--accent:#8fb0ff;--accent-soft:#1f2b45;
  --ok:#7fd99a;--ok-bg:#16301f;--part:#f2c46b;--part-bg:#3a2e12;--doc:#a9c1f0;--doc-bg:#1d2840;--no:#ff9a8f;--no-bg:#3d1c1a;
  --focus:#8fb0ff;
}
*{box-sizing:border-box}
html,body{margin:0}
body{background:var(--bg);color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif}
a{color:var(--accent)}
:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
header{padding:20px 24px 12px;border-bottom:1px solid var(--line);background:var(--panel)}
header h1{margin:0;font-size:20px;letter-spacing:-.01em}
header h1 span{color:var(--brand)}
header p{margin:4px 0 0;color:var(--muted);font-size:13px}
.summary{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.stat{display:flex;align-items:baseline;gap:6px;padding:6px 10px;border-radius:8px;background:var(--soft);font-size:13px}
.stat b{font-size:18px;font-variant-numeric:tabular-nums}
.controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:12px 24px;border-bottom:1px solid var(--line);background:var(--panel);position:sticky;top:0;z-index:2}
.controls input[type=search],.controls select{height:32px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink);padding:0 10px;font:inherit}
.controls input[type=search]{min-width:0;flex:1 1 220px}
.controls select{max-width:100%;min-width:0}
.chip{height:32px;padding:0 10px;border:1px solid var(--line);border-radius:16px;background:var(--panel);color:var(--ink);font:inherit;cursor:pointer}
.chip[aria-pressed="true"]{background:var(--accent-soft);border-color:var(--accent);color:var(--accent);font-weight:600}
.count{margin-left:auto;color:var(--muted);font-size:13px}
main{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,440px);gap:0;min-height:calc(100vh - 200px)}
.list{overflow:auto}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{position:sticky;top:0;background:var(--soft);font-size:12px;color:var(--muted);font-weight:600;z-index:1}
tbody tr{cursor:pointer}
tbody tr:hover{background:var(--soft)}
tbody tr[aria-selected="true"]{background:var(--accent-soft)}
td.id{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;white-space:nowrap}
td.step{color:var(--muted);font-size:12px;white-space:nowrap}
.tag{display:inline-block;padding:0 6px;margin:1px 2px 1px 0;border-radius:4px;background:var(--soft);font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap}
.st{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;font-weight:600;white-space:nowrap}
.st-ok{background:var(--ok-bg);color:var(--ok)}.st-part{background:var(--part-bg);color:var(--part)}
.st-doc{background:var(--doc-bg);color:var(--doc)}.st-no{background:var(--no-bg);color:var(--no)}
.hm{font-size:12px;color:var(--muted);margin-left:4px}
aside{border-left:1px solid var(--line);background:var(--panel);padding:20px;overflow:auto;position:sticky;top:57px;max-height:calc(100vh - 57px)}
aside h2{margin:0 0 4px;font-size:17px}
aside .sub{color:var(--muted);font-size:13px;margin-bottom:12px}
.chain{list-style:none;margin:0;padding:0}
.chain>li{position:relative;padding:0 0 14px 22px}
.chain>li::before{content:"";position:absolute;left:6px;top:8px;bottom:-2px;width:2px;background:var(--line)}
.chain>li:last-child::before{display:none}
.chain>li::after{content:"";position:absolute;left:2px;top:5px;width:10px;height:10px;border-radius:50%;background:var(--panel);border:2px solid var(--accent)}
.chain h3{margin:0 0 4px;font-size:12px;color:var(--muted);font-weight:600;letter-spacing:.02em}
.chain .item{margin:2px 0;font-size:13px}
.chain .item small{color:var(--muted)}
.shots{display:grid;grid-template-columns:1fr;gap:8px;margin-top:6px}
.shots figure{margin:0}
.shots img{width:100%;height:auto;border:1px solid var(--line);border-radius:6px;display:block;background:var(--soft)}
.shots figcaption{font-size:12px;color:var(--muted);margin-top:2px}
.empty{color:var(--muted);padding:24px}
footer{padding:16px 24px;color:var(--muted);font-size:12px;border-top:1px solid var(--line)}
@media (max-width:860px){
  main{grid-template-columns:1fr}
  aside{position:static;max-height:none;border-left:0;border-top:1px solid var(--line)}
  header,.controls,footer{padding-left:16px;padding-right:16px}
  .controls{position:static}
  .controls select{flex:1 1 100%}
  th.hide-sm,td.hide-sm{display:none}
}
</style>
</head>
<body>
<header>
  <h1><span>Aurora Concept Designer</span> 기능 지도</h1>
  <p id="meta"></p>
  <div class="summary" id="summary"></div>
</header>
<div class="controls" role="search">
  <input type="search" id="q" placeholder="기능 · ID · 요구 · 화면 · UX 검색" aria-label="검색">
  <span id="chips"></span>
  <select id="step" aria-label="단계"></select>
  <select id="req" aria-label="요구"></select>
  <button class="chip" id="human" aria-pressed="false">👤 사람 검수 대기만</button>
  <span class="count" id="count"></span>
</div>
<main>
  <div class="list">
    <table>
      <thead><tr><th>ID</th><th class="hide-sm">단계</th><th>기능</th><th class="hide-sm">요구</th><th class="hide-sm">화면</th><th>상태</th></tr></thead>
      <tbody id="rows"></tbody>
    </table>
    <div class="empty" id="empty" hidden>조건에 맞는 기능이 없습니다.</div>
  </div>
  <aside id="detail" aria-live="polite"></aside>
</main>
<footer id="foot"></footer>
<script>
const D = /*__DATA__*/null;
const ST = {"✅":["구현","st-ok"],"◐":["일부 구현","st-part"],"📄":["안내 화면만","st-doc"],"✗":["미구현","st-no"]};
const ORDER = ["✅","◐","📄","✗"];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const state = {q:"", status:new Set(), step:"", req:"", human:false, sel:null};

function badge(f){const [n,c]=ST[f.status]||[f.status,""];return `<span class="st ${c}">${f.status} ${n}</span>${f.human?'<span class="hm" title="사람 검수 대기">👤</span>':""}`}
function reqBase(r){return r.split(" ")[0].replace(/-\d+$/,"")}

function init(){
  $("meta").textContent = `정본 docs/FEATURE-LIST.md · 기능 목록 기준 ${D.base} · 이 파일 생성 커밋 ${D.builtFrom} · 검토 후보(사람 검수 전)`;
  const cnt = {}; D.features.forEach(f => cnt[f.status] = (cnt[f.status]||0)+1);
  const hm = D.features.filter(f=>f.human).length;
  $("summary").innerHTML = `<div class="stat"><b>${D.features.length}</b>기능</div>` +
    ORDER.map(s => `<div class="stat"><b>${cnt[s]||0}</b>${s} ${ST[s][0]}</div>`).join("") +
    `<div class="stat"><b>${hm}</b>👤 사람 검수 대기</div>`;
  $("chips").innerHTML = ORDER.map(s => `<button class="chip" data-st="${s}" aria-pressed="false">${s} ${ST[s][0]}</button>`).join(" ");
  $("chips").addEventListener("click", e => {const b=e.target.closest("button"); if(!b) return;
    const s=b.dataset.st; state.status.has(s)?state.status.delete(s):state.status.add(s);
    b.setAttribute("aria-pressed", state.status.has(s)); render();});
  const steps = [...new Set(D.features.map(f=>f.step))];
  $("step").innerHTML = `<option value="">모든 단계</option>` + steps.map(s=>`<option>${esc(s)}</option>`).join("");
  const reqs = [...new Set(D.features.flatMap(f=>f.reqs.map(reqBase)))].sort((a,b)=>a.localeCompare(b,"en",{numeric:true}));
  $("req").innerHTML = `<option value="">모든 요구</option>` + reqs.map(r=>`<option value="${r}">${r} ${esc(D.reqTitles[r]||"")}</option>`).join("");
  $("q").addEventListener("input", e => {state.q=e.target.value.trim().toLowerCase(); render();});
  $("step").addEventListener("change", e => {state.step=e.target.value; render();});
  $("req").addEventListener("change", e => {state.req=e.target.value; render();});
  $("human").addEventListener("click", e => {state.human=!state.human; e.currentTarget.setAttribute("aria-pressed", state.human); render();});
  $("rows").addEventListener("click", e => {const tr=e.target.closest("tr"); if(tr) select(tr.dataset.id);});
  $("rows").addEventListener("keydown", e => {
    const tr=e.target.closest("tr"); if(!tr) return;
    if(e.key==="Enter"||e.key===" "){e.preventDefault(); select(tr.dataset.id);}
    if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault(); const n=e.key==="ArrowDown"?tr.nextElementSibling:tr.previousElementSibling; if(n){n.focus(); select(n.dataset.id);}}
  });
  $("foot").innerHTML = `시안 PDF 쪽 링크와 매뉴얼 그림은 저장소를 받아 <code>docs/traceability/</code> 에서 이 파일을 열 때 보입니다. 문서 링크는 GitHub main 으로 갑니다. 이 파일은 <code>build_traceability.py</code> 로 만든 사본이므로 손으로 고치지 않습니다.`;
  const h = location.hash.slice(1);
  render();
  select(D.features.some(f=>f.id===h) ? h : D.features[0].id);
}

function match(f){
  if(state.status.size && !state.status.has(f.status)) return false;
  if(state.step && f.step!==state.step) return false;
  if(state.req && !f.reqs.map(reqBase).includes(state.req)) return false;
  if(state.human && !f.human) return false;
  if(state.q){
    const hay = [f.id,f.name,f.step,f.evidence,...f.reqs,...f.screens,...f.ux,
      ...f.screens.map(s=>(D.screens[s]||D.variants[s]||{}).name||""),
      ...f.reqs.map(r=>D.reqTitles[reqBase(r)]||"")].join(" ").toLowerCase();
    if(!hay.includes(state.q)) return false;
  }
  return true;
}

function render(){
  const list = D.features.filter(match);
  $("rows").innerHTML = list.map(f => `<tr data-id="${f.id}" tabindex="0" aria-selected="${f.id===state.sel}">
    <td class="id">${f.id}</td><td class="step hide-sm">${esc(f.step)}</td><td>${esc(f.name)}</td>
    <td class="hide-sm">${f.reqs.map(r=>`<span class="tag">${esc(r)}</span>`).join("")}</td>
    <td class="hide-sm">${f.screens.map(s=>`<span class="tag">${esc(s)}</span>`).join("")}</td>
    <td>${badge(f)}</td></tr>`).join("");
  $("empty").hidden = list.length>0;
  $("count").textContent = `${list.length} / ${D.features.length}`;
}

function pdfLink(kind, page, label){return `<a href="../${D.pdf[kind]}#page=${page}" target="_blank" rel="noopener">${label} ${page}쪽</a>`}

function select(id){
  const f = D.features.find(x=>x.id===id); if(!f) return;
  state.sel = id; history.replaceState(null,"","#"+id);
  document.querySelectorAll("#rows tr").forEach(tr=>tr.setAttribute("aria-selected", tr.dataset.id===id));
  const reqs = f.reqs.map(r => {const b=reqBase(r); const rr=D.reqs.find(x=>x.id.split(" ")[0]===b||x.id.includes(b));
    return `<div class="item"><span class="tag">${esc(r)}</span> ${esc(D.reqTitles[b]||"")}${rr?` <small>— 요구 전체 ${esc(rr.now)}${rr.gap&&rr.gap!=="—"?` · 안 된 것: ${esc(rr.gap)}`:""}</small>`:""}</div>`}).join("");
  const scr = f.screens.map(s => {
    const S = D.screens[s], V = D.variants[s];
    if(S) return `<div class="item"><span class="tag">${s}</span> ${esc(S.name)}<br><small>지금 앱: ${esc(S.where)}</small><br><small>${S.wfText} · ${pdfLink("WF",S.wf,"WF")} · ${pdfLink("UX",S.ux,"UX")} · ${pdfLink("GUI",S.gui,"GUI")}${S.shot!=="—"?` · 지금 화면: ${esc(S.shot)}`:""}</small></div>`;
    if(V) return `<div class="item"><span class="tag">${s}</span> ${esc(V.name)} <small>상태 변형 · ${pdfLink("GUI",V.gui,"GUI")}</small></div>`;
    return `<div class="item"><span class="tag">${esc(s)}</span> <small>모든 단계 공통</small></div>`;
  }).join("");
  const ux = f.ux.map(u => {const U=D.ux[u]; return `<div class="item"><a href="${D.gh}UX-SCENARIOS.md#${U?U.anchor:""}" target="_blank" rel="noopener"><span class="tag">${u}</span></a> ${esc(U?U.title:"")}</div>`}).join("") || `<div class="item"><small>—</small></div>`;
  const man = f.manual.sections.map(s => `<div class="item"><a href="${D.gh}user-manual/USER-MANUAL.ko.md#${s.anchor}" target="_blank" rel="noopener">${esc(s.title)}</a></div>`).join("") || `<div class="item"><small>—</small></div>`;
  const shots = f.manual.images.length ? `<div class="shots">${f.manual.images.map(i=>`<figure><img src="../user-manual/${i.src}" alt="${esc(i.alt)}" loading="lazy" onerror="this.closest('figure').hidden=true"><figcaption>${esc(i.alt)}</figcaption></figure>`).join("")}</div>` : "";
  $("detail").innerHTML = `<h2>${f.id} ${esc(f.name)}</h2>
    <div class="sub">${esc(f.step)} · ${badge(f)}</div>
    <ol class="chain">
      <li><h3>요구</h3>${reqs}</li>
      <li><h3>화면 · 와이어프레임 · GUI 시안</h3>${scr}</li>
      <li><h3>UX 시나리오</h3>${ux}</li>
      <li><h3>사용자 매뉴얼 (지금 화면)</h3>${man}${shots}</li>
      <li><h3>근거</h3><div class="item">${esc(f.evidence)}</div><div class="item"><a href="${D.gh}FEATURE-LIST.md" target="_blank" rel="noopener">FEATURE-LIST.md 에서 보기</a></div></li>
    </ol>`;
}
init();
</script>
</body>
</html>
"""


def main():
    d = build()
    missing = [f["id"] for f in d["features"] if not f["manual"]["appendix"]]
    assert not missing, f"매뉴얼 부록 A 에 없는 기능: {missing}"
    write_xlsx(d, HERE / "Feature_Traceability.xlsx")
    write_html(d, HERE / "Feature_Map.html")
    print(f"features={len(d['features'])} screens={len(d['screens'])} variants={len(d['variants'])} "
          f"reqs={len(d['reqs'])} ux={len(d['ux'])} review={len(d['review'])} built_from={d['builtFrom']}")


if __name__ == "__main__":
    main()
