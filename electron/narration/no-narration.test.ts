import assert from "node:assert/strict";
import test from "node:test";

import {
  NO_NARRATION_ERROR,
  shouldWarnCachedTranscriptionFailure,
} from "./no-narration";

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
