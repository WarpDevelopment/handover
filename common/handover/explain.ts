// What the freeze overlay hands to the recorder, and the checks applied to it in the main process.
// The overlay renderer is not trusted: shapes are clamped to the display and counts are capped.

export type ExplainShape = "rect" | "arrow" | "highlighter" | "freehand";

export type ExplainAnnotationInput =
  | {
      kind: "highlight";
      /** Electron `Display.id` the shape was drawn on. */
      displayId: number;
      shape: ExplainShape;
      /** Points in display physical px. */
      pointsDpx: [number, number][];
    }
  | { kind: "comment"; text: string };

export interface ExplainResult {
  /** The user pressed Esc or Cancel: nothing is saved. */
  cancelled: boolean;
  annotations: ExplainAnnotationInput[];
}

export const MAX_SHAPES = 200;
export const MAX_POINTS = 600;
export const MAX_COMMENT_CHARS = 4000;

const SHAPES: readonly string[] = ["rect", "arrow", "highlighter", "freehand"];

function isPoint(p: unknown): p is [number, number] {
  return (
    Array.isArray(p) && p.length === 2 && typeof p[0] === "number" && typeof p[1] === "number" &&
    Number.isFinite(p[0]) && Number.isFinite(p[1])
  );
}

/**
 * Validate an overlay result. `displays` maps each frozen display's Electron id to its physical
 * size. Unknown displays, malformed shapes and empty comments are dropped, points are clamped to
 * the display, and counts are capped. Never throws.
 */
export function sanitizeExplainResult(
  raw: unknown,
  displays: ReadonlyMap<number, [number, number]>,
): ExplainResult {
  const r = (raw ?? {}) as { cancelled?: unknown; annotations?: unknown };
  if (r.cancelled === true) return { cancelled: true, annotations: [] };
  const list = Array.isArray(r.annotations) ? r.annotations : [];
  const out: ExplainAnnotationInput[] = [];
  let shapes = 0;
  for (const item of list) {
    const a = (item ?? {}) as Record<string, unknown>;
    if (a.kind === "comment") {
      if (typeof a.text !== "string") continue;
      const text = a.text.trim().slice(0, MAX_COMMENT_CHARS);
      if (text) out.push({ kind: "comment", text });
    } else if (a.kind === "highlight") {
      if (shapes >= MAX_SHAPES) continue;
      const size = typeof a.displayId === "number" ? displays.get(a.displayId) : undefined;
      if (!size || typeof a.shape !== "string" || !SHAPES.includes(a.shape)) continue;
      if (!Array.isArray(a.pointsDpx) || !a.pointsDpx.every(isPoint)) continue;
      const shape = a.shape as ExplainShape;
      const pts = (a.pointsDpx as [number, number][]).slice(0, MAX_POINTS).map(
        (p): [number, number] => [
          Math.min(size[0], Math.max(0, Math.round(p[0]))),
          Math.min(size[1], Math.max(0, Math.round(p[1]))),
        ],
      );
      if (shape === "rect" || shape === "arrow") {
        if (pts.length !== 2) continue;
      } else if (pts.length < 2) continue;
      shapes++;
      out.push({ kind: "highlight", displayId: a.displayId as number, shape, pointsDpx: pts });
    }
  }
  return { cancelled: false, annotations: out };
}
