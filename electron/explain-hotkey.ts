// APP-8: the Explain hotkey (Ctrl/Cmd+Shift+E) is held system-wide only while a recording is running.
// Registered all the time it blocks Word's Track Changes and VS Code's Explorer shortcut.

import { registerHotkey, type HotkeyLog } from "./hotkeys";

export interface UnregisterableShortcuts {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

export class ExplainHotkey {
  private held = false;
  /** A registration was attempted during this recording; reset when it stops. */
  private tried = false;

  constructor(
    private readonly shortcuts: UnregisterableShortcuts,
    private readonly accelerator: string,
    private readonly handler: () => void,
    private readonly log: HotkeyLog,
  ) {}

  /** The accelerator while it is registered, else null (the bar's Explain button still works). */
  current(): string | null {
    return this.held ? this.accelerator : null;
  }

  /** Register on a recording start, release on its stop. Safe to call on every status change. */
  sync(recording: boolean): void {
    if (recording) {
      // Once per recording (N2): status changes arrive on every event, and a hotkey another app owns
      // would otherwise be retried, and logged as a failure, on each one.
      if (this.tried) return;
      this.tried = true;
      this.held = registerHotkey(this.shortcuts, this.accelerator, this.handler, this.log);
      return;
    }
    this.tried = false;
    if (this.held) {
      this.held = false;
      try {
        this.shortcuts.unregister(this.accelerator);
      } catch (error) {
        this.log.warn(`Global shortcut ${this.accelerator} could not be released.`, error);
      }
    }
  }
}
