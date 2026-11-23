# TURN-054 글자 · 간격 단계 정리 · 이름표 겹침 방지와 확대 단계별 정보량

상태: 검토 후보. 사람 검수 전. 정식 릴리스가 아니다. 앱 버전은 `0.3.0-prototype` 그대로다. 파일 형식은 `0.3.0`. 실행 규칙은 `seq-runtime/0.6.0`. `release/` 와 `README.md` 는 바꾸지 않았다. CI 확인 대기 — 루카가 Actions로 확인.

## 한 일

화면 글자는 네 단계와 제목 두 단계만 쓴다. 간격은 4px 계단이다. 패널 머리 줄은 높이 32px, `--fs-sm`, 좌우 `--sp-2` 로 맞췄다.

- `--fs-xs` 11 · `--fs-sm` 12 · `--fs-md` 13 · `--fs-lg` 15 · `--fs-h2` 18 · `--fs-h1` 24
- `--sp-1` 4 · `--sp-2` 8 · `--sp-3` 12 · `--sp-4` 16 · `--sp-5` 24 · `--sp-6` 32
- 8 · 10px 글자는 11로, 14px 는 13으로, 16px 본문은 15로, 20px 제목은 18로, 28px 제목은 24로 옮겼다. 같은 거리면 작은 쪽으로 붙였다.
- 6 · 10 · 14px 간격도 같은 규칙이다. 6은 4, 10은 8, 14는 12.
- 탐색기 · 접는 칸 · 속성 `h4` · 실행 「단계」 · 「가동 조건」 · 「자세히」 머리가 같은 높이와 글자 단계와 좌우 여백을 쓴다. 접기 단추는 머리의 왼쪽에 둔다. 색과 문구는 그대로다.

2D 도면(2단계 도면 도식 · 6단계 실행 도면)은 확대에 따라 이름표가 바뀐다. 기준은 `src/scene/labels.ts` 한곳이다.

- 70% 미만: Unit 이름만. Device · 포트 · 상태 글자는 숨긴다. 고른 Device 이름은 남는다. Unit 이름의 화면 크기는 11px 아래로 내려가지 않는다.
- 70% 이상 120% 미만: Unit 이름과 Device 코드(`CYL-01`). 고른 Device 는 이름 전체.
- 120% 이상: Device 이름 전체, 상태 글자, 포트 이름.
- 겹치면 우선순위가 낮은 쪽을 줄이거나 숨긴다. 순서: 고른 것, 오류 · 일시정지, Unit, Device, 포트. 숨기거나 줄인 이름은 `title` 로 남는다.

3D 는 카메라 거리 480(설계값, `LABEL_NEAR_DISTANCE`)을 기준으로 한다. 멀면 바닥 Unit 이름과 자재 이름만 남고, 그 안이면 Device 이름이 나온다. 오류 · 일시정지 표시와 고른 Device 이름은 거리와 상관없이 남는다. 「이름 표시」를 끄면 지금처럼 Device · Unit 이름이 빠지고 표식과 자재 이름은 남는다.

## 예외

도면 안 글자는 확대와 함께 계산하므로 px 를 남겼다.

- React Flow 노드: `.rf-code` · `.rf-unit-name` · `.rf-unit-meta` · `.rf-dev-name` · `.rf-photo-note` · `.rf-interlock-word` · `.rf-mat-label` · `.rf-edge-label` · `.rf-port-name`
- 도식 SVG `fontSize={8}` (`Canvas.tsx` 포지션, `Symbols.tsx` 미정 기호)
- 3D 화면 이름표 `.scene3d-label`
- Unit 이름 화면 크기 하한은 `unitNameFontPx` 가 도면 좌표로 계산한다
- 닫기 · `…` · `+` 글리프(`.ptab .x` · `.exitem .x` · `.proj-add`)는 16px 그대로다. TURN-007 이 글자 크기 16px 와 계산값 16 이상을 잠근다

간격에서 4px 계단으로 옮기지 않은 곳:

- 1~3px 보정, 스크린리더용 `margin: -1px`
- 숫자 칸 단위 자리 `.qty input.num` 의 `padding-right: 40px` · `44px`
- 헤더 로고와 글자 사이 `gap: 10px` (TURN-015 가 10px 를 잠근다)
- 트리 들여쓰기 `paddingLeft: 44`, `8 + depth * 16`, `12 + depth * 16`
- `App.tsx` · `Panels.tsx` 의 인라인 간격. 이 두 파일은 인라인 `font-size` 만 토큰으로 바꿨다

## 화면

Headless Chrome. 1280×800. 기기 픽셀 배율 1. 문서 `scrollWidth` 1280 · `scrollHeight` 800. 콘솔의 앱 오류 0. 예제는 5공정. 각 그림의 왼쪽이 전(`main`), 오른쪽이 후다.

- 1~6단계 라이트: `TURN-054-s1-light.png` … `TURN-054-s6-light.png`
- 1~6단계 다크: `TURN-054-s1-dark.png` … `TURN-054-s6-dark.png`
- 도면 50% · 100% · 130%, 라이트: `TURN-054-zoom-far-light.png` · `TURN-054-zoom-mid-light.png` · `TURN-054-zoom-near-light.png`
- 도면 50% · 100% · 130%, 다크: `TURN-054-zoom-far-dark.png` · `TURN-054-zoom-mid-dark.png` · `TURN-054-zoom-near-dark.png`
- 3D 멀리 · 가까이, 라이트: `TURN-054-3d-far-light.png` · `TURN-054-3d-near-light.png`
- 3D 멀리 · 가까이, 다크: `TURN-054-3d-far-dark.png` · `TURN-054-3d-near-dark.png`

6단계 실행 도면은 맞춤 확대가 70% 미만이라 Unit 이름만 남고, 그 화면 글자는 11px 이상이다. 3D 맞춤 거리는 891이라 바닥 Unit 이름만 보이고, 거리 325 에서는 Device 이름이 나온다.

## 하지 않은 것

- 색 · 아이콘 세트 · 글꼴 · 라이트/다크 팔레트
- 문구 · `data-*` · 동작 · 화면 구조
- 선 경로 · 자동 배치
- 조건 검사(TURN-052), 명령 찾기(TURN-053). `App.tsx` · `Panels.tsx` 는 인라인 `font-size` 외에는 그대로다
- `README.md`, `release/` 재빌드, 의존성 추가
- 모델 · 저장 파일

## 확인 필요

- 화면이 더 가지런한지, 축소한 도면에서 Unit 을 알아볼 수 있는지는 사람 검수(Matthew)다. 이 문서는 완료로 적지 않는다.
- 3D 「가깝다」의 기준 480 은 설계값이다. 맞춤(약 891)에서는 Device 이름이 빠지고, 더 다가가면 나온다.

## 검증

구분해서 적는다. 통과 판정은 CI를 따른다.

- 로컬 참고: `npm test` 79파일 784개, `tsc --noEmit` 통과. 의존성 변화 없음. 통과 판정은 CI. CI 확인 대기 — 루카가 Actions로 확인.
- 브라우저: 위 측정. 문서 스크롤 0. 50% 도면은 Device 이름이 숨고 Unit 이름만 남는다. 130% 도면은 포트 이름이 나온다. 3D 멀리에서는 Device 이름표가 없고, 가까이에서는 있다.
