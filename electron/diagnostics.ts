import { createWriteStream, existsSync, openSync, readSync, closeSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { ZipArchive } from "archiver";

import { LOG_MAX_BYTES } from "./logger";

/**
 * Environment facts that go into `diagnostics.json`. Everything here is machine state
 * (versions, displays, permission states, the doctor report); none of it is recording
 * content. The gatherer lives in `diagnostics-info.ts` so this module stays free of
 * Electron APIs and testable under plain Node.
 */
export interface DiagnosticsInfo {
  generatedAt: string;
  [key: string]: unknown;
}

export interface DiagnosticsInput {
  info: DiagnosticsInfo;
  /** Directory holding `handover-YYYYMMDD.log` files. */
  logDir: string;
  /** Sessions root: only the NUMBER of session folders is read, never their contents. */
  sessionsDir: string;
}

/** Number of session folders, without opening any of them. */
export function countSessions(sessionsDir: string): number {
  try {
    return readdirSync(sessionsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
  } catch {
    return 0;
  }
}

/** The last `maxBytes` of a file (whole file when smaller). */
function readTail(file: string, maxBytes: number): Buffer {
  const size = statSync(file).size;
  const length = Math.min(size, maxBytes);
  const buf = Buffer.alloc(length);
  const fd = openSync(file, "r");
  try {
    readSync(fd, buf, 0, length, size - length);
  } finally {
    closeSync(fd);
  }
  return buf;
}

function listLogs(logDir: string): string[] {
  if (!existsSync(logDir)) return [];
  return readdirSync(logDir)
    .filter((f) => /^handover-\d{8}(\.1)?\.log$/.test(f))
    .sort();
}

/**
 * Write the support diagnostics zip: `diagnostics.json` plus the app logs (tail-capped
 * at 5 MB each). It deliberately never reads a session folder, so it holds no
 * screenshots, video, audio, transcripts, comments or event payloads.
 */
export function writeDiagnosticsZip(destZipPath: string, input: DiagnosticsInput): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const done = (err?: Error): void => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };
    const output = createWriteStream(destZipPath);
    const archive = new ZipArchive({ zlib: { level: 6 } });
    output.on("close", () => done());
    output.on("error", (err) => done(err));
    archive.on("error", (err) => done(err));
    archive.pipe(output);

    const info = { ...input.info, sessionCount: countSessions(input.sessionsDir) };
    archive.append(JSON.stringify(info, null, 2), { name: "diagnostics.json" });
    for (const name of listLogs(input.logDir)) {
      archive.append(readTail(path.join(input.logDir, name), LOG_MAX_BYTES), { name: `logs/${name}` });
    }
    void archive.finalize();
  });
}

/** `handover-diagnostics-<timestamp>.zip`, filesystem-safe. */
export function diagnosticsFileName(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/\.\d+Z$/, "Z").replace(/[:]/g, "-");
  return `handover-diagnostics-${stamp}.zip`;
}
