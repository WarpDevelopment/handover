// SEC-9: get-windows must not be asked for accessibility, which makes it read browser URLs on macOS.

import assert from "node:assert/strict";
import test from "node:test";

import { GET_WINDOWS_FULL } from "./active-window";

test("FULL mode asks get-windows for screen recording only, never accessibility", () => {
  assert.deepEqual(GET_WINDOWS_FULL, { accessibilityPermission: false, screenRecordingPermission: true });
});
