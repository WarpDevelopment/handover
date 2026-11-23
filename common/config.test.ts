import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createCollectors } from "../electron/collectors";
import { ADVANCED_PROTECTION_AVAILABLE, FULL_CAPTURE } from "./config";

test("tester-build capture defaults keep the URL reader, terminal and clipboard off", () => {
  assert.equal(FULL_CAPTURE.browserUrls, false);
  assert.equal(FULL_CAPTURE.terminal, false);
  assert.equal(FULL_CAPTURE.clipboard, false);
  assert.equal(FULL_CAPTURE.appActivity, true);
  assert.equal(FULL_CAPTURE.video, true);
});

test("the default capture set does not construct the clipboard collector", () => {
  const names = createCollectors({ ...FULL_CAPTURE }).map((c) => c.name);
  assert.ok(!names.includes("clipboard"), `collectors started: ${names}`);
});

test("the Advanced protection option is hidden and its section is gated on the flag", () => {
  assert.equal(ADVANCED_PROTECTION_AVAILABLE, false);
  const source = readFileSync(new URL("../src/WhatsRecorded.tsx", import.meta.url), "utf8");
  assert.match(source, /\{ADVANCED_PROTECTION_AVAILABLE && \(\s*<section[^>]*sheet-advp/);
});
