# 개발 작업 방법 — 집 MacBook / 회사 Windows

저장소: https://github.com/kotaeji/EquipCD_G (기본 브랜치 `main`). 앞으로의 작업은 이 저장소에서 합니다.

## 1. 받기
| 방법 | 명령 / 동작 | 비고 |
|---|---|---|
| 앱만 보기 | GitHub에서 `release/equipment-concept-designer.html` → Download raw file | 빌드된 단일 HTML (외부 요청 없음) |
| ZIP | GitHub 저장소 화면 **Code → Download ZIP** | git 이력 없음, push 불가 — 보기/일회성용 |
| gh | `gh repo clone kotaeji/EquipCD_G` | GitHub CLI 로그인 필요 |
| git | `git clone https://github.com/kotaeji/EquipCD_G.git` | push하려면 GitHub 인증(자격 증명 관리자/gh auth setup-git) |

## 2. 준비·실행 (Mac / Windows 공통)
- Node.js 20 이상 (작성 환경 Node 24, npm 11). **Python 없이도** 아래 npm 명령은 모두 동작합니다.
```bash
npm ci               # package-lock.json 그대로 설치 (node_modules는 커밋 금지 — .gitignore)
npm run dev          # 개발 서버 http://localhost:5173
npm run typecheck    # tsc --noEmit
npm test             # vitest (Python/lxml/XSD가 없으면 XSD 검사 테스트만 건너뜀)
npm run build        # release/equipment-concept-designer.html 갱신 → 변경되면 함께 커밋
```
- Python이 필요한 선택 명령: `npm run validate:aml`(Python 3 + lxml + 직접 받은 XSD, `AML-SUPPORT.md`), `npm run package:src`(배포 ZIP 생성, ZIP은 커밋하지 않음), `media-sources/build.py`(사진 재수집, Pillow 필요 — 보통 불필요).
- Windows PowerShell에서 `npm run typecheck && npm test`가 안 되면 명령을 한 줄씩 실행하세요.

## 3. 빌드된 HTML 열기
- 권장: 로컬 정적 서버 — `npx serve release` 또는 `python3 -m http.server 8766 --directory release` 후 `http://localhost:8766/equipment-concept-designer.html`.
- dev 서버 경유 `http://localhost:5173/release/equipment-concept-designer.html`도 동작(빌드는 비문자 검사 포함).
- file:// 직접 열기(더블클릭): Linux headless Chrome 자동 확인만 있고 **Mac/Windows에서는 검수하지 않았습니다.** Chrome의 file:// localStorage는 로컬 HTML끼리 공유될 수 있습니다.

## 4. PC 간 작업 규칙
1. 작업 **시작 전**: `git pull --ff-only` (실패하면 로컬 변경을 먼저 커밋/정리 — 강제 덮어쓰기 금지)
2. PC를 **옮기기 전**: `git add -A && git commit -m "..." && git push`
3. 두 PC에서 **같은 파일을 동시에 수정하지 않기** (특히 `release/*.html`, `assets/aml/*.aml`, `package-lock.json`)
4. `node_modules/`, `dist/`, 배포 ZIP, `*.xsd`, `.env`·자격 증명은 커밋 금지 (`.gitignore`)
5. 줄바꿈은 `.gitattributes`로 LF 고정 — AML 파일의 해시(앱의 “XSD 통과” 표시)가 Windows 체크아웃에서도 바뀌지 않게 하기 위함

## 5. 데이터 동기화 — 중요
- 앱에서 만든 **프로젝트는 브라우저 localStorage**에 저장됩니다. git·GitHub로 **자동 동기화되지 않습니다.**
- 다른 PC로 옮기려면: 앱에서 **JSON 내보내기** → 파일을 옮김(필요하면 저장소 `samples/` 등에 커밋) → 다른 PC에서 **JSON 가져오기**.
- 앱에서 가져온 AML 정의도 그 브라우저에만 남습니다. 공유하려면 AML 파일 자체를 옮기세요.
- git이 동기화하는 것은 **코드·문서·에셋 파일뿐**입니다.

## 6. 버전을 올릴 때 — 사용자 매뉴얼 동시 갱신
- [ ] `docs/user-manual/USER-MANUAL.ko.md`의 바뀐 기능·미검증 항목을 갱신(기능 ID MF-01~MF-26 유지, 새 기능은 MF-27부터) — 절차는 매뉴얼 부록 C
- [ ] 같은 원고로 PDF 재생성(브라우저 불사용): `docs/user-manual/build_user_manual_pdf.py` (`requirements-pdf.txt`)
- [ ] MD와 PDF를 **같은 commit**에 올리기 (이전 버전은 git 이력으로 보존)

## 7. 범위
- 웹 시제품 v0.2(논리 시뮬레이션 전용). WPF 버전은 미구현.
- 프로젝트 전체 오픈소스 라이선스는 지정하지 않음. 실사진은 개별 라이선스(`assets/visuals/ATTRIBUTION.md`).
