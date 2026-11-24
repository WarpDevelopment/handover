import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { FULL_CAPTURE } from "../../common/config";
import type { EventPayloads, EventType } from "../../common/events";
import { RecorderController } from "../recorder/controller";
import type { CollectorContext } from "../recorder/collector";
import { parseHelperLine } from "./helper-protocol";
import { HelperTracker, type HelperLaunch } from "./helper-status";
import { PointerHelperCollector } from "./pointer-helper";

const FAKE = path.resolve("test/fixtures/fake-helper.mjs");

function launch(...args: string[]): () => HelperLaunch {
  return () => ({ file: process.execPath, args: [FAKE, ...args] });
}

interface Published {
  type: EventType;
  payload: unknown;
}

function fakeContext(elapsedMs?: () => number): { ctx: CollectorContext; events: Published[]; logs: string[] } {
  const events: Published[] = [];
  const logs: string[] = [];
  const log = (...a: unknown[]) => logs.push(a.join(" "));
  const ctx: CollectorContext = {
    sessionDir: "",
    ...(elapsedMs ? { elapsedMs } : {}),
    log: { info: log, warn: log, error: log },
    publish: <K extends EventType>(type: K, payload: EventPayloads[K]) => {
      events.push({ type, payload });
    },
  };
  return { ctx, events, logs };
}

async function waitFor(predicate: () => boolean, what: string, ms = 8000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

const clicks = (events: Published[]) =>
  events.filter((e) => e.type === "pointer.click").map((e) => e.payload as EventPayloads["pointer.click"]);
const gaps = (events: Published[]) =>
  events.filter((e) => e.type === "gap").map((e) => e.payload as EventPayloads["gap"]);

// --- CollectorContext.elapsedMs (NAT-7) ---

test("CollectorHost hands each collector the session clock as ctx.elapsedMs", async () => {
  const { CollectorHost } = await import("../recorder/collector");
  const { EventBus } = await import("../recorder/event-bus");
  let seen: (() => number) | undefined;
  const host = new CollectorHost(new EventBus());
  await host.startAll(
    [{ name: "Probe", start: (ctx) => { seen = ctx.elapsedMs?.bind(ctx); }, stop: () => undefined }],
    "",
    () => 1234,
  );
  assert.equal(seen?.(), 1234);
  await host.stopAll();
});

// --- Protocol parsing ---

test("a well-formed click with a target keeps declared fields only", () => {
  const line = JSON.stringify({
    type: "click", button: "left", clickCount: 2, x: 10, y: 20, lookupMs: 41.6,
    target: {
      grounding: "accessibility", source: "uia", role: "textbox", nativeRole: "Edit", name: "Password",
      isPassword: true, value: "hunter2", bounds: { x: 1, y: 2, width: 3, height: 4 },
      ancestry: Array.from({ length: 9 }, (_, i) => ({ role: "pane", name: `p${i}` })),
      app: { name: "app", extra: "x" },
    },
  });
  const msg = parseHelperLine(line);
  assert.equal(msg?.kind, "click");
  if (msg?.kind !== "click") return;
  assert.equal(msg.click.clickCount, 2);
  assert.equal(msg.click.lookupMs, 42);
  assert.equal(msg.click.target?.isPassword, true);
  assert.equal(msg.click.target?.name, "Password");
  assert.equal(msg.click.target?.ancestry?.length, 6);
  assert.equal(JSON.stringify(msg).includes("hunter2"), false);
  assert.equal(Object.hasOwn(msg.click.target ?? {}, "value"), false);
});

test("a click with no target is given a reason; unknown roles become other", () => {
  const bare = parseHelperLine('{"type":"click","button":"middle","x":1,"y":2}');
  assert.equal(bare?.kind === "click" && bare.click.unavailableReason, "opaque_toolkit");
  const odd = parseHelperLine(
    '{"type":"click","button":"left","x":1,"y":2,"target":{"grounding":"accessibility","source":"ax","role":"scrollbar","name":"n"}}',
  );
  assert.equal(odd?.kind === "click" && odd.click.target?.role, "other");
});

test("malformed, unknown and oversize lines are ignored", () => {
  for (const line of ["", "nope", "[]", "null", '{"type":"mystery"}', '{"type":"click","button":"left"}',
    '{"type":"click","button":"left","x":"1","y":2}', `{"type":"hello","pad":"${"x".repeat(70000)}"}`]) {
    assert.equal(parseHelperLine(line), null, line.slice(0, 40));
  }
});

test("G1: a blind start and end line parse; a malformed one is rejected", () => {
  assert.deepEqual(
    parseHelperLine('{"type":"blind","reason":"elevated_window","state":"start","process":"Taskmgr"}'),
    { kind: "blind", reason: "elevated_window", state: "start", process: "Taskmgr" },
  );
  assert.deepEqual(parseHelperLine('{"type":"blind","reason":"elevated_window","state":"end"}'), {
    kind: "blind",
    reason: "elevated_window",
    state: "end",
  });
  // A start without a process name is still a blind spot; the name is optional.
  assert.deepEqual(parseHelperLine('{"type":"blind","reason":"elevated_window","state":"start"}'), {
    kind: "blind",
    reason: "elevated_window",
    state: "start",
  });
  // A path or control characters never reach the event stream.
  const odd = parseHelperLine('{"type":"blind","reason":"elevated_window","state":"start","process":"C:\\\\Users\\\\bob\\\\x.exe\\n"}');
  assert.equal(odd?.kind === "blind" && odd.process?.includes("bob"), false);
  for (const line of [
    '{"type":"blind"}',
    '{"type":"blind","reason":"elevated_window"}',
    '{"type":"blind","reason":"elevated_window","state":"middle"}',
    '{"type":"blind","reason":"made_up","state":"start"}',
    '{"type":"blind","state":"start"}',
    '{"type":"blind","reason":"elevated_window","state":1}',
  ]) {
    assert.equal(parseHelperLine(line), null, line);
  }
});

// --- Collector driven by the fake helper ---

test("clicks with and without a target become pointer.click events; malformed lines are skipped", async () => {
  const { ctx, events } = fakeContext();
  const tracker = new HelperTracker(launch("good"));
  const collector = new PointerHelperCollector({ platform: "win32", resolve: launch("good"), tracker });
  collector.start(ctx);
  try {
    await waitFor(() => clicks(events).length >= 2, "two clicks");
    const [withTarget, without] = clicks(events);
    assert.equal(withTarget?.space, "windows_virtual_px");
    assert.deepEqual([withTarget?.x, withTarget?.y, withTarget?.button], [105, 215, "left"]);
    assert.equal(withTarget?.target?.name, "Save");
    assert.equal(withTarget?.target?.automationId, "saveBtn");
    assert.equal(JSON.stringify(events).includes("SECRET FIELD VALUE"), false);
    assert.equal(without?.target, undefined);
    assert.equal(without?.unavailableReason, "timeout");
    assert.equal(clicks(events).length, 2, "the malformed lines produced no events");
    assert.equal(gaps(events).length, 0);

    const report = tracker.report();
    assert.equal(report.helper, "ok");
    assert.equal(report.version, "9.9.9");
    assert.deepEqual(report.counts, { accessibility: 1, accessibility_weak: 0, none: 1 });
    assert.equal(report.lookupP95Ms, 300);
  } finally {
    await collector.stop();
  }
});

test("a helper crash writes an open gap, restarts, closes the gap and keeps the clicks coming", async () => {
  const state = path.join(await mkdtemp(path.join(tmpdir(), "handover-helper-")), "state");
  const { ctx, events } = fakeContext();
  const tracker = new HelperTracker(launch("crash-once", state));
  const collector = new PointerHelperCollector({
    platform: "win32", resolve: launch("crash-once", state), tracker, restartDelayMs: 20,
  });
  collector.start(ctx);
  try {
    await waitFor(() => clicks(events).length >= 2, "clicks after restart");
    const g = gaps(events);
    assert.equal(g.length, 2);
    assert.deepEqual(g[0], { reason: "helper_restart" });
    assert.equal(g[1]?.reason, "helper_restart");
    assert.equal(typeof g[1]?.tEndMs, "number");
    assert.equal(tracker.report().helper, "ok");
  } finally {
    await collector.stop();
    await rm(path.dirname(state), { recursive: true, force: true });
  }
});

test("a helper that crashes every time is given up on after the restart limit, without throwing", async () => {
  const { ctx, events } = fakeContext();
  const tracker = new HelperTracker(() => null);
  const collector = new PointerHelperCollector({
    platform: "win32", resolve: () => ({ file: process.execPath, args: ["-e", "process.exit(3)"] }),
    tracker, maxRestarts: 1, restartDelayMs: 10,
  });
  collector.start(ctx);
  try {
    await waitFor(() => tracker.report().helper === "crashed" && /code 3/.test(tracker.report().lastError ?? ""), "crashed");
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(gaps(events).length, 1, "one open gap, not one per restart");
    assert.equal(clicks(events).length, 0);
  } finally {
    await collector.stop();
  }
});

test("a helper that never says hello is killed and treated as a crash", async () => {
  const { ctx, events } = fakeContext();
  const tracker = new HelperTracker(launch("silent"));
  const collector = new PointerHelperCollector({
    platform: "win32", resolve: launch("silent"), tracker, helloTimeoutMs: 100, maxRestarts: 0,
  });
  collector.start(ctx);
  try {
    await waitFor(() => tracker.report().helper === "crashed", "crash after hello timeout");
    assert.deepEqual(gaps(events), [{ reason: "helper_restart" }]);
  } finally {
    await collector.stop();
  }
});

test("a missing helper logs, opens a gap, reports missing and does not throw", () => {
  const { ctx, events, logs } = fakeContext();
  const tracker = new HelperTracker(() => null);
  const collector = new PointerHelperCollector({ platform: "win32", resolve: () => null, tracker });
  collector.start(ctx);
  assert.deepEqual(gaps(events), [{ reason: "helper_restart" }]);
  assert.equal(tracker.report().helper, "missing");
  assert.match(logs.join("\n"), /not found/i);
});

test("macOS without Accessibility: clicks carry permission_missing and no target; doctor says no-permission", async () => {
  const { ctx, events } = fakeContext();
  const tracker = new HelperTracker(launch("no-ax"));
  const collector = new PointerHelperCollector({ platform: "darwin", resolve: launch("no-ax"), tracker });
  collector.start(ctx);
  try {
    await waitFor(() => clicks(events).length >= 1, "a click");
    const click = clicks(events)[0];
    assert.equal(click?.space, "macos_global_points");
    assert.equal(click?.target, undefined);
    assert.equal(click?.unavailableReason, "permission_missing");
    assert.equal(tracker.report().helper, "no-permission");
    assert.equal(gaps(events).length, 0, "clicks still arrive, so this is not a gap");
  } finally {
    await collector.stop();
  }
});

test("macOS tap not creatable yet: a permission_lost gap is opened", async () => {
  const { ctx, events } = fakeContext();
  const tracker = new HelperTracker(launch("no-tap"));
  const collector = new PointerHelperCollector({ platform: "darwin", resolve: launch("no-tap"), tracker });
  collector.start(ctx);
  try {
    await waitFor(() => gaps(events).length >= 1, "a gap");
    assert.deepEqual(gaps(events)[0], { reason: "permission_lost" });
    assert.equal(tracker.report().helper, "no-permission");
  } finally {
    await collector.stop();
  }
});

// --- Acceptance 3: helper deleted, the app still records and finishes ---

test("with the helper missing a recording still starts, stops and saves, with a gap in events.jsonl", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "handover-l5-"));
  const previous = process.env.HANDOVER_SESSIONS_DIR;
  process.env.HANDOVER_SESSIONS_DIR = root;
  const tracker = new HelperTracker(() => null);
  try {
    const controller = new RecorderController({
      resolveConfig: () => ({ ...FULL_CAPTURE, video: false }),
      buildCollectors: () => [new PointerHelperCollector({ platform: "win32", resolve: () => null, tracker })],
      deleteSession: async () => undefined,
    });
    const started = await controller.start();
    assert.equal(started.ok, true);
    assert.equal(controller.status().state, "recording");
    const stopped = await controller.stop();
    assert.equal(stopped.ok, true);

    const events = (await readFile(path.join(root, String(started.sessionId), "events.jsonl"), "utf8"))
      .trim().split("\n").map((l) => JSON.parse(l) as { type: string; payload: { reason?: string } });
    const gap = events.find((e) => e.type === "gap");
    assert.equal(gap?.payload.reason, "helper_restart");
    assert.equal(tracker.report().helper, "missing");
  } finally {
    if (previous === undefined) delete process.env.HANDOVER_SESSIONS_DIR;
    else process.env.HANDOVER_SESSIONS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("the tracker reports percentiles and falls back to the file check before any recording", () => {
  const t = new HelperTracker(() => ({ file: "x", args: [] }));
  assert.equal(t.report().helper, "ok");
  assert.equal(t.report().lookupP50Ms, null);
  for (const ms of [10, 20, 30, 40, 100]) t.recordClick("accessibility", ms);
  assert.equal(t.report().lookupP50Ms, 30);
  assert.equal(t.report().lookupP95Ms, 100);
  assert.equal(new HelperTracker(() => null).report().helper, "missing");
});

// --- Review fixes: NAT-1..4, 7, 8, SEC-7, SEC-11 ---

test("NAT-1: trust revoked mid-run opens a permission_lost gap and the doctor says no-permission", async () => {
  const { ctx, events } = fakeContext();
  const tracker = new HelperTracker(launch("trust-revoked"));
  const collector = new PointerHelperCollector({ platform: "darwin", resolve: launch("trust-revoked"), tracker });
  collector.start(ctx);
  try {
    await waitFor(() => gaps(events).length >= 1, "a gap after the revoke");
    assert.equal(clicks(events).length, 1, "the click before the revoke was kept");
    assert.deepEqual(gaps(events)[0], { reason: "permission_lost" });
    assert.equal(tracker.report().helper, "no-permission");
  } finally {
    await collector.stop();
  }
});

test("NAT-2: hook_lost opens a helper_restart gap and the reinstall closes it", async () => {
  const { ctx, events } = fakeContext();
  const tracker = new HelperTracker(launch("hook-lost"));
  const collector = new PointerHelperCollector({ platform: "win32", resolve: launch("hook-lost"), tracker });
  collector.start(ctx);
  try {
    await waitFor(() => gaps(events).length >= 2, "gap open and close");
    const g = gaps(events);
    assert.deepEqual(g[0], { reason: "helper_restart" });
    assert.equal(g[1]?.reason, "helper_restart");
    assert.equal(typeof g[1]?.tEndMs, "number");
    assert.equal(tracker.report().helper, "ok");
  } finally {
    await collector.stop();
  }
});

test("NAT-3: U+2028, U+2029 and U+0085 inside a name do not split the line; the click survives", async () => {
  const { ctx, events } = fakeContext();
  const tracker = new HelperTracker(launch("unicode-name"));
  const collector = new PointerHelperCollector({ platform: "win32", resolve: launch("unicode-name"), tracker });
  collector.start(ctx);
  try {
    await waitFor(() => clicks(events).length >= 2, "both clicks");
    const first = clicks(events)[0];
    assert.deepEqual([first?.x, first?.y], [7, 8]);
    assert.equal(first?.target?.name, "Line One Two Three");
  } finally {
    await collector.stop();
  }
});

test("NAT-3: the line splitter breaks on LF only and strips CR", async () => {
  const { createLineSplitter } = await import("./helper-protocol");
  const lines: string[] = [];
  const s = createLineSplitter((l) => lines.push(l));
  s.push('a b\r\nc');
  s.push("d\n\ne");
  s.end();
  assert.deepEqual(lines, ["a b", "cd", "", "e"]);
  const big: string[] = [];
  const small = createLineSplitter((l) => big.push(l), 10);
  small.push("x".repeat(30));
  small.push("tail\nok\n");
  assert.deepEqual(big, ["ok"], "an oversize line is dropped whole");
});

test("NAT-4: hook false while Accessibility is granted is a gap and not healthy", async () => {
  const { ctx, events } = fakeContext();
  const tracker = new HelperTracker(launch("hook-false-trusted"));
  const collector = new PointerHelperCollector({ platform: "darwin", resolve: launch("hook-false-trusted"), tracker });
  collector.start(ctx);
  try {
    await waitFor(() => gaps(events).length >= 1, "a gap");
    assert.deepEqual(gaps(events)[0], { reason: "helper_restart" });
    // The real macOS helper follows this line with an `error` line; it must not flip the state back to ok.
    await waitFor(() => /event tap/.test(tracker.report().lastError ?? ""), "the error line");
    assert.notEqual(tracker.report().helper, "ok");
    assert.equal(tracker.report().helper, "crashed");
  } finally {
    await collector.stop();
  }
});

test("NAT-7: a closed gap ends on the session clock, not on wall-clock since start", async () => {
  const { ctx, events } = fakeContext(() => 777);
  const tracker = new HelperTracker(launch("hook-lost"));
  const collector = new PointerHelperCollector({ platform: "win32", resolve: launch("hook-lost"), tracker });
  collector.start(ctx);
  try {
    await waitFor(() => gaps(events).length >= 2, "gap open and close");
    assert.equal(gaps(events)[1]?.tEndMs, 777);
  } finally {
    await collector.stop();
  }
});

test("NAT-8: the restart allowance recovers after a stable run, and does not when the helper dies at once", async () => {
  async function relaunches(stableMs: number): Promise<number> {
    const { ctx } = fakeContext();
    let spawns = 0;
    const resolve = (): HelperLaunch => {
      spawns += 1;
      return { file: process.execPath, args: [FAKE, "crash-after-hello"] };
    };
    const collector = new PointerHelperCollector({
      platform: "win32", resolve, tracker: new HelperTracker(() => null),
      maxRestarts: 1, restartDelayMs: 5, stableMs,
    });
    collector.start(ctx);
    await new Promise((r) => setTimeout(r, 1200));
    await collector.stop();
    return spawns;
  }
  assert.equal(await relaunches(60_000), 2, "one launch plus one restart, then given up");
  assert.ok((await relaunches(0)) > 3, "each run counted as stable, so restarts keep coming");
});

test("SEC-7: a spawn failure stores a code, never the path or the OS username", async () => {
  const { ctx } = fakeContext();
  const tracker = new HelperTracker(() => null);
  const secretPath = path.join(tmpdir(), "jane.doe-the-username", "HandoverHelper.exe");
  const collector = new PointerHelperCollector({
    platform: "win32", resolve: () => ({ file: secretPath, args: [] }),
    tracker, maxRestarts: 0,
  });
  collector.start(ctx);
  try {
    await waitFor(() => tracker.report().helper === "crashed", "crash");
    const err = tracker.report().lastError ?? "";
    assert.match(err, /ENOENT/);
    assert.equal(err.includes("jane.doe"), false);
    assert.equal(err.includes(tmpdir()), false);
  } finally {
    await collector.stop();
  }
});

test("SEC-11: a packaged app never launches a helper from <cwd>/native/build", async () => {
  const { defaultHelperLaunch } = await import("./helper-status");
  const cwd = await mkdtemp(path.join(tmpdir(), "handover-cwd-"));
  const { mkdir, writeFile } = await import("node:fs/promises");
  try {
    await mkdir(path.join(cwd, "native", "build"), { recursive: true });
    await writeFile(path.join(cwd, "native", "build", "HandoverHelper.exe"), "x");
    assert.equal(defaultHelperLaunch("win32", undefined, cwd, true), null);
    assert.equal(defaultHelperLaunch("win32", undefined, cwd, false)?.file, path.join(cwd, "native", "build", "HandoverHelper.exe"));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

// --- G1: the elevated-window blind spot ---

test("G1: blind start and end open and close one elevated_window gap; a repeated start does not open a second", async () => {
  const { ctx, events } = fakeContext(() => 4321);
  const tracker = new HelperTracker(launch("blind-repeat"));
  const collector = new PointerHelperCollector({ platform: "win32", resolve: launch("blind-repeat"), tracker });
  collector.start(ctx);
  try {
    await waitFor(() => gaps(events).length >= 2, "gap open and close");
    await new Promise((r) => setTimeout(r, 100)); // room for a wrongly opened second gap
    const g = gaps(events);
    assert.equal(g.length, 2, "one opened, one closed");
    assert.deepEqual(g[0], { reason: "elevated_window", process: "Taskmgr" });
    assert.deepEqual(g[1], { reason: "elevated_window", tEndMs: 4321 });
    assert.equal(tracker.report().helper, "ok", "a blind spot is not a helper fault");
  } finally {
    await collector.stop();
  }
});

test("G1: stopping the recording closes an open elevated_window gap", async () => {
  const { ctx, events } = fakeContext(() => 999);
  const tracker = new HelperTracker(launch("blind-hold"));
  const collector = new PointerHelperCollector({ platform: "win32", resolve: launch("blind-hold"), tracker });
  collector.start(ctx);
  await waitFor(() => gaps(events).length >= 1, "gap open");
  assert.equal(gaps(events).length, 1);
  await collector.stop();
  assert.deepEqual(gaps(events), [
    { reason: "elevated_window", process: "Taskmgr" },
    { reason: "elevated_window", tEndMs: 999 },
  ]);
});

// A pause is off the record: no elevated_window gap and no process name while paused, and elevated time never
// includes paused time. The collector learns of it through Collector.setPaused.
const elevatedGaps = (events: Published[]) => gaps(events).filter((g) => g.reason === "elevated_window");
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Hands the collector one helper line directly, as if the helper had printed it, so the order of a pause and a
 * blind line is exact and no test sleeps for a child process. The helper is the silent fake: it says nothing.
 */
function silentCollector(now: () => number, resumeGraceMs = 40) {
  const { ctx, events } = fakeContext(now);
  const tracker = new HelperTracker(launch("silent"));
  const collector = new PointerHelperCollector({
    platform: "win32", resolve: launch("silent"), tracker, helloTimeoutMs: 60_000, resumeGraceMs,
  });
  const feed = (msg: Record<string, unknown>) =>
    (collector as unknown as { onLine(line: string): void }).onLine(JSON.stringify({ type: "blind", reason: "elevated_window", ...msg }));
  collector.start(ctx);
  return { collector, events, feed };
}
const START = { state: "start", process: "Taskmgr" };
const END = { state: "end" };

test("G1 F2 (a): a blind start during a pause opens nothing and names nothing; resume opens it after the grace", async () => {
  const { collector, events, feed } = silentCollector(() => 100);
  try {
    collector.setPaused(true);
    feed(START);
    await settle(80);
    assert.deepEqual(elevatedGaps(events), [], "nothing opened while paused");
    assert.equal(JSON.stringify(events).includes("Taskmgr"), false, "no process name while paused");
    collector.setPaused(false);
    assert.deepEqual(elevatedGaps(events), [], "not at once: the helper's state may be a second old");
    await waitFor(() => elevatedGaps(events).length >= 1, "the gap after the grace");
    assert.equal(elevatedGaps(events)[0]?.process, "Taskmgr");
  } finally {
    await collector.stop();
  }
});

test("G1 D1: resume, then the helper says the window left within the grace: no gap and no process name", async () => {
  const { collector, events, feed } = silentCollector(() => 100, 120);
  try {
    collector.setPaused(true);
    feed(START);
    collector.setPaused(false);
    feed(END);
    await settle(300);
    assert.deepEqual(elevatedGaps(events), []);
    assert.equal(JSON.stringify(events).includes("Taskmgr"), false);
  } finally {
    await collector.stop();
  }
});

test("G1 D1: resume with no end opens one gap, stamped at the resume time and not at the timer's", async () => {
  let now = 500;
  const { collector, events, feed } = silentCollector(() => now, 40);
  try {
    collector.setPaused(true);
    feed(START);
    collector.setPaused(false); // resume at 500
    now = 900; // the timer fires later on the session clock
    await waitFor(() => elevatedGaps(events).length >= 1, "the gap");
    await settle(100);
    assert.deepEqual(elevatedGaps(events), [{ reason: "elevated_window", process: "Taskmgr", tStartMs: 500 }]);
  } finally {
    await collector.stop();
  }
});

test("G1 D1: pausing again, or stopping, while the resume is pending writes nothing", async () => {
  const a = silentCollector(() => 100, 80);
  try {
    a.collector.setPaused(true);
    a.feed(START);
    a.collector.setPaused(false);
    a.collector.setPaused(true);
    await settle(250);
    assert.deepEqual(elevatedGaps(a.events), []);
  } finally {
    await a.collector.stop();
  }
  const b = silentCollector(() => 100, 80);
  b.collector.setPaused(true);
  b.feed(START);
  b.collector.setPaused(false);
  await b.collector.stop();
  await settle(250);
  assert.deepEqual(elevatedGaps(b.events), []);
});

test("G1 F2 (b): a pause that begins while the gap is open closes it at the pause time; resume reopens it", async () => {
  let now = 1000;
  const { ctx, events } = fakeContext(() => now);
  const tracker = new HelperTracker(launch("blind-hold"));
  const collector = new PointerHelperCollector({ platform: "win32", resolve: launch("blind-hold"), tracker, resumeGraceMs: 20 });
  collector.start(ctx);
  try {
    await waitFor(() => elevatedGaps(events).length >= 1, "gap open");
    now = 2000;
    collector.setPaused(true);
    assert.deepEqual(elevatedGaps(events)[1], { reason: "elevated_window", tEndMs: 2000 }, "closed at the pause time");
    now = 5000;
    collector.setPaused(false);
    await waitFor(() => elevatedGaps(events).length >= 3, "reopened after the grace");
    assert.deepEqual(
      elevatedGaps(events).map((g) => (g.tEndMs === undefined ? "open" : `close@${g.tEndMs}`)),
      ["open", "close@2000", "open"],
    );
    assert.equal(elevatedGaps(events)[2]?.process, "Taskmgr");
    assert.equal(elevatedGaps(events)[2]?.tStartMs, 5000, "starts at the resume time");
  } finally {
    await collector.stop();
  }
});

test("G1 F2 (c): the helper says the admin window left during the pause; resume opens nothing", async () => {
  const { collector, events, feed } = silentCollector(() => 300);
  try {
    feed(START);
    assert.equal(elevatedGaps(events).length, 1, "open");
    collector.setPaused(true); // closes it
    feed(END); // the helper's end line arrives during the pause
    collector.setPaused(false);
    await settle(150); // longer than the grace
    assert.deepEqual(
      elevatedGaps(events).map((g) => (g.tEndMs === undefined ? "open" : "close")),
      ["open", "close"],
    );
  } finally {
    await collector.stop();
  }
});

test("G1: a helper restart closes the elevated_window gap, and the new helper's start opens a fresh one", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "blind-"));
  const state = path.join(dir, "state");
  const { ctx, events } = fakeContext(() => 55);
  const resolve = launch("blind-crash-once", state);
  const tracker = new HelperTracker(resolve);
  const collector = new PointerHelperCollector({ platform: "win32", resolve, tracker, restartDelayMs: 10 });
  collector.start(ctx);
  try {
    await waitFor(() => gaps(events).filter((g) => g.reason === "elevated_window").length >= 3, "open, close, open");
    const kinds = gaps(events).map((x) => `${x.reason}${x.tEndMs === undefined ? ":open" : ":close"}`);
    assert.deepEqual(kinds.slice(0, 2), ["elevated_window:open", "elevated_window:close"]);
    assert.ok(kinds.includes("helper_restart:open"), "the crash is still a helper_restart gap");
    assert.equal(kinds[kinds.length - 1], "elevated_window:open");
  } finally {
    await collector.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
