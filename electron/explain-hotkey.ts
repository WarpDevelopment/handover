// APP-8: the Explain hotkey (Ctrl/Cmd+Shift+E) is held system-wide only while a recording is running.
// Registered all the time it blocks Word's Track Changes and VS Code's Explorer shortcut.

import { registerHotkey, type HotkeyLog } from "./hotkeys";

export interface UnregisterableShortcuts {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

export class ExplainHotkey {
  private held = false;

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
    if (recording && !this.held) {
      this.held = registerHotkey(this.shortcuts, this.accelerator, this.handler, this.log);
    } else if (!recording && this.held) {
      this.held = false;
      try {
        this.shortcuts.unregister(this.accelerator);
      } catch (error) {
        this.log.warn(`Global shortcut ${this.accelerator} could not be released.`, error);
      }
    }
  }
}
