import assert from "node:assert/strict";
import test from "node:test";

import type { DisplaysPayload } from "../events";
import {
  captureSize,
  cropToFpx,
  displayForGlobalPoint,
  dpxToFpx,
  dpxToGlobal,
  estTokens,
  expectedFrameScale,
  fitFullImage,
  fpxToCrop,
  fpxToDpx,
  globalToDpx,
  planCrop,
  selectBeforeFrame,
} from "./geometry";

const mac: DisplaysPayload = {
  globalSpace: "macos_global_points",
  displays: [
    { id: 1, originGlobal: [0, 0], sizeDpx: [2880, 1800], scaleFactor: 2, primary: true },
    { id: 2, originGlobal: [-1280, -100], sizeDpx: [2560, 1440], scaleFactor: 2, primary: false },
  ],
};
const win: DisplaysPayload = {
  globalSpace: "windows_virtual_px",
  displays: [
    { id: 10, originGlobal: [0, 0], sizeDpx: [1920, 1080], scaleFactor: 1.5, primary: true },
    { id: 11, originGlobal: [-2560, 200], sizeDpx: [2560, 1440], scaleFactor: 1, primary: false },
  ],
};

test("fitFullImage respects the 1,568 long edge and the 1,568 token budget", () => {
  for (const [w, h] of [[2560, 1600], [2560, 1440], [1920, 1080], [800, 500], [3840, 2160], [1080, 1920], [100, 100]]) {
    const out = fitFullImage(w, h);
    assert.ok(Math.max(out.width, out.height) <= 1568, `${w}x${h} long edge`);
    assert.ok(estTokens(out.width, out.height) <= 1568, `${w}x${h} tokens`);
    // Same aspect ratio within a pixel of rounding.
    assert.ok(Math.abs(out.width / out.height - w / h) < 0.03, `${w}x${h} aspect`);
  }
  // Never upscales.
  assert.deepEqual(fitFullImage(100, 100), { width: 100, height: 100 });
  // A 16:9 frame is limited by tokens, not by the long edge: 1568x882 would be 1,792 tokens.
  const wide = fitFullImage(2560, 1440);
  assert.ok(wide.width < 1568);
  assert.equal(estTokens(1568, 882) > 1568, true);
  // It is the largest size that fits: one pixel more on the long edge would break the budget.
  const bigger = fitFullImage(2560, 1440).width + 1;
  assert.ok(estTokens(bigger, Math.round((bigger * 1440) / 2560)) > 1568 || bigger > 1568);
});

test("est_tokens is ceil(w/28) x ceil(h/28)", () => {
  assert.equal(estTokens(28, 28), 1);
  assert.equal(estTokens(29, 28), 2);
  assert.equal(estTokens(1568, 882), 56 * 32);
});

test("macOS: dpx = (p - originGlobal) x scaleFactor, including a negative origin", () => {
  const d1 = mac.displays[0];
  const d2 = mac.displays[1];
  assert.deepEqual(globalToDpx(mac.globalSpace, d1, 700, 400), [1400, 800]);
  // Negative origin: (-700 - -1280) x 2 = 1160, (250 - -100) x 2 = 700.
  assert.deepEqual(globalToDpx(mac.globalSpace, d2, -700, 250), [1160, 700]);
  assert.deepEqual(dpxToGlobal(mac.globalSpace, d2, 1160, 700), [-700, 250]);
});

test("Windows: dpx = p - originGlobal, including a negative origin", () => {
  const d1 = win.displays[0];
  const d2 = win.displays[1];
  assert.deepEqual(globalToDpx(win.globalSpace, d1, 960, 540), [960, 540]);
  // Scale factor is NOT applied on Windows: virtual-screen coordinates are already physical px.
  assert.deepEqual(globalToDpx(win.globalSpace, d2, -2000, 500), [560, 300]);
  assert.deepEqual(dpxToGlobal(win.globalSpace, d2, 560, 300), [-2000, 500]);
  const d1scaled = globalToDpx(win.globalSpace, d1, 100, 100);
  assert.deepEqual(d1scaled, [100, 100]);
});

test("the display for a global point honours negative origins and Windows px extents", () => {
  assert.equal(displayForGlobalPoint(mac, 700, 400)?.id, 1);
  assert.equal(displayForGlobalPoint(mac, -700, 250)?.id, 2);
  // macOS display 1 is 1,440 points wide, not 2,880.
  assert.equal(displayForGlobalPoint(mac, 1500, 100)?.id, 1); // outside both: nearest
  assert.equal(displayForGlobalPoint(win, 1919, 1079)?.id, 10);
  assert.equal(displayForGlobalPoint(win, -1, 300)?.id, 11);
  assert.equal(displayForGlobalPoint(win, -2560, 200)?.id, 11);
  assert.equal(displayForGlobalPoint({ globalSpace: "windows_virtual_px", displays: [] }, 1, 1), undefined);
});

test("capture is native up to 2,560 px wide", () => {
  assert.deepEqual(captureSize(mac.displays[0]), { width: 2560, height: 1600 });
  assert.deepEqual(captureSize(win.displays[0]), { width: 1920, height: 1080 });
  assert.deepEqual(captureSize({ ...mac.displays[0], sizeDpx: [5120, 2880] }), { width: 2560, height: 1440 });
});

test("the dpx to fpx transform round-trips", () => {
  const d = mac.displays[0];
  const scale = expectedFrameScale(d);
  const src: [number, number, number, number] = [0, 0, d.sizeDpx[0], d.sizeDpx[1]];
  const f = dpxToFpx(src, scale, 1400, 800);
  const back = fpxToDpx(src, scale, f[0], f[1]);
  assert.ok(Math.abs(back[0] - 1400) < 1e-9 && Math.abs(back[1] - 800) < 1e-9);
  // A non-zero source rect origin follows fpx = (dpx - origin) x scale.
  assert.deepEqual(dpxToFpx([100, 50, 0, 0], 0.5, 300, 250), [100, 100]);
});

test("the crop is 800x500 logical px, centred, shifted inside the display, and its transform round-trips", () => {
  const d = mac.displays[0]; // 2,880 x 1,800 dpx, scale 2: crop window is 1,600 x 1,000 dpx
  const full = fitFullImage(2560, 1600);
  const scale = full.width / d.sizeDpx[0];
  const centred = planCrop({ display: d, frameWidth: 2560, frameHeight: 1600, fullScale: scale, centreDpx: [1400, 800] });
  assert.deepEqual(centred.rectDpx, [600, 300, 1600, 1000]);
  assert.ok(centred.out.width <= 800 && centred.out.height <= 500);
  // Near the corner: shifted to stay inside, not cut short.
  const corner = planCrop({ display: d, frameWidth: 2560, frameHeight: 1600, fullScale: scale, centreDpx: [10, 10] });
  assert.deepEqual(corner.rectDpx, [0, 0, 1600, 1000]);
  const far = planCrop({ display: d, frameWidth: 2560, frameHeight: 1600, fullScale: scale, centreDpx: [2870, 1790] });
  assert.deepEqual(far.rectDpx, [1280, 800, 1600, 1000]);
  // Round trip: full-image point -> crop point -> full-image point.
  const p: [number, number] = [500, 300];
  const inCrop = fpxToCrop(centred.originFpx, centred.cropScale, p[0], p[1]);
  const back = cropToFpx(centred.originFpx, centred.cropScale, inCrop[0], inCrop[1]);
  assert.ok(Math.abs(back[0] - p[0]) < 1e-9 && Math.abs(back[1] - p[1]) < 1e-9);
  // The click point (dpx 1400,800) lands at the middle of the crop output.
  const click = dpxToFpx([0, 0, 2880, 1800], scale, 1400, 800);
  const clickInCrop = fpxToCrop(centred.originFpx, centred.cropScale, click[0], click[1]);
  assert.ok(Math.abs(clickInCrop[0] - centred.out.width / 2) < 1);
  assert.ok(Math.abs(clickInCrop[1] - centred.out.height / 2) < 1);
});

test("a display smaller than the crop window gives the whole display", () => {
  const small = { id: 3, originGlobal: [0, 0] as [number, number], sizeDpx: [600, 400] as [number, number], scaleFactor: 1, primary: true };
  const plan = planCrop({ display: small, frameWidth: 600, frameHeight: 400, fullScale: 1, centreDpx: [300, 200] });
  assert.deepEqual(plan.rectDpx, [0, 0, 600, 400]);
  assert.deepEqual(plan.out, { width: 600, height: 400 });
});

test("before-frame selection picks the newest frame at least 50 ms before the click", () => {
  const frames = [{ t: 100, n: "a" }, { t: 900, n: "b" }, { t: 940, n: "c" }, { t: 950, n: "d" }, { t: 990, n: "e" }];
  // Click at 1,000: frames at 951..1000 are too close; 950 is exactly 50 ms before, so it counts.
  assert.equal(selectBeforeFrame(frames, 1000)?.n, "d");
  assert.equal(selectBeforeFrame(frames, 999)?.n, "c");
  assert.equal(selectBeforeFrame(frames, 1000, 100)?.n, "b"); // 900 is the newest at least 100 ms before
  // Order does not matter.
  assert.equal(selectBeforeFrame([...frames].reverse(), 1000)?.n, "d");
  assert.equal(selectBeforeFrame(frames, 120), undefined);
  assert.equal(selectBeforeFrame([], 1000), undefined);
});
