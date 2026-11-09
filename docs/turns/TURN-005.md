# TURN-005 도면 캔버스 React Flow

상태: 검토 후보. 사람 검수 전. 정식 릴리스가 아니다. 앱 버전은 `0.3.0-prototype` 그대로다. 파일 형식 `0.2.0` 과 실행 규칙은 바꾸지 않았다. `release/` 는 다시 빌드해 커밋하지 않았다. CI 확인 대기 — 루카가 Actions로 확인.

## 한 일

「도면 도식」과 실행 단계 캔버스를 `@xyflow/react` 로 그렸다. 직접 그리던 `svg.canvas-svg` 는 없다. 노드와 엣지는 매 렌더 `Project` 에서 만들고, 끌기 중의 좌표는 화면에만 있다. 놓으면 기존 `onMoveCommit` 을 한 번 부른다. 모델 좌표와 React Flow 좌표는 1:1 이고, 확대·이동은 뷰포트에만 있다. `view.zoom` 은 뷰포트 확대율과 맞춘다.

의존성은 `@xyflow/react` 하나다. `style.css` 는 가져오지 않고 `dist/base.css` 만 가져온다. 색은 기존 토큰만 쓴다. 새 색 리터럴은 Unit·컨트롤 그림자 `rgba(16, 24, 40, .06)` 뿐이다.

휠 확대는 0.5–2, 빈 곳 드래그로 이동, 열 때 `fitView`(여백 0.15), 미니맵, 확대·축소·전체 보기 컨트롤을 넣었다. 더블클릭 확대는 규격에 없어 껐다.

## 하지 않은 것

- 핸들을 끌어 연결하기, 연결 규칙 안내
- Unit 안에 Device 를 서브플로로 두기, 소속 이동 영향 검사 변경
- 배치·연결 단계의 카드 보드, 도면 접기 위치
- 프로젝트 JSON, 파일 형식, rev, Undo 규칙, 실행 엔진
- 헤더, 탭 바, 스텝퍼 색
- `release/` 재빌드 커밋
- 사람 검수

## 검증

구분해서 적는다.

| 종류 | 결과 |
|---|---|
| 자동 테스트 | `npm test` 15파일 363개 통과. 캔버스 교체·다중 이동 1회 Undo·소속 변경 모달·확대가 모델을 안 바꾸는 것·연결·레이어·정렬·삭제·실행 잠금·CSS 토큰·대비를 포함한다. 이 숫자는 이 문서 작성 시점의 로컬 실행이다. 통과 판정은 CI 를 따른다 |
| 형식 검사 | `npm run typecheck` 통과 (`npm run build` 의 tsc 포함) |
| 빌드 | `npm run build` 로 크기만 재고 `release/` 는 되돌렸다. 전 3,890,485바이트, 후 4,102,530바이트, 증가 212,045바이트 |
| jsdom | `ResizeObserver`, `DOMMatrixReadOnly`, `PointerEvent` 대역을 둔다. 대역으로 노드 이동·모달·툴바 확대·컨트롤 확대·휠 뒤 rev 불변·레이어·연결을 봤다. 대역은 레이아웃 엔진이 아니다 |
| Chrome | 156 계열 headless, CSS 뷰포트 1280×800, devicePixelRatio 1. 콘솔 오류 0. 휠로 확대율이 56%에서 74%로 바뀌고 rev 는 1, Unit 변환은 `translate(30px, 70px)` 그대로였다. 툴바를 150%로 맞춘 뒤에도 그 변환과 rev 는 같았다. 실행 중 신호선에 `rf-sig-on`(`stroke: var(--success)`), 활성 장치, 자재 라벨이 있었다. `prefers-reduced-motion: reduce` 에서 그 선의 `animation-name` 은 `none` 이었다. Unit 모서리 10px, 머리띠 28px, 장치 이름 11px, 컨트롤 28px, 미니맵 160×110, 라이트 그림자와 다크 `box-shadow: none` 을 계산 스타일로 봤다 |

그림은 이 폴더에 있다.

- `docs/turns/TURN-005-canvas-light-1280.png`
- `docs/turns/TURN-005-canvas-dark-1280.png`
- `docs/turns/TURN-005-run-light-1280.png`
- `docs/turns/TURN-005-zoom-minimap-1280.png`

노드 글자(`--text`, `--muted`)는 `--panel` / `--canvas` / `--selected` 에서 4.5:1 이상이다. 포트·물류선·신호선·자재 테두리에 쓰는 `--text` `--accent` `--muted` `--success` `--warning` 은 `--panel` / `--canvas` 에서 3:1 이상이다. 컨트롤 테두리 토큰 `--border` 는 라이트에서 `--panel` 대비 1.48:1, `--canvas` 대비 1.36:1 이고, 다크에서 `--panel` 대비 2.75:1 이다. 다크 `--canvas` 대비만 3.19:1 이다.

## 확인 필요

- AC8 컨트롤 테두리. 규격은 `var(--border)` 라서 그 토큰을 썼다. 라이트와 다크 버튼 면에서는 3:1 에 못 미친다. 새 색은 만들지 않았다.
- AC12 사람 검수는 Matthew 몫이다. 이 문서는 완료로 적지 않는다.
- 미니맵 마스크는 라이브러리가 뷰포트 바깥에 칠한다. 색은 `--canvas` 를 0.7 로 푼 값이다.
- React Flow 표시(attribution)는 숨기지 않았다. 미니맵과 겹치지 않게 오른쪽 위로 옮기고 토큰으로만 칠했다.
- 더블클릭 확대는 끄다. 자재 미니맵 색은 `--warning` 이다.
- 확대율이 바뀌며 부모가 다시 그려질 때 도면 접기가 바로 닫히지 않게, 사용자가 연 상태는 유지한다. 접기 위치는 그대로다.
