# Recorder UX research: annotation, narration, review and export

Research assignment: `ux-annotation`, planning stage only, no product code.
Prepared 2026-11-21 for the Workflow Recording Assistant lane plan (Moore-Superbrain, `recorder/`).
Audience: the planner (Fable), the lane implementers (Sonnet) and the reviewer (Opus).

---

## 0. How to read this document

Every claim carries one of these evidence tags:

| Tag | Meaning |
|---|---|
| **[P]** | I fetched the primary page on 2026-11-21 and the claim appears in it. A fetch tool summarised the page for me, so I read that summary, not the raw page. Exact wording should still be checked before anyone quotes it. |
| **[S]** | The claim comes only from a web-search summary. I did not open the page, and the summary may be stale or wrong. Treat it as a lead, not a fact. |
| **[I]** | My own inference or design judgement. No external source. |
| **[SPIKE]** | A load-bearing claim the feasibility spike must confirm on real hardware before a lane relies on it. |

Section 14 lists every source with its publish date (where the page gives one) and the access date.

---

## 1. Summary: the ten calls that matter most

1. **The product captures *why*, not just *what*.** Every competitor reviewed records clicks and screenshots well: Scribe, Tango, Snagit Step Capture, Windows Steps Recorder, UiPath Task Capture and the Power Automate recorder. Among the tools reviewed, none *prompts the user for* the reasoning behind a click at the moment of action: the rule, the decision criterion, where a value came from, what to do when it goes wrong. Some tools derive text after the fact, for example Loom's AI titles and summaries generated from a narrated video's transcript [S], but they only get reasoning the user happened to say aloud. That reasoning is exactly what Claude needs to automate a process, so it is our differentiator. Every UX surface below exists to pull that reasoning out at the moment the user has it in their head. [I, grounded in the competitor review in section 3]
2. **Ask the right question at the right moment, and very rarely.** An on-device rules engine watches for high-signal moments: the first time an app is used, copying from one app and pasting into another, typing a value into a field, a long dwell on one screen, a switch to email, a repeated loop. At those moments it offers one short, skippable question in a non-modal card, answered by voice or a one-tap chip. The budget is at most one prompt every 60 to 90 seconds, and never while the user is typing. [I; think-aloud practice supports light, neutral prompting, see NN/g [S]]
3. **Pause-and-annotate works on a frozen frame.** Pressing the hotkey freezes the screen as it was at that instant, dims it slightly and opens the tools. The user annotates a still picture, so their clicks cannot leak into the live app and the screen cannot change under them. [I]
4. **Snap-to-control is the default tool, and the freeform tools stand alone.** Hovering outlines the real control (via macOS AX or Windows UI Automation) and labels it, for example "Button: Save, in ProfSoft". Inside Citrix or a remote desktop, the tool probably sees one opaque surface. When it does, the overlay says so plainly and falls back to box, arrow and highlight, plus "tell me what this is". [S for the Citrix behaviour; SPIKE]
5. **Only three tags, each with a follow-up question.** The tags are "Decision point", "This varies" and "Sensitive", and each one prompts a single follow-up. "Decision point" asks "What decides which way you go?". "This varies" asks "What makes it change?" and turns the value into a named parameter. "Sensitive" applies a blur and replaces the value with a placeholder in the export. [I]
6. **Annotations are structured data, not burned-in pixels.** Boxes, arrows and callouts are stored as vector JSON over a clean screenshot, linked to the control they snapped to. Claude reads the structure, and a human sees a rendered preview. [I; aligned with the "package format first" planner call]
7. **Redaction removes data, not just pixels.** Blur and "Sensitive" redact the screenshot region, the control names and window titles in that region, any typed values, and the matching words in the transcript. All of this is applied destructively at export, and the export contains no original pixels underneath the blur. [I; Tango has a help-centre article on whether redacted originals are deleted [S], which suggests users treat this as a trust issue]
8. **Nothing AI runs before export.** Step titles and gap flags in the review editor are generated on the device from rules: the control name, the app and the action type, plus "a click with no narration or comment nearby". Claude-written titles and the process spec run only after the user exports the reviewed package. This is how the assignment's "AI-suggested step titles" fits the owner's local-first decision (section 6.9.4). [I]
9. **The macOS permission onboarding is a data-driven list of cards, not a fixed script.** Each permission card says in plain words what it allows, what we never do, and shows a picture of the exact system dialog. Its status updates live, and it handles the "relaunch required" step. Which permissions appear, and in what order, is decided by what the spike proves the capture stack needs (section 6.1). [SPIKE]
10. **The review editor ends with a "ready to hand over" checklist, not a score.** The checklist covers open gaps, unreviewed sensitive items, the goal and trigger, and what happens at the end. Users can export with gaps open, but they see exactly what Claude will have to guess. [I]

**Proposed name:** **Shadow** (Superbrain Shadow), from "job shadowing", which is how audit and accounting juniors usually learn a process: they sit beside someone who explains each step as they do it. The verb works naturally in a sentence: "Shadow me while I file this." Alternatives are **Handover** (the output is a handover pack) and **Walkthrough**. A trademark and app-store name check has not been done. [I]

---

## 2. Users and context

Most of this is inferred from the brief. The Moore user research these points need has not been done yet.

| Fact or assumption | Source | UX consequence |
|---|---|---|
| About 100 staff, accountants and admin, not technical | Task brief | Plain words only. No "TCC", "AX", "UIA" or "package" in the UI. Use "walkthrough" and "steps". [I] |
| Mostly Windows, some Mac | Task brief (stated as "probably") | Windows is the primary design target. The Mac permission flow is the hardest UX problem, though. [I] |
| ProfSoft access mode unknown (thick client, browser or Citrix/RDP) | Task brief | The degraded "can't see controls" mode is a first-class design, not an edge case. [I] |
| Caseware is a Windows desktop app | Task brief | Caseware should expose UI Automation, but that is not verified. [SPIKE] |
| IRBA-regulated, POPIA applies | Task brief | Client data appears on screen constantly: names, ID numbers, bank and tax details. Privacy controls need to be prominent and trustworthy, not hidden in a menu. [I] |
| Shared or open-plan offices are likely | [I] | Narration must be optional. Every comment can also be typed. Push-to-talk is offered for people who don't want an always-open mic. |
| Interruptions are frequent (phone calls, clients, colleagues) | [I] | A big, obvious Privacy Pause. Recordings resume cleanly. "Resume where I left off" works after hours or days. |
| Senior staff have the most valuable process knowledge and the least time | [I] | A recording should take the time the task takes plus about 20%, never double. The prompt budget and the skip affordances are tuned for this. |

### 2.1 Worked example used in the wireframes

This is the manual lockdown-clock process from `BRIEF.md` §1, with no people named:

> A client signs the annual financial statements in **QuicklySign**. A staff member notices, opens the **AppSheet** form, types the signing date, then an admin updates the lockdown register in **ProfSoft**. They then note the 40-day (internal) and 60-day (IRBA) deadlines.

This process exercises everything the recorder must handle: a trigger (signature notification), three systems, a value copied between systems (the signing date), a decision (is this engagement type tracked? only audits, independent reviews and compilations are), a value that varies (client, engagement), sensitive data (client names), and a hand-off between people.

---

## 3. Competitive landscape: what to take and what to avoid

| Product | What it does well (evidence) | What we take | What we avoid |
|---|---|---|---|
| **Scribe** | Turns clicks into a step-by-step guide automatically when you stop [S]. Users edit step text and delete steps [S]. **Smart Blur** (dated 2026-09-04) blurs seven categories (emails, numbers, common names, long text, form fields, table rows, images) *before* any screenshot is taken, so the data never reaches Scribe's servers. It works only in the browser extension, on Pro and Enterprise, and the desktop app relies on manual redaction [P]. | Auto-generated steps from clicks. Category toggles for auto-redaction. "Blur before capture" as a trust message. | The cloud upload by default. Desktop users getting weaker privacy than browser users. |
| **Tango** | "Live Blur" redacts during capture. "Secure Blur" (Enterprise) detects sensitive data automatically. "Batch Blur" blurs across 100 screenshots in one click [S]. Its help centre has a dedicated article on whether originals are deleted after redaction [S], which shows users ask that question. | Batch redaction: "blur this everywhere it appears". A plain answer to "is the original gone?" | Paywalling privacy features. |
| **Snagit Step Capture** | Captures a screenshot per click, adds a click marker (cursor plus highlight) and a step number, with an editable text per step. Pause, Record and Stop on a draggable toolbar that is *not* captured. Records clicks and drags only, not typing. Steps can be moved, deleted, added or duplicated. Over 50 steps (Windows) or 100 (Mac) may hurt performance. Version notes go up to Windows 2026.1.0 and Mac 2025.3.0 [P]. | A toolbar excluded from capture. A per-step click marker. A performance budget for long recordings. | Ignoring typing: in accounting, typed values *are* the process. |
| **Windows Steps Recorder (PSR)** | Took screenshots automatically, with annotated text per step, saved to a file for support teams. Deprecated: from the February 2024 Windows 11 update it shows a deprecation banner, with no removal date given [P]. | The audience: Windows users who used PSR for support now have no built-in tool. The low-friction model of "record, then send a file". | Its output format: a dense, unreadable dump. |
| **Loom** | Drawing tool during recording, whose marks vanish after 5 seconds by design. Desktop app only, on the Education, Business, Business + AI and Enterprise plans [P]. Pause and resume shortcut Alt+Shift+P / Option+Shift+P; click emphasis setting [S]. AI auto titles, summaries, chapters, and filler-word and silence removal; Loom says only transcript text goes to OpenAI [S]. | Ephemeral pointer drawing for live narration ("look here"). Silence trimming in review. | Video as the primary artefact: Claude can't use a 20-minute video efficiently, and steps are the unit of work. |
| **CleanShot X** (Mac) | Annotation set: arrow (several styles, including curved), rectangle, text, pixelate, blur and "secure" randomised blur, spotlight, counter (numbered markers), pencil [S]. | Spotlight (dim everything except a region) and the counter tool for numbered callouts. Secure blur, so a blur can't be reversed. | Pro-photographer density: too many options for our users. |
| **Microsoft Snipping Tool** | Win+Shift+S for a snip and Win+Shift+R to record. Text Actions (OCR), "Redact text" and "Quick redact" for emails and phone numbers, pen and highlighter [S]. | The vocabulary Windows users already know: "highlighter", "redact text", "quick redact". | n/a |
| **macOS Screenshot toolbar** (Shift-Cmd-5) | Full screen, window or portion. Options for timer, save location, floating thumbnail, show pointer and clicks [S]. | A familiar mental model for "what to record": whole screen, one window, or a part. | n/a |
| **Zoom annotate** | Spotlight pointer, arrow, vanishing pen (added in v5.6.3, April 2021) and fixed stamps (tick, cross, star, heart, question mark) [S]. | A "?" stamp (we call it "I'm not sure why we do this"). Vanishing pen for live pointing while narrating. | n/a |
| **Figma comments** | Press C, click to pin a comment to a spot, or drag to pin it to a region. Shift+C hides pins. Threads can be resolved [S]. | Comments pinned to a location (here, to a control or region on a step). One-key comment mode. | n/a |
| **UiPath Task Capture** | Builds an as-is process diagram with sequence, decision and swimlane elements, and exports a Process Definition Document (PDD), Word, image or Studio skeleton [S]. The default PDD contains: Introduction (purpose, objectives, key contact, pre-requisites), Process overview, Applications used, As-Is process map, Process statistics, Detailed as-is steps (title, description, estimated time, action type, screenshot), and a To-Be section with business exception handling and application error handling [P]. The page's text does not mention inputs, outputs, business rules, trigger, frequency or volume. However, the "Process overview" table is shown only as an image, with the note that some data is auto-inserted and some needs manual input, so some of those fields may be in that table. This is unconfirmed [P]. | The PDD skeleton as the shape of `PROCESS.md`, **plus** explicit capture of inputs, rules, trigger and frequency, whether or not the PDD's overview table has rows for them (section 8). | Making users draw BPMN: our users will not. We infer the structure and let them confirm it. |
| **Power Automate recorder (process mining)** | During recording, users can pause and resume to avoid capturing PII, delete sensitive steps or modify input data. After import, they can rename steps and delete screenshots (doc dated 2023-07-18, updated 2026-10-29) [P]. | Privacy actions available *during* recording, not only after. | n/a |

**The gap in the market [I]:** every tool above produces a description of *the screen*. None of them interviews the user about *the work*. The closest is UiPath's PDD, which a business analyst fills in by hand afterwards. Shadow's moment-of-action prompts and its decision, varies and sensitive tags fill that gap.

---

## 4. Design principles

1. **Never make the user feel watched.** Recording state is always visible. Pause is one click and one hotkey. The user can see, and delete, everything captured before anything leaves the machine. [I; POPIA context]
2. **Doing the task comes first, and explaining is opt-in.** A user who never touches the annotation tools still gets a usable package with clicks, controls, screenshots and on-device titles. Every annotation layer adds signal on top. [I]
3. **Ask once, ask at the moment, ask in plain words.** Each prompt is short, specific to what just happened, skippable, and answerable by voice. [I]
4. **One obvious action per state.** Idle: "Start". Recording: "Pause to explain". Paused: "Resume". Review: "Fix the 3 flagged steps". [I]
5. **Undo everything and keep originals locally.** Merge, split, delete and blur are all reversible until export. The export is the point of no return, and the UI says so. [I]
6. **Degrade honestly.** If we can't see a control (Citrix, a canvas app, a locked-down window), say so and ask the user to fill in the gap. Never invent a control name. This follows Superbrain's "never invents data" principle (BRIEF.md §2). [I]
7. **Stay out of the screenshots.** Our HUD, overlay and prompt cards must never appear in captured frames. [I; Snagit does this [P]; SPIKE for mechanism, see section 10]
8. **Familiar words.** "Highlighter", "Redact" and "Step" are the words Windows users already have from Snipping Tool, Snagit and PSR [S]. Avoid "annotation", "event" and "artifact".

---

## 5. What every UI action writes into the package

This is a UX-level proposal for the **core** lane, which owns the real schema. Its purpose is that every surface in this document has a defined data destination, and that nothing is captured only as pixels. Field names are illustrative. [I]

| UI action | What the package gains | Notes |
|---|---|---|
| Start sheet: name, goal, trigger, frequency, "who does this" | `process.name`, `process.goal`, `process.trigger{kind, text}`, `process.frequency`, `process.role` | Goal and name are required. The rest is optional, but "missing" is flagged in review. |
| Start sheet: capture scope (screen, window or apps) | `recording.scope`, `recording.displays[]` | Tells Claude what it *could not* see. |
| Every click | `event{t, kind:"click", button, x, y, display, app{name, exe/bundleId}, window{title}, control{role, name, automationId/AXIdentifier, bounds, ancestry[], source:"uia"/"ax"/"ocr_guess"/"user_described"/"none"}, frame_before, frame_after}` | `none` and `ocr_guess` mark the degraded mode, so Claude knows the target came from pixels only. `user_described` is set when the user names the control in review or in the overlay. |
| Typing into a field | `event{kind:"text_input", control, value \| value_ref, value_class:"literal"/"parameter"/"redacted"}` | Values default to `literal` locally. Review can turn one into a parameter ("This varies") or redact it. Keystrokes are coalesced per field, never logged as a raw key stream. [I] |
| Copy and paste | `event{kind:"clipboard", from_step, to_step, value_ref}` | This is data lineage, and the most valuable automation signal. Clipboard *content* is kept only locally and is subject to redaction review. [I] |
| App or window switch | `event{kind:"focus", app, window}` | Feeds the "Applications used" list (PDD parity). |
| Annotation (box, arrow, highlight, freehand, callout, text) | `annotation{id, step_id, kind, geometry (normalised to the frame), target_control_ref?, number?, style}` | Vector data. The renderer composes it for humans, and Claude gets the geometry plus the control link. |
| Snap-to-control selection | `annotation.target_control_ref` → `control` record above | The strongest signal: "this exact button". |
| Comment card | `comment{id, step_id, anchor (annotation or control), text, voice_ref?, transcript?, tags[], prompt_id?}` | `prompt_id` links the comment to the question that produced it, so Claude can read it as Q&A. |
| Tag: Decision point | `comment.tags += "decision"`, `decision{criterion, options[]}` | The follow-up question fills `criterion` and `options`. |
| Tag: This varies | `tags += "varies"`, `parameter{name, example_value_ref, source_hint}` | Turns a literal into `{{ClientName}}` and similar placeholders. |
| Tag: Sensitive | `tags += "sensitive"`, `redaction{region, scope:["pixels","control_text","typed_values","transcript"]}` | Applied destructively at export. |
| Narration (continuous or push-to-talk) | `audio/narration.*` (local), `transcript.segments[{t0, t1, text, step_id?}]` | Whether raw audio is exported at all is an open question (section 12). The default proposal is transcript only. |
| Privacy Pause | `gap{t0, t1, reason:"user_paused", note?}` | Claude must know that something happened off the record. The review editor asks "What happened while paused?" (optional). |
| Prompt shown | `prompt{id, rule, step_id, asked_at, answer \| "skipped" \| "dismissed"}` | Skipped prompts become review gaps. |
| Prompt answers that classify the work (section 6.7) | `app.purpose`, `loop{unit:"client"/"row"/"document", step_ids[]}`, `exception{step_id, what_happens, what_to_do}`, `rule{step_id, text}` | Each is linked to the `prompt_id` that produced it. |
| Vanishing pen (pointing while talking, no pause) | `pointer{t, path, step_id, transcript_segment_ref}` | Lightweight. It tells Claude "this is what 'here' meant" in the narration. |
| Time spent in the Explain overlay | `step.explain_ms`, separate from `step.task_ms` | Keeps task-duration estimates honest. |
| Wrap-up card (section 6.8) | `process.next{text}` ("what happens after"), `process.failure_modes{text}` ("what can go wrong"), `recording.run_kind:"normal"/"unusual", run_note` | Feeds the PDD-style "exceptions" and "outputs" sections. |
| Review: rename, merge, split, delete, insert | `step{title, title_source:"template"/"user"/"ai", event_ids[]}`, `edit_log` (counts only, no deleted content) | Merges keep event lineage. A deleted step's content is gone, and only "n steps removed by user" survives. |
| Review: manual "off-screen" step | `step{kind:"manual", text}` | For example "phoned the client to confirm". |
| Export | `manifest{schema_version, recorder_version, os, locale, tz:"Africa/Johannesburg", reviewed_by_user:true, redaction_summary, gaps_open[]}` | `gaps_open` tells Claude where to be cautious. |

---

## 6. Flows and screens

### 6.1 First run: permission onboarding

**What is known about the OS side:**

- **macOS screen capture** needs the "Screen & System Audio Recording" privacy permission. Older macOS versions call it "Screen Recording" [S, Apple Mac help].
- **macOS Sequoia re-prompts** apps with screen-recording permission **monthly**. The dialog has "Allow For One Month" (15.0) or "Continue To Allow" (15.1 beta) and "Open System Settings". The prompt appears whenever an app uses a feature that needs the permission, and TidBITS says this "will seem entirely random" to most people (TidBITS, 2024-09-23) [P]. Apple reportedly reduced prompts in 15.1 for regularly used apps, crediting ScreenCaptureKit [S, MacRumors 2024-10-07]. **All this evidence is from 2024. Today is 2026-11-21, so current behaviour on macOS 26 is [SPIKE].**
- Apple recommends `SCContentSharingPicker` (the system picker). Some developers report the picker grants capture without the separate permission prompt, but that is anecdotal [S]. It may not fit continuous whole-screen recording. [SPIKE]
- **macOS global click capture** via a listen-only `CGEventTap` needs **Input Monitoring**. The NSEvent global monitor and non-listen-only taps need **Accessibility**, and Accessibility implies listen rights (Apple DTS forum answers) [S]. Revoking Accessibility while a tap is active can hang system input [S]. **Reading control info (AX API) needs Accessibility** [I, standard macOS behaviour; SPIKE]. Whether we need one permission or both depends on the capture stack. [SPIKE]
- **Microphone** prompts the user on both OSes. On Windows, desktop apps depend on "Let desktop apps access your microphone" under Settings > Privacy & security > Microphone, and Microsoft is testing per-app controls for desktop apps [S].
- **Windows** has no OS consent prompt for UI Automation, low-level mouse hooks or screen capture [I; SPIKE]. Windows Graphics Capture draws a yellow border, which apps can turn off via `IsBorderRequired` on newer builds, but another app can force it back on [S]. An unsigned installer will trigger SmartScreen [I], which makes code-signing a UX requirement, not just a security one.

**Design: a list of permission cards**

The onboarding reads a list of required permissions, provided by the capture lane per OS and version. It renders one card per permission. Order is chosen for trust: ask first for the permission whose purpose is most obvious.

```
+--------------------------------------------------------------------------------+
|  Set up Shadow                                                    Step 2 of 4   |
|                                                                                 |
|  Shadow needs a few permissions from your Mac. Everything stays on this        |
|  computer until YOU review it and choose to export.                            |
|                                                                                 |
|  [x] Microphone                         Granted                                 |
|      So you can talk through what you're doing. Optional.                      |
|                                                                                 |
|  [>] See your screen                    Waiting for you...                      |
|      So each step gets a picture. Shadow never records when the red dot        |
|      is off, and never sends anything anywhere on its own.                     |
|      +--------------------------------------------------------------+          |
|      |  [picture of the exact macOS dialog, with the right toggle   |          |
|      |   circled]  "Turn on Shadow, then come back here."           |          |
|      +--------------------------------------------------------------+          |
|      [ Open System Settings ]        Why does my Mac call this "recording"?    |
|                                                                                 |
|  [ ] Know which button you clicked      Not yet                                 |
|      So steps say "clicked Save in ProfSoft" instead of "clicked at 812,440".  |
|                                                                                 |
|  [ ] (Input Monitoring, only if the spike proves it's needed)                  |
|                                                                                 |
|  ---------------------------------------------------------------------------   |
|  Skip for now: Shadow works with less detail      [ Continue ] (enabled when    |
|                                                    required cards are green)   |
+--------------------------------------------------------------------------------+
```

**Card behaviour [I]:**

- Status is **polled live** (for example the `CGPreflight…` family on Mac [S]), so a card turns green the moment the user flips the toggle, with no "check again" button.
- If the OS needs a relaunch before a grant takes effect, the card says "Shadow needs to restart to finish. Your setup is saved." and offers a one-click relaunch that comes back to the same step. [SPIKE: which grants need it]
- Each card has a **"What we never do"** line (never record while paused, never upload, never read your passwords) and a link to a one-page plain-language privacy note.
- A picture of the *exact* system dialog removes most of the fear: the scary part is the unfamiliar wording ("bypass the system private window picker" is the jargon TidBITS calls out [P]).
- The **monthly re-prompt** gets its own card in-app. When Shadow detects the permission lapsed, it says "macOS asks every month whether Shadow can still see your screen. Choose **Continue to Allow**." This is shown *before* recording starts, never mid-recording. [I; SPIKE on macOS 26 wording]
- **Pre-permission priming evidence is mixed.** Practitioner reports say asking in context raises acceptance (Cluster: 67% to 89% by asking at the moment of need [S]). One controlled ATT study with 950 participants found a priming page *reduced* opt-in [S]. Design response: ask at the moment the user has just chosen to set up recording, explain the concrete benefit, and keep the primer one card, not a carousel. [I]
- **On Windows**, the onboarding is shorter: Microphone (if wanted), plus a check that the desktop-apps microphone toggle is on, with a deep link to the Settings page [S]. If an enterprise policy blocks the microphone, say "Your IT settings turn off microphones for apps. You can still type your comments."

**Practice run (strongly recommended) [I; NN/g recommends a short demo before asking people to think aloud [S]]:** a 45-second guided sandbox. Shadow opens a dummy "Invoice approval" window, the user clicks two buttons, presses the annotate hotkey once and types one comment. Then they see the resulting two-step review. This teaches the whole loop before real client data is on screen. It is skippable, and it is suggested again on the first real recording if skipped.

### 6.2 Starting a recording

```
+------------------------------------------------------------------------+
|  New walkthrough                                                   [x]  |
|                                                                         |
|  What's this process called? *                                          |
|  [ Record AFS signing date for lockdown                             ]   |
|                                                                         |
|  When it's done, what's true that wasn't before? *                      |
|  [ The lockdown register shows the signing date and both deadlines  ]   |
|    e.g. "The invoice is approved and filed", "The client has the letter"|
|                                                                         |
|  What usually starts it?  (optional)                                    |
|  ( An email arrives ) ( A client signs ) ( Month-end ) ( Someone asks ) |
|  ( A date/deadline )  ( Other... )                                      |
|  [ QuicklySign email: "document completed"                          ]   |
|                                                                         |
|  How often?  ( Daily ) ( Weekly ) ( Monthly ) ( Per client ) ( Rarely ) |
|                                                                         |
|  What to record:  (o) My whole screen   ( ) Only these apps... [v]      |
|  Talk while you work?  (o) Yes, I'll talk  ( ) Hold a key to talk       |
|                        ( ) No, I'll type comments                       |
|                                                                         |
|  Before you start: close anything you don't want in the recording.     |
|  You can pause any time, and nothing leaves this computer until you    |
|  review and export it.                                                  |
|                                                                         |
|                            [ Start in 3 seconds ]                       |
+------------------------------------------------------------------------+
```

- **"When it's done, what's true?"** is the most valuable single question. It gives Claude the process's success condition, which no competitor asks for. [I; the UiPath PDD has "Objectives" but no explicit done-state [P]]
- The trigger chips map to `process.trigger.kind`. An unanswered trigger is flagged in review, not blocked. [I]
- A 3-2-1 countdown with "Pause is Ctrl+Alt+P" (or whichever hotkey the spike picks) printed on the countdown. [I]
- "Only these apps" is the privacy-preserving default for users who are anxious about it. [SPIKE: whether per-app capture plus click capture is feasible in both stacks]

### 6.3 The always-visible HUD

**Compact (default), docked top-centre or wherever the user drags it:**

```
 +-------------------------------------------------------------------+
 | (*) 04:12 | Step 9 | [mic ||||] | [Explain Ctrl+Alt+E] [||] [Stop] |
 +-------------------------------------------------------------------+
   rec dot    steps     narration      annotate+hotkey  pause  stop
   + timer    so far    level/toggle   label shown
```

**Paused (the whole HUD turns amber, impossible to miss):**

```
 +-------------------------------------------------------------------+
 | ( || ) PAUSED, nothing is being recorded |  [ Resume ]  [ Stop ]  |
 +-------------------------------------------------------------------+
```

**With a prompt card attached (non-modal, slides out below the HUD):**

```
 +-------------------------------------------------------------------+
 | (*) 06:40 | Step 12 | [mic |||   ] | [ Explain ] [ || ] [ Stop ]   |
 +-------------------------------------------------------------------+
 | You copied a date from QuicklySign into AppSheet.                  |
 | Is it always the "completed" date, or could it be another one?     |
 |  ( Always this date )  ( It depends... )  [ say it ]   Skip  (8s)  |
 +-------------------------------------------------------------------+
```

**Behaviour [I]:**

- **It is excluded from capture.** The HUD never appears in frames (Snagit does this too [P]). See section 10 for the mechanism risk.
- **It moves out of the way.** If a click lands within about 40 px of the HUD's footprint, it slides to the other edge for that moment. Users can pin it.
- **It never steals focus.** Clicking the HUD must not change the focused app, otherwise the recording would capture a false "focus" event. [SPIKE: Electron focusable:false or a panel-style window]
- **"Explain" is the annotate action.** Label it "Explain", not "Annotate", for this audience.
- **"Stop" asks for confirmation.** "Finish this walkthrough? You can still review and fix everything." This prevents accidental stops. Stop has no global hotkey by default.
- **The narration meter** shows the mic is live. Clicking it toggles the mic, not the recording.
- **It stays on top** of full-screen apps and remote-desktop windows. [SPIKE on Citrix Workspace and RDP full-screen on Windows]
- **It is always reachable.** A menu-bar or tray icon mirrors the HUD state, in case the HUD is hidden behind a full-screen game-mode app.

### 6.4 Global hotkeys

Hotkeys are **candidates for the spike**, not a claim that they are free.

| Action | Windows candidate | macOS candidate | Conflicts to check in the spike |
|---|---|---|---|
| Explain (freeze and annotate) | Ctrl+Alt+E | Ctrl+Option+E | AltGr = Ctrl+Alt on many non-US layouts (AltGr+E is € on several), so test with the Afrikaans and South African keyboard layouts. Check Outlook, Excel, ProfSoft and Caseware shortcut lists. [I] |
| Pause / resume | Ctrl+Alt+P | Ctrl+Option+P | Loom uses Alt+Shift+P / Option+Shift+P [S]. Avoid colliding with Loom where staff also use it. [I] |
| Quick mark (tag "decision" without pausing) | Ctrl+Alt+D | Ctrl+Option+D | Same AltGr concern. |
| Push-to-talk (hold) | Right Ctrl (hold) or user-chosen | Right Option (hold) or user-chosen | Hold-detection needs a key-state hook. [SPIKE] |
| Comment mode inside the overlay (local, not global) | C | C | Figma's convention [S]. Only active while the overlay is open. |
| Close overlay / cancel tool (local) | Esc | Esc | n/a |

**Rules [I]:**

- Avoid anything that collides with OS screenshot keys. Win+Shift+S and Win+Shift+R belong to Snipping Tool [S]. Cmd+Shift+3, 4 and 5 belong to the macOS Screenshot toolbar [S].
- Avoid Ctrl+Shift+Space. In Excel it selects the current region or whole sheet [I, verify], and accountants live in Excel.
- Avoid Ctrl+Space and Ctrl+Option+Space on Mac. These are the defaults for switching input source [I, verify].
- On registration failure (the hotkey is already taken), say so on the HUD and let the user pick another in one click. Electron's `globalShortcut.register` and Win32 `RegisterHotKey` both report failure [I, SPIKE].
- **In remote sessions** (Citrix or RDP in focus or full screen), keystrokes may be forwarded to the remote machine and never reach our hook. **The HUD button must always work as the fallback**, and the onboarding should say so for users of remote apps. [I; SPIKE]
- **Hardware option (later):** a USB foot pedal or one-button keypad mapped to "Explain". This is useful for heavy users and costs nothing to support if hotkeys can be remapped. [I]

### 6.5 The annotation overlay (pause-and-explain)

Pressing **Explain** (hotkey or HUD) does four things:

1. Freezes the current frame (the screenshot at the instant of the press, plus the last click's control info).
2. Pauses the timeline. Wall-clock time spent explaining is recorded separately from task time, so durations stay honest.
3. Opens the overlay over all displays, dimmed by about 15% so the user knows they are not in the live app.
4. Arms **Snap** as the active tool.

```
+==========================================================================================+
| Explaining step 12: this is a still picture. Your clicks here don't reach your apps.     |
| (Your apps keep running in the background, so log-in timeouts still count down.)         |
|  [Snap] [Box] [Arrow] [Highlighter] [Pen] [1-2-3] [Text] [Redact]  |  [Done (Esc)]      |
+==========================================================================================+
|                                                                                          |
|   AppSheet - Lockdown capture form                                                       |
|   +------------------------------------------------------------------+                   |
|   | Client     [ Acme Trading (Pty) Ltd        ]   <- (hover: "Text  |                   |
|   |                                                    field: Client")|                   |
|   | Engagement [ Audit FY2026                  ]                      |                   |
|   | Signed on  [ 2026-11-12 ]                                         |                   |
|   |            .==========.                                           |                   |
|   |            | snapped  |  <- solid outline = real control found    |                   |
|   |            '=========='     "Date field: Signed on (AppSheet)"    |                   |
|   |                  \                                                |                   |
|   |                   \  (1)                                          |                   |
|   |                    +---------------------------------------+      |                   |
|   |                    | (1) Comment on "Signed on"            |      |                   |
|   |                    | [ This must be the date the CLIENT    ]|     |                   |
|   |                    | [ signed, not when we sent it.       ]|      |                   |
|   |                    | [mic  Hold to record a voice note ]   |      |                   |
|   |                    | Tags: [Decision point] [This varies]  |      |                   |
|   |                    |       [Sensitive]                     |      |                   |
|   |                    | Follow-up (because "This varies"):    |      |                   |
|   |                    |  What makes it change?                |      |                   |
|   |                    | [ Different date per client          ]|      |                   |
|   |                    |                     [Delete] [Save]   |      |                   |
|   |                    +---------------------------------------+      |                   |
|   | [ Submit ]                                                        |                   |
|   +------------------------------------------------------------------+                   |
|                                                                                          |
+------------------------------------------------------------------------------------------+
| Tip: hover a button or field to outline it, then click it to comment.  Esc = done        |
+------------------------------------------------------------------------------------------+
```

**Tools [I unless marked]:**

| Tool | Behaviour | Package |
|---|---|---|
| **Snap** (default) | Hover draws a solid outline around the deepest meaningful control under the cursor, with a label: role, name and app. Scroll wheel or [ and ] walk up and down the control tree (field, then group, then panel). Click selects it and opens a comment card anchored to it. | `annotation{kind:"control"}`, `target_control_ref` |
| **Box** | Drag a rectangle. If it closely matches a control's bounds, offer "Snap to Signed on?" | `kind:"box"` |
| **Arrow** | Drag from tail to head. The head end auto-snaps to a control if one is within a few px. | `kind:"arrow"` |
| **Highlighter** | Translucent marker, the Snipping Tool idiom [S]. Good for "this column". | `kind:"highlight"` |
| **Pen** | Freehand. Keep it, because some people think with a pen. | `kind:"freehand"` |
| **1-2-3** | Numbered callouts in click order, like the Snagit Step tool and the CleanShot counter [S]. Each number can carry its own comment. Used for "fill these in this order". | `kind:"callout", number` |
| **Text** | A plain text label on the canvas, for quick notes. Comment cards are preferred because they carry tags. | `kind:"text"` |
| **Redact** | Drag over a region. It immediately looks blurred (secure, non-reversible style, as with CleanShot's secure blur [S]). It also offers "Redact this everywhere it appears in this walkthrough" (Tango's batch idea [S]). | `redaction{…}` |

**The comment card:**

- Text box, auto-focused. Typing starts immediately.
- **Voice note:** hold the button (or the push-to-talk key) to record. It is transcribed on the device into the same box, so the user can correct it [I; SPIKE on local speech-to-text quality for South African English].
- **Tags (exactly three in the card, each with a follow-up):**

  | Tag | Follow-up question (one line, optional) | Why Claude needs it |
  |---|---|---|
  | **Decision point** | "What decides which way you go? What are the options?" | Turns a linear recording into a branch with a criterion. |
  | **This varies** | "What makes it change?" and "What should we call it?" (pre-filled, e.g. "Signing date") | Turns literals into parameters, so an automation is not hard-coded to one client. |
  | **Sensitive** | none. Shows "Will be hidden in the export" and applies Redact to the anchored region and value. | Privacy, and it tells Claude the value exists without revealing it. |

- **Secondary tags** sit behind a "More" chip so the card stays simple: *Check / rule* ("I'm checking that X matches Y"), *Problem / workaround*, *Waiting / hand-off*, *I'm not sure why we do this* (Zoom's "?" stamp idea [S]). The last one is gold for process improvement. [I]

**Degraded mode (control info unavailable) [S for the Citrix behaviour; I for design]:**

UiPath and Power Automate both need an agent installed *inside* the Citrix session to see controls, and Power Automate falls back to image recognition and OCR when logical elements are inaccessible [S]. We will not have an agent inside Citrix. When the hover target is a remote-session window, a canvas, or returns no control:

```
   +----------------------------------------------------------+
   | ( i ) This window is a remote screen (Citrix/Remote       |
   |       Desktop). Shadow can't see its buttons, only the    |
   |       picture.                                            |
   |       Draw a box around what you clicked and tell me      |
   |       what it is:  [ e.g. "Save button"              ]    |
   +----------------------------------------------------------+
```

- The hover outline switches from **solid** (real control) to **dashed** (the user must draw it). The legend is always visible in the overlay footer.
- During recording, clicks in such windows get an on-device OCR "nearest label" guess, stored as `control.source:"ocr_guess"` and always shown in review as a guess for the user to confirm. It is never presented as a known control. [I; SPIKE on OCR availability: Windows has OCR APIs, macOS Vision]
- Review flags every step whose control is unknown and not described.

**Freeze vs live overlay [I]:** a live overlay (drawing over the moving app) is what Loom and Zoom do for presenting. For process capture, a frozen frame is better for three reasons. The screen state is exactly what the step needs. The user can take their time. And there is no risk of clicks passing through to ProfSoft. Offer a **vanishing pen** (Loom fades marks after 5 s [P]; Zoom has the same idea [S]) as a non-pausing "point at this while I talk" gesture, stored as a lightweight `pointer` event linked to the narration timestamp.

### 6.6 Think-aloud narration

- **Three modes,** chosen at start and switchable on the HUD: **Talk freely** (continuous mic), **Hold to talk**, **Type only**. [I]
- **Evidence:** NN/g calls thinking aloud a very valuable method, but most people need occasional prompting to keep talking. Prompts must be neutral or they change behaviour, and a short demo helps people start [S]. Practitioner guidance for when someone falls silent is a gentle "What are you thinking now?" [S].
- **Design [I]:**
  - In **Talk freely** mode, after about 25 to 40 seconds of silence *while actions continue*, show a tiny, silent HUD hint (no sound, no card): "Say what you're looking for?" It disappears on the next word. At most one hint every 2 minutes, and no hint while the user is reading a document (dwell with no input; see the prompts below).
  - Live captions in the HUD are **off by default**, because they distract. A small "words heard" counter can reassure users that the mic works.
  - Transcription runs on the device. Raw audio stays local unless the export option to include it is chosen (open question).
  - **Silence and filler trimming** happens in the review editor's transcript, with Loom-style trimming done on the device [S for the Loom feature].
  - **Language:** English first. Recognise Afrikaans and code-switching later. [SPIKE: local speech-to-text quality on South African accents, open question]

### 6.7 Moment-of-action prompts (the "right question at the right moment" engine)

These are on-device rules, evaluated against the event stream. Each prompt is one sentence, names what just happened, and offers two or three one-tap chips plus "say it" and "Skip". **Budget:** at most 1 prompt per 60 to 90 seconds, at most about 8 per 10-minute recording, never while a text field has focus and keys are being pressed, never in the first 20 seconds. **Adaptive:** two consecutive skips halve the rate, and three disable prompts for the session with a toast ("Prompts off. You can add context in review."). [I]

| Rule (trigger) | Prompt text (example) | Chips | Package target |
|---|---|---|---|
| First click in an app not seen before in this recording | "What do you use **ProfSoft** for in this process?" | Look something up / Enter data / Check something / Other | `comment` on the step, `app.purpose` |
| Copy in app A, then paste in app B | "You copied a value from **QuicklySign** into **AppSheet**. Is it always taken from there?" | Always / It depends... / Say why | `clipboard` lineage, `decision`, `parameter` |
| Value typed into a field (not a search box) | "Is **Signed on** always filled in like this, or does it change each time?" | Always the same / Changes each time / From somewhere else | `value_class`, `parameter.source_hint` |
| Dwell of 20 s or more on one screen with no input | "Looking for something? What are you checking?" | I'm reading / I'm checking a rule / Waiting for it to load | `comment{tags:["check"]}` |
| Switch to Outlook or Teams in the middle of a process | "Is this a hand-off to someone else, or part of the same job?" | Hand-off / Same job / Just checking mail (removes these steps) | `tags:["handoff"]`, or step deletion suggestion |
| The same 3+ step sequence repeated | "Looks like you're repeating this. Do you do it once per **client / row / document**?" | Per client / Per row / Per document / Just this time | `loop{unit}` |
| Undo, Back or Cancel shortly after an action | "Did something go wrong there? What do you do when that happens?" | Yes, here's what I do / Just a misclick (merge away) | `exception{…}` |
| A Save or file dialog | "Is there a rule for where this goes or what it's called?" | Yes, the rule is... / No | `rule` |
| A dropdown or radio choice | "How do you decide which option to pick?" | Always this one / It depends on... | `decision{criterion}` |
| An error dialog appears (title or role "alert") | "What does this message mean, and what do you do about it?" | (free text or voice) | `exception` |

**Why these questions [I, grounded in section 8]:** they map directly to what an automation builder must otherwise interview for: inputs and their sources, business rules, decision criteria, loops, exceptions and hand-offs. The UiPath default PDD's text names sections for exception handling and applications used. It does not name inputs, rules or triggers, although its overview table (shown only as an image) may hold some of them [P]. Even where a PDD has a field for this, a business analyst fills it in afterwards. These prompts collect it at the moment it happens.

### 6.8 Ending a recording

After **Stop** and confirmation, a 3-question **wrap-up card** appears. All questions are optional, voice or text, and each can be skipped. [I]

```
+-------------------------------------------------------------------------+
|  Nice, 23 steps captured in 7m 40s.  Three quick questions (optional):   |
|                                                                          |
|  1. What happens after this? Who or what picks it up?                    |
|     [ Partner reviews the lockdown list on Fridays                   ]   |
|                                                                          |
|  2. What can go wrong, and what do you do then?                         |
|     [ Sometimes the pack isn't an AFS; then I don't log it          ]   |
|                                                                          |
|  3. Was this a normal run, or was anything unusual today?               |
|     ( Normal )  ( Unusual: ______ )                                      |
|                                                                          |
|           [ Skip ]                       [ Review my steps -> ]          |
+-------------------------------------------------------------------------+
```

Question 3 matters. Claude must know whether it saw the happy path or an exception path. [I]

Recordings auto-save continuously (crash-safe). A recording that is closed without review shows up on the home screen as "Not reviewed yet", with nothing exported. [I]

### 6.9 The review editor

#### 6.9.1 Layout

```
+=====================================================================================================+
| < Back   Record AFS signing date for lockdown            23 steps  7:40   Ready to hand over: 4 open |
+=====================================================================================================+
| STEPS (timeline)         |  STEP 12 OF 23                                    | DETAILS                 |
|--------------------------|                                                   |-------------------------|
| [thumb] 1 Open Outlook   |  +---------------------------------------------+  | Title                   |
|         email "Doc..."   |  |                                             |  | [Type the signing date  |
| [thumb] 2 Click link in  |  |   AppSheet - Lockdown capture form          |  |  into "Signed on"]      |
|         email            |  |                                             |  |  (suggested: Type in    |
| [thumb] 3 Click Download |  |   Client     [ ######## blurred ####### ]   |  |   "Signed on" in        |
|  ...                     |  |   Engagement [ Audit FY2026            ]    |  |   AppSheet)             |
| ! [thumb] 9 Click (no    |  |   Signed on  [ {{SigningDate}} ]  (1)       |  |                         |
|         label) in        |  |              '===========' <---------       |  | What happened           |
|         Citrix window    |  |   [ Submit ]                                |  |  Typed "2026-11-12"     |
| [thumb] 10 Copy date     |  |                                             |  |  -> parameter           |
| [thumb] 11 Switch to     |  +---------------------------------------------+  |  {{SigningDate}}        |
|         AppSheet         |  [ Snap ][ Box ][ Arrow ][ Hi ][ Pen ][123][Redact] |  Control: Date field    |
| >[thumb] 12 Type signing |                                                   |  "Signed on" (AppSheet) |
|         date        (1)D |  Narration (00:06:31-00:06:44)                    |                         |
| ! [thumb] 13 Choose      |  "...and this has to be the date the client        | Tags  [Decision][Varies]|
|         "Audit" from     |   actually signed, not when we sent it..."        |       [Sensitive][More] |
|         dropdown         |   [ Play ]  [ Edit text ]                         |                         |
|  ...                     |                                                   | Comments (1)            |
| [+ Add a step I did off  |  [ < Prev ]   [ Merge with next ]   [ Split ]       |  (1) "Must be the date  |
|   screen]                |  [ Delete step ]                       [ Next > ] |   the CLIENT signed..." |
|--------------------------|                                                   |  Varies: different per  |
| Filters: (All) (Flagged) |                                                   |  client                 |
|  (Sensitive) (Decisions) |                                                   |                         |
+--------------------------+---------------------------------------------------+-------------------------+
| READY TO HAND OVER                                                                                   |
|  ! 2 steps: you clicked but didn't say why (9, 13)   [Fix]    ! 1 click in a remote window has no     |
|  ! 1 possible ID number not redacted (step 4)        [Review]   description (9)          [Describe]   |
|  ok Goal  ok Trigger  ok What happens next  -- Frequency (optional)             [ Export... ]         |
+=====================================================================================================+
```

#### 6.9.2 Step operations [I]

| Operation | Behaviour |
|---|---|
| **Edit title / description** | Inline. The on-device suggestion shows in grey until the user accepts or overwrites it. |
| **Merge** | Select 2 or more adjacent steps, then "Merge". Use it for "fill in this form" (5 clicks become 1 step with sub-actions). Event lineage is kept, and the thumbnail is the last frame. Suggested automatically when there are consecutive clicks in one form within a few seconds. |
| **Split** | Split a step at an event boundary, for example a long "typing" step that really hit two fields. |
| **Delete** | Removes the step and its frames, transcript segment and clipboard values. A clear undo toast. A wrong-turn detection suggests deletes for "misclick then undo" pairs. |
| **Reorder** | **Not offered by default.** A recording's order *is* data, and reordering silently falsifies the process. Offer "Move" only in an "edit as instructions" mode, with a warning. |
| **Insert manual step** | "Add a step I did off screen": phone call, paper file, asking a colleague. Text and optional voice. |
| **Redact** | Same tool as in the overlay, plus a **Privacy sweep** (below). |
| **Re-annotate** | All overlay tools are available on any step's frame. |

#### 6.9.3 Privacy sweep (before export, required pass) [I]

A dedicated pass lists every candidate sensitive item, detected **on the device**:

- Emails and phone numbers (Snipping Tool's Quick redact covers these [S]).
- **South African ID numbers.** 13 digits with a Luhn check digit [I, verify the format in the spike].
- Bank account numbers, income tax and VAT reference numbers.
- Names that match the client field.
- Anything the user tagged Sensitive.
- Typed values, clipboard contents and window titles that contain any of the above.

Each item shows its location (step, region or transcript), a checkbox, and "redact everywhere". The user cannot export until the sweep has been *opened* once (not necessarily acted on). The manifest records `reviewed_by_user:true` and redaction counts. Scribe's seven Smart Blur categories (emails, numbers, common names, long text, form fields, table rows, images) [P] are a good template for the category toggles.

#### 6.9.4 Step titles and gap flags: on the device before export, Claude after

The assignment asks for "AI-suggested step titles" and "gaps flagged" in the review editor. The fixed owner decision is that Claude processing runs only on the exported, reviewed package. **This research resolves the conflict as follows [I]; the planner should confirm it (open question 1):**

- **Before export (in the review editor), on the device and rule-based:**
  - **Titles:** a template from action, control and app. `click` + Button "Save" + ProfSoft gives **"Click Save in ProfSoft"**. `text_input` + "Signed on" + AppSheet gives **"Type the signing date in 'Signed on'"** (using the parameter name if set). `focus` gives "Switch to Outlook". Merged steps become "Fill in the Lockdown capture form (5 fields)". If the control is unknown: "Click in [window title]: describe this".
  - **Gap flags** are deterministic rules:
    - "You clicked here but didn't say why": a click with no narration within ±8 s, no comment, and no answered prompt, on a step that is not trivially obvious (not a focus change, not a scroll).
    - Unanswered skipped prompts.
    - Unknown-control steps without a description.
    - "Decision point" tags missing a criterion.
    - "This varies" missing a name.
    - Pause gaps without a note.
    - A missing goal, trigger or "what happens next".
  - **Optional local model (later, if the device can run it):** a small on-device language model could polish titles. That keeps local-first intact, but it is out of scope for v1. [I]
- **After export (Superbrain side):** Claude reads the package, writes the process spec, *and* writes back proposed titles and a list of questions it still has. The next version can offer a "Claude's questions for you" round-trip, where the user answers on the device and re-exports. This keeps the boundary clean: nothing leaves the device unreviewed. [I]

#### 6.9.5 "Ready to hand over" checklist rather than a score [I]

A readiness *score* invites gaming and anxiety. A checklist of named, fixable items, each with a [Fix] button that jumps to the step, is more honest and faster. Export is never blocked by gaps, only by the unopened privacy sweep. Open gaps are written into `manifest.gaps_open` so Claude knows where it is guessing.

### 6.10 Export

```
+-----------------------------------------------------------------------------+
|  Export walkthrough                                                          |
|                                                                              |
|  This is everything that will be in the package. Nothing else leaves.        |
|                                                                              |
|   23 steps   41 pictures   1 transcript (no audio)   6 comments   2 decisions|
|   12 values redacted   3 named values ({{SigningDate}}, {{ClientName}}, ...) |
|   Open gaps: 1 (step 9 click in remote window not described)                 |
|                                                                              |
|   [x] Include narration transcript                                           |
|   [ ] Include original audio  (bigger, contains your voice)                  |
|   [x] Include pictures of each step (redactions are permanent in the export) |
|                                                                              |
|   Preview: [ How Claude will read it ]  [ How a person will read it ]        |
|                                                                              |
|   Save to:  [ ~/Documents/Shadow/Record AFS signing date ... ]  [Change]     |
|                                                                              |
|   ! Redactions are burned in: the export does not contain what's underneath. |
|     Your original recording stays on this computer until you delete it.      |
|     [ Delete the original after export ]                                     |
|                                                                              |
|                                 [ Cancel ]   [ Export package ]              |
+-----------------------------------------------------------------------------+
```

- **"How Claude will read it"** renders the generated `PROCESS.md` (the core lane's output) read-only. Seeing the text Claude will receive is the strongest trust builder and the best last-chance error catcher. [I]
- **A destination abstraction:** v1 saves to a folder. Later versions add "Send to Superbrain" (upload after review), which must show the same summary screen. [I]
- **After export,** offer "Delete the original recording" and an auto-delete policy (for example after 30 days), because POPIA favours minimising retention. [I; legal review needed]

---

## 7. What makes users love it, and what makes them abandon it

### 7.1 Love [I unless marked]

1. **The output is better than what they would write.** The first export of a 10-minute task produces a clean, numbered, illustrated procedure with their own words attached. Users immediately want to send it to a junior colleague. (This is the core pitch of Scribe and Tango [S]. I found no adoption data to confirm it works.)
2. **It feels like explaining to a colleague, not filling in a form.** Voice-first comments plus moment-specific questions are what job shadowing feels like.
3. **Privacy they can see.** An amber "PAUSED" HUD, a privacy sweep and "here is exactly what leaves". For an IRBA firm, this is what lets them say yes at all.
4. **Zero setup on Windows.** Install, then record. On a Mac, a permission flow that *feels* guided.
5. **Fast fixes.** Merge-suggestions and one-click fixes in the readiness checklist mean the review takes a few minutes, not half an hour.
6. **They see the payoff.** A later Superbrain loop shows "your walkthrough became this automation". The closing of that loop is what makes people record the second process. [I; product-loop design is outside this lane]

### 7.2 Abandon [I unless marked]

| Abandonment cause | Mitigation in this design |
|---|---|
| The permission flow scares them or fails silently, especially on a Mac | Picture-led cards, live status, a relaunch handler, plain-language "never" lines (6.1) |
| The monthly macOS re-prompt looks like malware or a breach | Pre-emptive in-app explanation before recording starts [P TidBITS on how confusing the prompt is] |
| Prompts nag mid-task | Hard budget, adaptive back-off, never while typing (6.7) |
| The HUD gets in the way, or its clicks register as process steps | Dodge behaviour, non-activating window, excluded from capture [SPIKE] |
| Recording slows the PC (old office laptops) | Event-driven frames (capture on click and on change, not 30 fps video), performance budget. Snagit warns past 50 or 100 steps [P]. [SPIKE] |
| Review takes as long as the task | Auto-merge suggestions, gap list, sensible defaults |
| Fear of being judged ("my way is wrong") | Copy frames the user as the expert: "Teach Superbrain how you do this". The "I'm not sure why we do this" tag normalises uncertainty. |
| Client data might leak | Local-first, privacy sweep, burn-in redaction, delete-original option |
| It doesn't work in ProfSoft over Citrix | Honest degraded mode (6.5) and a description prompt |
| A lost recording after a crash | Continuous autosave, "Resume recording" |

---

## 8. Making comments high-signal for Claude

### 8.1 What an automation builder needs and where Shadow captures it

The UiPath default PDD [P] gives the baseline an automation team works from. The middle column marks what its text names. "Not named" means the page text does not mention it, but the "Process overview" table is an image whose rows I could not read, so it may contain the item. The right column shows how Shadow captures each item.

| Needed to automate | In the UiPath default PDD? [P] | How Shadow captures it [I] |
|---|---|---|
| Purpose and goal (done-state) | Purpose and Objectives (no explicit done-state) | Start sheet: "When it's done, what's true?" (required) |
| Trigger | Not named | Start-sheet chips and text |
| Frequency and volume | Not named (statistics section only) | Start-sheet chips, loop detection ("per client / per row") |
| Applications used | Yes (auto list) | Focus events, auto list |
| Detailed steps with action type and screenshot | Yes | Click and type events with control identity (stronger than a screenshot) |
| Inputs and where each value comes from | Not named | Copy-and-paste lineage, "This varies" parameters, "where does this come from?" prompts |
| Business rules and checks | Not named | "Check / rule" tag, dwell prompt, Save-dialog rule prompt |
| Decisions and criteria | Diagram decisions, drawn by hand | "Decision point" tag plus criterion follow-up, dropdown prompt |
| Exceptions and what to do | Business exception and application error sections | Undo/back and error-dialog prompts, wrap-up question 2 |
| Hand-offs and outputs | Partially (To-Be reporting) | Switch-to-email prompt, wrap-up question 1 |
| Happy path vs unusual run | Not named | Wrap-up question 3 |
| What the recorder could not see | Not named | `gap` records, `control.source`, `manifest.gaps_open` |

### 8.2 Prompt-writing rules [I]

1. **Name the concrete thing.** Say "Is **Signed on** always filled in like this?", not "Can you explain this step?". Specific prompts get specific answers.
2. **Ask about the rule, not the action.** Claude already knows *what* was clicked from the control data. Prompts ask *why*, *when*, *where from* and *what if*.
3. **Offer chips that encode the answer type.** "Always / It depends / From somewhere else" lets a one-tap answer still classify the value as constant, conditional or derived.
4. **An "It depends..." chip always opens a follow-up:** "Depends on what?" Conditionals are the most valuable sentences in the package.
5. **Keep question frames neutral,** per NN/g's warning that untrained prompting can change behaviour [S]. Never suggest the "right" answer.
6. **Coach templates in the comment box placeholder,** rotating:
   - "If ___, then I ___"
   - "I check that ___ matches ___"
   - "This comes from ___"
   - "We do this because ___"
   - "If this fails, I ___"

### 8.3 What a high-signal comment looks like (examples for onboarding copy) [I]

| Low signal | High signal |
|---|---|
| "Enter the date here." | "Enter the date the **client signed**, from the QuicklySign 'completed' email, **not** the date we sent it." |
| "Pick the type." | "If it's an audit, review or compilation, choose it and log it. **Anything else, we don't track: stop here.**" |
| "Save." | "Save as `ClientCode_FY_AFS-signed.pdf` in the engagement's **Correspondence** folder." |

---

## 9. Accessibility and localisation [I]

- **Keyboard-only path** for every action. The overlay supports Tab through controls, Enter to select, and arrow keys to walk the control tree.
- **Colour-blind safe palette.** Solid vs dashed outlines carry meaning, not colour alone. Highlights have about 40% opacity plus an outline.
- **Respect OS text scaling and high contrast.** HUD minimum 13 px text, with 32 px hit targets.
- **Locale:** South African English spelling in the UI. Dates in the UI follow the OS locale. The package stores ISO 8601 with offset and `Africa/Johannesburg` (SAST, UTC+2, BRIEF.md §2).
- **Language:** English first. Afrikaans UI is optional later. Transcription language detection is [SPIKE].

---

## 10. Technical UX dependencies the spike must settle

| # | Question | Why UX depends on it | Evidence so far |
|---|---|---|---|
| 1 | Can our HUD, overlay and prompt cards be **excluded from captured frames** on both OSes? | Principle 7. If not, we must hide the HUD at each capture instant (flicker) or crop it out. | macOS: Electron `setContentProtection` sets `NSWindowSharingNone`, but ScreenCaptureKit still captures such windows on 15.4+, and there is no public API to prevent capture [S]. ScreenCaptureKit's `SCContentFilter` can exclude specific apps or windows from a display capture [I, from API knowledge; the Apple doc page did not render]. Windows: `WDA_EXCLUDEFROMCAPTURE` via `SetWindowDisplayAffinity` on Windows 10 2004+ [S]. **SPIKE** |
| 2 | Exactly which macOS permissions does click capture plus control lookup need, and does the monthly re-prompt still apply on macOS 26? | Drives the permission card list. | Input Monitoring for a listen-only tap, Accessibility for AX [S]. Monthly re-prompt documented for Sequoia in 2024 [P]. **SPIKE** |
| 3 | Can the HUD be clicked **without stealing focus** from the recorded app? | Prevents false focus events and broken steps. | **SPIKE** |
| 4 | Do UI Automation and AX return usable names for ProfSoft, Caseware, AppSheet in Chrome/Edge, Outlook and Excel? | Snap quality, title quality. | Unknown. **SPIKE**, using a test process per app. |
| 5 | What happens inside Citrix/RDP windows: control info, hotkeys, HUD on top? | Degraded mode frequency. | Vendors need in-session agents for control access [S]. **SPIKE** |
| 6 | Local speech-to-text quality and speed on typical office laptops with South African English | Voice notes and narration viability. | **SPIKE** |
| 7 | Windows capture border: visible or not on Win11? | A yellow border may alarm users, or reassure them. | `IsBorderRequired` exists, but other apps can force the border on [S]. **SPIKE** |
| 8 | Performance: frame capture on every click plus on screen change, on a low-end laptop | Abandonment risk. | **SPIKE** |

---

## 11. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| macOS permission flow fails or confuses users, and they abandon at setup | High | Data-driven cards with dialog pictures, live status polling, relaunch handling, practice run. Usability test with 5 Mac users before rollout. |
| Snap-to-control is mostly unavailable because ProfSoft runs over Citrix/RDP | High | Treat degraded mode as first-class: freeform tools, description prompt, OCR guess clearly labelled. Confirm ProfSoft's access mode with Moore early (open question). |
| Our own HUD or overlay appears in captured frames on macOS | High | Spike item 10.1. Fallbacks are an `SCContentFilter` exclusion, or hide-then-capture with crop. |
| Client personal data exported unredacted (POPIA, IRBA confidentiality) | High | Required privacy sweep, on-device detectors including SA ID numbers, burn-in redaction that covers text and transcript too, export preview, delete-original option. |
| Prompts feel like nagging and users disable them, so comment signal collapses | Medium | Hard budget, adaptive back-off, chips for one-tap answers, review-time catch-up. Measure the prompt answer rate in the pilot. |
| AI titles in the review editor would breach the local-first decision if built with Claude | Medium | Rule-based titles on the device. Claude titles only after export. Planner to confirm (open question 1). |
| Hotkeys collide with Excel, Outlook, AltGr layouts or remote sessions | Medium | Configurable keys, failure detection at registration, the HUD button always works, layout testing in the spike. |
| Recording slows old laptops | Medium | Event-driven capture, not continuous video. Performance budget tested in the spike. |
| Users reorder or delete steps in a way that falsifies the process | Low-Medium | No reorder by default. An edit log keeps counts. Merges keep lineage. |
| A monthly macOS re-prompt mid-recording looks like a security incident | Medium | Detect the lapsed permission before start and explain it in-app. [SPIKE on macOS 26 behaviour] |
| Voice transcription is poor for local accents | Medium | Text is always editable. Type-only mode. Transcript correction in review. |

---

## 12. Open questions

1. **Local-first vs "AI-suggested step titles":** is the proposed resolution acceptable? That is, rule-based titles and gap flags on the device, Claude titles and questions only after export, and an optional round-trip "Claude's questions for you" later.
2. **Is raw audio ever exported,** or only the reviewed transcript? (Default proposal: transcript only, audio opt-in.)
3. **ProfSoft access mode at Moore:** thick client, browser or Citrix/RDP? This decides how often degraded mode is the main mode.
4. **Retention:** how long do originals stay on the device by default, and does Moore's IT require central wiping or MDM controls?
5. **Where does an export go in v1?** A local folder only, or also a Superbrain upload behind the same review screen?
6. **Do Moore staff use Loom, Snagit or Scribe today?** This affects the hotkey and terminology choices and migration expectations.
7. **Who is the first recorder cohort,** admin staff or seniors? This affects the prompt budget and tone.
8. **Product name:** "Shadow" vs "Handover" vs keeping "Workflow Recording Assistant". A trademark check is needed.
9. **Is an Afrikaans UI or Afrikaans transcription needed for v1?**
10. **Can Moore provide 5 pilot users** (at least 2 on Mac) for a moderated usability session on the onboarding and the first recording?

---

## 13. Recommendations for the lane plan

1. **Overlay + narration lane:** owns the HUD, overlay tools, comment card, tags and follow-ups, the prompt engine (as a pure rules module over the event stream, unit-testable with recorded event fixtures), and narration modes. Acceptance check: a scripted event fixture produces the expected prompts within budget, and a manual test shows annotations stored as vector JSON linked to a control.
2. **Review/export lane:** owns the timeline, step operations, privacy sweep with detectors (unit-test the SA ID, email, phone and bank-number detectors with synthetic data), on-device titles and gap rules, the readiness checklist, the export preview and burn-in redaction. Acceptance check: an exported package contains no pixels, text or transcript words from redacted regions (a test greps the package for the redacted literals).
3. **Core lane:** adopt the action-to-field table (section 5) as the input to the schema, especially `control.source`, `gap`, `parameter`, `decision`, `prompt` and `manifest.gaps_open`.
4. **Capture lane:** produce the permission list that drives the onboarding cards, and answer spike items 10.1 to 10.5.
5. **Spike:** add the eight items in section 10 to the spike's acceptance list, especially HUD exclusion from capture, the macOS 26 permission set and re-prompt behaviour, and Citrix behaviour.
6. **Usability check before broad rollout:** 5 Moore users (at least 2 on Mac), each records the lockdown-date process. Measure:
   - time to first successful recording;
   - permission completion without help;
   - prompts answered vs skipped;
   - gaps open at export;
   - whether a fresh Claude rebuilds the steps (lane acceptance item 4).
7. **Copy deck:** write all user-facing strings in one file so a non-technical reviewer can check the tone ("Explain", "Walkthrough", "Steps", "Redact") before the build freezes.

---

## 14. Sources

All accessed 2026-11-21. Evidence tag as in section 0. The publish date is given where the page states one.

**Opened primary pages [P]:**

- Loom, "Use the drawing tool", Atlassian Support. No feature date shown. https://support.atlassian.com/loom/docs/use-the-drawing-tool/
- Microsoft Learn, "Security and privacy - Power Automate (process mining)", ms.date 2023-07-18, updated 2026-10-29. https://learn.microsoft.com/en-us/power-automate/process-advisor-security
- Scribe, "Smart Blur", dated 2026-09-04. https://scribe.com/library/smart-blur
- Microsoft Support, "Steps Recorder deprecation" (banner from the February 2024 Windows 11 update). https://support.microsoft.com/en-us/windows/steps-recorder-deprecation-a64888d7-8482-4965-8ce3-25fb004e975f
- TechSmith, "Document a Process or Workflow Automatically (Step Capture)". Version notes up to Snagit Windows 2026.1.0 and Mac 2025.3.0. https://www.techsmith.com/learn/tutorials/snagit/step-capture/
- UiPath Docs, "Details about the PDD" (Task Capture). https://docs.uipath.com/task-capture/docs/details-about-the-pdd
- A. Engst, TidBITS, "How to Avoid Sequoia's Repetitive Screen Recording Permissions Prompts", 2024-09-23. https://tidbits.com/2024/09/23/how-to-avoid-sequoias-repetitive-screen-recording-permissions-prompts/

**Search summaries only [S]:**

- TidBITS, "Apple Reduces Excessive Sequoia Permission Requests, Shifts to Monthly", 2024-08-19. https://tidbits.com/2024/08/19/apple-reduces-excessive-sequoia-permission-requests-shifts-to-monthly
- MacRumors, "Apple Tweaks Screen Recording App Permissions to Decrease Popup Frequency in macOS Sequoia 15.1", 2024-10-07. https://macrumors.com/2024/10/07/apple-screen-recording-popup-update
- Apple Developer, ScreenCaptureKit `SCContentSharingPicker` documentation. https://developer.apple.com/documentation/screencapturekit/sccontentsharingpicker
- Apple Developer Forums, threads on Input Monitoring vs Accessibility for event taps. The search summary attributed a DTS answer to these threads without saying which one holds it. https://developer.apple.com/forums/thread/707680 and https://developer.apple.com/forums/thread/811443
- Apple Developer Forums, "System input becomes unresponsive when Accessibility permission is revoked while a CGEventTap is active". https://developer.apple.com/forums/thread/844416
- Apple Developer Forums, "On macOS 15.4+, NSWindow with kCGWindowSharingStateSharingNone still captured by ScreenCaptureKit". https://developer.apple.com/forums/thread/792152
- Electron issue on content protection. https://github.com/electron/electron/issues/19880
- Apple Support, "Take screenshots or screen recordings on Mac". https://support.apple.com/guide/mac-help/mh26782
- Apple Support, Mac User Guide, screen and system audio recording privacy. https://support.apple.com/guide/mac-help/mchl592e5686/mac
- Microsoft Learn, `GraphicsCaptureSession.IsBorderRequired`. https://learn.microsoft.com/en-us/uwp/api/windows.graphics.capture.graphicscapturesession.isborderrequired
- Microsoft Support, "Turn on app permissions for your microphone in Windows". https://support.microsoft.com/en-us/windows/turn-on-app-permissions-for-your-microphone-94991183-f69d-b4cf-4679-c98ca45f577a
- BleepingComputer, "Microsoft tests new privacy controls for Windows 11 desktop apps". https://bleepingcomputer.com/news/microsoft/microsoft-tests-new-privacy-controls-for-windows-11-desktop-apps
- Microsoft, "Your guide to Snipping Tool". https://www.microsoft.com/en-us/windows/learning-center/your-guide-snipping-tool
- Pureinfotech, "How to hide text from screenshots on Snipping Tool for Windows 11". https://pureinfotech.com/hide-text-screenshots-snipping-tool-windows-11/
- CleanShot, "All features". https://cleanshot.com/features
- TechSmith, Snagit Step tool tutorial. https://www.techsmith.com/learn/tutorials/snagit/step/
- Loom, "Use Loom's keyboard shortcuts". https://support.atlassian.com/loom/docs/use-looms-keyboard-shortcuts/
- Loom, "Loom AI features". https://support.atlassian.com/loom/docs/loom-ai-features/
- Tettra, "What is Scribe and How Does It Work?". https://tettra.com/article/scribe-faq
- Tango Help, "How to use Secure Blur". https://help.tango.ai/en/articles/7225709-how-to-use-secure-blur
- Tango Help, "How does Tango store blurred images...". https://help.tango.ai/en/articles/5971736-how-does-tango-store-blurred-images-if-i-redact-information-in-a-screenshot-do-you-delete-the-original
- Tango Blog, "Batch Blur", 2023-03-02. https://www.tango.ai/blog/batch-blur
- UiPath Docs, "PDD creation flow and particularities" (Task Capture 2022.4). https://docs.uipath.com/task-capture/standalone/2022.4/user-guide/pdd-creation-flow-and-particularities
- UiPath Docs, "Automating Citrix technologies". https://docs.uipath.com/studio/standalone/latest/user-guide/automating-citrix-technologies
- Microsoft Power Platform Blog, UI flows in Citrix using image recognition and OCR. https://www.microsoft.com/en-us/power-platform/blog/?p=3055
- Microsoft Learn, Power Automate desktop flows RDP/Citrix troubleshooting. https://learn.microsoft.com/en-us/troubleshoot/power-platform/power-automate/desktop-flows/ui-automation/ui-rdp-automation/rdp-no-highlight
- VCU, "'Vanishing Pen' and 'Reaction' emojis added to Zoom version 5.6.3", 2021-04-20. https://blogs.vcu.edu/zoom/2021/04/20/vanishing-pen-and-reaction-emojis-added-to-zoom-version-5-6-3/
- University of Tennessee OIT, "Zoom: Annotation Tools". https://utk.teamdynamix.com/TDClient/2277/OIT-Portal/KB/ArticleDet?ID=132637
- Figma Help, comments. https://help.figma.com/hc/en-us/articles/360041068574
- NN/g, "Thinking Aloud: The #1 Usability Tool". https://nngroup.com/articles/thinking-aloud-the-1-usability-tool/
- NN/g, "Thinking aloud demo video". https://www.nngroup.com/articles/thinking-aloud-demo-video/
- Washington State, "Think aloud testing". https://your.wa.gov/cx-resources/think-aloud-testing/
- TechCrunch, "The Right Way To Ask Users For iOS Permissions", 2014-04-04. https://techcrunch.com/2014/04/04/the-right-way-to-ask-users-for-ios-permissions/
- Pomona/ETAA, iOS ATT priming study (technical report). https://ebac2018.sites.pomona.edu/docs/ETAA21-ATT-techreport.pdf
