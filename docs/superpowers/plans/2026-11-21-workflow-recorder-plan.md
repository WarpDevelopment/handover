# Handover: implementation plan

**Date:** 2026-11-21 (revised the same day after the builder, platform and product critique pass) · **Design:** `docs/superpowers/specs/2026-11-21-workflow-recorder-design.md` · **Contract:** `docs/recorder/package-spec.md`
**Task branch:** `task/workflow-recording-assistant` (base `86b6876`) · **Jira:** WIAS-229, label `superbrain`
**Status: draft, to be re-sequenced.** This plan came out of the owner's ultracode planning workflow. On 2026-11-21 the owner withdrew the Windows VM and asked for a Windows build by Mon 23 / Tue 24 Nov for an external tester, so the plan is being cut into a tester build plus follow-on hardening. The VM checks below are superseded. G3 is resolved: the workflow run was ultracode.

---

## 0. How the lanes run

### 0.1 Rules for every lane
- **One Claude conversation per lane**, started in Herdr with `hc run --bg --name <lane-name> --cwd <lane-worktree> claude -n "<lane-name>" "<contract>"` (global rule: never `claude -p` or a backgrounded `claude`). Read `hc --skill` and `hc run --help` once before the first launch. One lane at a time unless §2 marks a pair as parallel-safe and the orchestrator chooses to.
- **Model:** Sonnet 5.5 (`model: "sonnet"`) for every build and spike lane. Haiku 5.5 only for purely mechanical sub-steps (named per lane). Opus 5.5 reviews every lane before merge. No Fable or Mythos id is passed to any lane agent; Fable answers design questions as the advisor.
- **Worktree and branch:** each lane works in its own worktree on `lane/<id>-<name>`, cut from the task branch HEAD. That commit is the lane's **BASE_SHA**; the orchestrator writes it into the contract at dispatch. After Opus review is clean, the lane is merged into the task branch and `pnpm test` is re-run on the merged result. **The task branch is green after every merge.**
- **Standing write rights (every lane, in addition to its listed scope):** (a) `recorder/pnpm-lock.yaml`; (b) scripts in `recorder/package.json`; (c) the `package.json`, `tsconfig.json` and entry file (`src/index.ts`) of every package or app the lane creates or edits; (d) `recorder/vitest.workspace.ts` entries for new packages. The lane **commits its lockfile changes**; CI installs with `--frozen-lockfile`, so a lane whose lockfile is stale fails its own CI. When two lanes touch the lockfile, the second rebases and re-runs `pnpm install`.
- **Who creates each package skeleton:** `schema`, `geometry`, `cli` in L1a; `spec` in L1a2; `helper-protocol` and `core` in L1b; `privacy`, `media`, `store` in L1c; `ui` and `apps/desktop` in L3a; `narration` in L3b.
- **Contract contents (the orchestrator fills these in):** BASE_SHA and the diff summary of the previous lane; files and directories in scope (anything else is read-only); the acceptance commands; "done" as defined below; the risks to watch; the rules in this list.
- **Tool choice (global rule, repeated in every contract):** use Read, Edit, Write and Grep for files. Bash is for commands (git, pnpm, swift, dotnet/cargo, tests). Never create or edit a file through `sed -i`, heredoc redirection, `tee`, or inline Python/Node. Read a file before editing it.
- **Test hygiene:** no `vi.mock` (fakes go in at protocol seams: HelperSimulator, in-memory store and keystore, fake clock); no newly skipped tests; no `@ts-ignore`; a suppression needs a same-line `-- reason`. A production diff with no test diff is a review finding.
- **Data:** synthetic only. Media and packages only under `recorder/fixtures/` (evidence under `recorder/fixtures/evidence/<lane>/`); written evidence reports in `docs/recorder/evidence/<lane>.md`.
- **Contract changes:** L1a and L1a2 own `recorder/packages/schema/` and `docs/recorder/package-spec.md` and are the **only** lanes that may make non-additive changes; the format freezes when L1a2 merges. After that, a lane that needs a schema change stops and files a schema-change request; Fable (advisor) and Opus approve it; **the orchestrator (Opus) applies the approved additive patch on the task branch** (CHANGELOG entry, `schema_patch` increment); the waiting lane rebases and continues.
- **Privacy floors are not negotiable inside a lane:** no keyboard hook, no clipboard read, no field value read (outside PRV-KEY-04b opt-ins), no network outside `packages/spec`, no cloud call from the app. **One carve-out:** the URL of a browser window's **document** (AXURL of the web area; the document element through UIA) may be read, only to decide scope (PRV-SCOPE-03) and to record the URL, reduced to origin + path in memory before it is stored. The omnibox is never read. No editable form field is ever read.
- **Definition of done (every lane):** acceptance commands pass on the lane branch and again after merge; evidence committed; Opus review recorded with zero open findings; `docs/recorder/evidence/<lane>.md` lists what was proven, by which command, on which machine, and anything left provisional.

### 0.2 Human-in-the-loop
Some checks need a person at a keyboard: macOS permission dialogs (TCC), revoking Accessibility mid-recording, speaking narration, driving the Windows 11 VM, and the usability sessions. In those lanes the agent writes a scripted checklist in `docs/recorder/smoke/<lane>.md` plus an evidence collector, the **owner runs the checklist**, and the agent analyses the collected evidence and records pass or fail. Checks marked 👤 below need the owner.

### 0.3 Gates (owner, outside the lanes)
| Gate | Question | Blocks | Default if unanswered |
|---|---|---|---|
| **G3** | Ultracode: is the critique-and-revision workflow run that produced this revision what you meant by "ultracode"? If not, what is it? | Dispatch of L0a and L1a | None: the owner answers. If he names a different tool, the package-spec and plan review is re-run with it **before L1a2 merges** (the last non-additive window). |
| **G0** | Is an Apple Developer Program account (Developer ID + notarisation) available? | L0a checks P1, P2, D1 | P1/P2 cannot be trusted on an ad-hoc build; L0a records them as "not run" and the spike verdict stays provisional for permissions |
| **G1** | Moore IT facts: (1) how staff reach ProfSoft and Caseware: installed client, browser, RDP/RemoteApp, Citrix, **or a browser gateway** (RD Web Client, AVD web client, Citrix Workspace HTML5/StoreFront, Guacamole)? (2) Does anyone run their desktop inside a remote session (Citrix/AVD/RDP to an office PC), where the recorder would run inside it? (3) Windows builds in use (Windows 10 22H2 vs Windows 11 22H2+) and Office for Mac on any Macs | Start of L2a and L2b | None: the owner must answer or explicitly accept "assume remote, including browser gateways", which makes the Citrix/RDP and RD Web smokes mandatory in L2b |
| **G2** | PR target: the name of the "new main branch" and who creates it | L6 step 3 | A branch named `main`, cut from `86b6876` by the orchestrator before L6 starts |
| **U1** | Usability gate (§1, after L3b): 5 non-technical participants (Warp admin or finance staff, ≥ 2 on Mac) for one 45-minute session each | L4a | The owner supplies participants. If fewer than 5 are available, U1 runs with those available and its findings are labelled provisional; L4a still waits for U1 to finish |

---

## 1. Lanes

Summary (default order, top to bottom):

| Lane | Name | Model | Depends on | Acceptance in one line |
|---|---|---|---|---|
| L0a | spike-macos | Sonnet | G3, G0 (P1/P2/D1) | macOS pass/fail matrix with evidence; Electron go/no-go for macOS |
| L0b | spike-windows-verdict | Sonnet | L0a | Windows pass/fail matrix; `VERDICT.md` with go/no-go, helper language, capture backend, masking method |
| L1a | schema-and-ci | Sonnet | G3 | `pnpm test` green on 3 OSes; worked example validates under the normative Ajv options; N-tests rejected for the stated reason |
| L1a2 | format-gate | Sonnet | L1a | Fresh Claude sessions read hand-made packages and are scored deterministically; schema adjusted from the evidence, then frozen |
| L1b | protocol-and-timeline | Sonnet | L1a2, L0b | Simulator transcripts (real event shapes) produce the expected step model; edit-op log with inverses; raw-session format doc |
| L1c | privacy-media-store | Sonnet | L1a2 | Detectors, names-to-hide, redaction serialiser, verifier, encrypted store, media render, all hermetic |
| L1d | rules-and-package | Sonnet | L1b, L1c | Fixture → `buildPackage` → valid package; golden bytes equal package-spec §11.2; extended privacy fixture clean |
| L2a | helper-macos | Sonnet | L1d, L0a, G1 | `swift test` in CI; conformance vs the real Swift helper; Mac smoke; **walking skeleton**: real capture → package → one Claude read |
| L2b | helper-windows | Sonnet | L1d, L0b, G1 | Windows CI (x64 + arm) incl. deterministic mask tests and a loud capture probe; VM smoke incl. dynamic masking and W18 |
| L3a | desktop-shell | Sonnet | L2a, L2b | e2e on simulator: start → record → stop → raw session; KeyService; overlay self-check; per-arch dev builds verified |
| L3b | explain-narration-prompts | Sonnet | L3a | e2e Explain/snap/comment/tags/narration/prompts; Mac raw session; whisper vendored by checksum |
| U1 | usability gate | owner + orchestrator | L3b | 5-participant study; results in `docs/recorder/evidence/U1.md`; copy and defaults changed before L4a |
| L4a | export-gate | Sonnet | U1 | Minimal review, privacy sweep, gate, pre-write verifier, export; **acceptance 2** (Mac) and **acceptance 3** (VM) incl. a remote step |
| L4b | review-editor | Sonnet | L4a | Every edit op from design §12.1 in the UI with undo; one-action delete |
| L5 | spec-and-score | Sonnet | L4a | Packer and chunking; **acceptance 4** on one Mac and one Windows package; image-policy ablations |
| L6 | release-and-pr | Sonnet (Haiku for the Jira step) | L4b, L5, G2 | Dev artefacts per arch, final review clean, PR open, WIAS-229 moved: **acceptance 5** |

---

### L0a spike-macos

- **Model:** Sonnet. **Depends on:** G3 (G0 for P1/P2/D1). **Timebox:** 3 working days plus owner sessions.
- **In scope:** `recorder/spike/macos/**` (throwaway; its own `package.json`, **not** listed in `recorder/pnpm-workspace.yaml`, so it never touches the product lockfile), `recorder/fixtures/evidence/L0a/**`, `docs/recorder/spike/macos.md`, `docs/recorder/smoke/L0a.md`.
- **Builds:** a minimal Electron 45.x app (HUD panel, edge strips, frozen-frame Explain panel per display) plus a minimal Swift helper (listen-only mouse tap, AX hit-test + breadth-first freeze snapshot, ScreenCaptureKit with include/exclude filters and content-change frames, Vision OCR, clipboard change counter, AXObserver focus/value notifications without value reads, permission probe) speaking draft JSON lines. Notarised Developer ID build for the permission checks; stable Apple Development identity otherwise.
- **Pass/fail checks** (B = blocking for the go decision; run on macOS 15, 26 and 27 where available):

| Id | Check | Pass criterion | B | 👤 |
|---|---|---|---|---|
| O1 | Overlay and Explain panel above a native full-screen app (Safari, Excel full-screen) | Visible and drawable; the full-screen app is not kicked out of its Space when the panel appears or the HUD is clicked | B | 👤 |
| O2 | Spaces + two displays (2x + 1x, one left of or above the primary), panels at 125/150/175% scaled modes | Panels on every display, covering the menu-bar strip; the helper-measured window rect equals the display rect within 1 px (design §7.4 self-check); snap boxes and click markers within 2 pt | B | 👤 |
| O3 | Click-through of edge strips and HUD margins | 50 clicks pass through to apps beneath, including menu bar and Dock; 100 toggles of Explain leave no stuck state; clicks on HUD chips produce no step (`ui.regions`) | B | 👤 |
| C1 | Capture excludes our windows | Helper frames (stream + screenshot) show apps but none of our windows while they are visibly on screen | B | |
| C2 | Pre-click frame, timed | Scripted open-then-select: the option is clicked 150 ms and 300 ms after the list opens; the before frame shows the open list in ≥ 95% of 50 trials at each delay; the after frame shows the result | B | |
| P1 | Permission flow from clean TCC (`tccutil reset All <bundle-id>`) on the notarised build | Record every prompt, its order, the app name shown, whether **Input Monitoring is required for a mouse-only listen tap**, relaunch needs, and which process raises Screen Recording. Target ≤ 3 grants (onboarding is built for 4 until this passes) | B | 👤 |
| P2 | TCC attribution | `launchctl procinfo` shows the responsible process for helper design A (plain child) and B (helper `.app`); one is chosen | B | 👤 |
| H1 | Hook safety | With the listen-only tap running, revoking Accessibility mid-recording does not hang input; the helper detects the loss within 2 s and the UI shows it | B (hard stop) | 👤 |
| A1 | AX matrix | Safari, Chrome (web form), an Electron app, Excel, Outlook, a Java app, a remote-desktop client, **menu-bar menu items**: role/name/frame/latency for 20 clicks each; never returns our own window; p95 < 150 ms for native apps | B | 👤 |
| K1 | Hotkeys | Ctrl+Cmd chords register on each macOS version; a taken chord is detected and reported | | |
| M1 | Microphone | Narration records under hardened runtime; transcript aligns with click timestamps within 250 ms | B | 👤 |
| D1 | Distribution | Notarised, stapled build installs on a second Mac with no Gatekeeper warning (informs P2 signing; not an MVP artefact) | | |
| S1 | System picker (optional) | Does `SCContentSharingPicker` avoid the bypass alert and the TCC grant; can it exclude our app | | |
| X1 | Thin slice (macOS half) | helper → JSON lines → a 50-line step builder → a hand-written package that passes a draft validator, with one click, one snapped highlight, one comment and 5 s of narration | B | 👤 |
| X2 | Scope (macOS) | With "apps" scope, an out-of-scope window visible behind the target app is absent from stored frames (pixel check against a solid-colour fixture window) | B | |
| X2b | Out-of-process UI of an in-scope app | Excel Save As, a Chrome/Safari file-upload panel, and a menu-bar menu with Excel or Chrome in scope: record what SCK includes; with the view-service allowlist (design §9.3) each is captured, else a `system_dialog_not_captured` gap is emitted (never a silent hole) | B | 👤 |
| X3 | Clipboard counter | Copy in Excel then paste into a web form is detected via `changeCount` without reading content; no pasteboard privacy alert | | |
| X4 | Keyboard-only steps, no key tap | Three flows: (1) TextEdit form-style flow with Tab, typing, Enter, Cmd+S; (2) Excel: 5 cells with Enter/Tab, then Cmd+S; (3) a 4-field Chrome web form submitted with Enter. One step per field commit or screen change (±1 per flow), each with a before frame and field identity; **the PRV-KEY-01 absence check (design §9.4) passes**; no Input Monitoring prompt | B | 👤 |
| X5 | Offline transcription | whisper.cpp `base.en` with networking blocked on 5 min of scripted synthetic South African English with the domain term list as prompt: real-time factor < 1 on the oldest available Mac **and WER ≤ 15%**; else `small.en` measured the same way; code-switched segments reported | B | 👤 |
| X6 | Offline OCR | Vision OCR < 500 ms per 800×500 crop with networking blocked | | |
| X8 | Skill Recorder review | 2-hour read of Microsoft Skill Recorder (MIT); list modules to borrow or ignore | | |
| X9 | Explain freeze (macOS) | Breadth-first snapshot from the cursor: every node within 300 px of the cursor present, total ≤ 300 ms p95 on Chrome, Excel and an Electron app; snap outline within 2 pt on the frozen frame; comment card accepts typing; previous app regains focus on Done; HUD and prompt-card clicks never change the focused app | B | 👤 |
| X10 | Resource budget (macOS) | Recording 2 displays on the oldest available Mac: average CPU ≤ 15%, RAM ≤ 500 MB across all processes, store growth ≤ 5 MB/min; **a 5K + 4K setup keeps the byte-bounded ring ≤ 96 MB** without stalling the stream (recorded, not blocking) | | |
| X11 | Screen-diff noise | ≤ 1 false step per minute during 5 minutes each of: passive reading; a focused text field left idle (caret blinking); Excel after a copy (marching ants) | | |
| X12 | Blocklist and private windows (macOS) | Each masked within 200 ms: a blocklisted app; a blocklisted test domain in an **unfocused second Chrome window on another display**; a private window **behind** the in-scope window; Safari with the default domain-only address field (URL read from AXURL of the web area). Typing in the omnibox: no typed character in any helper output | B | |
| X14 | Secure fields and remote typing (macOS) | `AXSecureTextField` and an HTML password input in Safari and Chrome classified secure; nothing read. In Windows App connected to the VM: click a remote search box, type a synthetic client name: the helper emits `event.remote_input_suspected` with rects covering the typed text | B | 👤 |

- **Acceptance check:** `docs/recorder/spike/macos.md` contains the table above with pass/fail, numbers and links to evidence under `recorder/fixtures/evidence/L0a/`; every blocking check has a result or an explicit "not run (G0)".
- **Done:** matrix complete; Opus review agrees with each verdict; draft protocol messages (including `ui.regions`, `window.rect`, `remote_input_suspected`, `ui_interaction`, `displays`) written up for L1b.
- **Risks:** permission behaviour differs between ad-hoc and notarised builds (only trust P1/P2 on notarised); macOS point releases (26.3 RC click-through bug, 27.3 beta prompt bug); spending the timebox polishing spike code.

### L0b spike-windows-verdict

- **Model:** Sonnet. **Depends on:** L0a. **Timebox:** 4 working days plus VM sessions.
- **In scope:** `recorder/spike/windows/**` (throwaway, outside the workspace), `recorder/fixtures/evidence/L0b/**`, `docs/recorder/spike/windows.md`, `docs/recorder/spike/VERDICT.md`, `docs/recorder/smoke/L0b.md`, a temporary `.github/workflows/recorder-spike-capture-probe.yml` (deleted at the end of the lane).
- **Builds:** the same Electron spike app for Windows (x64 and arm64), plus a minimal C# helper (`net48` for x64; `net481` arm64 build) with a mouse-only hook, raw-input watchdog, UIA worker, integrity check, WGC capture with DXGI fallback, both masking methods of design §9.3 (z-order mask with shell-surface subtraction and layout quiet period; per-window composite), `Windows.Media.Ocr` and the clipboard sequence number. A Rust prototype is limited to the X7 measurements (hook latency, UIA latency, WGC access, Arm64 build). A WinForms test app with overlapping windows, a popup menu, a tooltip, a password box, a 4-field form and a DPI-unaware window (no manifest).
- **Pass/fail checks** (VM = Win11 Arm64 VM on the owner's Mac; CI = windows-latest x64):

| Id | Check | Pass criterion | B | 👤 |
|---|---|---|---|---|
| W0 | CI capture probe (first, 1 hour) | Does WGC and/or DXGI return a non-black frame on windows-latest and windows-11-arm? Result decides what L2b's CI capture job can assert | decision | CI |
| W1 | Overlay per display: HUD non-focusable, edge strips click-through, frozen Explain panel | Clicks pass through strips to Notepad/Excel; the recorded app never loses focus when HUD/strips show (`showInactive`); focus restored after Explain; HUD chip clicks produce no step | B | 👤 VM |
| W2 | Mixed DPI | 100% primary + 150% secondary placed left, panels at 125/150/175%: overlay window rect equals display rect within 1 px; a highlight around a UIA rect lines up within 2 physical px, **including the DPI-unaware WinForms window on the 150% monitor** (as far as the VM allows; real result at the x64 gate) | B | 👤 VM |
| W3 | Capture exclusion | Frames contain no HUD/strip/overlay pixels; VM result recorded separately; self-test marker detects failure | B | VM |
| W4 | Chromium capturer (only matters for the desktopCapturer fallback) | Log DXGI vs WGC, yellow border; 30 min at 2–5 fps without > 100 MB growth | | VM |
| W5a | Mouse hook + worker isolation | 500 scripted clicks in 5 min all captured; a forced 5 s UIA-worker stall loses no clicks | B | CI |
| W5b | Silent hook removal, and no false alarms | Test switch makes the callback sleep > 1 s: the raw-input watchdog detects within 2 s, reinstalls, logs `hook_lost`, health turns amber. Negative cases: 5 minutes of keyboard-only work and mouse activity over an elevated Task Manager produce **zero** `hook_lost` events; no `SendInput` is used | B (hard stop) | CI + VM |
| W6 | Click-to-element | p95 < 150 ms and > 95% correct names on Notepad, Explorer, Excel ribbon and cells, Outlook, Edge form, Chrome, WinForms, WPF; Excel cell behaviour reported | B | VM |
| W7 | Caseware / Delphi / Java (if available) | What UIA returns, with a quality score per screen | | VM |
| W8 | Remote client, windowed and full-screen: mstsc; Citrix if possible; **RD Web Client in Chrome** | (a) local hook sees clicks; (b) UIA returns only the client window; (c) hotkey fires or not; (d) HUD stays on top or not; (e) OCR on the crop returns the label; (f) the RD Web session is classified remote (`web_gateway`); (g) **type a synthetic SA ID into Notepad inside the remote session: `remote_input_suspected` covers it and a test export's OCR does not contain it** | B | 👤 VM |
| W9 | Elevated window | Task Manager (elevated) in front: `gap{elevated_window}` starts on focus and ends when focus returns; notice shown; frames continue; no crash; no per-click targets | B | 👤 VM |
| W10 | UAC secure desktop | UAC produces a `secure_desktop` gap; recording resumes cleanly | | 👤 VM |
| W11 | Value commit without a value | Editing a field emits a commit event with field identity on focus loss (SetWinEventHook focus/value-change, no ValuePattern) and the PRV-KEY-01 absence check passes; a password box emits nothing | B | CI |
| W12 | OCR | `Windows.Media.Ocr` from the unpackaged helper works or not; tesseract.js < 500 ms per crop | | VM |
| W13 | Microphone | Narration records; the OS mic toggle off shows guidance | | 👤 VM |
| W14 | AV (recorded, P2 gate) | Test-signed build runs with Defender on; any detection recorded by name | | VM |
| W15 | Arm64 | arm64 build runs natively with the helper (`net481` Arm64 or Rust arm64); x64 runs under emulation | B | VM |
| W16 | Topmost competition | HUD stays above full-screen RDP, a slide show and the Teams share bar, or re-asserts within 1 s | | 👤 VM |
| W17 | Keyboard-only steps | Same three flows and bar as X4 (Notepad form flow, Excel cells, Chrome form) | B | CI + VM |
| W18 | Recorder inside an RDP session | Recorder running inside an RDP session to the VM, then disconnected and reconnected: backend chosen at run time; fail-open exclusion detected by the self-test and switched to `mask_recorder_windows`; disconnect → `gap{capture_lost}`; on reconnect the display map is rebuilt and recording resumes or pauses with a notice; `capture.session: rdp` | B | 👤 VM |
| X1 | Thin slice (Windows half) | Same as L0a X1 on Windows | B | 👤 VM |
| X2 | Scope masking (Windows) | Both methods of design §9.3: (a) synthetic window-list tests; (b) static pixel diff (overlap, owned popup + tooltip, display left of primary): every out-of-scope pixel equals the fill; injected enumeration failure blanks the frame with `capture_masking_failed`; (c) **dynamic, animations on**: toast over the in-scope window, minimise/restore of an out-of-scope window over it, live drag, Win+Tab, Start: **zero out-of-scope pixels across 1,000 frames**. Verdict picks the primary method (composite wins a tie) | B | CI + VM |
| X6 | Offline OCR (Windows) | `Windows.Media.Ocr` or tesseract.js < 500 ms per crop, network blocked | | VM |
| X7 | Helper language | C# vs Rust: hook latency, UIA latency, Arm64 native support, WGC access, signing friction; **if C#: the x64 build targets `net48` and starts on a Windows 10 22H2 image without installing a framework**. A decision with numbers | decision | CI + VM |
| X9 | Explain freeze (Windows) | As L0a X9 | B | 👤 VM |
| X10 | Resource budget (Windows) | As L0a X10 in the VM (recorded; real target at the x64 gate) | | VM |
| X12 | Blocklist and private windows (Windows) | As L0a X12 with Chrome and Edge: unfocused second window on another display, InPrivate window behind the in-scope one, omnibox typing never read | B | VM |
| X13 | Windows capture backend | WGC in the helper works with `WDA_EXCLUDEFROMCAPTURE` honoured; else DXGI; else desktopCapturer + MessagePort with memory-only ring. A decision with evidence | decision | VM |
| X14 | Secure fields (Windows) | `IsPassword`/`ES_PASSWORD` and HTML password in Chrome and Edge classified secure; RDP field typing handled as in W8(g) | B | VM |

- **Go rules (written into `VERDICT.md`):**
  - **Go (Electron + helpers):** every blocking check on both OSes passes. Windows is a **provisional go** on VM + CI evidence.
  - **Overlay fails** (O1/O2/O3/W1/X9) under Electron but a 50-line native panel passes: move Explain to a helper-driven native overlay, keep Electron; re-evaluate Tauri only if that also fails.
  - **Exclusion fails** (C1/W3): ship with recorder-window masking as the default (`self_test.fallback`).
  - **Scope masking fails** (X2 on Windows, both methods): stop and ask the owner about display mode + blocklist.
  - **Hook drill fails** (H1/W5b): **stop.** A hook that can hang input or lose clicks silently does not ship.
- **Acceptance check:** `docs/recorder/spike/windows.md` (matrix) and `docs/recorder/spike/VERDICT.md` (both matrices summarised, go/no-go, helper language and target framework, capture backend, masking method, CI capture probe result, macOS helper design A/B, hotkey chords, measured budgets, borrowed Skill Recorder modules, protocol draft) exist with evidence links.
- **Done:** verdict reviewed by Opus and accepted by the owner.
- **Risks:** VM-only behaviour (no GPU) masks real-hardware results; Arm64 vs x64 differences; the pre-pilot x64 laptop gate stays open.

### L1a schema-and-ci

- **Model:** Sonnet. **Depends on:** G3. **Parallel-safe** with L0a/L0b (disjoint directories; spike code is outside the workspace).
- **In scope:** root `package.json` (only `"test": "pnpm --dir recorder install --frozen-lockfile --prefer-offline && pnpm --dir recorder test"` and a `packageManager` pin); `recorder/package.json` (with the same `packageManager` pin), `recorder/pnpm-workspace.yaml`, `recorder/pnpm-lock.yaml`, `recorder/tsconfig.base.json`, `recorder/vitest.workspace.ts`; `recorder/packages/schema/**` (package, process-spec and reference-SOP schemas copied verbatim from package-spec §8, §9.1 and §15.1; validator with injected detectors and `src/detectors-min.ts`; semantic validator V1–V17; CHANGELOG; `migrate()` stub); `recorder/packages/geometry/**`; `recorder/packages/cli/**` (`handover validate` only); `recorder/fixtures/golden/worked-example/**` (the package-spec §10 example as a real package folder with deterministic synthetic PNGs, all four a11y files and real hashes); `recorder/tools/ci/**` (media/package guard, socket stub, CHANGELOG + `schema_patch` gate); `.github/workflows/recorder-ci.yml`; `docs/recorder/package-spec.md` (to fix defects the validator finds, with a CHANGELOG entry).
- **Acceptance commands:**
  1. `pnpm test` from the repo root exits 0 on ubuntu-latest, macos-latest and windows-latest in CI from a clean checkout (the root script includes the install); no Electron binary is downloaded; the vitest run makes no network call (stub active).
  2. **First check:** `new Ajv2020({ strict: true, strictRequired: false, allErrors: true })` plus `ajv-formats` (both dependencies of `packages/schema`) compiles the three schemas and validates every positive block of `fixtures/golden/worked-example` (manifest, every JSONL line, dataflow, readiness, privacy, every `a11y/*.json`); `handover validate fixtures/golden/worked-example` exits 0 (schema + V1–V17).
  3. Every S-test of package-spec §14 is rejected with **exactly** its listed `schemaPath` and parameter (no error from an unrelated rule); every V-test with its rule id; the positive edge tests pass.
  4. Geometry property tests: round-trip dpx ↔ fpx ↔ cpx within 0.5 px, including a 150% display at negative origin and the logical-unit crop (`crop_scale = 1/(scale × scale_factor)`).
  5. Guard tests: a PNG planted outside `recorder/fixtures/` fails the guard; under the stub a localhost TCP connect fails while an `AF_UNIX` socket / `\\.\pipe\handover-<random>` pipe opens; a schema change without a CHANGELOG entry and a `schema_patch` increment fails the gate.
- **Done:** all five pass; the schemas in the package equal package-spec §8/§9.1/§15.1 (or the spec is corrected in the same lane).
- **Risks:** Windows path separators in hashes and guard; pnpm install scripts pulling the Electron binary (verify, do not assume).

### L1a2 format-gate

- **Model:** Sonnet. **Depends on:** L1a. **Timebox:** 2 working days.
- **Why:** the package format freezes when this lane merges. Before that, real Claude sessions must read packages in this format and be scored, so the schema can still change on evidence.
- **In scope:** `recorder/packages/spec/**` (skeleton; PS1–PS4 validator; the deterministic scorer of package-spec §15.2; nothing that opens a socket); `recorder/packages/cli/**` (`handover score`); `recorder/fixtures/test-process-app/**` (static synthetic "Lockdown capture" web app: signed-pack page with a Completed date, a register form, a sign-in box with a password field, a synthetic client name in the page title and body, a document list with several synthetic client rows, a URL with a query string; no dependencies); `recorder/tools/format-gate/**` (a script that renders package images from test-process-app with headless Chromium; not part of `pnpm test`); `recorder/fixtures/format-gate/**`; `recorder/fixtures/acceptance/{macos,windows}/reference_sop.json`; `recorder/packages/schema/**` and `docs/recorder/package-spec.md` (non-additive changes allowed, with CHANGELOG entries); `docs/recorder/evidence/L1a2.md`.
- **Builds:** two hand-authored synthetic packages besides the golden one: (a) **remote-heavy** (a ProfSoft-style lookup in a remote window with remote typing, T0/T1 steps); (b) **per-client loop with an Excel step** (a grid-cell value commit, `process.repeat: per_client`). Each with a reference SOP written first. Each is rendered in three image policies (`full_and_crop`, `crop_only`, `text_only`).
- **Acceptance commands:**
  1. `pnpm test` green, including: PS1–PS4 tests (N30 included); scorer tests on recorded Claude-output fixtures (deterministic: same input, same score bytes; no network); a `matches.json` override test.
  2. **Reader runs:** for each of the 3 packages, fresh Claude Code sessions started with `hc run` in a temp directory outside any git repo (parent folder holding `<pkg>.handover/` and an empty `<pkg>.derived/`, user `CLAUDE.md` disabled), prompt "Follow `<pkg>.handover/CLAUDE_HANDOFF.md`", once with Opus 5.5 and once with Sonnet 5.5; plus two ablations per package: without `PROCESS.md`, and `text_only`. All outputs and scores committed under `recorder/fixtures/format-gate/`.
  3. `docs/recorder/evidence/L1a2.md` reports every score against the package-spec §15.2 metrics, the image-policy comparison (which sets the default image policy, package-spec §3.4), and each schema or template change made because of it.
- **Done:** all three; every schema change made here is in the CHANGELOG; the CHANGELOG records **"format frozen at L1a2"**; the default image policy is written into package-spec §3.4.
- **Risks:** tuning the reference to the output (references are committed before any reader run; never edited after); a weak score blamed on the prompt instead of the format.

### L1b protocol-and-timeline

- **Model:** Sonnet. **Depends on:** L1a2, L0b (protocol draft and capabilities from the verdict).
- **In scope:** `recorder/packages/helper-protocol/**` (zod schemas, client, `HelperSupervisor`, `HelperSimulator`, conformance suite); `recorder/packages/core/src/{session,timeline,steps,alignment,snap,edits}/**` (core skeleton created here); `recorder/fixtures/transcripts/**`; `docs/recorder/raw-session.md` (new: the raw-session fixture format that `handover render` consumes: helper transcript, prompt answers, Explain annotations, edit log, names-list stub, policy, tenant profile, `exportContext`).
- **Acceptance commands:** `pnpm test` green, including:
  - simulator transcripts, **built only from message shapes the real helpers send**, for each grounding level (T3/T2/T1/T0), each `observed_via` row of package-spec §5.2.5 (including selection gesture + clipboard change → one copy step), remote session, **remote-in-browser (`web_gateway`)**, **remote typing (`event.remote_input_suspected` → blurred rects, `input_target_unknown`)**, elevated focus (→ `gap{elevated_window}`, no per-click targets, no `hook_lost`), keyboard-only flow (value commits + screen changes + inferred Ctrl+S from a title change), keyboard-only work for 5 minutes (no `hook_lost`), clipboard counter copy, hook loss, helper restart, permission loss, pause, the four auto-pause reasons, out-of-scope app, excluded app, blocklisted URL host, private window, unconfirmed browser window, **clicks on our own HUD (`ui_interaction` → no step)**, recorder inside RDP with disconnect/reconnect: each produces the expected internal step and gap model (golden JSON);
  - **named degraded-mode tests** in the conformance suite: `self_exclude=false → recorder windows masked`, `ocr=tesseract`, `a11y_snapshot empty → dashed snap`, `helper_restarting → gap`, `capture_backend=desktop_capturer → core_mask`; each fails if its fallback is removed;
  - `HelperSupervisor` against a fake helper that hangs, crashes and sends malformed lines: deadlines fire, restart with backoff, `helper_restart` gap, no unhandled rejection;
  - snap hit-test on snapshot fixtures (deepest meaningful control, `[`/`]` walk, empty → dashed);
  - narration alignment (`[t−3 s, t+1 s)`, confidence < 0.6 on overlap; alignment lives here only, `narration` holds just the transcriber);
  - **edit-op log:** the op union of design §12.1 (zod), each with payload, inverse and replay; a projection test: replaying any prefix of a golden edit log and then its inverses returns the original projection byte for byte.
- **Done:** conformance suite is runnable later against a real helper with one command (`pnpm conformance -- --helper <path>`); `docs/recorder/raw-session.md` committed and used by the fixtures.
- **Risks:** protocol drift from the spike draft (version the protocol from day one); clock alignment between helper and audio.

### L1c privacy-media-store

- **Model:** Sonnet. **Depends on:** L1a2. **Parallel-safe** with L1b (disjoint packages; merge one at a time because of the lockfile).
- **In scope:** `recorder/packages/privacy/**`, `recorder/packages/media/**`, `recorder/packages/store/**` (skeletons created here), `recorder/fixtures/privacy/**`, `recorder/fixtures/ocr/**` (pinned or vendored tesseract language data).
- **Acceptance commands:** `pnpm test` green, including:
  - detectors with the synthetic PII generator (SA ID with valid/invalid Luhn and dates, SARS tax mod-10, VAT, card Luhn, email, ZA phone; medium: bank, company reg, names, amounts; special-PI keywords): recall ≥ 0.95 on structured ids, false-positive rate reported;
  - **names-to-hide matcher:** case-, diacritic- and whole-word matching over every text channel and OCR boxes; the list is stored only in the encrypted store; a synthetic tenant dictionary file (PRV-PII-04);
  - **one redaction serialiser** applies one plan across pixels, OCR text, control and a11y names, locators, titles (`window_title_mode` spans/whole), URLs, comments, transcript and every plain-string field listed in package-spec §4.1, emitting a `privacy.json` record per replacement with the closed class tokens; URL reduction (origin + path, `[ID]` segments); a11y export pruning with sibling names withheld;
  - **pre-write verifier** as a pure function over in-memory files: an injected missed digit or a names-list hit in an image aborts with the location; tesseract runs from the vendored data with the socket stub active;
  - media: burn-in region variance ≈ 0; metadata stripped; crop clamping and logical-unit crops; annotated render per the package-spec §5.3 shape table (golden images by perceptual hash);
  - store: no PNG/WAV magic bytes or fixture strings in raw files; decryption fails without the keystore entry; crypto-shred; step delete removes blobs; a temp-dir watch sees no content files (PRV-STO-02); path classifier refuses synced folders; retention with a fake clock (PRV-STO-05); audit chain detects tampering and contains no fixture strings (PRV-LOG-01/02); the `Keystore` interface plus the in-memory implementation;
  - policy loader: a managed policy that tries to loosen a floor is ignored and logged (PRV-ADM-02).
- **Done:** PRV-DEV-03 regression suite (the PRV-KEY-01 absence check as defined in design §9.4, SEC-02/03, EXP-04/05, LOG-01, STO-01/02) runs inside `pnpm test`.
- **Risks:** `sharp` native binaries per platform in CI; tesseract data size in the repo; Windows file locking in store tests.

### L1d rules-and-package

- **Model:** Sonnet. **Depends on:** L1b, L1c.
- **In scope:** `recorder/packages/core/src/{rules,prompts,dataflow,build-package,generators}/**`; `recorder/packages/cli/**` (`lint`, `render` with `--image-policy`); `recorder/fixtures/golden/**`; `recorder/fixtures/test-process-app/**` (extend only); `recorder/config/tenants/{default,moore.example}.json` (package-spec §9.3 keys).
- **Acceptance commands:** `pnpm test` green, including:
  - a fixture raw session of the Lockdown process (in the `docs/recorder/raw-session.md` format) → `buildPackage(…, exportContext)` → a package that passes `handover validate` and `handover lint`;
  - **the golden worked example:** rendering its raw session gives `PROCESS.md` byte-equal to package-spec §11.2 and `steps-guide.html` following the §13 skeleton; golden byte comparison of `steps.jsonl`, `dataflow.json`, `readiness.json`, `privacy.json`, `CLAUDE_HANDOFF.md`; building twice with the same `exportContext` gives identical bytes; chapter markers become `manifest.recording.chapters` and PROCESS.md headings;
  - R1–R17 unit tests, the `commit_like` predicate and the boundary emission rules (no profile → `not_assessed/none`; profile, no rule → `ok/tenant_rule`); only R7/R15 block; R15 checks `input_ack` and `scope_acknowledged`; prompt budget with a fake clock (≤ 1 per 60 s of task time, none in the first 20 s, none while typing, halve after 2 skips, off after 3);
  - **privacy acceptance fixture** (design §16.1): password field, SA ID number, URL query string, and a names-list client name in a window title, page body, list sibling row, a11y names, a locator, narration and typed into a remote search box; an inbox-like list visible at freeze → the exported package contains none of them (all text files searched; exported images OCR'd), still contains steps, highlight, comment and transcript, and `privacy.json` lists each redaction (V17 holds);
  - image policies: the same session rendered `crop_only` and `text_only` validates (V4);
  - tenant profile sets `is_system_of_record` and boundaries; `default.json` sets none.
- **Done:** `handover render <session-fixture> <out>` produces a valid package from a fixture with no Electron.
- **Risks:** non-determinism (map ordering, image encoder versions); PROCESS.md emitting a redacted value.

### L2a helper-macos

- **Model:** Sonnet. **Depends on:** L1d, L0a, **G1**. **Parallel-safe** with L2b (disjoint native dirs; each adds its own workflow file).
- **In scope:** `recorder/native/macos/**` (Swift package `HandoverHelper`, XCTest, SwiftUI `FixtureApp` with the Lockdown "practice lookup" screen, a grid, a password field and overlapping windows); `.github/workflows/recorder-macos-helper.yml`; `docs/recorder/smoke/L2a.md`; `recorder/fixtures/evidence/L2a/**`.
- **Implements:** listen-only mouse tap with trust polling and teardown; AX hit-test (skipping only pass-through rects; menu-bar special case) + hover cache + breadth-first freeze snapshot; SCK capture with include filter (apps scope, plus the view-service allowlist) and exclude filter (display scope); content-change, byte-bounded, copied ring buffer with hover snapshots; binary channel with token; AXObserver focus and value-commit notifications (no value); window and title notifications; clipboard counter; remote-client and remote-in-browser detection; `remote_input_suspected` from frame diffs (caret masked); document-URL check on every visible browser window; secure-field detection; Vision OCR; `perm.status`; `ui.regions`; `window.rect`; display map; capabilities handshake.
- **Acceptance commands:**
  1. `swift test` green in the macOS CI job (protocol codec, coordinate conversion, snapshot pruning and BFS order, mask maths, frame-diff rects).
  2. 👤 `pnpm conformance -- --helper <built helper>` passes on the owner's Mac (same suite as the simulator).
  3. 👤 Mac smoke re-run on the product helper: C1, C2 (timed), H1, A1 (subset: Chrome form, Excel, FixtureApp, remote client, menu bar), X2, X2b, X4, X9 (snapshot part), X12, X14; evidence under `recorder/fixtures/evidence/L2a/`.
  4. 👤 **Walking skeleton:** record the Lockdown flow with the product helper into a raw-session transcript, run `handover render` on it, the package validates and lints, and one fresh Claude session (as in L1a2) reads it; the score is recorded as a diagnostic in `docs/recorder/evidence/L2a.md` (not a pass bar). This is the first real-capture-to-package run, before any UI lane.
- **Done:** all four; helper never writes files or opens sockets other than the token channel (code review + test).
- **Risks:** TCC attribution (design A vs B from P2); AX calls blocking on busy apps; SCK filter changes across macOS versions.

### L2b helper-windows

- **Model:** Sonnet. **Depends on:** L1d, L0b, **G1**.
- **In scope:** `recorder/native/windows/**` (helper in the language and target framework chosen by X7, tests, `TestTargetApp` WinForms + WPF with the Lockdown "practice lookup" screen, a grid, password box, overlapping windows, popup, tooltip and a DPI-unaware window); `.github/workflows/recorder-windows-helper.yml` (windows-latest x64 **and** windows-11-arm); `docs/recorder/smoke/L2b.md`; `recorder/fixtures/evidence/L2b/**`.
- **Implements:** per-monitor DPI V2; mouse-only hook that only enqueues; raw-input watchdog (suppressed under elevated focus or a non-Default desktop; no synthetic input); elevated focus as a gap; UIA worker with ~1.5 s transaction timeout; SetWinEventHook focus/value-change (no ValuePattern); integrity and secure-desktop detection; capture backend from X13 with the masking method chosen by X2 (shell-surface subtraction, layout-event quiet period, fail-closed blanking); content-change ring in memory; binary named-pipe channel with token; window and title events; clipboard sequence number; remote-client and remote-in-browser detection; `remote_input_suspected` (caret masked via `GetGUIThreadInfo`); document-URL check on every visible browser window; `IsPassword`; OCR per W12; `ui.regions`; `window.rect`; display map; topology-B handling (W18); capabilities handshake with `session`.
- **Acceptance commands:**
  1. Windows CI (x64 and arm64): unit tests; conformance suite against the built helper; integration against `TestTargetApp` via SendInput or winapp: correct UIA names and physical bounds, password box emits nothing (W11), watchdog drill and its negative cases (W5b), 500-click run (W5a), keyboard-only flows (W17); **mask algorithm tests on synthetic window lists and frames (everywhere)**; a capture-integration job whose first step asserts a non-black frame and **fails loudly with "capture unavailable on runner"** if W0 said capture works there, never silently skipping (if W0 said it does not, the job is absent and the static diff moves to the VM smoke).
  2. 👤 VM smoke (arm64 native + x64 emulated): W8 (mstsc, RD Web Client, remote typing; Citrix too if G1 said Citrix), W9, W10, W18, X2 (static on two displays + dynamic 1,000 frames), X12, X13 re-run, X14.
- **Done:** both; the hook callback contains no blocking call (code review).
- **Risks:** Arm64 runner availability; WGC behaviour in the VM without GPU.

### L3a desktop-shell

- **Model:** Sonnet. **Depends on:** L2a, L2b (and therefore L1d).
- **In scope:** `recorder/apps/desktop/**` except `src/renderer/{overlay,review}/**` and `src/main/export/**` (skeleton created here: window manager, supervisor wiring, IPC router with zod channels, session controller incl. auto-pause, policy and tenant loading, permission onboarding logic, **KeyService** wrapping keys with `safeStorage` and serving the core's `Keystore` over a MessagePort, overlay alignment self-check, display matching by native origin, `ui.regions` publisher); `recorder/packages/ui/src/{hud,edge-strip,onboarding,start-sheet,wrap-up,practice-run}/**` (ui skeleton created here); `recorder/apps/desktop/electron-builder.*` (**minimal unpacked builds**: macOS universal signed with the stable Apple Development identity; Windows x64 + arm64 unsigned); `recorder/pnpm-workspace.yaml` (`supportedArchitectures` for os darwin/win32 and cpu x64/arm64); `recorder/tools/build-verify/**`; `recorder/e2e/shell/**`; `recorder/package.json` scripts `test:e2e` and `build:dev`; `.github/workflows/recorder-e2e.yml`, `.github/workflows/recorder-build-dev.yml`.
- **Acceptance commands:**
  1. `pnpm test` green: UI component tests; IPC channel tests (no start-record channel outside the UI handler, PRV-REC-02); onboarding state machine with fake permission statuses; hotkey conflict handling; idle auto-pause after 5 min with a fake clock (PRV-REC-06); lock/sleep/user-switch/screensaver events pause with their gap reasons and never auto-resume (PRV-REC-05); chapter marker every 15 min and the 60-minute soft warning (fake clock); start sheet requires done-when and accepts the names-to-hide list (stored only through the store); wrap-up writes `done_when_steps` and `repeat`; KeyService ↔ Keystore round trip over a MessagePort; `ui.regions` sent on every HUD/card move.
  2. `pnpm test:e2e` (all three OSes, simulator): first run → privacy notice → practice run → start sheet → record → pause/resume → That was a mistake → stop → wrap-up → raw session persisted and encrypted; self-test marker failure switches to recorder-window masking; the evidence dot shows green/amber/grey for T3, remote and out-of-scope transcripts; a click in an out-of-scope app shows the "Excel isn't being recorded. Add it?" chip and adding it extends the scope; HUD clicks produce no step.
  3. **Build verify (CI, per artefact):** universal whisper.cpp and Swift helper merged with `lipo`; `x64ArchFiles` lists sharp's `.node`; `asarUnpack` covers sharp and the helper binaries; a script loads sharp inside a utilityProcess and runs `helper --version` (and, once L3b lands, `whisper --help`) on each arch (arm64 natively on windows-11-arm and macos arm64, x64 under Rosetta or Prism).
  4. 👤 Mac smoke with the real helper on the `build:dev` app: permission cards from a clean TCC state (4 cards until P1 proved 3); edge strips visible on both displays in a phone photo of the screen but absent from frames (PRV-REC-03); overlay self-check passes on both displays; HUD clicks never move focus; clicks across Chrome + FixtureApp land in the raw session with T3 targets; screen lock pauses; a rebuild with the same identity still opens an earlier recording (Keychain).
  5. 👤 VM shell smoke (arm64 build) with the real Windows helper: HUD focus, edge strips, self-test, overlay self-check at 150%, a click into TestTargetApp lands in the raw session with a T3 target.
- **Done:** all five; crash reporter upload off (config test).
- **Risks:** panel/focus behaviour differing between spike and product windows; Electron version drift; signing identity not stable across machines.

### L3b explain-narration-prompts

- **Model:** Sonnet. **Depends on:** L3a.
- **In scope:** `recorder/packages/ui/src/{explain,comment-card,prompt-card}/**`; `recorder/apps/desktop/src/renderer/overlay/**`; `recorder/packages/narration/**` (skeleton created here; transcriber adapter only); prompt-engine wiring in `apps/desktop/src/main`; `recorder/tools/vendor-whisper/**` (build or fetch whisper.cpp per arch and download `base.en`/`small.en`, verified against sha256 values committed in the repo, into the untracked `recorder/vendor/whisper/`; no `bin/` path, because the root `.gitignore` ignores `bin/`); a whisper vendoring step in `.github/workflows/recorder-build-dev.yml`; `recorder/e2e/explain/**`.
- **Acceptance commands:**
  1. `pnpm test` green (comment-card tag follow-ups including "What does it look like?" reduced to a format, prompt card behaviour with fake clock); `pnpm test` never touches `recorder/vendor/`.
  2. `pnpm test:e2e`: Explain freezes, Snap on a snapshot fixture (solid and dashed), `[`/`]` walk, comment + three tags + follow-ups, Redact, Done restores focus (simulated); the Decision quick-mark hotkey tags the current step and fires R2; narration toggle produces aligned segments from a fixture audio/transcript; R2/R3/R4 prompts fire within budget and answers become annotations.
  3. 👤 Mac smoke: a raw session of the Lockdown process with clicks, one snapped highlight, one comment and 30 s of narration, transcribed offline with the vendored model (checksum verified); HUD mic held with the mouse works; no hold-to-talk key exists.
- **Done:** all three; mic closed outside narration intervals (test: no audio samples stored outside them).
- **Risks:** transcription CPU on older laptops (keep it off the recording path); focus restoration on Done.

### U1 usability gate (not a Sonnet lane)

- **Run by:** the owner with the orchestrator; Sonnet may prepare the script and the analysis sheet. **Depends on:** L3b. **Blocks:** L4a.
- **Participants:** 5 non-technical people (Warp admin or finance staff, ≥ 2 on Mac), synthetic data only.
- **Task:** install the `build:dev` app, do the practice run, then record the synthetic Lockdown process and wrap up. Two arms: narration starting **on** (Toggle on at Start) vs starting **off**.
- **Measures:** install-to-first-recording time (G6 target ≤ 5 minutes); share of non-trivial steps with a "why" at wrap-up; prompt answer and skip rates; a comment-specificity rubric (names a rule, condition or source vs restates the click); time overhead against doing the bare task; where people got stuck.
- **Output:** `docs/recorder/evidence/U1.md`; copy changes, prompt-budget changes and the narration default are decided from it and applied by the orchestrator (or as part of L4a's contract) before L4a starts.

### L4a export-gate

- **Model:** Sonnet. **Depends on:** U1.
- **In scope:** `recorder/packages/ui/src/review/{filmstrip,frame,details,sweep,gate,preview}/**`; `recorder/apps/desktop/src/renderer/review/**`; `recorder/apps/desktop/src/main/export/**` (ExportService with `exportContext`, privacy-worker and media-worker wiring); `recorder/e2e/review/**`; `recorder/fixtures/acceptance/{macos,windows}/*.handover/`; `docs/recorder/smoke/L4a.md`.
- **Builds:** a minimal review screen (filmstrip, frame with overlays, read-only details, "Text Claude will see" panel with unredacted-text counts, riskiest-first privacy sweep, acknowledge scope and input, answer open prompts), the gate, the preview, and the export pipeline of design §12.4 in its order: in-memory render of the content files → pre-write verifier → preview (content-file hash) → attestation as the last gate condition → `privacy.json` and manifest → validate → write → read-back hash check → second verifier pass logged to the audit log.
- **Acceptance commands:**
  1. `pnpm test` green: gate tests, one per condition (every step viewed, detections resolved, R7, R15 with `input_ack` and `scope_acknowledged`, verifier passed, attestation last); verifier runs before any write (a hit leaves no file on disk); `privacy.json` is built only after the attestation; the written content files equal the preview hash; a read-back mismatch deletes the output; `exportContext` makes two exports of the same session byte-identical; the export module has no network imports.
  2. `pnpm test:e2e`: review → privacy sweep → acknowledge unverified scope and remote input → preview → attest → export → `handover validate` + `handover lint`.
  3. 👤 **Acceptance 2 (Mac):** record the Lockdown process (Chrome web app + FixtureApp lookup with a grid cell + the ProfSoft-style lookup in Windows App connected to the VM, with the client name typed into the remote search box) with clicks, a highlight, a comment and narration → review → export; package validates and lints; committed under `recorder/fixtures/acceptance/macos/`.
  4. 👤 **Acceptance 3 (Win11 VM):** the same on Windows with Chrome + TestTargetApp + the lookup through `mstsc` to `127.0.0.2` (or a second VM if the edition cannot host RDP; which one is recorded), arm64 native build (and x64 emulated build recorded as a second run); committed under `recorder/fixtures/acceptance/windows/`; report labels the result **provisional** (Arm64 VM, headless x64 CI) and names the open x64-laptop gate.
  5. 👤 Privacy smoke: with a synthetic password, SA ID, a names-list client name in the title, page body and remote search box, and a URL query string on screen during recording, none appears in the exported package (pre-write verifier passes; independent grep + OCR confirms).
- **Done:** all five.
- **Risks:** verifier false positives blocking real exports (tune, never weaken); large packages slowing the preview.

### L4b review-editor

- **Model:** Sonnet. **Depends on:** L4a. **Parallel-safe** with L5 (disjoint: `packages/ui/src/review/editor` vs `packages/spec`).
- **In scope:** `recorder/packages/ui/src/review/editor/**`; `recorder/apps/desktop/src/renderer/review/**` (editor wiring only); `recorder/e2e/editor/**`.
- **Acceptance commands:**
  1. `pnpm test` green: every op of design §12.1 has a UI action and an undo that restores the projection byte for byte; one action deletes a recording with all derived data and local exports (PRV-STO-07).
  2. `pnpm test:e2e`: rename, merge, split, convert to decision/wait/checkpoint, insert an off-screen step (becomes a `manual` step), move narration, classify a value, set a format (R17), un-blur with a reason, redact everywhere; reordering is not offered; delete removes blobs; an export after edits validates.
- **Done:** both.
- **Risks:** undo of blob-deleting ops (blobs are removed only when the op is committed, design §12.1).

### L5 spec-and-score

- **Model:** Sonnet. **Depends on:** L4a (acceptance packages exist).
- **In scope:** `recorder/packages/spec/**` (packer and chunking; teach-back extraction; the scorer already exists from L1a2); `recorder/packages/cli/**` (`spec`); `recorder/tools/acceptance-harness/**` (temp-dir setup, `hc run` launch, `derivation.json` writer); `recorder/skills/understand-process/SKILL.md`; `recorder/fixtures/acceptance/*/*.derived/**`; `docs/recorder/evidence/L5.md`.
- **Acceptance commands:**
  1. `pnpm test` green: packer request shape (documents first in XML tags, label before each step's images, instructions last, inline base64, `oversized_image: "error"`, ≤ 1,568 px); chunking splits a 130-image synthetic package into ≤ 100-image requests plus a text-only merge; the harness computes `prompt_sha256` as package-spec §9.2 defines.
  2. **Acceptance 4:** for each of the two acceptance packages, the harness copies the package into a fresh temp directory outside any git repo with an empty `<pkg>.derived/`, disables user `CLAUDE.md`, starts a fresh Claude Code session with `hc run` (prompt "Follow `<pkg>.handover/CLAUDE_HANDOFF.md`", model Opus 5.5 or Sonnet 5.5, id and effort recorded), then writes `derivation.json`. `handover score <package> <spec> fixtures/acceptance/<os>/reference_sop.json` reports on **both** the Mac and the Windows package: step F1 ≥ 0.9; zero order inversions; app + control correct ≥ 90% of action steps; 100% valid evidence citations; zero unflagged invented steps; zero guessed values; 100% of user-stated decisions, rules, join hints and lineage recovered; done-when covered.
  3. The image-policy ablations (`crop_only`, `text_only`) of both packages are scored and reported; if a lower-exposure policy is within 0.02 F1 of `full_and_crop`, it is proposed as the default through an additive policy change.
  4. Execution check (recorded, not a pass bar): an agent given only `process_spec.json` runs `test-process-app` with fresh synthetic data down both branches and reaches done-when; result in `docs/recorder/evidence/L5.md`.
- **Done:** 1–3 pass and 4 is recorded; outputs and `derivation.json` committed under the acceptance fixtures; `spec` is not a dependency of `apps/desktop` (dependency check).
- **Risks:** a weak score points at the package, not the prompt: fix the generator or CLAUDE_HANDOFF.md through a schema/template change request, never by editing the reference SOP after the fact.

### L6 release-and-pr

- **Model:** Sonnet; **Haiku** for the mechanical Jira transition and PR-link comment.
- **Depends on:** L4b, L5, **G2**.
- **In scope:** `.github/workflows/recorder-release.yml` (artefacts only, no publishing); electron-builder config for **labelled test artefacts**: the unpacked `build:dev` outputs plus zipped apps per arch (macOS universal `.app.zip` signed with the Apple Development identity; Windows x64 and arm64 `.zip`), each named `*-TEST-BUILD-*`; DMG, NSIS installers, notarisation and signing stay Phase 2 (design F25); `recorder/tools/ci/` release grep (PRV-KEY-06) and signature-check scaffold (enforced in Phase 2); `docs/recorder/admin-guide.md` (DPAPI note PRV-STO-04, permissions, policy file, names-to-hide dictionary); PR description.
- **Acceptance commands (acceptance 5):**
  1. Release workflow produces the zipped test artefacts for all three targets and runs build-verify on each; release grep finds no debug keylogging symbol.
  2. Final Opus review over the full task-branch diff (iterative review-and-fix) recorded with zero open findings.
  3. PR opened from `task/workflow-recording-assistant` into the G2 branch (default `main` cut from `86b6876` by the orchestrator), body generated from the actual diff, linking `VERDICT.md`, the evidence reports, U1, and the acceptance packages.
  4. WIAS-229 transitioned to the review state with links to the PR and evidence (Haiku sub-step).
- **Done:** all four; `pnpm test` green on the PR's CI.
- **Risks:** confusing test artefacts with distributable ones (label them).

---

### 1.1 Traceability: every MVP feature and privacy MUST has an owner and a check

Feature ids are from design §6. A row with two lanes means the first builds the logic and the second wires it into the app.

| Item | Lane(s) | Proven by |
|---|---|---|
| F1 Explain freeze + tools | L3b | L3b e2e (2); X9 smoke |
| F2 Snap + `[`/`]` walk + dashed mode | L1b, L3b | L1b snap tests; L3b e2e |
| F3 Comment card, three tags, follow-ups | L3b | L3b e2e |
| F4 Live prompts R2/R3/R4 + budget | L1d, L3b | L1d fake-clock tests; L3b e2e; U1 rates |
| F5 Readiness rules R1–R17 (checklist, gate, lint) | L1d, L4a | L1d rule tests + `handover lint`; L4a gate tests |
| F6 Dataflow from prompt answers + clipboard counter | L1b, L1d | L1b clipboard transcript; L1d golden `dataflow.json` |
| F7 Evidence dot | L3a | L3a e2e (2) |
| F8 Honest gaps | L1b, L2a/L2b | L1b transcripts; helper smokes |
| F9 That was a mistake | L3a | L3a e2e (2) |
| F10 Start sheet (done-when, names to hide) + wrap-up (done-when steps, repeat) | L3a | L3a unit (1) and e2e (2) |
| F11 Practice run | L3a | L3a e2e (2); U1 |
| F12 Review editor ops incl. manual insert, no reorder | L1b (op log), L4b | L1b projection test; L4b tests |
| F13 One redaction across channels, names-to-hide, verifier | L1c, L1d, L4a | L1c unit; L1d privacy fixture; L4a privacy smoke (5) |
| F14 "What Claude will see" preview + text panel | L4a | L4a preview-hash test; e2e |
| F15 Steps guide | L1d | L1d golden (§13 skeleton) |
| F16 Chapter markers + 60-min warning | L1d, L3a | L1d golden; L3a fake-clock test |
| F17 Off-screen (manual) steps | L4b | L4b e2e (2) |
| F18 Edge strips | L3a | L3a Mac smoke (4), VM smoke (5) |
| F19 CLI validate / lint / render / spec / score | L1a, L1a2, L1d, L5 | each lane's acceptance |
| F21 Teach-back questions in `open_questions` | L5 | PS validator + acceptance 4 output |
| F28 Image policy + ablations | L1d, L1a2, L5 | L1d V4 tests; L1a2 and L5 ablation reports |
| Format read by Claude before freeze | L1a2 | L1a2 evidence report |
| Decision quick-mark hotkey | L3b | L3b e2e (2) |
| "Excel isn't being recorded. Add it?" chip | L3a | L3a e2e (2) |
| Own-UI clicks never become steps | L1b, L2a/L2b, L3a | conformance test; O3/W1 |
| PRV-REC-01 no capture outside Start–Stop, no pre-roll | L1b, L2a/L2b | L1b transcript test; helper code review (ring buffer only while recording) |
| PRV-REC-02 local start only | L3a | L3a IPC test |
| PRV-REC-03 indicator on every display, not captured | L3a | L3a smokes |
| PRV-REC-04 pause | L3a | L3a e2e |
| PRV-REC-05/06 auto-pause on lock/sleep/user switch/screensaver/idle, manual resume | L3a | L3a fake-clock and OS-event tests; Mac smoke |
| PRV-REC-08 apps scope default | L2a/L2b, L3a | X2/X2b checks; L3a start sheet |
| PRV-SCOPE-01/02 app blocklist and masking | L2a/L2b | X2 (static + dynamic), X12 re-run in helper smokes |
| PRV-SCOPE-03 URL-host blocklist on every browser window, private windows | L1b, L2a/L2b | L1b transcripts; X12 re-run |
| PRV-SCOPE-06 unverified scope acknowledged | L1d, L4a | R15 tests; L4a gate test |
| PRV-SEC-01/02 secure fields | L2a/L2b | X14 re-run; W11 |
| PRV-SEC-03 unknown input target (remote typing) fails closed | L1b, L2a/L2b, L4a | L1b transcript from the real event shape; W8(g)/X14; acceptance 2/3 remote step; L4a privacy smoke |
| PRV-SEC-04 no clipboard read | L2a/L2b | code review + X3 |
| PRV-KEY-01 no value read; absence check | L1c, L2a/L2b | L1c regression suite; W11/X4/W17 absence check |
| PRV-KEY-03 typed-field blur | L1d | privacy fixture |
| PRV-KEY-05 grid cells | L2a/L2b | W6 Excel cells; FixtureApp/TestTargetApp grid step in acceptance 2/3 |
| PRV-KEY-06 no keylogger in builds | L6 | release grep |
| PRV-PII-01..08 detectors, names-to-hide (PII-04 dictionary), special PI, copy | L1c, L4a | L1c tests; L4a sweep e2e |
| PRV-AUD-01..04 mic gating, on-device, no audio export | L3b, L1d | L3b mic test; V11 / schema `audio_included: false` |
| PRV-STO-01..06 encryption, temp files, paths, retention, shredding | L1c, L3a (KeyService) | L1c store tests; L3a Keystore round trip |
| PRV-STO-07 one-action delete | L4b | L4b test (1) |
| PRV-STO-08 no crash upload, no content in logs | L1c, L3a | log grep test; crashReporter config test |
| PRV-EXP-01..07 gate, attestation, preview, burn-in, verifier, defaults, privacy.json | L1c, L1d, L4a | L4a gate and pipeline tests; L1d privacy fixture; L1a schema |
| PRV-EXP-08 local export only | L4a | no network imports in the export module |
| PRV-LOG-01/02 hash-chained audit log, no content | L1c | tamper + grep tests |
| PRV-ADM-01/02 policy that can only tighten | L1c | policy loader test |
| PRV-ADM-03 first-run notice | L3a | L3a e2e |
| PRV-DEV-01/03/05 synthetic only, regression suite, no network | L1a, L1c | guard, regression suite, socket stub |
| G6 first recording within 5 minutes | U1 | U1 measurement |

Moved out of the MVP in this revision: F20 `process_key` autocomplete and the multi-package handoff (P2), `export-skill` (P2). Retention (PRV-STO-05) and the audit chain (PRV-LOG-01) stay: both are MUSTs.

---

## 2. Parallelism

Default: run lanes one at a time in the order of §1. Where the owner wants speed, these pairs are safe to run at the same time:

| Pair | Why it is safe | Watch |
|---|---|---|
| L1a, then L1a2, alongside L0a/L0b | Spike code lives outside the pnpm workspace; L1a/L1a2 touch only `recorder/packages`, fixtures, root `package.json` and CI | Owner time: spike lanes need the owner at the keyboard |
| L1b with L1c | Disjoint packages | Both change `recorder/pnpm-lock.yaml`: merge one, rebase the other, re-run `pnpm install` and `pnpm test` |
| L2a with L2b | Disjoint native dirs; separate workflow files | Both may request protocol additions: route through one change request at a time |
| L4b with L5 | `packages/ui/src/review/editor` vs `packages/spec` | Lockfile, as above |

**Must not run in parallel:** anything with L1a or L1a2 except the spike lanes (they own the schema); L1d with L1b/L1c (consumes both); L3a, L3b, L4a and L4b with each other (all edit `apps/desktop` and `packages/ui`); L5 before L4a (needs real packages); L6 with anything.

---

## 3. Sequence and rough timing

```
G3 ─┬─ G0 ─┐
    │      L0a (3d + owner) ── L0b (4d + owner) ── VERDICT
    └─ L1a (2d) ── L1a2 (2d + reader runs) ── L1b (3d) ── L1c (3d) ── L1d (3d)
                                                                  G1 ─┐
                                              L2a (4d + owner) ── L2b (4d + owner)
                                              L3a (3d + owner) ── L3b (4d + owner) ── U1 (2d, owner)
                                              L4a (4d + owner) ── L4b (3d) ║ L5 (2d) ── G2 ── L6 (2d)
```

Estimates are for planning only; the acceptance checks decide when a lane is done.

---

## 4. Owner questions (only those that change what gets built)

1. **G3 Ultracode:** is the critique-and-revision workflow run that produced this revision what you meant by "ultracode"? If not, what is it? Until you answer, the plan is provisional and L0a/L1a are not dispatched.
2. **G1 Moore IT facts:** how do staff reach ProfSoft and Caseware (installed client, browser, RDP/RemoteApp, Citrix, or a browser gateway such as RD Web, AVD web or Citrix HTML5)? Does anyone run their whole desktop inside a remote session? Which Windows builds are in use (Windows 10 22H2 vs Windows 11 22H2+), and is Office installed on any Macs? This sets the weight of remote mode, the mandatory smokes in L2b, and the helper's target framework.
3. **G0:** Is an Apple Developer Program account (Developer ID, notarisation) available for the spike and for stable dev signing? Without it the macOS permission checks (P1/P2) cannot be trusted.
4. **U1 participants:** can you supply 5 non-technical participants (Warp admin or finance staff, at least 2 on Mac) for one 45-minute session each after L3b? Fewer makes U1's findings provisional.
5. **IP and repo:** the signed Moore terms vest works in MSTB, but the recorder is meant to be general. Keep `recorder/` in the Moore repo (as decided), or build it in a Warp-owned repo?
6. **Keyboard and values in v1:** accept that v1 captures no keyboard input at all (PRV-KEY-01's count bucket and PRV-KEY-02's shortcut names are unmet; shortcuts are only inferred), or fund an opt-in shortcut-names mode after EDR testing (W14) and Moore's sign-off? And should Moore be asked now to allow an opt-in **Excel formula-bar capture** (PRV-KEY-04b, detectors re-run), without which Claude cannot learn reconciliation formulas?

---

## Appendix: lane contract template

```
Lane: <id> <name>          Model: sonnet          Worktree: <path>   Branch: lane/<id>-<name>
BASE_SHA: <sha>            Previous lane diff: <one-paragraph summary + git diff --stat>
Read first: docs/superpowers/specs/2026-11-21-workflow-recorder-design.md §<…>,
            docs/recorder/package-spec.md §<…>, this plan §1 <lane>.
In scope (write): <paths> + the standing rights of plan §0.1 (lockfile, recorder/package.json
            scripts, manifests/tsconfig/entry of packages you create or edit, vitest workspace).
Everything else: read-only.
Acceptance (run all, paste output into docs/recorder/evidence/<lane>.md):
  <commands>
Done = acceptance green on the lane branch + evidence committed + Opus review clean.
Rules: Read/Edit/Write/Grep for files, never sed -i / heredoc / tee / inline scripts to write files;
no vi.mock, no skipped tests, no @ts-ignore; synthetic data only; media only under recorder/fixtures/;
no schema change outside L1a/L1a2 (file a request; the orchestrator applies approved additive
patches); no keyboard hook, clipboard read, field-value read, or network outside packages/spec.
Ask Fable (advisor) before asking the owner.
Risks to watch: <lane risks>
```
