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

## Review round 1 (t137): F1 to F6

**Superseded above:** the process name is now read by the existing `Native.ProcessName` (OpenProcess + QueryFullProcessImageName), not `Process.GetProcessById`; the "What the recorder could not see" list uses the spec's phrase "an administrator window the recorder cannot see into". The inline line in the step order is unchanged. Windows behaviour is still **UNVERIFIED on a real machine until the tester re-runs Check 8.**

- **F1 done.** `build-package.ts`: for `elevated_window` gaps only, with a 1.5 s tolerance: an `app_switch` step to the same process (base name, case-insensitive, `.exe`/`.app` ignored) up to 1.5 s after the gap start becomes `after_step`; a step at or after `end − 1.5 s` is the `before_step`, so no step is listed inside the gap. No tolerance on the switch-in when the gap carries no process name. Tests: switch 300 ms after the gap start (order in PROCESS.md and `after_step`), switch-away 300 ms before the gap end (`before_step`), and no-process. They fail with the tolerance set to 0 (checked: 2 failures) and pass at 1500.
- **F2 (first pass: blocked; resolved in "F2 done" below, scope was extended).** The collector cannot know about a pause. `CollectorContext` has `publish`, `log`, `sessionDir` and `elapsedMs` only; `RecorderController.pause()/resume()` only call `bus.setBlocked` and publish the `user_paused` gap, and no collector is told. Nothing in the bus lets a collector observe it either. Making this work means a new signal from `electron/recorder/controller.ts` (and `collector.ts`), which is outside this lane's file list. Proposed minimum: an optional `setPaused?(paused: boolean)` on `Collector`, called by the controller from `pause()` and from `closePauseGap()` (which also runs on stop-while-paused); `PointerHelperCollector` then keeps `elevatedNow` (what the helper last said) apart from `elevatedGapOpen`, opens nothing and writes no process name while paused, closes an open gap at the pause time, and reopens at the resume time if `elevatedNow` is still true. I have not guessed at it. Until then the behaviour is as in "Choice" above: both gaps are written, and the builder test below pins that.
- **F3 done (compiled, not run).** `OpenProcess` now has `SetLastError`; `IsHigherIntegrity` returns true on a failed open only for `ERROR_ACCESS_DENIED` (5); other failures (exited process, invalid pid) mean "not higher". `IntegrityRid` does the same for a failed `OpenProcessToken`. Per-click labelling uses the same functions, so it is consistent.
- **F4 done.** The name is resolved once, when the stretch starts, with `Native.ProcessName` (opens and closes its own handle; there is no `Process` object to dispose).
- **F5 done.** Foreground pid 0 while a stretch is open counts as no change for up to 3 ticks; the 4th consecutive tick ends the stretch. With no stretch open it does nothing.
- **F6 done.** `docs/recorder/tester-package.md` gap-reason list (that one line) now includes `elevated_window`. The `process-md.ts` list phrase matches `package-spec.md` §11 fixed copy. `validate.ts` now enforces `maxLength`, with a test (60 passes, 61 fails).
- **Extra builder tests:** an `elevated_window` gap with no end time runs to the session end and adds no paused time; an `elevated_window` gap overlapping a `user_paused` gap keeps both in `gaps.jsonl`, counts paused time once (2000 ms), keeps the time sum, and validates.

Results: `npm run typecheck` exit 0; `npm test` 452 tests, 452 pass, 0 fail, 0 skipped. Helper recompiled by the Mac route: `Build succeeded. 0 Warning(s) 0 Error(s)`, 25,600 bytes, not run.

## F2 done (planner ruling: a pause is off the record; scope extended to controller.ts and collector.ts)

This replaces the "Choice: elevated_window while the user has paused" section above. For the live app, an elevated gap never spans paused time; the builder still copes with a package where the two overlap (test kept).

- `electron/recorder/collector.ts`: optional `Collector.setPaused?(paused)`; `CollectorHost.setPaused` calls it on every running collector (a throwing collector is logged and does not break the pause).
- `electron/recorder/controller.ts`: `pause()` calls `host.setPaused(true)` after it publishes the open `user_paused` gap; `closePauseGap` (used by `resume()`) calls `setPaused(false)` after it publishes the closing gap. **Stop while paused:** `stop()` still closes the pause gap, but does not call `setPaused(false)` (`closePauseGap(store, false)`). The collectors are stopped right after, and a resume call would make the helper reopen an elevated gap only to close it again at the same instant (a zero-length "Not observed (0.0 s)"). The collector's own `stop()` closes anything open, and it was already closed at the pause. If you want the call on stop too, it is a one-word change plus making the collector ignore it.
- `electron/collectors/pointer-helper.ts`: `elevatedNow` (what the helper last said, with its process name) is separate from `elevatedOpen` (a gap is open). A blind start while paused sets `elevatedNow` and opens nothing, writes no name; `setPaused(true)` closes an open gap at the pause time (session clock); `setPaused(false)` opens one at the resume time, with the name, only if `elevatedNow` is still true; a blind end clears `elevatedNow`. Helper exit and `stop()` clear it.
- No other collector changed: `setPaused` is optional and only the pointer helper implements it.
- Tests: pointer-helper (a) start during pause opens nothing, no `Taskmgr` anywhere in the events, resume opens it with the name; (b) pause while open closes at the pause time (2000), resume reopens (`open, close@2000, open`); (c) end arrives during the pause, resume opens nothing (`open, close`). Controller level (`explain.test.ts`): `setPaused` calls are `[true]`, `[true,false]`, `[true,false,true]`, and no call on a stop while paused.

Results: `npm run typecheck` exit 0; `npm test` 456 tests, 456 pass, 0 fail, 0 skipped. The Windows helper was not changed in this step (last compile above still applies).

## Delta review (t137): D1 to D4

- **D1** `pointer-helper.ts`: on resume with `elevatedNow` true the gap does not open at once. A timer (`resumeGraceMs`, default 1200, injectable) waits; the helper's end line, a pause, `stop()` or a helper exit cancels it and nothing (no gap, no name) is written. Otherwise the gap opens with `tStartMs` = the resume time on the session clock. To carry that, `GapPayload` (`common/events.ts`) gains an optional `tStartMs` on an opening event, and `resolveGaps` starts the gap there (accepted only if finite, ≥ 0 and ≤ the event's own time). Tests: resume then end inside the wait (no gap, no name); resume with no end (one gap, `tStartMs` 500 while the timer fires at 900); pause again, and stop, while pending (nothing); builder test that `tStartMs` sets `t_start_ms`.
- **D2** `build-package.ts`: for `elevated_window` gaps, after the tolerance picks `after_step`/`before_step`, `t_start_ms` is raised to the after step's `t_start_ms` and `t_end_ms` lowered to the before step's, never below the start. The F1 tests assert it (3,100 to 3,400 and 5,100 to 4,800, "Not observed (1.4 s)"), plus a test that no step starts strictly inside a written elevated gap.
- **D3** The tolerance is one named constant, `BLIND_EDGE_TOLERANCE_MS = 2500`, with a comment (1.6 s poll after a browser, plus the helper's tick). Test: a switch 2.4 s after the start counts, 2.6 s does not.
- **D4** The F2 tests no longer sleep for the fake helper to start. They hand the collector the helper's line directly through a silent fake helper, so the order of pause and blind line is exact. `blind-hold` is still used where a real helper line is the point (pause while open).
- Not changed: the Windows helper, so no recompile this round (last compile: `Build succeeded, 0 Warning(s) 0 Error(s)`).
- Results: `npm run typecheck` exit 0; `npm test` 462 tests, 462 pass, 0 fail, 0 skipped.
- **Windows behaviour is still UNVERIFIED on a real machine until the tester re-runs Check 8.** The 1.2 s resume grace and the 2.5 s tolerance are reasoned values, not measured.

## Round E (t137): E1 to E4

- **E1** (regression from D2+D3, reproduced with the reviewer's stream: Task Manager 16000-17000, Notepad, Task Manager 17800-19000, Notepad; blind 16100-17100 and 18100-19100; S08@16500 TM, S09@17500 Notepad, S10@18500 TM, S11@19500 Notepad). Before: `gap_0001 {after S10, before S09, 18500..18500}`. `build-package.ts`: a switch-in counts only while `t < gap end` and `before_step` is not yet chosen; the clamp is skipped when `afterT >= beforeT`; an `elevated_window` gap whose written length is 0 is dropped (not in `gaps.jsonl`, no "Not observed" line, not in the could-not-see list; ids stay consecutive). Now: `gap_0001` S08 → S09, 16500..17100; `gap_0002` S10 → S11, 18500..19100, each "Not observed (0.6 s)", in step order. `validate.ts` rejects a gap whose `after_step` is later than its `before_step`. Pinned by the stream test, a zero-length test and a validator test. With the switch-in guard removed the stream test fails (checked), restored.
- **E2** Resume grace default 2000 ms, with the reason in the comment (helper tick 1 s plus loop and pipe time; 200 ms of margin was too thin). Not measured.
- **E3** Tests: pause, resume, pause, resume inside one grace window writes one gap stamped at the second resume; a helper exit while a resume is pending writes nothing (the test kills the silent fake itself, since `onExit` forgets the child); `resolveGaps` ignores `tStartMs` that is NaN, negative, infinite or later than the event.
- **E4** The blind branch logs `helper: blind start` / `helper: blind end`; the resume path logs `resume: elevated gap opened` / `resume: cancelled`. State only: the test checks the log holds neither "taskmgr" nor "task manager". No C# change, no helper recompile.
- Results: `npm run typecheck` exit 0; `npm test` 470 tests, 470 pass, 0 fail, 0 skipped. **Windows behaviour is still UNVERIFIED on a real machine until the tester re-runs Check 8.** Windows behaviour is still **UNVERIFIED on a real machine until the tester re-runs Check 8.**
