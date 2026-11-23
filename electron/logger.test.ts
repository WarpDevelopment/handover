import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createLogger, formatLogArgs, initFileLogging, logFileName } from "./logger";

test("file sink writes handover-YYYYMMDD.log lines and never an object payload", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "handover-log-"));
  const day = new Date(2026, 10, 23, 9, 30, 0);
  const stop = initFileLogging(dir, { now: () => day });
  const quiet = console.log;
  const quietWarn = console.warn;
  console.log = () => undefined;
  console.warn = () => undefined;
  try {
    const log = createLogger("Test");
    log.info("recording started", 3, true);
    log.info("event", { title: "Quarterly payroll for ACME", text: "secret clipboard text" });
    log.warn("failed:", new Error("boom"));
  } finally {
    console.log = quiet;
    console.warn = quietWarn;
    stop();
  }
  assert.equal(logFileName(day), "handover-20261123.log");
  const content = await readFile(path.join(dir, "handover-20261123.log"), "utf8");
  assert.match(content, /INFO \[Test\] recording started 3 true/);
  assert.match(content, /WARN \[Test\] failed: Error: boom/);
  assert.ok(!content.includes("ACME") && !content.includes("secret clipboard text"));
  assert.match(content, /INFO \[Test\] event <object>/);
  await rm(dir, { recursive: true, force: true });
});

test("the log rotates when it reaches the size limit", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "handover-log-rot-"));
  const stop = initFileLogging(dir, { maxBytes: 200, now: () => new Date(2026, 10, 23) });
  const quiet = console.log;
  console.log = () => undefined;
  try {
    const log = createLogger("Rot");
    for (let i = 0; i < 20; i++) log.info(`line ${i} ${"x".repeat(30)}`);
  } finally {
    console.log = quiet;
    stop();
  }
  const files = (await readdir(dir)).sort();
  assert.ok(files.includes("handover-20261123.log"));
  assert.ok(files.includes("handover-20261123.1.log"), `expected a rotated file, got ${files}`);
  await rm(dir, { recursive: true, force: true });
});

test("formatLogArgs flattens newlines and hides arrays", () => {
  assert.equal(formatLogArgs(["a\nb", [1, 2]]), "a b <array>");
});
