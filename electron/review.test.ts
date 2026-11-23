// L4: the review backend appends edits to edits.jsonl and the export applies them.

import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { UnsupportedEditError } from "../common/handover/edits";
import { reviewDataFrom } from "../common/handover/review";
import { exportPackage } from "./export";
import { ReviewService } from "./review";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, "../test/fixtures/session-synthetic");

async function withCopy(run: (dir: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "handover-review-"));
  const dir = path.join(root, "session");
  try {
    await cp(FIXTURE, dir, { recursive: true });
    await run(dir);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const service = (): ReviewService =>
  new ReviewService({ toolVersion: "0.1.0", now: () => new Date("2026-11-24T09:00:00Z"), random: () => new Uint8Array([1, 2, 3, 4]) });

async function edits(dir: string): Promise<Record<string, unknown>[]> {
  try {
    return (await readFile(path.join(dir, "edits.jsonl"), "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

test("load returns the steps with their pre-edit ids, comments, highlights and the image to show", async () => {
  await withCopy(async (dir) => {
    const data = await service().load(dir, "s1");
    assert.equal(data.steps.length, 6);
    assert.deepEqual(data.steps.map((s) => s.stepId), ["S01", "S02", "S03", "S04", "S05", "S06"]);
    assert.deepEqual(data.steps.map((s) => s.preEditId), ["S01", "S02", "S03", "S04", "S05", "S06"]);
    const s3 = data.steps[2];
    assert.deepEqual(s3.comment, { annotationId: "ann_0002", text: "Always save before closing the file" });
    assert.equal(s3.highlightCount, 1);
    assert.equal(s3.image?.path, "media/S03_before_full_annotated.png", "annotated image when there are highlights");
    assert.equal(data.steps[1].image?.path, "media/S02_before_full.png");
    assert.equal(data.steps[4].blurredFpx.length, 1, "the password field is already blurred");
    assert.ok(data.steps[4].flags.includes("contains_redaction"));
  });
});

test("images are served only from the last build and only from media/", async () => {
  await withCopy(async (dir) => {
    const svc = service();
    assert.equal(svc.image("s1", "media/S02_before_full.png"), null, "nothing before load");
    await svc.load(dir, "s1");
    const url = svc.image("s1", "media/S02_before_full.png");
    assert.ok(url?.startsWith("data:image/png;base64,"));
    assert.equal(svc.image("s1", "../session.json"), null);
    assert.equal(svc.image("s1", "media/../../x.png"), null);
    assert.equal(svc.image("s1", "steps.jsonl"), null);
    assert.equal(svc.image("other", "media/S02_before_full.png"), null);
  });
});

test("edits are appended to edits.jsonl, ids stay pre-edit, and the export applies them", async () => {
  await withCopy(async (dir) => {
    const svc = service();
    await svc.load(dir, "s1");
    // Delete the step shown as S02, then edit the summary and blur the step shown as S02 now (old S03).
    let data = await svc.applyEdit(dir, "s1", { op: "delete_step", preEditId: "S02" });
    assert.deepEqual(data.steps.map((s) => [s.stepId, s.preEditId]), [
      ["S01", "S01"], ["S02", "S03"], ["S03", "S04"], ["S04", "S05"], ["S05", "S06"],
    ]);
    data = await svc.applyEdit(dir, "s1", { op: "edit_summary", preEditId: "S03", text: "  Save the budget  " });
    data = await svc.applyEdit(dir, "s1", { op: "edit_comment", annotationId: "ann_0002", text: "Save first, always" });
    data = await svc.applyEdit(dir, "s1", { op: "blur_rect", preEditId: "S03", rectFpx: [100, 100, 200, 100] });
    assert.equal(data.editCount, 4);
    assert.equal(data.steps[1].summary, "Save the budget");
    assert.equal(data.steps[1].summaryEdited, true);
    assert.equal(data.steps[1].comment?.text, "Save first, always");
    assert.deepEqual(data.steps[1].blurredFpx, [[100, 100, 200, 100]]);

    const lines = await edits(dir);
    assert.deepEqual(lines.map((l) => l.op), ["delete_step", "edit_summary", "edit_comment", "blur_rect"]);
    assert.deepEqual(lines[0].step_id, "S02");
    assert.deepEqual(lines[3].step_id, "S03", "the blur refers to the pre-edit id");
    assert.deepEqual(lines[3].rect_fpx, [100, 100, 200, 100]);
    assert.equal(new Set(lines.map((l) => l.edit_id)).size, 1, "ids come from the injected random here");

    // A fresh service (a restart) sees the same edits, and the real exporter applies them.
    const fresh = await service().load(dir, "s1");
    assert.deepEqual(fresh, data);
    const out = await mkdtemp(path.join(os.tmpdir(), "handover-review-export-"));
    try {
      const result = await exportPackage({ sessionDir: dir, destZip: path.join(out, "x.zip"), toolVersion: "0.1.0" });
      assert.equal(result.ok, true, JSON.stringify(result.validationErrors ?? result.error));
      assert.equal(result.stepCount, 5);
      const stepsJsonl = await readFile(path.join(result.folder!, "steps.jsonl"), "utf8");
      assert.ok(stepsJsonl.includes("Save the budget"));
      assert.ok(!stepsJsonl.includes('Click button \\"Save\\"'), "the deleted step is gone");
      assert.ok(stepsJsonl.includes('"redacted_regions_fpx":[[100,100,200,100]]'));
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
});

test("a bad edit writes nothing: blur outside the image, unknown step, empty summary, unknown operation", async () => {
  await withCopy(async (dir) => {
    const svc = service();
    await svc.load(dir, "s1");
    await assert.rejects(() => svc.applyEdit(dir, "s1", { op: "blur_rect", preEditId: "S02", rectFpx: [9000, 9000, 10, 10] }), /outside its image/);
    await assert.rejects(() => svc.applyEdit(dir, "s1", { op: "delete_step", preEditId: "S42" }), /unknown step/);
    await assert.rejects(() => svc.applyEdit(dir, "s1", { op: "edit_summary", preEditId: "S02", text: "   " }), /cannot be empty/);
    await assert.rejects(() => svc.applyEdit(dir, "s1", { op: "blur_rect", preEditId: "S02", rectFpx: [0, 0, 0, 5] }), /positive size/);
    await assert.rejects(
      () => svc.applyEdit(dir, "s1", { op: "crop_everything" } as unknown as Parameters<ReviewService["applyEdit"]>[2]),
      UnsupportedEditError,
    );
    assert.deepEqual(await edits(dir), []);
  });
});

test("reviewDataFrom falls back to the output id when no pre-edit ids are given", async () => {
  const files = new Map<string, Uint8Array>([
    ["steps.jsonl", new TextEncoder().encode('{"step_id":"S01","seq":1,"kind":"action","summary":"x","summary_provenance":"observed","annotation_ids":[],"flags":[]}\n')],
  ]);
  const d = reviewDataFrom({ files, stepIds: [], sessionId: "s", title: "t", editCount: 0 });
  assert.equal(d.steps[0].preEditId, "S01");
  assert.equal(d.steps[0].image, null);
});
