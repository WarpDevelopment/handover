# Handover tester package (`schema_version: "0.1-tester"`)

The package format for the tester build (Monday 23 / Tuesday 24 Nov 2026). It is a strict **subset** of `docs/recorder/package-spec.md` (v0.1): the same file names, field names, id patterns, coordinate spaces and redaction tokens. A tester package keeps its meaning when the full schema arrives, and new fields only get added, never renamed.

Build lanes implement **this** document. Use the full spec only to look up a field this one names but does not define. Where they disagree, this one wins for the tester build.

## 1. Privacy floors (not negotiable in any lane)
- No keyboard hook on either OS. Typed characters are never captured.
- No field value is read through accessibility, and no clipboard content is read.
- Password fields: when `is_password` (macOS `AXSecureTextField`, UIA `IsPassword`) is true, the element name is kept but no value is read, and the step's before frame gets a blurred rectangle over the field bounds.
- URLs are reduced to origin plus path. Query and fragment are dropped.
- Nothing is sent over the network by the app. There is no telemetry, no sign-in, no AI call and no update check.
- The package carries no audio and no video, only the narration transcript.
- Every window and the README carry the banner "TEST BUILD — use test data only, not real client data".

## 2. Folder layout
```
<slug>__<package_id>.handover/
├── README.txt            banner + "Start here: CLAUDE_HANDOFF.md"
├── manifest.json
├── CLAUDE_HANDOFF.md     §6
├── PROCESS.md            §5
├── steps.jsonl           one step per line
├── annotations.jsonl     highlights, comments, narration
├── gaps.jsonl            pauses and capture problems (may be empty)
└── media/
    ├── S01_before_full.png
    ├── S01_before_crop.png              800×500 logical px around the target
    ├── S02_before_full_annotated.png    only when the step has highlights
    └── S05_after_full.png               last step only
```
The export also writes `<slug>__<package_id>.zip` holding the same folder. `<slug>` is the process title in lower kebab case, at most 40 characters. `package_id` is `pkg_` + a ULID.

All JSON is UTF-8 with sorted keys and LF line endings. `jsonl` files have one object per line in id order. Images are PNG with metadata stripped, and blurs are burned into the pixels.

## 3. `manifest.json`
| Field | Value |
|---|---|
| `format` | `"handover-package"` |
| `schema_version` | `"0.1-tester"` |
| `package_id` | `pkg_<ULID>` |
| `created_at` | ISO 8601 with offset |
| `recorder` | `{name: "Handover", version, os: "macos"\|"windows", os_version, arch: "arm64"\|"x64", locale}` |
| `author` | `{pseudonym: "author-1", position}`. `position` comes from the start sheet ("Your role"); default `"unknown"`. Never a real name. |
| `process` | `{title, goal, done_when, trigger: {kind: "event"\|"schedule"\|"request"\|"manual"\|"unknown", text}}`, from the start sheet. Only `title` is required there; empty answers are `""`. |
| `recording` | `{started_at, ended_at, timezone (IANA), duration_ms, task_ms, explain_ms, paused_ms, step_count}` where `task_ms + explain_ms + paused_ms = duration_ms` |
| `capture` | `{capabilities: {input_mouse: bool, a11y_hit: bool, capture_backend: string, keyboard: "none"}, helper: {present: bool, version?: string, error?: string}}` |
| `displays` | `[{display_id: "d0", global_space: "macos_global_points"\|"windows_virtual_px", origin_global: [x,y], size_dpx: [w,h], scale_factor, primary}]` |
| `media` | `{image_profile: "standard", image_count, format: "png", video_included: false, audio_included: false}` |
| `privacy` | `{reviewed_by_user: true, reviewed_at, test_build: true}` |
| `files` | `[{path, sha256, bytes}]` for every file except `manifest.json` and the zip |

## 4. Records

### 4.1 `steps.jsonl`
One step is one click, one app/window switch, or one manual step the user added.

| Field | Required | Notes |
|---|---|---|
| `step_id` | yes | `S01…`, renumbered at export in `seq` order |
| `seq` | yes | 1-based |
| `kind` | yes | `action` (click), `context` (app/window switch), `manual` (added in review) |
| `t_start_ms`, `t_end_ms` | yes | ms from recording start, half-open interval |
| `summary` | yes | one imperative sentence from a template, e.g. `Click button "Save" in Excel`; or the user's edited text |
| `summary_provenance` | yes | `observed` (template) or `user` (edited) |
| `observed_via` | action/context | `pointer` or `window_change` |
| `action` | action | `{type: "click"\|"double_click"\|"right_click"\|"app_switch", point_dpx: {display_id, xy}, point_fpx: [x,y]}` |
| `target` | action/context | §4.2 |
| `before` | action/context | frame §4.3 |
| `after` | last step only | frame §4.3 |
| `why` | no | `{text, provenance: "user", source_annotation_ids: []}`, set when a comment is attached to the step |
| `annotation_ids` | yes | may be empty |
| `flags` | yes | subset of `user_edited`, `user_added`, `contains_redaction`, `low_confidence_target` |
| `boundary` | yes | `"not_assessed"` |
| `boundary_source` | yes | `"none"` |
| `scope_verified` | yes | `true` when the app is known, `false` otherwise |

### 4.2 `target`
| Field | Notes |
|---|---|
| `grounding` | `accessibility` (role + name + bounds found), `accessibility_weak` (element found but nameless or generic, or its bounds cover >60% of the window), `visual_only` (no element: helper missing, timed out or unsupported) |
| `grounding_source` | `ax` or `uia` when an element was found |
| `unavailable` | required unless `grounding` is `accessibility`: `{reason}` with reason ∈ `helper_missing`, `timeout`, `permission_missing`, `remote_session`, `opaque_toolkit`, `elevated_window`, `secure_field` |
| `app` | `{name, process?, bundle_id?, kind: "native"\|"browser"\|"remote_session"\|"unknown"}`. `kind` is `remote_session` for `mstsc`, `msrdc`, `Windows App`, `Microsoft Remote Desktop` and Citrix Workspace. |
| `window` | `{title: {text, redacted: false, classes: []}}` |
| `url` | browsers only, when known: `{text, redacted: false, classes: []}`, origin + path |
| `element` | when `accessibility*`: `{role, native_role, name: {text, redacted, classes}, automation_id?, ax_identifier?, is_password}`. `role` is normalised to: button, textbox, combobox, option, menuitem, link, tab, checkbox, radio, cell, row, listitem, treeitem, dialog, window, pane, document, text, image, other |
| `ancestry` | optional, up to 6 parents from the window down: `[{role, name}]` |
| `display_id`, `bounds_dpx`, `bounds_fpx` | element bounds, when known |
| `locators` | at least one; the last is always `{strategy: "frame_point", value: "x,y", rank, stability: "low"}`. Above it, when available: `uia_automation_id` / `ax_identifier` (rank 1), `role_name_path` (rank 2) |

### 4.3 Frame
`{frame_id: "frm_0001", t_ms, display_id, source_rect_dpx: [x,y,w,h], scale, full: {path, width, height, est_tokens}, full_annotated?, crop?: {path, width, height, est_tokens, crop_origin_fpx, crop_scale}, redacted_regions_fpx: [[x,y,w,h]…]}`

- **Before:** the newest captured frame at least 50 ms before the click. The app keeps a small in-memory ring of recent frames for this.
- **After:** a frame about 500 ms after the last step's action.
- **Full** images are resized so the long edge is at most 1,568 px and `ceil(w/28)×ceil(h/28) ≤ 1,568`. `est_tokens = ceil(w/28)×ceil(h/28)`. The transform is `fpx = (dpx − source_rect_dpx[0:2]) × scale`.
- **Crop:** 800×500 logical px (×`scale_factor` in dpx) centred on the target bounds, or else on the click point. It is shifted to stay inside the frame, cut from the redacted frame, and output at most 800×500.

### 4.4 `annotations.jsonl`
| Kind | Required fields |
|---|---|
| `highlight` | `annotation_id` (`ann_0001`), `kind`, `step_ids`, `t_ms`, `mark` (`H1`…), `shape` ∈ `rect`, `arrow`, `highlighter`, `freehand`, `frame_id`, `geometry_fpx` (rect/arrow exactly 2 points; others ≥2), optional `snapped_to: {role, name, bounds_fpx}` |
| `comment` | `annotation_id`, `kind`, `step_ids`, `t_ms`, `text: {text, redacted, classes}`, `source` ∈ `typed`, `review` |
| `narration` | `annotation_id`, `kind`, `step_ids`, `t_ms`, `t_end_ms`, `text: {text, redacted, classes}`, `anchor_confidence` (0–1) |

Highlight render (fixed): rect and arrow 3 px `#E5484D`, arrow with a 12 px filled head; highlighter 14 px `#FFD60A` at 40%; freehand 3 px `#E5484D`. The H-mark label goes in a 20 px white-on-`#E5484D` box outside the top-left corner. Highlights are drawn only into `*_full_annotated.png`.

A highlight or comment made during a freeze attaches to the step whose before frame was frozen (the last step before the freeze, or the first step after it when none came before). A narration segment attaches to the step whose `[t_start_ms − 3 s, t_end_ms + 1 s]` window it overlaps most; `anchor_confidence < 0.6` when it overlaps more than one step.

### 4.5 `gaps.jsonl`
`{gap_id: "gap_0001", t_start_ms, t_end_ms, reason, after_step?, before_step?}` with reason ∈ `user_paused`, `helper_restart`, `capture_lost`, `permission_lost`. Freeze time is not a gap; it is `explain_ms`.

### 4.6 Redaction in the tester build
The only redaction is the user's **blur** in review: a rectangle on a step's before frame. It is burned into the full, annotated and crop images of that step and listed in `redacted_regions_fpx`. The step then gets the flag `contains_redaction`. A comment or summary can be edited by hand. There are no automatic detectors in the tester build.

## 5. `PROCESS.md`
Rendered by deterministic code from the package data (no model), following `package-spec.md` §11.1, reduced to:
```
# <title>
> Goal: <goal> · Done when: <done_when>
> Trigger: <trigger.text> · Recorded <YYYY-MM-DD> (<timezone>) by <position> · <n> steps · <task time> task time · package <package_id>
> TEST BUILD — test data only.

## Steps

**S01. <summary>** (H1, H2) `[<summary_provenance>]` · evidence <T3|T2|T0>[ (<unavailable.reason>)]
- Where: <app.name> › <url, else window title> › <role> "<name>" (<grounding>)   | pixels only: <app.name> › point x,y in <before full path> (pixels only)
- Why: <why.text> `[user, ann_…]`
- Note (comment): "<text>" `[user, ann_…]`        one line per comment not used as why
- Narration: "<text>" `[narration, ann_…]`        one line per narration segment on the step
- Images: <before full>, <before full annotated>, <before crop>, <after full>

## What the recorder could not see
- <gap_id> (<after_step|start> → <before_step|end>): <reason phrase>, <duration>.
- <step_id>: no control identified (<unavailable.reason>); the target is pixels only.
```
Evidence tier: `T3` = `accessibility`, `T2` = `accessibility_weak`, `T0` = `visual_only`. Durations follow §11.1: under 60 s with one decimal and ` s`, otherwise `<m> min <s> s`. LF endings, one trailing newline, no trailing spaces.

## 6. `CLAUDE_HANDOFF.md`
`package-spec.md` §12, with these changes: the reading order is `manifest.json`, `PROCESS.md`, `steps.jsonl`, `annotations.jsonl`, `gaps.jsonl`, then images. There is no dataflow, prompts, readiness, a11y or schema folder. The **Produce** section asks for `process_spec.md`, written next to the package (not inside it), with:
- the steps, each citing step ids;
- decisions and what they depend on;
- inputs and outputs;
- systems used;
- open questions ranked by how much they block automation;
- steps unsafe to automate.

Keep the Rules section as written, including "do not invent steps inside gaps" and "label every statement [observed]/[user]/[inferred]".

## 7. Diagnostics file (not part of the package)
The app's Help menu and the end-of-export screen offer **"Save diagnostics…"**, which writes `handover-diagnostics-<timestamp>.zip` containing:
- the app log (rotating, last 5 MB);
- app version, OS, arch, displays and scale factors;
- permission states (macOS: Screen Recording, Accessibility, Microphone; Windows: n/a);
- helper status: found or not, version, last error, average and p95 control-lookup time, counts of `accessibility` / `accessibility_weak` / `visual_only` targets;
- capture backend and frame rate;
- the last 200 helper protocol lines with element names replaced by `<name>`.

It never contains screenshots, transcripts or comments. The tester sends this zip and one exported package back.

## 8. Validation
`packages/schema` (or the equivalent folder in the forked layout) ships `tester-package.schema.json` (JSON Schema draft 2020-12) for `manifest.json` and for one line of each `jsonl` file, plus a `validatePackage(dir)` function that also checks:
- every path listed in `files` exists and its sha256 matches;
- step ids run `S01…Sn` with no holes;
- every `annotation_ids` / `step_ids` reference resolves;
- `task_ms + explain_ms + paused_ms = duration_ms`;
- `image_count` equals the number of PNGs.

The unit tests include one golden package built from a synthetic session (no OS access) that validates, and `PROCESS.md` byte-equal to a committed golden file.
