import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  screen,
  session,
  shell,
} from "electron";

import { FULL_CAPTURE } from "../common/config";
import { displaysPayload } from "../common/handover/displays";
import { helperStatusFrom } from "../common/handover/helper";
import { helperTracker } from "./collectors/helper-status";
import { IPC, type ActionResult, type RecorderStatus, type StartResult } from "../common/ipc";
import type { PointerClickPayload } from "../common/events";
import { pointInBounds } from "../common/handover/overlay-geometry";
import type { ReviewEditInput } from "../common/handover/review";
import type {
  SupportedShellId,
  TerminalActionResult,
  TerminalStatus,
} from "../common/terminal";
import { createCollectors } from "./collectors";
import { installCrashGuards } from "./crash-guards";
import { processSession } from "./pipeline";
import { registerIpc } from "./ipc";
import { isValidSessionId, sessionDir } from "./recorder/session-store";
import { FreezeCoordinator, type OverlayWindow } from "./freeze";
import { adaptOverlayWindow, OVERLAY_READY_TIMEOUT_MS } from "./overlay-window";
import { ExplainHotkey } from "./explain-hotkey";
import { ReviewService } from "./review";
import { saveDiagnosticsToDesktop } from "./diagnostics-info";
import { createLogger, initFileLogging } from "./logger";
import {
  installNodeNetGuard,
  installWebRequestDeny,
  isDenyNetworkEnabled,
} from "./network-guard";
import { NarrationManager } from "./narration/manager";
import { SensitiveModelManager } from "./sensitive/model-manager";
import { RecorderController } from "./recorder/controller";
import { RecordingPrivacySession } from "./recording-privacy";
import { deleteSession } from "./sessions";
import { registerSingleInstance } from "./single-instance";
import { createTray } from "./tray";
import { dockIcon } from "./icons";
import { AudioRecorder } from "./audio/recorder";
import { TerminalSession } from "./terminal/session";
import { VideoRecorder } from "./video/recorder";
import { ScreenSourceService } from "./video/sources";
import {
  clampRecordingControlsWindow,
  createLibraryWindow,
  createRecorderWindow,
  createFreezeOverlay,
  createRecordingControlsWindow,
  createTerminalWindow,
  fitRecorderHeight,
  redockLibrary,
  setRecordingControlsExpanded,
} from "./window";

const instanceReady = registerSingleInstance(app, {
  isQuitting: () => quitReady || quitTask !== null,
  isRecording: () => recorder.state === "recording",
  showRecorder: () => { showRecorderWindow(); },
  showRecordingControls,
});
if (!instanceReady) {
  // Only this uninitialized duplicate exits; the running instance keeps its work.
  app.exit(0);
}

initFileLogging(path.join(app.getPath("userData"), "logs"));
const log = createLogger("Main");
// Test-only network kill switch (HANDOVER_DENY_NETWORK=1), installed before any I/O.
if (isDenyNetworkEnabled()) installNodeNetGuard((m) => log.warn(m));

// Contain stray async failures so a lost stream error can't crash the main
// process (and the recording in progress). Registered before any window/IO work.
installCrashGuards(log);

/** Static red-dot tile used for the macOS Dock icon. */
const dock = dockIcon();

let recorderWindow: BrowserWindow | null = null;
let libraryWindow: BrowserWindow | null = null;
let recordingControlsWindow: BrowserWindow | null = null;
let terminalWindow: BrowserWindow | null = null;
let terminalWindowClosing = false;
let terminalSession: TerminalSession | null = null;
let terminalSessionId: string | null = null;
let recorderHome: Electron.Rectangle | null = null;
let controlsExpanded = false;
let quitReady = false;
let quitTask: Promise<void> | null = null;
let recordingStartPending = false;
let pendingLibrarySelection: string | null = null;
const recordingPrivacy = new RecordingPrivacySession();
const narration = new NarrationManager((status) =>
  broadcast(IPC.narrationStatusChanged, status),
);
const sensitiveModels = new SensitiveModelManager((status) =>
  broadcast(IPC.sensitiveStatusChanged, status),
);
const microphones = new AudioRecorder((status) =>
  broadcast(IPC.microphoneSettingsChanged, status),
);
const screens = new ScreenSourceService((status) =>
  broadcast(IPC.screenSettingsChanged, status),
);

async function finishRecordedTerminal(): Promise<void> {
  const session = terminalSession;
  try {
    if (session) await session.finish();
  } catch (error) {
    session?.destroy();
    throw error;
  } finally {
    terminalSession = null;
    terminalSessionId = null;
    if (terminalWindow && !terminalWindow.isDestroyed()) {
      terminalWindowClosing = true;
      terminalWindow.destroy();
    }
    terminalWindow = null;
    terminalWindowClosing = false;
  }
}

/** The display layout as the `displays` event records it (tester-package.md §3). */
function currentDisplays() {
  return displaysPayload({
    platform: process.platform,
    displays: screen.getAllDisplays(),
    primaryId: screen.getPrimaryDisplay().id,
    dipToScreenPoint:
      process.platform === "win32" ? (p) => screen.dipToScreenPoint(p) : undefined,
  });
}

/** A click on Handover's own recording bar (Explain, Pause, Resume, Done…) is not part of the user's work. */
function isOwnBarClick(click: PointerClickPayload): boolean {
  const bar = recordingControlsWindow;
  if (!bar || bar.isDestroyed() || !bar.isVisible()) return false;
  // Window bounds are in DIP; Windows click positions are in physical px of the virtual screen.
  const point =
    click.space === "windows_virtual_px"
      ? screen.screenToDipPoint({ x: click.x, y: click.y })
      : { x: click.x, y: click.y };
  return pointInBounds(point, bar.getBounds());
}

const recorder = new RecorderController({
  isOwnWindowClick: isOwnBarClick,
  pointerDisplayId: () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id,
  getDisplays: currentDisplays,
  getHelperStatus: () => helperStatusFrom(helperTracker.report()),
  resolveConfig: () => ({ ...FULL_CAPTURE }),
  buildCollectors: createCollectors,
  createVideoRecorder: () => new VideoRecorder(),
  createAudioRecorder: (onCaptureEnded) =>
    microphones.createSession(onCaptureEnded),
  terminalBusy: () =>
    terminalSession?.busyDetails() ?? { busy: false, command: null },
  finishTerminal: finishRecordedTerminal,
  deleteSession,
  onExplainAborted: () => freeze.abort(),
  postProcess: async (dir) => {
    await processSession(dir);
    try {
      await narration.transcribeIfCached(dir);
    } catch (err) {
      log.warn("Cached narration processing failed:", err);
    }
  },
});

const review = new ReviewService({ toolVersion: app.getVersion() });

const overlayReveal = new Map<number, () => void>();

/** An overlay `BrowserWindow` as the freeze flow sees it. It is shown once its page has drawn the frame. */
function overlayWindow(display: Electron.Display): OverlayWindow {
  const win = createFreezeOverlay(display);
  const senderId = win.webContents.id;
  // A load failure, crash, hang, or a page that never became ready cancels the freeze (APP-1).
  const adapter = adaptOverlayWindow(win, {
    platform: process.platform,
    // Hidden until the page says it drew the frame; this is only the kill switch for a dead page (N1).
    revealTimeoutMs: OVERLAY_READY_TIMEOUT_MS,
    onSecondaryFailure: () => {
      if (!win.isDestroyed()) win.destroy(); // the freeze goes on with the other displays
    },
    onFocusFailed: () => {
      if (!win.isDestroyed()) win.webContents.send(IPC.freezeFocusFailed);
    },
    onFailure: () => {
      void freeze.cancel();
      // Say why Explain vanished instead of leaving the user guessing.
      const bar = recordingControlsWindow;
      if (bar && !bar.isDestroyed()) bar.webContents.send(IPC.actionError, "Explain could not open. Try again.");
    },
    log,
  });
  overlayReveal.set(senderId, adapter.ready);
  win.once("closed", () => overlayReveal.delete(senderId));
  return adapter.overlay;
}

const freeze: FreezeCoordinator = new FreezeCoordinator({
  beginExplain: () => recorder.beginExplain(),
  endExplain: (result) => recorder.endExplain(result),
  getDisplays: () => screen.getAllDisplays(),
  cursorDisplayId: () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id,
  readFrame: async (dir, frame) => {
    const file = path.resolve(dir, frame.file);
    if (!file.startsWith(path.resolve(dir) + path.sep)) throw new Error("frame outside the session folder");
    const bytes = await readFile(file);
    const mime = file.endsWith(".png") ? "image/png" : "image/jpeg";
    return `data:${mime};base64,${bytes.toString("base64")}`;
  },
  openWindow: overlayWindow,
  // Escape works even when the overlay page cannot see the key; held only while frozen.
  registerEscape: (cb) => {
    if (!globalShortcut.register("Escape", cb)) log.warn("Escape shortcut could not be registered for the freeze");
    return () => globalShortcut.unregister("Escape");
  },
  activateApp: () => {
    if (process.platform === "darwin") app.focus({ steal: true });
  },
  log,
});

/** Pause and Explain only make sense from the recording bar (or the hotkey), while recording. */
async function startExplain(): Promise<ActionResult> {
  const status = recorder.status();
  if (status.state !== "recording" || status.transition !== "none") {
    return { ok: false, error: "Start recording before using Explain." };
  }
  return freeze.begin();
}

/** The Explain hotkey, or null when it could not be registered (the bar's button still works). */
const EXPLAIN_HOTKEY = "CommandOrControl+Shift+E";
/** Held system-wide only while recording (APP-8); see ExplainHotkey. */
const explainHotkey = new ExplainHotkey(
  globalShortcut,
  EXPLAIN_HOTKEY,
  () => {
    // A hotkey has no button to show a failure on, so the bar does (APP-5).
    void startExplain().then((result) => {
      if (result.ok) return;
      const bar = recordingControlsWindow;
      if (bar && !bar.isDestroyed()) bar.webContents.send(IPC.actionError, result.error ?? "Explain did not start.");
    });
  },
  log,
);

async function startRecording(): Promise<StartResult> {
  if (recordingStartPending) {
    return { ok: false, error: "Recording is already starting." };
  }
  recordingStartPending = true;
  try {
    await Promise.all([
      microphones.whenSettingsSettled(),
      screens.whenSettingsSettled(),
    ]);
    const screenOptions = await screens.startOptions();
    return await recorder.start({
      ...microphones.startOptions(),
      ...screenOptions,
    });
  } finally {
    recordingStartPending = false;
  }
}

/** Send an event to every live window (recorder HUD + library, if open). */
function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

/** Open, focus, and re-dock the Sessions library window (creating it lazily). */
function openLibrary(sessionId?: string): void {
  if (recorder.state === "recording") return;
  if (!recorderWindow || recorderWindow.isDestroyed()) return;
  if (sessionId && isValidSessionId(sessionId)) pendingLibrarySelection = sessionId;
  if (libraryWindow && !libraryWindow.isDestroyed()) {
    redockLibrary(recorderWindow, libraryWindow);
    libraryWindow.show();
    libraryWindow.focus();
    if (pendingLibrarySelection) libraryWindow.webContents.send(IPC.librarySelection);
    return;
  }
  recorderHome = recorderWindow.getBounds();
  libraryWindow = createLibraryWindow(recorderWindow);
  libraryWindow.on("closed", () => {
    libraryWindow = null;
    // Drop the reviewed session's pictures from memory (APP-9). The cache holds one session.
    review.evict();
    // Return the recorder to where it sat before it made room for the library.
    if (recorderWindow && !recorderWindow.isDestroyed() && recorderHome) {
      recorderWindow.setBounds(recorderHome);
    }
    recorderHome = null;
  });
}

function ensureRecordingControlsWindow(): BrowserWindow {
  if (recordingControlsWindow && !recordingControlsWindow.isDestroyed()) {
    return recordingControlsWindow;
  }
  controlsExpanded = false;
  recordingControlsWindow = createRecordingControlsWindow();
  recordingControlsWindow.on("closed", () => {
    recordingControlsWindow = null;
    controlsExpanded = false;
  });
  return recordingControlsWindow;
}

function ensureTerminalWindow(): BrowserWindow {
  if (terminalWindow && !terminalWindow.isDestroyed()) return terminalWindow;
  terminalWindowClosing = false;
  const win = createTerminalWindow();
  terminalWindow = win;
  win.on("close", (event) => {
    if (!terminalWindowClosing && recorder.state === "recording") {
      event.preventDefault();
      win.hide();
    }
  });
  win.on("closed", () => {
    if (terminalWindow === win) terminalWindow = null;
  });
  return win;
}

function emptyTerminalStatus(): TerminalStatus {
  return {
    state: "closed",
    shell: null,
    integrationQuality: "none",
    busy: false,
    exitCode: null,
    error: null,
  };
}

async function openRecordedTerminal(): Promise<TerminalActionResult> {
  const active = recorder.activeSession();
  if (!active) {
    return { ok: false, error: "Open the recorded terminal while a recording is active." };
  }
  const win = ensureTerminalWindow();
  if (!terminalSession || terminalSessionId !== active.id) {
    terminalSession = new TerminalSession({
      sessionDir: active.dir,
      sessionStartedAt: active.startedAt,
      publishCommand: (payload) => {
        recorder.recordTerminalCommand(payload);
      },
    });
    terminalSessionId = active.id;
    terminalSession.onStatus((status) =>
      broadcast(IPC.terminalStatusChanged, status),
    );
    terminalSession.onOutput((data) => {
      if (terminalWindow && !terminalWindow.isDestroyed()) {
        terminalWindow.webContents.send(IPC.terminalOutput, data);
      }
    });
  }

  const reveal = () => {
    if (win.isDestroyed()) return;
    win.show();
    win.focus();
    win.webContents.send(IPC.terminalStatusChanged, terminalSession?.status());
  };
  if (win.webContents.isLoading()) win.webContents.once("did-finish-load", reveal);
  else reveal();

  const state = terminalSession.status().state;
  if (
    !win.webContents.isLoading() &&
    (state === "closed" || state === "exited" || state === "error")
  ) {
    return terminalSession.start();
  }
  return { ok: true };
}

async function requestStopRecording(): Promise<void> {
  const result = await recorder.stop();
  if (!result.requiresTerminalConfirmation) return;
  const win = ensureRecordingControlsWindow();
  showRecordingControls();
  const notify = () => {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.terminalFinishConfirmationRequested);
    }
  };
  if (win.webContents.isLoading()) win.webContents.once("did-finish-load", notify);
  else notify();
}

function showRecordingControls(): void {
  const win = ensureRecordingControlsWindow();
  clampRecordingControlsWindow(win);
  if (!win.isVisible()) win.showInactive();
  // On Windows the bar must not rise above the freeze overlay (APP-10).
  if (!freeze.active) win.moveTop();
}

function showRecorderWindow(): BrowserWindow {
  if (!recorderWindow || recorderWindow.isDestroyed()) {
    recorderWindow = createRecorderWindow();
  }
  if (recorderWindow.isMinimized()) recorderWindow.restore();
  recorderWindow.show();
  recorderWindow.focus();
  return recorderWindow;
}

function showRecordingPrivacyWarning(): void {
  const win = showRecorderWindow();
  const notify = () => {
    if (!win.isDestroyed()) win.webContents.send(IPC.recordingPrivacyWarningRequested);
  };
  if (win.webContents.isLoading()) {
    win.webContents.once("did-finish-load", notify);
  } else {
    notify();
  }
}

async function requestStartRecording(): Promise<StartResult> {
  if (recordingPrivacy.startDecision() === "start") return startRecording();
  showRecordingPrivacyWarning();
  return { ok: false, privacyWarningRequired: true };
}

/** Keep the full HUD and compact overlay mutually exclusive. */
function syncRecordingWindows(status: RecorderStatus): void {
  if (status.state === "recording") {
    if (libraryWindow && !libraryWindow.isDestroyed()) libraryWindow.close();
    if (recorderWindow && !recorderWindow.isDestroyed()) recorderWindow.hide();
    showRecordingControls();
    return;
  }
  // A start emits an idle/starting status before the session folder exists.
  if (status.transition === "starting") return;

  if (recordingControlsWindow && !recordingControlsWindow.isDestroyed()) {
    const controls = recordingControlsWindow;
    if (controlsExpanded) {
      setRecordingControlsExpanded(controls, false);
      controlsExpanded = false;
    }
    controls.hide();
    // Let an overlay-originated stop/discard IPC reply reach its renderer before
    // tearing that renderer down. A recording restarted in the same turn reuses it.
    setTimeout(() => {
      if (
        recorder.state === "idle" &&
        recordingControlsWindow === controls &&
        !controls.isDestroyed()
      ) {
        controls.destroy();
        recordingControlsWindow = null;
      }
    }, 500);
  }
  if (recorderWindow && !recorderWindow.isDestroyed()) {
    const wasHidden = !recorderWindow.isVisible();
    recorderWindow.show();
    if (wasHidden) recorderWindow.focus();
  }
}

function clampControlsToDisplay(): void {
  if (recordingControlsWindow && !recordingControlsWindow.isDestroyed()) {
    clampRecordingControlsWindow(recordingControlsWindow);
  }
}

/** Write the support diagnostics zip to the Desktop and show it. Logs outcomes only. */
async function saveDiagnostics(): Promise<void> {
  try {
    const file = await saveDiagnosticsToDesktop();
    shell.showItemInFolder(file);
  } catch (err) {
    log.error("Saving diagnostics failed:", err);
    dialog.showErrorBox("Couldn't save diagnostics", err instanceof Error ? err.message : String(err));
  }
}

app.whenReady().then(async () => {
  log.info(`Handover ${app.getVersion()} starting on ${process.platform}-${process.arch}`);
  if (isDenyNetworkEnabled()) {
    // Test-only switch: prove the app works with no network. Not a product feature.
    installWebRequestDeny(session.defaultSession.webRequest, (m) => log.warn(m));
    log.warn("HANDOVER_DENY_NETWORK=1: all non-local network access is blocked");
  }
  // SEC-3: no dictionary downloads from Google, no spell-checking of typed notes.
  session.defaultSession.setSpellCheckerEnabled(false);
  if (process.platform === "win32") Menu.setApplicationMenu(null);
  if (dock && app.dock) app.dock.setIcon(dock);

  narration.initialize();
  try {
    await microphones.initialize();
  } catch (error) {
    log.warn(
      "Microphone service initialization failed:",
      error instanceof Error ? error.message : error,
    );
  }
  try {
    await screens.initialize();
  } catch (error) {
    log.warn(
      "Screen source initialization failed:",
      error instanceof Error ? error.message : error,
    );
  }
  registerIpc(
    recorder,
    narration,
    microphones,
    screens,
    sensitiveModels,
    () => recordingStartPending,
    (sender) => {
      const controls = recordingControlsWindow;
      return Boolean(
        controls && !controls.isDestroyed() && sender === controls.webContents,
      );
    },
    (sender) => Boolean(libraryWindow && !libraryWindow.isDestroyed() && sender === libraryWindow.webContents),
    (sessionId) => review.evict(sessionId),
  );
  sensitiveModels.initialize();
  ipcMain.handle(IPC.start, () => requestStartRecording());
  ipcMain.handle(IPC.startConfirmed, () => startRecording());
  ipcMain.handle(IPC.recordingPrivacyReviewed, () => recordingPrivacy.markReviewed());
  log.info("Capture: recording all sources");

  ipcMain.handle(IPC.openLibrary, (_event, sessionId?: string) => openLibrary(sessionId));
  ipcMain.handle(IPC.takeLibrarySelection, (event) => {
    if (event.sender !== libraryWindow?.webContents) return null;
    const selected = pendingLibrarySelection;
    pendingLibrarySelection = null;
    return selected;
  });
  ipcMain.handle(IPC.closeLibrary, () => {
    if (libraryWindow && !libraryWindow.isDestroyed()) libraryWindow.close();
  });
  ipcMain.handle(IPC.terminalOpen, (event) => {
    const controls = recordingControlsWindow;
    if (!controls || controls.isDestroyed() || event.sender !== controls.webContents) {
      return { ok: false, error: "The recorded terminal can only be opened from the recording bar." };
    }
    return openRecordedTerminal();
  });
  ipcMain.handle(IPC.terminalReady, (event) => {
    const win = terminalWindow;
    if (
      !win ||
      win.isDestroyed() ||
      event.sender !== win.webContents ||
      !terminalSession
    ) {
      return { ok: false, error: "The recorded terminal is unavailable." };
    }
    const state = terminalSession.status().state;
    if (state === "closed" || state === "exited" || state === "error") {
      return terminalSession.start();
    }
    return { ok: true };
  });
  ipcMain.handle(IPC.terminalStatus, () =>
    terminalSession?.status() ?? emptyTerminalStatus(),
  );
  ipcMain.handle(IPC.terminalShells, () => [...(terminalSession?.shells ?? [])]);
  ipcMain.handle(IPC.terminalSwitchShell, (event, shellId: SupportedShellId) => {
    const win = terminalWindow;
    if (
      !win ||
      win.isDestroyed() ||
      event.sender !== win.webContents ||
      !terminalSession
    ) {
      return { ok: false, error: "The recorded terminal is unavailable." };
    }
    return terminalSession.switchShell(shellId);
  });
  ipcMain.on(IPC.terminalInput, (event, data: unknown) => {
    const win = terminalWindow;
    if (
      !win ||
      win.isDestroyed() ||
      event.sender !== win.webContents ||
      typeof data !== "string" ||
      data.length > 1_000_000
    ) {
      return;
    }
    terminalSession?.write(data);
  });
  ipcMain.on(
    IPC.terminalResize,
    (event, size: { columns?: unknown; rows?: unknown } | null) => {
      const win = terminalWindow;
      if (
        !win ||
        win.isDestroyed() ||
        event.sender !== win.webContents ||
        !size ||
        typeof size.columns !== "number" ||
        typeof size.rows !== "number"
      ) {
        return;
      }
      terminalSession?.resize(size.columns, size.rows);
    },
  );
  ipcMain.handle(IPC.terminalHide, (event) => {
    const win = terminalWindow;
    if (win && !win.isDestroyed() && event.sender === win.webContents) win.hide();
  });
  ipcMain.handle(IPC.recordingControlsExpanded, (event, expanded: boolean) => {
    const win = recordingControlsWindow;
    if (
      !win ||
      win.isDestroyed() ||
      event.sender !== win.webContents ||
      typeof expanded !== "boolean" ||
      recorder.state !== "recording"
    ) {
      return;
    }
    controlsExpanded = expanded;
    setRecordingControlsExpanded(win, expanded);
  });
  ipcMain.on(IPC.fitRecorderHeight, (event, height: unknown) => {
    const win = recorderWindow;
    if (
      !win ||
      win.isDestroyed() ||
      event.sender !== win.webContents ||
      typeof height !== "number"
    ) {
      return;
    }
    fitRecorderHeight(win, height);
  });

  const fromControls = (sender: Electron.WebContents): boolean => {
    const controls = recordingControlsWindow;
    return Boolean(controls && !controls.isDestroyed() && sender === controls.webContents);
  };
  const notAllowed: ActionResult = { ok: false, error: "This action is only available from the recording bar." };
  ipcMain.handle(IPC.pause, (event) => (fromControls(event.sender) ? recorder.pause() : notAllowed));
  ipcMain.handle(IPC.resume, (event) => (fromControls(event.sender) ? recorder.resume() : notAllowed));
  ipcMain.handle(IPC.explain, (event) => (fromControls(event.sender) ? startExplain() : notAllowed));
  ipcMain.handle(IPC.explainHotkey, () => explainHotkey.current());
  // Freeze overlay windows only; the coordinator ignores any other sender.
  ipcMain.handle(IPC.freezeInit, (event) => freeze.init(event.sender.id));
  ipcMain.on(IPC.freezeState, (event, state: unknown) => freeze.setState(event.sender.id, state));
  ipcMain.on(IPC.freezeReady, (event) => overlayReveal.get(event.sender.id)?.());
  ipcMain.handle(IPC.freezeDone, (event) => freeze.done(event.sender.id));
  ipcMain.handle(IPC.freezeCancel, (event) => freeze.cancel(event.sender.id));

  // Review (Library window only): build the steps with their edits, serve images, append edits.
  const fromLibrary = (sender: Electron.WebContents): boolean =>
    Boolean(libraryWindow && !libraryWindow.isDestroyed() && sender === libraryWindow.webContents);
  ipcMain.handle(IPC.reviewLoad, async (event, sessionId: unknown) => {
    if (!fromLibrary(event.sender) || !isValidSessionId(sessionId)) return { ok: false, error: "Unavailable." };
    try {
      return { ok: true, data: await review.load(sessionDir(sessionId), sessionId) };
    } catch (error) {
      log.warn("Review load failed:", error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle(IPC.reviewImage, (event, sessionId: unknown, imagePath: unknown) =>
    fromLibrary(event.sender) && isValidSessionId(sessionId) && typeof imagePath === "string"
      ? review.image(sessionId, imagePath)
      : null,
  );
  ipcMain.handle(IPC.reviewEdit, async (event, sessionId: unknown, edit: unknown) => {
    if (!fromLibrary(event.sender) || !isValidSessionId(sessionId) || !edit || typeof edit !== "object") {
      return { ok: false, error: "Unavailable." };
    }
    if (recorder.status().sessionId === sessionId) {
      return { ok: false, error: "This recording is still in progress." };
    }
    try {
      return { ok: true, data: await review.applyEdit(sessionDir(sessionId), sessionId, edit as ReviewEditInput) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  recorder.onStatusChanged((status) => {
    // Before the bar is shown, so its Explain hotkey query already sees the registration.
    explainHotkey.sync(status.state === "recording");
    broadcast(IPC.statusChanged, status);
    syncRecordingWindows(status);
  });
  recorderWindow = createRecorderWindow();

  const handleDisplayChange = (reason: string, affectsOverlay = true) => {
    log.info(`Display layout changed (${reason}), ${screen.getAllDisplays().length} display(s)`);
    // Overlay windows sized for the old layout are wrong: end the freeze, unsaved (APP-7, APP-4).
    // A work-area-only change (taskbar moved) does not move or resize a full-screen overlay.
    if (affectsOverlay) freeze.displaysChanged();
    clampControlsToDisplay();
    void screens.refresh();
    recorder.publishDisplays();
  };
  screen.on("display-added", () => handleDisplayChange("added"));
  screen.on("display-removed", () => handleDisplayChange("removed"));
  screen.on("display-metrics-changed", (_event, _display, changed) =>
    handleDisplayChange("metrics", changed.includes("bounds") || changed.includes("scaleFactor")),
  );

  try {
    createTray(
      recorder,
      requestStartRecording,
      requestStopRecording,
      showRecorderWindow,
      showRecordingControls,
      () => void saveDiagnostics(),
    );
  } catch (err) {
    log.warn("Tray unavailable:", err);
  }

  const toggle = () => {
    const status = recorder.status();
    if (status.transition !== "none") return;
    void (status.state === "recording" ? requestStopRecording() : requestStartRecording());
  };
  if (!globalShortcut.register("CommandOrControl+Shift+R", toggle)) {
    log.warn("Global shortcut registration failed");
  }
  instanceReady?.();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (quitReady) return;
  event.preventDefault();
  if (quitTask) return;
  quitTask = (async () => {
    const terminal = terminalSession?.busyDetails() ?? { busy: false, command: null };
    if (terminal.busy) {
      const { response } = await dialog.showMessageBox({
        type: "warning",
        buttons: ["Keep recording", "Close terminal and quit"],
        defaultId: 0,
        cancelId: 0,
        message: "A terminal command is still running.",
        detail: terminal.command
          ? `Closing Handover will interrupt: ${terminal.command}`
          : "Closing Handover will interrupt the active terminal session.",
      });
      if (response === 0) return;
    }
    recorder.beginShutdown();
    // stop() is serialized behind any start/mic/discard operation already in
    // flight, and is a harmless "Not recording" result when the app is idle.
    await recorder.stop(terminal.busy);
    await recorder.whenProcessed();
    quitReady = true;
    app.quit();
  })()
    .catch((error) => {
      log.warn("graceful shutdown failed:", error);
      quitReady = true;
      app.quit();
    })
    .finally(() => {
      quitTask = null;
    });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  microphones.dispose();
  void sensitiveModels.dispose();
});
