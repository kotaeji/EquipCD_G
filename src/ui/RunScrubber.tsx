import { formatMs } from '../scene/runInfo';
import { SCRUB_NUDGE_MS, SCRUB_PAGE_MS, type ScrubMarker } from '../runtime/scrub';
import './run-scrubber.css';

export interface ScrubTick {
  t: number;
  kind: 'start' | 'end' | 'error';
  title: string;
}

const RANK: Record<ScrubTick['kind'], number> = { start: 0, end: 1, error: 2 };

export function scrubTicks(markers: ScrubMarker[]): ScrubTick[] {
  const map = new Map<number, ScrubTick>();
  for (const marker of markers) {
    const cur = map.get(marker.t);
    if (!cur) {
      map.set(marker.t, { t: marker.t, kind: marker.kind, title: marker.label });
      continue;
    }
    cur.title = `${cur.title} · ${marker.label}`;
    if (RANK[marker.kind] > RANK[cur.kind]) cur.kind = marker.kind;
  }
  return [...map.values()].sort((a, b) => a.t - b.t);
}

/** Time bar under the run diagram. `onScrub(null)` returns to the finished instant. */
export function RunScrubber({ totalMs, timeMs, markers, scrubbing, onScrub }: {
  totalMs: number;
  timeMs: number;
  markers: ScrubMarker[];
  scrubbing: boolean;
  onScrub: (ms: number | null) => void;
}) {
  const ticks = scrubTicks(markers);
  const move = (by: number) => {
    const next = Math.max(0, Math.min(totalMs, timeMs + by));
    onScrub(next >= totalMs ? null : next);
  };
  return (
    <div className="run-scrub" data-run-scrub="" data-scrubbing={scrubbing ? 'on' : 'off'} data-total-ms={totalMs} data-time-ms={timeMs} aria-label="시간 막대">
      {scrubbing && <p className="run-scrub-banner" data-scrub-banner="">되감아 보는 중 — {formatMs(timeMs)}</p>}
      <div className="run-scrub-scale">
        {ticks.map((tick) => (
          <span
            key={`${tick.kind}:${tick.t}:${tick.title}`}
            className={`run-scrub-tick is-${tick.kind}`}
            data-scrub-tick=""
            data-tick-ms={tick.t}
            data-tick-kind={tick.kind}
            title={tick.title}
            style={{ left: `${totalMs <= 0 ? 0 : (tick.t / totalMs) * 100}%` }}
          />
        ))}
        <input
          type="range"
          aria-label="실행 시각"
          aria-valuetext={formatMs(timeMs)}
          min={0}
          max={totalMs}
          step={1}
          value={timeMs}
          title="끌어서 옮깁니다. ←→ 0.1초, Shift+←→ 1초, Home 처음, End 끝"
          onChange={(e) => {
            const next = Math.round(Number(e.target.value));
            onScrub(next >= totalMs ? null : next);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              const step = e.shiftKey ? SCRUB_PAGE_MS : SCRUB_NUDGE_MS;
              move(e.key === 'ArrowLeft' ? -step : step);
            } else if (e.key === 'Home') {
              e.preventDefault();
              onScrub(totalMs <= 0 ? null : 0);
            } else if (e.key === 'End') {
              e.preventDefault();
              onScrub(null);
            }
          }}
        />
      </div>
      <div className="run-scrub-ends">
        <span>00:00.000</span>
        <span>{formatMs(totalMs)}</span>
      </div>
    </div>
  );
}
