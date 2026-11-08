# 장비 컨셉 디자이너 — 웹 시제품 v0.2 (React + TypeScript)

저장소: https://github.com/kotaeji/EquipCD_G · 작업 방법(집 Mac / 회사 Windows): [`docs/DEVELOPMENT-WORKFLOW.md`](docs/DEVELOPMENT-WORKFLOW.md)

## 빠른 시작
**설치 없이 보기**: 저장소의 `release/equipment-concept-designer.html` 한 파일을 내려받아 Chrome으로 엽니다(GitHub 파일 화면 → Download raw file). 로컬 정적 서버로 여는 것을 권장합니다 — 예: `npx serve release` 또는(Python 있으면) `python3 -m http.server 8766 --directory release` 후 `http://localhost:8766/equipment-concept-designer.html`. file:// 직접 열기는 Mac/Windows에서 GUI 검수하지 않았습니다.

**개발**(Node 20+ 필요, Python 불필요):
```bash
git clone https://github.com/kotaeji/EquipCD_G.git   # 또는 gh repo clone kotaeji/EquipCD_G, 또는 GitHub Code → Download ZIP
cd EquipCD_G
npm ci
npm run dev          # http://localhost:5173
npm run typecheck && npm test && npm run build   # build → release/equipment-concept-designer.html 갱신
```
- 앱의 프로젝트 데이터는 **브라우저 localStorage**에 저장되며 PC 사이에 자동 동기화되지 않습니다. 다른 PC로 옮기려면 앱의 **JSON 내보내기 → 가져오기**를 쓰세요. git은 코드·문서 파일만 동기화합니다.
- 공식 CAEX XSD는 재배포 조건 미확인으로 저장소에 없습니다. XSD 검사(`npm run validate:aml`, Python+lxml 필요)는 선택이며, 없어도 `npm test`는 해당 검사만 건너뛰고 통과합니다.
- 라이선스: 프로젝트 전체에 대한 오픈소스 라이선스는 지정하지 않았습니다. 실사진은 각 사진의 개별 라이선스·저작자 표시를 따릅니다(`assets/visuals/ATTRIBUTION.md`, `photo-manifest.json`). WPF 버전은 미구현입니다.

## 한눈 요약
- **v0.2에서 추가된 것**
  - **에셋 정의를 AML(CAEX 3.0) 파일에서 읽음**: `assets/aml/ecd-sample-library.aml` → 라이브러리 → 인스턴스 배치. 실행 중 다른 AML 가져오기·라이브러리 AML 내보내기(round-trip). 앱 subset 의미 검사 + 공식 CAEX 3.0 XSD 검사(브라우저 밖, Python lxml). 범위·한계: `AML-SUPPORT.md`.
  - **에셋 14종**: 기존 8종 유지 + 센서 3종(광전·근접·리밋 스위치) + 복합 유닛 템플릿 3종(투입·식별·이송 — 자식 Device·내부 신호 연결·Action 사전조건 포함, 배치할 때마다 새 ID).
  - **도식/실사진 토글**: 14종 모두 Wikimedia Commons 실제 촬영 참고 사진(12장, 출처·저자·라이선스·대표 범위 표시, 정확 모델 일치 아님). 토글은 모델 불변.
  - **단계별 중앙 작업영역(C10 위저드 제안안)**: 1 입력·에셋 선택(라이브러리 카드) → 2 배치·연결(Canvas) → 3 속성·Action → 4 자재·시퀀스 → 5 점검 → 6 실행·저장. 현재 단계·목표·남은 항목·이전/다음, 데이터 기반 준비 판정, 확인 후 데이터가 바뀌면 ‘재확인 필요’.
- **v0.1부터 있던 것**: Unit/Device 배치·이동·연결·속성 → 수동 순차 시퀀스 → 5공정·자재 1개 논리 시뮬레이션 → localStorage 저장·재열기, JSON 내보내기/가져오기, A/B/C 테마, F1 직접 입력 후보표, F6 기본 Gap.
- **안 된 것(미구현)**: F7 Evolution Lab 전체, F8 실제 Core Export·역매핑(읽기 전용 미리보기만), F1 문서/USD 추출, 분기·병렬·다중 자재, AI, WPF, 일반 AutomationML 파일(InstanceHierarchy·외부 참조·상속 등) 해석, 브라우저 내 XSD 검사, 가져온 AML의 사진 파일 동봉, C11(노트 갱신 — 앱 기능 아님, 부모 담당).
- **요구 상태와 구현 상태는 다릅니다**: v0.2 요구문서의 [확정]/[설계 제안]/[미정]은 요구 승인 상태이고, 이 폴더의 구현·검증 결과는 `REQUIREMENTS-VERIFICATION.md`에 따로 적습니다. 6단계 구성·gate 규칙·14종 구성·카드 배치는 요구문서상 **[설계 제안]**이며 이번 구현은 그 제안을 시제품으로 만든 것일 뿐 확정이 아닙니다.
- **검증 상태**: 자동 테스트 **5개 파일 57개 통과**(아래). 에이전트가 headless Chrome 156으로 release HTML(file://)을 자동 조작해 v0.2 핵심 경로 확인(`BROWSER-VERIFICATION.md` 「v0.2」 절, 스크린샷 `docs/screenshots/v0.2/`). **v0.2 실제 브라우저 GUI 검수**(부모 에이전트, Linux Chrome 1920×1072, `http://127.0.0.1:8766/equipment-concept-designer.html`): 라이브러리 카드·AML 상세·사진 토글, 1~6 중앙 화면, 식별 유닛 템플릿·Undo, NOT_READY 차단, 기본 실행 RUN_COMPLETE(11.100 s, 오류 0), AML 가져오기 2건 관찰 통과 — 자동 결과와 분리해 `BROWSER-VERIFICATION.md` 6절에 기록. 미검증: 1280×800·작은 화면, V01~V16 전체, Mac/Windows, file:// GUI 검수, 유닛 템플릿 포함 실행.

> **논리 시뮬레이션 전용 시제품입니다.** 실제 장비 제어, 정밀 물리·충돌 검증, AI 최적화, Aurora Core 실제 연동은 **하지 않습니다.**
> 화면의 모든 시간·크기·무게·타임아웃은 **[예시] 가정값**이며 실제 장비 사양이 아닙니다. 실사진은 참고 사진이며 사양 근거가 아닙니다.
> 요구 명세: `docs/requirements-v0.2.md` (v0.2 전체본, 2026-11-08 KST) — v0.1 원본 `docs/requirements-v0.1.md`는 그대로 보존. 요구별 구현/검증: `REQUIREMENTS-VERIFICATION.md`. AML 범위: `AML-SUPPORT.md`. 브라우저 관찰: `BROWSER-VERIFICATION.md`. 불명확·결정 필요: `AMBIGUITIES.md`.
> GitHub 저장소 `kotaeji/EquipCD_G`(main)에서 관리합니다. 기존 IssueReporter 프로젝트와 무관합니다. WPF 버전은 없습니다.

## 바로 열기 (설치 불필요)
`release/equipment-concept-designer.html` 파일 하나(약 1.97 MB, 사진 포함)를 Mac/Windows Chrome에서 더블클릭(또는 드래그)해 엽니다.
React 번들·CSS·AML 라이브러리·도식·사진이 모두 인라인된 단일 파일이며 외부 CDN·네트워크 요청이 없습니다(headless Chrome에서 외부 요청 0건 확인). 사진 상세의 ‘출처 페이지’·라이선스 링크를 누를 때만 외부 사이트가 열립니다.
- 저장: 브라우저 localStorage (이 브라우저·이 PC에만 남음). 저장을 쓸 수 없으면 상태바에 “메모리 전용”으로 표시되며 **JSON 내보내기**로 보관하세요.
- Chrome의 file:// localStorage는 모든 로컬 HTML 파일이 같은 저장 영역을 공유할 수 있습니다(브라우저 정책). 중요 작업은 JSON 내보내기로 백업하세요.

## 개발 실행
```bash
npm ci
npm run dev           # http://localhost:5173 (host 0.0.0.0)
npm test              # vitest 57개: 모델/런타임/저장/AML/템플릿/사진/위저드 + jsdom UI 스모크 + 테마 대비
npm run typecheck     # tsc --noEmit
npm run gen:aml       # assets/aml/ecd-sample-library.aml + assets/visuals/(도식 SVG·사진·manifest) 재생성 (media-sources/ 필요)
npm run validate:aml  # 공식 CAEX 3.0 XSD 검사 (python3 + lxml). XSD는 배포에 미포함 → 직접 받아 standards/caex3.0/에 두기(AML-SUPPORT.md). 없으면 "NOT RUN" 안내 후 종료 코드 2 → 성공 실행 시 assets/aml/xsd-report.json 갱신
npm run gen:samples   # samples/*.ecd.json, samples/aml/*.aml 재생성
npm run build         # tsc + vite build(단일 파일) → release/equipment-concept-designer.html
npm run package:src   # release/ 의 src·verification·assets ZIP 생성 (Python 필요, ZIP은 git에 커밋하지 않음 — 재생성 가능)
# 선택(기록용): headless Chrome 자동 확인 스크립트 (Chrome + puppeteer-core 필요, 프로젝트 의존성 아님, ECD_ROOT/CHROME 환경변수)
npm i --no-save puppeteer-core@23 && node scripts/browser-check.mjs
```
AML을 수정했다면 (XSD를 직접 받은 뒤) `validate:aml` → `build` 순서로 실행해야 앱의 “XSD 통과” 표시가 유지됩니다(해시 불일치 시 앱은 “미검증”으로 표시). Node 20+ 권장 (작성 환경 Node 24.22.1, npm 11.21.1), Python 3 + lxml(XSD 검사용).

## 구조
```
assets/aml/            ecd-sample-library.aml (14종, CAEX 3.0 — 앱 에셋의 원본), xsd-report.json
assets/visuals/        schematic/*.svg (도식 14), photos/*.jpg (실사진 12), photo-manifest.json, ATTRIBUTION.md
standards/caex3.0/     SOURCE.md (공식 XSD 출처 URL·해시·직접 받는 방법) — XSD 원문은 재배포 조건 미확인으로 ZIP에 미포함
src/assets/            aml.ts (CAEX 3.0 subset reader/writer, 진단), library.ts (AML → 라이브러리, 가져오기/내보내기), visuals.ts (사진 해석·출처)
src/model/             types.ts factory.ts sample.ts commands.ts(addUnitFromTemplate 포함) history.ts validate.ts gaps.ts candidates.ts structuredText.ts exportPreview.ts
src/runtime/engine.ts  결정적 가상 시간 런타임
src/storage/           fileFormat.ts localStore.ts
src/ui/                App.tsx(단계 라우팅) wizard.ts(단계 판정) Library.tsx(카드) Canvas.tsx Inspector.tsx Panels.tsx Symbols.tsx viewSettings.ts
samples/               5공정 예제 + 손상/미지원/누락 참조 JSON, samples/aml/ (추가 에셋·구문 오류·2.15·자식 참조 누락)
scripts/               asset-seed.ts(AML 최초 생성 입력, 앱 미포함) gen-aml.ts gen-samples.ts validate-aml.py browser-check.mjs package-src.mjs copy-release.mjs
tests/                 engine, model, aml, theme-contrast, ui-smoke
docs/                  requirements-v0.1.md(원본 보존) requirements-v0.2.md(전체본) verification/ screenshots/
```

## 화면 구성 (중앙 작업영역 = 현재 단계)
- 상단: 프로젝트 탭, 빈 프로젝트/5공정 예제, 저장 상태·저장·열기·JSON 내보내기/가져오기, Undo/Redo, 테마 토글(A→B→C)·A/B/C
- 단계 바: 1~6 단계 버튼(각 단계 판정 배지: 필수 충족 / 필수 누락 / 재확인 필요 / 확인됨 ✓), 현재 단계·작업영역·목표, 「남은 항목」(필수 데이터 누락·가정값 존재·미정·선택 사항 미확보·사람 확인 필요 구분, ‘편집으로 이동’), ◀ 이전 / 다음 ▶
- 1 입력·에셋 선택: **에셋 라이브러리 카드**(검색·분류·도식/실사진·AML 번들/가져옴·XSD 상태 배지) + 카드 상세(AML 파일·SUC 경로·RoleClass·CAEX 버전·속성·포트·Action·템플릿 자식/링크/규칙·사진 출처/라이선스/대표 범위) + 「프로젝트에 추가」(상세 보기와 분리) + AML 가져오기/내보내기 + AML 로드 상태 / 하위 탭 입력 후보표(F1)
- 2 배치·연결: 툴바(선택/이동·물류/신호 연결·정렬·삭제·도식/실사진·레이어·줌) + 트리·팔레트(14종 + 빈 유닛) + Canvas + 속성 패널
- 3 속성·Action: Unit/Device 트리 + 속성/신호/포지션/Action/정의 체크 편집기 + Unit 제공 능력표 + 이 단계 남은 항목
- 4 자재·시퀀스: 시퀀스 Draft(F5) / 자재·Flow(F4) / SFC 미리보기
- 5 점검: Gap(F6) / 진단·저장·AML / Export 미리보기(F8) / Evolution Lab(F7, 미구현 안내)
- 6 실행·저장: 실행 컨트롤 + Canvas + 실행 상태·로그 + 저장·시뮬·실행 전 검사 상태(별도 배지)
- 단계 이동·도식/사진 토글·테마는 UserView(`ecd.v1.userView`)에만 저장되며 프로젝트 파일에 들어가지 않습니다. 다시 열면 마지막 단계로 복원되고 판정은 현재 데이터로 다시 계산합니다(실행 상태는 복원하지 않음).

## 시제품 런타임 규칙 (가정 — 확정 요구 아님)
- 가상 시간 정수 ms. 화면 속도(0.25~4x)는 재생 속도일 뿐 결과에 영향 없음. 같은 입력이면 dt 분할과 무관하게 같은 결과.
- 순차 단계만 지원. 단계 시작 시 진입·pre 조건 검사 → 불충족이면 대기하지 않고 즉시 `PRE_UNMET` 오류(다른 진행 주체가 없으므로).
- 시작 시 명령 Signal ON, 완료 Signal OFF. (시작+동작 시간)에 완료 Signal ON → post 조건 검사(임시 상태 기준) → 통과 시에만 자재 위치/상태/잡음 커밋.
- 완료가 타임아웃 시각과 같으면 성공(경계 규칙 가정). 타임아웃 도달 시 `TIMEOUT` 오류, 이후 단계 통과 안 함.
- 완료 시 같은 Device의 다른 완료 Signal은 OFF (상승/하강처럼 배타 상태로 가정).
- 일시정지 중 가상 시간 동결. 초기화 = 실행 시작 스냅샷의 초기 조건 복원 (Undo와 별개).
- 실행 중·일시정지 중 모델 편집·Undo 차단. 선택·테마·레이어·줌은 허용. 모델 편집 시 이전 실행 결과는 지워짐.
- 실행 준비 검사: 완료 Signal·동작 시간·타임아웃·수용 개수가 미정이거나 “미정 조건”이 있으면 실행 차단 (임의 true 금지). 자재 정의는 1개만.
- 검증용 오류 주입: “완료 신호 미발생”, “바코드 읽기 결과 실패”(실행 상태 탭).

## 알려진 한계
- 실제 브라우저 GUI 검수는 v0.1 빌드 일부, v0.2 빌드 일부 항목(Linux Chrome, 6절)만 수행됨. 그 외 v0.2 항목은 headless 자동 조작 결과만 (`BROWSER-VERIFICATION.md`).
- 2단계 Canvas: 가로 스크롤 전에는 오른쪽 끝 유닛이 오른쪽 속성 패널 뒤에 가려짐(스크롤하면 보임, GUI 검수 관찰, 미수정).
- **14종 에셋 모두가 실행 시나리오에서 동작한다는 보장은 없습니다.** 실행으로 확인된 것은 기본 5공정 모델뿐입니다. 자동 테스트는 순수 로직 + AML/XSD + jsdom 렌더 스모크 + 테마 대비 계산.
- 대형 캔버스 성능, 접근성, 키보드 전용 조작, 모바일은 검토하지 않았습니다.
- 다중 자재, 분기/병렬, 캐리어 적재 관계 편집, 배경 이미지, F1 문서/USD 추출, F7, F8 실제 Export/역매핑은 미구현입니다.
- AML은 이 앱의 subset만 해석합니다(`AML-SUPPORT.md`). 일반 AutomationML 도구와의 상호 운용(AutomationML Editor 열기 등)은 검증하지 않았습니다.
- 유닛 템플릿 규칙으로 생긴 사전조건(예: 광전 센서 감지=true)은 시제품 런타임에서 센서 신호를 만드는 주체가 없으므로, **템플릿 유닛의 Action을 시퀀스에 넣으면 PRE_UNMET으로 멈춥니다**(센서 신호 미구현 제약, `AMBIGUITIES.md` A33).
- 새로 놓은 Device의 기본 이름이 에셋 이름(예: “실린더”)이라 여러 개일 때 구별이 어려움(유닛 템플릿 자식은 `PSH-S6-PSH1`처럼 접두어 이름, ID는 항상 고유).
- 웹/WPF 동등성(X01~X08)은 WPF가 없으므로 미검증입니다.
