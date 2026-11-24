# G2 tester-round fixes: evidence

Branch `lane/G2-tester-round-fixes`, BASE_SHA `7bf0ff4`. Node 24.19.0 (the repo needs `>=24.19.0 <25`; the default Node 26 on this Mac does not accept `--experimental-transform-types`, so tests were run with `/opt/homebrew/opt/node@24/bin` first on PATH). Source of the findings: the Windows tester's form of 24 Nov 2026, build 7bf0ff4.

## Item 1: false narration warning
- **Found:** `transcribeIfCached` (electron/narration/manager.ts) ran after every recording and logged `WARN [Narration] cached narration transcription failed: This recording has no saved narration.` whenever the session had no `audio.json`, which is every recording with Narrate off.
- **Changed:** new pure helper `electron/narration/no-narration.ts` (`NO_NARRATION_ERROR`, `shouldWarnCachedTranscriptionFailure`); the manager uses it and no longer warns for that message. `model-missing` stays silent as before; every other failure still warns.
- **Test:** `electron/narration/no-narration.test.ts` (added to the `test` list). No-narration is silent; a metadata read error and a missing segment file still warn. It cannot run on 7bf0ff4 because the helper did not exist; the old condition was `!result.ok && outcome !== "model-missing"`, which warned for the no-narration result (that is the test's first case).
- **UNVERIFIED on Windows:** the log of a real Narrate-off recording. Retest Check A.

## Item 2: reviewed.json looked stale: outcome (b), the code is right, no behaviour changed
- **Code path (7bf0ff4):**
  1. Every review edit goes `StepReview.tsx edit()` → `window.handover.reviewEdit` → `ipcMain.handle(IPC.reviewEdit)` (electron/main.ts:719) → `ReviewService.applyEdit(sessionDir(sessionId), …)` (electron/review.ts:136) → `appendFile(<sessionDir>/edits.jsonl)`. Delete, summary, comment and blur all take that one path.
  2. "Done reviewing" → `sessions:mark-reviewed` (electron/ipc.ts:239) → `markReviewedGuarded` → `markReviewed(sessionDir(id))` (electron/reviewed-marker.ts:49) which counts the non-empty lines of `<sessionDir>/edits.jsonl` and rewrites `reviewed.json` with the new time, count and narration hash. On success the review screen closes.
  3. Export → `exportBlockedReason` (electron/review-gate.ts:26) → `isReviewed(sessionDir(id))`, which is false when the line count is greater than `edit_count` or the narration hash differs, and then returns "Review the steps and choose Done reviewing before exporting."
  Both sides use the same folder (`sessionDir`) and the same file name (`EDITS_FILE` = `edits.jsonl` in common/handover/read-session.ts and the same literal in reviewed-marker.ts).
- **Why this contradicts the report:** an export after four edits can only succeed if `reviewed.json` was rewritten after them (count 4). Both the edits and the export did show the changes, so `edits.jsonl` had grown; with a marker still at 0 the export would have been refused. So either "Done reviewing" was pressed again after 12:51 and the file read was an older copy, another session's folder, or an earlier look at the file, or the 12:45 marker was read before the final Done.
- **Test (passes on 7bf0ff4 and after; pins the behaviour):** `electron/review.test.ts` "G2 item 2". It marks reviewed at 12:45 with 0 edits, applies four edits (two deletes, a wording change, a blur) through the real `ReviewService`, asserts 4 lines in `edits.jsonl`, that `isReviewed` is false and `exportBlockedReason` returns the not-reviewed message, then marks again at 12:52 and asserts `edit_count` 4, the new `reviewed_at`, the file on disk equal to the returned marker, and export allowed.
- **Question for the tester (in windows-retest-script.md, Check B):** after the edits at 12:47 to 12:51, did you click Done reviewing a second time before exporting, and was the `reviewed.json` you opened in the same recording folder (`20261124-143433`) with its Date modified at 12:45? The retest also asks for both versions of the file.
- **Not examined:** the exact moment the tester looked at the file. If the answer is "yes, pressed again, same folder, still 12:45" the code has a defect that this test does not reproduce (for example a Windows write failing silently); `markReviewedGuarded` would then have logged `mark reviewed failed:` in the log, so ask for the log too.

## Item 3: uninstall leaves a 627 MB installer copy
- **Found:** `NsisTarget.js:507` defines `APP_INSTALLER_STORE_FILE` as `<updaterCacheDirName>\installer.exe`; `templates/nsis/include/installer.nsh:93` does `copyFile "$EXEPATH" "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"` inside `installApplicationFiles`, for non-web installers, every install. `updaterCacheDirName` is the lower-cased package name plus `-updater`, here `handover-updater`. The uninstaller template never removes it. No electron-builder option turns the copy off, so no package.json change.
- **Changed (build/installer.nsh):** `customInstall` (runs after `installApplicationFiles`, installSection.nsh:81) now runs `RMDir /r "$LOCALAPPDATA\handover-updater"`; a new `customUnInstall` (uninstaller.nsh:156) does the same, which also cleans the copy an old build left behind. Nothing in `%LOCALAPPDATA%\Handover` or `%APPDATA%\Handover` is touched.
- **Test:** `scripts/compliance.test.mjs` "release config ships NOTICE…" now asserts the package name gives `handover-updater`, that both macros delete it, and that no `RMDir` targets `$LOCALAPPDATA\Handover` or `$APPDATA\Handover`. Run against the old installer.nsh it fails (checked by stashing the file); with the change all 40 tests in that file pass.
- **UNVERIFIED on Windows:** the installer was not built or run. Retest Check E. A reader of the NSIS output should also confirm `RMDir /r` is not blocked while the installer is itself the running file (the installer runs from the Downloads folder, not from `handover-updater`, so it should not be).

## Item 4: export zip name
- **Found:** electron/export.ts built the zip name as `folderName.replace(/\.handover$/, ".zip")`, giving `recorded-process-<id>__pkg_<ulid>.zip` (the slug comes from the process title).
- **Changed:** new `packageZipName(folderName)` returns `handover-<folder without .handover>.zip`; the folder keeps its `.handover` suffix and the zip's inner folder name is unchanged. Docs updated: package-spec.md (file table) and tester-package.md (export paragraph); the test script now says the zip starts with `handover-`.
- **Test:** electron/export.test.ts asserts the exported zip matches `^handover-save-the-budget-and-open-mail__pkg_[0-9A-Z]{26}\.zip$` and `packageZipName("a__pkg_X.handover")`. It fails on 7bf0ff4 (name has no prefix, and the function did not exist).
- **UNVERIFIED on Windows:** the name on a real Desktop. Retest Check C.
- The Save dialog's suggested name was left as `<slug>.zip` in the first commit; fixed in the review round below (R4).

## Item 5: documents
- windows-test-script.md: size now "about 627 MB"; references `2-Results-form.md` and `3-Release-notes.md`; zip described as starting with `handover-`.
- release-notes-0.1.0-tester.md: size 627 MB; privacy section keeps "no keyboard capture" and adds window titles, clicked text as a control name, every-monitor screenshots, and the raw narration audio location with the three folders that uninstall leaves (`%LOCALAPPDATA%\Handover`, `%APPDATA%\Handover`, `%APPDATA%\Handover\logs`; logs are under the settings folder, from `main.ts:80`). Known limits replaced with the 24 Nov results (click helper works on Windows 11; unnamed taskbar clicks; administrator window not seen, with a note coming; about 62 s transcription for 5 minutes with PC lag; empty recording has one step; no audio playback). Lines about untried Windows narration, the export dialog and Explain/review not running on Windows were removed because the run disproved them.
- New: docs/recorder/windows-retest-script.md (Checks A to E: narration log, reviewed marker with the exact steps and the question, zip name, administrator window, uninstall).
- tester-package.md had no installer size line to fix (grep for "500 MB" and "MB" found only the crop size and the diagnostics log size).
- The test script's own file name in the pack is not known from the form (the form quotes `windows-test-script.md`); the pack is assembled outside this repo, so the source files keep their names and only the references inside the documents were changed. The retest script's "Not observed" wording depends on lane G1 (the click helper change).
- UNVERIFIED: no one has read the new retest script on a Windows machine.

## Review round (t137 R1 to R5)
- **R1** (retest Check B): times stated as UTC against the tester's UTC+2 clock and Explorer's Date modified; the question now asks whether he opened `reviewed.json` before pressing Done the second time and asks for the export's `manifest.json` (`privacy.reviewed_at`); steps 5 and 6 now describe what he will see (Export package greyed out, tooltip "Review the steps and choose Done reviewing before exporting." quoted from src/Library.tsx:375, available again after Done reviewing); the setup is a fresh recording with at least four Notepad clicks, not the Check A recording.
- **R2:** the retest script ends with its own results table (Checks A to E) and says to send that file back instead of 2-Results-form.md.
- **R3:** the call site is now covered. The decision moved into `transcribeIfCachedWith` (electron/narration/no-narration.ts) with injected `modelCached`, `isValidSessionId`, `transcribe` and `warn`; `NarrationManager.transcribeIfCached` only supplies the real ones. New tests drive it for no-audio (no warn), model-missing and success (no warn), a real failure (one warn), and the not-cached and invalid-id early returns. Proof it fails on the old condition: temporarily putting `!result.ok && result.outcome !== "model-missing"` back in that function gave (restored afterwards):
  ```
  ✖ the call site: a session with no audio.json logs no warning, a real failure logs one
  ℹ tests 5  ℹ pass 4  ℹ fail 1
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
  + [ [ 'cached narration transcription failed:', 'This recording has no saved narration.' ] ]
  - []
  ```
- **R4:** the save dialog makes the package id first (`newPackageId`), suggests `suggestedZipName(title, packageId)` = `handover-<slug>__pkg_<id>.zip`, and passes the same id to `exportPackage` (new `packageId` option), so the suggested name equals the written name. Test in electron/export.test.ts exports with an injected id under a different typed name and asserts the written zip equals the suggestion. The typed name is still ignored (only its folder is used), as before. The slug in the dialog comes from `readTitle` (untrimmed) and in the export from the session's trimmed title; they differ only when the title has leading or trailing spaces, which slugify drops anyway.
- **R5:** release-notes line 32 left as is; retest Check D now quotes only "Not observed" and "administrator window".
- **UNVERIFIED on Windows:** the save dialog's pre-filled name; the tooltip and greyed-out state were read from the code, not seen.

## Gates
`npm run typecheck`: exit 0.

```
> handover@0.1.0 typecheck
> tsc --noEmit
```

`npm test`: exit 0.

```
ℹ tests 446
ℹ suites 0
ℹ pass 446
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

## Process note
While writing the Item 2 test I appended it with a shell heredoc by mistake (against the file-edit rule), noticed straight away, ran `git checkout` on that file and re-added the identical test with Edit. I also used a one-entry `git stash push -m g2tmp` on build/installer.nsh to prove the Item 3 test fails on the old file; it was popped at once and no stash entry remains.
