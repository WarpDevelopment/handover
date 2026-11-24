// D2: no review marker and no export while narration is being transcribed.

import assert from "node:assert/strict";
import test from "node:test";

import { NARRATION_BUSY_MESSAGE, reviewBlockedReason } from "./review-gate";

test("a session being transcribed is blocked with a clear message", () => {
  assert.equal(reviewBlockedReason("a1", (id) => id === "a1"), NARRATION_BUSY_MESSAGE);
  assert.match(NARRATION_BUSY_MESSAGE, /wait and review again/);
});

test("other sessions and idle narration are not blocked", () => {
  assert.equal(reviewBlockedReason("a2", (id) => id === "a1"), null);
  assert.equal(reviewBlockedReason("a1", () => false), null);
});
