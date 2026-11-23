// Keeps recent frames in memory and writes to the session folder only the frames a step needs:
//   shots/NNNNNN.jpg   and   shots.json (the index the package builder reads).
// Electron-free so it is unit-tested with synthetic frames.

import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { DisplaysPayload } from "../../common/events";
import { displaysForEvent, STEP_EVENT_TYPES } from "../../common/handover/displays";
import { SHOTS_DIR, SHOTS_FILE } from "../../common/handover/read-session";
import type { ShotEntry } from "../../common/handover/types";
import type { RecEvent } from "../../common/types";
import { FrameRing, MIN_LEAD_MS, type RingFrame } from "./ring";

/** A frame about this long after a step's action is the "after" frame of the last step. */
export const AFTER_DELAY_MS = 500;

interface PendingAfter {
  displayIds: number[];
  dueEpoch: number;
}

export class ShotStore {
  readonly ring: FrameRing;
  private layout: DisplaysPayload | null = null;
  private readonly index: ShotEntry[] = [];
  private readonly written = new Set<string>();
  private readonly afterFiles = new Map<number, string>();
  private pending: PendingAfter[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sequence = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly sessionDir: string,
    ring: FrameRing = new FrameRing(),
    private readonly now: () => number = Date.now,
  ) {
    this.ring = ring;
  }

  ingest(frame: RingFrame): void {
    this.ring.push(frame);
  }

  /** The screen did not change: re-stamp the previous frame (shares its bytes). */
  ingestSame(displayId: number, epoch: number): void {
    const last = this.ring.latest(displayId);
    if (last && epoch > last.epoch) this.ring.push({ ...last, epoch });
  }

  entries(): readonly ShotEntry[] {
    return this.index;
  }

  /** Feed every recorded event. Steps get a before frame now and an after frame ~500 ms later. */
  onEvent(ev: RecEvent): void {
    if (ev.type === "displays") {
      this.layout = ev.payload as unknown as DisplaysPayload;
      return;
    }
    if (!STEP_EVENT_TYPES.has(ev.type)) return;
    const displayIds = displaysForEvent(ev, this.layout);
    if (displayIds.length === 0) return;
    this.enqueue(() => this.persistBefore(displayIds, ev.epoch));
    this.pending.push({ displayIds, dueEpoch: ev.epoch + AFTER_DELAY_MS });
    this.armTimer();
  }

  private armTimer(): void {
    if (this.timer || this.pending.length === 0) return;
    const next = Math.min(...this.pending.map((p) => p.dueEpoch));
    this.timer = setTimeout(() => {
      this.timer = null;
      this.runDue(false);
      this.armTimer();
    }, Math.max(0, next - this.now()));
  }

  private runDue(all: boolean): void {
    const due = this.pending.filter((p) => all || p.dueEpoch <= this.now());
    this.pending = this.pending.filter((p) => !due.includes(p));
    for (const p of due) this.enqueue(() => this.persistAfter(p.displayIds));
  }

  private enqueue(job: () => Promise<void>): void {
    this.chain = this.chain.then(job).catch(() => undefined);
  }

  /** Newest frame at least 50 ms before `epoch`, per display. Skips a frame already on disk. */
  async persistBefore(displayIds: number[], epoch: number): Promise<void> {
    for (const id of displayIds) {
      const frame = this.ring.newestBefore(id, epoch, MIN_LEAD_MS);
      if (frame) await this.write(frame, "before");
    }
    await this.writeIndex();
  }

  /** Keeps only the newest "after" frame per display; older ones are deleted. */
  async persistAfter(displayIds: number[]): Promise<void> {
    for (const id of displayIds) {
      const frame = this.ring.latest(id);
      if (!frame) continue;
      const previous = this.afterFiles.get(id);
      const entry = await this.write(frame, "after");
      if (previous && entry && previous !== entry.file) await this.drop(previous);
      if (entry) this.afterFiles.set(id, entry.file);
    }
    await this.writeIndex();
  }

  /** Persist a frozen frame (for freeze-and-annotate) from a forced snapshot of every display. */
  async persistSnapshot(): Promise<ShotEntry[]> {
    const out: ShotEntry[] = [];
    for (const id of this.ring.displayIds()) {
      const frame = this.ring.latest(id);
      const entry = frame && (await this.write(frame, "annotation"));
      if (entry) out.push(entry);
    }
    await this.writeIndex();
    return out;
  }

  private async write(frame: RingFrame, purpose: ShotEntry["purpose"]): Promise<ShotEntry | null> {
    const key = `${frame.displayId}:${frame.epoch}:${purpose}`;
    if (this.written.has(key)) {
      return this.index.find((e) => e.displayId === frame.displayId && e.epoch === frame.epoch && e.purpose === purpose) ?? null;
    }
    this.written.add(key);
    const file = path.posix.join(SHOTS_DIR, `${String(++this.sequence).padStart(6, "0")}.jpg`);
    await mkdir(path.join(this.sessionDir, SHOTS_DIR), { recursive: true });
    await writeFile(path.join(this.sessionDir, file), frame.data);
    const entry: ShotEntry = { file, epoch: frame.epoch, displayId: frame.displayId, purpose };
    this.index.push(entry);
    return entry;
  }

  private async drop(file: string): Promise<void> {
    const i = this.index.findIndex((e) => e.file === file);
    if (i >= 0) this.index.splice(i, 1);
    await unlink(path.join(this.sessionDir, file)).catch(() => undefined);
  }

  private async writeIndex(): Promise<void> {
    const sorted = [...this.index].sort((a, b) => a.epoch - b.epoch || (a.file < b.file ? -1 : 1));
    await writeFile(path.join(this.sessionDir, SHOTS_FILE), JSON.stringify(sorted, null, 2));
  }

  /** Run every pending "after" capture now, wait for all writes, and write the index. */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.runDue(true);
    await this.chain;
    await this.writeIndex();
  }

  /** Cancel timers and release the frames. Does not write. */
  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = [];
    this.ring.clear();
  }
}
