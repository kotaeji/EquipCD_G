# TURN-008 탐색기 Workspace·Project 탭 · 작업 정보 줄

상태: 검토 후보. 사람 검수 전. 정식 릴리스가 아니다. 앱 버전은 `0.3.0-prototype` 그대로다. 파일 형식 `0.2.0` 과 실행 규칙은 바꾸지 않았다. `release/` 는 다시 빌드해 커밋하지 않았다. CI 확인 대기 — 통과 판정은 Actions를 따른다.

## 한 일

1. 탐색기 맨 위에 Workspace · Project 밑줄 탭을 두었다. 공용 컴포넌트는 `src/ui/Tabs.tsx` 다. `role="tablist"` / `tab` / `tabpanel`, ←/→ 로 전환하고 선택 탭만 보인다. 선택 탭은 `var(--accent)` 2px 밑줄과 글자 600, 나머지는 `var(--muted)`.
2. Workspace 탭에 이 브라우저의 Workspace 목록(이름, 저장 프로젝트 수, 현재 강조), 전환·만들기·이름 변경·삭제, 안내 문장, 파일 묶음, 공통 탐색, 작업 시작 화면을 넣었다. 전환·삭제 규칙은 이전과 같다.
3. Project 탭에 「Workspace: 이름」, 열린 프로젝트(전환·✎·×·미저장), 새 프로젝트 3종, 저장된 프로젝트(열기·이름 변경·삭제), JSON 가져오기, 프로젝트 파일, 장비 구조 트리를 넣었다. ✎·× 는 24×24px 이다.
4. 「이 브라우저 작업」 접는 칸은 없앴다. 탐색기 접기(⟨/⟩)와 너비 조절은 그대로다. 고른 탭은 UserView(`ecd.v1.userView`)의 `explorerTab` 에만 저장하고, 기본값은 Project 다.
5. 위쪽 「작업 시작 · 프로젝트 탭 · 새 프로젝트」 줄을 `Workspace 이름 › Project 이름 · rev N · 저장 상태` 로 바꿨다. 이름을 누르면 탐색기의 해당 탭이 열린다. 저장 안 된 편집은 `● 저장 안 됨` (`var(--warning)`), 저장되면 `저장됨` (`var(--muted)`). 헤더의 같은 글자는 이 칩으로 합쳤고, 저장 버튼에는 미저장일 때 작은 점을 단다. 판정은 `savedRevision !== revision` 이다.

## 옮긴 버튼

| 원래 | 지금 |
|---|---|
| 탐색기 요약 「Workspace 관리」 | Workspace 탭 목록의 전환·만들기·이름 변경·삭제 |
| 탐색기 요약 「프로젝트 파일」 | Project 탭 |
| 탐색기 요약 「파일 묶음」·「공통 탐색」 | Workspace 탭 |
| 탐색기 요약의 Workspace 이름·프로젝트 수·안내 문장 | Workspace 탭 |
| 레일 Workspace 이름 | Project 탭 「Workspace: 이름」과 위쪽 정보 줄 |
| 레일 「프로젝트 관리」 | Project 탭 저장된 프로젝트 |
| 레일 장비 구조·모두 펼치기/접기·트리·선택 안내 | Project 탭 아래 |
| 접는 칸 「탐색기 접기」 | 탐색기 머리. 그대로 |
| 접는 칸 Workspace 선택·「관리…」 | Workspace 탭 |
| 접는 칸 열린 프로젝트 | Project 탭 |
| 접는 칸 「+ 빈 프로젝트」·「+ 5공정 예제」·「+ 병렬 예제」 | Project 탭 새 프로젝트 |
| 접는 칸 「프로젝트…」 | Project 탭 저장된 프로젝트 |
| 접는 칸 「JSON 가져오기」 | Project 탭 |
| 접는 칸 최근 저장(클릭으로 열기, 최대 6개) | 저장된 프로젝트 전체의 「열기」 |
| 위쪽 「작업 시작」 | Workspace 탭 「작업 시작 화면」 |
| 위쪽 프로젝트 탭 | Project 탭 열린 프로젝트, 정보 줄의 현재 이름 |
| 위쪽 「새 프로젝트」 | Project 탭 「+ 빈 프로젝트」 |
| 헤더 `save-hint` | 정보 줄 저장 칩. 저장 버튼의 미저장 점 |

작업 시작 화면의 빈 프로젝트·예제·계속하기·프로젝트 관리 버튼은 그 화면에 남아 있다. 「프로젝트 관리」는 Project 탭을 연다. 「묶음 내보내기」는 그대로 비활성이다.

## 하지 않은 것

- Workspace·Project 저장 형식, 저장소 키, 전환 규칙
- 카드 보드와 도면 도식의 탭 — TURN-009. `Tabs` 는 그 TURN 이 다시 쓴다
- 스텝퍼, 테마 토글, 헤더 색
- 의존성 추가, `release/` 재빌드
- 사용자 매뉴얼의 탐색기 설명. 아직 「관리…」·「프로젝트…」로 적혀 있다

## 검증

구분해서 적는다.

| 종류 | 결과 |
|---|---|
| 자동 테스트 | `npm test` 18파일 384개 통과. `tests/ui-turn008.test.tsx` 4개(탭 ARIA·←/→, Project 탭 구성, 저장 칩, UserView 유지). `tests/ui-workspace-tree.test.tsx` 18개는 탭 안의 전환·이름·삭제로 고쳤다. `tests/theme-contrast.test.ts` 에 미저장 칩 대비를 더했다. 이 숫자는 로컬 실행이다. 통과 판정은 CI 를 따른다 |
| 형식 검사 | `npm run typecheck` 통과 |
| Chrome | 156.0.8078.47, CSS 뷰포트 1280×800, devicePixelRatio 1. 콘솔 오류 0. Workspace·Project 탭을 누르고, 저장한 뒤 이름을 바꾸면 정보 줄이 바로 `● 저장 안 됨` 이 되고 rev 가 오른다. 작업 시작 화면 버튼은 시작 화면을 연다. Esc 는 새 Workspace 이름 창만 닫는다 |

- `docs/turns/TURN-008-workspace-light-1280.png`
- `docs/turns/TURN-008-workspace-dark-1280.png`
- `docs/turns/TURN-008-project-light-1280.png`
- `docs/turns/TURN-008-project-dark-1280.png`
- `docs/turns/TURN-008-unsaved-light-1280.png`

## 확인 필요

- AC10 사람 검수는 Matthew 몫이다. 이 문서는 완료로 적지 않는다.
- 헤더 저장 버튼은 라이트·다크 모두 흰 바탕이라, 미저장 점은 `var(--warning)` 이 아니라 `#8b4800` 이다. 다크의 warning(`#ffd18a`)은 흰 버튼 위에서 대비가 1.42:1 이다. 정보 줄 칩은 테마의 `var(--warning)` 이고 바탕 대비는 4.5:1 이상이다.
- 장비 구조 트리는 Project 탭에서 열린 프로젝트·저장 목록 아래에 있다. 1280×800 첫 화면에는 Station 줄까지 보이고, Unit 줄은 탐색기를 스크롤하면 나온다.
- 사용자 매뉴얼과 UX 시나리오는 이 TURN 에서 고치지 않았다.
