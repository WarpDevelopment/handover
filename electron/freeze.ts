// Runs one Explain freeze: opens an overlay window per display, collects what the user drew and typed
// in each, and ends the freeze on Done (save) or Esc/Cancel (throw it away). Electron-free: windows
// and the recorder are injected, so the flow is unit-tested with fakes.

import type { ActionResult, FreezeInit, FreezeNotice } from "../common/ipc";
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
  /**
   * Register a system-wide Escape for the lifetime of one freeze (APP-1). A frozen overlay that never
   * painted, or whose renderer died, cannot see the key, so Escape must not depend on it. Returns the
   * function that releases it; it is called when the freeze closes.
   */
  registerEscape?(cb: () => void): () => void;
  /** Tell one overlay window its corrected screen count and, on the primary, why a screen is live (N2). */
  notify?(senderId: number, notice: FreezeNotice): void;
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
  /** Bumped by {@link abort}: a `begin()` that started before it must not open windows (APP-6). */
  private generation = 0;
  /** A display was added or removed while the windows were being opened (APP-7). */
  private displaysChangedWhileOpening = false;
  private releaseEscape: (() => void) | null = null;

  constructor(private readonly deps: FreezeDeps) {}

  get active(): boolean {
    return this.views.size > 0 || this.opening;
  }

  /** Freeze every display and open its overlay. The first window (under the pointer) takes focus. */
  async begin(): Promise<ActionResult> {
    if (this.active) return { ok: false, error: "The screen is already frozen." };
    this.opening = true;
    this.displaysChangedWhileOpening = false;
    const generation = this.generation;
    // The recording stopped meanwhile: the controller already wrote explain.end, so open nothing.
    const aborted = () => generation !== this.generation;
    try {
      let begun: BeginExplainResult;
      try {
        begun = await this.deps.beginExplain();
      } catch (error) {
        this.deps.log?.warn("could not freeze:", error instanceof Error ? error.message : error);
        return { ok: false, error: "Could not freeze the screen." };
      }
      if (aborted()) return { ok: false, error: "The recording stopped." };
      if (!begun.ok || !begun.frames || !begun.sessionDir) {
        return { ok: false, error: begun.error ?? "Could not freeze the screen." };
      }
      // From here the recorder is frozen. Any failure below must end the freeze again, or every
      // later click would be dropped until the recording stops.
      const displays = this.deps.getDisplays();
      const cursorId = this.deps.cursorDisplayId();
      // Read every frame before any window exists, so no window asks for its picture before the
      // views are registered.
      const ready: { display: DisplayLike; image: string }[] = [];
      for (const frame of begun.frames) {
        const display = displays.find((d) => d.id === frame.displayId);
        if (!display) continue;
        try {
          ready.push({ display, image: await this.deps.readFrame(begun.sessionDir, frame) });
        } catch (error) {
          this.deps.log?.warn("could not read a frozen frame:", error instanceof Error ? error.message : error);
        }
      }
      if (aborted()) return { ok: false, error: "The recording stopped." };
      if (ready.length === 0 || this.displaysChangedWhileOpening) {
        await this.deps.endExplain({ cancelled: true });
        return { ok: false, error: "Could not show the frozen screen." };
      }
      const views: View[] = [];
      try {
        for (const [i, r] of ready.entries()) {
          const win = this.deps.openWindow(r.display);
          const init: FreezeInit = {
            displayId: r.display.id,
            frame: r.image,
            sizeDpx: [
              Math.round(r.display.size.width * r.display.scaleFactor),
              Math.round(r.display.size.height * r.display.scaleFactor),
            ],
            scaleFactor: r.display.scaleFactor,
            cssSize: [r.display.bounds.width, r.display.bounds.height],
            index: i + 1,
            count: ready.length,
            primary: r.display.id === cursorId,
          };
          views.push({ display: r.display, init, win, annotations: [] });
        }
        if (!views.some((v) => v.init.primary)) views[0].init.primary = true;
        for (const v of views) {
          this.views.set(v.win.senderId, v);
          v.win.onClosed(() => this.windowClosed(v.win.senderId));
          v.win.onEscape(() => void this.cancel());
        }
        this.releaseEscape = this.deps.registerEscape?.(() => void this.cancel()) ?? null;
        this.deps.activateApp?.();
        for (const v of views) v.win.show();
        views.find((v) => v.init.primary)?.win.focus();
      } catch (error) {
        this.deps.log?.warn("could not open the freeze windows:", error instanceof Error ? error.message : error);
        this.views.clear();
        this.releaseEscapeShortcut();
        for (const v of views) {
          try {
            if (!v.win.isDestroyed()) v.win.destroy();
          } catch {
            // already gone
          }
        }
        await this.deps.endExplain({ cancelled: true });
        return { ok: false, error: "Could not show the frozen screen." };
      }
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
    this.generation++;
    this.closeAll();
  }

  /**
   * A secondary display's overlay failed (D5, N2). If the user could already see it, or something was drawn
   * on it, the whole freeze is cancelled so a drawing is never silently lost. Otherwise only that window is
   * dropped: that display stays live, the remaining overlays are renumbered, and the primary is told.
   */
  secondaryFailed(senderId: number, revealed: boolean): void {
    const view = this.views.get(senderId);
    if (!view) return;
    if (revealed || view.annotations.length > 0) {
      void this.cancel();
      return;
    }
    this.views.delete(senderId);
    try {
      if (!view.win.isDestroyed()) view.win.destroy();
    } catch {
      // already gone
    }
    if (this.views.size === 0) {
      void this.cancel();
      return;
    }
    const left = [...this.views.values()].sort((a, b) => a.init.index - b.init.index);
    left.forEach((v, i) => {
      v.init.index = i + 1;
      v.init.count = left.length;
      this.deps.notify?.(v.win.senderId, {
        index: i + 1,
        count: left.length,
        notice: v.init.primary ? `Screen ${view.init.index} could not be frozen; it is live.` : null,
      });
    });
  }

  /**
   * A display was added, removed or changed. Windows sized for the old layout are wrong, so the
   * freeze is cancelled (unsaved) rather than left covering the wrong area (APP-7).
   */
  displaysChanged(): void {
    if (this.views.size > 0) void this.cancel();
    else if (this.opening) this.displaysChangedWhileOpening = true;
  }

  private async end(result: { cancelled: boolean; annotations: ExplainAnnotationInput[] }): Promise<ActionResult> {
    if (this.ending || this.views.size === 0) return { ok: false, error: "The screen is not frozen." };
    this.ending = true;
    try {
      const res = await this.deps.endExplain(result);
      return res.ok ? { ok: true } : { ok: false, error: res.error };
    } catch (error) {
      this.deps.log?.warn("ending the freeze failed:", error instanceof Error ? error.message : error);
      return { ok: false, error: "Could not end the freeze." };
    } finally {
      // Whatever the recorder said, the overlay must never outlive the request to close it (APP-1).
      this.closeAll();
      this.ending = false;
    }
  }

  private windowClosed(senderId: number): void {
    if (!this.views.has(senderId)) return; // closed by us (Done, Cancel or abort)
    this.views.delete(senderId);
    // Every window gone without Done or Esc (a display was unplugged): the freeze is over, unsaved.
    if (this.views.size === 0 && !this.ending && !this.opening) {
      this.releaseEscapeShortcut();
      this.ending = true;
      void this.deps
        .endExplain({ cancelled: true, annotations: [] })
        .catch((error) => this.deps.log?.warn("ending the freeze failed:", error))
        .finally(() => {
          this.ending = false;
        });
    }
  }

  private releaseEscapeShortcut(): void {
    const release = this.releaseEscape;
    this.releaseEscape = null;
    try {
      release?.();
    } catch (error) {
      this.deps.log?.warn("could not release the Escape shortcut:", error instanceof Error ? error.message : error);
    }
  }

  private closeAll(): void {
    this.releaseEscapeShortcut();
    const views = [...this.views.values()];
    this.views.clear();
    for (const v of views) {
      try {
        if (!v.win.isDestroyed()) v.win.destroy();
      } catch {
        // already gone
      }
    }
  }
}
