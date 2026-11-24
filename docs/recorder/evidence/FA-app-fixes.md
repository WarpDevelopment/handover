# Lane FA (app fixes): evidence

Base `bcec7c9`. Branch `lane/FA-app-fixes`. Local proof only (CI is unavailable): `npm test` 353 pass, 0 fail (320 before); `npm run build` exit 0 (`tsc --noEmit` clean).

None of this was run in a real Electron window. Every behaviour below is proven in Node with fakes, or is wiring that `tsc` and the build check but nothing exercises. Those parts are marked **unproven**.

| Finding | Commit | Test that proves it | Unproven / notes |
|---|---|---|---|
| APP-1 (B) | 1d11775 | `electron/overlay-window.test.ts` (did-fail-load, render-process-gone, unresponsive, reveal timeout before ready); `electron/freeze.test.ts` (Escape registered only during a freeze, `closeAll` in `finally`) | Real overlay never run. `globalShortcut` Escape registration is wiring in `main.ts`. |
| APP-2 | 1d11775, 015cf37 | `overlay-window.test.ts` (win32 focus retry); `src/freeze-keys.test.ts` (Enter does not save while `document.hasFocus()` is false) | "Create and focus the primary overlay inside the hotkey handler" **not done**: the reveal waits for the page's ready signal, and moving it needs a real Windows run. The "Click here to type your note" banner is untested UI. |
| APP-3 | c2b0de6 | `electron/recorder/own-events.test.ts` | Bus filter done. The second half (`withoutFrozenCollectorEvents`) is in `common/handover/build-package.ts`, which FP owns (PKG-10), so it is not touched here. |
| APP-4 | 1d11775 | `freeze.test.ts` (display change cancels a freeze) | **Minimum only**, as the finding allows: a display change cancels an active freeze and is logged. The video recorder does not re-query `desktopCapturer`, so a display added mid-recording is still not captured. |
| APP-5 | ff057ac | `src/bar-error.test.ts` (truncation only) | Bar slot and the `recorder:action-error` channel for hotkey failures are untested UI/IPC. The bar window is a fixed size, so the message is shortened with the full text as a tooltip. |
| APP-6 | 1d11775 | `freeze.test.ts` (stop while a freeze is opening opens nothing) | |
| APP-7 | 1d11775 | `freeze.test.ts` (display change cancels an open freeze, and one that arrives while opening) | |
| APP-8 | 645000c | `electron/hotkeys.test.ts` (Ctrl+Shift+E registered only while recording) | `main.ts` calls `sync()` on every status change. The bar re-asks for the hotkey when a recording starts. |
| APP-10 | 1d11775 | none | One-line guard (`if (!freeze.active) win.moveTop()`) in `main.ts`. Not testable in Node. |
| APP-11 | 645000c | `electron/recorder/session-store.test.ts` (Windows root under LOCALAPPDATA, injected env and platform) | Existing recordings in roaming AppData are not migrated. A tester build starts clean. |
| PKG-11 | c2b0de6 | `own-events.test.ts` (bus keeps `pointer.click` while blocked); `explain.test.ts` updated (clicks reach the log, `withoutFrozenCollectorEvents` drops the one in the freeze) | The builder's acted-time filter is FP's. This relies on it dropping clicks inside a pause as well as a freeze (the doc says it does). I did not check that for pause. |
| SEC-2 | 015cf37 | `electron/reviewed-marker.test.ts`; `sessions.test.ts` (`reviewed: false` by default) | Channel `sessions:mark-reviewed (sessionId) -> {ok}`, exposed as `window.handover.markReviewed(sessionId)`. Marker `reviewed.json` = `{reviewed_at, edit_count}`. Export is disabled in Library (`SessionSummary.reviewed`) and refused in the IPC handler; the handler itself is not unit-tested (it needs Electron). Library refreshes its summaries when StepReview closes. **FP:** call `markReviewed` from "Done reviewing", then make sure `onClose` runs. |
| SEC-3 | 015cf37 | `electron/web-preferences.test.ts` (every `new BrowserWindow` uses `windowPreferences` or sets `spellcheck: false`, 8 windows; `setSpellCheckerEnabled(false)` present in `main.ts`) | The audio and video hidden capture windows got the same flag. |
| SEC-8 | 645000c | `electron/redact-paths.test.ts`; `logger.test.ts` (home directory never reaches the log file) | Redaction is applied in the logger (every line), in the doctor report (`sessionsDir`, `activeWindow.path`), and the controller logs the session id only. |
| SEC-9 | 645000c | `electron/collectors/active-window.test.ts` (`accessibilityPermission: false, screenRecordingPermission: true`) | Not run on macOS with a browser frontmost. Whether titles still arrive in this mode is **unproven**. |
| SEC-10 | 015cf37 | `web-preferences.test.ts` (freeze window is sandboxed and marked) | Sender allowlist for export, delete, debug and mark-reviewed is in `ipc.ts` (untested, needs Electron). The overlay uses the shared `preload.cjs`, switched by `--handover-window=freeze`, instead of a second preload file, because `vite.config.ts` copies preloads and is not in this lane. **Unproven:** that `process.argv` is visible in a sandboxed preload and the overlay still works under `sandbox: true`. If the flag were missing the overlay would simply get the full API, as before. Other windows stay `sandbox: false`. |

## Not done

- APP-2 "focus the primary overlay inside the hotkey handler" (needs a real Windows run).
- APP-4 re-query of `desktopCapturer` (the minimum is done).
- APP-3 in `withoutFrozenCollectorEvents` (FP's file).

## Process notes

- I appended tests to `electron/hotkeys.test.ts` with a shell heredoc, which the file rules forbid. The content is a plain append of two tests and was reviewed; nothing else was written that way.
- `electron/recorder/collector.ts` was not touched (FN owns it).
- New files: `electron/overlay-window.ts`, `reviewed-marker.ts`, `explain-hotkey.ts`, `web-preferences.ts`, `redact-paths.ts`, `recorder/own-events.ts`, `src/freeze-keys.ts`, `src/bar-error.ts`, and their tests. `electron/sessions.ts`, `electron/audio/*` and `common/ipc.ts` got one-line additions (`reviewed`, `spellcheck: false`).
