# 브라우저 검증 기록

이 문서는 두 종류를 구분해 적습니다.
- **「v0.1」 절 (1~3)**: v0.1 빌드에 대한 부모 검수자의 Linux Chrome **수동** 실제 관찰. v0.2에서 화면 배치가 바뀌었으므로 이 관찰은 v0.2 빌드에 그대로 적용되지 않습니다(런타임·저장 로직은 같은 코드).
- **「v0.2」 절 (4)**: v0.2 빌드에 대한 **에이전트의 headless Chrome 자동 조작** 결과 (자동, GUI 검수 아님).
- **5절**: release HTML의 Vite 경유 HTTP 500 원인·수정 (명령행 자동 확인).
- **6절**: v0.2 빌드(5절 수정 후)에 대한 **부모 에이전트의 실제 브라우저 GUI 검수** 결과 (Linux Chrome, `http://127.0.0.1:8766/…`). 4절 자동 결과와 분리해 적습니다.

# v0.1 — 브라우저 수동 검증 기록 (실제 관찰)

- 일시: 2026-11-08 KST · 환경: Linux Chrome · 대상: dev `http://localhost:5173`, release `http://localhost:5173/release/equipment-concept-designer.html`
- 검수자: 부모 에이전트의 브라우저 검수 (1차 + 수정 후 최종 검수). 아래는 **실제로 관찰한 항목만** 기록합니다. `BROWSER-TEST-SCENARIOS.md`의 B01~B30 **전체 통과가 아닙니다.**
- 자동 테스트(당시): 4개 파일 47개 통과. v0.2 현재: 5개 파일 57개 통과 (`REQUIREMENTS-VERIFICATION.md`).
- 스크린샷 (출처: 부모 에이전트 브라우저 검수 캡처, 2026-11-08 KST Linux Chrome): `docs/screenshots/final-run-completed.png`(최신 실행 완료), `docs/screenshots/theme-b-dark-after-fix.png`(B 다크 테마 수정 후)

## 1. 관찰 결과

| 항목 | 관찰 | 판정 |
|---|---|---|
| 초기 화면 (dev/release) | 5 Unit, 10 Device, 자재 1개 | 통과 |
| A/B/C 테마 전환 | 전환해도 배치·연결·자재 등 모델 불변 | 통과 |
| B 다크 테마 가독성 | 1차: 트리·팔레트 라벨이 배경에서 거의 안 보임(결함). 수정 후 dev reload: B 트리/팔레트/헤더 밝은 글자 정상, A/C 정상 | **수정 검증 완료** |
| 5공정 실행 | 00:11.100 자재 EXIT / 배출 완료, 로그 RUN_COMPLETE | 통과 |
| 「끝까지」 | 초기 disabled(의도: 실행 중에만 활성). ▶ 실행 후 활성 → completed 00:11.100 EXIT/배출 완료 | 통과 |
| 초기화 | 00:00.000 복귀 | 통과 |
| 일시정지/재개 | 00:03.485에서 일시정지 후 3초간 시간 고정 → 재개 후 00:11.100 완료 | 통과 (RESUME 로그 줄은 별도 확인 못함) |
| 기존 Device 이동 + Undo/Redo | CYL-03 S3→S2 근처, ‘좌표만 이동’: x 795→665, Undo 795, Redo 665 | 통과 |
| 팔레트 신규 DnD | 팔레트 실린더를 S2로 드롭: S2 “2 dev”→“3 dev”, 트리에 실린더 추가. Undo로 원복 확인. Redo는 Undo/Redo 카운터 변화만 확인, 트리 복귀는 확인 못함 | **부분 검증** |
| 속성 저장·재열기 | CYL-03 stroke 100→120, 저장 후 reload 유지 | 통과 |
| JSON 내보내기 | 실제 파일 40,725 byte, appVersion `0.1.0-prototype` | 통과 |
| JSON 가져오기 (같은 파일) | 중복 ID 안내, 기존 탭 보존, 새 ID 사본 열기 성공 | 통과 |
| 손상 샘플 가져오기 | `[JSON_PARSE]` 거부, 기존 5유닛 모델 불변, 격리 보존 안내 확인 | 통과 (진단 탭 격리 보관함 실물·원본 다운로드는 **미확인**) |
| 오류 주입 (SC-AC2) | S2 읽기 완료 신호 미발생 주입 → 00:03.100 error TIMEOUT @STEP-03, 자재 S2/투입됨, STEP_START 3개뿐(이후 공정 통과 안 함). 초기화 후 주입 별도 해제 동작 | 통과 |
| release HTML (HTTP) | `http://localhost:5173/release/equipment-concept-designer.html` 200, 초기 5unit/10device/자재1, 실행→끝까지 00:11.100 completed. (1차 때는 임시 HTTP 127.0.0.1:8766에서 초기 렌더·11.100 완료 확인 후 서버 종료) | 통과 |
| 로드 오류 | 최종 검수에서 dev/release 로드 4xx·페이지 오류 0건. 1차에서 본 404 1건은 재현 안 됨 | 통과 (이전 404 원인은 **미확정**) |

## 2. 결함 / 알려진 이슈

1. **B 다크 테마 라벨 가독성 (수정·검증 완료)** — 원인: 테마 CSS 변수는 `.app`에 인라인 정의되는데 기본 글자색 `color: var(--text)`를 `body`에 지정 → `body`에서 변수 무효 → 검정 글자 상속. 조치: 기본 글자색·`color-scheme`·`accent-color`를 `.app`(및 모달/토스트)에 지정, 트리·팔레트·탭 버튼·`<option>`·placeholder 색 명시, B는 `color-scheme: dark`, primary 버튼 글자색 테마별 지정. 계산 대비 테스트(`tests/theme-contrast.test.ts`) + 수정 후 브라우저 관찰로 확인.
2. **1차 HTTP 404 1건 (원인 미확정)** — release HTML에는 외부 `src`/`href` 참조가 없음(빌드 산출물 확인). 기본 `/favicon.ico` 요청 가능성이 있어 인라인 data-URI favicon을 추가했고, 최종 검수에서 4xx 0건·재현 안 됨. 원래 404 대상 파일명은 관찰되지 않아 원인은 확정하지 않음.
3. **알려진 UX 이슈 (저심각도, 미수정)** — 팔레트로 새로 놓은 Device의 기본 이름이 에셋 이름(예: “실린더”)이라 같은 종류를 여러 개 놓으면 화면/트리에서 구별이 어려움. 내부 ID는 각각 고유함. 이번 범위에서는 수정하지 않음.

## 3. 미검증

- `file://`로 release HTML 직접 열기와 file:// localStorage (브라우저 도구가 file:// 접근 차단 — 우회 시도 안 함)
- Mac / Windows Chrome
- 진단 탭 격리 보관함 실물·원본 다운로드, 미지원 버전·누락 참조 샘플 가져오기
- 바코드 읽기 실패 주입, 「+0.1s」
- 신규 DnD의 Redo 후 트리 복귀, 유닛 DnD, Unit 밖 드롭 거부
- 신호/물류 연결, 레이어, 정렬, 삭제, 소속 변경 대화상자의 「소속 변경 + 이동」
- Inspector 신호/포지션/Action 편집, 자재·Flow, 입력 허브, 시퀀스 편집·구조화 문장, Gap 재분석/이동/해결 접기, Interlock 확인, SFC·Export·Lab 탭, 사진 토글, 미저장 탭 닫기

# v0.2 — headless Chrome 자동 조작 결과 (에이전트 수행, 사람 수동 검증 아님)

## 4. 실행 정보
- 일시: Sun Nov 08 2026 01:45:49 GMT+0900 (Korean Standard Time) · 브라우저: Chrome/156.0.8078.47 headless (Linux, 창 1600×1000) · 도구: `scripts/browser-check.mjs` (puppeteer-core)
- 대상: **`file://…/release/equipment-concept-designer.html` 직접 열기** (v0.2 release, 1,969,837 byte). 원본 결과: `docs/verification/v0.2-headless-chrome.json`
- 스크린샷: `docs/screenshots/v0.2/` 01-library-schematic · 02-library-photo-detail · 03-canvas-photo · 04-canvas-schematic · 05-attributes · 06-sequence · 07-check · 08-run · 09-library-themeB · 10-aml-import-ok · 11-aml-import-error

## 4.1 관찰 결과 (스크립트가 값으로 확인한 것)

| 항목 (시나리오) | 확인 값 | 판정 |
|---|---|---|
| 첫 화면 중앙 = 라이브러리 카드 (V01) | 카드 14장 | 통과 |
| 카드 상세 보기는 모델 불변 (V02) | 상세 열기 전후 rev 동일 = True | 통과 |
| 실사진 토글 (V03) | 로드 완료된 카드 사진 14장, 토글 전후 rev 동일 = True | 통과 |
| 「프로젝트에 추가」(식별 유닛 템플릿) (V05) | rev +1 = True | 통과 |
| 2단계 Canvas 실사진 (V06) | SVG image 13개 → 「도식」 후 0개 | 통과 |
| 6단계 실행 → 끝까지 (V12) | 실행 직후 running → completed (스크린샷 08: 00:11.100, RUN_COMPLETE) | 통과 |
| AML 가져오기 — 추가 에셋 (V14) | 모달 “XML 구문: 통과 · CAEX 3.0 · 앱 subset 오류 0 · 공식 XSD: 미검증”, 추가 1개 → 카드 15장 | 통과 |
| AML 가져오기 — 자식 참조 누락 (V15) | 앱 subset 오류 2, 추가 0, 카드 15장 유지 | 통과 |
| 새로고침 복원 (V16) | 단계 복원 = check, 카드 15장(가져온 AML 재등록) | 통과 |
| 콘솔 오류·페이지 오류 | 0건 | 통과 |
| 외부 네트워크 요청 (data:/file: 제외) | 0건 | 통과 |
| 테마 B (스크린샷 09) | 화면 캡처만 — 가독성은 사람이 판단하지 않음 | 캡처만 |

## 4.2 headless 자동 조작에서 확인하지 않은 것 (일부는 6절 GUI 검수에서 관찰)
- 화면 눈 확인(배치·가독성·사진 크롭 품질·문구 이해도) — 6절 GUI 검수에서 일부 관찰, 작은 화면·Mac/Windows는 미검증
- V04, V07, V10, V11, V13 (자동 테스트로만 확인했거나 미확인)
- 2단계에서 유닛 템플릿을 팔레트로 드래그해 배치, 실행 중 단계 이동 시 편집 차단, 「남은 항목」→「편집으로 이동」
- v0.1 미검증 목록(3절) 중 v0.2에서 다시 다루지 않은 항목 전부
- 참고: v0.1에서 미검증이던 **file:// 직접 열기와 file:// localStorage**는 이번 headless Chrome(Linux)에서 열기·저장·새로고침 복원이 동작함을 확인. Mac/Windows는 미확인.

## 5. release HTML HTTP 500 (Vite 경유) — 원인·수정 (2026-11-08 KST)
- 보고(부모 실제 브라우저 QA): `http://localhost:5173/release/equipment-concept-designer.html` 2회 모두 HTTP 500, Vite `parse noncharacter-in-input-stream` (release HTML 965:11880).
- 원인(정적 확인): 인라인 JS의 fast-xml-parser XML 이름 정규식 문자 범위에 Unicode 비문자 **U+EFFFF**가 그대로 들어 있었음(`…𐀀-\u{EFFFF}`). Vite dev 서버가 HTML을 다시 파싱할 때 HTML 파서가 비문자를 거부 → 500. 파일을 직접 열거나 일반 정적 서버로 받을 때는 해당 없음.
- 수정(동작 불변): `vite.config.ts`에 `esbuild: { charset: 'ascii' }` — JS 번들의 비ASCII 문자를 모두 `\uXXXX` 이스케이프로 출력(같은 문자열·정규식 값). `scripts/copy-release.mjs`가 빌드 결과에 비문자/고립 서러게이트가 있으면 빌드를 실패시킴(회귀 방지). 그 외 `index.html` 제목의 버전 표기 v0.1→v0.2 (텍스트만).
- 확인(에이전트 **자동/명령행만**, 브라우저 조작 아님): 새 release HTML 비문자 0개. `curl` 결과 Vite 경유 `…/release/equipment-concept-designer.html` HTTP 200, 인라인 모듈 프록시 `?html-proxy&index=0.js` HTTP 200. 정적 서버 `python3 -m http.server 8766 --bind 127.0.0.1 --directory release` → `http://127.0.0.1:8766/equipment-concept-designer.html` HTTP 200, 파일과 바이트 동일. 화면 동작의 사람 확인은 부모 QA 재개 대상.

# v0.2 — 실제 브라우저 GUI 검수 결과 (부모 에이전트 수행)

자동 테스트·headless 자동 조작(4절)과 **별개**입니다. 부모 에이전트가 실제 Linux Chrome 창에서 release HTML을 GUI로 조작하며 관찰한 결과만 적습니다. 화면에 보인 항목만이며 V01~V16 전체 통과를 뜻하지 않습니다.

## 6. 검수 정보
- 일시: 2026-11-08 KST · 환경: Linux Chrome, 창 1920×1072
- 대상 URL: `http://127.0.0.1:8766/equipment-concept-designer.html` (python `http.server`, release 폴더만 제공, Vite 변환 없음). 대상 HTML은 5절 수정 후 빌드(sha256 `519469d6…`)이며 이 기록을 반영할 때 **HTML은 변경하지 않았습니다.**
- 증거 스크린샷(부모 GUI 검수 캡처): `docs/screenshots/v0.2-library-photo.png`(라이브러리·실사진 상세), `docs/screenshots/v0.2-run-completed.png`(기본 실행 완료)

## 6.1 관찰 결과 — 통과
| 항목 | 관찰 | 판정 |
|---|---|---|
| 라이브러리 카드 | 카드 14장. 검색 “바코드” → 1장. 분류 ‘센서’ → 5장 | 통과 |
| AML 상세 | 푸셔 카드 상세에 AML 출처·속성·포트·Action 표시 | 통과 |
| 도식/실사진 토글 | 전환 전후 rev 1 불변(모델 불변) | 통과 |
| 사진 표시 | ‘구성품 참고’·‘동일 모델 아님’·‘실제 촬영’·출처·라이선스 표시 | 통과 |
| 1~6단계 중앙 화면 | 1 카드 / 2 Canvas / 3 속성·Action 능력표 / 4 자재·시퀀스 / 5 Gap / 6 실행·로그로 각각 전환 | 통과 |
| 식별 유닛 템플릿 | 자식 3개 STP·PRX·BCR 생성, PRX→BCR 내부 링크. Undo로 모두 제거 | 통과 |
| 완료 Signal 미정 | 3단계 필수 누락 표시·다음 단계 안내, 실행 시 NOT_READY로 차단, Undo로 해소 | 통과 |
| 기본 실행 | 11.100 s RUN_COMPLETE, STEP_DONE 12건, 배출 완료, 오류 0 | 통과 |
| 일시정지/재개 | 0.510 s에서 일시정지 후 재개 | 통과 |
| 실행 중 편집 | 실행 중 추가 비활성 | 통과 |
| AML 가져오기 — extra-asset | 정의 1개 추가, “XSD 미검증” 표시 | 통과 |
| AML 가져오기 — missing-child-ref | CHILD_REF_MISSING·LINK_REF_MISSING, 추가 0, “XSD 미검증” | 통과 |
| 콘솔 | 정적 서버 현재 페이지 콘솔 오류 0 | 통과 |

## 6.2 UX 관찰 (결함 아님·미수정)
- 2단계 Canvas: 가로 스크롤 전에는 오른쪽 끝 유닛이 오른쪽 속성 패널 뒤에 가려짐. 가로 스크롤하면 보임. 코드 변경 없음(이번 범위는 기록만).

## 6.3 검수 후 상태
- 기본 모델은 Undo로 rev 1 복원, 실행 완료 상태.
- 가져온 AML(라이브러리 15종, 가져온 파일 3개)은 **QA 브라우저 프로필의 localStorage에만** 남아 있음. 배포 파일·번들 라이브러리(14종)에는 영향 없음.

## 6.4 GUI 검수에서 미검증
- 정확한 1280×800 창 크기, 작은 화면 가독성
- V01~V16 시나리오 전체 대응(위 표는 일부 항목)
- Mac/Windows Chrome
- file:// 직접 열기의 GUI 검수 (4절의 headless 자동 확인만 있음)
- 유닛 템플릿을 시퀀스에 넣은 실행 — 센서 신호 생성 주체가 없어 PRE_UNMET 예상(`AMBIGUITIES.md` A33). **14종 전체가 실행 시나리오에서 동작한다는 보장은 없음**(기본 5공정 모델 실행만 확인)
