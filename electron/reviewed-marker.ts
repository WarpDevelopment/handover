// SEC-2 / N4: a package may be exported only after the user finished reviewing it. "Done reviewing" writes
// `reviewed.json` into the session folder with the time, the number of edits at that moment and a hash of
// the session's narration.json (or a note that there was none). Any later edit, or a narration that was
// transcribed or changed after review, makes the marker stale, so the user must look again: the transcript
// is part of the package and was not what they reviewed.
//
// FP reads `reviewed.json` itself for the manifest; the field name `reviewed_at` is fixed.

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const REVIEWED_FILE = "reviewed.json";
const EDITS_FILE = "edits.jsonl";
const NARRATION_FILE = "narration.json";

/** What the narration hash is when the session has no narration.json. */
export const NARRATION_ABSENT = "absent";

export interface ReviewedMarker {
  reviewed_at: string;
  edit_count: number;
  /** `sha256:<hex>` of narration.json at review time, or {@link NARRATION_ABSENT}. */
  narration_sha256: string;
}

async function countEdits(dir: string): Promise<number> {
  try {
    const text = await readFile(path.join(dir, EDITS_FILE), "utf8");
    return text.split("\n").filter((l) => l.trim() !== "").length;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

/** `sha256:<hex>` of narration.json on disk, or {@link NARRATION_ABSENT}. Same format as the review's. */
export async function narrationHash(dir: string): Promise<string> {
  try {
    const bytes = await readFile(path.join(dir, NARRATION_FILE));
    return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return NARRATION_ABSENT;
    throw error;
  }
}

/** Record that review is finished now. */
export async function markReviewed(dir: string, now: () => Date = () => new Date()): Promise<ReviewedMarker> {
  const marker: ReviewedMarker = {
    reviewed_at: now().toISOString(),
    edit_count: await countEdits(dir),
    narration_sha256: await narrationHash(dir),
  };
  await writeFile(path.join(dir, REVIEWED_FILE), JSON.stringify(marker, null, 2));
  return marker;
}

/** The marker, or null when there is none or it is not well formed. */
export async function readReviewedMarker(dir: string): Promise<ReviewedMarker | null> {
  try {
    const m = JSON.parse(await readFile(path.join(dir, REVIEWED_FILE), "utf8")) as Partial<ReviewedMarker>;
    if (typeof m.reviewed_at !== "string" || typeof m.edit_count !== "number") return null;
    // A marker from before the narration hash existed cannot vouch for the transcript.
    if (typeof m.narration_sha256 !== "string") return null;
    return { reviewed_at: m.reviewed_at, edit_count: m.edit_count, narration_sha256: m.narration_sha256 };
  } catch {
    return null;
  }
}

/** True when the marker exists, edits.jsonl has not grown since, and narration.json is what it was. */
export async function isReviewed(dir: string): Promise<boolean> {
  const marker = await readReviewedMarker(dir);
  if (!marker) return false;
  try {
    if ((await countEdits(dir)) > marker.edit_count) return false;
    return (await narrationHash(dir)) === marker.narration_sha256;
  } catch {
    return false;
  }
}
