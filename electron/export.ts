// Writes a session as a Handover tester package: a `<slug>__<package_id>.handover/` folder and a
// zip with the same content, next to the path the user chose. The build itself is the pure
// `buildPackage`; this file only reads the session folder and writes bytes.

import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { cp, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ZipArchive } from "archiver";

import { buildPackage, packageFolderName } from "../common/handover/build-package";
import { isoWithOffset, slugify, ulid } from "../common/handover/canonical";
import { readSessionInput } from "../common/handover/read-session";
import type { BuildContext, HelperStatus, SessionEnvironment } from "../common/handover/types";
import { validatePackage } from "../common/handover/validate";
import { createLogger } from "./logger";
import { readReviewedMarker } from "./reviewed-marker";

const log = createLogger("Export");

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
  /** Injected for tests; defaults to {@link validatePackage}. */
  validate?: typeof validatePackage;
  /** Injected for tests. */
  fsOps?: Partial<MoveOps>;
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

/**
 * The zip beside the package folder: `handover-<slug>__<package_id>.zip`. It starts with "handover-" so a
 * tester can find it on a busy Desktop; the folder keeps its `.handover` suffix.
 */
export function packageZipName(folderName: string): string {
  return `handover-${folderName.replace(/\.handover$/, "")}.zip`;
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

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** The file operations {@link moveWithRetry} uses; injected for tests. */
export interface MoveOps {
  rename: (from: string, to: string) => Promise<void>;
  cp: (from: string, to: string) => Promise<void>;
  rm: (p: string) => Promise<void>;
  /** Waits between attempts, in ms. */
  delaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

const BUSY_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

/**
 * Move a file or folder. On Windows a rename can fail with EPERM, EACCES or EBUSY while Defender or
 * an indexer holds a file, so it is retried with a growing wait; if it still fails the item is
 * copied and the source removed (a source that cannot be removed is left for the scratch cleanup).
 */
export async function moveWithRetry(from: string, to: string, ops?: Partial<MoveOps>): Promise<void> {
  const o: MoveOps = {
    rename: ops?.rename ?? ((a, b) => rename(a, b)),
    cp: ops?.cp ?? ((a, b) => cp(a, b, { recursive: true })),
    rm: ops?.rm ?? ((p) => rm(p, { recursive: true, force: true })),
    delaysMs: ops?.delaysMs ?? [50, 100, 200, 400, 800],
    sleep: ops?.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
  };
  let lastError: unknown;
  for (let attempt = 0; attempt <= (o.delaysMs?.length ?? 0); attempt++) {
    try {
      await o.rename(from, to);
      return;
    } catch (err) {
      lastError = err;
      if (!BUSY_CODES.has((err as NodeJS.ErrnoException).code ?? "")) throw err;
      const wait = o.delaysMs?.[attempt];
      if (wait !== undefined) await o.sleep?.(wait);
    }
  }
  try {
    await o.cp(from, to);
  } catch {
    throw lastError;
  }
  await o.rm(from).catch(() => undefined);
}

export async function exportPackage(opts: ExportOptions): Promise<ExportResult> {
  try {
    const now = (opts.now ?? (() => new Date()))();
    const random = opts.random ?? (() => randomBytes(10));
    const { session, edits, narrationSha256 } = await readSessionInput(opts.sessionDir, {
      environment: currentEnvironment(),
      helper: opts.helper ?? { present: false },
      captureBackend: opts.captureBackend ?? "electron-desktop-capturer",
    });
    // The transcript is part of the package. If the bytes used for this build are not the ones the
    // user reviewed, refuse (the check in the IPC and this read are separate moments).
    const marker = await readReviewedMarker(opts.sessionDir);
    if (marker && marker.narration_sha256 !== narrationSha256) {
      return {
        ok: false,
        error: "The narration changed after you finished reviewing. Review the steps again, then export.",
      };
    }
    const timezone = opts.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const ctx: BuildContext = {
      package_id: `pkg_${ulid(now.getTime(), random())}`,
      exported_at: isoWithOffset(now.getTime(), timezone),
      timezone,
      tool_version: opts.toolVersion,
      ...(marker ? { reviewed_at: marker.reviewed_at } : {}),
    };
    const files = await buildPackage(session, edits, ctx);

    const folderName = packageFolderName(session.process.title, ctx.package_id);
    const parent = path.dirname(opts.destZip);
    const folder = path.join(parent, folderName);
    const zip = path.join(parent, packageZipName(folderName));
    await mkdir(parent, { recursive: true });

    // Build and validate in a scratch folder next to the destination, and move the result into
    // place only when it validates: a package that does not validate must leave nothing behind (PKG-8).
    const scratch = path.join(parent, `.handover-export-${randomBytes(6).toString("hex")}`);
    const scratchFolder = path.join(scratch, folderName);
    const scratchZip = path.join(scratch, path.basename(zip));
    let keepScratch = false;
    try {
      for (const [p, bytes] of files) {
        await mkdir(path.dirname(path.join(scratchFolder, p)), { recursive: true });
        await writeFile(path.join(scratchFolder, p), bytes);
      }
      const validation = await (opts.validate ?? validatePackage)(scratchFolder);
      if (!validation.ok) {
        return {
          ok: false,
          packageId: ctx.package_id,
          error: "The package did not validate, so nothing was exported.",
          validationErrors: validation.errors,
        };
      }
      await writeZip(scratchZip, folderName, files, now);
      // The new package is complete. Anything already at the destination is moved aside (and only
      // deleted with the scratch folder at the end), so a failure to place the new one can put it back.
      const aside: { from: string; to: string }[] = [];
      const placed: string[] = []; // only what THIS run put at the destination
      try {
        for (const [dest, label] of [[folder, "old-folder"], [zip, "old-zip"]] as const) {
          if (await exists(dest)) {
            const to = path.join(scratch, label);
            await moveWithRetry(dest, to, opts.fsOps);
            aside.push({ from: to, to: dest });
          }
        }
        // Recorded BEFORE the move: a copy fallback that fails midway leaves a half-written
        // destination, and that is ours to remove (the aside loop already cleared the old one).
        placed.push(folder);
        await moveWithRetry(scratchFolder, folder, opts.fsOps);
        placed.push(zip);
        await moveWithRetry(scratchZip, zip, opts.fsOps);
      } catch (err) {
        for (const p of placed) await rm(p, { recursive: true, force: true }).catch(() => undefined);
        for (const a of aside) {
          try {
            await moveWithRetry(a.from, a.to, opts.fsOps);
          } catch {
            // Never delete the only copy of an earlier export: keep the scratch folder and say where it is.
            keepScratch = true;
            throw new Error(
              `${err instanceof Error ? err.message : String(err)} Your earlier export was kept at ${a.from}.`,
            );
          }
        }
        throw err;
      }
    } finally {
      // Cleanup never changes the result: on Windows an indexer can hold a file for a moment.
      if (!keepScratch) {
        await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch((e: unknown) =>
          log.warn("could not remove the export scratch folder:", e instanceof Error ? e.message : String(e)),
        );
      }
    }

    const manifest = JSON.parse(new TextDecoder().decode(files.get("manifest.json"))) as {
      recording: { step_count: number };
    };
    return {
      ok: true,
      packageId: ctx.package_id,
      folder,
      zip,
      stepCount: manifest.recording.step_count,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

