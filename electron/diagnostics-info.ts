import os from "node:os";
import path from "node:path";

import { app, screen, systemPreferences } from "electron";

import { FULL_CAPTURE } from "../common/config";
import { isDenyNetworkEnabled } from "./network-guard";
import { runDoctor } from "./doctor";
import { diagnosticsFileName, writeDiagnosticsZip, type DiagnosticsInfo } from "./diagnostics";
import { createLogger } from "./logger";
import { sessionsRoot } from "./recorder/session-store";

const log = createLogger("Diagnostics");

type Safe<T> = T | { error: string };

function safe<T>(fn: () => T): Safe<T> {
  try {
    return fn();
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function permissions(): Record<string, unknown> {
  if (process.platform !== "darwin") return { note: "not applicable on this platform" };
  return {
    screenRecording: safe(() => systemPreferences.getMediaAccessStatus("screen")),
    microphone: safe(() => systemPreferences.getMediaAccessStatus("microphone")),
    accessibility: safe(() => systemPreferences.isTrustedAccessibilityClient(false)),
  };
}

/** Collect machine state for the diagnostics zip. No recording content. */
export function collectDiagnosticsInfo(): DiagnosticsInfo {
  return {
    generatedAt: new Date().toISOString(),
    app: {
      name: app.getName(),
      version: app.getVersion(),
      locale: safe(() => app.getLocale()),
      packaged: app.isPackaged,
    },
    runtime: {
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      versions: process.versions,
    },
    displays: safe(() =>
      screen.getAllDisplays().map((d) => ({
        id: d.id,
        bounds: d.bounds,
        scaleFactor: d.scaleFactor,
        internal: d.internal,
      })),
    ),
    permissions: permissions(),
    captureSources: FULL_CAPTURE,
    networkDenied: isDenyNetworkEnabled(),
    // Includes the native helper's status once the doctor reports it.
    doctor: safe(() => runDoctor()),
  };
}

/** Write the diagnostics zip to the user's Desktop and return its path. */
export async function saveDiagnosticsToDesktop(): Promise<string> {
  const dest = path.join(app.getPath("desktop"), diagnosticsFileName());
  await writeDiagnosticsZip(dest, {
    info: collectDiagnosticsInfo(),
    logDir: path.join(app.getPath("userData"), "logs"),
    sessionsDir: sessionsRoot(),
  });
  log.info("diagnostics zip written");
  return dest;
}
