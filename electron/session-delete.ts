// The delete-a-recording flow, with its collaborators injected so it is unit-tested (APP-9): after a
// successful delete everything that cached the session (the recorder's "last completed" pointer and the
// review's decoded pictures) must forget it.

import type { DeleteSessionResult } from "../common/ipc";
import { isValidSessionId } from "./recorder/session-store";

export interface DeleteDeps {
  isRecording(sessionId: string): boolean;
  isTranscribing(sessionId: string): boolean;
  deleteSession(sessionId: string): Promise<void>;
  /** Called with the id after a successful delete; each drops whatever it cached for it. */
  forget: ((sessionId: string) => void)[];
  warn?(message: string): void;
}

export async function deleteSessionFlow(sessionId: unknown, deps: DeleteDeps): Promise<DeleteSessionResult> {
  if (!isValidSessionId(sessionId)) return { ok: false, error: "Unknown session." };
  if (deps.isRecording(sessionId)) {
    return { ok: false, error: "You can't delete a recording while it's still in progress." };
  }
  if (deps.isTranscribing(sessionId)) {
    return { ok: false, error: "This recording is being transcribed. Wait for that to finish before deleting it." };
  }
  try {
    await deps.deleteSession(sessionId);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    deps.warn?.(`delete failed: ${error}`);
    return { ok: false, error };
  }
  for (const forget of deps.forget) {
    try {
      forget(sessionId);
    } catch (err) {
      deps.warn?.(`forgetting a deleted session failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { ok: true };
}
