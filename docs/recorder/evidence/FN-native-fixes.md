# Lane FN (native-fixes): evidence

Branch `lane/FN-native-fixes`, BASE_SHA `bcec7c9`. Findings: NAT-1 to NAT-11, SEC-7, SEC-11 / NAT-12.

## Commits

| Commit | What |
|---|---|
| `db76ac2` | `CollectorContext.elapsedMs?()` (NAT-7 prerequisite) |
| `4ffee63` | Node side: NAT-1, 2, 3, 4, 7, 8, SEC-7, SEC-11 |
| `46980e6` | Windows helper: NAT-2, 3, 5, 6, 11 |
| `336ec01` | macOS helper: NAT-1, 3, 5, 9, 10, 11 |

Files outside lane FN, touched with the orchestrator's approval (`hc` message, "approved"):
- `electron/recorder/collector.ts`: optional `elapsedMs?(): number` on `CollectorContext`; `CollectorHost.startAll` takes an optional third argument.
- `electron/recorder/controller.ts`: one line, `startAll(..., () => store.elapsedMs())`. Without it the clock would never be passed.

## Findings

| Id | Fix | Test that fails on the old code |
|---|---|---|
| NAT-1 | Swift `teardownTap` / `tapHealthy` / `reconcileTap`: tap torn down when trust is lost, rebuilt when dead, `hook` only when the tap exists and is enabled, callback re-enables only when trusted | `NAT-1: trust revoked mid-run ...` (fake mode `trust-revoked`) |
| NAT-2 | C# hook thread at `ThreadPriority.Highest`; ~1 s watchdog (cursor moved + `GetLastInputInfo` changed + no callback tick); `hook_lost` then reinstall on the hook thread, `capabilities hook:true` closes the gap. Node: `hook_lost` gives an open `helper_restart` gap | `NAT-2: hook_lost opens a helper_restart gap ...` (fake mode `hook-lost`) |
| NAT-3 | C# and Swift escape or blank U+0085, U+2028, U+2029. Node: readline replaced by `createLineSplitter` (LF only, strips CR, drops oversize lines) | `NAT-3: U+2028 ...` (fake mode `unicode-name`), `NAT-3: the line splitter ...` |
| NAT-4 | `capabilities` branches on `hook === false` first: gap plus non-ok state | `NAT-4: hook false while Accessibility is granted ...` (fake mode `hook-false-trusted`) |
| NAT-5 | C#: element published as soon as resolved, ancestry against a 200 ms deadline stopping at the first window parent, `AutomationElement.RootElement` once, `OpenProcess` + `QueryFullProcessImageName`; on the 300 ms timeout the resolved element is returned, not `timeout`. Swift: same early publish and 0.2 s deadline | Not testable in Node (native). Compile-checked only, see below |
| NAT-6 | C#: integrity-level compare (`TokenIntegrityLevel`) of the root window's process before UIA; higher gives `elevated_window` + `accessibility_weak` with the window title kept. `vmware-view`, `vmware-remotemks` added | Not testable in Node |
| NAT-7 | Gap `tEndMs` from `ctx.elapsedMs()`, wall-clock fallback only if the context has none | `NAT-7: a closed gap ends on the session clock ...`, `CollectorHost hands each collector the session clock ...` |
| NAT-8 | Restart allowance resets when the helper ran `stableMs` (60 s) before exiting | `NAT-8: the restart allowance recovers ...` (fake mode `crash-after-hello`) |
| NAT-9 | Swift: lock around the set, marked done only on `.success`, hit test retried once, attribute switched off on stdin close, SIGTERM, SIGINT and selftest end | Not testable in Node |
| NAT-10 | Swift `safeInt` (`isFinite`, range), area as Double, `AXValue` type check | Not testable in Node |
| NAT-11 | Stuck lookups counted per root-window pid (max 2 per pid, 8 total) on both platforms | Not testable in Node. **UIA `TransactionTimeout` NOT DONE**: `IUIAutomation2` is not exposed by `System.Windows.Automation`, and reaching it needs a hand-written COM interop of the whole interface |
| SEC-7 | Spawn failures store `spawn error (ENOENT)` style codes, never `err.message` | `SEC-7: a spawn failure stores a code ...` |
| SEC-11 / NAT-12 | `defaultHelperLaunch` adds the cwd candidate only when not packaged (`isPackagedApp()`: Electron and not `defaultApp`) | `SEC-11: a packaged app never launches a helper ...` |

## Checks run

`npm test`: 330 tests, 330 pass, 0 fail (320 before, 10 new). `npm run build`: exit 0. `tsc --noEmit`: clean.

**Windows helper compile check** (throwaway csproj outside the repo, `net48`, `LangVersion 5`, `Microsoft.NETFramework.ReferenceAssemblies`, UIAutomationClient/Types, WindowsBase, `native/windows/HandoverHelper.cs` by path):

```
check -> .../fn-cs-check/bin/Debug/net48/check.exe
Build succeeded.
    0 Warning(s)
    0 Error(s)
```

`LangVersion 5` is enforced: a separate scratch file using `?.` fails with `error CS8026: Feature 'null propagating operator' is not available in C# 5`. The real build (`scripts/build-helper-win.ps1`, in-box csc.exe) was not run: nobody here has Windows.

**macOS helper:** `npm run build:helper:mac` exit 0. `native/build/HandoverHelper --selftest`:

```
{"helper":"HandoverHelper","protocol":1,"version":"1.0.0","platform":"macos","type":"hello"}
{"type":"capabilities","interactive":true,"accessibility":false,"uia":false,"space":"macos_global_points","hook":true,"elevated":false}
{"fromPoint":"skipped","accessibilityTrusted":false,"reason":"permission_missing","type":"selftest","hookInstalled":true}
```

## Unproven (needs a real device)

- Windows: the watchdog actually firing on a silently removed hook, and the reinstall on the hook thread. The "cursor moved + input changed + no tick" heuristic is untested against real Windows hook removal.
- Windows: the integrity-level check (`IsHigherIntegrity`), including `OpenProcess` denied being read as higher, and that no normal-integrity app is mislabelled. A foreground-elevation gap is out of scope for the tester build (per the finding).
- Windows: the 200 ms ancestry deadline and the early-element return in Edge, Office and Teams (the NAT-5 hypothesis).
- Windows: UIA `TransactionTimeout`, not implemented (see NAT-11).
- macOS: tap teardown and rebuild when Accessibility is revoked and re-granted live; `AXManualAccessibility` retry and switch-off; the per-pid stuck counter via `CGWindowListCopyWindowInfo`. The helper builds and runs, but trust was not toggled here.
- macOS no longer creates the tap while untrusted (the contract says to tear it down when trust is gone), so an untrusted Mac reports `hook:false` and a `permission_lost` gap rather than `permission_missing` clicks.

## Not done

- UIA `TransactionTimeout` (NAT-11, Windows part), reason above.
