import type { MicrophoneDevice } from "./microphone";
import type { NarrationLanguage } from "./narration";
import type { ScreenSource } from "./screen";
import type { RecorderState } from "./types";
import type {
  SupportedShellId,
  TerminalActionResult,
  TerminalShellDescriptor,
  TerminalStatus,
} from "./terminal";

export type {
  SensitiveCategory,
  SensitiveFinding,
  SensitiveReport,
  SensitiveSeverity,
  SensitiveSource,
} from "./sensitive";

/** The last completed session — the one that can be analyzed. */
export interface LastSession {
  id: string;
  /** True once post-processing (bundle/description/frames) has finished. */
  processed: boolean;
}

/** A saved recording as shown in the sessions library. */
export interface SessionSummary {
  id: string;
  startedAt: number | null;
  stoppedAt: number | null;
  durationMs: number | null;
  /** Total bytes occupied by all files under this session's directory. */
  sizeBytes: number | null;
  /** True once post-processing produced a bundle. */
  processed: boolean;
  /** True once the user marked review done and has not edited since (SEC-2): export is allowed. */
  reviewed: boolean;
  hasVideo: boolean;
  /** True when the user opted into narration and usable audio was saved. */
  hasAudio: boolean;
  /** Selected source language for saved audio, or null when no audio exists. */
  narrationLanguage: NarrationLanguage | null;
  /** True once transcription completed, including recordings with no detected speech. */
  hasNarration: boolean;
  narrationSegmentCount: number | null;
  narrationUpdatedAt: number | null;
}

export type NarrationModelState = "missing" | "downloading" | "ready" | "error";
export type NarrationPhase = "idle" | "loading" | "downloading" | "transcribing";

/** Shared model/job state shown in the HUD and Sessions library. */
export interface NarrationStatus {
  model: NarrationModelState;
  phase: NarrationPhase;
  progress: number | null;
  loadedBytes: number | null;
  totalBytes: number | null;
  activeSessionId: string | null;
  error: string | null;
}

export interface NarrationActionResult {
  ok: boolean;
  outcome?: "ready" | "transcribed" | "no-speech" | "already-transcribed" | "model-missing";
  error?: string;
}

export interface RecorderStatus {
  state: RecorderState;
  sessionId: string | null;
  startedAt: number | null;
  /** Source language fixed for the active recording's narration. */
  narrationLanguage: NarrationLanguage;
  eventCount: number;
  /** The user paused the recording: nothing is captured until they resume. */
  paused: boolean;
  /** The screen is frozen for an explanation (the Explain overlay is open). */
  explaining: boolean;
  transition: "none" | "starting" | "stopping" | "discarding";
  microphone: {
    state: "off" | "starting" | "on" | "stopping" | "error";
    error: string | null;
    activeDevice: MicrophoneDevice | null;
  };
  lastFinish: {
    sessionId: string;
    outcome: "saved" | "discarded";
  } | null;
  /** Set after a recording stops; drives the "Analyze" affordance. */
  lastSession: LastSession | null;
}

/** The on-device model asset behind "Advanced protection". */
export type SensitiveModelState = "missing" | "downloading" | "ready" | "error";

/**
 * Status of the "Advanced protection" layer (on-device frame OCR). The persisted
 * `enabled` opt-out is independent of whether the model file is downloaded: a user
 * can turn it off while keeping the cache, or have it on while a download is still
 * in flight (in which case scans still mask the outgoing text and the frame-blur
 * layer joins once the model is ready).
 */
export interface SensitiveModelStatus {
  /** Persisted user opt-in. */
  enabled: boolean;
  /** Tesseract OCR language data (for frame text detection). */
  ocr: SensitiveModelState;
  /** Download progress 0–100 while the OCR asset is downloading. */
  progress: number | null;
  error: string | null;
}

export interface SensitiveModelActionResult {
  ok: boolean;
  error?: string;
}

export interface StartResult {
  ok: boolean;
  sessionId?: string;
  /** The recording has not started; the renderer must show the pre-recording warning. */
  privacyWarningRequired?: boolean;
  error?: string;
}

/** Per-session capture choices the user makes in the HUD before recording. */
export interface StartOptions {
  /** Capture microphone narration for this session (opt-in, off by default). */
  narration?: boolean;
  /** Source language to preserve in the transcript. Defaults to English. */
  narrationLanguage?: NarrationLanguage;
  /** Device selected for the initial narration segment; defaults to the OS input. */
  microphoneDeviceId?: string;
  /** Electron desktop-capture source selected for this recording. */
  screenSourceId?: string;
  /** Stable OS display identity used to validate the final Electron source. */
  screenDisplayId?: string;
}

export interface StopResult {
  ok: boolean;
  sessionId?: string;
  sessionDir?: string;
  requiresTerminalConfirmation?: boolean;
  terminalCommand?: string;
  error?: string;
}

export interface DiscardResult {
  ok: boolean;
  sessionId?: string;
  requiresTerminalConfirmation?: boolean;
  terminalCommand?: string;
  error?: string;
}

export interface MicrophoneResult {
  ok: boolean;
  state?: RecorderStatus["microphone"]["state"];
  error?: string;
}

export interface NarrationLanguageResult {
  ok: boolean;
  language?: NarrationLanguage;
  error?: string;
}

export type MicrophonePermissionState = "unknown" | "granted" | "denied";

/** Shared pre-recording microphone preference and current device catalog. */
export interface MicrophoneSettingsStatus {
  narrationEnabled: boolean;
  permission: MicrophonePermissionState;
  devices: MicrophoneDevice[];
  /** The preferred device, retained even while it is disconnected. */
  preferredDeviceId: string;
  preferredDeviceLabel: string;
  /** The device that will actually be requested for the next microphone segment. */
  selectedDeviceId: string;
  selectedDeviceLabel: string;
  preferredDeviceUnavailable: boolean;
  fallback: string | null;
  error: string | null;
}

export interface MicrophoneSettingsResult {
  ok: boolean;
  status: MicrophoneSettingsStatus;
  error?: string;
}

/** Shared pre-recording screen preference and current display catalog. */
export interface ScreenSettingsStatus {
  screens: ScreenSource[];
  /** The preferred source, retained even while its display is disconnected. */
  preferredSourceId: string;
  preferredSourceLabel: string;
  /** The source that will actually be recorded in the next session. */
  selectedSourceId: string;
  selectedSourceLabel: string;
  preferredSourceUnavailable: boolean;
  fallback: string | null;
  error: string | null;
}

export interface ScreenSettingsResult {
  ok: boolean;
  status: ScreenSettingsStatus;
  error?: string;
}

export interface MarkerResult {
  ok: boolean;
  error?: string;
}

export interface DeleteSessionResult {
  ok: boolean;
  error?: string;
}

/** Result of packaging a recording into a downloadable debug bundle (.zip). */
export interface DebugBundleResult {
  ok: boolean;
  /** Absolute path of the written .zip on success. */
  path?: string;
  /** True when the user dismissed the save dialog — a cancel, not an error. */
  canceled?: boolean;
  error?: string;
}

/** Result of exporting a recording as a Handover tester package. */
export interface ExportPackageResult {
  ok: boolean;
  /** The user dismissed the save dialog — a cancel, not an error. */
  canceled?: boolean;
  packageId?: string;
  /** Absolute path of the written `.handover` folder. */
  folder?: string;
  /** Absolute path of the written `.zip`. */
  zip?: string;
  stepCount?: number;
  error?: string;
  /** Why the package failed validation, when it did. */
  validationErrors?: string[];
}

/** Result of pause, resume and starting an Explain freeze. */
export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** What one freeze overlay window needs to draw: its display's frozen frame and geometry. */
export interface FreezeInit {
  displayId: number;
  /** The frozen frame as a data URL. */
  frame: string;
  /** Display physical size in px; saved shapes use these pixels. */
  sizeDpx: [number, number];
  scaleFactor: number;
  /** The drawing surface in CSS px (the window's content size). */
  cssSize: [number, number];
  /** 1-based position of this display among the frozen ones, and how many there are. */
  index: number;
  count: number;
  /** True for the display that opens focused (the one under the pointer). */
  primary: boolean;
}

/** Result of loading a session for review. */
export interface ReviewLoadResult {
  ok: boolean;
  error?: string;
  data?: import("./handover/review").ReviewData;
}

/** Which foreground-window provider is available on this platform. */
export interface ActiveWindowInfo {
  ok: boolean;
  provider: "koffi" | "get-windows" | "missing";
  path: string | null;
  error?: string;
}

/** How, and whether, active-tab URLs can be read on this platform. */
export interface BrowserUrlInfo {
  kind: "applescript" | "uia" | "none";
  supported: boolean;
}

/** One capture source in the doctor report, annotated with platform support. */
export interface DoctorSource {
  key: string;
  label: string;
  tier: number;
  cost: string;
  /** False when this source can't work on the current platform. */
  supported: boolean;
  /** Short reason shown when unsupported, or a setup nudge. */
  note?: string;
}

/** State of the native click and control helper (lane L5). */
export type HelperState = "ok" | "missing" | "crashed" | "no-permission";

export interface HelperDoctorInfo {
  helper: HelperState;
  /** Version the helper reported in its `hello`; null until it has run. */
  version: string | null;
  lastError: string | null;
  /** Control-lookup time over this app run (null until a click has been seen). */
  lookupP50Ms: number | null;
  lookupP95Ms: number | null;
  /** Click counts by how the control was grounded. `none` = no control resolved. */
  counts: { accessibility: number; accessibility_weak: number; none: number };
}

export interface DoctorReport {
  platform: NodeJS.Platform;
  activeWindow: ActiveWindowInfo;
  browserUrl: BrowserUrlInfo;
  sessionsDir: string;
  activeSources: DoctorSource[];
  helper: HelperDoctorInfo;
}

/** IPC channel names — the single source of truth shared by main + preload. */
export const IPC = {
  start: "recorder:start",
  startConfirmed: "recorder:start-confirmed",
  stop: "recorder:stop",
  discard: "recorder:discard",
  microphone: "recorder:microphone",
  narrationLanguage: "recorder:narration-language",
  microphoneSettings: "microphone:settings",
  microphoneNarration: "microphone:narration",
  microphoneDevice: "microphone:device",
  microphoneSettingsChanged: "microphone:settings-changed",
  screenSettings: "screen:settings",
  screenSource: "screen:source",
  screenSettingsChanged: "screen:settings-changed",
  status: "recorder:status",
  marker: "recorder:marker",
  doctor: "doctor:check",
  statusChanged: "recorder:status-changed",
  recordingPrivacyReviewed: "recorder:privacy-reviewed",
  recordingPrivacyWarningRequested: "recorder:privacy-warning-requested",
  narrationStatus: "narration:status",
  narrationTranscribe: "narration:transcribe",
  narrationStatusChanged: "narration:status-changed",
  sensitiveModelStatus: "sensitive:status",
  sensitiveSetAdvanced: "sensitive:set-advanced",
  sensitiveDownloadModels: "sensitive:download-models",
  sensitiveStatusChanged: "sensitive:status-changed",
  listSessions: "sessions:list",
  openSessionsFolder: "sessions:open-folder",
  sessionsChanged: "sessions:changed",
  librarySelection: "ui:library-selection",
  takeLibrarySelection: "ui:take-library-selection",
  deleteSession: "sessions:delete",
  exportDebugBundle: "sessions:export-debug",
  exportPackage: "sessions:export-package",
  terminalOpen: "terminal:open",
  terminalReady: "terminal:ready",
  terminalStatus: "terminal:status",
  terminalShells: "terminal:shells",
  terminalSwitchShell: "terminal:switch-shell",
  terminalInput: "terminal:input",
  terminalResize: "terminal:resize",
  terminalHide: "terminal:hide",
  terminalStatusChanged: "terminal:status-changed",
  terminalFinishConfirmationRequested: "terminal:finish-confirmation-requested",
  terminalOutput: "terminal:output",
  openLibrary: "ui:open-library",
  closeLibrary: "ui:close-library",
  recordingControlsExpanded: "ui:recording-controls-expanded",
  fitRecorderHeight: "ui:fit-recorder-height",
  pause: "recorder:pause",
  resume: "recorder:resume",
  explain: "recorder:explain",
  explainHotkey: "recorder:explain-hotkey",
  freezeReady: "freeze:ready",
  freezeInit: "freeze:init",
  freezeState: "freeze:state",
  freezeDone: "freeze:done",
  freezeCancel: "freeze:cancel",
  reviewLoad: "review:load",
  reviewImage: "review:image",
  reviewEdit: "review:edit",
  markReviewed: "sessions:mark-reviewed",
  actionError: "recorder:action-error",
  freezeFocusFailed: "freeze:focus-failed",
  freezeNotice: "freeze:notice",
} as const;

/** Sent to a freeze overlay when another display's overlay was dropped (N2): the corrected count and a notice. */
export interface FreezeNotice {
  index: number;
  count: number;
  /** Shown on the primary overlay only; null elsewhere. */
  notice: string | null;
}

/** Shape exposed on `window.handover` by the preload bridge. */
export interface HandoverApi {
  /** Request a start; may require the pre-recording privacy warning first. */
  start(): Promise<StartResult>;
  /** Start once after the user explicitly proceeds through the privacy warning. */
  confirmStart(): Promise<StartResult>;
  markRecordingPrivacyReviewed(): Promise<void>;
  onRecordingPrivacyWarningRequested(cb: () => void): () => void;
  stop(forceTerminal?: boolean): Promise<StopResult>;
  discard(forceTerminal?: boolean): Promise<DiscardResult>;
  setMicrophoneEnabled(enabled: boolean): Promise<MicrophoneResult>;
  setNarrationLanguage(language: NarrationLanguage): Promise<NarrationLanguageResult>;
  microphoneSettings(): Promise<MicrophoneSettingsStatus>;
  setNarrationEnabled(enabled: boolean): Promise<MicrophoneSettingsResult>;
  selectMicrophone(deviceId: string): Promise<MicrophoneSettingsResult>;
  onMicrophoneSettingsChanged(
    cb: (status: MicrophoneSettingsStatus) => void,
  ): () => void;
  screenSettings(): Promise<ScreenSettingsStatus>;
  selectScreen(sourceId: string): Promise<ScreenSettingsResult>;
  onScreenSettingsChanged(
    cb: (status: ScreenSettingsStatus) => void,
  ): () => void;
  status(): Promise<RecorderStatus>;
  marker(note: string): Promise<MarkerResult>;
  doctor(): Promise<DoctorReport>;
  onStatusChanged(cb: (status: RecorderStatus) => void): () => void;
  openTerminal(): Promise<TerminalActionResult>;
  terminalReady(): Promise<TerminalActionResult>;
  terminalStatus(): Promise<TerminalStatus>;
  terminalShells(): Promise<TerminalShellDescriptor[]>;
  switchTerminalShell(shell: SupportedShellId): Promise<TerminalActionResult>;
  writeTerminal(data: string): void;
  resizeTerminal(columns: number, rows: number): void;
  hideTerminal(): Promise<void>;
  onTerminalStatusChanged(cb: (status: TerminalStatus) => void): () => void;
  onTerminalFinishConfirmationRequested(cb: () => void): () => void;
  onTerminalOutput(cb: (data: string) => void): () => void;
  narrationStatus(): Promise<NarrationStatus>;
  transcribeNarration(sessionId: string): Promise<NarrationActionResult>;
  onNarrationStatusChanged(cb: (status: NarrationStatus) => void): () => void;
  /** Current status of the "Advanced protection" model (on-device frame OCR). */
  sensitiveModelStatus(): Promise<SensitiveModelStatus>;
  /** Toggle "Advanced protection". Enabling persists the opt-in and provisions the
   *  model (warming from cache when present, else fetching it in the background);
   *  disabling stops applying the model but keeps the cache. */
  setAdvancedProtection(enabled: boolean): Promise<SensitiveModelActionResult>;
  /** Download the on-device OCR data the Advanced layer needs and warm the engine.
   *  The deliberate "download" action, mirroring the voice model — safe to call
   *  repeatedly. */
  downloadSensitiveModels(): Promise<SensitiveModelActionResult>;
  onSensitiveModelStatusChanged(cb: (status: SensitiveModelStatus) => void): () => void;
  /** All saved recordings, newest first, for the sessions library. */
  listSessions(): Promise<SessionSummary[]>;
  /** Reveal the folder that holds all saved recordings in the OS file manager. */
  openSessionsFolder(): Promise<{ ok: boolean; error?: string }>;
  onSessionsChanged(cb: () => void): () => void;
  onLibrarySelection(cb: () => void): () => void;
  takeLibrarySelection(): Promise<string | null>;
  /** Permanently delete a saved recording and all its artifacts from disk. */
  deleteSession(sessionId: string): Promise<DeleteSessionResult>;
  /**
   * Package a single recording (its whole session folder plus a generated
   * diagnostics file) into a .zip the user picks a location for. The bundle
   * contains private capture data; the renderer warns before calling this.
   */
  exportDebugBundle(sessionId: string): Promise<DebugBundleResult>;
  /**
   * Export a recording as a Handover tester package: a `.handover` folder and a `.zip` beside the
   * location the user picks in a save dialog. The result reports whether it validated.
   */
  exportPackage(sessionId: string): Promise<ExportPackageResult>;
  /** Open (and focus) the Sessions library window, docked to the recorder. */
  openLibrary(sessionId?: string): Promise<void>;
  /** Close the Sessions library window from within it. */
  closeLibrary(): Promise<void>;
  /** Resize the recording-controls window while an overlay panel is visible. */
  setRecordingControlsExpanded(expanded: boolean): Promise<void>;
  /** Fit the compact recorder window to its rendered content height (fire-and-forget)
   *  so the fixed-width HUD never shows dead space or clips a revealed row. */
  fitRecorderHeight(height: number): void;
  /** Pause the recording; nothing is captured until {@link resume}. */
  pause(): Promise<ActionResult>;
  resume(): Promise<ActionResult>;
  /** Freeze the screen so items on it can be highlighted and commented on. */
  explain(): Promise<ActionResult>;
  /** The Explain hotkey that is registered, or null when it could not be (only the button works). */
  explainHotkey(): Promise<string | null>;
  /** Freeze overlay only: the frozen frame has been drawn, so the window can be shown. */
  freezeReady(): void;
  /** Freeze overlay only: the frozen frame and geometry for this window's display. */
  freezeInit(): Promise<FreezeInit | null>;
  /** Freeze overlay only: report the shapes and comment drawn so far on this display. */
  freezeState(state: import("./handover/explain").ExplainResult): void;
  /** Freeze overlay only: another display's overlay was dropped; the corrected screen count and a notice. */
  onFreezeNotice(cb: (notice: FreezeNotice) => void): () => void;
  /** Freeze overlay only: Windows refused this overlay the keyboard even after a retry. */
  onFreezeFocusFailed(cb: () => void): () => void;
  /** Freeze overlay only: save everything drawn on every display and unfreeze. */
  freezeDone(): Promise<ActionResult>;
  /** Freeze overlay only: throw it all away and unfreeze. */
  freezeCancel(): Promise<ActionResult>;
  /** Library: build a recording's steps (with its stored edits) for review. */
  reviewLoad(sessionId: string): Promise<ReviewLoadResult>;
  /** Library: a step image from the last load, as a data URL. */
  reviewImage(sessionId: string, path: string): Promise<string | null>;
  /** Library: append one edit and return the rebuilt steps. */
  reviewEdit(
    sessionId: string,
    edit: import("./handover/review").ReviewEditInput,
  ): Promise<ReviewLoadResult>;
  /** Recording bar: an action started from a hotkey failed (APP-5); the bar shows the message. */
  onActionError(cb: (message: string) => void): () => void;
  /** Library: the user finished reviewing; export stays disabled until this is recorded (SEC-2). */
  markReviewed(sessionId: string): Promise<{ ok: boolean; error?: string }>;
}
