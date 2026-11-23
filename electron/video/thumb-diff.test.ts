import assert from "node:assert/strict";
import test from "node:test";

import { changedPixels, isUnchanged, THUMB_HEIGHT, THUMB_WIDTH } from "./thumb-diff.cjs";

function thumb(fill: [number, number, number]): Uint8ClampedArray {
  const a = new Uint8ClampedArray(THUMB_WIDTH * THUMB_HEIGHT * 4);
  for (let i = 0; i < a.length; i += 4) {
    a[i] = fill[0];
    a[i + 1] = fill[1];
    a[i + 2] = fill[2];
    a[i + 3] = 255;
  }
  return a;
}

/** Paint a rectangle given in thumbnail pixels. */
function paint(a: Uint8ClampedArray, x: number, y: number, w: number, h: number, rgb: [number, number, number]): void {
  for (let row = y; row < y + h; row++) {
    for (let col = x; col < x + w; col++) {
      const o = (row * THUMB_WIDTH + col) * 4;
      a[o] = rgb[0];
      a[o + 1] = rgb[1];
      a[o + 2] = rgb[2];
    }
  }
}

test("an identical or barely different screen is unchanged", () => {
  const a = thumb([30, 30, 30]);
  assert.equal(isUnchanged(a, thumb([30, 30, 30])), true);
  // Sensor-like noise below the channel delta does not count.
  assert.equal(isUnchanged(a, thumb([40, 38, 44])), true);
  // One changed pixel (a mouse cursor) still counts as unchanged.
  const cursor = thumb([30, 30, 30]);
  paint(cursor, 10, 10, 1, 1, [255, 255, 255]);
  assert.equal(isUnchanged(a, cursor), true);
});

test("a dropdown or small dialog is a change, even though it covers a few thumbnail pixels", () => {
  const before = thumb([30, 30, 30]);
  // On a 2,560 x 1,600 frame a 200 x 300 px menu is about 5 x 8 thumbnail pixels.
  const withMenu = thumb([30, 30, 30]);
  paint(withMenu, 20, 10, 5, 8, [240, 240, 240]);
  assert.equal(changedPixels(before, withMenu), 40);
  assert.equal(isUnchanged(before, withMenu), false);
  // Two cursor-sized changes are already more than the cursor allowance.
  const two = thumb([30, 30, 30]);
  paint(two, 5, 5, 2, 1, [255, 255, 255]);
  assert.equal(isUnchanged(before, two), false);
});

test("a first frame, or a different size, is never unchanged", () => {
  const a = thumb([0, 0, 0]);
  assert.equal(isUnchanged(null, a), false);
  assert.equal(isUnchanged(undefined, a), false);
  assert.equal(isUnchanged(new Uint8ClampedArray(8), a), false);
});
