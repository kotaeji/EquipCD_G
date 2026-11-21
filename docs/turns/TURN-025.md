# TURN-025 화면 테스트가 실제 시계에 기대지 않게 한다

상태: 검토 후보. 사람 검수 전. 정식 릴리스가 아니다. 앱 버전은 `0.3.0-prototype` 그대로다. 파일 형식은 `0.3.0`. 실행 규칙은 `seq-runtime/0.3.1`. `src/` 와 `release/` 는 바꾸지 않았다. 화면 변경이 없어 스크린샷은 없다. CI 확인 대기 — 루카가 Actions로 확인.

## 한 일

- `tests/holdRuntimeClock.ts` 가 `performance.now` 를 한 시각에 고정하고, `requestAnimationFrame` 콜백을 벽시계 타이머에 올리지 않는다. `elapse(ms)` 는 실행 루프의 프레임 상한 250ms 로 `ms` 를 덮는 수만큼 프레임을 건넨다. 건네는 시각은 고정된 그 시각이다.
- `tests/ui-turn023.test.tsx` 첫 테스트는 「▶ 실행」 뒤에 `elapse(15_000)` 을 하고, 실행 루프가 아직 걸려 있는지(`queued() > 0`), 상태가 `running` 인지, 실행 중과 일시정지 중 모두에서 분기 이름 칸이 `disabled` 인지를 본다. 흐름 예제는 가상 시간 13.100초면 끝난다. `b133872` 가 넣은 `20_000` 제한은 뺐다. 이 테스트는 로컬 전체 실행에서 1375ms 였다.
- `tests/ui-smoke.test.tsx` 는 「▶ 실행」 직후의 `running` 확인 앞에서 같은 시계를 잡는다. 병렬 예제는 가상 시간 2.500초면 `running` 이 `completed` 가 된다.

## 15초 확인 (로컬)

- 가짜 시계. `npx vitest run` 전체: 37파일 502개 통과. 그 안의 TURN-023 첫 테스트는 1375ms. `elapse(15_000)` 이 15초 분량의 프레임을 고정 시각으로 건넨 뒤에도 이름 칸은 잠겨 있었다.
- 실제 15초. `TURN025_WALL_MS=15000 npx vitest run tests/ui-turn023.test.tsx -t "AC1 AC2" --testTimeout=30000`: 그 테스트 16502ms, 통과. 「▶ 실행」과 잠금 확인 사이에 벽시계로 15초를 기다렸다. 기본 실행은 이 환경 변수를 쓰지 않는다.
- 시각을 올리면 실패하는지. `elapse` 가 `frozen + i * 250` 을 건네도록 잠깐 바꿔 같은 테스트를 돌리면 `expected 0 to be greater than 0` 으로 실패했다. 실행이 끝나 루프가 풀린 것이다. 확인 뒤에 고정 시각으로 되돌렸다.

## 「▶ 실행」 9개 파일

| 파일 | 결과 | 이유 |
|---|---|---|
| `tests/ui-turn023.test.tsx` | 고침 | 실행 중 · 일시정지 중 이름 칸 `disabled`. 벽시계가 13.100초를 넘기면 실행이 끝나 잠금이 풀린다. |
| `tests/ui-smoke.test.tsx` | 고침 | 「▶ 실행」 직후 글자에 `running` 이 있는지 본다. 병렬 예제는 2.500초면 `completed` 가 된다. |
| `tests/ui-blocker-nav.test.tsx` | 해당 없음 | 「▶ 실행」은 준비 실패로 남고 상태 표시는 `실행 idle` 이다. 실행 루프가 시작하지 않아 시간이 지나도 같다. |
| `tests/canvas-flow.test.tsx` | 해당 없음 | 「▶ 실행」 전에 `requestAnimationFrame` 을 빈 함수로 바꿔 둔다. 잠금 문구는 프레임이 없어도 유지된다. |
| `tests/ui-turn012.test.tsx` | 해당 없음 | 같은 빈 `requestAnimationFrame` 이 이미 있다. 실행 중 연결 차단은 프레임이 없어도 유지된다. |
| `tests/ui-turn013.test.tsx` | 해당 없음 | 같은 빈 `requestAnimationFrame` 이 이미 있다. 크기 핸들 · 크기 맞춤 차단은 프레임이 없어도 유지된다. |
| `tests/ui-turn014.test.tsx` | 해당 없음 | 같은 빈 `requestAnimationFrame` 이 이미 있다. 배치 명령 차단은 프레임이 없어도 유지된다. |
| `tests/ui-turn018.test.tsx` | 해당 없음 | 빈 `requestAnimationFrame` 뒤에 「끝까지」로 끝낸다. 확인은 완료된 요약이다. 벽시계로 먼저 끝나도 「끝까지」와 같은 완료 상태다. |
| `tests/ui-turn021.test.tsx` | 해당 없음 | 같은 빈 `requestAnimationFrame` 이 이미 있다. 실행 중 선택 · 복제 차단은 프레임이 없어도 유지된다. |

## 하지 않은 것

- `src/`, `release/`
- 테스트 삭제, `skip`, `retry`
- CI 워크플로, vitest 전역 시간 제한
- 사용자 매뉴얼, 기능 목록, 요구 문서
- 의존성 추가
- 스크린샷. 화면이 바뀌지 않았다.

## 확인 필요

- Issue 본문의 「하지 않음」에 문서가 있다. AGENTS.md 3·6이 이 기록과 README 상태 줄을 같은 PR에서 요구해서 그 둘만 고쳤다.
- 로컬 `npm run typecheck`, `npm test` (37파일 502개), `npm run build` 는 통과했다. 빌드가 만든 `release/` 변경은 되돌렸다. CI 판정은 이 기록이 아니다.
