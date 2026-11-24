// SEC-2: the reviewed marker gates export.

import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { isReviewed, markReviewed, readReviewedMarker, REVIEWED_FILE } from "./reviewed-marker";

async function withDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "handover-reviewed-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("a session that was never marked is not reviewed", async () => {
  await withDir(async (dir) => {
    assert.equal(await isReviewed(dir), false);
  });
});

test("marking writes reviewed_at and the edit count; the session is then reviewed", async () => {
  await withDir(async (dir) => {
    await writeFile(path.join(dir, "edits.jsonl"), '{"a":1}\n{"a":2}\n');
    const marker = await markReviewed(dir, () => new Date("2026-11-24T08:00:00Z"));
    assert.deepEqual(marker, { reviewed_at: "2026-11-24T08:00:00.000Z", edit_count: 2, narration_sha256: "absent" });
    assert.deepEqual(JSON.parse(await readFile(path.join(dir, REVIEWED_FILE), "utf8")), marker);
    assert.equal(await isReviewed(dir), true);
  });
});

test("a session with no edits can be marked reviewed", async () => {
  await withDir(async (dir) => {
    assert.equal((await markReviewed(dir)).edit_count, 0);
    assert.equal(await isReviewed(dir), true);
  });
});

test("an edit after the marker makes it stale", async () => {
  await withDir(async (dir) => {
    await markReviewed(dir);
    assert.equal(await isReviewed(dir), true);
    await appendFile(path.join(dir, "edits.jsonl"), '{"op":"delete_step"}\n');
    assert.equal(await isReviewed(dir), false);
    await markReviewed(dir);
    assert.equal(await isReviewed(dir), true);
  });
});

test("N4: a narration transcribed or changed after review makes the marker stale", async () => {
  await withDir(async (dir) => {
    await markReviewed(dir);
    assert.equal(await isReviewed(dir), true);
    await writeFile(path.join(dir, "narration.json"), '{"segments":[{"text":"hello"}]}');
    assert.equal(await isReviewed(dir), false, "a transcript appeared after review");

    const marker = await markReviewed(dir);
    assert.match(marker.narration_sha256, /^sha256:[0-9a-f]{64}$/);
    assert.equal(await isReviewed(dir), true);
    await writeFile(path.join(dir, "narration.json"), '{"segments":[{"text":"hello again"}]}');
    assert.equal(await isReviewed(dir), false, "a changed transcript");
    await rm(path.join(dir, "narration.json"));
    assert.equal(await isReviewed(dir), false, "a removed transcript");
  });
});

test("N4: a marker written before the narration hash existed is not trusted", async () => {
  await withDir(async (dir) => {
    await writeFile(path.join(dir, REVIEWED_FILE), JSON.stringify({ reviewed_at: "2026-11-24T08:00:00Z", edit_count: 0 }));
    assert.equal(await isReviewed(dir), false);
  });
});

test("N4: reviewed_at is readable for the manifest", async () => {
  await withDir(async (dir) => {
    assert.equal(await readReviewedMarker(dir), null);
    await markReviewed(dir, () => new Date("2026-11-24T09:15:00Z"));
    assert.equal((await readReviewedMarker(dir))?.reviewed_at, "2026-11-24T09:15:00.000Z");
  });
});

test("a corrupt marker is not a review", async () => {
  await withDir(async (dir) => {
    await writeFile(path.join(dir, REVIEWED_FILE), "{not json");
    assert.equal(await isReviewed(dir), false);
    await writeFile(path.join(dir, REVIEWED_FILE), JSON.stringify({ reviewed_at: 5 }));
    assert.equal(await isReviewed(dir), false);
  });
});
