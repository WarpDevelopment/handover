// Writes a session as a Handover tester package: a `<slug>__<package_id>.handover/` folder and a
// zip with the same content, next to the path the user chose. The build itself is the pure
// `buildPackage`; this file only reads the session folder and writes bytes.

import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ZipArchive } from "archiver";

import { buildPackage, packageFolderName } from "../common/handover/build-package";
import { isoWithOffset, slugify, ulid } from "../common/handover/canonical";
import { readSessionInput } from "../common/handover/read-session";
import type { BuildContext, HelperStatus, SessionEnvironment } from "../common/handover/types";
import { validatePackage } from "../common/handover/validate";

export interface ExportOptions {
  /** The recorded session folder. */
  sessionDir: string;
  /** The zip path the user chose; the folder is written beside it. */
  destZip: string;
  toolVersion: string;
  helper?: HelperStatus;
  captureBackend?: string;
  /** Injected for tests. */
  now?: () => Date;
  random?: () => Uint8Array;
  timezone?: string;
}

export interface ExportResult {
  ok: boolean;
  packageId?: string;
  folder?: string;
  zip?: string;
  stepCount?: number;
  error?: string;
  /** `validatePackage` messages when the package did not validate. */
  validationErrors?: string[];
}

export function currentEnvironment(): SessionEnvironment {
  return {
    os: process.platform === "win32" ? "windows" : "macos",
    os_version: os.release(),
    arch: os.arch() === "arm64" ? "arm64" : "x64",
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
  };
}

/** Suggested file name for the save dialog; the package id is chosen at export. */
export function suggestedZipName(title: string): string {
  return `${slugify(title)}.zip`;
}

async function writeZip(
  zipPath: string,
  folderName: string,
  files: Map<string, Uint8Array>,
  date: Date,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    out.on("close", () => resolve());
    out.on("error", reject);
    archive.on("error", reject);
    archive.pipe(out);
    // A fixed timestamp keeps the zip bytes stable for a given package.
    for (const [p, bytes] of [...files.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      archive.append(Buffer.from(bytes), { name: `${folderName}/${p}`, date });
    }
    void archive.finalize();
  });
}

export async function exportPackage(opts: ExportOptions): Promise<ExportResult> {
  try {
    const now = (opts.now ?? (() => new Date()))();
    const random = opts.random ?? (() => randomBytes(10));
    const { session, edits } = await readSessionInput(opts.sessionDir, {
      environment: currentEnvironment(),
      helper: opts.helper ?? { present: false },
      captureBackend: opts.captureBackend ?? "electron-desktop-capturer",
    });
    const timezone = opts.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const ctx: BuildContext = {
      package_id: `pkg_${ulid(now.getTime(), random())}`,
      exported_at: isoWithOffset(now.getTime(), timezone),
      timezone,
      tool_version: opts.toolVersion,
    };
    const files = await buildPackage(session, edits, ctx);

    const folderName = packageFolderName(session.process.title, ctx.package_id);
    const parent = path.dirname(opts.destZip);
    const folder = path.join(parent, folderName);
    const zip = path.join(parent, folderName.replace(/\.handover$/, ".zip"));
    await mkdir(parent, { recursive: true });
    await rm(folder, { recursive: true, force: true });
    for (const [p, bytes] of files) {
      await mkdir(path.dirname(path.join(folder, p)), { recursive: true });
      await writeFile(path.join(folder, p), bytes);
    }
    await writeZip(zip, folderName, files, now);

    const validation = await validatePackage(folder);
    const manifest = JSON.parse(new TextDecoder().decode(files.get("manifest.json"))) as {
      recording: { step_count: number };
    };
    return {
      ok: validation.ok,
      packageId: ctx.package_id,
      folder,
      zip,
      stepCount: manifest.recording.step_count,
      ...(validation.ok ? {} : { error: "The package did not validate.", validationErrors: validation.errors }),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

