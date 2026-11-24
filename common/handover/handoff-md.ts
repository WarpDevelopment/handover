// CLAUDE_HANDOFF.md: `package-spec.md` §12 with the tester-build changes (tester-package.md §6).
//
// Kept verbatim from §12: the title line, the opening paragraph and the whole "Rules" section
// (`handoff-md.test.ts` compares the Rules text with the spec file itself).
// Changed, as §6 of tester-package.md says:
//   - "Read in this order": manifest.json, PROCESS.md, steps.jsonl, annotations.jsonl, gaps.jsonl,
//     then images. No dataflow.json, prompts.jsonl, readiness.json, a11y/ or schema folder.
//     The image paragraph drops `manifest.media.image_policy` (the tester manifest has none).
//   - "Produce": asks for `process_spec.md`, written next to the package.

export const HANDOFF_RULES = `## Rules
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
`;

export function renderHandoffMd(args: { title: string }): string {
  return `# Handoff: recorded process "${args.title}"

You are reading a recording of one person doing a task on their computer. They reviewed and
redacted it on their own machine before export. Your job is to understand the process exactly as
performed and explained, and to produce a process specification that an automation engineer
(human or agent) could implement without watching the recording.

## Read in this order
1. manifest.json: goal, done-when, trigger, capture scope and capabilities, displays.
2. PROCESS.md: the readable outline. Treat it as an index, not as ground truth.
3. steps.jsonl: the ground truth, one step per line. Every claim you make must cite step ids (S01…).
4. annotations.jsonl: the person's highlights (H1…), comments and narration. Comments and
   explicitly anchored highlights are the strongest evidence of intent. Narration is
   time-aligned and may belong to a neighbouring step (see anchor_confidence).
5. gaps.jsonl: intervals the recorder did not see.
6. Images, only when you need them: media/<step>_before_crop.png to see the target,
   media/<step>_before_full*.png for context.
   Coordinates ending in _fpx are in the step's frame space (pixels of *_full.png when it exists);
   crop pixels map back with crop_origin_fpx and crop_scale.

${HANDOFF_RULES}
## Produce
Write process_spec.md next to this package (not inside the package folder), containing:
1. The steps, each citing step ids.
2. Decisions and what they depend on.
3. Inputs and outputs.
4. Systems used.
5. Open questions, ranked by how much they block automation.
6. Steps unsafe to automate (irreversible, regulatory, judgement calls).
Quote the comment or narration you relied on for every "why".
`;
}
