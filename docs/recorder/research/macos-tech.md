# macOS technical feasibility: Workflow Recording Assistant

Research lane: `macos-tech`. Researched and written 2026-11-21. Planning input only: no product code.

## How to read this document

Every claim carries one evidence tag:

- **[P]** Primary. A page I fetched states it: Apple docs, Electron docs or releases, a source file, or an Apple DTS/engineer reply in a forum thread I read.
- **[S]** Secondary. A search-result snippet, a vendor or blog article, or a forum report from a developer (not Apple). Treat it as likely but unconfirmed.
- **[I]** Inference. My engineering judgement, not backed by a source here. Each one should become a spike check or a design decision.

The full source list with dates is at the end (section 15).

---

## 1. Verdict in ten lines

1. **The task said "macOS 15/26 era"; the current release is macOS 27 "Golden Gate".** It shipped 2026-09-14, and 27.2 shipped 2026-10-26 [S]. Plan for macOS 14, 15, 26 and 27. A 27.3 beta is in testing now, and a developer reports a screen-recording permission regression in it (section 4.4) [S: thread read in full; Apple did not confirm].
2. **Electron + TypeScript + React holds up on macOS, but only with a native Swift helper.** The helper is a core component, not an option. Three jobs cannot be done well from Electron/Node alone: a stable global input hook, accessibility hit-testing, and screen capture that leaves out our own overlay [I, built on 3 to 5 below].
3. **`setContentProtection` does not hide a window from ScreenCaptureKit, and Apple says there is no public API that prevents capture** [P]. The only way to keep our overlay out of the recording is to filter on the capture side, in our own `SCStream`/`SCScreenshotManager` with `SCContentFilter(... excludingApplications:)`. That requires native code [S for the filter API, I for the conclusion].
4. **The obvious npm input hook (`uiohook-napi`) is a poor fit on macOS.** Its libuiohook, at the commit it pins, creates an **active** (`kCGEventTapOptionDefault`) session tap [P]. Revoking Accessibility while an active tap exists has been reported to **hang all keyboard and mouse input system-wide** on Sequoia, Tahoe and Golden Gate. Apple DTS asked for a Feedback report and sysdiagnose but confirmed nothing (FB24619068, Sep 2026) [S: thread read in full; Apple did not confirm]. The upstream maintainer reportedly has no Mac [S]. Use a **listen-only** tap in the Swift helper instead.
5. **Control-at-point works for native Cocoa, Office, browsers and Electron apps, with caveats.** Electron apps need `AXManualAccessibility` set [P]. Java apps expose AX with role-mapping bugs [S]. **Remote desktop and Citrix sessions will almost certainly yield only the client window, with no controls** [I]. This matters for Moore: Caseware is Windows-only, and ProfSoft's access mode is unknown. The package format therefore needs a screenshot + coordinates + OCR fallback for every click.
6. **Expect three or four macOS permissions, each needing a trip to System Settings:** Accessibility, Screen & System Audio Recording, Microphone, and possibly Input Monitoring. On top of that, macOS 15+ re-prompts monthly for screen recording, and shows a "bypass the system private window picker" alert for apps that capture directly [P/S]. For non-technical accountants this is the single biggest UX risk. It needs a guided onboarding screen, and an MDM profile for Moore where one is possible.
7. **TCC (macOS's privacy permission database) records permissions against the code-signing identity** [P]. Every developer build must be signed with a stable Apple Development identity, or permissions reset on each build [P]. We can only test properly with a Developer ID build.
8. **Overlay windows are feasible.** Electron offers `type: 'panel'` (non-activating, floats above full-screen apps, appears on all Spaces), `setAlwaysOnTop(true, 'screen-saver')`, `visibleOnFullScreen`, and `setIgnoreMouseEvents(true, {forward: true})` [P]. macOS point releases have broken transparent click-through windows before: 26.3 RC, acknowledged by Apple and fixed in the 26.3 public release [S]. Pin the Electron version, and smoke-test every macOS point release.
9. **Native Swift alone would give the best macOS result, but it doubles the UI work because Windows is a must.** Tauri saves bundle size but gains us nothing on the hard parts: those live in native helpers either way, and its overlay story on macOS is less proven [I]. Electron's single UI codebase, with per-OS native sidecars, is the right call [I].
10. **The spike must prove ten pass/fail checks on real hardware** (section 13), across macOS 15, 26 and 27, with a notarized Developer ID build. Without that build, the permission behaviour cannot be observed truthfully.

---

## 2. OS baseline (correction to the brief)

| Release | Name | Status 2026-11-21 | Notes |
|---|---|---|---|
| macOS 14 | Sonoma | Old, still common | Floor for `SCScreenshotManager` [S: Apple class page lists macOS 14.0+]. |
| macOS 15 | Sequoia | Supported | Added monthly screen-recording re-prompts, the "bypass private window picker" alert, and the Option-only hotkey block. Removed `CGWindowListCreateImage` from the SDK ("obsoleted in macOS 15.0") [S]. |
| macOS 26 | Tahoe | Supported | 26.1 hides plain (unbundled) executables from the Screen Recording list [S]. 26.3 RC broke transparent/borderless window click-through; fixed in 26.3 public [S, Apple engineer acknowledged]. |
| macOS 27 | Golden Gate | **Current**, shipped 2026-09-14; 27.2 on 2026-10-26 [S] | Reported as Apple-silicon only [S, snippet level]. 27.3 beta 2: `CGRequestScreenCaptureAccess()` reportedly shows no prompt and does not add the app to the list (FB25646769) [S: thread read in full; Apple did not confirm]. |

**Recommendation [I]:** set the minimum to macOS 14 (needed for `SCScreenshotManager`), test on 15, 26 and 27, and ship universal binaries (arm64 + x86_64): Intel Macs stay on 26 and still exist in offices. Electron 38+ needs macOS 12+ [S], so Electron does not set the floor.

---

## 3. Overlay windows (Electron on macOS)

### 3.1 What Electron offers (verified)

- **`setAlwaysOnTop(flag, level, relativeLevel)`** accepts the levels `normal`, `floating`, `torn-off-menu`, `modal-panel`, `main-menu`, `status`, `pop-up-menu`, `screen-saver`, and `dock` (deprecated). From `floating` to `status` the window sits *below* the Dock. From `pop-up-menu` upwards it sits above the Dock. Apple discourages going more than 1 above `screen-saver` [P, Electron BrowserWindow docs].
- **`setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType })`** (macOS): `visibleOnFullScreen` makes the window visible above full-screen windows. Electron's source maps it to `NSWindowCollectionBehaviorFullScreenAuxiliary` [S]. By default the call switches the process type between UIElement and Foreground, which *hides the window and Dock icon briefly on every call*. Pass `skipTransformProcessType: true` to avoid this [P].
- **`type: 'panel'`** (macOS) adds `NSWindowStyleMaskNonactivatingPanel` at runtime. The window floats above full-screen apps and appears on all Spaces [P, BaseWindowOptions docs]. A plain non-activating panel is the native recipe for an overlay that does not knock a full-screen app out of its Space [S, Apple forums]. One Apple forum answer adds that the app also needs the *accessory* activation policy, because macOS does not layer regular foreground apps above other apps' full-screen Spaces [S].
- **`setHiddenInMissionControl(true)`** keeps the overlay out of Mission Control [P].
- **`setIgnoreMouseEvents(ignore, { forward: true })`** passes clicks through to the apps below. `forward` still sends mouse-move messages to Chromium, so `mouseenter`/`mouseleave` fire. *If `ignore` is false, forwarding is always disabled* [P]. On macOS, `forward` maps to `acceptsMouseMovedEvents`, so pass `{forward: true}` again on every toggle [S, Electron commit #12281].
- **`setContentProtection(true)`**: per the Electron docs, "newer Mac applications that use ScreenCaptureKit will capture your window despite `win.setContentProtection(true)`" [P]. Apple DTS (Jul 2025): "At this time there are no public APIs for preventing screen capture" [P].
- **`enableLargerThanScreen`** matters only on macOS (default false) [P].

### 3.2 Multiple monitors and mixed scale factors

- Electron emits `display-added`, `display-removed` and `display-metrics-changed`; the last carries `bounds`, `workArea`, `scaleFactor` or `rotation` [P].
- The DIP↔screen conversion helpers (`dipToScreenPoint` etc.) are documented for Windows and Linux only [P]. This implies that on macOS, Electron coordinates are already AppKit points, with a top-left origin on the primary display [I]. AX positions and `CGEvent` locations are also global points with a top-left origin [I]. ScreenCaptureKit frames are in **pixels**: passing points where pixels are expected gives blurry captures [S, Apple forum 739593].
- **Design rule [I]:** create **one overlay window per display**, sized to that display's `bounds`, and recreate them on display events. With "Displays have separate Spaces" on (the macOS default), a window cannot reliably span displays [I]. Store every coordinate in the package as `{displayId, xPt, yPt}` plus the display's `scaleFactor` and bounds, and convert to pixels only when cropping frames.
- **Unverified (spike):** that AX frames, `CGEvent` locations and Electron `screen` bounds agree on a two-display setup with different scales (for example a Retina laptop at 2x and an external monitor at 1x), including a secondary display placed above or left of the primary (negative coordinates).

### 3.3 Annotation mode vs pass-through mode

Recommended interaction model [I]:

- **Pass-through (default while recording):** every overlay window has `setIgnoreMouseEvents(true, {forward: true})` and `focusable: false`. A small floating control bar, a separate panel window, stays clickable.
- **Annotate (toggled by hotkey or the control bar):** recording pauses, the overlay accepts mouse input (`setIgnoreMouseEvents(false)`), and the user draws a box, arrow or highlight, or clicks a control to "snap" to it (AX frame). The comment box needs keyboard focus, which activates our app. That is acceptable because we are paused, but **our own focus change must be filtered out of the event timeline** [I].
- Do not rely on hover-forwarding to decide when to switch modes. A JUCE report says macOS windows without key focus may not get mouse-moved events [S]. Electron's forwarding has had regressions before (an Electron 7 era Chromium call disabled click-through; `@loomhq/electron-click-through-workaround` exists for that) [S]. An explicit mode toggle is more robust [I].

### 3.4 Known overlay regressions to guard against

- **macOS 26.3 RC (Feb 2026):** transparent/borderless windows stopped receiving clicks, or whole transparent windows swallowed clicks. Apple Frameworks Engineer: "received several similar reports… investigating". Reported fixed in the 26.3 public release; one unconfirmed report says it returned in a 26.4 beta [S, Apple forum 814798, FB21879057 and FB21879511].
- **Electron occlusion bug (#51718):** a `transparent: true` + `setIgnoreMouseEvents(true)` window made the window under it report `visibilityState='hidden'` and get background-throttled (Chromium's heuristic, active on macOS 13.3 through 25.x). Fixed by PR #52365, merged 2026-07-18 and released in **v42.8.0, v43.2.0 and v44.0.0-alpha.5+** [P]. This affects our *own* windows under the overlay (the review UI, the control bar). Use Electron ≥ 43.2 [P/I].
- **Menu-bar clamp:** with `setAlwaysOnTop(true,'screen-saver')`, setting `y=0` on Sonoma was still pushed below the menu bar unless the window was full-screen (Electron issue #42104) [S]. Verify that the overlay can cover the menu bar. Users click menus, and those clicks are steps.
- **Electron #42133:** with `visibleOnAllWorkspaces`/`visibleOnFullScreen`, the full-screen state of one BrowserWindow disturbed another (Sonoma 14.4.1, Electron 26). Closed pending more information [S].

### 3.5 Electron version

Current stable is **Electron 45.4.1** (2026-11-19; Chromium 156.0.8078.100, Node 24.22.3). Stable lines listed: 45.x, 44.x, 43.x [P, releases.electronjs.org]. Recommendation: start on 45.x, and pin exactly in `package.json` [I].

---

## 4. Screen capture

### 4.1 API landscape

- `CGWindowListCreateImage`/`CGDisplayCreateImage` are **obsoleted in the macOS 15 SDK**, and builds fail [S, WebKit bug 277564, MacPorts 70756]. ScreenCaptureKit (SCK) is the only forward path. Apple DTS (Jul 2026) also points to `SCShareableContent` for enumerating windows [P, forum 839069].
- **`SCStream`** delivers continuous frames. **`SCScreenshotManager`** (macOS 14+) captures single frames [S, Apple class page via snippet].
- **`SCContentFilter(display:excludingApplications:exceptingWindows:)`** is what Apple's own sample code uses to exclude apps [S, snippet of Apple sample]. I did not fetch the doc page itself, so treat it as near-certain but formally unverified.
- **Electron `desktopCapturer`/`getDisplayMedia`:** I saw no option for excluding windows or apps, but did not check the docs specifically for one [I; covered by spike check C1]. Chrome's `selfBrowserSurface: 'exclude'` excludes only the current *tab* [S]. On macOS 14.2+, Electron 39+ uses the CoreAudio Tap API for system audio, which requires `NSAudioCaptureUsageDescription` [P]. We do not need system audio; leave it out to avoid that extra permission [I]. On some macOS versions `desktopCapturer.getSources` never resolves until permission is granted (Electron issue #42143) [S].

### 4.2 Keeping our overlay out of the capture

- **Fact:** window-level hiding (`sharingType = .none`, i.e. `setContentProtection`) is ignored by SCK on 15.4+ [S for the observation, P for DTS's "no public APIs"].
- **Conclusion [I]:** our own capture must exclude our own app with an `SCContentFilter` built in native code. That puts **capture in the Swift helper**, not in Electron.
- **Better design [I]: store clean frames plus annotations as vector data.** Capture frames *without* the overlay, and store highlights, arrows and comments in the package as vector data on the timeline. Compose them only when rendering a preview or export. Benefits: blur and redaction work on clean pixels; Claude gets clean screenshots plus structured annotations; the user can re-edit annotations during review. This fits "design the package format first".

### 4.3 Capturing the frame *before* the click

Once a click is observed, the UI may already have changed (a menu closes, a dialog opens). **Design [I]:** run a low-rate `SCStream` (for example 2 to 5 fps, plus frames on change) into a ring buffer covering about 2 seconds, and attach the latest frame from before the click to each step. Optionally grab a full-resolution `SCScreenshotManager` frame about 300 to 600 ms after the click as the "after" state. Video encoding, if wanted at all, can be optional, since Claude reasons over keyframes and events, not video [I].

### 4.4 Permissions: what the user will see

| Behaviour | Source |
|---|---|
| Screen capture needs consent on 10.15+ | [P] Electron docs |
| macOS 15: recurring re-confirmation for screen-recording apps. Weekly in early betas, **monthly** from beta 6; 15.1 reduced popups for regularly used apps; a clock change can re-trigger it | [S] 9to5Mac, TidBITS, MacRumors 2024 |
| macOS 15: apps capturing directly (not via the system picker) can get "*X is requesting to bypass the system private window picker and directly access your screen and audio*" with **Allow For One Month / Open System Settings**. Apple DTS reproduced it with plain `SCShareableContent` + `SCScreenshotManager` | [P] forum 765103 (Sep to Oct 2024, FB15360079) |
| DTS: the two ways to avoid that alert are the `com.apple.developer.persistent-content-capture` entitlement ("intended for screen-sharing products") or presenting `SCContentSharingPicker` | [P] forum 765103 |
| The entitlement is "intended for screen-sharing products" (DTS, 765103). A June 2026 poster says Apple grants it only for "VNC" (headless) deployments and that MDM cannot pre-grant it | [P] 765103 for the purpose; [S] forum 831795 (Jun 2026; thread read in full; Apple only acknowledged the request) |
| MDM restriction `forceBypassScreenCaptureAlert` (`com.apple.applicationaccess`, macOS 15.1+) lets managed Macs opt out of the content-capture notifications. Admins disagree on how much it suppresses | [S] Jamf, Addigy, Proofpoint, Fortinet |
| MDM PPPC **cannot pre-approve** ScreenCapture or ListenEvent (Input Monitoring). It can only deny them, or let standard users approve them (`AllowStandardUserToSetSystemService`) | [S] Kandji, Jamf, Apple forum 774625 |
| TCC ties screen-capture permission to the signing identity; ad-hoc builds look like a new app every build. DTS: "Correct" | [P] forum 819406 (Mar 2026, macOS 26) |
| macOS 27.3 beta 2: `CGRequestScreenCaptureAccess()` shows no popup and does not add the app to the list | [S] forum 858698 (FB25646769; thread read in full; DTS only said to file Feedback; no absolute date shown) |
| A Golden Gate panel reportedly appears when an app captures the full screen without the picker | [S] single blog snippet, unconfirmed |

**Options for the product [I]:**

1. **Direct capture (default):** one-time Screen Recording grant, then accept the monthly "Allow for one month" reminder. Onboarding must explain it in plain language ("macOS will ask about once a month; click Allow").
2. **System picker:** Electron's `setDisplayMediaRequestHandler(..., { useSystemPicker: true })` is **experimental, macOS 15+ only** [P]. A native `SCContentSharingPicker` in the helper would let the user pick "this display" at the start of each recording. It may avoid the bypass alert (per DTS) [P], but whether it also exempts us from the TCC grant is unverified. Whether its configuration can exclude our own app (I believe `SCContentSharingPickerConfiguration` has excluded bundle IDs and window IDs) is also unverified. Spike item.
3. **Managed Macs (Moore):** deploy `forceBypassScreenCaptureAlert`, plus PPPC with `AllowStandardUserToSetSystemService` for ScreenCapture and ListenEvent, and a PPPC **Accessibility allow**. I believe PPPC can grant Accessibility outright [I; I could not fetch Apple's PPPC page to confirm]. Ask Moore IT whether their Macs are MDM-managed.

---

## 5. Global input hooks

### 5.1 Facts

- **Which permission each tap triggers:** a *default* (active) `CGEventTap` triggers the **Accessibility** prompt; a *listen-only* tap triggers **Input Monitoring**, checked and requested with `CGPreflightListenEventAccess`/`CGRequestListenEventAccess` [S, Apple forum threads quoting DTS]. A forum reply says Accessibility already covers listening, so no separate Input Monitoring prompt appears when Accessibility is granted [S].
- Apps do not reliably appear in the Input Monitoring list after requesting it, whereas `AXIsProcessTrusted()` adds the app to the Accessibility list automatically [S].
- **libuiohook (used by uiohook-napi), at pinned commit `f259ff3`:** checks `is_accessibility_enabled()` before starting, then calls `CGEventTapCreate(kCGSessionEventTap, kCGHeadInsertEventTap, kCGEventTapOptionDefault, ...)`. That is an **active** tap; its callback can consume events [P, source fetched]. It runs `CFRunLoopRun()` on the calling thread [P for upstream branch 1.2; not re-checked at f259ff3].
- **System-wide input hang:** revoking Accessibility while an app has an active `.defaultTap` stops all local keyboard and mouse input until a forced restart, even when the callback passes every event through unchanged. Reported on Sequoia, Tahoe and Golden Gate. DTS asked for a sysdiagnose but confirmed nothing (FB24619068, Sep 2026). No fix or mitigation published [S, forum 844416; thread read in full; Apple did not confirm].
- The uiohook-napi author reportedly does not own a Mac and could not fix a macOS crash (issue SnosMe/uiohook-napi#24) [S].

### 5.2 Recommendation [I]

- Implement the hook in the **Swift helper** as a **listen-only** `CGEventTap` (mouse down/up, scroll, key down for *categories only*), on a dedicated thread with its own run loop. It must never return NULL or modify events. Handle `tapDisabledByTimeout`/`tapDisabledByUserInput`: re-enable only while still trusted, otherwise invalidate. Poll `AXIsProcessTrusted()` every 1 to 2 s during recording and tear the tap down the moment trust disappears. Create the tap only while recording.
- **Do not log raw keystrokes.** Record "typed into field X" by reading the AX value of the focused field when focus leaves it, and skip fields with role `AXSecureTextField`. Keep only Enter, Tab, Escape and modifier shortcuts (for example Cmd+S) as discrete events. Password fields engage Secure Event Input, so a tap does not see those keys anyway [I]. This respects POPIA and keeps the package readable.
- Because AX hit-testing needs Accessibility anyway, a listen-only tap should mean **Accessibility + Screen Recording + Microphone** as the full permission set, with Input Monitoring covered by Accessibility [S + I]. **The spike verifies this from a clean TCC state.**

---

## 6. Control-at-point (macOS Accessibility API)

### 6.1 How to query

- `AXUIElementCopyElementAtPosition(element, x, y, &out)`, then read `AXRole`, `AXSubrole`, `AXRoleDescription`, `AXTitle`, `AXDescription`, `AXValue`, `AXIdentifier`, `AXPosition`, `AXSize`, `AXEnabled`, `AXFocused`, the parent chain up to `AXWindow` (title) and `AXApplication` (bundle id, pid), and `AXURL`/`AXDocument` where present [I; attribute names are standard AX constants].
- **Avoid hitting our own overlay [I + S]:** querying the *system-wide* element returns the topmost window's element, which can be our overlay. A 2003 accessibility-dev thread reports exactly that [S]. Instead, find the topmost **non-self** window under the point (from `SCShareableContent` or the window list, skipping our own PID), create `AXUIElementCreateApplication(pid)`, and hit-test that app's element. Also reject any result whose PID is ours.
- **Timeouts:** AX calls are answered on the *target app's main thread*, so a busy or hung app blocks the caller. The default is about 5 s, adjustable with `AXUIElementSetMessagingTimeout` [S]. Run AX work on a background queue in the helper with a short timeout (about 250 ms), and never on Electron's main thread [I].
- **Hit-test quirks:** title bars can return `kAXErrorFailure`/null; sometimes only the application element comes back [S, old mailing-list threads]. Fall back to the window element plus the click offset.
- **Timing [I]:** hit-test continuously on cursor pauses (throttled to about 8 Hz), cache the last element under the cursor, and on mouse-down use the cached element when the point still lies inside its frame. Then re-query and keep both. This catches menus and popovers that vanish on click.
- The Accessibility API is not compatible with the App Sandbox (DTS) [S]. **Distribute outside the Mac App Store**, with Developer ID and notarization.

### 6.2 Expected quality by app type

| App type (Moore relevance) | What AX gives | Evidence |
|---|---|---|
| Native Cocoa apps, Finder, Mail | Full roles, titles, values, frames | [I], standard |
| **Electron apps** (e.g. Teams, VS Code) | Little until an assistive client sets `AXManualAccessibility = true` on the app element; then the full Chromium tree | [P] Electron accessibility docs |
| **Chrome/Edge** (QuicklySign, AppSheet, ProfSoft if browser-based) | Rich web roles once the tree is enabled. Setting `AXEnhancedUserInterface` turns it on but is known to break window managers (Magnet), so prefer letting the first AX query trigger it, and test | [S] Apple accessibility-dev list 2020; [I] |
| **Safari** | Rich web roles (WebKit) | [I] |
| **Excel / Outlook for Mac** | Excel exposes cell reference and contents to VoiceOver, so AX carries cell-level data; floating objects are poorly ordered | [S] Microsoft support, HKU toolkit. Exact AX attributes **unverified** |
| **Java (Swing) apps** | Exposed through the JDK's native bridge, with known role-mapping bugs (toggle buttons read as checkboxes, tabs as radio buttons, links as text) | [S] OpenJDK bugs 8379347, 8361283, 8309732 |
| **Remote desktop / Citrix / Parallels Coherence** (Caseware, possibly ProfSoft) | Almost certainly only the client window or canvas, with **no remote controls**. Citrix Workspace 2603 "seamless application accessibility mirroring" syncs accessibility *settings*, which is not the same as exposing the remote tree | [I]; [S] Citrix 2603 notes |

**Consequences for the package format [I]:** every click step needs:

1. `target.source`: one of `ax`, `ax-partial`, `ocr` or `manual-snap`, with a confidence score;
2. the screenshot crop around the click plus normalized window-relative coordinates;
3. text found near the click on device: Apple Vision `VNRecognizeTextRequest` in the helper [I, not researched here];
4. the user's spoken or typed comment as the human label.

Claude can rebuild the step from (2) to (4) when (1) is empty. This is the only workable path for Citrix/RDP-hosted ProfSoft or Caseware.

---

## 7. Global hotkeys

- Electron `globalShortcut` uses the system hotkey API. Media keys need Accessibility trust. **If another app already holds the accelerator, registration fails silently** and `isRegistered` returns false [P].
- **macOS 15:** `RegisterEventHotKey` with only Option or Shift+Option modifiers fails (error -9868). An Apple framework engineer called it intentional (anti-keylogging) [S, Apple forum 763878; heise; Shottr]. A claimed 15.2 reversal is unverified [S].
- **Recommendation [I]:** default to chords that include Cmd or Ctrl (for example Ctrl+Cmd+R record/pause, Ctrl+Cmd+A annotate, Ctrl+Cmd+M marker). Check registration at startup, show conflicts in the UI and let users rebind. Always offer the clickable control bar as an equal alternative; non-technical users will use it more than hotkeys.

---

## 8. Microphone and narration

- The app needs `NSMicrophoneUsageDescription` in Info.plist; `systemPreferences.askForMediaAccess('microphone')` asks for it. If the user denied earlier, they must change it in System Settings, and **the app must restart** for the new permission to apply [P].
- With hardened runtime, microphone access also needs the `com.apple.security.device.audio-input` entitlement, or the prompt never appears [S, Apple DTS quote via forum 741303 snippet; Electron code-signing docs].
- Capture with `getUserMedia` in the renderer (simple, cross-platform), or with AVAudioEngine in the helper if exact clock alignment with events matters [I]. Use one monotonic clock for all streams: the helper stamps events with `mach_absolute_time`, and its offset to the audio timeline is calibrated at start [I].
- **Transcription on device:** Apple `SpeechAnalyzer`/`SpeechTranscriber` exist on macOS 26+ and are reportedly much faster than Whisper [S]. Whether South African English (`en_ZA`) is supported is **unverified**; test with `SpeechTranscriber.supportedLocales` [S]. A Windows build needs whisper.cpp or similar anyway, so one engine on both platforms is simpler [I]. Decide in the overlay + narration lane.

---

## 9. Code signing, hardened runtime, notarization, helper packaging

### 9.1 Electron side (electron-builder)

- Notarization needs `hardenedRuntime: true`. In electron-builder v27, `hardenedRuntime`, `entitlements` and `entitlementsInherit` move under `mac.sign`; v26 is the current stable [P].
- electron-builder grants `com.apple.security.cs.allow-jit` by default. A custom entitlements file *replaces* that default, so keep `allow-jit` in it. Do not add `allow-unsigned-executable-memory` [P].
- Without `entitlementsInherit`, nested binaries get per-file defaults from @electron/osx-sign; with it, one plist applies to every nested binary. For extra binaries, use an `afterSign` hook [P].
- For CI, authenticate with an App Store Connect API key (`APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`) [P].
- Main entitlements [I]: `allow-jit`, `device.audio-input`. Main Info.plist: `NSMicrophoneUsageDescription`, plus `NSAppleEventsUsageDescription` only if we read browser URLs through Apple Events (prefer `AXURL` and avoid it).

### 9.2 Swift helper

- **Build:** a Swift Package executable, `swift build -c release --arch arm64 --arch x86_64` (universal), signed with Developer ID, `--options runtime`, and a stable identifier such as `za.co.warp.recorder.helper` [I].
- **Location:** inside the app bundle in `Contents/MacOS/` or `Contents/Helpers/`, never in `Contents/Resources/` [I; Apple's "Placing content in a bundle" page did not render in my fetch, so this is unverified]. In electron-builder, use `extraFiles` with a destination under `MacOS`/`Helpers` [I].
- **Entitlements:** none needed for AX or SCK, because those are TCC grants, not entitlements [I]. Add `device.audio-input` only if the helper records the microphone.
- **IPC:** newline-delimited JSON over stdio, with a versioned protocol (`hello{version}`, `perm.status`, `capture.start`, `event.click{...}`, `ax.at{...}`, `frame{path}`) [I]. A separate process isolates crashes: a hung AX target or an SCK crash cannot take down the UI. It also avoids rebuilding a native addon for every Electron ABI.

### 9.3 Which process TCC holds responsible (conflicting evidence)

- A child process inherits its *responsible* process's TCC grants; check with `launchctl procinfo <pid> | grep responsible`. `responsibility_spawnattrs_setdisclaim` makes a child responsible for itself (Chromium, LLDB and Qt Creator use it) [S, Qt blog 2022/2024].
- A helper bundle's Screen Recording request was shown under the *main app's* name on Ventura and Sequoia, while its Accessibility request named the helper [S, forum 725254].
- A CLI spawned from a packaged Electron app got **no prompt at all**, even with permissions added to the parent [S, Apple forum snippet].
- In macOS 26.1, plain executables are hidden from the Screen Recording list (they could still be granted) [S].

**Two designs to test in the spike [I]:**

- **A (preferred to try first):** Electron's main process spawns the helper as a plain child, not disclaimed. Permissions are requested and shown under the main app ("Workflow Recorder"), and the main Info.plist carries every usage string. The main process raises the Accessibility prompt (`systemPreferences.isTrustedAccessibilityClient(true)`) and the Microphone prompt (`askForMediaAccess('microphone')`). `getMediaAccessStatus('screen')` only *reads* status, and `askForMediaAccess` does not accept `screen` [P]. The Screen Recording prompt comes from the first capture call or from `CGRequestScreenCaptureAccess()`, which is the call reported broken on 27.3 beta 2 (section 4.4). The helper performs the work. Risk: Chromium's own helper processes and our helper may be attributed differently.
- **B:** the helper ships as its own bundled `.app` (`LSUIElement`, its own bundle id) in `Contents/Helpers/`, launched with `open -a`, or disclaimed. It gets a clean, visible TCC entry of its own. Cost: two entries in Settings ("Workflow Recorder" and "Workflow Recorder Helper"), which confuses non-technical users.

---

## 10. Stack comparison on macOS

The facts are tagged; the scoring is my inference.

| Concern | Electron + Swift helper | Tauri 2 + Swift/Rust helper | Native Swift (macOS only) |
|---|---|---|---|
| Transparent always-on-top overlay, full-screen, all Spaces | Proven APIs (`panel`, `screen-saver`, `visibleOnFullScreen`) [P]. Recent regression fixed in 43.2+ [P] | Transparency on macOS no longer needs `macos-private-api` since 2026-09-30 [S]. Click-through overlays need focus for cursor tracking (Tauri issue) [S]. NSPanel needs a plugin (`tauri-nspanel`) [S]. Less proven for this use [I] | Best: direct `NSPanel`, collection behaviours, activation policy [I] |
| Click-through + annotate toggle | `setIgnoreMouseEvents` + `forward` [P] | `set_ignore_cursor_events`; I found no forward equivalent [I] | `ignoresMouseEvents` per window [I] |
| Capture excluding our overlay | Needs the helper (SCK filter) [P/I] | Needs the helper [I] | Native [I] |
| Input hook, AX hit-test | Helper [I] | Helper (Rust can call AX/CG directly) [I] | Native [I] |
| Windows parity | One UI codebase. Windows needs its own sidecar (UIA, input hooks, capture) [I] | Same, with WebView2 on Windows vs WKWebView on macOS: two rendering engines to test [I] | **No**: a second UI to build for Windows [I] |
| Review/export editor (timeline, blur, redaction, rich UI) | React + Chromium, identical on both OSes [I] | React, but on two different web engines [I] | SwiftUI, Mac only [I] |
| Bundle size / RAM | Large (about 150 to 250 MB installed) [I] | Small [I] | Smallest [I] |
| Team fit (TypeScript-heavy, Sonnet lanes) | Best [I] | Rust skills needed [I] | Swift for everything [I] |

**Call [I]:** keep Electron + TypeScript + React, amended as follows: *a native helper per OS is a core part of the architecture* (Swift on macOS; on Windows probably C#/.NET or Rust, see the windows-tech lane). The helper owns input hooks, accessibility, capture and permissions; Electron owns the overlay drawing, control bar, review editor, package writer and PROCESS.md generator. Fall back to Tauri only if the Electron overlay fails spike checks O1 to O3 (section 13); that failure would be specific to Electron, since Tauri needs the same helper.

---

## 11. Implications for the package format (input to the core lane) [I]

- **Coordinates:** global points plus `displayId`, display bounds, `scaleFactor`, and window-relative normalized coordinates (0 to 1) so steps survive a different screen layout.
- **Each step:** `t` (monotonic ms), `kind` (click, double, right, scroll, key-chord, text-entry, app-switch, window-change, marker, comment), `app {bundleId, name, pid}`, `window {title, frame}`, `target {source, role, subrole, title, value(redacted?), identifier, frame, ancestry[]}`, `url?`, `frames {before, after}`, `annotations[]` (vector), `narration {start, end, transcript}`, `userComment`.
- **Frames are clean**, without the overlay; annotations are separate vectors; redaction is a list of rectangles applied at export. Never store an unredacted frame in the exported package.
- **Provenance and confidence on every derived field**, so Claude knows when to trust AX and when to fall back to OCR or pixels.
- **Environment block:** OS version, app versions, display layout, permission status at record time, recorder version.

---

## 12. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Permission friction: 3 to 4 TCC grants plus monthly re-prompts plus the "bypass picker" alert overwhelm non-technical users; some never finish setup | High | A guided permissions screen that checks each grant live, with screenshots of exactly what to click and a "Test recording" button. MDM profile for Moore (Accessibility allow; ScreenCapture/ListenEvent standard-user allow; `forceBypassScreenCaptureAlert`). Test the system-picker path as an alternative |
| R2 | System-wide input hang if Accessibility is revoked while an active event tap runs (FB24619068) | High | Listen-only tap in the helper; poll trust and tear down on loss; never use uiohook-napi's active tap on macOS |
| R3 | The overlay shows up in recordings (`setContentProtection` ignored by SCK) | High | Capture in the helper with an `SCContentFilter` that excludes our app; store annotations as vectors |
| R4 | Remote desktop / Citrix / Parallels hosts give no control information (Caseware, possibly ProfSoft) | High for Moore | OCR + crop + coordinates fallback in the format; narration prompts ("say what you're clicking"); confirm ProfSoft's access mode early |
| R5 | macOS point releases break overlays or permissions (26.3 RC click-through; 27.3 beta 2 permission prompt) | Medium-High | Pin Electron; keep a macOS smoke checklist per point release; watch the Apple dev forums; avoid depending on undocumented behaviour |
| R6 | TCC attributes the helper unexpectedly (no prompt, wrong name, hidden entry on 26.1+) | Medium | Spike designs A and B with `launchctl procinfo`; prefer requesting from the main app |
| R7 | AX hit-test returns our overlay, is slow, or hangs on a busy target app | Medium | Hit-test the PID of the topmost non-self window; background queue with ~250 ms timeout; hover cache |
| R8 | Pre-click state lost because the UI changes on click | Medium | Frame ring buffer; hover-cached element; after-frame 300 to 600 ms later |
| R9 | Mixed-DPI and multi-monitor coordinate errors (blurry or offset crops, wrong snap boxes) | Medium | One overlay per display; store points plus scale; a spike test on a 2x + 1x setup with an offset display |
| R10 | Enabling Chromium's accessibility tree (`AXManualAccessibility`/`AXEnhancedUserInterface`) slows target apps or upsets window managers | Medium | Enable only while recording; prefer `AXManualAccessibility` for Electron apps; measure CPU in the spike |
| R11 | Keystroke capture records secrets (POPIA, IRBA) | High (compliance) | No raw keylogging; AX field values on blur with redaction; skip `AXSecureTextField`; review screen before export |
| R12 | Hotkeys fail silently (taken, or Option-only on 15+) | Low | Cmd/Ctrl chords, conflict detection, rebinding, control bar |
| R13 | Dev builds lose permissions every build | Low (dev speed) | Sign dev builds with a stable Apple Development identity; document `tccutil reset` for testers |
| R14 | Mic denied once, so narration silently missing | Low-Medium | Status indicator; deep link to Settings; tell the user a restart is needed after a change |
| R15 | Monthly re-prompt lands mid-recording and blocks capture | Medium | Check `CGPreflightScreenCaptureAccess` before each start; handle stream errors by pausing with a clear banner, not crashing |

---

## 13. What the macOS spike must prove (pass/fail)

Timebox: about 3 working days on macOS. Run on macOS 15, 26 and 27 (current 27.2; also 27.3 beta if available), with a **notarized Developer ID build** containing the Swift helper. Results go in a short table with screenshots or screen recordings.

| ID | Check | Pass criterion |
|---|---|---|
| O1 | Overlay above a native full-screen app (e.g. Safari full-screen, Excel full-screen) | Overlay visible and drawable, and the full-screen app is not kicked out of its Space when the overlay appears or the control bar is clicked |
| O2 | Spaces + multi-display | Overlay present on every Space and on two displays with different scale factors (2x + 1x), including a display placed left of or above the primary. Snap boxes and click markers land within 2 pt of the real control |
| O3 | Click-through toggle | In pass-through mode, 50 clicks reach the apps below, including the menu bar and Dock. In annotate mode, drawing works. Toggling 100 times leaves no stuck state |
| C1 | Capture excludes the overlay | Helper frames (stream + screenshot) show the apps but none of our windows, while the overlay is visibly drawn on screen |
| C2 | Pre-click frame | For a menu click, the "before" frame shows the open menu and the "after" frame shows the result |
| P1 | Permission flow from clean TCC (`tccutil reset All <bundle-id>`) | Record exactly which prompts appear, in what order, under which app name, whether Input Monitoring is separately required, whether a relaunch is needed, and which call raises the Screen Recording prompt from which process. Total grants ≤ 3 is the target |
| P2 | TCC attribution | `launchctl procinfo` shows the responsible process for the helper under designs A and B; pick one |
| H1 | Input hook safety | With the listen-only tap running, revoking Accessibility mid-recording **does not hang input**; the helper detects the loss within 2 s and the UI shows it |
| A1 | AX matrix | For Safari, Chrome (a web form), an Electron app (Teams or VS Code), Excel, Outlook, a Java app, and a remote-desktop client (Windows App or Citrix), record role/title/value/frame/latency (p50/p95) for 20 clicks each. Never returns our own overlay. p95 under 150 ms for native apps |
| K1 | Hotkeys | Ctrl+Cmd chords register on 15, 26 and 27; a conflict is detected and reported |
| M1 | Microphone | Narration records under hardened runtime; the transcript aligns with click timestamps within 250 ms |
| D1 | Distribution | The notarized, stapled DMG installs and runs on a second Mac with no Gatekeeper warnings (`spctl -a -vv`, `codesign --verify --deep --strict`), and the helper launches |
| S1 | Optional: system picker | `SCContentSharingPicker` (native) or Electron `useSystemPicker`: does it avoid the bypass alert, does it still need the TCC grant, and can it exclude our app |

If O1 to O3 fail on Electron but work in a 50-line native `NSPanel` test, the overlay is the part to reconsider (Tauri with `tauri-nspanel`, or a native overlay driven by the helper).

---

## 14. Open questions

1. **How is ProfSoft accessed: thick client, browser or Citrix/RDP?** This decides whether AX helps for Moore's main system.
2. Are Moore's Macs MDM-managed (Jamf, Intune, Kandji)? If so, PPPC and `forceBypassScreenCaptureAlert` can remove most of the permission friction.
3. How many Moore Macs are Intel (stuck on macOS 26)? This affects universal builds and the test matrix.
4. Is `en_ZA` supported by `SpeechTranscriber`, or do we standardise on whisper.cpp for both OSes?
5. Do we need video at all, or are keyframes plus events plus narration enough for Claude? (My view: keyframes; video optional for human review.)
6. Can the `SCContentSharingPicker` configuration exclude our own app, and does it replace the TCC grant? (Spike S1.)
7. The brief mentions "ultracode" for planning. No tool or skill by that name was available in this research session, so the orchestrator should confirm what the owner means.

---

## 15. Sources (accessed 2026-11-21)

Tier in brackets. Dates are the content's dates where known.

**Electron (primary)**

- [P] Electron BrowserWindow API (setAlwaysOnTop levels, setVisibleOnAllWorkspaces, setIgnoreMouseEvents, setContentProtection): https://www.electronjs.org/docs/latest/api/browser-window
- [P] Electron BaseWindowOptions (`type: 'panel'`, `enableLargerThanScreen`, `hiddenInMissionControl`): https://www.electronjs.org/docs/latest/api/structures/base-window-options
- [P] Electron desktopCapturer (CoreAudio Tap API on 14.2+, `NSAudioCaptureUsageDescription`, useSystemPicker): https://www.electronjs.org/docs/latest/api/desktop-capturer
- [P] Electron session.setDisplayMediaRequestHandler (`useSystemPicker` experimental, macOS 15+): https://www.electronjs.org/docs/latest/api/session
- [P] Electron screen API (display events; DIP conversion is Windows/Linux only): https://www.electronjs.org/docs/latest/api/screen
- [P] Electron globalShortcut (silent failure when taken; media keys need trust): https://www.electronjs.org/docs/latest/api/global-shortcut
- [P] Electron systemPreferences (isTrustedAccessibilityClient, getMediaAccessStatus, askForMediaAccess): https://www.electronjs.org/docs/latest/api/system-preferences
- [P] Electron accessibility tutorial (`AXManualAccessibility`): https://www.electronjs.org/docs/latest/tutorial/accessibility
- [P] Electron releases, 45.4.1 stable 2026-11-19: https://releases.electronjs.org/
- [P] Electron PR #52365, occlusion fix, merged 2026-07-18, in 42.8.0 / 43.2.0 / 44.0.0-alpha.5: https://releases.electronjs.org/pr/52365
- [P] electron-builder notarization docs: https://www.electron.build/docs/notarization
- [S] Electron commit "Mouse forward on macOS (#12281)": https://ayakael.net/mirrors/electron/commit/6b5e09478c8fa48ad0ce114409b22a35f1f7be75
- [S] Electron issue #42104 (menu-bar clamp on Sonoma): https://www.github.com/electron/electron/issues/42104
- [S] Electron issue #42133 (fullscreen interaction between windows): https://www.Github.com/electron/electron/issues/42133
- [S] Electron issue #42143 (getSources not resolving without permission): https://www.Github.com/electron/electron/issues/42143
- [S] @loomhq/electron-click-through-workaround: https://npmjs.com/package/@loomhq/electron-click-through-workaround

**Apple Developer Forums (primary where an Apple DTS/engineer reply was read)**

- [P] 792152, NSWindow sharingType none still captured by SCK on 15.4+; DTS "no public APIs for preventing screen capture" (Jul 2025): https://developer.apple.com/forums/thread/792152
- [P] 765103, "bypass the system private window picker" alert; DTS gives two ways out (Sep to Oct 2024, FB15360079): https://developer.apple.com/forums/thread/765103
- [S] 831795, poster says the entitlement is only for VNC/headless and MDM cannot grant it; Apple only acknowledged (Jun 2026): https://developer.apple.com/forums/thread/831795
- [P] 819406, TCC reset with ad-hoc signing; DTS "Correct" (Mar 2026, macOS 26): https://developer.apple.com/forums/thread/819406
- [P] 839069, window-owner names on Golden Gate beta; DTS: use CGPreflight/CGRequest and SCShareableContent (Jul 2026): https://developer.apple.com/forums/thread/839069
- [S] 858698, macOS 27.3 beta 2: no screen-recording prompt; DTS only said to file Feedback (FB25646769; no absolute date shown): https://developer.apple.com/forums/thread/858698
- [S] 844416, system-wide input hang when revoking Accessibility with an active tap; DTS asked for a sysdiagnose, confirmed nothing (FB24619068, Sep 2026): https://developer.apple.com/forums/thread/844416
- [S] 814798, macOS 26.3 RC transparent/borderless window regression (Feb 2026): https://developer.apple.com/forums//thread/814798
- [S] 761641, persistent-content-capture entitlement question; 30-day interval (Aug to Sep 2024): https://developer.apple.com/forums/thread/761641
- [S] 725254, helper Screen Recording prompt shows the main app name (Feb 2023, Oct 2024): https://developer.apple.com/forums/thread/725254
- [S] 826308, overlay above full-screen Spaces needs a non-activating panel and accessory policy: https://developer.apple.com/forums/thread/826308
- [S] 828052, Input Monitoring vs Accessibility listing: https://developer.apple.com/forums/thread/828052
- [S] 763878, Sequoia blocks Option-only RegisterEventHotKey: https://developer.apple.com/forums/thread/763878
- [S] 739593, SCScreenshotManager blur (points vs pixels): https://developer.apple.com/forums/thread/739593
- [S] 807898 and 807323, macOS 26.1 hides plain executables from the Screen Recording list: https://developer.apple.com/forums/thread/807898 , https://developer.apple.com/forums/thread/807323
- [S] 774625, Input Monitoring cannot be granted via MDM: https://developer.apple.com/forums/thread/774625
- [S] 103998, AX not compatible with the sandbox: https://developer.apple.com/forums/thread/103998
- [S] 741303, mic prompt missing under hardened runtime: https://developer.apple.com/forums/thread/741303

**Source code**

- [P] libuiohook `src/darwin/input_hook.c` at commit f259ff3 (pinned by uiohook-napi), active session tap after an Accessibility check: https://raw.githubusercontent.com/kwhat/libuiohook/f259ff3/src/darwin/input_hook.c
- [S] uiohook-napi repo: https://github.com/SnosMe/uiohook-napi

**Other secondary**

- [S] Qt blog, "The Curious Case of the Responsible Process" (2022, updated 2024-06-11): https://www.qt.io/blog/the-curious-case-of-the-responsible-process
- [S] 9to5Mac on Sequoia's monthly prompt (2024-08-14): https://9to5mac.com/2024/08/14/macos-sequoia-screen-recording-prompt-monthly/
- [S] TidBITS on monthly prompts (2024-08-19): https://tidbits.com/2024/08/19/apple-reduces-excessive-sequoia-permission-requests-shifts-to-monthly
- [S] MacRumors on fewer prompts in 15.1 (2024-10-07): https://www.macrumors.com/2024/10/07/apple-screen-recording-popup-update/
- [S] Jamf community, `forceBypassScreenCaptureAlert`: https://community.jamf.com/t5/jamf-pro/monthly-tccc-prompts-macos-v15/m-p/326764
- [S] Kandji PPPC / screen recording / Input Monitoring: https://support.kandji.io/kb/screen-recording-camera-input-monitoring-microphone
- [S] MacRumors / 9to5Mac, macOS 27 Golden Gate release 2026-09-14: https://www.macrumors.com/2026/09/10/macos-27-golden-gate-release-date/ , https://9to5mac.com/2026/09/09/apple-confirms-macos-27-golden-gate-launch-date-september-14/
- [S] WebKit bug 277564 (CGWindowListCreateImage obsoleted in 15.0): https://bugs.webkit.org/show_bug.cgi?id=277564
- [S] Apple accessibility-dev list, AXEnhancedUserInterface breaks window managers (2020-09): https://lists.apple.com/archives/accessibility-dev/2020/Sep/msg00007.html
- [S] Apple accessibility-dev list, AX timeouts and AXUIElementSetMessagingTimeout (2010-11): https://lists.apple.com/archives/accessibility-dev/2010/Nov/msg00002.html
- [S] Apple accessibility-dev list, overlay returned by a hit-test (2003-12): https://lists.apple.com/archives/accessibility-dev/2003/Dec/msg00004.html
- [S] OpenJDK bugs on Swing AX roles: https://bugs.openjdk.org/browse/JDK-8379347 , https://bugs.openjdk.org/browse/JDK-8309732
- [S] Microsoft, screen reader support for Excel: https://support.microsoft.com/en-us/accessibility/excel/screen-reader-support-for-excel
- [S] Citrix Workspace app for Mac, What's new (2603): https://docs.citrix.com/en-us/citrix-workspace-app-for-mac/whats-new.html
- [S] Apple WWDC25 session 277, SpeechAnalyzer: https://developer.apple.com/videos/play/wwdc2025/277/
- [S] Tauri release notes (2.12, transparency without private API): https://v2.tauri.app/release/tauri/v2.12.0/ , https://tauri.app/release/tauri/all-versions/
- [S] Tauri issue #9557 (always-on-top over full-screen apps): https://www.github.com/tauri-apps/tauri/issues/9557
- [S] Chrome, selfBrowserSurface: https://developer.chrome.com/docs/web-platform/screen-sharing-controls

**Pages that did not render (claims based on them are marked [I])**

- Apple, SCContentSharingPicker: https://developer.apple.com/documentation/screencapturekit/sccontentsharingpicker
- Apple, Placing content in a bundle: https://developer.apple.com/documentation/bundleresources/placing-content-in-a-bundle
- Apple, PPPC Services: https://developer.apple.com/documentation/devicemanagement/privacypreferencespolicycontrol/services-data.dictionary
