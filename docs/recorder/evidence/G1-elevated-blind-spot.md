# G1: the elevated-window blind spot made visible

Base `7bf0ff4`, branch `lane/G1-elevated-blind-spot`. Host: macOS, Node 24.19.0 (`/opt/homebrew/opt/node@24`; the default Node 26 on this Mac rejects `--experimental-transform-types`).

**UNVERIFIED on a real Windows machine.** Nothing here proves that the helper sees the foreground window of an elevated Task Manager, or that the line reaches the app on Windows. That is proven only when the tester re-runs Check 8 with Task Manager opened as administrator. The Node side is tested against a fake helper; the C# side is only compiled.

## What changed

- `native/windows/HandoverHelper.cs`: the watchdog loop (1 s tick, runs whether or not the mouse moved) asks `Native.ForegroundHigherIntegrity`. On false→true it emits `{"type":"blind","reason":"elevated_window","state":"start","process":"<exe>"}` (process omitted if the name cannot be read); on true→false it emits `state":"end"`. One start per stretch (`blindOpen` flag). Documented in the protocol comment at the top. No keyboard hook, no elevation, no manifest change.
- `electron/collectors/helper-protocol.ts`: new `blind` message. Unknown reason, bad or missing state: rejected (null). The process name is reduced to a bare file name (no path, control characters removed, 60 characters).
- `electron/collectors/pointer-helper.ts`: start opens an `elevated_window` gap (`{reason, process}`), end closes it (`{reason, tEndMs}` on the session clock). A repeated start is ignored. It is closed on `stop()` (before the context is dropped) and when the helper exits (restart). Tracked in its own flag, apart from the single `openGap` slot, so a `helper_restart` gap does not swallow it. Not a pause: app switches and other collectors keep running; the helper state stays `ok`.
- `common/events.ts`, `common/handover/types.ts`, `tester-package.schema.json`: new reason `elevated_window`, optional `process` (max 60) on the gap.
- `common/handover/build-package.ts`: `resolveGaps` carries the process name; `gaps.jsonl` records it for `elevated_window` only. It does not count as paused time and does not hide clicks (only `user_paused` does).
- `common/handover/process-md.ts`: after the step the gap follows (and before the next step, or before the first step if there is none), a line such as: `Not observed (2.0 s): an administrator window (Taskmgr) was in front. Windows does not let Handover see clicks there. Ask the author what was done.` The "What the recorder could not see" list also gets `gap_000N (S02 → S03): an administrator window was in front, 2.0 s.`
- `common/handover/handoff-md.ts`: not changed. Its rule ("Intervals in gaps.jsonl were not observed: do not put steps inside them... list them under gaps") already reads correctly for this reason, and `handoff-md.test.ts` compares that text with `docs/recorder/package-spec.md`, which is out of scope. PROCESS.md, which the handoff tells the reader to use, carries the "Ask the author" wording.
- macOS helper: untouched. The app's parser accepts the new line from any helper; the macOS helper never sends it.
- `test/fixtures/fake-helper.mjs`: modes `blind-repeat`, `blind-hold`, `blind-crash-once`. No golden file changed (the golden session has no such gap).

## Choice: elevated_window while the user has paused

Gap events are not dropped by a pause (only `PAUSE_BLOCKED_TYPES` are), so both gaps are written and stay as two separate reasons with their own intervals, unchanged by one another. Paused time is computed from `user_paused` only, so the overlap is not counted twice. PROCESS.md may therefore say both "paused by the user" and "Not observed ... administrator window" for overlapping time. I chose this over trimming one by the other because the pause is the author's own choice and the blind spot is a fact about Windows; both are true and the reader can see both. A rule that removes the pause overlap from the elevated gap would be a small change in `build-package.ts` if wanted.

## Tests (written first; tests are in the existing `pointer-helper.test.ts` and `build-package.test.ts`, so the `test` script list needed no new file)

Red on `7bf0ff4`: `npm run typecheck` failed on the new tests (`TS2367: ... '"blind"' have no overlap`, and no `elevated_window` in the gap reason type). I stopped a runtime run of the red tests before it finished (each failing wait is 8 s), so the runtime red is not recorded; the typecheck failure is the red evidence.

Green after the change (`npm test`):
```
✔ G1: an elevated_window gap reaches gaps.jsonl, validates, and PROCESS.md says it was not observed between the right steps
✔ G1: an elevated_window gap with no process name still reads plainly
✔ G1: a blind start and end line parse; a malformed one is rejected
✔ G1: blind start and end open and close one elevated_window gap; a repeated start does not open a second
✔ G1: stopping the recording closes an open elevated_window gap
✔ G1: a helper restart closes the elevated_window gap, and the new helper's start opens a fresh one
ℹ tests 446
ℹ pass 446
ℹ fail 0
ℹ skipped 0
exit=0
```
`npm run typecheck`: `tsc --noEmit`, no output after the banner, exit 0.

## Windows helper compile

Compiled with the FW route (throwaway `helper.csproj` outside the repo: net48, x64, LangVersion 5, `app.manifest`, `Microsoft.NETFramework.ReferenceAssemblies 1.0.3`, UIAutomation references, `~/.dotnet/dotnet build -c Release`): `Build succeeded. 0 Warning(s) 0 Error(s)`, `HandoverHelper.exe` 25,600 bytes (was 25,088). The binary was not copied into the repo and not run (needs Windows; `--selftest` not run).

## Not done / open

- Real-machine behaviour (see top). Also unproven: `Process.GetProcessById(...).ProcessName` for an elevated process (expected to work without a handle; the name is omitted if it throws).
- Detection only looks at the foreground window, as asked. An elevated window under the cursor that is not in the foreground is not reported.
- Up to about 1 s of lag at each edge, since the watchdog ticks once a second.
