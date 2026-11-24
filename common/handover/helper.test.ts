import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, cp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { HelperDoctorInfo } from "../ipc";
import { helperStatusFrom, HELPER_FILE, parseHelperStatus } from "./helper";
import { readSessionInput } from "./read-session";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, "../../test/fixtures/session-synthetic");
const base: HelperDoctorInfo = {
  helper: "ok", version: "0.2.1", lastError: null, lookupP50Ms: 12, lookupP95Ms: 40,
  counts: { accessibility: 3, accessibility_weak: 1, none: 0 },
};

test("helper status from the tracker report: ran, never ran, missing, crashed, no permission", () => {
  assert.deepEqual(helperStatusFrom(base), { present: true, version: "0.2.1" });
  assert.deepEqual(helperStatusFrom({ ...base, helper: "missing", version: null, lastError: "Helper binary not found" }), {
    present: false,
    error: "Helper binary not found",
  });
  // Started (hello received) and then crashed: it ran, and the error is reported.
  assert.deepEqual(helperStatusFrom({ ...base, helper: "crashed", lastError: "exited with code 1" }), {
    present: true, version: "0.2.1", error: "exited with code 1",
  });
  assert.deepEqual(helperStatusFrom({ ...base, helper: "no-permission", lastError: "Accessibility permission not granted" }), {
    present: true, version: "0.2.1", error: "Accessibility permission not granted",
  });
  // Never started: no version, so it did not run.
  assert.equal(helperStatusFrom({ ...base, version: null }).present, false);
});

test("helper.json is parsed defensively", () => {
  assert.deepEqual(parseHelperStatus('{"present":true,"version":"1"}'), { present: true, version: "1" });
  assert.deepEqual(parseHelperStatus("not json"), { present: false, error: "helper status file unreadable" });
  assert.deepEqual(parseHelperStatus("{}"), { present: false });
});

test("a session's helper.json overrides the caller's fallback", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "handover-helper-"));
  try {
    await cp(FIXTURE, dir, { recursive: true });
    const extras = { environment: { os: "macos" as const, os_version: "1", arch: "arm64" as const, locale: "en" }, helper: { present: false }, captureBackend: "x" };
    assert.deepEqual((await readSessionInput(dir, extras)).session.helper, { present: false });
    await writeFile(path.join(dir, HELPER_FILE), JSON.stringify({ present: true, version: "0.3.0" }));
    assert.deepEqual((await readSessionInput(dir, extras)).session.helper, { present: true, version: "0.3.0" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
