# Recording package format for Claude (research: llm-output-format)

- **Date:** 2026-11-21
- **Status:** Research for the planner. This is a proposal, not a decision.
- **Scope:** The format of the exported, user-reviewed package that a fresh Claude reads to understand a recorded desktop process and turn it into an automation spec for Superbrain. Capture internals, overlay UX and packaging are other lanes. They appear here only where the format puts a requirement on them.
- **Working format name:** Workflow Recording Package (WRP), exported as a folder or a `.wrp.zip`. The planner names the product.

---

## 0. Summary

The package is built for an agent that reads files: Claude Code, a Managed Agents session, or a skill. That agent reads text first and opens images only when it needs them, in the same way Agent Skills disclose content in stages. A packer script also turns the same files into a single Messages API request for consumers that have no filesystem.

The recommendations, each traced to evidence in section 2:

1. **Make steps the unit, and give every step text, structure and pixels.** WONDERBREAD measured SOP generation from demonstrations. GPT-4's step F1 went from 0.49 (intent only) to 0.71 (intent plus keyframes) to 0.82 (intent plus keyframes plus action trace), and Claude 3 Sonnet's went from 0.50 to 0.70 to 0.76 [E, WONDERBREAD Table 3]. Each step therefore carries a one-line summary, a structured action and target, and a full frame plus a crop.
2. **Pre-resize every exported image to the standard-tier envelope:** at most 1,568 px on the long edge and at most 1,568 visual tokens. A 1920x1080 frame becomes 1456x819, which costs 1,560 tokens and works on every current model. Coordinates then map 1:1 to the stored image. Crops around the target are cut at native resolution (800x500 screen px, 522 tokens) so that small text stays legible. Images are never left to the API to resize.
3. **Store a coordinate transform per frame.** UIA reports physical screen pixels, a Retina capture is 2x logical points, and Claude answers in pixels of the image it was given. Every geometry field states which of these spaces it uses.
4. **Make the target a ranked bundle of locators with a stated grounding level** (`accessibility`, `dom`, `ocr` or `visual_only`). Microsoft documents that AutomationId "is not guaranteed to be stable across different releases or builds" and that Name "cannot be used as a unique identifier among siblings" [P]. Inside a Citrix or RDP window the recorder sees no controls at all [S]. A single "control id" field would therefore be wrong.
5. **Model annotations as three kinds:** `highlight` (a region, snapped to a control when possible, drawn on the image with a mark such as `H1` in the Set-of-Mark style), `comment` (typed at a pause and explicitly anchored), and `narration` (speech, aligned by timestamp, with a confidence). Matching speech to steps is fuzzy, and the format says so.
6. **Tag every assertion with its provenance** (`observed`, `user` or `inferred`) and cite step ids in PROCESS.md and in Claude's output. WONDERBREAD found that models' recall beat their precision because they "hallucinate workflow steps" [E]. Citations make an invented step visible.
7. **Never ship values that were redacted, but always ship what kind of value went where:** field, value type, shape and source (typed, pasted, selected, or copied from step S02). Those become the parameters of the automation. Window titles, URLs, element names, transcripts and audio carry personal information too, and are redacted by the same rules as pixels.
8. **Follow Anthropic's published prompt layout:** long material at the top and the request at the end ("up to 30 percent" better on complex multi-document inputs), XML-tagged documents, images introduced by a text label, and the instruction text placed before the image it concerns [P/E].
9. **Keep session packages immutable.** A merged process (its variants) is a separate file derived from them that points back to session and step ids. Alignment uses step signatures. Variants are then classified as core, optional, alternative (XOR), repeated (loop) and unordered (AND).
10. **Score acceptance check 4 with step precision and recall** against a reference SOP written before the recording, plus checks on target accuracy, cited evidence and placeholder handling (section 8).

---

## 1. Evidence tiers

Each factual claim carries a tag:

| Tag | Meaning |
|---|---|
| **[P]** | Primary text I read directly on 2026-11-21, in the relevant sections (the vision, coordinates, prompting-best-practices and Agent Skills pages on platform.claude.com, and the Microsoft Learn UIA property page). Long pages were read by section and search, not cover to cover |
| **[E]** | Extracted from a primary source by the fetch tool's summariser. Probably right, but I did not read every line (OCEL 2.0 JSON keys, WONDERBREAD tables, parts of the computer-use page, the Abb & Rehse model) |
| **[S]** | Search-result snippet only. I did not open the source (XES 2023 extensions, Mind2Web, OmniACT, AgentNet, Set-of-Mark, DITA, macOS AX, Citrix and RPA behaviour) |
| **[R]** | From my own recall, unverified today |
| **[I]** | My inference or design proposal |
| **[C]** | Computed today with Anthropic's published reference resize implementation |

---

## 2. Findings

### 2.1 Claude vision limits and costs [P]

Source: https://platform.claude.com/docs/en/build-with-claude/vision and .../vision-coordinates, read 2026-11-21.

| Fact | Value |
|---|---|
| Formats | JPEG, PNG, GIF, WebP. Animation unsupported; only the first frame is used |
| Images per request | 20 per message on claude.ai; 100 per API request for 200k-context models; 600 for all other models |
| Max dimensions | 8000x8000 px |
| Many-image rule | When a request holds **more than 20 images**, a stricter per-image limit applies to every image, including images resent from earlier turns and images inside `tool_result`. The doc's portable advice is: "resize each image so that neither dimension exceeds 3,000 px, or keep the request to 20 or fewer image and document blocks" |
| Max size per image | 10 MB base64 on the Claude API, 5 MB on Bedrock. Total request limit is 128 MB on the first-party API, so the doc suggests the Files API for many images |
| Token formula | One visual token per 28x28 patch: `ceil(w/28) * ceil(h/28)` |
| Resolution tiers | **High-resolution** ("Claude 4.7 and later models"): 2,576 px long edge and 4,784 visual tokens. **Standard** (all other models): 1,568 px and 1,568 tokens |
| Resize rule | Claude finds the largest size that keeps the aspect ratio and fits both the edge limit and the token limit. "For nearly all photos and screenshots, the visual token limit is what determines the final size." 1920x1080 becomes 1456x819, not 1568x882. It then pads the bottom and right edges to a multiple of 28; rescale by the resized size, never the padded size |
| Coordinates | Claude "works best with absolute pixel coordinates" in `[x1, y1, x2, y2]` form, and badly with normalised 0 to 1000 coordinates. Returned coordinates are in the pixel space of the image as Claude processed it. Pre-resizing makes them map 1:1 |
| Guard rail | `"transformations": {"oversized_image": "error"}` on an image block turns silent downscaling into a 400 |
| Small targets | "for fine targets, crop the region of interest and send the crop (offset returned coordinates by the crop origin)" |
| Multiple images | "introduce each one with a short text label (`Image 1:`, `Image 2:`, and so on)" |
| Quality | Keep text legible. "Avoid cropping out key visual context solely to enlarge the text." Heavy JPEG compression "can make text difficult to read" |
| Limitations | Spatial outputs are approximate, counting is approximate, accuracy is poor on images under 200 px, and Claude will not identify people |

**Discrepancy to note.** The live vision page gives 3,000 px per side as the safe size for many-image requests. The `claude-api` skill bundled with Claude Code (cached 2026-11-03, `shared/model-migration.md`) says to "resize screenshots to 2000 px or less per side" in computer-use loops. The proposed export profile (1,568 px maximum) satisfies both, so the choice does not depend on which is current [I].

### 2.2 Token cost of real capture sizes [C]

Computed with the docs' `resized_size` reference function. The 1920x1080 row matches the docs' own table, which checks the computation.

| Capture (physical px) | Typical source | Standard tier (resized, tokens) | High-res tier (resized, tokens) |
|---|---|---|---|
| 1366x768 | Older Windows laptop | 1366x768, 1,372 | 1366x768, 1,372 |
| 1920x1080 | Windows desktop at 100% | 1456x819, **1,560** | 1920x1080, 2,691 |
| 2560x1440 | QHD monitor | 1456x819, 1,560 | 2560x1440, 4,784 |
| 2880x1800 | MacBook Pro 15" Retina (2x of 1440x900) | 1389x868, 1,550 | 2420x1512, 4,698 |
| 3024x1964 | MacBook Pro 14" Retina (2x of 1512x982) | 1372x891, 1,568 | 2380x1546, 4,760 |
| 3840x2160 | 4K | 1456x819, 1,560 | 2576x1449, 4,784 |
| 800x500 | Target crop | 800x500, **522** | 800x500, 522 |
| 1280x800 | Computer-use recommended size | 1280x800, 1,334 | 1280x800, 1,334 |

Implications [I]:
- A full frame plus a crop costs about 2,100 tokens per step at the standard profile. A 30-step recording is about 63k image tokens, which is small in a 1M context. At Claude Opus 5.5's $4 per million input tokens (pricing from the bundled skill, cached 2026-11-03), that is about $0.25 per full read.
- The high-res profile costs up to 3x more per frame and only helps when the full frame itself has to be read in detail. The native-resolution crop already covers that case for the target. The export setting `image_profile: "high"` stays available for dense screens such as Caseware or Excel grids, and the acceptance tests should decide whether the gain is worth it.
- Retina captures should be downscaled at export to logical points or below. This is also what the computer-use docs recommend for clicking: "Either downscale the screenshot by 2x before sending, or halve the coordinates" [E].

### 2.3 Prompt layout guidance [P/E]

From https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices [P]:
- "Place your long documents and inputs near the top of your prompt, above your query, instructions, and examples." "Queries at the end can improve response quality by up to 30 percent in tests, especially with complex, multidocument inputs."
- Wrap multiple documents in `<documents><document index="n"><source/><document_content/></document></documents>`.
- "Ground responses in quotes": ask Claude to quote the relevant parts first. For us, that means citing step ids [I].
- Vision: "give Claude a crop tool or agent skill. Testing has shown consistent uplift on image evaluations when Claude is able to 'zoom' in on relevant regions of an image." Anthropic publishes a crop-tool cookbook. When Claude has a filesystem, the package gives it the same ability: full-resolution redacted crops it can open on demand [I].

From the computer-use tool page [E]:
- "place the instruction text *before* the screenshot image. Providing the target description before the image is processed improves click accuracy." In our request, each step's text block therefore comes before that step's images [I].
- Recommended capture sizes are 1024x768 or 1280x720 for desktop and 1280x800 or 1366x768 for web, and "Avoid resolutions above 1920x1080". These apply to an agent that acts, but they support exporting at about 1.5k tokens or less [I].
- Agent loops collect screenshots "roughly 1,000–1,800 input tokens each".
- "For repeatable tasks or UI interactions, include example screenshots and tool calls of successful outcomes in your prompt." That is the job of a recording package. A replay agent can use our steps as few-shot examples [I].

### 2.4 Computer-use action vocabulary [E]

`computer_toolset_20260801` has 17 member tools: `screenshot`, `zoom(region)`, `left_click / right_click / middle_click / double_click / triple_click(coordinate, text=modifiers)`, `left_click_drag(start_coordinate, coordinate)`, `mouse_move`, `left_mouse_down/up`, `cursor_position`, `scroll(scroll_direction, scroll_amount, coordinate)`, `type(text)`, `key(text, repeat)`, `hold_key(text, duration)` and `wait(duration)`. Coordinates are in the pixel space of the full screenshot, with a top-left origin.

**Use:** our low-level action types map 1:1 onto this set (table in 4.3), so a recording can be replayed by a Claude computer-use agent with no translation layer [I]. On top of it we add semantic actions that the low-level vocabulary cannot express (`select`, `navigate`, `app_switch`, `inspect`, `file_dialog`, `copy`, `paste`, `manual`). Mind2Web did the same with CLICK, TYPE and SELECT, mapping hover and Enter onto CLICK [S].

### 2.5 Agent Skills progressive disclosure [P]

Source: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview. Level 1 metadata is about 100 tokens and always loaded. Level 2 `SKILL.md` is under 5k tokens and loaded when triggered. Level 3 resources are "None until accessed": "Claude reads only the files each task needs." `name` is at most 64 characters, lowercase letters, digits and hyphens. `description` is at most 1,024 characters.

**Use [I]:**
- The package follows the same pattern. `CLAUDE_HANDOFF.md` and `PROCESS.md` are always read. `steps.jsonl` is read in full. Images and the a11y snapshots under `a11y/` are opened per step as needed.
- An optional exporter can also write the merged process as a Claude Code skill (`.claude/skills/<process_key>/SKILL.md` plus `reference/` and `media/`), so a later Claude can perform or assist with the process directly. The Superbrain automation path can use this.

### 2.6 Evidence that richer demonstrations help [E]

**WONDERBREAD** (Wornow et al., NeurIPS 2024; https://arxiv.org/abs/2406.13264):
- 2,928 human demonstrations of 598 workflows.
- Each demonstration has an intent (.txt), a screen recording (.mp4), an action trace (.json: clicks, keystrokes and scrolls with elements and coordinates, plus the page HTML at each action), key frames (.png at each action's timestamp) and a human-written SOP (.txt).

SOP generation results [E]:

| Input | GPT-4 P / R / F1 | Claude 3 Sonnet F1 | Gemini Pro 1 F1 |
|---|---|---|---|
| Intent only | 0.48 / 0.59 / 0.49 | 0.50 | 0.34 |
| + key frames | 0.69 / 0.79 / 0.71 | 0.70 | 0.46 |
| + key frames + action trace | 0.80 / 0.88 / **0.82** | 0.76 | 0.58 |

- Recall exceeded precision by about 0.06 on average, which the authors attribute to hallucinated steps.
- Segmenting concatenated demonstrations "remains challenging".
- Low-level step validation was weak (GPT-4 trajectory-validation F1 of 0.27).
- These are 2024 models. Current Claude models should do better, but the ranking of input types is the useful finding [I].

**ECLAIR** (Wornow et al., PVLDB 17, 2024; https://arxiv.org/abs/2405.03710) [S]:
- Its stages are Demonstrate, then Execute, then Validate.
- Demonstrate turns screen recordings plus key frames into an SOP. Execute feeds the SOP, which a human may edit, to an agent with live screenshots. Validate checks the trace against the SOP.
- This is close to Superbrain's intended flow, and it shows why PROCESS.md has to be editable by a person and also readable by a machine [I].

### 2.7 Computer-use trajectory datasets and grounding

**Mind2Web** (https://arxiv.org/abs/2306.06070) [S]:
- Each action is a (target element, operation) pair: CLICK, TYPE or SELECT, with a value for TYPE and SELECT.
- It includes the page snapshot before each action and the positive candidate elements.
- Derived datasets render history as `[textbox] Last Name -> TYPE: Smith`. That compact line format suits our step summaries and the history in PROCESS.md [I].

**OmniACT** (CMU and Writer, 2024; https://arxiv.org/abs/2402.17553) [S]:
- About 9.8k pairs of (screenshot, task) mapped to PyAutoGUI scripts, across desktop and web, on macOS, Windows and Linux.
- Its finding is that generating executable desktop actions remains hard, so the package should carry real locators and not leave it to the model to rediscover controls [I].

**AgentNet / OpenCUA** (https://arxiv.org/abs/2508.09123) [S]:
- 22,625 human tasks (12k Windows, 5k macOS, 5k Ubuntu), averaging 18.6 steps, at 720p to 4K.
- Observations include the a11y tree, HTML and timestamps. Actions are PyAutoGUI plus agent-specific actions.
- Trajectories are augmented with "reflective long chain-of-thought". This shows that step-level reasoning (our `why`) is treated as valuable training and grounding signal [I].

**OSWorld and WebArena** [S]:
- OSWorld collects a11y trees through pyatspi on Ubuntu and pywinauto on Windows, serialised as XML.
- WebArena uses a filtered DOM a11y tree.
- A 2026 paper (A11y-Compressor) reports that compressing the linearised tree to about 22% of its tokens raised OSWorld success by 5.1 points.
- **Use [I]:** full trees are noisy. Store a pruned subtree around the target (dialog root, the target, its siblings and labelled neighbours) per step in `a11y/Sxx.json`, and keep it out of the default read.

**Set-of-Mark** (Yang et al., Microsoft, 2023; https://arxiv.org/abs/2310.11441) [S]:
- Overlaying numbered marks on image regions greatly improves GPT-4V's grounding.
- Spider2-V draws numbered boxes taken from the a11y tree on its screenshots.
- **Use [I]:** user highlights are drawn as `H1`, `H2`, and so on. The same label appears in the JSON and in PROCESS.md, so text and pixels refer to each other unambiguously. We do not mark every element, because that clutters the image and Claude does not need it to read a recording.

### 2.8 Process mining and task mining standards

**XES** (IEEE 1849) [S]:
- The 2023 revision was approved 2023-06-05 and published 2023-09-08.
- It adds the Micro, Software Event, Software Communication, Software Telemetry and Artifact Lifecycle extensions.
- The core XES model (log > trace > event, with the `concept:name`, `time:timestamp`, `lifecycle:transition` and `org:resource` keys) is from my recall [R].

**OCEL 2.0** (https://www.ocel-standard.org, spec dated 2023-10-16; arXiv 2403.01975) [E]:
- JSON top-level keys are `objectTypes`, `eventTypes`, `objects` and `events`.
- Events have `id`, `type`, `time`, `attributes[{name, value}]` and `relationships[{objectId, qualifier}]`.
- Objects have `id`, `type`, `attributes[{name, time, value}]` (values change over time) and `relationships[{objectId, qualifier}]` (O2O).
- "Events are atomic … have a timestamp."
- E2O qualifiers carry the role an object plays in an event.

**Abb & Rehse reference model for process-related UI logs** (BPM 2022 preprint, arXiv 2207.12054; extended in *Information Systems* 124, 2024) [E]:
- Nine components: Action (action type), Target object, Activity (= action + target, carrying activity name, input value and timestamp), UI element (current state), UI group (nestable), Application, System, User and Task.
- The UI hierarchy runs System > Application > UI group > UI element.
- Only the activity and its name are mandatory.
- Their stated reason for the model is that each study and tool conceptualises UI logs differently.

**Use [I]:**
- Our `step` corresponds to their Activity, `action` to Action, `target.element` to UI element, `target.ancestry` to UI groups, `target.app` to Application, `manifest.author` to User, and `manifest.process` to Task.
- This keeps the format explainable to process-mining people, and an OCEL 2.0 exporter is easy to write (section 9).

**Segmentation** [S]:
- Leno et al. (ICPM 2020; arXiv 2008.05782) and the journal version (arXiv 2106.13446) split unsegmented UI logs into routine executions, then mine candidate routines.
- Agostinelli, Marrella and Mecella (2021) find routine boundaries with trace alignment.
- This is relevant when one recording contains several runs or an interruption, and for aligning sessions (section 7).

### 2.9 SOP and work-instruction formats [S]

The DITA 1.3 task topic (OASIS) is the closest standard to a work instruction:
- `prereq`, `context`, `steps` / `steps-unordered`, `result`, `tasktroubleshooting`, `example` and `postreq`.
- Each `step` must have a `cmd` (one active-voice sentence) and may have `info`, `substeps`, `choices` / `choicetable` (decisions), `stepxmp`, `stepresult` and `steptroubleshooting`.

**Use [I]:**
- PROCESS.md borrows this outline: Purpose, Before you start, Steps (imperative `cmd` plus Why, Result and If-then), Result, Troubleshooting, Variations.
- `steps-unordered` corresponds directly to our "unordered" variant class.

### 2.10 Native control metadata

**Windows UI Automation** [P] (https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-automation-element-propids, updated 2025-07-14):
- `AutomationId`: the same in any instance of the app and in any language, but "unique among sibling elements, but not necessarily unique across the entire desktop", "not mandatory" and "not guaranteed to be stable across different releases or builds".
- `Name` "should be the same as the label text on screen" and "cannot be used as a unique identifier among siblings".
- `RuntimeId` is "opaque" and "Identifiers can be reused over time". It is useless across sessions, so it is not exported.
- `BoundingRectangle` is in "physical screen coordinates".
- `ClassName` is "not always in a standard format".
- `FrameworkId` takes values such as "Win32", "WinForm" and "DirectUI".
- `IsPassword`: "Attempting to access the Value property … may cause an error". This is a hard signal never to capture the value.
- Also useful: `LabeledBy`, `HelpText`, `PositionInSet` / `SizeOfSet` and `ProcessId`.

**macOS AX:**
- AXIdentifier is documented as the element's identity [S].
- `AXRole`, `AXSubrole`, `AXTitle`, `AXDescription`, `AXValue`, `AXPosition` / `AXSize` and secure text fields (`AXSecureTextField`) are from recall; check them against Apple's NSAccessibility reference [R].

**Citrix and RDP** [S] (Microsoft Power Automate and UiPath docs, snippets only):
- Recorders cannot reach logical elements inside a Citrix session without a helper installed on the remote side. Power Automate falls back to image recognition and OCR.
- UiPath reports that Citrix Virtual Apps and Desktops 7 2109 and later blocks custom virtual channels by default, which breaks its remote runtime.
- **Implication [I]:** if ProfSoft runs through Citrix or RDP, every ProfSoft step will have `grounding: "visual_only"`. The package must still be useful through OCR text, crops, narration and image anchors. The planner's claim that "every click records which control was clicked" should be qualified: it holds wherever the accessibility layer can see the control.

---

## 3. Design principles [I]

1. **The format serves the reader, which is Claude.** Text first, images on demand, one step per line, stable ids, and nothing a reader must reconstruct from raw events.
2. **Keep three layers apart.** The raw local store (video, every keystroke, unredacted) never leaves the machine. The reviewed export package is redacted and curated. Derived artefacts (merged variants, Claude's process spec) are separate files that reference the package.
3. **Say what kind of claim each statement is.** Observed, user-stated or inferred. Grounding level for targets. Confidence for time alignment.
4. **Keep one image per purpose.** `full` is clean, for context and automation. `full_annotated` draws the user's highlights and is produced only when a step has highlights. `crop` is target-centred at native resolution, with a thin click marker drawn on it.
5. **Make coordinates explicit.** Every geometry field names its space in the field name (`_screen_px` or `_frame_px`), and every frame carries the transform between them.
6. **Fail closed on privacy.** Password fields are never captured. Values default to redacted unless the field is on an allow list or the user marks them literal during review.
7. **Make the format a strict superset.** It maps onto the computer-use actions (replay), Mind2Web-style action lines (prompting), the Abb & Rehse UI-log model (task mining) and OCEL 2.0 (process mining).
8. **Keep cloud inference out of session packages.** The owner rule is that Claude runs only on the exported, reviewed package. Any `inferred` value inside a session package must therefore come from local code or a local model running before export:
   - an `inferred` why or expected result;
   - an `inferred` narration anchor;
   - a suggested `process_key`.

   The user sees every inferred value in review and can confirm it, which turns it into `user`, or delete it. Cloud-model output (Claude's process spec, merge-judge verdicts, merged variants) lives only in derived files outside the session package. If no local model is available, these fields stay empty and the deterministic PROCESS.md generator lists them as open questions.

---

## 4. Proposed package layout

```
afs-signed-date-to-register__pkg_01JDX7Q9.wrp/
├── manifest.json            # identity, process metadata, displays, media budget, privacy attestation, file hashes
├── CLAUDE_HANDOFF.md        # the prompt: role, reading order, rules, output contract
├── PROCESS.md               # human-readable SOP generated from steps (DITA-like), cites step ids and H-marks
├── steps.jsonl              # one curated step per line (schema #/$defs/step)
├── annotations.jsonl        # highlights, comments and narration segments (schema #/$defs/annotation)
├── media/
│   ├── S01_before_full.png              # pre-resized to the profile; coordinates 1:1 with steps.jsonl
│   ├── S01_before_crop.png              # native-resolution crop around the target, click marker drawn
│   ├── S02_before_full_annotated.png    # only when the step has highlights (H1, H2 drawn)
│   └── S05_after_full.png               # 'after' frames only where the result matters (dialogs, saves)
├── a11y/
│   └── S01.json             # pruned accessibility/DOM subtree at action time (not read by default)
├── anchors/
│   └── S01_target.png       # clean element-bounds snip for image-anchor locators (automation, not Claude)
├── events.jsonl             # OPTIONAL redacted low-level events (aggregated; no raw keystrokes)
├── redaction_report.json    # what was redacted, where, by which rule. Counts and classes only, never values
└── schema/
    └── wrp-0.1.schema.json  # the schema this package validates against (self-describing)
```

Notes on the layout [I]:
- File names put the step id first so that `ls media/` reads in process order. The `S01` form (two to four digits) is what humans and Claude cite.
- No video and no audio by default (`media.video_included: false`, `media.audio_included: false`). Video can be added as an opt-in for difficult cases. Claude cannot watch video directly; Anthropic's prompting-best-practices page says to analyse video "by breaking them up into frames" [P].
- `after` frames are exported only where the step's result is not visible in the next step's `before` frame: the last step, a dialog that closed, or a save. This keeps the image count down.
- `events.jsonl` exists for debugging and for future replay tuning. It is outside the handoff's default reading, and its schema is deferred to the capture lane.

### 4.1 Coordinate model [I]

- **Screen space:** physical pixels of the virtual desktop, top-left origin. This matches UIA `BoundingRectangle` [P]. On macOS the capture helper converts AX points into physical pixels with the display's backing scale factor.
- **Frame space:** pixels of the exported `full` image of that frame. `frame = (screen - source_rect.origin) * scale`.
- **Crop space:** `frame = crop_origin_frame_px + crop / crop_scale`.
- Claude is told to answer in frame pixels of the `full` image (or crop pixels plus offset). This matches the docs' advice to pre-resize so that coordinates map 1:1 [P].
- `manifest.displays[]` records each display's bounds and scale factor, so multi-monitor recordings work.

### 4.2 Step model [I]

One step is one user intent carried out by one primary action, for example "Set Engagement type to Audit". The capture lane aggregates raw events into steps:
- Keystrokes into one field become a single `type`.
- mousedown, mousemove and mouseup become `drag`.
- Scroll bursts become a single `scroll`.
- Focus changes become `app_switch`.

The user can merge, split, delete, add and reorder steps in review. Edited steps carry `flags: ["user_edited"]`.

Step `kind` is one of:
- `action`: the default.
- `decision`: the user chose a branch. It carries `decision.question`, `branch_taken` and `branches[]` with `observed: true|false`.
- `wait`: a significant pause that is a step in its own right.
- `checkpoint`: the user verified something.
- `context`: a narrated or typed explanation with no UI action, for example "first I check the partner is not on leave".

### 4.3 Action vocabulary [I]

| WRP `action.type` | Meaning | Replays as (computer-use member) | Mind2Web op |
|---|---|---|---|
| `click`, `double_click`, `right_click` | Mouse click on target | `left_click` / `double_click` / `right_click` | CLICK |
| `type` | Text entered into one field (aggregated) | `left_click` + `type` | TYPE |
| `key` | Hotkey or special key (`keys: "ctrl+s"`) | `key` | CLICK (Enter) |
| `select` | Option chosen in a list, combo or menu | click sequence, or keyboard | SELECT |
| `drag` | Drag from point to point | `left_click_drag` | none |
| `scroll` | Scroll a container | `scroll` | none |
| `app_switch` | Focus moved to another app or window | `key` (alt+tab) or click | none |
| `open_app` | Launched an app | OS launcher | none |
| `navigate` | Browser URL changed by typing or a link | `type` into the address bar, or click | CLICK |
| `file_dialog` | Open or save dialog, with path redacted to a class | click and type | none |
| `copy`, `paste` | Clipboard (content class only) | `key` ctrl/cmd+c/v | none |
| `inspect` | User read or verified something (often with a highlight) | `zoom` / `screenshot` | none |
| `wait` | Waited for the system | `wait` | none |
| `manual` | Off-screen or physical action described by the user | none (human step) | none |

### 4.4 Target model [I]

- `grounding` comes first, so the reader knows how much to trust the rest.
- `app`, `window.title` (redactable), `url` (origin and path; query and fragment dropped unless allow-listed), `element` (normalised `role`, `native_role`, `name`, `label`, `automation_id` / `ax_identifier`, `class_name`, `framework_id`, `help_text`, `is_password`, set position).
- `ancestry`: a window-to-parent path of (role, name, automation_id). This is an RPA-style selector in a form Claude can read.
- `locators[]`: ranked by expected stability, and each one is given a stability rating.
  - Use `uia_automation_id` or `ax_identifier` only when the value is non-empty and unique among siblings in the snapshot.
  - Then `role_name_path`, then `aria` / `css` for the DOM, then `label_relative` ("the box right of label X"), then `ocr_text`, then `image_anchor` (path to `anchors/`), and lastly `frame_point` (`x,y` in frame pixels; convert to screen pixels with the frame transform).
- `bounds_screen_px` and `bounds_frame_px`.
- `a11y_snapshot`: the path to the pruned subtree.

When there is no element (Citrix, canvas apps): `grounding: "visual_only"`, locators are `ocr_text`, `image_anchor` and `frame_point`, and the step carries `flags: ["remote_session", "low_confidence_target"]`.

### 4.5 Screenshots and overlays [I]

Per action step the package exports:
- `before.full`: the redacted frame just before the action, pre-resized. A timestamp a little before mousedown avoids hover artefacts.
- `before.crop`: an 800x500 screen-px region centred on the target and clamped to the screen, cut from the **redacted** frame at native resolution, with a click marker (a ring at the action point).
- `before.full_annotated`: only when the step has highlights. User shapes are drawn in their colours with labels `H1`, `H2`.
- `after.full`: only where needed (see 4).

Rules:
- Never draw step badges or margins on images. They hide content and change dimensions.
- Use PNG for screenshots of text. JPEG artefacts hurt legibility [P].
- Blurred regions are recorded in `redacted_regions_frame_px`, so Claude knows that a blur is deliberate and not missing UI.

### 4.6 Highlights, comments and narration [I]

| Kind | Created by | Anchor | Key fields |
|---|---|---|---|
| `highlight` | Overlay drawing (box, ellipse, arrow, freehand, marker) | `explicit`, to a frame and step | `mark` (H1…), `shape`, `geometry_frame_px`, `snapped_to` (the control under the shape, via UIA/AX hit-test or DOM) |
| `comment` | Typed while paused, or attached to a highlight | `explicit` | `category` (why, rule, exception, variation, warning, tip, data_source, decision, question), `text`, `linked_annotation_ids` |
| `narration` | Speech transcribed locally, then redacted | `time_aligned` (or `inferred` after model realignment) with `anchor_confidence` | `t_ms` to `t_end_ms`, `text` |

Narration alignment rule [I]:
- Assign a segment to the step whose `[t_start_ms - 3s, t_end_ms + 1s]` window it overlaps most. People tend to say what they are about to do.
- Mark `anchor_confidence` below 0.6 when a segment overlaps more than one step.
- The reviewer can drag segments to other steps, which makes the anchor `explicit`.

### 4.7 Data entered, redaction and parameters [I]

`action.value` always records the field (through the target), `value_type`, `shape`, `length` and `source`. When the value came from earlier on screen, it also records `copied_from_step`. When it is a process input, it records `parameter`. `disposition` is one of:
- `literal`: allowed values such as menu options, engagement types, or fixed codes the user marked safe.
- `redacted`: replaced by `placeholder` (`{{client_name}}`). The value itself never leaves the machine.
- `never_captured`: password or secure fields.

Detectors should cover:
- South African ID numbers (13 digits with a Luhn check digit [R]), tax and VAT numbers, bank accounts, emails, phone numbers, person and organisation names (NER), amounts, and free text in comment fields.
- The same detectors run on window titles, URLs, element names, OCR text that goes into the a11y snapshots, and transcripts.

`redaction_report.json` lists each redaction by rule and location, never by value. POPIA applies, so the export screen should show a "what leaves this machine" summary for the user to attest. That attestation is `privacy.reviewed_by_user: true`, which the schema requires.

### 4.8 Decisions, variations, waits and the "why" [I]

- **Decision:** the user presses a "Decision" key in the overlay, or the review step converts a step. `branches[].observed` separates the branch actually taken from branches the user described. Conditions are never inferred silently. An unknown condition becomes an open question.
- **Variation:** a `comment` with category `variation` ("sometimes …"). Across sessions, variations are discovered by merging (section 7).
- **Wait:** `post_wait {duration_ms, kind, until}` on the step that triggered it. `kind` is `system` when the UI showed busy signals (busy cursor, progress bar, frame differences over time) and `human` when the screen was static. `until` names the observable condition that ended the wait, which an automation needs.
- **Why:** `why.text` with provenance. `user` comes from comments or narration, and the source annotation ids are listed. `inferred` is a local heuristic or local-model guess that the user did not confirm in review (principle 8). It is never a cloud call.

### 4.9 PROCESS.md template [I]

The generator is deterministic code in the core lane, with no model. It renders from steps and annotations:

```markdown
# <process.title>
> Goal: … · Trigger: … · Systems: … · Recorded: <date> by <role> · <n> steps · package <id>

## Before you start
- Inputs: {{client_name}} (org name, from S01 email), {{afs_signed_date}} (date, read at S02)
## Steps
### Phase: <phase>
**S01. <summary>** `[observed]`
- Where: <app> › <window/url> › <role> "<name>" (grounding: accessibility)
- Why: <why> `[user, ann_0002]`
- Result: <expected_result>
- Images: media/S01_before_full.png, media/S01_before_crop.png
### Decision at S03: <question>
| If | Then | Seen in this recording |
## Notes, rules and warnings (by step)
## Open questions (generated: low-confidence targets, inferred whys, unobserved branches)
```

### 4.10 CLAUDE_HANDOFF.md (proposed full text) [I]

```markdown
# Handoff: recorded process "<process.title>"

You are reading a recording of one person doing a task on their computer. It was reviewed and
redacted by them before export. Your job is to understand the process exactly as performed and
explained, and to produce a process specification that an automation engineer (human or agent)
could implement without watching the recording.

## Read in this order
1. manifest.json — goal, trigger, systems, inputs, displays, privacy notes.
2. PROCESS.md — the readable outline. Treat it as an index, not as ground truth.
3. steps.jsonl — the ground truth, one step per line. Every claim you make must cite step ids (S01…).
4. annotations.jsonl — the person's highlights (H1…), typed comments and narration. Comments and
   explicitly anchored highlights are the strongest evidence of intent; narration is time-aligned
   and may be attached to a neighbouring step.
5. Images: open media/<step>_before_crop.png when you need to see the target, and
   media/<step>_before_full*.png for context. Coordinates in steps.jsonl are pixels of the *_full.png
   image for that frame; crop pixels map back via crop_origin_frame_px and crop_scale.
   a11y/<step>.json holds the control tree near the target if you need sibling or label context.

## Rules
- Distinguish three kinds of statement and label each: [observed] (in steps/images), [user] (said
  or typed by the person), [inferred] (your reasoning). Never present an inference as observed.
- Do not invent steps. If something must have happened between two steps but is not recorded,
  list it under "gaps" with the step ids on either side.
- Values shown as {{placeholder}} or [REDACTED_CLASS] were removed on purpose. Treat them as
  parameters of the process; never guess the real value.
- A blurred region is deliberate redaction, not missing UI.
- Targets with grounding "visual_only" or flag "low_confidence_target" have no reliable control id;
  describe them by visible text and position, and say so.
- Decisions: only state a branch condition if the person stated it (provenance "user"); otherwise
  record the decision with "condition unknown" and add a question.
- Times are milliseconds from recording start; the timezone is in manifest.recording.timezone.

## Produce
1. process_spec.json, following the process_spec contract in schema/ (if present), with: inputs,
   outputs, preconditions, ordered steps (intent, action, target with ranked locators, input
   parameter, expected result, evidence step ids, confidence), decisions, waits, exceptions,
   per-step automation approach (api | ui_selector | browser | visual | human) with reasons.
2. A short narrative of the process in plain language for a non-technical reader.
3. Open questions for the person, ranked by how much they block automation.
4. Gaps and risks: steps that look unsafe to automate (irreversible, regulatory, judgement calls).
Quote the comment or narration text you relied on for every "why".
```

### 4.11 Output contract sketch: process_spec.json [I]

This is owned by the review/export plus spec-generation lane. The shape it needs to serve Superbrain:
`{process_key, title, goal, trigger, inputs[{name, type, source_step}], outputs[], preconditions[], steps[{id, intent, action, target{app, locators[], grounding}, input_ref, expected_result, post_wait, evidence[step_ids], provenance, confidence, automation{method, notes}}], decisions[{at, question, branches[{condition, provenance, next}]}], exceptions[], open_questions[], gaps[], assumptions[]}`.

The `evidence` array is mandatory for every step. That is what makes acceptance check 4 scorable.

### 4.12 Two ways to consume the package [I]

1. **Agent with a filesystem** (Claude Code, Managed Agents, or a skill). Point it at the folder and start with `CLAUDE_HANDOFF.md`. Progressive disclosure keeps context small, and the agent opens crops in place of a crop tool. This is the default and what acceptance check 4 should exercise.
2. **Single Messages API call** (Superbrain backend). A packer script builds the request:
   - `<documents>` holding manifest, PROCESS.md, steps.jsonl and annotations.jsonl at the top.
   - Then, per step, a text label (`Image S03-crop:` plus the step summary) **before** that step's images.
   - The handoff instructions and request last.
   - Images go through the Files API by `file_id` when there are many.
   - The packer sets `"oversized_image": "error"` on every image block, so a profile mismatch fails loudly instead of shifting coordinates.
   - Above 20 images, the standard profile's 1,568 px cap already meets the stricter many-image limit (3,000 px in the live doc, 2,000 px in the bundled note).

---

## 5. Draft JSON Schema (v0.1)

One file with one `$defs` entry per package file. Validated today with Ajv 8.20 (draft 2020-12, strict mode except `strictRequired`), together with the worked example in section 6. Format validation was off, so `date-time` strings were not checked. Four negative tests pass: a highlight without a mark is rejected, a comment without an anchor is rejected, an unknown provenance value is rejected, and a `redacted` value that still carries a `literal` is rejected.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://superbrain.local/schemas/wrp/0.1/package.schema.json",
  "title": "Workflow Recording Package (WRP) v0.1",
  "description": "One schema file, one $defs entry per package file. manifest.json validates against #/$defs/manifest; each line of steps.jsonl against #/$defs/step; each line of annotations.jsonl against #/$defs/annotation.",
  "$defs": {
    "id": { "type": "string", "pattern": "^[a-z]+_[0-9A-Za-z]{4,32}$" },
    "stepId": { "type": "string", "pattern": "^S[0-9]{2,4}$" },
    "isoTime": { "type": "string", "format": "date-time" },
    "provenance": {
      "description": "Who asserted this. observed = captured by the recorder; user = typed or spoken by the recording user; inferred = produced by a model or heuristic and not confirmed by the user.",
      "enum": ["observed", "user", "inferred"]
    },
    "rect": {
      "description": "[x0, y0, x1, y1], top-left origin, x0<x1, y0<y1.",
      "type": "array", "items": { "type": "number" }, "minItems": 4, "maxItems": 4
    },
    "point": { "type": "array", "items": { "type": "number" }, "minItems": 2, "maxItems": 2 },
    "sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
    "imageRef": {
      "type": "object",
      "required": ["path", "width", "height", "est_tokens"],
      "additionalProperties": false,
      "properties": {
        "path": { "type": "string" },
        "width": { "type": "integer", "minimum": 1 },
        "height": { "type": "integer", "minimum": 1 },
        "est_tokens": { "type": "integer", "minimum": 1, "description": "ceil(w/28)*ceil(h/28) after export resize" },
        "variant": { "enum": ["full", "full_annotated", "crop", "crop_annotated"] },
        "crop_origin_frame_px": { "$ref": "#/$defs/point", "description": "Top-left of a crop inside its parent full frame, in frame pixels. Add it to crop coordinates to get frame coordinates." },
        "crop_scale": { "type": "number", "exclusiveMinimum": 0, "description": "crop pixels per frame pixel (1.0 when cut at frame resolution)" }
      }
    },
    "frame": {
      "description": "A screen capture plus the transform from screen to image pixels.",
      "type": "object",
      "required": ["frame_id", "t_ms", "display_id", "source_rect_screen_px", "scale", "full"],
      "additionalProperties": false,
      "properties": {
        "frame_id": { "$ref": "#/$defs/id" },
        "t_ms": { "type": "integer", "minimum": 0, "description": "ms since recording start" },
        "display_id": { "type": "string" },
        "source_rect_screen_px": { "$ref": "#/$defs/rect", "description": "Captured rectangle in physical virtual-desktop pixels." },
        "scale": { "type": "number", "exclusiveMinimum": 0, "description": "image px per physical screen px. image = (screen - source_rect origin) * scale" },
        "full": { "$ref": "#/$defs/imageRef" },
        "full_annotated": { "$ref": "#/$defs/imageRef" },
        "crop": { "$ref": "#/$defs/imageRef" },
        "crop_annotated": { "$ref": "#/$defs/imageRef" },
        "redacted_regions_frame_px": { "type": "array", "items": { "$ref": "#/$defs/rect" } }
      }
    },
    "redactableText": {
      "description": "A string that may have been redacted at export. When redacted, 'text' holds a placeholder such as '[CLIENT_NAME]' and the real value never leaves the machine.",
      "type": "object",
      "required": ["text", "redacted"],
      "additionalProperties": false,
      "properties": {
        "text": { "type": "string" },
        "redacted": { "type": "boolean" },
        "classes": { "type": "array", "items": { "type": "string" } }
      }
    },
    "locator": {
      "type": "object",
      "required": ["strategy", "value", "rank"],
      "additionalProperties": false,
      "properties": {
        "strategy": { "enum": ["uia_automation_id", "ax_identifier", "role_name_path", "css", "xpath", "aria", "label_relative", "ocr_text", "image_anchor", "frame_point"], "description": "frame_point = 'x,y' in frame pixels of the step's before frame; convert to screen with the frame transform" },
        "value": { "type": "string" },
        "rank": { "type": "integer", "minimum": 1 },
        "stability": { "enum": ["high", "medium", "low", "unknown"] },
        "note": { "type": "string" }
      }
    },
    "target": {
      "type": "object",
      "required": ["grounding", "app", "locators"],
      "additionalProperties": false,
      "properties": {
        "grounding": {
          "description": "How the control was identified. accessibility = UIA/AX element; dom = browser DOM via extension; ocr = text found in pixels; visual_only = pixels only (for example inside Citrix/RDP).",
          "enum": ["accessibility", "dom", "ocr", "visual_only"]
        },
        "app": {
          "type": "object",
          "required": ["name"],
          "additionalProperties": false,
          "properties": {
            "name": { "type": "string" },
            "process": { "type": "string" },
            "bundle_id": { "type": "string" },
            "version": { "type": "string" },
            "kind": { "enum": ["native", "browser", "remote_session", "terminal", "unknown"] }
          }
        },
        "window": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "title": { "$ref": "#/$defs/redactableText" },
            "class_name": { "type": "string" },
            "is_dialog": { "type": "boolean" }
          }
        },
        "url": { "$ref": "#/$defs/redactableText", "description": "Origin + path; query string and fragment dropped unless whitelisted." },
        "element": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "role": { "type": "string", "description": "Normalised role: button, textbox, combobox, option, menuitem, link, tab, checkbox, radio, cell, row, listitem, treeitem, dialog, window, pane, text, image, other" },
            "native_role": { "type": "string", "description": "e.g. UIA ControlType.Edit or AXTextField" },
            "name": { "$ref": "#/$defs/redactableText" },
            "label": { "type": "string", "description": "Visible label from LabeledBy / AXTitleUIElement / <label>, if different from name" },
            "automation_id": { "type": "string" },
            "ax_identifier": { "type": "string" },
            "class_name": { "type": "string" },
            "framework_id": { "type": "string" },
            "help_text": { "type": "string" },
            "is_password": { "type": "boolean" },
            "is_enabled": { "type": "boolean" },
            "position_in_set": { "type": "integer" },
            "size_of_set": { "type": "integer" }
          }
        },
        "ancestry": {
          "description": "Window-to-parent path, nearest parent last.",
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "role": { "type": "string" },
              "name": { "type": "string" },
              "automation_id": { "type": "string" }
            }
          }
        },
        "locators": { "type": "array", "items": { "$ref": "#/$defs/locator" } },
        "bounds_screen_px": { "$ref": "#/$defs/rect" },
        "bounds_frame_px": { "$ref": "#/$defs/rect" },
        "a11y_snapshot": { "type": "string", "description": "Path to a11y/<step>.json: the target, its siblings and the dialog subtree at action time." }
      }
    },
    "valueRecord": {
      "description": "What was entered or chosen. The field is always kept; the value only when the user allowed it.",
      "type": "object",
      "required": ["disposition", "value_type"],
      "additionalProperties": false,
      "properties": {
        "disposition": { "enum": ["literal", "redacted", "never_captured"] },
        "literal": { "type": "string" },
        "placeholder": { "type": "string", "description": "e.g. {{client_code}}" },
        "value_type": { "enum": ["text", "number", "currency", "date", "identifier", "email", "phone", "person_name", "org_name", "address", "sa_id_number", "tax_number", "bank_account", "password", "file_path", "option", "boolean", "other"] },
        "shape": { "type": "string", "description": "Format without content, e.g. 'YYYY-MM-DD', '3 letters + 4 digits'" },
        "length": { "type": "integer", "minimum": 0 },
        "source": { "enum": ["typed", "pasted", "selected", "autofilled", "unknown"] },
        "copied_from_step": { "$ref": "#/$defs/stepId" },
        "parameter": { "type": "string", "description": "Name of the process input this value comes from" }
      },
      "if": { "properties": { "disposition": { "enum": ["redacted", "never_captured"] } } },
      "then": { "not": { "required": ["literal"] } }
    },
    "action": {
      "type": "object",
      "required": ["type"],
      "additionalProperties": false,
      "properties": {
        "type": { "enum": ["click", "double_click", "right_click", "type", "key", "select", "drag", "scroll", "app_switch", "open_app", "navigate", "file_dialog", "copy", "paste", "inspect", "wait", "manual", "other"] },
        "keys": { "type": "string", "description": "For key: '+'-joined combo, e.g. ctrl+s" },
        "point_frame_px": { "$ref": "#/$defs/point" },
        "end_point_frame_px": { "$ref": "#/$defs/point" },
        "scroll": { "type": "object", "additionalProperties": false, "properties": { "direction": { "enum": ["up", "down", "left", "right"] }, "amount": { "type": "number" } } },
        "value": { "$ref": "#/$defs/valueRecord" },
        "wait": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "duration_ms": { "type": "integer", "minimum": 0 },
            "kind": { "enum": ["system", "human", "unknown"] },
            "until": { "type": "string", "description": "Observable condition that ended the wait" }
          }
        },
        "raw_event_ids": { "type": "array", "items": { "type": "string" } }
      }
    },
    "manifest": {
      "type": "object",
      "required": ["format", "schema_version", "package_id", "created_at", "recorder", "process", "recording", "displays", "media", "privacy", "files"],
      "additionalProperties": false,
      "properties": {
        "format": { "const": "workflow-recording-package" },
        "schema_version": { "type": "string", "pattern": "^0\\.1(\\.[0-9]+)?$" },
        "package_id": { "$ref": "#/$defs/id" },
        "created_at": { "$ref": "#/$defs/isoTime" },
        "recorder": {
          "type": "object", "required": ["name", "version", "os"], "additionalProperties": false,
          "properties": { "name": { "type": "string" }, "version": { "type": "string" }, "os": { "enum": ["windows", "macos"] }, "os_version": { "type": "string" }, "locale": { "type": "string" } }
        },
        "author": {
          "type": "object", "additionalProperties": false,
          "properties": { "pseudonym": { "type": "string" }, "role": { "type": "string" }, "org": { "type": "string" } }
        },
        "process": {
          "type": "object", "required": ["title", "goal"], "additionalProperties": false,
          "properties": {
            "title": { "type": "string" },
            "goal": { "type": "string" },
            "process_key": { "type": "string", "description": "Stable slug shared by every recording of the same process; drives variant merging" },
            "trigger": { "type": "string" },
            "frequency": { "type": "string" },
            "outcome": { "type": "string", "description": "What 'done' looks like" },
            "systems": { "type": "array", "items": { "type": "string" } },
            "inputs": {
              "type": "array",
              "items": {
                "type": "object", "required": ["name", "value_type"], "additionalProperties": false,
                "properties": { "name": { "type": "string" }, "value_type": { "type": "string" }, "description": { "type": "string" }, "source": { "type": "string" } }
              }
            },
            "is_complete_run": { "type": "boolean" },
            "is_happy_path": { "type": "boolean" }
          }
        },
        "recording": {
          "type": "object", "required": ["started_at", "ended_at", "timezone", "step_count"], "additionalProperties": false,
          "properties": {
            "started_at": { "$ref": "#/$defs/isoTime" },
            "ended_at": { "$ref": "#/$defs/isoTime" },
            "timezone": { "type": "string" },
            "step_count": { "type": "integer", "minimum": 0 },
            "paused_ranges_ms": { "type": "array", "items": { "$ref": "#/$defs/point" } },
            "edited": { "type": "boolean", "description": "true if the user deleted, merged or reordered steps in review" }
          }
        },
        "displays": {
          "type": "array", "minItems": 1,
          "items": {
            "type": "object", "required": ["display_id", "bounds_screen_px", "scale_factor"], "additionalProperties": false,
            "properties": { "display_id": { "type": "string" }, "bounds_screen_px": { "$ref": "#/$defs/rect" }, "scale_factor": { "type": "number" }, "primary": { "type": "boolean" } }
          }
        },
        "media": {
          "type": "object", "required": ["image_profile", "max_long_edge", "max_tokens_per_image", "est_image_tokens_total"], "additionalProperties": false,
          "properties": {
            "image_profile": { "enum": ["standard", "high"] },
            "max_long_edge": { "type": "integer" },
            "max_tokens_per_image": { "type": "integer" },
            "est_image_tokens_total": { "type": "integer" },
            "image_count": { "type": "integer" },
            "format": { "enum": ["png", "jpeg", "webp"] },
            "video_included": { "type": "boolean" },
            "audio_included": { "type": "boolean" }
          }
        },
        "privacy": {
          "type": "object", "required": ["reviewed_by_user", "redaction_policy"], "additionalProperties": false,
          "properties": {
            "reviewed_by_user": { "const": true },
            "reviewed_at": { "$ref": "#/$defs/isoTime" },
            "redaction_policy": { "type": "string" },
            "redaction_report": { "type": "string" },
            "contains_personal_information": { "enum": ["none_known", "redacted", "present_with_consent"] }
          }
        },
        "family": {
          "type": "object", "additionalProperties": false,
          "properties": { "process_key": { "type": "string" }, "session_label": { "type": "string" }, "variant_hint": { "type": "string" } }
        },
        "files": {
          "type": "array",
          "items": {
            "type": "object", "required": ["path", "sha256"], "additionalProperties": false,
            "properties": { "path": { "type": "string" }, "sha256": { "$ref": "#/$defs/sha256" }, "bytes": { "type": "integer" }, "role": { "type": "string" } }
          }
        }
      }
    },
    "step": {
      "type": "object",
      "required": ["step_id", "seq", "kind", "t_start_ms", "t_end_ms", "summary", "summary_provenance"],
      "additionalProperties": false,
      "properties": {
        "step_id": { "$ref": "#/$defs/stepId" },
        "seq": { "type": "integer", "minimum": 1 },
        "kind": { "enum": ["action", "decision", "wait", "checkpoint", "context"] },
        "t_start_ms": { "type": "integer", "minimum": 0 },
        "t_end_ms": { "type": "integer", "minimum": 0 },
        "phase": { "type": "string", "description": "Optional grouping label, e.g. 'Find the signed date'" },
        "summary": { "type": "string", "description": "One imperative sentence, e.g. 'Click Save in the AFS form.'" },
        "summary_provenance": { "$ref": "#/$defs/provenance" },
        "why": {
          "type": "object", "required": ["text", "provenance"], "additionalProperties": false,
          "properties": { "text": { "type": "string" }, "provenance": { "$ref": "#/$defs/provenance" }, "source_annotation_ids": { "type": "array", "items": { "$ref": "#/$defs/id" } } }
        },
        "action": { "$ref": "#/$defs/action" },
        "target": { "$ref": "#/$defs/target" },
        "before": { "$ref": "#/$defs/frame" },
        "after": { "$ref": "#/$defs/frame" },
        "expected_result": {
          "type": "object", "required": ["text", "provenance"], "additionalProperties": false,
          "properties": { "text": { "type": "string" }, "provenance": { "$ref": "#/$defs/provenance" } }
        },
        "post_wait": {
          "description": "A wait observed after the action, before the next step could start.",
          "type": "object", "required": ["duration_ms", "kind"], "additionalProperties": false,
          "properties": {
            "duration_ms": { "type": "integer", "minimum": 0 },
            "kind": { "enum": ["system", "human", "unknown"] },
            "until": { "type": "string" }
          }
        },
        "decision": {
          "type": "object", "required": ["question", "branch_taken"], "additionalProperties": false,
          "properties": {
            "question": { "type": "string" },
            "branch_taken": { "type": "string" },
            "branches": {
              "type": "array",
              "items": {
                "type": "object", "required": ["condition", "provenance"], "additionalProperties": false,
                "properties": { "condition": { "type": "string" }, "then": { "type": "string" }, "observed": { "type": "boolean" }, "provenance": { "$ref": "#/$defs/provenance" } }
              }
            }
          }
        },
        "annotation_ids": { "type": "array", "items": { "$ref": "#/$defs/id" } },
        "flags": { "type": "array", "items": { "enum": ["user_edited", "user_added", "merged", "low_confidence_target", "remote_session", "contains_redaction", "sensitive_screen", "error_recovery"] } }
      }
    },
    "annotation": {
      "type": "object",
      "required": ["annotation_id", "kind", "t_ms", "provenance"],
      "additionalProperties": false,
      "properties": {
        "annotation_id": { "$ref": "#/$defs/id" },
        "kind": { "enum": ["highlight", "comment", "narration"] },
        "t_ms": { "type": "integer", "minimum": 0 },
        "t_end_ms": { "type": "integer", "minimum": 0 },
        "provenance": { "$ref": "#/$defs/provenance" },
        "step_ids": { "type": "array", "items": { "$ref": "#/$defs/stepId" } },
        "anchor": {
          "description": "explicit = user attached it to a step or highlight; time_aligned = matched by timestamp; inferred = matched by a model",
          "enum": ["explicit", "time_aligned", "inferred"]
        },
        "anchor_confidence": { "type": "number", "minimum": 0, "maximum": 1 },
        "mark": { "type": "string", "pattern": "^H[0-9]{1,3}$", "description": "Label drawn on annotated images (Set-of-Mark style)" },
        "shape": { "enum": ["rect", "ellipse", "arrow", "freehand", "marker"] },
        "frame_id": { "$ref": "#/$defs/id" },
        "geometry_frame_px": { "type": "array", "items": { "$ref": "#/$defs/point" }, "minItems": 2 },
        "snapped_to": {
          "type": "object", "additionalProperties": false,
          "properties": {
            "role": { "type": "string" }, "name": { "type": "string" }, "automation_id": { "type": "string" },
            "bounds_frame_px": { "$ref": "#/$defs/rect" }, "grounding": { "enum": ["accessibility", "dom", "ocr", "visual_only"] }
          }
        },
        "category": { "enum": ["why", "rule", "exception", "variation", "warning", "tip", "data_source", "decision", "question", "other"] },
        "text": { "type": "string" },
        "linked_annotation_ids": { "type": "array", "items": { "$ref": "#/$defs/id" } },
        "redacted": { "type": "boolean" }
      },
      "allOf": [
        { "if": { "properties": { "kind": { "const": "highlight" } } }, "then": { "required": ["mark", "shape", "frame_id", "geometry_frame_px"] } },
        { "if": { "properties": { "kind": { "enum": ["comment", "narration"] } } }, "then": { "required": ["text", "anchor"] } },
        { "if": { "properties": { "kind": { "const": "narration" } } }, "then": { "required": ["t_end_ms"] } }
      ]
    }
  }
}
```

The schema does not yet enforce these cross-file invariants. They belong in the core lane's validator, and the example validation script already checks them:
- Every `annotation_ids` / `source_annotation_ids` / `step_ids` reference resolves.
- `manifest.recording.step_count` equals the number of lines.
- Each `est_tokens` equals `ceil(w/28)*ceil(h/28)`.
- `media.image_count` and `est_image_tokens_total` equal the sums over the steps.
- `t_start_ms <= t_end_ms`, and steps are in order by `seq`.
- Every file in the package is listed with a correct sha256.

---

## 6. Worked example: 5-step accounting task

The task is to record the AFS signed date on the lockdown register (QuicklySign, then AppSheet). It runs on Windows 11, one 1920x1080 display at 100%, standard image profile (frame scale 0.758333).

All UI labels, coordinates and hashes are **synthetic and for illustration only**. They are not verified against the real Outlook, QuicklySign or AppSheet screens. This JSON validated with zero errors against the schema above (12 images, 13,530 estimated image tokens).

### 6.1 manifest.json

```json
{
  "format": "workflow-recording-package",
  "schema_version": "0.1",
  "package_id": "pkg_01JDX7Q9ZK3V8M2N4P6R8T0W2Y",
  "created_at": "2026-11-20T09:14:03+02:00",
  "recorder": { "name": "superbrain-recorder", "version": "0.1.0", "os": "windows", "os_version": "Windows 11 24H2", "locale": "en-ZA" },
  "author": { "pseudonym": "user_7f3a", "role": "Admin assistant", "org": "example-firm" },
  "process": {
    "title": "Record the AFS signed date on the lockdown register",
    "goal": "When a client signs the annual financial statements in QuicklySign, capture the completed date in the AppSheet register form so the 40-day and 60-day lockdown clocks start.",
    "process_key": "afs-signed-date-to-register",
    "trigger": "QuicklySign 'document completed' email arrives",
    "frequency": "Several times a week; peaks after year-end sign-offs",
    "outcome": "A saved register entry with engagement type and AFS signed date",
    "systems": ["Outlook (desktop)", "QuicklySign (web)", "AppSheet form (web)"],
    "inputs": [
      { "name": "client_name", "value_type": "org_name", "description": "Client whose AFS was signed", "source": "QuicklySign email subject" },
      { "name": "afs_signed_date", "value_type": "date", "description": "Completed date shown in QuicklySign", "source": "QuicklySign document page (S02)" }
    ],
    "is_complete_run": true,
    "is_happy_path": true
  },
  "recording": {
    "started_at": "2026-11-20T09:05:11+02:00",
    "ended_at": "2026-11-20T09:06:04+02:00",
    "timezone": "Africa/Johannesburg",
    "step_count": 5,
    "paused_ranges_ms": [[17000, 30200]],
    "edited": true
  },
  "displays": [ { "display_id": "d0", "bounds_screen_px": [0, 0, 1920, 1080], "scale_factor": 1.0, "primary": true } ],
  "media": {
    "image_profile": "standard",
    "max_long_edge": 1568,
    "max_tokens_per_image": 1568,
    "est_image_tokens_total": 13530,
    "image_count": 12,
    "format": "png",
    "video_included": false,
    "audio_included": false
  },
  "privacy": {
    "reviewed_by_user": true,
    "reviewed_at": "2026-11-20T09:13:40+02:00",
    "redaction_policy": "default-za-v1",
    "redaction_report": "redaction_report.json",
    "contains_personal_information": "redacted"
  },
  "family": { "process_key": "afs-signed-date-to-register", "session_label": "user_7f3a run 1", "variant_hint": "audit, happy path" },
  "files": [
    { "path": "steps.jsonl", "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "role": "steps" },
    { "path": "annotations.jsonl", "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "role": "annotations" },
    { "path": "PROCESS.md", "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", "role": "process_doc" },
    { "path": "CLAUDE_HANDOFF.md", "sha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", "role": "handoff" }
  ]
}
```

### 6.2 steps.jsonl (one JSON object per line; S02 and S03 shown pretty-printed below, all five are one-liners in the file)

```jsonl
{"step_id":"S01","seq":1,"kind":"action","t_start_ms":4200,"t_end_ms":5100,"phase":"Open the signed pack","summary":"In the QuicklySign 'document completed' email, click View document.","summary_provenance":"observed","why":{"text":"The email only says the pack is complete; the signed date is on the QuicklySign page.","provenance":"user","source_annotation_ids":["ann_0002"]},"action":{"type":"click","point_frame_px":[963.1,419.4]},"target":{"grounding":"accessibility","app":{"name":"Outlook","process":"OUTLOOK.EXE","kind":"native"},"window":{"title":{"text":"QuicklySign: Document completed - [CLIENT_NAME] AFS 2026 - Message (HTML)","redacted":true,"classes":["org_name"]},"class_name":"rctrl_renwnd32"},"element":{"role":"link","native_role":"ControlType.Hyperlink","name":{"text":"View document","redacted":false}},"ancestry":[{"role":"window","name":"[redacted message title]"},{"role":"pane","name":"Message"},{"role":"document","name":"Message body"}],"locators":[{"strategy":"role_name_path","value":"window[class=rctrl_renwnd32] >> document >> link[name='View document']","rank":1,"stability":"medium"},{"strategy":"ocr_text","value":"View document","rank":2,"stability":"medium"},{"strategy":"frame_point","value":"963.1,419.4","rank":3,"stability":"low"}],"bounds_screen_px":[1210,540,1330,566],"bounds_frame_px":[917.6,409.5,1008.6,429.2],"a11y_snapshot":"a11y/S01.json"},"before":{"frame_id":"frm_0101","t_ms":4150,"display_id":"d0","source_rect_screen_px":[0,0,1920,1080],"scale":0.758333,"full":{"path":"media/S01_before_full.png","width":1456,"height":819,"est_tokens":1560,"variant":"full"},"crop":{"path":"media/S01_before_crop.png","width":800,"height":500,"est_tokens":522,"variant":"crop","crop_origin_frame_px":[659.8,229.8],"crop_scale":1.3187},"redacted_regions_frame_px":[[240,96,1210,124]]},"expected_result":{"text":"Chrome opens the QuicklySign document page.","provenance":"observed"},"annotation_ids":["ann_0002"],"flags":["contains_redaction"]}
{"step_id":"S04","seq":4,"kind":"action","t_start_ms":43000,"t_end_ms":47800,"phase":"Fill in the register form","summary":"Type the Completed date from S02 into AFS signed date.","summary_provenance":"observed","action":{"type":"type","point_frame_px":[728.0,440.6],"value":{"disposition":"redacted","placeholder":"{{afs_signed_date}}","value_type":"date","shape":"YYYY/MM/DD","length":10,"source":"typed","copied_from_step":"S02","parameter":"afs_signed_date"}},"target":{"grounding":"dom","app":{"name":"Google Chrome","process":"chrome.exe","kind":"browser"},"url":{"text":"https://www.appsheet.com/start/[APP_ID]","redacted":true,"classes":["identifier"]},"element":{"role":"textbox","native_role":"input[type=date]","name":{"text":"AFS signed date","redacted":false},"label":"AFS signed date"},"locators":[{"strategy":"aria","value":"textbox[name='AFS signed date']","rank":1,"stability":"high"}],"bounds_screen_px":[640,560,1280,602],"bounds_frame_px":[485.3,424.7,970.7,456.5],"a11y_snapshot":"a11y/S04.json"},"before":{"frame_id":"frm_0401","t_ms":42900,"display_id":"d0","source_rect_screen_px":[0,0,1920,1080],"scale":0.758333,"full":{"path":"media/S04_before_full.png","width":1456,"height":819,"est_tokens":1560,"variant":"full"},"crop":{"path":"media/S04_before_crop.png","width":800,"height":500,"est_tokens":522,"variant":"crop","crop_origin_frame_px":[424.7,251.0],"crop_scale":1.3187}},"expected_result":{"text":"AFS signed date holds the Completed date.","provenance":"observed"},"flags":["contains_redaction"]}
{"step_id":"S05","seq":5,"kind":"action","t_start_ms":49100,"t_end_ms":52600,"phase":"Fill in the register form","summary":"Click Save and wait for the Saved banner.","summary_provenance":"observed","why":{"text":"Saving writes the entry the admin team uses to update the register.","provenance":"inferred"},"action":{"type":"click","point_frame_px":[932.8,697.7]},"target":{"grounding":"dom","app":{"name":"Google Chrome","process":"chrome.exe","kind":"browser"},"url":{"text":"https://www.appsheet.com/start/[APP_ID]","redacted":true,"classes":["identifier"]},"element":{"role":"button","native_role":"button","name":{"text":"Save","redacted":false}},"locators":[{"strategy":"aria","value":"button[name='Save']","rank":1,"stability":"high"}],"bounds_screen_px":[1180,900,1280,940],"bounds_frame_px":[894.8,682.5,970.7,712.8],"a11y_snapshot":"a11y/S05.json"},"before":{"frame_id":"frm_0501","t_ms":49000,"display_id":"d0","source_rect_screen_px":[0,0,1920,1080],"scale":0.758333,"full":{"path":"media/S05_before_full.png","width":1456,"height":819,"est_tokens":1560,"variant":"full"},"crop":{"path":"media/S05_before_crop.png","width":800,"height":500,"est_tokens":522,"variant":"crop","crop_origin_frame_px":[629.4,439.8],"crop_scale":1.3187}},"after":{"frame_id":"frm_0502","t_ms":52700,"display_id":"d0","source_rect_screen_px":[0,0,1920,1080],"scale":0.758333,"full":{"path":"media/S05_after_full.png","width":1456,"height":819,"est_tokens":1560,"variant":"full"}},"post_wait":{"duration_ms":2300,"kind":"system","until":"Green 'Saved' banner appears at the top of the form"},"expected_result":{"text":"A 'Saved' banner appears and the form clears.","provenance":"observed"},"annotation_ids":["ann_0006"]}
```

S02 (the highlight step) and S03 (the decision step), pretty-printed:

```json
{
  "step_id": "S02", "seq": 2, "kind": "action", "t_start_ms": 9800, "t_end_ms": 31000,
  "phase": "Open the signed pack",
  "summary": "On the QuicklySign document page, read the Completed date.",
  "summary_provenance": "observed",
  "why": { "text": "The Completed date (when the last person signed) is the date that starts the 40-day clock; the date the email arrived is not.",
           "provenance": "user", "source_annotation_ids": ["ann_0001", "ann_0003"] },
  "action": { "type": "inspect" },
  "target": {
    "grounding": "dom",
    "app": { "name": "Google Chrome", "process": "chrome.exe", "kind": "browser" },
    "url": { "text": "https://app.quicklysign.com/documents/[ID]", "redacted": true, "classes": ["identifier"] },
    "element": { "role": "cell", "native_role": "td", "name": { "text": "Completed", "redacted": false }, "label": "Completed" },
    "locators": [
      { "strategy": "aria", "value": "row:has-text('Completed') >> cell >> nth=1", "rank": 1, "stability": "medium" },
      { "strategy": "label_relative", "value": "value right of label 'Completed'", "rank": 2, "stability": "medium" }
    ],
    "bounds_screen_px": [1012, 402, 1236, 428], "bounds_frame_px": [767.4, 304.9, 937.3, 324.6],
    "a11y_snapshot": "a11y/S02.json"
  },
  "before": {
    "frame_id": "frm_0201", "t_ms": 9900, "display_id": "d0",
    "source_rect_screen_px": [0, 0, 1920, 1080], "scale": 0.758333,
    "full": { "path": "media/S02_before_full.png", "width": 1456, "height": 819, "est_tokens": 1560, "variant": "full" },
    "full_annotated": { "path": "media/S02_before_full_annotated.png", "width": 1456, "height": 819, "est_tokens": 1560, "variant": "full_annotated" },
    "crop": { "path": "media/S02_before_crop.png", "width": 800, "height": 500, "est_tokens": 522, "variant": "crop",
              "crop_origin_frame_px": [549.0, 125.1], "crop_scale": 1.3187 },
    "redacted_regions_frame_px": [[120, 60, 700, 88]]
  },
  "expected_result": { "text": "The user knows the AFS signed date.", "provenance": "inferred" },
  "annotation_ids": ["ann_0001", "ann_0003", "ann_0004"],
  "flags": ["contains_redaction"]
}
```

```json
{
  "step_id": "S03", "seq": 3, "kind": "decision", "t_start_ms": 36500, "t_end_ms": 41200,
  "phase": "Fill in the register form",
  "summary": "In the AppSheet register form, set Engagement type to Audit.",
  "summary_provenance": "observed",
  "why": { "text": "Only audits, independent reviews and compilations are tracked on the register.",
           "provenance": "user", "source_annotation_ids": ["ann_0005"] },
  "action": { "type": "select", "point_frame_px": [728.0, 372.3],
              "value": { "disposition": "literal", "literal": "Audit", "value_type": "option", "source": "selected" } },
  "target": {
    "grounding": "dom",
    "app": { "name": "Google Chrome", "process": "chrome.exe", "kind": "browser" },
    "url": { "text": "https://www.appsheet.com/start/[APP_ID]", "redacted": true, "classes": ["identifier"] },
    "element": { "role": "combobox", "native_role": "div[role=combobox]", "name": { "text": "Engagement type", "redacted": false }, "label": "Engagement type" },
    "locators": [
      { "strategy": "aria", "value": "combobox[name='Engagement type']", "rank": 1, "stability": "high" },
      { "strategy": "ocr_text", "value": "Engagement type", "rank": 2, "stability": "medium" }
    ],
    "bounds_screen_px": [640, 470, 1280, 512], "bounds_frame_px": [485.3, 356.4, 970.7, 388.3],
    "a11y_snapshot": "a11y/S03.json"
  },
  "before": {
    "frame_id": "frm_0301", "t_ms": 36400, "display_id": "d0",
    "source_rect_screen_px": [0, 0, 1920, 1080], "scale": 0.758333,
    "full": { "path": "media/S03_before_full.png", "width": 1456, "height": 819, "est_tokens": 1560, "variant": "full" },
    "crop": { "path": "media/S03_before_crop.png", "width": 800, "height": 500, "est_tokens": 522, "variant": "crop",
              "crop_origin_frame_px": [424.7, 182.8], "crop_scale": 1.3187 }
  },
  "decision": {
    "question": "Is this pack for an audit, an independent review or a compilation?",
    "branch_taken": "Audit: record it on the register",
    "branches": [
      { "condition": "Audit, independent review or compilation", "then": "Continue to S04", "observed": true, "provenance": "user" },
      { "condition": "Any other document type (for example a tax return or engagement letter)", "then": "Stop; do not record", "observed": false, "provenance": "user" }
    ]
  },
  "expected_result": { "text": "Engagement type shows Audit.", "provenance": "observed" },
  "annotation_ids": ["ann_0005"]
}
```

### 6.3 annotations.jsonl

```jsonl
{"annotation_id":"ann_0001","kind":"highlight","t_ms":17100,"provenance":"user","step_ids":["S02"],"anchor":"explicit","mark":"H1","shape":"rect","frame_id":"frm_0201","geometry_frame_px":[[760,298],[945,331]],"snapped_to":{"role":"cell","name":"Completed","bounds_frame_px":[767.4,304.9,937.3,324.6],"grounding":"dom"},"linked_annotation_ids":["ann_0003"]}
{"annotation_id":"ann_0002","kind":"narration","t_ms":3000,"t_end_ms":5600,"provenance":"user","step_ids":["S01"],"anchor":"time_aligned","anchor_confidence":0.92,"text":"So the email just tells me it's done, I need to open the actual pack to see the date.","redacted":false}
{"annotation_id":"ann_0003","kind":"comment","t_ms":17400,"provenance":"user","step_ids":["S02"],"anchor":"explicit","category":"rule","text":"Use this Completed date (when the last person signed), not the date the email arrived. This is the date that starts the 40-day clock.","linked_annotation_ids":["ann_0001"]}
{"annotation_id":"ann_0004","kind":"narration","t_ms":9900,"t_end_ms":16400,"provenance":"user","step_ids":["S02"],"anchor":"time_aligned","anchor_confidence":0.88,"text":"Okay so here under the signers, Completed, that's the one I want.","redacted":false}
{"annotation_id":"ann_0005","kind":"narration","t_ms":36000,"t_end_ms":40800,"provenance":"user","step_ids":["S03"],"anchor":"time_aligned","anchor_confidence":0.9,"category":"decision","text":"We only put audits, independent reviews and compilations on the register, so if it was a tax return I'd stop here.","redacted":false}
{"annotation_id":"ann_0006","kind":"comment","t_ms":52900,"provenance":"user","step_ids":["S05"],"anchor":"explicit","category":"variation","text":"Sometimes Save spins for a long time. Wait for the green Saved banner before closing, otherwise it doesn't go through."}
```

### 6.4 PROCESS.md (as the generator would render it)

```markdown
# Record the AFS signed date on the lockdown register
> Goal: capture the QuicklySign Completed date in the AppSheet register so the 40/60-day clocks start.
> Trigger: QuicklySign "document completed" email · Systems: Outlook, QuicklySign (web), AppSheet (web)
> Recorded 2026-11-20 (SAST) by Admin assistant · 5 steps · package pkg_01JDX7Q9…

## Before you start
- Inputs: {{client_name}} (org name; from the email subject), {{afs_signed_date}} (date; read at S02)

## Steps
### Open the signed pack
**S01. In the QuicklySign "document completed" email, click View document.** [observed]
- Where: Outlook › message window › link "View document" (accessibility)
- Why: the email only says the pack is complete; the date is on the QuicklySign page. [user, ann_0002]
- Result: Chrome opens the QuicklySign document page.

**S02. On the QuicklySign document page, read the Completed date (H1).** [observed]
- Where: Chrome › app.quicklysign.com/documents/[ID] › cell "Completed" (dom)
- Why: "Use this Completed date (when the last person signed), not the date the email arrived.
  This is the date that starts the 40-day clock." [user, ann_0003 on H1]
- Rule: email arrival date is NOT the signed date. [user, ann_0003]

### Fill in the register form
**S03. Decision: set Engagement type to Audit.** [observed]
| If | Then | Seen here |
|---|---|---|
| Audit, independent review or compilation | continue to S04 | yes |
| Any other document type (e.g. tax return) | stop, do not record | no (stated by user, ann_0005) |

**S04. Type {{afs_signed_date}} (from S02, format YYYY/MM/DD) into "AFS signed date".** [observed]

**S05. Click Save; wait (≈2.3 s, system) until the green "Saved" banner appears.** [observed]
- Warning: sometimes Save is slow; closing early loses the entry. [user, ann_0006]
- Images: media/S05_before_full.png, media/S05_before_crop.png, media/S05_after_full.png

## Open questions (generated)
- How does the form know which client this is? No client-selection step was recorded. (between S02 and S03)
- S05 "why" is inferred, not stated by the user.
- Branch "other document type" was described but not observed.
```

### 6.5 What a good Claude answer looks like (for acceptance check 4)

A fresh Claude should:
- Rebuild five steps in order, each citing S01 to S05.
- Name `afs_signed_date` as a parameter copied from S02 into S04.
- State the S03 rule with both branches marked `[user]`, and mark the "other type" branch as unobserved.
- Flag the missing client-identification step as a gap.
- Propose `browser` automation for S02 to S05. QuicklySign also has a REST API with webhooks per the brief, so the better automation skips the UI for S01 and S02.
- Never guess a client name or a date.

---

## 7. Merging several sessions of the same process into variants [I]

This section is a proposal and the least-sourced part of the document. It draws on process-mining notions of variants (a variant is a distinct trace), on segmentation and trace-alignment work [S], and on DITA's `steps-unordered` [S].

**Inputs:** N immutable session packages with the same `process.process_key`. The user picks the key when recording ("Which process is this?" with autocomplete) or confirms one suggested locally before export (principle 8).

**Prior art.** Agent Workflow Memory (Wang et al., ICML 2025) induces reusable workflows, each a description plus steps, from several agent trajectories with a model prompt [S]. A later study found many induced workflows "too generic" and a large share induced from failed trajectories [S]. Two lessons for us [I]: merge only traces the user marked as complete runs, and keep the concrete step evidence next to any generalised step.

**Algorithm:**
1. **Segment.** If a session contains more than one run, or an interruption (say, an unrelated email), split it at `is_complete_run` boundaries marked by the user, or at long `human` waits combined with app switches out of the process's systems. Every segment becomes a trace. Segments the user rejects are dropped from merging but stay in the package.
2. **Compute a step signature:** `(app.name, action.type, target.element.role, normalise(label or name), url path template)`. Normalising strips digits, placeholders and casing. The URL template replaces ids with `[ID]`.
3. **Align pairwise.** Run Needleman–Wunsch over signatures with this similarity:
   - 1.0 for an exact match.
   - 0.7 for the same app, same role and fuzzy label match.
   - 0.4 for the same app and same action type.
   - Gap penalty -0.5.
   - Pairs scored 0.7 or 0.4 are ambiguous. They go to a judge model with both summaries and crops, asking "same step?". The verdict is stored with `provenance: inferred`. This runs on exported packages only, so a cloud model is allowed here (see principle 8 in section 3).
4. **Build the multiple alignment.** Use a star alignment around a reference run: the session marked `is_happy_path` with the most steps. Progressive alignment by a guide tree is the fallback when there is no reference.
5. **Classify each column** of the alignment:
   - **core:** present in every trace.
   - **optional:** present in some traces, a gap in the others.
   - **alternative (XOR):** different signatures in the same column across traces. Link it to a `decision` step or a `variation` comment when one exists. Otherwise create a decision with "condition unknown".
   - **repeated (loop):** the same signature consecutively k times in a trace. Record min, max and median k.
   - **unordered (AND):** the same set of steps in different orders across traces, detected when a block aligns better after permutation.
6. **Classify each value** per merged step. The same literal everywhere becomes a constant. Literals that vary become a parameter, with a name proposed from the field label. Redacted values become a parameter named by the placeholder; reconcile placeholder names across sessions.
7. **Merge conditions only from user text.** A branch condition comes only from `decision.branches[].condition` or from comments. Otherwise it is an open question shown in the recorder's "merge review" screen.
8. **Output** a derived folder that never modifies sessions:

```
family/afs-signed-date-to-register/
├── family.json          # sessions[], alignment (merged_step_id -> [{package_id, step_id}]), variant list with frequencies
├── variants/
│   ├── V1.json          # ordered merged_step_ids for one distinct trace + which sessions follow it
│   └── V2.json
├── PROCESS_FAMILY.md    # canonical SOP with Core/Optional/If-then/Repeat/Any-order blocks, citing package:step
└── CLAUDE_HANDOFF.md    # same rules; reads family.json then opens session packages only for evidence
```

Each merged step keeps `occurs_in: [{package_id, step_id}]` and `support: k/N`. Claude cites `pkg_…:S03` when it reasons across sessions.

Targets for merged steps: locators are re-ranked by agreement across sessions. A locator whose value is the same in all sessions gets `stability: high`. One that changes between sessions (such as an AutomationId that differs across app builds) is demoted. This is the practical answer to Microsoft's warning that AutomationId is not stable across builds [P].

How many sessions [I]:
- One session gives the happy path.
- Three to five sessions from at least two people usually surface the common variants. WONDERBREAD averaged 4.9 demonstrations per workflow [E], which is a reasonable default target.

---

## 8. Scoring acceptance check 4 [I]

"A fresh Claude given only the package rebuilds the steps of a known test process."

1. **Fixture:** write the reference SOP (`tests/fixtures/<process>/reference_sop.json`) before recording. It lists N steps, each with app, control (role and label), action and value type, plus decisions and rules. Keep it outside the package.
2. **Run:** in a clean Claude Code session with no repo context and the working directory set to the package folder, use the prompt "Follow CLAUDE_HANDOFF.md." Record the model id and effort level.
3. **Score**, using WONDERBREAD's precision and recall method [E]:
   - **Step precision / recall / F1.** Match generated steps to reference steps with an LLM judge, and have a human spot-check every match.
   - **Order:** no inversions among matched core steps.
   - **Target accuracy:** app plus control (role and label) correct for at least 90% of action steps.
   - **Evidence:** 100% of generated steps cite at least one valid step id.
   - **Faithfulness:** zero generated steps that have no evidence and are not flagged as gaps.
   - **Parameters:** every redacted value appears as a parameter and none is guessed.
   - **Decisions:** every user-stated decision is recovered with its provenance.
4. **Proposed pass bar:** step F1 at least 0.9, plus all binary checks passing, on two different test processes (one Windows, one Mac).
5. **Diagnostics (not a gate):** a text-only ablation with images removed, and a high-res profile run, to measure what each adds.

---

## 9. Interoperability exports [I]

- **OCEL 2.0 JSON** (for process mining):
  - Event types are action types.
  - Each step becomes an event: `{id: "<pkg>:S03", type: "select", time, attributes: [summary, grounding, …], relationships: [{objectId: "app:chrome", qualifier: "performed-in"}, {objectId: "ui:appsheet/engagement-type", qualifier: "target"}, {objectId: "param:afs_signed_date", qualifier: "writes"}, {objectId: "session:<pkg>", qualifier: "part-of"}]}`.
  - Object types are session, application, ui_element, parameter and business_object (client and engagement placeholders).
  - O2O relations express "ui_element part-of application".
- **XES with the Abb & Rehse UILog extension** (for tools that expect traces).
- **Claude Code skill:** `SKILL.md` (with `name` = process_key and `description` = goal plus trigger), with PROCESS_FAMILY.md content, `reference/steps.jsonl` and `media/`. This lets an assistant Claude walk a user through the process or run it with computer use.

---

## 10. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| ProfSoft through Citrix/RDP gives no control metadata, so steps are `visual_only` | High | Grounding field; OCR text plus crops plus image anchors; narration prompts ("say what you're clicking"); spike to confirm ProfSoft's access mode early |
| PII leaks through text channels (titles, URLs, element names, transcripts) even when pixels are blurred | High | One redaction engine over every text field; crops cut from redacted frames; raw keystrokes never exported; required `reviewed_by_user` attestation; redaction report; audio off by default |
| Coordinate errors (Retina 2x, multi-monitor, server-side resize) | Medium | Per-frame transform; pre-resize to the profile; `oversized_image: "error"` in the packer; validator checks bounds against frame size |
| Too many images breaks the many-image limit or costs too much | Medium | 1,568 px profile (under both the 2,000 and 3,000 px caps); `after` frames only when needed; text first with images on demand; token budget in the manifest |
| Narration attached to the wrong step | Medium | `anchor_confidence`; reviewer can re-anchor; typed comments treated as stronger evidence |
| Model invents steps or conditions | Medium | Provenance tags; required evidence citations; conditions only from user text; check 4 faithfulness metric |
| AutomationId or DOM selectors drift between app versions | Medium | Ranked multi-locator bundle; cross-session agreement re-ranking; app version recorded |
| Schema churn while lanes build in parallel | Medium | `schema_version` and a schema copy in every package; core lane owns the schema; additive changes only within 0.x |
| Accessibility hit-testing slows the UI or misses custom-drawn controls (Caseware grids, Excel cells) | Medium | Capture-lane spike; fall back to `ocr`; for Excel, consider cell references through the app's object model (unverified) |

---

## 11. Open questions

1. How is ProfSoft delivered at Moore: thick client, browser, or Citrix/RDP? This decides how much of the most important system can be grounded.
2. Should the default export include an optional low-frame-rate video, for steps the step model cannot express (such as hover menus)? It costs privacy and size.
3. Should the export include `high` profile frames for dense Caseware and Excel screens, or do native crops suffice? Measure this in the check 4 ablation.
4. Which value types may be `literal` by default (menu options, engagement types, dates?) under Moore's POPIA policy, and who approves the allow list?
5. Where does transcription run (on device is the assumption), and in which languages? Afrikaans narration is likely at a Stellenbosch firm.
6. Is the consumer in Superbrain a Claude Code or agent session reading the folder, or a backend Messages API call? Both are designed for here; the planner should pick the acceptance target.
7. Who owns `process_key` naming across a firm: the users, or an admin-curated list?
8. Does a Claude Code skill export count as a first-class deliverable, or a later lane?
9. Check the macOS AX attribute list (AXSubrole, AXPosition/AXSize, AXSecureTextField) against Apple's reference in the capture spike.
10. Is a local model (for transcription, narration realignment, inferred whys and `process_key` suggestions) acceptable and available on staff machines? If not, those fields stay empty until the user fills them in review, because the owner rule keeps cloud Claude off anything that has not been exported (principle 8).

---

## 12. Sources (retrieved 2026-11-21 unless noted)

Anthropic (primary):
- Vision: https://platform.claude.com/docs/en/build-with-claude/vision [P]
- Coordinates and bounding boxes: https://platform.claude.com/docs/en/build-with-claude/vision-coordinates [P]
- Computer use tool: https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool [E]
- Prompting best practices (long context, XML, crop tool): https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices [P]
- Agent Skills overview: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview [P]
- `claude-api` skill bundled with Claude Code 2.1.330, `shared/model-migration.md` (cached 2026-11-03): the 2,000 px screenshot note, high-res tier history and model prices [P, local file]

Microsoft:
- UIA Automation Element Property Identifiers (updated 2025-07-14): https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-automation-element-propids [P]
- Power Automate, Citrix and RDP automation (snippets): https://learn.microsoft.com/en-us/power-platform-release-plan/2020wave1/power-automate/run-ui-automation-scripts-virtual-machines ; https://learn.microsoft.com/en-us/power-automate/desktop-flows/virtual-desktops [S]
- UiPath Citrix automation (snippets): https://docs.uipath.com/studio/standalone/latest/user-guide/automating-citrix-technologies [S]

Research and standards:
- WONDERBREAD (NeurIPS 2024): https://arxiv.org/abs/2406.13264 (HTML v2 read) [E]
- ECLAIR / Automating the Enterprise with Foundation Models (PVLDB 17, 2024): https://arxiv.org/abs/2405.03710 [S]
- OCEL 2.0 specification: https://arxiv.org/abs/2403.01975 (HTML v1 read), https://www.ocel-standard.org [E]
- Abb & Rehse, A Reference Data Model for Process-Related User Interaction Logs (BPM 2022): https://arxiv.org/abs/2207.12054 and ar5iv HTML [E]; extended version in *Information Systems* 124 (2024), https://dblp.uni-trier.de/rec/journals/is/AbbR24.html [S]
- IEEE 1849-2023 XES: https://standards.ieee.org/ieee/1849/10907 ; https://www.xes-standard.org/ [S]
- Mind2Web: https://arxiv.org/abs/2306.06070 [S]
- OmniACT: https://arxiv.org/abs/2402.17553 [S]
- OpenCUA / AgentNet: https://arxiv.org/abs/2508.09123 [S]
- OSWorld: https://arxiv.org/abs/2404.07972 ; WebArena: https://arxiv.org/abs/2307.13854 ; A11y-Compressor (ACL SRW 2026): https://aclanthology.org/2026.acl-srw.50.pdf ; Spider2-V: https://arxiv.org/abs/2407.10956 [S]
- Set-of-Mark prompting: https://arxiv.org/abs/2310.11441 [S]
- Agent Workflow Memory (ICML 2025): https://arxiv.org/abs/2409.07429 [S]
- Leno et al., routine identification from unsegmented UI logs: https://arxiv.org/abs/2008.05782 ; https://arxiv.org/abs/2106.13446 ; Agostinelli et al. 2021 (trace alignment segmentation) [S]
- DITA 1.3 task elements (OASIS): https://docs.oasis-open.org/dita/dita/v1.3/os/part2-tech-content/langRef/containers/task-elements.html [S]
- macOS NSAccessibility (Apple, retired Cocoa guide): https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/Accessibility/cocoaAXOverview/cocoaAXOverview.html [S]
