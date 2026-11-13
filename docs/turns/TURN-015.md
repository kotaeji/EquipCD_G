# TURN-015 헤더 · 탭 아이콘 — E안(A + 포트 연결)

상태: 검토 후보. 사람 검수 전. 정식 릴리스가 아니다. 앱 버전은 `0.3.0-prototype` 그대로다. `release/` 는 다시 빌드하지 않았다. CI 확인 대기 — 루카가 Actions로 확인.

## 한 일

헤더의 「Aurora Concept Designer」 앞에 E안 마크를 넣었다. 모양은 Issue 의 SVG 그대로다. 24×24 viewBox, 20×20 px, 선 1.8. 「A」윤곽, 왼쪽 출력 포트는 채운 원, 오른쪽 입력 포트는 빈 원, 둘 사이는 점선 `1.6 1.4` 다. 색은 `currentColor` 이고 `.header .brand .logo` 가 `--header-fg` 를 준다. 바탕은 없다.

제목과 간격은 `.brand` 의 6px 이다. 아이콘은 `aria-hidden="true"` 이고, `.brand` 의 `aria-label` 은 이름과 버전 그대로다. 마크는 `src/ui/BrandMark.tsx` 한 곳이다. 홈과 그 다음 화면도 같은 헤더를 쓴다.

탭 아이콘은 `index.html` 의 data URI 다. 헤더 색 `#A20034` 둥근 바탕 위 흰 선, 선 2.2, 점선은 없다. 외부 파일은 없다. 로컬 `npm run build` 의 `dist/index.html` 에 같은 href 가 들어갔다. 그 HTML 은 커밋하지 않고 되돌렸다.

## 화면 (1280×800)

Chrome 으로 개발 서버를 열어 찍었다. 헤더 배경은 라이트·다크 모두 `rgb(162, 0, 52)`, 아이콘 색은 `rgb(255, 255, 255)` 이다. 아이콘은 20×20 이고 제목과의 간격은 6px 이다. 제목 오른쪽 끝과 저장 버튼 사이는 644px 이고 겹치지 않는다. 헤더 높이는 64px 이다. 홈을 벗어나 1단계에서도 같은 헤더다. 탭 아이콘은 헤더 색 둥근 사각에 흰 A 다.

- 홈, 라이트: `TURN-015-light-1280.png`
- 홈, 다크: `TURN-015-dark-1280.png`
- favicon SVG 를 32px 로 그린 그림: `TURN-015-favicon-32.png`

## 하지 않은 것

- 제목 글자, 부제, 헤더 색, 버튼
- 앱 이름, 워드마크, PNG/ICO, 매니페스트
- `docs/FEATURE-LIST.md`, 사용자 매뉴얼
- 의존성 추가, `release/` 재빌드

## 검증

구분해서 적는다. 통과 판정은 CI 를 따른다.

| 종류 | 결과 |
|---|---|
| 자동 테스트 | 로컬 `npm test` 26파일 428개 통과. 그 가운데 `tests/ui-turn015.test.tsx` 3개(헤더 SVG · `aria-hidden` · `aria-label` · favicon data URI). 이 숫자는 이 문서 작성 시점의 로컬 실행이다 |
| 형식 검사 | 로컬 `npm run typecheck` 통과 |
| 빌드 | 로컬 `npm run build` 통과. `dist/index.html` 의 icon href 가 `index.html` 과 같다. 점선 없음. 외부 파일 참조 없음. 만들어진 HTML 은 커밋하지 않고 되돌렸다 |
| Chrome | 1280×800, devicePixelRatio 1. 위 측정. 라이트에서 다크로 바꾼 뒤에도 헤더 마크는 같다. 1단계 화면에서도 헤더는 같다 |

## 확인 필요

- AC8 은 Matthew 검수 전이다. 이 문서는 완료로 적지 않는다. 헤더와 탭 아이콘이 앱에 어울리고, 탭처럼 작아도 알아볼 수 있는지는 사람 검수다.
- Issue 본문은 헤더 높이를 44px 로 적었다. 지금 화면의 헤더는 `.app > .header { height: 64px }` 이고, 44px 는 헤더 안 버튼(`button.btn-main`) 높이다. 높이는 바꾸지 않았다. 1280×800 에서 제목과 버튼은 겹치지 않는다.
- 루카 결정 ①②는 그대로 따랐다. 헤더는 바탕 없는 흰 선이고, favicon 은 헤더 색 둥근 바탕에 점선이 없다.
