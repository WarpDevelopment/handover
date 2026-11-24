// L4: pause, resume and Explain (freeze) on the recorder controller.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { FULL_CAPTURE } from "../../common/config";
import type { EventPayloads, EventType } from "../../common/events";
import { computeTiming, withoutFrozenCollectorEvents } from "../../common/handover/build-package";
import type { RecEvent } from "../../common/types";
import type { Collector, CollectorContext } from "./collector";
import { RecorderController, type FrozenFrame } from "./controller";

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A collector the test drives by hand, standing in for the click helper and the window poller. */
class HandCollector implements Collector {
  readonly name = "hand";
  private ctx: CollectorContext | null = null;
  start(ctx: CollectorContext): void {
    this.ctx = ctx;
  }
  stop(): void {
    this.ctx = null;
  }
  emit<K extends EventType>(type: K, payload: EventPayloads[K]): void {
    this.ctx?.publish(type, payload);
  }
  click(x = 10, y = 10): void {
    this.emit("pointer.click", { button: "left", clickCount: 1, space: "macos_global_points", x, y });
  }
}

const LAYOUT = {
  globalSpace: "macos_global_points" as const,
  displays: [
    { id: 1, originGlobal: [0, 0] as [number, number], sizeDpx: [2880, 1800] as [number, number], scaleFactor: 2, primary: true },
    { id: 2, originGlobal: [-1280, 0] as [number, number], sizeDpx: [2560, 1440] as [number, number], scaleFactor: 2, primary: false },
  ],
};

const FRAMES: FrozenFrame[] = [
  { file: "shots/000001.jpg", displayId: 1, epoch: 1 },
  { file: "shots/000002.jpg", displayId: 2, epoch: 1 },
];

function makeController(opts: {
  video?: boolean;
  onAborted?: () => void;
  isOwnWindowClick?: (c: { x: number; y: number }) => boolean;
  pointerDisplayId?: () => number | undefined;
} = {}): {
  controller: RecorderController;
  hand: HandCollector;
  snapshots: number[];
} {
  const hand = new HandCollector();
  const snapshots: number[] = [];
  const controller = new RecorderController({
    resolveConfig: () => ({ ...FULL_CAPTURE }),
    buildCollectors: () => [hand],
    ...(opts.video === false
      ? {}
      : {
          createVideoRecorder: () => ({
            start: async () => undefined,
            stop: async () => null,
            snapshot: async () => {
              snapshots.push(Date.now());
              return FRAMES;
            },
          }),
        }),
    deleteSession: async () => undefined,
    getDisplays: () => LAYOUT,
    onExplainAborted: opts.onAborted,
    isOwnWindowClick: opts.isOwnWindowClick,
    pointerDisplayId: opts.pointerDisplayId,
  });
  return { controller, hand, snapshots };
}

async function readEvents(root: string, id: string): Promise<RecEvent[]> {
  return (await readFile(path.join(root, id, "events.jsonl"), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as RecEvent);
}

async function withSessionsRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "handover-explain-"));
  const previous = process.env.HANDOVER_SESSIONS_DIR;
  process.env.HANDOVER_SESSIONS_DIR = root;
  try {
    await run(root);
  } finally {
    if (previous === undefined) delete process.env.HANDOVER_SESSIONS_DIR;
    else process.env.HANDOVER_SESSIONS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

test("pause writes an open gap{user_paused}, drops collector events, and resume closes the gap", async () => {
  await withSessionsRoot(async (root) => {
    const { controller, hand } = makeController();
    const started = await controller.start();
    assert.equal(started.ok, true);
    hand.click(1, 1); // recorded
    assert.equal((await controller.pause()).ok, true);
    assert.equal(controller.status().paused, true);
    hand.click(2, 2); // PKG-11: reaches the log (the builder judges it by acted time)
    hand.emit("app.activate", { app: "Mail", title: "Inbox" }); // dropped: paused
    await delay(30);
    assert.equal((await controller.resume()).ok, true);
    assert.equal(controller.status().paused, false);
    hand.click(3, 3); // recorded
    assert.equal((await controller.stop()).ok, true);

    const events = await readEvents(root, started.sessionId!);
    const clicks = events.filter((e) => e.type === "pointer.click").map((e) => e.payload.x);
    assert.deepEqual(clicks, [1, 2, 3]);
    assert.ok(!events.some((e) => e.type === "app.activate"));
    const gaps = events.filter((e) => e.type === "gap");
    assert.equal(gaps.length, 2);
    assert.deepEqual(gaps[0].payload, { reason: "user_paused" }, "open: no tEndMs");
    const end = gaps[1].payload.tEndMs as number;
    assert.equal(typeof end, "number");
    assert.ok(end >= gaps[0].t + 25, `closed after the pause lasted (${end} vs ${gaps[0].t})`);
    // pause twice and resume twice are harmless
    assert.deepEqual(await controller.pause(), { ok: false, error: "Not recording" });
  });
});

test("task + explain + paused = duration, with explain time kept out of task time", async () => {
  await withSessionsRoot(async (root) => {
    const { controller, hand } = makeController();
    const started = await controller.start();
    await delay(40); // task time
    hand.click();
    await controller.pause();
    await delay(80); // paused
    await controller.resume();
    await delay(20); // task time
    const begun = await controller.beginExplain();
    assert.equal(begun.ok, true);
    await delay(100); // explain time
    const ended = await controller.endExplain({ cancelled: false, annotations: [{ kind: "comment", text: "note" }] });
    assert.equal(ended.ok, true);
    await delay(20);
    assert.equal((await controller.stop()).ok, true);

    const events = await readEvents(root, started.sessionId!);
    const stop = events.find((e) => e.type === "session.stop")!;
    const duration = Math.round(stop.t);
    const timing = computeTiming(events, duration);
    assert.equal(timing.task_ms + timing.explain_ms + timing.paused_ms, duration);
    assert.ok(timing.paused_ms >= 75, `paused ${timing.paused_ms}`);
    assert.ok(timing.explain_ms >= 95, `explain ${timing.explain_ms}`);
    assert.ok(timing.task_ms >= 55 && timing.task_ms < duration - 170, `task ${timing.task_ms} of ${duration}`);
    // Explain time is not paused time and not task time.
    const startEv = events.find((e) => e.type === "explain.start")!;
    const endEv = events.find((e) => e.type === "explain.end")!;
    assert.ok(Math.abs(timing.explain_ms - (endEv.t - startEv.t)) <= 2);
  });
});

test("explain: one frozen frame per display, annotations typed with ids and frameFile, then explain.end", async () => {
  await withSessionsRoot(async (root) => {
    const { controller, snapshots } = makeController();
    const started = await controller.start();
    const begun = await controller.beginExplain();
    assert.equal(begun.ok, true);
    assert.equal(snapshots.length, 1);
    assert.deepEqual(begun.frames, FRAMES);
    assert.equal(controller.status().explaining, true);
    // A second freeze while frozen is refused; so is pausing.
    assert.equal((await controller.beginExplain()).ok, false);
    assert.equal((await controller.pause()).ok, false);

    const ended = await controller.endExplain({
      cancelled: false,
      annotations: [
        { kind: "highlight", displayId: 1, shape: "rect", pointsDpx: [[100, 100], [400, 300]] },
        { kind: "highlight", displayId: 2, shape: "arrow", pointsDpx: [[10, 10], [900, 900]] },
        { kind: "comment", text: "  Check this total  " },
        // dropped: unknown display, wrong point count, empty comment, unknown shape
        { kind: "highlight", displayId: 9, shape: "rect", pointsDpx: [[0, 0], [1, 1]] },
        { kind: "highlight", displayId: 1, shape: "rect", pointsDpx: [[0, 0], [1, 1], [2, 2]] },
        { kind: "highlight", displayId: 1, shape: "star", pointsDpx: [[0, 0], [1, 1]] },
        { kind: "comment", text: "   " },
      ],
    });
    assert.deepEqual(ended.annotationIds, ["ann_0001", "ann_0002", "ann_0003"]);
    assert.equal(controller.status().explaining, false);
    await controller.stop();

    const events = await readEvents(root, started.sessionId!);
    const order = events.map((e) => e.type).filter((t) => ["explain.start", "annotation", "explain.end"].includes(t));
    assert.deepEqual(order, ["explain.start", "annotation", "annotation", "annotation", "explain.end"]);
    const anns = events.filter((e) => e.type === "annotation").map((e) => e.payload);
    assert.deepEqual(anns[0], {
      annotationId: "ann_0001",
      kind: "highlight",
      displayId: 1,
      frameFile: "shots/000001.jpg",
      shape: "rect",
      pointsDpx: [[100, 100], [400, 300]],
    });
    assert.equal(anns[1].frameFile, "shots/000002.jpg");
    assert.deepEqual(anns[2], { annotationId: "ann_0003", kind: "comment", text: "Check this total", source: "typed" });
    assert.deepEqual(events.find((e) => e.type === "explain.start")!.payload, { displayIds: [1, 2] });
  });
});

test("explain.start records the display under the pointer, so a comment-only freeze lands on the right display", async () => {
  await withSessionsRoot(async (root) => {
    const { controller } = makeController({ pointerDisplayId: () => 2 });
    const started = await controller.start();
    await controller.beginExplain();
    await controller.endExplain({ cancelled: true });
    await controller.stop();
    const start = (await readEvents(root, started.sessionId!)).find((e) => e.type === "explain.start")!;
    assert.deepEqual(start.payload, { displayIds: [1, 2], pointerDisplayId: 2 });
  });
});

test("clicks and app switches between explain.start and explain.end are never recorded", async () => {
  await withSessionsRoot(async (root) => {
    const { controller, hand } = makeController();
    const started = await controller.start();
    hand.click(1, 1); // before the freeze: a step
    await controller.beginExplain();
    hand.click(500, 500); // a click on the overlay's own button
    hand.emit("app.activate", { app: "Handover", title: "Explain" });
    hand.emit("clipboard.change", { formats: ["text/plain"], length: 3, hash: "x" });
    await controller.endExplain({ cancelled: true, annotations: [] });
    hand.click(2, 2); // after the freeze: a step again
    await controller.stop();

    const events = await readEvents(root, started.sessionId!);
    // PKG-11: the bus lets clicks through; the builder's acted-time filter drops the one in the freeze.
    assert.deepEqual(events.filter((e) => e.type === "pointer.click").map((e) => e.payload.x), [1, 500, 2]);
    assert.ok(!events.some((e) => e.type === "app.activate" || e.type === "clipboard.change"));
    const kept = withoutFrozenCollectorEvents(events).filter((e) => e.type === "pointer.click");
    assert.deepEqual(kept.map((e) => e.payload.x), [1, 2], "the overlay click is not a step");
  });
});

test("a click on Handover's own recording bar is never recorded (Explain, Pause and Resume are not steps)", async () => {
  await withSessionsRoot(async (root) => {
    // The bar sits at x < 100 in this test; the rest of the screen is the user's work.
    const { controller, hand } = makeController({ isOwnWindowClick: (c) => c.x < 100 });
    const started = await controller.start();
    hand.click(500, 500); // a real step
    hand.click(40, 900); // the click that pressed Explain
    await controller.beginExplain();
    await controller.endExplain({ cancelled: true });
    hand.click(60, 900); // the click that pressed Pause
    await controller.pause();
    hand.click(20, 900); // the click that pressed Resume
    await controller.resume();
    hand.click(700, 700); // a real step
    await controller.stop();
    const clicks = (await readEvents(root, started.sessionId!)).filter((e) => e.type === "pointer.click");
    assert.deepEqual(clicks.map((e) => e.payload.x), [500, 700]);
  });
});

test("a cancelled freeze writes explain.end and no annotations", async () => {
  await withSessionsRoot(async (root) => {
    const { controller } = makeController();
    const started = await controller.start();
    await controller.beginExplain();
    const ended = await controller.endExplain({ cancelled: true, annotations: [{ kind: "comment", text: "ignored" }] });
    assert.deepEqual(ended, { ok: true, annotationIds: [] });
    await controller.stop();
    const types = (await readEvents(root, started.sessionId!)).map((e) => e.type);
    assert.ok(types.includes("explain.start") && types.includes("explain.end"));
    assert.ok(!types.includes("annotation"));
    assert.deepEqual(await controller.endExplain({}), { ok: false, error: "The screen is not frozen." });
  });
});

test("explain is refused when screen capture gave no frame, while paused, and when not recording", async () => {
  await withSessionsRoot(async () => {
    const noVideo = makeController({ video: false });
    assert.deepEqual(await noVideo.controller.beginExplain(), { ok: false, error: "Not recording" });
    await noVideo.controller.start();
    const refused = await noVideo.controller.beginExplain();
    assert.equal(refused.ok, false);
    assert.match(refused.error ?? "", /cannot be frozen/);
    assert.equal(noVideo.controller.status().explaining, false, "no freeze without a frame");
    await noVideo.controller.stop();

    const { controller } = makeController();
    await controller.start();
    await controller.pause();
    const whilePaused = await controller.beginExplain();
    assert.equal(whilePaused.ok, false);
    assert.match(whilePaused.error ?? "", /Resume/);
    await controller.stop();
  });
});

test("stopping while frozen or paused closes both and tells the window layer", async () => {
  await withSessionsRoot(async (root) => {
    let aborted = 0;
    const { controller } = makeController({ onAborted: () => aborted++ });
    const a = await controller.start();
    await controller.beginExplain();
    assert.equal((await controller.stop()).ok, true);
    assert.equal(aborted, 1);
    const evA = await readEvents(root, a.sessionId!);
    assert.deepEqual(
      evA.map((e) => e.type).filter((t) => t.startsWith("explain")),
      ["explain.start", "explain.end"],
    );

    const b = await controller.start();
    await controller.pause();
    assert.equal((await controller.stop()).ok, true);
    const gaps = (await readEvents(root, b.sessionId!)).filter((e) => e.type === "gap");
    assert.equal(gaps.length, 2);
    assert.equal(typeof gaps[1].payload.tEndMs, "number", "the open pause is closed at stop");
    assert.equal(controller.status().paused, false);
    // The next session starts clean.
    const c = await controller.start();
    assert.equal(controller.status().paused, false);
    assert.equal(controller.status().explaining, false);
    assert.ok(c.ok);
    await controller.stop();
  });
});
