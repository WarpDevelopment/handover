import { useCallback, useEffect, useRef, useState } from "react";

import type { NarrationStatus, SessionSummary } from "../common/ipc";
import { formatBytes, formatDur, formatWhen } from "./format";

export function Library() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [narrationStatus, setNarrationStatus] = useState<NarrationStatus | null>(null);

  const loadSessions = useCallback(async () => {
    const list = await window.handover.listSessions();
    const requested = await window.handover.takeLibrarySelection();
    setSessions(list);
    setLoaded(true);
    setSelectedId((prev) => requested && list.some((item) => item.id === requested)
      ? requested : prev ?? list[0]?.id ?? null);
  }, []);

  useEffect(() => {
    void loadSessions();
    return window.handover.onStatusChanged((s) => {
      if (s.state !== "recording") void loadSessions();
    });
  }, [loadSessions]);
  useEffect(() => {
    const offSessions = window.handover.onSessionsChanged(() => { void loadSessions(); });
    const offSelection = window.handover.onLibrarySelection(() => { void loadSessions(); });
    return () => { offSessions(); offSelection(); };
  }, [loadSessions]);

  useEffect(() => {
    void window.handover.narrationStatus().then(setNarrationStatus);
    return window.handover.onNarrationStatusChanged((next) => {
      setNarrationStatus(next);
      if (next.phase === "idle") void loadSessions();
    });
  }, [loadSessions]);

  const deleteSession = useCallback(async (id: string) => {
    setNotice(null);
    const res = await window.handover.deleteSession(id);
    if (!res.ok) {
      setNotice(res.error ?? "Could not delete this recording.");
      return;
    }
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      const next = prev.filter((s) => s.id !== id);
      setSelectedId((cur) => {
        if (cur !== id) return cur;
        if (next.length === 0) return null;
        return (next[idx] ?? next[next.length - 1]).id;
      });
      return next;
    });
  }, []);

  const openFolder = useCallback(async () => {
    setNotice(null);
    const res = await window.handover.openSessionsFolder();
    if (!res.ok) setNotice(res.error ?? "Could not open the recordings folder.");
  }, []);

  const selected = sessions.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="lib">
      <aside className="lib-list">
        <div className="lib-list-head">
          <span className="eyebrow">Sessions</span>
          <span className="pill">{sessions.length}</span>
        </div>
        <button className="linky open-folder" onClick={() => void openFolder()}>
          Open folder
        </button>
        {notice && (
          <button className="sess-notice" onClick={() => setNotice(null)} title="Dismiss">
            {notice}
          </button>
        )}
        <div className="lib-list-scroll">
          <SessionsList
            sessions={sessions}
            loaded={loaded}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onDelete={deleteSession}
          />
        </div>
      </aside>
      <main className="lib-detail">
        {selected ? (
          <SessionDetail
            key={selected.id}
            summary={selected}
            narrationStatus={narrationStatus}
            onChanged={loadSessions}
          />
        ) : (
          <div className="detail-empty">
            <span className="eyebrow">No session selected</span>
            <p>Pick a recording on the left to see what was captured.</p>
          </div>
        )}
      </main>
    </div>
  );
}

/* --- Sessions list -------------------------------------------------------- */

function SessionsList({
  sessions,
  loaded,
  selectedId,
  onSelect,
  onDelete,
}: {
  sessions: SessionSummary[];
  loaded: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void | Promise<void>;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);

  if (sessions.length === 0) {
    return <p className="sessions-empty">{loaded ? "No recordings yet." : "Loading…"}</p>;
  }
  return (
    <ul className="sess-list">
      {sessions.map((s) =>
        confirmId === s.id ? (
          <li key={s.id}>
            <div className="sess-confirm" role="alertdialog" aria-label="Confirm delete">
              <div className="sess-confirm-text">
                <span className="sess-confirm-title">Delete this recording?</span>
                <span className="sess-confirm-sub">
                  This cannot be undone.
                  {s.sizeBytes != null && ` Frees ${formatBytes(s.sizeBytes)} from this device.`}
                </span>
              </div>
              <div className="sess-confirm-actions">
                <button className="linky" onClick={() => setConfirmId(null)}>
                  Cancel
                </button>
                <button
                  className="danger"
                  onClick={() => {
                    setConfirmId(null);
                    void onDelete(s.id);
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </li>
        ) : (
          <li key={s.id}>
            <div className="sess-row">
              <button
                className={`sess ${s.id === selectedId ? "on" : ""}`}
                onClick={() => onSelect(s.id)}
              >
                <div className="sess-top">
                  <span className="sess-when">{formatWhen(s.startedAt)}</span>
                  <span className="sess-tags">
                    {s.processed ? (
                      <span className="tag recorded">recorded</span>
                    ) : (
                      <span className="tag warn">processing</span>
                    )}
                  </span>
                </div>
                <div className="sess-sub">
                  {s.durationMs != null && <span>{formatDur(s.durationMs)}</span>}
                  {s.sizeBytes != null && (
                    <span
                      className="sess-size"
                      title={`${s.sizeBytes.toLocaleString()} bytes used by this recording`}
                    >
                      {formatBytes(s.sizeBytes)}
                    </span>
                  )}
                  {s.hasVideo && <span>video</span>}
                  {s.hasAudio && !s.hasNarration && <span>voice pending</span>}
                  {s.hasNarration && <span>voice</span>}
                </div>
              </button>
              <button
                className="sess-del"
                aria-label={`Delete recording from ${formatWhen(s.startedAt)}`}
                title="Delete recording"
                onClick={() => setConfirmId(s.id)}
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path
                    d="M3 4.5h10M6.4 4.5V3.3c0-.44.36-.8.8-.8h1.6c.44 0 .8.36.8.8v1.2M4.7 4.5l.5 8.2c.02.42.37.75.8.75h4c.42 0 .77-.33.8-.75l.5-8.2"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </li>
        ),
      )}
    </ul>
  );
}

/* --- Session detail ------------------------------------------------------- */

function narrationWorkLabel(status: NarrationStatus | null): string {
  if (!status) return "Working…";
  if (status.phase === "transcribing") return "Transcribing voice…";
  if (status.phase === "loading") return "Preparing voice model…";
  if (status.phase === "downloading") {
    return status.progress == null
      ? "Downloading voice model…"
      : `Downloading voice model… ${status.progress}%`;
  }
  return "Working…";
}

/** What was captured for one recording, plus the debug download and voice transcription. */
function SessionDetail({
  summary,
  narrationStatus,
  onChanged,
}: {
  summary: SessionSummary;
  narrationStatus: NarrationStatus | null;
  onChanged: () => void | Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const voiceBusy =
    narrationStatus?.activeSessionId === summary.id && narrationStatus.phase !== "idle";

  const transcribe = useCallback(async () => {
    setError(null);
    const res = await window.handover.transcribeNarration(summary.id);
    if (!res.ok) setError(res.error ?? "Could not transcribe this recording.");
    await onChanged();
  }, [summary.id, onChanged]);

  return (
    <div className="detail">
      <header className="detail-head">
        <div>
          <span className="eyebrow">Recording</span>
          <h2>{formatWhen(summary.startedAt)}</h2>
        </div>
        <ExportPackageButton sessionId={summary.id} />
        <DebugDownload sessionId={summary.id} />
      </header>
      <dl className="detail-facts">
        <dt>Duration</dt>
        <dd>{summary.durationMs != null ? formatDur(summary.durationMs) : "unknown"}</dd>
        <dt>Size on disk</dt>
        <dd>{summary.sizeBytes != null ? formatBytes(summary.sizeBytes) : "unknown"}</dd>
        <dt>Screen video</dt>
        <dd>{summary.hasVideo ? "saved" : "none"}</dd>
        <dt>Voice narration</dt>
        <dd>
          {summary.hasNarration
            ? `transcribed (${summary.narrationSegmentCount ?? 0} segments)`
            : summary.hasAudio
              ? "recorded, not transcribed yet"
              : "none"}
        </dd>
      </dl>
      {summary.hasAudio && !summary.hasNarration && (
        <div className="detail-actions">
          <button className="record-cta" disabled={voiceBusy} onClick={() => void transcribe()}>
            {voiceBusy ? narrationWorkLabel(narrationStatus) : "Transcribe voice"}
          </button>
        </div>
      )}
      {(error ?? (voiceBusy ? null : narrationStatus?.error)) && (
        <p className="import-error" role="alert">
          {error ?? narrationStatus?.error}
        </p>
      )}
    </div>
  );
}

/* --- Debug download ------------------------------------------------------- */

const DownloadGlyph = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path
      d="M8 2.6v6.2m0 0 2.3-2.3M8 8.8 5.7 6.5"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M3.2 10.4v1.2c0 .6.5 1.1 1.1 1.1h7.4c.6 0 1.1-.5 1.1-1.1v-1.2"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const SavedGlyph = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path
      d="M3.4 8.4 6.3 11.3 12.6 4.8"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** Exports a recording as a Handover package (a folder and a zip) and reports whether it validated. */
function ExportPackageButton({ sessionId }: { sessionId: string }) {
  const [phase, setPhase] = useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  const run = useCallback(async () => {
    setPhase("working");
    setMessage("");
    const res = await window.handover.exportPackage(sessionId);
    if (res.canceled) {
      setPhase("idle");
    } else if (res.ok) {
      setMessage(`Exported ${res.stepCount ?? 0} steps`);
      setPhase("done");
    } else {
      setMessage(res.validationErrors?.[0] ?? res.error ?? "Couldn't export the package.");
      setPhase("error");
    }
  }, [sessionId]);

  return (
    <div className="debug-dl">
      {phase !== "idle" && phase !== "working" && (
        <span className="debug-dl-note" title={message} role="status">
          {phase === "done" ? message : "Couldn't export"}
        </span>
      )}
      <button className="linky" onClick={() => void run()} disabled={phase === "working"}>
        {phase === "working" ? "Exporting…" : "Export package"}
      </button>
    </div>
  );
}

/**
 * Subtle, per-recording "download a debug bundle" affordance shown in the session
 * header. A quiet download icon packages the whole session (private capture data)
 * into a `.zip` the user can hand to us; a privacy-warning modal gates the actual
 * download. It says nothing about where to send the file — that's shared separately.
 */
function DebugDownload({ sessionId }: { sessionId: string }) {
  const [phase, setPhase] = useState<"idle" | "confirm" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);

  const download = useCallback(async () => {
    setPhase("saving");
    setErrorMsg("");
    const res = await window.handover.exportDebugBundle(sessionId);
    if (res.ok) setPhase("saved");
    else if (res.canceled) setPhase("idle");
    else {
      setErrorMsg(res.error ?? "Couldn't create the debug bundle.");
      setPhase("error");
    }
  }, [sessionId]);

  // Let the "Saved" acknowledgement fade back to the quiet icon on its own.
  useEffect(() => {
    if (phase !== "saved") return;
    const t = setTimeout(() => setPhase("idle"), 3200);
    return () => clearTimeout(t);
  }, [phase]);

  // While the warning is up, focus it and close on Escape — matching the app's sheets.
  useEffect(() => {
    if (phase !== "confirm") return;
    dialogRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPhase("idle");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]);

  const label =
    phase === "saving"
      ? "Preparing debug bundle…"
      : phase === "saved"
        ? "Debug bundle saved"
        : "Download details for debugging";

  return (
    <div className="debug-dl">
      {phase === "error" && (
        <span className="debug-dl-note" title={errorMsg}>
          Couldn't save
        </span>
      )}
      <button
        className={`debug-dl-icon${phase === "saved" ? " is-saved" : ""}`}
        onClick={() => setPhase("confirm")}
        disabled={phase === "saving"}
        aria-label={label}
        title={label}
      >
        {phase === "saving" ? (
          <span className="spinner" aria-hidden />
        ) : phase === "saved" ? (
          <SavedGlyph />
        ) : (
          <DownloadGlyph />
        )}
      </button>

      {phase === "confirm" && (
        <div className="sheet-backdrop" onClick={() => setPhase("idle")}>
          <div
            ref={dialogRef}
            className="sheet debug-sheet"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="debug-dl-title"
            aria-describedby="debug-dl-desc"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="sheet-head">
              <span className="sheet-icon" aria-hidden>
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                  <rect
                    x="4.4"
                    y="8.7"
                    width="11.2"
                    height="7.9"
                    rx="1.9"
                    stroke="currentColor"
                    strokeWidth="1.4"
                  />
                  <path
                    d="M6.9 8.7V6.7a3.1 3.1 0 0 1 6.2 0v2"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                  <circle cx="10" cy="12.4" r="1.1" fill="currentColor" />
                </svg>
              </span>
              <h2 id="debug-dl-title">Includes private information</h2>
            </header>

            <p className="sheet-lead" id="debug-dl-desc">
              This bundle is everything captured in this recording — screen video, screenshots,
              visited URLs, clipboard contents, and any voice narration and transcript. Share it
              only with people you trust.
            </p>

            <div className="sheet-actions">
              <button className="linky" onClick={() => setPhase("idle")}>
                Cancel
              </button>
              <button className="record-cta" onClick={() => void download()}>
                Download .zip
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
