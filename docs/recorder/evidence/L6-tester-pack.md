# L6 tester-pack: evidence

Branch `lane/L6-tester-pack`, BASE_SHA `a795b44`. Node 24.19.0.

## Deliverables
| # | File | Status |
|---|---|---|
| 1 | `docs/recorder/windows-test-script.md` | Written: install (SmartScreen, per-user folder choice, antivirus, first launch), Checks 1 to 9, send back, uninstall, "What happened: ____" on every step |
| 2 | `docs/recorder/tester-results-form.md` | Written: header fields and one row per check |
| 3 | `docs/recorder/release-notes-0.1.0-tester.md` | Written: In list, Out list from the plan, known limits from the L2, L3 and L5 evidence, privacy floors |
| 4 | `.github/dependabot.yml` | Removed (`git rm`); it existed |
| 5 | `docs/recorder/smoke/mac-owner-session.md` | Written: permissions, the known test process with exact steps, narration lines and a reference answer, Explain, pause, narration, review, export, diagnostics, L5 click checks |

## Label check against the code
Matched to `src/` and `electron/`: round record button (`aria-label` "Start recording" / "Stop recording"), `Ctrl+Shift+R` (`electron/main.ts`), floating bar buttons **Discard**, **Done**, microphone button, "Choose microphone", **Narrate** switch, **Recording settings** gear with **Language**, **Microphone**, **Screen**, **Review sessions** (aria-label of the `sessions-open` button), **Export package** (`Library.tsx`), tray items **Start recording**, **Show window**, **Save diagnostics…**, **Quit** (`electron/tray.ts`), the banner text (`common/banner.ts`), installer (`nsis`: not one-click, per-user, folder choice; file name `Handover-<version>-windows-x64.exe` from `artifactName`).

Marked "(label may differ slightly)" because L4 has not landed (no Explain or pause code exists in `src/` or `electron/` at this base): the **Explain** button and tool names, **Done**/Enter in the comment card, **Pause** / **Resume**, and the whole review screen (steps list, delete, edit, blur tool). `Ctrl+Shift+E` is taken from L4's contract.

## Checks
| Check | Result |
|---|---|
| `npm test` | 267 tests, 0 failed, 0 skipped (docs and one config removal only) |
| `npm run build` | exit 0 |
| CI on code commit (docs, one config removal) | Windows https://github.com/WarpDevelopment/handover/actions/runs/45234103164 success; macOS https://github.com/WarpDevelopment/handover/actions/runs/45234103114 success. The evidence-link commit has its own runs on the branch page. |

## Unproven / for the orchestrator
- After L4 merges, re-read the script against `src/FreezeOverlay.tsx`, `src/StepReview.tsx` and the floating bar, and delete the "label may differ" marks that turn out right. Also decide whether "Review sessions" is how L4 reaches the review screen.
- The Mac session's known test process has not been run by a person. Its reference answer lists 8 actions; the Explain step adds annotations, not an action.
- The first-launch "What's recorded" sheet (`WhatsRecorded.tsx`) is not in the Windows script; if it appears, testers should note it.
- Nothing here was run on Windows.
