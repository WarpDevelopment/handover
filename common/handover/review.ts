// The data the review screen shows, taken from a built package so what the reviewer sees is exactly
// what will be exported. Pure: no Electron, no file access.

import type { PackageBytes } from "./types";

export type Rect4 = [number, number, number, number];

export interface ReviewStep {
  /** Step id in the package as it would be exported now (`S01…`). */
  stepId: string;
  /** The id edits refer to: the step's id before any deletions (`tester-package.md`, edits). */
  preEditId: string;
  seq: number;
  kind: "action" | "context" | "manual";
  summary: string;
  /** The summary was edited by the user. */
  summaryEdited: boolean;
  comment: { annotationId: string; text: string } | null;
  highlightCount: number;
  flags: string[];
  /** The image to show: the annotated one when the step has highlights, else the before image. */
  image: { path: string; width: number; height: number } | null;
  /** Blurred regions already burned into the image, in its pixels. */
  blurredFpx: Rect4[];
  /**
   * The picture taken just after the step, on the last step only. It is exported, so it is reviewed
   * as its own item and can be blurred separately (`blur_rect` with `frame: "after"`).
   */
  afterImage: { path: string; width: number; height: number } | null;
  /** Blurred regions already burned into the after image, in its pixels. */
  blurredAfterFpx: Rect4[];
}

export interface ReviewData {
  sessionId: string;
  title: string;
  steps: ReviewStep[];
  /** How many edits are stored for the session. */
  editCount: number;
}

interface StepJson {
  step_id: string;
  seq: number;
  kind: ReviewStep["kind"];
  summary: string;
  summary_provenance: "observed" | "user";
  why?: { text: string; source_annotation_ids: string[] };
  annotation_ids: string[];
  flags: string[];
  before?: {
    full: { path: string; width: number; height: number };
    full_annotated?: { path: string; width: number; height: number };
    redacted_regions_fpx: Rect4[];
  };
  after?: {
    full: { path: string; width: number; height: number };
    redacted_regions_fpx: Rect4[];
  };
}

interface AnnotationJson {
  annotation_id: string;
  kind: string;
}

function jsonl<T>(files: PackageBytes, name: string): T[] {
  const bytes = files.get(name);
  if (!bytes) return [];
  return new TextDecoder()
    .decode(bytes)
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as T);
}

export function reviewDataFrom(args: {
  files: PackageBytes;
  /** Pre-edit id of each output step, in output order. */
  stepIds: readonly string[];
  sessionId: string;
  title: string;
  editCount: number;
}): ReviewData {
  const steps = jsonl<StepJson>(args.files, "steps.jsonl");
  const anns = new Map(jsonl<AnnotationJson>(args.files, "annotations.jsonl").map((a) => [a.annotation_id, a]));
  return {
    sessionId: args.sessionId,
    title: args.title,
    editCount: args.editCount,
    steps: steps.map((s, i) => {
      const img = s.before?.full_annotated ?? s.before?.full;
      const commentId = s.why?.source_annotation_ids[0];
      return {
        stepId: s.step_id,
        preEditId: args.stepIds[i] ?? s.step_id,
        seq: s.seq,
        kind: s.kind,
        summary: s.summary,
        summaryEdited: s.summary_provenance === "user",
        comment: s.why && commentId ? { annotationId: commentId, text: s.why.text } : null,
        highlightCount: s.annotation_ids.filter((id) => anns.get(id)?.kind === "highlight").length,
        flags: s.flags,
        image: img ? { path: img.path, width: img.width, height: img.height } : null,
        blurredFpx: s.before?.redacted_regions_fpx ?? [],
        afterImage: s.after
          ? { path: s.after.full.path, width: s.after.full.width, height: s.after.full.height }
          : null,
        blurredAfterFpx: s.after?.redacted_regions_fpx ?? [],
      };
    }),
  };
}

/** What the review screen can ask for. Ids are the pre-edit ids shown in {@link ReviewStep.preEditId}. */
export type ReviewEditInput =
  | { op: "delete_step"; preEditId: string }
  | { op: "edit_summary"; preEditId: string; text: string }
  | { op: "edit_comment"; annotationId: string; text: string }
  | { op: "blur_rect"; preEditId: string; rectFpx: Rect4; frame?: "before" | "after" };
