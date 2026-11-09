# AGENTS.md — 이 저장소에서 일하는 모든 에이전트의 공통 규칙

GrokBot · Cursor Agent · Claude(루카) 등 **이 저장소에 커밋하거나 PR·Issue를 다는 모든 에이전트**가 따른다. 도구별 설정 파일(`CLAUDE.md` 등)은 이 파일을 가리키기만 하고 규칙을 따로 두지 않는다.

## 1. 역할

| 누구 | 하는 일 | 하지 않는 일 |
|---|---|---|
| Matthew | 요구·우선순위 결정, **main 머지(유일한 문)**, 사람 검수 | — |
| 루카(Claude) | 앰플노트 요구 → TURN Issue 작성, PR을 AC 대비로 검토·코멘트 | 앱 코드 직접 수정(체계 파일 제외), 머지 |
| 구현 에이전트(GrokBot/Cursor) | TURN Issue를 구현해 PR 생성, 자기 검증 결과 기록 | main 직접 push, 머지, Issue 범위 밖 변경 |

## 2. 요구 정본

- 요구의 **정본은 앰플노트 `<Requirement> Aurora Concept Designer`** 다.
- `docs/requirements-v*.md` 는 정본에서 옮긴 공개 통합본이다. 파일 맨 위에 `정본: 앰플노트 <Requirement> Aurora Concept Designer (YYYY-MM-DD 기준)` 한 줄을 둔다.
- 둘이 다르면 정본이 이긴다. 다른 점을 발견하면 PR 본문의 「확인 필요」에 적고 임의로 고치지 않는다.

## 3. TURN = Issue 하나 = 브랜치 하나 = PR 하나

1. TURN 지시서는 GitHub Issue로 연다(`.github/ISSUE_TEMPLATE/turn.md`). 라벨 `turn:todo`.
2. 구현 에이전트는 시작할 때 라벨을 `turn:doing` 으로 바꾼다.
3. 브랜치 이름: `turn/NNN-짧은-설명` (예: `turn/004-header-brand-color`). **항상 최신 `main`에서 갈라진다** — 다른 PR 브랜치 위에 쌓지 않는다.
4. PR 제목: `TURN-NNN: 제목`, 본문 첫 줄 `Closes #<Issue 번호>`.
5. PR 본문에 반드시 넣는다:
   - AC(Acceptance Criteria, 완료 기준) 표 — 항목마다 `충족 / 미충족 / 사람 검수 필요` 와 근거(테스트 이름·스크린샷)
   - 바꾼 파일 목록, 하지 않은 것
   - 「확인 필요」
6. 같은 PR에 `docs/turns/TURN-NNN.md` 를 추가하거나 갱신한다(검수 기록).

## 4. 라벨

| 라벨 | 붙이는 쪽 | 뜻 |
|---|---|---|
| `turn:todo` | 루카(Issue 생성 시) | 착수 전 |
| `turn:doing` | 구현 에이전트 | 작업 중 |
| `review:needed` | **자동**(`.github/workflows/pr-label.yml`, PR 열릴 때) | 루카 검토 대기 |
| `review:changes` | 루카 | 수정 요청 |
| `review:ok` | 루카 | AC 충족 확인 — Matthew 머지 대기 |

## 5. 품질 문

- PR마다 CI(`.github/workflows/ci.yml`)가 `npm ci → typecheck → test → build` 를 돌린다. **CI가 빨간 PR은 검토하지 않는다.**
- 「테스트 통과」는 CI 결과로만 말한다. 로컬 실행 결과는 참고로 적는다.
- 시각 변경은 라이트·다크 스크린샷(1280×800)을 PR에 붙인다.

## 6. 문서 상태 줄

- `README.md` 의 버전·테스트 수·「안 된 것」, 그리고 해당 `docs/turns/TURN-NNN.md` 의 상태 줄을 **같은 PR에서** 갱신한다. 머지된 뒤에 「미commit」 같은 표기가 남지 않게 한다.
- 사람 검수 전에는 「검토 후보」로 쓴다. 완료·인증을 과장하지 않는다.

## 7. 동시 작업 금지 파일

- `release/equipment-concept-designer.html` — **TURN PR에서 다시 빌드해 커밋하지 않는다.** Matthew가 머지한 뒤 릴리스 커밋에서 한 번만 갱신한다.
- `package-lock.json`, `assets/aml/*.aml` — 의존성·에셋을 바꾸는 TURN만 수정하고 PR 본문에 이유를 적는다.

## 8. 금지

- main 직접 push · force push · 다른 에이전트 브랜치 수정
- 비밀값(토큰·키·`.env`) 커밋, 저장소 밖 파일 업로드
- Issue 범위 밖 리팩터링 · 의존성 추가(필요하면 「확인 필요」로 묻는다)
- 실제 장비 제어 코드 — 이 앱은 논리 시뮬레이션 전용이다
