// SEC-2: a package may be exported only after the user finished reviewing it. "Done reviewing" writes
// `reviewed.json` into the session folder with the time and the number of edits at that moment; any
// later edit (edits.jsonl grows) makes the marker stale, so the user must look again.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const REVIEWED_FILE = "reviewed.json";
const EDITS_FILE = "edits.jsonl";

export interface ReviewedMarker {
  reviewed_at: string;
  edit_count: number;
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

/** Record that review is finished now. */
export async function markReviewed(dir: string, now: () => Date = () => new Date()): Promise<ReviewedMarker> {
  const marker: ReviewedMarker = { reviewed_at: now().toISOString(), edit_count: await countEdits(dir) };
  await writeFile(path.join(dir, REVIEWED_FILE), JSON.stringify(marker, null, 2));
  return marker;
}

/** True when the marker exists and edits.jsonl has not grown since it was written. */
export async function isReviewed(dir: string): Promise<boolean> {
  let marker: Partial<ReviewedMarker>;
  try {
    marker = JSON.parse(await readFile(path.join(dir, REVIEWED_FILE), "utf8")) as Partial<ReviewedMarker>;
  } catch {
    return false;
  }
  if (typeof marker.reviewed_at !== "string" || typeof marker.edit_count !== "number") return false;
  try {
    return (await countEdits(dir)) <= marker.edit_count;
  } catch {
    return false;
  }
}
