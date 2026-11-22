# TURN-027 Ctrl + A 전체 선택과 Ctrl + 클릭 선택 · 해제

상태: 검토 후보. 사람 검수 전. 정식 릴리스가 아니다. 앱 버전은 `0.3.0-prototype` 그대로다. `release/` 는 다시 빌드하지 않았다. `README.md` 는 TURN-026 · 028 과 겹치지 않도록 이 PR에서 고치지 않았다. CI 확인 대기 — 루카가 Actions로 확인.

## 바뀐 조작

1. 2단계 「배치·연결」에서 선택이 비어 있을 때 Ctrl + A(Mac 은 Cmd + A)는 모든 Unit 을 고른다. 브라우저의 글자 전체 선택은 하지 않는다.
2. Unit 하나가 골라져 있거나, 고른 Device 가 모두 한 Unit 소속이면 Ctrl + A 는 그 Unit 의 Device 전부를 고르고 Unit 은 선택에서 빠진다. Device 가 없는 Unit 이면 선택은 그대로 두고 「이 Unit 에는 Device 가 없습니다」를 알린다.
3. Unit 이 둘 이상이거나 선택이 여러 Unit 에 걸치면 Ctrl + A 는 모든 Unit 을 고른다.
4. Ctrl + 클릭(Cmd + 클릭)은 Unit 과 Device 에서 선택과 해제를 번갈아 한다. 해제하는 클릭은 남은 선택을 끌고 가지 않는다. 더하는 클릭 뒤의 끌기는 지금처럼 함께 옮긴다. Shift + 클릭과 Shift + 끌기는 그대로다.
5. 입력 칸에 커서가 있거나 대화상자가 열려 있으면 앱은 Ctrl + A 를 쓰지 않는다. 2단계가 아니면(홈 · 다른 단계 · 안내 화면)도 가로채지 않는다. 실행 중 · 일시정지 중에 2단계로 돌아오면 선택은 되고, 편집은 잠긴다.
6. 카드 보드도 같은 Ctrl + A 와 Ctrl + 클릭을 쓴다. 카드의 Shift + 클릭은 원래대로 그 항목만 고른다.

## 한 일

- 고르는 규칙은 `src/ui/selectAll.ts` 한 곳이다. 모델 · rev · Undo 는 바꾸지 않는다.
- 도면의 포인터 처리는 Ctrl/Cmd 를 더하기에서 토글로 바꿨다. Shift 는 더하기만 한다.
- 안내 한 줄은 도면 도구 줄과 범례 `title` 에 넣었다. `Ctrl + A: Unit 전체 또는 그 Unit의 Device 전체 · Ctrl + 클릭: 선택과 해제`.

## 화면 (1280×800, 5공정 예제, 도면 도식)

Chrome 으로 개발 서버를 열어 찍었다. Unit 전체는 맞추기 기본값(확대 50%)이다. Device 전체는 두 장치의 테두리가 보이게 휠로 확대한 뒤다(표시 확대 약 97%).

- Unit 전체, 라이트: `TURN-027-units-light-1280.png`
- Unit 전체, 다크: `TURN-027-units-dark-1280.png`
- S1 의 Device 전체, 라이트: `TURN-027-devices-light-1280.png`
- S1 의 Device 전체, 다크: `TURN-027-devices-dark-1280.png`

같은 화면에서 Ctrl + 클릭으로 Unit 을 더하고, 이미 고른 Unit 을 Ctrl 로 누른 채 끌어도 남은 Unit 의 위치와 rev 는 그대로였다. 다시 Ctrl + 클릭하면 그 Unit 이 선택에 돌아왔다.

## 하지 않은 것

- `README.md`, `release/`, 의존성, 모델 · 파일 형식
- `src/ui/viewSettings.ts`, `src/ui/styles.css` 의 테마 · `.cards` · `.palette`
- 복사 · 붙여넣기, 선택 상자 모양, Device 자동 정렬
- 사용자 매뉴얼, 기능 목록

## 확인 필요

- AC10 은 Matthew 검수 전이다. 이 문서는 완료로 적지 않는다.
- 3단계 「속성·Action」에는 도면이 없다. 6단계 실행 도면은 같은 캔버스지만, 그 화면의 표와 로그 글자 때문에 Ctrl + A 를 가로채지 않았다. 클릭으로 고르는 것은 그대로다.
- 연결선만 골라져 있으면 비어 있는 것으로 보고 모든 Unit 을 고른다.
- 카드 보드에는 선택 방법 문장이 원래 없어서, 안내 한 줄은 도면 도구 줄과 범례에만 더했다.
