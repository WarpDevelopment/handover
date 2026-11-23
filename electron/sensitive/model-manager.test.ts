import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { SensitiveModelManager } from "./model-manager";

test("advanced protection OCR is off by default and never fetches", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "handover-ocr-"));
  const previousDir = process.env.HANDOVER_MODELS_DIR;
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (() => {
    fetched += 1;
    throw new Error("network must not be used");
  }) as typeof fetch;
  process.env.HANDOVER_MODELS_DIR = dir;
  try {
    const manager = new SensitiveModelManager(() => undefined);
    manager.initialize();
    assert.equal(manager.status().enabled, false);
    assert.equal(manager.isAdvancedEnabled(), false);

    // Even when someone enables it, the OCR data cannot be downloaded.
    const result = await manager.setAdvanced(true);
    assert.equal(result.ok, true);
    const download = await manager.downloadModels();
    assert.equal(download.ok, false);
    assert.match(download.error ?? "", /disabled in this test build/);
    assert.equal(fetched, 0);
    await manager.dispose();
  } finally {
    globalThis.fetch = realFetch;
    if (previousDir === undefined) delete process.env.HANDOVER_MODELS_DIR;
    else process.env.HANDOVER_MODELS_DIR = previousDir;
    await rm(dir, { recursive: true, force: true });
  }
});
