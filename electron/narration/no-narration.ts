/**
 * A recording made with Narrate off has no audio. That is normal, not a
 * failure, so it must not be logged as a warning after every recording.
 */
export const NO_NARRATION_ERROR = "This recording has no saved narration.";

export interface CachedTranscriptionResult {
  ok: boolean;
  error?: string;
  outcome?: string;
}

/** True only for a real failure of the post-recording transcription. */
export function shouldWarnCachedTranscriptionFailure(result: CachedTranscriptionResult): boolean {
  if (result.ok) return false;
  if (result.outcome === "model-missing") return false;
  if (result.error === NO_NARRATION_ERROR) return false;
  return true;
}
