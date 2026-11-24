// The formal event schema shared by producers (collectors) and consumers
// (session store, timeline, describer). On disk each event is a `RecEvent`
// (see types.ts); this module adds the typed `type` -> `payload` contract that
// makes collectors and the correlation engine type-safe.

/** Canonical event type identifiers, grouped by domain. */
export const EventType = {
  SessionStart: "session.start",
  SessionStop: "session.stop",
  Marker: "marker",
  AppActivate: "app.activate",
  AppTitleChange: "app.title-change",
  ClipboardChange: "clipboard.change",
  TerminalCommand: "terminal.command",
  BrowserUrl: "browser.url",
  VideoStart: "video.start",
  VideoStop: "video.stop",
  FrameCaptured: "frame.captured",
  // Handover tester build (docs/recorder/tester-package.md). Shared by lanes L3/L4/L5.
  Displays: "displays",
  PointerClick: "pointer.click",
  Annotation: "annotation",
  Gap: "gap",
  ExplainStart: "explain.start",
  ExplainEnd: "explain.end",
} as const;

export type EventType = (typeof EventType)[keyof typeof EventType];

// --- Per-domain payloads (declared as `type` aliases so they are assignable to
// Record<string, unknown> when persisted). Optional fields are platform- or
// collector-specific enrichments. ---

export type SessionStartPayload = { platform: NodeJS.Platform };
export type SessionStopPayload = Record<string, never>;
export type MarkerPayload = { note: string };

export type WindowBounds = { x: number; y: number; width: number; height: number };

export type AppActivatePayload = {
  app: string;
  title: string;
  url?: string;
  host?: string;
  bundleId?: string;
  pid?: number;
  path?: string;
  bounds?: WindowBounds;
};

export type AppTitleChangePayload = { app: string; title: string };

export type ClipboardChangePayload = {
  formats: string[];
  length: number;
  hash: string;
  textPreview?: string;
};

export type TerminalCommandPayload = {
  commandId: string;
  command: string;
  cwd: string;
  shell?: string;
  exitCode?: number;
  durationMs?: number;
  interrupted?: boolean;
  transcriptStartByte?: number;
  transcriptEndByte?: number;
};

export type BrowserUrlPayload = { app: string; url: string; host?: string; title?: string };

export type VideoPayload = { file: string; fps?: number };

export type FrameCapturedPayload = {
  file: string;
  source: "event" | "scene";
  phash?: string;
  correlatedEventSeqs?: number[];
};

// --- Handover tester build events (docs/recorder/tester-package.md §4). ---
// Coordinates arrive in the OS's global space and are converted to display
// physical pixels (`_dpx`) by the package builder using the `displays` event.

/** The OS coordinate space of a point or rectangle (tester-package.md §3 displays). */
export type GlobalSpace = "macos_global_points" | "windows_virtual_px";

/** Layout of every display, emitted once at session start and again on display changes. */
export type DisplaysPayload = {
  globalSpace: GlobalSpace;
  displays: {
    /** Electron `Display.id`; the package maps these to d0, d1… in this order. */
    id: number;
    originGlobal: [number, number];
    sizeDpx: [number, number];
    scaleFactor: number;
    primary: boolean;
  }[];
};

/** Normalised control role (tester-package.md §4.2). */
export type ControlRole =
  | "button" | "textbox" | "combobox" | "option" | "menuitem" | "link" | "tab"
  | "checkbox" | "radio" | "cell" | "row" | "listitem" | "treeitem" | "dialog"
  | "window" | "pane" | "document" | "text" | "image" | "other";

/** Why no (strong) control was identified for a click (tester-package.md §4.2). */
export type UnavailableReason =
  | "helper_missing" | "timeout" | "permission_missing" | "remote_session"
  | "opaque_toolkit" | "elevated_window" | "secure_field";

/** The control under a click, as resolved by the native helper (lane L5). */
export type ClickTarget = {
  grounding: "accessibility" | "accessibility_weak";
  source: "ax" | "uia";
  role: ControlRole;
  nativeRole: string;
  /** Control name only. Field VALUES are never read (tester-package.md §1). */
  name: string;
  automationId?: string;
  axIdentifier?: string;
  isPassword: boolean;
  /** Element bounds in the payload's `space`. */
  bounds?: WindowBounds;
  /** Window down to the nearest parent, at most 6 entries. */
  ancestry?: { role: ControlRole; name: string }[];
  app?: { name: string; process?: string; bundleId?: string };
  windowTitle?: string;
};

export type PointerClickPayload = {
  button: "left" | "right" | "middle";
  clickCount: 1 | 2;
  space: GlobalSpace;
  /** Pointer-down position in `space`. */
  x: number;
  y: number;
  /** Present when the helper resolved a control. */
  target?: ClickTarget;
  /** Present when `target` is absent, or when `target.grounding` is weak. */
  unavailableReason?: UnavailableReason;
  /** Helper control-lookup time, for diagnostics. */
  lookupMs?: number;
};

export type AnnotationPayload = {
  /** `ann_0001`… assigned by the producer, stable within the session. */
  annotationId: string;
  kind: "highlight" | "comment" | "narration";
  /** Electron `Display.id` of the frozen frame (highlights). */
  displayId?: number;
  /** Session-relative path of the frozen frame PNG the highlight was drawn on. */
  frameFile?: string;
  shape?: "rect" | "arrow" | "highlighter" | "freehand";
  /** Shape points in display physical pixels of `displayId`. */
  pointsDpx?: [number, number][];
  snappedTo?: { role: ControlRole; name: string; boundsDpx: WindowBounds };
  /** Comment or narration text. */
  text?: string;
  source?: "typed" | "review";
  /** Narration segments only: end time in ms from recording start. */
  tEndMs?: number;
};

export type GapPayload = {
  reason: "user_paused" | "helper_restart" | "capture_lost" | "permission_lost" | "elevated_window";
  /** `elevated_window` only: the executable name (no path) of the administrator window in front. */
  process?: string;
  /** End of the gap in ms from recording start; absent while still open. */
  tEndMs?: number;
};

export type ExplainPayload = {
  displayIds: number[];
  /** `explain.start` only: the display under the pointer when the screen froze (optional). */
  pointerDisplayId?: number;
};

/** Maps each event type to its payload shape. */
export interface EventPayloads {
  displays: DisplaysPayload;
  "pointer.click": PointerClickPayload;
  annotation: AnnotationPayload;
  gap: GapPayload;
  "explain.start": ExplainPayload;
  "explain.end": ExplainPayload;
  "session.start": SessionStartPayload;
  "session.stop": SessionStopPayload;
  marker: MarkerPayload;
  "app.activate": AppActivatePayload;
  "app.title-change": AppTitleChangePayload;
  "clipboard.change": ClipboardChangePayload;
  "terminal.command": TerminalCommandPayload;
  "browser.url": BrowserUrlPayload;
  "video.start": VideoPayload;
  "video.stop": VideoPayload;
  "frame.captured": FrameCapturedPayload;
}

/**
 * A not-yet-persisted event as produced by a collector. The session store
 * stamps it with `seq`, `t`, and `epoch` on append.
 */
export type EventInput = {
  [K in EventType]: { type: K; source: string; payload: EventPayloads[K] };
}[EventType];
