# Handover package specification, v0.1

**Status:** draft contract for the build lanes, 2026-11-21. Lanes L1a (schema and CI) and L1a2 (format gate) own this file and the schema in `recorder/packages/schema/`; the format freezes when L1a2 merges.
**Design doc:** `docs/superpowers/specs/2026-11-21-workflow-recorder-design.md`.
**Starting point:** the WRP v0.1 draft in `docs/recorder/research/llm-output-format.md` §4–§6, with the changes the design review required (§0.3).

**About validation.** In the 2026-11-21 review pass, every fenced JSON block in this file was parsed, and every positive block of the §10 worked example (manifest, S01–S05, all annotations, gaps and prompts, dataflow, readiness, privacy, `a11y/S02.json`) was validated against the §8 schema with an already-installed Ajv 8.20 + ajv-formats, using exactly the options L1a must use: `new Ajv2020({ strict: true, strictRequired: false, allErrors: true })` plus `addFormats`. The §8, §9.1 and §15.1 schemas compile under those options. The schema-level negative tests N1–N13, N23–N26 and N28 were also run and each is rejected with exactly the `schemaPath` listed in §14; `counts_by_class`, `readiness_summary`, `evidence_summary`, V6 crop scales, V12 and the half-open gap rule were tallied against the example. **Not yet verified:** the rest of the semantic rules V1–V17 (including the V-tests N14–N22, N27, N29 and the PS test N30), the hashes (placeholders), and the §11.2 bytes against a generator. Lane L1a's **first acceptance check** repeats the positive validation, then runs §14.

**Review changes (2026-11-21).** This revision applies the builder, platform and product critiques: the vacuous `if` on `source: prompt` is fixed (every `if` now requires the property it keys on); strict-mode types added; `input_ack`, `capture.session`, `media.image_policy`, `process.done_when_steps`, `process.repeat`, `decision.branch_taken_provenance`, `exported_at{local,utc,timezone}`, `pre_write_verifier`, a closed redaction-class list, normalised `app_id`, `a11ySnapshot`, half-open intervals, per-shape geometry, logical-unit crops, rules R16–R17, V16–V17, N23–N30, and the reference-SOP schema and scorer (§15). L1a and the format gate L1a2 (where fresh Claude sessions read packages in this format and are scored) are the **last window for non-additive changes**: after L1a2 merges, 0.x changes are additive only (§7).

---

## 0. Conventions

### 0.1 Words
- **MUST**, **SHOULD** and **MAY** have their usual meanings.
- **Package**: the reviewed, redacted, exported folder. It is immutable once written.
- **Raw store**: the encrypted per-recording store on the user's machine. It never leaves the machine and is not part of this spec, except where the package refers to what the raw store held.
- **Derived**: anything a model produces from a package, such as Claude's process spec. It lives in a sibling folder (§2.2) and is never inside the package.

### 0.2 Names
| Thing | Name |
|---|---|
| Product | Handover |
| Package folder | `<slug>__<package_id>.handover/` |
| Package zip | `<slug>__<package_id>.handover.zip` (same contents, folder at the zip root) |
| Derived folder | `<slug>__<package_id>.derived/`, next to the package |
| `manifest.format` | `"handover-package"` |
| `manifest.schema_version` | `"0.1"` (pattern `^0\.1(\.[0-9]+)?$`) |
| Schema file in the package | `schema/handover-package-0.1.schema.json` |

### 0.3 What changed from the research draft (WRP v0.1)
| Change | Reason |
|---|---|
| Coordinates are **per-display physical pixels** (`_dpx`) plus a display map, instead of one physical virtual desktop (`_screen_px`) | macOS has no single physical virtual desktop when displays use different scale factors. Per-display physical pixels are unambiguous on both OSes. |
| Field suffixes always name the space: `_dpx`, `_fpx`, `_cpx` | A reader can never mix up spaces. |
| `grounding` enum is `accessibility`, `accessibility_weak`, `ocr`, `user_described`, `visual_only`, `none`; `dom` is dropped | Nothing in the MVP reads a DOM. Chromium's tree arrives through AX/UIA as `accessibility`. A browser extension could add `dom` additively later. |
| Any grounding other than `accessibility` requires `target.unavailable.reason` | "Every click records a target descriptor or an explicit reason why not." |
| New computed field `step.evidence_tier` (`T3`…`T0`) | One field to weigh trust. |
| New `step.observed_via` | Steps found without a keyboard hook (focus, value commit, screen change, clipboard counter). |
| New `action.key_inference` | Shortcuts are inferred, never observed, because there is no keyboard hook. |
| New step kind `manual`; new `step.tags`, `step.boundary`, `step.data`, `step.explain_ms`, `step.scope_verified` | Tags, Superbrain boundaries, data lineage and honest timing. |
| New files `gaps.jsonl`, `prompts.jsonl`, `dataflow.json`, `readiness.json`, `privacy.json`, `README.txt`, `steps-guide.html` | Everything the recorder could not see, the questions it asked, lineage, the readiness rules, the privacy manifest required by PRV-EXP-07, and a human guide. |
| `redaction_report.json` is replaced by `privacy.json` | PRV-EXP-07 names `privacy.json`. |
| `events.jsonl` is dropped | Less to review and redact. Steps cite annotations, prompts and frames, never raw events. |
| `manifest.systems[]`, `manifest.actors[]`, `manifest.capture`, `manifest.revision`, `manifest.tenant_profile` | Superbrain needs System keys and positions; Claude needs to know what was in scope and how the package was captured. |

---

## 1. Principles

1. **The reader is Claude.** Text first, images on demand. Each step is one JSON line with a stable id. A reader never rebuilds meaning from raw events.
2. **Three layers, physically separate.** Raw store (never leaves the machine), package (reviewed, redacted, immutable, hashed), derived (sibling folder that cites the package hash).
3. **Every statement has a provenance.** `observed` (captured by the recorder), `user` (typed, said or chosen by the recording user), `inferred` (produced by local code and not confirmed by the user). Inside a package, `inferred` only ever comes from **local deterministic code**. No cloud model writes into a package.
4. **Fail closed.** Secure fields and fields that cannot be identified are never captured. Typed values are redacted by default.
5. **Nothing silently empty.** A field Claude depends on is filled, explicitly skipped by the user (recorded in `readiness.json`), or listed as an open question. A missing control is `unavailable{reason}`, never an empty object.
6. **Unavailable is not empty.** "The recorder could not see it" (`unavailable`, a gap) is always distinct from "there was nothing there".
7. **Positions, not people.** Actors are positions ("Admin assistant"). The author is a recording-local pseudonym.
8. **Deterministic.** The same raw session, edit log, policy, tenant profile, image profile and **export context** always produce the same bytes for every JSON, Markdown and HTML file (sorted keys, stable ids). The export context `{package_id, exported_at, timezone, reviewer_pseudonym, tool_version}` is generated once by ExportService and injected; tests pass fixed values (design §8.5). Images are checked by dimensions and perceptual hash.

---

## 2. Folder layout

### 2.1 The package

```
lockdown-register-afs__pkg_01JDX7Q9ZK3V8M2N4P6R8T0W2Y.handover/
├── README.txt               confidentiality banner + approved processing route (PRV-EXP-07)
├── manifest.json            identity, process, systems, actors, capture scope + capabilities, displays, media budget, file hashes
├── CLAUDE_HANDOFF.md        the prompt: role, reading order, rules, output contract (§12)
├── PROCESS.md               deterministic SOP rendered by code, cites S-ids and H-marks (§11)
├── steps-guide.html         illustrated human Steps guide rendered from the same data (§13)
├── steps.jsonl              one curated step per line (#/$defs/step)
├── annotations.jsonl        highlights, comments, narration segments (#/$defs/annotation)
├── gaps.jsonl               every interval or event the recorder could not see (#/$defs/gap)
├── prompts.jsonl            every moment-of-action question and its outcome (#/$defs/prompt)
├── dataflow.json            parameters, entities and outputs across steps and apps (#/$defs/dataflow)
├── readiness.json           readiness rule results R1–R17 (#/$defs/readiness)
├── privacy.json             attestation, policy, detectors, redactions (classes + locations, never values) (#/$defs/privacy)
├── media/
│   ├── S01_before_full.png              resized to the image profile; step coordinates map 1:1
│   ├── S01_before_crop.png              800×500 logical px around the target, cut from the REDACTED frame (§3.3)
│   ├── S02_before_full_annotated.png    only when the step has highlights (H1, H2 drawn)
│   └── S05_after_full.png               only where the result matters (last step, closed dialog, save)
├── a11y/
│   └── S01.json             pruned control subtree: target path plus withheld siblings (#/$defs/a11ySnapshot, §5.10)
├── anchors/
│   └── S01_target.png       OPTIONAL clean element snip for image-anchor locators (automation, not for Claude)
└── schema/
    ├── handover-package-0.1.schema.json
    └── process-spec-0.1.schema.json     the output contract CLAUDE_HANDOFF.md asks for
```

Rules:
- File names in `media/`, `a11y/` and `anchors/` start with the step id, so `ls` reads in process order.
- **No video and no audio.** `media.video_included` and `media.audio_included` are `false` in v0.1. The Claude API takes text, images and PDFs, not audio; the package carries the reviewed transcript as narration annotations.
- Images are PNG. Metadata (EXIF, XMP, text chunks) is stripped. Redactions are burned into pixels.
- Never draw step badges or margins on images.
- `anchors/` images do not count toward `media.image_count` and are not in the Claude reading order.

### 2.2 The derived sibling

```
lockdown-register-afs__pkg_01JDX7Q9ZK3V8M2N4P6R8T0W2Y.derived/
├── process_spec.json        Claude's output, validated against schema/process-spec-0.1.schema.json
├── narrative.md             plain-language narrative for a non-technical reader (written by Claude)
├── derivation.json          written by the harness, not by Claude (§9.2)
└── skill/SKILL.md           OPTIONAL Claude Code skill export (Phase 2)
```

**How a Claude session is set up (agent mode).** The session starts in a parent folder that holds `<pkg>.handover/` and an empty `<pkg>.derived/`, with the prompt `Follow <pkg>.handover/CLAUDE_HANDOFF.md`. Claude writes only into `<pkg>.derived/`, so nothing is ever added inside the hashed package (V3) and no extra permission is needed. For the acceptance-4 harness the parent folder is a fresh temp directory outside any git repository, so no repo or parent `CLAUDE.md` is loaded; user-level `CLAUDE.md` is disabled and that fact is recorded in `derivation.json`.

The **package hash** is the sha256 of the exact bytes of `manifest.json`. Because the manifest lists the sha256 of every other file, this one hash identifies the whole package. Derived files cite it as `package_ref.manifest_sha256`.

---

## 3. Identifiers, time, coordinates and DPI

### 3.1 Identifiers
| Id | Pattern | Example |
|---|---|---|
| package | `^pkg_[0-9A-HJKMNP-TV-Z]{26}$` (ULID) | `pkg_01JDX7Q9ZK3V8M2N4P6R8T0W2Y` |
| step | `^S[0-9]{2,4}$` | `S04` |
| annotation | `^ann_[0-9]{4,6}$` | `ann_0003` |
| frame | `^frm_[0-9]{4,6}$` | `frm_0401` |
| gap | `^gap_[0-9]{4,6}$` | `gap_0001` |
| prompt | `^prm_[0-9]{4,6}$` | `prm_0002` |
| redaction | `^red_[0-9]{4,6}$` | `red_0007` |
| chapter | `^C[0-9]{1,3}$` | `C1` |
| display | `^d[0-9]{1,2}$` | `d0` |
| system | `^sys_[a-z0-9_]{2,40}$` | `sys_appsheet` |
| parameter, entity | `^[a-z][a-z0-9_]{1,47}$` | `afs_signed_date` |
| readiness rule | `^R[0-9]{1,2}$` | `R7` |

Step ids are renumbered at export so they run `S01…Sn` in `seq` order. Other ids are stable from the raw store but may have gaps (deleted items).

### 3.2 Time
- `*_ms` fields are integer milliseconds from recording start on the helper's monotonic clock. Audio is aligned to it with a sync ping at Start and at every resume.
- Wall-clock times are ISO 8601 with offset (`2026-11-20T09:05:11+02:00`). `manifest.recording.timezone` is an IANA name (`Africa/Johannesburg`).
- `task_ms + explain_ms + paused_ms = duration_ms` (validator rule V12). Time spent in Explain and paused is not task time.
- **Every `[t_start_ms, t_end_ms]` interval is half-open: `[start, end)`.** Two gaps may touch (one ends at 38000, the next starts at 38000) but may not intersect. A step lies "inside" a gap when its interval intersects the gap's interval.
- **`t_ms` of annotations and prompts.** A live annotation or prompt carries the time it was made or shown. One created or answered in review carries the `t_start_ms` of its first anchor step (never the time of the edit), so the time line stays recording time.

### 3.3 Coordinate spaces

| Suffix | Space | Origin and unit |
|---|---|---|
| `_dpx` | **Display physical pixels** of one display, named by `display_id` | Top-left of that display, physical pixels. A position is always the pair (`display_id`, `[x, y]_dpx`). |
| `_fpx` | **Frame pixels** of the exported `*_full.png` image of one frame | Top-left of the image, pixels of the exported image. |
| `_cpx` | **Crop pixels** of an exported `*_crop.png` image | Top-left of the crop image. |
| `origin_global` | Where a display sits in the OS's global desktop, in the unit named by `global_space` | Only used to lay displays out relative to each other. Never used for a target position. |

`global_space` is one of:
- `macos_global_points`: CoreGraphics global display coordinates, origin at the top-left of the primary display, y down, in points. Convert a point on display *d* to `_dpx` with `(p - origin_global) * scale_factor`.
- `windows_virtual_px`: the Windows virtual screen in physical pixels, as a per-monitor-DPI-aware (V2) process sees it. `_dpx = p - origin_global`.

Displays left of or above the primary have negative `origin_global` components. That is normal and is in the worked example (`d1`).

**Transforms.** Every frame stores its own transform:
- Frame: `fpx = (dpx − source_rect_dpx[0:2]) × scale`, so `dpx = fpx / scale + source_rect_dpx[0:2]`.
- Crop: `fpx = crop_origin_fpx + cpx / crop_scale`. A crop is cut from the redacted frame and covers **800×500 logical pixels**, that is `800·s × 500·s` dpx where `s` is the display's `scale_factor`, clamped to the source rect, and is downsampled to at most 800×500 output pixels. So `crop_scale = 1 / (scale × s)` (rounded to 4 decimals); on a 1x display that is `1 / scale` as before. A HiDPI crop therefore shows the same amount of UI (labels around the target) as a 1x crop, at the same token cost.
- Crop anchor: the target's `bounds_dpx` centre; else the action point; else the frame centre (§5.2.5). The crop is shifted, not shrunk, to stay inside the source rect.
- `scale` is chosen so the full image fits the image profile (§3.4) and is recorded to 6 decimals.

**DPI handling.**
- macOS: the helper converts AX positions (global points) into `_dpx` with the display's backing scale factor. ScreenCaptureKit frames are captured at physical resolution.
- Windows: the helper is per-monitor DPI aware (V2). UIA bounding rectangles and the low-level mouse hook already report virtual-screen physical pixels; the helper subtracts the display's `origin_global`.
- A target or annotation that spans two displays is clipped to the display that holds the click point (or the annotation's first point).

### 3.4 Image profile
| Profile | Full frame | Crop | Tokens |
|---|---|---|---|
| `standard` (default) | long edge ≤ 1,568 px **and** `ceil(w/28) × ceil(h/28)` ≤ 1,568 | 800×500 logical px, output ≤ 800×500 | full ≈ 1,560, crop 522 |
| `high` (diagnostic only) | long edge ≤ 2,576 px and tokens ≤ 4,784 | same | full ≈ 4,700 |

`est_tokens = ceil(width/28) × ceil(height/28)`. A 16:9 display exports at 1456×819 (1,560 tokens) in `standard`. The packer sets `oversized_image: "error"` on every image block, so a mismatch fails loudly.

**Image policy** (`manifest.media.image_policy`) decides which images leave the machine:
| Policy | Exported images |
|---|---|
| `full_and_crop` | before full (annotated variant where highlights exist), before crop, after full where §5.2.4 says so |
| `crop_only` | before crop only; no full frames. `before.full` is omitted, but `scale` and `source_rect_dpx` still define the `_fpx` space, so every coordinate keeps its meaning; highlights are listed by geometry and not drawn |
| `text_only` | no images; `before`/`after` are omitted |

The default is decided by evidence, not taste: the format gate (plan L1a2) and acceptance 4 score all three policies, and the default becomes the lowest-exposure policy whose step F1 is within 0.02 of `full_and_crop`. Until that evidence exists the default is `full_and_crop`. A tenant profile may cap the policy (`image_policy_max`, §9.3).

---

## 4. Redaction semantics

### 4.1 Text
Any text that might hold personal or client data is a **redactable text** object: `{text, redacted, classes[]}`.
- When `redacted` is `true`, `text` holds the surrounding non-sensitive text with each sensitive span replaced by its class token (for example `[ORG_NAME] AFS 2026 – QuicklySign`), and `classes` lists the classes removed. The real value never leaves the machine.
- **Class tokens (closed list, `#/$defs/redactionClass`):**

| Class | Token | Typical source |
|---|---|---|
| `org_name` | `[ORG_NAME]` | names-to-hide list, tenant dictionary, user Redact |
| `person_name` | `[PERSON_NAME]` | names-to-hide list, medium detector (resolved in review) |
| `identifier` | `[ID]` | URL id segments, record numbers |
| `hostname` | `[HOST]` | remote-client titles |
| `sa_id_number` | `[SA_ID]` | high-precision detector |
| `tax_number` | `[TAX_NO]` | high-precision detector |
| `vat_number` | `[VAT_NO]` | high-precision detector |
| `card_number` | `[CARD]` | high-precision detector |
| `email` | `[EMAIL]` | high-precision detector |
| `phone` | `[PHONE]` | high-precision detector |
| `bank_account` | `[BANK_ACCOUNT]` | medium detector |
| `company_reg` | `[COMPANY_REG]` | medium detector |
| `address` | `[ADDRESS]` | user Redact |
| `amount` | `[AMOUNT]` | medium detector, user Redact |
| `special_pi` | `[SPECIAL]` | special-PI keywords (blocks export, R7) |
| `user_marked` | `[REDACTED]` | Sensitive tag, user Redact on free text, `window_title_mode: whole` |
| `sibling_text` | `[ROW_TEXT]` | withheld sibling names in a11y snapshots (§5.10) |
| `typed_field` | (pixels only) | PRV-KEY-03 typed-field blur, remote input blur |

- **Names to hide.** The start sheet asks "Client or person names that may appear" (optional, any number); a tenant dictionary (`names_to_hide_file`, PRV-PII-04) may add more. Both lists stay in the encrypted raw store and never leave the machine. The matcher is case- and diacritic-insensitive, whole-word, and runs over every text channel (OCR of frames, titles, URLs, control and a11y names, locators, transcript, comments, prompt answers) and over pixels through OCR boxes. The pre-write verifier (design §12.4) re-checks every exported string and OCR'd image against the lists. Detector id `names_to_hide`, precision `high`.
- **Window titles** pass through the detectors and the names-to-hide matcher; matching spans are replaced (`window_title_mode: spans`, the default, rule `window_title_default` for detector hits and `names_to_hide` for list hits). A title with no match is exported as is with `redacted: false`. A tenant may tighten to `whole`: the title becomes `[REDACTED]`. The app name is always kept separately in `target.app.name`.
- URLs are reduced to origin plus path. Query and fragment are always stripped. Path segments that match an id pattern become `[ID]` (PRV-EXP-06).
- Narration and comments carry `redacted: true` when any span was replaced.
- **Plain strings that can hold screen text.** These fields are plain strings for readability, but every one passes through the same redaction serialiser before it is written, and every replacement writes a `privacy.json` record with channel `control_name` (control and ancestor names, locators, snapped names), `structured_text` (everything else) and a JSON pointer: `target.ancestry[].name`, `target.element.label`, `target.locators[].value`, `annotations.snapped_to.name`, `step.summary`, `step.phase`, `step.decision.question`, `step.decision.branch_taken`, `step.decision.branches[].condition` and `.then`, `step.post_wait.until`, `step.expected_result.text`, `step.why.text`, `dataflow` `label`/`where`/`join_hint.text`/`appears_in[].where`, `prompts.question`/`chips[]`/`answer.text`, `gaps.user_note.text`, `annotation.follow_up.question`/`answer`, and `manifest.process` free text (title, goal, done_when, trigger.text, wrapup). L1d's privacy fixture plants a names-list hit in each of these.

### 4.2 Values (`action.value`)
`disposition` is one of:
| Disposition | Meaning | Fields |
|---|---|---|
| `literal` | The value may leave the machine: a control label (menu item, option, tab) or a field the user opted in before recording (PRV-KEY-04b) or un-blurred in review with a note (PRV-KEY-04a). Detector hits are never literal. | `literal` required |
| `redacted` | The value exists but was removed. `placeholder` names it (`{{afs_signed_date}}`). | `placeholder` required, `literal` forbidden |
| `never_captured` | Secure field or unknown input target. Nothing was read or kept. | `literal` and `placeholder` forbidden |

By default the helper **does not read field values** (PRV-KEY-01). A `redacted` value therefore carries what the recorder can know without the value: the field, `value_type` when the field type tells it (`date` for a date input) or the user said it, `shape` only when the user or the field type supplies it, and lineage only when the user confirmed it. `length_bucket` is `"unknown"` in v0.1 unless a later opt-in provides it (there is no keyboard hook to count keystrokes).

`shape` is a format description (`YYYY-MM-DD`, `D MMM YYYY`, `13 digits`), never an example value. It comes from the "This varies" follow-up ("What does it look like?"), whose answer is detector-checked and reduced to a format before it is stored, or from the review item that rule R17 raises ("Show Claude the format?", with one-click un-blur of that field under PRV-KEY-04a).

### 4.3 Pixels
- `redacted_regions_fpx`: rectangles burned into the image because of a detector, a names-to-hide hit, a Sensitive tag, a typed field (PRV-KEY-03), suspected remote input (design §9.6), the browser address bar (`address_bar_default`, applied to **every** browser frame, because the pixels can show a query string the reduced `target.url` drops) or a user Redact. A blur is deliberate redaction, not missing UI.
- `masked_regions_fpx`: rectangles the recorder never captured (out-of-scope app, blocklisted app or URL, private browser window, a browser window whose URL could not be confirmed, a shell surface such as a toast or Start, capture-exclusion fallback). Each has a reason in `privacy.json`. On macOS, ScreenCaptureKit leaves excluded windows undrawn and the helper MAY omit this list; on Windows the helper always reports it.
- Crops are cut from the already redacted frame.

### 4.4 What never appears in a package
Raw keystrokes or typed characters; clipboard contents; audio; video; unredacted originals or thumbnails; undo history; the encrypted store; detector match values; machine name or OS username (a recording-local pseudonym is used); anything from an excluded app or a private browser window.

---

## 5. Records

Field tables list the main fields. The §8 schema is normative where they differ.

### 5.1 `manifest.json` (#/$defs/manifest)

| Field | Type | Req | Notes |
|---|---|---|---|
| `format` | const `"handover-package"` | yes | |
| `schema_version` | string | yes | `0.1` or `0.1.n` |
| `package_id` | packageId | yes | |
| `revision` | object | yes | `{rev ≥ 1, supersedes_package_id?, reason?}`. A Phase 2 teach-back round produces `rev: 2` with `supersedes_package_id`. |
| `created_at` | isoTime | yes | export time |
| `recorder` | object | yes | `{name, version, os: macos\|windows, os_version, arch: arm64\|x64, locale}` |
| `author` | object | yes | `{pseudonym, position}`. Never a name. |
| `actors` | array | yes | `[{position, role_in_process?}]`. Positions only. |
| `tenant_profile` | object | no | `{tenant_id, version, sha256}` of the tenant profile that set system-of-record flags and boundary rules (§9.3) |
| `process` | object | yes | `{title, process_key, goal, done_when, done_when_steps?, repeat?, trigger{kind, text}, frequency?, volume?, wrapup{next?, failure_modes?, run_kind, run_note?}}`. `done_when` is required (the start sheet asks "When it's done, what's true that wasn't before?"). `done_when_steps` are the steps the user picked at wrap-up for "Which step makes this true?" (R16). `repeat` is the wrap-up chip "Once / for each client / for each row / for each document" (`unit`, optional `step_ids` and `termination`, provenance `user`); loops are never inferred. `trigger.kind` ∈ `event`, `schedule`, `request`, `manual`, `unknown`. `run_kind` ∈ `normal`, `unusual`, `unknown`. |
| `systems` | array | yes | One per system touched: `{system_id, display_name, app_ids[], access_mode, url_origins[], evidence_summary{T3,T2,T1,T0}, system_key_hint?, is_system_of_record, sor_source}`. `app_ids` use the normalised **app id** (below). `access_mode` ∈ `native`, `browser`, `remote`, `unknown`. `sor_source` ∈ `tenant_profile`, `user`, `unknown`. |
| `recording` | object | yes | `{started_at, ended_at, timezone, duration_ms, task_ms, explain_ms, paused_ms, step_count, chapters[], edited}` |
| `capture` | object | yes | `{session, scope, capabilities, self_test}` (below) |
| `displays` | array ≥1 | yes | `[{display_id, global_space, origin_global, size_dpx, scale_factor, primary}]` |
| `media` | object | yes | `{image_profile, image_policy, max_long_edge, max_tokens_per_image, image_count, est_image_tokens_total, format: "png", video_included: false, audio_included: false}` |
| `privacy` | object | yes | `{reviewed_by_user: true, reviewed_at, privacy_file: "privacy.json", contains_personal_information: none_known\|redacted\|present_with_authorisation}` |
| `readiness_summary` | object | yes | counts `{pass, warn, skipped_by_user, info, not_applicable}` copied from `readiness.json` |
| `files` | array | yes | `[{path, sha256, bytes, role}]` for every file except `manifest.json` itself |

**App id.** One identifier for an app everywhere (`systems[].app_ids`, `capture.scope.apps[].app_id`, tenant profile matches): the lower-case executable name without `.exe` on Windows (`chrome`, `mstsc`), the lower-case bundle id on macOS (`com.google.chrome`). `bundle_or_exe` keeps the raw name for humans.

`capture.session`: where the recorder itself ran: `console` (a local session), `rdp` or `ica` (inside a Remote Desktop or Citrix/VDI session, design §9.6 topology B), `unknown`.

`capture.scope`: `{mode: apps|display, apps[{app_id, name, bundle_or_exe}], display_ids[], blocklist_policy_sha256}`. In `apps` mode only the listed apps' windows (and their owned popups, plus any allowlisted system view-service windows such as the macOS open/save panel while an in-scope app is frontmost, design §9.3) were captured.

`capture.capabilities` is a **projection** of the helper's `capabilities` handshake message (design §8.2), so Claude knows how the package was captured. The handshake's `perm` object (permission states) is dropped; every other key is copied:
`{input_mouse: bool, a11y_hit: bool, a11y_snapshot: bool, capture_self_exclude: bool, capture_backend: sck|wgc|dxgi|desktop_capturer, scope_masking: os_filter|helper_mask|helper_composite|core_mask|none, ocr: vision|windows_ocr|tesseract|none, keyboard: "none"}`. `helper_composite` is per-window capture composited onto a blank canvas (design §9.3); `core_mask` is the desktopCapturer fallback, where the helper supplies window snapshots and the core applies the mask.

`capture.self_test`: `{passed: bool, fallback: none|mask_recorder_windows}`. When the marker self-test at Start fails, the core masks the HUD, edge strips and overlay rectangles in every frame and records `mask_recorder_windows`.

### 5.2 `steps.jsonl` (#/$defs/step)

One step is one user intent carried out by one primary action. The step builder aggregates raw events (design §9.1).

| Field | Type | Req | Notes |
|---|---|---|---|
| `step_id`, `seq` | | yes | |
| `kind` | enum | yes | `action`, `decision`, `wait`, `checkpoint`, `context`, `manual` |
| `chapter_id` | chapterId | no | |
| `t_start_ms`, `t_end_ms` | ms | yes | |
| `explain_ms` | ms | no | Explain time attached to this step, excluded from task time |
| `phase` | string | no | grouping label |
| `summary` | string | yes | one imperative sentence, rule-generated by template unless the user edited it |
| `summary_provenance` | provenance | yes | `observed` for template output from captured facts; `user` when edited |
| `observed_via` | enum | action, decision | `pointer`, `focus`, `value_commit`, `screen_change`, `clipboard_change`, `window_change`, `user` |
| `evidence_tier` | enum | action, decision | computed (§5.2.1), never typed in |
| `why` | statement | no | `{text, provenance, source_annotation_ids[], prompt_ids[]}` |
| `action` | object | action, decision, manual | §5.2.2 |
| `target` | object | action, decision | §5.2.3 |
| `before`, `after` | frame | no | §5.2.4 |
| `data` | object | no | `{reads: [paramId], writes: [paramId]}` joins the step to `dataflow.json` |
| `tags` | array | no | `decision`, `varies`, `sensitive`, `rule`, `exception`, `judgement`, `do_not_automate`, `verify`, `handoff`, `not_sure_why` |
| `boundary` | enum | yes | `ok`, `engagement_file_content`, `system_of_record_write`, `unknown`, `not_assessed` |
| `boundary_source` | enum | yes | `tenant_rule`, `user`, `none` |
| `expected_result` | statement | no | |
| `post_wait` | object | no | `{duration_ms, kind: system\|human\|unknown, until?}` |
| `decision` | object | decision | `{question, branch_taken, branch_taken_provenance, branches[{condition, then?, observed, provenance}]}`. A condition is never inferred: an unknown condition is the literal string `"unknown"` and becomes an open question. `branch_taken` is `observed` when the recording continued down that branch, `user` when the user said which branch it was. |
| `scope_verified` | bool | yes | `false` when the app or URL could not be identified (remote session, PRV-SCOPE-06) |
| `scope_acknowledged` | bool | no | required `true` at export when `scope_verified` is `false` (rule R15) |
| `input_ack` | bool | no | required `true` at export when `flags` contains `input_target_unknown` (rule R15) |
| `annotation_ids`, `prompt_ids` | arrays | no | |
| `flags` | array | no | `user_edited`, `user_added`, `merged`, `low_confidence_target`, `remote_session`, `contains_redaction`, `input_target_unknown`, `inferred_key`, `error_recovery`, `elevated_window` |

#### 5.2.1 Evidence tier
| Tier | When |
|---|---|
| `T3` | `grounding: accessibility` with a non-empty role, a non-empty (possibly redacted) name, and bounds |
| `T2` | `grounding: accessibility_weak`: an element was found but it is opaque, nameless, generic, or its bounds cover more than 60% of its window |
| `T1` | `grounding: ocr`: no element, but on-device OCR found a label near the point and the user did not contradict it |
| `T0` | `user_described`, `visual_only` or `none` |

#### 5.2.2 Action
`type` ∈ `click`, `double_click`, `right_click`, `type`, `key`, `select`, `drag`, `scroll`, `app_switch`, `open_app`, `navigate`, `file_dialog`, `copy`, `paste`, `inspect`, `wait`, `manual`, `other`.

| Field | Notes |
|---|---|
| `point_dpx` | `{display_id, xy}` where the pointer acted |
| `point_fpx`, `end_point_fpx` | the same point in the `before.full` image |
| `value` | §4.2 value record: `{disposition, literal?, placeholder?, value_type, shape?, length_bucket, source, copied_from_step?, copied_from_provenance?, parameter?}`. `source` ∈ `typed`, `pasted`, `selected`, `autofilled`, `unknown`. `length_bucket` ∈ `1-5`, `6-20`, `21+`, `unknown`. |
| `key_inference` | `{keys, observed: false, inferred_from[]}`. `inferred_from` ⊆ `title_change`, `focus_change`, `screen_change`, `clipboard_change`, `value_commit`. Example: Excel's title going from `Book1*` to `Book1` infers `ctrl+s`. |
| `cell` | `{address, column_header?}` for grid cells (PRV-KEY-05). Content is a value and is redacted by default. |
| `scroll` | `{direction, amount}` |

#### 5.2.3 Target
| Field | Notes |
|---|---|
| `grounding` | `accessibility`, `accessibility_weak`, `ocr`, `user_described`, `visual_only`, `none` |
| `grounding_source` | `ax`, `uia`, `vision_ocr`, `windows_ocr`, `tesseract`, `user` |
| `unavailable` | `{reason, client?}`, required unless `grounding` is `accessibility`. `reason` ∈ `remote_session`, `elevated_window`, `secure_desktop`, `opaque_toolkit`, `timeout`, `permission_missing`, `helper_restarting`, `out_of_scope_app`, `excluded_app`, `secure_field`. `client` names the remote client (`mstsc`, `msrdc`, `citrix_workspace`, `windows_app`, `parallels`). |
| `app` | `{name, process?, bundle_id?, version?, kind: native\|browser\|remote_session\|unknown, system_id}` |
| `window` | `{title: redactableText, class_name?, is_dialog?, integrity?: normal\|elevated}` |
| `url` | redactableText, browsers only |
| `element` | required for `accessibility*`: `{role, native_role?, name: redactableText, label?, automation_id?, ax_identifier?, class_name?, framework_id?, is_password, position_in_set?, size_of_set?}`. Normalised `role` ∈ button, textbox, combobox, option, menuitem, link, tab, checkbox, radio, cell, row, listitem, treeitem, dialog, window, pane, document, text, image, other. |
| `ancestry` | window-to-parent path `[{role, name, automation_id?}]`, nearest parent last |
| `locators` | ranked bundle (below) |
| `display_id`, `bounds_dpx`, `bounds_fpx` | element bounds |
| `ocr_near` | required for `ocr`: `{text: redactableText, confidence, bounds_fpx}` |
| `user_description` | required for `user_described`: `{text, provenance: "user", prompt_id?}` |
| `a11y_snapshot` | path to `a11y/<step>.json` |

**Locators** `{strategy, value, rank, stability, note?}`, ranked:
1. `uia_automation_id` or `ax_identifier`, only when non-empty and unique among siblings in the snapshot (Microsoft documents that AutomationId is not stable across builds);
2. `role_name_path` (`document >> form[name='Register'] >> textbox[name='AFS signed date']`);
3. `label_relative` ("the box right of label 'Completed'");
4. `ocr_text`;
5. `image_anchor` (path into `anchors/`);
6. `frame_point` (`"x,y"` in `_fpx` of the step's before frame).

`stability` ∈ `high`, `medium`, `low`, `unknown`.

#### 5.2.4 Frame
`{frame_id, t_ms, display_id, source_rect_dpx, scale, full?, full_annotated?, crop?, redacted_regions_fpx[], masked_regions_fpx[]}`. Each image is `{path, width, height, est_tokens, variant, crop_origin_fpx?, crop_scale?}`. Which images are present follows `media.image_policy` (§3.4, V4).

- **Before:** the newest frame taken at least 50 ms before pointer-down, so a menu or list that closes on click is still there. The helper captures on content change around pointer activity (design §8.3), so a list opened 150 ms before the click is in the ring (spike C2 timing bar). For focus, value-commit and screen-change steps, the frame just before the change.
- **After:** a frame taken once the screen settles, or 500 ms after the action. Exported only for the last step, a closed dialog, a save, or a step tagged `verify`.

#### 5.2.5 Steps found without a pointer event

| `observed_via` | Target source | Allowed grounding | `unavailable.reason` when no element | Locator fallback | Crop anchor |
|---|---|---|---|---|---|
| `pointer` | element under the pointer-down | any | per §5.2.3 | `frame_point` = the click point | target bounds centre, else click point |
| `focus` | the element that received focus | `accessibility*`, else `none` | `no_pointer_target` | `frame_point` = target bounds centre, else frame centre | target bounds centre, else frame centre |
| `value_commit` | the element that lost focus after an edit (field identity from the focus/value notification) | `accessibility*`, else `none` | `no_pointer_target` (remote: `remote_session`) | as `focus` | as `focus` |
| `clipboard_change` | the element of the last pointer selection gesture (drag or double-click) in the same app within 10 s of the change; else the focused element; else none | `accessibility*`, `ocr`, else `none` | `no_pointer_target` | `frame_point` = selection end point, else bounds centre, else frame centre | target bounds centre (S02), else frame centre |
| `screen_change` | the focused element at the change, if any; in a remote or opaque window, the remote window itself | `accessibility*`, `visual_only`, else `none` | `no_pointer_target`, or `remote_session`/`opaque_toolkit` | `frame_point` = centre of the changed region's bounding box | changed-region centre |
| `window_change` | the newly active window | `accessibility*`, else `none` | `no_pointer_target` | `frame_point` = window centre | window centre |
| `user` | none (manual step) | — | — | — | — |

A copy step merges the selection gesture and the clipboard change into one step: `observed_via: clipboard_change`, the gesture's element as target, and `action.key_inference{keys: "ctrl+c" (Windows) or "cmd+c" (macOS), inferred_from: ["clipboard_change"]}`. Every action or decision step keeps ≥ 1 locator, so `frame_point` is always present as the last fallback. L1b has a golden transcript for each row.

### 5.3 `annotations.jsonl` (#/$defs/annotation)

| Kind | Created by | Anchor | Required fields |
|---|---|---|---|
| `highlight` | Explain tools: Snap, Box, Arrow, Highlighter, Pen, 1-2-3 callout | `explicit` | `mark` (H1…), `shape`, `frame_id`, `geometry_fpx` (≥2 points) |
| `comment` | Comment card, a prompt answer, the wrap-up, or review | `explicit` | `text`, `anchor`, `source` |
| `narration` | On-device transcript segment, redacted | `time_aligned` (or `explicit` after a drag in review) | `text`, `anchor`, `t_end_ms`, `anchor_confidence` |

Other fields: `step_ids`, `tags` (step tag enum), `follow_up{question, answer}` (the one follow-up question a tag asks), `snapped_to{role, name, automation_id?, bounds_fpx, grounding}`, `callout_number`, `source` ∈ `typed`, `voice`, `prompt`, `review`, `prompt_id`, `linked_annotation_ids`, `redacted`.

`shape` ∈ `rect`, `ellipse`, `arrow`, `highlighter`, `freehand`, `callout`. Highlights are vectors over the clean frame; they are drawn only into `*_full_annotated.png`.

| Shape | `geometry_fpx` | Render (fixed, so the annotated image is deterministic) |
|---|---|---|
| `rect`, `ellipse` | exactly 2 points: top-left and bottom-right of the bounding box | 3 px stroke, colour `#E5484D`, no fill |
| `arrow` | exactly 2 points: tail, then head | 3 px stroke `#E5484D`, 12 px filled head at the second point |
| `highlighter` | ≥ 2 points, a polyline | 14 px stroke `#FFD60A` at 40% opacity, round caps |
| `freehand` | ≥ 2 points, a polyline | 3 px stroke `#E5484D`, round joins |
| `callout` | exactly 2 points: the anchor point, then the label position | filled 22 px circle `#E5484D` at the label position with `callout_number` in white, 2 px leader line to the anchor |

The H-mark label (`H1`) is drawn in a 20 px high white-on-`#E5484D` box placed outside the top-left corner of the shape's bounding box (8 px left of and above it), clamped to stay inside the image. The schema enforces the 2-point maximum for `rect`, `ellipse`, `arrow` and `callout`.

**Narration alignment:** a segment is assigned to the step whose window `[t_start_ms − 3 s, t_end_ms + 1 s]` it overlaps most. When it overlaps more than one step, `anchor_confidence` < 0.6.

### 5.4 `gaps.jsonl` (#/$defs/gap)

Every interval or event the recorder did not observe. Claude MUST NOT invent steps inside a gap.

| Field | Notes |
|---|---|
| `gap_id`, `t_start_ms`, `t_end_ms` | |
| `reason` | `user_paused`, `idle_paused`, `lock_paused`, `sleep_paused`, `user_switch_paused`, `screensaver_paused`, `out_of_scope_app`, `excluded_app`, `excluded_url`, `private_window`, `elevated_window` (from the moment an elevated window takes the foreground until focus returns; the low-level hook sees no clicks then, design §9.5), `secure_desktop`, `hook_lost`, `helper_restart`, `capture_lost` (including a disconnected remote session when the recorder runs inside one), `capture_masking_failed`, `permission_lost`, `system_dialog_not_captured` (a system-rendered dialog of an in-scope app that the capture filter could not include) |
| `after_step`, `before_step` | neighbouring steps, when they exist |
| `app_hint` | `{name}` only for `out_of_scope_app`/`elevated_window`; omitted for excluded apps and private windows |
| `user_note` | `{text, provenance: "user"}`, optional ("What happened while paused?") |
| `acknowledged` | bool. Rule R8 warns until true. |

### 5.5 `prompts.jsonl` (#/$defs/prompt)

| Field | Notes |
|---|---|
| `prompt_id`, `rule_id`, `t_ms`, `step_id?` | |
| `question` | the exact text shown |
| `chips` | the one-tap answers offered |
| `outcome` | `answered`, `answered_in_review`, `skipped`, `dismissed`, `expired` |
| `answer` | required when answered: `{chip?, text?, via: chip\|typed\|voice}` (text redacted like any comment) |
| `annotation_id` | the comment annotation the answer created |

### 5.6 `dataflow.json` (#/$defs/dataflow)

The graph that makes automation possible: what was read where, and written where.

- `parameters[]`: `{param_id, kind, label, value_type, shape?, sensitivity, literal_values?, sources[], sinks[], decision_step?}`.
  - `kind` ∈ `input`, `constant_or_choice`, `intermediate`, `output`.
  - `value_type` uses the same enum as a value record (`#/$defs/valueType`, which includes `record` for a whole saved entry).
  - `sensitivity` ∈ `low`, `personal`, `client_confidential`, `special`.
  - `literal_values` only when every observed value was `literal`, and each one traces to a `literal` value record or to a user annotation that states it (V16). A value read from remote pixels is never a literal value.
  - `sources[]`/`sinks[]`: `{step_id, how, where, shape?, provenance, annotation_id?, prompt_id?}`. `shape` records the format at that end when known, so a format change between systems is visible. `how` ∈ `read`, `copied`, `selected`, `typed`, `pasted`, `derived`, `computed_by_system`. Without a keyboard hook the recorder cannot tell typing from pasting, so an observed value commit is recorded as `typed`; `pasted` is used only when the user said so.
- `entities[]`: `{entity_id, label, ontology_type_hint?, appears_in[{step_id, where}], join_hint?{text, provenance, annotation_id?}}`. `label` names the kind of entity ("Client"), never its value and never in `{{placeholder}}` syntax (placeholders are reserved for parameters). `join_hint` records how the person matches records across systems that share no key.
- `outputs[]`: `{param_id, produced_at, evidence}`.

In the MVP, lineage (`copied`) comes from the clipboard change counter plus the user's answer to the "Where did this come from?" prompt (`provenance: user`). Automatic lineage from value fingerprints is a Phase 2 policy, off by default, that needs Moore's sign-off.

### 5.7 `readiness.json` (#/$defs/readiness)

`{rules_version, evaluated_at, results[{rule_id, severity, status, step_ids[], message, user_note?}]}`.
`severity` ∈ `block`, `warn`, `info`. `status` ∈ `pass`, `warn`, `skipped_by_user`, `info`, `not_applicable`. A `block` rule can only be `pass` or `not_applicable` in an exported package, because a failing block rule stops the export.

The rules are pure predicates over the step model in `@handover/core/rules`. The same module drives live prompts, the review checklist, the export gate and `handover lint` in CI.

| Rule | Check | Live trigger (MVP live rules in bold) | Severity |
|---|---|---|---|
| R1 | goal, done_when and trigger present | **start sheet** | warn |
| R2 | every `decision` step has ≥1 user-stated condition, or condition `unknown` plus an open question | **select/option/radio click; Decision tag** | warn |
| R3 | every typed or selected value has a disposition and a source, parameter or literal | **value_commit after a clipboard change in another app** | warn |
| R4 | every T0/T1 step has a user description or a confirmed OCR label | **click in a remote or opaque app** | warn |
| R5 | every step of kind `action` or `decision` whose `action.type` is not one of `scroll`, `app_switch`, `open_app`, `navigate`, `wait`, `inspect` has a `why`. Only `step.why` counts; a comment counts once the builder or the user links it into `why.source_annotation_ids` | dwell over 8 s before a commit-like button (Phase 2) | warn |
| R6 | a wait over 3 s has an `until` | busy cursor or static screen after a commit (Phase 2) | warn |
| R7 | no unresolved medium-precision detection; no special personal information | **detector hit (auto-blur toast)** | **block** |
| R8 | every gap is acknowledged | gap end (Phase 2) | warn |
| R9 | every highlight has a comment or tag | Explain closed without a comment (Phase 2) | warn |
| R10 | the final step has outcome evidence (after frame or checkpoint) | **Stop** | warn |
| R11 | a switch to an email or chat app has a hand-off note | focus to Outlook/Teams (Phase 2) | info |
| R12 | an error dialog or undo has an exception note | alert role or undo (Phase 2) | warn |
| R13 | a `commit_like` step (§9.3) in a system the tenant profile marks as system of record has a `boundary` answer | Save/Submit/Post in a system of record (Phase 2) | warn |
| R14 | wrap-up answered (next, failure modes, run kind, repeat) | **Stop** | warn |
| R15 | every step flagged `input_target_unknown` has `input_ack: true`, and every `scope_verified: false` step has `scope_acknowledged: true` | review | **block** |
| R16 | done-when coverage: `process.done_when_steps` is non-empty, and every dataflow parameter whose `label` appears in `done_when` (case- and diacritic-insensitive) has ≥ 1 sink | **Stop** (wrap-up: "Which step makes this true?" with step chips) | warn |
| R17 | every parameter whose sources and sinks lie in different systems has a `shape` (on the parameter or on both ends) | review ("Show Claude the format?") | warn |

Only privacy rules (R7, R15) block export. Context rules never block; they are written as `warn` or `skipped_by_user` so Claude knows what the user declined.

### 5.8 `privacy.json` (#/$defs/privacy)

Required by PRV-EXP-07.

| Field | Notes |
|---|---|
| `package_id`, `tool_version` | |
| `policy` | `{version, sha256, managed: bool}` |
| `reviewer_pseudonym` | |
| `exported_at` | `{local, utc, timezone}`: local time with offset, UTC, and the IANA timezone (as `manifest.recording.timezone`) |
| `attestation` | `{ticked: true, text}`; wording approved by Moore (sign-off S18) |
| `gate` | `{every_step_viewed: true, unresolved_detections: 0, blocking_flags: 0, preview_hash_matched: true, pre_write_verifier: "passed"}`. `pre_write_verifier` means the verifier ran over the exact in-memory bytes that were then written; `preview_hash_matched` means the content files (every file except `privacy.json` and `manifest.json`) hash to the preview the user attested on. `privacy.json` is built after the attestation, and the post-write read-back check deletes the output on any mismatch, so a package that exists passed it (design §12.4). The read-back verifier result goes to the local audit log, not into the package. |
| `detectors[]` | `{id, version, precision: high\|medium\|special}`; `names_to_hide` is listed when a names list or tenant dictionary was used (never its contents) |
| `redactions[]` | `{redaction_id, class, rule, channel, step_id?, annotation_id?, location}`. `class` is from the closed list (§4.1). `channel` ∈ `pixels`, `ocr_text`, `control_name`, `window_title`, `url`, `transcript`, `comment`, `value`, `a11y_snapshot`, `structured_text`. `location` is a `rect_fpx` or a JSON pointer, never a value. **One record per (step, channel, class, region)**; a pixel record names the step's `before.full` image (or `before.crop` under `crop_only`) and covers the same region in that step's crop, annotated and after images. |
| `counts_by_class` | object of class → number of `redactions[]` records of that class (V17) |
| `masked[]` | `{step_id, reason, count}`: `out_of_scope_app`, `excluded_app`, `excluded_url`, `private_window`, `unconfirmed_browser_window`, `shell_surface`, `recorder_window_fallback` |
| `unblurred[]` | `{step_id, rect_fpx, reason}`: reviewer un-blurs (PRV-KEY-04a) |
| `opt_ins_used[]` | e.g. `pre_recording_value_capture:<field>` |
| `scope` | `{unverified_steps[], acknowledged: bool}` |
| `approved_route` | the approved Claude processing route statement (sign-off S9) |
| `audio_exported` | const `false` |

### 5.9 `README.txt`
Plain text, at most 20 lines:
```
CONFIDENTIAL – <tenant display name> internal. For processing only via the approved route.
This is a Handover package (format handover-package 0.1), reviewed and redacted by its author.
Approved route: <approved_route from privacy.json>
Do not upload this package to a personal or consumer AI account.
Start here: CLAUDE_HANDOFF.md   Human guide: steps-guide.html
Package: <package_id>   Manifest sha256: see derived/derivation.json once processed
```

### 5.10 `a11y/<step>.json`
Validated against `#/$defs/a11ySnapshot`: `{captured_at_ms, window: {role, name, class_name?}, root, truncated: bool, node_count}`, where `root` is a tree of `#/$defs/a11yNode` `{role, native_role?, name: redactableText, automation_id?, ax_identifier?, bounds_fpx?, is_password?, on_target_path?, children[]}`.

**Pruning (export).** The tree keeps the target, its ancestors up to the window (or enclosing dialog), and the target's direct siblings. Nodes on the target path (`on_target_path: true`) keep their names, after the detectors and the names-to-hide matcher. **Sibling names are withheld**: every node off the target path has its name replaced by `[ROW_TEXT]` (class `sibling_text`, rule `a11y_sibling_default`) unless the user un-blurs it in review, because in a document list, inbox or client grid the siblings are other clients' records. At most 300 nodes. Absent when the target is unavailable. The raw store may keep the full freeze snapshot (it already holds frames showing the same text); the protection applies at export.

Every withheld or redacted name writes a `privacy.json` record with channel `a11y_snapshot`. The worked example shows `a11y/S02.json` (§10.9).

---

## 6. Cross-file invariants (semantic validator, `handover validate`)

The JSON Schema cannot express these. `packages/schema` implements them; each has a negative test.

| Id | Rule |
|---|---|
| V1 | Every `step_ids`, `annotation_ids`, `prompt_ids`, `source_annotation_ids`, `linked_annotation_ids`, `copied_from_step`, `after_step`, `before_step`, `decision_step`, `produced_at`, `data.reads/writes` and dataflow `sources/sinks` reference resolves. |
| V2 | `manifest.recording.step_count` equals the number of lines in `steps.jsonl`; steps are in `seq` order; ids run `S01…Sn`. |
| V3 | Every file in the package except `manifest.json` is listed in `manifest.files` with a correct sha256; no unlisted files; no `files[].path` is absolute, contains `..`, or resolves (after normalising separators) outside the package folder. |
| V4 | Each `est_tokens = ceil(w/28) × ceil(h/28)`; `media.image_count` and `est_image_tokens_total` equal the sums over steps; every full image fits the profile; the images present match `media.image_policy` (`full_and_crop`: every `before` has `full`; `crop_only`: no `full`, `full_annotated` or `after.full`; `text_only`: no `before`/`after` and no files in `media/`). |
| V5 | Every `*_fpx` rect and point lies inside its frame's `_fpx` extent (`size_dpx` of the source rect × `scale`); every `*_dpx` value lies inside its display's `size_dpx`. |
| V6 | Frame transforms agree: `bounds_fpx ≈ (bounds_dpx − source_rect_dpx origin) × scale` within 0.6 px; `crop_scale ≈ 1/(scale × scale_factor)` of the frame's display, within 0.001. |
| V7 | `evidence_tier` equals the tier computed from `target` (§5.2.1). |
| V8 | No value with disposition `redacted` or `never_captured` carries a literal; no `literal` matches a high-precision detector. `validate()` takes an injected `detectors` interface; `packages/schema` ships a minimal SA-ID and card Luhn implementation (`src/detectors-min.ts`) as the default, and `handover validate` in `cli` injects the full set from `packages/privacy`. |
| V9 | A `block` readiness rule is `pass` or `not_applicable`; `manifest.readiness_summary` matches `readiness.json`. |
| V10 | Intervals are half-open (§3.2). No two gaps intersect (touching is allowed); no step's interval intersects a gap's interval. |
| V11 | `privacy.reviewed_by_user` is true and `privacy.json.gate` shows a passed gate (including `pre_write_verifier: "passed"`); `audio_exported` is false; no file in `media/` is audio or video. |
| V12 | `task_ms + explain_ms + paused_ms = duration_ms`. |
| V13 | Every system referenced by a step's `target.app.system_id` exists in `manifest.systems`, and `evidence_summary` counts match the steps. |
| V14 | Every highlight `mark` is unique within the package; every `*_full_annotated.png` belongs to a step with at least one highlight. |
| V15 | Every parameter named in a value record exists in `dataflow.parameters`. |
| V16 | Every `literal_values` entry traces to a `literal` value record of a step that writes or reads that parameter, or to a user annotation cited by one of its sources. |
| V17 | `privacy.counts_by_class` equals the count of `redactions[]` records per class; every step with a `redacted_regions_fpx` rect has a matching `pixels` record; every redactableText with `redacted: true` has a record whose JSON pointer names it. |

---

## 7. Versioning

- `schema_version` is semver-like within 0.x. **Changes within 0.x are additive only**: new optional fields, new enum values appended, new files. Renames or removals need 1.0 or an explicit migration.
- Every package carries a copy of the schema it validates against in `schema/`.
- **L1a and L1a2 are the last window for non-additive changes.** Everything in this revision lands in L1a; the format gate L1a2 may still change the schema on the evidence of Claude reading packages, then records "format frozen at L1a2". After that, an approved additive patch is applied on the task branch by the orchestrator (Opus), never by a feature lane; the waiting lane then rebases.
- `recorder/packages/schema/CHANGELOG.md` records every change. The schema's root `$comment` holds `schema_patch=<n>` (a plain `$comment`, so Ajv strict mode accepts it). A CI gate fails when the schema file changes without a CHANGELOG entry and an incremented `schema_patch`; `manifest.schema_version` becomes `0.1.<n>` for packages written against patch `n`.
- `packages/schema` exports `migrate(package, toVersion)` once a second version exists. Golden fixtures are re-generated only through the migration, never by hand.
- `process-spec` has its own `spec_version` and follows the same rules.

---

## 8. JSON Schema (draft 2020-12)

One file. `manifest.json` validates against `#/$defs/manifest`; each line of `steps.jsonl` against `#/$defs/step`; each line of `annotations.jsonl` against `#/$defs/annotation`; each line of `gaps.jsonl` against `#/$defs/gap`; each line of `prompts.jsonl` against `#/$defs/prompt`; `dataflow.json` against `#/$defs/dataflow`; `readiness.json` against `#/$defs/readiness`; `privacy.json` against `#/$defs/privacy`; each `a11y/<step>.json` against `#/$defs/a11ySnapshot`.

**Validator options (normative).** `new Ajv2020({ strict: true, strictRequired: false, allErrors: true })` from `ajv` 8.x, plus `ajv-formats` (for `date-time`). Both are dependencies of `packages/schema`. `strictRequired` is off because `then: {required: [...]}` names properties declared in the parent schema, which strictRequired cannot see. Every `if` lists the property it keys on in `required`, so an absent property never triggers the `then`.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://handover.local/schemas/handover-package/0.1/package.schema.json",
  "title": "Handover package v0.1",
  "description": "One $defs entry per package file. See docs/recorder/package-spec.md for the cross-file invariants V1-V17.",
  "$comment": "schema_patch=0",
  "$defs": {
    "packageId": { "type": "string", "pattern": "^pkg_[0-9A-HJKMNP-TV-Z]{26}$" },
    "stepId": { "type": "string", "pattern": "^S[0-9]{2,4}$" },
    "annotationId": { "type": "string", "pattern": "^ann_[0-9]{4,6}$" },
    "frameId": { "type": "string", "pattern": "^frm_[0-9]{4,6}$" },
    "gapId": { "type": "string", "pattern": "^gap_[0-9]{4,6}$" },
    "promptId": { "type": "string", "pattern": "^prm_[0-9]{4,6}$" },
    "redactionId": { "type": "string", "pattern": "^red_[0-9]{4,6}$" },
    "chapterId": { "type": "string", "pattern": "^C[0-9]{1,3}$" },
    "displayId": { "type": "string", "pattern": "^d[0-9]{1,2}$" },
    "systemId": { "type": "string", "pattern": "^sys_[a-z0-9_]{2,40}$" },
    "slugId": { "type": "string", "pattern": "^[a-z][a-z0-9_]{1,47}$" },
    "ruleId": { "type": "string", "pattern": "^R[0-9]{1,2}$" },
    "appId": {
      "description": "Normalised app id: lower-case executable name without .exe, or lower-case bundle id (design: chrome, mstsc, com.microsoft.excel).",
      "type": "string", "pattern": "^[a-z0-9][a-z0-9._-]*$", "not": { "pattern": "\\.exe$" }
    },
    "redactionClass": {
      "description": "Closed class list. The token written into text is fixed per class (package-spec §4.1 table).",
      "enum": ["org_name", "person_name", "identifier", "hostname", "sa_id_number", "tax_number", "vat_number", "card_number", "email", "phone", "bank_account", "company_reg", "address", "amount", "special_pi", "user_marked", "sibling_text", "typed_field"]
    },
    "valueType": { "enum": ["text", "number", "currency", "date", "identifier", "email", "phone", "person_name", "org_name", "address", "sa_id_number", "tax_number", "bank_account", "password", "file_path", "option", "boolean", "record", "unknown", "other"] },
    "isoTime": { "type": "string", "format": "date-time" },
    "ms": { "type": "integer", "minimum": 0 },
    "sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
    "provenance": {
      "description": "observed = captured by the recorder; user = typed, said or chosen by the recording user; inferred = local deterministic code, not confirmed by the user. Never a cloud model.",
      "enum": ["observed", "user", "inferred"]
    },
    "rect": {
      "description": "[x0, y0, x1, y1], top-left origin, x0 < x1, y0 < y1. The field suffix names the space.",
      "type": "array", "items": { "type": "number" }, "minItems": 4, "maxItems": 4
    },
    "point": { "type": "array", "items": { "type": "number" }, "minItems": 2, "maxItems": 2 },
    "displayPoint": {
      "type": "object", "required": ["display_id", "xy"], "additionalProperties": false,
      "properties": { "display_id": { "$ref": "#/$defs/displayId" }, "xy": { "$ref": "#/$defs/point" } }
    },
    "tier": { "enum": ["T3", "T2", "T1", "T0"] },
    "grounding": { "enum": ["accessibility", "accessibility_weak", "ocr", "user_described", "visual_only", "none"] },
    "groundingSource": { "enum": ["ax", "uia", "vision_ocr", "windows_ocr", "tesseract", "user"] },
    "unavailableReason": {
      "enum": ["remote_session", "elevated_window", "secure_desktop", "opaque_toolkit", "timeout", "permission_missing", "helper_restarting", "out_of_scope_app", "excluded_app", "secure_field", "no_pointer_target"]
    },
    "gapReason": {
      "enum": ["user_paused", "idle_paused", "lock_paused", "sleep_paused", "user_switch_paused", "screensaver_paused", "out_of_scope_app", "excluded_app", "excluded_url", "private_window", "elevated_window", "secure_desktop", "hook_lost", "helper_restart", "capture_lost", "capture_masking_failed", "permission_lost", "system_dialog_not_captured"]
    },
    "tag": { "enum": ["decision", "varies", "sensitive", "rule", "exception", "judgement", "do_not_automate", "verify", "handoff", "not_sure_why"] },
    "statement": {
      "type": "object", "required": ["text", "provenance"], "additionalProperties": false,
      "properties": {
        "text": { "type": "string", "minLength": 1 },
        "provenance": { "$ref": "#/$defs/provenance" },
        "source_annotation_ids": { "type": "array", "items": { "$ref": "#/$defs/annotationId" } },
        "prompt_ids": { "type": "array", "items": { "$ref": "#/$defs/promptId" } }
      }
    },
    "redactableText": {
      "description": "When redacted is true, sensitive spans in text are replaced by the fixed token of their class (package-spec §4.1) and classes lists them. The real value never leaves the machine.",
      "type": "object", "required": ["text", "redacted"], "additionalProperties": false,
      "properties": {
        "text": { "type": "string" },
        "redacted": { "type": "boolean" },
        "classes": { "type": "array", "uniqueItems": true, "items": { "$ref": "#/$defs/redactionClass" } }
      }
    },
    "imageRef": {
      "type": "object", "required": ["path", "width", "height", "est_tokens", "variant"], "additionalProperties": false,
      "properties": {
        "path": { "type": "string", "pattern": "^media/S[0-9]{2,4}_(before|after)_(full|full_annotated|crop)\\.png$" },
        "width": { "type": "integer", "minimum": 1 },
        "height": { "type": "integer", "minimum": 1 },
        "est_tokens": { "type": "integer", "minimum": 1, "description": "ceil(width/28) * ceil(height/28)" },
        "variant": { "enum": ["full", "full_annotated", "crop"] },
        "crop_origin_fpx": { "$ref": "#/$defs/point", "description": "Top-left of the crop in frame pixels: fpx = crop_origin_fpx + cpx / crop_scale" },
        "crop_scale": { "type": "number", "exclusiveMinimum": 0, "description": "crop pixels per frame pixel; 1/scale for a native-resolution crop" }
      },
      "if": { "required": ["variant"], "properties": { "variant": { "const": "crop" } } },
      "then": { "required": ["crop_origin_fpx", "crop_scale"] }
    },
    "frame": {
      "description": "A capture of one display plus its transform: fpx = (dpx - source_rect_dpx[0:2]) * scale. Which images are present depends on manifest.media.image_policy (V4).",
      "type": "object", "required": ["frame_id", "t_ms", "display_id", "source_rect_dpx", "scale"], "additionalProperties": false,
      "properties": {
        "frame_id": { "$ref": "#/$defs/frameId" },
        "t_ms": { "$ref": "#/$defs/ms" },
        "display_id": { "$ref": "#/$defs/displayId" },
        "source_rect_dpx": { "$ref": "#/$defs/rect" },
        "scale": { "type": "number", "exclusiveMinimum": 0 },
        "full": { "$ref": "#/$defs/imageRef" },
        "full_annotated": { "$ref": "#/$defs/imageRef" },
        "crop": { "$ref": "#/$defs/imageRef" },
        "redacted_regions_fpx": { "type": "array", "items": { "$ref": "#/$defs/rect" } },
        "masked_regions_fpx": { "type": "array", "items": { "$ref": "#/$defs/rect" } }
      }
    },
    "locator": {
      "type": "object", "required": ["strategy", "value", "rank", "stability"], "additionalProperties": false,
      "properties": {
        "strategy": { "enum": ["uia_automation_id", "ax_identifier", "role_name_path", "label_relative", "ocr_text", "image_anchor", "frame_point"] },
        "value": { "type": "string" },
        "rank": { "type": "integer", "minimum": 1 },
        "stability": { "enum": ["high", "medium", "low", "unknown"] },
        "note": { "type": "string" }
      }
    },
    "target": {
      "type": "object", "required": ["grounding", "app", "locators", "display_id"], "additionalProperties": false,
      "properties": {
        "grounding": { "$ref": "#/$defs/grounding" },
        "grounding_source": { "$ref": "#/$defs/groundingSource" },
        "unavailable": {
          "type": "object", "required": ["reason"], "additionalProperties": false,
          "properties": {
            "reason": { "$ref": "#/$defs/unavailableReason" },
            "client": { "enum": ["mstsc", "msrdc", "citrix_workspace", "windows_app", "parallels", "web_gateway", "other"] }
          }
        },
        "app": {
          "type": "object", "required": ["name", "kind", "system_id"], "additionalProperties": false,
          "properties": {
            "name": { "type": "string" },
            "process": { "type": "string" },
            "bundle_id": { "type": "string" },
            "version": { "type": "string" },
            "kind": { "enum": ["native", "browser", "remote_session", "unknown"] },
            "system_id": { "$ref": "#/$defs/systemId" }
          }
        },
        "window": {
          "type": "object", "additionalProperties": false,
          "properties": {
            "title": { "$ref": "#/$defs/redactableText" },
            "class_name": { "type": "string" },
            "is_dialog": { "type": "boolean" },
            "integrity": { "enum": ["normal", "elevated"] }
          }
        },
        "url": { "$ref": "#/$defs/redactableText" },
        "element": {
          "type": "object", "required": ["role", "name", "is_password"], "additionalProperties": false,
          "properties": {
            "role": { "enum": ["button", "textbox", "combobox", "option", "menuitem", "link", "tab", "checkbox", "radio", "cell", "row", "listitem", "treeitem", "dialog", "window", "pane", "document", "text", "image", "other"] },
            "native_role": { "type": "string" },
            "name": { "$ref": "#/$defs/redactableText" },
            "label": { "type": "string" },
            "automation_id": { "type": "string" },
            "ax_identifier": { "type": "string" },
            "class_name": { "type": "string" },
            "framework_id": { "type": "string" },
            "is_password": { "type": "boolean" },
            "position_in_set": { "type": "integer", "minimum": 1 },
            "size_of_set": { "type": "integer", "minimum": 1 }
          }
        },
        "ancestry": {
          "type": "array",
          "items": {
            "type": "object", "required": ["role", "name"], "additionalProperties": false,
            "properties": { "role": { "type": "string" }, "name": { "type": "string" }, "automation_id": { "type": "string" } }
          }
        },
        "locators": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/locator" } },
        "display_id": { "$ref": "#/$defs/displayId" },
        "bounds_dpx": { "$ref": "#/$defs/rect" },
        "bounds_fpx": { "$ref": "#/$defs/rect" },
        "ocr_near": {
          "type": "object", "required": ["text", "confidence", "bounds_fpx"], "additionalProperties": false,
          "properties": {
            "text": { "$ref": "#/$defs/redactableText" },
            "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
            "bounds_fpx": { "$ref": "#/$defs/rect" }
          }
        },
        "user_description": {
          "type": "object", "required": ["text", "provenance"], "additionalProperties": false,
          "properties": {
            "text": { "type": "string", "minLength": 1 },
            "provenance": { "const": "user" },
            "prompt_id": { "$ref": "#/$defs/promptId" }
          }
        },
        "a11y_snapshot": { "type": "string", "pattern": "^a11y/S[0-9]{2,4}\\.json$" }
      },
      "allOf": [
        { "if": { "required": ["grounding"], "properties": { "grounding": { "enum": ["accessibility", "accessibility_weak"] } } }, "then": { "required": ["element", "grounding_source", "bounds_dpx", "bounds_fpx"] } },
        { "if": { "required": ["grounding"], "properties": { "grounding": { "not": { "const": "accessibility" } } } }, "then": { "required": ["unavailable"] } },
        { "if": { "required": ["grounding"], "properties": { "grounding": { "const": "ocr" } } }, "then": { "required": ["ocr_near", "grounding_source"] } },
        { "if": { "required": ["grounding"], "properties": { "grounding": { "const": "user_described" } } }, "then": { "required": ["user_description"] } }
      ]
    },
    "valueRecord": {
      "type": "object", "required": ["disposition", "value_type", "length_bucket", "source"], "additionalProperties": false,
      "properties": {
        "disposition": { "enum": ["literal", "redacted", "never_captured"] },
        "literal": { "type": "string" },
        "placeholder": { "type": "string", "pattern": "^\\{\\{[a-z][a-z0-9_]{1,47}\\}\\}$" },
        "value_type": { "$ref": "#/$defs/valueType" },
        "shape": { "type": "string" },
        "length_bucket": { "enum": ["1-5", "6-20", "21+", "unknown"] },
        "source": { "enum": ["typed", "pasted", "selected", "autofilled", "unknown"] },
        "copied_from_step": { "$ref": "#/$defs/stepId" },
        "copied_from_provenance": { "enum": ["observed", "user"] },
        "parameter": { "$ref": "#/$defs/slugId" }
      },
      "allOf": [
        { "if": { "properties": { "disposition": { "const": "literal" } } }, "then": { "required": ["literal"] } },
        { "if": { "properties": { "disposition": { "const": "redacted" } } }, "then": { "required": ["placeholder"], "not": { "required": ["literal"] } } },
        { "if": { "properties": { "disposition": { "const": "never_captured" } } }, "then": { "allOf": [ { "not": { "required": ["literal"] } }, { "not": { "required": ["placeholder"] } } ] } },
        { "if": { "required": ["copied_from_step"] }, "then": { "required": ["copied_from_provenance"] } }
      ]
    },
    "keyInference": {
      "type": "object", "required": ["keys", "observed", "inferred_from"], "additionalProperties": false,
      "properties": {
        "keys": { "type": "string", "pattern": "^[a-z0-9+]+$" },
        "observed": { "const": false },
        "inferred_from": { "type": "array", "minItems": 1, "items": { "enum": ["title_change", "focus_change", "screen_change", "clipboard_change", "value_commit"] } }
      }
    },
    "action": {
      "type": "object", "required": ["type"], "additionalProperties": false,
      "properties": {
        "type": { "enum": ["click", "double_click", "right_click", "type", "key", "select", "drag", "scroll", "app_switch", "open_app", "navigate", "file_dialog", "copy", "paste", "inspect", "wait", "manual", "other"] },
        "point_dpx": { "$ref": "#/$defs/displayPoint" },
        "point_fpx": { "$ref": "#/$defs/point" },
        "end_point_fpx": { "$ref": "#/$defs/point" },
        "value": { "$ref": "#/$defs/valueRecord" },
        "key_inference": { "$ref": "#/$defs/keyInference" },
        "cell": {
          "type": "object", "required": ["address"], "additionalProperties": false,
          "properties": { "address": { "type": "string" }, "column_header": { "type": "string" } }
        },
        "scroll": {
          "type": "object", "additionalProperties": false,
          "properties": { "direction": { "enum": ["up", "down", "left", "right"] }, "amount": { "type": "number" } }
        },
        "description": { "type": "string", "description": "For manual steps: what the user did off screen." }
      }
    },
    "manifest": {
      "type": "object",
      "required": ["format", "schema_version", "package_id", "revision", "created_at", "recorder", "author", "actors", "process", "systems", "recording", "capture", "displays", "media", "privacy", "readiness_summary", "files"],
      "additionalProperties": false,
      "properties": {
        "format": { "const": "handover-package" },
        "schema_version": { "type": "string", "pattern": "^0\\.1(\\.[0-9]+)?$" },
        "package_id": { "$ref": "#/$defs/packageId" },
        "revision": {
          "type": "object", "required": ["rev"], "additionalProperties": false,
          "properties": {
            "rev": { "type": "integer", "minimum": 1 },
            "supersedes_package_id": { "$ref": "#/$defs/packageId" },
            "reason": { "type": "string" }
          },
          "if": { "required": ["rev"], "properties": { "rev": { "type": "integer", "minimum": 2 } } },
          "then": { "required": ["supersedes_package_id", "reason"] }
        },
        "created_at": { "$ref": "#/$defs/isoTime" },
        "recorder": {
          "type": "object", "required": ["name", "version", "os", "os_version", "arch"], "additionalProperties": false,
          "properties": {
            "name": { "const": "handover" },
            "version": { "type": "string" },
            "os": { "enum": ["macos", "windows"] },
            "os_version": { "type": "string" },
            "arch": { "enum": ["arm64", "x64"] },
            "locale": { "type": "string" }
          }
        },
        "author": {
          "type": "object", "required": ["pseudonym", "position"], "additionalProperties": false,
          "properties": { "pseudonym": { "type": "string", "pattern": "^user_[0-9a-f]{4,12}$" }, "position": { "type": "string" } }
        },
        "actors": {
          "type": "array", "minItems": 1,
          "items": {
            "type": "object", "required": ["position"], "additionalProperties": false,
            "properties": { "position": { "type": "string" }, "role_in_process": { "type": "string" } }
          }
        },
        "tenant_profile": {
          "type": "object", "required": ["tenant_id", "version", "sha256"], "additionalProperties": false,
          "properties": { "tenant_id": { "type": "string" }, "version": { "type": "string" }, "sha256": { "$ref": "#/$defs/sha256" } }
        },
        "process": {
          "type": "object", "required": ["title", "process_key", "goal", "done_when", "trigger", "wrapup"], "additionalProperties": false,
          "properties": {
            "title": { "type": "string", "minLength": 1 },
            "process_key": { "type": "string", "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$" },
            "goal": { "type": "string" },
            "done_when": { "type": "string", "minLength": 1 },
            "done_when_steps": { "type": "array", "uniqueItems": true, "items": { "$ref": "#/$defs/stepId" }, "description": "Steps the user chose at wrap-up as making done_when true (rule R16)." },
            "repeat": {
              "type": "object", "required": ["unit", "provenance"], "additionalProperties": false,
              "description": "Wrap-up chip: once, or for each client / row / document. Loops are never inferred.",
              "properties": {
                "unit": { "enum": ["once", "per_client", "per_row", "per_document", "other"] },
                "unit_text": { "type": "string" },
                "step_ids": { "type": "array", "items": { "$ref": "#/$defs/stepId" } },
                "termination": { "type": "string" },
                "provenance": { "enum": ["user"] }
              }
            },
            "trigger": {
              "type": "object", "required": ["kind", "text"], "additionalProperties": false,
              "properties": { "kind": { "enum": ["event", "schedule", "request", "manual", "unknown"] }, "text": { "type": "string" } }
            },
            "frequency": { "type": "string" },
            "volume": { "type": "string" },
            "wrapup": {
              "type": "object", "required": ["run_kind"], "additionalProperties": false,
              "properties": {
                "next": { "type": "string" },
                "failure_modes": { "type": "string" },
                "run_kind": { "enum": ["normal", "unusual", "unknown"] },
                "run_note": { "type": "string" }
              }
            }
          }
        },
        "systems": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["system_id", "display_name", "app_ids", "access_mode", "evidence_summary", "is_system_of_record", "sor_source"],
            "additionalProperties": false,
            "properties": {
              "system_id": { "$ref": "#/$defs/systemId" },
              "display_name": { "type": "string" },
              "app_ids": { "type": "array", "items": { "$ref": "#/$defs/appId" } },
              "access_mode": { "enum": ["native", "browser", "remote", "unknown"] },
              "url_origins": { "type": "array", "items": { "type": "string", "pattern": "^https?://[^/?#]+$" } },
              "evidence_summary": {
                "type": "object", "required": ["T3", "T2", "T1", "T0"], "additionalProperties": false,
                "properties": {
                  "T3": { "type": "integer", "minimum": 0 }, "T2": { "type": "integer", "minimum": 0 },
                  "T1": { "type": "integer", "minimum": 0 }, "T0": { "type": "integer", "minimum": 0 }
                }
              },
              "system_key_hint": { "type": "string" },
              "is_system_of_record": { "type": "boolean" },
              "sor_source": { "enum": ["tenant_profile", "user", "unknown"] }
            }
          }
        },
        "recording": {
          "type": "object",
          "required": ["started_at", "ended_at", "timezone", "duration_ms", "task_ms", "explain_ms", "paused_ms", "step_count", "edited"],
          "additionalProperties": false,
          "properties": {
            "started_at": { "$ref": "#/$defs/isoTime" },
            "ended_at": { "$ref": "#/$defs/isoTime" },
            "timezone": { "type": "string" },
            "duration_ms": { "$ref": "#/$defs/ms" },
            "task_ms": { "$ref": "#/$defs/ms" },
            "explain_ms": { "$ref": "#/$defs/ms" },
            "paused_ms": { "$ref": "#/$defs/ms" },
            "step_count": { "type": "integer", "minimum": 0 },
            "chapters": {
              "type": "array",
              "items": {
                "type": "object", "required": ["chapter_id", "from_step", "to_step"], "additionalProperties": false,
                "properties": {
                  "chapter_id": { "$ref": "#/$defs/chapterId" },
                  "title": { "type": "string" },
                  "from_step": { "$ref": "#/$defs/stepId" },
                  "to_step": { "$ref": "#/$defs/stepId" }
                }
              }
            },
            "edited": { "type": "boolean" }
          }
        },
        "capture": {
          "type": "object", "required": ["scope", "capabilities", "self_test", "session"], "additionalProperties": false,
          "properties": {
            "session": { "enum": ["console", "rdp", "ica", "unknown"], "description": "Where the recorder itself ran: a local console session, or inside an RDP or Citrix/VDI session." },
            "scope": {
              "type": "object", "required": ["mode", "blocklist_policy_sha256"], "additionalProperties": false,
              "properties": {
                "mode": { "enum": ["apps", "display"] },
                "apps": {
                  "type": "array",
                  "items": {
                    "type": "object", "required": ["app_id", "name"], "additionalProperties": false,
                    "properties": { "app_id": { "$ref": "#/$defs/appId" }, "name": { "type": "string" }, "bundle_or_exe": { "type": "string" } }
                  }
                },
                "display_ids": { "type": "array", "items": { "$ref": "#/$defs/displayId" } },
                "blocklist_policy_sha256": { "$ref": "#/$defs/sha256" }
              },
              "if": { "required": ["mode"], "properties": { "mode": { "const": "apps" } } },
              "then": { "required": ["apps"] },
              "else": { "required": ["display_ids"] }
            },
            "capabilities": {
              "type": "object",
              "required": ["input_mouse", "a11y_hit", "a11y_snapshot", "capture_self_exclude", "capture_backend", "scope_masking", "ocr", "keyboard"],
              "additionalProperties": false,
              "properties": {
                "input_mouse": { "type": "boolean" },
                "a11y_hit": { "type": "boolean" },
                "a11y_snapshot": { "type": "boolean" },
                "capture_self_exclude": { "type": "boolean" },
                "capture_backend": { "enum": ["sck", "wgc", "dxgi", "desktop_capturer"] },
                "scope_masking": { "enum": ["os_filter", "helper_mask", "helper_composite", "core_mask", "none"] },
                "ocr": { "enum": ["vision", "windows_ocr", "tesseract", "none"] },
                "keyboard": { "const": "none" }
              }
            },
            "self_test": {
              "type": "object", "required": ["passed", "fallback"], "additionalProperties": false,
              "properties": { "passed": { "type": "boolean" }, "fallback": { "enum": ["none", "mask_recorder_windows"] } }
            }
          }
        },
        "displays": {
          "type": "array", "minItems": 1,
          "items": {
            "type": "object", "required": ["display_id", "global_space", "origin_global", "size_dpx", "scale_factor", "primary"], "additionalProperties": false,
            "properties": {
              "display_id": { "$ref": "#/$defs/displayId" },
              "global_space": { "enum": ["macos_global_points", "windows_virtual_px"] },
              "origin_global": { "$ref": "#/$defs/point" },
              "size_dpx": {
                "type": "array", "items": { "type": "integer", "minimum": 1 }, "minItems": 2, "maxItems": 2
              },
              "scale_factor": { "type": "number", "exclusiveMinimum": 0 },
              "primary": { "type": "boolean" }
            }
          }
        },
        "media": {
          "type": "object",
          "required": ["image_profile", "image_policy", "max_long_edge", "max_tokens_per_image", "image_count", "est_image_tokens_total", "format", "video_included", "audio_included"],
          "additionalProperties": false,
          "properties": {
            "image_profile": { "enum": ["standard", "high"] },
            "image_policy": { "enum": ["full_and_crop", "crop_only", "text_only"], "description": "Which images are exported (§3.4). A tenant policy may force a lower-exposure policy." },
            "max_long_edge": { "type": "integer", "minimum": 1 },
            "max_tokens_per_image": { "type": "integer", "minimum": 1 },
            "image_count": { "type": "integer", "minimum": 0 },
            "est_image_tokens_total": { "type": "integer", "minimum": 0 },
            "format": { "const": "png" },
            "video_included": { "const": false },
            "audio_included": { "const": false }
          }
        },
        "privacy": {
          "type": "object", "required": ["reviewed_by_user", "reviewed_at", "privacy_file", "contains_personal_information"], "additionalProperties": false,
          "properties": {
            "reviewed_by_user": { "const": true },
            "reviewed_at": { "$ref": "#/$defs/isoTime" },
            "privacy_file": { "const": "privacy.json" },
            "contains_personal_information": { "enum": ["none_known", "redacted", "present_with_authorisation"] }
          }
        },
        "readiness_summary": {
          "type": "object", "required": ["pass", "warn", "skipped_by_user", "info", "not_applicable"], "additionalProperties": false,
          "properties": {
            "pass": { "type": "integer", "minimum": 0 },
            "warn": { "type": "integer", "minimum": 0 },
            "skipped_by_user": { "type": "integer", "minimum": 0 },
            "info": { "type": "integer", "minimum": 0 },
            "not_applicable": { "type": "integer", "minimum": 0 }
          }
        },
        "files": {
          "type": "array", "minItems": 1,
          "items": {
            "type": "object", "required": ["path", "sha256", "bytes", "role"], "additionalProperties": false,
            "properties": {
              "path": { "type": "string", "pattern": "^(?!/)(?!.*\\.\\.)[A-Za-z0-9_./-]+$", "not": { "const": "manifest.json" } },
              "sha256": { "$ref": "#/$defs/sha256" },
              "bytes": { "type": "integer", "minimum": 0 },
              "role": { "enum": ["readme", "handoff", "process_doc", "steps_guide", "steps", "annotations", "gaps", "prompts", "dataflow", "readiness", "privacy", "image", "a11y", "anchor", "schema"] }
            }
          }
        }
      }
    },
    "step": {
      "type": "object",
      "required": ["step_id", "seq", "kind", "t_start_ms", "t_end_ms", "summary", "summary_provenance", "boundary", "boundary_source", "scope_verified"],
      "additionalProperties": false,
      "properties": {
        "step_id": { "$ref": "#/$defs/stepId" },
        "seq": { "type": "integer", "minimum": 1 },
        "kind": { "enum": ["action", "decision", "wait", "checkpoint", "context", "manual"] },
        "chapter_id": { "$ref": "#/$defs/chapterId" },
        "t_start_ms": { "$ref": "#/$defs/ms" },
        "t_end_ms": { "$ref": "#/$defs/ms" },
        "explain_ms": { "$ref": "#/$defs/ms" },
        "phase": { "type": "string" },
        "summary": { "type": "string", "minLength": 1 },
        "summary_provenance": { "$ref": "#/$defs/provenance" },
        "observed_via": { "enum": ["pointer", "focus", "value_commit", "screen_change", "clipboard_change", "window_change", "user"] },
        "evidence_tier": { "$ref": "#/$defs/tier" },
        "why": { "$ref": "#/$defs/statement" },
        "action": { "$ref": "#/$defs/action" },
        "target": { "$ref": "#/$defs/target" },
        "before": { "$ref": "#/$defs/frame" },
        "after": { "$ref": "#/$defs/frame" },
        "data": {
          "type": "object", "additionalProperties": false,
          "properties": {
            "reads": { "type": "array", "items": { "$ref": "#/$defs/slugId" } },
            "writes": { "type": "array", "items": { "$ref": "#/$defs/slugId" } }
          }
        },
        "tags": { "type": "array", "uniqueItems": true, "items": { "$ref": "#/$defs/tag" } },
        "boundary": { "enum": ["ok", "engagement_file_content", "system_of_record_write", "unknown", "not_assessed"] },
        "boundary_source": { "enum": ["tenant_rule", "user", "none"] },
        "expected_result": { "$ref": "#/$defs/statement" },
        "post_wait": {
          "type": "object", "required": ["duration_ms", "kind"], "additionalProperties": false,
          "properties": {
            "duration_ms": { "$ref": "#/$defs/ms" },
            "kind": { "enum": ["system", "human", "unknown"] },
            "until": { "type": "string" }
          }
        },
        "decision": {
          "type": "object", "required": ["question", "branch_taken", "branch_taken_provenance", "branches"], "additionalProperties": false,
          "properties": {
            "question": { "type": "string" },
            "branch_taken": { "type": "string" },
            "branch_taken_provenance": { "$ref": "#/$defs/provenance" },
            "branches": {
              "type": "array", "minItems": 1,
              "items": {
                "type": "object", "required": ["condition", "observed", "provenance"], "additionalProperties": false,
                "properties": {
                  "condition": { "type": "string" },
                  "then": { "type": "string" },
                  "observed": { "type": "boolean" },
                  "provenance": { "$ref": "#/$defs/provenance" }
                }
              }
            }
          }
        },
        "scope_verified": { "type": "boolean" },
        "scope_acknowledged": { "type": "boolean" },
        "input_ack": { "type": "boolean", "description": "The user acknowledged possible typing into an unknown or remote target (rule R15)." },
        "annotation_ids": { "type": "array", "items": { "$ref": "#/$defs/annotationId" } },
        "prompt_ids": { "type": "array", "items": { "$ref": "#/$defs/promptId" } },
        "flags": {
          "type": "array", "uniqueItems": true,
          "items": { "enum": ["user_edited", "user_added", "merged", "low_confidence_target", "remote_session", "contains_redaction", "input_target_unknown", "inferred_key", "error_recovery", "elevated_window"] }
        }
      },
      "allOf": [
        { "if": { "required": ["kind"], "properties": { "kind": { "enum": ["action", "decision"] } } }, "then": { "required": ["observed_via", "evidence_tier", "action", "target"] } },
        { "if": { "required": ["kind"], "properties": { "kind": { "const": "decision" } } }, "then": { "required": ["decision"] } },
        { "if": { "required": ["kind"], "properties": { "kind": { "const": "manual" } } }, "then": { "required": ["action"], "properties": { "action": { "type": "object", "properties": { "type": { "const": "manual" } }, "required": ["description"] } } } },
        { "if": { "required": ["scope_verified"], "properties": { "scope_verified": { "const": false } } }, "then": { "required": ["scope_acknowledged"], "properties": { "scope_acknowledged": { "const": true } } } },
        { "if": { "required": ["flags"], "properties": { "flags": { "type": "array", "contains": { "const": "input_target_unknown" } } } }, "then": { "required": ["input_ack"], "properties": { "input_ack": { "const": true } } } }
      ]
    },
    "annotation": {
      "type": "object", "required": ["annotation_id", "kind", "t_ms", "provenance", "step_ids"], "additionalProperties": false,
      "properties": {
        "annotation_id": { "$ref": "#/$defs/annotationId" },
        "kind": { "enum": ["highlight", "comment", "narration"] },
        "t_ms": { "$ref": "#/$defs/ms" },
        "t_end_ms": { "$ref": "#/$defs/ms" },
        "provenance": { "$ref": "#/$defs/provenance" },
        "step_ids": { "type": "array", "items": { "$ref": "#/$defs/stepId" } },
        "anchor": { "enum": ["explicit", "time_aligned", "inferred"] },
        "anchor_confidence": { "type": "number", "minimum": 0, "maximum": 1 },
        "mark": { "type": "string", "pattern": "^H[0-9]{1,3}$" },
        "shape": { "enum": ["rect", "ellipse", "arrow", "highlighter", "freehand", "callout"] },
        "callout_number": { "type": "integer", "minimum": 1 },
        "frame_id": { "$ref": "#/$defs/frameId" },
        "geometry_fpx": { "type": "array", "minItems": 2, "items": { "$ref": "#/$defs/point" } },
        "snapped_to": {
          "type": "object", "required": ["role", "name", "bounds_fpx", "grounding"], "additionalProperties": false,
          "properties": {
            "role": { "type": "string" },
            "name": { "type": "string" },
            "automation_id": { "type": "string" },
            "bounds_fpx": { "$ref": "#/$defs/rect" },
            "grounding": { "$ref": "#/$defs/grounding" }
          }
        },
        "tags": { "type": "array", "uniqueItems": true, "items": { "$ref": "#/$defs/tag" } },
        "follow_up": {
          "type": "object", "required": ["question"], "additionalProperties": false,
          "properties": { "question": { "type": "string" }, "answer": { "type": "string" } }
        },
        "text": { "type": "string" },
        "source": { "enum": ["typed", "voice", "prompt", "review"] },
        "prompt_id": { "$ref": "#/$defs/promptId" },
        "linked_annotation_ids": { "type": "array", "items": { "$ref": "#/$defs/annotationId" } },
        "redacted": { "type": "boolean" }
      },
      "allOf": [
        { "if": { "required": ["kind"], "properties": { "kind": { "const": "highlight" } } }, "then": { "required": ["mark", "shape", "frame_id", "geometry_fpx", "anchor"] } },
        { "if": { "required": ["kind"], "properties": { "kind": { "const": "comment" } } }, "then": { "required": ["text", "anchor", "source"] } },
        { "if": { "required": ["kind"], "properties": { "kind": { "const": "narration" } } }, "then": { "required": ["text", "anchor", "t_end_ms", "anchor_confidence"] } },
        { "if": { "required": ["source"], "properties": { "source": { "const": "prompt" } } }, "then": { "required": ["prompt_id"] } },
        { "if": { "required": ["shape"], "properties": { "shape": { "enum": ["rect", "ellipse", "arrow", "callout"] } } }, "then": { "properties": { "geometry_fpx": { "type": "array", "maxItems": 2 } } } }
      ]
    },
    "gap": {
      "type": "object", "required": ["gap_id", "t_start_ms", "t_end_ms", "reason", "acknowledged"], "additionalProperties": false,
      "properties": {
        "gap_id": { "$ref": "#/$defs/gapId" },
        "t_start_ms": { "$ref": "#/$defs/ms" },
        "t_end_ms": { "$ref": "#/$defs/ms" },
        "reason": { "$ref": "#/$defs/gapReason" },
        "after_step": { "$ref": "#/$defs/stepId" },
        "before_step": { "$ref": "#/$defs/stepId" },
        "app_hint": {
          "type": "object", "required": ["name"], "additionalProperties": false,
          "properties": { "name": { "type": "string" } }
        },
        "user_note": {
          "type": "object", "required": ["text", "provenance"], "additionalProperties": false,
          "properties": { "text": { "type": "string", "minLength": 1 }, "provenance": { "const": "user" } }
        },
        "acknowledged": { "type": "boolean" }
      },
      "if": { "required": ["reason"], "properties": { "reason": { "enum": ["excluded_app", "excluded_url", "private_window"] } } },
      "then": { "not": { "required": ["app_hint"] } }
    },
    "prompt": {
      "type": "object", "required": ["prompt_id", "rule_id", "t_ms", "question", "chips", "outcome"], "additionalProperties": false,
      "properties": {
        "prompt_id": { "$ref": "#/$defs/promptId" },
        "rule_id": { "$ref": "#/$defs/ruleId" },
        "t_ms": { "$ref": "#/$defs/ms" },
        "step_id": { "$ref": "#/$defs/stepId" },
        "question": { "type": "string", "minLength": 1 },
        "chips": { "type": "array", "items": { "type": "string" } },
        "outcome": { "enum": ["answered", "answered_in_review", "skipped", "dismissed", "expired"] },
        "answer": {
          "type": "object", "required": ["via"], "additionalProperties": false,
          "properties": {
            "chip": { "type": "string" },
            "text": { "type": "string" },
            "via": { "enum": ["chip", "typed", "voice"] }
          }
        },
        "annotation_id": { "$ref": "#/$defs/annotationId" }
      },
      "if": { "required": ["outcome"], "properties": { "outcome": { "enum": ["answered", "answered_in_review"] } } },
      "then": { "required": ["answer", "annotation_id"] },
      "else": { "not": { "required": ["answer"] } }
    },
    "flowEnd": {
      "type": "object", "required": ["step_id", "how", "where", "provenance"], "additionalProperties": false,
      "properties": {
        "step_id": { "$ref": "#/$defs/stepId" },
        "how": { "enum": ["read", "copied", "selected", "typed", "pasted", "derived", "computed_by_system"] },
        "where": { "type": "string" },
        "shape": { "type": "string", "description": "Format at this end, when the user or the field type supplied it (for example D MMM YYYY). Never an example value." },
        "provenance": { "$ref": "#/$defs/provenance" },
        "annotation_id": { "$ref": "#/$defs/annotationId" },
        "prompt_id": { "$ref": "#/$defs/promptId" }
      }
    },
    "dataflow": {
      "type": "object", "required": ["parameters", "entities", "outputs"], "additionalProperties": false,
      "properties": {
        "parameters": {
          "type": "array",
          "items": {
            "type": "object", "required": ["param_id", "kind", "label", "value_type", "sensitivity", "sources", "sinks"], "additionalProperties": false,
            "properties": {
              "param_id": { "$ref": "#/$defs/slugId" },
              "kind": { "enum": ["input", "constant_or_choice", "intermediate", "output"] },
              "label": { "type": "string" },
              "value_type": { "$ref": "#/$defs/valueType" },
              "shape": { "type": "string" },
              "sensitivity": { "enum": ["low", "personal", "client_confidential", "special"] },
              "literal_values": { "type": "array", "items": { "type": "string" } },
              "sources": { "type": "array", "items": { "$ref": "#/$defs/flowEnd" } },
              "sinks": { "type": "array", "items": { "$ref": "#/$defs/flowEnd" } },
              "decision_step": { "$ref": "#/$defs/stepId" }
            }
          }
        },
        "entities": {
          "type": "array",
          "items": {
            "type": "object", "required": ["entity_id", "label", "appears_in"], "additionalProperties": false,
            "properties": {
              "entity_id": { "$ref": "#/$defs/slugId" },
              "label": { "type": "string" },
              "ontology_type_hint": { "type": "string" },
              "appears_in": {
                "type": "array",
                "items": {
                  "type": "object", "required": ["step_id", "where"], "additionalProperties": false,
                  "properties": { "step_id": { "$ref": "#/$defs/stepId" }, "where": { "type": "string" } }
                }
              },
              "join_hint": {
                "type": "object", "required": ["text", "provenance"], "additionalProperties": false,
                "properties": {
                  "text": { "type": "string" },
                  "provenance": { "$ref": "#/$defs/provenance" },
                  "annotation_id": { "$ref": "#/$defs/annotationId" }
                }
              }
            }
          }
        },
        "outputs": {
          "type": "array",
          "items": {
            "type": "object", "required": ["param_id", "produced_at", "evidence"], "additionalProperties": false,
            "properties": {
              "param_id": { "$ref": "#/$defs/slugId" },
              "produced_at": { "$ref": "#/$defs/stepId" },
              "evidence": { "type": "string" }
            }
          }
        }
      }
    },
    "readiness": {
      "type": "object", "required": ["rules_version", "evaluated_at", "results"], "additionalProperties": false,
      "properties": {
        "rules_version": { "type": "string" },
        "evaluated_at": { "$ref": "#/$defs/isoTime" },
        "results": {
          "type": "array",
          "items": {
            "type": "object", "required": ["rule_id", "severity", "status", "step_ids", "message"], "additionalProperties": false,
            "properties": {
              "rule_id": { "$ref": "#/$defs/ruleId" },
              "severity": { "enum": ["block", "warn", "info"] },
              "status": { "enum": ["pass", "warn", "skipped_by_user", "info", "not_applicable"] },
              "step_ids": { "type": "array", "items": { "$ref": "#/$defs/stepId" } },
              "message": { "type": "string" },
              "user_note": { "type": "string" }
            },
            "if": { "required": ["severity"], "properties": { "severity": { "const": "block" } } },
            "then": { "properties": { "status": { "enum": ["pass", "not_applicable"] } } }
          }
        }
      }
    },
    "privacy": {
      "type": "object",
      "required": ["package_id", "tool_version", "policy", "reviewer_pseudonym", "exported_at", "attestation", "gate", "detectors", "redactions", "counts_by_class", "masked", "unblurred", "opt_ins_used", "scope", "approved_route", "audio_exported"],
      "additionalProperties": false,
      "properties": {
        "package_id": { "$ref": "#/$defs/packageId" },
        "tool_version": { "type": "string" },
        "policy": {
          "type": "object", "required": ["version", "sha256", "managed"], "additionalProperties": false,
          "properties": { "version": { "type": "string" }, "sha256": { "$ref": "#/$defs/sha256" }, "managed": { "type": "boolean" } }
        },
        "reviewer_pseudonym": { "type": "string" },
        "exported_at": {
          "type": "object", "required": ["local", "utc", "timezone"], "additionalProperties": false,
          "properties": { "local": { "$ref": "#/$defs/isoTime" }, "utc": { "$ref": "#/$defs/isoTime" }, "timezone": { "type": "string", "description": "IANA name, as manifest.recording.timezone" } }
        },
        "attestation": {
          "type": "object", "required": ["ticked", "text"], "additionalProperties": false,
          "properties": { "ticked": { "const": true }, "text": { "type": "string", "minLength": 1 } }
        },
        "gate": {
          "type": "object", "required": ["every_step_viewed", "unresolved_detections", "blocking_flags", "preview_hash_matched", "pre_write_verifier"], "additionalProperties": false,
          "properties": {
            "every_step_viewed": { "const": true },
            "unresolved_detections": { "const": 0 },
            "blocking_flags": { "const": 0 },
            "preview_hash_matched": { "const": true },
            "pre_write_verifier": { "const": "passed", "description": "The verifier ran on the exact in-memory bytes that were then written (design §12.4)." }
          }
        },
        "detectors": {
          "type": "array",
          "items": {
            "type": "object", "required": ["id", "version", "precision"], "additionalProperties": false,
            "properties": { "id": { "type": "string" }, "version": { "type": "string" }, "precision": { "enum": ["high", "medium", "special"] } }
          }
        },
        "redactions": {
          "type": "array",
          "items": {
            "type": "object", "required": ["redaction_id", "class", "rule", "channel", "location"], "additionalProperties": false,
            "properties": {
              "redaction_id": { "$ref": "#/$defs/redactionId" },
              "class": { "$ref": "#/$defs/redactionClass" },
              "rule": { "type": "string" },
              "channel": { "enum": ["pixels", "ocr_text", "control_name", "window_title", "url", "transcript", "comment", "value", "a11y_snapshot", "structured_text"] },
              "step_id": { "$ref": "#/$defs/stepId" },
              "annotation_id": { "$ref": "#/$defs/annotationId" },
              "location": {
                "oneOf": [
                  { "type": "object", "required": ["rect_fpx", "image"], "additionalProperties": false, "properties": { "rect_fpx": { "$ref": "#/$defs/rect" }, "image": { "type": "string" } } },
                  { "type": "object", "required": ["json_pointer", "file"], "additionalProperties": false, "properties": { "json_pointer": { "type": "string" }, "file": { "type": "string" } } }
                ]
              }
            }
          }
        },
        "counts_by_class": { "type": "object", "propertyNames": { "$ref": "#/$defs/redactionClass" }, "additionalProperties": { "type": "integer", "minimum": 0 } },
        "masked": {
          "type": "array",
          "items": {
            "type": "object", "required": ["step_id", "reason", "count"], "additionalProperties": false,
            "properties": {
              "step_id": { "$ref": "#/$defs/stepId" },
              "reason": { "enum": ["out_of_scope_app", "excluded_app", "excluded_url", "private_window", "unconfirmed_browser_window", "shell_surface", "recorder_window_fallback"] },
              "count": { "type": "integer", "minimum": 1 }
            }
          }
        },
        "unblurred": {
          "type": "array",
          "items": {
            "type": "object", "required": ["step_id", "rect_fpx", "reason"], "additionalProperties": false,
            "properties": { "step_id": { "$ref": "#/$defs/stepId" }, "rect_fpx": { "$ref": "#/$defs/rect" }, "reason": { "type": "string", "minLength": 1 } }
          }
        },
        "opt_ins_used": { "type": "array", "items": { "type": "string" } },
        "scope": {
          "type": "object", "required": ["unverified_steps", "acknowledged"], "additionalProperties": false,
          "properties": {
            "unverified_steps": { "type": "array", "items": { "$ref": "#/$defs/stepId" } },
            "acknowledged": { "type": "boolean" }
          }
        },
        "approved_route": { "type": "string", "minLength": 1 },
        "audio_exported": { "const": false }
      }
    },
    "a11yNode": {
      "type": "object", "required": ["role", "name"], "additionalProperties": false,
      "properties": {
        "role": { "type": "string" },
        "native_role": { "type": "string" },
        "name": { "$ref": "#/$defs/redactableText" },
        "automation_id": { "type": "string" },
        "ax_identifier": { "type": "string" },
        "bounds_fpx": { "$ref": "#/$defs/rect" },
        "is_password": { "type": "boolean" },
        "on_target_path": { "type": "boolean", "description": "true for the target and its ancestors; sibling names outside this path are withheld (§5.10)." },
        "children": { "type": "array", "items": { "$ref": "#/$defs/a11yNode" } }
      }
    },
    "a11ySnapshot": {
      "type": "object", "required": ["captured_at_ms", "window", "root", "truncated", "node_count"], "additionalProperties": false,
      "properties": {
        "captured_at_ms": { "$ref": "#/$defs/ms" },
        "window": {
          "type": "object", "required": ["role", "name"], "additionalProperties": false,
          "properties": { "role": { "type": "string" }, "name": { "$ref": "#/$defs/redactableText" }, "class_name": { "type": "string" } }
        },
        "root": { "$ref": "#/$defs/a11yNode" },
        "truncated": { "type": "boolean" },
        "node_count": { "type": "integer", "minimum": 1, "maximum": 300 }
      }
    }
  }
}
```

---

## 9. Output contract, derivation record and tenant profile

### 9.1 `process-spec-0.1.schema.json` (Claude's output, written to `.derived/`)

The semantic validator in `packages/spec` adds four rules the schema cannot express:
- **PS1** every step reference (`evidence`, `source_steps`, `produced_at`, `at`, `about_steps`, `loops[].step_ids`) exists in the package it names: a bare id in `package_ref`, a qualified `pkg_<ULID>#Sxx` in the matching `additional_package_refs` entry; `target.system_id` exists in that package's `manifest.systems`;
- **PS2** if **any** package step cited in a P-step's `evidence` has `boundary` other than `ok`/`not_assessed`, or the tag `do_not_automate`, the P-step is `automation.candidate: "human_only"`;
- **PS3** a branch condition whose provenance is not `user` is the literal `"unknown"`;
- **PS4** no string anywhere in `process_spec.json` contains a value the package redacted: the validator runs the high-precision detectors and the names-to-hide matcher over every string, and rejects any string that contains a `[CLASS]` token's original class pattern (for example a valid SA ID number, a card number, an email) or a literal that the package only carries as a placeholder. Placeholders (`{{param}}`) and class tokens (`[ORG_NAME]`) are allowed.

`action_class`, `target.system_id` and `target.control` exist so the acceptance scorer (§15) can match steps deterministically. CLAUDE_HANDOFF.md asks Claude to fill them from the package.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://handover.local/schemas/process-spec/0.1/process-spec.schema.json",
  "title": "Handover process spec v0.1",
  "type": "object",
  "required": ["spec_version", "package_ref", "process_key", "version", "title", "intent", "done_when", "trigger", "actors", "systems", "inputs", "outputs", "rules", "steps", "decisions", "exceptions", "gaps", "open_questions", "assumptions"],
  "additionalProperties": false,
  "$defs": {
    "stepId": {
      "description": "A package step id. Bare (S03) refers to package_ref; qualified (pkg_<ULID>#S03) refers to one of additional_package_refs, for a process family read from several packages.",
      "type": "string", "pattern": "^(pkg_[0-9A-HJKMNP-TV-Z]{26}#)?S[0-9]{2,4}$"
    },
    "provenance": { "enum": ["observed", "user", "inferred"] },
    "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
    "actionClass": { "enum": ["click", "select", "type", "copy", "paste", "navigate", "app_switch", "file_dialog", "inspect", "wait", "manual", "other"] },
    "packageRef": {
      "type": "object", "required": ["package_id", "manifest_sha256"], "additionalProperties": false,
      "properties": { "package_id": { "type": "string", "pattern": "^pkg_[0-9A-HJKMNP-TV-Z]{26}$" }, "manifest_sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" } }
    }
  },
  "properties": {
    "spec_version": { "const": "0.1" },
    "package_ref": { "$ref": "#/$defs/packageRef" },
    "additional_package_refs": { "type": "array", "items": { "$ref": "#/$defs/packageRef" } },
    "process_key": { "type": "string" },
    "version": { "type": "string", "pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+$" },
    "title": { "type": "string" },
    "intent": { "type": "string" },
    "done_when": { "type": "string" },
    "trigger": {
      "type": "object", "required": ["kind", "text", "provenance"], "additionalProperties": false,
      "properties": { "kind": { "type": "string" }, "text": { "type": "string" }, "provenance": { "$ref": "#/$defs/provenance" } }
    },
    "actors": { "type": "array", "items": { "type": "object", "required": ["position"], "additionalProperties": false, "properties": { "position": { "type": "string" } } } },
    "systems": {
      "type": "array",
      "items": {
        "type": "object", "required": ["system_id", "access_mode"], "additionalProperties": false,
        "properties": { "system_id": { "type": "string" }, "system_key_hint": { "type": "string" }, "access_mode": { "enum": ["native", "browser", "remote", "unknown"] } }
      }
    },
    "inputs": {
      "type": "array",
      "items": {
        "type": "object", "required": ["param_id", "value_type", "sensitivity", "source_steps"], "additionalProperties": false,
        "properties": {
          "param_id": { "type": "string" }, "value_type": { "type": "string" },
          "sensitivity": { "enum": ["low", "personal", "client_confidential", "special"] },
          "source_steps": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/stepId" } },
          "description": { "type": "string" }
        }
      }
    },
    "outputs": {
      "type": "array",
      "items": {
        "type": "object", "required": ["param_id", "produced_at"], "additionalProperties": false,
        "properties": { "param_id": { "type": "string" }, "produced_at": { "$ref": "#/$defs/stepId" }, "description": { "type": "string" } }
      }
    },
    "rules": {
      "type": "array",
      "items": {
        "type": "object", "required": ["text", "provenance", "source_annotation_ids"], "additionalProperties": false,
        "properties": { "text": { "type": "string" }, "provenance": { "$ref": "#/$defs/provenance" }, "source_annotation_ids": { "type": "array", "items": { "type": "string" } } }
      }
    },
    "steps": {
      "type": "array", "minItems": 1,
      "items": {
        "type": "object", "required": ["id", "intent", "action", "action_class", "target", "evidence", "provenance", "confidence", "boundary", "automation"], "additionalProperties": false,
        "properties": {
          "id": { "type": "string", "pattern": "^P[0-9]{2,4}$" },
          "intent": { "type": "string" },
          "action": { "type": "string" },
          "action_class": { "$ref": "#/$defs/actionClass" },
          "target": {
            "type": "object", "required": ["app", "system_id", "grounding", "locators"], "additionalProperties": false,
            "properties": {
              "app": { "type": "string" },
              "system_id": { "type": "string", "description": "The package's target.app.system_id for this step." },
              "control": {
                "type": "object", "required": ["role", "name"], "additionalProperties": false,
                "description": "The control acted on, as named in the package (redaction tokens kept as written).",
                "properties": { "role": { "type": "string" }, "name": { "type": "string" } }
              },
              "grounding": { "enum": ["accessibility", "accessibility_weak", "ocr", "user_described", "visual_only", "none"] },
              "locators": { "type": "array", "items": { "type": "string" } }
            }
          },
          "input_ref": { "type": "string" },
          "expected_result": { "type": "string" },
          "post_wait": { "type": "string" },
          "evidence": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/stepId" } },
          "provenance": { "$ref": "#/$defs/provenance" },
          "confidence": { "$ref": "#/$defs/confidence" },
          "boundary": { "enum": ["ok", "engagement_file_content", "system_of_record_write", "unknown", "not_assessed"] },
          "automation": {
            "type": "object", "required": ["candidate", "method", "confidence", "blockers"], "additionalProperties": false,
            "properties": {
              "candidate": { "enum": ["definition_read", "action_recipe", "event_trigger", "human_only", "unknown"] },
              "method": { "enum": ["api", "odbc_definition", "webhook", "browser", "ui_selector", "visual", "human"] },
              "confidence": { "$ref": "#/$defs/confidence" },
              "blockers": { "type": "array", "items": { "type": "string" } }
            }
          }
        }
      }
    },
    "decisions": {
      "type": "array",
      "items": {
        "type": "object", "required": ["at", "question", "branches"], "additionalProperties": false,
        "properties": {
          "at": { "$ref": "#/$defs/stepId" },
          "question": { "type": "string" },
          "branches": {
            "type": "array",
            "items": {
              "type": "object", "required": ["condition", "provenance", "observed"], "additionalProperties": false,
              "properties": { "condition": { "type": "string" }, "provenance": { "$ref": "#/$defs/provenance" }, "observed": { "type": "boolean" }, "next": { "type": "string" } }
            }
          }
        }
      }
    },
    "exceptions": {
      "type": "array",
      "items": {
        "type": "object", "required": ["text", "provenance", "evidence"], "additionalProperties": false,
        "properties": { "text": { "type": "string" }, "provenance": { "$ref": "#/$defs/provenance" }, "evidence": { "type": "array", "items": { "type": "string" } } }
      }
    },
    "gaps": {
      "type": "array",
      "items": {
        "type": "object", "required": ["between", "text"], "additionalProperties": false,
        "properties": { "between": { "type": "array", "items": { "type": "string" }, "minItems": 1, "maxItems": 2 }, "gap_id": { "type": "string" }, "text": { "type": "string" } }
      }
    },
    "open_questions": {
      "type": "array",
      "items": {
        "type": "object", "required": ["question", "blocks_automation", "about_steps"], "additionalProperties": false,
        "properties": {
          "question": { "type": "string" },
          "blocks_automation": { "enum": ["high", "medium", "low"] },
          "about_steps": { "type": "array", "items": { "$ref": "#/$defs/stepId" } }
        }
      }
    },
    "loops": {
      "type": "array",
      "items": {
        "type": "object", "required": ["unit", "step_ids", "provenance"], "additionalProperties": false,
        "properties": {
          "unit": { "type": "string" },
          "step_ids": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/stepId" } },
          "termination": { "type": "string" },
          "provenance": { "$ref": "#/$defs/provenance" }
        }
      }
    },
    "assumptions": { "type": "array", "items": { "type": "string" } }
  }
}
```

### 9.2 `derivation.json`

```json
{
  "package_id": "pkg_01JDX7Q9ZK3V8M2N4P6R8T0W2Y",
  "manifest_sha256": "0000000000000000000000000000000000000000000000000000000000000000",
  "mode": "agent",
  "model_id": "claude-opus-5-5",
  "route": "approved-route-v1",
  "prompt_sha256": "1111111111111111111111111111111111111111111111111111111111111111",
  "chunks": 1,
  "effort": "default",
  "home_claude_md": "disabled",
  "created_at": "2026-11-20T10:02:00+02:00",
  "tool": "handover-cli 0.1.0"
}
```

`mode` ∈ `agent` (a Claude Code session started in the parent folder that holds `<pkg>.handover/` and an empty `<pkg>.derived/`), `messages` (one Messages API request), `messages_chunked` (one request per chunk plus a text-only merge request; design §14.2).

**Who writes it.** Claude writes only `process_spec.json` and `narrative.md` into `<pkg>.derived/`. `derivation.json` is written afterwards by the harness (`handover spec` in Messages mode; the acceptance-4 harness or the user's `handover derive-record` step in agent mode), never by Claude. `prompt_sha256` is the sha256 of the bytes of `CLAUDE_HANDOFF.md` followed by one `\n` and the exact prompt string given to the session (agent mode) or of the serialised request body without image data (Messages mode). In agent mode the harness also records `model_id`, the effort level and whether any user-level CLAUDE.md was loaded (`"home_claude_md": "disabled"|"present"`; the acceptance harness requires `disabled`).

### 9.3 Tenant profile (`recorder/config/tenants/<tenant_id>.json`)

The recorder is generic. Anything tenant-specific (which systems are systems of record, which steps are always human-only, extra blocklist entries) lives in a tenant profile. The desktop app loads it through the managed policy; the spec validator loads the same file. The package records which profile was used (`manifest.tenant_profile`). The repo ships `default.json` (no systems of record, no boundary rules) and `moore.example.json`.

```json
{
  "tenant_id": "moore-example",
  "version": "0.1.0",
  "display_name": "Example audit firm",
  "systems": [
    { "system_key": "profsoft", "display_name": "ProfSoft", "match": { "process_names": ["ProfSoft.exe"], "bundle_ids": [], "url_origins": [], "window_title_contains": ["ProfSoft"] }, "is_system_of_record": true },
    { "system_key": "caseware", "display_name": "Caseware Working Papers", "match": { "process_names": ["CWIN32.exe"], "bundle_ids": [], "url_origins": [], "window_title_contains": [] }, "is_system_of_record": true },
    { "system_key": "quicklysign", "display_name": "QuicklySign", "match": { "process_names": [], "bundle_ids": [], "url_origins": ["https://app.quicklysign.com"], "window_title_contains": [] }, "is_system_of_record": false }
  ],
  "boundary_rules": [
    { "id": "no-sor-writes", "when": { "system_is_sor": true, "commit_like": true }, "boundary": "system_of_record_write" },
    { "id": "no-engagement-file-content", "when": { "system_key": "caseware" }, "boundary": "engagement_file_content" }
  ],
  "commit_like_names": ["save", "submit", "post", "ok", "apply", "finish", "send", "approve", "sign", "confirm"],
  "remote_gateway_url_patterns": ["/RDWeb/webclient", "client.wvd.microsoft.com", "windows.cloud.microsoft", ".cloud.com", "/Citrix/", "/guacamole"],
  "names_to_hide_file": null,
  "window_title_mode": "spans",
  "image_policy_max": "full_and_crop",
  "blocklist_additions": { "apps": [], "url_hosts": [] }
}
```

The process names above are placeholders. The real values come from Moore IT once ProfSoft's access mode is known (gate G1 in the plan). A remote ProfSoft is matched by `window_title_contains` on the remote client window. `default.json` has the same keys with no systems, no boundary rules, the default `commit_like_names` and `remote_gateway_url_patterns` above, and `names_to_hide_file: null`.

**Boundary emission (deterministic, implemented in `core/rules`).**
- No tenant profile loaded: every step is `boundary: not_assessed`, `boundary_source: none`.
- A profile is loaded and a boundary rule matches the step: the rule's `boundary`, `boundary_source: tenant_rule`.
- A profile is loaded and no rule matches: `boundary: ok`, `boundary_source: tenant_rule` (the profile was evaluated and found nothing).
- The user answered a boundary question (R13) or tagged `do_not_automate`: the user's answer wins, `boundary_source: user`.

**`commit_like`** is a closed predicate: the step's action is a click on `role: button` or `menuitem` whose normalised name (lower-case, trimmed, trailing punctuation removed) starts with one of `commit_like_names`; or a `screen_change`/`value_commit` step that carries an inferred `enter` or `ctrl+s` (`action.key_inference.keys`). R5, R13 and the boundary rules all use this one predicate.

**Other tenant keys.** `remote_gateway_url_patterns` drive the remote-in-browser classifier (design §9.6). `names_to_hide_file` points at an optional encrypted dictionary of client and person names maintained by IT (PRV-PII-04); the per-recording names list on the start sheet is merged with it. `window_title_mode` is `spans` (detector and names-list spans replaced, the default) or `whole` (the whole title is replaced by `[REDACTED]` except the app name; a tightening only). `image_policy_max` caps `manifest.media.image_policy` (a tenant may force `crop_only` or `text_only`).

---

## 10. Worked example: "Log a signed AFS on the lockdown register"

A synthetic run on Windows 11, standard image profile, by an admin assistant. Two displays: `d0` is the 1920×1080 primary at 100%; `d1` is a 2560×1440 display at 150% placed **left** of the primary (virtual-screen origin −2560, 0). QuicklySign and the AppSheet form run in Chrome on `d0`. ProfSoft runs inside a Remote Desktop window (`mstsc`) on `d1`, so S03 has no control data. Outlook was not in the capture scope, so a detour into it is a gap.

**All labels, coordinates and hashes are synthetic and illustrative.** They are not checked against the real QuicklySign, ProfSoft or AppSheet screens. Hash values are placeholders (repeated hex digits); L1a's golden fixture replaces them with real hashes.

The five steps exercise: a T3 click (S01); a highlight, a rule comment and a copy found through the clipboard counter with an inferred `ctrl+c` (S02); a decision in a remote window with `unavailable{reason: remote_session}`, a user description from an R4 prompt, an unverified scope the user acknowledged, and a search typed inside the remote window that the recorder blurred as `input_target_unknown` (S03); a gap; a redacted value whose lineage the user confirmed in an R3 prompt (S04); and a save with a system wait, an after frame and a readiness item the user skipped on purpose (S05). The client name was entered in the start sheet's names-to-hide list, so it is replaced in titles, control names and pixels wherever it appeared.

**Normative status.** This example is L1a's golden fixture. The positive blocks below MUST validate against §8 before any negative test runs (§14), and §11.2 is the byte-exact PROCESS.md for it.

**Arithmetic used below.**
- `d0` frames: scale 1456/1920 = 0.758333 → 1456×819, `est_tokens` = 52 × 30 = 1,560. Crop 800×500 logical px = 800×500 dpx at scale factor 1 → 606.7×379.2 fpx, output 800×500, `crop_scale` = 1/(0.758333 × 1.0) = 1.3187, crop tokens 29 × 18 = 522.
- `d1` frames: scale 1456/2560 = 0.56875 → 1456×819, 1,560 tokens. Crop 800×500 logical px = 1200×750 dpx at scale factor 1.5 → 682.5×426.6 fpx, downsampled to 800×500 output, `crop_scale` = 1/(0.56875 × 1.5) = 1.1722.
- Images: 7 full (S01, S02, S02 annotated, S03, S04, S05 before, S05 after) × 1,560 = 10,920; 5 crops × 522 = 2,610; total 12 images, 13,530 tokens.
- Time: duration 75,000 ms = task 51,500 + explain 9,500 + paused 14,000.

### 10.1 `manifest.json`

```json
{
  "format": "handover-package",
  "schema_version": "0.1",
  "package_id": "pkg_01JDX7Q9ZK3V8M2N4P6R8T0W2Y",
  "revision": { "rev": 1 },
  "created_at": "2026-11-20T09:14:03+02:00",
  "recorder": { "name": "handover", "version": "0.1.0", "os": "windows", "os_version": "Windows 11 24H2", "arch": "x64", "locale": "en-ZA" },
  "author": { "pseudonym": "user_7f3a", "position": "Admin assistant" },
  "actors": [ { "position": "Admin assistant", "role_in_process": "Records the signed date" } ],
  "tenant_profile": { "tenant_id": "moore-example", "version": "0.1.0", "sha256": "5555555555555555555555555555555555555555555555555555555555555555" },
  "process": {
    "title": "Log a signed AFS on the lockdown register",
    "process_key": "afs-signed-to-lockdown-register",
    "goal": "Start the 40-day and 60-day lockdown clocks for a signed AFS.",
    "done_when": "The lockdown register holds a saved entry with the AFS signed date for this pack.",
    "done_when_steps": ["S05"],
    "repeat": { "unit": "once", "provenance": "user" },
    "trigger": { "kind": "event", "text": "QuicklySign shows the AFS pack as Completed" },
    "frequency": "Several times a week; peaks after year-end sign-offs",
    "wrapup": {
      "next": "The partner reviews the lockdown list on Fridays.",
      "failure_modes": "Sometimes the pack is not an AFS; then I don't log it.",
      "run_kind": "normal"
    }
  },
  "systems": [
    { "system_id": "sys_quicklysign", "display_name": "QuicklySign", "app_ids": ["chrome"], "access_mode": "browser", "url_origins": ["https://app.quicklysign.com"], "evidence_summary": { "T3": 2, "T2": 0, "T1": 0, "T0": 0 }, "system_key_hint": "quicklysign", "is_system_of_record": false, "sor_source": "tenant_profile" },
    { "system_id": "sys_profsoft", "display_name": "ProfSoft (Remote Desktop)", "app_ids": ["mstsc"], "access_mode": "remote", "url_origins": [], "evidence_summary": { "T3": 0, "T2": 0, "T1": 0, "T0": 1 }, "system_key_hint": "profsoft", "is_system_of_record": true, "sor_source": "tenant_profile" },
    { "system_id": "sys_appsheet", "display_name": "AppSheet register form", "app_ids": ["chrome"], "access_mode": "browser", "url_origins": ["https://www.appsheet.com"], "evidence_summary": { "T3": 2, "T2": 0, "T1": 0, "T0": 0 }, "system_key_hint": "appsheet", "is_system_of_record": false, "sor_source": "unknown" }
  ],
  "recording": {
    "started_at": "2026-11-20T09:05:11+02:00",
    "ended_at": "2026-11-20T09:06:26+02:00",
    "timezone": "Africa/Johannesburg",
    "duration_ms": 75000,
    "task_ms": 51500,
    "explain_ms": 9500,
    "paused_ms": 14000,
    "step_count": 5,
    "chapters": [ { "chapter_id": "C1", "title": "Whole run", "from_step": "S01", "to_step": "S05" } ],
    "edited": true
  },
  "capture": {
    "session": "console",
    "scope": {
      "mode": "apps",
      "apps": [
        { "app_id": "chrome", "name": "Google Chrome", "bundle_or_exe": "chrome.exe" },
        { "app_id": "mstsc", "name": "Remote Desktop Connection", "bundle_or_exe": "mstsc.exe" }
      ],
      "blocklist_policy_sha256": "6666666666666666666666666666666666666666666666666666666666666666"
    },
    "capabilities": { "input_mouse": true, "a11y_hit": true, "a11y_snapshot": true, "capture_self_exclude": true, "capture_backend": "wgc", "scope_masking": "helper_mask", "ocr": "windows_ocr", "keyboard": "none" },
    "self_test": { "passed": true, "fallback": "none" }
  },
  "displays": [
    { "display_id": "d0", "global_space": "windows_virtual_px", "origin_global": [0, 0], "size_dpx": [1920, 1080], "scale_factor": 1.0, "primary": true },
    { "display_id": "d1", "global_space": "windows_virtual_px", "origin_global": [-2560, 0], "size_dpx": [2560, 1440], "scale_factor": 1.5, "primary": false }
  ],
  "media": { "image_profile": "standard", "image_policy": "full_and_crop", "max_long_edge": 1568, "max_tokens_per_image": 1568, "image_count": 12, "est_image_tokens_total": 13530, "format": "png", "video_included": false, "audio_included": false },
  "privacy": { "reviewed_by_user": true, "reviewed_at": "2026-11-20T09:13:40+02:00", "privacy_file": "privacy.json", "contains_personal_information": "redacted" },
  "readiness_summary": { "pass": 11, "warn": 1, "skipped_by_user": 1, "info": 0, "not_applicable": 4 },
  "files": [
    { "path": "README.txt", "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "bytes": 412, "role": "readme" },
    { "path": "CLAUDE_HANDOFF.md", "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "bytes": 4210, "role": "handoff" },
    { "path": "PROCESS.md", "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", "bytes": 2380, "role": "process_doc" },
    { "path": "steps-guide.html", "sha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", "bytes": 9120, "role": "steps_guide" },
    { "path": "steps.jsonl", "sha256": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", "bytes": 11840, "role": "steps" },
    { "path": "annotations.jsonl", "sha256": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", "bytes": 2210, "role": "annotations" },
    { "path": "gaps.jsonl", "sha256": "1212121212121212121212121212121212121212121212121212121212121212", "bytes": 230, "role": "gaps" },
    { "path": "prompts.jsonl", "sha256": "3434343434343434343434343434343434343434343434343434343434343434", "bytes": 980, "role": "prompts" },
    { "path": "dataflow.json", "sha256": "5656565656565656565656565656565656565656565656565656565656565656", "bytes": 1540, "role": "dataflow" },
    { "path": "readiness.json", "sha256": "7878787878787878787878787878787878787878787878787878787878787878", "bytes": 2050, "role": "readiness" },
    { "path": "privacy.json", "sha256": "9090909090909090909090909090909090909090909090909090909090909090", "bytes": 2630, "role": "privacy" },
    { "path": "media/S01_before_full.png", "sha256": "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1", "bytes": 201334, "role": "image" },
    { "path": "schema/handover-package-0.1.schema.json", "sha256": "b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2", "bytes": 40211, "role": "schema" }
  ]
}
```

(`files` is abridged here: the real manifest lists all 12 images, the four a11y snapshots and both schema files.)

### 10.2 `steps.jsonl`

In the file each step is one line. They are pretty-printed here for reading.

```json
{
  "step_id": "S01", "seq": 1, "kind": "action", "chapter_id": "C1", "t_start_ms": 4200, "t_end_ms": 5100,
  "phase": "Find the signed pack",
  "summary": "In QuicklySign, click View document on the completed AFS pack.",
  "summary_provenance": "observed",
  "observed_via": "pointer", "evidence_tier": "T3",
  "why": { "text": "The list only says the pack is complete; the signed date is on the document page.", "provenance": "user", "source_annotation_ids": ["ann_0001"] },
  "action": { "type": "click", "point_dpx": { "display_id": "d0", "xy": [1270, 553] }, "point_fpx": [963.1, 419.4] },
  "target": {
    "grounding": "accessibility", "grounding_source": "uia",
    "app": { "name": "Google Chrome", "process": "chrome.exe", "kind": "browser", "system_id": "sys_quicklysign" },
    "window": { "title": { "text": "Documents - QuicklySign - Google Chrome", "redacted": false } },
    "url": { "text": "https://app.quicklysign.com/documents", "redacted": false },
    "element": { "role": "link", "native_role": "ControlType.Hyperlink", "name": { "text": "View document", "redacted": false }, "is_password": false },
    "ancestry": [ { "role": "document", "name": "Documents - QuicklySign" }, { "role": "row", "name": "[ORG_NAME] AFS 2026" } ],
    "locators": [
      { "strategy": "role_name_path", "value": "document >> row >> link[name='View document']", "rank": 1, "stability": "medium" },
      { "strategy": "ocr_text", "value": "View document", "rank": 2, "stability": "medium" },
      { "strategy": "frame_point", "value": "963.1,419.4", "rank": 3, "stability": "low" }
    ],
    "display_id": "d0", "bounds_dpx": [1210, 540, 1330, 566], "bounds_fpx": [917.6, 409.5, 1008.6, 429.2],
    "a11y_snapshot": "a11y/S01.json"
  },
  "before": {
    "frame_id": "frm_0101", "t_ms": 4150, "display_id": "d0", "source_rect_dpx": [0, 0, 1920, 1080], "scale": 0.758333,
    "full": { "path": "media/S01_before_full.png", "width": 1456, "height": 819, "est_tokens": 1560, "variant": "full" },
    "crop": { "path": "media/S01_before_crop.png", "width": 800, "height": 500, "est_tokens": 522, "variant": "crop", "crop_origin_fpx": [659.8, 229.8], "crop_scale": 1.3187 },
    "redacted_regions_fpx": [[700.0, 405.0, 900.1, 433.0], [150.0, 38.0, 760.0, 58.0]], "masked_regions_fpx": []
  },
  "expected_result": { "text": "The QuicklySign document page opens.", "provenance": "observed" },
  "boundary": "ok", "boundary_source": "tenant_rule", "scope_verified": true,
  "annotation_ids": ["ann_0001"], "flags": ["contains_redaction"]
}
```

```json
{
  "step_id": "S02", "seq": 2, "kind": "action", "chapter_id": "C1", "t_start_ms": 9800, "t_end_ms": 21000, "explain_ms": 9500,
  "phase": "Find the signed pack",
  "summary": "On the document page, copy the Completed date.",
  "summary_provenance": "observed",
  "observed_via": "clipboard_change", "evidence_tier": "T3",
  "why": { "text": "The Completed date (when the last person signed) starts the 40-day clock; the date the email arrived does not.", "provenance": "user", "source_annotation_ids": ["ann_0003"] },
  "action": { "type": "copy", "key_inference": { "keys": "ctrl+c", "observed": false, "inferred_from": ["clipboard_change"] } },
  "target": {
    "grounding": "accessibility", "grounding_source": "uia",
    "app": { "name": "Google Chrome", "process": "chrome.exe", "kind": "browser", "system_id": "sys_quicklysign" },
    "window": { "title": { "text": "[ORG_NAME] AFS 2026 - QuicklySign - Google Chrome", "redacted": true, "classes": ["org_name"] } },
    "url": { "text": "https://app.quicklysign.com/documents/[ID]", "redacted": true, "classes": ["identifier"] },
    "element": { "role": "cell", "native_role": "ControlType.DataItem", "name": { "text": "Completed", "redacted": false }, "label": "Completed", "is_password": false },
    "ancestry": [ { "role": "document", "name": "[ORG_NAME] AFS 2026" }, { "role": "row", "name": "Completed" } ],
    "locators": [
      { "strategy": "role_name_path", "value": "document >> table >> row[name='Completed'] >> cell[2]", "rank": 1, "stability": "medium" },
      { "strategy": "label_relative", "value": "value right of label 'Completed'", "rank": 2, "stability": "medium" },
      { "strategy": "frame_point", "value": "852.4,314.8", "rank": 3, "stability": "low" }
    ],
    "display_id": "d0", "bounds_dpx": [1012, 402, 1236, 428], "bounds_fpx": [767.4, 304.9, 937.3, 324.6],
    "a11y_snapshot": "a11y/S02.json"
  },
  "before": {
    "frame_id": "frm_0201", "t_ms": 9900, "display_id": "d0", "source_rect_dpx": [0, 0, 1920, 1080], "scale": 0.758333,
    "full": { "path": "media/S02_before_full.png", "width": 1456, "height": 819, "est_tokens": 1560, "variant": "full" },
    "full_annotated": { "path": "media/S02_before_full_annotated.png", "width": 1456, "height": 819, "est_tokens": 1560, "variant": "full_annotated" },
    "crop": { "path": "media/S02_before_crop.png", "width": 800, "height": 500, "est_tokens": 522, "variant": "crop", "crop_origin_fpx": [549.0, 125.1], "crop_scale": 1.3187 },
    "redacted_regions_fpx": [[90.0, 45.5, 530.0, 66.7], [150.0, 38.0, 760.0, 58.0]], "masked_regions_fpx": []
  },
  "data": { "reads": ["afs_signed_date"] },
  "tags": ["rule"],
  "expected_result": { "text": "The Completed date is on the clipboard.", "provenance": "inferred" },
  "boundary": "ok", "boundary_source": "tenant_rule", "scope_verified": true,
  "annotation_ids": ["ann_0002", "ann_0003"], "flags": ["contains_redaction", "inferred_key"]
}
```

```json
{
  "step_id": "S03", "seq": 3, "kind": "decision", "chapter_id": "C1", "t_start_ms": 24000, "t_end_ms": 31500,
  "phase": "Check the engagement",
  "summary": "In ProfSoft (Remote Desktop), open the client's engagement and check the engagement type.",
  "summary_provenance": "user",
  "observed_via": "pointer", "evidence_tier": "T0",
  "why": { "text": "Only audits, independent reviews and compilations go on the register.", "provenance": "user", "source_annotation_ids": ["ann_0004", "ann_0006"], "prompt_ids": ["prm_0002"] },
  "action": { "type": "click", "point_dpx": { "display_id": "d1", "xy": [1500, 700] }, "point_fpx": [853.1, 398.1] },
  "target": {
    "grounding": "user_described", "grounding_source": "user",
    "unavailable": { "reason": "remote_session", "client": "mstsc" },
    "app": { "name": "Remote Desktop Connection", "process": "mstsc.exe", "kind": "remote_session", "system_id": "sys_profsoft" },
    "window": { "title": { "text": "[HOST] - Remote Desktop Connection", "redacted": true, "classes": ["hostname"] } },
    "locators": [
      { "strategy": "ocr_text", "value": "Engagement type", "rank": 1, "stability": "low" },
      { "strategy": "frame_point", "value": "853.1,398.1", "rank": 2, "stability": "low" }
    ],
    "display_id": "d1",
    "ocr_near": { "text": { "text": "Engagement type", "redacted": false }, "confidence": 0.71, "bounds_fpx": [819.0, 389.0, 921.4, 407.2] },
    "user_description": { "text": "The Engagement type column on the client's engagement row", "provenance": "user", "prompt_id": "prm_0001" }
  },
  "before": {
    "frame_id": "frm_0301", "t_ms": 23900, "display_id": "d1", "source_rect_dpx": [0, 0, 2560, 1440], "scale": 0.56875,
    "full": { "path": "media/S03_before_full.png", "width": 1456, "height": 819, "est_tokens": 1560, "variant": "full" },
    "crop": { "path": "media/S03_before_crop.png", "width": 800, "height": 500, "est_tokens": 522, "variant": "crop", "crop_origin_fpx": [511.9, 184.8], "crop_scale": 1.1722 },
    "redacted_regions_fpx": [[700.0, 370.0, 1100.0, 388.0], [560.0, 300.0, 900.0, 322.0]], "masked_regions_fpx": [[0.0, 0.0, 480.0, 819.0]]
  },
  "decision": {
    "question": "Is this pack for an audit, an independent review or a compilation?",
    "branch_taken": "Engagement type is Audit, Independent review or Compilation",
    "branch_taken_provenance": "observed",
    "branches": [
      { "condition": "Engagement type is Audit, Independent review or Compilation", "then": "Continue to S04", "observed": true, "provenance": "user" },
      { "condition": "Any other engagement type (for example a tax return)", "then": "Stop; do not log", "observed": false, "provenance": "user" }
    ]
  },
  "data": { "reads": ["engagement_type"] },
  "tags": ["decision"],
  "expected_result": { "text": "The engagement type is visible.", "provenance": "user" },
  "boundary": "ok", "boundary_source": "tenant_rule",
  "scope_verified": false, "scope_acknowledged": true, "input_ack": true,
  "annotation_ids": ["ann_0004", "ann_0005", "ann_0006", "ann_0009"], "prompt_ids": ["prm_0001", "prm_0002"],
  "flags": ["remote_session", "low_confidence_target", "contains_redaction", "input_target_unknown", "user_edited"]
}
```

```json
{
  "step_id": "S04", "seq": 4, "kind": "action", "chapter_id": "C1", "t_start_ms": 52500, "t_end_ms": 56800,
  "phase": "Fill in the register form",
  "summary": "In the AppSheet register form, enter the Completed date from S02 into AFS signed date.",
  "summary_provenance": "observed",
  "observed_via": "value_commit", "evidence_tier": "T3",
  "why": { "text": "The AFS signed date on the register starts the 40-day and 60-day lockdown clocks.", "provenance": "user", "source_annotation_ids": ["ann_0003"] },
  "action": {
    "type": "type",
    "value": { "disposition": "redacted", "placeholder": "{{afs_signed_date}}", "value_type": "date", "length_bucket": "unknown", "source": "typed", "copied_from_step": "S02", "copied_from_provenance": "user", "parameter": "afs_signed_date" }
  },
  "target": {
    "grounding": "accessibility", "grounding_source": "uia",
    "app": { "name": "Google Chrome", "process": "chrome.exe", "kind": "browser", "system_id": "sys_appsheet" },
    "window": { "title": { "text": "Lockdown register - AppSheet - Google Chrome", "redacted": false } },
    "url": { "text": "https://www.appsheet.com/start/[ID]", "redacted": true, "classes": ["identifier"] },
    "element": { "role": "textbox", "native_role": "ControlType.Edit", "name": { "text": "AFS signed date", "redacted": false }, "label": "AFS signed date", "is_password": false },
    "ancestry": [ { "role": "document", "name": "Lockdown register" }, { "role": "pane", "name": "Register form" } ],
    "locators": [
      { "strategy": "role_name_path", "value": "document >> pane[name='Register form'] >> textbox[name='AFS signed date']", "rank": 1, "stability": "high" },
      { "strategy": "ocr_text", "value": "AFS signed date", "rank": 2, "stability": "medium" },
      { "strategy": "frame_point", "value": "728.0,440.6", "rank": 3, "stability": "low" }
    ],
    "display_id": "d0", "bounds_dpx": [640, 560, 1280, 602], "bounds_fpx": [485.3, 424.7, 970.7, 456.5],
    "a11y_snapshot": "a11y/S04.json"
  },
  "before": {
    "frame_id": "frm_0401", "t_ms": 52400, "display_id": "d0", "source_rect_dpx": [0, 0, 1920, 1080], "scale": 0.758333,
    "full": { "path": "media/S04_before_full.png", "width": 1456, "height": 819, "est_tokens": 1560, "variant": "full" },
    "crop": { "path": "media/S04_before_crop.png", "width": 800, "height": 500, "est_tokens": 522, "variant": "crop", "crop_origin_fpx": [424.7, 251.0], "crop_scale": 1.3187 },
    "redacted_regions_fpx": [[150.0, 38.0, 760.0, 58.0]], "masked_regions_fpx": []
  },
  "data": { "writes": ["afs_signed_date"] },
  "tags": ["varies"],
  "expected_result": { "text": "AFS signed date holds the Completed date.", "provenance": "user" },
  "boundary": "ok", "boundary_source": "tenant_rule", "scope_verified": true,
  "annotation_ids": ["ann_0007"], "prompt_ids": ["prm_0003"], "flags": ["contains_redaction"]
}
```

```json
{
  "step_id": "S05", "seq": 5, "kind": "action", "chapter_id": "C1", "t_start_ms": 58100, "t_end_ms": 62600,
  "phase": "Fill in the register form",
  "summary": "Click Save and wait for the green Saved banner.",
  "summary_provenance": "observed",
  "observed_via": "pointer", "evidence_tier": "T3",
  "action": { "type": "click", "point_dpx": { "display_id": "d0", "xy": [1230, 920] }, "point_fpx": [932.8, 697.7] },
  "target": {
    "grounding": "accessibility", "grounding_source": "uia",
    "app": { "name": "Google Chrome", "process": "chrome.exe", "kind": "browser", "system_id": "sys_appsheet" },
    "window": { "title": { "text": "Lockdown register - AppSheet - Google Chrome", "redacted": false } },
    "url": { "text": "https://www.appsheet.com/start/[ID]", "redacted": true, "classes": ["identifier"] },
    "element": { "role": "button", "native_role": "ControlType.Button", "name": { "text": "Save", "redacted": false }, "is_password": false },
    "ancestry": [ { "role": "document", "name": "Lockdown register" }, { "role": "pane", "name": "Register form" } ],
    "locators": [
      { "strategy": "role_name_path", "value": "document >> pane[name='Register form'] >> button[name='Save']", "rank": 1, "stability": "high" },
      { "strategy": "ocr_text", "value": "Save", "rank": 2, "stability": "medium" },
      { "strategy": "frame_point", "value": "932.8,697.7", "rank": 3, "stability": "low" }
    ],
    "display_id": "d0", "bounds_dpx": [1180, 900, 1280, 940], "bounds_fpx": [894.8, 682.5, 970.7, 712.8],
    "a11y_snapshot": "a11y/S05.json"
  },
  "before": {
    "frame_id": "frm_0501", "t_ms": 58000, "display_id": "d0", "source_rect_dpx": [0, 0, 1920, 1080], "scale": 0.758333,
    "full": { "path": "media/S05_before_full.png", "width": 1456, "height": 819, "est_tokens": 1560, "variant": "full" },
    "crop": { "path": "media/S05_before_crop.png", "width": 800, "height": 500, "est_tokens": 522, "variant": "crop", "crop_origin_fpx": [629.4, 439.8], "crop_scale": 1.3187 },
    "redacted_regions_fpx": [[150.0, 38.0, 760.0, 58.0], [485.3, 424.7, 970.7, 456.5]], "masked_regions_fpx": []
  },
  "after": {
    "frame_id": "frm_0502", "t_ms": 62700, "display_id": "d0", "source_rect_dpx": [0, 0, 1920, 1080], "scale": 0.758333,
    "full": { "path": "media/S05_after_full.png", "width": 1456, "height": 819, "est_tokens": 1560, "variant": "full" },
    "redacted_regions_fpx": [[150.0, 38.0, 760.0, 58.0]], "masked_regions_fpx": []
  },
  "post_wait": { "duration_ms": 2300, "kind": "system", "until": "A green Saved banner appears at the top of the form" },
  "data": { "writes": ["register_entry"] },
  "tags": ["verify"],
  "expected_result": { "text": "A Saved banner appears and the form clears.", "provenance": "observed" },
  "boundary": "ok", "boundary_source": "tenant_rule", "scope_verified": true,
  "annotation_ids": ["ann_0008"], "flags": ["contains_redaction"]
}
```

S05's `before` frame blurs the date field because the typed value is visible there (PRV-KEY-03). Every browser frame (S01, S02, S04, S05) burns in the address bar (`address_bar_default`); the reduced URL is in `target.url`. S03's second redacted region is the remote search box: after the click into the remote window, the helper reported `event.remote_input_suspected` for the changed region, the core blurred it and flagged the step `input_target_unknown`, and the user acknowledged it in review (`input_ack`). Every step's boundary is `ok`/`tenant_rule` because the moore-example profile was evaluated and no boundary rule matched (S03 is a read in a system of record, not a commit-like click).

### 10.3 `annotations.jsonl`

```jsonl
{"annotation_id":"ann_0001","kind":"narration","t_ms":3000,"t_end_ms":5600,"provenance":"user","step_ids":["S01"],"anchor":"time_aligned","anchor_confidence":0.92,"text":"The list only tells me it's done, I need to open the pack to see the date.","redacted":false}
{"annotation_id":"ann_0002","kind":"highlight","t_ms":11400,"provenance":"user","step_ids":["S02"],"anchor":"explicit","mark":"H1","shape":"rect","frame_id":"frm_0201","geometry_fpx":[[760.0,298.0],[945.0,331.0]],"snapped_to":{"role":"cell","name":"Completed","bounds_fpx":[767.4,304.9,937.3,324.6],"grounding":"accessibility"},"linked_annotation_ids":["ann_0003"]}
{"annotation_id":"ann_0003","kind":"comment","t_ms":12100,"provenance":"user","step_ids":["S02"],"anchor":"explicit","source":"typed","tags":["rule"],"text":"Use this Completed date (when the last person signed), not the date the email arrived. This date starts the 40-day clock.","linked_annotation_ids":["ann_0002"]}
{"annotation_id":"ann_0004","kind":"narration","t_ms":24500,"t_end_ms":30200,"provenance":"user","step_ids":["S03"],"anchor":"time_aligned","anchor_confidence":0.88,"text":"We only put audits, independent reviews and compilations on the register, so if it's a tax return I stop here.","redacted":false}
{"annotation_id":"ann_0005","kind":"comment","t_ms":26000,"provenance":"user","step_ids":["S03"],"anchor":"explicit","source":"prompt","prompt_id":"prm_0001","text":"The Engagement type column on the client's engagement row"}
{"annotation_id":"ann_0006","kind":"comment","t_ms":24000,"provenance":"user","step_ids":["S03"],"anchor":"explicit","source":"prompt","prompt_id":"prm_0002","tags":["decision"],"follow_up":{"question":"What decides which way you go?","answer":"The engagement type in ProfSoft."},"text":"It depends on the engagement type: audit, independent review or compilation go on the register; anything else does not."}
{"annotation_id":"ann_0007","kind":"comment","t_ms":52500,"provenance":"user","step_ids":["S04"],"anchor":"explicit","source":"prompt","prompt_id":"prm_0003","tags":["varies"],"follow_up":{"question":"What should we call it?","answer":"AFS signed date"},"text":"Copied from the QuicklySign Completed date (S02)."}
{"annotation_id":"ann_0008","kind":"comment","t_ms":63000,"provenance":"user","step_ids":["S05"],"anchor":"explicit","source":"typed","tags":["exception"],"text":"Sometimes Save spins for a long time. Wait for the green Saved banner before closing, otherwise it does not go through."}
{"annotation_id":"ann_0009","kind":"comment","t_ms":24000,"provenance":"user","step_ids":["S03"],"anchor":"explicit","source":"review","text":"I find the engagement in ProfSoft by searching the client name from the QuicklySign pack title."}
```

### 10.4 `gaps.jsonl`

```jsonl
{"gap_id":"gap_0001","t_start_ms":31800,"t_end_ms":38000,"reason":"out_of_scope_app","after_step":"S03","before_step":"S04","app_hint":{"name":"Outlook"},"user_note":{"text":"Checked the partner's email about this client. Not part of the process.","provenance":"user"},"acknowledged":true}
{"gap_id":"gap_0002","t_start_ms":38000,"t_end_ms":52000,"reason":"user_paused","after_step":"S03","before_step":"S04","acknowledged":true}
```

### 10.5 `prompts.jsonl`

Only one prompt was shown live (the budget allows at most one per 60 s of task time). The other two were answered in review.

```jsonl
{"prompt_id":"prm_0001","rule_id":"R4","t_ms":26000,"step_id":"S03","question":"This window is a remote screen, so I can only see the picture. What did you just click?","chips":["'Engagement type'?","Describe it","Skip"],"outcome":"answered","answer":{"chip":"Describe it","text":"The Engagement type column on the client's engagement row","via":"typed"},"annotation_id":"ann_0005"}
{"prompt_id":"prm_0002","rule_id":"R2","t_ms":24000,"step_id":"S03","question":"How do you decide whether this pack goes on the register?","chips":["Always","It depends on…","Skip"],"outcome":"answered_in_review","answer":{"chip":"It depends on…","text":"It depends on the engagement type: audit, independent review or compilation go on the register; anything else does not.","via":"typed"},"annotation_id":"ann_0006"}
{"prompt_id":"prm_0003","rule_id":"R3","t_ms":52500,"step_id":"S04","question":"You copied something in QuicklySign and then changed 'AFS signed date' in AppSheet. Did it come from there?","chips":["Yes, from S02 'Completed'","It depends…","Skip"],"outcome":"answered_in_review","answer":{"chip":"Yes, from S02 'Completed'","via":"chip"},"annotation_id":"ann_0007"}
```

### 10.6 `dataflow.json`

```json
{
  "parameters": [
    {
      "param_id": "afs_signed_date", "kind": "input", "label": "AFS signed date", "value_type": "date", "sensitivity": "low",
      "sources": [ { "step_id": "S02", "how": "copied", "where": "QuicklySign › document page › cell 'Completed'", "provenance": "user", "annotation_id": "ann_0007", "prompt_id": "prm_0003" } ],
      "sinks": [ { "step_id": "S04", "how": "typed", "where": "AppSheet › Register form › textbox 'AFS signed date'", "provenance": "observed" } ]
    },
    {
      "param_id": "engagement_type", "kind": "constant_or_choice", "label": "Engagement type", "value_type": "option", "sensitivity": "low",
      "sources": [ { "step_id": "S03", "how": "read", "where": "ProfSoft › engagement row › Engagement type column", "provenance": "user", "annotation_id": "ann_0005" } ],
      "sinks": [],
      "decision_step": "S03"
    },
    {
      "param_id": "register_entry", "kind": "output", "label": "Lockdown register entry", "value_type": "record", "sensitivity": "client_confidential",
      "sources": [ { "step_id": "S05", "how": "computed_by_system", "where": "AppSheet › Save", "provenance": "observed" } ],
      "sinks": []
    }
  ],
  "entities": [
    {
      "entity_id": "client", "label": "Client", "ontology_type_hint": "Client",
      "appears_in": [
        { "step_id": "S01", "where": "QuicklySign document row" },
        { "step_id": "S02", "where": "document page title" },
        { "step_id": "S03", "where": "ProfSoft engagement row" }
      ],
      "join_hint": { "text": "I find the engagement in ProfSoft by searching the client name from the QuicklySign pack title.", "provenance": "user", "annotation_id": "ann_0009" }
    }
  ],
  "outputs": [ { "param_id": "register_entry", "produced_at": "S05", "evidence": "After frame of S05 shows the green Saved banner." } ]
}
```

### 10.7 `readiness.json`

```json
{
  "rules_version": "0.1.0",
  "evaluated_at": "2026-11-20T09:13:38+02:00",
  "results": [
    { "rule_id": "R1", "severity": "warn", "status": "pass", "step_ids": [], "message": "Goal, done-when and trigger are present." },
    { "rule_id": "R2", "severity": "warn", "status": "pass", "step_ids": ["S03"], "message": "The decision at S03 has a user-stated condition." },
    { "rule_id": "R3", "severity": "warn", "status": "pass", "step_ids": ["S04"], "message": "The value at S04 has a parameter and a confirmed source." },
    { "rule_id": "R4", "severity": "warn", "status": "pass", "step_ids": ["S03"], "message": "The remote-screen click at S03 is described by the user." },
    { "rule_id": "R5", "severity": "warn", "status": "skipped_by_user", "step_ids": ["S05"], "message": "S05 has no 'why' (S01-S04 have one).", "user_note": "Saving is obvious." },
    { "rule_id": "R6", "severity": "warn", "status": "not_applicable", "step_ids": [], "message": "No wait longer than 3 s." },
    { "rule_id": "R7", "severity": "block", "status": "pass", "step_ids": [], "message": "No unresolved detections and no special personal information." },
    { "rule_id": "R8", "severity": "warn", "status": "pass", "step_ids": [], "message": "Both gaps are acknowledged." },
    { "rule_id": "R9", "severity": "warn", "status": "pass", "step_ids": ["S02"], "message": "Highlight H1 has a comment." },
    { "rule_id": "R10", "severity": "warn", "status": "pass", "step_ids": ["S05"], "message": "The last step has an after frame." },
    { "rule_id": "R11", "severity": "info", "status": "not_applicable", "step_ids": [], "message": "No switch to an email or chat app inside the scope." },
    { "rule_id": "R12", "severity": "warn", "status": "not_applicable", "step_ids": [], "message": "No error dialog or undo." },
    { "rule_id": "R13", "severity": "warn", "status": "not_applicable", "step_ids": [], "message": "No commit-like click in a system of record." },
    { "rule_id": "R14", "severity": "warn", "status": "pass", "step_ids": [], "message": "Wrap-up answered." },
    { "rule_id": "R15", "severity": "block", "status": "pass", "step_ids": ["S03"], "message": "S03 (unverified scope, possible typing in a remote window) was acknowledged." },
    { "rule_id": "R16", "severity": "warn", "status": "pass", "step_ids": ["S05"], "message": "Done-when is made true at S05; the AFS signed date reaches a sink at S04." },
    { "rule_id": "R17", "severity": "warn", "status": "warn", "step_ids": ["S04"], "message": "afs_signed_date moves from QuicklySign to AppSheet with no format recorded. Show Claude the format?" }
  ]
}
```

### 10.8 `privacy.json`

```json
{
  "package_id": "pkg_01JDX7Q9ZK3V8M2N4P6R8T0W2Y",
  "tool_version": "0.1.0",
  "policy": { "version": "default-za-0.1", "sha256": "7777777777777777777777777777777777777777777777777777777777777777", "managed": false },
  "reviewer_pseudonym": "user_7f3a",
  "exported_at": { "local": "2026-11-20T09:14:03+02:00", "utc": "2026-11-20T07:14:03Z", "timezone": "Africa/Johannesburg" },
  "attestation": { "ticked": true, "text": "I have reviewed every step. This package contains only what is needed to understand the process. Client and personal details are removed, or I am authorised to share them." },
  "gate": { "every_step_viewed": true, "unresolved_detections": 0, "blocking_flags": 0, "preview_hash_matched": true, "pre_write_verifier": "passed" },
  "detectors": [
    { "id": "names_to_hide", "version": "0.1.0", "precision": "high" },
    { "id": "sa_id_luhn", "version": "0.1.0", "precision": "high" },
    { "id": "payment_card_luhn", "version": "0.1.0", "precision": "high" },
    { "id": "sars_tax_ref", "version": "0.1.0", "precision": "high" },
    { "id": "sa_vat", "version": "0.1.0", "precision": "high" },
    { "id": "email", "version": "0.1.0", "precision": "high" },
    { "id": "za_phone", "version": "0.1.0", "precision": "high" },
    { "id": "bank_account", "version": "0.1.0", "precision": "medium" },
    { "id": "company_reg", "version": "0.1.0", "precision": "medium" },
    { "id": "person_name", "version": "0.1.0", "precision": "medium" },
    { "id": "special_pi_keywords", "version": "0.1.0", "precision": "special" }
  ],
  "redactions": [
    { "redaction_id": "red_0001", "class": "org_name", "rule": "user_redact", "channel": "pixels", "step_id": "S01", "location": { "rect_fpx": [700.0, 405.0, 900.1, 433.0], "image": "media/S01_before_full.png" } },
    { "redaction_id": "red_0002", "class": "org_name", "rule": "names_to_hide", "channel": "window_title", "step_id": "S02", "location": { "json_pointer": "/target/window/title/text", "file": "steps.jsonl#S02" } },
    { "redaction_id": "red_0003", "class": "identifier", "rule": "url_id_segment", "channel": "url", "step_id": "S02", "location": { "json_pointer": "/target/url/text", "file": "steps.jsonl#S02" } },
    { "redaction_id": "red_0004", "class": "org_name", "rule": "names_to_hide", "channel": "pixels", "step_id": "S02", "location": { "rect_fpx": [90.0, 45.5, 530.0, 66.7], "image": "media/S02_before_full.png" } },
    { "redaction_id": "red_0005", "class": "org_name", "rule": "user_redact_everywhere", "channel": "pixels", "step_id": "S03", "location": { "rect_fpx": [700.0, 370.0, 1100.0, 388.0], "image": "media/S03_before_full.png" } },
    { "redaction_id": "red_0006", "class": "hostname", "rule": "window_title_default", "channel": "window_title", "step_id": "S03", "location": { "json_pointer": "/target/window/title/text", "file": "steps.jsonl#S03" } },
    { "redaction_id": "red_0007", "class": "identifier", "rule": "address_bar_default", "channel": "pixels", "step_id": "S04", "location": { "rect_fpx": [150.0, 38.0, 760.0, 58.0], "image": "media/S04_before_full.png" } },
    { "redaction_id": "red_0008", "class": "typed_field", "rule": "prv_key_03_typed_field", "channel": "pixels", "step_id": "S05", "location": { "rect_fpx": [485.3, 424.7, 970.7, 456.5], "image": "media/S05_before_full.png" } },
    { "redaction_id": "red_0009", "class": "identifier", "rule": "url_id_segment", "channel": "url", "step_id": "S04", "location": { "json_pointer": "/target/url/text", "file": "steps.jsonl#S04" } },
    { "redaction_id": "red_0010", "class": "identifier", "rule": "address_bar_default", "channel": "pixels", "step_id": "S05", "location": { "rect_fpx": [150.0, 38.0, 760.0, 58.0], "image": "media/S05_before_full.png" } },
    { "redaction_id": "red_0011", "class": "identifier", "rule": "url_id_segment", "channel": "url", "step_id": "S05", "location": { "json_pointer": "/target/url/text", "file": "steps.jsonl#S05" } },
    { "redaction_id": "red_0012", "class": "identifier", "rule": "address_bar_default", "channel": "pixels", "step_id": "S01", "location": { "rect_fpx": [150.0, 38.0, 760.0, 58.0], "image": "media/S01_before_full.png" } },
    { "redaction_id": "red_0013", "class": "identifier", "rule": "address_bar_default", "channel": "pixels", "step_id": "S02", "location": { "rect_fpx": [150.0, 38.0, 760.0, 58.0], "image": "media/S02_before_full.png" } },
    { "redaction_id": "red_0014", "class": "org_name", "rule": "names_to_hide", "channel": "control_name", "step_id": "S01", "location": { "json_pointer": "/target/ancestry/1/name", "file": "steps.jsonl#S01" } },
    { "redaction_id": "red_0015", "class": "org_name", "rule": "names_to_hide", "channel": "control_name", "step_id": "S02", "location": { "json_pointer": "/target/ancestry/0/name", "file": "steps.jsonl#S02" } },
    { "redaction_id": "red_0016", "class": "typed_field", "rule": "remote_input_suspected", "channel": "pixels", "step_id": "S03", "location": { "rect_fpx": [560.0, 300.0, 900.0, 322.0], "image": "media/S03_before_full.png" } },
    { "redaction_id": "red_0017", "class": "org_name", "rule": "names_to_hide", "channel": "a11y_snapshot", "step_id": "S02", "location": { "json_pointer": "/window/name/text", "file": "a11y/S02.json" } },
    { "redaction_id": "red_0018", "class": "org_name", "rule": "names_to_hide", "channel": "a11y_snapshot", "step_id": "S02", "location": { "json_pointer": "/root/name/text", "file": "a11y/S02.json" } },
    { "redaction_id": "red_0019", "class": "sibling_text", "rule": "a11y_sibling_default", "channel": "a11y_snapshot", "step_id": "S02", "location": { "json_pointer": "/root/children/0/children/1/name/text", "file": "a11y/S02.json" } }
  ],
  "counts_by_class": { "org_name": 8, "identifier": 7, "hostname": 1, "typed_field": 2, "sibling_text": 1 },
  "masked": [ { "step_id": "S03", "reason": "out_of_scope_app", "count": 1 } ],
  "unblurred": [],
  "opt_ins_used": [],
  "scope": { "unverified_steps": ["S03"], "acknowledged": true },
  "approved_route": "Commercial-Terms organisation; workspace restricted to US processing; zero data retention requested; Opus 5.5 or Sonnet 5.5 only; no Files API, Batch or MCP for packages. Pending Moore sign-off S9.",
  "audio_exported": false
}
```

Following the one-record-per-(step, channel, class, region) rule, `red_0010` also covers the address bar in `media/S05_after_full.png` and `red_0008` covers the field in S05's crop. Only S02's a11y file is shown (§10.9); in the golden fixture the a11y files of S01, S04 and S05 add their own `a11y_snapshot` records, and `counts_by_class` always equals the number of records per class (V17).

### 10.9 `a11y/S02.json`

```json
{
  "captured_at_ms": 9900,
  "window": { "role": "window", "name": { "text": "[ORG_NAME] AFS 2026 - QuicklySign - Google Chrome", "redacted": true, "classes": ["org_name"] }, "class_name": "Chrome_WidgetWin_1" },
  "root": {
    "role": "document", "name": { "text": "[ORG_NAME] AFS 2026", "redacted": true, "classes": ["org_name"] }, "on_target_path": true,
    "children": [
      {
        "role": "table", "native_role": "ControlType.Table", "name": { "text": "Signing summary", "redacted": false }, "on_target_path": true,
        "children": [
          {
            "role": "row", "name": { "text": "Completed", "redacted": false }, "on_target_path": true,
            "children": [
              { "role": "cell", "native_role": "ControlType.DataItem", "name": { "text": "Completed", "redacted": false }, "bounds_fpx": [767.4, 304.9, 937.3, 324.6], "is_password": false, "on_target_path": true }
            ]
          },
          { "role": "row", "name": { "text": "[ROW_TEXT]", "redacted": true, "classes": ["sibling_text"] }, "on_target_path": false }
        ]
      }
    ]
  },
  "truncated": false,
  "node_count": 5
}
```

---

## 11. PROCESS.md

### 11.1 Template

Rendered by deterministic code in `@handover/core` (no model) from the already-redacted package data, so it can never emit a redacted value. **§11.2 is normative:** it is the exact output for the worked example, and L1d's golden fixture is byte-equal to it. The rules below say how every line is produced. LF line endings, UTF-8, no trailing spaces, file ends with one `\n`. Blank lines: one after the header block; every `##` heading other than `## Steps` is followed directly by its list; `## Steps`, each `###` heading, each step block, the `**Decision at …**` line and each decision table are separated by exactly one blank line.

**Formats.** Durations under 60 s: one decimal and ` s` (`51.5 s`, `14.0 s`); from 60 s: `<m> min <s> s` with whole seconds. Dates: the `YYYY-MM-DD` of `recording.started_at` in its own offset. A URL in a Where line drops its scheme. Text fields are copied verbatim (they are already redacted). Citations are written in backticks as `` `[<provenance>, <ids…>]` `` with ids in the order: `source_annotation_ids`, then `prompt_ids`; with no ids, `` `[<provenance>]` ``.

**Header** (always):
```
# <process.title>
> Goal: <goal> · Done when: <done_when>
> Trigger: <trigger.text> · Systems: <display_name> (<access_mode>), … (manifest order)
> Recorded <date> (<timezone>) by <author.position> · <n> steps · <task time> task time · package <package_id>
```

**`## Before you start`**, one line each, in this order, each only when it has content:
1. `- Inputs: ` parameters of kind `input`, file order, comma-joined, each `{{<param_id>}} (<value_type>; <how> from <first source step_id>)`.
2. `- Choices: ` parameters of kind `constant_or_choice`, each `{{<param_id>}} (<value_type>; <how> from <first source step_id>[; decision at <decision_step>])`.
3. `- Outputs: ` each `outputs[]` entry as `{{<param_id>}} (<value_type>; produced at <produced_at>)`.
4. `- Entities: ` each entity as `<label> (appears in <step ids, comma-joined>[; matched across systems: "<join_hint.text>" <citation of join_hint>])`.
5. `- Repeats: <phrase>` followed by the citation for `user`, from `process.repeat` (`once` → "once per trigger", `per_client` → "once for each client", `per_row` → "once for each row", `per_document` → "once for each document", `other` → `unit_text`).
6. `- Done when made true at: <done_when_steps, comma-joined>` followed by the citation for `user`.
7. `- Systems of record touched: <display_name> (<step ids>), …. Writes to these stay with a person.` for systems with `is_system_of_record: true` that have ≥ 1 step.

**`## Steps`.** With one chapter, steps are grouped under `### <phase>` headings (a new heading whenever `phase` differs from the previous step's); a step without a phase goes under `### Steps`. With several chapters, each chapter gets `### Chapter <chapter_id>: <title>` and phases become `####`.

Each step starts with the line `**<step_id>. <prefix><summary>**<marks> `[<summary_provenance>]` · evidence <tier><tier note>`, where `<prefix>` is `Decision: ` for kind `decision`, `<marks>` is ` (H1, H2)` when the step has highlight annotations, and `<tier note>` is ` (<target.unavailable.reason>)` for T0/T1. Then these lines, in this order, each only when its condition holds:

| Line | Condition | Content |
|---|---|---|
| `- Where:` | action or decision step | `accessibility*`: `<app.name> › <url without scheme, else window.title.text> › <element.role> "<element.name.text>" (<grounding>)`. `user_described`: `<app.name> › "<user_description.text>" (described by the user[; OCR saw "<ocr_near.text>"])`. `ocr`: `<app.name> › near text "<ocr_near.text>" (ocr, confidence <2 decimals>)`. `visual_only`/`none`: `<app.name> › point <x>,<y> in <before full or crop path> (pixels only)`. Manual: `off screen` |
| `- How:` | `action.key_inference` present | `<action.type> (<keys> inferred from <inferred_from, comma-joined>; not observed)` |
| `- Value:` | `action.value` present | `<placeholder, or literal in quotes, or "not captured"> (<value_type>; source <source>[; copied from <copied_from_step> `[<copied_from_provenance>]`])` |
| `- Why:` | `why` present | `<why.text> <citation>` |
| `- Data:` | `data` present | `reads {{a}}, {{b}}` and/or `writes {{c}}`, joined by ` · ` |
| `- Wait:` | `post_wait` present | `<duration> (<kind>)[ until <until>]` |
| `- Result:` | `expected_result` present | `<text> `[<provenance>]`` |
| `- Boundary:` | boundary ∉ {`ok`, `not_assessed`} or tag `do_not_automate` | `<boundary> (<boundary_source>)[; do not automate]` |
| `- Note (<tags or "comment">):` | one line per comment annotation in `annotation_ids` that is not cited by `why.source_annotation_ids` and is not the prompt answer behind `target.user_description` | `"<text>" `[<provenance>, <annotation_id>]``; tags comma-joined |
| `- Images:` | images exist | paths in order: before full, before full annotated, before crop, after full |

For a decision step, after its lines: a blank line, `**Decision at <step_id>:** <question>`, a blank line, then the table `| If | Then | Seen in this recording |`, its separator row, and one row per branch: `| <condition> | <then, or "unknown"> | yes |` when `observed`, else `| … | … | no (<provenance>) |`.

**`## What the recorder could not see`**, in this order:
1. per gap: `- <gap_id> (<after_step> → <before_step>): <reason phrase>[ (<app_hint.name>)], <duration>.[ User note: "<text>"]`. A missing neighbour is written `start` or `end`.
2. per T0/T1 step: `- <step_id>: <reason phrase> (<unavailable.reason>); the target is <"the user's description" for user_described | "text recognised near the click" for ocr | "pixels only">.`
3. per step flagged `input_target_unknown`: `- <step_id>: possible typing in a remote or unknown window was blurred (input_target_unknown; acknowledged by the user).`
4. per step with a Boundary line: `- <step_id>: stays with a person (<boundary>).`

Reason phrases (fixed copy, shared with the review UI): `user_paused` "paused by the user"; `idle_paused` "paused after 5 minutes idle"; `lock_paused` "paused while the screen was locked"; `sleep_paused` "paused while the computer slept"; `user_switch_paused` "paused while another user was active"; `screensaver_paused` "paused during the screensaver"; `out_of_scope_app` "an app outside the recording scope"; `excluded_app` "an excluded app"; `excluded_url` "an excluded website"; `private_window` "a private browser window"; `elevated_window` "an administrator window the recorder cannot see into"; `secure_desktop` "a Windows security prompt"; `hook_lost` "clicks were not being captured"; `helper_restart` "the recorder's helper restarted"; `capture_lost` "screen capture was lost"; `capture_masking_failed` "the screen was blanked because scope masking failed"; `permission_lost` "a permission was revoked"; `system_dialog_not_captured` "a system dialog that could not be captured"; unavailable `remote_session` "remote screen"; `opaque_toolkit` "an app that exposes no controls"; `no_pointer_target` "no control was identified"; others: the code with `_` replaced by spaces.

**`## Open questions (generated)`**, in this order:
1. readiness results with status `warn` or `skipped_by_user`, in rule order: `- <message>` plus ` (skipped by the user: "<user_note>")` when skipped;
2. per decision branch with `observed: false`, in step order: `- <step_id>: branch "<condition>" was described but not observed.`;
3. per step whose `summary_provenance`, `why.provenance` or `expected_result.provenance` is `inferred`, in step order: `- <step_id>: <summary|why|expected result> is inferred, not stated by the user.`

### 11.2 Rendered for the worked example

```markdown
# Log a signed AFS on the lockdown register
> Goal: Start the 40-day and 60-day lockdown clocks for a signed AFS. · Done when: The lockdown register holds a saved entry with the AFS signed date for this pack.
> Trigger: QuicklySign shows the AFS pack as Completed · Systems: QuicklySign (browser), ProfSoft (Remote Desktop) (remote), AppSheet register form (browser)
> Recorded 2026-11-20 (Africa/Johannesburg) by Admin assistant · 5 steps · 51.5 s task time · package pkg_01JDX7Q9ZK3V8M2N4P6R8T0W2Y

## Before you start
- Inputs: {{afs_signed_date}} (date; copied from S02)
- Choices: {{engagement_type}} (option; read from S03; decision at S03)
- Outputs: {{register_entry}} (record; produced at S05)
- Entities: Client (appears in S01, S02, S03; matched across systems: "I find the engagement in ProfSoft by searching the client name from the QuicklySign pack title." `[user, ann_0009]`)
- Repeats: once per trigger `[user]`
- Done when made true at: S05 `[user]`
- Systems of record touched: ProfSoft (Remote Desktop) (S03). Writes to these stay with a person.

## Steps

### Find the signed pack

**S01. In QuicklySign, click View document on the completed AFS pack.** `[observed]` · evidence T3
- Where: Google Chrome › app.quicklysign.com/documents › link "View document" (accessibility)
- Why: The list only says the pack is complete; the signed date is on the document page. `[user, ann_0001]`
- Result: The QuicklySign document page opens. `[observed]`
- Images: media/S01_before_full.png, media/S01_before_crop.png

**S02. On the document page, copy the Completed date.** (H1) `[observed]` · evidence T3
- Where: Google Chrome › app.quicklysign.com/documents/[ID] › cell "Completed" (accessibility)
- How: copy (ctrl+c inferred from clipboard_change; not observed)
- Why: The Completed date (when the last person signed) starts the 40-day clock; the date the email arrived does not. `[user, ann_0003]`
- Data: reads {{afs_signed_date}}
- Result: The Completed date is on the clipboard. `[inferred]`
- Images: media/S02_before_full.png, media/S02_before_full_annotated.png, media/S02_before_crop.png

### Check the engagement

**S03. Decision: In ProfSoft (Remote Desktop), open the client's engagement and check the engagement type.** `[user]` · evidence T0 (remote_session)
- Where: Remote Desktop Connection › "The Engagement type column on the client's engagement row" (described by the user; OCR saw "Engagement type")
- Why: Only audits, independent reviews and compilations go on the register. `[user, ann_0004, ann_0006, prm_0002]`
- Data: reads {{engagement_type}}
- Result: The engagement type is visible. `[user]`
- Note (comment): "I find the engagement in ProfSoft by searching the client name from the QuicklySign pack title." `[user, ann_0009]`
- Images: media/S03_before_full.png, media/S03_before_crop.png

**Decision at S03:** Is this pack for an audit, an independent review or a compilation?

| If | Then | Seen in this recording |
|---|---|---|
| Engagement type is Audit, Independent review or Compilation | Continue to S04 | yes |
| Any other engagement type (for example a tax return) | Stop; do not log | no (user) |

### Fill in the register form

**S04. In the AppSheet register form, enter the Completed date from S02 into AFS signed date.** `[observed]` · evidence T3
- Where: Google Chrome › www.appsheet.com/start/[ID] › textbox "AFS signed date" (accessibility)
- Value: {{afs_signed_date}} (date; source typed; copied from S02 `[user]`)
- Why: The AFS signed date on the register starts the 40-day and 60-day lockdown clocks. `[user, ann_0003]`
- Data: writes {{afs_signed_date}}
- Result: AFS signed date holds the Completed date. `[user]`
- Note (varies): "Copied from the QuicklySign Completed date (S02)." `[user, ann_0007]`
- Images: media/S04_before_full.png, media/S04_before_crop.png

**S05. Click Save and wait for the green Saved banner.** `[observed]` · evidence T3
- Where: Google Chrome › www.appsheet.com/start/[ID] › button "Save" (accessibility)
- Data: writes {{register_entry}}
- Wait: 2.3 s (system) until A green Saved banner appears at the top of the form
- Result: A Saved banner appears and the form clears. `[observed]`
- Note (exception): "Sometimes Save spins for a long time. Wait for the green Saved banner before closing, otherwise it does not go through." `[user, ann_0008]`
- Images: media/S05_before_full.png, media/S05_before_crop.png, media/S05_after_full.png

## What the recorder could not see
- gap_0001 (S03 → S04): an app outside the recording scope (Outlook), 6.2 s. User note: "Checked the partner's email about this client. Not part of the process."
- gap_0002 (S03 → S04): paused by the user, 14.0 s.
- S03: remote screen (remote_session); the target is the user's description.
- S03: possible typing in a remote or unknown window was blurred (input_target_unknown; acknowledged by the user).

## Open questions (generated)
- S05 has no 'why' (S01-S04 have one). (skipped by the user: "Saving is obvious.")
- afs_signed_date moves from QuicklySign to AppSheet with no format recorded. Show Claude the format?
- S03: branch "Any other engagement type (for example a tax return)" was described but not observed.
- S02: expected result is inferred, not stated by the user.
```

---

## 12. CLAUDE_HANDOFF.md template

Placeholders in `<angle brackets>` are filled by the generator. Everything else is fixed text.

```markdown
# Handoff: recorded process "<process.title>"

You are reading a recording of one person doing a task on their computer. They reviewed and
redacted it on their own machine before export. Your job is to understand the process exactly as
performed and explained, and to produce a process specification that an automation engineer
(human or agent) could implement without watching the recording.

## Read in this order
1. manifest.json: goal, done-when, trigger, systems (note each system's access_mode and
   evidence_summary), actors, capture scope and capabilities, displays.
2. PROCESS.md: the readable outline. Treat it as an index, not as ground truth.
3. steps.jsonl: the ground truth, one step per line. Every claim you make must cite step ids (S01…).
4. annotations.jsonl: the person's highlights (H1…), comments and narration. Comments, prompt
   answers and explicitly anchored highlights are the strongest evidence of intent. Narration is
   time-aligned and may belong to a neighbouring step (see anchor_confidence).
5. dataflow.json: the process inputs, where each value was read and where it was written, and how
   the person matches records across systems (join_hint).
6. gaps.jsonl: intervals the recorder did not see. prompts.jsonl: questions the recorder asked and
   the answers. readiness.json: what the person filled in, skipped on purpose, or left open.
7. Images, only when you need them, as manifest.media.image_policy allows:
   - full_and_crop: media/<step>_before_crop.png to see the target, media/<step>_before_full*.png
     for context;
   - crop_only: only media/<step>_before_crop.png exists; there are no full frames;
   - text_only: there are no images; work from the text files and say so where it matters.
   Coordinates ending in _fpx are in the step's frame space (pixels of *_full.png when it exists);
   crop pixels map back with crop_origin_fpx and crop_scale. a11y/<step>.json holds the control
   tree near the target; names shown as [ROW_TEXT] were withheld on purpose.

## Rules
- Label every statement [observed] (in steps or images), [user] (said, typed or chosen by the
  person) or [inferred] (your reasoning). Never present an inference as observed.
- Do not invent steps. Intervals in gaps.jsonl were not observed: do not put steps inside them.
  List them under "gaps" with the step ids on either side and the person's note, if any.
- Values shown as {{placeholder}} or a [CLASS] token such as [ORG_NAME] were removed on purpose.
  Treat placeholders as parameters (see dataflow.json); class tokens name redacted data, not
  parameters. Never guess or write the real value anywhere in your output.
- This is one recorded run. Variants the person did not perform or describe are unknown: list
  them as open questions, do not invent them. A repeat (manifest.process.repeat) or loop is only
  stated if the person stated it.
- A blurred region is deliberate redaction, not missing UI. A masked region was outside the
  recording scope.
- evidence_tier tells you how far to trust a target: T3 real control, T2 weak control, T1 text
  recognised near the click, T0 pixels or the person's description only. For T0/T1 steps describe
  the target by visible text and position and say so. target.unavailable.reason says why.
- Shortcuts in action.key_inference were inferred, not observed. Say so if you rely on them.
- Decisions: state a branch condition only if the person stated it (provenance "user"); otherwise
  write "unknown" and add an open question.
- Respect boundaries: a step with boundary other than "ok"/"not_assessed", or the tag
  do_not_automate, is automation.candidate "human_only". Do not propose UI automation that writes
  to a system marked is_system_of_record.
- Times are milliseconds from recording start; the timezone is manifest.recording.timezone.

## Produce
Write your files into the folder next to this package whose name ends in .derived instead of
.handover (<slug>__<package_id>.derived/). Never write inside this package folder.
1. process_spec.json, valid against schema/process-spec-0.1.schema.json. Every step needs
   "evidence" step ids, an "action_class", and "target.system_id" copied from the cited step;
   add "target.control" {role, name} exactly as the cited step names it. Prefer an API, webhook
   or read-only data definition over UI automation when the recording shows the information
   exists in a system (say why). If you were given several packages of the same process_key,
   put the others in "additional_package_refs" and cite their steps as pkg_<id>#Sxx.
2. narrative.md: a short plain-language narrative for a non-technical reader.
Do not write derivation.json; the tool that started this session records it.
3. Open questions for the person, ranked by how much they block automation (inside
   process_spec.json).
4. Gaps and risks: steps unsafe to automate (irreversible, regulatory, judgement calls).
Quote the comment, prompt answer or narration you relied on for every "why".
```

---

## 13. `steps-guide.html`

A self-contained HTML file (inline CSS, images referenced relatively from `media/`, no scripts, no network) rendered by the same code from the same redacted data as PROCESS.md. It is the user's immediate reward: a clean illustrated guide they can hand to a junior colleague, the thing Windows Steps Recorder used to produce. It is byte-deterministic like every other text file.

**Fixed skeleton (normative).** Element order and class names are exactly as below; an element is emitted only when its data exists; text is HTML-escaped; two-space indentation, one element per line, LF, no trailing spaces. The stylesheet is the fixed file `core/src/generators/steps-guide.css`, inlined verbatim. Sections follow the PROCESS.md grouping (§11.1) and use the same strings (summary, why, notes, decision rows, gap lines).

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{process.title} · Steps guide</title>
  <style>{steps-guide.css}</style>
</head>
<body>
  <header class="hg-header">
    <p class="hg-banner">CONFIDENTIAL – {tenant display name} internal. Reviewed and redacted by its author.</p>
    <h1>{process.title}</h1>
    <dl class="hg-meta">
      <dt>Goal</dt><dd>{goal}</dd>
      <dt>Done when</dt><dd>{done_when}</dd>
      <dt>Trigger</dt><dd>{trigger.text}</dd>
      <dt>Systems</dt><dd>{display_name (access_mode), …}</dd>
    </dl>
  </header>
  <main>
    <section class="hg-phase">
      <h2>{phase}</h2>
      <article class="hg-step" id="{step_id}">
        <h3><span class="hg-num">{step_id}</span> {prefix}{summary}</h3>
        <figure class="hg-full"><img src="{before full_annotated, else full}" alt="{step_id}: screen before the action" width="{w}" height="{h}"></figure>
        <figure class="hg-crop"><img src="{before crop}" alt="{step_id}: close-up of the target" width="{w}" height="{h}"></figure>
        <p class="hg-why">{why.text}</p>
        <ul class="hg-notes">
          <li>{note text}</li>
        </ul>
        <p class="hg-tags">{tags, comma-joined}</p>
        <table class="hg-decision">
          <tr><th>If</th><th>Then</th><th>Seen in this recording</th></tr>
          <tr><td>{condition}</td><td>{then}</td><td>{yes | no (provenance)}</td></tr>
        </table>
        <figure class="hg-after"><img src="{after full}" alt="{step_id}: result" width="{w}" height="{h}"></figure>
      </article>
    </section>
    <aside class="hg-gaps">
      <h2>What was not recorded</h2>
      <ul>
        <li>{gap line}</li>
      </ul>
    </aside>
  </main>
</body>
</html>
```

---

## 14. Negative tests (L1a acceptance)

**Order.** First, every positive block of §10 MUST validate (manifest, every step, annotation, gap and prompt line, dataflow, readiness, privacy, `a11y/S02.json`), and `handover validate` MUST pass the golden folder. Only then do the negative tests run. Each MUST be rejected by the schema (S) or the semantic validator (V). For S tests the assertion is that the Ajv error set (options from §8, `allErrors: true`, ignoring the generic `must match "then" schema` wrapper) contains **exactly** the listed `schemaPath` and parameter and nothing from an unrelated rule; paths are as Ajv reports them, relative to the `$defs` entry the mutated object validates against (or the `$ref` target named in the path). N1–N13, N23–N26 and N28 were run with these exact results in the 2026-11-21 review.

| # | Mutation of the worked example | Validated as | Rejected by | Expected error |
|---|---|---|---|---|
| N1 | ann_0002 (highlight) without `mark` | annotation | S | `#/allOf/0/then/required` missingProperty `mark` |
| N2 | ann_0003 (comment) without `anchor` | annotation | S | `#/allOf/1/then/required` missingProperty `anchor` |
| N3 | ann_0001 with provenance `"guessed"` | annotation | S | `#/$defs/provenance/enum` |
| N4 | S04's redacted value that also carries `literal` | step | S | `#/allOf/1/then/not` (in `valueRecord`) |
| N5 | S01 without `evidence_tier` | step | S | `#/allOf/0/then/required` missingProperty `evidence_tier` |
| N6 | S03 with `grounding: "visual_only"` and no `unavailable` | step | S | `#/allOf/1/then/required` missingProperty `unavailable` (in `target`) |
| N7 | S03 without `user_description` | step | S | `#/allOf/3/then/required` missingProperty `user_description` (in `target`) |
| N8 | S03 without `scope_acknowledged` | step | S | `#/allOf/3/then/required` missingProperty `scope_acknowledged` |
| N9 | R7 (block) with `status: "skipped_by_user"` | readiness | S | `#/properties/results/items/then/properties/status/enum` |
| N10 | S02 `key_inference.observed: true` | step | S | `#/$defs/keyInference/properties/observed/const` |
| N11 | `media.audio_included: true` | manifest | S | `#/properties/media/properties/audio_included/const` |
| N12 | gap_0001 with reason `excluded_app` still carrying `app_hint` | gap | S | `#/then/not` |
| N13 | prm_0001 (answered) without `annotation_id` | prompt | S | `#/then/required` missingProperty `annotation_id` |
| N14 | `value.parameter` naming a parameter absent from `dataflow.json` | package | V15 | |
| N15 | `step_count` of 6 with 5 lines | package | V2 | |
| N16 | `est_tokens` of 1500 on a 1456×819 image | package | V4 | |
| N17 | `bounds_fpx` that disagrees with `bounds_dpx` × scale by 5 px | package | V6 | |
| N18 | S01 `evidence_tier: "T1"` while grounding is `accessibility` | package | V7 | |
| N19 | A step whose interval intersects `gap_0002`'s | package | V10 | |
| N20 | `task_ms` of 50000 (sum no longer equals `duration_ms`) | package | V12 | |
| N21 | `annotation_ids` pointing at `ann_0099` | package | V1 | |
| N22 | A `literal` value that is a valid synthetic SA ID number | package | V8 (minimal detector in `packages/schema`) | |
| N23 | S03 without `input_ack` (it is flagged `input_target_unknown`) | step | S | `#/allOf/4/then/required` missingProperty `input_ack` |
| N24 | ann_0001 (narration) given `source: "prompt"` and no `prompt_id` | annotation | S | `#/allOf/3/then/required` missingProperty `prompt_id` |
| N25 | `files[0].path` = `../outside.png` | manifest | S + V3 | `#/properties/files/items/properties/path/pattern` |
| N26 | ann_0002 (rect) with a third point | annotation | S | `#/allOf/4/then/properties/geometry_fpx/maxItems` |
| N27 | `gap_0002.t_start_ms` = 37000 (intersects gap_0001) | package | V10 | |
| N28 | `systems[0].app_ids` = `["chrome.exe"]` | manifest | S | `#/$defs/appId/not` |
| N29 | `counts_by_class.org_name` = 7 while 8 records exist | package | V17 | |
| N30 | a P-step citing S03 (boundary forced to `system_of_record_write`) with `automation.candidate: "action_recipe"` | process spec | PS2 | |

**Positive edge tests** (MUST validate): the unmodified worked example, whose gaps touch at 38000 (half-open intervals); ann_0001 and ann_0004 (narration with no `source`, no `prompt_id`); a step with no `flags` and no `input_ack`.

---

## 15. Reference SOP and the acceptance scorer

Acceptance 4 ("a fresh Claude given only the package rebuilds the steps of a known test process") is measured against a **reference SOP** written before the process is recorded, by a deterministic, network-free scorer (`handover score`, in `packages/spec`). L1a owns this schema; the scorer and the reference SOPs are written in the format gate (plan L1a2), before any product recording exists.

### 15.1 `reference-sop-0.1.schema.json`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://handover.local/schemas/reference-sop/0.1/reference-sop.schema.json",
  "title": "Handover reference SOP v0.1 (acceptance ground truth, written before recording)",
  "type": "object",
  "required": ["ref_version", "process_key", "title", "written_before_recording", "done_when_keywords", "steps", "decisions", "rules", "parameters", "join_hints"],
  "additionalProperties": false,
  "$defs": {
    "refStepId": { "type": "string", "pattern": "^RS[0-9]{2,3}$" },
    "keywords": { "type": "array", "minItems": 1, "items": { "type": "string", "minLength": 1 } },
    "actionClass": { "enum": ["click", "select", "type", "copy", "paste", "navigate", "app_switch", "file_dialog", "inspect", "wait", "manual", "other"] }
  },
  "properties": {
    "ref_version": { "const": "0.1" },
    "process_key": { "type": "string", "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$" },
    "title": { "type": "string", "minLength": 1 },
    "written_before_recording": { "type": "string", "format": "date-time" },
    "done_when_keywords": { "$ref": "#/$defs/keywords" },
    "steps": {
      "type": "array", "minItems": 1,
      "items": {
        "type": "object", "required": ["ref_step_id", "system_key", "action_class", "control"], "additionalProperties": false,
        "properties": {
          "ref_step_id": { "$ref": "#/$defs/refStepId" },
          "system_key": { "type": "string" },
          "action_class": { "$ref": "#/$defs/actionClass" },
          "control": {
            "type": "object", "required": ["role", "name"], "additionalProperties": false,
            "properties": { "role": { "type": "string" }, "name": { "type": "string" }, "name_aliases": { "type": "array", "items": { "type": "string" } } }
          },
          "parameter": { "type": "string" },
          "may_merge_with": { "type": "array", "items": { "$ref": "#/$defs/refStepId" } },
          "may_split": { "type": "boolean" },
          "optional": { "type": "boolean" },
          "remote": { "type": "boolean" },
          "note": { "type": "string" }
        }
      }
    },
    "decisions": {
      "type": "array",
      "items": {
        "type": "object", "required": ["at", "branches"], "additionalProperties": false,
        "properties": {
          "at": { "$ref": "#/$defs/refStepId" },
          "branches": {
            "type": "array", "minItems": 1,
            "items": {
              "type": "object", "required": ["keywords", "observed", "user_stated"], "additionalProperties": false,
              "properties": { "keywords": { "$ref": "#/$defs/keywords" }, "observed": { "type": "boolean" }, "user_stated": { "type": "boolean" } }
            }
          }
        }
      }
    },
    "rules": {
      "type": "array",
      "items": {
        "type": "object", "required": ["rule_id", "text", "keywords"], "additionalProperties": false,
        "properties": { "rule_id": { "type": "string", "pattern": "^RR[0-9]{2}$" }, "text": { "type": "string" }, "keywords": { "$ref": "#/$defs/keywords" } }
      }
    },
    "parameters": {
      "type": "array",
      "items": {
        "type": "object", "required": ["param_id", "source_system_key", "sink_system_keys"], "additionalProperties": false,
        "properties": {
          "param_id": { "type": "string" },
          "aliases": { "type": "array", "items": { "type": "string" } },
          "source_system_key": { "type": "string" },
          "sink_system_keys": { "type": "array", "items": { "type": "string" } }
        }
      }
    },
    "join_hints": {
      "type": "array",
      "items": {
        "type": "object", "required": ["text", "keywords"], "additionalProperties": false,
        "properties": { "text": { "type": "string" }, "keywords": { "$ref": "#/$defs/keywords" } }
      }
    }
  }
}
```

### 15.2 Matching and metrics (deterministic)

**Normalisation** `norm(s)`: Unicode NFKD, strip diacritics, lower-case, replace every character that is not a letter, digit or space with a space, collapse spaces, trim. `contains_all(text, keywords)` is true when `norm(text)` contains `norm(k)` as a whole-word sequence for every keyword.

**Resolving a P-step.** For P-step *p*, `sys(p)` = the `system_key_hint` of the package system whose `system_id` equals `p.target.system_id` (for a qualified evidence id, in that package).

**Match predicate** `m(p, r)` is true when all hold:
1. `sys(p) == r.system_key`;
2. `p.action_class == r.action_class`, or the pair is one of the equivalences {`click`, `select`} or {`type`, `paste`};
3. control: `norm(p.target.control.name)` equals `norm(r.control.name)` or one of `name_aliases`, or one contains the other and the shorter has ≥ 4 characters; **or** `r.parameter` is set and `p.input_ref` names that parameter (normalised, or one of the reference parameter's `aliases`).

**Assignment.** Walk P-steps in order. For each P-step pick the earliest reference step with `m(p, r)` that is still unmatched, or that is matched but has `may_split: true`. A P-step matched to *r* also covers every step listed in `r.may_merge_with` that `m` accepts for that P-step (one P-step for several reference steps). Each P-step is matched at most once. **Optional override:** `--matches <file>` reads a `matches.json` `{pairs:[{p, r, confirmed_by, note}]}` produced outside the scorer (for example by an LLM judge) and confirmed by a named person; those pairs are applied first, every other pair is decided by `m`, and the score output lists which pairs came from the file. The scorer never calls a model and never opens a socket.

**Metrics** (all reported; the acceptance bars are in the plan, L5):
| Metric | Formula |
|---|---|
| Step precision | matched P-steps ÷ all P-steps |
| Step recall | matched non-optional reference steps ÷ non-optional reference steps |
| Step F1 | harmonic mean of the two |
| Order inversions | pairs of matched P-steps (i < j) whose first matched reference indices are in the reverse order |
| App + control correct | among matched pairs whose `action_class` is not `wait`/`manual`, the share where `sys(p)` equals `r.system_key` **and** the control name matches (rule 3, first half) |
| Evidence validity | share of P-steps whose every evidence id resolves (PS1) |
| Unflagged invented steps | unmatched P-steps whose `provenance` is not `inferred` |
| Guessed values | PS4 violations over the whole spec |
| Decisions recovered | user-stated reference branches with a process-spec decision at a P-step matched to `at`, having a branch whose condition `contains_all` the branch keywords |
| Rules recovered | reference rules for which some `process_spec.rules[].text` `contains_all` the keywords |
| Join hints recovered | reference join hints whose keywords all appear in some string of the spec |
| Lineage recovered | reference parameters with a spec input whose `param_id` matches (normalised or alias) and whose `source_steps` include a step in `source_system_key` |
| Done-when coverage | `process_spec.done_when` `contains_all` `done_when_keywords` |
| Image-policy ablation | the same metrics for packages rendered with `image_policy` `crop_only` and `text_only` (`handover render --image-policy`), reported side by side |

### 15.3 Reference SOP for the worked example

```json
{
  "ref_version": "0.1",
  "process_key": "afs-signed-to-lockdown-register",
  "title": "Log a signed AFS on the lockdown register",
  "written_before_recording": "2026-11-19T15:00:00+02:00",
  "done_when_keywords": ["register", "AFS signed date"],
  "steps": [
    { "ref_step_id": "RS01", "system_key": "quicklysign", "action_class": "click", "control": { "role": "link", "name": "View document" } },
    { "ref_step_id": "RS02", "system_key": "quicklysign", "action_class": "copy", "control": { "role": "cell", "name": "Completed" }, "parameter": "afs_signed_date" },
    { "ref_step_id": "RS03", "system_key": "profsoft", "action_class": "type", "control": { "role": "textbox", "name": "Search" }, "optional": true, "remote": true, "note": "The search inside the remote window is blurred and folded into the decision step; credit it if it appears." },
    { "ref_step_id": "RS04", "system_key": "profsoft", "action_class": "inspect", "control": { "role": "cell", "name": "Engagement type" }, "remote": true },
    { "ref_step_id": "RS05", "system_key": "appsheet", "action_class": "type", "control": { "role": "textbox", "name": "AFS signed date" }, "parameter": "afs_signed_date" },
    { "ref_step_id": "RS06", "system_key": "appsheet", "action_class": "click", "control": { "role": "button", "name": "Save" } }
  ],
  "decisions": [
    { "at": "RS04", "branches": [
      { "keywords": ["audit", "independent review", "compilation"], "observed": true, "user_stated": true },
      { "keywords": ["other"], "observed": false, "user_stated": true }
    ] }
  ],
  "rules": [
    { "rule_id": "RR01", "text": "Use the QuicklySign Completed date, not the date the email arrived.", "keywords": ["completed", "email"] },
    { "rule_id": "RR02", "text": "Wait for the green Saved banner before closing.", "keywords": ["saved", "banner"] }
  ],
  "parameters": [
    { "param_id": "afs_signed_date", "aliases": ["AFS signed date", "signed date"], "source_system_key": "quicklysign", "sink_system_keys": ["appsheet"] }
  ],
  "join_hints": [
    { "text": "Find the engagement in ProfSoft by searching the client name from the pack title.", "keywords": ["client name", "title"] }
  ]
}
```

`system_key_hint` is how the scorer maps a package system to a reference `system_key`; when a system has no hint, `sys(p)` is its `system_id` without the `sys_` prefix.

