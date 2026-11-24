// Maps the native helper's tracker report to the manifest's `capture.helper` (tester-package.md §3).
// The recorder writes the result to `helper.json` in the session folder when a recording stops, so
// an export made later (or after a restart) still reports the helper as it was during recording.

import type { HelperDoctorInfo } from "../ipc";
import type { HelperStatus } from "./types";

export const HELPER_FILE = "helper.json";

/**
 * `present` means the helper ran: it reported its version. A binary that was never started, was
 * missing, or crashed before `hello` is not present. `error` carries the tracker's last error
 * when the helper is not in a good state (missing, crashed, no permission).
 */
export function helperStatusFrom(report: HelperDoctorInfo): HelperStatus {
  const ran = report.version !== null && report.helper !== "missing";
  return {
    present: ran,
    ...(report.version ? { version: report.version } : {}),
    ...(report.helper !== "ok" && report.lastError ? { error: report.lastError } : {}),
  };
}

/** Parse `helper.json`; anything malformed is reported as a helper that did not run. */
export function parseHelperStatus(raw: string): HelperStatus {
  try {
    const v = JSON.parse(raw) as Partial<HelperStatus>;
    return {
      present: v.present === true,
      ...(typeof v.version === "string" ? { version: v.version } : {}),
      ...(typeof v.error === "string" ? { error: v.error } : {}),
    };
  } catch {
    return { present: false, error: "helper status file unreadable" };
  }
}
