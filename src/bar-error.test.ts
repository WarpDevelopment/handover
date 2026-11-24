import assert from "node:assert/strict";
import test from "node:test";

import { BAR_ERROR_MAX, shortBarError } from "./bar-error";

test("APP-5: a short failure is shown whole, a long one is cut to the bar's width", () => {
  assert.equal(shortBarError("Not recording"), "Not recording");
  const long = shortBarError("Screen capture is not available, so the screen cannot be frozen.");
  assert.equal(long.length, BAR_ERROR_MAX);
  assert.ok(long.endsWith("…"));
});
