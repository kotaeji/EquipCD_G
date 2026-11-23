# TURN-041 Aurora Export 최소판 — 초안 형식 파일과 역매핑 검사

상태: 검토 후보. 사람 검수 전. 정식 릴리스가 아니다. 앱 버전은 `0.3.0-prototype` 그대로다. 파일 형식(프로젝트)은 `0.3.0`. Export 초안 형식은 `aurora-concept-designer/export-draft` `0.1.0`. `release/` 는 다시 빌드하지 않았다. CI 확인 대기 — 루카가 Actions로 확인.

## 한 일

5단계 › Export 미리보기에서 설계 모델을 초안 JSON 파일로 내려받는다. 파일 이름은 `<프로젝트 이름>.aurora-export.json` 이다. Aurora Core 가 받는 형식은 아직 없으므로, 이 파일은 이 앱이 정한 초안이다. 화면과 파일 머리에 `초안 형식 — Aurora Core 가 바로 읽는 형식 아님` 을 적는다. 꺼져 있는 「Core 전송」과 「F8 왕복 계약 · 미구현」은 그대로다.

실행 전 검사를 통과하지 못하면 파일을 만들지 않는다. 까닭과 고칠 곳으로 가는 단추를 보여 준다. 미정이나 가정이 있으면 개수와 목록을 보여 주고, 「미정 N · 가정 M 을 표시한 채 내보내기」를 체크해야 만들 수 있다.

만든 직후 그 파일을 다시 읽어 지금 모델과 맞댄다. 종류별 개수와 `빠진 것 0 · 다른 것 0` 을 보여 준다. 「Export 파일 검사」는 고른 파일과 지금 모델의 추가 · 삭제 · 변경을 ID · 이름 · 값으로 보여 준다. 모델을 바꾸지 않고, rev 와 Undo 도 바꾸지 않는다.

같은 모델은 키를 정렬한 JSON 으로 항상 같은 바이트를 낸다. 만든 시각은 넣지 않는다. 미정 값은 `null` 과 `undetermined` 이고, 0 이나 빈 글자로 바꾸지 않는다.

미리보기 표의 대상 칸은 아래 자리 이름이다.

## 초안 형식

형식 이름 `aurora-concept-designer/export-draft`, 버전 `0.1.0`. 대응 코드는 `src/model/auroraExport.ts` 한 곳이다. Core 형식을 받은 뒤의 TURN 은 이 표의 「파일 자리」만 바꾸면 된다.

| 모델 | 파일 자리 | 적는 것 |
|---|---|---|
| 프로젝트 | 머리 `format`, `formatVersion`, `draft`, `draftNotice`, `appVersion`, `projectId`, `projectName`, `revision` | 초안 표시, 앱 버전, 프로젝트 ID, rev. 만든 시각 없음 |
| Equipment (Station) | `structure.station` | id, 이름 |
| Unit | `structure.station.units[]` | id, 이름, 코드, 수용 개수, 허용 무게. 장치 id 순서 |
| Device | `structure.station.units[].devices[]` | id, 이름, 종류, `definitionRef`(에셋 id @ 버전), 속성 키 · 라벨 · 값 · 단위 · 상태 |
| Signal | `signals[]` | id, 이름, Device, 방향, 역할. 주소가 없으면 `conceptual: "개념 신호"`, `address: null`, 상태 `undetermined`. 주소가 있으면 주소와 `confirmed` / `assumption` |
| Position | `positions[]` | id, 이름, Device, 값 · 단위 · 상태 |
| Station 시퀀스 | `sequence` | id, 이름, 미정 목록. `flow` 가 없으면 `null` |
| Station 단계 | `sequence.steps[]` | id, 이름, 순서, Action id · 이름, Device, 명령 신호, 완료 신호, 동작 시간, 타임아웃(단계 덮어쓰기가 있으면 그것), 조건(pre · post · entry), 효과, 목표 포지션 |
| 흐름 블록 | `sequence.flow[]` | 분기(조건, 참, 거짓), 병렬(갈래), 반복(횟수, 본문), 재시도(조건, 최대 횟수, 본문), Substation 단계(유닛 id). 단계 노드는 `stepId` 만 |
| Substation 시퀀스 | `substationSequences[]` | id, 이름, 유닛, 단계, 흐름. 단계 칸은 Station 단계와 같다 |
| 확인된 Interlock | `interlocks[]` | `interlock-candidate` 이면서 `confirmed` 인 것만. id, 설명, 관련 id |
| 자재 | `excluded[]` | 본문에 넣지 않음. 까닭: 대상 자리 없음. 원본 모델에는 남는다 |
| 확인되지 않은 Interlock | `excluded[]` | 까닭에 확인 상태(`unconfirmed` 등)를 적음 |
| Interlock 이 아닌 제약 | `excluded[]` | 금지 · 전제. 이번 초안의 Interlock 자리가 아님 |

값 상태:

| 모델 | 파일 |
|---|---|
| 값이 `null` | `value: null`, `status: "undetermined"` |
| 값이 있고 `assumption: true` | 그 값, `status: "assumption"` |
| 값이 있고 `assumption: false` | 그 값, `status: "confirmed"` |

주소 상태 `unassigned` 는 주소가 없으면 `undetermined`, `assumed` 는 `assumption`, `confirmed` 는 `confirmed` 다.

역매핑은 위 자리의 id 를 맞댄다. 요약의 「빠진 것」은 모델에만 있는 항목이고, 목록에서는 「추가」다. 「다른 것」은 값이 다른 항목이고, 목록에서는 「변경」이다. 파일에만 있는 항목은 「삭제」다. 머리의 rev 는 차이 행으로 세지 않는다.

## 파일에 없는 것

캔버스 배치, 연결선, 입력 후보, 시뮬 설정, Gap 검토, 가정 메모 문장, 값의 변경 이력, 실행 상태. 가정은 값의 `status` 로 남는다. 자재와 확인되지 않은 Interlock 은 제외 목록에만 있다.

## 화면

Headless Chrome. 1280×800. 기기 픽셀 배율 1. 콘솔 오류 0.

5공정 예제, 체크 전. 「Export 파일 만들기」는 꺼져 있다. 미정 29 · 가정 52. rev 1, Undo 0.

- 확인 전, 라이트: `TURN-041-before-light-1280.png`
- 확인 전, 다크: `TURN-041-before-dark-1280.png`

센서를 하나 더한 뒤 만든 파일. 신호가 30 이다. 빠진 것 0 · 다른 것 0. 그 추가의 Undo 1 은 만들기 뒤에도 그대로다.

- 만든 뒤, 라이트: `TURN-041-result-light-1280.png`
- 만든 뒤, 다크: `TURN-041-result-dark-1280.png`

그 다음 Device 이름을 `이름변경` 으로, STEP-01 동작 시간을 0.8 s 에서 9.5 s 로 바꾸고, 더한 신호를 지운 뒤 같은 파일을 골랐다. 차이 3행: 신호 삭제, Device 이름 변경, Station 단계 동작 시간 변경. 검사는 rev · Undo 를 바꾸지 않았다.

- 차이 목록, 라이트: `TURN-041-diff-light-1280.png`
- 차이 목록, 다크: `TURN-041-diff-dark-1280.png`

## 하지 않은 것

- Aurora Core 실제 스키마, 전송, 실행 가능한 패키지
- Export 파일을 모델에 반영하는 역방향 가져오기
- 프로젝트 파일(`.ecd.json`) 과 AML 입출력
- `src/runtime/`, 단계 바(`wizard.ts`, `.stepper`, `.itemspop`)
- `README.md`, `docs/FEATURE-LIST.md`, `release/` 재빌드, 의존성 추가

## 확인 필요

- 이 파일의 종류가 Aurora 쪽에 넘기기에 충분한지는 사람 검수(AC17)다. 이 문서는 완료로 적지 않는다.
- 배치, 연결선, 입력 후보, 시뮬 설정, Gap 검토, 가정 메모, 값 이력은 빠졌다. 빼는 것이 맞는지 확인이 필요하다.
- Core 형식은 아직 없다. 「Core 전송」은 꺼 둔 채로 둔다.

## 검증

구분해서 적는다. 통과 판정은 CI 를 따른다.

- 로컬 참고: `npm test` 57파일 625개, `tsc --noEmit` 통과. 의존성 변화 없음. 통과 판정은 CI. CI 확인 대기 — 루카가 Actions로 확인.
- 브라우저: 위 여섯 장. 콘솔 오류 0. 만들기와 검사 뒤 rev · Undo 불변.
