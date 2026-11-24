// Keyboard rules of the Explain overlay, kept pure so they are unit-tested (APP-2).

export interface KeyFacts {
  key: string;
  shiftKey: boolean;
  /** The key went to a button, where Enter means "press this button". */
  targetIsButton: boolean;
  /** `document.hasFocus()`: false when Windows refused the overlay the keyboard. */
  documentHasFocus: boolean;
}

/**
 * The "click here to type" banner is for the one overlay that is meant to hold the keyboard (the primary
 * display's), and only once the main process's focus retry has failed. Secondary displays never show it,
 * and neither does a window that has the keyboard.
 */
export function showFocusBanner(f: { primary: boolean; focusFailed: boolean; documentHasFocus: boolean }): boolean {
  return f.primary && f.focusFailed && !f.documentHasFocus;
}

/**
 * Enter saves the note, but only when this window really holds the keyboard. When it does not, the
 * keystrokes are going to the app underneath (in Outlook, Enter could send an email), and a "save"
 * here would be a guess about what the user meant.
 */
export function enterShouldSave(k: KeyFacts): boolean {
  return k.key === "Enter" && !k.shiftKey && !k.targetIsButton && k.documentHasFocus;
}
