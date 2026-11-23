import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import AdmZip from "adm-zip";

import { validatePackage } from "../common/handover/validate";
import { exportPackage, suggestedZipName } from "./export";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, "../test/fixtures/session-synthetic");

test("exports a validating folder and a zip with the same content", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "handover-export-"));
  try {
    const result = await exportPackage({
      sessionDir: FIXTURE,
      destZip: path.join(out, "anything.zip"),
      toolVersion: "0.1.0",
      timezone: "Africa/Johannesburg",
      now: () => new Date(Date.UTC(2026, 10, 24, 7, 30, 0)),
      random: () => new Uint8Array(10).fill(7),
    });
    assert.equal(result.ok, true, JSON.stringify(result.validationErrors ?? result.error));
    assert.match(result.packageId!, /^pkg_[0-9A-HJKMNP-TV-Z]{26}$/);
    assert.equal(result.stepCount, 6);
    assert.match(path.basename(result.folder!), /^save-the-budget-and-open-mail__pkg_[0-9A-Z]{26}\.handover$/);
    assert.deepEqual((await validatePackage(result.folder!)).errors, []);

    const zip = new AdmZip(result.zip!);
    const names = zip.getEntries().map((e) => e.entryName);
    const prefix = `${path.basename(result.folder!)}/`;
    for (const want of ["manifest.json", "steps.jsonl", "annotations.jsonl", "gaps.jsonl", "PROCESS.md", "CLAUDE_HANDOFF.md", "README.txt", "media/S01_before_full.png"]) {
      assert.ok(names.includes(prefix + want), `zip has ${want}`);
    }
    assert.ok(names.every((n) => n.startsWith(prefix)), "everything sits under the package folder");
    // The README carries the test-build banner.
    assert.match(zip.readAsText(prefix + "README.txt"), /TEST BUILD — use test data only/);
    // The zip holds exactly the folder's files.
    const onDisk = (await readdir(result.folder!, { recursive: true, withFileTypes: true })).filter((e) => e.isFile()).length;
    assert.equal(names.length, onDisk);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("an unreadable session reports an error instead of throwing", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "handover-export-"));
  try {
    const result = await exportPackage({ sessionDir: path.join(out, "missing"), destZip: path.join(out, "x.zip"), toolVersion: "0.1.0" });
    assert.equal(result.ok, false);
    assert.ok(result.error);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("the suggested name is the slug", () => {
  assert.equal(suggestedZipName("Save the Budget"), "save-the-budget.zip");
});
