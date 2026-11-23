// TURN-051. One place for problem lines and empty-screen lines.
// The gate, the error codes, and the engine messages stay where they are.
// These lines only split the existing meaning into 무엇 · 왜 · 어떻게.
import { destLabel, guideCopy, type BlockerGuide } from './blockerTarget';

export type ProblemTone = 'error' | 'undetermined' | 'assumption';

export interface ProblemCopy {
  tone: ProblemTone;
  what: string;
  why: string;
  how?: string;
  /** Shown only when there is a place to go. */
  jump?: string;
  jumpAria?: string;
  badge?: string;
}

export interface EmptyAction {
  label: string;
  /** Why the button is dim. Shown beside a disabled button. */
  reason?: string;
}

const UNDETERMINED = new Set([
  'TIMEOUT_UNDEFINED', 'DURATION_UNDEFINED', 'CONDITION_UNDEFINED', 'CAPACITY_UNDEFINED',
  'NO_COMPLETE_SIGNAL', 'MAT_NO_LOCATION', 'MAT_NO_STATE', 'FEED_INTERVAL', 'FEED_COUNT',
]);

function toneOf(code: string, message: string, g: BlockerGuide): ProblemTone {
  if (g.kind === 'unsupported') return 'assumption';
  if (UNDETERMINED.has(code) || message.includes('미정')) return 'undetermined';
  return 'error';
}

/** Split a readiness blocker into three lines. The lead and the badge stay in the text. */
export function blockerProblem(message: string, code: string, g: BlockerGuide): ProblemCopy {
  const copy = guideCopy(code, g);
  const step = message.match(/^단계 ([^:]+): (.+)$/);
  const what = step ? `단계 ${step[1]}` : message;
  const why = step
    ? step[2]
    : (g.note ?? (g.kind === 'fix' ? '실행 전에 이 값을 채워야 합니다' : '실행 전 검사에서 막혔습니다'));
  let how = copy.lead;
  if (code === 'TIMEOUT_UNDEFINED' && g.kind === 'fix' && g.dest?.place === 'Action') {
    how = `3단계 Action 에서 값을 입력하세요. ${copy.lead}`;
  } else if (g.kind === 'fix' && g.dest) {
    how = `${destLabel(g.dest)} 에서 고치세요. ${copy.lead}`;
  } else if (g.kind === 'unsupported') {
    how = g.note ?? copy.lead;
  }
  return {
    tone: toneOf(code, message, g),
    what,
    why,
    how,
    jump: copy.button,
    jumpAria: copy.aria,
    badge: copy.badge,
  };
}

const RUN_WHY: Record<string, string> = {
  TIMEOUT: '타임아웃 안에 완료되지 않았습니다',
  PRE_UNMET: '시작 조건이 맞지 않습니다',
  POST_UNMET: '완료 조건이 맞지 않습니다',
  CAPACITY_FULL: 'Unit 수용을 넘겼습니다',
  DEADLOCK: '서로 기다려 진행할 수 없습니다',
  INTERLOCK_BLOCK: '확인된 Interlock 이 단계 시작을 막았습니다',
};

const RUN_HOW: Record<string, string> = {
  TIMEOUT: '타임아웃을 동작 시간보다 길게 하거나, 완료 신호가 켜지는지 확인하세요.',
  PRE_UNMET: '이 단계의 조건을 맞추거나, 앞 단계가 그 조건을 만들게 하세요.',
  POST_UNMET: '이 단계의 조건을 맞추거나, 앞 단계가 그 조건을 만들게 하세요.',
  CAPACITY_FULL: 'Unit 수용 개수를 늘리거나, 앞 단계가 비운 뒤에 들어가게 하세요.',
  DEADLOCK: '서로 기다리는 Unit의 수용이나 순서를 바꾸세요.',
  INTERLOCK_BLOCK: '조건을 맞추거나 확인을 거절하세요.',
};

const RUN_WHAT: Record<string, (step: string) => string> = {
  TIMEOUT: (step) => `${step} 타임아웃`,
  PRE_UNMET: (step) => `${step} 조건 불충족`,
  POST_UNMET: (step) => `${step} 조건 불충족`,
  CAPACITY_FULL: (step) => `${step} 수용 부족`,
  DEADLOCK: () => '교착',
  INTERLOCK_BLOCK: (step) => `${step} Interlock 차단`,
};

/** Five run failures share one shape. Unknown codes return null so the UI does not invent a fix. */
export function runErrorProblem(code: string, message: string, stepName: string | null): ProblemCopy | null {
  const whatOf = RUN_WHAT[code];
  if (!whatOf) return null;
  const step = stepName ?? '실행';
  return {
    tone: 'error',
    what: whatOf(step),
    why: `${RUN_WHY[code]}. ${message}`,
    how: RUN_HOW[code],
    jump: '이동',
    jumpAria: `${whatOf(step)} 이동`,
  };
}

export function refusal(kind: 'paste' | 'delete' | 'connect', why: string): ProblemCopy {
  const what = kind === 'paste' ? '붙여넣기 불가' : kind === 'delete' ? '삭제 불가' : '연결 불가';
  return { tone: 'error', what, why };
}

export function saveProblem(why: string): ProblemCopy {
  return { tone: 'error', what: '저장 실패', why, how: '다시 저장하거나 JSON으로 내보내세요.' };
}

export function draftProblem(why: string): ProblemCopy {
  return { tone: 'error', what: '임시 저장 실패', why, how: '저장본이 있으면 그 저장본을 여세요.' };
}

/** A bundle file that is not a workspace bundle. Storage is left untouched. */
export function bundleRejectProblem(why: string): ProblemCopy {
  return {
    tone: 'error',
    what: '묶음 파일을 열지 않았습니다',
    why,
    how: '이 앱에서 내보낸 .aurora-workspace.json 파일을 고르세요. 저장소는 바꾸지 않았습니다.',
  };
}

export function importRejectProblem(fileName: string): ProblemCopy {
  return {
    tone: 'error',
    what: '가져오기 거부',
    why: `파일 ${fileName} 을(를) 열지 않았습니다.`,
    how: '원본은 격리 보관함(진단 탭)에 그대로 보존했습니다. 실패를 빈 프로젝트로 바꾸지 않습니다.',
  };
}

export function exportBlockedProblem(count: number): ProblemCopy {
  return {
    tone: 'error',
    what: 'Export 차단',
    why: '실행 전 검사를 통과하지 못했습니다.',
    how: `파일을 만들 수 없습니다. 차단 ${count}건. 아래 항목을 고친 뒤 다시 만드세요.`,
  };
}

export const RUN_LOCK = '실행 중에는 이 작업을 할 수 없습니다. 초기화한 뒤 하세요.';

export const EMPTY = {
  projects: '이 Workspace에 저장된 프로젝트가 없습니다. 예시는 저장 목록이 아닙니다.',
  units: 'Unit이 없습니다. 팔레트의 빈 유닛을 놓으세요.',
  devices: 'Device가 없습니다. 팔레트에서 장치를 고르세요.',
  flows: '물류 연결이 없습니다.',
  materials: '자재가 없습니다.',
  steps: '시퀀스 단계가 없습니다.',
  interlocks: 'Interlock이 없습니다.',
  gaps: '남은 Gap 이 없습니다.',
  log: '실행 로그가 없습니다.',
  search: '찾는 이름이 없습니다',
  candidates: '입력 후보가 없습니다.',
} as const;

export const SCREEN = {
  lab: {
    limit: '논리 시뮬레이션 비교입니다. 자동 탐색 · 최적화 · AI 는 쓰지 않습니다.',
    empty: '변형 안이 없습니다',
  },
  bundle: {
    purpose: '이 Workspace에 저장된 프로젝트를 파일 하나로 내보내고 가져옵니다.',
    instead: '저장 안 된 변경, 임시 저장, 보기 설정, 격리 보관함은 파일에 넣지 않습니다.',
  },
  extract: {
    purpose: '자료에서 장비와 수치를 받아들이는 화면입니다.',
    instead: '지금은 입력 후보표의 직접 입력과 AML 라이브러리를 씁니다.',
  },
} as const;

export const LOADING_3D = '3D 장면을 불러오는 중';
export const LOADING_FILE = '파일을 불러오는 중';

/** Files at least this large show the loading hold. Smaller files stay quiet so the screen does not flicker. */
export const LARGE_IMPORT_BYTES = 64 * 1024;

