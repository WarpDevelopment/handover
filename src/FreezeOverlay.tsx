// The Explain overlay: one full-screen window per display showing that display's frozen frame.
// The user picks a tool (Box, Arrow, Highlighter, Pen), draws on anything on screen and types a
// note. Enter saves, Esc cancels. Shapes are drawn in CSS px and saved in the display's physical
// pixels with the display's scale factor (common/handover/overlay-geometry.ts).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ExplainAnnotationInput, ExplainShape } from "../common/handover/explain";
import { cssToDpx, thinPoints } from "../common/handover/overlay-geometry";
import type { FreezeInit } from "../common/ipc";

type Point = [number, number];
interface Shape {
  shape: ExplainShape;
  /** Points in CSS px of this overlay window. */
  points: Point[];
}

const RED = "#E5484D";
const YELLOW = "#FFD60A";
const MIN_DRAG_PX = 4;
const MAX_STROKE_POINTS = 400;

const TOOLS: { id: ExplainShape; label: string; hint: string }[] = [
  { id: "rect", label: "Box", hint: "Draw a box around something" },
  { id: "arrow", label: "Arrow", hint: "Point at something with an arrow" },
  { id: "highlighter", label: "Highlighter", hint: "Highlight text or an area" },
  { id: "freehand", label: "Pen", hint: "Draw freely" },
];

function ToolGlyph({ tool }: { tool: ExplainShape }) {
  const common = { width: 18, height: 18, viewBox: "0 0 18 18", fill: "none", "aria-hidden": true } as const;
  const stroke = { stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  switch (tool) {
    case "rect":
      return (<svg {...common}><rect x="3" y="4" width="12" height="10" rx="1.5" {...stroke} /></svg>);
    case "arrow":
      return (<svg {...common}><path d="M3.5 14.5 14 4m0 0H8.2M14 4v5.8" {...stroke} /></svg>);
    case "highlighter":
      return (<svg {...common}><path d="m10.5 3.5 4 4-6 6H4.5v-4l6-6ZM3 15.5h12" {...stroke} /></svg>);
    case "freehand":
      return (<svg {...common}><path d="M3 12.5c2-5 3.5-6.5 5-4s2.5 4 4.5.5 2.5-3 2.5-3" {...stroke} /></svg>);
  }
}

/** Draw one shape the way the exported image will show it (fixed colours and widths). */
function drawShape(ctx: CanvasRenderingContext2D, s: Shape, mark: string | null): void {
  const pts = s.points;
  if (pts.length < 2) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (s.shape === "rect") {
    const [a, b] = [pts[0], pts[pts.length - 1]];
    ctx.strokeStyle = RED;
    ctx.lineWidth = 3;
    ctx.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
  } else if (s.shape === "arrow") {
    const [a, b] = [pts[0], pts[pts.length - 1]];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const head = Math.min(12, len);
    const bx = b[0] - ux * head;
    const by = b[1] - uy * head;
    ctx.strokeStyle = RED;
    ctx.fillStyle = RED;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(b[0], b[1]);
    ctx.lineTo(bx - uy * (head / 2), by + ux * (head / 2));
    ctx.lineTo(bx + uy * (head / 2), by - ux * (head / 2));
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.strokeStyle = s.shape === "highlighter" ? YELLOW : RED;
    ctx.globalAlpha = s.shape === "highlighter" ? 0.4 : 1;
    ctx.lineWidth = s.shape === "highlighter" ? 14 : 3;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
    ctx.stroke();
  }
  ctx.restore();
  if (mark) {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const left = Math.min(...xs);
    const top = Math.max(0, Math.min(...ys) - 1.5 - 20);
    ctx.save();
    ctx.font = "700 13px system-ui, sans-serif";
    const w = ctx.measureText(mark).width + 10;
    ctx.fillStyle = RED;
    ctx.fillRect(left, top, w, 20);
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    ctx.fillText(mark, left + 5, top + 10.5);
    ctx.restore();
  }
}

export function FreezeOverlay() {
  const [init, setInit] = useState<FreezeInit | null>(null);
  const [tool, setTool] = useState<ExplainShape>("rect");
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef<Shape | null>(null);

  useEffect(() => {
    document.body.dataset.route = "freeze";
    void window.handover.freezeInit().then(setInit);
  }, []);

  // What would be saved from this display, in display physical pixels.
  const annotations = useMemo<ExplainAnnotationInput[]>(() => {
    if (!init) return [];
    const geo = { scaleFactor: init.scaleFactor, sizeDpx: init.sizeDpx };
    const out: ExplainAnnotationInput[] = shapes.map((s) => ({
      kind: "highlight",
      displayId: init.displayId,
      shape: s.shape,
      pointsDpx: s.points.map((p) => cssToDpx(p, geo)),
    }));
    if (comment.trim()) out.push({ kind: "comment", text: comment });
    return out;
  }, [init, shapes, comment]);

  // Tell the main process what is drawn so far, so Done on any display saves every display.
  useEffect(() => {
    if (init) window.handover.freezeState({ cancelled: false, annotations });
  }, [init, annotations]);

  // Draw the committed shapes and the one being drawn. The canvas is never cleared by typing.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !init) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(init.cssSize[0] * dpr);
    canvas.height = Math.round(init.cssSize[1] * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, init.cssSize[0], init.cssSize[1]);
    shapes.forEach((s, i) => drawShape(ctx, s, `H${i + 1}`));
    if (draft) drawShape(ctx, draft, null);
  }, [init, shapes, draft]);

  const done = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    // The newest state is sent first; the invoke that follows is handled after it, in order.
    window.handover.freezeState({ cancelled: false, annotations });
    const res = await window.handover.freezeDone();
    if (!res.ok) {
      setError(res.error ?? "Could not save.");
      setBusy(false);
    }
  }, [annotations, busy]);

  const cancel = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    await window.handover.freezeCancel();
  }, [busy]);

  // Esc cancels and Enter saves, wherever the focus is (the main process also catches Esc).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        void cancel();
      } else if (e.key === "Enter" && !e.shiftKey && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        void done();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancel, done]);

  const point = (e: React.PointerEvent): Point => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  // The stroke being drawn lives in a ref, so finishing it never depends on when React renders.
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = point(e);
    draftRef.current = { shape: tool, points: [p, p] };
    setDraft(draftRef.current);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = draftRef.current;
    if (!d) return;
    const p = point(e);
    draftRef.current =
      d.shape === "rect" || d.shape === "arrow"
        ? { ...d, points: [d.points[0], p] }
        : { ...d, points: [...d.points, p] };
    setDraft(draftRef.current);
  };
  const onPointerUp = () => {
    const d = draftRef.current;
    if (!d) return;
    draftRef.current = null;
    setDraft(null);
    const first = d.points[0];
    const last = d.points[d.points.length - 1];
    if (Math.hypot(last[0] - first[0], last[1] - first[1]) >= MIN_DRAG_PX) {
      const points: Point[] =
        d.shape === "rect" || d.shape === "arrow" ? [first, last] : thinPoints(d.points, MAX_STROKE_POINTS);
      setShapes((s) => [...s, { shape: d.shape, points }]);
    }
    // Back to the note, so typing goes on right after drawing.
    noteRef.current?.focus();
  };

  if (!init) return <div className="freeze" />;
  const multi = init.count > 1;

  return (
    <div className="freeze" style={{ width: init.cssSize[0], height: init.cssSize[1] }}>
      <img
        className="freeze-frame"
        src={init.frame}
        width={init.cssSize[0]}
        height={init.cssSize[1]}
        alt=""
        draggable={false}
        onLoad={() => window.handover.freezeReady()}
      />
      <canvas
        ref={canvasRef}
        className="freeze-canvas"
        style={{ width: init.cssSize[0], height: init.cssSize[1] }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />

      <div className="freeze-toolbar" role="toolbar" aria-label="Drawing tools">
        <span className="freeze-title">
          Explain{multi ? ` · screen ${init.index} of ${init.count}` : ""}
        </span>
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`freeze-tool ${tool === t.id ? "on" : ""}`}
            aria-pressed={tool === t.id}
            title={t.hint}
            onClick={() => {
              setTool(t.id);
              noteRef.current?.focus();
            }}
          >
            <ToolGlyph tool={t.id} />
            <span>{t.label}</span>
          </button>
        ))}
        <span className="freeze-sep" aria-hidden />
        <button
          className="freeze-tool"
          disabled={shapes.length === 0}
          title="Remove the last mark"
          onClick={() => {
            setShapes((s) => s.slice(0, -1));
            noteRef.current?.focus();
          }}
        >
          <span>Undo</span>
        </button>
        <button
          className="freeze-tool"
          disabled={shapes.length === 0}
          title="Remove every mark on this screen"
          onClick={() => {
            setShapes([]);
            noteRef.current?.focus();
          }}
        >
          <span>Clear</span>
        </button>
      </div>

      <section className="freeze-card" aria-label="Add a note">
        <label htmlFor="freeze-note">Add a note for whoever reads this (optional)</label>
        <textarea
          id="freeze-note"
          ref={noteRef}
          autoFocus
          rows={3}
          maxLength={4000}
          value={comment}
          placeholder="For example: always check this total before sending."
          onChange={(e) => setComment(e.target.value)}
        />
        {error && <p className="freeze-error" role="alert">{error}</p>}
        <div className="freeze-actions">
          <span className="freeze-keys">Enter to save · Shift+Enter for a new line · Esc to cancel</span>
          <button className="freeze-cancel" disabled={busy} onClick={() => void cancel()}>
            Cancel
          </button>
          <button className="freeze-save" disabled={busy} onClick={() => void done()}>
            {busy ? "Saving…" : "Done"}
          </button>
        </div>
      </section>
    </div>
  );
}
