import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildPackage } from "./build-package";
import { canonicalJson } from "./canonical";
import { readSessionInput } from "./read-session";
import { validatePackage, validateRecord } from "./validate";

import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, "../../test/fixtures/session-synthetic");
const CTX = {
  package_id: "pkg_01KAT8ZJ3Q5R7M9N2B4C6D8E0F",
  exported_at: "2026-11-24T09:30:00+02:00",
  timezone: "Africa/Johannesburg",
  tool_version: "0.1.0",
};

async function exportTo(dir: string): Promise<void> {
  const { session, edits } = await readSessionInput(FIXTURE, {
    environment: { os: "macos", os_version: "26.1", arch: "arm64", locale: "en-ZA" },
    helper: { present: true },
    captureBackend: "electron-desktop-capturer",
  });
  const files = await buildPackage(session, edits, CTX);
  for (const [p, bytes] of files) {
    await mkdir(path.dirname(path.join(dir, p)), { recursive: true });
    await writeFile(path.join(dir, p), bytes);
  }
}

async function withPackage(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "handover-validate-"));
  try {
    await exportTo(dir);
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("validatePackage accepts a good package", async () => {
  await withPackage(async (dir) => {
    assert.deepEqual(await validatePackage(dir), { ok: true, errors: [] });
  });
});

test("validatePackage catches a tampered file (sha256 mismatch)", async () => {
  await withPackage(async (dir) => {
    await writeFile(path.join(dir, "PROCESS.md"), "tampered\n");
    const r = await validatePackage(dir);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("sha256 mismatch for PROCESS.md")));
  });
});

test("validatePackage catches a missing listed file and a changed PNG count", async () => {
  await withPackage(async (dir) => {
    await rm(path.join(dir, "media/S02_before_crop.png"));
    const r = await validatePackage(dir);
    assert.ok(r.errors.some((e) => e.includes("media/S02_before_crop.png is listed but missing")));
    assert.ok(r.errors.some((e) => e.includes("image_count")));
  });
});

test("validatePackage catches holes in step ids, dangling references and a bad time sum", async () => {
  await withPackage(async (dir) => {
    const stepsPath = path.join(dir, "steps.jsonl");
    const lines = (await readFile(stepsPath, "utf8")).split("\n").filter(Boolean);
    const second = JSON.parse(lines[1]);
    second.step_id = "S05"; // hole
    second.annotation_ids = ["ann_9999"]; // dangling
    lines[1] = JSON.stringify(second);
    await writeFile(stepsPath, lines.join("\n") + "\n");
    const manifestPath = path.join(dir, "manifest.json");
    const m = JSON.parse(await readFile(manifestPath, "utf8"));
    m.recording.task_ms += 1;
    await writeFile(manifestPath, canonicalJson(m));
    const r = await validatePackage(dir);
    assert.ok(r.errors.some((e) => e.includes("should be S02")));
    assert.ok(r.errors.some((e) => e.includes("unknown ann_9999")));
    assert.ok(r.errors.some((e) => e.includes("must equal duration_ms")));
  });
});

test("G1 E1: validatePackage rejects a gap whose after_step comes later than its before_step", async () => {
  await withPackage(async (dir) => {
    const gapsPath = path.join(dir, "gaps.jsonl");
    const gap = {
      gap_id: "gap_0001", t_start_ms: 100, t_end_ms: 200, reason: "elevated_window",
      after_step: "S05", before_step: "S02",
    };
    await writeFile(gapsPath, JSON.stringify(gap) + "\n");
    const r = await validatePackage(dir);
    assert.ok(r.errors.some((e) => e.includes("gap_0001") && e.includes("after_step") && e.includes("later")), r.errors.join("\n"));
    // The same gap the right way round raises no such error.
    await writeFile(gapsPath, JSON.stringify({ ...gap, after_step: "S02", before_step: "S05" }) + "\n");
    const ok = await validatePackage(dir);
    assert.equal(ok.errors.some((e) => e.includes("later than")), false);
  });
});

test("validatePackage fails on a folder with no manifest", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "handover-empty-"));
  try {
    const r = await validatePackage(dir);
    assert.equal(r.ok, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the schema rejects a keyboard capability, a non-test build and bad ids", () => {
  const good = {
    step_id: "S01", seq: 1, kind: "manual", t_start_ms: 0, t_end_ms: 1, summary: "Switch to X",
    summary_provenance: "observed", annotation_ids: [], flags: [], boundary: "not_assessed",
    boundary_source: "none", scope_verified: true,
  };
  assert.deepEqual(validateRecord("step", good, "s"), []);
  assert.ok(validateRecord("step", { ...good, step_id: "step1" }, "s").length > 0);
  assert.ok(validateRecord("step", { ...good, flags: ["nope"] }, "s").length > 0);
  assert.ok(validateRecord("step", { ...good, kind: "typing" }, "s").length > 0);
  // Unknown fields are allowed: new fields get added, never renamed.
  assert.deepEqual(validateRecord("step", { ...good, future_field: 1 }, "s"), []);
  assert.ok(validateRecord("gap", { gap_id: "gap_0001", t_start_ms: 0, t_end_ms: 1, reason: "sleep" }, "g").length > 0);
});

test("G1: the gap schema enforces the 60-character limit on the elevated window's process name", () => {
  const gap = { gap_id: "gap_0001", t_start_ms: 0, t_end_ms: 1, reason: "elevated_window" };
  assert.deepEqual(validateRecord("gap", { ...gap, process: "Taskmgr" }, "g"), []);
  assert.deepEqual(validateRecord("gap", { ...gap, process: "x".repeat(60) }, "g"), []);
  assert.ok(validateRecord("gap", { ...gap, process: "x".repeat(61) }, "g").length > 0);
});
