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

## Known limits
What the first run on real Windows hardware (24 Nov 2026, Windows 11, two monitors) showed:
- **The click helper names real controls on Windows 11**, for example the Save button in a Save as window, the File name box, and the Edge address bar.
- **Taskbar clicks come back unnamed**, because the taskbar does not describe its buttons to the helper.
- **Clicks inside an administrator window are not seen.** Windows does not let a normal program watch an elevated window. The next build shows a clear "not observed" note for that stretch instead of staying silent.
- **Transcription is slow and slows the PC.** It took about 62 seconds for a 5 minute recording, and the computer lagged while it ran.
- **An empty recording still has one step**, the desktop.
- **There is no audio playback in the review screen.** You read the transcript, you cannot listen to it.
- Remote Desktop clients and laptops with mixed display scales are still unproven.

Other known limits:
- **The first click or two after the helper starts** (about the first second) may come back without a control name, because Windows' accessibility service starts slowly.
- **Electron-based apps on macOS** may give a weaker description on the first click.
- **A step in the first second of a recording** can have no screenshot, because screen capture takes about 0.8 s to start.
- **Very small changes** (a single typed character) can be missing from a step's screenshot for up to a second.
- **Blank window titles on macOS** until Accessibility is granted.
- **Narration:** the first narration in a recording may take several seconds to appear.
- Screenshots are captured as JPEG and saved as PNG, so file sizes can be large. The Windows installer is 627 MB because it includes the speech model.
- Labels in the test script marked "label may differ slightly" may not match exactly.
- The Library window does not show the test banner.

## Privacy, in plain words
- It does **not** record what you type. There is no keyboard capture.
- But **window titles are recorded**, and some apps put what you typed, or a document or client name, in the title. Notepad names an unsaved note after its first line, so that line can end up in the write-up.
- Clicking on a piece of page or document text can store that text as the name of the thing you clicked.
- **Screenshots show everything visible on every monitor**, including notifications, chat and email previews, desktop icons, and other windows. Close or hide anything private before you record.
- It does **not** read what is inside text fields, and it does **not** read your clipboard.
- On a password field it keeps the field's label but not its content, and covers the field with a blur in that step's screenshot.
- Web addresses are cut down to the site and page path. Anything after a `?` or `#` is dropped.
- It does **not** send anything over the internet: no telemetry, no sign-in, no AI service, no update check.
- The package has **no audio and no video**, only the text transcript of your narration. The raw narration audio does stay on your computer, in `%LOCALAPPDATA%\Handover\sessions\...\audio`. It is never put in the package.
- **Uninstalling does not remove your recordings, settings or logs.** These three folders stay until you delete them yourself:
  1. `%LOCALAPPDATA%\Handover`: your recordings, including the narration audio;
  2. `%APPDATA%\Handover`: your settings;
  3. `%APPDATA%\Handover\logs`: the app logs (inside the settings folder).
- Every window and the README carry the "TEST BUILD" banner.
- The diagnostics zip holds the app log and technical details only. You can open it before sending.
