// Types for the Handover tester package builder (docs/recorder/tester-package.md).
// This module and everything in common/handover/ is pure: no Electron, no OS access.

import type { RecEvent, SessionMeta } from "../types";

export const SCHEMA_VERSION = "0.1-tester";
export const TEST_BUILD_BANNER = "TEST BUILD — use test data only, not real client data";

/** One persisted screen frame (a JPEG or PNG in the session's `shots/` folder). */
export interface ShotEntry {
  /** Path relative to the session folder, e.g. `shots/000001.jpg`. */
  file: string;
  /** Wall-clock epoch ms the frame was captured. */
  epoch: number;
  /** Electron `Display.id` the frame shows. */
  displayId: number;
  /** `before` frames are persisted for a step; `after` for the last step; `annotation` for freezes. */
  purpose: "before" | "after" | "annotation";
}

export interface NarrationSegmentInput {
  atMs: number;
  endMs: number;
  text: string;
}

export interface ProcessInfo {
  title: string;
  goal: string;
  done_when: string;
  trigger: { kind: "event" | "schedule" | "request" | "manual" | "unknown"; text: string };
  /** The author's role from the start sheet. Never a real name. */
  position: string;
}

export interface SessionEnvironment {
  os: "macos" | "windows";
  os_version: string;
  arch: "arm64" | "x64";
  locale: string;
}

export interface HelperStatus {
  present: boolean;
  version?: string;
  error?: string;
}

/** Everything `buildPackage` needs about a recorded session. */
export interface SessionInput {
  meta: SessionMeta;
  events: RecEvent[];
  shots: ShotEntry[];
  /** Frame bytes keyed by `ShotEntry.file`. */
  files: Map<string, Uint8Array>;
  narration: NarrationSegmentInput[];
  process: ProcessInfo;
  environment: SessionEnvironment;
  helper: HelperStatus;
  /** e.g. `electron-desktop-capturer`. */
  captureBackend: string;
}

/** The values that make the export deterministic. */
export interface BuildContext {
  package_id: string;
  /** ISO 8601 with offset. */
  exported_at: string;
  /** IANA timezone of the recording. */
  timezone: string;
  tool_version: string;
}

// --- Edits (append-only, `edits.jsonl`) ---

interface EditBase {
  edit_id: string;
  /** ISO 8601 time of the edit. Informational; never affects the output. */
  at: string;
}

/** Indexes refer to the step ids of the *unedited* build (`S01…Sn` in seq order). */
export type Edit =
  | (EditBase & { op: "delete_step"; step_id: string })
  | (EditBase & { op: "edit_summary"; step_id: string; text: string })
  | (EditBase & { op: "edit_comment"; annotation_id: string; text: string })
  | (EditBase & { op: "blur_rect"; step_id: string; rect_fpx: [number, number, number, number] });

export const EDIT_OPS = ["delete_step", "edit_summary", "edit_comment", "blur_rect"] as const;

// --- Package records ---

export type Grounding = "accessibility" | "accessibility_weak" | "visual_only";

export interface TextObj {
  text: string;
  redacted: boolean;
  classes: string[];
}

export interface FrameImage {
  path: string;
  width: number;
  height: number;
  est_tokens: number;
}

export interface FrameRecord {
  frame_id: string;
  t_ms: number;
  display_id: string;
  source_rect_dpx: [number, number, number, number];
  scale: number;
  full: FrameImage;
  full_annotated?: FrameImage;
  crop?: FrameImage & { crop_origin_fpx: [number, number]; crop_scale: number };
  redacted_regions_fpx: [number, number, number, number][];
}

export interface StepRecord {
  step_id: string;
  seq: number;
  kind: "action" | "context" | "manual";
  t_start_ms: number;
  t_end_ms: number;
  summary: string;
  summary_provenance: "observed" | "user";
  observed_via?: "pointer" | "window_change" | "explain";
  action?: {
    type: "click" | "double_click" | "right_click" | "app_switch";
    point_dpx?: { display_id: string; xy: [number, number] };
    point_fpx?: [number, number];
  };
  target?: Record<string, unknown>;
  before?: FrameRecord;
  after?: FrameRecord;
  why?: { text: string; provenance: "user"; source_annotation_ids: string[] };
  annotation_ids: string[];
  flags: string[];
  boundary: "not_assessed";
  boundary_source: "none";
  scope_verified: boolean;
}

export type AnnotationRecord =
  | {
      annotation_id: string;
      kind: "highlight";
      step_ids: string[];
      t_ms: number;
      mark: string;
      shape: "rect" | "arrow" | "highlighter" | "freehand";
      frame_id: string;
      geometry_fpx: [number, number][];
      snapped_to?: { role: string; name: string; bounds_fpx: [number, number, number, number] };
    }
  | {
      annotation_id: string;
      kind: "comment";
      step_ids: string[];
      t_ms: number;
      text: TextObj;
      source: "typed" | "review";
    }
  | {
      annotation_id: string;
      kind: "narration";
      step_ids: string[];
      t_ms: number;
      t_end_ms: number;
      text: TextObj;
      anchor_confidence: number;
    };

export interface GapRecord {
  gap_id: string;
  t_start_ms: number;
  t_end_ms: number;
  reason: "user_paused" | "helper_restart" | "capture_lost" | "permission_lost";
  after_step?: string;
  before_step?: string;
}

export interface PackageFileEntry {
  path: string;
  sha256: string;
  bytes: number;
}

export type PackageBytes = Map<string, Uint8Array>;
