import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJson, canonicalJsonl, dateInTimezone, formatDuration, isoWithOffset, slugify, ulid } from "./canonical";
import { assertEdit, assertEditsApplicable, parseEdits, UnsupportedEditError } from "./edits";
import { blurRect, decode } from "./images";
import { packageFolderName } from "./build-package";
import { renderHandoffMd } from "./handoff-md";
import sharp from "sharp";

test("JSON is sorted-key, LF-terminated, and undefined values vanish", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: undefined } }), '{\n  "a": {\n    "d": [\n      3,\n      {\n        "y": 2,\n        "z": 1\n      }\n    ]\n  },\n  "b": 1\n}\n');
  assert.equal(canonicalJsonl([{ b: 1, a: 2 }, { a: 1 }]), '{"a":2,"b":1}\n{"a":1}\n');
  assert.equal(canonicalJsonl([]), "");
});

test("time formatting follows the IANA timezone", () => {
  // 2026-11-24T07:20:00Z is 09:20 in Johannesburg (UTC+2, no DST).
  const ms = Date.UTC(2026, 10, 24, 7, 20, 0);
  assert.equal(isoWithOffset(ms, "Africa/Johannesburg"), "2026-11-24T09:20:00+02:00");
  assert.equal(isoWithOffset(ms, "UTC"), "2026-11-24T07:20:00+00:00");
  assert.equal(isoWithOffset(ms, "America/New_York"), "2026-11-24T02:20:00-05:00");
  assert.equal(dateInTimezone(Date.UTC(2026, 10, 24, 23, 30), "Africa/Johannesburg"), "2026-11-25");
});

test("durations: under 60 s one decimal, otherwise minutes and whole seconds", () => {
  assert.equal(formatDuration(15000), "15.0 s");
  assert.equal(formatDuration(51540), "51.5 s");
  assert.equal(formatDuration(60000), "1 min 0 s");
  assert.equal(formatDuration(125900), "2 min 5 s");
});

test("slug is lower kebab case, at most 40 characters; the folder name carries the package id", () => {
  assert.equal(slugify("Save the Budget & open mail!"), "save-the-budget-open-mail");
  assert.equal(slugify("Ünïcode Tïtle"), "unicode-title");
  assert.equal(slugify("!!!"), "process");
  assert.ok(slugify("a".repeat(100)).length <= 40);
  assert.equal(slugify("word ".repeat(20)).endsWith("-"), false);
  assert.equal(packageFolderName("Save the Budget", "pkg_X"), "save-the-budget__pkg_X.handover");
});

test("ULIDs are 26 Crockford characters and sort by time", () => {
  const r = new Uint8Array(10).fill(255);
  const a = ulid(1_700_000_000_000, r);
  const b = ulid(1_700_000_000_001, new Uint8Array(10));
  assert.match(a, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.ok(a < b);
  assert.equal(ulid(0, new Uint8Array(10)), "00000000000000000000000000");
});

test("edits: parse, validate, and fail closed on unknown or unsupported operations", () => {
  const lines = [
    '{"edit_id":"e1","at":"t","op":"delete_step","step_id":"S01"}',
    "",
    '{"edit_id":"e2","at":"t","op":"edit_summary","step_id":"S02","text":"x"}',
  ].join("\n");
  assert.equal(parseEdits(lines).length, 2);
  assert.throws(() => parseEdits("not json"), /not valid JSON/);
  assert.throws(() => parseEdits('{"edit_id":"e","at":"t","op":"explode"}'), UnsupportedEditError);
  assert.throws(() => assertEdit({ op: "delete_step", edit_id: "e", at: "t" }), /needs step_id/);
  assert.throws(() => assertEdit({ op: "blur_rect", edit_id: "e", at: "t", step_id: "S01", rect_fpx: [1, 2] }), /rect_fpx/);
  const blur = assertEdit({ op: "blur_rect", edit_id: "e", at: "t", step_id: "S01", rect_fpx: [1, 2, 3, 4] });
  assert.throws(() => assertEditsApplicable([blur]), UnsupportedEditError);
  assert.doesNotThrow(() => assertEditsApplicable([assertEdit({ op: "delete_step", edit_id: "e", at: "t", step_id: "S01" })]));
});

test("blurRect changes pixels only inside the rectangle", async () => {
  const w = 120;
  const h = 80;
  const data = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    data[i * 3] = (i * 7) % 256;
    data[i * 3 + 1] = (i * 13) % 256;
    data[i * 3 + 2] = (i * 29) % 256;
  }
  const png = await sharp(data, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
  const img = await decode(png);
  const out = await blurRect(img, [20, 10, 40, 30]);
  let inside = 0;
  let outside = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3;
      const same = img.data[o] === out.data[o] && img.data[o + 1] === out.data[o + 1] && img.data[o + 2] === out.data[o + 2];
      const inRect = x >= 20 && x < 60 && y >= 10 && y < 40;
      if (!same) (inRect ? inside++ : outside++);
    }
  }
  assert.equal(outside, 0);
  assert.ok(inside > 0);
  // A rectangle outside the image is a no-op.
  assert.equal((await blurRect(img, [500, 500, 10, 10])).data, img.data);
});

test("the handoff keeps the Rules section, including the no-invented-steps rule", () => {
  const md = renderHandoffMd({ title: "T", slug: "t", package_id: "pkg_X" });
  assert.match(md, /do not invent steps inside gaps/i);
  assert.match(md, /\[observed\]/);
  assert.match(md, /process_spec\.md/);
  assert.ok(!md.includes("dataflow.json"));
});
