# Handoff: recorded process "Save the budget and open mail"

TEST BUILD — use test data only, not real client data.

You are reading a recording of one person doing a task on their computer. They reviewed it on their
own machine before export. Your job is to understand the process exactly as performed and
explained, and to produce a process specification that an automation engineer (human or agent)
could implement without watching the recording.

## Read in this order
1. manifest.json: goal, done-when, trigger, capture capabilities, displays, timing.
2. PROCESS.md: the readable outline. Treat it as an index, not as ground truth.
3. steps.jsonl: the ground truth, one step per line. Every claim you make must cite step ids (S01…).
4. annotations.jsonl: the person's highlights (H1…), comments and narration. Comments and
   explicitly anchored highlights are the strongest evidence of intent. Narration is time-aligned
   and may belong to a neighbouring step (see anchor_confidence).
5. gaps.jsonl: intervals the recorder did not see.
6. Images, only when you need them: media/<step>_before_crop.png to see the target,
   media/<step>_before_full*.png for context. Coordinates ending in _fpx are in the step's frame
   space (pixels of *_full.png); crop pixels map back with crop_origin_fpx and crop_scale.

## Rules
- Label every statement [observed] (in steps or images), [user] (said, typed or chosen by the
  person) or [inferred] (your reasoning). Never present an inference as observed.
- Do not invent steps. Intervals in gaps.jsonl were not observed: do not put steps inside them.
  List them under "gaps" with the step ids on either side.
- Do not invent steps inside gaps.
- A blurred region is deliberate redaction, not missing UI.
- This is one recorded run. Variants the person did not perform or describe are unknown: list
  them as open questions, do not invent them.
- Evidence tier tells you how far to trust a target: T3 real control, T2 weak control, T0 pixels
  only. For T0 steps describe the target by visible text and position and say so.
  target.unavailable.reason says why.
- Times are milliseconds from recording start; the timezone is manifest.recording.timezone.

## Produce
Write process_spec.md next to this package (not inside the package folder), containing:
1. The steps, each citing step ids.
2. Decisions and what they depend on.
3. Inputs and outputs.
4. Systems used.
5. Open questions, ranked by how much they block automation.
6. Steps unsafe to automate (irreversible, regulatory, judgement calls).
Quote the comment or narration you relied on for every "why".
