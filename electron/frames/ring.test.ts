import assert from "node:assert/strict";
import test from "node:test";

import { displaysForEvent, displaysPayload, layoutChanged } from "../../common/handover/displays";
import type { RecEvent } from "../../common/types";
import { FrameRing, type RingFrame } from "./ring";

const frame = (displayId: number, epoch: number): RingFrame => ({
  displayId, epoch, width: 10, height: 10, data: new Uint8Array(100),
});

test("the ring keeps about two seconds per display and drops older frames", () => {
  const ring = new FrameRing(2200);
  for (let t = 0; t <= 5000; t += 333) ring.push(frame(1, 1_000_000 + t));
  const held = ring.count(1);
  assert.ok(held >= 6 && held <= 8, `kept ${held} frames`); // ~2.2 s at 3 fps
  assert.ok(ring.latest(1)!.epoch - 1_000_000 > 4900);
  // Displays are independent.
  ring.push(frame(2, 1_000_000));
  assert.equal(ring.count(2), 1);
  assert.deepEqual(ring.displayIds().sort(), [1, 2]);
});

test("a stalled display keeps its last frames instead of emptying the ring", () => {
  const ring = new FrameRing(2200);
  ring.push(frame(1, 1000));
  ring.push(frame(1, 1300));
  assert.equal(ring.count(1), 2);
  ring.push(frame(2, 99_000)); // another display moves on; display 1 is untouched
  assert.equal(ring.count(1), 2);
});

test("newestBefore returns the newest frame at least 50 ms before the epoch", () => {
  const ring = new FrameRing();
  for (const t of [100, 400, 700, 960, 990]) ring.push(frame(1, 10_000 + t));
  // 10,960 and 10,990 are only 40 and 10 ms before the click, so 10,700 wins.
  assert.equal(ring.newestBefore(1, 11_000)!.epoch, 10_700);
  assert.equal(ring.newestBefore(1, 11_000, 10)!.epoch, 10_990);
  assert.equal(ring.newestBefore(1, 11_010)!.epoch, 10_960);
  assert.equal(ring.newestBefore(1, 10_120), undefined);
  assert.equal(ring.newestBefore(9, 11_000), undefined);
});

test("memory use is bounded by the age window", () => {
  const ring = new FrameRing(2200);
  const big = (t: number): RingFrame => ({ displayId: 1, epoch: t, width: 2560, height: 1440, data: new Uint8Array(400_000) });
  for (let t = 0; t < 60_000; t += 333) ring.push(big(t));
  assert.ok(ring.bytes() <= 8 * 400_000, `held ${ring.bytes()} bytes`);
});

test("displays payload: macOS points and Windows virtual px, with a negative origin", () => {
  const displays = [
    { id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 }, size: { width: 1440, height: 900 }, scaleFactor: 2 },
    { id: 2, bounds: { x: -1280, y: -100, width: 1280, height: 720 }, size: { width: 1280, height: 720 }, scaleFactor: 2 },
  ];
  const mac = displaysPayload({ platform: "darwin", displays, primaryId: 1 });
  assert.equal(mac.globalSpace, "macos_global_points");
  assert.deepEqual(mac.displays[1], { id: 2, originGlobal: [-1280, -100], sizeDpx: [2560, 1440], scaleFactor: 2, primary: false });
  assert.deepEqual(mac.displays[0].sizeDpx, [2880, 1800]);

  // Windows: bounds are DIP, so the origin goes through dipToScreenPoint (x1.5 here).
  const winDisplays = [
    { id: 7, bounds: { x: 0, y: 0, width: 1280, height: 720 }, size: { width: 1280, height: 720 }, scaleFactor: 1.5 },
    { id: 8, bounds: { x: -1280, y: 100, width: 1280, height: 720 }, size: { width: 1280, height: 720 }, scaleFactor: 1.5 },
  ];
  const win = displaysPayload({
    platform: "win32", displays: winDisplays, primaryId: 7,
    dipToScreenPoint: (p) => ({ x: p.x * 1.5, y: p.y * 1.5 }),
  });
  assert.equal(win.globalSpace, "windows_virtual_px");
  assert.deepEqual(win.displays[1].originGlobal, [-1920, 150]);
  assert.deepEqual(win.displays[1].sizeDpx, [1920, 1080]);
  assert.equal(win.displays[0].primary, true);
});

test("layoutChanged compares layouts; displaysForEvent picks the click's display or all", () => {
  const displays = [
    { id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 }, size: { width: 1440, height: 900 }, scaleFactor: 2 },
    { id: 2, bounds: { x: -1280, y: -100, width: 1280, height: 720 }, size: { width: 1280, height: 720 }, scaleFactor: 2 },
  ];
  const layout = displaysPayload({ platform: "darwin", displays, primaryId: 1 });
  assert.equal(layoutChanged(null, layout), true);
  assert.equal(layoutChanged(layout, structuredClone(layout)), false);
  assert.equal(layoutChanged(layout, { ...layout, displays: [layout.displays[0]] }), true);
  const click = (x: number, y: number): RecEvent => ({ seq: 0, t: 0, epoch: 0, type: "pointer.click", source: "t", payload: { button: "left", clickCount: 1, space: "macos_global_points", x, y } });
  assert.deepEqual(displaysForEvent(click(-700, 250), layout), [2]);
  assert.deepEqual(displaysForEvent(click(300, 300), layout), [1]);
  const sw: RecEvent = { seq: 1, t: 0, epoch: 0, type: "app.activate", source: "t", payload: { app: "X", title: "" } };
  assert.deepEqual(displaysForEvent(sw, layout), [1, 2]);
  assert.deepEqual(displaysForEvent(sw, null), []);
});
