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
  /** The freeze must end: the primary overlay cannot be shown or has died. */
  onFailure(reason: string): void;
  /** A secondary display's overlay failed: drop just that window and keep the freeze (D5). */
  onSecondaryFailure?(reason: string): void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  log?: { warn(...a: unknown[]): void; info?(...a: unknown[]): void };
  /** Clock for the measured time-to-ready. */
  now?: () => number;
  /** The focus retry did not give this window the keyboard (Windows foreground lock). */
  onFocusFailed?(): void;
}

/**
 * How long a hidden overlay may take to draw its frozen frame before the freeze is cancelled. It is only a
 * kill switch for a page that is dead: the window stays hidden until `freezeReady`, so a slow machine
 * (two 4K displays, a cold start) just waits. The measured time-to-ready is logged to tune this.
 */
export const OVERLAY_READY_TIMEOUT_MS = 8000;

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
  const now = opts.now ?? (() => Date.now());
  const createdAt = now();
  let wantFocus = false;
  let revealed = false;
  let failed = false;
  let focusTimer: unknown = null;

  const fail = (reason: string) => {
    if (failed) return;
    failed = true;
    opts.log?.warn(`freeze overlay failed: ${reason}`);
    // D5: a secondary display's overlay (one that was never asked to take the keyboard) is dropped on its
    // own; cancelling the whole freeze would discard what was drawn on the primary. Only the primary
    // failing ends the freeze.
    if (!wantFocus && opts.onSecondaryFailure) opts.onSecondaryFailure(reason);
    else opts.onFailure(reason);
  };

  // The primary overlay must really hold the keyboard, or typed text goes to the app underneath. Check
  // shortly after the reveal, on every platform (D4). Windows can refuse focus() while another app holds the
  // foreground lock, so only there is the retry an always-on-top toggle plus focus().
  const ensureFocus = () => {
    if (win.isDestroyed()) return;
    focusTimer = setTimer(() => {
      focusTimer = null;
      if (win.isDestroyed() || win.isFocused()) return;
      if (opts.platform === "win32") {
        win.setAlwaysOnTop(false);
        win.setAlwaysOnTop(true, "screen-saver");
      }
      win.focus();
      // One more look after the retry: only a window that still has no keyboard needs the banner (N5).
      focusTimer = setTimer(() => {
        focusTimer = null;
        if (!win.isDestroyed() && !win.isFocused()) opts.onFocusFailed?.();
      }, focusCheckMs);
    }, focusCheckMs);
  };

  const reveal = () => {
    if (revealed || failed || win.isDestroyed()) return;
    revealed = true;
    opts.log?.info?.(`freeze overlay ready in ${now() - createdAt} ms`);
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

  // Focus lost later (another app grabbed it, or the user clicked away): the banner comes back (D4).
  win.on("blur", () => {
    if (revealed && wantFocus && !win.isDestroyed()) opts.onFocusFailed?.();
  });

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
