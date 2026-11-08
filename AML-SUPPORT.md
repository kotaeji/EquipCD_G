# AML / CAEX 지원 범위 (웹 시제품 v0.2)

작성 2026-11-08 KST. 근거 요구: `docs/requirements-v0.2.md` C02-04~10, C03-04~09. 이 문서는 **실제로 구현·실행해 확인한 것**과 **하지 않은 것**을 구분합니다.

## 1. 기준 표준·버전 (확인한 출처)
| 항목 | 값 | 근거 |
|---|---|---|
| CAEX 버전 | **CAEX 3.0** (`SchemaVersion="3.0"`, namespace `http://www.dke.de/CAEX`) | XSD의 `SchemaVersion` fixed value `3.0` |
| 상위 표준 표기 | `SuperiorStandardVersion` = **AutomationML 2.10** | AutomationML e.V. 공식 예제 `Chapter 2 - Example Models 1.1.aml`의 표기 그대로 |
| 공식 XSD | `CAEX_ClassModel_V.3.0.xsd` — **배포물(ZIP)에 미포함**. 사용자가 직접 다운로드 | 출처: AutomationML e.V. “Chapter 2 – The CAEX and AutomationML Guide” 페이지의 *CAEX Schema file — Download CAEX_ClassModel_V.3.0.xsd (zip compressed)*<br>https://www.automationml.org/about-automationml/publications/amlbook/a-practical-guide/chapter-2-the-caex-and-automationml-guide/<br>검증에 쓴 XSD sha256 `36275ee6f39d75a0ba831f44b67a8bda01f44fa0eff103cadc5396cf54ef123f`, 받은 zip sha256 `dfeeaf41dc4ee12960085069795216114ef75df748e0851078bad7ad25cda4bf` (`standards/caex3.0/SOURCE.md`) |
| 표준 문서 | CAEX 3.0 = IEC 62424:2016 기반 (AutomationML Edition 2) | 같은 페이지·AMLEngine2.1 문서 |
| XSD 재배포 조건 | **미확인 (라이선스·재배포 조건 조사 안 함)** → XSD 원문은 src/assets/verification ZIP 어디에도 넣지 않음. 출처 URL·해시·검증 결과·직접 다운로드 방법만 배포 | — |
| 기타 제3자 파일 | AutomationML 공식 예제 AML·표준 라이브러리 파일은 배포에 넣지 않음. 번들 AML은 이 프로젝트가 작성한 파일이며, 표준 클래스 **경로/이름만** 참조(발췌 선언) | — |

### XSD 직접 받아서 검사하기
1. 위 URL에서 *CAEX_ClassModel_V.3.0.xsd (zip compressed)* 를 받아 압축 해제
2. `standards/caex3.0/CAEX_ClassModel_V.3.0.xsd` 에 두거나 `CAEX_XSD=/경로/CAEX_ClassModel_V.3.0.xsd` 지정 (sha256 위 값과 비교 권장 — 다르면 스크립트가 경고)
3. `pip install lxml` 후 `npm run validate:aml` (XSD가 있을 때만 `assets/aml/xsd-report.json` 갱신)
4. XSD가 없으면 스크립트는 **“NOT RUN”·출처/설치 안내를 출력하고 종료 코드 2**로 끝나며, 통과로 표시하거나 `assets/aml/xsd-report.json`을 바꾸지 않습니다.

## 2. 무엇이 AML에서 읽히는가 (C02-04)
- 앱의 에셋 라이브러리는 **`assets/aml/ecd-sample-library.aml` 한 파일을 읽어** 만듭니다(빌드 시 텍스트로 번들 → 실행 시 `parseAmlLibrary`). 앱 코드 안에 정의 상수 목록은 없습니다.
- `scripts/asset-seed.ts`는 이 AML 파일을 **처음 생성할 때만** 쓰는 생성기 입력이며 앱 번들에 들어가지 않습니다. AML 파일을 직접 고쳐도 앱에 반영됩니다(재빌드 필요).
- 실행 중 **AML 가져오기**(1 입력·에셋 선택 → 「AML 가져오기」)로 다른 AML 파일의 정의를 추가할 수 있습니다. 오류 없는 정의만 추가되고, 같은 ID/이름의 기존 정의는 덮어쓰지 않습니다. 가져온 AML 원문은 이 브라우저 localStorage(`ecd.v1.importedAml`)에 보관되어 다시 열 때 재등록됩니다(프로젝트 파일에는 들어가지 않음).
- **AML 라이브러리 내보내기**: 현재 로드된 정의 전체를 CAEX 3.0 한 파일로 직렬화. parse → serialize → parse 결과가 같고 직렬화가 고정점임을 자동 테스트로 확인.

## 3. 앱 subset 해석표 (C02-08)
| 의미 | CAEX 위치 | 표준/확장 | 해석 실패 시 |
|---|---|---|---|
| 에셋 정의 | `SystemUnitClassLib/SystemUnitClass` (Name=키, ID=정의 ID, Version, Description=표시 이름) | 표준 구조 | ID/Version 없음·중복 → 정의 제외(오류) |
| 역할 | `SupportedRoleClass/@RefRoleClassPath` → 같은 파일의 `ECD_RoleClassLib/*` (⊂ `AutomationMLBaseRoleClassLib/AutomationMLBaseRole/Resource` 발췌) | 표준 구조, 역할 클래스는 앱 정의 | 없거나 파일 안에 없으면 제외 |
| 사양 속성 | 최상위 `Attribute` (`AttributeDataType="xs:double"`, `Unit`, `DefaultValue`) | 표준 | 타입이 xs:double 아님·Unit 없음·숫자 아님 → 정의 제외 (단위를 임의 보충하지 않음) |
| 실행 필요 여부 | 속성 안 `Attribute Name="ECD.requiredForRun"` | **앱 확장** | 없으면 false |
| 포트(Signal) | `ExternalInterface` RefBaseClassPath=`ECD_InterfaceClassLib/ConceptSignal` (⊂ AutomationML `SignalInterface`), 속성 Direction(in/out)·SignalRole(command/complete/sensor/result)·ValueType(xs:boolean) | 구조 표준, 역할 의미는 앱 정의 | 방향/역할/타입 오류 → 정의 제외. 다른 인터페이스 클래스 → 경고 후 무시 |
| 도식/사진 참조 | `ExternalInterface` RefBaseClassPath=`AutomationMLInterfaceClassLib/…/ExternalDataReference`, `refURI`(AML 파일 기준 상대 경로)·`MIMEType`, 이름 `Schematic`/`ReferencePhoto` | 표준 인터페이스 클래스(발췌) | 절대 URI → 정의 제외. 사진 대표 범위 `ECD.PhotoMatchType`/`ECD.ExactModelMatch`/`ECD.ScopeNote`는 **앱 확장** |
| Action(명령·완료·시간) | `Attribute Name="ECD.AppExtension"/Actions/*` (Kind, CommandPort, CompletePort, DurationS, TimeoutS) | **앱 확장** (AutomationML 표준 의미 없음) | 명령 포트가 in 포트가 아님·완료 포트가 out 포트가 아님 → 정의 제외. 완료 포트 비어 있음 → 경고(미정, 실행 차단) |
| 분류·이름 접두어 | `ECD.AppExtension/Category`, `NamePrefix` | **앱 확장** | Category 미지원 → 제외 |
| 복합 유닛 템플릿 자식 | `InternalElement` (`RefBaseSystemUnitPath` = 같은 파일의 SUC 경로), 자식 안 `ExternalInterface`(ID) | 표준 | 참조 없음·자기참조(순환)·유닛 안 유닛 → 템플릿 제외 |
| 템플릿 내부 연결 | `InternalLink` (`RefPartnerSideA/B` = 인터페이스 **ID**, CAEX 3.0 방식) | 표준 | 끝점 ID 없음·포트 없음·방향이 out→in 아님 → 템플릿 제외 |
| 템플릿 배치/규칙 | `ECD.AppExtension/TemplateLayout`(W,H), `TemplateRules`(자식 Action의 사전조건), 자식 `ECD.AppExtension.LayoutOffset` | **앱 확장** | 대상 Action/포트 없음 → 템플릿 제외 |
| 미지원 | `InstanceHierarchy`, CAEX `ExternalReference`(외부 AML), 중첩 SystemUnitClass(상속), 접두어 namespace, CAEX 2.15 | — | 경고 후 무시 또는 파일 거부(2.15·namespace 불일치·루트 아님) |

## 4. 로드 판정 단계 (C02-07) — 각 단계 결과를 따로 표시
1. **XML 구문**: fast-xml-parser `XMLValidator` (브라우저). 실패 → 파일 거부, 줄 번호 표시.
2. **CAEX 식별**: 루트 `CAEXFile`, 기본 namespace, `SchemaVersion="3.0"`. 실패 → 파일 거부.
3. **앱 subset 의미 검사**: 위 표. 정의별로 오류가 있으면 그 정의(와 그것을 자식으로 쓰는 템플릿)만 제외, 나머지는 사용 가능. 진단 위치 = `라이브러리/SUC[/요소]`.
4. **공식 XSD 검사**: **브라우저 안에서는 하지 않음.** `npm run validate:aml` (`scripts/validate-aml.py`, Python lxml/libxml2)로 별도 실행. 번들 파일은 XSD가 있는 개발 환경에서 미리 자동 검사해 결과(`assets/aml/xsd-report.json`, 파일 내용 해시 포함)를 같이 번들 → 앱은 **보고서가 통과이고 해시가 일치할 때만** “XSD 통과(앱 밖 자동 검사 기록)”로 표시, 해시 불일치·보고서상 실패는 각각 “미검증” 사유로 표시, 가져온 파일은 항상 “XSD 미검증”. 앱 자체는 XSD 파일을 포함하거나 읽지 않습니다(정적 확인: `src/ui/Library.tsx` `xsdStatus`, `src/assets/aml.ts` `xsdValidatedInApp: false`).

## 5. 실제 실행 결과 (2026-11-08 KST, 에이전트 작업 폴더의 로컬 XSD 사본으로 자동 실행, `docs/verification/xsd-validation.json`)
| 파일 | XML | CAEX | 공식 XSD | 앱 subset |
|---|---|---|---|---|
| `assets/aml/ecd-sample-library.aml` (14종) | 통과 | 3.0 | **통과** (lxml 6.1.3 / libxml2 2.14.6) | 오류 0 · 경고 0 |
| `samples/aml/extra-asset-vacuumGripper.aml` | 통과 | 3.0 | **통과** | 오류 0 (가져오기로 1종 추가 확인) |
| `samples/aml/missing-child-ref.aml` | 통과 | 3.0 | **통과** | **오류** `CHILD_REF_MISSING` — XSD 통과 ≠ 의미 적합 |
| `samples/aml/unsupported-schema-2.15.aml` | 통과 | 2.15 | 실패 (SchemaVersion fixed 3.0) | 파일 거부 `SCHEMA_VERSION` |
| `samples/aml/invalid-syntax.aml` | 실패 | — | 실패 | 파일 거부 `XML_SYNTAX` |

**XSD 통과는 구조 적합성만 뜻합니다.** AutomationML 의미 규칙(역할/인터페이스 라이브러리 규칙, Application Recommendations) 적합성, AutomationML Editor/AMLEngine에서의 열기는 **검증하지 않았습니다.** 표준 라이브러리는 `AutomationMLInterfaceClassLib`/`AutomationMLBaseRoleClassLib`의 **필요한 부분만 발췌**해 파일 안에 넣었고(“EXCERPT” 설명 포함) 전체 라이브러리가 아닙니다.

## 6. 시각 자료 (C03-04~09)
- 도식: `assets/visuals/schematic/<kind>.svg` — `src/ui/Symbols.tsx`로 직접 그린 벡터(제품 도면 아님). 앱은 같은 컴포넌트로 그립니다.
- 실사진: `assets/visuals/photos/*.jpg` 12장 (14종이 공유) — Wikimedia Commons 실제 촬영 사진을 900px 이하로 축소·JPEG 변환. 생성 이미지 없음. 메타데이터 `assets/visuals/photo-manifest.json`, `assets/visuals/ATTRIBUTION.md`. 라이선스 CC0 / CC BY 3.0·4.0 / CC BY-SA 3.0·3.0 de·4.0 (BY-SA 파생 축소본은 같은 라이선스로 배포해야 함).
- **대표 범위**는 에셋별로 AML에 기록: class-reference(같은 종류 대표) 9종, component-reference(구성품 — 푸셔·스토퍼에 실린더 사진) 2종, assembly-reference(복합 유닛 참고 구조) 3종. **정확 모델 일치는 14종 모두 ‘아니오’.** 사진은 제조사·모델·성능의 근거가 아닙니다.
- 빌드 시 사진은 data URL로 인라인(오프라인 단일 HTML, 약 1.97 MB). 가져온 AML의 사진 참조는 파일을 함께 받을 수 없어 “참조 해석 불가 → 도식”으로 표시합니다.
- 도식/실사진 토글은 UserView 값이며 배치·연결·속성·논리 상태를 바꾸지 않음(자동 테스트·헤드리스 Chrome 확인). 실사진 모드에서는 Device 상태 애니메이션(전진/상승 등)이 사진에 반영되지 않고 활성 테두리만 표시됩니다.
