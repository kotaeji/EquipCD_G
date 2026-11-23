# TURN-061 아이콘 한 세트

상태: 검토 후보. 사람 검수 전. 정식 릴리스가 아니다. 앱 버전은 `0.3.0-prototype` 그대로다. `README.md` · `release/` 는 이 TURN에서 고치지 않았다. CI 확인 대기 — 루카가 Actions로 확인.

## 고른 세트

`lucide-react` 0.554.0 (ISC). 쓰는 아이콘만 이름 붙여 가져오므로 묶음에는 그 그림만 들어간다. 아이콘 글꼴과 외부 주소는 쓰지 않는다. 릴리스는 지금처럼 HTML 한 파일이고 바깥 스크립트·스타일 참조가 없다.

의존성 없이 SVG를 직접 두는 방법도 있었지만, 명령이 백 개가 넘어 한 스타일·한 선 굵기를 라이브러리에 맡기는 쪽이 맞다. Matthew가 이 TURN에 한해 새 의존성을 허용했다.

뜻 표는 `src/ui/icons.ts` 하나다. 그리는 쪽은 `src/ui/Icon.tsx`. 크기는 16px(글자 옆)과 24px(헤더의 실행 취소·다시 실행) 둘만, 선 굵기는 2, 색은 `currentColor`다.

## 한 일

- 헤더의 명령 찾기·저장·내보내기·보기 설정·도움말·실행 취소·다시 실행에 같은 표의 아이콘을 붙였다. 화면 글자와 접근성 이름, `data-*` 는 그대로다. 「▶ 실행」「❚❚ 일시정지」「⟲ 초기화」의 기호는 화면 밖에 두어 접근성 이름과 `textContent` 가 지금과 같다.
- 단계 도구 줄, 탭, 우클릭 메뉴, 명령 찾기 목록이 그 표를 같이 쓴다. 같은 명령은 같은 아이콘이고, 표 안의 서로 다른 명령은 아이콘을 나누지 않는다.
- 접기·펼치기·닫기·빈 화면 기호를 세트로 바꿨다. 빈 화면의 ○ ✓ → ? 글자는 화면 밖에 남긴다. 상태 칩의 ▶ ✓ ! ○ ? △ 는 그대로다.
- 위험 단추는 붉은 외곽선과 글자, 줄 끝 자리를 유지한다. 아이콘이 있는 단추만 CSS의 `✕` 대신 세트의 X를 쓴다. `styles.css` 의 `button.danger::before` 규칙은 그대로 두었다.
- 탐색기 「모두 펼치기 / 모두 접기」와 6단계의 도면·3D·도식·실사풍·저장에는 아이콘을 넣지 않았다. 넣으면 좁은 칸에서 글자가 두 줄이 되거나 상태 칩이 더 내려간다.

## 크기

`npm run build` 로 이 TURN 직전의 `main` 과 이 브랜치를 각각 재었다. `release/` 는 커밋하지 않았다.

| | 바이트 | gzip (vite) |
|---|---:|---:|
| 직전 main | 5,184,293 | 2,908.94 kB |
| 이 브랜치 | 5,241,198 | 2,922.46 kB |
| 차이 | +56,905 | +13.5 kB |

바깥 `script`/`link` 참조 없음. `package-lock.json` 이 바뀐 이유는 `lucide-react` 하나다.

## 화면 (1280×800)

Headless Chrome. 기기 픽셀 배율 1. 콘솔 오류 0. 여섯 단계·우클릭 메뉴·명령 찾기 모두 `scrollWidth` 1280, `scrollHeight` 800.

전(아이콘 없음)과 후를 같은 크기로 찍었다. 라이트·다크.

- 1단계: `TURN-061-before-s1-light-1280.png` · `TURN-061-after-s1-light-1280.png` · `TURN-061-before-s1-dark-1280.png` · `TURN-061-after-s1-dark-1280.png`
- 2단계: `TURN-061-before-s2-light-1280.png` · `TURN-061-after-s2-light-1280.png` · `TURN-061-before-s2-dark-1280.png` · `TURN-061-after-s2-dark-1280.png`
- 3단계: `TURN-061-before-s3-light-1280.png` · `TURN-061-after-s3-light-1280.png` · `TURN-061-before-s3-dark-1280.png` · `TURN-061-after-s3-dark-1280.png`
- 4단계: `TURN-061-before-s4-light-1280.png` · `TURN-061-after-s4-light-1280.png` · `TURN-061-before-s4-dark-1280.png` · `TURN-061-after-s4-dark-1280.png`
- 5단계: `TURN-061-before-s5-light-1280.png` · `TURN-061-after-s5-light-1280.png` · `TURN-061-before-s5-dark-1280.png` · `TURN-061-after-s5-dark-1280.png`
- 6단계: `TURN-061-before-s6-light-1280.png` · `TURN-061-after-s6-light-1280.png` · `TURN-061-before-s6-dark-1280.png` · `TURN-061-after-s6-dark-1280.png`
- 우클릭 메뉴: `TURN-061-before-menu-light-1280.png` · `TURN-061-after-menu-light-1280.png` · `TURN-061-before-menu-dark-1280.png` · `TURN-061-after-menu-dark-1280.png`
- 명령 찾기: `TURN-061-before-palette-light-1280.png` · `TURN-061-after-palette-light-1280.png` · `TURN-061-before-palette-dark-1280.png` · `TURN-061-after-palette-dark-1280.png`

## 하지 않은 것

- 문구·동작·배치, 새 단추, 글자 삭제, 색·글자 크기·간격 토큰
- 상태 표시 여섯 가지, 장치 그림, 도면 안 기호, 로고, 3D
- `README.md`, `release/` 재빌드 커밋, 아이콘 외 의존성

## main 합침

TURN-062 · 065 · 066이 들어간 `origin/main`을 merge했다. rebase는 하지 않았다. `tests/turn054.test.ts`는 main 그대로다. 「명령 · 대상 찾기」의 명령 줄과 대상 종류, 「보고서 내보내기」 메뉴와 그 세 파일도 같은 뜻 표를 쓴다. 화면 글자는 그대로다.

## 확인 필요

- AC10은 Matthew 검수 전이다. 이 문서는 완료로 적지 않는다.
- 6단계 「도면」「3D」는 명령 찾기에서는 아이콘이 있고, 도구 줄에서는 글자만이다. 둘 다 아이콘을 넣으면 상태 칩이 다음 줄로 더 내려간다.
- 탐색기 트리의 접기 단추는 세트의 셰브론이다. `src/ui/slots/47069.svg` · `e5f85.svg` 파일은 테스트를 위해 그대로 둔다.
- 위험 단추 중 아이콘을 붙이지 않은 표 안의 작은 삭제 단추는 지금처럼 CSS `✕` 를 쓴다.

## 테스트

`tests/ui-turn061.test.tsx` 가 뜻 표, 명령끼리 아이콘이 겹치지 않는 것, 헤더·실행 단추·명령 찾기가 같은 아이콘인 것, `currentColor` 와 상태 기호가 그대로인 것을 본다. 로컬 `npm test` 97파일 887개 통과. 이 숫자는 이 문서 작성 시점의 로컬 실행이다. 통과 판정은 CI를 따른다. CI 확인 대기 — 루카가 Actions로 확인.
