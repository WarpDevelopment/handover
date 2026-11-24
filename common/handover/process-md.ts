// PROCESS.md: rendered by deterministic code from the package data (tester-package.md §5).
// No model. LF endings, one trailing newline, no trailing spaces.

import { dateInTimezone, formatDuration } from "./canonical";
import { LINE_BREAKS } from "./edits";
import type { AnnotationRecord, GapRecord, StepRecord } from "./types";

export interface ProcessMdData {
  process: {
    title: string;
    goal: string;
    done_when: string;
    trigger: { kind: string; text: string };
  };
  author: { position: string };
  recording: { started_at_ms: number; timezone: string; task_ms: number };
  package_id: string;
  steps: StepRecord[];
  annotations: AnnotationRecord[];
  gaps: GapRecord[];
}

const GAP_REASON: Record<string, string> = {
  user_paused: "paused by the user",
  helper_restart: "the recorder's helper restarted",
  capture_lost: "screen capture was lost",
  permission_lost: "a permission was revoked",
  elevated_window: "an administrator window was in front",
};

/** The in-order notice for a stretch where Windows hid clicks from the recorder. */
function notObservedLine(g: GapRecord): string {
  const who = g.process ? ` (${oneLine(g.process)})` : "";
  return (
    `Not observed (${formatDuration(g.t_end_ms - g.t_start_ms)}): an administrator window${who} was in front. ` +
    "Windows does not let Handover see clicks there. Ask the author what was done."
  );
}

function tier(step: StepRecord): "T3" | "T2" | "T0" | "context" | "explain" {
  if (step.observed_via === "explain") return "explain";
  const g = step.target?.grounding;
  if (g === "none") return "context";
  if (g === "accessibility") return "T3";
  if (g === "accessibility_weak") return "T2";
  return "T0";
}

function unavailableReason(step: StepRecord): string | undefined {
  const u = step.target?.unavailable as { reason?: string } | undefined;
  return u?.reason;
}

/** One line: any kind of line break becomes a space, so text cannot start a heading or a fake step. */
function oneLine(s: string): string {
  return s.replace(LINE_BREAKS, " ").replace(/ +$/g, "");
}

function textOf(t: { text: string }): string {
  return oneLine(t.text);
}

function stripScheme(url: string): string {
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
}

function whereLine(step: StepRecord): string | undefined {
  if (step.kind === "manual") return "off screen";
  const t = step.target as
    | {
        grounding?: string;
        app?: { name?: string };
        window?: { title?: { text?: string } };
        url?: { text?: string };
        element?: { role?: string; name?: { text?: string } };
      }
    | undefined;
  if (!t) return undefined;
  const app = oneLine(t.app?.name || "unknown app");
  const rawPlace = t.url?.text ? stripScheme(t.url.text) : t.window?.title?.text;
  const place = rawPlace === undefined ? undefined : oneLine(rawPlace);
  if (t.grounding === "accessibility" || t.grounding === "accessibility_weak") {
    const el = t.element;
    const parts = [app];
    if (place) parts.push(place);
    parts.push(`${el?.role ?? "other"} "${oneLine(el?.name?.text ?? "")}"`);
    return `${parts.join(" › ")} (${t.grounding})`;
  }
  if (t.grounding === "visual_only") {
    const xy = step.action?.point_fpx;
    const img = step.before?.full.path;
    const pt = xy ? `${Math.round(xy[0])},${Math.round(xy[1])}` : "unknown";
    return `${app} › point ${pt} in ${img ?? "the screen"} (pixels only)`;
  }
  // Window title (not the URL) for an Explain step.
  const explainTitle = t.window?.title?.text;
  const where =
    step.observed_via === "explain" ? (explainTitle === undefined ? undefined : oneLine(explainTitle)) : place;
  return [app, where].filter(Boolean).join(" › ") + (step.observed_via === "explain" ? " (explain)" : " (app switch)");
}

function imagesLine(step: StepRecord): string | undefined {
  const paths = [
    step.before?.full.path,
    step.before?.full_annotated?.path,
    step.before?.crop?.path,
    step.after?.full.path,
  ].filter((p): p is string => typeof p === "string");
  return paths.length > 0 ? paths.join(", ") : undefined;
}

export function renderProcessMd(d: ProcessMdData): string {
  const stated = (s: string) => (s.trim() === "" ? "(not stated)" : s.trim());
  const lines: string[] = [];
  lines.push(`# ${d.process.title}`);
  lines.push(`> Goal: ${stated(d.process.goal)} · Done when: ${stated(d.process.done_when)}`);
  lines.push(
    `> Trigger: ${stated(d.process.trigger.text)} · Recorded ` +
      `${dateInTimezone(d.recording.started_at_ms, d.recording.timezone)} (${d.recording.timezone}) ` +
      `by ${d.author.position} · ${d.steps.length} steps · ` +
      `${formatDuration(d.recording.task_ms)} task time · package ${d.package_id}`,
  );
  lines.push("> TEST BUILD — test data only.");
  lines.push("");
  lines.push("## Steps");

  const byId = new Map(d.annotations.map((a) => [a.annotation_id, a]));
  const blind = d.gaps.filter((g) => g.reason === "elevated_window");
  const noticesAfter = (stepId: string | undefined) => {
    for (const g of blind) {
      if (g.after_step === stepId) {
        lines.push("");
        lines.push(notObservedLine(g));
      }
    }
  };
  noticesAfter(undefined);
  for (const step of d.steps) {
    lines.push("");
    const marks = step.annotation_ids
      .map((id) => byId.get(id))
      .filter((a): a is Extract<AnnotationRecord, { kind: "highlight" }> => a?.kind === "highlight")
      .map((a) => a.mark);
    const reason = unavailableReason(step);
    const tierNote = tier(step) !== "T3" && reason ? ` (${reason})` : "";
    lines.push(
      `**${step.step_id}. ${oneLine(step.summary)}**${marks.length ? ` (${marks.join(", ")})` : ""} ` +
        `\`[${step.summary_provenance}]\` · evidence ${tier(step)}${tierNote}`,
    );
    const where = whereLine(step);
    if (where) lines.push(`- Where: ${where}`);
    if (step.why) {
      const cite = ["user", ...step.why.source_annotation_ids].join(", ");
      lines.push(`- Why: ${textOf(step.why)} \`[${cite}]\``);
    }
    const used = new Set(step.why?.source_annotation_ids ?? []);
    for (const id of step.annotation_ids) {
      const a = byId.get(id);
      if (a?.kind === "comment" && !used.has(id)) {
        lines.push(`- Note (comment): "${textOf(a.text)}" \`[user, ${id}]\``);
      }
    }
    for (const id of step.annotation_ids) {
      const a = byId.get(id);
      if (a?.kind === "narration") lines.push(`- Narration: "${textOf(a.text)}" \`[narration, ${id}]\``);
    }
    const images = imagesLine(step);
    if (images) lines.push(`- Images: ${images}`);
    noticesAfter(step.step_id);
  }

  lines.push("");
  lines.push("## What the recorder could not see");
  const unseen: string[] = [];
  for (const g of d.gaps) {
    unseen.push(
      `- ${g.gap_id} (${g.after_step ?? "start"} → ${g.before_step ?? "end"}): ` +
        `${GAP_REASON[g.reason] ?? g.reason.replace(/_/g, " ")}, ${formatDuration(g.t_end_ms - g.t_start_ms)}.`,
    );
  }
  // Only steps with no control at all (T0). A weak control (T2) was identified, so it is not listed.
  for (const step of d.steps) {
    if (step.kind !== "action" || tier(step) !== "T0") continue;
    unseen.push(
      `- ${step.step_id}: no control identified (${unavailableReason(step) ?? "unknown"}); the target is pixels only.`,
    );
  }
  if (unseen.length === 0) unseen.push("- None.");
  lines.push(...unseen);
  return lines.join("\n") + "\n";
}
