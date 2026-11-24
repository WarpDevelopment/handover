// The checks in front of "Done reviewing" and Export (D2, N3). Electron-free, with collaborators injected, so
// the IPC handlers in ipc.ts stay thin and these rules are unit-tested with fakes.
//
// The transcript is part of the package, so what the user reviewed must be what is exported: a recording
// whose narration is being transcribed, or whose narration.json differs from the one the review was built
// from, can be neither marked reviewed nor exported.

export const NARRATION_BUSY_MESSAGE = "Narration is still being transcribed; wait and review again.";
export const NARRATION_CHANGED_MESSAGE = "The narration changed since you opened the review; reopen it.";
export const REVIEW_NOT_LOADED_MESSAGE = "Open the review again before marking it done.";

/** The refusal message, or null when review and export may go ahead. */
export function reviewBlockedReason(sessionId: string, isTranscribing: (id: string) => boolean): string | null {
  return isTranscribing(sessionId) ? NARRATION_BUSY_MESSAGE : null;
}

export const EXPORT_NOT_REVIEWED_MESSAGE = "Review the steps and choose Done reviewing before exporting.";

export interface ExportGateDeps {
  isRecording(id: string): boolean;
  isTranscribing(id: string): boolean;
  isReviewed(id: string): Promise<boolean>;
}

/** Why this recording cannot be exported right now, or null when it can. */
export async function exportBlockedReason(sessionId: string, deps: ExportGateDeps): Promise<string | null> {
  if (deps.isRecording(sessionId)) return "You can't export a recording while it's still in progress.";
  const narrating = reviewBlockedReason(sessionId, deps.isTranscribing);
  if (narrating) return narrating;
  // SEC-2: the manifest says the user reviewed it, so they must have, and not edited since.
  if (!(await deps.isReviewed(sessionId))) return EXPORT_NOT_REVIEWED_MESSAGE;
  return null;
}

export interface MarkReviewedDeps {
  isLibrarySender(): boolean;
  isValidSessionId(id: unknown): id is string;
  isRecording(id: string): boolean;
  isTranscribing(id: string): boolean;
  /** The narration hash the loaded review was built from; null when that session is not the loaded one. */
  currentNarrationSha256?: (id: string) => string | null;
  /** The hash of narration.json on disk now. */
  diskNarrationSha256(id: string): Promise<string>;
  mark(id: string): Promise<void>;
  warn?(message: string): void;
}

export async function markReviewedGuarded(sessionId: unknown, deps: MarkReviewedDeps): Promise<{ ok: boolean; error?: string }> {
  if (!deps.isLibrarySender() || !deps.isValidSessionId(sessionId)) return { ok: false };
  if (deps.isRecording(sessionId)) return { ok: false };
  const blocked = reviewBlockedReason(sessionId, deps.isTranscribing);
  if (blocked) return { ok: false, error: blocked };
  try {
    // Fail closed: with no way to know what the review was built from, or no review loaded, refuse.
    const reviewed = deps.currentNarrationSha256?.(sessionId) ?? null;
    if (reviewed === null) return { ok: false, error: REVIEW_NOT_LOADED_MESSAGE };
    if (reviewed !== (await deps.diskNarrationSha256(sessionId))) {
      return { ok: false, error: NARRATION_CHANGED_MESSAGE };
    }
    await deps.mark(sessionId);
    return { ok: true };
  } catch (err) {
    deps.warn?.(`mark reviewed failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false };
  }
}
