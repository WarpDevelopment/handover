# Handover tester build: plan and lane contracts

**Date:** 2026-11-21 · **Jira:** WIAS-229 · **Repo:** `WarpDevelopment/handover` (private)
**Base:** `main` = planning docs + `microsoft/skill-recorder` v0.9.3 (`0d4bd217aad1fb349cc1e4b1a0ff3fd8cce5e70a`, MIT), imported with its history.
**Task branch:** `task/workflow-recording-assistant`. One PR from it into `main` at the end.

This plan replaces the 15-lane plan (`2026-11-21-workflow-recorder-plan.md`) for the tester build. That plan stays as the **hardening roadmap** after tester feedback.

## Why the plan changed
- The owner cannot run Windows. A colleague tests on a normal Windows 11 x64 laptop with admin rights on **Monday 23 Nov (round one)**. **Tuesday 24 Nov is the fix round.** The Mac build is verified by the owner.
- The signed Moore Phase 0 terms vest IP in MSTB, so the product moved out of the Moore repo into this Warp-owned repo.
- A two-hour evaluation (`docs/recorder/skill-recorder-eval.md`) said GO for forking Skill Recorder for the tester build. It provides the Electron shell, capture, narration and a Windows installer pipeline that is green in CI. It has **no click capture**, and its steps come only from its Copilot AI, which we remove. Whether the fork becomes the long-term base is decided after round one (eval §7.3).

## What the tester build is
**In:**
- recording with a screenshot per step
- the control behind each click (macOS Accessibility / Windows UI Automation), optional at runtime
- the floating control bar
- freeze-and-annotate on a hotkey: box, arrow, highlight and a typed comment
- pause and resume
- on-device narration, with the Whisper model bundled
- review: delete a step, edit a comment, blur a rectangle
- export of the package in `docs/recorder/tester-package.md`, plus PROCESS.md and CLAUDE_HANDOFF.md
- a diagnostics zip
- an unsigned x64 NSIS installer from GitHub Actions
- a test script for the Windows tester

**Out (hardening roadmap):**
- apps-I-choose scope and masking
- automatic PII and ID detection
- encrypted storage and retention
- remote desktop and Citrix detection
- prompts and readiness rules
- dataflow
- the format gate and scoring
- the usability study
- signing and notarisation
- the full review editor
- Claude process-spec generation

**Privacy floors** are listed in `tester-package.md` §1 and hold in every lane.

## Lanes

| Lane | Name | Depends on | Size | Target |
|---|---|---|---|---|
| L1 | fork-strip-ci | — | S/M | Sat night → first Windows installer artifact |
| L2 | diagnostics-privacy-narration | L1 | S | Sun morning |
| L3 | steps-frames-export | L2 | M | Sun midday |
| L4 | freeze-annotate-review | L3 | M/L | Sun afternoon/evening (parallel with L5) |
| L5 | click-control-helpers | L3 | M+M | Sun afternoon/evening (parallel with L4) |
| L6 | tester-pack-and-pr | L4, L5 | S | Mon morning: installer + test script to the owner |

L4 and L5 may run in parallel after L3. Their files are disjoint apart from `package.json` (`extraResources`) and `electron/main.ts`, so the second one to merge rebases. The **Monday build is the last green artifact**, whichever lane that is. If L4 or L5 slip, they ship in the Tuesday build.

## How every lane runs (orchestrator rules)
- One Claude conversation per lane, started from the orchestrator's Herdr terminal:
  `hc run --bg --name <lane> --cwd <worktree> claude --model sonnet --permission-mode auto -n "<lane>" "<contract>"`
- Worktree `~/.herdr/worktrees/handover/<lane>` on branch `lane/<lane>`, cut from the task branch HEAD. That commit is the lane's BASE_SHA, written into the contract.
- The lane pushes its branch, so CI runs (L1 adds `lane/**` and `task/**` push triggers). **The lane never merges.** The orchestrator (Opus) reviews the diff, merges into the task branch, re-runs `npm test`, and pushes.
- Owner-at-keyboard Mac checks are batched: one session after L4/L5 merge (permissions, freeze, clicks, narration, export) and one fresh-Claude check.

## Contract template (every lane)
```
You are building lane <ID> of Handover, a Windows + macOS desktop recorder (Warp Development, Jira WIAS-229).
Repo: WarpDevelopment/handover. Worktree: <path>. Branch: lane/<lane>. BASE_SHA: <sha>.
Read first: docs/superpowers/plans/2026-11-21-tester-build-plan.md (your lane section),
docs/recorder/tester-package.md, docs/recorder/skill-recorder-eval.md (sections named in your lane).
Files in scope: <list>. Everything else is read-only unless the lane section says otherwise.
Rules:
- Use Read, Edit, Write for files; Bash only for commands (git, npm, node, swiftc, gh). Never create or
  edit files with sed -i, heredoc redirection, tee or inline scripts. Read a file before editing it.
- No new skipped tests, no @ts-ignore, no suppression without a same-line "-- reason".
  A production change ships with a test that would fail without it.
- Privacy floors in tester-package.md §1 are not negotiable.
- Small Conventional Commits on your branch, each ending with
  "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>". Push your branch. Never merge,
  never push to main or the task branch, never force-push.
- Do not start other agents or Claude sessions.
- If you are blocked on a decision, send the question with: hc send <ORCH> "<lane>: <question>"
  and wait.
Done = every acceptance check below passes, CI (Windows x64 job and the macOS job) is green on your pushed
HEAD, and docs/recorder/evidence/<lane>.md lists each check, the command or run URL, the result, and
anything left unproven. Then: hc send <ORCH> "<lane> done: <HEAD sha>, evidence at <path>" and stop.
```

---

### L1 fork-strip-ci
**Read:** eval §3.3, §3.6, §5.1–5.4 (L1 row), §6 item 6.
**In scope:** everything listed in the eval §5.4 L1 row. That includes:
- the AI and import strip, with the two traps in §3.3: keep the three `evals/` harness files, moved to `test/harness/` with every script path updated; and `build:vite` becomes plain `vite build`;
- the `package.json` scripts and dependencies, plus `package-lock.json`;
- the rebrand to `Handover` (`productName: Handover`, `name: handover`, `appId: com.warpdevelopment.handover`, `version: 0.1.0`, `author: Warp Development`), with the `SKILL_RECORDER_*` environment variables renamed to `HANDOVER_*`;
- the Segoe fonts removed, using the system font stack instead;
- `LICENSE` keeps the Microsoft line and adds "Copyright (c) 2026 Warp Development";
- a `NOTICE` reading "Derived from microsoft/skill-recorder at 0d4bd217…, MIT";
- `THIRD-PARTY-NOTICES.md` without the Copilot section;
- the Microsoft-specific `SECURITY.md`, `SUPPORT.md`, `CODE_OF_CONDUCT.md` and `CONTRIBUTING.md` removed;
- `install.ps1`, `install.sh` and the install scripts with their tests removed;
- `portable.yml` removed.

**Workflows:**
- `windows.yml`:
  - x64 only; no install steps; no `test:ai:runtime`;
  - triggers: push to `main`, `task/**` and `lane/**`, plus `pull_request` and `workflow_dispatch`;
  - `actions/upload-artifact` for `release/*.exe` (name `handover-windows-x64`, 14-day retention);
  - a **probe step** that compiles a hello-world C# exe with the in-box `csc.exe` (`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`), runs it, and prints whether the session is interactive (`Environment.UserInteractive`, plus whether `GetDesktopWindow`/`GetForegroundWindow` return non-zero).
- `non-windows.yml`: macOS only, no `install.sh`, and an uploaded unsigned mac zip artifact (`handover-macos-arm64`).

**Do not change:** the compliance policy file. Its hash keys the compliance cache (eval §6 item 6).

**UI:** `src/Library.tsx` loses the AI views and keeps the session list plus an "Open folder" action. The AI-only routes go.

**Acceptance:**
1. `npm ci && npm test && npm run build` exits 0 on the Mac; report the test count.
2. `grep -riE "copilot|skill ?recorder|skillrecorder" electron src common scripts package.json` returns only notice and licence lines; list any left with a reason.
3. CI windows x64 job green on the lane HEAD, with the artifact `Handover-0.1.0-windows-x64.exe` downloadable, and `verify-windows-package.mjs` passes with no `copilot.exe` inside.
4. The probe step output (csc found? interactive?) is quoted in the evidence.
5. CI macOS job green with the zip artifact.
6. `npx electron .` (or the dev script) starts the app on the Mac with the Handover name, and recording to Stop works; it may only produce an empty session list entry.

### L2 diagnostics-privacy-narration
**Read:** eval §3.1 (clipboard, URL reader, capture toggles), §3.2, §3.4, §4e.
**In scope:**
- `electron/logger.ts`: a file sink to `userData/logs/handover-YYYYMMDD.log`, rotated at 5 MB, never logging event payloads.
- New `electron/diagnostics.ts` plus a test, building the zip described in `tester-package.md` §7 without the session folder.
- A tray/menu item "Save diagnostics…" that writes to the Desktop.
- `electron/debug-bundle.ts`: no media or session content.
- `electron/collectors/clipboard.ts`: no `textPreview`; keep only the change counter and source app.
- `common/config.ts` defaults: `browserUrls: false` (the PowerShell reader stays off), `terminal: false` with its button hidden, Advanced protection OCR off.
- **Narration bundled:** CI fetches the `Xenova/whisper-small` q8 files with SHA-256 pins into `extraResources/models`, `narrationModelCacheDir()` points there, `local_files_only: true`, and the download prompt is removed.
- The banner "TEST BUILD — use test data only, not real client data" on the recorder window and the floating bar.

**Acceptance:**
1. Unit test: the diagnostics zip holds no `.png/.jpg/.webm/.opus/.wav` and none of a set of planted payload strings.
2. Unit test: a clipboard event has no text field.
3. With networking off on the Mac (`networksetup -setairportpower` is not needed; run the app with the env var `HANDOVER_DENY_NETWORK=1`, which installs a `session.webRequest` block and a Node `net` guard, both added in this lane), record 30 s with narration, then save diagnostics. Both work and the transcript is non-empty. Quote the log lines in the evidence.
4. CI green on both OSes with the Windows artifact.

### L3 steps-frames-export
**Read:** eval §3.1 (frames), §4d; `tester-package.md` in full.
**In scope:**
- `common/events.ts`: new event types `pointer.click` (point in display physical px, button, `t_ms`, optional `target` per `tester-package.md` §4.2), `annotation`, `gap` and `explain.start`/`explain.end`.
- New `common/handover/`: `steps.ts` (deterministic step builder: click, then app switch, then manual; summaries from templates), `build-package.ts` (`buildPackage(session, edits, ctx) -> Map<path, bytes>`, with no Electron imports), `process-md.ts`, `handoff-md.ts`, `schema/tester-package.schema.json`, and `validate.ts` (§8 checks), each with tests.
- `electron/video/{recorder.ts,capture-preload.cjs}`:
  - capture at native resolution up to 2,560 px wide;
  - keep the last ~2 s of frames in memory at 2–4 fps for the "≥50 ms before the click" before frame;
  - `snapshot(force)` on request;
  - all displays, not only the one picked.
- `electron/export.ts` writes the folder and zip (`archiver`) through `dialog.showSaveDialog`, with an Export button on a session in Library.
- Crops and resizing with `sharp`.

Until L5 lands, steps come from app switches (`window_change`) and explain marks. A test helper injects synthetic `pointer.click` events.

**Acceptance:**
1. Golden test: a synthetic session (`events.jsonl` plus frame PNGs in `test/fixtures/`) gives byte-stable `manifest.json`, `steps.jsonl`, `annotations.jsonl`, `PROCESS.md` and `CLAUDE_HANDOFF.md`. The manifest hashes verify, and `validatePackage` passes.
2. Tests: image resizing respects the 1,568 rules; the crop transform round-trips; before-frame selection picks the newest frame ≥ 50 ms before the click.
3. The Mac app records 1 minute across two apps and exports a package that passes `validatePackage`. Commit that package under `test/fixtures/evidence/L3/` only if it contains nothing personal; otherwise describe it.
4. CI green with the Windows artifact.

### L4 freeze-annotate-review
**Read:** eval §4b, §4c; `tester-package.md` §4.4, §4.6.
**In scope:**
- `electron/main.ts`: an Explain hotkey (`CommandOrControl+Shift+E`) and an Explain button on the floating bar.
- `electron/window.ts`: `createFreezeOverlay(display)`, one opaque frameless window per display at the `screen-saver` level, content-protected.
- `electron/recorder/controller.ts`:
  - `pause()`/`resume()`, which write `gap{user_paused}`;
  - `explain.start`/`explain.end`, which count into `explain_ms`;
  - collectors paused while frozen;
  - tests for all of this.
- New `src/FreezeOverlay.tsx`: the frozen PNG plus canvas tools (box, arrow, highlighter, freehand), a comment card, and Done/Cancel. It saves `annotation` events in display px with the display id.
- New `src/StepReview.tsx`, replacing the old AI workspace:
  - a filmstrip of steps;
  - the frame with annotations drawn on it;
  - edit the summary and comment;
  - delete a step;
  - a blur-rectangle tool;
  - edits stored append-only in `edits.jsonl`.
- `common/handover/build-package.ts` applies the edits: deleted steps are gone and ids are renumbered, blurs are burned into the full, annotated and crop images, and `contains_redaction` is set. Annotated images are rendered per `tester-package.md` §4.4.

**Acceptance:**
1. Controller tests for pause, resume and explain timing (`task + explain + paused = duration`).
2. Unit tests: a deleted step is absent and ids are renumbered; blur changes pixels only inside the rectangle (pixel diff); the annotated image is deterministic for a fixed annotation set.
3. Owner-at-keyboard Mac checklist written to `docs/recorder/smoke/L4.md`: freeze on two displays if available, draw each tool, type a comment, delete a step, blur, export. The lane runs every step it can without a person and marks the rest.
4. CI green with the Windows artifact.

### L5 click-control-helpers
**Read:** eval §4a; `docs/recorder/research/windows-tech.md` (hook-timeout and UIA findings); `docs/recorder/research/macos-tech.md` (listen-only tap and AX); `tester-package.md` §4.2.
**In scope:**
- `native/windows/HandoverHelper.cs` plus an app manifest (Per-Monitor-V2 DPI aware), compiled in CI with the in-box `csc.exe` targeting .NET Framework 4.8:
  - a `WH_MOUSE_LL` hook whose callback only enqueues;
  - a worker thread that runs `AutomationElement.FromPoint` with a cache request and a 300 ms timeout;
  - `is_password` honoured;
  - JSON lines over stdio: `hello`, `capabilities`, `click`, `error`;
  - `--selftest` mode.
- `native/macos/HandoverHelper.swift`:
  - a listen-only `CGEventTap` for mouse-down only;
  - `AXUIElementCopyElementAtPosition` on a background queue with a 300 ms timeout;
  - `AXIsProcessTrusted()` polling;
  - the same protocol, built with `swiftc` in the macOS CI job and by `npm run build:helper:mac` locally.
- `electron/collectors/pointer-helper.ts`:
  - spawns the helper from `extraResources`;
  - maps protocol `click` messages to `pointer.click` events with `target`;
  - converts coordinates to display physical px;
  - on missing helper, crash or no permission, logs it, emits `gap{helper_restart}` or sets `target.unavailable.reason`, and keeps recording.
- `electron/doctor.ts` and diagnostics report helper status and lookup timings.
- The `package.json` `extraResources` entries for both helpers.
- The CI step that compiles the Windows helper and runs `--selftest`.

**Acceptance:**
1. CI Windows: the helper compiles and `--selftest` prints `hello` and `capabilities`, plus a `FromPoint` result if the runner session is interactive (L1's probe says whether). Quote the output.
2. Protocol tests in Node, driven by a fake helper script: well-formed click with target, click without target, helper crash leading to a gap, malformed line ignored.
3. With the helper deleted from the build, the app still records and exports, with a gap and a doctor status of `missing`.
4. Owner-at-keyboard Mac checklist in `docs/recorder/smoke/L5.md`:
   - after granting Accessibility, clicks in Finder, Safari and TextEdit produce steps with role and name;
   - without the grant, they produce `visual_only` steps with `permission_missing`.
5. The Windows installer artifact includes `HandoverHelper.exe`, verified in CI.

### L6 tester-pack-and-pr
**In scope:**
- `docs/recorder/windows-test-script.md`: a plain-language script for the tester covering:
  - download and install, including the SmartScreen "More info → Run anyway" step and the Defender prompts;
  - granting the microphone;
  - recording a 5-step test task in Notepad, Edge and File Explorer;
  - Explain, with box, arrow and comment;
  - narration;
  - review, delete and blur;
  - export, and Save diagnostics;
  - sending back the package zip and diagnostics zip;
  - a short results form, each item pass/fail/notes.
- The release notes for the build.
- The PR body from task to main.

**Acceptance:**
- The script has been followed on the Mac where it applies.
- The artifact URL for the Windows installer is recorded.
- The PR is opened by the orchestrator.

---

## Acceptance for the whole lane (brief done-when)
1. `npm test` exits 0 from a clean checkout of the task branch.
2. The owner verifies the Mac build: clicks, a highlight, a comment and narration in one exported package.
3. The Windows installer and test script are with the tester on Monday 23 Nov, and their results are back on Tuesday 24 Nov.
4. A fresh Claude given only an exported package rebuilds the steps of a known test process. Evidence goes in `docs/recorder/evidence/fresh-claude.md`.
5. The PR is open, review-gate is recorded clean, and WIAS-229 is moved.
