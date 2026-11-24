// The append-only edit log (`edits.jsonl`). Edits never rewrite recorded data: the builder applies
// them in order when it exports.

import { EDIT_OPS, type Edit } from "./types";

/** An edit the builder cannot apply. Exporting must fail rather than silently skip it. */
export class UnsupportedEditError extends Error {
  readonly op: string;
  constructor(op: string, detail?: string) {
    super(
      `Cannot export: edit "${op}" ${detail ?? "is not supported by this build"}. ` +
        "Refusing to export a package that would ignore a redaction or review edit.",
    );
    this.name = "UnsupportedEditError";
    this.op = op;
  }
}

/** Operations this build applies. Anything else fails closed. */
export const APPLIED_EDIT_OPS: readonly string[] = [
  "delete_step",
  "edit_summary",
  "edit_comment",
  "blur_rect",
];

/** Parse `edits.jsonl`. Throws on a malformed line or an unknown operation. */
export function parseEdits(jsonl: string): Edit[] {
  const edits: Edit[] = [];
  for (const [i, line] of jsonl.split("\n").entries()) {
    if (line.trim() === "") continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new Error(`edits.jsonl line ${i + 1} is not valid JSON`);
    }
    // Reading back: an empty comment saved by an earlier build must not make the session unusable.
    edits.push(assertEdit(raw, { legacy: true }));
  }
  return edits;
}

function isString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/** Every kind of line break: CR, LF, NEL, and the Unicode line and paragraph separators. */
export const LINE_BREAKS = new RegExp(`[\\r\\n${String.fromCharCode(0x85, 0x2028, 0x2029)}]+`, "g");

/**
 * The text of an edited summary or comment: one line, trimmed, never empty. A newline in a summary
 * would put a heading or a fake step into PROCESS.md, and an empty summary fails the schema after
 * the package was written. Every kind of line break (including the Unicode line and paragraph
 * separators) is folded to a space.
 */
export function foldEditText(raw: string, what: "summary" | "comment"): string {
  const folded = raw.replace(LINE_BREAKS, " ").replace(/ {2,}/g, " ").trim();
  if (folded === "") throw new Error(`A ${what} cannot be empty.`);
  return folded;
}

/** Narrow an unknown value to an {@link Edit}; an unknown `op` fails closed. */
export function assertEdit(raw: unknown, opts: { legacy?: boolean } = {}): Edit {
  const e = raw as Record<string, unknown> | null;
  if (!e || typeof e !== "object") throw new Error("edit must be an object");
  const op = e.op;
  if (typeof op !== "string" || !(EDIT_OPS as readonly string[]).includes(op)) {
    throw new UnsupportedEditError(String(op), "is an unknown edit type");
  }
  if (!isString(e.edit_id) || !isString(e.at)) throw new Error(`edit "${op}" needs edit_id and at`);
  switch (op) {
    case "delete_step":
      if (!isString(e.step_id)) throw new Error("delete_step needs step_id");
      break;
    case "edit_summary":
      if (!isString(e.step_id) || typeof e.text !== "string") {
        throw new Error("edit_summary needs step_id and text");
      }
      return { ...e, text: foldEditText(e.text, "summary") } as unknown as Edit;
    case "edit_comment":
      if (!isString(e.annotation_id) || typeof e.text !== "string") {
        throw new Error("edit_comment needs annotation_id and text");
      }
      // New edits must have text. A stored legacy empty comment means "comment removed": the
      // builder drops that comment instead of throwing.
      if (opts.legacy && e.text.trim() === "") return { ...e, text: "" } as unknown as Edit;
      return { ...e, text: foldEditText(e.text, "comment") } as unknown as Edit;
    case "blur_rect": {
      const r = e.rect_fpx;
      if (
        !isString(e.step_id) ||
        !Array.isArray(r) ||
        r.length !== 4 ||
        !r.every((n) => typeof n === "number" && Number.isFinite(n)) ||
        !((r[2] as number) > 0 && (r[3] as number) > 0)
      ) {
        throw new Error("blur_rect needs step_id and rect_fpx [x,y,w,h] with a positive size");
      }
      if (e.frame !== undefined && e.frame !== "before" && e.frame !== "after") {
        throw new Error('blur_rect frame must be "before" or "after"');
      }
      break;
    }
  }
  return e as unknown as Edit;
}

/**
 * Throws {@link UnsupportedEditError} when any edit is one this build cannot apply.
 */
export function assertEditsApplicable(edits: readonly Edit[]): void {
  for (const edit of edits) {
    const op = (edit as { op?: unknown }).op;
    if (typeof op !== "string" || !APPLIED_EDIT_OPS.includes(op)) {
      throw new UnsupportedEditError(String(op));
    }
  }
}
