// APP-9 (rest): deleting a recording evicts its cached review pictures.

import assert from "node:assert/strict";
import test from "node:test";

import { deleteSessionFlow, type DeleteDeps } from "./session-delete";

function deps(over: Partial<DeleteDeps> = {}) {
  const calls: string[] = [];
  const d: DeleteDeps = {
    isRecording: () => false,
    isTranscribing: () => false,
    deleteSession: async (id) => { calls.push(`delete ${id}`); },
    forget: [(id) => calls.push(`recorder.forget ${id}`), (id) => calls.push(`review.evict ${id}`)],
    ...over,
  };
  return { d, calls };
}

test("a successful delete evicts the session from the recorder and the review cache", async () => {
  const { d, calls } = deps();
  assert.deepEqual(await deleteSessionFlow("20261124-0800-ab12", d), { ok: true });
  assert.deepEqual(calls, ["delete 20261124-0800-ab12", "recorder.forget 20261124-0800-ab12", "review.evict 20261124-0800-ab12"]);
});

test("a failed delete, a recording in progress and a transcription forget nothing", async () => {
  const failing = deps({ deleteSession: async () => { throw new Error("EBUSY"); } });
  assert.deepEqual(await deleteSessionFlow("a1", failing.d), { ok: false, error: "EBUSY" });
  assert.deepEqual(failing.calls, []);

  const live = deps({ isRecording: () => true });
  assert.equal((await deleteSessionFlow("a1", live.d)).ok, false);
  const busy = deps({ isTranscribing: () => true });
  assert.equal((await deleteSessionFlow("a1", busy.d)).ok, false);
  assert.equal((await deleteSessionFlow("../x", deps().d)).ok, false, "an unsafe id is refused");
  assert.deepEqual([live.calls, busy.calls], [[], []]);
});

test("one forgetter throwing does not stop the others", async () => {
  const calls: string[] = [];
  const { d } = deps({ forget: [() => { throw new Error("x"); }, (id) => calls.push(id)], warn: () => {} });
  assert.deepEqual(await deleteSessionFlow("a1", d), { ok: true });
  assert.deepEqual(calls, ["a1"]);
});
