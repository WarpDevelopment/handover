// L4: annotated images, the blur_rect edit, pre-edit numbering, and freeze handling in the builder.

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import sharp from "sharp";

import { annotationSvg, renderAnnotated, RED, YELLOW } from "./annotation-render";
import { buildPackage, buildPackageDetailed, explainIntervals, withoutFrozenCollectorEvents } from "./build-package";
import { UnsupportedEditError } from "./edits";
import { readSessionInput } from "./read-session";
import type { BuildContext, Edit, PackageBytes, SessionInput } from "./types";
import { validatePackage } from "./validate";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";

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

async function load(): Promise<SessionInput> {
  return (await readSessionInput(FIXTURE, EXTRAS)).session;
}

function steps(files: PackageBytes): Record<string, any>[] {
  const b = files.get("steps.jsonl");
  assert.ok(b);
  return new TextDecoder().decode(b).split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function annotations(files: PackageBytes): Record<string, any>[] {
  const b = files.get("annotations.jsonl");
  assert.ok(b);
  return new TextDecoder().decode(b).split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

async function raw(png: Uint8Array): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(Buffer.from(png)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function pixel(img: { data: Buffer; width: number }, x: number, y: number): [number, number, number] {
  const o = (Math.round(y) * img.width + Math.round(x)) * 3;
  return [img.data[o], img.data[o + 1], img.data[o + 2]];
}

/** Count the pixels that differ, split into inside and outside `rect`. */
function diff(
  a: { data: Buffer; width: number; height: number },
  b: { data: Buffer; width: number; height: number },
  rect: [number, number, number, number],
): { inside: number; outside: number } {
  assert.equal(a.width, b.width);
  assert.equal(a.height, b.height);
  let inside = 0;
  let outside = 0;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const o = (y * a.width + x) * 3;
      if (a.data[o] === b.data[o] && a.data[o + 1] === b.data[o + 1] && a.data[o + 2] === b.data[o + 2]) continue;
      const within = x >= rect[0] && x < rect[0] + rect[2] && y >= rect[1] && y < rect[1] + rect[3];
      if (within) inside++;
      else outside++;
    }
  }
  return { inside, outside };
}

test("the annotated image is deterministic and uses the fixed colours and widths", async () => {
  const base = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#ffffff" } }).png().toBuffer();
  const marks = [
    { mark: "H1", shape: "rect" as const, geometry_fpx: [[100, 100], [250, 200]] as [number, number][] },
    { mark: "H2", shape: "highlighter" as const, geometry_fpx: [[20, 250], [200, 250]] as [number, number][] },
    { mark: "H3", shape: "arrow" as const, geometry_fpx: [[300, 280], [380, 200]] as [number, number][] },
  ];
  const a = await renderAnnotated(base, marks);
  const b = await renderAnnotated(base, marks);
  assert.deepEqual(Buffer.from(a), Buffer.from(b), "same annotations, same bytes");

  const img = await raw(a);
  // Rect: 3 px #E5484D stroke centred on the edge (x=100), so x=100 is solid red.
  assert.deepEqual(pixel(img, 100, 150), [0xe5, 0x48, 0x4d]);
  assert.deepEqual(pixel(img, 175, 100), [0xe5, 0x48, 0x4d]);
  assert.deepEqual(pixel(img, 175, 150), [255, 255, 255], "the inside of a rect is not filled");
  // Highlighter: 14 px #FFD60A at 40% over white.
  const [r, g, bl] = pixel(img, 100, 250);
  assert.ok(Math.abs(r - Math.round(255 * 0.6 + 0xff * 0.4)) <= 3, `r=${r}`);
  assert.ok(Math.abs(g - Math.round(255 * 0.6 + 0xd6 * 0.4)) <= 3, `g=${g}`);
  assert.ok(Math.abs(bl - Math.round(255 * 0.6 + 0x0a * 0.4)) <= 3, `b=${bl}`);
  assert.deepEqual(pixel(img, 100, 244), [r, g, bl], "the highlighter is 14 px wide (+-7)");
  assert.deepEqual(pixel(img, 100, 240), [255, 255, 255]);
  // H-mark label: a red box 20 px high, above the rect's top-left corner, white mark inside.
  assert.deepEqual(pixel(img, 101, 81), [0xe5, 0x48, 0x4d], "label box background");
  assert.deepEqual(pixel(img, 101, 78), [255, 255, 255], "outside the 20 px box");
  assert.deepEqual(pixel(img, 100, 101), [0xe5, 0x48, 0x4d], "the rect's own stroke starts below the label");
  // Arrow head is filled red at the tip.
  assert.deepEqual(pixel(img, 378, 202), [0xe5, 0x48, 0x4d]);

  const svg = annotationSvg(400, 300, marks);
  assert.ok(svg.includes(RED) && svg.includes(YELLOW));
  assert.ok(svg.includes('stroke-width="3"') && svg.includes('stroke-width="14"'));
  assert.ok(svg.includes('stroke-opacity="0.4"'));
});

test("the package draws each step's highlights into its annotated image", async () => {
  const files = await buildPackage(await load(), [], CTX);
  const s = steps(files);
  const annotated = s[3].before.full_annotated; // S04 is the Explain step
  assert.equal(annotated.path, "media/S04_before_full_annotated.png");
  assert.equal(annotated.width, s[3].before.full.width);
  assert.equal(s[1].before.full_annotated, undefined, "a step with no highlight has no annotated image");
  const plain = await raw(files.get("media/S04_before_full.png")!);
  const marked = await raw(files.get("media/S04_before_full_annotated.png")!);
  const h = annotations(files).find((a) => a.kind === "highlight")!;
  const [[x0, y0], [, y1]] = h.geometry_fpx as [number, number][];
  assert.deepEqual(pixel(marked, x0, (y0 + y1) / 2), [0xe5, 0x48, 0x4d]);
  assert.notDeepEqual(pixel(plain, x0, (y0 + y1) / 2), [0xe5, 0x48, 0x4d]);
  // Highlights are drawn only into the annotated image; the plain image has none.
  const d = diff(plain, marked, [0, 0, plain.width, plain.height]);
  assert.ok(d.inside > 100);
  // Deterministic end to end.
  const again = await buildPackage(await load(), [], CTX);
  assert.deepEqual(Buffer.from(again.get("media/S04_before_full_annotated.png")!), Buffer.from(files.get("media/S04_before_full_annotated.png")!));
  // The whole package still validates (the annotated image is listed in the manifest with its hash).
  const dir = await mkdtemp(path.join(os.tmpdir(), "handover-annotated-"));
  try {
    for (const [p, bytes] of files) {
      await mkdir(path.dirname(path.join(dir, p)), { recursive: true });
      await writeFile(path.join(dir, p), bytes);
    }
    assert.deepEqual((await validatePackage(dir)).errors, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const blurEdit = (step: string, rect: [number, number, number, number], id = "e1"): Edit => ({
  edit_id: id,
  at: "2026-11-24T09:00:00+02:00",
  op: "blur_rect",
  step_id: step,
  rect_fpx: rect,
});

test("blur_rect changes pixels only inside the rectangle, in full, crop and annotated images", async () => {
  const session = await load();
  const plain = await buildPackage(session, [], CTX);
  const rect: [number, number, number, number] = [600, 350, 120, 60];
  const blurred = await buildPackage(session, [blurEdit("S02", rect)], CTX);

  // Full image: exact. Every pixel outside the rectangle is the unedited pixel; inside it changed.
  const a = await raw(plain.get("media/S02_before_full.png")!);
  const b = await raw(blurred.get("media/S02_before_full.png")!);
  const d = diff(a, b, rect);
  assert.equal(d.outside, 0, "no pixel outside the rectangle changed");
  assert.ok(d.inside > 1000, `pixels inside changed (${d.inside})`);

  // Crop: the rectangle is mapped into the crop, so only a patch changes there.
  const s = steps(blurred)[1];
  const ca = await raw(plain.get("media/S02_before_crop.png")!);
  const cb = await raw(blurred.get("media/S02_before_crop.png")!);
  const [ox, oy] = s.before.crop.crop_origin_fpx as [number, number];
  const k = s.before.crop.crop_scale as number;
  const cropRect: [number, number, number, number] = [
    Math.floor((rect[0] - ox) * k),
    Math.floor((rect[1] - oy) * k),
    Math.ceil((rect[0] + rect[2] - ox) * k) - Math.floor((rect[0] - ox) * k),
    Math.ceil((rect[1] + rect[3] - oy) * k) - Math.floor((rect[1] - oy) * k),
  ];
  const cd = diff(ca, cb, cropRect);
  assert.equal(cd.outside, 0, "no crop pixel outside the mapped rectangle changed");
  assert.ok(cd.inside > 500, `crop pixels inside changed (${cd.inside})`);

  // The step records the region and carries the flag; the other steps are untouched.
  assert.deepEqual(s.before.redacted_regions_fpx, [rect]);
  assert.ok(s.flags.includes("contains_redaction"));
  const all = steps(blurred);
  assert.deepEqual(all[0].before.redacted_regions_fpx, []);
  assert.deepEqual(Buffer.from(blurred.get("media/S01_before_full.png")!), Buffer.from(plain.get("media/S01_before_full.png")!));
});

test("blur_rect reaches the annotated image, and highlights are drawn on top of the blur", async () => {
  const session = await load();
  const plainAnn = await buildPackage(session, [], CTX);
  // Blur a patch of the Explain step S04's frozen frame that the highlight does not touch:
  // edits work on Explain steps like on any other step.
  const rect: [number, number, number, number] = [900, 600, 160, 80];
  const files = await buildPackage(session, [blurEdit("S04", rect)], CTX);
  const a = await raw(plainAnn.get("media/S04_before_full_annotated.png")!);
  const b = await raw(files.get("media/S04_before_full_annotated.png")!);
  const d = diff(a, b, rect);
  assert.equal(d.outside, 0);
  assert.ok(d.inside > 1000);
  assert.deepEqual(steps(files)[3].before.redacted_regions_fpx, [rect]);
  assert.ok(steps(files)[3].flags.includes("contains_redaction"));
});

test("the last step's after frame is blurred with the same rectangle", async () => {
  const session = await load();
  const rect: [number, number, number, number] = [800, 450, 140, 70];
  const plain = await buildPackage(session, [], CTX);
  const files = await buildPackage(session, [blurEdit("S07", rect)], CTX);
  const a = await raw(plain.get("media/S07_after_full.png")!);
  const b = await raw(files.get("media/S07_after_full.png")!);
  const d = diff(a, b, rect);
  assert.equal(d.outside, 0);
  assert.ok(d.inside > 1000);
  assert.deepEqual(steps(files)[6].after.redacted_regions_fpx, [rect]);
});

test("edits use the pre-edit numbering: deleting S02 and blurring S04 (the Explain step) blurs the step that becomes S03", async () => {
  const session = await load();
  const rect: [number, number, number, number] = [100, 100, 200, 100];
  const del: Edit = { edit_id: "e0", at: "t", op: "delete_step", step_id: "S02" };
  const built = await buildPackageDetailed(session, [del, blurEdit("S04", rect, "e1")], CTX);
  assert.deepEqual(built.stepIds, ["S01", "S03", "S04", "S05", "S06", "S07"]);
  const s = steps(built.files);
  assert.equal(s.length, 6);
  assert.deepEqual(s.map((x) => x.step_id), ["S01", "S02", "S03", "S04", "S05", "S06"], "ids are renumbered");
  assert.equal(s[2].observed_via, "explain");
  assert.deepEqual(s[2].before.redacted_regions_fpx, [rect], "the old S04 is the new S03");
  assert.ok(s[2].flags.includes("contains_redaction"));
  assert.deepEqual(s[0].before.redacted_regions_fpx, []);
  // The comment and highlight moved with their Explain step and its image names follow the new id.
  assert.ok(built.files.has("media/S03_before_full_annotated.png"));
  assert.ok(!built.files.has("media/S07_before_full.png"));
  for (const a of annotations(built.files)) assert.ok(a.step_ids.every((id: string) => /^S0[1-6]$/.test(id)));
});

test("a deleted Explain step is absent, its annotations go with it", async () => {
  const session = await load();
  const files = await buildPackage(session, [{ edit_id: "e0", at: "t", op: "delete_step", step_id: "S04" }], CTX);
  const s = steps(files);
  assert.ok(!s.some((x) => x.summary.startsWith("Explain on")));
  assert.equal(s.length, 6);
  assert.ok(!annotations(files).some((a) => a.kind === "highlight" || a.kind === "comment"));
  assert.ok(![...files.keys()].some((p) => p.includes("annotated")));
});

test("blur_rect fails closed: unknown step, a rectangle outside the image, an unknown operation", async () => {
  const session = await load();
  await assert.rejects(() => buildPackage(session, [blurEdit("S99", [0, 0, 10, 10])], CTX), /unknown step S99/);
  await assert.rejects(() => buildPackage(session, [blurEdit("S02", [5000, 5000, 10, 10])], CTX), /outside its image/);
  const unknown = { edit_id: "e2", at: "t", op: "crop_everything" } as unknown as Edit;
  await assert.rejects(() => buildPackage(session, [blurEdit("S02", [0, 0, 10, 10]), unknown], CTX), UnsupportedEditError);
});

// --- Freeze handling ---

function withEvents(session: SessionInput, extra: { t: number; type: string; payload: Record<string, unknown> }[]): SessionInput {
  const base = session.events.at(-1)!.seq;
  const added = extra.map((e, i) => ({
    seq: base + 1 + i,
    t: e.t,
    epoch: 1795500000000 + e.t,
    type: e.type,
    source: "test",
    payload: e.payload,
  }));
  return { ...session, events: [...session.events, ...added] };
}

test("pointer.click and app.activate between explain.start and explain.end are not steps", async () => {
  const session = await load();
  const base = await buildPackage(session, [], CTX);
  // The fixture freezes from 6,000 to 9,000. Clicks on the overlay and the overlay taking focus
  // land inside that window.
  const noisy = withEvents(session, [
    { t: 6500, type: "pointer.click", payload: { button: "left", clickCount: 1, space: "macos_global_points", x: 500, y: 500, target: { grounding: "accessibility", source: "ax", role: "button", nativeRole: "AXButton", name: "Done", isPassword: false, app: { name: "Handover" } } } },
    { t: 7200, type: "app.activate", payload: { app: "Handover", title: "Explain" } },
    { t: 8800, type: "pointer.click", payload: { button: "left", clickCount: 1, space: "macos_global_points", x: 10, y: 10 } },
  ]);
  const files = await buildPackage(noisy, [], CTX);
  assert.deepEqual(steps(files).map((x) => x.summary), steps(base).map((x) => x.summary));
  assert.ok(!steps(files).some((x) => x.summary.includes("Handover") || x.summary.includes("Done")));
  // A click right after the freeze is a real step again.
  const after = withEvents(session, [
    { t: 9500, type: "pointer.click", payload: { button: "left", clickCount: 1, space: "macos_global_points", x: 300, y: 300 } },
  ]);
  assert.equal(steps(await buildPackage(after, [], CTX)).length, steps(base).length + 1);

  const ev = noisy.events;
  assert.deepEqual(explainIntervals(ev), [{ start: 6000, end: 9000 }]);
  const kept = withoutFrozenCollectorEvents(ev);
  assert.equal(kept.length, ev.length - 3);
});

const clickAt = (t: number, extra: Record<string, unknown> = {}) => ({
  t,
  type: "pointer.click",
  payload: { button: "left", clickCount: 1, space: "macos_global_points", x: 300, y: 300, ...extra },
});

test("a click reported after the freeze ended is judged by when the user acted (the Done button)", async () => {
  const session = await load();
  const base = steps(await buildPackage(session, [], CTX)).length;
  // The freeze ends at 9,000. The user pressed Done at 8,950; the helper looked the control up for
  // 250 ms, so the click is reported at 9,150, after explain.end.
  const late = withEvents(session, [clickAt(9150, { lookupMs: 250 })]);
  assert.equal(steps(await buildPackage(late, [], CTX)).length, base, "the Done click is not a step");
  // The same report time without a lookup is a real click made after the freeze.
  const real = withEvents(session, [clickAt(9150, { lookupMs: 0 })]);
  assert.equal(steps(await buildPackage(real, [], CTX)).length, base + 1);
  const noLookup = withEvents(session, [clickAt(9150)]);
  assert.equal(steps(await buildPackage(noLookup, [], CTX)).length, base + 1);
});

test("the click on Resume, reported after the pause ended, is not a step", async () => {
  const session = await load();
  const base = steps(await buildPackage(session, [], CTX)).length;
  // The fixture pauses from 13,000 to 15,000. Resume was pressed at 14,950 and reported at 15,150.
  const resume = withEvents(session, [clickAt(15150, { lookupMs: 250 })]);
  assert.equal(steps(await buildPackage(resume, [], CTX)).length, base);
  // A click that really happened after the pause is kept.
  const after = withEvents(session, [clickAt(15600, { lookupMs: 20 })]);
  assert.equal(steps(await buildPackage(after, [], CTX)).length, base + 1);
});

test("a click on Handover's own window is never a step, even outside a freeze", async () => {
  const session = await load();
  const base = steps(await buildPackage(session, [], CTX)).length;
  const own = (app: Record<string, unknown>) =>
    withEvents(session, [
      clickAt(2000, {
        target: { grounding: "accessibility", source: "ax", role: "button", nativeRole: "AXButton", name: "Explain", isPassword: false, app },
      }),
    ]);
  assert.equal(steps(await buildPackage(own({ name: "Handover" }), [], CTX)).length, base, "by app name");
  assert.equal(steps(await buildPackage(own({ name: "x", process: "Handover.exe" }), [], CTX)).length, base, "by process");
  assert.equal(steps(await buildPackage(own({ name: "Microsoft Excel" }), [], CTX)).length, base + 1, "another app is kept");
});

test("a freeze's highlight and comment belong to its Explain step, whenever in the freeze they were written", async () => {
  const session = await load();
  // The freeze is 6,000 to 9,000 and becomes the step S04, between S03 (t=5,200) and S05.
  const files = await buildPackage(session, [], CTX);
  const anns = annotations(files);
  assert.deepEqual(anns.find((a) => a.annotation_id === "ann_0001")!.step_ids, ["S04"]);
  assert.deepEqual(anns.find((a) => a.annotation_id === "ann_0002")!.step_ids, ["S04"]);
  const s4 = steps(files)[3];
  assert.deepEqual([s4.kind, s4.observed_via, s4.t_start_ms, s4.t_end_ms], ["context", "explain", 6000, 9000]);
  assert.equal(s4.action, undefined);
  assert.equal(s4.target.grounding, "none");
  assert.equal(s4.before.t_ms, 6900, "the picture is the frozen frame");
  assert.equal(s4.before.full_annotated.path, "media/S04_before_full_annotated.png");
  assert.deepEqual(s4.annotation_ids, ["ann_0001", "ann_0002"]);

  const late = withEvents(session, [
    { t: 8900, type: "annotation", payload: { annotationId: "ann_0009", kind: "comment", text: "late note", source: "typed" } },
  ]);
  const lateAnns = annotations(await buildPackage(late, [], CTX));
  assert.deepEqual(lateAnns.find((a) => a.annotation_id === "ann_0009")!.step_ids, ["S04"]);
});

/** The fixture's freeze, replaced by one of our own on `displays` with the given annotation payloads. */
function withFreeze(
  session: SessionInput,
  anns: Record<string, unknown>[],
  displayIds: number[],
  extraStart: Record<string, unknown> = {},
): SessionInput {
  const keep = session.events.filter((e) => !["explain.start", "explain.end", "annotation"].includes(e.type));
  const mk = (seq: number, t: number, type: string, payload: Record<string, unknown>) => ({
    seq, t, epoch: 1795500000000 + t, type, source: "test", payload,
  });
  const extra = [
    mk(100, 6000, "explain.start", { displayIds, ...extraStart }),
    ...anns.map((a, i) => mk(101 + i, 6100 + i * 10, "annotation", a)),
    mk(200, 9000, "explain.end", { displayIds }),
  ];
  return { ...session, events: [...keep, ...extra] };
}

const rectOn = (id: string, displayId: number, frameFile: string) => ({
  annotationId: id, kind: "highlight", displayId, frameFile, shape: "rect", pointsDpx: [[200, 200], [600, 400]],
});

test("a freeze with highlights on two displays gives two Explain steps, each drawn on its own frozen frame", async () => {
  const base = await load();
  // Frozen frames: shot 12 is display 1 (the fixture's); add one for display 2.
  const shot2 = { file: "shots/000013.png", epoch: 1795500006910, displayId: 2, purpose: "annotation" as const };
  const session: SessionInput = {
    ...base,
    shots: [...base.shots, shot2],
    files: new Map([...base.files, ["shots/000013.png", base.files.get("shots/000006.png")!]]),
  };
  const frozen = withFreeze(
    session,
    [
      rectOn("ann_0001", 1, "shots/000012.png"),
      rectOn("ann_0002", 2, "shots/000013.png"),
      { annotationId: "ann_0003", kind: "comment", text: "Both of these totals must match", source: "typed" },
    ],
    [1, 2],
  );
  const files = await buildPackage(frozen, [], CTX);
  const s = steps(files);
  const ex = s.filter((x) => x.observed_via === "explain");
  assert.equal(ex.length, 2, "one Explain step per display that got a highlight");
  assert.deepEqual(ex.map((x) => x.before.display_id), ["d0", "d1"]);
  assert.deepEqual(ex.map((x) => x.before.t_ms), [6900, 6910], "each on its own frozen frame");
  assert.ok(ex.every((x) => x.before.full_annotated && x.t_start_ms === 6000 && x.t_end_ms === 9000));
  const anns = annotations(files);
  const own = (id: string) => anns.find((a) => a.annotation_id === id)!.step_ids;
  assert.deepEqual(own("ann_0001"), [ex[0].step_id]);
  assert.deepEqual(own("ann_0002"), [ex[1].step_id]);
  assert.deepEqual(own("ann_0003"), [ex[0].step_id], "the comment goes to the freeze's first Explain step");
  assert.equal(ex[0].why.text, "Both of these totals must match");
  assert.equal(ex[0].summary, 'Explain on Microsoft Excel: "Both of these totals must match"');
  assert.equal(ex[1].summary, "Explain on Microsoft Excel (H2)", "no comment on this step: its marks");
  // Both are drawn: the annotated image differs from the plain one on each.
  for (const x of ex) {
    const plain = await raw(files.get(x.before.full.path)!);
    const marked = await raw(files.get(x.before.full_annotated.path)!);
    assert.ok(diff(plain, marked, [0, 0, plain.width, plain.height]).inside > 100);
  }
  const md = new TextDecoder().decode(files.get("PROCESS.md"));
  assert.match(md, /evidence explain\n- Where: Microsoft Excel › Budget\.xlsx \(explain\)/);
  const dir = await mkdtemp(path.join(os.tmpdir(), "handover-explain2-"));
  try {
    for (const [p, bytes] of files) {
      await mkdir(path.dirname(path.join(dir, p)), { recursive: true });
      await writeFile(path.join(dir, p), bytes);
    }
    assert.deepEqual((await validatePackage(dir)).errors, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a comment-only freeze gives one Explain step, for the display under the pointer", async () => {
  const base = await load();
  const shot2 = { file: "shots/000013.png", epoch: 1795500006910, displayId: 2, purpose: "annotation" as const };
  const session: SessionInput = {
    ...base,
    shots: [...base.shots, shot2],
    files: new Map([...base.files, ["shots/000013.png", base.files.get("shots/000006.png")!]]),
  };
  const comment = { annotationId: "ann_0001", kind: "comment", text: "Remember the second tab", source: "typed" };
  const onTwo = await buildPackage(withFreeze(session, [comment], [1, 2], { pointerDisplayId: 2 }), [], CTX);
  const ex = steps(onTwo).filter((x) => x.observed_via === "explain");
  assert.equal(ex.length, 1);
  assert.equal(ex[0].before.display_id, "d1", "the display under the pointer");
  assert.equal(ex[0].before.full_annotated, undefined, "no highlights, so nothing to draw");
  assert.equal(ex[0].summary, 'Explain on Microsoft Excel: "Remember the second tab"');
  // Without a pointer display it falls back to the first frozen display.
  const fallback = await buildPackage(withFreeze(session, [comment], [1, 2]), [], CTX);
  assert.equal(steps(fallback).filter((x) => x.observed_via === "explain")[0].before.display_id, "d0");
  // A freeze with nothing in it (cancelled) adds no step.
  const empty = await buildPackage(withFreeze(session, [], [1, 2]), [], CTX);
  assert.equal(steps(empty).filter((x) => x.observed_via === "explain").length, 0);
});

test("Explain steps are excluded from task_ms: their time is explain_ms", async () => {
  const files = await buildPackage(await load(), [], CTX);
  const m = JSON.parse(new TextDecoder().decode(files.get("manifest.json"))) as { recording: Record<string, number> };
  // 20 s in all: 3 s frozen (the Explain step's 6,000 to 9,000), 2 s paused.
  assert.deepEqual(
    [m.recording.task_ms, m.recording.explain_ms, m.recording.paused_ms, m.recording.duration_ms],
    [15000, 3000, 2000, 20000],
  );
  const explainStep = steps(files).find((x) => x.observed_via === "explain")!;
  assert.equal(explainStep.t_end_ms - explainStep.t_start_ms, m.recording.explain_ms);
  // The Explain step is a step, but adding it did not change the time the task took.
  const noFreeze = await buildPackage(withFreeze(await load(), [], [1, 2]), [], CTX);
  const m2 = JSON.parse(new TextDecoder().decode(noFreeze.get("manifest.json"))) as { recording: Record<string, number> };
  assert.equal(m2.recording.task_ms, m.recording.task_ms);
});

test("a freeze before any step: its Explain step comes first and takes the comment", async () => {
  const session = await load();
  const early: SessionInput = {
    ...session,
    events: [
      ...session.events.filter((e) => e.type === "session.start" || e.type === "displays"),
      { seq: 2, t: 50, epoch: 1795500000050, type: "explain.start", source: "test", payload: { displayIds: [1] } },
      { seq: 3, t: 100, epoch: 1795500000100, type: "annotation", source: "test", payload: { annotationId: "ann_0001", kind: "comment", text: "before anything", source: "typed" } },
      { seq: 4, t: 150, epoch: 1795500000150, type: "explain.end", source: "test", payload: { displayIds: [1] } },
      ...session.events.filter((e) => e.seq >= 2 && e.seq <= 3 && e.type !== "explain.start").map((e, i) => ({ ...e, seq: 5 + i })),
      { seq: 9, t: 20000, epoch: 1795500020000, type: "session.stop", source: "recorder", payload: {} },
    ],
  };
  const files = await buildPackage(early, [], CTX);
  const s = steps(files);
  assert.ok(s.length >= 1);
  const ann = annotations(files).find((a) => a.annotation_id === "ann_0001")!;
  assert.deepEqual(ann.step_ids, [s[0].step_id]);
  assert.equal(s[0].why.text, "before anything");
  assert.equal(s[0].observed_via, "explain");
  const m = JSON.parse(new TextDecoder().decode(files.get("manifest.json"))) as { recording: Record<string, number> };
  assert.equal(m.recording.explain_ms, 100);
  assert.equal(
    m.recording.task_ms + m.recording.explain_ms + m.recording.paused_ms,
    m.recording.duration_ms,
  );
});
