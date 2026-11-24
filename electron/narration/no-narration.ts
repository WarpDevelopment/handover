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

export interface CachedTranscriptionDeps {
  modelCached(): boolean;
  isValidSessionId(id: string): boolean;
  transcribe(id: string): Promise<CachedTranscriptionResult>;
  warn(...args: unknown[]): void;
}

/**
 * Transcribe a just-finished recording when the voice model is already on disk, and warn only about a
 * real failure. `dir` is the session folder; its name is the session id.
 */
export async function transcribeIfCachedWith(deps: CachedTranscriptionDeps, dir: string): Promise<void> {
  if (!deps.modelCached()) return;
  const id = dir.split(/[\\/]/).filter(Boolean).pop() ?? "";
  if (!deps.isValidSessionId(id)) return;
  const result = await deps.transcribe(id);
  if (shouldWarnCachedTranscriptionFailure(result)) {
    deps.warn("cached narration transcription failed:", result.error);
  }
}

/** True only for a real failure of the post-recording transcription. */
export function shouldWarnCachedTranscriptionFailure(result: CachedTranscriptionResult): boolean {
  if (result.ok) return false;
  if (result.outcome === "model-missing") return false;
  if (result.error === NO_NARRATION_ERROR) return false;
  return true;
}
