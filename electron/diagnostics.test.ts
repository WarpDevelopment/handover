import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import AdmZip from "adm-zip";

import { diagnosticsFileName, writeDiagnosticsZip } from "./diagnostics";

const PLANTED = [
  "PLANTED-EVENT-PAYLOAD-Quarterly payroll ACME",
  "PLANTED-TRANSCRIPT-we click save here",
  "PLANTED-COMMENT-check the invoice total",
  "PLANTED-CLIPBOARD-4111111111111111",
];
const MEDIA = /\.(png|jpe?g|webm|opus|wav)$/i;

test("the diagnostics zip holds no media and none of the planted session payloads", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "handover-diag-"));
  try {
    // A realistic session folder the diagnostics must not read.
    const session = path.join(root, "sessions", "2026-11-23_session");
    await mkdir(path.join(session, "frames"), { recursive: true });
    await writeFile(path.join(session, "frames", "event_1000.png"), Buffer.from(`png ${PLANTED[0]}`));
    await writeFile(path.join(session, "video.webm"), Buffer.from("webm"));
    await writeFile(path.join(session, "narration.opus"), Buffer.from("opus"));
    await writeFile(path.join(session, "events.jsonl"), `{"title":"${PLANTED[0]}","clip":"${PLANTED[3]}"}\n`);
    await writeFile(path.join(session, "narration.json"), JSON.stringify({ text: PLANTED[1] }));
    await writeFile(path.join(session, "comments.json"), JSON.stringify({ comment: PLANTED[2] }));

    // App logs (these are allowed in the zip).
    const logDir = path.join(root, "logs");
    await mkdir(logDir, { recursive: true });
    await writeFile(path.join(logDir, "handover-20261123.log"), "2026-11-23T09:00:00Z INFO [Main] started\n");
    await writeFile(path.join(logDir, "notes.png"), Buffer.from("not a log"));

    const dest = path.join(root, "diag.zip");
    await writeDiagnosticsZip(dest, {
      info: { generatedAt: "2026-11-23T09:00:00Z", app: { version: "0.1.0" } },
      logDir,
      sessionsDir: path.join(root, "sessions"),
    });

    const zip = new AdmZip(dest);
    const entries = zip.getEntries().filter((e) => !e.isDirectory);
    const names = entries.map((e) => e.entryName).sort();
    assert.deepEqual(names, ["diagnostics.json", "logs/handover-20261123.log"]);
    for (const name of names) assert.ok(!MEDIA.test(name), `${name} must not be media`);

    // Decompress every entry: the zip is deflated, so searching raw bytes would prove nothing.
    for (const entry of entries) {
      const text = zip.readAsText(entry);
      for (const planted of PLANTED) assert.ok(!text.includes(planted), `${entry.entryName} leaks ${planted}`);
    }
    const info = JSON.parse(zip.readAsText("diagnostics.json")) as { sessionCount: number };
    assert.equal(info.sessionCount, 1, "reports how many sessions exist, nothing about them");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the diagnostics file name is timestamped and filesystem safe", () => {
  const name = diagnosticsFileName(new Date("2026-11-23T09:05:06.789Z"));
  assert.equal(name, "handover-diagnostics-2026-11-23T09-05-06Z.zip");
});
