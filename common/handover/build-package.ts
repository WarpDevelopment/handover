// buildPackage(session, edits, ctx): the pure, deterministic package builder (tester-package.md).
// No Electron imports. Same input and ctx give the same bytes for every text file; PNG bytes are
// stable for a fixed `sharp` build.

import type {
  AnnotationPayload,
  DisplaysPayload,
  GapPayload,
  PointerClickPayload,
} from "../events";
import type { RecEvent } from "../types";
import { canonicalJson, canonicalJsonl, isoWithOffset, sha256Hex, slugify, utf8 } from "./canonical";
import { assertEditsApplicable, foldEditText } from "./edits";
import {
  boundsToDpx,
  displayForGlobalPoint,
  dpxToFpx,
  estTokens,
  expectedFrameScale,
  fitFullImage,
  fpxToCrop,
  globalToDpx,
  planClickCrop,
  selectBeforeFrame,
  type DisplayInfo,
  type Rect,
} from "./geometry";
import { renderAnnotated, type RenderableHighlight } from "./annotation-render";
import { renderHandoffMd } from "./handoff-md";
import { blurPng, blurRect, clampRect, decode, renderCrop, renderFull } from "./images";
import { renderProcessMd } from "./process-md";
import {
  buildStepsWithState,
  clickLookupMs,
  groundingOf,
  isOwnAppName,
  layoutAt,
  type StepDraft,
} from "./steps";
import {
  SCHEMA_VERSION,
  TEST_BUILD_BANNER,
  type AnnotationRecord,
  type BuildContext,
  type Edit,
  type FrameRecord,
  type GapRecord,
  type PackageBytes,
  type PackageFileEntry,
  type SessionInput,
  type ShotEntry,
  type StepRecord,
  type TextObj,
} from "./types";

const round2 = (n: number): number => Math.round(n * 100) / 100;
const pad = (n: number, w: number): string => String(n).padStart(w, "0");
const text = (t: string): TextObj => ({ text: t, redacted: false, classes: [] });
const BEFORE_LEAD_MS = 50;
const AFTER_DELAY_MS = 500;
const AFTER_MAX_MS = 2000;
const PASSWORD_PAD_FRAME_PX = 4;
/** What a redacted text object looks like once the user has edited the step's wording (SEC-6). */
const REDACTED = "[REDACTED]";
const redactedText = (): TextObj => ({ text: REDACTED, redacted: true, classes: ["user_marked"] });
/** A freeze's frozen frame is looked for this far before `explain.start` (PKG-6). */
const FROZEN_FRAME_LEAD_MS = 1000;

export function packageFolderName(title: string, packageId: string): string {
  return `${slugify(title)}__${packageId}.handover`;
}

/**
 * The rectangle to blur for a password field, in pixels of the captured frame (`capK` frame px per
 * dpx). It is clamped to the frame before anything else. When the control's bounds miss the frame
 * entirely (bad bounds from the helper), a 400×100 logical-px rectangle around the click is used
 * instead; when that misses too, the export fails rather than claim a redaction that did not happen.
 */
export function passwordRectFrame(
  display: DisplayInfo,
  capK: number,
  frameWidth: number,
  frameHeight: number,
  elementDpx: Rect | undefined,
  pointDpx: [number, number],
): Rect {
  const grown = (r: Rect): Rect | null =>
    clampRect(
      [
        r[0] * capK - PASSWORD_PAD_FRAME_PX,
        r[1] * capK - PASSWORD_PAD_FRAME_PX,
        r[2] * capK + 2 * PASSWORD_PAD_FRAME_PX,
        r[3] * capK + 2 * PASSWORD_PAD_FRAME_PX,
      ],
      frameWidth,
      frameHeight,
    );
  const fromElement = elementDpx ? grown(elementDpx) : null;
  if (fromElement) return fromElement;
  const around = grown([
    pointDpx[0] - 200 * display.scaleFactor,
    pointDpx[1] - 50 * display.scaleFactor,
    400 * display.scaleFactor,
    100 * display.scaleFactor,
  ]);
  if (around) return around;
  throw new Error("Cannot blur a password field: its position is outside the captured frame.");
}

interface Layout {
  t: number;
  payload: DisplaysPayload;
}

interface Interval {
  start: number;
  end: number;
}

function unionLength(intervals: Interval[]): number {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  let total = 0;
  let curEnd = -Infinity;
  let curStart = 0;
  for (const i of sorted) {
    if (i.start > curEnd) {
      if (curEnd > -Infinity) total += curEnd - curStart;
      curStart = i.start;
      curEnd = i.end;
    } else if (i.end > curEnd) {
      curEnd = i.end;
    }
  }
  if (curEnd > -Infinity) total += curEnd - curStart;
  return total;
}

function clip(i: Interval, duration: number): Interval | null {
  const start = Math.max(0, Math.min(i.start, duration));
  const end = Math.max(start, Math.min(i.end, duration));
  return end > start ? { start, end } : null;
}

/**
 * Gap convention: a `gap` event without `tEndMs` opens a gap at its `t`; a later `gap` with the
 * same reason and a `tEndMs` closes it (ending at `tEndMs`); an unclosed gap runs to session end.
 * A `gap` with `tEndMs` and nothing open for its reason is a complete gap starting at its own `t`.
 */
export function resolveGaps(
  events: readonly RecEvent[],
  durationMs: number,
): { reason: GapPayload["reason"]; start: number; end: number }[] {
  const out: { reason: GapPayload["reason"]; start: number; end: number }[] = [];
  const open = new Map<string, { reason: GapPayload["reason"]; start: number; end: number }>();
  for (const ev of eventsOfType(events, "gap")) {
    const p = ev.payload as unknown as GapPayload;
    const current = open.get(p.reason);
    if (p.tEndMs === undefined) {
      if (current) continue; // already open for this reason
      const g = { reason: p.reason, start: ev.t, end: durationMs };
      open.set(p.reason, g);
      out.push(g);
    } else if (current) {
      current.end = Math.max(current.start, p.tEndMs);
      open.delete(p.reason);
    } else {
      out.push({ reason: p.reason, start: ev.t, end: Math.max(ev.t, p.tEndMs) });
    }
  }
  return out;
}

/** Pause, explain and task time. `task_ms + explain_ms + paused_ms = duration_ms`. */
export function computeTiming(events: readonly RecEvent[], durationMs: number) {
  const gapIntervals: Interval[] = [];
  const explain: Interval[] = [];
  let explainOpen: number | null = null;
  for (const g of resolveGaps(events, durationMs)) {
    if (g.reason !== "user_paused") continue;
    const c = clip({ start: g.start, end: g.end }, durationMs);
    if (c) gapIntervals.push(c);
  }
  for (const ev of [...events].sort((a, b) => a.t - b.t || a.seq - b.seq)) {
    if (ev.type === "explain.start") {
      if (explainOpen === null) explainOpen = ev.t;
    } else if (ev.type === "explain.end") {
      if (explainOpen !== null) {
        const c = clip({ start: explainOpen, end: ev.t }, durationMs);
        if (c) explain.push(c);
        explainOpen = null;
      }
    }
  }
  if (explainOpen !== null) {
    const c = clip({ start: explainOpen, end: durationMs }, durationMs);
    if (c) explain.push(c);
  }
  const paused = Math.round(unionLength(gapIntervals));
  // Explain time that overlaps a pause counts as paused, not explain.
  const explainMs = Math.round(unionLength([...explain, ...gapIntervals])) - paused;
  const explainAdj = Math.max(0, explainMs);
  return {
    paused_ms: paused,
    explain_ms: explainAdj,
    task_ms: durationMs - paused - explainAdj,
  };
}

interface Candidate {
  shot: ShotEntry;
  t: number;
}

interface DraftStep {
  /** Pre-edit id `S01…`. */
  id: string;
  draft: StepDraft;
  tEnd: number;
  display?: DisplayInfo;
  layout?: DisplaysPayload;
  /** Set on an Explain step: the frozen frame it is drawn on. */
  explain?: { displayElectronId: number; shotFile?: string; freezeIdx: number };
}

function eventsOfType(events: readonly RecEvent[], type: string): RecEvent[] {
  return events.filter((e) => e.type === type).sort((a, b) => a.t - b.t || a.seq - b.seq);
}

/** The times between `explain.start` and `explain.end`; an unclosed freeze runs to session end. */
export function explainIntervals(
  events: readonly RecEvent[],
  durationMs = Infinity,
): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let open: { start: number; end: number } | null = null;
  for (const ev of [...events].sort((a, b) => a.t - b.t || a.seq - b.seq)) {
    if (ev.type === "explain.start") {
      if (!open) {
        open = { start: ev.t, end: durationMs };
        out.push(open);
      }
    } else if (ev.type === "explain.end" && open) {
      open.end = Math.max(open.start, ev.t);
      open = null;
    }
  }
  return out;
}

/** Event types the collectors produce. None of them can be a real user action while the screen is frozen. */
const FROZEN_DROPPED_TYPES: ReadonlySet<string> = new Set([
  "pointer.click",
  "app.activate",
  "app.title-change",
  "browser.url",
]);

/** A click whose resolved control belongs to Handover itself (its bar or its overlay). */
export function isOwnAppClick(click: PointerClickPayload): boolean {
  const name = click.target?.app?.name?.trim().toLowerCase() ?? "";
  const proc = (click.target?.app?.process ?? "").trim().toLowerCase().replace(/\.exe$/, "");
  return name === "handover" || proc === "handover";
}

/**
 * Events with the ones that cannot be the user's own work removed:
 * - collector events inside a freeze (`[explain.start, explain.end)`) or a pause: clicks on the
 *   overlay are on Handover's own windows, and the overlay taking focus is not an app switch;
 * - a `pointer.click` is judged by when the user acted, not when the helper reported it: the helper
 *   reports up to 300 ms after the mouse-down (`lookupMs`), so the click on the overlay's Done button
 *   or on Resume can arrive just after the freeze or pause has ended;
 * - a click on a Handover control (the recording bar's own buttons);
 * - Handover's own `app.activate` and window-title events: clicking its bar or overlay makes it the
 *   foreground app, and that is not a "Switch to Handover" step (PKG-10).
 */
export function withoutFrozenCollectorEvents(
  events: readonly RecEvent[],
  durationMs = Infinity,
): RecEvent[] {
  const freezes = explainIntervals(events, durationMs);
  const pauses = resolveGaps(events, durationMs)
    .filter((g) => g.reason === "user_paused")
    .map((g) => ({ start: g.start, end: g.end }));
  const quiet = [...freezes, ...pauses];
  return events.filter((e) => {
    if (e.type === "pointer.click") {
      const click = e.payload as unknown as PointerClickPayload;
      if (isOwnAppClick(click)) return false;
      const acted = e.t - clickLookupMs(click);
      return !quiet.some((i) => acted >= i.start && acted < i.end);
    }
    if (e.type === "app.activate" || e.type === "app.title-change") {
      const p = e.payload as { app?: unknown; path?: unknown };
      if (
        isOwnAppName(
          typeof p.app === "string" ? p.app : undefined,
          typeof p.path === "string" ? p.path : undefined,
        )
      ) {
        return false;
      }
    }
    if (!FROZEN_DROPPED_TYPES.has(e.type)) return true;
    return !freezes.some((i) => e.t >= i.start && e.t < i.end);
  });
}

export interface BuiltPackage {
  files: PackageBytes;
  /** Pre-edit id (`S01…`) of each step in the output, in output order (`S01` is index 0). */
  stepIds: string[];
}

export async function buildPackage(
  session: SessionInput,
  edits: readonly Edit[],
  ctx: BuildContext,
): Promise<PackageBytes> {
  return (await buildPackageDetailed(session, edits, ctx)).files;
}

export async function buildPackageDetailed(
  session: SessionInput,
  edits: readonly Edit[],
  ctx: BuildContext,
): Promise<BuiltPackage> {
  // Fail closed first: never export while ignoring an edit this build cannot apply.
  assertEditsApplicable(edits);

  const events = [...session.events].sort((a, b) => a.t - b.t || a.seq - b.seq);
  const startEv = events.find((e) => e.type === "session.start") ?? events[0];
  const baseEpoch = startEv ? startEv.epoch - startEv.t : session.meta.startedAt;
  const stopEv = [...events].reverse().find((e) => e.type === "session.stop");
  const lastT = events.length ? events[events.length - 1].t : 0;
  const durationMs = Math.round(
    stopEv
      ? stopEv.t
      : session.meta.stoppedAt != null
        ? session.meta.stoppedAt - baseEpoch
        : lastT,
  );
  const timing = computeTiming(events, durationMs);

  // --- Displays ---
  const layouts: Layout[] = eventsOfType(events, "displays").map((e) => ({
    t: e.t,
    payload: e.payload as unknown as DisplaysPayload,
  }));
  const displayIds = new Map<number, string>();
  const manifestDisplays: {
    display_id: string;
    global_space: string;
    origin_global: [number, number];
    size_dpx: [number, number];
    scale_factor: number;
    primary: boolean;
  }[] = [];
  for (const l of layouts) {
    for (const d of l.payload.displays) {
      if (displayIds.has(d.id)) continue;
      const id = `d${displayIds.size}`;
      displayIds.set(d.id, id);
      manifestDisplays.push({
        display_id: id,
        global_space: l.payload.globalSpace,
        origin_global: [d.originGlobal[0], d.originGlobal[1]],
        size_dpx: [d.sizeDpx[0], d.sizeDpx[1]],
        scale_factor: d.scaleFactor,
        primary: d.primary,
      });
    }
  }

  const clickToDpx = (click: PointerClickPayload, tMs: number): [number, number] => {
    const layout = layoutAt(layouts, tMs);
    const d = layout && displayForGlobalPoint(layout, click.x, click.y);
    if (!layout || !d) return [click.x, click.y];
    return globalToDpx(layout.globalSpace, d, click.x, click.y);
  };

  // --- Steps (pre-edit ids) ---
  const freezes = explainIntervals(events, durationMs);
  const { steps: baseDrafts, stateAt } = buildStepsWithState(
    withoutFrozenCollectorEvents(events, durationMs),
    clickToDpx,
  );

  // Explain steps (tester-package.md §4.4): each freeze with highlights or a comment becomes one step
  // per display that got a highlight (one step for the pointer's display when there are only
  // comments), drawn on the frozen frame the user annotated.
  const annEvents = eventsOfType(events, "annotation");
  const explainItems: { draft: StepDraft; explain: NonNullable<DraftStep["explain"]>; endMs: number }[] = [];
  freezes.forEach((f, freezeIdx) => {
    const inside = annEvents
      .filter((ev) => ev.t >= f.start && ev.t <= f.end)
      .map((ev) => ({ ev, p: ev.payload as unknown as AnnotationPayload }));
    const highlights = inside.filter(
      (a) => a.p.kind === "highlight" && a.p.shape && a.p.pointsDpx && typeof a.p.displayId === "number",
    );
    if (highlights.length === 0 && !inside.some((a) => a.p.kind === "comment")) return;
    const startEv = events.find((e) => e.type === "explain.start" && e.t === f.start);
    const startPayload = (startEv?.payload ?? {}) as { displayIds?: number[]; pointerDisplayId?: number };
    const layout = layoutAt(layouts, f.start);
    let targets = [...new Set(highlights.map((a) => a.p.displayId as number))];
    if (targets.length === 0) {
      const fallback =
        startPayload.pointerDisplayId ??
        startPayload.displayIds?.[0] ??
        layout?.displays.find((d) => d.primary)?.id ??
        layout?.displays[0]?.id;
      targets = fallback === undefined ? [] : [fallback];
    }
    // App, window and URL frontmost at freeze time: what the events up to `explain.start` say, not
    // the last step (a title change or a URL change is not a step but moves the window). When
    // nothing was seen yet the app is unknown, not whatever came later.
    const prior = stateAt(f.start);
    for (const displayElectronId of targets) {
      let shotFile = highlights.find((a) => a.p.displayId === displayElectronId && a.p.frameFile)?.p.frameFile;
      if (!shotFile || !session.files.has(shotFile)) {
        // Nearest frozen frame of that display to the moment of the freeze, taken during the
        // freeze (or just before it); a frame from another freeze is a different screen.
        const startEpoch = startEv?.epoch ?? baseEpoch + f.start;
        const endEpoch = baseEpoch + f.end;
        let best: ShotEntry | undefined;
        for (const s of session.shots) {
          if (s.purpose !== "annotation" || s.displayId !== displayElectronId) continue;
          if (s.epoch < startEpoch - FROZEN_FRAME_LEAD_MS || s.epoch > endEpoch) continue;
          if (!best || Math.abs(s.epoch - startEpoch) < Math.abs(best.epoch - startEpoch)) best = s;
        }
        shotFile = best?.file;
      }
      explainItems.push({
        draft: {
          kind: "context",
          observedVia: "explain",
          actionType: "app_switch",
          tMs: f.start,
          frameTMs: f.start,
          app: prior?.app ?? { name: "", kind: "unknown" },
          ...(prior?.windowTitle !== undefined ? { windowTitle: prior.windowTitle } : {}),
          ...(prior?.url && prior.app.kind === "browser" ? { url: prior.url } : {}),
          summary: "", // filled once the step's marks and comment are known
          seq: startEv?.seq ?? 0,
        },
        explain: { displayElectronId, shotFile, freezeIdx },
        endMs: Math.round(f.end),
      });
    }
  });
  const items: { draft: StepDraft; explain?: NonNullable<DraftStep["explain"]>; endMs?: number }[] = [
    ...baseDrafts.map((draft) => ({ draft })),
    ...explainItems,
  ];
  // Stable sort by time; an Explain step goes after an ordinary step at the same moment.
  items.sort((a, b) => a.draft.tMs - b.draft.tMs);
  const drafts = items.map((i) => i.draft);
  const draftSteps: DraftStep[] = items.map((item, i) => {
    const draft = item.draft;
    const layout = layoutAt(layouts, draft.tMs);
    let display: DisplayInfo | undefined;
    if (layout) {
      if (item.explain) {
        display = layout.displays.find((d) => d.id === item.explain?.displayElectronId);
      } else if (draft.click) {
        display = displayForGlobalPoint(layout, draft.click.x, draft.click.y);
      } else if (draft.windowBounds) {
        display = displayForGlobalPoint(
          layout,
          draft.windowBounds.x + draft.windowBounds.width / 2,
          draft.windowBounds.y + draft.windowBounds.height / 2,
        );
      }
      display ??= layout.displays.find((d) => d.primary) ?? layout.displays[0];
    }
    const next = drafts[i + 1];
    return {
      id: `S${pad(i + 1, 2)}`,
      draft,
      tEnd: item.endMs ?? Math.round(next ? next.tMs : Math.max(durationMs, draft.tMs)),
      display,
      layout,
      ...(item.explain ? { explain: item.explain } : {}),
    };
  });

  // --- Annotations (pre-edit step ids) ---
  // A highlight or comment made during a freeze attaches to the last step before the freeze, or to
  // the first step after it when there is none before (tester-package.md §4.4).
  // A freeze that produced Explain steps attaches its marks to them instead: a highlight to the step
  // of its own display, a comment to the freeze's first Explain step.
  const attachStep = (tMs: number, p?: AnnotationPayload): string | undefined => {
    const fi = freezes.findIndex((f) => tMs >= f.start && tMs <= f.end);
    if (fi >= 0) {
      const own = draftSteps.filter((s) => s.explain?.freezeIdx === fi);
      if (own.length > 0) {
        const byDisplay =
          p?.kind === "highlight" ? own.find((s) => s.explain?.displayElectronId === p.displayId) : undefined;
        return (byDisplay ?? own[0]).id;
      }
    }
    const freeze = fi >= 0 ? freezes[fi] : undefined;
    const at = freeze ? freeze.start : tMs;
    let before: DraftStep | undefined;
    for (const s of draftSteps) if (s.draft.tMs <= at) before = s;
    return (before ?? draftSteps[0])?.id;
  };
  /** The freeze whose Explain steps carry an annotation made at `tMs`, if it has any. */
  const freezeWithSteps = (tMs: number): number | undefined => {
    const fi = freezes.findIndex((f) => tMs >= f.start && tMs <= f.end);
    return fi >= 0 && draftSteps.some((s) => s.explain?.freezeIdx === fi) ? fi : undefined;
  };

  interface PendingAnn {
    record: AnnotationRecord;
    /** Step the geometry must be converted for. */
    payload?: AnnotationPayload;
    /** The freeze this annotation was made in, when that freeze has Explain steps (PKG-7). */
    freezeIdx?: number;
  }
  const pending: PendingAnn[] = [];
  let markCounter = 0;
  for (const ev of eventsOfType(events, "annotation")) {
    const p = ev.payload as unknown as AnnotationPayload;
    const stepId = attachStep(ev.t, p);
    const stepIds = stepId ? [stepId] : [];
    if (p.kind === "comment") {
      pending.push({
        record: {
          annotation_id: p.annotationId,
          kind: "comment",
          step_ids: stepIds,
          t_ms: Math.round(ev.t),
          text: text(p.text ?? ""),
          source: p.source ?? "typed",
        },
        freezeIdx: freezeWithSteps(ev.t),
      });
    } else if (p.kind === "narration") {
      pending.push({
        record: {
          annotation_id: p.annotationId,
          kind: "narration",
          step_ids: stepIds,
          t_ms: Math.round(ev.t),
          t_end_ms: Math.round(p.tEndMs ?? ev.t),
          text: text(p.text ?? ""),
          anchor_confidence: 1,
        },
        payload: p,
      });
    } else if (p.kind === "highlight" && p.shape && p.pointsDpx) {
      markCounter++;
      pending.push({
        record: {
          annotation_id: p.annotationId,
          kind: "highlight",
          step_ids: stepIds,
          t_ms: Math.round(ev.t),
          mark: `H${markCounter}`,
          shape: p.shape,
          geometry_fpx: [], // and `frame_id`, filled once frames exist
        },
        payload: p,
      });
    }
  }

  // Narration transcript segments attach to the step whose window overlaps most.
  let nextAnnNumber =
    pending.reduce((m, a) => Math.max(m, Number(a.record.annotation_id.slice(4)) || 0), 0) + 1;
  for (const seg of [...session.narration].sort((a, b) => a.atMs - b.atMs)) {
    const overlaps = draftSteps
      .map((s) => {
        const ws = s.draft.tMs - 3000;
        const we = s.tEnd + 1000;
        return { id: s.id, overlap: Math.max(0, Math.min(seg.endMs, we) - Math.max(seg.atMs, ws)) };
      })
      .filter((o) => o.overlap > 0);
    let best: { id: string; overlap: number } | undefined;
    for (const o of overlaps) if (!best || o.overlap > best.overlap) best = o;
    const total = overlaps.reduce((s, o) => s + o.overlap, 0);
    const confidence =
      overlaps.length <= 1 ? (best ? 1 : 0) : Math.min(0.59, round2((best?.overlap ?? 0) / total));
    pending.push({
      record: {
        annotation_id: `ann_${pad(nextAnnNumber++, 4)}`,
        kind: "narration",
        step_ids: best ? [best.id] : [],
        t_ms: Math.round(seg.atMs),
        t_end_ms: Math.round(seg.endMs),
        text: text(seg.text),
        anchor_confidence: confidence,
      },
    });
  }
  pending.sort((a, b) => (a.record.annotation_id < b.record.annotation_id ? -1 : 1));

  // --- Apply edits ---
  const deleted = new Set<string>();
  const summaryEdits = new Map<string, string>();
  /** `null` is a comment removed: a legacy edit with empty text (see assertEdit). */
  const commentEdits = new Map<string, string | null>();
  /** User blur rectangles per pre-edit step id, in full-image px (`rect_fpx`). */
  const blurEdits = new Map<string, Rect[]>();
  /** The same, for rectangles drawn on the last step's after image (`frame: "after"`). */
  const blurAfterEdits = new Map<string, Rect[]>();
  for (const e of edits) {
    if (e.op === "delete_step") deleted.add(e.step_id);
    // Text is one line and never empty: a newline would start a heading or a fake step in PROCESS.md.
    else if (e.op === "edit_summary") summaryEdits.set(e.step_id, foldEditText(e.text, "summary"));
    else if (e.op === "edit_comment") commentEdits.set(e.annotation_id, e.text.trim() === "" ? null : foldEditText(e.text, "comment"));
    else if (e.op === "blur_rect") {
      const target = e.frame === "after" ? blurAfterEdits : blurEdits;
      const list = target.get(e.step_id) ?? [];
      list.push([...e.rect_fpx] as Rect);
      target.set(e.step_id, list);
    }
  }
  for (const id of [...deleted, ...summaryEdits.keys(), ...blurEdits.keys(), ...blurAfterEdits.keys()]) {
    if (!draftSteps.some((s) => s.id === id)) {
      throw new Error(`Edit refers to unknown step ${id}`);
    }
  }
  for (const id of commentEdits.keys()) {
    const a = pending.find((p) => p.record.annotation_id === id);
    if (!a || a.record.kind !== "comment") throw new Error(`Edit refers to unknown comment ${id}`);
  }

  const kept = draftSteps.filter((s) => !deleted.has(s.id));
  const renumber = new Map<string, string>();
  kept.forEach((s, i) => renumber.set(s.id, `S${pad(i + 1, 2)}`));

  const files: PackageBytes = new Map();
  const put = (path: string, bytes: Uint8Array | string) =>
    files.set(path, typeof bytes === "string" ? utf8(bytes) : bytes);

  // --- Frames and step records ---
  const candidatesFor = (displayElectronId: number, purpose: ShotEntry["purpose"]): Candidate[] =>
    session.shots
      .filter((s) => s.displayId === displayElectronId && s.purpose === purpose)
      .map((s) => ({ shot: s, t: s.epoch - baseEpoch }));

  let frameCounter = 0;
  /** Finished before-full image bytes per output step id, for drawing the annotated image later. */
  const fullPngs = new Map<string, Uint8Array>();
  /** Password-field geometry of each output step, so the same field is blurred in its after frame. */
  const passwordGeometry = new Map<string, { elementDpx?: Rect; pointDpx: [number, number] }>();
  const stepRecords: StepRecord[] = [];
  for (const [idx, ds] of kept.entries()) {
    const stepId = renumber.get(ds.id) as string;
    const d = ds.draft;
    const click = d.click;
    const ground = click ? groundingOf(click) : undefined;
    const display = ds.display;
    const displayId = display ? displayIds.get(display.id) : undefined;

    // Before frame.
    let before: FrameRecord | undefined;
    let pointDpx: [number, number] | undefined;
    let pointFpx: [number, number] | undefined;
    let elementDpx: Rect | undefined;
    let elementFpx: Rect | undefined;
    // Where the click was, in display pixels: known from the layout even when there is no picture.
    if (ds.layout && display) {
      const space = ds.layout.globalSpace;
      if (click) pointDpx = globalToDpx(space, display, click.x, click.y);
      if (click?.target?.bounds) elementDpx = boundsToDpx(space, display, click.target.bounds);
    }
    if (ds.layout && display && displayId) {
      // An Explain step's picture is the frozen frame the user annotated.
      const frozen = ds.explain?.shotFile
        ? session.shots.find((s) => s.file === ds.explain?.shotFile)
        : undefined;
      const shot: Candidate | undefined = ds.explain
        ? frozen
          ? { shot: frozen, t: frozen.epoch - baseEpoch }
          : undefined
        : selectBeforeFrame(candidatesFor(display.id, "before"), d.frameTMs, BEFORE_LEAD_MS);
      const bytes = shot && session.files.get(shot.shot.file);
      if (shot && bytes) {
        let img = await decode(bytes);
        const source: Rect = [0, 0, display.sizeDpx[0], display.sizeDpx[1]];
        const full = fitFullImage(img.width, img.height);
        const scale = full.width / display.sizeDpx[0];
        const capK = img.width / display.sizeDpx[0];
        const regionsFpx: Rect[] = [];

        // Password field: blur it before anything is cut from the frame (privacy floor). The
        // rectangle is clamped to the frame first, and what is recorded as redacted is what was blurred.
        if (click?.target?.isPassword) {
          if (!pointDpx) throw new Error("Cannot blur a password field: the click has no position.");
          const rectFrame = passwordRectFrame(display, capK, img.width, img.height, elementDpx, pointDpx);
          img = await blurRect(img, rectFrame);
          const k = scale / capK;
          regionsFpx.push([
            round2(rectFrame[0] * k),
            round2(rectFrame[1] * k),
            round2(rectFrame[2] * k),
            round2(rectFrame[3] * k),
          ]);
        }

        frameCounter++;
        const fullPath = `media/${stepId}_before_full.png`;
        // The user's blur rectangles (review edits) are in full-image px. They are burned into the
        // finished full image, so every pixel outside a rectangle is exactly the unedited pixel.
        const userRects = (blurEdits.get(ds.id) ?? [])
          .map((r) => clampRect(r, full.width, full.height))
          .filter((r): r is Rect => r !== null);
        if ((blurEdits.get(ds.id) ?? []).length > userRects.length) {
          throw new Error(`Blur on step ${ds.id} lies outside its image; refusing to export it unblurred.`);
        }
        let fullBytes = await renderFull(img, full);
        for (const r of userRects) fullBytes = await blurPng(fullBytes, r);
        for (const r of userRects) regionsFpx.push(r.map(round2) as Rect);
        put(fullPath, fullBytes);
        fullPngs.set(stepId, fullBytes);
        let crop: FrameRecord["crop"];
        if (click && pointDpx) {
          const plan = planClickCrop({
            display,
            frameWidth: img.width,
            frameHeight: img.height,
            fullScale: scale,
            pointDpx,
            ...(elementDpx ? { elementDpx } : {}),
          });
          const cropPath = `media/${stepId}_before_crop.png`;
          let cropBytes = await renderCrop(img, plan.rectFrame, plan.out);
          for (const r of userRects) {
            // Map the rectangle into the crop, rounding outwards so it never covers less.
            const a = fpxToCrop(plan.originFpx, plan.cropScale, r[0], r[1]);
            const b = fpxToCrop(plan.originFpx, plan.cropScale, r[0] + r[2], r[1] + r[3]);
            cropBytes = await blurPng(cropBytes, [
              Math.floor(a[0]),
              Math.floor(a[1]),
              Math.ceil(b[0]) - Math.floor(a[0]),
              Math.ceil(b[1]) - Math.floor(a[1]),
            ]);
          }
          put(cropPath, cropBytes);
          crop = {
            path: cropPath,
            width: plan.out.width,
            height: plan.out.height,
            est_tokens: estTokens(plan.out.width, plan.out.height),
            crop_origin_fpx: [round2(plan.originFpx[0]), round2(plan.originFpx[1])],
            crop_scale: Math.round(plan.cropScale * 1e6) / 1e6,
          };
        }
        before = {
          frame_id: `frm_${pad(frameCounter, 4)}`,
          t_ms: Math.round(shot.t),
          display_id: displayId,
          source_rect_dpx: source,
          scale: Math.round(scale * 1e6) / 1e6,
          full: {
            path: fullPath,
            width: full.width,
            height: full.height,
            est_tokens: estTokens(full.width, full.height),
          },
          ...(crop ? { crop } : {}),
          redacted_regions_fpx: regionsFpx,
        };
      }
    }
    // Full-image px: from the real frame's scale, else from the scale a frame of this display would
    // have, so a step with no picture still has a real locator and never "0,0" (PKG-4).
    if (display && (pointDpx || elementDpx)) {
      const source: Rect = [0, 0, display.sizeDpx[0], display.sizeDpx[1]];
      const scale = before?.scale ?? expectedFrameScale(display);
      if (pointDpx) pointFpx = dpxToFpx(source, scale, pointDpx[0], pointDpx[1]);
      if (elementDpx) {
        const a = dpxToFpx(source, scale, elementDpx[0], elementDpx[1]);
        elementFpx = [a[0], a[1], elementDpx[2] * scale, elementDpx[3] * scale];
      }
    }
    if (click?.target?.isPassword && pointDpx) passwordGeometry.set(stepId, { elementDpx, pointDpx });

    const edited = summaryEdits.get(ds.id);
    const flags: string[] = [];
    if (edited !== undefined) flags.push("user_edited");
    if (before && before.redacted_regions_fpx.length > 0) flags.push("contains_redaction");
    // No picture of the screen at that moment (for example in the first second of capture): the
    // target is less certain, and the package says so.
    if (!before || (ground && ground.grounding !== "accessibility")) flags.push("low_confidence_target");
    flags.sort();

    // Target (tester-package.md §4.2).
    const t = click?.target;
    const target: Record<string, unknown> = {
      app: {
        name: d.app.name,
        ...(d.app.process ? { process: d.app.process } : {}),
        ...(d.app.bundle_id ? { bundle_id: d.app.bundle_id } : {}),
        kind: d.app.kind,
      },
    };
    if (d.windowTitle !== undefined) target.window = { title: text(d.windowTitle) };
    if (d.url) target.url = text(d.url);
    if (click && ground) {
      target.grounding = ground.grounding;
      if (ground.unavailable) target.unavailable = { reason: ground.unavailable };
      if (t) {
        target.grounding_source = t.source;
        // The user rewrote this step's wording because the control's name was private (or wrong):
        // the same words must not survive in the element, the ancestry or the locator (SEC-6).
        const userEdited = edited !== undefined;
        target.element = {
          role: t.role,
          native_role: t.nativeRole,
          name: userEdited ? redactedText() : text(t.name),
          ...(t.automationId ? { automation_id: t.automationId } : {}),
          ...(t.axIdentifier ? { ax_identifier: t.axIdentifier } : {}),
          is_password: t.isPassword,
        };
        if (t.ancestry?.length) {
          target.ancestry = t.ancestry
            .slice(0, 6)
            .map((a) => ({ role: a.role, name: userEdited ? REDACTED : a.name }));
        }
      }
      if (displayId && elementDpx && elementFpx) {
        target.display_id = displayId;
        target.bounds_dpx = elementDpx.map(round2);
        target.bounds_fpx = elementFpx.map(round2);
      }
      const locators: Record<string, unknown>[] = [];
      let rank = 1;
      const stable = t?.automationId ?? t?.axIdentifier;
      if (t && stable) {
        locators.push({
          strategy: t.source === "uia" ? "uia_automation_id" : "ax_identifier",
          value: stable,
          rank: rank++,
          stability: "high",
        });
      }
      if (t) {
        const path = [...(t.ancestry ?? []).map((a) => `${a.role}:${a.name}`), `${t.role}:${t.name}`];
        locators.push({
          strategy: "role_name_path",
          value: edited !== undefined ? REDACTED : path.join(" > "),
          rank: rank++,
          stability: "medium",
        });
      }
      // The click's place in the full image. Never a made-up "0,0": with no display to place it on,
      // there is no frame_point, and validatePackage refuses a step with no locator at all.
      if (pointFpx) {
        locators.push({
          strategy: "frame_point",
          value: `${Math.round(pointFpx[0])},${Math.round(pointFpx[1])}`,
          rank,
          stability: "low",
        });
      }
      target.locators = locators;
    } else if (d.kind === "context") {
      // No clicked control: nothing failed, there was none to find (tester-package.md §4.2).
      target.grounding = "none";
      let centre: [number, number] = [0, 0];
      if (display && ds.layout) {
        const scale = before?.scale ?? expectedFrameScale(display);
        const source: Rect = [0, 0, display.sizeDpx[0], display.sizeDpx[1]];
        const centreDpx: [number, number] = d.windowBounds
          ? (() => {
              const r = boundsToDpx(ds.layout.globalSpace, display, d.windowBounds);
              return [r[0] + r[2] / 2, r[1] + r[3] / 2] as [number, number];
            })()
          : [display.sizeDpx[0] / 2, display.sizeDpx[1] / 2];
        centre = dpxToFpx(source, scale, centreDpx[0], centreDpx[1]);
      }
      if (displayId) target.display_id = displayId;
      target.locators = [
        {
          strategy: "frame_point",
          value: `${Math.round(centre[0])},${Math.round(centre[1])}`,
          rank: 1,
          stability: "low",
        },
      ];
    }

    stepRecords.push({
      step_id: stepId,
      seq: idx + 1,
      kind: d.kind,
      t_start_ms: Math.round(d.tMs),
      t_end_ms: ds.tEnd,
      summary: edited ?? d.summary,
      summary_provenance: edited !== undefined ? "user" : "observed",
      observed_via: d.observedVia,
      ...(ds.explain
        ? {}
        : {
            action: {
              type: d.actionType,
              ...(displayId && pointDpx
                ? { point_dpx: { display_id: displayId, xy: [round2(pointDpx[0]), round2(pointDpx[1])] } }
                : {}),
              ...(pointFpx ? { point_fpx: [round2(pointFpx[0]), round2(pointFpx[1])] } : {}),
            },
          }),
      target,
      ...(before ? { before } : {}),
      annotation_ids: [],
      flags,
      boundary: "not_assessed",
      boundary_source: "none",
      scope_verified: d.app.name !== "",
    });
  }

  // After frame on the last step only: about 500 ms after its action.
  const lastDs = kept[kept.length - 1];
  const lastRec = stepRecords[stepRecords.length - 1];
  // It belongs to the last step the user did. When that step was deleted in review, the frame taken
  // after it shows a later screen, so the new last step gets none (PKG-1).
  const lastWasRecordedLast = lastDs !== undefined && lastDs === draftSteps[draftSteps.length - 1];
  if (lastDs && !lastDs.explain && lastWasRecordedLast && lastRec?.before && lastDs.display) {
    const afterCands = candidatesFor(lastDs.display.id, "after");
    const want = lastDs.draft.tMs + AFTER_DELAY_MS;
    let pick: Candidate | undefined;
    for (const c of afterCands) {
      // About 500 ms after the action, and before the step ends (`tEnd` is measured before edits).
      if (c.t < lastDs.draft.tMs || c.t - lastDs.draft.tMs > AFTER_MAX_MS || c.t >= lastDs.tEnd) continue;
      if (!pick || Math.abs(c.t - want) < Math.abs(pick.t - want)) pick = c;
    }
    const bytes = pick && session.files.get(pick.shot.file);
    if (pick && bytes) {
      let img = await decode(bytes);
      const full = fitFullImage(img.width, img.height);
      const scale = full.width / lastDs.display.sizeDpx[0];
      frameCounter++;
      const path = `media/${lastRec.step_id}_after_full.png`;
      const afterRects: Rect[] = [];
      // A password field on the last step is blurred in the after frame too (SEC-4).
      const pw = passwordGeometry.get(lastRec.step_id);
      if (pw) {
        const capK = img.width / lastDs.display.sizeDpx[0];
        const rectFrame = passwordRectFrame(lastDs.display, capK, img.width, img.height, pw.elementDpx, pw.pointDpx);
        img = await blurRect(img, rectFrame);
        const k = scale / capK;
        afterRects.push([
          round2(rectFrame[0] * k),
          round2(rectFrame[1] * k),
          round2(rectFrame[2] * k),
          round2(rectFrame[3] * k),
        ]);
      }
      // The after frame is the same screen a moment later, so the user's blur on this step's before
      // image also covers it; otherwise a blurred value would show through in the after image.
      // Rectangles drawn on the after image itself (`frame: "after"`) are in its own pixels.
      const coverRects = (blurEdits.get(lastDs.id) ?? [])
        .map((r) => clampRect(r, full.width, full.height))
        .filter((r): r is Rect => r !== null);
      const ownRaw = blurAfterEdits.get(lastDs.id) ?? [];
      const ownRects = ownRaw
        .map((r) => clampRect(r, full.width, full.height))
        .filter((r): r is Rect => r !== null);
      if (ownRaw.length > ownRects.length) {
        throw new Error(`Blur on the after image of step ${lastDs.id} lies outside it; refusing to export it unblurred.`);
      }
      let afterBytes = await renderFull(img, full);
      for (const r of [...coverRects, ...ownRects]) afterBytes = await blurPng(afterBytes, r);
      afterRects.push(...coverRects, ...ownRects);
      put(path, afterBytes);
      if (afterRects.length > 0 && !lastRec.flags.includes("contains_redaction")) {
        lastRec.flags.push("contains_redaction");
        lastRec.flags.sort();
      }
      lastRec.after = {
        frame_id: `frm_${pad(frameCounter, 4)}`,
        t_ms: Math.round(pick.t),
        display_id: lastRec.before.display_id,
        source_rect_dpx: [0, 0, lastDs.display.sizeDpx[0], lastDs.display.sizeDpx[1]],
        scale: Math.round(scale * 1e6) / 1e6,
        full: {
          path,
          width: full.width,
          height: full.height,
          est_tokens: estTokens(full.width, full.height),
        },
        redacted_regions_fpx: afterRects.map((r) => r.map(round2) as Rect),
      };
    }
  }
  // An edit aimed at an after image this export does not have fails closed: it would otherwise be dropped.
  for (const id of blurAfterEdits.keys()) {
    const outId = renumber.get(id); // undefined when that step was deleted: nothing to blur
    if (outId && !stepRecords.find((s) => s.step_id === outId)?.after) {
      throw new Error(`Blur on the after image of step ${id}, which has no after image.`);
    }
  }

  // --- Finish annotations ---
  const stepById = new Map(stepRecords.map((s) => [s.step_id, s]));
  const annotations: AnnotationRecord[] = [];
  const drawable = new Set<string>();
  let markOut = 0;
  for (const p of pending) {
    const rec = p.record;
    const hadSteps = rec.step_ids.length > 0;
    const stepIds = rec.step_ids
      .map((id) => renumber.get(id))
      .filter((id): id is string => id !== undefined);
    // A freeze's comment sits on its first Explain step. When the user deletes that step (one of a
    // multi-display freeze), the comment moves to the freeze's first surviving Explain step instead
    // of vanishing with it (PKG-7).
    if (hadSteps && stepIds.length === 0 && rec.kind === "comment" && p.freezeIdx !== undefined) {
      const heir = kept.find((s) => s.explain?.freezeIdx === p.freezeIdx);
      if (heir) stepIds.push(renumber.get(heir.id) as string);
    }
    if (hadSteps && stepIds.length === 0) continue; // its step was deleted
    if (rec.kind === "comment") {
      const edited = commentEdits.get(rec.annotation_id);
      if (edited === null) continue; // the comment was removed (a legacy empty edit_comment)
      annotations.push({
        ...rec,
        step_ids: stepIds,
        ...(edited !== undefined ? { text: text(edited), source: "review" as const } : {}),
      });
    } else if (rec.kind === "highlight") {
      const step = stepById.get(stepIds[0] ?? "");
      const before = step?.before;
      const pl = p.payload;
      const layout = layoutAt(layouts, rec.t_ms);
      const dispInfo = layout?.displays.find((x) => x.id === pl?.displayId);
      if (!step || !pl?.pointsDpx || !dispInfo) continue; // nothing to map onto
      // A step with no picture (its frozen frame was never saved) still keeps the user's mark, in
      // the geometry a frame of that display would have. It has no `frame_id`, and its step says
      // `low_confidence_target`; it is never dropped without a trace (PKG-4).
      const sourceRect: Rect = [0, 0, dispInfo.sizeDpx[0], dispInfo.sizeDpx[1]];
      const sameDisplay = !!before && displayIds.get(dispInfo.id) === before.display_id;
      const scale = before && sameDisplay ? before.scale : expectedFrameScale(dispInfo);
      const geometry = pl.pointsDpx.map((pt) => {
        const f = dpxToFpx(sourceRect, scale, pt[0], pt[1]);
        return [round2(f[0]), round2(f[1])] as [number, number];
      });
      let snapped: Extract<AnnotationRecord, { kind: "highlight" }>["snapped_to"];
      if (pl.snappedTo) {
        const b = pl.snappedTo.boundsDpx;
        const o = dpxToFpx(sourceRect, scale, b.x, b.y);
        snapped = {
          role: pl.snappedTo.role,
          name: pl.snappedTo.name,
          bounds_fpx: [round2(o[0]), round2(o[1]), round2(b.width * scale), round2(b.height * scale)],
        };
      }
      // Marks are numbered again here so deleting a step leaves no hole (H1, H2…).
      annotations.push({
        ...rec,
        step_ids: stepIds,
        mark: `H${++markOut}`,
        ...(before ? { frame_id: before.frame_id } : {}),
        geometry_fpx: geometry,
        ...(snapped ? { snapped_to: snapped } : {}),
      });
      // Only a highlight drawn on this step's own display can be drawn into its image.
      if (sameDisplay) drawable.add(rec.annotation_id);
    } else {
      annotations.push({ ...rec, step_ids: stepIds });
    }
  }
  for (const a of annotations) {
    for (const sid of a.step_ids) stepById.get(sid)?.annotation_ids.push(a.annotation_id);
  }
  for (const s of stepRecords) s.annotation_ids.sort();

  // Highlights are drawn only into `*_full_annotated.png`, on top of the (already blurred) full image.
  for (const s of stepRecords) {
    const marks: RenderableHighlight[] = [];
    for (const a of annotations) {
      if (a.kind === "highlight" && a.step_ids[0] === s.step_id && drawable.has(a.annotation_id)) {
        marks.push({ mark: a.mark, shape: a.shape, geometry_fpx: a.geometry_fpx });
      }
    }
    const fullBytes = fullPngs.get(s.step_id);
    if (marks.length === 0 || !s.before || !fullBytes) continue;
    const annotatedPath = `media/${s.step_id}_before_full_annotated.png`;
    put(annotatedPath, await renderAnnotated(fullBytes, marks));
    s.before.full_annotated = { ...s.before.full, path: annotatedPath };
  }

  // A comment attached to a step becomes its `why` (the first typed or review comment).
  for (const s of stepRecords) {
    const first = s.annotation_ids
      .map((id) => annotations.find((a) => a.annotation_id === id))
      .find((a) => a?.kind === "comment");
    if (first && first.kind === "comment" && first.text.text.trim() !== "") {
      s.why = { text: first.text.text, provenance: "user", source_annotation_ids: [first.annotation_id] };
    }
  }

  // Explain step summaries: `Explain on <app>: "<first 80 chars of the first comment>"`, or
  // `Explain on <app> (H1, H2)` when there is no comment. A summary the user edited is kept.
  for (const s of stepRecords) {
    if (s.observed_via !== "explain" || s.summary_provenance === "user") continue;
    const appName = ((s.target?.app as { name?: string } | undefined)?.name ?? "").trim();
    const where = appName ? `Explain on ${appName}` : "Explain on the screen";
    const comment = s.why?.text.replace(/\s+/g, " ").replace(/"/g, "'").trim().slice(0, 80);
    const marks = s.annotation_ids
      .map((id) => annotations.find((a) => a.annotation_id === id))
      .filter((a): a is Extract<AnnotationRecord, { kind: "highlight" }> => a?.kind === "highlight")
      .map((a) => a.mark);
    s.summary = comment
      ? `${where}: "${comment}"`
      : marks.length
        ? `${where} (${marks.join(", ")})`
        : where;
  }

  // --- Gaps ---
  const gaps: GapRecord[] = [];
  for (const g of resolveGaps(events, durationMs)) {
    const p = { reason: g.reason };
    const start = Math.round(g.start);
    const end = Math.round(g.end);
    let after: string | undefined;
    let beforeStep: string | undefined;
    for (const s of stepRecords) {
      if (s.t_start_ms <= start) after = s.step_id;
      else if (beforeStep === undefined && s.t_start_ms >= end) beforeStep = s.step_id;
    }
    gaps.push({
      gap_id: `gap_${pad(gaps.length + 1, 4)}`,
      t_start_ms: start,
      t_end_ms: Math.max(start, end),
      reason: p.reason,
      ...(after ? { after_step: after } : {}),
      ...(beforeStep ? { before_step: beforeStep } : {}),
    });
  }

  // --- Text files ---
  const title = session.process.title;
  put("steps.jsonl", canonicalJsonl(stepRecords));
  put("annotations.jsonl", canonicalJsonl(annotations));
  put("gaps.jsonl", canonicalJsonl(gaps));
  put(
    "PROCESS.md",
    renderProcessMd({
      process: session.process,
      author: { position: session.process.position },
      recording: { started_at_ms: session.meta.startedAt, timezone: ctx.timezone, task_ms: timing.task_ms },
      package_id: ctx.package_id,
      steps: stepRecords,
      annotations,
      gaps,
    }),
  );
  put("CLAUDE_HANDOFF.md", renderHandoffMd({ title }));
  put(
    "README.txt",
    `${TEST_BUILD_BANNER}\n\nHandover package ${ctx.package_id}\nStart here: CLAUDE_HANDOFF.md\n`,
  );

  // --- Manifest ---
  const imageCount = [...files.keys()].filter((p) => p.endsWith(".png")).length;
  const fileEntries: PackageFileEntry[] = [...files.entries()]
    .map(([path, bytes]) => ({ path, sha256: sha256Hex(bytes), bytes: bytes.byteLength }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
  const hasClicks = events.some((e) => e.type === "pointer.click");
  const manifest = {
    format: "handover-package",
    schema_version: SCHEMA_VERSION,
    package_id: ctx.package_id,
    created_at: ctx.exported_at,
    recorder: {
      name: "Handover",
      version: ctx.tool_version,
      os: session.environment.os,
      os_version: session.environment.os_version,
      arch: session.environment.arch,
      locale: session.environment.locale,
    },
    author: { pseudonym: "author-1", position: session.process.position },
    process: {
      title,
      goal: session.process.goal,
      done_when: session.process.done_when,
      trigger: session.process.trigger,
    },
    recording: {
      started_at: isoWithOffset(session.meta.startedAt, ctx.timezone),
      ended_at: isoWithOffset(session.meta.startedAt + durationMs, ctx.timezone),
      timezone: ctx.timezone,
      duration_ms: durationMs,
      task_ms: timing.task_ms,
      explain_ms: timing.explain_ms,
      paused_ms: timing.paused_ms,
      step_count: stepRecords.length,
    },
    capture: {
      capabilities: {
        // True when the native helper ran (its status is saved with the session), or when the
        // events themselves show clicks and resolved controls.
        input_mouse: session.helper.present || hasClicks,
        a11y_hit:
          session.helper.present ||
          events.some(
            (e) => e.type === "pointer.click" && (e.payload as { target?: unknown }).target !== undefined,
          ),
        capture_backend: session.captureBackend,
        keyboard: "none",
      },
      helper: session.helper,
    },
    displays: manifestDisplays,
    media: {
      image_profile: "standard",
      image_count: imageCount,
      format: "png",
      video_included: false,
      audio_included: false,
    },
    privacy: { reviewed_by_user: true, reviewed_at: ctx.reviewed_at ?? ctx.exported_at, test_build: true },
    files: fileEntries,
  };
  put("manifest.json", canonicalJson(manifest));
  return { files, stepIds: kept.map((s) => s.id) };
}
