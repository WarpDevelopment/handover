// D2: the transcript is part of the package, so a recording whose narration is still being transcribed can
// be neither marked reviewed nor exported: what the user saw would not be what is exported.

export const NARRATION_BUSY_MESSAGE = "Narration is still being transcribed; wait and review again.";

/** The refusal message, or null when review and export may go ahead. */
export function reviewBlockedReason(sessionId: string, isTranscribing: (id: string) => boolean): string | null {
  return isTranscribing(sessionId) ? NARRATION_BUSY_MESSAGE : null;
}
