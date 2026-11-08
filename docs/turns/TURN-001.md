# TURN-001 — Substation 그룹 실행 차단: 원인별 수정 단계 안내 + 이동 버튼

| 항목 | 내용 |
|---|---|
| 상태 | **검토용 Draft PR — 정식 릴리스 HOLD.** ① 개발 자동 테스트 114 통과 ② 독립 에이전트 재검증 PASS(코드·단위·React-jsdom·메모리 내 빌드 범위) ③ 실제 GUI 대표 2경로 PASS, 특수 사례·키보드 미검증(5절). 자동 병합·릴리스 태그·GitHub Release 없음 |
| 기준 | 사용자 승인한 범위 제안(2026-11-08 KST). 새 요구 확정 아님 — 기존 [설계 제안] C10-04, v0.3 요구 §C10 "필수 gate 실패 시 해당 단계와 원인 안내", C04 예외 "원인 단계 표시"와 연계 |
| 브랜치 | `turn/001-substation-block-guidance` — PR #3(`docs/user-manual-screenshots`, 6b0c419) 위에서 분기(문서 의존). 앱 기준은 `main` f47118f와 동일 |
| 앱 버전 | 변경 안 함(`0.3.0-prototype`). 릴리스 시 patch 후보 `0.3.1-prototype` — 부모/사용자가 지정. 파일 형식 `0.2.0`·규칙 `group-runtime/0.1.0` 불변 |

## 1. 확정 기준 (범위)
- 6 실행·저장 › 「Substation 그룹」의 「실행 전 검사 — 차단 N건」 각 항목에 **수정 위치**(`단계번호 단계명 › 탭/위치`)와 **이동 버튼**을 표시한다.
- 이동은 기존 `goStep(step, sub)` 재사용(보기 상태만 변경). 3단계 대상이면 해당 Device(수용 개수는 대상 Unit)를 선택하고 Action/속성 탭을 연다.
- 잘못된 고정 문구 "3 시퀀스 단계 → “Substation 시퀀스”에서 수정하세요" 제거.
- **변경하지 않음**: 그룹 gate 규칙·차단 동작, 런타임, 데이터/파일 형식, Station 측 게이트, 새 모달, 전체 디자인.

## 2. UX 결정 — 차단 Diagnostic → 안내 종류 (`src/ui/blockerTarget.ts` `resolveBlocker`)
안내는 코드만이 아니라 **실제 Diagnostic 객체**(단계·Action·자재 상태)로 정한다. 세 종류를 문구·배지·aria·버튼으로 구분한다.
- **수정 위치(fix)**: 그 화면에 원인을 고치는 편집기가 있음 → 「수정 위치: …」, 버튼 「… 화면으로 이동」, aria "…원인 수정: …".
- **원인 확인(inspect)**: 원인을 볼 수 있는 곳일 뿐 직접 수정 위치가 아님 → 「원인 확인: … — 이유」, 버튼 「…에서 원인 확인」, aria "…원인 확인(직접 수정 위치 아님)".
- **편집 미지원(unsupported)**: 현재 UI에 편집기가 없음 → 배지 「현재 화면에서 직접 편집 불가」 + 이유, 볼 곳이 있으면 「…에서 원인 확인」 버튼만.

| 원인 (실제 객체) | 안내 |
|---|---|
| DEVICE_CONFLICT, SHARED_MATERIAL_CONFLICT, NO_SUB_SEQUENCES, NO_STEPS, DEVICE_OUTSIDE_SUBSTATION | 수정: 4 자재·시퀀스 › Substation 시퀀스 |
| NO_COMPLETE_SIGNAL, DURATION_UNDEFINED | 수정: 3 속성·Action › Action (Device 선택) |
| TIMEOUT_UNDEFINED — 단계 timeoutOverride 없음(Action.timeout 미정) | 수정: 3 속성·Action › Action |
| TIMEOUT_UNDEFINED — **단계 timeoutOverride 존재·값 미정** (게이트는 `override ?? action.timeout`) | 편집 미지원 + 원인 확인: 4 › Substation 시퀀스 (Action 값을 고쳐도 안 풀림 명시) |
| CONDITION_UNDEFINED — Action.pre/post | 수정: 3 속성·Action › Action |
| CONDITION_UNDEFINED — **단계 진입 조건(entry)** | 편집 미지원 + 원인 확인: 4 › Substation 시퀀스 |
| CONDITION_UNDEFINED — 혼합 | 게이트 출력 순서(pre→post→entry)로 각 항목을 개별 판정. 판별 불가 시 원인 확인만 |
| CAPACITY_UNDEFINED | 수정: 3 속성·Action › 속성 (대상 Unit 선택, 수용 개수 칸) |
| MATERIAL_COUNT — 자재 0개 | 수정: 4 자재·시퀀스 › 자재·Flow (F4) (「+ 자재 정의」) |
| MATERIAL_COUNT — **자재 2개 이상** | 편집 미지원(첫 자재만 편집·삭제 기능 없음), 이동 버튼 없음 |
| MAT_NO_LOCATION, MAT_NO_STATE | 수정: 4 자재·시퀀스 › 자재·Flow (F4) |
| NO_SUBSTATION | 원인 확인: 5 점검 + "6단계 Substation 목록에서 다시 선택" (생성 유도 없음) |
| validateProject 오류 14종 | 원인 확인: 5 점검 › 진단·저장·AML (같은 validateProject 결과가 진단 목록에 표시됨) |
| 그 밖의 코드 | 원인 확인: 5 점검 (정해진 수정 위치 없음) |

- 그룹 실행 대상 보존(H3): 이동 직전에 현재 그룹 Substation을 보기 선호값으로 고정한 뒤 편집 대상을 선택한다. 그래서 다른 Unit을 선택해도 6단계로 돌아오면 원래 그룹이 그대로다.
- 기존 `button.small`·`Badge warn`·테마 변수만 사용. 새 편집기·런타임 규칙·파일 형식 변경 없음. `App`에 테스트 전용 `onHistory` prop(test seam)을 추가했고, 전역 노출은 없다.

## 3. 인수 조건 / 검증 결과
기존 C10-04 [설계 제안] "실행 gate에서 막고 원인 객체로 이동"의 인수 조건을 이 TURN 범위로 구체화한 것이다. **새 요구가 아니다.**

| AC | 내용 | 자동 테스트 (개발) | 독립 에이전트 재검증 rev2 (코드·자동 범위) | 실제 GUI |
|---|---|---|---|---|
| AC1 | DEVICE_CONFLICT → "4 자재·시퀀스 › Substation 시퀀스" 정확 표시, "3 시퀀스" 문구 없음 | `blocker-target`, `ui-blocker-nav` | PASS | PASS (DEVICE_CONFLICT → 4 › Substation 시퀀스) |
| AC2 | 버튼 → 대상 단계/탭/선택. 이동 전후 **history 전체(past/present/future/labels) 동일**, Undo/Redo 복원 동일, 그룹 실행 대상 Substation 유지(▶ 전·차단 후) | `ui-blocker-nav` (jsdom) | PASS (자동 범위) | 대표 2경로 PASS (rev·Undo·Redo 유지). 수용 개수 왕복(그룹 유지) 미검증 |
| AC3 | Action의 완료 Signal·동작 시간·타임아웃 미정 → 3 속성·Action. **단계 timeoutOverride 미정은 3단계 수정으로 안내하지 않고 「현재 화면에서 직접 편집 불가」** | 두 파일 모두 | PASS (지원 한계 명시 포함) | Action 타임아웃 PASS. 단계 override·완료 Signal 미검증 |
| AC4 | 발생 가능 전 코드 매핑(소스 스캔 일치) + 실제 객체 fixture + unknown → 5 점검(원인 확인) + 차단 유지(idle, 시간 0) | `blocker-target` | PASS (대표 실제 입력 범위) | — |
| AC5 | 기본 5공정 11.100 s·병렬 1.2/1.6 s·실행 중 UI 회귀 없음 | 기존 `engine`/`group`/`ui-smoke` | 자동 PASS | **UNVERIFIED** (회귀 실행 GUI 미수행) |

- 개발 결과(rev 2): `vitest` 9파일 **114개** 통과(기존 72 + TURN-001 42: 객체별 fixture 17, jsdom 25). `typecheck`·`npm run build` 통과. aml 테스트의 공식 CAEX XSD 검증은 XSD 파일이 없어 건너뜀(기존과 같음). jsdom은 실제 브라우저 검수가 아님.
- 실제 GUI 검수(작업 에이전트, 사람 검수 아님): 결과는 5절. 대표 2경로만 수행.
- 매뉴얼: UM-0.3.0-r3 (검토용)에 반영, MD·PDF 같은 commit(6절).

## 4. 검토 이력
| 날짜 (KST) | 단계 | 결과 |
|---|---|---|
| 2026-11-08 | rev 1 구현 + 자동 테스트(79) | 개발 완료 보고 |
| 2026-11-08 | 독립 코드·자동검증 검토 | **승인 보류**. H1 진입 조건을 Action 수정으로 잘못 안내 / H2 단계 timeoutOverride를 Action timeout으로 잘못 안내 / H3 수용 개수 이동 시 그룹 실행 Substation이 U-PS1→U-PS2로 바뀜(▶ 전 경로) / M1 자재 2개 이상 편집 불가 / M2 NO_SUBSTATION 생성 유도 근거 없음 / M3 증거 부족(코드 문자열·rev 개수만) |
| 2026-11-08 | rev 2 보완(개발) | 위 표처럼 객체별 판정 + 3종 안내 구분, 그룹 대상 고정. 증거: 실제 게이트 Diagnostic fixture 13종(`tests/fixtures/blocker-fixtures.ts`), 혼합 조건 순서 판정, Action을 고쳐도 단계 원인은 남고 Action 원인은 풀림을 확인, jsdom에서 fixture 12종 × (▶ 전/차단 후) 왕복 클릭, 이동 전후 **history 전체(past/present/future/labels) deep-equal**, Undo/Redo 복원 동일성, 원래 그룹·차단 항목 유지, 실행 차단(idle·시간 0) 유지. H3 수정을 일부러 빼면 ▶ 전 capacity 테스트가 실패하는 것도 확인(뮤테이션 확인). **독립 재검증 전** |

- 남은 한계: 참조 무결성 오류(REF_MISSING_* 등)는 저장소 로드에서 프로젝트가 열리지 않아 jsdom 경로로 재현하지 않음(단위 테스트만). unknown 코드는 게이트가 내지 않아 단위 테스트만 했다. 실제 GUI(크기·테마·키보드)는 미검수.
| 2026-11-08 | 독립 에이전트 재검증 rev2 | **코드·단위·React-jsdom·메모리 내 빌드 범위 PASS**. H1/H2/H3/M1/M2 해소, M3 증거 보강 확인, 새 Blocker/High/Medium 결함 없음. 9파일 114개·typecheck 통과를 독립 재실행. 실제 객체를 직접 다시 만들어 entry/override → 편집 불가, Action 값·수용 개수·자재 값은 화면 편집기가 쓰는 command로 해당 차단이 풀림을 확인. pre 2 + post 1 + entry 2 혼합 → [fix,fix,fix,unsupported,unsupported]. 사람 검수·실제 브라우저 검수 아님. 지적된 문서 정합성 2건(AC2 "rev/Undo 수치 비교" 설명, AC3 "타임아웃 → 3단계" 일반화)은 위 3절 표에 반영 |

- 재검증이 남긴 주의(결함 아님): ① CONDITION_UNDEFINED 판정은 게이트의 pre→post→entry 출력 순서와 같은 Diagnostic 배열 전달에 의존 — 순서 계약 테스트 유지 필요. ② `onHistory`는 테스트용 선택 prop이지만 production 번들에 남음(정상 앱은 넘기지 않음, 전역 노출 없음). ③ 비어 있지 않은 future 상태에서의 이동 테스트는 따로 없음. ④ validateProject 오류 14종 각각을 실제 App에서 연 것은 아님. ⑤ 화면 문구 기대값 일부는 production 문구 함수와 공유.

## 5. GUI 검증 상태 (자동 검증과 분리)
작업 에이전트의 실제 브라우저 조작(사람 검수 아님), Linux Chrome 1280×800, 로컬 HTTP loopback.

| QA 빌드 | 스냅샷 | 쓰임 |
|---|---|---|
| rev 1 빌드 | sha256 `f40536f6…` | 여기서 관측한 결과는 rev 1 기준. rev 2 근거로 쓰지 않음 |
| **rev 2 빌드 (검토 후보)** | sha256 `e72dd046…` (= 이 브랜치 `release/equipment-concept-designer.html`) | 아래 최종 결과 |

| 항목 | rev 2 실제 GUI 결과 |
|---|---|
| DEVICE_CONFLICT (병렬 예제, 시퀀스 A에 `CYL-B1` 추가) | PASS — 「수정 위치: 4 자재·시퀀스 › Substation 시퀀스」 + 버튼 → 4단계 Substation 시퀀스 정확 이동, rev 2·Undo 1·Redo 0 유지 (매뉴얼 그림 21~23) |
| Action 타임아웃 미정 (`CYL-B1` 「B 실린더 전진」) | PASS — `TIMEOUT_UNDEFINED` 2건 + 기존 충돌, 버튼 → 3단계 Action·`CYL-B1` 정확, rev 3·Undo 2·Redo 0 유지 (매뉴얼 그림 19·20) |
| 테마 B/C 문구 가독성·줄바꿈 | 관찰 PASS |
| H3 수용 개수 왕복, H1 단계 진입 조건, H2 단계 timeout override, M1 자재 2개, 완료 Signal | **미수행** — 검증 환경의 파일 선택/업로드 제약으로 시험 파일을 열지 못함. 앱 가져오기 결함으로 확정되지 않음. 자동 테스트·독립 재검증(jsdom 포함) 결과와 별개 |
| 이동 버튼 키보드 포커스 | 미검증 |

- 공통 미검증 유지: CAEX XSD 본문 검사(XSD 파일 없음 → 테스트 건너뜀), Mac/Windows, file:// 직접 열기, 1920 폭, 사람 검수.

### 다시 열 조건 (reopen)
- 특수 사례(수용 개수 왕복·단계 진입 조건·단계 timeout override·자재 2개·완료 Signal)를 실제 GUI에서 확인할 수 있게 되었을 때 — 하나라도 안내 종류·이동·그룹 유지가 자동 결과와 다르면 TURN-001 재개.
- 이동 버튼 키보드 포커스 확인에서 문제 발견 시.
- Mac/Windows Chrome 확인에서 차이 발견 시.
- 게이트 출력 순서(pre→post→entry) 또는 차단 Diagnostic 전달 방식이 바뀔 때(순서 계약 테스트 실패).

### 릴리스 상태
- 검토용 Draft PR만 생성. 정식 릴리스 HOLD, 앱 버전 `0.3.0-prototype` 유지(patch 후보 `0.3.1-prototype`은 사용자 결정). 자동 병합·태그·GitHub Release 없음.
- PR #3(매뉴얼 r2) 위에 쌓은 브랜치 — PR #3이 먼저 병합되어야 함.

## 6. 문서 반영
- `docs/user-manual/USER-MANUAL.ko.md` + `.pdf` → UM-0.3.0-r3 (**검토용, 정식 릴리스 아님**): 9.3 차단 표, 11.3 안내 3종·이동 버튼·편집 불가 한계(그림 19·20), 12.3 기존 "화면 문구 불일치" 주의 삭제·이전 충돌 캡처를 r3 실제 화면(그림 21~23)으로 교체, 17, 18.1/18.2, 19(검증 3종 구분), 부록 A·C.3·C.4·D. "직접 편집 불가"·"원인 확인" 화면은 실제 캡처가 없어 그림 없이 문구만.
- `BROWSER-VERIFICATION.md` TURN-001 절, `REQUIREMENTS-VERIFICATION.md` 0.1절, `docs/REQUIREMENT-CHANGELOG.md` TURN-001 항목(요구 변경 없음).
