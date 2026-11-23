// L4: DPI-safe overlay coordinates and the checks on what the overlay returns.

import assert from "node:assert/strict";
import test from "node:test";

import { MAX_COMMENT_CHARS, MAX_POINTS, MAX_SHAPES, sanitizeExplainResult } from "./explain";
import { cssToDpx, dpxToCss, overlayCssSize, thinPoints } from "./overlay-geometry";

test("CSS px convert to display physical px with the scale factor, at 100%, 125%, 150%, 200%", () => {
  const cases: { scaleFactor: number; sizeDpx: [number, number]; css: [number, number]; dpx: [number, number] }[] = [
    { scaleFactor: 1, sizeDpx: [1920, 1080], css: [100, 50], dpx: [100, 50] },
    { scaleFactor: 1.25, sizeDpx: [2560, 1440], css: [100, 50], dpx: [125, 63] }, // 62.5 rounds up
    { scaleFactor: 1.5, sizeDpx: [2880, 1620], css: [333, 201], dpx: [500, 302] }, // 499.5 and 301.5
    { scaleFactor: 2, sizeDpx: [2880, 1800], css: [720.25, 0], dpx: [1441, 0] },
  ];
  for (const c of cases) {
    assert.deepEqual(cssToDpx(c.css, c), c.dpx, `scale ${c.scaleFactor}`);
  }
});

test("a point outside the display is kept on it, and CSS -> dpx -> CSS stays within one device pixel", () => {
  const d = { scaleFactor: 1.5, sizeDpx: [2880, 1620] as [number, number] };
  assert.deepEqual(cssToDpx([-5, 99999], d), [0, 1620]);
  assert.deepEqual(cssToDpx([5000, -1], d), [2880, 0]);
  for (const x of [0, 1, 17.3, 640.9, 1919]) {
    const back = dpxToCss(cssToDpx([x, x], d), d);
    assert.ok(Math.abs(back[0] - x) <= 0.5 / d.scaleFactor + 1e-9, `x=${x} back=${back[0]}`);
  }
});

test("the overlay surface is the display's physical size over its scale factor", () => {
  assert.deepEqual(overlayCssSize({ scaleFactor: 1.25, sizeDpx: [2560, 1440] }), [2048, 1152]);
  assert.deepEqual(overlayCssSize({ scaleFactor: 2, sizeDpx: [2880, 1800] }), [1440, 900]);
  assert.deepEqual(overlayCssSize({ scaleFactor: 1, sizeDpx: [1920, 1080] }), [1920, 1080]);
});

test("thinning a stroke keeps its first and last point and never more than the cap", () => {
  const pts = Array.from({ length: 1000 }, (_, i) => i);
  const thin = thinPoints(pts, 50);
  assert.equal(thin.length, 50);
  assert.equal(thin[0], 0);
  assert.equal(thin[49], 999);
  assert.deepEqual(thinPoints([1, 2, 3], 50), [1, 2, 3]);
});

const SIZES = new Map<number, [number, number]>([[1, [2880, 1800]]]);

test("the overlay result is validated: shapes, displays, point counts, clamping, empty comments", () => {
  const r = sanitizeExplainResult(
    {
      cancelled: false,
      annotations: [
        { kind: "highlight", displayId: 1, shape: "rect", pointsDpx: [[-10, 5.6], [5000, 2000]] },
        { kind: "highlight", displayId: 1, shape: "freehand", pointsDpx: [[1, 1], [2, 2], [3, 3]] },
        { kind: "highlight", displayId: 1, shape: "highlighter", pointsDpx: [[1, 1]] }, // too few
        { kind: "highlight", displayId: 1, shape: "arrow", pointsDpx: [[1, 1], [2, 2], [3, 3]] }, // arrow is 2
        { kind: "highlight", displayId: 7, shape: "rect", pointsDpx: [[1, 1], [2, 2]] }, // not frozen
        { kind: "highlight", displayId: 1, shape: "rect", pointsDpx: [[1, "x"], [2, 2]] },
        { kind: "highlight", displayId: 1, shape: "rect", pointsDpx: [[NaN, 1], [2, 2]] },
        { kind: "comment", text: "  hello  " },
        { kind: "comment", text: "   " },
        { kind: "comment", text: 42 },
        { kind: "scribble" },
        null,
      ],
    },
    SIZES,
  );
  assert.equal(r.cancelled, false);
  assert.deepEqual(r.annotations, [
    { kind: "highlight", displayId: 1, shape: "rect", pointsDpx: [[0, 6], [2880, 1800]] },
    { kind: "highlight", displayId: 1, shape: "freehand", pointsDpx: [[1, 1], [2, 2], [3, 3]] },
    { kind: "comment", text: "hello" },
  ]);
});

test("a cancelled result carries nothing, and garbage input never throws", () => {
  assert.deepEqual(sanitizeExplainResult({ cancelled: true, annotations: [{ kind: "comment", text: "x" }] }, SIZES), {
    cancelled: true,
    annotations: [],
  });
  for (const bad of [undefined, null, 5, "x", [], { annotations: "no" }]) {
    assert.deepEqual(sanitizeExplainResult(bad, SIZES), { cancelled: false, annotations: [] });
  }
});

test("counts and lengths are capped", () => {
  const many = Array.from({ length: MAX_SHAPES + 50 }, () => ({
    kind: "highlight", displayId: 1, shape: "freehand",
    pointsDpx: Array.from({ length: MAX_POINTS + 100 }, (_, i) => [i, i]),
  }));
  const r = sanitizeExplainResult({ annotations: [...many, { kind: "comment", text: "x".repeat(MAX_COMMENT_CHARS + 500) }] }, SIZES);
  const shapes = r.annotations.filter((a) => a.kind === "highlight");
  assert.equal(shapes.length, MAX_SHAPES);
  assert.ok(shapes.every((a) => a.kind === "highlight" && a.pointsDpx.length === MAX_POINTS));
  const comment = r.annotations.find((a) => a.kind === "comment");
  assert.ok(comment && comment.kind === "comment" && comment.text.length === MAX_COMMENT_CHARS);
});
