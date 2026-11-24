# TURN-072 Substation 시퀀스 안의 흐름 블록

상태: 검토 후보. 사람 검수 전. 정식 릴리스가 아니다. 앱 버전은 `0.3.0-prototype` 그대로다. 파일 형식은 `0.3.0`. 실행 규칙은 `seq-runtime/0.9.0`. `release/` 는 다시 빌드하지 않았다. `README.md` 는 고치지 않았다. CI 확인 대기 — 루카가 Actions로 확인.

## 실행 규칙 (seq-runtime/0.9.0)

1. Substation 시퀀스의 `flow` 가 없으면 단계 배열 순서대로 돈다. 예제 3종의 시각 · 로그 코드 · 저장 바이트는 그대로다. `RUN_START` 의 규칙 문자열만 `seq-runtime/0.9.0` 이다.
2. `flow` 가 있으면 Station 시퀀스의 Substation 단계가 그 시퀀스를 갈래로 돌릴 때, 그 갈래는 분기 · 반복 · 재시도 · 신호 기다림을 Station 흐름과 같은 방식으로 따른다.
3. `BRANCH_TAKEN` · `LOOP_ITER` · `RETRY` · `RETRY_EXHAUSTED` 앞에 시퀀스 이름이 붙는다. 여러 개체면 `개체 N · 시퀀스 이름` 이다. `WAIT_START` · `WAIT_END` · `WAIT_TIMEOUT` 은 갈래 칸에 시퀀스 이름이 들어간다.
4. 단계 표의 「갈래 · 회차」는 시퀀스 이름과 회차다. 안 간 갈래의 단계는 「건너뜀」이고 그 칸에도 시퀀스 이름이 있다.
5. 빈 갈래는 실행을 막지 않는다. 조건 검사의 안내이고, 「이동」은 Substation 시퀀스 화면의 그 줄로 간다. 미정 조건과 타임아웃 미정은 실행 전에 막고, 「이동」도 그 줄로 간다.
6. Substation 시퀀스 안에 병렬이나 Substation 단계를 넣으면 거절하고 모델은 그대로다.
7. Substation 하나만 일시정지하는 규칙은 흐름이 있어도 같다. 멈춘 동안 그 시퀀스의 Action 남은 시간과 신호 기다림 타임아웃은 가지 않는다.
8. 같은 모델, 같은 조작 순서는 같은 로그를 낸다.

## 한 일

- 4단계 Substation 시퀀스에서 Station 과 같은 흐름 표로 분기(갈래 2~4) · 반복 · 재시도 · 신호 기다림을 묶고 푼다. 한 번이 rev +1, Undo 한 번. 표 위에 「Substation 시퀀스 흐름」이라고 적고 Station 흐름과 구분한다. 단계 시간 칸은 남겼다.
- SFC 의 Substation 단계는 접혀 있다. 「펼치기」를 누르면 시퀀스마다 안의 흐름이 보인다.
- 실행 전 검사와 조건 검사가 Substation 흐름의 미정 조건 · 타임아웃 미정 · 빈 갈래를 잡고, 「이동」은 4단계 Substation 시퀀스의 그 줄로 간다.
- 예제 3종에는 Substation 흐름을 넣지 않았다. 파일 형식은 `0.3.0` 그대로다.

## 화면 (1280×800)

Headless Chrome. 기기 픽셀 배율 1. 콘솔 오류 0. 문서 스크롤 0 (`scrollWidth` 1280, `scrollHeight` 800).

병렬 예제의 S1 시퀀스 A 두 단계를 분기로 묶었다. 조건은 `자재 상태 = 대기` 라 참 갈래만 돈다. 가상 시간 `00:02.500`. 단계 목록의 갈래 칸은 `S1 시퀀스 A (클램프 A) · 1회`. SFC 는 S1 을 펼친 상태다.

- Substation 흐름 표, 라이트: `TURN-072-flow-light-1280.png`
- Substation 흐름 표, 다크: `TURN-072-flow-dark-1280.png`
- 펼친 SFC, 라이트: `TURN-072-sfc-light-1280.png`
- 펼친 SFC, 다크: `TURN-072-sfc-dark-1280.png`
- 실행 뒤 단계 표, 라이트: `TURN-072-steps-light-1280.png`
- 실행 뒤 단계 표, 다크: `TURN-072-steps-dark-1280.png`

## 하지 않은 것

- Substation 시퀀스 안의 병렬 · Substation 단계. 넣으면 거절한다
- 시퀀스 하나만 일시정지. 일시정지는 Substation 단계(유닛) 단위다
- 그룹 실행(`group-runtime/0.2.0`)은 여전히 단계 배열 순서다. Station 실행의 Substation 단계만 시퀀스 흐름을 따른다
- `README.md`, 사용자 매뉴얼, `release/` 재빌드, 의존성, `styles.css`, `tests/turn054.test.ts`

## 확인 필요

- Station 흐름과 Substation 흐름이 헷갈리지 않는가는 사람 검수(AC10)다. 이 문서는 완료로 적지 않는다.
- 빈 갈래는 TURN-063 과 같이 실행을 막지 않고 조건 검사 안내만 한다. Issue 문구의 「빈 갈래」는 그 안내와 「이동」으로 받았다.
- 병렬 예제는 자재가 S1 을 비우지 않는다. 투입 2 이면 첫째 개체는 Substation 반복을 따르고, 둘째는 S1 수용 때문에 `DEADLOCK` 이다. 유닛을 비우는 시퀀스에서 개체마다 흐름이 끝나는 조합은 이 예제로 끝내지 못했다.
- 사용자 매뉴얼과 `README.md` 의 규칙 표기는 아직 `seq-runtime/0.8.0` 이다. 이 TURN 은 그 파일을 고치지 않았다.

## 검증

구분해서 적는다. 통과 판정은 CI를 따른다.

| 종류 | 결과 |
|---|---|
| 자동 테스트 | 로컬 `npm test` 134파일 1074개 통과. 그 가운데 `tests/turn072.test.ts`, `tests/ui-turn072.test.tsx`. 이 숫자는 이 문서 작성 시점의 로컬 실행이다. 통과 판정은 CI |
| 형식 검사 | 로컬 `tsc --noEmit` 통과 |
| Chrome | 1280×800, devicePixelRatio 1. 위 측정. 콘솔 오류 0 |

## AC

| ID | 판정 | 근거 |
|---|---|---|
| AC1 | 충족 | `tests/ui-turn072.test.tsx` 분기 · 반복 · 재시도 · 신호 기다림 묶기/풀기, rev +1, Undo 한 번 |
| AC2 | 충족 | 같은 UI 테스트와 `tests/turn072.test.ts`. 병렬 · Substation 단계는 거절되고 저장 문자열이 같다 |
| AC3 | 충족 | `tests/turn072.test.ts` 분기 한쪽, 반복 2회(3.400s), 재시도 1회, 이미 참인 기다림 0s |
| AC4 | 충족 | 로그에 시퀀스 이름, 단계 표 `lane` · `pass`. 같은 모델을 두 번 돌리면 로그가 같다 |
| AC5 | 충족 | 예제 시각 `11100` · `2500` · `13100`. Substation 시퀀스에 `flow` 없음. 다시 저장한 바이트가 같다. 흐름 없는 병렬 예제 로그에 `BRANCH_TAKEN` 없음 |
| AC6 | 충족 | 미정 조건 · 타임아웃 미정은 실행 전 차단이고 「이동」이 Substation 흐름 줄. 빈 갈래는 조건 검사 안내이고 「이동」이 `flow:…:arm:1` |
| AC7 | 충족 | UI 테스트. 접힌 SFC 에 단계 이름이 없고, 펼치면 분기와 단계가 보인다. 스크린샷 |
| AC8 | 충족 | 반복이 있는 S1 을 멈추면 그 시퀀스 기록은 그대로고 S2 는 끝난다. 재개 후 반복 횟수만큼 돈다 |
| AC9 | 충족 | 위 여섯 장. 1280×800, 라이트 · 다크, 콘솔 오류 0, 문서 스크롤 0 |
| AC10 | 사람 검수 필요 | Station 흐름과 Substation 흐름의 구분 |
