# TURN-009 배치·연결 카드 보드 · 도면 도식 탭

상태: 검토 후보. 사람 검수 전. 정식 릴리스가 아니다. 앱 버전은 `0.3.0-prototype` 그대로다. 파일 형식 `0.2.0` 과 실행 규칙은 바꾸지 않았다. `release/` 는 다시 빌드해 커밋하지 않았다. CI(`check`)는 `c169cf7`에서 통과했다(run 42991187584). AC8은 Matthew 검수 전이다.

## 한 일

1. 배치·연결의 팔레트 바로 아래에 「카드 보드 · 도면 도식」 탭을 두었다. TURN-008의 `src/ui/Tabs.tsx` 를 그대로 쓴다. `role="tablist"` / `tab` / `tabpanel`, ←/→ 로 전환하고 선택 탭만 보인다. 새 탭 스타일은 없다.
2. 카드 보드 탭에 지금 `LayoutBoard` 와 물류 요약(`path-note`)을 넣었다. 안내 글은 「좌표·포트·신호선은 도면 도식 탭에서 움직입니다」다.
3. 도면 도식 탭에 도식/실사풍 토글, 좌/상 정렬, 삭제, React Flow 캔버스를 넣었다. `diagram-fold` 접는 칸은 없앴다.
4. 단계 칸은 남은 높이를 채우고 페이지는 세로로 스크롤하지 않는다. 1280×800에서 도면 캔버스 높이는 367px이다. 팔레트는 펼친 채로 한 줄이고, 종류가 많으면 그 줄만 가로로 스크롤한다.
5. 「신호 연결」을 고르면 도면 도식 탭으로 바뀐다. 카드 보드에서 고른 선택은 탭을 바꿔도 남는다. 신호 모드여도 카드 보드 탭으로 다시 갈 수 있다.
6. 고른 탭은 UserView(`ecd.v1.userView`)의 `layoutTab` 에만 저장한다. 기본값은 카드 보드다. 프로젝트 JSON에는 들어가지 않는다.

## 하지 않은 것

- React Flow 노드·엣지·확대, 실행 단계 캔버스
- 탐색기 · 위쪽 탭 바 — TURN-008
- 오른쪽 속성 칸, 모델, 파일 형식, rev, Undo
- 의존성 추가, `release/` 재빌드
- 사용자 매뉴얼의 배치·연결 설명

## 검증

구분해서 적는다.

| 종류 | 결과 |
|---|---|
| 자동 테스트 | GitHub Actions `check` 통과 (`c169cf7`, run 42991187584). typecheck · test · build, 그리고 TURN PR의 `release/` 불변 검사까지 포함. 로컬 `npm test`도 19파일 388개였다. `tests/ui-turn009.test.tsx` 4개(탭 위치·ARIA·←/→, 신호 연결과 선택 유지, 두 탭 끌어 놓기·카드 두 번 클릭 연결·도식 토글, UserView 유지). `tests/canvas-flow.test.tsx` · `tests/ui-smoke.test.tsx` 는 「도식」 버튼을 탭 글자와 구분하도록 고쳤다 |
| 형식 검사 | 같은 `check` 잡의 typecheck · build 통과. 로컬 `npm run typecheck`도 통과 |
| Chrome | 156.0.8078.47, CSS 뷰포트 1280×800, devicePixelRatio 1. 콘솔 오류 0. 문서 스크롤 0. 카드 보드·도면 도식 모두 단계 칸 스크롤 0. 도면 `.diagram-canvas` 높이 367px, 아래 끝 744px(창 800). 탐색기 Project 탭이 선택된 상태다. 카드의 PSH-01을 고른 뒤 신호 연결을 누르면 도면 탭이 열리고 그 선택은 남는다 |

- `docs/turns/TURN-009-board-light-1280.png`
- `docs/turns/TURN-009-board-dark-1280.png`
- `docs/turns/TURN-009-diagram-light-1280.png`
- `docs/turns/TURN-009-diagram-dark-1280.png`

## 확인 필요

- AC8 사람 검수는 Matthew 몫이다. 이 문서는 완료로 적지 않는다.
- 1280×800에서 캔버스를 360px 이상으로 두려고 팔레트를 한 줄로 두었다. 15종은 그 줄의 가로 스크롤로 본다. 여러 줄로 되돌리면 캔버스가 360px 아래로 줄어든다.
- 신호 연결은 탭을 도면으로 옮길 뿐, 그 뒤에 카드 보드로 돌아가는 것을 막지 않는다.
