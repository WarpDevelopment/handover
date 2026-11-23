// Preload bridge — CommonJS on purpose (runs in the renderer's isolated world).
// Keep channel strings in sync with common/ipc.ts.
const { contextBridge, ipcRenderer } = require("electron");

const IPC = {
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
  narrationDownload: "narration:download",
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
};

let recordingPrivacyWarningPending = false;
let recordingPrivacyWarningCallback = null;
ipcRenderer.on(IPC.recordingPrivacyWarningRequested, () => {
  if (recordingPrivacyWarningCallback) {
    recordingPrivacyWarningCallback();
    return;
  }
  recordingPrivacyWarningPending = true;
});

contextBridge.exposeInMainWorld("handover", {
  start: () => ipcRenderer.invoke(IPC.start),
  confirmStart: () => ipcRenderer.invoke(IPC.startConfirmed),
  markRecordingPrivacyReviewed: () => ipcRenderer.invoke(IPC.recordingPrivacyReviewed),
  onRecordingPrivacyWarningRequested: (cb) => {
    recordingPrivacyWarningCallback = cb;
    if (recordingPrivacyWarningPending) {
      recordingPrivacyWarningPending = false;
      cb();
    }
    return () => {
      if (recordingPrivacyWarningCallback === cb) recordingPrivacyWarningCallback = null;
    };
  },
  stop: (forceTerminal) => ipcRenderer.invoke(IPC.stop, forceTerminal),
  discard: (forceTerminal) => ipcRenderer.invoke(IPC.discard, forceTerminal),
  setMicrophoneEnabled: (enabled) => ipcRenderer.invoke(IPC.microphone, enabled),
  setNarrationLanguage: (language) => ipcRenderer.invoke(IPC.narrationLanguage, language),
  microphoneSettings: () => ipcRenderer.invoke(IPC.microphoneSettings),
  setNarrationEnabled: (enabled) => ipcRenderer.invoke(IPC.microphoneNarration, enabled),
  selectMicrophone: (deviceId) => ipcRenderer.invoke(IPC.microphoneDevice, deviceId),
  onMicrophoneSettingsChanged: (cb) => {
    const listener = (_event, status) => cb(status);
    ipcRenderer.on(IPC.microphoneSettingsChanged, listener);
    return () => ipcRenderer.removeListener(IPC.microphoneSettingsChanged, listener);
  },
  screenSettings: () => ipcRenderer.invoke(IPC.screenSettings),
  selectScreen: (sourceId) => ipcRenderer.invoke(IPC.screenSource, sourceId),
  onScreenSettingsChanged: (cb) => {
    const listener = (_event, status) => cb(status);
    ipcRenderer.on(IPC.screenSettingsChanged, listener);
    return () => ipcRenderer.removeListener(IPC.screenSettingsChanged, listener);
  },
  status: () => ipcRenderer.invoke(IPC.status),
  marker: (note) => ipcRenderer.invoke(IPC.marker, note),
  doctor: () => ipcRenderer.invoke(IPC.doctor),
  onStatusChanged: (cb) => {
    const listener = (_event, status) => cb(status);
    ipcRenderer.on(IPC.statusChanged, listener);
    return () => ipcRenderer.removeListener(IPC.statusChanged, listener);
  },
  openTerminal: () => ipcRenderer.invoke(IPC.terminalOpen),
  terminalReady: () => ipcRenderer.invoke(IPC.terminalReady),
  terminalStatus: () => ipcRenderer.invoke(IPC.terminalStatus),
  terminalShells: () => ipcRenderer.invoke(IPC.terminalShells),
  switchTerminalShell: (shell) => ipcRenderer.invoke(IPC.terminalSwitchShell, shell),
  writeTerminal: (data) => ipcRenderer.send(IPC.terminalInput, data),
  resizeTerminal: (columns, rows) =>
    ipcRenderer.send(IPC.terminalResize, { columns, rows }),
  hideTerminal: () => ipcRenderer.invoke(IPC.terminalHide),
  onTerminalStatusChanged: (cb) => {
    const listener = (_event, status) => cb(status);
    ipcRenderer.on(IPC.terminalStatusChanged, listener);
    return () => ipcRenderer.removeListener(IPC.terminalStatusChanged, listener);
  },
  onTerminalFinishConfirmationRequested: (cb) => {
    const listener = () => cb();
    ipcRenderer.on(IPC.terminalFinishConfirmationRequested, listener);
    return () =>
      ipcRenderer.removeListener(IPC.terminalFinishConfirmationRequested, listener);
  },
  onTerminalOutput: (cb) => {
    const listener = (_event, data) => cb(data);
    ipcRenderer.on(IPC.terminalOutput, listener);
    return () => ipcRenderer.removeListener(IPC.terminalOutput, listener);
  },
  narrationStatus: () => ipcRenderer.invoke(IPC.narrationStatus),
  downloadNarrationModel: () => ipcRenderer.invoke(IPC.narrationDownload),
  transcribeNarration: (sessionId) => ipcRenderer.invoke(IPC.narrationTranscribe, sessionId),
  onNarrationStatusChanged: (cb) => {
    const listener = (_event, status) => cb(status);
    ipcRenderer.on(IPC.narrationStatusChanged, listener);
    return () => ipcRenderer.removeListener(IPC.narrationStatusChanged, listener);
  },
  sensitiveModelStatus: () => ipcRenderer.invoke(IPC.sensitiveModelStatus),
  setAdvancedProtection: (enabled) => ipcRenderer.invoke(IPC.sensitiveSetAdvanced, enabled),
  downloadSensitiveModels: () => ipcRenderer.invoke(IPC.sensitiveDownloadModels),
  onSensitiveModelStatusChanged: (cb) => {
    const listener = (_event, status) => cb(status);
    ipcRenderer.on(IPC.sensitiveStatusChanged, listener);
    return () => ipcRenderer.removeListener(IPC.sensitiveStatusChanged, listener);
  },
  listSessions: () => ipcRenderer.invoke(IPC.listSessions),
  openSessionsFolder: () => ipcRenderer.invoke(IPC.openSessionsFolder),
  onSessionsChanged: (cb) => {
    const listener = () => cb();
    ipcRenderer.on(IPC.sessionsChanged, listener);
    return () => ipcRenderer.removeListener(IPC.sessionsChanged, listener);
  },
  onLibrarySelection: (cb) => {
    const listener = () => cb();
    ipcRenderer.on(IPC.librarySelection, listener);
    return () => ipcRenderer.removeListener(IPC.librarySelection, listener);
  },
  takeLibrarySelection: () => ipcRenderer.invoke(IPC.takeLibrarySelection),
  deleteSession: (sessionId) => ipcRenderer.invoke(IPC.deleteSession, sessionId),
  exportDebugBundle: (sessionId) => ipcRenderer.invoke(IPC.exportDebugBundle, sessionId),
  openLibrary: (sessionId) => ipcRenderer.invoke(IPC.openLibrary, sessionId),
  closeLibrary: () => ipcRenderer.invoke(IPC.closeLibrary),
  setRecordingControlsExpanded: (expanded) =>
    ipcRenderer.invoke(IPC.recordingControlsExpanded, expanded),
  fitRecorderHeight: (height) => ipcRenderer.send(IPC.fitRecorderHeight, height),
});
