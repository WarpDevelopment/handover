// D2 and N3: no review marker and no export while narration is being transcribed or has changed. The
// handlers in ipc.ts delegate to these, so removing a check there fails a test here.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  EXPORT_NOT_REVIEWED_MESSAGE,
  exportBlockedReason,
  markReviewedGuarded,
  NARRATION_BUSY_MESSAGE,
  NARRATION_CHANGED_MESSAGE,
  REVIEW_NOT_LOADED_MESSAGE,
  reviewBlockedReason,
  type MarkReviewedDeps,
} from "./review-gate";

test("a session being transcribed is blocked with a clear message", () => {
  assert.equal(reviewBlockedReason("a1", (id) => id === "a1"), NARRATION_BUSY_MESSAGE);
  assert.match(NARRATION_BUSY_MESSAGE, /wait and review again/);
  assert.equal(reviewBlockedReason("a2", (id) => id === "a1"), null);
  assert.equal(reviewBlockedReason("a1", () => false), null);
});

function markDeps(over: Partial<MarkReviewedDeps> = {}) {
  const marked: string[] = [];
  const deps: MarkReviewedDeps = {
    isLibrarySender: () => true,
    isValidSessionId: (id): id is string => typeof id === "string" && id.length > 0,
    isRecording: () => false,
    isTranscribing: () => false,
    currentNarrationSha256: () => "sha256:aaa",
    diskNarrationSha256: async () => "sha256:aaa",
    mark: async (id) => { marked.push(id); },
    ...over,
  };
  return { deps, marked };
}

test("mark-reviewed goes through when the review's narration is the one on disk", async () => {
  const { deps, marked } = markDeps();
  assert.deepEqual(await markReviewedGuarded("a1", deps), { ok: true });
  assert.deepEqual(marked, ["a1"]);
});

test("D2: mark-reviewed is refused while narration is being transcribed", async () => {
  const { deps, marked } = markDeps({ isTranscribing: () => true });
  assert.deepEqual(await markReviewedGuarded("a1", deps), { ok: false, error: NARRATION_BUSY_MESSAGE });
  assert.deepEqual(marked, []);
});

test("N3: mark-reviewed is refused when narration.json changed since the review was built", async () => {
  const { deps, marked } = markDeps({ diskNarrationSha256: async () => "sha256:bbb" });
  assert.deepEqual(await markReviewedGuarded("a1", deps), { ok: false, error: NARRATION_CHANGED_MESSAGE });
  assert.deepEqual(marked, []);
  const absent = markDeps({ currentNarrationSha256: () => "absent", diskNarrationSha256: async () => "sha256:ccc" });
  assert.equal((await markReviewedGuarded("a1", absent.deps)).error, NARRATION_CHANGED_MESSAGE, "a transcript appeared");
  const same = markDeps({ currentNarrationSha256: () => "absent", diskNarrationSha256: async () => "absent" });
  assert.equal((await markReviewedGuarded("a1", same.deps)).ok, true);
});

test("N3: with no review loaded, or no way to ask, mark-reviewed is refused", async () => {
  const notLoaded = markDeps({ currentNarrationSha256: () => null });
  assert.deepEqual(await markReviewedGuarded("a1", notLoaded.deps), { ok: false, error: REVIEW_NOT_LOADED_MESSAGE });
  const unwired = markDeps({ currentNarrationSha256: undefined });
  assert.equal((await markReviewedGuarded("a1", unwired.deps)).error, REVIEW_NOT_LOADED_MESSAGE);
  assert.deepEqual([notLoaded.marked, unwired.marked], [[], []]);
});

test("mark-reviewed refuses other windows, bad ids, a recording in progress, and a failing write", async () => {
  for (const over of [{ isLibrarySender: () => false }, { isRecording: () => true }]) {
    const { deps, marked } = markDeps(over);
    assert.deepEqual(await markReviewedGuarded("a1", deps), { ok: false });
    assert.deepEqual(marked, []);
  }
  assert.deepEqual(await markReviewedGuarded("", markDeps().deps), { ok: false });
  const failing = markDeps({ mark: async () => { throw new Error("EACCES"); }, warn: () => {} });
  assert.deepEqual(await markReviewedGuarded("a1", failing.deps), { ok: false });
});

test("ipc.ts delegates both handlers to the guards (removing either call fails here)", () => {
  const ipc = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "ipc.ts"), "utf8");
  assert.match(ipc, /markReviewedGuarded\(\s*sessionId/);
  assert.match(ipc, /await exportBlockedReason\(\s*sessionId/);
  assert.match(ipc, /currentNarrationSha256,/, "the review's narration hash is passed to the guard");
});

test("D2: export is refused while narrating, while recording, and until reviewed", async () => {
  const base = { isRecording: () => false, isTranscribing: () => false, isReviewed: async () => true };
  assert.equal(await exportBlockedReason("a1", base), null);
  assert.equal(await exportBlockedReason("a1", { ...base, isTranscribing: () => true }), NARRATION_BUSY_MESSAGE);
  assert.match((await exportBlockedReason("a1", { ...base, isRecording: () => true }))!, /still in progress/);
  assert.equal(await exportBlockedReason("a1", { ...base, isReviewed: async () => false }), EXPORT_NOT_REVIEWED_MESSAGE);
});
