// One place for the webPreferences every Handover window gets, so no window can forget the hardening.
// SEC-3: spellcheck is off everywhere. On Windows Chromium downloads dictionaries from Google when
// spellcheck is on, which is a network call the privacy floors do not allow (and typed text is checked).
// SEC-10: the freeze overlay is marked so the shared preload exposes only the freeze channels to it.

import type { WebPreferences } from "electron";

export interface WindowPreferenceOptions {
  /** Absolute path of the preload script. */
  preload: string;
  backgroundThrottling?: boolean;
  /** `freeze`: the overlay window, which gets the freeze channels only and a sandboxed renderer. */
  kind?: "freeze";
}

export const WINDOW_KIND_ARG = "--handover-window=";

export function windowPreferences(opts: WindowPreferenceOptions): WebPreferences {
  return {
    preload: opts.preload,
    contextIsolation: true,
    nodeIntegration: false,
    // The freeze preload needs only `electron`, so that window can be sandboxed; the others use Node
    // in their preload and are left as they were.
    sandbox: opts.kind === "freeze",
    spellcheck: false,
    ...(opts.backgroundThrottling === false ? { backgroundThrottling: false } : {}),
    ...(opts.kind ? { additionalArguments: [`${WINDOW_KIND_ARG}${opts.kind}`] } : {}),
  };
}
