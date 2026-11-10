# TURN-006 에셋 카드 도식 룩앤필

상태: 검토 후보. 사람 검수 전. 정식 릴리스가 아니다. 앱 버전은 `0.3.0-prototype` 그대로다. 파일 형식 `0.2.0` 과 실행 규칙은 바꾸지 않았다. `release/` 는 다시 빌드해 커밋하지 않았다. CI 확인 대기 — 루카가 Actions로 확인.

## 한 일

1단계 에셋 라이브러리 카드 14장의 그림을 한 칸으로 맞췄다. 칸은 100×48 이고 바탕은 투명하다. 도식과 실사풍(AI)이 같은 칸을 쓴다. 그림 오른쪽과 이름·ID·안내 사이는 16px 다. 모드를 바꿔도 카드 높이와 글자 위치는 그대로다.

10종(`stopper` · `gantry` · `picker` · `sensor` · `photoelectricSensor` · `proximitySensor` · `limitSwitch` · `unitInput` · `unitIdentify` · `unitTransfer`)은 `src/ui/slots/` 의 카드용 SVG 다. 선 `#245BCE`, 몸체 채움 `#E5EDFF`, 전체 크기 바탕 `rect` 없음. 모양은 캔버스 `Symbol` 의 실루엣을 100×48 에 맞게 줄인 것이다. 유닛 템플릿은 점선 테두리 안에 자식 장치 3개를 두었다. 파일로 둔 이유는 4종과 같은 `<img>` 경로를 쓰고, 색·크기를 파일로 검사하며, 캔버스 `Symbol` 은 건드리지 않기 위해서다.

4종 정식 파일(`a3687.svg` · `238b4.svg` · `91c95.svg`)에서는 맨 앞 `<rect width="100" height="48" fill="white"/>` 만 지웠다. 실린더는 푸셔와 같은 `a3687.svg` 를 그대로 쓴다. `.slot-diagram` 배경은 `transparent` 다. 트리 꺾쇠(`47069.svg` · `e5f85.svg`)는 그대로다.

실사풍 사진은 그 칸 안에서 `object-fit: contain` 이다. 「AI 생성」 칩과, 이미지가 없을 때의 「AI 이미지 미준비 → 도식」은 칸 안에 둔다. 카드에는 `.vis` 회색 바탕을 깔지 않는다.

그림 칸은 넓히지 않았다. 유닛 3개도 100×48 에서 구분되고, 1280×800 에서 카드는 368px 두 열이다.

## 하지 않은 것

- 실사풍 JPEG 다시 생성·자르기
- 카드 상세(`CardDetail` / `AssetDetailSheet`) 그림
- 도면 캔버스의 `Symbol`
- 다크 테마용 도식 색
- 에셋 정의, AML, 모델, `release/` 재빌드 커밋
- 사람 검수

## 검증

구분해서 적는다.

| 종류 | 결과 |
|---|---|
| 자동 테스트 | `npm test` 16파일 371개 통과. 그중 `tests/library-cards.test.tsx` 6개가 14종 칸 크기, `.card .vis` 없음, 흰 바탕 rect 제거, 10종 색, CSS `transparent`, 두 모드 렌더, 미준비 배지가 칸 안에 있는지를 본다. `tests/design-slots.test.ts` 는 100×48 그대로 통과한다. 이 숫자는 이 문서 작성 시점의 로컬 실행이다. 통과 판정은 CI 를 따른다 |
| 형식 검사 | `npm run typecheck` 통과 |
| 빌드 | `npm run build` 통과. 나온 HTML 은 4,111,154바이트다. `release/` 는 되돌렸고 이 PR 에 없다. main 의 릴리스 파일은 3,890,485바이트 그대로다 |
| Chrome | 156.0.8078.47, CSS 뷰포트 1280×800, devicePixelRatio 1. 콘솔 오류 0. 도식·실사풍·다크에서 카드 14장, 그림 100×48, 그림 오른쪽과 이름·ID·안내 왼쪽 사이 16px, `.slot-diagram` 배경 `rgba(0, 0, 0, 0)`, `.card .vis` 0. 그리드는 `368px 368px`, 7행 2열. 도식과 실사풍의 카드 높이·글자 x/y 가 종류마다 같다. 긴 ID 는 줄이 바뀌어 카드가 120px 보다 커지지만 두 모드가 같다. 「AI 생성」 칩은 칸 안에 있다. 도면을 열면 React Flow 노드 SVG 11개이고 카드용 `.slot-diagram` 은 0개다 |

한 화면(1280×800)에는 14장이 다 들어오지 않는다. 모드마다 위 화면과 스크롤 화면을 나눠 14장을 담았다.

- 위: 실린더, 푸셔, 바코드리더, 컨베이어, 스토퍼, 갠트리
- 스크롤: 피커, 센서, 광전 센서, 근접 센서, 리밋 스위치, 투입·식별·이송 유닛 템플릿

그림은 이 폴더에 있다.

- `docs/turns/TURN-006-library-schematic-light-1280.png`
- `docs/turns/TURN-006-library-schematic-light-scroll-1280.png`
- `docs/turns/TURN-006-library-schematic-dark-1280.png`
- `docs/turns/TURN-006-library-schematic-dark-scroll-1280.png`
- `docs/turns/TURN-006-library-photo-light-1280.png`
- `docs/turns/TURN-006-library-photo-light-scroll-1280.png`
- `docs/turns/TURN-006-canvas-light-1280.png`

## 확인 필요

- AC9 사람 검수는 Matthew 몫이다. 이 문서는 완료로 적지 않는다. 14장이 한 세트로 보이는지는 스크린샷으로 본다.
- 다크 카드 바탕(`#19283a`) 위 선 `#245BCE` 대비는 루카 계산으로 약 2.46:1 이다. 이번엔 다크용 색을 만들지 않았다. 채움 `#E5EDFF` 로 모양은 보인다.
- 유닛 템플릿은 자식 3개를 알아보게 줄였다. 칸을 120×56 으로 넓히지는 않았다.
- 4종 정식 파일의 세부 경로에 있던 `fill="black"` 은 그대로다. 이번 변경은 흰 바탕 `rect` 한 줄뿐이다.
