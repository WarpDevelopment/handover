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
import { assertEditsApplicable } from "./edits";
import {
  boundsToDpx,
  displayForGlobalPoint,
  dpxToFpx,
  estTokens,
  expectedFrameScale,
  fitFullImage,
  fpxToCrop,
  globalToDpx,
  planCrop,
  selectBeforeFrame,
  type DisplayInfo,
  type Rect,
} from "./geometry";
import { renderAnnotated, type RenderableHighlight } from "./annotation-render";
import { renderHandoffMd } from "./handoff-md";
import { blurPng, blurRect, clampRect, decode, renderCrop, renderFull } from "./images";
import { renderProcessMd } from "./process-md";
import { buildSteps, groundingOf, layoutAt, type StepDraft } from "./steps";
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

export function packageFolderName(title: string, packageId: string): string {
  return `${slugify(title)}__${packageId}.handover`;
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

/**
 * Events with the collector events that fall inside a freeze removed. Clicks on the overlay are on
 * Handover's own windows and must never become steps, and the overlay taking focus is not an app
 * switch by the user. The interval is half-open: `[explain.start, explain.end)`.
 */
export function withoutFrozenCollectorEvents(
  events: readonly RecEvent[],
  durationMs = Infinity,
): RecEvent[] {
  const intervals = explainIntervals(events, durationMs);
  if (intervals.length === 0) return [...events];
  return events.filter(
    (e) => !(FROZEN_DROPPED_TYPES.has(e.type) && intervals.some((i) => e.t >= i.start && e.t < i.end)),
  );
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
  const drafts = buildSteps(withoutFrozenCollectorEvents(events, durationMs), clickToDpx);
  const draftSteps: DraftStep[] = drafts.map((draft, i) => {
    const layout = layoutAt(layouts, draft.tMs);
    let display: DisplayInfo | undefined;
    if (layout) {
      if (draft.click) {
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
      tEnd: Math.round(next ? next.tMs : Math.max(durationMs, draft.tMs)),
      display,
      layout,
    };
  });

  // --- Annotations (pre-edit step ids) ---
  // A highlight or comment made during a freeze attaches to the last step before the freeze, or to
  // the first step after it when there is none before (tester-package.md §4.4).
  const attachStep = (tMs: number): string | undefined => {
    const freeze = freezes.find((f) => tMs >= f.start && tMs <= f.end);
    const at = freeze ? freeze.start : tMs;
    let before: DraftStep | undefined;
    for (const s of draftSteps) if (s.draft.tMs <= at) before = s;
    return (before ?? draftSteps[0])?.id;
  };

  interface PendingAnn {
    record: AnnotationRecord;
    /** Step the geometry must be converted for. */
    payload?: AnnotationPayload;
  }
  const pending: PendingAnn[] = [];
  let markCounter = 0;
  for (const ev of eventsOfType(events, "annotation")) {
    const p = ev.payload as unknown as AnnotationPayload;
    const stepId = attachStep(ev.t);
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
          frame_id: "", // filled once frames exist
          geometry_fpx: [],
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
  const commentEdits = new Map<string, string>();
  /** User blur rectangles per pre-edit step id, in full-image px (`rect_fpx`). */
  const blurEdits = new Map<string, Rect[]>();
  for (const e of edits) {
    if (e.op === "delete_step") deleted.add(e.step_id);
    else if (e.op === "edit_summary") summaryEdits.set(e.step_id, e.text);
    else if (e.op === "edit_comment") commentEdits.set(e.annotation_id, e.text);
    else if (e.op === "blur_rect") {
      const list = blurEdits.get(e.step_id) ?? [];
      list.push([...e.rect_fpx] as Rect);
      blurEdits.set(e.step_id, list);
    }
  }
  for (const id of [...deleted, ...summaryEdits.keys(), ...blurEdits.keys()]) {
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
    if (ds.layout && display && displayId) {
      const space = ds.layout.globalSpace;
      if (click) pointDpx = globalToDpx(space, display, click.x, click.y);
      if (click?.target?.bounds) elementDpx = boundsToDpx(space, display, click.target.bounds);
      const shot = selectBeforeFrame(candidatesFor(display.id, "before"), d.frameTMs, BEFORE_LEAD_MS);
      const bytes = shot && session.files.get(shot.shot.file);
      if (shot && bytes) {
        let img = await decode(bytes);
        const source: Rect = [0, 0, display.sizeDpx[0], display.sizeDpx[1]];
        const full = fitFullImage(img.width, img.height);
        const scale = full.width / display.sizeDpx[0];
        const capK = img.width / display.sizeDpx[0];
        const regionsFpx: Rect[] = [];

        // Password field: blur it before anything is cut from the frame (privacy floor).
        if (click?.target?.isPassword) {
          const rectDpx: Rect =
            elementDpx ??
            ([
              (pointDpx?.[0] ?? 0) - 200 * display.scaleFactor,
              (pointDpx?.[1] ?? 0) - 50 * display.scaleFactor,
              400 * display.scaleFactor,
              100 * display.scaleFactor,
            ] as Rect);
          const rectFrame: Rect = [
            rectDpx[0] * capK - PASSWORD_PAD_FRAME_PX,
            rectDpx[1] * capK - PASSWORD_PAD_FRAME_PX,
            rectDpx[2] * capK + 2 * PASSWORD_PAD_FRAME_PX,
            rectDpx[3] * capK + 2 * PASSWORD_PAD_FRAME_PX,
          ];
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
          const centre: [number, number] = elementDpx
            ? [elementDpx[0] + elementDpx[2] / 2, elementDpx[1] + elementDpx[3] / 2]
            : pointDpx;
          const plan = planCrop({
            display,
            frameWidth: img.width,
            frameHeight: img.height,
            fullScale: scale,
            centreDpx: centre,
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
        if (pointDpx) pointFpx = dpxToFpx(source, scale, pointDpx[0], pointDpx[1]);
        if (elementDpx) {
          const a = dpxToFpx(source, scale, elementDpx[0], elementDpx[1]);
          elementFpx = [a[0], a[1], elementDpx[2] * scale, elementDpx[3] * scale];
        }
      }
    }

    const edited = summaryEdits.get(ds.id);
    const flags: string[] = [];
    if (edited !== undefined) flags.push("user_edited");
    if (before && before.redacted_regions_fpx.length > 0) flags.push("contains_redaction");
    if (ground && ground.grounding !== "accessibility") flags.push("low_confidence_target");
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
        target.element = {
          role: t.role,
          native_role: t.nativeRole,
          name: text(t.name),
          ...(t.automationId ? { automation_id: t.automationId } : {}),
          ...(t.axIdentifier ? { ax_identifier: t.axIdentifier } : {}),
          is_password: t.isPassword,
        };
        if (t.ancestry?.length) {
          target.ancestry = t.ancestry.slice(0, 6).map((a) => ({ role: a.role, name: a.name }));
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
          value: path.join(" > "),
          rank: rank++,
          stability: "medium",
        });
      }
      const fp = pointFpx ?? [0, 0];
      locators.push({
        strategy: "frame_point",
        value: `${Math.round(fp[0])},${Math.round(fp[1])}`,
        rank,
        stability: "low",
      });
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
      action: {
        type: d.actionType,
        ...(displayId && pointDpx
          ? { point_dpx: { display_id: displayId, xy: [round2(pointDpx[0]), round2(pointDpx[1])] } }
          : {}),
        ...(pointFpx ? { point_fpx: [round2(pointFpx[0]), round2(pointFpx[1])] } : {}),
      },
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
  if (lastDs && lastRec?.before && lastDs.display) {
    const afterCands = candidatesFor(lastDs.display.id, "after");
    const want = lastDs.draft.tMs + AFTER_DELAY_MS;
    let pick: Candidate | undefined;
    for (const c of afterCands) {
      // About 500 ms after the action: a frame much later shows something else (for example when
      // the real last step was deleted in review), so it is not used.
      if (c.t < lastDs.draft.tMs || c.t - lastDs.draft.tMs > AFTER_MAX_MS) continue;
      if (!pick || Math.abs(c.t - want) < Math.abs(pick.t - want)) pick = c;
    }
    const bytes = pick && session.files.get(pick.shot.file);
    if (pick && bytes) {
      const img = await decode(bytes);
      const full = fitFullImage(img.width, img.height);
      const scale = full.width / lastDs.display.sizeDpx[0];
      frameCounter++;
      const path = `media/${lastRec.step_id}_after_full.png`;
      // The after frame is the same screen a moment later, so the user's blur on this step also
      // covers it; otherwise a blurred value would show through in the after image.
      const afterRects = (blurEdits.get(lastDs.id) ?? [])
        .map((r) => clampRect(r, full.width, full.height))
        .filter((r): r is Rect => r !== null);
      let afterBytes = await renderFull(img, full);
      for (const r of afterRects) afterBytes = await blurPng(afterBytes, r);
      put(path, afterBytes);
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
    if (hadSteps && stepIds.length === 0) continue; // its step was deleted
    if (rec.kind === "comment") {
      const edited = commentEdits.get(rec.annotation_id);
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
      if (!step || !before || !pl?.pointsDpx || !dispInfo) continue; // nothing to map onto
      const sourceRect: Rect = [0, 0, dispInfo.sizeDpx[0], dispInfo.sizeDpx[1]];
      const sameDisplay = displayIds.get(dispInfo.id) === before.display_id;
      const scale = sameDisplay ? before.scale : expectedFrameScale(dispInfo);
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
        frame_id: before.frame_id,
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
    privacy: { reviewed_by_user: true, reviewed_at: ctx.exported_at, test_build: true },
    files: fileEntries,
  };
  put("manifest.json", canonicalJson(manifest));
  return { files, stepIds: kept.map((s) => s.id) };
}
