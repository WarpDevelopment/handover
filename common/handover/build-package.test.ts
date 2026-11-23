import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import sharp from "sharp";

import { buildPackage } from "./build-package";
import { sha256Hex } from "./canonical";
import { UnsupportedEditError } from "./edits";
import { readSessionInput } from "./read-session";
import type { BuildContext, Edit, PackageBytes, SessionInput } from "./types";
import { validatePackage } from "./validate";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, "../../test/fixtures/session-synthetic");
const GOLDEN = path.resolve(here, "../../test/fixtures/golden-package");
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
const TEXT_FILES = ["manifest.json", "steps.jsonl", "annotations.jsonl", "gaps.jsonl", "PROCESS.md", "CLAUDE_HANDOFF.md", "README.txt"];

async function load(): Promise<{ session: SessionInput; edits: Edit[] }> {
  return readSessionInput(FIXTURE, EXTRAS);
}

/** PNG bytes may differ between sharp/libvips builds, so the golden manifest masks PNG hashes. */
function maskPngHashes(manifestJson: string): string {
  const m = JSON.parse(manifestJson) as { files: { path: string; sha256: string; bytes: number }[] };
  for (const f of m.files) {
    if (f.path.endsWith(".png")) {
      f.sha256 = "<png>";
      f.bytes = 0;
    }
  }
  return JSON.stringify(m, null, 2) + "\n";
}

function text(files: PackageBytes, p: string): string {
  const b = files.get(p);
  assert.ok(b, `${p} is in the package`);
  return new TextDecoder().decode(b);
}

async function writeTo(dir: string, files: PackageBytes): Promise<void> {
  for (const [p, bytes] of files) {
    await mkdir(path.dirname(path.join(dir, p)), { recursive: true });
    await writeFile(path.join(dir, p), bytes);
  }
}

async function topLeft(png: Uint8Array): Promise<[number, number, number]> {
  const { data } = await sharp(Buffer.from(png)).raw().toBuffer({ resolveWithObject: true });
  return [data[0], data[1], data[2]];
}

function steps(files: PackageBytes): Record<string, any>[] {
  return text(files, "steps.jsonl").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
function anns(files: PackageBytes): Record<string, any>[] {
  return text(files, "annotations.jsonl").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

test("golden: the synthetic session builds a byte-stable package that validates", async () => {
  const { session, edits } = await load();
  const files = await buildPackage(session, edits, CTX);

  // Deterministic: a second build is byte-identical for every file, PNGs included.
  const again = await buildPackage(session, edits, CTX);
  assert.deepEqual([...again.keys()], [...files.keys()]);
  for (const [p, bytes] of files) assert.equal(sha256Hex(bytes), sha256Hex(again.get(p)!), `${p} is stable`);

  if (process.env.UPDATE_GOLDEN === "1") {
    await mkdir(GOLDEN, { recursive: true });
    for (const name of TEXT_FILES) {
      const body = name === "manifest.json" ? maskPngHashes(text(files, name)) : text(files, name);
      await writeFile(path.join(GOLDEN, name), body);
    }
  }
  for (const name of TEXT_FILES) {
    const want = await readFile(path.join(GOLDEN, name), "utf8");
    const got = name === "manifest.json" ? maskPngHashes(text(files, name)) : text(files, name);
    assert.equal(got, want, `${name} matches the golden file`);
  }

  // The manifest hashes verify and validatePackage passes on the written folder.
  const dir = await mkdtemp(path.join(os.tmpdir(), "handover-golden-"));
  try {
    await writeTo(dir, files);
    const result = await validatePackage(dir);
    assert.deepEqual(result.errors, []);
    assert.equal(result.ok, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("steps, timing and frames of the synthetic session", async () => {
  const { session, edits } = await load();
  const files = await buildPackage(session, edits, CTX);
  const s = steps(files);
  assert.deepEqual(
    s.map((x) => [x.step_id, x.kind, x.summary]),
    [
      ["S01", "context", "Switch to Microsoft Excel"],
      ["S02", "action", 'Click button "Save" in Microsoft Excel'],
      ["S03", "action", "Double-click at (400, 300) in Microsoft Excel"],
      ["S04", "context", "Switch to Google Chrome"],
      ["S05", "action", 'Click text box "Password" in Google Chrome'],
      ["S06", "action", 'Right-click pane "Mail list" in Google Chrome'],
    ],
  );
  const manifest = JSON.parse(text(files, "manifest.json"));
  assert.deepEqual(
    [manifest.recording.task_ms, manifest.recording.explain_ms, manifest.recording.paused_ms, manifest.recording.duration_ms],
    [15000, 3000, 2000, 20000],
  );
  assert.equal(manifest.recording.started_at.endsWith("+02:00"), true);
  assert.equal(manifest.recording.step_count, 6);
  assert.equal(manifest.media.image_count, [...files.keys()].filter((p) => p.endsWith(".png")).length);

  // The before frame is the newest frame at least 50 ms before the click: S02 (click at 3,000)
  // uses shot 2 (t=2,700), not shot 3 (t=2,980), which is only 20 ms before.
  const pick = async (n: number) => topLeft(new Uint8Array(await readFile(path.join(FIXTURE, `shots/${String(n).padStart(6, "0")}.png`))));
  // Resizing blends the fine stripes, so compare colours with a tolerance; shots differ by far more.
  const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) <= 12);
  assert.ok(near(await topLeft(files.get("media/S02_before_full.png")!), await pick(2)));
  assert.ok(!near(await topLeft(files.get("media/S02_before_full.png")!), await pick(3)));
  assert.ok(near(await topLeft(files.get("media/S03_before_full.png")!), await pick(4))); // not 5 (t=5,170)
  assert.ok(!near(await topLeft(files.get("media/S03_before_full.png")!), await pick(5)));
  assert.equal(s[1].before.t_ms, 2700);
  assert.equal(s[2].before.t_ms, 5000);

  // Negative-origin display: macOS dpx = (p - origin) x scale.
  assert.deepEqual(s[4].action.point_dpx, { display_id: "d1", xy: [1160, 700] });
  assert.deepEqual(s[1].action.point_dpx, { display_id: "d0", xy: [1400, 800] });
  // Full images respect the 1,568 rules.
  for (const x of s) {
    if (!x.before) continue;
    assert.ok(Math.max(x.before.full.width, x.before.full.height) <= 1568);
    assert.ok(x.before.full.est_tokens <= 1568);
  }
  // Crops are at most 800x500 and only exist for clicks.
  assert.equal(s[0].before.crop, undefined);
  assert.ok(s[1].before.crop.width <= 800 && s[1].before.crop.height <= 500);
  // The after frame is only on the last step.
  assert.equal(s[5].after.t_ms, 16500);
  assert.ok(s.slice(0, 5).every((x) => x.after === undefined));
  // Flags and grounding.
  assert.deepEqual(s[4].flags, ["contains_redaction"]);
  assert.deepEqual(s[2].flags, ["low_confidence_target"]);
  assert.equal(s[2].target.grounding, "visual_only");
  assert.deepEqual(s[2].target.unavailable, { reason: "timeout" });
  assert.equal(s[3].target.url.text, "https://mail.example.com/inbox"); // query and fragment dropped
  const last = s[1].target.locators.at(-1);
  assert.equal(last.strategy, "frame_point");
  assert.equal(last.stability, "low");
  assert.equal(s[1].target.locators[0].strategy, "ax_identifier");
});

test("the before frame is chosen before the click, not before the time the helper reported it", async () => {
  const { session } = await load();
  // The S02 click is reported at t=3,000 after a 400 ms lookup, so the user clicked at 2,600.
  // Shots at 2,700 and 2,980 are therefore after the click; the newest frame before it is t=0.
  const slow: SessionInput = {
    ...session,
    events: session.events.map((e) =>
      e.seq === 3 ? { ...e, payload: { ...e.payload, lookupMs: 400 } } : e,
    ),
  };
  const files = await buildPackage(slow, [], CTX);
  const s2 = steps(files)[1];
  assert.equal(s2.before.t_ms, 0);
  assert.equal(s2.t_start_ms, 3000, "the step keeps the time the click was reported");
  // Without a lookup time the same click still uses the t=2,700 frame.
  const fast = await buildPackage(session, [], CTX);
  assert.equal(steps(fast)[1].before.t_ms, 2700);
});

test("PROCESS.md lists only steps with no control as unseen; a weak control is not listed", async () => {
  const { session, edits } = await load();
  const md = text(await buildPackage(session, edits, CTX), "PROCESS.md");
  const unseen = md.slice(md.indexOf("## What the recorder could not see"));
  assert.match(unseen, /- S03: no control identified \(timeout\); the target is pixels only\./);
  assert.ok(!unseen.includes("- S06:"), "S06 found a weak control (T2), so it is not pixels only");
  assert.match(md, /evidence T2 \(opaque_toolkit\)/);
  assert.match(unseen, /- gap_0001 \(S05 → S06\): paused by the user, 2\.0 s\./);
});

test("annotations: freeze comment and highlight attach to the last step before the freeze; narration by overlap", async () => {
  const { session, edits } = await load();
  const files = await buildPackage(session, edits, CTX);
  const a = anns(files);
  const hl = a.find((x) => x.kind === "highlight")!;
  const comment = a.find((x) => x.kind === "comment")!;
  const narr = a.find((x) => x.kind === "narration")!;
  assert.deepEqual(hl.step_ids, ["S03"]);
  assert.deepEqual(comment.step_ids, ["S03"]);
  assert.equal(hl.mark, "H1");
  assert.equal(hl.frame_id, steps(files)[2].before.frame_id);
  assert.equal(hl.geometry_fpx.length, 2);
  // fpx = dpx x scale.
  const scale = steps(files)[2].before.scale;
  assert.ok(Math.abs(hl.geometry_fpx[0][0] - 1300 * scale) < 0.01);
  assert.equal(hl.snapped_to.role, "button");
  // Narration overlapping two steps gets a low anchor confidence.
  assert.ok(narr.anchor_confidence < 0.6);
  assert.deepEqual(narr.step_ids, ["S02"]);
  // The comment is the step's why, and PROCESS.md cites it.
  assert.equal(steps(files)[2].why.text, "Always save before closing the file");
  assert.match(text(files, "PROCESS.md"), /- Why: Always save before closing the file `\[user, ann_0002\]`/);
  assert.match(text(files, "PROCESS.md"), /\*\*S03\. .*\*\* \(H1\)/);
});

test("password field: the before frame is blurred and the step is flagged", async () => {
  const { session } = await load();
  const files = await buildPackage(session, [], CTX);
  const s5 = steps(files)[4];
  assert.equal(s5.before.redacted_regions_fpx.length, 1);
  const [x, y, w, h] = s5.before.redacted_regions_fpx[0];
  assert.ok(w > 0 && h > 0);
  // The same frame without the password flag has different pixels inside the region only.
  const noPw: SessionInput = {
    ...session,
    events: session.events.map((e) =>
      e.seq === 10 ? { ...e, payload: { ...e.payload, target: { ...(e.payload.target as object), isPassword: false } } } : e,
    ),
  };
  const plain = await buildPackage(noPw, [], CTX);
  const a = await sharp(Buffer.from(files.get("media/S05_before_full.png")!)).raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(Buffer.from(plain.get("media/S05_before_full.png")!)).raw().toBuffer({ resolveWithObject: true });
  assert.equal(a.info.width, b.info.width);
  let inside = 0;
  let outside = 0;
  const pad = 3; // resampling blends a pixel or two across the edge
  for (let py = 0; py < a.info.height; py++) {
    for (let px = 0; px < a.info.width; px++) {
      const o = (py * a.info.width + px) * 3;
      const differs = a.data[o] !== b.data[o] || a.data[o + 1] !== b.data[o + 1] || a.data[o + 2] !== b.data[o + 2];
      if (!differs) continue;
      if (px >= x - pad && px <= x + w + pad && py >= y - pad && py <= y + h + pad) inside++;
      else outside++;
    }
  }
  assert.equal(outside, 0, "no pixel outside the blurred rectangle changes");
  assert.ok(inside > 0, "pixels inside the rectangle changed");
});

test("edits: delete renumbers ids and drops its annotations; edit_summary and edit_comment apply", async () => {
  const { session } = await load();
  const edits: Edit[] = [
    { edit_id: "e1", at: "2026-11-24T09:00:00+02:00", op: "delete_step", step_id: "S02" },
    { edit_id: "e2", at: "2026-11-24T09:00:01+02:00", op: "edit_summary", step_id: "S03", text: "Open the budget cell" },
    { edit_id: "e3", at: "2026-11-24T09:00:02+02:00", op: "edit_comment", annotation_id: "ann_0002", text: "Save first" },
  ];
  const files = await buildPackage(session, edits, CTX);
  const s = steps(files);
  assert.deepEqual(s.map((x) => x.step_id), ["S01", "S02", "S03", "S04", "S05"]);
  assert.deepEqual(s.map((x) => x.seq), [1, 2, 3, 4, 5]);
  assert.ok(!s.some((x) => x.summary.includes('"Save"')), "the deleted step is gone");
  assert.equal(s[1].summary, "Open the budget cell");
  assert.equal(s[1].summary_provenance, "user");
  assert.deepEqual(s[1].flags, ["low_confidence_target", "user_edited"]);
  assert.ok(!files.has("media/S06_before_full.png"), "images are renumbered with the steps");
  const a = anns(files);
  assert.deepEqual(a.find((x) => x.kind === "comment")!.text.text, "Save first");
  assert.equal(a.find((x) => x.kind === "comment")!.source, "review");
  // Narration attached to the deleted step goes with it; highlight and comment moved to the new S02.
  assert.ok(!a.some((x) => x.kind === "narration"));
  assert.deepEqual(a.find((x) => x.kind === "highlight")!.step_ids, ["S02"]);
  // The result still validates.
  const dir = await mkdtemp(path.join(os.tmpdir(), "handover-edit-"));
  try {
    await writeTo(dir, files);
    assert.deepEqual((await validatePackage(dir)).errors, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gap convention: open without tEndMs, closed by a later gap with the same reason, unclosed runs to the end", async () => {
  const { session } = await load();
  const base = session.events.filter((e) => e.type !== "gap");
  const gap = (seq: number, t: number, payload: Record<string, unknown>) => ({
    seq, t, epoch: 1795500000000 + t, type: "gap", source: "t", payload,
  });
  const events = [
    ...base,
    gap(50, 13000, { reason: "user_paused" }), // opens
    gap(51, 14000, { reason: "helper_restart" }), // opens another reason; never closed
    gap(52, 15000, { reason: "user_paused", tEndMs: 15000 }), // closes the pause
    gap(53, 18000, { reason: "capture_lost", tEndMs: 19000 }), // complete on its own
  ];
  const files = await buildPackage({ ...session, events }, [], CTX);
  const gaps = text(files, "gaps.jsonl").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(
    gaps.map((g) => [g.reason, g.t_start_ms, g.t_end_ms]),
    [["user_paused", 13000, 15000], ["helper_restart", 14000, 20000], ["capture_lost", 18000, 19000]],
  );
  const m = JSON.parse(text(files, "manifest.json"));
  assert.equal(m.recording.paused_ms, 2000);
  assert.equal(m.recording.task_ms + m.recording.explain_ms + m.recording.paused_ms, m.recording.duration_ms);
  // An unclosed pause runs to session end.
  const open = await buildPackage({ ...session, events: [...base, gap(50, 13000, { reason: "user_paused" })] }, [], CTX);
  assert.equal(JSON.parse(text(open, "manifest.json")).recording.paused_ms, 7000);
});

test("deleting the last step leaves no after frame: a frame taken after the deleted action is not 'about 500 ms after' the new last step", async () => {
  const { session } = await load();
  const files = await buildPackage(session, [{ edit_id: "e1", at: "t", op: "delete_step", step_id: "S06" }], CTX);
  const s = steps(files);
  assert.equal(s.length, 5);
  assert.equal(s[4].after, undefined);
  assert.ok(![...files.keys()].some((p) => p.includes("_after_")));
});

test("edits: blur_rect and unknown edit types fail closed", async () => {
  const { session } = await load();
  const blur = { edit_id: "e1", at: "t", op: "blur_rect", step_id: "S02", rect_fpx: [0, 0, 10, 10] } as Edit;
  await assert.rejects(() => buildPackage(session, [blur], CTX), UnsupportedEditError);
  const unknown = { edit_id: "e2", at: "t", op: "crop_everything" } as unknown as Edit;
  await assert.rejects(() => buildPackage(session, [unknown], CTX), UnsupportedEditError);
  await assert.rejects(
    () => buildPackage(session, [{ edit_id: "e3", at: "t", op: "delete_step", step_id: "S99" }], CTX),
    /unknown step S99/,
  );
});

test("Windows layout: dpx = p - origin (no scale factor), negative origin, synthetic events only", async () => {
  const { session } = await load();
  const base = 1795500000000;
  const mk = (seq: number, t: number, type: string, payload: Record<string, unknown>) => ({
    seq, t, epoch: base + t, type, source: "test", payload,
  });
  const win: SessionInput = {
    ...session,
    meta: { ...session.meta, platform: "win32" },
    environment: { os: "windows", os_version: "11", arch: "x64", locale: "en-ZA" },
    narration: [],
    events: [
      mk(0, 0, "session.start", { platform: "win32" }),
      mk(1, 0, "displays", {
        globalSpace: "windows_virtual_px",
        displays: [
          { id: 1, originGlobal: [0, 0], sizeDpx: [2880, 1800], scaleFactor: 1.5, primary: true },
          { id: 2, originGlobal: [-2560, 100], sizeDpx: [2560, 1440], scaleFactor: 1, primary: false },
        ],
      }),
      // On display 2 (negative origin): dpx = (-1400 - -2560, 500 - 100) = (1160, 400).
      mk(2, 12000, "pointer.click", { button: "left", clickCount: 1, space: "windows_virtual_px", x: -1400, y: 500 }),
      // On display 1 with scale 1.5: still dpx = p.
      mk(3, 16000, "pointer.click", { button: "left", clickCount: 1, space: "windows_virtual_px", x: 900, y: 700 }),
      mk(4, 20000, "session.stop", {}),
    ],
  };
  const files = await buildPackage(win, [], CTX);
  const s = steps(files);
  assert.deepEqual(s[0].action.point_dpx, { display_id: "d1", xy: [1160, 400] });
  assert.deepEqual(s[1].action.point_dpx, { display_id: "d0", xy: [900, 700] });
  assert.equal(s[0].summary, "Click at (1160, 400)");
  const manifest = JSON.parse(text(files, "manifest.json"));
  assert.equal(manifest.recorder.os, "windows");
  assert.equal(manifest.displays[1].global_space, "windows_virtual_px");
});

test("the builder handles every shared event type: displays, pointer.click, annotation, gap, explain.*", async () => {
  const { session } = await load();
  const types = new Set(session.events.map((e) => e.type));
  for (const t of ["displays", "pointer.click", "annotation", "gap", "explain.start", "explain.end"]) {
    assert.ok(types.has(t), `fixture covers ${t}`);
  }
  // An empty session still builds and validates (no steps, no frames).
  const empty: SessionInput = { ...session, events: session.events.filter((e) => e.type === "session.start" || e.type === "session.stop"), narration: [], shots: [], files: new Map() };
  const files = await buildPackage(empty, [], CTX);
  assert.equal(text(files, "steps.jsonl"), "");
  assert.equal(JSON.parse(text(files, "manifest.json")).recording.step_count, 0);
});

test("no keyboard, value or clipboard text reaches the package", async () => {
  const { session } = await load();
  const hostile: SessionInput = {
    ...session,
    events: [
      ...session.events,
      { seq: 99, t: 8000, epoch: 1795500008000, type: "clipboard.change", source: "test", payload: { formats: ["text/plain"], length: 9, hash: "h", textPreview: "TOPSECRET-CLIP" } },
      { seq: 100, t: 8100, epoch: 1795500008100, type: "terminal.command", source: "test", payload: { commandId: "c", command: "echo TOPSECRET-CMD", cwd: "/" } },
    ],
  };
  const files = await buildPackage(hostile, [], CTX);
  for (const [p, bytes] of files) {
    if (p.endsWith(".png")) continue;
    const body = new TextDecoder().decode(bytes);
    assert.ok(!body.includes("TOPSECRET"), `${p} has no clipboard or command text`);
  }
});
