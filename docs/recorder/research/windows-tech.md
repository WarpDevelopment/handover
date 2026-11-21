# Windows technical feasibility: Workflow Recording Assistant

Research assignment: windows-tech
Date of research: 2026-11-21 (all sources accessed on this date)
Scope: Windows 10/11 feasibility of a transparent annotation overlay, screen capture, global input capture, UI Automation (UIA) snap-to-control, remote-session fallback, signing/installers/AV, CI, and Electron vs Tauri on Windows. Planning only; no product code.

## Evidence legend

Every claim carries one tag:

- **[V] Verified**: I opened the primary page (or ran the check myself) and the statement is taken from it.
- **[R] Reported**: from a web-search digest or a secondary source. I did not open the primary page, or the source is a forum, vendor marketing or a third-party blog. Treat it as likely, not proven.
- **[I] Inference**: my own reasoning from the facts above. These need a spike test or owner confirmation.

Sections 12 to 14 (risk register, spike plan, lane effects) are recommendations and are [I] throughout unless a line says otherwise.

---

## 1. Headline findings: what changes the plan

These are the findings that challenge a fixed decision or a planner call. Each one is expanded later.

1. **The Windows smoke-test VM will be Windows 11 on Arm, not x64.** The owner's Mac is an Apple M4 (`uname -m` = arm64, `machdep.cpu.brand_string` = Apple M4) [V]. On Apple Silicon, Windows 11 runs as the Arm64 edition (Parallels is the Microsoft-authorised route) [R]. GitHub-hosted `windows-latest` runners are x64 [R]. **So no evidence path covers an interactive x64 Windows machine with a real GPU and real multi-monitor mixed DPI**, which is what most Moore staff will have [I]. IOActive also reports that window capture exclusion "may not behave as advertised" in basic VMs without GPU acceleration [V]. Recommendation: build both `win-x64` and `win-arm64`, smoke both in the VM (x64 runs under Prism emulation [R]), and add one real x64 laptop smoke before any Moore pilot. Lane acceptance item 3 should say this limitation out loud.

2. **Azure Artifact Signing (formerly Trusted Signing) is not available to a South African organisation.** Microsoft's page (updated 2026-11-10) says organisations must be in the USA, Canada, the EU or the UK, and individuals in the USA or Canada only [V]. The fallback is an OV certificate held on a cloud HSM (about $150 to $300 a year [V], SSL.com eSigner lists OV at $129 a year [R]). EV no longer skips SmartScreen; that behaviour was removed in 2024 [V]. Since 2026-03-01 code-signing certificates last at most 460 days (CA/B Forum ballot CSC-31) [R], so the certificate is renewed about every 15 months. **Open question: which jurisdiction is Warp Development's legal entity in?** If it has an EU or UK entity, Artifact Signing (~$9.99 a month [V]) becomes possible.

3. **uiohook-napi always installs a global keyboard hook, not just a mouse hook.** I read the shipped 1.5.5 tarball: `libuiohook/src/windows/input_hook.c` lines 653-654 call `SetWindowsHookEx(WH_KEYBOARD_LL, ...)` and `SetWindowsHookEx(WH_MOUSE_LL, ...)` together, unconditionally [V]. EDR products flag keystroke capture through `SetWindowsHookEx`. Elastic Defend has rules named "Keystrokes Input Capture via SetWindowsHookEx", and its raw-input rule keys on an unsigned caller outside trusted paths [V]. A global keylogger is also a POPIA problem: it would see passwords typed into ProfSoft. **Recommendation: on Windows, do not use uiohook-napi. Put a mouse-only low-level hook (or raw input) in our own native helper.** Capture typed text through UIA (the value of the focused field when it loses focus, and never for `IsPassword` fields) rather than keystrokes [I].

   **The cost of having no keyboard events [I].** Keyboard-only steps produce no click and therefore no click-triggered frame: Enter to submit, Tab between fields, Ctrl+S, typing into an Excel cell and pressing Enter. The step triggers therefore cannot be clicks alone. Add non-hook triggers:
   - UIA focus-changed events (Tab and Enter usually move focus);
   - foreground-window changes (a dialog opens or closes);
   - screen-change detection on the frame stream (a significant frame difference with no click emits a "screen changed" step with before/after frames);
   - UIA structure-changed or window-opened events where cheap.

   Whether to add an opt-in "record keyboard shortcuts, not text" mode (which needs a keyboard hook, with its EDR and POPIA cost) is an **owner decision, not a default**. Spike item W17 tests a keyboard-only process.

4. **Low-level hooks are silently removed if they are slow, so UIA lookups can never run inside the hook callback.** Microsoft: if the hook procedure exceeds `LowLevelHooksTimeout` (capped at 1000 ms since Windows 10 1709), "on Windows 7 and later, the hook is silently removed without being called. There is no way for the application to know whether the hook is removed." [V]. A UIA call into a slow provider has a **default transaction timeout of 20 seconds** [V]. Design: the hook thread only timestamps and enqueues. A separate worker does `ElementFromPoint` with a short, explicit timeout. A watchdog detects a dead hook by comparing hook events with `GetLastInputInfo`/cursor movement and reinstalls it [I].

5. **"Every click records which control was clicked" cannot be guaranteed on Windows.** It fails in at least five documented or likely cases:
   - Elevated (admin) windows. UIPI blocks both our hook events and UIA [V/R].
   - The UAC secure desktop. It runs at system integrity, which no user process can reach [V].
   - Remote sessions (RDP, RemoteApp, Citrix). Local UIA only sees the client window, not the controls inside it [R/I].
   - Opaque toolkits: custom-drawn Delphi grids, Java without Access Bridge, and some canvas/WebGL web apps [R].
   - Windows that set `WDA_MONITOR` or `WDA_EXCLUDEFROMCAPTURE` themselves. They come out black or missing in our frames [V].

   **The package schema must treat "no element" as normal.** Each target should carry `source: uia | ocr | vision-later | manual | none`, a `reason`, and a `confidence`. Rephrase the planner's call as: "every click records a target descriptor or an explicit reason why not."

6. **Remote desktop or Citrix delivery of ProfSoft is the biggest functional risk, and it is not resolved by research.** Neither Microsoft nor UiPath reaches inside a Citrix session from the endpoint alone. Both install a runtime inside the remote session (Power Automate's "lightweight runtime inside the target Citrix environment" [V]; UiPath Remote Runtime [R]). For vendor-hosted ProfSoft we will almost certainly not be allowed to install anything on the vendor's servers [I]. So for remote windows the fallback is screenshot plus click point, OCR text near the click, and Claude vision at processing time [I]. The delivery mode of ProfSoft (and whether Moore runs Caseware locally or through Citrix, which Caseware supports [R]) must be confirmed before the capture lane's acceptance is written.

7. **Install location is a real trade-off.**
   - A per-user install (NSIS default, `%LOCALAPPDATA%\Programs`) collides with AppLocker default rules, which "prevent all non-administrator users from running programs installed in their user profile folder" [R]. It also collides with EDR "not in a trusted path" conditions [V, Elastic].
   - A per-machine install in Program Files avoids both, but needs admin rights or IT deployment.
   - UIAccess (the only way to see elevated UI) needs signing, a Program Files install, and **still cannot reach elevated ("high" integrity) windows when the user is not an administrator** [V]. Microsoft also says UIAccess "should not be used by applications that are not assistive technologies" [V].

   Recommendation: no UIAccess. Detect elevated foreground windows and label the step instead. Offer a per-machine MSI/NSIS for IT deployment and a per-user build for pilots.

8. **Electron holds up on Windows; nothing found forces Tauri.** Electron documents everything the overlay needs on Windows:
   - `setIgnoreMouseEvents(true, {forward: true})` [V]
   - `setContentProtection(true)`, which maps to `WDA_EXCLUDEFROMCAPTURE` on Windows 10 2004 and later [V]
   - `setAlwaysOnTop` levels, where `pop-up-menu` and higher sit above the taskbar [V]

   Tauri's equivalent gaps on Windows are reported, not verified: no mouse-move forwarding while ignoring the cursor, and no built-in capture [R]. The UIA work is native code in either shell. Recommendation: Electron, with a Windows native helper behind a language-neutral stdio protocol, so a later move to Tauri would not throw the helper away.

---

## 2. Assumptions about the Moore environment (unknowns)

| Unknown | Why it matters | How to resolve |
|---|---|---|
| ProfSoft delivery: thick client, browser, RDP/RemoteApp or Citrix | Decides whether snap-to-control works for the most important system | Ask Moore IT; one 10-minute screen share |
| Caseware Working Papers local or via Citrix | Caseware supports both; it is "traditionally installed on each machine, though it may be installed on the firm's servers and accessed remotely through Citrix" [R, Caseware docs] | Ask Moore IT |
| Windows versions and editions | `WDA_EXCLUDEFROMCAPTURE` needs Windows 10 2004 (build 19041) or later [V]. Windows 10 support ended 2025-10-14 [R]. Group Policy editor exists only on Pro/Enterprise/Education [R] | Intune/inventory export |
| Device management (Intune, GPO, none) | Decides installer type, SmartScreen exposure, update channel | Ask Moore IT |
| EDR/AV product | Decides allowlisting and false-positive work | Ask Moore IT |
| Do staff have local admin? | Per-machine install; elevated-window frequency; UIAccess semantics | Ask Moore IT |
| Monitor setups (laptop plus external at mixed scaling is typical) | Mixed-DPI correctness is a top bug source | Ask, or observe during pilot |
| Any Arm64 Windows devices (Copilot+ PCs) | Need for an Arm64 build in production | Inventory |

---

## 3. The overlay on Windows (Electron)

### 3.1 What the platform gives us

- **Transparent windows.** "On Windows, [transparent] does not work unless the window is frameless." [V, Electron BaseWindow docs]. They need DWM composition; Windows 8 and later always composes [I].
- **Click-through.** `win.setIgnoreMouseEvents(true, { forward: true })`. `forward` is "macOS, Windows" and "forwards mouse move messages to Chromium, enabling mouse related events such as `mouseleave`" [V]. **Caveat [V]: "On Windows, `forward: true` stops working temporarily when the active window is running at a higher integrity level."** That is UIPI again.
- **Window shape.** `win.setShape(rects)` is Windows/Linux and experimental. It "determines the area within the window where the system permits drawing and user interaction" [V]. It limits *drawing* as well as input, so it cannot give a visible-but-click-through overlay. At most it could clip the overlay to a toolbar-sized region, and it is Windows/Linux only. Do not use it for the overlay [I].
- **Transparent pixels are not click-through by themselves.** Electron issue #1335 is the long-running request [R]. A third-party write-up reports that disabling GPU acceleration used to give per-pixel click-through, that this regressed around Electron 38 / Chromium 139 (June 2025, Electron issue #48064), and that a `disable-direct-composition` switch is a workaround [R]. Current status is not established. **Do not design around per-pixel click-through.**
- **Z-order.** `setAlwaysOnTop(flag, level)`. On Windows the window "is placed below the taskbar", and "from `pop-up-menu` to a higher it is shown above ... the taskbar on Windows" [V]. Third-party write-ups use `screen-saver`, the highest level [R].
- **Focus.** "On Windows setting `focusable: false` also implies setting `skipTaskbar: true`." [V]. Show overlays with `showInactive()` so they never take focus from the app being recorded [I].
- **Virtual desktops.** `setVisibleOnAllWorkspaces` "does nothing on Windows" [V]. When the user switches virtual desktops (Win+Ctrl+Arrow) the overlay may stay behind on the old desktop [I]. Mitigation: detect the switch and move the overlay with the documented `IVirtualDesktopManager` (`IsWindowOnCurrentVirtualDesktop`, `MoveWindowToDesktop`) [I, API names from memory, verify in the spike].
- **Other topmost windows.** Several Electron apps report that their always-on-top window loses position to other topmost windows, or fails over full-screen apps [R]. For our users the likely competitors are full-screen Citrix/RDP windows, PowerPoint slide show, Teams sharing toolbars and Windows "Click to Do" [I]. Mitigation: re-assert `setAlwaysOnTop` on focus changes and test against each competitor in the spike.
- **Exclusive full-screen (DirectX exclusive mode)** cannot be drawn over by a normal desktop window [I]. It is rare for accountants (games, some video players). Modern Windows mostly uses "fullscreen optimisations" (borderless flip model), which overlays can sit above [I]. Low priority.

### 3.2 Recommended Windows overlay design [I]

1. **One transparent, frameless, non-focusable overlay window per display**, sized to that display's bounds. A single window spanning monitors with different scale factors is a classic source of wrong placement in Chromium, which renders a window at one scale factor at a time.
2. **Two modes.**
   - *Observe mode*: the overlay is fully click-through (`setIgnoreMouseEvents(true, {forward:true})`). It only shows passive highlights (hover outline of the control under the cursor, click ripples).
   - *Annotate mode*, entered with a hotkey or the toolbar button: the overlay takes the mouse so the user can draw boxes, arrows and highlights, or click a control to "snap" a highlight to it. While annotating, click recording pauses, so annotation clicks are not recorded as process steps.
3. **The toolbar is a separate small focusable window** (pause, annotate, comment, narration, stop), always on top at a level above the overlay. Do not rely on `setShape`, because macOS lacks it.
4. **Exclude every recorder window from capture** with `setContentProtection(true)`. Annotations are stored as vector data in the package (structured and better for Claude) and composited at export or review time, never burnt into the raw frames.
5. **Capture-exclusion self-test at start of each recording.** Draw a known marker pattern on the overlay, grab one frame, and check that the marker is absent. If it is present (RDP session, a VM without GPU, an old build), warn the user and switch to "hide overlay during frame grab" mode.

### 3.3 Mixed DPI and coordinates

- **UIA uses physical pixels.** `ElementFromPoint`, `ElementFromPointBuildCache`, `GetClickablePoint` and `BoundingRectangle` "return physical coordinates or take physical coordinates as parameters". A non-DPI-aware client "will not obtain correct results" [V, Microsoft "Understanding Screen Scaling Issues"]. The fix Microsoft gives is to make the client DPI-aware and use `GetPhysicalCursorPos` [V]. For multi-monitor, the helper should declare **Per-Monitor V2** awareness in its manifest [I, PMv2 supersedes `SetProcessDPIAware` for mixed DPI].
- **Electron uses DIPs.** `screen.dipToScreenPoint` and `screen.screenToDipPoint` scale relative to the display that contains the point. `dipToScreenRect` and `screenToDipRect` scale relative to the display nearest the given window [R, Electron screen docs via digest]. An Electron fix (#29162) concerned window bounds not scaled from screen coordinates [R].
- **Package rule [I].** Store every coordinate as **physical virtual-screen pixels**, plus a per-recording display map (id, physical bounds, scale factor, primary flag). Convert to DIPs only when positioning overlay windows. The spike must test a secondary monitor placed *left of or above* the primary (negative coordinates) at a different scale (for example 100% laptop plus 150% external).

---

## 4. Screen capture and keeping the overlay out of it

### 4.1 Capture paths

- **Electron built-in.** `desktopCapturer.getSources({types:['screen']})` together with `session.setDisplayMediaRequestHandler`, then `navigator.mediaDevices.getDisplayMedia()` in a renderer [V, Electron docs]. `getDisplayMedia` cannot pick a source by `deviceId` [V]. `useSystemPicker` is experimental [V]. Windows loopback audio is available as `audio: 'loopback'` [V]; we do not need it.
- **Which Windows backend Chromium uses is not established.** It could be DXGI Desktop Duplication or Windows Graphics Capture (WGC). WebRTC split WGC enablement into separate window and screen flags, and Chromium enables the WGC *screen* capturer only when the caller allows it [R]. A WebRTC commit notes Electron accesses the DXGI duplicator controller [R]. Spike item: log which capturer is used, and check for the yellow WGC border.
- **WGC yellow border.** WGC can draw a coloured border around captured content. `GraphicsCaptureSession.IsBorderRequired` (Windows 10 build 20348 and later, in practice Windows 11) can turn it off. That needs `GraphicsCaptureAccess.RequestAccessAsync(Borderless)`, which needs the `graphicsCaptureWithoutBorder` capability in a **package manifest**, so it needs package identity [V]. If another app requires the border, it is shown anyway [V].
- **Cursor.** Do not depend on the capturer drawing the cursor. We already record exact cursor positions and clicks, so render the cursor and click marks from data at review time [I].

**Architecture note for the capture lane [I].** A process recording does not need full-motion video to be understood. The highest-value artefacts are:
- a **pre-click frame**, taken from a short ring buffer of frames from the live stream;
- a **post-click settled frame**, about 300 to 800 ms after the click, or when the screen stops changing;
- a **tight crop around the click**.

Low-fps video (2 to 5 fps) can be kept for context and is cheap. This keeps packages small and readable for Claude, and lowers the PII surface.

### 4.2 Excluding our windows: `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)`

- `WDA_EXCLUDEFROMCAPTURE` (0x11): "The window is displayed only on a monitor. Everywhere else, the window does not appear at all. One use for this affinity is for windows that show video recording controls, so that the controls are not included in the capture." It was introduced in Windows 10 version 2004. On earlier versions it "will behave as if WDA_MONITOR is applied", which gives a black box [V, Microsoft Learn].
- It applies to top-level windows of the calling process only, and "works only when the Desktop Window Manager (DWM) is composing the desktop" [V].
- Electron: `setContentProtection(true)` uses it. "For Windows 10 version 2004 and up the window will be removed from capture entirely." "The change takes effect with the next desktop composition, not when the call returns." [V]. There was a hide/show regression that turned protected windows opaque black; it was fixed in Electron PRs #47020 and #47033 (backported to 36 and 37) [R].
- **IOActive analysis (2026-09-03)** [V]:
  - It blocks PrtSc, Snipping Tool, Zoom/Teams/Meet sharing, OBS desktop duplication and Recall.
  - It does **not** hold in RDP sessions, where it "fails open".
  - It may not behave in basic VMs without GPU acceleration.
  - Code injected into the process can clear it.

  For us this means:
  1. If the recorder itself runs *inside* an RDP or Citrix session, the overlay may show up in our captures. The self-test in 3.2 handles this.
  2. The Parallels VM may not reflect real hardware for this feature.
- **Bonus use [I].** Set content protection on our own *review and editor* windows too. They display sensitive recorded content, and this keeps it out of Teams screen shares and Recall by default. That is a small POPIA win.
- **Other apps that set display affinity** (some password managers, Signal and others [V, IOActive]) will be black or missing in our frames. The package should flag "frame region withheld by the source app" rather than treat it as an error [I].

---

## 5. Global input capture, UIPI and hotkeys

### 5.1 Low-level hooks (WH_MOUSE_LL)

- The hook is called on the installing thread, which must run a message loop. It is not injected into other processes [V].
- Timeout and silent removal: see headline 4 [V]. Microsoft also says: "In most cases where the application needs to use low level hooks, it should monitor raw input instead." Raw input is asynchronous and does not stall system input [V].
- The `LLMHF_INJECTED` flag distinguishes synthetic clicks (remote-control tools, automation) [I, from the MSLLHOOKSTRUCT docs; the page I opened references injected input]. It is useful later, so Superbrain's own automation is not recorded as user steps.
- **Raw input as an alternative [I].** `RegisterRawInputDevices` with mouse usage and `RIDEV_INPUTSINK`, then `GetPhysicalCursorPos` on each button event. It cannot be silently removed, and Elastic's raw-input keylogger rule keys on *keyboard* usage [V], so mouse raw input is lower EDR risk. Cost: the cursor position is read a moment after the event. The spike should compare position skew between the hook and raw input.

### 5.2 UIPI: elevated windows are invisible to us

- A medium-integrity process's low-level mouse hook stops firing when an elevated window (for example Task Manager) has focus [R, Microsoft Q&A]. Electron documents the same effect for `forward: true` [V].
- UIA access rules [V, Microsoft "Security Considerations for Assistive Technologies"]:
  - Without UIAccess, an app runs at medium integrity and "cannot access elevated ... process UI".
  - With UIAccess, launched by a non-admin, it runs at "medium+" and "cannot access elevated UI (nothing running as 'high' IL ...)".
  - With UIAccess, launched by an admin user, it runs at "high" and can access elevated UI.
  - Nothing reaches UI at system integrity (the UAC secure desktop).
- UIAccess requirements: Authenticode-signed, installed in a secure location such as Program Files, and a manifest flag. It is intended only for assistive technologies [V].
- One 2022 report: an Electron app with `uiAccess="true"` rendered blank or crashed [R, single Microsoft Q&A, unanswered].
- **Recommendation [I].** No UIAccess. The helper checks the integrity level of the foreground window's process (`GetWindowThreadProcessId`, then `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)`, then `GetTokenInformation(TokenIntegrityLevel)`). If it is higher than ours, the recorder:
  1. shows a toolbar notice ("This window runs as administrator; Windows doesn't let the recorder see inside it. Narrate what you do, or add a manual step.");
  2. writes a `gap` event with reason `elevated_window`;
  3. keeps taking frames, because screen capture of elevated windows still works (DWM composes them).

  The last point is an inference to confirm in the spike.
- **UAC prompts** run on the secure desktop. We cannot overlay, hook or (very likely) capture them [V for overlay and UIA; I for capture]. Record a `gap` with reason `secure_desktop` when the input desktop switches. Detect it when `OpenInputDesktop` fails or the desktop name changes [I].

### 5.3 Keyboard: do not record keystrokes in v1

Reasons:
- EDR keylogger heuristics [V, Elastic].
- POPIA and IRBA exposure (passwords, client tax numbers) [I].
- uiohook-napi's unconditional keyboard hook [V].

What to record instead [I]:
- **Text entry** through UIA. Subscribe to focus changes in the helper. When a focused edit field loses focus, read its `ValuePattern.Value` (skip it if `IsPassword` is true, and truncate or redact by policy) and emit `typed_into(field, value_preview)`. The review screen shows it and lets the user blank it.
- **Shortcuts** (Ctrl+S, Enter): these cannot be observed system-wide without a keyboard hook or keyboard raw input. Accept that shortcuts are missed in v1 and rely on narration plus the before/after frames. Revisit in v2 with an opt-in "record keyboard shortcuts (not text)" setting.

### 5.4 Global hotkeys

- Electron `globalShortcut` exists. That it uses `RegisterHotKey` on Windows is an inference to verify.
- **Remote-session clients take keyboard focus aggressively.** RDP and Citrix in full-screen send Windows key combinations to the remote session depending on the "Apply Windows key combinations" setting, and Citrix routes them per admin policy [R, Citrix docs]. Whether *our* hotkey still fires while a full-screen Citrix or RDP window has focus is not established. Spike item.
- **Mitigation [I].** Every action must also be reachable by mouse, through the toolbar and the tray icon. Choose a default hotkey that is unlikely to be forwarded, and let users rebind it.

---

## 6. UI Automation: snap-to-control on Windows

### 6.1 How to call UIA from an Electron app

| Option | Facts | Verdict |
|---|---|---|
| **A. C# helper exe on .NET Framework 4.8, stdio JSON-lines** | .NET Framework 4.8 is preinstalled on Windows 10 1903 and later; Windows 11 22H2 and later ship 4.8.1 [R, Microsoft Learn via digest]. No runtime to ship; the exe is tiny. UIA through COM interop (UIA3) or FlaUI. FlaUI notes UIA3 has some WinForms bugs that UIA2 does not, and that the two should not be mixed in one process [R]. | **Recommended default** (fast for Sonnet implementers). Arm64: .NET Framework 4.8.1 has native Arm64 support [I, to verify]; otherwise it runs x64 under emulation. |
| **B. Rust helper exe** (`windows` crate or `uiautomation` crate, latest 0.24.4, 2026-03-02 [R]) | Native x64 and Arm64, no runtime, small. Reusable if the shell ever moves to Tauri. | **Strong alternative.** Pick it if the spike shows C# latency problems or if a Tauri fallback is likely. |
| C. C++ N-API addon in Electron's main process | Fastest. But a UIA call can block for the **20 s default transaction timeout** [V] and a crash takes down the app. Native rebuilds also hit VS2026 toolchain churn (node-gyp needed 12.1+ for VS 2026 [R]). | Reject for v1. |
| D. koffi FFI to UIAutomationCore COM vtables | koffi 3.3.8 (modified 2026-11-15) [V, npm]. No published IUIAutomation example; vtable order must be hand-declared [R]. In-process, so the same blocking risk as C. | Reject. |
| E. PowerShell | Process start-up per query, and enterprise Constrained Language Mode and EDR scrutiny of PowerShell [I]. | Reject. |
| F. `node-winautomation` npm addon | Has `elementFromPoint`, compiles on install with VS 2019/2022, version 1.0.3 [R]. | Reject (in-process, compile on install, low adoption). |
| G. Microsoft `winapp` CLI | v0.5.0 (2026-07-22): `winapp ui` inspect/click/record verbs and WinRT JS bindings without native addons [V]. It is a developer and test tool. | **Use it in CI tests** (5.10), not in the product. |

**Helper responsibilities (one process, so correlation is exact) [I]:**
- The mouse-only low-level hook (or raw input) on a dedicated thread.
- A worker thread doing `ElementFromPointBuildCache` with a cache request. Batch the properties in one cross-process call, because round trips dominate latency [R, Microsoft blog].
- Properties to cache: `Name`, `ControlType`, `LocalizedControlType`, `AutomationId`, `ClassName`, `FrameworkId`, `BoundingRectangle`, `IsPassword`, `IsEnabled`, `HelpText`, `ProcessId`, `NativeWindowHandle`, plus an ancestor chain up to the top-level window (name, type, AutomationId).
- Set `IUIAutomation2::TransactionTimeout` and `ConnectionTimeout` low (about 1 to 2 s). The default transaction timeout is 20 s [V].
- Retry on `UIA_E_ELEMENTNOTAVAILABLE`, which happens when the element vanished before the call returned [R, ElementFromPoint docs].
- Foreground window title, process image name, integrity level, and the "remote client" classification (6.4).
- A focus-changed subscription for typed-text capture (5.3).
- Per-Monitor V2 DPI awareness in its manifest (3.3).
- Protocol: JSON lines over stdio, versioned, with a `hello` capabilities message, so the macOS helper (Swift, AX) speaks the same schema.

**Timing risk [I].** By the time the worker resolves the element, a mouse-down may already have opened a menu or closed a dialog. Do a hit-test on *mouse-down*, before the UI reacts to mouse-up, and also keep a hover cache: resolve the element under a stationary cursor (with debounce) so the last-hovered element is ready at click time. The spike must measure click-to-element latency and how often the element is stale.

### 6.2 Expected UIA quality by toolkit

| Target | What to expect | Evidence |
|---|---|---|
| Win32 common controls (Caseware dialogs, older apps) | Good names and types through the built-in MSAA-to-UIA proxies | [I], general UIA knowledge |
| WPF, WinUI, UWP | Native UIA providers; usually good | [I] |
| WinForms | Good, but UIA3 has some WinForms-specific bugs that UIA2 lacks | [R, FlaUI] |
| Delphi VCL | Standard controls that wrap Win32 controls get default MSAA, often with empty names. Custom grids such as `TStringGrid` do not expose cells. DevExpress VCL has MSAA (deprecated) and varying UIA support | [R] |
| Office (Excel, Outlook, Word) | Office exposes UIA, including Excel custom patterns and the Spreadsheet pattern (cells by name, formulas). **Whether `ElementFromPoint` returns a cell in Excel is not established**; cells that are not visible have no element | [R, Office UIA docs via digest] |
| Chrome, Edge, Chromium apps | Native UIA is on by default from Chrome 138 (blog 2025-08-14); enterprises can revert with `UiAutomationProviderEnabled` (supported through Chrome 146) [V]. Chromium builds its accessibility tree lazily; a `WM_GETOBJECT` to the render widget activates it, so the first query can be slow or thin [R] | [V/R] |
| Electron apps (Teams, Slack) | As Chromium, lazily activated | [R] |
| Java Swing/AWT | Opaque unless Java Access Bridge is enabled (`jabswitch -enable`) and the bridge's bitness matches | [R, Oracle docs via digest] |
| Remote client windows (mstsc, msrdc, Citrix) | One opaque window/pane | §6.4 |

**Web apps (QuicklySign, AppSheet, ProfSoft if it is web-based) [I].** UIA on Chromium gives DOM-derived names and roles. The browser's address-bar value through UIA gives the URL, which is valuable context for Claude. Redact query strings by policy.

**Caseware toolkit: unknown.** No public source found. Spike: run Inspect.exe or Accessibility Insights on Caseware Working Papers if a demo licence is available, or ask Moore for a 10-minute screen share.

### 6.3 A UIA quality score per click [I]

Mark a target `opaque` when:
- the resolved element is the top-level window itself, or a nameless `Pane`/`Custom`; or
- its bounding rectangle covers more than about 60% of the window; or
- the process is a known remote client.

Opaque targets trigger the OCR fallback (§7.3) on a crop around the click. This makes target quality visible in the package rather than silently poor.

### 6.4 Detecting remote-session windows [I]

Classify the foreground process by image name: `mstsc.exe` (classic RDP client), `msrdc.exe` (Remote Desktop / Windows App client, used for AVD and RemoteApp), and Citrix Workspace processes such as `wfica32.exe` and `CDViewer.exe`. These names are from memory; confirm them in the spike. When the foreground is a remote client, set `target.source = ocr`, record "remote session: <client>", and skip the UIA call.

Windows 11 has a `RemoteAutomationClientSession` API for "a host application (such as the remote desktop app running on the local machine) to plug in and implement named pipe sharing with a remote session" [V]. That is plumbing for the *client vendor*, not something we can use against mstsc or Citrix today [I]. Watch it as a future signal.

---

## 7. Remote Desktop, RemoteApp and Citrix

### 7.1 Two topologies

| | **A. Recorder on the user's PC, app in a remote window** | **B. Recorder installed inside the VDI or session host** |
|---|---|---|
| Typical case | Vendor-hosted ProfSoft over RDP/RemoteApp/Citrix | Firm-run Citrix/AVD desktop where staff work all day |
| UIA | **Blind** to remote controls. Only the client window is visible [I; consistent with Microsoft and UiPath both needing an in-session runtime [V/R]] | Works, because the apps are local to the session |
| Mouse hook | Should see local clicks over the remote window [I, spike] | Works inside the session [I] |
| Hotkeys | May be swallowed by the client in full screen [R/I] | Normal [I] |
| Capture exclusion | Should work, because the local DWM composes [I; IOActive's failure case is the recorder running *inside* RDP] | **May fail open** (DWM in RDP) [V, IOActive], so the overlay may appear in frames |
| Install | Normal | Needs the host owner's approval. For vendor-hosted ProfSoft this is unlikely [I] |
| Known UIA reports | n/a | A UIA app failing inside a RemoteApp session on Server 2022 while it worked in a full-desktop session [R, unanswered Microsoft Q&A] |

### 7.2 What the recorder should do in topology A [I]

1. Detect the remote client (6.4) and badge the step "remote app: no control data".
2. Keep pre-click, post-click and crop frames at full resolution. These are what Claude reads.
3. Run local OCR on the crop around the click and on the window title bar, to give a text label ("clicked near 'Post Journal'") and to drive PII-redaction suggestions in review.
4. Prompt for narration on remote steps. ("This is a remote app. Say what you clicked and why.") The comment and narration features carry more weight here.
5. Later: a vision model on the exported package (Claude) as the authoritative reader. The package format should carry everything vision needs: frames, click point, crop, OCR words with boxes, narration transcript.

### 7.3 Local OCR options on Windows

| Option | Facts | Fit |
|---|---|---|
| `Windows.Media.Ocr` (legacy WinRT OCR) | "Only supported for desktop apps with package identity", meaning MSIX or identity through packaging with external location [V]. Developers report it works from unpackaged Win32 code, but whether that is supported is questioned [R]. Uses installed OCR language packs, on-device [R]. | Good quality and free. **Spike: does it work from the unpackaged helper?** If not, grant identity through "packaging with external location" (Windows 10 2004 and later [R]) or ship as MSIX. |
| Windows App SDK `TextRecognizer` | "Run exclusively on devices with a neural processing unit (NPU)" [V]. | **Not viable for a fleet** of ordinary laptops. |
| tesseract.js (WASM) | Cross-platform, no identity needed, the same code on macOS [I]. | Fallback, and the cross-platform baseline. |
| Claude vision at processing time | Works on the exported package only, which fits the local-first rule [I]. | The primary *understanding* path for remote apps. Local OCR is for labels, search and redaction. |

---

## 8. Narration (microphone) on Windows

- Desktop apps need "Let desktop apps access your microphone" turned on. A policy ("Let Windows apps access the microphone", Pro/Enterprise/Education) can manage it [R, Microsoft Support via digest].
- Insider builds are adding per-desktop-app camera and mic controls (reported August 2026) [R], so expect a per-app toggle in future.
- Recommendation [I]: handle `NotAllowedError` from `getUserMedia` with a clear message and a button that opens `ms-settings:privacy-microphone`. Narration must be optional, and a recording without it must still be valid.

---

## 9. Signing, SmartScreen, installers, AV/EDR, enterprise controls

### 9.1 Code signing and SmartScreen

From Microsoft "Code signing options" (updated 2026-11-10) [V]:

| Option | Cost | Availability | SmartScreen |
|---|---|---|---|
| Microsoft Store (MSIX) | Free; Store re-signs | Worldwide | No warnings |
| Azure Artifact Signing | ~$9.99/month | Orgs: USA, Canada, EU, UK. Individuals: USA, Canada | Reputation builds over time |
| OV certificate | $150-300/year | Worldwide | Same as Artifact Signing |
| EV certificate | $400+/year | Worldwide | "Same as OV since 2024 - no longer instant bypass" |

Further facts:
- Since June 2023, OV keys must be in an HSM or hardware token; most CAs offer a cloud HSM [V].
- No manual SmartScreen reputation boosts. Reputation is per certificate and per file hash [R].
- There is no supported way to transfer reputation across a certificate renewal [R, 2026 Microsoft Q&A].
- An April 2026 user report says Trusted Signing binaries started showing "Unrecognized app" after an intermediate CA change [R].
- Maximum certificate validity is 460 days from 2026-03-01 [R].

**Recommendation [I]:**
- If Warp has no US, Canada, EU or UK entity, buy an **OV certificate on a cloud HSM** that works from GitHub Actions (for example SSL.com eSigner [R], DigiCert KeyLocker, or GlobalSign with Azure Key Vault). Sign *every* PE file: the main exe, the helper exe, `.node` files, the installer and the uninstaller.
- Keep one publisher identity across releases so reputation accumulates.
- **For Moore, deploy through IT (Intune/GPO) rather than browser downloads.** SmartScreen's download prompt is driven by Mark-of-the-Web on downloaded files, which managed deployment does not apply. That is an inference; confirm with Moore IT.
- **The Microsoft Store (MSIX) is a credible later path.** It is free, gives no SmartScreen warnings [V], and grants package identity. Identity unlocks `Windows.Media.Ocr` support and the borderless WGC capability [V]. It costs Store review friction.

### 9.2 Installer choice

Facts:
- electron-builder: **NSIS** is the default and recommended target, with per-user (default) or per-machine install and electron-updater support [R, electron-builder docs via digest].
- Squirrel.Windows is "legacy (not recommended)" [R].
- An MSIX target is reported as beta in electron-builder v27 [R]. The current npm release is 26.18.0 [V], so v27 is not the shipping version today; until then MSIX goes through the AppX target or separate tooling.
- Plain MSI is not supported by electron-updater; `msi-wrapped` wraps NSIS for enterprise deployment [R].
- If you ship separate x64 and arm64 builds, both write `latest.yml`, so name the channels per arch [R].
- npm latest versions on 2026-11-21: electron 45.4.1, electron-builder 26.18.0, @electron-forge/cli 8.0.1 [V]. Electron supports the latest three majors on an 8-week cadence [R], so 43 to 45 are supported today and we must budget for upgrades.

**Recommendation [I]:**
- NSIS through electron-builder.
- A per-machine build for IT deployment (Program Files is AppLocker- and EDR-friendly).
- A per-user build for pilots.
- Auto-update controllable by policy (IT may want to pin versions in an IRBA-regulated firm).
- Plan MSIX as the Store/identity track after v1.

### 9.3 AV/EDR false positives

Facts:
- In 2022 Defender falsely flagged many Electron apps (Behavior:Win32/Hive.ZY) until a signature update [R].
- In 2026 there were forum reports of Defender blocking `node.exe`/`electron.exe` [R].
- Elastic Defend detects keystroke capture via `SetWindowsHookEx`, `GetAsyncKeyState` and keyboard raw input. Conditions include unsigned callers or callers outside trusted paths [V].
- Elastic's page does not cover mouse hooks [V].

Mitigations [I]:
1. No keyboard hook (5.3).
2. Sign everything; no packers or obfuscation on the helper.
3. Install per-machine for production.
4. Submit release binaries to Microsoft's Defender portal (WDSI) for analysis before each release.
5. Ask Moore IT for the EDR vendor and pre-arrange an allowlist by publisher certificate.
6. Name the helper exe and file description honestly ("Workflow Recorder accessibility helper").

### 9.4 Other enterprise controls [I]

- AppLocker or WDAC may block user-profile executables [R], which pushes towards the per-machine install.
- Group Policy may disable microphone access (§8).
- The Chrome/Edge policy `UiAutomationProviderEnabled` (revert to the old MSAA-to-UIA bridge) was supported only through Chrome 146 [V]. On Chromium's 4-week cadence, 146 shipped in early 2026 and current Chrome is around 154 [I], so native UIA is now the only path. That is good for us.
- Corporate screen-capture restrictions (DLP products) may block or black out capture. Spike with Moore's actual endpoint stack.

---

## 10. CI on GitHub Actions and Windows evidence

Facts:
- **Runner images.** `windows-latest` and `windows-2025` moved to Visual Studio 2026 by default between 2026-06-08 and 2026-06-15. A `windows-2022` image remains [R, GitHub changelog via digest].
- One blog says VS 2026 18.3.1+ dropped the Windows 10 SDK from the installer [R, unverified].
- node-gyp needed 12.1.0+ to detect VS 2026, and Electron bumped node-gyp to ^12.3.0 [R].
- **Prefer prebuilt binaries.** uiohook-napi ships prebuilds for `win32-x64` and `win32-arm64` (and darwin/linux) [V, tarball]. A C# net48 helper needs no node-gyp at all [I].
- **Interactive desktop.** GitHub-hosted Windows runners are reported to provide an interactive desktop session, so UIA tests and input injection work. Containers and Session 0 do not [R, third-party sources].
- Microsoft's `winapp ui` docs say input-injecting verbs "need an unlocked, interactive desktop with the target window in the foreground", while UIA-pattern verbs are "headless/locked-session friendly" [V].
- No GPU on hosted runners, and a single virtual display [I]. **Mixed-DPI and multi-monitor cannot be tested in CI.**
- **Arm64 builds** can be cross-built on an x64 Windows runner. Native modules must be rebuilt for arm64 [R, electron-builder docs]. GitHub also offers a `windows-11-arm` image, which moved to VS 2026 from 2026-09-21 [R].

**Recommended CI plan [I]:**
1. `pnpm test` (unit tests, platform-neutral) on ubuntu, macos and windows.
2. A Windows job that builds the C# helper, then runs a **helper integration test**:
   - launch a tiny WinForms/WPF test app with known control names;
   - drive clicks into it (with `winapp ui click` or `SendInput`);
   - assert that the helper's JSON output names the right controls with correct physical bounding rectangles.
3. A Windows job that packages NSIS x64 and arm64 artefacts, signs them (once the certificate exists), and uploads them for the VM smoke test.
4. The VM smoke test (manual, owner): the arm64 build *and* the x64 build under emulation, on the Parallels Windows 11 on Arm VM.
5. **Before any Moore pilot: one real x64 Windows laptop with an external monitor at a different scale factor.**

---

## 11. Electron vs Tauri on Windows (for this product)

| Concern | Electron | Tauri 2 (`@tauri-apps/cli` 2.12.6 [V, npm]) |
|---|---|---|
| Transparent click-through overlay | Documented: `setIgnoreMouseEvents` with mouse-move `forward` on Windows [V], `setShape` [V] | `set_ignore_cursor_events` exists. When ignoring, the window gets no mouse events, so hover needs cursor polling [R, Tauri issue #9250]. A report says click-through failed on a transparent child webview [R, #11461] |
| Exclude from capture | `setContentProtection` maps to `WDA_EXCLUDEFROMCAPTURE` [V] | `set_content_protected` exists [R]; the flag used is not confirmed |
| Screen capture | Built in on both OSes (`desktopCapturer`, `getDisplayMedia`) [V] | None built in. Write Rust per OS (WGC/DXGI on Windows, ScreenCaptureKit on macOS). More work, but full control (border, cursor, exclusion) [I] |
| UIA / AX | Out-of-process helper (§6.1) | Rust in-process on a worker thread (`uiautomation` crate) [R]. Still needs timeouts [V] |
| Renderer consistency | Bundled Chromium, identical on both OSes [R] | WebView2 on Windows and WKWebView on macOS, so two engines to QA [R] |
| Size and memory | Large (installers around 100-200 MB reported) [R] | Much smaller (around 10 MB installers reported) [R] |
| Implementer fit (Sonnet, TypeScript-first) | Strong | Rust and COM interop is harder [I] |
| Windows signing and installers | electron-builder NSIS/MSIX/MSI, mature [R] | Tauri bundler NSIS/MSI [I] |

**Verdict for Windows [I].** Electron is lower risk. Every Windows overlay and capture primitive we need is documented, and the hard native part (UIA plus hook) is needed in both shells. Tauri becomes attractive only if the spike shows Electron's Chromium capturer cannot meet a requirement (for example an unremovable WGC border or capturer instability) *and* we want native WGC control. The stdio helper keeps that option open.

---

## 12. Risk register (Windows)

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | ProfSoft (or Caseware) runs in RDP/Citrix, so snap-to-control is blind for core workflows | **High** | Detect remote clients; frames plus crop plus local OCR plus narration prompts; Claude vision at processing; confirm the delivery mode before the capture lane; make `target.source` first-class in the schema |
| R2 | The smoke VM is Arm64 and CI is x64 headless, so x64 interactive, mixed-DPI and GPU behaviour is untested | **High** | Build arm64 and x64; smoke both in the VM; mandatory real x64 laptop smoke before the pilot; state the limit in lane acceptance 3 |
| R3 | EDR flags the recorder as a keylogger or quarantines it | **High** | No keyboard hook; mouse-only helper; sign everything; per-machine install; WDSI submission; pre-arranged allowlist with Moore IT |
| R4 | The low-level hook is silently removed after a slow callback, and recording silently loses clicks | **High** | Enqueue-only hook thread; UIA on a worker with short timeouts; watchdog with auto-reinstall; a visible "click capture healthy" indicator; consider raw input |
| R5 | Mixed-DPI or negative-coordinate monitors misplace highlights and element boxes | Med-High | Per-Monitor V2 helper; physical coordinates in the package; one overlay per display; a dedicated spike test matrix |
| R6 | Elevated windows and UAC prompts produce gaps | Medium | Detect integrity level; toolbar notice; `gap` events; narration prompt; no UIAccess |
| R7 | The overlay appears in captured frames (RDP host, GPU-less VM, Windows older than 2004) | Medium | Start-of-recording exclusion self-test; fall back to hiding the overlay during frame grabs; require Windows 10 2004 or later |
| R8 | SmartScreen warnings and no Artifact Signing for a South African entity | Medium | OV on cloud HSM; IT-managed deployment; consider the Store/MSIX track; confirm Warp's jurisdiction |
| R9 | AppLocker/WDAC blocks per-user installs | Medium | Per-machine installer for production |
| R10 | Hotkeys swallowed by a full-screen Citrix/RDP client | Medium | Toolbar and tray mouse paths for every action; rebindable hotkey; spike test |
| R11 | The overlay loses topmost to other topmost windows (Citrix full screen, Teams share bar, PowerPoint show) | Medium | Re-assert topmost on foreground changes; test each competitor |
| R12 | UIA call blocks on a hung app (default 20 s) | Medium | Out-of-process helper; `TransactionTimeout` about 1.5 s; per-call deadline in the Electron supervisor; restart the helper on hang |
| R13 | Stale element: UI changed before the lookup | Medium | Hit-test at mouse-down; hover cache; record `resolved_at_ms` vs `click_at_ms` |
| R14 | Opaque toolkits (Delphi custom grids, Java without JAB, canvas apps) give useless targets | Medium | UIA quality score, then the OCR fallback; document the JAB enablement option |
| R15 | Typed-text capture leaks sensitive values | Medium | Skip `IsPassword`; truncate by default; show everything in review with one-click blanking; policy switch to disable |
| R16 | Electron upgrade churn (8-week majors, 3 supported) and VS 2026 toolchain changes | Low-Med | Avoid in-process native addons; pin the Electron major; scheduled upgrade lane |
| R17 | Mic blocked by privacy settings or GPO | Low | Clear error with a settings deep link; narration optional |
| R18 | Virtual-desktop switch leaves the overlay behind | Low | `IVirtualDesktopManager` detection and move; spike |
| R19 | WGC yellow border appears in the user's view while recording | Low | Accept it as a recording indicator, or take the MSIX identity path for borderless; spike which capturer Electron uses |

---

## 13. What the Windows spike must prove

Run on (a) the Parallels Windows 11 on Arm VM, with both arm64 and x64 builds, and (b) at least one real x64 Windows 11 laptop with an external monitor at a different scale factor. Timebox: 3 to 4 days for the Windows part. Each item has a pass criterion.

| ID | Prove | Pass criterion |
|---|---|---|
| W1 | Transparent, frameless, non-focusable overlay per display; click-through in observe mode; mouse capture in annotate mode | Clicks pass through to Notepad/Excel under the overlay; drawing works in annotate mode; the recorded app never loses focus when the overlay shows (`showInactive`) |
| W2 | Mixed-DPI correctness | 100% primary plus 150% secondary placed *left* of the primary: a highlight drawn around a UIA bounding rectangle lines up within 2 physical px on both monitors |
| W3 | Capture exclusion | Frames captured with `setContentProtection(true)` contain no overlay or toolbar pixels on real hardware; record the VM result separately; the self-test marker detects failure |
| W4 | Capture backend | Log which Chromium capturer is used (DXGI or WGC); note any yellow border; capture 2 displays at 2-5 fps for 30 min without leaks (memory growth under 100 MB) |
| W5a | Mouse-only hook in the helper, worker isolation | 500 scripted clicks in 5 minutes are all captured, with timestamps; a forced 5 s stall in the *UIA worker* leaves the hook alive (no lost clicks; the elements resolve late or time out); compare position skew with raw input |
| W5b | Silent hook removal is detected | A test-only switch makes the *hook callback* sleep over 1 s; the watchdog detects the dead hook within 2 s, reinstalls it, logs a `hook_lost` gap, and the toolbar health indicator turns amber |
| W6 | Click-to-element latency and accuracy | p95 click-to-resolved under 150 ms, and over 95% correct element names, on: Notepad, Explorer, Excel ribbon and cells, Outlook, Edge (a web form), Chrome, a WinForms test app, a WPF test app; report Excel cell behaviour explicitly |
| W7 | Caseware (if a licence is available) and any Delphi/Java app at hand | Document what UIA returns (Inspect/Accessibility Insights screenshots), with a quality score per screen |
| W8 | Remote client behaviour | With an mstsc session and (if possible) a Citrix Workspace session in windowed *and* full-screen modes: (a) local mouse hook sees clicks; (b) UIA returns only the client window; (c) global hotkey fires or not; (d) the overlay stays on top or not; (e) OCR on the click crop returns the label text |
| W9 | Elevated window handling | With Task Manager (elevated) in the foreground: the helper reports `elevated_window`; the notice shows; frames still capture; no crash |
| W10 | UAC secure desktop | Triggering UAC produces a `secure_desktop` gap event and recording resumes cleanly |
| W11 | Typed-text via UIA | Typing into an edit field emits `typed_into` on focus loss; a password box emits nothing |
| W12 | OCR | `Windows.Media.Ocr` from the unpackaged helper works or fails (document which); tesseract.js crop OCR time is under 500 ms per crop |
| W13 | Microphone | Narration records; with the desktop-app mic toggle off, the app shows the guidance message |
| W14 | Packaging and AV | Signed (test certificate) NSIS per-user and per-machine installers install, run and uninstall on Windows 11 with Defender on and no detection; on any detection, record the name |
| W15 | Arm64 | The arm64 build runs natively in the VM with the helper working (net48 on Arm64 or a Rust arm64 build); the x64 build runs under emulation |
| W16 | Topmost competition | The overlay stays above a full-screen Citrix/RDP window, a PowerPoint slide show and the Teams share bar, or re-asserts within 1 s |
| W17 | Keyboard-only steps | A scripted process with no clicks after the first (Tab through a form, type values, Enter, Ctrl+S in Notepad) yields one step per focus change or screen change, each with before/after frames and the field values (non-password) |

**Spike exit decision.**
- **On the owner's fixed evidence (VM plus CI):** if W1-W6 and W14 pass in the Windows 11 on Arm VM (both builds) and the helper integration test passes on the x64 CI runner, the verdict is **provisional go**: confirm Electron plus the C# (or Rust) helper and start the lanes.
- **Before any Moore pilot:** re-run W1-W6, W14 and W16 on a real x64 laptop with mixed-DPI monitors. This is a **pre-pilot gate**, not a spike blocker. If no laptop is available (open question 5), the pilot carries R2 as an accepted risk, signed off by the owner.
- If W3/W4 fail in ways the Chromium capturer cannot fix, re-evaluate a native WGC capture inside the helper before switching shells.

---

## 14. Effects on the lanes (suggested)

- **Core (schema):**
  - Add `target.source`, `target.reason`, `target.confidence`, and the `gap` event types (`elevated_window`, `secure_desktop`, `remote_session`, `withheld_by_app`, `hook_lost`).
  - Add a physical-pixel coordinate space plus a display map.
  - Annotations are vectors, not burnt in.
- **Capture plus native helpers:** split Windows into its own bounded sub-lane:
  - Files: `recorder/native/windows/**` and a CI integration test.
  - Acceptance: the W5a, W5b, W6, W11 and W17 subset runs in GitHub Actions against a test app.
- **Overlay plus narration:** per-display overlays, the two modes, the exclusion self-test, toolbar and tray parity for every hotkey action.
- **Packaging plus CI:**
  - NSIS x64 and arm64, per-user and per-machine.
  - Signing hook ready for an OV cloud HSM.
  - Lane acceptance 3 explicitly records "VM is Windows on Arm; x64 real-hardware smoke done or deferred".

---

## 15. Open questions for the owner

1. Which jurisdiction is Warp Development's legal entity in? This decides Artifact Signing vs an OV certificate.
2. How do Moore staff reach ProfSoft (thick client, browser, RDP/RemoteApp, Citrix)? Caseware local or Citrix?
3. Does Moore use Intune or GPO, which EDR, and do staff have local admin?
4. Is capturing *typed text* (via UIA, not keystrokes, passwords excluded) acceptable to Moore and IRBA/POPIA counsel, or should v1 capture no text at all? Separately, do we want an opt-in "record keyboard shortcuts, not text" mode? It needs a keyboard hook, which carries EDR keylogger heuristics and POPIA cost.
5. Can we get one real x64 Windows laptop (ideally a Moore-standard image) for pre-pilot smoke tests?
6. Is a Microsoft Store/MSIX track acceptable later, for identity-dependent features and no SmartScreen?

---

## 16. Sources (all accessed 2026-11-21)

Primary pages opened [V]:
- Microsoft Learn, SetWindowDisplayAffinity: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity (page updated 2025-07-01)
- Microsoft Learn, LowLevelMouseProc: https://learn.microsoft.com/windows/win32/winmsg/lowlevelmouseproc (updated 2026-02-24)
- Microsoft Learn, Security Considerations for Assistive Technologies (UIAccess): https://learn.microsoft.com/windows/win32/winauto/uiauto-securityoverview (updated 2026-02-19)
- Microsoft Learn, Understanding Screen Scaling Issues (UIA physical coordinates): https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-screenscaling (updated 2025-07-16)
- Microsoft Learn, IUIAutomation2::TransactionTimeout (default 20 s): https://learn.microsoft.com/en-us/windows/win32/api/uiautomationclient/nf-uiautomationclient-iuiautomation2-get_transactiontimeout
- Microsoft Learn, Code signing options for Windows app developers: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options (updated 2026-11-10)
- Microsoft Learn, GraphicsCaptureSession.IsBorderRequired: https://learn.microsoft.com/en-us/uwp/api/windows.graphics.capture.graphicscapturesession.isborderrequired (updated 2026-07-23)
- Microsoft Learn, Windows.Media.Ocr namespace (package identity remark): https://learn.microsoft.com/uwp/api/windows.media.ocr
- Microsoft Learn, Text recognition in the Windows App SDK (NPU only): https://learn.microsoft.com/en-us/windows/ai/apis/text-recognition (updated 2026-10-01)
- Microsoft Learn, RemoteAutomationClientSession: https://learn.microsoft.com/en-us/uwp/api/windows.ui.uiautomation.core.remoteautomationclientsession
- Microsoft Learn, winapp CLI UI automation: https://learn.microsoft.com/en-us/windows/apps/dev-tools/winapp-cli/ui-automation (updated 2026-11-09)
- Microsoft DevBlogs, winapp CLI v0.5.0 (2026-07-22): https://devblogs.microsoft.com/ifdef-windows/windows-app-development-cli-v0-5-0-expanded-ui-automation-js-ts-bindings-and-more/
- Microsoft Learn (archived), Power Automate: More resilient UI automation in Citrix environments (2022): https://learn.microsoft.com/en-gb/power-platform-release-plan/2022wave2/power-automate/more-resilient-ui-automation-citrix-environments
- Electron docs, BaseWindow: https://www.electronjs.org/docs/latest/api/base-window
- Electron docs, desktopCapturer: https://www.electronjs.org/docs/latest/api/desktop-capturer
- Chrome for Developers, Native UI Automation for Windows in Chromium (2025-08-14): https://developer.chrome.com/blog/windows-uia-support-update
- IOActive, The DRM Flag That Isn't DRM (2026-09-03): https://www.ioactive.com/the-drm-flag-that-isnt-drm/
- Elastic Security Labs, Protecting your devices from information theft: keylogger protection (2024-05-30): https://www.elastic.co/security-labs/protecting-your-devices-from-information-theft-keylogger-protection
- Microsoft Q&A, Electron load failed when set uiAccess true (2022-07-15): https://learn.microsoft.com/en-us/answers/questions/928187/electron-load-failed-when-set-uiaccess-true
- Third-party research note, Canvas Page Click-Through Research: https://tangled.org/burrito.space/peek/blob/main/notes/click-through-research.md (opened; secondary content, so its claims are tagged [R])
- npm registry (own checks, 2026-11-21): uiohook-napi 1.5.5 (published 2026-03-21; prebuilds win32-x64/arm64; `input_hook.c` lines 653-654 install WH_KEYBOARD_LL and WH_MOUSE_LL); koffi 3.3.8; electron 45.4.1; electron-builder 26.18.0; @electron-forge/cli 8.0.1; @tauri-apps/cli 2.12.6
- Local machine check: `uname -m` = arm64, CPU = Apple M4

Reported via search digests or secondary sources [R]:
- GitHub changelog, upcoming image migrations (windows-latest to VS2026, June 2026): https://github.blog/changelog/2026-05-14-github-actions-upcoming-image-migrations
- GitHub changelog, Windows 11 arm64 VS2026 image: https://github.blog/changelog/2026-08-20-windows-11-arm64-vs2026-image-generally-available
- node-gyp VS 2026 detection issue: https://github.com/nodejs/node-gyp/issues/3282 ; Electron PR bump node-gyp: https://releases.electronjs.org/pr/51512
- electron-builder target guide: https://www.electron.build/docs/targets ; NSIS: https://www.electron.build/docs/nsis ; multi-arch: https://www.electron.build/docs/architecture
- Electron Windows on ARM: https://electronjs.org/docs/latest/tutorial/windows-arm
- Electron screen API: https://www.electronjs.org/docs/latest/api/screen ; Chromium DIP conversion: https://chromium.googlesource.com/chromium/src/+/main/docs/ui/display/display_conversion.md
- Electron content-protection fixes: https://releases.electronjs.org/pr/47020 , https://releases.electronjs.org/pr/47033
- Electron issue #1335 (click-through regions): https://github.com/electron/electron/issues/1335
- Electron timelines and support policy: https://electronjs.org/docs/latest/tutorial/electron-timelines
- WebRTC WGC flag split: https://webrtc.googlesource.com/src/+/c3a74024bf4d1be1a9b92bd4ab6a9aa0211bef8b
- Microsoft Q&A, low-level mouse hook blocked by Task Manager (UIPI): https://learn.microsoft.com/en-in/answers/questions/2259268/blocking-mouse-hook-for-a-vb-net-application-when
- Microsoft Q&A, UIA app fails in RemoteApp session on Server 2022: https://learn.microsoft.com/en-us/answers/questions/1296647/why-an-application-using-ms-ui-automation-does-not
- UiPath, Automating Citrix technologies: https://docs.uipath.com/studio/standalone/latest/user-guide/automating-citrix-technologies
- Citrix Workspace app for Windows, keyboard: https://docs.citrix.com/en-us/citrix-workspace-app-for-windows/keyboard
- Caseware Working Papers getting started guide: https://www.caseware.com/docs/en/desktop/working-papers/setup/installation/wp-getting-started-guide
- Microsoft Learn, .NET Framework on Windows 10/11: https://learn.microsoft.com/dotnet/framework/install/on-windows-10 , https://learn.microsoft.com/dotnet/framework/install/on-windows-11
- Microsoft Learn, grant identity to non-packaged apps: https://learn.microsoft.com/windows/apps/desktop/modernize/grant-identity-to-nonpackaged-apps
- Microsoft Q&A, Windows.Media.Ocr from Win32 without identity: https://learn.microsoft.com/en-us/answers/questions/4354/is-the-ocr-api-supported-from-win32-applications-w
- Office UIA Excel custom properties/patterns: https://learn.microsoft.com/en-us/office/uia/excel/excelcustomproperties ; Accessing spreadsheet content: https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-accessingspreadsheetcontent
- FlaUI FAQ and README (UIA2 vs UIA3): https://github.com/FlaUI/FlaUI/wiki/FAQ
- Descolada UIAutomation wiki, pitfalls (Chromium activation): https://github.com/Descolada/UIAutomation/wiki/08.-Common-pitfalls;-tips-and-tricks
- DelphiUIAutomation TAutomationStringGrid: https://github.com/jhc-systems/DelphiUIAutomation/wiki/TAutomationStringGrid ; DevExpress VCL accessibility: https://docs.devexpress.com/VCL/405004/ExpressCrossPlatformLibrary/accessibility-support
- Oracle jabswitch / Java Access Bridge: https://docs.oracle.com/en/java/javase/24/docs/specs/man/jabswitch.html
- Rust uiautomation crate: https://lib.rs/crates/uiautomation
- node-winautomation: https://www.pkgstats.com/pkg:node-winautomation
- koffi docs: https://unpkg.com/koffi@3.1.1/doc/index.md
- Tauri issues #9250 and #11461: https://github.com/tauri-apps/tauri/issues/9250 , https://github.com/tauri-apps/tauri/issues/11461 ; Tauri content protection PR: https://www.github.com/tauri-apps/tauri/pull/5132
- Tauri vs Electron benchmarks (secondary): https://dev.to/gethopp/tauri-vs-electron-performance-bundle-size-and-the-real-trade-offs-1el4 , https://betterstack.com/community/guides/scaling-nodejs/tauri-vs-electron-vs-deno-vs-electrobun/
- AppLocker default rules: https://learn.microsoft.com/en-us/windows/security/application-security/application-control/app-control-for-business/applocker/create-applocker-default-rules
- Microsoft Support, microphone app permissions: https://support.microsoft.com/windows/turn-on-app-permissions-for-your-microphone-in-windows-94991183-f69d-b4cf-4679-c98ca45f577a ; Windows Latest on per-app mic controls (2026-08-19): https://windowslatest.com/2026/08/19/windows-11-is-getting-a-major-privacy-upgrade-blocks-apps-spying-on-your-camera-and-mic-with-new-controls
- SmartScreen reputation: https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation ; reputation reset on renewal Q&A: https://learn.microsoft.com/en-us/answers/questions/5900208/smartscreen-reputation-reset-following-ev-certific ; Trusted Signing regression Q&A: https://learn.microsoft.com/en-us/answers/questions/5855708/trusted-signing-regression-in-smartscreen-reputati
- CA/B Forum ballot CSC-31 (460-day max): https://cabforum.org/2025/11/17/ballot-csc-31-maximum-validity-reduction
- SSL.com eSigner GitHub Actions: https://ssl.com/how-to/cloud-code-signing-integration-with-github-actions
- Parallels Windows 11 on Apple silicon (Microsoft-authorised): https://www.parallels.com/products/desktop/microsoft-authorized-solution-windows-11-arm/
- Defender false positive on Electron apps (2022): https://www.theregister.com/2022/09/05/windows_defender_chrome_false_positive
- uiAccess window bands (community): https://www.autoitscript.com/forum/topic/210526-make-your-program-super-topmost-uiaccess-udf
- GitHub-hosted Windows runner interactive desktop (third-party): https://jerrettdavis.github.io/Flawright/troubleshooting.html
