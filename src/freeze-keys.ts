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
 * Enter saves the note, but only when this window really holds the keyboard. When it does not, the
 * keystrokes are going to the app underneath (in Outlook, Enter could send an email), and a "save"
 * here would be a guess about what the user meant.
 */
export function enterShouldSave(k: KeyFacts): boolean {
  return k.key === "Enter" && !k.shiftKey && !k.targetIsButton && k.documentHasFocus;
}
