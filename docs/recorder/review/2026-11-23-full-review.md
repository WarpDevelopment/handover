# Full review of the tester build, 2026-11-23

- **Range:** `f4dfd51..5bf8eb9` on `task/workflow-recording-assistant`.
- **Method:** five independent Opus reviewers, one lens each, all read-only. Each verified its findings by reading the code end to end or by running probe scripts.
- **Review gate:** verdict `findings`, kind `full`, at `5bf8eb9`.
- **Fix lanes:** FA (app), FP (package), FN (native helpers), FR (release). Each finding names the lane that owns it.

Severity: **B** blocker, **M** major, **m** minor.

---

## APP: desktop app runtime (Electron main, windows, recorder, renderer)

**APP-1 B → FA. A freeze overlay that fails to load or crashes cannot be dismissed.**
- Where: main.ts:192-237, 211; window.ts:132-166; freeze.ts:191-201; FreezeOverlay.tsx:232.
- No did-fail-load, render-process-gone or unresponsive handler is attached to the overlay webContents.
- The 1.5 s reveal timer shows the window even when the page never painted. The result is an opaque black always-on-top window covering the whole display, taskbar included.
- Esc only works through before-input-event on a live, focused renderer.
- The coordinator keeps its views, so `active` stays true and every later Explain fails.
- **Fix:**
  - On did-fail-load, render-process-gone or unresponsive, call `freeze.cancel()`.
  - If the reveal timeout fires before `freezeReady`, cancel instead of revealing.
  - Register a global Escape shortcut for the lifetime of the freeze and unregister it in `closeAll`.
  - Put `closeAll` in a `finally` in `end()`.

**APP-2 M → FA. Overlay keyboard focus is never checked; on Windows, typed text can go to the app underneath.**
- Where: main.ts:197-209 and 252-254; freeze.ts:122-124.
- `focus()` can be refused by the Windows foreground lock. The note, Enter (save) and Esc then go to the frozen app. In Outlook, Enter could send an email.
- **Fix:**
  - On win32, check `isFocused()` about 100 ms after reveal; retry with an always-on-top toggle plus `focus()`.
  - In the renderer, show a "Click here to type your note" banner while `document.hasFocus()` is false. Never treat Enter as save while unfocused.
  - Prefer creating and focusing the primary overlay inside the hotkey handler.

**APP-3 M → FA. Clicking the recording bar makes Handover the foreground app, and that switch becomes a "Switch to Handover" step.**
- Where: window.ts:89-110; controller.ts:180-182; main.ts:149-158.
- **Fix:** drop `app.activate`, `app.title-change` and `browser.url` events whose pid is `process.pid` (or whose app is Handover/Electron) in the bus filter and in `withoutFrozenCollectorEvents`. (FP also filters these in the builder: PKG-10.)

**APP-4 M → FA. A display added or reconnected during a recording is never captured.**
- Where: video/recorder.ts:114-131; capture-preload.cjs:132-158; main.ts:721-725.
- **Fix:**
  - On display-added, display-removed and display-metrics-changed while recording, re-query `desktopCapturer` and reconfigure the per-display streams.
  - Drop a capture whose track fires `ended`.
  - Minimum acceptable for the tester build: cancel an active freeze on display change (see APP-7) and log the change.

**APP-5 m → FA. Explain and Pause failures are invisible.**
- Where: RecordingControls.tsx:216-224, 407, 559-561; main.ts:752.
- **Fix:** give `actionError` a visible slot on the bar, and send hotkey failures to the bar over IPC.

**APP-6 m → FA. Stopping the recording while a freeze is opening leaves overlays over a stopped recording.**
- Where: freeze.ts:79-124, 187-189.
- **Fix:** `abort()` sets an aborted or generation flag; `begin()` checks it after each await and cancels before opening windows.

**APP-7 m → FA. Unplugging a display during a freeze is not handled.**
- Where: freeze.ts:203-216; main.ts:721-725.
- **Fix:** in `handleDisplayChange`, call `freeze.cancel()` if `freeze.active`.

**APP-8 m → FA. Ctrl+Shift+E is held system-wide even when Handover is not recording.**
- Effect: blocks Word Track Changes and the VS Code Explorer shortcut.
- **Fix:** register the shortcut on recording start and unregister it on stop.

**APP-9 m → FP. Review memory grows without bound.**
- Where: electron/review.ts:29, 71, 93; StepReview.tsx:13-27, 41-44.
- **Fix:** cache only the latest session, evict on delete and when the library closes, and serve downscaled thumbnails.

**APP-10 m → FA. On Windows, the bar can rise above the overlay during a freeze.**
- Where: main.ts:421-426, 457-462.
- **Fix:** skip `moveTop` while `freeze.active`.

**APP-11 m → FA. Recordings are stored in roaming AppData on Windows.**
- Where: session-store.ts:12-16.
- **Fix:** on win32, store sessions under `%LOCALAPPDATA%\Handover\sessions`.

---

## PKG: package builder against docs/recorder/tester-package.md

Probe scripts are in the orchestrator scratchpad: `review/probe.ts`, `probe2.ts`, `crop.ts`.

**PKG-1 B → FP. After the last step is deleted, the new last step gets the deleted step's after image.**
- Where: build-package.ts:827-839.
- Cause: the after frame is any after shot within 0–2000 ms of the last kept step.
- **Fix:**
  - Accept an after shot only if `c.t < lastDs.tEnd`, where `tEnd` is measured before edits (the next recorded step's start).
  - Drop the after frame when the last kept step was not the last step before edits.

**PKG-2 M → FP. A click that switches apps produces an extra "Switch to …" step, and a double-click on a background window becomes three steps.**
- Where: steps.ts:181-208.
- Cause: suppression compares report times, not the time the user acted. Active-window polling runs every 1000 ms, or 1600 ms while a browser is frontmost.
- **Fix:**
  - Use acted time (`t − lookupMs`) as `t_start_ms`, and for ordering and comparison.
  - Suppress an activate for app X when a click on X lies in [activate − 300 ms, activate + 1600 ms + slack].
  - Let the double-click merge look past a suppressed context step.

**PKG-3 M → FP. A visual_only click inherits the previously active app, and `scope_verified` is set to true.**
- Where: steps.ts:224-235; build-package.ts:823.
- **Fix:**
  - Keep the previous app only when the point lies inside the last known window bounds.
  - Otherwise set app `{name: "", kind: "unknown"}` and `scope_verified: false`.
  - The summary must not claim an app it does not know.

**PKG-4 M → FP. A step with no before frame gets locator "0,0", and its highlights are dropped without a trace.**
- Where: build-package.ts:763-766, 897.
- **Fix:**
  - Compute `point_fpx` through `expectedFrameScale(display)` (as context steps already do).
  - Keep highlights using expected-scale geometry with no `frame_id`, or fail the export.
  - Never write "0,0".

**PKG-5 M → FP. The schema and validator do not enforce the doc.**
- Missing:
  - `before`, `target` and `observed_via` required on action and context steps, and `action` on action steps;
  - `unavailable` required when grounding is not accessibility (context `none` excepted per §4.2);
  - the required fields for each annotation kind;
  - exactly 2 points for rect and arrow.
- **Fix:** add if/then or oneOf by kind in the schema, and enforce in `validatePackage`.
- **Note:** a step without a before frame is legitimate in the first second of capture (L3 note 2). So `before` is required on an action step only when the session had frames at that time; the validator may allow it to be missing with the flag `low_confidence_target`.

**PKG-6 m → FP. An Explain step's app, window and frame can come from the wrong moment.**
- Where: build-package.ts:348-373.
- **Fix:**
  - Track app, title and URL from events up to `f.start`.
  - Limit the frozen-frame fallback to [f.start − 1 s, f.end].

**PKG-7 m → FP. Deleting the first Explain step of a multi-display freeze also deletes the freeze's comment.**
- **Fix:** after deletions, re-attach the freeze comment to the first surviving Explain step of that freeze.

**PKG-8 m → FP. Edited summaries and comments are not sanitised, and a failed export leaves an invalid package behind.**
- Where: process-md.ts:118; edits.ts:61-62; export.ts:103-119.
- A newline in a summary injects headings and fake steps into PROCESS.md. An empty summary fails the schema only after the folder and zip were written.
- **Fix:**
  - Reject empty text and fold newlines in `edit_summary` and `edit_comment`.
  - Pass summaries through `textOf()` in process-md.
  - Build and validate in a temp folder, and move it into place only when it validates.

**PKG-9 m → FP. The crop is centred on element bounds even when they are bigger than the crop, so the click point can fall outside it.**
- **Fix:** centre on the click point when the bounds exceed the crop size or would leave the click outside it. Update tester-package §4.3 in the same commit.

**PKG-10 m → FP. Handover's own app.activate events become "Switch to Handover" or "Explain on Handover".**
- **Fix:** in the builder, drop `app.activate` events where app or process is Handover (the same test as `isOwnAppClick`).

**PKG-11 m → FA. The bus drops a pointer.click by its report time, not by when the user acted.**
- Where: event-bus.ts:61.
- **Fix:** let `pointer.click` through the bus while blocked, and let the builder's acted-time filter decide.

---

## SEC: privacy and security

**SEC-1 M → FP. The last step's after image is exported but never shown in review.**
- It is blurred only with the before-image rectangles.
- **Fix:**
  - Show the after image in review as its own item.
  - Add `frame: "before" | "after"` to `blur_rect`, default `before`.
  - If the after image cannot be reviewed, drop it.

**SEC-2 M → FA. A package can be exported without any review, yet the manifest says `reviewed_by_user: true`.**
- Where: Library.tsx:266-268; ipc.ts:202-226.
- **Fix:**
  - Write a `reviewed_at` marker when the user finishes review: add a "Done reviewing" button in StepReview, which is FP's file, so FA adds only the IPC and marker. FP adds the button calling `window.handover.markReviewed(sessionId)`, a channel FA defines.
  - Disable Export, and refuse it in IPC, until the marker exists and is newer than the last edit.
  - **Coordination:** FA owns `electron/ipc.ts`, `common/ipc.ts`, `preload.cjs` and `Library.tsx`; FP owns `StepReview.tsx`. The channel name is fixed here: `sessions:mark-reviewed (sessionId) -> {ok}`.

**SEC-3 M → FA. The default spellchecker downloads dictionaries from Google on Windows.**
- **Fix:**
  - Call `session.defaultSession.setSpellCheckerEnabled(false)` at startup.
  - Set `spellcheck: false` in every BrowserWindow's webPreferences.

**SEC-4 m → FP. A password field on the last step is not blurred in the after image.**
- **Fix:** apply the password rectangle to the after frame as well.

**SEC-5 m → FP. The password blur can fail open while still claiming a redaction.**
- Where: build-package.ts:603-627; images.ts:47-48.
- **Fix:** clamp first. If the result is null, fall back to a 400×100 rectangle around the click, or throw.

**SEC-6 m → FP. Editing a summary leaves the same raw text in the element name, the ancestry, the locator and the PROCESS.md Where line.**
- **Fix:** when a summary is edited, replace `element.name`, the ancestry names and the `role_name_path` locator value with `{text: "[REDACTED]", redacted: true, classes: ["user_marked"]}`, or show those fields in review. Pick the replace option for the tester build.

**SEC-7 m → FN. The OS username can reach manifest.json through a helper spawn error.**
- **Fix:** store an error code plus a fixed phrase, never the raw message or path.

**SEC-8 m → FA. The diagnostics zip contains usernames.**
- Where: controller.ts:577 logs `store.dir`; doctor.ts:60-62 (`sessionsDir`, `activeWindow.path`).
- **Fix:** log the session id only, and replace the home directory with `~` in diagnostics.

**SEC-9 m → FA. On macOS, get-windows FULL mode still fetches browser URLs (with query strings) through Apple Events.**
- Where: active-window.ts:8-13, 19, 84, 118-119.
- **Fix:** `activeWindow({accessibilityPermission: false, screenRecordingPermission: true})`.

**SEC-10 m → FA. There is no per-window IPC allowlist.**
- **Fix:**
  - Check `event.sender` against the library window for export, delete and debug.
  - Give the freeze overlay a small preload that exposes only the freeze channels.
  - `sandbox: true` where the preload needs only `electron`, if that is safe for the tester build; otherwise leave it noted.

**SEC-11 / NAT-12 m → FN. The packaged app can launch a helper from `<cwd>/native/build`.**
- Where: helper-status.ts:28-31.
- **Fix:** add the cwd candidate only when `!app.isPackaged`.

---

## NAT: native click helpers

**NAT-1 M → FN. macOS: the tap is never torn down, checked or rebuilt.**
- Where: HandoverHelper.swift:258-262, 287-289, 346-356; pointer-helper.ts:161-164.
- **Fix:**
  - In the timer: when trust is gone, disable, remove and invalidate the tap and set it to nil.
  - If the tap exists but `!CGEvent.tapIsEnabled(tap)` or `!CFMachPortIsValid(tap)`, rebuild it.
  - Report `hook` only when the tap exists and is enabled.
  - In the tap callback, re-enable only when `AXIsProcessTrusted()`.
  - Add a fake-helper mode for "trust revoked mid-run" and a test.

**NAT-2 M → FN. Windows: nothing detects a silently removed hook.**
- **Fix:**
  - Run the hook thread at `THREAD_PRIORITY_HIGHEST`.
  - Add a watchdog (about 1 s) that compares the last hook callback against `GetLastInputInfo` and the cursor position, and add `WM_MOUSEMOVE` as a heartbeat (store a tick only).
  - On a lost hook, reinstall it and emit `{"type":"hook_lost"}`. Node maps that to `gap{helper_restart}` and closes the gap after the reinstall.

**NAT-3 M → FN. U+2028 or U+2029 in a name loses the whole click, on both platforms.**
- **Fix:**
  - C#: escape them as ` ` and ` `.
  - Swift: map them, and U+0085, to a space.
  - Node: replace readline with a splitter that breaks only on `\n` and strips `\r`.
  - Add a protocol test.

**NAT-4 M → FN. `hook:false` with `accessibility:true` is treated as healthy.**
- Where: pointer-helper.ts:157-168.
- **Fix:**
  - Branch on `hook` first: any `hook === false` means a gap plus a non-ok state.
  - Add a fake-helper mode for this case.

**NAT-5 M → FN. The lookup is all-or-nothing within 300 ms, and the ancestry walk eats the budget.** This is the likely cause of control-less clicks in Edge, Office and Teams.
- **Fix:**
  - Return the element as soon as it is resolved.
  - Walk ancestry against a deadline (about 200 ms total), keeping what was collected, and stop at the first window-role parent.
  - Windows: fetch `RootElement` once; use `OpenProcess` plus `QueryFullProcessImageName` instead of `GetProcessById`.
  - macOS: the same deadline idea.

**NAT-6 M → FN. Elevated windows are labelled as normal accessibility hits, and some remote clients are missed.**
- **Fix:**
  - In Resolve, compare the integrity level of the root window's process with ours before UIA. If it is higher, report `elevated_window` with `accessibility_weak` and keep the window title.
  - Add VMware Horizon (`vmware-view`, `vmware-remotemks`) to the remote list.
  - A foreground-elevation gap is out of scope for the tester build: note it as unproven.

**NAT-7 m → FN. Gap `tEndMs` uses a different clock from event `t`.**
- **Fix:** add `elapsedMs()` to CollectorContext, backed by `store.elapsedMs()`.

**NAT-8 m → FN. The restart allowance never recovers.**
- **Fix:** reset it after 60 s of stable running.

**NAT-9 m → FN. macOS: a data race on `manualAccessibilityDone`, and AXManualAccessibility handled loosely.**
- **Fix:**
  - Guard the set with a lock or a serial queue, and mark done only on success.
  - Retry the hit test once after setting the attribute.
  - Turn the attribute off on exit.

**NAT-10 m → FN. macOS: Int conversion traps on NaN, infinite or huge AX geometry.**
- **Fix:** check `isFinite` and the range, and compute area as a Double.

**NAT-11 m → FN. One hung app makes every lookup fail.**
- **Fix:**
  - Count stuck lookups per root-window pid.
  - On Windows, use a UIA TransactionTimeout of about 1.5 s if IUIAutomation2 is reachable from the in-box compiler. Otherwise note it.

---

## REL: build, release, licence

**REL-1 M → FR. The bundled Whisper model ships without its licence, and the notices still say "not bundled".**
- **Fix:**
  - Rewrite the section as "Bundled narration model" with the pinned revision.
  - Vendor the Apache-2.0 text, the model card front matter, and OpenAI Whisper's MIT LICENSE (fetched from the pinned github.com/openai/whisper commit; copy the copyright line from the file, never from memory) into `third_party/` and into `.compliance/`.
  - Make `verifyComplianceDirectory` and `verify-windows-package.mjs` require them.
  - Fix the stale Tesseract text.

**REL-2 M → FR. The NSIS installer offers "Anyone who uses this computer".**
- **Fix:** add a `customInstallMode` macro with `StrCpy $isForceCurrentInstall "1"` to `build/installer.nsh`. Correct windows-test-script.md:50.

**REL-3 m → FR.** NOTICE is not shipped. Add it to both `files` arrays and copy it in compliance.mjs.

**REL-4 m → FR.** "Skill Recorder" remains in the generated THIRD-PARTY-LICENSES.txt (compliance.mjs:1421-1422).

**REL-5 m → FR.** The local `dist*` scripts do not build the helper. Prefix them with `build:helper:*`, or fail when the helper is missing.

**REL-6 m → FR.** "Scout" appears in src/App.css comments. Reword them.

**REL-7 m → FR.** Delete `.github/copilot-instructions.md`, which points agents at microsoft/skill-recorder, and drop the dead copilot keys from compliance-policy.json only if that does not change the CI cache key needlessly. It will change the key, so leave the keys and note it.

**REL-8 → FR.** Tester script additions:
- Smart App Control must be off: Windows Security → App & browser control → Smart App Control. Explain how to check it; if it is on, stop and tell the owner, because turning it off cannot be undone without a reset.
- Mention the per-user install.
- Add "Done reviewing" before Export (SEC-2).
