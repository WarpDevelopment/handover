// Runs one Explain freeze: opens an overlay window per display, collects what the user drew and typed
// in each, and ends the freeze on Done (save) or Esc/Cancel (throw it away). Electron-free: windows
// and the recorder are injected, so the flow is unit-tested with fakes.

import type { ActionResult, FreezeInit } from "../common/ipc";
import type { ExplainAnnotationInput } from "../common/handover/explain";
import type { BeginExplainResult, EndExplainResult, FrozenFrame } from "./recorder/controller";

/** The parts of an Electron `Display` the freeze needs. */
export interface DisplayLike {
  id: number;
  bounds: { x: number; y: number; width: number; height: number };
  /** Physical px = size × scaleFactor (Electron reports `size` in DIP). */
  size: { width: number; height: number };
  scaleFactor: number;
}

/** What the coordinator needs from an overlay window. */
export interface OverlayWindow {
  /** Identifies the window's renderer in IPC (the `webContents.id`). */
  readonly senderId: number;
  show(): void;
  focus(): void;
  destroy(): void;
  isDestroyed(): boolean;
  onClosed(cb: () => void): void;
  /** Esc pressed in the window, even when the page itself did not handle it. */
  onEscape(cb: () => void): void;
}

export interface FreezeDeps {
  beginExplain(): Promise<BeginExplainResult>;
  endExplain(result: unknown): Promise<EndExplainResult>;
  getDisplays(): DisplayLike[];
  cursorDisplayId(): number;
  /** The frozen frame as a data URL. */
  readFrame(sessionDir: string, frame: FrozenFrame): Promise<string>;
  openWindow(display: DisplayLike): OverlayWindow;
  /** Bring the app forward so the overlay can take keyboard focus (macOS). */
  activateApp?(): void;
  log?: { info(...a: unknown[]): void; warn(...a: unknown[]): void };
}

interface View {
  display: DisplayLike;
  init: FreezeInit;
  win: OverlayWindow;
  annotations: ExplainAnnotationInput[];
}

export class FreezeCoordinator {
  private views = new Map<number, View>();
  private opening = false;
  private ending = false;

  constructor(private readonly deps: FreezeDeps) {}

  get active(): boolean {
    return this.views.size > 0 || this.opening;
  }

  /** Freeze every display and open its overlay. The first window (under the pointer) takes focus. */
  async begin(): Promise<ActionResult> {
    if (this.active) return { ok: false, error: "The screen is already frozen." };
    this.opening = true;
    try {
      const begun = await this.deps.beginExplain();
      if (!begun.ok || !begun.frames || !begun.sessionDir) {
        return { ok: false, error: begun.error ?? "Could not freeze the screen." };
      }
      const displays = this.deps.getDisplays();
      const cursorId = this.deps.cursorDisplayId();
      const frames = begun.frames.filter((f) => displays.some((d) => d.id === f.displayId));
      const views: View[] = [];
      for (const [i, frame] of frames.entries()) {
        const display = displays.find((d) => d.id === frame.displayId) as DisplayLike;
        const sizeDpx: [number, number] = [
          Math.round(display.size.width * display.scaleFactor),
          Math.round(display.size.height * display.scaleFactor),
        ];
        let image: string;
        try {
          image = await this.deps.readFrame(begun.sessionDir, frame);
        } catch (error) {
          this.deps.log?.warn("could not read a frozen frame:", error instanceof Error ? error.message : error);
          continue;
        }
        const win = this.deps.openWindow(display);
        const init: FreezeInit = {
          displayId: display.id,
          frame: image,
          sizeDpx,
          scaleFactor: display.scaleFactor,
          cssSize: [display.bounds.width, display.bounds.height],
          index: i + 1,
          count: frames.length,
          primary: display.id === cursorId,
        };
        views.push({ display, init, win, annotations: [] });
      }
      if (views.length === 0) {
        await this.deps.endExplain({ cancelled: true });
        return { ok: false, error: "Could not show the frozen screen." };
      }
      if (!views.some((v) => v.init.primary)) views[0].init.primary = true;
      for (const v of views) {
        this.views.set(v.win.senderId, v);
        v.win.onClosed(() => this.windowClosed(v.win.senderId));
        v.win.onEscape(() => void this.cancel());
      }
      this.deps.activateApp?.();
      for (const v of views) v.win.show();
      views.find((v) => v.init.primary)?.win.focus();
      return { ok: true };
    } finally {
      this.opening = false;
    }
  }

  /** The overlay window asks what to draw. Null when the sender is not a freeze window. */
  init(senderId: number): FreezeInit | null {
    return this.views.get(senderId)?.init ?? null;
  }

  /** Remember what a window has drawn and typed so far (the whole list, replacing the last one). */
  setState(senderId: number, state: unknown): void {
    const view = this.views.get(senderId);
    if (!view) return;
    const list = (state as { annotations?: unknown } | null)?.annotations;
    view.annotations = Array.isArray(list) ? (list as ExplainAnnotationInput[]) : [];
  }

  /** What would be saved: every display's shapes, and one comment (the displays' comments joined). */
  collect(): ExplainAnnotationInput[] {
    const views = [...this.views.values()].sort((a, b) => a.init.index - b.init.index);
    const shapes: ExplainAnnotationInput[] = [];
    const comments: string[] = [];
    for (const v of views) {
      for (const a of v.annotations) {
        if (a?.kind === "comment" && typeof a.text === "string") {
          if (a.text.trim()) comments.push(a.text.trim());
        } else if (a?.kind === "highlight") {
          shapes.push({ ...a, displayId: v.display.id });
        }
      }
    }
    return [...shapes, ...(comments.length ? [{ kind: "comment" as const, text: comments.join("\n\n") }] : [])];
  }

  /** Save what was drawn and typed, then unfreeze. */
  async done(senderId?: number): Promise<ActionResult> {
    if (senderId !== undefined && !this.views.has(senderId)) return { ok: false, error: "Not a freeze window." };
    return this.end({ cancelled: false, annotations: this.collect() });
  }

  /** Throw it all away, then unfreeze. */
  async cancel(senderId?: number): Promise<ActionResult> {
    if (senderId !== undefined && !this.views.has(senderId)) return { ok: false, error: "Not a freeze window." };
    return this.end({ cancelled: true, annotations: [] });
  }

  /** The recording stopped while frozen: the controller already wrote explain.end, so just close. */
  abort(): void {
    this.closeAll();
  }

  private async end(result: { cancelled: boolean; annotations: ExplainAnnotationInput[] }): Promise<ActionResult> {
    if (this.ending || this.views.size === 0) return { ok: false, error: "The screen is not frozen." };
    this.ending = true;
    try {
      const res = await this.deps.endExplain(result);
      this.closeAll();
      return res.ok ? { ok: true } : { ok: false, error: res.error };
    } finally {
      this.ending = false;
    }
  }

  private windowClosed(senderId: number): void {
    if (!this.views.has(senderId)) return; // closed by us (Done, Cancel or abort)
    this.views.delete(senderId);
    // Every window gone without Done or Esc (a display was unplugged): the freeze is over, unsaved.
    if (this.views.size === 0 && !this.ending && !this.opening) {
      this.ending = true;
      void this.deps
        .endExplain({ cancelled: true, annotations: [] })
        .catch((error) => this.deps.log?.warn("ending the freeze failed:", error))
        .finally(() => {
          this.ending = false;
        });
    }
  }

  private closeAll(): void {
    const views = [...this.views.values()];
    this.views.clear();
    for (const v of views) {
      if (!v.win.isDestroyed()) v.win.destroy();
    }
  }
}
