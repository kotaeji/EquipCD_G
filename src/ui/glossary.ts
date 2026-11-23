// TURN-056 glossary. Lines that also appear in manual appendix B match that cell.
// One line each. The help panel lists these; titles and headers underline the same words.

export const GLOSSARY = {
  station: { label: 'Station', line: '장비 전체. 내부 이름은 Equipment. 프로젝트당 하나' },
  substation: { label: 'Substation', line: '구간. 내부 이름은 Unit' },
  unit: { label: 'Unit', line: 'Substation의 내부 이름. 화면의 Unit은 그 구간을 가리킨다.' },
  device: { label: 'Device', line: 'Substation 안의 실린더, 센서 등' },
  action: { label: 'Action', line: '명령 신호, 완료 신호, 동작 시간, 타임아웃을 가진 동작' },
  signal: { label: 'Signal', line: 'Device의 입력·출력. 명령, 완료, 조건에 쓰이고, 주소가 없으면 미정이며 실제 장비 주소가 아니다.' },
  position: { label: 'Position', line: 'Device의 위치 값. 주소가 비어 있으면 미정이고, 실제 장비 주소가 아니다.' },
  interlock: { label: 'Interlock', line: '사람이 확인하는 동작 제한. 확인했고 규칙이 있는 것만 실행에 적용되며, 자동으로 안전 승인되지 않는다.' },
  flowLink: { label: '물류 연결', line: 'Unit에서 다음 Unit으로 자재가 이어지는 연결. 「물류 연결」을 누르고 Unit을 두 번 눌러 잇는다.' },
  signalLink: { label: '신호 연결', line: '도면 도식에서 출력 포트를 다른 Device의 입력 포트로 잇는 연결.' },
  precondition: { label: '사전조건', line: 'Action이 시작되기 전에 맞아야 하는 조건. 안 맞으면 기다리지 않고 PRE_UNMET으로 멈춘다.' },
  complete: { label: '완료조건', line: '단계가 끝났는지를 보는 조건. 완료 신호가 그 역할이고, 없으면 실행이 막힌다.' },
  timeout: { label: '타임아웃', line: '완료 신호가 이 시간 안에 없으면 TIMEOUT으로 멈추는 시간. 동작 시간보다 짧으면 실행 시 TIMEOUT이 난다.' },
  assumption: { label: '가정', line: '실제 사양이 아닌 임시 값' },
  undetermined: { label: '미정', line: '아직 정하지 않은 값. 앱이 숫자를 임의로 채우지 않고 그대로 둔다.' },
  gap: { label: 'Gap', line: '근거가 부족한 곳, 미정, 사람 확인이 필요한 항목을 모은 목록. 문제 없음으로 채우지 않는다.' },
  rev: { label: 'rev', line: '모델을 바꿀 때마다 증가하는 번호' },
  virtualTime: { label: '가상 시간', line: '정수 밀리초로 계산하는 시간. 재생 속도와 결과가 무관' },
  cycle: { label: '사이클', line: '자재 한 개가 투입부터 끝까지 가는 가상 시간. 실행이 끝나야 나오고, 그 전에는 표시되지 않는다.' },
  sfc: { label: 'SFC', line: 'Station 흐름을 읽기 전용으로 그린 그림. 분기, 병렬, 반복, 재시도, Substation 단계를 보여 준다.' },
  aml: { label: 'AML', line: 'AutomationML 파일과 그 XML. 이 앱은 CAEX 3.0의 일부만 읽음' },
  workspace: { label: 'Workspace', line: '이 브라우저 안의 프로젝트 묶음. 폴더가 아님' },
  draft: { label: '임시 저장', line: '마지막 편집 5초 뒤 이 브라우저에만 남는 사본. 「저장」한 내용과 저장 목록은 바꾸지 않는다.' },
} as const;

export type TermId = keyof typeof GLOSSARY;

export const GLOSSARY_ORDER: TermId[] = [
  'station', 'substation', 'unit', 'device', 'action', 'signal', 'position', 'interlock',
  'flowLink', 'signalLink', 'precondition', 'complete', 'timeout', 'assumption', 'undetermined',
  'gap', 'rev', 'virtualTime', 'cycle', 'sfc', 'aml', 'workspace', 'draft',
];

/** Extra spellings used on screen. Longest match wins, so 「신호 연결」 is not split into 「신호」. */
const ALIASES: { id: TermId; text: string }[] = [
  { id: 'complete', text: '완료 조건' },
  { id: 'precondition', text: '사전 조건' },
  { id: 'position', text: '포지션' },
  { id: 'signal', text: '신호' },
];

export interface TermHit { id: TermId; text: string }

const PATTERNS: { id: TermId; text: string; latin: boolean }[] = [
  ...GLOSSARY_ORDER.map((id) => ({ id, text: GLOSSARY[id].label, latin: /^[A-Za-z]/.test(GLOSSARY[id].label) })),
  ...ALIASES.map((a) => ({ id: a.id, text: a.text, latin: false })),
];

function latinEdge(input: string, start: number, len: number): boolean {
  const prev = start > 0 ? input[start - 1] : '';
  const next = input[start + len] ?? '';
  return !/[A-Za-z]/.test(prev) && !/[A-Za-z]/.test(next);
}

/** Split a label into plain runs and glossary hits. Plain text is unchanged. */
export function splitTerms(input: string): { id: TermId | null; text: string }[] {
  const out: { id: TermId | null; text: string }[] = [];
  let i = 0;
  let plain = '';
  const flush = () => { if (plain) { out.push({ id: null, text: plain }); plain = ''; } };
  while (i < input.length) {
    let best: { id: TermId; text: string } | null = null;
    for (const p of PATTERNS) {
      if (!input.startsWith(p.text, i)) continue;
      if (p.latin && !latinEdge(input, i, p.text.length)) continue;
      if (!best || p.text.length > best.text.length) best = p;
    }
    if (best) {
      flush();
      out.push({ id: best.id, text: best.text });
      i += best.text.length;
    } else {
      plain += input[i];
      i += 1;
    }
  }
  flush();
  return out;
}

export function hasTerm(input: string): boolean {
  return splitTerms(input).some((p) => p.id !== null);
}
