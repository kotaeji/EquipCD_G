// TURN-056 screen help. Sentences are shortened from docs/user-manual/USER-MANUAL.ko.md.
// manual.section + manual.title must match a heading in that file. No links: the release is one HTML file.
import type { StepId } from './wizard';

export interface ManualRef { section: string; title: string }
export interface HelpTopic {
  id: string;
  title: string;
  does: string;
  tasks: string[];
  stuck: string[];
  manual: ManualRef;
}

function topic(id: string, title: string, does: string, tasks: string[], stuck: string[], section: string, manualTitle: string): HelpTopic {
  return { id, title, does, tasks, stuck, manual: { section, title: manualTitle } };
}

/** Drop a trailing feature-id parenthesis. The stored title still matches the manual heading. */
export function manualVisibleTitle(title: string): string {
  return title.replace(/\s+\([^)]*`[^)]*\)\s*$/, '').trim();
}

/** What the help dock shows: section number and heading, without feature ids or backticks. */
export function manualLine(manual: ManualRef): string {
  return `매뉴얼 ${manual.section} ${manualVisibleTitle(manual.title)}`;
}

const M = {
  home: ['2.3', '처음 열면'],
  workspace: ['4.1', 'Workspace 탭 (`FL-05`, `S01`)'],
  project: ['4.2', 'Project 탭의 목록 (`FL-06`, `FL-07`, `S02`)'],
  cards: ['5.1', '라이브러리 카드 (`FL-20`, `S10`)'],
  detail: ['5.2', '카드 상세와 프로젝트에 추가 (`FL-21`, `S11`)'],
  aml: ['5.3', 'AML 입출력 (`FL-23`, `S12`)'],
  input: ['5.4', '입력 후보표 (`FL-25`, `S13`)'],
  guide: ['16.1', '안내 화면만 있음 (📄)'],
  board: ['6.1', '팔레트와 두 탭 (`FL-30`, `FL-31`)'],
  diagram: ['6.2', '도면 도식 (`FL-32`, `FL-34`)'],
  attr: ['7', '3단계 속성·Action'],
  seq: ['8.1', 'Station 시퀀스 (`FL-51`, `S41`)'],
  mat: ['8.2', '자재 (`FL-50`, `S40`)'],
  sub: ['8.3', 'Substation 시퀀스 (`FL-52`, `S42`)'],
  sfc: ['8.4', 'SFC 미리보기 (`FL-53`, `S43`)'],
  gap: ['9.1', 'Gap (`FL-60`, `S50`)'],
  diag: ['9.2', '진단·저장 (`FL-61`, `S51`)'],
  exp: ['9.3', 'Export 미리보기 (`FL-62`, `S52`)'],
  run: ['10.1', 'Station 시퀀스 (`FL-70`, `FL-73`, `S60`)'],
  blocked: ['10.3', '실행이 막힐 때 (`FL-72`, `S62`)'],
  view3d: ['10.4', '3D 보기 (`FL-75`, `S60`)'],
} as const;

export const HELP_TOPICS: HelpTopic[] = [
  topic('home', '시작 화면',
    '이 브라우저의 Workspace에서 새 설계를 시작하거나, 저장된 설계를 이어갑니다. 저장이 없으면 5공정 예제가 이미 열려 있습니다.',
    [
      '「빈 프로젝트 만들기」로 자료 없이 1단계부터 시작합니다.',
      '「뼈대부터」는 Unit 수, 템플릿, 물류 연결을 정해 2단계에서 엽니다. 시퀀스와 자재는 만들지 않습니다.',
      '예제 카드의 「열기」는 그 예제 사본을 새 탭으로 엽니다.',
      '「시작하기」는 이미 열린 프로젝트의 1단계로 갑니다. 사본을 만들지 않습니다.',
      '아래 「JSON 가져오기」는 원본 파일을 덮어쓰지 않고 새 탭으로 엽니다.',
      '저장된 프로젝트가 없으면 맨 위의 둘러보기로 1~6단계가 하는 일을 볼 수 있습니다.',
    ],
    [
      '예제 카드의 「열기」는 사본을 하나 더 만듭니다. 이미 열린 예제를 쓰려면 「시작하기」를 누릅니다.',
      '다른 PC의 설계는 브라우저 저장에 없습니다. 「JSON 가져오기」로 파일을 엽니다.',
    ],
    ...M.home),
  topic('workspace', 'Workspace 탭',
    'Workspace는 이 브라우저 저장소 안의 프로젝트 묶음입니다. 폴더가 아니고, 다른 PC나 브라우저와 공유되지 않습니다.',
    [
      '「+ 새 Workspace」로 이름을 만듭니다. 같은 범위에서 대소문자 무시로 중복될 수 없습니다.',
      '카드의 「전환」으로 그 Workspace로 이동합니다. 열린 탭은 닫힙니다.',
      '「이름 변경」「삭제」로 고칩니다. 저장된 프로젝트가 없는 Workspace만 지울 수 있습니다.',
      '「작업 시작 화면」은 가운데를 시작 화면으로 되돌립니다. 열린 프로젝트는 바뀌지 않습니다.',
    ],
    [
      '저장하지 않은 편집이 있으면 전환이 막힙니다. 먼저 저장하거나 Project 탭에서 탭을 닫습니다.',
      '실행 중이거나 일시정지면 전환이 막힙니다. 먼저 「초기화」합니다.',
      '「파일 묶음」은 안내만 있습니다. 묶음 파일로 내보내지 않습니다.',
    ],
    ...M.workspace),
  topic('project', 'Project 탭',
    '이 Workspace에서 열린 프로젝트와 저장된 프로젝트를 고릅니다. 목록 아래 장비 구조에서 Station, Substation, Device를 고릅니다.',
    [
      '줄을 누르면 열린 프로젝트는 그쪽으로 바뀌고, 닫힌 저장 프로젝트는 열립니다.',
      '「+」에서 빈 프로젝트, 예제, JSON 가져오기, 프로젝트 파일을 고릅니다.',
      '줄의 「…」에서 전환, 이름 변경, 탭 닫기, 삭제를 고릅니다. 탭을 닫아도 저장 데이터는 남습니다.',
      '장비 구조의 줄을 누르면 선택됩니다. 접기는 모델을 바꾸지 않고 rev도 오르지 않습니다.',
    ],
    [
      '저장 안 된 탭을 닫으면 「저장하지 않은 변경」이 열립니다. 저장에 성공한 뒤에만 「저장 후 닫기」가 닫습니다.',
      '열린 프로젝트는 「삭제」가 비활성입니다. 먼저 탭을 닫습니다.',
    ],
    ...M.project),
  topic('library:cards', '1단계 · 에셋 라이브러리',
    '쓸 에셋 카드를 고릅니다. 카드를 누르는 것만으로는 프로젝트가 바뀌지 않고, 오른쪽 상세가 열립니다.',
    [
      '검색칸에 이름, 키, ID를 넣고, 분류는 「모든 분류」에서 고릅니다.',
      '카드를 눌러 오른쪽에서 정의와 넣을 Unit을 확인합니다.',
      '「도식」과 「실사풍(AI)」은 그림만 바꿉니다. 모델, rev, 배치, 선택은 그대로입니다.',
      '「AML 가져오기」로 다른 AML을 더하고, 「AML 라이브러리 내보내기」로 라이브러리 파일을 받습니다.',
    ],
    [
      'Device를 넣으려면 Unit이 있어야 합니다. 없으면 2단계에서 빈 유닛이나 유닛 템플릿을 먼저 놓습니다.',
      '오류가 있는 AML 정의는 라이브러리에 들어가지 않고, 이미 열린 프로젝트는 바뀌지 않습니다.',
    ],
    ...M.cards),
  topic('library:detail', '1단계 · 카드 상세',
    '고른 카드의 AML 파일, 속성, 포트, Action을 더 봅니다. 상세를 보는 것과 프로젝트에 넣는 것은 나뉩니다.',
    [
      'Device 카드는 「넣을 Unit」에서 Substation을 고른 뒤 「프로젝트에 추가」를 누릅니다.',
      '유닛 템플릿은 Unit 선택이 필요 없습니다. 추가하면 새 ID의 Unit과 그 안의 Device가 생깁니다.',
      '「목록으로」는 카드 목록으로 돌아갑니다. 모델을 바꾸지 않습니다.',
    ],
    [
      'Unit이 없으면 「프로젝트에 추가」가 비활성입니다. 2단계에서 빈 유닛을 먼저 놓습니다.',
      '추가할 때마다 ID가 새로 나옵니다. 같은 카드를 다시 넣어도 이전 것을 덮어쓰지 않습니다.',
    ],
    ...M.detail),
  topic('library:input', '1단계 · 입력 후보표',
    '이름과 종류를 적어 후보로 둡니다. 후보는 확인 전에 모델에 들어가지 않습니다.',
    [
      '이름과 종류를 적고 「+ 후보표에 추가」를 누릅니다.',
      '줄의 「확인」 또는 「거절」을 누릅니다.',
      '「반영 미리보기」로 어떤 줄이 들어갈지 봅니다.',
      '「확인된 항목 Canvas에 반영」을 눌러야 배치에 들어갑니다.',
    ],
    [
      '직접 입력한 후보만 됩니다. PDF, DWG, XLSX에서 뽑지 않습니다.',
      '확인하지 않은 줄은 프로젝트에 들어가지 않습니다.',
    ],
    ...M.input),
  topic('library:aml', '1단계 · AML 입출력',
    '가져온 AML의 검사 결과를 네 줄로 봅니다. XML 문법, CAEX 구조, 앱 부분집합, 공식 XSD입니다.',
    [
      '결과 줄에서 XML, CAEX, 부분집합, XSD 기록을 읽습니다.',
      '같은 단계의 「AML 가져오기」로 다른 AML을 더합니다.',
      '「AML 라이브러리 내보내기」로 라이브러리를 파일로 받습니다.',
      '후보로 옮기려면 이 화면의 안내를 따라 입력 후보표로 갑니다.',
    ],
    [
      '브라우저 안에서 XSD를 다시 돌리지는 않습니다. 건너뛴 검사를 통과로 세지 않습니다.',
      '오류가 있는 정의는 라이브러리에 넣지 않습니다. 범위는 매뉴얼 14절입니다.',
    ],
    ...M.aml),
  topic('library:extract', '1단계 · 자료 입력',
    '자료 파일에서 뽑는 화면은 안내만 있습니다. PDF, DWG, XLSX, USD는 추출되지 않습니다.',
    [
      '화면의 「준비 중」 안내를 읽습니다. 이 탭은 파일을 읽지 않습니다.',
      '「자료 선택 예시」는 눌리지 않습니다.',
      '후보를 직접 넣으려면 「입력 후보표」 탭으로 가서 이름과 종류를 적습니다.',
    ],
    [
      '이 화면의 단추로 도면이나 표를 불러오지 못합니다.',
      '이미 가진 AML은 1단계 「AML 가져오기」로 넣습니다.',
    ],
    ...M.guide),
  topic('canvas:board', '2단계 · 카드 보드',
    '팔레트에서 Unit과 Device를 카드로 놓습니다. 카드는 실제 Substation과 Device이고, 좌표와 포트는 도면 도식에서 움직입니다.',
    [
      '팔레트의 빈 유닛이나 유닛 템플릿을 카드 보드로 끌어 Substation을 만듭니다.',
      'Device는 그 Substation 카드 위로 끌어 놓습니다. 카드 밖에는 놓이지 않습니다.',
      '「물류 연결」을 누르고 Unit을 누른 뒤 다른 Unit을 눌러 잇습니다.',
      '다른 Substation 카드로 Device를 끌면 소속 변경을 확인받습니다.',
      '아래 「도면 도식」 탭에서 좌표와 포트를 움직입니다.',
    ],
    [
      '「신호 연결」은 이 탭의 카드가 아니라 도면 도식의 포트에서 합니다. 누르면 그 탭으로 바뀝니다.',
      '카드가 한 화면에 다 안 들어오면 카드 줄을 가로로 움직입니다.',
    ],
    ...M.board),
  topic('canvas:diagram', '2단계 · 도면 도식',
    'Substation과 Device의 자리, 포트, 물류·신호 선을 움직입니다. 고르기만으로는 rev가 바뀌지 않습니다.',
    [
      '몸체를 끌어 장치를 옮깁니다. 포트를 누르면 장치는 움직이지 않습니다.',
      '출력 포트를 입력 포트로 끌어 신호 연결을 잇거나, 「신호 연결」을 누르고 포트를 두 번 누릅니다.',
      '「물류 연결」을 누르고 Unit을 두 번 눌러 Unit에서 Unit으로 잇습니다.',
      '「선택/이동」에서 Unit 오른쪽 가운데 손잡이를 다른 Unit으로 끌어 물류 연결을 잇습니다. 몸체를 끄는 이동과 다릅니다.',
      'Substation 하나를 고르고 「자동 정렬」로 그 안의 Device만 다시 놓습니다.',
    ],
    [
      '입력 포트에서 신호를 시작하면 「출력(out) 포트에서 시작하세요」가 나오고 아무것도 바뀌지 않습니다.',
      '빈 곳에 놓거나 Esc를 누르면 연결 시작이 취소됩니다.',
      '실행 중에는 이동, 연결, 삭제, 정렬이 막힙니다. 「초기화」한 뒤에 고칩니다.',
    ],
    ...M.diagram),
  topic('attributes:props', '3단계 · 장치 속성',
    '고른 Device의 이름, 소속 Substation, 속성을 고칩니다. 빈 값은 미정으로 남고, 앱이 임의로 채우지 않습니다.',
    [
      '왼쪽 트리나 이 화면에서 Device를 고릅니다. 없으면 프로젝트의 첫 Device가 열립니다.',
      '이름과 소속, 숫자 속성을 고칩니다. 숫자가 가정이면 「가정」이 붙습니다.',
      '숫자가 아니거나, 음수가 될 수 없는 값의 음수는 칸에 남고 모델에 들어가지 않습니다.',
      '「Action 편집」과 「신호·포지션」으로 같은 단계의 다른 칸을 엽니다.',
    ],
    [
      '빈 칸은 미정입니다. 실행에 필요하면 5단계 Gap과 6단계 실행 전 검사에 남습니다.',
      '실행 중에는 이 값들이 잠깁니다. 「초기화」한 뒤에 고칩니다.',
    ],
    ...M.attr),
  topic('attributes:signals', '3단계 · 신호',
    '고른 Device의 신호 방향과 역할, 포지션 값을 봅니다. 주소가 비어 있으면 미정이고 실제 장비 주소가 아닙니다.',
    [
      '신호 표에서 이름, 방향, 역할을 읽습니다.',
      '주소 칸이 비어 있으면 「실제 장비 주소 아님」으로 남습니다. 앱이 주소를 만들지 않습니다.',
      '옆 칸에서 포지션 이름과 값을 봅니다.',
      '「Action으로 복귀」로 동작 시간과 완료 신호를 고칩니다.',
    ],
    [
      '실주소와 실측 역매핑은 하지 않습니다. 주소가 없어도 개념 신호로 논리 실행은 할 수 있습니다.',
      '쓰이고 있는 신호를 지우면 확인 뒤에 조건이 미정으로 풀립니다.',
    ],
    ...M.attr),
  topic('attributes:positions', '3단계 · 포지션',
    '고른 Device의 포지션 값을 봅니다. 단위와 신호 참조는 보존하고, 실주소는 채우지 않습니다.',
    [
      '포지션 이름과 값, 단위를 읽습니다. 값이 없으면 미정입니다.',
      '같은 화면의 신호 표에서 방향과 역할을 함께 봅니다.',
      '단계의 목표로 쓰이던 포지션을 지우면 그 참조가 비워집니다.',
      '「Action으로 복귀」로 동작 정의로 돌아갑니다.',
    ],
    [
      '포지션이 없으면 「포지션 없음」입니다. 앱이 예시 포지션을 만들지 않습니다.',
      '실행 중에는 값이 잠깁니다.',
    ],
    ...M.attr),
  topic('attributes:actions', '3단계 · Action',
    '동작 시간, 타임아웃, 명령 신호, 완료 신호를 봅니다. 「시퀀스 끝에 추가」는 그 Action을 Station 시퀀스 끝에 넣습니다.',
    [
      '동작 시간과 타임아웃 칸에 숫자를 넣습니다. 빈 칸은 미정입니다.',
      '명령 신호와 완료 신호가 지정됐는지 읽습니다. 완료 신호가 없으면 실행이 막힙니다.',
      '「시퀀스 끝에 추가」로 이 Action을 4단계 Station 시퀀스 끝에 넣습니다.',
      '옆 「정의 체크」에서 완료 신호, 시간, 타임아웃, 실제 주소가 있는지를 봅니다.',
    ],
    [
      '타임아웃이 비어 있으면 실행 전 검사에 남습니다. 앱이 시간을 채우지 않습니다.',
      '이 Device에 Action이 없으면 아래 접는 칸에서 추가합니다.',
    ],
    ...M.attr),
  topic('attributes:check', '3단계 · 정의 체크',
    '완료 신호, 시간, 타임아웃, 실제 주소가 있는지를 적습니다. Interlock 후보는 사람이 확인하고, 자동으로 확정되지 않습니다.',
    [
      '정의 체크 목록에서 완료 신호, 동작 시간, 타임아웃, 실제 주소를 읽습니다.',
      '아래 접는 칸에서 이 Device의 Action 목록과 Interlock 후보를 엽니다.',
      'Interlock마다 「막을 Action」과 허용 조건 또는 동시 금지를 정합니다.',
      '「확인」한 것 중 규칙이 있는 것만 6단계 실행에 적용됩니다.',
    ],
    [
      '확인했지만 규칙이 없으면 실행에 적용되지 않고, 그 안내가 실행 전 검사에 나옵니다.',
      '자동 안전 승인은 없습니다. 이 앱은 논리 시뮬레이션입니다.',
    ],
    ...M.attr),
  topic('sequence:sequence', '4단계 · Station 시퀀스',
    'Station 전체의 순서를 정합니다. 흐름 표에서 단계와 분기·병렬·반복·재시도를 만들고, 블록이 없으면 위에서 아래로 돕니다.',
    [
      '「Action 추가」는 프로젝트의 첫 Action을 단계로 넣습니다. 다른 Action은 접는 칸에서 고릅니다.',
      '이어진 줄을 고르고 분기, 병렬, 반복, 재시도로 묶습니다. 한 번이 rev +1입니다.',
      '「위로」「아래로」로 같은 갈래 안에서 옮기고, 「밖으로」로 한 겹 뺍니다.',
      '「Substation 시퀀스 넣기」는 고른 Substation의 시퀀스 전부를 한 줄로 흐름 끝에 넣습니다.',
    ],
    [
      '흐름에 넣지 않은 단계는 실행되지 않고 5단계 Gap에 「흐름에 없음」으로 나옵니다.',
      '병렬 갈래 안에 병렬이나 Substation 단계를 또 넣으면 거부됩니다.',
      '구조화 문장은 순차 단계만 만듭니다. 자연어를 해석하지 않습니다.',
    ],
    ...M.seq),
  topic('sequence:subseq', '4단계 · Substation 시퀀스',
    '한 Substation 안의 시퀀스를 만듭니다. Station 시퀀스의 Substation 단계가 이 시퀀스들을 한 시계로 함께 실행합니다.',
    [
      'Substation을 고릅니다.',
      '「+ 시퀀스 추가」로 시퀀스를 늘리고, 이름 변경과 「삭제」로 정리합니다.',
      '「단계 추가」로 그 Substation의 Action을 넣고, 위·아래와 삭제로 순서를 바꿉니다.',
      '4단계 Station 시퀀스에서 「Substation 시퀀스 넣기」로 이 시퀀스들을 한 줄로 부릅니다.',
    ],
    [
      '이 시퀀스 안에는 분기, 병렬, 반복을 넣지 못합니다.',
      '6단계에 따로 누르는 그룹 실행은 없습니다. Station 시퀀스에 넣은 줄로만 돕니다.',
    ],
    ...M.sub),
  topic('sequence:material', '4단계 · 자재',
    '자재 하나의 이름, 투입 개수, 초기 위치, 초기 상태, 경로를 정합니다. 정의는 하나이고, 투입 개수만큼 실행할 때 이어서 넣습니다.',
    [
      '자재가 없으면 「자재 추가」를 누릅니다. 초기 위치는 첫 Substation, 초기 상태는 「대기」입니다.',
      '투입 개수와 투입 간격을 적습니다. 개수가 2 이상이면 간격을 정해야 합니다.',
      '초기 위치와 Unit 경로를 확인합니다. 크기와 무게의 나머지 편집은 접는 칸에 있습니다.',
      '6단계 「가동 조건」의 투입 칸에서도 같은 개수와 간격을 바꿉니다.',
    ],
    [
      '투입 간격이 미정이면 개수 2 이상은 실행 전 검사가 막습니다.',
      '분기·병렬·반복·재시도·Substation 단계가 있는 흐름은 투입 개수 2 이상을 실행하지 않습니다.',
      '자재 정의를 여러 종류 두거나 캐리어에 싣는 편집은 없습니다.',
    ],
    ...M.mat),
  topic('sequence:sfc', '4단계 · SFC 미리보기',
    'Station 흐름을 읽기 전용 그림으로 봅니다. 값을 고치지 않고, 길면 그 칸만 스크롤합니다.',
    [
      '분기, 병렬, 반복, 재시도, Substation 단계가 그림으로 나뉘어 있는지 봅니다.',
      '블록 제목은 Station 시퀀스 흐름 표와 같은 글자입니다.',
      '고치려면 「Station 시퀀스」 탭으로 돌아갑니다.',
    ],
    [
      '이 탭에서 단계를 옮기거나 이름을 바꾸지 못합니다.',
      '줄이지 않고 그리므로 긴 흐름은 칸 안에서 스크롤합니다.',
    ],
    ...M.sfc),
  topic('sequence:extend', '4단계 · 누락 편집 확장',
    '후속 단계 편집과 다중 자재 확장은 안내만 있습니다. 이 탭의 단추는 동작하지 않습니다.',
    [
      '「준비 중」 안내를 읽습니다.',
      '단계 순서는 「Station 시퀀스」 탭에서 고칩니다.',
      '자재 하나의 투입 개수는 「자재」 탭에서 고칩니다.',
    ],
    [
      '이 화면에서 빠진 편집을 채우지 못합니다.',
      '예시 데이터를 만든 것처럼 보여 주지 않습니다.',
    ],
    ...M.guide),
  topic('check:gap', '5단계 · Gap',
    '지금 모델의 차단, 미정, 사람 확인 항목을 봅니다. 근거가 부족하면 문제 없음이 아니라 비교 불가로 둡니다.',
    [
      '「재분석」은 지금 모델로 다시 계산합니다.',
      '「차단 항목만」「사람 확인 필요」「숨긴 항목」으로 거릅니다.',
      '「수정 이동」은 그 항목을 고치는 단계로 갑니다. 모델은 바꾸지 않습니다.',
      '목록 맨 위 「실행 결과」는 마지막으로 끝난 실행에서 나온 Gap입니다. 실행 전에는 안내만 있습니다.',
    ],
    [
      '안전 항목은 자동으로 끝나지 않습니다. 접는 칸에서 사람이 숨기거나 확인으로 표시합니다.',
      '실행한 뒤 모델을 고치면 「이전 rev의 실행 결과」가 붙습니다. 다시 실행하면 바뀝니다.',
    ],
    ...M.gap),
  topic('check:diag', '5단계 · 진단과 저장',
    '참조가 빠진 곳, 저장소 상태, 거부된 파일의 격리 보관함을 봅니다. 저장에 실패해도 모델은 그대로입니다.',
    [
      '진단 줄에서 빠진 참조와 저장소 상태를 읽습니다.',
      '격리된 원본은 내려받습니다. 거절된 가져오기 파일이 여기 남습니다.',
      '저장소를 쓸 수 없으면 메모리 전용입니다. 헤더 「내보내기」로 파일을 남깁니다.',
    ],
    [
      '저장 실패는 모델을 되돌리지 않습니다. 알림을 읽고 내보내기로 파일을 받습니다.',
      '깨진 임시 저장도 격리 보관함으로 갑니다. 복구를 권하지 않습니다.',
    ],
    ...M.diag),
  topic('check:export', '5단계 · Export 미리보기',
    '초안 형식 파일을 만들고, 미정·가정 항목을 봅니다. Aurora Core로 보내는 단추는 눌리지 않습니다.',
    [
      '미정·가정 개수와 목록을 읽습니다.',
      '「미정 N · 가정 M 을 표시한 채 내보내기」를 체크하면 「Export 파일 만들기」가 켜집니다.',
      '실행 전 검사를 통과한 모델만 파일을 만들 수 있습니다. 아니면 까닭과 이동 단추가 나옵니다.',
      '「Export 파일 검사」는 예전에 만든 파일과 지금 모델의 차이만 보여 주고, 모델은 바꾸지 않습니다.',
    ],
    [
      '파일에는 「초안 형식 — Aurora Core 가 바로 읽는 형식 아님」이라고 적혀 있습니다.',
      '「Core로 보내기」와 「Core 전송」은 눌리지 않습니다.',
      '자재와 확인되지 않은 Interlock은 제외 목록에 까닭과 함께 적힙니다.',
    ],
    ...M.exp),
  topic('check:lab', '5단계 · Evolution Lab',
    '변형, 평가, 후보 생성은 안내만 있습니다. 「평가 실행」은 눌리지 않습니다.',
    [
      '「준비 중」 안내를 읽습니다.',
      '점검 목록은 「Gap」 탭에서 봅니다.',
      '실행은 6단계 「실행」으로 합니다. 이 탭은 평가를 돌리지 않습니다.',
    ],
    [
      '이 화면에서 후보를 만들지 못합니다.',
      '예시 점수를 보여 주지 않습니다.',
    ],
    ...M.guide),
  topic('run:diagram', '6단계 · 도면 실행',
    'Station 시퀀스를 논리로 실행하고, 같은 화면에서 도면으로 봅니다. 배속은 화면 속도만 바꾸고 논리 결과는 같습니다.',
    [
      '「실행」으로 시작합니다. 「일시정지」「재개」「+0.1s」「초기화」「끝까지」로 가상 시간을 다룹니다.',
      '「도면 / 3D」는 가운데 캔버스만 바꿉니다. 실행과 선택은 유지됩니다.',
      '요약 띠에서 상태, 가상 시간, 사이클, 병목, Gap 건수를 읽습니다.',
      '오른쪽 「가동 조건」에서 배속, 준비 검사, 동작 시간, 타임아웃, 투입 개수를 봅니다.',
      '아래 「자세히」에서 실행 결과 요약, 실행 로그, 신호를 엽니다.',
    ],
    [
      '준비가 안 되면 제목이 「실행 차단과 수정」으로 바뀝니다. 이동 단추로 간 뒤 고치고 다시 실행합니다.',
      '실행 중이거나 일시정지면 편집과 실행 취소가 막힙니다. 「초기화」해야 고칠 수 있습니다.',
      '실행은 저장이 아닙니다. 헤더 「저장」은 따로 누릅니다.',
    ],
    ...M.run),
  topic('run:3d', '6단계 · 3D',
    '같은 실행을 3D로 봅니다. 도면과 가상 시간, 단계 기록은 하나이고, 3D에서 장치를 옮기거나 잇지는 못합니다.',
    [
      '「3D」를 고르면 가운데만 장면으로 바뀝니다. 「실행」「일시정지」「끝까지」는 도면일 때와 같습니다.',
      '끌면 회전, 오른쪽 단추나 Shift로 이동, 휠로 확대합니다. 「전체 보기」로 구역을 맞춥니다.',
      'Device를 누르면 왼쪽에 이름, 종류, 소속, 상태가 나옵니다.',
      '「가동 조건」의 「설비 동작」으로 부품 움직임을 끄면 표식만 남습니다.',
    ],
    [
      '3D를 그릴 수 없으면 「도면으로 보기」가 나옵니다. 실행 자체는 도면에서 그대로 됩니다.',
      '모양은 종류별 기본 도형입니다. CAD나 실제 설비 형상이 아닙니다.',
    ],
    ...M.view3d),
  topic('run:blocked', '6단계 · 실행 차단',
    '실행 전 검사에 걸리면 제목이 「실행 차단과 수정」으로 바뀝니다. 원인마다 코드와 이동 단추가 있습니다.',
    [
      '「수정 위치」 또는 「원인 확인」을 누릅니다. 이동은 화면만 바꿉니다.',
      '모델을 고친 뒤 「다시 검사」를 누르거나, 초기화한 뒤 다시 실행합니다.',
      'Interlock이 막으면 코드는 INTERLOCK_BLOCK이고, 「이동」은 3단계의 그 줄을 엽니다.',
      '사전조건이 안 맞으면 PRE_UNMET, 완료 신호가 없으면 TIMEOUT입니다.',
    ],
    [
      '이동 단추는 모델과 실행 취소를 바꾸지 않습니다. 고친 뒤에 다시 실행합니다.',
      '실행 중이면 먼저 「초기화」해야 편집이 돌아옵니다.',
    ],
    ...M.blocked),
];

const HELP_BY_ID: Record<string, HelpTopic> = Object.fromEntries(HELP_TOPICS.map((t) => [t.id, t]));

export function helpTopic(id: string): HelpTopic {
  return HELP_BY_ID[id] ?? HELP_TOPICS[0];
}

/** Tabs inside each wizard step. The test requires a topic for every id. */
export const STEP_TABS: Record<StepId, readonly string[]> = {
  library: ['cards', 'input', 'aml', 'extract'],
  canvas: ['board', 'diagram'],
  attributes: ['props', 'signals', 'positions', 'actions', 'check'],
  sequence: ['sequence', 'subseq', 'material', 'sfc', 'extend'],
  check: ['gap', 'diag', 'export', 'lab'],
  run: ['diagram', '3d'],
};

export const HELP_ROOT_IDS = ['home', 'workspace', 'project'] as const;

export interface HelpContext {
  scope: 'main' | 'explorer';
  home: boolean;
  explorer: 'workspace' | 'project';
  step: StepId;
  sub: string;
  layout: 'board' | 'diagram';
  right: string;
  runView: 'diagram' | '3d';
  runBlocked: boolean;
  libDetail: boolean;
}

export function resolveHelpId(ctx: HelpContext): string {
  if (ctx.scope === 'explorer') return ctx.explorer === 'workspace' ? 'workspace' : 'project';
  if (ctx.home) return 'home';
  if (ctx.step === 'library') {
    const sub = ctx.sub || 'cards';
    if ((sub === 'cards' || sub === '') && ctx.libDetail) return 'library:detail';
    return HELP_BY_ID[`library:${sub}`] ? `library:${sub}` : 'library:cards';
  }
  if (ctx.step === 'canvas') return ctx.layout === 'diagram' ? 'canvas:diagram' : 'canvas:board';
  if (ctx.step === 'attributes') {
    const id = `attributes:${ctx.right || 'props'}`;
    return HELP_BY_ID[id] ? id : 'attributes:props';
  }
  if (ctx.step === 'sequence') {
    const id = `sequence:${ctx.sub || 'sequence'}`;
    return HELP_BY_ID[id] ? id : 'sequence:sequence';
  }
  if (ctx.step === 'check') {
    const id = `check:${ctx.sub || 'gap'}`;
    return HELP_BY_ID[id] ? id : 'check:gap';
  }
  if (ctx.runBlocked) return 'run:blocked';
  return ctx.runView === '3d' ? 'run:3d' : 'run:diagram';
}
