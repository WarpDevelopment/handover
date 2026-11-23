// In-memory ring of recent screen frames, per display. It keeps about two seconds so a step can
// use "the newest frame at least 50 ms before the click" (tester-package.md §4.3).

export interface RingFrame {
  displayId: number;
  /** Wall-clock epoch ms the frame was captured. */
  epoch: number;
  width: number;
  height: number;
  /** Encoded image (JPEG) bytes. */
  data: Uint8Array;
}

export const RING_MAX_AGE_MS = 2200;
export const MIN_LEAD_MS = 50;

export class FrameRing {
  private readonly frames = new Map<number, RingFrame[]>();

  constructor(private readonly maxAgeMs = RING_MAX_AGE_MS) {}

  push(frame: RingFrame): void {
    const list = this.frames.get(frame.displayId) ?? [];
    list.push(frame);
    list.sort((a, b) => a.epoch - b.epoch);
    // Age is measured against the newest frame of the display, so a stalled capture keeps its
    // last frames instead of emptying the ring.
    const newest = list[list.length - 1].epoch;
    while (list.length > 1 && newest - list[0].epoch > this.maxAgeMs) list.shift();
    this.frames.set(frame.displayId, list);
  }

  /** The newest frame at least `minLeadMs` before `epoch`, or undefined. */
  newestBefore(displayId: number, epoch: number, minLeadMs = MIN_LEAD_MS): RingFrame | undefined {
    let best: RingFrame | undefined;
    for (const f of this.frames.get(displayId) ?? []) {
      if (f.epoch > epoch - minLeadMs) continue;
      if (!best || f.epoch > best.epoch) best = f;
    }
    return best;
  }

  /** The newest frame of a display, whatever its age. */
  latest(displayId: number): RingFrame | undefined {
    const list = this.frames.get(displayId);
    return list?.[list.length - 1];
  }

  displayIds(): number[] {
    return [...this.frames.keys()];
  }

  /** Frames held for a display (for tests and memory accounting). */
  count(displayId: number): number {
    return this.frames.get(displayId)?.length ?? 0;
  }

  bytes(): number {
    let n = 0;
    for (const list of this.frames.values()) for (const f of list) n += f.data.byteLength;
    return n;
  }

  clear(): void {
    this.frames.clear();
  }
}
