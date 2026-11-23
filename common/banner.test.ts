import assert from "node:assert/strict";
import test from "node:test";

import { TEST_BUILD_BANNER } from "./banner";

test("the test-build banner text is exact, with an em dash", () => {
  assert.equal(TEST_BUILD_BANNER, "TEST BUILD — use test data only, not real client data");
});
