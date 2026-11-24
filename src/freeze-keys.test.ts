// APP-2: Enter does not save while the overlay document has no focus.

import assert from "node:assert/strict";
import test from "node:test";

import { enterShouldSave } from "./freeze-keys";

const base = { key: "Enter", shiftKey: false, targetIsButton: false, documentHasFocus: true };

test("Enter saves when the overlay has the keyboard", () => {
  assert.equal(enterShouldSave(base), true);
});

test("Enter does not save while document.hasFocus() is false", () => {
  assert.equal(enterShouldSave({ ...base, documentHasFocus: false }), false);
});

test("Shift+Enter, Enter on a button and other keys never save", () => {
  assert.equal(enterShouldSave({ ...base, shiftKey: true }), false);
  assert.equal(enterShouldSave({ ...base, targetIsButton: true }), false);
  assert.equal(enterShouldSave({ ...base, key: "a" }), false);
});
