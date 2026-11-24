# FP: package fixes (evidence)

- **Branch:** `lane/FP-package-fixes`, BASE_SHA `bcec7c9`. Fix commits: `5d64b67` (builder, steps, schema, validator, golden, docs), `6ae7ed8` (export, review service, StepReview), `375a7c7` (test list).
- **Checks run locally (CI is unavailable):** `npm test` 352 tests, 0 fail; `npm run build` exits 0.
- **Fails on base:** every new test below was run against `bcec7c9` (with stubs only for the new exports `passwordRectFrame`, `foldEditText`, `planClickCrop`): 27 of the 35 tests in `package-fixes.test.ts`, `review.test.ts` and `export.test.ts` fail there, including one or more per finding below.

| Finding | Fix | Test that proves it |
|---|---|---|
| PKG-1 | after frame only for the last recorded step and only while `c.t < tEnd` (`build-package.ts`) | `package-fixes.test.ts`: "PKG-1: after the last step is deleted…", "…at or after the end of the last step…" |
| PKG-2 | `steps.ts`: acted-time ordering and `t_start_ms`; an activate is suppressed when a click on that app (or inside its window) lies in [report − 1,800 ms, report + 300 ms]; suppressed activates are never pushed, so a double-click merges across them | `steps.test.ts` three PKG-2 tests; `package-fixes.test.ts` "PKG-2…" |
| PKG-3 | click with no control keeps the last app only inside the last window bounds; else `{name:"", kind:"unknown"}`, `scope_verified: false` | `steps.test.ts` PKG-3; `package-fixes.test.ts` PKG-3 |
| PKG-4 | `point_fpx` and `frame_point` from `expectedFrameScale`; no "0,0"; highlights kept without `frame_id`; flag `low_confidence_target` | `package-fixes.test.ts` two PKG-4 tests |
| PKG-5 | `allOf`/`if-then` in the schema and the validator; `before`-or-flag and highlight `frame_id` checks in `validatePackage` | `package-fixes.test.ts` two PKG-5 tests (the "no before frame, no flag" package is rejected) |
| PKG-6 | `buildStepsWithState().stateAt(f.start)`; frozen-frame fallback in [start − 1 s, end] | three PKG-6 tests |
| PKG-7 | comment re-attached to the freeze's first surviving Explain step | PKG-7 test |
| PKG-8 | `foldEditText`/`assertEdit` (one line, never empty), `oneLine` in `process-md.ts`, atomic export in `electron/export.ts`, empty comment refused in `ReviewService.toEdit` | PKG-8 tests in `package-fixes.test.ts`, `review.test.ts`, `export.test.ts` |
| PKG-9 | `planClickCrop` centres on the click when the bounds exceed the crop or miss the click; `tester-package.md` §4.3 updated | two PKG-9 tests |
| PKG-10 | `withoutFrozenCollectorEvents` drops own `app.activate` and `app.title-change` | PKG-10 test |
| SEC-1 | `blur_rect.frame`; after image blurred, listed and flagged; review shows the after image as its own item (`afterImage`, "Before / After" toggle in `StepReview`) | SEC-1 tests in `package-fixes.test.ts` and `review.test.ts` |
| SEC-4 | password rectangle applied to the after frame | SEC-4 test |
| SEC-5 | `passwordRectFrame`: clamp first, fall back to 400×100 around the click, else throw | SEC-5 test |
| SEC-6 | element name, ancestry and `role_name_path` replaced with `[REDACTED]` when a summary is edited | SEC-6 test |
| APP-9 | `ReviewService` keeps one session, `evict(sessionId?)`, `thumb/<path>` previews (320 px) used by the filmstrip | two APP-9 tests in `review.test.ts` |
| SEC-2 (FP half) | "Done reviewing" button in `StepReview` calling `window.handover.markReviewed(sessionId)`, rendered only when `typeof window.handover.markReviewed === "function"`; on success it closes the review | not unit-tested (no renderer test harness in this repo); typechecked and built |

## Golden files
Regenerated with `UPDATE_GOLDEN=1`. Only `steps.jsonl` and the manifest hash of it change: S02 `t_start_ms` 3000 → 2988 (the click was reported at 3,000 after a 12 ms lookup, so it is now timed when the user acted) and S01 `t_end_ms` 3000 → 2988 (its end is the next step's start). `PROCESS.md`, annotations, gaps and all PNGs are unchanged.

## Behaviour changes worth knowing
- `t_start_ms` of a click step is the acted time, and the existing tests that asserted the reported time were updated (`steps.test.ts`, `build-package.test.ts`).
- A control-less click outside the last known window now yields "Click at (x, y)" with no app. Existing `steps.test.ts` cases were given window bounds so they keep testing ordering.
- A highlight's `frame_id` is absent only for a step with no picture; the schema and doc say so.
- `edit_comment` with empty text is now refused (review UI shows "A note cannot be empty").

## Not done, unproven, or needs another lane
- **APP-9 wiring (FA):** `ReviewService.evict()` exists but nothing calls it yet. FA's `electron/main.ts` should call `review.evict(sessionId)` when a session is deleted and `review.evict()` when the library window closes. Until then memory is bounded to one session (the latest loaded), not zero after closing.
- **SEC-2 (FA):** the button only appears once FA's `sessions:mark-reviewed` channel is exposed as `window.handover.markReviewed`; the export gate itself is FA's.
- **PKG-2 residual:** the suppression window is 1.8 s before and 0.3 s after the activate report. A click on the same app after a keyboard (Alt-Tab) switch within 1.8 s of the switch report also suppresses that switch step. Judged an acceptable trade for the tester build.
- **PKG-6 residual:** a freeze with no earlier event now says "Explain on the screen" with an unknown app, rather than borrowing the first app seen later.
- **Real-device behaviour** of the preview thumbnails and the "Before / After" toggle is not exercised (no Electron in the test run).
