import assert from "node:assert/strict";
import test from "node:test";

import { clipboard } from "electron";

import { ClipboardCollector } from "./clipboard";

const SECRET = "client-secret-ACME-12345";

test("a clipboard change event carries no text field, only formats, length and hash", () => {
  const stub = clipboard as unknown as {
    readText: () => string;
    availableFormats: () => string[];
  };
  const original = { readText: stub.readText, availableFormats: stub.availableFormats };
  let text = "";
  stub.readText = () => text;
  stub.availableFormats = () => (text ? ["text/plain"] : []);

  const published: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const collector = new ClipboardCollector();
  try {
    collector.start({
      publish: (type, payload) => published.push({ type, payload: payload as Record<string, unknown> }),
      sessionDir: "",
      log: { info() {}, warn() {}, error() {} },
    });
    text = SECRET;
    collector.poll();
  } finally {
    collector.stop();
    stub.readText = original.readText;
    stub.availableFormats = original.availableFormats;
  }

  assert.equal(published.length, 1);
  assert.equal(published[0]?.type, "clipboard.change");
  const payload = published[0]!.payload;
  assert.deepEqual(Object.keys(payload).sort(), ["formats", "hash", "length"]);
  assert.equal("textPreview" in payload, false);
  assert.ok(!JSON.stringify(published).includes(SECRET), "clipboard text must never be emitted");
});
