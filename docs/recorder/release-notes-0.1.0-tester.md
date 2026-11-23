# Handover 0.1.0 (tester build): release notes

**TEST BUILD — use test data only, not real client data.** This is an unsigned early build for the Windows 11 x64 test on Tuesday 24 Nov 2026 (and a Mac check by the owner).

## What it does
- Records your screen activity with a screenshot for each step: a click, an app or window switch.
- Looks up the control behind each click (macOS Accessibility, Windows UI Automation) so a step can read `Click button "Save" in Notepad`. This is optional at runtime: if it is unavailable, the step is kept with a screenshot only.
- A floating control bar while recording.
- **Explain:** freeze the screen on a hotkey (Ctrl/Cmd + Shift + E), draw a box, arrow or highlight, and type a comment.
- Pause and resume.
- Narration: speak while you work. It is transcribed on your own computer; the speech model ships inside the app.
- Review: delete a step, edit a comment, blur a rectangle on a screenshot.
- Export: a folder and a `.zip` holding `PROCESS.md` (the write-up), `CLAUDE_HANDOFF.md`, `manifest.json`, `steps.jsonl`, `annotations.jsonl`, `gaps.jsonl` and the screenshots.
- **Save diagnostics…** (tray menu): a zip with the app log and technical details, never screenshots, transcripts or comments.
- Windows: a per-user installer (unsigned, x64). macOS: a zipped app.

## What it does not do yet
- Choosing which apps may be recorded, and masking of other apps.
- Automatic detection and hiding of personal data and IDs. The only redaction is the blur you draw yourself in review (plus automatic blurring of password fields).
- Encrypted storage and retention rules.
- Detection of Remote Desktop and Citrix sessions beyond a basic label.
- Prompts and readiness rules, and data-flow output.
- The package format check and scoring, and the usability study.
- Signing and notarisation (hence the SmartScreen and Gatekeeper warnings).
- The full review editor.
- Process-spec generation by Claude.

## Known limits (not proven on real hardware yet)
- **A real click through the Windows click helper has not been seen.** The build servers prove it compiles, installs its hook and reads a desktop control, but they have no mouse. Tuesday's run is the first real proof. Elevated (administrator) windows, Remote Desktop clients and laptops with mixed display scales are also unproven.
- **The first click or two after the helper starts** (about the first second) may come back without a control name, because Windows' accessibility service starts slowly.
- **Electron-based apps on macOS** may give a weaker description on the first click.
- **A step in the first second of a recording** can have no screenshot, because screen capture takes about 0.8 s to start.
- **Very small changes** (a single typed character) can be missing from a step's screenshot for up to a second.
- **Blank window titles on macOS** until Accessibility is granted.
- **Narration:** tested offline on the Mac with synthetic speech only. A real microphone on Windows has not been tried. The first narration in a recording may take several seconds to appear.
- **The export dialog and Record button** were not clicked by a person before this build, only exercised by tests and scripts.
- Screenshots are captured as JPEG and saved as PNG, so file sizes can be large. Windows installer is about 500 MB because it includes the speech model.
- The Explain overlay and review screen are new and have not run on Windows. Labels in the test script marked "label may differ slightly" may not match exactly.
- The Library window does not show the test banner.

## Privacy, in plain words
- It does **not** record what you type. There is no keyboard capture.
- It does **not** read what is inside text fields, and it does **not** read your clipboard.
- On a password field it keeps the field's label but not its content, and covers the field with a blur in that step's screenshot.
- Web addresses are cut down to the site and page path. Anything after a `?` or `#` is dropped.
- It does **not** send anything over the internet: no telemetry, no sign-in, no AI service, no update check.
- The package has **no audio and no video**, only the text transcript of your narration.
- Every window and the README carry the "TEST BUILD" banner.
- The diagnostics zip holds the app log and technical details only. You can open it before sending.
