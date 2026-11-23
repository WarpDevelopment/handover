import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import AdmZip from "adm-zip";

import { writeDebugBundle } from "./debug-bundle";

async function withSessionsRoot<T>(fn: (root: string, sessions: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), "handover-debug-"));
  const previousRoot = process.env.HANDOVER_SESSIONS_DIR;
  const sessions = path.join(root, "sessions");
  process.env.HANDOVER_SESSIONS_DIR = sessions;
  try {
    return await fn(root, sessions);
  } finally {
    if (previousRoot === undefined) delete process.env.HANDOVER_SESSIONS_DIR;
    else process.env.HANDOVER_SESSIONS_DIR = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
}

test("writeDebugBundle writes a valid zip holding only debug-info.json, never session content", async () => {
  await withSessionsRoot(async (root, sessions) => {
    const id = "debug-test";
    const dir = path.join(sessions, id);
    await mkdir(path.join(dir, "frames"), { recursive: true });
    await writeFile(path.join(dir, "session.json"), JSON.stringify({ id }));
    await writeFile(path.join(dir, "events.jsonl"), '{"title":"PLANTED-PAYLOAD"}\n');
    await writeFile(path.join(dir, "frames", "event_1000.jpg"), Buffer.alloc(8, 7));
    await writeFile(path.join(dir, "video.webm"), Buffer.alloc(8, 1));
    // Sibling app-level state must never be swept into the bundle.
    await mkdir(path.join(root, "app-state"));
    await writeFile(path.join(root, "app-state", "test.log"), "private runtime");

    const dest = path.join(root, "bundle.zip");
    await writeDebugBundle(id, dest, { sessionId: id, marker: "diagnostics" });

    assert.ok(existsSync(dest), "zip file should be written");
    const head = await readFile(dest);
    assert.deepEqual(
      [...head.subarray(0, 4)],
      [0x50, 0x4b, 0x03, 0x04],
      "output should start with the ZIP local-file-header magic",
    );

    const zip = new AdmZip(dest);
    const names = zip
      .getEntries()
      .filter((entry) => !entry.isDirectory)
      .map((entry) => entry.entryName);
    assert.deepEqual(names, ["debug-info.json"]);
    assert.ok(!zip.readAsText("debug-info.json").includes("PLANTED-PAYLOAD"));
  });
});

test("writeDebugBundle refuses a traversal session id", async () => {
  await assert.rejects(
    async () => writeDebugBundle("../escape", path.join(tmpdir(), "x.zip"), {}),
    /Invalid session id/,
  );
});
