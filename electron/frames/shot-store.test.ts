import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { displaysPayload } from "../../common/handover/displays";
import type { ShotEntry } from "../../common/handover/types";
import type { RecEvent } from "../../common/types";
import { ShotStore } from "./shot-store";

const layout = displaysPayload({
  platform: "darwin",
  primaryId: 1,
  displays: [
    { id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 }, size: { width: 1440, height: 900 }, scaleFactor: 2 },
    { id: 2, bounds: { x: -1280, y: -100, width: 1280, height: 720 }, size: { width: 1280, height: 720 }, scaleFactor: 2 },
  ],
});
let seq = 0;
const ev = (type: string, epoch: number, payload: Record<string, unknown>): RecEvent => ({ seq: seq++, t: epoch - 1_000_000, epoch, type, source: "t", payload });
const jpeg = (n: number) => new Uint8Array([0xff, 0xd8, n, 0xff, 0xd9]);

async function withStore(fn: (dir: string, store: ShotStore, clock: { now: number }) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "handover-shots-"));
  const clock = { now: 1_000_000 };
  const store = new ShotStore(dir, undefined, () => clock.now);
  try {
    await fn(dir, store, clock);
  } finally {
    store.dispose();
    await rm(dir, { recursive: true, force: true });
  }
}

async function readIndex(dir: string): Promise<ShotEntry[]> {
  return JSON.parse(await readFile(path.join(dir, "shots.json"), "utf8")) as ShotEntry[];
}

test("a click persists the newest frame at least 50 ms before it, on the click's display only", async () => {
  await withStore(async (dir, store) => {
    store.onEvent(ev("displays", 1_000_000, layout as unknown as Record<string, unknown>));
    for (const [i, t] of [1_002_000, 1_002_700, 1_002_980].entries()) {
      store.ingest({ displayId: 1, epoch: t, width: 4, height: 4, data: jpeg(i + 1) });
      store.ingest({ displayId: 2, epoch: t, width: 4, height: 4, data: jpeg(i + 10) });
    }
    // Click at (-700, 250) points is on display 2.
    store.onEvent(ev("pointer.click", 1_003_000, { button: "left", clickCount: 1, space: "macos_global_points", x: -700, y: 250 }));
    await store.flush();
    const index = await readIndex(dir);
    const before = index.filter((e) => e.purpose === "before");
    assert.equal(before.length, 1, "only the frame a step needs is written");
    assert.equal(before[0].displayId, 2);
    assert.equal(before[0].epoch, 1_002_700, "1,002,980 is only 20 ms before the click");
    assert.deepEqual([...await readFile(path.join(dir, before[0].file))], [...jpeg(11)]);
    const files = await readdir(path.join(dir, "shots"));
    assert.equal(files.length, index.length, "no stray frames on disk");
  });
});

test("an app switch persists a frame from every display; duplicates are written once", async () => {
  await withStore(async (dir, store) => {
    store.onEvent(ev("displays", 1_000_000, layout as unknown as Record<string, unknown>));
    store.ingest({ displayId: 1, epoch: 1_001_000, width: 4, height: 4, data: jpeg(1) });
    store.ingest({ displayId: 2, epoch: 1_001_000, width: 4, height: 4, data: jpeg(2) });
    store.onEvent(ev("app.activate", 1_002_000, { app: "A", title: "" }));
    store.onEvent(ev("app.activate", 1_002_100, { app: "B", title: "" }));
    await store.flush();
    const before = (await readIndex(dir)).filter((e) => e.purpose === "before");
    assert.deepEqual(before.map((e) => e.displayId).sort(), [1, 2]);
  });
});

test("only the newest 'after' frame per display is kept, and non-step events write nothing", async () => {
  await withStore(async (dir, store) => {
    store.onEvent(ev("displays", 1_000_000, layout as unknown as Record<string, unknown>));
    store.ingest({ displayId: 1, epoch: 1_001_000, width: 4, height: 4, data: jpeg(1) });
    store.onEvent(ev("clipboard.change", 1_001_500, { formats: [], length: 1, hash: "h" }));
    store.onEvent(ev("pointer.click", 1_002_000, { button: "left", clickCount: 1, space: "macos_global_points", x: 10, y: 10 }));
    await store.flush();
    store.ingest({ displayId: 1, epoch: 1_002_600, width: 4, height: 4, data: jpeg(2) });
    store.onEvent(ev("pointer.click", 1_003_000, { button: "left", clickCount: 1, space: "macos_global_points", x: 20, y: 20 }));
    store.ingest({ displayId: 1, epoch: 1_003_600, width: 4, height: 4, data: jpeg(3) });
    await store.flush();
    const index = await readIndex(dir);
    const after = index.filter((e) => e.purpose === "after");
    assert.equal(after.length, 1);
    assert.equal(after[0].epoch, 1_003_600);
    const onDisk = await readdir(path.join(dir, "shots"));
    assert.equal(onDisk.length, index.length, "replaced 'after' frames are deleted from disk");
  });
});

test("an unchanged screen re-stamps the previous frame instead of storing a new one", async () => {
  await withStore(async (_dir, store) => {
    store.ingest({ displayId: 1, epoch: 1000, width: 4, height: 4, data: jpeg(1) });
    store.ingestSame(1, 1333);
    store.ingestSame(1, 1666);
    assert.equal(store.ring.latest(1)!.epoch, 1666);
    assert.equal(store.ring.count(1), 3);
    // They share the same bytes, so memory does not triple.
    assert.equal(store.ring.latest(1)!.data, store.ring.newestBefore(1, 1100)!.data);
    store.ingestSame(7, 5000); // nothing to re-stamp for an unknown display
    assert.equal(store.ring.count(7), 0);
  });
});

test("a snapshot persists a frozen frame per display", async () => {
  await withStore(async (dir, store) => {
    store.ingest({ displayId: 1, epoch: 1000, width: 4, height: 4, data: jpeg(1) });
    store.ingest({ displayId: 2, epoch: 1000, width: 4, height: 4, data: jpeg(2) });
    const out = await store.persistSnapshot();
    assert.equal(out.length, 2);
    assert.ok(out.every((e) => e.purpose === "annotation"));
    assert.equal((await readIndex(dir)).length, 2);
  });
});
