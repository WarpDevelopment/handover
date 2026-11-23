# L3 steps-frames-export: evidence

Branch `lane/L3-steps-frames-export`, base `6d0c0d3`. Node 24.19.0, macOS arm64.

## What was built
- `common/handover/` (pure, no Electron): `types.ts`, `geometry.ts`, `edits.ts`, `steps.ts`, `images.ts` (sharp), `build-package.ts`, `process-md.ts`, `handoff-md.ts`, `validate.ts`, `read-session.ts`, `displays.ts`, `canonical.ts`, and `schema/tester-package.schema.json`.
- `buildPackage(session, edits, ctx)` returns `Promise<Map<path, bytes>>`. It is async because `sharp` is. Text files are deterministic for a fixed `ctx`.
- `electron/video/{recorder.ts,capture-preload.cjs}` rewritten: every display is captured at native size up to 2,560 px wide, about 3 fps, JPEG q0.9, into a ~2.2 s in-memory ring (`electron/frames/ring.ts`). `electron/frames/shot-store.ts` writes to `shots/` only the frames a step needs (newest frame at least 50 ms before a click or app switch, on the click's display; one "after" frame about 500 ms after the last action). `snapshot(force)` is implemented for L4's freeze. No video is recorded any more.
- `electron/recorder/controller.ts`: records a `displays` event at start and on every display change (`publishDisplays`), and feeds every event to the video sidecar.
- `electron/export.ts` writes `<slug>__<package_id>.handover/` and `.zip` through `dialog.showSaveDialog` (IPC `sessions:export-package`), with an "Export package" button on a session in Library.
- Edit type with all four operations (`delete_step`, `edit_summary`, `edit_comment`, `blur_rect`). The first three are applied. `blur_rect` and any unknown operation throw `UnsupportedEditError` before anything is built (fail closed).

## Acceptance
| # | Check | Command / run | Result |
|---|---|---|---|
| 1 | Golden synthetic session: byte-stable `manifest.json`, `steps.jsonl`, `annotations.jsonl`, `gaps.jsonl`, `PROCESS.md`, `CLAUDE_HANDOFF.md`, `README.txt`; manifest hashes verify; `validatePackage` passes | `common/handover/build-package.test.ts` ("golden"). Fixtures: `test/fixtures/session-synthetic/` (events, 12 frame PNGs, shots index) and `test/fixtures/golden-package/` | Pass. Two builds are byte-identical (PNGs included). |
| 2a | Image resizing respects the 1,568 rules | `geometry.test.ts` "fitFullImage…" and the per-step assertions in `build-package.test.ts` | Pass |
| 2b | Crop transform round-trips | `geometry.test.ts` "the crop is 800x500…", "the dpx to fpx transform round-trips" | Pass |
| 2c | Before-frame selection picks the newest frame at least 50 ms before the click | `geometry.test.ts`, `ring.test.ts`, `shot-store.test.ts`, and end-to-end in `build-package.test.ts` (shot at t=2,980 is skipped for a click at 3,000) | Pass |
| 2d | macOS and Windows coordinates, including negative origins | `geometry.test.ts`, `build-package.test.ts` (macOS display at origin (-1280, -100); Windows layout with a display at (-2560, 100), no scale factor applied) | Pass |
| 3 | Mac app records ~1 minute across two apps and exports a package that passes `validatePackage` | See "Mac run" below | Pass, with the caveats listed |
| 4 | CI green with the Windows artifact | See "CI" below | see below |

Test count: `npm test` runs 223 tests, 0 failed, 0 skipped. `npm run build` exits 0. New suites: `canonical`, `geometry`, `steps`, `build-package`, `validate` (in `common/handover/`), `ring`, `shot-store`, `export` (in `electron/`), plus a controller test for the `displays` event and the video feed.

Other tests worth knowing about:
- Edits: delete renumbers step ids and image names and drops its annotations; edit-summary sets `summary_provenance: user` and the `user_edited` flag; edit-comment sets `source: review`; `blur_rect` and unknown operations throw.
- Privacy: a hostile clipboard `textPreview`, terminal command, and extra `value` fields on a click never reach the package. The password-field step has its before frame pixelated and `contains_redaction` set (pixel diff shows changes only inside the rectangle).
- `validatePackage` negative tests: tampered file, missing file, id hole, dangling reference, bad time sum.

A real bug found by a test: sharp keeps only the last `resize` in a chain, so the first version of the blur did nothing. Fixed in `images.ts`.

## Mac run (check 3)
- How: a throwaway Electron harness (built with vite, run with the installed Electron 43.1.1, not committed) started the real `RecorderController` with the real active-window collector and the new `VideoRecorder`, ran for 60 s while `osascript` switched Finder → Calculator → Finder → Calculator, published **one synthetic `pointer.click`** (no click helper exists until L5), stopped, then ran `exportPackage` and `validatePackage`. It did not go through the Record button.
- Result: capture started on 2 displays; 9 events; 11 frames kept on disk (3.9 MB) for 6 steps; export wrote a folder and a 3.1 MB zip; `validatePackage` returned `{"ok":true,"errors":[]}`; `PROCESS.md` has 6 steps (4 app switches, 1 synthetic click, and the starting app).
- The package is **not committed**: its screenshots show the owner's real desktop. Shape instead: 6 steps, 7 PNGs (`S02`–`S06` before-full, `S04` crop, `S06` after-full), `evidence T0` for all (no helper), window titles empty because the Mac "reduced capture" mode had no Accessibility grant in this session.
- CPU: all Electron processes together averaged **0.8 % of one core (max 1.0 %)** over 11 samples at 5 s intervals (Browser 0.1, GPU 0.4, hidden capture renderer 0.4). **Caveat:** the screen was almost static, so most ticks took the "unchanged frame" shortcut (a 9×8 hash, no JPEG encode). A busy screen costs more (up to ~3 JPEG encodes per second per display); that case was not measured.
- Ring memory: about 2 s × displays × 0.3–0.6 MB, a few MB total (`ring.test.ts` bounds it).

## CI
Filled in below after the final push.

## Left unproven or open
1. **UI Record/Stop path** was not clicked; the harness called the controller directly.
2. **Frames before the first step:** capture needs about 0.8 s to start, so a step in the first second has no before frame. The step is still listed, without images. Controller order (collectors, then capture) is unchanged.
3. **Context steps** (app switches) have no control, so their `target` carries only `app`, `window` and `url`, with no `grounding` or `locators`. `tester-package.md` §4.2 does not say what a context step's `grounding` is; this is a question for the orchestrator. PROCESS.md shows them as `evidence T0` without a reason.
4. **Annotated images** (`*_full_annotated.png`) are not rendered; highlights are written to `annotations.jsonl` with `geometry_fpx` mapped onto the step's before frame. Rendering is L4's.
5. **Highlight frames:** a highlight made on a different display than the step's before frame uses the expected scale of that display, not a real frame. Highlights on a step with no before frame are dropped.
6. **Golden manifest and PNG bytes:** PNG hashes depend on the libvips build, so the golden `manifest.json` masks the `sha256` and `bytes` of `.png` entries. Text files are compared exactly. Linux/Windows PNG bytes were not compared with macOS bytes.
7. **JPEG source:** frames are captured as JPEG q0.9 (to keep the ring small) and converted to PNG at export.
8. **Start sheet:** there is no UI for it yet. `process.json` in the session folder is read when present (title, goal, done-when, trigger, position); otherwise the title is `Recorded process <session id>`.
9. **`helper`** in the manifest is `{present: false}` until L5 lands.
10. **`package.json` and `.gitattributes`** are touched in their own commits (`test:` script list; `test/fixtures/** -text` so Windows checkouts keep golden files byte-exact).
