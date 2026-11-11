# TURN-007 이름 변경 아이콘 · 구분선 너비 · 접는 칸 기본 펼침

상태: 검토 후보. 사람 검수 전. 정식 릴리스가 아니다. 앱 버전은 `0.3.0-prototype` 그대로다. 파일 형식 `0.2.0` 과 실행 규칙은 바꾸지 않았다. `release/` 는 다시 빌드해 커밋하지 않았다. CI 확인 대기 — 통과 판정은 Actions를 따른다.

## 한 일

1. 열린 프로젝트의 ✎·× 누르는 영역을 24×24px, 글자를 16px, 색을 `var(--text)` 로 맞췄다. 호버 바탕은 `var(--selected)`. 같은 규칙의 `.ptab .x` 도 같은 크기인데, 지금 탭 바에는 그 버튼이 없다.
2. `NameDialog` 입력 칸과 그 아래 안내·오류 줄 사이를 8px 로 띄웠다. Workspace·프로젝트 이름 변경·새로 만들기가 같은 창을 쓴다.
3. 탐색기, 카드 상세, 배치·연결 속성, 실행 로그 칸을 마우스로 끌거나 ←/→ 로 16px 씩 바꿀 수 있다. 구분선은 너비 6px, `role="separator"`, 호버·끄는 중·포커스 때 `var(--accent)` 2px 선, 더블클릭은 기본 너비다. 한계는 탐색기 180–420px, 오른쪽 칸 240–560px 이고, 끄는 동안 본문이 480px 아래로 줄지 않게 막는다. 너비는 UserView(`ecd.v1.userView`)에만 저장한다.
4. 앱의 `<details>` 는 처음 열릴 때 펼쳐진다. 팔레트 요약은 「팔레트 (14종 + 빈 유닛)」, 도면 도식 요약은 「도면 도식 · …」이다. 사용자는 접을 수 있고, 접은 상태는 저장하지 않는다. 신호 연결 모드는 도면을 연다.

## 하지 않은 것

- 탐색기를 Workspace/Project 탭으로 바꾸기, 탭 바 정비, 「저장 안 됨」 표식 — TURN-008
- 카드 보드와 도면 도식의 탭 전환 — TURN-009
- 위아래 구분선, 패널 접기 버튼 새로 만들기
- 모델·파일 형식·rev·Undo 규칙, 의존성 추가, `release/` 재빌드
- 접은 칸을 새로 고침 뒤에도 유지하기

## 검증

구분해서 적는다.

| 종류 | 결과 |
|---|---|
| 자동 테스트 | `npm test` 17파일 378개 통과. 그중 `tests/ui-turn007.test.tsx` 7개가 아이콘 CSS·대비, 이름 창 8px, 네 구분선의 pointer·키보드·더블클릭·최소/최대·본문 480px, UserView 저장, `serializeProject` 불변, 단계별 `details` 펼침, 신호 연결 때 도면 열림, 탐색기 접기를 본다. 이 숫자는 이 문서 작성 시점의 로컬 실행이다. 통과 판정은 CI 를 따른다 |
| 형식 검사 | `npm run typecheck` 통과 |
| Chrome | 156.0.8078.47, CSS 뷰포트 1280×800, devicePixelRatio 1. 콘솔 오류 0. ✎ 24×24, 글자 16px, 라이트 색 `rgb(23, 40, 63)`, 다크 색 `rgb(239, 245, 253)`. 이름 안내와 입력 칸 사이 8px. 탐색기 구분선 6×572, 커서 `col-resize`, 호버 선 `rgb(36, 91, 206)` 2px. 80px 끌면 224→304px, 새로 고침 뒤 304px. 배치·연결의 접힌 `details` 0개. 실행 로그 칸 기본 380px, 카드 상세 기본 256px |

팔레트와 도면을 둘 다 펼치면 1280×800 한 화면에 도면까지 들어오지 않는다. 위 화면과 도면으로 스크롤한 화면을 나눴다.

- `docs/turns/TURN-007-explorer-icons-light-1280.png`
- `docs/turns/TURN-007-explorer-icons-dark-1280.png`
- `docs/turns/TURN-007-name-dialog-light-1280.png`
- `docs/turns/TURN-007-split-hover-light-1280.png`
- `docs/turns/TURN-007-split-dragged-light-1280.png`
- `docs/turns/TURN-007-canvas-open-light-1280.png`
- `docs/turns/TURN-007-canvas-open-dark-1280.png`
- `docs/turns/TURN-007-canvas-diagram-light-1280.png`
- `docs/turns/TURN-007-canvas-diagram-dark-1280.png`
- `docs/turns/TURN-007-run-light-1280.png`

## 확인 필요

- AC10 사람 검수는 Matthew 몫이다. 이 문서는 완료로 적지 않는다.
- 실행 단계는 오른쪽 칸이 없는 `ws-full` 이었다. 로그 칸을 `.ws-run` 오른쪽 열로 옮겨 너비를 조절하게 했다. 상태 표와 로그가 나란히 있던 배치가 아니라, 로그가 오른쪽 열이다.
- 창이 좁아 패널 최소 너비와 본문 480px 을 같이 지킬 수 없으면 본문 480px 을 남긴다. 앱 최소 너비 1280px 에서는 탐색기 180–420과 오른쪽 240–560이 같이 맞는다.
- 탐색기 접기는 프로젝트 목록만 숨기고, 열 너비는 저장된 값 그대로다. 예전 `--exw: 40px` 규칙은 나중 셸이 224px 로 덮어 실제로 줄어들지 않았고, 그 동작을 유지했다.
- 이전 참고 사진 요약에서 「기본 표시 안 함」을 뺐다. 그 칸도 처음에는 펼친다.
