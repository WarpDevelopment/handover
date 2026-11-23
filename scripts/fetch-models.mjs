#!/usr/bin/env node
// Fetches the bundled narration model (Xenova/whisper-small, q8) into
// extraResources/models and pins every file by SHA-256. Exits non-zero if any
// file is missing or its hash does not match scripts/narration-models.json.
//
//   node scripts/fetch-models.mjs            download missing files, verify all
//   node scripts/fetch-models.mjs --verify   verify only, never touch the network
//
// Used by `npm run models:fetch` locally and by the CI workflows, so the Mac and
// Windows builds bundle byte-identical weights.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, readFileSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const manifestPath = path.join(here, "narration-models.json");
export const defaultOutDir = path.resolve(here, "..", "extraResources", "models");

export function readManifest(file = manifestPath) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function fileUrl(manifest, relPath) {
  return `https://huggingface.co/${manifest.repo}/resolve/${manifest.revision}/${relPath}`;
}

export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });
}

/** Where a manifest file lands: <outDir>/<model id>/<file>. Matches narrationModelCacheDir(). */
export function targetPath(outDir, manifest, relPath) {
  return path.join(outDir, ...manifest.model.split("/"), ...relPath.split("/"));
}

/** Returns an array of problems; empty means every pinned file is present and matches. */
export async function verifyAll(outDir, manifest) {
  const problems = [];
  for (const entry of manifest.files) {
    const target = targetPath(outDir, manifest, entry.path);
    if (!existsSync(target)) {
      problems.push(`${entry.path}: missing`);
      continue;
    }
    const actual = await sha256File(target);
    if (actual !== entry.sha256) {
      problems.push(`${entry.path}: sha256 mismatch (expected ${entry.sha256}, got ${actual})`);
    }
  }
  return problems;
}

async function download(url, target, expectedSha) {
  await mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.part`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`GET ${url} -> ${res.status}`);
  try {
    await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
    const actual = await sha256File(tmp);
    if (actual !== expectedSha) {
      throw new Error(`sha256 mismatch for ${url}: expected ${expectedSha}, got ${actual}`);
    }
    await rename(tmp, target);
  } finally {
    await rm(tmp, { force: true });
  }
}

export async function fetchAll(outDir, manifest) {
  for (const entry of manifest.files) {
    const target = targetPath(outDir, manifest, entry.path);
    if (existsSync(target) && (await sha256File(target)) === entry.sha256) {
      console.log(`ok      ${entry.path}`);
      continue;
    }
    console.log(`fetch   ${entry.path} (${entry.bytes} bytes)`);
    await download(fileUrl(manifest, entry.path), target, entry.sha256);
  }
}

async function main() {
  const verifyOnly = process.argv.includes("--verify");
  const outArg = process.argv.find((a) => a.startsWith("--out="));
  const outDir = outArg ? path.resolve(outArg.slice("--out=".length)) : defaultOutDir;
  const manifest = readManifest();
  if (!verifyOnly) await fetchAll(outDir, manifest);
  const problems = await verifyAll(outDir, manifest);
  if (problems.length > 0) {
    console.error(`Narration model check FAILED in ${outDir}:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`Narration model verified: ${manifest.files.length} files in ${outDir}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
