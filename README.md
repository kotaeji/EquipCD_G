# Aurora Concept Designer — 웹 시제품 v0.3.0-prototype (React + TypeScript)

> 이전 이름: 장비 컨셉 디자이너(v0.1~v0.2). 파일 형식 ID(`equipment-concept-designer/project`)·release 파일명(`equipment-concept-designer.html`)·localStorage 키는 호환을 위해 그대로 둡니다.

저장소: https://github.com/kotaeji/EquipCD_G · 작업 방법(집 Mac / 회사 Windows): [`docs/DEVELOPMENT-WORKFLOW.md`](docs/DEVELOPMENT-WORKFLOW.md)

사용자 매뉴얼(한국어, 지금 화면 기준, 검토 후보): [`docs/user-manual/USER-MANUAL.ko.md`](docs/user-manual/USER-MANUAL.ko.md) · PDF [`docs/user-manual/USER-MANUAL.ko.pdf`](docs/user-manual/USER-MANUAL.ko.pdf) (2026-11-12에 다시 만듦, 35쪽). 사람 검수 전입니다.

기능 목록과 연결표(기능 → 요구 ID → 화면 ID → 와이어프레임·UX·GUI 시안, 개발 상태): [`docs/FEATURE-LIST.md`](docs/FEATURE-LIST.md) · 보기용 [`Feature_Map.html`](docs/traceability/Feature_Map.html) · [`Feature_Traceability.xlsx`](docs/traceability/Feature_Traceability.xlsx)

회의용 설계 PDF(와이어프레임·사용자 흐름·화면 시안. 웹 실행 결과가 아님): [`docs/design-review/figma/README.ko.md`](docs/design-review/figma/README.ko.md)

TURN-004 헤더 브랜드색은 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-004.md`](docs/turns/TURN-004.md). 헤더 밖 색, 테마 저장값 A/B/C, 프로젝트 JSON, rev, Undo는 바꾸지 않았습니다.

TURN-005 도면 캔버스(React Flow)는 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-005.md`](docs/turns/TURN-005.md). 배치·연결 카드 보드, 프로젝트 JSON, rev, Undo 규칙, 실행 엔진, `release/` 는 바꾸지 않았습니다. 핸들을 끌어 연결하기와 Unit 안의 서브플로는 하지 않았습니다.

TURN-006 에셋 카드 도식은 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-006.md`](docs/turns/TURN-006.md). 14종 카드 그림은 100×48 한 칸이고 바탕은 투명합니다. 도면 캔버스의 장치 도식, 카드 상세, 실사풍 이미지 파일, `release/` 는 바꾸지 않았습니다.

TURN-007 이름 아이콘·구분선·접는 칸은 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-007.md`](docs/turns/TURN-007.md). 이름 변경 버튼, 이름 창 간격, 이 브라우저의 패널 너비, 접는 칸의 처음 상태를 바꿨습니다. 프로젝트 JSON, rev, Undo, `release/` 는 바꾸지 않았습니다.

TURN-008 탐색기 탭·작업 정보 줄은 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-008.md`](docs/turns/TURN-008.md). 왼쪽 탐색기는 Workspace · Project 탭이고, 위쪽 줄은 현재 Workspace · Project · rev · 저장 상태입니다. 프로젝트 JSON, rev, Undo, `release/` 는 바꾸지 않았습니다.

TURN-009 배치·연결 탭은 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-009.md`](docs/turns/TURN-009.md). 팔레트 아래에서 카드 보드와 도면 도식을 탭으로 바꿉니다. 고른 탭은 이 브라우저의 UserView에만 남습니다. 프로젝트 JSON, rev, Undo, `release/` 는 바꾸지 않았습니다.

TURN-010 Project 탭은 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-010.md`](docs/turns/TURN-010.md). 탐색기 Project 탭은 짧은 프로젝트 목록과 그 아래 장비 구조입니다. 상세 정보와 열기·이름 변경·탭 닫기·삭제는 각 줄의 「…」 팝업입니다. 프로젝트 JSON, rev, Undo, `release/` 는 바꾸지 않았습니다.

TURN-011 사용자 매뉴얼은 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-011.md`](docs/turns/TURN-011.md). `main` `4bc0f6a` 화면 기준으로 매뉴얼과 PDF를 다시 썼습니다. 앱 코드, 테스트, `release/` 는 바꾸지 않았습니다.

TURN-012 도면 포트 연결은 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-012.md`](docs/turns/TURN-012.md). 포트를 눌러도 장치는 움직이지 않고, 출력 포트를 입력 포트로 끌어 신호를 잇습니다. 신호 연결 모드의 두 번 누르기는 그대로입니다. 물류 연결을 끌어서 잇기, 연결 규칙, `release/` 는 바꾸지 않았습니다.

TURN-013 도면 Unit 크기는 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-013.md`](docs/turns/TURN-013.md). Device가 Unit 밖으로 나가면 Unit이 감싸도록 커지고, 오른쪽 아래 모서리로 크기를 바꿉니다. 자동으로 줄이지는 않습니다. `release/` 는 바꾸지 않았습니다.

TURN-014 도면 Unit 배치는 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-014.md`](docs/turns/TURN-014.md). Unit을 여러 개 고르면 간격을 같게 하고, 너비·높이를 가장 큰 값에 맞추고, 20px보다 가까운 Unit을 오른쪽으로 벌립니다. Device끼리의 간격·크기와 `release/` 는 바꾸지 않았습니다.

TURN-015 헤더 · 탭 아이콘은 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-015.md`](docs/turns/TURN-015.md). 헤더 제목 앞에 E안 마크(A 윤곽, 채운 출력 포트, 빈 입력 포트, 점선)를 두고, 브라우저 탭 아이콘은 같은 마크를 헤더 색 바탕에 점선 없이 넣었습니다. 제목, 헤더 색, `release/` 는 바꾸지 않았습니다.

TURN-016 헤더 아이콘 타일은 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-016.md`](docs/turns/TURN-016.md). 헤더 제목 앞 마크는 32px 흰 타일 안의 22px 진홍 아이콘입니다. 탭 아이콘, 제목, 헤더 색, `release/` 는 바꾸지 않았습니다.

TURN-017 센서 신호는 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-017.md`](docs/turns/TURN-017.md). 자재가 있는 Unit의 센서 신호가 실행 중에 켜집니다. 파일 형식, `release/` 는 바꾸지 않았습니다.

TURN-018 실행 결과 요약은 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-018.md`](docs/turns/TURN-018.md). 6단계 Station 실행 화면 위에 총 시간, 끝난 단계 수, 가장 긴 단계, 단계별 시작 · 끝 · 걸린 시간이 나옵니다. 시간은 가정값 기준입니다.

TURN-019 다크 테마 카드 도식은 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-019.md`](docs/turns/TURN-019.md). 다크 테마에서 에셋 카드 도식의 선 색을 밝게 바꿨습니다. 라이트 테마와 도식 모양은 그대로입니다.

TURN-020 공통 탐색 검색은 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-020.md`](docs/turns/TURN-020.md). 공통 탐색에 「이름으로 찾기」 입력칸이 생겼고, 안내만 있는 화면 네 곳에 「준비 중」 표시가 붙었습니다.

TURN-021 도면 편집 기본기는 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-021.md`](docs/turns/TURN-021.md). 도면에서 Shift를 누르고 빈 곳을 끌어 여러 개를 고르고, 고른 것을 한 번에 지우고, Device를 복제합니다.

TURN-022 Station 흐름은 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-022.md`](docs/turns/TURN-022.md). Station 시퀀스에 분기 · 병렬 · 반복 · 재시도와 Substation 단계를 넣고, 「▶ 실행」 한 번으로 끝까지 돌립니다. 6단계의 그룹 실행 선택과 단추는 없습니다. 파일 형식은 `0.3.0`, 실행 규칙은 `seq-runtime/0.3.0` 입니다. `flow` 가 없는 5공정 예제는 그대로 `11.100 s` 입니다.

TURN-023 흐름 편집 다듬기는 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-023.md`](docs/turns/TURN-023.md). Station 흐름에서 분기 · 병렬 · 반복 · 재시도의 이름을 바꾸고, 블록과 Substation 단계를 옮기고 묶습니다. 이름이 종류 낱말과 같으면 제목에 한 번만 나옵니다. Station 시퀀스 화면의 흐름 표는 한 번만 그립니다. 파일 형식은 `0.3.0`, 실행 규칙은 `seq-runtime/0.3.0` 입니다.

TURN-024 흐름 실행 기록은 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-024.md`](docs/turns/TURN-024.md). 한 갈래가 오류로 멈추면 진행 중이던 다른 갈래는 「정지」로 닫힙니다. 반복 안에서 나중에 실행된 단계는 건너뜀으로 세지 않습니다. 「처음 N회만」은 그 결과를 쓰는 분기 · 재시도가 없으면 안내를 보여 줍니다. 파일 형식은 `0.3.0` 그대로이고, 실행 규칙은 `seq-runtime/0.3.1` 입니다.

TURN-025 화면 테스트 시계는 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-025.md`](docs/turns/TURN-025.md). 「▶ 실행」 뒤의 잠금과 실행 중 표시를 보는 화면 테스트가 벽시계로 실행을 끝내지 않습니다. 앱 코드와 `release/` 는 바꾸지 않았습니다.

TURN-026 화면 다듬기는 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-026.md`](docs/turns/TURN-026.md). 라이트 테마가 흰색 · 회색 · 검정 계열입니다(헤더의 붉은색과 성공 · 경고 · 위험 색은 그대로). 에셋 라이브러리 카드는 폭에 맞춰 열 수가 바뀌고, 팔레트는 다음 줄로 이어집니다. 헤더의 실행 취소 · 다시 실행은 44px 단추 안의 SVG 아이콘입니다.

TURN-027 전체 선택은 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-027.md`](docs/turns/TURN-027.md). 2단계에서 Ctrl + A(Mac 은 Cmd + A)가 선택이 없으면 모든 Unit 을, Unit 하나가 골라져 있으면 그 Unit 의 Device 전부를 고릅니다. Ctrl + 클릭은 선택과 해제를 번갈아 합니다.

TURN-028 Device 자동 정렬은 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-028.md`](docs/turns/TURN-028.md). Unit 하나를 고르고 「자동 정렬」을 누르면 그 안의 Device 가 신호가 왼쪽에서 오른쪽으로 보이게, 겹치지 않게 다시 놓입니다. 실행 취소 한 번에 돌아갑니다.

TURN-029 3D 시뮬레이션 화면은 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-029.md`](docs/turns/TURN-029.md). 6단계 「실행·저장」에서 도면과 3D 를 바꿀 수 있습니다. 3D 는 왼쪽 정보, 가운데 Three.js 장면, 오른쪽 가동 조건입니다. 동작 시간을 바꾸면 모델 값이 바뀝니다. 파일 형식은 `0.3.0`, 실행 규칙은 `seq-runtime/0.3.1` 입니다. `release/` 는 다시 빌드하지 않았습니다.

TURN-030 6단계 탭은 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-030.md`](docs/turns/TURN-030.md). 6단계 도면 보기가 「실행 상태 / 실행 도면 / 검사 · 오류 주입」 탭으로 나뉘고, 실행 상태가 한글 낱말로 나옵니다.

TURN-031 3D 바닥 이름 · 실사풍은 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-031.md`](docs/turns/TURN-031.md). 3D 에서 Unit 이름을 구역 뒤쪽 바닥에 눕혀 쓰고, 「실사풍(AI)」을 고르면 3D 도 재질 · 조명이 있는 실사풍 양식으로 그립니다(코드로 만든 표현이며 실제 설비 형상이 아닙니다).

TURN-032 3D 움직임은 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-032.md`](docs/turns/TURN-032.md). 3D 에서 진행 중인 Device 의 부품이 움직이고, 자재가 물류 선을 따라 진행도에 맞춰 옮겨 갑니다. 가동 조건의 「설비 동작」으로 켜고 끕니다. 표현용 움직임이며 실제 축 동작이 아닙니다.

TURN-033 3D 숫자는 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-033.md`](docs/turns/TURN-033.md). 3D 왼쪽 정보에 사이클 시간 · 시간당 생산량(가정) · 병목 Unit · Gap 요약이, 오른쪽 가동 조건에 타임아웃 편집이 들어갔습니다.

TURN-034 흐름 표 다듬기는 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-034.md`](docs/turns/TURN-034.md). 흐름 표가 「정지」를 보이고 낱말이 「진행 중」으로 통일됐으며, 「병렬로 묶기」가 고른 줄을 갈래마다 하나씩 나눕니다.

TURN-035 6단계 통일은 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-035.md`](docs/turns/TURN-035.md). 도면과 3D가 같은 틀이고 가운데 캔버스만 바뀝니다. 진행 중인 단계 줄이 눈에 띄고, 탐색기를 접으면 작업 영역이 넓어집니다.

TURN-036 자동 정렬 뒤 겹침 풀기는 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-036.md`](docs/turns/TURN-036.md). 「자동 정렬」로 Unit 이 넓어져 옆 Unit 과 겹치면 같은 명령에서 옆 Unit 을 밀어냅니다. 실행 취소 한 번에 함께 돌아갑니다.

TURN-037 6단계 도면 맞춤은 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-037.md`](docs/turns/TURN-037.md). 6단계 「도면」이 가운데 칸에 맞게 크게 보이고 칸 크기가 바뀌면 다시 맞춰집니다. 「자세히」 단추 글자는 한 줄입니다.

TURN-038 단계 바 배지는 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-038.md`](docs/turns/TURN-038.md). 단계 바 여섯 단추에 판정과 남은 항목 수가 보이고, 배지를 누르면 그 단계의 남은 항목 목록이 열립니다. 항목을 누르면 고칠 화면 · 칸으로 가서 그 칸이 잠깐 강조됩니다.

TURN-039 상태 표시 체계는 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-039.md`](docs/turns/TURN-039.md). 진행 중 · 완료 · 오류 · 대기 · 미정 · 가정 여섯 상태를 색 + 기호 + 글자 한 체계(`src/ui/status.ts`)로 보여 줍니다. 도면 · 3D 표식은 「▶ 진행 중」입니다.

TURN-040 자재 여러 개 투입은 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-040.md`](docs/turns/TURN-040.md). 같은 자재를 「투입 개수」만큼 「투입 간격」을 두고 이어서 실행합니다. Device 가 쓰이는 중이거나 Unit 이 차 있으면 오류가 아니라 대기합니다. 사이클 시간 · 시간당 생산량 · 병목은 개체가 3개 이상이면 「정상 상태(가정)」 값입니다. 분기 · 병렬 · 반복 · 재시도 · Substation 단계가 있는 흐름은 투입 개수 1 만 실행합니다. 실행 규칙 `seq-runtime/0.4.0`.

TURN-041 Export 초안 파일은 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-041.md`](docs/turns/TURN-041.md). 5단계 › Export 미리보기에서 장비 구조 · 신호 · 포지션 · 시퀀스를 `*.aurora-export.json` 으로 내려받고, 역매핑 검사로 모델과 맞대 봅니다. **초안 형식이며 Aurora Core 가 바로 읽는 형식이 아닙니다.** Core 전송은 없습니다.

TURN-042 첫 실행 둘러보기는 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-042.md`](docs/turns/TURN-042.md). 처음 여는 브라우저의 시작 화면에 「5공정 예제로 둘러보기」가 있고, 일곱 걸음으로 1~6단계를 안내합니다. 「보기 설정」에서 다시 볼 수 있습니다.

TURN-043 실행 결과 Gap 은 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-043.md`](docs/turns/TURN-043.md). 끝난 실행의 기다림 · 사이클 · 오래 걸린 단계 · 오류를 5단계 Gap 목록 맨 위 「실행 결과」에 근거 · 수정 제안 · 「이동」과 함께 올립니다. 프로젝트 파일에는 저장하지 않습니다.

TURN-044 복사 · 붙여넣기는 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-044.md`](docs/turns/TURN-044.md). Unit · Device 를 Ctrl/Cmd+C · V 로 같은 프로젝트의 다른 Unit 이나 다른 프로젝트 탭에 붙여 넣습니다. 앱 안에서만 동작하고 운영체제 클립보드는 쓰지 않습니다. 시퀀스 단계 · 바깥 연결 · 자재 경로는 따라가지 않습니다.

TURN-045 위험 단추 · 숫자 칸 · 대비는 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-045.md`](docs/turns/TURN-045.md). 지우는 단추는 붉은 외곽선 + ✕ + 글자로 줄의 오른쪽 끝에 둡니다. **쓰이고 있는 Action · Signal · Position 은 전에는 삭제를 거절했지만, 이제 쓰이는 곳의 수를 보여 주고 확인하면 함께 지웁니다**(Matthew 결정 2026-11-23, 실행 취소 한 번). 숫자 칸 안에 단위가 보이고 잘못된 값은 그 자리에서 알려 줍니다. 테두리 · 도면 점 색을 3:1 대비에 맞게 진하게 했습니다.

TURN-046 Interlock 실행 반영은 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-046.md`](docs/turns/TURN-046.md). Interlock 에 규칙(허용 조건 / 동시 금지)을 둘 수 있고, **확인됨 + 규칙 있음**인 것만 실행에서 Action 시작을 막습니다(`INTERLOCK_BLOCK`). 논리 시뮬레이션이며 안전 인증이 아닙니다. 실행 규칙 `seq-runtime/0.5.0`.

TURN-047 자동 임시 저장은 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-047.md`](docs/turns/TURN-047.md). 편집 5초 뒤 이 브라우저에 임시 저장하고, 다시 열 때 「복구 / 버리기」를 묻습니다. 「저장」한 내용은 자동으로 덮어쓰지 않습니다. 「보기 설정」에서 끌 수 있습니다.

TURN-048 선 강조 · 작업 화면 확보는 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-048.md`](docs/turns/TURN-048.md). 도면에서 고른 것과 이어진 선만 진하고 굵게 보이고, 선에 마우스를 올리면 출발 → 도착 이름이 뜹니다. 미니맵을 접을 수 있고(6단계는 처음에 접힘), 팔레트는 도면 높이가 모자랄 때만 줄을 줄입니다.

TURN-049 신호 기다림 블록 · Substation 하나만 일시정지는 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-049.md`](docs/turns/TURN-049.md). 흐름에 「신호 기다림」 블록(조건 + 타임아웃)을 넣을 수 있고, 타임아웃이 지나면 `WAIT_TIMEOUT` 으로 멈춥니다. 실행 중에 진행 중인 Substation 단계 하나만 멈췄다가 재개할 수 있습니다. **병렬 갈래 안에 Substation 단계를 넣을 수 있게 됐습니다**(전에는 거부 — Matthew 결정 2026-11-23). 실행 규칙 `seq-runtime/0.6.0`.

TURN-050 물류 끌어 잇기 · 우클릭 메뉴는 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-050.md`](docs/turns/TURN-050.md). Unit 오른쪽 가운데 손잡이를 다른 Unit 으로 끌면 물류 연결이 생깁니다. 도면 · 카드 보드 · 탐색기 트리에서 우클릭(Shift+F10)하면 그 대상의 메뉴가 뜹니다. 메뉴는 이미 있는 명령만 부릅니다.

TURN-051 문제 안내 · 빈 화면은 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-051.md`](docs/turns/TURN-051.md). 막힘 안내를 「무엇 / 왜 / 어떻게」 세 줄과 이동 단추로 맞췄고, 빈 목록에는 다음 행동 단추를, 「준비 중」 화면에는 지금 대신 쓸 곳을 둡니다. 판정 · 차단 규칙 · 오류 코드는 바꾸지 않았습니다.

TURN-052 조건 한 줄 식 · 조건 검사은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-052.md`](docs/turns/TURN-052.md). 조건을 어디서나 같은 한 줄 식(`STP-03.상승 완료 = ON 그리고 자재 위치 = S2 식별`)으로 보여 주고, 끊긴 참조 · 항상 거짓 · 겹침 · 미정을 5단계 「조건」 진단에 올립니다. 진단만 하고 실행은 막지 않습니다.

TURN-053 명령 찾기 · 단축키 목록은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-053.md`](docs/turns/TURN-053.md). Ctrl/Cmd+K 로 명령을 이름으로 찾아 실행하고, 입력 칸 밖에서 `?` 로 단축키 목록을 봅니다.

TURN-054 글자 · 간격 단계 · 이름표은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-054.md`](docs/turns/TURN-054.md). 글자 4단계 + 제목 2단계 · 간격 4px 단위 토큰으로 맞췄습니다. 도면은 확대 70% 미만에서 Unit 이름만, 120% 이상에서 Device 이름 · 상태까지 보이고, 3D 는 멀면 Unit 이름만 보입니다(기준값은 설계 제안).

TURN-055 Workspace 파일 묶음은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-055.md`](docs/turns/TURN-055.md). Workspace 의 저장된 프로젝트 전부를 `.aurora-workspace.json` 한 파일로 내보내고 가져옵니다. 같은 ID 는 사본 / 건너뛰기 / 덮어쓰기를 고릅니다.

TURN-056 도움말 칸 · 용어 풀이은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-056.md`](docs/turns/TURN-056.md). 헤더 「도움말」이 지금 화면의 도움말을 오른쪽 칸에 보여 주고, 제목 · 탭 · 단계 바의 용어에 마우스를 올리면 한 줄 풀이가 뜹니다. **알려진 문제(Issue #212): 포인터가 한 번에 와서 바로 눌리는 방식(터치 · 자동화 클릭)으로 용어가 붙은 탭 · 단계 단추를 누르면 앱이 멈춥니다. 「보기 설정」에서 용어 밑줄을 끄면 피할 수 있습니다.**

TURN-057 내 템플릿은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-057.md`](docs/turns/TURN-057.md). Unit 을 「내 템플릿」으로 이 브라우저에 저장하고 팔레트에서 끌어 놓습니다. 놓을 때마다 새 ID 입니다.

TURN-058 Evolution Lab 1차은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-058.md`](docs/turns/TURN-058.md). 가동 조건(Action 시간 · 타임아웃 · 투입)을 바꾼 안 1~3개를 기준과 함께 사본에서 실행해 비교 표로 보고, 한 안을 모델에 반영합니다. 자동 탐색 · 최적화 · AI 는 없습니다.

TURN-059 배경 도면 · 위치 잠금은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-059.md`](docs/turns/TURN-059.md). PNG · JPEG 한 장을 도면 뒤에 깔고 두 점으로 축척을 맞춥니다. Unit 위치를 잠글 수 있습니다. PDF 는 지원하지 않습니다.

TURN-060 자료 입력 1차 (XLSX)은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-060.md`](docs/turns/TURN-060.md). IO 리스트 · 사양표 XLSX 를 이 브라우저 안에서 읽어 열을 매핑하고 Unit · Device · 신호 후보로 올립니다. 확인한 것만 반영됩니다. 새 의존성 `fflate`(MIT, Matthew 2026-11-23 허용).

TURN-061 아이콘 한 세트은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-061.md`](docs/turns/TURN-061.md). 헤더 · 도구 줄 · 탭 · 메뉴 · 명령 찾기가 한 세트의 아이콘 + 글자를 씁니다. 새 의존성 `lucide-react`(ISC, Matthew 2026-11-23 허용).

TURN-062 작은 마무리 묶음은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-062.md`](docs/turns/TURN-062.md). 기다림 시간 초과(`WAIT_TIMEOUT`)도 세 줄 안내로 나오고, 도움말의 매뉴얼 줄에서 기능 ID 를 뺐으며, 둘러보기 마지막 단추가 「끝내기」이고, 실행 전 차단이 여럿이면 「남은 차단 N개」가 보입니다.

TURN-063 세 갈래 이상 분기은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-063.md`](docs/turns/TURN-063.md). 분기에 갈래를 2~4개 둡니다. 위에서부터 처음 참인 갈래로 가고 마지막은 「그 밖」입니다. 분기의 빈 갈래는 전처럼 그냥 지나갑니다. 실행 규칙 `seq-runtime/0.7.0`.

TURN-064 타이밍 차트은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-064.md`](docs/turns/TURN-064.md). 6단계 「자세히」의 「타이밍 차트」가 끝난 실행을 Unit · Device · 개체 줄의 시간축 막대로 보여 줍니다.

TURN-065 실행 결과 보고서 내보내기은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-065.md`](docs/turns/TURN-065.md). 끝난 실행을 HTML 보고서 · 단계 표 CSV · 로그 CSV 로 내려받습니다. 내보낸 시각은 이 컴퓨터의 시간으로 나옵니다(TURN-088).

TURN-066 대상 찾기은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-066.md`](docs/turns/TURN-066.md). 명령 찾기 창에서 Unit · Device · 신호 · Action · 단계 · 블록 · Interlock · 자재 이름도 찾아 그 칸으로 이동합니다(`>` 명령만 · `@` 대상만).

TURN-067 실행 취소 이력은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-067.md`](docs/turns/TURN-067.md). 헤더 「이력」 목록에서 편집 이름과 rev 를 보고 눌러서 그 시점으로 갑니다.

TURN-070 확인 이력은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-070.md`](docs/turns/TURN-070.md). 「확인됨」으로 바꿀 때 확인자 이름과 시각을 프로젝트에 남기고 5단계 「확인 이력」 표에서 봅니다. 로그인 · 인증은 없습니다. 화면의 시각은 이 컴퓨터의 시간으로 나옵니다(TURN-088).

TURN-071 흐름 블록 위의 여러 개체은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-071.md`](docs/turns/TURN-071.md). 분기 · 병렬 · 반복 · 재시도 · 기다림이 있는 시퀀스에서도 자재를 여러 개 연속 투입합니다(`MULTI_FLOW` 차단 없앰). 실행 규칙 `seq-runtime/0.8.0`.

TURN-073 흐름 표 우클릭 · 끌어서 옮기기은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-073.md`](docs/turns/TURN-073.md). 4단계 흐름 표의 줄에서 우클릭 메뉴를 쓰고, 줄 왼쪽 손잡이를 끌어 다른 자리 · 갈래로 옮깁니다.

TURN-074 일괄 편집은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-074.md`](docs/turns/TURN-074.md). 3단계 「일괄 편집」에서 여러 Action 의 동작 시간 · 타임아웃 · 상태를 미리보기 뒤 한 번에 바꿉니다.

TURN-075 예제 갤러리 · 시작 마법사은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-075.md`](docs/turns/TURN-075.md). 시작 화면에 예제 카드 3장(설명 · 수 · 가상 시간)과, Unit 수 · 템플릿 · 물류 연결을 정해 뼈대를 만드는 「뼈대부터」가 있습니다.

TURN-076 CSV 입력 · 표 붙여넣기 · IO 리스트 내보내기은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-076.md`](docs/turns/TURN-076.md). 자료 입력이 CSV 파일과 엑셀에서 복사한 표도 받고, 모델의 신호를 IO 리스트 CSV 로 내보냅니다.

TURN-077 다크 대비 · 초점 표시은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-077.md`](docs/turns/TURN-077.md). 초점 링을 2px · `--focus` 하나로 맞추고 작은 단추의 눌리는 영역을 24px 이상으로 했습니다. 다크 도식 선은 이미 3:1 이상이라 색은 바꾸지 않았습니다.

TURN-078 움직임 규칙 · 실행 도면은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-078.md`](docs/turns/TURN-078.md). 전환 시간 · 곡선을 토큰으로 맞추고, 6단계 도면에 진행 중 Device 의 진행률 · 물류선 위 자재 이동 · 기다림 표시를 더했습니다. 운영체제의 「움직임 줄이기」를 따릅니다.

TURN-079 인쇄용 보기은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-079.md`](docs/turns/TURN-079.md). 헤더 「내보내기」 또는 명령 찾기의 「인쇄용 보기」로 표지 · 장비 구조 · 도면 · 시퀀스 · SFC · 신호 · 가정 목록을 브라우저 인쇄로 냅니다.

TURN-082 실행 시나리오은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-082.md`](docs/turns/TURN-082.md). 가동 조건(투입 · 오류 주입 · 배속)을 이름 붙여 저장하고 불러오며, 「시나리오 모두 실행」으로 사본에서 차례로 돌립니다.

TURN-068 표 가독성 · 알림은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-068.md`](docs/turns/TURN-068.md). 표가 한 가지 모양(`ecd-table` — 숫자 · 시간은 오른쪽 정렬, 붙는 머리 줄, 긴 글은 줄임과 툴팁)을 쓰고, 알림이 정보 · 성공 · 거절의 기호와 글자로 최대 3개까지 쌓입니다. 상태 줄 「알림」에서 이번 세션의 최근 20개를 봅니다.

TURN-069 헤더 정리 · 도움말 칸 겹침은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-069.md`](docs/turns/TURN-069.md). 헤더 단추가 좁은 폭에서 「더 보기」로 모이고, 1440 폭 미만에서는 도움말 칸이 작업 칸을 좁히지 않고 위에 겹쳐 열립니다.

TURN-072 Substation 시퀀스 안의 흐름 블록은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-072.md`](docs/turns/TURN-072.md). Substation 시퀀스에도 분기 · 반복 · 재시도 · 신호 기다림을 넣고, Station 실행의 Substation 단계가 그 흐름대로 돕니다. 병렬과 Substation 단계는 넣을 수 없습니다. 실행 규칙 `seq-runtime/0.9.0`.

TURN-080 자재 여러 종류 · 혼류 투입은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-080.md`](docs/turns/TURN-080.md). 자재 정의를 4개까지 두고 「A, A, B」 같은 순서로 섞어 투입합니다. 조건에 「자재 종류 = B」를 쓸 수 있고, 실행 요약에 종류별 생산 개수와 평균 통과 시간이 나옵니다. 실행 규칙 `seq-runtime/0.10.0`.

TURN-081 저장본과 지금의 차이 보기은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-081.md`](docs/turns/TURN-081.md). 5단계 「진단·저장·AML」의 「바뀐 것」에서 저장본과 지금 모델의 추가 · 삭제 · 바뀜을 종류별 목록으로 보고, 다른 저장 프로젝트나 JSON 파일과도 견줍니다. 합치기는 없습니다.

TURN-083 끝난 실행 되감아 보기은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-083.md`](docs/turns/TURN-083.md). 실행이 끝나면 6단계 도면 아래의 시간 막대로 그 실행의 어느 시각이든 도면 · 3D · 단계 표 · 신호 · 자재 위치를 다시 봅니다. 모델은 바뀌지 않습니다.

TURN-084 키보드로 도면 조작은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-084.md`](docs/turns/TURN-084.md). 2단계 도면에서 Tab · Enter · Esc 로 Unit 과 Device 를 고르고, 방향키로 옮기고, `L` · `S` 로 물류 · 신호를 잇고, `+` · `-` · `0` 으로 확대 · 축소 · 맞춤을 합니다.

TURN-085 화면 배치 — 넓고 좁은 화면은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-085.md`](docs/turns/TURN-085.md). 1024 폭에서는 탐색기 · 속성 칸 · 가동 조건이 접혀 시작하고 1920 폭에서는 가운데가 넓어집니다. 패널 너비 · 접힘은 폭 단계마다 따로 기억하고, 「보기 설정」의 「화면 배치 처음으로」로 되돌립니다.

TURN-086 3D 보기 품질은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-086.md`](docs/turns/TURN-086.md). 6단계 3D 에 등각 · 위 · 앞 · 옆 시점 단추(장면에 초점이 있을 때 1~4 키), 방향 표시, 바닥 격자, 접지 그림자, 고른 Device 윤곽과 이름표 강조가 있습니다.

TURN-087 차이 보기 · 키보드 상태 줄 마무리은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-087.md`](docs/turns/TURN-087.md). 차이 보기의 순서 줄이 내부 ID 대신 「더함: 신호 기다림(S2 뒤) · 옮김: S4 피커 잡기 3번째 → 5번째」처럼 바뀐 내용을 말하고, 키보드로 고른 Unit · Device 의 상태 줄 좌표가 실행 취소 · 다시 실행 · 끌기를 따라갑니다.

TURN-088 시각을 이 컴퓨터의 시간으로은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-088.md`](docs/turns/TURN-088.md). 화면과 보고서 · 인쇄용 보기의 시각이 `2026-11-27 22:46 (UTC+9)` 형식으로 나옵니다. 파일 안의 값과 내려받는 파일 이름은 그대로 UTC 입니다.

TURN-089 낮고 좁은 화면 다듬기 (1024×700)은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-089.md`](docs/turns/TURN-089.md). 1024×700 에서 3D 의 정한 시점이 칸 안에 다 들어오고, 6단계 실행 도구 줄이 한 줄이며, 1024 폭 미만에서도 문서 가로 스크롤이 생기지 않습니다.

TURN-090 흐름 표 · Substation 시퀀스 카드 밀도은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-090.md`](docs/turns/TURN-090.md). 흐름 표가 좁으면 줄 끝 단추가 「⋯」 하나로 접히고, 블록 깊이가 16px 걸음과 세로선으로 보입니다. Substation 시퀀스 화면의 「병렬로 묶기」 · 「Substation 시퀀스 넣기」는 꺼져 있고 까닭이 툴팁에 있습니다.

TURN-091 자재 종류를 색과 글자로은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-091.md`](docs/turns/TURN-091.md). 자재 정의가 둘 이상이면 종류마다 색 · 무늬 · 글자가 도면 · 3D · 개체 표 · 타이밍 차트 · 보고서에 함께 나오고 범례가 생깁니다. 정의가 하나면 예전과 같습니다.

TURN-092 조건으로 도는 반복은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-092.md`](docs/turns/TURN-092.md). 반복 블록의 방식을 「횟수」 · 「참이 될 때까지」 · 「참인 동안」에서 고릅니다. 조건 반복에는 상한(기본 10, 1~999)이 꼭 있고, 상한에 닿으면 `LOOP_LIMIT` 로 멈춥니다. 실행 규칙 `seq-runtime/0.11.0`.

TURN-093 실행 준비 점검표은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-093.md`](docs/turns/TURN-093.md). 6단계 「준비 검사」가 차단과 경고를 모두 줄 목록으로 보여 줍니다(「차단 2 · 경고 3」). 줄을 누르면 세 줄 안내가 펼쳐지고 「이동」으로 고칠 곳에 갑니다. 6단계 배지 숫자는 차단 수입니다.

TURN-094 저장 지점 (이름 붙인 버전)은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-094.md`](docs/turns/TURN-094.md). 5단계 「저장 지점」에서 지금 모델을 이름을 붙여 이 브라우저에 남기고(프로젝트마다 20개), 지금과의 차이를 보고, 사본으로 열거나 그 지점으로 되돌립니다. 되돌리기는 실행 취소 한 번으로 돌아옵니다.

TURN-095 보고서 · 인쇄용 보기 모양 맞추기은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-095.md`](docs/turns/TURN-095.md). 실행 결과 보고서와 인쇄용 보기가 같은 표지 · 표 · 쪽 머리를 씁니다. 인쇄하면 쪽마다 프로젝트 이름 · 한계 문구 · 쪽 번호(`n / N`)가 나옵니다.

TURN-096 Unit 복제 · 고른 것 정렬은(는) 검토 후보입니다. 사람 검수 전이며 정식 릴리스가 아닙니다. 기록은 [`docs/turns/TURN-096.md`](docs/turns/TURN-096.md). Unit 을 고르고 「복제」(Ctrl/Cmd+D)하면 안의 Device · 신호 · Action 이 새 ID 로 생깁니다. 고른 Unit 만 자동 정렬하고, 같은 Unit 의 고른 Device 끼리 간격 · 크기를 맞춥니다.

## 빠른 시작
**설치 없이 보기**: 저장소의 `release/equipment-concept-designer.html` 한 파일을 내려받아 Chrome으로 엽니다(GitHub 파일 화면 → Download raw file). 로컬 정적 서버로 여는 것을 권장합니다 — 예: `npx serve release` 또는(Python 있으면) `python3 -m http.server 8766 --directory release` 후 `http://localhost:8766/equipment-concept-designer.html`. file:// 직접 열기는 Mac/Windows에서 GUI 검수하지 않았습니다.

**개발**(Node 20+ 필요, Python 불필요):
```bash
git clone https://github.com/kotaeji/EquipCD_G.git   # 또는 gh repo clone kotaeji/EquipCD_G, 또는 GitHub Code → Download ZIP
cd EquipCD_G
npm ci
npm run dev          # http://localhost:5173
npm run typecheck && npm test && npm run build   # build → release/equipment-concept-designer.html 갱신
```
- 앱의 프로젝트 데이터는 **브라우저 localStorage**에 저장되며 PC 사이에 자동 동기화되지 않습니다. 다른 PC로 옮기려면 앱의 **JSON 내보내기 → 가져오기**를 쓰세요. git은 코드·문서 파일만 동기화합니다.
- 공식 CAEX XSD는 재배포 조건 미확인으로 저장소에 없습니다. XSD 검사(`npm run validate:aml`, Python+lxml 필요)는 선택이며, 없어도 `npm test`는 해당 검사만 건너뛰고 통과합니다.
- 라이선스: 프로젝트 전체에 대한 오픈소스 라이선스는 지정하지 않았습니다. 실사진은 각 사진의 개별 라이선스·저작자 표시를 따릅니다(`assets/visuals/ATTRIBUTION.md`, `photo-manifest.json`). WPF 버전은 미구현입니다.

## 한눈 요약
- **v0.3에서 추가된 것** (요구: `docs/requirements-v0.3.md` N01~N08, UX: `docs/UX-SCENARIOS.md`, 화면안: `docs/WIREFRAMES.md`, 변경 기록: `docs/REQUIREMENT-CHANGELOG.md`)
  - **Station › Substation › Device (N01)**: 기존 Equipment/Unit ID·관계·파일 키는 그대로, 화면에서 Equipment=Station, Unit=Substation 동의어 표시.
  - **Substation 복수 시퀀스 (N02)**: Substation마다 시퀀스 여러 개 추가/이름 변경/삭제, 단계 추가·순서·삭제(4 자재·시퀀스 › Substation 시퀀스). 6단계의 별도 그룹 실행 단추는 TURN-022에서 뺐다. Station 시퀀스에 Substation 단계를 넣으면 「▶ 실행」이 그 Unit의 시퀀스를 공통 가상 시계로 함께 돌리고, 끝나면 다음 단계로 간다. 같은 Device를 두 시퀀스가 쓰거나 자재를 다루는 시퀀스가 둘 이상이면 **실행 전 차단·진단**. 한 갈래 오류 시 전체 정지(보수적, 설계 제안). 기존 Station 단일 시퀀스·5공정 예제는 그대로 동작. 예제 「+ 병렬 예제」(`samples/sample-parallel-substation.ecd.json`) · 「+ 흐름 예제」(`samples/sample-flow.ecd.json`).
  - **왼쪽 Workspace/Project 탐색기 (N03)**: 6단계 모두에서 열린 프로젝트(미저장 표시)·새/예제/열기/가져오기·최근 저장·Station›Substation›Device 트리. 접기 가능. 실행 중 다른 프로젝트로 전환하면 그 실행은 일시정지(자동 재개 없음).
  - **AI 생성 실사풍 이미지 (N04)**: 「도식 / 실사풍(AI)」 토글. 14종 모두 도식과 같은 방향으로 생성한 AI 이미지(`assets/visuals/generated/`, 메타데이터 `generated-manifest.json`). 카드·캔버스·상세에 **AI 생성 · 실제 촬영 사진 아님** 표기, 상세에 생성 도구·날짜·지시문·구도 참고. 토글은 Device 박스 크기·위치·앵커·ID·선택·모델을 바꾸지 않음. v0.2 실사진은 출처 이력으로만 보존(상세의 접힌 영역, 기본 표시 안 함, 재다운로드 없음).
  - **룩앤필 정리 (N05)**: 중립 툴 크롬, 글자·간격 체계, 포커스 링, 빈 상태 안내, 1280×800/1920 레이아웃 조정, A/B/C 테마 유지. 기준: `.superdesign/design-system.md`(설계 제안). **상용 완성이나 접근성 인증을 주장하지 않습니다.**
  - 파일 형식 0.3.0 (0.2.x는 `flow` 없이 그대로 열고, 0.1.x는 열 때 자동 변환 + `MIGRATED_FORMAT` 경고, 원본 파일 불변).
- **v0.2에서 추가된 것**
  - **에셋 정의를 AML(CAEX 3.0) 파일에서 읽음**: `assets/aml/ecd-sample-library.aml` → 라이브러리 → 인스턴스 배치. 실행 중 다른 AML 가져오기·라이브러리 AML 내보내기(round-trip). 앱 subset 의미 검사 + 공식 CAEX 3.0 XSD 검사(브라우저 밖, Python lxml). 범위·한계: `AML-SUPPORT.md`.
  - **에셋 14종**: 기존 8종 유지 + 센서 3종(광전·근접·리밋 스위치) + 복합 유닛 템플릿 3종(투입·식별·이송 — 자식 Device·내부 신호 연결·Action 사전조건 포함, 배치할 때마다 새 ID).
  - **도식/실사진 토글**: 14종 모두 Wikimedia Commons 실제 촬영 참고 사진(12장, 출처·저자·라이선스·대표 범위 표시, 정확 모델 일치 아님). 토글은 모델 불변.
  - **단계별 중앙 작업영역(C10 위저드 제안안)**: 1 입력·에셋 선택(라이브러리 카드) → 2 배치·연결(Canvas) → 3 속성·Action → 4 자재·시퀀스 → 5 점검 → 6 실행·저장. 현재 단계·목표·남은 항목·이전/다음, 데이터 기반 준비 판정, 확인 후 데이터가 바뀌면 ‘재확인 필요’.
- **v0.1부터 있던 것**: Unit/Device 배치·이동·연결·속성 → 수동 순차 시퀀스 → 5공정·자재 1개 논리 시뮬레이션 → localStorage 저장·재열기, JSON 내보내기/가져오기, A/B/C 테마, F1 직접 입력 후보표, F6 기본 Gap.
- **안 된 것(미구현)**: F7 Evolution Lab 전체, F8 Aurora Core 실제 형식 Export·전송(초안 형식 파일과 역매핑 검사만 — TURN-041), F1 문서/USD 추출, 자재 정의 여러 종류 · 흐름 블록 위의 여러 개체 실행(순차 시퀀스의 여러 개체는 TURN-040), 갈래 사이 동기점, 조건 무한 반복, 세 갈래 이상 분기, AI, WPF, 일반 AutomationML 파일(InstanceHierarchy·외부 참조·상속 등) 해석, 브라우저 내 XSD 검사, 가져온 AML의 사진 파일 동봉, C11(노트 갱신 — 앱 기능 아님, 부모 담당), 물류 연결을 끌어서 잇기, Unit 안에 Device를 서브플로로 두기, 흐름 블록을 끌어서 옮기기. Station 시퀀스의 분기 · 병렬 · 고정 반복 · 재시도(최대 2회) · Substation 단계는 TURN-022에서 넣었다. 블록 이름 · 블록과 Substation 단계 옮기기 · 묶기 · 흐름 표 한 번은 TURN-023에서 다듬었다. 3D 보기의 CAD · 외부 형상 · 배치 편집은 하지 않는다. TURN-029는 지금 열린 프로젝트의 논리 실행을 기본 도형으로 보여 준다.
- **요구 상태와 구현 상태는 다릅니다**: v0.2 요구문서의 [확정]/[설계 제안]/[미정]은 요구 승인 상태이고, 이 폴더의 구현·검증 결과는 `REQUIREMENTS-VERIFICATION.md`에 따로 적습니다. 6단계 구성·gate 규칙·14종 구성·카드 배치는 요구문서상 **[설계 제안]**이며 이번 구현은 그 제안을 시제품으로 만든 것일 뿐 확정이 아닙니다.
- **검증 상태 (v0.3)**: 자동 테스트 **7개 파일 72개 통과** = 기존 57개(ui-smoke 1개는 v0.3 화면에 맞게 수정) + 신규 15개(group 12, visuals 3). **v0.3 실제 브라우저 GUI 검수**(부모 에이전트, 사람 검수 아님, `http://127.0.0.1:8767/…`, 스크린샷 1920×1200): AI 카드 14·배지·상세 메타데이터·토글 rev 불변, A/B/C·1~6 상시 탐색기, 병렬 예제 1.200/1.600 s, DEVICE_CONFLICT 차단·Undo, 그룹 실행/일시정지/재개/끝까지·GROUP_COMPLETE, 프로젝트 전환 자동 일시정지·복귀 재개, 기본 Station 11.100 s, JSON 0.2 내보내기/가져오기 통과 — `BROWSER-VERIFICATION.md` 7절. 현재 페이지 콘솔 오류 0건(세션 전체의 외부 collector.github.com 503 6건은 이전 열람 기원·원인 불명으로 앱 오류로 단정 안 함). 미검증: 1280×800(창 크기 변경 불가), body 전체 overflow 측정, v0.1 파일 가져오기 GUI. 1920에서 6단계 Canvas는 내부 가로 스크롤. 아래는 v0.2 기록 — 자동 테스트 **5개 파일 57개 통과**. 에이전트가 headless Chrome 156으로 release HTML(file://)을 자동 조작해 v0.2 핵심 경로 확인(`BROWSER-VERIFICATION.md` 「v0.2」 절, 스크린샷 `docs/screenshots/v0.2/`). **v0.2 실제 브라우저 GUI 검수**(부모 에이전트, Linux Chrome 1920×1072, `http://127.0.0.1:8766/equipment-concept-designer.html`): 라이브러리 카드·AML 상세·사진 토글, 1~6 중앙 화면, 식별 유닛 템플릿·Undo, NOT_READY 차단, 기본 실행 RUN_COMPLETE(11.100 s, 오류 0), AML 가져오기 2건 관찰 통과 — 자동 결과와 분리해 `BROWSER-VERIFICATION.md` 6절에 기록. 미검증: 1280×800·작은 화면, V01~V16 전체, Mac/Windows, file:// GUI 검수, 유닛 템플릿 포함 실행.

> **논리 시뮬레이션 전용 시제품입니다.** 실제 장비 제어, 정밀 물리·충돌 검증, AI 최적화, Aurora Core 실제 연동은 **하지 않습니다.**
> 화면의 모든 시간·크기·무게·타임아웃은 **[예시] 가정값**이며 실제 장비 사양이 아닙니다. 실사풍 이미지는 AI 생성 일반형 예시이며 실제 사진·특정 제품·사양 근거가 아닙니다.
> 요구 명세: `docs/requirements-v0.3.md` (v0.3 공개 통합본) · 이전 `docs/requirements-v0.2.md` (v0.2 전체본, 2026-11-08 KST) — v0.1 원본 `docs/requirements-v0.1.md`는 그대로 보존. 요구별 구현/검증: `REQUIREMENTS-VERIFICATION.md`. AML 범위: `AML-SUPPORT.md`. 브라우저 관찰: `BROWSER-VERIFICATION.md`. 불명확·결정 필요: `AMBIGUITIES.md`.
> GitHub 저장소 `kotaeji/EquipCD_G`(main)에서 관리합니다. 기존 IssueReporter 프로젝트와 무관합니다. WPF 버전은 없습니다.

## 바로 열기 (설치 불필요)
`release/equipment-concept-designer.html` 파일 하나(약 2.26 MB, AI 이미지 14장 + 이력용 사진 포함)를 Mac/Windows Chrome에서 더블클릭(또는 드래그)해 엽니다.
React 번들·CSS·AML 라이브러리·도식·사진이 모두 인라인된 단일 파일이며 외부 CDN·네트워크 요청이 없습니다(headless Chrome에서 외부 요청 0건 확인). 사진 상세의 ‘출처 페이지’·라이선스 링크를 누를 때만 외부 사이트가 열립니다.
- 저장: 브라우저 localStorage (이 브라우저·이 PC에만 남음). 저장을 쓸 수 없으면 상태바에 “메모리 전용”으로 표시되며 **JSON 내보내기**로 보관하세요.
- Chrome의 file:// localStorage는 모든 로컬 HTML 파일이 같은 저장 영역을 공유할 수 있습니다(브라우저 정책). 중요 작업은 JSON 내보내기로 백업하세요.

## 개발 실행
```bash
npm ci
npm run dev           # http://localhost:5173 (host 0.0.0.0)
npm test              # vitest 160파일 1228개: 모델/런타임/그룹 런타임/흐름(분기·병렬·반복·재시도)/저장/AML/템플릿/AI 이미지/위저드 + jsdom UI 스모크 + 테마 대비(헤더·캔버스·미저장 칩) + React Flow 캔버스 + 라이브러리 카드 도식 + TURN-007 아이콘·구분선·접는 칸 + TURN-008 탐색기 탭·작업 정보 줄 + TURN-009 배치·연결 탭 + TURN-010 Project 탭 목록·상세 팝업 + TURN-012 도면 포트 연결 + TURN-013 Unit 크기 + TURN-014 Unit 배치 + TURN-015 헤더 마크·탭 아이콘 + TURN-016 헤더 흰 타일 + TURN-017 센서 신호 + TURN-018 실행 결과 요약 + TURN-019 다크 카드 도식 + TURN-020 공통 탐색 검색 · 준비 중 표시 + TURN-021 끌어서 고르기 · 여러 개 삭제 · Device 복제 + TURN-022 Station 흐름 + TURN-023 블록 이름 · 블록 옮기기 · 흐름 표 한 번 + TURN-024 흐름 실행 기록(갈래 정지 · 반복 안 건너뜀 · 처음 N회 안내) + TURN-025 화면 실행 테스트의 시계 고정 + TURN-029 3D 시뮬레이션 화면(장면 설명 · 가동 조건 · WebGL 없음 안내)
npm run typecheck     # tsc --noEmit
npm run gen:aml       # assets/aml/ecd-sample-library.aml + assets/visuals/(도식 SVG·사진·manifest) 재생성 (media-sources/ 필요)
npm run validate:aml  # 공식 CAEX 3.0 XSD 검사 (python3 + lxml). XSD는 배포에 미포함 → 직접 받아 standards/caex3.0/에 두기(AML-SUPPORT.md). 없으면 "NOT RUN" 안내 후 종료 코드 2 → 성공 실행 시 assets/aml/xsd-report.json 갱신
npm run gen:samples   # samples/*.ecd.json, samples/aml/*.aml 재생성
npm run build         # tsc + vite build(단일 파일) → release/equipment-concept-designer.html
npm run package:src   # release/ 의 src·verification·assets ZIP 생성 (Python 필요, ZIP은 git에 커밋하지 않음 — 재생성 가능)
# 선택(기록용): headless Chrome 자동 확인 스크립트 (Chrome + puppeteer-core 필요, 프로젝트 의존성 아님, ECD_ROOT/CHROME 환경변수)
npm i --no-save puppeteer-core@23 && node scripts/browser-check.mjs
```
AML을 수정했다면 (XSD를 직접 받은 뒤) `validate:aml` → `build` 순서로 실행해야 앱의 “XSD 통과” 표시가 유지됩니다(해시 불일치 시 앱은 “미검증”으로 표시). Node 20+ 권장 (작성 환경 Node 24.22.1, npm 11.21.1), Python 3 + lxml(XSD 검사용).

## 구조
```
assets/aml/            ecd-sample-library.aml (14종, CAEX 3.0 — 앱 에셋의 원본), xsd-report.json
assets/visuals/        schematic/*.svg (도식 14), generated/*.jpg (AI 실사풍 14) + generated-manifest.json, photos/*.jpg (v0.2 실사진 12, 이력) + photo-manifest.json, ATTRIBUTION.md
standards/caex3.0/     SOURCE.md (공식 XSD 출처 URL·해시·직접 받는 방법) — XSD 원문은 재배포 조건 미확인으로 ZIP에 미포함
src/assets/            aml.ts (CAEX 3.0 subset reader/writer, 진단), library.ts (AML → 라이브러리, 가져오기/내보내기), visuals.ts (사진 해석·출처)
src/model/             types.ts factory.ts sample.ts commands.ts(addUnitFromTemplate 포함) history.ts validate.ts gaps.ts candidates.ts structuredText.ts exportPreview.ts
src/runtime/engine.ts  결정적 가상 시간 런타임 (Station 시퀀스)
src/runtime/group.ts   Substation 그룹 런타임 (복수 시퀀스, 공통 가상 시계, 충돌 사전 차단)
src/storage/           fileFormat.ts localStore.ts
src/ui/                App.tsx(단계 라우팅·왼쪽 탐색기) SubstationPanels.tsx(시퀀스 편집·그룹 실행) wizard.ts(단계 판정) Library.tsx(카드) Canvas.tsx Inspector.tsx Panels.tsx Symbols.tsx viewSettings.ts
samples/               5공정 예제 + 병렬 Substation 예제 + 손상/미지원/누락 참조 JSON, samples/aml/ (추가 에셋·구문 오류·2.15·자식 참조 누락)
scripts/               asset-seed.ts(AML 최초 생성 입력, 앱 미포함) gen-aml.ts gen-samples.ts validate-aml.py browser-check.mjs package-src.mjs copy-release.mjs
tests/                 engine, model, aml, group, visuals, theme-contrast, ui-smoke
.superdesign/          design-system.md (v0.3 화면 기준, 설계 제안) — init/ 덤프는 git 제외
docs/                  requirements-v0.1.md(원본 보존) requirements-v0.2.md requirements-v0.3.md(공개 통합본) UX-SCENARIOS.md WIREFRAMES.md REQUIREMENT-CHANGELOG.md verification/ screenshots/
```

## 화면 구성 (중앙 작업영역 = 현재 단계)
- **v0.3**: 상단 헤더 = 흰 타일 위 진홍 아이콘·제품명·버전·저장·JSON 내보내기·Undo/Redo. 그 아래 줄은 현재 Workspace · Project · rev · 저장 상태입니다. 프로젝트 만들기·열기·전환과 장비 구조 트리는 **왼쪽 탐색기**의 Workspace · Project 탭입니다(모든 단계 공통). 아래 v0.2 설명 중 “상단 프로젝트 탭”, 2·3단계의 “트리”는 왼쪽 Project 탭으로 읽으세요. 4단계에 「Substation 시퀀스」 하위 탭이 있다. 6단계의 「Substation 그룹」 전환은 TURN-022에서 뺐다. Substation 시퀀스는 Station 시퀀스의 Substation 단계로 실행한다.
- 상단: 흰 타일 위 진홍 아이콘, 제품명, 저장·내보내기·보기 설정, 현재 작업 정보 줄, 1~6 단계, 라이트/다크(저장값 A=라이트, B=다크. 예전 C는 보관이며 화면에서는 라이트로 보이고 사용자가 고르기 전까지 저장값을 지우지 않음). 헤더 마크는 `docs/turns/TURN-016.md`. 탭 아이콘은 `docs/turns/TURN-015.md`. 자세한 화면 표는 `docs/turns/TURN-003.md`. 탐색기 탭은 `docs/turns/TURN-008.md`
- 단계 바: 1~6 단계 버튼(각 단계 판정 배지: 필수 충족 / 필수 누락 / 재확인 필요 / 확인됨 ✓), 현재 단계·작업영역·목표, 「남은 항목」(필수 데이터 누락·가정값 존재·미정·선택 사항 미확보·사람 확인 필요 구분, ‘편집으로 이동’), ◀ 이전 / 다음 ▶
- 1 입력·에셋 선택: **에셋 라이브러리 카드**(검색·분류·도식/실사진·AML 번들/가져옴·XSD 상태 배지) + 카드 상세(AML 파일·SUC 경로·RoleClass·CAEX 버전·속성·포트·Action·템플릿 자식/링크/규칙·사진 출처/라이선스/대표 범위) + 「프로젝트에 추가」(상세 보기와 분리) + AML 가져오기/내보내기 + AML 로드 상태 / 하위 탭 입력 후보표(F1)
- 2 배치·연결: 툴바(선택/이동·물류/신호 연결·정렬·배치(간격·크기·겹침)·삭제·도식/실사진·레이어·줌) + 팔레트(14종 + 빈 유닛) + 탭(카드 보드 | 도면 도식) + 속성 패널. 장비 구조 트리는 왼쪽 Project 탭.
- 3 속성·Action: Unit/Device 트리 + 속성/신호/포지션/Action/정의 체크 편집기 + Unit 제공 능력표 + 이 단계 남은 항목
- 4 자재·시퀀스: 시퀀스 Draft(F5) / 자재·Flow(F4) / SFC 미리보기
- 5 점검: Gap(F6) / 진단·저장·AML / Export 미리보기(F8) / Evolution Lab(F7, 미구현 안내)
- 6 실행·저장: 실행 컨트롤 + Canvas + 실행 상태·로그 + 저장·시뮬·실행 전 검사 상태(별도 배지)
- 단계 이동·도식/사진 토글·테마·탐색기 탭·배치·연결 탭은 UserView(`ecd.v1.userView`)에만 저장되며 프로젝트 파일에 들어가지 않습니다. 다시 열면 마지막 단계로 복원되고 판정은 현재 데이터로 다시 계산합니다(실행 상태는 복원하지 않음).

## 시제품 런타임 규칙 (가정 — 확정 요구 아님)
- 가상 시간 정수 ms. 화면 속도(0.25~4x)는 재생 속도일 뿐 결과에 영향 없음. 같은 입력이면 dt 분할과 무관하게 같은 결과.
- `sequence.flow` 가 없으면 순차 단계만 돈다(5공정 예제 · 0.2.x 파일). 있으면 그 트리를 따른다. 단계 시작 시 진입·pre 조건 검사 → 불충족이면 대기하지 않고 즉시 `PRE_UNMET` 오류.
- 분기(`BRANCH_TAKEN`)는 도달한 순간의 신호 · 자재 상태로 한 번 판정하고, 안 간 쪽은 건너뜀이다. 병렬은 갈래가 겹쳐 돌고 모두 끝난 시각에 `PAR_JOIN` 이다. 갈래 사이 기다리기는 없다. 반복은 회차마다 `LOOP_ITER`. 재시도는 본문 뒤 조건이 거짓이고 횟수가 남으면 `RETRY`, 최대 2회를 써도 거짓이면 `RETRY_EXHAUSTED` 경고 후 다음으로 간다. 읽기 결과 신호를 조건으로 쓰는 분기 · 재시도가 있으면 결과 실패는 `READ_FAILED` 로 멈추지 않고 결과 신호를 거짓으로 둔다. 없으면 지금처럼 `READ_FAILED`. 한 갈래의 `PRE_UNMET` · `TIMEOUT` · `POST_UNMET` · `READ_FAILED` · `CAPACITY_FULL` 은 전체 정지다.
- 병렬 갈래와 Substation 단계의 시퀀스끼리는, 같은 Device를 쓰거나 자재를 다루는 쪽이 둘이면 실행 전에 `DEVICE_CONFLICT` · `SHARED_MATERIAL_CONFLICT` 로 막는다. 병렬 안의 병렬과 Substation 단계는 두지 않는다.
- 센서 신호(`role === 'sensor'`)는 자재가 그 신호가 속한 Device의 Unit에 있으면 ON, 아니면 OFF. 실행 초기 상태와 자재 위치가 커밋된 직후에 다시 계산하고, 사전조건을 평가하기 전에 최신 값이어야 한다. 값이 바뀌면 로그 `SENSOR_ON` / `SENSOR_OFF`(Device 이름 · 신호 이름). 규칙 `seq-runtime/0.3.1`.
- 시작 시 명령 Signal ON, 완료 Signal OFF. (시작+동작 시간)에 완료 Signal ON → post 조건 검사(임시 상태 기준) → 통과 시에만 자재 위치/상태/잡음 커밋.
- 완료가 타임아웃 시각과 같으면 성공(경계 규칙 가정). 타임아웃 도달 시 `TIMEOUT` 오류, 이후 단계 통과 안 함.
- 완료 시 같은 Device의 다른 완료 Signal은 OFF (상승/하강처럼 배타 상태로 가정).
- 일시정지 중 가상 시간 동결. 초기화 = 실행 시작 스냅샷의 초기 조건 복원 (Undo와 별개).
- 실행 중·일시정지 중 모델 편집·Undo 차단. 선택·테마·레이어·줌은 허용. 모델 편집 시 이전 실행 결과는 지워짐.
- 실행 준비 검사: 완료 Signal·동작 시간·타임아웃·수용 개수가 미정이거나 “미정 조건”이 있으면 실행 차단 (임의 true 금지). 자재 정의는 1개만.
- 검증용 오류 주입: “완료 신호 미발생”, “바코드 읽기 결과 실패”(실행 상태 탭). 결과 실패는 “처음 N회만”을 비우면 항상 실패하고, 숫자를 넣으면 그 횟수만 실패한 뒤 성공한다.

## Substation 그룹 런타임 규칙 (v0.3 — 설계 제안, 사용자 확정 아님, `group-runtime/0.2.0`)
화면의 그룹 실행 단추는 없다. 아래 규칙은 Station 시퀀스의 Substation 단계와, 남겨 둔 그룹 런타임(`src/runtime/group.ts`, 편집 화면의 실행 전 검사와 기존 테스트)이 같이 쓴다.
- 한 Substation의 시퀀스들이 한 묶음으로 같은 가상 시계(정수 ms)를 씀. 같은 시각의 이벤트는 시퀀스 목록 순서대로 처리(동률 규칙 임시), dt 분할과 무관하게 같은 결과.
- 실행 전 차단: 시퀀스 없음 / 단계 없음 / 다른 Substation Device / 완료 Signal·시간·타임아웃·수용 개수 미정 / 미정 조건 / **DEVICE_CONFLICT**(같은 Device를 두 시퀀스가 사용) / **SHARED_MATERIAL_CONFLICT**(자재를 다루는 시퀀스가 2개 이상).
- 다른 시퀀스의 진행을 기다리는 조건은 지원하지 않음 — 조건 불충족이면 기존과 같이 즉시 PRE_UNMET. 센서 신호는 Station 실행과 같은 Unit 규칙을 쓴다.
- 오류(PRE_UNMET/TIMEOUT/POST_UNMET/READ_FAILED/CAPACITY_FULL) 1건이면 묶음 전체 정지(나머지는 ‘그룹 정지’). 일시정지 = 전체 동결, 재개 = 남은 시간부터, 초기화 = 시작 스냅샷의 초기 조건. 그룹 실행 상태는 저장하지 않으며 다시 열어도 자동 재개하지 않음.
- 그룹 실행 중에도 모델 편집·Undo 차단, Station 시퀀스 실행과 동시에 돌리지 않음.

## 알려진 한계
- v0.3 화면은 부모 에이전트의 실제 브라우저 GUI 검수(1920×1200, 사람 검수 아님) 일부 항목만 통과 기록이 있습니다. 1280×800은 미검증입니다(창 크기 변경 불가). TURN-004는 헤더 색만 1280×800 라이트·다크 스크린샷으로 보았고, 사람 검수는 아직입니다.
- AI 이미지의 방향·정렬은 생성 후 에이전트가 도식과 대조했을 뿐 사람 검수 전입니다. 세부 형상(포트 위치 등)은 도식과 다를 수 있으며, 포트 앵커는 항상 모델 좌표를 씁니다.
- 갈래만 일시정지, 여러 Substation을 한 단계 밖에서 동시에 실행, 갈래 사이 대기/동기화, 자원 예약은 미구현([미정], `AMBIGUITIES.md` A41~A48). Substation 단계 하나 안에서는 그 Unit의 시퀀스가 함께 돈다.
- 실제 브라우저 GUI 검수는 v0.1 빌드 일부, v0.2 빌드 일부 항목(Linux Chrome, 6절)만 수행됨. 그 외 v0.2 항목은 headless 자동 조작 결과만 (`BROWSER-VERIFICATION.md`).
- 2단계 Canvas: 가로 스크롤 전에는 오른쪽 끝 유닛이 오른쪽 속성 패널 뒤에 가려짐(스크롤하면 보임, GUI 검수 관찰, 미수정).
- **14종 에셋 모두가 실행 시나리오에서 동작한다는 보장은 없습니다.** 실행으로 확인된 것은 기본 5공정 모델뿐입니다. 자동 테스트는 순수 로직 + AML/XSD + jsdom 렌더 스모크 + 테마 대비 계산.
- 대형 캔버스 성능, 모바일은 검토하지 않았습니다. 키보드: 탐색기 트리·프로젝트 목록·카드는 Tab/Enter로 선택 가능(v0.3), Canvas의 키보드 배치·이동은 미지원. 접근성 인증 아님.
- 자재 정의 여러 종류, 캐리어 적재 관계 편집, 배경 이미지, F1 문서/USD 추출, F7, F8 Aurora Core 실제 형식 Export · 전송은 미구현입니다(같은 자재의 여러 개체 투입은 TURN-040, 초안 형식 Export 파일은 TURN-041). F8 미리보기와 AML 내보내기는 흐름 트리를 그리지 않습니다. 한 시퀀스 안의 분기 · 병렬 · 고정 반복 · 재시도는 TURN-022입니다.
- AML은 이 앱의 subset만 해석합니다(`AML-SUPPORT.md`). 일반 AutomationML 도구와의 상호 운용(AutomationML Editor 열기 등)은 검증하지 않았습니다.
- 센서 신호는 자재가 그 Unit에 있을 때 켜집니다. 자재가 다른 Unit·배출·없음이면 꺼지고, 그때 템플릿 Action의 사전조건은 `PRE_UNMET`입니다. 문구에는 신호 이름과 「센서는 자재가 이 Unit 에 있을 때 켜집니다」가 나옵니다. 센서마다 감지 대상을 고르거나, 리밋 스위치를 축 위치로 켜지는 않습니다(`AMBIGUITIES.md` A33).
- 새로 놓은 Device의 기본 이름이 에셋 이름(예: “실린더”)이라 여러 개일 때 구별이 어려움(유닛 템플릿 자식은 `PSH-S6-PSH1`처럼 접두어 이름, ID는 항상 고유).
- 웹/WPF 동등성(X01~X08)은 WPF가 없으므로 미검증입니다.
