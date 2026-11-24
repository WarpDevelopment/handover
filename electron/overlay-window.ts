// Adapts one overlay BrowserWindow to the freeze coordinator's OverlayWindow (APP-1, APP-2). Electron-free:
// the window is described structurally, so the reveal, failure and focus logic is unit-tested with fakes.
//
// An opaque always-on-top window that never painted, or whose renderer died, covers the whole display and
// cannot be dismissed from inside. So: any load failure, crash, hang, or a reveal timeout that fires before
// the page said it was ready, cancels the freeze instead of showing a black window.

import type { OverlayWindow } from "./freeze";

type Listener = (...args: any[]) => void; // -- structural mirror of Node/Electron emitter signatures

export interface OverlayWebContentsLike {
  readonly id: number;
  on(event: string, listener: Listener): unknown;
}

export interface OverlayBrowserWindowLike {
  readonly webContents: OverlayWebContentsLike;
  isDestroyed(): boolean;
  show(): void;
  showInactive(): void;
  focus(): void;
  moveTop(): void;
  isFocused(): boolean;
  setAlwaysOnTop(flag: boolean, level?: string): void;
  destroy(): void;
  once(event: "closed", listener: () => void): unknown;
  on(event: string, listener: Listener): unknown;
}

export interface OverlayAdapterOptions {
  platform: NodeJS.Platform;
  /** How long to wait for the page's ready signal before giving up on it. */
  revealTimeoutMs: number;
  /** After a reveal on Windows, how long before checking that the window really has the keyboard. */
  focusCheckMs?: number;
  /** The freeze must end: the overlay cannot be shown or has died. */
  onFailure(reason: string): void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  log?: { warn(...a: unknown[]): void };
}

export interface OverlayAdapter {
  overlay: OverlayWindow;
  /** The page has drawn the frozen frame: show the window. */
  ready(): void;
}

/** Chromium's ERR_ABORTED: a navigation replaced by another, not a failure. */
const ERR_ABORTED = -3;

export function adaptOverlayWindow(win: OverlayBrowserWindowLike, opts: OverlayAdapterOptions): OverlayAdapter {
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout));
  const focusCheckMs = opts.focusCheckMs ?? 100;
  let wantFocus = false;
  let revealed = false;
  let failed = false;
  let focusTimer: unknown = null;

  const fail = (reason: string) => {
    if (failed) return;
    failed = true;
    opts.log?.warn(`freeze overlay failed: ${reason}`);
    opts.onFailure(reason);
  };

  // Windows can refuse focus() while another app holds the foreground lock; typed text would then go to
  // the app underneath. Check shortly after the reveal and retry once with an always-on-top toggle.
  const ensureFocus = () => {
    if (opts.platform !== "win32" || win.isDestroyed()) return;
    focusTimer = setTimer(() => {
      focusTimer = null;
      if (win.isDestroyed() || win.isFocused()) return;
      win.setAlwaysOnTop(false);
      win.setAlwaysOnTop(true, "screen-saver");
      win.focus();
    }, focusCheckMs);
  };

  const reveal = () => {
    if (revealed || failed || win.isDestroyed()) return;
    revealed = true;
    // Only the display under the pointer takes the keyboard; the others appear without stealing it,
    // whichever of them finishes loading last.
    if (wantFocus) {
      win.show();
      win.focus();
      ensureFocus();
    } else {
      win.showInactive();
    }
    win.moveTop();
  };

  const timer = setTimer(() => {
    // Not ready in time: the page never drew the frame. Revealing would show a black window.
    if (!revealed) fail("the overlay page was not ready in time");
  }, opts.revealTimeoutMs);

  win.webContents.on("did-fail-load", (_event: unknown, errorCode: number, _desc: string, _url: string, isMainFrame: boolean) => {
    if (isMainFrame === false || errorCode === ERR_ABORTED) return;
    fail(`the overlay page failed to load (${errorCode})`);
  });
  win.webContents.on("render-process-gone", (_event: unknown, details?: { reason?: string }) => {
    fail(`the overlay renderer is gone (${details?.reason ?? "unknown"})`);
  });
  win.on("unresponsive", () => fail("the overlay is not responding"));
  win.webContents.on("unresponsive", () => fail("the overlay is not responding"));

  win.once("closed", () => {
    clearTimer(timer);
    if (focusTimer !== null) clearTimer(focusTimer);
  });

  const overlay: OverlayWindow = {
    senderId: win.webContents.id,
    // Shown by the page's "ready" signal, never earlier.
    show: () => undefined,
    focus: () => {
      wantFocus = true;
      if (revealed && !win.isDestroyed()) {
        win.focus();
        ensureFocus();
      }
    },
    destroy: () => {
      if (!win.isDestroyed()) win.destroy();
    },
    isDestroyed: () => win.isDestroyed(),
    onClosed: (cb) => {
      win.once("closed", cb);
    },
    onEscape: (cb) => {
      win.webContents.on("before-input-event", (event: { preventDefault(): void }, input: { type: string; key: string }) => {
        if (input.type !== "keyDown" || input.key !== "Escape") return;
        event.preventDefault();
        cb();
      });
    },
  };
  return { overlay, ready: reveal };
}
