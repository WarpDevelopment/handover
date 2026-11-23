# L5 click-control-helpers: evidence

Branch `lane/L5-click-control-helpers`, cut from BASE_SHA `6d0c0d3`. The last code commit is `56159d5`; everything after it is docs only. CI runs on that code commit, both green (a run on the docs-only HEAD follows and is quoted in the hand-off message):

- Windows x64: https://github.com/WarpDevelopment/handover/actions/runs/45221861362 (artifact `handover-windows-x64`)
- macOS arm64: https://github.com/WarpDevelopment/handover/actions/runs/45221860541 (artifact `handover-macos-arm64`)

(The first CI pass, runs 45219877404 and 45219877380, was also green. It exposed the cold-start defect below, which commit `fix(helper): warm up UIA...` fixed.)

## What was built

| Piece | Where |
|---|---|
| Windows helper (single C# file, `WH_MOUSE_LL` enqueue-only, UIA `FromPoint` worker with a 300 ms timeout, cache request, password flag, elevated and remote classification, `--selftest`) | `native/windows/HandoverHelper.cs`, `native/windows/app.manifest` (PerMonitorV2, `asInvoker`) |
| Windows build with the in-box `csc.exe` | `scripts/build-helper-win.ps1`, `npm run build:helper:win` |
| macOS helper (listen-only mouse-down `CGEventTap`, AX lookup on a background queue with a 300 ms timeout, `AXIsProcessTrusted()` polled every 1.5 s, `--selftest`) | `native/macos/HandoverHelper.swift`, `npm run build:helper:mac` |
| Protocol parser, field-by-field sanitiser | `electron/collectors/helper-protocol.ts` |
| Collector: spawn, map to `pointer.click`, gaps, restart (3 tries) | `electron/collectors/pointer-helper.ts`, registered in `electron/collectors/index.ts` (win32 and darwin only) |
| Helper status for the doctor: `ok / missing / crashed / no-permission`, version, last error, lookup p50/p95, counts by grounding | `electron/collectors/helper-status.ts`, `electron/doctor.ts`, `common/ipc.ts` (`DoctorReport.helper`) |
| Packaging | `package.json` `build.win.extraResources` and `build.mac.extraResources` (to `resources/helper/`) |
| CI | Windows: build, selftest, `verify-windows-package.mjs` helper check. macOS: build, selftest, zip listing check |
| Mac owner checklist | `docs/recorder/smoke/L5.md` |

Protocol (JSON lines on stdout, logs on stderr): `hello`, `capabilities`, `click`, `error`, `selftest`. `click` carries `button, clickCount, x, y, lookupMs, target?, unavailableReason?` with `target` shaped exactly as `ClickTarget`. The collector adds `space` from the platform, never from the helper.

Privacy: no keyboard hook exists in either helper (mouse-down mask only; `WH_MOUSE_LL` only). Neither helper reads `ValuePattern`, `TextPattern` or `AXValue`. Names come from `AXTitle`/`AXDescription` and UIA `Name`. Password fields keep role and name and set `isPassword: true`. The Node side rebuilds each target field by field, so an unexpected `value` field from a helper cannot reach `events.jsonl` (tested).

## Acceptance

### 1. CI Windows: compile and `--selftest`: PASS
The step "Build click helper and run its self-test" in the Windows run above. References resolved on the runner:

```
reference UIAutomationClient = C:\Program Files (x86)\Reference Assemblies\Microsoft\Framework\.NETFramework\v4.8.1\UIAutomationClient.dll
reference UIAutomationTypes  = ...\v4.8.1\UIAutomationTypes.dll
reference WindowsBase        = ...\v4.8.1\WindowsBase.dll
built D:\a\handover\handover\native\build\HandoverHelper.exe (20480 bytes)
```

Self-test output, quoted from the run log:

```
selftest> {"type":"hello","helper":"HandoverHelper","version":"1.0.0","platform":"windows","protocol":1}
selftest> {"type":"capabilities","hook":true,"uia":true,"interactive":true,"elevated":true,"space":"windows_virtual_px"}
selftest> {"type":"selftest","interactive":true,"hookInstalled":true,"coldFromPointMs":1067,"coldFromPoint":"found","fromPointMs":6,"fromPoint":"found","target":{"grounding":"accessibility","source":"uia","role":"listitem","nativeRole":"ListItem","name":"Recycle Bin","isPassword":false,"bounds":{"x":0,"y":5,"width":78,"height":70},"ancestry":[{"role":"pane","name":"Program Manager"},{"role":"other","name":"Desktop"}],"app":{"name":"explorer","process":"explorer"},"windowTitle":"Program Manager"}}
```

So the session is interactive, a `WH_MOUSE_LL` hook can be installed and removed, and `FromPoint` resolves a real control with role, name, bounds, ancestry and app.

Finding fixed on the way: in the first CI pass the first `FromPoint` call took 302 ms and came back `timeout`. UIA's first call in a process is a cold start (about 1 s here, 6 ms once warm). A real first click would have lost its control. The helper now warms UIA in the background at start, and the self-test reports the cold and the warm call separately. Clicks in roughly the first second after the helper starts can still return `timeout`; this is acceptable because the recorder starts the helper before the user's first action, but it is not proven on a slow laptop.

The macOS run also quotes its self-test (the runner has Accessibility trusted):
```
{"helper":"HandoverHelper","version":"1.0.0","protocol":1,"type":"hello","platform":"macos"}
{"space":"macos_global_points","hook":true,"type":"capabilities","uia":false,"interactive":true,"accessibility":true,"elevated":false}
{"hookInstalled":true,"fromPointMs":24,"fromPoint":"found","accessibilityTrusted":true,"type":"selftest"}
```
Locally on the owner's Mac without the grant: `accessibilityTrusted:false`, `hookInstalled:true`, `fromPoint:"skipped"`, `reason:"permission_missing"`.

### 2. Node protocol tests with a fake helper: PASS
`electron/collectors/pointer-helper.test.ts` (12 tests, in `npm test`; the whole suite is 180 tests, all passing in both CI jobs), driven by `test/fixtures/fake-helper.mjs`:
- well-formed click with a target becomes `pointer.click` with `space`, coordinates and sanitised target (an injected `value` field is dropped);
- click without a target carries its `unavailableReason`; a click with neither is given `opaque_toolkit`;
- malformed lines, missing coordinates, unknown types and oversize lines are ignored and produce no event;
- crash: an open `gap{helper_restart}`, a restart, a closing `gap` with `tEndMs`, and clicks after the restart;
- a helper that always crashes stops after the restart limit with one open gap and no exception; a helper that never says hello is killed and treated as a crash;
- missing helper: logs, opens a gap, status `missing`;
- macOS no Accessibility: clicks with `permission_missing` and no target, status `no-permission`, no gap; tap not creatable: `gap{permission_lost}`.

### 3. Helper deleted, the app still records and exports: PASS for record and save; export not exercised here
The last test starts a real `RecorderController` with the collector pointed at a missing helper, starts, stops and saves, and reads the session's `events.jsonl`: it contains `gap{reason: "helper_restart"}`, and the doctor tracker reports `missing`. The export builder is lane L3's, so "exports" is not exercised in this lane; recording and saving are.

### 4. Mac owner checklist: WRITTEN, NOT RUN
`docs/recorder/smoke/L5.md`. It needs the owner at the keyboard (Finder, Safari, TextEdit, with and without the Accessibility grant). Not run by me.

### 5. Windows installer includes `HandoverHelper.exe`, verified in CI: PASS
`scripts/verify-windows-package.mjs` now fails the job if `resources/helper/HandoverHelper.exe` is missing from the packaged `win-unpacked` directory, and checks that it is an x64 PE. Log line from the Windows run: `Verified helper payload: ...\release\win-unpacked\resources\helper\HandoverHelper.exe (20480 bytes)`. The check is on the unpacked app that NSIS wraps, not on the `.exe` installer itself. The macOS job lists the zip and requires `Handover.app/Contents/Resources/helper/HandoverHelper`; the log shows it present (138144 bytes).

## Not proven, and decisions for the orchestrator or other lanes

1. **A real click through the hook was never seen.** The runner has no input device. CI proves compile, hook install and removal, and UIA on a desktop element. The first tester run on Tuesday is the first proof that a physical click arrives. Also not proven: elevated-window detection (`elevated_window`), remote-client detection, the 300 ms timeout under a hung provider, and mixed-DPI placement.
2. **No hook watchdog.** windows-tech R4 suggests reinstalling a hook Windows silently removed. Not built; the callback only enqueues, which is the main mitigation. The collector restarts the helper only if the process dies.
3. **`app.kind` is not in `ClickTarget`.** The contract says remote clients report `app.kind` remote, but `ClickTarget.app` has no `kind` field and I was told not to change the types. For remote clients (mstsc, msrdc, msrdcw, Windows App, Citrix) the helper emits a weak target with `app.process` set and `unavailableReason: "remote_session"`. L3 should derive `kind: remote_session` from `unavailableReason` or the process name.
4. **Coordinates are in the OS global space only** (`windows_virtual_px`, `macos_global_points`), per the lane note. The plan's L5 section says the collector converts to display physical px; the lane note says L3 does. I followed the lane note.
5. **Gap convention for L3.** A `gap` without `tEndMs` opens a gap at the event's time. A later `gap` with the same `reason` and a `tEndMs` (ms from collector start, which is within a few ms of recording start) closes it. A missing helper leaves the gap open for the whole session.
6. **Click `t` lags the real click by `lookupMs`.** The session store stamps `t` when the event is appended, after the lookup. L3 should subtract `lookupMs` (up to 300) from `t` when choosing the "before" frame.
7. **The Windows helper is x64 only.** On the Windows 11 Arm VM it runs under emulation; the packaging check does the PE check for x64 builds only.
8. **Double-click detection** uses the system double-click time and distance on Windows and `mouseEventClickState` on macOS. Both mouse-downs are emitted; the second has `clickCount: 2`.
9. **`Electron` apps on macOS** need `AXManualAccessibility`; the helper sets it once per process on first sight, so the first click into an Electron app may come back weak.
10. I did not edit L2's files. `DoctorReport.helper` is available to L2's diagnostics zip through `runDoctor()`.
