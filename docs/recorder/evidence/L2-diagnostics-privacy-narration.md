# L2 diagnostics-privacy-narration: evidence

Branch `lane/L2-diagnostics-privacy-narration`, BASE_SHA `6d0c0d3`. Node 24.19.0. Test count: 168 at base, 182 now (`npm test`, 0 fail, 0 skipped).

## What changed
- **Logger:** `electron/logger.ts` writes `userData/logs/handover-YYYYMMDD.log`, rotates at 5 MB (`.1.log`), keeps 7 days, and never writes object payloads (objects become `<object>`, Errors become `Name: message`). The sink is started explicitly from `main.ts`, so imports and tests stay console-only.
- **Diagnostics:** `electron/diagnostics.ts` (zip writer, no Electron import) and `electron/diagnostics-info.ts` (gathers versions, displays, permissions, capture sources, `runDoctor()`). The tray has "Save diagnostics…", which writes `handover-diagnostics-<timestamp>.zip` to the Desktop. The zip holds `diagnostics.json` and the log files only; it reads the session folder for a **count** and nothing else. `electron/doctor.ts` is untouched; `runDoctor()` is embedded as `doctor`, so L5's helper status will appear once the doctor reports it.
- **Per-session debug bundle** (`electron/debug-bundle.ts`): now only `debug-info.json`, no `session/` folder. The Library sheet text says so.
- **Clipboard:** no `textPreview`. The event is `{formats, length, hash}`.
- **Config:** `browserUrls: false` (the URL provider is never constructed, so no PowerShell), `terminal: false` with the recording-bar Terminal button hidden. Advanced protection OCR is off by default and `downloadTessdata` always throws "Downloads are disabled in this test build.", so there is no fetch.
- **Narration bundle:** `scripts/narration-models.json` pins the HF revision `2d67713f…` and the SHA-256 and size of the 7 files the upstream code downloads (`NARRATION_MODEL_FILES`). `npm run models:fetch` (same script CI runs) downloads into `extraResources/models` and exits 1 on any mismatch; `npm run models:verify` checks only. `narrationModelCacheDir()` reads `<resources>/models` when packaged and `extraResources/models` in dev (`HANDOVER_MODELS_DIR` still overrides). `local_files_only: true` and `allowRemoteModels = false`. The download IPC, preload entry, manager code and Recorder prompt are removed.
- **Packaging:** Windows takes the models through `win.extraResources`. macOS cannot use `extraResources` for them: `@electron/osx-sign` crashes in `isbinaryfile` ("RangeError: Invalid array length") on the ONNX protobufs, and `signIgnore` does not help because the walk runs first (macOS CI run 45220836534). `scripts/after-sign-models.cjs` copies the models in after signing and re-seals the bundle ad hoc. `verify-windows-package.mjs` now requires the pinned files inside `resources/models`, and the macOS workflow verifies the same files inside the `.app`.
- **Banner:** `common/banner.ts` holds "TEST BUILD — use test data only, not real client data" (exact string tested). `src/TestBanner.tsx` renders it at the top of the recorder window and above the floating bar; the bar overlay grew by 24 px (`recording-controls-bounds.ts` 76→100 and 250→274, tests updated). The Library window has no banner (not in scope, and L3 edits `Library.tsx`).
- **Network deny switch:** `electron/network-guard.ts`, `HANDOVER_DENY_NETWORK=1`, testing only, no UI. It installs a `session.defaultSession.webRequest` block (local schemes and loopback allowed, every blocked URL logged by origin only) and a `net.Socket.prototype.connect` guard in the main process (loopback and IPC paths allowed, blocked attempts logged).

## Acceptance
1. **Diagnostics zip has no media and no planted payloads.** `electron/diagnostics.test.ts`: plants `.png/.webm/.opus`, an `events.jsonl`, a transcript, a comment and a clipboard string in a session folder, writes the zip, asserts the entry list is exactly `diagnostics.json` and `logs/handover-….log`, then **decompresses every entry** and searches for each planted string. Pass, in `npm test`.
2. **Clipboard event has no text.** `electron/collectors/clipboard.test.ts` drives the collector with a stubbed clipboard holding a secret string and asserts the exact key set `[formats, hash, length]`, no `textPreview`, and the secret absent. Pass.
3. **Offline narration + diagnostics on the Mac.** Partly proven, see below.
4. **CI.** See the run URLs at the end.

### Acceptance 3 detail
Interactive part **not run**: I cannot speak into the Mac's microphone or grant the permission prompts from this session, so "record 30 s with narration in the GUI, then Save diagnostics" is **unproven** and needs the owner at the keyboard.

Proven instead:
- **Offline transcription from the bundled model, guard on.** `scripts/offline-narration-check.ts` installs the Node net guard, confirms a remote fetch is refused, loads the model through the real `getAsrPipeline()` from `extraResources/models`, and transcribes 17 s of synthesized speech (macOS `say`). Output:
  ```
  [net-guard] blocked outbound connection to huggingface.co:443
  remote fetch refused as expected: fetch failed
  model dir: …/extraResources/models  cached: true
  audio: 17.0 s
  transcribed in 5.7 s
  TRANSCRIPT: This is a test recording. First I open the invoices page and click the new invoice button. Then I choose the customer, enter a test amount, and press save. The invoice now appears in the list with the status draft. Next I open the reports page and export the monthly summary as a file.
  diagnostics written: …/diag.zip; blocked network attempts during the run: 1
  ```
  (The one blocked attempt is the deliberate probe; the model load made none.)
- **App starts with the switch on, dev and packaged.** `HANDOVER_DENY_NETWORK=1 npm start` and the packaged `release/mac-arm64/Handover.app` both ran. `handover-20261123.log` holds:
  ```
  INFO [Main] Handover 0.1.0 starting on darwin-arm64
  WARN [Main] HANDOVER_DENY_NETWORK=1: all non-local network access is blocked
  INFO [Main] Capture: recording all sources
  ```
  There is no "provisioning OCR model" line any more (the old L1 log had one).
- **Mac package.** `CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac` succeeds, `codesign --verify --deep --strict` passes, and `node scripts/fetch-models.mjs --verify --out=release/mac-arm64/Handover.app/Contents/Resources/models` reports 7 files verified.

## Left unproven or for the orchestrator
- The interactive 30 s recording with narration and "Save diagnostics…" (above). The tray item code path (`saveDiagnosticsToDesktop`) is not unit tested because it needs Electron; the zip writer under it is.
- **Clipboard floor.** Change detection still calls `clipboard.readText()` in memory to compute `length`/`hash`; nothing is emitted or stored. `common/events.ts` requires `length` and `hash`, so I kept them. If the floor must mean "never read the clipboard", the collector needs a different change signal and the event type needs relaxing. Orchestrator's call.
- Windows packaging of the models rides on `win.extraResources` and the new check in `verify-windows-package.mjs`; see the Windows run below.
- The WhatsRecorded sheet still shows an Advanced protection toggle; turning it on cannot fetch and shows an error state. Hiding it is UI polish I left alone.
- The `HF` revision is pinned in the manifest, so CI downloads from `huggingface.co` at build time only.

## CI
Code HEAD `5fb00ba`: Windows <https://github.com/WarpDevelopment/handover/actions/runs/45223668825> success (artifact `handover-windows-x64`, `verify-windows-package.mjs` passes with the 7 pinned model files inside `resources/models`); macOS <https://github.com/WarpDevelopment/handover/actions/runs/45223668522> success (artifact `handover-macos-arm64`, model verified inside the `.app`). The earlier macOS failure (run 45220836534) was the osx-sign crash described above. This evidence commit adds only this file.
