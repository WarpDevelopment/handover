import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { readManifest, targetPath, verifyAll } from "./fetch-models.mjs";

const NARRATION_FILES = [
  "config.json",
  "generation_config.json",
  "preprocessor_config.json",
  "tokenizer_config.json",
  "tokenizer.json",
  "onnx/encoder_model_quantized.onnx",
  "onnx/decoder_model_merged_quantized.onnx",
];

test("manifest pins the revision and every file the narration runtime requires", () => {
  const manifest = readManifest();
  assert.match(manifest.revision, /^[0-9a-f]{40}$/);
  assert.equal(manifest.model, "Xenova/whisper-small");
  assert.deepEqual(manifest.files.map((f) => f.path).sort(), [...NARRATION_FILES].sort());
  for (const f of manifest.files) assert.match(f.sha256, /^[0-9a-f]{64}$/);
});

test("verifyAll fails on a missing file and on a hash mismatch, passes when pins match", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "handover-models-"));
  try {
    const bodies = new Map();
    const manifest = {
      model: "Xenova/whisper-small",
      files: ["a.json", "onnx/b.onnx"].map((p) => {
        const body = Buffer.from(`body of ${p}`);
        bodies.set(p, body);
        return { path: p, bytes: body.length, sha256: createHash("sha256").update(body).digest("hex") };
      }),
    };
    assert.equal((await verifyAll(dir, manifest)).length, 2, "both missing");

    for (const [p, body] of bodies) {
      const target = targetPath(dir, manifest, p);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, body);
    }
    assert.deepEqual(await verifyAll(dir, manifest), []);

    await writeFile(targetPath(dir, manifest, "a.json"), "tampered");
    const problems = await verifyAll(dir, manifest);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /a\.json: sha256 mismatch/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
