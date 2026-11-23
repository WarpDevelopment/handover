// Global hotkey registration that never throws. A hotkey can fail to register (another app owns it,
// or the OS refuses); the recording bar's buttons still work, so this only reports and logs.

export interface ShortcutRegistry {
  register(accelerator: string, callback: () => void): boolean;
}

export interface HotkeyLog {
  warn(...args: unknown[]): void;
}

/** Register `accelerator`. Returns true when it is active; on any failure logs and returns false. */
export function registerHotkey(
  shortcuts: ShortcutRegistry,
  accelerator: string,
  handler: () => void,
  log: HotkeyLog,
): boolean {
  try {
    if (shortcuts.register(accelerator, handler)) return true;
    log.warn(`Global shortcut ${accelerator} could not be registered; use the button on the recording bar.`);
  } catch (error) {
    log.warn(`Global shortcut ${accelerator} failed to register; use the button on the recording bar.`, error);
  }
  return false;
}
