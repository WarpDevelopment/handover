import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type {
  DoctorReport,
  MicrophoneSettingsStatus,
  NarrationStatus,
  RecorderStatus,
  ScreenSettingsStatus,
  SensitiveModelStatus,
} from "../common/ipc";
import {
  DEFAULT_NARRATION_LANGUAGE,
  isNarrationLanguage,
  NARRATION_LANGUAGES,
  narrationLanguageLabel,
  type NarrationLanguage,
} from "../common/narration";
import { formatMs } from "./format";
import { RecordingPrivacyWarning } from "./RecordingPrivacyWarning";
import { WhatsRecorded } from "./WhatsRecorded";

const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
/** Mirrors the main-process global shortcut "CommandOrControl+Shift+R", per OS. */
const TOGGLE_SHORTCUT = IS_MAC ? "⌘⇧R" : "Ctrl+Shift+R";
type PrivacyReviewOrigin = "home" | "warning";

/** The HUD fills the window (`height:100vh`), so its own box can't reveal how tall the
 *  content actually is. Sum the in-flow children (skipping absolute/fixed overlays like
 *  scrims, popovers and the privacy sheet) to get the natural content height the window
 *  should shrink/grow to. */
function measureHudHeight(hud: HTMLElement): number {
  const style = getComputedStyle(hud);
  const gap = parseFloat(style.rowGap || style.gap) || 0;
  let total = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
  let inFlow = 0;
  for (const child of Array.from(hud.children)) {
    if (!(child instanceof HTMLElement)) continue;
    const cs = getComputedStyle(child);
    if (cs.position === "absolute" || cs.position === "fixed" || cs.display === "none") continue;
    total += child.getBoundingClientRect().height;
    inFlow += 1;
  }
  if (inFlow > 1) total += gap * (inFlow - 1);
  return Math.ceil(total);
}

export function Recorder() {
  const [status, setStatus] = useState<RecorderStatus | null>(null);
  const [doctor, setDoctor] = useState<DoctorReport | null>(null);
  const [narrationStatus, setNarrationStatus] = useState<NarrationStatus | null>(null);
  const [microphoneSettings, setMicrophoneSettings] =
    useState<MicrophoneSettingsStatus | null>(null);
  const [screenSettings, setScreenSettings] =
    useState<ScreenSettingsStatus | null>(null);
  const [privacyReviewOrigin, setPrivacyReviewOrigin] =
    useState<PrivacyReviewOrigin | null>(null);
  const [showRecordingWarning, setShowRecordingWarning] = useState(false);
  const [warningStarting, setWarningStarting] = useState(false);
  const [showNarrationSettings, setShowNarrationSettings] = useState(false);
  const [narrationLanguage, setSelectedNarrationLanguage] =
    useState<NarrationLanguage>(DEFAULT_NARRATION_LANGUAGE);
  const [sensitive, setSensitive] = useState<SensitiveModelStatus | null>(null);
  const [advancedPending, setAdvancedPending] = useState(false);
  const [microphonePending, setMicrophonePending] = useState(false);
  const [microphoneActionError, setMicrophoneActionError] = useState<string | null>(null);
  const [screenPending, setScreenPending] = useState(false);
  const [screenActionError, setScreenActionError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [sessionCount, setSessionCount] = useState(0);
  const narrationSettingsRef = useRef<HTMLElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(async () => {
    const list = await window.handover.listSessions();
    setSessionCount(list.length);
  }, []);

  const applyRecorderStatus = useCallback((next: RecorderStatus) => {
    setStatus(next);
    setSelectedNarrationLanguage(next.narrationLanguage);
  }, []);
  useEffect(() => window.handover.onSessionsChanged(() => { void refreshCount(); }), [refreshCount]);

  useEffect(() => {
    void window.handover.status().then(applyRecorderStatus);
    void window.handover.doctor().then(setDoctor);
    void window.handover.narrationStatus().then(setNarrationStatus);
    void window.handover.microphoneSettings().then(setMicrophoneSettings);
    void window.handover.screenSettings().then(setScreenSettings);
    void window.handover.sensitiveModelStatus().then(setSensitive);
    void refreshCount();
    const offRecorder = window.handover.onStatusChanged(applyRecorderStatus);
    const offNarration = window.handover.onNarrationStatusChanged(setNarrationStatus);
    const offMicrophones =
      window.handover.onMicrophoneSettingsChanged(setMicrophoneSettings);
    const offScreens =
      window.handover.onScreenSettingsChanged(setScreenSettings);
    const offSensitive = window.handover.onSensitiveModelStatusChanged(setSensitive);
    return () => {
      offRecorder();
      offNarration();
      offMicrophones();
      offScreens();
      offSensitive();
    };
  }, [applyRecorderStatus, refreshCount]);

  useEffect(() => {
    return window.handover.onRecordingPrivacyWarningRequested(() => {
      setShowNarrationSettings(false);
      setShowRecordingWarning(true);
    });
  }, []);

  // Recordings are reviewed in the library window, so re-check the count
  // whenever the recorder regains focus.
  useEffect(() => {
    const onFocus = () => void refreshCount();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshCount]);

  const recording = status?.state === "recording";
  const transitioning = status?.transition !== "none";
  const startedAt = status?.startedAt ?? null;
  const justSaved = !recording && status?.lastFinish?.outcome === "saved";
  const justDiscarded = !recording && status?.lastFinish?.outcome === "discarded";
  const narrate = microphoneSettings?.narrationEnabled ?? false;
  const narrationLanguageName = narrationLanguageLabel(narrationLanguage);
  const advancedOn = sensitive?.enabled ?? true;
  const selectedScreenLabel =
    screenSettings?.selectedSourceLabel ?? "Loading screens...";

  useEffect(() => {
    if (recording) {
      setShowNarrationSettings(false);
    }
  }, [recording]);

  useEffect(() => {
    if (!showNarrationSettings) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowNarrationSettings(false);
    };
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || narrationSettingsRef.current?.contains(target)) return;
      setShowNarrationSettings(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [showNarrationSettings]);

  // Keep the fixed-width HUD window sized to its content: no dead space in short
  // states, no clipping when the doctor reveals an extra model row. Observers catch
  // both row add/remove (MutationObserver) and reflow/size changes (ResizeObserver).
  useLayoutEffect(() => {
    const hud = hudRef.current;
    if (!hud) return;
    let frame = 0;
    const report = () => {
      frame = 0;
      window.handover.fitRecorderHeight?.(measureHudHeight(hud));
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(report);
    };
    const ro = new ResizeObserver(schedule);
    const observeChildren = () => {
      ro.disconnect();
      for (const child of Array.from(hud.children)) ro.observe(child);
    };
    const mo = new MutationObserver(() => {
      observeChildren();
      schedule();
    });
    observeChildren();
    mo.observe(hud, { childList: true });
    schedule();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  // Refresh the library count whenever a recording finishes.
  useEffect(() => {
    if (!recording) void refreshCount();
  }, [recording, refreshCount]);

  useEffect(() => {
    if (!recording || startedAt == null) {
      setElapsed(0);
      return;
    }
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 500);
    return () => clearInterval(id);
  }, [recording, startedAt]);

  const toggle = useCallback(async () => {
    if (recording) {
      const res = await window.handover.stop();
      if (!res.ok) window.alert(res.error ?? "Action failed");
      applyRecorderStatus(await window.handover.status());
      return;
    }

    const res = await window.handover.start();
    if (res.privacyWarningRequired) {
      setShowRecordingWarning(true);
      return;
    }
    if (!res.ok) window.alert(res.error ?? "Action failed");
    applyRecorderStatus(await window.handover.status());
  }, [applyRecorderStatus, recording]);

  const startAfterWarning = useCallback(async () => {
    setWarningStarting(true);
    const res = await window.handover.confirmStart();
    if (!res.ok) {
      setWarningStarting(false);
      window.alert(res.error ?? "Could not start recording.");
      return;
    }
    setShowRecordingWarning(false);
    setWarningStarting(false);
    applyRecorderStatus(await window.handover.status());
  }, [applyRecorderStatus]);

  const openPrivacyReview = useCallback((origin: PrivacyReviewOrigin) => {
    setShowRecordingWarning(false);
    setPrivacyReviewOrigin(origin);
  }, []);

  const closePrivacyReview = useCallback(() => {
    const returnToWarning = privacyReviewOrigin === "warning";
    setPrivacyReviewOrigin(null);
    if (returnToWarning) setShowRecordingWarning(true);
  }, [privacyReviewOrigin]);

  const completePrivacyReview = useCallback(async () => {
    await window.handover.markRecordingPrivacyReviewed();
    setPrivacyReviewOrigin(null);
    setShowRecordingWarning(false);
  }, []);

  const selectNarrationLanguage = useCallback(
    async (value: string) => {
      if (!isNarrationLanguage(value)) {
        window.alert("Unsupported narration language.");
        return;
      }
      setSelectedNarrationLanguage(value);
      const result = await window.handover.setNarrationLanguage(value);
      if (!result.ok) window.alert(result.error ?? "Could not change the narration language.");
      applyRecorderStatus(await window.handover.status());
    },
    [applyRecorderStatus],
  );

  const toggleNarration = useCallback(async () => {
    if (!microphoneSettings) return;
    setMicrophonePending(true);
    setMicrophoneActionError(null);
    const result = await window.handover.setNarrationEnabled(
      !microphoneSettings.narrationEnabled,
    );
    setMicrophoneSettings(result.status);
    if (!result.ok) {
      setMicrophoneActionError(
        result.error ?? "Could not update the narration preference.",
      );
      setShowNarrationSettings(true);
    }
    setMicrophonePending(false);
  }, [microphoneSettings]);

  const selectMicrophone = useCallback(async (deviceId: string) => {
    setMicrophonePending(true);
    setMicrophoneActionError(null);
    const result = await window.handover.selectMicrophone(deviceId);
    setMicrophoneSettings(result.status);
    if (!result.ok) {
      setMicrophoneActionError(
        result.error ?? "Could not select that microphone.",
      );
    }
    setMicrophonePending(false);
  }, []);

  const selectScreen = useCallback(async (sourceId: string) => {
    setScreenPending(true);
    setScreenActionError(null);
    const result = await window.handover.selectScreen(sourceId);
    setScreenSettings(result.status);
    if (!result.ok) {
      setScreenActionError(result.error ?? "Could not select that screen.");
    }
    setScreenPending(false);
  }, []);

  const openLibrary = useCallback(() => {
    void window.handover.openLibrary();
  }, []);

  const toggleAdvanced = useCallback(async () => {
    if (!sensitive) return;
    const next = !sensitive.enabled;
    setAdvancedPending(true);
    setSensitive((s) => (s ? { ...s, enabled: next } : s)); // optimistic; real state follows
    const res = await window.handover.setAdvancedProtection(next);
    if (!res.ok) {
      void window.handover.sensitiveModelStatus().then(setSensitive);
      window.alert(res.error ?? "Could not update advanced protection.");
    }
    setAdvancedPending(false);
  }, [sensitive]);

  const downloadSensitiveModels = useCallback(async () => {
    const res = await window.handover.downloadSensitiveModels();
    if (!res.ok) window.alert(res.error ?? "Could not download the protection models.");
  }, []);

  return (
    <div className="hud" ref={hudRef}>
      <div className="transport">
        <div className="record-actions">
        <button
          className={`record ${recording ? "on" : ""}`}
          onClick={toggle}
          disabled={transitioning || microphonePending || screenPending}
          aria-label={recording ? "Stop recording" : "Start recording"}
        >
          <span className="record-glyph" />
        </button>
        </div>
        <div className={`timecode ${recording ? "live" : ""}`}>
          {recording ? formatMs(elapsed) : "00:00"}
        </div>
        <div className="transport-sub">
          {recording
            ? `${status?.eventCount ?? 0} events captured`
            : justSaved
              ? "Capture saved. Open Sessions to review"
              : justDiscarded
                ? "Recording discarded"
              : screenSettings?.error
                ? "Screen capture needs attention"
                : `Ready to capture · ${selectedScreenLabel}`}
        </div>
      </div>

      <section ref={narrationSettingsRef} className={`narrate ${narrate ? "on" : ""}`}>
        <div className="narrate-head">
          <button
            className="narrate-toggle"
            role="switch"
            aria-checked={narrate}
            aria-busy={microphonePending}
            onClick={() => void toggleNarration()}
            disabled={
              !microphoneSettings ||
              microphonePending ||
              recording ||
              transitioning
            }
          >
            <span className="narrate-icon" aria-hidden>
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                <rect
                  x="7.5"
                  y="2.5"
                  width="5"
                  height="9"
                  rx="2.5"
                  stroke="currentColor"
                  strokeWidth="1.4"
                />
                <path
                  d="M5 9.2a5 5 0 0 0 10 0"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
                <path
                  d="M10 14.2v3"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <span className="narrate-text">
              <span className="narrate-label">Narrate</span>
              <span className="narrate-sub">
                {microphonePending
                  ? "Requesting microphone access..."
                  : microphoneActionError || microphoneSettings?.error
                    ? "Microphone needs attention"
                    : recording
                      ? narrate
                        ? `Listening · ${narrationLanguageName}`
                        : "Voice off for this recording"
                      : narrate
                        ? narrationLanguageName
                        : "Explain out loud (optional)"}
              </span>
            </span>
          </button>
          <button
            className={`narrate-settings-toggle ${showNarrationSettings ? "open" : ""}`}
            aria-label="Recording settings"
            aria-controls="recording-settings"
            aria-expanded={showNarrationSettings}
            title="Recording settings"
            disabled={microphonePending || screenPending || recording || transitioning}
            onClick={() => {
              setMicrophoneActionError(null);
              setScreenActionError(null);
              setShowNarrationSettings((open) => !open);
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
              <path
                fill="currentColor"
                d="M19.43 12.98c.04-.32.07-.65.07-.98s-.03-.66-.07-.98l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.6-.22l-2.49 1a7.2 7.2 0 0 0-1.69-.98l-.38-2.65A.5.5 0 0 0 14 2h-4a.5.5 0 0 0-.5.42l-.38 2.65c-.61.25-1.17.58-1.69.98l-2.49-1a.5.5 0 0 0-.6.22l-2 3.46a.5.5 0 0 0 .12.64l2.11 1.65a7.7 7.7 0 0 0 0 1.96l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46a.5.5 0 0 0 .6.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65A.5.5 0 0 0 10 22h4a.5.5 0 0 0 .5-.42l.38-2.65c.61-.25 1.17-.58 1.69-.98l2.49 1a.5.5 0 0 0 .6-.22l2-3.46a.5.5 0 0 0-.12-.64zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z"
              />
            </svg>
          </button>
          <button
            type="button"
            className="narrate-switch-btn"
            aria-hidden
            tabIndex={-1}
            disabled={
              !microphoneSettings ||
              microphonePending ||
              recording ||
              transitioning
            }
            onClick={() => void toggleNarration()}
          >
            <span className={`narrate-switch ${narrate ? "on" : ""}`}>
              <span className="narrate-knob" />
            </span>
          </button>
        </div>

        {showNarrationSettings && (
          <>
            <button
              type="button"
              className="narrate-scrim"
              aria-hidden
              tabIndex={-1}
              onClick={() => setShowNarrationSettings(false)}
            />
            <div id="recording-settings" className="narrate-settings">
            <label htmlFor="narrate-language">Language</label>
            <div className="narrate-select-wrap">
              <select
                id="narrate-language"
                value={narrationLanguage}
                disabled={microphonePending || recording || transitioning}
                onChange={(event) =>
                  void selectNarrationLanguage(event.currentTarget.value)
                }
                title="The transcript stays in this language"
              >
                {NARRATION_LANGUAGES.map(({ code, label }) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </select>
              <span className="narrate-select-chevron" aria-hidden>
                ▾
              </span>
            </div>

            <label htmlFor="narrate-microphone">Microphone</label>
            <div className="narrate-select-wrap">
              <select
                id="narrate-microphone"
                value={microphoneSettings?.selectedDeviceId ?? ""}
                disabled={microphonePending || recording || transitioning}
                onChange={(event) => void selectMicrophone(event.target.value)}
              >
                {microphoneSettings ? (
                  microphoneSettings.devices.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.label}
                    </option>
                  ))
                ) : (
                  <option value="">Loading microphones...</option>
                )}
              </select>
              <span className="narrate-select-chevron" aria-hidden>
                ▾
              </span>
            </div>
            <label htmlFor="recording-screen">Screen</label>
            <div className="narrate-select-wrap">
              <select
                id="recording-screen"
                value={screenSettings?.selectedSourceId ?? ""}
                disabled={
                  screenPending ||
                  recording ||
                  transitioning ||
                  !screenSettings ||
                  screenSettings.screens.length === 0
                }
                onChange={(event) => void selectScreen(event.target.value)}
              >
                {screenSettings?.screens.length ? (
                  screenSettings.screens.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.label}
                    </option>
                  ))
                ) : (
                  <option value="">
                    {screenSettings ? "No screens available" : "Loading screens..."}
                  </option>
                )}
              </select>
              <span className="narrate-select-chevron" aria-hidden>
                ▾
              </span>
            </div>
            {(microphoneActionError ||
              microphoneSettings?.error ||
              microphoneSettings?.fallback) && (
              <p
                className={`narrate-settings-note ${
                  microphoneActionError || microphoneSettings?.error
                    ? "error"
                    : "warn"
                }`}
                role={
                  microphoneActionError || microphoneSettings?.error
                    ? "alert"
                    : undefined
                }
              >
                {microphoneActionError ??
                  microphoneSettings?.error ??
                  microphoneSettings?.fallback}
              </p>
            )}
            {(screenActionError ||
              screenSettings?.error ||
              screenSettings?.fallback) && (
              <p
                className={`narrate-settings-note ${
                  screenActionError || screenSettings?.error
                    ? "error"
                    : "warn"
                }`}
                role={
                  screenActionError || screenSettings?.error
                    ? "alert"
                    : undefined
                }
              >
                {screenActionError ??
                  screenSettings?.error ??
                  screenSettings?.fallback}
              </p>
            )}
            </div>
          </>
        )}
      </section>

      <button className="privacy-note" onClick={() => openPrivacyReview("home")}>
        <span className="privacy-note-icon" aria-hidden>
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
            <path
              d="M10 2.5 4 4.8v4.3c0 3.4 2.4 6.2 6 7.4 3.6-1.2 6-4 6-7.4V4.8L10 2.5Z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <path
              d="m7.4 9.8 1.9 1.9 3.4-3.6"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="privacy-note-text">
          <span className="privacy-note-title">Records your screen and activity</span>
          <span className="privacy-note-sub">See exactly what's captured</span>
        </span>
        {!advancedOn ? (
          <span className="privacy-note-badge is-off">Protection off</span>
        ) : null}
        <span className="privacy-note-chevron" aria-hidden>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M6 4l4 4-4 4"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      <button
        className="sessions-open"
        onClick={openLibrary}
        aria-label={
          sessionCount === 0
            ? "Review sessions, nothing recorded yet"
            : `Review sessions, ${sessionCount} recorded`
        }
      >
        <span className="sessions-open-icon" aria-hidden>
          <svg width="19" height="19" viewBox="0 0 20 20" fill="none">
            <path
              d="M10 2.6 3.2 6 10 9.4 16.8 6 10 2.6Z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <path
              d="M3.4 10 10 13.3 16.6 10"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M3.4 13.6 10 16.9 16.6 13.6"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="sessions-open-text">
          <span className="sessions-open-label">
            Review sessions
          </span>
          <span className="sessions-open-sub">
            {sessionCount === 0
              ? "No recordings yet"
              : `${sessionCount} recording${sessionCount === 1 ? "" : "s"}`}
          </span>
        </span>
        <span className="sessions-open-chevron" aria-hidden>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M6 4l4 4-4 4"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      {doctor && (
        <div className="doctor">
          <Row
            label="Window tracking"
            status={doctor.activeWindow.ok ? "good" : "bad"}
            note={doctor.activeWindow.ok ? "found" : "missing"}
          />
          {narrate && narrationStatus && (
            <VoiceModelRow status={narrationStatus} />
          )}
          {sensitive && (
            <SensitiveModelRow
              status={sensitive}
              recording={recording}
              onDownload={downloadSensitiveModels}
            />
          )}
        </div>
      )}

      <p className="hint">{TOGGLE_SHORTCUT} toggles from anywhere</p>

      {showRecordingWarning && (
        <RecordingPrivacyWarning
          starting={warningStarting}
          onStart={() => void startAfterWarning()}
          onReview={() => openPrivacyReview("warning")}
          onClose={() => setShowRecordingWarning(false)}
        />
      )}
      {privacyReviewOrigin && (
        <WhatsRecorded
          onClose={closePrivacyReview}
          onReviewed={() => void completePrivacyReview()}
          sensitive={sensitive}
          advancedPending={advancedPending}
          onToggleAdvanced={() => void toggleAdvanced()}
          onDownload={downloadSensitiveModels}
        />
      )}
    </div>
  );
}

type RowStatus = "good" | "warn" | "bad";

function Row({
  label,
  status,
  note,
  action,
}: {
  label: string;
  status: RowStatus;
  note: string;
  action?: { label: string; disabled?: boolean; onClick: () => void };
}) {
  const symbol = status === "good" ? "✓" : status === "warn" ? "!" : "✕";
  return (
    <div className="row">
      <span className={`badge ${status}`}>{symbol}</span>
      <span className="row-label">{label}</span>
      <span className="row-note">{note}</span>
      {action && (
        <button className="row-action" disabled={action.disabled} onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}

function VoiceModelRow({ status }: { status: NarrationStatus }) {
  if (status.phase === "loading") {
    return <Row label="voice transcription" status="warn" note="preparing" />;
  }
  if (status.model === "ready") {
    return <Row label="voice transcription" status="good" note="on-device · multilingual" />;
  }
  return (
    <Row
      label="voice transcription"
      status="bad"
      note="bundled model missing · reinstall the app"
    />
  );
}

/** Single doctor row for the opt-out Advanced-protection model, shown while enabled.
 *  Goes red whenever the on-device screen-text model isn't downloaded, with one
 *  action that fetches it. */
function SensitiveModelRow({
  status,
  recording,
  onDownload,
}: {
  status: SensitiveModelStatus;
  recording: boolean;
  onDownload: () => void;
}) {
  if (!status.enabled) return null;
  if (status.ocr === "downloading") {
    const note = status.progress == null ? "downloading" : `${Math.round(status.progress)}%`;
    return <Row label="advanced protection" status="warn" note={note} />;
  }
  if (status.ocr === "ready") {
    return <Row label="advanced protection" status="good" note="on-device" />;
  }
  const failed = status.ocr === "error";
  return (
    <Row
      label="advanced protection"
      status="bad"
      note={failed ? "download failed" : "not downloaded"}
      action={{ label: failed ? "retry" : "download", disabled: recording, onClick: onDownload }}
    />
  );
}
