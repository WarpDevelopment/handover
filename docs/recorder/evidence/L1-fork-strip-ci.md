# L1 fork-strip-ci: evidence

Branch `lane/L1-fork-strip-ci`, BASE_SHA `f4dfd51`. Code commit `b033456` (strip + rebrand), CI commit `3ee0d14`, notices commit `99e9cb3`.
CI run on `b033456`: Windows <https://github.com/WarpDevelopment/handover/actions/runs/45214529313>, macOS <https://github.com/WarpDevelopment/handover/actions/runs/45214529425>. Final HEAD `06c5b89` (adds only this file): Windows <https://github.com/WarpDevelopment/handover/actions/runs/45216656142> and macOS <https://github.com/WarpDevelopment/handover/actions/runs/45216655253>, both success, both artifacts uploaded.

## 1. `npm ci && npm test && npm run build` on the Mac
- Run with Node 24.19.0 (`/opt/homebrew/opt/node@24`), npm 11.17.0. The default Homebrew Node 26 cannot run the tests: it rejects `--experimental-transform-types`. Upstream was proven on 24.19.0 as well.
- `npm ci --ignore-scripts=false --dangerously-allow-all-scripts=false --strict-allow-scripts`: exit 0.
- `npm test`: **168 tests, 168 pass, 0 fail, 0 skipped** (upstream had 308; the drop is the deleted AI, import, skill-builder, architecture, Copilot sign-in and install-script tests, plus two AI-only terminal tests and the AI-credential debug-bundle test, which became "debug export holds only the session folder and debug-info.json").
- `npm run build` (`tsc --noEmit` then plain `vite build`): exit 0.
- Result: **passes**.

## 2. Grep for old names
Command: `grep -riE "copilot|skill ?recorder|skillrecorder" electron src common scripts package.json`
Remaining hits, all in `scripts/verify-windows-package.mjs` (5 lines, all part of one block): the new guard that **fails the package check if any `@github/copilot*` path or `copilot(.exe)` file is present**. It is needed to prove acceptance 3 ("no copilot.exe inside") and cannot be reworded without losing the check. Nothing else matches.
Other trademark traces that the grep does not cover: many CSS comments in `src/App.css` still say "Scout" (design-token comments only, no shipped text). `build/icon.png` and `electron/assets/icons/*` are the upstream icons (not replaced in L1). Both are left unproven/undone on purpose and listed in section 8.
Upstream mentions that remain by design: `NOTICE`, `THIRD-PARTY-NOTICES.md`, a "derived from microsoft/skill-recorder (see NOTICE)" line in the relinking guide that `scripts/compliance.mjs` generates (the grep for `skill-recorder` in `scripts` finds only that).

## 3. Windows x64 job and artifact
- Run 45214529313: job "Windows x64" **success** in 8m26s on `b033456`.
- Steps all green, including "Run tests" (`ℹ tests 168 / pass 168 / fail 0`), "Package native installer" and "Verify packaged architecture", whose log line reads: `Verified native x64 package, compliance sources, notices, and no standalone FFmpeg: release\win-unpacked`.
- `verify-windows-package.mjs` now has no `copilot.exe` payload requirement and rejects any copilot payload, so a pass means no `copilot.exe` is inside.
- Artifact `handover-windows-x64` (14-day retention). Downloaded with `gh run download 45214529313 -R WarpDevelopment/handover -n handover-windows-x64`, it contains **`Handover-0.1.0-windows-x64.exe`** (499,779,675 bytes).
- Result: **passes**. The installer was not run on Windows (nobody can; see 8).

## 4. csc probe output (step "Probe in-box csc.exe and desktop session")
```
csc.exe path: C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe
csc.exe found: True
csc exit code: 0
hello from the csc probe
OSVersion=Microsoft Windows NT 6.2.9200.0
Is64BitProcess=True
UserInteractive=True
GetDesktopWindow=65548
GetForegroundWindow=197054
probe exit code: 0
```
Reading: the in-box compiler exists, a C# exe compiles and runs on the hosted runner, the session is interactive, and `GetDesktopWindow` and `GetForegroundWindow` both return non-zero handles. (`OSVersion` prints the compat-shim value 6.2.9200 because the csc-built exe has no manifest; it is not the real OS version.) This is one run; it says the L5 helper CAN be compiled and probed in CI, not that a low-level mouse hook works there.

## 5. macOS job and zip artifact
- Run 45214529425: job "macOS arm64" **success** on `b033456` (steps: lockfile, `npm ci`, compliance prepare, licence coverage, window provider, `npm test`, `npm run build`, `npm run dist:mac`, upload).
- Artifact `handover-macos-arm64` (unsigned/ad-hoc zip, 510,238,154 bytes, 14-day retention).
- Result: **passes**. The zip was not downloaded and opened.

## 6. App starts on the Mac with the Handover name
- `npm run electron:install-reviewed` then `npm start` (= `scripts/run-reviewed-electron.mjs start`) launched the Electron process from this worktree and kept running for 15 s. Log: `[Main] Capture: recording all sources`, `[Sensitive/models] advanced protection on; provisioning OCR model in background`.
- The app created its `userData` folder as `~/Library/Application Support/Handover`, which confirms the product name is Handover.
- **Not proven:** "recording to Stop works". The launched app printed `[Screen sources] Could not list screens: Failed to get sources.` (macOS Screen Recording permission is not granted to this terminal session) and nobody was at the keyboard to click Record and Stop. `npm test` covers the recorder controller state machine (start, stop, discard) with fakes. The owner-at-keyboard Mac check batched after L4/L5 should cover this.

## 7. Rules checked
- No new skipped tests, `@ts-ignore` or suppressions. `third_party/compliance-policy.json` untouched (its `copilotCli`/`copilotSdk` keys are now unused, which is harmless; the compliance cache key is unchanged).
- Added or changed tests: `electron/sessions.test.ts` asserts the session summary has only recording fields (would fail on the old shape with `analysis`, `hasSkill`, `hasAutomation`, `imported`); `scripts/compliance.test.mjs` asserts the Windows workflow uploads `handover-windows-x64` and has no arm64, `install.ps1` or `test:ai:runtime`; the debug-bundle test asserts only the session folder and `debug-info.json` are zipped.
- Privacy floors: nothing was added that captures input. The app still has the upstream capture set; the L2-owned defaults (clipboard preview, URL reader, terminal, OCR on, narration download) are unchanged here.
- Trap 1: `evals/{register,hooks,electron-stub}.mjs` moved to `test/harness/` (git renames), every `--import` path updated, `hooks.mjs` lost its catalogue redirect. Trap 2: `build:vite` is plain `vite build`.
- Reduced `window.skillRecorder` to `window.handover` in `electron/preload.cjs` by hand (tsc does not check it); the preload channel list now matches `common/ipc.ts`.

## 8. Left unproven or undone
- Windows behaviour: the installer was never run on Windows. CI proves compile, unit tests, packaging and the architecture check only.
- Icons: `build/icon.png` and `electron/assets/icons/*` are still the upstream images. Replacing them needs artwork.
- "Scout" wording in `src/App.css` comments, and the README, were left as is (README was already Handover from the planning commit).
- Mac Record-then-Stop by a person (section 6).
- Dead code kept on purpose: `electron/sensitive/scanner.ts` report persistence, `electron/sensitive/frame-redact.ts` and the `copilotCli`/`copilotSdk` policy keys are unreferenced by the app now; L2 owns the sensitive defaults and the policy file must not change.
- Dependency warnings: `npm ci` still prints the upstream `npm audit` notice; nothing changed there.
