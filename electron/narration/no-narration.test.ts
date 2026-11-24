import assert from "node:assert/strict";
import test from "node:test";

import {
  NO_NARRATION_ERROR,
  shouldWarnCachedTranscriptionFailure,
  transcribeIfCachedWith,
  type CachedTranscriptionResult,
} from "./no-narration";

async function runWith(result: CachedTranscriptionResult, modelCached = true): Promise<unknown[][]> {
  const warnings: unknown[][] = [];
  await transcribeIfCachedWith(
    {
      modelCached: () => modelCached,
      isValidSessionId: () => true,
      transcribe: async () => result,
      warn: (...args) => warnings.push(args),
    },
    "/sessions/20261124-143433",
  );
  return warnings;
}

test("the call site: a session with no audio.json logs no warning, a real failure logs one", async () => {
  assert.deepEqual(await runWith({ ok: false, error: NO_NARRATION_ERROR }), []);
  assert.deepEqual(await runWith({ ok: false, outcome: "model-missing" }), []);
  assert.deepEqual(await runWith({ ok: true }), []);
  assert.deepEqual(await runWith({ ok: false, error: "Could not read narration metadata: boom" }), [
    ["cached narration transcription failed:", "Could not read narration metadata: boom"],
  ]);
});

test("the call site does nothing when the model is not cached or the id is invalid", async () => {
  let called = false;
  const deps = {
    modelCached: () => false,
    isValidSessionId: () => true,
    transcribe: async () => { called = true; return { ok: true }; },
    warn: () => undefined,
  };
  await transcribeIfCachedWith(deps, "/s/20261124-143433");
  await transcribeIfCachedWith({ ...deps, modelCached: () => true, isValidSessionId: () => false }, "/s/bad");
  assert.equal(called, false);
});

test("a recording with no narration does not warn", () => {
  assert.equal(
    shouldWarnCachedTranscriptionFailure({ ok: false, error: NO_NARRATION_ERROR }),
    false,
  );
});

test("a missing model and a success do not warn", () => {
  assert.equal(shouldWarnCachedTranscriptionFailure({ ok: false, outcome: "model-missing" }), false);
  assert.equal(shouldWarnCachedTranscriptionFailure({ ok: true }), false);
});

test("a real transcription failure still warns", () => {
  assert.equal(
    shouldWarnCachedTranscriptionFailure({ ok: false, error: "Could not read narration metadata: boom" }),
    true,
  );
  assert.equal(
    shouldWarnCachedTranscriptionFailure({ ok: false, error: "One or more saved narration segments are missing." }),
    true,
  );
});
