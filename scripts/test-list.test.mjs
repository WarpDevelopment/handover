// Guards the hand-maintained `npm test` file list. Parallel lanes merge into it,
// and once two entries were glued together ("a.test.tsb.test.ts"), which made
// node --test silently skip both suites.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const listed = pkg.scripts.test.split("--test ")[1].trim().split(/\s+/);

test("every entry in the npm test list is an existing test file", () => {
  const bad = listed.filter((f) => !/\.test\.(ts|mjs)$/.test(f) || !existsSync(f));
  assert.deepEqual(bad, []);
});

test("every tracked test file is in the npm test list", () => {
  const tracked = execFileSync("git", ["ls-files", "*.test.ts", "*.test.mjs"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  assert.deepEqual(tracked.filter((f) => !listed.includes(f)), []);
});
