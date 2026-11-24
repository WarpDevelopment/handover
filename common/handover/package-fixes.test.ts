// Tests for the review findings of lane FP (docs/recorder/review/2026-11-23-full-review.md):
// PKG-1 to PKG-10 and SEC-1, SEC-4, SEC-5, SEC-6. Each one fails on the build before the fixes.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import sharp from "sharp";

import { buildPackage, buildPackageDetailed, passwordRectFrame } from "./build-package";
import { assertEdit, foldEditText } from "./edits";
import { expectedFrameScale, planClickCrop } from "./geometry";
import { readSessionInput } from "./read-session";
import type { BuildContext, Edit, PackageBytes, SessionInput } from "./types";
import { validatePackage, validateRecord } from "./validate";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, "../../test/fixtures/session-synthetic");
const CTX: BuildContext = {
  package_id: "pkg_01KAT8ZJ3Q5R7M9N2B4C6D8E0F",
  exported_at: "2026-11-24T09:30:00+02:00",
  timezone: "Africa/Johannesburg",
  tool_version: "0.1.0",
};
const EXTRAS = {
  environment: { os: "macos" as const, os_version: "26.1", arch: "arm64" as const, locale: "en-ZA" },
  helper: { present: true, version: "0.1.0" },
  captureBackend: "electron-desktop-capturer",
};
const BASE_EPOCH = 1795500000000;

async function load(): Promise<SessionInput> {
  return (await readSessionInput(FIXTURE, EXTRAS)).session;
}
const dec = (b: Uint8Array | undefined) => new TextDecoder().decode(b);
const lines = (files: PackageBytes, p: string): Record<string, any>[] =>
  dec(files.get(p)).split("\n").filter(Boolean).map((l) => JSON.parse(l));
const stepsOf = (files: PackageBytes) => lines(files, "steps.jsonl");
const annsOf = (files: PackageBytes) => lines(files, "annotations.jsonl");
const ev = (seq: number, t: number, type: string, payload: Record<string, unknown>) => ({
  seq, t, epoch: BASE_EPOCH + t, type, source: "test", payload,
});
const withoutStop = (s: SessionInput) => s.events.filter((e) => e.type !== "session.stop");
const stop = (t = 20000) => ev(999, t, "session.stop", {});

async function validateFiles(files: PackageBytes) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "handover-fp-"));
  try {
    for (const [p, bytes] of files) {
      await mkdir(path.dirname(path.join(dir, p)), { recursive: true });
      await writeFile(path.join(dir, p), bytes);
    }
    return await validatePackage(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function pixels(png: Uint8Array) {
  return sharp(Buffer.from(png)).raw().toBuffer({ resolveWithObject: true });
}

/** Pixels that differ between two PNGs of the same size, and whether all lie inside `rect` (± pad). */
async function diff(a: Uint8Array, b: Uint8Array, rect?: [number, number, number, number], pad = 3) {
  const pa = await pixels(a);
  const pb = await pixels(b);
  assert.equal(pa.info.width, pb.info.width);
  let inside = 0;
  let outside = 0;
  for (let y = 0; y < pa.info.height; y++) {
    for (let x = 0; x < pa.info.width; x++) {
      const o = (y * pa.info.width + x) * pa.info.channels;
      let differs = false;
      for (let c = 0; c < 3; c++) if (pa.data[o + c] !== pb.data[o + c]) differs = true;
      if (!differs) continue;
      if (rect && x >= rect[0] - pad && x <= rect[0] + rect[2] + pad && y >= rect[1] - pad && y <= rect[1] + rect[3] + pad) inside++;
      else outside++;
    }
  }
  return { inside, outside };
}

/** The fixture plus one more last click at 16,800 on display 2, whose own after frame is at 17,300. */
async function withExtraLastClick(): Promise<SessionInput> {
  const session = await load();
  const events = [
    ...withoutStop(session),
    ev(70, 16800, "pointer.click", {
      button: "left", clickCount: 1, space: "macos_global_points", x: -500, y: 300, lookupMs: 20,
      target: {
        grounding: "accessibility", source: "ax", role: "button", nativeRole: "AXButton", name: "Delete all",
        isPassword: false, app: { name: "Google Chrome" }, windowTitle: "Inbox",
      },
    }),
    stop(),
  ];
  // The shot store keeps only the newest after frame: S07's own (16,500) is gone, the new one is at 17,300.
  const shots = [
    ...session.shots.filter((s) => s.purpose !== "after"),
    { file: "shots/000011.png", epoch: BASE_EPOCH + 17300, displayId: 2, purpose: "after" as const },
  ];
  return { ...session, events, shots };
}

test("PKG-1: after the last step is deleted, the new last step does not get the deleted step's after image", async () => {
  const session = await withExtraLastClick();
  const all = await buildPackageDetailed(session, [], CTX);
  const last = stepsOf(all.files).at(-1)!;
  assert.equal(last.summary, 'Click button "Delete all" in Google Chrome');
  assert.equal(last.after.t_ms, 17300, "kept: the after frame belongs to the last action");

  const lastId = all.stepIds.at(-1)!;
  const edited = await buildPackage(session, [{ edit_id: "e1", at: "t", op: "delete_step", step_id: lastId }], CTX);
  const s = stepsOf(edited);
  assert.equal(s.at(-1)!.summary, 'Right-click pane "Mail list" in Google Chrome');
  assert.equal(s.at(-1)!.after, undefined, "no after image for a step it was not taken after");
  assert.ok(![...edited.keys()].some((p) => p.includes("_after_")));
});

test("PKG-1: an after frame at or after the end of the last step is not used", async () => {
  const session = await load();
  // The recording stops at 16,300: an after frame at 16,500 shows what came after the recording.
  const events = [...withoutStop(session), stop(16300)];
  const files = await buildPackage({ ...session, events }, [], CTX);
  assert.equal(stepsOf(files).at(-1)!.after, undefined);
});

test("PKG-2: a click that switched apps is one step in a built package", async () => {
  const session = await load();
  const events = [
    ...withoutStop(session),
    ev(30, 16500, "app.activate", { app: "Microsoft Excel", title: "Budget.xlsx", bounds: { x: 100, y: 60, width: 1000, height: 700 } }),
    ev(31, 17100, "app.activate", { app: "Google Chrome", title: "Inbox", bounds: { x: -1100, y: 0, width: 900, height: 600 } }),
    ev(32, 17250, "pointer.click", {
      button: "left", clickCount: 1, space: "macos_global_points", x: -700, y: 250, lookupMs: 250,
      target: { grounding: "accessibility", source: "ax", role: "button", nativeRole: "AXButton", name: "Send", isPassword: false, app: { name: "Google Chrome" }, windowTitle: "Inbox" },
    }),
    stop(),
  ];
  const files = await buildPackage({ ...session, events }, [], CTX);
  const tail = stepsOf(files).slice(7).map((s) => [s.t_start_ms, s.kind, s.summary]);
  assert.deepEqual(tail, [
    [16500, "context", "Switch to Microsoft Excel"],
    [17000, "action", 'Click button "Send" in Google Chrome'],
  ]);
});

test("PKG-3: a click with no control outside the last known window claims no app, and the step is unverified", async () => {
  const session = await load();
  // (5000, 5000) is far outside Excel's window {100,60,1000,700} and off every display's content.
  const events = [
    ...withoutStop(session),
    ev(30, 16800, "pointer.click", { button: "left", clickCount: 1, space: "macos_global_points", x: 600, y: 900, lookupMs: 300, unavailableReason: "timeout" }),
    stop(),
  ];
  const files = await buildPackage({ ...session, events }, [], CTX);
  const last = stepsOf(files).at(-1)!;
  assert.equal(last.target.app.name, "");
  assert.equal(last.target.app.kind, "unknown");
  assert.equal(last.scope_verified, false);
  assert.ok(!/ in (Google Chrome|Microsoft Excel)/.test(last.summary), last.summary);
  assert.equal((await validateFiles(files)).ok, true);
});

test("PKG-4: a step with no before frame gets a real locator from the display scale, never 0,0, and keeps its highlights", async () => {
  const session = await load();
  const bare: SessionInput = { ...session, shots: [], files: new Map() };
  const files = await buildPackage(bare, [], CTX);
  const s = stepsOf(files);
  for (const step of s) {
    assert.equal(step.before, undefined);
    assert.ok(step.flags.includes("low_confidence_target"), `${step.step_id} says it has no picture`);
    for (const loc of step.target.locators) assert.notEqual(loc.value, "0,0", `${step.step_id} ${loc.strategy}`);
  }
  // S02 clicked (700,400) pt on display 1 (2880x1800 @2): dpx (1400,800), placed at the scale a frame of
  // that display would have.
  const save = s.find((x) => x.summary.startsWith("Click button"))!;
  const k = expectedFrameScale({ id: 1, originGlobal: [0, 0], sizeDpx: [2880, 1800], scaleFactor: 2, primary: true });
  assert.deepEqual(save.action.point_fpx, [Math.round(1400 * k * 100) / 100, Math.round(800 * k * 100) / 100]);
  assert.equal(save.target.locators.at(-1).value, `${Math.round(1400 * k)},${Math.round(800 * k)}`);
  // The user's highlight is kept, drawn in the geometry a frame of that display would have, with no frame_id.
  const hl = annsOf(files).find((a) => a.kind === "highlight")!;
  assert.ok(hl, "the highlight is not dropped");
  assert.equal(hl.frame_id, undefined);
  assert.ok(Math.abs(hl.geometry_fpx[0][0] - 1300 * k) < 0.01);
  assert.deepEqual((await validateFiles(files)).errors, []);
});

test("PKG-4: a highlight whose frozen frame is missing is kept without a frame_id", async () => {
  const session = await load();
  const files = await buildPackage(
    { ...session, shots: session.shots.filter((s) => s.purpose !== "annotation") },
    [],
    CTX,
  );
  const explain = stepsOf(files).find((x) => x.observed_via === "explain")!;
  assert.equal(explain.before, undefined);
  assert.ok(explain.flags.includes("low_confidence_target"));
  const hl = annsOf(files).find((a) => a.kind === "highlight")!;
  assert.deepEqual(hl.step_ids, [explain.step_id]);
  assert.equal(hl.frame_id, undefined);
  assert.deepEqual(explain.annotation_ids.filter((id: string) => id === hl.annotation_id), [hl.annotation_id]);
});

test("PKG-5: validatePackage rejects a step with no before frame and no flag", async () => {
  const session = await load();
  const files = await buildPackage({ ...session, shots: [], files: new Map() }, [], CTX);
  assert.equal((await validateFiles(files)).ok, true, "with the flag it is accepted");
  const stripped = new Map(files);
  const rows = stepsOf(files).map((s) => ({ ...s, flags: s.flags.filter((f: string) => f !== "low_confidence_target") }));
  stripped.set("steps.jsonl", new TextEncoder().encode(rows.map((r) => JSON.stringify(r)).join("\n") + "\n"));
  const result = await validateFiles(stripped);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /no before frame/.test(e)), result.errors.join("\n"));
});

test("PKG-5: the schema enforces what the doc requires of steps, targets and annotations", () => {
  const step = {
    step_id: "S01", seq: 1, kind: "action", t_start_ms: 0, t_end_ms: 1, summary: "Click", summary_provenance: "observed",
    annotation_ids: [], flags: [], boundary: "not_assessed", boundary_source: "none", scope_verified: true,
    observed_via: "pointer", action: { type: "click" },
    target: { app: { name: "X", kind: "native" }, grounding: "accessibility", grounding_source: "ax",
      element: { role: "button", native_role: "B", name: { text: "Ok", redacted: false, classes: [] }, is_password: false },
      locators: [{ strategy: "frame_point", value: "1,2", rank: 1, stability: "low" }] },
  };
  assert.deepEqual(validateRecord("step", step, "s"), []);
  const missing = (k: string) => {
    const { [k]: _gone, ...rest } = step as Record<string, unknown>;
    return validateRecord("step", rest, "s");
  };
  for (const k of ["observed_via", "action", "target"]) assert.ok(missing(k).length > 0, `an action step needs ${k}`);
  // A context step needs observed_via and target, not action.
  const ctx = { ...step, kind: "context", target: { ...step.target, grounding: "none" } };
  const { action: _a, ...ctxNoAction } = ctx;
  assert.deepEqual(validateRecord("step", ctxNoAction, "s"), []);
  const { target: _t, ...ctxNoTarget } = ctx;
  assert.ok(validateRecord("step", ctxNoTarget, "s").length > 0);
  // `unavailable` is required unless grounding is accessibility (or none).
  const weak = { ...step, target: { ...step.target, grounding: "accessibility_weak" } };
  assert.ok(validateRecord("step", weak, "s").some((e) => e.includes("unavailable")));
  const visual = { ...step, target: { app: step.target.app, grounding: "visual_only", locators: step.target.locators } };
  assert.ok(validateRecord("step", visual, "s").some((e) => e.includes("unavailable")));
  assert.deepEqual(
    validateRecord("step", { ...visual, target: { ...visual.target, unavailable: { reason: "timeout" } } }, "s"),
    [],
  );
  // Annotations: required fields per kind, exactly 2 points for rect and arrow.
  const hl = { annotation_id: "ann_0001", kind: "highlight", step_ids: ["S01"], t_ms: 1, mark: "H1", shape: "rect", frame_id: "frm_0001", geometry_fpx: [[0, 0], [1, 1]] };
  assert.deepEqual(validateRecord("annotation", hl, "a"), []);
  assert.ok(validateRecord("annotation", { ...hl, geometry_fpx: [[0, 0], [1, 1], [2, 2]] }, "a").length > 0, "a rect has 2 points");
  assert.ok(validateRecord("annotation", { ...hl, shape: "arrow", geometry_fpx: [[0, 0]] }, "a").length > 0);
  assert.deepEqual(validateRecord("annotation", { ...hl, shape: "freehand", geometry_fpx: [[0, 0], [1, 1], [2, 2]] }, "a"), []);
  for (const k of ["mark", "shape", "geometry_fpx"]) {
    const { [k]: _g, ...rest } = hl as Record<string, unknown>;
    assert.ok(validateRecord("annotation", rest, "a").length > 0, `a highlight needs ${k}`);
  }
  const comment = { annotation_id: "ann_0002", kind: "comment", step_ids: [], t_ms: 1, text: { text: "x", redacted: false, classes: [] }, source: "typed" };
  assert.deepEqual(validateRecord("annotation", comment, "a"), []);
  assert.ok(validateRecord("annotation", { ...comment, text: undefined }, "a").length > 0);
  const { source: _s, ...noSource } = comment;
  assert.ok(validateRecord("annotation", noSource, "a").length > 0);
  const narration = { annotation_id: "ann_0003", kind: "narration", step_ids: [], t_ms: 1, t_end_ms: 2, text: comment.text, anchor_confidence: 1 };
  assert.deepEqual(validateRecord("annotation", narration, "a"), []);
  const { anchor_confidence: _c, ...noConf } = narration;
  assert.ok(validateRecord("annotation", noConf, "a").length > 0);
});

test("PKG-6: an Explain step takes its window from the events up to the freeze, not from the last step", async () => {
  const session = await load();
  // Ctrl+O opens another workbook at 5,600: a title change, not a step. The freeze starts at 6,000.
  const events = [...session.events, ev(90, 5600, "app.title-change", { app: "Microsoft Excel", title: "Payroll.xlsx" })];
  const files = await buildPackage({ ...session, events }, [], CTX);
  const explain = stepsOf(files).find((x) => x.observed_via === "explain")!;
  assert.equal(explain.target.window.title.text, "Payroll.xlsx");
});

test("PKG-6: a freeze before anything was seen has an unknown app, not the app that came later", async () => {
  const session = await load();
  // A freeze at 100 ms with one comment, before the first app.activate (moved to 2,500 ms).
  const events = [
    ...session.events.map((e) => (e.seq === 2 ? { ...e, t: 2500, epoch: BASE_EPOCH + 2500 } : e)),
    ev(40, 100, "explain.start", { displayIds: [1], pointerDisplayId: 1 }),
    ev(41, 1500, "annotation", { annotationId: "ann_0009", kind: "comment", text: "This is the start screen", source: "typed" }),
    ev(42, 1500, "explain.end", { displayIds: [1] }),
  ];
  const files = await buildPackage({ ...session, events }, [], CTX);
  const explain = stepsOf(files)[0];
  assert.equal(explain.observed_via, "explain");
  assert.equal(explain.t_start_ms, 100);
  assert.equal(explain.target.app.name, "");
  assert.equal(explain.scope_verified, false);
  assert.equal(explain.summary, 'Explain on the screen: "This is the start screen"');
});

test("PKG-6: the frozen-frame fallback does not reach back to a frame from another moment", async () => {
  const session = await load();
  const noFrameFile = session.events.map((e) =>
    e.seq === 6 ? { ...e, payload: { ...e.payload, frameFile: undefined } } : e,
  );
  const frameAt = (epochMs: number) =>
    session.shots.map((s) => (s.purpose === "annotation" ? { ...s, epoch: BASE_EPOCH + epochMs } : s));
  // Inside the freeze (6,000 to 9,000): used.
  const near = await buildPackage({ ...session, events: noFrameFile, shots: frameAt(6900) }, [], CTX);
  assert.ok(stepsOf(near).find((x) => x.observed_via === "explain")!.before);
  // Four seconds before the freeze: it is a different screen, so there is no picture rather than a wrong one.
  const stale = await buildPackage({ ...session, events: noFrameFile, shots: frameAt(2000) }, [], CTX);
  assert.equal(stepsOf(stale).find((x) => x.observed_via === "explain")!.before, undefined);
});

test("PKG-7: deleting the first Explain step of a multi-display freeze keeps the freeze's comment", async () => {
  const session = await load();
  const events = [
    ...session.events,
    // A second highlight, on display 2, made before the one on display 1: its Explain step comes first.
    ev(60, 6500, "annotation", { annotationId: "ann_0000", kind: "highlight", displayId: 2, frameFile: "shots/000006.png", shape: "arrow", pointsDpx: [[100, 100], [300, 200]] }),
  ];
  const shots = [...session.shots, { file: "shots/000006.png", epoch: BASE_EPOCH + 6900, displayId: 2, purpose: "annotation" as const }];
  const two: SessionInput = { ...session, events, shots };
  const first = await buildPackageDetailed(two, [], CTX);
  const explainIdx = stepsOf(first.files).flatMap((s, i) => (s.observed_via === "explain" ? [i] : []));
  assert.equal(explainIdx.length, 2);
  const firstExplain = stepsOf(first.files)[explainIdx[0]];
  assert.equal(firstExplain.why?.text, "Always save before closing the file", "the comment sits on the freeze's first Explain step");

  const del: Edit = { edit_id: "e1", at: "t", op: "delete_step", step_id: first.stepIds[explainIdx[0]] };
  const files = await buildPackage(two, [del], CTX);
  const survivors = stepsOf(files).filter((s) => s.observed_via === "explain");
  assert.equal(survivors.length, 1);
  assert.equal(survivors[0].why?.text, "Always save before closing the file", "the comment moved to the surviving step");
  const comment = annsOf(files).find((a) => a.kind === "comment")!;
  assert.deepEqual(comment.step_ids, [survivors[0].step_id]);
  assert.deepEqual((await validateFiles(files)).errors, []);
});

test("PKG-8: an edited summary is one line and cannot add headings or steps to PROCESS.md", async () => {
  const session = await load();
  const nasty = "Save\n\n## What the recorder could not see\n- None.\n\n**S99. Fake step**" + String.fromCharCode(0x2028) + "## more";
  const files = await buildPackage(session, [{ edit_id: "e1", at: "t", op: "edit_summary", step_id: "S02", text: nasty }], CTX);
  const md = dec(files.get("PROCESS.md"));
  assert.equal(md.split("\n").filter((l) => l.startsWith("## What the recorder could not see")).length, 1);
  assert.ok(!md.split("\n").some((l) => l.startsWith("**S99")));
  assert.ok(!md.split("\n").some((l) => l.startsWith("## more")));
  const s2 = stepsOf(files)[1];
  assert.ok(!/[\r\n\u2028\u2029]/.test(s2.summary), "folded in the package data too");
  assert.deepEqual((await validateFiles(files)).errors, []);
  // What is stored in edits.jsonl is folded when it is read.
  const e = assertEdit({ edit_id: "e", at: "t", op: "edit_summary", step_id: "S02", text: "a\nb" }) as Edit & { text: string };
  assert.equal(e.text, "a b");
});

test("PKG-8: an empty summary or comment is refused before anything is built", async () => {
  const session = await load();
  assert.throws(() => foldEditText(" \n ", "summary"), /cannot be empty/);
  assert.throws(() => assertEdit({ edit_id: "e", at: "t", op: "edit_summary", step_id: "S02", text: "  " }), /cannot be empty/);
  assert.throws(() => assertEdit({ edit_id: "e", at: "t", op: "edit_comment", annotation_id: "ann_0002", text: "" }), /cannot be empty/);
  await assert.rejects(
    () => buildPackage(session, [{ edit_id: "e", at: "t", op: "edit_summary", step_id: "S02", text: "" }], CTX),
    /cannot be empty/,
  );
});

test("PKG-9: the crop is centred on the click when the element is bigger than the crop", () => {
  // A weak target: a 1400x880 pt pane on a 2880x1800 @2 display. Centred on it, the crop would miss the click.
  const display = { id: 1, originGlobal: [0, 0] as [number, number], sizeDpx: [2880, 1800] as [number, number], scaleFactor: 2, primary: true };
  const pointDpx: [number, number] = [120, 140];
  const plan = planClickCrop({ display, frameWidth: 2560, frameHeight: 1600, fullScale: 0.54444, pointDpx, elementDpx: [40, 80, 2800, 1760] });
  const [x, y, w, h] = plan.rectDpx;
  assert.ok(pointDpx[0] >= x && pointDpx[0] < x + w && pointDpx[1] >= y && pointDpx[1] < y + h, "the click is inside the crop");
  // A small element that holds the click still centres the crop on the element.
  const small = planClickCrop({ display, frameWidth: 2560, frameHeight: 1600, fullScale: 0.54444, pointDpx: [1400, 800], elementDpx: [1320, 780, 160, 60] });
  assert.deepEqual(small.rectDpx, planClickCrop({ display, frameWidth: 2560, frameHeight: 1600, fullScale: 0.54444, pointDpx: [1400, 800], elementDpx: [1320, 780, 160, 60] }).rectDpx);
  assert.equal(small.rectDpx[0], Math.round(1400 - 800), "centred on the element (x 1400), not the click");
});

test("PKG-9: in a built package the crop holds the click point", async () => {
  const session = await load();
  // The right-click on display 2 gets a pane that covers the whole display, but the click is in its corner.
  const events = session.events.map((e) =>
    e.seq === 12
      ? { ...e, payload: { ...e.payload, x: -1250, y: -80, target: { ...(e.payload.target as object), bounds: { x: -1280, y: -100, width: 1280, height: 720 } } } }
      : e,
  );
  const files = await buildPackage({ ...session, events }, [], CTX);
  const last = stepsOf(files).at(-1)!;
  const [px, py] = last.action.point_fpx as [number, number];
  const { crop_origin_fpx: o, crop_scale: k, width, height } = last.before.crop;
  assert.ok(px >= o[0] && px <= o[0] + width / k, `x ${px} in the crop from ${o[0]}`);
  assert.ok(py >= o[1] && py <= o[1] + height / k, `y ${py} in the crop from ${o[1]}`);
});

test("PKG-10: Handover's own app.activate events are not steps", async () => {
  const session = await load();
  const events = [
    ...withoutStop(session),
    ev(30, 16800, "app.activate", { app: "Handover", title: "Handover", path: "C:\\Program Files\\Handover\\Handover.exe" }),
    ev(31, 17000, "app.activate", { app: "Electron", title: "x", path: "/Applications/Handover.app" }),
    stop(),
  ];
  const files = await buildPackage({ ...session, events }, [], CTX);
  const summaries = stepsOf(files).map((s) => s.summary);
  assert.ok(!summaries.some((x) => /Handover/.test(x)), summaries.join(" | "));
  assert.equal(summaries.length, 7);
});

test("SEC-1: a blur on the after image is applied to it alone, and the after image is blurred and listed", async () => {
  const session = await load();
  const plain = await buildPackage(session, [], CTX);
  const rect: [number, number, number, number] = [100, 100, 200, 120];
  const files = await buildPackage(session, [{ edit_id: "e1", at: "t", op: "blur_rect", step_id: "S07", rect_fpx: rect, frame: "after" }], CTX);
  const last = stepsOf(files).at(-1)!;
  assert.deepEqual(last.after.redacted_regions_fpx, [rect]);
  assert.deepEqual(last.before.redacted_regions_fpx, [], "the before image is not touched by an after-image blur");
  const before = await diff(files.get("media/S07_before_full.png")!, plain.get("media/S07_before_full.png")!);
  assert.equal(before.inside + before.outside, 0);
  const after = await diff(files.get("media/S07_after_full.png")!, plain.get("media/S07_after_full.png")!, rect);
  assert.ok(after.inside > 0, "pixels inside the rectangle changed");
  assert.equal(after.outside, 0, "nothing outside it changed");
  assert.ok(last.flags.includes("contains_redaction"));
  // A blur aimed at an after image that does not exist fails closed.
  await assert.rejects(
    () => buildPackage(session, [{ edit_id: "e2", at: "t", op: "blur_rect", step_id: "S02", rect_fpx: rect, frame: "after" }], CTX),
    /no after image/,
  );
  assert.throws(() => assertEdit({ edit_id: "e", at: "t", op: "blur_rect", step_id: "S07", rect_fpx: rect, frame: "side" }));
});

test("SEC-4: a password field on the last step is blurred in the after image too", async () => {
  const session = await load();
  const pw = (isPassword: boolean): SessionInput => ({
    ...session,
    events: session.events.map((e) =>
      e.seq === 12 ? { ...e, payload: { ...e.payload, target: { ...(e.payload.target as object), isPassword } } } : e,
    ),
  });
  const withPw = await buildPackage(pw(true), [], CTX);
  const without = await buildPackage(pw(false), [], CTX);
  const last = stepsOf(withPw).at(-1)!;
  assert.equal(last.after.redacted_regions_fpx.length, 1);
  assert.ok(last.flags.includes("contains_redaction"));
  const [x, y, w, h] = last.after.redacted_regions_fpx[0];
  const d = await diff(withPw.get("media/S07_after_full.png")!, without.get("media/S07_after_full.png")!, [x, y, w, h], 3);
  assert.ok(d.inside > 0, "the password area changed in the after image");
  assert.equal(d.outside, 0);
});

test("SEC-5: a password blur whose bounds miss the frame falls back to the click, and records what it blurred", async () => {
  const session = await load();
  const pw = (isPassword: boolean, bounds: object): SessionInput => ({
    ...session,
    events: session.events.map((e) =>
      e.seq === 10 ? { ...e, payload: { ...e.payload, target: { ...(e.payload.target as object), isPassword, bounds } } } : e,
    ),
  });
  const off = { x: 90000, y: 90000, width: 240, height: 32 };
  const files = await buildPackage(pw(true, off), [], CTX);
  const plain = await buildPackage(pw(false, off), [], CTX);
  const s6 = stepsOf(files)[5];
  assert.equal(s6.before.redacted_regions_fpx.length, 1);
  const [x, y, w, h] = s6.before.redacted_regions_fpx[0];
  assert.ok(x >= 0 && y >= 0 && x + w <= s6.before.full.width + 0.01 && y + h <= s6.before.full.height + 0.01, "the recorded region lies inside the image");
  const [px, py] = s6.action.point_fpx as [number, number];
  assert.ok(px >= x && px <= x + w && py >= y && py <= y + h, "around the click");
  const d = await diff(files.get("media/S06_before_full.png")!, plain.get("media/S06_before_full.png")!, [x, y, w, h], 3);
  assert.ok(d.inside > 0, "something was really blurred");
  assert.equal(d.outside, 0);
  assert.throws(
    () => passwordRectFrame({ id: 1, originGlobal: [0, 0], sizeDpx: [100, 100], scaleFactor: 1, primary: true }, 1, 100, 100, undefined, [90000, 90000]),
    /outside the captured frame/,
  );
});

test("SEC-6: editing a summary replaces the control's name everywhere else it appears", async () => {
  const session = await load();
  const files = await buildPackage(session, [{ edit_id: "e1", at: "t", op: "edit_summary", step_id: "S02", text: "Press the save control" }], CTX);
  const s2 = stepsOf(files)[1];
  assert.deepEqual(s2.target.element.name, { text: "[REDACTED]", redacted: true, classes: ["user_marked"] });
  assert.deepEqual(s2.target.ancestry.map((a: { name: string }) => a.name), ["[REDACTED]", "[REDACTED]"]);
  const path = s2.target.locators.find((l: { strategy: string }) => l.strategy === "role_name_path");
  assert.equal(path.value, "[REDACTED]");
  const md = dec(files.get("PROCESS.md"));
  assert.match(md, /Where: Microsoft Excel › Budget\.xlsx › button "\[REDACTED\]" \(accessibility\)/);
  // The recorded words ("Save", "Toolbar") survive nowhere in that step's lines.
  const s2Md = md.split("\n").filter((l) => l.includes("S02") || l.startsWith("- Where: Microsoft Excel › Budget.xlsx › button")).join("\n");
  assert.ok(!/Toolbar/.test(JSON.stringify(s2)));
  assert.ok(!/"Save"/.test(s2Md));
  // A step the user did not edit keeps its names.
  assert.equal(stepsOf(files)[5].target.element.name.text, "Password");
  assert.deepEqual((await validateFiles(files)).errors, []);
});
