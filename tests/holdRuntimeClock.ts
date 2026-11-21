// Holds the station run loop still. App.tsx steps virtual time from
// requestAnimationFrame timestamps (`Math.min(250, now - last)`), so a slow
// test can finish a run before it looks at the screen. This keeps both the
// frame clock and performance.now() at one instant.
import { act } from 'react';

/** Same cap as the run loop in src/ui/App.tsx. A frame never adds more than this. */
const MAX_FRAME_MS = 250;

export type HeldRuntimeClock = {
  /** Frames waiting on the held clock. Zero means the run loop is not armed. */
  queued: () => number;
  /** Wait real wall time. The held clock does not move. */
  wall: (ms: number) => Promise<void>;
  /**
   * Skip `ms` of wall time. Deliver enough queued frames to cover `ms` at the
   * 250ms cap, but pass the frozen timestamp every time so virtual time stays put.
   * Passing `frozen + i * 250` instead covers `ms` and finishes a run of that length.
   */
  elapse: (ms: number) => Promise<void>;
  restore: () => void;
};

export function holdRuntimeClock(): HeldRuntimeClock {
  const frozen = performance.now();
  const previousNow = performance.now.bind(performance);
  const previousRaf = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  let nextId = 1;
  const queued = new Map<number, FrameRequestCallback>();
  let restored = false;

  performance.now = () => frozen;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    const id = nextId++;
    queued.set(id, cb);
    return id;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => {
    queued.delete(id);
  }) as typeof cancelAnimationFrame;

  return {
    queued: () => queued.size,
    async wall(ms: number) {
      if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
    },
    async elapse(ms: number) {
      const frames = Math.ceil(ms / MAX_FRAME_MS) + 1;
      await act(async () => {
        for (let i = 0; i < frames; i += 1) {
          const batch = [...queued.values()];
          queued.clear();
          if (batch.length === 0) break;
          // Frozen instant. `frozen + i * MAX_FRAME_MS` would step the run loop by the cap.
          for (const cb of batch) cb(frozen);
        }
      });
    },
    restore() {
      if (restored) return;
      restored = true;
      performance.now = previousNow;
      globalThis.requestAnimationFrame = previousRaf;
      globalThis.cancelAnimationFrame = previousCancel;
      queued.clear();
    },
  };
}
