import assert from "node:assert/strict";
import test from "node:test";

import { FULL_CAPTURE } from "./config";

test("tester-build capture defaults keep the URL reader and terminal off", () => {
  assert.equal(FULL_CAPTURE.browserUrls, false);
  assert.equal(FULL_CAPTURE.terminal, false);
  assert.equal(FULL_CAPTURE.appActivity, true);
  assert.equal(FULL_CAPTURE.clipboard, true);
  assert.equal(FULL_CAPTURE.video, true);
});
