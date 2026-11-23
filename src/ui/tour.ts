// TURN-042 first-run copy. One file so a later manual pass can match these sentences.
// The tour opens the 5공정 example and then only changes the view (step, tab). It does not edit the model.
import type { StepId } from './wizard';

export const TOUR_BUTTON = '5공정 예제로 둘러보기';
export const TOUR_AGAIN = '둘러보기 다시 보기';

/** Built-in example. The tour reuses this tab when it is already open, instead of making another copy. */
export const TOUR_SAMPLE_ID = 'prj-sample-5step';

export function isTourSample(p: { id: string; name: string }): boolean {
  return p.id === TOUR_SAMPLE_ID || p.name.includes('5공정');
}

export interface TourStep {
  id: string;
  /** Wizard screen this step shows. The last step stays on 6 실행·저장 and points at the step bar. */
  step: StepId;
  sub?: string;
  /** Element the bubble points at. It must be on screen for this step. */
  anchor: string;
  title: string;
  /** Two or three sentences. */
  body: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'library',
    step: 'library',
    sub: 'cards',
    anchor: '[data-tour="library"]',
    title: '1 입력·에셋 선택',
    body: '사용할 에셋(AML 정의)을 고르는 화면입니다. 카드를 누르면 오른쪽에 상세가 열리고, 그 자체로는 모델이 바뀌지 않습니다. 이 5공정 예제에는 장치가 이미 들어 있습니다.',
  },
  {
    id: 'canvas',
    step: 'canvas',
    anchor: '[data-tour="canvas"]',
    title: '2 배치·연결',
    body: 'Unit 안에 Device를 배치하고 물류와 신호를 연결하는 화면입니다. 카드 보드에서 다섯 공정의 자리를 보고, 도면 도식에서 포트를 잇습니다.',
  },
  {
    id: 'attributes',
    step: 'attributes',
    anchor: '[data-tour="attributes"]',
    title: '3 속성·Action',
    body: '필요 사양, 명령·완료 신호, 동작 시간과 타임아웃을 채우는 화면입니다. 예제의 시간은 가정값이며, 확정 사양이 아닙니다.',
  },
  {
    id: 'sequence',
    step: 'sequence',
    sub: 'sequence',
    anchor: '[data-tour="sequence"]',
    title: '4 자재·시퀀스',
    body: '자재의 처음 위치와 경로, 그리고 시퀀스 단계를 정하는 화면입니다. 이 예제는 투입부터 배출까지 단계가 이미 있습니다.',
  },
  {
    id: 'check',
    step: 'check',
    sub: 'gap',
    anchor: '[data-tour="check"]',
    title: '5 점검',
    body: '실행을 막는 이유, 미정, 사람이 확인할 항목을 보는 화면입니다. 여기서 막히면 6단계 실행 전 검사도 통과하지 못합니다.',
  },
  {
    id: 'run',
    step: 'run',
    anchor: '[data-tour="run"]',
    title: '6 실행·저장',
    body: '실행 전 검사를 통과하면 「실행」으로 논리 시뮬레이션을 돌립니다. 이 예제에서 「실행」을 눌러 보세요. 누르지 않아도 다음으로 갈 수 있습니다.',
  },
  {
    id: 'finish',
    step: 'run',
    anchor: '[data-tour="stepbar"]',
    title: '단계 바와 저장',
    body: '단계 바의 배지는 각 단계의 판정입니다. ✓ 필수 충족은 필수 누락이 없다는 뜻이고, 숫자는 남은 항목입니다. 「저장」은 이 브라우저에 남기고, 빈 설계는 시작 화면의 「빈 프로젝트 만들기」로 시작합니다.',
  },
];

export interface Box { x: number; y: number; w: number; h: number }

const overlaps = (a: Box, b: Box) => a.w > 0 && b.w > 0 && a.h > 0 && b.h > 0
  && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * Place the bubble inside the viewport without covering `target`.
 * Tries below, above, right, then left, and clamps into the margin.
 * A zero-size target does not count as covered.
 */
export function placeTourBubble(
  target: Box,
  bubble: { w: number; h: number },
  viewport: { w: number; h: number },
  margin = 8,
  gap = 12,
): { top: number; left: number } {
  const bw = Math.max(1, Math.min(bubble.w, Math.max(1, viewport.w - margin * 2)));
  const bh = Math.max(1, Math.min(bubble.h, Math.max(1, viewport.h - margin * 2)));
  const maxLeft = Math.max(margin, viewport.w - margin - bw);
  const maxTop = Math.max(margin, viewport.h - margin - bh);
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  const raw: Box[] = [
    { x: target.x, y: target.y + target.h + gap, w: bw, h: bh },
    { x: target.x + target.w - bw, y: target.y + target.h + gap, w: bw, h: bh },
    { x: target.x, y: target.y - gap - bh, w: bw, h: bh },
    { x: target.x + target.w - bw, y: target.y - gap - bh, w: bw, h: bh },
    { x: target.x + target.w + gap, y: target.y, w: bw, h: bh },
    { x: target.x - gap - bw, y: target.y, w: bw, h: bh },
    { x: target.x + target.w + gap, y: target.y + target.h - bh, w: bw, h: bh },
    { x: target.x - gap - bw, y: target.y + target.h - bh, w: bw, h: bh },
  ];
  for (const candidate of raw) {
    const placed: Box = { x: clamp(candidate.x, margin, maxLeft), y: clamp(candidate.y, margin, maxTop), w: bw, h: bh };
    if (!overlaps(placed, target)) return { top: placed.y, left: placed.x };
  }
  const space = {
    below: viewport.h - (target.y + target.h),
    above: target.y,
    right: viewport.w - (target.x + target.w),
    left: target.x,
  };
  const side = (Object.entries(space) as [keyof typeof space, number][]).sort((a, b) => b[1] - a[1])[0][0];
  const placed: Box = side === 'below'
    ? { x: clamp(target.x, margin, maxLeft), y: clamp(target.y + target.h + gap, margin, maxTop), w: bw, h: bh }
    : side === 'above'
      ? { x: clamp(target.x, margin, maxLeft), y: clamp(target.y - gap - bh, margin, maxTop), w: bw, h: bh }
      : side === 'right'
        ? { x: clamp(target.x + target.w + gap, margin, maxLeft), y: clamp(target.y, margin, maxTop), w: bw, h: bh }
        : { x: clamp(target.x - gap - bw, margin, maxLeft), y: clamp(target.y, margin, maxTop), w: bw, h: bh };
  if (!overlaps(placed, target)) return { top: placed.y, left: placed.x };
  const cx = target.x + target.w / 2;
  const cy = target.y + target.h / 2;
  return { left: cx < viewport.w / 2 ? maxLeft : margin, top: cy < viewport.h / 2 ? maxTop : margin };
}
