import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import AdmZip from "adm-zip";

import { validatePackage } from "../common/handover/validate";
import { buildPackage } from "../common/handover/build-package";
import { assertEdit, parseEdits } from "../common/handover/edits";
import { readSessionInput } from "../common/handover/read-session";
import { exportPackage, moveWithRetry, suggestedZipName } from "./export";

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
    assert.equal(result.stepCount, 7); // six recorded steps and the Explain step
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

test("PKG-8: a package that does not validate leaves nothing behind", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "handover-export-"));
  try {
    const result = await exportPackage({
      sessionDir: FIXTURE,
      destZip: path.join(out, "anything.zip"),
      toolVersion: "0.1.0",
      timezone: "Africa/Johannesburg",
      now: () => new Date(Date.UTC(2026, 10, 24, 7, 30, 0)),
      random: () => new Uint8Array(10).fill(7),
      validate: async () => ({ ok: false, errors: ["S01: something is wrong"] }),
    });
    assert.equal(result.ok, false);
    assert.deepEqual(result.validationErrors, ["S01: something is wrong"]);
    assert.equal(result.folder, undefined);
    assert.equal(result.zip, undefined);
    assert.deepEqual(await readdir(out), [], "no folder, no zip and no scratch folder");
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("PKG-8: an earlier export at the same place is not touched when a new one fails", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "handover-export-"));
  try {
    const opts = {
      sessionDir: FIXTURE,
      destZip: path.join(out, "anything.zip"),
      toolVersion: "0.1.0",
      timezone: "Africa/Johannesburg",
      now: () => new Date(Date.UTC(2026, 10, 24, 7, 30, 0)),
      random: () => new Uint8Array(10).fill(7),
    };
    const good = await exportPackage(opts);
    assert.equal(good.ok, true);
    const before = await readdir(out);
    const bad = await exportPackage({ ...opts, validate: async () => ({ ok: false, errors: ["x"] }) });
    assert.equal(bad.ok, false);
    assert.deepEqual(await readdir(out), before);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("N6: a rename blocked by EPERM is retried with backoff, then copied, and a real error is not retried", async () => {
  const busy = () => Object.assign(new Error("busy"), { code: "EPERM" });
  const waits: number[] = [];
  let calls = 0;
  await moveWithRetry("a", "b", {
    rename: async () => { if (++calls < 3) throw busy(); },
    sleep: async (ms) => { waits.push(ms); },
  });
  assert.equal(calls, 3);
  assert.deepEqual(waits, [50, 100]);

  const log: string[] = [];
  await moveWithRetry("a", "b", {
    rename: async () => { throw busy(); },
    cp: async (f, t) => { log.push(`cp ${f} ${t}`); },
    rm: async (p) => { log.push(`rm ${p}`); },
    sleep: async () => undefined,
  });
  assert.deepEqual(log, ["cp a b", "rm a"], "falls back to copy then delete");

  let other = 0;
  await assert.rejects(
    () => moveWithRetry("a", "b", { rename: async () => { other++; throw Object.assign(new Error("gone"), { code: "ENOENT" }); } }),
    /gone/,
  );
  assert.equal(other, 1);
});

test("N6: the previous export is kept until the new one is in place, and restored if placing it fails", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "handover-export-"));
  try {
    const opts = {
      sessionDir: FIXTURE,
      destZip: path.join(out, "anything.zip"),
      toolVersion: "0.1.0",
      timezone: "Africa/Johannesburg",
      now: () => new Date(Date.UTC(2026, 10, 24, 7, 30, 0)),
      random: () => new Uint8Array(10).fill(7),
    };
    assert.equal((await exportPackage(opts)).ok, true);
    const before = await readdir(out);
    const { rename: realRename } = await import("node:fs/promises");
    // Placing the new folder always fails with a non-retryable error, after the old one was moved aside.
    const failing = await exportPackage({
      ...opts,
      fsOps: { rename: async (from, to) => { if (from.includes(".handover-export-") && /old-/.test(to) === false && !from.includes("old-")) throw new Error("disk full"); await realRename(from, to); } },
    });
    assert.equal(failing.ok, false);
    assert.deepEqual(await readdir(out), before, "the earlier folder and zip are back, nothing else is left");
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("N4: the manifest carries the reviewed_at of the session's reviewed.json, not the export time", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "handover-export-"));
  try {
    const session = path.join(root, "session");
    await cp(FIXTURE, session, { recursive: true });
    await writeFile(path.join(session, "reviewed.json"), JSON.stringify({ reviewed_at: "2026-11-23T08:15:00.000Z", edit_count: 0, narration_hash: "x" }));
    const result = await exportPackage({
      sessionDir: session,
      destZip: path.join(root, "out", "x.zip"),
      toolVersion: "0.1.0",
      timezone: "Africa/Johannesburg",
      now: () => new Date(Date.UTC(2026, 10, 24, 7, 30, 0)),
      random: () => new Uint8Array(10).fill(7),
    });
    assert.equal(result.ok, true);
    const manifest = JSON.parse(await readFile(path.join(result.folder!, "manifest.json"), "utf8"));
    assert.equal(manifest.privacy.reviewed_at, "2026-11-23T08:15:00.000Z");
    assert.match(manifest.created_at, /^2026-11-24T/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("N3: a legacy empty edit_comment in edits.jsonl is read as 'comment removed', not an error", async () => {
  const line = JSON.stringify({ edit_id: "e1", at: "2026-11-24T09:00:00Z", op: "edit_comment", annotation_id: "ann_0002", text: "" });
  const read = parseEdits(`${line}\n`);
  assert.equal(read.length, 1);
  // New edits still refuse it.
  assert.throws(() => assertEdit(JSON.parse(line)), /cannot be empty/);
  const { session } = await readSessionInput(FIXTURE, {
    environment: { os: "macos", os_version: "26.1", arch: "arm64", locale: "en-ZA" },
    helper: { present: true },
    captureBackend: "x",
  });
  const files = await buildPackage(session, read, {
    package_id: "pkg_01KAT8ZJ3Q5R7M9N2B4C6D8E0F", exported_at: "2026-11-24T09:30:00+02:00", timezone: "Africa/Johannesburg", tool_version: "0.1.0",
  });
  const annotations = new TextDecoder().decode(files.get("annotations.jsonl"));
  assert.ok(!annotations.includes('"kind":"comment"'), "the comment is gone");
  assert.ok(!new TextDecoder().decode(files.get("steps.jsonl")).includes('"why"'));
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
