// Reads a recorded session folder into the `SessionInput` that `buildPackage` consumes.
// Plain `node:fs`, no Electron, so tests and the exporter share it.

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { NarrationTranscript } from "../narration";
import type { RecEvent, SessionMeta } from "../types";
import { sha256Hex, slugify } from "./canonical";
import { parseEdits } from "./edits";
import { HELPER_FILE, parseHelperStatus } from "./helper";
import type {
  Edit,
  HelperStatus,
  ProcessInfo,
  SessionEnvironment,
  SessionInput,
  ShotEntry,
} from "./types";

export const SHOTS_FILE = "shots.json";
export const SHOTS_DIR = "shots";
export const PROCESS_FILE = "process.json";
export const EDITS_FILE = "edits.jsonl";

async function readOptional(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export function defaultProcessInfo(meta: SessionMeta): ProcessInfo {
  return {
    title: `Recorded process ${meta.id}`,
    goal: "",
    done_when: "",
    trigger: { kind: "unknown", text: "" },
    position: "unknown",
  };
}

/** Merge the optional `process.json` (the start sheet) over the defaults. */
function mergeProcess(meta: SessionMeta, raw: string | null): ProcessInfo {
  const base = defaultProcessInfo(meta);
  if (!raw) return base;
  const p = JSON.parse(raw) as Partial<ProcessInfo>;
  const title = typeof p.title === "string" && p.title.trim() ? p.title.trim() : base.title;
  return {
    title,
    goal: typeof p.goal === "string" ? p.goal : "",
    done_when: typeof p.done_when === "string" ? p.done_when : "",
    trigger: {
      kind: p.trigger?.kind ?? "unknown",
      text: typeof p.trigger?.text === "string" ? p.trigger.text : "",
    },
    position: typeof p.position === "string" && p.position.trim() ? p.position.trim() : "unknown",
  };
}

export async function readSessionInput(
  dir: string,
  extras: {
    environment: SessionEnvironment;
    helper: HelperStatus;
    captureBackend: string;
  },
): Promise<{ session: SessionInput; edits: Edit[]; narrationSha256: string }> {
  const meta = JSON.parse(await readFile(path.join(dir, "session.json"), "utf8")) as SessionMeta;
  const eventsRaw = (await readOptional(path.join(dir, "events.jsonl"))) ?? "";
  const events = eventsRaw
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as RecEvent);
  const shotsRaw = await readOptional(path.join(dir, SHOTS_FILE));
  const shots = shotsRaw ? (JSON.parse(shotsRaw) as ShotEntry[]) : [];
  const files = new Map<string, Uint8Array>();
  for (const s of shots) {
    if (s.file.includes("..") || path.isAbsolute(s.file)) continue; // stay inside the session
    try {
      files.set(s.file, await readFile(path.join(dir, s.file)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  // The exact bytes the build uses are hashed, so the export can check them against what the user reviewed.
  let narrationBytes: Buffer | null = null;
  try {
    narrationBytes = await readFile(path.join(dir, "narration.json"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const narrationRaw = narrationBytes ? narrationBytes.toString("utf8") : null;
  const narrationSha256 = narrationBytes ? `sha256:${sha256Hex(narrationBytes)}` : "absent";
  const narration = narrationRaw
    ? ((JSON.parse(narrationRaw) as NarrationTranscript).segments ?? [])
    : [];
  const process = mergeProcess(meta, await readOptional(path.join(dir, PROCESS_FILE)));
  const edits = parseEdits((await readOptional(path.join(dir, EDITS_FILE))) ?? "");
  // The helper status saved when the recording stopped wins over the caller's fallback.
  const helperRaw = await readOptional(path.join(dir, HELPER_FILE));
  const helper = helperRaw ? parseHelperStatus(helperRaw) : extras.helper;
  return {
    session: { meta, events, shots, files, narration, process, ...extras, helper },
    edits,
    narrationSha256,
  };
}

/** The slug used in the exported folder and zip name. */
export function exportSlug(title: string): string {
  return slugify(title);
}
