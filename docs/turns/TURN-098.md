# TURN-098 타임아웃 안내 · 신호 이름 매칭 단위 테스트 (로컬 LLM 위임 시연)

Issue: #250 · PR: #249

상태: 검토 후보. 사람 검수 전. 정식 릴리스가 아니다. 앱 버전은 `0.3.0-prototype` 그대로다. `src/` 는 고치지 않았다. `release/` 는 다시 빌드하지 않았다. CI 확인 대기 — 루카가 Actions로 확인.

## 한 일

순수 함수 두 개에 단위 테스트를 더했다. 테스트 초안은 맥의 로컬 LLM(`local-coder` = Ollama `qwen3.6:35b-a3b`)이 썼다. Claude Code 가 `local-llm` MCP 도구(`delegate_to_local`)로 LiteLLM 게이트웨이를 거쳐 맡기고, 결과를 검토해 저장한 뒤 검증했다. 사용량은 게이트웨이 키 `key-claude-code` 로 따로 기록된다.

- `tests/timeout-note.test.ts` (4개) — `timeoutNote()`: 타임아웃이나 동작 시간이 비면 `null`, 짧으면 `TIMEOUT_WARN`, 밀리초 반올림 뒤 같으면(1.0004 s 대 1.0 s) `TIMEOUT_EQUAL`, 길면 `null`. Local 1회(43초, 입력 1,014 / 출력 3,338 토큰), 수정 없이 저장.
- `tests/signal-match.test.ts` (9개) — `signalMatchesName()`: 빈 이름 · 공백만 있는 이름, 신호 이름 일치, `장치.이름` 일치, 앞뒤 공백 무시, 포트 라벨 · 키 일치, 다른 포트의 라벨 · 키 불일치, 포트 없음. Local 1차는 출력 한도에서 잘렸다(108초, `finish=length`). 잘린 사실과 `const ports = []`(strict 에서 암묵적 `any[]`)를 붙여 다시 맡겼고 2차가 완성됐다(49초, 입력 1,176 / 출력 4,067 토큰). Claude 가 「다른 포트」 케이스를 포트 둘로 바꿔 「포트 없음」과 겹치지 않게 했다.

로컬 확인이다. 통과 판정은 CI 를 따른다.

- `npx vitest run tests/timeout-note.test.ts tests/signal-match.test.ts` — 2파일 13개 통과.
- `npx tsc --noEmit` 통과.
- `npx vitest run` 3번: 162파일 1241개 중 1~2개 실패. 실패는 모두 `tests/ui-turn066.test.tsx`(AC4 · AC5)이고, 이 브랜치 변경 없이 `main`(`5beddfa`)에서 돌려도 같은 AC4 가 실패했다. 이 TURN 과 무관한 기존 흔들림으로 보고 고치지 않았다.

## 하지 않은 것

- `src/`, 다른 테스트 파일, vitest 설정, 의존성
- `release/` 재빌드
- `tests/ui-turn066.test.tsx` 흔들림 수정

## 확인 필요

- `tests/ui-turn066.test.tsx` AC4 · AC5 가 로컬 `main` 에서도 흔들린다. 별도 TURN 후보.
