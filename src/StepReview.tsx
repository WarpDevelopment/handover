// Review a recording before it is exported: a filmstrip of steps, the frame with its marks drawn on,
// and the details of the selected step. The reviewer can fix the summary and the note, delete a step,
// and blur an area. Every change is appended to the recording's edit log (never to the capture
// itself) and the steps are rebuilt, so what is shown is exactly what an export would contain.

import { useCallback, useEffect, useRef, useState } from "react";

import type { ReviewData, ReviewEditInput, ReviewStep } from "../common/handover/review";

type Rect = [number, number, number, number];

/**
 * "Done reviewing": the app records that the user finished, and only then lets the package be
 * exported. The channel is defined by the app side (`sessions:mark-reviewed`); until a build has it
 * the button is not shown, so this screen never calls something that is not there.
 */
type MarkReviewed = (sessionId: string) => Promise<{ ok: boolean; error?: string }>;
function markReviewedFn(): MarkReviewed | null {
  const fn = (window.handover as unknown as { markReviewed?: unknown }).markReviewed;
  return typeof fn === "function" ? (fn as MarkReviewed).bind(window.handover) : null;
}

/** A step image loaded on demand and remembered until the steps are rebuilt. */
function useStepImage(sessionId: string, path: string | undefined, version: number): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setSrc(null);
    if (!path) return;
    void window.handover.reviewImage(sessionId, path).then((url) => {
      if (alive) setSrc(url);
    });
    return () => {
      alive = false;
    };
  }, [sessionId, path, version]);
  return src;
}

function Thumb({ sessionId, step, version }: { sessionId: string; step: ReviewStep; version: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setVisible(true);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  // A small preview: the full pictures of every step must not all be held in this window (APP-9).
  const src = useStepImage(sessionId, visible && step.image ? `thumb/${step.image.path}` : undefined, version);
  return (
    <div ref={ref} className="rv-thumb">
      {src ? <img src={src} alt="" draggable={false} /> : <span>{step.image ? "" : "no image"}</span>}
    </div>
  );
}

export function StepReview({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [data, setData] = useState<ReviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null); // preEditId
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [blurMode, setBlurMode] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const markReviewed = markReviewedFn();

  const doneReviewing = useCallback(async () => {
    const mark = markReviewedFn();
    if (!mark) return;
    setFinishing(true);
    setError(null);
    try {
      const res = await mark(sessionId);
      if (res.ok) onClose();
      else setError(res.error ?? "Could not record that the review is done.");
    } catch {
      setError("Could not record that the review is done.");
    } finally {
      setFinishing(false);
    }
  }, [sessionId, onClose]);

  useEffect(() => {
    let alive = true;
    void window.handover.reviewLoad(sessionId).then((res) => {
      if (!alive) return;
      if (res.ok && res.data) {
        setData(res.data);
        setSelected(res.data.steps[0]?.preEditId ?? null);
      } else {
        setError(res.error ?? "Could not open this recording for review.");
      }
    });
    return () => {
      alive = false;
    };
  }, [sessionId]);

  const step = data?.steps.find((s) => s.preEditId === selected) ?? null;

  /** Append an edit; the steps come back rebuilt. `after` picks what to select next. */
  const edit = useCallback(
    async (input: ReviewEditInput, after?: (next: ReviewData) => string | null): Promise<boolean> => {
      setBusy(true);
      setError(null);
      const res = await window.handover.reviewEdit(sessionId, input);
      setBusy(false);
      if (!res.ok || !res.data) {
        setError(res.error ?? "That change could not be saved.");
        return false;
      }
      setData(res.data);
      setVersion((v) => v + 1);
      if (after) setSelected(after(res.data));
      return true;
    },
    [sessionId],
  );

  const deleteStep = useCallback(async () => {
    if (!data || !step) return;
    const index = data.steps.findIndex((s) => s.preEditId === step.preEditId);
    setConfirmDelete(false);
    await edit({ op: "delete_step", preEditId: step.preEditId }, (next) => {
      // Stay at the same position, or the last step when the last one went.
      return (next.steps[index] ?? next.steps[next.steps.length - 1])?.preEditId ?? null;
    });
  }, [data, step, edit]);

  if (!data) {
    return (
      <div className="rv">
        <header className="rv-head">
          <button className="linky" onClick={onClose}>← Back</button>
        </header>
        {error ? <p className="import-error" role="alert">{error}</p> : <p className="sessions-empty">Loading steps…</p>}
      </div>
    );
  }

  return (
    <div className="rv">
      <header className="rv-head">
        <button className="linky" onClick={onClose}>← Back to recording</button>
        <div className="rv-title">
          <span className="eyebrow">Review</span>
          <h2>{data.title}</h2>
        </div>
        <span className="pill">{data.steps.length} steps</span>
        {markReviewed && (
          <button
            className="record-cta"
            disabled={busy || finishing}
            onClick={() => void doneReviewing()}
            title="Tell Handover you have checked every step. Export is only possible after this."
          >
            Done reviewing
          </button>
        )}
      </header>
      <p className="rv-note">
        Fix anything before you export. Deleting a step or blurring an area changes the export only;
        the recording itself is kept as it was captured.
      </p>
      {error && <p className="import-error" role="alert">{error}</p>}

      {data.steps.length === 0 ? (
        <p className="sessions-empty">This recording has no steps.</p>
      ) : (
        <div className="rv-body">
          <ol className="rv-strip" aria-label="Steps">
            {data.steps.map((s) => (
              <li key={s.preEditId}>
                <button
                  className={`rv-step ${s.preEditId === selected ? "on" : ""}`}
                  onClick={() => {
                    setSelected(s.preEditId);
                    setConfirmDelete(false);
                    setBlurMode(false);
                  }}
                >
                  <Thumb sessionId={sessionId} step={s} version={version} />
                  <span className="rv-step-text">
                    <strong>{s.stepId}</strong>
                    <span>{s.summary}</span>
                    <span className="rv-badges">
                      {s.comment && <span className="tag recorded">note</span>}
                      {s.highlightCount > 0 && <span className="tag recorded">{s.highlightCount} marked</span>}
                      {s.flags.includes("contains_redaction") && <span className="tag warn">blurred</span>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>

          {step && (
            <StepDetail
              key={`${step.preEditId}:${version}`}
              sessionId={sessionId}
              step={step}
              version={version}
              busy={busy}
              blurMode={blurMode}
              setBlurMode={setBlurMode}
              confirmDelete={confirmDelete}
              setConfirmDelete={setConfirmDelete}
              onSummary={(text) => edit({ op: "edit_summary", preEditId: step.preEditId, text })}
              onComment={(text) =>
                step.comment ? edit({ op: "edit_comment", annotationId: step.comment.annotationId, text }) : Promise.resolve(false)
              }
              onBlur={(rectFpx, frame) =>
                edit({
                  op: "blur_rect",
                  preEditId: step.preEditId,
                  rectFpx,
                  ...(frame === "after" ? { frame } : {}),
                })
              }
              onDelete={() => void deleteStep()}
            />
          )}
        </div>
      )}
    </div>
  );
}

function StepDetail(props: {
  sessionId: string;
  step: ReviewStep;
  version: number;
  busy: boolean;
  blurMode: boolean;
  setBlurMode: (on: boolean) => void;
  confirmDelete: boolean;
  setConfirmDelete: (on: boolean) => void;
  onSummary: (text: string) => Promise<boolean>;
  onComment: (text: string) => Promise<boolean>;
  onBlur: (rect: Rect, frame: "before" | "after") => Promise<boolean>;
  onDelete: () => void;
}) {
  const { step, busy } = props;
  // The last step is exported with a second picture, taken just after it. It is reviewed here as its
  // own item, so a private value on it can be blurred like on the first picture (SEC-1).
  const [frame, setFrame] = useState<"before" | "after">("before");
  const shown = frame === "after" && step.afterImage ? step.afterImage : step.image;
  const src = useStepImage(props.sessionId, shown?.path, props.version);
  const [summary, setSummary] = useState(step.summary);
  const [comment, setComment] = useState(step.comment?.text ?? "");

  return (
    <section className="rv-detail" aria-label={`Step ${step.stepId}`}>
      <div className="rv-frame-wrap">
        {step.afterImage && (
          <div className="rv-tools" role="group" aria-label="Which picture">
            <button
              className={frame === "before" ? "record-cta" : "linky"}
              disabled={busy || props.blurMode}
              onClick={() => setFrame("before")}
            >
              Before the click
            </button>
            <button
              className={frame === "after" ? "record-cta" : "linky"}
              disabled={busy || props.blurMode}
              onClick={() => setFrame("after")}
            >
              After (exported too)
            </button>
          </div>
        )}
        {shown && src ? (
          <BlurFrame
            key={shown.path}
            src={src}
            natural={[shown.width, shown.height]}
            enabled={props.blurMode}
            busy={busy}
            onApply={async (rect) => {
              const ok = await props.onBlur(rect, frame === "after" && step.afterImage ? "after" : "before");
              if (ok) props.setBlurMode(false);
            }}
            onCancel={() => props.setBlurMode(false)}
          />
        ) : (
          <div className="rv-noimage">{shown ? "Loading the picture…" : "This step has no picture."}</div>
        )}
      </div>

      <div className="rv-fields">
        <div className="rv-tools">
          <button
            className="linky"
            disabled={!step.image || busy || props.blurMode}
            onClick={() => props.setBlurMode(true)}
            title="Draw a box over anything private, such as a name or an account number"
          >
            Blur an area
          </button>
          {props.confirmDelete ? (
            <span className="rv-confirm">
              Delete {step.stepId}?{" "}
              <button className="danger" disabled={busy} onClick={props.onDelete}>Delete step</button>{" "}
              <button className="linky" onClick={() => props.setConfirmDelete(false)}>Keep it</button>
            </span>
          ) : (
            <button className="linky" disabled={busy} onClick={() => props.setConfirmDelete(true)}>
              Delete step
            </button>
          )}
        </div>
        {props.blurMode && (
          <p className="rv-hint">Drag a box over the part to hide, then press “Blur this area”.</p>
        )}

        <label htmlFor="rv-summary">What happened in this step</label>
        <textarea
          id="rv-summary"
          rows={2}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
        <div className="rv-save-row">
          {step.summaryEdited && <span className="rv-edited">edited</span>}
          <button
            className="record-cta"
            disabled={busy || summary.trim() === "" || summary.trim() === step.summary}
            onClick={() => void props.onSummary(summary)}
          >
            Save wording
          </button>
        </div>

        {step.comment ? (
          <>
            <label htmlFor="rv-comment">Note from the recording</label>
            <textarea id="rv-comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
            <div className="rv-save-row">
              <button
                className="record-cta"
                disabled={busy || comment === step.comment.text}
                onClick={() => void props.onComment(comment)}
              >
                Save note
              </button>
            </div>
          </>
        ) : (
          <p className="rv-hint">No note on this step. Use Explain while recording to add one.</p>
        )}
        {step.blurredFpx.length > 0 && (
          <p className="rv-hint">{step.blurredFpx.length} area(s) on this step are blurred in the export.</p>
        )}
        {step.blurredAfterFpx.length > 0 && (
          <p className="rv-hint">
            {step.blurredAfterFpx.length} area(s) on the picture after this step are blurred in the export.
          </p>
        )}
      </div>
    </section>
  );
}

/** The step picture. In blur mode, dragging draws a box; the box is sent in the picture's own pixels. */
function BlurFrame(props: {
  src: string;
  natural: [number, number];
  enabled: boolean;
  busy: boolean;
  onApply: (rectFpx: Rect) => Promise<void>;
  onCancel: () => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [box, setBox] = useState<Rect | null>(null); // CSS px inside the displayed image
  const start = useRef<[number, number] | null>(null);

  useEffect(() => {
    if (!props.enabled) setBox(null);
  }, [props.enabled]);

  const local = (e: React.PointerEvent): [number, number] => {
    const r = imgRef.current?.getBoundingClientRect();
    if (!r) return [0, 0];
    return [Math.min(r.width, Math.max(0, e.clientX - r.left)), Math.min(r.height, Math.max(0, e.clientY - r.top))];
  };

  const apply = () => {
    const img = imgRef.current;
    if (!img || !box) return;
    const k = props.natural[0] / img.getBoundingClientRect().width;
    void props.onApply([Math.round(box[0] * k), Math.round(box[1] * k), Math.round(box[2] * k), Math.round(box[3] * k)]);
  };

  return (
    <div className={`rv-frame ${props.enabled ? "blurring" : ""}`}>
      <img ref={imgRef} src={props.src} alt="The screen at this step" draggable={false} />
      {props.enabled && (
        <div
          className="rv-blur-layer"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            start.current = local(e);
            setBox(null);
          }}
          onPointerMove={(e) => {
            if (!start.current) return;
            const [x0, y0] = start.current;
            const [x1, y1] = local(e);
            setBox([Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)]);
          }}
          onPointerUp={() => {
            start.current = null;
          }}
        >
          {box && (
            <div
              className="rv-blur-box"
              style={{ left: box[0], top: box[1], width: box[2], height: box[3] }}
            />
          )}
        </div>
      )}
      {props.enabled && (
        <div className="rv-blur-actions">
          <button className="record-cta" disabled={props.busy || !box || box[2] < 4 || box[3] < 4} onClick={apply}>
            Blur this area
          </button>
          <button className="linky" onClick={props.onCancel}>Cancel</button>
        </div>
      )}
    </div>
  );
}
