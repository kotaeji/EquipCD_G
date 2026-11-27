# TURN-090 흐름 표 · Substation 시퀀스 카드 밀도

상태: 검토 후보. 사람 검수 전. 정식 릴리스가 아니다. 앱 버전은 `0.3.0-prototype` 그대로다. 파일 형식과 실행 규칙은 바꾸지 않았다. `README.md` 와 `release/` 는 이 TURN에서 고치지 않았다. CI 확인 대기 — 루카가 Actions로 확인.

## 한 일

- 흐름 표의 줄 끝 단추(위로 · 아래로 · 밖으로 등)는 표 너비가 720px 미만이면 「⋯」 하나로 접힌다. 메뉴 항목과 순서는 우클릭 메뉴와 같다. 720px 이상이면 지금처럼 펼친다. 측정되지 않은 너비(jsdom의 0)는 펼친 채로 두어 기존 테스트가 「위로」를 찾는다.
- 「⋯」는 Enter · Space로 열리고, 메뉴는 ↑↓ · Enter · Esc로 움직인다. Esc로 닫으면 초점이 「⋯」로 돌아온다.
- 블록 깊이는 `--sp-4`(16px) 한 걸음이다. 이름 칸은 `flow-name` 이고, 왼쪽에 깊이를 잇는 세로선이 있다. 줄 높이는 표 규칙 `--sp-6` 이다. Station 흐름 표와 Substation 시퀀스 흐름 표가 같은 클래스다.
- Substation 시퀀스 카드의 최소 너비는 `--seq-card-min`(16 × `--sp-6` = 512px)이다. 그보다 좁아지면 한 칸으로 쌓인다. 카드 내용은 카드 밖으로 나가지 않는다.
- Substation 시퀀스 화면의 「병렬로 묶기」 · 「Substation 시퀀스 넣기」는 `disabled` 이고, `title` 에 모델과 같은 까닭이 있다. 우클릭 메뉴의 「병렬로 묶기」와 명령 찾기의 두 항목도 꺼진다. 모델의 거절은 그대로다.

새 스타일은 `src/ui/flow-table.css` 와 `src/ui/substation-panels.css` 에 두었다. 글자 · 간격은 `--fs-*` · `--sp-*` 만 쓴다.

## 화면 (1280×800)

Headless Chrome. 기기 픽셀 배율 1. 콘솔 오류 0. 문서 스크롤은 뷰포트와 같다 (`scrollWidth` 가 1024 · 1280 · 1600, `scrollHeight` 800).

깊이 0 · 1 · 2 의 이름 칸 왼쪽 여백은 8px · 24px · 40px 이다. 걸음은 16px(`--sp-4`)이다.

1024 · 1280 · 1600 에서 Station 흐름 표와 Substation 시퀀스 카드의 줄 · 머리 글자 · 단추가 표 오른쪽을 넘지 않았다. 카드의 `scrollWidth` 와 `clientWidth` 가 같았다.

- 1280, 탐색기 열림: 카드 한 칸(표 966px). 줄 단추는 펼쳐 있다.
- 1280, 탐색기 접힘: 카드 두 칸(표 560px). 줄 단추는 「⋯」다.
- 1600: 카드 두 칸(표 628px). 줄 단추는 「⋯」다.
- 1024: 카드 한 칸(표 894px). 줄 단추는 펼쳐 있다.

「⋯」를 포인터가 아니라 키보드로 열었다. Enter로 열리고 첫 사용 항목에 초점이 간다. ↑↓로 옮기고 Esc로 닫으면 초점이 「⋯」(`aria-label`)로 돌아온다. 메뉴 항목은 우클릭과 같은 12개, 같은 순서다.

- Station 흐름, 라이트: `TURN-090-station-light-1280.png`
- Station 흐름, 다크: `TURN-090-station-dark-1280.png`
- Substation 카드 한 칸, 라이트: `TURN-090-sub-one-light-1280.png`
- Substation 카드 한 칸, 다크: `TURN-090-sub-one-dark-1280.png`
- Substation 카드 두 칸, 라이트: `TURN-090-sub-two-light-1280.png`
- Substation 카드 두 칸, 다크: `TURN-090-sub-two-dark-1280.png`

## 하지 않은 것

- 흐름 표의 새 기능, 블록 종류, 실행 규칙, SFC 미리보기
- `README.md`, `release/` 재빌드, 의존성 추가
- `tests/turn054.test.ts`

## 확인 필요

- 흐름의 구조가 한눈에 읽히는가는 사람 검수(AC9)다. 이 문서는 완료로 적지 않는다.
- 줄 단추를 접는 기준은 표 너비 720px 이다. 카드 최소 너비는 512px 이다. 1280에서 탐색기가 열려 있으면 카드가 한 칸이고, 탐색기를 접거나 1600이면 두 칸이다.
- TURN-072 UI 테스트는 단추를 눌러 거절 알림을 보던 것을, 단추가 꺼져 있고 모델이 그대로인 것으로 바꿨다. 모델 거절은 `tests/turn072.test.ts` 가 그대로 본다.

## 검증

구분해서 적는다. 통과 판정은 CI를 따른다.

| 종류 | 결과 |
|---|---|
| 자동 테스트 | 로컬에서 `tests/ui-turn090.test.tsx`, `tests/ui-turn023.test.tsx`, `tests/flow.test.ts`, `tests/ui-turn063.test.tsx`, `tests/turn063.test.ts`, `tests/ui-turn072.test.tsx`, `tests/turn072.test.ts`, `tests/ui-turn073.test.tsx`, `tests/turn054.test.ts` 통과. 이 결과는 이 문서 작성 시점의 로컬 실행이다. 통과 판정은 CI |
| 형식 검사 | 로컬 `tsc --noEmit` 통과 |
| Chrome | 위 측정. 포인터가 아닌 `keyboard.press`. 콘솔 오류 0 |

## AC

| ID | 판정 | 근거 |
|---|---|---|
| AC1 | 충족 | Chrome 1024 · 1280 · 1600. 줄·단추가 표 오른쪽을 넘지 않음. 카드 `scrollWidth` = `clientWidth` |
| AC2 | 충족 | `tests/ui-turn090.test.tsx`. 좁은 표의 「⋯」 메뉴 항목·순서가 우클릭과 같다 |
| AC3 | 충족 | 같은 테스트와 Chrome 키보드. Enter · ↑↓ · Esc. 닫으면 초점이 「⋯」로 돌아온다 |
| AC4 | 충족 | 같은 테스트. 깊이 1 · 2 · 3 이 `flow-name` 과 `--flow-step: var(--sp-4)`. Chrome 여백 8 · 24 · 40px |
| AC5 | 충족 | 같은 테스트. `--seq-card-min` 512px. Chrome 1280 한 칸, 탐색기 접힘·1600 두 칸 |
| AC6 | 충족 | 같은 테스트와 `tests/ui-turn072.test.tsx`, `tests/turn072.test.ts`. 단추 `disabled` + `title`. 모델 거절은 그대로 |
| AC7 | 충족 | 로컬에서 TURN-023 · 063 · 072 · 073 과 `tests/flow.test.ts`(TURN-022 흐름 명령) 통과. 통과 판정은 CI |
| AC8 | 충족 | 위 여섯 장. 1280×800, 라이트 · 다크 |
| AC9 | 사람 검수 필요 | 흐름 구조가 한눈에 읽히는가 |
