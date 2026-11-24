// APP-1 and APP-2: the overlay adapter cancels the freeze when the overlay cannot be shown or has died,
// and on Windows checks that the window really got the keyboard.

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { adaptOverlayWindow, OVERLAY_READY_TIMEOUT_MS, type OverlayBrowserWindowLike } from "./overlay-window";

class FakeWin extends EventEmitter {
  readonly webContents = Object.assign(new EventEmitter(), { id: 7 });
  destroyed = false;
  focused = false;
  acceptFocus = true;
  calls: string[] = [];
  isDestroyed() { return this.destroyed; }
  show() { this.calls.push("show"); }
  showInactive() { this.calls.push("showInactive"); }
  focus() { this.calls.push("focus"); if (this.acceptFocus) this.focused = true; }
  moveTop() { this.calls.push("moveTop"); }
  isFocused() { return this.focused; }
  setAlwaysOnTop(flag: boolean, level?: string) { this.calls.push(`top:${flag}${level ? `:${level}` : ""}`); }
  destroy() { this.destroyed = true; this.emit("closed"); }
}

/** A manual clock so no real timer runs. */
function clock() {
  const timers: { fn: () => void; ms: number; live: boolean }[] = [];
  return {
    setTimer: (fn: () => void, ms: number) => { const t = { fn, ms, live: true }; timers.push(t); return t; },
    clearTimer: (h: unknown) => { (h as { live: boolean }).live = false; },
    // A snapshot: a timer armed by a firing timer waits for the next fire().
    fire: (ms: number) => { for (const t of [...timers]) if (t.live && t.ms === ms) { t.live = false; t.fn(); } },
  };
}

function make(platform: NodeJS.Platform = "win32", revealTimeoutMs = 1500) {
  const win = new FakeWin();
  const failures: string[] = [];
  const infos: string[] = [];
  const focusFailed: number[] = [];
  const c = clock();
  let nowMs = 1000;
  const adapter = adaptOverlayWindow(win as unknown as OverlayBrowserWindowLike, {
    platform,
    revealTimeoutMs,
    focusCheckMs: 100,
    onFailure: (r) => failures.push(r),
    onFocusFailed: () => focusFailed.push(1),
    setTimer: c.setTimer,
    clearTimer: c.clearTimer,
    now: () => nowMs,
    log: { warn: () => {}, info: (...a) => infos.push(a.join(" ")) },
  });
  return { win, failures, infos, focusFailed, c, adapter, advance: (ms: number) => { nowMs += ms; } };
}

test("N1: a slow overlay is not cancelled at 1.5 s; it stays hidden, is shown when ready, and its time-to-ready is logged", () => {
  const { win, failures, infos, c, adapter, advance } = make("win32", OVERLAY_READY_TIMEOUT_MS);
  assert.equal(OVERLAY_READY_TIMEOUT_MS, 8000);
  c.fire(1500); // nothing is armed at 1.5 s any more
  advance(4200); // a slow laptop with two 4K displays
  assert.deepEqual(failures, []);
  assert.deepEqual(win.calls, [], "hidden until freezeReady");
  adapter.ready();
  assert.deepEqual(win.calls, ["showInactive", "moveTop"]);
  assert.deepEqual(infos, ["freeze overlay ready in 4200 ms"]);
  c.fire(8000);
  assert.deepEqual(failures, [], "the kill switch is disarmed once shown");
});

test("N1: a dead page is still cancelled, at the 8 s kill switch", () => {
  const { failures, c } = make("win32", OVERLAY_READY_TIMEOUT_MS);
  c.fire(8000);
  assert.equal(failures.length, 1);
});

test("N5: the overlay is told only when focus is still refused after the retry", () => {
  const stuck = make("win32");
  stuck.win.acceptFocus = false;
  stuck.adapter.overlay.focus();
  stuck.adapter.ready();
  stuck.c.fire(100); // first check: retry
  assert.deepEqual(stuck.focusFailed, [], "not yet: the retry may work");
  stuck.c.fire(100); // second check
  assert.deepEqual(stuck.focusFailed, [1]);

  const healed = make("win32");
  healed.win.acceptFocus = false;
  healed.adapter.overlay.focus();
  healed.adapter.ready();
  healed.c.fire(100); // retry
  healed.win.focused = true; // the retry worked
  healed.c.fire(100);
  assert.deepEqual(healed.focusFailed, []);
});

test("did-fail-load on the main frame cancels the freeze; an aborted navigation and a sub-frame do not", () => {
  const { win, failures } = make();
  win.webContents.emit("did-fail-load", {}, -3, "ERR_ABORTED", "file:///x", true);
  win.webContents.emit("did-fail-load", {}, -105, "x", "file:///x", false);
  assert.deepEqual(failures, []);
  win.webContents.emit("did-fail-load", {}, -6, "ERR_FILE_NOT_FOUND", "file:///x", true);
  assert.equal(failures.length, 1);
});

test("render-process-gone and unresponsive cancel the freeze", () => {
  const gone = make();
  gone.win.webContents.emit("render-process-gone", {}, { reason: "crashed" });
  assert.equal(gone.failures.length, 1);

  const hung = make();
  hung.win.emit("unresponsive");
  assert.equal(hung.failures.length, 1);
});

test("the reveal timeout firing before the page is ready cancels instead of showing a black window", () => {
  const { win, failures, c } = make();
  c.fire(1500);
  assert.equal(failures.length, 1);
  assert.deepEqual(win.calls, [], "never shown");
});

test("a page that became ready in time is shown, and the late timeout is harmless", () => {
  const { win, failures, c, adapter } = make();
  adapter.ready();
  assert.deepEqual(win.calls, ["showInactive", "moveTop"], "no focus unless asked");
  c.fire(1500);
  assert.deepEqual(failures, []);
});

test("the primary overlay shows and focuses; failures are reported once", () => {
  const { win, failures, adapter } = make("darwin");
  adapter.overlay.focus();
  adapter.ready();
  assert.deepEqual(win.calls, ["show", "focus", "moveTop"]);
  win.webContents.emit("render-process-gone", {}, {});
  win.emit("unresponsive");
  assert.equal(failures.length, 1);
});

test("APP-2: on Windows a refused focus is retried with an always-on-top toggle", () => {
  const { win, c, adapter } = make("win32");
  win.acceptFocus = false;
  adapter.overlay.focus();
  adapter.ready();
  win.calls.length = 0;
  c.fire(100);
  assert.deepEqual(win.calls, ["top:false", "top:true:screen-saver", "focus"]);
});

test("APP-2: no retry when the window has the keyboard, and none off Windows", () => {
  const ok = make("win32");
  ok.adapter.overlay.focus();
  ok.adapter.ready();
  ok.win.calls.length = 0;
  ok.c.fire(100);
  assert.deepEqual(ok.win.calls, []);

  const mac = make("darwin");
  mac.win.acceptFocus = false;
  mac.adapter.overlay.focus();
  mac.adapter.ready();
  mac.win.calls.length = 0;
  mac.c.fire(100);
  assert.deepEqual(mac.win.calls, []);
});

test("Escape on the overlay page calls back and is swallowed", () => {
  const { win, adapter } = make();
  let escaped = 0;
  adapter.overlay.onEscape(() => escaped++);
  let prevented = 0;
  win.webContents.emit("before-input-event", { preventDefault: () => prevented++ }, { type: "keyDown", key: "a" });
  win.webContents.emit("before-input-event", { preventDefault: () => prevented++ }, { type: "keyDown", key: "Escape" });
  assert.deepEqual([escaped, prevented], [1, 1]);
});
