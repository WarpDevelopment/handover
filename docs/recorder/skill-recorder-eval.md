# Fork evaluation: Microsoft Skill Recorder as the base for the Handover tester build

Date: Saturday 21 November 2026, evening (SAST). Time box: about 2 hours.
Evaluated by: Opus 5.5 agent, on the owner's Mac (Apple Silicon, Node 24.19.0, npm 11.17.0).
Scope: decide fork versus build-from-scratch for the **Windows tester build** due Monday 23 November 2026, with Tuesday as the fix round.

Nothing was committed or pushed anywhere. The clone and all build output live only in the session scratchpad:
`/private/tmp/claude-501/-Users-OlivierPotgieter--herdr-worktrees-Moore-Superbrain-task-workflow-recording-assistant/cc2dad33-5368-4e0c-a62a-e859617670c8/scratchpad/skill-recorder-eval/` (`repo/` = the clone, `strip/` = the AI-strip trial, `*.log` = command logs).

---

## 0. Verdict in one paragraph

**GO: fork, for the tester build.** Pin `microsoft/skill-recorder` at **`0d4bd217aad1fb349cc1e4b1a0ff3fd8cce5e70a`** (tag `v0.9.3`, 19 Nov 2026). Its upstream Windows x64 CI job is green at that SHA and builds an NSIS installer in about 7 minutes. On this Mac, `npm ci`, `npm test` and `npm run build` all passed first time, and a mac package built, with nothing to fix. That proven Windows packaging path, with its licence-compliance gate already passing, is something we cannot reproduce from scratch by Monday, because nobody here can run Windows. ("Licence compliance" here means the LGPL/MIT notices and source bundle. The installer is **not** code-signed.)

The fork is not a Handover yet:
- It has **no click capture at all** (no mouse or keyboard hook anywhere).
- Its only step list comes from the GitHub Copilot LLM describer. Remove the AI and you have no steps.
- Its frames are 1 fps and capped at 1280x720.

So every Handover feature the tester will touch is new code that is unverified on Windows whichever way we go. The fork buys a green, packaged, licence-compliant (but unsigned) Windows shell on day one, not the product.

This verdict covers the **tester build only**. The design doc (§4.2) says "Fork? No: learn from it". Whether the fork becomes the long-term `apps/desktop` seed is a planner (Fable) decision to make after round one (§7.3).

---

## 1. Repository facts

| Item | Value |
|---|---|
| Repo | https://github.com/microsoft/skill-recorder, MIT, "Copyright (c) Microsoft Corporation" |
| Pinned SHA | `0d4bd217aad1fb349cc1e4b1a0ff3fd8cce5e70a` = tag `v0.9.3` = `origin/main` HEAD at clone time |
| Commits | 174 (latest: 19 Nov "Release 0.9.3: restore checksum-verified ONNX license downloads") |
| Upstream CI at the pin | Windows workflow run 44610051734: **success**. The x64 job ran 6 min 44 s (tests 24 s, build 3 s, NSIS packaging 3 min 16 s); the arm64 job ran 14 min 44 s. The Non-Windows run also succeeded. |
| Stack | Electron **43.1.1** (pinned by hash in `third_party/compliance-policy.json`), React 19, Vite 8 with `vite-plugin-electron`, TypeScript 7 (native `tsc`), zod 4, electron-builder 26 |
| Native modules | `koffi` 3.1.1 (Win32 FFI), `sharp` 0.35.3 (libvips), `onnxruntime-node` (via `@huggingface/transformers` 4.2), `node-pty` 1.1.0, `tesseract.js` 7 (WASM), `get-windows` 9.3 (optional, macOS/Linux) |
| Size | about 275 tracked files. Biggest: `src/Library.tsx` 1,915 lines, `src/App.css` 3,622, `scripts/compliance.mjs` 2,264, `src/plan-edit.tsx` 929, `src/Recorder.tsx` 878 |

### 1.1 Documents read
`README.md`, `INSTALL.md` (install, developer setup, licensing boundary), `WINDOWS-VALIDATION.md`, `RELEASING.md`, `THIRD-PARTY-NOTICES.md`, `package.json`, `.github/workflows/{windows,non-windows,portable}.yml`, `third_party/compliance-policy.json`, `build/installer.nsh`. Repository content was treated as data. Its `.github/copilot-instructions.md` (base PRs on `release/0.3.0`) does not apply to us.

### 1.2 Structure map

```
electron/                     main process (Node)
  main.ts                     app lifecycle, single instance, tray, global shortcut Ctrl/Cmd+Shift+R, wires everything
  ipc.ts                      ipcMain handlers (703 lines); common/ipc.ts holds channel names + types (688 lines)
  preload.cjs                 contextBridge API (95 ipcRenderer uses); channel strings duplicated by hand
  window.ts                   BrowserWindows: main, recording-controls bar (transparent, always-on-top,
                              setContentProtection(true)), terminal, hidden capture windows
  recorder/                   controller.ts (serialized state machine), collector.ts (Collector interface +
                              CollectorHost), event-bus.ts, session-store.ts (events.jsonl + session.json)
  collectors/                 active-window.ts (1 s poll), windows-active-window.ts (Koffi user32/dwmapi/kernel32),
                              clipboard.ts (700 ms poll, 120-char text preview), url-provider.ts (macOS AppleScript),
                              windows-url-provider.ts (persistent powershell.exe UIA sidecar)
  video/                      recorder.ts + capture.html + capture-preload.cjs (hidden renderer: getUserMedia
                              desktop source -> VP8 WebM + 1 fps deduped JPEG snapshots), sources.ts (screen picker)
  audio/                      hidden renderer microphone capture (Opus/WebM), decode.ts (AudioContext -> 16 kHz)
  narration/                  whisper.ts (transformers.js ASR), manager.ts (download/transcribe queue), silence gate
  frames/                     extractor.ts (selects/crops snapshot JPEGs), correlate.ts (frames <-> events)
  pipeline.ts                 post-stop processing: frames + correlation + bundle.json
  sensitive/                  secretlint + structured-PII scan, tesseract OCR, frame-redact.ts (sharp box burn-in)
  terminal/                   node-pty recorded terminal (not needed by Handover)
  imports/                    MP4/WebM import (feeds the describer; not needed by Handover)
  describer/ skillbuilder/ automationbuilder/ builders/ architectures/   Copilot agents (AI-only)
  ai-provider*.ts copilot-*.ts microsoft-signin-hint.ts                   AI connection + GitHub/Entra sign-in
  debug-bundle.ts doctor.ts logger.ts crash-guards.ts single-instance.ts tray.ts sessions.ts
common/                       shared types: events.ts (event schema), config.ts (capture toggles), ipc.ts, analysis.ts
                              (LLM step schema), bundle.ts, correlation.ts, sensitive.ts, narration.ts, ...
src/                          React renderer: main.tsx (route switch), Recorder.tsx (capture window),
                              RecordingControls.tsx (floating bar), Library.tsx (sessions + AI analysis + builders),
                              SensitiveReview.tsx, AiProviderDialog.tsx, SkillReviewModal.tsx, plan-edit.tsx, Terminal.tsx
scripts/                      compliance tooling (prepare/review/verify), reviewed-Electron installer, arch asserts
evals/                        47 files: describer/builder eval harness (AI-only)
third_party/                  compliance-policy.json (hash-pinned Electron, sharp, ONNX, tesseract, sources)
build/                        icon.png, installer.nsh (only adds a progress detail page)
```

---

## 2. Build results on this Mac

| Step | Result | Time | Notes |
|---|---|---|---|
| `npm ci` | **pass** | 50 s | 514 packages, `node_modules` 1.0 GB. npm reported 28 audit findings (15 moderate, 13 high). `npm audit --omit=dev` still flags **runtime** packages as high: `sharp <=0.35.5-rc.1`, `zod <4.6.6`, `adm-zip`, `fast-uri`, `js-yaml`, `brace-expansion`. Bumping sharp means a compliance-policy review, so leave the audit for after Monday, with a note in the tester build's known issues. Native `sharp`, `onnxruntime-node` and `koffi` load in Node. The Electron binary is **not** fetched by npm (its postinstall is denied by `allowScripts`). The repo installs a hash-checked "reviewed" Electron into `.compliance-cache/electron` instead (`npm run electron:install-reviewed`, or automatically during `dist`). |
| `npm test` | **pass** | 17.5 s | node:test with `--experimental-transform-types`. 3 runs: test:ai 22/22, main 279 (278 pass, 1 skipped, 0 fail), test:import 8/8. **308 pass, 0 fail.** The one skip is a Windows-only test (the "Windows command-line entry point" case for the source installer, marked `# SKIP` on macOS). |
| `npm run build` | **pass** | 2.4 s | `tsc --noEmit` + Vite (renderer 724 kB JS, main 460 kB) + a catalogue bundle-boundary check |
| `npm run dist:portable:mac` (unsigned, `CSC_IDENTITY_AUTO_DISCOVERY=false`) | **pass** | 176 s | `compliance:prepare` downloaded 401 MB of corresponding-source material into `.compliance-cache`. raw.githubusercontent.com returned **404** for every ONNX Runtime licence/notice file; the policy's jsDelivr fallback with SHA-256 check recovered all of them. The afterPack compliance gate passed. Output: `release/Skill Recorder-0.9.3-arm64-mac.zip` (**663 MB**), `.app` **1.4 GB**, ad-hoc signed (`identity: "-"`), not notarized. |

**Nothing needed fixing.** The packaged app was not launched, to avoid permission prompts on the owner's machine; the owner should open it once (right-click > Open).

What makes the package so big:

| Part | Size |
|---|---|
| `Resources/compliance/sources` (LGPL/MPL corresponding source shipped inside the app) | 508 MB |
| `app.asar.unpacked/node_modules/@github/copilot-darwin-arm64` (proprietary Copilot CLI) | 304 MB |
| `app.asar` | 193 MB |
| `onnxruntime-node` | 87 MB |
| `tesseract.js-core` | 43 MB |

Removing Copilot and moving the sources to a companion artifact would cut the app by about 800 MB.

---

## 3. Assessment, with file paths

### 3.1 Capture pipeline

**Screen frames** (`electron/video/recorder.ts`, `electron/video/capture-preload.cjs`, `electron/video/sources.ts`):
- A hidden renderer opens a `chromeMediaSource: "desktop"` stream for **one** screen, picked at start in the Recorder window.
- Settings: `FPS = 1`, `MAX_WIDTH = 1280`, `MAX_HEIGHT = 720`, VP8 WebM at 500 kbit/s.
- In parallel it draws a frame each second, computes a 9x8 dHash, and writes a JPEG (quality 0.78) only when the Hamming distance is over 8 or a 5 s heartbeat is due. Output goes to `video-frames/` plus `video-frames.json`.
- After stop, `electron/pipeline.ts` and `electron/frames/extractor.ts` pick the snapshot nearest each "meaningful" event (app switch, title, URL, clipboard) into `frames/`.
- **The frames are not click-anchored.** At 1280x720, small UI text on a 1080p or larger laptop panel is barely readable.
- Useful hook: `maybeEmitFrame(tMs, force)` already takes a `force` flag, so an on-demand "snapshot now" path is a small change.

**Click capture: none.**
- No `uiohook`, no `SetWindowsHookEx`, no CGEventTap, no mouse polling.
- The README's "captures the clicks" is not backed by code. `common/events.ts` has no pointer event type, and the describer prompt even says "Do not invent hidden clicks".
- This contradicts the guess in `prior-art.md` §3.4, which assumed some mechanism existed.

**Keyboard hook: none.** That fits the Handover design (§9.4: no keyboard hook in v1).

**Foreground app and window** (`electron/collectors/active-window.ts`):
- Polls every 1 s (1.6 s while a browser is frontmost).
- Windows: `electron/collectors/windows-active-window.ts` calls `GetForegroundWindow`, `GetWindowTextW`, `DwmGetWindowAttribute(EXTENDED_FRAME_BOUNDS)` and `QueryFullProcessImageNameW` through **Koffi**, and resolves the real owner of UWP `ApplicationFrameHost` windows.
- macOS/Linux: `get-windows`.
- Emits `app.activate` (app, title, pid, path, bounds) and `app.title-change`.

**URLs:**
- macOS: AppleScript (`url-provider.ts`; needs a per-browser Automation grant).
- Windows (`windows-url-provider.ts`): spawns a **persistent `powershell.exe -ExecutionPolicy Bypass -File <temp>.ps1`** that loads `UIAutomationClient` and reads the **omnibox value** of the front browser.
  - The Handover design rejects both choices: PowerShell (Constrained Language Mode, EDR scrutiny) and reading the omnibox (typed text).
  - It is also exactly the behaviour that draws Defender's attention on an unsigned app. **Turn it off in the tester build.**

**Clipboard** (`electron/collectors/clipboard.ts`): polls every 700 ms and stores a hash, a length and a **120-character text preview** of whatever was copied. That breaks PRV-KEY-01's spirit for client data. **Drop `textPreview` in the tester build**; keep only the change counter and source app.

**Capture toggles** (`common/config.ts`): `FULL_CAPTURE` is hard-wired with everything on (app activity, clipboard, titles, URLs, video, terminal) and is used directly by `main.ts`. There is no user setting.

**Session storage** (`electron/recorder/session-store.ts`): **plaintext** under `userData/sessions/<id>/`. That folder holds `session.json`, `events.jsonl`, `video.webm`, `video-frames/`, `frames/`, audio and transcript. There is no encryption and no retention. Acceptable for a tester build that uses synthetic data, not for Moore client data (the design's AEAD store is Phase 1 work).

### 3.2 Narration

Code: `electron/audio/*` and `electron/narration/*`.
- **Capture:** a hidden renderer records Opus/WebM microphone intervals, toggled from the floating bar.
- **Decode:** `AudioContext` downmixes and resamples to 16 kHz mono. There is no FFmpeg anywhere.
- **Transcription:**
  - Model: `@huggingface/transformers` ASR pipeline, model **`Xenova/whisper-small`** (multilingual, 99 languages), **q8 ONNX, about 252 MB**, run by `onnxruntime-node` on the CPU with `enableCpuMemArena: false`. That setting works around a SIGTRAP under Electron.
  - Source: **downloaded at runtime from Hugging Face**, only after the user explicitly approves it. It goes to `userData/models`, which `SKILL_RECORDER_MODELS_DIR` can override. It is not bundled.
- **Latency:** the code comment says about 12 s for 77 s of audio (measured on Apple Silicon, so about 0.15x real time). Expect 2 to 4 times slower on a mid-range x64 laptop. Transcription runs after recording, not live.
- **Handover:** keep the whole chain.
  - For "nothing goes to a cloud service", either **bundle the model** (fetch the 7 files in CI with SHA-256 pins into `extraResources/models`, point `narrationModelCacheDir()` there, set `local_files_only: true`; +252 MB) or **ship narration disabled** for round one.
  - A one-time model download sends no user data, but it is still a network call from the app, so if kept it must be disclosed.

### 3.3 GitHub Copilot SDK coupling

The coupling is wide but shallow: it sits at the edges, not in capture.
- **AI-only code:** 54 app files, 9,013 lines, plus `evals/` (47 files).
  - Directories: `electron/describer/`, `electron/skillbuilder/`, `electron/automationbuilder/`, `electron/builders/`, `electron/architectures/`.
  - Electron files: `electron/ai-provider*.ts`, `electron/copilot-*.ts`, `electron/microsoft-signin-hint*.ts`.
  - Common files: `common/ai-provider*.ts`, `common/microsoft-signin-hint.ts`, `common/architecture-registry*.ts`, `common/skill*.ts`, `common/automation.ts`, `common/plan-tools.ts`.
  - Renderer files: `src/AiProviderDialog.tsx`, `src/SkillReviewModal.tsx`, `src/plan-edit.tsx`, `src/skill-*.ts`, `src/analysis-recovery*.ts`.
- **Measured strip:** in a scratch copy (`strip/`), all of those files **plus `electron/imports/`** were moved out and `tsc --noEmit` was run. Result: **67 type errors in 10 files**. (Without removing `imports/` it was 69 errors in 9 files.)

| File | Errors |
|---|---|
| `src/Library.tsx` | 30 |
| `electron/ipc.ts` | 17 |
| `electron/main.ts` | 7 |
| `common/ipc.ts` | 3 |
| `src/main.tsx` | 1 |
| `electron/doctor.ts` | 1 |
| `electron/sessions.ts` | 1 |
| `electron/sensitive/scanner.ts` | 1 |
| Tests: `electron/terminal/terminal.test.ts` | 4 |
| Tests: `electron/debug-bundle.test.ts` | 2 |

- **Two build and test traps that `tsc` cannot see.** L1 must handle both or CI goes red:
  1. **`evals/` holds the test harness.** Every test script runs `--import ./evals/register.mjs`, which registers `evals/hooks.mjs`, and `evals/electron-stub.mjs` stubs Electron for node:test. **Keep these three files**, ideally moved to `test/harness/` with every script path updated, and delete the rest of `evals/`.
     - The `test` script in `package.json` names about 15 deleted test files, so trim that list.
     - `pretest` (`test:ai`) and `posttest` (`test:import`) point only at deleted tests. Remove both hooks, plus `test:ai:runtime`, `test:import:runtime`, `eval*` and `typecheck:evals`.
  2. **`build:vite` runs `scripts/assert-catalogue-bundle-boundary.mjs`.** That script reads `electron/architectures/catalogues/*-catalogue.ts` and throws when none exist. It sits on the `dist:win:x64` path, so delete the script and change `build:vite` to plain `vite build`.
- **Copilot strings left in kept files:** 78 mentions across 14 files: `common/{sensitive,analysis,describe,bundle,ipc}.ts`, `electron/{doctor,ipc}.ts`, `electron/preload.cjs`, `electron/sensitive/{frame-redact,scanner}.ts`, `src/{Recorder,Library,WhatsRecorded}.tsx`, `src/App.css`. Most are comments and UI copy (for example "before frames go to GitHub Copilot"). L1 must reword them, or the grep acceptance check below fails.
- **Other places that still need edits:**
  - `electron/preload.cjs`: JavaScript, so `tsc` does not check it; remove the AI channels by hand.
  - `src/Library.tsx`: replace `AnalysisWorkspace`, `SkillBuilderView`, `AutomationBuilderView` and `AnalysisError` (lines 437 to 1,900 or so) with a step review view. Keep `SessionsList` and `DebugDownload`.
  - `electron/imports/*`: the import feature only feeds the describer. Delete it with its test.
  - `package.json`: remove `@github/copilot` and `@github/copilot-sdk`, and their `asarUnpack` rule.
  - Compliance, the only places that require Copilot:
    - `scripts/compliance.mjs` lines 1136-1137 (`assertInstalledVersion(...copilot-sdk...)`, `assertReviewedCopilotCliVersions`);
    - `scripts/verify-windows-package.mjs` lines 53-56 (requires `copilot.exe`) and line 94;
    - `scripts/compliance.test.mjs` lines 524-538 (fixture-only; can stay) and 1039-1132 (assert the text of `install.ps1`/`install.sh`; drop them with those scripts).
    - The afterPack gate `scripts/verify-packaged-compliance.mjs` has **no** Copilot reference.
- **What "no AI, just export" looks like:** Record (as today) > Stop > a deterministic step builder turns events into steps > Review (delete, comment, blur) > Export the Handover package folder or zip. `common/analysis.ts` (the step zod schema) and `common/describe.ts` can be kept as type references, or replaced by our own step type.
- **Effort:** about half a day for one Sonnet lane including tests. The risk is low: the compiler lists every dangling reference, and the two traps above are now known.

### 3.4 Network calls, telemetry, sign-in

A static audit of `electron/`, `src/` and `common/` found:
- **No telemetry.** `electron/logger.ts` is console-only; its comment reads "Replaced/extended when telemetry lands". No crashReporter, no autoUpdater, no analytics.
- **No sign-in required to record.** Sign-in (GitHub OAuth via the Copilot CLI, Microsoft Entra hint via local `dsregcmd /status`) happens only on Analyze. BYOM sends recordings to OpenAI, Anthropic or Azure endpoints only on Analyze.
- **Network calls that exist:**
  - Copilot CLI/SDK traffic (Analyze only);
  - `shell.openExternal(github.com/enterprises/microsoft)` (sign-in only);
  - Hugging Face model download (narration, on approval);
  - `fetch(raw.githubusercontent.com/tesseract-ocr/tessdata_fast/...)` in `electron/sensitive/model-manager.ts` (Advanced protection OCR, on enable).
- **All four go away or are disabled** once Copilot is stripped, Advanced protection is disabled and the model is bundled.
- **Privacy defaults to change for audit-firm data:** clipboard preview, the PowerShell omnibox URL reader, plaintext sessions (§3.1), and the debug bundle, which **zips the whole session folder including video and frames** (`electron/debug-bundle.ts` line 96, `archive.directory(dir, "session")`).

### 3.5 UI framework, IPC, tests, code quality

- **UI:** React 19 function components, no router (`src/main.tsx` switches on a route string), no state library, one large CSS file. It loads **"Segoe Sans" fonts from `src/assets/fonts/` (2.1 MB, commented "bundled from the Scout app")**. These are Microsoft brand typefaces, and no licence for them is recorded in `THIRD-PARTY-NOTICES.md`. **Remove them in the fork** and use the system font stack.
- **IPC:**
  - Channel names and request/response types live in `common/ipc.ts` and are duplicated by hand in `electron/preload.cjs`.
  - Main-side handlers live in `electron/ipc.ts`.
  - Renderers run with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`.
  - There is no zod validation on most IPC inputs (zod is used for AI tool schemas). Fine for a tester build; the design wants zod-validated channels later.
- **Process model:** everything runs in the Electron main process except the hidden capture renderers. There is no utilityProcess split.
- **Tests:** built-in `node:test`, 308 tests, about 17 s, with no coverage tooling.
  - Covered well: recorder state machine (`electron/recorder/controller.test.ts`), session store, frame extraction, narration gates, sensitive-data scanning, compliance scripts.
  - Not covered: no UI tests, no end-to-end tests.
  - The design's Vitest plus no-network stub does not exist here.
- **Quality: good.**
  - Strict TypeScript.
  - Small, well-commented modules with honest failure handling. Collectors are best-effort and isolated (`CollectorHost` catches per collector), and the controller serializes every lifecycle change.
  - Crash guards and a single-instance lock.
  - The weakest parts for us are the two giant React files and the hand-synced preload.

### 3.6 Packaging, Windows CI, licences

**electron-builder** (`package.json#build`):
- appId `com.skillrecorder.app`.
- `electronDist: .compliance-cache/electron` (the reviewed, hash-pinned Electron).
- `afterPack: scripts/verify-packaged-compliance.mjs` refuses to package if the compliance bundle is incomplete.
- `extraResources: .compliance -> compliance`.
- `asarUnpack` covers the native modules.
- Win: `nsis` target, `artifactName ${productName}-${version}-windows-${arch}.${ext}`.
- NSIS: `oneClick: false`, `perMachine: false` (per-user under `%LOCALAPPDATA%\Programs`), lets the user choose the folder, `include build/installer.nsh`.
- Mac: dmg/zip, ad-hoc identity, no hardened runtime, `NSMicrophoneUsageDescription`.

**Windows CI** (`.github/workflows/windows.yml`):
- Matrix x64 (`windows-latest`) plus arm64 (`windows-11-arm`). Triggers on push to `main` and on PRs.
- Steps: install.ps1 guardrail and source-install tests (tied to the upstream repo and a full source install), setup-node 24.19.0, `check:lockfile`, compliance cache, `npm ci --strict-allow-scripts`, a native module load check, licence inventory, `npm test`, `test:ai:runtime`, `npm run build`, `npm run dist:win:<arch>`, `scripts/verify-windows-package.mjs`.
- **It never uploads the installer.** Upstream green proves the job runs today on GitHub's image.

**Reuse verdict: almost as-is, with five edits.**
1. Drop the arm64 leg, unless the owner's Arm64 VM exists (risk 1).
2. Drop both install.ps1 steps.
3. Drop `test:ai:runtime`.
4. Add `actions/upload-artifact` for `release/*.exe` plus a `.compliance` companion, copying the pattern in `portable.yml` lines 69-82.
5. Trigger on `workflow_dispatch` and push to the build branch.

`dist:win:x64` and `assert-native-windows-arch.mjs` work unchanged. **Expected result:** an unsigned `Handover-<ver>-windows-x64.exe` in about 7 minutes (a little longer on a cold compliance cache).

**Licence obligations for the fork:**
1. **MIT (Skill Recorder):** keep `LICENSE` with "Copyright (c) Microsoft Corporation" and add our own copyright line. Add a NOTICE line: "Derived from microsoft/skill-recorder at 0d4bd217…, MIT".
2. **Trademarks:**
   - Remove "Skill Recorder", "Microsoft", "Scout", "Copilot" and "Cowork" branding: 159 occurrences in 48 files after the AI strip.
   - Replace `build/icon.png` and the tray/app icons, and remove the Segoe fonts. README §Trademarks forbids implying Microsoft sponsorship.
3. **Electron and Chromium:** keep `LICENSE.electron.txt`, `LICENSES.chromium.html` and the `ffmpeg.dll` **LGPL-2.1+** notice.
4. **Sharp/libvips:** LGPL-3.0, replaceable unpacked `.node` and DLLs.
5. **How the compliance tooling meets 3 and 4:** it already handles both, and Tesseract and Artistic-2.0 as well. It ships the full source archives and `RELINKING.md` under `resources/compliance/`. Keep it intact; it is the cheapest way to stay compliant.
6. **Optional slimming:** ship `.compliance/sources` as a companion artifact next to the installer instead of inside it (LGPL lets the source accompany the binary). That needs a small change to `extraResources` and `verify-packaged-compliance.mjs`. Not Monday-critical.
7. **Remove the GitHub Copilot CLI.** It is proprietary and redistributable only unmodified and bundled; removing it also removes that obligation.

---

## 4. Where each Handover addition plugs in

Sizes are for the tester build: **S** under 2 h, **M** 2 to 5 h, **L** over 5 h for one Sonnet lane including tests.

### 4a. Click capture and control-at-point (optional at runtime)

This is two things. The fork has neither.
- **Click source.** A pointer-down event with screen point, button and time.
- **Control resolution.** Role, name, automation id, bounds, app, window.

**Plug-in point:** the existing `Collector` interface (`electron/recorder/collector.ts`).
- Add `electron/collectors/pointer-helper.ts`, which spawns the helper, reads JSON lines and publishes a new `pointer.click` event with an optional `target`.
- Register it in `electron/collectors/index.ts` and add the payload types to `common/events.ts`.
- The helper binary ships through `extraResources`. `electron/doctor.ts` reports it as `helper: ok | missing | crashed | no-permission`.
- If the helper is missing, crashes or lacks permission, the collector logs it, publishes a `gap` event and the recording continues. `CollectorHost` already isolates start failures.

| Option | Verdict | Size |
|---|---|---|
| **Windows: small C# helper exe, built in CI** with the in-box .NET Framework compiler (expected at `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`, no SDK install; **not verified** on `windows-latest`, see the L1 probe step), targeting net48. A mouse-only `WH_MOUSE_LL` hook (or mouse raw input) whose callback only enqueues; a worker thread does `System.Windows.Automation.AutomationElement.FromPoint` with a cache request; Per-Monitor-V2 manifest; JSON lines over stdio. | **Recommended.** Out of process, so a hung UIA provider cannot freeze the UI. Matches design §9.5 and windows-tech. CI can build it in seconds and **run a self-test on the runner** (`--selftest`: start, hello, `FromPoint(10,10)`). That is the only Windows evidence we can get before Monday. Whether GitHub's Windows image gives the helper a usable interactive desktop must be shown in the lane; if not, the self-test falls back to "starts and says hello". | **M** |
| Windows: Koffi calling UIAutomation COM vtables in-process | Rejected. Hand-declared vtables, no examples, and a slow provider blocks the Electron main thread (windows-tech §D). | L |
| Windows: PowerShell UIA sidecar (copying `windows-url-provider.ts`) | Tempting (S, the pattern exists), but rejected. Constrained Language Mode, EDR scrutiny of `-ExecutionPolicy Bypass` from temp, and a hook in PowerShell `Add-Type` is a classic malware signature. | S, high risk |
| Windows: `uiohook-napi` | Rejected. It always installs a keyboard hook too (windows-tech finding 3). | S, unacceptable |
| **macOS: Swift helper over stdio** (`swiftc` single file, built on the macOS runner or the owner's Mac). Listen-only `CGEventTap` for mouse-down only, `AXUIElementCopyElementAtPosition` on a background queue with a timeout, polls `AXIsProcessTrusted()`. | **Recommended.** With an ad-hoc signed build, TCC (Accessibility) grants may need re-granting after every rebuild. Acceptable because the owner is the only Mac tester. | **M** |
| macOS: Node native addon | Rejected for now. node-gyp against Electron's ABI in CI, and it runs in-process. | L |

### 4b. Freeze-and-annotate overlay

- **Hotkey:** add a second `globalShortcut.register` (for example Ctrl/Cmd+Shift+E) in `electron/main.ts` next to the existing Ctrl/Cmd+Shift+R at line 563, plus an "Explain" button on the floating bar (`src/RecordingControls.tsx`). On Windows, `globalShortcut` is `RegisterHotKey`, not a hook.
- **Frozen frame per display:** `desktopCapturer.getSources({ types: ["screen"], thumbnailSize: <physical size> })` returns one NativeImage per display at the moment of the hotkey. Write each as PNG into the session folder.
- **Overlay windows:** add `createFreezeOverlay(display)` in `electron/window.ts`. Each window is frameless, opaque, fullscreen on its display, `setAlwaysOnTop(true, "screen-saver")` and `setContentProtection(true)`, the same calls the recording bar already uses.
- **Overlay content:** a new route `src/FreezeOverlay.tsx` shows the frozen PNG, with a canvas for box, arrow and highlight tools and a comment card (text). Optionally a "narrate" toggle that reuses the microphone path.
- **Saving:** writes an `annotation` event to `events.jsonl`. The event holds shapes in display-physical pixels plus a display id and scale, the comment text, and the frame file. Collectors are paused while frozen; that needs a small `pause/resume` on `RecorderController`, which does not exist today, plus gap events.
- **Electron version:** 43.1.1 is fine because the overlay is opaque. The click-through fix the design wants (43.2 or later) only matters for a live click-through overlay, which is P2.
- **Risk:** placement with mixed-DPI multi-monitor on Windows, which we cannot test.
- **Size: M/L.**

### 4c. Review: delete step, edit comment, blur a rectangle

- **Where:** replace the AI workspace in `src/Library.tsx` with `src/StepReview.tsx`: a filmstrip of steps, the frame with annotations drawn on top, and a details pane.
- **Storing edits:** append-only `edits.jsonl` in the session folder (operations: delete, edit-comment, blur-rect), so raw capture is never mutated and undo stays possible.
- **Blur:** shown in the UI with a canvas filter. Burned in at export with `sharp`, which is already a dependency; `electron/sensitive/frame-redact.ts` has the composite pattern.
- **Size: M** (delete and comment edit are S; blur preview plus burn-in is M).

### 4d. Export package

- **Where:** a pure module `common/handover/` with `buildPackage(session, edits, ctx) -> Map<path, bytes>`, no Electron imports, golden-tested with node:test fixtures on the Mac. Plus `electron/export.ts`, which writes a folder or zip (`archiver` is already a dependency) chosen with `dialog.showSaveDialog`.
- **Tester subset of `package-spec.md`:**
  - `README.txt`;
  - `manifest.json`: id, created, tool version, OS, displays, capture capabilities including helper status, and a SHA-256 for every file;
  - `steps.jsonl`: id, t, kind (click, app-switch, explain, screen-change), app, window title, point, target when resolved with a reason when not, and frame refs;
  - `annotations.jsonl`: shapes, comments, narration segments;
  - `gaps.jsonl`: helper missing, paused, permission;
  - `media/Sxx_before_full.png`, `_annotated.png` and an optional crop, with blur burned in and metadata stripped;
  - `transcript.txt`;
  - `PROCESS.md` from §11.1 and `CLAUDE_HANDOFF.md` from §12, both template-rendered.
- **Skipped for the tester build:** `dataflow.json`, `readiness.json`, `prompts.jsonl`, `privacy.json` (or a stub), `a11y/`, `steps-guide.html`.
- **Size: M.**

### 4e. Diagnostics file

- **Where:** `electron/logger.ts` gets a file sink: `userData/logs/handover-YYYYMMDD.log`, rotated, never containing event payloads. New `electron/diagnostics.ts` builds on `buildDebugInfo()` and `runDoctor()` in `electron/debug-bundle.ts`, **without** the session folder.
- **Contents:** one zip on the Desktop with:
  - app, Electron, Chrome, Node and OS versions, plus arch and locale;
  - displays (bounds, scale);
  - permissions (macOS `systemPreferences.getMediaAccessStatus("screen"|"microphone")`, `isTrustedAccessibilityClient(false)`);
  - helper status and its last self-test;
  - capture-source status;
  - a session count with no content;
  - the last N log lines.
- **Entry point:** a tray and menu item "Save diagnostics for support".
- **Test:** assert the zip has no `.png/.jpg/.webm/.opus` files and no event payload strings.
- **Size: S.** Do it before any native work, so round one returns data even if the helper fails.

---

## 5. Recommended fork plan

### 5.1 Pin, home and rebrand

1. **Pin:** `0d4bd217aad1fb349cc1e4b1a0ff3fd8cce5e70a` (v0.9.3).
2. **Repository home for Monday:** a new **private** repo under the Warp org, created by mirroring the pinned SHA. A GitHub "fork" of a public repo cannot be private. CI workflows must sit at the repo root, so this is simpler than nesting under `recorder/` in Moore-Superbrain for now. Owner action: create the repo and enable Actions.
3. **Rebrand:**
   - `package.json`: `name: handover`, `productName: Handover`, `appId: <warp reverse-DNS>.handover`, `version: 0.1.0`, `author: Warp Development`, `description`, `repository`.
   - Window titles and UI strings: 159 hits for "Skill Recorder", "skill-recorder", "skillrecorder" and "SKILL_RECORDER" across 48 files.
   - Environment variables `SKILL_RECORDER_*` become `HANDOVER_*`.
   - `NSMicrophoneUsageDescription`.
   - Icons in `build/icon.png` and `electron/assets/icons/*`; remove the Segoe fonts.
   - Rewrite the README; delete `SECURITY.md`, `SUPPORT.md`, `CODE_OF_CONDUCT.md` and `CONTRIBUTING.md` (all Microsoft-specific).
   - **Keep `LICENSE`** (add our own copyright line) and **`THIRD-PARTY-NOTICES.md`** (update it: drop the Copilot section, add "derived from").
   - `userData` moves to a new folder automatically, because the app name changes.

### 5.2 Strip (Lane 1)

- **AI and Copilot:** all files listed in §3.3; `evals/` except the three harness files; `electron/imports/`; `scripts/assert-catalogue-bundle-boundary.mjs`; `@github/copilot*` dependencies; and the compliance lines in §3.3.
- **Upstream source installer:** `install.ps1`, `install.sh`, `scripts/install-windows*.{ps1,mjs}` with their tests, and the install steps in the workflows.
- **Workflows:** the arm64 leg, plus `portable.yml` if unused.
- **Disable but keep the code** (removal can come later, and leaving it avoids lockfile churn on Monday):
  - the recorded terminal (`terminal: false`, hide its button);
  - the Windows URL PowerShell reader (`browserUrls: false`);
  - clipboard `textPreview`;
  - Advanced protection OCR (no tessdata fetch);
  - the narration download (bundle the model, or leave narration off for round one).

### 5.3 Keep

- **Recording core:** recorder controller, collectors, session store.
- **Capture:** Koffi foreground window, Chromium capture with frame dedupe, the content-protected floating bar.
- **Narration:** audio capture, decode, silence gate, Whisper.
- **App shell:** single instance, crash guards, tray, global shortcut.
- **Support and build:** debug bundle and doctor (adapted), the sensitive-data scanners (dormant, useful later for blur suggestions), the compliance tooling, electron-builder config, CI.

### 5.4 Tester build lanes (each keeps `npm test`, `npm run build` and the Windows artifact job green)

| Lane | Files in scope | Acceptance check | Done when | Size |
|---|---|---|---|---|
| **L1: Fork, strip, rebrand, CI artifact** | `package.json` (deps, the `test`/`pretest`/`posttest`/`eval*` scripts, `build:vite` without the catalogue check), `package-lock.json`, the AI and import files in §3.3 (delete), `evals/` (keep `register.mjs`, `hooks.mjs` and `electron-stub.mjs`, moved to `test/harness/`; delete the rest), `scripts/assert-catalogue-bundle-boundary.mjs` (delete), `electron/{main,ipc,doctor,sessions}.ts`, `electron/sensitive/scanner.ts`, `electron/preload.cjs`, `common/{ipc,config}.ts`, `src/{Library,main}.tsx` (AI views out; session list plus "Open folder" stays), the Copilot wording in the 14 files listed in §3.3, the two affected tests, `scripts/{compliance.mjs,verify-windows-package.mjs,compliance.test.mjs}`, rebrand strings and assets, fonts out, `LICENSE`, `THIRD-PARTY-NOTICES.md`, `NOTICE`, `.github/workflows/windows.yml` (x64, no install.ps1, upload-artifact, `workflow_dispatch`, plus a **probe step** that compiles a hello-world C# exe with in-box `csc.exe` and reports whether the session is interactive, so L5's feasibility is known on Sunday morning), `non-windows.yml` (macOS only, no install.sh) | `npm ci && npm test && npm run build` green on the Mac, with the test count reported. `grep -ri "copilot\|skill recorder" electron src common` is empty except notices. CI Windows job green with an artifact `Handover-0.1.0-windows-x64.exe` (no `copilot.exe` inside, verified by `verify-windows-package.mjs`). The owner records a session on the Mac zip build. | An installer artifact downloadable from Actions | S/M |
| **L2: Diagnostics, logging, privacy defaults** | `electron/logger.ts` (file sink), new `electron/diagnostics.ts` and test, `electron/tray.ts` plus menu item, `electron/debug-bundle.ts` (exclude media or remove), `electron/collectors/clipboard.ts` (no preview), `common/config.ts` (defaults), narration model bundling (CI fetch with SHA-256 pins plus `extraResources`) or narration off | Unit test: the diagnostics zip has no media and no payload strings. A network check: with Wi-Fi off, record, narrate (if bundled) and save diagnostics all work on the Mac. CI artifact still green. | The tester can send one zip back | S |
| **L3: Step model, better frames, export** | `common/events.ts` (`pointer.click`, `annotation`, `gap`), new `common/handover/{steps,build-package,process-md,handoff-md}.ts` plus golden tests, `electron/export.ts`, `electron/video/{recorder.ts,capture-preload.cjs}` (native resolution up to 2560 px wide; keep the latest frame in memory at 2-4 fps; `snapshot(force)` on request), the export button in Library | Golden fixture test: synthetic `events.jsonl` plus frames gives byte-stable `manifest.json`, `steps.jsonl`, `PROCESS.md` and `CLAUDE_HANDOFF.md`, with hashes that verify. A fresh Claude reading an exported Mac package can list the steps. | An exported folder opens and passes the package checks. Without clicks, steps come from app switches, screen changes and explain marks. | M |
| **L4: Freeze-and-annotate overlay and review** | `electron/main.ts` (hotkey), `electron/window.ts` (`createFreezeOverlay`), `electron/recorder/controller.ts` (pause/resume plus gaps, with tests), new `src/FreezeOverlay.tsx`, new `src/StepReview.tsx`, `edits.jsonl` handling, blur burn-in in export | Controller tests for pause/resume. A unit test for edits applied at export (deleted step absent, blur pixels changed in the rect only). The owner on the Mac: freeze on 2 displays, draw box/arrow/highlight, type a comment, delete a step, blur a field, export. | Annotations and comments appear in `annotations.jsonl` and `_annotated.png` | M/L |
| **L5: Click and control helpers (optional at runtime)** | `native/windows/HandoverHelper.cs` plus manifest, a CI step to compile with in-box `csc.exe` and run `--selftest`, `native/macos/HandoverHelper.swift`, `electron/collectors/pointer-helper.ts`, `electron/doctor.ts`, diagnostics helper status, `extraResources` | CI: the helper compiles, `--selftest` prints hello and capabilities (and a `FromPoint` result if the runner has a desktop). The app with the helper deleted still records and exports, with a `gap` and a doctor status. The owner on the Mac: clicks produce steps with AX role and name after the Accessibility grant, and without the grant the app degrades cleanly. | Click steps with targets on the Mac; Windows helper proven only to the extent CI allows | M + M |

**Order and timing (best case).**
- L1 tonight, so the first Windows artifact exists by Sunday morning.
- L2 Sunday morning.
- L3 Sunday midday.
- L4 Sunday afternoon and evening.
- L5 Sunday night.
- Monday's tester build is **the last green artifact**, whichever lane that is.
- If L4 or L5 slip, they become the Tuesday fix-round build.
- Each lane gets Opus review before the next starts, per the global rules.

---

## 6. Honest risks for Monday

1. **Nothing is verified on Windows before the tester runs it.** CI proves compile, unit tests, packaging and (maybe) a helper self-test. Overlay placement, capture, the hotkey and helper behaviour on a real Windows 11 laptop are first seen by the tester. Mitigations: L2 diagnostics first, plus a scripted tester checklist.
   - **Conflict to resolve:** design §3 names a Windows 11 Arm64 VM on the owner's Mac as the live-smoke path, while the brief says nobody here can run Windows.
   - If that VM exists, keep the upstream **arm64 CI leg** (green at the pin, about 15 minutes) and smoke each lane's arm64 installer in the VM. That turns this risk into a real smoke test.
2. **Click capture is net-new.** If the Windows helper fails on the tester's machine, steps fall back to app switches, screen changes and explain marks. That is still useful, but it is not "the real UI control behind each click".
3. **SmartScreen and Defender.** The NSIS installer is unsigned ("More info > Run anyway"). An unsigned helper exe with a low-level mouse hook may draw a Defender detection. Mouse raw input is the lower-risk fallback inside the same helper. Turning off the PowerShell URL reader removes the other obvious trigger.
4. **Mixed-DPI and multi-monitor geometry** for the freeze overlay and UIA coordinates (physical versus DIP) cannot be tested without Windows.
5. **Time.** Five lanes plus reviews in about 36 hours is tight. L4 and L5 are the likely slips; plan for Monday as L1 to L3 with a partial L4.
6. **CI network dependency.** `compliance:prepare` downloads about 400 MB of pinned sources; today raw.githubusercontent returned 404s and the jsDelivr fallback saved it. **A new repo starts with a cold cache, so the first run is unprotected**; only later runs hit the actions/cache, which is keyed on the policy hash. Keep the policy file unchanged in L1 so that cache stays valid.
7. **Installer size.** Roughly 350 to 450 MB after removing Copilot, while sources stay inside. Slimming is optional.
8. **Plaintext local storage** of recordings on the tester's laptop. Round one must use synthetic or non-client data, and the tester should be told so.
9. **Narration** either adds 252 MB (bundled) or is off for round one. Transcription on a mid-range x64 CPU may take 30 to 60 s per minute of audio.
10. **Mac TCC churn.** Ad-hoc signed rebuilds may need Accessibility and Screen Recording re-granted after each build.

---

## 7. Conflicts with the design doc, and what to decide later

### 7.1 Where the fork departs from the design

| Design (`2026-11-21-workflow-recorder-design.md`) | Fork reality | For the tester build |
|---|---|---|
| §4.2 "Fork Microsoft Skill Recorder? No: learn from it" (X8) | This evaluation recommends forking for speed to a Windows artifact | Planner to confirm. The tester build is a probe, not the v1 architecture. |
| `recorder/` pnpm workspace in Moore-Superbrain, packages split (`schema`, `core`, `ui`, ...), Vitest, no `vi.mock`, network stub | Single npm package, node:test, no network stub | Accept for the tester build. Port the pure `common/handover/` module into `packages/core` later. |
| Electron 45.x (at least 43.2) | 43.1.1, pinned by hash in compliance policy | **Do not bump for Monday.** A bump means re-reviewing hashes per platform. |
| Native helper does all capture (SCK/WGC ring buffer, masking, encrypted frames) | Chromium `desktopCapturer` in a renderer, one display, 1 fps, plaintext | Accept for the tester build (the design's own X13 fallback is exactly this). Helper capture is v1 work. |
| AEAD-encrypted store, retention, crypto-shred | Plaintext session folders | Synthetic data only in round one. |
| No keyboard hook; mouse-only helper | No hooks at all | Compatible. L5 adds the mouse-only helper. |

### 7.2 Why fork at all

The decisive factor is the deadline. A from-scratch Electron shell would have to rediscover Windows packaging, native-module unpacking (sharp, koffi, onnxruntime), LGPL compliance and a green NSIS job, all without a Windows machine. The fork has all of that working at the pinned SHA.

### 7.3 Decision to take after round one

After round one, the planner should decide one of two paths:
1. Keep the fork as the `apps/desktop` seed and migrate the design's helpers and store into it.
2. Treat it as a throwaway probe and carry over only the pure export module and the helpers.

---

## 8. Evidence index

All in the scratchpad folder `/private/tmp/claude-501/-Users-OlivierPotgieter--herdr-worktrees-Moore-Superbrain-task-workflow-recording-assistant/cc2dad33-5368-4e0c-a62a-e859617670c8/scratchpad/skill-recorder-eval/`:
- `npm-ci.log`, `npm-test.log`, `npm-build.log`, `dist-mac.log`: command output with `/usr/bin/time` timings.
- `repo/release/Skill Recorder-0.9.3-arm64-mac.zip`: the unsigned mac package (upstream branding).
- `strip/`, `strip-tsc.log` (69 errors, AI files only) and `strip-tsc2.log` (67 errors in 10 files, AI files plus `electron/imports/`): the strip trial. The moved-out files are in `strip-removed/`.
- Upstream CI: `gh run view 44610051734 --repo microsoft/skill-recorder` (Windows, success at the pinned SHA).
