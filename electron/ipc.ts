import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type SaveDialogOptions,
  type WebContents,
} from "electron";
import { mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { PROCESS_FILE } from "../common/handover/read-session";
import type {
  DebugBundleResult,
  DeleteSessionResult,
  ExportPackageResult,
  MicrophoneSettingsResult,
  ScreenSettingsResult,
} from "../common/ipc";
import { IPC } from "../common/ipc";
import type { NarrationLanguage } from "../common/narration";
import { buildDebugInfo, writeDebugBundle } from "./debug-bundle";
import { runDoctor } from "./doctor";
import { createLogger } from "./logger";
import type { AudioRecorder } from "./audio/recorder";
import type { NarrationManager } from "./narration/manager";
import type { RecorderController } from "./recorder/controller";
import type { ScreenSourceService } from "./video/sources";
import { exportPackage, newPackageId, suggestedZipName } from "./export";
import { isReviewed, markReviewed, narrationHash } from "./reviewed-marker";
import { deleteSessionFlow } from "./session-delete";
import { exportBlockedReason, markReviewedGuarded } from "./review-gate";
import { isValidSessionId, sessionDir, sessionsRoot } from "./recorder/session-store";
import type { SensitiveModelManager } from "./sensitive/model-manager";
import { deleteSession, listSessions } from "./sessions";

const log = createLogger("IPC");

/** The process title from the start sheet, or the session id until a start sheet exists. */
function readTitle(sessionId: string): string {
  try {
    const raw = JSON.parse(readFileSync(path.join(sessionDir(sessionId), PROCESS_FILE), "utf8")) as {
      title?: unknown;
    };
    if (typeof raw.title === "string" && raw.title.trim()) return raw.title;
  } catch {
    // no start sheet yet
  }
  return `Recorded process ${sessionId}`;
}

/** Wire the renderer-facing invoke channels to the recorder, narration, library + doctor. */
export function registerIpc(
  recorder: RecorderController,
  narration: NarrationManager,
  microphones: AudioRecorder,
  screens: ScreenSourceService,
  sensitiveModels: SensitiveModelManager,
  isRecordingStartPending: () => boolean,
  canForceTerminalFinish: (sender: WebContents) => boolean,
  isLibrarySender: (sender: WebContents) => boolean,
  onSessionDeleted: (sessionId: string) => void,
  /**
   * The narration hash the loaded review was built from (`ReviewService.currentNarrationSha256`), or null
   * when that session is not loaded. Optional only until main.ts passes it; without it "Done reviewing" is
   * refused, never allowed (N3).
   */
  currentNarrationSha256?: (sessionId: string) => string | null,
): void {
  const unavailable = { ok: false, error: "This action is only available from the Sessions window." } as const;
  ipcMain.handle(IPC.stop, (event, forceTerminal?: boolean) => {
    if (forceTerminal === true && !canForceTerminalFinish(event.sender)) {
      return { ok: false, error: "Terminal interruption confirmation is unavailable." };
    }
    return recorder.stop(forceTerminal === true);
  });
  ipcMain.handle(IPC.discard, (event, forceTerminal?: boolean) => {
    if (forceTerminal === true && !canForceTerminalFinish(event.sender)) {
      return { ok: false, error: "Terminal interruption confirmation is unavailable." };
    }
    return recorder.discard(forceTerminal === true);
  });
  ipcMain.handle(IPC.microphone, (_event, enabled: boolean) =>
    recorder.setMicrophoneEnabled(enabled, microphones.effectiveDeviceId()),
  );
  ipcMain.handle(IPC.microphoneSettings, () => microphones.settings());
  ipcMain.handle(
    IPC.microphoneNarration,
    async (_event, enabled: boolean): Promise<MicrophoneSettingsResult> => {
      if (typeof enabled !== "boolean") {
        return {
          ok: false,
          status: microphones.settings(),
          error: "Invalid narration preference.",
        };
      }
      if (recorder.state === "recording" || isRecordingStartPending()) {
        return {
          ok: false,
          status: microphones.settings(),
          error: "Choose the next recording's narration state after this recording ends.",
        };
      }
      return microphones.setNarrationEnabled(enabled);
    },
  );
  ipcMain.handle(IPC.screenSettings, () => screens.refresh());
  ipcMain.handle(
    IPC.screenSource,
    async (_event, sourceId: string): Promise<ScreenSettingsResult> => {
      if (typeof sourceId !== "string" || !sourceId) {
        return {
          ok: false,
          status: screens.settings(),
          error: "Invalid screen selection.",
        };
      }
      if (recorder.state === "recording") {
        return {
          ok: false,
          status: screens.settings(),
          error: "Choose the next recording's screen after this recording ends.",
        };
      }
      return screens.selectSource(sourceId);
    },
  );
  ipcMain.handle(
    IPC.microphoneDevice,
    async (_event, deviceId: string): Promise<MicrophoneSettingsResult> => {
      if (typeof deviceId !== "string" || !deviceId) {
        return {
          ok: false,
          status: microphones.settings(),
          error: "Invalid microphone selection.",
        };
      }
      const previousDeviceId = microphones.effectiveDeviceId();
      const selected = await microphones.selectDevice(deviceId);
      if (
        !selected.ok ||
        recorder.status().microphone.state !== "on" ||
        microphones.effectiveDeviceId() === previousDeviceId
      ) {
        return selected;
      }
      const switched = await recorder.setMicrophoneDevice(
        microphones.effectiveDeviceId(),
      );
      if (!switched.ok) {
        return {
          ok: false,
          status: microphones.settings(),
          error: switched.error ?? "Could not switch microphones.",
        };
      }
      return { ok: true, status: microphones.settings() };
    },
  );
  ipcMain.handle(IPC.narrationLanguage, (_event, language: NarrationLanguage) =>
    recorder.setNarrationLanguage(language),
  );
  ipcMain.handle(IPC.status, () => recorder.status());
  ipcMain.handle(IPC.marker, (_event, note: string) => recorder.marker(note));
  ipcMain.handle(IPC.doctor, () => runDoctor());
  ipcMain.handle(IPC.narrationStatus, () => narration.status());
  ipcMain.handle(IPC.narrationTranscribe, (_event, sessionId: string) =>
    narration.transcribeSession(sessionId),
  );

  ipcMain.handle(IPC.sensitiveModelStatus, () => sensitiveModels.status());
  ipcMain.handle(IPC.sensitiveSetAdvanced, (_event, enabled: boolean) => {
    if (typeof enabled !== "boolean") return { ok: false, error: "Invalid preference." };
    return sensitiveModels.setAdvanced(enabled);
  });
  ipcMain.handle(IPC.sensitiveDownloadModels, () => sensitiveModels.downloadModels());

  ipcMain.handle(IPC.listSessions, () => listSessions());

  ipcMain.handle(IPC.openSessionsFolder, async (): Promise<{ ok: boolean; error?: string }> => {
    const root = sessionsRoot();
    try {
      mkdirSync(root, { recursive: true });
      const failure = await shell.openPath(root);
      return failure ? { ok: false, error: failure } : { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.warn("open sessions folder failed:", error);
      return { ok: false, error };
    }
  });

  ipcMain.handle(IPC.deleteSession, async (event, sessionId: string): Promise<DeleteSessionResult> => {
    if (!isLibrarySender(event.sender)) return unavailable;
    return deleteSessionFlow(sessionId, {
      isRecording: (id) => recorder.status().sessionId === id,
      isTranscribing: (id) => narration.isBusyWith(id),
      deleteSession,
      forget: [
        (id) => recorder.forgetSession(id), // clear the "last completed" pointer if it was this one
        onSessionDeleted, // and the review's cached pictures (APP-9)
      ],
      warn: (m) => log.warn(m),
    });
  });

  ipcMain.handle(
    IPC.exportPackage,
    async (event, sessionId: string): Promise<ExportPackageResult> => {
      if (!isLibrarySender(event.sender)) return unavailable;
      if (!isValidSessionId(sessionId)) return { ok: false, error: "Unknown session." };
      const blocked = await exportBlockedReason(sessionId, {
        isRecording: (id) => recorder.status().sessionId === id,
        isTranscribing: (id) => narration.isBusyWith(id),
        isReviewed: (id) => isReviewed(sessionDir(id)),
      });
      if (blocked) return { ok: false, error: blocked };
      const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const packageId = newPackageId();
      const opts: SaveDialogOptions = {
        title: "Export Handover package",
        defaultPath: path.join(os.homedir(), "Downloads", suggestedZipName(readTitle(sessionId), packageId)),
        filters: [{ name: "Zip archive", extensions: ["zip"] }],
      };
      const picked = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      if (picked.canceled || !picked.filePath) return { ok: false, canceled: true };
      const result = await exportPackage({
        sessionDir: sessionDir(sessionId),
        destZip: picked.filePath,
        packageId,
        toolVersion: app.getVersion(),
      });
      if (result.zip) shell.showItemInFolder(result.zip);
      if (!result.ok) log.warn("package export problem:", result.error, result.validationErrors ?? "");
      return result;
    },
  );

  ipcMain.handle(IPC.markReviewed, (event, sessionId: unknown) =>
    markReviewedGuarded(sessionId, {
      isLibrarySender: () => isLibrarySender(event.sender),
      isValidSessionId,
      isRecording: (id) => recorder.status().sessionId === id,
      isTranscribing: (id) => narration.isBusyWith(id),
      currentNarrationSha256,
      diskNarrationSha256: (id) => narrationHash(sessionDir(id)),
      mark: async (id) => {
        await markReviewed(sessionDir(id));
      },
      warn: (m) => log.warn(m),
    }),
  );

  ipcMain.handle(
    IPC.exportDebugBundle,
    async (event, sessionId: string): Promise<DebugBundleResult> => {
      if (!isLibrarySender(event.sender)) return unavailable;
      if (!isValidSessionId(sessionId)) return { ok: false, error: "Unknown session." };
      // The session folder is still being written while it records; refuse to zip
      // a moving target.
      if (recorder.status().sessionId === sessionId) {
        return {
          ok: false,
          error: "You can't download details while this recording is still in progress.",
        };
      }
      const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const opts: SaveDialogOptions = {
        title: "Download session details",
        defaultPath: path.join(
          os.homedir(),
          "Downloads",
          `handover-debug-${sessionId}.zip`,
        ),
        filters: [{ name: "Zip archive", extensions: ["zip"] }],
      };
      const result = win
        ? await dialog.showSaveDialog(win, opts)
        : await dialog.showSaveDialog(opts);
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      try {
        await writeDebugBundle(sessionId, result.filePath, buildDebugInfo(sessionId));
        shell.showItemInFolder(result.filePath); // hand the file to the user to attach
        return { ok: true, path: result.filePath };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        log.warn("debug bundle failed:", error);
        return { ok: false, error };
      }
    },
  );
}
