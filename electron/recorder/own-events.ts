// Events that describe Handover's own windows, not the user's work (APP-3). Clicking the recording
// bar makes Handover the foreground app; that switch must not become a "Switch to Handover" step.

import type { EventInput } from "../../common/events";

const OWN_APP_NAMES: ReadonlySet<string> = new Set(["handover", "electron"]);

function isOwnName(name: unknown): boolean {
  if (typeof name !== "string") return false;
  return OWN_APP_NAMES.has(name.trim().toLowerCase().replace(/\.exe$/, ""));
}

/** True for an app/title/url event whose app is this process (by pid) or is named Handover/Electron. */
export function isOwnAppEvent(input: EventInput, ownPid: number = process.pid): boolean {
  if (
    input.type !== "app.activate" &&
    input.type !== "app.title-change" &&
    input.type !== "browser.url"
  ) {
    return false;
  }
  const payload = input.payload as { app?: unknown; pid?: unknown };
  if (typeof payload.pid === "number" && payload.pid === ownPid) return true;
  return isOwnName(payload.app);
}
