// L4: the freeze flow with fake windows: one overlay per display, Done saves, Esc and Cancel discard.

import assert from "node:assert/strict";
import test from "node:test";

import { overlayBounds } from "../common/handover/overlay-geometry";
import { FreezeCoordinator, type DisplayLike, type FreezeDeps, type OverlayWindow } from "./freeze";
import type { BeginExplainResult, EndExplainResult } from "./recorder/controller";

class FakeWindow implements OverlayWindow {
  shown = false;
  focused = false;
  destroyed = false;
  private closed: (() => void)[] = [];
  private escape: (() => void)[] = [];
  constructor(readonly senderId: number, readonly display: DisplayLike) {}
  show(): void { this.shown = true; }
  focus(): void { this.focused = true; }
  destroy(): void { this.destroyed = true; }
  isDestroyed(): boolean { return this.destroyed; }
  onClosed(cb: () => void): void { this.closed.push(cb); }
  onEscape(cb: () => void): void { this.escape.push(cb); }
  pressEscape(): void { for (const cb of this.escape) cb(); }
  closeFromOutside(): void { for (const cb of this.closed) cb(); }
}

// A Windows laptop panel at 125% beside a 4K monitor at 150%, the second to the right.
const DISPLAYS: DisplayLike[] = [
  { id: 11, bounds: { x: 0, y: 0, width: 1536, height: 864 }, size: { width: 1536, height: 864 }, scaleFactor: 1.25 },
  { id: 22, bounds: { x: 1536, y: 0, width: 2560, height: 1440 }, size: { width: 2560, height: 1440 }, scaleFactor: 1.5 },
];

function setup(
  opts: {
    begin?: BeginExplainResult;
    cursor?: number;
    failOpenAt?: number;
    order?: string[];
    endThrows?: boolean;
    beginGate?: Promise<void>;
  } = {},
) {
  const windows: FakeWindow[] = [];
  const ended: unknown[] = [];
  const escape = { registered: 0, released: 0, held: false, fire: () => {} };
  let activated = 0;
  const deps: FreezeDeps = {
    registerEscape: (cb) => {
      escape.registered++;
      escape.held = true;
      escape.fire = cb;
      return () => {
        escape.released++;
        escape.held = false;
      };
    },
    beginExplain: async () => {
      await opts.beginGate;
      return opts.begin ?? {
        ok: true,
        sessionDir: "/s",
        frames: [
          { file: "shots/000001.jpg", displayId: 11, epoch: 1 },
          { file: "shots/000002.jpg", displayId: 22, epoch: 1 },
        ],
      };
    },
    endExplain: async (r): Promise<EndExplainResult> => {
      ended.push(r);
      if (opts.endThrows) throw new Error("recorder gone");
      return { ok: true, annotationIds: [] };
    },
    getDisplays: () => DISPLAYS,
    cursorDisplayId: () => opts.cursor ?? 22,
    readFrame: async (_dir, f) => {
      opts.order?.push(`read ${f.displayId}`);
      return `data:image/jpeg;base64,${f.file}`;
    },
    openWindow: (display) => {
      opts.order?.push(`open ${display.id}`);
      if (opts.failOpenAt !== undefined && windows.length === opts.failOpenAt) throw new Error("no window for you");
      const w = new FakeWindow(100 + windows.length, display);
      windows.push(w);
      return w;
    },
    activateApp: () => { activated++; },
  };
  return { freeze: new FreezeCoordinator(deps), windows, ended, escape, activated: () => activated };
}

const rect = (displayId: number) => ({
  kind: "highlight" as const, displayId, shape: "rect" as const, pointsDpx: [[10, 10], [50, 40]] as [number, number][],
});

test("one overlay window per display, each with its own frame and DPI geometry; the display under the pointer takes focus", async () => {
  const { freeze, windows, activated } = setup({ cursor: 22 });
  assert.deepEqual(await freeze.begin(), { ok: true });
  assert.equal(windows.length, 2, "one window per display");
  assert.deepEqual(windows.map((w) => w.display.id), [11, 22]);
  assert.ok(windows.every((w) => w.shown));
  assert.deepEqual(windows.map((w) => w.focused), [false, true]);
  assert.equal(activated(), 1);

  const a = freeze.init(100)!;
  const b = freeze.init(101)!;
  assert.deepEqual([a.displayId, a.sizeDpx, a.scaleFactor, a.cssSize, a.index, a.count, a.primary], [11, [1920, 1080], 1.25, [1536, 864], 1, 2, false]);
  assert.deepEqual([b.displayId, b.sizeDpx, b.scaleFactor, b.cssSize, b.index, b.count, b.primary], [22, [3840, 2160], 1.5, [2560, 1440], 2, 2, true]);
  assert.equal(a.frame, "data:image/jpeg;base64,shots/000001.jpg");
  assert.equal(freeze.init(999), null, "only freeze windows can ask");
  assert.equal(freeze.active, true);
  // A second freeze while one is open is refused.
  assert.deepEqual(await freeze.begin(), { ok: false, error: "The screen is already frozen." });
});

test("overlay windows are placed on their own display's bounds", () => {
  assert.deepEqual(overlayBounds(DISPLAYS[1]), { x: 1536, y: 0, width: 2560, height: 1440 });
  assert.deepEqual(
    overlayBounds({ bounds: { x: -1920.4, y: 12.6, width: 1920.2, height: 1080 } }),
    { x: -1920, y: 13, width: 1920, height: 1080 },
  );
});

test("Done saves every display's shapes and one joined comment, then closes every window", async () => {
  const { freeze, windows, ended } = setup();
  await freeze.begin();
  freeze.setState(100, { cancelled: false, annotations: [rect(11), { kind: "comment", text: "left note" }] });
  // The renderer cannot claim another display: the window's own display wins.
  freeze.setState(101, { cancelled: false, annotations: [{ ...rect(11), shape: "arrow" }, { kind: "comment", text: "  right note " }, { kind: "comment", text: "  " }] });
  freeze.setState(555, { annotations: [rect(11)] }); // not a freeze window: ignored
  assert.deepEqual(await freeze.done(100), { ok: true });
  assert.equal(ended.length, 1);
  assert.deepEqual(ended[0], {
    cancelled: false,
    annotations: [
      rect(11),
      { ...rect(22), shape: "arrow" },
      { kind: "comment", text: "left note\n\nright note" },
    ],
  });
  assert.ok(windows.every((w) => w.destroyed));
  assert.equal(freeze.active, false);
  assert.deepEqual(await freeze.done(100), { ok: false, error: "Not a freeze window." });
});

test("Esc in any window and the Cancel button discard everything", async () => {
  const esc = setup();
  await esc.freeze.begin();
  esc.freeze.setState(100, { annotations: [rect(11), { kind: "comment", text: "will be lost" }] });
  esc.windows[1].pressEscape();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(esc.ended, [{ cancelled: true, annotations: [] }]);
  assert.ok(esc.windows.every((w) => w.destroyed));

  const btn = setup();
  await btn.freeze.begin();
  btn.freeze.setState(101, { annotations: [rect(22)] });
  assert.deepEqual(await btn.freeze.cancel(101), { ok: true });
  assert.deepEqual(btn.ended, [{ cancelled: true, annotations: [] }]);
  assert.deepEqual(await btn.freeze.cancel(101), { ok: false, error: "Not a freeze window." });
});

test("a failed freeze opens no window; a recording that stops while frozen closes them without a second end", async () => {
  const failed = setup({ begin: { ok: false, error: "Screen capture is not available." } });
  assert.deepEqual(await failed.freeze.begin(), { ok: false, error: "Screen capture is not available." });
  assert.equal(failed.windows.length, 0);
  assert.equal(failed.freeze.active, false);

  const stopped = setup();
  await stopped.freeze.begin();
  stopped.freeze.abort();
  assert.ok(stopped.windows.every((w) => w.destroyed));
  assert.deepEqual(stopped.ended, [], "the controller wrote explain.end itself");
  for (const w of stopped.windows) w.closeFromOutside(); // the late 'closed' events are harmless
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(stopped.ended, []);
  assert.equal(stopped.freeze.active, false);
});

test("when every window disappears without Done or Esc (a display was unplugged) the freeze ends unsaved", async () => {
  const { freeze, windows, ended } = setup();
  await freeze.begin();
  freeze.setState(100, { annotations: [rect(11)] });
  windows[0].closeFromOutside();
  assert.equal(ended.length, 0, "one window left: the freeze goes on");
  windows[1].closeFromOutside();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(ended, [{ cancelled: true, annotations: [] }]);
});

test("if a window cannot be opened after the recorder froze, the freeze is ended and nothing stays open", async () => {
  const { freeze, windows, ended } = setup({ failOpenAt: 1 });
  const res = await freeze.begin();
  assert.deepEqual(res, { ok: false, error: "Could not show the frozen screen." });
  assert.equal(windows.length, 1, "the first window had opened");
  assert.ok(windows[0].destroyed, "and was closed again");
  assert.deepEqual(ended, [{ cancelled: true }], "the recorder is told, so clicks are recorded again");
  assert.equal(freeze.active, false);
  assert.equal(freeze.init(100), null);
  // A later freeze works.
  const again = setup();
  assert.deepEqual(await again.freeze.begin(), { ok: true });
});

test("a failing beginExplain leaves nothing open and no freeze to end", async () => {
  const deps: FreezeDeps = {
    beginExplain: async () => { throw new Error("boom"); },
    endExplain: async () => { throw new Error("must not be called"); },
    getDisplays: () => DISPLAYS,
    cursorDisplayId: () => 11,
    readFrame: async () => "",
    openWindow: () => { throw new Error("must not be called"); },
  };
  const freeze = new FreezeCoordinator(deps);
  assert.deepEqual(await freeze.begin(), { ok: false, error: "Could not freeze the screen." });
  assert.equal(freeze.active, false);
});

test("every frame is read before any window is opened", async () => {
  const order: string[] = [];
  const { freeze } = setup({ order });
  await freeze.begin();
  assert.deepEqual(order, ["read 11", "read 22", "open 11", "open 22"]);
});

test("frames for a display that is gone are skipped; with none left the freeze is ended", async () => {
  const partial = setup({
    begin: { ok: true, sessionDir: "/s", frames: [{ file: "shots/000001.jpg", displayId: 11, epoch: 1 }, { file: "shots/000009.jpg", displayId: 99, epoch: 1 }] },
    cursor: 11,
  });
  assert.deepEqual(await partial.freeze.begin(), { ok: true });
  assert.equal(partial.windows.length, 1);
  assert.equal(partial.freeze.init(100)!.count, 1);

  const none = setup({ begin: { ok: true, sessionDir: "/s", frames: [{ file: "shots/000009.jpg", displayId: 99, epoch: 1 }] } });
  const res = await none.freeze.begin();
  assert.equal(res.ok, false);
  assert.deepEqual(none.ended, [{ cancelled: true }]);
  assert.equal(none.windows.length, 0);
});

test("APP-1: Escape is registered globally only during a freeze and released when it closes", async () => {
  const done = setup();
  assert.equal(done.escape.registered, 0, "not held before a freeze");
  await done.freeze.begin();
  assert.equal(done.escape.held, true);
  await done.freeze.done(100);
  assert.equal(done.escape.held, false);
  assert.equal(done.escape.released, 1);

  const esc = setup();
  await esc.freeze.begin();
  esc.escape.fire(); // the global Escape, with no overlay page involved
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(esc.ended, [{ cancelled: true, annotations: [] }]);
  assert.equal(esc.escape.held, false);
  assert.ok(esc.windows.every((w) => w.destroyed));

  const stopped = setup();
  await stopped.freeze.begin();
  stopped.freeze.abort();
  assert.equal(stopped.escape.held, false, "released when the recording stops");
});

test("APP-1: the overlay closes even when ending the freeze in the recorder throws", async () => {
  const { freeze, windows, escape } = setup({ endThrows: true });
  await freeze.begin();
  const res = await freeze.cancel();
  assert.equal(res.ok, false);
  assert.ok(windows.every((w) => w.destroyed), "no black window is left behind");
  assert.equal(escape.held, false);
  assert.equal(freeze.active, false, "a later Explain is not refused");
});

test("APP-6: a recording that stops while a freeze is opening opens no windows", async () => {
  let release!: () => void;
  const beginGate = new Promise<void>((r) => { release = r; });
  const { freeze, windows, ended, escape } = setup({ beginGate });
  const pending = freeze.begin();
  freeze.abort(); // the controller stopped the recording; it wrote explain.end itself
  release();
  const res = await pending;
  assert.equal(res.ok, false);
  assert.equal(windows.length, 0);
  assert.deepEqual(ended, [], "no second explain.end");
  assert.equal(escape.registered, 0);
  assert.equal(freeze.active, false);
});

test("APP-7: a display change cancels an open freeze, and one that arrives while opening", async () => {
  const open = setup();
  await open.freeze.begin();
  open.freeze.displaysChanged();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(open.ended, [{ cancelled: true, annotations: [] }]);
  assert.ok(open.windows.every((w) => w.destroyed));

  let release!: () => void;
  const beginGate = new Promise<void>((r) => { release = r; });
  const opening = setup({ beginGate });
  const pending = opening.freeze.begin();
  opening.freeze.displaysChanged();
  release();
  assert.equal((await pending).ok, false);
  assert.equal(opening.windows.length, 0);
  assert.deepEqual(opening.ended, [{ cancelled: true }]);

  const idle = setup();
  idle.freeze.displaysChanged(); // nothing frozen: harmless
  assert.equal(idle.freeze.active, false);
});
