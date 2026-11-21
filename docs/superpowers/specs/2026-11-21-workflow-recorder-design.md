# Handover: workflow recorder design

**Date:** 2026-11-21 · **Status:** design for build, pending the feasibility spike (lanes L0a/L0b) · **Jira:** WIAS, label `superbrain`
**Companion files:**
- Package contract (source of truth for every field, enum and file): `docs/recorder/package-spec.md`
- Implementation plan (lanes, acceptance checks): `docs/superpowers/plans/2026-11-21-workflow-recorder-plan.md`
- Research (evidence for every claim here): `docs/recorder/research/{prior-art,macos-tech,windows-tech,llm-output-format,privacy-compliance,ux-annotation,superbrain-integration}.md`

**How to read the evidence.** Unmarked facts come from the research reports, cited by section, spike check id (O1–D1, S1 for macOS; W1–W18 for Windows) or requirement id (PRV-*). **[DI]** marks a design inference that goes beyond the research; every [DI] item has a spike check (X1–X14, X2b) or an owner sign-off attached.

**How this was planned.** The owner asked for ultracode, a multi-agent planning workflow. The run had seven research lenses, three competing designs, two judges and a synthesis. Three adversarial critics (builder, platform, product) then reviewed the result, and every finding was checked against the documents and research before it was applied or rejected.

**Revision 2026-11-21 (critique pass).** Main changes: a format gate before the schema freezes (Claude reads hand-made packages before L1b); a reference-SOP schema and deterministic scorer; a names-to-hide list across every channel; fail-closed remote typing derived from frame changes; Windows masking hardened against shell surfaces and animations; URL checks on every browser window; elevated focus as a gap; a content-change frame ring; the export verifier moved before the write; `exportContext` for byte determinism; lanes may own their manifests and lockfile; L4 split; a usability gate U1.

---

## 1. Intent

Build a desktop app for Windows and macOS that lets a non-technical person do a task on their computer the way they normally do it, stop at any moment to point at something on screen and explain it, and end up with a reviewed, redacted package that a fresh Claude can read to understand the process step by step, and that Superbrain can turn into automation.

**Why it matters.** Superbrain learns and automates what people at a firm do. Its first client, Moore Stellenbosch (about 100 staff, IRBA-regulated, POPIA applies), runs on ProfSoft, Caseware, QuicklySign, AppSheet, Outlook and Excel. Moore's Phase 0 discovery asked for eight workflows "as it actually happens, including the workarounds", and five had not been walked through (superbrain-integration). The knowledge Superbrain needs lives in people's heads and hands. Today the only ways to get it are interviews or screen recordings, and neither captures *which control* was used, *why* a choice was made, or *where a value came from*.

**Why now.** In 2026 four vendors shipped "record to teach an agent": Claude Cowork Record a skill (Mac only, about 10 minutes, sent without review), OpenAI Record & Replay (macOS), Loom Record for agent (Mac app and Chrome), and Microsoft Skill Recorder (Electron, macOS and Windows 11, no control capture, no overlay, no image redaction, no review step) (prior-art). The category is proven. Windows Steps Recorder is deprecated. On Windows, UiPath Task Capture and Power Automate's recorder do capture the clicked element, but they feed their own RPA tools, are Windows-only, and do not ask why; Scribe and Tango produce polished guides but only blur in the browser and do not capture intent (prior-art §2, §4, §6, §7). Handover sits upstream of all of them: an open, reviewed package that records the why at the moment of action, on Mac and Windows.

---

## 2. Goals, non-goals, anti-goals

### 2.1 Goals
1. **G1 Rich, honest capture on both OSes.** Every click records the control that was clicked, or an explicit reason why not (remote screen, admin window, timeout…). Keyboard-only steps are still found.
2. **G2 Capture the why at the moment of action.** Explain (freeze, point, comment, tag) plus a few well-timed one-tap questions.
3. **G3 Local-first privacy that holds up under POPIA and IRBA.** Nothing leaves the machine until the user has reviewed every step, and one redaction covers pixels, text and transcript.
4. **G4 A package a fresh Claude can rebuild from.** Measured: step F1 ≥ 0.9 against a reference written before recording, on one Mac and one Windows process (acceptance 4).
5. **G5 A package Superbrain can map to automation** without remodelling: System keys, positions, boundaries, typed parameters, provenance.
6. **G6 Delight.** A first real recording within 5 minutes of install, and an illustrated Steps guide the user can hand to a colleague straight away.

### 2.2 Non-goals (v1)
- Replaying or automating the recorded process. Handover documents; Superbrain automates.
- Uploading to Superbrain or any cloud. v1 export is a local folder or zip (PRV-EXP-08).
- Merging several recordings into variants inside the app (Phase 3). The process-spec format already lets Claude read several packages of one `process_key` and cite each run (`additional_package_refs`, qualified step ids); the CLI and skill support for that is Phase 2.
- A browser extension or DOM capture (Phase 3).
- Afrikaans UI or transcription (Phase 2).
- Signed, notarised, auto-updating distribution (Phase 2). MVP builds are dev- or test-signed.
- Video or audio in the package.

### 2.3 Anti-goals (never)
- **Never a monitoring tool.** No passive, remote, scheduled or admin-started recording; no productivity metrics; no use for performance management (PRV-REC-01/02, sign-off S3).
- **Never a keylogger.** No keyboard hook on either OS in v1; no build contains a raw-keystroke logger (PRV-KEY-06).
- **Never read the clipboard** (PRV-SEC-04). Only the change counter.
- **Never send anything to a model before the user has reviewed it.** No cloud call in the desktop app.
- **Never present a guess as a fact.** OCR guesses are labelled; inferred shortcuts are marked `observed: false`; unknown decision conditions are written as `unknown`.
- **Never Moore-specific code.** Anything tenant-specific lives in a tenant profile (package-spec §9.3).

---

## 3. Constraints (owner decisions, fixed)

| Constraint | Consequence in this design |
|---|---|
| Code lives in `recorder/` in the Moore-Superbrain repo; PR into a new main branch | `recorder/` is its own pnpm workspace; a root `package.json` delegates `pnpm test` (§16.1). IP caveat in §17 and the owner questions. |
| Local-first; user reviews, edits, blurs and deletes before export; Claude only on the exported, reviewed package | Three physically separate layers (raw store, package, derived). No cloud call anywhere in the desktop app. Claude's questions come back only through an import loop (Phase 2). |
| Windows evidence = GitHub Actions Windows runner (build + tests) + a Windows 11 VM on the owner's Mac (live smoke) | The owner's Mac is an Apple M4, so the VM is **Windows 11 on Arm64**, and hosted CI is x64 without a person at the screen. Acceptance 3 is therefore a **provisional** go. A real x64 laptop with mixed-scale monitors is the gate before any Moore pilot (§16.6). |
| Jira project WIAS, label `superbrain` | The tracked task is WIAS-229. |
| Users are accountants and admin staff, not technical | Picture-led permission cards, a practice run, plain words ("Explain", "Steps", "Redact"), every action reachable from the HUD as well as a hotkey. |
| Tool must be general, not Moore-specific | Tenant profile for systems of record and boundary rules; detectors configurable; blocklist additions by policy. |
| Implementation by Sonnet in bounded lanes, one at a time, Opus reviews each | 15 lanes with fixture-based acceptance commands, plus owner gates and a usability gate (plan). |

---

## 4. Approaches considered

### 4.1 Three designs
Three design agents worked from the same research, each from a different angle. Two judges scored them out of 50.

| Design | Angle | Judge 1 | Judge 2 | Combined |
|---|---|---|---|---|
| **agent-output-first** | The package defines readiness rules; capture and UX exist to fill it | 43 | 38 | **81** |
| **platform-risk-first** | Build only what works in a regulated firm; every risky dependency has a run-time-detected fallback | 40.5 | 40 | 80.5 |
| **user-first** | Delight and low friction for accountants | 37.5 | 33 | 70.5 |

**What each traded off.**
- *agent-output-first* had the strongest product idea: one pure module of readiness rules that runs live (prompts), in review (checklist), at export (gate) and in CI (lint), so nothing Claude needs is ever silently empty. It also had `dataflow.json` and the only typed-value policy that met PRV-KEY-01. It was weak on platform engineering: a single physical virtual desktop for coordinates (ambiguous on macOS with mixed scales), live hover hit-tests against a frozen image, crypto code in both helpers, Windows scope masking asserted but not specified, and an oversized first lane.
- *platform-risk-first* had the best engineering: a reliability backbone (primary, fallback, run-time detection, desktop-free test for every risky dependency), a capability handshake that switches degraded modes at run time, per-display physical pixels, frames that stay in helper memory and are encrypted only by the core, and frozen-frame Explain with a snapshot taken at freeze. It read field values by default (against PRV-KEY-01), gave macOS and Windows different keyboard behaviour, and had the thinnest "why" layer.
- *user-first* had the best user touches: an illustrated Steps guide in every export, a split export gate (only privacy blocks), boundary rules from tenant configuration, toggle narration (no key-up without a hook), and inline base64 images for the packer. Its package contract was the least specified.

**Decision.** The judges disagreed (one picked agent-output-first, the other platform-risk-first). By combined score agent-output-first wins, **81 to 80.5: a near-tie**. This design builds on agent-output-first's product and package model and adopts platform-risk-first's reliability backbone wholesale (capability handshake, coordinate model, frame transport, frozen-frame Explain, edge strips, self-test, supervisor drills), plus user-first's Steps guide, split gate, tenant profile, toggle narration and inline packer. Every must-fix item from both judges is resolved (Appendix A at the end of this document).

### 4.2 Stack

| Option | For | Against | Call |
|---|---|---|---|
| **Electron + TypeScript + React + a native helper per OS** | Microsoft Skill Recorder proves the stack for this exact kind of tool on both OSes. Overlay options are documented (`type:'panel'`, `screen-saver` level, `visibleOnFullScreen`, `setIgnoreMouseEvents(…, {forward:true})`, `focusable:false`). One UI codebase. | ~150 MB install; Chromium churn. The hard parts (input, accessibility, capture) need native code anyway. | **Chosen, pending spike L0a/L0b.** Pin Electron 45.x (at least 43.2 for the click-through occlusion fix, PR #52365). |
| Tauri + native helpers | Smaller install | Two different web engines; less proven overlay on macOS; reported gaps in mouse-forwarding while click-through; still needs the same native helpers | **Fallback** only if O1–O3 or W1 fail under Electron while a bare native panel passes. The helpers and their protocol survive a shell switch unchanged. |
| Native Swift + native Windows UI | Best overlay per OS | Two UIs to build and test | Rejected. If only the overlay fails, the first fallback is a **helper-driven native overlay for Explain while keeping Electron**, before considering Tauri. |

**The native helper is not optional.** On macOS: `setContentProtection` does not hide a window from ScreenCaptureKit and Apple says no public API prevents capture, so the overlay can only be excluded inside our own capture code; and `uiohook-napi` creates an *active* event tap, and revoking Accessibility while an active tap runs has been reported to freeze all input (FB24619068). On Windows: `uiohook-napi` always installs a keyboard hook (what EDR treats as a keylogger), and a low-level hook that runs past 1 s is silently removed, so lookups cannot run in the hook callback. Hence: **Swift helper on macOS; C# or Rust helper on Windows, chosen by spike X7**; both speak one versioned JSON-lines protocol. If C# is chosen, the x64 build targets **.NET Framework 4.8** (`net48`, preinstalled since Windows 10 1903, so it runs on Windows 10 22H2 and on 4.8.1 machines); only an arm64 build may target `net481` (which brings native Arm64 and ships with Windows 11 22H2+), or arm64 uses Rust. Targeting `net481` on x64 would fail on Windows 10 and older Windows 11, where staff usually cannot install a framework (windows-tech §6.1).

**Fork Microsoft Skill Recorder? No: learn from it.** Its strengths (screen capture, frame dedupe, on-device Whisper, SKILL.md) are the cheap parts. Our hard parts (helpers, overlay, package, redaction across all channels, encrypted store, review gate) do not exist there. Spike X8 spends 2 hours reading its code and copies any useful module under its MIT licence with attribution.

---

## 5. Name and positioning

**Handover** (in full *Superbrain Handover*); the output is a **Handover package**. The name says what the output is for: handing your know-how to a colleague, to Claude, or to Superbrain. It puts the user in charge, which matters because staff seeing the tool as surveillance is a real risk. The alternative from the UX research, "Shadow" (from job shadowing), was rejected because "being shadowed" sounds like being watched. Neither name has had a trademark check (owner sign-off).

**Positioning: upstream of every built-in recorder.**

| | Claude Record a skill | MS Skill Recorder | Loom Record for agent | Scribe | Tango | UiPath Task Capture | Power Automate task mining | **Handover** |
|---|---|---|---|---|---|---|---|---|
| Windows desktop | No | Yes | Chrome only | Pro+ desktop app | Pro/Enterprise desktop | Yes (Windows only) | Yes (Windows only, no ARM) | **Yes, first-class, plus Mac** |
| Which control was clicked | No | No | Clicked-element screenshot | Partial button text on desktop | "Less precise" on desktop | Yes (RPA element data) | Action descriptions + focus box | **AX/UIA target with an evidence tier, or a reason why not** |
| Asks *why* at the moment of action | No | No | No | No | No | No (edit the PDD afterwards) | No (manual activity grouping) | **Explain + moment-of-action prompts + tags** |
| Review and redaction before anything leaves | No | Terminal text only | No | Smart Blur in browser only | Live Blur not on desktop | Not found | User deletes steps | **Mandatory; pixels, text, titles, URLs, a11y names, transcript in one pass, with a names-to-hide list** |
| Data lineage across apps | No | No | No | No | No | No | No | **`dataflow.json`** |
| Output | Locked in Cowork | SKILL.md | Prompt / Jira | Guide (HTML, PDF, Markdown) | Written guide | Word PDD, Studio XAML | Process map | **Open, versioned, hashed package + Steps guide** |
| Polish of the human guide | n/a | n/a | n/a | **Strong (AI titles)** | **Strong** | PDD template | n/a | Rule-template titles; Claude's `narrative.md` after export |

(Sources: prior-art §2, §4.1, §4.2, §6.1, §7.)

**Where Handover wins:** the why at the moment of action; local redaction across every channel before anything leaves; Mac and Windows with one package; an open, Claude-ready package with control grounding, dataflow and an audit manifest; the Superbrain mapping. **Where it loses:** guide polish (no model runs before export, so titles are templates) and no replay. To narrow the polish gap, Phase 2 regenerates `steps-guide.html` from Claude's `narrative.md` in the `.derived` folder. If Anthropic adds Windows and review to Record a skill, Handover still competes on the open package, control grounding, dataflow, the audit manifest, redaction across all channels and the Superbrain mapping.

---

## 6. Features

**MVP** = needed for lane acceptance 1–5 and the "banger" core. **P2** = Phase 2 (before or during the Moore pilot). **P3** = later.

| # | Feature | Phase | What it is |
|---|---|---|---|
| F1 | **Explain (freeze, point, explain)** | MVP | One hotkey or HUD tap freezes every display at that instant. The user works on a still picture, so nothing leaks into the live app. Tools: Snap, Box, Arrow, Highlighter, Pen, 1-2-3 callouts, Redact. |
| F2 | **Snap to the real control** | MVP | While frozen, hovering outlines the real control under the pointer with a label ("Date field · Signed on · AppSheet"). `[` and `]` walk up and down the control tree. Solid outline = real control; dashed = remote or opaque, so the card asks "Draw a box and tell me what it is". Snap hit-tests an accessibility snapshot taken at freeze, so outlines always match the picture. |
| F3 | **Comment card with three tags** | MVP | Text or voice. *Decision point* asks "What decides which way you go?"; *This varies* asks "What makes it change? What should we call it?" and turns a literal into `{{parameter}}`; *Sensitive* redacts everywhere. Behind "More": Check/rule, Problem/workaround, Hand-off, Don't automate this, I'm not sure why we do this. |
| F4 | **Moment-of-action prompts** | MVP (3 rules live), P2 (rest) | Local rules ask one specific question at the right moment with one-tap chips. MVP live: R2 decision on a dropdown/option/radio or Decision quick-mark, R3 "Where did this come from?" after a cross-app copy, R4 "What did you click?" in a remote window. Hard budget (§11). |
| F5 | **Readiness rules everywhere** | MVP | R1–R17 as pure predicates: live prompts, review checklist, export gate (privacy rules only), `handover lint` in CI. Exported as `readiness.json`. R16 checks that done-when is covered by a step; R17 asks "Show Claude the format?" when a value crosses systems without one. |
| F6 | **Data-flow tracing** | MVP (from user answers + clipboard counter), P2 (value fingerprints, off by default, sign-off) | Parameters and entities tracked across apps, including how the person matches records across systems with no shared key (`join_hint`). |
| F7 | **Live evidence dot** | MVP | HUD dot: green = control data; amber = text recognition or pixels only ("This app is a picture to me: say what you click"); grey = app not in scope. |
| F8 | **Honest gaps** | MVP | Everything not seen is written down with a reason: pause, out-of-scope app, excluded app, private window, admin window, UAC, lost hook, helper restart, lost permission. |
| F9 | **"That was a mistake"** | MVP | Hotkey or HUD "Oops" discards the last step. Answers Scribe's top complaint (noisy steps). |
| F10 | **Start sheet and wrap-up** | MVP | Required: process name, goal, **done-when** ("When it's done, what's true that wasn't before?"). Trigger and frequency chips. Scope: "Apps I choose". **Names to hide** ("Client or person names that may appear"). Wrap-up: what happens next, what can go wrong, was this a normal run, **"Which step makes it done?"** (step chips → `done_when_steps`), and **"Once / for each client / for each row / for each document"** (→ `process.repeat`). |
| F11 | **Practice run** | MVP | A 45-second sandbox ("Invoice approval") inside the app teaches the loop before any client data is on screen. |
| F12 | **Review editor** | MVP | Filmstrip, frame with overlays, details pane. Rename, merge, split, delete, insert an off-screen step, convert to decision/wait/checkpoint, drag narration segments. No reordering (the recorded order is data). Every edit is an undoable operation. |
| F13 | **One redaction across all channels** | MVP | Pixels, OCR text, control and a11y names, locators, window titles, URLs, typed-value metadata, comments and transcript. SA ID, tax, VAT, card, email, phone pre-blurred; **names-to-hide list** (start sheet + optional tenant dictionary, PRV-PII-04) matched case- and diacritic-insensitively in every channel; a11y sibling names withheld. Redactions burned in at export; the render is verified before it is written and the export is aborted on any hit. |
| F14 | **"What Claude will see" preview** | MVP | The exact export, side by side with the original; the export is written from the same render (hash checked). Per step, a **"Text Claude will see"** panel lists every exported string (including a11y names and locators), with a count of unredacted text. |
| F15 | **Steps guide** | MVP | `steps-guide.html` in every export: an illustrated guide the user can give a junior colleague. Replaces Windows Steps Recorder. The user's immediate reward. |
| F16 | **Chapters** | MVP (markers), P2 (resume another day) | No hard length cap. Chapter markers every 15 minutes or at long pauses; soft warning at 60 minutes (PRV-REC-09, policy can enforce a cap). Resuming a recording another day is P2. |
| F17 | **Off-screen steps** | MVP | "Phoned the client to confirm" becomes a `manual` step. |
| F18 | **Edge strips** | MVP | Thin red strips on every display while recording (PRV-REC-03), excluded from capture. |
| F19 | **CLI** | MVP (`validate`, `lint`, `render`, `spec`, `score`), P2 (`export-skill`, multi-package `spec`) | `handover render` also takes `--image-policy` for the ablations. |
| F20 | **Process family** | P2 (process_key autocomplete, multi-package handoff), P3 (merge variants in the app) | Recording another run of the same process reuses its `process_key`. The process-spec schema can already cite several packages. |
| F21 | **Teach-back** | MVP (questions in `process_spec.open_questions`), P2 (import in app → revision 2) | Claude's open questions come back to the user, who answers locally; the answers go through review and produce a new package revision with `supersedes_package_id`. |
| F22 | Pointer trail (vanishing pen while talking) | P2 | Needs a live click-through overlay. |
| F23 | Remaining prompt rules (dwell, email switch, loop, undo, save dialog) | P2 | |
| F24 | Managed policy UI, allowlist-only mode, two-person review, IT tooling to maintain the client-name dictionary | P2 | PRV-SCOPE-04, PRV-EXP-09. The dictionary file itself (PRV-PII-04) is read in the MVP (F13). |
| F28 | **Image policy** | MVP | `full_and_crop` / `crop_only` / `text_only` per export; a tenant can cap it. The default is chosen from the format-gate and acceptance-4 ablations (package-spec §3.4). |
| F25 | Signed, notarised distribution; NSIS per-machine and per-user; MDM profile; policy-controlled auto-update | P2 | Windows OV certificate on a cloud HSM unless Warp has a US/Canada/EU/UK entity (Azure Artifact Signing). |
| F26 | Opt-in shortcut-names mode | P2 (owner decision) | Only after EDR testing (W14) and owner/Moore sign-off. |
| F27 | Browser extension (`dom` grounding), Superbrain v2 upload, v3 MCP, OCEL 2.0/XES export, replay check, Afrikaans | P3 | |

---

## 7. User flows and screens

### 7.1 First run
1. Privacy notice (PRV-ADM-03, Moore supplies wording); acknowledgement logged.
2. **Permission cards**, driven by the helper's `perm.status`. Each card: what it is for, a picture of the exact system dialog, a live status check, relaunch handling, and a "What we never do" line. macOS: Screen Recording, Accessibility, Microphone (on first narration), **plus an Input Monitoring card that stays in the list until spike P1 proves a mouse-only listen tap does not need it**. The monthly macOS screen-recording re-prompt is explained up front. Windows: microphone only.
3. Practice run (F11).
Target: first real recording within 5 minutes.

### 7.2 Start sheet
Process name*, goal*, done-when*, trigger chips, frequency chips, your position, **scope: "Which apps does this involve?"** (pre-filled with open apps minus the blocklist; full display is an explicit choice), **"Client or person names that may appear"** (optional; kept encrypted on this machine, used only to hide those names everywhere, never exported), narration mode (Toggle, starting on or off / Type only; which start state is the default is decided by gate U1), the pre-recording checklist (close unrelated apps, Do Not Disturb, demo client file where possible; PRV-REC-07), and a 3-2-1 countdown that shows the Pause hotkey.

### 7.3 HUD (wireframe)

Compact, docked top-centre, draggable. Excluded from capture; never takes focus (spike X9).

```
 +-----------------------------------------------------------------------------------------+
 | (*) 04:12 | Step 9 | (o) green | [mic ||||  ] | [Explain ^E] [Oops] [|| Pause] [Stop]    |
 +-----------------------------------------------------------------------------------------+
   rec dot    steps    evidence     narration      freeze+       drop    pause      confirm
   + timer    so far   dot          toggle/level   annotate      last               first
```

Amber evidence dot in a remote window:

```
 +-----------------------------------------------------------------------------------------+
 | (*) 06:02 | Step 11 | (o) amber | [mic off] | [Explain] [Oops] [||] [Stop]                |
 |   This app is a picture to me (Remote Desktop): say what you click, or press Explain.   |
 +-----------------------------------------------------------------------------------------+
```

Paused (whole HUD amber):

```
 +-----------------------------------------------------------------------------------------+
 | ( || ) PAUSED, nothing is being recorded             [ Resume ]   [ Stop ]              |
 +-----------------------------------------------------------------------------------------+
```

With a prompt card (slides out under the HUD; never steals focus; auto-dismisses):

```
 +-----------------------------------------------------------------------------------------+
 | (*) 06:40 | Step 12 | (o) green | [mic |||  ] | [Explain] [Oops] [||] [Stop]             |
 +-----------------------------------------------------------------------------------------+
 | You copied something in QuicklySign and then changed "AFS signed date" in AppSheet.     |
 | Did it come from there?                                                                 |
 |  ( Yes, from step 4 "Completed" )  ( It depends... )  [ say it ]       Skip  (8s)       |
 +-----------------------------------------------------------------------------------------+
```

Health states: the HUD shows "Clicks not being captured, fixing…" (amber) when the hook watchdog fires, and "Screen access lost, recording paused" when a permission is revoked. A tray / menu-bar icon mirrors the state.

### 7.4 Explain overlay (wireframe)

Explain freezes every display. Each display gets an **opaque, full-screen panel window showing that display's frozen frame** (macOS `type:'panel'`, `screen-saver` level, `visibleOnFullScreen`; Windows `focusable:false` + `showInactive`, taking focus only for the comment card). The timeline is paused, so focus changes while explaining are ignored; on Done, the helper restores the previous foreground window.

**Alignment self-check.** The frozen image only lines up if each panel covers its display's physical pixels exactly, and Electron places windows in DIPs (wrong sizes after `WM_DPICHANGED` on mixed-DPI Windows; the macOS menu-bar clamp, Electron #42104). So after showing each panel the core asks the helper for its real physical rect (`window.rect`: `GetWindowRect` from the per-monitor-V2 helper; CGWindowList bounds × scale on macOS) and requires it to equal the display rect within 1 px; otherwise it re-applies `setBounds` once and, if it still differs, draws the frozen frame offset by the measured delta and records the failure in the self-test. **The helper owns the display map** (`d0…dn` from CGDirectDisplayID / HMONITOR); the core matches Electron `Display` objects to it by native origin and device name, never by DIP bounds.

```
+==========================================================================================+
| Explaining step 12. This is a still picture: your clicks here don't reach your apps.     |
|  [Snap] [Box] [Arrow] [Highlighter] [Pen] [1-2-3] [Redact]   [ ] walk tree   [Done Esc]  |
+==========================================================================================+
|   AppSheet - Lockdown register                                                           |
|   +--------------------------------------------------------------------+                 |
|   | Client     [ ########## redacted ########## ]                      |                 |
|   | Engagement [ Audit                          ]                      |                 |
|   | AFS signed date [ 2026-11-12 ]                                     |                 |
|   |                 .=============.  <- solid = real control           |                 |
|   |                 |   snapped   |     "Date field · AFS signed date  |                 |
|   |                 '============='      · AppSheet"   [ = up  ] = down |                |
|   |                        \ (1)                                       |                 |
|   |          +--------------------------------------------+            |                 |
|   |          | (1) Comment on "AFS signed date"           |            |                 |
|   |          | [ Must be the date the CLIENT signed,     ]|            |                 |
|   |          | [ not when we sent it.                    ]|            |                 |
|   |          | [mic] Hold this button to talk              |            |                 |
|   |          | Tags: [Decision point] [This varies*] [Sensitive] [More] |  |                 |
|   |          | This varies -> What should we call it?      |            |                 |
|   |          |   [ AFS signed date            ]            |            |                 |
|   |          |                       [Delete]   [Save]    |            |                 |
|   |          +--------------------------------------------+            |                 |
|   | [ Save ]                                                           |                 |
|   +--------------------------------------------------------------------+                 |
+------------------------------------------------------------------------------------------+
| Hover a field or button to outline it, click to comment. Dashed outline = remote screen: |
| draw a box and say what it is.                                     Esc = back to work    |
+------------------------------------------------------------------------------------------+
```

The comment card's mic button is held **with the mouse**; there is no hold-to-talk key (no keyboard hook, and global shortcuts fire on key-down only).

### 7.5 Stop and wrap-up
Stop asks for confirmation ("Finish this walkthrough? You can still review and fix everything"). Then the wrap-up (all optional): what happens next, what can go wrong, was this a normal run, **"Which step makes it done?"** (the done-when text with step chips, rule R16) and **"Do you do this once, or for each client / row / document?"** (one chip row, `process.repeat`; live loop detection stays P2). Then the readiness summary ("9 steps · 2 things worth a look"). Transcription finishes in the background. Unreviewed recordings show on the home screen as "Not reviewed yet".

### 7.6 Review editor (wireframe)

```
+=======================================================================================================+
| < Back   Log a signed AFS on the lockdown register        5 steps  1:15   Ready to hand over: 1 open  |
+=======================================================================================================+
| STEPS                     |  STEP 3 OF 5                                       | DETAILS                |
|---------------------------|                                                    |------------------------|
| [thumb] 1 Click View      |  +----------------------------------------------+  | Summary                |
|   document (QuicklySign)  |  |  [ Remote Desktop: ProfSoft ]                 |  | [Open the engagement   |
|   T3                      |  |                                              |  |  and check the type ]  |
| [thumb] 2 Copy the        |  |   Engagements   [ ###### redacted ###### ]   |  | Target                 |
|   Completed date  H1 T3   |  |   Type  [ Audit ]   <- dashed (pixels only)  |  |  Remote screen: you    |
| >[thumb] 3 Decision: check|  |          '- - - -'                          |  |  said "Engagement type |
|   engagement type  T0 !   |  |   ////// masked: not in scope //////        |  |  column". OCR saw      |
|   ~~ gap: Outlook (not    |  +----------------------------------------------+  |  "Engagement type".    |
|      recorded) 6 s ~~     |  [Snap][Box][Arrow][Hi][Pen][123][Redact][Redact everywhere] | Decision       |
|   ~~ paused 14 s ~~       |                                                    |  If Audit/IR/Comp ->   |
| [thumb] 4 Enter           |  Narration 00:24-00:30  (confidence 0.88)          |  continue (seen)       |
|   {{afs_signed_date}} T3  |  "We only put audits, independent reviews and      |  Else -> stop (said)   |
| [thumb] 5 Click Save  T3  |   compilations on the register..."  [Move to step] |  Tags [Decision] [More]|
|                           |                                                    |  Data reads            |
| [+ Add a step I did off   |  [< Prev] [Merge with next] [Split] [Delete] [Next >] |  {{engagement_type}}  |
|   screen]                 |                                                    |  ! Scope unverified:   |
| Filters (All)(Flagged)    |                                                    |   [ I checked this ]   |
|  (Decisions)(Sensitive)   |                                                    |                        |
+---------------------------+----------------------------------------------------+------------------------+
| READY TO HAND OVER                                                                                     |
| PRIVACY (must clear)   ok detections resolved (9 redactions)   ! step 3 scope unverified  [Acknowledge] |
| CONTEXT (worth fixing) ! step 5: no "why"  [Add] [Skip on purpose]    ok goal  ok done-when  ok wrap-up |
|                               [ Privacy sweep ]   [ What Claude will see ]   [ Export... ] (disabled)  |
+=======================================================================================================+
```

### 7.7 Export and hand-off
Gate (§12.3), preview, attestation, pre-write verifier, write to a user-chosen folder (warning if cloud-synced; refused for the raw store), read-back hash check, audit-log entry, then "Delete the original recording?". Hand-off in v1 is by a person: give the folder to a colleague, open a Claude Code session in the folder that contains it ("Follow `<pkg>.handover/CLAUDE_HANDOFF.md`"), or run `handover spec`.

---

## 8. Architecture

### 8.1 Processes

```
┌──────────────────────────── Electron main (thin supervisor) ─────────────────────────────┐
│ WindowManager: HUD (panel, non-focusable) · edge strips ×4 per display · Explain overlay  │
│   ×1 per display (opaque frozen frame) · Review/Onboarding/Start window · hidden audio    │
│ HelperSupervisor: spawn, hello/capabilities, heartbeat 1 s, per-call deadlines,           │
│   restart with backoff → gap events                                                       │
│ IPC router: typed channels, zod-validated; renderers have no Node; no start-record        │
│   channel outside the UI handler (PRV-REC-02)                                             │
└───────┬───────────────────────────────┬───────────────────────────────────────────────────┘
        │ MessagePort                   │ stdio JSON-lines (control, versioned)
┌───────▼──────────────────────┐   ┌────▼─────────────────────────────────────────────────┐
│ core (utilityProcess)        │◄══╡ native helper (per OS, out of process)                │
│ session state machine        │bin│ macOS: Swift   · Windows: C# net48 or Rust (X7)        │
│ encrypted store (AEAD)       │   │ mouse-only input · focus/value/window notifications  │
│ step builder · prompt engine │   │ a11y hit-test + hover cache + freeze snapshot         │
│ readiness rules · dataflow   │   │ capture + in-memory ring buffer + scope masking        │
│ redaction engine · buildPkg  │   │ OCR (Vision / Windows.Media.Ocr) · remote/elevated     │
└───────┬──────────────────────┘   │ detection · permission probe · clipboard COUNTER only │
        │                          └──────────────────────────────────────────────────────┘
        ├─► privacy-worker (utilityProcess): detectors, tesseract.js fallback OCR, export verifier
        ├─► media-worker (utilityProcess): resize, crop, blur burn-in, annotated render (sharp)
        └─► transcriber (bundled whisper.cpp binary, low priority)
```

- **The helper is the only code that touches the desktop.** A crash, a hung AX/UIA target or a dead hook cannot take down the UI, it never needs rebuilding for an Electron ABI change, and the same protocol would serve a Tauri shell.
- **No network** in the helper, core, workers or transcriber. A stub active during the `pnpm test` (vitest) run **denies TCP, UDP and DNS** and allows only local IPC: `AF_UNIX` paths and Windows pipes named `\\.\pipe\handover-<random>`, which the frame channel uses (PRV-DEV-05). A test proves both halves: an IPC pipe opens while a localhost TCP connect fails. The whisper model ships in the installer, so first run needs no download (how it is fetched at build time: §10).
- **Clock:** the helper stamps every event with a monotonic clock; the core aligns audio with a sync ping at Start and every resume.

### 8.2 Helper protocol (`@handover/helper-protocol`)
- Newline-delimited JSON over stdio: `{v:1, id, type, ts_mono_ns, payload}`. Zod schemas are the single source of truth; Swift and C#/Rust types are generated or hand-written against a shared conformance suite.
- **Handshake:** `hello{protocol_version}` → `capabilities{input_mouse, a11y_hit, a11y_snapshot, capture_self_exclude, capture_backend, scope_masking, ocr, perm, keyboard:"none", session}`. **Capabilities drive degraded modes at run time** (§15). `manifest.capture.capabilities` stores a projection: every key except `perm` (permission states are not package data); `session` (console / rdp / ica) goes to `manifest.capture.session`.
- **Requests:** `perm.status`, `capture.start{session_id, scope, displays, fps, channel_name, channel_token}`, `capture.stop`, `hittest.hover{on|off}`, `freeze{}` → per-display frame ids + `a11y.snapshot`, `restore_foreground{}`, `ocr.region{frame_id, rect_dpx}`, `windows.snapshot{}`, **`ui.regions{interactive_rects_dpx, passthrough_rects_dpx}`** (sent whenever the HUD, a prompt card, the comment card or the tray menu moves, shows or hides; §9.5), **`window.rect{window_handle}`** (the physical rect of one of our overlay windows, for the overlay self-check, §7.4).
- **Events:** `event.pointer`, `event.focus`, `event.value_commit` (field identity only, never a value), `event.window_change`, `event.title_change`, `event.screen_change{rects_dpx}`, `event.clipboard_change` (counter + source app only), **`event.remote_input_suspected{window, rects_dpx, since_click_event_id}`** (§9.6), **`event.ui_interaction{event_id}`** (a pointer-down inside one of our interactive regions; never a step), `target.resolved{event_id, target, latency_ms}`, `frame.ready{frame_id, t, display_id}`, `gap.start/end{reason}`, `health{hook, trust, capture}`, `displays{map}` (the helper owns the display map; §7.4), `error`.
- The supervisor enforces a deadline on every call, heartbeats every 1 s, restarts the helper after 3 missed beats and writes `gap{reason:"helper_restart"}`.

### 8.3 Frame transport (one design on both OSes)
- The **pre-click ring buffer lives only in helper memory, only between Start and Stop** (PRV-REC-01: no pre-roll).
  - **Capture on content change, not on a fixed clock.** The helper asks for frames only when the screen changes (ScreenCaptureKit `minimumFrameInterval` with idle frames skipped; WGC `FrameArrived` with dirty regions), throttled to 10–15 fps while the pointer is moving or has acted in the last 2 s, and to 1–2 fps otherwise. A list or menu that opened 150 ms before a click is therefore in the ring (C2's timing bar).
  - **Hover snapshot.** When the cursor rests for ~300 ms, the helper keeps that frame in the ring as well (alongside the hover cache of the element), so the state just before a click is always available.
  - **Copied, byte-sized ring.** Frames are copied out of the pooled SCK IOSurfaces / WGC D3D textures at once (holding pooled surfaces stalls the stream), stored per display as a full frame downscaled to the export profile plus a native-resolution crop band around the pointer, and the ring is bounded by bytes (default 96 MB across displays), not by seconds. X10 measures a 5K + 4K two-display setup.
- Selected frames (before, after, freeze) leave the helper over a **binary channel**: a Unix domain socket (macOS) or named pipe (Windows) whose random name and one-time token the core passes in `capture.start`. Length-prefixed lossless image + JSON header `{frame_id, display_id, t_mono, source_rect_dpx, masked_regions_dpx}`.
- **The core encrypts before the first byte touches disk** (PRV-STO-02). The helper holds no keys and writes no files. The protocol has no frame path.
- **Windows capture backend:** Windows Graphics Capture inside the helper, DXGI Desktop Duplication as the in-helper fallback; our windows are excluded with `WDA_EXCLUDEFROMCAPTURE` (`setContentProtection(true)`). **Fallback if neither works in the helper (spike X13):** Electron `desktopCapturer` in a hidden renderer whose ring buffer is memory-only and which hands selected frames to the core over a MessagePort; the helper then supplies window snapshots and the core applies the mask. `manifest.capture.capabilities.capture_backend` records which path ran.

### 8.4 Local storage

```
<appData>/Handover/                      (~/Library/Application Support/Handover, %LOCALAPPDATA%\Handover)
  sessions/<ulid>/
    meta.json            non-content: state, created, schema, chapter list, policy hash
    events.log.enc       append-only AEAD chunks, rolled every 2 s (normalised helper + core events)
    edits.log.enc        review operations: undo/redo and deterministic replay
    frames/<id>.png.enc  audio/<n>.opus.enc  transcript.enc  ocr/<id>.json.enc  detections.enc
  audit.log.jsonl        hash-chained, no content (PRV-LOG-01/02)
  policy/                cached managed policy + tenant profile
```
- One random 256-bit key per recording, wrapped by Electron `safeStorage` (Keychain / DPAPI). `safeStorage` exists only in Electron main, so a **KeyService in main** wraps and unwraps keys and hands raw keys to the core utilityProcess over a MessagePort; the core receives a `Keystore` interface (real = the MessagePort client, tests = in-memory). No plaintext fallback: if the keystore is unavailable, recording is refused. KeyService is owned by L3a; the `Keystore` interface and in-memory version by L1c.
- **Signing identity and the Keychain (P2 migration).** On macOS the Keychain item is bound to the code signature. Before the app moves from the Apple Development identity (MVP) to Developer ID (P2), a migration release re-wraps every per-recording key under the new identity; switching without it would make existing recordings unreadable (an accidental crypto-shred). L3a's smoke rebuilds with the same identity and confirms an old recording still opens.
- Deleting a step deletes its blobs; deleting a recording destroys its key first (crypto-shred). Raw recordings auto-delete after 30 days, "keep" up to 90 (PRV-STO-05, sign-off S12).
- Store paths inside OneDrive, iCloud Drive, Dropbox, Google Drive or synced Desktop/Documents are refused (PRV-STO-03).
- Crash safety: the store recovers by replaying the logs; a torn last chunk is discarded and written as a `capture_lost` gap.
- Windows caveat (PRV-STO-04): other apps running as the same user can unwrap DPAPI keys; Moore relies on BitLocker/FileVault for disk protection.

### 8.5 Export is a pure function
`buildPackage(rawSession, editLog, policy, tenantProfile, profile, exportContext) → files`, where `exportContext = {package_id, exported_at, timezone, reviewer_pseudonym, tool_version}` is generated once by ExportService (the ULID, the clock and the pseudonym live there) and passed in; tests inject fixed values. **Determinism means: the same inputs, including `exportContext`, give the same bytes.** Stable ids, sorted keys, byte-deterministic JSON, Markdown and HTML; images checked by dimensions and perceptual hash. The whole pipeline is golden-testable without an OS. Review state is a projection of `events.log` + `edits.log`. The raw-session fixture format that `handover render` consumes is written by L1b in `docs/recorder/raw-session.md` (helper transcript, prompt answers, Explain annotations, edit log, names list stub, policy, tenant profile, exportContext).

### 8.6 Monorepo layout

```
recorder/                              own pnpm workspace root
├── package.json, pnpm-workspace.yaml, pnpm-lock.yaml, tsconfig.base.json, vitest.workspace.ts
├── packages/
│   ├── schema/          package + process-spec + reference-SOP JSON Schemas, generated TS types, Ajv
│   │                    validator, semantic validator (V1–V17, injected detectors; minimal SA-ID/card
│   │                    Luhn in detectors-min.ts), migrate(), CHANGELOG.md (CI gate)
│   ├── geometry/        coordinate spaces and transforms (property-based tests)
│   ├── helper-protocol/ zod message schemas, client, HelperSupervisor (deadlines, heartbeat,
│   │                    restart; Electron-free so it is testable), HelperSimulator (replays transcripts),
│   │                    conformance suite (runs against the simulator AND the real helpers)
│   ├── core/            session state machine, step builder, narration alignment, timeline, edit-op log
│   │                    (src/edits, §12.1), rules (R1–R17), prompt engine, dataflow builder, snap,
│   │                    buildPackage, PROCESS.md / CLAUDE_HANDOFF.md / steps-guide.html generators
│   ├── privacy/         detectors (SA ID Luhn, SARS tax mod-10, VAT, card, email, phone, bank, reg no,
│   │                    names, special-PI), names-to-hide matcher, redaction engine across channels
│   │                    (one serialiser for every screen-text field), pre-write verifier,
│   │                    policy loader with floors (PRV-ADM-02), synthetic PII generator
│   ├── media/           profile resize, crop, blur burn-in, annotated render, metadata strip
│   ├── store/           AEAD chunk store, keystore interface (real + in-memory), audit-log chain,
│   │                    path classifier, retention
│   ├── narration/       transcriber adapter only (whisper.cpp sidecar); alignment lives in core
│   ├── spec/            process-spec validator (PS1–PS4) and deterministic scorer (L1a2); Messages
│   │                    packer (inline base64, chunking), teach-back extraction (L5); skill export (P2)
│   ├── cli/             `handover validate | lint | render | spec | score` (`export-skill` P2)
│   └── ui/              React components: HUD, edge strip, Explain canvas, comment card, review editor,
│                        export gate (no Electron imports)
├── apps/desktop/        Electron main, preload, renderer entry points, supervisor, window manager,
│                        electron-builder config
├── native/
│   ├── macos/           Swift package HandoverHelper (+ XCTest) and FixtureApp (SwiftUI test target)
│   └── windows/         HandoverHelper (C# or Rust, + tests) and TestTargetApp (WinForms + WPF)
├── config/tenants/      default.json, moore.example.json (package-spec §9.3)
├── fixtures/            the ONLY place media or packages may live: synthetic transcripts, frames,
│   │                    golden packages, privacy fixture, OCR language data, evidence/<lane>/
│   ├── test-process-app/  synthetic "Lockdown capture" web app (signed-pack page, register form)
│   ├── format-gate/       hand-authored synthetic packages + reference SOPs + Claude outputs (L1a2)
│   └── acceptance/<os>/   reference_sop.json (written in L1a2, before recording) + recorded packages
├── vendor/whisper/      UNTRACKED: whisper.cpp binaries and base.en fetched at build time, sha256-pinned
├── skills/understand-process/SKILL.md     Claude Code skill for consuming packages
├── e2e/                 Playwright `_electron` tests driven by HelperSimulator (pnpm test:e2e)
└── tools/ci/            media/package guard (PRV-DEV-01), network stub, signature check, release grep (PRV-KEY-06)
```

**Module rule:** `schema` ← `geometry` ← `core`/`privacy`/`media`/`store` ← `spec`/`cli` ← `apps/desktop`. Nothing under `packages/` imports Electron. Only `narration`, `store`, `helper-protocol` (the token frame channel over a local socket or pipe) and `cli` touch Node OS APIs. `spec` is the only package that may open a **network** socket, and it is never bundled into the desktop app; local IPC (`AF_UNIX`, `\\.\pipe\handover-*`) is not network. Test seams are **fakes** at protocol boundaries (HelperSimulator, in-memory store and keystore, fake clock); **no `vi.mock`** (the safety guard flags it) and no skipped tests.

---

## 9. Capture per OS

### 9.1 What makes a step
Raw events are aggregated by the core step builder:
- **Pointer down:** click, double click, right click, drag (mouse-only hook).
- **Focus change**, and **value commit** at focus-out: the helper knows *that* a field was edited and *which* field, from accessibility change notifications, **without reading the value** (PRV-KEY-01). The mechanism is fixed, and the spike (X4, W11, W17) measures it rather than choosing it:
  - **Windows:** `SetWinEventHook` out of context for `EVENT_OBJECT_FOCUS` and `EVENT_OBJECT_VALUECHANGE` (these carry the element, not the value); the element identity is resolved through UIA with a cache request that excludes `ValuePattern`. **No UIA subtree property-changed subscriptions** (slow, and they deliver values).
  - **macOS:** a per-PID `AXObserver` for `kAXFocusedUIElementChangedNotification` and `kAXValueChangedNotification`; `kAXValueAttribute` is never fetched.
  - A commit is "value-changed seen since focus-in, then focus-out or Enter-inferred screen change". The helper never reads or serialises a value, even if a notification carries one. Excel in-cell editing and Chromium (accessibility tree active only once requested) are the hard cases, so X4 and W17 include them.
- **Foreground window or app change; window title change.**
- **Screen change without a pointer event:** a low-resolution frame diff outside the cursor region, held for a quiet period (catches Enter, Tab, Ctrl+S). **Before diffing, the helper masks the text caret** (`GetGUIThreadInfo().rcCaret` on Windows; `AXBoundsForRange` of the selected range on macOS), the cursor, Excel's copy border (the selection rect after a clipboard change in Excel), and regions that change on a fixed cadence (spinners, clocks: any region that changed in ≥ 4 of the last 5 diffs with no pointer event). Spike X11 sets the threshold (≤ 1 false step per minute of passive reading, of an idle focused text field, and of Excel after a copy).
- **Clipboard change counter** (`NSPasteboard.changeCount`, `GetClipboardSequenceNumber`): a `copy` step with the source app; content never read (X3). A selection gesture (drag or double-click) followed by a clipboard change in the same app within 10 s becomes **one** copy step whose target is the selection's element (package-spec §5.2.5).
- **Explicit marks:** Explain, Decision quick-mark, That was a mistake.

**Inferred shortcuts.** A shortcut is never observed. It can be inferred and recorded as `key_inference{keys, observed:false, inferred_from[]}`: Excel's title going from `Book1*` to `Book1` infers Ctrl+S; a clipboard change infers Ctrl+C. The review editor offers chips ("Pressed Enter / Tab / Ctrl+S?") on commit-like screen changes.

### 9.2 Frames
- **Before:** the newest ring-buffer frame at least 50 ms before pointer-down, so a menu that closes on click is still visible (C2).
- **After:** when the screen settles, or 500 ms after the action; exported only where the result matters.
- **Self-test at every Start:** the HUD shows a marker pattern; the core grabs a frame and checks it is absent. If present (likely inside RDP or a VM without GPU acceleration), the core switches to masking the HUD, edge-strip and overlay rectangles in every frame and records `self_test.fallback: mask_recorder_windows`.

### 9.3 Capture scope and masking
**Default scope is "Apps I choose"** (PRV-REC-08, sign-off S11). Full display is an explicit choice on the start sheet. The default blocklist is always enforced (PRV-SCOPE-02): password managers, messaging, meeting and call windows, banking, personal webmail, private browser windows, system privacy panes, HR/payroll apps the tenant names.

**macOS:** ScreenCaptureKit with an `SCContentFilter` that **includes the selected apps' windows** and therefore excludes our own windows (settles C1). In display mode, the filter excludes our app and blocklisted apps. **Out-of-process UI of an in-scope app:** sandboxed apps (Office for Mac among them) show their open/save panels from a separate process (`com.apple.appkit.xpc.openAndSavePanelService`), and the menu bar is drawn by the system, so an app-include filter can leave Excel's Save As black or missing. Spike X2b records what SCK includes. The design answer: an allowlist of system view-service bundle ids whose windows are included **only while an in-scope app is frontmost and the panel is attached to it**, plus menu-bar windows clipped to the frontmost in-scope app's menu extent; anything the filter still cannot include produces `gap{reason:"system_dialog_not_captured"}`, never a silent hole.

**Windows (helper masking, specified because PRV-SCOPE-01 is a MUST) [DI, spike X2]:**
1. **Allowed region is built only from positively identified in-scope windows.** Anything not positively identified as an in-scope desktop window is out of scope. `EnumWindows` lists only desktop-app top-level windows (not CoreWindow/immersive surfaces), so the helper also enumerates shell and immersive surfaces explicitly: windows of class `Windows.UI.Core.CoreWindow`, `Shell_TrayWnd`, `Shell_SecondaryTrayWnd`, `NotifyIconOverflowWindow`, `XamlExplorerHostIslandWindow`, and any window owned by `ShellExperienceHost.exe`, `StartMenuExperienceHost.exe`, `SearchHost.exe` or the toast host (found with `FindWindowEx` and `DwmGetWindowAttribute`). Their bounds are **subtracted** from the allowed region, so an Outlook toast over the in-scope window is masked (`masked[].reason: shell_surface`).
2. Snapshot: `EnumWindows` in z-order, keeping windows that are visible, not cloaked (`DWMWA_CLOAKED`), not minimised and non-empty. Bounds = `DWMWA_EXTENDED_FRAME_BOUNDS` in physical pixels (per-monitor DPI aware V2), clipped to the monitor, converted to `_dpx`.
3. Classify each window by its **root owner** (`GetAncestor(GA_ROOTOWNER)`) and owning process image, so popups, menus (`#32768`) and tooltips inherit their owner's scope. Our own windows are excluded through `WDA_EXCLUDEFROMCAPTURE`. Shell windows are out of scope unless display mode.
4. Walk z-order top to bottom keeping a covered region; the allowed region is the union of the *visible* parts of in-scope windows minus every shell surface from step 1. Mask = monitor minus allowed region, filled with a neutral colour before the frame leaves the helper. `masked_regions_dpx` go in the frame header.
5. **Layout-change quiet period (replaces snapshot adjacency).** A frame's pixels are composed by DWM at a time the helper does not control (WGC frame pools, a stale DXGI frame), and animations draw windows away from their frame bounds. So the helper keeps a timestamped history of layout events from an out-of-context `SetWinEventHook`: `EVENT_SYSTEM_MINIMIZESTART..END`, `EVENT_SYSTEM_MOVESIZESTART..END`, and `EVENT_OBJECT_LOCATIONCHANGE`/`REORDER`/`SHOW`/`HIDE`/`CLOAKED`/`UNCLOAKED` on top-level windows. A frame is **dropped** (not exported, not used as a before frame) when its composition time (WGC `SystemRelativeTime`, DXGI `LastPresentTime`) falls inside a minimise/restore/move-size interval or within 250 ms of any other layout event that touches its monitor; the newest earlier quiet frame is used instead. The mask is computed from the snapshot that is current at that composition time.
6. **Fail closed:** if enumeration fails, a window's process cannot be resolved, a DWM call fails, or no quiet frame exists for an action, the helper blanks the whole frame and emits `gap{reason:"capture_masking_failed"}`.
7. Clicks in out-of-scope apps produce `gap{reason:"out_of_scope_app"}` and no frame; the HUD offers "Excel isn't being recorded. Add it?".
8. **Tests.** (a) Deterministic, everywhere: synthetic window lists and synthetic frames through the real mask code (overlap, owned popups, tooltips, shell surfaces, negative origins, mixed DPI). (b) Static pixel diff against `TestTargetApp` (two overlapping fixture windows, one in scope; owned popup menu and tooltip): every out-of-scope pixel equals the fill colour exactly; in-scope regions have non-zero variance. (c) **Dynamic** (VM and the x64 laptop, animations on): a toast raised over the in-scope window, minimise and restore of an out-of-scope window over it, a live drag across it, Win+Tab, and Start opened over it. Pass bar: **zero out-of-scope pixels across 1,000 consecutive exported or ring frames**.
9. **Per-window composite.** Per-window WGC capture (`CreateForWindow`) of each in-scope window and its owned popups, composited onto a blank canvas in z-order, cannot capture foreign pixels by construction (`scope_masking: helper_composite`). Spike X2 measures both it and the z-order mask against the dynamic bar, C2 timing and X10 cost. **If both pass, the composite is primary** (it fails closed by construction); the z-order mask becomes the fallback. If only one passes, it is primary. **If neither passes:** display mode with blocklist masking only, which needs an owner decision because it weakens the default.

**URL blocklist (PRV-SCOPE-03).** Scope is per app, so one in-scope browser can have other windows (a personal webmail window on the second display, a private window behind the in-scope one). Therefore:
- The check runs on **every visible top-level browser window that intersects a captured display**, not only the focused one, at window show and on every title-change event.
- The URL comes from the **document element**, never from the omnibox: `AXURL` of the `AXWebArea` on macOS (Safari shows only the domain in its address field by default, so the field cannot give origin + path); the Chromium/Edge/Firefox document element's URL through UIA on Windows. The omnibox is never read, and in particular never while it has focus (typing there would be a typed value). The URL is reduced to origin + path in memory (§13).
- A blocklisted host or a private/incognito window is masked like a blocklisted app within 200 ms. **A browser window whose URL cannot be confirmed is masked** (`unconfirmed_browser_window`), fail closed. (A remote-client window is different: its frame is kept but the step is `scope_verified: false` and must be acknowledged, PRV-SCOPE-06, rule R15.)
- X12 tests: a blocklisted site in an unfocused second Chrome window on another display; a private window behind the in-scope window; Safari with the default domain-only address field; typing in the omnibox, with the bar that no typed character appears in any helper output.

**Auto-pause:** lock, sleep, fast user switching, screensaver (PRV-REC-05; gaps `lock_paused`, `sleep_paused`, `user_switch_paused`, `screensaver_paused`); idle 5 minutes (PRV-REC-06, `idle_paused`). Resume is always manual.

### 9.4 Keyboard: the same on both OSes
- **No keyboard hook on either OS in v1.** On Windows a keyboard hook is what EDR treats as a keylogger; on macOS a keyboard tap may add the Input Monitoring prompt. Same behaviour on both OSes means packages do not differ by OS.
- Keyboard-only work becomes `type` steps (`observed_via: value_commit`), `screen_change` steps, and inferred shortcuts (§9.1). Pass bar for the spike (W17 Windows, X4 macOS), on three flows: (1) tab through a 4-field form, type values, press Enter, then Ctrl+S in Notepad/TextEdit; (2) enter 5 Excel cells with Enter and Tab, then Ctrl+S; (3) fill a 4-field Chrome web form and submit with Enter. Each yields **one step per field commit or screen change (±1 per flow), each with a before frame and the field identity**, and the typed strings pass the PRV-KEY-01 absence check below.
- **PRV-KEY-01 absence check (what "no value" means).** The typed string, and every substring of 4 or more characters, must be absent from: the helper's JSON-lines events, the decrypted `events.log`, the step model, the app logs, the audit log, and the exported package (all text files, plus OCR of every exported image). **Out of scope for the search:** raw-store frames and the raw OCR cache, which by design show what was on screen until export (privacy-compliance PRV-KEY-01). A second assertion: OCR text reaches steps and annotations only as detector classes or as the OCR label nearest a remote click (`ocr_near`, after redaction), never as bulk text.
- **Requirements this leaves unmet (owner and Moore sign-off):** PRV-KEY-01's character-count bucket (no keystrokes to count; `length_bucket: "unknown"`) and PRV-KEY-02's shortcuts-by-name (only inferred shortcuts). Option for Phase 2: an opt-in shortcut-names mode that classifies keys in-process and discards printable characters immediately, gated on EDR testing (W14) and P1.

### 9.5 Control resolution
**macOS (Swift):**
- A **listen-only** `CGEventTap` for mouse events only, on its own thread; it never consumes events. Accessibility trust is polled every 1–2 s and the tap is torn down when trust is lost (H1). The tap exists only while recording.
- AX hit-test against the PID of the topmost window under the point **after skipping only our click-through windows** (edge strips); on a background queue with a ~250 ms timeout; a hover cache of the element under a resting cursor; `AXManualAccessibility` set for Electron targets; `AXSecureTextField` and `IsSecureEventInputEnabled()` mean nothing is read (PRV-SEC-01/02).
- **Menu bar:** a point inside the menu-bar rect is hit-tested against the frontmost app's `AXMenuBar`; an open menu is attributed to its owning PID (the menu window belongs to the app or the system UI, not to the window under it). A1 includes menu-bar items.
- Apple Vision for OCR.

**Windows (C# `net48` for x64 / `net481` or Rust for arm64, or Rust throughout; X7):**
- Per-monitor DPI aware V2; mouse-only `WH_MOUSE_LL` (or raw input, W5a compares) whose callback **only enqueues**.
- UIA `ElementFromPoint` with one batched cache request on a worker thread, transaction timeout ~1.5 s; hover cache.
- **Watchdog, on mouse-only evidence.** The helper also registers for raw input (`RegisterRawInputDevices` for the mouse with `RIDEV_INPUTSINK`) and compares raw button-down events with hook callbacks: raw button events with no matching hook event for 2 s mean the hook was silently removed, so it is reinstalled, `hook_lost` is logged and the HUD turns amber (W5b). The watchdog is **suppressed** while the foreground window's integrity level is above ours or the input desktop is not `Default`. It never uses `GetLastInputInfo` (keyboard input advances it) or cursor movement (it moves over elevated windows while the hook is legitimately silent), and never sends synthetic input (`SendInput` moves the real cursor, is blocked by UIPI, and is behaviour EDR watches).
- **Elevated foreground = a gap.** A medium-integrity low-level hook receives nothing while an elevated window has focus (windows-tech §5.2). So focus moving to an elevated window starts `gap{reason:"elevated_window"}` (with `app_hint`) and focus returning ends it; frame capture continues and screen changes in that interval are not turned into steps; the HUD shows a notice. The UAC secure desktop gives a `secure_desktop` gap (W9/W10). **No UIAccess.**
- `IsPassword` / `ES_PASSWORD` fields: nothing read; a single "Entered a password (not recorded)" step; field blurred (PRV-SEC-02).
- `Windows.Media.Ocr` if it works unpackaged (W12), else tesseract.js in the privacy worker.

**Both:** each target records role, name, automation id or AX identifier (only when non-empty and unique among siblings), class, framework, bounds, ancestry, a pruned subtree, app, window, and for browsers the URL. Grid cells record address and column header only (PRV-KEY-05). Weak elements (opaque, nameless, bounds over 60% of the window) are `accessibility_weak` (T2). Target p95 click-to-resolved under 150 ms (A1, W6).

**Clicks on our own UI are never steps.** The hook sees every click, including those meant for the HUD, a prompt chip or the tray menu. The core keeps the helper informed with `ui.regions{interactive_rects_dpx, passthrough_rects_dpx}` whenever any of our surfaces moves, shows or hides. A pointer-down inside an interactive rect is reported as `event.ui_interaction` and dropped by the step builder; only pass-through rects (edge strips, HUD margins) are skipped during hit-testing, so the click reaches and resolves to the app beneath. A conformance test asserts that clicks on HUD chips produce no steps.

### 9.6 Remote desktop and Citrix: a first-class mode
ProfSoft's access mode at Moore is unknown; Caseware might also be remote. Inside a remote client the local machine sees only pixels. Two topologies matter.

**Topology A: the recorder runs locally, the app runs in a remote window.**
- **Native clients:** the helper detects `mstsc.exe`, `msrdc.exe`, Citrix `wfica32.exe`/`CDViewer.exe`, Windows App, Citrix Viewer and Parallels (process names confirmed in W8).
- **Remote in a browser:** a vendor-hosted app is often served through a browser gateway (RD Web Client, Azure Virtual Desktop web client, Citrix Workspace HTML5/StoreFront, Guacamole), where the "app" is the browser and the remote screen is one `<canvas>`. The helper classifies a browser window as remote when its document URL matches the tenant's `remote_gateway_url_patterns` (package-spec §9.3), or when a canvas or nameless element covers more than 60% of the document area. Such steps get `access_mode: "remote"`, `unavailable{reason:"remote_session", client:"web_gateway"}` and the same fail-closed typing rule.
- The system is marked `access_mode: "remote"` and the AX/UIA call is skipped. Each step gets an 800×500 logical-pixel crop, OCR of the label nearest the click (`grounding: "ocr"`, T1) or none (`visual_only`, T0), the click point, `unavailable{reason:"remote_session", client}`, and an `image_anchor`.
- The HUD dot turns amber; rule R4 asks "What did you click?" with the OCR guess as a chip, clearly a guess.
- **Remote typing fails closed, from a signal the helper can actually see** (PRV-SEC-03). There is no keyboard hook and no accessibility tree inside the remote window, so the trigger is visual: **after any click into a remote or opaque window, every screen change inside that window until the next click or focus change elsewhere is treated as possible input.** The helper emits `event.remote_input_suspected{window, rects_dpx, since_click_event_id}`, where `rects_dpx` are the frame-diff bounding boxes of the changed regions within 400 logical px of the last click point, padded by 16 logical px (the caret and cursor are masked first, §9.1). The core blurs those rects in that frame and in every later frame of the window until the next click, flags the step `input_target_unknown`, and rule R15 blocks export until the user acknowledges it (`input_ack`). A changed region far from the click (a page refresh) is not blurred but still flags the step. **Fail-closed floor:** a tenant policy (and the start sheet, per recording) can choose "blur the whole remote window", which burns in every remote frame except the crop around each click.
- Hotkeys may be forwarded into the remote session, so every action works from the HUD and tray (W8, W16).
- Claude reads the clean crops at processing time and is told the step is pixels-only.

**Topology B: the recorder itself runs inside an RDP session or a Citrix/AVD VDI desktop** (Caseware on Citrix; staff who RDP into their office PC). Here `WDA_EXCLUDEFROMCAPTURE` may fail open (windows-tech §7.1), Desktop Duplication can return `DXGI_ERROR_UNSUPPORTED` or `DXGI_ERROR_SESSION_DISCONNECTED`, there is usually no GPU, a disconnect stops capture, and the display topology changes on reconnect. Requirements: the capture backend is chosen at run time; the Start self-test detects fail-open exclusion and switches to `mask_recorder_windows`; a disconnect writes `gap{reason:"capture_lost"}`; on reconnect the helper rebuilds the display map from `WM_DISPLAYCHANGE` and either resumes or pauses with a notice; `manifest.capture.session` records `rdp` or `ica`. Spike check W18 covers it.

**Gate G1:** the capture lanes (L2a/L2b) do not start until the owner confirms with Moore how staff reach ProfSoft and Caseware, including whether through a browser gateway and whether anyone would run the recorder inside a remote session. The answer sets how much effort goes into remote mode and whether a Citrix smoke is mandatory.

### 9.7 Permissions (macOS)
Expected: Accessibility, Screen Recording, Microphone (on first narration). Whether a mouse-only listen tap also needs Input Monitoring is disputed (DTS says a listen-only tap triggers it; a forum reply says Accessibility covers it), so **onboarding is built for four grants until P1, run from a clean TCC state on a notarised Developer ID build, proves three**. TCC is tied to the signing identity, so every dev build is signed with a stable Apple Development identity. P2 decides whether the helper's grants appear under the main app (helper as plain child) or a helper `.app`. MDM profile for Moore is Phase 2.

---

## 10. Annotation and narration

- **Freeze:** the core asks the helper to `freeze`. The helper returns the latest frame of each display and an **a11y snapshot scoped to the front window plus the window under the cursor** (pruned, at most ~2,000 nodes, 300 ms p95 budget, partial results allowed; our PIDs excluded). The snapshot is built **breadth-first outward from the element under the cursor** (its ancestors, then their children by distance from the cursor) within the time budget, so the region under the pointer is complete even when the total is partial; macOS AX has no batched subtree fetch, so a whole-tree walk of Chrome or Excel would blow the budget. Spike X9's bar: every node within 300 px of the cursor present, plus the 300 ms p95.
- **What the snapshot may export.** The raw store keeps the snapshot (it already holds frames showing the same text). At export, `a11y/<step>.json` keeps the target path and withholds sibling names (`[ROW_TEXT]`, package-spec §5.10), because in an inbox, document list or client grid the siblings are other clients' records.
- **Snap** is `hitTest(snapshot, point_fpx → dpx)`, a pure TypeScript function in `core`. `[`/`]` walk to parent/child. Empty or opaque snapshot → dashed mode.
- **Annotations are vectors over the clean frame** (`geometry_fpx`, `snapped_to`); they are rendered into `*_full_annotated.png` only at export and only for steps with highlights (H1, H2 labels).
- **Explain time** is recorded as `explain_ms` and excluded from task time.
- **Hotkeys (candidates; K1 decides):** Explain Ctrl+Alt+E (Windows) / Ctrl+Cmd+E (macOS); Pause Ctrl+Alt+P / Ctrl+Cmd+P; Decision quick-mark Ctrl+Alt+D / Ctrl+Cmd+D; That was a mistake Ctrl+Alt+Z / Ctrl+Cmd+Z; Narration toggle Ctrl+Alt+N / Ctrl+Cmd+N. Stop has no hotkey. Registration failures are detected and reported; one-click rebinding; AltGr layouts (Ctrl+Alt is AltGr on many layouts) and macOS 15+'s block on Option-only chords are tested. The HUD and tray are always an equal path.
- **Narration:** **Toggle** (press to start, press to stop; hotkey or HUD mic) is the default, or **Type only** for open-plan offices. The mic opens only while narration is on and closes on pause (PRV-AUD-01). Hold-to-talk exists only on the HUD and comment-card mic buttons, held with the mouse. Default subject to sign-off S17.
  - Audio: hidden renderer `getUserMedia` → Opus chunks → core, encrypted; **never exported** (PRV-AUD-03).
  - Transcription: bundled whisper.cpp (`base.en` shipped in the installer; `small.en` optional), run at low priority in ~30 s chunks during pauses and after Stop, so recording never competes for CPU on older laptops (X10 decides whether live chunks are affordable).
  - **Where the binaries and model come from.** The ggml `base.en` model is about 148 MB, over GitHub's 100 MB file limit, so it is never committed. A dedicated CI step builds (or fetches a pinned release of) whisper.cpp per architecture (macOS universal via `lipo`, Windows x64 and arm64) and downloads the model; every artefact is checked against a sha256 recorded in the repo, cached, and placed in the untracked `recorder/vendor/whisper/`. This runs only in `build:dev` and release jobs, never in `pnpm test`. The repo's `.gitignore` ignores every `bin/` directory, so no vendored path uses a `bin/` folder.
  - Alignment: a segment goes to the step whose `[t_start − 3 s, t_end + 1 s]` window it overlaps most; `anchor_confidence` < 0.6 when it overlaps more than one. Draggable in review.
  - In Toggle mode, ~30 s of silence while the user keeps acting shows a silent HUD hint ("Say what you're looking for?"), at most once every 2 minutes.
  - en-ZA accuracy is gated in X5: word error rate ≤ 15% on a scripted synthetic en-ZA set read aloud, with a domain term list (AFS, IRBA, ProfSoft, Caseware, QuicklySign, lockdown) passed as the initial prompt; if `base.en` misses the bar, `small.en` becomes the shipped default (X10 checks its CPU cost). X5 also reports how Afrikaans code-switched segments come out. Afrikaans transcription is Phase 2.

---

## 11. Prompt engine and readiness rules

- **One pure module**, `@handover/core/rules`, defines R1–R17 (package-spec §5.7), the `commit_like` predicate and the boundary emission rules (package-spec §9.3). Each rule is a predicate over the step model with a severity; a rule may also declare a live trigger and a question template.
- **Four places, one module:** (1) live prompts during recording; (2) the wrap-up and review checklist; (3) the export gate (only R7 and R15 block; context rules never block and are exported as `warn` or `skipped_by_user`); (4) `handover lint` in CI over every golden fixture.
- **Live budget:** at most one prompt per 60 s of task time (pauses and Explain excluded), never while a text field has focus and the screen is changing, never in the first 20 s, two consecutive skips halve the rate, three disable live prompts for the session with a toast ("Prompts off. You can add context in review."). Unanswered prompts become review items.
- **Copy rules:** one sentence that names what just happened; two or three one-tap chips plus "say it" and "Skip"; plain words. All user-facing text lives in one copy file so a non-technical reviewer can check the tone.
- Every answer is written to `prompts.jsonl` and as a `comment` annotation with `source: "prompt"`.

---

## 12. Review and export

### 12.1 Editor operations
Every operation is an entry in `edits.log`; review state is the projection of `events.log` replayed with `edits.log`, so undo is "drop the last op and replay". The operation union lives in `core/src/edits` (owned by L1b, typed with zod), and each op has a payload, an inverse and replay semantics:

| Op | Payload | Inverse / replay |
|---|---|---|
| `rename` | step, new summary | previous summary; sets `summary_provenance: user` |
| `merge` | ordered step ids (adjacent) | `split` back to the original ids; suggested for a burst of clicks in one form |
| `split` | step, split point (event id) | `merge` |
| `delete_step` | step | re-insert from the log; blobs are deleted only when the op is committed at export or the recording is closed (undo window = the review session) |
| `insert_manual` | after step, description, why? | `delete_step` |
| `convert` | step, kind (`decision`/`wait`/`checkpoint`) and its fields | previous kind and fields |
| `move_narration` | segment, target step | previous anchor; anchor becomes `explicit` |
| `classify_value` | step, disposition, placeholder or literal, parameter | previous value record |
| `set_shape` | parameter or flow end, format | previous shape |
| `unblur` | step, rect, reason (PRV-KEY-04a) | re-blur; logged to the audit log |
| `redact` | step, rect or text span, class | remove that redaction |
| `redact_everywhere` | class, matched text (kept in the raw store only) | remove the rule; re-run detectors |
| `acknowledge` | step, `scope` or `input` | un-acknowledge |
| `skip_rule` | rule id, step ids, user note | un-skip |
| `answer_prompt` | prompt, chip/text | clear answer (prompt returns to `skipped`) |
| `annotate` | annotation (highlight/comment) | delete it |
| `edit_annotation` | annotation, fields | previous fields |
| `set_done_when_steps`, `set_repeat` | step ids / repeat object | previous value |
| `attest` | attestation text hash | un-attest (any later op clears it) |

L1b adds a projection test: replaying any prefix of a golden edit log and then its inverses returns the original projection byte for byte. L4b wires every op into the editor with undo.

### 12.2 Titles and gap flags before export
Rule-based on the device, no model: "Click Save in AppSheet", "Type the AFS signed date in 'AFS signed date'", "Fill in the Register form (5 fields)", "Click in Remote Desktop: describe this". Gap flags are the readiness rule results.

### 12.3 The export gate (PRV-EXP-01)
Blocks export until: every step has been displayed; the privacy sweep has been opened and every medium-precision detection resolved; no special-PI flag (R7); every `input_target_unknown` step has `input_ack` and every `scope_verified:false` step has `scope_acknowledged` (R15); the pre-write verifier passed on the preview render (§12.4); and, last, the attestation ticked on that preview. Nothing else blocks.

**Against click-through review.** "Every step displayed" can be satisfied by clicking Next. So the review opens in **riskiest-first** order for the privacy sweep (steps with detections, names-list hits, remote input blur, or the most unredacted text first), each step shows its "Text Claude will see" panel with a count of unredacted strings, and the default image policy is the lowest-exposure one the evidence supports (package-spec §3.4). The recorded order of steps never changes.

### 12.4 Export pipeline
Nothing is recorded before it happens: the verifier runs on the in-memory render **before any byte is written**, and `privacy.json` is built only after the user has attested, so it can truthfully record both.
1. The user opens "What Claude will see". ExportService creates the `exportContext` (§8.5).
2. Render in memory: burn redactions into pixels; strip metadata; resize to the profile and image policy; cut crops from the **redacted** frames; render annotated frames; serialise every **content file** (every file except `privacy.json` and `manifest.json`).
3. **Pre-write verifier** on those exact bytes: OCR plus the high-precision detectors plus the names-to-hide matcher over every image and text file. Any hit outside an explicitly un-blurred region stops the export and shows the location (PRV-EXP-05).
4. The preview shows this render. The **preview hash** is the sha256 of the sorted list of `(path, sha256)` of the content files (PRV-EXP-03).
5. The user ticks the attestation, the last gate condition (§12.3). The gate now passes.
6. Build `privacy.json` (attestation, `gate.pre_write_verifier: "passed"`, and `preview_hash_matched: true` meaning the content files about to be written hash to the preview the user attested on, re-checked here); hash every file into `manifest.json`.
7. `handover validate` (schema + V1–V17) on the in-memory package.
8. Write to the chosen folder; re-read the written files, recompute the content-file preview hash and every manifest hash, and require both to match. A mismatch deletes the output and aborts, so any package that exists passed this check.
9. Second check: re-run the verifier over the files as read back from disk. Its result goes to the local audit log (not into the package, which would change the hashes); a hit deletes the output and aborts.
10. Audit-log entry with the package hash; offer to delete the original.

---

## 13. Privacy guardrails and defaults

**Floors that no policy can loosen (PRV-ADM-02):** no secure-field capture; no clipboard content; no keystroke content; mandatory review gate; recording starts only from a local user action.

**The one value read:** the URL of a browser window's **document** (`AXURL` of the web area on macOS; the document element through UIA on Windows) is read, only to decide scope (PRV-SCOPE-03) and to record the URL, which is reduced to origin + path in memory before it is stored. The omnibox (address field) is never read, and never while it has focus. Editable form fields are never read (outside PRV-KEY-04b opt-ins).

| Setting | Default |
|---|---|
| Recording start | Local UI click or hotkey only; no CLI/IPC/remote/scheduled start |
| Indicator | Edge strips on every display + HUD + tray, excluded from capture |
| Scope | Apps I choose (pre-filled); blocklist enforced; full display is explicit (S11) |
| Keystrokes | None captured (no hook). Shortcuts only inferred. |
| Field values | Not read. Literals only for control labels, PRV-KEY-04b opt-in fields, or review un-blur with a note |
| Secure or unknown input target | Suppressed; secure fields blurred; possible remote typing blurred from frame changes (§9.6); flagged for acknowledgement |
| Clipboard | Never read; change counter only |
| Client and person names | Names-to-hide list (start sheet + optional tenant dictionary) matched in every channel, pixels included; a11y sibling names withheld |
| Window titles / URLs in export | Titles: detector and names-list spans replaced, app name kept (`window_title_mode: spans`; a tenant may force `whole`); URL origin + path, query and fragment stripped, id segments `[ID]`; address bar burned into every browser frame |
| Images in export | `image_policy` (full and crop / crop only / text only); default set by the format-gate evidence; tenant can cap it |
| Narration | Toggle; on-device; audio never exported (S17) |
| PII detectors | High-precision pre-blurred; medium must be resolved; special PI blocks; the UI says detection can miss things (PRV-PII-07) |
| Storage | Per-recording AEAD key in the OS keystore; app-data only; cloud-synced paths refused; 30/90-day retention (S12) |
| Export | Local folder/zip only; gate, preview, attestation, verifier |
| Telemetry / crash upload | Off; logs contain no content |
| Development | Synthetic data only; CI rejects media or packages outside `recorder/fixtures/` (PRV-DEV-01) |

**Moore sign-off before any real-data pilot** (privacy-compliance §9): impact assessment (S1), lawful basis (S2), staff policy with no performance use (S3), staff consultation (S4), IRBA confidentiality position (S5), ISQM 1 update (S6), Moore–Warp operator agreement (S7), s72 transfer basis (S8), approved Claude route (S9), blocklist additions (S10), allowlist-only pilot (S11), retention (S12), encryption (S13), export destinations (S14), two-person review (S15), client-name dictionary (S16), narration default (S17), attestation wording (S18), incident procedure (S19), Citrix reality (S20). Plus, from this design: **value fingerprints** (P2 automatic lineage), **PRV-KEY-04b field opt-ins** (including whether an opt-in **Excel formula-bar capture** is allowed, with detectors re-run on the captured formula: formulas are the logic of reconciliations, and without them Claude cannot learn them), and acceptance of **PRV-KEY-01 count bucket and PRV-KEY-02 unmet** in v1. None of these block the MVP build, which uses synthetic data only.

---

## 14. Claude process-spec generation and the Superbrain interface

### 14.1 Output contract
`process_spec.json` (package-spec §9.1), written by Claude to the sibling `.derived/` folder; `derivation.json` is written afterwards by the harness, not by Claude (package-spec §9.2). Every step cites evidence step ids and carries `action_class`, `target.system_id` and `target.control` so it can be scored; a P-step citing any boundary-flagged or `do_not_automate` step must be `human_only`; branch conditions without user provenance are `unknown`; no string may contain a redacted value (PS1–PS4).

### 14.2 Two ways to consume a package
1. **Agent with a filesystem (default; what acceptance 4 tests):** a clean Claude Code session started in the **parent folder** that holds `<pkg>.handover/` and an empty `<pkg>.derived/`, with the prompt "Follow `<pkg>.handover/CLAUDE_HANDOFF.md`". Claude writes only into `<pkg>.derived/`, so nothing is added to the hashed package and no extra permission is needed. For acceptance the parent folder is a fresh temp directory outside any git repository (no repo or parent `CLAUDE.md` is loaded) and user-level `CLAUDE.md` is disabled and recorded. The `skills/understand-process/SKILL.md` skill wraps this.
2. **`handover spec <pkg>` (Messages API):** documents first in XML tags (manifest, PROCESS.md, steps, annotations, dataflow, gaps, prompts, readiness), then per step a text label before that step's images, instructions last. **Images inline as base64** (no Files API on the approved route), `oversized_image: "error"` on every image, ≤ 1,568 px. **Chunking:** at most 100 images per request; a longer package is split by chapter (then phase); each chunk request carries all text files plus its own images and returns a partial spec for its step range; a final text-only request merges the partials. `derivation.json.mode` records `messages_chunked` and the chunk count. This is how "no length cap" survives the image limit.

### 14.3 Approved route
For real client data: one Commercial-Terms organisation, a workspace restricted to US processing, zero data retention requested, **Opus 5.5 or Sonnet 5.5, never Fable or Mythos** (they force 30-day retention and are excluded from ZDR), no Files API, Batch or MCP for packages. Moore signs this off (S9) before any real package is processed. MVP processing uses synthetic fixtures only. `spec` is never bundled into the desktop app.

### 14.4 Superbrain mapping
The recorder never writes into the Superbrain ontology or catalogue (that would break the no-source-content rule and skip approval). Steps map to artefacts Superbrain already plans:
- a read step → a **Definition** (for example a ProfSoft read becomes a definition over the existing read-only ODBC connection, never UI replay);
- a write through a system's API → an **Action Recipe** plus a domain tool;
- an observed system event → a **trigger** (QuicklySign's `final_document_generated` webhook replaces S01–S02 of the worked example);
- the sequence → a **Tier C Procedure**;
- `engagement_file_content`, `system_of_record_write` and judgement → `human_only`. Steps that are `human_only` or `unknown` because no API exists are useful in their own right: they are the integration backlog.

### 14.5 Staging
- **v1 (this build):** the file package, handed over by a person. The format is the contract; the manifest already carries tenant, positions, System key hints and hashes.
- **v2 (future WIAS ticket):** a recorder channel that submits a `process_spec` proposal with the package hash as evidence, resolved by a person in an approved position. It depends on WIAS-94, WIAS-95 and WIAS-87 plus a durable proposal store and a resolver for package references.
- **v3:** an MCP `search_processes` / `describe_process` tool over approved specs.

---

## 15. Reliability backbone

Every risky dependency has a primary path, a fallback the app selects at run time, a detection signal, and a test that runs without a desktop. Each row names the lane that owns it; the conformance suite has a **named test per fallback** that fails if the fallback is removed.

| Dependency | Primary | Fallback | Run-time detection | Desktop-free test | Lane |
|---|---|---|---|---|---|
| Our windows kept out of frames | SCK filter (mac) / `WDA_EXCLUDEFROMCAPTURE` (win) | Mask HUD, strip and overlay rects in each frame | Marker self-test at Start; `capture_self_exclude` | Simulator frames containing the marker → masking asserted | L1b, L3a |
| Scope masking | SCK include filter + view-service allowlist (mac) / the Windows method X2 picks (per-window composite preferred, or z-order mask with shell-surface subtraction) | macOS: `system_dialog_not_captured` gap; Windows: the other method; then display mode + blocklist (owner) | Frame inside a layout-change quiet period → dropped; API failure → blank frame + `capture_masking_failed` gap | Mask algorithm tests on synthetic window lists everywhere; static pixel diff where capture works; dynamic test on the VM | L2a, L2b |
| Click hook | Listen-only mouse tap / mouse LL hook | Watchdog reinstall; `hook_lost` gap; HUD amber; elevated focus → `elevated_window` gap | Raw-input mouse buttons vs hook events (suppressed under elevated focus or a non-Default desktop); trust polling; no synthetic input | Simulator transcript with hook loss → gap + HUD state; keyboard-only and elevated-focus transcripts → no `hook_lost` | L1b, L2a, L2b |
| Our own UI clicks | `ui.regions` from the core | Drop any pointer-down inside our interactive rects | n/a | Conformance test: HUD chip clicks produce no steps | L1b, L2a, L2b, L3a |
| Remote typing | n/a (no hook, no a11y inside) | Frame-diff `remote_input_suspected` → blur + `input_target_unknown`; whole-window blur floor | Click into a remote/opaque window, then screen changes | Simulator transcript built from the real event shape | L1b, L2a, L2b |
| Control lookup | AX/UIA at mouse-down + hover cache | `accessibility_weak` → OCR → `user_described`/`visual_only` | Timeouts, opaqueness score, remote-client detection | Golden transcripts for every grounding level | L1b, L2a, L2b |
| Freeze snapshot | Front window + window under cursor ≤ 300 ms | Partial snapshot; empty → dashed mode | `a11y_snapshot` capability; timeout | Snap hit-test unit tests on snapshot fixtures | L1b (hit-test), L2a/L2b (snapshot), L3b (UI) |
| OCR | Vision / `Windows.Media.Ocr` | tesseract.js with vendored language data | `capabilities.ocr` | tesseract on fixture crops, network stubbed | L1c |
| Helper process | Long-lived child | Restart with backoff; `helper_restart` gap | Missed heartbeats; deadline breach | Supervisor against a fake helper that hangs, crashes, or sends garbage | L1b, L3a |
| Windows capture | WGC in helper | DXGI in helper; then desktopCapturer + MessagePort | `capture_backend` capability | Protocol tests on both paths with the simulator | L2b |
| Mic / transcription | getUserMedia + whisper.cpp | Type-only; transcript "add later" in review | Permission status; `NotAllowedError`; missing binary | Alignment on fixture transcripts | L3b |
| macOS permissions | Guided cards | Frames-only mode without Accessibility; recording refused without Screen Recording | `perm.status` polled | Onboarding state machine with fake statuses | L3a |
| Global hotkeys | Ctrl+Alt / Ctrl+Cmd chords | HUD and tray buttons; rebinding | Registration failure | Conflict-handling unit test | L3a |
| Windows scope masking (helper) | per-window composite or z-order mask with shell-surface subtraction, whichever X2 picks (§9.3) | the other one; then blank frame + `capture_masking_failed` gap | layout-event quiet period; API failure | synthetic window-list tests everywhere; static pixel diff in Windows CI; dynamic 1,000-frame test on the VM and x64 laptop | L2b |
| Remote / elevated / UAC | n/a | `unavailable` reasons, gaps, R4 prompt, fail-closed typing | Process names, integrity level, secure desktop | Simulator transcripts | L1b, L2b |
| Encrypted store | safeStorage via KeyService in main → `Keystore` over MessagePort | none (recording refused); in-memory keystore in tests only | Keystore unavailable | Full store tests with in-memory keystore | L1c (interface), L3a (KeyService) |
| Network isolation | No network sockets in helper/core/workers | n/a | n/a | Stub denies TCP/UDP/DNS, allows `AF_UNIX` and `\\.\pipe\handover-*`; test proves both | L1a |
| Signing / AV (P2) | Developer ID + notarisation; OV cert | IT-managed deployment, Defender submission | n/a | CI check that every PE and Mach-O is signed (P2) | L6 (scaffold) |

---

## 16. Testing strategy

### 16.1 `pnpm test` (acceptance 1)
- Runs from the **repo root** (`pnpm test`): a root `package.json` whose only script is `"test": "pnpm --dir recorder install --frozen-lockfile --prefer-offline && pnpm --dir recorder test"`. "From a clean checkout" includes that install step. Both the root and `recorder/package.json` pin pnpm with a `packageManager` field so CI and contributors use the same version. Linux, macOS and Windows CI.
- **Hermetic:** Node unit tests, the privacy regression suite (PRV-DEV-03) and the conformance suite against the HelperSimulator. No Electron binary, no display, no Swift or .NET toolchain, no whisper model, no API key. **The network ban applies to the vitest run**, enforced by the socket stub (§8.1: TCP/UDP/DNS denied, local IPC allowed); the install step before it may use the network or the pnpm store. L1a proves the Electron binary is not downloaded or needed (the mechanism, for example pnpm's handling of dependency install scripts, is L1a's to verify, not assumed here).
- Contents: schema positive and negative tests (package-spec §14); semantic validator; geometry property tests (mixed DPI, display left of primary with negative origin); step builder golden comparisons (`steps.jsonl`, `dataflow.json`, `PROCESS.md`, `CLAUDE_HANDOFF.md`, `steps-guide.html` byte for byte); edit-log replay and undo; readiness rules and prompt budget with a fake clock; detectors on synthetic SA IDs and tax numbers (valid and invalid check digits; recall ≥ 0.95 on structured ids); the **privacy acceptance fixture** (a synthetic session with a password field, an SA ID number, a URL query string, and a client name on the names-to-hide list placed in a window title, in the page body, in a list sibling row, in a11y names, in a locator, spoken in the narration, and typed into a remote search box; plus an inbox-like list visible at freeze: the exported package contains none of them, searched across all text files and by OCR of exported images, while still containing the steps, highlight, comment and transcript, and `privacy.json` records each redaction); the PRV-KEY-01 absence check as defined in §9.4; store encryption (no PNG/WAV magic bytes, no fixture strings) and crypto-shred; audit-chain tamper detection; burned-in region variance ≈ 0 and metadata stripped; injected missed digit aborts export; process-spec validator; the scorer on a *recorded* Claude output fixture; the media guard.
- **OCR in `pnpm test`** uses tesseract.js with language data from a pinned package or vendored under `recorder/fixtures/ocr/`, with the language path pointed at it, so the test never fetches from a CDN.

### 16.2 Separate CI jobs
- `pnpm test:e2e` (own job, all three OSes, xvfb on Linux): Playwright `_electron` driven by the HelperSimulator: start sheet → scripted session → Explain with Snap on a snapshot fixture → comment, tags → narration fixture → stop → review → gate → export → `handover validate`.
- `swift test` on macos-latest: protocol codec, coordinate flipping, coalescing, mask maths. Whether a hosted macOS runner can grant Accessibility or Screen Recording is unverified, so AX and capture integration run in the Mac smoke.
- Windows helper integration on windows-latest (x64) **and a windows-11-arm job**: build the helper, run the conformance suite against it, drive `TestTargetApp` with SendInput or the winapp CLI: clicks resolve to the right UIA names and physical bounds, a password box emits nothing (W11), hook-watchdog drill (W5b). Scope masking is split in two: (a) the deterministic mask-algorithm tests (synthetic window lists and frames, including mixed DPI and negative origins) run in every job; (b) a capture-integration job whose **first step asserts that the capture backend delivers a non-black frame and fails loudly with "capture unavailable on runner" if not**, never silently skipping, then runs the static pixel diff on one display. Hosted runners have no GPU and one virtual display, so multi-display, mixed-DPI and the dynamic masking test run on the VM and the x64 laptop. A one-hour CI probe of WGC and DXGI on windows-latest and windows-11-arm runs before L2b is dispatched.

### 16.3 Smoke runs (need a person; scripted checklists in `docs/recorder/smoke/`)
The owner (or someone at his keyboard) runs these; the lane agent prepares the scripts, the evidence collector and the analysis:
- **Mac (owner's machine, notarised build for permission checks):** P1/P2 from a clean TCC state (system dialogs need a human), H1 (revoke Accessibility mid-recording), O1–O3, C1/C2, A1 matrix, M1 (speaking), X4, X9.
- **Win11 Arm64 VM (arm64 native + x64 under emulation):** W1, W2 (as far as the VM allows), W3, W8 (mstsc and an RD Web client in Chrome, with remote typing), W9, W10, W16, W17, W18 (recorder inside an RDP session), X2 (dynamic), X12, X13.

### 16.4 Acceptance 2 and 3
Record the synthetic "Lockdown capture" test process (web app in Chrome + a native fixture app step with a grid cell + **a ProfSoft-style lookup inside a remote window**) into one package containing clicks, a highlight, a comment and narration, on the Mac and in the Win11 VM. The remote step: on the Mac, Windows App into the Win11 VM running `TestTargetApp`'s lookup screen; in the VM, `mstsc` to `127.0.0.2` (loopback; needs an edition that accepts RDP, else a second VM), with the client name typed into the remote search box so the remote-typing blur is exercised. Both are produced in lane L4a, because a package only exists once review and export work; L3b proves the same recording as a raw session on the Mac. The package must pass `handover validate` and `handover lint`. Evidence: the package under `recorder/fixtures/acceptance/<os>/` and a report in `docs/recorder/evidence/`.

### 16.5 Acceptance 4 harness
- `recorder/fixtures/acceptance/<os>/reference_sop.json` (package-spec §15) is written and committed in L1a2, **before** any recording. The remote lookup step is in it.
- Session setup: a fresh temp directory outside any git repo holding a copy of `<pkg>.handover/` and an empty `<pkg>.derived/`; user-level `CLAUDE.md` disabled; started with `hc run` in Herdr; prompt "Follow `<pkg>.handover/CLAUDE_HANDOFF.md`"; model Opus 5.5 or Sonnet 5.5, id and effort recorded. The harness writes `derivation.json` afterwards.
- `handover score` (deterministic, no network, package-spec §15.2) computes, with these bars: step F1 ≥ 0.9; zero order inversions; app + control correct ≥ 90% of action steps; 100% valid evidence citations; zero unflagged invented steps; zero guessed values (PS4); 100% of user-stated decisions, rules, join hints and value lineage recovered; done-when covered.
- Runs on **one Mac package and one Windows package** (L5). The image-policy ablations (`crop_only`, `text_only`) are scored and reported alongside; they set the default image policy (package-spec §3.4). A high-res ablation stays a diagnostic.
- **Execution check (recorded, not blocking for acceptance 4; a gate before any pilot):** an agent given only `process_spec.json` runs `test-process-app` with fresh synthetic data down both branches of the decision and reaches done-when.

### 16.6 Windows evidence caveat
The VM is Windows 11 on Arm64 and CI is x64 without a person at the screen, so x64 behaviour with a real GPU and mixed-scale monitors is untested. Acceptance 3 is a **provisional go**. A real x64 laptop re-running W1–W6, W14 and W16 is the gate before any Moore pilot.

### 16.7 Evidence and the media guard
One rule: **media and packages live only under `recorder/fixtures/`** (including `recorder/fixtures/evidence/<lane>/` for screenshots and smoke packages); written reports live in `docs/recorder/evidence/<lane>.md` and link to them. All of it is synthetic. `tools/ci` fails on media or `*.handover` anywhere else.

---

## 17. Risks and mitigations

| Risk | Sev | Mitigation |
|---|---|---|
| ProfSoft or Caseware runs over Citrix/RDP, so no control data for the core systems | High | Remote mode is first-class (§9.6); evidence tiers; OCR, crops, R4 prompt, Claude vision after export; gate G1 before the capture lanes |
| Personal data leaks through a channel other than pixels | High | One redaction serialiser for every screen-text field; names-to-hide list in every channel; a11y siblings withheld; burn-in; pre-write verifier; privacy fixture in `pnpm test` |
| Client names typed or shown inside a remote window leak | High | Frame-diff remote-input blur + `input_target_unknown` + R15 block; whole-remote-window blur floor; names-list OCR match; W8 typing case |
| The package format is frozen before any Claude has read one | High | Format gate L1a2: Claude reads hand-made packages and is scored before L1b; schema changed from the results, then frozen |
| macOS permission friction makes non-technical users give up | High | Picture-led cards, live status, relaunch handling, practice run; plan for four grants until P1; MDM profile (P2); usability gate U1 (5 users, ≥ 2 on Mac) before L4a |
| Non-technical staff do not leave useful "why" comments | High | Explain, tags and one-tap prompts; gate U1 measures share of steps with a why, a specificity rubric, answer and skip rates, and Toggle-on vs Toggle-off narration; copy and defaults change before L4a |
| EDR flags the recorder as a keylogger | High | No keyboard hook; mouse-only helper; signed binaries (P2); Defender submission; allowlist with Moore IT |
| Our windows appear in frames | High | SCK filter; `WDA_EXCLUDEFROMCAPTURE`; marker self-test with automatic masking fallback |
| Hook silently removed or AX/UIA lookup hangs | High | Enqueue-only hook; worker timeouts; watchdog; out-of-process helper with deadlines; health HUD; hook drills H1/W5b are hard stops |
| Windows scope masking leaks out-of-scope pixels (toasts, Start, animations, stale frames) | High | Allowed region only from identified in-scope windows; shell surfaces subtracted; frames in layout-change quiet periods dropped; fail-closed blanking; static and dynamic (1,000-frame) pixel tests; X2 blocking; per-window composite preferred when it passes |
| Keyboard-heavy work (Excel) yields too few steps without a hook | High | Focus, value-commit, title and screen-change triggers; inferred shortcuts; W17/X4 pass bars; opt-in shortcut mode as an owner decision |
| Windows evidence only from Arm64 VM and headless CI | Med | Build both architectures; windows-11-arm CI job; x64 laptop gate before pilot |
| Prompts feel like nagging | Med | Hard budget, back-off, chips, answer in review; answer and skip rates measured in U1 |
| Noisy steps or over-generalising from one run | Med | Step aggregation, That was a mistake, merge suggestions, decisions only from user text, teach-back, variants (P3) |
| Anthropic ships Windows + review in Record a skill | Med | Stay upstream: open package, control grounding, dataflow, audit manifest, Superbrain mapping |
| IP: the signed Moore terms vest works in MSTB, but the recorder is meant to be general and lives in the Moore repo | Med | Owner confirms ownership and licensing, or moves `recorder/` to a Warp-owned repo, before reuse for other clients |
| Schema churn while lanes build | Med | L1a and the format gate L1a2 own the schema and are the last non-additive window; L1a2 tests it with Claude before freeze; later additive patches applied by the orchestrator only; CHANGELOG + `schema_patch` gate; each package carries its schema |
| Electron or macOS point releases break overlays (26.3 RC, 27.3 beta) | Low-Med | Pin Electron; per-release smoke checklist; no undocumented behaviour |

---

## 18. Left to the builder

The builder decides these without asking the owner, within the contracts:
- Windows helper language (C# `net48`/`net481` vs Rust) from spike X7 measurements; Windows capture backend from X13; per-window composite vs z-order mask from X2.
- Helper design A (plain child) vs B (helper `.app`) on macOS from P2.
- Exact hotkey chords from K1; screen-change thresholds from X11; prompt copy wording (within §11 rules).
- Internal module boundaries inside each package, provided the module rule in §8.6 holds.
- Image encoding inside the binary channel (PNG vs lossless WebP) from X10.
- The mechanism that keeps the Electron binary out of `pnpm test`, and how tesseract language data is pinned.
- React state management and styling, within the wireframes.
- Which Skill Recorder modules to copy (X8), with MIT attribution.

Not left to the builder: any change to the package contract outside L1a/L1a2 (later additive patches go through a change request the orchestrator applies), any loosening of a privacy floor, any network call outside `packages/spec`, any use of real client data.

---

## Appendix A: judges' must-fix items and where they are resolved

| Must-fix | Resolved in |
|---|---|
| Coordinates: per-display physical pixels + display map + per-frame transform | package-spec §3.3 |
| Narration: no hold-to-speak key; toggle chord + mouse-held HUD mic | §7.4, §10 |
| Frames: ring buffer in helper memory, token-authenticated channel, core encrypts | §8.3 |
| Windows scope masking algorithm, fail closed, pixel-diff test, X2 blocking, fallback | §9.3; plan L0b/L2b |
| Snap from a freeze-time snapshot; opaque frozen panel windows; O3 blocking | §7.4, §10; plan L0a |
| Lane sizing: core split into L1a–L1d | plan |
| MVP cut; features tagged; chapters placed | §6 |
| Packer chunking at 100 images, inline base64 | §14.2 |
| `pnpm test` location; no Electron binary or whisper models | §16.1 |
| Hermetic OCR in `pnpm test` | §16.1 |
| Keyboard MUSTs (PRV-KEY-01 bucket, PRV-KEY-02) recorded as sign-off; W17/X4 pass bars | §9.4, §13 |
| Boundary and system-of-record flags from a tenant profile | package-spec §9.3; §14 |
| macOS permissions: plan for four grants until P1 | §7.1, §9.7 |
| Windows evidence for acceptance 3 and 4 | §16.4–16.5; plan L4a, L5 |
| PRV-KEY-01: no value read by default; fingerprints P2 off by default | §9.1, package-spec §4.2 |
| Package contract holes (gaps file, no raw evidence ids, dataflow, step kinds, migrated example as L1a's first check) | package-spec |
| Same keyboard behaviour on both OSes | §9.4 |
| Snapshot scope: front window + window under cursor, 300 ms p95 | §10 |
| Signing/DMG/NSIS out of MVP (MVP artefacts are unpacked dev builds and zipped apps); stable dev identity; notarised build for P1/P2 | §6 F25, §9.7; plan L6 |
| App-scoped default; URL blocklist; display mode as explicit choice | §9.3 |
| ProfSoft access mode as a pre-lane gate, not a spike check | §9.6 (G1) |
| Conformance suite covers degraded modes with named tests | §15 |
| Owner sign-offs (KEY-02, fingerprints, KEY-04b, route, jurisdiction, IP, x64 laptop, trademark); no unsupported "Shadow" claim | §5, §13, plan owner questions |
| Ultracode: second critique pass run from the owner's request; confirmation is gate G3 (blocks L0a) | header; plan §0.3 |
| Critique pass 2026-11-21 (builder, platform, product): applied and rejected findings | this document, package-spec header, plan §0 and lane contracts |
